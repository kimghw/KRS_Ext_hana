// 신청 내역 출장 카드의 "여비증빙 송부" 칸(sendbox.js + attendpanel.js) — 과제·계정을 고르고, 받는 사람을 찾아, 보관함의 증빙을
// PDF 하나로 묶어 보낸다(2026-10-03 사용자 지정). 패널을 진짜 화면(sidepanel.html)에 붙여 치고 눌러 본다.
// 보내기를 누르면 보낼 내용이 팝업으로 뜨고 팝업의 보내기를 눌러야 나간다. 과제·계정과 받는 사람, 보내는 길은 한 세트로 기억해
// 이전에 보낸 곳 세 줄로 보이고, 직접 고르는 칸은 접혀 있다(2026-10-04 사용자 지정).
// 사후정산을 아직 완료하지 않은 출장이면 `보내기`(팝업 → 저장 → 확정 → 송부)가 선다.
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

// teams 는 가짜 Teams MCP 가 떠 있는가 — true 면 글만 보내는 예전 서버, 'file' 이면 파일을 보내는 도구가 있는 서버다. sent 는 그 도구로 간 것.
// report 는 가짜 리포트 서버(ClipReport)에 간 것 — 보낼 때 여비계산서를 PDF 로 받는 길이다. noReport 면 그 서버가 계산서를 열지 못한다.
const site = { calls: [], teams: false, sent: [], report: [], noReport: false };
// 가짜 리포트 서버가 내주는 여비계산서 PDF — 한 쪽(300×400). 증빙 쪽(A4)과는 크기로 가린다.
const CAL_PDF = await PDFDocument.create().then((d) => { d.addPage([300, 400]); return d.save(); });
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
<div class="bt-steps">${BT_STEPS.map((lbl, i) => `<div class="bt-step ${i < at ? 'done' : i === at ? 'active' : ''}"><div class="dot">${i + 1}</div><div class="lbl">${lbl}</div></div>`).join('')}</div>
<iframe id="ClipReportFm" name="ClipReportFm"></iframe>
<script>window.addEventListener('load', function () {
  var viewUrl = 'https://eclass.krs.co.kr' + '/ClipReport/reportView.aspx';
  var rebUrl = 'https://eclass.krs.co.kr/intra/intranet/VSDotNet/BusinessTrip/rebfiles/rptCalResult.reb';
  var fields = { crfName: encodeURI(rebUrl), xmlData: '', dataConnetion: 'sql_krextra', param: 'MSEQ=${seq}:TSEQ=${d.trseq}:LAN=K', saveReportType: 'pdf' };
});</script>`;
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
    const tools = [{ name: 'handler_teams_send_chat_message' }, ...(site.teams === 'file' ? [{ name: 'handler_teams_send_chat_file' }] : [])];
    if (msg.method === 'tools/call') site.sent.push(msg.params);
    return json({ jsonrpc: '2.0', id: msg.id, result: msg.method === 'tools/list' ? { tools }
      : msg.method === 'tools/call' ? { content: [{ type: 'text', text: JSON.stringify({ success: true, message_id: 'm-1' }) }] } : {} });
  }
  if (u.includes('/ClipReport/')) {
    // 리포트 서버 — 계산서를 열고(reportView), 다 그렸다고 답하고, PDF 를 만들어 내준다(src/calpdf.js 가 따르는 차례).
    const form = new URLSearchParams(init.body);
    if (u.endsWith('/reportView.aspx')) {
      site.report.push(`view ${form.get('param')}`);
      // 계산서를 출력한 순간의 사후정산 단계 — 확정한 뒤에 출력하는지 본다.
      site.printedAt = bt.docs[/MSEQ=(\d+)/.exec(form.get('param'))[1]].post;
      return text(site.noReport ? '<script>alert("report error")</script>' : `<script>var reportkey = '{"uid":"key-1","reportkey":"key-1","status":true}';</script>`);
    }
    const type = form.get('ClipType');
    site.report.push(type);
    if (type === 'PDFPrintDownload') return new Response(CAL_PDF, { status: 200, headers: { 'content-type': 'application/pdf' } });
    return json({ id: 0, resValue: type === 'pageCheck' ? { status: true, count: 1, endReport: true } : { status: true, progress: 100 } });
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
// 이전에 보낸 곳 — 한 줄이 과제·계정 · 받는 사람 · 보내는 길이고, 켜진 줄이 지금 보내는 곳이다.
const setBtn = (i) => box().querySelectorAll('button[data-act="send-set"]')[i];
const sets = () => [...box().querySelectorAll('button[data-act="send-set"]')].map((b) => [[...b.children].map((n) => n.textContent).join(' · '), b.classList.contains('active')]);
// 직접 고르는 칸(과제·계정, 받는 사람, 보내는 길)을 펴고 접는 버튼과, 그 칸에 선 이름표.
const foldBtn = () => q('button[data-act="send-fold"]');
const labels = () => [...box().querySelectorAll('.at-send-row .at-label')].map((n) => n.textContent);
// 보내는 길 칩(Teams · 쪽지) — 켜진 칩이 지금 나가는 길이다.
const ways = () => [...box().querySelectorAll('button[data-act="send-way"]')].map((b) => [b.textContent, b.classList.contains('active')]);
const wayBtn = (way) => q(`button[data-act="send-way"][data-way="${way}"]`);
const HONG = { id: 'hong', name: '홍길동', title: '책임', dept: '회계팀' };
const open = async (docNo) => { st.openDoc = docNo; await panel.reload(); };

console.log('복사 버튼은 없다');
t('출장 카드의 버튼 줄에 복사가 없다 — 그 상태에서 할 일(변경·취소신청)만 있다', () => {
  assert.deepEqual([...doc.querySelectorAll('#atList .at-acts button')].map((b) => b.textContent), ['변경', '취소신청']);
});

console.log('당일 출장 — 사전정산을 마쳤고 당일증빙이 있으면 보낼 수 있다');
t('송부 칸에 어느 길로 무엇이 가는지 적히고, 과제·계정과 받는 사람을 묻는다. 정하기 전에는 보내기가 잠겨 있다', () => {
  assert.equal(q('.at-send-head strong').textContent, '여비증빙 송부');
  assert.equal(q('.at-send-how').textContent, '쪽지 · 여비계산서 1부 · 당일출장 증명 1장 → PDF 1개');
  assert.deepEqual(labels(), ['과제·계정', '받는 사람', '보내는 길']);
  assert.deepEqual(ways(), [['Teams', false], ['쪽지', true]], '보내는 길은 칩으로 고른다 — 켜진 칩이 지금 나가는 길이다(Teams MCP 가 없으면 쪽지)');
  assert.deepEqual([q('input[data-send="account"]').placeholder, q('input[data-send="person"]').placeholder], ['직접 적기', '이름·ID 로 찾기']);
  assert.deepEqual([...q('.at-send-pair').children].map((n) => n.getAttribute('aria-label')), ['과제·계정', '받는 사람'], '두 칸은 한 줄에 나란히 선다(2026-10-04 사용자 지정)');
  assert.deepEqual([sets(), foldBtn()], [[], null], '아직 보낸 곳이 없다 — 직접 고르는 칸이 펴져 있고 접는 버튼도 없다');
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
  assert.deepEqual(popTo(), ['홍길동 책임 · 회계팀', 'RND-2026-01', '쪽지 · 여비계산서 1부 · 당일출장 증명 1장 → PDF 1개']);
  assert.deepEqual(popLines(), ['[여비 증빙] RND-2026-01 · 김거화 9/23 서울 본사', '여비계산서와 증빙을 보냅니다.', '과제·계정: RND-2026-01', '출장자: 김거화',
    '출장: 2026-09-23 · 서울 본사', '목적: 선급 기술 세미나', '여비계산서: 145600 (사전정산 완료)', '첨부: 여비증빙_145600_김거화.pdf — 여비계산서 1부 · 당일출장 증명 1장']);
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
await until(() => !!store.sendDone?.['TR-1'], '쪽지로 보내기');
await ta('팝업의 보내기 — Teams MCP 가 없으면 쪽지로: 여비계산서를 PDF 로 받아 증빙 앞에 붙여 묶고, 임시저장 → 첨부 → 저장 → 보내기 차례로 나간다', async () => {
  assert.equal(pop(), null, '보내기를 누르면 팝업은 닫힌다');
  assert.deepEqual(site.calls.map((c) => c.name), ['CalPrint', 'NewMessage', 'SaveDraft', 'dextuploadx5-configuration.js', 'DraftFileUp', 'SaveDraft', 'SendDraft']);
  assert.deepEqual(site.report, ['view MSEQ=145600:TSEQ=1:LAN=K', 'pageCheck', 'PDFPrint', 'fileDownloadCheck', 'PDFPrintDownload'],
    '계산서 화면이 부르는 리포트를 그대로 열어 PDF 로 받는다(2026-10-04 사용자 지정: 확정한 계산서를 출력해 증빙과 합쳐 보낸다)');
  const first = Object.fromEntries(new URLSearchParams(site.calls.find((c) => c.name === 'SaveDraft').body));
  assert.deepEqual([first.to, first.title, first.dId], ['hong', '[여비 증빙] RND-2026-01 · 김거화 9/23 서울 본사', '']);
  assert.match(first.content, /^<p>여비계산서와 증빙을 보냅니다\.<\/p><p>과제·계정: RND-2026-01<\/p>/);
  assert.match(first.content, /<p>첨부: 여비증빙_145600_김거화\.pdf — 여비계산서 1부 · 당일출장 증명 1장<\/p>/);
  const file = site.calls.find((c) => c.name === 'DraftFileUp').body.get('DEXTUploadX5_FileData');
  assert.deepEqual([file.name, file.type], ['여비증빙_145600_김거화.pdf', 'application/pdf']);
  const sizes = (await PDFDocument.load(new Uint8Array(await file.arrayBuffer()))).getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
  assert.deepEqual(sizes, [[300, 400], [595, 842]], '맨 앞이 여비계산서(한 쪽), 그 뒤가 영수증 한 장(A4 한 쪽)이다');
  assert.equal(doc.getElementById('atStatus').textContent, '쪽지로 보냈습니다 — 홍길동 책임 · 회계팀 · RND-2026-01 · 여비증빙_145600_김거화.pdf(2쪽)');
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /증빙 송부\(쪽지\): 145600 → hong · RND-2026-01/.test(l.text)));
});
t('보낸 뒤 — 과제·계정과 받는 사람, 보낸 길이 한 세트로 남고, 카드에 보낸 기록이 적히며 버튼은 "다시 보내기"다', () => {
  assert.deepEqual(store.sendSets, [{ account: 'RND-2026-01', person: HONG, way: 'memo' }]);
  assert.deepEqual([store.sendAccounts, store.sendPeople], [undefined, undefined], '따로 기억하지 않는다');
  assert.deepEqual([store.sendDone['TR-1'].channel, store.sendDone['TR-1'].to, store.sendDone['TR-1'].account, store.sendDone['TR-1'].pages], ['쪽지', '홍길동', 'RND-2026-01', 2]);
  assert.match(q('.at-send-note.ok').textContent, /^보냈습니다 — \d+\/\d+ \d\d:\d\d · 쪽지 · 홍길동 · RND-2026-01$/);
  assert.equal(goBtn().textContent, '다시 보내기');
});
t('보낸 곳이 이전에 보낸 곳의 한 줄로 선다(과제·계정 · 받는 사람 · 보내는 길, 2026-10-04 사용자 지정) — 그 줄이 켜져 있고 직접 고르는 칸은 접힌다', () => {
  assert.deepEqual(sets(), [['RND-2026-01 · 홍길동 책임 · 쪽지', true]]);
  assert.equal(q('.at-send-sets').getAttribute('aria-label'), '이전에 보낸 곳');
  assert.match(setBtn(0).title, /^홍길동 책임 · 회계팀 — 이 과제·계정과 받는 사람, 보내는 길로 보냅니다$/);
  assert.deepEqual([labels(), q('.at-send-pair'), ways()], [[], null, []], '`최근에 보낸 곳` 칩도 `보내는 길` 칩도 보이지 않는다');
  assert.deepEqual([foldBtn().getAttribute('aria-label'), foldBtn().getAttribute('aria-expanded'), foldBtn().hidden], ['직접 고르기', 'false', false]);
});
t('줄의 보내는 길은 아이콘이고(이름은 낭독기와 마우스를 올렸을 때만), `직접 고르기`는 첫 줄 바로 뒤의 목록 아이콘이다(2026-10-04 사용자 지정)', () => {
  const way = setBtn(0).querySelector('.at-send-set-way');
  assert.deepEqual([!!way.querySelector('svg'), way.querySelector('.sr-only').textContent, way.title], [true, '쪽지', '쪽지']);
  assert.deepEqual([foldBtn().textContent, !!foldBtn().querySelector('svg'), foldBtn().previousElementSibling], ['', true, setBtn(0)]);
});

console.log('숙박·비행기가 있는 출장 — 사후정산이 완료된 뒤에 보낸다');
await open('TR-2');
t('사후정산을 쓰는 중이면 `보내기`가 선다 — 보관한 증빙이 없어도 보낼 수 있다(여비계산서만 나간다, 2026-10-04 사용자 지정). 증빙은 위의 사후정산 칸에 넣는다', () => {
  assert.equal(q('.at-send-how').textContent, '쪽지 · 여비계산서 1부 → PDF 1개');
  assert.deepEqual([...box().querySelectorAll('.at-send-btns button')].map((b) => [b.textContent, b.disabled]), [['보내기', false]]);
  assert.equal(q('.at-send-add'), null, '읽지 않고 담는 칸은 사후정산이 완료된 뒤에만 선다');
  assert.equal(q('.at-send-note'), null, '저장·확정부터 한다는 안내는 카드에 적지 않는다(2026-10-04 사용자 지정) — 버튼의 title 과 팝업에 있다');
  assert.match(goBtn().title, /^사후정산을 저장하고 확정\(완료\)한 뒤에 증빙을 보냅니다 — /);
});
st.trips.rows[1].travelers[0].post = '완료';
bt.docs[145580].post = '완료';
await open('TR-2');
t('사후정산이 완료됐으면 보관한 증빙이 없어도 여비계산서만 보낼 수 있다 — 가장 최근에 보낸 곳이 미리 켜져 있고, 직접 고르는 칸은 접혀 있다', () => {
  assert.equal(q('.at-send-how').textContent, '쪽지 · 여비계산서 1부 → PDF 1개');
  assert.equal(q('.at-send-add span').textContent, '증빙 넣기 · 읽지 않고 그대로 묶습니다');
  assert.deepEqual(sets(), [['RND-2026-01 · 홍길동 책임 · 쪽지', true]]);
  assert.deepEqual([labels(), q('input[data-send="account"]'), foldBtn().getAttribute('aria-expanded')], [[], null, 'false']);
  assert.equal(goBtn().disabled, false);
  assert.deepEqual([...box().querySelectorAll('.at-send-btns button')].length, 1, '버튼은 보내기 하나다');
  goBtn().click();
  assert.deepEqual([popTo()[2], popLines()[1], popLines().at(-1)], ['쪽지 · 여비계산서 1부 → PDF 1개', '여비계산서를 보냅니다.', '첨부: 여비증빙_145580_김거화.pdf — 여비계산서 1부'],
    '보낼 내용에도 여비계산서만 나간다고 적힌다');
  popBtn('cancel').click();
});
foldBtn().click();
t('`직접 고르기`를 누르면 과제·계정, 받는 사람, 보내는 길 칸이 펴진다 — 켜진 줄의 것이 채워져 있다. 다시 누르면 접힌다', () => {
  assert.deepEqual([labels(), foldBtn().getAttribute('aria-expanded')], [['과제·계정', '받는 사람', '보내는 길'], 'true']);
  assert.deepEqual([q('input[data-send="account"]').value, q('.at-send-picked').textContent], ['RND-2026-01', '홍길동 책임 · 회계팀×']);
  assert.deepEqual(ways(), [['Teams', false], ['쪽지', true]]);
  assert.equal(box().querySelector('button[data-act="send-account"], button[data-act="send-person"]'), null, '과제·계정과 받는 사람을 따로 고르는 칩은 없다');
  foldBtn().click();
  assert.deepEqual([labels(), foldBtn().getAttribute('aria-expanded'), sets()], [[], 'false', [['RND-2026-01 · 홍길동 책임 · 쪽지', true]]]);
  foldBtn().click();
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
  assert.equal(q('.at-send-how').textContent, '쪽지 · 여비계산서 1부 · 증빙 1장 → PDF 1개');
});
q('button[data-act="send-person-clear"]').click();
type('input[data-send="account"]', '');
t('받는 사람을 지우고 과제·계정을 비우면 이전에 보낸 줄이 꺼지고 보내기가 잠긴다 — 손댄 카드에는 다시 깔아 주지 않고, 켜진 줄이 없으면 칸을 접을 수 없다', () => {
  assert.deepEqual([sets(), q('input[data-send="account"]').value, q('.at-send-picked'), goBtn().disabled], [[['RND-2026-01 · 홍길동 책임 · 쪽지', false]], '', null, true]);
  assert.equal(foldBtn().hidden, true);
});
setBtn(0).click();
t('이전에 보낸 줄 하나가 과제·계정과 받는 사람, 보내는 길을 함께 정한다 — 곧바로 보낼 수 있다', () => {
  assert.deepEqual([q('input[data-send="account"]').value, q('.at-send-picked').textContent, goBtn().disabled], ['RND-2026-01', '홍길동 책임 · 회계팀×', false]);
  assert.deepEqual([sets(), foldBtn().hidden], [[['RND-2026-01 · 홍길동 책임 · 쪽지', true]], false]);
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
  assert.equal(q('.at-send-how').textContent, '쪽지 · 여비계산서 1부 · 증빙 2장 → PDF 1개');
  // 사후정산을 쓰는 중이던 카드는 숙박비 내역을 읽으러(GET) 입력 화면에 간다 — 여기서 보는 것은 올리지(Save) 않았다는 것이다.
  assert.ok(!site.calls.some((c) => /AfterTrip\/Save/.test(c.url) || (/AfterTrip/.test(c.url) && c.method !== 'GET')));
});

// 2026-10-05 사용자 지정: "출장 기간동안의 내용이 아니면 … 문서보관에 알림표지 하고 확정 해주기 전까지는 보내기 해도 같이 보내지 말고"
console.log('출장 기간과 안 맞아 알림 표시가 붙은 증빙은 확정하기 전에는 보내지 않는다');
{
  const plain = (await evidence.list('TR-2')).find((k) => k.name === '항공권.png');
  const WHY = '탑승일(9/20)이 출장 기간(9/9~9/10) 밖입니다';
  const redraw = async () => { st.after['145580'].kept = await evidence.list('TR-2'); foldBtn().click(); foldBtn().click(); };
  await evidence.keep('TR-2', [{ ...plain, label: '항공기 증명', warn: WHY, record: { docType: 'flight_ticket', flightDate: '2026-09-20' } }]);
  await redraw();
  t('묶이는 것에서 빠지고, 무엇이 빠지는지 송부 칸에 적힌다 — 목록의 그 증빙에는 ⚠ 와 까닭, `확정` 버튼이 선다', () => {
    assert.equal(q('.at-send-how').textContent, '쪽지 · 여비계산서 1부 · 증빙 1장 → PDF 1개');
    assert.equal(q('.at-send-held').textContent, '출장 기간과 안 맞아 확정하지 않은 증빙 1장은 보내지 않습니다 — 항공권.png');
    assert.deepEqual([...box().querySelectorAll('.at-send-files li')].map((n) => [n.classList.contains('warn'), n.querySelector('span').textContent, !!n.querySelector('button[data-act="kept-ok"]')]),
      [[false, '증빙 · 호텔영수증.png', false], [true, `항공기 증명 · 항공권.png · ⚠ ${WHY}`, true]]);
  });
  goBtn().click();
  t('보낼 내용 팝업에도 빠지는 증빙이 적히고, 첨부에는 맞는 증빙만 센다', () => {
    assert.equal(pop().querySelector('.at-pop-held').textContent, '출장 기간과 안 맞아 확정하지 않은 증빙 1장은 보내지 않습니다 — 항공권.png');
    assert.match(pop().querySelector('.at-pop-body').textContent, /첨부: 여비증빙_145580_김거화\.pdf — 여비계산서 1부 · 증빙 1장$/);
  });
  popBtn('cancel').click();
  q('.at-send-files button[data-act="kept-ok"]').click();
  await until(() => !q('.at-send-held'), '확정');
  await ta('`확정`하면 그때부터 같이 간다 — 사후정산이 완료된 출장이라 더 올릴 것은 없다(보낼 증빙으로만 확정한다)', async () => {
    const now = (await evidence.list('TR-2')).find((k) => k.name === '항공권.png');
    assert.deepEqual([now.warn, now.confirmed, now.todo], [undefined, true, undefined]);
    assert.equal(q('.at-send-how').textContent, '쪽지 · 여비계산서 1부 · 증빙 1장 · 항공기 증명 1장 → PDF 1개');
    assert.equal(q('.at-send-files button[data-act="kept-ok"]'), null);
    assert.equal(doc.getElementById('atStatus').textContent, '이 출장의 증빙으로 확정했습니다 — 항공권.png · 담당자에게 보낼 때 같이 갑니다');
  });
  // 뒤의 테스트가 보는 모양(읽지 않고 담은 증빙 두 장)으로 되돌린다.
  await evidence.keep('TR-2', [plain]);
  await redraw();
}

console.log('Teams MCP 가 떠 있어도 파일을 보내는 도구가 없으면 쪽지로 간다');
site.teams = true;
site.calls.length = 0;
type('input[data-send="account"]', '일반관리비');
goBtn().click();
popBtn('go').click();
await until(() => !!store.sendDone['TR-2'], '쪽지로 보내기');
await ta('보내는 순간에 다시 확인하고, 쪽지로 보낸다 — 과제·계정만 바꿔 보낸 것이 새 줄로 맨 위에 서고(받는 사람은 그대로) 펴 두었던 칸은 접힌다', async () => {
  assert.deepEqual(site.calls.map((c) => c.name), ['CalPrint', 'NewMessage', 'SaveDraft', 'dextuploadx5-configuration.js', 'DraftFileUp', 'SaveDraft', 'SendDraft']);
  assert.deepEqual(store.sendSets, [{ account: '일반관리비', person: HONG, way: 'memo' }, { account: 'RND-2026-01', person: HONG, way: 'memo' }]);
  assert.deepEqual(sets(), [['일반관리비 · 홍길동 책임 · 쪽지', true], ['RND-2026-01 · 홍길동 책임 · 쪽지', false]]);
  assert.deepEqual([labels(), foldBtn().getAttribute('aria-expanded')], [[], 'false']);
  assert.equal(store.sendDone['TR-2'].channel, '쪽지');
});

console.log('보내다 실패하면 카드에 까닭이 남는다');
{
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).endsWith('/DraftFileUp?pType=SEND') ? text('ERROR') : real(url, init));
  goBtn().click();
  popBtn('go').click();
  await until(() => !!q('.at-send-note.error'), '첨부 실패');
  globalThis.fetch = real;
}
t('사이트가 첨부를 받지 않으면 보내지 않고, 최근 목록도 보낸 기록도 바뀌지 않는다', () => {
  assert.match(q('.at-send-note.error').textContent, /사이트가 첨부를 받지 않았습니다/);
  assert.match(doc.getElementById('atStatus').textContent, /^여비증빙 송부 실패: 사이트가 첨부를 받지 않았습니다/);
  assert.deepEqual(store.sendSets.map((x) => x.account), ['일반관리비', 'RND-2026-01']);
  assert.ok(logs.some((l) => l.kind === 'trip' && !l.ok && /증빙 송부 실패/.test(l.text)));
});
{
  const sentAt = store.sendDone['TR-2'].at;
  site.noReport = true;
  site.calls.length = 0;
  goBtn().click();
  popBtn('go').click();
  await until(() => /여비계산서를 PDF 로 받지 못해/.test(q('.at-send-note.error')?.textContent || ''), '계산서 출력 실패');
  site.noReport = false;
  t('여비계산서를 PDF 로 받지 못하면 증빙만 보내지 않고 멈춘다 — 까닭을 적고, 쪽지는 쓰기 화면도 열지 않는다', () => {
    assert.equal(q('.at-send-note.error').textContent, '여비계산서를 PDF 로 받지 못해 보내지 않았습니다 — 리포트 서버가 여비계산서를 열지 못했습니다.');
    assert.deepEqual(site.calls.map((c) => c.name), ['CalPrint']);
    assert.equal(store.sendDone['TR-2'].at, sentAt, '보낸 기록은 그대로다');
  });
}

console.log('사후정산을 아직 완료하지 않은 출장 — 보내기(저장 → 확정 → 송부)');
await evidence.keep('TR-3', [{ name: '호텔.png', type: 'image/png', dataUrl: PNG, label: '숙박 증빙', summary: '대전호텔 1박 110,000원', date: '2026-09-16', total: 110000 }]);
st.after['146100'].kept = await evidence.list('TR-3');
await open('TR-3');
// 저장만 하거나 확정만 하는 버튼은 없다(2026-10-05 사용자 지정: "파일올라가면 다 자동 저장인거고" · "보내기 하면 그때 '확정' 하고 보내라고")
// — 버튼은 보내기 하나이고, 보내기가 저장 → 확정 → 송부를 잇는다. 처음에는 `사후정산 저장` 버튼이 옆에 있었다.
const saveBtn = () => q('button[data-act="send-save"], button[data-act="send-ok"]');
const status = () => doc.getElementById('atStatus').textContent;
const tripline = () => doc.querySelector('#atList li.open .at-tripline').textContent;
// 사이트에 간 것 가운데 계산서를 바꾸는 요청과 쪽지 보내기만 — 숙박비 내역을 읽으러 가는 GET 은 뺀다.
const writes = () => site.calls.filter((c) => ['Save', 'Confirm', 'SendDraft'].includes(c.name)).map((c) => c.name);
t('사전정산만 완료한 1박 출장: 송부 칸이 열리고 버튼은 `보내기` 하나다 — 가장 최근에 보낸 곳이 켜져 있어 보내기가 풀려 있다', () => {
  assert.match(tripline(), /여비계산서 146100 · 사전정산 완료/);
  assert.equal(q('.at-send-how').textContent, '쪽지 · 여비계산서 1부 · 숙박 증빙 1장 → PDF 1개');
  assert.deepEqual([sets(), labels()], [[['일반관리비 · 홍길동 책임 · 쪽지', true], ['RND-2026-01 · 홍길동 책임 · 쪽지', false]], []]);
  assert.deepEqual([...box().querySelectorAll('.at-send-btns button')].map((b) => [b.textContent, b.disabled]), [['보내기', false]]);
  assert.equal(saveBtn(), null, '저장만 하거나 확정만 하는 버튼은 없다');
  assert.deepEqual([...box().querySelectorAll('.at-send-redo button')].map((b) => b.textContent), ['사전정산 다시하기'],
    '사후정산을 완료하기 전에는 `사후정산 다시하기`가 없다 — 사후정산 칸이 이미 쓰는 칸이다');
});
// 계산서 화면에 확정 버튼이 없는 사정으로 보내기를 눌러 본다 — 저장은 나가고 확정에서 멈춘다(단계는 "사후정산 작성"으로 남아 더 눌러 볼 수 있다).
bt.noConfirm = true;
const legBtn = (leg, mode) => doc.querySelector(`#atList li.open button[data-act="leg"][data-leg="${leg}"][data-t="${mode}"]`);
/** 보내기(팝업 → 보내기)를 눌러 저장까지 가게 한다 — 확정에서 멈춘다. 저장 요청의 본문을 돌려준다. */
const sendToSave = async () => {
  site.calls.length = 0;
  goBtn().click();
  popBtn('go').click();
  await until(() => writes().length === 1 && !st.after['146100'].busy && !!q('.at-send-note.error') && !goBtn().disabled, '사후정산 저장');
  return site.calls.find((c) => c.name === 'Save').body;
};
{
  const body = await sendToSave();
  t('보내기의 저장 — 바꾼 편이 없으면 입력 화면의 폼 그대로이고, 단계가 "사후정산 작성"이 된다', () => {
    assert.deepEqual(writes(), ['Save']);
    assert.deepEqual([...body.keys()], ['seq', 'trseq', '__RequestVerificationToken']);
    assert.deepEqual([body.get('seq'), body.get('trseq')], ['146100', '3']);
    assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && l.text === '여비계산서(사후정산) 저장: 146100 · 화면에 있는 그대로'));
    assert.match(tripline(), /사후정산 작성/);
    assert.deepEqual([...box().querySelectorAll('.at-send-btns button')].map((b) => b.textContent), ['보내기'], '확정하지 못했으니 버튼은 그대로다');
  });
}
legBtn('go', 'plane').click();
{
  const body = await sendToSave();
  t('값을 모르는 편이 있으면(비행기로 바꿨는데 항공권이 없다) 교통비 내역은 올리지 않는다 — 아는 편만 올리면 화면의 교통 줄이 지워진다', () => {
    assert.deepEqual([...body.keys()], ['seq', 'trseq', '__RequestVerificationToken']);
    assert.match(doc.querySelector('#atList li.open .at-after > .at-after-note:not(.error)').textContent,
      /^교통비 내역은 사후정산 화면에 있는 그대로 두었습니다 — 가는 편: 비행기 요금을 모릅니다 — 항공권을 넣어 주세요/);
  });
}
legBtn('go', 'train').click();
legBtn('go', 'train').click();
{
  const body = await sendToSave();
  t('가는 편을 KTX 특실로 바꿨으면 두 편이 교통비 내역으로 올라간다(운임표의 정가)', () => {
    assert.deepEqual([body.getAll('tr_date'), body.getAll('tr_transport'), body.getAll('tr_grade')],
      [['2026-09-15', '2026-09-16'], ['기차(KTX등)', '기차(KTX등)'], ['특실', '일반석']]);
    assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /^여비계산서\(사후정산\) 저장: 146100 · KTX 2026-09-15 부산→대전 [\d,]+원 · KTX 2026-09-16 대전→부산 53,700원$/.test(l.text)), '오는 편은 사전정산의 줄 그대로다');
  });
}
site.calls.length = 0;
goBtn().click();
t('보내기 — 팝업이 저장·확정부터 한다고 적어 보여 준다(두 번 누르기를 대신한다). 보낼 내용의 단계는 확정한 뒤의 것(사후정산 완료)이다', () => {
  assert.deepEqual([goBtn().textContent, goBtn().classList.contains('armed'), writes()], ['보내기', false, []]);
  assert.deepEqual(popTo(), ['홍길동 책임 · 회계팀', '일반관리비', '쪽지 · 여비계산서 1부 · 숙박 증빙 1장 → PDF 1개']);
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
  assert.deepEqual([site.report.at(-5), site.printedAt], ['view MSEQ=146100:TSEQ=3:LAN=K', '완료'], '확정한 뒤의 계산서를 출력해 증빙 앞에 붙인다(2026-10-04 사용자 지정)');
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

console.log('보낸 뒤에도 사후정산을 다시 작성할 수 있다 (2026-10-04 사용자 지정: "보내고 나서.. 증빙을 추가하거나 하면 사후 저장 후 다시 정산작성할 수 있어야 함")');
// 2026-10-05 사용자 지정(정산을 마치고 보낸 카드를 보고): "여기에서 사후정산 다시하기, 사전정산 다시하기 기능이 있으면 좋겠어. 맨 아래 다시 보내기
// 했으면 좋겠고" — 처음에는 정산 내역 머리의 `다시 작성`이었다. 지금은 여비증빙 송부 칸의 맨 아래 보내기 바로 위에 두 버튼이 선다.
const reopenBtn = () => doc.querySelector('#atList li.open button[data-act="after-reopen"]');
const afterHead = () => ['strong', '.at-after-why'].map((sel) => doc.querySelector(`#atList li.open .at-after-head ${sel}`).textContent);
const afterDrop = () => doc.querySelector('#atList li.open .at-after-drop');
// 정산을 다시 하는 버튼 줄 — [글, 켜졌는가].
const redo = () => [...box().querySelectorAll('.at-send-redo button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]);
site.calls.length = 0;
t('완료한 출장의 송부 칸 아래에 `사전정산 다시하기`·`사후정산 다시하기`가 서고 맨 아래가 `다시 보내기`다 — 정산 내역 머리에는 버튼이 없다', () => {
  assert.deepEqual(redo(), [['사전정산 다시하기', 'false'], ['사후정산 다시하기', 'false']]);
  assert.deepEqual([...box().children].slice(-2).map((n) => n.className), ['at-send-redo', 'at-send-btns'], '다시하기 줄 바로 아래 맨 끝이 보내기다');
  assert.deepEqual([...box().querySelectorAll('.at-send-btns button')].map((b) => b.textContent), ['다시 보내기']);
  assert.equal(doc.querySelector('#atList li.open .at-after-head button'), null);
  assert.equal(reopenBtn().title, '완료한 사후정산을 다시 작성합니다 — 증빙을 넣거나 가는 편·오는 편을 바꿔 저장하고, 보내기가 다시 확정한 뒤 보냅니다');
});
t('`사후정산 다시하기`를 누르면 완료하기 전의 사후정산 칸(증빙 넣는 곳)이 다시 선다 — 송부 칸의 버튼은 그대로 보내기 하나다. 누르는 것만으로는 사이트에 아무것도 가지 않는다', () => {
  assert.deepEqual([afterHead()[0], reopenBtn().textContent, afterDrop()], ['정산 내역', '사후정산 다시하기', null]);
  assert.match(afterHead()[1], / · 완료$/);
  reopenBtn().click();
  assert.deepEqual([afterHead()[0], reopenBtn().textContent, !!afterDrop()], ['사후정산', '그만두기', true]);
  assert.match(afterHead()[1], / · 다시 작성 중$/);
  assert.deepEqual(redo(), [['사전정산 다시하기', 'false'], ['사후정산 다시하기', 'true']], '켜진 버튼이 지금 다시 하는 중인 정산이다');
  assert.deepEqual([...box().querySelectorAll('.at-send-btns button')].map((b) => [b.textContent, b.disabled]), [['다시 보내기', false]]);
  assert.equal(q('.at-send-files'), null, '보관 중인 증빙은 다시 선 사후정산 칸에 적힌다');
  assert.deepEqual(writes(), []);
});
reopenBtn().click();
t('`그만두기`를 누르면 정산 내역(보기)으로 돌아간다 — 저장 버튼도 다시 없다', () => {
  assert.deepEqual([afterHead()[0], reopenBtn().textContent, afterDrop(), saveBtn(), writes()], ['정산 내역', '사후정산 다시하기', null, null, []]);
});
reopenBtn().click();
q('.at-send-redo button[data-act="after-reopen"]').click();
t('켜진 `사후정산 다시하기`를 다시 눌러도 그만둔다', () => {
  assert.deepEqual([afterHead()[0], redo()[1], afterDrop(), writes()], ['정산 내역', ['사후정산 다시하기', 'false'], null, []]);
});
reopenBtn().click();
goBtn().click();
t('다시 작성하는 중의 보내기는 완료하기 전과 같다 — 팝업이 저장·확정부터 한다고 적는다', () => {
  assert.equal(pop().querySelector('.at-pop-note').textContent, '사후정산을 저장하고 확정(완료)한 뒤에 증빙을 보냅니다 — 여비계산서 146100');
  assert.equal(popBtn('go').textContent, '저장·확정 후 보내기');
});
popBtn('go').click();
await until(() => writes().includes('SendDraft') && !goBtn().disabled, '다시 저장 → 확정 → 송부');
t('사후정산을 다시 저장하고(단계가 "작성"으로 돌아간다) 다시 확정한 뒤에 보낸다 — 끝나면 카드는 정산 내역으로 돌아간다', () => {
  assert.deepEqual(writes(), ['Save', 'Confirm', 'SendDraft']);
  assert.equal(site.printedAt, '완료', '다시 확정한 뒤의 계산서를 출력해 보낸다');
  assert.match(tripline(), /여비계산서 146100 · 사후정산 완료/);
  assert.deepEqual([afterHead()[0], reopenBtn().textContent, saveBtn(), goBtn().textContent], ['정산 내역', '사후정산 다시하기', null, '다시 보내기']);
});

console.log('홈 WORKSPACE 카드의 보내기 — 그 출장 카드의 여비증빙 송부 칸으로 와서 보낼 내용 팝업을 띄운다 (2026-10-04 사용자 지정)');
site.calls.length = 0;
panel.seek({ docNo: 'TR-1', send: true });
t('홈 카드에서 보내기를 누르고 오면 그 출장 카드가 펴지고 보낼 내용 팝업이 뜬다 — 카드의 보내기를 누른 것과 같고, 아직 아무것도 나가지 않는다', () => {
  assert.deepEqual([st.openDoc, doc.querySelector('#atList li.open .at-send').dataset.doc, st.seek], ['TR-1', 'TR-1', null]);
  assert.deepEqual(popTo(), ['홍길동 책임 · 회계팀', 'RND-2026-01', '쪽지 · 여비계산서 1부 · 당일출장 증명 1장 → PDF 1개']);
  assert.equal(popLines().at(-2), '여비계산서: 145600 (사전정산 완료)');
  assert.deepEqual([writes(), doc.activeElement], [[], popBtn('go')]);
});
popBtn('cancel').click();
foldBtn().click();
q('button[data-act="send-person-clear"]').click();
panel.seek({ docNo: 'TR-1', send: true });
t('아직 보낼 수 없으면(받는 사람이 비었다) 팝업을 띄우지 않고 채울 칸에 초점을 준다', () => {
  assert.deepEqual([pop(), st.seek, doc.activeElement], [null, null, q('input[data-send="person"]')]);
});
panel.seek({ docNo: 'TR-9', send: true });
t('지금 보는 신청 내역에 없는 출장이면 그렇다고 말하고 그만둔다', () => {
  assert.deepEqual([pop(), st.seek, st.openDoc], [null, null, 'TR-1']);
  assert.match(status(), /^홈 카드에서 고른 출장이 지금 보는 신청 내역에 없습니다/);
});
// 다른 종류(휴가)만 보는 중이고, 그 출장의 사전정산 교통편을 아직 읽지 않았다 — 읽힌 뒤에 이어 간다.
delete st.after['145580'];
Object.assign(st, { view: '', form: { ...st.form, kind: 'leave' } });
await panel.reload();
t('(준비) 휴가만 보는 중이라 출장 줄이 목록에 없다', () => assert.equal(doc.querySelectorAll('#atList > li').length, 0));
panel.seek({ docNo: 'TR-2', send: true });
t('가려져 있던 출장이면 모든 종류를 보는 "내역"으로 바꿔 그 카드를 편다 — 읽는 중에는 팝업을 띄우지 않는다', () => {
  assert.deepEqual([st.view, st.openDoc, pop()], ['all', 'TR-2', null]);
  assert.ok(st.seek, '사전정산의 교통편과 보관함이 읽힐 때까지 부탁을 들고 있다');
});
await until(() => !!pop(), '읽힌 뒤 보낼 내용 팝업');
t('다 읽히면 그때 팝업이 뜬다 — 사후정산이 완료된 출장의 증빙 두 장', () => {
  assert.deepEqual(popTo(), ['홍길동 책임 · 회계팀', '일반관리비', '쪽지 · 여비계산서 1부 · 증빙 2장 → PDF 1개']);
  assert.deepEqual([st.seek, writes()], [null, []]);
});
popBtn('cancel').click();
panel.seek({ docNo: 'TR-3', send: true });
doc.querySelector('#atList li.open .at-head').click();
t('목록을 손수 누르면 홈 카드의 부탁은 잊는다', () => assert.equal(st.seek, null));
if (pop()) popBtn('cancel').click();

console.log('보내는 길을 고른다 — Teams · 쪽지 (2026-10-04 사용자 지정)');
const note = () => q('.at-send-note.error')?.textContent || '';
site.teams = false;
panel.seek({ docNo: 'TR-1' });   // 증빙을 보내 기본 보기에서 빠진 출장이다 — 홈 카드의 길로 그 카드를 편다
await until(() => doc.querySelector('#atList li.open .at-send')?.dataset.doc === 'TR-1' && !st.seek, 'TR-1 카드');
setBtn(0).click();   // 받는 사람을 지워 둔 카드다(직접 고르는 칸이 펴져 있다) — 가장 최근에 보낸 줄(일반관리비 · 홍길동 · 쪽지)로 채운다
wayBtn('teams').click();
await until(() => store.sendWay === 'teams', 'Teams 고르기');
t('Teams MCP 가 꺼져 있을 때 Teams 를 누르면 그 자리에서 다시 확인하고, 닿지 않으면 까닭을 카드에 적는다 — 길은 쪽지로 남는다', () => {
  assert.deepEqual(ways(), [['Teams', false], ['쪽지', true]]);
  assert.equal(note(), 'Teams MCP 가 연결돼 있지 않습니다 — 지금은 쪽지로 갑니다. Teams 서버(localhost:5003)를 켠 뒤 Teams 를 다시 눌러 주세요');
  assert.deepEqual([wayBtn('teams').title, wayBtn('teams').classList.contains('dim')], ['Teams MCP 가 연결돼 있지 않습니다 — 누르면 다시 확인합니다', true]);
  assert.equal(q('.at-send-how').textContent, '쪽지 · 여비계산서 1부 · 당일출장 증명 1장 → PDF 1개');
});
site.teams = 'file';
wayBtn('teams').click();
await until(() => ways()[0][1], 'Teams 로 바뀜');
t('Teams MCP 를 켠 뒤 Teams 를 다시 누르면 Teams 로 간다 — 패널을 다시 열지 않아도 된다', () => {
  assert.deepEqual(ways(), [['Teams', true], ['쪽지', false]]);
  assert.deepEqual([note(), wayBtn('teams').title, wayBtn('teams').classList.contains('dim')], ['', 'Teams 채팅으로 보냅니다', false]);
  assert.equal(q('.at-send-how').textContent, 'Teams · 여비계산서 1부 · 당일출장 증명 1장 → PDF 1개');
});
wayBtn('memo').click();
await until(() => store.sendWay === 'memo', '쪽지 고르기');
site.calls.length = 0;
goBtn().click();
{
  const shown = popTo()[2];
  popBtn('go').click();
  await until(() => store.sendDone['TR-1'].account === '일반관리비', '쪽지로 보내기');
  t('쪽지를 고르면 Teams MCP 가 닿아도 쪽지로 간다 — 팝업에도 쪽지로 적히고, 고른 길은 기억한다', () => {
    assert.equal(shown, '쪽지 · 여비계산서 1부 · 당일출장 증명 1장 → PDF 1개');
    assert.deepEqual([store.sendWay, site.sent.length, store.sendDone['TR-1'].channel], ['memo', 0, '쪽지']);
    assert.ok(site.calls.some((c) => c.name === 'SendDraft'));
    assert.deepEqual([sets()[0], labels()], [['일반관리비 · 홍길동 책임 · 쪽지', true], []], '보낸 곳의 줄에 보낸 길이 적히고, 펴 두었던 칸은 접힌다');
    foldBtn().click();
    assert.deepEqual(ways(), [['Teams', false], ['쪽지', true]]);
    assert.equal(wayBtn('teams').classList.contains('dim'), false, 'Teams 로 갈 수 있다는 것은 그대로 보인다');
  });
}
wayBtn('teams').click();
await until(() => store.sendWay === 'teams' && ways()[0][1], 'Teams 고르기');
site.calls.length = 0;
goBtn().click();
{
  const shown = popTo()[2];
  popBtn('go').click();
  await until(() => store.sendDone['TR-1'].channel === 'Teams', 'Teams 로 보내기');
  t('Teams 를 골라 보내면 Teams 채팅으로 간다 — 받는 사람의 메일, 글, 묶은 PDF. 쪽지는 나가지 않는다', () => {
    assert.equal(shown, 'Teams · 여비계산서 1부 · 당일출장 증명 1장 → PDF 1개');
    assert.equal(site.sent.length, 1);
    const sent = site.sent[0].arguments;
    assert.deepEqual([site.sent[0].name, sent.recipient_email, sent.content_type, sent.file_name], ['handler_teams_send_chat_file', 'hong@krs.co.kr', 'html', '여비증빙_145600_김거화.pdf']);
    assert.match(sent.content, /과제·계정: 일반관리비/);
    assert.ok(!site.calls.some((c) => ['SaveDraft', 'SendDraft'].includes(c.name)));
    assert.equal(status(), 'Teams로 보냈습니다 — 홍길동 책임 · 회계팀 · 일반관리비 · 여비증빙_145600_김거화.pdf(2쪽)');
    assert.match(q('.at-send-note.ok').textContent, /· Teams · 홍길동 · 일반관리비$/);
    assert.deepEqual(sets(), [['일반관리비 · 홍길동 책임 · Teams', true], ['RND-2026-01 · 홍길동 책임 · 쪽지', false]], '같은 곳의 줄은 하나다 — 길은 마지막에 보낸 것으로 바뀐다');
    assert.deepEqual(store.sendSets.map((x) => x.way), ['teams', 'memo']);
  });
}
site.calls.length = 0;
site.sent.length = 0;
goBtn().click();
site.teams = false;   // 팝업을 띄운 뒤에 Teams MCP 가 꺼졌다
popBtn('go').click();
await until(() => !!note(), '길이 달라짐');
t('팝업에서 확인한 길(Teams)로 못 가게 됐으면 쪽지로 돌려 보내지 않고 멈춘다 — 카드는 지금의 길(쪽지)로 고쳐 그린다', () => {
  assert.equal(note(), '보내는 길이 달라져 보내지 않았습니다(확인한 길: Teams → 지금: 쪽지) — 보내기를 다시 눌러 확인해 주세요');
  assert.deepEqual([site.sent.length, site.calls.filter((c) => ['SaveDraft', 'SendDraft'].includes(c.name)).length], [0, 0]);
  assert.equal(q('.at-send-how').textContent, '쪽지 · 여비계산서 1부 · 당일출장 증명 1장 → PDF 1개');
  assert.equal(q('.at-send-how').title, 'Teams MCP 가 연결돼 있지 않습니다 — 지금은 쪽지로 갑니다');
  assert.deepEqual([sets()[0], setBtn(0).querySelector('.at-send-set-way').classList.contains('dim')], [['일반관리비 · 홍길동 책임 · Teams', true], true],
    'Teams 로 보냈던 줄은 켜진 채 길이 흐리다');
});

console.log('이전에 보낸 곳 — 줄을 누르면 과제·계정, 받는 사람, 보내는 길이 그 줄의 것이 된다 (2026-10-04 사용자 지정)');
setBtn(1).click();
t('쪽지로 보냈던 줄을 누르면 칸을 펴지 않고도 그 과제·계정과 받는 사람에게 쪽지로 보낼 수 있다', () => {
  assert.deepEqual(sets(), [['일반관리비 · 홍길동 책임 · Teams', false], ['RND-2026-01 · 홍길동 책임 · 쪽지', true]]);
  assert.deepEqual([note(), labels(), goBtn().disabled], ['', [], false]);
  goBtn().click();
  assert.deepEqual(popTo(), ['홍길동 책임 · 회계팀', 'RND-2026-01', '쪽지 · 여비계산서 1부 · 당일출장 증명 1장 → PDF 1개']);
  popBtn('cancel').click();
});
setBtn(0).click();
await until(() => !!note(), 'Teams 다시 확인');
t('Teams 로 보냈던 줄을 눌렀는데 Teams MCP 가 꺼져 있으면 그 자리에서 다시 확인하고 까닭을 적는다 — 줄은 켜지고 길은 쪽지로 남는다', () => {
  assert.equal(note(), 'Teams MCP 가 연결돼 있지 않습니다 — 지금은 쪽지로 갑니다. Teams 서버(localhost:5003)를 켠 뒤 그 줄을 다시 눌러 주세요');
  assert.deepEqual(sets(), [['일반관리비 · 홍길동 책임 · Teams', true], ['RND-2026-01 · 홍길동 책임 · 쪽지', false]]);
  assert.equal(q('.at-send-how').textContent, '쪽지 · 여비계산서 1부 · 당일출장 증명 1장 → PDF 1개');
  assert.match(setBtn(0).title, /\(Teams MCP 가 연결돼 있지 않습니다 — 누르면 다시 확인합니다\)$/);
});
site.teams = 'file';
setBtn(0).click();
await until(() => /^Teams/.test(q('.at-send-how').textContent), 'Teams 로 바뀜');
t('Teams MCP 를 켠 뒤 그 줄을 다시 누르면 Teams 로 간다 — 보낼 내용에도 Teams 로 적힌다', () => {
  assert.deepEqual([note(), setBtn(0).querySelector('.at-send-set-way').classList.contains('dim')], ['', false]);
  goBtn().click();
  assert.deepEqual(popTo(), ['홍길동 책임 · 회계팀', '일반관리비', 'Teams · 여비계산서 1부 · 당일출장 증명 1장 → PDF 1개']);
  popBtn('cancel').click();
});
site.teams = true;   // 파일을 보내는 도구가 없는 예전 서버
foldBtn().click();
wayBtn('teams').click();
await until(() => !!note(), '파일 도구 없음');
t('Teams 로 가려는데 서버에 파일을 보내는 도구가 없으면 쪽지로 간다 — 칸 머리에 마우스를 올리면 까닭이 보인다', () => {
  assert.equal(note(), 'Teams MCP 는 연결돼 있지만 파일을 보내는 도구가 없습니다 — 지금은 쪽지로 갑니다');
  assert.equal(q('.at-send-how').title, 'Teams MCP 는 연결돼 있지만 파일을 보내는 도구가 없어 쪽지로 보냅니다');
  assert.equal(q('.at-send-how').textContent, '쪽지 · 여비계산서 1부 · 당일출장 증명 1장 → PDF 1개');
});

console.log('보낸 이력을 지운다 (2026-10-05 사용자 지정: "보내기 이력에서.. 이력을 삭제할 수도 있으면 좋겠어")');
const delBtn = (i) => box().querySelectorAll('button[data-act="send-set-del"]')[i];
const doneDel = () => q('button[data-act="send-done-del"]');
site.calls.length = 0;
t('이전에 보낸 곳의 줄마다 오른쪽 끝에 × 가 서고, 보낸 기록(`보냈습니다 — …`) 옆에도 × 가 선다', () => {
  assert.deepEqual(sets(), [['일반관리비 · 홍길동 책임 · Teams', true], ['RND-2026-01 · 홍길동 책임 · 쪽지', false]]);
  assert.deepEqual([...box().querySelectorAll('button[data-act="send-set-del"]')].map((b) => [b.textContent, b.getAttribute('aria-label'), b.title]),
    [['×', '일반관리비 · 홍길동 책임 지우기', '이 줄을 이전에 보낸 곳에서 지웁니다'], ['×', 'RND-2026-01 · 홍길동 책임 지우기', '이 줄을 이전에 보낸 곳에서 지웁니다']]);
  assert.deepEqual([foldBtn().previousElementSibling, foldBtn().nextElementSibling], [setBtn(0), delBtn(0)], '첫 줄 · 목록 아이콘 · × 차례다');
  assert.deepEqual([doneDel().textContent, doneDel().getAttribute('aria-label'), doneDel().parentElement.className], ['×', '보낸 기록 지우기', 'at-send-done']);
});
delBtn(0).click();
await until(() => store.sendSets.length === 1, '켜진 줄 지우기');
t('켜져 있던 줄의 × — 그 줄만 기억에서 지우고, 그 카드는 남은 맨 윗줄로 옮겨 간다(보이지 않는 곳으로 보내지 않는다). 사이트에는 아무것도 가지 않는다', () => {
  assert.deepEqual(store.sendSets, [{ account: 'RND-2026-01', person: HONG, way: 'memo' }]);
  assert.deepEqual(sets(), [['RND-2026-01 · 홍길동 책임 · 쪽지', true]]);
  assert.deepEqual([labels(), goBtn().disabled], [[], false], '직접 고르는 칸은 접히고, 남은 줄로 곧바로 보낼 수 있다');
  assert.equal(status(), '이전에 보낸 곳에서 지웠습니다 — 일반관리비 · 홍길동 책임');
  assert.deepEqual([writes(), Object.keys(store.sendDone).sort()], [[], ['TR-1', 'TR-2', 'TR-3']], '보낸 기록은 그대로다');
});
delBtn(0).click();
await until(() => store.sendSets.length === 0, '마지막 줄 지우기');
t('남은 줄까지 지우면 이전에 보낸 곳이 사라지고 직접 고르는 칸이 빈 채로 펴진다 — 보내기는 잠긴다', () => {
  assert.deepEqual([sets(), q('.at-send-sets'), labels()], [[], null, ['과제·계정', '받는 사람', '보내는 길']]);
  assert.deepEqual([q('input[data-send="account"]').value, q('.at-send-picked'), goBtn().disabled], ['', null, true]);
});
doneDel().click();
await until(() => !store.sendDone['TR-1'], '보낸 기록 지우기');
t('보낸 기록의 × — 그 출장의 보낸 기록만 지운다(패널의 기록뿐이다). 버튼은 `보내기`로 돌아간다', () => {
  assert.deepEqual([q('.at-send-done'), goBtn().textContent], [null, '보내기']);
  assert.deepEqual(Object.keys(store.sendDone).sort(), ['TR-2', 'TR-3']);
  assert.match(status(), /^보낸 기록을 지웠습니다 — \d+\/\d+ \d\d:\d\d · Teams · 홍길동 · 일반관리비$/);
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /^여비증빙 보낸 기록 지움: TR-1 — /.test(l.text)));
  assert.deepEqual(writes(), []);
});

console.log('세트로 기억하기 전의 기록(과제·계정과 받는 사람을 따로 기억하던 때)에서 세트를 짓는다');
{
  const { createSendBox } = await import('../sendbox.js');
  const old = {
    sendAccounts: ['B-계정', 'A-과제'], sendPeople: [HONG, { id: 'kim', name: '김담당' }],
    sendDone: { 'D-1': { at: 1, to: '홍길동', account: 'A-과제', channel: 'Teams' }, 'D-2': { at: 2, to: '김담당', account: 'B-계정' }, 'D-3': { at: 3, to: '없는 사람', account: 'C-과제' } },
  };
  const realGet = chrome.storage.local.get;
  chrome.storage.local.get = async () => old;
  const fresh = createSendBox({ escapeHtml, logEvent: () => {}, evidence, setStatus: () => {}, setError: () => {}, repaint: () => {}, readFile: async () => '' });
  await fresh.load();
  t('보낸 기록마다 그때의 과제·계정과 받는 사람, 보낸 길을 짝짓는다(최근에 보낸 것이 앞) — 받는 사람을 못 찾은 기록은 버리고, 길이 안 적힌 기록은 길을 비워 둔다', () => {
    assert.deepEqual(fresh.state.sets, [{ account: 'B-계정', person: { id: 'kim', name: '김담당' }, way: '' }, { account: 'A-과제', person: HONG, way: 'teams' }]);
    assert.deepEqual(Object.keys(fresh.state.done), ['D-1', 'D-2', 'D-3']);
    assert.equal(fresh.state.want, '', '보내는 길은 고른 적이 없다');
  });
  // 패널을 다시 열었을 때 — 저장해 둔 세트를 그대로 읽는다(셋까지, 모양이 다른 것은 버린다). 길을 같이 기억하기 전의 세트에는
  // 그 과제·계정을 그 사람에게 마지막으로 보낸 기록의 길을 채운다.
  const many = [1, 2, 3, 4].map((i) => ({ account: `과제-${i}`, person: HONG, ...(i === 1 ? { way: 'teams' } : {}) }));
  chrome.storage.local.get = async () => ({ ...old, sendWay: 'memo', sendSets: [{ account: '', person: HONG }, { account: '사람 없음' }, ...many],
    sendDone: { ...old.sendDone, 'D-4': { at: 4, to: '홍길동', account: '과제-2', channel: 'Teams' }, 'D-5': { at: 5, to: '홍길동', account: '과제-2', channel: '쪽지' } } });
  await fresh.load();
  chrome.storage.local.get = realGet;
  t('저장해 둔 세트가 있으면 그것을 읽는다 — 예전 기록에서 다시 짓지 않는다. 길이 없는 세트는 보낸 기록에서 길을 찾고, 고른 길(쪽지)도 같이 읽는다', () => {
    assert.deepEqual(fresh.state.sets.map((x) => [x.account, x.way]), [['과제-1', 'teams'], ['과제-2', 'memo'], ['과제-3', '']]);
    assert.equal(fresh.state.want, 'memo');
  });
}

console.log(`\n통과 ${pass}건`);
process.exit(0);
