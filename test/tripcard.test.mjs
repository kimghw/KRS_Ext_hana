// 신청 내역의 출장 카드 — 가는 편·오는 편의 교통편 아이콘과 사후정산 올리기(attendpanel.js).
//
// 처음에는 사전정산대로 골라져 있고, 아이콘을 누르거나 표(항공권)를 넣으면 그 편이 바뀌며, 그것이 사후정산의 교통비 내역으로 올라간다
// (2026-10-03 사용자 지정). 패널을 진짜 화면(sidepanel.html)에 붙여 누르고 넣어 본다. HR 은 닿지 않는 환경이라 신청 내역은 상태에
// 직접 앉히고, eclass 여비계산서와 Claude API 는 흉내 낸다 — **실제 사이트에는 아무것도 보내지 않는다.**
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** 조건이 될 때까지 기다린다. 정해 둔 시간만 자면 기계가 바쁠 때(다른 테스트가 같이 돌 때) 덜 끝난 화면을 보게 된다. */
const until = async (cond, what, ms = 10000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`기다리다 시간이 다 됐습니다 — ${what}`);
    await wait(10);
  }
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
const site = { post: '대기', posts: [], oldRows: '', asks: [], record: null };
const LIST = () => `<div class="bt-topmenu"><span class="bt-user"> 김거화 (kimghw) / KOR | ENG </span></div><table id="mainList"><tbody><tr>
<td data-href="/BusinessTrip/Write?seq=145580&amp;mode=E">145580</td><td>김거화</td><td data-href="/BusinessTrip/CalPrint?seq=145580&amp;trseq=157777"> </td>
<td><span>완료</span></td><td><span>${site.post}</span></td><td>2026-09-09~2026-09-10</td><td>경기도 고양시 킨텍스</td><td>김거화</td><td>2026-09-01</td></tr></tbody></table>
<div class="bt-pager"><div>전체 1건 · 1/1 페이지</div></div>`;
const AFTER = () => `<form method="post" id="frm" enctype="multipart/form-data" action="/BusinessTrip/AfterTrip/Save">
<input type="hidden" name="seq" value="145580"><input type="hidden" name="trseq" value="157777"><input type="hidden" name="air_seq" value="">
<select name="air_abroad"><option value="N" selected="selected">N</option><option value="Y">Y</option></select>
<select name="air_bizmile"><option value="Y" selected="selected">Y</option></select><input type="text" name="air_bizairline" value=""><input type="text" name="air_mileage" value="">
<select name="air_deduction"><option value="Y" selected="selected">Y</option></select><input type="hidden" name="air_miles" value=""><input type="text" name="air_comment" value="">
<select name="air_mileusage"><option value="N" selected="selected">N</option></select><input type="text" name="air_usemileage" value="">
<table><tbody id="trBody">${site.oldRows}</tbody></table><input name="__RequestVerificationToken" type="hidden" value="tok"></form>`;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('api.anthropic.com')) {
    site.asks.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(site.record) }] }) };
  }
  if (init.method === 'POST') {
    if (!u.endsWith('/BusinessTrip/AfterTrip/Save')) throw new Error('모르는 저장 주소 ' + u);
    site.posts.push(init.body);
    site.post = '작성';
    return page('ok');
  }
  if (u.includes('/Home/List')) return page(LIST());
  if (u.includes('/BusinessTrip/AfterTrip?')) return page(AFTER());
  throw new Error('모르는 주소 ' + u);
};

/* ------------------------------------------------------------ 패널 */

const { createAttendPanel } = await import('../attendpanel.js');
const { createEvidenceStore } = await import('../src/evidence.js');
// 증빙 보관함의 뒷단(IndexedDB)은 흉내 낸다.
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

// 2026-10-03 실제 145580 의 모양: 1박 2일 KTX 출장, 사전정산 완료(교통편 두 줄), 사후정산 대기.
const KTX = (seq, dep, arr) => ({ seq, trseq: '7380', revno: '', date: '2026-09-09', dep, arr, transport: 'Train', grade: '일반석', total: 53700, currency: 'KRW' });
const IT = { docNo: 'TR-1', formId: 'TR', status: '5', statusName: '결재완료', kindName: '국내출장', summary: '국내출장 9/9~9/10 07:00~20:00',
  reason: 'K-Battery Show 참석', from: '2026-09-09', to: '2026-09-10', start: '07:00', end: '20:00', actions: [], web: false };
const st = panel.state;
Object.assign(st, {
  view: 'all', items: [IT], all: [IT], loadedOnce: true, openDoc: 'TR-1', workplace: '부산',
  trips: { rows: [{ seq: '145580', href: '/BusinessTrip/Write?seq=145580&mode=E', pre: '완료', from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시 킨텍스',
    writer: '김거화', written: '2026-09-01', travelers: [{ name: '김거화', post: '대기', trseq: '157777' }] }], me: '김거화' },
});
st.after['145580'] = { detail: { rows: [KTX('153340', '부산', '서울'), KTX('153341', '서울', '부산')], transports: ['Train', 'Train'] } };
await panel.reload();   // HR 에는 닿지 못한다 — 앉혀 둔 신청 내역이 그대로 그려진다

const legs = () => [...doc.querySelectorAll('#atList .at-legs .at-leg')].map((row) => ({
  name: row.querySelector('.at-leg-name').textContent,
  icons: [...row.querySelectorAll('button[data-act="leg"]')],
  on: [...row.querySelectorAll('button[data-act="leg"]')].filter((b) => b.classList.contains('active')).map((b) => `${b.dataset.t}${b.classList.contains('first') ? '+' : ''}`),
  what: row.querySelector('.at-leg-what').textContent,
  cls: row.querySelector('.at-leg-what').className,
}));
const press = (leg, kind) => legs()[leg === 'go' ? 0 : 1].icons.find((b) => b.dataset.t === kind).click();
const goBtn = () => doc.querySelector('#atList button[data-act="legs-go"]');
const fields = (body, name) => body.getAll(name);

console.log('가는 편·오는 편 — 처음에는 사전정산대로');
t('출장 카드를 펴면 사후정산 칸에 가는 편·오는 편이 날짜와 함께 서고, 사전정산의 교통편(KTX 일반석)이 골라져 있다', () => {
  assert.deepEqual(legs().map((l) => [l.name, l.on, l.what]), [
    ['가는 편 9/9', ['train'], 'KTX 부산→서울 일반석 53,700원'], ['오는 편 9/10', ['train'], 'KTX 서울→부산 일반석 53,700원'],
  ]);
  assert.deepEqual(legs()[0].icons.map((b) => [b.dataset.t, b.getAttribute('aria-label'), b.disabled, !!b.querySelector('svg')]),
    [['train', '기차(KTX)', false, true], ['plane', '비행기', false, true], ['bus', '버스', false, true]]);
  assert.equal(goBtn(), null, '바꾼 것이 없으면 올리기 버튼도 없다');
  assert.equal(doc.querySelector('#atList .at-after-why').textContent, '1박');
  assert.match(doc.querySelector('#atList .at-after-drop .at-file').textContent, /^숙박 영수증·예약서·항공권을 넣으면 읽어서 사후정산을 올립니다$/);
});
t('증빙 칸은 넣는 곳으로 보인다 — 아이콘과 이름이 서고, 끌어다 놓기·고르기·붙여넣기를 어디서 하는지 적혀 있다', () => {
  const box = doc.querySelector('#atList .at-after-drop');
  assert.deepEqual([box.querySelector('.at-drop-lead').textContent, !!box.querySelector('.at-drop-lead svg')], ['증빙 넣는 곳', true]);
  // 칸의 높이를 절반으로 줄였다(2026-10-03 사용자 지정) — 넣는 길은 이름 옆의 한 줄이고, 자세한 말은 풍선말에 있다.
  assert.deepEqual([...box.querySelectorAll('.at-drop-how')].map((s) => s.textContent), ['끌어다 놓기 · 눌러 고르기 · Ctrl+V']);
  assert.equal(box.querySelector('.at-drop-top').children.length, 2, '이름과 넣는 길이 한 줄에 선다');
  assert.equal(box.title, '이미지·PDF, 여러 장도 됩니다 — 붙여넣기(Ctrl+V)는 이 카드를 편 채 패널 어디서든 됩니다');
});
await ta('파일을 패널로 끌고 들어오면 놓을 칸이 짙어지고(.dragging), 끌기가 끊기면 걷힌다 — 칸 위에서는 놓을 수 있다고 표시한다', async () => {
  const drag = (type) => Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), { dataTransfer: { types: ['Files'], files: [] } });
  const root = doc.getElementById('attend');
  const miss = drag('dragover');
  doc.getElementById('atStatus').dispatchEvent(miss);
  assert.deepEqual([root.classList.contains('dragging'), miss.dataTransfer.dropEffect], [true, 'none'], '칸 밖은 놓을 수 없지만 칸은 짙어진다');
  const box = doc.querySelector('#atList .at-after-drop');
  const over = drag('dragover');
  box.querySelector('.at-drop').dispatchEvent(over);
  assert.deepEqual([over.dataTransfer.dropEffect, box.classList.contains('over')], ['copy', true]);
  box.dispatchEvent(Object.assign(drag('dragleave'), { relatedTarget: null }));
  await until(() => !root.classList.contains('dragging'), '끌기 표시 걷기', 2000);
  assert.equal(box.classList.contains('over'), false);
});

console.log('아이콘으로 편을 바꾼다');
press('back', 'plane');
t('오는 편에 비행기를 누르면 그 아이콘만 켜지고(가는 편은 그대로), 항공권이 없어 요금을 모른다고 적히며, 고른 것은 저장된다', () => {
  assert.deepEqual(legs().map((l) => l.on), [['train'], ['plane']]);
  assert.deepEqual([legs()[1].what, legs()[1].cls], ['비행기 요금을 모릅니다 — 항공권을 넣어 주세요', 'at-leg-what error']);
  assert.deepEqual(store.attendLegs, { 'TR-1': { back: { t: 'plane', g: 'standard' } } });
  assert.equal(doc.querySelector('#atList .at-after-why').textContent, '1박 · 비행기');
  assert.equal(doc.activeElement, legs()[1].icons[1], '누른 아이콘에 초점이 남는다');
});
press('back', 'train');
t('다시 기차를 누르면 사전정산의 줄 그대로다 — 바꾼 것이 없으니 올리기 버튼도 없다', () => {
  assert.deepEqual([legs()[1].on, legs()[1].what, goBtn()], [['train'], 'KTX 서울→부산 일반석 53,700원', null]);
});
press('back', 'train');
t('기차를 한 번 더 누르면 특실이다(주황색 +) — 운임표의 특실 값이 "바꿈"과 함께 적히고 올리기 버튼이 나온다', () => {
  assert.deepEqual([legs()[1].on, legs()[1].what, legs()[1].cls], [['train+'], 'KTX 서울→부산 특실 78,900원 · 바꿈', 'at-leg-what new']);
  assert.equal(legs()[1].icons[0].getAttribute('aria-label'), '기차(KTX) 특실');
  assert.equal(goBtn().textContent, '바꾼 교통편을 사후정산에 올리기');
});

console.log('증빙 없이 바꾼 편만 사후정산에 올린다 — 두 번 눌러야 나간다');
goBtn().click();
t('첫 번째 누름은 무엇이 올라가는지 적어 보여주기만 한다', () => {
  assert.equal(site.posts.length, 0);
  assert.equal(goBtn().textContent, '한 번 더 → 올리기');
  assert.equal(doc.getElementById('atStatus').textContent, '사후정산에 올릴 교통편 — 가는 편 KTX 부산→서울 일반석 53,700원 · 오는 편 KTX 서울→부산 특실 78,900원');
});
goBtn().click();
await until(() => site.posts.length === 1 && !st.after['145580'].busy, '바꾼 편을 올리기');
await ta('두 번째 누름에 사후정산 입력 화면의 폼으로 두 편이 올라간다 — 수단은 화면의 이름(기차(KTX등)), 올린 뒤 목록으로 단계를 확인한다', async () => {
  assert.equal(site.posts.length, 1);
  const body = site.posts[0];
  assert.deepEqual([fields(body, 'tr_date'), fields(body, 'tr_dep'), fields(body, 'tr_arr'), fields(body, 'tr_transport'), fields(body, 'tr_grade'), fields(body, 'tr_total')],
    [['2026-09-09', '2026-09-10'], ['부산', '서울'], ['서울', '부산'], ['기차(KTX등)', '기차(KTX등)'], ['일반석', '특실'], ['53700', '78900']]);
  assert.deepEqual([fields(body, 'seq'), fields(body, 'trseq'), fields(body, 'air_abroad'), fields(body, '__RequestVerificationToken')], [['145580'], ['157777'], ['N'], ['tok']],
    '항공권이 없으면 항공 칸은 화면 값 그대로다');
  assert.match(doc.getElementById('atStatus').textContent, /^사후정산을 올렸습니다 — KTX 2026-09-09 부산→서울 53,700원 · KTX 2026-09-10 서울→부산 78,900원$/);
  assert.match(doc.querySelector('#atList .at-after-note.ok').textContent, /올렸습니다 — 사후정산 작성/);
  assert.equal(st.trips.rows[0].travelers[0].post, '작성', '여비계산서 목록을 다시 읽어 단계를 맞춘다');
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /사후정산\) 작성: 145580/.test(l.text)));
});

console.log('항공권을 넣으면 그 날짜의 편이 비행기로 바뀌고, 나머지 편과 함께 올라간다');
// 방금 올린 두 줄이 사후정산 화면에 있다 — 다시 올릴 때 지움 표시가 되어야 한다.
site.oldRows = ['501', '502'].map((seq) => `<tr><td><input type="hidden" name="tr_seq" value="${seq}"/><input type="hidden" name="tr_del" value="0"/>
<input type="date" name="tr_date" value="2026-09-09"/></td></tr>`).join('');
site.record = {
  docType: 'flight_receipt', vendor: '대한항공', bizNo: null, payDate: '2026-09-08', checkIn: null, checkOut: null, nights: null, total: 98000, supply: null, vat: null,
  currency: 'KRW', corporateCard: null, airline: '대한항공', flightNo: 'KE1415', flightDate: '2026-09-10', depPlace: '김포', arrPlace: '김해', depTime: '19:00', arrTime: '20:05',
  seatClass: '일반석', retDate: null, retDepPlace: null, retArrPlace: null, retDepTime: null, retFlightNo: null, mileage: 210, passenger: '김거화', extra: null,
  summary: '대한항공 KE1415 김포→김해 전자영수증 98,000원',
};
{
  const input = doc.querySelector('#atList .at-after-drop input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [new window.File(['pdf'], '오는편.pdf', { type: 'application/pdf' })] });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await until(() => site.asks.length === 1 && !st.after['145580'].busy, '항공권을 읽고 올리기');
}
await ta('오는 편(9/10)의 항공권 한 장 → 오는 편은 비행기, 가는 편은 KTX 그대로. 읽은 문서는 "항공기 증명"이라고 적힌다', async () => {
  assert.equal(site.asks.length, 1, 'Claude 에게 한 장을 읽혔다');
  assert.deepEqual(legs().map((l) => [l.on, l.what]), [[['train'], 'KTX 부산→서울 일반석 53,700원'], [['plane'], '비행기 김포→김해 일반석 98,000원 · 바꿈']]);
  assert.deepEqual(store.attendLegs['TR-1'], { back: { t: 'plane', g: 'standard' } });
  assert.deepEqual([...doc.querySelectorAll('#atList .at-after-docs li')].map((li) => li.textContent), ['항공기 증명 · 오는편.pdf — 대한항공 KE1415 김포→김해 전자영수증 98,000원']);
  assert.equal(doc.querySelector('#atList .at-after-why').textContent, '1박 · 비행기');
});
await ta('항공권 파일은 여비계산서에 붙일 칸이 없어 보관함에 담긴다 — 담당자에게 보낼 때 같이 간다. 카드에 "보관 중"으로 보인다', async () => {
  const kept = await evidence.list('TR-1');
  assert.deepEqual(kept.map((k) => [k.label, k.name, k.type, k.date, k.total, k.trip.seq]), [['항공기 증명', '오는편.pdf', 'application/pdf', '2026-09-08', 98000, '145580']]);
  assert.match(kept[0].dataUrl, /^data:application\/pdf;base64,/);
  assert.match(doc.querySelector('#atList .at-kept .at-after-note').textContent, /^보관 중인 증빙 1장 — 담당자에게 보낼 때 같이 갑니다$/);
  assert.deepEqual([...doc.querySelectorAll('#atList .at-kept li span')].map((s) => s.textContent), ['항공기 증명 · 오는편.pdf']);
});
await ta('사후정산에는 KTX(가는 편)와 비행기(오는 편)가 올라가고 항공 마일리지 칸이 켜진다 — 화면에 있던 교통 줄은 지움 표시된다', async () => {
  assert.equal(site.posts.length, 2);
  const body = site.posts[1];
  assert.deepEqual([fields(body, 'tr_seq'), fields(body, 'tr_del')], [['501', '502', '', ''], ['1', '1', '0', '0']]);
  assert.deepEqual([fields(body, 'tr_transport'), fields(body, 'tr_dep'), fields(body, 'tr_arr'), fields(body, 'tr_total'), fields(body, 'tr_shr'), fields(body, 'tr_comment')],
    [['기차(KTX등)', '비행기'], ['부산', '김포'], ['서울', '김해'], ['53700', '98000'], ['', '19'], ['', '대한항공 KE1415']]);
  assert.deepEqual([fields(body, 'air_abroad'), fields(body, 'air_bizairline'), fields(body, 'air_mileage'), fields(body, 'air_miles')], [['Y'], ['대한항공'], ['210'], ['1050']]);
  assert.match(doc.getElementById('atStatus').textContent, /^사후정산을 올렸습니다 — KTX 2026-09-09 부산→서울 53,700원 · 비행기 2026-09-10 김포→김해 98,000원 · 항공 마일리지 대한항공 210마일$/);
});

console.log('비행기도 한 번 더 누르면 특실이다 (2026-10-04 사용자 지정)');
press('back', 'plane');
t('항공권이 앉은 오는 편의 비행기를 한 번 더 누르면 특실이다(주황색 +) — 등급만 특실로 바뀌고 구간·요금은 항공권 그대로다', () => {
  assert.deepEqual([legs()[1].on, legs()[1].what], [['plane+'], '비행기 김포→김해 특실 98,000원 · 바꿈']);
  assert.equal(legs()[1].icons[1].getAttribute('aria-label'), '비행기 특실');
  assert.deepEqual(store.attendLegs['TR-1'], { back: { t: 'plane', g: 'first' } });
  assert.equal(site.posts.length, 2, '누르기만 해서는 올라가지 않는다');
});
press('back', 'plane');
t('또 누르면 항공권에 적힌 좌석 등급으로 돌아간다', () => {
  assert.deepEqual([legs()[1].on, legs()[1].what], [['plane'], '비행기 김포→김해 일반석 98,000원 · 바꿈']);
  assert.deepEqual(store.attendLegs['TR-1'], { back: { t: 'plane', g: 'standard' } });
});

console.log('항공권도 숙박 증빙도 아닌 것 — 읽고 가려 적기만 하고 올리지 않는다');
const drop = async (name, type, record) => {
  site.record = record;
  const input = doc.querySelector('#atList .at-after-drop input[type="file"]');
  const asked = site.asks.length;
  Object.defineProperty(input, 'files', { configurable: true, value: [new window.File(['x'], name, { type })] });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await until(() => site.asks.length > asked && !st.after['145580'].busy, `${name} 을 읽기`);
};
const blank = Object.fromEntries(Object.keys(site.record).map((k) => [k, null]));
await drop('점심.png', 'image/png', { ...blank, docType: 'other_receipt', vendor: '해운대식당', payDate: '2026-09-09', payPlace: '부산 해운대구', atDestination: false, total: 12000, summary: '해운대식당 카드 영수증 12,000원' });
await ta('출장지가 아닌 곳에서 결제한 영수증은 증빙으로 쓸 수 없다고 적고 올리지 않는다 — 앞서 올린 교통 줄을 되풀이해 보내지도 않는다', async () => {
  assert.equal(site.posts.length, 2);
  assert.deepEqual([...doc.querySelectorAll('#atList .at-after-docs li')].map((li) => li.textContent), ['출장지 영수증 ✗ · 점심.png — 출장지에서 결제한 영수증이 아닙니다(부산 해운대구)']);
  assert.match(doc.querySelector('#atList .at-after-note.error').textContent, /^넣을 내역이 없어 올리지 않았습니다 — 점심\.png: 출장지 영수증으로 쓸 수 없습니다/);
  assert.deepEqual(legs().map((l) => l.on), [['train'], ['plane']], '가는 편·오는 편은 그대로다');
  assert.deepEqual((await evidence.list('TR-1')).map((k) => k.name), ['오는편.pdf'], '쓸 수 없는 영수증은 보관하지 않는다');
});
await drop('저녁.png', 'image/png', { ...blank, docType: 'other_receipt', vendor: '킨텍스식당', payDate: '2026-09-09', payPlace: '경기 고양시 일산서구', atDestination: true, total: 18000, summary: '킨텍스식당 카드 영수증 18,000원' });
await ta('출장지에서 결제한 영수증은 확인하고 보관함에 담는다 — 사후정산으로 올리지는 않고, 잘못이라고 적지도 않는다', async () => {
  assert.equal(site.posts.length, 2);
  assert.deepEqual([...doc.querySelectorAll('#atList .at-after-docs li')].map((li) => li.textContent), ['출장지 영수증 · 저녁.png — 킨텍스식당 카드 영수증 18,000원']);
  assert.equal(doc.querySelector('#atList .at-after-note.error'), null);
  assert.match(doc.querySelector('#atList .at-after > .at-after-note').textContent, /^증빙 1장을 보관했습니다\(저녁\.png\) — 담당자에게 보낼 때 같이 갑니다$/);
  assert.deepEqual((await evidence.list('TR-1')).map((k) => [k.label, k.name, k.total]), [['항공기 증명', '오는편.pdf', 98000], ['출장지 영수증', '저녁.png', 18000]]);
  assert.match(doc.querySelector('#atList .at-kept .at-after-note').textContent, /^보관 중인 증빙 2장/);
});
doc.querySelector('#atList .at-kept button[data-name="저녁.png"]').click();
await until(() => /보관함에서 뺐습니다/.test(doc.getElementById('atStatus').textContent), '보관함에서 빼기');
await ta('보관 중인 증빙은 × 로 뺀다 — 사이트에는 아무것도 가지 않는다', async () => {
  assert.deepEqual((await evidence.list('TR-1')).map((k) => k.name), ['오는편.pdf']);
  assert.deepEqual([...doc.querySelectorAll('#atList .at-kept li span')].map((s) => s.textContent), ['항공기 증명 · 오는편.pdf']);
  assert.equal(doc.getElementById('atStatus').textContent, '보관함에서 뺐습니다 — 저녁.png');
  assert.equal(site.posts.length, 2);
});
await drop('ktx.png', 'image/png', { ...blank, docType: 'train_ticket', summary: 'KTX 서울→부산 승차권' });
await ta('기차표는 증빙으로 받지 않는다 — 편도 바뀌지 않고 올라가지도 않는다', async () => {
  assert.equal(site.posts.length, 2);
  assert.deepEqual([...doc.querySelectorAll('#atList .at-after-docs li')].map((li) => li.textContent), ['기차·버스표 ✗ · ktx.png — 증빙으로 받지 않습니다(KTX 는 운임표의 정가로 넣습니다)']);
  assert.deepEqual(legs().map((l) => l.on), [['train'], ['plane']]);
});

console.log('사후정산을 올릴 때가 아니면 보여 주기만 한다');
st.trips.rows[0].pre = '작성';
st.trips.rows[0].travelers[0].post = '대기';
await panel.reload();
t('사전정산을 쓰는 중이면 칸의 이름이 "사전정산"이고 `사전정산 완료` 버튼이 선다 — 가는 편·오는 편 아이콘은 잠겨 있고, 보관 중인 증빙은 그대로 보인다', () => {
  assert.equal(doc.querySelectorAll('#atList .at-kept li').length, 1);
  assert.equal(legs().length, 2);
  assert.ok(legs().every((l) => l.icons.every((b) => b.disabled)));
  assert.deepEqual([doc.querySelector('#atList .at-after-head strong').textContent, doc.querySelector('#atList .at-after-why').textContent], ['사전정산', '작성 중 · 1박 · 비행기']);
  assert.equal(doc.querySelector('#atList button[data-act="pre-done"]').textContent, '사전정산 완료');
  assert.equal(doc.querySelector('#atList button[data-act="after"]'), null, '사후정산 입력 화면을 여는 아이콘은 아직 없다');
  assert.match(doc.querySelector('#atList .at-after-note').textContent, /사후정산을 올리거나 증빙을 보내려면 사전정산이 완료\(확정\)돼 있어야 합니다/);
  // 증빙은 이때도 받는다 — 넣으면 확정부터 하고 이어 간다(test/preconfirm.test.mjs 가 그 길을 본다).
  assert.match(doc.querySelector('#atList .at-after-drop .at-file').textContent, /넣으면 읽어서 사전정산을 완료\(확정\)하고 사후정산을 올립니다$/);
});
st.trips.rows[0].pre = '완료';
st.trips.rows[0].travelers[0].post = '완료';
await panel.reload();
const doneBox = () => doc.querySelector('#atList .at-after');
t('사후정산이 완료된 출장에는 정산 내역이 보여 주기만 하는 표로 선다 — 아이콘은 잠겨 있고, 증빙 넣는 곳·올리는 버튼·보관함은 없다', () => {
  assert.deepEqual([doneBox().querySelector('.at-after-head strong').textContent, doneBox().querySelector('.at-after-why').textContent], ['정산 내역', '1박 · 완료']);
  // 사후정산에 따로 올린 교통 줄이 없으면(수단이 안 적힌 줄은 치지 않는다) 사전정산의 줄이다 — 카드에서 골라 둔 편(오는 편 비행기)은 얹지 않는다.
  assert.deepEqual(store.attendLegs['TR-1'], { back: { t: 'plane', g: 'standard' } });
  assert.deepEqual(legs().map((l) => [l.name, l.on, l.what, l.cls]), [
    ['가는 편 9/9', ['train'], 'KTX 부산→서울 일반석 53,700원', 'at-leg-what'], ['오는 편 9/10', ['train'], 'KTX 서울→부산 일반석 53,700원', 'at-leg-what'],
  ]);
  assert.ok(legs().every((l) => l.icons.every((b) => b.disabled)));
  assert.deepEqual(['.at-after-drop', 'button[data-act="after"]', 'button[data-act="legs-go"]', '.at-kept'].map((q) => doneBox().querySelector(q)), [null, null, null, null]);
  assert.equal(doneBox().dataset.seq, undefined, '붙여넣기는 이 칸으로 오지 않는다 — 완료된 출장의 증빙은 증빙 송부 칸이 받는다');
  assert.equal(doneBox().querySelector('.at-lodge-count').textContent, '없음', '숙박비 내역도 같이 선다(이 출장은 숙박 줄을 올리지 않았다)');
});
// 사후정산에 따로 올린 교통 줄이 화면에 있다 — 지움 표시가 된 줄과 아직 저장하지 않은 줄(번호 없음)은 치지 않는다.
site.oldRows = [['501', '0', '2026-09-09', '부산', '서울', '기차(KTX등)', '일반석', '53700'], ['502', '0', '2026-09-10', '김포', '김해', '비행기', '일반석', '98,000'],
  ['503', '1', '2026-09-10', '서울', '부산', '버스', '', '30000'], ['', '0', '2026-09-10', '서울', '부산', '버스', '', '30000']].map(([seq, del, date, dep, arr, how, grade, total]) =>
  `<tr><td><input type="hidden" name="tr_seq" value="${seq}"/><input type="hidden" name="tr_del" value="${del}"/><input type="date" name="tr_date" value="${date}"/>
<input type="text" name="tr_dep" value="${dep}"/><input type="text" name="tr_arr" value="${arr}"/>
<select name="tr_transport">${['기차(KTX등)', '버스', '비행기'].map((v) => `<option value="${v}"${v === how ? ' selected="selected"' : ''}>${v}</option>`).join('')}</select>
<input type="text" name="tr_grade" value="${grade}"/><input type="text" name="tr_total" value="${total}"/>
<select name="tr_currency"><option value="KRW" selected="selected">원(KRW)</option></select></td></tr>`).join('');
doneBox().querySelector('button[data-act="lodge-refresh"]').click();
await until(() => legs()[1]?.what.startsWith('비행기'), '사후정산의 교통 줄 읽기');
t('사후정산에 따로 올린 교통 줄이 있으면 그 줄이 선다 — 수단은 화면의 이름(기차(KTX등)·비행기)에서 읽고, 비행기를 탔으면 그렇게 적는다', () => {
  assert.deepEqual(legs().map((l) => [l.on, l.what, l.cls]), [
    [['train'], 'KTX 부산→서울 일반석 53,700원', 'at-leg-what'], [['plane'], '비행기 김포→김해 일반석 98,000원', 'at-leg-what'],
  ]);
  assert.equal(doneBox().querySelector('.at-after-why').textContent, '1박 · 비행기 · 완료');
  assert.ok(legs().every((l) => l.icons.every((b) => b.disabled)));
  assert.equal(site.posts.length, 2, '읽기만 했다 — 아무것도 보내지 않았다');
});

console.log(`\n통과 ${pass}건`);
process.exit(0);   // 패널이 걸어 둔 타이머(두 번 누르기)가 남아 있어도 끝낸다
