#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""rnd-kr-extract — 차년도 전용 슬라이서 (year_slice.py)

KR 구조화 스냅샷(KR_<과제>.yaml)에서 **당해 차년도 행만** 남긴다. 연차 폴더(<N차년도>\)의
스냅샷은 그 연차 내용만 담는다는 규칙(2026-10-06)의 결정론 집행기이자 검증기다.

왜 텍스트 슬라이스인가
  스냅샷은 값 옆 산출근거·원문 불일치 주석이 많다. PyYAML 로 다시 쓰면 주석이 전부 사라지므로
  줄 단위로 타 연차 항목만 잘라내고(주석 보존), 결과를 PyYAML 로 로드해 "데이터 수준 필터"와
  동일한지 교차 검증한다(다르면 쓰지 않고 exit 1).

슬라이스 규칙 (연차 = 당해 차년도 Y)
  ① `- 연차: X` 로 시작하는 블록 항목 / `- {연차: X, …}` 한 줄 항목 → X≠Y 면 항목 통째 삭제
     (목표·수행일정·주요결과물·지원부담·비목별·참여연구자인건비·외주용역·세부사용계획·간접비세부·
      연구실안전관리비.연차별금액 등 '연차' 키를 가진 모든 리스트).
  ② 성능목표(`- 평가항목:`)·성과지표(`- 지표:`) 항목의 `목표치: {…}`/`목표: {…}` 맵에 N차년도 키가 있으면
     Y 키가 없는 항목은 삭제, 있는 항목은 Y 키만 남긴다(타 연차·`계` 제거). 연차 키가 전혀 없는 맵
     (예: 과제 통합표 `{계: 5}`)은 손대지 않는다.
  ③ meta 는 과제 식별정보라 그대로 둔다(연차범위·연차별기간·기간·표지 포함). `meta.차년도` 가 없으면 추가.
  ④ 리스트 수준 주석(항목 들여쓰기 이하)은 보존, 삭제되는 항목 안쪽 주석은 함께 삭제.

사용
  python year_slice.py <KR_스냅샷.yaml> [--year N차년도] [-o <출력>] [--dry-run]
  python year_slice.py <KR_스냅샷.yaml> --check [--year N차년도]      # 검증만(타 연차 잔존 시 exit 2)
  --year 미지정 시 meta.차년도 → meta.현재차년도 → 파일이 든 폴더명(N차년도) 순으로 결정.

exit 0=정상 · 1=실행/교차검증 실패 · 2=(--check) 타 연차 내용 잔존
"""
from __future__ import annotations

import argparse
import copy
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.exit("PyYAML 이 필요합니다: python -m pip install pyyaml")

for _s in (sys.stdout, sys.stderr):  # Windows 콘솔(cp1252/cp949)에서도 한글 출력
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

YEAR_RE = re.compile(r"^\d+차년도$")
BLOCK_YEAR_ITEM = re.compile(r"^(\s*)- 연차:\s*([^\s#]+)")
FLOW_YEAR_ITEM = re.compile(r"^(\s*)- \{.*?\b연차:\s*([^,}\s]+)")
GOAL_ITEM = re.compile(r"^(\s*)- (평가항목|지표):")
GOAL_FLOW_ITEM = re.compile(r"^(\s*)- \{.*?\b(지표|평가항목):")
TARGET_MAP_HEAD = re.compile(r"^(\s*)(목표치|목표):\s*\{")
TARGET_MAP_INLINE = re.compile(r"\b(목표치|목표):\s*\{([^{}]*)\}")


class _TM:
    """`목표치: {…}` 줄의 분해 결과 — group(1)=들여쓰기, (2)=키, (3)=맵 본문, (4)=꼬리(주석 포함)."""

    def __init__(self, parts):
        self._p = parts

    def group(self, i):
        return self._p[i]


def match_target_map(line: str):
    """`^<indent><목표치|목표>: {<body>}<tail>` 를 중괄호 균형·따옴표 기준으로 분해(꼬리 주석 안의 `}` 에 속지 않음)."""
    m = TARGET_MAP_HEAD.match(line)
    if not m:
        return None
    start = m.end()  # '{' 다음
    depth, quote, i = 1, None, start
    while i < len(line):
        ch = line[i]
        if quote:
            if ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    if depth != 0:
        return None  # 여러 줄 flow 맵 — 지원 안 함(교차검증이 잡음)
    tail = line[i + 1:]
    if tail.strip() and not tail.lstrip().startswith("#"):
        return None
    return _TM((line, m.group(1), m.group(2), line[start:i], tail))
META_KEYS_PRESERVE = ("연차범위", "연차별기간")  # 과제 식별정보 — 연차 키처럼 보여도 자르지 않음

NOTE_LINE = ("# 당해 차년도 전용 스냅샷 — {year} 행만 수록. 타 연차 계획값은 그 연차 폴더의 스냅샷 또는 "
             "발췌본(<과제>_KR/NN_*.md)·전체 변환본(original/)에서 본다. 슬라이스·검증 = scripts/year_slice.py")
NOTE_MARK = "# 당해 차년도 전용 스냅샷 — "


def fail(msg: str, code: int = 1):
    print(f"[year_slice] {msg}", file=sys.stderr)
    sys.exit(code)


# ── 보조 ──────────────────────────────────────────────────────────────────
def indent_of(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def is_blank(line: str) -> bool:
    return line.strip() == ""


def is_comment(line: str) -> bool:
    return line.lstrip().startswith("#")


def split_flow_pairs(body: str) -> list[tuple[str, str]]:
    """flow 맵 본문 `a: 1, b: "x, y"` → [(a, 1), (b, "x, y")]. 따옴표·중첩 괄호 안의 쉼표는 분리하지 않음."""
    pairs, buf, depth, quote = [], "", 0, None
    for ch in body:
        if quote:
            buf += ch
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"'):
            quote = ch
            buf += ch
        elif ch in "[{":
            depth += 1
            buf += ch
        elif ch in "]}":
            depth -= 1
            buf += ch
        elif ch == "," and depth == 0:
            if buf.strip():
                pairs.append(buf.strip())
            buf = ""
        else:
            buf += ch
    if buf.strip():
        pairs.append(buf.strip())
    out = []
    for p in pairs:
        k, _, v = p.partition(":")
        out.append((k.strip(), v.strip()))
    return out


def item_end(lines: list[str], start: int, dash_indent: int) -> int:
    """start 의 `- ` 항목이 끝나는 마지막 내용 줄 index(끝 공백줄 제외). 들여쓰기 ≤ dash_indent 인 비공백 줄에서 닫힘."""
    last = start
    j = start + 1
    while j < len(lines):
        ln = lines[j]
        if is_blank(ln):
            j += 1
            continue
        if indent_of(ln) <= dash_indent:
            break
        last = j
        j += 1
    return last


def resolve_year(path: Path, data: dict, cli_year: str | None) -> str:
    if cli_year:
        if not YEAR_RE.match(cli_year):
            fail(f"--year 값이 'N차년도' 형식이 아닙니다: {cli_year}")
        return cli_year
    meta = data.get("meta") or {}
    for k in ("차년도", "현재차년도"):
        v = meta.get(k)
        if isinstance(v, str) and YEAR_RE.match(v.strip()):
            return v.strip()
    if YEAR_RE.match(path.parent.name):
        return path.parent.name
    fail("차년도를 결정하지 못함 — --year N차년도 를 지정하세요(meta.차년도 없음·폴더명도 N차년도 아님)")
    return ""  # unreachable


# ── 데이터 수준 필터(교차 검증 기준) ─────────────────────────────────────
def year_keys(m: dict) -> list[str]:
    return [k for k in m if isinstance(k, str) and YEAR_RE.match(k)]


def filter_data(node, year: str, path: str = ""):
    """PyYAML 데이터에서 슬라이스 규칙 ①②를 그대로 적용한 '기대 결과'. meta 는 손대지 않는다."""
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if path == "" and k == "meta":
                out[k] = v
                continue
            if k in ("목표치", "목표") and isinstance(v, dict) and year_keys(v):
                out[k] = {kk: vv for kk, vv in v.items() if kk == year}
                continue
            out[k] = filter_data(v, year, f"{path}.{k}" if path else str(k))
        return out
    if isinstance(node, list):
        out = []
        for it in node:
            if isinstance(it, dict):
                y = it.get("연차")
                if isinstance(y, str) and YEAR_RE.match(y.strip()) and y.strip() != year:
                    continue
                tm = it.get("목표치") if "목표치" in it else it.get("목표")
                if isinstance(tm, dict) and year_keys(tm) and year not in tm:
                    continue
            out.append(filter_data(it, year, path))
        return out
    return node


def find_foreign(node, year: str, path: str = "", acc: list[str] | None = None) -> list[str]:
    """타 연차 내용이 남아 있는 위치 목록(--check). meta 제외."""
    acc = [] if acc is None else acc
    if isinstance(node, dict):
        for k, v in node.items():
            if path == "" and k == "meta":
                continue
            here = f"{path}.{k}" if path else str(k)
            if k == "연차" and isinstance(v, str) and YEAR_RE.match(v.strip()) and v.strip() != year:
                acc.append(f"{here} = {v}")
            if k in ("목표치", "목표") and isinstance(v, dict):
                others = [y for y in year_keys(v) if y != year]
                if others:
                    acc.append(f"{here} 에 타 연차 키 {others}")
            find_foreign(v, year, here, acc)
    elif isinstance(node, list):
        for i, it in enumerate(node):
            find_foreign(it, year, f"{path}[{i}]", acc)
    return acc


# ── 텍스트 슬라이스 ──────────────────────────────────────────────────────
def parent_key_line(lines: list[str], start: int, dash_indent: int) -> int | None:
    """start 항목이 속한 리스트의 키 줄(들여쓰기 < dash_indent 인 가장 가까운 위 비공백·비주석 줄)."""
    j = start - 1
    while j >= 0:
        ln = lines[j]
        if not is_blank(ln) and not is_comment(ln) and indent_of(ln) < dash_indent:
            return j if re.match(r"^\s*[^\s#][^:#]*:\s*(#.*)?$", ln) else None
        j -= 1
    return None


def empty_lists_to_flow(lines: list[str], drop: list[bool], parents: dict[int, int], year: str, log: list[str]):
    """리스트 항목이 전부 삭제된 키 줄을 `키: []` 로 바꾼다(YAML 이 null 로 읽히는 것 방지)."""
    for p, dash in sorted(parents.items()):
        if drop[p]:
            continue
        p_indent = indent_of(lines[p])
        alive = False
        j = p + 1
        while j < len(lines):
            ln = lines[j]
            if is_blank(ln) or drop[j] or is_comment(ln):
                j += 1
                continue
            if indent_of(ln) <= p_indent:
                break
            if indent_of(ln) == dash and ln.lstrip().startswith("- "):
                alive = True
                break
            j += 1
        if alive:
            continue
        m = re.match(r"^(\s*)([^\s#][^:#]*):(\s*)(#.*)?$", lines[p])
        if not m:
            continue
        head = f"{m.group(1)}{m.group(2)}: []"
        note = f"# {year} 항목 없음(원문엔 타 연차만)"
        tail = m.group(4) or ""
        pad = " " * max(1, len(m.group(1) + m.group(2) + ":" + m.group(3)) - len(head))
        lines[p] = f"{head}{pad}{note}{(' · ' + tail.lstrip('# ').strip()) if tail else ''}"
        log.append(f"수정 L{p + 1}: '{m.group(2).strip()}' 항목 전부 삭제 → []")


def slice_lines(lines: list[str], year: str) -> tuple[list[str], list[str]]:
    """줄 리스트를 슬라이스. (결과 줄들, 삭제/수정 로그) 반환."""
    drop = [False] * len(lines)
    log: list[str] = []
    parents: dict[int, int] = {}  # 삭제된 항목의 리스트 키 줄 → 항목 들여쓰기

    def note_parent(start: int, dash: int):
        p = parent_key_line(lines, start, dash)
        if p is not None:
            parents[p] = dash

    i = 0
    while i < len(lines):
        ln = lines[i]
        if drop[i] or is_blank(ln) or is_comment(ln):
            i += 1
            continue
        m = BLOCK_YEAR_ITEM.match(ln)
        if m:
            dash, y = len(m.group(1)), m.group(2).strip().strip("'\"")
            if YEAR_RE.match(y) and y != year:
                end = item_end(lines, i, dash)
                for j in range(i, end + 1):
                    drop[j] = True
                note_parent(i, dash)
                log.append(f"삭제 L{i + 1}-{end + 1}: 연차 {y} 블록 항목")
                i = end + 1
                continue
            i += 1
            continue
        m = FLOW_YEAR_ITEM.match(ln)
        if m:
            y = m.group(2).strip().strip("'\"")
            if YEAR_RE.match(y) and y != year:
                # flow 맵이 여러 줄에 걸치면 중괄호 균형까지 삭제
                end = i
                depth = ln.count("{") - ln.count("}")
                while depth > 0 and end + 1 < len(lines):
                    end += 1
                    depth += lines[end].count("{") - lines[end].count("}")
                for j in range(i, end + 1):
                    drop[j] = True
                note_parent(i, len(m.group(1)))
                log.append(f"삭제 L{i + 1}{'' if end == i else '-' + str(end + 1)}: 연차 {y} 한 줄 항목")
                i = end + 1
                continue
            i += 1
            continue
        m = GOAL_ITEM.match(ln)
        if m:
            dash = len(m.group(1))
            end = item_end(lines, i, dash)
            handled = False
            for j in range(i, end + 1):
                tm = match_target_map(lines[j])
                if not tm:
                    continue
                pairs = split_flow_pairs(tm.group(3))
                ykeys = [k for k, _ in pairs if YEAR_RE.match(k)]
                if not ykeys:
                    break  # 연차 키 없는 맵(과제 통합표 등) — 그대로
                if year not in ykeys:
                    for k in range(i, end + 1):
                        drop[k] = True
                    note_parent(i, dash)
                    log.append(f"삭제 L{i + 1}-{end + 1}: {m.group(2)} 항목(목표 연차 {ykeys})")
                    handled = True
                    break
                kept = [f"{k}: {v}" for k, v in pairs if k == year]
                removed = [k for k, _ in pairs if k != year]
                if removed:
                    lines[j] = f"{tm.group(1)}{tm.group(2)}: {{{', '.join(kept)}}}{tm.group(4) or ''}"
                    log.append(f"수정 L{j + 1}: {tm.group(2)} 맵에서 {removed} 제거")
                break
            i = end + 1 if handled else i + 1
            continue
        m = GOAL_FLOW_ITEM.match(ln)
        if m:
            tm = TARGET_MAP_INLINE.search(ln)
            if tm:
                pairs = split_flow_pairs(tm.group(2))
                ykeys = [k for k, _ in pairs if YEAR_RE.match(k)]
                if ykeys and year not in ykeys:
                    drop[i] = True
                    note_parent(i, len(m.group(1)))
                    log.append(f"삭제 L{i + 1}: {m.group(2)} 한 줄 항목(목표 연차 {ykeys})")
                elif ykeys:
                    kept = ", ".join(f"{k}: {v}" for k, v in pairs if k == year)
                    removed = [k for k, _ in pairs if k != year]
                    if removed:
                        lines[i] = ln[:tm.start()] + f"{tm.group(1)}: {{{kept}}}" + ln[tm.end():]
                        log.append(f"수정 L{i + 1}: {tm.group(1)} 맵에서 {removed} 제거")
            i += 1
            continue
        i += 1
    empty_lists_to_flow(lines, drop, parents, year, log)
    out = [ln for ln, d in zip(lines, drop) if not d]
    # 항목 삭제로 생긴 연속 공백줄 2개 이상은 1개로
    squeezed: list[str] = []
    for ln in out:
        if is_blank(ln) and squeezed and is_blank(squeezed[-1]):
            continue
        squeezed.append(ln)
    return squeezed, log


def ensure_meta_year(lines: list[str], year: str, log: list[str]) -> list[str]:
    """meta.차년도 가 없으면 단계(없으면 연차범위) 줄 다음에 추가."""
    in_meta, has_year, anchor = False, False, None
    for idx, ln in enumerate(lines):
        if re.match(r"^meta:\s*(#.*)?$", ln):
            in_meta = True
            continue
        if in_meta:
            if ln and not ln.startswith(" ") and not is_comment(ln) and not is_blank(ln):
                break
            if re.match(r"^  차년도:", ln):
                has_year = True
                break
            if re.match(r"^  단계:", ln):
                anchor = idx
            elif anchor is None and re.match(r"^  연차범위:", ln):
                anchor = idx
    if has_year or anchor is None:
        return lines
    new = f"  차년도: {year}" + " " * max(1, 36 - len(f"  차년도: {year}")) + "# 당해 차년도 — 이 스냅샷은 이 연차 행만 담는다(타 연차는 그 연차 폴더)"
    lines.insert(anchor + 1, new)
    log.append(f"추가 L{anchor + 2}: meta.차년도: {year}")
    return lines


def ensure_note(lines: list[str], year: str, log: list[str]) -> list[str]:
    """2번째 줄(첫 줄 마커 아래)에 차년도 전용 안내 주석을 둔다(이미 있으면 갱신)."""
    note = NOTE_LINE.format(year=year)
    for idx, ln in enumerate(lines[:12]):
        if ln.startswith(NOTE_MARK):
            if ln != note:
                lines[idx] = note
                log.append(f"갱신 L{idx + 1}: 차년도 전용 안내 주석")
            return lines
    pos = 1 if lines and lines[0].startswith("#") else 0
    lines.insert(pos, note)
    log.append(f"추가 L{pos + 1}: 차년도 전용 안내 주석")
    return lines


# ── 메인 ──────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="KR 스냅샷을 당해 차년도 행만 남기도록 슬라이스/검증(주석 보존)")
    ap.add_argument("snapshot", help="KR_<과제>.yaml 경로")
    ap.add_argument("--year", help="당해 차년도(N차년도). 미지정 시 meta.차년도 → meta.현재차년도 → 폴더명")
    ap.add_argument("-o", "--out", help="출력 경로(기본: 제자리 덮어쓰기)")
    ap.add_argument("--check", action="store_true", help="검증만 — 타 연차 내용이 남아 있으면 exit 2")
    ap.add_argument("--dry-run", action="store_true", help="삭제·수정 계획만 출력하고 쓰지 않음")
    args = ap.parse_args()

    path = Path(args.snapshot)
    if not path.is_file():
        fail(f"파일 없음: {path}")
    raw = path.read_bytes()
    newline = "\r\n" if b"\r\n" in raw else "\n"
    text = raw.decode("utf-8").replace("\r\n", "\n")  # 내부 처리는 LF, 저장 시 원래 줄바꿈으로 복원
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as e:
        fail(f"YAML 파싱 실패: {e}")
    if not isinstance(data, dict) or "meta" not in data:
        fail("최상위 meta 가 없는 파일 — KR 구조화 스냅샷이 아닙니다")
    year = resolve_year(path, data, args.year)

    if args.check:
        foreign = find_foreign(data, year)
        meta_year = (data.get("meta") or {}).get("차년도")
        if meta_year and str(meta_year).strip() != year:
            foreign.insert(0, f"meta.차년도 = {meta_year} (기대 {year})")
        folder_year = path.parent.name if YEAR_RE.match(path.parent.name) else None
        if folder_year and folder_year != year:  # 폴더(N차년도)와 당해 연차 불일치 — 다른 연차 폴더에 놓인 파일
            foreign.insert(0, f"파일이 든 폴더 = {folder_year} 인데 당해 연차 = {year}")
        if foreign:
            print(f"[year_slice] ✖ {path.name}: {year} 외 내용 {len(foreign)}건")
            for f in foreign[:40]:
                print(f"   - {f}")
            if len(foreign) > 40:
                print(f"   … 외 {len(foreign) - 40}건")
            sys.exit(2)
        print(f"[year_slice] ✔ {path.name}: {year} 전용(타 연차 내용 없음)")
        return

    lines = text.split("\n")
    trailing_nl = text.endswith("\n")
    if trailing_nl:
        lines = lines[:-1]
    sliced, log = slice_lines(list(lines), year)
    sliced = ensure_meta_year(sliced, year, log)
    sliced = ensure_note(sliced, year, log)
    out_text = "\n".join(sliced) + ("\n" if trailing_nl else "")

    # 교차 검증: 텍스트 슬라이스 결과 == 데이터 수준 필터 결과(meta 제외 비교 + meta.차년도 확인)
    try:
        got = yaml.safe_load(out_text)
    except yaml.YAMLError as e:
        fail(f"슬라이스 결과가 YAML 로 파싱되지 않음(쓰지 않음): {e}")
    expect = filter_data(copy.deepcopy(data), year)
    got_cmp = {k: v for k, v in got.items() if k != "meta"}
    exp_cmp = {k: v for k, v in expect.items() if k != "meta"}
    if got_cmp != exp_cmp:
        for k in sorted(set(got_cmp) | set(exp_cmp)):
            if got_cmp.get(k) != exp_cmp.get(k):
                print(f"[year_slice] 불일치 섹션: {k}", file=sys.stderr)
        fail("텍스트 슬라이스 결과가 데이터 필터 결과와 다릅니다(쓰지 않음) — 파일 모양 확인 필요")
    got_meta = {k: v for k, v in (got.get("meta") or {}).items() if k != "차년도"}
    exp_meta = {k: v for k, v in (data.get("meta") or {}).items() if k != "차년도"}
    if got_meta != exp_meta:
        fail("meta 블록이 변형되었습니다(쓰지 않음)")
    if str((got.get("meta") or {}).get("차년도", "")).strip() != year:
        fail("meta.차년도 가 당해 차년도와 다릅니다(쓰지 않음)")
    left = find_foreign(got, year)
    if left:
        fail(f"슬라이스 후에도 타 연차 내용 {len(left)}건 잔존: {left[:5]}")

    removed = sum(1 for l in log if l.startswith("삭제"))
    changed = sum(1 for l in log if l.startswith("수정"))
    print(f"[year_slice] {path.name} → {year}: 항목 삭제 {removed} · 맵 수정 {changed} · "
          f"줄 {len(lines)} → {len(sliced)}")
    for l in log:
        print(f"   {l}")
    if args.dry_run:
        print("[year_slice] --dry-run: 쓰지 않음")
        return
    out = Path(args.out) if args.out else path
    out.write_bytes(out_text.replace("\n", newline).encode("utf-8") if newline != "\n" else out_text.encode("utf-8"))
    print(f"[year_slice] 저장: {out}")


if __name__ == "__main__":
    main()
