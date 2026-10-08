// 여비계산서(eclass 의 Business Trip Expense)와 말하는 길. 목록을 읽고, 사전정산 초안을 새 계산서로 올리고,
// 사전정산을 완료(확정)하고, 사후정산을 올리고 완료(확정)한다.
//
// 이 화면은 eclass 포털 안의 따로 된 앱(/BusinessTrip)이고, 포털 로그인 쿠키를 그대로 읽는다.
// 저장은 작성 화면의 폼을 그대로 제출하는 것이다 — 빈 작성 화면을 받아 그 폼의 칸(숨은 칸·요청 확인 토큰 포함)에
// 초안을 얹어 보낸다. 무엇을 얹는지는 src/travel.js 가 정한다.
//
// **저장 요청은 2026-10-02 현재 실제로 보내 본 적이 없다**(실제 계산서가 생기는 일이라 시험으로 보내지 않았다).
// 그래서 사이트의 말을 믿지 않고, 보낸 뒤 목록을 다시 읽어 새 계산서가 생겼는지로 성공을 판정한다.

import { ORIGIN } from './config.js';
import { AuthError, siteFetch, directFetch } from './net.js';
import { TRAVEL_RULES } from './travelspec.js';
import {
  parseTripList, tripListPages, tripUser, tripDocFor, tripStage, formFields, saveBody, preEditBody, parseFeeRows, pickFeeRow, parseTransRows,
  parseCalPage, STEP_PRE_WRITING, STEP_POST_WRITING, parseStayRows,
} from './travel.js';
import { afterFields, lodgeRowsOf, lodgeSame, transRowsOf } from './after.js';
import { calReport, reportTarget, reportPdf } from './calpdf.js';

const BASE =`${ORIGIN}/BusinessTrip`;
const RETURN = encodeURIComponent('/BusinessTrip/Home/List');
/** 포털 껍데기 안에서 여비계산서 목록을 여는 주소(eclass 메뉴의 Business Trip Expense). */
export const TRIP_SHELL_URL = `${ORIGIN}/eClassVer4/Common/Default?title=Business%20Trip%20Expense&menu=%2FBusinessTrip%2FbtMain.aspx&menuID=PBR000080001&newWindow=False`;

/** 계산서 한 건을 여는 주소. 목록의 줄에 달린 주소(작성 중이면 작성 화면, 끝났으면 계산서)를 그대로 쓴다. */
export const tripDocUrl = (row) => (row?.href ? `${ORIGIN}${row.href}` : TRIP_SHELL_URL);

const LOGIN = '로그인이 필요합니다. eclass 에 로그인한 뒤 다시 시도하세요.';
const looksLogin = (html) => /id="tbUserId"|Account\/Log(in|out)|You must sign in/i.test(html || '');
const toDoc = (html) => new DOMParser().parseFromString(html, 'text/html');

/**
 * 여비계산서 목록(출장기간 기준).
 * @param {{from:string,to:string}} range YYYY-MM-DD
 * @returns {Promise<{rows: object[], pages: number, me: string, via: string}>} pages 가 2 이상이면 첫 쪽만 읽은 것이다.
 *   me 는 이 화면이 아는 내 이름(목록의 출장자 칸과 같은 표기)이다
 */
export async function tripList({ from, to }) {
  const r = await siteFetch(`${BASE}/Home/List?SDate=${from}&EDate=${to}&Traveler=&CalNo=`);
  const doc = toDoc(r.html);
  const rows = parseTripList(doc);
  if (!rows) {
    if (looksLogin(r.html)) throw new AuthError(LOGIN);
    throw new Error('여비계산서 목록 화면의 모양이 다릅니다.');
  }
  return { rows, pages: tripListPages(doc), me: tripUser(doc), via: r.via };
}

/** 교통편 줄을 사이트 요금표의 같은 항목과 잇는다(같은 구간·수단·요금). 못 찾거나 못 읽으면 그대로 둔다. */
async function linkFees(plan) {
  if (!TRAVEL_RULES.transport.train.link_site_fee) return 0;
  let linked = 0;
  for (const t of plan.trans) {
    try {
      const q = `sDate=${t.date}&conCode=${String(plan.nation || '').split('|')[0]}&departure=${encodeURIComponent(t.dep)}&arrival=${encodeURIComponent(t.arr)}`;
      const hit = pickFeeRow(parseFeeRows((await siteFetch(`${BASE}/TrafficFee/Select?${q}`)).html), t);
      if (hit) { t.trseq = hit.trseq; t.revno = hit.revno; linked++; }
    } catch { /* 요금표를 못 읽어도 요금은 적혀 올라간다 */ }
  }
  return linked;
}

/**
 * 사전정산 초안을 새 여비계산서로 올린다.
 *
 * 같은 기간·같은 출장자의 계산서가 이미 있으면 올리지 않고 그것을 돌려준다(existing). 올린 뒤에는 목록을 다시 읽어
 * 새 번호가 생겼는지 확인한다 — 확인하지 못하면 던진다.
 *
 * @param {object} plan src/travel.js settlePlan 의 결과
 * @param {{emplNo:string, name?:string, onStage?:Function}} who 출장자(HR 의 사번). 이름은 여비계산서 화면이 아는 것을 먼저 쓴다
 * @returns {Promise<{row:object, existing:boolean, linked:number}>}
 */
export async function tripCreate(plan, { emplNo, name, onStage = () => {} }) {
  const range = { from: plan.sDate, to: plan.eDate };
  onStage('여비계산서 목록을 확인하는 중...');
  const before = await tripList(range);
  const me = before.me || name || '';
  const dup = tripDocFor(range, before.rows, me);
  if (dup) return { row: dup, existing: true, linked: 0 };

  onStage('여비계산서 작성 화면을 여는 중...');
  const page = await siteFetch(`${BASE}/Write?returnUrl=${RETURN}`);
  const fields = formFields(toDoc(page.html));
  if (!fields) {
    if (looksLogin(page.html)) throw new AuthError(LOGIN);
    throw new Error('여비계산서 작성 화면의 모양이 다릅니다.');
  }
  const draft = { ...plan, trans: plan.trans.map((t) => ({ ...t })) };
  const linked = await linkFees(draft);
  const body = saveBody(fields, draft, emplNo);

  onStage('여비계산서(사전정산)를 올리는 중...');
  // 저장은 한 번만 나가야 한다. 읽기가 직접 요청으로 됐으면 저장도 직접 요청으로만 보낸다(탭 경유로 되풀이하지 않는다).
  const post = page.via === 'tab' ? siteFetch : directFetch;
  await post(`${BASE}/Write/Save`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body,
  });

  const known = new Set(before.rows.map((r) => r.seq));
  const after = await tripList(range);
  const made = after.rows.filter((r) => !known.has(r.seq));
  const row = tripDocFor(range, made, me) || tripDocFor(range, made);
  if (!row) throw new Error('저장을 보냈지만 목록에서 새 여비계산서를 확인하지 못했습니다. eclass 의 여비계산서 목록에서 확인해 주세요.');
  return { row, existing: false, linked };
}

/* ------------------------------------------------------------ 사전정산 완료(확정) */

/** 계산서 화면 주소. trseq 를 주면 그 출장자의 계산서다. */
export const tripCalUrl = (seq, trseq = '') => `${BASE}/CalPrint?seq=${seq}${trseq ? `&trseq=${trseq}` : ''}&returnUrl=${RETURN}`;

/** 계산서 화면을 열어 지금 단계와 확정 폼을 읽는다(src/travel.js parseCalPage). 내 계산서의 화면을 돌려준다. */
async function openCal(row, name) {
  const open = async (trseq) => {
    const page = await siteFetch(tripCalUrl(row.seq, trseq));
    const cal = parseCalPage(toDoc(page.html));
    if (!cal) {
      if (looksLogin(page.html)) throw new AuthError(LOGIN);
      throw new Error('계산서 화면의 모양이 다릅니다.');
    }
    return { page, cal };
  };
  const first = await open('');
  // 출장자가 여럿이면 화면은 첫 사람의 계산서를 연다. 내 것이 아니면 내 것으로 다시 연다.
  const mine = first.cal.travelers.find((t) => t.name === name);
  return mine?.trseq && !mine.selected ? open(mine.trseq) : first;
}

/** 계산서 화면의 확정 폼을 그대로 제출한다(CalPrint/Confirm). 폼이 이 계산서의 것이 아니면 보내지 않고 던진다. */
async function sendConfirm(row, page, cal) {
  const form = Object.fromEntries(cal.confirm);
  if (form.seq !== String(row.seq) || !form.trseq || !form.__RequestVerificationToken) {
    throw new Error('계산서 화면의 확정 폼이 이 계산서의 것이 아니어서 보내지 않았습니다. eclass 의 계산서 화면에서 확정해 주세요.');
  }
  // 확정은 한 번만 나가야 한다. 읽기가 직접 요청으로 됐으면 확정도 직접 요청으로만 보낸다(탭 경유로 되풀이하지 않는다).
  const post = page.via === 'tab' ? siteFetch : directFetch;
  await post(`${BASE}/CalPrint/Confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams(cal.confirm).toString(),
  });
}

/**
 * 사전정산을 완료한다 — 계산서 화면의 **확정** 버튼을 누른 것과 같은 요청이다(CalPrint/Confirm 에 seq·trseq·요청 확인 토큰,
 * 2026-10-03 실제 화면에서 읽었다). 사후정산을 올리거나 증빙을 담당자에게 보내려면 사전정산이 완료돼 있어야 한다(사용자 지정).
 *
 * 화면의 단계가 "사전정산 작성"이고 확정 폼이 이 계산서의 것일 때만 보낸다 — 다른 단계의 확정(있다면 사후정산)을 대신 누르지 않는다.
 * 확정할 것이 없으면 보내지 않고 목록으로 이미 완료됐는지만 본다. 보낸 뒤에도 사이트의 말을 믿지 않고 목록을 다시 읽어
 * 사전정산이 "완료"가 됐는지로 성공을 판정한다 — 아니면 던진다.
 *
 * 2026-10-03 사용자가 출장 카드에 증빙을 넣었을 때 실제로 나갔고 됐다(계산서 143884 — 활동 기록에 "사전정산 완료(확정)").
 *
 * @param {object} row 여비계산서 목록의 한 줄
 * @param {{name?:string, onStage?:Function}} who name 은 목록 화면이 아는 내 이름(출장자가 여럿일 때 내 계산서를 고른다)
 * @returns {Promise<{row: object, stage: object, sent: boolean}>} row 는 다시 읽은 줄(출장자 번호가 이때 생긴다), sent 는 확정을 보냈는가
 */
export async function tripPreConfirm(row, { name = '', onStage = () => {} } = {}) {
  onStage('계산서 화면을 여는 중...');
  const { page, cal } = await openCal(row, name);
  const sent = cal.step === STEP_PRE_WRITING && !!cal.confirm;
  if (sent) {
    onStage('사전정산을 완료(확정)하는 중...');
    await sendConfirm(row, page, cal);
  }

  const after = await tripList({ from: row.from, to: row.to });
  const fresh = after.rows.find((r) => r.seq === row.seq) || null;
  const stage = fresh ? tripStage(fresh, after.me || name) : null;
  if (!stage || (stage.phase === 'pre' && !stage.done)) {
    throw new Error(sent
      ? '확정을 보냈지만 목록의 사전정산이 완료로 바뀌지 않았습니다. eclass 의 계산서 화면에서 확인해 주세요.'
      : `계산서 화면에 사전정산 확정 버튼이 없습니다(지금 단계: ${cal.step || '알 수 없음'}). eclass 의 계산서 화면에서 확인해 주세요.`);
  }
  return { row: fresh, stage, sent };
}

/**
 * 사후정산을 완료한다 — 사후정산을 저장해 단계가 "사후정산 작성"이 된 계산서 화면의 **확정**을 누르는 요청이다(사전정산과 같은
 * CalPrint/Confirm). 여비증빙 송부 칸의 `보내기`가 사후정산을 저장한 뒤에 부른다(2026-10-03 사용자 지정: "저장 후 확정 후 보내기").
 *
 * "사후정산 작성" 단계의 계산서 화면은 2026-10-04 에 실제 화면(145580 — 사용자가 송부 칸의 `사후정산 저장`을 누른 뒤)을 읽어 확인했다:
 * 사전정산 때와 같은 확정 폼(action CalPrint/Confirm, 칸 seq·trseq·토큰, onsubmit 에 confirm)이 삭제 폼 옆에 선다. 아래는 그 전에 본 것이다 —
 * 사전정산 완료(145580)와 사후정산 완료(143884·141851)의 화면에는 확정 폼이 없고 삭제 폼뿐이며, 단계 줄은 지금 도달한 단계가 켜진다.
 * 143884 는 패널이 사후정산을 올린 직후 목록에서 "작성"이었다가, 패널이 보낸 것 없이 "완료"가 됐다. 그래서 사전정산과 같은 자리에
 * 확정 폼이 선다고 보고 지었다: 화면의 단계가 "사후정산 작성"이고 확정 폼이 이 계산서의 것일 때만 보내고, 폼이 없으면 보내지 않는다.
 * 보낸 뒤에도 목록을 다시 읽어 사후정산이 "완료"가 됐는지로 성공을 판정한다 — 아니면 던진다. **실제로 보내 본 적이 없다.**
 *
 * @param {object} row 여비계산서 목록의 한 줄
 * @param {{name?:string, onStage?:Function}} who name 은 목록 화면이 아는 내 이름(출장자가 여럿일 때 내 계산서를 고른다)
 * @returns {Promise<{row: object, stage: object, sent: boolean}>} sent 는 확정을 보냈는가(이미 완료돼 있었으면 false)
 */
export async function tripPostConfirm(row, { name = '', onStage = () => {} } = {}) {
  onStage('계산서 화면을 여는 중...');
  const { page, cal } = await openCal(row, name);
  const sent = cal.step === STEP_POST_WRITING && !!cal.confirm;
  if (sent) {
    onStage('사후정산을 완료(확정)하는 중...');
    await sendConfirm(row, page, cal);
  }

  const after = await tripList({ from: row.from, to: row.to });
  const fresh = after.rows.find((r) => r.seq === row.seq) || null;
  const stage = fresh ? tripStage(fresh, after.me || name) : null;
  if (!stage || !(stage.phase === 'post' && stage.done)) {
    throw new Error(sent
      ? '확정을 보냈지만 목록의 사후정산이 완료로 바뀌지 않았습니다. eclass 의 계산서 화면에서 확인해 주세요.'
      : `계산서 화면에 사후정산 확정 버튼이 없습니다(지금 단계: ${cal.step || '알 수 없음'}). eclass 의 계산서 화면에서 확정해 주세요.`);
  }
  return { row: fresh, stage, sent };
}

/* ------------------------------------------------------------ 계산서 삭제(출장 취소) */

/**
 * 여비계산서를 지운다 — 계산서 화면의 **삭제** 버튼을 누른 것과 같은 요청이다(CalPrint/Delete 에 seq·요청 확인 토큰).
 * 출장을 취소하면 사전정산까지 계산서를 지운다(2026-10-07 사용자 지정: "출장 취소 하면 여비계산 내용은 사전정산까지 제거").
 *
 * 삭제 폼은 출장자를 가리지 않고 계산서 전체를 지운다 — 다른 출장자가 함께 있는 계산서면 보내지 않고 던진다. 사후정산까지 끝난
 * 계산서도 지우지 않는다(정산이 끝난 것을 패널이 지우지 않는다 — eclass 에서 정리한다). 보낸 뒤에는 목록을 다시 읽어 그 계산서가
 * 사라졌는지로 성공을 판정한다 — 아니면 던진다. **실제로 보내 본 적이 없다.**
 *
 * @param {object} row 여비계산서 목록의 한 줄
 * @param {{name?:string, onStage?:Function}} who name 은 목록 화면이 아는 내 이름
 * @returns {Promise<{seq: string}>}
 */
export async function tripDelete(row, { name = '', onStage = () => {} } = {}) {
  const others = (row.travelers || []).filter((t) => t.name && t.name !== name);
  if (name && others.length) {
    throw new Error(`여비계산서 ${row.seq} 에 다른 출장자(${others.map((t) => t.name).join(', ')})가 있어 지우지 않았습니다. eclass 에서 정리해 주세요.`);
  }
  const stage = tripStage(row, name);
  if (stage?.phase === 'post' && stage.done) {
    throw new Error(`여비계산서 ${row.seq} 은(는) 사후정산까지 끝나 지우지 않았습니다. eclass 에서 정리해 주세요.`);
  }
  onStage('계산서 화면을 여는 중...');
  const { page, cal } = await openCal(row, name);
  const form = Object.fromEntries(cal.del || []);
  if (form.seq !== String(row.seq) || !form.__RequestVerificationToken) {
    throw new Error('계산서 화면의 삭제 폼이 이 계산서의 것이 아니어서 보내지 않았습니다. eclass 의 계산서 화면에서 지워 주세요.');
  }
  onStage(`여비계산서 ${row.seq} 을(를) 지우는 중...`);
  // 삭제는 한 번만 나가야 한다. 읽기가 직접 요청으로 됐으면 삭제도 직접 요청으로만 보낸다(탭 경유로 되풀이하지 않는다).
  const post = page.via === 'tab' ? siteFetch : directFetch;
  await post(`${BASE}/CalPrint/Delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams(cal.del).toString(),
  });
  const after = await tripList({ from: row.from, to: row.to });
  if (after.rows.some((r) => r.seq === row.seq)) {
    throw new Error(`삭제를 보냈지만 여비계산서 ${row.seq} 이(가) 목록에 그대로 있습니다. eclass 의 여비계산서 목록에서 확인해 주세요.`);
  }
  return { seq: String(row.seq) };
}

/* ------------------------------------------------------------ 계산서 출력(PDF) */

/**
 * 여비계산서를 PDF 로 받는다 — 계산서 화면을 열어 인쇄(PDF)한 것과 같다(src/calpdf.js). 담당자에게 증빙을 보낼 때 그 앞에 붙인다
 * (2026-10-04 사용자 지정: "확정한 다음에 출력해서 증빙들과 합쳐서 보내야지"). 계산서의 값은 바뀌지 않는다.
 * 화면이 부르는 리포트가 이 계산서의 것이 아니면 받지 않고 던진다.
 * @param {object} row 여비계산서 목록의 한 줄
 * @param {{name?:string, onStage?:Function}} who name 은 목록 화면이 아는 내 이름(출장자가 여럿일 때 내 계산서를 고른다)
 * @returns {Promise<{bytes: Uint8Array, pages: number}>}
 */
export async function tripCalPdf(row, { name = '', onStage = () => {} } = {}) {
  onStage('계산서 화면을 여는 중...');
  const { page, cal } = await openCal(row, name);
  const report = calReport(page.html);
  if (!report) throw new Error('계산서 화면에서 출력할 리포트를 찾지 못했습니다.');
  const target = reportTarget(report.param);
  const mine = cal.travelers.find((t) => t.name === name);
  if (target.seq !== String(row.seq) || (mine?.trseq && target.trseq !== mine.trseq)) {
    throw new Error('계산서 화면의 리포트가 이 계산서(내 출장자 번호)의 것이 아니어서 받지 않았습니다.');
  }
  return reportPdf(report, { onStage });
}

/* ------------------------------------------------------------ 사후정산 */

/** 사후정산 입력 화면 주소(출장자 하나). */
export const tripAfterUrl = (seq, trseq) => `${BASE}/AfterTrip?seq=${seq}&trseq=${trseq}`;
/** 사전정산 입력 화면(고치기) 주소 — 계산서 화면의 `사전정산 입력` 링크와 같다. */
export const tripPreUrl = (seq) => `${BASE}/Write?seq=${seq}&mode=E&returnUrl=${RETURN}`;

/**
 * 사전정산 작성 화면(고치기)에서 교통편 줄을 읽는다 — 출장 카드의 가는 편·오는 편이 처음에 이것대로 골라지고,
 * 비행기를 탔는지(사후정산 조건: 비행기 또는 1박)도 여기서 본다. 읽기만 한다.
 * 출장의 출발 시·도착 시(sHour·eHour)도 같이 읽는다 — 사후정산의 KTX 줄에 출발·도착 시각을 적을 때 쓴다(src/travel.js 의 legTimes).
 * 일비·식비 줄(stays)과 출장기간 구분(period)도 읽는다 — 출장 카드가 일비·식비 한 줄을 적고 식수를 고칠 때 쓴다(src/travel.js 의 stayPlan).
 * @returns {Promise<{rows: object[], transports: string[], plane: boolean, sHour: number|null, eHour: number|null, stays: object[], period: string}>}
 *   rows 는 src/travel.js parseTransRows 의 줄, stays 는 parseStayRows 의 줄이다. sHour·eHour 는 화면에서 못 읽으면 null
 */
export async function tripPreDetail(seq) {
  const r = await siteFetch(tripPreUrl(seq));
  const doc = toDoc(r.html);
  if (!doc.querySelector('form#frm')) {
    if (looksLogin(r.html)) throw new AuthError(LOGIN);
    throw new Error('여비계산서 작성 화면의 모양이 다릅니다.');
  }
  const rows = parseTransRows(doc);
  const transports = rows.map((r) => r.transport).filter(Boolean);
  const fields = formFields(doc) || [];
  const hour = (name) => { const v = fields.find(([n]) => n === name)?.[1]; return /^\d{1,2}$/.test(v ?? '') ? +v : null; };
  return {
    rows, transports, plane: transports.includes('Airplane'), sHour: hour('sHour'), eHour: hour('eHour'),
    stays: parseStayRows(doc), period: fields.find(([n]) => n === 'period')?.[1] ?? '',
  };
}

/**
 * 사전정산을 **다시 저장한다**(2026-10-05 사용자 지정: "사전정산 다시하기") — 계산서 화면의 `사전정산 입력`으로 들어가 교통편 줄을 고치고
 * `저장`을 누른 것과 같다. 사전정산 입력 화면(고치기)의 폼을 받아, 바꾼 편이 있으면 화면에 있던 교통편 줄을 지움 표시하고 가는 편·오는 편의
 * 줄을 차례대로 다시 얹어 그대로 제출한다(src/travel.js 의 prePlan·preEditBody — 바꾸지 않은 편의 줄은 값 그대로 다시 들어간다).
 * 카드에서 식수를 고쳤으면(plan.meals — src/travel.js 의 stayPlan, 2026-10-05 사용자 지정) 그 일비·식비 줄의 식수 칸도 바꿔 보낸다.
 * 바꾼 것이 없으면 화면에 있는 그대로 다시 저장한다.
 *
 * 2026-10-05 실제 화면(145580 — 사전·사후정산 모두 완료)을 읽어 확인한 것: 완료된 계산서 화면에도 `사전정산 입력` 링크가 있고, 그 화면의
 * 폼(Write/Save)과 `저장` 버튼이 그대로 선다. **저장을 받은 사이트가 단계를 어떻게 하는지(사전정산 작성으로 되돌리는지)는 모른다 —
 * 실제로 보내 본 적이 없다.** 그래서 사이트의 말을 믿지 않고, 보낸 뒤 화면을 다시 읽어 교통편 줄(과 고친 식수)이 바뀌었는지로 성공을 판정하고,
 * 목록을 다시 읽어 **지금의 단계를 그대로** 돌려준다(패널은 그 단계대로 카드를 그린다).
 *
 * @param {object} row 여비계산서 목록의 한 줄
 * @param {{drop: string[], add: object[], set?: Object<string,object>|null, meals?: Object<string,number>|null}} plan src/travel.js prePlan 의 결과
 *   (set 은 교통편은 그대로 두고 일자·출발 시·도착 시만 고친 줄 — 그 줄의 칸만 바꿔 보낸다). meals 는 식수를 고칠
 *   일비·식비 줄({줄 번호: 식수} — stayPlan 의 set)
 * @param {{name?:string, onStage?:Function}} who name 은 목록 화면이 아는 내 이름
 * @returns {Promise<{row: object, stage: object, detail: object, linked: number}>} detail 은 다시 읽은 사전정산의 교통편(tripPreDetail)
 */
export async function tripPreSave(row, plan, { name = '', onStage = () => {} } = {}) {
  onStage('사전정산 입력 화면을 여는 중...');
  const page = await siteFetch(tripPreUrl(row.seq));
  const doc = toDoc(page.html);
  const fields = formFields(doc);
  if (!fields) {
    if (looksLogin(page.html)) throw new AuthError(LOGIN);
    throw new Error('여비계산서 작성 화면의 모양이 다릅니다.');
  }
  const add = plan.add.map((t) => ({ ...t }));
  // 새로 지은 줄만 사내 요금표와 잇는다 — 값 그대로 다시 넣는 줄(바꾸지 않은 편)은 화면에 있던 이음(tr_trseq)을 그대로 둔다.
  const linked = await linkFees({ trans: add.filter((t) => !t.trseq), nation: fields.find(([n]) => n === 'nationCD')?.[1] });
  const meals = plan.meals && Object.keys(plan.meals).length ? plan.meals : null;
  const body = preEditBody(fields, row.seq, { drop: plan.drop, add, meals, set: plan.set || null });
  // 칸만 고친 줄(일자·출발 시·도착 시 — plan.set)이 저장한 뒤에 서 있어야 할 모양.
  const fixed = parseTransRows(doc).filter((r) => plan.set?.[r.seq]).map((r) => ({ ...r, ...plan.set[r.seq] }));
  // 저장한 뒤에 화면에 서 있어야 할 식수의 합 — 사이트가 줄의 번호를 새로 매기더라도 합으로는 가릴 수 있다.
  const mealSum = (stays, set = {}) => stays.reduce((n, s) => n + (s.seq in set ? Number(set[s.seq]) : s.meal), 0);
  const wantMeals = meals ? mealSum(parseStayRows(doc), meals) : null;

  onStage('여비계산서(사전정산)를 다시 저장하는 중...');
  // 저장은 한 번만 나가야 한다. 읽기가 직접 요청으로 됐으면 저장도 직접 요청으로만 보낸다(탭 경유로 되풀이하지 않는다).
  const post = page.via === 'tab' ? siteFetch : directFetch;
  await post(`${BASE}/Write/Save`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body,
  });

  const detail = await tripPreDetail(row.seq);
  const hr = (v) => Number(v) || 0;
  const same = (r, t) => r.date === t.date && r.dep === t.dep && r.arr === t.arr && r.transport === t.transport && Number(r.total) === Number(t.total)
    && hr(r.shr) === hr(t.shr) && hr(r.ehr) === hr(t.ehr);
  if (plan.drop.some((seq) => detail.rows.some((r) => r.seq === String(seq))) || [...add, ...fixed].some((t) => !detail.rows.some((r) => same(r, t)))) {
    throw new Error('저장을 보냈지만 사전정산의 교통편이 바뀌지 않았습니다. eclass 의 사전정산 입력 화면에서 확인해 주세요.');
  }
  if (wantMeals != null && mealSum(detail.stays) !== wantMeals) {
    throw new Error('저장을 보냈지만 사전정산의 식수가 바뀌지 않았습니다. eclass 의 사전정산 입력 화면에서 확인해 주세요.');
  }
  const after = await tripList({ from: row.from, to: row.to });
  const fresh = after.rows.find((r) => r.seq === row.seq) || null;
  if (!fresh) throw new Error('저장을 보냈지만 목록에서 그 여비계산서를 찾지 못했습니다. eclass 의 여비계산서 목록에서 확인해 주세요.');
  return { row: fresh, stage: tripStage(fresh, after.me || name), detail, linked };
}

/**
 * 숙박비 상한(화면이 줄마다 조회해 숨은 칸에 넣는 값). 못 읽으면 빈 값 — 계산서는 그래도 올라간다.
 * maxtotal 은 1일 상한(그 나라의 화폐 maxcur), maxconv 는 그것을 줄의 화폐로 바꾼 값이다(2026-10-03 실제 응답: 국내·원화면
 * 120000 KRW·RATE 1·120000, 국내·달러면 RATE 와 MAXAMT_CUR 가 빈 글). 패널은 올리기 전에 이것으로 상한액 초과를 가린다(src/after.js lodgeAsk).
 */
export async function tripLodgeMax(trseq, nation, currency) {
  try {
    const q = `trseq=${encodeURIComponent(trseq)}&nationCD=${encodeURIComponent(nation)}&currency=${encodeURIComponent(currency)}`;
    const { html } = await siteFetch(`${BASE}/Api/CalMaxLodge?${q}`);
    const node = new DOMParser().parseFromString(html, 'text/xml').querySelector('NODE');
    if (!node) return {};
    return { maxtotal: node.getAttribute('MAXAMT') || '', maxcur: node.getAttribute('CURRENCY') || '', maxrate: node.getAttribute('RATE') || '', maxconv: node.getAttribute('MAXAMT_CUR') || '' };
  } catch {
    return {};
  }
}

/** data URL 을 Blob 으로. 사후정산 폼의 첨부(lodge_file)에 쓴다. */
function blobOf(file) {
  const bin = atob(String(file.dataUrl || '').split(',')[1] || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: file.type || 'application/octet-stream' });
}

/**
 * 사후정산을 올린다 — 사후정산 입력 화면의 폼을 받아 그 칸에 숙박비·교통비·항공 마일리지(src/after.js)를 얹어 그대로 제출한다(multipart).
 * 교통비 줄을 올릴 때는 화면에 있던 교통 줄을 지움 표시하고 새 줄(가는 편·오는 편)로 바꾼다(afterFields).
 * 올린 뒤 목록을 다시 읽어 그 출장자의 사후정산이 "작성" 이상이 됐는지로 성공을 판정한다.
 *
 * 화면에 **같은 숙박 줄**(결제일·업체명·숙박 일수·정산금액이 같은 줄)이 이미 있으면 그 줄은 다시 올리지 않는다(same) —
 * 같은 증빙을 두 번 넣으면 줄이 겹쳐 올라갔다. 올릴 것이 하나도 안 남으면 보내지 않는다(sent = false).
 * 올린 뒤에는 화면을 다시 읽어 이번에 새로 생긴 숙박 줄(lodgeRows — 줄 번호 seq 가 있다)을 돌려준다. 패널이 그 번호로
 * "이 패널이 올린 줄"을 가린다.
 *
 * 2026-10-03 사용자가 출장 카드에 증빙을 넣어 실제로 올렸다(계산서 143884 에 숙박 줄이 생겼다). 그때 같이 보낸 첨부(lodge_file)는
 * 서버에 남지 않았다 — 다시 읽은 줄의 lodge_oldfile 이 빈 글이었다. 그래서 첨부가 붙었는지는 다시 읽은 줄(oldfile)로만 말한다.
 *
 * @param {object} row 여비계산서 목록의 한 줄
 * @param {string} trseq 출장자 번호(목록의 traveler.trseq)
 * @param {object} plan src/after.js afterPlan 의 결과
 * @param {{name?:string, onStage?:Function, always?:boolean}} who always 를 주면 새로 올릴 것이 없어도 화면의 폼을 그대로 저장한다 —
 *   입력 화면의 `저장` 버튼만 누른 것과 같다(여비증빙 송부 칸의 `보내기`: 단계가 "사후정산 작성"이 돼야 확정할 수 있다)
 * @returns {Promise<{row: object, stage: object, sent: boolean, same: object[], lodgeRows: object[], lodgeSeqs: string[]}>}
 */
export async function tripAfterSave(row, trseq, plan, { name = '', onStage = () => {}, always = false } = {}) {
  if (!trseq) throw new Error('출장자 번호(trseq)를 여비계산서 목록에서 읽지 못했습니다.');
  onStage('사후정산 입력 화면을 여는 중...');
  const page = await siteFetch(tripAfterUrl(row.seq, trseq));
  const fields = formFields(toDoc(page.html));
  if (!fields) {
    if (looksLogin(page.html)) throw new AuthError(LOGIN);
    throw new Error('사후정산 입력 화면의 모양이 다릅니다.');
  }
  // 첨부가 있는 폼(multipart)은 탭을 거쳐 보낼 수 없다. 직접 요청이 막힌 환경이면 화면에서 올리게 한다.
  if (page.via === 'tab') throw new Error('확장의 직접 요청이 막혀 사후정산을 올리지 못했습니다. eclass 의 사후정산 입력 화면에서 올려 주세요.');
  // 상한은 패널이 올리기 전에 읽어 붙여 둔다(상한액 초과를 묻느라). 안 붙어 있을 때만 여기서 읽는다.
  for (const l of plan.lodge) if (l.maxtotal == null) Object.assign(l, await tripLodgeMax(trseq, l.nation, l.currency));
  const had = lodgeRowsOf(fields);
  const same = plan.lodge.filter((l) => had.some((h) => lodgeSame(l, h)));
  const send = same.length ? { ...plan, lodge: plan.lodge.filter((l) => !same.includes(l)) } : plan;
  if (!always && !send.lodge.length && !send.trans.length && !send.air) {
    return { row, stage: tripStage(row, name), sent: false, same, lodgeRows: [], lodgeSeqs: [] };
  }
  const body = new FormData();
  for (const [key, value] of afterFields(fields, send)) {
    if (value && typeof value === 'object' && value.file) body.append(key, blobOf(value.file), value.file.name || 'receipt');
    else body.append(key, value ?? '');
  }
  onStage('여비계산서(사후정산)를 올리는 중...');
  await directFetch(`${BASE}/AfterTrip/Save`, { method: 'POST', body });

  const after = await tripList({ from: row.from, to: row.to });
  const fresh = after.rows.find((r) => r.seq === row.seq) || null;
  const stage = fresh ? tripStage(fresh, after.me || name) : null;
  if (!stage || stage.phase !== 'post') throw new Error('저장을 보냈지만 목록의 사후정산이 바뀌지 않았습니다. eclass 의 여비계산서에서 확인해 주세요.');
  // 이번에 새로 생긴 숙박 줄. 못 읽어도 저장은 된 것이라 던지지 않는다 — 줄 번호만 모른다.
  let lodgeRows = [];
  if (send.lodge.length) {
    let read = false;
    try {
      const known = new Set(had.map((h) => h.seq));
      const again = formFields(toDoc((await siteFetch(tripAfterUrl(row.seq, trseq))).html));
      if (again) {
        lodgeRows = lodgeRowsOf(again).filter((h) => h.seq && h.del !== '1' && !known.has(h.seq));
        read = true;
      }
    } catch { /* 줄 번호를 몰라도 저장은 됐다 */ }
    // 화면을 다시 읽었는데 새 줄이 하나도 없으면 사이트가 받지 않은 것이다 — 올렸다고 하지 않는다. 완료한 사후정산을 다시 작성할 때
    // 사이트가 저장을 받아 주는지는 실제로 보내 본 적이 없다(2026-10-04) — 받지 않으면 여기서 드러난다.
    if (read && !lodgeRows.length) throw new Error('저장을 보냈지만 사후정산 화면에 숙박 줄이 생기지 않았습니다. eclass 의 사후정산 입력 화면에서 확인해 주세요.');
  }
  return { row: fresh, stage, sent: true, same, lodgeRows, lodgeSeqs: lodgeRows.map((h) => h.seq) };
}

/* ------------------------------------------------------------ 사후정산의 숙박 줄 (출장 카드의 숙박 줄 목록 — lodgebox.js) */

/** 사후정산 입력 화면을 열어 그 폼의 칸을 읽는다. 그 화면이 아니면 던진다. */
async function afterForm(seq, trseq) {
  if (!trseq) throw new Error('출장자 번호(trseq)를 여비계산서 목록에서 읽지 못했습니다.');
  const page = await siteFetch(tripAfterUrl(seq, trseq));
  const fields = formFields(toDoc(page.html));
  if (!fields) {
    if (looksLogin(page.html)) throw new AuthError(LOGIN);
    throw new Error('사후정산 입력 화면의 모양이 다릅니다.');
  }
  return { fields, via: page.via };
}

/** 저장돼 있는 숙박 줄만 — 줄 번호가 있고 지움 표시가 없는 것. */
const savedLodges = (fields) => lodgeRowsOf(fields).filter((r) => r.seq && r.del !== '1');

/**
 * 사후정산 입력 화면에 **지금 있는** 숙박 줄 전부(2026-10-03 사용자 지정 — 패널이 올린 줄만이 아니라 화면에서 손수 적은 줄까지
 * 출장 카드에 보인다). 읽기만 한다.
 * @returns {Promise<Record<string,string>[]>} src/after.js lodgeRowsOf 의 줄(값은 화면 그대로의 글), 화면의 차례대로
 */
export async function tripAfterLodges(seq, trseq) {
  return savedLodges((await afterForm(seq, trseq)).fields);
}

/**
 * 사후정산 입력 화면에 지금 있는 숙박 줄과 교통 줄 — 출장 카드의 숙박비 내역(lodgebox.js)이 한 번 읽어 둘 다 담는다. 읽기만 한다.
 * 교통 줄(trans)은 사후정산에 따로 올린 편이다(저장돼 있고 수단이 적힌 줄만) — 없으면 사전정산의 교통편이 그대로 선다
 * (2026-10-04 실제 화면 143884: 사후정산 완료, 교통 줄 없음). 사후정산이 완료된 출장의 카드가 이것으로 가는 편·오는 편을 그린다.
 * @returns {Promise<{lodges: Record<string,string>[], trans: object[]}>} trans 는 src/after.js transRowsOf 의 줄
 */
export async function tripAfterRows(seq, trseq) {
  const { fields } = await afterForm(seq, trseq);
  return { lodges: savedLodges(fields), trans: transRowsOf(fields).filter((r) => r.seq && r.del !== '1' && r.transport) };
}

/**
 * 사후정산의 숙박 줄 하나를 지운다 — 입력 화면에서 그 줄의 × 를 누르고 저장한 것과 같다(화면의 delRow 가 하듯 그 줄의
 * lodge_del 을 1 로 바꾸고 폼을 그대로 제출한다, 2026-10-03 화면 소스에서 확인). 나머지 칸은 화면에 있던 값 그대로 다시 나간다.
 * 보낸 뒤 화면을 다시 읽어 그 줄이 없어졌는지로 성공을 판정한다 — 그대로 있으면 던진다.
 *
 * **2026-10-03 현재 실제로 보내 본 적이 없다**(실제 계산서의 줄이 지워지는 일이라 시험으로 보내지 않았다).
 *
 * @param {string} lodgeSeq 지울 줄의 번호(lodge_seq)
 * @returns {Promise<Record<string,string>[]>} 지운 뒤 화면에 남은 숙박 줄
 */
export async function tripAfterLodgeDelete(seq, trseq, lodgeSeq) {
  const { fields, via } = await afterForm(seq, trseq);
  // 같은 이름의 칸이 줄마다 되풀이된다 — lodge_nation 이 줄의 시작이고, 그 줄의 번호가 맞으면 그 줄의 lodge_del 이 바꿀 칸이다.
  let at = -1;
  let row = null;
  for (const [i, [name, value]] of fields.entries()) {
    if (name === 'lodge_nation') row = { seq: '', del: -1 };
    else if (row && name === 'lodge_seq') row.seq = value;
    else if (row && name === 'lodge_del') row.del = value === '1' ? -1 : i;
    if (row && row.seq === String(lodgeSeq) && row.del >= 0) { at = row.del; break; }
  }
  if (at < 0) throw new Error('그 숙박 줄이 사후정산 화면에 없습니다(이미 지워졌을 수 있습니다). 새로 읽어 주세요.');
  // 화면의 폼은 multipart 다. 탭을 거쳐서는 보낼 수 없다 — 직접 요청이 막힌 환경이면 화면에서 지우게 한다.
  if (via === 'tab') throw new Error('확장의 직접 요청이 막혀 숙박 줄을 지우지 못했습니다. eclass 의 사후정산 입력 화면에서 지워 주세요.');
  const body = new FormData();
  for (const [i, [name, value]] of fields.entries()) body.append(name, i === at ? '1' : value ?? '');
  await directFetch(`${BASE}/AfterTrip/Save`, { method: 'POST', body });

  const left = await tripAfterLodges(seq, trseq);
  if (left.some((r) => r.seq === String(lodgeSeq))) {
    throw new Error('삭제를 보냈지만 그 줄이 사후정산 화면에 그대로 있습니다. eclass 의 사후정산 입력 화면에서 확인해 주세요.');
  }
  return left;
}

/**
 * 사후정산의 숙박 줄 하나의 정산금액(공급가액·부가세까지)을 바꾼다 — 입력 화면에서 그 줄의 세 칸을 고치고 저장한 것과 같다
 * (그 줄의 lodge_total·lodge_samount·lodge_vat 만 바꾸고 폼을 그대로 제출한다). 출장 카드 숙박비 내역의 `상한` 버튼이
 * 상한액과 실제 금액 사이를 오갈 때 쓴다(lodgebox.js). 비고(comment)를 같이 주면 그 줄의 lodge_comment 도 바꾼다 — 상한액을 넘겨
 * 실제 금액으로 되돌릴 때 상한 초과 사유를 적고, 상한액으로 낮출 때 걷는다(2026-10-08 사용자 지정). 보낸 뒤 화면을 다시 읽어
 * 정산금액(과 비고)이 바뀌었는지로 성공을 판정한다 — 그대로면 던진다.
 *
 * **2026-10-06 현재 실제로 보내 본 적이 없다**(실제 계산서의 금액이 바뀌는 일이라 시험으로 보내지 않았다).
 *
 * @param {string} lodgeSeq 바꿀 줄의 번호(lodge_seq)
 * @param {{total:number, samount:number, vat:number, comment?:string}} amount 원 단위의 수(src/after.js lodgeSettle 이 셈한 것)와, 바꿀 때만 비고 글
 * @returns {Promise<Record<string,string>[]>} 바꾼 뒤 화면의 숙박 줄
 */
export async function tripAfterLodgeAmount(seq, trseq, lodgeSeq, { total, samount, vat, comment }) {
  const put = { total, samount, vat, ...(typeof comment === 'string' ? { comment } : {}) };
  return putLodgeFields(seq, trseq, lodgeSeq, put, '정산금액', (row) => {
    if (Number(String(row.total ?? '').replace(/,/g, '')) !== Number(total)) return '정산금액이 바뀌지 않았습니다';
    if (typeof comment === 'string' && String(row.comment ?? '').trim() !== comment.trim()) return '비고가 바뀌지 않았습니다';
    return '';
  });
}

/**
 * 사후정산의 숙박 줄 하나의 비고(lodge_comment)만 바꾼다 — 입력 화면에서 그 줄의 비고를 고치고 저장한 것과 같다. 출장 카드 숙박비
 * 내역에서 상한액을 넘긴 줄의 상한 초과 사유를 고쳐 쓸 때 쓴다(lodgebox.js, 2026-10-08 사용자 지정: "수정 가능하게 해줘").
 * 보낸 뒤 화면을 다시 읽어 비고가 바뀌었는지로 성공을 판정한다 — 그대로면 던진다.
 *
 * **2026-10-08 현재 실제로 보내 본 적이 없다.**
 * @returns {Promise<Record<string,string>[]>} 바꾼 뒤 화면의 숙박 줄
 */
export async function tripAfterLodgeComment(seq, trseq, lodgeSeq, comment) {
  const want = String(comment ?? '').trim();
  return putLodgeFields(seq, trseq, lodgeSeq, { comment: want }, '비고', (row) => (String(row.comment ?? '').trim() !== want ? '비고가 바뀌지 않았습니다' : ''));
}

/**
 * 그 숙박 줄의 칸 몇 개(lodge_ 뒤의 이름 → 값)만 바꿔 폼을 그대로 제출하고, 화면을 다시 읽어 check 로 바뀌었는지 본다.
 * check 는 다시 읽은 그 줄을 받아 안 바뀐 까닭을 돌려준다(빈 글이면 됐다). what 은 잘못을 말할 때 부르는 이름이다.
 */
async function putLodgeFields(seq, trseq, lodgeSeq, put, what, check) {
  const { fields, via } = await afterForm(seq, trseq);
  const at = lodgeFieldsAt(fields, lodgeSeq);
  if (!at) throw new Error('그 숙박 줄이 사후정산 화면에 없습니다(이미 지워졌을 수 있습니다). 새로 읽어 주세요.');
  const keys = Object.keys(put);
  if (keys.some((k) => at[k] == null)) throw new Error(`사후정산 입력 화면의 숙박 줄 모양이 다릅니다(${what} 칸).`);
  if (via === 'tab') throw new Error(`확장의 직접 요청이 막혀 ${what}을 바꾸지 못했습니다. eclass 의 사후정산 입력 화면에서 고쳐 주세요.`);
  const values = new Map(keys.map((k) => [at[k], put[k]]));
  const body = new FormData();
  for (const [i, [name, value]] of fields.entries()) body.append(name, values.has(i) ? String(values.get(i) ?? '') : value ?? '');
  await directFetch(`${BASE}/AfterTrip/Save`, { method: 'POST', body });

  const left = await tripAfterLodges(seq, trseq);
  const row = left.find((r) => r.seq === String(lodgeSeq));
  if (!row) throw new Error('저장을 보냈지만 그 줄이 사후정산 화면에 없습니다. eclass 의 사후정산 입력 화면에서 확인해 주세요.');
  const why = check(row);
  if (why) throw new Error(`저장을 보냈지만 ${why}. eclass 의 사후정산 입력 화면에서 확인해 주세요.`);
  return left;
}

/**
 * 그 번호의(지움 표시가 없는) 숙박 줄의 칸들이 폼 칸 목록의 어디에 있는가 — { 칸 이름(lodge_ 뒤): 자리 }. 없으면 null.
 * 같은 이름의 칸이 줄마다 되풀이된다 — lodge_nation 이 줄의 시작이다.
 */
function lodgeFieldsAt(fields, lodgeSeq) {
  let row = null;
  for (const [i, [name, value]] of fields.entries()) {
    const key = name.startsWith('lodge_') ? name.slice(6) : '';
    if (key === 'nation') {
      if (row?.hit && row.live) return row.at;
      row = { at: {}, hit: false, live: true };
    }
    if (!row || !key) continue;
    row.at[key] = i;
    if (key === 'seq') row.hit = value === String(lodgeSeq);
    if (key === 'del' && value === '1') row.live = false;
  }
  return row?.hit && row.live ? row.at : null;
}
