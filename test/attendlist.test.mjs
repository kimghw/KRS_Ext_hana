// 신청 내역의 기본 보기(attendpanel.js + src/settling.js) — 오늘부터 잡힌 것은 전부, 지난 것은 여비 정산이 덜 끝난 출장만
// 다녀온 뒤 2주(또는 4주)까지(2026-10-04 사용자 지정). 사후정산을 완료했거나 증빙을 담당자에게 보낸 출장은 빠진다.
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
  trip('T-20', plus(-20)),             // 스무 날 전 · 여비계산서 없음 — 4주로 골라야 보인다
];
// 여비계산서 목록: 계산서 번호 → { 출장기간, 사후정산 }. 사전정산은 모두 완료다.
const bt = { 601: { from: plus(-3), to: plus(-3), post: '대기' }, 602: { from: plus(-9), to: plus(-8), post: '완료' }, 603: { from: plus(-5), to: plus(-5), post: '대기' } };
const BT_LIST = () => `<div class="bt-topmenu"><span class="bt-user"> 김거화 (kimghw) / KOR | ENG </span></div><table id="mainList"><tbody>${
  Object.entries(bt).map(([seq, d]) => `<tr><td data-href="/BusinessTrip/CalPrint?seq=${seq}">${seq}</td><td>김거화</td>`
    + `<td data-href="/BusinessTrip/CalPrint?seq=${seq}&amp;trseq=9${seq}"> </td><td><span>완료</span></td><td><span>${d.post}</span></td>`
    + `<td>${d.from}~${d.to}</td><td>서울 본사</td><td>김거화</td><td>${plus(-30)}</td></tr>`).join('')}</tbody></table>${' '.repeat(1600)}`;

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
  if (u.includes('/BusinessTrip/Home/List')) { calls.bt.push(u); return page(BT_LIST()); }
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
const back = (n) => doc.querySelector(`#atRangeBox button[data-back="${n}"]`);
/** 근태 목록과 여비계산서 목록을 둘 다 읽을 때까지. */
const settle = async (what) => { const n = calls.bt.length; await until(() => calls.bt.length > n && st.trips?.rows, what); await wait(40); };

await panel.show();
await until(() => st.trips?.rows, '처음 읽기');
await wait(40);

console.log('기본 보기 — 오늘부터 전부, 지난 것은 정산이 덜 끝난 출장만 다녀온 뒤 2주까지');
t('넉 달 뒤의 출장까지 앞으로의 것은 전부 보인다(날짜가 늦은 것이 위). 지난 것은 사전정산만 끝난 출장 하나다', () => {
  assert.deepEqual(shown(), ['T-FAR', 'O-NEXT', 'T-A']);
  assert.equal(doc.getElementById('atCount').textContent, '3');
});
t('사후정산을 완료한 출장(T-D)·증빙을 보낸 출장(T-S)·지난 외근(O-PAST)·2주가 넘은 출장(T-20)은 없다', () => {
  for (const no of ['T-D', 'T-S', 'O-PAST', 'T-20']) assert.ok(!shown().includes(no), no);
});
t('머리 줄: 오늘부터라 끝 날짜가 없고, 안내 글이 규칙을 말한다. 다녀온 출장은 2주가 골라져 있다', () => {
  assert.equal(doc.getElementById('atRange').textContent, `${md(TODAY)} ~`);
  assert.equal(hint(), '오늘부터 전부 · 정산 중인 출장은 다녀온 뒤 2주까지');
  assert.deepEqual([0, 2, 4].map((n) => back(n).getAttribute('aria-pressed')), ['false', 'true', 'false']);
});
t('여비계산서 목록은 4주 전부터 가장 늦게 끝나는 출장까지 읽는다 — 다녀온 출장의 단계를 가리려고', () => {
  assert.match(calls.bt.at(-1), new RegExp(`SDate=${plus(-28)}&EDate=${plus(120)}`));
});
t('읽은 목록을 담아 둔다 — 홈의 WORKSPACE 카드가 같은 단계를 본다(창 밖의 계산서는 담지 않는다)', () => {
  assert.equal(store[STAGES_KEY].day, TODAY);
  assert.deepEqual(store[STAGES_KEY].rows.map((r) => [r.seq, r.travelers[0].post]), [['601', '대기'], ['602', '완료'], ['603', '대기']]);
});
t('다녀온 출장 줄에는 여비계산서 단계 딱지가 붙는다', () => {
  const li = [...doc.querySelectorAll('#atList > li')].at(-1);
  assert.equal(li.querySelector('.at-trip').textContent, '사전정산 완료');
  assert.ok(li.classList.contains('past'));
});

console.log('다녀온 출장을 언제까지 보일지 — 안 봄 · 2주 · 4주');
back(4).click();
await settle('4주');
t('4주를 고르면 스무 날 전에 다녀온 출장(여비계산서 없음)까지 보인다 — 정산이 끝난 것은 여전히 없다', () => {
  assert.deepEqual(shown(), ['T-FAR', 'O-NEXT', 'T-A', 'T-20']);
  assert.equal(hint(), '오늘부터 전부 · 정산 중인 출장은 다녀온 뒤 4주까지');
  assert.equal(store[BACK_KEY], 4);
});
back(0).click();
await until(() => shown().length === 2, '안 봄');
t('안 봄을 고르면 지난 것은 하나도 없다', () => {
  assert.deepEqual(shown(), ['T-FAR', 'O-NEXT']);
  assert.deepEqual([hint(), store[BACK_KEY]], ['오늘부터 전부', 0]);
});

console.log('기간을 정해 조회하면 근태 날짜가 그 기간에 걸친 것 전부다');
doc.getElementById('atRangeFrom').value = plus(-10);
doc.getElementById('atRangeTo').value = plus(-1);
doc.getElementById('atRangeGo').click();
await settle('기간 조회');
t('정산이 끝난 출장도, 지난 외근도 보인다 — 기간 조회는 가리지 않는다', () => {
  assert.deepEqual(shown(), ['O-PAST', 'T-A', 'T-S', 'T-D']);
  assert.equal(doc.getElementById('atRange').textContent, `${md(plus(-10))} ~ ${md(plus(-1))}`);
  assert.equal(hint(), '근태 날짜 기준 · 기간 지정');
  assert.match(calls.bt.at(-1), new RegExp(`SDate=${plus(-10)}&EDate=${plus(-1)}`));
});

console.log('펴 둔 카드는 방금 정산을 마쳤어도 남는다');
back(2).click();
await settle('2주로 돌아옴');
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
  assert.equal(doc.querySelector('#atList > li.open .at-trip').textContent, '사후정산 완료');
});
doc.querySelector('#atList > li.open .at-head').click();
await panel.reload();
await wait(60);
t('접고 다시 읽으면 빠진다 — 담아 둔 단계로 곧바로 가려 깜박이지 않는다', () => assert.deepEqual(shown(), ['T-FAR', 'O-NEXT']));

console.log(`\n통과 ${pass}건`);
process.exit(0);
