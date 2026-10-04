// 여비계산서(사전정산): 규칙·운임 문서가 생성물과 같은지, 식비·일비·교통편 셈, 사이트 화면 읽기, 저장 요청 짓기,
// 그리고 올리는 흐름(이미 있으면 안 올리고, 올린 뒤 목록으로 확인한다).
//
//   travel-rules.yaml + ktx-fares.yaml(손으로 고치는 운임) + ktx-fares-official.yaml(코레일 공식 운임표)
//     ──(tools/gen-travel.mjs)──▶ src/travelspec.js ──▶ src/travel.js ──▶ src/trip.js
//
// 사이트 화면의 모양(목록 #mainList, 작성 폼 #frm, 요금표의 uf_rtnFee)은 2026-10-02 실제 화면에서 받은 것을 줄여 지었다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { render, checkRules, checkFares, mergeFares, withHours } from '../tools/gen-travel.mjs';
import { TRAVEL_RULES, KTX_FARES } from '../src/travelspec.js';
import {
  TRANSPORTS, DEFAULT_TRANSPORT, TRAIN_GRADES, DEFAULT_GRADE, stationOf, isWeekend, fareOf, hoursOf, legTimes, mealsOf, dailyOf, settlePlan, describePlan,
  parseTripList, tripListPages, tripUser, tripStage, tripDocFor, formFields, saveBody, parseFeeRows, pickFeeRow,
  tripIconState, transportsOf, trainGradeOf, nextTransport, nextLegPick, parseTransRows, pickOfRow, legsOfRows, ticketsOf, seatTickets,
  picksWithTickets, legPlan, describeTrans, sameTrans,
} from '../src/travel.js';
import { blankForm, settle } from '../src/attend.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const dom = (html) => new JSDOM(html).window.document;
const clone = (x) => JSON.parse(JSON.stringify(x));

console.log('규칙·운임 문서');
t('src/travelspec.js 는 네 YAML(규칙 · 손으로 고치는 운임 · 공식 운임표 · 항공 마일리지 표)로 만든 그대로다 (어긋났으면 node tools/gen-travel.mjs)', () =>
  assert.equal(read('src/travelspec.js'), render(read('travel-rules.yaml'), read('ktx-fares.yaml'), read('ktx-fares-official.yaml'), read('air-mileage.yaml'))));
t('KTX 운임은 두 파일이다 — 손으로 고치는 파일(ktx-fares.yaml)에 적은 구간이 공식 표의 같은 구간을 이기고, 공식 표에 없는 구간은 더해진다', () => {
  const official = { basis: '2026-09-01', routes: [{ a: '서울', b: '부산', standard: 54400, first: 78900 }, { a: '서울', b: '대전', standard: 21600, first: 31300 }] };
  const hand = { version: 1, weekend_days: ['금'], places: {}, routes: [
    { a: '부산', b: '서울', standard: 55000, first: 79800, note: '방향을 바꿔 적어도 같은 구간이다' },
    { a: '서울', b: '강릉', standard: 27600, first: null, source: 'observed' },
  ] };
  const { fares, errors } = mergeFares(hand, official);
  assert.deepEqual(errors, []);
  assert.deepEqual(fares.routes.map((r) => [r.a, r.b, r.standard, r.first, r.source]), [
    ['부산', '서울', 55000, 79800, 'manual'], ['서울', '대전', 21600, 31300, 'official'], ['서울', '강릉', 27600, null, 'observed'],
  ], '고친 구간은 공식 표의 그 자리에, 더한 구간은 뒤에 온다');
  assert.deepEqual([fares.basis, fares.weekend_days, checkFares(fares)], ['2026-09-01', ['금'], []]);
  assert.deepEqual(mergeFares({ routes: [] }, official).fares.routes.map((r) => r.source), ['official', 'official'], '비어 있으면 공식 표 그대로다');
  assert.deepEqual(mergeFares({ routes: [hand.routes[0], { a: '서울', b: '부산', standard: 1, first: null }] }, official).errors,
    ['ktx-fares.yaml: 같은 구간이 두 번 있습니다(서울↔부산)']);
});
t('지금 손으로 고친 구간은 없다 — 운임은 모두 공식 표의 값이다', () =>
  assert.deepEqual(KTX_FARES.routes.filter((r) => r.source !== 'official'), []));
t('구간마다 대략 소요 시간(hours)을 운임 옆에 붙인다 — 이웃한 역 사이의 분을 이어 가장 빠른 길에 여유를 더해 시간 단위로 올린다(가장 짧아도 1시간)', () => {
  const routes = [{ a: '서울', b: '대전', standard: 21600 }, { a: '서울', b: '부산', standard: 54400 }, { a: '대전', b: '부산', standard: 33100 },
    { a: '부산', b: '울산', standard: 7500 }, { a: '울산', b: '서울', standard: 48400 }];
  const times = { min_hours: 1, margin_minutes: 10, routes: [], links: [['서울', '대전', 65], ['대전', '울산', 82], ['울산', '부산', 25]] };
  const run = (over = {}, rs = routes) => withHours({ version: 1, routes: rs, times: { ...times, ...over } });
  const hours = (r) => r.fares.routes.map((x) => x.hours);
  const plain = run();
  assert.deepEqual([plain.errors, hours(plain)], [[], [2, 4, 2, 1, 3]], '65+10분 → 2 · 172+10분 → 4 · 107+10분 → 2 · 25+10분 → 1 · 147+10분 → 3');
  assert.deepEqual([Object.keys(plain.fares), plain.fares.routes[1]], [['version', 'routes'], { a: '서울', b: '부산', standard: 54400, hours: 4 }], '확장에는 구간의 hours 만 간다(times 는 뺀다)');
  assert.deepEqual([hours(run({ margin_minutes: 20 })), hours(run({ min_hours: 2 }))], [[2, 4, 3, 1, 3], [2, 4, 2, 2, 3]]);
  const fixed = { routes: [{ a: '부산', b: '대전', hours: 3 }] };
  assert.deepEqual(hours(run(fixed)), [2, 4, 3, 1, 3], 'times.routes 에 적은 구간은 그 값이다(방향은 가리지 않는다)');
  assert.equal(run(fixed, routes.map((r, i) => (i === 2 ? { ...r, hours: 5 } : r))).fares.routes[2].hours, 5, '구간에 hours 를 바로 적었으면 그것이 가장 먼저다');
});
t('틀린 소요 시간 설정은 생성기가 받지 않는다 — times 가 없거나, 이어지지 않는 구간이 있거나, 모르는 역·틀린 값이 있으면', () => {
  const routes = [{ a: '서울', b: '대전', standard: 21600 }, { a: '대전', b: '부산', standard: 33100 }];
  const times = { min_hours: 1, margin_minutes: 10, routes: [], links: [['서울', '대전', 65], ['대전', '부산', 107]] };
  const errors = (over) => withHours({ routes, times: { ...times, ...over } }).errors.map((e) => e.replace(/^ktx-fares.yaml: times: /, ''));
  assert.deepEqual(withHours({ routes }).errors, ['ktx-fares.yaml: times 가 없습니다(구간의 대략 소요 시간)']);
  assert.deepEqual(errors({ links: [['서울', '대전', 65]] }), ['대전↔부산: links 로 이어지지 않아 소요 시간을 셈할 수 없습니다']);
  assert.deepEqual(errors({ links: [...times.links, ['서울', '제주', 60], ['부산', '서울', 0], ['대전', '서울', 70]] }),
    ['links: 운임표에 없는 역이 있습니다(["서울","제주",60])', 'links: 분은 0 보다 큰 정수입니다(부산↔서울)', 'links: 같은 구간이 두 번 있습니다(대전↔서울)']);
  assert.deepEqual(errors({ min_hours: 0, margin_minutes: -5 }), ['min_hours 는 1~23 의 정수(시간)입니다', 'margin_minutes 는 0 이상의 정수(분)입니다']);
  assert.deepEqual(errors({ routes: [{ a: '서울', b: '부산', hours: 4 }, { a: '서울', b: '대전', hours: 0 }, { a: '부산', b: '대전', hours: 2 }, { a: '대전', b: '부산', hours: 3 }] }),
    ['routes: 운임표에 없는 구간입니다(서울↔부산)', 'routes: hours 는 1~23 의 정수(시간)입니다(서울↔대전)', 'routes: 같은 구간이 두 번 있습니다(대전↔부산)']);
  const fares = clone(KTX_FARES);
  fares.routes[0].hours = 0;
  assert.deepEqual(checkFares(fares), [`ktx-fares.yaml: ${fares.routes[0].a}↔${fares.routes[0].b}: hours 는 1~23 의 정수(시간)입니다`]);
});
t('규칙: 당일은 당일출장(주재국)·사무실소재지외, 1박 이상은 일반출장. 아침은 7시 이하 출발, 저녁은 20시 이상 도착', () => {
  assert.deepEqual([TRAVEL_RULES.period.day_trip.code, TRAVEL_RULES.period.day_trip.area, TRAVEL_RULES.period.general.code], ['1', 'O', '0']);
  assert.deepEqual([TRAVEL_RULES.meals.breakfast.first_day_depart_hour_at_most, TRAVEL_RULES.meals.dinner.last_day_arrive_hour_at_least], [7, 20]);
});
t('교통편은 기차·비행기·버스이고 기본은 기차다 — 교통편 내역을 자동으로 넣는 것은 기차뿐이다', () => {
  assert.deepEqual(TRANSPORTS.map((x) => [x.value, x.site, x.auto]), [['train', 'Train', true], ['plane', 'Airplane', false], ['bus', 'Bus', false]]);
  assert.equal(DEFAULT_TRANSPORT, 'train');
});
t('기차의 좌석 등급은 일반석(기본)과 특실이다 — 여비계산서 "등급" 칸에 그 이름을 적는다', () => {
  assert.deepEqual(TRAIN_GRADES, [{ value: 'standard', label: '일반석' }, { value: 'first', label: '특실' }]);
  assert.equal(DEFAULT_GRADE, 'standard');
  const rules = clone(TRAVEL_RULES);
  delete rules.transport.train.grade_labels.first;
  assert.deepEqual(checkRules(rules), ['travel-rules.yaml: transport.train.grade_labels.first 이 없습니다']);
});
t('교통편 아이콘: 여럿을 함께 고를 수 있다. 기차는 한 번 더 누르면 특실, 또 누르면 꺼진다 — 마지막 하나는 꺼지지 않는다', () => {
  const press = (form, ...values) => values.reduce((f, v) => ({ ...f, ...nextTransport(f, v) }), form);
  const start = { transport: ['train'], trainGrade: 'standard' };
  const show = (f) => [transportsOf(f), trainGradeOf(f)];
  assert.deepEqual(show(press(start, 'train')), [['train'], 'first'], '한 번 더 누르면 특실');
  assert.deepEqual(show(press(start, 'train', 'train')), [['train'], 'standard'], '기차 하나뿐이면 꺼지지 않고 일반석으로 돌아간다');
  assert.deepEqual(show(press(start, 'plane')), [['train', 'plane'], 'standard'], '기차와 비행기를 함께 고른다');
  assert.deepEqual(show(press(start, 'plane', 'train', 'train')), [['plane'], 'standard'], '다른 것이 켜져 있으면 일반석 → 특실 → 꺼짐');
  assert.deepEqual(show(press(start, 'plane', 'plane')), [['train'], 'standard'], '비행기는 켜고 끈다');
  assert.deepEqual(show(press({ transport: ['plane'] }, 'plane')), [['plane'], 'standard'], '마지막 하나는 꺼지지 않는다');
  assert.deepEqual(show(press(start, 'bus', 'plane')), [['train', 'plane', 'bus'], 'standard'], '고른 차례가 아니라 선택지 차례로 담긴다');
  assert.deepEqual(show(press(start, 'ship')), [['train'], 'standard'], '모르는 값은 무시한다');
  assert.deepEqual([transportsOf({ transport: 'bus' }), transportsOf({}), trainGradeOf({ trainGrade: 'x' })], [['bus'], [], 'standard'], '예전 폼의 글 하나도 받는다');
});
t('틀린 규칙·운임표는 생성기가 받지 않는다', () => {
  const rules = clone(TRAVEL_RULES);
  rules.meals.dinner.last_day_arrive_hour_at_least = 25;
  rules.transport.default = 'ship';
  assert.equal(checkRules(rules).length, 2);
  const fares = clone(KTX_FARES);
  fares.routes.push({ a: '서울', b: '부산', standard: 1, first: null, source: 'official' }, { a: '부산', b: '대구', standard: 0, source: 'guess' });
  fares.places['제주'] = '제주';
  fares.airports.CJU = '제주';
  assert.deepEqual(checkFares(fares).map((e) => e.replace(/^ktx-fares.yaml: /, '').split(':')[0]),
    ['같은 구간이 두 번 있습니다(서울↔부산)', '부산↔대구', '부산↔대구', 'places.제주', 'airports.CJU']);
  assert.deepEqual([checkRules(TRAVEL_RULES), checkFares(KTX_FARES)], [[], []]);
});

console.log('역과 운임');
t('적어 둔 곳에서 탈 역을 찾는다 — 역 이름이 들어 있으면 그 역, 없으면 길잡이(places), 모르면 빈 글', () => {
  assert.equal(stationOf('부산 본사'), '부산');
  assert.equal(stationOf('경기도 고양시 킨텍스'), '서울');
  assert.equal(stationOf('동대구역'), '동대구', '같은 자리에서 시작하면 긴 이름이다("대구" 보다 "동대구")');
  assert.equal(stationOf('대구'), '동대구');
  assert.equal(stationOf('세종'), '오송');
  assert.equal(stationOf('제주'), '');
  assert.equal(stationOf(''), '');
});
t('글에 역 이름이 여럿이면 먼저 나오는 것이다(주소는 큰 곳부터 적는다) — 역 이름과 같은 길잡이가 있으면 길잡이가 이긴다', () => {
  assert.equal(stationOf('서울 영등포구 여의도'), '서울', '영등포역이 아니라 서울역');
  assert.equal(stationOf('부산 구포동'), '부산');
  assert.equal(stationOf('영등포'), '영등포');
  assert.equal(stationOf('창원'), '창원중앙', '"창원" 은 창원역이 아니라 창원중앙역으로 본다');
  assert.equal(stationOf('창원역'), '창원중앙');
  assert.equal(stationOf('전남 여수시'), '여수엑스포');
  assert.equal(stationOf('서대전역'), '서대전');
});
t('운임은 방향이 없다. 운임표에 없는 구간·모르는 등급은 null 이다 (짐작으로 채우지 않는다)', () => {
  assert.deepEqual(fareOf('부산', '서울', '2026-10-07'), { fare: 54400, weekend: false, source: 'official' });
  assert.equal(fareOf('서울', '부산', '2026-10-07').fare, 54400);
  assert.equal(fareOf('부산', '서울', '2026-10-07', 'first').fare, 78900);
  assert.equal(fareOf('부산', '목포', '2026-10-07'), null, '운임표에 없는 구간');
  const route = KTX_FARES.routes.find((r) => r.a === '대전' && r.b === '부산');
  const first = route.first;
  route.first = null;
  try {
    assert.equal(fareOf('부산', '대전', '2026-10-07', 'first'), null, '특실 값을 모르는 구간');
    assert.equal(fareOf('부산', '대전', '2026-10-07').fare, 33100);
  } finally {
    route.first = first;
  }
});
t('운임표는 코레일 공식 KTX 운임표(2026-09-01)에서 가져온 것이다 — 구간마다 일반실과 특실 정가가 있고, 경유하는 길이 여럿이면 가장 큰 값이다', () => {
  assert.ok(KTX_FARES.routes.length > 500);
  assert.ok(KTX_FARES.routes.every((r) => r.source === 'official' && r.first > r.standard), '모든 구간에 특실 값이 있다');
  const both = (a, b) => [fareOf(a, b, '2026-10-07').fare, fareOf(a, b, '2026-10-07', 'first').fare];
  assert.deepEqual([both('서울', '부산'), both('수서', '부산'), both('부산', '대전'), both('서울', '대전'), both('용산', '광주송정'), both('부산', '동대구')],
    [[54400, 78900], [52900, 76700], [33100, 48000], [21600, 31300], [42000, 60900], [15600, 22600]]);
  assert.deepEqual(both('서울', '경주'), [44500, 64500], '서대구·수원을 도는 열차의 값(44,000 · 38,000)이 아니라 고속선의 값');
  assert.equal(fareOf('서울', '강릉', '2026-10-07'), null, 'KTX-이음 노선(특실이 없다)은 넣지 않았다');
});
t('주말 운임을 따로 적지 않은 구간은 평일·주말이 같다. 적어 두면 금·토·일에는 그 값이다', () => {
  assert.deepEqual([isWeekend('2026-10-07'), isWeekend('2026-10-09'), isWeekend('2026-10-11'), isWeekend('2026-10-12')], [false, true, true, false]);
  assert.deepEqual(fareOf('부산', '서울', '2026-10-10'), { fare: 54400, weekend: false, source: 'official' });
  const route = KTX_FARES.routes.find((r) => r.a === '서울' && r.b === '부산');
  route.weekend = { standard: 56000, first: null };
  try {
    assert.deepEqual([fareOf('부산', '서울', '2026-10-10').fare, fareOf('부산', '서울', '2026-10-07').fare], [56000, 54400]);
    assert.equal(fareOf('부산', '서울', '2026-10-10', 'first').fare, 78900, '주말 특실을 안 적었으면 평일 값이다');
  } finally {
    delete route.weekend;
  }
});

t('구간의 대략 소요 시간은 운임 옆에 적혀 있다 — 서울↔부산처럼 2시간 30분 ~ 3시간 20분이면 4시간, 가장 짧아도 1시간 (2026-10-03 사용자 지정)', () => {
  assert.ok(KTX_FARES.routes.every((r) => Number.isInteger(r.hours) && r.hours >= 1), '모든 구간에 시간이 있다');
  assert.equal('times' in KTX_FARES, false, '이웃한 역 사이의 분(times)은 생성기만 쓴다');
  assert.deepEqual([hoursOf('서울', '부산'), hoursOf('부산', '서울'), hoursOf('부산', '수서')], [4, 4, 4]);
  assert.deepEqual(['광명', '천안아산', '오송', '대전', '동대구', '울산'].map((s) => hoursOf('부산', s)), [3, 3, 3, 2, 2, 1]);
  assert.deepEqual([hoursOf('서울', '대전'), hoursOf('서울', '광명'), hoursOf('용산', '광주송정'), hoursOf('용산', '여수엑스포'), hoursOf('서울', '진주')], [2, 1, 3, 4, 4]);
  assert.equal(hoursOf('부산', '목포'), null, '운임표에 없는 구간');
});
t('교통편 줄의 출발·도착 시: 가는 편은 출장 출발 시각에 떠나 소요 시간 뒤에 닿고, 오는 편은 도착 시각에 닿게 그만큼 앞서 떠난다', () => {
  const when = { sHour: 7, eHour: 20 };
  const ktx = (dep, arr, over) => ({ dep, arr, transport: 'Train', ...over });
  assert.deepEqual([legTimes('go', ktx('부산', '서울'), when), legTimes('back', ktx('서울', '부산'), when)], [{ shr: 7, ehr: 11 }, { shr: 16, ehr: 20 }]);
  assert.deepEqual([legTimes('go', ktx('부산', '대전'), when), legTimes('back', ktx('대전', '부산'), when)], [{ shr: 7, ehr: 9 }, { shr: 18, ehr: 20 }]);
  assert.deepEqual([legTimes('go', ktx('부산', '서울', { shr: 8, ehr: 0 }), when), legTimes('back', ktx('서울', '부산', { shr: 15, ehr: 19 }), when)],
    [{ shr: 8, ehr: 12 }, { shr: 15, ehr: 19 }], '줄에 이미 적힌 시각은 그대로 두고 빈 쪽(0시)만 채운다');
  assert.deepEqual([legTimes('go', ktx('부산', '서울'), { sHour: 21, eHour: 23 }), legTimes('back', ktx('서울', '부산'), { sHour: 0, eHour: 2 })],
    [{ shr: 21, ehr: 23 }, { shr: 0, ehr: 2 }], '하루를 넘기지 않는다');
  assert.deepEqual([legTimes('go', { dep: '부산', arr: '서울', transport: 'Bus' }, when), legTimes('back', ktx('목포', '부산'), when)],
    [{ shr: 7, ehr: null }, { shr: null, ehr: 20 }], '소요 시간을 모르는 줄(다른 교통편, 운임표에 없는 구간)은 아는 쪽만 적는다');
  assert.deepEqual(legTimes('go', ktx('부산', '서울')), { shr: null, ehr: null }, '출장 시각을 모르면 비워 둔다');
});

console.log('식비·일비');
t('식수: 점심은 날마다, 아침은 7시 이하 출발, 저녁은 20시 이상 도착일 때만 — 2일 7시→20시는 6, 16시 도착이면 5', () => {
  assert.equal(mealsOf({ days: 2, startHour: 7, endHour: 20 }), 6);
  assert.equal(mealsOf({ days: 2, startHour: 7, endHour: 16 }), 5);
  assert.equal(mealsOf({ days: 2, startHour: 9, endHour: 16 }), 4);
  assert.equal(mealsOf({ days: 2, startHour: 8, endHour: 20 }), 5, '8시 출발은 아침이 없다');
  assert.equal(mealsOf({ days: 2, startHour: 6, endHour: 19 }), 5, '19시 도착은 저녁이 없다');
  assert.equal(mealsOf({ days: 3, startHour: 7, endHour: 20 }), 9);
  assert.equal(mealsOf({ days: 1, startHour: 9, endHour: 18 }), 1, '하루짜리는 점심 한 끼');
});
t('일비는 일수 그대로다', () => assert.deepEqual([dailyOf(1), dailyOf(2), dailyOf(5)], [1, 2, 5]));

console.log('사전정산 초안');
const trip = (over) => settle({ ...blankForm('trip', '2026-10-02'), dateFrom: '2026-10-20', purpose: '착수회의 참석', settle: true, place: '대전', workplace: '부산 본사', ...over });
t('당일 출장: 당일출장(주재국)·사무실소재지외, 일비·식비 내역은 없다. KTX 두 줄이 같은 날이다', () => {
  const p = settlePlan(trip({}));
  assert.deepEqual([p.period, p.periodLabel, p.area, p.sDate, p.eDate, p.sHour, p.eHour, p.stay, p.nation, p.method],
    ['1', '당일출장(주재국)', 'O', '2026-10-20', '2026-10-20', 7, 20, null, 'KR||', 'E']);
  assert.deepEqual(p.trans.map((r) => [r.date, r.dep, r.arr, r.transport, r.grade, r.total, r.currency]),
    [['2026-10-20', '부산', '대전', 'Train', '일반석', 33100, 'KRW'], ['2026-10-20', '대전', '부산', 'Train', '일반석', 33100, 'KRW']]);
  assert.deepEqual(p.trans.map((r) => [r.shr, r.ehr]), [[7, 9], [18, 20]], '부산↔대전 2시간 — 07시에 떠나 09시에 닿고, 18시에 떠나 20시에 닿는다');
  assert.deepEqual([p.location, p.purpose, p.notes], ['대전', '착수회의 참석', []]);
  assert.equal(describePlan(p), '당일출장(주재국) · 대전 · KTX 부산↔대전 일반석 33,100원 × 2');
});
t('1박 2일: 일반출장, 일수 2·일비 2·식수 6. 가는 길은 출발일, 오는 길은 도착일이다', () => {
  const p = settlePlan(trip({ days: 2, place: '경기도 고양시 킨텍스' }));
  assert.deepEqual([p.period, p.periodLabel, p.area, p.eDate], ['0', '일반출장', '', '2026-10-21']);
  assert.deepEqual(p.stay, { region: 'KR||', day: 2, daily: 2, meal: 6 });
  assert.deepEqual(p.trans.map((r) => [r.date, r.dep, r.arr, r.total]), [['2026-10-20', '부산', '서울', 54400], ['2026-10-21', '서울', '부산', 54400]]);
  assert.deepEqual(p.trans.map((r) => [r.shr, r.ehr]), [[7, 11], [16, 20]], '부산↔서울 4시간 — 부산 07시 → 서울 11시, 서울 16시 → 부산 20시');
  assert.deepEqual(settlePlan(trip({ days: 2, place: '서울', start: '09:00', end: '18:00' })).trans.map((r) => [r.shr, r.ehr]), [[9, 13], [14, 18]]);
  assert.equal(p.location, '경기도 고양시 킨텍스', '출장지는 적은 그대로 올라간다');
  assert.equal(describePlan(p), '일반출장 · 경기도 고양시 킨텍스 · 일비 2일 · 식비 6식 · KTX 부산↔서울 일반석 54,400원 × 2');
  assert.equal(settlePlan(trip({ days: 2, end: '16:00' })).stay.meal, 5);
});
t('교통편 내역을 못 넣으면 비워 두고 까닭을 말한다 — 비행기·버스, 모르는 역, 운임표에 없는 구간', () => {
  const bus = settlePlan(trip({ transport: 'bus' }));
  assert.deepEqual([bus.trans, bus.notes], [[], ['버스는 요금이 그때그때 달라 교통편 내역은 비워 둡니다']]);
  assert.match(settlePlan(trip({ place: '제주' })).notes[0], /출장지 "제주" 에서 내릴 KTX 역을 찾지 못해/);
  assert.match(settlePlan(trip({ workplace: '' })).notes[0], /근무지 "" 에서 탈 KTX 역을 찾지 못해/);
  assert.match(settlePlan(trip({ place: '목포' })).notes[0], /부산↔목포 구간이 없어/);
  assert.match(settlePlan(trip({ place: '부산시청' })).notes[0], /같은 역\(부산\)/);
  assert.equal(describePlan(bus), '당일출장(주재국) · 대전 · 교통편 내역 없음');
});
t('기차를 특실로 고르면 특실 운임이 들어간다 — 그 구간의 특실 값을 모르면 비워 두고 그렇다고 말한다(짐작으로 채우지 않는다)', () => {
  const p = settlePlan(trip({ place: '서울', trainGrade: 'first' }));
  assert.deepEqual(p.trans.map((r) => [r.dep, r.arr, r.transport, r.grade, r.total]), [['부산', '서울', 'Train', '특실', 78900], ['서울', '부산', 'Train', '특실', 78900]]);
  assert.deepEqual([p.transports, p.grade], [['train'], 'first']);
  assert.equal(describePlan(p), '당일출장(주재국) · 서울 · KTX 부산↔서울 특실 78,900원 × 2');
  assert.equal(describePlan(settlePlan(trip({ trainGrade: 'first' }))), '당일출장(주재국) · 대전 · KTX 부산↔대전 특실 48,000원 × 2');
  // 특실 값이 빠진 구간(지금 운임표에는 없지만, 손으로 더한 구간이 그럴 수 있다)
  const route = KTX_FARES.routes.find((r) => r.a === '대전' && r.b === '부산');
  const first = route.first;
  route.first = null;
  try {
    const unknown = settlePlan(trip({ trainGrade: 'first' }));
    assert.deepEqual([unknown.trans, unknown.notes], [[], ['KTX 운임표(ktx-fares.yaml)에 부산↔대전 특실 운임이 없어 교통편 내역은 비워 둡니다']]);
    assert.equal(describePlan(unknown), '당일출장(주재국) · 대전 · 교통편 내역 없음(부산↔대전 특실 운임 모름)');
  } finally {
    route.first = first;
  }
});
t('기차와 비행기를 함께 고르면 어느 편이 무엇인지 신청할 때는 알 수 없어 비워 둔다 — 다녀와서 신청 내역에서 고른다', () => {
  const p = settlePlan(trip({ transport: ['train', 'plane'] }));
  assert.deepEqual([p.trans, p.transports], [[], ['train', 'plane']]);
  assert.match(p.notes[0], /^기차\(KTX\)·비행기를 함께 골라 어느 편이 무엇인지 아직 알 수 없어 교통편 내역은 비워 둡니다 — 다녀온 뒤 신청 내역의 출장 카드에서/);
  assert.equal(describePlan(p), '당일출장(주재국) · 대전 · 교통편 내역 없음(가는 편·오는 편은 다녀와서 신청 내역에서 고름)');
  assert.deepEqual(settlePlan(trip({ transport: ['plane'] })).notes, ['비행기는 요금이 그때그때 달라 교통편 내역은 비워 둡니다']);
});

console.log('가는 편·오는 편 — 신청 내역의 출장 카드에서 고르는 것(사후정산의 교통비 내역)');
{
  const TRIP2 = { from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시 킨텍스' };
  const DAY1 = { from: '2026-09-09', to: '2026-09-09', location: '서울' };
  const ROWS = [
    { seq: '153340', trseq: '7380', revno: '', date: '2026-09-09', dep: '부산', arr: '서울', transport: 'Train', grade: '일반석', total: 53700, currency: 'KRW', shr: 7, ehr: 0 },
    { seq: '153341', trseq: '7380', revno: '', date: '2026-09-09', dep: '서울', arr: '부산', transport: 'Train', grade: '일반석', total: 53700, currency: 'KRW', shr: 0, ehr: 20 },
  ];
  // 출발·도착 시(tr_shr·tr_ehr)는 0~23 을 고르는 칸이다 — 고르지 않은 줄은 0 이다.
  const HOURS = (name, on) => `<select name="${name}">${[0, 7, 20].map((h) => `<option value='${h}'${h === on ? ' selected="selected"' : ''}>${h}</option>`).join('')}</select> 시`;
  const TR = (r, del = '0') => `<tr><td><input type="hidden" name="tr_seq" value="${r.seq}"/><input type="hidden" name="tr_del" value="${del}"/>
<input type="hidden" name="tr_trseq" value="${r.trseq}"/><input type="hidden" name="tr_revno" value=""/><input type="hidden" name="tr_smn" value="0"/><input type="hidden" name="tr_emn" value="0"/>
<input type="date" name="tr_date" value="${r.date}"/></td>
<td><input type="text" name="tr_dep" value="${r.dep}"/></td><td>${HOURS('tr_shr', r.shr)}</td><td><input type="text" name="tr_arr" value="${r.arr}"/></td><td>${HOURS('tr_ehr', r.ehr)}</td>
<td><select name="tr_transport"><option value="Train"${r.transport === 'Train' ? ' selected="selected"' : ''}>기차(KTX등)</option><option value="Subway">지하철</option>
<option value="Bus">버스</option><option value="Airplane"${r.transport === 'Airplane' ? ' selected="selected"' : ''}>비행기</option></select></td>
<td><input type="text" name="tr_grade" value="${r.grade}" size="4"></td><td><input type="text" name="tr_total" value="${r.total}" readonly /></td>
<td><select name="tr_currency"><option value="KRW" selected="selected">KRW</option><option value="USD">USD</option></select></td></tr>`;
  const page = (rows) => dom(`<html><body><form id="frm"><input type="hidden" name="seq" value="145580"><table><tbody id="transBody">${rows}</tbody></table></form></body></html>`);
  t('사전정산 작성 화면의 교통편 줄을 읽는다 — 지움 표시가 된 줄은 빼고, 줄이 없으면 빈 목록이다 (2026-10-03 실제 화면의 줄 모양)', () => {
    assert.deepEqual(parseTransRows(page(ROWS.map((r) => TR(r)).join('') + TR({ ...ROWS[0], seq: '9' }, '1'))), ROWS);
    assert.deepEqual(parseTransRows(page('')), []);
    assert.deepEqual(parseTransRows(page(TR({ ...ROWS[0], total: '53,700' })))[0].total, 53700);
  });
  t('사전정산의 줄이 가는 편·오는 편이다 — 첫 줄이 가는 편, 둘째 줄이 오는 편. 한 줄뿐이면 날짜가 도착일일 때만 오는 편이다', () => {
    assert.deepEqual(legsOfRows(ROWS, TRIP2), { go: ROWS[0], back: ROWS[1], extra: 0 });
    assert.deepEqual(legsOfRows([], TRIP2), { go: null, back: null, extra: 0 });
    assert.deepEqual(legsOfRows([{ ...ROWS[1], date: '2026-09-10' }], TRIP2).go, null);
    assert.deepEqual(legsOfRows([ROWS[0]], TRIP2).back, null);
    assert.equal(legsOfRows([...ROWS, ROWS[0]], TRIP2).extra, 1);
    assert.deepEqual([pickOfRow(ROWS[0]), pickOfRow({ transport: 'Train', grade: '특실' }), pickOfRow({ transport: 'Airplane', grade: 'E' }), pickOfRow({ transport: 'Subway' }), pickOfRow(null)],
      [{ t: 'train', g: 'standard' }, { t: 'train', g: 'first' }, { t: 'plane', g: 'standard' }, { t: '', g: 'standard' }, null]);
  });
  t('카드에서 편의 아이콘을 누르면: 다른 교통편이면 그것으로, 기차·비행기를 한 번 더 누르면 특실, 또 누르면 일반석', () => {
    assert.deepEqual(nextLegPick({ t: 'train', g: 'standard' }, 'plane'), { t: 'plane', g: 'standard' });
    assert.deepEqual(nextLegPick({ t: 'train', g: 'standard' }, 'train'), { t: 'train', g: 'first' });
    assert.deepEqual(nextLegPick({ t: 'train', g: 'first' }, 'train'), { t: 'train', g: 'standard' });
    assert.deepEqual(nextLegPick(null, 'train'), { t: 'train', g: 'standard' }, '고르지 않은 편');
    // 비행기도 특실이 있다(2026-10-04 사용자 지정). 버스는 없다.
    assert.deepEqual(nextLegPick({ t: 'plane', g: 'standard' }, 'plane'), { t: 'plane', g: 'first' });
    assert.deepEqual(nextLegPick({ t: 'plane', g: 'first' }, 'plane'), { t: 'plane', g: 'standard' });
    assert.deepEqual(nextLegPick({ t: 'train', g: 'first' }, 'plane'), { t: 'plane', g: 'standard' }, '다른 교통편으로 바꾸면 일반석부터다');
    assert.deepEqual(nextLegPick({ t: 'bus', g: 'standard' }, 'bus'), { t: 'bus', g: 'standard' });
  });
  t('처음에는 사전정산대로 골라져 있고 달라진 것이 없다 — 사전정산에 줄이 없으면 아무것도 골라져 있지 않다', () => {
    const same = legPlan({ trip: TRIP2, rows: ROWS, workplace: '부산' });
    assert.deepEqual(same.legs.map((l) => [l.key, l.label, l.date, l.pick, l.source, l.row === l.site]),
      [['go', '가는 편', '2026-09-09', { t: 'train', g: 'standard' }, 'site', true], ['back', '오는 편', '2026-09-10', { t: 'train', g: 'standard' }, 'site', true]]);
    assert.deepEqual([same.changed, same.problems], [false, []]);
    const none = legPlan({ trip: TRIP2, rows: [], workplace: '부산' });
    assert.deepEqual(none.legs.map((l) => [l.pick, l.row, l.source]), [[null, null, ''], [null, null, '']]);
    assert.equal(none.changed, false);
  });
  t('편을 바꾸면: 기차는 운임표의 값(특실이면 특실 운임), 비행기·버스는 표가 없으면 요금을 몰라 문제로 적는다', () => {
    const p = legPlan({ trip: TRIP2, rows: ROWS, picks: { back: { t: 'train', g: 'first' } }, workplace: '부산' });
    assert.deepEqual(p.legs[1].row, { date: '2026-09-10', dep: '서울', arr: '부산', transport: 'Train', grade: '특실', total: 78900, currency: 'KRW', trseq: '', revno: '' });
    assert.deepEqual([p.legs[1].source, p.legs[0].source, p.changed], ['fare', 'site', true]);
    assert.equal(describeTrans(p.legs[1].row), 'KTX 서울→부산 특실 78,900원');
    const fly = legPlan({ trip: TRIP2, rows: ROWS, picks: { go: { t: 'plane', g: 'standard' }, back: { t: 'bus', g: 'standard' } }, workplace: '부산' });
    assert.deepEqual(fly.problems, ['가는 편: 비행기 요금을 모릅니다 — 항공권을 넣어 주세요', '오는 편: 버스 요금을 모릅니다 — 사후정산 화면에서 직접 넣어 주세요']);
    assert.deepEqual(fly.legs.map((l) => l.row), [null, null]);
    const back = legPlan({ trip: TRIP2, rows: ROWS, picks: { go: { t: 'train', g: 'standard' } }, workplace: '부산' });
    assert.deepEqual([back.changed, back.legs[0].row], [false, ROWS[0]], '사전정산과 같은 것을 다시 골랐으면 그 줄 그대로다');
  });
  t('사전정산에 줄이 없으면 KTX 의 역은 근무지·출장지에서 찾는다 — 못 찾으면 그렇다고 말한다', () => {
    const p = legPlan({ trip: TRIP2, rows: [], picks: { go: { t: 'train', g: 'standard' }, back: { t: 'train', g: 'standard' } }, workplace: '부산 본사' });
    assert.deepEqual(p.legs.map((l) => [l.row.date, l.row.dep, l.row.arr, l.row.total]), [['2026-09-09', '부산', '서울', 54400], ['2026-09-10', '서울', '부산', 54400]]);
    assert.deepEqual(legPlan({ trip: TRIP2, rows: [], picks: { go: { t: 'train', g: 'standard' } } }).problems, ['가는 편: 근무지 "" 에서 탈 KTX 역을 찾지 못했습니다']);
    assert.deepEqual(legPlan({ trip: { ...TRIP2, location: '목포' }, rows: [], picks: { go: { t: 'train', g: 'first' } }, workplace: '부산' }).problems,
      ['가는 편: KTX 운임표에 부산↔목포 구간이 없습니다']);
    assert.equal(legPlan({ trip: { ...TRIP2, location: '대전' }, rows: [], picks: { go: { t: 'train', g: 'first' } }, workplace: '부산' }).legs[0].row.total, 48000, '특실은 운임표의 특실 정가');
  });

  const flight = (over) => ({ docType: 'flight_ticket', airline: '대한항공', flightNo: 'KE1402', flightDate: '2026-09-09', depPlace: '김해', arrPlace: '김포', depTime: '07:30', arrTime: '08:30',
    seatClass: '일반석', total: 98000, currency: 'KRW', file: { name: '가는편.pdf' }, ...over });
  t('항공권을 편으로 편다 — 왕복표 한 장은 두 편이고 합계를 반씩 나눈다. 기차표·버스표는 증빙으로 받지 않아 편을 바꾸지 않는다', () => {
    const [one] = ticketsOf([flight({}), { docType: 'lodging_receipt', total: 1 }]);
    assert.deepEqual(one, { mode: 'plane', currency: 'KRW', grade: '일반석', cocard: false, source: '가는편.pdf', split: false, airline: '대한항공', mileage: null,
      date: '2026-09-09', dep: '김해', arr: '김포', depTime: '07:30', arrTime: '08:30', total: 98000, name: '대한항공 KE1402' });
    assert.deepEqual(ticketsOf([flight({ mileage: 215 })]).map((x) => x.mileage), [215], '문서에 적힌 적립 마일리지를 같이 들고 간다');
    const round = ticketsOf([flight({ total: 195001, retDate: '2026-09-10', retDepPlace: '김포', retArrPlace: '김해', retDepTime: '19:00', retFlightNo: 'KE1415' })]);
    assert.deepEqual(round.map((x) => [x.date, x.dep, x.arr, x.depTime, x.total, x.name, x.split]),
      [['2026-09-09', '김해', '김포', '07:30', 97501, '대한항공 KE1402', true], ['2026-09-10', '김포', '김해', '19:00', 97500, '대한항공 KE1415', true]]);
    assert.deepEqual(ticketsOf([{ docType: 'train_ticket', flightDate: '2026-09-09', depPlace: '부산', arrPlace: '서울', total: 53700 }, { docType: 'bus_ticket' }]), []);
  });
  t('항공권은 날짜가 맞는 편에 앉는다(1박 이상) — 출발일이면 가는 편, 도착일이면 오는 편. 한 편에 표는 하나이고 남는 표는 extra 다', () => {
    const [go, back] = ticketsOf([flight({}), flight({ flightDate: '2026-09-10', depPlace: '김포', arrPlace: '김해', flightNo: 'KE1415' })]);
    assert.deepEqual(seatTickets([back, go], TRIP2), { go, back, extra: [] });
    assert.deepEqual(seatTickets([back], TRIP2), { go: null, back, extra: [] });
    const late = { ...go, depTime: '09:30' };
    assert.deepEqual(seatTickets([late, go], TRIP2), { go, back: null, extra: [late] });
  });
  t('당일 출장은 두 편이 같은 날이라 시각으로 가린다 — 이른 표가 가는 편, 늦은 표가 오는 편 (2026-10-03 사용자 지정)', () => {
    const am = { mode: 'plane', date: '2026-09-09', dep: 'PUS', arr: 'GMP', depTime: '07:30' };
    const pm = { mode: 'plane', date: '2026-09-09', dep: 'GMP', arr: 'PUS', depTime: '19:00' };
    assert.deepEqual(seatTickets([pm, am], DAY1), { go: am, back: pm, extra: [] });
  });
  t('당일에 표가 하나뿐이면 떠나는 곳·닿는 곳을 보고(근무지 쪽에서 떠나면 가는 편), 그래도 모르면 낮 12시 뒤는 오는 편이다', () => {
    const where = { home: '부산 본사', dest: '서울' };
    const toSeoul = { mode: 'plane', date: '2026-09-09', dep: '김해공항', arr: '김포공항', depTime: '15:00' };
    const toBusan = { mode: 'plane', date: '2026-09-09', dep: 'GMP', arr: 'PUS', depTime: '08:00' };
    assert.deepEqual([seatTickets([toSeoul], DAY1, where).go, seatTickets([toBusan], DAY1, where).back], [toSeoul, toBusan], '시각보다 곳이 먼저다');
    const vague = { mode: 'plane', date: '2026-09-09', dep: 'A', arr: 'B', depTime: '15:00' };
    assert.deepEqual([seatTickets([vague], DAY1, where).back, seatTickets([{ ...vague, depTime: '08:00' }], DAY1, where).go.depTime], [vague, '08:00']);
  });
  t('항공권이 앉은 편은 비행기로 바뀐다 — 한 편뿐이면 나머지 편은 KTX 다(이미 골랐거나 사전정산에 줄이 있으면 그대로 둔다)', () => {
    const [go] = ticketsOf([flight({})]);
    assert.deepEqual(picksWithTickets({}, { go, back: null }, {}), { go: { t: 'plane', g: 'standard' }, back: { t: 'train', g: 'standard' } });
    assert.deepEqual(picksWithTickets({}, { go, back: null }, { back: ROWS[1] }), { go: { t: 'plane', g: 'standard' } }, '사전정산에 오는 편의 줄이 있다');
    assert.deepEqual(picksWithTickets({ back: { t: 'bus', g: 'standard' } }, { go, back: null }, {}).back, { t: 'bus', g: 'standard' }, '이미 골라 둔 편');
    assert.deepEqual(picksWithTickets({ go: { t: 'train', g: 'first' } }, { go: null, back: null }, {}), { go: { t: 'train', g: 'first' } }, '항공권이 없으면 고른 그대로다');
  });
  t('항공권이 앉은 편은 항공권의 구간·요금이 그 편의 값이다 — 기간 밖의 항공권은 알린다. 기차 편은 늘 운임표의 정가다', () => {
    const seats = seatTickets(ticketsOf([flight({ flightDate: '2026-09-10', depPlace: '김포', arrPlace: '김해', flightNo: 'KE1415', file: { name: '오는편.pdf' } })]), TRIP2);
    const p = legPlan({ trip: TRIP2, rows: ROWS, picks: picksWithTickets({}, seats, legsOfRows(ROWS, TRIP2)), seats, workplace: '부산' });
    assert.deepEqual(p.legs.map((l) => [l.source, describeTrans(l.row)]), [['site', 'KTX 부산→서울 일반석 53,700원'], ['ticket', '비행기 김포→김해 일반석 98,000원']]);
    assert.deepEqual([p.legs[1].ticket.name, p.changed, p.problems, p.notes], ['대한항공 KE1415', true, [], []]);
    const late = seatTickets(ticketsOf([flight({ flightDate: '2026-09-11', file: { name: '늦은편.pdf' } })]), TRIP2);
    const q = legPlan({ trip: TRIP2, rows: [], picks: { go: { t: 'plane', g: 'standard' }, back: { t: 'train', g: 'standard' } }, seats: late, workplace: '부산' });
    assert.deepEqual(q.notes, ['가는 편: 항공권의 날짜(9/11)가 출장 기간 밖입니다 — 늦은편.pdf']);
    assert.deepEqual([q.legs[1].source, q.legs[1].row.total], ['fare', 54400], '오는 편 KTX 는 운임표의 정가');
  });
  t('비행기를 특실로 고르면 등급 칸의 글만 특실이다 — 구간·요금은 항공권의 것이고, 항공권을 넣어도 특실은 그대로다 (2026-10-04 사용자 지정)', () => {
    const [back] = ticketsOf([flight({ flightDate: '2026-09-10', depPlace: '김포', arrPlace: '김해', flightNo: 'KE1415' })]);
    const seats = { go: null, back };
    const picks = picksWithTickets({ back: { t: 'plane', g: 'first' } }, seats, legsOfRows(ROWS, TRIP2));
    assert.deepEqual(picks, { back: { t: 'plane', g: 'first' } });
    const p = legPlan({ trip: TRIP2, rows: ROWS, picks, seats, workplace: '부산' });
    assert.deepEqual([p.legs[1].source, describeTrans(p.legs[1].row), p.changed, p.problems], ['ticket', '비행기 김포→김해 특실 98,000원', true, []]);
    assert.deepEqual(legPlan({ trip: TRIP2, rows: ROWS, picks: { back: { t: 'plane', g: 'first' } }, workplace: '부산' }).problems,
      ['오는 편: 비행기 요금을 모릅니다 — 항공권을 넣어 주세요'], '항공권이 없으면 특실이어도 요금을 모른다');
  });
  t('사전정산에 비행기 줄이 있으면 항공권 없이 등급만 바꾼다 — 그 줄의 구간·요금 그대로다. 그 줄이 특실이면 항공권을 넣어도 특실이다', () => {
    const AIR = [ROWS[0], { ...ROWS[1], date: '2026-09-10', dep: '김포', arr: '김해', transport: 'Airplane', grade: '일반석', total: 98000 }];
    const up = legPlan({ trip: TRIP2, rows: AIR, picks: { back: { t: 'plane', g: 'first' } }, workplace: '부산' });
    assert.deepEqual([up.legs[1].source, describeTrans(up.legs[1].row), up.changed, up.problems], ['grade', '비행기 김포→김해 특실 98,000원', true, []]);
    const same = legPlan({ trip: TRIP2, rows: AIR, picks: { back: { t: 'plane', g: 'standard' } }, workplace: '부산' });
    assert.deepEqual([same.legs[1].row, same.changed], [AIR[1], false], '같은 등급을 다시 골랐으면 그 줄 그대로다');
    const FIRST = [ROWS[0], { ...AIR[1], grade: '특실' }];
    const down = legPlan({ trip: TRIP2, rows: FIRST, picks: { back: { t: 'plane', g: 'standard' } }, workplace: '부산' });
    assert.deepEqual([describeTrans(down.legs[1].row), down.changed], ['비행기 김포→김해 일반석 98,000원', true]);
    const [back] = ticketsOf([flight({ flightDate: '2026-09-10', depPlace: '김포', arrPlace: '김해', flightNo: 'KE1415' })]);
    assert.deepEqual(picksWithTickets({}, { go: null, back }, legsOfRows(FIRST, TRIP2)), { back: { t: 'plane', g: 'first' } });
  });
  t('두 줄 목록이 같은지는 일자·구간·수단·등급·요금으로 본다', () => {
    assert.equal(sameTrans(ROWS, ROWS.map((r) => ({ ...r, seq: 'x' }))), true);
    assert.equal(sameTrans(ROWS, [ROWS[0], { ...ROWS[1], total: 54400 }]), false);
    assert.equal(sameTrans(ROWS, [ROWS[0]]), false);
  });
}

console.log('여비계산서 목록 읽기');
const LIST = (rows, pager = '전체 3건 · 1/1 페이지', user = '') => `<html><body>${user ? `<div class="bt-topmenu"><span class="bt-user"> ${user} (hong) / <a class="on" href="#">KOR</a> | <a href="#">ENG</a> </span></div>` : ''}<table class="list" id="mainList"><thead><tr class="listHeader"><th rowspan="2">계산서번호</th>
<th rowspan="2">출장자</th><th colspan="3">정산</th><th rowspan="2">출장기간</th><th rowspan="2">출장지</th><th rowspan="2">작성자</th><th rowspan="2">작성일</th></tr>
<tr class="listHeader"><th>계산서</th><th>사전정산</th><th>사후정산</th></tr></thead><tbody>${rows}</tbody></table>
<div class="bt-pager"><span class="bt-btn">1</span><div>${pager}</div></div></body></html>`;
const ROW = (seq, name, pre, post, period, where, n = 1) => `<tr>
<td rowspan="${n}" class="bt-row-link" data-href="/BusinessTrip/Write?seq=${seq}&amp;mode=E&amp;returnUrl=%2FBusinessTrip%2FHome%2FList">${seq}</td>
<td align="center">${name}</td><td align="center" class="bt-row-link" data-href="/BusinessTrip/CalPrint?seq=${seq}&amp;trseq=${seq}1&amp;returnUrl=x"> </td>
<td rowspan="${n}"><span style="color:magenta">${pre}</span></td><td data-afmsg="1" data-href="/BusinessTrip/CalPrint?seq=${seq}&amp;trseq=${seq}1"><span>${post}</span></td>
<td rowspan="${n}">${period}</td><td rowspan="${n}">${where}</td><td rowspan="${n}">${name}</td><td rowspan="${n}">2026-10-02</td></tr>`;
const EXTRA = (name, post, trseq = '7') => `<tr><td align="center">${name}</td><td align="center" data-href="/BusinessTrip/CalPrint?seq=0&amp;trseq=${trseq}"> </td><td><span>${post}</span></td></tr>`;
const listDoc = dom(LIST(ROW('145580', '홍길동', '작성', '대기', '2026-09-09~2026-09-10', '고양')
  + ROW('143010', '홍길동', '완료', '작성', '2026-07-20', '서울', 2) + EXTRA('김철수', '완료')
  + ROW('142248', '김철수', '완료', '대기', '2026-09-09~2026-09-10', '대전')));
const rows = parseTripList(listDoc);
t('출장자마다 번호(trseq)를 줄의 주소에서 읽는다 — 사후정산 입력 화면을 여는 데 쓴다', () =>
  assert.deepEqual(rows.map((r) => r.travelers.map((x) => x.trseq)), [['1455801'], ['1430101', '7'], ['1422481']]));
t('번호·기간·출장지·단계를 읽는다 — 하루짜리는 시작일과 종료일이 같고, 출장자가 여럿이면 한 계산서에 묶인다', () => {
  assert.deepEqual(rows.map((r) => [r.seq, r.from, r.to, r.location, r.pre, r.travelers.map((x) => `${x.name}:${x.post}`).join(',')]), [
    ['145580', '2026-09-09', '2026-09-10', '고양', '작성', '홍길동:대기'],
    ['143010', '2026-07-20', '2026-07-20', '서울', '완료', '홍길동:작성,김철수:완료'],
    ['142248', '2026-09-09', '2026-09-10', '대전', '완료', '김철수:대기'],
  ]);
  assert.equal(rows[0].href, '/BusinessTrip/Write?seq=145580&mode=E&returnUrl=%2FBusinessTrip%2FHome%2FList');
  assert.equal(tripListPages(listDoc), 1);
  assert.equal(tripListPages(dom(LIST('', '전체 45건 · 1/3 페이지'))), 3);
});
t('화면 머리에서 내 이름을 읽는다 — 목록의 출장자 칸과 같은 표기다(HR 은 영문 이름을 주기도 한다)', () => {
  assert.equal(tripUser(dom(LIST('', '전체 0건 · 1/1 페이지', '홍길동'))), '홍길동');
  assert.equal(tripUser(listDoc), '');
});
t('표가 없으면(로그인 화면) null 이다 — 빈 목록과 가린다', () => {
  assert.equal(parseTripList(dom('<html><body><input id="tbUserId"></body></html>')), null);
  assert.deepEqual(parseTripList(dom(LIST(''))), []);
});
t('단계: 사전정산 작성 → 사전정산 완료 → 사후정산 작성 → 사후정산 완료 (사후정산은 그 출장자의 것을 본다)', () => {
  assert.deepEqual(tripStage(rows[0], '홍길동'), { phase: 'pre', done: false, label: '사전정산 작성' });
  assert.deepEqual(tripStage(rows[2], '김철수'), { phase: 'pre', done: true, label: '사전정산 완료' });
  assert.deepEqual(tripStage(rows[1], '홍길동'), { phase: 'post', done: false, label: '사후정산 작성' });
  assert.deepEqual(tripStage(rows[1], '김철수'), { phase: 'post', done: true, label: '사후정산 완료' });
});
t('출장에 맞는 계산서는 기간과 출장자가 같은 것이다 — 같은 기간의 남의 계산서는 내 것이 아니다', () => {
  assert.equal(tripDocFor({ from: '2026-09-09', to: '2026-09-10' }, rows, '홍길동').seq, '145580');
  assert.equal(tripDocFor({ from: '2026-09-09', to: '2026-09-10' }, rows, '김철수').seq, '142248');
  assert.equal(tripDocFor({ from: '2026-07-20', to: '2026-07-20' }, rows, '김철수').seq, '143010', '같이 간 출장자의 것이기도 하다');
  assert.equal(tripDocFor({ from: '2026-09-09', to: '2026-09-09' }, rows, '홍길동'), null);
  assert.equal(tripDocFor({ from: '2026-09-09', to: '2026-09-10' }, rows).seq, '145580', '이름을 모르면 번호가 큰 것');
});

console.log('작성 화면과 저장 요청');
const WRITE = ({ seq = '', token = 'TOKEN-1', extra = '' } = {}) => `<html><body><form method="post" id="frm" action="/BusinessTrip/Write/Save">
<input type="hidden" name="seq" value="${seq}"><input type="hidden" name="travelerForeign" id="travelerForeign" value="K">
<input type="hidden" name="travelerSabuns" id="travelerSabuns" value=""><button type="button">출장자 선택</button><input type="hidden" name="fellowTraveler" value="">
<select name="period" id="period"><option value="1">당일출장(주재국)</option><option value="2">당일출장(주재국외)</option><option value="0" selected="selected">일반출장</option></select>
<input type="date" name="sDate" id="sDate" value="2026-10-02"><select name="sHour"><option value="8">8</option><option value="9" selected="selected">9</option></select>
<input type="date" name="eDate" id="eDate" value="2026-10-02"><select name="eHour"><option value="18" selected="selected">18</option></select>
<input type="text" name="location" value=""><select name="locArea"><option value="I" selected="selected">사무실소재지</option><option value="O">사무실소재지외</option></select>
<select name="distance"><option value="I">반경100이내</option><option value="O">반경100초과</option></select>
<input type="text" name="purpose" value=""><select name="nationCD" id="nationCD"><option value="">-</option><option value="KR||" selected="selected">대한민국</option></select>
<textarea name="summary"></textarea><select name="foreCurrency"><option value="">-</option></select><input type="text" name="foreDailyExp" value=""><input type="text" name="foreMealExp" value="">
<table><tbody id="stayBody">${extra}</tbody></table><input type="hidden" name="etc_exists" value="">
<select name="etc_cate" id="transMethod"><option value="E" selected="selected">대중교통</option><option value="P">개인차량</option></select>
<input type="hidden" name="etc_distance" value=""><input type="text" name="etc_reason" value="">
<button type="submit">저장</button>${token ? `<input name="__RequestVerificationToken" type="hidden" value="${token}">` : ''}</form>
<form method="post" id="delForm" action="/BusinessTrip/Write/Delete"><input type="hidden" name="seq" value=""></form></body></html>`;
const blankFields = formFields(dom(WRITE()));
t('작성 화면의 폼을 제출될 그대로 읽는다 — 숨은 칸·토큰까지, 버튼과 다른 폼(삭제)은 빼고', () => {
  assert.deepEqual(blankFields.map(([n]) => n), ['seq', 'travelerForeign', 'travelerSabuns', 'fellowTraveler', 'period', 'sDate', 'sHour', 'eDate', 'eHour',
    'location', 'locArea', 'distance', 'purpose', 'nationCD', 'summary', 'foreCurrency', 'foreDailyExp', 'foreMealExp', 'etc_exists', 'etc_cate',
    'etc_distance', 'etc_reason', '__RequestVerificationToken']);
  const got = Object.fromEntries(blankFields);
  assert.deepEqual([got.period, got.sHour, got.distance, got.nationCD, got.__RequestVerificationToken], ['0', '9', 'I', 'KR||', 'TOKEN-1'], '고른 값, 없으면 첫 선택지');
  assert.equal(formFields(dom('<html><body>로그인</body></html>')), null);
});
t('당일 출장의 저장 요청: 구분 1·종료일은 시작일·지역 O, 일비·식비 줄은 없고 교통편 두 줄이 토큰 앞에 온다', () => {
  const plan = settlePlan(trip({}));
  plan.trans[0].trseq = '7415';
  plan.trans[0].revno = '10638';
  const q = new URLSearchParams(saveBody(blankFields, plan, '11115'));
  const one = (k) => q.get(k);
  assert.deepEqual(['seq', 'travelerSabuns', 'period', 'sDate', 'sHour', 'eDate', 'eHour', 'location', 'locArea', 'purpose', 'nationCD', 'etc_cate', 'travelerForeign'].map(one),
    ['', '11115', '1', '2026-10-20', '7', '2026-10-20', '20', '대전', 'O', '착수회의 참석', 'KR||', 'E', 'K']);
  assert.deepEqual(q.getAll('stay_seq'), []);
  assert.deepEqual([q.getAll('tr_date'), q.getAll('tr_dep'), q.getAll('tr_arr'), q.getAll('tr_total'), q.getAll('tr_trseq'), q.getAll('tr_revno')],
    [['2026-10-20', '2026-10-20'], ['부산', '대전'], ['대전', '부산'], ['33100', '33100'], ['7415', ''], ['10638', '']]);
  assert.deepEqual([q.getAll('tr_seq'), q.getAll('tr_del'), q.getAll('tr_transport'), q.getAll('tr_grade'), q.getAll('tr_currency')],
    [['', ''], ['0', '0'], ['Train', 'Train'], ['일반석', '일반석'], ['KRW', 'KRW']]);
  assert.deepEqual([q.getAll('tr_shr'), q.getAll('tr_ehr'), q.getAll('tr_smn'), q.getAll('tr_emn')], [['7', '18'], ['9', '20'], ['0', '0'], ['0', '0']],
    '출발·도착 시 — 가는 편 07 → 09시, 오는 편 18 → 20시(부산↔대전 2시간). 분은 0 이다');
  const bare = new URLSearchParams(saveBody(blankFields, { ...plan, trans: plan.trans.map(({ shr, ehr, ...r }) => r) }, '11115'));
  assert.deepEqual([bare.getAll('tr_shr'), bare.getAll('tr_ehr')], [['0', '0'], ['0', '0']], '시각을 모르는 줄은 화면의 첫 선택지(0)다');
  const names = [...q.keys()];
  assert.equal(names.at(-1), '__RequestVerificationToken');
  assert.equal(q.get('__RequestVerificationToken'), 'TOKEN-1');
});
t('1박 2일의 저장 요청: 구분 0·지역은 건드리지 않고, 일비·식비 한 줄(대한민국·일수 2·일비 2·식수 6)이 들어간다', () => {
  const q = new URLSearchParams(saveBody(blankFields, settlePlan(trip({ days: 2 })), '11115'));
  assert.deepEqual([q.get('period'), q.get('eDate'), q.get('locArea')], ['0', '2026-10-21', 'I']);
  assert.deepEqual(['stay_seq', 'stay_del', 'stay_region', 'stay_day', 'stay_daily', 'stay_long', 'stay_meal'].map((k) => q.getAll(k)),
    [[''], ['0'], ['KR||'], ['2'], ['2'], ['0'], ['6']]);
  assert.deepEqual(q.getAll('tr_date'), ['2026-10-20', '2026-10-21']);
});
t('새 문서의 폼이 아니면 짓지 않는다 — 번호가 있거나, 줄이 이미 있거나, 토큰·사번·출장지가 없으면 던진다', () => {
  const plan = settlePlan(trip({}));
  assert.throws(() => saveBody(formFields(dom(WRITE({ seq: '145580' }))), plan, '11115'), /계산서번호가 이미/);
  assert.throws(() => saveBody(formFields(dom(WRITE({ token: '' }))), plan, '11115'), /토큰/);
  assert.throws(() => saveBody(formFields(dom(WRITE({ extra: '<tr><td><input type="hidden" name="stay_seq" value="1"></td></tr>' }))), plan, '11115'), /이미 줄이/);
  assert.throws(() => saveBody(blankFields, plan, ''), /사번/);
  assert.throws(() => saveBody(blankFields, { ...plan, location: '' }, '11115'), /출장지/);
  assert.throws(() => saveBody(blankFields.filter(([n]) => n !== 'locArea'), plan, '11115'), /locArea 칸이 없습니다/);
});

console.log('사이트 요금표와 잇기');
const FEE = `<tr class="sel" onclick="uf_rtnFee('7413','10636','부산','대전','Train','','32,900','KRW','won(KRW)');"><td>1</td></tr>
<tr class="sel" onclick="uf_rtnFee('7415','10638','부산','대전','Train','','33,100','KRW','won(KRW)');"><td>2</td></tr>
<tr class="sel" onclick="uf_rtnFee('7418','10641','부산','대전','Train','일반','33,100','KRW','won(KRW)');"><td>3</td></tr>
<tr class="sel" onclick="uf_rtnFee('7417','10640','부산','대전','Train','일반','33,100','KRW','won(KRW)');"><td>4</td></tr>
<tr class="sel" onclick="uf_rtnFee('92','200','부산','대전','Train','F','44,000','KRW','won(KRW)');"><td>5</td></tr>
<tr class="sel" onclick="uf_rtnFee('7500','10700','부산','대전','Bus','일반','33,100','KRW','won(KRW)');"><td>6</td></tr>`;
t('요금표의 줄을 읽고, 같은 구간·수단·요금인 것 가운데 등급이 일반이고 나중에 등록한 것을 고른다', () => {
  const fee = parseFeeRows(FEE);
  assert.deepEqual(fee.map((r) => [r.trseq, r.revno, r.transport, r.grade, r.fee]),
    [['7413', '10636', 'Train', '', 32900], ['7415', '10638', 'Train', '', 33100], ['7418', '10641', 'Train', '일반', 33100],
      ['7417', '10640', 'Train', '일반', 33100], ['92', '200', 'Train', 'F', 44000], ['7500', '10700', 'Bus', '일반', 33100]]);
  const row = settlePlan(trip({})).trans[0];
  assert.equal(pickFeeRow(fee, row).trseq, '7418');
  assert.equal(pickFeeRow(fee.filter((r) => r.grade !== '일반'), row).trseq, '7415', '일반이라고 적은 것이 없으면 요금이 같은 것');
  assert.equal(pickFeeRow(fee, { ...row, total: 99999 }), null, '같은 요금이 없으면 잇지 않는다');
  assert.equal(pickFeeRow(fee, { ...row, dep: '대전', arr: '부산' }), null, '방향이 다른 줄은 쓰지 않는다');
  const first = [...fee, { trseq: '8001', revno: '1', dep: '부산', arr: '대전', transport: 'Train', grade: '일반', fee: 44000 }];
  assert.equal(pickFeeRow(first, { ...row, grade: '특실', total: 44000 }).trseq, '92', '특실 줄이면 특실(F)이라고 적은 것이 먼저다');
});

console.log('올리는 흐름 (사이트는 흉내 낸다)');
{
  globalThis.DOMParser = new JSDOM('').window.DOMParser;
  const page = (html) => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  /** 저장을 받으면 목록에 새 줄이 생기는 가짜 사이트. posts 에 저장 요청의 본문이 쌓인다. */
  const site = ({ existing = '', saves = true, user = '' } = {}) => {
    const state = { rows: existing, posts: [], gets: [] };
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (init.method === 'POST') {
        state.posts.push({ url: u, body: String(init.body) });
        if (saves) state.rows += ROW('146001', '홍길동', '작성', '대기', '2026-10-20', '대전');
        return page(LIST(state.rows, undefined, user));
      }
      state.gets.push(u);
      if (u.includes('/Home/List')) return page(LIST(state.rows, undefined, user));
      if (u.includes('/TrafficFee/Select')) return page(u.includes(`departure=${encodeURIComponent('부산')}`) ? FEE : '<table></table>');
      if (u.includes('/BusinessTrip/Write')) return page(WRITE());
      throw new Error('모르는 주소 ' + u);
    };
    return state;
  };
  const { tripCreate, tripList, tripDocUrl, TRIP_SHELL_URL } = await import('../src/trip.js');
  const who = { emplNo: '11115', name: '홍길동' };

  await ta('새 계산서를 한 번만 올리고, 목록을 다시 읽어 새 번호를 확인한다 — 가는 길은 요금표의 같은 항목과 이어진다', async () => {
    const state = site();
    const stages = [];
    const r = await tripCreate(settlePlan(trip({})), { ...who, onStage: (m) => stages.push(m) });
    assert.deepEqual([r.existing, r.row.seq, r.linked], [false, '146001', 1]);
    assert.equal(state.posts.length, 1);
    assert.equal(state.posts[0].url, 'https://eclass.krs.co.kr/BusinessTrip/Write/Save');
    const q = new URLSearchParams(state.posts[0].body);
    assert.deepEqual([q.get('travelerSabuns'), q.get('period'), q.get('location'), q.getAll('tr_trseq'), q.getAll('tr_total')],
      ['11115', '1', '대전', ['7418', ''], ['33100', '33100']]);
    assert.ok(state.gets[0].includes('/Home/List?SDate=2026-10-20&EDate=2026-10-20'), '올리기 전에 같은 기간의 계산서부터 본다');
    assert.deepEqual(stages, ['여비계산서 목록을 확인하는 중...', '여비계산서 작성 화면을 여는 중...', '여비계산서(사전정산)를 올리는 중...']);
  });
  await ta('같은 기간·같은 출장자의 계산서가 이미 있으면 올리지 않는다 (같은 기간의 남의 계산서는 막지 않는다)', async () => {
    const state = site({ existing: ROW('145999', '홍길동', '작성', '대기', '2026-10-20', '대전') });
    const r = await tripCreate(settlePlan(trip({})), who);
    assert.deepEqual([r.existing, r.row.seq, state.posts.length], [true, '145999', 0]);
    const other = site({ existing: ROW('145998', '김철수', '작성', '대기', '2026-10-20', '대전') });
    assert.equal((await tripCreate(settlePlan(trip({})), who)).row.seq, '146001');
    assert.equal(other.posts.length, 1);
  });
  await ta('내 계산서인지는 여비계산서 화면이 아는 이름으로 가린다 — HR 이 영문 이름을 줘도 이미 있는 것을 또 만들지 않는다', async () => {
    const state = site({ existing: ROW('145999', '홍길동', '작성', '대기', '2026-10-20', '대전'), user: '홍길동' });
    const r = await tripCreate(settlePlan(trip({})), { emplNo: '11115', name: 'HONG Gildong' });
    assert.deepEqual([r.existing, r.row.seq, state.posts.length], [true, '145999', 0]);
    assert.equal((await tripList({ from: '2026-10-01', to: '2026-10-31' })).me, '홍길동');
  });
  await ta('저장을 보냈는데 목록에 새 계산서가 없으면 성공이라고 하지 않는다', async () => {
    const state = site({ saves: false });
    await assert.rejects(() => tripCreate(settlePlan(trip({})), who), /목록에서 새 여비계산서를 확인하지 못했습니다/);
    assert.equal(state.posts.length, 1, '되풀이해 보내지 않는다');
  });
  await ta('로그인이 풀려 있으면 올리지 않고 로그인이 필요하다고 말한다', async () => {
    const posts = [];
    globalThis.fetch = async (url, init = {}) => {
      if (init.method === 'POST') posts.push(url);
      return page('<html><body><form action="/eClassVer4/Account/Login"><input id="tbUserId" name="UserId"></form>' + 'x'.repeat(2000) + '</body></html>');
    };
    await assert.rejects(() => tripList({ from: '2026-10-01', to: '2026-10-31' }), /로그인이 필요합니다/);
    await assert.rejects(() => tripCreate(settlePlan(trip({})), who), /로그인이 필요합니다/);
    assert.equal(posts.length, 0);
  });
  t('바로 가기 주소: 계산서가 있으면 그 줄의 주소, 없으면 포털의 여비계산서 목록', () => {
    assert.equal(tripDocUrl(rows[0]), 'https://eclass.krs.co.kr/BusinessTrip/Write?seq=145580&mode=E&returnUrl=%2FBusinessTrip%2FHome%2FList');
    assert.equal(tripDocUrl(null), TRIP_SHELL_URL);
    assert.match(TRIP_SHELL_URL, /menu=%2FBusinessTrip%2FbtMain\.aspx&menuID=PBR000080001/);
  });
}

console.log('신청 내역의 여비계산서 아이콘 — 숫자(1 사전 · 2 사후)와 색(회색 미작성 · 녹색 작성 중 · 파랑 완료)');
{
  const row = (pre, post) => ({ seq: '1', pre, travelers: [{ name: '김거화', post }] });
  const icon = (r) => tripIconState(r, r && tripStage(r, '김거화'));
  t('계산서가 없으면 1 · 회색(미작성)', () => assert.deepEqual(icon(null), { digit: 1, state: 'none', label: '사전정산 미작성' }));
  t('사전정산 작성 중이면 1 · 녹색, 완료면 1 · 파랑', () => {
    assert.deepEqual(icon(row('작성', '대기')), { digit: 1, state: 'doing', label: '사전정산 작성 중' });
    assert.deepEqual(icon(row('완료', '대기')), { digit: 1, state: 'done', label: '사전정산 완료' });
  });
  t('사후정산으로 넘어가면 2 — 작성 중 녹색, 완료 파랑', () => {
    assert.deepEqual(icon(row('완료', '작성')), { digit: 2, state: 'doing', label: '사후정산 작성 중' });
    assert.deepEqual(icon(row('완료', '완료')), { digit: 2, state: 'done', label: '사후정산 완료' });
  });
}

console.log(`\n통과 ${pass}건`);
