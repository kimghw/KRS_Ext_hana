// 한 달 미리 훑기가 기대는 세 가지를 확인한다.
//
//   1) 보관소가 **언제 읽었는지**로 신선/묵음을 가른다 — 오늘 읽은 것은 그날 하루를 쓰고
//      (훑기는 하루에 한 번), 묵은 현황을 지금 것처럼 보여주지 않게 읽은 시각을 붙여 둔다.
//   2) 담은 것이 **저장소에 남아** 패널을 닫았다 열어도 다시 훑지 않는다.
//   3) 훑기가 남기는 하루 기록만으로 **격자를 그릴 수 있다** — 예약 목록만 담으면
//      빈 회의실이 몇 곳인지 알 수 없어 캐시가 쓸모없어진다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

import { createDayStore, MONTH_DAYS, RETRY_MS, DAY_KEY_PREFIX } from '../src/monthcache.js';
import { extractSchedule, parseRooms, parseSelectedRegion, buildGrid } from '../src/parse.js';
import { extractCars } from '../src/rentcar.js';
import { datesFrom } from '../src/mine.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
/** 저장소에 적는 일은 기다리지 않고 흘려보낸다. 그것이 끝날 틈을 준다. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** chrome.storage.local 흉내. disk 가 패널을 닫아도 남는 쪽이다. */
function fakeStorage(disk = {}) {
  return {
    disk,
    get: async () => ({ ...disk }),
    set: async (obj) => { Object.assign(disk, structuredClone(obj)); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete disk[k]; },
  };
}

const room = (date, extra = {}) => ({ kind: 'room', date, reservations: [], confident: true, reason: '', ...extra });
const car = (date, extra = {}) => ({ kind: 'car', date, reservations: [], confident: true, reason: '', ...extra });

console.log('보관소 기본');
{
  const store = createDayStore();
  store.put(room('2026-09-16', { rooms: [{ name: '제1회의실' }] }));

  t('담은 것을 꺼낸다', () => assert.equal(store.get('room', '2026-09-16').rooms.length, 1));
  t('읽은 시각이 붙는다', () => assert.ok(store.get('room', '2026-09-16').at > 0));
  t('없는 날은 null', () => assert.equal(store.get('room', '2026-09-17'), null));
  t('종류가 다르면 다른 칸', () => assert.equal(store.get('car', '2026-09-16'), null));
  t('kind/date 없는 것은 안 담는다', () => {
    assert.equal(store.put({ date: '2026-09-16' }), null);
    assert.equal(store.put(null), null);
    assert.equal(store.size(), 1);
  });
}

console.log('신선도 — 오늘 읽은 것은 그날 하루를 쓴다 (훑기는 하루에 한 번)');
{
  let now = new Date(2026, 8, 16, 9, 0).getTime();
  const store = createDayStore({ now: () => now });
  store.put(room('2026-09-16'));
  store.put(car('2026-09-16'));

  t('방금 담은 건 신선하다', () => assert.equal(store.fresh('room', '2026-09-16'), true));
  t('신선하면 훑을 것이 없다', () => assert.deepEqual(store.missing(['2026-09-16']), []));
  t('신선하면 covers 가 참', () => assert.equal(store.covers(['2026-09-16']), true));

  now = new Date(2026, 8, 16, 23, 59).getTime();
  t('몇 시간이 지나도 같은 날이면 다시 훑지 않는다', () =>
    assert.deepEqual(store.missing(['2026-09-16']), []));

  now = new Date(2026, 8, 17, 0, 1).getTime();
  t('날이 바뀌면 다시 훑을 날이 된다', () => assert.deepEqual(store.missing(['2026-09-16']), ['2026-09-16']));
  t('묵어도 꺼내 볼 수는 있다 (언제 읽었는지와 함께)', () =>
    assert.ok(store.get('room', '2026-09-16').at > 0));
}

console.log('확인 불가로 읽힌 날은 하루를 기다리지 않는다 — 잠깐의 실패가 종일 남으면 안 된다');
{
  let now = new Date(2026, 8, 16, 9, 0).getTime();
  const store = createDayStore({ now: () => now });
  store.put(room('2026-09-16', { confident: false, reason: '날짜를 옮기지 못했습니다.' }));
  store.put(car('2026-09-16'));

  now += 9 * 60_000;
  t('바로 다시 두드리지는 않는다', () => assert.deepEqual(store.missing(['2026-09-16']), []));
  now += 2 * 60_000;
  t('10분이 지나면 다시 읽을 날이 된다', () =>
    assert.deepEqual(store.missing(['2026-09-16']), ['2026-09-16']));
  t('제대로 읽힌 쪽은 그대로 신선하다', () => assert.equal(store.fresh('car', '2026-09-16'), true));
  t('다시 읽어 보는 간격은 10분', () => assert.equal(RETRY_MS, 10 * 60_000));
}

console.log('회의실·차량 둘 다 있어야 그 날을 읽은 것이다');
{
  const store = createDayStore();
  store.put(room('2026-09-16'));

  t('한쪽만 있으면 아직 덜 읽었다', () =>
    assert.deepEqual(store.missing(['2026-09-16']), ['2026-09-16']));
  t('covers 도 거짓', () => assert.equal(store.covers(['2026-09-16']), false));

  store.put(car('2026-09-16'));
  t('둘 다 담기면 끝', () => assert.deepEqual(store.missing(['2026-09-16']), []));
  t('종류를 찍어 물으면 그것만 본다', () =>
    assert.deepEqual(store.missing(['2026-09-16'], ['room']), []));
}

console.log('범위로 꺼내기');
{
  const store = createDayStore();
  const dates = datesFrom('2026-09-16', 3);
  store.put(room(dates[0]));
  store.put(car(dates[0]));
  store.put(room(dates[2]));

  t('담긴 것만 날짜 순으로', () => assert.deepEqual(
    store.list(dates).map((d) => d.date + ' ' + d.kind),
    ['2026-09-16 room', '2026-09-16 car', '2026-09-18 room']));
  t('빈 날은 그냥 빠진다', () => assert.equal(store.list([dates[1]]).length, 0));
  t('안 읽은 날을 셀 수 있다', () =>
    assert.deepEqual(store.missing(dates), [dates[1], dates[2]]));
}

console.log('가장 오래전에 읽은 시각 — 화면에 "언제 읽은 것"인지 말하는 데 쓴다');
{
  let now = 5_000;
  const store = createDayStore({ now: () => now });
  store.put(room('2026-09-16'));
  now = 9_000;
  store.put(room('2026-09-17'));

  t('둘 중 오래된 쪽', () => assert.equal(store.oldest(datesFrom('2026-09-16', 2), ['room']), 5_000));
  t('담긴 게 없으면 0', () => assert.equal(store.oldest(['2026-10-01']), 0));
}

console.log('예약·취소로 낡아진 날은 버린다');
{
  const store = createDayStore();
  store.put(room('2026-09-16'));
  store.put(car('2026-09-16'));

  store.drop(['2026-09-16'], ['room']);
  t('찍은 종류만 버린다', () => {
    assert.equal(store.get('room', '2026-09-16'), null);
    assert.ok(store.get('car', '2026-09-16'));
  });

  store.drop(['2026-09-16']);
  t('종류를 안 찍으면 둘 다', () => assert.equal(store.size(), 0));
}

console.log('저장소 — 패널을 닫았다 열어도 오늘 읽은 것은 남는다');
{
  const D = '2026-09-16';
  let now = new Date(2026, 8, 16, 9, 0).getTime();
  const storage = fakeStorage({ myName: '홍길동' });

  const first = createDayStore({ storage, now: () => now });
  first.put(room(D, { rooms: [{ name: '제1회의실' }] }));
  first.put(car(D));
  await settle();
  t('하루치가 한 칸씩 적힌다', () => {
    assert.ok(storage.disk[`${DAY_KEY_PREFIX}room|${D}`]);
    assert.ok(storage.disk[`${DAY_KEY_PREFIX}car|${D}`]);
  });

  // 패널을 닫았다 다시 열었다
  now = new Date(2026, 8, 16, 15, 0).getTime();
  const second = createDayStore({ storage, now: () => now });
  t('불러오기 전에는 비어 있다', () => assert.deepEqual(second.missing([D]), [D]));
  const restored = await second.restore();
  t('오늘 읽은 것을 되살린다', () => assert.equal(restored, 2));
  t('되살린 날은 다시 훑지 않는다', () => assert.deepEqual(second.missing([D]), []));
  t('읽은 시각은 그때 그대로다 (다시 연 시각이 아니다)', () =>
    assert.equal(second.get('room', D).at, new Date(2026, 8, 16, 9, 0).getTime()));
  t('방 목록도 같이 돌아온다', () => assert.equal(second.get('room', D).rooms.length, 1));

  second.drop([D], ['room']);
  await settle();
  t('버린 날은 저장소에서도 지워진다', () => {
    assert.equal(storage.disk[`${DAY_KEY_PREFIX}room|${D}`], undefined);
    assert.ok(storage.disk[`${DAY_KEY_PREFIX}car|${D}`]);
  });

  // 다음 날 연다
  now = new Date(2026, 8, 17, 8, 0).getTime();
  const third = createDayStore({ storage, now: () => now });
  const kept = await third.restore();
  await settle();
  t('어제 읽은 것은 되살리지 않는다', () => {
    assert.equal(kept, 0);
    assert.equal(third.size(), 0);
  });
  t('저장소에서도 치운다', () =>
    assert.equal(Object.keys(storage.disk).filter((k) => k.startsWith(DAY_KEY_PREFIX)).length, 0));
  t('다른 설정은 건드리지 않는다', () => assert.equal(storage.disk.myName, '홍길동'));
}

console.log('저장소가 말을 안 들어도 메모리의 것은 쓴다');
{
  const broken = {
    get: async () => { throw new Error('context invalidated'); },
    set: async () => { throw new Error('quota'); },
    remove: async () => { throw new Error('quota'); },
  };
  const store = createDayStore({ storage: broken });
  store.put(room('2026-09-16'));
  store.drop(['2026-09-17']);
  await settle();
  t('담은 것은 그대로 꺼낸다', () => assert.ok(store.get('room', '2026-09-16')));
  const none = await createDayStore().restore();
  t('저장소 없이 만든 보관소는 되살릴 것이 없다', () => assert.equal(none, 0));
}

console.log('다른 창의 패널이 담거나 버린 것을 따라간다');
{
  const D = '2026-09-16';
  let now = new Date(2026, 8, 16, 9, 0).getTime();
  const store = createDayStore({ now: () => now });
  store.put(room(D));
  const mine = store.get('room', D);

  store.sync({ [`${DAY_KEY_PREFIX}car|${D}`]: { newValue: { ...car(D), at: now } }, myName: { newValue: 'x' } });
  t('저쪽이 담은 날이 들어온다', () => assert.equal(store.fresh('car', D), true));
  t('보관소 칸이 아닌 것은 무시한다', () => assert.equal(store.size(), 2));

  store.sync({ [`${DAY_KEY_PREFIX}room|${D}`]: { newValue: { ...room(D), at: now - 5000, reservations: [{ room: '옛것' }] } } });
  t('더 새것을 쥐고 있으면 지킨다', () => assert.equal(store.get('room', D), mine));

  store.sync({ [`${DAY_KEY_PREFIX}room|${D}`]: { oldValue: mine } });
  t('저쪽이 버린 날은 여기서도 버린다', () => {
    assert.equal(store.get('room', D), null);
    assert.deepEqual(store.missing([D]), [D]);
  });
}

console.log('훑기가 남기는 하루로 격자를 그릴 수 있어야 한다 (실제 회의실 페이지)');
{
  const html = fs.readFileSync(new URL('./fixtures/list-2026-09-16.html', import.meta.url), 'utf8');
  const doc = new JSDOM(html).window.document;
  const DATE = '2026-09-16';
  const hours = { start: 8, end: 20 };

  // scanDays 가 하루에 담아 두는 것과 같은 모양
  const region = parseSelectedRegion(doc);
  const { rooms, source: roomSource } = parseRooms(doc);
  const sch = extractSchedule(doc, DATE);

  const store = createDayStore();
  store.put({
    kind: 'room', date: DATE, reservations: sch.reservations,
    rooms, roomSource, region, regions: ['부산', '서울'],
    confident: sch.confident, reason: sch.reason,
  });

  const rec = store.get('room', DATE);
  t('방 목록이 함께 담긴다', () => assert.ok(rec.rooms.length > 0));
  t('지역이 함께 담긴다', () => assert.equal(rec.region, '부산'));

  // 캐시만 보고 격자를 만든다 (sidepanel 의 cachedDay 가 하는 일)
  const here = rec.reservations.filter((r) => !r.region || r.region === rec.region);
  const grid = buildGrid(rec.rooms, here, hours, { confident: rec.confident });
  const live = buildGrid(rooms, here, hours, { confident: sch.confident });

  t('캐시로 만든 격자가 그대로 나온다', () => assert.deepEqual(
    grid.map((r) => r.slots.map((s) => s.state).join('')),
    live.map((r) => r.slots.map((s) => s.state).join(''))));
  t('사용 중인 칸이 실제로 있다', () =>
    assert.ok(grid.some((r) => r.slots.some((s) => s.state === 'busy'))));
  t('담긴 예약에는 전 지역이 들어 있다', () =>
    assert.ok(rec.reservations.length >= here.length));
}

console.log('차량도 마찬가지 (실제 차량 페이지)');
{
  const html = fs.readFileSync(new URL('./fixtures/rentcar-2026-09-16.html', import.meta.url), 'utf8');
  const doc = new JSDOM(html).window.document;
  const DATE = '2026-09-16';
  const got = extractCars(doc, DATE);

  const store = createDayStore();
  store.put({
    kind: 'car', date: DATE, reservations: got.reservations,
    rooms: got.cars, roomSource: 'table', confident: got.ok, reason: got.reason,
  });

  const rec = store.get('car', DATE);
  t('차량 목록이 함께 담긴다', () => assert.ok(rec.rooms.length > 0));
  t('캐시만으로 차량 격자가 나온다', () => {
    const grid = buildGrid(rec.rooms, rec.reservations, { start: 8, end: 20 }, { confident: rec.confident });
    assert.equal(grid.length, rec.rooms.length);
    assert.ok(grid.some((r) => r.slots.some((s) => s.state === 'busy')));
  });
}

console.log('미리 훑는 범위');
t('한 달은 30일', () => assert.equal(MONTH_DAYS, 30));
t('오늘부터 30일을 센다', () => {
  const dates = datesFrom('2026-09-16', MONTH_DAYS);
  assert.equal(dates.length, 30);
  assert.equal(dates[0], '2026-09-16');
  assert.equal(dates[29], '2026-10-15');
});

console.log('\n통과 ' + pass + '건');
