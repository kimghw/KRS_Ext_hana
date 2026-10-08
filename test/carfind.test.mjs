// 출장·외근 폼의 차량 조회(src/carfind.js) — 폼의 날짜·시간으로 기간을 내고, 그 기간 내내 빈 차량을 가린다.
//
// 못 박는 것: 차량 현황의 눈금(한 시간)에 맞추는 것, 여러 날에 걸친 기간의 날마다 다른 구간, 그리고
// **확신할 수 없으면 비어 있다고 하지 않는 것**. 실제 차량 화면(2026-09-16 캡처)으로도 한 번 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

const {
  CAR_KINDS, MAX_CAR_DAYS, wantsCar, carWindow, windowDays, windowLabel, carsInWindow, carPick, carPlaceKey, carPlaceOf,
  regionOf, carHome, carLock,
} = await import('../src/carfind.js');
const { blankForm, settle } = await import('../src/attend.js');
const { extractCars } = await import('../src/rentcar.js');

const TODAY = '2026-10-02';
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const trip = (over = {}) => settle({ ...blankForm('trip', TODAY), dateFrom: '2026-10-20', ...over });
const out = (over = {}) => settle({ ...blankForm('out', TODAY), dateFrom: '2026-10-20', ...over });

console.log('어느 폼에서 찾는가');
t('차량 조회는 출장·외근에만 있고, 켜 두었을 때만 찾는다', () => {
  assert.deepEqual(CAR_KINDS, ['trip', 'out']);
  assert.deepEqual([wantsCar(trip()), wantsCar(trip({ car: true })), wantsCar(out({ car: true }))], [false, true, true]);
  assert.equal(wantsCar({ ...blankForm('leave', TODAY), car: true }), false, '휴가에는 차량 조회가 없다');
  assert.equal(carWindow({ ...blankForm('leave', TODAY), start: '09:00', end: '18:00' }), null);
});

console.log('기간');
t('당일 출장은 출발~도착 그대로다 (기본 07:00~20:00)', () => {
  assert.deepEqual(carWindow(trip()), { from: '2026-10-20', to: '2026-10-20', start: 420, end: 1200, rounded: false });
  assert.equal(windowLabel(carWindow(trip())), '10/20 07:00~20:00');
});
t('여러 날 출장은 출발일의 출발 시각부터 마지막 날의 도착 시각까지다 — 사이의 날은 하루 내내', () => {
  const win = carWindow(trip({ days: 3 }));
  assert.deepEqual([win.from, win.to, win.start, win.end], ['2026-10-20', '2026-10-22', 420, 1200]);
  assert.deepEqual(windowDays(win), [
    { date: '2026-10-20', start: 420, end: 1440 }, { date: '2026-10-21', start: 0, end: 1440 }, { date: '2026-10-22', start: 0, end: 1200 },
  ]);
  assert.equal(windowLabel(win), '10/20 07:00 ~ 10/22 20:00');
  assert.deepEqual(windowDays(carWindow(trip({ dateFrom: '2026-10-31', days: 2 }))).map((d) => d.date), ['2026-10-31', '2026-11-01'], '달을 넘어가도 맞다');
});
t('외근은 시작 + 몇 시간이다. 차량은 한 시간 칸이라 정시에 맞춰 넓힌다 (14:00~16:30 → 14:00~17:00)', () => {
  assert.deepEqual(carWindow(out({ start: '14:00', span: 120 })), { from: '2026-10-20', to: '2026-10-20', start: 840, end: 960, rounded: false });
  assert.deepEqual(carWindow(out({ start: '14:30', span: 120 })), { from: '2026-10-20', to: '2026-10-20', start: 840, end: 1020, rounded: true });
  assert.equal(windowLabel(carWindow(out({ start: '14:00', span: 150 }))), '10/20 14:00~17:00');
});
t('날짜나 시간이 아직 없으면 기간도 없다 — 찾지 않는다', () => {
  assert.equal(carWindow(out()), null, '외근은 몇 시간을 고르기 전에는 끝 시각이 없다');
  assert.equal(carWindow(trip({ dateFrom: '' })), null);
  assert.equal(carWindow(trip({ start: '' })), null);
  assert.equal(carWindow(trip({ start: '20:00', end: '07:00' })), null, '같은 날인데 끝이 시작보다 이르다');
  assert.ok(carWindow(trip({ days: 2, start: '20:00', end: '07:00' })), '날을 넘기면 된다');
  assert.ok(MAX_CAR_DAYS >= 5, '칩으로 고르는 닷새 출장은 한도 안이다');
});

console.log('빈 차량 가리기');
const CARS = [{ value: '70', name: '아반테 (181허4360)', label: '아반테 (181허4360)' }, { value: '31', name: '쏘나타 (203도7306)', label: '쏘나타 (203도7306)' },
  { value: '75', name: '스타리아 (308소4997)', label: '스타리아 (308소4997)' }];
const res = (room, date, start, end, more = {}) => ({ room, date, start, end, owner: '홍길동', title: '방문', mine: false,
  spanStart: { date, minutes: start }, spanEnd: { date, minutes: end }, ...more });
const day = (date, reservations = [], more = {}) => ({ kind: 'car', date, rooms: CARS, reservations, confident: true, reason: '', ...more });
const states = (r) => r.cars.map((c) => [c.car.value, c.state]);

t('그 시간에 겹치는 신청이 있는 차는 사용 중이고, 맞닿기만 한 것은 비어 있다 — 빈 차량이 앞에 온다', () => {
  const win = carWindow(trip({ start: '09:00', end: '18:00' }));
  const r = carsInWindow(win, [day('2026-10-20', [
    res(CARS[0].name, '2026-10-20', 600, 720),            // 10~12시: 겹친다
    res(CARS[1].name, '2026-10-20', 1080, 1200),          // 18~20시: 맞닿기만 한다
    res(CARS[1].name, '2026-10-20', 420, 540),            // 07~09시: 맞닿기만 한다
  ])]);
  assert.deepEqual(states(r), [['31', 'free'], ['75', 'free'], ['70', 'busy']]);
  assert.deepEqual(r.cars[2].busy, [{ label: '10:00~12:00', owner: '홍길동', title: '방문', mine: false }]);
  assert.deepEqual(r.unsure, []);
});
t('여러 날 출장은 걸친 날 모두를 본다 — 첫날은 출발 뒤, 마지막 날은 도착 앞, 사이의 날은 하루 내내', () => {
  const win = carWindow(trip({ days: 3 }));   // 10/20 07:00 ~ 10/22 20:00
  const r = carsInWindow(win, [
    day('2026-10-20', [res(CARS[0].name, '2026-10-20', 300, 420)]),              // 첫날 05~07시: 출발 전이라 겹치지 않는다
    day('2026-10-21', [res(CARS[1].name, '2026-10-21', 1320, 1380)]),            // 사이의 날 22~23시: 겹친다
    day('2026-10-22', [res(CARS[2].name, '2026-10-22', 1200, 1260)]),            // 마지막 날 20~21시: 도착 뒤라 겹치지 않는다
  ]);
  assert.deepEqual(states(r), [['70', 'free'], ['75', 'free'], ['31', 'busy']]);
  assert.equal(r.cars[2].busy[0].label, '10/21 22:00~23:00', '여러 날 기간에서는 날짜를 같이 적는다');
});
t('여러 날에 걸친 남의 신청은 걸친 날마다 담겨 오지만 한 건으로 적는다 — 내 신청이면 그렇다고 표시한다', () => {
  const win = carWindow(trip({ days: 2 }));
  const span = { spanStart: { date: '2026-10-20', minutes: 540 }, spanEnd: { date: '2026-10-21', minutes: 1080 }, mine: true };
  const r = carsInWindow(win, [
    day('2026-10-20', [res(CARS[0].name, '2026-10-20', 540, 1440, span)]),
    day('2026-10-21', [res(CARS[0].name, '2026-10-21', 0, 1080, span)]),
  ]);
  const busy = r.cars.find((c) => c.car.value === '70');
  assert.deepEqual([busy.state, busy.mine, busy.busy.length, busy.busy[0].label], ['busy', true, 1, '10/20 09:00~10/21 18:00']);
  assert.deepEqual(states(r), [['70', 'busy'], ['31', 'free'], ['75', 'free']], '내가 신청한 차량이 맨 앞에 선다 — 네 줄만 보이는 목록에서 스크롤 아래로 숨지 않게');
});
t('확신할 수 없는 날이 하루라도 있으면 겹치는 것이 안 보인 차도 비어 있다고 하지 않는다 (확인 불가)', () => {
  const win = carWindow(trip({ days: 2 }));
  const r = carsInWindow(win, [
    day('2026-10-20', [res(CARS[0].name, '2026-10-20', 600, 720)]),
    day('2026-10-21', [], { confident: false, reason: '날짜를 옮기지 못했습니다.' }),
  ]);
  assert.deepEqual(states(r), [['31', 'unknown'], ['75', 'unknown'], ['70', 'busy']], '보인 신청은 그대로 사용 중이다');
  assert.deepEqual(r.unsure, [{ date: '2026-10-21', reason: '날짜를 옮기지 못했습니다.' }]);
  const missing = carsInWindow(win, [day('2026-10-20')]);
  assert.deepEqual([missing.unsure.map((u) => u.date), missing.cars.every((c) => c.state === 'unknown')], [['2026-10-21'], true], '아예 못 읽은 날도 같다');
});
t('표에 없는 차의 신청이 보여도 버리지 않는다', () => {
  const r = carsInWindow(carWindow(trip()), [day('2026-10-20', [res('카니발 (167수1756)', '2026-10-20', 600, 720)])]);
  assert.deepEqual(r.cars.at(-1).car, { name: '카니발 (167수1756)', value: '카니발 (167수1756)', label: '카니발 (167수1756)' });
  assert.equal(r.cars.at(-1).state, 'busy');
});

console.log('근무지(서울·부산)와 고를 수 있는 차량');
t('근무지에 적은 글에서 서울인지 부산인지 읽는다 — 둘 다 아니거나 둘 다면 모른다고 한다(짐작하지 않는다)', () => {
  assert.deepEqual(['부산', '부산 본사', ' 서울 ', '서울본부', '', '대전지부', '서울·부산', undefined].map(regionOf),
    ['부산', '부산', '서울', '서울', '', '', '', '']);
});
t('차량 목록은 부산 본사의 차량이고, 옆에 "서울본부 전용"이라고 적힌 차량만 서울의 것이다', () => {
  assert.deepEqual([carHome({ note: '' }), carHome({ note: '[임원용 차량]' }), carHome({ note: '[서울본부 전용 차량]' }), carHome({})], ['부산', '부산', '서울', '부산']);
});
{
  const plain = { name: '아반테', note: '' };
  const exec = { name: '그랜저', note: '[임원용 차량]', blocked: '차량 이용 시 지원팀에 문의 바랍니다.' };
  const ask = { name: '스타리아', note: '[총무팀 사전 협의 후 사용가능]', blocked: '차량 이용 시 지원팀에 문의 바랍니다.' };
  const seoul = { name: '소나타', note: '[서울본부 전용 차량]' };
  const dept = { name: '소나타', note: '[협약본부 전용 차량]' };
  t('근무지가 부산이면 안내가 붙지 않은 부산 차량만 고를 수 있다 — 서울본부 전용·임원용·사전 협의·다른 본부 전용 차량은 까닭과 함께 잠긴다', () => {
    assert.deepEqual([plain, seoul, exec, ask, dept].map((c) => carLock(c, '부산')),
      ['', '[서울본부 전용 차량]', '[임원용 차량]', '[총무팀 사전 협의 후 사용가능]', '[협약본부 전용 차량]']);
  });
  t('근무지가 서울이면 서울본부 전용 차량만 고를 수 있다 — 부산 본사 차량은 잠긴다', () => {
    assert.deepEqual([plain, seoul, exec, dept].map((c) => carLock(c, '서울')), ['부산 본사 차량', '', '[임원용 차량]', '부산 본사 차량']);
    assert.equal(carLock({ ...seoul, blocked: '문의 바랍니다.' }, '서울'), '[서울본부 전용 차량]', '사이트가 막으면 서울이어도 고를 수 없다');
  });
  t('근무지를 모르면 어느 차량도 고를 수 없다 — 먼저 적게 한다', () => {
    assert.deepEqual([plain, seoul].map((c) => carLock(c, '')), ['근무지를 적어 주세요', '근무지를 적어 주세요']);
    assert.equal(carLock(exec, ''), '[임원용 차량]', '사이트가 막는 차량은 그 안내가 먼저다');
  });
  t('안내 없이 사이트만 막는 차량도 고를 수 없다', () =>
    assert.equal(carLock({ name: 'x', note: '', blocked: '문의 바랍니다.' }, '부산'), '사이트에서 문의 후 사용'));
  t('빈 차량 가운데 고를 수 있는 것이 앞에, 고를 수 없는 것이 그 뒤에 선다 (내 신청이 맨 앞)', () => {
    const fleet = [exec, plain, seoul, { name: '쏘나타', note: '' }, { name: '카니발', note: '' }].map((c, i) => ({ value: String(i), label: c.name, ...c, name: `${c.name}${i}` }));
    const r = carsInWindow(carWindow(trip()), [{ date: '2026-10-20', rooms: fleet, confident: true,
      reservations: [res(fleet[4].name, '2026-10-20', 600, 720, { mine: true }), res(fleet[3].name, '2026-10-20', 600, 720)] }], { region: '부산' });
    assert.deepEqual(r.cars.map((c) => [c.car.name, c.state, c.lock]), [
      ['카니발4', 'busy', ''], ['아반테1', 'free', ''], ['그랜저0', 'free', '[임원용 차량]'], ['소나타2', 'free', '[서울본부 전용 차량]'], ['쏘나타3', 'busy', ''],
    ]);
    assert.ok(carsInWindow(carWindow(trip()), [{ date: '2026-10-20', rooms: fleet, reservations: [], confident: true }]).cars.every((c) => c.lock), '근무지를 안 주면 모두 잠긴다');
  });
}

console.log('실제 차량 화면 (2026-09-16 캡처)');
{
  const html = fs.readFileSync(new URL('./fixtures/rentcar-2026-09-16.html', import.meta.url), 'utf8');
  const got = extractCars(new JSDOM(html).window.document, '2026-09-16');
  const live = [{ date: '2026-09-16', rooms: got.cars, reservations: got.reservations, confident: got.ok, reason: got.reason }];
  const find = (r, plate) => r.cars.find((c) => c.car.name.includes(plate));
  t('근무지 부산, 18~20시: 빈 차량 열 대 가운데 고를 수 있는 것은 다섯 대다 — 임원용·사전 협의·협약본부 전용 차량은 비어 있어도 잠긴다', () => {
    const r = carsInWindow({ from: '2026-09-16', to: '2026-09-16', start: 1080, end: 1200 }, live, { region: '부산' });
    const open = r.cars.filter((c) => c.state === 'free' && !c.lock).map((c) => c.car.value);
    assert.deepEqual(open, ['72', '73', '74', '31', '32']);
    assert.deepEqual(r.cars.filter((c) => c.state === 'free' && c.lock).map((c) => [c.car.value, c.lock]), [
      ['38', '[임원용 차량]'], ['65', '[임원용 차량]'], ['75', '[지원팀 사전 협의 후 사용가능]'], ['56', '[지원팀 사전 협의 후 사용가능]'], ['62', '[협약본부 전용 차량]'],
    ]);
    assert.equal(find(r, '223어7393').state, 'busy', '서울본부 전용 차량은 그날 사용 중이다');
  });
  t('근무지 서울, 18~20시: 서울본부 전용 차량이 사용 중이라 고를 수 있는 차량이 없다 — 부산 본사 차량은 비어 있어도 잠긴다', () => {
    const r = carsInWindow({ from: '2026-09-16', to: '2026-09-16', start: 1080, end: 1200 }, live, { region: '서울' });
    assert.deepEqual(r.cars.filter((c) => c.state === 'free' && !c.lock), []);
    assert.equal(find(r, '181허4309').lock, '부산 본사 차량');
  });
  t('18~20시 외근: 09~18시에 쓰는 차(181허4309)는 비어 있고, 20시까지 쓰는 차(231호5994)와 여러 날 쓰는 차(181허4360)는 사용 중이다', () => {
    const r = carsInWindow({ from: '2026-09-16', to: '2026-09-16', start: 1080, end: 1200 }, live);
    assert.equal(r.cars.length, 16);
    assert.deepEqual([find(r, '181허4309').state, find(r, '231호5994').state, find(r, '181허4360').state], ['free', 'busy', 'busy']);
    assert.equal(find(r, '231호5994').busy[0].label, '12:00~20:00');
    assert.equal(find(r, '181허4360').busy[0].label, '9/16 09:00~9/18 21:00');
    assert.equal(r.cars.filter((c) => c.state === 'free').length, 10);
    assert.ok(r.cars.findIndex((c) => c.state === 'busy') === 10, '빈 차량 열 대가 앞에 선다');
  });
  t('07~20시 당일 출장: 그날 신청이 하나도 없는 차만 비어 있다', () => {
    const r = carsInWindow({ from: '2026-09-16', to: '2026-09-16', start: 420, end: 1200 }, live);
    assert.deepEqual(r.cars.filter((c) => c.state === 'free').map((c) => c.car.value), ['65', '75', '56', '62']);
  });
}

console.log('신청할 한 건');
t('고른 차량·기간과 함께 사용목적(폼의 목적)과 행선지가 나간다 — 출장은 사전정산과 상관없이 출장지(장소)가 행선지다', () => {
  const form = trip({ days: 2, purpose: ' 착수회의 참석 ', settle: true, place: ' 대전 ', carPlace: '쓰지 않는 값' });
  assert.deepEqual([carPlaceKey(form), carPlaceOf(form)], ['place', '대전']);
  assert.deepEqual(carPick(carWindow(form), CARS[0], form), {
    date: '2026-10-20', endDate: '2026-10-21', start: 420, end: 1200, car: { name: '아반테 (181허4360)', value: '70' }, title: '착수회의 참석', place: '대전',
  });
  const off = trip({ purpose: '협의', settle: false, place: '대전', venue: '한국기계연구원', carPlace: '세종' });
  assert.deepEqual([carPlaceKey(off), carPick(carWindow(off), CARS[0], off).place], ['place', '대전(한국기계연구원)'], '여비계산서의 출장지와 같은 글이다');
  assert.equal(carPlaceOf(trip({ purpose: '협의' })), '', '아직 안 적었으면 빈 글이다 — 차량을 누를 때 묻는다');
});
t('출장지 칸이 없는 폼(외근)은 차량 조회 옆의 행선지 칸에서 받는다', () => {
  const o = out({ start: '14:00', span: 120, purpose: '과제 협의 (부산시청)', carPlace: '부산시청' });
  assert.deepEqual([carPick(carWindow(o), CARS[1], o).title, carPick(carWindow(o), CARS[1], o).place], ['과제 협의 (부산시청)', '부산시청']);
  assert.equal(carPlaceOf(out({ start: '14:00', span: 120 })), '', '아직 안 적었으면 빈 글이다 — 차량을 누를 때 묻는다');
});

console.log(`\n통과 ${pass}건`);
