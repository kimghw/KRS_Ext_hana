// 홈의 WORKSPACE 카드(예전 "내 예약"): 자리 찾기, 캐시(신선도·이름·기간), 훑기와 못 읽은 날 경고, 패널과의 신호,
// 그리고 예약과 같은 모양으로 섞여 보이는 근태(출장·외근·휴가).
// 여기서도 가장 중요한 건 **못 읽은 날을 "예약 없음"으로 넘기지 않는 것**이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  mountHome, startHome, createHomeCard, findAnchor, summarize, spanOf, cacheUsable, agoText, dayLabel, planItems,
  homeEnabled, CACHE_KEY, JUMP_KEY, ENABLE_KEY, ROOT_ID, HIDDEN_KEY, FOLD_KEY, LEGS_KEY, PICKS_KEY, tripMarks, legsSlim,
} from '../src/home.js';
import { MARKS_KEY } from '../src/evidence.js';
import { UP_BUSY_KEY } from '../src/afterup.js';
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

/**
 * 사전정산의 교통편 읽기 흉내(src/trip.js 의 tripPreDetail). by 는 계산서 번호 → 교통편 줄들이고, calls 에 읽은 계산서 번호를 적는다.
 * 출장 줄의 가는 편·오는 편 아이콘이 이것을 본다.
 */
function fakePre(by = {}, { fail = null } = {}) {
  const fn = async (seq) => {
    fn.calls.push(seq);
    if (fail) throw fail;
    return { rows: by[seq] || [] };
  };
  fn.calls = [];
  return fn;
}

/**
 * 배경의 증빙 받기 흉내(src/intake.js). answer 는 파일 이름 → 답이고(없으면 숙박 증빙으로 보관), calls 에 부탁을 적는다.
 * storage 를 주면 진짜 배경처럼 보관한 것을 줄여 적는다(MARKS_KEY).
 */
function fakeKeep(answer = {}, { storage = null } = {}) {
  const fn = async (ask) => {
    fn.calls.push(ask);
    const r = answer[ask.file.name] || { ok: true, kept: true, name: ask.file.name, label: '숙박 증빙', note: '', todo: true };
    if (r.ok && r.kept && storage) {
      const marks = structuredClone(storage.data[MARKS_KEY] || {});
      (marks[ask.docNo] ||= []).push({ name: r.name, label: r.label, ...(r.todo ? { todo: true } : {}) });
      await storage.set({ [MARKS_KEY]: marks });
    }
    return r;
  };
  fn.calls = [];
  return fn;
}

/**
 * 방금 넣은 증빙을 사후정산에 올리는 길 흉내(src/afterup.js). answer 가 답이고(함수면 부탁을 보고 답한다), calls 에 부탁을, busy 에
 * 그때 적혀 있던 "올리는 중" 표시(UP_BUSY_KEY)를 적는다. storage 를 주면 진짜처럼 올린 증빙의 "아직 안 올림" 표시를 걷는다(MARKS_KEY).
 */
function fakeUp(answer = { ok: true, sent: true, hold: false, text: '사후정산을 올렸습니다 — 숙박 고양호텔 1박 110,000원' }, { storage = null } = {}) {
  const fn = async (trip, onStage) => {
    fn.calls.push(trip);
    fn.busy.push(structuredClone(storage?.data[UP_BUSY_KEY] || null));
    onStage('여비계산서(사후정산)를 올리는 중...');
    await tick(5);
    const r = typeof answer === 'function' ? answer(trip) : answer;
    if (r.sent && storage?.data[MARKS_KEY]?.[trip.docNo]) {
      const marks = structuredClone(storage.data[MARKS_KEY]);
      marks[trip.docNo] = marks[trip.docNo].map(({ todo: _todo, ...k }) => k);
      await storage.set({ [MARKS_KEY]: marks });
    }
    return r;
  };
  fn.calls = [];
  fn.busy = [];
  return fn;
}

/** 카드를 붙인다. 바깥 것은 전부 가짜다. */
async function mount({
  storage = fakeStorage(), rooms = fakeScan('room'), cars = fakeScan('car'), plans = fakePlans(), trips = fakeTrips(),
  now = () => NOW, visible = () => true, openPanel = null, doc = homeDoc(), debounceMs = 5, alive = () => true,
  pre = fakePre(), keep = fakeKeep({}, { storage }), up = fakeUp(undefined, { storage }), marks = null,
} = {}) {
  const panelCalls = [];
  const syncCalls = [];
  const billCalls = [];
  const ctl = await mountHome(doc, {
    storage, onChanged: storage.onChanged, now, today: () => TODAY,
    scanRooms: rooms, scanCars: cars, loadPlans: plans, listTrips: trips, visible, debounceMs, alive,
    openPanel: openPanel || (async () => { panelCalls.push(1); return { ok: true }; }),
    preDetail: pre, keepEvidence: keep, afterUp: up, readFile: async (f) => f.dataUrl || `data:${f.type};base64,AAAA`,
    // 출장 줄의 `계산서 보기`가 여는 계산서(번호, 내 출장자 번호).
    openBill: async (seq, trseq) => { billCalls.push([seq, trseq]); },
    // 배경에게 보관함을 줄여 적어 달라는 부탁. marks 를 주면 그것이 보관함에 있는 것이다.
    syncMarks: async () => { syncCalls.push(1); return marks ? { ok: true, marks } : { ok: false, error: '보관함 없음' }; },
  });
  const root = doc.getElementById(ROOT_ID);
  const text = (role) => (root?.querySelector(`[data-role="${role}"]`)?.textContent || '').trim();
  return {
    ctl, doc, root, storage, rooms, cars, plans, trips, panelCalls, syncCalls, billCalls, pre, keep, up, text,
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
    // "다녀온 출장 · 단계"는 글로 적지 않는다(2026-10-04 사용자 지정 — 그 자리에 아이콘이 선다). 줄의 풍선말에 있다.
    assert.equal(past.querySelector('.krs-mine-past'), null);
    assert.ok(!past.querySelector('.krs-mine-main').textContent.includes('다녀온 출장'));
    assert.match(past.title, /^다녀온 출장 · 여비계산서 없음 — 누르면 예약 패널의 근태 탭을 엽니다/, '여비계산서 목록을 읽었으면 단계를 풍선말에 적는다');
    assert.ok(!trip.title.includes('다녀온 출장'), '아직 안 간 출장에는 적지 않는다');
    assert.match(out.querySelector('.krs-mine-when').textContent, /^9\/18 \(금\) 13:00~15:00$/);
    assert.equal(out.querySelector('.krs-mine-what').textContent, '과제 협의');
    assert.ok(out.querySelector('.krs-mine-kind').classList.contains('out'));
    assert.match(trip.querySelector('.krs-mine-when').textContent, /^9\/20 \(일\) 07:00 ~ 9\/22 \(화\) 20:00$/);
    // 결재 상태는 종류 딱지 아래에 줄인 말로 적는다(2026-10-04 사용자 지정) — 결재완료는 "승인", 결재요청은 "신청". HR 의 이름은 풍선말에 있다.
    const tag = (li) => [...li.querySelector('.krs-mine-tag').children].map((n) => [n.className.split(' ')[0], n.textContent, n.title]);
    assert.deepEqual(tag(trip), [['krs-mine-kind', '출장', ''], ['krs-mine-state', '승인', '결재완료']]);
    assert.equal(trip.querySelector('.krs-mine-status'), null, '날짜 옆에는 적지 않는다');
    assert.match(leave.querySelector('.krs-mine-when').textContent, /^9\/21 \(월\) 전일$/);
    assert.deepEqual(tag(leave), [['krs-mine-kind', '연차', ''], ['krs-mine-state', '신청', '결재요청']]);
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
  // 다녀온 출장의 단계는 줄의 풍선말 앞머리에 적힌다("다녀온 출장 · 사후정산 작성 — 누르면 …").
  const pastOf = (m) => m.items().filter((li) => li.classList.contains('past')).map((li) => li.title.split(' — ')[0]);
  await ta('출장이 올라와 있으면 여비계산서 목록을 읽어 단계를 적는다 — 8주 전부터 보이는 출장의 가장 늦은 끝 날까지, 하루에 한 번', async () => {
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([bt('501', '2026-09-10', '2026-09-11', '완료', '작성')]) });
    assert.deepEqual(m.trips.calls, [{ from: '2026-07-23', to: '2026-09-22' }], '앞으로의 출장(9/20~22)의 계산서도 본다 — 출장 줄의 아이콘이 쓴다');
    assert.deepEqual(pastOf(m), ['다녀온 출장 · 사후정산 작성']);
    assert.deepEqual([m.storage.data[STAGES_KEY].day, m.storage.data[STAGES_KEY].until, m.storage.data[STAGES_KEY].rows.map((r) => r.seq)], [TODAY, '2026-09-22', ['501']]);
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
  await ta('증빙을 담당자에게 보낸 출장도 올리지 않는다 — 카드에 출장이 한 건도 없으면 여비계산서 목록도 읽지 않는다', async () => {
    const sent = { [SENT_KEY]: { 'X-4': { at: NOW, channel: '쪽지', to: '홍길동', account: 'RND' } } };
    const m = await mount({ storage: fakeStorage(sent), plans: fakePlans(HR) });
    assert.deepEqual(kinds(m), ['외근', '교육', '출장', '연차', '체력단련']);
    assert.equal(m.trips.calls.length, 1, '앞으로의 출장이 남아 있으면 그 계산서를 보려고 읽는다');
    const none = await mount({ storage: fakeStorage(sent), plans: fakePlans(HR.filter((x) => x.docNo !== 'T-1')) });
    assert.deepEqual(kinds(none), ['외근', '교육', '연차', '체력단련']);
    assert.deepEqual([none.trips.calls, none.syncCalls], [[], []], '출장이 없으면 여비계산서도 보관함도 묻지 않는다');
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
  // 출장 줄은 여비 증빙을 받고, 무엇이 들어와 있는지 선 아이콘 여섯으로 보인다(2026-10-04 사용자 지정) — 가는 편·오는 편(교통편),
  // 숙박, 항공권, 출장증빙, 보냄. 들어와 있으면(보냈으면) 파란 선(on), 없으면 회색 선이다. 여비계산서는 여기서 바꾸지 않는다.
  const doc501 = { ...bt('501', '2026-09-10', '2026-09-11', '완료', '대기'), location: '경기도 고양시' };
  const doc502 = { ...bt('502', '2026-09-20', '2026-09-22', '작성', ''), location: '대전' };
  const ktx = (date, dep, arr, over = {}) => ({ date, dep, arr, transport: 'Train', grade: '일반석', total: 59800, currency: 'KRW', ...over });
  const marksOfLi = (li) => [...li.querySelectorAll('.krs-mine-mark')].map((n) => [n.classList[1], n.classList.contains('on')]);
  /** 보관함의 증빙이 켜는 셋(숙박·항공권·출장증빙). */
  const filesOfLi = (li) => marksOfLi(li).slice(2, 5);
  const markOf = (li, key) => li.querySelector(`.krs-mine-mark.${key}`);
  const tripLis = (m) => m.items().filter((li) => li.classList.contains('is-trip'));
  /** 조건이 될 때까지 기다린다 — 정해 둔 시간만 기다리면 테스트 파일 여럿이 같이 돌 때 늦어져 어긋난다. */
  const until = async (cond, what = '조건', ms = 3000) => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error(`기다리다 시간이 다 됐습니다 — ${what}`);
      await tick(5);
    }
  };
  /** 그 출장 줄에 넣은 증빙의 처리가 끝날 때까지(줄에 결과가 적히고 "…중"이 아닐 때까지) 기다린다. */
  // 정산금액을 고르기를 기다리는 줄에는 글 없이 고르는 아이콘만 선다 — 그것도 끝난 것이다.
  const landed = (m, i = 0) => until(() => {
    const li = tripLis(m)[i];
    const n = li?.querySelector('.krs-mine-drop');
    return (!!n && !n.classList.contains('busy')) || !!li?.querySelector('.krs-mine-ask');
  }, '증빙 처리');
  const file = (name, type = 'image/png', size = 1000) => ({ name, type, size, dataUrl: `data:${type};base64,${Buffer.from(name).toString('base64')}` });
  /** 파일을 끌어다 놓는(또는 끌고 지나가는) 이벤트. */
  const drag = (m, node, files, type = 'drop') => {
    const e = new m.doc.defaultView.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: { types: ['Files'], files, dropEffect: '' } });
    node.dispatchEvent(e);
    return e;
  };
  const paste = (m, node, files) => {
    const e = new m.doc.defaultView.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { files } });
    node.dispatchEvent(e);
    return e;
  };
  const hover = (m, node) => node.dispatchEvent(new m.doc.defaultView.Event('mouseover', { bubbles: true }));
  /** 보관만 하고 사후정산에 아직 안 올린 증빙을 그 줄에서 올리는 버튼(`사후정산에 올리기`). */
  const upBtn = (li) => li.querySelector('.krs-mine-todo [data-act="up"]');

  t('아이콘 여섯: 가는 편·오는 편은 사전정산의 줄에 패널에서 고른 것을 얹은 것이고, 숙박·항공권·출장증빙은 보관함의 증빙, 보냄은 보낸 기록이다', () => {
    const none = tripMarks({});
    assert.deepEqual(none.map((x) => [x.key, x.icon, x.on]),
      [['go', 'train', false], ['back', 'train', false], ['lodge', 'lodge', false], ['ticket', 'ticket', false], ['proof', 'proof', false], ['sent', 'sent', false]]);
    assert.equal(none[5].title, '증빙 보내기 — 아직 보내지 않았습니다 · 누르면 예약 패널의 출장 카드(여비증빙 송부)를 열어 보낼 내용을 보여 줍니다');
    assert.match(none[0].title, /^가는 편 없음 — 여비계산서 목록을 아직 읽지 못했습니다$/);
    assert.match(tripMarks({ known: true })[1].title, /^오는 편 없음 — 여비계산서가 없습니다$/);
    assert.match(tripMarks({ known: true, doc: doc501 })[0].title, /사전정산의 교통편을 아직 읽지 못했습니다$/);
    assert.match(tripMarks({ known: true, doc: doc501, legs: { go: null, back: null } })[0].title, /사전정산에 이 편의 교통편이 없습니다$/);
    assert.match(none[2].title, /^숙박 증빙 없음 — 숙박 영수증·예약서를 이 줄에 끌어다 놓거나/);

    const legs = legsSlim([ktx('2026-09-10', '부산', '행신'), ktx('2026-09-11', '행신', '부산', { grade: '특실', total: 83700 })], doc501);
    assert.deepEqual(legs, { go: { t: 'train', g: 'standard', text: 'KTX 부산→행신 일반석 59,800원' }, back: { t: 'train', g: 'first', text: 'KTX 행신→부산 특실 83,700원' } });
    const kept = [{ name: 'hotel.png', label: '숙박 증빙', todo: true }, { name: 'a.pdf', label: '항공기 증명' }, { name: 'lunch.png', label: '출장지 영수증' }, { name: 'etc.png', label: '증빙' }];
    const sent = { at: new Date('2026-09-17T14:05:00').getTime(), channel: '쪽지', to: '홍길동', account: 'RND-01' };
    const full = tripMarks({ known: true, doc: doc501, legs, picks: { back: { t: 'plane', g: 'first' } }, kept, sent });
    assert.deepEqual(full.map((x) => [x.key, x.icon, x.on]),
      [['go', 'train', true], ['back', 'plane', true], ['lodge', 'lodge', true], ['ticket', 'ticket', true], ['proof', 'proof', true], ['sent', 'sent', true]]);
    assert.deepEqual(full.map((x) => x.title), [
      '가는 편 — KTX 부산→행신 일반석 59,800원', '오는 편 — 비행기 특실 · 예약 패널에서 고름',
      '숙박 증빙 1장 — hotel.png · 사후정산에는 아직 올리지 않았습니다(홈을 열면 올립니다 — 정할 것이 있으면 이 줄에서 묻습니다)', '항공권 1장 — a.pdf', '출장증빙 2장 — lunch.png · etc.png',
      '증빙 보냄 — 9/17 14:05 · 쪽지 · 홍길동 · RND-01 · 누르면 예약 패널의 여비증빙 송부 칸을 엽니다(다시 보내기)',
    ]);
    assert.match(tripMarks({ sent: {} })[5].title, /^증빙 보냄 —  · 누르면/, '보낸 기록에 적힌 것이 없어도 보낸 것이다');
    // 패널에서 고른 것이 사전정산의 줄과 같으면 사전정산의 줄을 그대로 말한다 — 사전정산을 못 읽었으면 고른 것만 안다.
    assert.equal(tripMarks({ known: true, doc: doc501, legs, picks: { go: { t: 'train', g: 'standard' } } })[0].title, '가는 편 — KTX 부산→행신 일반석 59,800원');
    assert.equal(tripMarks({ known: true, doc: doc501, picks: { go: { t: 'train', g: 'standard' } } })[0].title, '가는 편 — 기차(KTX) · 예약 패널에서 고름');
    // 사전정산에 한 줄뿐이고 그 날짜가 도착일이면 오는 편이다. 패널이 모르는 수단(지하철)도 들어와 있는 것이다.
    assert.deepEqual(legsSlim([ktx('2026-09-11', '행신', '부산')], doc501), { go: null, back: { t: 'train', g: 'standard', text: 'KTX 행신→부산 일반석 59,800원' } });
    const subway = tripMarks({ known: true, doc: doc501, legs: legsSlim([ktx('2026-09-10', '부산', '행신', { transport: 'Subway' })], doc501) });
    assert.deepEqual([subway[0].icon, subway[0].on], ['train', true]);
  });
  await ta('출장 줄에만 아이콘이 선다 — 사전정산의 교통편을 계산서마다 하루에 한 번 읽어 가는 편·오는 편이 파랗게 되고, 증빙은 아직 없어 회색이다', async () => {
    const pre = fakePre({ 501: [ktx('2026-09-10', '부산', '행신'), ktx('2026-09-11', '행신', '부산')] });
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([doc501, doc502]), pre });
    assert.deepEqual(kinds(m), ['출장', '외근', '교육', '출장', '연차', '체력단련']);
    const [past, out, , trip] = m.items();
    assert.equal(out.querySelector('.krs-mine-marks'), null);
    assert.deepEqual([out.classList.contains('is-trip'), past.classList.contains('is-trip'), past.dataset.doc, trip.dataset.doc], [false, true, 'X-4', 'T-1']);
    assert.deepEqual(marksOfLi(past), [['go', true], ['back', true], ['lodge', false], ['ticket', false], ['proof', false], ['sent', false]]);
    assert.deepEqual(marksOfLi(trip), [['go', false], ['back', false], ['lodge', false], ['ticket', false], ['proof', false], ['sent', false]], '사전정산에 교통편이 없는 출장');
    // 아이콘은 글(날짜·내용) 옆, 줄의 오른쪽에 따로 선다 — 세 개씩 두 줄이고, 그 오른쪽에 누르는 것들이 온다: 다녀온 출장이면 위에 숨기는
    // 눈 아이콘, 그 아래에 계산서 보기. 방향 화살표는 없다 — 가는 편이 먼저다.
    const parts = (li) => [...li.children].map((n) => n.className.split(' ')[0]);
    assert.deepEqual([parts(trip), parts(past)], [['krs-mine-tag', 'krs-mine-main', 'krs-mine-marks', 'krs-mine-acts'], ['krs-mine-tag', 'krs-mine-main', 'krs-mine-marks', 'krs-mine-acts']]);
    const acts = (li) => [...li.querySelector('.krs-mine-acts').children].map((n) => n.dataset.act);
    assert.deepEqual([acts(trip), acts(past)], [['bill'], ['hide', 'bill']]);
    assert.deepEqual([...trip.querySelector('.krs-mine-main').children].map((n) => n.className), ['krs-mine-when', 'krs-mine-sub']);
    const style = m.root.querySelector('style').textContent;
    assert.match(style, /\.krs-mine-marks \{ display: grid; grid-template-columns: repeat\(3, 16px\)/);
    // 출장 줄의 내용은 날짜·시각이 끝나는 데까지만 적고 줄인다(2026-10-04 사용자 지정) — 내용 줄은 글 칸의 폭을 넓히지 않고, 전체는 풍선말에 있다.
    assert.match(style, /\.krs-mine-item\.is-trip \.krs-mine-main \{ flex: 0 1 auto; \}/);
    assert.match(style, /\.krs-mine-item\.is-trip \.krs-mine-sub, [^{]*\{ width: 0; min-width: 100%; \}/);
    assert.deepEqual([trip.querySelector('.krs-mine-what').textContent, trip.querySelector('.krs-mine-what').title], ['착수회의 참석 - 대전', '착수회의 참석 - 대전']);
    assert.equal(past.querySelector('.krs-mine-marks').getAttribute('aria-label'), '여비 증빙 — 다녀온 출장 · 사전정산 완료');
    assert.equal(trip.querySelector('.krs-mine-marks').getAttribute('aria-label'), '여비 증빙');
    assert.deepEqual([past.querySelector('.krs-mine-marks').textContent, /→|←/.test(m.root.querySelector('style').textContent)], ['', false]);
    assert.ok(markOf(past, 'ticket').querySelector('path[fill="currentColor"]'), '항공권은 표 안에 비행기가 든 그림이다');
    assert.equal(markOf(past, 'go').getAttribute('aria-label'), '가는 편 — KTX 부산→행신 일반석 59,800원');
    assert.match(markOf(trip, 'go').title, /사전정산에 이 편의 교통편이 없습니다/);
    assert.match(past.title, /끌어다 놓거나, 마우스를 올리고 붙여 넣으면/);
    assert.deepEqual([pre.calls, m.storage.data[LEGS_KEY].day, Object.keys(m.storage.data[LEGS_KEY].by)], [['501', '502'], TODAY, ['501', '502']]);
    const again = await mount({ storage: m.storage, plans: fakePlans(HR), trips: fakeTrips([doc501, doc502]), pre: fakePre() });
    assert.deepEqual([again.trips.calls, again.pre.calls, marksOfLi(again.items()[0]).slice(0, 2)], [[], [], [['go', true], ['back', true]]], '오늘 읽어 둔 것이 있으면 다시 읽지 않는다');
    // 새로고침은 담아 둔 것을 버리고 다시 읽는다
    again.root.querySelector('[data-act="refresh"]').click();
    await tick(40);
    assert.deepEqual(again.pre.calls, ['501', '502']);
  });
  await ta('보냄 아이콘은 증빙을 담당자에게 보낸 기록이 있으면 파랗다 — 지금 가 있는(또는 앞으로의) 출장은 보낸 뒤에도 카드에 남아 그렇게 보인다', async () => {
    const now = [hr('T-0', '국내출장', 'TR', '2026-09-17', '2026-09-17', { start: '07:00', end: '20:00' })];
    const m = await mount({ plans: fakePlans(now), trips: fakeTrips([bt('601', '2026-09-17', '2026-09-17', '완료', '대기')]) });
    assert.deepEqual(marksOfLi(m.items()[0]).at(-1), ['sent', false]);
    await m.storage.set({ [SENT_KEY]: { 'T-0': { at: NOW, channel: 'Teams', to: '홍길동', account: 'RND-01' } } });
    await tick();
    assert.deepEqual(marksOfLi(m.items()[0]).at(-1), ['sent', true]);
    assert.equal(markOf(m.items()[0], 'sent').title, '증빙 보냄 — 9/17 09:00 · Teams · 홍길동 · RND-01 · 누르면 예약 패널의 여비증빙 송부 칸을 엽니다(다시 보내기)');
    // 다녀온 출장은 보내면 카드에서 빠진다(정산이 끝난 것이다 — src/settling.js 의 규칙 그대로).
    const past = await mount({ storage: fakeStorage({ [SENT_KEY]: { 'X-4': { at: NOW } } }), plans: fakePlans(HR), trips: fakeTrips([doc501]) });
    assert.ok(!past.items().some((li) => li.dataset.doc === 'X-4'));
  });
  // 출장 줄에서 누르는 것 둘(2026-10-04 사용자 지정) — 계산서 보기(그 출장의 여비계산서 화면을 새 탭으로)와 보내기(종이비행기 —
  // 패널의 그 출장 카드, 여비증빙 송부 칸으로 가서 보낼 내용을 띄운다).
  await ta('계산서 보기 — 계산서가 걸린 출장이면 파랗고, 누르면 그 계산서(번호와 내 출장자 번호)를 연다. 패널은 열지 않는다', async () => {
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([{ ...doc501, travelers: [{ name: '남', post: '대기', trseq: '7' }, { name: '김거화', post: '대기', trseq: '8' }] }]) });
    const [past, trip] = tripLis(m);
    const bill = (li) => li.querySelector('button[data-act="bill"]');
    // 그림은 패널의 계산서 버튼과 같다 — 문서 안의 숫자(1 사전정산 · 2 사후정산)와 단계의 색(none 회색 · doing 녹색 · done 파랑).
    assert.deepEqual([bill(past).className, bill(past).title, bill(past).getAttribute('aria-disabled')],
      ['krs-mine-bill done', '계산서 보기 — 여비계산서 501 · 사전정산 완료 · 누르면 새 탭에서 엽니다', null]);
    assert.equal(bill(past).querySelectorAll('svg path').length, 3, '문서·접힌 귀·숫자');
    bill(past).click();
    await tick();
    assert.deepEqual([m.billCalls, m.panelCalls.length, m.storage.data[JUMP_KEY]], [[['501', '8']], 0, undefined], '줄을 누른 것(패널 열기)으로 치지 않는다');
    // 여비계산서가 없는 출장 — 회색이고, 누르면 열 것이 없다고 말한다.
    assert.deepEqual([bill(trip).className, bill(trip).title, bill(trip).getAttribute('aria-disabled')], ['krs-mine-bill none', '계산서 보기 — 여비계산서가 없습니다', 'true']);
    bill(trip).click();
    await tick();
    assert.equal(m.billCalls.length, 1);
    assert.match(m.text('warn'), /^여비계산서가 없습니다 — 예약 패널의 근태 탭에서 확인해 주세요\.$/);
  });
  await ta('계산서 보기 — 출장자 번호를 담아 두지 않은 예전 목록이면 번호 없이 연다(계산서 화면이 고른 출장자의 것이 뜬다)', async () => {
    const old = { day: TODAY, since: '2026-07-23', until: '2026-09-22', me: '김거화', rows: [{ seq: '501', from: '2026-09-10', to: '2026-09-11', pre: '작성', location: '서울', travelers: [{ name: '김거화', post: '' }] }] };
    const m = await mount({ storage: fakeStorage({ [STAGES_KEY]: old }), plans: fakePlans(HR) });
    const btn = tripLis(m)[0].querySelector('button[data-act="bill"]');
    assert.deepEqual([btn.className, btn.title], ['krs-mine-bill doing', '계산서 보기 — 여비계산서 501 · 사전정산 작성 · 누르면 새 탭에서 엽니다']);
    btn.click();
    await tick();
    assert.deepEqual(m.billCalls, [['501', '']]);
  });
  await ta('보내기 — 종이비행기를 누르면 그 출장 카드의 여비증빙 송부 칸으로 가 달라는 부탁을 남기고 패널을 연다(보내는 것은 패널의 팝업에서 한다)', async () => {
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([doc501]) });
    const plane = markOf(tripLis(m)[0], 'sent');
    assert.deepEqual([plane.tagName, plane.dataset.act, plane.dataset.doc], ['BUTTON', 'send', 'X-4']);
    assert.deepEqual(tripLis(m).flatMap((li) => [...li.querySelectorAll('.krs-mine-mark')]).filter((n) => n.tagName === 'BUTTON').length, 2, '누르는 표시는 출장마다 보냄 하나뿐이다');
    plane.click();
    await tick();
    assert.deepEqual(m.storage.data[JUMP_KEY], { date: '2026-09-10', mode: 'attend', docNo: 'X-4', focus: 'send', at: NOW });
    assert.deepEqual([m.panelCalls.length, m.billCalls.length], [1, 0]);
  });
  await ta('사전정산의 교통편을 못 읽으면 그 편은 회색으로 남고, 그릴 때마다 다시 두드리지 않는다', async () => {
    const pre = fakePre({}, { fail: new Error('로그인이 필요합니다.') });
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([doc501]), pre });
    assert.deepEqual(marksOfLi(m.items()[0]).slice(0, 2), [['go', false], ['back', false]]);
    assert.match(markOf(m.items()[0], 'go').title, /사전정산의 교통편을 아직 읽지 못했습니다/);
    await m.storage.set({ [PICKS_KEY]: {} });
    await tick();
    assert.deepEqual([pre.calls, m.storage.data[LEGS_KEY]], [['501'], undefined]);
  });
  await ta('패널의 출장 카드에서 가는 편·오는 편을 바꾸면 아이콘도 따라온다 — 비행기로 바꾼 편은 비행기 그림이다', async () => {
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([doc501]), pre: fakePre({ 501: [ktx('2026-09-10', '부산', '행신')] }) });
    const svgOf = (key) => markOf(m.items()[0], key).innerHTML;
    assert.deepEqual(marksOfLi(m.items()[0]).slice(0, 2), [['go', true], ['back', false]]);
    const train = svgOf('go');
    await m.storage.set({ [PICKS_KEY]: { 'X-4': { go: { t: 'plane', g: 'standard' }, back: { t: 'train', g: 'standard' } } } });
    await tick();
    assert.deepEqual(marksOfLi(m.items()[0]).slice(0, 2), [['go', true], ['back', true]]);
    assert.notEqual(svgOf('go'), train);
    assert.equal(svgOf('back'), train);
    assert.equal(markOf(m.items()[0], 'go').title, '가는 편 — 비행기 · 예약 패널에서 고름');
  });
  await ta('보관함의 증빙이 아이콘을 파랗게 한다 — 줄여 적어 둔 것이 없으면 배경에 한 번 부탁하고, 패널에서 넣거나 빼면 따라온다', async () => {
    const marks = { 'X-4': [{ name: 'hotel.png', label: '숙박 증빙' }], 'T-1': [{ name: 'e-ticket.pdf', label: '항공기 증명' }] };
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([doc501]), marks });
    assert.equal(m.syncCalls.length, 1);
    assert.deepEqual([filesOfLi(m.items()[0]), filesOfLi(m.items()[3])], [[['lodge', true], ['ticket', false], ['proof', false]], [['lodge', false], ['ticket', true], ['proof', false]]]);
    assert.equal(markOf(m.items()[0], 'lodge').title, '숙박 증빙 1장 — hotel.png');
    await m.storage.set({ [MARKS_KEY]: { 'X-4': [{ name: 'lunch.png', label: '출장지 영수증' }] } });
    await tick();
    assert.deepEqual([filesOfLi(m.items()[0]), filesOfLi(m.items()[3])], [[['lodge', false], ['ticket', false], ['proof', true]], [['lodge', false], ['ticket', false], ['proof', false]]]);
    // 적어 둔 것이 있으면 부탁하지 않는다(새로고침 때는 다시 맞춘다)
    const again = await mount({ storage: m.storage, plans: fakePlans(HR), trips: fakeTrips([doc501]), marks });
    assert.deepEqual([again.syncCalls.length, filesOfLi(again.items()[0])], [0, [['lodge', false], ['ticket', false], ['proof', true]]]);
    again.root.querySelector('[data-act="refresh"]').click();
    await tick(40);
    assert.deepEqual([again.syncCalls.length, filesOfLi(again.items()[0])], [1, [['lodge', true], ['ticket', false], ['proof', false]]]);
  });
  await ta('출장 줄에 파일을 끌어다 놓으면 그 출장의 증빙으로 들어간다 — 배경이 한 장씩 받고, 숙박 증빙은 곧바로 사후정산에 올리고, 결과를 줄에 적고, 아이콘이 파랗게 된다. 패널은 열지 않는다', async () => {
    const storage = fakeStorage();
    const keep = fakeKeep({
      'lunch.png': { ok: true, kept: true, name: 'lunch.png', label: '출장지 영수증', note: '', todo: false },
      'ktx.png': { ok: true, kept: false, name: 'ktx.png', label: '기차·버스표', note: '증빙으로 받지 않습니다(KTX 는 운임표의 정가로 넣습니다)' },
    }, { storage });
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501, doc502]), keep });
    const over = drag(m, tripLis(m)[0].querySelector('.krs-mine-when'), [], 'dragover');
    assert.deepEqual([over.defaultPrevented, over.dataTransfer.dropEffect, tripLis(m)[0].classList.contains('over')], [true, 'copy', true]);
    const e = drag(m, tripLis(m)[0].querySelector('.krs-mine-when'), [file('hotel.png'), file('lunch.png'), file('ktx.png')]);
    assert.equal(e.defaultPrevented, true);
    await landed(m);
    assert.deepEqual(keep.calls.map((c) => [c.docNo, c.file.name, c.settled, c.me]), [['X-4', 'hotel.png', false, '김거화'], ['X-4', 'lunch.png', false, '김거화'], ['X-4', 'ktx.png', false, '김거화']]);
    assert.deepEqual(keep.calls[0].trip, { seq: '501', from: '2026-09-10', to: '2026-09-11', location: '경기도 고양시' }, '여비계산서의 기간·출장지를 알려 준다(출장지에서 결제했는지 가린다)');
    assert.match(keep.calls[0].file.dataUrl, /^data:image\/png;base64,/);
    assert.deepEqual(m.up.calls.map((c) => [c.docNo, c.row.seq, c.me]), [['X-4', '501', '김거화']], '여러 장을 넣어도 사후정산에 올리는 것은 다 담은 뒤 한 번이다');
    const li = tripLis(m)[0];
    assert.equal(li.querySelector('.krs-mine-drop').textContent,
      'hotel.png: 숙박 증빙으로 보관했습니다 · lunch.png: 출장지 영수증으로 보관했습니다 · ktx.png: 기차·버스표 ✗ — 증빙으로 받지 않습니다(KTX 는 운임표의 정가로 넣습니다)'
      + ' · 사후정산을 올렸습니다 — 숙박 고양호텔 1박 110,000원');
    assert.ok(li.querySelector('.krs-mine-drop').classList.contains('error'), '못 받은 것이 있으면 그렇게 보인다');
    assert.deepEqual(filesOfLi(li), [['lodge', true], ['ticket', false], ['proof', true]]);
    assert.equal(markOf(li, 'lodge').title, '숙박 증빙 1장 — hotel.png', '올렸으므로 "아직 안 올림"이 붙지 않는다');
    assert.equal(tripLis(m)[1].querySelector('.krs-mine-drop'), null, '다른 출장 줄에는 적지 않는다');
    assert.equal(m.panelCalls.length, 0);
    assert.equal(m.storage.data[JUMP_KEY], undefined);
  });
  await ta('받아서 올리는 동안에는 "올리는 중"이라고 적어 둔다 — 패널의 출장 카드가 같은 증빙을 그 사이에 올리지 않는다. 끝나면 걷는다', async () => {
    const storage = fakeStorage();
    let during = null;
    let atUp = null;
    let release = null;
    const keep = async (ask) => { during = structuredClone(storage.data[UP_BUSY_KEY]); return { ok: true, kept: true, name: ask.file.name, label: '항공기 증명', note: '', todo: true }; };
    // 올리는 길은 테스트가 놓아 줄 때까지 붙들고 있다 — 그 사이의 줄과 표시를 본다.
    const up = async (trip, onStage) => {
      atUp = structuredClone(storage.data[UP_BUSY_KEY]);
      onStage('여비계산서(사후정산)를 올리는 중...');
      await new Promise((r) => { release = r; });
      return { ok: true, sent: true, hold: false, text: '사후정산을 올렸습니다 — 비행기 2026-09-10 김해→김포 89,000원' };
    };
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]), keep, up });
    drag(m, tripLis(m)[0], [file('ticket.pdf', 'application/pdf')]);
    await until(() => !!release, '올리는 길에 닿기');
    assert.deepEqual([during, atUp, storage.data[UP_BUSY_KEY]], [{ 'X-4': NOW }, { 'X-4': NOW }, { 'X-4': NOW }], '읽기 시작할 때부터 올리기가 끝날 때까지다');
    const note = tripLis(m)[0].querySelector('.krs-mine-drop');
    assert.deepEqual([note.textContent, note.classList.contains('busy')], ['ticket.pdf: 항공기 증명으로 보관했습니다 · 여비계산서(사후정산)를 올리는 중...', true]);
    release();
    await landed(m);
    assert.deepEqual(storage.data[UP_BUSY_KEY], {});
    assert.equal(tripLis(m)[0].querySelector('.krs-mine-drop').textContent, 'ticket.pdf: 항공기 증명으로 보관했습니다 · 사후정산을 올렸습니다 — 비행기 2026-09-10 김해→김포 89,000원');
  });
  await ta('걷지 못하고 남은 "올리는 중"(홈 탭이 도중에 닫혔다)은 기한이 지나면 다음에 적을 때 치운다 — 다른 창의 홈이 방금 적은 것은 둔다', async () => {
    const storage = fakeStorage({ [UP_BUSY_KEY]: { 'OLD-1': NOW - 10 * 60_000, 'T-9': NOW - 1000 } });
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]) });
    drag(m, tripLis(m)[0], [file('hotel.png')]);
    await landed(m);
    assert.deepEqual([m.up.busy, storage.data[UP_BUSY_KEY]], [[{ 'T-9': NOW - 1000, 'X-4': NOW }], { 'T-9': NOW - 1000 }]);
  });
  await ta('사후정산에 못 올렸거나 원화 금액을 적어야 하면 그 까닭을 줄에 적는다 — 증빙은 보관돼 있고 "아직 안 올림"이 남는다', async () => {
    const storage = fakeStorage();
    const up = fakeUp({ ok: false, sent: false, hold: true, text: '사후정산에는 올리지 않았습니다 — 외화 문서라 원화로 결제한 금액을 적어야 합니다 · 예약 패널의 출장 카드에서 올려 주세요' }, { storage });
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]), up });
    drag(m, tripLis(m)[0], [file('hotel.png')]);
    await landed(m);
    const note = tripLis(m)[0].querySelector('.krs-mine-drop');
    assert.deepEqual([note.textContent, note.classList.contains('error')],
      ['hotel.png: 숙박 증빙으로 보관했습니다 · 사후정산에는 올리지 않았습니다 — 외화 문서라 원화로 결제한 금액을 적어야 합니다 · 예약 패널의 출장 카드에서 올려 주세요', true]);
    assert.match(markOf(tripLis(m)[0], 'lodge').title, /사후정산에는 아직 올리지 않았습니다/);
    assert.equal(tripLis(m)[0].querySelector('.krs-mine-ask'), null, '물을 것(ask)이 없으면 고르는 버튼도 없다 — 패널에서 올린다');
    assert.equal(upBtn(tripLis(m)[0]).textContent, '다시 올리기', '안 올린 증빙이 남아 있으니 다시 올려 볼 수는 있다');
    assert.deepEqual(storage.data[UP_BUSY_KEY], {});
    // 올리는 길이 던져도 줄에 적고 끝낸다
    const boom = await mount({ plans: fakePlans(HR), trips: fakeTrips([doc501]), up: async () => { throw new Error('Extension context invalidated.'); } });
    drag(boom, tripLis(boom)[0], [file('hotel.png')]);
    await landed(boom);
    assert.equal(tripLis(boom)[0].querySelector('.krs-mine-drop').textContent,
      'hotel.png: 숙박 증빙으로 보관했습니다 · 사후정산에 올리지 못했습니다 — Extension context invalidated. · 예약 패널의 출장 카드에서 올려 주세요');
  });
  // 2026-10-05 사용자 지정: "홈 줄에서 바로 고르기: 넣은 자리에서 상한액/실제 금액 버튼이 뜹니다. 그리고 상한액의 1.5배는 부서장 승인"
  const CAP_ASK = { key: 'hotel.png', question: '실제 금액 150,000원이 상한액 120,000원(1일 120,000원 × 1박)을 넘습니다. 정산금액을 어느 쪽으로 올릴까요?',
    choices: [{ settle: 'cap', label: '상한액 120,000원으로' },
      { settle: 'real', label: '실제 금액 150,000원으로 · 부서장 승인', note: '상한액의 1.5배(180,000원) 이내라 부서장 승인을 받아 실제 금액으로 정산할 수 있습니다' }] };
  const ASKING = '사후정산은 아직 올리지 않았습니다 — 아래에서 정산금액을 골라 주세요';
  /** 상한액을 넘는 숙박 — 고르기 전에는 묻고, 고른 것을 들고 오면 그 금액으로 올린다. */
  const capUp = (storage, asks = [CAP_ASK]) => fakeUp((trip) => (asks.every((a) => trip.settle?.[a.key])
    ? { ok: true, sent: true, hold: false, text: `사후정산을 올렸습니다 — 숙박 고양호텔 1박 ${trip.settle['hotel.png'] === 'cap' ? '120,000원(상한액)' : '150,000원 · 고양호텔: 부서장 승인 필요 — 상한액의 1.5배(180,000원) 이내'}` }
    : { ok: true, sent: false, hold: true, ask: asks, text: ASKING }), { storage });
  const askOf = (li) => li.querySelector('.krs-mine-ask');
  const picks = (li) => [...li.querySelectorAll('.krs-mine-pick')];
  // 같은 날 사용자 지정(묻는 줄의 화면을 보고): "여기 설명은 필요 없고, 아이콘만 2개 주고 선택하라고해" — 글은 `정산금액 선택` 뿐이고,
  // 묻는 말·금액·승인 규칙은 풍선말에 있다.
  const pickTip = (b) => b.getAttribute('aria-label');
  await ta('숙박비가 상한액을 넘으면 넣은 그 줄에서 묻는다 — 설명 없이 `정산금액 선택`과 아이콘 둘(상한액으로 / 실제 금액으로)만 서고, 올리지는 않는다', async () => {
    const storage = fakeStorage();
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]), up: capUp(storage) });
    drag(m, tripLis(m)[0], [file('hotel.png')]);
    await landed(m);
    const li = tripLis(m)[0];
    assert.equal(li.querySelector('.krs-mine-drop'), null, '넣은 증빙이 어떻게 됐는지의 글도 적지 않는다');
    assert.deepEqual([askOf(li).textContent, askOf(li).querySelector('.krs-mine-ask-q').title], ['정산금액 선택', CAP_ASK.question], '글은 이것뿐이다 — 묻는 말은 풍선말에 있다');
    assert.equal(askOf(li).querySelector('.krs-mine-ask-note'), null);
    assert.deepEqual(picks(li).map((b) => [pickTip(b), b.title, b.textContent, !!b.querySelector('svg'), b.dataset.act, b.dataset.doc, b.dataset.key, b.dataset.settle]), [
      ['상한액 120,000원으로', '상한액 120,000원으로', '', true, 'settle', 'X-4', 'hotel.png', 'cap'],
      ['실제 금액 150,000원으로 · 부서장 승인 — 상한액의 1.5배(180,000원) 이내라 부서장 승인을 받아 실제 금액으로 정산할 수 있습니다',
        '실제 금액 150,000원으로 · 부서장 승인 — 상한액의 1.5배(180,000원) 이내라 부서장 승인을 받아 실제 금액으로 정산할 수 있습니다', '', true, 'settle', 'X-4', 'hotel.png', 'real'],
    ]);
    assert.notEqual(picks(li)[0].innerHTML, picks(li)[1].innerHTML, '두 아이콘은 다른 그림이다');
    assert.deepEqual([m.up.calls.length, m.up.calls[0].settle, storage.data[UP_BUSY_KEY]], [1, {}, {}], '묻는 동안에는 올리는 중이 아니다');
    assert.match(markOf(li, 'lodge').title, /사후정산에는 아직 올리지 않았습니다/);
  });
  await ta('고르면 그 금액으로 사후정산에 올린다 — 고른 것을 들고 올리는 길을 다시 부르고, 버튼을 걷고 결과를 적는다. 패널은 열지 않는다', async () => {
    const storage = fakeStorage();
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]), up: capUp(storage) });
    drag(m, tripLis(m)[0], [file('hotel.png')]);
    await landed(m);
    picks(tripLis(m)[0])[1].click();
    await until(() => m.up.calls.length === 2, '고른 것으로 다시 올리기');
    assert.deepEqual([askOf(tripLis(m)[0]), tripLis(m)[0].querySelector('.krs-mine-drop').classList.contains('busy')], [null, true], '올리는 동안에는 버튼이 없다');
    await landed(m);
    const li = tripLis(m)[0];
    assert.deepEqual(m.up.calls.map((c) => [c.docNo, c.row.seq, c.settle]), [['X-4', '501', {}], ['X-4', '501', { 'hotel.png': 'real' }]]);
    assert.equal(li.querySelector('.krs-mine-drop').textContent,
      'hotel.png: 숙박 증빙으로 보관했습니다 · 사후정산을 올렸습니다 — 숙박 고양호텔 1박 150,000원 · 고양호텔: 부서장 승인 필요 — 상한액의 1.5배(180,000원) 이내');
    assert.deepEqual([askOf(li), m.up.busy[1], storage.data[UP_BUSY_KEY]], [null, { 'X-4': NOW }, {}]);
    assert.equal(markOf(li, 'lodge').title, '숙박 증빙 1장 — hotel.png');
    assert.deepEqual([m.panelCalls.length, m.storage.data[JUMP_KEY]], [0, undefined]);
  });
  await ta('물을 숙박 줄이 둘이면 둘 다 고른 뒤에 올린다 — 고른 줄의 버튼은 걷힌다', async () => {
    const storage = fakeStorage();
    const asks = [CAP_ASK, { ...CAP_ASK, key: 'inn.png', question: '실제 금액 130,000원이 상한액 120,000원(1일 120,000원 × 1박)을 넘습니다. 정산금액을 어느 쪽으로 올릴까요?' }];
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]), up: capUp(storage, asks) });
    drag(m, tripLis(m)[0], [file('hotel.png'), file('inn.png')]);
    await landed(m);
    assert.equal(tripLis(m)[0].querySelectorAll('.krs-mine-ask').length, 2);
    picks(tripLis(m)[0])[0].click();
    await until(() => tripLis(m)[0].querySelectorAll('.krs-mine-ask').length === 1, '고른 줄의 버튼 걷기');
    assert.deepEqual([m.up.calls.length, picks(tripLis(m)[0])[0].dataset.key], [1, 'inn.png']);
    picks(tripLis(m)[0])[1].click();
    await until(() => m.up.calls.length === 2, '다 고른 뒤 올리기');
    await landed(m);
    assert.deepEqual([m.up.calls.length, m.up.calls[1].settle, askOf(tripLis(m)[0])], [2, { 'hotel.png': 'cap', 'inn.png': 'real' }, null]);
  });
  await ta('고르기를 기다리는 사이에 그 증빙이 올라가면(패널의 출장 카드에서 올렸다) 버튼을 걷는다', async () => {
    const storage = fakeStorage();
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]), up: capUp(storage) });
    drag(m, tripLis(m)[0], [file('hotel.png')]);
    await landed(m);
    assert.ok(askOf(tripLis(m)[0]));
    await storage.set({ [MARKS_KEY]: { 'X-4': [{ name: 'hotel.png', label: '숙박 증빙' }] } });
    await until(() => !askOf(tripLis(m)[0]), '버튼 걷기');
    assert.deepEqual([askOf(tripLis(m)[0]), tripLis(m)[0].querySelector('.krs-mine-drop').textContent], [null, 'hotel.png: 숙박 증빙으로 보관했습니다']);
  });
  // 2026-10-05 사용자가 보관만 된 줄을 보고: "왜 안올려주고 저장만 하지 사후정산에 업로드도 같이 할 수 있게 해줘" — 고르기 전에 홈을
  // 새로고침했거나 올리다 막혀 "아직 안 올림"으로 남은 증빙은 그 줄의 버튼으로 올린다(다시 넣지 않는다).
  const KEPT_TODO = { 'X-4': [{ name: 'Receipt.pdf', label: '숙박 증빙', todo: true }, { name: 'Confirmation.pdf', label: '숙박 증빙', todo: true }, { name: 'lunch.png', label: '출장지 영수증' }] };
  // 같은 날 이어서: "왜 '사후정산에 올리기' 버튼이 아직 까지 있는 거지? 올리라고" — 버튼을 누르지 않아도 홈을 열면 올린다(한 번).
  // 버튼은 올려 봤는데 안 됐을 때만 선다("안올라가서 그 버튼이 있는거면 나두고").
  await ta('보관만 하고 사후정산에 안 올린 증빙이 남아 있으면 홈을 열 때 누르지 않아도 올린다 — 다시 읽지 않고, 올라가면 표시가 걷힌다. 올리기 버튼은 없다', async () => {
    const storage = fakeStorage({ [MARKS_KEY]: structuredClone(KEPT_TODO) });
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]) });
    await until(() => m.up.calls.length === 1, '올리는 길에 닿기');
    assert.deepEqual([upBtn(tripLis(m)[0]), tripLis(m)[1].querySelector('.krs-mine-todo')], [null, null], '올리는 동안에도, 안 올린 증빙이 없는 출장 줄에도 버튼은 없다');
    await landed(m);
    assert.deepEqual([m.keep.calls.length, m.up.calls.map((c) => [c.docNo, c.row.seq, c.settle]), m.up.busy[0], storage.data[UP_BUSY_KEY]],
      [0, [['X-4', '501', {}]], { 'X-4': NOW }, {}]);
    assert.equal(tripLis(m)[0].querySelector('.krs-mine-drop').textContent, '보관해 둔 증빙 2장 · 사후정산을 올렸습니다 — 숙박 고양호텔 1박 110,000원');
    assert.equal(upBtn(tripLis(m)[0]), null);
    assert.deepEqual([m.panelCalls.length, m.storage.data[JUMP_KEY]], [0, undefined], '패널은 열지 않는다');
    await tick(30);
    assert.equal(m.up.calls.length, 1, '저절로 올리는 것은 한 번이다');
  });
  await ta('안 보이는 창에서는 저절로 올리지 않는다 — 보이면 올린다. 다른 창의 홈이 그 출장을 올리는 중이면 건너뛴다', async () => {
    let shown = false;
    const storage = fakeStorage({ [MARKS_KEY]: structuredClone(KEPT_TODO) });
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]), visible: () => shown });
    await tick(40);
    assert.equal(m.up.calls.length, 0);
    shown = true;
    m.doc.dispatchEvent(new m.doc.defaultView.Event('visibilitychange'));
    await until(() => m.up.calls.length === 1, '보이면 올리기');
    const busy = fakeStorage({ [MARKS_KEY]: structuredClone(KEPT_TODO), [UP_BUSY_KEY]: { 'X-4': NOW } });
    const other = await mount({ storage: busy, plans: fakePlans(HR), trips: fakeTrips([doc501]) });
    await tick(40);
    assert.deepEqual([other.up.calls.length, upBtn(tripLis(other)[0])], [0, null]);
  });
  await ta('저절로 올리다 숙박비가 상한액을 넘으면 그 줄에 고르는 아이콘이 바로 선다 — 고르면 그 금액으로 곧바로 올린다', async () => {
    const storage = fakeStorage({ [MARKS_KEY]: { 'X-4': [{ name: 'hotel.png', label: '숙박 증빙', todo: true }] } });
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]), up: capUp(storage) });
    await landed(m);
    const li = tripLis(m)[0];
    assert.deepEqual([li.querySelector('.krs-mine-drop'), upBtn(li), askOf(li).textContent], [null, null, '정산금액 선택'], '묻는 동안에는 올리기 버튼 대신 고르는 아이콘이 선다');
    assert.deepEqual(picks(li).map((b) => pickTip(b).split(' — ')[0]), ['상한액 120,000원으로', '실제 금액 150,000원으로 · 부서장 승인']);
    picks(li)[0].click();
    await until(() => m.up.calls.length === 2, '고른 것으로 다시 올리기');
    await landed(m);
    assert.deepEqual(m.up.calls.map((c) => c.settle), [{}, { 'hotel.png': 'cap' }]);
    assert.equal(tripLis(m)[0].querySelector('.krs-mine-drop').textContent, '보관해 둔 증빙 1장 · 사후정산을 올렸습니다 — 숙박 고양호텔 1박 120,000원(상한액)');
    assert.deepEqual([askOf(tripLis(m)[0]), upBtn(tripLis(m)[0])], [null, null]);
  });
  await ta('여비계산서를 모르는 출장이면 저절로 올리지 않는다 — 버튼도 세우지 않는다', async () => {
    const storage = fakeStorage({ [MARKS_KEY]: { 'T-1': [{ name: 'hotel.png', label: '숙박 증빙', todo: true }] } });
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]) });
    await tick(40);
    assert.deepEqual([m.up.calls.length, upBtn(tripLis(m)[1]), tripLis(m)[1].querySelector('.krs-mine-drop')], [0, null, null]);
  });
  await ta('올려 봤는데 안 됐으면 까닭 아래에 `다시 올리기`가 선다 — 누르면 다시 읽지 않고 한 번 더 올려 본다', async () => {
    const storage = fakeStorage({ [MARKS_KEY]: { 'X-4': [{ name: 'hotel.png', label: '숙박 증빙', todo: true }] } });
    let fail = true;
    const up = fakeUp(() => (fail ? { ok: false, sent: false, hold: true, text: '사후정산에 올리지 못했습니다 — 로그인이 필요합니다 · 예약 패널의 출장 카드에서 올려 주세요' }
      : { ok: true, sent: true, hold: false, text: '사후정산을 올렸습니다 — 숙박 고양호텔 1박 110,000원' }), { storage });
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]), up });
    await landed(m);
    const li = tripLis(m)[0];
    assert.match(li.querySelector('.krs-mine-drop').textContent, /^보관해 둔 증빙 1장 · 사후정산에 올리지 못했습니다 — 로그인이 필요합니다/);
    assert.deepEqual([upBtn(li).textContent, li.querySelector('.krs-mine-todo').textContent, m.up.calls.length], ['다시 올리기', '다시 올리기', 1]);
    assert.match(upBtn(li).title, /^hotel\.png — 보관해 둔 증빙을 다시 읽지 않고 사후정산에 한 번 더 올려 봅니다$/);
    await tick(30);
    assert.equal(m.up.calls.length, 1, '저절로 다시 올리지는 않는다');
    fail = false;
    upBtn(li).click();
    await until(() => m.up.calls.length === 2, '다시 올리기');
    await landed(m);
    assert.deepEqual([tripLis(m)[0].querySelector('.krs-mine-drop').textContent, upBtn(tripLis(m)[0]), m.keep.calls.length],
      ['보관해 둔 증빙 1장 · 사후정산을 올렸습니다 — 숙박 고양호텔 1박 110,000원', null, 0]);
  });
  // 2026-10-05 사용자 지정: "출장 기간동안의 내용이 아니면 알림을 줘 안맞다고, 맞는것만 선별취급 해서 올리고 해당 없는거는 문서보관에 알림표지 하고
  // 확정 해주기 전까지는 보내기 해도 같이 보내지 말고"
  await ta('출장 기간의 것이 아닌 증빙은 그 줄에 안 맞다고 알린다 — 알림 표시로 보관하고, 맞는 것만 사후정산에 올린다. 아이콘은 맞는 것만 센다', async () => {
    const storage = fakeStorage();
    const WHY = '묵은 기간(9/20~9/21)이 출장 기간(9/10~9/11) 밖입니다';
    const base = fakeKeep({}, { storage });
    // 배경(src/intake.js)이 하듯 기간 밖의 것은 warn 을 붙여 담고 "아직 안 올림"은 붙이지 않는다.
    const keep = async (ask) => {
      if (ask.file.name !== 'jeju.png') return base(ask);
      const marks = structuredClone(storage.data[MARKS_KEY] || {});
      (marks[ask.docNo] ||= []).push({ name: 'jeju.png', label: '숙박 증빙', warn: WHY });
      await storage.set({ [MARKS_KEY]: marks });
      return { ok: true, kept: true, name: 'jeju.png', label: '숙박 증빙', note: '', warn: WHY, todo: false };
    };
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]), keep });
    drag(m, tripLis(m)[0], [file('jeju.png'), file('hotel.png')]);
    await landed(m);
    const li = tripLis(m)[0];
    const note = li.querySelector('.krs-mine-drop');
    assert.deepEqual([note.textContent, note.classList.contains('error')], [
      `jeju.png: 숙박 증빙 ⚠ ${WHY} — 알림 표시로 보관했습니다(예약 패널의 출장 카드에서 확정하기 전에는 올리지도 보내지도 않습니다)`
      + ' · hotel.png: 숙박 증빙으로 보관했습니다 · 사후정산을 올렸습니다 — 숙박 고양호텔 1박 110,000원', true]);
    assert.equal(m.up.calls.length, 1, '맞는 것이 있으니 올리는 길은 부른다 — 무엇을 올릴지는 그 길이 가린다(알림 표시로 둔 것은 뺀다)');
    assert.deepEqual([markOf(li, 'lodge').classList.contains('on'), markOf(li, 'lodge').title],
      [true, '숙박 증빙 1장 — hotel.png · 출장 기간과 안 맞아 확정을 기다리는 증빙(예약 패널의 출장 카드에서 확정) 1장 — jeju.png']);
    assert.equal(upBtn(li), null, '알림 표시로 둔 것은 "안 올린 증빙"으로 세지 않는다');
    // 기간 밖의 것만 넣었으면 올리는 길을 부르지 않는다 — 아이콘도 켜지지 않는다
    const only = await mount({ storage: fakeStorage(), plans: fakePlans(HR), trips: fakeTrips([doc501]),
      keep: async () => ({ ok: true, kept: true, name: 'jeju.png', label: '숙박 증빙', note: '', warn: WHY, todo: false }) });
    drag(only, tripLis(only)[0], [file('jeju.png')]);
    await landed(only);
    assert.deepEqual([only.up.calls.length, tripLis(only)[0].querySelector('.krs-mine-drop').classList.contains('error')], [0, true]);
    assert.deepEqual(tripMarks({ kept: [{ name: 'jeju.png', label: '숙박 증빙', warn: WHY }] }).slice(2, 3).map((x) => [x.on, x.title]),
      [[false, '숙박 증빙 없음 — 출장 기간과 안 맞아 확정을 기다리는 증빙(예약 패널의 출장 카드에서 확정) 1장 — jeju.png']]);
  });
  // 2026-10-05 사용자 지정(길게 적힌 알림을 보고): "알림 끄거나 보거나 제거 하는 기능이 안보임"
  const noteBtn = (li, act) => li.querySelector(`.krs-mine-drop button[data-act="${act}"]`);
  const noteText = (li) => li.querySelector('.krs-mine-drop-text');
  await ta('끝난 일의 알림은 접혀서 선다 — 올린 것의 요약 한 줄이고, 화살표로 펴서 전부 보고 다시 접으며, × 로 지운다. 사이트에는 아무것도 가지 않는다', async () => {
    const storage = fakeStorage();
    const FULL = '사후정산을 올렸습니다 — 숙박 아고다 1박 177,101원 · 추가 정보 — Receipt.pdf: 예약 번호 2048075129 · SONO CALM GOYANG: 부서장 승인 필요 — 상한액의 1.5배(180,000원) 이내';
    const up = fakeUp({ ok: true, sent: true, hold: false, brief: '사후정산을 올렸습니다 — 숙박 아고다 1박 177,101원 · 부서장 승인 필요', text: FULL }, { storage });
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]), up });
    drag(m, tripLis(m)[0], [file('Receipt.pdf', 'application/pdf')]);
    await landed(m);
    let li = tripLis(m)[0];
    const whole = `Receipt.pdf: 숙박 증빙으로 보관했습니다 · ${FULL}`;
    assert.deepEqual([li.querySelector('.krs-mine-drop').className, noteText(li).textContent, noteText(li).title],
      ['krs-mine-drop shut', '사후정산을 올렸습니다 — 숙박 아고다 1박 177,101원 · 부서장 승인 필요', whole], '접혀 있으면 요약 한 줄이고, 전부는 풍선말에 있다');
    assert.deepEqual(['drop-more', 'drop-close'].map((a) => [noteBtn(li, a).getAttribute('aria-label'), noteBtn(li, a).dataset.doc]), [['알림 펴 보기', 'X-4'], ['알림 지우기', 'X-4']]);
    assert.equal(noteBtn(li, 'drop-more').getAttribute('aria-expanded'), 'false');
    noteBtn(li, 'drop-more').click();
    li = tripLis(m)[0];
    assert.deepEqual([li.querySelector('.krs-mine-drop').className, noteText(li).textContent, noteBtn(li, 'drop-more').getAttribute('aria-label'), noteBtn(li, 'drop-more').getAttribute('aria-expanded')],
      ['krs-mine-drop open', whole, '알림 접기', 'true'], '펴면 전부 보인다');
    noteBtn(li, 'drop-more').click();
    assert.equal(tripLis(m)[0].querySelector('.krs-mine-drop').className, 'krs-mine-drop shut');
    noteBtn(tripLis(m)[0], 'drop-close').click();
    await tick(20);
    assert.deepEqual([tripLis(m)[0].querySelector('.krs-mine-drop'), m.up.calls.length, m.panelCalls.length], [null, 1, 0], '지우면 사라진다 — 다시 올리지도, 패널을 열지도 않는다');
  });
  await ta('알릴 것이 있는 알림(못 올렸다)은 펴져서 선다 — 지워도 안 올린 증빙이 남아 있으면 `다시 올리기`는 남는다. 하는 중이거나 금액을 묻는 중에는 버튼이 없다', async () => {
    const storage = fakeStorage();
    const up = fakeUp({ ok: false, sent: false, hold: true, text: '사후정산에 올리지 못했습니다 — 로그인이 필요합니다 · 예약 패널의 출장 카드에서 올려 주세요' }, { storage });
    const m = await mount({ storage, plans: fakePlans(HR), trips: fakeTrips([doc501]), up });
    drag(m, tripLis(m)[0], [file('hotel.png')]);
    assert.equal(noteBtn(tripLis(m)[0], 'drop-close'), null, '읽는 중인 글에는 버튼이 없다');
    await landed(m);
    let li = tripLis(m)[0];
    assert.deepEqual([li.querySelector('.krs-mine-drop').className, noteBtn(li, 'drop-more').getAttribute('aria-expanded'), upBtn(li).textContent], ['krs-mine-drop error open', 'true', '다시 올리기']);
    noteBtn(li, 'drop-close').click();
    await tick(30);
    li = tripLis(m)[0];
    assert.deepEqual([li.querySelector('.krs-mine-drop'), upBtn(li).textContent, m.up.calls.length], [null, '다시 올리기', 1], '글만 지워진다 — 저절로 다시 올리지도 않는다');
    // 금액을 묻는 줄에는 알림 글이 없으니 버튼도 없다
    const s2 = fakeStorage();
    const asking = await mount({ storage: s2, plans: fakePlans(HR), trips: fakeTrips([doc501]), up: capUp(s2) });
    drag(asking, tripLis(asking)[0], [file('hotel.png')]);
    await landed(asking);
    assert.deepEqual([tripLis(asking)[0].querySelector('.krs-mine-drop'), tripLis(asking)[0].querySelector('.krs-mine-drop-btn')], [null, null]);
  });
  await ta('사후정산에 올릴 것이 없는 증빙(출장지 영수증)만 넣었으면 올리는 길을 부르지 않는다', async () => {
    const keep = fakeKeep({ 'lunch.png': { ok: true, kept: true, name: 'lunch.png', label: '출장지 영수증', note: '', todo: false } });
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([doc501]), keep });
    drag(m, tripLis(m)[0], [file('lunch.png')]);
    await landed(m);
    assert.deepEqual([m.up.calls.length, tripLis(m)[0].querySelector('.krs-mine-drop').textContent], [0, 'lunch.png: 출장지 영수증으로 보관했습니다']);
  });
  await ta('받는 동안에는 무엇을 읽는 중인지 줄에 적는다', async () => {
    let release;
    const keep = async (ask) => { await new Promise((r) => { release = r; }); return { ok: true, kept: true, name: ask.file.name, label: '출장지 영수증', todo: false }; };
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([doc501]), keep });
    drag(m, tripLis(m)[0], [file('lunch.png')]);
    await tick();
    const note = tripLis(m)[0].querySelector('.krs-mine-drop');
    assert.deepEqual([note.textContent, note.classList.contains('busy')], ['증빙을 읽는 중 (1/1) — lunch.png', true]);
    release();
    await tick();
    const done = tripLis(m)[0].querySelector('.krs-mine-drop');
    assert.deepEqual([done.textContent, done.classList.contains('busy'), done.classList.contains('error')], ['lunch.png: 출장지 영수증으로 보관했습니다', false, false]);
  });
  await ta('이미지·PDF 가 아니거나 너무 큰 파일, 여비계산서가 없는 출장은 받지 않고 까닭을 적는다 — 배경에 보내지 않는다', async () => {
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([doc501]) });
    drag(m, tripLis(m)[0], [file('메모.txt', 'text/plain'), file('big.pdf', 'application/pdf', 11 * 1024 * 1024)]);
    await tick();
    assert.equal(tripLis(m)[0].querySelector('.krs-mine-drop').textContent, '메모.txt: 이미지나 PDF 가 아니라 뺐습니다 · big.pdf: 너무 큽니다(11MB) — 10MB 이하로 넣어 주세요');
    drag(m, tripLis(m)[1], [file('hotel.png')]);
    await tick();
    assert.match(tripLis(m)[1].querySelector('.krs-mine-drop').textContent, /^여비계산서가 없는 출장이라 증빙을 받지 못했습니다/);
    assert.deepEqual(m.keep.calls, []);
    const unread = await mount({ plans: fakePlans(HR), trips: fakeTrips([], { fail: new Error('로그인이 필요합니다.') }) });
    drag(unread, tripLis(unread)[0], [file('hotel.png')]);
    await tick();
    assert.match(tripLis(unread)[0].querySelector('.krs-mine-drop').textContent, /^여비계산서 목록을 아직 읽지 못해 증빙을 받지 못했습니다/);
    assert.deepEqual(unread.keep.calls, []);
  });
  await ta('출장 줄 밖(카드의 다른 곳)에는 놓을 수 없다 — 그래도 브라우저가 그 파일로 넘어가지 않게 막는다', async () => {
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([doc501]) });
    const out = m.items()[1];
    const over = drag(m, out, [], 'dragover');
    assert.deepEqual([over.defaultPrevented, over.dataTransfer.dropEffect, out.classList.contains('over')], [true, 'none', false]);
    const e = drag(m, m.root.querySelector('.krs-mine-head'), [file('hotel.png')]);
    assert.equal(e.defaultPrevented, true);
    await tick();
    assert.deepEqual(m.keep.calls, []);
    // 파일이 아닌 것을 끄는 것(글 선택 등)은 건드리지 않는다
    const text = new m.doc.defaultView.Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(text, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });
    tripLis(m)[0].dispatchEvent(text);
    assert.equal(text.defaultPrevented, false);
  });
  await ta('붙여넣기(화면 캡처)는 마우스가 올라가 있는 출장 줄로 간다 — 출장이 여럿인데 어느 줄인지 모르면 넣지 않고 고르는 법을 말한다', async () => {
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([doc501, doc502]) });
    const blind = paste(m, m.doc.body, [file('image.png')]);
    await tick();
    assert.deepEqual([blind.defaultPrevented, m.keep.calls.length], [false, 0]);
    assert.match(m.text('warn'), /붙여 넣을 출장 줄에 마우스를 올리고 Ctrl\+V/);
    hover(m, tripLis(m)[1].querySelector('.krs-mine-kind'));
    const e = paste(m, m.doc.body, [file('image.png')]);
    await tick();
    assert.equal(e.defaultPrevented, true);
    assert.deepEqual(m.keep.calls.map((c) => [c.docNo, c.file.name, c.trip.seq]), [['T-1', 'image.png', '502']]);
    // 출장이 아닌 줄로 옮겨 가면 다시 모른다
    hover(m, m.items()[1]);
    paste(m, m.doc.body, [file('image.png')]);
    await tick();
    assert.equal(m.keep.calls.length, 1);
  });
  await ta('카드에 출장이 하나뿐이면 어디서 붙여 넣든 그 출장이다 — 글 칸에 붙여 넣는 것, 파일이 없는 붙여넣기, 접어 둔 카드는 건드리지 않는다', async () => {
    const one = HR.filter((x) => x.docNo !== 'T-1');
    const doc = homeDoc(HOME.replace('<div class="row" id="divkrinfo">', '<input id="q" /><div class="row" id="divkrinfo">'));
    const m = await mount({ doc, plans: fakePlans(one), trips: fakeTrips([doc501]) });
    const typed = paste(m, doc.getElementById('q'), [file('image.png')]);
    const empty = paste(m, doc.body, []);
    await tick();
    assert.deepEqual([typed.defaultPrevented, empty.defaultPrevented, m.keep.calls.length], [false, false, 0]);
    const e = paste(m, doc.body, [file('image.png')]);
    await tick();
    assert.deepEqual([e.defaultPrevented, m.keep.calls.map((c) => c.docNo)], [true, ['X-4']]);
    m.root.querySelector('[data-role="toggle"]').click();
    await tick();
    paste(m, doc.body, [file('image.png')]);
    await tick();
    assert.equal(m.keep.calls.length, 1, '접어 둔 카드는 받지 않는다');
    m.ctl.destroy();
    paste(m, doc.body, [file('image.png')]);
    await tick();
    assert.equal(m.keep.calls.length, 1, '카드를 떼면 붙여넣기도 더 듣지 않는다');
  });
  await ta('출장지가 안 적힌 예전 모양의 목록이 담겨 있으면 다시 읽는다 — 증빙을 읽을 때 출장지를 알려 줘야 한다', async () => {
    const old = { day: TODAY, since: '2026-07-23', until: '2026-09-22', me: '김거화', rows: [{ seq: '501', from: '2026-09-10', to: '2026-09-11', pre: '완료', travelers: [{ name: '김거화', post: '대기' }] }] };
    const m = await mount({ storage: fakeStorage({ [STAGES_KEY]: old }), plans: fakePlans(HR), trips: fakeTrips([doc501]) });
    assert.equal(m.trips.calls.length, 1);
    assert.equal(m.storage.data[STAGES_KEY].rows[0].location, '경기도 고양시');
    drag(m, tripLis(m)[0], [file('lunch.png')]);
    await tick();
    assert.equal(m.keep.calls[0].trip.location, '경기도 고양시');
  });
  await ta('사후정산이 완료된 출장에 넣은 파일은 읽지 않고 보낼 증빙으로 담는다 — 지금 가 있는 출장이면 카드에 보인다', async () => {
    const now = [hr('T-0', '국내출장', 'TR', '2026-09-16', '2026-09-17', { start: '07:00', end: '20:00' })];
    const keep = fakeKeep({ 'a.png': { ok: true, kept: true, name: 'a.png', label: '증빙', note: '', todo: false } });
    const m = await mount({ plans: fakePlans(now), trips: fakeTrips([bt('601', '2026-09-16', '2026-09-17', '완료', '완료')]), keep });
    drag(m, tripLis(m)[0], [file('a.png')]);
    await tick();
    assert.deepEqual(keep.calls.map((c) => [c.docNo, c.settled, c.trip.seq]), [['T-0', true, '601']]);
    assert.equal(tripLis(m)[0].querySelector('.krs-mine-drop').textContent, 'a.png: 증빙으로 보관했습니다');
  });
  await ta('배경이 답하지 않거나 못 받았다고 하면 그 까닭을 줄에 적는다', async () => {
    const keep = fakeKeep({ 'a.png': { ok: false, name: 'a.png', error: '증빙을 읽지 못했습니다 — Claude 연결(로컬 CLI 또는 API 키)이 필요합니다' } });
    const m = await mount({ plans: fakePlans(HR), trips: fakeTrips([doc501]), keep });
    drag(m, tripLis(m)[0], [file('a.png')]);
    await tick();
    const note = tripLis(m)[0].querySelector('.krs-mine-drop');
    assert.deepEqual([note.textContent, note.classList.contains('error')], ['a.png: 증빙을 읽지 못했습니다 — Claude 연결(로컬 CLI 또는 API 키)이 필요합니다', true]);
    const boom = await mount({ plans: fakePlans(HR), trips: fakeTrips([doc501]), keep: async () => { throw new Error('Extension context invalidated.'); } });
    drag(boom, tripLis(boom)[0], [file('a.png')]);
    await tick();
    assert.equal(tripLis(boom)[0].querySelector('.krs-mine-drop').textContent, 'a.png: Extension context invalidated.');
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
