# 참조 데이터 — 무엇을 어디서 보고 고치나

확장이 참조하는 값(운임·규칙·마일리지·LLM 입력 명세)의 **원본은 이 폴더의 YAML** 이다. 확장은 YAML 을 읽지 못해서
생성기가 `src/*spec.js` 로 옮기고, 같은 값을 사람이 읽는 표 [`review.md`](review.md) 로도 낸다.

```
YAML(여기서 고친다) ──(npm run gen)──▶ src/travelspec.js · src/inputspec.js(확장이 쓴다)
                                   └──▶ references/review.md(사람이 맞춰 본다)
```

## 파일

| 파일 | 내용 | 고치는 사람 | 원본·출처 |
|---|---|---|---|
| [`review.md`](review.md) | **확장이 실제로 쓰는 값의 표** — 운임 전 구간·도시→역·규칙·마일리지, 출처와 기준일 | 고치지 않는다(생성물) | 아래 YAML 들 |
| [`ktx-fares.yaml`](ktx-fares.yaml) | KTX 운임 **보정**(한 구간 고치기·더하기), 도시→타는 역, 갈아타는 역, 구간 소요 시간 | **손으로** | 조사·어림(머리말에 까닭) |
| [`ktx-fares-official.yaml`](ktx-fares-official.yaml) | 코레일 공식 KTX 운임표 542구간 | 고치지 않는다 — `/refdata ktx` 가 다시 가져온다 | 코레일 엑셀(파일의 `source`·`basis`·`imported`) |
| [`travel-rules.yaml`](travel-rules.yaml) | 여비 규칙 — 출장기간 구분, 일비, 식수, 교통편, 좌석 등급, 숙박비 상한액 초과(1.5배까지 부서장 승인, 비고의 기본 사유) | **손으로** | 사용자 지정 · eclass 화면 |
| [`air-mileage.yaml`](air-mileage.yaml) | 항공 마일리지 — 구간 마일, 좌석 등급별 적립률, 공항 이름 | **손으로**(원본과 맞춰 보고) | 항공사 안내 페이지(`source`), 맞춰 본 날은 `checked` |
| [`input.yaml`](input.yaml) | LLM 이 말을 구조로 바꿀 때의 명세 — 칸·형·범위·규칙 | **손으로**(개발자) | — |

## 값이 맞는지 보려면

[`review.md`](review.md) 를 연다(VS Code 에서는 미리보기 Ctrl+Shift+V). 맨 위 "출처와 기준일" 표에 원본 링크가 있고,
구간은 두 역을 가나다 순으로 적어 두었으니 `대전 ↔ 부산` 처럼 찾는다(Ctrl+F). 손으로 고친 구간은 따로 모여 있다.

## 고치는 순서

1. 위 표에서 고칠 YAML 을 연다. 파일마다 머리말에 쓰는 법과 예가 있다.
2. `npm run gen` — 생성물과 검토표를 다시 만든다(처음이면 그 전에 `npm i`). 틀린 값은 여기서 걸린다 — 운임의 자릿수(100원 단위),
   특실이 일반실보다 큰지, 없는 역, 같은 구간 두 번, 범위가 뒤집힌 칸.
3. 찍힌 **"바뀐 것"** 줄이 뜻한 대로인지 본다. `npm test` 로 나머지를 확인한다.
4. 브라우저의 확장 관리 화면에서 확장을 다시 불러온다(↻).

자주 고치는 것:

| 하려는 것 | 고칠 곳 | 예 |
|---|---|---|
| 한 구간의 KTX 운임 고치기·더하기 | `ktx-fares.yaml` 의 `routes` | `- { a: 서울, b: 부산, standard: 54400, first: 78900, note: "까닭" }` |
| 출장지에서 내릴 역 바꾸기 | `ktx-fares.yaml` 의 `places` | `고양: 행신` |
| 한 구간의 소요 시간 바꾸기 | `ktx-fares.yaml` 의 `times.routes` | `- { a: 부산, b: 대전, hours: 3 }` |
| 아침·저녁을 세는 시각 바꾸기 | `travel-rules.yaml` 의 `meals` | `first_day_depart_hour_at_most: 7` |
| 상한액을 넘는 숙박비의 승인 범위 바꾸기 | `travel-rules.yaml` 의 `lodging.over_cap` | `approve_rate: 1.5` · `approver: 부서장` |
| 상한액을 넘겨 정산할 때 비고에 적는 기본 사유 바꾸기 | `travel-rules.yaml` 의 `lodging.over_cap.reason` | `reason: 인근 숙소비 상승으로 인해 숙박비 내에 숙박이 어려움` |
| 마일리지 구간 고치기·더하기 | `air-mileage.yaml` 의 그 항공사 `routes` | `- { a: 김포, b: 김해, miles: 215 }` |
| 코레일이 운임을 바꿨다 | 손대지 않는다 | `/refdata ktx` (스킬) |

## 밖에서 가져오는 것

KTX 공식 운임표·항공 마일리지 표·사이트 화면 캡처는 밖에서 온다. 다시 가져오는 길과 현황 점검은 **`/refdata` 스킬**
(`.claude/skills/refdata`)에 있다 — `node tools/refdata.mjs` 가 지금 상태(기준일·가져온 날·원본과 맞춰 본 날)를 한눈에 보여 준다.

## 아직 코드에 있는 참조 값

YAML 로 빼지 않은 값이다. 고치려면 그 파일을 고친다(개발자 몫).

| 값 | 어디에 | 비고 |
|---|---|---|
| 근태 기본 시각·유연근무 시간대·최대 일수 | `src/attend.js` 맨 위 | 일부는 `input.yaml` 에도 있어 둘을 같이 고친다(테스트가 어긋나면 잡는다) |
| HR 근태 종류 코드·폼 경로 | `src/attend.js` 의 `FORMS`·`KINDS`·`STATUS` | HR 화면에서 확인한 값 |
| 회의실 차례·접어 두는 방 | `src/roomorder.js` 의 `TOP`·`FOLD` | |
| 다녀온 출장을 보이는 기간(4·8주) | `src/settling.js` | |
| 차량의 근무지 규칙(서울·부산) | `src/carfind.js` | |
| eclass 주소·화면 선택자 | `src/config.js` 와 `src/hr.js`·`src/trip.js`·`src/memo.js`·`src/calpdf.js`·`src/rentcar.js` | 사이트가 바뀌면 고친다 |
