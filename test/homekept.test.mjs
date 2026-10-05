// 홈의 WORKSPACE 카드에서 넣은 증빙과 패널의 출장 카드(attendpanel.js) — 2026-10-04 사용자 지정.
//
// 홈 카드는 증빙을 읽어서 보관하고(src/intake.js — 숙박 증빙·항공권에는 읽은 기록 record 와 "아직 안 올림" todo 를 붙인다) **곧바로
// 사후정산에 올린다**(src/afterup.js — 같은 날 사용자 지정: "올리면 바로 사후등록"). 그렇게 못 올려 남은 것(정산금액을 물어야 한다 등)은
// 출장 카드가 알아보고 `홈에서 넣은 증빙을 사후정산에 올리기` 버튼을 세우며, 두 번 누르면 **다시 읽지 않고** 그때 읽은 기록으로
// 올린다. 올리기 전에는 여비증빙 송부 칸의 저장·보내기가 잠긴다 — 숙박 줄이 빠진 사후정산이 확정되면 안 된다.
// 앞쪽은 남은 증빙을 버튼으로 올리는 길이고, 뒤쪽은 홈 카드가 곧바로 올렸을 때 펴 둔 출장 카드가 따라오는 것이다.
// eclass 여비계산서와 Claude 는 흉내 낸다 — **실제 사이트에는 아무것도 보내지 않는다.**
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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

// 저장소는 바뀐 것을 듣는 쪽에 알린다 — 패널은 보관함이 바뀐 것(evidenceMarks)을 이것으로 안다.
const store = {};
const heard = [];
globalThis.chrome = {
  storage: {
    local: {
      get: async () => store,
      set: async (obj) => {
        const changes = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { oldValue: store[k], newValue: v }]));
        Object.assign(store, obj);
        for (const fn of heard) fn(changes, 'local');
      },
    },
    onChanged: { addListener: (fn) => heard.push(fn) },
  },
  runtime: { sendNativeMessage: async () => { throw new Error('no host'); } },
  tabs: { query: async () => [], create: async () => {} },
  scripting: { executeScript: async () => [{ result: null }] },
};

/* ------------------------------------------------------------ 가짜 eclass: 숙박 줄을 가진 사후정산 입력 화면 */

const page = (body) => new Response(`<html><body>${body}${' '.repeat(1600)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const site = { post: '대기', lodges: [], next: 81561, saves: [], asks: [] };
const LIST = () => '<div class="bt-topmenu"><span class="bt-user"> 김거화 (kimghw) / KOR | ENG </span></div><table id="mainList"><tbody>'
  + '<tr><td data-href="/BusinessTrip/CalPrint?seq=145580">145580</td><td>김거화</td><td data-href="/BusinessTrip/CalPrint?seq=145580&amp;trseq=157777"> </td>'
  + `<td><span>완료</span></td><td><span>${site.post}</span></td><td>2026-09-09~2026-09-10</td><td>경기도 고양시</td><td>김거화</td><td>2026-09-01</td></tr>`
  + '</tbody></table><div class="bt-pager"><div>전체 1건 · 1/1 페이지</div></div>';
const LODGE_KEYS = ['paydate', 'sday', 'company', 'companycode', 'cocard', 'total', 'samount', 'vat', 'comment'];
const ROW = (r) => '<tr><td><select name="lodge_nation"><option value="KR||" selected="selected">대한민국</option></select></td><td>'
  + `<input type="hidden" name="lodge_seq" value="${r.seq}" /><input type="hidden" name="lodge_del" value="0" /><input type="hidden" name="lodge_oldfile" value="" />`
  + '<input type="hidden" name="lodge_maxtotal" value="120000" /><input type="hidden" name="lodge_maxcur" value="KRW" /><input type="hidden" name="lodge_maxrate" value="1" />'
  + `<input type="hidden" name="lodge_maxconv" value="120000" /><input type="date" name="lodge_paydate" value="${r.paydate}" /></td>`
  + `<td><input type="text" name="lodge_sday" value="${r.sday}" /></td><td><input type="text" name="lodge_company" value="${r.company}" /></td>`
  + `<td><input type="text" name="lodge_companycode" value="${r.companycode}" /></td>`
  + '<td><select name="lodge_currency"><option value="KRW" selected="selected">원(KRW)</option></select></td>'
  + `<td><input type="hidden" name="lodge_cocard" value="${r.cocard}" /></td><td><input type="text" name="lodge_total" value="${r.total}" /></td>`
  + `<td><input type="text" name="lodge_samount" value="${r.samount}" /></td><td><input type="text" name="lodge_vat" value="${r.vat}" /></td>`
  + `<td><textarea name="lodge_comment">${r.comment}</textarea></td><td><input type="text" name="lodge_etcname" value="" /></td></tr>`;
const AFTER = () => '<form method="post" id="frm" enctype="multipart/form-data" action="/BusinessTrip/AfterTrip/Save">'
  + '<input type="hidden" name="seq" value="145580"><input type="hidden" name="trseq" value="157777">'
  + `<table id="lodgeTbl"><tbody id="lodgeBody">${site.lodges.map(ROW).join('')}</tbody></table><table><tbody id="trBody"></tbody></table>`
  + '<input name="__RequestVerificationToken" type="hidden" value="tok-after"></form>';
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('api.anthropic.com')) {
    site.asks.push(1);
    throw new Error('홈 카드에서 이미 읽은 증빙을 다시 읽으면 안 된다');
  }
  if (init.method === 'POST') {
    if (!u.endsWith('/BusinessTrip/AfterTrip/Save')) throw new Error('모르는 쓰기 주소 ' + u);
    const all = (k) => init.body.getAll(`lodge_${k}`);
    const sent = all('seq').map((seq, i) => ({ seq, del: all('del')[i], ...Object.fromEntries(LODGE_KEYS.map((k) => [k, all(k)[i]])) }));
    site.saves.push({ rows: sent, file: init.body.get('lodge_file') });
    site.lodges = sent.filter((r) => r.del !== '1').map((r) => (r.seq ? r : { ...r, seq: String(site.next++) }));
    site.post = '작성';
    return page('ok');
  }
  if (u.includes('/Api/CalMaxLodge')) return new Response('<?xml version="1.0"?><REQUEST><NODE MAXAMT="120000" CURRENCY="KRW" RATE="1" MAXAMT_CUR="120000"/></REQUEST>', { status: 200 });
  if (u.includes('/Home/List')) return page(LIST());
  if (u.includes('/BusinessTrip/AfterTrip?')) return page(AFTER());
  throw new Error('모르는 주소 ' + u);
};

/* ------------------------------------------------------------ 패널과 보관함 */

const { createAttendPanel } = await import('../attendpanel.js');
const { createEvidenceStore, MARKS_KEY } = await import('../src/evidence.js');
const { intakeEvidence } = await import('../src/intake.js');
const shelf = new Map();
// 줄여 적는 곳은 기본값(chrome.storage.local) 그대로다 — 홈 카드와 패널이 같은 것을 본다.
const evidence = createEvidenceStore({ set: async (k, v) => { shelf.set(k, structuredClone(v)); }, delete: async (k) => { shelf.delete(k); }, all: async () => [...shelf.values()].map((v) => structuredClone(v)) });
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logs = [];
const panel = createAttendPanel({
  $: (id) => doc.getElementById(id), escapeHtml,
  logEvent: (kind, ok, text) => logs.push({ kind, ok, text }), ai: () => ({ apiKey: 'sk-x', cli: false }), evidence,
});
panel.wire();

const KTX = (seq, date, dep, arr) => ({ seq, trseq: '7380', revno: '', date, dep, arr, transport: 'Train', grade: '일반석', total: 59800, currency: 'KRW' });
const IT = { docNo: 'TR-1', formId: 'TR', status: '5', statusName: '결재완료', kindName: '국내출장', summary: '국내출장 9/9~9/10 07:00~20:00',
  reason: 'K-Battery Show 참석', from: '2026-09-09', to: '2026-09-10', start: '07:00', end: '20:00', actions: [], web: false };
const TRIP = { seq: '145580', from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시' };
const st = panel.state;
Object.assign(st, {
  view: 'all', items: [IT], all: [IT], loadedOnce: true, openDoc: 'TR-1', workplace: '부산',
  trips: { rows: [{ seq: '145580', href: '/BusinessTrip/CalPrint?seq=145580', pre: '완료', from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시',
    writer: '김거화', written: '2026-09-01', travelers: [{ name: '김거화', post: '대기', trseq: '157777' }] }], me: '김거화' },
});
st.after['145580'] = { detail: { rows: [KTX('1', '2026-09-09', '부산', '행신'), KTX('2', '2026-09-10', '행신', '부산')], transports: ['Train', 'Train'] }, kept: [] };
await panel.reload();

// 홈 카드가 받은 것과 같은 길(src/intake.js)로 보관함에 담는다 — Claude 가 읽은 기록은 흉내다.
const HOTEL = { docType: 'lodging_receipt', vendor: '킨텍스호텔', seller: null, sellerBiz: null, bizNo: '128-81-00000', payDate: '2026-09-10', checkIn: '2026-09-09', checkOut: '2026-09-10',
  nights: 1, total: 110000, totalKRW: null, supply: 100000, vat: 10000, currency: 'KRW', corporateCard: null, summary: '킨텍스호텔 1박 110,000원', extra: null };
const LUNCH = { docType: 'other_receipt', payDate: '2026-09-09', total: 12000, atDestination: true, summary: '점심 12,000원', extra: null };
const png = (name) => ({ name, type: 'image/png', dataUrl: `data:image/png;base64,${Buffer.from(name).toString('base64')}` });
const fromHome = (name, record) => intakeEvidence({ docNo: 'TR-1', trip: TRIP, me: '김거화', file: png(name) }, { store: evidence, read: async () => ({ record }) });

const kept = () => [...doc.querySelectorAll('#atList .at-after .at-kept li span')].map((s) => s.textContent);
const goBtn = () => doc.querySelector('#atList button[data-act="kept-go"]');
const status = () => doc.getElementById('atStatus').textContent;
const sendNote = () => doc.querySelector('#atList .at-send .at-send-note')?.textContent || '';

console.log('홈 카드에서 넣었는데 거기서 못 올린 증빙 — 출장 카드가 알아본다');
await ta('홈 카드가 증빙을 넣으면(보관함이 바뀌면) 펴 둔 출장 카드가 보관함을 다시 읽는다 — 사후정산에 안 올린 증빙이라고 적고, 올리는 버튼을 세운다', async () => {
  assert.equal(goBtn(), null);
  const a = await fromHome('hotel.png', HOTEL);
  const b = await fromHome('lunch.png', LUNCH);
  assert.deepEqual([a.kept, a.todo, b.kept, b.todo], [true, true, true, false]);
  assert.deepEqual(store[MARKS_KEY], { 'TR-1': [{ name: 'hotel.png', label: '숙박 증빙', todo: true }, { name: 'lunch.png', label: '출장지 영수증' }] });
  await until(() => kept().length === 2, '보관함 다시 읽기');
  assert.deepEqual(kept(), ['숙박 증빙 · hotel.png · 사후정산에 안 올림', '출장지 영수증 · lunch.png']);
  assert.equal(goBtn().textContent, '홈에서 넣은 증빙을 사후정산에 올리기');
  assert.equal(goBtn().closest('.at-leg-go').querySelector('.at-after-note').textContent, '홈 카드에서 넣은 증빙 1장은 사후정산에 아직 올리지 않았습니다');
});
t('올리기 전에는 여비증빙 송부 칸의 보내기가 잠긴다 — 숙박 줄이 빠진 사후정산이 확정되면 안 된다', () => {
  assert.equal(sendNote(), '홈 카드에서 넣은 증빙을 사후정산 칸에서 먼저 올려 주세요');
  assert.equal(doc.querySelector('#atList button[data-act="send-go"]').disabled, true);
});

console.log('사후정산에 올리기 — 다시 읽지 않고 그때 읽은 기록으로');
await ta('첫 누름에는 무엇이 올라가는지만 적는다 — 사이트에는 아무것도 가지 않는다', async () => {
  goBtn().click();
  await wait(30);
  assert.deepEqual([site.saves.length, site.asks.length], [0, 0]);
  assert.equal(status(), '사후정산에 올릴 증빙 — 숙박 증빙 hotel.png');
  assert.equal(goBtn().textContent, '한 번 더 → 올리기');
});
await ta('두 번째 누름에 올린다 — 숙박 줄이 그 기록대로 올라가고(첨부도), Claude 는 부르지 않는다', async () => {
  goBtn().click();
  await until(() => site.saves.length === 1 && !st.after['145580'].busy, '사후정산 올리기');
  assert.equal(site.asks.length, 0, '다시 읽지 않는다');
  const [row] = site.saves[0].rows;
  assert.deepEqual([row.seq, row.paydate, row.sday, row.company, row.companycode, row.total, row.samount, row.vat], ['', '2026-09-10', '1', '킨텍스호텔', '128-81-00000', '110000', '100000', '10000']);
  assert.equal(site.saves[0].file?.name, 'hotel.png', '숙박 줄의 첨부로도 올라간다');
  assert.match(status(), /^사후정산을 올렸습니다 — 숙박 킨텍스호텔 1박 110,000원/);
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /여비계산서\(사후정산\) 작성: 145580/.test(l.text)));
});
await ta('올린 뒤에는 "아직 안 올림" 표시가 없어진다 — 버튼이 사라지고, 홈 카드가 보는 것(evidenceMarks)에서도 빠지며, 송부 칸이 풀린다', async () => {
  await until(() => !goBtn(), '버튼 걷기');
  assert.deepEqual(kept(), ['출장지 영수증 · lunch.png', '숙박 증빙 · hotel.png']);
  const hotel = [...shelf.values()].find((k) => k.name === 'hotel.png');
  assert.deepEqual([hotel.label, hotel.todo, 'record' in hotel], ['숙박 증빙', undefined, false]);
  assert.deepEqual(store[MARKS_KEY]['TR-1'].find((k) => k.name === 'hotel.png'), { name: 'hotel.png', label: '숙박 증빙' });
  assert.equal(sendNote(), '', '막는 까닭이 걷힌다 — 저장·확정부터 한다는 안내는 카드에 적지 않는다');
  assert.equal(doc.querySelector('#atList button[data-act="send-go"]').disabled, true, '과제·계정과 받는 사람을 아직 고르지 않아 보내기는 잠겨 있다 — 막는 까닭은 없다');
});
// 2026-10-05 사용자 지정(올라가 있는 숙박 줄 아래의 올리기 버튼을 보고): "왜 여전히 이 버튼이 있는지 모르겠어. 이게 확인이 안되나? 출장이랑 맞잖아"
await ta('같은 증빙을 홈 카드에 또 넣으면 이미 올라가 있는 줄인 것을 알아본다 — 올리는 버튼 없이 "안 올림" 표시가 걷히고, 사이트에는 아무것도 가지 않는다', async () => {
  await fromHome('hotel.png', HOTEL);
  await until(() => /^이미 사후정산에 올라가 있는 숙박 줄의 증빙입니다/.test(status()) && !goBtn(), '이미 올라간 줄 알아보기');
  assert.equal(status(), '이미 사후정산에 올라가 있는 숙박 줄의 증빙입니다 — 다시 올리지 않습니다(hotel.png)');
  assert.equal(site.saves.length, 1, '다시 올리지 않는다');
  assert.deepEqual(kept().filter((s) => /안 올림/.test(s)), []);
  assert.deepEqual(store[MARKS_KEY]['TR-1'].find((k) => k.name === 'hotel.png'), { name: 'hotel.png', label: '숙박 증빙' }, '홈 카드가 보는 것에서도 걷힌다');
  assert.equal(sendNote(), '', '송부 칸도 잠기지 않는다');
});

console.log('홈 카드가 곧바로 올린다(src/afterup.js) — 펴 둔 출장 카드는 따라온다');
const { afterUp, UP_BUSY_KEY } = await import('../src/afterup.js');
const tripSite = await import('../src/trip.js');
const INN = { ...HOTEL, vendor: '일산여관', bizNo: '128-81-11111', total: 99000, supply: 90000, vat: 9000, summary: '일산여관 1박 99,000원' };
/** 홈 카드가 하는 것과 같은 길 — 보관함은 배경이 하듯 이 보관함에서 꺼내고, 여비계산서는 진짜 길(src/trip.js)로 가짜 eclass 와 말한다. */
const homeUp = () => afterUp({ docNo: 'TR-1', row: { seq: '145580', from: '2026-09-09', to: '2026-09-10' }, me: '김거화' }, {
  storage: chrome.storage.local,
  given: async (docNo) => (await evidence.list(docNo)).filter((k) => k.record).map((k) => ({ name: k.name, type: k.type, label: k.label, todo: !!k.todo, record: k.record })),
  fileOf: async (docNo, name) => (await evidence.list(docNo)).find((k) => k.name === name)?.dataUrl || '',
  done: (docNo, names) => evidence.settle(docNo, names),
  log: (ok, text) => { logs.push({ kind: 'trip', ok, text }); },
  // 사전정산의 교통편은 카드가 읽어 둔 것과 같다(가짜 eclass 에는 작성 화면이 없다).
  site: { list: tripSite.tripList, preDetail: async () => st.after['145580'].detail, preConfirm: tripSite.tripPreConfirm, lodgeMax: tripSite.tripLodgeMax, afterSave: tripSite.tripAfterSave },
});
const lodgeRows = () => [...doc.querySelectorAll('#atList .at-lodge')].map((n) => `${n.querySelector('.at-lodge-company').textContent} ${n.querySelector('.at-lodge-total').textContent} ${n.querySelector('.at-lodge-src').textContent}`);
await ta('홈 카드가 받아 올리는 중이면 패널의 버튼은 올리지 않는다 — 같은 숙박 줄이 두 번 올라가지 않게', async () => {
  await chrome.storage.local.set({ [UP_BUSY_KEY]: { 'TR-1': Date.now() } });
  await fromHome('inn.png', INN);
  await until(() => !!goBtn(), '버튼 서기');
  goBtn().click();
  await wait(20);
  goBtn().click();
  await wait(50);
  assert.equal(site.saves.length, 1, '올리지 않는다');
  assert.match(status(), /^홈 카드가 이 증빙을 사후정산에 올리는 중입니다/);
  assert.equal(goBtn().textContent, '홈에서 넣은 증빙을 사후정산에 올리기');
});
await ta('홈 카드가 올리면 펴 둔 출장 카드가 따라온다 — "안 올림"과 버튼이 걷히고, 숙박비 내역에 그 줄이 증빙으로 올린 줄로 선다. 다시 읽지 않는다', async () => {
  const r = await homeUp();
  await chrome.storage.local.set({ [UP_BUSY_KEY]: {} });
  assert.deepEqual([r.ok, r.sent, r.text], [true, true, '사후정산을 올렸습니다 — 숙박 일산여관 1박 99,000원']);
  assert.equal(site.saves.length, 2);
  const row = site.saves[1].rows.at(-1);
  assert.deepEqual([row.seq, row.company, row.total, row.samount, row.vat, site.saves[1].file?.name], ['', '일산여관', '99000', '90000', '9000', 'inn.png']);
  assert.equal(site.asks.length, 0, 'Claude 는 부르지 않는다');
  await until(() => !goBtn() && lodgeRows().length === 2, '카드가 따라오기');
  assert.deepEqual(kept().filter((s) => /안 올림/.test(s)), []);
  assert.deepEqual(lodgeRows(), ['킨텍스호텔 110,000원 증빙', '일산여관 99,000원 증빙']);
  assert.equal(store.attendLodgeMine['145580']['81562'], 'inn.png');
  assert.equal(sendNote(), '', '송부 칸이 풀린다');
});

// 2026-10-05 사용자 지정: "출장 기간동안의 내용이 아니면 알림을 줘 안맞다고, 맞는것만 선별취급 해서 올리고 해당 없는거는 문서보관에 알림표지 하고
// 확정 해주기 전까지는 보내기 해도 같이 보내지 말고"
console.log('출장 기간의 것이 아닌 증빙 — 알림 표시로 보관하고, 확정하기 전에는 올리지도 보내지도 않는다');
const JEJU = { ...HOTEL, vendor: '제주호텔', bizNo: '616-81-22222', payDate: '2026-09-21', checkIn: '2026-09-20', checkOut: '2026-09-21', total: 90000, supply: null, vat: null, summary: '제주호텔 1박 90,000원' };
const WHY = '묵은 기간(9/20~9/21)이 출장 기간(9/9~9/10) 밖입니다';
const keptLi = (name) => [...doc.querySelectorAll('#atList .at-kept li')].find((li) => li.querySelector(`button[data-act="kept-drop"][data-name="${name}"]`));
const heldNote = () => doc.querySelector('#atList .at-send .at-send-held')?.textContent || '';
await ta('홈 카드에 넣은 기간 밖의 숙박 영수증은 알림 표시로 담긴다 — 홈 카드가 올리는 길은 그것을 올리지 않고, 출장 카드의 보관 중인 증빙에 ⚠ 와 `확정`이 선다', async () => {
  const r = await fromHome('jeju.png', JEJU);
  assert.deepEqual([r.kept, r.warn, r.todo], [true, WHY, false]);
  assert.deepEqual(store[MARKS_KEY]['TR-1'].find((k) => k.name === 'jeju.png'), { name: 'jeju.png', label: '숙박 증빙', warn: WHY });
  const up = await homeUp();
  assert.deepEqual([up.sent, up.hold, up.text, site.saves.length], [false, false, '', 2], '올릴 것이 없다 — 사이트에는 아무것도 가지 않는다');
  await until(() => !!keptLi('jeju.png'), '보관함 다시 읽기');
  assert.deepEqual([keptLi('jeju.png').classList.contains('warn'), keptLi('jeju.png').querySelector('span').textContent], [true, `숙박 증빙 · jeju.png · ⚠ ${WHY}`]);
  assert.equal(goBtn(), null, '확정하기 전에는 올리는 버튼이 없다');
});
t('확정하기 전에는 보낼 때도 빠진다 — 송부 칸에 무엇이 빠지는지 적히고, 묶이는 증빙 수에 들지 않는다', () => {
  assert.equal(heldNote(), '출장 기간과 안 맞아 확정하지 않은 증빙 1장은 보내지 않습니다 — jeju.png');
  // 맞는 증빙 셋(출장지 영수증 1 · 숙박 증빙 2)만 센다. 과제·계정과 받는 사람을 아직 고르지 않아 보내기는 잠겨 있다.
  assert.match(doc.querySelector('#atList .at-send .at-send-how').textContent, /여비계산서 1부 · 출장지 영수증 1장 · 숙박 증빙 2장 → PDF 1개$/);
});
await ta('`확정`하면 알림이 걷히고 "사후정산에 안 올림"이 된다 — 올리기 전에는 송부 칸이 잠기고, 올리는 버튼으로 그때 읽은 기록대로 올라간다', async () => {
  keptLi('jeju.png').querySelector('button[data-act="kept-ok"]').click();
  await until(() => /^이 출장의 증빙으로 확정했습니다 — jeju\.png/.test(status()), '확정');
  assert.equal(site.saves.length, 2, '확정만으로는 사이트에 아무것도 가지 않는다');
  assert.deepEqual([keptLi('jeju.png').classList.contains('warn'), keptLi('jeju.png').querySelector('span').textContent], [false, '숙박 증빙 · jeju.png · 사후정산에 안 올림']);
  assert.deepEqual([heldNote(), sendNote()], ['', '확정한 증빙을 사후정산 칸에서 먼저 올려 주세요']);
  assert.equal(goBtn().textContent, '보관한 증빙을 사후정산에 올리기');
  assert.deepEqual(store[MARKS_KEY]['TR-1'].find((k) => k.name === 'jeju.png'), { name: 'jeju.png', label: '숙박 증빙', todo: true });
  goBtn().click();
  await wait(20);
  goBtn().click();
  await until(() => site.saves.length === 3 && !st.after['145580'].busy, '확정한 증빙 올리기');
  const row = site.saves[2].rows.at(-1);
  assert.deepEqual([row.seq, row.paydate, row.sday, row.company, row.total, site.saves[2].file?.name], ['', '2026-09-21', '1', '제주호텔', '90000', 'jeju.png']);
  assert.equal(site.asks.length, 0, '다시 읽지 않는다');
  await until(() => !goBtn(), '버튼 걷기');
  assert.equal(sendNote(), '');
});

console.log(`\n통과 ${pass}건`);
