# 코레일 공식 KTX 운임표(엑셀) → ktx-fares-official.yaml
#
# 코레일이 홈페이지에 올려 두는 "KTX 운임표" 엑셀(노선마다 시트 하나, 구간·일반실 운임·특실 운임/요금/계)을 읽어
# ktx-fares-official.yaml 을 통째로 다시 쓴다. 운임이 바뀌어 코레일이 새 표를 올리면 이것을 다시 돌린다.
# 손으로 고친 구간은 ktx-fares.yaml 에 따로 있어서 이것을 다시 돌려도 지워지지 않는다.
#
#   uv run --with xlrd tools/import-ktx-fares.py <내려받은 xls> [--basis 2026-09-01] [--source <엑셀 주소>]
#   node tools/gen-travel.mjs            # 이어서 src/travelspec.js 를 다시 만든다
#
# --basis(운임 기준일)·--source(엑셀을 받은 주소)를 주지 않으면 지금 파일에 적힌 값을 그대로 둔다.
#
# 고르는 규칙
# - **특실이 있는 시트만** 읽는다(KTX·KTX-산천이 다니는 노선). 특실 칸이 없는 시트(KTX-이음이 다니는 강릉·중앙·중부내륙·동해선 —
#   우등실만 있고 "현재운임/속도 향상 시" 두 벌이다)는 넘긴다. 넘긴 시트는 끝에 알려 준다.
# - 같은 두 역이 여러 시트에 나오면(경유하는 길마다 값이 다르다) **일반실 운임이 가장 큰 줄**을 그 구간의 정가로 본다 —
#   서대구·구포·수원·서대전을 도는 열차는 더 싸고, 그 차이는 사후정산 때 실제 탄 열차의 값으로 바로잡는다.
# - 특실은 그 줄의 "계"(운임 + 특실 요금)다.

import datetime
import re
import sys
from pathlib import Path

import xlrd

TARGET = Path(__file__).resolve().parent.parent / 'references' / 'ktx-fares-official.yaml'

HEAD = '''# ktx-fares-official.yaml — 코레일 공식 KTX 운임표에서 가져온 구간 운임(어른 편도 정가, 원).
#
# **생성물이다 — 손으로 고치지 않는다.** tools/import-ktx-fares.py 가 코레일의 엑셀에서 통째로 다시 쓴다.
# 값을 고치거나 구간을 더하려면 **ktx-fares.yaml** 에 그 구간을 한 줄 적는다 — 그쪽이 이긴다.
#
# standard = 일반실 운임, first = 특실(운임 + 특실 요금). 구간은 방향이 없다(a↔b). 같은 두 역을 잇는 길이 여럿이면
# 일반실 운임이 가장 큰 값(고속선을 곧장 가는 길)이다. 특실이 없는 노선(KTX-이음: 강릉·중앙·중부내륙·동해선)은 없다.
'''


def read(path):
    """시트마다 (a, b, 일반실, 특실 계) 를 읽는다. 특실 칸이 없는 시트 이름은 따로 돌려준다."""
    book = xlrd.open_workbook(path)
    rows, skipped = [], []
    for sh in book.sheets():
        cell = lambda r, c: sh.cell_value(r, c)
        head = next((r for r in range(sh.nrows) if any('일반실' in str(cell(r, c)) for c in range(sh.ncols))), None)
        if head is None:
            skipped.append(sh.name)
            continue
        std = next(c for c in range(sh.ncols) if '일반실' in str(cell(head, c)))
        first = next((c for c in range(sh.ncols) if re.sub(r'\s', '', str(cell(head, c))) == '특실'), None)
        if first is None:
            skipped.append(sh.name)
            continue
        total = next(c for c in range(first, sh.ncols) if str(cell(head + 1, c)).strip() == '계')
        for r in range(head + 2, sh.nrows):
            a, b = str(cell(r, 1)).strip(), str(cell(r, 2)).strip()
            if a and b and isinstance(cell(r, std), float) and isinstance(cell(r, total), float):
                rows.append((sh.name.strip(), a, b, int(cell(r, std)), int(cell(r, total))))
    return rows, skipped


def pick(rows):
    """두 역마다 일반실 운임이 가장 큰 줄 하나. 처음 나온 차례(시트 차례)를 지킨다."""
    best = {}
    for sheet, a, b, standard, first in rows:
        key = tuple(sorted((a, b)))
        if key not in best:
            best[key] = [sheet, a, b, standard, first]
        elif (standard, first) > (best[key][3], best[key][4]):
            best[key][3:] = [standard, first]
    return list(best.values())


def render(routes):
    out, sheet = [], None
    for name, a, b, standard, first in routes:
        if name != sheet:
            out.append(f'  # {name}')
            sheet = name
        out.append(f'  - {{ a: {a}, b: {b}, standard: {standard}, first: {first} }}')
    return out


def kept(key):
    """지금 파일에 적힌 basis·source 값. 없으면 빈 글."""
    if not TARGET.exists():
        return ''
    m = re.search(rf'^{key}: "(.*)"$', TARGET.read_text(encoding='utf-8'), re.M)
    return m.group(1) if m else ''


def option(name):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else ''


def main():
    sys.stdout.reconfigure(encoding='utf-8')   # 윈도우 콘솔(cp1252·cp949)에서도 한글 안내가 깨지지 않게
    if len(sys.argv) < 2 or sys.argv[1].startswith('--'):
        sys.exit('쓰는 법: uv run --with xlrd tools/import-ktx-fares.py <KTX 운임표 xls> [--basis YYYY-MM-DD] [--source <주소>]')
    rows, skipped = read(sys.argv[1])
    routes = pick(rows)
    lines = [
        HEAD,
        f'basis: "{option("--basis") or kept("basis")}"',
        f'source: "{option("--source") or kept("source")}"',
        f'imported: "{datetime.date.today().isoformat()}"',
        '',
        'routes:',
        *render(routes),
        '',
    ]
    TARGET.write_text('\n'.join(lines), encoding='utf-8', newline='\n')
    stations = {s for r in routes for s in r[1:3]}
    print(f'구간 {len(routes)}개(역 {len(stations)}곳)를 {TARGET.name} 에 적었습니다. 읽은 줄 {len(rows)}개.')
    if skipped:
        print('특실이 없어 넘긴 시트: ' + ' / '.join(skipped))


if __name__ == '__main__':
    main()
