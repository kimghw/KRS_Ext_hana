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
const PLACE_KEYS = [...new Map([...STATIONS.map((s) => [s, s]), ...Object.entries(KTX_FARES.places || {})])];

/**
 * 적어 둔 곳(출장지·근무지)에서 탈 KTX 역을 찾는다. "부산 본사" → 부산, "경기도 고양시 킨텍스" → 서울. 모르면 빈 글.
 * 글에 역 이름이 여럿 들어 있으면 **먼저 나오는 것**이다 — 주소는 큰 곳부터 적으므로 "서울 영등포구" 는 영등포역이 아니라 서울역이다.
 * 같은 자리에서 시작하면 긴 이름이다("동대구" 를 "대구" 보다, "천안아산" 을 "천안" 보다).
 */
export function stationOf(text) {
  const t = String(text || '');
  let hit = null;
  for (const [key, station] of PLACE_KEYS) {
    const at = t.indexOf(key);
    if (at >= 0 && (!hit || at < hit.at || (at === hit.at && key.length > hit.len))) hit = { at, len: key.length, station };
  }
  return hit ? hit.station : '';
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
 * 출장 폼에서 여비계산서(사전정산) 초안을 짓는다.
 *
 * 당일이면 당일출장(주재국), 1박 이상이면 일반출장이다. 당일출장은 사이트가 일비·식비 내역을 받지 않으므로
 * stay 가 null 이다. 교통편 내역은 **기차(KTX)만** 골랐고 운임표에 그 구간·그 등급의 값이 있을 때만 두 줄(가는 길·오는 길)이
 * 들어간다 — 줄마다 출발·도착 시(shr·ehr)도 적는다(legTimes). 못 넣으면 notes 에 까닭을, why 에 그것을 줄인 말을 적는다. 기차와 비행기를 함께 골랐으면 어느 편이 무엇인지
 * 신청할 때는 알 수 없어 비워 둔다(다녀온 뒤 신청 내역의 출장 카드에서 가는 편·오는 편을 골라 사후정산에 올린다 — legPlan).
 *
 * @param {object} form 근태 패널의 출장 폼(dateFrom·dateTo·days·start·end·place·workplace·transport·trainGrade·purpose)
 * @returns {object} { period, sDate, sHour, eDate, eHour, location, area, purpose, nation, stay, method, transports, grade, trans, notes, why }
 */
export function settlePlan(form) {
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
  if (transports.length === 1 && TRANSPORTS.find((t) => t.value === transports[0]).auto) {
    const dep = stationOf(form.workplace);
    const arr = stationOf(form.place);
    if (!dep) notes.push(`근무지 "${String(form.workplace || '').trim()}" 에서 탈 KTX 역을 찾지 못해 교통편 내역은 비워 둡니다`);
    else if (!arr) notes.push(`출장지 "${String(form.place || '').trim()}" 에서 내릴 KTX 역을 찾지 못해 교통편 내역은 비워 둡니다`);
    else if (dep === arr) notes.push(`근무지와 출장지가 같은 역(${dep})이라 교통편 내역은 비워 둡니다`);
    else {
      trans = [trainRow(form.dateFrom, dep, arr, grade), trainRow(form.dateTo, arr, dep, grade)];
      if (trans.some((r) => !r)) {
        // 구간은 있는데 그 등급(특실)의 값만 모르는 것과, 구간이 아예 없는 것을 가려 말한다.
        const known = !!fareOf(dep, arr, form.dateFrom);
        if (known) why = `${dep}↔${arr} ${gradeLabel(grade)} 운임 모름`;
        notes.push(known
          ? `KTX 운임표(ktx-fares.yaml)에 ${dep}↔${arr} ${gradeLabel(grade)} 운임이 없어 교통편 내역은 비워 둡니다`
          : `KTX 운임표(ktx-fares.yaml)에 ${dep}↔${arr} 구간이 없어 교통편 내역은 비워 둡니다`);
        trans = [];
      }
      // 줄마다 출발·도착 시 — 가는 편은 출발 시각에 떠나고, 오는 편은 도착 시각에 닿는다(구간의 대략 소요 시간만큼).
      trans = trans.map((r, i) => ({ ...r, ...legTimes(LEGS[i].key, r, { sHour, eHour }) }));
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
    location: String(form.place || '').trim(),
    area: dayTrip ? RULES.period.day_trip.area : '',
    purpose: String(form.purpose || '').trim(),
    nation: RULES.nation.code,
    stay: dayTrip ? null : { region: RULES.nation.code, day: days, daily: dailyOf(days), meal: mealsOf({ days, startHour: sHour, endHour: eHour }) },
    method: RULES.transport.method.code,
    transports, grade,
    trans, notes, why,
  };
}

/** KTX 한 구간의 교통편 줄. 운임표에 그 구간·그 등급의 값이 없으면 null. */
function trainRow(date, dep, arr, grade) {
  const f = fareOf(dep, arr, date, grade);
  return f && { date, dep, arr, transport: SITE_OF[GRADED], grade: gradeLabel(grade), total: f.fare, currency: RULES.transport.train.currency, trseq: '', revno: '' };
}

/** 초안을 한 줄로. 누르기 전에 "올릴 내용"에 적어 보여준다. */
export function describePlan(plan) {
  const parts = [plan.periodLabel, plan.location];
  if (plan.stay) parts.push(`일비 ${plan.stay.daily}일 · 식비 ${plan.stay.meal}식`);
  if (plan.trans.length) {
    const [go, back] = plan.trans;
    const fares = go.total === back.total ? `${won(go.total)}원 × 2` : `${won(go.total)}원 + ${won(back.total)}원`;
    parts.push(`KTX ${go.dep}↔${go.arr} ${go.grade} ${fares}`);
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

/** 사이트 줄 하나를 패널의 선택({t: 교통편, g: 기차 등급})으로. 패널이 모르는 수단(지하철·선박)은 t 가 빈 글이다. 줄이 없으면 null. */
export const pickOfRow = (row) => (row ? { t: VALUE_OF[row.transport] || '', g: /특|^F$/i.test(row.grade || '') ? 'first' : DEFAULT_GRADE } : null);

/**
 * 사이트의 교통편 줄을 가는 편·오는 편에 앉힌다. 첫 줄이 가는 편, 둘째 줄이 오는 편이다(사이트가 줄을 더하는 차례).
 * 줄이 하나뿐이면 그 날짜가 출발일과 다른 도착일일 때만 오는 편이다. 셋째 줄부터는 extra 에 줄 수만 남긴다.
 */
export function legsOfRows(rows, trip) {
  const list = rows || [];
  if (list.length === 1 && trip?.to && trip.to !== trip.from && list[0].date === trip.to) return { go: null, back: list[0], extra: 0 };
  return { go: list[0] || null, back: list[1] || null, extra: Math.max(0, list.length - 2) };
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
  const dest = stationOf(site.go?.arr) || stationOf(site.back?.dep) || stationOf(trip.location);
  const notes = [];
  if (site.extra) notes.push(`사전정산에 교통편 줄이 ${site.extra + 2}개입니다 — 가는 편·오는 편은 처음 두 줄로 봅니다`);
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
      if (cur && cur.transport === code) return { ...leg, row: { ...cur, grade: gradeLabel(pick.g) }, source: 'grade' };
      // 비행기는 항공권이 요금을 말해 준다. 버스는 읽을 표가 없다 — 사후정산 화면에서 직접 넣는다.
      const how = pick.t === 'plane' ? '항공권을 넣어 주세요' : '사후정산 화면에서 직접 넣어 주세요';
      return { ...leg, row: null, source: '', problem: `${labelOf(pick.t)} 요금을 모릅니다 — ${how}` };
    }
    const [a, b] = key === 'go' ? [home, dest] : [dest, home];
    const row = a && b && a !== b ? trainRow(date, a, b, pick.g) : null;
    if (row) return { ...leg, row, source: 'fare' };
    const problem = !home ? `근무지 "${String(workplace || '').trim()}" 에서 탈 KTX 역을 찾지 못했습니다`
      : !dest ? `출장지 "${String(trip.location || '').trim()}" 에서 내릴 KTX 역을 찾지 못했습니다`
        : a === b ? `근무지와 출장지가 같은 역(${a})입니다`
          : `KTX 운임표에 ${a}↔${b} ${fareOf(a, b, date) ? `${gradeLabel(pick.g)} 운임` : '구간'}이 없습니다`;
    return { ...leg, row: null, source: '', problem };
  });
  const out = legs.map((l) => l.row).filter(Boolean);
  return { legs, problems: legs.filter((l) => l.problem).map((l) => `${l.label}: ${l.problem}`), notes, changed: !sameTrans(out, rows.slice(0, 2)) };
}

/** 교통편 줄 하나를 한 마디로 — "KTX 부산→서울 일반석 54,400원". 카드와 확인 문구에 쓴다. */
export function describeTrans(row) {
  const name = row.transport === SITE_OF[GRADED] ? 'KTX' : labelOf(VALUE_OF[row.transport]) || row.transport;
  return `${name} ${row.dep}→${row.arr}${row.grade ? ` ${row.grade}` : ''} ${won(row.total)}${row.currency && row.currency !== 'KRW' ? ` ${row.currency}` : '원'}`;
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
 * @returns {{step: string, travelers: {trseq:string, name:string, selected:boolean}[], confirm: [string,string][]|null}|null}
 *   confirm 은 확정 폼이 그대로 제출될 때 나갈 칸(없으면 null). 계산서 화면이 아니면 null 이다
 */
export function parseCalPage(doc) {
  const steps = doc.querySelector('.bt-steps');
  if (!steps) return null;
  const travelers = [...doc.querySelectorAll('#drtraveler option')].map((o) =>
    ({ trseq: o.getAttribute('value') || '', name: clean(o), selected: o.hasAttribute('selected') }));
  const form = [...doc.querySelectorAll('form')].find((f) => /\/CalPrint\/Confirm$/i.test(f.getAttribute('action') || ''));
  return {
    step: clean(steps.querySelector('.bt-step.active .lbl')),
    travelers,
    confirm: form ? [...form.querySelectorAll('input[name]')].map((i) => [i.getAttribute('name'), i.getAttribute('value') || '']) : null,
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
