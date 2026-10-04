// 출장지마다 지난번에 쓴 교통편을 기억했다가 다음에 먼저 쓴다 — 패널에서(2026-10-04 사용자 지정, 셈은 src/routes.js · test/routes.test.mjs).
//
// 못 박는 것: 출장 카드를 펴서 사전정산의 교통편 줄을 읽으면 그 출장지의 교통편으로 저장소(tripRoutes)에 남고 — 사이트에서 손으로 고친
// 줄까지 — 신청 폼에 같은 출장지를 적으면 사전정산의 KTX 가 그 길로 지어진다. 예전 출장을 펴도 요즘 것을 덮어쓰지 않는다.
// eclass 는 흉내 낸다 — **실제 사이트에는 아무것도 보내지 않는다**(여기서는 읽기만 나간다).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, what) => {
  for (let i = 0; i < 200 && !ok(); i++) await wait(25);
  assert.ok(ok(), `기다렸지만 되지 않았다: ${what}`);
};

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { window } = new JSDOM(html, { url: 'https://example.org/' });
const doc = window.document;
for (const g of ['document', 'DOMParser', 'FileReader', 'Element', 'HTMLElement', 'HTMLInputElement']) globalThis[g] = window[g];
globalThis.window = window;

const store = {};
globalThis.chrome = {
  storage: { local: { get: async () => store, set: async (obj) => { Object.assign(store, obj); } } },
  runtime: { sendNativeMessage: async () => { throw new Error('no host'); } },
  tabs: { query: async () => [], create: async () => {} },
  scripting: { executeScript: async () => [{ result: null }] },
};

/* ------------------------------------------------------------ 가짜 eclass 여비계산서 */

const page = (body) => new Response(`<html><body>${body}${' '.repeat(1600)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
// 계산서 둘 — 같은 출장지(킨텍스)로 간 9월 출장과 7월 출장. 9월 것은 사이트에서 내릴 역을 광명으로 고쳐 둔 것이다(패널이 지으면 서울이다).
const DOCS = {
  145580: { from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시 킨텍스', legs: [['2026-09-09', '부산', '광명'], ['2026-09-10', '광명', '부산']] },
  141000: { from: '2026-07-01', to: '2026-07-01', location: '경기도 고양시 킨텍스', legs: [['2026-07-01', '부산', '서울'], ['2026-07-01', '서울', '부산']] },
};
const gets = [];
const LIST = () => `<div class="bt-topmenu"><span class="bt-user"> 김거화 (kimghw) / KOR | ENG </span></div><table id="mainList"><tbody>${
  Object.entries(DOCS).map(([seq, d]) => `<tr><td data-href="/BusinessTrip/Write?seq=${seq}&amp;mode=E">${seq}</td><td>김거화</td><td data-href=""> </td>`
    + `<td><span>작성</span></td><td><span>대기</span></td><td>${d.from}~${d.to}</td><td>${d.location}</td><td>김거화</td><td>2026-06-20</td></tr>`).join('')
}</tbody></table><div class="bt-pager"><div>전체 2건 · 1/1 페이지</div></div>`;
const TR = ([date, dep, arr], i) => `<tr><td><input type="hidden" name="tr_seq" value="${i + 1}"/><input type="hidden" name="tr_del" value="0"/>
<input type="hidden" name="tr_trseq" value=""/><input type="hidden" name="tr_revno" value=""/><input type="date" name="tr_date" value="${date}"/></td>
<td><input type="text" name="tr_dep" value="${dep}"/></td><td><input type="text" name="tr_arr" value="${arr}"/></td>
<td><select name="tr_transport"><option value="Train" selected="selected">기차(KTX등)</option><option value="Airplane">비행기</option></select></td>
<td><input type="text" name="tr_grade" value="일반석"></td><td><input type="text" name="tr_total" value="52200" readonly /></td>
<td><select name="tr_currency"><option value="KRW" selected="selected">KRW</option></select></td></tr>`;
const WRITE = (seq) => `<form id="frm"><input type="hidden" name="seq" value="${seq}"><input type="hidden" name="sHour" value="7"><input type="hidden" name="eHour" value="20">
<table><tbody id="transBody">${DOCS[seq].legs.map(TR).join('')}</tbody></table><input name="__RequestVerificationToken" type="hidden" value="tok"></form>`;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (init.method === 'POST') throw new Error('이 테스트에서는 쓰기 요청이 나가면 안 된다: ' + u);
  gets.push(u.replace(/^https:\/\/[^/]+/, '').replace(/&returnUrl=.*$/, ''));
  if (u.includes('/Home/List')) return page(LIST());
  if (u.includes('/BusinessTrip/Write?')) return page(WRITE(new URL(u).searchParams.get('seq')));
  throw new Error('모르는 주소 ' + u);
};

/* ------------------------------------------------------------ 패널 */

const { parseTripList } = await import('../src/travel.js');
const { ROUTES_KEY } = await import('../src/routes.js');
const { createAttendPanel } = await import('../attendpanel.js');
const { createEvidenceStore } = await import('../src/evidence.js');
const shelf = new Map();
const evidence = createEvidenceStore({ set: async (k, v) => { shelf.set(k, v); }, delete: async (k) => { shelf.delete(k); }, all: async () => [...shelf.values()] });
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const panel = createAttendPanel({ $: (id) => doc.getElementById(id), escapeHtml, logEvent: () => {}, ai: () => ({ apiKey: 'sk-x', cli: false }), evidence });
panel.wire();
const st = panel.state;

const item = (docNo, from, to) => ({ docNo, formId: 'TR', status: '5', statusName: '결재완료', kindName: '국내출장',
  summary: `국내출장 ${+from.slice(5, 7)}/${+from.slice(8)} 07:00~20:00`, reason: 'K-Battery Show 참석', from, to, start: '07:00', end: '20:00', actions: [], web: false });
const SEP = item('TR-9', '2026-09-09', '2026-09-10');
const JUL = item('TR-7', '2026-07-01', '2026-07-01');
/** 패널이 목록을 읽은 것처럼 앉힌 뒤 그 줄을 편다 — 사전정산의 교통편은 패널이 사이트에서 읽는다(미리 앉히지 않는다). */
async function open(docNo, seq) {
  Object.assign(st, { view: 'all', items: [SEP, JUL], all: [SEP, JUL], loadedOnce: true, openDoc: docNo, workplace: '부산',
    trips: { rows: parseTripList(new JSDOM(LIST()).window.document), me: '김거화' } });
  await panel.reload();
  await until(() => st.after[seq]?.detail, `${seq} 의 사전정산 교통편 읽기`);
}
const KEY = '경기도 고양시 킨텍스';

console.log('출장 카드를 펴면 그 출장지의 교통편을 기억한다');
await open('TR-9', 145580);
t('사전정산의 교통편 줄(사이트에서 광명으로 고친 것)을 읽어 그 출장지의 교통편으로 저장한다 — 읽기만 했다', () => {
  assert.deepEqual(store[ROUTES_KEY], { [KEY]: { transport: ['train'], trainGrade: 'standard', path: ['부산', '광명'], date: '2026-09-09' } });
  assert.ok(gets.some((g) => g.startsWith('/BusinessTrip/Write?seq=145580')));
});
await open('TR-7', 141000);
t('예전 출장(7월, 서울)을 펴도 요즘 것(9월, 광명)을 덮어쓰지 않는다', () =>
  assert.deepEqual(store[ROUTES_KEY][KEY].path, ['부산', '광명']));

console.log('같은 출장지를 다시 신청하면');
// 패널을 새로 연 것처럼 — 종류 줄과 폼이 그려지고, 저장해 둔 기억을 되읽는다.
Object.assign(st, { view: '', openDoc: null, routes: {} });
Object.assign(store, { attendKind: 'trip', attendWorkplace: '부산' });
st.form = { ...st.form, kind: '' };
await panel.show();
doc.querySelector('#atKinds .at-kind[data-kind="trip"]').click();
const fire = (id, value, ...events) => {
  const input = doc.getElementById(id);
  input.value = value;
  for (const name of events) input.dispatchEvent(new window.Event(name, { bubbles: true }));
};
fire('at_purpose', '전시회 참석', 'input');
const box = doc.getElementById('at_settle');
box.checked = true;
box.dispatchEvent(new window.Event('change', { bubbles: true }));
fire('at_place', KEY, 'input', 'change');
t('사전정산의 KTX 는 지난번의 길(광명)이 먼저다 — 요금은 지금 운임표의 정가이고, 다시 쓴 길이라고 적힌다', () =>
  assert.match(doc.getElementById('atNeed').textContent, /경기도 고양시 킨텍스 · KTX 부산↔광명 일반석 52,200원 × 2 · 지난번에 쓴 길$/));
fire('at_place', '경기도 고양시', 'input', 'change');
t('적은 글이 다르면 다른 출장지다 — 길을 찾아서 짓는다(고양은 서울)', () =>
  assert.match(doc.getElementById('atNeed').textContent, /경기도 고양시 · KTX 부산↔서울 일반석 54,400원 × 2$/));

console.log(`\n통과 ${pass}건`);
process.exit(0);   // 패널이 걸어 둔 타이머가 남아 있어도 끝낸다
