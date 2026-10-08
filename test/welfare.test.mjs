// 기념일 지원(연차 안의 "기념일 지원" 체크박스 — src/welfare.js): 신청 화면에 넣을 값, 칸·모순, 신청 현황 목록 읽기, 화면 안에서 칸을 채우는 함수.
// 화면 구조(WFA_Application_Save/List.aspx 의 칸 이름·RadComboBox 항목·날짜 꼴)는 2026-10-08 실제 소스로 확인했고, 여기서는 그 모양을 못 박는다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  WFA_LIST_URL, WFA_SAVE_URL, WFA_MAX, WFA_PER_YEAR, RELATIONS, REASONS, CASH_KINDS, WFA_FILES, WELFARE_BLANK, wonOf, wfaEditUrl,
  welfareFields, welfareProblems, describeWelfare, welfareFill, parseWelfareList, welfareYearCount, injected,
} from '../src/welfare.js';
import {
  blankForm, fieldsFor, missingFields, problems, describe, buildJob, readyToSend, isWelfare, withSub, parseAttendLocal, applyPatch, leaveBalance,
} from '../src/attend.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

const TODAY = '2026-10-08';
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const form = (extra = {}) => ({ ...blankForm('leave', TODAY), wfa: true, ...extra });
const FILLED = {
  wfaName: '성춘향', wfaRelation: '배우자', wfaReason: '생일(양력)', wfaDate: '2026-05-27', dateFrom: '2026-05-27', dateTo: '2026-05-27', days: 1,
  wfaPaid: '212,020', wfaAsk: '150000', wfaCash: '2',
};

console.log('갈래와 칸');
t('주소·한도·항목은 실제 화면 그대로다', () => {
  assert.match(WFA_LIST_URL, /\/GAPSU\/EmployeeWelfareFund\/FamilyAnniversary\/WFA_Application_List\.aspx\?s_code=0202090200$/);
  assert.match(WFA_SAVE_URL, /WFA_Application_Save\.aspx\?s_code=0202090300$/);
  assert.match(wfaEditUrl(4421), /WFA_Application_Edit\.aspx\?s_code=0202090300&SEQ=4421$/);
  assert.deepEqual([WFA_MAX, WFA_PER_YEAR], [150000, 5]);
  assert.deepEqual(RELATIONS, ['본인', '배우자', '부모', '형제,자매', '자녀', '배우자 부모']);
  assert.equal(REASONS.length, 17);
  assert.deepEqual(REASONS.slice(0, 2), ['생일(양력)', '결혼기념일']);
  assert.deepEqual(CASH_KINDS.map((c) => c.value), ['1', '2', '3']);
  assert.deepEqual(WFA_FILES.filter((f) => f.need).map((f) => f.name), ['fileUpload2', 'fileUpload3'], '결제증빙과 가족관계증명서는 꼭 붙인다');
});
t('연차 안의 "기념일 지원" 체크박스를 켜면 연차 칸 아래에 기념일 칸이 붙는다 — 연차 사용일은 연차의 시작일·종료일 그대로(2026-10-08 사용자 지정)', () => {
  const f = form();
  assert.equal(isWelfare(f), true);
  assert.deepEqual(Object.keys(WELFARE_BLANK), ['wfa', 'wfaName', 'wfaRelation', 'wfaReason', 'wfaDate', 'wfaStayFrom', 'wfaStayTo', 'wfaPaid', 'wfaAsk', 'wfaCash']);
  assert.equal(f.wfaRelation, '본인', '가족관계의 기본값은 본인');
  assert.deepEqual(fieldsFor(f).map((x) => x.key),
    ['sub', 'dateFrom', 'dateTo', 'days', 'half', 'wfa', 'wfaReason', 'wfaDate', 'wfaName', 'wfaRelation', 'wfaStayFrom', 'wfaStayTo', 'wfaPaid', 'wfaAsk', 'wfaCash']);
  assert.deepEqual(fieldsFor({ ...f, wfa: false }).map((x) => x.key), ['sub', 'dateFrom', 'dateTo', 'days', 'half', 'wfa'], '끄면 체크박스만 남는다');
  assert.deepEqual(fieldsFor({ ...f, sub: 'LH' }).map((x) => x.key), ['sub', 'dateFrom', 'dateTo', 'days', 'half'], '체력단련으로 바꾸면 기념일 칸이 없다');
  assert.equal(isWelfare(withSub(f, 'LH')), false);
  assert.deepEqual(missingFields(f), ['wfaReason', 'wfaDate', 'wfaName'], '기념일의 내용만 반드시 적는다 — 금액·사용구분은 신청 화면에서 적어도 된다');
  assert.deepEqual(missingFields(form(FILLED)), []);
  assert.deepEqual(missingFields(form({ ...FILLED, wfaPaid: '', wfaAsk: '', wfaCash: '' })), []);
});
t('모순 — 신청금액은 15만원까지, 결제금액을 넘지 못하고, 시설 이용일은 짝으로', () => {
  assert.deepEqual(problems(form(FILLED)), []);
  assert.match(problems(form({ ...FILLED, wfaAsk: '200000' }))[0].message, /150,000원까지/);
  assert.match(problems(form({ ...FILLED, wfaPaid: '100000' }))[0].message, /결제금액보다 큽니다/);
  assert.deepEqual(problems(form({ ...FILLED, wfaPaid: 'abc' })).map((p) => p.key), ['wfaPaid']);
  assert.deepEqual(problems(form({ ...FILLED, wfaStayFrom: '2026-05-26' })).map((p) => [p.key, p.message]), [['wfaStayTo', '시설 이용일은 시작·종료를 같이 적어 주세요.']]);
  assert.match(problems(form({ ...FILLED, wfaStayFrom: '2026-05-27', wfaStayTo: '2026-05-26' }))[0].message, /앞섭니다/);
  assert.deepEqual(welfareProblems({ ...FILLED, wfaStayFrom: '2026-05-26', wfaStayTo: '2026-05-27' }), []);
  assert.equal(readyToSend(form(FILLED)), true);
});
t('한 줄 요약과 HR 일감 — HR 에는 연차 그대로 올라가고 기념일 칸은 들어가지 않는다', () => {
  assert.equal(describe(form(FILLED)), '연차 5/27 전일');
  assert.equal(describeWelfare(form(FILLED)), '생일(양력) 5/27 · 성춘향(배우자) · 신청 150,000원');
  assert.equal(describeWelfare({ ...FILLED, wfaAsk: '' }), '생일(양력) 5/27 · 성춘향(배우자) · 신청금액은 신청 화면에서');
  const job = buildJob(form(FILLED), { action: 'request' });
  const plain = buildJob({ ...blankForm('leave', TODAY), dateFrom: '2026-05-27', dateTo: '2026-05-27' }, { action: 'request' });
  assert.deepEqual(job.ops, plain.ops, '기념일 지원을 붙여도 HR 일감은 연차와 같다');
  assert.ok(!JSON.stringify(job).includes('wfa'));
});
t('말로 — "기념일" 이면 연차에 기념일 지원을 붙인다', () => {
  const p = parseAttendLocal('5월 27일 가족 기념일 지원', TODAY, blankForm('', TODAY)).patch;
  assert.deepEqual([p.kind, p.sub, p.wfa, p.dateFrom], ['leave', 'LY', true, '2026-05-27']);
  assert.equal(parseAttendLocal('내일 체력단련', TODAY, blankForm('', TODAY)).patch.wfa, undefined);
  const { form: next, changed } = applyPatch(blankForm('', TODAY), p, TODAY);
  assert.deepEqual([next.kind, next.sub, next.wfa, isWelfare(next)], ['leave', 'LY', true, true]);
  assert.ok(changed.includes('wfa'));
});
t('금액 글 읽기', () => {
  assert.equal(wonOf('212,020원'), 212020);
  assert.equal(wonOf(' 150000 '), 150000);
  assert.equal(wonOf('abc'), null);
  assert.equal(wonOf(''), null);
});

console.log('신청 화면에 넣을 값');
t('칸마다 한 줄 — 빈 값은 넣지 않고, 금액은 숫자만, 날짜는 YYYY-MM-DD(화면의 datepicker 꼴)', () => {
  assert.deepEqual(welfareFill(form(FILLED)), [
    { id: 'MainPlaceHolder_txtFamilyName', value: '성춘향', label: '대상자' },
    { combo: 'MainPlaceHolder_ddlRelation', value: '배우자', label: '가족관계' },
    { id: 'MainPlaceHolder_txtGladSadDate', value: '2026-05-27', label: '기념일' },
    { combo: 'MainPlaceHolder_ddlReasonCode', value: '생일(양력)', label: '신청사항' },
    { id: 'MainPlaceHolder_txtAnnualSDate', value: '2026-05-27', label: '연차휴가 시작일' },
    { id: 'MainPlaceHolder_txtAnnualEDate', value: '2026-05-27', label: '연차휴가 종료일' },
    { id: 'MainPlaceHolder_txtPaymentCost', value: '212020', label: '결제금액' },
    { id: 'MainPlaceHolder_txtApplicationCost', value: '150000', label: '신청금액' },
    { select: 'MainPlaceHolder_ddlCashKind', value: '2', label: '사용구분' },
  ]);
  const withStay = welfareFill(form({ ...FILLED, wfaStayFrom: '2026-05-26', wfaStayTo: '2026-05-27', wfaPaid: '' }));
  assert.deepEqual(withStay.filter((o) => /Accomo/.test(o.id || '')).map((o) => o.value), ['2026-05-26', '2026-05-27']);
  assert.ok(!withStay.some((o) => o.id === 'MainPlaceHolder_txtPaymentCost'), '결제금액을 비우면 넣지 않는다');
});

const page = (html) => {
  const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://eclass.krs.co.kr/GAPSU/EmployeeWelfareFund/FamilyAnniversary/WFA_Application_Save.aspx?s_code=0202090300' });
  const { window } = dom;
  globalThis.window = window;
  for (const g of ['document', 'location', 'Event']) globalThis[g] = window[g];
  return window;
};
const FORM = '<input id="MainPlaceHolder_txtFamilyName"><input id="MainPlaceHolder_txtGladSadDate"><input id="MainPlaceHolder_txtAnnualSDate">'
  + '<input id="MainPlaceHolder_txtAnnualEDate"><input id="MainPlaceHolder_txtPaymentCost"><input id="MainPlaceHolder_txtApplicationCost">'
  + '<select id="MainPlaceHolder_ddlCashKind"><option value="1">현금영수증</option><option value="2">신용카드</option><option value="3">체크카드</option></select>';
/** Telerik 의 $find 흉내 — 콤보마다 항목 목록과 고른 글. */
const telerik = (window, items) => {
  const picked = {};
  window.$find = (id) => (items[id] ? { findItemByText: (text) => (items[id].includes(text) ? { select: () => { picked[id] = text; } } : null) } : null);
  return picked;
};
t('화면 안에서 — 칸을 채우고 콤보는 글로 고른다. 저장은 누르지 않는다', () => {
  const window = page(FORM);
  const picked = telerik(window, { MainPlaceHolder_ddlRelation: RELATIONS, MainPlaceHolder_ddlReasonCode: REASONS });
  const changed = [];
  window.document.addEventListener('change', (e) => changed.push(e.target.id));
  const r = injected.pageFillWelfare(welfareFill(form(FILLED)));
  assert.equal(r.ready, true);
  assert.deepEqual(r.missed, []);
  assert.equal(r.done.length, 9);
  assert.equal(window.document.getElementById('MainPlaceHolder_txtFamilyName').value, '성춘향');
  assert.equal(window.document.getElementById('MainPlaceHolder_txtAnnualEDate').value, '2026-05-27');
  assert.equal(window.document.getElementById('MainPlaceHolder_ddlCashKind').value, '2');
  assert.deepEqual(picked, { MainPlaceHolder_ddlRelation: '배우자', MainPlaceHolder_ddlReasonCode: '생일(양력)' });
  assert.ok(changed.includes('MainPlaceHolder_txtApplicationCost'), '화면 스크립트가 듣게 change 를 일으킨다');
  assert.match(r.url, /WFA_Application_Save/);
});
t('화면 안에서 — 스크립트가 아직 안 떴으면 ready 가 거짓이고, 없는 항목·칸은 못 넣었다고 적는다', () => {
  const bare = page('<p>로그인</p>');
  assert.deepEqual(injected.pageFillWelfare([]), { ready: false });
  bare.$find = () => null;
  assert.deepEqual(injected.pageFillWelfare([]), { ready: false }, '대상자 칸이 없으면 신청 화면이 아니다');
  const window = page(FORM);
  telerik(window, { MainPlaceHolder_ddlRelation: RELATIONS, MainPlaceHolder_ddlReasonCode: REASONS });
  const r = injected.pageFillWelfare([
    { combo: 'MainPlaceHolder_ddlReasonCode', value: '없는 기념일', label: '신청사항' },
    { id: 'MainPlaceHolder_txtNope', value: 'x', label: '없는 칸' },
    { select: 'MainPlaceHolder_ddlCashKind', value: '9', label: '사용구분' },
    { id: 'MainPlaceHolder_txtFamilyName', value: '본인', label: '대상자' },
  ]);
  assert.deepEqual([r.ready, r.done, r.missed], [true, ['대상자'], ['신청사항', '없는 칸', '사용구분']]);
});

console.log('신청 현황 읽기');
const row = (i, applied, name, rel, reason, date, paid, asked, status, seq) =>
  `<tr class="${i % 2 ? 'rgAltRow' : 'rgRow'}" id="MainPlaceHolder_gdvRadList_ctl00__${i}"><td align="center">${i + 1}</td><td>${applied}</td>`
  + `<td><div><a href="#" onclick="javascript:return openEditPopup(&quot;${seq}&quot;);">${name}</a></div></td><td>${rel}</td><td>${reason}</td>`
  + `<td>${date}</td><td>${paid}</td><td>${asked}</td><td>${status}</td></tr>`;
const LIST_HTML = '<html><body><form id="form1"><div id="MainPlaceHolder_gdvRadList_GridData"><table class="rgMasterTable rgClipCells" id="MainPlaceHolder_gdvRadList_ctl00">'
  + '<thead style="display:none;"><tr><th scope="col"></th></tr></thead><tbody>'
  + row(0, '2026.09.02', '본인', '본인', '결혼기념일', '2026.09.02', '299000', '150000', '담당자 승인', '4421')
  + row(1, '2026.06.08', '성춘향', '배우자', '생일(양력)', '2026.05.27', '212020', '150000', '담당자 승인', '3926')
  + row(2, '2026.04.27', '홍길동', '자녀', '어린이날', '2026.05.05', '179390', '150000', '담당자 승인', '3701')
  + row(3, '2025.12.30', '홍길동', '본인', '신정', '2025.12.01', '126000', '126000', '담당자 승인', '3012')
  + '</tbody></table></div></form></body></html>';
const parse = (h) => new JSDOM(h).window.document;
t('목록 화면의 표를 줄마다 읽는다 — 신청일·대상자(링크의 신청 번호)·관계·신청사항·기념일·금액·상태', () => {
  const rows = parseWelfareList(LIST_HTML, parse);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1], { seq: '3926', applied: '2026-06-08', name: '성춘향', relation: '배우자', reason: '생일(양력)', date: '2026-05-27', paid: 212020, asked: 150000, status: '담당자 승인' });
  assert.equal(rows[0].seq, '4421');
  assert.equal(welfareYearCount(rows, '2026'), 3);
  assert.equal(welfareYearCount(rows, '2025'), 1);
  assert.deepEqual(parseWelfareList('<html><body><p>없음</p></body></html>', parse), []);
});

console.log('연차현황');
t('HR 홈 카드의 값 "잔여 / 부여" 를 읽는다 — 연차·체력단련·저축연차', () => {
  const rows = leaveBalance({ yearLeaves: '6.0 / 21.0', lhLeaves: '0.0 / 6.0', lasLeaves: '0.0 / 0.0', emplNo: '11115' });
  assert.deepEqual(rows.map((r) => [r.label, r.left, r.total, r.text]), [['연차', 6, 21, '6.0 / 21.0'], ['체력단련', 0, 6, '0.0 / 6.0'], ['저축연차', 0, 0, '0.0 / 0.0']]);
  assert.deepEqual(leaveBalance({ yearLeaves: '-' })[0], { key: 'yearLeaves', label: '연차', left: null, total: null, text: '-' });
  assert.equal(leaveBalance(null)[2].text, '-');
});

console.log(`\n${pass} passed`);
