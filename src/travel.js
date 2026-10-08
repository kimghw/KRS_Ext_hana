// 여비계산서(사전정산)의 순수 로직. 화면도 네트워크도 모른다 — 출장 폼에서 무엇을 올릴지 셈하고,
// 사이트 목록·신청서 화면에서 무엇을 읽을지만 정한다. 사이트와 말하는 일은 src/trip.js 가 한다.
//
// 셈의 규칙은 travel-rules.yaml, KTX 운임은 ktx-fares.yaml 에 있다(둘을 옮긴 것이 travelspec.js).
// 사이트 화면(eclass /BusinessTrip)은 2026-10-02 에 실제 화면 소스를 받아 확인했다:
//   목록  GET  /BusinessTrip/Home/List?SDate=&EDate=      (표 #mainList)
//   작성  GET  /BusinessTrip/Write                        (폼 #frm, 저장은 POST /BusinessTrip/Write/Save)
//   요금표 GET /BusinessTrip/TrafficFee/Select?sDate=&conCode=KR&departure=&arrival=

import { TRAVEL_RULES, KTX_FARES } from './travelspec.js';

const RULES = TRAVEL_RULES;
const DAY_NAMES = '일월화수목금토';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const won = (n) => Number(n).toLocaleString('ko-KR');
const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8)}`;

/** 교통편 선택지(기차·비행기·버스). value 는 폼에 담는 값, auto 는 교통편 내역을 자동으로 넣는가. */
export const TRANSPORTS = RULES.transport.choices.map(({ value, label, site, auto }) => ({ value, label, site, auto: !!auto }));
export const DEFAULT_TRANSPORT = RULES.transport.default;
/** 패널의 교통편 값 ↔ 사전정산 화면의 수단 값(Train·Airplane·Bus). */
const SITE_OF = Object.fromEntries(TRANSPORTS.map((t) => [t.value, t.site]));
const VALUE_OF = Object.fromEntries(TRANSPORTS.map((t) => [t.site, t.value]));
/** 좌석 등급이 있는 교통편(기차). 아이콘을 한 번 더 누르면 특실이 된다. */
const GRADED = 'train';
/**
 * 가는 편·오는 편에서 한 번 더 누르면 특실이 되는 교통편 — 기차와 비행기다(2026-10-04 사용자 지정). 비행기는 요금을 항공권에서
 * 읽으므로 "등급" 칸의 글만 특실로 바뀐다. 신청 폼(사전정산)은 기차만 등급을 고른다 — 비행기는 교통편 내역을 넣지 않기 때문이다.
 */
export const LEG_GRADED = [GRADED, 'plane'];
/** 기차의 좌석 등급(일반석·특실). value 는 ktx-fares.yaml 의 등급, label 은 여비계산서 "등급" 칸에 적는 글이다. */
export const TRAIN_GRADES = Object.entries(RULES.transport.train.grade_labels).map(([value, label]) => ({ value, label }));
export const DEFAULT_GRADE = RULES.transport.train.grade;
const gradeLabel = (g) => RULES.transport.train.grade_labels[g] || RULES.transport.train.grade_labels[DEFAULT_GRADE];
const labelOf = (value) => TRANSPORTS.find((t) => t.value === value)?.label || value;

/**
 * 폼에 고른 교통편을 선택지 차례(기차·비행기·버스)의 목록으로. 여럿을 함께 고를 수 있다(기차 + 비행기).
 * 예전 폼의 글 하나('train')도 받는다. 고른 것이 없으면 빈 목록이다.
 */
export function transportsOf(form) {
  const v = form?.transport;
  const picked = Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [];
  return TRANSPORTS.map((t) => t.value).filter((x) => picked.includes(x));
}

/** 폼에 고른 기차 좌석 등급. 모르는 값이면 기본(일반석)이다. */
export const trainGradeOf = (form) => (TRAIN_GRADES.some((g) => g.value === form?.trainGrade) ? form.trainGrade : DEFAULT_GRADE);

/**
 * 교통편 아이콘을 눌렀을 때의 다음 선택(2026-10-03 사용자 지정). 기차는 한 번 누르면 일반석, 한 번 더 누르면 특실,
 * 또 누르면 꺼진다. 비행기·버스는 켜고 끈다. 하나는 골라져 있어야 하므로 마지막 하나는 꺼지지 않는다(기차는 일반석으로 돌아간다).
 * @returns {{transport: string[], trainGrade: string}}
 */
export function nextTransport(form, value) {
  const now = transportsOf(form);
  const grade = trainGradeOf(form);
  if (!TRANSPORTS.some((t) => t.value === value)) return { transport: now, trainGrade: grade };
  if (!now.includes(value)) return { transport: transportsOf({ transport: [...now, value] }), trainGrade: grade };
  if (value === GRADED && grade !== 'first') return { transport: now, trainGrade: 'first' };
  const others = now.filter((x) => x !== value);
  if (!others.length) return { transport: now, trainGrade: DEFAULT_GRADE };
  return { transport: others, trainGrade: value === GRADED ? DEFAULT_GRADE : grade };
}

/* ------------------------------------------------------------ 역과 운임 */

const STATIONS = [...new Set(KTX_FARES.routes.flatMap((r) => [r.a, r.b]))];
// 역 이름과 같은 글이 길잡이(places)에도 있으면 길잡이가 이긴다 — "창원" 은 창원역이 아니라 창원중앙역이다.
// 길잡이의 값은 역 하나이거나 후보 역의 목록이다(KTX 역이 없는 도시의 가까운 역들) — 모두 목록으로 맞춰 둔다.
const PLACE_KEYS = [...new Map([...STATIONS.map((s) => [s, [s]]), ...Object.entries(KTX_FARES.places || {}).map(([key, v]) => [key, [].concat(v)])])];
/** 갈아타는 역(ktx-fares.yaml 의 transfers) — 두 역을 바로 잇는 구간이 없을 때 거쳐 갈 수 있는 역이다. */
const HUBS = KTX_FARES.transfers || [];

/**
 * 적어 둔 곳(출장지·근무지)에서 탈 수 있는 KTX 역의 후보. "부산 본사" → [부산], "경기도 용인시" → [동탄, 수원]. 모르면 빈 목록.
 * 글에 역 이름이 여럿 들어 있으면 **먼저 나오는 것**이다 — 주소는 큰 곳부터 적으므로 "서울 영등포구" 는 영등포역이 아니라 서울역이다.
 * 같은 자리에서 시작하면 긴 이름이다("동대구" 를 "대구" 보다, "천안아산" 을 "천안" 보다).
 */
export function stationsOf(text) {
  const t = String(text || '');
  let hit = null;
  for (const [key, stations] of PLACE_KEYS) {
    const at = t.indexOf(key);
    if (at >= 0 && (!hit || at < hit.at || (at === hit.at && key.length > hit.len))) hit = { at, len: key.length, stations };
  }
  return hit ? hit.stations : [];
}

/**
 * 적어 둔 곳에서 탈 KTX 역. "부산 본사" → 부산, "경기도 고양시 킨텍스" → 서울. 모르면 빈 글.
 *
 * 그 도시에 KTX 역이 없어 가까운 역이 여럿이면(2026-10-04 사용자 지정: 가까우면서 먼 역) **from(근무지 쪽 역)에서 운임이 가장 큰 —
 * 가장 먼 — 역**이다: 부산에서 용인이면 동탄, 인천이면 서울. from 이 후보 가운데 하나면 그 역이고(같은 역이라 교통편을 비우게 된다),
 * 바로 가는 구간이 있는 후보가 없으면 갈아타서 갈 수 있는 첫 후보다. from 을 안 주면 앞에 적은 후보다.
 */
export function stationOf(text, from = '') {
  const c = stationsOf(text);
  if (c.length < 2 || !from) return c[0] || '';
  if (c.includes(from)) return from;
  let far = null;
  for (const s of c) {
    const fare = routeOf(from, s)?.standard;
    if (fare != null && (!far || fare > far.fare)) far = { s, fare };
  }
  return far ? far.s : c.find((s) => pathOf(from, s)) || c[0];
}

const AIRPORT_KEYS = Object.entries(KTX_FARES.airports || {});

/** 표에 적힌 곳(역·공항 이름이나 코드)이 어느 도시 쪽인지 — 그 도시의 KTX 역으로 말한다. "김해공항" → 부산. 모르면 빈 글. */
function cityOf(text) {
  const t = String(text || '');
  return stationOf(t) || AIRPORT_KEYS.find(([key]) => t.toUpperCase().includes(key.toUpperCase()))?.[1] || '';
}

/** 그 날이 주말 운임을 받는 요일인가(ktx-fares.yaml 의 weekend_days). */
export function isWeekend(date) {
  if (!DATE_RE.test(date || '')) return false;
  const [y, m, d] = date.split('-').map(Number);
  return KTX_FARES.weekend_days.includes(DAY_NAMES[new Date(y, m - 1, d).getDay()]);
}

/**
 * 두 역 사이의 편도 운임. 구간은 방향이 없다. 운임표에 없거나 그 등급의 값을 모르면 null.
 * 주말 운임을 따로 적은 구간이면 주말에는 그 값을, 아니면 평일·주말이 같은 값을 준다.
 * @param {'standard'|'first'} grade
 * @returns {{fare:number, weekend:boolean, source:string}|null}
 */
export function fareOf(a, b, date, grade = 'standard') {
  const route = routeOf(a, b);
  if (!route) return null;
  const weekend = isWeekend(date) && route.weekend?.[grade] != null;
  const fare = weekend ? route.weekend[grade] : route[grade];
  return fare != null ? { fare, weekend, source: route.source } : null;
}

/** 운임표에서 두 역을 잇는 구간. 구간은 방향이 없다. */
function routeOf(a, b) {
  return KTX_FARES.routes.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
}

/**
 * 두 역을 잇는 길(역의 차례). 바로 가는 구간이 운임표에 있으면 [a, b] 이고, 없으면 갈아타는 역(ktx-fares.yaml 의 transfers) 하나를 거치는
 * [a, 갈아타는 역, b] 다(2026-10-04 사용자 지정) — 부산→목포는 [부산, 오송, 목포]. 길이 없으면 null.
 *
 * 갈아타는 역은 **어느 역에서 갈아타든 두 구간의 일반실 운임을 더한 값이 가장 작은 역**이고, 그 역이 transfers 에 적힌 역일 때만 쓴다 —
 * 부산→창원처럼 가장 싼 길이 다른 역(밀양)을 거치면 오송으로 돌아가는 길을 짓지 않고 길이 없다고 한다(그런 출장은 KTX 로 다니지 않는다).
 */
export function pathOf(a, b) {
  if (!a || !b || a === b) return null;
  if (routeOf(a, b)) return [a, b];
  let best = null;
  for (const x of STATIONS) {
    const [p, q] = [routeOf(a, x), routeOf(x, b)];
    if (x === a || x === b || !p || !q) continue;
    const total = p.standard + q.standard;
    const hub = HUBS.includes(x);
    if (!best || total < best.total || (total === best.total && hub && !best.hub)) best = { x, total, hub };
  }
  return best?.hub ? [a, best.x, b] : null;
}

/** 역의 차례가 운임표로 이어지는 길인가 — 이웃한 두 역마다 구간이 있다. 기억해 둔 길(src/routes.js)을 쓰기 전에 본다. */
export const pathKnown = (path) => Array.isArray(path) && path.length >= 2 && path.every((s, i) => i === 0 || !!routeOf(path[i - 1], s));

/**
 * 두 역 사이의 대략 소요 시간(시간 단위) — 운임 옆에 적어 둔 값이다(ktx-fares.yaml 의 times: 서울↔부산 4시간, 가장 짧아도 1시간).
 * 운임표에 없는 구간이면 null.
 */
export const hoursOf = (a, b) => routeOf(a, b)?.hours ?? null;

const isHour = (n) => Number.isInteger(n) && n >= 0 && n <= 23;

/**
 * 교통편 줄의 출발·도착 시(時) — 여비계산서 교통비 표에서 출발지·도착지 옆의 "시간" 칸이다(2026-10-03 사용자 지정).
 *
 * 가는 편은 출장 출발 시각에 떠나 그 구간의 대략 소요 시간(hoursOf) 뒤에 닿고, 오는 편은 출장 도착 시각에 닿게 그만큼 앞서 떠난다 —
 * 07시 출발·20시 도착, 부산↔서울 4시간이면 가는 편 07 → 11시, 오는 편 16 → 20시다. 줄에 이미 적힌 시각(0시가 아닌 것)은 그대로 두고
 * 빈 쪽만 채운다. 소요 시간은 KTX 줄에서만 안다 — 다른 교통편이거나 운임표에 없는 구간이면 아는 쪽(가는 편의 출발, 오는 편의 도착)만 적는다.
 *
 * @param {'go'|'back'} key
 * @param {{dep?:string, arr?:string, transport?:string, shr?:number, ehr?:number}} row 교통편 줄(수단 값은 사전정산 화면의 것)
 * @param {{sHour?:number|null, eHour?:number|null}} when 출장의 출발 시·도착 시
 * @returns {{shr: number|null, ehr: number|null}} 모르는 쪽은 null
 */
export function legTimes(key, row, { sHour, eHour } = {}) {
  const own = (v) => (isHour(v) && v > 0 ? v : null);
  const span = row?.transport === SITE_OF[GRADED] ? hoursOf(stationOf(row.dep), stationOf(row.arr)) : null;
  let shr = own(row?.shr);
  let ehr = own(row?.ehr);
  if (key === 'go') {
    shr ??= isHour(sHour) ? sHour : null;
    if (ehr == null && shr != null && span) ehr = Math.min(23, shr + span);
  } else {
    ehr ??= isHour(eHour) ? eHour : null;
    if (shr == null && ehr != null && span) shr = Math.max(0, ehr - span);
  }
  return { shr, ehr };
}

/**
 * 한 편의 줄들을 한 줄로 말한다. 갈아타는 편(부산→오송, 오송→목포)은 처음 떠나는 곳·마지막에 닿는 곳·요금의 합이고,
 * 구간마다의 줄은 parts 에 둔다 — 여비계산서에는 parts 의 줄들이 올라간다(legParts). 줄이 하나면 그 줄 그대로다.
 */
const joinLeg = (rows) => (rows.length < 2 ? rows[0] || null
  : { ...rows[0], arr: rows.at(-1).arr, ehr: rows.at(-1).ehr, total: rows.reduce((n, r) => n + (Number(r.total) || 0), 0), parts: rows });

/** 편의 줄(legsOfRows·legPlan 의 row)을 여비계산서에 올라가는 줄들로 — 갈아타는 편이면 구간마다의 줄, 아니면 그 한 줄이다. */
export const legParts = (row) => (row ? row.parts || [row] : []);

/** 편이 지나는 역의 차례 — [부산, 오송, 목포]. 갈아타지 않으면 [떠나는 곳, 닿는 곳]이다. */
const stopsOf = (row) => [row.dep, ...legParts(row).map((p) => p.arr)];

/**
 * 편의 줄마다의 출발·도착 시(legTimes). 갈아타는 편이면 구간이 이어지게 채운다 — 가는 편은 앞 구간이 닿은 시각에 다음 구간이 떠나고,
 * 오는 편은 뒤 구간이 떠나는 시각에 앞 구간이 닿는다. 07시 출발·20시 도착, 부산↔오송 3시간·오송↔목포 2시간이면
 *   가는 편  부산 07 → 오송 10 → 목포 12시        오는 편  목포 15 → 오송 17 → 부산 20시
 * @returns {{shr: number|null, ehr: number|null}[]} legParts(row) 와 같은 차례
 */
export function legTimesAll(key, row, when = {}) {
  const parts = legParts(row);
  if (parts.length < 2) return parts.map((p) => legTimes(key, p, when));
  const out = [];
  if (key === 'go') {
    let at = when.sHour;
    for (const p of parts) { out.push(legTimes('go', p, { sHour: at })); at = out.at(-1).ehr; }
  } else {
    let at = when.eHour;
    for (const p of [...parts].reverse()) { out.unshift(legTimes('back', p, { eHour: at })); at = out[0].shr; }
  }
  return out;
}

/* ------------------------------------------------------------ 셈 */

/**
 * 식수. 점심은 날마다 한 끼, 아침은 첫날 일찍 떠났을 때, 저녁은 마지막 날 늦게 닿았을 때만 더한다.
 * 그 사이의 끼니는 모두 센다 — 3 × 일수에서 못 받는 첫 아침·마지막 저녁을 뺀 것이다.
 */
export function mealsOf({ days, startHour, endHour }) {
  const breakfast = startHour <= RULES.meals.breakfast.first_day_depart_hour_at_most;
  const dinner = endHour >= RULES.meals.dinner.last_day_arrive_hour_at_least;
  return RULES.meals.per_day * days - (breakfast ? 0 : 1) - (dinner ? 0 : 1);
}

/** 일비 일수. 일수 그대로다. */
export const dailyOf = (days) => days * RULES.daily.per_day;

/**
 * 여비계산서의 출장지 칸에 넣을 글 — "출장지(장소)"(2026-10-08 사용자 지정: "대전(한국기계연구원)"). 장소를 적지 않았으면 출장지만이다.
 * 차량 신청의 행선지도 이것이다(src/carfind.js). KTX 역은 여기가 아니라 출장지(place)에서 찾는다.
 * @param {{place?: string, venue?: string}} form 근태 패널의 출장 폼
 */
export function tripLocation(form) {
  const place = String(form?.place || '').trim();
  const venue = String(form?.venue || '').trim();
  return place && venue ? `${place}(${venue})` : place || venue;
}

/**
 * 출장 폼에서 여비계산서(사전정산) 초안을 짓는다.
 *
 * 당일이면 당일출장(주재국), 1박 이상이면 일반출장이다. 당일출장은 사이트가 일비·식비 내역을 받지 않으므로
 * stay 가 null 이다. 교통편 내역은 **기차(KTX)만** 골랐고 운임표에 그 구간·그 등급의 값이 있을 때만 두 줄(가는 길·오는 길)이
 * 들어간다 — 줄마다 출발·도착 시(shr·ehr)도 적는다(legTimes). 못 넣으면 notes 에 까닭을, why 에 그것을 줄인 말을 적는다. 기차와 비행기를 함께 골랐으면 어느 편이 무엇인지
 * 신청할 때는 알 수 없어 비워 둔다(다녀온 뒤 신청 내역의 출장 카드에서 가는 편·오는 편을 골라 사후정산에 올린다 — legPlan).
 *
 * 내릴 역(2026-10-04 사용자 지정): 출장지에 KTX 역이 없으면 가까운 역 가운데 근무지에서 먼 역이고(stationOf), 두 역을 바로 잇는 KTX 가
 * 없으면 갈아타는 길이다(pathOf) — 부산→목포는 부산→오송·오송→목포 두 줄씩 네 줄이 들어간다. **지난번에 그 출장지로 간 길을 기억해
 * 두었으면(memo.path — src/routes.js) 그 길이 먼저다** — 같은 역에서 떠나고 운임표로 이어지는 길일 때만 쓴다(kept 가 참이다).
 *
 * @param {object} form 근태 패널의 출장 폼(dateFrom·dateTo·days·start·end·place·venue·workplace·transport·trainGrade·purpose)
 * @param {{path?: string[]}|null} [memo] 그 출장지에 기억해 둔 교통편(src/routes.js 의 recallRoute)
 * @returns {object} { period, sDate, sHour, eDate, eHour, location, area, purpose, nation, stay, method, transports, grade, trans, notes, why, kept }
 */
export function settlePlan(form, memo = null) {
  const days = Number.isInteger(form.days) && form.days >= 1 ? form.days : 1;
  const dayTrip = days === 1;
  const sHour = +String(form.start || '').slice(0, 2);
  const eHour = +String(form.end || '').slice(0, 2);
  const notes = [];
  const picked = transportsOf(form);
  const transports = picked.length ? picked : [DEFAULT_TRANSPORT];
  const grade = trainGradeOf(form);
  const names = transports.map(labelOf).join('·');
  let why = '';

  let trans = [];
  let kept = false;
  if (transports.length === 1 && TRANSPORTS.find((t) => t.value === transports[0]).auto) {
    const dep = stationOf(form.workplace);
    // 지난번에 이 출장지로 간 길이 먼저다 — 같은 역에서 떠난 길이고 지금 운임표로 이어질 때만.
    const last = dep && pathKnown(memo?.path) && memo.path[0] === dep && memo.path.at(-1) !== dep ? memo.path : null;
    const arr = last ? last.at(-1) : stationOf(form.place, dep);
    if (!dep) notes.push(`근무지 "${String(form.workplace || '').trim()}" 에서 탈 KTX 역을 찾지 못해 교통편 내역은 비워 둡니다`);
    else if (!arr) notes.push(`출장지 "${String(form.place || '').trim()}" 에서 내릴 KTX 역을 찾지 못해 교통편 내역은 비워 둡니다`);
    else if (dep === arr) notes.push(`근무지와 출장지가 같은 역(${dep})이라 교통편 내역은 비워 둡니다`);
    else {
      const auto = pathOf(dep, stationOf(form.place, dep));
      const path = last || auto;
      const go = trainRows(form.dateFrom, path, grade);
      const back = trainRows(form.dateTo, path && [...path].reverse(), grade);
      if (!go || !back) {
        // 구간은 있는데 그 등급(특실)의 값만 모르는 것과, 구간이 아예 없는 것을 가려 말한다.
        const known = !!trainRows(form.dateFrom, path, DEFAULT_GRADE);
        if (known) why = `${dep}↔${arr} ${gradeLabel(grade)} 운임 모름`;
        notes.push(known
          ? `KTX 운임표(ktx-fares.yaml)에 ${dep}↔${arr} ${gradeLabel(grade)} 운임이 없어 교통편 내역은 비워 둡니다`
          : `KTX 운임표(ktx-fares.yaml)에 ${dep}↔${arr} 구간이 없어 교통편 내역은 비워 둡니다`);
      } else {
        // 줄마다 출발·도착 시 — 가는 편은 출발 시각에 떠나고, 오는 편은 도착 시각에 닿는다(구간의 대략 소요 시간만큼).
        const timed = (key, rows) => legTimesAll(key, joinLeg(rows), { sHour, eHour }).map((at, i) => ({ ...rows[i], ...at }));
        trans = [...timed('go', go), ...timed('back', back)];
        // 기억해 둔 길이 지금 찾은 길과 다를 때만 그렇다고 말한다(같으면 알릴 것이 없다).
        kept = !!last && String(last) !== String(auto);
      }
    }
  } else if (transports.length > 1) {
    why = '가는 편·오는 편은 다녀와서 신청 내역에서 고름';
    notes.push(`${names}를 함께 골라 어느 편이 무엇인지 아직 알 수 없어 교통편 내역은 비워 둡니다 — 다녀온 뒤 신청 내역의 출장 카드에서 가는 편·오는 편을 고르거나 항공권을 넣으면 사후정산에 올라갑니다`);
  } else {
    notes.push(`${names}는 요금이 그때그때 달라 교통편 내역은 비워 둡니다`);
  }

  return {
    period: dayTrip ? RULES.period.day_trip.code : RULES.period.general.code,
    periodLabel: dayTrip ? RULES.period.day_trip.label : RULES.period.general.label,
    sDate: form.dateFrom, sHour, eDate: dayTrip ? form.dateFrom : form.dateTo, eHour,
    location: tripLocation(form),
    area: dayTrip ? RULES.period.day_trip.area : '',
    purpose: String(form.purpose || '').trim(),
    nation: RULES.nation.code,
    stay: dayTrip ? null : { region: RULES.nation.code, day: days, daily: dailyOf(days), meal: mealsOf({ days, startHour: sHour, endHour: eHour }) },
    method: RULES.transport.method.code,
    transports, grade,
    trans, notes, why, kept,
  };
}

/** KTX 한 구간의 교통편 줄. 운임표에 그 구간·그 등급의 값이 없으면 null. */
function trainRow(date, dep, arr, grade) {
  const f = fareOf(dep, arr, date, grade);
  return f && { date, dep, arr, transport: SITE_OF[GRADED], grade: gradeLabel(grade), total: f.fare, currency: RULES.transport.train.currency, trseq: '', revno: '' };
}

/** KTX 한 편의 교통편 줄들 — 길(pathOf)의 구간마다 한 줄이다. 길이 없거나 어느 구간의 그 등급 값을 모르면 null. */
function trainRows(date, path, grade) {
  if (!path) return null;
  const rows = path.slice(1).map((to, i) => trainRow(date, path[i], to, grade));
  return rows.every(Boolean) ? rows : null;
}

/**
 * 초안을 한 줄로. 누르기 전에 "올릴 내용"에 적어 보여준다. 갈아타는 길은 거치는 역까지 적고 요금은 편마다의 합이다
 * ("KTX 부산↔오송↔목포 일반석 69,500원 × 2"). 지난번에 쓴 길을 다시 썼으면 그렇다고 적는다.
 */
export function describePlan(plan) {
  const parts = [plan.periodLabel, plan.location];
  if (plan.stay) parts.push(`일비 ${plan.stay.daily}일 · 식비 ${plan.stay.meal}식`);
  if (plan.trans.length) {
    const { go, back } = legsOfRows(plan.trans, { from: plan.sDate, to: plan.sDate });
    const fares = go.total === back.total ? `${won(go.total)}원 × 2` : `${won(go.total)}원 + ${won(back.total)}원`;
    parts.push(`KTX ${stopsOf(go).join('↔')} ${go.grade} ${fares}${plan.kept ? ' · 지난번에 쓴 길' : ''}`);
  } else {
    parts.push(plan.why ? `교통편 내역 없음(${plan.why})` : '교통편 내역 없음');
  }
  return parts.join(' · ');
}

/* ------------------------------------------------------------ 가는 편·오는 편 */
// 신청 폼의 교통편은 사전정산용이다. 실제로 무엇을 탔는지는 신청 내역의 출장 카드에서 가는 편·오는 편마다 고른다 — 처음에는
// 사전정산대로 골라져 있고, 손으로 바꾸거나 항공권을 넣으면 그 날짜·시각의 편이 바뀐다. 이것이 **사후정산**의
// 교통비 내역이 된다(2026-10-03 사용자 지정). 여기는 무엇을 올릴지만 셈한다 — 묶는 것은 src/after.js, 올리는 것은 src/trip.js 다.

export const LEGS = [{ key: 'go', label: '가는 편' }, { key: 'back', label: '오는 편' }];
/** 편에 앉히는 표 — 항공권뿐이다. 기차표는 증빙으로 받지 않고 KTX 는 운임표의 정가로 넣는다(2026-10-03 사용자 지정). */
const FLIGHT_DOCS = new Set(['flight_ticket', 'flight_receipt']);
const TRANS_KEYS = ['date', 'dep', 'arr', 'transport', 'grade', 'total'];

/** 두 교통편 줄 목록이 같은가(일자·구간·수단·등급·요금). 가는 편·오는 편이 사전정산과 달라졌는지를 이것으로 본다. */
export const sameTrans = (a, b) => (a || []).length === (b || []).length
  && (a || []).every((r, i) => TRANS_KEYS.every((k) => String(r[k] ?? '') === String(b[i][k] ?? '')));

/**
 * 사전정산 작성 화면의 교통편 줄을 읽는다(지움 표시가 된 줄은 뺀다). 줄이 없으면 빈 목록이다.
 * @param {Document} doc
 * @returns {{seq:string, trseq:string, revno:string, date:string, dep:string, arr:string, transport:string, grade:string, total:number, currency:string,
 *            shr:number, ehr:number}[]} shr·ehr 은 출발·도착 시(時) — 화면이 고르지 않은 줄에 주는 값이 0 이다
 */
export function parseTransRows(doc) {
  const out = [];
  for (const sel of doc.querySelectorAll('form#frm select[name="tr_transport"]')) {
    const tr = sel.closest('tr');
    const val = (name) => { const el = tr?.querySelector(`[name="${name}"]`); return el ? fieldValue(el) : ''; };
    if (!tr || val('tr_del') === '1') continue;
    out.push({
      seq: val('tr_seq'), trseq: val('tr_trseq'), revno: val('tr_revno'), date: val('tr_date'), dep: val('tr_dep').trim(), arr: val('tr_arr').trim(),
      transport: val('tr_transport'), grade: val('tr_grade').trim(), total: Number(val('tr_total').replace(/,/g, '')) || 0, currency: val('tr_currency'),
      shr: Number(val('tr_shr')) || 0, ehr: Number(val('tr_ehr')) || 0,
    });
  }
  return out;
}

/**
 * 사전정산 작성 화면의 일비·식비 줄을 읽는다(지움 표시가 된 줄은 뺀다). 줄이 없으면 빈 목록이다.
 * 금액 칸(stay_dailyamt·stay_mealamt)은 화면에서 늘 0 이라(2026-10-05 실제 화면 145580 — 금액은 계산서가 셈한다) 읽지 않는다.
 * @param {Document} doc
 * @returns {{seq:string, day:number, daily:number, long:number, meal:number}[]} day 는 일수, daily 는 일비 일수, long 은 장기일비 일수, meal 은 식수
 */
export function parseStayRows(doc) {
  const out = [];
  for (const el of doc.querySelectorAll('form#frm input[name="stay_meal"]')) {
    const tr = el.closest('tr');
    const val = (name) => { const f = tr?.querySelector(`[name="${name}"]`); return f ? fieldValue(f) : ''; };
    if (!tr || val('stay_del') === '1') continue;
    const num = (name) => Number(val(name).replace(/,/g, '')) || 0;
    out.push({ seq: val('stay_seq'), day: num('stay_day'), daily: num('stay_daily'), long: num('stay_long'), meal: num('stay_meal') });
  }
  return out;
}

/**
 * 출장 카드에 적는 사전정산의 일비·식비 한 줄(2026-10-05 사용자 지정: "정산내역에서 사전정산에서의 일비랑 식비를 한줄에 표기하고..
 * 식비는 아이콘으로 줄이거나 늘릴 수 있게") — 일비 일수와 식수다. **일수가 적힌 줄만 센다**: 화면에는 값이 모두 0 인 빈 줄이 남아
 * 있기도 하다(2026-10-05 실제 화면 145580 의 둘째 줄).
 *
 * 식수를 카드에서 고칠 수 있는 것은 그런 줄이 하나일 때다(국내 출장은 한 줄이다) — 줄이 여럿이면(나라가 여럿) 어느 줄의 식수인지
 * 카드에서는 가릴 수 없어 합만 적는다. 식수는 0 부터 일수 × 하루 세 끼까지다(이미 그보다 많이 적혀 있으면 그 값까지).
 * 당일출장(주재국)은 사이트가 일비·식비 내역을 받지 않아 null 이다.
 *
 * @param {{stays?: object[], period?: string, want?: number|null}} ctx stays 는 parseStayRows 의 줄, period 는 화면의 출장기간 구분,
 *   want 는 카드에서 고쳐 둔 식수다(없으면 사전정산의 값 그대로)
 * @returns {{daily:number, meal:number, had:number, min:number, max:number, editable:boolean, changed:boolean, set:Object<string,number>|null}|null}
 *   had 는 사전정산에 지금 적힌 식수, set 은 다시 저장할 때 고칠 줄({줄 번호: 식수} — preEditBody 의 meals)이다. 고친 것이 없으면 null
 */
export function stayPlan({ stays = [], period = '', want = null } = {}) {
  if (String(period) === RULES.period.day_trip.code) return null;
  const live = (stays || []).filter((s) => s.day > 0);
  if (!live.length) return null;
  const sum = (key) => live.reduce((n, s) => n + s[key], 0);
  const had = sum('meal');
  const row = live.length === 1 && live[0].seq ? live[0] : null;
  const max = row ? Math.max(had, RULES.meals.per_day * Math.ceil(row.day)) : had;
  const meal = row && Number.isInteger(want) ? Math.min(max, Math.max(0, want)) : had;
  return { daily: sum('daily'), meal, had, min: 0, max, editable: !!row, changed: meal !== had, set: meal !== had ? { [row.seq]: meal } : null };
}

/** 사이트 줄 하나를 패널의 선택({t: 교통편, g: 기차 등급})으로. 패널이 모르는 수단(지하철·선박)은 t 가 빈 글이다. 줄이 없으면 null. */
export const pickOfRow = (row) => (row ? { t: VALUE_OF[row.transport] || '', g: /특|^F$/i.test(row.grade || '') ? 'first' : DEFAULT_GRADE } : null);

/**
 * 사이트의 교통편 줄을 가는 편·오는 편에 앉힌다. 첫 줄이 가는 편, 둘째 줄이 오는 편이다(사이트가 줄을 더하는 차례).
 * 줄이 하나뿐이면 그 날짜가 출발일과 다른 도착일일 때만 오는 편이다. 두 편 뒤의 줄은 extra 에 줄 수만 남긴다.
 *
 * **갈아타는 편은 여러 줄이 한 편이다**(부산→오송, 오송→목포) — 앞 줄이 닿은 곳에서 같은 날 같은 교통편으로 이어 가고, 그 편이 이미
 * 지난 곳으로 돌아가지 않는 줄은 앞 줄과 같은 편으로 묶는다(돌아가는 줄 — 부산→서울 다음의 서울→부산 — 은 다음 편이다). 묶인 편은
 * 한 줄로 말한다(joinLeg: 처음 떠나는 곳 → 마지막에 닿는 곳, 요금의 합, 구간마다의 줄은 parts).
 */
export function legsOfRows(rows, trip) {
  const groups = [];
  for (const r of rows || []) {
    const g = groups.at(-1);
    const last = g?.at(-1);
    const onward = !!last && !!r.dep && r.dep === last.arr && r.date === last.date && r.transport === last.transport
      && !g.some((x) => x.dep === r.arr || x.arr === r.arr);
    if (onward) g.push(r);
    else groups.push([r]);
  }
  const legs = groups.map(joinLeg);
  if (legs.length === 1 && trip?.to && trip.to !== trip.from && legs[0].date === trip.to) return { go: null, back: legs[0], extra: 0 };
  return { go: legs[0] || null, back: legs[1] || null, extra: groups.slice(2).reduce((n, g) => n + g.length, 0) };
}

/** 가는 편·오는 편에서 고른 교통편의 다음 선택 — 기차·비행기를 한 번 더 누르면 특실, 또 누르면 일반석이다. 다른 것을 누르면 그것으로 바뀐다. */
export function nextLegPick(pick, value) {
  if (LEG_GRADED.includes(value) && pick?.t === value) return { t: value, g: pick.g === 'first' ? DEFAULT_GRADE : 'first' };
  return { t: value, g: DEFAULT_GRADE };
}

/**
 * 읽은 증빙(input.yaml 의 receipt) 가운데 항공권을 편으로 편다. 왕복표 한 장은 두 편이 되고,
 * 편마다 값이 따로 적혀 있지 않으므로 합계를 반씩 나눈다(split). 기차표·버스표는 편을 바꾸지 않는다 — 증빙으로 받지 않는다.
 * @returns {{mode:'plane', date:string, dep:string, arr:string, depTime:string, arrTime:string, total:number|null, currency:string,
 *            grade:string, name:string, airline:string, mileage:number|null, cocard:boolean, source:string, split:boolean}[]}
 *   name 은 항공사·편명, source 는 파일 이름이다. mileage 는 **그 문서에 적힌** 적립 마일리지다(왕복표면 두 편에 같은 값 — 문서 한 장의 것이다)
 */
export function ticketsOf(records) {
  const out = [];
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  for (const r of records || []) {
    if (!FLIGHT_DOCS.has(r?.docType)) continue;
    const total = typeof r.total === 'number' && Number.isFinite(r.total) ? r.total : null;
    const round = !!(r.retDate || s(r.retDepPlace) || s(r.retArrPlace));
    const first = total != null && round ? Math.ceil(total / 2) : total;
    const base = { mode: 'plane', currency: r.currency || RULES.transport.train.currency, grade: s(r.seatClass), cocard: r.corporateCard === true,
      source: r.file?.name || s(r.summary) || '표', split: round,
      airline: s(r.airline), mileage: typeof r.mileage === 'number' && Number.isFinite(r.mileage) ? r.mileage : null };
    out.push({ ...base, date: r.flightDate || '', dep: s(r.depPlace), arr: s(r.arrPlace), depTime: r.depTime || '', arrTime: r.arrTime || '', total: first,
      name: [s(r.airline), s(r.flightNo)].filter(Boolean).join(' ') });
    if (round) {
      out.push({ ...base, date: r.retDate || '', dep: s(r.retDepPlace) || s(r.arrPlace), arr: s(r.retArrPlace) || s(r.depPlace), depTime: r.retDepTime || '', arrTime: '',
        total: total != null ? total - first : null, name: [s(r.airline), s(r.retFlightNo)].filter(Boolean).join(' ') });
    }
  }
  return out;
}

/**
 * 항공권을 가는 편·오는 편에 앉힌다. 날짜가 출발일·도착일 가운데 하나와만 맞으면 그 편이다(1박 이상). 당일 출장이라 두 편이
 * 같은 날이면 **시각을 본다** — 표가 둘이면 이른 것이 가는 편, 늦은 것이 오는 편이다. 표가 하나뿐이면 떠나는 곳·닿는 곳을 보고
 * (근무지 쪽에서 떠나면 가는 편), 그것으로도 모르면 낮 12시 뒤에 떠나는 표를 오는 편으로 본다(2026-10-03 사용자 지정).
 * 한 편에 표는 하나다. 앉지 못한 표는 extra 로 돌려준다.
 * @param {{home?:string, dest?:string}} where 근무지·출장지에 적은 글(또는 역·공항 이름)
 * @returns {{go:object|null, back:object|null, extra:object[]}}
 */
export function seatTickets(tickets, trip, { home = '', dest = '' } = {}) {
  const seats = { go: null, back: null, extra: [] };
  const h = cityOf(home);
  const d = cityOf(dest);
  const multi = !!trip?.to && trip.to !== trip.from;
  const byDate = (t) => (multi && t.date === trip.from ? 'go' : multi && t.date === trip.to ? 'back' : '');
  const byPlace = (t) => {
    const from = cityOf(t.dep);
    const to = cityOf(t.arr);
    if ((h && from === h) || (d && to === d)) return 'go';
    if ((h && to === h) || (d && from === d)) return 'back';
    return '';
  };
  const order = (t) => `${t.date || ''} ${t.depTime || ''}`;
  const loose = [];
  for (const t of [...(tickets || [])].sort((a, b) => order(a).localeCompare(order(b)))) {
    const leg = byDate(t);
    if (!leg) loose.push(t);
    else if (!seats[leg]) seats[leg] = t;
    else seats.extra.push(t);
  }
  // 날짜로 못 가린 표(당일 출장이거나 날짜를 못 읽은 표). 시각이 다 적힌 표가 둘 이상이면 이른 차례대로 빈 편에 앉는다.
  const timed = loose.length >= 2 && loose.every((t) => t.depTime);
  for (const t of loose) {
    const want = timed ? '' : byPlace(t) || (loose.length === 1 && t.depTime >= '12:00' ? 'back' : '');
    const leg = want && !seats[want] ? want : !seats.go ? 'go' : !seats.back ? 'back' : '';
    if (leg) seats[leg] = t;
    else seats.extra.push(t);
  }
  return seats;
}

/**
 * 항공권을 읽은 뒤의 가는 편·오는 편 선택. 항공권이 앉은 편은 비행기가 되고, **항공권이 한 편뿐이면 나머지 편은 KTX** 다
 * (2026-10-03 사용자 지정) — 그 편을 이미 골라 두었거나 사전정산에 줄이 있으면 그대로 둔다. 그 편이 이미 비행기 특실이었으면
 * 특실은 그대로다(항공권을 넣었다고 일반석으로 돌아가지 않는다).
 * @param {{go?:object, back?:object}} picks 지금까지 고른 것
 * @param {{go:object|null, back:object|null}} seats seatTickets 의 결과
 * @param {{go:object|null, back:object|null}} site 사전정산의 줄(legsOfRows 의 결과)
 */
export function picksWithTickets(picks, seats, site = {}) {
  const next = { ...picks };
  for (const { key } of LEGS) {
    const was = picks?.[key] || pickOfRow(site[key]);
    if (seats[key]) next[key] = { t: 'plane', g: was?.t === 'plane' ? was.g : DEFAULT_GRADE };
  }
  const flown = LEGS.filter(({ key }) => seats[key]);
  if (flown.length === 1) {
    const rest = flown[0].key === 'go' ? 'back' : 'go';
    if (!seats[rest] && !next[rest] && !site[rest]) next[rest] = { t: GRADED, g: DEFAULT_GRADE };
  }
  return next;
}

/**
 * 가는 편·오는 편의 선택을 교통편 줄로 짓는다 — 카드가 편마다 무엇이 올라갈지 보여 주고, src/after.js 가 사후정산의 교통비 내역으로 쓴다.
 *
 * 편마다 — 비행기면 그 편에 앉은 항공권의 구간·요금이고(특실로 골랐으면 등급 칸만 특실이다), 사전정산에 이미 같은 교통편
 * (기차·비행기는 같은 등급)의 줄이 있으면 그 줄 그대로이며, 기차면 **운임표(ktx-fares.yaml)의 정가**다(기차표는 받지 않는다). 비행기·버스인데 항공권도 사전정산의 줄도 없으면
 * 요금을 몰라 problem 에 적는다(짐작으로 채우지 않는다). 손대지 않은 편은 사전정산의 줄 그대로다. 줄의 수단 값은 사전정산 화면의
 * 것(Train·Airplane·Bus)이다.
 *
 * @param {{trip:{from:string,to:string,location?:string}, picks?:{go?:object,back?:object}, rows?:object[], seats?:{go?:object,back?:object}, workplace?:string}} ctx
 *   rows 는 사전정산의 지금 줄(parseTransRows), seats 는 편에 앉힌 항공권(seatTickets), workplace 는 근무지에 적어 둔 글이다
 * @returns {{legs: {key:string,label:string,date:string,pick:object|null,site:object|null,row:object|null,ticket:object|null,source:string,problem:string}[],
 *            problems: string[], notes: string[], changed: boolean}} changed 는 사전정산과 달라졌는가
 */
export function legPlan({ trip, picks = {}, rows = [], seats = {}, workplace = '' }) {
  const site = legsOfRows(rows, trip);
  const home = stationOf(site.go?.dep) || stationOf(site.back?.arr) || stationOf(workplace);
  const dest = stationOf(site.go?.arr) || stationOf(site.back?.dep) || stationOf(trip.location, home);
  // 사전정산에서 가는 편·오는 편으로 본 줄들 — 갈아타는 편이면 한 편이 여러 줄이다.
  const had = [...legParts(site.go), ...legParts(site.back)];
  const notes = [];
  if (site.extra) notes.push(`사전정산에 교통편 줄이 ${rows.length}개입니다 — 가는 편·오는 편은 처음 ${had.length > 2 ? '두 편으' : '두 줄'}로 봅니다`);
  const legs = LEGS.map(({ key, label }) => {
    const date = key === 'go' ? trip.from : trip.to || trip.from;
    const cur = site[key];
    const leg = { key, label, date, pick: picks[key] || pickOfRow(cur), site: cur, row: cur, ticket: null, source: cur ? 'site' : '', problem: '' };
    const pick = picks[key];
    if (!pick?.t) return leg;                       // 손대지 않은 편 — 사전정산의 줄 그대로
    const code = SITE_OF[pick.t];
    const ticket = pick.t === 'plane' ? seats[key] : null;
    if (ticket && ticket.total != null && ticket.dep && ticket.arr) {
      if (ticket.date && (ticket.date < trip.from || ticket.date > (trip.to || trip.from))) notes.push(`${label}: 항공권의 날짜(${md(ticket.date)})가 출장 기간 밖입니다 — ${ticket.source}`);
      if (ticket.split) notes.push(`${label}: 왕복 항공권의 합계를 두 편에 반씩 나눠 적었습니다 — ${ticket.source}`);
      // 비행기를 한 번 더 눌러 특실로 골랐으면 등급 칸에 특실이 들어간다 — 아니면 항공권에 적힌 좌석 등급이다. 요금은 어느 쪽이든 항공권의 것이다.
      return { ...leg, ticket, source: 'ticket', row: { date: ticket.date || date, dep: ticket.dep, arr: ticket.arr, transport: code,
        grade: pick.g === 'first' ? gradeLabel('first') : ticket.grade, total: ticket.total, currency: ticket.currency, trseq: '', revno: '' } };
    }
    if (cur && cur.transport === code && (!LEG_GRADED.includes(pick.t) || pickOfRow(cur).g === pick.g)) return leg;
    if (pick.t !== GRADED) {
      // 사전정산에 비행기 줄이 있는데 등급만 바꿨다(특실 ↔ 일반석) — 그 줄의 구간·요금 그대로에 등급 글만 바꾼다.
      if (cur && cur.transport === code) {
        const grade = gradeLabel(pick.g);
        return { ...leg, row: { ...cur, grade, ...(cur.parts ? { parts: cur.parts.map((p) => ({ ...p, grade })) } : {}) }, source: 'grade' };
      }
      // 비행기는 항공권이 요금을 말해 준다. 버스는 읽을 표가 없다 — 사후정산 화면에서 직접 넣는다.
      const how = pick.t === 'plane' ? '항공권을 넣어 주세요' : '사후정산 화면에서 직접 넣어 주세요';
      return { ...leg, row: null, source: '', problem: `${labelOf(pick.t)} 요금을 모릅니다 — ${how}` };
    }
    // 두 역을 바로 잇는 KTX 가 없으면 갈아타는 길이다(pathOf) — 그 편은 구간마다 한 줄씩 올라간다(row.parts).
    const [a, b] = key === 'go' ? [home, dest] : [dest, home];
    const path = pathOf(a, b);
    const made = trainRows(date, path, pick.g);
    if (made) return { ...leg, row: joinLeg(made), source: 'fare' };
    const problem = !home ? `근무지 "${String(workplace || '').trim()}" 에서 탈 KTX 역을 찾지 못했습니다`
      : !dest ? `출장지 "${String(trip.location || '').trim()}" 에서 내릴 KTX 역을 찾지 못했습니다`
        : a === b ? `근무지와 출장지가 같은 역(${a})입니다`
          : `KTX 운임표에 ${a}↔${b} ${trainRows(date, path, DEFAULT_GRADE) ? `${gradeLabel(pick.g)} 운임` : '구간'}이 없습니다`;
    return { ...leg, row: null, source: '', problem };
  });
  const out = legs.flatMap((l) => legParts(l.row));
  return { legs, problems: legs.filter((l) => l.problem).map((l) => `${l.label}: ${l.problem}`), notes, changed: !sameTrans(out, had) };
}

/**
 * 사전정산을 다시 작성할 때의 가는 편·오는 편(2026-10-05 사용자 지정: "사전정산 다시하기") — 출장 카드에서 편마다 교통편을 다시 고르면
 * 사전정산 입력 화면의 교통편 줄을 그것으로 바꿔 다시 저장한다. 여기는 무엇을 지우고(drop) 무엇을 새로 넣는지(add)만 셈한다 —
 * 본문은 preEditBody 가 짓고, 보내는 것은 src/trip.js 의 tripPreSave 다.
 *
 * 편마다 — 손대지 않았거나 사전정산의 줄과 같은 것을 골랐으면 그 줄 그대로다. 기차면 운임표의 정가이고(legPlan), 비행기·버스면
 * **줄을 넣지 않는다** — 신청할 때와 같다(settlePlan: 요금이 그때그때 달라 교통편 내역은 비워 둔다. 비행기는 다녀온 뒤 사후정산에
 * 항공권으로 올린다). 바꾼 편의 새 줄에는 출발·도착 시를 적는다(legTimesAll).
 *
 * **한 편만 바꿔도 교통편 줄은 모두 지우고 차례대로(가는 편 → 오는 편 → 그 뒤의 줄) 다시 넣는다** — 바꾸지 않은 편의 줄은 값 그대로
 * 다시 들어간다. 가는 편의 줄만 새로 넣으면 그 줄이 오는 편의 줄보다 뒤에 서서(새 줄은 번호가 크다), 다음에 읽을 때 첫 줄을 가는 편으로
 * 보는 규칙(legsOfRows)에서 두 편이 뒤바뀐다.
 *
 * **편의 일자·출발 시·도착 시는 여비계산서에 저장된 값이 바탕이고, 카드에서 고친 것(edits)을 그 위에 얹는다**(2026-10-05 사용자 지정:
 * "여비계산서 상의 값을 기본적으로 갖어오도록 해줘, 갖어온 상태에서 수정을 할 수 있게") — 일자는 그 편의 모든 줄, 출발 시는 첫 줄,
 * 도착 시는 마지막 줄에 들어간다. 교통편은 그대로 두고 일자·시각만 고쳤으면 줄을 지우고 다시 넣지 않고 **그 줄의 칸만 고친다**(set —
 * 화면에서 그 칸을 고쳐 적은 것과 같다). 교통편을 바꾼 편이 있으면 줄을 모두 다시 넣으므로 고친 값은 다시 넣는 줄에 실린다.
 *
 * @param {{trip:object, picks?:{go?:object,back?:object}, rows?:object[], workplace?:string, sHour?:number|null, eHour?:number|null,
 *   edits?:{go?:{date?:string,shr?:number,ehr?:number}, back?:object}}} ctx
 *   rows 는 사전정산의 지금 줄(parseTransRows), sHour·eHour 는 출장의 출발 시·도착 시, edits 는 카드에서 고친 편마다의 일자·출발 시·도착 시다
 * @returns {{legs: object[], drop: string[], add: object[], set: Object<string,{date?:string,shr?:number,ehr?:number}>|null, problems: string[], notes: string[], changed: boolean}}
 *   legs 는 legPlan 의 편(줄을 넣지 않는 편은 row 가 null 이고 blank 가 그 말이다)에 when(여비계산서에 설 일자·출발 시·도착 시 — legWhen)·
 *   base(고치기 전의 그것)·edited(고친 것이 있는가)를 더한 것이다. drop 은 지울 줄의 번호(tr_seq), add 는 새로 넣을 줄, set 은 칸만 고칠 줄
 *   ({줄 번호: 고칠 칸})이다. 바꾼 것이 없으면 drop·add 가 비어 있고 set 이 null 이다
 */
export function prePlan({ trip, picks = {}, rows = [], workplace = '', sHour = null, eHour = null, edits = {} }) {
  const route = legPlan({ trip, picks, rows, workplace });
  const planned = route.legs.map((l) => (picks[l.key]?.t && picks[l.key].t !== GRADED && l.source !== 'site' && !l.row
    ? { ...l, problem: '', blank: `${labelOf(picks[l.key].t)} — 사전정산에는 교통편 줄을 넣지 않습니다` } : l));
  // 그 편의 줄이 달라지는가 — 손대지 않았거나 사전정산의 줄과 같으면 아니고, 줄이 없던 편에 줄을 넣지 않는 것도 달라지는 것이 아니다.
  const moved = (l) => !!picks[l.key]?.t && l.source !== 'site' && !l.problem && !!(l.site || l.row);
  const anyMoved = planned.some(moved);
  const hr = (v) => Number(v) || 0;
  const differs = (r, b) => r.date !== b.date || hr(r.shr) !== hr(b.shr) || hr(r.ehr) !== hr(b.ehr);
  // 편마다 여비계산서에 설 줄 — 바꾼 편은 새 줄(출발·도착 시를 채워서)이고, 아니면 저장된 줄 그대로다. 그 위에 카드에서 고친 일자·시각을 얹는다.
  const legs = planned.map((l) => {
    const base = l.problem || !moved(l) ? legParts(l.site) : legTimesAll(l.key, l.row, { sHour, eHour }).map((at, i) => ({ ...legParts(l.row)[i], ...at }));
    const e = edits?.[l.key] || {};
    const lines = base.map((r, i) => ({ ...r, ...(DATE_RE.test(e.date || '') ? { date: e.date } : {}),
      ...(i === 0 && isHour(e.shr) ? { shr: e.shr } : {}), ...(i === base.length - 1 && isHour(e.ehr) ? { ehr: e.ehr } : {}) }));
    return { ...l, lines, when: legWhen({ parts: lines }), base: legWhen({ parts: base }), edited: lines.some((r, i) => differs(r, base[i])) };
  });
  const edited = legs.some((l) => l.edited);
  const kept = new Set(legs.flatMap((l) => legParts(l.site)));
  // 교통편은 그대로이고 일자·시각만 고친 줄 — 달라진 칸만 적는다.
  const set = {};
  if (!anyMoved) {
    for (const l of legs) {
      l.lines.forEach((r, i) => {
        const b = legParts(l.site)[i];
        if (!r.seq || !differs(r, b)) return;
        set[r.seq] = { ...(r.date !== b.date ? { date: r.date } : {}), ...(hr(r.shr) !== hr(b.shr) ? { shr: hr(r.shr) } : {}), ...(hr(r.ehr) !== hr(b.ehr) ? { ehr: hr(r.ehr) } : {}) };
      });
    }
  }
  return {
    legs,
    drop: anyMoved ? rows.map((r) => r.seq).filter(Boolean) : [],
    add: anyMoved ? [...legs.flatMap((l) => l.lines), ...rows.filter((r) => !kept.has(r))].map((r) => ({ ...r })) : [],
    set: Object.keys(set).length ? set : null,
    problems: legs.filter((l) => l.problem).map((l) => `${l.label}: ${l.problem}`), notes: route.notes, changed: anyMoved || edited,
  };
}

/**
 * 편의 줄이 여비계산서에 적힌 일자·출발 시·도착 시 — 일자와 출발 시는 첫 줄, 도착 시는 마지막 줄의 것이다(갈아타는 편은 구간마다 줄이 있다).
 * 시각 0 은 적지 않은 것이다(화면의 첫 선택지 — 계산서에는 00:00 으로 찍힌다). 줄이 없으면 null.
 * @returns {{date:string, shr:number, ehr:number}|null}
 */
export function legWhen(row) {
  const parts = legParts(row);
  return parts.length ? { date: parts[0].date || '', shr: Number(parts[0].shr) || 0, ehr: Number(parts.at(-1).ehr) || 0 } : null;
}

/**
 * 그 편의 **사이트에 저장된 줄**이 출장 일정·운임표로 지은 값과 어디가 다른가(2026-10-05 사용자 지정: "저장된 값이 다르면 다른 부분을
 * 확인할 수 있도록"). 카드는 편을 출장 일정의 날짜로 부르고("오는 편 9/10") 시각은 적지 않아서, 저장된 줄의 일자가 다르거나 출발·도착 시가
 * 비어 있어도 보이지 않았다(2026-10-05 실제 계산서 145580 — 오는 편의 일자가 출발일이고 두 줄 모두 0시, 요금은 사내 요금표의 53,700원).
 *
 * 줄마다(갈아타는 편은 구간마다) 견주는 것:
 *   일자   그 편의 날(가는 편 = 출발일, 오는 편 = 도착일)
 *   시각   출발·도착 시가 비어 있는데(0시) 출장의 출발·도착 시와 구간의 소요 시간으로 채울 수 있을 때(legTimesAll — 적혀 있는 시각은 견주지 않는다)
 *   요금   KTX 줄이면 운임표의 정가(그 줄의 두 역·그 등급)
 * 줄의 역은 견주지 않는다 — 사이트에서 고친 역이 먼저다(그 길을 기억해 다음에도 쓴다). **등급 글도 견주지 않는다** — 사내 요금표에서 고른 줄은
 * 그 표의 글("일반"·"E")이 적혀 있어 패널이 적는 글("일반석")과 달라도 같은 등급이다(2026-10-05 실제 계산서 145580: 사용자가 사이트에서
 * 요금표의 정가로 고친 뒤 등급 글만 달라 `다름 1`이 남았다 — 다른 곳이 없으면 표시도 없어야 한다). 카드에서 다시 고른 편(저장된 줄 그대로가 아닌 편)과
 * 줄이 없는 편은 견줄 것이 없다.
 *
 * @param {object} leg legPlan·prePlan 의 편
 * @param {{sHour?: number|null, eHour?: number|null}} when 출장의 출발 시·도착 시(tripPreDetail)
 * @returns {{key:'date'|'time'|'fare', label:string, saved:string, by:string, want:string, fix?:object}[]} label 은 항목의 이름(갈아타는
 *   편이면 구간을 앞에 붙인다), saved 는 저장된 값, by 는 무엇에 견준 값인지, want 는 그 값이다. 다른 곳이 없으면 빈 목록
 */
export function legDiffs(leg, { sHour = null, eHour = null } = {}) {
  if (!leg?.site || leg.source !== 'site') return [];
  // 사후정산 화면에서 읽은 줄(src/after.js transRowsOf)은 시각이 글이다 — 수로 맞춘다.
  const parts = legParts(leg.site).map((p) => ({ ...p, shr: Number(p.shr) || 0, ehr: Number(p.ehr) || 0 }));
  const times = legTimesAll(leg.key, parts.length > 1 ? { parts } : parts[0], { sHour, eHour });
  const hour = (h) => (h == null ? '?' : `${h}시`);
  const out = [];
  parts.forEach((p, i) => {
    const name = (what) => (parts.length > 1 ? `${p.dep}→${p.arr} ${what}` : what);
    // fix 는 카드에서 그 값으로 고칠 때 쓰는 값이다(prePlan 의 edits 모양) — 갈아타는 편은 구간마다 고칠 길이 카드에 없어 주지 않는다.
    const one = parts.length === 1;
    if (DATE_RE.test(p.date || '') && p.date !== leg.date) {
      out.push({ key: 'date', label: name('일자'), saved: md(p.date), by: '출장 일정', want: md(leg.date), ...(one ? { fix: { date: leg.date } } : {}) });
    }
    const t = times[i];
    if ((t.shr != null && t.shr !== p.shr) || (t.ehr != null && t.ehr !== p.ehr)) {
      const [shr, ehr] = [t.shr ?? p.shr, t.ehr ?? p.ehr];
      out.push({ key: 'time', label: name('시각'), saved: p.shr || p.ehr ? `${hour(p.shr || null)} → ${hour(p.ehr || null)}` : '없음',
        by: '출장 시각으로', want: `${hour(shr || null)} → ${hour(ehr || null)}`, ...(one ? { fix: { shr, ehr } } : {}) });
    }
    if (p.transport !== SITE_OF[GRADED]) return;
    const g = pickOfRow(p).g;
    const f = fareOf(stationOf(p.dep), stationOf(p.arr), leg.date, g);
    if (f && f.fare !== Number(p.total)) out.push({ key: 'fare', label: name('요금'), saved: `${won(p.total)}원`, by: '운임표', want: `${won(f.fare)}원` });
  });
  return out;
}

/** 교통편 줄 하나를 한 마디로 — "KTX 부산→서울 일반석 54,400원", 갈아타는 편이면 "KTX 부산→오송→목포 일반석 69,500원". 카드와 확인 문구에 쓴다. */
export function describeTrans(row) {
  const name = row.transport === SITE_OF[GRADED] ? 'KTX' : labelOf(VALUE_OF[row.transport]) || row.transport;
  return `${name} ${stopsOf(row).join('→')}${row.grade ? ` ${row.grade}` : ''} ${won(row.total)}${row.currency && row.currency !== 'KRW' ? ` ${row.currency}` : '원'}`;
}

/* ------------------------------------------------------------ 목록 읽기 */

const clean = (node) => String(node?.textContent || '').replace(/\s+/g, ' ').trim();

/**
 * 여비계산서 목록 화면(#mainList)을 읽는다. 한 계산서에 출장자가 여럿이면 둘째 줄부터는 칸이 셋(출장자·계산서·사후정산)이다.
 * 표가 없으면 null — 로그인 화면이거나 화면이 바뀐 것이다.
 * @param {Document} doc
 * @returns {{seq:string, href:string, pre:string, from:string, to:string, location:string, writer:string, written:string,
 *            travelers:{name:string, post:string}[]}[]|null}
 */
/** 줄의 칸 어딘가에 달린 주소에서 출장자 번호(trseq)를 읽는다 — 사후정산 입력 화면(AfterTrip?seq&trseq)을 여는 데 쓴다. */
const trseqOf = (cells) => {
  for (const c of cells) {
    const m = (c.getAttribute('data-href') || '').match(/[?&]trseq=(\d+)/);
    if (m) return m[1];
  }
  return '';
};

export function parseTripList(doc) {
  const table = doc.querySelector('#mainList');
  if (!table) return null;
  const out = [];
  for (const tr of table.querySelectorAll('tbody tr')) {
    const td = [...tr.children];
    if (td.length >= 9) {
      const [from, to] = clean(td[5]).split('~').map((s) => s.trim());
      if (!/^\d+$/.test(clean(td[0])) || !DATE_RE.test(from)) continue;
      out.push({
        seq: clean(td[0]), href: td[0].getAttribute('data-href') || '', pre: clean(td[3]),
        from, to: DATE_RE.test(to || '') ? to : from, location: clean(td[6]), writer: clean(td[7]), written: clean(td[8]),
        travelers: [{ name: clean(td[1]), post: clean(td[4]), trseq: trseqOf(td) }],
      });
    } else if (td.length >= 3 && out.length) {
      out[out.length - 1].travelers.push({ name: clean(td[0]), post: clean(td[2]), trseq: trseqOf(td) });
    }
  }
  return out;
}

/**
 * 화면 머리에 적힌 로그인한 사람의 이름("홍길동 (hong) / KOR | ENG" 의 앞부분). 목록의 출장자 칸과 같은 표기다 —
 * HR 은 이름을 영문으로 주기도 해서(2026-10-02 실제로 그랬다) 내 계산서를 가릴 때는 이 이름을 쓴다. 없으면 빈 글.
 */
export function tripUser(doc) {
  return clean(doc.querySelector('.bt-user')).split('(')[0].trim();
}

/** 목록 아래의 "전체 20건 · 1/1 페이지" 에서 쪽 수를 읽는다. 못 읽으면 1. */
export function tripListPages(doc) {
  const m = clean(doc.querySelector('.bt-pager')).match(/(\d+)\s*\/\s*(\d+)\s*페이지/);
  return m ? +m[2] : 1;
}

/**
 * 계산서가 지금 어느 단계인가. 사전정산(작성 → 완료) 다음에 사후정산(대기 → 작성 → 완료)이다.
 * @returns {{phase:'pre'|'post', done:boolean, label:string}}
 */
export function tripStage(row, name) {
  const me = row.travelers.find((t) => t.name === name) || row.travelers[0];
  const post = me?.post || '';
  if (post === '작성' || post === '완료') return { phase: 'post', done: post === '완료', label: `사후정산 ${post}` };
  return { phase: 'pre', done: row.pre === '완료', label: `사전정산 ${row.pre || '작성'}` };
}

/**
 * 신청 내역의 출장 줄에 붙는 정산 상태 딱지의 말(2026-10-04 사용자 지정):
 *   정산전(여비계산서 없음) → 사전정산 중 → 사전정산 완료 → 사후정산전 → 사후정산 중 → 정산완료
 * "사전정산 완료"와 "사후정산전"은 계산서로는 같은 단계(사전정산 완료 · 사후정산 대기)다 — 다녀오기 전이면 앞의 것, 다녀온 뒤면 뒤의 것이다.
 * @param {{phase:'pre'|'post', done:boolean}|null} stage tripStage 의 결과. 계산서가 없으면 null
 * @param {{past?: boolean}} [when] past 는 이미 다녀온 출장인가
 */
export function settleLabel(stage, { past = false } = {}) {
  if (!stage) return '정산전';
  if (stage.phase === 'post') return stage.done ? '정산완료' : '사후정산 중';
  if (!stage.done) return '사전정산 중';
  return past ? '사후정산전' : '사전정산 완료';
}

/**
 * 신청 내역의 여비계산서 아이콘(문서 안의 숫자). 숫자는 1(사전정산)·2(사후정산), 색(state)은 회색 = 미작성·대기(none),
 * 녹색 = 작성 중(doing), 파랑 = 완료(done) — 2026-10-03 사용자 지정. 계산서가 없으면(row 가 null) 1 · 회색이다.
 * @param {object|null} row tripDocFor 의 결과
 * @param {{phase:'pre'|'post', done:boolean, label:string}|null} stage tripStage 의 결과
 * @returns {{digit: 1|2, state: 'none'|'doing'|'done', label: string}}
 */
export function tripIconState(row, stage) {
  if (!row || !stage) return { digit: 1, state: 'none', label: '사전정산 미작성' };
  return { digit: stage.phase === 'post' ? 2 : 1, state: stage.done ? 'done' : 'doing', label: `${stage.label}${stage.done ? '' : ' 중'}` };
}

/** 계산서 화면의 단계 줄에서 "사전정산 작성" — 아직 확정하지 않은 단계다. */
export const STEP_PRE_WRITING = '사전정산 작성';
/** 계산서 화면의 단계 줄에서 "사후정산 작성" — 사후정산을 저장했고 아직 확정하지 않은 단계다. */
export const STEP_POST_WRITING = '사후정산 작성';

/**
 * 계산서 화면(CalPrint)에서 지금 단계와 "확정" 폼을 읽는다(2026-10-03 실제 화면).
 *
 * 화면 위의 단계 줄(.bt-steps: 사전정산 작성 → 사전정산 완료 → 사후정산 작성 → 사후정산 완료)에서 켜진 것(active)이 지금 단계다.
 * "사전정산 작성"일 때 화면에 **확정** 버튼이 있고, 그 폼(CalPrint/Confirm 으로 가는 seq·trseq·요청 확인 토큰)을 제출하면
 * "사전정산 완료"가 된다. 출장자가 여럿이면 화면은 고른 출장자(#drtraveler)의 계산서다.
 *
 * @param {Document} doc
 * 화면에는 늘 **삭제** 폼(CalPrint/Delete 로 가는 seq·요청 확인 토큰)도 선다 — 계산서 전체를 지운다(출장 취소 때 쓴다).
 *
 * @returns {{step: string, travelers: {trseq:string, name:string, selected:boolean}[], confirm: [string,string][]|null, del: [string,string][]|null}|null}
 *   confirm 은 확정 폼이 그대로 제출될 때 나갈 칸(없으면 null), del 은 삭제 폼의 칸이다. 계산서 화면이 아니면 null 이다
 */
export function parseCalPage(doc) {
  const steps = doc.querySelector('.bt-steps');
  if (!steps) return null;
  const travelers = [...doc.querySelectorAll('#drtraveler option')].map((o) =>
    ({ trseq: o.getAttribute('value') || '', name: clean(o), selected: o.hasAttribute('selected') }));
  const formOf = (re) => [...doc.querySelectorAll('form')].find((f) => re.test(f.getAttribute('action') || ''));
  const fields = (f) => (f ? [...f.querySelectorAll('input[name]')].map((i) => [i.getAttribute('name'), i.getAttribute('value') || '']) : null);
  return {
    step: clean(steps.querySelector('.bt-step.active .lbl')),
    travelers,
    confirm: fields(formOf(/\/CalPrint\/Confirm$/i)),
    del: fields(formOf(/\/CalPrint\/Delete$/i)),
  };
}

/**
 * 그 출장(시작일~종료일)의 여비계산서. 출장자 이름을 알면 그 사람 것만 본다. 여럿이면 번호가 가장 큰(나중에 만든) 것이다.
 */
export function tripDocFor({ from, to }, rows, name = '') {
  const hits = (rows || []).filter((r) => r.from === from && r.to === (to || from)
    && (!name || r.travelers.some((t) => t.name === name)));
  return hits.sort((a, b) => +b.seq - +a.seq)[0] || null;
}

/* ------------------------------------------------------------ 신청서 폼 */

/**
 * 작성 화면의 폼(#frm)이 그대로 제출될 때 나갈 칸을 차례대로 읽는다 — 숨은 칸·요청 확인 토큰까지.
 * 폼이 없으면 null.
 * @param {Document} doc
 * @returns {[string, string][]|null}
 */
export function formFields(doc) {
  const form = doc.querySelector('form#frm');
  if (!form) return null;
  const out = [];
  for (const el of form.querySelectorAll('input[name], select[name], textarea[name]')) {
    if (el.disabled) continue;
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'INPUT' && ['button', 'submit', 'reset', 'image', 'file'].includes(type)) continue;
    if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio') && !el.checked) continue;
    out.push([el.getAttribute('name'), fieldValue(el)]);
  }
  return out;
}

/** 칸 하나가 제출될 때 나갈 값 — 화면 소스에 적힌 그대로(고른 선택지, 없으면 첫 선택지). */
function fieldValue(el) {
  if (el.tagName === 'SELECT') {
    const opt = el.querySelector('option[selected]') || el.querySelector('option');
    return opt ? opt.getAttribute('value') ?? opt.textContent : '';
  }
  return el.tagName === 'TEXTAREA' ? el.textContent || '' : el.getAttribute('value') || '';
}

const TOKEN = '__RequestVerificationToken';

/**
 * 빈 작성 화면에서 읽은 칸에 초안을 얹어 저장 요청의 본문을 짓는다.
 * 빈 새 문서의 폼이 아니면(번호가 있거나, 줄이 이미 있거나, 토큰이 없으면) 던진다 — 남의 문서를 덮어쓰면 안 된다.
 * @param {[string,string][]} fields formFields 의 결과
 * @param {object} plan settlePlan 의 결과(교통편 줄의 trseq·revno 는 trip.js 가 채워 넣는다)
 * @param {string} emplNo 출장자 사번
 * @returns {string} application/x-www-form-urlencoded
 */
export function saveBody(fields, plan, emplNo) {
  const get = (name) => fields.find(([n]) => n === name)?.[1];
  if (!fields.some(([n]) => n === 'seq') || get('seq')) throw new Error('새 여비계산서 화면이 아닙니다(계산서번호가 이미 있습니다).');
  if (!get(TOKEN)) throw new Error('여비계산서 화면에서 요청 확인 토큰을 찾지 못했습니다.');
  if (fields.some(([n]) => n === 'stay_seq' || n === 'tr_seq')) throw new Error('새 여비계산서 화면에 이미 줄이 들어 있습니다.');
  if (!/^\d+$/.test(String(emplNo || ''))) throw new Error('출장자 사번을 알 수 없습니다.');
  if (!plan.location) throw new Error('출장지가 비어 있습니다.');

  const set = new Map([
    ['travelerSabuns', String(emplNo)], ['period', plan.period],
    ['sDate', plan.sDate], ['sHour', String(plan.sHour)], ['eDate', plan.eDate], ['eHour', String(plan.eHour)],
    ['location', plan.location], ['purpose', plan.purpose], ['nationCD', plan.nation], ['etc_cate', plan.method],
    ...(plan.area ? [['locArea', plan.area]] : []),
  ]);
  for (const name of set.keys()) if (!fields.some(([n]) => n === name)) throw new Error(`여비계산서 화면에 ${name} 칸이 없습니다(화면이 바뀌었습니다).`);

  const rows = [];
  if (plan.stay) {
    rows.push(['stay_seq', ''], ['stay_del', '0'], ['stay_conname', ''], ['stay_region', plan.stay.region],
      ['stay_day', String(plan.stay.day)], ['stay_daily', String(plan.stay.daily)], ['stay_long', '0'],
      ['stay_meal', String(plan.stay.meal)], ['stay_dailyamt', '0'], ['stay_mealamt', '0']);
  }
  for (const t of plan.trans) rows.push(...transLine(t));

  const body = new URLSearchParams();
  for (const [name, value] of fields) {
    if (name === TOKEN) for (const [n, v] of rows) body.append(n, v);   // 줄은 토큰 앞에 둔다(화면의 차례와 같다)
    body.append(name, set.has(name) ? set.get(name) : value);
  }
  return body.toString();
}

/**
 * 교통편 한 줄의 칸 — 작성 화면이 줄을 더할 때(transRowHtml)의 차례 그대로다. 출발·도착 시(tr_shr·tr_ehr)는 화면에서 0~23 을 고르는
 * 칸이고(2026-10-03 실제 화면), 모르는 쪽은 화면의 첫 선택지인 0 이다. 분(tr_smn·tr_emn)은 화면에 숨은 칸이라 0 으로 둔다.
 */
function transLine(t) {
  return [['tr_seq', ''], ['tr_del', '0'], ['tr_trseq', String(t.trseq || '')], ['tr_revno', String(t.revno || '')],
    ['tr_smn', '0'], ['tr_emn', '0'], ['tr_date', t.date], ['tr_dep', t.dep], ['tr_shr', String(t.shr ?? 0)], ['tr_arr', t.arr], ['tr_ehr', String(t.ehr ?? 0)],
    ['tr_transport', t.transport], ['tr_grade', t.grade], ['tr_total', String(t.total)], ['tr_currency', t.currency]];
}

/**
 * 이미 있는 여비계산서의 사전정산 입력 화면(고치기)에서 읽은 칸으로 **다시 저장할** 본문을 짓는다 — 교통편 줄(prePlan 의
 * drop·add, 일자·시각만 고친 줄은 set — 그 줄의 tr_date·tr_shr·tr_ehr 값만 바꾼다)과 식수(stayPlan 의 set)만 바꾼다. 지울 줄은 화면의 × 가 하듯 그 줄의 tr_del 을 1 로 바꾸고(2026-10-05 실제 화면의 delRow:
 * 번호가 있는 줄은 지움 표시만 한다), 새 줄은 토큰 앞에 넣는다. 식수는 그 일비·식비 줄의 stay_meal 값만 바꾼다(화면의 칸에 고쳐 적은 것과 같다).
 * 나머지 칸은 화면에 있던 그대로다 — 바꿀 것이 없으면 화면의 `저장`만 누른 것과 같다.
 * 그 계산서의 화면이 아니거나(번호가 다르다) 토큰이 없거나 지울 줄·고칠 줄이 화면에 없으면 던진다 — 다른 문서나 다른 줄을 건드리면 안 된다.
 * @param {[string,string][]} fields formFields 의 결과
 * @param {string} seq 계산서 번호
 * @param {{drop?: string[], add?: object[], meals?: Object<string,number>|null, set?: Object<string,object>|null}} change 지울 줄의 번호와
 *   새로 넣을 줄(trseq·revno 는 trip.js 가 채워 넣는다), meals 는 식수를 고칠 일비·식비 줄({줄 번호(stay_seq): 식수}),
 *   set 은 칸만 고칠 교통편 줄({줄 번호(tr_seq): {date?, shr?, ehr?}})
 * @returns {string} application/x-www-form-urlencoded
 */
export function preEditBody(fields, seq, { drop = [], add = [], meals = null, set = null } = {}) {
  const get = (name) => fields.find(([n]) => n === name)?.[1];
  if (!seq || get('seq') !== String(seq)) throw new Error('이 여비계산서의 사전정산 입력 화면이 아닙니다.');
  if (!get(TOKEN)) throw new Error('여비계산서 화면에서 요청 확인 토큰을 찾지 못했습니다.');
  const gone = new Set(drop.map(String));
  const eat = new Map(Object.entries(meals || {}));
  // 칸만 고칠 교통편 줄(prePlan 의 set) — 일자·출발 시·도착 시. 줄을 지나며 고친 칸을 지워 가고, 남은 것이 있으면 화면에 없던 줄·칸이다.
  const SET_OF = { tr_date: 'date', tr_shr: 'shr', tr_ehr: 'ehr' };
  const fix = new Map(Object.entries(set || {}).map(([k, v]) => [k, { ...v }]));
  const body = new URLSearchParams();
  let cur = '';   // 지금 지나는 교통편 줄의 번호 — 줄마다 tr_seq 바로 뒤가 tr_del 이다
  let stay = '';  // 지금 지나는 일비·식비 줄의 번호 — 줄마다 stay_seq 가 맨 앞이고 stay_meal 이 그 뒤다
  for (const [name, value] of fields) {
    if (name === TOKEN) for (const t of add) for (const [n, v] of transLine(t)) body.append(n, v);
    if (name === 'tr_seq') cur = value;
    if (name === 'stay_seq') stay = value;
    const kill = name === 'tr_del' && gone.delete(cur);
    const meal = name === 'stay_meal' && eat.has(stay) ? String(eat.get(stay)) : null;
    if (meal != null) eat.delete(stay);
    const key = SET_OF[name];
    const want = key && cur && fix.get(cur)?.[key] != null ? String(fix.get(cur)[key]) : null;
    if (want != null) {
      delete fix.get(cur)[key];
      if (!Object.keys(fix.get(cur)).length) fix.delete(cur);
    }
    body.append(name, kill ? '1' : meal ?? want ?? value);
  }
  if (gone.size) throw new Error('지울 교통편 줄이 사전정산 화면에 없습니다(그 사이에 바뀌었을 수 있습니다). 신청 내역을 새로 읽어 주세요.');
  if (fix.size) throw new Error('일자·시각을 고칠 교통편 줄이 사전정산 화면에 없습니다(그 사이에 바뀌었을 수 있습니다). 신청 내역을 새로 읽어 주세요.');
  if (eat.size) throw new Error('식수를 고칠 일비·식비 줄이 사전정산 화면에 없습니다(그 사이에 바뀌었을 수 있습니다). 신청 내역을 새로 읽어 주세요.');
  return body.toString();
}

/**
 * 교통비 요금표 화면에서 고를 수 있는 줄을 읽는다. 줄마다 사이트가 `uf_rtnFee('번호','개정번호','출발','도착','수단','등급','요금',…)` 를 달아 둔다.
 * @returns {{trseq:string, revno:string, dep:string, arr:string, transport:string, grade:string, fee:number}[]}
 */
export function parseFeeRows(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/uf_rtnFee\(((?:'[^']*',?\s*){8,10})\)/g)) {
    const a = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    out.push({ trseq: a[0], revno: a[1], dep: a[2], arr: a[3], transport: a[4], grade: a[5], fee: Number(a[6].replace(/,/g, '')) });
  }
  return out;
}

/**
 * 요금표에서 이 교통편 줄과 같은 것(같은 구간·같은 수단·같은 요금)을 고른다. 여럿이면 등급이 같은 것(특실 줄이면 특실,
 * 아니면 일반이라고 적은 것), 그 가운데 나중에 등록한 것이다. 없으면 null — 요금만 적고 요금표와 잇지 않는다.
 */
export function pickFeeRow(rows, t) {
  const hits = (rows || []).filter((r) => r.dep === t.dep && r.arr === t.arr && r.transport === t.transport && r.fee === t.total);
  const want = /특/.test(t.grade || '') ? /특|^F$/i : /일반/;
  const plain = hits.filter((r) => want.test(r.grade));
  return (plain.length ? plain : hits).sort((a, b) => +b.trseq - +a.trseq)[0] || null;
}

export { md as shortDate };
