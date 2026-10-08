// 근태 신청의 순수 로직. 화면도 네트워크도 모른다 — 무엇을 물어볼지, 무엇이 비었는지,
// HR 폼에 어떤 순서로 무엇을 넣을지만 정한다. 넣는 일은 src/hr.js 가 HR 탭 안에서 한다.
//
// HR(hr.krs.co.kr) 폼은 2026-10-02 에 실제 화면 소스를 받아 확인했다. 폼마다 사이트가 쓰는
// 저장·결재요청 함수가 있고, 값을 넣는 **순서**가 중요하다 — 종류를 바꾸면 날짜가 오늘로 돌아가고,
// 날짜를 바꾸면 시각이 초기화된다. 그래서 순서를 여기서 한 번에 정해 두고 테스트로 못 박는다.

import { TRANSPORTS, DEFAULT_TRANSPORT, DEFAULT_GRADE, transportsOf } from './travel.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const asDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = asDate(s); d.setDate(d.getDate() + n); return ymd(d); };

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutesOf = (t) => (TIME_RE.test(t || '') ? +t.slice(0, 2) * 60 + +t.slice(3) : NaN);
const clock = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

/**
 * 외근·외출·건강검진의 시각은 30분 단위로 받는다(2026-10-02 사용자 지정).
 * 사이트의 분 드롭다운은 10분 단위라 30분은 늘 그 안에 있다.
 */
export const MINUTE_STEP = 30;

/** 시작 시각의 기본값 — 오전 9시(2026-10-02 사용자 지정). 종류·갈래만의 기본값(출장 7시, 소통 13시)이 있으면 그것이 이긴다. */
export const DEFAULT_START = '09:00';

/** "몇 시간" 칩. 여기에 30분을 더하는 칩이 하나 붙는다(2026-10-02 사용자 지정). */
export const SPAN_HOURS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * 유연근무 출근시간과 사이트 코드(WC96). 출근과 퇴근이 한 묶음이라(8시간 근무 고정) 출근시간이 곧 시간대다.
 * 07:00·11:00 은 월·금요일에만 고를 수 있다 — Daily 표는 onEditCommit 규칙으로 막고,
 * Weekly 의 화·수·목 칸에는 그 선택지가 아예 없다(2026-10-02 실제 화면에서 확인).
 */
export const FLEX_TIMES = [
  { start: '07:00', code: '1', label: '07:00 ~ 16:00' },
  { start: '08:00', code: '2', label: '08:00 ~ 17:00' },
  { start: '08:30', code: '3', label: '08:30 ~ 17:30' },
  { start: '09:00', code: '4', label: '09:00 ~ 18:00' },
  { start: '09:30', code: '7', label: '09:30 ~ 18:30' },
  { start: '10:00', code: '5', label: '10:00 ~ 19:00' },
  { start: '11:00', code: '6', label: '11:00 ~ 20:00' },
];
const FLEX_MON_FRI_ONLY = new Set(['07:00', '11:00']);

/**
 * 유연근무를 넣는 세 가지 길(2026-10-02 사용자 지정). code 는 HR 신청서의 기간구분(WC97)이고 Daily·Weekly 둘뿐이다.
 *   당일 — 그 날 하루의 출근시간(Daily 표에 날짜 한 줄, 사유를 받는다)
 *   주간 — 월~금 요일마다의 출근시간(Weekly 의 다섯 칸)
 *   전체 — 월~금 모두 같은 출근시간(Weekly 의 다섯 칸에 같은 값)
 * Weekly 는 날짜도 사유도 받지 않고, 결재되면 다음 주 월요일부터 반영된다(화면의 안내문).
 */
export const FLEX_MODES = [
  { value: 'day', label: '당일', code: 'DA' }, { value: 'week', label: '주간', code: 'WE' }, { value: 'all', label: '전체', code: 'WE' },
];

/** Weekly 의 요일 칸. key 는 패널 폼의 칸, field 는 HR 화면의 칸 이름이다. wide 는 07:00·11:00 을 고를 수 있는 요일. */
export const FLEX_DAYS = [
  { key: 'flexMon', label: '월', field: 'monTime', wide: true },
  { key: 'flexTue', label: '화', field: 'tueTime', wide: false },
  { key: 'flexWed', label: '수', field: 'wedTime', wide: false },
  { key: 'flexThu', label: '목', field: 'thuTime', wide: false },
  { key: 'flexFri', label: '금', field: 'friTime', wide: true },
];

/**
 * 그 요일에 고를 수 있는 출근시간. 월·금(wide)은 일곱 가지, 화~목과 "전체"는 07:00·11:00 을 뺀 다섯 가지다.
 * 화면의 목록은 일곱 가지를 다 보여주고 못 고르는 것만 잠근다(fieldsFor) — 이것은 값을 받을지 가릴 때 쓴다.
 */
export const flexTimesFor = (wide) => FLEX_TIMES.filter((t) => wide || !FLEX_MON_FRI_ONLY.has(t.start));

/** 유연근무를 넣는 길. 유연근무가 아니거나 모르는 값이면 당일이다. */
export const flexModeOf = (form) => (form?.kind === 'flex' && FLEX_MODES.some((m) => m.value === form.flexMode) ? form.flexMode : 'day');

/** Weekly 로 올릴 요일별 출근시간 — 전체면 한 값이 다섯 요일에 들어간다. */
const flexWeekOf = (form) => FLEX_DAYS.map((d) => ({ ...d, start: flexModeOf(form) === 'all' ? form.flexStart : form[d.key] }));

/** HR 폼. route 는 화면, save/request/recall 은 그 화면의 버튼이 부르는 사이트 함수 이름이다. */
export const FORMS = {
  out: { route: '/uhr/docappr/approut100/view', api: '/uhr/docappr/approut100', formId: 'TRO', save: 'saveTrav100', ready: { sel: '#biztripKind', fn: 'saveTrav100' } },
  trav: { route: '/uhr/docappr/apprtrav100/view', api: '/uhr/docappr/apprtrav100', formId: 'TR', save: 'saveTrav100', ready: { sel: '#biztripKind', fn: 'saveTrav100' } },
  etc: { route: '/uhr/docappr/appretc100/view', api: '/uhr/docappr/appretc100', formId: 'ET', save: 'saveEtc100', ready: { sel: '#workCodeKind', fn: 'saveEtc100' } },
  holi: { route: '/uhr/docappr/apprholi100/view', api: '/uhr/docappr/apprholi100', formId: 'LV', save: 'saveHoli100', ready: { sel: '#workCodeKind', fn: 'saveHoli100' } },
  flex: { route: '/uhr/docappr/apprflex100/view', api: '/uhr/docappr/apprflex100', formId: 'FW', save: 'saveGrid', ready: { global: 'docapprflex100Grid', fn: 'saveGrid' } },
};
const FORM_BY_ID = Object.fromEntries(Object.entries(FORMS).map(([k, f]) => [f.formId, k]));

/**
 * 결재완료 건을 무르는 취소신청 폼. 저장 단계가 없고 결재요청이 유일한 쓰기다.
 * pop 은 "취소 문서 선택" 창이 읽는 목록, grid 는 고른 건이 들어가는 표의 전역 변수 이름이다.
 * 유연근무(FW)에는 취소신청서가 없다 — 시간대를 되돌리는 유연근무를 새로 올려야 한다.
 */
export const CANCEL_FORMS = {
  TRO: { route: '/uhr/docappr/apprcnclout100/view', grid: 'docapprcnclout100Grid', pop: '/uhr/docappr/apprtrav-pop', workGbn: 'O' },
  TR: { route: '/uhr/docappr/apprcncltrav100/view', grid: 'docapprcncltrav100Grid', pop: '/uhr/docappr/apprtrav-pop', workGbn: 'T' },
  LV: { route: '/uhr/docappr/apprcnclholi100/view', grid: 'docapprcnclholi100Grid', pop: '/uhr/docappr/apprholi-pop' },
  ET: { route: '/uhr/docappr/apprcnclholi100/view', grid: 'docapprcnclholi100Grid', pop: '/uhr/docappr/apprholi-pop' },
};

/**
 * 패널이 다루는 근태 종류. form 은 HR 폼, code 는 그 폼의 근태종류 코드.
 * short 는 종류 줄의 두 글자 이름이다 — 종류가 한 줄에 들어가게 줄였다(2026-10-02 사용자 지정).
 */
export const KINDS = {
  flex: { label: '유연근무', short: '유연', form: 'flex', hint: '출근시간 변경(자율출퇴근)' },
  out: { label: '외근', form: 'out', code: 'OD', hint: '사외에서 업무 · 교육 · 부서소통회' },
  leaveout: { label: '외출', form: 'etc', code: 'ZLO', hint: '근무 중 잠시 나갔다 옴' },
  trip: { label: '출장', form: 'trav', code: 'DBT', hint: '국내출장' },
  leave: { label: '휴가', form: 'holi', code: 'LY', hint: '연차 · 체력단련' },
  health: { label: '건강검진', short: '건강', form: 'holi', code: 'HCL', hint: '정기 건강검진(공가)' },
};
/**
 * 늘 보이는 첫 줄과, 접어 두었다가 펴면 보이는 나머지. 지금은 여섯 종류를 한 줄에 다 보여서
 * 접는 쪽이 비어 있다(2026-10-02 사용자 지정). 여기에 종류를 옮기면 그것만 "더 보기" 아래로 접힌다.
 */
export const KIND_MAIN = ['trip', 'out', 'flex', 'leaveout', 'leave', 'health'];
export const KIND_MORE = [];
export const KIND_ORDER = [...KIND_MAIN, ...KIND_MORE];

/**
 * 종류 안에서 한 번 더 고르는 갈래. 첫 번째가 기본값이다. value 는 HR 의 근태종류 코드이고,
 * 코드가 같은 갈래가 또 있으면 code 에 따로 적는다. 체력단련은 HR 에서 "체력관리"라고 부른다(LH).
 *
 * 소통(부서소통회)은 따로 있는 신청서가 아니라 **외근 13~14시**의 줄임이라 외근의 갈래다
 * (2026-10-02 사용자 지정 — 그 전에는 종류 줄에 따로 있었고 12~14시였다). 고르면 preset 이 깔린다.
 * name 은 제목·요약에 쓰는 풀 이름이다.
 */
export const SUBS = {
  out: [{ value: 'OD', label: '외근' }, { value: 'TR', label: '교육' },
    { value: 'MEET', label: '소통', name: '부서소통회', code: 'OD', preset: { start: '13:00', span: 60, purpose: '부서소통회' } }],
  leave: [{ value: 'LY', label: '연차' }, { value: 'LH', label: '체력단련' }],
};
const MEET = SUBS.out.find((s) => s.value === 'MEET');

/** 연차의 구분. 빈 값이 전일이다. code 는 HR 의 근태구분(WC12). */
export const HALVES = [
  { value: '', label: '전일', code: '01' }, { value: 'am', label: '오전', code: '02' }, { value: 'pm', label: '오후', code: '03' },
];

const subOf = (form) => (SUBS[form?.kind] || []).find((s) => s.value === form.sub) || null;

/** HR 에 넣을 근태종류 코드. 갈래가 있는 종류는 고른 갈래의 코드다. */
export const codeOf = (form) => subOf(form)?.code || subOf(form)?.value || KINDS[form?.kind]?.code || '';

/** 요약과 제목에 쓰는 이름. 갈래를 골랐으면 그 이름이다(교육·부서소통회·연차·체력단련). */
export const nameOf = (form) => subOf(form)?.name || subOf(form)?.label || KINDS[form?.kind]?.label || '';

/** 출장을 며칠까지 받을지. 한 달을 넘는 출장은 HR 에서 직접 올린다. 휴가도 같은 한도를 쓴다. */
export const MAX_TRIP_DAYS = 31;

const validDays = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_TRIP_DAYS;

/** 며칠간을 받는 종류인가. 출장과 휴가만 여러 날이고 나머지는 하루짜리다. */
export const multiDay = (form) => form?.kind === 'trip' || form?.kind === 'leave';

/** 시작일부터 끝나는 날까지 며칠인지(둘 다 포함). 날짜가 아니면 NaN. */
export function spanDays(from, to) {
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) return NaN;
  return Math.round((asDate(to) - asDate(from)) / 86400000) + 1;
}

/**
 * 종료일을 "며칠간"에서 맞춘다. 1 이면 당일, 2 면 다음 날까지다.
 * 출장·휴가가 아닌 종류는 하루짜리라 종료일이 시작일을 따라간다.
 */
export function tripDates(form) {
  const days = multiDay(form) && validDays(form.days) ? form.days : 1;
  return { ...form, dateTo: DATE_RE.test(form.dateFrom || '') ? addDays(form.dateFrom, days - 1) : form.dateFrom };
}

/**
 * 시작과 "몇 시간"으로 받는 종류인가. 하루 안에서 끝나는 것들이다(외근·교육·부서소통회·외출·시간으로 올리는 건강검진).
 * 출장은 날을 넘기므로 출발·도착 시각을 그대로 받는다.
 */
export const spanned = (form) =>
  ['out', 'leaveout'].includes(form?.kind) || (form?.kind === 'health' && !form.allDay);

/** 시작~종료가 몇 분인지. 시각이 아니거나 종료가 시작보다 늦지 않으면 빈 글(고르지 않음)이다. */
const spanOf = (start, end) => {
  const mins = minutesOf(end) - minutesOf(start);
  return mins > 0 ? mins : '';
};

/**
 * 종료 시각을 "몇 시간"에서 맞춘다(시작 + span 분). 시작이나 시간을 아직 안 골랐거나 자정을 넘기면 빈 글이다.
 * 시작과 몇 시간으로 받는 종류가 아니면 건드리지 않는다.
 */
export function spanEnd(form) {
  if (!spanned(form)) return form;
  const end = minutesOf(form.start) + (form.span > 0 ? form.span : NaN);
  return { ...form, end: end < 24 * 60 ? clock(end) : '' };
}

/** "전체"는 다섯 요일에 같은 시간대라, 화~목에 없는 07:00·11:00 은 남기지 않는다(목록에 없는 값이 숨어서 올라가지 않게). */
const flexFit = (form) => (flexModeOf(form) === 'all' && FLEX_MON_FRI_ONLY.has(form.flexStart) ? { ...form, flexStart: '' } : form);

/** 값이 바뀐 뒤 거기서 나오는 칸을 맞춘다 — 종료일은 며칠간에서, 종료 시각은 몇 시간에서. */
export const settle = (form) => flexFit(spanEnd(tripDates(form)));

/**
 * 몇 시간 칩을 눌렀을 때의 새 값(분). 시간 칩(pick 이 숫자)은 더해 둔 30분을 지키고, 30분 칩('half')은 켜고 끈다.
 * 30분 칩만 켜 두면 30분짜리다. 정시 단위인 종류(교육)에서는 30분이 떨어진다.
 */
export function nextSpan(form, pick) {
  const span = Number.isInteger(form.span) && form.span > 0 ? form.span : 0;
  const half = timeStep(form) < 60 && span % 60 === 30;
  if (pick === 'half') return (span - (span % 60) + (half ? 0 : 30)) || '';
  return pick * 60 + (half ? 30 : 0);
}

/**
 * 연차의 구분. 오전·오후는 **하루짜리 연차**에만 있다 — 여러 날이거나 체력단련(HR 이 전일로 잠근다)이면 전일이다.
 */
export function halfOf(form) {
  if (form?.kind !== 'leave' || codeOf(form) !== 'LY' || form.days !== 1) return '';
  return form.half === 'am' || form.half === 'pm' ? form.half : '';
}

const FLEX_BY_CODE = Object.fromEntries(FLEX_TIMES.map((t) => [t.code, t]));
const WEEK_KEYS = ['sunTime', 'monTime', 'tueTime', 'wedTime', 'thuTime', 'friTime', 'satTime'];
/** 반차를 쓰려고 출근시간을 옮길 때의 시간대 — 09:00~18:00 (2026-10-02 사용자 지정). */
export const HALF_FLEX_START = '09:00';

/**
 * 그 날의 출근시간. 그 날짜로 올려 둔 유연근무(결재요청·결재완료)가 있으면 그것이고, 없으면 주간 근무시간표의
 * 그 요일이다. 알 수 없으면(주말, 시간표를 못 읽음) 빈 글이다.
 * @param {string} date
 * @param {{week?: object, items?: object[]}} known week 는 HR 의 주간 근무시간표(요일별 시간 코드), items 는 listItems 결과
 */
export function workStartOn(date, { week, items } = {}) {
  if (!DATE_RE.test(date || '')) return '';
  const live = new Set(['2', '3', '5']);   // 결재대기·결재요청·결재완료
  // 목록은 최근 문서가 앞이다. 같은 날을 여러 번 바꿨으면 마지막에 올린 것이 그 날의 시간이다.
  const doc = (items || []).find((it) => it.formId === 'FW' && it.from === date && live.has(it.status) && TIME_RE.test(it.start || ''));
  if (doc) return doc.start;
  return FLEX_BY_CODE[String(week?.[WEEK_KEYS[asDate(date).getDay()]] ?? '')]?.start || '';
}

/**
 * 주간 유연근무의 **빈** 요일 칸을 지금 근무시간표로 채운다 — HR 화면이 Weekly 를 고르면 하는 일과 같다
 * (Current Work Time). 바꿀 요일만 고치면 되게 하려는 것이고, 이미 고른 칸은 건드리지 않는다.
 * @param {object} week HR 의 주간 근무시간표(요일별 시간 코드)
 */
export function fillFlexWeek(form, week) {
  const next = { ...form };
  for (const d of FLEX_DAYS) {
    const now = FLEX_BY_CODE[String(week?.[d.field] ?? '')]?.start;
    if (!next[d.key] && now && flexTimesFor(d.wide).some((t) => t.start === now)) next[d.key] = now;
  }
  return next;
}

/**
 * 반차가 그 날 근무시간에서 어떻게 잡히는지. 하루짜리 연차의 오전·오후가 아니거나 출근시간을 모르면 null.
 *
 * 근무는 점심 한 시간을 낀 아홉 시간이다. 오전 반차는 출근부터 네 시간, 오후 반차는 퇴근 전 네 시간이다
 * (08:00 출근이면 08:00~12:00 / 13:00~17:00). 출근이 정시가 아니면(08:30) 반차를 바로 쓰지 않고
 * **09:00~18:00 으로 옮긴 뒤** 쓴다(2026-10-02 사용자 지정) — 그때는 flexStart 에 옮길 출근시간이 들어 있다.
 * @returns {{half:string, workStart:string, flexStart:string, from:string, to:string}|null}
 */
export function halfPlan(form, workStart) {
  const half = halfOf(form);
  if (!half || !TIME_RE.test(workStart || '')) return null;
  const onHour = workStart.endsWith(':00');
  const [h, m] = (onHour ? workStart : HALF_FLEX_START).split(':').map(Number);
  const at = (plus) => `${pad(h + plus)}:${pad(m)}`;
  return {
    half, workStart, flexStart: onHour ? '' : HALF_FLEX_START,
    from: at(half === 'am' ? 0 : 5), to: at(half === 'am' ? 4 : 9),
  };
}

/** 반차 앞에 올릴 유연근무 폼(그 날 출근시간을 정시로 옮긴다). 옮길 것이 없으면 null. */
export function halfFlexForm(form, plan, today) {
  if (!plan?.flexStart) return null;
  return {
    ...blankForm('flex', today), dateFrom: form.dateFrom, dateTo: form.dateFrom, flexStart: plan.flexStart,
    purpose: `${plan.half === 'am' ? '오전' : '오후'} 반차 사용에 따른 출근시간 변경`,
  };
}

/**
 * 분 단위 시각 단위. 출장·교육은 정시, 나머지는 30분이다.
 * 출장·교육은 사이트가 분 칸을 잠근다 — 옵션은 00·30 둘이지만 `disabled` 라 사람이 고를 수 없다
 * (2026-10-02 `/uhr/docappr/apprtrav100/view` 의 initBiztripKind 에서 확인). 30분을 올리려면 잠긴 칸에 값을 넣어야 한다.
 */
export function timeStep(form) {
  return form?.kind === 'trip' || (form?.kind === 'out' && codeOf(form) === 'TR') ? 60 : MINUTE_STEP;
}

/** 시각 칸의 목록. 그 종류의 단위(30분 또는 정시)로 하루를 나눈 것이다 — 00:00, 00:30, … 23:30. */
export function timeOptions(form) {
  const step = timeStep(form);
  return Array.from({ length: (24 * 60) / step }, (_, i) => clock(i * step));
}

/** 빈 폼. kind 를 주면 그 종류의 기본값을 깐다. 날짜는 오늘 — HR 폼의 기본값과 같다. */
export function blankForm(kind, today) {
  const base = {
    kind: KINDS[kind] ? kind : '', dateFrom: today, dateTo: today, start: '', end: '',
    place: '', venue: '', workplace: '', purpose: '', flexStart: '', allDay: true, expense: '', file: null, days: 1,
    // 출장의 여비계산서(사전정산): 올린 뒤 자동으로 만들지(settle)와 교통편. 근무지·교통편은 이것을 켰을 때만 묻는다
    // (출장지 place 와 장소 venue 는 출장이면 늘 묻는다).
    // 교통편은 여럿을 함께 고를 수 있어 목록이다(기차 + 비행기). trainGrade 는 기차의 좌석 등급(일반석·특실)이다.
    settle: false, transport: [DEFAULT_TRANSPORT], trainGrade: DEFAULT_GRADE,
    // 출장·외근의 차량 조회: 켜면 폼의 날짜·시간에 빈 차량을 찾아 보이고, 누르면 그 차량을 신청한다(src/carfind.js).
    // carPlace 는 차량 신청의 행선지 — 폼에 출장지 칸이 없을 때(외근) 받는다. 둘 다 HR 에는 올라가지 않는다.
    car: false, carPlace: '',
    sub: SUBS[kind]?.[0].value || '', half: '', span: '',
    flexMode: 'day', ...Object.fromEntries(FLEX_DAYS.map((d) => [d.key, ''])),
  };
  // 출장은 아침 7시에 떠나 저녁 8시에 닿는 당일 하루가 기본이다(2026-10-02 사용자 지정).
  if (kind === 'trip') Object.assign(base, { start: '07:00', end: '20:00', expense: 'Y' });
  if (kind === 'out') base.expense = 'N';
  // 시작과 몇 시간으로 받는 종류는 오전 9시부터가 기본이다(건강검진은 시간으로 올릴 때 쓴다).
  if (kind === 'out' || kind === 'leaveout' || kind === 'health') base.start = DEFAULT_START;
  return base;
}

/** 그 종류·갈래가 깔아 주는 값. 직접 적은 값과 가려낼 때 쓴다. */
const defaultsOf = (form, today) =>
  settle({ ...blankForm(form.kind, today), sub: form.sub, ...subOf(form)?.preset });

/**
 * 갈래를 바꾼다. 새 갈래가 깔아 주는 값(소통의 13~14시·목적)이 있으면 그것이 이기고, 떠나는 갈래가 깔아 준 값은
 * 손대지 않은 것만 걷어 낸다 — 직접 적어 둔 시각·목적은 가져간다.
 */
export function withSub(form, value) {
  const was = defaultsOf(form, form.dateFrom);
  const next = { ...form, sub: value };
  const fresh = defaultsOf(next, form.dateFrom);
  for (const key of Object.keys(subOf(form)?.preset || {})) if (form[key] === was[key]) next[key] = fresh[key];
  return settle({ ...next, ...subOf(next)?.preset });
}

/**
 * 종류별 입력칸. required 가 참인데 비어 있으면 화면이 파란 윤곽선을 두른다.
 * @returns {{key:string,label:string,type:string,required:boolean,hint?:string,options?:object[]}[]}
 */
export function fieldsFor(form) {
  const k = form?.kind;
  if (!KINDS[k]) return [];
  const date = { key: 'dateFrom', label: '날짜', type: 'date', required: true };
  const start = { key: 'start', label: '시작', type: 'time', required: true };
  const end = { key: 'end', label: '종료', type: 'time', required: true };
  // 하루 안에서 끝나는 종류는 종료 시각 대신 몇 시간인지를 묻는다 — 1~8시간 칩과 30분을 더하는 칩 하나
  // (2026-10-02 사용자 지정). 종료 시각은 시작에 그것을 더해 나온다(spanEnd). 정시 단위인 교육에는 30분 칩이 없다.
  const span = { key: 'span', label: '몇 시간', type: 'span', required: true, hours: SPAN_HOURS, half: timeStep(form) < 60 };
  // beside 는 날짜와 시작을 한 줄에 나란히 두라는 뜻이다. 그 아래 한 줄을 몇 시간 칩이 다 쓴다.
  const day = { ...date, beside: true };
  if (k === 'flex') {
    // 당일은 날짜·출근시간·사유, 주간은 요일마다의 출근시간, 전체는 다섯 요일에 넣을 출근시간 하나다.
    // 주간·전체(HR 의 Weekly)는 날짜도 사유도 받지 않는다.
    const mode = { key: 'flexMode', label: '기간', type: 'choice', required: true, options: FLEX_MODES.map(({ value, label }) => ({ value, label })) };
    // 출근시간은 늘 일곱 가지를 다 늘어놓는다. 그 요일에 고를 수 없는 것(화~목의 07:00·11:00)은 목록에서 빼지 않고
    // 흐리게 잠가 둔다(2026-10-02 사용자 지정). 당일은 날짜의 요일을 본다 — 날짜가 없거나 주말이면 잠그지 않는다
    // (주말은 날짜 칸이 붉게 표시된다).
    const times = (wide) => FLEX_TIMES.map((t) => ({ value: t.start, label: t.label, disabled: !wide && FLEX_MON_FRI_ONLY.has(t.start) }));
    const dow = DATE_RE.test(form.dateFrom || '') ? asDate(form.dateFrom).getDay() : -1;
    const m = flexModeOf(form);
    // inside 는 날짜 칸처럼 이름(요일)을 칸 안 왼쪽에 적으라는 뜻이다 — 다섯 칸이 세 줄에 들어간다.
    if (m === 'week') return [mode, ...FLEX_DAYS.map((d) => ({ key: d.key, label: d.label, type: 'select', required: true, inside: true, options: times(d.wide) }))];
    if (m === 'all') return [mode, { key: 'flexStart', label: '출근시간', type: 'select', required: true, options: times(false) }];
    return [mode, date,
      { key: 'flexStart', label: '출근시간', type: 'select', required: true, options: times(!(dow >= 2 && dow <= 4)) },
      { key: 'purpose', label: '사유', type: 'text', required: true, hint: '예) 병원 방문' }];
  }
  const sub = { key: 'sub', label: '종류', type: 'choice', required: true, options: SUBS[k] };
  // 종료일을 따로 묻지 않는다. 며칠간인지만 받고(칩 또는 달력에서 끝나는 날) 종료일은 거기서 나온다(tripDates).
  // 휴가의 칩은 1D~5D(하루부터 닷새 — 2026-10-02 사용자 지정)이고 칩 오른쪽에 끝나는 날을 적는 달력이 한 줄로 붙는다.
  // 출장은 1D~7D 이고 달력 대신 위의 도착일 칸(dateTo)이 끝나는 날을 받는다(inline — 2026-10-06 사용자 지정).
  // 어느 쪽을 바꿔도 다른 쪽이 따라온다. 칩보다 길면 달력(도착일)에서 고른다.
  const dayChips = (n) => Array.from({ length: n }, (_, i) => ({ days: i + 1, label: `${i + 1}D` }));
  const days = {
    key: 'days', label: '며칠간', type: 'days', required: true, max: MAX_TRIP_DAYS, hint: '끝나는 날을 달력에서 고를 수도 있습니다',
    chips: dayChips(5),
  };
  // 출장·외근의 차량 조회(2026-10-03 사용자 지정). 켜면 폼의 날짜·시간에 빈 차량을 폼 아래에 보여 주고,
  // 누르면 그 차량을 그 시간으로 신청한다. 화면만의 값이라 HR 신청서에는 들어가지 않는다.
  const car = { key: 'car', label: '차량 조회', type: 'check', required: false, hint: '이 날짜·시간에 빈 차량을 찾습니다. 빈 차량을 누르면 그 시간으로 신청합니다.' };
  // 차량은 근무지(서울·부산)의 것을 잡고, 신청에는 행선지가 있어야 한다(사이트가 요구한다). 폼에 근무지·출장지 칸이 없으면
  // (외근) 차량 조회를 켰을 때 한 줄로 받는다. 출장은 출장지(장소)가 행선지라 근무지만 받는다(사전정산을 꺼 두었을 때).
  // 근무지는 사전정산의 근무지와 같은 값이고 한 번 적으면 남는다.
  // 근태 신청의 필수 칸은 아니다 — 비어 있으면 차량 상자가 말해 준다.
  const carWhere = [
    { key: 'workplace', label: '근무지', type: 'text', required: false, group: 'carwhere', hint: '서울 또는 부산' },
    { key: 'carPlace', label: '행선지', type: 'text', required: false, group: 'carwhere', hint: '차량 신청에 필요 — 예) 부산시청' },
  ];
  if (k === 'out') {
    const edu = codeOf(form) === 'TR';
    const hint = edu ? '정시 단위' : undefined;
    // 외근에는 장소 칸이 없다 — HR 의 외근·출장 신청서가 받는 글은 "내용" 하나이고(지역·목적 줄은 화면에 없다),
    // 패널의 목적이 그 내용이다(2026-10-02 사용자 지정). 장소를 남기려면 목적에 같이 적는다.
    return [sub, day, { ...start, hint }, span,
      { key: 'purpose', label: '목적', type: 'text', required: true, hint: edu ? '예) 안전관리 교육 (서울)' : '예) 과제 협의 (부산시청)' },
      car, ...(form.car ? carWhere : [])];
  }
  if (k === 'leaveout') {
    return [day, start, span, { key: 'purpose', label: '사유', type: 'text', required: true, hint: '예) 병원 방문' }];
  }
  if (k === 'trip') {
    // 출장경비는 묻지 않는다. 늘 선급 예산이라(2026-10-02 사용자 지정) blankForm 이 깔아 둔 'Y' 를 그대로 보낸다.
    // 날짜·시각은 두 줄이고 그 아래 며칠간이 한 줄이다(2026-10-06 사용자 지정, 전에는 세 줄) — 출발일 오른쪽에 출발 시각(묶음 go),
    // 도착일 오른쪽에 도착 시각(묶음 back), 그 아래 "며칠간" 이름이 칩(1D~7D) 왼쪽에 붙은 한 줄(inline). 도착일은 며칠간에서
    // 나오는 값이지만 달력으로 고르면 며칠간이 따라 바뀐다. 시각 칸은 줄의 오른쪽 3할쯤이다(sidepanel.css).
    const fields = [{ ...date, label: '출발일', group: 'go' }, { ...start, label: '출발', hint: '정시 단위', group: 'go' },
      { key: 'dateTo', label: '도착일', type: 'date', required: true, group: 'back' }, { ...end, label: '도착', hint: '정시 단위', group: 'back' },
      { ...days, chips: dayChips(7), inline: true },
      // 출장지·장소는 사전정산과 상관없이 늘 묻고 한 줄에 나란히 선다(2026-10-08 사용자 지정). 출장지는 도시·지역(KTX 역을 여기서 찾는다),
      // 장소는 찾아갈 기관·건물이다. 여비계산서의 출장지 칸에는 둘을 "출장지(장소)"로 넣는다(src/travel.js 의 tripLocation).
      { key: 'place', label: '출장지', type: 'text', required: true, group: 'spot', hint: '예) 대전' },
      { key: 'venue', label: '장소', type: 'text', required: false, group: 'spot', hint: '예) 한국기계연구원' },
      { key: 'purpose', label: '목적', type: 'text', required: true, hint: '예) 착수회의 참석' },
      // 켜면 결재요청이 올라간 뒤 eclass 에 여비계산서(사전정산)를 자동으로 만든다(2026-10-02 사용자 지정).
      // 그 옆에 차량 조회가 나란히 선다(같은 묶음 opts).
      { key: 'settle', label: '여비계산서 사전정산', type: 'check', required: false, group: 'opts' },
      { ...car, group: 'opts' }];
    // 근무지·교통편은 여비계산서를 만들 때만 묻는다. 둘이 한 줄에 나란히 선다(group) — 근무지 옆에 교통편 아이콘이 온다.
    // 근무지는 떠나는 곳이고, 한 번 적으면 다음 신청서에도 남는다(패널이 저장해 둔다). 기차(KTX)가 끼어 있으면
    // KTX 구간의 운임을 근무지의 역에서 찾으므로, 근무지는 그때만 필수다.
    // 출장 증빙은 신청할 때 묻지 않는다 — 신청 내역의 출장 카드에서 넣는다(2026-10-03 사용자 지정).
    if (form.settle) {
      fields.push(
        { key: 'workplace', label: '근무지', type: 'text', required: transportsOf(form).includes('train'), group: 'where', hint: '예) 부산' },
        { key: 'transport', label: '교통편', type: 'icons', required: true, group: 'where', options: TRANSPORTS.map(({ value, label }) => ({ value, label })) },
      );
    } else if (form.car) {
      // 사전정산을 켰으면 그 줄의 근무지가 곧 차량의 근무지다. 꺼 두었으면 근무지 칸이 없어 따로 받는다 — 행선지는 늘 출장지(장소)다.
      fields.push(carWhere[0]);
    }
    return fields;
  }
  if (k === 'leave') {
    // 연차·체력단련은 HR 이 사유를 받지 않는다(사유 줄이 숨어 있다). 구분은 하루짜리 연차에만 묻는다.
    const fields = [sub, { ...date, label: '시작일' }, days];
    if (codeOf(form) === 'LY' && form.days === 1) {
      fields.push({ key: 'half', label: '구분', type: 'choice', required: false, options: HALVES.map(({ value, label }) => ({ value, label })) });
    }
    return fields;
  }
  // 건강검진: 하루 전체 아니면 시간. 사유와 첨부(검진 확인서)는 사이트가 반드시 요구한다.
  const fields = [date, { key: 'allDay', label: '하루 전체', type: 'check', required: false }];
  if (!form.allDay) fields.push(start, span);
  fields.push({ key: 'purpose', label: '사유', type: 'text', required: true, hint: '예) 건강검진' },
    { key: 'file', label: '첨부파일', type: 'file', required: !form.hasFile, hint: form.hasFile ? '올려 둔 파일이 있습니다' : '검진 확인서 등 (필수)' });
  return fields;
}

const filled = (v) => (typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) ? v.length > 0 : v != null && v !== false);

/** 비어 있는 필수칸의 key 목록. */
export function missingFields(form) {
  return fieldsFor(form).filter((f) => f.required && !filled(form[f.key])).map((f) => f.key);
}

/** 출장 증빙(신청 내역의 출장 카드에 넣는 표·영수증)으로 받는 파일 — 이미지와 PDF. 탐색기의 거름망(accept)과 패널의 검사가 같은 목록을 쓴다. */
export const EVIDENCE_ACCEPT = 'image/*,.pdf,application/pdf';

/** accept 목록(쉼표로 나눈 MIME·"image/*"·확장자)에 드는 파일인가. 형식을 모르는 파일(type 이 빔)은 이름의 확장자로만 본다. */
export function acceptsFile(accept, file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  return String(accept || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).some((a) =>
    (a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a));
}

/**
 * 채워진 값끼리의 모순. 사이트가 저장 때 거절할 것을 미리 말한다.
 * @returns {{key:string,message:string}[]}
 */
export function problems(form) {
  const out = [];
  const k = form?.kind;
  if (!KINDS[k]) return out;
  for (const key of ['dateFrom', 'dateTo']) {
    if (filled(form[key]) && !DATE_RE.test(form[key])) out.push({ key, message: '날짜 형식이 올바르지 않습니다.' });
  }
  const timed = k !== 'flex' && k !== 'leave' && !(k === 'health' && form.allDay);
  if (timed) {
    const s = minutesOf(form.start);
    const step = timeStep(form);
    const offStep = step === 60 ? `${nameOf(form)}은 정시 단위로만 올릴 수 있습니다.` : `${step}분 단위로 넣어 주세요.`;
    if (spanned(form)) {
      // 종료 시각은 시작 + 몇 시간이라 따로 볼 것이 없다. 시작과 몇 시간이 단위에 맞는지, 그 날 안에 끝나는지만 본다.
      if (!Number.isNaN(s) && s % step) out.push({ key: 'start', message: offStep });
      if (filled(form.span)) {
        if (!(Number.isInteger(form.span) && form.span > 0) || form.span % step) out.push({ key: 'span', message: offStep });
        else if (s + form.span >= 24 * 60) out.push({ key: 'span', message: '그 날 안에 끝나야 합니다. 시간을 줄여 주세요.' });
      }
    } else {
      const e = minutesOf(form.end);
      const overnight = k === 'trip' && DATE_RE.test(form.dateTo) && form.dateTo > form.dateFrom;
      if (!Number.isNaN(s) && !Number.isNaN(e) && !overnight && e <= s) out.push({ key: 'end', message: '종료가 시작보다 늦어야 합니다.' });
      for (const key of ['start', 'end']) {
        const m = minutesOf(form[key]);
        if (!Number.isNaN(m) && m % step) out.push({ key, message: offStep });
      }
    }
  }
  if (multiDay(form) && filled(form.days) && !validDays(form.days)) {
    out.push({ key: 'days', message: `1~${MAX_TRIP_DAYS} 사이의 날 수를 넣어 주세요.` });
  }
  if (k === 'flex' && flexModeOf(form) === 'day' && DATE_RE.test(form.dateFrom) && form.flexStart) {
    const dow = asDate(form.dateFrom).getDay();
    if (dow === 0 || dow === 6) out.push({ key: 'dateFrom', message: '주말에는 유연근무를 올릴 수 없습니다.' });
    else if (dow >= 2 && dow <= 4 && FLEX_MON_FRI_ONLY.has(form.flexStart)) {
      out.push({ key: 'flexStart', message: '화~목요일에는 07:00·11:00 출근을 고를 수 없습니다.' });
    }
  }
  if (k === 'flex' && flexModeOf(form) !== 'day') {
    // 사이트의 화·수·목 칸에는 07:00·11:00 이 없다. 넣어도 빈 칸으로 남아 저장이 거절된다.
    const all = flexModeOf(form) === 'all';
    for (const d of flexWeekOf(form)) {
      if (d.wide || !FLEX_MON_FRI_ONLY.has(d.start)) continue;
      out.push({ key: all ? 'flexStart' : d.key, message: '07:00·11:00 출근은 월·금요일에만 고를 수 있습니다.' });
      if (all) break;
    }
  }
  return out;
}

/** 올릴 수 있는 상태인가. */
export const readyToSend = (form) => !!KINDS[form?.kind] && !missingFields(form).length && !problems(form).length;

/**
 * 신청서 "내용". 패널의 목적이 그대로 들어간다 — HR 의 외근·출장 신청서가 받는 글은 이 하나뿐이다.
 * 출장은 적은 출장지·장소(와 여비계산서 사전정산을 켰으면 근무지)를 목적 뒤에 괄호로 붙인다 —
 * "착수회의 참석 (출장지: 대전, 장소: 한국기계연구원, 근무지: 부산)". 근무지는 사전정산을 꺼 두면 화면에 없으므로 붙이지 않는다
 * (보이지 않는 값은 올리지 않는다). 문서를 되읽을 때는 splitContent 가 다시 칸으로 가른다.
 */
export function contentOf(form) {
  const purpose = String(form.purpose || '').trim();
  if (form.kind !== 'trip') return purpose;
  const where = [['출장지', form.place], ['장소', form.venue], ...(form.settle ? [['근무지', form.workplace]] : [])]
    .filter(([, v]) => filled(v)).map(([name, v]) => `${name}: ${String(v).trim()}`);
  return where.length ? `${purpose} (${where.join(', ')})` : purpose;
}

const WHERE_TAIL = /\s*\((?:출장지: (.+?))?(?:, )?(?:장소: (.+?))?(?:, )?(?:근무지: (.+?))?\)$/;

/** 출장 문서의 "내용"을 목적·출장지·장소·근무지로 다시 가른다(contentOf 의 반대). 붙여 둔 것이 없으면 전부 목적이다. */
export function splitContent(text) {
  const all = String(text || '').trim();
  const m = all.match(WHERE_TAIL);
  if (!m || !(m[1] || m[2] || m[3])) return { purpose: all, place: '', venue: '', workplace: '' };
  const [place, venue, workplace] = [m[1], m[2], m[3]].map((s) => (s || '').trim());
  return { purpose: all.slice(0, m.index).trim(), place, venue, workplace };
}

/** 한 줄 요약. 확인 문구와 기록에 쓴다. */
export function describe(form) {
  const k = KINDS[form?.kind];
  if (!k) return '';
  const md = (s) => (DATE_RE.test(s || '') ? `${+s.slice(5, 7)}/${+s.slice(8)}` : '?');
  if (form.kind === 'flex') {
    const t = FLEX_TIMES.find((x) => x.start === form.flexStart);
    const m = flexModeOf(form);
    if (m === 'all') return `${k.label} 주간 월~금 ${t ? t.label : '?'}`;
    if (m === 'week') return `${k.label} 주간 ${FLEX_DAYS.map((d) => `${d.label} ${form[d.key] || '?'}`).join(' · ')}`;
    return `${k.label} ${md(form.dateFrom)} ${t ? t.label : '?'} · ${form.purpose || ''}`.trim();
  }
  const span = multiDay(form) && form.dateTo && form.dateTo !== form.dateFrom;
  const days = span ? `${md(form.dateFrom)}~${md(form.dateTo)}` : md(form.dateFrom);
  if (form.kind === 'leave') {
    // 여러 날이면 며칠인지를, 하루면 전일·오전·오후를 적는다.
    const how = span ? `${form.days}일간` : HALVES.find((h) => h.value === halfOf(form)).label;
    return `${nameOf(form)} ${days} ${how}`;
  }
  const time = form.kind === 'health' && form.allDay ? '하루 전체' : `${form.start || '?'}~${form.end || '?'}`;
  return [`${nameOf(form)} ${days} ${time}`, contentOf(form)].filter((x) => filled(x)).join(' · ');
}

/* ------------------------------------------------------------ HR 폼에 넣기 */

const set = (sel, value, label, extra = {}) => ({ op: 'set', sel, value, label, events: ['change'], ...extra });
const text = (sel, value, label) => ({ op: 'set', sel, value, label, events: ['input', 'change'] });
const wait = (ms) => ({ op: 'wait', ms });
// 사이트가 종류·구분을 바꾼 뒤 200ms 뒤에 폼을 비운다. 그 뒤에 넣어야 지워지지 않는다.
// 뒷전 탭은 타이머가 1초 단위로 묶이므로 넉넉히 기다린다(기다림은 순서를 지키기 위한 것이다).
const SETTLE_MS = 700;

function timeOps(form, { minutes = true } = {}) {
  // 시작 시를 바꾸면 사이트가 종료 시를 같은 값으로 맞춘다. 그래서 시작 → 종료 → 분 순서다.
  const ops = [set('#strHour', form.start.slice(0, 2), '시작 시'), set('#endHour', form.end.slice(0, 2), '종료 시')];
  if (minutes) ops.push(set('#strMin', form.start.slice(3), '시작 분'), set('#endMin', form.end.slice(3), '종료 분'));
  return ops;
}

/** 시작~종료가 몇 시간인지. 사이트가 계산해 적는 합계시간과 대조한다(다르면 날짜·시각이 안 들어간 것이다). */
export function spanHours(form) {
  const from = asDate(form.dateFrom);
  const to = asDate(form.kind === 'trip' ? form.dateTo : form.dateFrom);
  const mins = (to - from) / 60000 + minutesOf(form.end) - minutesOf(form.start);
  return Math.floor((Math.floor(mins / 10) * 10 / 60) * 100) / 100;
}

/**
 * 폼 값을 HR 화면에 넣는 일감으로 바꾼다.
 *
 * @param {object} form  패널 폼
 * @param {{action?:'none'|'save'|'request', doc?:{docNo:string,statusCode:string}}} opts
 *   doc 을 주면 그 임시저장 문서를 열어 고친다(종류는 못 바꾼다).
 * @returns {object} src/hr.js 의 runJob 이 먹는 일감
 */
export function buildJob(form, { action = 'none', doc = null } = {}) {
  const kind = KINDS[form?.kind];
  if (!kind) throw new Error('근태 종류를 고르세요.');
  if (!readyToSend(form)) throw new Error('비어 있거나 맞지 않는 칸이 있습니다.');
  const spec = FORMS[kind.form];
  const ops = [];
  const expect = [];
  const read = {};
  const editing = !!doc;

  const code = codeOf(form);

  if (kind.form === 'out' || kind.form === 'trav') {
    if (!editing) ops.push(set('#biztripKind', code, '근태종류'), wait(SETTLE_MS));
    expect.push({ sel: '#biztripKind', value: code, label: '근태종류' }, { sel: '#wrkGubun', value: '04', label: '근태구분(시간)' });
    // 시작일을 넣으면 사이트가 종료일을 같은 날로 맞추고 시각을 초기화한다. 시작일 → 종료일 → 시각 순서다.
    const dateTo = kind.form === 'trav' ? form.dateTo : form.dateFrom;
    ops.push(set('#biztripDateFrom', form.dateFrom, '시작일'), set('#biztripDateTo', dateTo, '종료일'));
    // 분은 외근에서만 열려 있다. 출장·교육은 사이트가 분을 잠가 둔다.
    ops.push(...timeOps(form, { minutes: code === 'OD' }));
    // 화면에 보이는 글 칸은 "내용" 하나다. 숨은 지역·목적 칸은 사이트에서 올린 문서처럼 비워 둔다
    // (예전 문서를 고칠 때 남아 있던 값도 지운다).
    ops.push(text('#biztripPlace', '', '지역'), text('#biztripPurpose', '', '목적'),
      text('#biztripContent', contentOf(form), '내용'));
    if (form.expense) ops.push({ op: 'radio', name: 'biztripExpKind', value: form.expense, label: '출장경비' });
    expect.push({ sel: '#biztripDateFrom', value: form.dateFrom, label: '시작일' }, { sel: '#biztripDateTo', value: dateTo, label: '종료일' },
      { sel: '#biztripContent', value: contentOf(form), label: '내용' }, { sel: '#totalHours', num: spanHours(form), label: '합계시간' });
    Object.assign(read, { totalHours: '#totalHours', days: kind.form === 'trav' ? '#days2' : '#days' });
  } else if (kind.form === 'etc') {
    if (!editing) ops.push(set('#workCodeKind', kind.code, '근태종류'), wait(SETTLE_MS));
    expect.push({ sel: '#workCodeKind', value: kind.code, label: '근태종류' }, { sel: '#wrkGubun', value: '04', label: '근태구분(시간)' });
    ops.push(set('#startDate', form.dateFrom, '시작일'), set('#endDate', form.dateFrom, '종료일'), ...timeOps(form),
      text('#reqRsn', form.purpose.trim(), '사유'));
    expect.push({ sel: '#startDate', value: form.dateFrom, label: '시작일' }, { sel: '#endDate', value: form.dateFrom, label: '종료일' },
      { sel: '#reqRsn', value: form.purpose.trim(), label: '사유' }, { sel: '#totalHours', num: spanHours(form), label: '합계시간' });
    Object.assign(read, { totalHours: '#totalHours', days: '#days' });
  } else if (form.kind === 'leave') {
    const day = { events: ['change', 'focusout'] };   // 일수 계산이 focusout 에 걸려 있다
    if (!editing) ops.push(set('#workCodeKind', code, '휴가종류'), wait(SETTLE_MS));
    expect.push({ sel: '#workCodeKind', value: code, label: '휴가종류' });
    if (code === 'LY') {
      // 연차는 칸이 따로 있다(시작기간·종료기간과 그 구분). 날짜가 다르면 사이트가 종료구분을 비우므로
      // 날짜 → 시작구분 → 종료구분 순서다. 하루짜리는 종료구분이 시작구분을 따라가고, 여러 날은 둘 다 전일이다.
      const gubun = HALVES.find((h) => h.value === halfOf(form)).code;
      ops.push(set('#lyStartDate', form.dateFrom, '시작일', day), wait(SETTLE_MS), set('#lyEndDate', form.dateTo, '종료일', day), wait(SETTLE_MS),
        set('#lyStartDateWrkGubun', gubun, '시작구분'), wait(SETTLE_MS), set('#lyEndDateWrkGubun', gubun, '종료구분'), wait(SETTLE_MS));
      expect.push({ sel: '#lyStartDate', value: form.dateFrom, label: '시작일' }, { sel: '#lyEndDate', value: form.dateTo, label: '종료일' },
        { sel: '#lyStartDateWrkGubun', value: gubun, label: '시작구분' }, { sel: '#lyEndDateWrkGubun', value: gubun, label: '종료구분' });
      Object.assign(read, { days: '#lyDays', hours: '#lyHours' });
    } else {
      // 체력단련은 사이트가 구분을 전일로 잠근다. 구분은 건드리지 않고 날짜만 넣는다.
      ops.push(set('#startDate', form.dateFrom, '시작일', day), wait(SETTLE_MS), set('#endDate', form.dateTo, '종료일', day), wait(SETTLE_MS));
      expect.push({ sel: '#wrkGubun', value: '01', label: '휴가구분(전일)' },
        { sel: '#startDate', value: form.dateFrom, label: '시작일' }, { sel: '#endDate', value: form.dateTo, label: '종료일' });
      Object.assign(read, { days: '#days', hours: '#hours' });
    }
  } else if (kind.form === 'holi') {
    const gubun = form.allDay ? '01' : '04';
    if (!editing) ops.push(set('#workCodeKind', kind.code, '휴가종류'), wait(SETTLE_MS));
    // 구분을 바꾸면 날짜·사유가 지워진다. 구분 → 날짜 → 시각 → 사유 순서다. 날짜 계산은 focusout 에 걸려 있다.
    ops.push(set('#wrkGubun', gubun, '휴가구분'), wait(SETTLE_MS),
      set('#startDate', form.dateFrom, '시작일', { events: ['change', 'focusout'] }), wait(SETTLE_MS),
      set('#endDate', form.dateFrom, '종료일', { events: ['change', 'focusout'] }), wait(SETTLE_MS));
    if (!form.allDay) ops.push(...timeOps(form));
    ops.push(text('#reqRsn', form.purpose.trim(), '사유'));
    if (form.file) ops.push({ op: 'file', name: form.file.name, type: form.file.type, dataUrl: form.file.dataUrl, label: '첨부파일' });
    expect.push({ sel: '#workCodeKind', value: kind.code, label: '휴가종류' }, { sel: '#wrkGubun', value: gubun, label: '휴가구분' },
      { sel: '#startDate', value: form.dateFrom, label: '시작일' }, { sel: '#endDate', value: form.dateFrom, label: '종료일' },
      { sel: '#reqRsn', value: form.purpose.trim(), label: '사유' });
    Object.assign(read, { days: '#days', hours: '#hours', totalHours: '#totalHours' });
  } else if (flexModeOf(form) === 'day') {
    const t = FLEX_TIMES.find((x) => x.start === form.flexStart);
    expect.push({ sel: '#dayGbn', value: 'DA', label: '기간구분(Daily)' });
    ops.push({ op: 'flexRow', edit: editing, row: { wcDate: form.dateFrom.replace(/-/g, ''), wcTime: t.code, reqRsn: form.purpose.trim() } });
    read.rows = { grid: 'docapprflex100Grid', fields: ['wcDate', 'wcTime', 'reqRsn'] };
  } else {
    // 주간·전체는 Weekly 의 월~금 다섯 칸이다. 기간구분을 Weekly 로 바꾸면 사이트가 지금 근무시간표를 읽어
    // 다섯 칸에 채운다 — 그 답이 온 뒤에 넣어야 덮이지 않는다(idle). 저장된 문서는 기간구분이 잠겨 있어 바꾸지 않는다.
    if (!editing) ops.push(set('#dayGbn', 'WE', '기간구분'), { op: 'idle', ms: SETTLE_MS });
    expect.push({ sel: '#dayGbn', value: 'WE', label: '기간구분(Weekly)' });
    for (const d of flexWeekOf(form)) {
      const code = FLEX_TIMES.find((x) => x.start === d.start).code;
      ops.push(set(`#${d.field}`, code, `${d.label}요일 출근시간`));
      expect.push({ sel: `#${d.field}`, value: code, label: `${d.label}요일 출근시간` });
      read[d.field] = `#${d.field}`;
    }
  }

  return {
    route: spec.route, ready: spec.ready, formId: spec.formId,
    open: doc ? { docNo: doc.docNo, statusCode: doc.statusCode || '1' } : null,
    ops, expect, read, action,
    fn: action === 'save' ? spec.save : action === 'request' ? 'apprRequest' : null,
    summary: describe(form),
  };
}

/** 이미 저장된 문서에 버튼 하나만 누르는 일감(상신·회수). 값은 건드리지 않는다. */
export function buildDocJob(item, action) {
  const key = FORM_BY_ID[item.formId];
  if (!key) throw new Error(`${item.formName || item.formId} 은(는) 패널에서 다루지 않는 신청서입니다.`);
  const spec = FORMS[key];
  return {
    route: spec.route, ready: spec.ready, formId: spec.formId,
    open: { docNo: item.docNo, statusCode: item.status },
    ops: [], expect: [], read: {}, action,
    fn: action === 'request' ? 'apprRequest' : action === 'recall' ? 'apprReqCancel' : null,
    summary: item.summary,
  };
}

/** 결재완료 건의 취소신청 일감. 사유는 필수다. */
export function buildCancelJob(item, reason) {
  const spec = CANCEL_FORMS[item.formId];
  if (!spec) throw new Error(`${item.formName || item.formId} 은(는) 취소신청서가 없습니다.`);
  const why = String(reason || '').trim();
  if (!why) throw new Error('취소 사유를 적어 주세요.');
  const year = (item.from || '').slice(0, 4) || String(new Date().getFullYear());
  return {
    route: spec.route, ready: { global: spec.grid, fn: 'apprRequest' }, formId: item.formId, open: null,
    ops: [{ op: 'cancelRow', grid: spec.grid, pop: spec.pop, docNo: item.docNo, reason: why,
      params: { fromDate: `${year}-01-01`, toDate: `${year}-12-31`, ...(spec.workGbn ? { workGbn: spec.workGbn } : {}) } }],
    expect: [], read: {}, action: 'request', fn: 'apprRequest', summary: `${item.summary} 취소신청`,
  };
}

/* ------------------------------------------------------------ 신청 내역 */

const dashed = (s) => (/^\d{8}$/.test(s || '') ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : (DATE_RE.test(s || '') ? s : ''));
const colon = (s) => (/^\d{4}$/.test(s || '') ? `${s.slice(0, 2)}:${s.slice(2)}` : '');

/** 결재 상태 코드(SY02). */
export const STATUS = { TEMP: '1', WAIT: '2', REQUESTED: '3', REJECTED: '4', APPROVED: '5', RECALLED: '6', DELETED: 'D' };

/**
 * 신청 내역의 결재 상태 딱지에 적는 말(2026-10-04 사용자 지정) — 올려 둔 것(결재대기·결재요청)은 "신청", 결재가 끝난 것은 "승인"이다.
 * 나머지(임시저장·반려·회수)는 HR 의 이름 그대로다.
 */
const STATUS_LABEL = { [STATUS.WAIT]: '신청', [STATUS.REQUESTED]: '신청', [STATUS.APPROVED]: '승인' };
export const statusLabel = (it) => STATUS_LABEL[it?.status] || it?.statusName || '';

/**
 * 취소신청이 걸린 원 문서의 기록(storage 키). { [원 문서번호]: { at, cancelDocNo } }
 * 취소신청서가 결재돼도 원 문서는 HR 목록에서 "결재완료"로 그대로다(2026-10-07 실제 목록 — HR 에서 출장 취소신청이 승인된 뒤에도
 * 패널은 원 출장을 "승인"으로 보였다). 그래서 패널이 올린 취소신청을 적어 두고, HR 목록의 취소신청서는 내용을 읽어(src/hr.js 의
 * hrCancelRefs) 어느 원 문서를 무르는지 이곳에 잇는다. 취소신청서의 결재 상태로 원 문서가 "취소 중"인지 "취소됨"인지 가린다.
 */
export const CANCELLING_KEY = 'attendCancelling';
const CANCELLING_DAYS = 365;
export const CANCELLING_LABEL = '취소 중';
export const CANCELLED_LABEL = '취소';

/** HR 목록의 취소신청서인가 — 패널이 모르는 신청서 가운데 취소신청 화면(apprcncl…)의 것이거나 이름에 "취소"가 든 것. */
export function isCancelDoc(it) {
  return !!it && !FORM_BY_ID[it.formId] && (/\/apprcncl/i.test(it.api || '') || /취소/.test(it.formName || ''));
}

/**
 * 원 문서마다 취소가 어디까지 왔는가. 'pending' = 취소 중(취소신청서 결재 전, 또는 패널이 올렸는데 아직 목록에서 그 취소신청서를
 * 못 이었다), 'done' = 취소됨(취소신청서 결재완료). 취소신청서가 반려·회수됐으면 넣지 않는다. 원 문서가 결재완료일 때만 본다.
 * @param {object[]} items listItems 의 결과(취소신청서까지 전부)
 * @param {object} kept CANCELLING_KEY 에 담아 둔 것
 * @returns {Map<string, 'pending'|'done'>}
 */
export function cancellingOf(items, kept) {
  const out = new Map();
  const byNo = new Map((items || []).map((it) => [it.docNo, it]));
  const stateOf = (c) => (c.status === STATUS.APPROVED ? 'done' : c.status === STATUS.WAIT || c.status === STATUS.REQUESTED ? 'pending' : '');
  const put = (docNo, state) => {
    const it = byNo.get(docNo);
    if (!state || !it || it.status !== STATUS.APPROVED || out.get(docNo) === 'done') return;
    out.set(docNo, state);
  };
  // 목록의 취소신청서가 원 문서번호를 직접 들고 있으면(befDocNo) 그것으로 잇는다.
  for (const c of items || []) if (c.befDocNo && isCancelDoc(c)) put(c.befDocNo, stateOf(c));
  for (const [docNo, v] of Object.entries(kept || {})) {
    const c = v?.cancelDocNo ? byNo.get(v.cancelDocNo) : null;
    // 이은 취소신청서가 목록에 있으면 그 상태를, 없으면(아직 못 이었다·읽은 기간 밖) 취소 중으로 본다.
    put(docNo, c ? stateOf(c) : 'pending');
  }
  return out;
}

/**
 * 담아 둔 취소 기록에서 끝난 것을 걷는다 — 원 문서가 목록에 결재완료가 아닌 상태로 보이면, 이은 취소신청서가 반려·회수·삭제됐으면,
 * 그리고 오래된 것. 목록에 아예 없는 것은 읽은 기간 밖일 수 있어 남긴다(오래되면 걷힌다).
 */
export function pruneCancelling(kept, items, now = Date.now()) {
  const out = {};
  const byNo = new Map((items || []).map((it) => [it.docNo, it]));
  const dead = new Set([STATUS.REJECTED, STATUS.RECALLED, STATUS.DELETED, STATUS.TEMP]);
  for (const [docNo, v] of Object.entries(kept || {})) {
    const it = byNo.get(docNo);
    if (it && it.status !== STATUS.APPROVED) continue;
    const c = v?.cancelDocNo ? byNo.get(v.cancelDocNo) : null;
    if (c && dead.has(c.status)) continue;
    if (!(now - (+v?.at || 0) < CANCELLING_DAYS * 86400000)) continue;
    out[docNo] = v;
  }
  return out;
}

/**
 * 취소신청서를 읽어 알게 된 원 문서번호들을 기록에 잇는다. 이미 있는 기록은 그 취소신청서 번호만 채운다.
 * @param {object} kept CANCELLING_KEY 에 담아 둔 것
 * @param {string} cancelDocNo 취소신청서 번호
 * @param {string[]} befs 그 취소신청서가 무르는 원 문서번호들
 */
export function linkCancel(kept, cancelDocNo, befs, now = Date.now()) {
  const out = { ...(kept || {}) };
  for (const bef of befs || []) {
    if (!bef) continue;
    out[bef] = { at: out[bef]?.at || now, cancelDocNo };
  }
  return out;
}

/** 패널 폼으로 되돌릴 수 있는 종류. 이름은 HR 목록의 근태종류 이름이고, 값은 그 종류가 올라가는 신청서다. */
const FILLABLE = {
  외근: 'TRO', 교육: 'TRO', 국내출장: 'TR', 외출: 'ET', '정기 건강검진': 'LV', 연차: 'LV', 체력관리: 'LV', 유연근무: 'FW',
};

/**
 * 문서함 목록 한 줄을 화면용으로 바꾸고, 그 상태에서 할 수 있는 일을 단다.
 *   임시저장 → 수정·상신·삭제 / 결재요청(승인 전) → 변경·회수 / 결재완료 → 변경·취소신청 / 회수 → 삭제
 * 변경(change)은 올린 건의 시간·날짜를 고치는 길이다. HR 에는 올린 문서를 고치는 버튼이 없어서, 승인 전이면
 * 회수하고 승인 뒤면 취소신청을 올린 다음 같은 내용을 새 신청서로 불러온다.
 * 패널이 다루는 종류가 아니면 수정·변경은 달지 않는다(목록에는 보인다).
 * 같은 내용으로 새 신청서를 쓰는 "복사"는 뺐다(2026-10-03 사용자 지정) — 반려된 건처럼 할 일이 없는 줄에는 버튼이 없다.
 */
export function listItem(row) {
  const from = dashed(row.startDate);
  const to = dashed(row.endDate) || from;
  const start = colon(row.startTime);
  const end = colon(row.endTime);
  const form = FORM_BY_ID[row.formId];
  const kindName = row.workCodeKindName || row.formName || '';
  const fillable = !!form && FILLABLE[kindName] === row.formId;
  const st = String(row.statusCode || '');
  const actions = [];
  if (st === STATUS.TEMP) {
    if (fillable) actions.push('edit');
    if (form) actions.push('request');
    actions.push('delete');
  } else if (st === STATUS.REQUESTED || st === STATUS.WAIT) {
    if (form && fillable) actions.push('change');
    if (form) actions.push('recall');
  } else if (st === STATUS.APPROVED && CANCEL_FORMS[row.formId]) {
    if (fillable) actions.push('change');
    actions.push('cancel');
  } else if (st === STATUS.RECALLED) {
    // 회수한 문서는 더 쓸 일이 없어 지울 수 있게 한다(2026-10-02 사용자 지정). HR 문서함 화면은 임시저장에만
    // 삭제 버튼을 보여 준다 — 회수 건을 서버가 받아 주지 않으면 목록에 그대로 남고, 패널이 그렇게 말한다.
    actions.push('delete');
  }
  const when =from ? `${+from.slice(5, 7)}/${+from.slice(8)}${to && to !== from ? `~${+to.slice(5, 7)}/${+to.slice(8)}` : ''}` : '';
  // 주간(Weekly) 유연근무는 날짜·시각 자리에 "Weekly" 라는 글이 온다(2026-10-02 실제 목록). 날짜가 없어 신청한 날로 놓인다.
  const weekly = row.formId === 'FW' && row.startDate === 'Weekly';
  const time = start && end ? `${start}~${end}` : weekly ? '주간' : (row.wrkGubunName || '');
  return {
    docNo: row.docNo, status: st, statusName: row.statusName || '', formId: row.formId, formName: row.formName || '',
    kindName, from, to, start, end, gubun: row.wrkGubunName || '', reason: row.reqRsn || '', rejectNote: row.aprvCmnt || '',
    // 신청한 날. 근태 날짜가 없는 문서(취소신청서)를 기간에 놓을 때 쓴다.
    requested: DATE_RE.test(String(row.reqstDate || '').slice(0, 10)) ? String(row.reqstDate).slice(0, 10) : '',
    // 취소신청서면 무르는 원 문서의 번호(취소신청 표의 칸 이름 — src/hr.js 의 cancelRow). 목록에 이 칸이 오는지는 아직 못 봤다.
    befDocNo: row.befDocNo ? String(row.befDocNo) : '',
    api: String(row.pgmUrlAd || '').replace(/\/view$/, ''), actions,
    summary: [kindName, when, time].filter(Boolean).join(' '),
    // HR 화면에서 이 문서를 열 때 쓰는 값. 문서함에서 줄을 두 번 누르면 사이트가 이것들을 묶어 탭을 연다
    // (pageMdiTabOpen — 2026-10-02 결재문서함 화면 소스). 화면 주소를 모르는 줄이면 null 이다.
    web: row.pgmUrlAd ? {
      pgmId: row.pgmId ?? '', pgmUrlAd: String(row.pgmUrlAd),
      param: {
        docNo: row.docNo, emplNo: row.createEmplNo ?? '', emplNameHan: row.createEmplName ?? '',
        orgCode: row.orgCode ?? '', orgNameHan: row.orgNameHan ?? '', statusCode: st,
      },
    } : null,
  };
}

/**
 * 목록의 한 건이 패널의 어느 종류인가 — 종류 줄에서 고른 종류의 신청 내역만 보일 때 쓴다(2026-10-03 사용자 지정).
 * 휴가/공가 신청서(LV)는 정기 건강검진만 건강이고 나머지(연차·체력관리·병가·경조 …)는 휴가다.
 * 패널이 모르는 신청서(취소신청서 등)는 '' — "내역"(전부 보기)에서만 보인다.
 */
export function kindOfItem(it) {
  const id = it?.formId;
  if (id === 'TR') return 'trip';
  if (id === 'TRO') return 'out';
  if (id === 'FW') return 'flex';
  if (id === 'ET') return 'leaveout';
  if (id === 'LV') return it.kindName === '정기 건강검진' ? 'health' : 'leave';
  return '';
}

/** 종류 하나의 신청 내역. kind 가 'all' 이거나 비어 있으면 전부다. */
export function itemsOfKind(items, kind) {
  return !kind || kind === 'all' ? items || [] : (items || []).filter((it) => kindOfItem(it) === kind);
}

/** 목록을 화면 차례로. 삭제된 것은 뺀다. 최근 신청이 위로 온다. */
export function listItems(rows) {
  return (rows || []).filter((r) => r && r.docNo && String(r.statusCode) !== STATUS.DELETED)
    .map(listItem).sort((a, b) => (a.docNo < b.docNo ? 1 : -1));
}

/**
 * 신청 내역에 보여줄 건 — **근태 날짜**가 그 기간에 걸친 것만, 날짜가 늦은 것이 위로 온다.
 * 근태 날짜가 없는 문서(취소신청서)는 신청한 날로 놓고, 그것도 없으면 빼지 않고 보여준다.
 */
export function itemsIn(items, from, to) {
  const day = (it) => it.from || it.requested || '';
  return (items || [])
    .filter((it) => !day(it) || (day(it) <= to && (it.to || day(it)) >= from))
    .sort((a, b) => `${day(b)} ${b.start}`.localeCompare(`${day(a)} ${a.start}`) || (a.docNo < b.docNo ? 1 : -1));
}

/**
 * 기간을 넓혀 그 안의 **출장 줄의 출장기간을 다 덮게** 한다 — 여비계산서는 출장기간으로 찾으므로(src/travel.js 의 tripDocFor) 조회 기간에
 * 한쪽만 걸친 출장(4W 로 9/10 부터 보는데 9/9~9/10 출장)의 계산서를 찾으려면 목록을 그 출장의 첫날부터 읽어야 한다(2026-10-08 사용자 보고:
 * 그런 줄이 "조회 기간이 이 출장기간을 다 덮지 않습니다"라고만 했다). 출장이 아닌 줄과 근태 날짜가 없는 줄은 보지 않는다.
 * @param {{from:string,to:string}} range YYYY-MM-DD
 * @param {object[]} items 보이는 줄(listItems 의 것)
 * @returns {{from:string,to:string}} 넓힌 기간(넓힐 것이 없으면 그대로)
 */
export function rangeCovering({ from, to }, items) {
  for (const it of items || []) {
    if (it.formId !== 'TR' || !it.from) continue;
    if (it.from < from) from = it.from;
    const end = it.to || it.from;
    if (end > to) to = end;
  }
  return { from, to };
}

/** 이미 지난 건인가 — 끝나는 날이 오늘보다 앞이다. */
export function isPast(it, today) {
  const end = it.to || it.from || it.requested;
  return !!end && end < today;
}

/** 현황 카드의 종류 딱지. HR 의 긴 이름을 줄인다. */
const PLAN_LABEL = { 국내출장: '출장', 해외출장: '출장', '정기 건강검진': '검진', 유연근무: '유연', 체력관리: '체력단련' };

/**
 * 홈의 WORKSPACE 카드가 근태를 세는 세 묶음(2026-10-02 사용자 지정). kinds 는 HR 목록의 근태종류 이름이다.
 * 외근에는 같은 신청서로 올리는 교육이 들어가고, 휴가는 연차·체력단련(HR 의 "체력관리")·외출·정기 건강검진이다
 * (외출·건강검진은 2026-10-07 사용자 지정으로 더했다 — 자리를 비우는 일이라 휴가로 센다).
 * 여기에 없는 종류(유연근무)는 홈 카드에 올리지 않는다 — 패널의 현황에는 다 보인다.
 */
export const PLAN_GROUPS = [
  { key: 'trip', label: '출장', kinds: ['국내출장', '해외출장'] },
  { key: 'out', label: '외근', kinds: ['외근', '교육'] },
  { key: 'leave', label: '휴가', kinds: ['연차', '체력관리', '외출', '정기 건강검진'] },
];
const GROUP_OF = Object.fromEntries(PLAN_GROUPS.flatMap((g) => g.kinds.map((k) => [k, g.key])));

/**
 * WORKSPACE 현황에 회의실·차량 예약과 나란히 보여줄 근태. 올려 두었거나(결재요청) 결재가 끝난 것 가운데
 * 그 기간에 걸친 것만, 날짜가 빠른 순으로 준다. 임시저장·반려·회수는 잡힌 일정이 아니므로 뺀다.
 * 취소신청서처럼 패널이 모르는 신청서도 뺀다 — 원래 건과 같은 날짜로 한 번 더 보이게 된다.
 * @param {object[]} items listItems 의 결과
 * @param {Map<string,string>|null} [cancelling] 취소가 걸린 문서번호(cancellingOf)
 */
export function plansIn(items, from, to, cancelling = null) {
  const live = new Set([STATUS.WAIT, STATUS.REQUESTED, STATUS.APPROVED]);
  // 취소신청이 걸린 건은 상태를 "취소 중"으로 적고(홈 카드가 종류 딱지 아래에 적는다), 취소가 결재된 건은 잡힌 일정이 아니라 뺀다.
  const off = cancelling instanceof Map ? cancelling : new Map();
  return (items || [])
    .filter((it) => FORM_BY_ID[it.formId] && it.from && live.has(it.status) && it.from <= to && (it.to || it.from) >= from)
    .filter((it) => off.get(it.docNo) !== 'done')
    .map((it) => ({
      docNo: it.docNo, label: PLAN_LABEL[it.kindName] || it.kindName, group: GROUP_OF[it.kindName] || '', from: it.from, to: it.to || it.from,
      // state 는 결재 상태를 줄인 말(신청·승인 — statusLabel)이다. 홈 카드가 종류 딱지 아래에 적는다.
      start: it.start, end: it.end, gubun: it.gubun, status: it.statusName, state: off.has(it.docNo) ? CANCELLING_LABEL : statusLabel(it), reason: it.reason,
      cancelling: off.has(it.docNo),
    }))
    .sort((a, b) => `${a.from} ${a.start}`.localeCompare(`${b.from} ${b.start}`));
}

const hhmm = (h, m) => (/^\d{2}$/.test(h || '') ? `${h}:${/^\d{2}$/.test(m || '') ? m : '00'}` : '');

/**
 * HR 문서 한 건을 패널 폼으로 되돌린다(수정·복사용). 다루지 않는 종류면 null.
 * @param {string} formId  TRO·TR·ET·LV·FW
 * @param {object} d       HR 의 문서 조회 응답 한 줄
 */
export function formFromDoc(formId, d, today) {
  if (!d) return null;
  const f = blankForm('', today);
  if (formId === 'TRO' || formId === 'TR') {
    // 교육은 외근/교육 신청서(TRO)에 올라간 것만 다룬다.
    const kind = d.biztripKind === 'OD' || (d.biztripKind === 'TR' && formId === 'TRO') ? 'out' : d.biztripKind === 'DBT' ? 'trip' : null;
    if (!kind || String(d.wrkGubun) !== '04') return null;
    // 문서의 글은 "내용"이다. 숨은 목적 칸은 내용이 비었을 때만 본다(예전에 패널이 따로 채워 둔 문서).
    const text = String(d.biztripContent || '').trim() || String(d.biztripPurpose || '').trim();
    // 출장은 내용 뒤에 붙여 올린 출장지·장소·근무지를 다시 칸으로 가른다.
    const where = kind === 'trip' ? splitContent(text) : { purpose: text };
    const dateTo = d.biztripDateTo || d.biztripDateFrom;
    // 목적이 "부서소통회"인 외근은 소통 갈래로 돌아온다(HR 에는 그 갈래가 없다 — 외근으로 올라가 있다).
    const meet = d.biztripKind === 'OD' && where.purpose === MEET.preset.purpose;
    const start = hhmm(d.strHour, d.strMin);
    const end = hhmm(d.endHour, d.endMin);
    return { ...f, kind, sub: meet ? MEET.value : kind === 'out' ? d.biztripKind : '',
      dateFrom: d.biztripDateFrom, dateTo, days: spanDays(d.biztripDateFrom, dateTo),
      start, end, span: kind === 'out' ? spanOf(start, end) : '',
      // 근무지를 붙여 올린 문서는 여비계산서 사전정산을 켠 채로 돌아온다 — 그래야 그 칸이 보인다(출장지·장소는 늘 보인다).
      ...where, settle: !!where.workplace, expense: d.biztripExpKind || (kind === 'trip' ? 'Y' : 'N') };
  }
  if (formId === 'ET') {
    if (d.workCodeKind !== 'ZLO') return null;
    const start = hhmm(d.strHour, d.strMin);
    const end = hhmm(d.endHour, d.endMin);
    return { ...f, kind: 'leaveout', dateFrom: d.startDate, dateTo: d.startDate,
      start, end, span: spanOf(start, end), purpose: String(d.reqRsn || '').trim() };
  }
  if (formId === 'LV' && (d.workCodeKind === 'LY' || d.workCodeKind === 'LH')) {
    const dateTo = d.endDate || d.startDate;
    const days = spanDays(d.startDate, dateTo);
    const half = HALVES.find((h) => h.code === String(d.wrkGubun));
    const last = String(d.nextWrkGubun || d.wrkGubun);
    // 패널은 "하루짜리 오전·오후"와 "전일로 이어지는 여러 날"만 그린다. 첫날 오후에 시작하거나 마지막 날 오전에
    // 끝나는 연차는 HR 에서 연다 — 여기서 열면 전일로 바뀌어 올라간다.
    if (!validDays(days) || !half) return null;
    if (days > 1 ? half.value !== '' || last !== '01' : last !== half.code) return null;
    return { ...f, kind: 'leave', sub: d.workCodeKind, dateFrom: d.startDate, dateTo, days, half: half.value };
  }
  if (formId === 'LV') {
    if (d.workCodeKind !== 'HCL') return null;
    const allDay = String(d.wrkGubun) !== '04';
    const start = allDay ? '' : hhmm(d.strHour, d.strMin);
    const end = allDay ? '' : hhmm(d.endHour, d.endMin);
    return { ...f, kind: 'health', dateFrom: d.startDate, dateTo: d.startDate, allDay,
      start, end, span: spanOf(start, end),
      purpose: String(d.reqRsn || '').trim(), hasFile: !!d.atchFileId };
  }
  if (formId === 'FW') {
    if (d.dayGbn === 'WE') {
      // 주간 문서: 요일별 시간 코드(monTime … friTime). 다섯 요일이 같으면 "전체"로 돌아온다.
      const week = Object.fromEntries(FLEX_DAYS.map((x) => [x.key, FLEX_BY_CODE[String(d[x.field] ?? '')]?.start || '']));
      const starts = Object.values(week);
      const same = !!starts[0] && !FLEX_MON_FRI_ONLY.has(starts[0]) && starts.every((s) => s === starts[0]);
      return { ...f, kind: 'flex', flexMode: same ? 'all' : 'week', flexStart: same ? starts[0] : '', ...week };
    }
    if (d.dayGbn && d.dayGbn !== 'DA') return null;
    const t = FLEX_TIMES.find((x) => x.code === String(d.wcTime));
    return { ...f, kind: 'flex', dateFrom: dashed(d.wcDate), dateTo: dashed(d.wcDate), flexStart: t ? t.start : '', purpose: String(d.reqRsn || '').trim() };
  }
  return null;
}

/* ------------------------------------------------------------ 말로 채우기 */

/** Claude 가 돌려준 조각을 믿을 수 있는 값만 남긴다. 모양이 틀린 값은 버린다 — 틀린 값으로 채우느니 비워 둔다. */
export function normalizePatch(raw) {
  const p = {};
  if (!raw || typeof raw !== 'object') return p;
  if (KINDS[raw.kind]) p.kind = raw.kind;
  for (const key of ['dateFrom', 'dateTo']) if (DATE_RE.test(raw[key] || '')) p[key] = raw[key];
  for (const key of ['start', 'end']) {
    const m = String(raw[key] ?? '').match(/^(\d{1,2}):(\d{2})$/);
    if (m && +m[1] < 24 && +m[2] < 60) p[key] = `${pad(+m[1])}:${m[2]}`;
  }
  for (const key of ['place', 'venue', 'purpose']) {
    if (typeof raw[key] === 'string' && raw[key].trim()) p[key] = raw[key].trim().slice(0, 200);
  }
  if (FLEX_TIMES.some((t) => t.start === raw.flexStart)) p.flexStart = raw.flexStart;
  if (FLEX_MODES.some((m) => m.value === raw.flexMode)) p.flexMode = raw.flexMode;
  // 요일별 출근시간은 그 요일에 고를 수 있는 값만 받는다(화~목의 07:00·11:00 은 버린다).
  for (const d of FLEX_DAYS) if (flexTimesFor(d.wide).some((t) => t.start === raw[d.key])) p[d.key] = raw[d.key];
  if (validDays(raw.days)) p.days = raw.days;
  if (typeof raw.allDay === 'boolean') p.allDay = raw.allDay;
  // 갈래는 여기서 모양만 본다. 그 종류의 갈래가 맞는지는 종류가 정해진 뒤 applyPatch 가 가린다.
  if (Object.values(SUBS).flat().some((s) => s.value === raw.sub)) p.sub = raw.sub;
  if (raw.half === 'am' || raw.half === 'pm') p.half = raw.half;
  else if (raw.half === 'full') p.half = '';
  // 출장경비(expense)는 받지 않는다. 화면에 칸이 없는 값을 말로 바꿀 수 있으면 무엇이 올라가는지 볼 수 없다.
  return p;
}

/**
 * 조각을 폼에 얹는다. 종류가 바뀌면 그 종류의 기본값부터 깔고, 이미 적힌 값은 조각에 있을 때만 덮는다.
 * @returns {{form: object, changed: string[]}}
 */
export function applyPatch(form, patch, today) {
  const p = normalizePatch(patch);
  let next = { ...form };
  const changed = [];
  if (p.kind && p.kind !== form.kind) {
    const fresh = blankForm(p.kind, today);
    // 종류를 옮겨도 **직접 적어 둔** 날짜·목적은 가져간다. 앞 종류·갈래가 깔아 준 기본값(소통의
    // 13~14시, 출장의 7~20시)은 두고 가고, 새 종류에 기본값이 있는 칸은 그 기본값이 이긴다.
    const was = defaultsOf(form, today);
    // 다만 누구에게나 까는 시작 09:00 은 그 종류만의 기본값이 아니므로, 직접 적어 둔 시작 시각에 진다.
    const soft = (key) => key === 'start' && fresh.start === DEFAULT_START;
    for (const key of ['start', 'end', 'span', 'purpose']) {
      if (filled(form[key]) && form[key] !== was[key] && (!filled(fresh[key]) || soft(key))) fresh[key] = form[key];
    }
    if (!spanned(fresh)) fresh.span = '';
    if (form.dateFrom && form.dateFrom !== today) Object.assign(fresh, { dateFrom: form.dateFrom, dateTo: form.dateTo });
    // 근무지는 종류를 옮겨도 따라다닌다 — 한 번 적어 두면 계속 남는 값이다.
    fresh.workplace = form.workplace || '';
    next = fresh;
    changed.push('kind');
  }
  // 갈래부터 얹는다 — 갈래가 까는 값(소통의 13~14시)을 같이 말한 시각·목적이 덮을 수 있게.
  // 그 종류에 없는 갈래(출장에 "연차")는 버린다.
  if (p.sub && p.sub !== next.sub && (SUBS[next.kind] || []).some((s) => s.value === p.sub)) {
    next = withSub(next, p.sub);
    changed.push('sub');
  }
  for (const [key, value] of Object.entries(p)) {
    if (key === 'kind' || key === 'sub' || next[key] === value) continue;
    next[key] = value;
    changed.push(key);
  }
  // "20일부터 21일까지" 처럼 종료일로 말했으면 며칠간으로 바꾼다. 날짜를 하나만 말했으면 지금 날 수 그대로다.
  if (multiDay(next) && p.dateTo && !p.days) {
    const span = spanDays(next.dateFrom, p.dateTo);
    if (validDays(span) && span !== next.days) { next.days = span; changed.push('days'); }
  }
  // 출장은 출장지·장소 칸이 있어 말로 한 곳이 거기에 들어간다. 외근에는 그 칸이 없어 목적 뒤에 붙여 눈에 보이게 한다
  // — 보이지 않는 값이 올라가면 안 된다. 장소를 쓰지 않는 종류(휴가·유연근무·외출·건강검진)에서는 버린다.
  const hasPlace = next.kind === 'trip';
  if (!hasPlace && (filled(next.place) || filled(next.venue))) {
    const purpose = String(next.purpose || '').trim();
    const spot = [next.place, next.venue].map((s) => String(s || '').trim()).filter((s) => s && !purpose.includes(s)).join(' ');
    if (next.kind === 'out' && spot) {
      next.purpose = purpose ? `${purpose} - ${spot}` : spot;
      if (!changed.includes('purpose')) changed.push('purpose');
    }
    next.place = '';
    next.venue = '';
  }
  if (next.kind === 'health' && (p.start || p.end) && p.allDay === undefined) next.allDay = false;
  // 요일별로 말했으면("월요일 7시, 금요일 11시") 따로 말하지 않아도 주간이다.
  if (next.kind === 'flex' && !p.flexMode && next.flexMode !== 'week' && FLEX_DAYS.some((d) => p[d.key])) {
    next.flexMode = 'week';
    changed.push('flexMode');
  }
  // "2시부터 4시까지" 처럼 종료 시각으로 말했으면 몇 시간으로 바꾼다. 시작만 말했으면 지금 시간 그대로 따라간다.
  // 종류를 옮기며 가져온 시작·종료(출장 → 외근)도 여기서 몇 시간이 된다.
  if (spanned(next) && (p.end || !filled(next.span)) && TIME_RE.test(next.start || '') && TIME_RE.test(next.end || '')) {
    const span = spanOf(next.start, next.end);
    if (span !== next.span) { next.span = span; changed.push('span'); }
  }
  // 종료일은 늘 며칠간에서, 종료 시각은 몇 시간에서 나온다. 하루짜리 종류는 시작일을 따라간다.
  next = settle(next);
  if (next.kind === 'leave') {
    // 휴가에는 시각 칸이 없다. 시각으로 말했으면 오전·오후로 바꿔 읽고 시각은 남기지 않는다.
    if ((p.start || p.end) && p.half === undefined) {
      const half = halfFromTimes(p.start, p.end);
      if (half !== next.half) { next.half = half; changed.push('half'); }
    }
    Object.assign(next, { start: '', end: '', span: '' });
  }
  // 화면에 칸이 없는 값은 바뀐 칸으로 치지 않는다(종료 시각은 몇 시간 칸이 대신한다).
  const gone = new Set(['dateTo', ...(hasPlace ? [] : ['place', 'venue']),
    ...(next.kind === 'leave' ? ['start', 'end'] : spanned(next) ? ['end'] : [])]);
  return { form: next, changed: changed.filter((k) => !gone.has(k)) };
}

/**
 * 시각으로 말한 휴가를 구분으로 읽는다(2026-10-02 사용자 지정). 기본은 전일이고,
 * 끝나는 시각이 13시 이전이면 오전, 시작하는 시각이 13시 이후면 오후다.
 */
export function halfFromTimes(start, end) {
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (!Number.isNaN(e) && e <= 13 * 60) return 'am';
  if (!Number.isNaN(s) && s >= 13 * 60) return 'pm';
  return '';
}

const KIND_WORDS = [
  ['out', /소통회/], ['trip', /출장/], ['leaveout', /외출/], ['out', /외근|교육/],
  ['health', /건강\s*검진|검진/], ['flex', /자율\s*출퇴근|유연\s*근무|출근\s*시간|시차\s*출근/],
  ['leave', /연차|반차|휴가|체력\s*(?:단련|관리)/],
];
const SUB_WORDS = [['MEET', /소통회/], ['TR', /교육/], ['LH', /체력\s*(?:단련|관리)/], ['LY', /연차|반차/], ['OD', /외근/]];
const DOW = '일월화수목금토';

function localDate(t, today) {
  if (/모레/.test(t)) return addDays(today, 2);
  if (/내일/.test(t)) return addDays(today, 1);
  if (/오늘/.test(t)) return today;
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) || t.match(/(?<![\d:])(\d{1,2})\/(\d{1,2})(?![\d:])/);
  if (m) {
    const d = `${today.slice(0, 4)}-${pad(+m[1])}-${pad(+m[2])}`;
    // 해를 안 적었고 이미 지난 날이면 내년으로 본다(12월에 "1월 5일").
    return d < addDays(today, -180) ? `${+today.slice(0, 4) + 1}${d.slice(4)}` : d;
  }
  m = t.match(/(다음\s*주|담주|이번\s*주|금주)?\s*([일월화수목금토])요일/);
  if (m) {
    const want = DOW.indexOf(m[2]);
    const base = asDate(today);
    const monday = addDays(today, -((base.getDay() + 6) % 7));
    const offset = (want + 6) % 7;
    if (/다음|담주/.test(m[1] || '')) return addDays(monday, 7 + offset);
    const thisWeek = addDays(monday, offset);
    return m[1] || thisWeek >= today ? thisWeek : addDays(thisWeek, 7);
  }
  return null;
}

/**
 * 문장에 나온 **상대 날짜**(오늘·내일·모레·○요일)를 나온 차례대로 실제 날짜로 바꾼다.
 * Claude 가 요일 셈을 틀린 적이 있다(금요일에 "다음 주 수요일"을 목요일 날짜로 답함, 2026-10-02).
 * 달력 셈은 규칙이 틀리지 않으므로, 이런 표현이 있으면 Claude 의 날짜 대신 이것을 쓴다.
 */
export function relativeDates(textIn, today) {
  const t = String(textIn || '');
  const re = /모레|내일|오늘|(?:다음\s*주|담주|이번\s*주|금주)?\s*[일월화수목금토]요일/g;
  const out = [];
  for (const m of t.matchAll(re)) {
    const d = localDate(m[0], today);
    if (d) out.push(d);
  }
  return out;
}

/** Claude 가 준 조각의 날짜를 상대 날짜 규칙으로 바로잡는다. 고친 것이 있으면 fixed 가 참이다. */
export function fixRelativeDates(patch, textIn, today) {
  const dates = relativeDates(textIn, today);
  if (!dates.length || !patch || typeof patch !== 'object') return { patch, fixed: false };
  const next = { ...patch };
  const want = { dateFrom: dates[0], dateTo: dates.length > 1 ? dates[dates.length - 1] : null };
  let fixed = false;
  if (next.dateFrom !== want.dateFrom) { next.dateFrom = want.dateFrom; fixed = true; }
  if (want.dateTo && next.dateTo !== want.dateTo) { next.dateTo = want.dateTo; fixed = true; }
  // 날짜를 하나만 말했는데 종료일이 시작일보다 앞서게 남았으면 버린다.
  if (!want.dateTo && next.dateTo && next.dateTo < next.dateFrom) { next.dateTo = null; fixed = true; }
  return { patch: next, fixed };
}

function localClock(ampm, h, rest) {
  let hour = +h;
  if (ampm === '오후' && hour < 12) hour += 12;
  if (ampm === '오전' && hour === 12) hour = 0;
  const min = rest === '반' ? 30 : rest ? +rest : 0;
  return hour < 24 && min < 60 ? { hour, min } : null;
}

function localTimes(t) {
  // "2시간"의 "2시"를 시각으로 읽지 않는다.
  const one = '(오전|오후)?\\s*(\\d{1,2})\\s*(?:시(?!간)|:)\\s*(?:(\\d{1,2})\\s*분?|(반))?';
  const m = t.match(new RegExp(`${one}\\s*(?:부터|에서|~|-|–)\\s*${one}`));
  if (m) {
    const s = localClock(m[1], m[2], m[4] || m[3]);
    let e = localClock(m[5] || (m[1] === '오후' ? '오후' : ''), m[6], m[8] || m[7]);
    if (s && e) {
      // "2시부터 4시" 처럼 오전·오후가 없으면 근무시간으로 읽는다(1~7시는 오후).
      if (!m[1] && s.hour >= 1 && s.hour <= 7) { s.hour += 12; if (!m[5] && e.hour < 12) e.hour += 12; }
      if (e.hour * 60 + e.min <= s.hour * 60 + s.min && e.hour < 12) e = { ...e, hour: e.hour + 12 };
      return { start: `${pad(s.hour)}:${pad(s.min)}`, end: `${pad(e.hour)}:${pad(e.min)}` };
    }
  }
  const single = t.match(new RegExp(one));
  if (single) {
    const s = localClock(single[1], single[2], single[4] || single[3]);
    if (s) {
      if (!single[1] && s.hour >= 1 && s.hour <= 6) s.hour += 12;
      const out = { start: `${pad(s.hour)}:${pad(s.min)}` };
      const dur = t.match(/(\d{1,2})\s*시간/);
      if (dur) {
        const end = s.hour * 60 + s.min + +dur[1] * 60;
        if (end < 24 * 60) out.end = `${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
      }
      return out;
    }
  }
  return {};
}

/**
 * Claude 없이 문장에서 종류·날짜·시각만 읽는다. 장소와 목적은 읽지 않는다 — 규칙으로 짐작하면 틀린 값을 채운다.
 * @returns {{patch: object, reply: string}}
 */
export function parseAttendLocal(textIn, today, form = {}) {
  const t = String(textIn || '').trim();
  const patch = {};
  const hit = KIND_WORDS.find(([, re]) => re.test(t));
  if (hit) patch.kind = hit[0];
  const kind = patch.kind || form.kind;
  const sub = SUB_WORDS.find(([value, re]) => re.test(t) && (SUBS[kind] || []).some((s) => s.value === value));
  if (sub) patch.sub = sub[0];
  const date = localDate(t, today);
  if (date) patch.dateFrom = date;
  const times = localTimes(t);
  if (kind === 'trip' || kind === 'leave') {
    // "1박 2일" 은 이틀, "3일간" 은 사흘, "당일" 은 하루.
    const m = t.match(/\d+\s*박\s*(\d+)\s*일/) || t.match(/(\d+)\s*일\s*(?:간|동안)/);
    const days = m ? +m[1] : /당일/.test(t) ? 1 : null;
    if (validDays(days)) patch.days = days;
  }
  if (kind === 'flex') {
    if (times.start && FLEX_TIMES.some((x) => x.start === times.start)) patch.flexStart = times.start;
    // 기간만 읽는다. 요일마다의 시간은 규칙으로 짝짓지 않는다 — 틀리게 짝지으면 다른 요일이 바뀐다.
    if (/전체|매일|월\s*[~\-–]\s*금/.test(t)) patch.flexMode = 'all';
    else if (/주간|요일\s*별|요일\s*마다/.test(t)) patch.flexMode = 'week';
    else if (/당일/.test(t)) patch.flexMode = 'day';
  } else if (kind === 'leave') {
    // "오전 반차"·"오후 연차" 는 구분으로, 시각으로 말했으면 13시 규칙으로 읽는다(applyPatch).
    const half = t.match(/(오전|오후)\s*(?:에\s*)?(?:반차|연차|휴가)/);
    if (half) patch.half = half[1] === '오전' ? 'am' : 'pm';
    else if (/전일|종일|하루/.test(t)) patch.half = 'full';
    else Object.assign(patch, times);
  } else {
    Object.assign(patch, times);
    if (kind === 'health' && /전일|하루|종일/.test(t)) patch.allDay = true;
  }
  const got = Object.keys(patch).length;
  return {
    patch,
    reply: !got ? '읽어 낸 것이 없습니다. 색이 다른 칸을 직접 채워 주세요.'
      : kind === 'leave' ? '종류·날짜·기간만 읽었습니다. 아래에서 확인해 주세요.'
        : '종류·날짜·시각만 읽었습니다. 목적은 직접 넣어 주세요(Claude 가 연결되면 그것도 채웁니다).',
  };
}

export const attendToday = () => ymd(new Date());
