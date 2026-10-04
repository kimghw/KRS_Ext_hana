// 여비계산서 **사후정산**(eclass /BusinessTrip/AfterTrip) — 사용자가 숙박 증빙·항공권을 넣으면 자동으로 짓고 올린다(2026-10-03 사용자 지정).
//
//   증빙 파일(이미지·PDF) → Claude 가 한 장씩 읽어 기록(input.yaml 의 receipt) → 여기서 숙박비·교통비·항공 마일리지로 묶는다
//   → src/trip.js 의 tripAfterSave 가 사후정산 입력 화면의 폼(AfterTrip/Save, multipart)으로 올린다.
//
// 사후정산을 하는 조건(사용자 지정): **비행기를 탔거나 1박 이상**이다. 당일 출장이면 숙박비 내역은 넣지 않는다.
//
// 교통비 내역은 출장 카드의 **가는 편·오는 편**에서 나온다(2026-10-03 사용자 지정, 셈은 src/travel.js 의 legPlan).
// 처음에는 사전정산대로 골라져 있고, 카드에서 손으로 바꾸거나 항공권을 넣으면 그 날짜의 편이 비행기로 바뀐다 —
// 두 편이 같은 날이면 시각으로 가린다. 항공권이 한 편뿐이면 나머지 편은 KTX 다. 항공권을 넣었거나 편을 바꿨을 때만
// 두 편을 교통비 내역으로 넣고, 사전정산 그대로면 넣지 않는다(사전정산의 값이 선다).
// **기차표는 증빙으로 받지 않는다 — KTX 는 운임표의 정가로 넣는다.** 당일 출장의 증빙은 **그 출장지에서 결제한 영수증**이다.
//
// 읽지 못한 **필수** 값이 있으면 올리지 않고 무엇이 비었는지 말한다 — 틀린 값으로 올리느니 비워 두고 사람이 채우게 한다.
// 영수증에 적힌 그 밖의 정보(조식 포함·예약번호 …)는 notes 로 알린다.
//
// 이 파일은 DOM·네트워크 없이 돈다. 사이트 화면의 칸 이름(lodge_*, tr_*, air_*)은 2026-10-03 실제 사후정산 입력 화면 소스에서 확인했다.

import { legsOfRows, ticketsOf, seatTickets, picksWithTickets, legPlan, legTimes } from './travel.js';
import { milesOf, isFirstSeat, describeMiles } from './mileage.js';

/** 사후정산 입력 화면의 교통수단 선택지 값(2026-10-03 화면). 사전정산 화면과 달리 한국어 이름이 그대로 값이다. */
export const AFTER_TRANSPORT = { plane: '비행기', train: '기차(KTX등)', subway: '지하철', ship: '선박', bus: '버스', etc: '기타(택시등)' };
/** 사전정산 화면의 교통수단 값 — 비행기를 탔는지 여기서 본다. */
export const PRE_PLANE = 'Airplane';
/** 국내 숙박의 출장지(주재국) 코드와 화폐 기본값. */
export const DOMESTIC = { nation: 'KR||', currency: 'KRW' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 두 날짜 사이의 밤 수. 모르면 0. */
export function nightsBetween(from, to) {
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) return 0;
  const d = (s) => { const [y, m, dd] = s.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
  return Math.max(0, Math.round((d(to) - d(from)) / 86_400_000));
}

/**
 * 이 출장에 사후정산이 필요한가, 무엇을 넣는가.
 * @param {{from:string, to:string}} trip 여비계산서 목록의 한 줄(출장기간)
 * @param {{transports?: string[]}} detail 사전정산 화면에서 읽은 교통편(tripPreDetail)
 * @param {{go?:{t:string}, back?:{t:string}}} [picks] 출장 카드에서 고른 가는 편·오는 편(사전정산과 다르게 고른 것)
 * @returns {{nights:number, plane:boolean, lodging:boolean, transport:boolean, needed:boolean, why:string, hint:string}}
 */
export function afterNeed(trip, detail = {}, picks = {}) {
  const nights = nightsBetween(trip?.from, trip?.to);
  const plane = (detail.transports || []).includes(PRE_PLANE) || [picks?.go, picks?.back].some((x) => x?.t === 'plane');
  const lodging = nights >= 1;
  const why = [lodging ? `${nights}박` : '당일', plane ? '비행기' : ''].filter(Boolean).join(' · ');
  // 항공권은 늘 받는다 — 넣으면 그 편이 비행기로 바뀐다.
  const hint = [lodging ? '숙박 영수증·예약서' : '', '항공권'].filter(Boolean).join('·');
  return { nights, plane, lodging, transport: plane, needed: lodging || plane, why, hint };
}

const LODGING = new Set(['lodging_receipt', 'lodging_booking']);
const FLIGHT = new Set(['flight_ticket', 'flight_receipt']);
const GROUND = new Set(['train_ticket', 'bus_ticket']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
/** 업체 이름을 묶음 열쇠로 — 띄어쓰기·괄호 안·호텔/모텔 같은 꼬리를 떼고 비교한다. */
export const vendorKey = (v) => text(v).toLowerCase().replace(/\(.*?\)/g, '').replace(/[\s·.,-]/g, '').replace(/(호텔|hotel|모텔|리조트|resort)$/i, '');
const hourOf = (t) => (/^\d{2}:\d{2}$/.test(t || '') ? String(+t.slice(0, 2)) : '');
const fileName = (r) => r.file?.name || r.summary || '문서';

const shortDay = (s) => (DATE_RE.test(s || '') ? `${+s.slice(5, 7)}/${+s.slice(8)}` : '?');

/* ------------------------------------------------------------ 숙박 줄 */

/** 숙박 줄의 정산금액은 원화로만 적는다(2026-10-03 사용자 지정). */
export const LODGE_CURRENCY = 'KRW';

/**
 * 숙박 증빙 묶음(같은 숙박의 영수증·예약서)에서 숙박 줄에 넣을 값을 정한다. 출장 카드(afterPlan)와 사후정산 입력 화면
 * (src/afterpage.js 의 fillPlan)이 같이 쓴다. 2026-10-03 사용자 지정:
 *   - 업체명은 **산 곳(구매처)**이다 — 아고다에서 샀으면 아고다이고 호텔 이름이 아니다. 묵은 곳은 비고에 적는다.
 *     사업자등록번호는 그 구매처의 것이고, 문서에 사업자명(법인명)이 따로 적혀 있으면 비고에 같이 적는다.
 *   - 정산금액은 원화로만 적는다. 외화 문서면 문서에 같이 적힌 원화 금액을 쓰고, 없으면 비워 두고 사람에게 묻는다(actual = null).
 *
 * @param {object[]} receipts 결제 영수증·인보이스 기록(receipt 명세)
 * @param {object[]} [bookings] 예약 확인서 기록
 * @returns {{paydate: string|null, sday: number|null, stay: string, company: string, companycode: string, cocard: string, comment: string,
 *            doc: {currency: string, total: number|null, supply: number|null, vat: number|null}, actual: number|null}}
 *   stay 는 묵은 곳, doc 은 문서에 적힌 금액(그 화폐 그대로), actual 은 실제로 낸 금액(원)이다
 */
export function lodgeOf(receipts, bookings = []) {
  const pick = (key, order = [...receipts, ...bookings]) => order.map((r) => r[key]).find((v) => v != null && v !== '') ?? null;
  const stayFirst = [...bookings, ...receipts];
  const checkIn = pick('checkIn', stayFirst);
  const checkOut = pick('checkOut', stayFirst);
  const stay = text(pick('vendor'));
  const seller = text(pick('seller'));
  const biz = text(pick('sellerBiz'));
  const company = seller || stay;
  const comment = [seller && vendorKey(seller) !== vendorKey(stay) ? stay : '', biz && vendorKey(biz) !== vendorKey(company) ? biz : ''].filter(Boolean).join(' · ');
  // 금액·화폐·공급가액·부가세는 한 문서의 것이어야 맞는다 — 금액이 적힌 첫 문서(영수증이 먼저)에서 읽는다.
  const paid = [...receipts, ...bookings].find((r) => num(r.total) != null) || {};
  const currency = paid.currency || LODGE_CURRENCY;
  const total = num(paid.total);
  const krw = currency === LODGE_CURRENCY ? total : num(paid.totalKRW);
  return {
    paydate: pick('payDate') || checkOut || checkIn || null,
    sday: num(pick('nights', stayFirst)) || nightsBetween(checkIn, checkOut) || null,
    stay, company, companycode: text(pick('bizNo')), cocard: pick('corporateCard') === true ? '1' : '0', comment,
    doc: { currency, total, supply: num(paid.supply), vat: num(paid.vat) },
    actual: krw == null ? null : Math.round(krw),
  };
}

/** 그 줄의 상한액 — 1일 상한(사이트의 CalMaxLodge 가 원화로 준 값, lodge_maxconv) × 숙박 일수. 상한을 원화로 모르면 null. */
export function lodgeCap(row) {
  const day = Number(row?.maxconv);
  return day > 0 && row.sday > 0 ? { day, total: day * row.sday } : null;
}

/**
 * 숙박 줄에서 사람이 정해 줘야 하는 것. 없으면 빈 글.
 *   'krw' — 외화 문서인데 원화로 결제한 금액이 문서에 없다. 원화 금액을 적어야 한다(환율로 어림하지 않는다).
 *   'cap' — 실제 금액이 상한액을 넘는다. 상한액으로 정산할지 실제 금액으로 정산할지 고른다(2026-10-03 사용자 지정).
 */
export function lodgeAsk(row) {
  if (row.actual == null) return row.doc?.total == null ? '' : 'krw';
  const cap = lodgeCap(row);
  return cap && row.actual > cap.total && !row.settle ? 'cap' : '';
}

/**
 * 정산금액·공급가액·부가세를 정해 그 줄에 적는다(2026-10-03 사용자 지정). 정산금액은 실제 금액(원)이고, 상한액으로 정산하기로
 * 했으면(settle = 'cap') 상한액이다. 공급가액·부가세는 문서에 적혀 있으면 그 값(하나만 있으면 다른 하나는 뺄셈)이고, 적혀 있지
 * 않거나 정산금액이 문서의 금액과 달라졌으면(외화를 원화로 옮겼거나 상한액으로 낮췄으면) 정산금액에서 되셈한다 —
 * 공급가액 = 정산금액 ÷ 1.1(원 단위 반올림), 부가세 = 나머지.
 * @returns {object} 그 줄(같은 객체) — total·samount·vat, capped(상한액으로 낮췄는가), vatFrom('doc' 문서·'calc' 되셈)
 */
export function lodgeSettle(row) {
  const cap = lodgeCap(row);
  row.capped = row.settle === 'cap' && !!cap && row.actual != null && row.actual > cap.total;
  row.total = row.capped ? cap.total : row.actual;
  const { currency, total, supply, vat } = row.doc || {};
  if (row.total == null) return Object.assign(row, { samount: null, vat: null, vatFrom: '' });
  if (currency === LODGE_CURRENCY && row.total === total && (supply != null || vat != null)) {
    return Object.assign(row, { samount: supply ?? Math.max(0, row.total - vat), vat: vat ?? Math.max(0, row.total - supply), vatFrom: 'doc' });
  }
  const samount = Math.round(row.total / 1.1);
  return Object.assign(row, { samount, vat: row.total - samount, vatFrom: 'calc' });
}

/** 사후정산 입력 화면의 숙박 줄 칸(lodge_ 뒤의 이름) — 화면의 addLodge() 가 만드는 것들이다. */
const LODGE_KEYS = new Set(['nation', 'seq', 'del', 'oldfile', 'maxtotal', 'maxcur', 'maxrate', 'maxconv', 'paydate', 'sday', 'company', 'companycode',
  'currency', 'cocard', 'total', 'samount', 'vat', 'comment', 'etcname']);

/**
 * 화면의 칸 목록(src/travel.js formFields 의 결과)에서 지금 있는 숙박 줄을 읽는다 — lodge_nation 이 줄의 시작이다.
 * 값은 화면 그대로의 글이고, 지움 표시(del = '1')가 된 줄도 그대로 준다.
 * @param {[string,string][]} fields
 * @returns {Record<string,string>[]} 줄마다 { seq, del, nation, paydate, sday, company, companycode, currency, cocard, total, samount, vat, comment, … }
 */
export function lodgeRowsOf(fields) {
  const rows = [];
  for (const [name, value] of fields || []) {
    const key = name.startsWith('lodge_') ? name.slice(6) : '';
    if (key === 'nation') rows.push({});
    if (rows.length && LODGE_KEYS.has(key)) rows.at(-1)[key] = value;
  }
  return rows;
}

/**
 * 올리려는 줄이 화면에 이미 있는 줄과 같은 것인가 — 결제일·업체명·숙박 일수·정산금액이 모두 같다.
 * 같은 증빙을 두 번 넣었을 때 같은 줄이 겹쳐 올라가지 않게 한다(2026-10-03 실제 계산서에 같은 숙박이 세 줄 올라가 있었다).
 */
export const lodgeSame = (row, have) => have.del !== '1' && (have.paydate || '') === (row.paydate || '') && text(have.company) === text(row.company)
  && Number(have.sday) === Number(row.sday) && row.total != null && Number(have.total) === Number(row.total);

/**
 * 증빙 한 장이 무엇의 증명이고 그렇게 쓸 수 있는가(2026-10-03 사용자 지정). 카드가 읽은 문서 옆에 적는다.
 *   항공권·항공 영수증 → "항공기 증명"            숙박 영수증·예약서 → "숙박 증빙"
 *   기차표·버스표      → 증빙으로 받지 않는다(KTX 는 운임표의 정가로 넣는다)
 *   그 밖의 영수증     → "당일출장 증명" — **그 출장지에서, 출장 기간 안에 결제한 영수증**이어야 한다(1박 이상이면 "출장지 영수증").
 *                        출장지에서 결제했는지는 영수증을 읽을 때 가린다(input.yaml receipt 의 atDestination).
 * @returns {{label: string, ok: boolean, note: string}} ok 가 거짓이면 note 가 그 까닭이다
 */
export function evidenceOf(record, trip) {
  const type = record?.docType;
  if (FLIGHT.has(type)) return { label: '항공기 증명', ok: true, note: '' };
  if (LODGING.has(type)) return { label: '숙박 증빙', ok: true, note: '' };
  if (GROUND.has(type)) return { label: '기차·버스표', ok: false, note: '증빙으로 받지 않습니다(KTX 는 운임표의 정가로 넣습니다)' };
  if (type !== 'other_receipt') return { label: '모르는 문서', ok: false, note: `무슨 문서인지 읽지 못했습니다${text(record?.summary) ? `(${text(record.summary)})` : ''}` };
  const label = nightsBetween(trip?.from, trip?.to) >= 1 ? '출장지 영수증' : '당일출장 증명';
  const end = trip?.to || trip?.from;
  const note = record.atDestination === false ? `출장지에서 결제한 영수증이 아닙니다${text(record.payPlace) ? `(${text(record.payPlace)})` : ''}`
    : record.atDestination !== true ? '출장지에서 결제한 것인지 영수증에서 확인하지 못했습니다'
      : !record.payDate ? '결제일을 읽지 못했습니다'
        : record.payDate < trip.from || record.payDate > end ? `결제일(${shortDay(record.payDate)})이 출장 기간 밖입니다`
          : '';
  return { label, ok: !note, note };
}

/**
 * 읽은 기록들을 사후정산 한 벌로 묶는다.
 *
 * - 숙박: 같은 숙박업소의 영수증과 예약서를 한 줄로 합친다 — 금액·결제일은 영수증이, 체크인/아웃·박 수는 예약서가 채운다.
 *   필수: 업체명·결제일·숙박 일수·정산금액. 업체명은 산 곳(구매처), 정산금액은 원화이고 공급가액·부가세는 문서에 없으면
 *   정산금액에서 되셈한다(lodgeOf·lodgeSettle). 외화 금액의 원화 값과 상한액 초과는 올리기 전에 사람에게 묻는다(lodgeAsk).
 * - 교통: 가는 편·오는 편이 한 줄씩이다. 항공권을 그 날짜·시각의 편에 앉혀 그 편을 비행기로 바꾸고(항공권이 한 편뿐이면 나머지
 *   편은 KTX), 항공권을 넣었거나 편이 사전정산과 달라졌을 때만 두 편을 넣는다. 편의 값은 비행기면 항공권, 사전정산에 같은 교통편의
 *   줄이 있으면 그 줄, 기차면 운임표의 정가다 — 값을 모르는 편은 넣지 않고 notes 에 적는다. 기차표·버스표는 쓰지 않는다.
 *   항공권의 필수(일자·출발지·도착지·합계)를 못 읽었으면 problems 다. 항공권이 있으면 항공 마일리지 블록도 켠다
 *   (항공권 출장 = 예, 업무 항공마일리지 발생 = 예, 항공사, 마일리지 공제 = 예). 신규 마일리지는 문서에 적혀 있으면 그 값이고,
 *   없으면 항공 마일리지 표(air-mileage.yaml)에서 편마다 찾는다 — 일반석과 특실·비즈니스의 적립률이 다르다. 표에 없으면 비워 두고 알린다.
 * - 그 밖의 영수증은 여비계산서에 넣을 칸이 없다. 출장지에서 결제한 것이면(당일출장 증명) 확인했다고 notes 에, 아니면 skipped 에 적는다
 *   (확인한 것은 패널이 보관함에 담아 둔다 — 담당자에게 보낼 때 같이 간다).
 * - 조건에 맞지 않는 것(당일인데 숙박)과 모르는 문서는 넣지 않고 skipped 에 적는다.
 *
 * @param {object[]} records receipt 명세를 지난 기록. 각 기록에 file({name,type,dataUrl})이 붙어 있으면 숙박 줄의 첨부가 된다
 * @param {{trip:{from:string,to:string,location?:string}, detail?:{transports?:string[], rows?:object[]}, picks?:object, workplace?:string}} ctx
 *   detail 은 사전정산의 교통편과 출장의 출발·도착 시(tripPreDetail 의 rows·sHour·eHour), picks 는 카드에서 고른 가는 편·오는 편, workplace 는 근무지에 적어 둔 글이다
 * @returns {{lodge:object[], trans:object[], air:object|null, notes:string[], problems:string[], skipped:string[],
 *            need:ReturnType<typeof afterNeed>, picks:object, seats:object, legs:object[], touched:boolean}}
 *   picks·seats 는 표를 앉힌 뒤의 선택과 표(카드가 다시 그릴 때 쓴다), touched 는 교통비 내역을 넣을 까닭이 있는가(표를 넣었거나 편을 바꿨다)
 */
export function afterPlan(records, { trip, detail = {}, picks = {}, workplace = '' }) {
  const notes = [];
  const problems = [];
  const skipped = [];
  const lodge = [];
  const trans = [];
  let air = null;

  // ---- 가는 편·오는 편: 표를 앉히고, 그에 따라 선택을 바꾼다
  const rows = detail.rows || [];
  const site = legsOfRows(rows, trip);
  const seats = seatTickets(ticketsOf(records), trip, { home: site.go?.dep || site.back?.arr || workplace, dest: site.go?.arr || site.back?.dep || trip?.location });
  const chosen = picksWithTickets(picks, seats, site);
  const route = legPlan({ trip, picks: chosen, rows, seats, workplace });
  const need = afterNeed(trip, detail, chosen);

  // ---- 숙박: 업체별로 묶는다
  const groups = new Map();
  for (const r of records || []) {
    if (!LODGING.has(r.docType)) continue;
    if (!need.lodging) { skipped.push(`${fileName(r)}: 당일 출장이라 숙박비 내역은 넣지 않습니다`); continue; }
    const key = vendorKey(r.vendor) || `#${groups.size}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const rs of groups.values()) {
    const receipts = rs.filter((r) => r.docType === 'lodging_receipt');
    const bookings = rs.filter((r) => r.docType === 'lodging_booking');
    // 정산금액은 원화로만 적고(외화 문서에 원화 금액이 없으면 actual 이 비어 사람에게 묻는다 — lodgeAsk), 상한액은 올리기 전에
    // 패널이 사이트에서 읽어 붙인다(maxconv). 여기서는 실제 금액 그대로 셈해 둔다.
    const row = lodgeSettle({
      nation: DOMESTIC.nation, currency: LODGE_CURRENCY, etcname: '', settle: '', ...lodgeOf(receipts, bookings),
      // 첨부는 영수증이 먼저, 없으면 예약서다.
      file: (receipts.find((r) => r.file) || bookings.find((r) => r.file))?.file || null,
      sources: rs.map(fileName),
      // 그 줄에 딸린 알림 — notes 에도 들어가고, 카드가 그 줄의 내용을 펼 때 같이 보인다.
      notes: [],
    });
    const missing = [[!row.company, '업체명'], [!row.paydate, '결제일'], [!row.sday, '숙박 일수'], [row.actual == null && row.doc.total == null, '정산금액']]
      .filter(([bad]) => bad).map(([, name]) => name);
    if (missing.length) problems.push(`숙박(${row.sources.join('·')})에서 ${missing.join('·')}을(를) 읽지 못했습니다`);
    if (!receipts.length) row.notes.push(`${row.stay || '숙박'}은 예약서만 있고 결제 영수증이 없습니다 — 금액은 예약 금액입니다`);
    if (need.nights && row.sday && row.sday !== need.nights) row.notes.push(`${row.stay || '숙박'}의 숙박 일수(${row.sday}박)가 출장 기간(${need.nights}박)과 다릅니다`);
    notes.push(...row.notes);
    lodge.push(row);
  }

  // ---- 교통: 가는 편·오는 편. 표를 넣었거나 편이 사전정산과 달라졌을 때만 넣는다 — 그대로면 사전정산의 값이 선다.
  const flights = (records || []).filter((r) => FLIGHT.has(r.docType));
  for (const r of flights) {
    const missing = [[!r.flightDate, '탑승일'], [!text(r.depPlace), '출발지'], [!text(r.arrPlace), '도착지'], [num(r.total) == null, '합계 금액']]
      .filter(([bad]) => bad).map(([, name]) => name);
    if (missing.length) problems.push(`항공권(${fileName(r)})에서 ${missing.join('·')}을(를) 읽지 못했습니다`);
  }
  const touched = route.changed || route.legs.some((l) => l.ticket);
  if (touched) {
    for (const l of route.legs) {
      if (!l.pick?.t) continue;                     // 고르지 않은 편
      if (!l.row) { notes.push(`${l.label}은 넣지 못했습니다 — ${l.problem}. 사후정산 화면에서 넣어 주세요`); continue; }
      // 출발·도착 시: 항공권이 앉은 편은 항공권의 시각이다. 나머지 편은 사전정산의 줄에 적힌 시각이고, 비어 있으면 출장 출발·도착 시각과
      // 구간의 대략 소요 시간으로 채운다(src/travel.js 의 legTimes — 가는 편은 출발 시각에 떠나고, 오는 편은 도착 시각에 닿는다).
      const at = l.ticket ? { shr: hourOf(l.ticket.depTime), ehr: hourOf(l.ticket.arrTime) } : legTimes(l.key, l.row, detail);
      trans.push({
        date: l.row.date || null, shr: String(at.shr ?? ''), ehr: String(at.ehr ?? ''), dep: text(l.row.dep), arr: text(l.row.arr),
        transport: AFTER_TRANSPORT[l.pick.t], grade: text(l.row.grade), total: num(l.row.total), currency: l.row.currency || DOMESTIC.currency,
        cocard: l.ticket?.cocard ? '1' : '0', comment: l.ticket?.name || '', source: l.ticket?.source || l.label,
      });
    }
    notes.push(...route.notes);
    for (const t of seats.extra) notes.push(`${t.source}: 가는 편·오는 편에 이미 표가 있어 넣지 않았습니다`);
  }
  if (flights.length) {
    const airline = text(flights.map((r) => r.airline).find(Boolean));
    // 신규 마일리지(2026-10-04 사용자 지정): 문서에 적혀 있으면 그 값이고, 적혀 있지 않은 항공권은 **앉은 편마다 항공 마일리지 표**
    // (air-mileage.yaml, src/mileage.js)에서 찾아 더한다 — 구간 마일 × 좌석 등급의 적립률. 카드에서 그 편을 특실로 골랐거나 항공권의
    // 좌석 등급이 프레스티지·비즈니스면 특실의 적립률이다. 표에 없는 항공사·구간은 채우지 않고 알린다.
    const miles = flights.map((r) => num(r.mileage)).filter((m) => m != null);
    const found = [];
    const unknown = [];
    for (const l of route.legs) {
      if (!l.ticket || l.ticket.mileage != null) continue;
      const m = milesOf({ airline: l.ticket.airline, dep: l.ticket.dep, arr: l.ticket.arr, first: l.pick?.g === 'first' || isFirstSeat(l.ticket.grade) });
      if (!m) { unknown.push(`${l.label} ${[l.ticket.airline, `${l.ticket.dep}→${l.ticket.arr}`].filter(Boolean).join(' ')}`); continue; }
      found.push(`${l.label} ${describeMiles(m)}`);
      miles.push(m.miles);
    }
    // 항공권 출장 = 예, 업무 항공마일리지 발생 = 예(2026-10-03 사용자 지정 — 대한항공이면 예). 마일리지 공제는 예(신청)이고
    // (2026-10-04 사용자 지정 — 화면의 기본값이기도 하다) 공제 금액은 화면이 셈한다(마일 × 5).
    air = { abroad: 'Y', bizmile: 'Y', airline: airline || '', mileage: miles.length ? miles.reduce((a, b) => a + b, 0) : null, deduction: 'Y', usage: 'N' };
    if (!airline) notes.push('항공권에서 항공사를 읽지 못했습니다 — 사후정산 화면에서 항공사를 적어 주세요');
    if (found.length) notes.push(`신규 마일리지는 항공 마일리지 표에서 찾았습니다 — ${found.join(' · ')}`);
    if (unknown.length) notes.push(`항공 마일리지 표에 없어 신규 마일리지를 찾지 못한 편이 있습니다(${unknown.join(' · ')}) — 적립되는 항공권이면 사후정산 화면에서 적어 주세요`);
    else if (air.mileage == null) notes.push('항공권에 적립 마일리지가 적혀 있지 않습니다 — 신규 마일리지는 사후정산 화면에서 적어 주세요');
  }

  // 숙박 증빙도 항공권도 아닌 문서. 여비계산서에는 넣을 칸이 없다 — 무엇으로 읽었는지만 말한다.
  for (const r of records || []) {
    if (!LODGING.has(r.docType) && !FLIGHT.has(r.docType)) {
      const e = evidenceOf(r, trip);
      // 여비계산서에는 영수증을 붙일 칸이 없다 — 패널이 보관함(src/evidence.js)에 담아 두었다가 담당자에게 보낼 때 같이 보낸다.
      if (e.ok) notes.push(`${fileName(r)}: ${e.label}으로 확인했습니다(출장지에서 ${shortDay(r.payDate)} 결제)`);
      else if (r.docType === 'other_receipt') skipped.push(`${fileName(r)}: ${e.label}으로 쓸 수 없습니다 — ${e.note}`);
      else skipped.push(`${fileName(r)}: ${e.label} — ${e.note}`);
    }
    if (text(r.extra)) {
      const note = `추가 정보 — ${fileName(r)}: ${text(r.extra)}`;
      notes.push(note);
      if (LODGING.has(r.docType)) lodge.find((l) => l.sources.includes(fileName(r)))?.notes.push(note);
    }
  }
  return { lodge, trans, air, notes, problems, skipped, need, picks: chosen, seats, legs: route.legs, touched };
}

const won = (n, cur) => (n == null ? '?' : `${Number(n).toLocaleString('ko-KR')}${cur && cur !== 'KRW' ? ` ${cur}` : '원'}`);
/** 교통비 줄의 수단을 짧게 부르는 이름(요약과 카드에 쓴다). */
export const TRANS_NAME = { [AFTER_TRANSPORT.plane]: '비행기', [AFTER_TRANSPORT.train]: 'KTX', [AFTER_TRANSPORT.bus]: '버스' };

/** 올린(또는 올릴) 사후정산을 한 줄로. 상태 줄과 기록에 쓴다. */
export function afterSummary(plan) {
  const parts = [];
  for (const l of plan.lodge) parts.push(`숙박 ${l.company || '?'} ${l.sday ?? '?'}박 ${won(l.total, l.currency)}${l.capped ? '(상한액)' : ''}`);
  for (const t of plan.trans) parts.push(`${TRANS_NAME[t.transport] || t.transport} ${t.date || '?'} ${t.dep || '?'}→${t.arr || '?'} ${won(t.total, t.currency)}`);
  if (plan.air) parts.push(`항공 마일리지 ${plan.air.airline || '항공사 ?'}${plan.air.mileage != null ? ` ${plan.air.mileage.toLocaleString('ko-KR')}마일` : ''}`);
  return parts.join(' · ');
}

/**
 * 사후정산 입력 화면의 폼 그대로 보낼 칸을 차례대로 만든다 — 화면이 가진 칸(base: formFields 의 결과)에 항공·식비 값을 얹고,
 * 숙박·교통 줄을 화면의 addLodge()/addTr() 가 만드는 순서대로 덧붙인다(같은 이름이 줄마다 되풀이되는 배열 폼이다).
 * 파일은 { file } 로 표시해 두고 보내는 쪽(src/trip.js)이 Blob 으로 바꾼다.
 * @param {[string,string][]} base 화면의 칸
 * @param {ReturnType<typeof afterPlan>} plan
 * @returns {[string, string|{file:object}][]}
 */
export function afterFields(base, plan) {
  const override = new Map();
  if (plan.air) {
    override.set('air_abroad', plan.air.abroad).set('air_bizmile', plan.air.bizmile).set('air_bizairline', plan.air.airline || '')
      .set('air_mileage', plan.air.mileage == null ? '' : String(plan.air.mileage)).set('air_deduction', plan.air.deduction)
      .set('air_miles', plan.air.mileage == null || plan.air.deduction !== 'Y' ? '0' : String(plan.air.mileage * 5))
      .set('air_mileusage', plan.air.usage);
  }
  // 교통비 줄을 올릴 때는 화면에 이미 있던 교통 줄을 지움 표시한다(화면의 × 와 같다) — 가는 편·오는 편이 교통비 내역의 전부라,
  // 다시 올릴 때 같은 편이 두 번 들어가지 않게 한다. 숙박 줄은 있던 것을 두고 덧붙인다.
  if (plan.trans.length) override.set('tr_del', '1');
  const out = (base || []).map(([name, value]) => [name, override.has(name) ? override.get(name) : value]);
  const s = (v) => (v == null ? '' : String(v));
  for (const l of plan.lodge) {
    out.push(['lodge_nation', l.nation], ['lodge_seq', ''], ['lodge_del', '0'], ['lodge_oldfile', ''],
      ['lodge_maxtotal', s(l.maxtotal)], ['lodge_maxcur', s(l.maxcur)], ['lodge_maxrate', s(l.maxrate)], ['lodge_maxconv', s(l.maxconv)],
      ['lodge_paydate', s(l.paydate)], ['lodge_sday', s(l.sday)], ['lodge_company', s(l.company)], ['lodge_companycode', s(l.companycode)],
      ['lodge_currency', s(l.currency)], ['lodge_cocard', s(l.cocard || '0')], ['lodge_total', s(l.total)], ['lodge_samount', s(l.samount)],
      ['lodge_vat', s(l.vat)], ['lodge_comment', s(l.comment)], ['lodge_etcname', s(l.etcname)]);
    if (l.file) out.push(['lodge_file', { file: l.file }]);
  }
  for (const t of plan.trans) {
    out.push(['tr_seq', ''], ['tr_del', '0'], ['tr_smn', '0'], ['tr_emn', '0'], ['tr_date', s(t.date)], ['tr_shr', s(t.shr)], ['tr_ehr', s(t.ehr)],
      ['tr_dep', s(t.dep)], ['tr_arr', s(t.arr)], ['tr_transport', s(t.transport)], ['tr_grade', s(t.grade)], ['tr_total', s(t.total)],
      ['tr_currency', s(t.currency)], ['tr_cocard', s(t.cocard || '0')], ['tr_comment', s(t.comment)]);
  }
  return out;
}
