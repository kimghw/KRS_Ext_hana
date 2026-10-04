// 신청 내역 출장 카드의 "증빙 송부" 칸(sendbox.js + attendpanel.js) — 과제·계정을 고르고, 받는 사람을 찾아, 보관함의 증빙을
// PDF 하나로 묶어 보낸다(2026-10-03 사용자 지정). 패널을 진짜 화면(sidepanel.html)에 붙여 치고 눌러 본다.
// 보내기를 누르면 보낼 내용이 팝업으로 뜨고 팝업의 보내기를 눌러야 나간다. 과제·계정과 받는 사람은 한 세트로 기억해 같이 채운다
// (2026-10-04 사용자 지정).
// 사후정산을 아직 완료하지 않은 출장이면 `사후정산 저장`(두 번 눌러야 나간다)과 `보내기`(팝업 → 저장 → 확정 → 송부)가 선다.
// eclass 쪽지·여비계산서와 Teams MCP 는 흉내 낸다 — **실제로는 아무것도 나가지 않는다.**
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { PDFDocument } from '../vendor/pdf-lib.esm.min.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
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

/* ------------------------------------------------------------ 가짜 쪽지 사이트와 Teams MCP */

const site = { calls: [], teams: false };
const text = (body, type = 'text/html; charset=utf-8') => new Response(body, { status: 200, headers: { 'content-type': type } });
const json = (obj) => text(JSON.stringify(obj), 'application/json');

// 가짜 여비계산서(eclass /BusinessTrip) — 사후정산 저장(AfterTrip/Save)과 확정(CalPrint/Confirm)을 받는다. docs 가 계산서의 지금 단계이고
// (사전정산은 모두 완료), noConfirm 이면 "사후정산 작성" 단계의 계산서 화면에 확정 폼이 없다.
const bt = {
  docs: {
    145600: { post: '대기', trseq: '1', from: '2026-09-23', to: '2026-09-23', location: '서울 본사' },
    145580: { post: '작성', trseq: '2', from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시 킨텍스' },
    146100: { post: '대기', trseq: '3', from: '2026-09-15', to: '2026-09-16', location: '대전 KAIST' },
  },
  noConfirm: false,
};
const btPage = (body) => text(`<html><body>${body}${' '.repeat(1600)}</body></html>`);
const BT_LIST = () => `<div class="bt-topmenu"><span class="bt-user"> 김거화 (kimghw) / KOR | ENG </span></div><table id="mainList"><tbody>${
  Object.entries(bt.docs).map(([seq, d]) => `<tr><td data-href="/BusinessTrip/CalPrint?seq=${seq}">${seq}</td><td>김거화</td>`
    + `<td data-href="/BusinessTrip/CalPrint?seq=${seq}&amp;trseq=${d.trseq}"> </td><td><span>완료</span></td><td><span>${d.post}</span></td>`
    + `<td>${d.from}~${d.to}</td><td>${d.location}</td><td>김거화</td><td>2026-09-01</td></tr>`).join('')}</tbody></table>`;
const BT_STEPS = ['사전정산&#xA;작성', '사전정산&#xA;완료', '사후정산&#xA;작성', '사후정산&#xA;완료'];
const BT_CAL = (seq) => {
  const d = bt.docs[seq];
  const at = d.post === '완료' ? 3 : d.post === '작성' ? 2 : 1;
  return `<select id="drtraveler"><option value="${d.trseq}" selected="selected">김거화</option></select>
${at === 2 && !bt.noConfirm ? `<form method="post" onsubmit="return confirm('확정하시겠습니까?');" action="/BusinessTrip/CalPrint/Confirm">
<input type="hidden" name="seq" value="${seq}" /><input type="hidden" name="trseq" value="${d.trseq}" /><button type="submit">확정</button>
<input name="__RequestVerificationToken" type="hidden" value="tok-confirm" /></form>` : ''}
<form method="post" action="/BusinessTrip/CalPrint/Delete"><input type="hidden" name="seq" value="${seq}" /><input name="__RequestVerificationToken" type="hidden" value="tok-delete" /></form>
<div class="bt-steps">${BT_STEPS.map((lbl, i) => `<div class="bt-step ${i < at ? 'done' : i === at ? 'active' : ''}"><div class="dot">${i + 1}</div><div class="lbl">${lbl}</div></div>`).join('')}</div>`;
};
const BT_AFTER = (seq, trseq) => `<form method="post" id="frm" enctype="multipart/form-data" action="/BusinessTrip/AfterTrip/Save">
<input type="hidden" name="seq" value="${seq}"><input type="hidden" name="trseq" value="${trseq}"><input name="__RequestVerificationToken" type="hidden" value="tok-after"></form>`;
function btFetch(u, name, init) {
  const q = new URL(u).searchParams;
  if (init.method === 'POST' && name === 'Save') { bt.docs[init.body.get('seq')].post = '작성'; return btPage('ok'); }
  if (init.method === 'POST' && name === 'Confirm') { bt.docs[new URLSearchParams(init.body).get('seq')].post = '완료'; return btPage('ok'); }
  if (name === 'List') return btPage(BT_LIST());
  if (name === 'CalPrint') return btPage(BT_CAL(q.get('seq')));
  if (name === 'AfterTrip') return btPage(BT_AFTER(q.get('seq'), q.get('trseq')));
  throw new Error('모르는 여비계산서 주소 ' + u);
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('http://localhost:5003')) {
    if (!site.teams) throw new TypeError('Failed to fetch');
    const msg = JSON.parse(init.body);
    return json({ jsonrpc: '2.0', id: msg.id, result: msg.method === 'tools/list' ? { tools: [{ name: 'handler_teams_send_chat_message' }] } : {} });
  }
  const name = u.split('?')[0].split('/').pop();
  site.calls.push({ name, method: init.method || 'GET', body: init.body, url: u });
  if (u.includes('/BusinessTrip/')) return btFetch(u, name, init);
  if (name === 'NewMessage') return text('<form id="formMain"></form>');
  if (name === 'GetRecipientSuggestions') return json([{ userId: 'hong', userName: '홍길동', empDegree: '책임', deptName: '회계팀' }, { userId: 'hongs', userName: '홍사랑', empDegree: '선임', deptName: '총무팀' }]);
  if (name === 'SaveDraft') return json({ isSuccess: true, dId: 771 });
  if (name === 'dextuploadx5-configuration.js') return text('x = { authkey: "LIVE-KEY" }');
  if (name === 'DraftFileUp') return text('SEND:ok|1|pdf:');
  if (name === 'SendDraft') return json({ isSuccess: true });
  throw new Error('모르는 주소 ' + u);
};

/* ------------------------------------------------------------ 패널 */

const { createAttendPanel } = await import('../attendpanel.js');
const { createEvidenceStore } = await import('../src/evidence.js');
const shelf = new Map();
const evidence = createEvidenceStore({ set: async (k, v) => { shelf.set(k, v); }, delete: async (k) => { shelf.delete(k); }, all: async () => [...shelf.values()] });
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logs = [];
const panel = createAttendPanel({
  $: (id) => doc.getElementById(id), escapeHtml,
  logEvent: (kind, ok, text) => logs.push({ kind, ok, text }), ai: () => ({ apiKey: '', cli: false }), evidence,
});
panel.wire();

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const KTX = (dep, arr, date) => ({ seq: '1', trseq: '7380', revno: '', date, dep, arr, transport: 'Train', grade: '일반석', total: 53700, currency: 'KRW' });
// 당일 KTX 출장(사전정산 완료)과 1박 출장(사후정산 작성 중).
const DAY = { docNo: 'TR-1', formId: 'TR', status: '5', statusName: '결재완료', kindName: '국내출장', summary: '국내출장 9/23 07:00~20:00', reason: '선급 기술 세미나',
  from: '2026-09-23', to: '2026-09-23', start: '07:00', end: '20:00', actions: ['change', 'cancel'], web: false };
const STAY = { ...DAY, docNo: 'TR-2', summary: '국내출장 9/9~9/10 07:00~20:00', reason: 'K-Battery Show 참석', from: '2026-09-09', to: '2026-09-10' };
// 1박 출장 하나 더 — 사전정산만 완료했다(사후정산 대기). 사후정산 저장과 보내기(저장 → 확정 → 송부)를 여기서 눌러 본다.
const STAY2 = { ...DAY, docNo: 'TR-3', summary: '국내출장 9/15~9/16 07:00~20:00', reason: '공동연구 협의', from: '2026-09-15', to: '2026-09-16' };
const row = (seq) => ({ seq, href: `/BusinessTrip/CalPrint?seq=${seq}`, pre: '완료', from: bt.docs[seq].from, to: bt.docs[seq].to, location: bt.docs[seq].location, writer: '김거화', written: '2026-09-01',
  travelers: [{ name: '김거화', post: bt.docs[seq].post, trseq: bt.docs[seq].trseq }] });
const st = panel.state;
await evidence.keep('TR-1', [{ name: '점심.png', type: 'image/png', dataUrl: PNG, label: '당일출장 증명', summary: '서울식당 12,000원', date: '2026-09-23', total: 12000 }]);
Object.assign(st, {
  view: 'all', items: [DAY, STAY, STAY2], all: [DAY, STAY, STAY2], loadedOnce: true, openDoc: 'TR-1', workplace: '부산',
  trips: { rows: [row('145600'), row('145580'), row('146100')], me: '김거화' },
});
st.after['145600'] = { detail: { rows: [KTX('부산', '서울', '2026-09-23'), KTX('서울', '부산', '2026-09-23')], transports: ['Train', 'Train'] }, kept: await evidence.list('TR-1') };
st.after['145580'] = { detail: { rows: [KTX('부산', '서울', '2026-09-09'), KTX('서울', '부산', '2026-09-10')], transports: ['Train', 'Train'] }, kept: [] };
st.after['146100'] = { detail: { rows: [KTX('부산', '대전', '2026-09-15'), KTX('대전', '부산', '2026-09-16')], transports: ['Train', 'Train'] }, kept: [] };
await panel.reload();   // HR 에는 닿지 못한다 — 앉혀 둔 신청 내역이 그대로 그려진다

const box = () => doc.querySelector('#atList .at-send');
const q = (sel) => box().querySelector(sel);
const type = (sel, value) => { const el = q(sel); el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
const goBtn = () => q('button[data-act="send-go"]');
// 보내기를 누르면 뜨는 팝업 — 받는 사람·과제·계정·보내는 길(dd)과 나갈 글(제목과 본문), 버튼은 취소와 보내기다.
const pop = () => doc.querySelector('#attend .at-pop');
const popTo = () => [...pop().querySelectorAll('.at-pop-to dd')].map((n) => n.textContent);
const popLines = () => [...pop().querySelectorAll('.at-pop-body > *')].map((n) => n.textContent);
const popBtn = (act) => pop().querySelector(`button[data-pop="${act}"]`);
const sets = () => [...box().querySelectorAll('button[data-act="send-set"]')].map((b) => [b.textContent, b.classList.contains('active')]);
const HONG = { id: 'hong', name: '홍길동', title: '책임', dept: '회계팀' };
const open = async (docNo) => { st.openDoc = docNo; await panel.reload(); };

console.log('복사 버튼은 없다');
t('출장 카드의 버튼 줄에 복사가 없다 — 그 상태에서 할 일(변경·취소신청)만 있다', () => {
  assert.deepEqual([...doc.querySelectorAll('#atList .at-acts button')].map((b) => b.textContent), ['변경', '취소신청']);
});

console.log('당일 출장 — 사전정산을 마쳤고 당일증빙이 있으면 보낼 수 있다');
t('송부 칸에 어느 길로 무엇이 가는지 적히고, 과제·계정과 받는 사람을 묻는다. 정하기 전에는 보내기가 잠겨 있다', () => {
  assert.equal(q('.at-send-head strong').textContent, '증빙 송부');
  assert.equal(q('.at-send-how').textContent, '쪽지 · 당일출장 증명 1장 → PDF 1개');
  assert.deepEqual([...box().querySelectorAll('.at-send-row .at-label')].map((n) => n.textContent), ['과제·계정', '받는 사람']);
  assert.deepEqual([q('input[data-send="account"]').placeholder, q('input[data-send="person"]').placeholder], ['과제 또는 계정을 직접 적기', '이름·ID 로 찾기']);
  assert.deepEqual(sets(), [], '아직 보낸 곳이 없다');
  assert.deepEqual([goBtn().textContent, goBtn().disabled, goBtn().getAttribute('aria-haspopup'), pop()], ['보내기', true, 'dialog', null]);
});
type('input[data-send="account"]', 'RND-2026-01');
t('과제·계정을 직접 적어도 받는 사람이 없으면 아직 잠겨 있다 — 치는 동안 칸은 그대로다(다시 그리지 않는다)', () => {
  assert.equal(goBtn().disabled, true);
  assert.equal(q('input[data-send="account"]').value, 'RND-2026-01');
});
type('input[data-send="person"]', '홍');
await wait(320);
await ta('받는 사람 칸에 치면 쪽지의 받는 사람 조회로 찾아 보여 준다', async () => {
  assert.deepEqual([...box().querySelectorAll('.at-send-hits button')].map((b) => b.textContent), ['홍길동 책임 · 회계팀', '홍사랑 선임 · 총무팀']);
  assert.match(site.calls.at(-1).url, /GetRecipientSuggestions\?query=%ED%99%8D$/);
});
q('.at-send-hits button[data-id="hong"]').click();
t('찾은 사람을 누르면 받는 사람이 정해지고 보내기가 풀린다 — 보낼 내용은 카드에 늘어놓지 않는다', () => {
  assert.equal(q('.at-send-picked').textContent, '홍길동 책임 · 회계팀×');
  assert.equal(q('.at-send-preview'), null);
  assert.deepEqual([goBtn().disabled, pop()], [false, null]);
});
site.calls.length = 0;
goBtn().click();
t('보내기를 누르면 보낼 내용이 팝업으로 뜬다 — 받는 사람·과제·계정·보내는 길과, 나갈 글(제목과 본문) 그대로. 아직 아무것도 나가지 않는다', () => {
  assert.deepEqual([pop().querySelector('[role="dialog"]').getAttribute('aria-modal'), pop().querySelector('h3').textContent], ['true', '보낼 내용']);
  assert.deepEqual(popTo(), ['홍길동 책임 · 회계팀', 'RND-2026-01', '쪽지 · 당일출장 증명 1장 → PDF 1개']);
  assert.deepEqual(popLines(), ['[여비 증빙] RND-2026-01 · 김거화 9/23 서울 본사', '여비계산서 증빙을 보냅니다.', '과제·계정: RND-2026-01', '출장자: 김거화',
    '출장: 2026-09-23 · 서울 본사', '목적: 선급 기술 세미나', '여비계산서: 145600 (사전정산 완료)', '첨부: 여비증빙_145600_김거화.pdf — 당일출장 증명 1장']);
  assert.deepEqual([...pop().querySelectorAll('.at-pop-btns button')].map((b) => b.textContent), ['취소', '보내기']);
  assert.equal(pop().querySelector('.at-pop-note'), null, '당일 출장은 사후정산을 저장·확정할 일이 없다');
  assert.equal(doc.activeElement, popBtn('go'), '초점은 팝업의 보내기에 간다');
  assert.equal(site.calls.length, 0);
});
popBtn('cancel').click();
await wait(60);
t('팝업의 취소는 아무것도 보내지 않고 닫는다 — 초점은 카드의 보내기로 돌아온다', () => {
  assert.deepEqual([pop(), site.calls.length, store.sendDone], [null, 0, undefined]);
  assert.equal(doc.activeElement, goBtn());
});
goBtn().click();
pop().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
t('Esc 도 닫는다', () => assert.deepEqual([pop(), site.calls.length], [null, 0]));
goBtn().click();
pop().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
t('팝업 바깥(어두운 자리)을 눌러도 닫는다', () => assert.deepEqual([pop(), site.calls.length], [null, 0]));
goBtn().click();
popBtn('go').click();
await wait(150);
await ta('팝업의 보내기 — Teams MCP 가 없으면 쪽지로: 증빙을 PDF 로 묶어 임시저장 → 첨부 → 저장 → 보내기 차례로 나간다', async () => {
  assert.equal(pop(), null, '보내기를 누르면 팝업은 닫힌다');
  assert.deepEqual(site.calls.map((c) => c.name), ['NewMessage', 'SaveDraft', 'dextuploadx5-configuration.js', 'DraftFileUp', 'SaveDraft', 'SendDraft']);
  const first = Object.fromEntries(new URLSearchParams(site.calls[1].body));
  assert.deepEqual([first.to, first.title, first.dId], ['hong', '[여비 증빙] RND-2026-01 · 김거화 9/23 서울 본사', '']);
  assert.match(first.content, /^<p>여비계산서 증빙을 보냅니다\.<\/p><p>과제·계정: RND-2026-01<\/p>/);
  const file = site.calls[3].body.get('DEXTUploadX5_FileData');
  assert.deepEqual([file.name, file.type], ['여비증빙_145600_김거화.pdf', 'application/pdf']);
  assert.equal((await PDFDocument.load(new Uint8Array(await file.arrayBuffer()))).getPageCount(), 1, '영수증 한 장이 한 쪽이다');
  assert.equal(doc.getElementById('atStatus').textContent, '쪽지로 보냈습니다 — 홍길동 책임 · 회계팀 · RND-2026-01 · 여비증빙_145600_김거화.pdf(1쪽)');
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /증빙 송부\(쪽지\): 145600 → hong · RND-2026-01/.test(l.text)));
});
t('보낸 뒤 — 과제·계정과 받는 사람이 한 세트로 남고, 카드에 보낸 기록이 적히며 버튼은 "다시 보내기"다', () => {
  assert.deepEqual(store.sendSets, [{ account: 'RND-2026-01', person: HONG }]);
  assert.deepEqual([store.sendAccounts, store.sendPeople], [undefined, undefined], '따로 기억하지 않는다');
  assert.deepEqual([store.sendDone['TR-1'].channel, store.sendDone['TR-1'].to, store.sendDone['TR-1'].account, store.sendDone['TR-1'].pages], ['쪽지', '홍길동', 'RND-2026-01', 1]);
  assert.match(q('.at-send-note.ok').textContent, /^보냈습니다 — \d+\/\d+ \d\d:\d\d · 쪽지 · 홍길동 · RND-2026-01$/);
  assert.equal(goBtn().textContent, '다시 보내기');
  assert.deepEqual([...box().querySelectorAll('.at-send-row .at-label')].map((n) => n.textContent), ['최근에 보낸 곳', '과제·계정', '받는 사람']);
  assert.deepEqual(sets(), [['RND-2026-01 · 홍길동', true]]);
});

console.log('숙박·비행기가 있는 출장 — 사후정산이 완료된 뒤에 보낸다');
await open('TR-2');
t('사후정산을 쓰는 중이면 `사후정산 저장`과 `보내기`가 선다 — 보관한 증빙이 없으면 보내기는 잠겨 있고, 증빙은 위의 사후정산 칸에 넣는다', () => {
  assert.equal(q('.at-send-how').textContent, '보낼 증빙이 없습니다 — 증빙을 넣어 주세요');
  assert.deepEqual([...box().querySelectorAll('.at-send-btns button')].map((b) => [b.textContent, b.disabled]), [['사후정산 저장', false], ['보내기', true]]);
  assert.equal(q('.at-send-add'), null, '읽지 않고 담는 칸은 사후정산이 완료된 뒤에만 선다');
  assert.equal(q('.at-send-note').textContent, '보내기는 사후정산을 저장하고 확정(완료)한 뒤에 보냅니다');
});
st.trips.rows[1].travelers[0].post = '완료';
bt.docs[145580].post = '완료';
await open('TR-2');
t('사후정산이 완료됐는데 보관한 증빙이 없으면 넣으라고 한다 — 가장 최근에 보낸 세트(과제·계정 + 받는 사람)가 미리 채워져 있다', () => {
  assert.equal(q('.at-send-how').textContent, '보낼 증빙이 없습니다 — 증빙을 넣어 주세요');
  assert.equal(q('.at-send-add span').textContent, '증빙 넣기 · 읽지 않고 그대로 묶습니다');
  assert.deepEqual(sets(), [['RND-2026-01 · 홍길동', true]]);
  assert.deepEqual([q('input[data-send="account"]').value, q('.at-send-picked').textContent], ['RND-2026-01', '홍길동 책임 · 회계팀×']);
  assert.equal(box().querySelector('button[data-act="send-account"], button[data-act="send-person"]'), null, '과제·계정과 받는 사람을 따로 고르는 칩은 없다');
  assert.equal(goBtn().disabled, true);
  assert.equal(q('button[data-act="send-save"]'), null, '완료된 사후정산에는 저장 버튼이 없다');
});
{
  const input = q('input[data-send="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [new window.File([Buffer.from(PNG.split(',')[1], 'base64')], '호텔영수증.png', { type: 'image/png' }),
    new window.File(['x'], '메모.txt', { type: 'text/plain' })] });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(80);
}
await ta('송부 칸에 넣은 증빙은 읽지 않고 보관함에 담긴다(그림·PDF 만) — 무엇이 묶이는지 목록으로 보이고 × 로 뺄 수 있다', async () => {
  assert.deepEqual((await evidence.list('TR-2')).map((k) => [k.label, k.name, k.trip.seq]), [['증빙', '호텔영수증.png', '145580']]);
  assert.deepEqual([...box().querySelectorAll('.at-send-files li span')].map((n) => n.textContent), ['증빙 · 호텔영수증.png']);
  assert.equal(q('.at-send-files button[data-act="kept-drop"]').dataset.name, '호텔영수증.png');
  assert.equal(q('.at-send-how').textContent, '쪽지 · 증빙 1장 → PDF 1개');
});
q('button[data-act="send-person-clear"]').click();
type('input[data-send="account"]', '');
t('받는 사람을 지우고 과제·계정을 비우면 세트 칩이 꺼지고 보내기가 잠긴다 — 손댄 카드에는 다시 깔아 주지 않는다', () => {
  assert.deepEqual([sets(), q('input[data-send="account"]').value, q('.at-send-picked'), goBtn().disabled], [[['RND-2026-01 · 홍길동', false]], '', null, true]);
});
q('button[data-act="send-set"]').click();
t('세트 칩 하나가 과제·계정과 받는 사람을 함께 채운다 — 곧바로 보낼 수 있다', () => {
  assert.deepEqual([q('input[data-send="account"]').value, q('.at-send-picked').textContent, goBtn().disabled], ['RND-2026-01', '홍길동 책임 · 회계팀×', false]);
  assert.deepEqual(sets(), [['RND-2026-01 · 홍길동', true]]);
  goBtn().click();
  assert.equal(popLines()[0], '[여비 증빙] RND-2026-01 · 김거화 9/9~9/10 경기도 고양시 킨텍스');
  assert.equal(popLines().at(-2), '여비계산서: 145580 (사후정산 완료)');
  popBtn('cancel').click();
});

console.log('사후정산이 완료된 출장 줄에 끌어다 놓은 파일도 보낼 증빙으로 담긴다');
{
  const li = doc.querySelector('#atList li.open');
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  ev.dataTransfer = { types: ['Files'], files: [new window.File([Buffer.from(PNG.split(',')[1], 'base64')], '항공권.png', { type: 'image/png' })] };
  li.querySelector('.at-head').dispatchEvent(ev);
  await wait(80);
}
await ta('사후정산을 다시 올리지 않고(끝난 정산이다) 보관함에만 담는다 — 묶일 증빙이 두 장이 된다', async () => {
  assert.deepEqual((await evidence.list('TR-2')).map((k) => k.name), ['호텔영수증.png', '항공권.png']);
  assert.equal(q('.at-send-how').textContent, '쪽지 · 증빙 2장 → PDF 1개');
  // 사후정산을 쓰는 중이던 카드는 숙박비 내역을 읽으러(GET) 입력 화면에 간다 — 여기서 보는 것은 올리지(Save) 않았다는 것이다.
  assert.ok(!site.calls.some((c) => /AfterTrip\/Save/.test(c.url) || (/AfterTrip/.test(c.url) && c.method !== 'GET')));
});

console.log('Teams MCP 가 떠 있어도 파일을 보내는 도구가 없으면 쪽지로 간다');
site.teams = true;
site.calls.length = 0;
type('input[data-send="account"]', '일반관리비');
goBtn().click();
popBtn('go').click();
await wait(150);
await ta('보내는 순간에 다시 확인하고, 쪽지로 보낸다 — 과제·계정만 바꿔 보낸 것이 새 세트로 맨 앞에 선다(받는 사람은 그대로)', async () => {
  assert.deepEqual(site.calls.map((c) => c.name), ['NewMessage', 'SaveDraft', 'dextuploadx5-configuration.js', 'DraftFileUp', 'SaveDraft', 'SendDraft']);
  assert.deepEqual(store.sendSets, [{ account: '일반관리비', person: HONG }, { account: 'RND-2026-01', person: HONG }]);
  assert.deepEqual(sets(), [['일반관리비 · 홍길동', true], ['RND-2026-01 · 홍길동', false]]);
  assert.equal(store.sendDone['TR-2'].channel, '쪽지');
  assert.equal(q('.at-send-how').title, 'Teams MCP 는 연결돼 있지만 파일을 보내는 도구가 없어 쪽지로 보냅니다');
});

console.log('보내다 실패하면 카드에 까닭이 남는다');
{
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).endsWith('/DraftFileUp?pType=SEND') ? text('ERROR') : real(url, init));
  goBtn().click();
  popBtn('go').click();
  await wait(150);
  globalThis.fetch = real;
}
t('사이트가 첨부를 받지 않으면 보내지 않고, 최근 목록도 보낸 기록도 바뀌지 않는다', () => {
  assert.match(q('.at-send-note.error').textContent, /사이트가 첨부를 받지 않았습니다/);
  assert.match(doc.getElementById('atStatus').textContent, /^증빙 송부 실패: 사이트가 첨부를 받지 않았습니다/);
  assert.deepEqual(store.sendSets.map((x) => x.account), ['일반관리비', 'RND-2026-01']);
  assert.ok(logs.some((l) => l.kind === 'trip' && !l.ok && /증빙 송부 실패/.test(l.text)));
});

console.log('사후정산을 아직 완료하지 않은 출장 — 사후정산 저장, 보내기(저장 → 확정 → 송부)');
await evidence.keep('TR-3', [{ name: '호텔.png', type: 'image/png', dataUrl: PNG, label: '숙박 증빙', summary: '대전호텔 1박 110,000원', date: '2026-09-16', total: 110000 }]);
st.after['146100'].kept = await evidence.list('TR-3');
await open('TR-3');
const saveBtn = () => q('button[data-act="send-save"]');
const status = () => doc.getElementById('atStatus').textContent;
const tripline = () => doc.querySelector('#atList li.open .at-tripline').textContent;
// 사이트에 간 것 가운데 계산서를 바꾸는 요청과 쪽지 보내기만 — 숙박비 내역을 읽으러 가는 GET 은 뺀다.
const writes = () => site.calls.filter((c) => ['Save', 'Confirm', 'SendDraft'].includes(c.name)).map((c) => c.name);
t('사전정산만 완료한 1박 출장: 송부 칸이 열리고 `사후정산 저장`·`보내기`가 선다 — 가장 최근에 보낸 세트가 깔려 있어 보내기가 풀려 있다', () => {
  assert.match(tripline(), /여비계산서 146100 · 사전정산 완료/);
  assert.equal(q('.at-send-how').textContent, '쪽지 · 숙박 증빙 1장 → PDF 1개');
  assert.deepEqual([q('input[data-send="account"]').value, q('.at-send-picked').textContent], ['일반관리비', '홍길동 책임 · 회계팀×']);
  assert.deepEqual([...box().querySelectorAll('.at-send-btns button')].map((b) => [b.textContent, b.disabled]), [['사후정산 저장', false], ['보내기', false]]);
});
site.calls.length = 0;
saveBtn().click();
t('사후정산 저장 — 첫 번째 누름은 무엇을 저장하는지 적어 보여주기만 한다', () => {
  assert.deepEqual([saveBtn().textContent, saveBtn().classList.contains('armed'), writes()], ['한 번 더 → 저장', true, []]);
  assert.equal(status(), '저장할 사후정산 — 여비계산서 146100 · 국내출장 9/15~9/16 07:00~20:00 · 카드에 있는 대로 저장합니다(확정은 하지 않습니다)');
});
saveBtn().click();
await until(() => writes().length === 1 && !st.after['146100'].busy && /사후정산 작성/.test(tripline()), '사후정산 저장');
t('두 번째 누름에 저장이 나간다 — 바꾼 편이 없으면 입력 화면의 폼 그대로이고, 단계가 "사후정산 작성"이 된다. 확정도 송부도 하지 않는다', () => {
  assert.deepEqual(writes(), ['Save']);
  const body = site.calls.find((c) => c.name === 'Save').body;
  assert.deepEqual([...body.keys()], ['seq', 'trseq', '__RequestVerificationToken']);
  assert.deepEqual([body.get('seq'), body.get('trseq')], ['146100', '3']);
  assert.equal(status(), '사후정산을 저장했습니다 — 화면에 있는 그대로');
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && l.text === '여비계산서(사후정산) 저장: 146100 · 화면에 있는 그대로'));
  assert.deepEqual([...box().querySelectorAll('.at-send-btns button')].map((b) => b.textContent), ['사후정산 저장', '보내기'], '아직 확정하지 않았다');
});
const legBtn = (leg, mode) => doc.querySelector(`#atList li.open button[data-act="leg"][data-leg="${leg}"][data-t="${mode}"]`);
const saveTwice = async () => {
  site.calls.length = 0;
  saveBtn().click();
  saveBtn().click();
  await until(() => writes().length === 1 && !st.after['146100'].busy, '사후정산 저장');
  return site.calls.find((c) => c.name === 'Save').body;
};
legBtn('go', 'plane').click();
{
  const body = await saveTwice();
  t('값을 모르는 편이 있으면(비행기로 바꿨는데 항공권이 없다) 교통비 내역은 올리지 않는다 — 아는 편만 올리면 화면의 교통 줄이 지워진다', () => {
    assert.deepEqual([...body.keys()], ['seq', 'trseq', '__RequestVerificationToken']);
    assert.match(doc.querySelector('#atList li.open .at-after > .at-after-note:not(.error)').textContent,
      /^교통비 내역은 사후정산 화면에 있는 그대로 두었습니다 — 가는 편: 비행기 요금을 모릅니다 — 항공권을 넣어 주세요/);
  });
}
legBtn('go', 'train').click();
legBtn('go', 'train').click();
{
  const body = await saveTwice();
  t('가는 편을 KTX 특실로 바꿨으면 두 편이 교통비 내역으로 올라간다(운임표의 정가)', () => {
    assert.deepEqual([body.getAll('tr_date'), body.getAll('tr_transport'), body.getAll('tr_grade')],
      [['2026-09-15', '2026-09-16'], ['기차(KTX등)', '기차(KTX등)'], ['특실', '일반석']]);
    assert.match(status(), /^사후정산을 저장했습니다 — KTX 2026-09-15 부산→대전 [\d,]+원 · KTX 2026-09-16 대전→부산 53,700원$/, '오는 편은 사전정산의 줄 그대로다');
  });
}
bt.noConfirm = true;
site.calls.length = 0;
goBtn().click();
t('보내기 — 팝업이 저장·확정부터 한다고 적어 보여 준다(두 번 누르기를 대신한다). 보낼 내용의 단계는 확정한 뒤의 것(사후정산 완료)이다', () => {
  assert.deepEqual([goBtn().textContent, goBtn().classList.contains('armed'), writes()], ['보내기', false, []]);
  assert.deepEqual(popTo(), ['홍길동 책임 · 회계팀', '일반관리비', '쪽지 · 숙박 증빙 1장 → PDF 1개']);
  assert.equal(popLines().at(-2), '여비계산서: 146100 (사후정산 완료)');
  assert.equal(pop().querySelector('.at-pop-note').textContent, '사후정산을 저장하고 확정(완료)한 뒤에 증빙을 보냅니다 — 여비계산서 146100');
  assert.equal(popBtn('go').textContent, '저장·확정 후 보내기');
});
popBtn('go').click();
await until(() => !!q('.at-send-note.error'), '확정 실패');
t('계산서 화면에 확정 버튼이 없으면 저장까지만 하고 멈춘다 — 까닭을 적고 증빙은 보내지 않는다', () => {
  assert.deepEqual(writes(), ['Save']);
  assert.match(q('.at-send-note.error').textContent, /^사후정산 확정 실패: 계산서 화면에 사후정산 확정 버튼이 없습니다\(지금 단계: 사후정산 작성\)/);
  assert.match(status(), /^사후정산 확정 실패: /);
  assert.match(tripline(), /사후정산 작성/);
  assert.equal(store.sendDone['TR-3'], undefined);
  assert.ok(logs.some((l) => l.kind === 'trip' && !l.ok && /사후정산 완료\(확정\) 실패: 146100/.test(l.text)));
});

bt.noConfirm = false;
site.calls.length = 0;
goBtn().click();
popBtn('go').click();
await until(() => !!store.sendDone['TR-3'], '저장 → 확정 → 송부');
await ta('보내기 — 사후정산을 저장하고, 계산서 화면의 확정 폼을 그대로 보내고, 목록에서 완료를 확인한 뒤에 증빙을 보낸다', async () => {
  assert.deepEqual(writes(), ['Save', 'Confirm', 'SendDraft']);
  assert.equal(String(site.calls.find((c) => c.name === 'Confirm').body), 'seq=146100&trseq=3&__RequestVerificationToken=tok-confirm');
  const first = Object.fromEntries(new URLSearchParams(site.calls.find((c) => c.name === 'SaveDraft').body));
  assert.equal(first.title, '[여비 증빙] 일반관리비 · 김거화 9/15~9/16 대전 KAIST');
  assert.match(first.content, /<p>여비계산서: 146100 \(사후정산 완료\)<\/p>/);
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && l.text === '여비계산서 사후정산 완료(확정): 146100'));
});
t('보낸 뒤 — 카드의 단계가 "사후정산 완료"가 되고 저장 버튼이 사라지며, 보낸 기록이 남는다', () => {
  assert.match(tripline(), /여비계산서 146100 · 사후정산 완료/);
  assert.equal(saveBtn(), null);
  assert.equal(goBtn().textContent, '다시 보내기');
  assert.match(q('.at-send-note.ok').textContent, /· 쪽지 · 홍길동 · 일반관리비$/);
  assert.deepEqual([...box().querySelectorAll('.at-send-files li span')].map((n) => n.textContent), ['숙박 증빙 · 호텔.png']);
});

console.log('세트로 기억하기 전의 기록(과제·계정과 받는 사람을 따로 기억하던 때)에서 세트를 짓는다');
{
  const { createSendBox } = await import('../sendbox.js');
  const old = {
    sendAccounts: ['B-계정', 'A-과제'], sendPeople: [HONG, { id: 'kim', name: '김담당' }],
    sendDone: { 'D-1': { at: 1, to: '홍길동', account: 'A-과제' }, 'D-2': { at: 2, to: '김담당', account: 'B-계정' }, 'D-3': { at: 3, to: '없는 사람', account: 'C-과제' } },
  };
  const realGet = chrome.storage.local.get;
  chrome.storage.local.get = async () => old;
  const fresh = createSendBox({ escapeHtml, logEvent: () => {}, evidence, setStatus: () => {}, setError: () => {}, repaint: () => {}, readFile: async () => '' });
  await fresh.load();
  t('보낸 기록마다 그때의 과제·계정과 받는 사람을 짝짓는다(최근에 보낸 것이 앞) — 받는 사람을 못 찾은 기록은 버린다', () => {
    assert.deepEqual(fresh.state.sets, [{ account: 'B-계정', person: { id: 'kim', name: '김담당' } }, { account: 'A-과제', person: HONG }]);
    assert.deepEqual(Object.keys(fresh.state.done), ['D-1', 'D-2', 'D-3']);
  });
  // 패널을 다시 열었을 때 — 저장해 둔 세트를 그대로 읽는다(다섯까지, 모양이 다른 것은 버린다).
  const many = [1, 2, 3, 4, 5, 6].map((i) => ({ account: `과제-${i}`, person: HONG }));
  chrome.storage.local.get = async () => ({ ...old, sendSets: [{ account: '', person: HONG }, { account: '사람 없음' }, ...many] });
  await fresh.load();
  chrome.storage.local.get = realGet;
  t('저장해 둔 세트가 있으면 그것을 읽는다 — 예전 기록에서 다시 짓지 않는다', () => {
    assert.deepEqual(fresh.state.sets.map((x) => x.account), ['과제-1', '과제-2', '과제-3', '과제-4', '과제-5']);
  });
}

console.log(`\n통과 ${pass}건`);
process.exit(0);
