#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""rnd-export-latest — 과제별 최신 구조화 스냅샷(KR_*.yaml) 복사 도구.

RND_PROJECT 아래 각 과제 폴더에서 '최신 차년도 + 최고 rev' 구조화 yaml 1개를
골라 대상 폴더로 **복사**한다(원본 보존, 이동/삭제 아님). 파일명은 rev 접미사를
제거해 KR_{과제}.yaml 로 정규화한다.

이 스크립트는 스킬의 '도출값(시스템 입력)' 을 결정론적으로 계산·복사한다:
  - 최신 차년도  = <과제>/<N차년도> 중 N 최대
  - 최고 rev     = 그 차년도의 KR_*.yaml 중 rev 최대 (파일명 _r{N} = rev N, 접미사 없음 = r0)
  - 정규화 이름  = KR_{과제}.yaml (파일명 스템에서 _r{N} 제거)

설정파일(선택): 대상 폴더·옵션을 매번 인자로 주지 않도록 export.config.yaml 로
저장할 수 있다. 우선순위는 **CLI 인자 > 설정파일 > 내장 기본**(설정파일 없으면
현행 동작 그대로 — 하위호환). 실값 설정은 스킬 폴더 안(양식 옆)에서 관리한다
(2026-07-02 doctrine — .gitignore·.toolignore 제외). 탐색 위치는 --config >
<스킬폴더>/export.config.yaml > <프로젝트루트>/export.config.yaml(구위치·하위호환) >
<cwd>/export.config.yaml. 지원 키: dest, source, with_json, no_overwrite.
값 검증: dest/source 는 문자열, with_json/no_overwrite/with_meta 는 YAML 불리언
(true/false)만 허용 — 타입이 다르면 경고 후 그 키만 무시(스크립트는 죽지 않음).
설정파일의 상대경로 dest/source 는 실행 cwd 가 아니라 **설정파일 위치 기준**으로
해석한다. 빈 양식·지침 → 같은 스킬 폴더의 export.config.tpl.yaml.

ea_meta 동반 유지(with_meta, 기본 true): KR_*.yaml 을 복사하면서 과제 운영메타
`_export/ea_meta.yaml`(kreclass-rnd-approval 이 소비하는 ①입력값)을 함께 유지한다.
이 스킬은 **선택된(수출) 과제 중 ea_meta 에 아직 항목이 없는 것만 '빈칸 stub'
으로 append** 한다 — 이미 채워진 블록·주석은 절대 건드리지 않는다(append-only,
텍스트 보존). 마스터 위치는 `<source>/_export/ea_meta.yaml`("_export 아래"). 그
파일이 없으면 대상(dest)에 있는 기존 ea_meta.yaml 을 seed 로 삼아(SSCB 등 손입력
보존) _export 마스터를 만든다. 일회성 끄기는 --no-meta.

안전 가드: 대상 폴더가 소스 과제 트리 내부(과제/차년도 폴더 하위)면 정규화 사본이
원본 r0 스냅샷을 덮어쓸 수 있어 실행을 거부한다(exit 2). 소스 바로 아래의
`_` 접두 예약폴더(_export 등)만 대상으로 허용.

사용법:
  python export_latest.py [대상폴더] [옵션]

인자:
  대상폴더            복사 목적지. 생략 시 설정파일 dest > <source>/_export
옵션:
  --source <경로>     스캔할 소스 루트. 기본 = 설정파일 source > 스크립트 기준
                      프로젝트의 RND_PROJECT(없으면 현재 작업 디렉터리의 RND_PROJECT)
  --config <경로>     설정파일 경로 명시(기본은 스킬폴더 > 프로젝트루트(구위치) > cwd
                      의 export.config.yaml)
  --dry-run           실제 복사 없이 선택 결과만 출력(설정파일에 담지 않음 — 일회성)
  --no-overwrite      대상에 동일명 파일이 있으면 스킵(기본은 덮어쓰기)
  --overwrite         설정파일 no_overwrite: true 를 일회성으로 뒤집어 덮어쓰기
  --with-json         선택한 yaml 과 짝이 되는 .json 사본도 함께 복사
  --no-json           설정파일 with_json: true 를 일회성으로 뒤집어 yaml 만 복사
  --with-meta         _export/ea_meta.yaml 을 유지하고 미이관 수출 과제를 빈칸 stub 로 추가(기본)
  --no-meta           설정파일 with_meta: true 를 일회성으로 뒤집어 ea_meta 유지 생략
  -h, --help          도움말
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

# Windows 콘솔 기본 인코딩(cp949)에서 한글·em-dash 출력이 깨지거나 크래시하는 것 방지.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

YEAR_RE = re.compile(r"^(\d+)차년도$")          # "3차년도" -> 3
REV_RE = re.compile(r"_r(\d+)$")                # "..._r1" 스템 -> rev 1
KR_YAML_RE = re.compile(r"^KR_.*\.yaml$", re.IGNORECASE)


CONFIG_KEYS = {"dest", "source", "with_json", "no_overwrite", "with_meta"}

EA_META_FILENAME = "ea_meta.yaml"

# 마스터 ea_meta 가 아예 없을 때만 쓰는 최소 헤더(보통은 dest 의 기존 파일을 seed 로
# 삼아 손입력·주석을 그대로 물려받으므로 이 경로는 드물게만 쓰인다).
EA_META_FRESH_HEADER = (
    "# 과제 운영메타 (①입력값) — rnd-export-latest 가 _export 아래 자동 유지\n"
    "#   (수출 과제 중 ea_meta 에 없는 것만 빈칸 stub 로 append — 채워진 값은 안 건드림)\n"
    "# 스키마·작성법 → kreclass-rnd-approval 스킬 §1.6 · 빈 양식 → 그 스킬 templates/ea_meta.tpl.yaml\n"
    "# 원칙: 옆 KR_*.yaml(SSOT 사본)이 주지 못하는 값만. 우선순위 KR_*.yaml > 이 파일.\n"
    "# ⚠️ io_code/io_name 은 회계값 — 임의생성 금지(받은 값만). PMS 키는 RND-NN-YYYY.\n"
    "# ═══════════════════════════════════════════════════════════════════\n"
)


def project_root() -> Path:
    """스크립트 기준 프로젝트 루트(<project>/.claude/skills/rnd-export-latest/…)."""
    here = Path(__file__).resolve()
    return here.parents[3] if len(here.parents) > 3 else Path.cwd()


def load_config(explicit: str | None) -> dict:
    """설정파일(export.config.yaml)을 로드해 dict 반환. 없으면 {} (현행 동작).

    탐색 순서: --config 명시 경로 > <스킬폴더>/export.config.yaml(정위치 — 실값은
    양식 옆·스킬 안에서 관리) > <프로젝트루트>/export.config.yaml(구위치·하위호환) >
    <cwd>/export.config.yaml. PyYAML 미설치·파싱 실패·비-매핑·--config 명시 경로
    미존재면 경고 후 {} 로 폴백(설정파일이 있어도 스크립트가 죽지 않게 — 대상은
    CLI/기본값으로 진행).
    """
    skill_dir = Path(__file__).resolve().parent
    if explicit:
        p = Path(explicit).expanduser()
        if not p.is_file():
            print(f"[경고] --config 로 지정한 설정파일 없음 — 무시: {p}", file=sys.stderr)
            return {}
        paths = [p]
    else:
        paths = [skill_dir / "export.config.yaml",
                 project_root() / "export.config.yaml",
                 Path.cwd() / "export.config.yaml"]
    for p in paths:
        if not p.is_file():
            continue
        try:
            import yaml  # 지연 임포트 — 설정파일이 없으면 의존조차 안 함
        except ImportError:
            print(f"[경고] PyYAML 미설치 — 설정파일 무시: {p}", file=sys.stderr)
            return {}
        try:
            data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        except Exception as e:  # noqa: BLE001 — 어떤 파싱오류든 폴백
            print(f"[경고] 설정파일 파싱 실패 — 무시: {p} ({e})", file=sys.stderr)
            return {}
        if not isinstance(data, dict):
            print(f"[경고] 설정파일 최상위가 매핑이 아님 — 무시: {p}", file=sys.stderr)
            return {}
        unknown = set(data) - CONFIG_KEYS
        if unknown:
            print(f"[경고] 설정파일 미지원 키 무시: {sorted(unknown)} ({p})", file=sys.stderr)
        data = _validate_config(data, p)
        if not explicit and p.parent != skill_dir:
            print(f"[안내] 설정파일이 스킬 폴더 밖(구위치/cwd)에 있음 — 스킬 폴더로 이동 권장: "
                  f"{skill_dir / 'export.config.yaml'}", file=sys.stderr)
        print(f"설정 : {p}")
        return data
    return {}


def _validate_config(data: dict, cfg_path: Path) -> dict:
    """설정값 수준 검증·정규화 — 잘못된 타입은 경고 후 그 키만 무시(폴백 계약 유지).

    - dest/source: 문자열만. 상대경로는 설정파일 위치 기준으로 절대화
      (실행 cwd 에 따라 대상이 바뀌지 않게).
    - with_json/no_overwrite: YAML 불리언(true/false)만. 따옴표 친 "false" 같은
      문자열은 bool() 캐스팅 시 참이 되므로 여기서 거부.
    """
    out: dict = {}
    for key in ("dest", "source"):
        v = data.get(key)
        if v is None or v == "":
            continue  # 비움 = 미지정
        if not isinstance(v, str):
            print(f"[경고] 설정 {key} 가 문자열이 아님({v!r}) — 이 키 무시: {cfg_path}", file=sys.stderr)
            continue
        q = Path(v).expanduser()
        out[key] = str(q if q.is_absolute() else (cfg_path.parent / q))
    for key in ("with_json", "no_overwrite", "with_meta"):
        v = data.get(key)
        if v is None:
            continue
        if not isinstance(v, bool):
            print(f"[경고] 설정 {key} 가 불리언(true/false)이 아님({v!r}) — 이 키 무시: {cfg_path}", file=sys.stderr)
            continue
        out[key] = v
    return out


def build_meta_stub(project_name: str, source_name: str) -> str:
    """미이관 수출 과제 1개의 '빈칸 stub' 텍스트 — 기존 SSCB 블록과 같은 스타일.

    최상위 키 = 과제명(폴더명의 `_` 를 공백으로). PMS 번호(RND-NN-YYYY)가 정해지면
    이 키를 그 값으로 바꾼다(별도 id 필드 없음 — 키가 곧 id, 사용자 지시 2026-07-16).
    행정정보(alias·회계 I/O)만 빈칸으로 두고, source 만 자동으로 채운다. 과제정보
    (name/ministry/agency/role/agreement/overview 등)는 KR_*.yaml(SSOT)에 이미 있어
    두지 않는다 — 어떤 값이 도출되는지 주석으로 명시한다. 값은 사용자가 주면 입력,
    없으면 빈 껍데기로 둔다.
    """
    key = project_name.replace("_", " ")   # 과제명(읽기용 키). PMS 번호 정해지면 이 키를 그 값으로 바꾼다.
    return (
        "\n# ── (자동 stub, rnd-export-latest) 미이관 과제 — 행정정보만 채운다 ──\n"
        f'"{key}":   # 키 = 과제명. PMS 번호(RND-NN-YYYY) 정해지면 이 키를 그 값으로 바꾼다\n'
        "  alias:                    #\n"
        f"  source: {source_name}\n"
        "  # 아래 값들은 yaml 에서 도출되므로 여기 두지 않는다:\n"
        "  #   name(meta.과제명) · ministry(표지.중앙행정기관) · agency(표지.전문기관)\n"
        "  #   role(표지.KR.역할) · agreement(표지.KR.책임자) · overview (1)(2)(3)(5)\n"
        "  io_code:                  # 회계 I/O코드 — 임의생성 금지(받은 값만)\n"
        "  io_name:                  # I/O명(회계 표기, 과제 정식명과 다름)\n"
        "  # dept·rcms·status·category : 값 있으면 사용자 확인 후 여기에 추가 — 지어내지 않는다\n"
    )


def meta_covered_sources(text: str) -> set[str] | None:
    """ea_meta 텍스트에서 이미 등록된 source: 파일명 집합. PyYAML 없으면 None(판별 불가)."""
    try:
        import yaml  # 지연 임포트 — with_meta 를 안 쓰면 의존조차 안 함
    except ImportError:
        return None
    try:
        data = yaml.safe_load(text) or {}
    except Exception:  # noqa: BLE001 — 어떤 파싱오류든 '아무것도 커버 안 함' 으로 폴백
        return set()
    covered: set[str] = set()
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, dict) and v.get("source"):
                covered.add(str(v["source"]).strip())
    return covered


def maintain_ea_meta(source: Path, dest: Path, exported: list[tuple[str, str]],
                     dry_run: bool) -> None:
    """`_export/ea_meta.yaml`(마스터)을 유지 — 수출 과제 중 항목 없는 것만 빈칸 stub append.

    · 마스터 = <source>/_export/ea_meta.yaml. 없으면 dest 의 기존 ea_meta.yaml 을
      seed 로 물려받는다(SSCB 등 손입력·주석 보존). 둘 다 없으면 최소 헤더로 신규.
    · 이미 채워진 블록·주석은 절대 수정하지 않는다(텍스트 append-only).
    · exported = [(과제폴더명, 정규화 KR 파일명), …] — 이번 실행에서 선택된 과제.
    """
    meta_path = source / "_export" / EA_META_FILENAME
    dest_meta = (dest / EA_META_FILENAME) if dest is not None else None

    if meta_path.is_file():
        base_text, base_from = meta_path.read_text(encoding="utf-8"), meta_path
    elif dest_meta is not None and dest_meta.is_file():
        base_text, base_from = dest_meta.read_text(encoding="utf-8"), dest_meta
    else:
        base_text, base_from = EA_META_FRESH_HEADER, None

    covered = meta_covered_sources(base_text)
    print("-" * 72)
    print(f"ea_meta : {meta_path}" + ("  (dry-run)" if dry_run else ""))
    if base_from is not None and base_from != meta_path:
        print(f"          seed ← {base_from}")
    if covered is None:
        print("          [경고] PyYAML 미설치 — stub 중복 판별 불가로 ea_meta 유지 생략"
              " (--no-meta 로 끄거나 PyYAML 설치).", file=sys.stderr)
        return

    to_add = [(pn, nm) for pn, nm in exported if nm not in covered]
    new_text = base_text
    for pn, nm in to_add:
        if not new_text.endswith("\n"):
            new_text += "\n"
        new_text += build_meta_stub(pn, nm)
        print(f"          + stub: {pn}  (source: {nm})")
    already = [nm for _pn, nm in exported if nm in covered]
    if already:
        print(f"          이미 등록됨(건너뜀): {len(already)}개")
    if not to_add:
        print("          추가할 stub 없음")

    if dry_run:
        return
    existing = meta_path.read_text(encoding="utf-8") if meta_path.is_file() else None
    if existing == new_text:
        print("          변경 없음 — 그대로 둠")
        return
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(new_text, encoding="utf-8")
    print(f"          기록됨 ({'신규' if existing is None else '갱신'})")


def find_source_root(explicit: str | None) -> Path:
    """소스 루트(RND_PROJECT) 결정: --source > 스크립트 기준 프로젝트 > cwd."""
    if explicit:
        return Path(explicit).expanduser().resolve()
    # 스크립트는 <project>/.claude/skills/rnd-export-latest/ 에 있다.
    # parents[3] = <project> 루트. 그 아래 RND_PROJECT 를 우선 시도.
    here = Path(__file__).resolve()
    for base in (here.parents[3] if len(here.parents) > 3 else None, Path.cwd()):
        if base is None:
            continue
        cand = base / "RND_PROJECT"
        if cand.is_dir():
            return cand.resolve()
    # 마지막 fallback: cwd/RND_PROJECT (없더라도 경로 반환 → 이후 검증에서 에러)
    return (Path.cwd() / "RND_PROJECT").resolve()


def latest_year_dir(project_dir: Path) -> Path | None:
    """과제 폴더에서 가장 높은 N차년도 하위폴더. 없으면 과제 폴더 자신."""
    years: list[tuple[int, Path]] = []
    for child in project_dir.iterdir():
        if child.is_dir():
            m = YEAR_RE.match(child.name)
            if m:
                years.append((int(m.group(1)), child))
    if years:
        years.sort(key=lambda t: t[0])
        return years[-1][1]
    # 차년도 폴더가 없으면 과제 폴더에 직접 KR_*.yaml 이 있을 수 있다.
    if any(KR_YAML_RE.match(p.name) for p in project_dir.iterdir() if p.is_file()):
        return project_dir
    return None


def _rev_match(yaml_path: Path, project_name: str) -> re.Match | None:
    """_r{N} 접미사가 진짜 rev 일 때만 매치 반환.

    과제 폴더명 자체가 _r{N} 으로 끝나면(예: 과제A_r2) base 파일
    KR_과제A_r2.yaml 의 접미사는 과제명의 일부다 — 접미사를 뗀 스템이
    KR_{과제폴더명} 과 정확히 일치할 때만 rev 로 인정해 오인·정규화
    충돌(타 과제 사본 덮어쓰기)을 막는다.
    """
    m = REV_RE.search(yaml_path.stem)
    if m and yaml_path.stem[: m.start()] == f"KR_{project_name}":
        return m
    return None


def rev_of(yaml_path: Path, project_name: str) -> int:
    """파일명 스템의 _r{N} → rev 정수. 접미사가 없거나 rev 로 인정되지 않으면 0(r0=base)."""
    m = _rev_match(yaml_path, project_name)
    return int(m.group(1)) if m else 0


def normalized_name(yaml_path: Path, project_name: str) -> str:
    """rev 접미사를 제거한 정규화 파일명 (KR_{과제}.yaml). rev 로 인정될 때만 제거."""
    m = _rev_match(yaml_path, project_name)
    if m:
        return yaml_path.stem[: m.start()] + yaml_path.suffix
    return yaml_path.name


def pick_latest_yaml(year_dir: Path, project_name: str) -> Path | None:
    """차년도 폴더에서 rev 가 가장 높은 KR_*.yaml 1개."""
    candidates = [p for p in year_dir.iterdir()
                  if p.is_file() and KR_YAML_RE.match(p.name)]
    if not candidates:
        return None
    # rev 우선, 동률이면 파일명순(안정)
    candidates.sort(key=lambda p: (rev_of(p, project_name), p.name))
    return candidates[-1]


def iter_projects(source: Path):
    """소스 루트의 과제 폴더(_ 접두 예약폴더 제외)를 이름순으로."""
    for child in sorted(source.iterdir(), key=lambda p: p.name):
        if child.is_dir() and not child.name.startswith("_"):
            yield child


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("target", nargs="?", default=None)
    ap.add_argument("--source", default=None)
    ap.add_argument("--config", default=None)
    ap.add_argument("--dry-run", action="store_true")
    # None = 미지정(설정파일로 채움) · True/False = CLI 로 강제(켜기·끄기 양방향)
    ap.add_argument("--no-overwrite", dest="no_overwrite", action="store_const", const=True, default=None)
    ap.add_argument("--overwrite", dest="no_overwrite", action="store_const", const=False)
    ap.add_argument("--with-json", dest="with_json", action="store_const", const=True, default=None)
    ap.add_argument("--no-json", dest="with_json", action="store_const", const=False)
    ap.add_argument("--with-meta", dest="with_meta", action="store_const", const=True, default=None)
    ap.add_argument("--no-meta", dest="with_meta", action="store_const", const=False)
    ap.add_argument("-h", "--help", action="store_true")
    args = ap.parse_args(argv)

    if args.help:
        print(__doc__)
        return 0

    # 설정 병합: CLI 인자 > 설정파일 > 내장 기본 (설정값 타입은 load_config 에서 검증됨)
    cfg = load_config(args.config)
    no_overwrite = args.no_overwrite if args.no_overwrite is not None else cfg.get("no_overwrite", False)
    with_json = args.with_json if args.with_json is not None else cfg.get("with_json", False)
    with_meta = args.with_meta if args.with_meta is not None else cfg.get("with_meta", True)

    source = find_source_root(args.source or cfg.get("source") or None)
    if not source.is_dir():
        print(f"[에러] 소스 루트가 없습니다: {source}", file=sys.stderr)
        return 2

    dest_arg = args.target or cfg.get("dest") or None    # 빈 문자열·None 은 기본으로
    target = (Path(dest_arg).expanduser().resolve()
              if dest_arg else (source / "_export").resolve())

    # 안전 가드: 대상이 소스 과제 트리 내부면 정규화 사본이 원본 r0 를 덮어쓸 수
    # 있다(예: 대상=차년도 폴더, KR_X_r1 → KR_X 로 r0 원본 위에 복사). 소스 바로
    # 아래 `_` 접두 예약폴더(_export 등)만 허용하고 그 외는 거부.
    try:
        rel = target.relative_to(source.resolve())
    except ValueError:
        rel = None
    if rel is not None and (not rel.parts or not rel.parts[0].startswith("_")):
        print(f"[에러] 대상이 소스 과제 트리 내부입니다 — 원본 덮어쓰기 위험으로 중단: {target}\n"
              f"       소스 아래에 모으려면 `_` 접두 폴더(예: {source / '_export'})를 쓰세요.",
              file=sys.stderr)
        return 2

    print(f"소스 : {source}")
    print(f"대상 : {target}" + ("  (dry-run)" if args.dry_run else ""))
    print("-" * 72)

    if not args.dry_run:
        target.mkdir(parents=True, exist_ok=True)

    copied = skipped = missing = 0
    seen_dests: dict[Path, str] = {}
    exported: list[tuple[str, str]] = []   # (과제폴더명, 정규화 KR 파일명) — with_meta stub 판별용
    for project in iter_projects(source):
        year_dir = latest_year_dir(project)
        if year_dir is None:
            print(f"[없음] {project.name}: KR_*.yaml 없음 (차년도/파일 미발견)")
            missing += 1
            continue
        chosen = pick_latest_yaml(year_dir, project.name)
        if chosen is None:
            print(f"[없음] {project.name}: {year_dir.name} 에 KR_*.yaml 없음"
                  f" — 최신 차년도만 봄(이전 차년도 폴백 없음)")
            missing += 1
            continue

        rev = rev_of(chosen, project.name)
        out_name = normalized_name(chosen, project.name)
        exported.append((project.name, out_name))   # 최신본이 있는 과제 = 수출 대상(복사/스킵 무관)
        dest = target / out_name
        prev_project = seen_dests.get(dest)
        if prev_project is not None:
            print(f"[경고] 사본 이름 충돌: {out_name} 이 이미 과제 '{prev_project}' 에서 "
                  f"복사됨 — '{project.name}' 것이 덮어씀", file=sys.stderr)
        seen_dests[dest] = project.name
        year_label = year_dir.name if year_dir != project else "(직속)"

        # dest 가 소스 파일 자신과 같으면(대상=원본위치) 스킵
        if dest.resolve() == chosen.resolve():
            print(f"[스킵] {project.name}: 대상=원본 동일경로 → 복사 안 함 ({chosen.name})")
            skipped += 1
            continue

        exists = dest.exists()
        if exists and no_overwrite:
            print(f"[스킵] {project.name}: 이미 존재(--no-overwrite) → {dest.name}")
            skipped += 1
            continue

        action = "덮어씀" if exists else "복사"
        tag = f"r{rev}"
        print(f"[{action}] {project.name} [{year_label}·{tag}] "
              f"{chosen.name}  →  {out_name}")

        pairs = [(chosen, dest)]
        if with_json:
            json_src = chosen.with_suffix(".json")
            if json_src.exists():
                json_dest = target / (Path(out_name).stem + ".json")
                pairs.append((json_src, json_dest))
                print(f"          + json: {json_src.name}  →  {json_dest.name}")

        if not args.dry_run:
            for src, dst in pairs:
                shutil.copy2(src, dst)
        copied += 1

    print("-" * 72)
    verb = "복사 예정" if args.dry_run else "복사됨"
    print(f"과제 {verb}: {copied} · 스킵: {skipped} · 없음: {missing}")

    # ea_meta 동반 유지: 수출 과제 중 ea_meta 에 없는 것만 빈칸 stub 로 append
    if with_meta and exported:
        maintain_ea_meta(source, target, exported, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
