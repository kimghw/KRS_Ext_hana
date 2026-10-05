// 출장 카드에 증빙을 넣었을 때 걸리는 시간을 줄인 두 가지(2026-10-05 사용자 지정 — 실제 붙여넣기를 재 보고 고친 것).
//
//   1. 여러 장은 **나란히** 읽힌다 — 한 장에 6~8초라 차례로 읽으면 장 수만큼 걸렸다(두 장 14.7초). 묶는 차례는 넣은 차례 그대로다.
//   2. 저장·확정 뒤에 여비계산서 목록(Home/List — 한 번에 1초쯤)을 **한 번만** 읽는다 — src/trip.js 가 성공을 판정하느라 읽은 그 줄을
//      카드가 그대로 쓴다(attendpanel.js 의 freshTrip). 전에는 곧바로 한 번 더 읽었다.
//
// 패널을 진짜 화면(sidepanel.html)에 붙여 넣어 본다. eclass 여비계산서와 Claude API 는 흉내 낸다 — **실제 사이트에는 아무것도 보내지 않는다.**
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, what) => {
  for (let i = 0; i < 400 && !ok(); i++) await wait(25);
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

const blank = { docType: null, vendor: null, seller: null, sellerBiz: null, bizNo: null, payDate: null, payPlace: null, atDestination: null, checkIn: null, checkOut: null, nights: null,
  total: null, totalKRW: null, supply: null, vat: null, currency: 'KRW', corporateCard: null, transport: null, airline: null, flightNo: null, flightDate: null, depPlace: null, arrPlace: null,
  depTime: null, arrTime: null, seatClass: null, retDate: null, retDepPlace: null, retArrPlace: null, retDepTime: null, retFlightNo: null, mileage: null, passenger: null, extra: null, summary: '' };
// 같은 숙박의 영수증과 예약서 — 상한액(120,000원) 안이라 묻지 않고 올라간다.
const RECORDS = {
  '영수증.png': { ...blank, docType: 'lodging_receipt', vendor: '킨텍스호텔', bizNo: '128-81-00000', payDate: '2026-09-10', checkIn: '2026-09-09', checkOut: '2026-09-10', nights: 1,
    total: 110000, supply: 100000, vat: 10000, summary: '킨텍스호텔 1박 110,000원' },
  '예약서.png': { ...blank, docType: 'lodging_booking', vendor: '킨텍스호텔', checkIn: '2026-09-09', checkOut: '2026-09-10', nights: 1, summary: '킨텍스호텔 1박 예약 확인서' },
  '점심.png': { ...blank, docType: 'other_receipt', vendor: '고양식당', payDate: '2026-09-09', atDestination: true, total: 12000, summary: '점심 12,000원' },
};

const page = (body) => new Response(`<html><body>${body}${' '.repeat(1600)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
/** reads 는 Claude 가 읽어 달라고 받은 파일 이름(받은 차례), now·peak 는 겹쳐 읽은 수, gets 는 사이트에 읽으러 간 화면(차례대로). */
const site = { pre: '완료', post: '대기', lodges: [], next: 81561, gets: [], saves: 0, confirms: 0, reads: [], now: 0, peak: 0, slow: {}, fail: '' };
const LIST = () => '<div class="bt-topmenu"><span class="bt-user"> 김거화 (kimghw) / KOR | ENG </span></div><table id="mainList"><tbody>'
  + '<tr><td data-href="/BusinessTrip/CalPrint?seq=145580">145580</td><td>김거화</td><td data-href="/BusinessTrip/CalPrint?seq=145580&amp;trseq=157777"> </td>'
  + `<td><span>${site.pre}</span></td><td><span>${site.post}</span></td><td>2026-09-09~2026-09-10</td><td>서울</td><td>김거화</td><td>2026-09-01</td></tr>`
  + '</tbody></table><div class="bt-pager"><div>전체 1건 · 1/1 페이지</div></div>';
const LODGE_KEYS = ['paydate', 'sday', 'company', 'companycode', 'cocard', 'total', 'samount', 'vat', 'comment'];
// 저장된 숙박 줄 — 실제 화면의 칸 차례 그대로다(국가 select 가 줄의 처음).
const ROW = (r) => '<tr><td><select name="lodge_nation"><option value="KR||" selected="selected">대한민국</option></select></td><td>'
  + `<input type="hidden" name="lodge_seq" value="${r.seq}" /><input type="hidden" name="lodge_del" value="0" /><input type="hidden" name="lodge_oldfile" value="" />`
  + '<input type="hidden" name="lodge_maxtotal" value="120000" /><input type="hidden" name="lodge_maxcur" value="KRW" /><input type="hidden" name="lodge_maxrate" value="1" />'
  + `<input type="hidden" name="lodge_maxconv" value="120000" /><input type="date" name="lodge_paydate" value="${r.paydate}" /></td>`
  + `<td><input type="text" name="lodge_sday" value="${r.sday}" /></td><td><input type="text" name="lodge_company" value="${r.company}" /></td>`
  + `<td><input type="text" name="lodge_companycode" value="${r.companycode}" /></td>`
  + '<td><select name="lodge_currency"><option value="KRW" selected="selected">원(KRW)</option></select></td>'
  + `<td><input type="hidden" name="lodge_cocard" value="${r.cocard}" /><input type="checkbox" /></td><td><input type="text" name="lodge_total" value="${r.total}" /></td>`
  + `<td><input type="text" name="lodge_samount" value="${r.samount}" /></td><td><input type="text" name="lodge_vat" value="${r.vat}" /></td>`
  + `<td><textarea name="lodge_comment">${r.comment}</textarea></td><td class="lodge-etc"><input type="text" name="lodge_etcname" value="" /></td>`
  + '<td class="lodge-file"><input type="file" name="lodge_file" /></td></tr>';
const AFTER = () => '<form method="post" id="frm" enctype="multipart/form-data" action="/BusinessTrip/AfterTrip/Save">'
  + '<input type="hidden" name="seq" value="145580"><input type="hidden" name="trseq" value="157777">'
  + `<table id="lodgeTbl"><tbody id="lodgeBody">${site.lodges.map(ROW).join('')}</tbody></table><table><tbody id="trBody"></tbody></table>`
  + '<input name="__RequestVerificationToken" type="hidden" value="tok-after"></form>';
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('api.anthropic.com')) {
    // 읽어 달라는 글에 파일 이름이 적혀 있다(src/llm.js 의 receiptInput) — 그 이름으로 답을 고른다.
    const name = Object.keys(RECORDS).find((n) => init.body.includes(`파일 이름: ${n}`));
    site.reads.push(name);
    site.peak = Math.max(site.peak, ++site.now);
    await wait(site.slow[name] ?? 40);
    site.now--;
    if (site.fail === name) return { ok: false, status: 500, json: async () => ({ error: { message: '읽지 못했습니다' } }), text: async () => '읽지 못했습니다' };
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(RECORDS[name]) }] }) };
  }
  if (init.method === 'POST') {
    if (!u.endsWith('/BusinessTrip/AfterTrip/Save')) throw new Error('모르는 쓰기 주소 ' + u);
    const all = (k) => init.body.getAll(`lodge_${k}`);
    const sent = all('seq').map((seq, i) => ({ seq, del: all('del')[i], ...Object.fromEntries(LODGE_KEYS.map((k) => [k, all(k)[i]])) }));
    site.saves++;
    site.gets.push('POST Save');
    // 화면이 하듯: 지움 표시가 된 줄은 사라지고, 번호가 없는 줄은 새 번호를 받는다.
    site.lodges = sent.filter((r) => r.del !== '1').map((r) => (r.seq ? r : { ...r, seq: String(site.next++) }));
    site.post = '작성';
    return page('ok');
  }
  if (u.includes('/Api/CalMaxLodge')) {
    site.gets.push('CalMaxLodge');
    return new Response('<?xml version="1.0"?><REQUEST><NODE MAXAMT="120000" CURRENCY="KRW" RATE="1" MAXAMT_CUR="120000"/></REQUEST>', { status: 200 });
  }
  if (u.includes('/Home/List')) { site.gets.push('List'); return page(LIST()); }
  if (u.includes('/BusinessTrip/AfterTrip?')) { site.gets.push('AfterTrip'); return page(AFTER()); }
  throw new Error('모르는 주소 ' + u);
};

/* ------------------------------------------------------------ 패널 */

const { parseTripList } = await import('../src/travel.js');
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
  logEvent: (kind, ok, text, extra) => logs.push({ kind, ok, text, extra }), ai: () => ({ apiKey: 'sk-x', cli: false }), evidence,
});
panel.wire();
const NIGHT = { docNo: 'TR-1', formId: 'TR', status: '5', statusName: '결재완료', kindName: '국내출장', summary: '국내출장 9/9~9/10 07:00~20:00', reason: '세미나',
  from: '2026-09-09', to: '2026-09-10', start: '07:00', end: '20:00', actions: [], web: false };
const KTX = (date, dep, arr) => ({ seq: '1', trseq: '7380', revno: '', date, dep, arr, transport: 'Train', grade: '일반석', total: 54400, currency: 'KRW' });
const st = panel.state;
const dom = (body) => new JSDOM(body).window.document;
/** 사이트를 사전정산 완료·숙박 줄 없음으로 돌리고, 패널이 그 목록을 읽은 것처럼 앉힌 뒤 출장 줄을 편다. */
async function open() {
  Object.assign(site, { pre: '완료', post: '대기', lodges: [], next: 81561, saves: 0, now: 0, peak: 0, slow: {}, fail: '' });
  shelf.clear();
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(st, {
    view: 'all', items: [NIGHT], all: [NIGHT], loadedOnce: true, openDoc: 'TR-1', workplace: '부산', lodgeMine: {}, lodgeInfo: {}, lodgeOpen: {},
    trips: { rows: parseTripList(dom(LIST())), me: '김거화', from: '2026-08-01', to: '2026-10-31', pages: 1 },
    after: { 145580: { detail: { rows: [KTX('2026-09-09', '부산', '서울'), KTX('2026-09-10', '서울', '부산')], transports: ['Train', 'Train'] } } },
  });
  await panel.reload();   // HR 에는 닿지 못한다 — 앉혀 둔 신청 내역이 그대로 그려진다
  await wait(60);         // 카드를 펴며 읽는 것(숙박비 내역)이 끝나기를 기다린다
  site.gets.length = 0;
  site.reads.length = 0;
  logs.length = 0;
}
const card = () => doc.querySelector('#atList li.open');
const status = () => doc.getElementById('atStatus').textContent;
/** 여러 장을 한꺼번에 넣는다(파일 고르기). 끝날 때까지 기다리지 않는다. */
const give = (...names) => {
  const input = card().querySelector('.at-after-drop input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: names.map((n) => new window.File([n], n, { type: 'image/png' })) });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const settled = (what) => until(() => site.reads.length > 0 && !st.after[145580].busy, what);
const count = (kind) => site.gets.filter((g) => g === kind).length;

console.log('여러 장은 나란히 읽힌다');
await open();
await ta('두 장을 한꺼번에 넣으면 둘을 같이 읽힌다 — 앞 장이 끝나기를 기다리지 않는다', async () => {
  site.slow = { '영수증.png': 120, '예약서.png': 40 };
  give('영수증.png', '예약서.png');
  await until(() => site.reads.length === 2, '두 장을 읽기 시작');
  assert.deepEqual([site.reads, site.now, site.peak], [['영수증.png', '예약서.png'], 2, 2], '첫 장을 읽는 동안 둘째 장도 읽고 있다');
  assert.equal(st.after[145580].stage, '증빙 2장을 읽는 중...');
  // 나중 장(예약서)이 먼저 끝난다 — 몇 장이 끝났는지 적힌다.
  await until(() => site.now === 1, '예약서를 다 읽기');
  await wait(10);
  assert.equal(st.after[145580].stage, '증빙 2장을 읽는 중 (1/2)');
  await settled('두 장을 읽고 올리기');
});
await ta('먼저 끝난 장이 앞에 서지 않는다 — 넣은 차례대로 묶여 한 줄로 올라간다(영수증 · 예약서)', async () => {
  assert.deepEqual([site.saves, site.lodges.map((l) => [l.seq, l.company, l.total])], [1, [['81561', '킨텍스호텔', '110000']]]);
  assert.equal(status(), '사후정산을 올렸습니다 — 숙박 킨텍스호텔 1박 110,000원');
  assert.deepEqual(logs.filter((l) => /사후정산\) 작성/.test(l.text)).map((l) => l.extra.files), [['영수증.png', '예약서.png']]);
  assert.deepEqual(st.lodgeMine[145580], { 81561: '영수증.png · 예약서.png' });
  assert.deepEqual([...shelf.values()].map((k) => k.name).sort(), ['영수증.png', '예약서.png'], '두 장 다 보관함에 있다');
});

console.log('저장 뒤 목록은 한 번만 읽는다');
await ta('올린 뒤 여비계산서 목록(Home/List)을 한 번만 읽는다 — 성공을 판정하느라 읽은 그 줄을 카드가 그대로 쓴다', async () => {
  await wait(60);
  const after = site.gets.slice(site.gets.indexOf('POST Save') + 1);
  assert.deepEqual([count('List'), after.filter((g) => g === 'List').length], [1, 1], '저장 뒤의 한 번뿐이다(전에는 두 번)');
  assert.deepEqual(site.gets, ['CalMaxLodge', 'AfterTrip', 'POST Save', 'List', 'AfterTrip', 'AfterTrip'],
    '상한액 → 입력 화면 → 저장 → 목록(확인) → 입력 화면(새 줄 번호) → 숙박비 내역 다시 읽기');
});
await ta('카드는 다시 읽은 그 줄대로 그려진다 — 사후정산이 "작성"이 되고, 담아 둔 목록의 기간·다른 값은 그대로다', async () => {
  const row = st.trips.rows.find((r) => r.seq === '145580');
  assert.deepEqual([row.travelers[0].post, row.travelers[0].trseq, st.trips.me, st.trips.from, st.trips.to, st.trips.pages], ['작성', '157777', '김거화', '2026-08-01', '2026-10-31', 1]);
  assert.match(card().querySelector('.at-lodges').textContent, /킨텍스호텔[\s\S]*110,000/, '방금 올린 줄이 숙박비 내역에 보인다');
  assert.ok(card().querySelector('.at-lodges button[data-act="lodge-info"][data-lodge="81561"]'), '그 줄에 증빙 표시가 선다');
});
await ta('홈 카드가 같은 단계를 보게, 오늘 담아 둔 여비계산서 목록(tripStages)의 그 계산서도 바뀐다', async () => {
  await open();
  const { stagesWindow, STAGES_KEY } = await import('../src/settling.js');
  const { todayStr } = await import('../src/parse.js');
  const today = todayStr();
  const other = { seq: '140001', from: today, to: today, pre: '완료', location: '부산', travelers: [{ name: '김거화', post: '완료', trseq: '1' }] };
  store[STAGES_KEY] = { day: today, since: stagesWindow(today).from, until: today, me: '김거화',
    rows: [other, { seq: '145580', from: '2026-09-09', to: '2026-09-10', pre: '완료', location: '서울', travelers: [{ name: '김거화', post: '대기', trseq: '157777' }] }] };
  give('영수증.png');
  await settled('한 장을 읽고 올리기');
  await wait(60);
  assert.equal(st.after[145580].stage, '');
  assert.deepEqual([count('List'), site.saves], [1, 1]);
  const saved = store[STAGES_KEY].rows;
  assert.deepEqual(saved.map((r) => [r.seq, r.travelers[0].post]).sort(), [['140001', '완료'], ['145580', '작성']], '그 계산서만 바뀌고 다른 계산서는 그대로다');
});
await ta('한 장만 넣으면 전처럼 무엇을 읽는 중인지 이름을 적는다', async () => {
  await open();
  site.slow = { '점심.png': 80 };
  give('점심.png');
  await until(() => site.reads.length === 1, '읽기 시작');
  assert.equal(st.after[145580].stage, '증빙을 읽는 중 (1/1) — 점심.png');
  await settled('한 장을 읽기');
  assert.deepEqual([site.saves, count('List')], [0, 0], '숙박 증빙이 아니라 올리지 않았다 — 목록도 읽지 않는다');
});
await ta('한 장이라도 못 읽으면 전처럼 아무것도 올리지 않는다 — 까닭이 카드에 적힌다', async () => {
  await open();
  site.fail = '예약서.png';
  give('영수증.png', '예약서.png');
  await settled('읽다가 실패');
  assert.deepEqual([site.saves, site.lodges.length], [0, 0]);
  assert.match(st.after[145580].error, /증빙을 읽지 못했습니다/);
});
await ta('담아 둔 목록에 그 계산서가 없으면(기간을 바꿔 읽는 중 등) 전처럼 목록을 다시 읽는다', async () => {
  await open();
  give('영수증.png');
  await until(() => site.reads.length === 1, '읽기 시작');
  // 읽는 동안 담아 둔 목록이 비워졌다 — 갈아 끼울 줄이 없다.
  st.trips = { ...st.trips, rows: [] };
  await settled('한 장을 읽고 올리기');
  await wait(60);
  assert.deepEqual([site.saves, count('List')], [1, 2], '확인하느라 한 번, 목록을 다시 채우느라 한 번');
  assert.equal(st.trips.rows.find((r) => r.seq === '145580')?.travelers[0].post, '작성');
});

console.log(`\n통과 ${pass}건`);
