// 사후정산 입력 화면의 "증빙으로 입력"(src/afterpage.js) — 놓은 증빙을 읽어 줄을 더하고 칸을 채운다.
//
// 지키려는 것은 셋이다.
//   - **저장은 누르지 않는다.** 화면의 칸만 채운다.
//   - 못 읽은 값은 지어내지 않는다 — 비워 두고 붉게 표시해 사람이 채우게 한다.
//   - 줄은 사이트의 "+ ADD입력"으로 만든다(사이트가 만드는 줄과 같은 칸·같은 차례여야 저장이 맞는다).
//
// 화면은 2026-10-03 실제 사후정산 입력 화면의 뼈대와 스크립트(addLodge·addTr·addOther·setChk·calcMaxLodgeRow)를 옮긴 것이다
// (선택지 목록만 줄였다). jsdom 이 그 스크립트를 실제로 돌린다 — 확장이 누른 버튼과 알린 change 가 사이트 함수에 닿는지 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fillPlan, nationOf, tripOfPage, startAfterPage, ROOT_ID, SECTIONS } from '../src/afterpage.js';
import { AFTER_TRANSPORT } from '../src/after.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const rec = (over) => ({
  docType: 'unknown', vendor: null, seller: null, sellerBiz: null, bizNo: null, totalKRW: null, payDate: null, payPlace: null, atDestination: null, checkIn: null, checkOut: null, nights: null,
  total: null, supply: null, vat: null, currency: null, corporateCard: null, transport: null, airline: null, flightNo: null, flightDate: null,
  depPlace: null, arrPlace: null, depTime: null, arrTime: null, seatClass: null, retDate: null, retDepPlace: null, retArrPlace: null,
  retDepTime: null, retFlightNo: null, mileage: null, passenger: null, extra: null, summary: '문서', ...over,
});
const HOTEL = rec({
  docType: 'lodging_receipt', vendor: '고양호텔', bizNo: '123-45-67890', payDate: '2026-09-10', checkIn: '2026-09-09', checkOut: '2026-09-10', nights: 1,
  total: 143000, supply: 130000, vat: 13000, currency: 'KRW', summary: '고양호텔 1박 결제 영수증 143,000원',
});
const BOOKING = rec({ docType: 'lodging_booking', vendor: '고양 호텔', checkIn: '2026-09-09', checkOut: '2026-09-10', total: 150000, currency: 'KRW', summary: '고양호텔 예약 확인서' });
const FLIGHT = rec({
  docType: 'flight_ticket', transport: 'plane', airline: '대한항공', flightNo: 'KE1104', flightDate: '2026-09-09', depPlace: '부산', arrPlace: '김포',
  depTime: '07:05', arrTime: '08:10', seatClass: '일반석', total: 98000, currency: 'KRW', mileage: 215, summary: '대한항공 부산→김포 항공권',
});
const ROUND = rec({ ...FLIGHT, retDate: '2026-09-10', retDepPlace: '김포', retArrPlace: '부산', retDepTime: '19:30', retFlightNo: 'KE1125', total: 196001, mileage: 430 });
const TAXI = rec({ docType: 'other_receipt', transport: 'taxi', vendor: '카카오T 택시', payDate: '2026-09-09', total: 12400, currency: 'KRW', summary: '택시 영수증 12,400원' });
const CAFE = rec({ docType: 'other_receipt', vendor: '킨텍스 카페', payDate: '2026-09-09', total: 5500, currency: 'KRW', summary: '카페 영수증 5,500원' });

console.log('읽은 기록 → 넣을 줄');
t('숙박 영수증은 숙박비 내역 한 줄 — 칸 이름은 화면의 것이고 필수는 업체명·결재일자·숙박 일수·정산금액', () => {
  const p = fillPlan(HOTEL);
  assert.equal(p.section, 'lodge');
  assert.deepEqual(p.rows[0].values, {
    lodge_paydate: '2026-09-10', lodge_sday: '1', lodge_company: '고양호텔', lodge_companycode: '123-45-67890', lodge_currency: 'KRW',
    lodge_total: '143000', lodge_samount: '130000', lodge_vat: '13000', lodge_comment: '',
  });
  assert.deepEqual(Object.values(p.rows[0].required), ['업체명', '결재일자', '숙박 일수', '정산금액']);
  assert.deepEqual([p.rows[0].strong, p.rows[0].weak, p.rows[0].cocard, p.air, p.notes], [true, [], false, null, []]);
});
t('업체명은 산 곳(구매처)이다 — 아고다에서 샀으면 아고다이고, 묵은 곳과 사업자명은 비고에 적는다', () => {
  const v = fillPlan(rec({ ...HOTEL, vendor: 'Toyoko INN Gangnam Seoul', seller: '아고다', sellerBiz: 'Agoda Company Pte. Ltd.', bizNo: null })).rows[0].values;
  assert.deepEqual([v.lodge_company, v.lodge_companycode, v.lodge_comment], ['아고다', '', 'Toyoko INN Gangnam Seoul · Agoda Company Pte. Ltd.']);
  const direct = fillPlan(rec({ ...HOTEL, seller: '고양 호텔' })).rows[0].values;
  assert.deepEqual([direct.lodge_company, direct.lodge_comment], ['고양 호텔', ''], '직접 결제했으면 비고에 되풀이하지 않는다');
});
t('정산금액은 원화로만 넣는다 — 외화 문서는 같이 적힌 원화 금액을 쓰고, 없으면 비워 두고 적으라고 한다', () => {
  const usd = rec({ ...HOTEL, currency: 'USD', total: 88.46, supply: null, vat: null });
  const none = fillPlan(usd);
  assert.deepEqual([none.rows[0].values.lodge_currency, none.rows[0].values.lodge_total, none.rows[0].values.lodge_samount, none.rows[0].foreign], ['KRW', '', '', true]);
  assert.ok(none.notes.some((n) => /외화 문서입니다\(88\.46 USD\) — 정산금액은 원화로 적습니다/.test(n)), none.notes.join(' | '));
  const krw = fillPlan(rec({ ...usd, totalKRW: 125052 }));
  assert.deepEqual([krw.rows[0].values.lodge_currency, krw.rows[0].values.lodge_total, krw.rows[0].values.lodge_samount, krw.rows[0].values.lodge_vat], ['KRW', '125052', '113684', '11368']);
  assert.ok(krw.notes.some((n) => /문서에 적힌 원화 금액을 정산금액에 넣었습니다/.test(n)));
});
t('공급가액·부가세는 문서에 있으면 그 값(하나만 있으면 다른 하나는 뺄셈)이고, 둘 다 없으면 정산금액에서 역산한다', () => {
  assert.deepEqual(fillPlan(rec({ ...HOTEL, supply: null })).rows[0].values.lodge_samount, '130000');
  assert.deepEqual(fillPlan(rec({ ...HOTEL, vat: null })).rows[0].values.lodge_vat, '13000');
  const none = fillPlan(rec({ ...HOTEL, total: 120000, supply: null, vat: null }));
  assert.deepEqual([none.rows[0].values.lodge_samount, none.rows[0].values.lodge_vat], ['109091', '10909'], '공급가액 = 정산금액 ÷ 1.1, 부가세 = 나머지');
  assert.ok(none.notes.some((n) => /정산금액에서 역산했습니다/.test(n)));
  assert.deepEqual(fillPlan(HOTEL).notes, [], '문서에 적혀 있으면 역산했다고 말하지 않는다');
});
t('예약 확인서는 박 수를 체크인·체크아웃에서 셈하고, 금액·결제일은 영수증이 오면 바뀔 값(weak)이다', () => {
  const p = fillPlan(BOOKING);
  assert.deepEqual([p.rows[0].values.lodge_sday, p.rows[0].values.lodge_paydate, p.rows[0].values.lodge_total], ['1', '2026-09-10', '150000']);
  assert.deepEqual(p.rows[0].weak, ['lodge_paydate', 'lodge_total', 'lodge_samount', 'lodge_vat']);
  assert.equal(p.rows[0].strong, false);
  assert.match(p.notes[0], /예약 확인서/);
  assert.equal(p.rows[0].key, fillPlan(HOTEL).rows[0].key, '띄어쓰기·"호텔" 꼬리가 달라도 같은 업체다');
});
t('항공권은 교통비 내역의 비행기 줄 — 시각은 시(時)만, 비고에 항공사·편명, 항공 마일리지도 켠다', () => {
  const p = fillPlan(FLIGHT);
  assert.equal(p.section, 'tr');
  assert.deepEqual(p.rows.map((r) => r.values), [{
    tr_date: '2026-09-09', tr_shr: '7', tr_ehr: '8', tr_dep: '부산', tr_arr: '김포', tr_transport: AFTER_TRANSPORT.plane,
    tr_grade: '일반석', tr_total: '98000', tr_currency: 'KRW', tr_comment: '대한항공 KE1104',
  }]);
  assert.deepEqual(p.air, { airline: '대한항공', mileage: 215 });
});
t('항공권에 적립 마일리지가 안 적혀 있으면 항공 마일리지 표에서 편마다 찾는다 — 프레스티지·비즈니스는 적립률이 다르고, 표에 없으면 비워 둔다 (2026-10-04 사용자 지정)', () => {
  const one = fillPlan(rec({ ...FLIGHT, mileage: null }));
  assert.deepEqual(one.air, { airline: '대한항공', mileage: 215 });
  assert.ok(one.notes.includes('신규 마일리지는 항공 마일리지 표에서 찾았습니다 — 대한항공 김해→김포 215마일'), one.notes.join(' | '));
  assert.equal(fillPlan(rec({ ...ROUND, mileage: null })).air.mileage, 430, '왕복표는 두 편을 더한다');
  assert.equal(fillPlan(rec({ ...FLIGHT, mileage: null, seatClass: '프레스티지석' })).air.mileage, 269);
  assert.equal(fillPlan(rec({ ...FLIGHT, mileage: 300, seatClass: '프레스티지석' })).air.mileage, 300, '문서에 적힌 값이 먼저다');
  const lcc = fillPlan(rec({ ...FLIGHT, airline: '에어부산', mileage: null }));
  assert.deepEqual([lcc.air, lcc.notes.some((n) => /항공 마일리지 표에서 찾았습니다/.test(n))], [{ airline: '에어부산', mileage: null }, false]);
});
t('왕복표 한 장은 두 줄 — 합계를 반씩 나누고(홀수면 가는 편이 올림) 오는 편은 구간을 뒤집는다', () => {
  const p = fillPlan(ROUND);
  assert.deepEqual(p.rows.map((r) => [r.values.tr_date, r.values.tr_dep, r.values.tr_arr, r.values.tr_shr, r.values.tr_total, r.values.tr_comment]), [
    ['2026-09-09', '부산', '김포', '7', '98001', '대한항공 KE1104'], ['2026-09-10', '김포', '부산', '19', '98000', '대한항공 KE1125'],
  ]);
  assert.ok(p.notes.some((n) => /반씩/.test(n)));
  const noRet = fillPlan(rec({ ...ROUND, retDepPlace: null, retArrPlace: null }));
  assert.deepEqual([noRet.rows[1].values.tr_dep, noRet.rows[1].values.tr_arr], ['김포', '부산'], '오는 편의 구간이 안 적혀 있으면 가는 편을 뒤집는다');
});
t('기차표·버스표도 이 화면에서는 교통비 줄이다(출장 카드와 달리 사용자가 직접 놓은 것이다)', () => {
  const train = fillPlan(rec({ docType: 'train_ticket', flightDate: '2026-09-09', depPlace: '부산', arrPlace: '서울', depTime: '06:30', arrTime: '09:12', seatClass: '특실', total: 76700, payDate: '2026-09-01' }));
  assert.deepEqual([train.section, train.rows[0].values.tr_transport, train.rows[0].values.tr_date, train.rows[0].values.tr_grade, train.rows[0].values.tr_total, train.air],
    ['tr', AFTER_TRANSPORT.train, '2026-09-09', '특실', '76700', null]);
  assert.equal(fillPlan(rec({ docType: 'bus_ticket', depPlace: '고양', arrPlace: '인천공항', total: 9000 })).rows[0].values.tr_transport, AFTER_TRANSPORT.bus);
  assert.equal(fillPlan(rec({ docType: 'train_ticket', payDate: '2026-09-01', total: 1 })).rows[0].values.tr_date, '', '표의 날짜는 탄 날이다 — 결제일로 채우지 않는다');
});
t('택시 영수증은 기타(택시등) — 탄 날이 따로 없으면 결제일, 비고에 가맹점', () => {
  const p = fillPlan(TAXI);
  assert.deepEqual([p.section, p.rows[0].values.tr_transport, p.rows[0].values.tr_date, p.rows[0].values.tr_total, p.rows[0].values.tr_comment],
    ['tr', AFTER_TRANSPORT.etc, '2026-09-09', '12400', '카카오T 택시']);
  assert.equal(fillPlan(rec({ ...TAXI, transport: 'subway' })).rows[0].values.tr_transport, AFTER_TRANSPORT.subway);
});
t('그 밖의 영수증·모르는 문서는 놓은 표를 따른다 — 어느 표인지 모르면 넣지 않는다', () => {
  const none = fillPlan(CAFE);
  assert.deepEqual([none.section, none.rows], ['', []]);
  assert.match(none.notes[0], /숙박·교통 증빙이 아닌 영수증/);
  assert.match(fillPlan(rec({})).notes[0], /무슨 문서인지 읽지 못했습니다/);
  const other = fillPlan(CAFE, 'other');
  assert.deepEqual([other.section, other.rows[0].values], ['other', { other_total: '5500', other_currency: 'KRW', other_comment: '킨텍스 카페 2026-09-09' }]);
  const tr = fillPlan(CAFE, 'tr');
  assert.equal(tr.rows[0].values.tr_transport, AFTER_TRANSPORT.etc);
  assert.ok(tr.notes.some((n) => /교통수단을 읽지 못해/.test(n)));
  const lodge = fillPlan(CAFE, 'lodge');
  assert.deepEqual([lodge.section, lodge.rows[0].values.lodge_company, lodge.rows[0].values.lodge_total], ['lodge', '킨텍스 카페', '5500']);
  assert.ok(lodge.notes.some((n) => /숙박 증빙으로 읽히지는 않았습니다/.test(n)));
  assert.equal(fillPlan(CAFE, 'constructor').section, '', '모르는 표 이름은 표가 아니다');
});
t('문서 종류가 뚜렷하면 놓은 표와 달라도 종류에 맞는 표로 가고, 그렇게 했다고 말한다', () => {
  const p = fillPlan(FLIGHT, 'lodge');
  assert.equal(p.section, 'tr');
  assert.match(p.notes[0], /항공권\(이\)라 교통비 내역에 넣었습니다/);
  assert.match(fillPlan(HOTEL, 'other').notes[0], /숙박 영수증\(이\)라 숙박비 내역에 넣었습니다/);
  assert.deepEqual(fillPlan(HOTEL, 'lodge').notes, []);
});
t('영수증의 추가 정보는 칸에 넣지 않고 알린다', () => {
  assert.ok(fillPlan(rec({ ...HOTEL, extra: '조식 포함' })).notes.includes('추가 정보 — 조식 포함'));
});

console.log('출장지(국가) 고르기');
{
  const options = [
    { value: 'KR||', text: '대한민국' }, { value: 'US||', text: '미국' }, { value: 'US|NYK|NYK', text: '미국-뉴욕' }, { value: 'TH||', text: '타이' },
    { value: 'IN||', text: '인도' }, { value: 'ID||', text: '인도네시아' }, { value: 'SG||', text: '싱가포르' }, { value: 'ET||', text: '이외의 국가,도시지역' },
  ];
  t('출장지의 낱말이 나라·도시 이름과 똑같을 때만 고른다', () => {
    assert.deepEqual(nationOf(options, '싱가포르 MPA'), { value: 'SG||', text: '싱가포르' });
    assert.deepEqual(nationOf(options, '미국 휴스턴'), { value: 'US||', text: '미국' });
    assert.deepEqual(nationOf(options, '미국 뉴욕'), { value: 'US|NYK|NYK', text: '미국-뉴욕' }, '나라와 도시가 다 맞은 쪽');
    assert.deepEqual(nationOf(options, '뉴욕'), { value: 'US|NYK|NYK', text: '미국-뉴욕' });
    assert.deepEqual(nationOf(options, '인도네시아(자카르타)'), { value: 'ID||', text: '인도네시아' });
  });
  t('국내 출장지나 이름이 겹치기만 하는 것은 고르지 않는다', () => {
    assert.equal(nationOf(options, '고양'), null);
    assert.equal(nationOf(options, '타이베이'), null, '"타이"에 걸리면 안 된다');
    assert.equal(nationOf(options, ''), null);
  });
}

/* ------------------------------------------------------------ 화면 */

// 2026-10-03 실제 화면의 스크립트 그대로다(선택지 목록만 줄였다). toggleAir·calcAirMiles 는 불렸는지만 적는다.
const SITE_SCRIPT = `
  var currencyOptions = '<option value="KRW">원(KRW)</option><option value="USD">달러(USD)</option><option value="SGD">달러(SGD)</option>';
  var countryOptions = '<option value="KR||">대한민국</option><option value="SG||">싱가포르</option><option value="US||">미국</option><option value="US|NYK|NYK">미국-뉴욕</option>';
  var transOptions = '<option value="기차(KTX등)">기차(KTX등)</option><option value="지하철">지하철</option><option value="선박">선박</option><option value="버스">버스</option><option value="비행기">비행기</option><option value="기타(택시등)">기타(택시등)</option>';
  window.siteCalls = [];
  function toggleAir() { window.siteCalls.push('toggleAir:' + document.getElementById('air_abroad').value); }
  function calcAirMiles() {
    var mq = document.querySelector('input[name=air_mileage]');
    document.querySelector('input[name=air_miles]').value = (parseFloat(mq.value) || 0) * 5;
  }
  function setChk(cb) {
    var h = cb.parentNode.querySelector('input[type="hidden"]');
    if (h) h.value = cb.checked ? '1' : '0';
  }
  function delRow(btn) {
    var tr = btn.closest('tr');
    var del = tr.querySelector('input[name$="_del"]');
    var seq = tr.querySelector('input[name$="_seq"]');
    if (seq && seq.value) { if (del) del.value = '1'; tr.style.display = 'none'; }
    else { tr.remove(); }
  }
  function addLodge() {
    var html = '<tr>'
      + '<td><select name="lodge_nation" onchange="calcMaxLodgeRow(this.closest(\\'tr\\'))">' + countryOptions + '</select></td>'
      + '<td><input type="hidden" name="lodge_seq" value=""/><input type="hidden" name="lodge_del" value="0"/>'
      + '<input type="hidden" name="lodge_oldfile" value=""/>'
      + '<input type="hidden" name="lodge_maxtotal" value=""/><input type="hidden" name="lodge_maxcur" value=""/>'
      + '<input type="hidden" name="lodge_maxrate" value=""/><input type="hidden" name="lodge_maxconv" value=""/>'
      + '<input type="date" name="lodge_paydate"/></td>'
      + '<td><input type="text" name="lodge_sday" size="2" maxlength="2" style="width:2.5em"/></td>'
      + '<td><input type="text" name="lodge_company" size="10"/></td>'
      + '<td><input type="text" name="lodge_companycode" size="10"/></td>'
      + '<td><select name="lodge_currency" onchange="calcMaxLodgeRow(this.closest(\\'tr\\'))">' + currencyOptions + '</select></td>'
      + '<td><input type="hidden" name="lodge_cocard" value="0"/><input type="checkbox" onclick="setChk(this)"/></td>'
      + '<td><input type="text" name="lodge_total" size="8"/><div class="lodge-max"></div></td>'
      + '<td><input type="text" name="lodge_samount" size="8"/></td>'
      + '<td><input type="text" name="lodge_vat" size="6"/></td>'
      + '<td><textarea name="lodge_comment" rows="3" cols="14"></textarea></td>'
      + '<td class="lodge-etc"><input type="text" name="lodge_etcname" size="8"/></td>'
      + '<td class="lodge-file"><input type="file" name="lodge_file"/></td>'
      + '<td><button type="button" class="bt-btn sub" onclick="delRow(this)">×</button></td></tr>';
    document.getElementById('lodgeBody').insertAdjacentHTML('beforeend', html);
    calcMaxLodgeRow(document.querySelector('#lodgeBody tr:last-child'));
  }
  function addTr() {
    var html = '<tr>'
      + '<td><input type="hidden" name="tr_seq" value=""/><input type="hidden" name="tr_del" value="0"/>'
      + '<input type="hidden" name="tr_smn" value="0"/><input type="hidden" name="tr_emn" value="0"/>'
      + '<input type="date" name="tr_date"/></td>'
      + '<td><input type="text" name="tr_shr" size="2" maxlength="2"/>H ~ <input type="text" name="tr_ehr" size="2" maxlength="2"/>H</td>'
      + '<td><input type="text" name="tr_dep" size="8"/></td>'
      + '<td><input type="text" name="tr_arr" size="8"/></td>'
      + '<td><select name="tr_transport">' + transOptions + '</select></td>'
      + '<td><input type="text" name="tr_grade" size="6"/></td>'
      + '<td><input type="text" name="tr_total" size="8"/></td>'
      + '<td><select name="tr_currency">' + currencyOptions + '</select></td>'
      + '<td><input type="hidden" name="tr_cocard" value="0"/><input type="checkbox" onclick="setChk(this)"/></td>'
      + '<td><textarea name="tr_comment" rows="3" cols="14"></textarea></td>'
      + '<td class="tr-file"></td>'
      + '<td><button type="button" class="bt-btn sub" onclick="delRow(this)">×</button></td></tr>';
    document.getElementById('trBody').insertAdjacentHTML('beforeend', html);
  }
  function addOther() {
    var html = '<tr>'
      + '<td><input type="hidden" name="other_seq" value=""/><input type="hidden" name="other_del" value="0"/>'
      + '<input type="text" name="other_total" style="width:80%"/></td>'
      + '<td><select name="other_currency" style="width:80%">' + currencyOptions + '</select></td>'
      + '<td><input type="text" name="other_comment" size="60" style="width:90%"/></td>'
      + '<td><button type="button" class="bt-btn sub" onclick="delRow(this)">×</button></td></tr>';
    document.getElementById('otherBody').insertAdjacentHTML('beforeend', html);
  }
  function calcMaxLodgeRow(rowEl) {
    var nat = rowEl.querySelector('select[name=lodge_nation]');
    var cur = rowEl.querySelector('select[name=lodge_currency]');
    window.siteCalls.push('maxLodge:' + nat.value + ':' + cur.value);
  }
`;
const head = (title, fn) => '<div style="display:flex; align-items:center; justify-content:space-between;">'
  + `<h3 style="margin:0;">${title}</h3><button type="button" class="bt-btn" onclick="${fn}()">+ ADD입력</button></div>`;
// 실제 화면은 숙박 줄의 첨부 칸(.lodge-file)을 CSS 로 숨겨 두었다(2026-10-03). showFile 은 그 칸이 보이는 화면이다.
const HIDE_FILE = '<style>#lodgeTbl .lodge-etc, #lodgeTbl .lodge-file { display: none; } #trTbl .tr-file { display: none; }</style>';
const PAGE = (location = '고양', { showFile = false } = {}) => `<html><head>${showFile ? '' : HIDE_FILE}</head><body>`
  + '<div class="bt-form"><table id="tripInfoTbl">'
  + '<tr><th>출장자</th><td><select id="drPIC"><option value="157777" selected="selected">홍길동</option></select></td><th>수행출장</th><td></td></tr>'
  + '<tr><th>출장기간</th><td colspan="3">2026-09-09 7 시 ~ 2026-09-10 20 시</td></tr>'
  + `<tr><th>출장지</th><td colspan="3">${location}</td></tr>`
  + '<tr><th>주재국</th><td colspan="3">대한민국</td></tr></table></div>'
  + '<form method="post" id="frm" class="bt-form" enctype="multipart/form-data" action="/BusinessTrip/AfterTrip/Save">'
  + '<input type="hidden" name="seq" value="145580" /><input type="hidden" name="trseq" value="157777" />'
  + '<table id="airTbl"><tr><td><select name="air_abroad" id="air_abroad" onchange="toggleAir()"><option value="N" selected="selected">아니오</option><option value="Y">예</option></select></td></tr>'
  + '<tr><td><select name="air_bizmile"><option value="Y" selected="selected">예</option><option value="N">아니오</option></select></td></tr>'
  + '<tr><td><input type="text" name="air_bizairline" value="" /></td></tr>'
  + '<tr><td><input type="text" name="air_mileage" value="" oninput="calcAirMiles()" /></td></tr>'
  + '<tr><td><input type="text" name="air_miles" value="" readonly /></td></tr></table>'
  + head('숙박비 내역', 'addLodge') + '<table id="lodgeTbl" class="list"><thead><tr><th>출장지</th></tr></thead><tbody id="lodgeBody"></tbody></table>'
  + head('교통비 내역(대중교통)', 'addTr') + '<table id="trTbl" class="list"><thead><tr><th>일자</th></tr></thead><tbody id="trBody"></tbody></table>'
  + head('기타 비용', 'addOther') + '<table id="otherTbl" class="list"><thead><tr><th>금액</th></tr></thead><tbody id="otherBody"></tbody></table>'
  + '<div><button type="submit" class="bt-btn">저장</button></div></form>'
  + `<script>${SITE_SCRIPT}</script></body></html>`;

/**
 * 화면을 띄우고 "증빙으로 입력"을 붙인다. records 는 파일 이름 → 읽은 기록(없으면 읽기 실패)이다.
 * seen 에 배경에게 보낸 것, attached 에 첨부 칸에 붙인 것, submits 에 저장이 눌린 횟수가 남는다.
 */
function mount({ records = {}, location, alive = () => true, html, showFile = false } = {}) {
  const dom = new JSDOM(html || PAGE(location, { showFile }), { url: 'https://eclass.krs.co.kr/BusinessTrip/AfterTrip?seq=145580&trseq=157777', runScripts: 'dangerously' });
  const { window } = dom;
  const doc = window.document;
  const seen = [];
  const attached = [];
  const submits = [];
  doc.querySelector('form#frm')?.addEventListener('submit', (e) => { e.preventDefault(); submits.push(1); });
  const page = startAfterPage(doc, {
    alive,
    read: async (file, ctx) => {
      seen.push({ file, ctx });
      return file.name in records ? { ok: true, record: records[file.name], via: 'cli' } : { ok: false, error: '증빙을 읽지 못했습니다 — Claude 연결(로컬 CLI 또는 API 키)이 필요합니다' };
    },
    attach: (input, file) => {
      attached.push([input.name, file.name]);
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
    },
  });
  const file = (name, type = 'image/png', body = 'x') => new window.File([body], name, { type });
  const rows = (key) => [...doc.getElementById(SECTIONS[key].body).children];
  const val = (tr, name) => tr.querySelector(`[name="${name}"]`).value;
  const lines = () => [...doc.querySelectorAll(`#${ROOT_ID} .krsw-item`)].map((li) => ({
    name: li.querySelector('b').textContent, state: li.dataset.state, msg: li.querySelector('.krsw-msg').textContent,
    notes: [...li.querySelectorAll('.krsw-notes li')].map((x) => x.textContent),
  }));
  /** 끌어다 놓기·붙여넣기 이벤트. jsdom 에는 DataTransfer 가 없어 필요한 모양만 붙인다. */
  const send = (type, target, key, data) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, key, { value: data });
    target.dispatchEvent(ev);
    return ev;
  };
  return { window, doc, page, seen, attached, submits, file, rows, val, lines, send, site: () => [...window.siteCalls] };
}

console.log('화면에 붙이기');
t('출장 정보는 화면 머리에서 읽는다', () => {
  const { doc } = mount();
  assert.deepEqual(tripOfPage(doc), { trip: { from: '2026-09-09', to: '2026-09-10', location: '고양' }, me: '홍길동' });
});
t('사후정산 입력 화면이 아니면 붙지 않고, 두 번 붙지도 않는다', () => {
  const none = new JSDOM('<html><body><form id="frm"></form></body></html>').window.document;
  assert.equal(startAfterPage(none), null);
  assert.equal(none.getElementById(ROOT_ID), null);
  const { doc, page } = mount();
  assert.ok(page);
  assert.equal(startAfterPage(doc), null);
  assert.equal(doc.querySelectorAll(`#${ROOT_ID}`).length, 1);
});
t('세 표의 "+ ADD입력" 옆에 "+ 증빙으로 입력"이 붙고, 사이트 버튼은 그대로 돈다', () => {
  const { doc, rows } = mount();
  const picks = [...doc.querySelectorAll('button.krsw-pick')];
  assert.equal(picks.length, 3);
  for (const p of picks) {
    assert.equal(p.type, 'button', '폼을 제출하는 버튼이면 안 된다');
    assert.match(p.nextElementSibling.accept, /image\/\*/);
    assert.equal(p.nextElementSibling.name, '', '고르는 칸이 폼과 같이 올라가면 안 된다');
    assert.match(p.parentElement.lastElementChild.getAttribute('onclick'), /^add(Lodge|Tr|Other)\(\)$/);
  }
  doc.querySelector('button[onclick="addTr()"]').click();
  assert.equal(rows('tr').length, 1);
  assert.equal(doc.getElementById(ROOT_ID).hidden, true, '넣기 전에는 상태 상자가 보이지 않는다');
});

console.log('증빙을 넣으면 줄을 더해 채운다');
await ta('숙박 영수증 → "+ ADD입력"이 눌려 줄이 생기고 칸이 채워진다. 숨겨진 첨부 칸에는 파일을 붙이지 않고, 저장은 누르지 않는다', async () => {
  const m = mount({ records: { '영수증.png': HOTEL } });
  await m.page.handleFiles([m.file('영수증.png')]);
  const [tr] = m.rows('lodge');
  assert.equal(m.rows('lodge').length, 1);
  assert.deepEqual(['lodge_nation', 'lodge_paydate', 'lodge_sday', 'lodge_company', 'lodge_companycode', 'lodge_currency', 'lodge_cocard', 'lodge_total', 'lodge_samount', 'lodge_vat', 'lodge_comment']
    .map((n) => m.val(tr, n)), ['KR||', '2026-09-10', '1', '고양호텔', '123-45-67890', 'KRW', '0', '143000', '130000', '13000', '']);
  assert.equal(tr.dataset.krswStay, '고양', '묵은 곳을 줄에 적어 둔다 — 같은 숙박의 예약서·영수증이 한 줄로 모인다');
  assert.deepEqual(m.attached, [], '사람이 보지도 떼지도 못하는 파일이 저장 때 같이 올라가면 안 된다');
  assert.deepEqual(m.site(), ['maxLodge:KR||:KRW'], '상한 조회는 사이트의 addLodge 가 한 것 하나뿐이다');
  assert.ok(tr.querySelector('[name="lodge_total"]').classList.contains('krsw-filled'));
  assert.ok(!tr.querySelector('[name="lodge_comment"]').classList.contains('krsw-filled'), '채우지 않은 칸은 표시하지 않는다');
  assert.deepEqual(m.lines(), [{ name: '영수증.png', state: 'ok', msg: '숙박비 내역에 넣었습니다 — 고양호텔 1박 결제 영수증 143,000원', notes: [] }]);
  assert.equal(m.doc.getElementById(ROOT_ID).hidden, false);
  assert.equal(m.submits.length, 0);
  // 배경에게는 파일(data URL)과 화면의 출장 정보가 간다.
  assert.deepEqual([m.seen[0].file.name, m.seen[0].file.type, m.seen[0].ctx], ['영수증.png', 'image/png', { trip: { from: '2026-09-09', to: '2026-09-10', location: '고양' }, me: '홍길동' }]);
  assert.match(m.seen[0].file.dataUrl, /^data:image\/png;base64,/);
});
await ta('비어 있는 새 줄이 있으면 줄을 더하지 않고 그 줄을 쓴다', async () => {
  const m = mount({ records: { 'a.png': HOTEL } });
  m.doc.querySelector('button[onclick="addLodge()"]').click();
  await m.page.handleFiles([m.file('a.png')]);
  assert.equal(m.rows('lodge').length, 1);
  assert.equal(m.val(m.rows('lodge')[0], 'lodge_company'), '고양호텔');
});
await ta('첨부 칸이 보이는 화면이면 읽은 파일을 그 칸에 붙이고 붙였다고 말한다', async () => {
  const m = mount({ showFile: true, records: { '영수증.png': HOTEL } });
  await m.page.handleFiles([m.file('영수증.png')]);
  assert.deepEqual(m.attached, [['lodge_file', '영수증.png']]);
  assert.deepEqual(m.lines()[0].notes, ['숙박 줄의 첨부 칸에 파일을 붙였습니다']);
  assert.ok(m.rows('lodge')[0].querySelector('[name="lodge_file"]').classList.contains('krsw-filled'));
});
await ta('예약 확인서 다음에 결제 영수증 → 한 줄로 모이고, 금액·결제일·첨부는 영수증 것으로 바뀐다', async () => {
  const m = mount({ showFile: true, records: { '예약.pdf': BOOKING, '영수증.png': rec({ ...HOTEL, nights: null, checkIn: null, checkOut: null }) } });
  await m.page.handleFiles([m.file('예약.pdf', 'application/pdf'), m.file('영수증.png')]);
  const [tr] = m.rows('lodge');
  assert.equal(m.rows('lodge').length, 1);
  assert.deepEqual(['lodge_paydate', 'lodge_sday', 'lodge_company', 'lodge_total', 'lodge_samount', 'lodge_vat'].map((n) => m.val(tr, n)),
    ['2026-09-10', '1', '고양 호텔', '143000', '130000', '13000'], '박 수는 예약서, 금액은 영수증, 먼저 적힌 업체명은 그대로');
  assert.deepEqual(m.attached, [['lodge_file', '예약.pdf'], ['lodge_file', '영수증.png']]);
  assert.deepEqual(m.lines().map((l) => [l.state, l.msg.split(' — ')[0]]), [['ok', '숙박비 내역에 넣었습니다'], ['ok', '숙박비 내역의 있던 줄에 채웠습니다']]);
  assert.ok(m.lines()[1].notes.some((n) => /같은 업체의 줄/.test(n)));
});
await ta('사람이 고친 칸은 영수증이 와도 바꾸지 않는다', async () => {
  const m = mount({ records: { '예약.pdf': BOOKING, '영수증.png': HOTEL } });
  await m.page.handleFiles([m.file('예약.pdf', 'application/pdf')]);
  const total = m.rows('lodge')[0].querySelector('[name="lodge_total"]');
  total.value = '140000';
  total.dispatchEvent(new m.window.Event('input', { bubbles: true }));
  assert.ok(!total.classList.contains('krsw-filled'), '고친 칸은 더는 확장이 채운 칸이 아니다');
  await m.page.handleFiles([m.file('영수증.png')]);
  assert.equal(total.value, '140000');
});
await ta('못 읽은 필수 값은 지어내지 않는다 — 비워 두고 붉게 표시하며 무엇인지 말한다. 적으면 표시가 걷힌다', async () => {
  const m = mount({ records: { 'a.png': rec({ ...HOTEL, nights: null, checkIn: null, checkOut: null, total: null, supply: null, vat: null }) } });
  await m.page.handleFiles([m.file('a.png')]);
  const [tr] = m.rows('lodge');
  const sday = tr.querySelector('[name="lodge_sday"]');
  assert.deepEqual([sday.value, m.val(tr, 'lodge_total')], ['', '']);
  assert.ok(sday.classList.contains('krsw-missing'));
  assert.equal(m.lines()[0].state, 'warn');
  assert.equal(m.lines()[0].notes[0], '못 읽은 칸(붉게 표시): 숙박 일수·정산금액 — 직접 적어 주세요');
  sday.value = '1';
  sday.dispatchEvent(new m.window.Event('input', { bubbles: true }));
  assert.ok(!sday.classList.contains('krsw-missing'));
});
await ta('법인카드라고 적힌 문서면 체크하고 숨은 칸도 1 이 된다', async () => {
  const m = mount({ records: { 'a.png': rec({ ...HOTEL, corporateCard: true }) } });
  await m.page.handleFiles([m.file('a.png')]);
  const [tr] = m.rows('lodge');
  assert.deepEqual([tr.querySelector('input[type="checkbox"]').checked, m.val(tr, 'lodge_cocard')], [true, '1']);
});
await ta('외화 문서여도 화폐는 원화 그대로다 — 원화 금액이 문서에 없으면 정산금액을 비워 붉게 표시한다. 출장지가 선택지에 있으면 국가는 고른다', async () => {
  const m = mount({ location: '싱가포르 MPA', records: { 'inv.pdf': rec({ ...HOTEL, vendor: 'Marina Hotel', currency: 'SGD', total: 420.5, supply: null, vat: null }) } });
  await m.page.handleFiles([m.file('inv.pdf', 'application/pdf')]);
  const [tr] = m.rows('lodge');
  assert.deepEqual([m.val(tr, 'lodge_nation'), m.val(tr, 'lodge_currency'), m.val(tr, 'lodge_total')], ['SG||', 'KRW', '']);
  assert.ok(tr.querySelector('[name="lodge_total"]').classList.contains('krsw-missing'));
  assert.deepEqual(m.site(), ['maxLodge:KR||:KRW', 'maxLodge:SG||:KRW']);
  assert.equal(m.lines()[0].state, 'warn');
  assert.ok(m.lines()[0].notes.some((n) => /출장지를 "싱가포르"\(으\)로 골랐습니다/.test(n)));
  assert.ok(m.lines()[0].notes.some((n) => /외화 문서입니다\(420\.5 SGD\)/.test(n)));
});
await ta('대행사에서 산 숙박 — 업체명에 아고다, 비고에 묵은 곳. 같은 숙박의 영수증이 뒤에 오면 그 줄로 모인다. 국내 출장지에 외화면 국가를 확인하라고 한다', async () => {
  const book = rec({ ...BOOKING, vendor: 'Toyoko INN Gangnam Seoul', seller: '아고다', currency: 'USD', total: 88.46 });
  const paid = rec({ ...HOTEL, vendor: 'Toyoko Inn Gangnam Seoul', seller: '아고다', total: 125052, supply: null, vat: null, nights: null, checkIn: null, checkOut: null });
  const m = mount({ records: { 'a.png': book, 'b.png': paid } });
  await m.page.handleFiles([m.file('a.png'), m.file('b.png')]);
  const [tr] = m.rows('lodge');
  assert.equal(m.rows('lodge').length, 1, '업체명이 같은 아고다여도 묵은 곳으로 견줘 한 줄이다');
  assert.deepEqual(['lodge_company', 'lodge_currency', 'lodge_total', 'lodge_samount', 'lodge_vat', 'lodge_comment'].map((n) => m.val(tr, n)),
    ['아고다', 'KRW', '125052', '113684', '11368', 'Toyoko INN Gangnam Seoul']);
  assert.ok(m.lines()[0].notes.some((n) => /출장지\(국가\)를 확인/.test(n)));
  const other = mount({ records: { 'a.png': book, 'c.png': rec({ ...paid, vendor: '롯데시티호텔 명동' }) } });
  await other.page.handleFiles([other.file('a.png'), other.file('c.png')]);
  assert.equal(other.rows('lodge').length, 2, '같은 아고다에서 샀어도 묵은 곳이 다르면 다른 줄이다');
});
await ta('왕복 항공권 → 교통비 두 줄, 항공권 출장 = 예(사이트의 toggleAir 가 돈다), 항공사·신규 마일리지(공제 금액은 사이트가 셈한다)', async () => {
  const m = mount({ records: { 'ticket.pdf': ROUND } });
  await m.page.handleFiles([m.file('ticket.pdf', 'application/pdf')]);
  assert.deepEqual(m.rows('tr').map((tr) => ['tr_date', 'tr_shr', 'tr_ehr', 'tr_dep', 'tr_arr', 'tr_transport', 'tr_grade', 'tr_total', 'tr_currency', 'tr_cocard', 'tr_comment'].map((n) => m.val(tr, n))), [
    ['2026-09-09', '7', '8', '부산', '김포', '비행기', '일반석', '98001', 'KRW', '0', '대한항공 KE1104'],
    ['2026-09-10', '19', '', '김포', '부산', '비행기', '일반석', '98000', 'KRW', '0', '대한항공 KE1125'],
  ]);
  const f = (n) => m.doc.querySelector(`[name="${n}"]`).value;
  assert.deepEqual([f('air_abroad'), f('air_bizmile'), f('air_bizairline'), f('air_mileage'), f('air_miles')], ['Y', 'Y', '대한항공', '430', '2150']);
  assert.deepEqual(m.site(), ['toggleAir:Y']);
  assert.equal(m.rows('lodge').length, 0);
  assert.equal(m.attached.length, 0, '교통비 줄에는 첨부 칸이 없다');
  assert.equal(m.lines()[0].msg, '교통비 내역에 2줄을 넣었습니다 — 대한항공 부산→김포 항공권');
  assert.equal(m.submits.length, 0);
});
await ta('같은 날·같은 구간의 교통 줄이 이미 있으면 줄을 또 만들지 않는다. 마일리지 칸의 값도 덮지 않는다', async () => {
  const m = mount({ records: { 'a.png': FLIGHT, 'b.png': rec({ ...FLIGHT, mileage: 300 }) } });
  await m.page.handleFiles([m.file('a.png'), m.file('b.png')]);
  assert.equal(m.rows('tr').length, 1);
  assert.equal(m.doc.querySelector('[name="air_mileage"]').value, '215');
  assert.ok(m.lines()[1].notes.some((n) => /같은 날·같은 구간/.test(n)));
  assert.ok(m.lines()[1].notes.some((n) => /이미 값이 있어 그대로 두었습니다\(이 표: 300마일\)/.test(n)));
});
await ta('여러 장은 넣은 차례대로 한 장씩 읽는다', async () => {
  const m = mount({ records: { '1.png': TAXI, '2.png': FLIGHT, '3.png': HOTEL } });
  await m.page.handleFiles([m.file('1.png'), m.file('2.png'), m.file('3.png')]);
  assert.deepEqual(m.seen.map((s) => s.file.name), ['1.png', '2.png', '3.png']);
  assert.deepEqual(m.rows('tr').map((tr) => m.val(tr, 'tr_transport')), ['기타(택시등)', '비행기']);
  assert.equal(m.rows('lodge').length, 1);
});

console.log('끌어다 놓기 · 붙여넣기 · 파일 고르기');
await ta('표에 놓은 그 밖의 영수증은 그 표에 들어간다 — 교통비 표면 기타(택시등), 기타 비용 표면 금액·비고', async () => {
  const m = mount({ records: { 'cafe.png': CAFE } });
  const drop = (target) => m.send('drop', target, 'dataTransfer', { types: ['Files'], files: [m.file('cafe.png')] });
  const ev = drop(m.doc.getElementById('trTbl'));
  assert.equal(ev.defaultPrevented, true, '받지 않으면 브라우저가 파일을 열어 폼이 날아간다');
  drop(m.doc.getElementById('otherTbl').previousElementSibling.querySelector('h3'));   // 표의 머리 줄(제목)에 놓아도 그 표다
  await m.page.handleFiles([]);
  assert.deepEqual(['tr_date', 'tr_transport', 'tr_total', 'tr_comment'].map((n) => m.val(m.rows('tr')[0], n)), ['2026-09-09', '기타(택시등)', '5500', '킨텍스 카페']);
  assert.deepEqual(['other_total', 'other_currency', 'other_comment'].map((n) => m.val(m.rows('other')[0], n)), ['5500', 'KRW', '킨텍스 카페 2026-09-09']);
});
await ta('표 밖에 놓은 그 밖의 영수증은 넣지 않고 어디에 놓으라고 말한다. 숙박·교통 증빙은 어디에 놓아도 제 표로 간다', async () => {
  const m = mount({ records: { 'cafe.png': CAFE, 'hotel.png': HOTEL } });
  m.send('drop', m.doc.getElementById('tripInfoTbl'), 'dataTransfer', { types: ['Files'], files: [m.file('cafe.png'), m.file('hotel.png')] });
  await m.page.handleFiles([]);
  assert.deepEqual([m.rows('lodge').length, m.rows('tr').length, m.rows('other').length], [1, 0, 0]);
  assert.deepEqual([m.lines()[0].state, m.lines()[0].msg], ['warn', '넣지 않았습니다 — 카페 영수증 5,500원']);
  assert.match(m.lines()[0].notes[0], /넣을 표\(숙박비·교통비·기타 비용\) 위에 놓으면/);
});
await ta('비어 있는 줄 위에 놓으면 그 줄을 쓴다. 다 적힌 줄 위에 놓은 다른 업체의 영수증은 새 줄이 된다', async () => {
  const m = mount({ records: { 'a.png': HOTEL, 'b.png': rec({ ...HOTEL, vendor: '일산모텔', total: 60000, supply: null, vat: null }) } });
  const add = m.doc.querySelector('button[onclick="addLodge()"]');
  add.click();
  add.click();
  const second = m.rows('lodge')[1];
  m.send('drop', second.querySelector('[name="lodge_company"]'), 'dataTransfer', { types: ['Files'], files: [m.file('a.png')] });
  await m.page.handleFiles([]);
  assert.deepEqual(m.rows('lodge').map((tr) => m.val(tr, 'lodge_company')), ['', '고양호텔']);
  m.send('drop', second, 'dataTransfer', { types: ['Files'], files: [m.file('b.png')] });
  await m.page.handleFiles([]);
  assert.deepEqual(m.rows('lodge').map((tr) => m.val(tr, 'lodge_company')), ['일산모텔', '고양호텔'], '남아 있던 빈 줄을 쓴다');
});
await ta('파일이 아닌 것을 끄는 것(글·링크)은 건드리지 않는다', async () => {
  const m = mount();
  const over = m.send('dragover', m.doc.body, 'dataTransfer', { types: ['text/plain'], files: [] });
  const drop = m.send('drop', m.doc.body, 'dataTransfer', { types: ['text/plain'], files: [] });
  assert.deepEqual([over.defaultPrevented, drop.defaultPrevented], [false, false]);
  assert.equal(m.lines().length, 0);
});
await ta('파일을 끄는 동안 놓을 표를 보여 주고, 놓으면 걷는다', async () => {
  const m = mount({ records: { 'a.png': HOTEL } });
  const form = m.doc.querySelector('form#frm');
  const table = m.doc.getElementById('lodgeTbl');
  const over = m.send('dragover', table, 'dataTransfer', { types: ['Files'], files: [] });
  assert.equal(over.defaultPrevented, true, 'dragover 를 받아야 놓을 수 있다');
  assert.deepEqual([form.classList.contains('krsw-dragging'), table.classList.contains('krsw-over'), m.doc.getElementById('trTbl').classList.contains('krsw-over')], [true, true, false]);
  m.send('drop', table, 'dataTransfer', { types: ['Files'], files: [m.file('a.png')] });
  assert.deepEqual([form.classList.contains('krsw-dragging'), table.classList.contains('krsw-over')], [false, false]);
  await m.page.handleFiles([]);
});
await ta('붙여넣기: 클립보드에 파일(캡처한 그림)이 있으면 받고, 글을 붙여 넣는 것은 건드리지 않는다', async () => {
  const m = mount({ records: { 'image.png': TAXI } });
  const textPaste = m.send('paste', m.doc.body, 'clipboardData', { files: [] });
  assert.equal(textPaste.defaultPrevented, false);
  const paste = m.send('paste', m.doc.body, 'clipboardData', { files: [m.file('image.png')] });
  assert.equal(paste.defaultPrevented, true);
  await m.page.handleFiles([]);
  assert.deepEqual([m.rows('tr').length, m.val(m.rows('tr')[0], 'tr_transport')], [1, '기타(택시등)']);
});
await ta('"+ 증빙으로 입력"으로 고른 파일은 그 표에 놓은 것과 같다', async () => {
  const m = mount({ records: { 'cafe.png': CAFE } });
  const input = m.doc.getElementById('otherTbl').previousElementSibling.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [m.file('cafe.png')], configurable: true });
  input.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await m.page.handleFiles([]);
  assert.equal(m.val(m.rows('other')[0], 'other_total'), '5500');
});
await ta('숙박 줄의 첨부 칸에서 직접 고른 파일도 읽어 그 줄을 채운다 — 파일은 사람이 이미 붙였으니 다시 붙이지 않는다', async () => {
  const m = mount({ showFile: true, records: { 'a.png': HOTEL } });
  const add = m.doc.querySelector('button[onclick="addLodge()"]');
  add.click();
  add.click();
  const second = m.rows('lodge')[1];
  const input = second.querySelector('input[name="lodge_file"]');
  Object.defineProperty(input, 'files', { value: [m.file('a.png')], configurable: true });
  input.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await m.page.handleFiles([]);
  assert.deepEqual(m.rows('lodge').map((tr) => m.val(tr, 'lodge_company')), ['', '고양호텔']);
  assert.equal(m.attached.length, 0);
});

console.log('읽지 못할 때');
await ta('이미지·PDF 가 아니거나 10MB 를 넘으면 읽지 않는다', async () => {
  const m = mount({ records: { 'a.xlsx': HOTEL } });
  const big = m.file('big.png');
  Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
  await m.page.handleFiles([m.file('a.xlsx', 'application/vnd.ms-excel'), big]);
  assert.deepEqual(m.lines().map((l) => [l.state, l.msg]), [['error', '이미지나 PDF 가 아니라 읽지 않았습니다'], ['error', '너무 큽니다(11MB) — 10MB 이하로 넣어 주세요']]);
  assert.equal(m.seen.length, 0);
});
await ta('읽기에 실패하면 줄을 만들지 않고 까닭을 보여 준다. 다음 장은 계속 읽는다', async () => {
  const m = mount({ records: { 'ok.png': HOTEL } });
  await m.page.handleFiles([m.file('모름.png'), m.file('ok.png')]);
  assert.deepEqual(m.lines().map((l) => l.state), ['error', 'ok']);
  assert.match(m.lines()[0].msg, /Claude 연결/);
  assert.equal(m.rows('lodge').length, 1);
});
await ta('확장이 다시 올려져 끊겼으면 읽으러 가지 않고 새로고침하라고 한다', async () => {
  const m = mount({ records: { 'a.png': HOTEL }, alive: () => false });
  await m.page.handleFiles([m.file('a.png')]);
  assert.equal(m.seen.length, 0);
  assert.match(m.lines()[0].msg, /확장이 다시 올려져 이 화면과 끊겼습니다/);
});
await ta('사이트의 "+ ADD입력"이 줄을 만들지 못하면 채운 척하지 않는다', async () => {
  // 버튼은 있지만 눌러도 줄이 생기지 않는 화면(사이트가 바뀌었을 때).
  const m = mount({ records: { 'a.png': HOTEL }, html: PAGE().replace('onclick="addLodge()"', 'onclick="void addLodge"') });
  await m.page.handleFiles([m.file('a.png')]);
  assert.equal(m.rows('lodge').length, 0);
  assert.deepEqual([m.lines()[0].state, /줄을 추가하지 못했습니다/.test(m.lines()[0].msg)], ['error', true]);
});

console.log('확장 배선');
{
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
  const boot = fs.readFileSync(new URL('afterpage.js', root), 'utf8');
  t('콘텐츠 스크립트가 eclass 의 모든 프레임에 붙는다(이 화면은 포털 껍데기의 iframe 안에서도 열린다)', () => {
    const cs = (manifest.content_scripts || []).find((c) => c.js.includes('afterpage.js'));
    assert.ok(cs, 'content_scripts 에 afterpage.js 가 없다');
    assert.equal(cs.all_frames, true);
    assert.ok(cs.matches.includes('https://eclass.krs.co.kr/*'));
    assert.ok(!cs.js.includes('home.js'), '홈 카드까지 모든 프레임에 붙으면 안 된다');
  });
  t('시동 스크립트는 사후정산 입력 화면에서만 src/afterpage.js 를 불러 startAfterPage 를 부른다', () => {
    assert.match(boot, /businesstrip\\\/aftertrip/);
    assert.match(boot, /getURL\('src\/afterpage\.js'\)/);
    assert.match(boot, /startAfterPage\(document\)/);
    const re = /^\/businesstrip\/aftertrip(\/|$)/i;
    assert.deepEqual(['/BusinessTrip/AfterTrip', '/businesstrip/aftertrip/', '/BusinessTrip/AfterTrip/Save', '/BusinessTrip/AfterTripX', '/BusinessTrip/Write', '/eClassVer4/Home/Index'].map((p) => re.test(p)),
      [true, true, true, false, false, false]);
  });
  t('콘텐츠 스크립트가 src/ 모듈을 불러올 수 있다(web_accessible_resources)', () => {
    assert.ok((manifest.web_accessible_resources || []).some((w) => w.resources.includes('src/*.js') && w.matches.includes('https://eclass.krs.co.kr/*')));
  });
}

console.log('배경: 화면 대신 증빙을 읽어 준다');
{
  const png = { name: '영수증.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' };
  /** 배경을 새로 올리고 화면이 보내는 것과 같은 부탁을 보낸다. native 는 네이티브 다리의 답이다. */
  async function ask(msg, { native, store = {} } = {}) {
    const calls = { listeners: [], native: [] };
    globalThis.chrome = {
      sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
      runtime: {
        onMessage: { addListener: (fn) => calls.listeners.push(fn) },
        sendNativeMessage: async (host, body) => { calls.native.push(body); return native(body); },
      },
      storage: { local: { get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]])) } },
    };
    await import(`../background.js?bust=${Math.random()}`);
    const answer = await new Promise((resolve) => {
      assert.equal(calls.listeners.at(-1)(msg, { tab: { id: 1 } }, resolve), true, '답을 나중에 주겠다고 해야 한다');
    });
    return { answer, calls };
  }

  await ta('패널의 출장 카드와 같은 길(receiptSmart)로 읽고, 명세를 지난 기록만 돌려준다', async () => {
    const { answer, calls } = await ask({ type: 'receiptRead', file: png, ctx: { trip: { from: '2026-09-09', to: '2026-09-10', location: '고양' }, me: '홍길동' } },
      { native: () => ({ ok: true, data: { ...HOTEL, currency: 'GBP', junk: 1 } }) });
    assert.equal(answer.ok, true);
    assert.deepEqual([answer.via, answer.record.vendor, answer.record.total, answer.record.currency, 'junk' in answer.record], ['cli', '고양호텔', 143000, 'GBP', false]);
    assert.deepEqual([calls.native[0].task, calls.native[0].files[0].name], ['receipt', '영수증.png']);
    assert.match(calls.native[0].input, /출장 정보: 2026-09-09 ~ 2026-09-10 · 출장지 고양 · 출장자 홍길동/);
  });
  await ta('읽지 못하면 던지지 않고 까닭을 답한다', async () => {
    const { answer } = await ask({ type: 'receiptRead', file: png, ctx: {} }, { native: () => { throw new Error('Specified native messaging host not found.'); } });
    assert.equal(answer.ok, false);
    assert.match(answer.error, /증빙을 읽지 못했습니다 — 로컬 CLI 실패\(Specified native messaging host not found\.\)/);
  });
  await ta('파일이 없는 부탁은 Claude 를 부르지 않는다', async () => {
    const { answer, calls } = await ask({ type: 'receiptRead', file: { name: 'x' } }, { native: () => ({ ok: true, data: HOTEL }) });
    assert.deepEqual([answer, calls.native.length], [{ ok: false, error: '읽을 파일이 없습니다.' }, 0]);
  });
}

console.log('읽기 명세(input.yaml 의 receipt) — 이 화면이 기대는 것');
{
  const { TASKS, structure } = await import('../src/input.js');
  t('화폐는 화면의 목록을 받고, 교통수단(transport)을 읽으며, 기차·버스표의 구간도 읽게 한다', () => {
    const f = TASKS.receipt.fields;
    for (const cur of ['KRW', 'USD', 'SGD', 'GBP', 'HKD']) assert.ok(f.currency.values.includes(cur), cur);
    assert.deepEqual(f.transport.values, ['plane', 'train', 'subway', 'ship', 'bus', 'taxi']);
    assert.ok(TASKS.receipt.rules.some((r) => /기차표\(train_ticket\)·버스표\(bus_ticket\)도 항공권처럼/.test(r)));
    assert.ok(!TASKS.receipt.rules.some((r) => /docType 과 summary 만 적으면/.test(r)));
  });
  t('관문은 모르는 교통수단을 비우고 나머지는 살린다', () => {
    const out = structure('receipt', { ...TAXI, transport: 'rocket' }, { kind: 'trip' });
    assert.deepEqual([out.data.transport, out.data.total, out.data.docType], [null, 12400, 'other_receipt']);
    assert.equal(structure('receipt', TAXI, { kind: 'trip' }).data.transport, 'taxi');
  });
}

console.log(`\n통과 ${pass}건`);
