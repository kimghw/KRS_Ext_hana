// 출장지마다 지난번에 쓴 교통편을 기억했다가 다음에 먼저 쓴다(src/routes.js, 2026-10-04 사용자 지정).
// 무엇을 기억하고(패널이 만든 사전정산 · 사이트에서 읽은 교통편 줄) 무엇을 되살리는지(아이콘 · KTX 길)를 본다. DOM·저장소 없이 돈다.
import assert from 'node:assert/strict';
import { ROUTES_KEY, ROUTES_MAX, routeKey, routeOfPlan, routeOfRows, keepRoute, recallRoute, withRoute } from '../src/routes.js';
import { settlePlan, describePlan } from '../src/travel.js';
import { blankForm, settle } from '../src/attend.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const trip = (over) => settle({ ...blankForm('trip', '2026-10-02'), dateFrom: '2026-10-20', purpose: '착수회의 참석', settle: true, place: '대전', workplace: '부산 본사', ...over });
const row = (date, dep, arr, over = {}) => ({ seq: '1', trseq: '', revno: '', date, dep, arr, transport: 'Train', grade: '일반석', total: 54400, currency: 'KRW', shr: 0, ehr: 0, ...over });
const TRIP = { from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시 킨텍스' };

console.log('무엇을 기억하는가');
t('패널이 사전정산을 만들면 폼에서 고른 교통편과 KTX 가 지난 역의 차례를 기억한다 — 갈아탔으면 갈아탄 역까지', () => {
  assert.deepEqual(routeOfPlan(settlePlan(trip({ place: '경기도 용인시' }))), { transport: ['train'], trainGrade: 'standard', path: ['부산', '동탄'], date: '2026-10-20' });
  assert.deepEqual(routeOfPlan(settlePlan(trip({ place: '목포', trainGrade: 'first' }))), { transport: ['train'], trainGrade: 'first', path: ['부산', '오송', '목포'], date: '2026-10-20' });
  assert.deepEqual(routeOfPlan(settlePlan(trip({ place: '제주', transport: ['plane'] }))), { transport: ['plane'], trainGrade: 'standard', path: null, date: '2026-10-20' },
    'KTX 줄이 들어가지 않았으면 길은 없고 교통편만 기억한다');
  assert.deepEqual(routeOfPlan(settlePlan(trip({ transport: ['train', 'plane'] }))).transport, ['train', 'plane']);
  assert.equal(routeOfPlan(null), null);
});
t('사전정산 화면의 교통편 줄을 읽으면 그것을 기억한다 — 사이트에서 손으로 고친 것까지 따라간다. 줄이 없으면 기억하지 않는다', () => {
  assert.deepEqual(routeOfRows([row('2026-09-09', '부산', '서울'), row('2026-09-10', '서울', '부산')], TRIP),
    { transport: ['train'], trainGrade: 'standard', path: ['부산', '서울'], date: '2026-09-09' });
  assert.deepEqual(routeOfRows([row('2026-09-09', '부산역', '광명역', { grade: '특실' }), row('2026-09-10', '광명', '부산', { grade: '특실' })], TRIP),
    { transport: ['train'], trainGrade: 'first', path: ['부산', '광명'], date: '2026-09-09' }, '줄에 적힌 곳에서 역을 찾는다');
  const via = [row('2026-09-09', '부산', '오송'), row('2026-09-09', '오송', '목포'), row('2026-09-10', '목포', '오송'), row('2026-09-10', '오송', '부산')];
  assert.deepEqual(routeOfRows(via, TRIP).path, ['부산', '오송', '목포'], '갈아타는 편은 여러 줄이 한 편이다');
  const mixed = routeOfRows([row('2026-09-09', '김해', '김포', { transport: 'Airplane' }), row('2026-09-10', '서울', '부산')], TRIP);
  assert.deepEqual(mixed, { transport: ['train', 'plane'], trainGrade: 'standard', path: ['부산', '서울'], date: '2026-09-09' }, '가는 편이 비행기면 오는 편 KTX 를 뒤집은 길이다');
  assert.deepEqual(routeOfRows([row('2026-09-09', '김해', '김포', { transport: 'Airplane' })], TRIP), { transport: ['plane'], trainGrade: 'standard', path: null, date: '2026-09-09' });
  assert.equal(routeOfRows([row('2026-09-09', '부산', '강릉'), row('2026-09-10', '강릉', '부산')], TRIP).path, null, '운임표로 이어지지 않는 길은 기억하지 않는다(교통편만)');
  assert.deepEqual([routeOfRows([], TRIP), routeOfRows([row('2026-09-09', '부산', '서울', { transport: 'Subway' })], TRIP)], [null, null]);
});

console.log('담기와 꺼내기');
t('출장지에 적은 글이 열쇠다 — 더 나중의 출장이 앞의 것을 덮어쓰고, 예전 출장을 읽어도 요즘 것을 덮어쓰지 않는다', () => {
  assert.deepEqual([routeKey('  경기도   고양시 킨텍스 '), ROUTES_KEY], ['경기도 고양시 킨텍스', 'tripRoutes']);
  // 여비계산서에서 읽은 출장지는 "출장지(장소)"다 — 폼의 출장지와 같은 열쇠가 되도록 끝의 괄호(장소)를 뗀다.
  assert.deepEqual([routeKey('대전(한국기계연구원)'), routeKey('대전 (KAIST) '), routeKey('(대전)')], ['대전', '대전', '(대전)']);
  const a = { transport: ['train'], trainGrade: 'standard', path: ['부산', '서울'], date: '2026-09-09' };
  const one = keepRoute({}, ' 경기도 고양시  킨텍스', a);
  assert.deepEqual(one, { '경기도 고양시 킨텍스': a });
  assert.deepEqual(recallRoute(one, '경기도 고양시 킨텍스 '), a);
  assert.equal(recallRoute(one, '고양'), null, '다른 글은 다른 출장지다');
  assert.equal(keepRoute(one, '경기도 고양시 킨텍스', a), one, '바뀐 것이 없으면 받은 것을 그대로 돌려준다(저장하지 않는다)');
  const older = { ...a, path: ['부산', '광명'], date: '2026-07-01' };
  assert.equal(keepRoute(one, '경기도 고양시 킨텍스', older), one, '예전 출장');
  const newer = { ...a, trainGrade: 'first', path: ['부산', '행신'], date: '2026-10-20' };
  assert.deepEqual(recallRoute(keepRoute(one, '경기도 고양시 킨텍스', newer), '경기도 고양시 킨텍스'), newer);
  const sameDay = { ...a, path: ['부산', '광명'] };
  assert.deepEqual(recallRoute(keepRoute(one, '경기도 고양시 킨텍스', sameDay), '경기도 고양시 킨텍스').path, ['부산', '광명'], '같은 출장을 다시 읽으면 고친 것이 남는다');
});
t('쓸 수 없는 기억은 담지도 꺼내지도 않는다 — 교통편이 없거나 날짜가 틀린 것, 빈 출장지. 모르는 교통편·등급은 걸러 낸다', () => {
  const ok = { transport: ['train'], trainGrade: 'standard', path: null, date: '2026-09-09' };
  assert.deepEqual([keepRoute({}, '', ok), keepRoute({}, '대전', null), keepRoute({}, '대전', { ...ok, transport: [] }), keepRoute({}, '대전', { ...ok, date: '9/9' }), keepRoute(null, '대전', null)],
    [{}, {}, {}, {}, {}]);
  assert.deepEqual(recallRoute({ 대전: { transport: ['ship', 'bus', 'train'], trainGrade: 'x', path: ['부산'], date: '2026-09-09' } }, '대전'),
    { transport: ['train', 'bus'], trainGrade: 'standard', path: null, date: '2026-09-09' });
  assert.deepEqual([recallRoute({ 대전: 'x' }, '대전'), recallRoute(null, '대전'), recallRoute({}, '')], [null, null, null]);
});
t(`기억은 ${ROUTES_MAX}곳까지다 — 넘치면 오래된 출장부터 버린다`, () => {
  let store = {};
  for (let i = 0; i < ROUTES_MAX + 5; i++) {
    store = keepRoute(store, `출장지 ${i}`, { transport: ['train'], trainGrade: 'standard', path: null, date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}` });
  }
  assert.equal(Object.keys(store).length, ROUTES_MAX);
  assert.deepEqual([recallRoute(store, '출장지 0'), !!recallRoute(store, '출장지 5'), !!recallRoute(store, `출장지 ${ROUTES_MAX + 4}`)], [null, true, true]);
});

console.log('다음 출장에서 되살리기');
t('같은 출장지를 다시 적으면 아이콘은 지난번대로, 기억이 없으면 기본(기차 일반석)이다', () => {
  assert.deepEqual(withRoute({ transport: ['train', 'plane'], trainGrade: 'first', path: null, date: '2026-09-09' }), { transport: ['train', 'plane'], trainGrade: 'first' });
  assert.deepEqual(withRoute(null), { transport: ['train'], trainGrade: 'standard' });
});
t('사전정산의 KTX 줄은 기억한 길로 짓는다 — 지난번에 사이트에서 광명으로 고쳤으면 다음 고양 출장도 광명이다. 요금은 지금 운임표의 정가다', () => {
  const store = keepRoute({}, TRIP.location, routeOfRows([row('2026-09-09', '부산', '광명', { total: 50000 }), row('2026-09-10', '광명', '부산', { total: 50000 })], TRIP));
  const form = trip({ place: TRIP.location });
  assert.equal(describePlan(settlePlan(form)), '당일출장(주재국) · 경기도 고양시 킨텍스 · KTX 부산↔서울 일반석 54,400원 × 2', '기억이 없을 때');
  assert.equal(describePlan(settlePlan(form, recallRoute(store, form.place))), '당일출장(주재국) · 경기도 고양시 킨텍스 · KTX 부산↔광명 일반석 52,200원 × 2 · 지난번에 쓴 길');
});

console.log(`\n통과 ${pass}건`);
