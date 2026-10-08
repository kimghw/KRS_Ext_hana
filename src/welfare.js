// 직원 및 직원가족 기념일 지원(사내근로복지기금 — eclass GA HANARO 의 GAPSU 화면) 신청의 순수 로직. 화면도 네트워크도 모른다.
//
// 근태 탭 휴가 폼의 **연차 안 체크박스 "기념일 지원"** 이 이것이다(2026-10-08 사용자 지정: "휴가/연차에는 기념일 지원을 추가 하고 … 가족 기념을
// 작성할 수 있도록", 이어서 "연차 내부에 체크박스로 기념을을 넣어서 기념을 내용을 넣을 수 있도록" — 처음에는 휴가의 세 번째 갈래 칩이었다).
// 켜면 연차 칸 아래에 기념일 칸이 서고, 연차는 HR 에 결재요청으로 올라간 뒤 eclass 의 복지기금 신청 화면을 새 탭에 열어 칸을 채워 둔다 —
// 증빙 파일(결제증빙·가족관계증명서 …)은 스크립트로 넣을 수 없고, "저장 및 상신"은 사람이 그 화면에서 누른다. 연차휴가 사용일은 연차 칸 그대로다.
//
// 화면은 2026-10-08 에 실제 소스로 확인했다(WFA_Application_Save.aspx — ASP.NET WebForms, multipart):
//   대상자 txtFamilyName · 가족관계 ddlRelation(Telerik RadComboBox — 본인·배우자·부모·형제,자매·자녀·배우자 부모) · 기념일 txtGladSadDate ·
//   신청사항 ddlReasonCode(RadComboBox — 생일(양력)·결혼기념일 … 생일(음력)) · 연차휴가 사용일 txtAnnualSDate~EDate · 시설 이용일 txtAccomoSDate~EDate ·
//   결제금액 txtPaymentCost · 신청금액 txtApplicationCost · 입금계좌(은행·계좌·예금주 — 사이트가 미리 채운다) · 사용구분 ddlCashKind(1 현금영수증·2 신용카드·3 체크카드) ·
//   파일 넷(시설이용 증빙 · 결제증빙 · 가족관계증명서 등 · 그 외 기념일 증빙). 날짜 칸은 jQuery UI datepicker 'yy-mm-dd'(2026-09-02 꼴).
//   CheckValid() 가 대상자·가족관계·기념일·신청사항·입금계좌·예금주·신청금액을 본다.
// 지원 소개(WFA_Introduction.aspx): 이용일당 15만원 실비지원(연 최대 5번), 청구는 이용일로부터 20일 이내, 신청서류는 신청서 + 가족관계증명서 또는 주민등록등본.
// 신청 현황(WFA_Application_List.aspx)은 RadGrid 한 표다 — No·신청일·대상자(누르면 WFA_Application_Edit.aspx?SEQ=)·관계·신청사항·기념일·결제금액·신청금액·상태.

import { ORIGIN } from './config.js';

const WFA_BASE = `${ORIGIN}/GAPSU/EmployeeWelfareFund/FamilyAnniversary`;
export const WFA_LIST_URL = `${WFA_BASE}/WFA_Application_List.aspx?s_code=0202090200`;
export const WFA_SAVE_URL = `${WFA_BASE}/WFA_Application_Save.aspx?s_code=0202090300`;
export const WFA_INTRO_URL = `${WFA_BASE}/WFA_Introduction.aspx?s_code=0202090100`;
export const wfaEditUrl = (seq) => `${WFA_BASE}/WFA_Application_Edit.aspx?s_code=0202090300&SEQ=${encodeURIComponent(String(seq ?? ''))}`;

/** 이용일당 지원 상한(원)과 한 해에 받을 수 있는 횟수 — 지원 소개 화면의 "이용일당 15만원 실비지원(연 최대 5번)". */
export const WFA_MAX = 150000;
export const WFA_PER_YEAR = 5;
/** 청구기한 — 이용일로부터 20일 이내(숙박은 시설 마지막 이용일로부터). */
export const WFA_CLAIM_DAYS = 20;

/** 가족관계·신청사항 — 화면의 RadComboBox 항목 그대로(글로 고른다). 첫 번째가 기본값이다. */
export const RELATIONS = ['본인', '배우자', '부모', '형제,자매', '자녀', '배우자 부모'];
export const REASONS = ['생일(양력)', '결혼기념일', '자녀 입학식', '자녀 졸업식', '자녀 방학', '신정', '어린이날', '어버이날', '세계가정의날', '부부의날',
  '부처님오신날', '창립기념일', '노조 창립기념일', '추석', '크리스마스', '설날', '생일(음력)'];
/** 사용구분 — 화면의 select 값. 계좌이체는 지원받을 수 없다(화면의 안내). */
export const CASH_KINDS = [{ value: '1', label: '현금영수증' }, { value: '2', label: '신용카드' }, { value: '3', label: '체크카드' }];
/** 신청 화면의 파일 칸 넷 — 스크립트로는 넣지 못해 사람이 붙인다. 패널은 무엇을 준비할지 보여 준다. */
export const WFA_FILES = [
  { name: 'fileUpload2', label: '결제증빙(현금영수증 혹은 매출전표)', need: true },
  { name: 'fileUpload3', label: '가족관계증명서 또는 주민등록등본 또는 인트라넷 생일 캡쳐본', need: true },
  { name: 'fileUpload1', label: '시설이용 증빙서류(예약자명·시설 이용기간 기재)', need: false },
  { name: 'fileUpload4', label: '그 외 기념일 증빙자료(학사일정 등)', need: false },
];

/**
 * 폼에 더 드는 칸의 빈 값. 근태 폼(src/attend.js 의 blankForm)에 얹는다 — wfa 는 연차 안의 "기념일 지원" 체크박스이고,
 * 연차 사용일은 휴가 폼의 시작일·종료일이 그대로다.
 */
export const WELFARE_BLANK = Object.freeze({
  wfa: false, wfaName: '', wfaRelation: RELATIONS[0], wfaReason: '', wfaDate: '', wfaStayFrom: '', wfaStayTo: '', wfaPaid: '', wfaAsk: '', wfaCash: '',
});

/** 체크박스 칸 — 연차 칸 아래(오전·오후 다음)에 선다. 켜면 기념일 칸(welfareFields)이 그 아래에 붙는다. */
export const WELFARE_CHECK = Object.freeze({
  key: 'wfa', label: '기념일 지원', type: 'check', required: false,
  hint: '가족 기념일(생일·결혼기념일·어린이날 …)에 쓰는 연차면 켜세요 — 결재요청 뒤 eclass 의 가족 기념일 지원 신청 화면을 채워 엽니다',
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const md = (s) => (DATE_RE.test(s || '') ? `${+s.slice(5, 7)}/${+s.slice(8)}` : '?');
/** 금액 글 → 원. 쉼표·"원"은 걷어 낸다. 숫자가 아니면 null. */
export function wonOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v ?? '').replace(/[,\s원]/g, '');
  return /^\d+$/.test(s) ? +s : null;
}
const won = (n) => (n == null ? '?' : `${n.toLocaleString('ko-KR')}원`);

/**
 * 기념일 칸 — 체크박스를 켰을 때 연차 칸 아래에 붙는다. 근태 폼의 칸 모양(src/attend.js 의 fieldsFor)과 같다 — 화면이 같은 길로 그린다.
 * 기념일의 내용(신청사항·기념일·대상자·가족관계)만 반드시 적는다. 결제금액·신청금액·사용구분은 다녀온 뒤에야 아는 일이 많아 비워 둘 수 있다
 * — 비우면 신청 화면에서 적는다(사이트의 CheckValid 가 신청금액을 묻는다).
 */
export function welfareFields() {
  return [
    { key: 'wfaReason', label: '신청사항', type: 'select', required: true, options: REASONS.map((r) => ({ value: r, label: r })) },
    { key: 'wfaDate', label: '기념일', type: 'date', required: true, beside: true },
    { key: 'wfaName', label: '대상자', type: 'text', required: true, hint: '본인 또는 가족 이름' },
    { key: 'wfaRelation', label: '가족관계', type: 'choice', required: true, options: RELATIONS.map((r) => ({ value: r, label: r })) },
    { key: 'wfaStayFrom', label: '시설 시작일', type: 'date', required: false, group: 'stay' },
    { key: 'wfaStayTo', label: '시설 종료일', type: 'date', required: false, group: 'stay' },
    { key: 'wfaPaid', label: '결제금액', type: 'text', required: false, group: 'cost', hint: '원 — 영수증 금액' },
    { key: 'wfaAsk', label: '신청금액', type: 'text', required: false, group: 'cost', hint: `원 — ${WFA_MAX.toLocaleString('ko-KR')}까지` },
    { key: 'wfaCash', label: '사용구분', type: 'choice', required: false, options: CASH_KINDS },
  ];
}

/** 값끼리의 모순 — 사이트가 받지 않거나 지원이 안 되는 것을 미리 말한다. */
export function welfareProblems(form) {
  const out = [];
  for (const key of ['wfaDate', 'wfaStayFrom', 'wfaStayTo']) {
    if (String(form?.[key] || '').trim() && !DATE_RE.test(form[key])) out.push({ key, message: '날짜 형식이 올바르지 않습니다.' });
  }
  const sFrom = String(form?.wfaStayFrom || '').trim();
  const sTo = String(form?.wfaStayTo || '').trim();
  if ((sFrom && !sTo) || (!sFrom && sTo)) out.push({ key: sFrom ? 'wfaStayTo' : 'wfaStayFrom', message: '시설 이용일은 시작·종료를 같이 적어 주세요.' });
  else if (DATE_RE.test(sFrom) && DATE_RE.test(sTo) && sTo < sFrom) out.push({ key: 'wfaStayTo', message: '시설 종료일이 시작일보다 앞섭니다.' });
  const ask = wonOf(form?.wfaAsk);
  const paid = String(form?.wfaPaid || '').trim() ? wonOf(form.wfaPaid) : undefined;
  if (String(form?.wfaAsk || '').trim() && ask == null) out.push({ key: 'wfaAsk', message: '숫자만 적어 주세요.' });
  else if (ask != null && ask > WFA_MAX) out.push({ key: 'wfaAsk', message: `신청금액은 ${WFA_MAX.toLocaleString('ko-KR')}원까지입니다(이용일당 실비).` });
  if (paid === null) out.push({ key: 'wfaPaid', message: '숫자만 적어 주세요.' });
  else if (paid != null && ask != null && ask > paid) out.push({ key: 'wfaAsk', message: '신청금액이 결제금액보다 큽니다.' });
  if (form?.wfaCash && !CASH_KINDS.some((c) => c.value === form.wfaCash)) out.push({ key: 'wfaCash', message: '사용구분을 고르세요.' });
  return out;
}

/**
 * 한 줄 요약 — "결혼기념일 9/2 · 본인(본인) · 신청 150,000원". 연차 날짜는 앞의 연차 요약에 있어 되풀이하지 않는다.
 * 신청금액을 비워 두었으면 "신청금액은 신청 화면에서" 라고 적는다.
 */
export function describeWelfare(form) {
  const ask = wonOf(form?.wfaAsk);
  return `${form?.wfaReason || '?'} ${md(form?.wfaDate)} · ${String(form?.wfaName || '').trim() || '?'}(${form?.wfaRelation || '?'})`
    + ` · ${ask == null ? '신청금액은 신청 화면에서' : `신청 ${won(ask)}`}`;
}

/**
 * 신청 화면에 넣을 값 — 칸마다 한 줄. combo 는 Telerik RadComboBox(글로 고른다), id 는 보통 칸, select 는 드롭다운이다.
 * 빈 값은 넣지 않는다(시설 이용일·결제금액을 비워 두면 화면도 빈 채다). 입금계좌·예금주는 사이트가 채우므로 건드리지 않는다.
 * @returns {{id?:string, combo?:string, select?:string, value:string, label:string}[]}
 */
export function welfareFill(form) {
  const f = form || {};
  const ask = wonOf(f.wfaAsk);
  const paid = wonOf(f.wfaPaid);
  const rows = [
    { id: 'MainPlaceHolder_txtFamilyName', value: String(f.wfaName || '').trim(), label: '대상자' },
    { combo: 'MainPlaceHolder_ddlRelation', value: f.wfaRelation || '', label: '가족관계' },
    { id: 'MainPlaceHolder_txtGladSadDate', value: f.wfaDate || '', label: '기념일' },
    { combo: 'MainPlaceHolder_ddlReasonCode', value: f.wfaReason || '', label: '신청사항' },
    { id: 'MainPlaceHolder_txtAnnualSDate', value: f.dateFrom || '', label: '연차휴가 시작일' },
    { id: 'MainPlaceHolder_txtAnnualEDate', value: f.dateTo || f.dateFrom || '', label: '연차휴가 종료일' },
    { id: 'MainPlaceHolder_txtAccomoSDate', value: f.wfaStayFrom || '', label: '시설 시작일' },
    { id: 'MainPlaceHolder_txtAccomoEDate', value: f.wfaStayTo || '', label: '시설 종료일' },
    { id: 'MainPlaceHolder_txtPaymentCost', value: paid == null ? '' : String(paid), label: '결제금액' },
    { id: 'MainPlaceHolder_txtApplicationCost', value: ask == null ? '' : String(ask), label: '신청금액' },
    { select: 'MainPlaceHolder_ddlCashKind', value: f.wfaCash || '', label: '사용구분' },
  ];
  return rows.filter((r) => r.value !== '');
}

/* ------------------------------------------------------------ 신청 현황(목록 화면) 읽기 */

const dot = (s) => {
  const m = String(s ?? '').trim().match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
};

/**
 * 신청 현황 화면(WFA_Application_List.aspx)의 표를 읽는다. 줄마다 No·신청일·대상자·관계·신청사항·기념일·결제금액·신청금액·상태이고,
 * 대상자 칸의 링크(openEditPopup("4421"))에서 신청 번호(seq)를 꺼낸다. 표가 없으면 빈 목록이다.
 * @param {string} html
 * @param {(html:string) => Document} [parse] 문서로 바꾸는 길 — 기본은 DOMParser
 * @returns {{seq:string, applied:string, name:string, relation:string, reason:string, date:string, paid:number|null, asked:number|null, status:string}[]}
 */
export function parseWelfareList(html, parse = (h) => new DOMParser().parseFromString(h, 'text/html')) {
  const doc = parse(String(html || ''));
  const table = doc.querySelector('#MainPlaceHolder_gdvRadList_ctl00') || doc.querySelector('table.rgMasterTable');
  if (!table) return [];
  const out = [];
  for (const tr of table.querySelectorAll('tbody tr')) {
    const cells = [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim());
    if (cells.length < 9) continue;
    const link = tr.querySelector('a[onclick]');
    const seq = (link?.getAttribute('onclick') || '').match(/openEditPopup\(\s*["']?(\d+)/)?.[1] || '';
    out.push({
      seq, applied: dot(cells[1]), name: cells[2], relation: cells[3], reason: cells[4], date: dot(cells[5]),
      paid: wonOf(cells[6]), asked: wonOf(cells[7]), status: cells[8],
    });
  }
  return out;
}

/** 그 해에 신청한 건수(신청일 기준) — 연 최대 다섯 번(WFA_PER_YEAR)을 얼마나 썼는지. */
export const welfareYearCount = (rows, year) => (rows || []).filter((r) => String(r.applied || '').startsWith(`${year}-`)).length;

/* ------------------------------------------------------------ 신청 화면 안에서 도는 함수 */
// chrome.scripting 으로 **글자 그대로** 옮겨져 신청 화면 탭(MAIN 세계)에서 돈다. 바깥 변수를 쓰면 안 된다.

/**
 * 신청 화면의 칸을 채운다(저장은 누르지 않는다). RadComboBox 는 Telerik 클라이언트 API($find … findItemByText … select)로 고르고,
 * 보통 칸은 값을 넣고 input·change 를 일으킨다. 화면 스크립트가 아직 안 떴으면(대상자 칸이나 $find 가 없음) ready 가 거짓이다 — 부르는 쪽이 다시 부른다.
 * @param {{id?:string, combo?:string, select?:string, value:string, label:string}[]} ops
 * @returns {{ready:boolean, done?:string[], missed?:string[], url?:string}}
 */
function pageFillWelfare(ops) {
  if (!document.getElementById('MainPlaceHolder_txtFamilyName') || typeof window.$find !== 'function') return { ready: false };
  const done = [];
  const missed = [];
  for (const op of ops || []) {
    try {
      if (op.combo) {
        const combo = window.$find(op.combo);
        const item = combo && typeof combo.findItemByText === 'function' ? combo.findItemByText(op.value) : null;
        if (item) { item.select(); done.push(op.label); } else missed.push(op.label);
        continue;
      }
      const el = document.getElementById(op.id || op.select);
      if (!el) { missed.push(op.label); continue; }
      el.value = op.value;
      if (op.select && el.value !== op.value) { missed.push(op.label); continue; }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      done.push(op.label);
    } catch (e) {
      missed.push(`${op.label}(${(e && e.message) || e})`);
    }
  }
  return { ready: true, done, missed, url: location.href };
}

/** 테스트와 실제 화면이 같은 함수를 쓰도록 내놓는다. */
export const injected = { pageFillWelfare };
