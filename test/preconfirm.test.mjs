// 여비계산서 사전정산 완료(확정) — 사후정산을 올리거나 증빙을 담당자에게 보내려면 사전정산이 완료돼 있어야 하고,
// 그 확정을 확장이 한다(2026-10-03 사용자 지정). 계산서 화면의 "확정" 버튼과 같은 요청(CalPrint/Confirm)이다.
//
// 못 박는 것: 확정 폼의 칸만 그대로 보낸다(옆의 삭제 폼이 아니다), "사전정산 작성" 단계일 때만 보낸다, 보낸 뒤 목록으로
// 확인한다, 출장 카드의 버튼은 두 번 눌러야 나간다, 쓸 수 있는 증빙을 넣으면 확정부터 하고 이어 간다.
// 계산서 화면의 모양은 2026-10-03 실제 화면(143010 · 145580)에서 받은 것을 줄여 지었다. eclass 와 Claude 는 흉내 낸다 —
// **실제 사이트에는 아무것도 보내지 않는다.**
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

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

/* ------------------------------------------------------------ 가짜 eclass 여비계산서와 Claude */

const page = (body) => new Response(`<html><body>${body}${' '.repeat(1600)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
// 계산서 둘: 1박 2일(145580)과 당일(146000). travelers 는 계산서 화면의 출장자 목록(첫 사람이 골라져 열린다).
const fresh = () => ({
  145580: { pre: '작성', post: '대기', from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시 킨텍스', travelers: [['157777', '김거화']] },
  146000: { pre: '작성', post: '대기', from: '2026-09-20', to: '2026-09-20', location: '대전', travelers: [['158000', '김거화']] },
});
// calls 는 사이트에 간 쓰기 요청의 차례, stuck 이면 확정을 받아도 단계가 바뀌지 않는다(사이트가 거절한 것을 흉내 낸다).
const site = { docs: fresh(), calls: [], confirms: [], gets: [], asks: [], record: null, stuck: false, login: false, formSeq: null, postForm: true };
const LIST = () => `<div class="bt-topmenu"><span class="bt-user"> 김거화 (kimghw) / KOR | ENG </span></div><table id="mainList"><tbody>${
  Object.entries(site.docs).map(([seq, d]) => {
    const done = d.pre === '완료';
    return `<tr><td data-href="/BusinessTrip/${done ? `CalPrint?seq=${seq}` : `Write?seq=${seq}&amp;mode=E`}">${seq}</td><td>김거화</td>`
      + `<td data-href="${done ? `/BusinessTrip/CalPrint?seq=${seq}&amp;trseq=${d.travelers.at(-1)[0]}` : ''}"> </td>`
      + `<td><span>${d.pre}</span></td><td><span>${d.post}</span></td><td>${d.from}~${d.to}</td><td>${d.location}</td><td>김거화</td><td>2026-09-01</td></tr>`;
  }).join('')}</tbody></table><div class="bt-pager"><div>전체 2건 · 1/1 페이지</div></div>`;
const STEPS = ['사전정산&#xA;작성', '사전정산&#xA;완료', '사후정산&#xA;작성', '사후정산&#xA;완료'];
// 계산서 화면. 사전정산을 쓰는 중이면 확정 폼이 있고, 그 옆에 늘 삭제 폼이 있다(같은 seq·다른 토큰).
// 사후정산을 쓰는 중("사후정산 작성")의 확정 폼은 실제 화면에서 보지 못했다 — 사전정산과 같은 자리에 선다고 보고 흉내 낸다(postForm 을 끄면 없다).
const CAL = (seq, trseq) => {
  const d = site.docs[seq];
  const at = d.post === '완료' ? 3 : d.post === '작성' ? 2 : d.pre === '완료' ? 1 : 0;
  const who = trseq || d.travelers[0][0];
  return `<div class="bt-content"><div class="bt-title">계산서 (No. ${seq})</div>
<select id="drtraveler">${d.travelers.map(([id, name]) => `<option value="${id}"${id === who ? ' selected="selected"' : ''}>${name}</option>`).join('')}</select>
<a class="bt-btn" href="/BusinessTrip/Write?seq=${seq}&amp;mode=E">사전정산 입력</a>
${at === 0 || (at === 2 && site.postForm) ? `<form method="post" style="display:inline" onsubmit="return confirm('확정하시겠습니까?');" action="/BusinessTrip/CalPrint/Confirm">
<input type="hidden" name="seq" value="${site.formSeq || seq}" /><input type="hidden" name="trseq" value="${who}" /><button type="submit" class="bt-btn">확정</button>
<input name="__RequestVerificationToken" type="hidden" value="tok-confirm" /></form>` : `<a class="bt-btn" href="/BusinessTrip/AfterTrip?seq=${seq}&amp;trseq=${who}">사후정산 입력</a>`}
<form method="post" style="display:inline" action="/BusinessTrip/CalPrint/Delete"><input type="hidden" name="seq" value="${seq}" /><button type="submit" class="bt-btn sub">삭제</button>
<input name="__RequestVerificationToken" type="hidden" value="tok-delete" /></form>
<div class="bt-steps">${STEPS.map((lbl, i) => `<div class="bt-step ${i < at ? 'done' : i === at ? 'active' : ''}"><div class="dot">${i + 1}</div><div class="lbl">${lbl}</div></div>`).join('')}</div></div>`;
};
const AFTER = (seq, trseq) => `<form method="post" id="frm" enctype="multipart/form-data" action="/BusinessTrip/AfterTrip/Save">
<input type="hidden" name="seq" value="${seq}"><input type="hidden" name="trseq" value="${trseq}"><table><tbody id="trBody"></tbody></table>
<input name="__RequestVerificationToken" type="hidden" value="tok-after"></form>`;
const LOGIN = '<form><input id="tbUserId" name="UserId"></form>';
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('api.anthropic.com')) {
    site.asks.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(site.record) }] }) };
  }
  const q = new URL(u).searchParams;
  if (init.method === 'POST') {
    if (u.endsWith('/BusinessTrip/CalPrint/Confirm')) {
      const body = new URLSearchParams(init.body);
      site.confirms.push(String(init.body));
      site.calls.push(`confirm:${body.get('seq')}`);
      // 확정은 지금 단계를 완료로 넘긴다 — 사후정산을 쓰는 중이면 사후정산이, 아니면 사전정산이 완료된다.
      const d = site.docs[body.get('seq')];
      if (!site.stuck) Object.assign(d, d.post === '작성' ? { post: '완료' } : { pre: '완료' });
      return page(CAL(body.get('seq'), body.get('trseq')));
    }
    if (u.endsWith('/BusinessTrip/AfterTrip/Save')) {
      site.calls.push(`after:${init.body.get('seq')}`);
      site.docs[init.body.get('seq')].post = '작성';
      return page('ok');
    }
    throw new Error('모르는 쓰기 주소 ' + u);
  }
  site.gets.push(u.replace(/^https:\/\/[^/]+/, '').replace(/&returnUrl=.*$/, ''));
  if (site.login) return page(LOGIN);
  if (u.includes('/Home/List')) return page(LIST());
  if (u.includes('/BusinessTrip/CalPrint?')) return page(CAL(q.get('seq'), q.get('trseq')));
  if (u.includes('/BusinessTrip/AfterTrip?')) return page(AFTER(q.get('seq'), q.get('trseq')));
  throw new Error('모르는 주소 ' + u);
};

const { parseCalPage, parseTripList, STEP_PRE_WRITING, STEP_POST_WRITING } = await import('../src/travel.js');
const { tripPreConfirm, tripPostConfirm, tripCalUrl } = await import('../src/trip.js');
const { AuthError } = await import('../src/net.js');
const dom = (body) => new JSDOM(body).window.document;
const rowOf = (seq) => parseTripList(dom(LIST())).find((r) => r.seq === String(seq));

console.log('계산서 화면 읽기');
t('사전정산을 쓰는 중인 계산서: 단계는 "사전정산 작성"이고 확정 폼의 칸(seq·trseq·요청 확인 토큰)이 그대로 읽힌다 — 옆의 삭제 폼이 아니다', () => {
  const cal = parseCalPage(dom(CAL('146000')));
  assert.deepEqual([cal.step, STEP_PRE_WRITING], ['사전정산 작성', '사전정산 작성']);
  assert.deepEqual(cal.confirm, [['seq', '146000'], ['trseq', '158000'], ['__RequestVerificationToken', 'tok-confirm']]);
  assert.deepEqual(cal.travelers, [{ trseq: '158000', name: '김거화', selected: true }]);
});
t('확정한 계산서에는 확정 폼이 없고 단계가 "사전정산 완료"다. 계산서 화면이 아니면 null', () => {
  site.docs[146000].pre = '완료';
  const cal = parseCalPage(dom(CAL('146000')));
  assert.deepEqual([cal.step, cal.confirm], ['사전정산 완료', null]);
  assert.equal(parseCalPage(dom(LIST())), null);
  site.docs = fresh();
});
t('작성 중인 계산서는 목록에 출장자 번호가 없다 — 확정한 뒤에야 생긴다(사후정산 입력 화면을 여는 데 쓴다)', () => {
  assert.equal(rowOf(146000).travelers[0].trseq, '');
  assert.match(tripCalUrl('146000'), /\/BusinessTrip\/CalPrint\?seq=146000&returnUrl=/);
  assert.match(tripCalUrl('146000', '158000'), /\/BusinessTrip\/CalPrint\?seq=146000&trseq=158000&returnUrl=/);
});

console.log('확정 요청');
await ta('계산서 화면의 확정 폼을 그대로 보내고, 목록을 다시 읽어 "완료"가 됐는지로 성공을 판정한다', async () => {
  const stages = [];
  const r = await tripPreConfirm(rowOf(146000), { name: '김거화', onStage: (s) => stages.push(s) });
  assert.deepEqual(site.confirms, ['seq=146000&trseq=158000&__RequestVerificationToken=tok-confirm']);
  assert.deepEqual([r.sent, r.row.pre, r.row.travelers[0].trseq, r.stage], [true, '완료', '158000', { phase: 'pre', done: true, label: '사전정산 완료' }]);
  assert.deepEqual(stages, ['계산서 화면을 여는 중...', '사전정산을 완료(확정)하는 중...']);
  assert.deepEqual(site.gets.map((g) => g.split('?')[0]), ['/BusinessTrip/CalPrint', '/BusinessTrip/Home/List']);
});
await ta('이미 완료된 계산서에는 확정을 보내지 않는다 — 목록으로 완료를 확인하고 그대로 돌려준다', async () => {
  const r = await tripPreConfirm(rowOf(146000), { name: '김거화' });
  assert.deepEqual([r.sent, r.row.pre, site.confirms.length], [false, '완료', 1]);
});
await ta('확정을 보냈는데 목록의 단계가 그대로면 던진다 — 사이트의 말이 아니라 목록을 믿는다', async () => {
  site.docs = fresh();
  site.stuck = true;
  await assert.rejects(tripPreConfirm(rowOf(146000), { name: '김거화' }), /확정을 보냈지만 목록의 사전정산이 완료로 바뀌지 않았습니다/);
  assert.equal(site.confirms.length, 2);
  site.stuck = false;
});
await ta('확정 폼이 다른 계산서의 것이면 보내지 않는다', async () => {
  site.formSeq = '999999';
  await assert.rejects(tripPreConfirm(rowOf(146000), { name: '김거화' }), /확정 폼이 이 계산서의 것이 아니어서 보내지 않았습니다/);
  assert.equal(site.confirms.length, 2);
  site.formSeq = null;
});
await ta('출장자가 여럿이면 내 계산서로 다시 열어 내 출장자 번호로 확정한다', async () => {
  site.docs[146000].travelers = [['158000', '홍길동'], ['158001', '김거화']];
  site.gets.length = 0;
  await tripPreConfirm(rowOf(146000), { name: '김거화' });
  assert.deepEqual(site.gets.slice(0, 2), ['/BusinessTrip/CalPrint?seq=146000', '/BusinessTrip/CalPrint?seq=146000&trseq=158001']);
  assert.equal(site.confirms.at(-1), 'seq=146000&trseq=158001&__RequestVerificationToken=tok-confirm');
});
await ta('로그인이 풀려 계산서 화면 대신 로그인 화면이 오면 로그인하라고 말한다 (아무것도 보내지 않는다)', async () => {
  site.docs = fresh();
  site.login = true;
  const n = site.confirms.length;
  await assert.rejects(tripPreConfirm({ seq: '146000', from: '2026-09-20', to: '2026-09-20', travelers: [] }, { name: '김거화' }), (err) => err instanceof AuthError);
  assert.equal(site.confirms.length, n);
  site.login = false;
});

console.log('사후정산 확정 — 증빙 송부 칸의 보내기가 사후정산을 저장한 뒤에 부른다');
await ta('사전정산만 완료한 계산서(사후정산 대기)에는 보내지 않는다 — 사후정산을 먼저 저장해야 한다', async () => {
  site.docs = fresh();
  site.docs[145580].pre = '완료';
  const n = site.confirms.length;
  await assert.rejects(tripPostConfirm(rowOf(145580), { name: '김거화' }), /계산서 화면에 사후정산 확정 버튼이 없습니다\(지금 단계: 사전정산 완료\)/);
  assert.equal(site.confirms.length, n);
});
await ta('사전정산을 쓰는 중인 계산서의 확정 폼(사전정산 확정)을 대신 누르지 않는다', async () => {
  site.docs = fresh();
  const n = site.confirms.length;
  await assert.rejects(tripPostConfirm(rowOf(145580), { name: '김거화' }), /사후정산 확정 버튼이 없습니다\(지금 단계: 사전정산 작성\)/);
  assert.deepEqual([site.confirms.length, site.docs[145580].pre], [n, '작성']);
});
await ta('"사후정산 작성" 단계의 확정 폼을 그대로 보내고, 목록을 다시 읽어 사후정산이 "완료"가 됐는지로 성공을 판정한다', async () => {
  site.docs = fresh();
  Object.assign(site.docs[145580], { pre: '완료', post: '작성' });
  assert.deepEqual([parseCalPage(dom(CAL('145580'))).step, STEP_POST_WRITING], ['사후정산 작성', '사후정산 작성']);
  const stages = [];
  const r = await tripPostConfirm(rowOf(145580), { name: '김거화', onStage: (s) => stages.push(s) });
  assert.equal(site.confirms.at(-1), 'seq=145580&trseq=157777&__RequestVerificationToken=tok-confirm');
  assert.deepEqual([r.sent, r.row.travelers[0].post, r.stage], [true, '완료', { phase: 'post', done: true, label: '사후정산 완료' }]);
  assert.deepEqual(stages, ['계산서 화면을 여는 중...', '사후정산을 완료(확정)하는 중...']);
});
await ta('이미 완료된 사후정산에는 확정을 보내지 않고 그대로 돌려준다', async () => {
  const n = site.confirms.length;
  const r = await tripPostConfirm(rowOf(145580), { name: '김거화' });
  assert.deepEqual([r.sent, r.stage.done, site.confirms.length], [false, true, n]);
});
await ta('확정을 보냈는데 목록의 사후정산이 그대로면 던진다. 화면에 확정 폼이 없어도 던진다(보내지 않는다)', async () => {
  site.docs = fresh();
  Object.assign(site.docs[145580], { pre: '완료', post: '작성' });
  site.stuck = true;
  await assert.rejects(tripPostConfirm(rowOf(145580), { name: '김거화' }), /확정을 보냈지만 목록의 사후정산이 완료로 바뀌지 않았습니다/);
  site.stuck = false;
  site.postForm = false;
  const n = site.confirms.length;
  await assert.rejects(tripPostConfirm(rowOf(145580), { name: '김거화' }), /사후정산 확정 버튼이 없습니다\(지금 단계: 사후정산 작성\)/);
  assert.equal(site.confirms.length, n);
  site.postForm = true;
});

/* ------------------------------------------------------------ 패널 */

const { createAttendPanel } = await import('../attendpanel.js');
const { createEvidenceStore } = await import('../src/evidence.js');
const shelf = new Map();
const evidence = createEvidenceStore({
  set: async (k, v) => { shelf.set(k, v); }, delete: async (k) => { shelf.delete(k); }, all: async () => [...shelf.values()],
});
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logs = [];
const panel = createAttendPanel({
  $: (id) => doc.getElementById(id), escapeHtml,
  logEvent: (kind, ok, text) => logs.push({ kind, ok, text }), ai: () => ({ apiKey: 'sk-x', cli: false }), evidence,
});
panel.wire();

const item = (docNo, from, to, reason) => ({ docNo, formId: 'TR', status: '5', statusName: '결재완료', kindName: '국내출장',
  summary: `국내출장 ${+from.slice(5, 7)}/${+from.slice(8)}${to !== from ? `~${+to.slice(5, 7)}/${+to.slice(8)}` : ''} 07:00~20:00`, reason, from, to, start: '07:00', end: '20:00', actions: [], web: false });
const NIGHT = item('TR-1', '2026-09-09', '2026-09-10', 'K-Battery Show 참석');
const DAY = item('TR-2', '2026-09-20', '2026-09-20', '과제 협의');
const KTX = (date, dep, arr) => ({ seq: '1', trseq: '7380', revno: '', date, dep, arr, transport: 'Train', grade: '일반석', total: 33100, currency: 'KRW' });
const st = panel.state;
/** 사이트를 처음으로 돌리고(둘 다 사전정산 작성), 패널이 그 목록을 읽은 것처럼 앉힌 뒤 그 줄을 편다. */
async function open(docNo) {
  site.docs = fresh();
  site.calls.length = 0;
  site.confirms.length = 0;
  Object.assign(st, {
    view: 'all', items: [NIGHT, DAY], all: [NIGHT, DAY], loadedOnce: true, openDoc: docNo, workplace: '부산',
    trips: { rows: parseTripList(dom(LIST())), me: '김거화' },
    after: {
      145580: { detail: { rows: [KTX('2026-09-09', '부산', '서울'), KTX('2026-09-10', '서울', '부산')], transports: ['Train', 'Train'] } },
      146000: { detail: { rows: [KTX('2026-09-20', '부산', '대전'), KTX('2026-09-20', '대전', '부산')], transports: ['Train', 'Train'] } },
    },
  });
  await panel.reload();   // HR 에는 닿지 못한다 — 앉혀 둔 신청 내역이 그대로 그려진다
}
const card = () => doc.querySelector('#atList li.open');
const head = () => [card().querySelector('.at-after-head strong').textContent, card().querySelector('.at-after-why').textContent];
const doneBtn = () => card().querySelector('button[data-act="pre-done"]');
const blank = { docType: null, vendor: null, bizNo: null, payDate: null, payPlace: null, atDestination: null, checkIn: null, checkOut: null, nights: null, total: null, supply: null, vat: null,
  currency: 'KRW', corporateCard: null, airline: null, flightNo: null, flightDate: null, depPlace: null, arrPlace: null, depTime: null, arrTime: null,
  seatClass: null, retDate: null, retDepPlace: null, retArrPlace: null, retDepTime: null, retFlightNo: null, mileage: null, passenger: null, extra: null, summary: '' };
const drop = async (seq, name, record) => {
  site.record = { ...blank, ...record };
  const input = card().querySelector('.at-after-drop input[type="file"]');
  const asked = site.asks.length;
  Object.defineProperty(input, 'files', { configurable: true, value: [new window.File(['x'], name, { type: 'image/png' })] });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await until(() => site.asks.length > asked && !st.after[seq].busy, `${name} 을 읽기`);
};

console.log('출장 카드의 사전정산 완료 버튼 — 두 번 눌러야 나간다');
await open('TR-2');
t('사전정산을 쓰는 중인 출장 카드: 칸의 이름이 "사전정산"이고 완료 버튼과 증빙 칸이 있다', () => {
  assert.deepEqual(head(), ['사전정산', '작성 중 · 당일']);
  assert.equal(doneBtn().textContent, '사전정산 완료');
  assert.match(card().querySelector('.at-after-drop .at-file').textContent, /출장지에서 결제한 영수증\(당일출장 증명\)을 넣으면 사전정산을 완료\(확정\)하고 보관하고/);
  assert.match(card().querySelector('.at-send-how').textContent, /사전정산이 완료된 뒤에 보냅니다/, '증빙 송부는 아직 때가 아니다');
});
doneBtn().click();
t('첫 번째 누름은 어느 계산서인지 적어 보여주기만 한다', () => {
  assert.deepEqual([doneBtn().textContent, doneBtn().classList.contains('armed'), site.calls], ['한 번 더 → 확정', true, []]);
  assert.equal(doc.getElementById('atStatus').textContent, '완료(확정)할 사전정산 — 여비계산서 146000 · 국내출장 9/20 07:00~20:00');
});
doneBtn().click();
await until(() => !st.after[146000].busy && site.calls.length === 1, '사전정산 확정');
t('두 번째 누름에 확정이 나가고, 목록을 다시 읽어 카드가 "사전정산 완료"로 바뀐다 — 이제 증빙을 보낼 수 있는 단계다', () => {
  assert.deepEqual([site.calls, site.confirms], [['confirm:146000'], ['seq=146000&trseq=158000&__RequestVerificationToken=tok-confirm']]);
  assert.match(card().querySelector('.at-tripline').textContent, /여비계산서 146000 · 사전정산 완료/);
  assert.deepEqual(head(), ['사후정산', '당일']);
  assert.equal(doneBtn(), null);
  assert.equal(doc.getElementById('atStatus').textContent, '사전정산을 완료(확정)했습니다 — 여비계산서 146000 · 국내출장 9/20 07:00~20:00');
  assert.doesNotMatch(card().querySelector('.at-send-how').textContent, /사전정산이 완료된 뒤/);
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && l.text === '여비계산서 사전정산 완료(확정): 146000'));
});

console.log('당일 출장 — 출장지 영수증을 넣으면 사전정산을 확정하고 증빙을 보관한다(사후정산은 없다)');
await open('TR-2');
await drop(146000, '점심.png', { docType: 'other_receipt', vendor: '대전식당', payDate: '2026-09-20', payPlace: '대전 유성구', atDestination: true, total: 12000, summary: '대전식당 카드 영수증 12,000원' });
await ta('영수증을 읽어 당일출장 증명으로 확인하고 → 사전정산을 확정하고 → 보관한다. 사후정산은 올리지 않는다', async () => {
  assert.deepEqual(site.calls, ['confirm:146000']);
  assert.deepEqual((await evidence.list('TR-2')).map((k) => [k.label, k.name]), [['당일출장 증명', '점심.png']]);
  assert.equal(card().querySelector('.at-after > .at-after-note:not(.error)').textContent,
    '사전정산을 완료(확정)했습니다 · 증빙 1장을 보관했습니다(점심.png) — 담당자에게 보낼 때 같이 갑니다 · 당일 출장이고 비행기를 타지 않아 사후정산은 올리지 않습니다');
  assert.equal(card().querySelector('.at-after-note.error'), null);
  assert.match(card().querySelector('.at-tripline').textContent, /사전정산 완료/);
});
t('증빙 송부 칸이 열린다 — 사전정산이 완료됐고 보낼 증빙이 있다', () => {
  assert.match(card().querySelector('.at-send-how').textContent, /당일출장 증명 1장 → PDF 1개/);
  assert.ok(card().querySelector('.at-send button[data-act="send-go"]'));
});

console.log('쓸 수 없는 증빙이면 확정하지 않는다');
await open('TR-1');
await drop(145580, 'ktx.png', { docType: 'train_ticket', summary: 'KTX 서울→부산 승차권' });
t('기차표는 증빙으로 받지 않는다 — 사전정산도 그대로 작성 중이다', () => {
  assert.deepEqual([site.calls, st.trips.rows.find((r) => r.seq === '145580').pre], [[], '작성']);
  assert.deepEqual(head(), ['사전정산', '작성 중 · 1박']);
});

console.log('1박 출장 — 숙박 영수증을 넣으면 사전정산을 확정한 뒤 사후정산을 올린다');
await drop(145580, '호텔.png', { docType: 'lodging_receipt', vendor: '킨텍스호텔', bizNo: '128-81-00000', payDate: '2026-09-10', checkIn: '2026-09-09', checkOut: '2026-09-10', nights: 1, total: 110000, supply: 100000, vat: 10000,
  summary: '킨텍스호텔 1박 110,000원' });
await until(() => site.calls.length === 2, '확정과 사후정산');
await ta('확정이 먼저 나가고, 그 다음에 사후정산이 올라간다 — 확정한 뒤에 생긴 출장자 번호로 사후정산 입력 화면을 연다', async () => {
  assert.deepEqual(site.calls, ['confirm:145580', 'after:145580']);
  assert.ok(site.gets.includes('/BusinessTrip/AfterTrip?seq=145580&trseq=157777'));
  assert.match(card().querySelector('.at-tripline').textContent, /여비계산서 145580 · 사후정산 작성/);
  assert.match(doc.getElementById('atStatus').textContent, /^사후정산을 올렸습니다 — 숙박 킨텍스호텔 1박 110,000원$/);
  assert.match(card().querySelector('.at-after > .at-after-note:not(.error)').textContent, /^사전정산을 완료\(확정\)했습니다 · 증빙 1장을 보관했습니다\(호텔\.png\)/);
});

console.log('확정이 안 되면 사후정산을 올리지 않는다');
await open('TR-1');
site.stuck = true;
await drop(145580, '호텔2.png', { docType: 'lodging_receipt', vendor: '킨텍스호텔', payDate: '2026-09-10', checkIn: '2026-09-09', checkOut: '2026-09-10', nights: 1, total: 110000, summary: '킨텍스호텔 1박' });
await ta('확정을 보냈지만 단계가 그대로면 거기서 멈춘다 — 까닭을 카드에 적고, 증빙은 보관해 둔다(다시 넣지 않아도 된다)', async () => {
  assert.deepEqual(site.calls, ['confirm:145580'], '사후정산 저장은 나가지 않았다');
  assert.match(card().querySelector('.at-after-note.error').textContent, /^사전정산 완료 실패: 확정을 보냈지만 목록의 사전정산이 완료로 바뀌지 않았습니다/);
  assert.match(doc.getElementById('atStatus').textContent, /^사전정산 완료 실패: 확정을 보냈지만/);
  assert.deepEqual(head(), ['사전정산', '작성 중 · 1박']);
  assert.ok((await evidence.list('TR-1')).some((k) => k.name === '호텔2.png'));
  assert.ok(logs.some((l) => l.kind === 'trip' && !l.ok && /사전정산 완료\(확정\) 실패: 145580/.test(l.text)));
});
site.stuck = false;

console.log(`\n통과 ${pass}건`);
process.exit(0);
