// 항공 마일리지 표(air-mileage.yaml → src/travelspec.js 의 AIR_MILEAGE)와 그것으로 신규 마일리지를 찾는 셈(src/mileage.js).
//
// 사후정산 "항공 마일리지"의 신규 마일리지는 항공권 문서에 적혀 있으면 그 값이고, 없으면 이 표에서 편마다 찾는다(2026-10-04 사용자 지정) —
// 구간 마일(일반석 편도, 100%) × 좌석 등급의 적립률. 일반석과 특실·비즈니스(프레스티지석)의 적립률이 다르다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'yaml';
import { checkMileage } from '../tools/gen-travel.mjs';
import { AIR_MILEAGE } from '../src/travelspec.js';
import { airlineOf, airportOf, isFirstSeat, milesOf, describeMiles } from '../src/mileage.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const clone = (x) => JSON.parse(JSON.stringify(x));

console.log('항공 마일리지 표');
t('확장이 쓰는 표는 air-mileage.yaml 그대로이고 모양이 맞다', () => {
  assert.deepEqual(AIR_MILEAGE, parse(fs.readFileSync(new URL('../references/air-mileage.yaml', import.meta.url), 'utf8')));
  assert.deepEqual(checkMileage(AIR_MILEAGE), []);
});
t('대한항공 국내선 — 김포·인천↔김해 215, 김포·인천↔제주 276마일. 적립률은 일반석 100% · 특실(프레스티지) 125%', () => {
  const ke = AIR_MILEAGE.airlines.find((a) => a.name === '대한항공');
  const of = (a, b) => ke.routes.find((r) => r.a === a && r.b === b)?.miles;
  assert.deepEqual([of('김포', '김해'), of('인천', '김해'), of('김포', '제주'), of('인천', '제주'), of('제주', '김해')], [215, 215, 276, 276, 186]);
  assert.deepEqual(ke.rates, { standard: 100, first: 125 });
});
t('틀린 표는 생성기가 잡는다 — 모르는 공항, 같은 구간 두 번, 틀린 마일·적립률, 빈 목록', () => {
  const bad = clone(AIR_MILEAGE);
  bad.airlines[0].routes.push({ a: '김포', b: '달', miles: 1 }, { a: '김해', b: '김포', miles: 215 }, { a: '김포', b: '광주', miles: 0 });
  bad.airlines[0].rates.first = -1;
  bad.airports.김포.code = 'gmp';
  assert.deepEqual(checkMileage(bad), [
    'air-mileage.yaml: airports.김포.code 는 영문 대문자 세 글자입니다',
    'air-mileage.yaml: 대한항공: rates.first 는 0 이상의 수(%)입니다',
    'air-mileage.yaml: 대한항공: airports 에 없는 공항이 있습니다(김포↔달)',
    'air-mileage.yaml: 대한항공: 같은 구간이 두 번 있습니다(김해↔김포)',
    'air-mileage.yaml: 대한항공 김포↔광주: miles 는 0 보다 큰 정수입니다',
  ]);
  assert.deepEqual(checkMileage({ airports: {}, first_seats: [], airlines: [] }),
    ['air-mileage.yaml: airports 가 비어 있습니다', 'air-mileage.yaml: first_seats 는 비어 있지 않은 글의 목록입니다', 'air-mileage.yaml: airlines 가 비어 있습니다']);
  assert.deepEqual(checkMileage(null), ['air-mileage.yaml: 내용이 없습니다']);
});
t('표에는 맞춰 볼 원본(source)과 사람이 맞춰 본 날(checked — 아직이면 null)을 적는다', () => {
  assert.match(AIR_MILEAGE.source, /^https:\/\//);
  assert.ok(AIR_MILEAGE.checked === null || /^\d{4}-\d{2}-\d{2}$/.test(AIR_MILEAGE.checked));
  assert.deepEqual(checkMileage({ ...clone(AIR_MILEAGE), source: 1, checked: '어제' }),
    ['air-mileage.yaml: source 는 출처 주소(글)입니다', 'air-mileage.yaml: checked 는 원본과 맞춰 본 날(YYYY-MM-DD)이거나 null 입니다']);
});

console.log('항공권의 글에서 항공사·공항·좌석 등급을 찾는다');
t('항공사 — 한국어 이름이나 영문 이름이 들어 있으면 그 항공사다. 표에 없는 항공사는 null', () => {
  assert.deepEqual(['대한항공', '대한항공(KE)', 'Korean Air', 'KOREAN AIR'].map((n) => airlineOf(n)?.name), ['대한항공', '대한항공', '대한항공', '대한항공']);
  assert.deepEqual([airlineOf('에어부산'), airlineOf('제주항공'), airlineOf(''), airlineOf(null)], [null, null, null, null]);
});
t('공항 — 공항 이름·코드가 먼저이고, 없을 때만 도시 이름을 본다', () => {
  assert.deepEqual(['김해', '부산(김해)', 'PUS', '부산', '김해공항', 'Busan'].map(airportOf), ['김해', '김해', '김해', '김해', '김해', '김해']);
  assert.deepEqual(['김포', '서울/김포', 'GMP', '서울', 'gmp'].map(airportOf), ['김포', '김포', '김포', '김포', '김포']);
  assert.deepEqual(['서울(인천)', '인천공항', 'ICN'].map(airportOf), ['인천', '인천', '인천'], '서울이 먼저 적혀 있어도 공항 이름이 이긴다');
  assert.deepEqual(['제주', '진주', '포항경주', '순천', '나리타', '', null].map(airportOf), ['제주', '사천', '포항', '여수', '', '', '']);
});
t('좌석 등급 — 프레스티지·비즈니스·일등석·특실이면 특실 쪽이다', () => {
  assert.deepEqual(['프레스티지석', '비즈니스', 'Prestige', 'BUSINESS', '일등석', '특실'].map(isFirstSeat), [true, true, true, true, true, true]);
  assert.deepEqual(['일반석', 'Economy', '이코노미', '', null].map(isFirstSeat), [false, false, false, false, false]);
});

console.log('한 편의 적립 마일리지');
t('구간 마일 × 적립률 — 일반석은 구간 마일 그대로, 특실은 125%(마일 미만은 반올림). 구간은 방향이 없다', () => {
  assert.deepEqual(milesOf({ airline: '대한항공', dep: '김해', arr: '김포' }), { miles: 215, base: 215, rate: 100, airline: '대한항공', a: '김해', b: '김포', grade: 'standard' });
  assert.deepEqual(milesOf({ airline: '대한항공', dep: '김포', arr: '부산', first: true }), { miles: 269, base: 215, rate: 125, airline: '대한항공', a: '김포', b: '김해', grade: 'first' });
  assert.deepEqual([milesOf({ airline: 'Korean Air', dep: 'GMP', arr: 'CJU' }).miles, milesOf({ airline: '대한항공', dep: '제주', arr: '서울', first: true }).miles], [276, 345]);
});
t('표에 없는 항공사·구간이면 null 이다 — 짐작으로 채우지 않는다', () => {
  assert.equal(milesOf({ airline: '에어부산', dep: '김해', arr: '김포' }), null, '표에 없는 항공사');
  assert.equal(milesOf({ airline: '대한항공', dep: '김포', arr: '대구' }), null, '표에 없는 구간');
  assert.equal(milesOf({ airline: '대한항공', dep: '인천', arr: '나리타' }), null, '모르는 공항');
  assert.equal(milesOf({ airline: '대한항공', dep: '김포', arr: '서울' }), null, '같은 공항');
  assert.equal(milesOf({}), null);
});
t('한 마디로 — 일반석은 마일만, 특실은 셈까지 적는다', () => {
  assert.equal(describeMiles(milesOf({ airline: '대한항공', dep: '김해', arr: '김포' })), '대한항공 김해→김포 215마일');
  assert.equal(describeMiles(milesOf({ airline: '대한항공', dep: '김포', arr: '김해', first: true })), '대한항공 김포→김해 특실 269마일(215 × 125%)');
});

console.log(`\n통과 ${pass}건`);
