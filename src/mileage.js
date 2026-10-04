// 항공 마일리지 — 여비계산서 사후정산 "항공 마일리지"의 **신규 마일리지**를 항공 마일리지 표에서 찾는다(2026-10-04 사용자 지정).
//
// 표는 air-mileage.yaml 에 있다(옮긴 것이 travelspec.js 의 AIR_MILEAGE): 항공사마다 국내선 구간 마일(일반석 편도, 적립률 100%)과
// 좌석 등급별 적립률(일반석 · 특실/비즈니스). 항공권 문서에 적립 마일리지가 적혀 있으면 그 값이 먼저이고, 여기는 적혀 있지 않을 때만 쓴다.
// **표에 없는 항공사·구간은 null 이다 — 짐작으로 채우지 않는다.** 이 파일은 DOM·네트워크 없이 돈다.

import { AIR_MILEAGE, TRAVEL_RULES } from './travelspec.js';

/** 특실·비즈니스를 부르는 이름 — 여비계산서 "등급" 칸에 적는 글과 같다(특실). */
const FIRST_LABEL = TRAVEL_RULES.transport.train.grade_labels.first;
const lower = (v) => String(v ?? '').toLowerCase();

/** 항공권에 적힌 항공사 이름으로 표의 항공사를 찾는다("대한항공(KE)" · "Korean Air" → 대한항공). 표에 없으면 null. */
export function airlineOf(name) {
  const t = lower(name);
  if (!t.trim()) return null;
  return AIR_MILEAGE.airlines.find((line) => [line.name, ...(line.aliases || [])].some((key) => t.includes(lower(key)))) || null;
}

/** 글에서 가장 먼저 나오는 열쇠의 공항. 같은 자리에서 시작하면 긴 열쇠다. */
function firstHit(t, pairs) {
  let hit = null;
  for (const [key, airport] of pairs) {
    const at = t.indexOf(lower(key));
    if (at >= 0 && (!hit || at < hit.at || (at === hit.at && key.length > hit.len))) hit = { at, len: key.length, airport };
  }
  return hit ? hit.airport : '';
}

const PORTS = Object.entries(AIR_MILEAGE.airports);
/** 공항 이름과 코드 — 이것이 먼저다. */
const PORT_KEYS = PORTS.flatMap(([name, p]) => [[name, name], [p.code, name]]);
/** 도시 이름 — 공항 이름·코드가 없을 때만 본다("서울(인천)" 은 김포가 아니라 인천이다). */
const CITY_KEYS = PORTS.flatMap(([name, p]) => (p.also || []).map((key) => [key, name]));

/** 항공권에 적힌 출발지·도착지 글에서 공항을 찾는다 — "부산(김해)" · "PUS" · "부산" → 김해. 모르면 빈 글. */
export function airportOf(text) {
  const t = lower(text);
  return firstHit(t, PORT_KEYS) || firstHit(t, CITY_KEYS);
}

/** 항공권의 좌석 등급 글이 특실·비즈니스(프레스티지석)인가 — 표의 first_seats 에 있는 말이 들어 있으면 그렇다. */
export function isFirstSeat(seatClass) {
  const t = lower(seatClass);
  return AIR_MILEAGE.first_seats.some((word) => t.includes(lower(word)));
}

/**
 * 한 편의 적립 마일리지를 표에서 찾는다 — 구간 마일 × 좌석 등급의 적립률(마일 미만은 반올림). 구간은 방향이 없다.
 * @param {{airline?: string, dep?: string, arr?: string, first?: boolean}} leg first 는 특실·비즈니스인가
 * @returns {{miles: number, base: number, rate: number, airline: string, a: string, b: string, grade: 'standard'|'first'}|null}
 *   base 는 구간 마일(100%), rate 는 적립률(%), a·b 는 찾은 공항이다. 표에 없는 항공사·구간이면 null
 */
export function milesOf({ airline, dep, arr, first = false } = {}) {
  const line = airlineOf(airline);
  const a = airportOf(dep);
  const b = airportOf(arr);
  if (!line || !a || !b || a === b) return null;
  const route = line.routes.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
  if (!route) return null;
  const grade = first ? 'first' : 'standard';
  const rate = line.rates[grade];
  return { miles: Math.round((route.miles * rate) / 100), base: route.miles, rate, airline: line.name, a, b, grade };
}

/** 찾은 마일리지를 한 마디로 — "대한항공 김해→김포 215마일" · "대한항공 김해→김포 특실 269마일(215 × 125%)". 알림에 쓴다. */
export function describeMiles(m) {
  const how = m.rate === 100 ? '' : `(${m.base} × ${m.rate}%)`;
  return `${m.airline} ${m.a}→${m.b}${m.grade === 'first' ? ` ${FIRST_LABEL}` : ''} ${m.miles.toLocaleString('ko-KR')}마일${how}`;
}
