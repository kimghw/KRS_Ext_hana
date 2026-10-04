// 홈의 WORKSPACE 카드(예전 "내 예약"): 자리 찾기, 캐시(신선도·이름·기간), 훑기와 못 읽은 날 경고, 패널과의 신호,
// 그리고 예약과 같은 모양으로 섞여 보이는 근태(출장·외근·휴가).
// 여기서도 가장 중요한 건 **못 읽은 날을 "예약 없음"으로 넘기지 않는 것**이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  mountHome, startHome, createHomeCard, findAnchor, summarize, spanOf, cacheUsable, agoText, dayLabel, planItems,
  homeEnabled, CACHE_KEY, JUMP_KEY, ENABLE_KEY, ROOT_ID, HIDDEN_KEY, FOLD_KEY,
} from '../src/home.js';
import { PLANS_KEY } from '../src/plans.js';
import { BACK_KEY, SENT_KEY, STAGES_KEY } from '../src/settling.js';
import { AuthError } from '../src/net.js';
import { MONTH_DAYS } from '../src/monthcache.js';
import { datesFrom } from '../src/mine.js';
import { scanDays } from '../src/site.js';
import { scanCarDays } from '../src/rentcar.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const TODAY = '2026-09-17';   // 목요일
const NOW = new Date('2026-09-17T09:00:00').getTime();

// 2026-09-17 캡처의 홈 뼈대: 본문 첫 카드가 Popup Notice(#divPopupInfo)다.
const HOME = '<html><body><div class="page-content container">'
  + '<div class="row pt-3 mt-1" id="divPopupInfo"><div class="col-12">Popup Notice</div></div>'
  + '<div class="row" id="divkrinfo"></div></div></body></html>';

function homeDoc(html = HOME) {
  const dom = new JSDOM(html, { url: 'https://eclass.krs.co.kr/eClassVer4/Home/Index' });
  return dom.window.document;
}

/** chrome.storage.local 흉내. 바꾼 것은 onChanged 로 알린다 — 진짜처럼. */
function fakeStorage(init = {}) {
  const data = structuredClone(init);
  const listeners = [];
  const fire = (changes) => { for (const fn of listeners) fn(changes, 'local'); };
  return {
    data,
    get: async (keys) => {
      const out = {};
      for (const k of [].concat(keys)) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    set: async (obj) => {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
        data[k] = structuredClone(v);
      }
      fire(changes);
    },
    remove: async (keys) => {
      const changes = {};
      for (const k of [].concat(keys)) { changes[k] = { oldValue: data[k] }; delete data[k]; }
      fire(changes);
    },
    // 진짜처럼 떼어낼 수 있어야 한다. 카드를 끄면 듣던 것을 떼는지 여기서 본다.
    onChanged: (fn) => {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    listenerCount: () => listeners.length,
  };
}

const day = (kind, date, reservations = [], confident = true, reason = '') =>
  ({ kind, date, reservations, confident, reason });
const room = (over) => ({
  date: TODAY, room: '제1회의실', start: 540, end: 660, owner: '홍길동', mine: false,
  title: '주간 회의', status: '', region: '부산', ...over,
});

/**
 * 날짜별로 정해 둔 하루를 돌려주는 가짜 훑기. 정하지 않은 날은 0건이다.
 * 진짜 훑기처럼 멈춤 신호(signal)를 날짜마다 본다. gate 를 주면 pauseAfter 날을 읽은 뒤 거기서 기다린다.
 */
function fakeScan(kind, byDate = {}, { fail = null, onCall = null, gate = null, pauseAfter = 0 } = {}) {
  const fn = async (dates, onProgress, { onDay, signal } = {}) => {
    fn.calls.push(dates);
    onCall?.();
    if (fail) throw fail;
    for (let i = 0; i < dates.length; i++) {
      if (gate && i === pauseAfter) await gate;
      if (signal?.aborted) break;
      onProgress?.(dates[i], i + 1, dates.length);
      onDay?.(byDate[dates[i]] || day(kind, dates[i]));
      fn.fed++;
    }
    return [];
  };
  fn.calls = [];
  fn.fed = 0;
  return fn;
}

/**
 * 배경이 읽어 주는 근태 흉내. calls 에 부탁마다 force 였는지를 적는다.
 * storage 를 주면 진짜 배경처럼 읽은 것을 거기에도 담는다.
 */
function fakePlans(items = [], { error = '', storage = null } = {}) {
  const fn = async ({ force = false } = {}) => {
    fn.calls.push(force);
    if (error) return { items: [], error };
    if (storage) await storage.set({ [PLANS_KEY]: { day: TODAY, since: '2026-01-01', items } });
    return { items, error: '' };
  };
  fn.calls = [];
  return fn;
}

/**
 * 여비계산서 목록(eclass /BusinessTrip) 읽기 흉내. calls 에 읽은 기간을 적는다. fail 을 주면 못 읽는다.
 * 다녀온 출장이 남아 있을 때만 불린다 — 사후정산이 완료된 것을 가리려고.
 */
function fakeTrips(rows = [], { fail = null } = {}) {
  const fn = async (range) => {
    fn.calls.push(range);
    if (fail) throw fail;
    return { rows, me: '김거화' };
  };
  fn.calls = [];
  return fn;
}

/** 카드를 붙인다. 바깥 것은 전부 가짜다. */
async function mount({
  storage = fakeStorage(), rooms = fakeScan('room'), cars = fakeScan('car'), plans = fakePlans(), trips = fakeTrips(),
  now = () => NOW, visible = () => true, openPanel = null, doc = homeDoc(), debounceMs = 5, alive = () => true,
} = {}) {
  const panelCalls = [];
  const ctl = await mountHome(doc, {
    storage, onChanged: storage.onChanged, now, today: () => TODAY,
    scanRooms: rooms, scanCars: cars, loadPlans: plans, listTrips: trips, visible, debounceMs, alive,
    openPanel: openPanel || (async () => { panelCalls.push(1); return { ok: true }; }),
  });
  const root = doc.getElementById(ROOT_ID);
  const text = (role) => (root?.querySelector(`[data-role="${role}"]`)?.textContent || '').trim();
  return {
    ctl, doc, root, storage, rooms, cars, plans, trips, panelCalls, text,
    items: () => [...(root?.querySelectorAll('li.krs-mine-item') || [])],
  };
}

console.log('자리 찾기');
t('Popup Notice 카드 바로 앞', () => {
  const a = findAnchor(homeDoc());
  assert.equal(a.mode, 'before');
  assert.equal(a.el.id, 'divPopupInfo');
});
t('공지 카드가 없으면 본문 맨 위', () => {
  const a = findAnchor(homeDoc('<html><body><div class="page-content"><p>x</p></div></body></html>'));
  assert.equal(a.mode, 'prepend');
});
t('알아보는 자리가 없으면 null', () =>
  assert.equal(findAnchor(homeDoc('<html><body><div>x</div></body></html>')), null));

console.log('캐시 판정');
const base = { at: NOW - 1000, start: TODAY, days: MONTH_DAYS, name: '', items: [] };
t('시작일·기간·이름이 같아야 쓴다', () => {
  assert.ok(cacheUsable(base, { start: TODAY, days: 30, name: '' }));
  assert.ok(!cacheUsable(base, { start: '2026-09-18', days: 30, name: '' }));
  assert.ok(!cacheUsable(base, { start: TODAY, days: 14, name: '' }));
  assert.ok(!cacheUsable(base, { start: TODAY, days: 30, name: '홍길동' }));
  assert.ok(!cacheUsable(null, { start: TODAY, days: 30 }));
  assert.ok(!cacheUsable({ ...base, items: null }, { start: TODAY, days: 30 }));
});
t('오늘 읽은 것이면 얼마나 지났든 쓴다(하루에 한 번)', () =>
  assert.ok(cacheUsable({ ...base, at: NOW - 8 * 3600_000 }, { start: TODAY, days: 30, name: '' })));
t('기간 설정은 패널 것을 그대로, 이상하면 한 달', () => {
  assert.equal(spanOf('7'), 7);
  assert.equal(spanOf(14), 14);
  assert.equal(spanOf('abc'), MONTH_DAYS);
  assert.equal(spanOf('0'), MONTH_DAYS);
  assert.equal(spanOf(undefined), MONTH_DAYS);
});
t('읽은 지 얼마나 됐는지', () => {
  assert.equal(agoText(NOW - 10_000, NOW), '방금');
  assert.equal(agoText(NOW - 3 * 60_000, NOW), '3분 전');
  assert.equal(agoText(NOW - 2 * 3600_000, NOW), '2시간 전');
});
t('오늘은 말로, 나머지는 월/일 (요일)', () => {
  assert.equal(dayLabel(TODAY, TODAY), '오늘 (목)');
  assert.equal(dayLabel('2026-09-18', TODAY), '9/18 (금)');
});

console.log('못 읽은 날 세기');
{
  const dates = datesFrom(TODAY, 3);
  const days = [
    day('room', dates[0], [room({ mine: true })]),
    day('room', dates[1], [], false, '날짜를 옮기지 못했습니다.'),
    day('car', dates[0]),
    day('car', dates[1]),
  ];
  const s = summarize(dates, days, {});
  t('내 것만 추린다', () => { assert.equal(s.items.length, 1); assert.equal(s.items[0].why, 'button'); });
  t('확신 없는 날은 빼고 센다', () => assert.deepEqual(s.skippedDates, [dates[1]]));
  t('기록이 아예 없는 날은 따로 센다', () => assert.deepEqual(s.unread, [dates[2]]));
  t('storage 에 넣을 것만 남긴다(record 없음)', () => assert.ok(!('record' in s.items[0])));
}

console.log('캐시가 없으면 훑고 담는다');
await ta('서른 날을 회의실·차량 두 바퀴 훑고 결과를 담는다', async () => {
  const rooms = fakeScan('room', {
    [TODAY]: day('room', TODAY, [room({ mine: true }), room({ owner: '김철수', room: '제2회의실' })]),
  });
  const cars = fakeScan('car', {
    '2026-09-20': day('car', '2026-09-20', [{
      date: '2026-09-20', room: '카니발', start: 540, end: 1080, owner: '홍길동', mine: false, title: '출장',
      spanStart: { date: '2026-09-20', minutes: 540 }, spanEnd: { date: '2026-09-21', minutes: 1080 },
    }]),
  });
  const storage = fakeStorage({ myName: '홍길동' });
  const m = await mount({ storage, rooms, cars });

  assert.equal(rooms.calls.length, 1);
  assert.equal(rooms.calls[0].length, MONTH_DAYS);
  assert.equal(rooms.calls[0][0], TODAY);
  assert.equal(cars.calls.length, 1);

  const saved = storage.data[CACHE_KEY];
  assert.equal(saved.at, NOW);
  assert.equal(saved.start, TODAY);
  assert.equal(saved.days, MONTH_DAYS);
  assert.equal(saved.name, '홍길동');
  assert.equal(saved.items.length, 2);

  assert.equal(m.items().length, 2);
  assert.equal(m.text('rooms'), '1');
  assert.equal(m.text('cars'), '1');
  assert.match(m.text('note'), /9\/17~10\/16 · 방금 읽음/);
  assert.ok(m.items()[0].classList.contains('today'));
  assert.match(m.items()[0].textContent, /오늘 \(목\) 09:00~11:00/);
  // 차량 다중일 예약은 하루로 자르지 않고 구간 그대로
  assert.match(m.items()[1].textContent, /9\/20 \(일\) 09:00 ~ 9\/21 \(월\) 18:00/);
  assert.match(m.items()[1].textContent, /이름 일치/);
  assert.equal(m.text('warn'), '');
  assert.equal(m.root.nextElementSibling.id, 'divPopupInfo');
});
await ta('알아보는 자리가 없으면 붙이지도 훑지도 않는다', async () => {
  const rooms = fakeScan('room');
  const m = await mount({ doc: homeDoc('<html><body><div>다른 화면</div></body></html>'), rooms });
  assert.equal(m.ctl, null);
  assert.equal(m.root, null);
  assert.equal(rooms.calls.length, 0);
});

console.log('담긴 것을 쓴다');
const cached = {
  at: NOW - 60_000, start: TODAY, days: MONTH_DAYS, name: '',
  items: [{ kind: 'room', why: 'button', from: { date: TODAY, minutes: 600 }, to: { date: TODAY, minutes: 660 }, room: '제3회의실', title: '담긴 것', status: '' }],
  skippedDates: [], unread: [], failed: [],
};
await ta('오늘 읽은 것이 있으면 훑지 않고 그대로 그린다', async () => {
  const rooms = fakeScan('room');
  const m = await mount({ storage: fakeStorage({ [CACHE_KEY]: cached }), rooms });
  assert.equal(rooms.calls.length, 0);
  assert.equal(m.items().length, 1);
  assert.match(m.items()[0].textContent, /담긴 것/);
  assert.match(m.text('note'), /1분 전 읽음/);
});
await ta('오늘 읽은 것이면 몇 시간이 지나도 다시 훑지 않는다', async () => {
  const rooms = fakeScan('room');
  const cars = fakeScan('car');
  const m = await mount({ storage: fakeStorage({ [CACHE_KEY]: { ...cached, at: NOW - 8 * 3600_000 } }), rooms, cars });
  assert.equal(rooms.calls.length, 0);
  assert.equal(cars.calls.length, 0);
  assert.equal(m.items().length, 1);
  assert.match(m.text('note'), /8시간 전 읽음/);
});
await ta('일부를 못 읽은 결과도 오늘 것이면 다시 훑지 않고 경고만 보여준다', async () => {
  const rooms = fakeScan('room');
  const m = await mount({
    storage: fakeStorage({ [CACHE_KEY]: { ...cached, failed: ['차량 훑기 실패: HTTP 500'] } }), rooms,
  });
  assert.equal(rooms.calls.length, 0);
  assert.match(m.text('warn'), /차량 훑기 실패: HTTP 500/);
});
await ta('어제 읽은 것은 버리고 다시 훑는다(하루에 한 번)', async () => {
  const rooms = fakeScan('room', { [TODAY]: day('room', TODAY, [room({ mine: true, title: '새로 읽은 것' })]) });
  const m = await mount({
    storage: fakeStorage({ [CACHE_KEY]: { ...cached, at: NOW - 20 * 3600_000, start: '2026-09-16' } }), rooms,
  });
  assert.equal(rooms.calls.length, 1);
  assert.equal(rooms.calls[0][0], TODAY);
  assert.match(m.items()[0].textContent, /새로 읽은 것/);
  assert.equal(m.storage.data[CACHE_KEY].start, TODAY);
  assert.equal(m.storage.data[CACHE_KEY].at, NOW);
});
await ta('이름이 바뀌면 담긴 것을 믿지 않는다', async () => {
  const rooms = fakeScan('room');
  await mount({ storage: fakeStorage({ [CACHE_KEY]: cached, myName: '홍길동' }), rooms });
  assert.equal(rooms.calls.length, 1);
});
await ta('기간 설정이 바뀌면 그 기간을 훑는다', async () => {
  const rooms = fakeScan('room');
  await mount({ storage: fakeStorage({ [CACHE_KEY]: cached, spanDays: '7' }), rooms });
  assert.equal(rooms.calls.length, 1);
  assert.equal(rooms.calls[0].length, 7);
});
await ta('새로고침 버튼은 담긴 것을 먼저 그려 둔 채 다시 훑어 바꿔 끼운다', async () => {
  const doc = homeDoc();
  let seen = null;
  const rooms = fakeScan('room', { [TODAY]: day('room', TODAY, [room({ mine: true, title: '새로 읽은 것' })]) }, {
    onCall: () => {
      seen = {
        items: doc.querySelectorAll('li.krs-mine-item').length,
        note: doc.querySelector('[data-role="note"]').textContent,
      };
    },
  });
  const m = await mount({ doc, storage: fakeStorage({ [CACHE_KEY]: cached }), rooms });
  assert.equal(rooms.calls.length, 0);
  m.root.querySelector('[data-act="refresh"]').click();
  await tick();
  assert.equal(rooms.calls.length, 1);
  assert.equal(seen.items, 1, '훑기 시작 전에 담긴 것이 먼저 보여야 한다');
  assert.match(seen.note, /훑는 중/);
  assert.match(m.items()[0].textContent, /새로 읽은 것/);
  assert.equal(m.storage.data[CACHE_KEY].at, NOW);
});

console.log('예약이 없으면 머리 한 줄');
await ta('머리 줄에는 건수 칩과 읽은 때만 — "없습니다·찾지 못했습니다" 같은 말은 적지 않는다', async () => {
  const m = await mount({ storage: fakeStorage({ myName: '홍길동' }) });
  const head = m.root.querySelector('.krs-mine-head');
  const body = m.root.querySelector('.krs-mine-body');
  assert.equal(m.text('rooms'), '0');
  assert.equal(m.text('cars'), '0');
  assert.equal(head.querySelector('[data-role="rooms"]').classList.contains('on'), false);
  assert.doesNotMatch(head.textContent, /없습니다|못했습니다/);
  assert.match(head.querySelector('[data-role="note"]').textContent, /9\/17~10\/16 · 방금 읽음/);
  assert.equal(body.querySelectorAll('li').length, 0);
  assert.equal(body.textContent.trim(), '', '본문에 글이 남으면 한 줄로 접히지 않는다');
});
await ta('버튼은 글자가 아니라 아이콘이고, 무엇인지는 툴팁·aria-label 이 말한다', async () => {
  const m = await mount();
  for (const b of m.root.querySelectorAll('button')) {
    assert.ok(b.querySelector('svg'), '아이콘이 없다');
    assert.equal(b.textContent.trim(), '');
    assert.ok(b.getAttribute('aria-label'), 'aria-label 이 없다');
    assert.ok(b.title);
  }
});
await ta('예약이 있으면 칩이 도드라지고 본문에 목록을 둔다', async () => {
  const m = await mount({ storage: fakeStorage({ [CACHE_KEY]: cached, myName: '' }) });
  assert.equal(m.text('rooms'), '1');
  assert.equal(m.root.querySelector('[data-role="rooms"]').classList.contains('on'), true);
  assert.equal(m.text('cars'), '0');
  assert.equal(m.root.querySelectorAll('.krs-mine-body li.krs-mine-item').length, 1);
});

console.log('접고 펴기 — 목록이 있으면 머리 줄이나 화살표 버튼으로 접는다 (2026-10-04 사용자 지정)');
{
  const toggle = (m) => m.root.querySelector('button[data-act="toggle"]');
  const list = (m) => m.root.querySelector('[data-role="list"]');
  const canOpen = (m) => m.root.querySelector('.krs-mine-head').classList.contains('can-open');
  await ta('목록이 있으면 화살표 버튼이 나오고 처음에는 펴져 있다 — 접을 것이 없으면 버튼도 없다', async () => {
    const m = await mount({ storage: fakeStorage({ [CACHE_KEY]: cached }) });
    assert.deepEqual([toggle(m).hidden, toggle(m).getAttribute('aria-expanded'), toggle(m).title, list(m).hidden, canOpen(m)], [false, 'true', '접기', false, true]);
    const none = await mount();
    assert.deepEqual([toggle(none).hidden, canOpen(none)], [true, false]);
  });
  await ta('화살표 버튼을 누르면 목록이 접히고 건수 칩은 그대로다 — 접은 것은 기억한다. 머리 줄을 눌러도 같은 일이다', async () => {
    const m = await mount({ storage: fakeStorage({ [CACHE_KEY]: cached }) });
    toggle(m).click();
    await tick();
    assert.deepEqual([list(m).hidden, toggle(m).getAttribute('aria-expanded'), toggle(m).title, m.text('rooms'), m.storage.data[FOLD_KEY]],
      [true, 'false', '펼치기', '1', true]);
    m.root.querySelector('.krs-mine-title').click();
    await tick();
    assert.deepEqual([list(m).hidden, toggle(m).title, m.storage.data[FOLD_KEY]], [false, '접기', false]);
    assert.equal(m.panelCalls.length, 0, '접고 펴는 것은 패널을 열지 않는다');
  });
  await ta('접어 두었으면 다음에 홈을 열어도 접힌 채로 시작한다 — 새로고침으로 다시 읽어도 접힌 채다', async () => {
    const rooms = fakeScan('room', { [TODAY]: day('room', TODAY, [room({ mine: true })]) });
    const m = await mount({ storage: fakeStorage({ [CACHE_KEY]: cached, [FOLD_KEY]: true }), rooms });
    assert.deepEqual([list(m).hidden, toggle(m).hidden, toggle(m).title, m.items().length, m.text('rooms')], [true, false, '펼치기', 1, '1']);
    m.root.querySelector('[data-act="refresh"]').click();
    await tick();
    assert.deepEqual([rooms.calls.length, list(m).hidden], [1, true]);
  });
  await ta('다른 창의 홈에서 접으면 이 카드도 접힌다', async () => {
    const m = await mount({ storage: fakeStorage({ [CACHE_KEY]: cached }) });
    await m.storage.set({ [FOLD_KEY]: true });
    assert.equal(list(m).hidden, true);
  });
  await ta('아무것도 없는 카드의 머리 줄은 눌러도 아무 일이 없다', async () => {
    const m = await mount();
    m.root.querySelector('.krs-mine-title').click();
    await tick();
    assert.deepEqual([list(m).hidden, FOLD_KEY in m.storage.data], [false, false]);
  });
  await ta('처음의 접힘 읽기가 늦게 와도, 그 사이에 다른 창에서 편 것을 덮지 않는다', async () => {
    // 접힘 값을 읽는 첫 요청만 붙잡아 둔다 — 예전 값(접힘)을 들고 늦게 돌아온다.
    const storage = fakeStorage({ [CACHE_KEY]: cached, [FOLD_KEY]: true });
    const get = storage.get;
    let release = null;
    storage.get = async (keys) => {
      const out = await get(keys);
      if (keys === FOLD_KEY && !release) await new Promise((r) => { release = r; });
      return out;
    };
    const m = await mount({ storage });
    assert.equal(list(m).hidden, false, '아직 못 읽었으니 펴져 있다');
    await storage.set({ [FOLD_KEY]: false });   // 다른 창에서 폈다
    release();
    await tick();
    assert.deepEqual([list(m).hidden, storage.data[FOLD_KEY]], [false, false]);
  });
}

console.log('못 읽은 날은 빼고 말한다');
await ta('확신 없는 날은 제외하고 몇 일인지 적는다', async () => {
  const d2 = '2026-09-18';
  const rooms = fakeScan('room', { [d2]: day('room', d2, [], false, '달력은 3건인데 표에서 0건') });
  const m = await mount({ rooms });
  assert.match(m.text('warn'), /1일은 확인 불가라 제외/);
});
await ta('한쪽 훑기가 죽으면 실패 이유와 못 읽은 날 수를 적고, 그 사실을 같이 담는다', async () => {
  const rooms = fakeScan('room', { [TODAY]: day('room', TODAY, [room({ mine: true })]) });
  const cars = fakeScan('car', {}, { fail: new Error('HTTP 500') });
  const m = await mount({ rooms, cars });
  assert.equal(m.items().length, 1, '읽은 회의실 예약은 보여야 한다');
  assert.match(m.text('warn'), /차량 훑기 실패: HTTP 500/);
  assert.match(m.text('warn'), /30일은 아예 읽지 못했습니다/);
  const saved = m.storage.data[CACHE_KEY];
  assert.equal(saved.failed.length, 1);
  assert.equal(saved.unread.length, 30);
});
await ta('이름이 없으면 넣으라고 한다', async () => {
  const m = await mount();
  assert.match(m.text('warn'), /이름을 넣으면/);
});
await ta('한 날도 못 읽었고 로그인이 끊긴 것이면 그 사실을 말하고 담지 않는다', async () => {
  const err = new AuthError('로그인이 필요합니다. eclass 에 로그인한 뒤 다시 조회하세요.');
  const m = await mount({ rooms: fakeScan('room', {}, { fail: err }), cars: fakeScan('car', {}, { fail: err }) });
  assert.match(m.text('warn'), /로그인이 필요합니다/);
  assert.equal(m.text('rooms'), '', '한 날도 못 읽었는데 0 건이라고 하면 안 된다');
  assert.equal(m.storage.data[CACHE_KEY], undefined);
  assert.equal(m.items().length, 0);
  assert.equal(m.root.querySelector('[data-role="warn"] a'), null, '포털 상태를 모르면 다시 로그인 링크를 달지 않는다');
});
await ta('포털 로그인이 풀린 것이면 홈으로 가는 다시 로그인 링크를 단다', async () => {
  const err = new AuthError('로그인이 필요합니다. eclass 로그인이 만료됐습니다.', { portal: 'expired' });
  const m = await mount({ rooms: fakeScan('room', {}, { fail: err }), cars: fakeScan('car', {}, { fail: err }) });
  const a = m.root.querySelector('[data-role="warn"] a');
  assert.ok(a, '링크가 없다');
  assert.match(a.href, /eClassVer4\/Home\/Index/);
  assert.match(a.textContent, /다시 로그인/);
});
await ta('한 날도 못 읽었지만 담긴 것이 있으면 그것을 보여주고 언제 것인지 말한다', async () => {
  const err = new Error('응답이 20초 안에 오지 않았습니다.');
  const m = await mount({
    storage: fakeStorage({ [CACHE_KEY]: cached }),
    rooms: fakeScan('room', {}, { fail: err }), cars: fakeScan('car', {}, { fail: err }),
  });
  m.root.querySelector('[data-act="refresh"]').click();
  await tick();
  assert.equal(m.rooms.calls.length, 1);
  assert.equal(m.items().length, 1);
  assert.match(m.text('warn'), /읽어 둔 것입니다/);
  assert.match(m.text('warn'), /응답이 20초/);
});

console.log('패널과 주고받기');
await ta('패널이 캐시를 지우면(예약·취소 뒤) 다시 훑는다', async () => {
  const rooms = fakeScan('room');
  const m = await mount({ storage: fakeStorage({ [CACHE_KEY]: cached }), rooms });
  assert.equal(rooms.calls.length, 0);
  await m.storage.remove(CACHE_KEY);
  await tick(30);
  assert.equal(rooms.calls.length, 1);
});
await ta('내 이름·예약 기록·기간이 바뀌어도 다시 훑는다', async () => {
  const rooms = fakeScan('room');
  const m = await mount({ storage: fakeStorage({ [CACHE_KEY]: cached }), rooms });
  await m.storage.set({ myName: '홍길동' });
  await tick(30);
  assert.equal(rooms.calls.length, 1);
});
await ta('알림이 몰려오면 모아서 한 번만 훑는다', async () => {
  const rooms = fakeScan('room');
  const m = await mount({ storage: fakeStorage({ [CACHE_KEY]: cached }), rooms });
  await m.storage.remove(CACHE_KEY);
  await m.storage.set({ justBooked: [] });
  await tick(30);
  assert.equal(rooms.calls.length, 1);
});
await ta('안 보이는 탭은 보일 때 훑는다', async () => {
  let shown = false;
  const rooms = fakeScan('room');
  const m = await mount({ storage: fakeStorage({ [CACHE_KEY]: cached }), rooms, visible: () => shown });
  await m.storage.remove(CACHE_KEY);
  await tick(30);
  assert.equal(rooms.calls.length, 0, '안 보이는데 훑었다');
  shown = true;
  m.doc.dispatchEvent(new m.doc.defaultView.Event('visibilitychange'));
  await tick(30);
  assert.equal(rooms.calls.length, 1);
});
await ta('한 건을 누르면 날짜·종류를 남기고 패널을 연다', async () => {
  const rooms = fakeScan('room', { [TODAY]: day('room', TODAY, [room({ mine: true })]) });
  const cars = fakeScan('car', {
    '2026-09-20': day('car', '2026-09-20', [{ date: '2026-09-20', room: '카니발', start: 540, end: 600, owner: '', mine: true }]),
  });
  const m = await mount({ rooms, cars });
  m.items()[1].click();
  await tick();
  assert.deepEqual(m.storage.data[JUMP_KEY], { date: '2026-09-20', mode: 'car', at: NOW });
  assert.equal(m.panelCalls.length, 1);
});
await ta('패널 열기 버튼', async () => {
  const m = await mount();
  m.root.querySelector('[data-act="panel"]').click();
  await tick();
  assert.equal(m.panelCalls.length, 1);
});
await ta('패널을 못 열면 어떻게 열지 말한다', async () => {
  const m = await mount({ openPanel: async () => ({ ok: false, error: 'no gesture' }) });
  m.root.querySelector('[data-act="panel"]').click();
  await tick();
  assert.match(m.text('warn'), /툴바의 확장 아이콘/);
});

console.log('근태(출장·외근·휴가)도 예약과 같은 모양으로 섞인다');
{
  // 배경이 담아 주는 모양(src/plans.js) 그대로다. 종류 이름은 HR 목록의 근태종류 이름.
  const hr = (docNo, kindName, formId, from, to, over = {}) => ({
    docNo, kindName, formId, from, to, status: '5', statusName: '결재완료',
    start: '', end: '', gubun: '시간', reason: '', ...over,
  });
  const HR = [
    hr('T-1', '국내출장', 'TR', '2026-09-20', '2026-09-22', { start: '07:00', end: '20:00', reason: '착수회의 참석 - 대전' }),
    hr('O-1', '외근', 'TRO', '2026-09-18', '2026-09-18', { start: '13:00', end: '15:00', reason: '과제 협의' }),
    hr('E-1', '교육', 'TRO', '2026-09-19', '2026-09-19', { start: '09:00', end: '12:00', reason: '안전관리 교육' }),
    hr('L-1', '연차', 'LV', '2026-09-21', '2026-09-21', { gubun: '전일', status: '3', statusName: '결재요청' }),
    hr('L-2', '체력관리', 'LV', '2026-09-25', '2026-09-25', { gubun: '전일' }),
    // 아래는 카드에 올리지 않는다: 세 묶음 밖의 종류, 임시저장, 지난 것(출장만은 다녀온 뒤 4주까지 보인다), 기간 밖.
    hr('X-1', '외출', 'ET', '2026-09-18', '2026-09-18', { start: '14:00', end: '15:00', reason: '병원' }),
    hr('X-2', '정기 건강검진', 'LV', '2026-09-23', '2026-09-23', { gubun: '전일' }),
    hr('X-3', '국내출장', 'TR', '2026-09-24', '2026-09-24', { start: '07:00', end: '20:00', status: '1', statusName: '임시저장' }),
    hr('X-4', '국내출장', 'TR', '2026-09-10', '2026-09-11', { start: '07:00', end: '20:00' }),   // 엿새 전에 끝난 출장 → 보인다
    hr('X-6', '국내출장', 'TR', '2026-08-15', '2026-08-16', { start: '07:00', end: '20:00' }),   // 한 달 전 → 안 보인다(8주로 고르면 보인다)
    hr('X-7', '외근', 'TRO', '2026-09-15', '2026-09-15', { start: '13:00', end: '15:00' }),      // 지난 외근 → 안 보인다
    hr('X-5', '연차', 'LV', '2026-11-30', '2026-11-30', { gubun: '전일' }),
  ];
  const kinds = (m) => m.items().map((li) => li.querySelector('.krs-mine-kind').textContent);

  t('카드에 올릴 근태만 고른다 — 출장·외근(교육)·휴가(연차·체력단련), 오늘부터 기간 끝까지. 출장만은 다녀온 뒤 4주까지(여비를 정산해야 한다)', () => {
    const edge = [hr('D-28', '국내출장', 'TR', '2026-08-20', '2026-08-20'), hr('D-29', '국내출장', 'TR', '2026-08-19', '2026-08-19')];
    assert.deepEqual(planItems(edge, TODAY, '2026-10-16').map((p) => p.docNo), ['D-28'], '꼭 4주 전에 끝난 출장까지 보인다');
    const got = planItems(HR, TODAY, '2026-10-16');
    assert.deepEqual(got.map((p) => [p.docNo, p.group, p.label, p.past]), [
      ['X-4', 'trip', '출장', true], ['O-1', 'out', '외근', false], ['E-1', 'out', '교육', false], ['T-1', 'trip', '출장', false],
      ['L-1', 'leave', '연차', false], ['L-2', 'leave', '체력단련', false],
    ]);
    assert.deepEqual([got[1].timed, got[1].from.minutes, got[1].to.minutes], [true, 780, 900]);
    assert.equal(got[4].timed, false);
  });
  await ta('제목은 WORKSPACE 이고 칩은 회의실·차량·출장·외근·휴가다', async () => {
    const m = await mount();
    assert.equal(m.root.querySelector('.krs-card-title').textContent, 'WORKSPACE');
    assert.deepEqual([...m.root.querySelectorAll('.krs-card-chip > span')].map((s) => s.textContent),
      ['회의실', '차량', '출장', '외근', '휴가']);
    assert.match(m.root.querySelector('[data-role="leave"]').closest('.krs-card-chip').title, /연차·체력단련/);
  });
  await ta('오늘 읽어 둔 근태가 없으면 배경에 부탁하고, 예약과 날짜순으로 섞어 건수를 칩에 적는다', async () => {
    const rooms = fakeScan('room', { '2026-09-19': day('room', '2026-09-19', [room({ date: '2026-09-19', mine: true, start: 840, end: 900 })]) });
    const m = await mount({ rooms, plans: fakePlans(HR) });
    assert.deepEqual(m.plans.calls, [false]);
    assert.deepEqual(kinds(m), ['출장', '외근', '교육', '회의실', '출장', '연차', '체력단련']);
    assert.deepEqual(['rooms', 'cars', 'trip', 'out', 'leave'].map(m.text), ['1', '0', '2', '2', '2']);
    assert.equal(m.root.querySelector('[data-role="out"]').classList.contains('on'), true);
    assert.equal(m.text('planWarn'), '');
  });
  await ta('근태 한 건: 종류 딱지 · 날짜와 시각(시각이 없으면 구분) · 결재 상태 · 내용', async () => {
    const m = await mount({ plans: fakePlans(HR) });
    const [past, out, , trip, leave] = m.items();
    assert.ok(past.classList.contains('past'));
    assert.match(past.querySelector('.krs-mine-when').textContent, /^9\/10 \(목\) 07:00 ~ 9\/11 \(금\) 20:00$/);
    assert.equal(past.querySelector('.krs-mine-past').textContent, '다녀온 출장 · 여비계산서 없음', '여비계산서 목록을 읽었으면 단계를 옆에 적는다');
    assert.equal(trip.querySelector('.krs-mine-past'), null, '아직 안 간 출장에는 적지 않는다');
    assert.match(out.querySelector('.krs-mine-when').textContent, /^9\/18 \(금\) 13:00~15:00$/);
    assert.equal(out.querySelector('.krs-mine-what').textContent, '과제 협의');
    assert.ok(out.querySelector('.krs-mine-kind').classList.contains('out'));
    assert.match(trip.querySelector('.krs-mine-when').textContent, /^9\/20 \(일\) 07:00 ~ 9\/22 \(화\) 20:00$/);
    assert.equal(trip.querySelector('.krs-mine-status').textContent, '결재완료');
    assert.match(leave.querySelector('.krs-mine-when').textContent, /^9\/21 \(월\) 전일$/);
    assert.equal(leave.querySelector('.krs-mine-status').textContent, '결재요청');
    assert.equal(leave.querySelector('.krs-mine-sub'), null, '내용이 없으면 둘째 줄도 없다');
  });
  await ta('다녀온 출장은 줄 끝의 눈 아이콘으로 한 건씩 숨긴다 — 숨긴 것은 기억되고, 머리 줄에 전체 보기 눈 아이콘이 나온다', async () => {
    const m = await mount({ plans: fakePlans(HR) });
    const hideOf = (li) => li.querySelector('button.krs-mine-hide');
    const all = m.root.querySelector('[data-act="all"]');
    const [past, out] = m.items();
    assert.deepEqual([hideOf(past).dataset.act, hideOf(past).dataset.doc, hideOf(past).getAttribute('aria-label')], ['hide', 'X-4', '이 출장 숨기기']);
    assert.equal(hideOf(out), null, '다녀온 출장에만 있다(외근·앞으로의 출장에는 없다)');
    assert.equal(m.items().filter(hideOf).length, 1);
    assert.equal(all.hidden, true, '숨긴 것이 없으면 머리 줄의 눈 아이콘도 없다');
    hideOf(past).click();
    await tick();
    assert.deepEqual(m.items().map((li) => li.querySelector('.krs-mine-kind').textContent), ['외근', '교육', '출장', '연차', '체력단련']);
    assert.equal(m.panelCalls.length, 0, '숨기기는 패널을 열지 않는다');
    assert.equal(m.text('trip'), '1', '칩은 숨기지 않은 건수다');
    assert.deepEqual(m.storage.data[HIDDEN_KEY], ['X-4']);
    assert.deepEqual([all.hidden, all.getAttribute('aria-pressed'), all.title], [false, 'false', '전체 보기 — 숨긴 출장 1건까지 봅니다']);
    // 다시 열어도(새로 붙여도) 숨긴 채다
    const again = await mount({ storage: m.storage, plans: fakePlans(HR) });
    assert.equal(again.items().length, 5);
    assert.equal(again.root.querySelector('[data-act="all"]').hidden, false);
  });
  await ta('전체 보기(머리 줄의 눈 아이콘)를 켜면 숨긴 출장까지 흐리게 보인다 — 다시 누르면 가리고, 그 줄의 눈 아이콘은 그 출장을 다시 늘 보이게 한다', async () => {
    const storage = fakeStorage({ [HIDDEN_KEY]: ['X-4'] });
    const m = await mount({ storage, plans: fakePlans(HR) });
    const all = m.root.querySelector('[data-act="all"]');
    assert.equal(m.items().length, 5);
    all.click();
    await tick();
    const tucked = m.items()[0];
    assert.equal(m.items().length, 6);
    assert.deepEqual([tucked.classList.contains('tucked'), tucked.classList.contains('past')], [true, true]);
    assert.deepEqual([all.getAttribute('aria-pressed'), all.title], ['true', '숨긴 출장 1건까지 보는 중 — 누르면 다시 가립니다']);
    assert.equal(m.text('trip'), '1', '전체 보기에서도 칩은 숨기지 않은 건수다');
    assert.deepEqual(storage.data[HIDDEN_KEY], ['X-4'], '전체 보기는 숨긴 것을 지우지 않는다');
    const eye = tucked.querySelector('button.krs-mine-hide');
    assert.deepEqual([eye.dataset.act, eye.getAttribute('aria-label')], ['show', '이 출장 다시 보이기']);
    all.click();
    await tick();
    assert.deepEqual([m.items().length, all.getAttribute('aria-pressed')], [5, 'false'], '다시 누르면 가린다');
    all.click();
    await tick();
    m.items()[0].querySelector('button.krs-mine-hide').click();
    await tick();
    assert.deepEqual([storage.data[HIDDEN_KEY], m.items().length, m.items()[0].classList.contains('tucked'), all.hidden, m.text('trip')], [[], 6, false, true, '2'],
      '숨긴 것이 없어지면 전체 보기도 끝난다');
    assert.equal(m.panelCalls.length, 0);
  });
  await ta('숨긴 출장이 목록에서 빠진 뒤(2주가 지남)에는 그 번호를 더 세지 않는다', async () => {
    const storage = fakeStorage({ [HIDDEN_KEY]: ['GONE-1'] });
    const m = await mount({ storage, plans: fakePlans(HR) });
    assert.equal(m.items().length, 6);
    assert.equal(m.root.querySelector('[data-act="all"]').hidden, true);
    m.items()[0].querySelector('button.krs-mine-hide').click();
    await tick();
    assert.deepEqual(storage.data[HIDDEN_KEY], ['X-4'], '숨길 때 없어진 번호는 버린다');
  });
  // 다녀온 출장 가운데 여비 정산이 덜 끝난 것만 남는다(2026-10-04 사용자 지정) — 사후정산을 완료했거나 증빙을 담당자에게 보낸 출장은
  // 올리지 않고, 몇 주까지 남길지(2주·4주·안 봄)는 근태 탭의 신청 내역에서 고른 값을 따른다.
  const bt = (seq, from, to, pre, post) => ({ seq, href: '', pre, from, to, location: '', writer: '김거화', written: '', travelers: [{ name: '김거화', post, trseq: '1' }] });
  const pastOf = (m) => m.items().filter((li) => li.classList.contains('past')).map((li) => li.querySelector('.krs-mine-past').textContent);
  await ta('다녀온 출장이 남아 있으면 여비계산서 목록을 읽어 단계를 적는다 — 8주 전부터 오늘까지, 하루에 한 번', async () => {
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([bt('501', '2026-09-10', '2026-09-11', '완료', '작성')]) });
    assert.deepEqual(m.trips.calls, [{ from: '2026-07-23', to: TODAY }]);
    assert.deepEqual(pastOf(m), ['다녀온 출장 · 사후정산 작성']);
    assert.deepEqual([m.storage.data[STAGES_KEY].day, m.storage.data[STAGES_KEY].rows.map((r) => r.seq)], [TODAY, ['501']]);
    const again = await mount({ storage: m.storage, plans: fakePlans(HR), trips: fakeTrips() });
    assert.deepEqual(again.trips.calls, [], '오늘 읽어 둔 것이 있으면 다시 읽지 않는다');
    assert.deepEqual(pastOf(again), ['다녀온 출장 · 사후정산 작성']);
  });
  await ta('사후정산이 완료된 다녀온 출장은 카드에 올리지 않는다 — 칩의 건수에서도 빠진다', async () => {
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([bt('501', '2026-09-10', '2026-09-11', '완료', '완료')]) });
    assert.deepEqual(kinds(m), ['외근', '교육', '출장', '연차', '체력단련']);
    assert.equal(m.text('trip'), '1');
    assert.equal(m.root.querySelector('[data-act="all"]').hidden, true, '숨긴 것이 아니라 올리지 않은 것이다');
  });
  await ta('증빙을 담당자에게 보낸 출장도 올리지 않는다 — 남은 다녀온 출장이 없으면 여비계산서 목록도 읽지 않는다', async () => {
    const m = await mount({ storage: fakeStorage({ [SENT_KEY]: { 'X-4': { at: NOW, channel: '쪽지', to: '홍길동', account: 'RND' } } }), plans: fakePlans(HR) });
    assert.deepEqual(kinds(m), ['외근', '교육', '출장', '연차', '체력단련']);
    assert.deepEqual(m.trips.calls, []);
  });
  await ta('여비계산서 목록을 못 읽으면 다녀온 출장은 그대로 보인다 — 모르는 것을 끝났다고 가리지 않는다', async () => {
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([], { fail: new Error('로그인이 필요합니다.') }) });
    assert.deepEqual(pastOf(m), ['다녀온 출장']);
    assert.equal(m.storage.data[STAGES_KEY], undefined, '못 읽은 것을 담지 않는다');
  });
  await ta('다녀온 출장을 몇 주까지 남길지는 근태 탭에서 고른 값을 따른다 — 8주면 한 달 전 출장도, 안 봄이면 하나도', async () => {
    const eight = await mount({ storage: fakeStorage({ [BACK_KEY]: 8 }), plans: fakePlans(HR) });
    assert.deepEqual(kinds(eight), ['출장', '출장', '외근', '교육', '출장', '연차', '체력단련']);
    assert.equal(eight.items()[0].querySelector('.krs-mine-when').textContent, '8/15 (토) 07:00 ~ 8/16 (일) 20:00');
    const none = await mount({ storage: fakeStorage({ [BACK_KEY]: 0 }), plans: fakePlans(HR) });
    assert.deepEqual(kinds(none), ['외근', '교육', '출장', '연차', '체력단련']);
    assert.deepEqual(none.trips.calls, [], '지난 출장을 안 보면 여비계산서 목록도 읽지 않는다');
  });
  await ta('패널에서 기간을 바꾸거나 증빙을 보내면 열려 있는 홈 카드도 곧 따라온다', async () => {
    const m = await mount({ plans: fakePlans(HR) });
    assert.equal(pastOf(m).length, 1);
    await m.storage.set({ [BACK_KEY]: 8 });
    await tick();
    assert.equal(pastOf(m).length, 2);
    await m.storage.set({ [SENT_KEY]: { 'X-6': { at: NOW } } });
    await tick();
    assert.deepEqual(m.items().filter((li) => li.classList.contains('past')).map((li) => li.querySelector('.krs-mine-when').textContent), ['9/10 (목) 07:00 ~ 9/11 (금) 20:00']);
    // 패널이 여비계산서 목록을 새로 읽어 담았다(사후정산을 완료했다)
    await m.storage.set({ [STAGES_KEY]: { day: TODAY, since: '2026-07-23', me: '김거화', rows: [bt('501', '2026-09-10', '2026-09-11', '완료', '완료')] } });
    await tick();
    assert.equal(pastOf(m).length, 0);
    await m.storage.set({ [BACK_KEY]: 0 });
    await tick();
    assert.equal(m.text('trip'), '1');
  });
  await ta('오늘에 걸친 여러 날 출장은 오늘 것으로 도드라진다', async () => {
    const m = await mount({ plans: fakePlans([hr('T-0', '국내출장', 'TR', '2026-09-16', '2026-09-18', { start: '07:00', end: '20:00' })]) });
    assert.equal(m.items().length, 1);
    assert.ok(m.items()[0].classList.contains('today'));
  });
  await ta('오늘 읽어 둔 근태가 있으면(패널이 읽었든) 배경에 부탁하지 않는다', async () => {
    const storage = fakeStorage({ [PLANS_KEY]: { day: TODAY, since: '2026-01-01', items: HR } });
    const m = await mount({ storage });
    assert.deepEqual(m.plans.calls, []);
    assert.equal(m.text('trip'), '2');
    assert.equal(m.items().length, 6);
  });
  await ta('어제 읽어 둔 근태는 믿지 않고 다시 부탁한다', async () => {
    const storage = fakeStorage({ [PLANS_KEY]: { day: '2026-09-16', since: '2026-01-01', items: HR } });
    const m = await mount({ storage, plans: fakePlans([]) });
    assert.deepEqual(m.plans.calls, [false]);
    assert.equal(m.text('trip'), '0');
  });
  await ta('근태를 못 읽으면 칩은 줄표로 두고 그 사실을 적는다 — 예약은 그대로 보인다', async () => {
    const rooms = fakeScan('room', { [TODAY]: day('room', TODAY, [room({ mine: true })]) });
    const m = await mount({ rooms, plans: fakePlans([], { error: '로그인이 필요합니다. eclass 로그인이 만료됐습니다.' }) });
    assert.equal(m.items().length, 1);
    assert.equal(m.text('rooms'), '1');
    assert.deepEqual(['trip', 'out', 'leave'].map(m.text), ['', '', ''], '못 읽었는데 0 건이라고 하면 안 된다');
    assert.match(m.text('planWarn'), /근태\(출장·외근·휴가\)는 읽지 못했습니다: 로그인이 필요합니다/);
  });
  await ta('새로고침 버튼은 근태도 다시 읽어 달라고 한다(force)', async () => {
    const storage = fakeStorage({ [CACHE_KEY]: cached, [PLANS_KEY]: { day: TODAY, since: '2026-01-01', items: [] } });
    const plans = fakePlans(HR, { storage });
    const m = await mount({ storage, plans });
    assert.deepEqual(plans.calls, []);
    m.root.querySelector('[data-act="refresh"]').click();
    await tick();
    assert.deepEqual(plans.calls, [true]);
    assert.deepEqual(['trip', 'out', 'leave'].map(m.text), ['2', '2', '2']);
  });
  await ta('패널이 근태를 올린 뒤 담아 둔 것을 지우면 근태만 다시 읽는다(예약은 다시 훑지 않는다)', async () => {
    const storage = fakeStorage({ [CACHE_KEY]: cached, [PLANS_KEY]: { day: TODAY, since: '2026-01-01', items: [] } });
    const plans = fakePlans(HR, { storage });
    const m = await mount({ storage, plans });
    await storage.remove(PLANS_KEY);
    await tick(30);
    assert.deepEqual(plans.calls, [false]);
    assert.equal(m.rooms.calls.length, 0);
    assert.equal(m.text('leave'), '2');
  });
  await ta('패널이 근태를 새로 담으면 부탁 없이 그것을 그린다', async () => {
    const storage = fakeStorage({ [CACHE_KEY]: cached, [PLANS_KEY]: { day: TODAY, since: '2026-01-01', items: [] } });
    const m = await mount({ storage });
    assert.equal(m.text('trip'), '0');
    await storage.set({ [PLANS_KEY]: { day: TODAY, since: '2026-01-01', items: HR } });
    await tick();
    assert.deepEqual(m.plans.calls, []);
    assert.equal(m.text('trip'), '2');
  });
  await ta('근태 건을 누르면 근태 탭으로 가 달라는 부탁을 남기고 패널을 연다', async () => {
    const m = await mount({ plans: fakePlans(HR) });
    m.items()[1].click();   // [0] 은 지난 출장(9/10)이다
    await tick();
    assert.deepEqual(m.storage.data[JUMP_KEY], { date: '2026-09-18', mode: 'attend', at: NOW });
    assert.equal(m.panelCalls.length, 1);
  });
  await ta('카드를 끄면 읽는 중이던 근태가 뒤늦게 와도 아무것도 하지 않는다', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const doc = homeDoc();
    const storage = fakeStorage({ [CACHE_KEY]: cached });
    const card = createHomeCard(doc, {
      storage, onChanged: storage.onChanged, now: () => NOW, today: () => TODAY,
      scanRooms: fakeScan('room'), scanCars: fakeScan('car'), visible: () => true, debounceMs: 5,
      loadPlans: async () => { await gate; return { items: HR, error: '' }; },
      openPanel: async () => ({ ok: true }),
    });
    await tick();
    card.destroy();
    release();
    await card.ready;
    assert.equal(doc.getElementById(ROOT_ID), null);
    assert.equal(card.root.querySelectorAll('li.krs-mine-item').length, 1, '뗀 카드에 뒤늦게 온 근태를 그렸다');
  });
}

console.log('확장이 다시 올려져 끊긴 카드');
{
  /** 끊긴 뒤의 chrome.storage 처럼 부르면 던진다. */
  const cut = (storage, live) => {
    const dead = () => { throw new Error('Extension context invalidated.'); };
    return { ...storage, get: (k) => (live() ? storage.get(k) : dead()), set: (o) => (live() ? storage.set(o) : dead()) };
  };
  await ta('새로고침을 눌러도 훑지 않고, 페이지를 새로고침하라고 말한다', async () => {
    let live = true;
    const rooms = fakeScan('room');
    const m = await mount({ storage: cut(fakeStorage({ [CACHE_KEY]: cached }), () => live), rooms, alive: () => live });
    live = false;
    m.root.querySelector('[data-act="refresh"]').click();
    await tick();
    assert.equal(rooms.calls.length, 0);
    assert.match(m.text('warn'), /페이지를 새로고침/);
    assert.equal(m.items().length, 1, '읽어 둔 것은 그대로 보여야 한다');
  });
  await ta('한 건을 눌러도 부탁을 남기거나 패널을 열려 하지 않는다', async () => {
    let live = true;
    const m = await mount({ storage: cut(fakeStorage({ [CACHE_KEY]: cached }), () => live), alive: () => live });
    live = false;
    m.items()[0].click();
    await tick();
    assert.equal(m.storage.data[JUMP_KEY], undefined);
    assert.equal(m.panelCalls.length, 0);
    assert.match(m.text('warn'), /페이지를 새로고침/);
  });
  await ta('훑는 사이에 끊기면 "훑기 실패" 대신 같은 안내를 한다', async () => {
    let live = true;
    const rooms = fakeScan('room', {}, { onCall: () => { live = false; } });
    const m = await mount({ storage: cut(fakeStorage(), () => live), rooms, alive: () => live });
    assert.match(m.text('warn'), /페이지를 새로고침/);
    assert.doesNotMatch(m.text('warn'), /훑기 실패/);
    assert.equal(m.storage.data[CACHE_KEY], undefined);
  });
  await ta('버튼도 목록도 아닌 곳을 누른 것에는 말하지 않는다', async () => {
    let live = true;
    const m = await mount({ storage: cut(fakeStorage({ [CACHE_KEY]: cached }), () => live), alive: () => live });
    live = false;
    m.root.querySelector('.krs-mine-title').click();
    await tick();
    assert.doesNotMatch(m.text('warn'), /페이지를 새로고침/);
  });
}

console.log('켜고 끄기 (패널 머리의 체크박스)');
t('값이 없으면 켠 것, false 일 때만 끈 것', () => {
  assert.equal(homeEnabled(undefined), true);
  assert.equal(homeEnabled(true), true);
  assert.equal(homeEnabled(false), false);
});

/** 설정을 따라 붙이는 쪽(startHome)을 가짜로 돌린다. wait:false 면 첫 조회를 기다리지 않는다. */
async function start(init = {}, { rooms = fakeScan('room'), cars = fakeScan('car'), wait = true } = {}) {
  const storage = fakeStorage(init);
  const doc = homeDoc();
  const started = startHome(doc, {
    storage, onChanged: storage.onChanged, now: () => NOW, today: () => TODAY,
    scanRooms: rooms, scanCars: cars, loadPlans: fakePlans(), visible: () => true, debounceMs: 5,
    openPanel: async () => ({ ok: true }),
  });
  const ctl = wait ? await started : null;
  return {
    ctl, started, doc, storage, rooms, cars,
    root: () => doc.getElementById(ROOT_ID),
    count: () => doc.querySelectorAll(`#${ROOT_ID}`).length,
  };
}

await ta('설정이 없으면 켠 것으로 보고 붙인다', async () => {
  const s = await start();
  assert.ok(s.root());
  assert.equal(s.rooms.calls.length, 1);
});
await ta('꺼져 있으면 붙이지도 훑지도 않는다', async () => {
  const s = await start({ [ENABLE_KEY]: false });
  assert.equal(s.root(), null);
  assert.equal(s.ctl.card, null);
  assert.equal(s.rooms.calls.length, 0);
  assert.equal(s.cars.calls.length, 0);
});
await ta('끄면 열려 있는 홈에서 카드가 곧바로 사라진다', async () => {
  const s = await start({ [CACHE_KEY]: cached });
  assert.ok(s.root());
  await s.storage.set({ [ENABLE_KEY]: false });
  assert.equal(s.root(), null);
  assert.equal(s.ctl.card, null);
});
await ta('끈 뒤에는 패널이 캐시를 지워도 훑지 않는다', async () => {
  const s = await start({ [CACHE_KEY]: cached });
  await s.storage.set({ [ENABLE_KEY]: false });
  await s.storage.remove(CACHE_KEY);
  await s.storage.set({ myName: '홍길동' });
  await tick(30);
  assert.equal(s.rooms.calls.length, 0);
  assert.equal(s.storage.listenerCount(), 1, '카드가 듣던 것을 떼지 않았다');
});
await ta('다시 켜면 새로고침 없이 붙는다 (담긴 것이 신선하면 훑지 않고)', async () => {
  const s = await start({ [ENABLE_KEY]: false, [CACHE_KEY]: cached });
  await s.storage.set({ [ENABLE_KEY]: true });
  await tick();
  assert.ok(s.root());
  assert.equal(s.root().querySelectorAll('li.krs-mine-item').length, 1);
  assert.equal(s.rooms.calls.length, 0);
});
await ta('켜기를 거듭 받아도 카드는 하나', async () => {
  const s = await start({ [CACHE_KEY]: cached });
  await s.storage.set({ [ENABLE_KEY]: true });
  await s.storage.set({ [ENABLE_KEY]: true });
  await tick();
  assert.equal(s.count(), 1);
});
await ta('끄고 켜기를 빠르게 반복해도 카드는 하나', async () => {
  const s = await start({ [CACHE_KEY]: cached });
  for (const on of [false, true, false, true]) await s.storage.set({ [ENABLE_KEY]: on });
  await tick();
  assert.equal(s.count(), 1);
});
await ta('훑는 도중에 끄면 남은 날은 읽지 않고, 반쯤 읽은 것을 담지 않는다', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const rooms = fakeScan('room', {}, { gate, pauseAfter: 3 });
  const s = await start({}, { rooms, wait: false });
  await tick();
  assert.equal(rooms.fed, 3);
  assert.ok(s.root(), '훑는 동안에도 카드는 떠 있어야 한다');

  await s.storage.set({ [ENABLE_KEY]: false });
  assert.equal(s.root(), null, '끄자마자 사라져야 한다');
  release();
  const ctl = await s.started;
  await tick();

  assert.equal(rooms.fed, 3, '끈 뒤에도 회의실을 더 읽었다');
  assert.equal(s.cars.calls.length, 0, '끈 뒤에 차량 바퀴를 돌았다');
  assert.equal(s.storage.data[CACHE_KEY], undefined, '반쯤 읽은 것을 담았다');
  assert.equal(ctl.card, null);
  assert.equal(s.root(), null, '끝난 훑기가 카드를 되살렸다');
});
await ta('stop 하면 카드를 떼고 설정 변화도 더 듣지 않는다', async () => {
  const s = await start({ [CACHE_KEY]: cached });
  assert.equal(s.storage.listenerCount(), 2);
  s.ctl.stop();
  assert.equal(s.root(), null);
  assert.equal(s.storage.listenerCount(), 0);
  await s.storage.set({ [ENABLE_KEY]: true });
  assert.equal(s.root(), null);
});

console.log('진짜 훑기도 멈춤 신호를 본다');
{
  const { window } = new JSDOM('');
  globalThis.DOMParser = window.DOMParser;
  const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  const serve = (html) => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push(init?.method || 'GET');
      return {
        ok: true, status: 200, statusText: '', url: String(url),
        headers: { get: () => 'text/html; charset=utf-8' },
        arrayBuffer: async () => new TextEncoder().encode(html).buffer,
      };
    };
    return calls;
  };
  const dates = ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];

  for (const [label, scan, file] of [
    ['회의실', scanDays, 'list-2026-09-16.html'],
    ['차량', scanCarDays, 'rentcar-2026-09-16.html'],
  ]) {
    await ta(`${label}: 처음부터 멈춰 있으면 목록 한 번만 받고 날짜는 읽지 않는다`, async () => {
      const calls = serve(fixture(file));
      const ac = new AbortController();
      ac.abort();
      const out = await scan(dates, () => {}, { signal: ac.signal });
      assert.equal(out.length, 0);
      assert.deepEqual(calls, ['GET']);
    });
    await ta(`${label}: 도중에 멈추면 거기까지만 읽는다`, async () => {
      serve(fixture(file));
      const ac = new AbortController();
      const seen = [];
      const out = await scan(dates, () => {}, {
        signal: ac.signal,
        onDay: (d) => { seen.push(d.date); if (seen.length === 1) ac.abort(); },
      });
      assert.deepEqual(out.map((d) => d.date), ['2026-09-16']);
      assert.deepEqual(seen, ['2026-09-16']);
    });
  }
}

console.log('확장 배선');
{
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
  const boot = fs.readFileSync(new URL('home.js', root), 'utf8');
  const bg = fs.readFileSync(new URL('background.js', root), 'utf8');
  t('홈에 콘텐츠 스크립트가 붙는다', () => {
    const cs = (manifest.content_scripts || []).find((c) => c.js.includes('home.js'));
    assert.ok(cs, 'content_scripts 에 home.js 가 없다');
    assert.ok(cs.matches.some((m) => m.startsWith('https://eclass.krs.co.kr/')));
  });
  t('콘텐츠 스크립트가 src/ 모듈을 불러올 수 있다(web_accessible_resources)', () => {
    const war = manifest.web_accessible_resources || [];
    assert.ok(war.some((w) => w.resources.includes('src/*.js') && w.matches.includes('https://eclass.krs.co.kr/*')));
  });
  t('시동 스크립트는 src/home.js 를 동적으로 불러온다', () => assert.match(boot, /getURL\('src\/home\.js'\)/));
  t('시동 스크립트는 설정을 따르는 startHome 을 부른다', () => assert.match(boot, /startHome\(document\)/));
  t('시동 스크립트는 홈 경로에서만 붙인다', () => assert.match(boot, /eclassver4/i));
  t('배경이 패널 열기 부탁을 받는다', () => {
    assert.match(bg, /openSidePanel/);
    assert.match(bg, /sidePanel\.open/);
  });
  t('배경이 근태 읽기 부탁을 받고, 패널과 같은 길(src/plans.js)로 HR 을 읽는다', () => {
    assert.match(bg, /'hrPlans'/);
    assert.match(bg, /from '\.\/src\/plans\.js'/);
    assert.match(bg, /hrListDocs/);
    assert.equal(manifest.background?.type, 'module', '배경이 모듈이 아니면 import 를 못 쓴다');
  });
}

console.log(`\n통과 ${pass}건`);
