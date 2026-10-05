// 사후정산(src/after.js) — 증빙 기록을 숙박비·교통비·항공 마일리지로 묶고, 조건(비행기 또는 1박)과 필수 값을 가린다.
// 교통비는 가는 편·오는 편에서 나온다: 처음에는 사전정산대로, 표를 넣거나 카드에서 고르면 그 편이 바뀐다.
// DOM·네트워크 없이 돈다. 폼 칸 이름(lodge_*, tr_*, air_*)은 2026-10-03 실제 사후정산 입력 화면 소스와 같다.
import assert from 'node:assert/strict';
import { afterNeed, afterPlan, afterSummary, afterFields, nightsBetween, evidenceOf, periodMiss, needsAfter, AFTER_TRANSPORT, PRE_PLANE } from '../src/after.js';
import { lodgeAsk, lodgeSettle, lodgeOver, lodgeChoices, lodgeApproval, lodgeDecide } from '../src/after.js';
import { TRAVEL_RULES } from '../src/travelspec.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const TRIP = { seq: '145580', from: '2026-09-09', to: '2026-09-10', location: '고양', travelers: [{ name: '김거화', post: '대기', trseq: '157777' }] };
const DAY = { ...TRIP, to: '2026-09-09' };
const rec = (over) => ({
  docType: 'unknown', vendor: null, bizNo: null, payDate: null, checkIn: null, checkOut: null, nights: null, total: null, supply: null, vat: null,
  payPlace: null, atDestination: null,
  currency: null, corporateCard: null, airline: null, flightNo: null, flightDate: null, depPlace: null, arrPlace: null, depTime: null, arrTime: null,
  seatClass: null, retDate: null, retDepPlace: null, retArrPlace: null, retDepTime: null, retFlightNo: null, mileage: null, passenger: null, extra: null, summary: '문서', ...over,
});
const PNG = { name: '영수증.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' };
// 사전정산의 교통편 줄(실제 145580 처럼 KTX 부산↔서울 두 줄). detail 은 src/trip.js tripPreDetail 이 주는 모양이다.
const KTX = (date, dep, arr) => ({ seq: '1', trseq: '7380', revno: '', date, dep, arr, transport: 'Train', grade: '일반석', total: 53700, currency: 'KRW' });
const TRAIN = { rows: [KTX('2026-09-09', '부산', '서울'), KTX('2026-09-10', '서울', '부산')], transports: ['Train', 'Train'] };
const NONE = { rows: [], transports: [] };
const trans = (p) => p.trans.map((x) => [x.date, x.dep, x.arr, x.transport, x.grade, x.total]);

console.log('사후정산 조건 — 비행기를 탔거나 1박 이상');
t('1박이면 숙박, 사전정산 교통편에 비행기가 있으면 교통. 당일이고 기차면 대상이 아니다', () => {
  assert.equal(nightsBetween('2026-09-09', '2026-09-10'), 1);
  assert.equal(nightsBetween('2026-09-09', '2026-09-09'), 0);
  const a = afterNeed(TRIP, { transports: ['Train', 'Train'] });
  assert.deepEqual([a.nights, a.plane, a.lodging, a.transport, a.needed, a.why, a.hint], [1, false, true, false, true, '1박', '숙박 영수증·예약서·항공권']);
  const b = afterNeed(DAY, { transports: [PRE_PLANE, PRE_PLANE] });
  assert.deepEqual([b.lodging, b.transport, b.needed, b.why, b.hint], [false, true, true, '당일 · 비행기', '항공권']);
  const c = afterNeed(DAY, { transports: ['Train'] });
  assert.deepEqual([c.needed, c.why], [false, '당일']);
  assert.deepEqual(afterNeed(TRIP, {}).needed, true, '교통편을 못 읽어도 1박이면 대상이다');
});
t('카드에서 가는 편·오는 편에 비행기를 골랐으면 사전정산이 기차여도 비행기를 탄 것이다', () => {
  const a = afterNeed(DAY, { transports: ['Train', 'Train'] }, { back: { t: 'plane', g: 'standard' } });
  assert.deepEqual([a.plane, a.needed, a.why], [true, true, '당일 · 비행기']);
  assert.equal(afterNeed(DAY, { transports: ['Train'] }, { back: { t: 'train', g: 'first' } }).needed, false, '기차 특실로 바꾼 것은 비행기가 아니다');
});
t('증빙은 무엇의 증명인지 가른다 — 항공권은 항공기 증명, 숙박은 숙박 증빙. 기차표·버스표는 증빙으로 받지 않는다(KTX 는 정가)', () => {
  assert.deepEqual(evidenceOf(rec({ docType: 'flight_ticket' }), DAY), { label: '항공기 증명', ok: true, note: '', warn: '' });
  assert.deepEqual(evidenceOf(rec({ docType: 'flight_receipt' }), TRIP), { label: '항공기 증명', ok: true, note: '', warn: '' });
  assert.deepEqual(evidenceOf(rec({ docType: 'lodging_receipt' }), TRIP), { label: '숙박 증빙', ok: true, note: '', warn: '' });
  assert.deepEqual(['train_ticket', 'bus_ticket'].map((docType) => evidenceOf(rec({ docType }), DAY)),
    Array(2).fill({ label: '기차·버스표', ok: false, note: '증빙으로 받지 않습니다(KTX 는 운임표의 정가로 넣습니다)', warn: '' }));
  assert.deepEqual(evidenceOf(rec({ docType: 'unknown', summary: '메모' }), DAY), { label: '모르는 문서', ok: false, note: '무슨 문서인지 읽지 못했습니다(메모)', warn: '' });
});
t('당일 출장의 증빙은 그 출장지에서, 출장일에 결제한 영수증이다 — 다른 곳의 영수증이나 어디서 결제했는지 모르는 영수증은 쓸 수 없다', () => {
  const lunch = rec({ docType: 'other_receipt', vendor: '○○식당', payDate: '2026-09-09', payPlace: '경기 고양시 일산서구', atDestination: true, total: 12000 });
  assert.deepEqual(evidenceOf(lunch, DAY), { label: '당일출장 증명', ok: true, note: '', warn: '' });
  assert.deepEqual(evidenceOf({ ...lunch, atDestination: false, payPlace: '부산 해운대구' }, DAY),
    { label: '당일출장 증명', ok: false, note: '출장지에서 결제한 영수증이 아닙니다(부산 해운대구)', warn: '' });
  assert.deepEqual(evidenceOf({ ...lunch, atDestination: null }, DAY), { label: '당일출장 증명', ok: false, note: '출장지에서 결제한 것인지 영수증에서 확인하지 못했습니다', warn: '' });
  assert.deepEqual(evidenceOf({ ...lunch, payDate: null }, DAY), { label: '당일출장 증명', ok: false, note: '결제일을 읽지 못했습니다', warn: '' });
  assert.deepEqual(evidenceOf({ ...lunch, payDate: '2026-09-10' }, TRIP), { label: '출장지 영수증', ok: true, note: '', warn: '' }, '1박 이상이면 출장 기간 안의 날이면 된다');
});
// 2026-10-05 사용자 지정: "출장 기간동안의 내용이 아니면 알림을 줘 안맞다고, 맞는것만 선별취급 해서 올리고 해당 없는거는 문서보관에 알림표지 하고
// 확정 해주기 전까지는 보내기 해도 같이 보내지 말고"
t('출장 기간의 것이 아닌 문서는 그 까닭을 알린다(warn) — 숙박은 묵은 기간, 항공권은 탑승일, 그 밖의 영수증은 결제일로 본다. 날짜를 모르면 안 맞다고 하지 않는다', () => {
  const lunch = rec({ docType: 'other_receipt', payDate: '2026-09-08', atDestination: true });
  const miss = '결제일(9/8)이 출장 기간(9/9) 밖입니다';
  assert.deepEqual(evidenceOf(lunch, DAY), { label: '당일출장 증명', ok: false, note: miss, warn: miss });
  assert.equal(evidenceOf({ ...lunch, atDestination: false }, DAY).warn, '', '출장지에서 결제한 것이 아니면 기간을 따지기 전에 못 쓰는 문서다');
  assert.equal(periodMiss(lunch, TRIP), '결제일(9/8)이 출장 기간(9/9~9/10) 밖입니다');
  // 숙박 — 결제일(미리 결제한다)이 아니라 묵은 기간을 본다
  const hotel = rec({ docType: 'lodging_receipt', payDate: '2026-09-07', checkIn: '2026-09-09', checkOut: '2026-09-10' });
  assert.equal(periodMiss(hotel, TRIP), '', '미리 결제한 영수증은 묵은 날이 출장 기간이면 맞다');
  assert.equal(periodMiss({ ...hotel, checkIn: '2026-09-15', checkOut: '2026-09-16' }, TRIP), '묵은 기간(9/15~9/16)이 출장 기간(9/9~9/10) 밖입니다');
  assert.equal(periodMiss({ ...hotel, checkIn: '2026-09-08' }, TRIP), '묵은 기간(9/8~9/10)이 출장 기간(9/9~9/10) 밖입니다', '하루라도 벗어나면 알린다');
  assert.equal(periodMiss({ ...hotel, checkIn: null, checkOut: null, payDate: '2026-08-01' }, TRIP), '', '묵은 날을 못 읽었으면 모르는 것이다');
  assert.deepEqual(evidenceOf({ ...hotel, checkIn: '2026-09-15', checkOut: '2026-09-16' }, TRIP),
    { label: '숙박 증빙', ok: false, note: '묵은 기간(9/15~9/16)이 출장 기간(9/9~9/10) 밖입니다', warn: '묵은 기간(9/15~9/16)이 출장 기간(9/9~9/10) 밖입니다' });
  // 항공권 — 탑승일, 왕복이면 돌아오는 날도
  const ticket = rec({ docType: 'flight_ticket', flightDate: '2026-09-09', retDate: '2026-09-10' });
  assert.equal(periodMiss(ticket, TRIP), '');
  assert.equal(periodMiss({ ...ticket, retDate: '2026-09-12' }, TRIP), '탑승일(9/12)이 출장 기간(9/9~9/10) 밖입니다');
  assert.equal(periodMiss({ ...ticket, flightDate: '2026-10-01', retDate: null }, TRIP), '탑승일(10/1)이 출장 기간(9/9~9/10) 밖입니다');
  assert.equal(periodMiss({ ...ticket, flightDate: null, retDate: null }, TRIP), '');
  // 사람이 이 출장의 증빙이 맞다고 확정한 기록은 맞는 것으로 친다
  assert.deepEqual(evidenceOf({ ...lunch, confirmed: true }, DAY), { label: '당일출장 증명', ok: true, note: '', warn: '' });
  assert.equal(periodMiss({ ...ticket, flightDate: '2026-10-01', confirmed: true }, TRIP), '');
  assert.deepEqual([needsAfter(hotel), needsAfter(ticket), needsAfter(lunch)], [true, true, false]);
});
t('묶을 때 출장 기간의 것이 아닌 숙박 증빙·항공권은 뺀다 — 맞는 것만 올리고, 뺀 것은 왜 뺐는지 적는다. 확정한 것은 같이 묶는다', () => {
  const ok = rec({ docType: 'lodging_receipt', vendor: '고양호텔', payDate: '2026-09-10', checkIn: '2026-09-09', checkOut: '2026-09-10', total: 110000, currency: 'KRW', file: PNG });
  const far = rec({ docType: 'lodging_receipt', vendor: '제주호텔', payDate: '2026-09-21', checkIn: '2026-09-20', checkOut: '2026-09-21', total: 90000, currency: 'KRW', file: { ...PNG, name: '제주.png' } });
  const late = rec({ docType: 'flight_ticket', airline: '대한항공', flightDate: '2026-09-20', depPlace: '김해', arrPlace: '김포', total: 89000, file: { ...PNG, name: '늦은편.pdf' } });
  const plan = afterPlan([ok, far, late], { trip: TRIP, detail: TRAIN });
  assert.deepEqual([plan.lodge.map((l) => l.company), plan.trans, plan.air, plan.problems], [['고양호텔'], [], null, []]);
  assert.deepEqual(plan.skipped, [
    '제주.png: 숙박 증빙 — 묵은 기간(9/20~9/21)이 출장 기간(9/9~9/10) 밖입니다 · 사후정산에 넣지 않았습니다',
    '늦은편.pdf: 항공기 증명 — 탑승일(9/20)이 출장 기간(9/9~9/10) 밖입니다 · 사후정산에 넣지 않았습니다',
  ]);
  const sure = afterPlan([ok, { ...far, confirmed: true }], { trip: TRIP, detail: TRAIN });
  assert.deepEqual([sure.lodge.map((l) => l.company), sure.skipped], [['고양호텔', '제주호텔'], []]);
});

console.log('숙박비 내역 — 영수증과 예약서를 한 줄로');
{
  const ctx = { trip: TRIP, detail: TRAIN };
  const receipt = rec({ docType: 'lodging_receipt', vendor: '라마다 고양 호텔', bizNo: '123-45-67890', payDate: '2026-09-10', total: 143000, vat: 13000, currency: 'KRW', corporateCard: true, file: PNG });
  const booking = rec({ docType: 'lodging_booking', vendor: '라마다 고양', checkIn: '2026-09-09', checkOut: '2026-09-10', total: 143000, extra: '조식 포함, 예약번호 AB12', file: { ...PNG, name: '예약서.pdf' } });
  const plan = afterPlan([booking, receipt], ctx);
  t('같은 업체의 예약서와 영수증이 한 줄이 된다 — 금액·결제일·사업자번호는 영수증에서, 박 수는 체크인·아웃에서, 공급가액은 총액 − 부가세', () => {
    assert.equal(plan.lodge.length, 1);
    const l = plan.lodge[0];
    assert.deepEqual([l.nation, l.paydate, l.sday, l.company, l.companycode, l.currency, l.cocard, l.total, l.samount, l.vat],
      ['KR||', '2026-09-10', 1, '라마다 고양 호텔', '123-45-67890', 'KRW', '1', 143000, 130000, 13000]);
    assert.equal(l.file.name, '영수증.png', '첨부는 영수증이 먼저다');
    assert.deepEqual(plan.problems, []);
    assert.equal(plan.air, null);
  });
  t('표를 넣지 않았고 편도 바꾸지 않았으면 교통비 내역은 넣지 않는다 — 사전정산의 값이 선다', () => {
    assert.deepEqual([plan.trans, plan.touched, plan.picks], [[], false, {}]);
    assert.deepEqual(plan.legs.map((l) => [l.key, l.pick.t, l.source]), [['go', 'train', 'site'], ['back', 'train', 'site']], '가는 편·오는 편은 사전정산대로 골라져 있다');
  });
  t('예약서의 추가 정보는 알려 준다', () => assert.ok(plan.notes.some((n) => /추가 정보 — 예약서\.pdf: 조식 포함, 예약번호 AB12/.test(n)), plan.notes.join(' | ')));
  t('필수 값(결제일·숙박 일수·업체명·정산금액)을 못 읽으면 올리지 않을 문제로 적는다', () => {
    const p = afterPlan([rec({ docType: 'lodging_receipt', vendor: '호텔', total: 100000, file: PNG })], ctx);
    assert.deepEqual(p.problems, ['숙박(영수증.png)에서 결제일·숙박 일수을(를) 읽지 못했습니다']);
    assert.equal(p.lodge[0].sday, null);
  });
  t('예약서만 있으면 올릴 수는 있지만 결제 영수증이 없다고 알린다 — 결제일은 체크아웃으로 둔다', () => {
    const p = afterPlan([booking], ctx);
    assert.deepEqual([p.lodge[0].paydate, p.lodge[0].sday, p.lodge[0].total, p.problems], ['2026-09-10', 1, 143000, []]);
    assert.ok(p.notes.some((n) => /예약서만 있고 결제 영수증이 없습니다/.test(n)));
  });
  t('당일 출장이면 숙박 증빙을 넣지 않고 그 까닭을 적는다', () => {
    const p = afterPlan([receipt], { trip: DAY, detail: { transports: [PRE_PLANE] } });
    assert.deepEqual([p.lodge, p.skipped], [[], ['영수증.png: 당일 출장이라 숙박비 내역은 넣지 않습니다']]);
  });
  t('숙박 일수가 출장 기간과 다르면 알린다', () => {
    const p = afterPlan([rec({ docType: 'lodging_receipt', vendor: '호텔', payDate: '2026-09-11', nights: 2, total: 200000, file: PNG })], ctx);
    assert.ok(p.notes.some((n) => /숙박 일수\(2박\)가 출장 기간\(1박\)과 다릅니다/.test(n)), p.notes.join(' | '));
  });

  // 2026-10-04 실제로 있던 일(145580): 대행사 영수증은 업체명이 영어, 예약서는 한글이라 두 줄로 갈렸고, 금액 없는 예약서 줄 때문에 올리지 못했다.
  const stay = { checkIn: '2026-09-09', checkOut: '2026-09-10', nights: 1 };
  const agoda = rec({ docType: 'lodging_receipt', vendor: 'SONO CALM GOYANG', seller: '아고다', payDate: '2026-09-07', total: 131.57, totalKRW: 177101, currency: 'USD', ...stay,
    file: { ...PNG, name: 'Receipt.pdf' } });
  const confirm = rec({ docType: 'lodging_booking', vendor: '소노캄 고양', ...stay, file: { ...PNG, name: 'Confirmation.pdf' } });
  t('업체명이 달리 적혀도 체크인·체크아웃이 같은 영수증과 예약서는 한 줄이 된다 — 금액 없는 예약서가 따로 서서 막지 않는다', () => {
    for (const records of [[agoda, confirm], [confirm, agoda]]) {
      const p = afterPlan(records, ctx);
      assert.deepEqual(p.problems, []);
      assert.equal(p.lodge.length, 1);
      const l = p.lodge[0];
      assert.deepEqual([l.company, l.paydate, l.sday, l.total, l.file.name], ['아고다', '2026-09-07', 1, 177101, 'Receipt.pdf']);
      assert.deepEqual([...l.sources].sort(), ['Confirmation.pdf', 'Receipt.pdf']);
    }
  });
  t('체크인·체크아웃이 다른 예약서는 합치지 않는다', () => {
    // 두 숙박이 다 출장 기간 안이어야 묶인다(기간 밖의 것은 빠진다) — 2박 출장으로 본다.
    const p = afterPlan([agoda, rec({ ...confirm, checkIn: '2026-09-10', checkOut: '2026-09-11' })], { ...ctx, trip: { ...TRIP, to: '2026-09-11' } });
    assert.equal(p.lodge.length, 2);
    assert.deepEqual(p.problems, ['숙박(Confirmation.pdf)에서 정산금액을(를) 읽지 못했습니다']);
  });
  t('날짜가 같은 영수증이 둘이면 어느 숙박의 예약서인지 몰라 합치지 않는다', () => {
    const other = rec({ docType: 'lodging_receipt', vendor: '라마다 고양', payDate: '2026-09-10', total: 143000, currency: 'KRW', ...stay, file: PNG });
    assert.equal(afterPlan([agoda, other, confirm], ctx).lodge.length, 3);
  });
  t('금액이 적힌 예약서는 날짜가 같아도 남의 영수증에 합치지 않는다 — 그것만으로 한 줄이다(다른 숙박일 수 있다)', () => {
    const p = afterPlan([agoda, rec({ ...confirm, total: 143000, currency: 'KRW' })], ctx);
    assert.deepEqual([p.lodge.length, p.problems], [2, []]);
  });
}

console.log('교통비 내역 — 가는 편·오는 편. 항공권을 넣으면 그 날짜의 편이 비행기로 바뀐다');
{
  const ticket = rec({ docType: 'flight_ticket', airline: '대한항공', flightNo: 'KE1402', flightDate: '2026-09-09', depPlace: '김해', arrPlace: '김포', depTime: '07:30', arrTime: '08:30', seatClass: '일반석', total: 98000, currency: 'KRW', mileage: 210, file: { ...PNG, name: '항공권.pdf' } });
  const back = rec({ docType: 'flight_receipt', airline: '대한항공', flightNo: 'KE1415', flightDate: '2026-09-10', depPlace: '김포', arrPlace: '김해', depTime: '19:00', arrTime: '20:00', total: 98000, currency: 'KRW', mileage: 210, file: { ...PNG, name: '오는편.pdf' } });
  const plan = afterPlan([back, ticket], { trip: TRIP, detail: TRAIN });
  t('항공권 두 장이면 두 편 모두 비행기다 — 수단은 "비행기", 시간은 시(時)만, 비고에 항공사·편명. 넣은 차례가 아니라 날짜로 앉는다', () => {
    assert.deepEqual(plan.trans.map((x) => [x.date, x.shr, x.ehr, x.dep, x.arr, x.transport, x.grade, x.total, x.currency, x.cocard, x.comment]), [
      ['2026-09-09', '7', '8', '김해', '김포', AFTER_TRANSPORT.plane, '일반석', 98000, 'KRW', '0', '대한항공 KE1402'],
      ['2026-09-10', '19', '20', '김포', '김해', AFTER_TRANSPORT.plane, '', 98000, 'KRW', '0', '대한항공 KE1415'],
    ]);
    assert.deepEqual(plan.problems, []);
    assert.deepEqual(plan.picks, { go: { t: 'plane', g: 'standard' }, back: { t: 'plane', g: 'standard' } }, '카드의 가는 편·오는 편도 비행기로 바뀐다');
    assert.deepEqual([plan.need.plane, plan.need.why, plan.touched], [true, '1박 · 비행기', true], '사전정산이 기차여도 항공권을 넣었으니 비행기를 탄 것이다');
  });
  t('대한항공이면 항공권 출장 = 예, 업무 항공마일리지 발생 = 예, 항공사와 마일리지 합', () =>
    assert.deepEqual(plan.air, { abroad: 'Y', bizmile: 'Y', airline: '대한항공', mileage: 420, deduction: 'Y', usage: 'N' }));
  t('항공권이 편도뿐이면 나머지 편은 KTX 다 — 사전정산에 그 편의 줄이 있으면 그 값 그대로 넣는다', () => {
    const p = afterPlan([back], { trip: TRIP, detail: TRAIN });
    assert.deepEqual(trans(p), [
      ['2026-09-09', '부산', '서울', AFTER_TRANSPORT.train, '일반석', 53700],
      ['2026-09-10', '김포', '김해', AFTER_TRANSPORT.plane, '', 98000],
    ]);
    assert.deepEqual(p.picks, { back: { t: 'plane', g: 'standard' } }, '가는 편은 손대지 않았다(사전정산 그대로)');
    assert.equal(afterSummary(p), 'KTX 2026-09-09 부산→서울 53,700원 · 비행기 2026-09-10 김포→김해 98,000원 · 항공 마일리지 대한항공 210마일');
  });
  t('카드에서 비행기를 특실로 골라 두었으면 등급 칸에 "특실"이 올라간다 — 요금은 항공권 그대로이고, 고른 것도 특실로 남는다 (2026-10-04 사용자 지정)', () => {
    const p = afterPlan([back, ticket], { trip: TRIP, detail: TRAIN, picks: { go: { t: 'plane', g: 'first' } } });
    assert.deepEqual(trans(p), [
      ['2026-09-09', '김해', '김포', AFTER_TRANSPORT.plane, '특실', 98000],
      ['2026-09-10', '김포', '김해', AFTER_TRANSPORT.plane, '', 98000],
    ]);
    assert.deepEqual(p.picks, { go: { t: 'plane', g: 'first' }, back: { t: 'plane', g: 'standard' } });
  });
  t('사전정산에 교통편 줄이 없으면 나머지 편의 KTX 는 근무지·출장지의 역과 운임표에서 찾는다', () => {
    const p = afterPlan([ticket], { trip: TRIP, detail: NONE, workplace: '부산 본사' });
    assert.deepEqual(trans(p), [
      ['2026-09-09', '김해', '김포', AFTER_TRANSPORT.plane, '일반석', 98000],
      ['2026-09-10', '서울', '부산', AFTER_TRANSPORT.train, '일반석', 54400],
    ]);
    assert.deepEqual(p.picks, { go: { t: 'plane', g: 'standard' }, back: { t: 'train', g: 'standard' } });
    const lost = afterPlan([ticket], { trip: { ...TRIP, location: '제주' }, detail: NONE, workplace: '부산' });
    assert.deepEqual(trans(lost).map((x) => x[3]), [AFTER_TRANSPORT.plane], 'KTX 역을 모르면 그 편은 넣지 않는다');
    assert.ok(lost.notes.some((n) => /오는 편은 넣지 못했습니다 — 출장지 "제주" 에서 내릴 KTX 역을 찾지 못했습니다/.test(n)), lost.notes.join(' | '));
  });
  t('왕복 항공권 한 장이면 가는 편·오는 편이 그 날짜에 앉고, 합계는 반씩 나뉜다', () => {
    const round = rec({ ...ticket, total: 196000, retDate: '2026-09-10', retDepPlace: '김포', retArrPlace: '김해', retDepTime: '19:00', retFlightNo: 'KE1415', file: { ...PNG, name: '왕복.pdf' } });
    const p = afterPlan([round], { trip: TRIP, detail: TRAIN });
    assert.deepEqual(p.trans.map((x) => [x.date, x.shr, x.dep, x.arr, x.transport, x.total, x.comment]), [
      ['2026-09-09', '7', '김해', '김포', AFTER_TRANSPORT.plane, 98000, '대한항공 KE1402'],
      ['2026-09-10', '19', '김포', '김해', AFTER_TRANSPORT.plane, 98000, '대한항공 KE1415'],
    ]);
    assert.ok(p.notes.some((n) => /왕복 항공권의 합계를 두 편에 반씩 나눠 적었습니다 — 왕복\.pdf/.test(n)));
    assert.equal(p.air.mileage, 210);
  });
  t('당일 출장이라 두 편이 같은 날이면 시각으로 가린다 — 이른 것이 가는 편, 늦은 것이 오는 편', () => {
    const am = rec({ ...ticket, file: { ...PNG, name: '아침.pdf' } });
    const pm = rec({ ...back, flightDate: '2026-09-09', file: { ...PNG, name: '저녁.pdf' } });
    const p = afterPlan([pm, am], { trip: DAY, detail: { rows: [KTX('2026-09-09', '부산', '서울'), KTX('2026-09-09', '서울', '부산')], transports: ['Train', 'Train'] } });
    assert.deepEqual(p.trans.map((x) => [x.shr, x.dep, x.arr, x.comment]), [['7', '김해', '김포', '대한항공 KE1402'], ['19', '김포', '김해', '대한항공 KE1415']]);
    assert.deepEqual([p.need.needed, p.need.why], [true, '당일 · 비행기']);
    const one = afterPlan([pm], { trip: DAY, detail: NONE, workplace: '부산' });
    assert.deepEqual(one.picks, { back: { t: 'plane', g: 'standard' }, go: { t: 'train', g: 'standard' } }, '한 장뿐이면 떠나는 곳(김포 = 출장지 쪽)을 보고 오는 편에 앉힌다');
  });
  t('마일리지가 안 적힌 항공권이면 항공 마일리지 표에서 편마다 찾는다 — 대한항공 김해↔김포 일반석 215마일 (2026-10-04 사용자 지정)', () => {
    const p = afterPlan([rec({ ...ticket, mileage: null })], { trip: TRIP, detail: TRAIN });
    assert.deepEqual(p.air, { abroad: 'Y', bizmile: 'Y', airline: '대한항공', mileage: 215, deduction: 'Y', usage: 'N' }, '항공권 출장 = 예, 마일리지 공제 = 예');
    assert.ok(p.notes.includes('신규 마일리지는 항공 마일리지 표에서 찾았습니다 — 가는 편 대한항공 김해→김포 215마일'), p.notes.join(' | '));
    const both = afterPlan([rec({ ...ticket, mileage: null }), rec({ ...back, mileage: null })], { trip: TRIP, detail: TRAIN });
    assert.equal(both.air.mileage, 430, '두 편이면 편마다 찾아 더한다');
    const round = rec({ ...ticket, mileage: null, total: 196000, retDate: '2026-09-10', retDepPlace: '김포', retArrPlace: '김해', retDepTime: '19:00', retFlightNo: 'KE1415' });
    assert.equal(afterPlan([round], { trip: TRIP, detail: TRAIN }).air.mileage, 430, '왕복표 한 장도 두 편이다');
    assert.equal(afterPlan([rec({ ...ticket, mileage: null }), back], { trip: TRIP, detail: TRAIN }).air.mileage, 425, '문서에 적힌 편(210)은 그 값, 안 적힌 편만 표에서(215)');
  });
  t('특실·비즈니스는 적립률이 다르다 — 카드에서 그 편을 특실로 골랐거나 항공권의 좌석 등급이 프레스티지·비즈니스면 125%', () => {
    const picked = afterPlan([rec({ ...ticket, mileage: null }), rec({ ...back, mileage: null })], { trip: TRIP, detail: TRAIN, picks: { go: { t: 'plane', g: 'first' } } });
    assert.equal(picked.air.mileage, 269 + 215);
    assert.ok(picked.notes.includes('신규 마일리지는 항공 마일리지 표에서 찾았습니다 — 가는 편 대한항공 김해→김포 특실 269마일(215 × 125%) · 오는 편 대한항공 김포→김해 215마일'), picked.notes.join(' | '));
    const seat = afterPlan([rec({ ...ticket, mileage: null, seatClass: '프레스티지석' })], { trip: TRIP, detail: TRAIN });
    assert.equal(seat.air.mileage, 269);
    assert.equal(afterPlan([rec({ ...ticket, mileage: 300 })], { trip: TRIP, detail: TRAIN, picks: { go: { t: 'plane', g: 'first' } } }).air.mileage, 300, '문서에 적힌 값이 먼저다');
  });
  t('항공 마일리지 표에 없는 항공사·구간은 채우지 않고 알린다 — 짐작하지 않는다', () => {
    const p = afterPlan([rec({ ...ticket, airline: '에어부산', flightNo: 'BX8802', mileage: null })], { trip: TRIP, detail: TRAIN });
    assert.deepEqual([p.air.airline, p.air.mileage, p.air.abroad], ['에어부산', null, 'Y']);
    assert.ok(p.notes.includes('항공 마일리지 표에 없어 신규 마일리지를 찾지 못한 편이 있습니다(가는 편 에어부산 김해→김포) — 적립되는 항공권이면 사후정산 화면에서 적어 주세요'), p.notes.join(' | '));
    const mixed = afterPlan([rec({ ...ticket, mileage: null }), rec({ ...back, airline: '에어부산', mileage: null })], { trip: TRIP, detail: TRAIN });
    assert.equal(mixed.air.mileage, 215, '찾은 편만 더한다');
    assert.ok(mixed.notes.some((n) => /찾지 못한 편이 있습니다\(오는 편 에어부산 김포→김해\)/.test(n)));
  });
  t('항공권의 필수 값(탑승일·출발지·도착지·합계)을 못 읽으면 문제로 적는다', () => {
    const p = afterPlan([rec({ docType: 'flight_ticket', airline: '아시아나항공', total: 90000, file: { ...PNG, name: 'oz.png' } })], { trip: TRIP, detail: TRAIN });
    assert.deepEqual(p.problems, ['항공권(oz.png)에서 탑승일·출발지·도착지을(를) 읽지 못했습니다']);
  });
  t('기차표는 증빙으로 받지 않는다 — 넣어도 편이 바뀌지 않고 교통비 내역도 생기지 않는다(KTX 는 운임표의 정가)', () => {
    const ktx = rec({ docType: 'train_ticket', flightDate: '2026-09-10', depPlace: '서울역', arrPlace: '부산역', depTime: '18:00', seatClass: '특실', total: 78400, file: { ...PNG, name: 'ktx.png' } });
    const p = afterPlan([ktx], { trip: TRIP, detail: TRAIN });
    assert.deepEqual([p.trans, p.picks, p.touched, p.air], [[], {}, false, null]);
    assert.deepEqual(p.skipped, ['ktx.png: 기차·버스표 — 증빙으로 받지 않습니다(KTX 는 운임표의 정가로 넣습니다)']);
    const withFlight = afterPlan([back, ktx], { trip: TRIP, detail: NONE, workplace: '부산' });
    assert.deepEqual(trans(withFlight)[0], ['2026-09-09', '부산', '서울', AFTER_TRANSPORT.train, '일반석', 54400], '나머지 편의 KTX 는 기차표의 값(78,400)이 아니라 정가다');
  });
  t('출장지에서 결제한 영수증(당일출장 증명)은 확인했다고 알린다(여비계산서에는 붙일 칸이 없어 패널이 보관한다) — 다른 곳의 영수증은 쓸 수 없다고 적는다', () => {
    const lunch = rec({ docType: 'other_receipt', vendor: '○○식당', payDate: '2026-09-09', payPlace: '경기 고양시', atDestination: true, total: 12000, file: { ...PNG, name: '점심.png' } });
    const day = { trip: DAY, detail: { rows: [KTX('2026-09-09', '부산', '서울'), KTX('2026-09-09', '서울', '부산')], transports: ['Train', 'Train'] } };
    const p = afterPlan([lunch], day);
    assert.deepEqual([p.lodge, p.trans, p.skipped, p.need.needed], [[], [], [], false]);
    assert.deepEqual(p.notes, ['점심.png: 당일출장 증명으로 확인했습니다(출장지에서 9/9 결제)']);
    const far = afterPlan([{ ...lunch, atDestination: false, payPlace: '부산 해운대구' }], day);
    assert.deepEqual([far.notes, far.skipped], [[], ['점심.png: 당일출장 증명으로 쓸 수 없습니다 — 출장지에서 결제한 영수증이 아닙니다(부산 해운대구)']]);
  });
  t('카드에서 손으로 바꾼 편도 들어간다 — 기차 특실은 운임표의 값, 값을 모르는 비행기(항공권 없음)는 넣지 않고 알린다', () => {
    const first = afterPlan([], { trip: TRIP, detail: TRAIN, picks: { back: { t: 'train', g: 'first' } } });
    assert.deepEqual(trans(first), [
      ['2026-09-09', '부산', '서울', AFTER_TRANSPORT.train, '일반석', 53700],
      ['2026-09-10', '서울', '부산', AFTER_TRANSPORT.train, '특실', 78900],
    ]);
    const plane = afterPlan([], { trip: TRIP, detail: TRAIN, picks: { go: { t: 'plane', g: 'standard' } } });
    assert.deepEqual(trans(plane), [['2026-09-10', '서울', '부산', AFTER_TRANSPORT.train, '일반석', 53700]]);
    assert.ok(plane.notes.some((n) => /가는 편은 넣지 못했습니다 — 비행기 요금을 모릅니다 — 항공권을 넣어 주세요/.test(n)), plane.notes.join(' | '));
    assert.equal(plane.air, null, '항공권이 없으면 항공 마일리지 칸은 건드리지 않는다');
  });
  t('표가 편보다 많으면 남는 표는 넣지 않고 알린다', () => {
    const third = rec({ ...ticket, flightNo: 'KE1404', depTime: '09:30', file: { ...PNG, name: '또.pdf' } });
    const p = afterPlan([ticket, back, third], { trip: TRIP, detail: TRAIN });
    assert.equal(p.trans.length, 2);
    assert.ok(p.notes.some((n) => /또\.pdf: 가는 편·오는 편에 이미 표가 있어 넣지 않았습니다/.test(n)), p.notes.join(' | '));
  });
  t('무슨 문서인지 모르면 넣지 않고 알린다', () => {
    const p = afterPlan([rec({ docType: 'unknown', summary: '손글씨 메모', file: { ...PNG, name: 'memo.png' } })], { trip: TRIP, detail: TRAIN });
    assert.deepEqual([p.lodge, p.trans, p.skipped], [[], [], ['memo.png: 모르는 문서 — 무슨 문서인지 읽지 못했습니다(손글씨 메모)']]);
  });
  t('한 줄 요약', () => {
    const lodgePlan = afterPlan([rec({ docType: 'lodging_receipt', vendor: '호텔A', payDate: '2026-09-10', nights: 1, total: 143000, file: PNG })], { trip: TRIP, detail: TRAIN });
    assert.equal(afterSummary(lodgePlan), '숙박 호텔A 1박 143,000원');
    assert.equal(afterSummary(plan), '비행기 2026-09-09 김해→김포 98,000원 · 비행기 2026-09-10 김포→김해 98,000원 · 항공 마일리지 대한항공 420마일');
  });
}

console.log('교통비 줄의 출발·도착 시 — KTX 편은 출장 출발·도착 시각과 구간의 대략 소요 시간으로 채운다');
{
  const flight = (over) => rec({ docType: 'flight_ticket', airline: '대한항공', flightNo: 'KE1402', flightDate: '2026-09-09', depPlace: '김해', arrPlace: '김포', depTime: '07:30', arrTime: '08:30', total: 98000, currency: 'KRW', file: { ...PNG, name: '항공권.pdf' }, ...over });
  const back = flight({ flightNo: 'KE1415', flightDate: '2026-09-10', depPlace: '김포', arrPlace: '김해', depTime: '19:00', arrTime: '20:00' });
  const times = (p) => p.trans.map((x) => [x.transport, x.dep, x.arr, x.shr, x.ehr]);
  // 출장은 07시 출발 · 20시 도착(tripPreDetail 이 사전정산 화면에서 읽어 준다). 부산↔서울은 4시간이다.
  const when = { sHour: 7, eHour: 20 };
  t('가는 편 KTX 는 출장 출발 시각에 떠나 소요 시간 뒤에 닿는다(부산 07시 → 서울 11시) — 항공권이 앉은 편은 항공권의 시각이다', () => {
    const p = afterPlan([back], { trip: TRIP, detail: { ...TRAIN, ...when } });
    assert.deepEqual(times(p), [[AFTER_TRANSPORT.train, '부산', '서울', '7', '11'], [AFTER_TRANSPORT.plane, '김포', '김해', '19', '20']]);
  });
  t('오는 편 KTX 는 출장 도착 시각에 닿게 그만큼 앞서 떠난다(서울 16시 → 부산 20시) — 사전정산에 줄이 없어 운임표로 지은 편도 같다', () => {
    const p = afterPlan([flight({})], { trip: TRIP, detail: { ...NONE, ...when }, workplace: '부산 본사' });
    assert.deepEqual(times(p), [[AFTER_TRANSPORT.plane, '김해', '김포', '7', '8'], [AFTER_TRANSPORT.train, '서울', '부산', '16', '20']]);
  });
  t('사전정산의 줄에 적힌 시각은 그대로 두고 빈 쪽만 채운다 — 출장 시각을 못 읽었으면 비워 둔다', () => {
    const rows = [{ ...KTX('2026-09-09', '부산', '서울'), shr: 8, ehr: 0 }, { ...KTX('2026-09-10', '서울', '부산'), shr: 15, ehr: 19 }];
    const p = afterPlan([back], { trip: TRIP, detail: { rows, transports: ['Train', 'Train'], ...when } });
    assert.deepEqual(times(p)[0], [AFTER_TRANSPORT.train, '부산', '서울', '8', '12']);
    const kept = afterPlan([flight({})], { trip: TRIP, detail: { rows, transports: ['Train', 'Train'], ...when } });
    assert.deepEqual(times(kept)[1], [AFTER_TRANSPORT.train, '서울', '부산', '15', '19']);
    assert.deepEqual(times(afterPlan([back], { trip: TRIP, detail: TRAIN }))[0], [AFTER_TRANSPORT.train, '부산', '서울', '', '']);
  });
  t('갈아타는 KTX 편은 구간마다 한 줄이다 — 부산→오송·오송→목포가 가는 편이고, 편을 바꾸면 네 줄이 시각이 이어져 올라간다 (2026-10-04 사용자 지정)', () => {
    const seg = (date, dep, arr, total) => ({ ...KTX(date, dep, arr), total });
    const VIA = [seg('2026-09-09', '부산', '오송', 37800), seg('2026-09-09', '오송', '목포', 31700), seg('2026-09-10', '목포', '오송', 31700), seg('2026-09-10', '오송', '부산', 37800)];
    const detail = { rows: VIA, transports: VIA.map((r) => r.transport), ...when };
    const MOKPO = { ...TRIP, location: '전남 목포시' };
    assert.deepEqual(afterPlan([], { trip: MOKPO, detail }).trans, [], '손대지 않았으면 사전정산의 네 줄이 그대로 선다');
    const p = afterPlan([], { trip: MOKPO, detail, picks: { back: { t: 'train', g: 'first' } } });
    assert.deepEqual(p.trans.map((x) => [x.date, x.dep, x.arr, x.transport, x.grade, x.total, x.shr, x.ehr]), [
      ['2026-09-09', '부산', '오송', AFTER_TRANSPORT.train, '일반석', 37800, '7', '10'], ['2026-09-09', '오송', '목포', AFTER_TRANSPORT.train, '일반석', 31700, '10', '12'],
      ['2026-09-10', '목포', '오송', AFTER_TRANSPORT.train, '특실', 46000, '15', '17'], ['2026-09-10', '오송', '부산', AFTER_TRANSPORT.train, '특실', 54800, '17', '20'],
    ]);
    assert.deepEqual(p.legs.map((l) => [l.key, l.row.dep, l.row.arr, l.row.total]), [['go', '부산', '목포', 69500], ['back', '목포', '부산', 100800]], '카드에는 편마다 한 줄로 보인다');
    assert.equal(afterFields([], p).filter(([n]) => n === 'tr_dep').length, 4);
    // 항공권이 가는 편에만 앉으면 오는 편은 KTX — 사전정산에 줄이 없어도 갈아타는 길을 찾는다.
    const fly = afterPlan([flight({ arrPlace: '무안' })], { trip: MOKPO, detail: { ...NONE, ...when }, workplace: '부산 본사' });
    assert.deepEqual(times(fly), [[AFTER_TRANSPORT.plane, '김해', '무안', '7', '8'], [AFTER_TRANSPORT.train, '목포', '오송', '15', '17'], [AFTER_TRANSPORT.train, '오송', '부산', '17', '20']]);
  });
  t('폼에는 tr_shr·tr_ehr 로 나간다', () => {
    const fields = afterFields([['tr_seq', '77'], ['tr_del', '0']], afterPlan([back], { trip: TRIP, detail: { ...TRAIN, ...when } }));
    const get = (k) => fields.filter(([n]) => n === k).map(([, v]) => v);
    assert.deepEqual([get('tr_shr'), get('tr_ehr'), get('tr_smn'), get('tr_emn')], [['7', '19'], ['11', '20'], ['0', '0'], ['0', '0']]);
  });
}

console.log('폼 칸 — 화면의 칸에 얹고 줄은 화면의 addLodge()/addTr() 순서로 덧붙인다');
{
  const base = [['seq', '145580'], ['trseq', '157777'], ['air_seq', ''], ['air_abroad', 'N'], ['air_bizmile', 'Y'], ['air_bizairline', ''], ['air_mileage', ''],
    ['air_deduction', 'Y'], ['air_miles', ''], ['air_comment', ''], ['air_mileusage', 'N'], ['air_usemileage', ''], ['meal_seq', ''], ['meal_card', 'N'],
    ['meal_deduction', 'N'], ['meal_amt', ''], ['meal_comment', ''], ['__RequestVerificationToken', 'tok']];
  const ctx = { trip: TRIP, detail: { rows: [], transports: [PRE_PLANE] } };
  const flight = rec({ docType: 'flight_ticket', airline: '대한항공', flightNo: 'KE1402', flightDate: '2026-09-09', depPlace: '김해', arrPlace: '김포', depTime: '07:30', arrTime: '08:30', total: 98000, mileage: 210 });
  // 오는 편은 비행기라고 골라 두었지만 항공권이 없다 — 값을 모르는 편은 줄이 되지 않는다.
  const plan = afterPlan([
    rec({ docType: 'lodging_receipt', vendor: '호텔A', bizNo: '1-2-3', payDate: '2026-09-10', nights: 1, total: 143000, supply: 130000, vat: 13000, file: PNG }),
    flight,
  ], { ...ctx, picks: { back: { t: 'plane', g: 'standard' } } });
  Object.assign(plan.lodge[0], { maxtotal: '150000', maxcur: 'KRW', maxrate: '1', maxconv: '150000' });
  const fields = afterFields(base, plan);
  const get = (k) => fields.filter(([n]) => n === k).map(([, v]) => v);
  t('항공 칸은 화면 값 위에 덮어쓴다 — 항공권 출장 Y, 발생 Y, 항공사, 신규 마일리지, 공제 금액은 마일 × 5', () =>
    assert.deepEqual([get('air_abroad'), get('air_bizmile'), get('air_bizairline'), get('air_mileage'), get('air_miles'), get('air_mileusage'), get('meal_card'), get('__RequestVerificationToken')],
      [['Y'], ['Y'], ['대한항공'], ['210'], ['1050'], ['N'], ['N'], ['tok']]));
  t('숙박 줄은 화면의 addLodge() 가 만드는 칸 차례 그대로이고 첨부는 { file } 로 표시된다', () => {
    const i = fields.findIndex(([n]) => n === 'lodge_nation');
    assert.deepEqual(fields.slice(i, i + 20).map(([n]) => n), ['lodge_nation', 'lodge_seq', 'lodge_del', 'lodge_oldfile', 'lodge_maxtotal', 'lodge_maxcur', 'lodge_maxrate', 'lodge_maxconv',
      'lodge_paydate', 'lodge_sday', 'lodge_company', 'lodge_companycode', 'lodge_currency', 'lodge_cocard', 'lodge_total', 'lodge_samount', 'lodge_vat', 'lodge_comment', 'lodge_etcname', 'lodge_file']);
    assert.deepEqual([get('lodge_nation'), get('lodge_paydate'), get('lodge_sday'), get('lodge_company'), get('lodge_companycode'), get('lodge_total'), get('lodge_samount'), get('lodge_vat'), get('lodge_maxtotal')],
      [['KR||'], ['2026-09-10'], ['1'], ['호텔A'], ['1-2-3'], ['143000'], ['130000'], ['13000'], ['150000']]);
    assert.deepEqual(get('lodge_file'), [{ file: PNG }]);
  });
  t('교통 줄은 addTr() 의 칸 차례 그대로다 — 첨부 칸은 없다', () => {
    const i = fields.findIndex(([n]) => n === 'tr_seq');
    assert.deepEqual(fields.slice(i, i + 15).map(([n]) => n), ['tr_seq', 'tr_del', 'tr_smn', 'tr_emn', 'tr_date', 'tr_shr', 'tr_ehr', 'tr_dep', 'tr_arr', 'tr_transport', 'tr_grade', 'tr_total', 'tr_currency', 'tr_cocard', 'tr_comment']);
    assert.deepEqual([get('tr_date'), get('tr_shr'), get('tr_ehr'), get('tr_transport'), get('tr_total'), get('tr_comment')], [['2026-09-09'], ['7'], ['8'], ['비행기'], ['98000'], ['대한항공 KE1402']]);
    assert.equal(fields.some(([n]) => n === 'tr_file'), false);
  });
  t('교통 줄을 다시 올릴 때는 화면에 있던 교통 줄을 지움 표시한다(가는 편·오는 편이 두 번 들어가지 않게) — 숙박 줄과 교통 줄을 안 올릴 때는 건드리지 않는다', () => {
    const old = [...base.slice(0, -1), ['lodge_seq', '31'], ['lodge_del', '0'], ['tr_seq', '77'], ['tr_del', '0'], ['tr_date', '2026-09-09'], base.at(-1)];
    const f = afterFields(old, plan);
    const pairs = (k) => f.filter(([n]) => n === k).map(([, v]) => v);
    assert.deepEqual([pairs('tr_seq'), pairs('tr_del')], [['77', ''], ['1', '0']], '있던 줄은 지우고 새 줄을 더한다');
    assert.deepEqual([pairs('lodge_seq'), pairs('lodge_del')], [['31', ''], ['0', '0']], '숙박 줄은 있던 것을 둔다');
    const lodgeOnly = afterFields(old, afterPlan([rec({ docType: 'lodging_receipt', vendor: '호텔A', payDate: '2026-09-10', nights: 1, total: 143000 })], ctx));
    assert.deepEqual(lodgeOnly.filter(([n]) => n === 'tr_del').map(([, v]) => v), ['0']);
  });
  t('항공권이 없으면 항공 칸은 화면 값 그대로다', () => {
    const p = afterPlan([rec({ docType: 'lodging_receipt', vendor: '호텔A', payDate: '2026-09-10', nights: 1, total: 143000 })], ctx);
    const f = afterFields(base, p);
    assert.deepEqual([f.find(([n]) => n === 'air_abroad')[1], f.some(([n]) => n === 'lodge_file')], ['N', false]);
  });
}

// 2026-10-05 사용자 지정: "상한액의 1.5배는 부서장 승인". 상한액(1일)은 사이트가 주고(maxconv), 배수와 승인자는 travel-rules.yaml 에 있다.
console.log('숙박비 상한액 초과 — 상한액의 1.5배까지는 부서장 승인을 받아 실제 금액으로 정산한다');
{
  const row = (actual, over = {}) => lodgeSettle({ stay: '소노캄 고양', company: '아고다', sday: 1, maxconv: '120000', settle: '', notes: [], actual,
    doc: { currency: 'USD', total: 131.57, supply: null, vat: null }, ...over });
  t('규칙은 travel-rules.yaml 에서 온다 — 1.5배, 부서장', () => {
    assert.deepEqual([TRAVEL_RULES.lodging.over_cap.approve_rate, TRAVEL_RULES.lodging.over_cap.approver], [1.5, '부서장']);
  });
  t('상한액 안이거나 상한액을 모르면 물을 것도 승인도 없다', () => {
    assert.deepEqual([lodgeOver(row(120000)), lodgeChoices(row(110000)), lodgeOver(row(177101, { maxconv: '' })), lodgeApproval(row(110000, { settle: 'real' }))], [null, null, null, '']);
  });
  t('상한액을 넘고 1.5배 안이면(177,101원 ≤ 180,000원) 실제 금액 버튼에 부서장 승인이라고 적고 까닭을 단다', () => {
    const l = row(177101);
    assert.deepEqual(lodgeOver(l), { cap: 120000, limit: 180000, rate: 1.5, approver: '부서장', within: true });
    assert.deepEqual(lodgeChoices(l), {
      question: '실제 금액 177,101원이 상한액 120,000원(1일 120,000원 × 1박)을 넘습니다. 정산금액을 어느 쪽으로 올릴까요?',
      choices: [
        { settle: 'cap', label: '상한액 120,000원으로' },
        { settle: 'real', label: '실제 금액 177,101원으로 · 부서장 승인', note: '상한액의 1.5배(180,000원) 이내라 부서장 승인을 받아 실제 금액으로 정산할 수 있습니다' },
      ],
    });
    assert.equal(lodgeOver(row(180000)).within, true, '꼭 1.5배인 금액은 범위 안이다');
  });
  t('1.5배를 넘으면 승인 범위를 벗어난다고 적는다 — 고르는 것은 막지 않는다', () => {
    const l = row(180001);
    assert.equal(lodgeOver(l).within, false);
    assert.deepEqual(lodgeChoices(l).choices[1], { settle: 'real', label: '실제 금액 180,001원으로', note: '상한액의 1.5배(180,000원)를 넘어 부서장 승인으로 정산할 수 있는 범위를 벗어납니다' });
    assert.equal(lodgeApproval({ ...l, settle: 'real' }), '상한액의 1.5배(180,000원) 초과 — 부서장 승인 범위를 벗어남');
  });
  t('상한액은 박 수만큼이다 — 2박이면 240,000원, 승인 범위는 360,000원', () => {
    assert.deepEqual([lodgeOver(row(300000, { sday: 2 })).cap, lodgeOver(row(300000, { sday: 2 })).limit], [240000, 360000]);
  });
  t('고르면 정산금액이 정해지고 더 묻지 않는다 — 실제 금액이면 승인 알림이 그 줄과 계획에 붙고, 상한액으로 바꾸면 걷힌다', () => {
    const l = row(177101);
    const plan = { lodge: [l], notes: ['추가 정보 — Receipt.pdf: 예약 번호 2048075129'] };
    assert.equal(lodgeAsk(l), 'cap');
    lodgeDecide(plan, l, 'real');
    const note = '소노캄 고양: 부서장 승인 필요 — 상한액의 1.5배(180,000원) 이내';
    assert.deepEqual([lodgeAsk(l), l.total, l.capped, l.notes, plan.notes], ['', 177101, false, [note], ['추가 정보 — Receipt.pdf: 예약 번호 2048075129', note]]);
    lodgeDecide(plan, l, 'real');
    assert.deepEqual(plan.notes.filter((n) => n === note).length, 1, '두 번 골라도 알림은 한 번이다');
    lodgeDecide(plan, l, 'cap');
    assert.deepEqual([l.total, l.capped, l.samount, l.vat, l.notes, plan.notes], [120000, true, 109091, 10909, [], ['추가 정보 — Receipt.pdf: 예약 번호 2048075129']]);
  });
}

console.log(`\n통과 ${pass}건`);
