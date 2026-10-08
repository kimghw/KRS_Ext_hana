#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
manpower_calc.py — 참여연구원 변경 인건비 재배분 계산기 (rnd-manpower-change)

목적
  참여연구원 교체(추가/삭제)·참여기간·참여율 변경이 생겨도, 해당 연차의
  '총 인건비'를 고정한 채 변경되지 않은 참여연구원(조정 대상 1~2명)의
  계상률·계상인건비를 재배분해 총액을 '정확히' 일치시킨다.

계산 기준 — rerp(회사 연구개발 관리 시스템) 방식
  월급여      = 급여총액 / 12 → 천원 자리에서 절삭(내림). 평균급여이므로
               단축근무·단기휴가 등으로 실급여가 달라질 때만 참여자별 '월급여' override.
  계상인건비   = 월급여(절삭) × 참여기간_개월 × (계상률/100) → 천원 절삭.
               단, 역산 참여율(소수 3자리 올림)이 '요청 참여율'을 넘지 않도록 보정(−1천원 루프).
  월별 인건비  = 계상인건비를 참여기간으로 나눠 1..N−1월 = 천단위 올림(ceil),
               마지막 월 = 잔액(총액 − 앞월 합). 월별 합 = 계상인건비 정확 일치.
  월 참여율    = 월 인건비 / 월급여 × 100 → 소수점 3자리에서 0 초과 시 올림(소수 2자리). 표시용.
  최종 계상률  = 계상인건비 / 총 지급한도(월급여 × 개월) × 100 → 소수점 3자리에서 올림 — 공문 표기값.
               (월 참여율 '평균' 방식 아님 — 총 지급한도 대비 지급금액 비율)
  단위: 천원

정책 (사용자 결정)
  - 참여율(계상률) 하한 = 10% (기본): 조정 후에도 누구도 10% 미만 금지.
  - 계상인건비는 천원 단위 '정수'. 배분에서 생기는 끝수(잔차)는
    조정연구원 중 1명에게 가산해 총액을 정확히 맞춘다 (소수점 회피).
  - 계상률은 정수% 강제 안 함 — 계상인건비(정수)가 1차, 계상률은 역산값(ceil2).
  - 산출 정보는 2가지: ① 공문용 = 참여율(전→후, 공문·변경안 문서 기재값)
    ② rerp용 = 월별인건비(월별 지급 관리·대사값). 둘 다 비교 YAML 에 담는다.

사용
  python manpower_calc.py <input.json> [--yaml-out <fragment.yaml>] [--md-out <doc.md>]
  python manpower_calc.py - < input.json            # stdin
  결과(JSON)를 stdout 으로 출력. --yaml-out 지정 시 새 인건비표 YAML 조각도 파일로 기록.

입력 JSON 스키마 (요지)
  {
    "과제": "...", "연차": "1차년도", "단위": "천원",
    "목표_총인건비": 31425,        # 인건비 변경 없으면 현재 비목별 인건비, 있으면 새 값
    "참여율_하한": 10,             # (선택) 기본 10
    "조정_배분": "비례",           # (선택) "비례"(기본, 현재 계상인건비 가중) | "균등"
    "참여자": [
      # 분류: 고정 | 조정 | 추가 | 삭제 | 변경
      {"성명":"이용우","급여총액":100000,"참여기간_개월":9,"계상률":15,"계상인건비":11250,
       "직위":"수석","국적":"한국","구분":"내부/기존","분류":"삭제","신규_참여기간_개월":4},
      {"성명":"김거화","급여총액":100000,"참여기간_개월":9,"계상률":20,"계상인건비":15000,"분류":"고정"},
      {"성명":"문창재","급여총액":69000,"참여기간_개월":9,"계상률":10,"계상인건비":5175,"분류":"조정"},
      {"성명":"박신규","급여총액":80000,"신규_참여기간_개월":5,"신규_계상률":15,"직위":"선임","분류":"추가"}
    ]
  }

  - 추가:  신규_참여기간_개월 · 신규_계상률 필수 (current 계상인건비는 0 취급).
  - 삭제:  신규_참여기간_개월 = 단축된 개월(완전 제외면 0). 단축분(이미 참여한 달)은
           '전 월별 배분' 금액을 그대로 유지(지급실적 기준). 신규_계상률 지정 시 그 률로 재계산.
  - 변경:  신규_참여기간_개월 / 신규_계상률 중 바뀐 것 지정(미지정 시 current 유지).
           '변경적용월'(YYYY-MM) 지정 시 중도 변경 — 그 월 이전은 전 월별 금액 유지,
           나머지 개월만 신규 계상률로 계산(요청 참여율 초과 금지 보장은 나머지 구간에 적용).
           '변경종료월'(YYYY-MM) 도 주면 구간 변경(예: 10월~12월) — [적용월, 종료월] 만
           신규률 적용, 종료월 이후 월은 전 금액으로 복귀.
  - 고정:  손대지 않음(current 그대로).
  - 조정:  잔차 흡수 대상(1~2명 권장). current 값으로 들어오고 결과에서 재계산됨.
  - 월급여(선택): 단축근무·단기휴가로 평균급여가 달라질 때만 참여자별 override(천원 정수).
"""
import sys
import json
import math

# Windows 콘솔(cp949)에서도 한글 JSON 이 깨지지 않게 UTF-8 강제
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

EPS = 1e-9


def floor_k(x):
    """천원 단위 절삭(내림). 부동소수 오차 보정."""
    return int(math.floor(x + EPS))


def ceil_k(x):
    """천원 단위 올림. 부동소수 오차 보정."""
    return int(math.ceil(x - EPS))


def ceil2(x):
    """참여율 표기 규칙: 소수점 3자리에서 0 초과 시 올림 → 소수 2자리."""
    if x is None:
        return None
    return math.ceil(round(x, 6) * 100 - EPS) / 100.0


def monthly_salary(salary, p=None):
    """월급여(천원) = 급여총액/12 천원 절삭. 참여자 '월급여' override(단축근무·단기휴가) 우선."""
    if p and p.get("월급여"):
        return int(p["월급여"])
    return floor_k(float(salary) / 12.0)


def accrued_rerp(msal, months, rate):
    """rerp 계상인건비: 월급여(절삭)×개월×률 → 천원 절삭.
    최종 계상률(총 지급한도 대비 비율의 ceil2)이 요청률(rate)을 넘지 않도록 −1천원 보정 루프(요청률 초과 금지)."""
    if months <= 0 or rate <= 0 or msal <= 0:
        return 0
    t = floor_k(msal * months * rate / 100.0)
    base = float(msal * months)
    while t > 0 and ceil2(t / base * 100.0) > rate + EPS:
        t -= 1
    return t


def monthly_split(total, months):
    """월별 배분: 1..N−1월 = ceil(총액/N)(천단위 올림), 마지막 월 = 잔액.
    극소액으로 잔액이 음수가 되면 floor 기반 배분으로 대체(안전장치). 합계 = 총액 보장."""
    if months <= 0:
        return []
    total = int(total)
    if total <= 0:
        return [0] * months
    per = ceil_k(total / months)
    last = total - per * (months - 1)
    if last < 0:
        base, rem = divmod(total, months)
        return [base + 1] * rem + [base] * (months - rem)
    return [per] * (months - 1) + [last]


def back_rate(accr, msal, months):
    """최종 계상률(rerp): 계상인건비 / 총 지급한도(월급여×개월) × 100 — 소수 3자리에서 올림(ceil2).
    (월 참여율 '평균' 방식 아님 — 총 지급한도 대비 지급금액 비율)"""
    base = msal * months
    if base <= 0:
        return None
    return ceil2(accr / base * 100.0)


def month_end(start, months):
    """시작월 + months - 1 (포함) 의 종료월 'YYYY-MM'. 실패 시 None."""
    try:
        y, m = (int(x) for x in str(start).split("-")[:2])
    except Exception:
        return None
    total = (y * 12 + (m - 1)) + (months - 1)
    ey, em = divmod(total, 12)
    return f"{ey:04d}-{em + 1:02d}"


def month_index(ym):
    """'YYYY-MM' → 절대 월 인덱스(비교용). 실패 시 None."""
    try:
        y, m = (int(x) for x in str(ym).split("-")[:2])
        return y * 12 + (m - 1)
    except Exception:
        return None


def month_labels(start, months):
    """시작월부터 months 개의 'YYYY-MM' 라벨. 시작월 없으면 'N월차' 라벨."""
    if months <= 0:
        return []
    idx = month_index(start)
    if idx is None:
        return [f"{i + 1}월차" for i in range(months)]
    out = []
    for i in range(months):
        y, m = divmod(idx + i, 12)
        out.append(f"{y:04d}-{m + 1:02d}")
    return out


def month_range(start, months):
    """참여기간을 '언제부터~언제까지(N개월)' 로. start='YYYY-MM', months=int.
    종료월 = 시작월 + months - 1 (포함). start 없으면 'N개월', months<=0 면 '제외'."""
    if not months or months <= 0:
        return "제외"
    if not start:
        return f"{months}개월"
    end = month_end(start, months)
    if not end:
        return f"{months}개월"
    return f"{start} ~ {end} ({months}개월)"


def fail(msg):
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False, indent=2))
    sys.exit(1)


def extract_current(snap_path, year, out_path, seq=None, date=None):
    """① 현재 데이터 추출: KR 스냅샷에서 해당 연차의 현재 참여자·목표인건비를 뽑아
    변경 입력 scaffold(JSON)를 만든다. 모든 참여자는 분류='고정'(미변경) 으로 시작 —
    사용자가 제외/추가/변경/조정 으로 바꾸고 신규_* 를 채우면 ② 계산 입력이 된다."""
    import re
    try:
        import yaml
    except Exception:
        fail("--extract 는 pyyaml 이 필요합니다 (pip install pyyaml).")
    try:
        snap = yaml.safe_load(open(snap_path, "r", encoding="utf-8"))
    except Exception as e:
        fail(f"스냅샷 로드 실패: {e}")

    meta = snap.get("meta", {}) or {}
    예산 = snap.get("예산", {}) or {}
    단위 = 예산.get("단위", "천원")
    pcs = 예산.get("참여연구자인건비", []) or []
    if not pcs:
        fail("스냅샷에 예산.참여연구자인건비 가 없습니다.")
    entry = next((e for e in pcs if str(e.get("연차")) == str(year)), None)
    if entry is None:
        if not year and len(pcs) == 1:
            entry = pcs[0]
            year = entry.get("연차")
        else:
            fail(f"연차 '{year}' 참여자 표를 못 찾음. 있는 연차: {[e.get('연차') for e in pcs]}")
    참여자 = entry.get("참여자", []) or []

    target = None
    for b in 예산.get("비목별", []) or []:
        if str(b.get("연차")) == str(year):
            target = (b.get("직접비", {}) or {}).get("인건비")
            break

    # 연차 시작월: 1차년도=전체 기간 시작월, 이후=해당 연도 1월
    sy, sm = 2026, 4
    period0 = str(meta.get("기간", "")).split("~")[0].strip()
    if "-" in period0:
        try:
            sy, sm = (int(x) for x in period0.split("-")[:2])
        except Exception:
            pass
    n = 1
    mo = re.match(r"(\d+)", str(year or ""))
    if mo:
        n = int(mo.group(1))
    ystart = f"{sy:04d}-{sm:02d}" if n == 1 else f"{sy + (n - 1):04d}-01"

    people = []
    for p in 참여자:
        months = int(p.get("참여기간_개월", 0) or 0)
        rec = {"성명": p.get("성명"),
               "급여총액": p.get("급여총액", 0),
               "참여기간_개월": months,
               "계상률": p.get("계상률", 0),
               "계상인건비": p.get("계상인건비", 0)}
        for k in ("국적", "직위", "구분", "역할"):
            if p.get(k) is not None:
                rec[k] = p[k]
        rec.setdefault("역할", "연구원")   # 과제책임자(아래 top-level)로 지정되면 계산 시 '과제책임자'로 바뀜
        rec["참여시작"] = ystart
        if months:
            rec["참여종료"] = month_end(ystart, months)
        rec["분류"] = "고정"
        people.append(rec)

    scaffold = {
        "과제": meta.get("과제명", ""),
        "과제책임자": "",   # KR 과제 책임자 성명 — 채우면 해당자가 YAML 에 역할='과제책임자'로 표기(나머지='연구원')
        "연차": year,
        "단위": 단위,
        "목표_총인건비": target if target is not None else 0,
        "회차": seq or "01",
        "작성일": date or "",
        "인건비_변경": (f"없음 (현재 비목별 인건비 {target}천원 유지)"
                    if target is not None else "없음 (현재값 유지)"),
        "참여율_하한": 10,
        "조정_배분": "비례",
        "_안내": ("분류를 제외/추가/변경/조정 으로 바꾸고 신규_*(신규_참여기간_개월·신규_계상률) 를 채운 뒤 "
                "manpower_calc.py 로 계산하세요. 고정=미변경. 인건비 변경 시 목표_총인건비·인건비_변경 수정. "
                "중도(월 중간) 참여율 변경은 해당 참여자에 변경적용월(YYYY-MM) 추가, 구간 변경(예: 10월~12월)은 변경종료월(YYYY-MM)도 추가. "
                "단축근무·단기휴가로 평균급여가 달라지면 그 참여자에 월급여(천원) override. "
                "과제책임자 에 KR 책임자 성명을 넣으면 YAML 에 역할='과제책임자'로 표기."),
        "참여자": people,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(scaffold, f, ensure_ascii=False, indent=2)
    print(json.dumps({"ok": True, "extract": out_path, "연차": year,
                      "참여자수": len(people), "목표_총인건비": target},
                     ensure_ascii=False, indent=2))


def extract_prev(prev_path, out_path, seq=None, date=None):
    """①' 연쇄 변경 추출: 직전 rev 의 변경비교 YAML(참여연구자인건비_*.yaml)에서 '후' 값과
    월별인건비(실제 월별 지급액)를 새 입력의 '전'(현재) 상태로 뽑아 scaffold 를 만든다.
    일부 참여자의 참여율·월별인건비만 구간 변경(예: 10월~12월 김거화↓·문창재↑)하는
    다음 회차 계산의 입력 — 기지급 월은 '월별' 실적으로 정확히 보존된다. 제외자는 승계 제외."""
    try:
        import yaml
    except Exception:
        fail("--extract-prev 는 pyyaml 이 필요합니다 (pip install pyyaml).")
    try:
        doc = yaml.safe_load(open(prev_path, "r", encoding="utf-8"))
    except Exception as e:
        fail(f"이전 변경비교 YAML 로드 실패: {e}")
    data = (doc or {}).get("참여연구자인건비_변경비교")
    if not data:
        fail("참여연구자인건비_변경비교 최상위 키가 없습니다 (rnd-manpower-change 산출 YAML 인지 확인).")
    people = []
    for pt in data.get("참여자", []) or []:
        post = pt.get("후", {}) or {}
        months = int(post.get("참여기간_개월", 0) or 0)
        if months <= 0 or pt.get("status") == "제외":
            continue   # 제외자는 다음 회차로 승계하지 않음
        rec = {"성명": pt.get("성명"), "급여총액": pt.get("급여총액", 0),
               "참여기간_개월": months,
               "계상률": post.get("계상률", 0),
               "계상인건비": post.get("계상인건비", 0)}
        if pt.get("월급여"):
            rec["월급여"] = int(pt["월급여"])
        for k in ("국적", "직위", "구분", "역할"):
            if pt.get(k) is not None:
                rec[k] = pt[k]
        start = str(post.get("참여기간", "")).split("~")[0].strip()
        if "-" in start:
            rec["참여시작"] = start
            rec["참여종료"] = month_end(start, months)
        mb = [e.get("계상") for e in pt.get("월별인건비", []) or []]
        if mb and all(v is not None for v in mb):
            rec["월별"] = [int(v) for v in mb]   # 직전 rev 의 실제 월별 지급액(기지급 보존용)
        rec["분류"] = "고정"
        people.append(rec)
    if not people:
        fail("승계할 참여자(후 참여기간 > 0)가 없습니다.")
    prev_seq = str(data.get("회차", "") or "")
    if not seq:
        seq = f"{int(prev_seq) + 1:02d}" if prev_seq.isdigit() else "02"
    소계 = data.get("소계", {}) or {}
    target = data.get("목표_총인건비", 소계.get("후", 0))
    scaffold = {
        "과제": data.get("과제", ""),
        "과제책임자": data.get("과제책임자", ""),
        "연차": data.get("연차", ""),
        "단위": data.get("단위", "천원"),
        "목표_총인건비": target,
        "회차": seq,
        "작성일": date or "",
        "인건비_변경": f"없음 (현재 총 인건비 {target}천원 유지)",
        "참여율_하한": 10,
        "조정_배분": "비례",
        "_안내": ("직전 rev 승계본(전=직전 rev 의 후, 월별=실제 지급액). 분류를 변경/조정 으로 바꾸고 "
                "구간 변경은 변경적용월(~변경종료월)을 지정하세요 — 구간 밖 기지급 월은 자동 보존. "
                "조정 참여자에도 변경적용월을 주면 '남은 금액'만 잔여 구간에 재배분됩니다."),
        "참여자": people,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(scaffold, f, ensure_ascii=False, indent=2)
    print(json.dumps({"ok": True, "extract_prev": out_path, "회차": seq,
                      "참여자수": len(people), "목표_총인건비": target},
                     ensure_ascii=False, indent=2))


def _opt(args, name):
    """args 에서 `name <값>` 을 빼내 값 반환(없으면 None)."""
    if name in args:
        i = args.index(name)
        try:
            v = args[i + 1]
        except IndexError:
            fail(f"{name} 다음에 값이 필요합니다.")
        del args[i:i + 2]
        return v
    return None


def compute_after(p, msal, cur_months, cur_rate, cur_accr, pre_monthly, floor, warnings):
    """분류별 '후' 값(개월·표기 계상률·요청률·계상인건비·월별)을 결정론 계산.
    1-pass 와 2-pass(재검산)가 같은 함수를 호출해 교차검증한다.
    반환: (months, disp_rate, req_rate, accr, monthly, status) — 조정 분류는 다루지 않음."""
    name = p.get("성명", "?")
    cat = p.get("분류", "고정")

    if cat == "고정":
        return (cur_months, cur_rate, None, cur_accr, list(pre_monthly), "활성")

    if cat == "추가":
        months = int(p.get("신규_참여기간_개월", 0) or 0)
        rate = float(p.get("신규_계상률", 0) or 0)
        if months <= 0 or rate <= 0:
            fail(f"[{name}] 추가는 신규_참여기간_개월·신규_계상률 필수.")
        accr = accrued_rerp(msal, months, rate)
        monthly = monthly_split(accr, months)
        return (months, back_rate(accr, msal, months), rate, accr, monthly, "신규")

    if cat in ("삭제", "제외"):
        months = int(p.get("신규_참여기간_개월", 0) or 0)   # 단축 개월 (0=완전 제외)
        if months <= 0:
            return (0, 0, None, 0, [], "제외")
        if months > cur_months:
            fail(f"[{name}] 제외/단축 개월({months})이 현재 참여기간({cur_months})보다 큽니다.")
        if p.get("신규_계상률") is not None:
            rate = float(p["신규_계상률"])
            accr = accrued_rerp(msal, months, rate)
            monthly = monthly_split(accr, months)
            return (months, back_rate(accr, msal, months), rate, accr, monthly, "활성")
        # 신규 계상률 없음 → 이미 참여한 단축분은 '전 월별 배분' 금액 유지(지급실적 기준)
        kept = list(pre_monthly[:months])
        return (months, cur_rate, None, sum(kept), kept, "활성")

    if cat == "변경":
        months = int(p.get("신규_참여기간_개월", cur_months) or cur_months)
        rate = float(p.get("신규_계상률", cur_rate) or cur_rate)
        apply_ym = p.get("변경적용월")
        end_ym = p.get("변경종료월")
        if apply_ym or end_ym:
            # 구간 변경(예: 10월~12월): [적용월, 종료월] 구간만 신규률로 계산,
            # 구간 밖(앞·뒤)은 전 월별 금액 유지. 종료월 없으면 참여기간 끝까지, 적용월 없으면 참여시작부터.
            si = month_index(p.get("참여시작"))
            ai = month_index(apply_ym) if apply_ym else si
            ei = month_index(end_ym) if end_ym else (si + months - 1 if si is not None else None)
            if si is None or ai is None or ei is None:
                fail(f"[{name}] 구간 변경에는 참여시작·변경적용월/변경종료월(YYYY-MM)이 필요합니다.")
            k1 = ai - si              # 구간 앞 유지 개월
            n_chg = ei - ai + 1       # 변경 구간 개월
            if k1 < 0 or n_chg < 1 or k1 + n_chg > months:
                fail(f"[{name}] 변경 구간({apply_ym or '시작'}~{end_ym or '끝'})이 참여기간({months}개월)을 벗어남.")
            kept = list(pre_monthly[:k1])
            tail = list(pre_monthly[k1 + n_chg:months])   # 구간 뒤 유지 개월(전 금액 복귀)
            seg_accr = accrued_rerp(msal, n_chg, rate)    # 변경 구간분 — 요청률 초과 금지 보장
            monthly = kept + monthly_split(seg_accr, n_chg) + tail
            accr = sum(monthly)
            return (months, back_rate(accr, msal, months), rate, accr, monthly, "활성")
        accr = accrued_rerp(msal, months, rate)
        monthly = monthly_split(accr, months)
        return (months, back_rate(accr, msal, months), rate, accr, monthly, "활성")

    fail(f"[{name}] 알 수 없는 분류: {cat}")


def main():
    args = sys.argv[1:]
    yaml_out = _opt(args, "--yaml-out")
    md_out = _opt(args, "--md-out")
    extract_snap = _opt(args, "--extract")
    extract_prev_yaml = _opt(args, "--extract-prev")
    year = _opt(args, "--year")
    out_json = _opt(args, "-o") or _opt(args, "--out")
    seq = _opt(args, "--seq")
    date = _opt(args, "--date")

    # ① 추출 모드: 스냅샷(KR_*.yaml)에서 해당 연차 현재 참여자·목표인건비를 뽑아
    #    '변경 입력 scaffold'(분류=고정) 생성. 사용자가 분류·신규_* 만 고쳐 ②계산으로.
    if extract_snap:
        if not out_json:
            fail("--extract 에는 -o <현재.json> 출력 경로가 필요합니다.")
        extract_current(extract_snap, year, out_json, seq, date)
        return

    # ①' 연쇄 변경 추출 모드: 직전 rev 변경비교 YAML → 다음 회차 입력 scaffold
    #    (전 = 직전 rev 의 후, 월별 = 실제 지급액 — 일부 참여자만 구간 변경할 때 사용).
    if extract_prev_yaml:
        if not out_json:
            fail("--extract-prev 에는 -o <입력.json> 출력 경로가 필요합니다.")
        extract_prev(extract_prev_yaml, out_json, seq, date)
        return

    if not args:
        fail("입력 JSON 경로(또는 - for stdin)가 필요합니다.")
    src = args[0]
    try:
        raw = sys.stdin.read() if src == "-" else open(src, "r", encoding="utf-8").read()
        cfg = json.loads(raw)
    except Exception as e:
        fail(f"입력 JSON 로드 실패: {e}")

    unit = cfg.get("단위", "천원")
    year = cfg.get("연차", "")
    floor = float(cfg.get("참여율_하한", 10))
    mode = cfg.get("조정_배분", "비례")
    if "목표_총인건비" not in cfg:
        fail("목표_총인건비 가 필요합니다 (인건비 변경 없으면 현재 비목별 인건비).")
    target = int(cfg["목표_총인건비"])
    people = cfg.get("참여자", [])
    if not people:
        fail("참여자 목록이 비었습니다.")

    pi_name = cfg.get("과제책임자", "")   # 과제 책임자(성명). 해당자는 역할='과제책임자'

    warnings = []
    rows = []          # 결과 행
    fixed_sum = 0
    changed_sum = 0
    adjust_idx = []    # 조정 대상 인덱스

    for p in people:
        name = p.get("성명", "?")
        cat = p.get("분류", "고정")
        salary = float(p.get("급여총액", 0) or 0)
        msal = monthly_salary(salary, p)
        cur_months = int(p.get("참여기간_개월", 0) or 0)
        cur_rate = float(p.get("계상률", 0) or 0)
        cur_accr = int(p.get("계상인건비",
                             floor_k(msal * cur_months * cur_rate / 100.0)) or 0)
        # 전 월별: 입력에 '월별'(직전 rev 의 실제 월별 지급액)이 있으면 그대로 사용 —
        # 구간 변경이 누적된 연쇄 변경에서 기지급 실적을 정확히 보존한다. 없으면 표준 배분.
        pre_monthly = p.get("월별")
        if pre_monthly is not None:
            pre_monthly = [int(x) for x in pre_monthly]
            if len(pre_monthly) != cur_months or sum(pre_monthly) != cur_accr:
                fail(f"[{name}] 입력 월별({len(pre_monthly)}개월, 합 {sum(pre_monthly)})이 "
                     f"참여기간_개월({cur_months})·계상인건비({cur_accr})와 불일치.")
        else:
            pre_monthly = monthly_split(cur_accr, cur_months)

        row = {
            "성명": name, "분류": cat, "급여총액": salary, "월급여": msal,
            "전_참여기간_개월": cur_months, "전_계상률": cur_rate, "전_계상인건비": cur_accr,
            "전_월별": pre_monthly,
        }
        # 통과 필드(국적·직위·구분 등)
        for k in ("국적", "직위", "구분", "역할", "참여시작", "참여종료", "변경적용월", "변경종료월"):
            if k in p:
                row[k] = p[k]
        # 역할: top-level 과제책임자(성명) 지정 시 '과제책임자', 아니면 입력 역할 유지·없으면 '연구원'
        if pi_name and name == pi_name:
            row["역할"] = "과제책임자"
        elif "역할" not in row:
            row["역할"] = "연구원"
        # 후(변경 후) 참여 시작월: 신규_참여시작 우선, 없으면 기존 참여시작
        row["_참여시작_후"] = p.get("신규_참여시작", p.get("참여시작"))

        if cat == "조정":
            row.update(후_참여기간_개월=cur_months)  # 개월 불변, 계상률·인건비는 아래서 재계산
            adjust_idx.append(len(rows))
        else:
            months, disp_rate, req_rate, accr, monthly, st = compute_after(
                p, msal, cur_months, cur_rate, cur_accr, pre_monthly, floor, warnings)
            if cat in ("삭제", "제외"):
                row["분류"] = "제외"   # 표기는 '제외'로 통일(완전 하차/기간 단축)
            row.update(후_참여기간_개월=months, 후_계상률=disp_rate,
                       후_계상인건비=accr, 후_월별=monthly, status=st)
            if req_rate is not None:
                row["요청_계상률"] = req_rate
                if req_rate < floor:
                    warnings.append(f"[{name}] {row['분류']} 요청 계상률 {req_rate}% < 하한 {floor}%.")
            if cat == "고정":
                fixed_sum += accr
            else:
                changed_sum += accr

        rows.append(row)

    if not adjust_idx:
        fail("조정 대상(분류=조정)이 1명 이상 필요합니다. 총액을 맞출 흡수처가 없습니다.")

    # 조정 대상이 흡수해야 할 목표 합계
    adjust_target = target - fixed_sum - changed_sum
    if adjust_target < 0:
        warnings.append(
            f"조정 목표합계가 음수({adjust_target}). 변경/고정 합이 목표를 초과 — 변경안 재검토 필요.")

    # 비례(현재 계상인건비 가중) 또는 균등 배분, 끝수는 가중 최대 1명에 가산
    weights = [rows[i]["전_계상인건비"] for i in adjust_idx]
    W = sum(weights)
    n = len(adjust_idx)
    alloc = []
    if mode == "균등" or W <= 0:
        base = adjust_target // n
        alloc = [base] * n
    else:
        for w in weights:
            alloc.append(int(round(adjust_target * w / W)))
    # 끝수 보정 → 가중(현재 계상인건비) 최대인 조정연구원에 가산
    diff = adjust_target - sum(alloc)
    if diff != 0:
        big = max(range(n), key=lambda k: weights[k]) if W > 0 else 0
        alloc[big] += diff

    adjust_seg_neg = []   # 조정 구간 잔여액이 음수인 참여자(기지급이 배분액 초과)
    for k, idx in enumerate(adjust_idx):
        r = rows[idx]
        accr = alloc[k]
        months = r["후_참여기간_개월"]
        # 조정도 구간 지정 가능(변경적용월~변경종료월): 구간 밖 월은 전 월별(기지급) 고정,
        # 흡수 총액에서 기지급을 뺀 '남은 금액'만 구간 개월에 배분한다.
        apply_ym, end_ym = r.get("변경적용월"), r.get("변경종료월")
        if apply_ym or end_ym:
            si = month_index(r.get("참여시작"))
            ai = month_index(apply_ym) if apply_ym else si
            ei = month_index(end_ym) if end_ym else (si + months - 1 if si is not None else None)
            if si is None or ai is None or ei is None:
                fail(f"[{r['성명']}] 조정 구간에는 참여시작·변경적용월/변경종료월(YYYY-MM)이 필요합니다.")
            k1, n_chg = ai - si, ei - ai + 1
            if k1 < 0 or n_chg < 1 or k1 + n_chg > months:
                fail(f"[{r['성명']}] 조정 구간({apply_ym or '시작'}~{end_ym or '끝'})이 참여기간({months}개월)을 벗어남.")
            kept = list(r["전_월별"][:k1])
            tail = list(r["전_월별"][k1 + n_chg:months])
            seg = accr - sum(kept) - sum(tail)   # 남은 금액(잔여 구간 배분분)
            if seg < 0:
                adjust_seg_neg.append(r["성명"])
                warnings.append(
                    f"[{r['성명']}] 조정 구간 잔여액이 음수({seg}) — 기지급(구간 밖 {sum(kept) + sum(tail)})이 "
                    f"배분액({accr})을 초과. 구간·변경안 재검토.")
                seg = 0
            monthly = kept + monthly_split(seg, n_chg) + tail
        else:
            monthly = monthly_split(accr, months)
        # 최종 계상률 = 총 지급한도(월급여×개월) 대비 지급금액 비율의 ceil2.
        rate = back_rate(accr, r["월급여"], months)
        r["후_계상률"] = rate
        r["후_계상인건비"] = accr
        r["후_월별"] = monthly
        r["status"] = "활성"
        if rate is None:
            warnings.append(f"[{r['성명']}] 조정 계상률 역산 불가(급여총액/개월 확인).")
        elif rate < floor:
            warnings.append(
                f"[{r['성명']}] 조정 후 계상률 {rate}% < 하한 {floor}% — 조정 인원을 늘리거나 변경안 재검토.")
        elif rate > 100:
            warnings.append(
                f"[{r['성명']}] 조정 후 계상률 {rate}% > 100% — 조정 인원을 늘리세요.")

    total_after = sum(r["후_계상인건비"] for r in rows)
    ok_total = (total_after == target)
    if not ok_total:
        warnings.append(f"총액 불일치: 후 합계 {total_after} ≠ 목표 {target}.")

    floor_violations = [r["성명"] for r in rows
                        if r.get("후_계상률") is not None and 0 < r["후_계상률"] < floor]

    # 요청 참여율 초과 금지: 공문용(역산 ceil2) 참여율이 요청률을 넘으면 안 됨
    over_req = [r["성명"] for r in rows
                if r.get("요청_계상률") is not None and r.get("후_계상률") is not None
                and r["후_계상률"] > r["요청_계상률"] + EPS and "변경적용월" not in r]
    if over_req:
        warnings.append(f"요청 참여율 초과: {over_req} — accrued_rerp 보정 로직 점검.")

    # 재검산(2-pass): 금액을 한 번 더 독립 계산해 교차검증.
    #  - 합계를 다시 합산해 목표와 일치하는지
    #  - 공식 구동 행(고정/추가/변경/제외)은 compute_after 재호출 결과가 저장값과 정확히 일치하는지
    #    (조정 행은 잔차 흡수로 금액이 정해지므로 합계·월별합 검증으로 커버)
    #  - 모든 행의 월별 합 = 계상인건비 인지
    recheck_sum = 0
    recheck_mismatch = []
    monthly_mismatch = []
    for p, r in zip(people, rows):
        recheck_sum += r["후_계상인건비"]
        if sum(r["후_월별"]) != r["후_계상인건비"]:
            monthly_mismatch.append(f"{r['성명']}(후 월별합 {sum(r['후_월별'])}≠{r['후_계상인건비']})")
        if sum(r["전_월별"]) != r["전_계상인건비"]:
            monthly_mismatch.append(f"{r['성명']}(전 월별합 {sum(r['전_월별'])}≠{r['전_계상인건비']})")
        if p.get("분류", "고정") != "조정":
            _, _, _, accr2, monthly2, _ = compute_after(
                p, r["월급여"], r["전_참여기간_개월"], r["전_계상률"], r["전_계상인건비"],
                r["전_월별"], floor, [])
            if accr2 != r["후_계상인건비"] or monthly2 != r["후_월별"]:
                recheck_mismatch.append(f"{r['성명']}({accr2}≠{r['후_계상인건비']})")
    monthly_ok = not monthly_mismatch
    recheck_ok = (recheck_sum == target) and not recheck_mismatch
    if not recheck_ok:
        warnings.append(
            f"재검산 불일치: 재합산 {recheck_sum} vs 목표 {target}, 공식 {recheck_mismatch or '일치'}")
    if not monthly_ok:
        warnings.append(f"월별 배분 불일치: {monthly_mismatch}")

    # 월계상액(평균)·참여기간(언제부터~언제까지)·월별(라벨 병합: 전/후) 부가
    for r in rows:
        m = r.get("후_참여기간_개월", 0)
        r["후_월계상액"] = round(r["후_계상인건비"] / m, 2) if m else 0
        # 전 기간: 기존 참여시작 기준
        bm = r.get("전_참여기간_개월", 0)
        r["전_참여기간"] = month_range(r.get("참여시작"), bm) if bm else "-"
        # 후 기간: 제외면 '제외', 아니면 후 시작월 기준
        if r.get("status") == "제외" or not m:
            r["후_참여기간"] = "제외" if r.get("status") == "제외" else "-"
        else:
            r["후_참여기간"] = month_range(r.get("_참여시작_후"), m)
        # 월별 병합: {월: YYYY-MM, 전: n, 후: n} — 라벨 없으면 'N월차'
        merged = {}
        for lb, v in zip(month_labels(r.get("참여시작"), bm), r["전_월별"]):
            merged[lb] = {"월": lb, "전": v, "후": 0}
        for lb, v in zip(month_labels(r.get("_참여시작_후"), m), r["후_월별"]):
            merged.setdefault(lb, {"월": lb, "전": 0, "후": 0})["후"] = v
        r["월별"] = [merged[k] for k in sorted(merged)]
        # 매월 참여율: 월 인건비 / 월급여 × 100 — 참여율 규칙(소수 3자리 올림) 동일 적용
        for e in r["월별"]:
            e["참여율_전"] = ceil2(e["전"] / r["월급여"] * 100.0) if r["월급여"] and e["전"] else 0
            e["참여율_후"] = ceil2(e["후"] / r["월급여"] * 100.0) if r["월급여"] and e["후"] else 0
        # 변경 적용기간: 월별 전/후 금액이 달라진 첫 월 ~ 마지막 월 (참여연구자별 '언제부터 언제까지')
        diff_m = [e["월"] for e in r["월별"] if e["전"] != e["후"]]
        if diff_m:
            r["변경_적용기간"] = (diff_m[0] if len(diff_m) == 1
                              else f"{diff_m[0]} ~ {diff_m[-1]}") + f" ({len(diff_m)}개월)"
        else:
            r["변경_적용기간"] = "-"   # 금액 변동 없음
        r.pop("_참여시작_후", None)

    # 월별 소계(전/후) — 참여자 전원 합
    subtotal = {}
    for r in rows:
        for e in r["월별"]:
            s = subtotal.setdefault(e["월"], {"월": e["월"], "전": 0, "후": 0})
            s["전"] += e["전"]
            s["후"] += e["후"]
    monthly_subtotal = [subtotal[k] for k in sorted(subtotal)]

    # 공문용 참여율 요약(① 공문에 싣는 정보 — 전→후 참여율·참여기간)
    official = [{"성명": r["성명"], "역할": r.get("역할", "연구원"), "분류": r["분류"],
                 "전_계상률": r["전_계상률"], "후_계상률": r["후_계상률"],
                 "후_참여기간": r["후_참여기간"],
                 "변경_적용기간": r["변경_적용기간"]} for r in rows]

    result = {
        "ok": (ok_total and adjust_target >= 0 and not floor_violations
               and recheck_ok and monthly_ok and not over_req and not adjust_seg_neg),
        "과제": cfg.get("과제", ""),
        "과제책임자": pi_name,
        "회차": str(cfg.get("회차", "") or ""),
        "작성일": str(cfg.get("작성일", "") or ""),
        "연차": year, "단위": unit,
        "목표_총인건비": target,
        "고정_합계": fixed_sum,
        "변경_합계": changed_sum,
        "조정_목표합계": adjust_target,
        "후_총합계": total_after,
        "참여율_하한": floor,
        "조정_배분": mode,
        "조정_대상": [rows[i]["성명"] for i in adjust_idx],
        "공문용_참여율": official,
        "참여자": rows,
        "월별_소계": monthly_subtotal,
        "검증": {
            "총액_일치": ok_total,
            "조정목표_음수아님": adjust_target >= 0,
            "조정구간_음수아님": not adjust_seg_neg,
            "계상률_하한충족": not floor_violations,
            "계상률_하한위반": floor_violations,
            "요청참여율_이하": not over_req,
            "월별합_일치": monthly_ok,
            "재검산_합계": recheck_sum,
            "재검산_일치": recheck_ok,
        },
        "경고": warnings,
    }

    if yaml_out:
        write_yaml_fragment(yaml_out, result)
        result["yaml_조각"] = yaml_out
    if md_out:
        write_md(md_out, result, cfg)
        result["md_문서"] = md_out

    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result["ok"] else 2)


def _fmt_rate(v):
    if v is None:
        return "null"
    return str(int(v)) if float(v).is_integer() else str(v)


def _rate_pct(v):
    """표시용 계상률(%) — 0/None 은 '—'."""
    if v is None or v == 0:
        return "—"
    return f"{_fmt_rate(v)}%"


def _n(x):
    """천원 단위 정수 콤마 표기."""
    try:
        return f"{int(round(float(x))):,}"
    except Exception:
        return str(x)


def write_md(path, result, cfg):
    """변경안 .md 를 계산 결과(=YAML 과 동일 데이터)에서 직접 생성.
    제목 '참여연구원 변경 현황'(1회) + 1.개요(변경회차 행 없음) / 2.변경 요약 /
    3.변경 내역(전→후, 참여기간 몇월~몇월, 표 가운데 정렬) + rerp 계산기준 각주.
    (공문용 — 참여율 정보 중심. 월별 인건비(rerp용)는 비교 YAML 에만 싣는다)"""
    rows = result["참여자"]
    과제 = result.get("과제", "")
    연차 = result.get("연차", "")
    회차 = cfg.get("회차")
    작성일 = cfg.get("작성일")
    인건비_변경 = cfg.get("인건비_변경", "없음 (현재 비목별 인건비 유지)")

    by = lambda c: [r for r in rows if r["분류"] == c]
    제외, 추가, 변경, 조정, 고정 = by("제외"), by("추가"), by("변경"), by("조정"), by("고정")
    # 문서 표기 분류: 추가/제외/변경 3종(+미변경=유지). '조정'은 계상률이 바뀌므로 '변경'으로 표기.
    disp_cat = lambda c: {"조정": "변경", "고정": "유지"}.get(c, c)

    L = []
    L.append("# 참여연구원 변경 현황")
    L.append("")
    L.append("## 1. 개요")
    L.append("")
    L.append("| 항목 | 값 |")
    L.append("|:---:|:---:|")
    if 과제:
        L.append(f"| 과제 | {과제} |")
    L.append(f"| 연차 | {연차} |")
    L.append(f"| 목표 총인건비(천원) | {_n(result['목표_총인건비'])} |")
    L.append(f"| 인건비 변경 | {인건비_변경} |")
    L.append(f"| 참여율 하한 | {_fmt_rate(result.get('참여율_하한', 10))}% |")
    L.append("")

    L.append("## 2. 변경 요약")
    L.append("")
    def seg(label, items, fmt, show_empty=True):
        if not items and not show_empty:
            return
        L.append(f"- **{label}**: " + ("; ".join(fmt(r) for r in items) if items else "없음"))
    # 문서 표기는 추가/제외/변경 3종으로 단순화 — 계산상 '조정'(잔액 흡수)도 계상률이 바뀌므로
    # '변경'으로 묶고, 손대지 않은 '고정'만 '유지'로(있을 때만). 계산/YAML 분류는 원래대로 유지.
    def fmt_chg(r):
        base = f"{r['성명']} — 계상률 {_rate_pct(r['전_계상률'])} → {_rate_pct(r['후_계상률'])}"
        return base + (" (잔액 흡수)" if r["분류"] == "조정" else f" ({r['후_참여기간']})")
    seg("추가", 추가, lambda r: f"{r['성명']} — {r['후_참여기간']}, 계상률 {_rate_pct(r['후_계상률'])}, 급여총액 {_n(r['급여총액'])}")
    seg("제외", 제외, lambda r: f"{r['성명']} — 전 {r['전_참여기간']}/{_rate_pct(r['전_계상률'])} 에서 제외")
    seg("변경", 변경 + 조정, fmt_chg)
    seg("유지", 고정, lambda r: f"{r['성명']} (계상률 {_rate_pct(r['후_계상률'])} 유지)", show_empty=False)
    L.append("")

    L.append("## 3. 변경 내역 (전 → 후, 단위: 천원)")
    L.append("")
    # 성명·분류는 각각 별도 열, 계상률·계상인건비는 한 칸에 2줄(<br>)로 — PDF 너비 절약.
    L.append("| 성명 | 분류 | 전 참여기간 | 전 계상률 / 인건비 | 후 참여기간 | 후 계상률 / 인건비 | 변경 적용기간 |")
    L.append("|:---:|:---:|:---:|:---:|:---:|:---:|:---:|")
    sb = sa = 0
    for r in rows:
        sb += r["전_계상인건비"]; sa += r["후_계상인건비"]
        L.append(
            f"| {r['성명']} | {disp_cat(r['분류'])} | {r['전_참여기간']} "
            f"| {_rate_pct(r['전_계상률'])}<br>{_n(r['전_계상인건비'])} "
            f"| {r['후_참여기간']} "
            f"| {_rate_pct(r['후_계상률'])}<br>{_n(r['후_계상인건비'])} "
            f"| {r.get('변경_적용기간', '-')} |")
    L.append(f"| **합계** |  |  | **{_n(sb)}** |  | **{_n(sa)}** |  |")
    L.append("")
    L.append("> ※ 계산 기준(rerp): 월급여 = 급여총액/12(천원 절삭) · 계상률 = 소수점 3자리 올림 "
             "· 월별 인건비 = 앞월 천단위 올림, 마지막 월 잔액(월별 내역은 비교 YAML 참조).")
    L.append("")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


def write_yaml_fragment(path, result):
    """참여연구자인건비 변경 전/후 비교 YAML 생성(검토·기록용) — 2가지 정보를 담는다:
    ① 공문용_참여율(전→후 참여율, 공문·변경안 문서 기재값)
    ② 월별인건비(rerp 월별 지급 관리·대사값 — 참여자별 월별 전/후 + 월별_소계).
    각 참여자에 전/후 블록을 함께 싣고, 참여기간은 '언제부터~언제까지(N개월)' 로 표기.
    스냅샷 반영 시: 각 참여자의 '후' 값을 사용하고 status:제외 는 제거."""
    sub_before = sum(r["전_계상인건비"] for r in result["참여자"])
    sub_after = sum(r["후_계상인건비"] for r in result["참여자"])
    과제 = result.get("과제", "")
    lines = []
    lines.append("# rnd-manpower-change 산출 — 참여연구자인건비 변경 전/후 비교 (검토·기록용)")
    meta_bits = []
    if 과제:
        meta_bits.append(f"과제={과제}")
    meta_bits += [f"연차={result['연차']}", f"단위={result['단위']}",
                  f"목표총인건비={result['목표_총인건비']}", f"총액일치={result['검증']['총액_일치']}"]
    lines.append("# " + " · ".join(meta_bits))
    lines.append("# 계산 기준(rerp): 월급여=급여총액/12 천원 절삭 · 월 참여율=월 인건비/월급여×100 소수 3자리 올림(표시용)")
    lines.append("#   · 최종 계상률=계상인건비/총 지급한도(월급여×개월)×100 소수 3자리 올림(요청 참여율 초과 금지)")
    lines.append("#   · 월별인건비=계상인건비를 참여기간으로 나눠 앞월 천단위 올림, 마지막 월 잔액(합=계상인건비)")
    lines.append("# 정보 2종: ① 공문용_참여율 = 공문·변경안 문서 기재값(전→후 참여율)")
    lines.append("#          ② 참여자[].월별인건비 + 월별_소계 = rerp 월별 지급 관리·대사값(변경 후 기준 계상·참여율)")
    lines.append("# 스냅샷 반영 시: 각 참여자의 '후' 값(참여기간_개월·계상률·계상인건비)을 사용, status:제외 는 표에서 제거")
    lines.append("참여연구자인건비_변경비교:")
    if 과제:
        lines.append(f"  과제: {과제}")
    if result.get("과제책임자"):
        lines.append(f"  과제책임자: {result['과제책임자']}")
    lines.append(f"  연차: {result['연차']}")
    if result.get("회차"):
        lines.append(f"  회차: \"{result['회차']}\"   # 이 파일이 몇 번째 변경(rev)인지")
    if result.get("작성일"):
        lines.append(f"  작성일: \"{result['작성일']}\"")
    lines.append(f"  단위: {result['단위']}")
    lines.append(f"  목표_총인건비: {result['목표_총인건비']}")
    lines.append(f"  소계: {{전: {sub_before}, 후: {sub_after}}}")
    lines.append("  공문용_참여율:   # ① 공문용 — 변경 전→후 참여율(계상률, %) + 변경 적용기간(언제부터~언제까지)")
    for o in result.get("공문용_참여율", []):
        lines.append(
            f"    - {{성명: {o['성명']}, 역할: {o['역할']}, 분류: {o['분류']}, "
            f"전: {_fmt_rate(o['전_계상률'])}, 후: {_fmt_rate(o['후_계상률'])}, "
            f"참여기간_후: \"{o['후_참여기간']}\", 변경_적용기간: \"{o['변경_적용기간']}\"}}")
    lines.append("  참여자:")
    for r in result["참여자"]:
        lines.append(f"    - 성명: {r['성명']}")
        if "역할" in r:
            lines.append(f"      역할: {r['역할']}")
        if "직위" in r:
            lines.append(f"      직위: {r['직위']}")
        if "구분" in r:
            lines.append(f"      구분: {r['구분']}")
        lines.append(f"      급여총액: {int(r['급여총액'])}")
        lines.append(f"      월급여: {r['월급여']}   # 급여총액/12 천원 절삭(rerp)")
        lines.append(f"      분류: {r['분류']}")
        lines.append(f"      status: {r.get('status', '활성')}")
        if "변경적용월" in r:
            lines.append(f"      변경적용월: \"{r['변경적용월']}\"   # 이 월부터 신규 계상률 적용(이전 월은 전 금액 유지)")
        if "변경종료월" in r:
            lines.append(f"      변경종료월: \"{r['변경종료월']}\"   # 이 월까지만 적용(이후 월은 전 금액 복귀)")
        lines.append(f"      변경_적용기간: \"{r.get('변경_적용기간', '-')}\"   # 월별 전/후 금액이 달라진 기간(언제부터~언제까지)")
        if r.get("요청_계상률") is not None and r.get("후_계상률") != r["요청_계상률"]:
            lines.append(f"      요청_계상률: {_fmt_rate(r['요청_계상률'])}   # 사용자 요청값 — 후 계상률(역산·올림)은 이를 넘지 않음")
        lines.append(
            f"      전: {{참여기간: \"{r['전_참여기간']}\", 참여기간_개월: {r['전_참여기간_개월']}, "
            f"계상률: {_fmt_rate(r['전_계상률'])}, 계상인건비: {r['전_계상인건비']}}}")
        lines.append(
            f"      후: {{참여기간: \"{r['후_참여기간']}\", 참여기간_개월: {r['후_참여기간_개월']}, "
            f"계상률: {_fmt_rate(r['후_계상률'])}, 계상인건비: {r['후_계상인건비']}}}")
        # 월별은 '변경 후' 기준만 기록(전/후 비교는 위의 전/후 블록이 담당). 제외자(후 0)는 생략.
        # 이번 회차에 금액이 바뀐 월만 '변경전:' 을 덧붙여 월별 변경 내역을 표시.
        post_months = [e for e in r.get("월별", []) if e["후"] > 0]
        if post_months:
            rev = result.get("회차", "")
            lines.append("      월별인건비:   # ② rerp용 — 변경 후 월별 계상액·월 참여율(계상 합=계상인건비, 참여율=소수 3자리 올림) · 이번에 바뀐 월엔 rev 주석")
            for e in post_months:
                changed = e["전"] != e["후"]
                note = (f"   # rev{rev} 변경" if rev else "   # 변경") if changed else ""
                lines.append(
                    f"        - {{월: \"{e['월']}\", 계상: {e['후']}, 참여율: {_fmt_rate(e['참여율_후'])}}}{note}")
    if result.get("월별_소계"):
        lines.append("  월별_소계:   # ② rerp용 — 변경 후 참여자 전원 월별 계상 합(합계=소계 '후')")
        for e in result["월별_소계"]:
            lines.append(f"    - {{월: \"{e['월']}\", 계상: {e['후']}}}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
