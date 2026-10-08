// 출장·외근의 날짜·시간에 빈 차량 찾기 — 순수 로직. 화면도 네트워크도 모른다.
//
// 근태 폼에서 '차량 조회'를 켜면(attendpanel.js) 폼의 기간으로 차량 이용 현황을 훑어 오고(src/rentcar.js 의
// scanCarDays), 여기서 그 기간 내내 비어 있는 차량을 가린다. 빈 차량을 누르면 그 자리에서 그 기간으로 신청한다
// (sidepanel.js 의 reserveCarPick — 차량 탭의 예약하기와 같은 길이다).
//
// 회의실·차량 현황과 같은 규칙이다: **확신할 수 없으면 비어 있다고 하지 않는다.** 걸친 날 가운데 하루라도
// 읽지 못했으면, 겹치는 신청이 안 보인 차량도 '확인 불가'다.

import { tripLocation } from './travel.js';

const DAY = 24 * 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad = (n) => String(n).padStart(2, '0');
const minutesOf = (t) => (TIME_RE.test(t || '') ? +t.slice(0, 2) * 60 + +t.slice(3) : NaN);
const clock = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8)}`;
const addDays = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

/** 차량 조회를 붙이는 근태 종류 — 출장과 외근(교육·소통 포함). */
export const CAR_KINDS = ['trip', 'out'];

/** 이 폼에서 차량 조회를 켜 두었는가. */
export const wantsCar = (form) => CAR_KINDS.includes(form?.kind) && !!form.car;

/** 한 번에 훑는 날 수의 한도. 날마다 사이트를 한 번씩 두드리므로 긴 출장은 차량 탭에서 본다. */
export const MAX_CAR_DAYS = 14;

/**
 * 폼의 날짜·시각에서 차량을 쓸 기간을 낸다. 차량 현황은 한 시간 칸이라 시작은 내리고 끝은 올려 정시에 맞춘다
 * (외근 14:00~16:30 → 14:00~17:00) — 차량 탭에서 고를 수 있는 칸과 같은 눈금이어야 누른 뒤에 어긋나지 않는다.
 * 날짜나 시각이 아직 없으면 null.
 * @returns {{from:string, to:string, start:number, end:number, rounded:boolean}|null} start·end 는 분
 */
export function carWindow(form) {
  if (!CAR_KINDS.includes(form?.kind)) return null;
  const from = form.dateFrom;
  const to = form.dateTo || form.dateFrom;
  const s = minutesOf(form.start);
  const e = minutesOf(form.end);
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || to < from || Number.isNaN(s) || Number.isNaN(e)) return null;
  const start = Math.floor(s / 60) * 60;
  const end = Math.min(DAY, Math.ceil(e / 60) * 60);
  if (from === to && end <= start) return null;
  return { from, to, start, end, rounded: start !== s || end !== e };
}

/** 기간에 든 날짜와, 날마다 차량이 비어 있어야 하는 구간(분). 첫날은 시작 시각부터, 마지막 날은 끝 시각까지, 사이의 날은 하루 내내다. */
export function windowDays(win) {
  const out = [];
  for (let d = win.from; d <= win.to && out.length < 366; d = addDays(d, 1)) {
    out.push({ date: d, start: d === win.from ? win.start : 0, end: d === win.to ? win.end : DAY });
  }
  return out;
}

/** 기간을 한 줄로 — 하루면 "10/20 07:00~20:00", 여러 날이면 "10/20 07:00 ~ 10/21 20:00". */
export function windowLabel(win) {
  return win.from === win.to
    ? `${md(win.from)} ${clock(win.start)}~${clock(win.end)}`
    : `${md(win.from)} ${clock(win.start)} ~ ${md(win.to)} ${clock(win.end)}`;
}

/* ------------------------------------------------------------ 근무지와 고를 수 있는 차량 */

/**
 * 근무지에 적은 글이 서울인가 부산인가(2026-10-03 사용자 지정: 근무지는 서울 아니면 부산이다). "부산 본사" → 부산,
 * "서울본부" → 서울. 둘 다 아니거나 비었으면 빈 글 — 짐작하지 않는다.
 */
export function regionOf(workplace) {
  const t = String(workplace || '');
  const seoul = /서울/.test(t);
  const busan = /부산/.test(t);
  return seoul === busan ? '' : seoul ? '서울' : '부산';
}

/**
 * 그 차량이 어느 근무지의 것인가. 사이트의 차량 목록("본부공용차량")은 부산 본사의 차량이고, 서울에 있는 차량에만
 * 옆에 "[서울본부 전용 차량]" 이라고 적혀 있다(2026-10-03 실제 화면: 16대 가운데 1대). 신청 폼의 지역 칸은 어느 차량이든
 * "부산" 이라 가리는 데 쓸 수 없다.
 */
export const carHome = (car) => (/서울/.test(car?.note || '') ? '서울' : '부산');

/**
 * 근태 폼의 차량 조회에서 이 차량을 **한 번 눌러 신청해도 되는가.** 되면 빈 글, 안 되면 줄에 적을 까닭이다.
 *
 *   1) 사이트가 예약 버튼에서 막는 차량(blocked) — 임원용·사전 협의 차량 등. 확장도 막는다.
 *   2) 근무지를 모르면(서울도 부산도 아니다) 고를 수 없다 — 어느 곳의 차량을 잡아야 하는지 알 수 없다.
 *   3) 다른 근무지의 차량 — 부산에서 서울본부 전용 차량을, 서울에서 부산 본사 차량을 잡지 않는다.
 *   4) 옆에 안내가 적힌 차량("[임원용 차량]", "[총무팀 사전 협의 후 사용가능]", "[협약본부 전용 차량]")은 아무나 쓰는 차량이 아니다.
 *      권한이 있거나 협의를 마쳤으면 차량 탭이나 사이트에서 신청한다. 내 근무지 전용 차량(서울의 "[서울본부 전용 차량]")은 고를 수 있다.
 *
 * @param {{note?:string, blocked?:string}} car src/rentcar.js extractCars 의 차량
 * @param {string} region regionOf 의 결과
 */
export function carLock(car, region) {
  if (car?.blocked) return car.note || '사이트에서 문의 후 사용';
  if (!region) return '근무지를 적어 주세요';
  const home = carHome(car);
  if (home !== region) return home === '서울' ? car.note || '서울본부 전용 차량' : '부산 본사 차량';
  if (car?.note && !(home === '서울' && /전용/.test(car.note))) return car.note;
  return '';
}

/** 겹치는 신청 한 건이 언제부터 언제까지인지. 하루짜리 기간 안의 그날 신청이면 날짜를 뺀다. */
function busyLabel(a, b, win) {
  if (a.date !== b.date) return `${md(a.date)} ${clock(a.minutes)}~${md(b.date)} ${clock(b.minutes)}`;
  const day = win.from === win.to && a.date === win.from ? '' : `${md(a.date)} `;
  return `${day}${clock(a.minutes)}~${clock(b.minutes)}`;
}

/**
 * 훑어 온 날들에서 그 기간 내내 빈 차량을 가린다.
 *
 * 차량마다 state 는 셋이다 — 겹치는 신청이 보였으면 busy, 안 보였고 걸친 날을 모두 확신하면 free,
 * 안 보였지만 못 읽었거나 확신할 수 없는 날이 있으면 unknown(비어 있다고 하지 않는다).
 * 여러 날에 걸친 신청은 걸친 날마다 같은 건이 담겨 오므로 한 건으로 합쳐 적는다.
 *
 * 차량마다 lock 도 단다 — 근무지(region)에서 한 번 눌러 신청해도 되는 차량이 아니면 그 까닭이다(carLock). 비어 있어도
 * lock 이 있으면 고를 수 없다.
 *
 * @param {{from:string, to:string, start:number, end:number}} win carWindow 의 결과
 * @param {Array<{date:string, rooms?:object[], reservations?:object[], confident:boolean, reason?:string}>} days scanCarDays 의 결과
 * @param {{region?: string}} [opts] region 은 근무지(regionOf 의 결과 — '서울'·'부산'·'')
 * @returns {{cars: Array<{car:object, state:'free'|'busy'|'unknown', lock:string, mine:boolean, busy:Array<{label:string, owner:string, title:string, mine:boolean}>}>,
 *            unsure: Array<{date:string, reason:string}>}} cars 는 내가 신청한 차량, 고를 수 있는 빈 차량, 고를 수 없는 빈 차량, 나머지 차례이고
 *   그 안에서는 사이트의 차례다
 */
export function carsInWindow(win, days, { region = '' } = {}) {
  const byDate = new Map((days || []).map((d) => [d.date, d]));
  const unsure = [];
  const rows = new Map();
  const rowOf = (name, car) => {
    if (!rows.has(name)) rows.set(name, { car: car || { name, value: name, label: name }, seen: new Set(), busy: [] });
    return rows.get(name);
  };

  for (const slice of windowDays(win)) {
    const day = byDate.get(slice.date);
    if (!day) {
      unsure.push({ date: slice.date, reason: '현황을 읽지 못했습니다.' });
      continue;
    }
    if (!day.confident) unsure.push({ date: slice.date, reason: day.reason || '현황을 확신할 수 없습니다.' });
    for (const car of day.rooms || []) rowOf(car.name, car);
    for (const r of day.reservations || []) {
      if (!(r.start < slice.end && r.end > slice.start)) continue;
      const a = r.spanStart || { date: slice.date, minutes: r.start };
      const b = r.spanEnd || { date: slice.date, minutes: r.end };
      const row = rowOf(r.room);
      const key = `${a.date} ${a.minutes}~${b.date} ${b.minutes}|${r.owner || ''}`;
      if (row.seen.has(key)) continue;
      row.seen.add(key);
      row.busy.push({ label: busyLabel(a, b, win), owner: r.owner || '', title: r.title || '', mine: !!r.mine });
    }
  }

  const rank = { free: 0, unknown: 2, busy: 3 };
  const cars = [...rows.values()].map(({ car, busy }) => ({
    car, busy, mine: busy.some((b) => b.mine), lock: carLock(car, region),
    state: busy.length ? 'busy' : unsure.length ? 'unknown' : 'free',
  }));
  // 내가 이미 신청한 차량이 맨 앞이다 — 목록은 네 줄쯤만 보여서, 뒤에 두면 잡아 둔 차가 스크롤 아래로 숨는다.
  // 그 다음이 고를 수 있는 빈 차량, 비어 있지만 고를 수 없는 차량(다른 근무지·임원용 …) 차례다.
  // sort 는 안정 정렬이라 같은 무리 안에서는 사이트의 차례가 남는다.
  const order = (c) => (c.mine ? -1 : c.state === 'free' && c.lock ? 1 : rank[c.state]);
  cars.sort((x, y) => order(x) - order(y));
  return { cars, unsure };
}

/**
 * 차량 신청의 행선지를 어느 칸에서 받는가. 사이트는 행선지가 있어야 신청을 받는다(fnSaveCheck).
 * 출장은 늘 보이는 출장지 칸이고, 외근은 차량 조회를 켰을 때 나오는 행선지 칸(carPlace)이다 — 외근에는 장소 칸이 따로 없다.
 */
export const carPlaceKey = (form) => (form?.kind === 'trip' ? 'place' : 'carPlace');

/** 차량 신청의 행선지 — 출장은 여비계산서와 같은 "출장지(장소)"다. 아직 안 적었으면 빈 글. */
export const carPlaceOf = (form) => (carPlaceKey(form) === 'place' ? tripLocation(form) : String(form?.carPlace || '').trim());

/**
 * 빈 차량을 눌렀을 때 신청할 한 건. 사용목적은 폼의 목적이고 행선지는 carPlaceOf 다.
 * @returns {{date:string, endDate:string, start:number, end:number, car:{name:string, value:string}, title:string, place:string}}
 */
export function carPick(win, car, form) {
  return {
    date: win.from, endDate: win.to, start: win.start, end: win.end,
    // 사이트가 막는 차량이면 그 까닭이 따라간다 — 화면이 고르지 못하게 하지만, 신청하는 쪽도 한 번 더 막는다.
    car: { name: car.name, value: car.value, ...(car.blocked ? { blocked: car.blocked } : {}) },
    title: String(form?.purpose || '').trim(),
    place: carPlaceOf(form),
  };
}
