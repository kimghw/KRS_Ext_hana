// 홈의 WORKSPACE 카드에서 넣어 둔 증빙을 패널의 출장 카드가 사후정산에 올린다(attendpanel.js) — 2026-10-04 사용자 지정.
//
// 홈 카드는 증빙을 읽어서 보관만 한다(src/intake.js — 숙박 증빙·항공권에는 읽은 기록 record 와 "아직 안 올림" todo 를 붙인다).
// 출장 카드는 그것을 알아보고 `홈에서 넣은 증빙을 사후정산에 올리기` 버튼을 세우며, 두 번 누르면 **다시 읽지 않고** 그때 읽은 기록으로
// 올린다. 올리기 전에는 증빙 송부 칸의 저장·보내기가 잠긴다 — 숙박 줄이 빠진 사후정산이 확정되면 안 된다.
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

console.log('홈 카드에서 넣은 증빙 — 출장 카드가 알아본다');
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
t('올리기 전에는 증빙 송부 칸의 사후정산 저장·보내기가 잠긴다 — 숙박 줄이 빠진 사후정산이 확정되면 안 된다', () => {
  assert.equal(sendNote(), '홈 카드에서 넣은 증빙을 사후정산 칸에서 먼저 올려 주세요');
  assert.deepEqual(['send-save', 'send-go'].map((act) => doc.querySelector(`#atList button[data-act="${act}"]`).disabled), [true, true]);
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
  assert.equal(sendNote(), '보내기는 사후정산을 저장하고 확정(완료)한 뒤에 보냅니다');
});
await ta('같은 증빙을 홈 카드에 또 넣어도 같은 숙박 줄을 두 번 올리지 않는다', async () => {
  await fromHome('hotel.png', HOTEL);
  await until(() => !!goBtn(), '버튼 다시 서기');
  goBtn().click();
  await wait(20);
  goBtn().click();
  await until(() => !st.after['145580'].busy && !goBtn(), '다시 올리기');
  assert.equal(site.saves.length, 1, '같은 줄이 이미 있어 보내지 않는다');
  assert.match(status(), /같은 숙박 줄이 사후정산에 이미 있어 다시 올리지 않았습니다/);
});

console.log(`\n통과 ${pass}건`);
