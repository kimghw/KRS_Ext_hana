// 신청 내역의 기본 보기(attendpanel.js + src/settling.js) — 오늘부터 잡힌 것은 전부(근태를 올려 둔 가장 늦은 날까지), 지난 것은 여비 정산이
// 덜 끝난 출장만 다녀온 뒤 4주(또는 8주)까지(2026-10-04 사용자 지정). 사후정산을 완료했거나 증빙을 담당자에게 보낸 출장은 빠진다.
// 조회 기간은 한 줄(시작일 ~ 종료일 · 조회)이고 지난 내역(히스토리) 버튼은 없다. 4주·8주 버튼은 제목 줄의 4W·8W 다(2026-10-05 사용자 지정:
// "신청내역 조회 할때 그냥 4주전 8주전 이거 여기에 버튼 넣어주라 그냥 4W, 8W 라고 하면 될듯" — 그 전에는 조회 기간 칸 안의 4주·8주였다).
//
// 패널을 진짜 화면(sidepanel.html)에 붙이고, HR 문서함(작업 탭 안의 요청)과 eclass 여비계산서 목록은 흉내 낸다.
// 날짜는 오늘을 기준으로 짓는다 — 패널이 진짜 시계를 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, what) => {
  for (let i = 0; i < 240 && !ok(); i++) await wait(25);
  assert.ok(ok(), `기다렸지만 되지 않았다: ${what}`);
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8)}`;
const TODAY = plus(0);

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { window } = new JSDOM(html, { url: 'https://example.org/' });
const doc = window.document;
for (const g of ['document', 'DOMParser', 'FileReader', 'Element', 'HTMLElement', 'HTMLInputElement']) globalThis[g] = window[g];
globalThis.window = window;

/* ------------------------------------------------------------ 가짜 HR 문서함과 여비계산서 목록 */

const HR = 'https://hr.krs.co.kr';
const trip = (docNo, from, to = from, over = {}) => ({
  docNo, statusCode: '5', statusName: '결재완료', formId: 'TR', formName: '출장신청서', workCodeKindName: '국내출장',
  startDate: from.replace(/-/g, ''), endDate: to.replace(/-/g, ''), startTime: '0700', endTime: '2000', wrkGubunName: '시간',
  reqRsn: docNo, reqstDate: `${plus(-40)} 09:00:00`, pgmUrlAd: '/uhr/docappr/apprtrav100/view', ...over,
});
const out = (docNo, from) => trip(docNo, from, from, { formId: 'TRO', formName: '외근/교육 신청서', workCodeKindName: '외근', startTime: '1300', endTime: '1500' });
const hrRows = [
  trip('T-FAR', plus(120)),            // 넉 달 뒤의 출장 — 예전 기본(한 달 뒤까지)에는 없던 것
  out('O-NEXT', plus(2)),
  out('O-PAST', plus(-2)),             // 지난 외근 — 기본 보기에 없다
  trip('T-A', plus(-3)),               // 다녀온 출장 · 사전정산 완료(사후정산 대기) — 보인다
  trip('T-S', plus(-5)),               // 다녀온 출장 · 증빙을 이미 보냈다 — 안 보인다
  trip('T-D', plus(-9), plus(-8)),     // 다녀온 출장 · 사후정산 완료 — 안 보인다
  trip('T-40', plus(-40)),             // 마흔 날 전 · 여비계산서 없음 — 8주로 골라야 보인다
];
// 여비계산서 목록: 계산서 번호 → { 출장기간, 사후정산 }. 사전정산은 모두 완료다.
const bt = { 601: { from: plus(-3), to: plus(-3), post: '대기' }, 602: { from: plus(-9), to: plus(-8), post: '완료' }, 603: { from: plus(-5), to: plus(-5), post: '대기' } };
let pager = '';   // 목록 아래의 쪽 글("전체 45건 · 1/2 페이지") — 비어 있으면 한 쪽이다
let btGate = null;   // 걸어 두면 여비계산서 목록의 답이 이것이 풀릴 때까지 늦는다
const BT_LIST = () => `<div class="bt-topmenu"><span class="bt-user"> 김거화 (kimghw) / KOR | ENG </span></div><table id="mainList"><tbody>${
  Object.entries(bt).map(([seq, d]) => `<tr><td data-href="/BusinessTrip/CalPrint?seq=${seq}">${seq}</td><td>김거화</td>`
    + `<td data-href="/BusinessTrip/CalPrint?seq=${seq}&amp;trseq=9${seq}"> </td><td><span>완료</span></td><td><span>${d.post}</span></td>`
    + `<td>${d.from}~${d.to}</td><td>서울 본사</td><td>김거화</td><td>${plus(-30)}</td></tr>`).join('')}</tbody></table>${pager}${' '.repeat(1600)}`;

const store = { attendKind: 'trip', attendView: 'all', sendDone: { 'T-S': { at: Date.now(), channel: '쪽지', to: '홍길동', account: 'RND-2026-01' } } };
const calls = { hr: [], bt: [] };
globalThis.chrome = {
  storage: { local: {
    get: async () => store,
    set: async (obj) => { Object.assign(store, obj); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
  } },
  runtime: { sendNativeMessage: async () => { throw new Error('no host'); } },
  tabs: {
    get: async (id) => ({ id, url: `${HR}/`, status: 'complete' }),
    create: async () => ({ id: 7, url: `${HR}/`, status: 'complete' }),
    update: async (id) => ({ id }), remove: async () => {}, query: async () => [],
  },
  scripting: {
    executeScript: async ({ func, args }) => {
      if (func.name === 'pageShell') return [{ result: { href: `${HR}/`, shell: true, login: false } }];
      if (func.name !== 'pageFetch') return [{ result: null }];
      calls.hr.push(args[0]);
      if (args[0] === '/api/user') return [{ result: { status: 200, url: '', text: JSON.stringify({ loginUserId: '11115', loginUserNm: '김거화' }) } }];
      return [{ result: { status: 200, url: '', text: JSON.stringify(hrRows) } }];
    },
  },
};
const page = (body) => new Response(`<html><body>${body}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('http://localhost:5003')) throw new TypeError('Failed to fetch');
  if (u.includes('/BusinessTrip/Home/List')) {
    calls.bt.push(u);
    // 문(btGate)이 걸려 있으면 그때의 목록을 들고 기다렸다가 답한다 — 늦게 오는 예전 답을 흉내 낸다.
    const [html, gate] = [BT_LIST(), btGate];
    if (gate) await gate;
    return page(html);
  }
  if (u.includes('/BusinessTrip/')) throw new Error('목록 말고는 읽지 않는다: ' + u);
  return page(`home${' '.repeat(1600)}`);   // 포털 로그인 확인
};

/* ------------------------------------------------------------ 패널 */

const { createAttendPanel } = await import('../attendpanel.js');
const { STAGES_KEY, BACK_KEY } = await import('../src/settling.js');
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const panel = createAttendPanel({
  $: (id) => doc.getElementById(id), escapeHtml, logEvent: () => {}, ai: () => ({ apiKey: '', cli: false }),
  evidence: { list: async () => [], keep: async () => {}, remove: async () => {} },
});
panel.wire();
const st = panel.state;
const shown = () => [...doc.querySelectorAll('#atList > li')].map((li) => li.querySelector('.at-reason').textContent);
const hint = () => doc.getElementById('atRangeHint').textContent;
const pressed = () => [4, 8].map((n) => back(n).getAttribute('aria-pressed'));
/** 머리 줄의 기간 글 — 올해 안이면 "9/6 ~ 10/13", 올해 밖에 걸치면 해를 붙인다. */
const spanOf = (from, to) => {
  const year = TODAY.slice(0, 4);
  const one = (s) => (from.slice(0, 4) === year && to.slice(0, 4) === year ? md(s) : `${s.slice(2, 4)}/${md(s)}`);
  return `${one(from)} ~ ${one(to)}`;
};
const back = (n) => doc.querySelector(`.at-list-head button[data-back="${n}"]`);
/** 근태 목록과 여비계산서 목록을 둘 다 읽을 때까지. */
const settle = async (what) => { const n = calls.bt.length; await until(() => calls.bt.length > n && st.trips?.rows, what); await wait(40); };

await panel.show();
await until(() => st.trips?.rows, '처음 읽기');
await wait(40);

console.log('기본 보기 — 오늘부터 전부, 지난 것은 정산이 덜 끝난 출장만 다녀온 뒤 4주까지');
t('넉 달 뒤의 출장까지 앞으로의 것은 전부 보인다(날짜가 늦은 것이 위). 지난 것은 사전정산만 끝난 출장 하나다', () => {
  assert.deepEqual(shown(), ['T-FAR', 'O-NEXT', 'T-A']);
  assert.equal(doc.getElementById('atCount').textContent, '3');
});
t('사후정산을 완료한 출장(T-D)·증빙을 보낸 출장(T-S)·지난 외근(O-PAST)·4주가 넘은 출장(T-40)은 없다', () => {
  for (const no of ['T-D', 'T-S', 'O-PAST', 'T-40']) assert.ok(!shown().includes(no), no);
});
t('머리 줄: 4주 전부터 근태를 올려 둔 가장 늦은 날(넉 달 뒤의 출장)까지이고, 안내 글이 규칙을 말한다. 4주·8주는 꺼져 있다(누르면 그 기간을 조회한다)', () => {
  assert.equal(doc.getElementById('atRange').textContent, spanOf(plus(-28), plus(120)));
  assert.equal(hint(), '오늘부터 전부 · 정산 중인 출장은 다녀온 뒤 4주까지');
  assert.deepEqual(pressed(), ['false', 'false']);
});
t('날짜 칸에는 그 기간이 깔려 있다 — 종료일은 근태를 올려 둔 가장 늦은 날이다', () => {
  assert.deepEqual([doc.getElementById('atRangeFrom').value, doc.getElementById('atRangeTo').value], [plus(-28), plus(120)]);
});
t('여비계산서 목록은 8주 전부터 가장 늦게 끝나는 출장까지 읽는다 — 다녀온 출장의 단계를 가리려고', () => {
  assert.match(calls.bt.at(-1), new RegExp(`SDate=${plus(-56)}&EDate=${plus(120)}`));
});
t('읽은 목록을 담아 둔다 — 홈의 WORKSPACE 카드가 같은 단계를 본다(창 밖의 계산서는 담지 않는다)', () => {
  assert.equal(store[STAGES_KEY].day, TODAY);
  assert.deepEqual(store[STAGES_KEY].rows.map((r) => [r.seq, r.travelers[0].post]), [['601', '대기'], ['602', '완료'], ['603', '대기']]);
});
t('다녀온 출장 줄에는 정산 상태 딱지가 붙는다 — 사전정산만 끝낸 채 다녀왔으면 "사후정산전"', () => {
  const li = [...doc.querySelectorAll('#atList > li')].at(-1);
  assert.equal(li.querySelector('.at-trip').textContent, '사후정산전');
  assert.ok(li.classList.contains('past'));
});
t('왼쪽 딱지는 결재 상태다 — 결재완료는 "승인". 여비계산서가 없는 출장의 오른쪽 딱지는 "정산전"이고, 출장이 아닌 줄에는 없다', () => {
  const [far, next] = [...doc.querySelectorAll('#atList > li')];
  assert.deepEqual([far.querySelector('.at-st').textContent, far.querySelector('.at-trip').textContent], ['승인', '정산전']);
  assert.deepEqual([next.querySelector('.at-st').textContent, next.querySelector('.at-trip')], ['승인', null]);
});
t('정산 상태 딱지는 색으로 가리지 않는다 — 단계마다 다른 클래스를 달지 않는다', () => {
  assert.deepEqual([...new Set([...doc.querySelectorAll('#atList .at-trip')].map((n) => n.className))], ['at-trip']);
});

console.log('4주 · 8주 — 누르면 그 기간을 곧바로 조회한다(2026-10-04 사용자 지정). 켜진 것을 다시 누르면 기본 보기로 돌아온다');
back(8).click();
await settle('8주');
t('8주를 누르면 8주 전부터 근태를 올려 둔 가장 늦은 날까지의 것 전부가 바로 보인다 — 조회를 따로 누르지 않는다. 정산이 끝난 출장도, 지난 외근도 보인다', () => {
  assert.deepEqual(shown(), ['T-FAR', 'O-NEXT', 'O-PAST', 'T-A', 'T-S', 'T-D', 'T-40']);
  assert.equal(hint(), '근태 날짜 기준 · 8주 전부터 전부');
  assert.deepEqual([store[BACK_KEY], pressed(), doc.getElementById('atRange').textContent], [8, ['false', 'true'], spanOf(plus(-56), plus(120))]);
  assert.deepEqual([doc.getElementById('atRangeFrom').value, doc.getElementById('atRangeTo').value], [plus(-56), plus(120)], '날짜 칸에도 그 기간이 적힌다');
  assert.match(calls.bt.at(-1), new RegExp(`SDate=${plus(-56)}&EDate=${plus(120)}`));
});
back(4).click();
await settle('4주');
t('4주를 누르면 4주 전부터로 바뀐다 — 마흔 날 전의 출장은 빠진다', () => {
  assert.deepEqual(shown(), ['T-FAR', 'O-NEXT', 'O-PAST', 'T-A', 'T-S', 'T-D']);
  assert.deepEqual([hint(), store[BACK_KEY], pressed(), doc.getElementById('atRange').textContent], ['근태 날짜 기준 · 4주 전부터 전부', 4, ['true', 'false'], spanOf(plus(-28), plus(120))]);
});
back(8).click();
await settle('8주');
back(8).click();
await settle('기본 보기');
t('켜져 있는 8주를 다시 누르면 기본 보기로 돌아온다 — 지난 것은 정산 중인 출장만, 마지막에 누른 8주까지다', () => {
  assert.deepEqual(shown(), ['T-FAR', 'O-NEXT', 'T-A', 'T-40']);
  assert.deepEqual([hint(), store[BACK_KEY], pressed(), doc.getElementById('atRange').textContent],
    ['오늘부터 전부 · 정산 중인 출장은 다녀온 뒤 8주까지', 8, ['false', 'false'], spanOf(plus(-56), plus(120))]);
});

console.log('기간을 정해 조회하면 근태 날짜가 그 기간에 걸친 것 전부다');
doc.getElementById('atRangeFrom').value = plus(-10);
doc.getElementById('atRangeTo').value = plus(-1);
doc.getElementById('atRangeGo').click();
await settle('기간 조회');
t('정산이 끝난 출장도, 지난 외근도 보인다 — 기간 조회는 가리지 않는다', () => {
  assert.deepEqual(shown(), ['O-PAST', 'T-A', 'T-S', 'T-D']);
  assert.equal(doc.getElementById('atRange').textContent, spanOf(plus(-10), plus(-1)));
  assert.equal(hint(), '근태 날짜 기준 · 기간 지정');
  assert.deepEqual(pressed(), ['false', 'false'], '기간을 정해 조회하는 중에는 4주·8주가 꺼져 있다');
  assert.match(calls.bt.at(-1), new RegExp(`SDate=${plus(-10)}&EDate=${plus(-1)}`));
});

console.log('펴 둔 카드는 방금 정산을 마쳤어도 남는다');
/** 기본 보기로(정산 중인 출장은 4주까지) — 4주를 눌러 조회하고, 켜진 것을 다시 눌러 돌아온다. */
const toDefault = async () => {
  back(4).click();
  await settle('4주 조회');
  back(4).click();
  await settle('기본 보기로 돌아옴');
};
await toDefault();
doc.querySelector('#atList > li:last-child .at-head').click();
bt[601].post = '완료';   // 그 사이 사후정산이 완료됐다(패널에서 확정했거나 사이트에서 눌렀다)
{
  const n = calls.bt.length;
  await panel.reload();
  await until(() => calls.bt.length > n, '다시 읽기');
  await wait(60);
}
t('사후정산이 완료된 것으로 읽혀도, 펴 둔 줄은 그대로 있다', () => {
  assert.deepEqual(shown(), ['T-FAR', 'O-NEXT', 'T-A']);
  assert.equal(doc.querySelector('#atList > li.open .at-trip').textContent, '정산완료');
});
doc.querySelector('#atList > li.open .at-head').click();
await panel.reload();
await wait(60);
t('접고 다시 읽으면 빠진다 — 담아 둔 단계로 곧바로 가려 깜박이지 않는다', () => assert.deepEqual(shown(), ['T-FAR', 'O-NEXT']));

console.log('정산 상태 딱지를 붙이지 않는 때 — 걸린 계산서가 같은 기간의 다른 신청서 것이거나, 계산서가 없는지 모를 때');
const temp = { statusCode: '1', statusName: '임시저장' };
hrRows.push(
  trip('T-FAR-TEMP', plus(120), plus(120), temp),                                       // 승인된 T-FAR 와 같은 날의 임시저장 (계산서 없음)
  trip('T-NEW', plus(5), plus(6), { statusCode: '3', statusName: '결재요청' }),          // 올려 둔 출장 · 계산서 604
  trip('T-NEW-TEMP', plus(5), plus(6), temp),                                           // 그것과 같은 기간의 임시저장 — 604 가 같이 걸린다
  trip('T-LONE', plus(9), plus(9), temp),                                               // 혼자인 임시저장 · 계산서 605
  trip('T-BACK', plus(12), plus(12), { statusCode: '6', statusName: '회수' }),           // 회수 · 계산서 없음
  trip('T-EDGE', plus(14), plus(16)),                                                   // 승인 · 계산서 없음
);
bt[604] = { from: plus(5), to: plus(6), post: '대기' };
bt[605] = { from: plus(9), to: plus(9), post: '대기' };
/** 줄마다 [왼쪽 딱지, 오른쪽 딱지] — 오른쪽 딱지가 없으면 null. */
const chips = () => Object.fromEntries([...doc.querySelectorAll('#atList > li')].map((li) =>
  [li.querySelector('.at-reason').textContent, [li.querySelector('.at-st').textContent, li.querySelector('.at-trip')?.textContent ?? null]]));
{
  const n = calls.bt.length;
  await panel.reload();
  await until(() => calls.bt.length > n, '다시 읽기');
  await wait(60);
}
t('같은 기간에 올려 둔(신청·승인) 신청서가 있으면 임시저장 줄에는 붙이지 않는다 — 그 계산서는 올려 둔 신청서의 것이다. 혼자인 임시저장에는 붙는다', () => {
  const c = chips();
  assert.deepEqual([c['T-NEW'], c['T-NEW-TEMP']], [['신청', '사전정산 완료'], ['임시저장', null]]);
  assert.deepEqual([c['T-FAR'], c['T-FAR-TEMP']], [['승인', '정산전'], ['임시저장', null]]);
  assert.deepEqual(c['T-LONE'], ['임시저장', '사전정산 완료']);
});
t('회수한 신청서는 계산서가 없으면 붙이지 않는다. 승인된 출장에 계산서가 없으면 "정산전"', () => {
  assert.deepEqual([chips()['T-BACK'], chips()['T-EDGE']], [['회수', null], ['승인', '정산전']]);
});
const rowOf = (no) => [...doc.querySelectorAll('#atList > li')].find((li) => li.querySelector('.at-reason').textContent === no);
rowOf('T-NEW-TEMP').querySelector('.at-head').click();
t('가려진 임시저장 줄은 펴도 같은 판단이다 — 계산서 줄이 올려 둔 신청서를 가리키고, 사후정산·여비증빙 송부 칸이 없다', () => {
  const li = doc.querySelector('#atList > li.open');
  assert.match(li.querySelector('.at-tripline').textContent, /^같은 기간에 올려 둔 출장 신청서가 있습니다 — 여비계산서는 그 줄에서 봅니다/);
  assert.deepEqual([li.querySelector('.at-after'), li.querySelector('.at-send')], [null, null]);
});
doc.querySelector('#atList > li.open .at-head').click();
doc.getElementById('atRangeFrom').value = plus(15);
doc.getElementById('atRangeTo').value = plus(20);
doc.getElementById('atRangeGo').click();
await settle('기간 조회');
t('조회 기간에 한쪽만 걸친 출장은 계산서 목록을 그 출장기간까지 읽은 것이 아니다 — 계산서를 못 찾아도 "정산전"이라고 하지 않는다', () => {
  assert.deepEqual(chips(), { 'T-EDGE': ['승인', null] });
});
pager = '<div class="bt-pager"><div>전체 45건 · 1/2 페이지</div></div>';
bt[603].post = '작성';   // 첫 쪽에서 달라진 것 — 덜 읽은 목록이 담기면 홈이 이 값을 본다
await toDefault();
t('계산서 목록이 여러 쪽이면(첫 쪽만 읽는다) 못 찾은 출장을 "정산전"이라고 하지 않는다 — 찾은 것은 그대로 붙는다', () => {
  const c = chips();
  assert.deepEqual([c['T-FAR'], c['T-EDGE'], c['T-NEW']], [['승인', null], ['승인', null], ['신청', '사전정산 완료']]);
});
t('덜 읽은 목록은 홈 카드가 보는 곳에 담지 않는다 — 반쪽짜리 목록을 "다 읽은 것"으로 두지 않는다', () => {
  assert.equal(store[STAGES_KEY].rows.find((r) => r.seq === '603').travelers[0].post, '대기');
});
rowOf('T-EDGE').querySelector('.at-head').click();
t('그 출장을 펴도 "여비계산서 없음"이라고 하지 않고, 첫 쪽만 읽었다고 말한다', () => {
  assert.match(doc.querySelector('#atList > li.open .at-tripline').textContent, /^여비계산서를 찾지 못했습니다 — 계산서 목록이 여러 쪽이라 첫 쪽만 읽었습니다/);
});
doc.querySelector('#atList > li.open .at-head').click();

console.log('늦게 온 예전 답은 버린다');
pager = '';
{
  let release;
  btGate = new Promise((r) => { release = r; });
  await panel.reload();               // 첫 읽기 — 계산서 목록의 답이 늦는다(그때의 604 는 사후정산 대기)
  btGate = null;
  bt[604].post = '작성';
  await panel.reload();               // 둘째 읽기 — 곧바로 답한다
  await until(() => chips()['T-NEW'][1] === '사후정산 중', '둘째 답');
  release();
  await wait(60);
}
t('먼저 시작한 읽기의 답이 나중에 와도 새 답을 덮지 않는다', () => assert.deepEqual(chips()['T-NEW'], ['신청', '사후정산 중']));

console.log(`\n통과 ${pass}건`);
process.exit(0);
