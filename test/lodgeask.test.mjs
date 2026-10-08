// 사후정산의 숙박 줄 — 무엇을 어떻게 올리는가(2026-10-03 사용자 지정).
//
//   - 업체명은 **산 곳(구매처)**이다. 아고다에서 샀으면 아고다이고 호텔 이름이 아니다(묵은 곳은 비고에 적는다).
//   - 정산금액은 **원화로만** 적는다. 외화 문서에 원화 금액이 없으면 올리지 않고 원화로 결제된 금액을 묻는다(환율로 어림하지 않는다).
//   - 실제 금액이 숙박비 **상한액**을 넘으면 올리지 않고 상한액으로 정산할지 실제 금액으로 정산할지 묻는다.
//   - 공급가액·부가세는 문서에 적혀 있으면 그 값, 없으면 정산금액에서 되셈한다(÷ 1.1).
//   - 같은 줄이 사이트에 이미 있으면 다시 올리지 않는다 — 실제 계산서(143884)에 같은 숙박이 세 줄 올라가 있었다.
//
// 숙박 줄의 칸과 상한액 응답(CalMaxLodge)은 2026-10-03 실제 사후정산 입력 화면에서 읽은 그대로다. eclass 와 Claude 는 흉내 낸다 —
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

const { afterPlan, afterFields, afterSummary, lodgeOf, lodgeAsk, lodgeCap, lodgeSettle, lodgeRowsOf, lodgeSame, LODGE_CURRENCY, LODGE_OVER_REASON } = await import('../src/after.js');

const TRIP = { seq: '145580', from: '2026-09-09', to: '2026-09-10', location: '서울' };
const blank = { docType: null, vendor: null, seller: null, sellerBiz: null, bizNo: null, payDate: null, payPlace: null, atDestination: null, checkIn: null, checkOut: null, nights: null,
  total: null, totalKRW: null, supply: null, vat: null, currency: 'KRW', corporateCard: null, transport: null, airline: null, flightNo: null, flightDate: null, depPlace: null, arrPlace: null,
  depTime: null, arrTime: null, seatClass: null, retDate: null, retDepPlace: null, retArrPlace: null, retDepTime: null, retFlightNo: null, mileage: null, passenger: null, extra: null, summary: '' };
const rec = (over) => ({ ...blank, ...over });
// 실제로 넣었던 문서의 모양: 아고다에서 달러로 산 토요코인 강남 1박 예약 확인서.
const AGODA = rec({ docType: 'lodging_booking', vendor: 'Toyoko INN Gangnam Seoul', seller: '아고다', payDate: '2026-09-08', checkIn: '2026-09-09', checkOut: '2026-09-10', nights: 1,
  total: 88.46, currency: 'USD', summary: 'Toyoko INN Gangnam Seoul 1박 예약 확인서 USD 88.46' });
const HOTEL = rec({ docType: 'lodging_receipt', vendor: '킨텍스호텔', bizNo: '128-81-00000', payDate: '2026-09-10', checkIn: '2026-09-09', checkOut: '2026-09-10', nights: 1,
  total: 110000, supply: 100000, vat: 10000, summary: '킨텍스호텔 1박 110,000원' });
const CAP = { maxtotal: '120000', maxcur: 'KRW', maxrate: '1', maxconv: '120000' };
const lodgeRow = (record, over = {}) => lodgeSettle({ sources: ['a.png'], ...lodgeOf(record.docType === 'lodging_receipt' ? [record] : [], record.docType === 'lodging_booking' ? [record] : []), ...over });

console.log('업체명은 산 곳(구매처) — 호텔 이름이 아니다');
t('아고다에서 샀으면 업체명은 아고다이고, 묵은 곳은 비고에 적는다. 사업자등록번호는 구매처의 것이다', () => {
  const l = lodgeOf([], [AGODA]);
  assert.deepEqual([l.company, l.stay, l.comment, l.companycode], ['아고다', 'Toyoko INN Gangnam Seoul', 'Toyoko INN Gangnam Seoul', '']);
  const biz = lodgeOf([rec({ ...AGODA, docType: 'lodging_receipt', sellerBiz: 'Agoda Company Pte. Ltd.', bizNo: '200506877R' })]);
  assert.deepEqual([biz.company, biz.companycode, biz.comment], ['아고다', '200506877R', 'Toyoko INN Gangnam Seoul · Agoda Company Pte. Ltd.'], '문서에 사업자명이 있으면 비고에 같이 적는다');
});
t('숙박업소에 직접 결제했으면 업체명은 그 숙박업소다 — 구매처를 못 읽었어도 그렇다', () => {
  assert.deepEqual([lodgeOf([HOTEL]).company, lodgeOf([HOTEL]).comment, lodgeOf([HOTEL]).companycode], ['킨텍스호텔', '', '128-81-00000']);
  const same = lodgeOf([rec({ ...HOTEL, seller: '킨텍스 호텔', sellerBiz: '(주)킨텍스호텔' })]);
  assert.deepEqual([same.company, same.comment], ['킨텍스 호텔', ''], '구매처·묵은 곳·사업자명이 같은 이름이면 비고에 되풀이하지 않는다');
  assert.equal(lodgeOf([rec({ ...HOTEL, sellerBiz: '고양관광개발(주)' })]).comment, '고양관광개발(주)', '사업자명이 다른 이름이면 비고에 적는다');
});

console.log('정산금액은 원화로만');
t('원화 문서는 그 금액이 실제 금액이다. 화폐 칸은 언제나 원화다', () => {
  const l = lodgeRow(HOTEL);
  assert.deepEqual([l.actual, l.total, lodgeAsk(l), LODGE_CURRENCY], [110000, 110000, '', 'KRW']);
  assert.equal(afterPlan([{ ...AGODA, file: { name: 'a.png' } }], { trip: TRIP, detail: { rows: [], transports: [] } }).lodge[0].currency, 'KRW');
});
t('외화 문서에 원화 금액이 같이 적혀 있으면 그것이 실제 금액이다', () => {
  const l = lodgeRow(rec({ ...AGODA, totalKRW: 125052.4 }));
  assert.deepEqual([l.actual, l.total, l.doc, lodgeAsk(l)], [125052, 125052, { currency: 'USD', total: 88.46, supply: null, vat: null }, '']);
});
t('외화 문서에 원화 금액이 없으면 정산금액을 정하지 않고 묻는다(환율로 어림하지 않는다) — 올리지 못할 문제는 아니다', () => {
  const l = lodgeRow(AGODA);
  assert.deepEqual([l.actual, l.total, l.samount, l.vat, lodgeAsk(l)], [null, null, null, null, 'krw']);
  const plan = afterPlan([{ ...AGODA, file: { name: 'a.png' } }], { trip: TRIP, detail: { rows: [], transports: [] } });
  assert.deepEqual(plan.problems, []);
  l.actual = 125052;
  assert.deepEqual([lodgeSettle(l).total, lodgeAsk(l)], [125052, ''], '적어 준 원화 금액이 실제 금액이 된다');
});
t('금액 자체를 못 읽었으면 묻지 않고 문제로 적는다', () => {
  const plan = afterPlan([{ ...AGODA, total: null, file: { name: 'a.png' } }], { trip: TRIP, detail: { rows: [], transports: [] } });
  assert.deepEqual([plan.problems, lodgeAsk(plan.lodge[0])], [['숙박(a.png)에서 정산금액을(를) 읽지 못했습니다'], '']);
});

console.log('상한액 — 넘으면 상한액으로 정산할지 실제 금액으로 정산할지 고른다');
t('상한액은 1일 상한 × 숙박 일수다. 상한을 원화로 모르면 묻지 않는다', () => {
  assert.deepEqual(lodgeCap({ ...CAP, sday: 2 }), { day: 120000, total: 240000 });
  assert.equal(lodgeCap({ maxtotal: '150', maxcur: 'USD', maxrate: '', maxconv: '', sday: 1 }), null);
  assert.equal(lodgeAsk(lodgeRow(rec({ ...AGODA, totalKRW: 125052 }))), '', '상한을 아직 읽지 않았다');
});
t('실제 금액이 상한액 이하면 묻지 않고, 넘으면 묻는다', () => {
  assert.equal(lodgeAsk(lodgeRow(HOTEL, CAP)), '');
  assert.equal(lodgeAsk(lodgeRow(rec({ ...HOTEL, total: 120000 }), CAP)), '', '딱 상한액이면 넘은 것이 아니다');
  assert.equal(lodgeAsk(lodgeRow(rec({ ...AGODA, totalKRW: 125052 }), CAP)), 'cap');
  assert.equal(lodgeAsk(lodgeRow(rec({ ...HOTEL, total: 230000, nights: 2, checkOut: '2026-09-11', supply: null, vat: null }), CAP)), '', '2박에 230,000원은 상한액(240,000원) 안이다');
});
t('상한액으로 정산하면 정산금액이 상한액이 되고, 실제 금액으로 정산하면 그대로다 — 어느 쪽이든 고르면 더 묻지 않는다', () => {
  const cap = lodgeRow(rec({ ...AGODA, totalKRW: 125052 }), { ...CAP, settle: 'cap' });
  assert.deepEqual([cap.total, cap.capped, cap.actual, lodgeAsk(cap)], [120000, true, 125052, '']);
  const real = lodgeRow(rec({ ...AGODA, totalKRW: 125052 }), { ...CAP, settle: 'real' });
  assert.deepEqual([real.total, real.capped, lodgeAsk(real)], [125052, false, '']);
  assert.equal(lodgeRow(HOTEL, { ...CAP, settle: 'cap' }).total, 110000, '상한액을 넘지 않으면 상한액으로 올리지 않는다');
});

console.log('공급가액·부가세 — 문서에 있으면 그 값, 없으면 정산금액에서 역산');
t('문서에 적혀 있으면 그 값이고, 하나만 있으면 다른 하나는 뺄셈이다', () => {
  assert.deepEqual([lodgeRow(HOTEL).samount, lodgeRow(HOTEL).vat, lodgeRow(HOTEL).vatFrom], [100000, 10000, 'doc']);
  const one = lodgeRow(rec({ ...HOTEL, supply: null }));
  assert.deepEqual([one.samount, one.vat, one.vatFrom], [100000, 10000, 'doc']);
});
t('문서에 없으면 정산금액에서 되셈한다 — 공급가액 = 정산금액 ÷ 1.1(반올림), 부가세 = 나머지', () => {
  const l = lodgeRow(rec({ ...HOTEL, total: 125052, supply: null, vat: null }));
  assert.deepEqual([l.samount, l.vat, l.samount + l.vat, l.vatFrom], [113684, 11368, 125052, 'calc']);
});
t('정산금액이 문서의 금액과 달라졌으면(상한액으로 낮췄거나 외화를 원화로 옮겼으면) 문서의 값을 쓰지 않고 정산금액에서 되셈한다', () => {
  const capped = lodgeRow(rec({ ...HOTEL, total: 132000, supply: 120000, vat: 12000 }), { ...CAP, settle: 'cap' });
  assert.deepEqual([capped.total, capped.samount, capped.vat, capped.vatFrom], [120000, 109091, 10909, 'calc']);
  const usd = lodgeRow(rec({ ...AGODA, totalKRW: 125052, supply: 80.42, vat: 8.04 }));
  assert.deepEqual([usd.samount, usd.vat, usd.vatFrom], [113684, 11368, 'calc'], '달러로 적힌 공급가액을 원화 칸에 넣지 않는다');
});

console.log('폼으로 나가는 칸');
t('숙박 줄은 업체명 아고다·화폐 KRW·정산금액·공급가액·부가세·비고(묵은 곳)로 나간다', () => {
  const plan = afterPlan([{ ...AGODA, totalKRW: 125052, file: { name: 'a.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' } }], { trip: TRIP, detail: { rows: [], transports: [] } });
  lodgeSettle(Object.assign(plan.lodge[0], CAP, { settle: 'cap' }));
  const fields = afterFields([['seq', '145580'], ['trseq', '157777']], plan);
  const get = (k) => fields.find(([n]) => n === k)[1];
  assert.deepEqual(['lodge_company', 'lodge_companycode', 'lodge_currency', 'lodge_total', 'lodge_samount', 'lodge_vat', 'lodge_comment', 'lodge_maxtotal', 'lodge_maxconv'].map(get),
    ['아고다', '', 'KRW', '120000', '109091', '10909', 'Toyoko INN Gangnam Seoul', '120000', '120000']);
  assert.equal(afterSummary(plan), '숙박 아고다 1박 120,000원(상한액)');
});

/* ------------------------------------------------------------ 가짜 eclass: 숙박 줄을 가진 사후정산 입력 화면 */

const page = (body) => new Response(`<html><body>${body}${' '.repeat(1600)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const site = { post: '대기', lodges: [], next: 81561, calls: [], saves: [], maxAsked: [], asks: [], record: null };
const LIST = () => `<div class="bt-topmenu"><span class="bt-user"> 김거화 (kimghw) / KOR | ENG </span></div><table id="mainList"><tbody>`
  + '<tr><td data-href="/BusinessTrip/CalPrint?seq=145580">145580</td><td>김거화</td><td data-href="/BusinessTrip/CalPrint?seq=145580&amp;trseq=157777"> </td>'
  + `<td><span>완료</span></td><td><span>${site.post}</span></td><td>2026-09-09~2026-09-10</td><td>서울</td><td>김거화</td><td>2026-09-01</td></tr>`
  + '</tbody></table><div class="bt-pager"><div>전체 1건 · 1/1 페이지</div></div>';
// 저장된 숙박 줄 — 실제 화면의 칸 차례 그대로다(국가 select 가 줄의 처음).
const LODGE_KEYS = ['paydate', 'sday', 'company', 'companycode', 'cocard', 'total', 'samount', 'vat', 'comment'];
const ROW = (r) => '<tr><td><select name="lodge_nation"><option value="KR||" selected="selected">대한민국</option><option value="US||">미국</option></select></td><td>'
  + `<input type="hidden" name="lodge_seq" value="${r.seq}" /><input type="hidden" name="lodge_del" value="0" /><input type="hidden" name="lodge_oldfile" value="" />`
  + '<input type="hidden" name="lodge_maxtotal" value="120000" /><input type="hidden" name="lodge_maxcur" value="KRW" /><input type="hidden" name="lodge_maxrate" value="1" />'
  + `<input type="hidden" name="lodge_maxconv" value="120000" /><input type="date" name="lodge_paydate" value="${r.paydate}" /></td>`
  + `<td><input type="text" name="lodge_sday" value="${r.sday}" /></td><td><input type="text" name="lodge_company" value="${r.company}" /></td>`
  + `<td><input type="text" name="lodge_companycode" value="${r.companycode}" /></td>`
  + `<td><select name="lodge_currency"><option value="KRW"${r.currency === 'KRW' ? ' selected="selected"' : ''}>원(KRW)</option><option value="USD"${r.currency === 'USD' ? ' selected="selected"' : ''}>달러(USD)</option></select></td>`
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
    site.asks.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(site.record) }] }) };
  }
  if (init.method === 'POST') {
    if (!u.endsWith('/BusinessTrip/AfterTrip/Save')) throw new Error('모르는 쓰기 주소 ' + u);
    const all = (k) => init.body.getAll(`lodge_${k}`);
    const sent = all('seq').map((seq, i) => ({ seq, del: all('del')[i], currency: all('currency')[i], ...Object.fromEntries(LODGE_KEYS.map((k) => [k, all(k)[i]])) }));
    site.saves.push(sent);
    site.calls.push(`after:${init.body.get('seq')}`);
    // 화면이 하듯: 지움 표시가 된 줄은 사라지고, 번호가 없는 줄은 새 번호를 받는다.
    site.lodges = sent.filter((r) => r.del !== '1').map((r) => (r.seq ? r : { ...r, seq: String(site.next++) }));
    site.post = '작성';
    return page('ok');
  }
  if (u.includes('/Api/CalMaxLodge')) {
    const q = new URL(u).searchParams;
    site.maxAsked.push(`${q.get('nationCD')}:${q.get('currency')}`);
    // 2026-10-03 실제 응답: 국내·원화면 1일 120,000원.
    return new Response('<?xml version="1.0"?><REQUEST><NODE MAXAMT="120000" CURRENCY="KRW" RATE="1" MAXAMT_CUR="120000"/></REQUEST>', { status: 200 });
  }
  if (u.includes('/Home/List')) return page(LIST());
  if (u.includes('/BusinessTrip/AfterTrip?')) return page(AFTER());
  throw new Error('모르는 주소 ' + u);
};

const { parseTripList, formFields } = await import('../src/travel.js');
const { tripAfterSave, tripLodgeMax } = await import('../src/trip.js');
const dom = (body) => new JSDOM(body).window.document;
const rowOf = () => parseTripList(dom(LIST())).find((r) => r.seq === '145580');
const HAND = { seq: '81558', paydate: '2026-09-08', sday: '1', company: 'Toyoko INN Gangnam Seoul', companycode: '', currency: 'KRW', cocard: '0', total: '125052', samount: '0', vat: '0', comment: '' };
const planOf = (record, over = {}) => {
  const plan = afterPlan([{ ...record, file: { name: 'a.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' } }], { trip: TRIP, detail: { rows: [], transports: [] } });
  lodgeSettle(Object.assign(plan.lodge[0], CAP, over));
  return plan;
};

console.log('사이트의 숙박 줄 읽기');
t('화면의 칸에서 숙박 줄을 줄마다 읽는다 — 줄 번호·결제일·업체명·화폐·정산금액', () => {
  site.lodges = [HAND, { ...HAND, seq: '81559', currency: 'USD', total: '88.46' }];
  const rows = lodgeRowsOf(formFields(dom(AFTER())));
  assert.deepEqual(rows.map((r) => [r.seq, r.del, r.nation, r.paydate, r.sday, r.company, r.currency, r.total, r.maxconv]), [
    ['81558', '0', 'KR||', '2026-09-08', '1', 'Toyoko INN Gangnam Seoul', 'KRW', '125052', '120000'],
    ['81559', '0', 'KR||', '2026-09-08', '1', 'Toyoko INN Gangnam Seoul', 'USD', '88.46', '120000'],
  ]);
  assert.deepEqual(lodgeRowsOf([['seq', '1'], ['tr_seq', '7']]), []);
});
t('같은 줄 — 결제일·업체명·숙박 일수·정산금액이 모두 같다. 지움 표시가 된 줄과 금액을 못 정한 줄은 같은 줄이 아니다', () => {
  const l = { paydate: '2026-09-08', company: '아고다', sday: 1, total: 120000 };
  const have = { del: '0', paydate: '2026-09-08', company: '아고다', sday: '1', total: '120000' };
  assert.equal(lodgeSame(l, have), true);
  assert.deepEqual([{ total: '125052' }, { company: 'Toyoko INN' }, { paydate: '2026-09-09' }, { sday: '2' }, { del: '1' }].map((o) => lodgeSame(l, { ...have, ...o })), Array(5).fill(false));
  assert.equal(lodgeSame({ ...l, total: null }, { ...have, total: '' }), false);
});
await ta('상한액은 사이트의 CalMaxLodge 에서 읽는다 — 1일 상한과 원화로 바꾼 값', async () => {
  assert.deepEqual(await tripLodgeMax('157777', 'KR||', 'KRW'), CAP);
  assert.deepEqual(site.maxAsked, ['KR||:KRW']);
});

console.log('올리기 — 새로 생긴 줄 번호를 돌려주고, 같은 줄은 다시 올리지 않는다');
await ta('있던 줄(손수 적은 것)은 그대로 다시 나가고 새 줄이 덧붙는다. 새 줄의 번호(lodgeSeqs)를 돌려준다', async () => {
  site.lodges = [HAND];
  const r = await tripAfterSave(rowOf(), '157777', planOf(rec({ ...AGODA, totalKRW: 125052 }), { settle: 'cap' }), { name: '김거화' });
  assert.deepEqual([r.sent, r.same, r.lodgeSeqs, r.stage.label], [true, [], ['81561'], '사후정산 작성']);
  assert.deepEqual(site.saves.at(-1).map((x) => [x.seq, x.del, x.company, x.currency, x.total, x.samount, x.vat, x.comment]), [
    ['81558', '0', 'Toyoko INN Gangnam Seoul', 'KRW', '125052', '0', '0', ''],
    ['', '0', '아고다', 'KRW', '120000', '109091', '10909', 'Toyoko INN Gangnam Seoul'],
  ]);
  assert.deepEqual([r.lodgeRows[0].company, r.lodgeRows[0].total], ['아고다', '120000']);
});
await ta('같은 증빙을 다시 넣어 같은 줄이 나오면 보내지 않는다(sent = false) — 줄이 겹쳐 올라가지 않는다', async () => {
  const n = site.saves.length;
  const plan = planOf(rec({ ...AGODA, totalKRW: 125052 }), { settle: 'cap' });
  const r = await tripAfterSave(rowOf(), '157777', plan, { name: '김거화' });
  assert.deepEqual([r.sent, r.same, r.lodgeSeqs, site.saves.length, site.lodges.length], [false, [plan.lodge[0]], [], n, 2]);
});
await ta('금액을 다르게 정했으면(실제 금액으로) 다른 줄이다 — 올라간다', async () => {
  const r = await tripAfterSave(rowOf(), '157777', planOf(rec({ ...AGODA, totalKRW: 125052 }), { settle: 'real' }), { name: '김거화' });
  assert.deepEqual([r.sent, r.lodgeSeqs, site.lodges.map((x) => x.total)], [true, ['81562'], ['125052', '120000', '125052']]);
});

/* ------------------------------------------------------------ 패널: 출장 카드에서 묻고 올린다 */

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
/** 사이트를 사전정산 완료·숙박 줄 없음으로 돌리고, 패널이 그 목록을 읽은 것처럼 앉힌 뒤 출장 줄을 편다. */
async function open(lodges = []) {
  Object.assign(site, { post: '대기', lodges, next: 81561 });
  site.calls.length = 0;
  site.saves.length = 0;
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(st, {
    view: 'all', items: [NIGHT], all: [NIGHT], loadedOnce: true, openDoc: 'TR-1', workplace: '부산', lodgeMine: {}, lodgeInfo: {}, lodgeOpen: {},
    trips: { rows: parseTripList(dom(LIST())), me: '김거화' },
    after: { 145580: { detail: { rows: [KTX('2026-09-09', '부산', '서울'), KTX('2026-09-10', '서울', '부산')], transports: ['Train', 'Train'] } } },
  });
  await panel.reload();   // HR 에는 닿지 못한다 — 앉혀 둔 신청 내역이 그대로 그려진다
}
const card = () => doc.querySelector('#atList li.open');
const status = () => doc.getElementById('atStatus').textContent;
const drop = async (name, record, body = 'x') => {
  site.record = rec(record);
  const input = card().querySelector('.at-after-drop input[type="file"]');
  const asked = site.asks.length;
  Object.defineProperty(input, 'files', { configurable: true, value: [new window.File([body], name, { type: 'image/png' })] });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await until(() => site.asks.length > asked && !st.after[145580].busy, `${name} 을 읽기`);
};
const ask = () => card().querySelector('.at-after-ask');
const press = async (act) => {
  card().querySelector(`.at-after-ask button[data-act="${act}"]`).click();
  await until(() => !st.after[145580].busy, `${act} 뒤`);
  await wait(30);
};
const chip = (lodgeSeq) => card().querySelector(`.at-lodges button[data-act="lodge-info"][data-lodge="${lodgeSeq}"]`);
const info = () => card().querySelector('.at-lodges .at-lodge-info');
const cellsOf = (root) => [...root.querySelectorAll('.at-lodged')].map((box) => ({
  head: box.querySelector('.at-after-label').textContent,
  ...Object.fromEntries([...box.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent])),
}));
const lodgeCells = () => [...card().querySelectorAll('.at-after-result .at-lodged')].map((box) => ({
  head: box.querySelector('.at-after-label').textContent,
  ...Object.fromEntries([...box.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent])),
}));

console.log('출장 카드 — 외화 문서: 원화 금액을 묻고, 상한액을 넘으면 어느 금액으로 정산할지 묻는다');
await open();
await drop('image.png', AGODA);
t('아고다 달러 예약서를 넣으면 올리지 않고 원화로 결제된 금액을 묻는다 — 증빙은 보관해 둔다', () => {
  assert.deepEqual(site.calls, []);
  assert.match(ask().textContent, /아직 올리지 않았습니다/);
  assert.match(ask().querySelector(':scope > ul p').textContent, /^Toyoko INN Gangnam Seoul 1박 — 문서의 금액이 88\.46 USD 입니다\. 정산금액은 원화로 적습니다\. 원화로 결제된 금액\(카드 청구 금액\)을 적어 주세요\.$/);
  assert.ok(ask().querySelector('input.at-ask-krw'));
  assert.equal(status(), '사후정산을 아직 올리지 않았습니다 — 출장 카드에서 정산금액을 정해 주세요');
  assert.equal(card().querySelector('.at-after-result.saved'), null);
  assert.equal(shelf.size, 1, '읽은 증빙은 보관함에 있다');
});
t('읽은 증빙과 올릴 줄은 이름표로 갈라 적는다 — 올릴 숙박 줄의 업체명은 아고다이고 정산금액은 아직 정하지 않았다', () => {
  assert.deepEqual([...card().querySelectorAll('.at-after-result > .at-after-label')].map((p) => p.textContent), ['읽은 증빙 1장']);
  assert.deepEqual([...card().querySelectorAll('.at-after-docs li')].map((li) => li.textContent), ['숙박 증빙 · image.png — Toyoko INN Gangnam Seoul 1박 예약 확인서 USD 88.46']);
  const [l] = lodgeCells();
  assert.deepEqual([l.head, l['업체명'], l['사업자등록번호'], l['결제일'], l['숙박 일수'], l['정산금액'], l['비고'], l['증빙']],
    ['올릴 숙박 줄 — 아직 올리지 않았습니다', '아고다', '문서에 없음', '2026-09-08', '1박', '정하지 않음 — 문서의 금액 88.46 USD', 'Toyoko INN Gangnam Seoul', 'image.png']);
});
await ta('숫자가 아닌 것을 적으면 받지 않는다', async () => {
  ask().querySelector('input.at-ask-krw').value = '약 12만원';
  await press('ask-krw');
  assert.deepEqual([site.calls, status()], [[], '원화로 결제된 금액을 숫자로 적어 주세요.']);
});
await ta('원화 금액을 적으면(쉼표가 있어도) 그것이 실제 금액이다 — 상한액(1일 120,000원)을 넘으니 어느 금액으로 정산할지 묻는다', async () => {
  const input = ask().querySelector('input.at-ask-krw');
  input.value = '125,052';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(st.after[145580].ask.krw[0], '125,052', '다시 그려도 적던 글이 남는다');
  await press('ask-krw');
  assert.deepEqual(site.calls, []);
  assert.equal(ask().querySelector(':scope > ul p').textContent, 'Toyoko INN Gangnam Seoul 1박 — 실제 금액 125,052원이 상한액 120,000원(1일 120,000원 × 1박)을 넘습니다. 정산금액을 어느 쪽으로 올릴까요?');
  // 실제 금액이 상한액의 1.5배(180,000원) 안이라 부서장 승인으로 정산할 수 있다 — 버튼과 그 아래에 그렇게 적힌다(2026-10-05 사용자 지정).
  assert.deepEqual([...ask().querySelectorAll('.at-ask-row button')].map((b) => b.textContent), ['상한액 120,000원으로', '실제 금액 125,052원으로 · 부서장 승인']);
  assert.deepEqual([...ask().querySelectorAll(':scope > ul li > .at-after-note')].map((p) => p.textContent), ['상한액의 1.5배(180,000원) 이내라 부서장 승인을 받아 실제 금액으로 정산할 수 있습니다']);
  // 실제 금액으로 정산하면 비고에 상한 초과 사유가 필수다(2026-10-08 사용자 지정) — 기본 문구가 든 칸이 서고 고쳐 쓸 수 있다.
  const reason = ask().querySelector('input.at-ask-reason');
  assert.deepEqual([reason.value, reason.placeholder, ask().querySelector('.at-ask-reason-label').textContent],
    [LODGE_OVER_REASON, LODGE_OVER_REASON, '비고의 상한 초과 사유 — 실제 금액으로 정산하면 필수입니다(고쳐 쓸 수 있습니다)']);
  const [l] = lodgeCells();
  assert.deepEqual([l['정산금액'], l['공급가액'], l['부가세']], ['정하지 않음 — 실제 125,052원이 상한액 120,000원을 넘습니다 · 문서의 금액 88.46 USD', '?', '?'], '고르기 전에는 정산금액이 정해진 것처럼 적지 않는다');
  assert.equal(status(), '사후정산을 아직 올리지 않았습니다 — 출장 카드에서 정산금액을 정해 주세요', '앞의 잘못 적었다는 말이 남아 있지 않다');
});
await press('ask-cap');
await until(() => site.calls.length === 1, '사후정산 저장');
t('상한액으로 고르면 올라간다 — 업체명 아고다, 화폐 원, 정산금액 120,000, 공급가액·부가세는 정산금액에서 역산, 비고에 묵은 곳', () => {
  assert.deepEqual(site.saves[0].map((x) => [x.seq, x.paydate, x.sday, x.company, x.companycode, x.currency, x.total, x.samount, x.vat, x.comment]),
    [['', '2026-09-08', '1', '아고다', '', 'KRW', '120000', '109091', '10909', 'Toyoko INN Gangnam Seoul']]);
  assert.equal(status(), '사후정산을 올렸습니다 — 숙박 아고다 1박 120,000원(상한액)');
  assert.equal(ask(), null);
});
t('올린 뒤 카드에는 올렸다는 말만 남는다 — 올린 내용은 펴 두지 않고, 숙박비 내역의 그 줄에 증빙 표시가 선다', () => {
  assert.match(card().querySelector('.at-after-result.saved .at-after-note.ok').textContent, /^올렸습니다 — 사후정산 작성$/);
  assert.equal(card().querySelector('.at-lodged-hint').textContent, '숙박 줄 1개를 올렸습니다 — 위 숙박비 내역에서 그 줄의 ‘증빙’을 누르면 올린 내용이 보입니다');
  assert.deepEqual([lodgeCells(), card().querySelector('.at-after-result .at-after-docs'), card().querySelector('.at-after-result .at-after-notes'), info()], [[], null, null, null]);
  assert.deepEqual([chip('81561').textContent, chip('81561').getAttribute('aria-expanded'), chip('81561').title],
    ['증빙', 'false', '이 패널에서 증빙(image.png)으로 올린 줄입니다 · 누르면 내용이 보입니다']);
});
t('숙박비 내역에서 그 줄의 증빙을 누르면 그 줄 아래에 올린 내용이 펴진다 — 읽은 증빙, 사이트의 칸 이름대로의 값(상한액으로 정산·역산), 그 줄의 알림. 다시 누르면 접힌다', () => {
  chip('81561').click();
  assert.equal(chip('81561').getAttribute('aria-expanded'), 'true');
  assert.equal(info().previousElementSibling.dataset.lodge, '81561', '그 줄 바로 아래다');
  assert.deepEqual([...info().querySelectorAll('.at-after-docs li')].map((li) => li.textContent), ['숙박 증빙 · image.png — Toyoko INN Gangnam Seoul 1박 예약 확인서 USD 88.46']);
  assert.deepEqual([...info().querySelectorAll('.at-after-notes li')].map((li) => li.textContent), ['Toyoko INN Gangnam Seoul은 예약서만 있고 결제 영수증이 없습니다 — 금액은 예약 금액입니다']);
  assert.equal(site.calls.length, 1, '펴는 것은 사이트에 아무것도 보내지 않는다');
  const [l] = cellsOf(info());
  chip('81561').click();
  assert.deepEqual([info(), chip('81561').getAttribute('aria-expanded')], [null, 'false']);
  assert.deepEqual(l, {
    head: '올린 숙박 줄 (줄 번호 81561)', 업체명: '아고다', 사업자등록번호: '문서에 없음', 결제일: '2026-09-08', '숙박 일수': '1박',
    정산금액: '120,000원 · 상한액으로 정산(실제 125,052원) · 문서의 금액 88.46 USD', 공급가액: '109,091원 (정산금액에서 역산)', 부가세: '10,909원 (정산금액에서 역산)',
    상한액: '120,000원 (1일 120,000원 × 1박)', 비고: 'Toyoko INN Gangnam Seoul', 증빙: 'image.png',
  });
});
t('이 패널이 올린 줄의 번호를 적어 둔다 — 저장소에도 남는다(손수 적은 줄과 가린다)', () => {
  assert.deepEqual(st.lodgeMine, { 145580: { 81561: 'image.png' } });
  assert.deepEqual(store.attendLodgeMine, { 145580: { 81561: 'image.png' } });
  // 올린 내용도 글로 적어 둔다 — 패널을 다시 열어도 증빙을 누르면 그대로 보인다.
  const kept = store.attendLodgeInfo[145580][81561];
  assert.deepEqual([kept.row, kept.cells.find(([k]) => k === '정산금액')[1], kept.docs.length, kept.notes.length],
    [{ paydate: '2026-09-08', company: '아고다', sday: 1, total: 120000 }, '120,000원 · 상한액으로 정산(실제 125,052원) · 문서의 금액 88.46 USD', 1, 1]);
  assert.ok(logs.some((l) => l.kind === 'trip' && l.ok && /여비계산서\(사후정산\) 작성: 145580 · 숙박 아고다 1박 120,000원\(상한액\)/.test(l.text) && l.extra.lodgeSeqs[0] === '81561'));
});

console.log('같은 증빙을 다시 넣으면 줄이 겹쳐 올라가지 않는다');
await drop('image.png', { ...AGODA, totalKRW: 125052 });
await until(() => /이미 있어 다시 올리지 않았습니다/.test(status()), '같은 줄 알아보기');
// 2026-10-05 사용자 지정("이게 확인이 안되나? 출장이랑 맞잖아"): 이미 올라가 있는 줄이면 상한액을 넘어도 다시 묻지 않는다.
t('같은 줄이 이미 있으면 다시 올리지 않고 그렇게 말한다 — 어느 금액으로 올릴지도 다시 묻지 않는다', () => {
  assert.equal(card().querySelector('.at-after-ask'), null, '묻지 않는다');
  assert.deepEqual([site.calls.length, site.lodges.length], [1, 1]);
  assert.equal(status(), '같은 숙박 줄이 사후정산에 이미 있어 다시 올리지 않았습니다');
  assert.equal(card().querySelector('.at-lodged-same').textContent, '같은 숙박 줄이 이미 있어 다시 올리지 않았습니다 — 아고다 · 2026-09-08 · 1박 · 120,000원');
  assert.deepEqual(lodgeCells(), [], '표로 펴 적지 않는다 — 그 줄의 내용은 숙박비 내역에 있다');
  assert.equal(card().querySelector('.at-after-result.saved'), null);
});

console.log('실제 금액으로 정산 · 올리지 않기 · 묻지 않는 경우');
await open();
await drop('image.png', { ...AGODA, totalKRW: 125052 });
await ta('문서에 원화 금액이 있으면 원화는 묻지 않고 상한액만 묻는다 — 실제 금액으로 고르면 그 금액으로 올라가고, 비고에 묵은 곳 뒤로 상한 초과 사유(기본 문구)가 붙는다', async () => {
  assert.equal(ask().querySelector('input.at-ask-krw'), null);
  assert.equal(ask().querySelector('input.at-ask-reason').value, LODGE_OVER_REASON);
  await press('ask-real');
  await until(() => site.calls.length === 1, '사후정산 저장');
  assert.deepEqual(site.saves[0].map((x) => [x.company, x.total, x.samount, x.vat, x.comment]), [['아고다', '125052', '113684', '11368', `Toyoko INN Gangnam Seoul · ${LODGE_OVER_REASON}`]]);
  chip('81561').click();
  assert.equal(cellsOf(info())[0]['정산금액'], '125,052원 · 실제 금액으로 정산(상한액 120,000원 초과 · 부서장 승인 필요) · 문서의 금액 88.46 USD');
  assert.equal(cellsOf(info())[0]['비고'], `Toyoko INN Gangnam Seoul · ${LODGE_OVER_REASON} (상한 초과 사유 포함)`);
  assert.ok([...info().querySelectorAll('.at-after-notes li')].some((li) => li.textContent === 'Toyoko INN Gangnam Seoul: 부서장 승인 필요 — 상한액의 1.5배(180,000원) 이내'),
    '실제 금액으로 정산한 줄에는 승인이 필요하다는 알림이 남는다');
  assert.equal(store.attendLodgeActual[145580][81561].reason, LODGE_OVER_REASON, '비고에 적은 사유를 적어 둔다 — 숙박비 내역의 상한 버튼이 쓴다');
  // 숙박비 내역의 펴진 줄에도 사유를 고쳐 쓰는 칸이 선다(정산금액이 상한액을 넘는 줄).
  assert.equal(info().querySelector('.at-lodge-reason input.at-lodge-reason-input').value, LODGE_OVER_REASON);
});
await open();
await drop('image.png', { ...AGODA, totalKRW: 125052 });
await ta('사유 칸을 고쳐 쓰고 실제 금액으로 고르면 그 글이 비고에 들어간다 — 적던 글은 카드를 다시 그려도 남는다', async () => {
  const input = ask().querySelector('input.at-ask-reason');
  input.value = '행사 기간이라 인근 숙소가 다 찼음';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(st.after[145580].ask.reason[0], '행사 기간이라 인근 숙소가 다 찼음');
  await press('ask-real');
  await until(() => site.calls.length === 1, '사후정산 저장');
  assert.deepEqual(site.saves[0].map((x) => [x.total, x.comment]), [['125052', 'Toyoko INN Gangnam Seoul · 행사 기간이라 인근 숙소가 다 찼음']]);
  assert.equal(store.attendLodgeActual[145580][81561].reason, '행사 기간이라 인근 숙소가 다 찼음');
  chip('81561').click();
  assert.equal(cellsOf(info())[0]['비고'], 'Toyoko INN Gangnam Seoul · 행사 기간이라 인근 숙소가 다 찼음 (상한 초과 사유 포함)');
});
await open();
await drop('image.png', { ...AGODA, totalKRW: 125052 });
await ta('사유 칸을 비우고 실제 금액으로 고르면 기본 문구가 들어간다(사유는 필수다) — 상한액으로 고르면 사유를 적지 않는다(앞의 상한액 시험)', async () => {
  ask().querySelector('input.at-ask-reason').value = '   ';
  await press('ask-real');
  await until(() => site.calls.length === 1, '사후정산 저장');
  assert.equal(site.saves[0][0].comment, `Toyoko INN Gangnam Seoul · ${LODGE_OVER_REASON}`);
});
await open();
await drop('image.png', AGODA);
await ta('올리지 않기를 누르면 아무것도 보내지 않는다', async () => {
  await press('ask-drop');
  assert.deepEqual([site.calls, ask(), card().querySelector('.at-after-result')], [[], null, null]);
  assert.equal(status(), '사후정산을 올리지 않았습니다 — 읽은 증빙은 보관함에 있습니다');
});
await open();
await drop('호텔.png', HOTEL);
await until(() => site.calls.length === 1, '사후정산 저장');
t('원화 문서이고 상한액 안이면 묻지 않고 바로 올린다 — 문서에 적힌 공급가액·부가세 그대로', () => {
  assert.deepEqual(site.saves[0].map((x) => [x.company, x.companycode, x.currency, x.total, x.samount, x.vat, x.comment]), [['킨텍스호텔', '128-81-00000', 'KRW', '110000', '100000', '10000', '']]);
  assert.deepEqual(site.maxAsked.at(-1), 'KR||:KRW');
  chip('81561').click();
  const [l] = cellsOf(info());
  assert.deepEqual([l.head, l['정산금액'], l['공급가액'], l['부가세']], ['올린 숙박 줄 (줄 번호 81561)', '110,000원', '100,000원', '10,000원']);
});
await open();
await drop('image.png', AGODA);
await drop('호텔.png', HOTEL);
t('물어 둔 채 다른 증빙을 넣어도 앞의 숙박 증빙이 사라지지 않는다 — 같이 묶어 다시 묻는다', () => {
  assert.deepEqual(site.calls, []);
  assert.deepEqual(lodgeCells().map((l) => l['업체명']).sort(), ['아고다', '킨텍스호텔']);
  assert.equal(ask().querySelectorAll(':scope > ul > li').length, 1, '물을 것은 아고다 줄의 원화 금액 하나다');
});

// 2026-10-03 실제로 있던 일: 출장 카드를 찍은 화면이 패널에 붙여 넣어져(이름이 예약서와 같은 image.png) 숙박 증빙으로 읽히고
// 숙박 줄이 하나 더 올라갔으며, 보관함의 예약서가 그 화면으로 바뀌었다.
console.log('증빙이 아닌 화면 · 같은 이름의 다른 그림');
shelf.clear();
await open();
await drop('image.png', HOTEL);
await until(() => site.calls.length === 1, '사후정산 저장');
await drop('image.png', { docType: 'unknown', summary: '출장 카드를 찍은 화면 — 원본 증빙이 아님' }, '다른 그림');
await ta('증빙이 아닌 화면(읽기가 unknown 으로 가린 것)은 올리지도 보관하지도 않는다 — 같은 이름이어도 내용이 다르면 번호가 붙어, 보관해 둔 증빙을 덮어쓰지 않는다', async () => {
  assert.equal(site.calls.length, 1, '줄이 더 올라가지 않았다');
  assert.deepEqual([...card().querySelectorAll('.at-after-docs li')].map((li) => li.textContent),
    ['모르는 문서 ✗ · image (2).png — 무슨 문서인지 읽지 못했습니다(출장 카드를 찍은 화면 — 원본 증빙이 아님)']);
  const kept = await evidence.list('TR-1');
  assert.deepEqual(kept.map((k) => [k.label, k.name, k.summary]), [['숙박 증빙', 'image.png', '킨텍스호텔 1박 110,000원']]);
});
await drop('image.png', { ...HOTEL, vendor: '다른호텔', total: 99000, supply: 90000, vat: 9000, summary: '다른호텔 1박 99,000원' }, '또 다른 그림');
await until(() => site.calls.length === 2, '두 번째 저장');
await ta('같은 이름의 다른 증빙은 둘 다 보관된다', async () => {
  assert.deepEqual((await evidence.list('TR-1')).map((k) => k.name).sort(), ['image (2).png', 'image.png']);
  assert.deepEqual(st.lodgeMine[145580], { 81561: 'image.png', 81562: 'image (2).png' });
});

console.log('숙박비 내역의 표시를 누르면 — 손수 작성한 줄·올린 뒤 고쳐진 줄은 화면에 지금 있는 값을 보인다');
await open([HAND]);
card().querySelector('button[data-act="lodge-refresh"]').click();   // 앞 장면에서 읽어 둔 줄이 남아 있다 — 다시 읽는다
await until(() => chip('81558'), '숙박비 내역 읽기');
t('손수 작성한 줄의 표시를 누르면 사후정산 화면에 지금 있는 값이 펴진다', () => {
  assert.equal(chip('81558').textContent, '손수 작성');
  chip('81558').click();
  assert.deepEqual(cellsOf(info()), [{
    head: '손수 작성한 줄 — 사후정산 화면에 지금 있는 값 (줄 번호 81558)', 업체명: 'Toyoko INN Gangnam Seoul', 사업자등록번호: '없음', 결제일: '2026-09-08',
    '숙박 일수': '1박', 정산금액: '125,052원', 공급가액: '0원', 부가세: '0원',
  }]);
});
await drop('호텔.png', HOTEL);
await until(() => site.calls.length === 1 && chip('81561'), '사후정산 저장');
await ta('올린 줄이 사후정산 화면에서 고쳐졌으면 적어 둔 내용이 아니라 화면의 값을 보이고 그렇게 말한다', async () => {
  chip('81561').click();
  assert.equal(cellsOf(info())[0].head, '올린 숙박 줄 (줄 번호 81561)');
  site.lodges = site.lodges.map((r) => (r.seq === '81561' ? { ...r, total: '99000' } : r));   // 화면에서 손으로 고쳤다
  card().querySelector('button[data-act="lodge-refresh"]').click();
  await until(() => cellsOf(info())[0]?.['정산금액'] === '99,000원', '숙박비 내역 다시 읽기');
  assert.deepEqual([cellsOf(info())[0].head, cellsOf(info())[0]['증빙']], ['올린 뒤 사후정산 화면에서 고쳐진 줄 — 화면에 지금 있는 값 (줄 번호 81561)', '호텔.png']);
});
await ta('줄을 지우면 적어 둔 내용도 버린다', async () => {
  const del = () => card().querySelector('.at-lodge[data-lodge="81561"] button[data-act="lodge-del"]');
  del().click();
  del().click();
  await until(() => !chip('81561'), '숙박 줄 지우기');
  await wait(30);
  assert.deepEqual([store.attendLodgeInfo[145580], st.lodgeInfo[145580], st.lodgeOpen[145580], info()], [{}, {}, '', null]);
  assert.deepEqual(site.lodges.map((r) => r.seq), ['81558'], '그 줄만 지워졌다');
});

console.log('신청서의 버튼은 여비계산서 칸보다 위에 선다');
NIGHT.actions = ['change', 'cancel'];
await open();
t('변경·취소신청은 여비계산서 줄·사후정산 칸·여비증빙 송부 칸보다 위에 있다 — 맨 아래에 있으면 정산에 딸린 버튼으로 읽힌다', () => {
  assert.deepEqual([...card().querySelector('.at-more-box').children].map((n) => n.className.split(' ')[0]), ['at-acts', 'at-tripline', 'at-after', 'at-send']);
  assert.deepEqual([...card().querySelectorAll('.at-acts button')].map((b) => b.textContent), ['근태 변경', '취소신청']);
});
NIGHT.actions = [];

const { TASKS, systemPrompt } = await import('../src/input.js');
t('읽기 명세 — 구매처·사업자명·원화 금액 칸이 있고, 정산 화면을 찍은 것은 증빙이 아니라고 말한다', () => {
  const f = TASKS.receipt.fields;
  assert.deepEqual([f.seller.type, f.sellerBiz.type, f.totalKRW.type], ['string', 'string', 'number']);
  const system = systemPrompt('receipt');
  assert.match(system, /Agoda → 아고다/);
  assert.match(system, /환율로 셈하지 않습니다/);
  assert.match(system, /출장 카드 화면.*은 증빙이 아닙니다/);
});

console.log(`\n통과 ${pass}건`);
process.exit(0);
