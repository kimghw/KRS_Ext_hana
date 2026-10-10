# rERP 집행내역 · 예상 비용 공유 — 두 확장이 같은 코드를 쓰는 설계

작성 2026-10-10 · 상태 **설계안(구현 전)** · 대상 저장소 `kr_ext_workspace`(R&D 탭) · `kr_ext_rerp`(과제집행비율 · 확장 Plus) · 새 저장소 `kr_ext_shared`

## 0. 한눈에

- **무엇을**: R&D 탭의 예산 칸에 rERP 의 **집행내역**(비목별 예산액·승인액·승인전·잔액·집행비율 + 미청구·승인전 행 + 합계)을 kr_ext_rerp 의 과제집행비율과 **같은 규칙**으로 보이고,
  비목마다 **예상 비용**(세목·수량·단가·월간 구독)을 적어 잔액·집행비율에 반영하며, 그 예상 비용을 **원노트의 과제별 페이지**로 같은 과제 사람들과 나눈다(kr_ext_rerp 의 확장 Plus 와 같은 페이지·같은 표·같은 병합).
- **어떻게 같은 코드로**: rERP 호출·집행비율 셈·예상 비용 모형·예상 비용 줄과 입력 폼·원노트 페이지 접근·표 블록·병합·동기화 오케스트레이션을 **한 저장소(`kr_ext_shared`)의 ESM 모듈**로 빼고, 두 확장은 그것을 `shared/` 로 복사해 그대로 읽는다(복사 도구 + 어긋남 검사). 화면의 바깥 틀(표의 어디에 놓는가, 과제를 어떻게 고르는가)만 확장마다 다르다.
- **왜 ESM**: kr_ext_workspace 는 이미 ESM(사이드패널·module 서비스워커·`node --test`). kr_ext_rerp 는 classic 스크립트(`importScripts`·`<script>`·전역 `KRX_*`)지만 module 서비스워커로 바꾸고 콘텐츠 스크립트에는 동적 `import()` 셔틀 하나를 두면 같은 파일을 그대로 읽는다 — 변환 생성물 없이 **바이트까지 같은 파일**이 두 확장에 들어간다.
- **상호운용의 핵심**: 두 확장이 같은 저장 모양(`plannedExpenses` = `과제번호 → 재원코드|비목 → 항목[]`), 같은 페이지 제목(`[예상 비용] {과제번호} {과제명}`), 같은 블록(`<table data-id="krx-plan">` + `krxplan1:` base64 JSON), 같은 병합(id 별 ts · 묘비 90일)을 쓰므로 **한 사람이 eClass 홈의 rerp 패널에서 적은 예상 비용을 다른 PC 의 WORKSPACE 사이드패널에서 그대로 보고 고친다.** 한 PC 에서 두 확장을 같이 써도 저장소는 따로지만 페이지에서 만난다.

## 1. 지금 두 확장이 가진 것

| | kr_ext_rerp (0.8.3) | kr_ext_workspace (R&D 탭) |
|---|---|---|
| rERP 호출 | `lib/rnd-api.js` — `_JSON_` 이중 인코딩, EUC-KR, `GWM0001` 로그인 판정, eClass SSO(`ssoLogin`), 과제 목록(500건 절단 대응), 비목별 잔액(`rcomm_0041_01_r004`, 본예산 `_r006` 대체), 카드 미청구(`rtask_0008_t05_01_r001`) | 없음 (`rnd.krs.co.kr` 호스트 권한도 없음) |
| 집행비율 | 비목 `승인액÷예산액`, 과제 `(승인액+미청구+승인전)÷예산액`, 잔액 `BAL_AMT−미청구`(승인전은 이미 차감) — SPEC `EXR-03/04/07`, 제외 비목(인건비·연구수당·간접비 기본) | 예산 칸의 **계획·집행을 손으로** 적음. 잔액·집행률 막대는 계획 대비 |
| 예상 비용 | `lib/plan.js`(저장소·월간 구독·입력 처리) + `lib/render.js`(줄·폼·예상 반영 행·눈·저장·⬇⬆↗ 아이콘) — SPEC `PLN-01~09` | 없음 |
| 원노트 | `lib/mcp-client.js`(MCP Streamable HTTP) · `lib/plus-onenote.js`(섹션·페이지·블록) · `lib/plan-sync.js`(제목 규칙·표+JSON·병합·`run`) · `background.js planSync`(배선, RERP 섹션, 책임자만 페이지 생성) | `src/rndnote.js` — **과제 정보만** 한 페이지(`[R&D 과제 정보] KRS WORKSPACE`, 블록 `krs-rnd-projects`, `krsrnd1:`)에 두고 기기끼리 맞춤. MCP 연결은 `src/teams.js connect`(rerp 것과 거의 같은 코드가 둘) |
| 과제 단위 | rERP 과제번호(`PRJ_NO`) + 연차(`ANL`) | 장부의 과제(별칭·과제번호·연구기간) × **차년도**(`yearsOf`) |
| 화면 | HTML 문자열 렌더러 + `data-act` 위임 + 다시 그리기(`draw`) | 고정 요소(`el.*`) 에 줄 innerHTML, 칸마다 `paint*` |

같은 일을 하는 코드가 이미 두 벌(MCP 연결·표 블록 쓰기/읽기·묘비 병합)이고, 집행내역·예상 비용은 rerp 에만 있다. 이것을 한 벌로 모으는 것이 이 설계다.

## 2. 결정 — 공유 코드는 `kr_ext_shared` 에 ESM 으로, 두 확장은 `shared/` 로 복사해 쓴다

### 2.1 규칙

- `kr_ext_shared/src/*.js` 는 **순수 로직 + 주입**이다. `chrome.*`·`document`·`window` 를 직접 만지지 않는다. 바깥과 닿는 것(`fetch`, 저장소 읽기/쓰기, 시각 `now`, 사용자 이름 `who`, 다시 그리기 `draw`)은 **인자로 받는다**. 그래서 Node `node --test` 로 통째로 검사되고, 사이드패널·서비스워커·콘텐츠 스크립트 어디서나 같은 파일이 돈다.
- 예외는 `planui.js`(예상 비용 줄·폼의 HTML 과 이벤트 위임)와 `plan.css` — 화면 조각이지만 호스트 요소·상태·콜백을 받아 **두 확장이 같은 모양으로** 그린다. 클래스 접두어는 `kplan-`(두 확장의 `krext-`·`rd-` 와 겹치지 않음).
- 두 확장의 `shared/` 는 **고치지 않는다**. 고칠 것은 `kr_ext_shared` 에서 고치고 테스트한 뒤 `node tools/shared.mjs sync` 로 두 확장에 복사한다. 각 확장의 테스트에 `check`(바이트 비교) 가 들어 있어 어긋난 채로는 녹색이 되지 않는다 — `rnd/skills` ← RND 프로젝트 복사와 같은 방식(`tools/rndskills.mjs`).
  (대안: `git subtree add/pull --prefix shared` — 이력까지 가져오지만 명령이 낯설다. 복사+검사가 얇다고 느껴지면 그때 바꾼다.)
- 저장소 모양·페이지 제목·블록 id·기계용 표시(`krxplan1:`)·병합 규칙은 **rerp 0.8.x 것을 그대로** 둔다. 이미 만들어진 원노트 페이지와 저장된 예상 비용이 그대로 읽힌다.

### 2.2 모듈

```
kr_ext_shared/
  src/
    fmt.js        숫자·돈·날짜·HTML 이스케이프 (rerp KRX_FMT 의 쓰는 부분만)
    mcp.js        MCP Streamable HTTP 클라이언트
    onenote.js    KR_MS365_mcp onenote 도구로 섹션·페이지·블록
    block.js      원노트 표 블록 공통 꼴 (제목 줄 · 머리글 · 줄 · 기계용 칸)
    plan.js       예상 비용 모형 (저장 모양 그대로 · 월간 구독 · 셈 · 검증)
    planui.js     예상 비용 줄 · 입력 폼 · 예상 반영 행 · 눈/저장/⬇⬆↗ 아이콘 HTML 과 이벤트 위임
    plan.css      그 모양
    plansync.js   예상 비용 ↔ 과제별 페이지 (제목 규칙 · 평면화 · 병합 · 직렬화 · run)
    erp.js        R&D ERP 호출 (call · ssoLogin · 과제 찾기 · 비목별 잔액 · 카드 미청구)
    budget.js     집행비율 셈 (줄 정리 · 제외 비목 · 합계 · 미청구·승인전 반영 · 예상 반영 · 비목 이름 맞추기)
    index.js      위 전부 다시 내보내기 (콘텐츠 스크립트 셔틀이 한 번에 읽는다)
  test/           node --test (*.test.mjs) · fixtures/ (rERP REC 본보기 — 값은 지어낸 것)
  README.md       규약 · 모듈 · 두 확장에 넣는 법
  package.json    "test": "node --test" — 의존 없음
```

| 모듈 | 내보내는 것 | 어디서 왔나 |
|---|---|---|
| `mcp.js` | `openMcp(url, { fetchFn, clientName, clientVersion, initTimeoutMs, callTimeoutMs })` → `{ call(name, args), list(), close(), server, protocol }`. SSE 답에서 같은 id 고르기, `mcp-session-id`, 끝나면 `DELETE`. 오류에 `kind`: `offline`·`timeout`·`http`·`session`·`rpc`·`tool`·`parse`. `describe(e)` | rerp `lib/mcp-client.js` 그대로(완전한 쪽). workspace `src/teams.js connect` 는 이것으로 바꾼다(프로토콜 `2025-06-18` 하나로 — 8장 확인 항목) |
| `onenote.js` | `listSections` · `listNotebooks` · `ensureSection(client, { name, notebookId })`(없으면 만듦, 노트북을 골라야 하면 `kind 'notebook'`) · `listSectionPages` · `findPageByTitle(client, sectionId, title)`(못 찾으면 `syncDb` 뒤 한 번 더) · `syncDb` · `createPage` · `readPage`(`include_ids`) · `pageTitle` · `findBlock(html, dataId)` · `writeBlock`(생성 id 로 replace, 없으면 append) · `resolveLink` · `parseLink` · `checkTools` | rerp `lib/plus-onenote.js` + workspace `src/rndnote.js` 의 페이지 부분(`findPage`·`createPage`·`readPage`·`writeBlock`·`findBlock`) |
| `block.js` | `encodeBlock({ dataId, mark, lead, cols, rows, payload, at })` → `<table data-id=…>` 한 덩이(제목 줄 · 머리글 · 줄 · 맨 아래 `mark + base64(UTF-8 JSON)`) · `decodeBlock(inner, mark)` → payload \| null (태그 걷고 엔티티 풀고 공백 지워 읽음) · `b64enc`/`b64dec` | rerp `plan-sync serialize/parse` 와 workspace `rndnote blockHtml/readBlock` 이 같은 꼴 — 하나로. `krx-plan`/`krxplan1:` 과 `krs-rnd-projects`/`krsrnd1:` 둘 다 이것 위에 선다 |
| `plan.js` | 상수 `KEY='plannedExpenses'`·`DKEY='plannedDeleted'`·`SKEY='planSyncState'`·`PKEY='plusPlanPages'`·`TOMB_TTL`. `itemKey(row)`(`재원코드|비목`)·`keyName`·`listOf`·`find`·`upsert`·`remove`·`sumOf`·`projectTotal`·`newId`·`gcTomb`·`subRemaining(date, now)`·`isSub`·`qtyOf(e, now)`·`amtOf(e, now)`. 입력: `EMPTY_DRAFT`·`draftOf(e, now)`·`recalc(draft, field, now)`(수량×단가→금액, 금액→단가, 구독이면 결제일→수량)·`makeEntry(draft, { id, now, who })` → `{ entry }` 또는 `{ error, focus }` | rerp `lib/plan.js` 의 순수 부분. `bind()` 의 저장소·메시지 부분은 각 확장에 남는다(아래 `planui.js` 가 콜백으로 받음) |
| `planui.js` | `planBtn(prjNo, key)` · `planRow(prjNo, key, e, bgt, now)` · `planForm(state, names, now)` · `appliedRow(label, row)` · `planIcons(prjNo, { count, sum, hidden, savedMark, share: { on, link, lead, status, importBox } })` · `bindPlan(host, state, { draw, persist(prjNo), requestSync(reason, prjNo), exportPage(prjNo), bindLink(prjNo, text), syncNow(prjNo), copyText, now })` — `data-act="plan-*"` 위임(열기·수정·삭제·수량 −/＋·월간·저장·취소·눈·저장 아이콘·가져오기·내보내기·Enter/Esc/↑↓·단가·금액 칸 정리) | rerp `lib/render.js` 의 `planRow`·`planForm`·아이콘 묶음 + `lib/plan.js bind()` 의 이벤트 부분. 표의 바깥(비목 행·합계 행·과제 행)은 확장마다 |
| `plansync.js` | `TITLE_PREFIX`·`BLOCK='krx-plan'`·`titleFor(prjNo, prjNm)`·`prjOfTitle`·`flatten`/`unflatten`·`merge(local, remote, now)`·`serialize(data, { title, calc, now })`·`parse(inner)`·`run(deps)` — deps = `{ client, sectionId, pages, names, myPrjNos, leadPrjNos, only, createAll, who, now, loadLocal(), saveLocal(plans, del, prj) }` → `{ state, pages }` | rerp `lib/plan-sync.js` 그대로(직렬화만 `block.js` 로) |
| `erp.js` | `createErp({ fetchFn, base='https://rnd.krs.co.kr', usefac='10', services })` → `call(service, input)`(이중 인코딩·EUC-KR·`COMMON_HEAD`·`GWM0001`/HTML → `kind 'login'`) · `ssoLogin()`(loginCheck → `sso_login_krs.jct` → `rderp_layoutMain.act`; eClass 도 풀렸으면 `kind 'eclass-login'`) · `fetchProjectRecs({ status, auth })`(`rcomm_0009_01_r001` 원본 행 — 과제번호×연차마다 한 행, 500건 절단 대응) · `fetchProjects(...)`(과제번호마다 ANL 큰 행 하나) · `findProject({ code, name })`(원본 행에서 과제번호가 같은 **연차 행들**; 없으면 이름으로; 그래도 없으면 `rcomm_0009_03_r003` SEARCH_NM=과제번호 한 건) · `fetchBudgetRecs(prjNo)`(`_r004` → 0건이면 상세로 예산기준 보고 `_r006`) · `fetchCards(prjNo, { from, to, unbilledOnly })` · `describe(e)` | rerp `lib/rnd-api.js` 의 `call`·`ssoLogin`·`fetchProjectRecs/fetchProjects`·`fetchBudget` 앞부분·`fetchCards`. 설정(`adv.*`)은 `services` 인자로 |
| `budget.js` | `budgetRows(recs, { std, include, excludeDefault })` → `[{ res, resCd, expCd, exp, item, bgt, appr, req, bal, rate, dir, psnl, excluded }]` · `budgetTotals(rows)` → `{ bgtAmt, apprAmt, reqAmt, balAmt, rate, dirRate, excl*, resCount }` · `withPending(totals, { unbilled, unbilledCount })` → `+ pending, execAmt, balAfter, rateAll, pendingRate, unbilledRate` · `applyPlans(rows, totals, plansOfProject, now)` → 줄마다 `planned, plannedCount, balPlanned, ratePlanned`, `orphans`(표에 없는 비목), 전체 `{ sum, count, balPlanned, ratePlanned }` · `execRate`·`trunc`·`pct` · `nameKey(비목명)`(띄어쓰기·`·`·`/`·괄호 걷고 소문자 — 장부 비목과 rERP 비목 맞추기) | rerp `fetchBudget` 뒷부분(줄·합계·제외)·`collect` 의 미청구·승인전 합산·`render.js` 의 `rateOf`·예상 반영 셈 |

## 3. 같아야 하는 것 (상호운용 규약 — 바꾸지 않는다)

| 항목 | 값 |
|---|---|
| 예상 비용 저장 | `chrome.storage.local.plannedExpenses = { [과제번호]: { [재원코드\|비목명]: [{ id, name, qty, unit, amt, ts, by?, sub?: { date } }] } }` · 묘비 `plannedDeleted = { [id]: { ts, prj } }` · `planSyncState` · `plusPlanPages` · `plusSection` |
| 페이지 | 섹션 이름 기본 **`RERP`**(대소문자 무시, 없으면 고른 노트북에 만듦) · 과제마다 한 장 **`[예상 비용] {과제번호} {과제명}`** · 과제번호로 찾는다 |
| 블록 | `<table data-id="krx-plan">` 하나 — 제목 줄(과제 · 시각 · 누가 · 건수 · 합계) · 머리글(비목·세목·수량·단가·금액·월간·작성) · 줄 · 기계용 칸 `krxplan1:` + base64 UTF-8 JSON `{ v:1, at, by, items:[{ id, prj, key, name, qty, unit, amt, sub?, ts, by? }], del:{ id: 시각 } }` · 있던 표는 `include_ids` 로 읽은 생성 id 로 통째로 replace, 없으면 append |
| 병합 | 항목은 id 별로 ts 큰 쪽(같으면 로컬) · 묘비가 항목 ts 이상이면 삭제, 항목이 더 새로우면 묘비 폐기 · 90일 지난 묘비 버림 · 로컬과 다르면 로컬에 쓰고(pulled), 페이지와 다르면 페이지에 씀(pushed) |
| 페이지 생성 | **과제 책임자만** 만든다(항목이 없어도 동기화 때 자동). 책임자가 아니면 `noPage` 로 기다리고, 동료가 보낸 링크(+ID)를 **가져오기**로 붙이면 그 페이지에 연결(`bound`) |
| 집행비율 | 비목 `승인액(APPR_AMT) ÷ 예산액(BGT_AMT)`, 둘 다 양수일 때만, 소수 2자리 절사 · 과제 `(승인액 + 미청구 + 승인전 REQ_AMT) ÷ 예산액` · 잔액 `BAL_AMT − 미청구`(승인전은 BAL_AMT 에 이미 빠져 있음) · 예상 반영 `잔액 − 예상`, `(승인액 + … + 예상) ÷ 예산액` · 제외 비목 기본 인건비·연구수당·간접비 |
| 월간 구독 | 수량 = 오늘(당일 포함)부터 올해 12월까지 남은 결제 횟수(짧은 달은 말일), 금액 = 횟수 × 월 결제액 — 그릴 때마다 다시 셈 |
| 언제 맞추나 | 열 때(마지막 성공 뒤 1분 안이면 건너뜀) · 항목 편집 4초 뒤(모아서) · 저장 아이콘 직후(그 과제만) · 눈으로 펼칠 때(그 과제만) · 지금 맞추기 · (rerp 만) 자동 갱신 알람 |

## 4. kr_ext_workspace 쪽 설계

### 4.1 매니페스트 · 로그인

- `host_permissions` 에 `https://rnd.krs.co.kr/*` 를 더한다(선택 권한이 아니라 고정 — eclass·hr 와 같은 사내 주소). 사이드패널은 확장 페이지라 `fetch(credentials:'include')` 로 쿠키가 실린다(rerp 는 서비스워커에서 확인했고 같은 확장 출처다 — 8장 확인 항목 4).
- rERP 가 "로그인 필요"(`kind 'login'`)로 답하면 `erp.ssoLogin()` 을 **한 번** 하고 다시 조회한다. eClass 세션까지 없으면(`kind 'eclass-login'`) `src/net.js` 의 "로그인이 필요합니다 …" 말투로 알리고 **지난 스냅샷**을 그대로 보인다. 비밀번호·UID·SID 는 저장하지 않는다.
- 조회는 사이드패널이 직접 한다(배경 서비스워커를 거치지 않는다). 홈 카드에는 보이지 않는다(범위 밖).

### 4.2 과제·차년도 ↔ rERP 과제 잇기

장부(`rndBook`)의 차년도에 rERP 과제를 **이어 둔다**:

```
project.years[n].erp = {
  prjNo, anl, prjNm, rspr,            // rERP 과제번호 · 연차 · 과제명 · 책임자
  auto: true|false, linkedAt,         // 저절로 맞췄는지 · 언제
  snap: {                             // 마지막 조회 — 탭을 열면 먼저 이것을 그리고, 살아 있으면 다시 받는다
    at, std,                          // 시각 · 예산기준(10 과제예산 · 20 본예산)
    rows: [ budget.budgetRows 의 줄 ],
    totals: { …budgetTotals, …withPending },
    cards: { at, from, to, count, amount },
    error: ''                         // 마지막 실패 까닭(스냅샷은 지난 것 그대로)
  }
}
budget 줄(r)에 erpKey: '재원코드|비목명'   // 맞춰진 rERP 비목. 있으면 집행 칸은 읽기 전용이고 used 는 rERP 승인액을 따른다
```

- **저절로 잇기**(`src/rnderp.js linkYear`): 예산 칸을 펼 때 그 차년도에 `erp` 가 없고 과제에 과제번호(없으면 과제명)가 있으면 `erp.findProject` 로 rERP 과제 목록(`rcomm_0009_01_r001` — 과제번호×연차마다 한 행)에서 그 과제의 연차 행들을 받아 ① `ANL == n` 인 행 → ② 연구기간(`RCH_ST_DT~RCH_END_DT`)이 그 차년도 구간을 품는 행 → ③ 행이 하나뿐이면 그것 — 차례로 고른다. 못 고르면 칸 안에 **`rERP 과제 고르기`** 드롭다운(내 진행 과제 `fetchProjects`, 이름이 비슷한 것 먼저)이 선다. 이은 뒤에는 `rERP 잇기 바꾸기 · 끊기`.
- **살아 있는 조회는 오늘이 든 차년도(올해)만**. 지난 차년도는 마지막 스냅샷을 `마지막 조회 2026.12.31` 로 보이고 다시 받지 않는다(차년도가 끝나면 그때의 집행이 장부에 남는다 — rERP 는 덮어쓰지만 장부는 해마다 남긴다). 다음 차년도는 아직 없음. `rcomm_0041_01_r004` 가 과제번호만으로 **현재 연차**의 예산을 준다고 본 것이다(8장 확인 항목 1 — 연차마다 과제번호가 다르면 `years[n].erp.prjNo` 에 그 번호가 들어갈 뿐 구조는 같다).
- **언제 받나**: 탭을 열 때·예산 칸을 펼 때(마지막 조회 10분 지났으면 — rerp `CMN-20` 과 같은 주기), 칸의 `↻`. 알람은 두지 않는다(패널이 열려 있을 때만 뜻이 있다).

### 4.3 예산 칸 — 집행내역

```
비목            계획(원)        집행(원)          잔액             막대 = rERP 승인액÷예산액     ↻  rERP 10.10 14:05
인건비          35,900,000      12,345,000 ⓔ     23,555,000       ▮▮▮▮        34.3%
연구활동비      66,300,000      19,712,839 ⓔ     46,587,161       ▮▮▮▮▮       45.1%
                rERP 예산 43,700,000 ≠ 계획                                          (계획과 다르면 작게)
  ＋ 예상 비용                                                                       (눈으로 펼친 동안)
  ↳ 회의비 · [−] 3 [＋] × 50,000 · −150,000 · +0.3%   ✎ ×
  ↳ 예상 반영   잔액 46,437,161 · 집행비율 45.4%
위탁연구개발비   —              3,000,000 ⓔ      —                ▮▮▮▮▮▮      60.0%   (rERP 에만 있는 비목 — 읽기 전용 보조 줄, rERP 예산 5,000,000)
미청구 · 승인전  과제카드 2건 523,000 · 승인전 148,500  −523,000                     +1.3%
합계            136,000,000     35,057,839        100,419,161      rERP 집행비율 48.0%  (인건비 뺀 예산 48,700,000 기준 · 툴팁에 식)
예상 반영 (1건 · 150,000)                         100,269,161                   48.3%
```

(숫자는 본보기 — 계획·잔액 합계는 장부의 비목 전부(연구수당·간접비 포함)로, 막대와 rERP 집행비율은 3장 식으로 셈한 값이다.)

- **집행 칸**: 이어진 줄은 rERP **승인액**을 `r.used` 에 넣고 입력을 읽기 전용(`readonly`)으로 둔다. `ⓔ` 표시의 툴팁에 재원·예산액(A)·승인액(B)·신청(승인전)·구매요청·예산조정·잔액(A−B). `used` 에 넣어 두므로 **요약 복사·예산 표 복사·JSON·공문 탭의 연구 내용**이 지금 코드 그대로 진짜 집행을 쓴다(집행액은 변경이력이 아니라는 규칙도 그대로). 이어지지 않은 줄(rERP 에 없는 비목)은 지금처럼 손으로 적는다.
- **계획 칸은 건드리지 않는다**(계획서 YAML 이 정본, 고치면 변경이력). rERP 예산액이 계획과 다르면 계획 아래 작게 `rERP 예산 …` 을 보인다 — 계획서와 rERP 등록이 어긋난 것을 눈으로 잡는다.
- **비목 맞추기**(`budget.nameKey` + `src/rnderp.js matchRows`): 띄어쓰기·`·`·`/`·괄호를 걷은 이름이 같으면 같은 비목(`연구시설·장비비` = `연구시설장비비`). 재원이 여럿인 과제(`resCount > 1`)는 같은 비목이 재원마다 오므로 **집행 칸은 재원 합**, 그 아래 재원별 보조 줄(흐리게)을 펴 **＋ 는 재원 줄마다** 둔다 — 예상 비용 키(`재원코드|비목`)가 rerp 와 같아야 같은 페이지에서 만난다. rERP 에만 있는 비목은 장부 줄을 만들지 않고 스냅샷에서 읽기 전용 보조 줄로 보인다(집행 합계에는 든다).
- **미청구 · 승인전 행 · 합계 · 예상 반영**: 3장 식 그대로(`budget.withPending`·`applyPlans`). 합계 줄의 **rERP 집행비율**은 제외 비목(인건비·연구수당·간접비, 칸 안 설정으로 바꿈)을 뺀 값이고 툴팁에 식. 표에서 제외 비목을 **숨기지는 않는다**(9장).
- **칸 머리의 형편**: `계획 1.36억 · 집행 3,506만 · rERP 집행비율 26.2% · 예상 1건` / 못 받으면 `rERP 로그인 필요` · `rERP 못 받음(까닭)` 과 지난 스냅샷.
- **미청구 카드**: 그 과제번호의 미청구 거래(`SEARCH_GB '1'`)를 **차년도 시작일 ~ 오늘+1개월**로 받아 건수·합만 쓴다(rerp 의 계좌 규칙·공용 거래 판정은 쓰지 않는다 — 9장).

### 4.4 예상 비용 (rerp `PLN-01~09` 와 같게)

- 비목(재원) 줄의 **＋** → 세목·수량·단가·금액(수량×단가 ↔ 금액÷수량)·**월간**(결제일 → 남은 횟수) 폼, Enter 추가·Esc 취소·↑↓ 수량. 항목 줄 `↳ 세목 · [−] 수량 [＋] × 단가 · −금액 · +비율 ✎ ×`. 예상 반영 행. 기본은 **감춤**(눈 아이콘으로 펼침, 저장 안 함), 항목이 없는 과제는 ＋ 가 늘 보임. 저장 아이콘은 지금 저장 + `저장됨`.
- 저장은 **`chrome.storage.local.plannedExpenses` 에 rERP 과제번호로**(장부 밖, 3장). 잇기를 바꿔도 번호가 같으면 그대로 따라온다. 장부 JSON 저장에는 이어진 과제번호의 몫을 `plans` 로 같이 넣고 불러오기 때 얹는다(백업용).
- 세목 자동완성은 이미 적어 둔 세목만(청구서 세목 빠른 선택 목록이 없다 — 9장).
- 화면 조각은 `shared/planui.js` + `shared/plan.css` 그대로. `rndpanel.js` 는 비목 줄 안에 `planBtn`·`planRow`·`planForm` 을 끼워 넣고 `bindPlan(el.budget, st, { draw: paintBudget, persist, requestSync, … })` 로 잇는다.

### 4.5 원노트 공유 칸 — 예상 비용 섹션을 더한다

```
☑ 원노트에 두고 다른 기기·사람과 함께 쓰기 (이 PC 의 KR_MS365_mcp OneNote 서버, localhost:5005)
  과제 정보   [섹션 ▾]  [섹션 불러오기]          (지금 그대로 — 내 기기끼리)
  예상 비용   섹션 이름 [RERP]  노트북 [▾]  [섹션 찾기/만들기]   (rerp 와 같은 섹션·같은 페이지 — 과제 사람들끼리)
  [지금 맞추기]  [원노트에서 열기]   맞춤 10.10 14:05 · 과제 정보 3개 · 예상 비용 2과제(쓴 1 · 받은 1)
```

- 저장: `rndNote.plus = { sectionName: 'RERP', notebookId, sectionId, sectionLabel }` + `plusPlanPages`·`planSyncState`(rerp 와 같은 키). `ensureSection` 이 섹션을 못 정하면(없거나 여러 노트북) 노트북 드롭다운이 선다 — rerp 팝업과 같은 흐름.
- 예산 칸 도구줄의 아이콘(공유가 켜져 있고 차년도가 이어져 있을 때, 눈으로 펼친 동안): **⬇ 가져오기**(동료가 보낸 링크+ID 붙여 넣기 → `resolveLink` → `bound`) · **⬆ 내보내기**(이 과제 페이지의 링크+ID 복사 — 페이지가 없고 내가 책임자면 먼저 만들고 `다시 누르면 링크 복사`; 사이드패널은 클립보드 권한이 없어 긴 작업 뒤 바로 못 쓰므로 두 단계) · **↗ 열기**. 툴팁에 그 과제의 마지막 동기화 결과(`planSyncState.pages[과제번호]`).
- **책임자 판정**: 장부의 과제책임자(`p.lead`)가 내 이름(`chrome.storage.local.myName` — 홈 카드·설정에서 온 것)과 같으면 책임자. 이름이 비어 있으면 책임자가 아니고 `이름을 적으면 페이지를 만들 수 있습니다` 로 알린다(rerp 는 참여인력 역할 "책임" 도 본다 — 9장).
- 동기화는 `shared/plansync.run` 을 사이드패널이 직접 돌린다 — deps = `{ client: openMcp(ONENOTE_MCP_URL), sectionId, pages, names: { 과제번호: 과제명 }, myPrjNos: 이어진 과제번호들, leadPrjNos: 그중 책임자인 것, who: myName, loadLocal/saveLocal: plannedExpenses·plannedDeleted }`. 한 번에 하나(지금의 `noteRun` 과 같은 줄 세우기), 과제 정보 맞추기와 이어서 한 번에.
- `src/rndnote.js` 는 **과제 정보 맞추기(`syncInfo` 등)만 남기고** 페이지 접근은 `shared/onenote.js`·`shared/block.js`(dataId `krs-rnd-projects`, 표시 `krsrnd1:` 그대로)로 바꾼다 — 이미 만든 과제 정보 페이지가 그대로 읽힌다.

### 4.6 바뀌는 파일

| 파일 | 변경 |
|---|---|
| `manifest.json` | `host_permissions` + `https://rnd.krs.co.kr/*` |
| `shared/` (새) | `kr_ext_shared/src` 복사본 · `tools/shared.mjs sync|check` |
| `src/rnderp.js` (새) | 이 확장만의 풀: 차년도 ↔ rERP 잇기(`linkYear` — 고르는 규칙·수동 고르기), 받기(`refreshYear` — 10분·올해만·로그인 한 번·스냅샷), 비목 맞추기(`matchRows` — 이름 키·재원 합·보조 줄), 스냅샷을 장부에(`applySnapshot` — `used`·`erpKey`), 칸 머리 글(`erpState`) |
| `src/rnd.js` | `normalizeYear` 에 `erp`(스냅샷 포함)·줄의 `erpKey` · `exportJson/importJson` 에 `plans` · `summaryText`·`budgetTsv` 에 rERP 줄(기준 시각·미청구·승인전·rERP 집행비율) |
| `src/rndnote.js` | 페이지 접근을 `shared/onenote.js`·`block.js` 로 · `normalizeNote` 에 `plus` |
| `rndpanel.js` | 예산 칸: rERP 셀·읽기 전용 집행·보조 줄·미청구·승인전·합계·↻·고르기 드롭다운 · 예상 비용(`planui.bindPlan`) · 원노트 칸의 예상 비용 섹션·아이콘·동기화 배선 · `createRndPanel` deps 에 `erp`(검사에서 흉내)·`openMcp` |
| `sidepanel.html` · `sidepanel.css` | 위 칸들 · `shared/plan.css` 읽기 |
| `src/teams.js` | `connect` → `shared/mcp.js openMcp`(선택 — Teams 송부도 같은 클라이언트로) |
| `test/` | `rnderp.test.mjs`(순수: 잇기 규칙·비목 맞추기·재원 합·스냅샷 적용·10분·올해만) · `rndpanel.test.mjs` 에 흉내 rERP(`erp.call` 가짜 — 로그인 한 번·본예산 대체·카드)·예상 비용·공유 아이콘 · `rndnote.test.mjs` 의 MCP 부분은 shared 로 · `shared.test.mjs`(복사본이 원본과 같은지) |
| `README.md` | R&D 탭 절에 **rERP 집행내역**·**예상 비용**·**원노트 공유(예상 비용)**, 구조 표에 `shared/`·`src/rnderp.js`, 테스트 목록 |

## 5. kr_ext_rerp 쪽 설계 (동작은 그대로, 코드만 공유본으로)

- `manifest.json`: `"background": { "service_worker": "background.js", "type": "module" }` · `web_accessible_resources: [{ "resources": ["shared/*.js"], "matches": ["https://eclass.krs.co.kr/*"] }]` · 버전 0.9.0.
- `background.js`: `importScripts(...)` → `import './lib/format.js'; import './lib/settings.js'; …`(지금의 IIFE 들은 `self` 에 붙으므로 side-effect import 로 그대로 돈다) + `import * as shared from './shared/index.js'`. `planSync`·`planExport`·`planBind`·`plusProbe`·`plusNotebooks`·`plusResolveSection` 은 `shared.plansync.run`·`shared.onenote.*`·`shared.mcp.openMcp` 를 부른다. `rndAutoLogin` 은 `shared.erp.ssoLogin`.
- `popup/popup.html`·`options/options.html`: 마지막 스크립트를 `type="module"` 로 — 앞의 classic 스크립트가 붙인 전역(`KRX_*`)은 module 에서도 보인다.
- 콘텐츠 스크립트(eClass 홈): `js` 목록 맨 앞에 **`content/shared-boot.js`** —
  `self.KRX_SHARED_READY = import(chrome.runtime.getURL('shared/index.js')).then((m) => (self.KRX_SHARED = m));`
  `content/eclass.js` 는 `KRX_PLAN.load()` 전에 `await KRX_SHARED_READY`. `lib/plan.js`·`lib/render.js` 는 함수 **안에서만** `self.KRX_SHARED.*` 를 읽는다(맨 위에서 읽지 않는다).
- `lib/rnd-api.js`: `call`·`ssoLogin`·`fetchProjects`·`fetchBudget`·`fetchCards` 는 `shared.erp`(`createErp({ services: settings.adv })`)·`shared.budget` 에 맡기고 `collect`·`diagnose`·참여인력·미승인 등 rerp 만의 것은 남긴다.
- `lib/plan.js`: 저장소(`load/save`)·메시지(`requestSync`)·`bind` 의 껍데기만 남기고 셈·검증·줄·폼·이벤트는 `shared.plan`·`shared.planui.bindPlan`(콜백에 `persist`→`save`, `requestSync`→`chrome.runtime.sendMessage`, `exportPage/bindLink/syncNow`→기존 메시지). `lib/render.js budgetTable` 은 `shared.budget.applyPlans` 와 `shared.planui.*` 로 줄을 만든다.
- 지운다: `lib/plan-sync.js`·`lib/plus-onenote.js`·`lib/mcp-client.js`. `tests/plan-sync.test.js` 는 `kr_ext_shared/test` 로 옮기고 rerp 에는 `tests/shared-check.test.js`(복사본 일치 + `import('../shared/index.js')` 연기 검사) 를 둔다. `lib/panel.css` 의 `krext-plan-*` 은 `shared/plan.css`(`kplan-*`) 로.
- 사용자 입장에서 바뀌는 것은 없다 — 저장 키·페이지·블록·설정 그대로. README 의 구조 절과 확장 Plus 절에 "공유 코드(`shared/`)" 한 줄.

## 6. 복사 도구와 검사

```
kr_ext_shared          node --test                                      # 순수 로직 전부 (MCP·rERP 는 흉내 fetch)
kr_ext_workspace       node tools/shared.mjs sync   # E:\dev\kr_ext_shared\src → shared/ (+ shared/VERSION: 원본 커밋·날짜)
                       node tools/shared.mjs check  # 바이트 비교 — npm test 의 test/shared.test.mjs 가 부른다
kr_ext_rerp            node tools/shared.mjs sync|check                 # 같은 도구(복사해 둠)
```

- 고치는 차례: `kr_ext_shared` 에서 고침 → 거기 테스트 → 두 확장에 `sync` → 각 확장 테스트(`npm test` / `node tests/*.test.js`) → 각 확장 커밋. 원본 경로는 `SHARED_SRC` 환경변수로 바꿀 수 있다(다른 PC).
- 골든 검사(`kr_ext_shared/test/golden.test.mjs`): 같은 입력(항목 셋·묘비·제목)으로 `plansync.serialize` 가 만든 표가 rerp 0.8.3 의 `lib/plan-sync.js` 가 만든 표와 **바이트까지 같다**(고정된 본보기 파일로) — 옮기면서 블록이 달라지지 않았음을 못 박는다. `budget` 도 README 의 실측값(연구활동비 43,700,000 − 승인 19,712,839 − 신청 148,500 = 잔액 23,838,661, 집행비율 45.1%) 으로.

## 7. 단계

| 단계 | 하는 일 | 끝났다는 기준 |
|---|---|---|
| 0 | `kr_ext_shared` 만들기 — `mcp`·`onenote`·`block`·`plan`·`planui`·`plansync`·`erp`·`budget`·`fmt`·`index` 옮기기, 테스트 옮기기·보태기(골든 포함) | `node --test` 녹색 · 골든 일치 |
| 1 | kr_ext_rerp 가 공유본을 쓰게(module 서비스워커·셔틀·얇은 lib·삭제) — **동작 보존 리팩터링** | 기존 테스트 녹색 · 실제 원노트 페이지에 `planSync` 를 돌려 블록·`planSyncState` 가 전과 같음 · eClass 홈 패널·팝업에서 ＋/수정/삭제/월간/눈/⬇⬆↗ 가 그대로 |
| 2 | kr_ext_workspace — 매니페스트·`rnderp`·예산 칸·예상 비용·원노트 칸·`rnd.js`·`rndnote.js`·테스트·README | jsdom 검사(흉내 rERP·흉내 원노트) 녹색 · CDP(9333, 읽기만)로 실제 과제 하나의 집행이 rERP 자금현황 탭 숫자와 같음 |
| 3 | 교차 확인 | 같은 과제의 예상 비용을 rerp 패널에서 적으면 WORKSPACE 패널에 오고(거꾸로도), 두 확장의 rERP 집행비율이 같은 과제에서 같은 값 |

## 8. 확인할 것 (구현 전에, 또는 0단계에서)

1. **`rcomm_0041_01_r004` 가 과제번호만으로 어느 연차의 예산을 주는가.** 현재 연차로 봤다. CDP 로 자금현황 탭이 보내는 입력을 보고, `rcomm_0009_03_r003` 의 연차 행들에서 `PRJ_NO` 가 연차마다 같은지 본다. 연차마다 번호가 다르면 4.2 의 잇기에서 `ANL` 대신 그 번호를 쓰면 되고(구조 그대로), 같다면 "올해만 살아 있음" 이 맞다.
2. `REQ_CNT: '-1'` 의 뜻 — rerp 가 쓰는 값 그대로 쓴다(바꾸지 않는다).
3. MCP 프로토콜 버전 — rerp `2025-06-18`, workspace `2025-03-26`. 공유본은 하나(`2025-06-18`)로 두고 KR_MS365_mcp 가 받는지 한 번 확인(둘 다 지금 실서버에서 돌고 있어 될 것으로 본다).
4. 사이드패널 출처에서 `rnd.krs.co.kr` 호출 — rerp 는 서비스워커에서 확인했다. 같은 확장 출처라 되겠지만 0단계에서 `erp.call('rcomm_0009_01_r001')` 한 번으로 못 박는다.
5. 사이드패널에서 긴 동기화 뒤 클립보드 — 두 단계(`다시 누르면 링크 복사`)로 피한다. 거슬리면 `clipboardWrite` 권한.
6. 책임자 판정이 rerp 와 다른 경우(참여인력 역할 "책임" 인데 장부의 과제책임자 이름이 다름) — 장부의 과제책임자 칸을 고치면 된다(변경이력에 남음).

## 9. 의도적으로 다르게 두는 것

- 제외 비목(인건비·연구수당·간접비)을 WORKSPACE 표에서 **숨기지 않는다** — 계획 칸이 있어 비목 전부가 보여야 한다. 합계의 rERP 집행비율에서만 뺀다(툴팁에 적음).
- 미청구 카드는 그 과제번호로 조회된 미청구 거래 전부 — rerp 의 계좌 규칙·공용 거래 판정(두 과제가 같은 계좌를 쓸 때)은 WORKSPACE 에 없다. 그 경우 미청구액이 rerp 보다 클 수 있다(툴팁에 "계좌 규칙 없음").
- 세목 자동완성은 이미 적은 세목만(청구서 세목 빠른 선택 목록은 rerp 설정에만 있다).
- 책임자 판정은 장부의 과제책임자 == 내 이름.
- 갱신 주기 — 알람 없이 열 때·펼 때·↻(10분 TTL). rerp 는 알람으로도 돈다.
- 지난 차년도의 집행은 **장부의 스냅샷**(차년도가 끝날 때의 마지막 조회)이고 rERP 를 다시 묻지 않는다 — rerp 에는 없는 "해마다 남는 기록" 이다.
