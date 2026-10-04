---
name: refdata
description: KRS WORKSPACE 확장이 참조하는 데이터(references/ — KTX 운임표·항공 마일리지 표·여비 규칙·입력 명세)의 현황 점검과, 밖에서 가져오는 데이터 다시 가져오기. 인자 없으면 현황표(기준일·가져온 날·원본과 맞춰 본 날·생성물 일치)를 출력하고 다음 할 일을 짚어준다. 코레일 KTX 운임표 다시 가져오기(ktx)·항공 마일리지 표를 원본과 맞춰 보기(mileage)·생성물 다시 만들기(gen)·어긋났는지 보기(check)·사이트 화면 캡처 다시 받기(capture). 조작은 tools/refdata.mjs 로 위임한다. TRIGGER when 사용자가 /refdata 호출, KTX 운임이 바뀌었다·운임표를 다시 가져와 달라, 마일리지 표 확인·갱신, 참조 데이터가 최신인지·맞는지 확인, references 의 YAML 을 고친 뒤 생성물 다시 만들기, 사이트 화면이 바뀌어 캡처를 다시 받아야 한다. DO NOT TRIGGER when 여비계산서 작성·송부 같은 확장 기능의 버그, Gmail 에서 증빙 찾기(/gmail), 로컬 CLI 다리(/bridge).
allowed-tools: Bash Read Edit WebSearch WebFetch AskUserQuestion
argument-hint: "[status|ktx [<xls 경로|주소>] [--basis <날짜>] [--dry-run]|mileage|gen|check|capture]"
---

# refdata — 참조 데이터 점검과 밖에서 가져오기

확장은 YAML 을 읽지 못한다. `references/` 의 YAML 이 원본이고, 생성기가 그것을 `src/*spec.js`(확장이 쓰는 값)와
`references/review.md`(사람이 읽는 검토표)로 옮긴다. 이 스킬은 그 가운데 **밖에서 오는 데이터**를 다시 가져오고, 전체가 최신인지 본다.

호출: `node tools/refdata.mjs <인자>` (저장소 폴더에서). 사람이 파일을 고치는 길은 `references/README.md` 에 있다.

## 밖에서 오는 것

| 데이터 | 원본 | 들어가는 곳 | 받는 길 |
|:---|:---|:---|:---|
| KTX 공식 운임(일반실·특실) | 코레일이 홈페이지에 올려 둔 엑셀(공개 문서) | `references/ktx-fares-official.yaml` | **자동** — `ktx` 가 받아서 가져오고 생성물까지 다시 만든다 |
| 항공 마일리지(구간 마일·적립률) | 대한항공 스카이패스 안내 페이지 | `references/air-mileage.yaml` | **사람이 맞춰 본다** — 그 페이지가 자동 접근을 막는다(2026-10-04). `mileage` 가 맞춰 볼 표를 찍는다 |
| 사이트 화면(회의실·차량 목록, 차량 신청 폼) | eclass(로그인 필요) | `test/fixtures/*.html` | **사람이 브라우저에서 받는다** — 아래 "화면 캡처" |

밖에서 오지 않는 것 — 여비 규칙(`travel-rules.yaml`), 도시→역·갈아타는 역·소요 시간(`ktx-fares.yaml`), 입력 명세(`input.yaml`) — 은
사용자가 정해 손으로 고치는 값이다. 이 스킬은 `gen`·`check` 로 생성물만 맞춘다.

## 인자 분기 (`$ARGUMENTS`)

| 인자 | 동작 |
|:---|:---|
| (없음) 또는 `status` | 현황표 + 다음 할 일. **먼저 이것부터 돌린다.** 네트워크를 쓰지 않는다 |
| `ktx --dry-run` | 지금 적힌 주소의 엑셀을 다시 받아 **달라졌는지만** 본다(쓰지 않는다) |
| `ktx` | 지금 적힌 주소에서 다시 받아 가져온다 → `gen-travel` → 바뀐 것 요약 |
| `ktx <주소> --basis <YYYY-MM-DD>` | 코레일이 새 표를 올렸을 때. 새 주소에는 **운임 기준일이 꼭 있어야** 한다(없으면 멈춘다) |
| `ktx <xls 경로>` | 이미 내려받은 파일로. 주소·기준일은 지금 적힌 것을 그대로 둔다(`--basis` 로 바꾼다) |
| `mileage` | 항공 마일리지 표를 원본과 맞춰 볼 수 있게 찍는다(구간 마일, 일반석·특실 적립) |
| `gen` | 두 생성기를 돌린다 — YAML 을 고친 뒤(`npm run gen` 과 같다). 무엇이 바뀌었는지 말해 준다 |
| `check` | 생성물이 YAML 과 어긋났는지만 본다(`npm run check` 와 같다) |
| `capture` | 스크립트가 없다 — 아래 "화면 캡처" 절차를 사용자에게 안내한다 |

## 절차

### KTX 운임표 (`ktx`)

1. **`ktx --dry-run`** — "구간·운임이 모두 같습니다" 면 끝이다. 받지 못하면(HTTP 오류·엑셀이 아님) 코레일이 주소를 바꾼 것이다 → 2.
2. **새 주소 찾기.** 코레일은 운임이 바뀌면 새 엑셀을 새 주소(`…/file/cubedata/COMMON/jfile/<올린 달>/<날>/<이름>.xls`)로 올린다.
   WebSearch 로 "코레일 KTX 운임표 엑셀"을 찾거나 코레일 홈페이지의 운임·요금 안내에서 "KTX 운임표" 첨부를 찾는다
   (공공데이터포털 `data.go.kr/data/15052168` 에도 같은 이름의 자료가 있다 — 2026-10-04 에 검색으로 보기만 했고 받아 본 적은 없다).
   못 찾으면 사용자에게 주소나 내려받은 파일을 달라고 한다. **운임 기준일**(새 운임이 시행되는 날)도 같이 확인한다.
3. **`ktx <새 주소> --basis <기준일>`** — 받기 → `tools/import-ktx-fares.py`(지금 표와 다른 구간을 먼저 찍는다) → `gen-travel`(바뀐 것 요약).
4. **`npm test`.** 실제 운임을 기대값으로 적어 둔 테스트(`test/travel`·`tripcard`·`wiring`·`routes`·`routecard`·`after`·`lodgeask`·`preconfirm`)가
   깨지면 기대값을 새 운임으로 고친다 — 운임이 바뀐 것이지 코드가 틀린 것이 아니다.
5. `references/review.md` 에서 몇 구간을 원본 엑셀과 눈으로 맞춰 보고, README 의 운임 문구(기준일·구간 수·서울↔부산 값)를 고친다.

### 항공 마일리지 (`mileage`)

1. **`mileage`** 로 지금 표를 찍는다.
2. 원본 페이지(`air-mileage.yaml` 의 `source`)와 맞춰 본다. 자동 접근이 막혀 있으므로 사용자에게 그 페이지를 열어 국내선 구간 마일리지 표와
   적립률을 붙여 달라고 한다(WebFetch 는 한 번 해 볼 수 있다 — 2026-10-04 에는 막혔다).
3. 다른 줄은 `references/air-mileage.yaml` 에서 고치고, **맞춰 본 날을 `checked: "YYYY-MM-DD"` 에 적는다** → `gen`.
4. 다른 항공사를 더할 때도 같은 길이다 — `airlines` 에 같은 모양으로 더하고 `source` 를 주석으로 남긴다.

**맞춰 보지 않고 `checked` 를 채우지 않는다** — 검색에 잡힌 글만 보고 "맞다"고 적지 않는다. `null` 이면 검토표에 "아직 원본과 맞춰 보지 못함"으로 남는다.

### 손으로 고친 뒤 (`gen` · `check`)

`references/` 의 YAML 을 고쳤으면 `gen`. 생성기가 틀린 값을 잡는다 — 운임이 100원 단위가 아니거나(자릿수), 특실이 일반실보다 크지 않거나,
운임표에 없는 역을 길잡이에 적었거나, 같은 구간을 두 번 적었거나. 고친 것이 뜻대로 들어갔는지는 찍힌 "바뀐 것"과 `review.md` 로 본다.

### 화면 캡처 (`capture`)

사이트 화면이 바뀌어 읽기가 틀어졌을 때만 다시 받는다(지금 것은 2026-09-16).

1. 사용자가 **로그인된 브라우저**에서 그 화면을 열고 F12 → Console 에 `capture/console-snippet.js` 의 해당 한 줄을 붙여 넣는다(파일이 내려받아진다).
2. 내려받은 파일을 `test/fixtures/<이름>-<받은 날>.html` 로 둔다(지금 이름: `list-`·`rentcar-`·`rentcar-form-`).
3. 그 파일을 읽는 테스트의 경로를 새 이름으로 바꾸고(`grep -l fixtures test/*.mjs`) `npm test`.

## 함정

- **`ktx-fares-official.yaml` 은 손으로 고치지 않는다** — 다시 가져오면 통째로 다시 쓴다. 한 구간을 고치거나 더하려면 `ktx-fares.yaml` 의 `routes` 다.
- 가져오기는 **특실이 있는 시트만** 읽는다. KTX-이음 노선(강릉·중앙·중부내륙·동해선)은 넘기고, 넘긴 시트를 끝에 알려 준다.
- `ktx` 는 `uv` 가 있어야 한다(`xlrd` 를 그때만 받아 쓴다 — `uv run --with xlrd`).
- **Node 에서 사용자의 eclass 쿠키로 화면을 받지 않는다** — 포털이 서버 세션까지 끝낸다. 화면 캡처는 사용자가 브라우저에서 받는다.
- 캡처에는 실제 예약 내용과 이름이 들어 있다 — 저장소에 올리기 전에 본다.
- `status` 의 "90일" 은 이 스킬이 정한 눈금이다(코레일 운임은 자주 바뀌지 않는다). 바꾸려면 `tools/refdata.mjs` 의 `KTX_STALE_DAYS`.
