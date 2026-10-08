#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
budget_calc.py — 연구개발비 '비목(費目)' 간 이동 결정론 계산 엔진 (rnd-budget-change)

한국선급(KR) R&D 과제의 한 연차 안에서 직접비 비목 간에 금액을 옮긴다.
직접비 소계·간접비·총액은 고정(총 연구개발비 불변) — 이동한 금액만큼 출발 비목이 줄고 도착 비목이 는다.
LLM 암산 금지, 산술은 이 스크립트가 전담. 단위=천원 정수.

비목 체계(직접비): 인건비 · 연구시설장비비(=연구시설·장비비) · 연구재료비 · 연구활동비 · 연구수당
  ⚠ 인건비는 이 스킬의 출발/도착 대상이 될 수 없다(개인별 계상액 재배분 필요 → /rnd-manpower-change).

두 가지 모드:
  ① 추출  : python budget_calc.py --extract <KR_스냅샷.yaml> --year <연차> -o <input.json>
             스냅샷 예산.비목별[연차]에서 현재 직접비 비목·간접비·총액을 뽑아 이동칸이 빈 scaffold JSON 생성.
  ② 계산  : python budget_calc.py <input.json> [--yaml-out <비교.yaml>] [--md-out <변경안.md>]
             input.json 의 이동[]을 반영해 후값 산출 + 2-pass 재검산, 결과 JSON 을 stdout 으로.
             --yaml-out / --md-out 지정 시 변경 전/후 비교 YAML·변경안 MD 도 파일로 기록.

exit code: 0=ok, 2=검증 실패, 1=치명 오류.
"""
import sys
import json

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# 직접비 비목 표준 순서(스냅샷에 0원이라 생략됐어도 이 순서로 채운다)
BOMOK = ["인건비", "연구시설장비비", "연구재료비", "연구활동비", "연구수당"]
# 표시명(문서·YAML 라벨). yaml 키 연구시설장비비 → 가운뎃점 표기.
DISPLAY = {"연구시설장비비": "연구시설·장비비"}
# 인건비는 이 스킬로 옮길 수 없다(→ /rnd-manpower-change).
BLOCKED = {"인건비"}


def disp(name):
    return DISPLAY.get(name, name)


# 표시명 → yaml 키 역매핑 (YAML 산출물의 가운뎃점 표기를 다시 입력으로 써도 인식)
_REV = {v: k for k, v in DISPLAY.items()}


def canon(name):
    """표시명·yaml 키 어느 쪽으로 들어와도 표준 yaml 키로 정규화(연구시설·장비비 → 연구시설장비비)."""
    name = (name or "").strip()
    return _REV.get(name, name)


def parse_amt(v):
    """금액을 천원 정수로 안전 파싱. 성공 (정수, None) / 실패 (None, 사유)."""
    if isinstance(v, bool):
        return None, f"금액 타입 오류(불리언): {v!r}"
    if isinstance(v, int):
        return v, None
    if isinstance(v, float):
        if v != int(v):
            return None, f"금액은 천원 정수여야 합니다(소수 불가): {v}"
        return int(v), None
    if isinstance(v, str):
        s = v.replace(",", "").strip()
        try:
            return int(s), None
        except ValueError:
            return None, f"금액을 정수로 해석할 수 없습니다: {v!r}"
    return None, f"금액 타입 오류: {v!r}"


def fail(msg):
    print(f"[budget_calc] 오류: {msg}", file=sys.stderr)
    sys.exit(1)


# ───────────────────────── ① 추출 모드 ─────────────────────────

def extract_current(snap_path, year, out_path, seq=None, date=None):
    try:
        import yaml
    except ImportError:
        fail("--extract 는 pyyaml 이 필요합니다 (pip install pyyaml).")
    try:
        snap = yaml.safe_load(open(snap_path, "r", encoding="utf-8"))
    except Exception as e:
        fail(f"스냅샷 읽기 실패: {e}")

    meta = snap.get("meta", {}) or {}
    budget = snap.get("예산", {}) or {}
    unit = budget.get("단위", "천원")
    rows = budget.get("비목별", []) or []
    row = next((r for r in rows if str(r.get("연차")) == str(year)), None)
    if row is None:
        avail = ", ".join(str(r.get("연차")) for r in rows)
        fail(f"연차 '{year}' 의 비목별 항목이 스냅샷에 없습니다. 있는 연차: {avail}")

    direct = row.get("직접비", {}) or {}
    # 표준 비목을 순서대로 채우고 0원 생략분은 0으로 보정
    bomok_before = {}
    for k in BOMOK:
        bomok_before[k] = int(direct.get(k, 0) or 0)
    src_subtotal = direct.get("소계")
    calc_subtotal = sum(bomok_before.values())
    if src_subtotal is not None and int(src_subtotal) != calc_subtotal:
        # 스냅샷 소계와 비목 합이 다르면 경고(추출은 멈추지 않되, 스냅샷 값을 그대로 전달 →
        # 계산 단계 정합성 검증이 잡아 exit 2 로 차단한다)
        print(f"[budget_calc] 경고: 스냅샷 직접비 소계({src_subtotal}) ≠ 비목 합({calc_subtotal}). "
              f"계산 단계에서 정합성 오류로 차단됩니다.", file=sys.stderr)
    # 스냅샷의 소계·총액을 '그대로' 전달(재계산값으로 덮어쓰지 않음) — 오염 스냅샷을 계산단계가 감지하도록
    subtotal_field = int(src_subtotal) if src_subtotal is not None else calc_subtotal
    total_field = int(row["총액"]) if row.get("총액") is not None else subtotal_field + int(row.get("간접비", 0) or 0)

    scaffold = {
        "과제": meta.get("과제명", ""),
        "연차": str(year),
        "단위": unit,
        "회차": seq or "",
        "작성일": date or "",
        "품의서": None,
        # ↓ 사람이 채우는 칸: 어떤 비목 → 어떤 비목으로 얼마(천원). 여러 건 가능.
        "이동": [
            {"from": "", "to": "", "금액": 0}
        ],
        # ↓ 도출값(스냅샷에서 뽑은 현재값 — 편집 금지)
        "비목_전": bomok_before,
        "직접비_소계": subtotal_field,
        "간접비": int(row.get("간접비", 0) or 0),
        "총액": total_field,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(scaffold, f, ensure_ascii=False, indent=2)
    print(out_path)


# ───────────────────────── ② 계산 모드 ─────────────────────────

def compute(inp):
    unit = inp.get("단위", "천원")
    warnings = []
    errors = []

    before = {k: int(inp["비목_전"].get(k, 0) or 0) for k in BOMOK}
    subtotal_before = sum(before.values())          # 비목합 = 소계의 진리값
    indirect = int(inp.get("간접비", 0) or 0)
    # 스냅샷 정합성: 저장된 소계·총액이 비목합·(소계+간접비)와 어긋나면 입력이 오염된 것 → 오류(계산 중단)
    claimed_subtotal = inp.get("직접비_소계")
    if claimed_subtotal is not None and int(claimed_subtotal) != subtotal_before:
        errors.append(f"입력 직접비 소계({claimed_subtotal}) ≠ 비목 합({subtotal_before}) — 스냅샷/입력 정합성 오류.")
    total_before = int(inp.get("총액", subtotal_before + indirect))
    if total_before != subtotal_before + indirect:
        errors.append(f"입력 총액({total_before}) ≠ 직접비 소계({subtotal_before}) + 간접비({indirect}) — "
                      f"스냅샷/입력 정합성 오류.")
    moves = inp.get("이동", []) or []

    # 이동 정규화·검증 (표시명·yaml 키 모두 허용, 금액 안전 파싱)
    norm_moves = []
    for m in moves:
        frm = canon(m.get("from"))
        to = canon(m.get("to"))
        amt, amt_err = parse_amt(m.get("금액", 0))
        if (amt in (0, None)) and not frm and not to:
            continue  # 빈 scaffold 행 무시
        if amt_err:
            errors.append(amt_err)
            amt = 0
        if frm not in BOMOK:
            errors.append(f"출발 비목 '{frm}' 이(가) 표준 비목이 아닙니다: {BOMOK}")
        if to not in BOMOK:
            errors.append(f"도착 비목 '{to}' 이(가) 표준 비목이 아닙니다: {BOMOK}")
        if frm in BLOCKED or to in BLOCKED:
            errors.append(f"인건비는 이 스킬로 이동할 수 없습니다(개인별 재배분 필요 → /rnd-manpower-change). "
                          f"[{disp(frm)} → {disp(to)}]")
        if frm and frm == to:
            errors.append(f"출발·도착 비목이 같습니다: {disp(frm)}")
        if not amt_err and amt <= 0:
            errors.append(f"이동 금액은 양수여야 합니다: {disp(frm)}→{disp(to)} {amt}")
        norm_moves.append({"from": frm, "to": to, "금액": amt})

    # 후값 산출
    after = dict(before)
    for m in norm_moves:
        if m["from"] in after:
            after[m["from"]] -= m["금액"]
        if m["to"] in after:
            after[m["to"]] += m["금액"]

    # 음수 검증(출발 비목이 이동액보다 작으면 불가)
    for k in BOMOK:
        if after[k] < 0:
            errors.append(f"'{disp(k)}' 이(가) 음수({after[k]})가 됩니다 — 이동 금액이 잔액을 초과.")

    subtotal_after = sum(after.values())
    total_after = subtotal_after + indirect

    # ─ 2-pass 재검산: 후값을 독립적으로 다시 합산해 불변식 확인 ─
    recheck_subtotal = sum(after[k] for k in BOMOK)
    recheck_total = recheck_subtotal + indirect
    subtotal_ok = (subtotal_after == subtotal_before) and (recheck_subtotal == subtotal_before)
    total_ok = (total_after == total_before) and (recheck_total == total_before)
    # 순이동 합이 0인지(들어온 만큼 나갔는지)도 교차확인
    net = {k: after[k] - before[k] for k in BOMOK}
    net_zero = (sum(net.values()) == 0)
    recheck_ok = subtotal_ok and total_ok and net_zero

    if not subtotal_ok:
        errors.append(f"직접비 소계가 바뀌었습니다: {subtotal_before} → {subtotal_after} "
                      f"(비목 간 이동은 소계를 바꾸지 않아야 함).")
    if not net_zero:
        errors.append(f"이동 순합이 0이 아닙니다(Σ증감={sum(net.values())}).")
    if not total_ok:
        errors.append(f"총액이 바뀌었습니다: {total_before} → {total_after} "
                      f"(비목 간 이동은 총액을 바꾸지 않아야 함).")
    if not recheck_ok:
        errors.append(f"2-pass 재검산 불일치(재검산 소계={recheck_subtotal}, 총액={recheck_total}).")

    ok = (not errors)

    # 결과 행 구성
    rows = []
    for k in BOMOK:
        if before[k] == 0 and after[k] == 0:
            continue  # 전·후 모두 0인 비목은 표에서 생략
        rows.append({
            "비목": k,
            "표시명": disp(k),
            "전": before[k],
            "후": after[k],
            "증감": after[k] - before[k],
        })

    result = {
        "과제": inp.get("과제", ""),
        "연차": inp.get("연차", ""),
        "단위": unit,
        "회차": inp.get("회차", ""),
        "작성일": inp.get("작성일", ""),
        "품의서": inp.get("품의서"),
        "이동": norm_moves,
        "비목행": rows,
        "직접비_소계": {"전": subtotal_before, "후": subtotal_after},
        "간접비": indirect,
        "총액": {"전": total_before, "후": total_after},
        "검증": {
            "소계_불변": subtotal_ok,
            "총액_불변": total_ok,
            "이동순합_0": net_zero,
            "재검산_일치": recheck_ok,
            "재검산_소계": recheck_subtotal,
            "재검산_총액": recheck_total,
        },
        "경고": warnings,
        "오류": errors,
        "ok": ok,
    }
    return result


# ───────────────────────── 산출물: YAML ─────────────────────────

def write_yaml_fragment(path, result):
    def line2(o):  # flow-style {전: .., 후: .., 증감: ..}
        return "{전: %d, 후: %d, 증감: %s%d}" % (o["전"], o["후"], "+" if o["증감"] > 0 else "", o["증감"])

    L = []
    L.append("# 연구개발비 비목 변경 전/후 비교 — budget_calc.py(rnd-budget-change) 산출")
    L.append("# 과제=%s · 연차=%s · 단위=%s · 소계불변=%s · 총액불변=%s"
             % (result["과제"], result["연차"], result["단위"],
                result["검증"]["소계_불변"], result["검증"]["총액_불변"]))
    L.append("# 확정 시(권장): 이 파일을 /rnd-kr-history 에 직접 입력 → budget 이력 적재(전→r0·후→새 rev) → (선택) 재생성 KR_<과제>_r<N>.yaml")
    L.append("#   대안: '후' 값을 스냅샷 예산.비목별[연차].직접비 에 수기 반영 → /rnd-kr-extract → /rnd-kr-history(스냅샷 diff)")
    L.append("연구개발비비목_변경비교:")
    L.append("  과제: %s" % result["과제"])
    L.append("  연차: %s" % result["연차"])
    L.append("  단위: %s" % result["단위"])
    L.append("  이동:")
    for m in result["이동"]:
        L.append("    - {from: %s, to: %s, 금액: %d}" % (disp(m["from"]), disp(m["to"]), m["금액"]))
    L.append("  직접비_소계: {전: %d, 후: %d}"
             % (result["직접비_소계"]["전"], result["직접비_소계"]["후"]))
    L.append("  간접비: %d" % result["간접비"])
    L.append("  총액: {전: %d, 후: %d}" % (result["총액"]["전"], result["총액"]["후"]))
    L.append("  비목:")
    for r in result["비목행"]:
        L.append("    - 비목: %s" % r["표시명"])
        L.append("      값: %s" % line2(r))
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


# ───────────────────────── 산출물: MD ─────────────────────────

def _num(n):
    return f"{n:,}"


def _signed(n):
    return ("+" if n > 0 else "") + f"{n:,}"


def write_md(path, result):
    unit = result["단위"]
    L = []
    L.append("# 연구개발비 비목 변경 현황")
    L.append("")
    # 1. 개요
    L.append("## 1. 개요")
    L.append("")
    L.append("| 항목 | 값 |")
    L.append("|:--|:--|")
    L.append(f"| 과제 | {result['과제']} |")
    L.append(f"| 연차 | {result['연차']} |")
    L.append(f"| 직접비 소계 (불변, {unit}) | {_num(result['직접비_소계']['전'])} |")
    L.append(f"| 간접비 (불변, {unit}) | {_num(result['간접비'])} |")
    L.append(f"| 연구개발비 총액 (불변, {unit}) | {_num(result['총액']['전'])} |")
    L.append("")
    # 2. 변경 요약
    L.append("## 2. 변경 요약")
    L.append("")
    for m in result["이동"]:
        L.append(f"- **{disp(m['from'])} → {disp(m['to'])}**: {_num(m['금액'])}{unit} 이동")
    L.append("")
    for r in result["비목행"]:
        if r["증감"] != 0:
            L.append(f"- {r['표시명']}: {_num(r['전'])} → {_num(r['후'])} "
                     f"(**{_signed(r['증감'])}**)")
    L.append("")
    # 3. 변경 내역
    L.append(f"## 3. 변경 내역 (전 → 후, 단위: {unit})")
    L.append("")
    L.append("| 비목 | 전 | 후 | 증감 |")
    L.append("|:--|--:|--:|--:|")
    for r in result["비목행"]:
        L.append(f"| {r['표시명']} | {_num(r['전'])} | {_num(r['후'])} | {_signed(r['증감'])} |")
    sub_d = result['직접비_소계']['후'] - result['직접비_소계']['전']
    tot_d = result['총액']['후'] - result['총액']['전']
    L.append(f"| **직접비 소계** | **{_num(result['직접비_소계']['전'])}** "
             f"| **{_num(result['직접비_소계']['후'])}** | {_signed(sub_d)} |")
    L.append(f"| 간접비 | {_num(result['간접비'])} | {_num(result['간접비'])} | 0 |")
    L.append(f"| **총액** | **{_num(result['총액']['전'])}** "
             f"| **{_num(result['총액']['후'])}** | {_signed(tot_d)} |")
    L.append("")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


# ───────────────────────── CLI ─────────────────────────

def _opt(args, name):
    if name in args:
        i = args.index(name)
        if i + 1 < len(args):
            return args[i + 1]
    return None


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return

    # ① 추출 모드
    if "--extract" in args:
        snap = _opt(args, "--extract")
        year = _opt(args, "--year")
        out = _opt(args, "-o") or _opt(args, "--out")
        if not snap or not year or not out:
            fail("--extract <스냅샷> --year <연차> -o <input.json> 가 모두 필요합니다.")
        extract_current(snap, year, out, seq=_opt(args, "--seq"), date=_opt(args, "--date"))
        return

    # ② 계산 모드
    pos = [a for a in args if not a.startswith("-")]
    # 옵션값으로 소비된 위치인자 제거
    consumed = set()
    for name in ("--yaml-out", "--md-out", "--year", "-o", "--out", "--seq", "--date"):
        v = _opt(args, name)
        if v is not None:
            consumed.add(v)
    pos = [a for a in pos if a not in consumed]
    if not pos:
        fail("입력 JSON 경로가 필요합니다.")
    src = pos[0]
    try:
        inp = json.load(sys.stdin) if src == "-" else json.load(open(src, "r", encoding="utf-8"))
    except Exception as e:
        fail(f"입력 JSON 읽기 실패: {e}")

    result = compute(inp)

    yaml_out = _opt(args, "--yaml-out")
    md_out = _opt(args, "--md-out")
    if yaml_out and result["ok"]:
        write_yaml_fragment(yaml_out, result)
        result["yaml_조각"] = yaml_out
    if md_out and result["ok"]:
        write_md(md_out, result)
        result["md_문서"] = md_out

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result["ok"]:
        sys.exit(2)


if __name__ == "__main__":
    main()
