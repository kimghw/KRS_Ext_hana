// 신청 내역 출장 카드의 "숙박비 내역" — 사후정산 입력 화면에 **지금 있는** 숙박 줄을 가는 편·오는 편 아래에 한 줄씩 보인다
// (2026-10-03 사용자 지정: 업체명(길면 줄임)·정산금액, 화면에 세 줄이 있으면 세 줄 다, 지우기와 다시 읽기).
// 이 패널이 증빙으로 올린 줄만이 아니라 화면에서 손수 적은 줄도 보이고, 어느 쪽인지 줄마다 적는다 — 증빙 없이 적힌 줄은 "손수 작성"이다.
// 읽고 지우는 길은 src/trip.js(tripAfterRows·tripAfterLodgeDelete)다. 카드를 그리고 누름을 넘겨 주는 것은 attendpanel.js 다.
// 같은 화면의 교통 줄(사후정산에 따로 올린 편)도 읽어 둔다 — 사후정산이 완료된 출장의 카드가 그것으로 가는 편·오는 편을 그린다.
//
// 지우기는 실제 계산서의 줄이 없어지는 일이라 두 번 눌러야 나간다 — 두 번 누르기는 attendpanel.js 가 한다(다른 버튼과 같은 길).
//
// **`상한` 버튼**(2026-10-06 사용자 지정: "상한할지 안할지 버튼 하나") — 실제 금액이 숙박비 상한액을 넘는 원화 줄의 정산금액 옆에
// 하나 선다. 켜져 있으면 상한액으로 정산 중이고, 누르면 실제 금액과 상한액 사이를 오간다(그 줄의 정산금액·공급가액·부가세만 바꿔
// 폼을 그대로 저장 — src/trip.js 의 tripAfterLodgeAmount). 상한액은 화면의 숨은 칸(lodge_maxconv·maxtotal)에서, 없으면 사이트의
// CalMaxLodge 에서 읽는다. 실제 금액은 상한액으로 낮출 때 적어 두고(attendLodgeActual — 올릴 때도 적는다), 몰라서 되돌릴 수 없으면
// 버튼이 켜진 채 잠긴다. 실제 금액으로 되돌리면 승인 규칙(상한액의 1.5배까지 부서장 승인, src/after.js lodgeOver)을 풍선말과 상태 줄에 적는다.
// 완료된 사후정산의 카드(보여 주기만 — × 가 없다)에도 선다(2026-10-06 사용자 지정).
//
// **비고의 상한 초과 사유**(2026-10-08 사용자 지정: "상한액 넘어 가면 '비고' 란에 상한 이유를 넣어야 하거든. 이게 상한액 넘어 가면 필수라서.
// 기본적으로 '인근 숙소비 상승으로 인해 숙박비 내에 숙박이 어려움' 라는 내용을 넣어주고, 수정 가능하게 해줘") — 정산금액이 상한액을 넘는 줄의
// 비고에는 사유가 필수다. `상한` 을 꺼서 실제 금액으로 되돌리면 비고에 사유(적어 둔 것, 없으면 기본 문구 — src/after.js LODGE_OVER_REASON)를
// 잇고, 켜서 상한액으로 낮추면 그 사유를 걷는다(묵은 곳 같은 나머지 글은 그대로). 그 줄의 내용을 펴면(증빙·손수 작성 표시) 사유를 고쳐 쓰는
// 칸이 서고, `비고에 저장` 으로 그 줄의 비고만 바꿔 저장한다(src/trip.js 의 tripAfterLodgeComment). 고쳐 쓴 사유는 실제 금액과 같이 적어 둔다.

import { tripAfterRows, tripAfterLodgeDelete, tripAfterLodgeAmount, tripAfterLodgeComment, tripLodgeMax } from './src/trip.js';
import { LODGE_CURRENCY, LODGE_OVER_REASON, lodgeCap, lodgeOver, lodgeSettle, lodgeApproval, lodgeCommentWith, lodgeCommentWithout } from './src/after.js';
import { LOG_KEY } from './src/logbook.js';

const REFRESH_TITLE = '숙박비 내역 다시 읽기 — 사후정산 화면에서 고친 것을 가져옵니다';
const REFRESH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17"/></svg>';
/** 이 패널이 증빙으로 올린 숙박 줄의 표시 — { [계산서 번호]: { [숙박 줄 번호]: 파일 이름 } }. 올릴 때 attendpanel.js 의 runAfter 가 적는다. */
const MINE_KEY = 'attendLodgeMine';
/** 보관함에서 숙박 증빙을 부르는 이름(src/after.js 의 evidenceOf). */
const LODGE_LABEL = '숙박 증빙';
const HAND_TITLE = '이 패널에서 올린 증빙으로 작성한 줄이 아닙니다 — 사후정산 화면에서 손수 작성한 줄입니다';
/** 표시(증빙·손수 작성)의 풍선말 꼬리 — 누르면 그 줄의 내용이 펴진다. */
const INFO_HOW = ' · 누르면 내용이 보입니다';
/**
 * 숙박 줄의 실제 금액 — { [계산서 번호]: { [숙박 줄 번호]: { actual, supply, vat, reason } } }(원). 상한액으로 낮출 때 그 전의 정산금액을,
 * 올릴 때는 증빙의 실제 금액(문서의 공급가액·부가세가 있으면 그것도)을 적는다 — `상한`을 끌 때 이 값으로 되돌린다.
 * reason 은 비고에 적은(고쳐 쓴) 상한 초과 사유다 — 없으면 기본 문구(LODGE_OVER_REASON)를 쓴다.
 */
export const ACTUAL_KEY = 'attendLodgeActual';
const CAP_LABEL = '상한';
const REASON_LABEL = '비고의 상한 초과 사유';
const REASON_SAVE = '비고에 저장';
const REASON_HOW = '정산금액이 상한액을 넘는 줄은 비고에 사유가 필수입니다 — 고쳐 쓰고 저장하면 그 줄의 비고만 바꿔 저장합니다';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const day = (s) => (DATE_RE.test(s || '') ? `${+s.slice(5, 7)}/${+s.slice(8)}` : '');
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null; };
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
/** 사이트의 상한액 응답을 담아 두는 열쇠 — 나라·화폐마다 하나다. */
const maxKey = (row) => `${row?.nation || ''}|${row?.currency || LODGE_CURRENCY}`;

/**
 * 그 줄의 1일 상한(줄의 화폐로). 화면의 숨은 칸이 먼저다 — lodge_maxconv(줄의 화폐로 바꾼 값), 없으면 lodge_maxtotal 이 줄의 화폐일 때
 * 그 값, 그것도 없으면 사이트의 CalMaxLodge 응답(maxes — 나라·화폐마다 읽어 둔 것). 모르면 null.
 * @param {Record<string,string>} row 화면의 숙박 줄(src/after.js lodgeRowsOf)
 * @param {Record<string, {maxconv?:string}>} [maxes] maxKey → tripLodgeMax 의 결과
 */
export function lodgeCapDay(row, maxes = {}) {
  let d = num(row?.maxconv);
  if (!(d > 0) && (row?.maxcur || '') === (row?.currency || LODGE_CURRENCY)) d = num(row?.maxtotal);
  if (!(d > 0)) d = num(maxes?.[maxKey(row)]?.maxconv);
  return d > 0 ? d : null;
}

/**
 * 그 줄의 `상한` 버튼이 설 자리 — 원화 줄이고 상한액을 알고 실제 금액이 상한액을 넘을 때만 선다. 아니면 null.
 *   on   은 지금 상한액으로 정산 중인가(정산금액 = 상한액), can 은 눌러서 바꿀 수 있는가(실제 금액을 알아야 되돌린다),
 *   actual 은 실제 금액(적어 둔 것이 먼저, 없으면 상한액을 넘는 지금의 정산금액), other 는 정산금액이 상한액도 실제 금액도 아닌가(손으로 고친 줄),
 *   over 는 승인 규칙(src/after.js lodgeOver — 실제 금액이 상한액의 1.5배 안이면 부서장 승인)
 * @param {Record<string,string>} row 화면의 숙박 줄
 * @param {{actual?:number}|null} [kept] 적어 둔 실제 금액(ACTUAL_KEY 의 것)
 * @param {Record<string, object>} [maxes] 사이트에서 읽어 둔 상한액
 * @returns {{cap:number, day:number, sday:number, actual:number|null, on:boolean, can:boolean, other:boolean, over:object|null}|null}
 */
export function lodgeCapState(row, kept = null, maxes = {}) {
  if ((row?.currency || LODGE_CURRENCY) !== LODGE_CURRENCY) return null;
  const sday = num(row.sday);
  const cap = lodgeCap({ maxconv: lodgeCapDay(row, maxes), sday });
  const total = num(row.total);
  if (!cap || total == null) return null;
  const actual = kept?.actual != null && Number(kept.actual) > 0 ? Number(kept.actual) : total > cap.total ? total : null;
  if (actual == null) return total === cap.total ? { cap: cap.total, day: cap.day, sday, actual: null, on: true, can: false, other: false, over: null } : null;
  if (actual <= cap.total) return null;
  const on = total === cap.total;
  return { cap: cap.total, day: cap.day, sday, actual, on, can: true, other: !on && total !== actual, over: lodgeOver({ actual, maxconv: cap.day, sday }) };
}

/** `상한` 버튼의 풍선말 — 지금 어느 금액으로 정산 중이고 누르면 어떻게 되는지, 실제 금액이면 승인 규칙. */
export function lodgeCapTitle(c) {
  const capText = `상한액 ${won(c.cap)}(1일 ${won(c.day)} × ${c.sday}박)`;
  if (!c.can) return `${capText}으로 정산 중 — 실제 금액을 몰라 되돌릴 수 없습니다(사후정산 화면에서 고쳐 주세요)`;
  const approval = lodgeApproval({ settle: 'real', actual: c.actual, maxconv: c.day, sday: c.sday });
  if (c.on) return `${capText}으로 정산 중 — 누르면 실제 금액 ${won(c.actual)}으로 되돌립니다${approval ? ` · ${approval}` : ''}`;
  const now = c.other ? `정산금액이 실제 금액 ${won(c.actual)}과 다릅니다` : `실제 금액 ${won(c.actual)}으로 정산 중`;
  return `${now}${approval ? `(${approval})` : ''} — 누르면 ${capText}으로 바꿉니다`;
}

/**
 * 화면의 숙박 줄의 비고에서 상한 초과 사유를 가려낸다 — 적어 둔 사유(kept.reason)가 들어 있으면 그것, 기본 문구가 들어 있으면 그것, 없으면 빈 글.
 * base 는 사유를 뺀 나머지 비고(묵은 곳·사업자명 등)다.
 * @returns {{reason: string, base: string, known: string[]}} known 은 이 줄에서 사유로 칠 수 있는 글들(적어 둔 것·기본 문구)
 */
export function lodgeReasonOf(row, kept = null) {
  const comment = String(row?.comment ?? '').trim();
  const known = [...new Set([String(kept?.reason ?? '').trim(), LODGE_OVER_REASON].filter(Boolean))];
  const reason = known.find((r) => comment.includes(r)) || '';
  return { reason, base: lodgeCommentWithout(comment, known), known };
}

/** 정산금액을 화폐와 함께 — 원화는 "125,052원", 외화는 "88.46 USD". */
export function lodgeAmount(row) {
  const n = num(row?.total);
  if (n == null) return '금액 ?';
  const text = n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return !row.currency || row.currency === 'KRW' ? `${text}원` : `${text} ${row.currency}`;
}

/**
 * 그 줄이 어디서 왔는가 — 이 패널이 증빙으로 올린 줄이면 그 파일 이름, 아니면 빈 글(화면에서 손수 적은 줄).
 * 올릴 때 적어 둔 표시(줄 번호 → 파일 이름)가 먼저다. 표시를 적기 전에 올린 줄은 보관함의 숙박 증빙 가운데 금액이 같은 것,
 * 그것도 없으면 활동 기록에 남은 "사후정산 작성"의 숙박 줄(박 수·정산금액이 같은 것)로 알아본다 — 붙여 넣은 그림은 이름이 같아
 * (image.png) 보관함에는 마지막 한 장만 남지만, 올린 것은 기록에 다 남아 있다.
 * @param {{seq:string,total:string,sday?:string,currency?:string}} row 화면의 숙박 줄
 * @param {Record<string,string>} mine 이 계산서의 표시
 * @param {{name:string,label:string,total:number|null}[]} kept 보관함의 증빙
 * @param {{text:string,file:string}[]} logged 활동 기록에서 추린 이 계산서의 "사후정산 작성"
 */
export function lodgeSource(row, mine = {}, kept = [], logged = []) {
  if (mine?.[row.seq]) return String(mine[row.seq]);
  const total = num(row.total);
  if (total == null) return '';
  const hit = (kept || []).find((k) => k.label === LODGE_LABEL && k.total != null && Number(k.total) === total);
  if (hit) return hit.name;
  // 기록의 글은 src/after.js 의 afterSummary 가 쓴 것이다 — "숙박 업체명 1박 88.46 USD".
  const said = (logged || []).find((l) => l.text.includes(` ${Number(row.sday)}박 ${lodgeAmount(row)}`));
  return said ? said.file || '올린 증빙' : '';
}

/** 활동 기록에서 그 계산서의 사후정산을 올린 기록만 추린다(성공한 것). file 은 그때 넣은 파일 이름들이다. */
export function lodgeLogged(entries, seq) {
  const head = `여비계산서(사후정산) 작성: ${seq} ·`;
  return (Array.isArray(entries) ? entries : []).filter((e) => e?.kind === 'trip' && e.ok && String(e.text || '').startsWith(head))
    .map((e) => ({ text: e.text, file: (Array.isArray(e.data?.files) ? e.data.files : []).join(' · ') }));
}

/**
 * @param {{escapeHtml:Function, logEvent:Function, setStatus:Function, setError:Function, repaint:Function}} deps
 *   repaint 는 신청 내역을 다시 그리는 길이다
 */
export function createLodgeBox({ escapeHtml, logEvent, setStatus, setError, repaint }) {
  // by 는 계산서마다의 사정이다: rows 는 화면에서 읽은 숙박 줄(아직 못 읽었으면 null), trans 는 같이 읽은 교통 줄, mine 은 저장해 둔 표시,
  // actual 은 적어 둔 실제 금액(줄 번호 → { actual, supply, vat }), maxes 는 사이트에서 읽어 둔 상한액(나라·화폐 → 응답),
  // logged 는 활동 기록에 남은 이 계산서의 "사후정산 작성", busy 는 지우거나 금액을 바꾸는 중인 줄 번호, error 는 그러다 난 일이다.
  // draft 는 사유 칸에 적는 중인 글(줄 번호 → 글) — 카드를 다시 그려도 남게 들고 있다가 저장하면 버린다.
  const box = { by: {} };
  const of = (seq) => box.by[seq] || (box.by[seq] = { rows: null, trans: [], mine: {}, actual: {}, maxes: {}, logged: [], draft: {}, loading: false, busy: '', error: '' });
  const what = (row) => `${row.company || '업체명 없음'} · ${day(row.paydate) || '결제일 ?'} · ${lodgeAmount(row)}`;

  /** 원화 줄인데 화면의 숨은 칸에 상한이 없으면 사이트에서 읽어 둔다(나라·화폐마다 한 번). 못 읽어도 던지지 않는다 — 그 줄에 버튼이 안 설 뿐이다. */
  async function loadMaxes(s, rows, trseq) {
    const keys = new Set(rows.filter((r) => (r.currency || LODGE_CURRENCY) === LODGE_CURRENCY && !lodgeCapDay(r)).map(maxKey));
    await Promise.all([...keys].filter((k) => !s.maxes[k]).map(async (k) => {
      const [nation, currency] = k.split('|');
      s.maxes[k] = (await tripLodgeMax(trseq, nation, currency)) || {};
    }));
  }

  async function load(ctx, { quiet = true } = {}) {
    const { trip, trseq } = ctx;
    const s = of(trip.seq);
    if (s.loading || s.busy) return;
    Object.assign(s, { loading: true, error: '' });
    if (!quiet) repaint();
    try {
      const [{ lodges: rows, trans }, saved] = await Promise.all([tripAfterRows(trip.seq, trseq), chrome.storage.local.get([MINE_KEY, ACTUAL_KEY, LOG_KEY])]);
      Object.assign(s, { rows, trans, mine: saved?.[MINE_KEY]?.[trip.seq] || {}, actual: saved?.[ACTUAL_KEY]?.[trip.seq] || {}, logged: lodgeLogged(saved?.[LOG_KEY], trip.seq) });
      await loadMaxes(s, rows, trseq);
      if (!quiet) setStatus(`숙박비 내역을 다시 읽었습니다 — ${rows.length ? `${rows.length}줄` : '없음'} · 여비계산서 ${trip.seq}`);
    } catch (err) {
      s.error = `숙박비 내역을 읽지 못했습니다: ${err.message}`;
      if (!quiet) setError(err, '숙박비 내역 읽기 실패');
    } finally {
      s.loading = false;
      repaint();
    }
  }

  /** 열어 둔 카드의 숙박 줄을 한 번 읽어 둔다. 이미 읽었거나 읽는 중이거나 못 읽었으면(다시 읽기는 버튼으로) 두 번 하지 않는다. */
  function ensure(ctx) {
    if (!ctx?.trip || !ctx.trseq) return;
    const s = of(ctx.trip.seq);
    if (!s.rows && !s.loading && !s.error) load(ctx);
  }

  /** 다시 읽는다 — 새로고침 버튼(quiet 가 아니면 상태 줄에 적는다)과, 사후정산을 올린 뒤. */
  const reload = (ctx, { quiet = false } = {}) => (ctx?.trip && ctx.trseq ? load(ctx, { quiet }) : Promise.resolve());

  /** 지우려는 줄을 한 줄로 — 첫 번째 누름에서 상태 줄에 적어 무엇이 지워지는지 보인다. */
  function describe(seq, lodgeSeq) {
    const row = of(seq).rows?.find((r) => r.seq === String(lodgeSeq));
    return row ? what(row) : '';
  }

  // 저장소의 줄마다 적어 둔 것({ 계산서 번호: { 줄 번호: … } })은 읽고 고쳐 다시 쓴다 — 여러 줄을 잇달아 적어도 서로 덮지 않게 차례로 한다.
  let marking = Promise.resolve();
  const inTurn = (fn) => (marking = marking.then(fn, fn));

  /** 저장소의 줄마다 적어 둔 것에서 그 줄을 뺀다. 못 고쳐도 던지지 않는다. */
  const dropMark = (key, seq, lodgeSeq) => inTurn(async () => {
    try {
      const all = (await chrome.storage.local.get(key))?.[key];
      const marks = all?.[seq];
      if (!marks) return;
      delete marks[lodgeSeq];
      if (!Object.keys(marks).length) delete all[seq];
      await chrome.storage.local.set({ [key]: all });
    } catch { /* 표시는 다음에 읽을 때 화면의 줄과 맞지 않아도 해가 없다 */ }
  });

  /** 저장소의 줄마다 적어 둔 것에 그 줄의 것을 적는다(패널을 다시 열어도 남게). 못 적어도 던지지 않는다. */
  const putMark = (key, seq, lodgeSeq, value) => inTurn(async () => {
    try {
      const all = { ...(await chrome.storage.local.get(key))?.[key] };
      all[seq] = { ...all[seq], [lodgeSeq]: value };
      await chrome.storage.local.set({ [key]: all });
    } catch { /* 적어 둔 것은 곁다리다 */ }
  });

  /** 저장해 둔 표시·실제 금액에서 그 줄을 뺀다. 못 고쳐도 지운 것은 지운 것이라 던지지 않는다. */
  async function forget(ctx, lodgeSeq) {
    const s = of(ctx.trip.seq);
    delete s.mine[lodgeSeq];
    delete s.actual[lodgeSeq];
    if (ctx.mine) delete ctx.mine[lodgeSeq];
    await dropMark(MINE_KEY, ctx.trip.seq, lodgeSeq);
    await dropMark(ACTUAL_KEY, ctx.trip.seq, lodgeSeq);
  }

  /**
   * 그 줄의 실제 금액을 적어 둔다 — 올릴 때(attendpanel.js 의 rememberMine)와 상한액으로 낮출 때. `상한`을 끌 때 이 값으로 되돌린다.
   * supply·vat 는 실제 금액일 때의 공급가액·부가세(문서의 것) — 모르면 null(되돌릴 때 정산금액에서 되셈한다).
   * reason 은 비고에 적은 상한 초과 사유(고쳐 쓴 것) — 없으면 null(기본 문구를 쓴다). 주지 않으면 적어 둔 것을 그대로 둔다.
   * @param {{actual:number, supply?:number|null, vat?:number|null, reason?:string|null}} value
   */
  async function noteActual(seq, lodgeSeq, value) {
    if (!(Number(value?.actual) > 0)) return;
    const had = of(seq).actual[lodgeSeq];
    const reason = value.reason === undefined ? had?.reason ?? null : String(value.reason ?? '').trim() || null;
    const v = { actual: Math.round(Number(value.actual)), supply: value.supply ?? null, vat: value.vat ?? null, reason };
    of(seq).actual[lodgeSeq] = v;
    await putMark(ACTUAL_KEY, seq, lodgeSeq, v);
  }

  /** 그 줄에 적어 둔 상한 초과 사유만 바꾼다(실제 금액은 그대로). 실제 금액을 모르는 줄이면 사유만 적어 둔다. */
  async function noteReason(seq, lodgeSeq, reason) {
    const had = of(seq).actual[lodgeSeq];
    const v = { actual: had?.actual ?? null, supply: had?.supply ?? null, vat: had?.vat ?? null, reason: String(reason ?? '').trim() || null };
    of(seq).actual[lodgeSeq] = v;
    await putMark(ACTUAL_KEY, seq, lodgeSeq, v);
  }

  /**
   * 숙박 줄 하나의 정산금액을 상한액과 실제 금액 사이에서 바꾼다(`상한` 버튼) — 켜져 있으면 실제 금액으로 되돌리고, 꺼져 있으면 상한액으로
   * 낮춘다. 공급가액·부가세는 src/after.js 의 lodgeSettle 이 정한다(실제 금액에 문서의 값을 적어 뒀으면 그것, 아니면 정산금액에서 되셈).
   * 상한액으로 낮추기 전의 정산금액(과 공급가액·부가세가 그 금액에 맞으면 그것도)을 실제 금액으로 적어 둔다. 그 줄의 `증빙` 표시가 금액으로
   * 알아본 것이었으면 금액이 바뀌어도 남게 줄 번호에 적어 둔다. 바꾼 뒤의 줄은 화면을 다시 읽은 것이다.
   * 바뀐 것을 ctx.changed(줄 번호, 정한 줄)로 카드에 알린다 — 올린 내용(펴 보는 것)의 정산금액을 맞추도록.
   */
  async function toggleCap(ctx, lodgeSeq) {
    const { trip, trseq } = ctx;
    const s = of(trip.seq);
    const row = s.rows?.find((r) => r.seq === String(lodgeSeq));
    if (!row || s.busy || s.loading) return;
    const c = lodgeCapState(row, s.actual[row.seq], s.maxes);
    if (!c?.can) return;
    const settle = c.on ? 'real' : 'cap';
    const kept = s.actual[row.seq];
    const l = lodgeSettle({ actual: c.actual, maxconv: c.day, sday: c.sday, settle, doc: { currency: LODGE_CURRENCY, total: c.actual, supply: kept?.supply ?? null, vat: kept?.vat ?? null } });
    // 비고의 상한 초과 사유 — 실제 금액으로 되돌리면 잇고(적어 둔 사유, 없으면 기본 문구), 상한액으로 낮추면 걷는다. 그대로면 비고는 보내지 않는다.
    const { reason: had, known } = lodgeReasonOf(row, kept);
    const before = String(row.comment ?? '').trim();
    const comment = settle === 'real' ? lodgeCommentWith(before, had || known[0]) : lodgeCommentWithout(before, known);
    const commented = comment !== before;
    const text = what(row);
    const source = lodgeSource(row, { ...s.mine, ...ctx.mine }, ctx.kept || [], s.logged);
    Object.assign(s, { busy: row.seq, error: '' });
    repaint();
    try {
      s.rows = await tripAfterLodgeAmount(trip.seq, trseq, row.seq, { total: l.total, samount: l.samount, vat: l.vat, ...(commented ? { comment } : {}) });
      if (settle === 'cap') {
        // 그 전의 정산금액이 실제 금액이다(적어 둔 것이 없을 때). 공급가액·부가세는 그 금액에 맞을 때만 같이 적는다. 걷은 사유도 적어 둔다(되돌릴 때 다시 잇는다).
        const total = num(row.total);
        const fits = total != null && num(row.samount) != null && num(row.vat) != null && num(row.samount) + num(row.vat) === total;
        if (!kept) await noteActual(trip.seq, row.seq, { actual: total, supply: fits ? num(row.samount) : null, vat: fits ? num(row.vat) : null, reason: had || null });
        else if (had && had !== kept.reason) await noteReason(trip.seq, row.seq, had);
      }
      if (source && !s.mine[row.seq]) {
        s.mine[row.seq] = source;
        await putMark(MINE_KEY, trip.seq, row.seq, source);
      }
      const approval = settle === 'real' ? lodgeApproval(l) : '';
      const how = settle === 'cap' ? `상한액 ${won(l.total)}으로 바꿨습니다` : `실제 금액 ${won(l.total)}으로 되돌렸습니다`;
      const remark = !commented ? '' : settle === 'real' ? ` · 비고에 사유를 적었습니다(${had || known[0]})` : ' · 비고의 상한 초과 사유를 걷었습니다';
      setStatus(`정산금액을 ${how} — ${text} · 여비계산서 ${trip.seq}${approval ? ` · ${approval}` : ''}${remark}`);
      logEvent('trip', true, `여비계산서(사후정산) 숙박 줄 정산금액 변경: ${trip.seq} · ${text} → ${won(l.total)}(${settle === 'cap' ? '상한액' : '실제 금액'})${approval ? ` · ${approval}` : ''}${remark}`,
        { seq: trip.seq, lodgeSeq: row.seq, settle, total: l.total, samount: l.samount, vat: l.vat, ...(commented ? { comment } : {}) });
      ctx.changed?.(row.seq, commented ? { ...l, comment } : l);
    } catch (err) {
      s.error = `정산금액을 바꾸지 못했습니다: ${err.message}`;
      setError(err, '숙박 줄 정산금액 변경 실패');
      logEvent('trip', false, `여비계산서(사후정산) 숙박 줄 정산금액 변경 실패: ${trip.seq} · ${text} — ${err.message}`, { seq: trip.seq, lodgeSeq: row.seq, settle });
    } finally {
      s.busy = '';
      repaint();
    }
  }

  /** 사유 칸에 적는 중인 글을 들고 있는다(카드를 다시 그려도 남게). */
  function draft(seq, lodgeSeq, value) {
    of(seq).draft[lodgeSeq] = String(value ?? '');
  }

  /**
   * 상한액을 넘긴 숙박 줄의 비고에 적힌 상한 초과 사유를 고쳐 쓴다(`비고에 저장`) — 비고의 나머지 글(묵은 곳 등)은 그대로 두고 사유만
   * 바꿔 그 줄의 비고만 저장한다(src/trip.js 의 tripAfterLodgeComment). 빈 글이면 기본 문구를 적는다(사유는 필수다). 고쳐 쓴 사유는
   * 실제 금액과 같이 적어 두어 `상한` 을 오갈 때 그 사유로 잇고 걷는다. 바뀐 비고를 ctx.changed(줄 번호, { comment }) 로 카드에 알린다.
   * @param {string} value 사유 칸에 적힌 글
   */
  async function setReason(ctx, lodgeSeq, value) {
    const { trip, trseq } = ctx;
    const s = of(trip.seq);
    const row = s.rows?.find((r) => r.seq === String(lodgeSeq));
    if (!row || s.busy || s.loading) return;
    const reason = String(value ?? '').trim() || LODGE_OVER_REASON;
    const { base, reason: had } = lodgeReasonOf(row, s.actual[row.seq]);
    const comment = lodgeCommentWith(base, reason);
    const text = what(row);
    if (comment === String(row.comment ?? '').trim()) {
      delete s.draft[row.seq];
      if (reason !== (s.actual[row.seq]?.reason || '')) await noteReason(trip.seq, row.seq, reason);
      setStatus(`비고가 이미 그 사유입니다 — ${text} · 여비계산서 ${trip.seq}`);
      repaint();
      return;
    }
    Object.assign(s, { busy: row.seq, error: '' });
    repaint();
    try {
      s.rows = await tripAfterLodgeComment(trip.seq, trseq, row.seq, comment);
      delete s.draft[row.seq];
      await noteReason(trip.seq, row.seq, reason);
      setStatus(`비고에 상한 초과 사유를 ${had ? '고쳐 ' : ''}적었습니다 — ${text} · 여비계산서 ${trip.seq} · ${reason}`);
      logEvent('trip', true, `여비계산서(사후정산) 숙박 줄 비고 변경: ${trip.seq} · ${text} → ${comment}`, { seq: trip.seq, lodgeSeq: row.seq, comment, reason });
      ctx.changed?.(row.seq, { comment });
    } catch (err) {
      s.error = `비고를 바꾸지 못했습니다: ${err.message}`;
      setError(err, '숙박 줄 비고 변경 실패');
      logEvent('trip', false, `여비계산서(사후정산) 숙박 줄 비고 변경 실패: ${trip.seq} · ${text} — ${err.message}`, { seq: trip.seq, lodgeSeq: row.seq, comment });
    } finally {
      s.busy = '';
      repaint();
    }
  }

  /** 숙박 줄 하나를 사후정산에서 지운다(두 번째 누름). 지운 뒤의 줄은 화면을 다시 읽은 것이다. */
  async function remove(ctx, lodgeSeq) {
    const { trip, trseq } = ctx;
    const s = of(trip.seq);
    const row = s.rows?.find((r) => r.seq === String(lodgeSeq));
    if (!row || s.busy || s.loading) return;
    const text = what(row);
    Object.assign(s, { busy: row.seq, error: '' });
    repaint();
    try {
      s.rows = await tripAfterLodgeDelete(trip.seq, trseq, row.seq);
      await forget(ctx, row.seq);
      setStatus(`숙박 줄을 지웠습니다 — ${text} · 여비계산서 ${trip.seq}`);
      logEvent('trip', true, `여비계산서(사후정산) 숙박 줄 삭제: ${trip.seq} · ${text}`, { seq: trip.seq, lodgeSeq: row.seq });
    } catch (err) {
      s.error = `숙박 줄을 지우지 못했습니다: ${err.message}`;
      setError(err, '숙박 줄 삭제 실패');
      logEvent('trip', false, `여비계산서(사후정산) 숙박 줄 삭제 실패: ${trip.seq} · ${text} — ${err.message}`, { seq: trip.seq, lodgeSeq: row.seq });
    } finally {
      s.busy = '';
      repaint();
    }
  }

  /**
   * 펴진 줄 아래의 **비고의 상한 초과 사유** 칸 — 정산금액이 상한액을 넘는 줄에만 선다(2026-10-08 사용자 지정: 넘으면 비고에 사유가 필수,
   * 기본 문구를 넣고 고쳐 쓸 수 있게). 칸에는 지금 비고에 적힌 사유(없으면 적어 둔 것, 그것도 없으면 기본 문구)가 들어 있고, 적는 중인 글이
   * 있으면 그것이다. 비고에 사유가 아직 없으면 그렇다고 적는다. `비고에 저장` 이 그 줄의 비고만 바꿔 저장한다(setReason).
   */
  function reasonHtml(r, c, s, off) {
    const total = num(r.total);
    if (!c || total == null || !(total > c.cap)) return '';
    const kept = s.actual[r.seq];
    const { reason, base } = lodgeReasonOf(r, kept);
    const value = s.draft[r.seq] ?? (reason || kept?.reason || LODGE_OVER_REASON);
    const now = reason ? `지금 비고: ${String(r.comment ?? '').trim()}` : `비고에 상한 초과 사유가 없습니다${base ? ` — 지금 비고: ${base}` : ''} · 저장하면 ${base ? '뒤에 ' : ''}사유를 적습니다`;
    return `<div class="at-lodge-reason" data-lodge="${escapeHtml(r.seq)}"><p class="at-after-label">${REASON_LABEL}</p>`
      + `<div class="at-ask-row"><input type="text" class="at-lodge-reason-input" data-lodge="${escapeHtml(r.seq)}" value="${escapeHtml(value)}" `
      + `placeholder="${escapeHtml(LODGE_OVER_REASON)}" aria-label="${escapeHtml(`${REASON_LABEL} — ${what(r)}`)}" title="${REASON_HOW}"${off} />`
      + `<button type="button" class="small at-request at-lodge-reason-save" data-act="lodge-comment" data-lodge="${escapeHtml(r.seq)}" title="${REASON_HOW}"${off}>${REASON_SAVE}</button></div>`
      + `<p class="at-after-note${reason ? '' : ' missing'}">${escapeHtml(now)}</p></div>`;
  }

  /**
   * 출장 카드의 숙박비 내역. 출장자 번호가 없으면(사후정산을 쓸 단계가 아니다) 빈 글이다.
   * @param {{trip:object, trseq:string, kept?:object[], mine?:Record<string,string>, locked?:boolean, lodging?:boolean, readonly?:boolean,
   *          open?:string, detail?:(row:object, source:string) => string}} ctx
   *   trip 은 여비계산서 목록의 한 줄, kept 는 보관함의 증빙, mine 은 이 패널이 올린 줄의 표시(패널이 들고 있는 것),
   *   locked 는 카드가 다른 일을 하는 중인가, lodging 은 숙박이 있는 출장인가(당일 출장은 줄이 있을 때만 보인다),
   *   readonly 는 보여 주기만 하는가(사후정산이 완료된 출장 — 줄을 지우는 × 가 없다. `상한` 버튼은 선다),
   *   open 은 내용을 펴 둔 줄의 번호, detail 은 그 줄 아래에 펼 내용(HTML — 카드가 짓는다),
   *   changed 는 `상한` 버튼으로 정산금액을 바꾼 뒤(줄 번호, 정한 줄 — src/after.js lodgeSettle 의 결과에 비고가 바뀌었으면 comment 도)와
   *   `비고에 저장` 으로 비고를 바꾼 뒤(줄 번호, { comment }) 부르는 길
   */
  function html(ctx) {
    const { trip, trseq, kept = [], locked = false, lodging = false, readonly = false } = ctx || {};
    if (!trip || !trseq) return '';
    const s = of(trip.seq);
    if (!s.rows && !s.error) return lodging ? '<div class="at-lodges"><p class="at-lodge-note">숙박비 내역을 읽는 중...</p></div>' : '';
    const rows = s.rows || [];
    if (!rows.length && !lodging && !s.error) return '';
    const off = locked || s.busy || s.loading ? ' disabled' : '';
    const mine = { ...s.mine, ...ctx.mine };
    const sources = rows.map((r) => lodgeSource(r, mine, kept, s.logged));
    const hand = sources.filter((x) => !x).length;
    const count = !s.rows ? '' : !rows.length ? (readonly ? '없음' : '사후정산 화면에 아직 없습니다') : `${rows.length}줄${hand ? ` · 손수 작성 ${hand}줄` : ''}`;
    const head = `<div class="at-lodge-head"><strong>숙박비 내역</strong><span class="at-lodge-count">${escapeHtml(count)}</span>`
      + `<button type="button" class="small ghost at-lodge-refresh${s.loading ? ' spin' : ''}" data-act="lodge-refresh" title="${REFRESH_TITLE}" aria-label="${REFRESH_TITLE}"`
      + `${locked || s.busy || s.loading ? ' disabled' : ''}>${REFRESH_ICON}</button></div>`;
    const line = (r, i) => {
      const name = r.company || '업체명 없음';
      // 표시는 누르는 것이다(2026-10-03 사용자 지정) — 누르면 그 줄 아래에 올린 내용(손수 작성한 줄이면 화면의 값)이 펴지고, 다시 누르면 접힌다.
      // 무엇을 펴 보일지는 카드(attendpanel.js)가 정한다: ctx.open 은 펴 둔 줄 번호, ctx.detail 은 그 줄의 내용(HTML)이다.
      const open = !!ctx.detail && ctx.open === r.seq;
      const info = `data-act="lodge-info" data-lodge="${escapeHtml(r.seq)}" aria-expanded="${open}"`;
      const src = sources[i]
        ? `<button type="button" class="at-lodge-src" ${info} title="${escapeHtml(`이 패널에서 증빙(${sources[i]})으로 올린 줄입니다${INFO_HOW}`)}">증빙</button>`
        : `<button type="button" class="at-lodge-src hand" ${info} title="${HAND_TITLE}${INFO_HOW}">손수 작성</button>`;
      const del = `이 숙박 줄을 사후정산에서 지우기 — ${what(r)}`;
      // `상한` 버튼 — 실제 금액이 상한액을 넘는 원화 줄에만 선다(켜짐 = 상한액으로 정산 중). 자리는 늘 두어 줄마다 칸이 맞는다.
      // 완료된 사후정산(readonly)에도 선다 — 2026-10-06 사용자가 완료된 카드에서 "아이콘이 안 보인다"고 했다. 완료된 계산서의 금액을
      // 바꿔도 단계가 그대로인지는 실물 미확인이다(사전정산은 2026-10-05 사용자가 고쳐 저장해도 단계가 그대로였다).
      const c = lodgeCapState(r, s.actual[r.seq], s.maxes);
      const cap = !c ? '<span class="at-lodge-cap-none"></span>'
        : `<button type="button" class="at-lodge-cap${c.on ? ' on' : ''}" data-act="lodge-cap" data-lodge="${escapeHtml(r.seq)}" aria-pressed="${c.on}" `
          + `title="${escapeHtml(lodgeCapTitle(c))}" aria-label="${escapeHtml(`${CAP_LABEL} — ${lodgeCapTitle(c)}`)}"${off || !c.can ? ' disabled' : ''}>${CAP_LABEL}</button>`;
      // 업체명은 좁으면 줄임표로 잘린다(CSS) — 전체 이름은 풍선말에 있다. 박 수도 거기에 둔다.
      return `<div class="at-lodge${s.busy === r.seq ? ' busy' : ''}" data-lodge="${escapeHtml(r.seq)}">`
        + `<span class="at-leg-name">숙박 <span class="at-leg-day">${day(r.paydate)}</span></span>`
        + `<span class="at-lodge-company" title="${escapeHtml(`${name}${r.sday ? ` · ${r.sday}박` : ''}`)}">${escapeHtml(name)}</span>`
        + `<span class="at-lodge-total">${escapeHtml(lodgeAmount(r))}</span>${cap}${src}`
        + (readonly ? '' : `<button type="button" class="small ghost at-lodge-del" data-act="lodge-del" data-lodge="${escapeHtml(r.seq)}" title="${escapeHtml(del)}" aria-label="${escapeHtml(del)}"${off}>×</button>`) + '</div>'
        + (open ? `<div class="at-lodge-info">${ctx.detail(r, sources[i])}${reasonHtml(r, c, s, off)}</div>` : '');
    };
    return `<div class="at-lodges" data-seq="${escapeHtml(trip.seq)}">${head}${rows.length ? `<div class="at-lodge-rows">${rows.map(line).join('')}</div>` : ''}`
      + (s.error ? `<p class="at-lodge-note error">${escapeHtml(s.error)}</p>` : '') + '</div>';
  }

  return { html, ensure, reload, remove, toggleCap, setReason, draft, noteActual, describe, state: box };
}
