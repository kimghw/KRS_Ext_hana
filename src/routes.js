// 출장지마다 지난번에 쓴 교통편을 기억해 두었다가 다음에 먼저 쓴다(2026-10-04 사용자 지정: "한번 설정한 교통편은 다음에도 우선하여 재사용").
// 화면도 저장소도 모른다 — 무엇을 기억하고 무엇을 되살릴지만 셈한다. 담아 두는 것은 패널(attendpanel.js)이 chrome.storage.local 의 ROUTES_KEY 에 한다.
//
// 기억하는 것(출장지에 적은 글이 열쇠):
//   transport · trainGrade  신청 폼의 교통편 아이콘(기차·비행기·버스, 기차의 좌석 등급)
//   path                    KTX 로 간 길 — 역의 차례([부산, 서울], 갈아탔으면 [부산, 오송, 목포]). KTX 로 가지 않았으면 null
//   date                    그 출장의 출발일. 더 나중의 출장이 앞의 것을 덮어쓴다
//
// 기억은 두 곳에서 온다. 패널이 사전정산을 만들었을 때(routeOfPlan — 폼에서 고른 그대로), 그리고 사전정산 화면의 교통편 줄을 읽었을 때
// (routeOfRows — 사이트에서 손으로 고친 것까지 따라간다). 다음에 같은 출장지를 적으면 아이콘이 그때대로 골라지고(withRoute),
// 사전정산의 KTX 줄은 그 길로 짓는다(src/travel.js 의 settlePlan 이 path 를 받는다) — 요금은 그때의 값이 아니라 지금 운임표의 정가다.

import { TRANSPORTS, DEFAULT_TRANSPORT, DEFAULT_GRADE, TRAIN_GRADES, stationOf, legsOfRows, legParts, pickOfRow, pathKnown } from './travel.js';

/** chrome.storage.local 에 담는 이름. 값은 { 출장지: { transport, trainGrade, path, date } } 다. */
export const ROUTES_KEY = 'tripRoutes';
/** 기억해 두는 출장지 수. 넘치면 오래된 출장부터 버린다. */
export const ROUTES_MAX = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN = TRANSPORTS.map((t) => t.value);
const TRAIN = 'train';

/**
 * 출장지에 적은 글을 열쇠로 — 앞뒤와 겹친 빈칸만 고른다("경기도  고양시 킨텍스 " = "경기도 고양시 킨텍스").
 * 여비계산서에서 읽은 출장지는 "출장지(장소)"라(src/travel.js 의 tripLocation) 끝의 괄호(장소)는 뗀다 — "대전(한국기계연구원)" = "대전".
 */
export const routeKey = (place) => String(place || '').replace(/(\S)\s*\([^()]*\)\s*$/, '$1').replace(/\s+/g, ' ').trim();

/** 교통편 목록을 선택지 차례로, 아는 것만. */
const transportsIn = (list) => KNOWN.filter((v) => (Array.isArray(list) ? list : []).includes(v));
const gradeIn = (g) => (TRAIN_GRADES.some((x) => x.value === g) ? g : DEFAULT_GRADE);

/** 기억 하나의 모양을 고른다. 쓸 수 없는 것(교통편이 없다, 날짜가 틀렸다)이면 null. */
function clean(entry) {
  const transport = transportsIn(entry?.transport);
  if (!transport.length || !DATE_RE.test(entry?.date || '')) return null;
  const path = Array.isArray(entry.path) && entry.path.length >= 2 && entry.path.every((s) => typeof s === 'string' && s) ? [...entry.path] : null;
  return { transport, trainGrade: gradeIn(entry.trainGrade), path, date: entry.date };
}

/**
 * 패널이 사전정산을 만들었을 때 기억할 것 — 폼에서 고른 교통편과, KTX 줄이 들어갔으면 가는 편이 지난 역의 차례다.
 * @param {object} plan src/travel.js settlePlan 의 결과
 */
export function routeOfPlan(plan) {
  const go = plan?.trans?.length ? legsOfRows(plan.trans, { from: plan.sDate, to: plan.sDate }).go : null;
  return clean({ transport: plan?.transports, trainGrade: plan?.grade, path: go ? [go.dep, ...legParts(go).map((p) => p.arr)] : null, date: plan?.sDate });
}

/**
 * 사전정산 화면의 교통편 줄에서 기억할 것 — 사이트에서 손으로 고친 것까지 따라간다. 줄이 없으면 null(무엇을 골랐는지 알 수 없다).
 *
 * 교통편은 가는 편·오는 편의 것을 모은 것이고(기차 편이 하나라도 특실이면 특실), 길은 가는 편이 KTX 일 때 그 편이 지난 역의 차례다
 * (가는 편이 KTX 가 아니고 오는 편이 KTX 면 그것을 뒤집는다). 줄에 적힌 곳에서 역을 못 찾거나 운임표로 이어지지 않는 길이면 길은 기억하지 않는다.
 * @param {object[]} rows src/travel.js parseTransRows 의 줄
 * @param {{from: string, to?: string}} trip 그 출장의 기간
 */
export function routeOfRows(rows, trip) {
  const { go, back } = legsOfRows(rows, trip);
  const picks = [go, back].map(pickOfRow).filter((p) => p?.t);
  if (!picks.length) return null;
  const stops = (leg) => [leg.dep, ...legParts(leg).map((p) => p.arr)].map((s) => stationOf(s));
  const byTrain = (leg) => !!leg && pickOfRow(leg).t === TRAIN;
  const raw = byTrain(go) ? stops(go) : byTrain(back) ? stops(back).reverse() : null;
  return clean({
    transport: picks.map((p) => p.t),
    trainGrade: picks.some((p) => p.t === TRAIN && p.g === 'first') ? 'first' : DEFAULT_GRADE,
    path: raw && raw.every(Boolean) && pathKnown(raw) ? raw : null,
    date: trip?.from,
  });
}

/**
 * 기억을 담는다. 같은 출장지에 더 나중의 출장이 이미 적혀 있으면 그대로 둔다(예전 출장 카드를 펴도 요즘 것을 덮어쓰지 않는다).
 * ROUTES_MAX 를 넘으면 오래된 출장부터 버린다. 바뀐 것이 없으면 받은 것을 그대로 돌려준다(저장할지 가릴 수 있다).
 * @returns {object} 새 기억 묶음
 */
export function keepRoute(store, place, entry) {
  const key = routeKey(place);
  const next = clean(entry);
  const all = store && typeof store === 'object' ? store : {};
  if (!key || !next) return all;
  const old = clean(all[key]);
  if (old && (old.date > next.date || JSON.stringify(old) === JSON.stringify(next))) return all;
  const kept = Object.entries({ ...all, [key]: next }).sort(([, a], [, b]) => String(b?.date || '').localeCompare(String(a?.date || ''))).slice(0, ROUTES_MAX);
  return Object.fromEntries(kept);
}

/** 그 출장지에 기억해 둔 교통편. 없으면 null. */
export const recallRoute = (store, place) => clean(store?.[routeKey(place)]);

/**
 * 출장지를 적었을 때의 교통편 아이콘 — 기억해 둔 것이 있으면 그것, 없으면 기본(기차 일반석)이다.
 * 이 신청서에서 아이콘을 손대지 않았을 때만 쓴다(패널이 가린다).
 * @returns {{transport: string[], trainGrade: string}}
 */
export const withRoute = (memo) => (memo ? { transport: [...memo.transport], trainGrade: memo.trainGrade } : { transport: [DEFAULT_TRANSPORT], trainGrade: DEFAULT_GRADE });
