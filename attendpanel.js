// 근태 탭의 화면. 무엇을 물을지·무엇이 비었는지는 src/attend.js 가, HR 과 말하는 일은 src/hr.js 가 한다.
// 여기는 그 둘을 화면에 잇기만 한다.
//
// 결재요청·임시저장은 한 번 누르면 나간다 — 무엇이 올라가는지는 버튼 위의 "올릴 내용" 줄에 적혀 있다
// (2026-10-02 사용자 지정). 올린 것을 거둬들이거나 지우는 버튼(삭제·회수·변경·취소신청)은 두 번 눌러야 나간다 —
// 첫 번째는 어느 문서인지 적어 보여주고, 두 번째에 보낸다.

import {
  KINDS, KIND_MAIN, KIND_MORE, STATUS, MAX_TRIP_DAYS, blankForm, fieldsFor, missingFields, problems, describe, settle,
  nameOf, timeOptions, spanDays, nextSpan, halfOf, halfPlan, halfFlexForm, workStartOn, itemsIn, isPast, rangeCovering,
  buildJob, buildDocJob, buildCancelJob, listItems, formFromDoc, applyPatch, withSub, attendToday,
  FLEX_MODES, FLEX_DAYS, flexModeOf, fillFlexWeek,
  acceptsFile, itemsOfKind, EVIDENCE_ACCEPT, statusLabel, CANCELLING_KEY, CANCELLING_LABEL, CANCELLED_LABEL, cancellingOf, pruneCancelling, isCancelDoc, linkCancel,
} from './src/attend.js';
import { hrListDocs, hrGetDoc, hrDeleteDoc, hrRunJob, hrWeekTimes, hrOpenDoc, hrCloseWorker, hrCancelRefs, HR_SSO_URL } from './src/hr.js';
import { fillAttendSmart, receiptSmart } from './src/llm.js';
import {
  settlePlan, describePlan, tripStage, tripDocFor, tripIconState, settleLabel,
  TRANSPORTS, TRAIN_GRADES, LEG_GRADED, transportsOf, trainGradeOf, nextTransport, legPlan, nextLegPick, describeTrans, prePlan, stayPlan, legDiffs, legWhen,
} from './src/travel.js';
import { tripList, tripCreate, tripDocUrl, TRIP_SHELL_URL, tripPreDetail, tripPreConfirm, tripPostConfirm, tripAfterSave, tripAfterUrl } from './src/trip.js';
import { tripPreSave, tripPreUrl, tripDelete } from './src/trip.js';
import { afterNeed, afterPlan, afterSummary, evidenceOf, needsAfter, TRANS_NAME } from './src/after.js';
import { lodgeAsk, lodgeCap, lodgeSettle, lodgeSame, lodgeChoices, lodgeDecide, lodgeOver, lodgeKnown } from './src/after.js';
import { tripLodgeMax, tripAfterLodges } from './src/trip.js';
import { createEvidenceStore, MARKS_KEY } from './src/evidence.js';
import { UP_BUSY_KEY, upBusy } from './src/afterup.js';
import { READ_POOL, mapPool } from './src/pool.js';
import { ROUTES_KEY, routeOfPlan, routeOfRows, keepRoute, recallRoute, withRoute } from './src/routes.js';
import { createSendBox } from './sendbox.js';
import { createLodgeBox, lodgeAmount } from './lodgebox.js';
import { createWebPick, pickButton, pagePdfs } from './webpick.js';
import { wantsCar, carWindow, windowDays, windowLabel, carsInWindow, carPick, carPlaceKey, carPlaceOf, regionOf, MAX_CAR_DAYS } from './src/carfind.js';
import { scanCarDays } from './src/rentcar.js';
import {
  BACK_KEY, BACK_DEFAULT, BACK_MAX_DAYS, STAGES_KEY, backWeeksOf, settledBy, stagesFresh, itemsToShow, dropSettled, noteStages,
} from './src/settling.js';
import { AuthError } from './src/net.js';
import { PORTAL_HOME_URL } from './src/config.js';

const ARM_MS = 4000;
/**
 * 신청 내역에 보여줄 것(근태 날짜 기준). 기간을 따로 정하지 않으면 **오늘부터 잡힌 것은 전부**(근태를 올려 둔 가장 늦은 날까지)이고,
 * 지난 것은 **여비 정산이 덜 끝난 출장만** 다녀온 뒤 4주(또는 8주)까지 보인다 — 사후정산을 완료했거나 증빙을 담당자에게 보낸 출장은
 * 뺀다(2026-10-04 사용자 지정, 규칙은 src/settling.js. 그 전에는 일주일 전부터 한 달 뒤까지였다).
 * HR 문서함은 신청일로만 거를 수 있어서, 보여줄 기간보다 여섯 달 앞에 신청한 것부터 읽어 근태 날짜로 고른다.
 */
const LIST_REQUEST_LOOKBACK_MONTHS = 6;
/** 반차 날의 출근시간을 볼 때, 그 날짜로 올려 둔 유연근무를 찾으려고 거슬러 올라가는 기간(신청일 기준). */
const SCHED_MONTHS = 3;
const FILE_LIMIT = 10 * 1024 * 1024;
const VIA_LABEL = { cli: '로컬 CLI', api: 'API 키', local: '규칙 해석' };
// `근태 변경` — 처음에는 `변경`이었는데, 출장 카드에 여비계산서를 고치는 버튼들이 같이 서면서 무엇을 변경하는지 헷갈렸다(2026-10-05 사용자 지정).
const ACTION_LABEL = { edit: '수정', change: '근태 변경', request: '상신', delete: '삭제', recall: '회수', cancel: '취소신청' };
const ACTION_TITLE = {
  edit: '이 임시저장 문서를 폼으로 불러와 고칩니다',
  change: '시간·날짜를 바꿉니다 — 올린 건을 거둬들이고(승인 전이면 회수, 승인 뒤면 취소신청) 같은 내용을 폼에 불러옵니다',
  request: '이 임시저장 문서를 그대로 결재요청합니다',
  delete: '이 문서를 지웁니다(임시저장했거나 회수한 문서)',
  recall: '결재요청을 거둬들입니다(결재 전일 때만)',
  cancel: '결재가 끝난 건을 무르는 취소신청서를 올립니다',
};
const WEB_TITLE = 'HR 웹페이지에서 이 문서 열기';
const WEB_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>';
/** 증빙을 넣는 칸의 아이콘 — 받침에서 위로 올라가는 화살표(올리기). */
const DROP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>';
/** 완료한 사후정산을 다시 작성하는 버튼(여비증빙 송부 칸 아래의 `사후정산 다시하기`)과, 그것을 그만두는 버튼의 풍선말. */
const REOPEN_TITLE = '완료한 사후정산을 다시 작성합니다 — 증빙을 넣거나 가는 편·오는 편을 바꿔 저장하고, 보내기가 다시 확정한 뒤 보냅니다';
const REOPEN_STOP = '다시 작성을 그만둡니다 — 저장하지 않은 것은 사후정산에 올라가지 않습니다';
/** 사전정산을 다시 작성하는 버튼(`사전정산 다시하기`)과 그만두는 버튼, 다시 저장하는 버튼의 풍선말. */
const PRE_REDO_TITLE = '사전정산의 가는 편·오는 편(교통편·일자·시각)과 식비(식수)를 고쳐 사전정산을 다시 저장합니다';
const PRE_REDO_STOP = '사전정산 다시 작성을 그만둡니다 — 저장하지 않은 것은 사전정산에 올라가지 않습니다';
const PRE_SAVE_TITLE = '사전정산을 다시 저장합니다 — eclass 계산서 화면의 `사전정산 입력`에서 저장을 누른 것과 같습니다';
const PRE_OPEN_TITLE = '사전정산 입력 화면을 eclass 에서 열기';
/** 사전정산을 다시 작성할 때 한 번 더 누르면 특실이 되는 교통편 — 기차뿐이다(비행기·버스는 사전정산에 줄을 넣지 않는다). */
const PRE_GRADED = ['train'];
/** 일비·식비 줄의 식수를 줄이고 늘리는 아이콘(− +)과 풍선말. 줄이 여럿인 계산서는 합만 적는다(STAY_MANY). */
const MINUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>';
const MEAL_LESS = '식비 한 끼 줄이기 — 사전정산을 다시 저장할 때 들어갑니다';
const MEAL_MORE = '식비 한 끼 늘리기 — 사전정산을 다시 저장할 때 들어갑니다';
const STAY_MANY = '일비·식비 줄이 여럿이라 합만 적습니다 — 식수는 사전정산 입력 화면에서 고칩니다';
/** 편의 `다름` 표시의 풍선말 — 사이트에 저장된 줄이 출장 일정·운임표와 다른 편에 선다(src/travel.js 의 legDiffs). */
const DIFF_TITLE = '여비계산서에 저장된 값이 출장 일정·운임표와 다른 곳이 있습니다 — 누르면 어디가 다른지 보입니다';
const FIX_TITLE = '이 값으로 고쳐 둡니다 — 사전정산을 다시 저장할 때 들어갑니다';
/** 편의 출발 시·도착 시를 고르는 칸의 선택지(0 = 적지 않음 — 화면의 첫 선택지다)와, 날짜 글의 모양. */
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 증빙 넣는 곳의 풍선말 — 칸을 낮추느라 칸 안에서 뺀 자세한 말이다. */
const DROP_TITLE = '이미지·PDF, 여러 장도 됩니다 — 붙여넣기(Ctrl+V)는 이 카드를 편 채 패널 어디서든 됩니다';
const CAP_TITLE = '이 창에 열어 둔 웹페이지(탭)를 전체 또는 하나 이상 골라 위에서 아래까지 캡처하고 화면의 글자와 함께 증빙으로 읽습니다 — '
  + '예약 확인·결제 완료 화면을 조각조각 캡처하지 않아도 됩니다. 페이지 하나가 PDF 하나(증빙 한 장)가 됩니다. 처음 찍을 때 한 번 사이트 접근 권한을 묻습니다.';
const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8)}`;
/** 기간을 "9/6 ~ 10/13" 으로. 올해 밖에 걸치면 해를 붙인다("25/10/4 ~ 26/10/4") — 한 해를 조회하면 양쪽이 같은 날로 보인다. */
const spanText = (from, to, today) => {
  const year = today.slice(0, 4);
  const one = (s) => (from.slice(0, 4) === year && to.slice(0, 4) === year ? md(s) : `${s.slice(2, 4)}/${md(s)}`);
  return `${one(from)} ~ ${one(to)}`;
};
/** 교통편 아이콘(기차·비행기·버스). 버스는 옆모습이다(2026-10-03 사용자 지정) — 앞모습은 기차와 가려지지 않는다. */
const TRANSPORT_ICON = {
  train: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"/><path d="M4 11h16M8 21l2-3M16 21l-2-3M8.5 14.5h.01M15.5 14.5h.01"/></svg>',
  plane: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/></svg>',
  bus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 16.5h-1a1 1 0 0 1-1-1V8A1.5 1.5 0 0 1 4 6.5h13a2 2 0 0 1 1.8 1.1l2.2 4.4c.3.6.5 1.3.5 2v1.5a1 1 0 0 1-1 1h-1M9.5 16.5h5"/><path d="M2.5 11.5h18.2M8.5 6.5v5M14 6.5v5"/><circle cx="7" cy="16.5" r="2"/><circle cx="17" cy="16.5" r="2"/></svg>',
};
/** 특실을 부르는 이름(아이콘의 풍선말·읽어 주는 이름에 붙인다). */
const FIRST_LABEL = TRAIN_GRADES.find((g) => g.value === 'first')?.label || '특실';
const TRIP_TITLE = '여비계산서를 eclass 에서 열기';
/** 사후정산 단계의 출장 줄에 서는 사전정산 아이콘(1)의 풍선말 — 사전정산 입력 화면을 연다. */
const TRIP_PRE_TITLE = '사전정산을 eclass 에서 열기 — 사전정산 완료';
/** 출장 줄의 여비계산서 다시 읽기(↻)의 풍선말. */
const TRIP_AGAIN_TITLE = '여비계산서 다시 읽기 — eclass 에서 고친 것(단계·교통편·일비·식비·숙박 줄)을 가져옵니다';
// 문서 안에 숫자가 적힌 모양 — 1 은 사전정산, 2 는 사후정산(2026-10-03 사용자 지정). 색은 CSS(.at-tripbtn.none/doing/done)가 입힌다.
const TRIP_DIGIT = { 1: 'M10.5 12 12.5 10.5V18M10.5 18h4', 2: 'M10.3 12.3a2.3 2.3 0 1 1 4.4 1.2c-.9 1.6-4.4 2.7-4.4 4.5h4.6' };
const tripIcon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6Z"/><path d="M15 3v4h4"/><path d="${TRIP_DIGIT[n] || TRIP_DIGIT[1]}"/></svg>`;
/** 차량 조회: 날짜·시각을 고치는 중에 값마다 사이트를 두드리지 않게, 기간이 바뀌면 이만큼 기다렸다가 읽는다. */
const CAR_WAIT_MS = 500;
const CAR_AGAIN_TITLE = '차량 다시 조회';
const CAR_AGAIN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17"/></svg>';
const CAR_STATE = { free: '비어 있음', unknown: '확인 불가' };

/**
 * @param {{$:Function, escapeHtml:Function, logEvent:Function, ai:() => {apiKey:string, cli:boolean}, onChanged?:Function, evidence?:object,
 *   cars?:{scan:(dates:string[]) => Promise<object[]>}, onCar?:Function}} deps
 *   onChanged 는 HR 에 무엇인가 올리거나 거둬들인 뒤에 부른다(현황 탭이 담아 둔 근태를 버리게).
 *   evidence 는 증빙 보관함(src/evidence.js) — 테스트가 가짜를 준다.
 *   cars.scan 은 날짜들의 차량 이용 현황을 읽어 오는 길(src/rentcar.js 의 scanCarDays) — 테스트가 가짜를 준다.
 *   onCar 는 차량 조회에서 빈 차량을 눌렀을 때 그 차량을 신청하는 길이다(src/carfind.js 의 carPick 모양을 받아
 *   {ok, submitted, message} 를 돌려준다 — 패널(sidepanel.js)이 차량 탭의 예약하기와 같은 길로 보낸다).
 */
export function createAttendPanel({
  $, escapeHtml, logEvent, ai, onChanged = () => {}, evidence = createEvidenceStore(),
  cars = { scan: (dates) => scanCarDays(dates) },
  onCar = async () => ({ ok: false, submitted: false, message: '차량 신청이 연결되지 않았습니다.' }),
  listTabs, capture,
}) {
  const el = {
    root: $('attend'), kinds: $('atKinds'), chatLog: $('atChatLog'), chatInput: $('atChatInput'), chatGo: $('atChatGo'),
    form: $('atForm'), formTitle: $('atFormTitle'), formToggle: $('atFormToggle'), formBody: $('atFormBody'),
    reset: $('atReset'), fields: $('atFields'), need: $('atNeed'),
    submit: $('atSubmit'), save: $('atSave'), editCancel: $('atEditCancel'), editNote: $('atEditNote'),
    status: $('atStatus'), range: $('atRange'), count: $('atCount'), openHr: $('atOpenHr'),
    listWrap: $('atListWrap'), list: $('atList'), empty: $('atEmpty'),
    rangeBtn: $('atRangeBtn'), rangeBox: $('atRangeBox'), rangeFrom: $('atRangeFrom'), rangeTo: $('atRangeTo'),
    rangeGo: $('atRangeGo'), rangeHint: $('atRangeHint'),
  };

  const st = {
    // items 는 화면에 보이는 건(기간에 걸친 것), all 은 HR 에서 읽은 전부다 — 방금 올린 건이 기간 밖이어도 all 에서 확인한다.
    form: blankForm('', attendToday()), items: [], all: [], edit: null, busy: false, chat: [],
    armed: null, armTimer: null, filled: new Set(), loadedOnce: false, authFailed: false, moreOpen: false,
    // 신청 내역: 펴 둔 줄, 취소 사유를 받는 줄(then 이 'copy' 면 올린 뒤 폼에 불러온다), 따로 정한 조회 기간.
    openDoc: null, cancelFor: null, cancelThen: null, range: null,
    // 취소신청을 올려 둔 원 문서의 기록(src/attend.js 의 CANCELLING_KEY) — 그 줄은 상태가 "취소 중"이고 여비계산서 칸이 없다.
    cancelKept: {},
    // 기본 보기에서 다녀온 출장을 몇 주 뒤까지 보이는가(0 = 안 봄, 4, 8). 저장해 두고 홈의 WORKSPACE 카드도 같이 따른다.
    // stages 는 저장소에 담아 둔 여비계산서 목록(src/settling.js) — 목록을 새로 읽기 전에 정산이 끝난 출장을 가리는 데 쓴다.
    back: BACK_DEFAULT, stages: null,
    // 반차를 올릴 때 보는 근무시간: { week, items } 또는 { error }. 아직 안 읽었으면 null, 읽는 중이면 schedWait 에 약속이 있다.
    sched: null, schedWait: null, checking: false,
    // 출장의 근무지. 한 번 적으면 저장해 두고 새 신청서마다 깔아 준다(2026-10-02 사용자 지정). 패널을 새로 열면 show() 가
    // 저장소에서 되읽어 온다. 칸을 지우면 지운 것이 남는다.
    workplace: '',
    // 신청 폼이 펴져 있는가. 제목을 눌러 접았다 편다(2026-10-03 사용자 지정). 접은 것을 기억하고,
    // 종류를 고르거나 말로 채우거나 문서를 불러오면 펴진다. foldedForList 는 기간 조회 때문에 잠깐 접어 둔 것인가(foldForList).
    formOpen: true, foldedForList: false,
    // 신청 내역을 무엇으로 가르는가. '' 이면 고른 종류의 것만, 'all'(종류 줄 끝의 "내역")이면 모든 종류를 한 목록으로
    // 보이고 폼은 숨긴다(2026-10-03 사용자 지정). 종류를 고르면 '' 로 돌아온다.
    view: '',
    // 여비계산서 목록(eclass): { rows, me } 또는 { error }. me 는 그 화면이 아는 내 이름이다(HR 은 영문 이름을 주기도 한다). 아직 안 읽었으면 null. me 는 HR 이 알려 준 나(사번·이름)다.
    trips: null, me: null,
    // 사후정산(계산서 번호가 열쇠): { detail, loading, detailError, busy, stage, result, error, info, seats, tickets, kept }. detail 은 사전정산 화면에서
    // 읽은 교통편, seats 는 가는 편·오는 편에 앉힌 항공권, tickets 는 이 패널을 연 동안 넣은 항공권의 기록이다(다시 올릴 때 같이 묶는다).
    // kept 는 보관함(src/evidence.js)에 담아 둔 증빙 — 담당자에게 보낼 때 같이 갈 것들이다.
    // ask 는 올리기 전에 사람이 정해 줘야 해서 멈춰 둔 사후정산이다: { plan, row, records, files, krw } — 외화 문서의 원화 금액과
    // 상한액 초과를 카드에서 묻고(askHtml), 답하면 올린다(answerAsk).
    after: {},
    // 이 패널이 올린 숙박 줄(계산서 번호 → 사이트의 숙박 줄 번호 → 증빙 파일 이름). 저장해 둔다 — 여기 없는 줄은 손수 적은 줄이다.
    lodgeMine: {},
    // 그 줄들을 올릴 때 적어 둔 내용(계산서 번호 → 숙박 줄 번호 → { row, cells, docs, notes }) — 숙박비 내역에서 그 줄의 `증빙`을 누르면 펴 보인다.
    // 이것도 저장해 둔다(attendLodgeInfo). lodgeOpen 은 지금 내용을 펴 둔 줄(계산서 번호 → 숙박 줄 번호)이다.
    lodgeInfo: {}, lodgeOpen: {},
    // 저장된 값이 다른 곳을 펴 둔 편(계산서 번호 → 'go'·'back') — 편의 `다름` 표시를 누르면 펴진다.
    legDiff: {},
    // 가는 편·오는 편에서 고른 교통편(신청서 번호가 열쇠): { go: {t, g}, back: {t, g} }. 사전정산과 다르게 고른 편만 들어 있고,
    // 저장해 두어 패널을 다시 열어도 남는다. 사후정산을 올릴 때 교통비 내역이 된다.
    legs: {},
    // 출장지마다 지난번에 쓴 교통편(src/routes.js — 출장지에 적은 글 → { transport, trainGrade, path, date }). 저장해 두고, 같은 출장지를
    // 다시 적으면 아이콘과 사전정산의 KTX 길을 그것으로 먼저 맞춘다(2026-10-04 사용자 지정). transportSet 은 이 신청서에서 교통편
    // 아이콘을 손댔는가 — 손댔으면 기억으로 덮어쓰지 않는다.
    routes: {}, transportSet: false,
    // 출장·외근 폼의 차량 조회: key 는 찾은(찾는 중인) 기간, result 는 src/carfind.js 의 carsInWindow 결과.
    // 폼의 기간이 key 와 달라지면 다시 찾는다. booking 은 신청을 보내는 중인 차량, note 는 방금 한 신청의 결과 글이다.
    cars: { key: '', win: null, loading: false, result: null, error: '', booking: '', note: null },
    // 홈의 WORKSPACE 카드에서 출장 줄의 `보내기`를 눌러 온 부탁: { docNo, send, at, seen } — 신청 내역이 읽히면 그 출장 카드를 펴고
    // 여비증빙 송부 칸으로 간다(seek·followSeek). 없으면 null.
    seek: null,
  };

  /** 신청 내역이 비었을 때의 기본 문구(HTML 에 적힌 것). 종류로 걸러서 빈 것이면 다른 문구를 보인다. */
  const EMPTY_TEXT = el.empty.textContent;

  /** 새 신청서. 적어 둔 근무지가 깔려 있다. 교통편 아이콘은 아직 손대지 않은 것이다. */
  const blank = (kind) => {
    st.transportSet = false;
    return { ...blankForm(kind, attendToday()), workplace: st.workplace };
  };

  /** 그 폼의 출장지에 기억해 둔 교통편(지난번에 간 길). 없으면 null. */
  const memoOf = (form) => recallRoute(st.routes, form.place);

  /** 출장지의 교통편을 기억해 둔다 — 바뀐 것이 있을 때만 저장한다. */
  function keepTripRoute(place, entry) {
    const next = keepRoute(st.routes, place, entry);
    if (next === st.routes) return;
    st.routes = next;
    chrome.storage.local.set({ [ROUTES_KEY]: next });
  }

  /**
   * 출장지가 정해졌을 때 교통편 아이콘을 지난번에 그 출장지로 갈 때 고른 것으로 맞춘다 — 기억이 없으면 기본(기차)으로 돌아간다.
   * 이 신청서에서 아이콘을 손댔거나 임시저장 문서를 고치는 중이면 건드리지 않는다. 바뀌었으면 참(폼을 새로 그려야 한다).
   */
  function recallTransport() {
    if (st.form.kind !== 'trip' || st.edit || st.transportSet) return false;
    const next = withRoute(memoOf(st.form));
    if (String(transportsOf(st.form)) === String(next.transport) && trainGradeOf(st.form) === next.trainGrade) return false;
    st.form = settle({ ...st.form, ...next });
    return true;
  }

  // 출장 카드의 여비증빙 송부 칸. 아래 함수들은 이 뒤에 적혀 있지만 부를 때는 이미 있다.
  const sendBox = createSendBox({
    escapeHtml, logEvent, evidence, readFile: (f) => readFile(f), repaint: () => paintList(),
    setStatus: (...args) => setStatus(...args), setError: (...args) => setError(...args),
  });
  // 출장 카드의 숙박비 내역(lodgebox.js) — 사후정산 화면에 지금 있는 숙박 줄을 보이고, 지우고, 다시 읽는다.
  const lodgeBox = createLodgeBox({
    escapeHtml, logEvent, repaint: () => paintList(),
    setStatus: (...args) => setStatus(...args), setError: (...args) => setError(...args),
  });
  // 출장 카드의 증빙 넣는 곳(사후정산 칸·여비증빙 송부 칸) 아래의 웹페이지 캡처 — 공문 탭의 것과 같은 탭 고르기 칸이다(webpick.js,
  // 2026-10-08 사용자 지정: "여기도 웹페이지 카피 공문처럼 하게해줘.. 2개 동일한 기능으로"). listTabs·capture 는 테스트가 갈아 끼운다.
  const webPick = createWebPick({ escapeHtml, listTabs, capture });
  /** 웹페이지 캡처 단추와 펴 둔 탭 목록. where 는 'after'(사후정산 칸)·'send'(여비증빙 송부 칸) — 한 카드에 둘이 같이 서도 목록은 누른 곳에만 편다. */
  const capHtml = (docNo, where, locked) => {
    const key = `${docNo}:${where}`;
    return `<div class="at-cap" data-cap="${where}">${pickButton({ open: webPick.isOpen(key), disabled: locked, title: CAP_TITLE }, escapeHtml)}</div>`
      + webPick.html(key, { busy: locked });
  };

  /* ---------------------------------------------------------------- 상태 줄 */

  function setStatus(msg, kind = '') {
    el.status.className = `status ${kind}`;
    el.status.textContent = msg;
  }

  function setError(err, what) {
    st.authFailed = err instanceof AuthError;
    if (st.authFailed) {
      el.status.className = 'status error';
      el.status.innerHTML = `${escapeHtml(err.message)} <a href="#" id="atOpenLogin">eclass 열기</a>`;
      $('atOpenLogin')?.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: PORTAL_HOME_URL });
      });
    } else {
      setStatus(`${what}: ${err.message}`, 'error');
    }
  }

  function setBusy(on) {
    st.busy = on;
    el.root.setAttribute('aria-busy', String(on));
    paintNeed();
    paintList();
  }

  /* ---------------------------------------------------------------- 두 번 누르기 */

  /**
   * 첫 번째 누름이면 버튼에 확인 문구를 적고 false, 몇 초 안의 두 번째 누름이면 true.
   * 다른 버튼을 누르면 앞의 장전은 풀린다.
   */
  function armed(key, btn, text) {
    if (st.armed?.key === key) {
      disarm();
      return true;
    }
    disarm();
    st.armed = { key, btn, label: btn.textContent };
    btn.textContent = text;
    btn.classList.add('armed');
    st.armTimer = setTimeout(disarm, ARM_MS);
    return false;
  }

  function disarm() {
    clearTimeout(st.armTimer);
    if (st.armed?.btn?.isConnected) {
      st.armed.btn.textContent = st.armed.label;
      st.armed.btn.classList.remove('armed');
    }
    st.armed = null;
  }

  /* ---------------------------------------------------------------- 종류·폼 */

  // 줄인 이름(유연·건강)은 버튼에만 쓴다. 풀 이름은 풍선말과 읽어 주는 이름에 둔다.
  const kindButton = (k) => {
    const on = st.form.kind === k && st.view !== 'all';
    return `<button type="button" class="at-kind${on ? ' active' : ''}" data-kind="${k}" `
      + `aria-pressed="${on}" aria-label="${escapeHtml(KINDS[k].label)}" `
      + `title="${escapeHtml(`${KINDS[k].label} — ${KINDS[k].hint}`)}"${st.edit ? ' disabled' : ''}>${escapeHtml(KINDS[k].short || KINDS[k].label)}</button>`;
  };
  // 종류 줄 끝의 "내역" — 모든 종류의 신청 내역을 한 목록으로 본다(종류를 고르면 그 종류의 것만 보인다).
  const viewButton = () =>
    `<button type="button" class="at-kind at-view${st.view === 'all' ? ' active' : ''}" data-view="all" aria-pressed="${st.view === 'all'}" `
    + `title="모든 종류의 신청 내역을 한 목록으로 봅니다"${st.edit ? ' disabled' : ''}>내역</button>`;

  /**
   * 첫 줄(KIND_MAIN)은 늘 보이고, 접는 쪽(KIND_MORE)에 둔 종류가 있으면 "더 보기" 아래로 접어 둔다.
   * 지금은 여섯 종류가 모두 첫 줄이라 접는 줄이 없다.
   * 접힌 쪽의 종류를 쓰고 있으면 접혀 있어도 펴서 보여준다 — 고른 것이 안 보이면 무엇을 올리는지 알 수 없다.
   */
  function paintKinds() {
    const main = `<div class="at-kind-row">${KIND_MAIN.map(kindButton).join('')}${viewButton()}</div>`;
    if (!KIND_MORE.length) {
      el.kinds.innerHTML = main;
      return;
    }
    const open = st.moreOpen || KIND_MORE.includes(st.form.kind);
    const names = KIND_MORE.map((k) => KINDS[k].label).join('·');
    el.kinds.innerHTML = main
      + `<button type="button" id="atMore" class="at-more ghost small" aria-expanded="${open}" aria-controls="atKindMore">`
      + `${open ? '접기' : `더 보기 · ${escapeHtml(names)}`}</button>`
      + `<div id="atKindMore" class="at-kind-row"${open ? '' : ' hidden'}>${KIND_MORE.map(kindButton).join('')}</div>`;
  }

  const chip = (attr, value, label, on, cls = '') =>
    `<button type="button" class="at-chip${cls}${on ? ' active' : ''}" ${attr}="${escapeHtml(value)}" aria-pressed="${on}">${escapeHtml(label)}</button>`;

  /**
   * 몇 시간 칩. 1~8시간 가운데 하나와, 오른쪽에 30분을 더하는 칩(다른 색)이 따로 켜진다.
   * 아홉 칩이 한 줄에 들어가게 이름은 `1H`~`8H` 로 줄인다(2026-10-02 사용자 지정).
   */
  function spanChips(f, v) {
    const mins = Number.isInteger(v) ? v : 0;
    return f.hours.map((h) => chip('data-span', h, `${h}H`, Math.floor(mins / 60) === h)).join('')
      + (f.half ? chip('data-span', 'half', '+30분', mins % 60 === 30, ' at-plus') : '');
  }

  /**
   * 교통편 아이콘 하나. 고르면 버튼이 아니라 **아이콘의 색**이 바뀐다(2026-10-03 사용자 지정) — 파랑이 고른 것이고,
   * 특실은 주황색에 오른쪽 위 "+" 가 붙는다(색과 "+" 는 CSS 가 입힌다). 이름은 풍선말과 읽어 주는 이름에 둔다.
   * graded 는 특실이 있는 교통편이다 — 신청 폼은 기차뿐이고, 출장 카드의 가는 편·오는 편은 비행기도 된다(src/travel.js 의 LEG_GRADED).
   */
  const transportButton = (o, { on, first, attrs, disabled = false, graded = ['train'] }) => {
    const plus = on && first && graded.includes(o.value);
    const name = plus ? `${o.label} ${FIRST_LABEL}` : o.label;
    return `<button type="button" class="at-chip at-icon${on ? ' active' : ''}${plus ? ' first' : ''}" ${attrs} aria-pressed="${on}" `
      + `aria-label="${escapeHtml(name)}" title="${escapeHtml(name)}"${disabled ? ' disabled' : ''}>${TRANSPORT_ICON[o.value] || escapeHtml(o.label)}</button>`;
  };

  function fieldHtml(f) {
    const v = st.form[f.key];
    const id = `at_${f.key}`;
    // 날짜·시각 칸은 이름을 칸 안 왼쪽에 적는다(2026-10-02 사용자 지정). 이 칸들과 며칠간은 늘 채워져 있고
    // 필수인 것이 뻔해서 "필수"를 달지 않는다.
    // 주간 유연근무의 요일 칸도 그렇게 적는다(월·화·수·목·금).
    const inside = f.type === 'date' || f.type === 'time' || !!f.inside;
    const req =f.required && !inside && f.type !== 'days' ? '<em class="at-req">필수</em>' : '';
    const hint = f.hint ? ` placeholder="${escapeHtml(f.hint)}"` : '';
    // 칩으로 고르는 칸은 누를 것이 여럿이라 label 로 감싸지 않는다(감싸면 어디를 눌러도 첫 칩이 눌린다).
    if (f.type === 'choice' || f.type === 'days' || f.type === 'span') {
      const chips = f.type === 'choice'
        ? f.options.map((o) => chip('data-choice', o.value, o.label, (v || '') === o.value)).join('')
        : f.type === 'span' ? spanChips(f, v)
          : f.chips.map((c) => chip('data-days', c.days, c.label, v === c.days)).join('')
            // 끝나는 날. 칩에 없는 날 수는 여기서 고르고, 칩을 눌러도 여기에 끝나는 날이 따라 적힌다.
            // inline(출장)이면 달력을 두지 않는다 — 끝나는 날은 따로 선 도착일 칸(dateTo)이 받는다.
            + (f.inline ? '' : `<input type="date" id="${id}" value="${escapeHtml(st.form.dateTo || '')}" min="${escapeHtml(st.form.dateFrom || '')}" `
            + `aria-label="끝나는 날" title="${escapeHtml(f.hint || '')}" />`);
      // 묶음 안의 칸은 한 줄을 다 쓰지 않는다. inline 은 이름이 칩 왼쪽에 붙는 한 줄이다(출장의 며칠간).
      return `<div class="at-field${f.group ? '' : ' wide'}${f.inline ? ' inline' : ''} at-${f.type}" data-key="${f.key}" role="group" aria-labelledby="${id}_label">`
        + `<span class="at-label" id="${id}_label">${escapeHtml(f.label)}${req}</span>`
        + `<div class="at-chips">${chips}</div><span id="${id}_msg" class="at-msg"></span></div>`;
    }
    if (f.type === 'icons') {
      // 아이콘으로 고르는 칸(교통편). 칩과 같은 길(data-choice)로 눌린다. 여럿을 함께 켤 수 있고(기차 + 비행기),
      // 기차는 한 번 더 누르면 특실이 된다 — 다음 선택은 src/travel.js 의 nextTransport 가 정한다.
      const on = transportsOf(st.form);
      const first = trainGradeOf(st.form) === 'first';
      const chips = f.options.map((o) => transportButton(o, { on: on.includes(o.value), first, attrs: `data-choice="${escapeHtml(o.value)}"` })).join('');
      return `<div class="at-field at-icons" data-key="${f.key}" role="group" aria-labelledby="${id}_label">`
        + `<span class="at-label" id="${id}_label">${escapeHtml(f.label)}</span>`
        + `<div class="at-chips">${chips}</div><span id="${id}_msg" class="at-msg"></span></div>`;
    }
    let input;
    if (f.type === 'select') {
      // 고를 수 없는 것(disabled)은 빼지 않고 흐리게 잠가 보여준다. 날짜가 바뀌면 paintNeed 가 다시 맞춘다.
      input = `<select id="${id}"><option value="">선택</option>${f.options.map((o) =>
        `<option value="${escapeHtml(o.value)}"${o.value === v ? ' selected' : ''}${o.disabled ? ' disabled' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
    } else if (f.type === 'check') {
      input = `<input type="checkbox" id="${id}"${v ? ' checked' : ''} />`;
    } else if (f.type === 'file') {
      // 고르는 단추는 감추고 칸 전체를 끌어다 놓는 자리로 쓴다. 칸이 label 이라 누르면 탐색기가 열린다.
      input = `<input type="file" id="${id}"${f.accept ? ` accept="${escapeHtml(f.accept)}"` : ''} /><span class="at-drop${v ? ' picked' : ''}">`
        + `<span class="at-file">${escapeHtml(v?.name || f.hint || '')}</span>`
        + `<span class="at-drop-how">파일을 끌어다 놓거나 눌러서 고르세요 · 붙여넣기(Ctrl+V)도 됩니다</span></span>`;
    } else if (f.type === 'time') {
      // 시각은 목록에서 고른다 — 출장·교육은 정시, 그 외는 30분 간격이다(2026-10-02 사용자 지정).
      // 크롬의 시각 입력은 step 을 줘도 분을 1분씩 늘어놓아서 쓰지 않는다(같은 날 화면에서 확인).
      // 목록에 없는 값(10분 단위로 올린 예전 문서)은 지우지 않고 한 줄 더 보여준다 — 붉게 표시되어 고치게 된다.
      const times = timeOptions(st.form);
      const all = v && !times.includes(v) ? [...times, v].sort() : times;
      input = `<select id="${id}" title="${escapeHtml(f.hint || '')}"><option value="">선택</option>${all.map((x) =>
        `<option value="${x}"${x === v ? ' selected' : ''}>${x}</option>`).join('')}</select>`;
    } else {
      input = `<input type="${f.type}" id="${id}" value="${escapeHtml(v || '')}"${hint} autocomplete="off" />`;
    }
    // 글 칸은 한 줄을 다 쓴다. 나란히 두라고 한 글 칸(출장지·장소, 근무지)만 줄을 나눠 쓴다.
    const wide = f.type === 'file' || (f.type === 'text' && !f.beside && !f.group) ? ' wide' : f.beside ? ' beside' : '';
    // --lab 은 이름의 글자 수다. 칸이 그만큼 왼쪽을 비워 이름과 값이 겹치지 않는다.
    const inl = inside ? ` inl" style="--lab:${f.label.length}` : '';
    // 체크박스는 적어 둘 자리(placeholder)가 없다. 무엇을 하는지는 풍선말에 둔다.
    const tip = f.type === 'check' && f.hint ? ` title="${escapeHtml(f.hint)}"` : '';
    return `<label class="at-field${wide} at-${f.type}${inl}" data-key="${f.key}" for="${id}"${tip}>`
      + `<span class="at-label">${escapeHtml(f.label)}${req}</span>${input}<span id="${id}_msg" class="at-msg"></span></label>`;
  }

  /** 칸을 새로 그린다. 종류·하루 전체가 바뀌거나 밖에서 값을 채웠을 때만 부른다 — 치는 중에 부르면 커서가 날아간다. */
  function paintForm() {
    const kind = KINDS[st.form.kind];
    // "내역"(모든 종류 보기)에서는 폼을 숨긴다 — 종류를 고르면 다시 보인다.
    el.form.classList.toggle('hidden', !kind || st.view === 'all');
    if (!kind || st.view === 'all') return;
    seedFlexWeek();
    el.formTitle.textContent = st.edit ? `${nameOf(st.form)} 수정 · ${st.edit.docNo}` : `${nameOf(st.form)} 신청`;
    paintFold();
    // 같은 묶음(group)의 칸은 한 줄에 나란히 세운다(출장지·장소 / 근무지·교통편).
    let html = '';
    let group = '';
    for (const f of fieldsFor(st.form)) {
      const g = f.group || '';
      if (g !== group) html += (group ? '</div>' : '') + (g ? `<div class="at-group at-${g}">` : '');
      group = g;
      html += fieldHtml(f);
    }
    // 차량 조회를 켰으면 칸들 아래에 빈 차량 목록이 선다(내용은 paintCars 가 채운다).
    el.fields.innerHTML = html + (group ? '</div>' : '')
      + (wantsCar(st.form) ? '<div id="atCars" class="at-cars" role="group" aria-label="차량 조회"></div>' : '');
    el.editCancel.classList.toggle('hidden', !st.edit);
    el.editNote.classList.toggle('hidden', !st.edit);
    if (st.edit) el.editNote.textContent = '임시저장 문서를 고치는 중입니다. 종류는 바꿀 수 없습니다.';
    paintNeed();
  }

  /** 접힘을 화면에 맞춘다. 접으면 칸·올릴 내용·버튼이 숨고 제목 줄(제목·비우기)만 남는다. */
  function paintFold() {
    el.formBody.hidden = !st.formOpen;
    el.form.classList.toggle('folded', !st.formOpen);
    el.formToggle.setAttribute('aria-expanded', String(st.formOpen));
  }

  function setFold(open) {
    st.foldedForList = false;
    if (st.formOpen === open) return;
    st.formOpen = open;
    chrome.storage.local.set({ attendFormOpen: open });
    paintFold();
  }

  /** 빈 필수칸은 파란 윤곽선으로, 맞지 않는 칸은 붉게 표시하고, 올릴 수 있는지를 한 줄로 말한다. */
  function paintNeed() {
    const fields = fieldsFor(st.form);
    const miss = new Set(missingFields(st.form));
    const bad = new Map(problems(st.form).map((p) => [p.key, p.message]));
    for (const node of el.fields.querySelectorAll('.at-field')) {
      const key = node.dataset.key;
      node.classList.toggle('need', miss.has(key));
      node.classList.toggle('bad', bad.has(key));
      node.classList.toggle('filled', st.filled.has(key) && !miss.has(key));
      const input = node.querySelector('input, select');
      if (input) {
        input.setAttribute('aria-describedby', `at_${key}_msg`);
        input.setAttribute('aria-required', String(fields.some((f) => f.key === key && f.required)));
        input.setAttribute('aria-invalid', String(bad.has(key)));
        // 목록의 잠금을 지금 폼에 맞춘다 — 당일 유연근무는 날짜를 옮기면 07:00·11:00 이 잠기거나 풀린다.
        const locked = new Set((fields.find((f) => f.key === key)?.options || []).filter((o) => o.disabled).map((o) => o.value));
        for (const o of input.options || []) o.disabled = locked.has(o.value);
      }
      // 빈 칸에는 따로 적지 않는다 — 이름 옆의 "필수"와 파란 윤곽선으로 충분하다(2026-10-02 사용자 지정).
      node.querySelector('.at-msg').textContent = bad.get(key) || '';
    }
    // 며칠간: 칩과 끝나는 날이 같은 값을 가리키게 맞춘다. 달력에서 고르는 중이면 그 칸은 건드리지 않는다.
    for (const b of el.fields.querySelectorAll('button[data-days]')) {
      const on = +b.dataset.days === st.form.days;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    // 끝나는 날 달력(휴가의 며칠간 줄 · 출장의 도착일 칸)을 폼의 종료일에 맞춘다. 고르는 중이면 그 칸은 건드리지 않는다.
    for (const endDay of [$('at_days'), $('at_dateTo')]) {
      if (!endDay) continue;
      endDay.min = st.form.dateFrom || '';
      if (document.activeElement !== endDay) endDay.value = st.form.dateTo || '';
    }
    paintHalfNote();
    paintSpanNote();
    paintFlexNote();
    // 빈 칸은 윤곽선으로, 맞지 않는 칸은 그 칸에 칠하고 적어 알린다. 여기서는 다 채워졌을 때 무엇이 올라가는지만 한 줄로 말한다
    // (빈 칸 이름을 한 번 더 늘어놓던 줄은 뺐다 — 2026-10-02 사용자 지정).
    const ready = !miss.size && !bad.size && !!KINDS[st.form.kind];
    el.need.className = 'at-need';
    el.need.textContent = ready ? `올릴 내용 — ${sendSummary()}` : '';
    el.submit.disabled = !ready || st.busy;
    el.save.disabled = !ready || st.busy;
    el.chatGo.disabled = st.busy;
    paintCars();
  }

  /* ---------------------------------------------------------------- 차량 조회 */

  let carTimer = null;
  let carSeq = 0;
  const carKey = (win) => `${win.from} ${win.start}~${win.to} ${win.end}`;
  // days 는 사이트에서 읽은 그 기간의 현황, result 는 그것을 근무지에 맞춰 가른 것(carsInWindow)이다.
  // booking 은 신청을 보내는 중인 차량의 이름, note 는 방금 한 신청의 결과 글({text, error})이다.
  const carIdle = () => ({ key: '', win: null, loading: false, days: null, result: null, error: '', booking: '', note: null });
  /** 차량 상자를 다시 그린다. 어느 차량을 고를 수 있는지는 근무지에 달려 있어, 그릴 때마다 지금의 근무지로 다시 가른다(사이트를 다시 읽지는 않는다). */
  const drawCars = () => {
    const box = $('atCars');
    if (!box) return;
    if (st.cars.days) st.cars.result = carsInWindow(st.cars.win, st.cars.days, { region: regionOf(st.form.workplace) });
    box.innerHTML = carsHtml();
  };

  /**
   * 출장·외근 폼의 차량 조회(2026-10-03 사용자 지정). 폼의 날짜·시간이 바뀌면 그 기간의 차량 이용 현황을 다시 읽어
   * 빈 차량을 폼 아래에 보인다. 값을 고치는 중에는 잠깐 기다렸다가(CAR_WAIT_MS) 읽고, 처음 켰을 때는 바로 읽는다.
   * 꺼 두었거나 다른 종류로 옮겼으면(상자가 없다) 찾던 것을 버린다.
   */
  function paintCars() {
    const box = $('atCars');
    const win = box ? carWindow(st.form) : null;
    const key = win ? carKey(win) : '';
    if (key !== st.cars.key) {
      clearTimeout(carTimer);
      carSeq++;
      const first = !st.cars.key;
      const long = !!win && windowDays(win).length > MAX_CAR_DAYS;
      // 신청한 뒤에는 같은 기간을 다시 읽는다(비워 두었다가 온다) — 그때는 방금의 결과 글을 들고 간다. 기간이 바뀌었으면 버린다.
      st.cars = { ...carIdle(), key, win, loading: !!win && !long, note: first && box ? st.cars.note : null };
      if (st.cars.loading) carTimer = setTimeout(() => lookupCars(key, win), first ? 0 : CAR_WAIT_MS);
    }
    drawCars();
  }

  /** 그 기간의 차량 현황을 읽는다. 던지지 않는다 — 못 읽으면 까닭을 상자에 적는다. 그 사이 기간이 바뀌었으면 버린다. */
  async function lookupCars(key, win) {
    const seq = ++carSeq;
    let next;
    try {
      next = { days: await cars.scan(windowDays(win).map((d) => d.date)) };
    } catch (err) {
      next = { error: err.message };
      logEvent('car-find', false, `차량 조회 실패: ${windowLabel(win)} — ${err.message}`, { auth: err instanceof AuthError, portal: err.portal });
    }
    if (seq !== carSeq || st.cars.key !== key) return;
    st.cars = { ...st.cars, loading: false, ...next };
    drawCars();
  }

  /**
   * 차량 상자의 내용 — 머리 줄(기간 · 다시 조회), 차량마다 한 줄(네 줄쯤 보이고 나머지는 스크롤 — CSS), 그 아래 알림.
   * 빈 차량의 줄만 누를 수 있고, 누르면 그 차량을 이 기간으로 신청한다. 무엇이 나가는지(기간·행선지)는 상자에 적혀 있다.
   */
  function carsHtml() {
    const c = st.cars;
    const note = (text, cls = '') => `<p class="at-cars-note${cls}">${escapeHtml(text)}</p>`;
    if (!c.win) return note('날짜와 시간을 넣으면 그 시간에 빈 차량을 찾습니다.');
    const long = windowDays(c.win).length > MAX_CAR_DAYS;
    const again = long ? '' : `<button type="button" class="small ghost at-web" data-car-act="again" title="${CAR_AGAIN_TITLE}" aria-label="${CAR_AGAIN_TITLE}"`
      + `${c.loading || c.booking ? ' disabled' : ''}>${CAR_AGAIN_ICON}</button>`;
    const head = `<div class="at-cars-head"><strong>차량</strong><span class="at-cars-when">${escapeHtml(windowLabel(c.win))}</span>${again}</div>`;
    // 방금 한 신청의 결과. 현황을 다시 읽는 동안에도 남아 있다.
    const done = c.note ? note(c.note.text, c.note.error ? ' error' : ' ok') : '';
    if (long) return head + note(`차량 조회는 ${MAX_CAR_DAYS}일까지만 봅니다 — 더 긴 기간은 차량 탭에서 확인하세요.`);
    if (c.loading) return head + done + note('차량 현황을 읽는 중...');
    if (c.error) return head + done + note(`차량 현황을 읽지 못했습니다: ${c.error}`, ' error');
    const region = regionOf(st.form.workplace);
    const rows = c.result.cars.map((row, i) => {
      const name = `<span class="at-car-name">${escapeHtml(row.car.label || row.car.name)}</span>`;
      if (row.state === 'free' && !row.lock) {
        return `<li><button type="button" class="at-car free" data-car="${i}" title="누르면 이 시간으로 바로 신청합니다"${c.booking ? ' disabled' : ''}>`
          + `${name}<span class="at-car-state">${c.booking === row.car.name ? '신청하는 중...' : CAR_STATE.free}</span></button></li>`;
      }
      // 비어 있지만 고를 수 없는 차량 — 다른 근무지의 차량, 임원용·사전 협의 차량, 사이트가 막는 차량. 까닭을 적는다.
      if (row.state === 'free') {
        return `<li><div class="at-car locked" title="${escapeHtml(row.car.blocked || '여기서는 고를 수 없는 차량입니다 — 권한이 있거나 협의를 마쳤으면 차량 탭이나 사이트에서 신청하세요')}">${name}`
          + `<span class="at-car-state">${escapeHtml(row.lock)}</span></div></li>`;
      }
      // 겹치는 신청은 언제·누구인지 적는다. 내 신청이면 그렇다고 적는다 — 이미 잡아 둔 차를 또 잡지 않게.
      const busy = row.busy.map((b) => `${b.label}${b.mine ? ' 내 신청' : b.owner ? ` ${b.owner}` : ''}`).join(' · ');
      return `<li><div class="at-car ${row.state}${row.mine ? ' mine' : ''}">${name}`
        + `<span class="at-car-state">${escapeHtml(busy || CAR_STATE.unknown)}</span></div></li>`;
    }).join('');
    const empty = c.result.cars.filter((row) => row.state === 'free');
    const free = empty.filter((row) => !row.lock).length;
    const notes = [];
    if (!c.result.cars.length) notes.push(note('차량을 하나도 읽지 못했습니다 — 차량 탭에서 확인하세요.', ' error'));
    // 차량은 근무지(서울·부산)의 것을 잡는다. 근무지를 모르면 어느 차량도 고를 수 없다 — 먼저 적게 한다.
    else if (!region) notes.push(note('근무지(서울 또는 부산)를 적으면 그 근무지의 차량을 고를 수 있습니다.', ' need'));
    else if (!free && !c.result.unsure.length) {
      notes.push(note(empty.length ? `이 시간에 ${region}에서 고를 수 있는 빈 차량이 없습니다.` : '이 시간에 빈 차량이 없습니다.'));
    }
    if (free) {
      // 한 번 누르면 나간다. 사이트는 행선지가 있어야 신청을 받으므로, 무엇이 행선지로 가는지(또는 무엇을 먼저 적어야 하는지)를 적어 둔다.
      const place = carPlaceOf(st.form);
      notes.push(place
        ? note(`빈 차량을 누르면 이 시간으로 바로 신청합니다 · 근무지 ${region} · 행선지 ${place}`)
        : note(`빈 차량을 누르면 이 시간으로 바로 신청합니다(근무지 ${region}) — 먼저 ${carPlaceName()}를 적어 주세요(차량 신청에 필요합니다).`, ' need'));
    }
    if (c.result.unsure.length) {
      notes.push(note(`${c.result.unsure.map((u) => md(u.date)).join('·')} 의 현황을 확신할 수 없어 비어 있다고 하지 않습니다 — 차량 탭에서 확인하세요. (${c.result.unsure[0].reason})`, ' error'));
    }
    if (c.win.rounded) notes.push(note('차량은 한 시간 단위로 잡습니다 — 폼의 시간을 정시에 맞춰 넓혀 봤습니다.'));
    return head + done + (rows ? `<ul class="at-cars-list">${rows}</ul>` : '') + notes.join('');
  }

  /** 차량의 행선지를 받는 칸의 이름 — 출장이면 출장지, 아니면 행선지. */
  const carPlaceName = () => (carPlaceKey(st.form) === 'place' ? '출장지' : '행선지');

  /**
   * 빈 차량을 눌렀을 때 — 그 차량을 폼의 기간으로 **그 자리에서 신청한다**(2026-10-03 사용자 지정: 차량 탭으로 넘어가지 않는다).
   * 한 번 누르면 나간다 — 무엇이 나가는지(차량·기간·행선지)는 상자에 적혀 있다. 행선지가 비었으면 보내지 않고 그 칸에 손을 놓는다.
   * 신청은 바깥(onCar — 차량 탭의 예약하기와 같은 길)이 하고 재조회로 확인한다. 끝나면 현황을 다시 읽어, 됐으면 그 차량이
   * "내 신청"으로 바뀐 것을, 확인하지 못했으면 지금의 사실을 보인다.
   */
  async function reserveCar(i) {
    const c = st.cars;
    const row = c.result?.cars[i];
    if (!row || row.state !== 'free' || row.lock || !c.win || c.booking || st.busy) return;
    if (!carPlaceOf(st.form)) {
      setStatus(`차량을 신청하려면 ${carPlaceName()}가 필요합니다 — 적은 뒤 다시 눌러 주세요.`, 'error');
      $(`at_${carPlaceKey(st.form)}`)?.focus();
      return;
    }
    const pick = carPick(c.win, row.car, st.form);
    const what = `${row.car.name} ${windowLabel(c.win)} · 행선지 ${pick.place}`;
    c.booking = row.car.name;
    c.note = null;
    drawCars();
    setStatus(`차량을 신청하는 중 — ${what}`);
    let r;
    try {
      r = await onCar(pick);
    } catch (err) {
      r = { ok: false, submitted: false, message: err.message };
    }
    const note = r?.ok
      ? { text: `신청했습니다 — ${what}` }
      : { text: `${r?.submitted ? '신청을 보냈지만 확인하지 못했습니다' : '신청하지 못했습니다'} — ${row.car.name}: ${r?.message || '까닭을 알 수 없습니다'}`, error: true };
    setStatus(r?.ok ? `차량을 신청했습니다 — ${what}` : note.text, r?.ok ? '' : 'error');
    // 됐든 안 됐든 현황을 다시 읽는다. 그 사이 차량 조회를 껐으면(상자가 없다) 결과 글도 버린다.
    st.cars = { ...carIdle(), note: $('atCars') ? note : null };
    paintCars();
  }

  /** 차량 상자를 눌렀을 때 — 다시 조회, 또는 빈 차량을 신청한다. */
  function onCarClick(e) {
    const b = e.target instanceof HTMLElement ? e.target.closest('#atCars button') : null;
    if (!b) return undefined;
    disarm();
    if (b.dataset.carAct === 'again') {
      st.cars = carIdle();
      return paintCars();
    }
    return reserveCar(+b.dataset.car);
  }

  /* ---------------------------------------------------------------- 반차와 근무시간 */

  /**
   * 그 날 근무시간을 읽어 둔다(주간 근무시간표 + 그 날짜로 올려 둔 유연근무). 던지지 않는다 —
   * 못 읽으면 error 를 담아 두고, 반차는 유연근무 없이 그대로 올린다(화면이 그 사실을 말한다).
   */
  function loadSched() {
    if (st.sched) return Promise.resolve(st.sched);
    st.schedWait ||= (async () => {
      try {
        const today = attendToday();
        const week = await hrWeekTimes();
        const { rows } = await hrListDocs({ from: monthsAgo(today, SCHED_MONTHS), to: today });
        st.sched = { week, items: listItems(rows) };
      } catch (err) {
        st.sched = { error: err.message };
      }
      st.schedWait = null;
      return st.sched;
    })();
    return st.schedWait;
  }

  /** 지금 폼이 반차면 그 날 근무시간에서 어떻게 잡히는지. 반차가 아니거나 근무시간을 모르면 null. */
  const planNow = () => (st.sched && !st.sched.error ? halfPlan(st.form, workStartOn(st.form.dateFrom, st.sched)) : null);

  const flexSpan = (start) => `${start}~${String(+start.slice(0, 2) + 9).padStart(2, '0')}${start.slice(2)}`;

  /** 올릴 것을 한 줄로. 반차 앞에 유연근무를 올려야 하면 그것부터 적는다. */
  function sendSummary() {
    const head = docSummary();
    return wantsTrip(st.form) ? `${head} → 결재요청 뒤 여비계산서(사전정산): ${describePlan(settlePlan(st.form, memoOf(st.form)))}` : head;
  }

  /** HR 에 올라가는 신청서만 한 줄로(여비계산서는 빼고). 올린 뒤의 말과 기록에 쓴다. */
  function docSummary() {
    const plan = planNow();
    return plan?.flexStart
      ? `유연근무 ${md(st.form.dateFrom)} ${flexSpan(plan.flexStart)} → ${describe(st.form)}`
      : describe(st.form);
  }

  /** 이 폼을 결재요청하면 여비계산서(사전정산)도 만드는가. */
  const wantsTrip = (form) => form.kind === 'trip' && !!form.settle;

  /**
   * 출장 결재요청이 올라간 뒤 여비계산서(사전정산)를 만든다. 던지지 않는다 — 출장은 이미 올라갔으므로
   * 여비계산서가 안 만들어진 것은 따로 말해 준다. 돌려주는 글은 상태 줄 끝에 붙는다.
   */
  async function makeTripDoc(form) {
    const plan = settlePlan(form, memoOf(form));
    try {
      if (!st.me?.emplNo) throw new Error('HR 에서 사번을 확인하지 못했습니다');
      const r = await tripCreate(plan, { emplNo: st.me.emplNo, name: st.me.name, onStage: setStatus });
      // 이 출장지로 이렇게 갔다고 기억해 둔다 — 다음에 같은 출장지를 적으면 이 교통편·이 길이 먼저다.
      if (!r.existing) keepTripRoute(form.place, routeOfPlan(plan));
      st.trips = null;
      loadTrips();
      const what = `${describePlan(plan)}${plan.notes.length ? ` (${plan.notes.join(' / ')})` : ''}`;
      logEvent('trip', true, r.existing ? `여비계산서가 이미 있어 만들지 않음: ${r.row.seq}` : `여비계산서(사전정산) 작성: ${r.row.seq} · ${what}`,
        { seq: r.row.seq, existing: r.existing, linked: r.linked, plan });
      return r.existing
        ? ` · 여비계산서는 이 기간에 이미 있어(${r.row.seq}) 새로 만들지 않았습니다`
        : ` · 여비계산서(사전정산) ${r.row.seq} 을 만들었습니다 — ${what}`;
    } catch (err) {
      logEvent('trip', false, `여비계산서(사전정산) 작성 실패: ${err.message}`, { plan, auth: err instanceof AuthError });
      return ` · 여비계산서는 만들지 못했습니다: ${err.message}`;
    }
  }

  /** 구분 칸 아래에 반차가 몇 시부터 몇 시인지, 출근시간을 먼저 옮겨야 하는지 적는다. */
  function paintHalfNote() {
    const msg = $('at_half_msg');
    if (!msg) return;
    msg.classList.remove('note');
    if (!halfOf(st.form)) return;
    msg.classList.add('note');
    if (!st.sched) {
      msg.textContent = '이 날 근무시간을 확인하는 중...';
      // 읽히면 다시 그린다. 그 사이 폼이 바뀌었어도 지금 폼으로 그리므로 괜찮다.
      loadSched().then(() => { if ($('at_half_msg')) paintNeed(); });
      return;
    }
    const name = halfOf(st.form) === 'am' ? '오전' : '오후';
    const plan = planNow();
    if (st.sched.error) {
      msg.textContent = `근무시간을 확인하지 못했습니다. 출근이 정시가 아니면(08:30) 유연근무로 09:00 출근으로 먼저 바꿔 주세요.`;
    } else if (!plan) {
      msg.textContent = '이 날은 근무시간표에 없습니다(주말).';
    } else if (plan.flexStart) {
      msg.textContent = `이 날 근무가 ${flexSpan(plan.workStart)} 이라, 유연근무 ${flexSpan(plan.flexStart)} 을 먼저 올리고 ${name} 반차(${plan.from}~${plan.to})를 올립니다.`;
    } else {
      msg.textContent = `${name} 반차 ${plan.from}~${plan.to} (이 날 근무 ${flexSpan(plan.workStart)})`;
    }
  }

  /* ---------------------------------------------------------------- 유연근무의 기간 */

  /**
   * 주간 유연근무의 빈 요일 칸을 지금 근무시간표로 채운다 — HR 화면이 Weekly 를 고르면 하는 일과 같다.
   * 바꿀 요일만 고치면 된다. 근무시간표를 아직 안 읽었으면 읽은 뒤 다시 그리고, 못 읽으면 빈 칸으로 두어 직접 고르게 한다.
   * 임시저장 문서를 고칠 때는 그 문서의 값을 그대로 둔다.
   */
  function seedFlexWeek() {
    if (st.edit || flexModeOf(st.form) !== 'week' || FLEX_DAYS.every((d) => st.form[d.key])) return;
    if (st.sched) {
      if (!st.sched.error) st.form = fillFlexWeek(st.form, st.sched.week);
      return;
    }
    loadSched().then((s) => { if (!s.error && flexModeOf(st.form) === 'week') paintForm(); });
  }

  /** 기간 칩 아래에 주간·전체가 언제부터 반영되는지 적는다(HR 신청서의 안내문). 당일에는 적을 것이 없다. */
  function paintFlexNote() {
    const msg = $('at_flexMode_msg');
    if (!msg) return;
    const mode = flexModeOf(st.form);
    msg.classList.toggle('note', mode !== 'day');
    if (mode === 'day') return;
    msg.textContent = '결재되면 다음 주 월요일부터 반영됩니다. 날짜·사유는 받지 않습니다.'
      + (mode === 'all' ? ' 07:00·11:00 출근은 월·금요일에만 있어 주간에서 요일별로 고릅니다.' : '');
  }

  /** 몇 시간 칸 아래에 그래서 몇 시부터 몇 시까지인지 적는다. 빈 칸·맞지 않는 칸이면 그 말이 먼저다. */
  function paintSpanNote() {
    const msg = $('at_span_msg');
    if (!msg) return;
    const on = !msg.textContent && !!st.form.start && !!st.form.end;
    msg.classList.toggle('note', on);
    if (on) msg.textContent = `${st.form.start} ~ ${st.form.end}`;
  }

  /** "내역"(모든 종류)과 고른 종류의 것만 보기 사이를 오간다. 기억해 두고 다음에 열 때도 그대로다. */
  function setView(view) {
    if (st.edit) return;
    disarm();
    st.view = view === 'all' ? 'all' : '';
    chrome.storage.local.set({ attendView: st.view });
    paintKinds();
    paintForm();
    paintList();
  }

  function setKind(kind) {
    if (st.edit || !KINDS[kind]) return;
    disarm();
    st.filled.clear();
    if (st.view) {
      st.view = '';
      chrome.storage.local.set({ attendView: '' });
    }
    st.form = applyPatch(st.form, { kind }, attendToday()).form;
    chrome.storage.local.set({ attendKind: kind });
    setFold(true);
    paintKinds();
    paintForm();
    paintList();
  }

  function resetForm() {
    disarm();
    st.edit = null;
    st.filled.clear();
    st.form = blank(st.form.kind);
    paintKinds();
    paintForm();
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      fr.readAsDataURL(file);
    });
  }

  /** 고르거나 끌어다 놓은 파일을 폼에 담는다. 너무 크거나 읽지 못하면 비우고 말해 준다. */
  async function takeFile(node, file) {
    let picked = null;
    const spec = fieldsFor(st.form).find((f) => f.key === node.dataset.key);
    if (file && spec?.accept && !acceptsFile(spec.accept, file)) {
      setStatus(`${spec.label}은 ${spec.acceptName || '정해진 형식'}만 받습니다 — ${file.name}`, 'error');
    } else if (file && file.size > FILE_LIMIT) {
      setStatus(`첨부파일이 너무 큽니다(${Math.round(file.size / 1048576)}MB). 10MB 이하로 올려 주세요.`, 'error');
    } else if (file) {
      try {
        picked = { name: file.name, type: file.type, size: file.size, dataUrl: await readFile(file) };
      } catch (err) {
        setStatus(err.message, 'error');
      }
    }
    st.form.file = picked;
    node.querySelector('.at-file').textContent = picked?.name || '';
    node.querySelector('.at-drop').classList.toggle('picked', !!picked);
  }

  const hasFiles = (e) => !!e.dataTransfer?.types?.includes('Files');
  const fileField = (e) => (e.target instanceof HTMLElement ? e.target.closest('.at-field.at-file') : null);

  /** 파일을 첨부 칸 위로 끌고 왔을 때. 놓을 수 있는 자리임을 칸에 표시한다. */
  function onFileDrag(e) {
    const node = fileField(e);
    if (!node || !hasFiles(e)) return;
    if (e.type === 'dragleave') {
      if (!node.contains(e.relatedTarget)) node.classList.remove('over');
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    node.classList.add('over');
  }

  async function onFileDrop(e) {
    const node = fileField(e);
    if (!node || !hasFiles(e)) return;
    e.preventDefault();
    node.classList.remove('over');
    disarm();
    st.filled.delete(node.dataset.key);
    const files = e.dataTransfer.files;
    await takeFile(node, files[0]);
    if (files.length > 1 && st.form.file) setStatus(`파일은 하나만 붙습니다 — ${st.form.file.name} 만 담았습니다.`);
    st.form = settle(st.form);
    paintNeed();
  }

  /**
   * 붙여넣기(Ctrl+V). 첨부 칸이 있는 폼이 펴져 있을 때 클립보드에 파일(캡처한 화면, 탐색기에서 복사한 파일)이 있으면
   * 그 칸에 담는다(2026-10-03 사용자 지정). 클립보드에 파일이 없으면(글) 건드리지 않는다 — 글 칸의 붙여넣기는 그대로 간다.
   */
  async function onPaste(e) {
    const files = e.clipboardData?.files;
    if (!files?.length || el.root.classList.contains('hidden')) return;
    // 열어 둔 출장 카드의 사후정산 칸이나 초점이 있는 출장 줄이 있으면 거기로 간다 — 카드를 고른 것이 더 나중의 뜻이다.
    const seq = pasteSeq();
    if (seq && !st.after[seq]?.busy) {
      e.preventDefault();
      return runAfter(seq, [...files]);
    }
    const node = el.fields.querySelector('.at-field.at-file');
    if (!node || st.busy || !st.formOpen || el.form.classList.contains('hidden')) return;
    e.preventDefault();
    disarm();
    st.filled.delete(node.dataset.key);
    await takeFile(node, namedPaste(files[0], node));
    st.form = settle(st.form);
    paintNeed();
    if (st.form.file) setStatus(`붙여 넣은 ${st.form.file.name} 을 담았습니다.`);
  }

  /** 캡처한 화면은 이름 없이("image.png") 온다. 무엇의 증빙인지 보이게 칸 이름과 날짜를 붙인 이름을 준다. */
  function namedPaste(file, node) {
    if (!/^image\.[a-z0-9]+$/i.test(file.name || '')) return file;
    const label = (node.querySelector('.at-label')?.textContent || '첨부').replace(/필수|\s/g, '');
    const ext = file.name.split('.').pop().toLowerCase();
    // file.constructor 는 그 파일이 온 창의 File 이다 — 다른 창(검사 환경)의 File 로 싸면 FileReader 가 읽지 못한다.
    return new file.constructor([file], `${label}_${st.form.dateFrom || attendToday()}.${ext}`, { type: file.type });
  }

  /** 칩을 눌렀을 때. 갈래·구분·며칠간이 바뀌면 물을 칸이 달라지므로 폼을 새로 그린다. */
  function onChipClick(e) {
    const b = e.target instanceof HTMLElement ? e.target.closest('button.at-chip') : null;
    const key = b?.closest('.at-field')?.dataset.key;
    if (!key || st.busy) return;
    disarm();
    // 저장된 유연근무 문서는 HR 이 기간구분(Daily·Weekly)을 잠근다. 주간과 전체는 같은 Weekly 라 오갈 수 있다.
    const flexCode = (m) => FLEX_MODES.find((x) => x.value === m)?.code;
    if (key === 'flexMode' && st.edit && flexCode(b.dataset.choice) !== flexCode(flexModeOf(st.form))) {
      setStatus('임시저장 문서는 당일과 주간·전체 사이를 바꿀 수 없습니다. 새 신청서로 올려 주세요.', 'error');
      return;
    }
    st.filled.delete(key);
    const pick = b.dataset.span;
    const value = 'days' in b.dataset ? Number(b.dataset.days)
      : pick ? nextSpan(st.form, pick === 'half' ? pick : Number(pick)) : b.dataset.choice;
    // 갈래는 깔아 주는 값이 있을 수 있다(소통을 고르면 13~14시와 목적이 채워진다).
    // 교통편은 여럿을 함께 켜고 끄며, 기차는 일반석 → 특실 → 꺼짐으로 돈다.
    if (key === 'transport') st.transportSet = true;   // 손댄 아이콘은 출장지의 기억으로 덮어쓰지 않는다
    st.form = key === 'sub' ? withSub(st.form, value)
      : key === 'transport' ? settle({ ...st.form, ...nextTransport(st.form, value) })
        : settle({ ...st.form, [key]: value });
    paintForm();
    // 몇 시간·교통편은 칩 여럿이 함께 켜질 수 있다. 누른 그 칩으로 돌아간다(꺼져도 그 자리다).
    const again = pick ? `[data-span="${pick}"]` : key === 'transport' ? `[data-choice="${value}"]` : '.active';
    el.fields.querySelector(`.at-field[data-key="${key}"] .at-chip${again}`)?.focus();
  }

  async function onFieldInput(e) {
    const node = e.target instanceof HTMLElement ? e.target.closest('.at-field') : null;
    if (!node) return;
    const key = node.dataset.key;
    const input = e.target;
    disarm();
    st.filled.delete(key);
    if (key === 'days' || key === 'dateTo') {
      // 달력(휴가는 며칠간 줄의 달력, 출장은 도착일 칸)에서 끝나는 날을 골랐다. 시작일부터 며칠인지로 바꿔 담는다.
      // 고르는 중(빈 값)이면 그대로 둔다.
      if (!input.value) return;
      const n = spanDays(st.form.dateFrom, input.value);
      if (!(n >= 1 && n <= MAX_TRIP_DAYS)) {
        // 손으로 치는 중에는 덜 된 날짜가 지나간다. 다 친 뒤(change)에도 벗어나 있으면 되돌리고 말해 준다.
        if (e.type !== 'change') return;
        input.value = st.form.dateTo || '';
        return setStatus(`끝나는 날은 시작일부터 ${MAX_TRIP_DAYS}일 안에서 골라 주세요.`, 'error');
      }
      const was = st.form.days;
      st.form = settle({ ...st.form, days: n });
      // 구분 칸은 하루짜리 연차에만 있다. 하루와 여러 날 사이를 오갔으면 칸이 생기거나 없어진다.
      if (e.type === 'change' && st.form.kind === 'leave' && (was === 1) !== (n === 1)) return paintForm();
      return paintNeed();
    }
    if (input.type === 'checkbox') {
      st.form[key] = input.checked;
      if (key === 'allDay' || key === 'settle' || key === 'car') {   // 칸이 생기거나 없어진다(시각 / 근무지·교통편 / 차량 목록)
        st.form = settle(st.form);
        return paintForm();
      }
    } else if (input.type === 'file') {
      await takeFile(node, input.files?.[0]);
    } else {
      st.form[key] = input.value;
      if (key === 'workplace') {
        st.workplace = input.value.trim();
        chrome.storage.local.set({ attendWorkplace: st.workplace });
      }
    }
    // 종료일은 시작일과 며칠간에서(출장·휴가가 아니면 시작일과 같다), 종료 시각은 시작과 몇 시간에서 나온다.
    st.form = settle(st.form);
    // 적은 출장지가 지난번에 간 곳이면 그때 고른 교통편을 되살린다 — 폼을 새로 그리지 않고 아이콘만 바꾼다(치는 중의 커서가 남는다).
    if (key === 'place' && recallTransport()) paintTransport();
    paintNeed();
  }

  /**
   * 교통편 아이콘을 지금 폼에 맞춘다 — 폼을 새로 그리지 않고 아이콘의 켜짐·특실 표시와, 기차를 고를 때만 필수인 근무지의 "필수" 표시만 바꾼다.
   * 출장지를 치는 중에 기억해 둔 교통편이 되살아날 때 쓴다(새로 그리면 치던 칸의 커서와 누르던 아이콘이 사라진다).
   */
  function paintTransport() {
    const on = transportsOf(st.form);
    const first = trainGradeOf(st.form) === 'first';
    for (const b of el.fields.querySelectorAll('.at-field[data-key="transport"] .at-chip')) {
      const o = TRANSPORTS.find((x) => x.value === b.dataset.choice);
      if (!o) continue;
      const active = on.includes(o.value);
      const plus = active && first && o.value === 'train';
      const name = plus ? `${o.label} ${FIRST_LABEL}` : o.label;
      b.classList.toggle('active', active);
      b.classList.toggle('first', plus);
      b.setAttribute('aria-pressed', String(active));
      b.setAttribute('aria-label', name);
      b.title = name;
    }
    const label = el.fields.querySelector('.at-field[data-key="workplace"] .at-label');
    const need = fieldsFor(st.form).some((f) => f.key === 'workplace' && f.required);
    if (label && need !== !!label.querySelector('.at-req')) {
      if (need) label.insertAdjacentHTML('beforeend', '<em class="at-req">필수</em>');
      else label.querySelector('.at-req').remove();
    }
  }

  /* ---------------------------------------------------------------- 말로 채우기 */

  function paintChat() {
    el.chatLog.innerHTML = st.chat.slice(-4).map((c) =>
      `<li class="at-say ${c.who}${c.error ? ' error' : ''}">${escapeHtml(c.text)}</li>`).join('');
  }

  const CHAT_PLACEHOLDER = '예) 내일 오후 2~4시 부산시청 외근';
  const CHAT_TITLE = '문장을 적으면 아래 입력칸에 반영합니다. 목적도 함께 적어 주세요.';
  const CHAT_OFF_TEXT = 'claude 미연결 — 규칙으로만 읽습니다';
  const CHAT_OFF_HINT = '종류·날짜·시각 같은 흔한 말만 규칙으로 읽고 목적은 채우지 못합니다. 아래 연결 지침을 복사해 Claude Code·Codex 에 붙여 넣거나 설정에 API 키를 넣으면 Claude 가 읽습니다.';

  /**
   * Claude 에 닿을 길(로컬 CLI·API 키)이 있는지에 따라 말로 채우기 칸의 낯을 바꾼다.
   * 말로 찾기와 달리 칸을 잠그지는 않는다 — 날짜·시각 같은 흔한 말은 규칙으로도 읽히니 쓸모가 남는다.
   * 다만 연결됐을 때와 같은 낯(파란 버튼·반짝이·예시 플레이스홀더)이면 연결된 줄 알기 쉽다(2026-10-06 사용자 지적).
   * 그래서 회색으로 내리고 플레이스홀더에 규칙으로만 읽는다고 적는다. 부르는 쪽(sidepanel.js 의 paintAskReady)은
   * CLI 확인이 끝난 뒤에만 끈다 — 패널을 열 때마다 회색이 잠깐 비치지 않게.
   */
  function paintReady(ready) {
    el.root.querySelector('.at-chat')?.classList.toggle('off', !ready);
    el.chatInput.placeholder = ready ? CHAT_PLACEHOLDER : CHAT_OFF_TEXT;
    el.chatInput.title = ready ? CHAT_TITLE : CHAT_OFF_HINT;
  }

  async function runChat() {
    const text = el.chatInput.value.trim();
    if (!text || st.busy || el.chatGo.disabled) return;
    const { apiKey, cli } = ai();
    const history = st.chat.slice();
    st.chat.push({ who: 'me', text });
    st.chat.push({ who: 'ai', text: '읽는 중...' });
    paintChat();
    el.chatInput.value = '';
    el.chatGo.disabled = true;
    try {
      const r = await fillAttendSmart(text, { apiKey, useNative: cli, today: attendToday(), form: st.form, history });
      // 수정 중에는 종류를 바꿀 수 없다. 종류를 말해도 지금 종류에 값만 얹는다.
      const patch = st.edit ? { ...r.patch, kind: undefined } : r.patch;
      const { form, changed } = applyPatch(st.form, patch, attendToday());
      st.form = form;
      st.filled = new Set(changed);
      // 말로 교통편을 정했으면 손댄 것이고, 출장지만 정했으면 지난번에 그 출장지로 갈 때 고른 교통편을 되살린다.
      if (changed.includes('transport') || changed.includes('trainGrade')) st.transportSet = true;
      else if (changed.includes('place')) recallTransport();
      setFold(true);
      const miss = missingFields(form);
      const names = fieldsFor(form).filter((f) => miss.includes(f.key)).map((f) => f.label);
      const tail = !KINDS[form.kind] ? ' 근태 종류를 골라 주세요.'
        : names.length ? ` 남은 칸: ${names.join(', ')}.` : ' 다 채워졌습니다 — 내용을 확인하고 올리세요.';
      const via = VIA_LABEL[r.via] || r.via;
      const reply = r.via === 'local' ? r.reply : (r.reply || `${changed.length}칸을 채웠습니다.`);
      st.chat[st.chat.length - 1] = { who: 'ai', text: `[${via}] ${reply}${r.via === 'local' ? '' : tail}${r.note ? ` (${r.note})` : ''}` };
      if (form.kind) chrome.storage.local.set({ attendKind: form.kind });
      paintKinds();
      paintForm();
      logEvent('attend-ask', true, `"${text}" → [${via}] ${changed.length ? changed.join(', ') : '채운 칸 없음'}${r.note ? ` (${r.note})` : ''}`,
        { via: r.via, kind: form.kind, changed, missing: miss, costUsd: r.costUsd });
    } catch (err) {
      st.chat[st.chat.length - 1] = { who: 'ai', text: err.message, error: true };
      logEvent('attend-ask', false, `"${text}" — ${err.message}`);
    } finally {
      paintChat();
      paintNeed();
      el.chatInput.focus();
    }
  }

  /* ---------------------------------------------------------------- 올리기 */

  const failText = (r) => [...(r.errors || []), r.ok ? '' : r.message].filter(Boolean).join(' · ') || 'HR 이 완료했다고 답하지 않았습니다';

  /** HR 이 띄운 문구 가운데 기록에 남길 것만. */
  const said = (r) => (r.dialogs || []).map((d) => `${d.kind}: ${d.text}`).slice(-6);

  /**
   * 폼을 올린다. 한 번 누르면 바로 나간다 — 무엇이 올라가는지는 버튼 위의 "올릴 내용" 줄에 이미 적혀 있다
   * (2026-10-02 사용자 지정. 두 번 누르기는 신청 내역의 삭제·회수·변경·취소신청에만 남아 있다).
   */
  async function send(action) {
    if (st.busy) return;
    disarm();
    const verb = action === 'request' ? '결재요청' : '임시저장';
    // 반차면 그 날 근무시간부터 본다. 출근이 정시가 아니면 유연근무(09:00~18:00)를 먼저 올려야 한다.
    if (halfOf(st.form) && !st.sched) {
      if (st.checking) return;
      st.checking = true;
      setStatus('이 날 근무시간을 확인하는 중...');
      try { await loadSched(); } finally { st.checking = false; }
      paintNeed();
      // 방금 읽어 보니 유연근무를 먼저 올려야 한다면, "올릴 내용"에 그것이 적힌 것을 본 뒤에 다시 누르게 한다 —
      // 누를 때 보지 못한 신청서가 나가면 안 된다.
      if (halfFlexForm(st.form, planNow(), attendToday())) {
        setStatus(`유연근무를 먼저 올려야 합니다(신청서 두 건). 올릴 내용을 확인하고 다시 눌러 주세요 — ${sendSummary()}`);
        return;
      }
    }
    const flexForm = halfFlexForm(st.form, planNow(), attendToday());
    const summary = docSummary();
    const kind = st.form.kind;
    const editing = st.edit;
    const sent = { ...st.form };   // 올린 그대로. 올린 뒤 폼이 비워져도 여비계산서는 이것으로 짓는다.
    let job;
    let flexJob = null;
    try {
      job = buildJob(st.form, { action, doc: editing ? { docNo: editing.docNo, statusCode: editing.status } : null });
      if (flexForm) flexJob = buildJob(flexForm, { action });
    } catch (err) {
      return setStatus(err.message, 'error');
    }
    setBusy(true);
    try {
      if (flexJob) {
        // 유연근무가 올라가지 않았으면 반차도 올리지 않는다 — 08:30 출근인 채로 반차만 남으면 안 된다.
        const f = await hrRunJob(flexJob, { onStage: (m) => setStatus(`유연근무 — ${m}`) });
        st.sched = null;
        onChanged();
        logEvent('attend', f.ok, `${verb}${f.ok ? '' : ' 실패'}: ${flexJob.summary} · ${f.docNo || ''}${f.ok ? '' : ` — ${failText(f)}`}`,
          { action, kind: 'flex', docNo: f.docNo, stage: f.stage, said: said(f), read: f.read, forHalf: true });
        if (!f.ok) {
          setStatus(`유연근무(출근시간 변경) ${verb} 실패 — 반차는 올리지 않았습니다: ${failText(f)}`, 'error');
          await confirmInList(f.docNo);
          return;
        }
      }
      const r = await hrRunJob(job, { onStage: setStatus });
      if (!r.ok) {
        // 누르기 전에 멈춘 것(값이 안 들어감)과 누른 뒤 사이트가 거절한 것을 가려 말한다.
        const where = r.stage === 'done' ? 'HR 이 받지 않았습니다' : '올리지 않았습니다';
        const left = flexJob ? ' 유연근무는 이미 올라갔습니다 — 신청 내역에서 확인하세요.' : '';
        setStatus(`${verb} 실패 — ${where}: ${failText(r)}${left}`, 'error');
        if (flexJob) await confirmInList(r.docNo);
        logEvent('attend', false, `${verb} 실패: ${summary} — ${failText(r)}`, { action, kind, stage: r.stage, docNo: r.docNo, said: said(r), read: r.read });
        return;
      }
      const state = await confirmInList(r.docNo);
      const want = action === 'request' ? [STATUS.REQUESTED, STATUS.WAIT, STATUS.APPROVED] : [STATUS.TEMP];
      const seen = state && want.includes(state.status);
      // 올라간 것은 확인됐는데 지금 보는 기간 밖의 날짜면 목록에는 없다. 없어진 줄 알지 않게 말해 준다.
      const hidden = seen && !st.items.includes(state) ? ' · 지금 보는 기간 밖의 날짜라 목록에는 보이지 않습니다' : '';
      // 출장이 결재요청으로 올라갔으면 이어서 여비계산서(사전정산)를 만든다. 임시저장에서는 만들지 않는다.
      const trip = seen && action === 'request' && wantsTrip(sent) ? await makeTripDoc(sent) : '';
      setStatus(seen
        ? `${verb}했습니다 — ${summary} · ${r.docNo} (${state.statusName})${hidden}${trip}`
        : `${verb}했다고 HR 이 답했지만 목록에서 확인하지 못했습니다 — ${r.docNo || '문서번호 없음'}. HR 에서 확인해 주세요.`,
      seen && !/못했습니다/.test(trip) ? '' : 'error');
      onChanged();
      st.sched = null;   // 올린 것이 그 날의 근무시간을 바꿨을 수 있다(유연근무). 다음 반차 때 다시 읽는다.
      logEvent('attend', seen, `${verb}: ${summary} · ${r.docNo}${seen ? '' : ' (목록에서 미확인)'}`,
        { action, kind, docNo: r.docNo, status: state?.statusName, read: r.read, edited: !!editing });
      st.edit = null;
      st.filled.clear();
      st.form = blank(kind);
      paintKinds();
      paintForm();
    } catch (err) {
      setError(err, `${verb} 실패`);
      logEvent('attend', false, `${verb} 실패: ${summary} — ${err.message}`, { action, kind, auth: err instanceof AuthError });
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------------- 신청 내역 */

  const monthsAgo = (today, n) => {
    const [y, m, d] = today.split('-').map(Number);
    const x = new Date(y, m - 1 - n, d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };

  /**
   * 한 건은 두 줄이다 — 첫 줄에 상태와 요약, 둘째 줄에 내용 한 줄(넘치면 줄인다).
   * 누르면 펴져서 내용 전체와 그 상태에서 할 수 있는 일(변경·취소신청 …)이 나온다. 문서번호는 적지 않는다(2026-10-03 사용자 지정).
   */
  /** 지금 보이는 신청 내역 — 고른 종류의 것만, "내역"이면 전부. 목록의 data-i 는 이 배열의 차례다. */
  const shownItems = () => (st.view === 'all' ? st.items : itemsOfKind(st.items, st.form.kind));

  function paintList() {
    const items = shownItems();
    el.count.textContent = st.loadedOnce ? String(items.length) : '';
    el.empty.classList.toggle('hidden', !st.loadedOnce || items.length > 0);
    // 종류로 걸러서 빈 것이면 다른 종류에는 있다고 말해 준다 — "없다"고만 하면 기간을 넓히러 간다.
    el.empty.textContent = st.loadedOnce && !items.length && st.items.length && st.view !== 'all'
      ? `이 기간에 ${KINDS[st.form.kind]?.label || '이 종류'} 신청이 없습니다. 다른 종류는 종류 줄 끝의 "내역"에서 보세요.`
      : EMPTY_TEXT;
    const today = attendToday();
    el.list.innerHTML = items.map((it, i) => {
      const open = st.openDoc === it.docNo;
      // 왼쪽 딱지는 근태의 결재 상태(신청·승인 …), 출장 줄의 오른쪽 딱지는 정산 상태다(2026-10-04 사용자 지정). 색은 결재 상태만 가린다.
      const trip = tripOf(it);
      const stage = trip ? tripStage(trip, st.trips.me) : null;
      const chip = settleChip(it, trip, stage, today);
      // 취소가 걸린 건: 'pending' 취소 중(취소신청서 결재 전) · 'done' 취소(취소신청서 결재완료 — 원 문서는 HR 목록에서 결재완료 그대로다).
      const off = cancelState(it);
      const head = `<button type="button" class="at-head" aria-expanded="${open}" aria-controls="atMore_${i}">`
        + `<span class="at-row"><span class="at-st" title="${escapeHtml(off === 'done' ? `${it.statusName} · 취소신청 결재완료` : off ? `${it.statusName} · 취소신청 결재 대기` : it.statusName)}">${escapeHtml(off === 'done' ? CANCELLED_LABEL : off ? CANCELLING_LABEL : statusLabel(it))}</span>`
        + `<span class="at-sum">${escapeHtml(it.summary)}</span>${chip}</span>`
        + `<span class="at-reason">${escapeHtml(it.reason || it.formName || '')}</span></button>`;
      // 지난 건은 상태 딱지를 회색으로 가라앉힌다(스타일이 결재완료에만 건다).
      const cls = `st-${escapeHtml(it.status)}${off === 'done' ? ' cancelled' : off ? ' cancelling' : ''}${isPast(it, today) ? ' past' : ''}${st.edit?.docNo === it.docNo ? ' editing' : ''}`;
      if (!open) return `<li data-i="${i}" class="${cls}">${head}</li>`;
      // 취소신청을 이미 올린 건은 다시 무를 수 없다 — 변경·취소신청 버튼을 걷는다.
      const acts = it.actions.filter((a) => !off || (a !== 'cancel' && a !== 'change')).map((a) =>
        `<button type="button" class="small ${a === 'delete' || a === 'cancel' || a === 'recall' ? 'at-warn' : a === 'request' || a === 'change' ? 'at-request' : 'ghost'}" data-act="${a}" `
        + `title="${escapeHtml(ACTION_TITLE[a])}"${st.busy ? ' disabled' : ''}>${ACTION_LABEL[a]}</button>`).join('')
        // 이 문서를 HR 웹 화면에서 본다(제목 줄의 "HR 열기"와 같은 아이콘). 보내는 것이 없어 한 번만 누르면 된다.
        + (it.web ? `<button type="button" class="small ghost at-web" data-act="web" title="${WEB_TITLE}" aria-label="${WEB_TITLE}"`
          + `${st.busy ? ' disabled' : ''}>${WEB_ICON}</button>` : '');
      const cancelBox =st.cancelFor === it.docNo
        ? `<div class="at-cancel">`
          + (st.cancelThen === 'copy' ? '<p class="at-help">결재가 끝난 건은 고칠 수 없습니다. 취소신청을 올리고, 같은 내용을 폼에 불러와 새로 올립니다.</p>' : '')
          + `<input type="text" id="atCancelReason" aria-label="취소 사유 (필수)" placeholder="취소 사유 (필수)" autocomplete="off" />`
          + `<button type="button" class="small at-warn" data-act="cancel-go"${st.busy ? ' disabled' : ''}>`
          + `${st.cancelThen === 'copy' ? '취소신청 올리고 폼에 불러오기' : '취소신청 올리기'}</button></div>` : '';
      // 출장이면 여비계산서 한 줄: 단계와 바로 가기 아이콘. 계산서가 없으면 목록 화면이 열린다.
      // 아이콘의 숫자(1 사전정산 · 2 사후정산)와 색(회색 미작성 · 녹색 작성 중 · 파랑 완료)이 단계를 말한다.
      const icon = tripIconState(trip, stage);
      // 사후정산 단계(아이콘 2)의 출장에는 그 왼쪽에 사전정산 아이콘(1)도 선다(2026-10-05 사용자 지정: "사전 정산도 가서 볼 수 있게
      // 사전 정산1도") — 누르면 사전정산 입력 화면이 열린다. 사후정산 단계면 사전정산은 완료한 것이라 파랑이다.
      const preBtn = icon.digit !== 2 ? '' : `<button type="button" class="small ghost at-web at-tripbtn done" data-act="trip-pre" title="${TRIP_PRE_TITLE}" aria-label="${TRIP_PRE_TITLE}">${tripIcon(1)}</button>`;
      // 여비계산서 다시 읽기(2026-10-05 사용자 지정: "여비계산서 기준으로 관리하도록 했는데... 여기에 계산서 새로고침이 없네") — 카드가
      // 여비계산서에 저장된 값을 보이므로, 사이트에서 고친 것을 가져올 길이 있어야 한다. 읽기만 한다(refreshTrip).
      const tripBusy = st.busy || !!(trip && (st.after[trip.seq]?.busy || st.after[trip.seq]?.loading));
      const againBtn = `<button type="button" class="small ghost at-web at-trip-again" data-act="trip-refresh" title="${TRIP_AGAIN_TITLE}" aria-label="${TRIP_AGAIN_TITLE}"${tripBusy ? ' disabled' : ''}>${CAR_AGAIN_ICON}</button>`;
      const tripLine = !isTrip(it) ? '' : off ? cancelLine(it, off) : `<div class="at-tripline"><span>${escapeHtml(
        trip ? `여비계산서 ${trip.seq} · ${stage.label}` : noTripNote(it))}</span>${againBtn}${preBtn}`
        + `<button type="button" class="small ghost at-web at-tripbtn ${icon.state}" data-act="trip" title="${TRIP_TITLE} — ${escapeHtml(icon.label)}" aria-label="${TRIP_TITLE} — ${escapeHtml(icon.label)}">${tripIcon(icon.digit)}</button></div>`;
      // 출장이면 사후정산 칸 아래에 여비증빙 송부 칸(sendbox.js)이 선다 — 정산이 끝난 뒤 증빙을 PDF 로 묶어 담당자에게 보낸다.
      const afterBox = isTrip(it) && !off ? afterHtml(it, trip, stage) + sendBox.html(sendCtx(it)) : '';
      const note = it.rejectNote ? `<span class="at-reject" title="반려 의견">반려 의견 · ${escapeHtml(it.rejectNote)}</span>` : '';
      // 신청서에 하는 일(변경·취소신청·HR 에서 열기)은 여비계산서 칸보다 위에 선다(2026-10-03 사용자 지정) — 맨 아래에 있으면
      // 사후정산·여비증빙 송부에 딸린 버튼으로 읽혀 헷갈렸다. 그 아래가 여비계산서(계산서 줄·사후정산·여비증빙 송부)다.
      return `<li data-i="${i}" class="open ${cls}">${head}`
        + `<div id="atMore_${i}" class="at-more-box">${note}`
        + `<div class="at-acts">${acts}</div>${cancelBox}${tripLine}${afterBox}</div></li>`;
    }).join('');
    // 펴 둔 웹페이지 목록의 "전체"가 반쯤 골라진 표시는 글로 그릴 수 없다 — 그린 뒤에 맞춘다.
    webPick.sync(el.list);
    ensureAfterDetail();
    ensureLodges();
    settleKnown();
    followSeek();
  }

  /**
   * 펴 둔 출장 카드에 "사후정산에 안 올림"으로 남은 증빙(todoOf)이 **이미 사후정산에 올라가 있는 숙박 줄의 것**이면 표시를 걷는다
   * (2026-10-05 사용자 지정: 올라가 있는 숙박 줄 아래의 올리기 버튼을 보고 "왜 여전히 이 버튼이 있는지 모르겠어. 이게 확인이 안되나?
   * 출장이랑 맞잖아") — 같은 증빙을 두 번 넣었을 때다. 사이트에는 아무것도 가지 않는다: 숙박비 내역이 읽어 둔 줄과 맞춰 볼 뿐이다
   * (src/after.js 의 lodgeKnown). 항공권이 섞여 있거나 화면에 없는 숙박 줄이 하나라도 있으면 건드리지 않는다(올리기 버튼이 남는다).
   */
  const knownSeen = new Map();   // 계산서 → 맞춰 본 것(증빙 이름 + 화면의 줄) — 같은 것을 그릴 때마다 다시 맞춰 보지 않는다
  function settleKnown() {
    const it = st.items.find((x) => x.docNo === st.openDoc);
    const trip = it && isTrip(it) ? tripOf(it) : null;
    const a = trip ? st.after[trip.seq] : null;
    const rows = trip ? lodgeBox.state.by[trip.seq]?.rows : null;
    const todo = todoOf(a);
    if (!a || a.busy || a.ask || !a.detail || !rows || !todo.length) return;
    const sig = `${todo.map((k) => k.name).join('|')}#${rows.map((r) => `${r.seq}:${r.total}`).join('|')}`;
    if (knownSeen.get(trip.seq) === sig) return;
    knownSeen.set(trip.seq, sig);
    if (todo.some((k) => !/^lodging_/.test(k.record.docType || ''))) return;
    const plan = afterPlan(todo.map((k) => ({ ...k.record, file: { name: k.name, type: k.type, dataUrl: '' } })),
      { trip, detail: a.detail, picks: st.legs[it.docNo] || {}, workplace: st.workplace });
    if (plan.problems.length || !plan.lodge.length || !plan.lodge.every((l) => lodgeKnown(l, rows))) return;
    const names = todo.map((k) => k.name);
    evidence.settle(it.docNo, names).then(() => loadKept(it.docNo, a)).then(() => {
      setStatus(`이미 사후정산에 올라가 있는 숙박 줄의 증빙입니다 — 다시 올리지 않습니다(${names.join(' · ')})`);
      paintList();
    }, () => {});
  }

  /** 홈 카드의 부탁(st.seek)을 얼마 동안 들어주는가 — 신청 내역(HR)과 여비계산서를 읽는 시간보다 넉넉하게. 지나면 잊는다. */
  const SEEK_TTL_MS = 30_000;

  /**
   * 홈의 WORKSPACE 카드에서 근태 줄을 눌러 왔다(2026-10-07 사용자 지정: "검진 카드를 누르면 검진 내역의 근태가 나와야지") — 신청 내역에서
   * 그 건의 카드를 펴고 보이게 한다. 출장 줄의 `보내기`에서 왔으면(send — 2026-10-04 사용자 지정) 여비증빙 송부 칸까지 가서, 보낼 수
   * 있으면 보낼 내용 팝업을 띄운다(카드의 `보내기`를 누른 것과 같다 — 팝업의 보내기를 눌러야 나간다).
   * 신청 내역 → 여비계산서 → 사전정산의 교통편·보관함이 읽히는 대로 여러 번 그려지므로, 그릴 때마다 이어 간다(followSeek).
   */
  function seek({ docNo, send = false } = {}) {
    st.seek = docNo ? { docNo: String(docNo), send: !!send, at: Date.now(), seen: false } : null;
    if (st.seek && st.loadedOnce) paintList();
  }

  /** 홈 카드의 부탁을 한 걸음 이어 간다 — 목록을 그릴 때마다 불린다. 끝났거나 할 수 없게 되면 부탁을 잊는다. */
  function followSeek() {
    const want = st.seek;
    if (!want || !st.loadedOnce) return undefined;
    const drop = (why = '') => { st.seek = null; if (why) setStatus(why, 'error'); };
    if (Date.now() - want.at > SEEK_TTL_MS) return drop();
    const wanted = (x) => x.docNo === want.docNo;
    let it = st.items.find(wanted);
    // 그 카드를 펴 둔 것으로 치는 줄 번호 — 지금 화면에 그려진 것과 다르면 아래에서 펴서 다시 그린다.
    const was = st.openDoc;
    if (!it && !st.range && st.all.some(wanted)) {
      // 정산이 끝나(증빙을 보냈거나 사후정산 완료) 기본 보기에서 빠진 다녀온 출장일 수 있다 — 펴 둔 줄은 남기는 규칙(keep)으로 다시 고른다.
      st.openDoc = want.docNo;
      pickItems();
      it = st.items.find(wanted);
      if (!it) st.openDoc = was;
    }
    if (!it) return drop(`홈 카드에서 고른 ${want.send ? '출장이' : '근태가'} 지금 보는 신청 내역에 없습니다 — 조회 기간을 넓혀 찾아 주세요.`);
    const shown = shownItems().includes(it);
    if (!shown && st.edit) return drop('신청서를 고치는 중이라 그 카드를 열지 못했습니다 — 고치기를 마친 뒤 종류 줄 끝의 "내역"에서 찾아 주세요.');
    if (!shown || was !== it.docNo) {
      // 그 카드를 편다. 다른 종류만 보는 중이라 가려져 있으면 모든 종류를 보는 "내역"으로 바꾼다(기억해 두지는 않는다).
      if (!shown) {
        st.view = 'all';
        paintKinds();
        paintForm();
      }
      disarm();
      Object.assign(st, { openDoc: it.docNo, cancelFor: null, cancelThen: null });
      return paintList();
    }
    if (!want.send || !isTrip(it)) {
      // 줄을 누르고 왔다 — 그 카드를 펴서 보이게 하면 끝이다. 머리에 초점을 줘 어느 카드인지 드러낸다.
      st.seek = null;
      const li = el.list.querySelector(`li[data-i="${shownItems().indexOf(it)}"]`);
      li?.scrollIntoView?.({ block: 'nearest' });
      li?.querySelector('.at-head')?.focus({ preventScroll: true });
      return undefined;
    }
    const trip = tripOf(it);
    // 여비계산서 목록을 아직 읽는 중이면 다음에 그릴 때 이어 간다. 다 읽었는데 계산서가 없으면 보낼 것이 없다 — 카드가 그렇게 말한다.
    if (!trip) return !st.trips || tripsBusy ? undefined : drop();
    const box = [...el.list.querySelectorAll('.at-send')].find((n) => n.dataset.doc === it.docNo);
    if (!box) return undefined;
    if (!want.seen) {
      want.seen = true;
      box.scrollIntoView?.({ block: 'nearest' });
    }
    // 사전정산의 교통편과 보관함을 읽는 중이면 다 읽힌 뒤에 본다 — 그 전에는 보낼 수 있는지 모른다.
    const a = st.after[trip.seq];
    if (!a || a.loading || (!a.detail && !a.detailError)) return undefined;
    st.seek = null;
    const go = box.querySelector('button[data-act="send-go"]');
    if (want.send && go && !go.disabled) return sendBox.click(go, sendCtx(it));
    // 아직 보낼 수 없다 — 까닭은 송부 칸이 말한다. 채울 칸(과제·계정, 받는 사람)이 비어 있으면 그리로 초점을 준다.
    const empty = [...box.querySelectorAll('input[data-send="account"], input[data-send="person"]')].find((n) => !n.disabled && !n.value.trim());
    (empty || go)?.focus();
    return undefined;
  }

  /** 출장 신청서인가(여비계산서가 따르는 것). */
  const isTrip = (it) => it.formId === 'TR';
  /** 취소신청을 올려 둔 건인가 — 상태가 "취소 중"이고, 출장이면 여비계산서 칸을 걷는다(2026-10-07 사용자 지정). */
  const cancelState = (it) => cancellingOf(st.all, st.cancelKept).get(it.docNo) || '';
  const isCancelling = (it) => !!cancelState(it);
  /** 올려 두었거나 결재가 끝난 신청서인가(신청·승인). 임시저장·반려·회수는 아니다. */
  const isLive = (it) => it.status === STATUS.WAIT || it.status === STATUS.REQUESTED || it.status === STATUS.APPROVED;
  /**
   * 같은 기간의 올려 둔 신청서에 가려진 줄인가 — 계산서는 기간과 출장자로 찾으므로(tripDocFor), 같은 기간에 올려 둔(신청·승인) 출장
   * 신청서가 따로 있으면 임시저장·반려·회수한 신청서에도 같은 계산서가 걸린다. 그 계산서는 올려 둔 신청서의 것으로 본다.
   */
  const shadowed = (it) => !isLive(it)
    && st.all.some((x) => x.docNo !== it.docNo && isTrip(x) && isLive(x) && x.from === it.from && (x.to || x.from) === (it.to || it.from));
  /**
   * 그 출장의 여비계산서(기간과 출장자가 같은 것). 출장이 아니거나 아직 못 읽었으면 null. 가려진 줄(shadowed)도 null 이다 —
   * 딱지·편 카드·버튼이 같은 판단을 쓴다(계산서와 사후정산·여비증빙 송부는 올려 둔 신청서의 줄에서 한다).
   */
  const tripOf = (it) => (isTrip(it) && st.trips?.rows && !shadowed(it) && !isCancelling(it) ? tripDocFor(it, st.trips.rows, st.trips.me) : null);
  /**
   * 그 출장에 여비계산서가 없다고 말해도 되는가 — 계산서 목록을 그 출장기간까지 다 읽었을 때만이다. 읽어 둔 기간 밖이거나(기간을 바꿔
   * 다시 읽는 중) 목록이 여러 쪽이면(첫 쪽만 읽는다 — src/trip.js 의 tripList) 없는 것이 아니라 모르는 것이다.
   */
  const tripsCover = (it) => !!st.trips?.rows && !(st.trips.pages > 1) && st.trips.from <= it.from && (it.to || it.from) <= st.trips.to;

  /**
   * 출장 줄 오른쪽의 정산 상태 딱지(2026-10-04 사용자 지정) — 정산전 · 사전정산 중 · 사전정산 완료 · 사후정산전 · 사후정산 중 · 정산완료.
   * 붙이지 않는 때: 계산서를 못 찾았는데 없는지 모를 때(목록을 못 읽었거나 다 읽지 못했다 — 모르는 것을 정산전이라고 하지 않는다),
   * 반려·회수한 신청서에 계산서가 없을 때, 같은 기간의 올려 둔 신청서에 가려진 줄일 때(shadowed).
   */
  function settleChip(it, trip, stage, today) {
    if (!isTrip(it) || shadowed(it) || isCancelling(it)) return '';
    if (!stage && (!tripsCover(it) || it.status === STATUS.REJECTED || it.status === STATUS.RECALLED)) return '';
    return `<span class="at-trip" title="${trip ? `여비계산서 ${escapeHtml(trip.seq)}` : '여비계산서 없음'}">`
      + `${escapeHtml(settleLabel(stage, { past: isPast(it, today) }))}</span>`;
  }

  /** 취소가 걸린 출장의 여비계산서(남아 있으면). 취소된 줄에서는 tripOf 가 null 이라 따로 찾는다. */
  const leftTrip = (it) => (st.trips?.rows ? tripDocFor(it, st.trips.rows, st.trips.me) : null);

  /**
   * 취소가 걸린 출장 줄을 폈을 때 여비계산서 자리에 서는 한 줄. 계산서는 패널이 취소신청을 올릴 때 지운다 — HR 에서 취소했거나
   * 지우지 못해 남아 있으면 `여비계산서 지우기`가 선다(두 번 눌러야 나간다 — 2026-10-07 사용자 지정: "이미 취소가 되었는데 이 확장자는
   * 취소 처리가 안됨 ... 처리해줘").
   */
  function cancelLine(it, off) {
    const head = off === 'done' ? '취소신청 결재완료' : '취소신청 결재 대기';
    const left = leftTrip(it);
    const text = left ? `${head} — 여비계산서 ${left.seq}(${tripStage(left, st.trips.me).label})이 남아 있습니다`
      : !st.trips ? `${head} — 여비계산서 확인 중...`
        : st.trips.error ? `${head} — 여비계산서를 읽지 못했습니다: ${st.trips.error}`
          : `${head} — 여비계산서 없음`;
    const drop = left ? `<button type="button" class="small at-warn" data-act="trip-drop"${st.busy ? ' disabled' : ''}>여비계산서 지우기</button>` : '';
    return `<div class="at-tripline at-cancelnote"><span>${escapeHtml(text)}</span>${drop}</div>`;
  }

  /** 취소가 걸린 출장의 남은 여비계산서를 지운다(cancelLine 의 버튼). */
  async function dropTrip(it) {
    const row = leftTrip(it);
    if (!row) return;
    setBusy(true);
    try {
      await tripDelete(row, { name: st.trips.me, onStage: setStatus });
      logEvent('trip', true, `여비계산서 삭제(출장 취소): ${row.seq} · ${it.summary}`, { seq: row.seq, docNo: it.docNo });
      await loadTrips();
      setStatus(`여비계산서 ${row.seq} 을(를) 지웠습니다 — ${it.summary}`);
    } catch (err) {
      setError(err, '여비계산서를 지우지 못했습니다');
      logEvent('trip', false, `여비계산서 삭제 실패(출장 취소): ${it.summary} — ${err.message}`, { docNo: it.docNo });
    } finally {
      setBusy(false);
      paintList();
    }
  }

  const cancelTried = new Set();   // 이번에 내용을 읽어 본 취소신청서 — 원 문서를 못 찾았어도 다시 읽지 않는다

  /**
   * HR 목록의 취소신청서가 어느 원 문서를 무르는지 읽어 기록에 잇는다(src/hr.js 의 hrCancelRefs). 이미 이은 것과 반려·회수한 것은
   * 읽지 않는다. HR 에서 직접 올린 취소신청도 이것으로 잡힌다. 던지지 않는다 — 못 읽으면 그 줄은 전처럼 보인다.
   */
  async function linkCancels() {
    const linked = new Set(Object.values(st.cancelKept).map((v) => v?.cancelDocNo).filter(Boolean));
    const live = new Set([STATUS.WAIT, STATUS.REQUESTED, STATUS.APPROVED]);
    const todo = st.all.filter((c) => isCancelDoc(c) && live.has(c.status) && !linked.has(c.docNo) && !cancelTried.has(c.docNo));
    let changed = false;
    for (const c of todo) {
      cancelTried.add(c.docNo);
      try {
        const befs = (await hrCancelRefs(c)).filter((no) => st.all.some((x) => x.docNo === no));
        if (!befs.length) continue;
        st.cancelKept = linkCancel(st.cancelKept, c.docNo, befs);
        changed = true;
      } catch { /* 못 읽으면 그대로 둔다 */ }
    }
    if (!changed) return;
    chrome.storage.local.set({ [CANCELLING_KEY]: st.cancelKept });
    pruneSettled();
    paintList();
  }

  /** 계산서가 걸리지 않은 출장 줄을 폈을 때 적는 말 — 없는 것, 모르는 것, 다른 줄에 있는 것을 가려 말한다. */
  function noTripNote(it) {
    if (shadowed(it)) return '같은 기간에 올려 둔 출장 신청서가 있습니다 — 여비계산서는 그 줄에서 봅니다';
    if (st.trips?.error) return `여비계산서를 읽지 못했습니다: ${st.trips.error}`;
    if (!st.trips) return '여비계산서 확인 중...';
    if (tripsCover(it)) return '여비계산서 없음';
    if (tripsBusy) return '여비계산서 확인 중...';
    return st.trips.pages > 1 ? '여비계산서를 찾지 못했습니다 — 계산서 목록이 여러 쪽이라 첫 쪽만 읽었습니다'
      : '여비계산서를 찾지 못했습니다 — 조회 기간이 이 출장기간을 다 덮지 않습니다';
  }

  let tripsAsk = 0;        // 여비계산서 목록을 읽기 시작한 차례 — 가장 나중에 시작한 읽기의 답만 받는다
  let tripsBusy = false;   // 답을 기다리는 읽기가 있는가

  /**
   * 여비계산서 목록을 읽어 둔다(보이는 기간의 출장기간 기준). 던지지 않는다 — 못 읽으면 까닭을 담아 두고,
   * 출장 줄이 그 말을 한다. 근태 목록과 따로 돌아서 근태가 먼저 보인다.
   */
  async function loadTrips() {
    const ask = ++tripsAsk;
    tripsBusy = true;
    const { from, to } = tripRange();
    let next;
    try {
      const r = await tripList({ from, to });
      // 읽은 기간과 쪽 수를 같이 담는다 — 계산서가 "없다"고 말해도 되는지(tripsCover) 가릴 때 쓴다.
      next = { rows: r.rows, me: r.me, from, to, pages: r.pages };
    } catch (err) {
      next = { error: err.message };
    }
    // 그 사이에 다시 읽기 시작했으면 이 답은 버린다 — 늦게 온 예전 답(다른 기간의 목록, 실패)이 새 답을 덮지 않게.
    if (ask !== tripsAsk) return;
    tripsBusy = false;
    st.trips = next;
    if (next.rows) {
      // 홈의 WORKSPACE 카드가 같은 단계를 보게 담아 둔다. 못 담아도 목록은 그대로다. 목록이 여러 쪽이면 첫 쪽만 읽은 것이라
      // 담지 않는다 — 반쪽짜리 목록을 "다 읽은 것"으로 두면 홈이 있는 계산서를 없다고 본다.
      if (!(next.pages > 1)) noteStages({ rows: next.rows, me: next.me, from, to }).catch(() => {});
      // 사후정산이 완료된 것으로 드러난 다녀온 출장은 기본 보기에서 뺀다.
      pruneSettled();
    }
    paintList();
  }

  /**
   * 저장·확정을 보낸 뒤 그 계산서 줄만 갈아 끼운다 — row 는 src/trip.js 가 성공을 판정하느라 이미 다시 읽은 줄이다. 목록 화면(Home/List)은
   * 한 번 읽는 데 1초쯤 걸려서(2026-10-05 실제 요청으로 잰 값 0.94초) 같은 것을 곧바로 또 읽지 않는다(사용자 지정: 저장 직후 목록은 한 번만).
   * 갈아 끼울 수 없으면 — 그 줄을 못 받았다, 담아 둔 목록이 없거나 그 계산서가 거기에 없다, 다른 읽기가 돌고 있다(늦게 온 그 답이
   * 이 줄을 덮는다) — 전처럼 목록을 다시 읽는다.
   */
  async function freshTrip(row) {
    const at = row && !tripsBusy && st.trips?.rows ? st.trips.rows.findIndex((r) => r.seq === row.seq) : -1;
    if (at < 0) return loadTrips();
    st.trips = { ...st.trips, rows: st.trips.rows.map((r, i) => (i === at ? row : r)) };
    // 홈의 WORKSPACE 카드가 같은 단계를 보게 그 계산서만 덧댄다(loadTrips 와 같다 — 일부만 읽은 것으로 적힌다).
    noteStages({ rows: [row], me: st.trips.me, from: row.from, to: row.to }).catch(() => {});
    pruneSettled();
    paintList();
  }

  /**
   * 출장 줄의 ↻ — 그 출장의 여비계산서를 다시 읽는다(2026-10-05 사용자 지정: 카드가 여비계산서에 저장된 값을 보이므로 사이트에서 고친 것을
   * 가져올 길이 있어야 한다). 목록(단계), 사전정산의 교통편·일비·식비, 사후정산의 숙박·교통 줄을 다시 읽어 카드를 다시 그린다. 읽기만 한다.
   * 카드에서 고쳐 두고 아직 저장하지 않은 것(다시 작성하는 칸의 교통편·일자·시각·식수)은 그대로 둔다 — 새로 읽은 값 위에 얹힌다.
   * 계산서가 아직 없는 출장이면 목록만 다시 읽는다(사이트에서 방금 만든 계산서를 찾는다).
   */
  async function refreshTrip(it) {
    disarm();
    const trip = tripOf(it);
    if (!trip) {
      setStatus('여비계산서 목록을 다시 읽는 중...');
      await loadTrips();
      return setStatus(st.trips?.error ? `여비계산서 목록을 읽지 못했습니다: ${st.trips.error}` : '여비계산서 목록을 다시 읽었습니다', st.trips?.error ? 'error' : undefined);
    }
    const a = st.after[trip.seq] || (st.after[trip.seq] = {});
    if (a.busy || a.loading) return undefined;
    Object.assign(a, { loading: true, detailError: '' });
    setStatus(`여비계산서 ${trip.seq} 을(를) 다시 읽는 중...`);
    paintList();
    try {
      const [detail] = await Promise.all([tripPreDetail(trip.seq), loadTrips()]);
      a.detail = detail;
      keepTripRoute(trip.location, routeOfRows(detail.rows, trip));
      // 숙박·교통 줄(사후정산 입력 화면)은 그 화면이 있는 단계에서만 읽는다 — 단계는 방금 다시 읽은 목록의 것이다.
      const now = tripOf(it) || trip;
      const stage = tripStage(now, st.trips?.me);
      if (stage.phase === 'post' || (stage.done && afterNeed(now).lodging)) await lodgeBox.reload(lodgeCtx(now), { quiet: true });
      setStatus(`여비계산서 ${trip.seq} 을(를) 다시 읽었습니다 — ${stage.label}`);
    } catch (err) {
      // 못 읽었으면 전에 읽어 둔 값을 그대로 둔다.
      setError(err, '여비계산서를 다시 읽지 못했습니다');
    } finally {
      a.loading = false;
      paintList();
    }
    return undefined;
  }

  /* ---------------------------------------------------------------- 사후정산 */

  /** 그 계산서에서 내 출장자 번호. 이름이 맞는 출장자가 없으면 첫 사람이다. */
  const trseqOf = (row) => (row.travelers.find((t) => t.name === st.trips?.me) || row.travelers[0])?.trseq || '';

  /**
   * 숙박비 내역(lodgebox.js)에 넘길 그 계산서의 사정 — 출장자 번호, 보관함의 증빙, 이 패널이 올린 줄의 표시(st.lodgeMine).
   * locked 는 카드가 다른 일을 하는 중인가, lodging 은 숙박이 있는 출장인가, readonly 는 보여 주기만 하는가(사후정산 완료)다.
   */
  const lodgeCtx = (trip, { locked = false, lodging = false, readonly = false } = {}) => ({
    trip, trseq: trseqOf(trip), kept: st.after[trip.seq]?.kept || [], mine: st.lodgeMine?.[trip.seq], locked, lodging, readonly,
    // 줄의 `증빙`·`손수 작성`을 누르면 그 줄 아래에 펴지는 내용(lodgeInfoHtml). `상한`으로 정산금액을 바꾸면 그 내용의 금액도 맞춘다(patchLodgeInfo).
    open: st.lodgeOpen[trip.seq] || '', detail: (row, source) => lodgeInfoHtml(trip.seq, row, source), changed: (lodgeSeq, l) => patchLodgeInfo(trip.seq, lodgeSeq, l),
  });

  /** 열어 둔 출장 카드의 숙박 줄을 한 번 읽어 둔다 — 사후정산을 쓰는 단계이거나 완료한 뒤다(그 전에는 입력 화면이 없다). */
  function ensureLodges() {
    const it = st.items.find((x) => x.docNo === st.openDoc);
    const trip = it ? tripOf(it) : null;
    const stage = trip ? tripStage(trip, st.trips.me) : null;
    // 사후정산을 쓰는 중이거나, 숙박이 있는 출장이 사후정산 "대기"(사전정산은 완료, 아직 한 줄도 안 올린 때)일 때다 — 그때도 카드가
    // 숙박비 내역을 보이므로 읽지 않으면 "읽는 중..."이 그대로 남는다. 당일 출장의 대기 단계는 보일 것이 없어 읽지 않는다.
    const writing = stage?.phase === 'post' && !stage.done;
    const waiting = stage?.phase === 'pre' && stage.done && afterNeed(trip).lodging;
    // 사후정산이 완료된 출장은 정산 내역을 보여 주기만 한다(doneHtml) — 숙박 줄과, 사후정산에 따로 올린 교통 줄을 읽는다.
    const done = stage?.phase === 'post' && stage.done;
    if (writing || waiting || done) lodgeBox.ensure(lodgeCtx(trip));
  }

  /**
   * 그 출장 카드의 가는 편·오는 편 — 사전정산의 교통편 줄에, 카드에서 고른 것과 넣은 항공권을 얹은 것이다(src/travel.js 의 legPlan).
   * 사전정산을 아직 못 읽었으면 null.
   */
  function legsOf(it, trip) {
    const a = st.after[trip.seq];
    return a?.detail ? legPlan({ trip, picks: st.legs[it.docNo] || {}, rows: a.detail.rows, seats: a.seats || {}, workplace: st.workplace }) : null;
  }

  /**
   * 가는 편·오는 편 두 줄(2026-10-03 사용자 지정) — 편 이름, 교통편 아이콘 셋(고른 것은 아이콘이 파란색, 기차·비행기 특실은 주황색 +),
   * 그 편으로 올라갈 값. 처음에는 사전정산대로 골라져 있고, 사전정산에 없는 편은 아무것도 골라져 있지 않다.
   * enabled 가 아니면(사후정산을 올릴 때가 아니다) 보여 주기만 한다. none 은 줄이 없는 편에 적는 말이다.
   * 사전정산을 다시 작성하는 칸(preRedoHtml)도 이 모양을 쓴다 — 누름의 이름(act)과 한 번 더 누르면 특실이 되는 교통편(graded)만 다르다.
   *
   * **저장된 값이 다른 편에는 `다름` 표시가 선다**(2026-10-05 사용자 지정: "저장된 값이 다르면 다른 부분을 확인할 수 있도록") — 사이트에 저장된
   * 줄의 일자·시각·요금·등급이 출장 일정·운임표와 다른 곳의 수이고(src/travel.js 의 legDiffs), 누르면 그 편 아래에 항목마다 저장된 값과
   * 견준 값이 펴진다. 보기만 한다 — 사이트에는 아무것도 가지 않는다. check 는 그 계산서의 번호와 출장의 출발·도착 시다(없으면 견주지 않는다).
   *
   * **편의 날짜와 시각은 여비계산서에 저장된 값이다**(2026-10-05 사용자 지정: "여비계산서 상의 값을 기본적으로 갖어오도록 해줘, 갖어온
   * 상태에서 수정을 할 수 있게") — 이름 옆의 날짜는 그 줄의 일자이고(출장 일정의 날이 아니다), 줄 끝에 출발 시→도착 시가 적힌다(둘 다 0 이면
   * `시각 없음`). 사전정산을 다시 작성하는 칸(edit)에서는 그 값이 든 일자·출발·도착 칸이 서서 고칠 수 있고(pickPreEdit), 펴 둔 `다름`의
   * 일자·시각 줄에는 견준 값으로 고치는 `이 값으로`가 붙는다. 고친 것은 `사전정산 다시 저장`을 눌렀을 때 사이트에 간다.
   */
  function legsHtml(route, enabled, none = '고르지 않음', { act = 'leg', graded = LEG_GRADED, check = null, edit = false } = {}) {
    if (!route) return '';
    return `<div class="at-legs">${route.legs.map((l) => {
      // 여비계산서에 선(다시 작성하는 칸에서는 설) 일자·출발 시·도착 시 — 저장된 줄 그대로인 편은 그 줄의 값이다.
      const w = l.when || (l.source === 'site' ? legWhen(l.site) : null);
      const day = [w?.date, l.row?.date, l.date].find((d) => DAY_RE.test(d || ''));
      const diffs = check ? legDiffs(l, check.when) : [];
      const open = diffs.length > 0 && st.legDiff[check.seq] === l.key;
      const mark = diffs.length ? `<button type="button" class="at-leg-diff" data-act="leg-diff" data-leg="${l.key}" aria-expanded="${open}" `
        + `title="${DIFF_TITLE}" aria-label="${l.label} — 저장된 값이 다른 곳 ${diffs.length}곳">다름 ${diffs.length}</button>` : '';
      // 다시 작성하는 칸에서는 일자·시각 줄을 견준 값으로 고칠 수 있다 — 이미 그 값으로 고쳐 두었으면 그렇다고 적는다.
      const fixed = (d) => Object.entries(d.fix).every(([k, v]) => w?.[k] === v);
      const fix = (d) => (!edit || !d.fix ? '' : fixed(d) ? '<span class="at-diff-done">고쳐 둠</span>'
        : `<button type="button" class="small ghost at-diff-fix" data-act="leg-fix" data-leg="${l.key}" data-k="${d.key}" title="${FIX_TITLE}"${enabled ? '' : ' disabled'}>이 값으로</button>`);
      const detail = open ? `<ul class="at-leg-diffs" aria-label="${l.label} — 저장된 값이 다른 곳">${diffs.map((d) =>
        `<li><span class="at-diff-k">${escapeHtml(d.label)}</span><span class="at-diff-v">${escapeHtml(`저장된 값 ${d.saved}`)}</span>`
        + `<span class="at-diff-w">${escapeHtml(`${d.by} ${d.want}`)}${fix(d)}</span></li>`).join('')}</ul>` : '';
      // 시각 — 보기만 하는 칸에서는 글(7시→11시 · 시각 없음), 다시 작성하는 칸에서는 고치는 칸이다.
      const time = !w || edit ? '' : `<span class="at-leg-time${w.shr || w.ehr ? '' : ' none'}" title="여비계산서에 적힌 출발 시 → 도착 시">${escapeHtml(whenText(w))}</span>`;
      const hours = (f, name) => `<label>${name}<select data-edit="${f}" data-leg="${l.key}" aria-label="${l.label} ${name} 시"${enabled ? '' : ' disabled'}>`
        + `${HOURS.map((h) => `<option value="${h}"${h === w[f] ? ' selected' : ''}>${h ? `${h}시` : '없음'}</option>`).join('')}</select></label>`;
      const fields = !edit || !w ? '' : `<span class="at-leg-edit${l.edited ? ' new' : ''}"><label>일자<input type="date" data-edit="date" data-leg="${l.key}" `
        + `value="${escapeHtml(w.date)}" aria-label="${l.label} 일자"${enabled ? '' : ' disabled'} /></label>${hours('shr', '출발')}${hours('ehr', '도착')}</span>`;
      const icons = TRANSPORTS.map((o) => transportButton(o, {
        on: l.pick?.t === o.value, first: l.pick?.g === 'first', disabled: !enabled, graded,
        attrs: `data-act="${act}" data-leg="${l.key}" data-t="${escapeHtml(o.value)}"`,
      })).join('');
      // 사전정산과 다르게 고른 편은 "바꿈"이라고 적는다 — 사후정산을 올리기 전에는 패널만 아는 값이다.
      // 줄을 넣지 않는 편(사전정산을 다시 작성할 때의 비행기·버스)은 그 말(l.blank)을 적는다.
      const what = l.problem || (l.row ? `${describeTrans(l.row)}${l.source === 'site' ? '' : ' · 바꿈'}` : l.blank || none);
      return `<div class="at-leg"><span class="at-leg-name">${l.label} <span class="at-leg-day">${md(day)}</span></span>`
        + `<span class="at-chips" role="group" aria-label="${l.label} 교통편">${icons}</span>`
        + `<span class="at-leg-what${l.problem ? ' error' : l.row && l.source !== 'site' ? ' new' : ''}">${escapeHtml(what)}</span>${time}${mark}${fields}${detail}</div>`;
    }).join('')}</div>`;
  }

  /** 편의 출발 시→도착 시를 글로 — "7시→11시", 한쪽만 적혀 있으면 "7시→?", 둘 다 없으면(0) "시각 없음". */
  const whenText = (w) => (w.shr || w.ehr ? `${w.shr ? `${w.shr}시` : '?'}→${w.ehr ? `${w.ehr}시` : '?'}` : '시각 없음');

  /** 편의 저장된 값을 견줄 때 쓰는 그 출장의 사정(legsHtml 의 check) — 계산서 번호와 사전정산에서 읽은 출장의 출발·도착 시. */
  const diffCheck = (trip, a) => ({ seq: trip.seq, when: { sHour: a.detail?.sHour ?? null, eHour: a.detail?.eHour ?? null } });

  /** 가는 편·오는 편에서 고른 것을 담고 저장한다 — 패널을 다시 열어도 남는다. 고른 것이 없으면 지운다. */
  function setLegs(docNo, picks) {
    if (picks?.go || picks?.back) st.legs[docNo] = picks;
    else delete st.legs[docNo];
    chrome.storage.local.set({ attendLegs: st.legs });
  }

  /** 가는 편·오는 편의 교통편 아이콘을 눌렀을 때. 기차·비행기는 한 번 더 누르면 특실이 된다. 사후정산에는 올릴 때 들어간다. */
  function pickLeg(it, leg, value) {
    const trip = tripOf(it);
    const route = trip && legsOf(it, trip);
    if (!route) return;
    disarm();
    setLegs(it.docNo, { ...st.legs[it.docNo], [leg]: nextLegPick(route.legs.find((l) => l.key === leg)?.pick, value) });
    paintList();
    el.list.querySelector(`button[data-act="leg"][data-leg="${leg}"][data-t="${value}"]`)?.focus();
  }

  /**
   * 열린 출장 카드의 사후정산 칸(2026-10-03 사용자 지정) — 가는 편·오는 편과 증빙 칸이다. 증빙은 받는 즉시 읽어서 올린다.
   *
   * 사전정산을 아직 완료(확정)하지 않았으면 칸의 이름이 "사전정산"이고 `사전정산 완료` 버튼이 선다 — 사후정산을 올리거나 증빙을
   * 담당자에게 보내려면 완료돼 있어야 하기 때문이다. 그때도 증빙은 받는다(넣으면 확정부터 하고 이어서 처리한다 — runAfter).
   * 가는 편·오는 편은 사전정산이 완료된 뒤에 바꾼다(그 전에는 보여 주기만 한다).
   * 사후정산까지 완료된 출장은 같은 자리에 정산 내역을 보여 주기만 한다(doneHtml) — 여비증빙 송부 칸 아래의 `사후정산 다시하기`를 누르면(a.reopen,
   * 2026-10-04 사용자 지정: "보내고 나서.. 증빙을 추가하거나 하면 사후 저장 후 다시 정산작성할 수 있어야 함") 완료하기 전과 같은
   * 칸이 다시 선다. 누르는 것만으로는 사이트에 아무것도 가지 않는다 — 증빙을 넣거나 저장·보내기를 눌렀을 때 간다.
   */
  function afterHtml(it, trip, stage) {
    if (!trip || !stage) return '';
    const a = st.after[trip.seq] || {};
    if (!a.detail) {
      return `<div class="at-after"><p class="at-after-note${a.detailError ? ' error' : ''}">${escapeHtml(
        a.detailError ? `사전정산의 교통편을 읽지 못했습니다: ${a.detailError}` : '사전정산의 교통편을 확인하는 중...')}</p></div>`;
    }
    const locked = !!a.busy || st.busy;
    // 사전정산을 다시 작성하는 중이면(여비증빙 송부 칸 아래의 `사전정산 다시하기`) 이 자리에 그 칸이 선다.
    if (a.redoPre) return preRedoHtml(it, trip, a, locked);
    const again = stage.phase === 'post' && stage.done;
    if (again && !a.reopen) return doneHtml(trip, a);
    const route = legsOf(it, trip);
    const pre = stage.phase === 'pre' && !stage.done;
    const need = afterNeed(trip, a.detail, st.legs[it.docNo]);
    const openTitle = '사후정산 입력 화면을 eclass 에서 열기';
    // 사전정산 완료(확정)는 계산서의 단계를 바꾸는 일이라 두 번 눌러야 나간다(사이트도 "확정하시겠습니까?" 를 묻는다).
    const doneTitle = '사전정산을 완료(확정)합니다 — 계산서 화면의 확정 버튼과 같습니다. 사후정산을 올리거나 증빙을 보내려면 완료돼 있어야 합니다';
    const head = pre
      ? `<strong>사전정산</strong><span class="at-after-why">${escapeHtml(`작성 중 · ${need.why}`)}</span>`
        + `<button type="button" class="small at-request at-pre-done" data-act="pre-done" title="${doneTitle}"${locked ? ' disabled' : ''}>사전정산 완료</button>`
      : `<strong>사후정산</strong><span class="at-after-why">${escapeHtml(again ? `${need.why} · 다시 작성 중` : need.why)}</span>`
        // 완료한 사후정산을 다시 작성하는 중이면 그만둘 수 있다 — 사이트의 단계가 아직 완료일 때만이다(저장해서 "작성"이 되면 이 버튼은 없다).
        + (again ? `<button type="button" class="small ghost at-reopen" data-act="after-reopen" title="${REOPEN_STOP}"${locked ? ' disabled' : ''}>그만두기</button>` : '')
        + `<button type="button" class="small ghost at-web" data-act="after" title="${openTitle}" aria-label="${openTitle}">${WEB_ICON}</button>`;
    // 증빙 없이 편만 바꿨을 때 올리는 버튼. 올릴 값이 있는 편이 하나라도 있어야 한다. 두 번 눌러야 나간다.
    const goTitle = '바꾼 가는 편·오는 편을 사후정산의 교통비 내역으로 올립니다';
    const go = !pre && need.needed && route.changed && route.legs.some((l) => l.pick?.t && l.row)
      ? `<div class="at-leg-go"><button type="button" class="small at-request" data-act="legs-go" title="${goTitle}"${locked ? ' disabled' : ''}>바꾼 교통편을 사후정산에 올리기</button></div>` : '';
    const then = pre ? '사전정산을 완료(확정)하고 ' : '';
    const ask = need.needed
      ? `${need.hint}을 넣으면 읽어서 ${then}사후정산을 올립니다`
      : `당일 출장이고 비행기를 타지 않아 사후정산 대상이 아닙니다 — 출장지에서 결제한 영수증(당일출장 증명)을 넣으면 ${then}보관하고, 비행기를 탔으면 항공권을 넣으세요`;
    return `<div class="at-after" data-seq="${escapeHtml(trip.seq)}"><div class="at-after-head">${head}</div>`
      + legsHtml(route, !pre && !locked, undefined, { check: diffCheck(trip, a) }) + go
      + stayHtml(trip, locked)
      + (pre ? '' : lodgeBox.html(lodgeCtx(trip, { locked, lodging: need.lodging })))
      + (pre ? '<p class="at-after-note">사후정산을 올리거나 증빙을 보내려면 사전정산이 완료(확정)돼 있어야 합니다 — 버튼을 누르거나 증빙을 넣으면 확정합니다.</p>' : '')
      + `<label class="at-after-drop${a.busy ? ' busy' : ''}" title="${DROP_TITLE}"><input type="file" multiple accept="${EVIDENCE_ACCEPT}"${a.busy ? ' disabled' : ''} aria-label="사후정산 증빙" />`
      // 넣는 곳이 안내문처럼 보이지 않게 아이콘과 이름을 세운다(2026-10-03 사용자 지정 — 어디에 놓고 붙여 넣는지 보이지 않았다).
      // 높이는 절반으로 줄였다(같은 날 사용자 지정) — 이름 옆에 넣는 길을 한 줄로 적고, 자세한 말은 풍선말(DROP_TITLE)로 옮겼다.
      + `<span class="at-drop"><span class="at-drop-top"><span class="at-drop-lead">${DROP_ICON}증빙 넣는 곳</span>`
      + '<span class="at-drop-how">끌어다 놓기 · 눌러 고르기 · Ctrl+V</span></span>'
      + `<span class="at-file">${escapeHtml(ask)}</span></span></label>`
      + capHtml(it.docNo, 'after', locked)
      + askHtml(a)
      + (a.busy ? `<p class="at-after-note">${escapeHtml(a.stage || '증빙을 읽는 중...')}</p>` : '')
      + (a.error ? `<p class="at-after-note error">${escapeHtml(a.error)}</p>` : '')
      // 방금 넣은 증빙 가운데 출장 기간과 안 맞는 것이 있었다는 알림 — 그 증빙이 보관함에 알림 표시로 남아 있는 동안 보인다.
      + (a.warn && a.kept?.some((k) => k.warn) ? `<p class="at-after-note error at-after-warn">${escapeHtml(a.warn)}</p>` : '')
      + (a.info ? `<p class="at-after-note">${escapeHtml(a.info)}</p>` : '')
      + (a.result ? afterResultHtml(a.result) : '')
      + keptHtml(a, locked)
      + '</div>';
  }

  /**
   * 사후정산이 완료된 출장의 정산 내역(2026-10-04 사용자 지정 — 완료된 출장을 펴도 표가 보여야 한다). 가는 편·오는 편과 숙박비 내역을
   * 보여 주기만 한다. 편은 사후정산에 따로 올린 교통 줄이 있으면 그 줄이고, 없으면 사전정산의 줄이다(그 값이 선다) — 카드에서 골라 둔
   * 편(st.legs)은 얹지 않는다. 계산서에 실제로 있는 줄만 적는다.
   * 증빙 넣는 곳은 없다 — 완료된 출장에 넣는 증빙은 아래 여비증빙 송부 칸이 받고, 붙여넣기(Ctrl+V)와 끌어다 놓기도 같은 길로 간다
   * (runAfter 의 amend — 읽어서 숙박 증빙·항공권이면 사후정산에 다시 올린다, 2026-10-05 사용자 지정). 그 길이 읽는 동안의 글과
   * 그 결과(무엇을 담았는지·안 맞는 증빙의 알림)는 이 칸 아래에 적힌다.
   * 여비증빙 송부 칸 아래의 `사후정산 다시하기`를 누르면 완료하기 전의 사후정산 칸으로 바뀐다(afterHtml 의 a.reopen) — 처음에는 이 칸
   * 머리의 `다시 작성`이었는데 송부 칸 아래로 옮겼다(2026-10-05 사용자 지정: "여기에서 사후정산 다시하기, 사전정산 다시하기 …").
   * 편 아래에는 사전정산의 일비·식비 한 줄이 선다(stayHtml) — 이 줄의 식수만은 여기서도 − + 로 고칠 수 있고, 누르면 사전정산을 다시
   * 작성하는 칸으로 바뀐다(2026-10-05 사용자 지정).
   */
  function doneHtml(trip, a) {
    const post = lodgeBox.state.by[trip.seq]?.trans || [];
    const rows = post.length ? post : a.detail.rows;
    const need = afterNeed(trip, { transports: rows.map((r) => r.transport) });
    return `<div class="at-after" data-seq="${escapeHtml(trip.seq)}"><div class="at-after-head"><strong>정산 내역</strong><span class="at-after-why">${escapeHtml(`${need.why} · 완료`)}</span></div>`
      + legsHtml(legPlan({ trip, rows }), false, post.length ? '사후정산에 없음' : '사전정산에 없음', { check: diffCheck(trip, a) })
      + stayHtml(trip, !!a.busy || st.busy)
      + lodgeBox.html(lodgeCtx(trip, { lodging: need.lodging, readonly: true }))
      + (a.busy ? `<p class="at-after-note">${escapeHtml(a.stage || '증빙을 읽는 중...')}</p>` : '')
      + (a.error ? `<p class="at-after-note error">${escapeHtml(a.error)}</p>` : '')
      + (a.warn && a.kept?.some((k) => k.warn) ? `<p class="at-after-note error at-after-warn">${escapeHtml(a.warn)}</p>` : '')
      + (a.info ? `<p class="at-after-note">${escapeHtml(a.info)}</p>` : '')
      + '</div>';
  }

  /**
   * 사전정산을 다시 작성할 때의 가는 편·오는 편(src/travel.js 의 prePlan) — 사전정산의 지금 줄에 카드에서 다시 고른 것을 얹는다.
   * 사전정산을 아직 못 읽었으면 null.
   */
  function prePlanOf(trip) {
    const a = st.after[trip.seq];
    return a?.detail ? prePlan({ trip, picks: a.prePicks || {}, rows: a.detail.rows, workplace: st.workplace, sHour: a.detail.sHour, eHour: a.detail.eHour,
      edits: a.preEdits || {} }) : null;
  }

  /**
   * 사전정산을 다시 작성하는 칸에서 편의 일자·출발 시·도착 시를 고쳤을 때(2026-10-05 사용자 지정 — 여비계산서의 값을 가져온 상태에서 고친다).
   * 고친 값은 그 편의 것으로 적어 두고(a.preEdits — prePlan 의 edits), 사전정산에는 `사전정산 다시 저장`을 눌렀을 때 들어간다.
   * @param {object} change 고친 칸들({date?, shr?, ehr?}) — 못 쓰는 값(빈 날짜 등)은 버린다
   */
  function pickPreEdit(it, leg, change) {
    const trip = tripOf(it);
    const a = trip ? st.after[trip.seq] : null;
    if (!a?.redoPre || !['go', 'back'].includes(leg)) return;
    const ok = Object.entries(change).filter(([k, v]) => (k === 'date' ? DAY_RE.test(v || '') : ['shr', 'ehr'].includes(k) && Number.isInteger(v) && v >= 0 && v <= 23));
    disarm();
    if (ok.length) {
      a.preEdits = { ...a.preEdits, [leg]: { ...a.preEdits?.[leg], ...Object.fromEntries(ok) } };
      a.error = '';
    }
    paintList();
  }

  /**
   * 그 출장의 사전정산 일비·식비(src/travel.js 의 stayPlan) — 사전정산을 다시 작성하는 중이면 카드에서 고쳐 둔 식수(a.preMeal)를 얹는다.
   * 사전정산을 아직 못 읽었거나 일비·식비 내역이 없는 출장(당일출장)이면 null.
   */
  function stayOf(trip) {
    const a = st.after[trip.seq];
    return a?.detail ? stayPlan({ stays: a.detail.stays, period: a.detail.period, want: a.redoPre ? a.preMeal : null }) : null;
  }

  /**
   * 사전정산의 일비·식비 한 줄(2026-10-05 사용자 지정: "정산내역에서 사전정산에서의 일비랑 식비를 한줄에 표기하고.. 식비는 아이콘으로
   * 줄이거나 늘릴 수 있게 … 이게 갱신되면 사전정산을 다시 진행될 수 있도록") — `일비 2일 · 식비 − 6식 +`. 가는 편·오는 편 아래에 선다.
   * 식수 옆의 − + 를 누르면 사전정산을 다시 작성하는 칸(preRedoHtml)이 서고 고친 식수가 거기 적힌다(pickPreMeal) — 사이트에는
   * `사전정산 다시 저장`을 눌렀을 때 간다. 일비·식비 줄이 여럿인 계산서는 합만 적는다(아이콘 없음 — 사전정산 입력 화면에서 고친다).
   */
  function stayHtml(trip, locked) {
    const s = stayOf(trip);
    if (!s) return '';
    const step = (d, name, off) => `<button type="button" class="at-chip at-icon at-step" data-act="pre-meal" data-d="${d}" `
      + `aria-label="${name}" title="${name}"${locked || off ? ' disabled' : ''}>${d < 0 ? MINUS_ICON : PLUS_ICON}</button>`;
    const n = `<span class="at-stay-n">${s.meal}식</span>`;
    const meal = s.editable
      ? `<span class="at-chips" role="group" aria-label="식비(식수)">${step(-1, MEAL_LESS, s.meal <= s.min)}${n}${step(1, MEAL_MORE, s.meal >= s.max)}</span>` : n;
    return `<div class="at-stay"${s.editable ? '' : ` title="${STAY_MANY}"`}>`
      + `<span class="at-stay-item"><span class="at-leg-name">일비</span><span class="at-stay-n">${s.daily}일</span></span>`
      + `<span class="at-stay-item"><span class="at-leg-name">식비</span>${meal}</span>`
      + (s.changed ? `<span class="at-leg-what new">${escapeHtml(`바꿈 · 사전정산 ${s.had}식`)}</span>` : '')
      + '</div>';
  }

  /**
   * 일비·식비 줄의 − + 를 눌렀을 때 — 식수를 한 끼 줄이거나 늘린다. 사전정산을 다시 작성하는 칸이 아니었으면 그 칸을 연다(완료한 사후정산을
   * 다시 작성하던 칸은 접는다 — 한 번에 하나만 다시 한다). 누르는 것만으로는 사이트에 아무것도 가지 않는다 — 사전정산에는
   * `사전정산 다시 저장`을 눌렀을 때 들어간다(savePre).
   */
  function pickPreMeal(it, d) {
    const trip = tripOf(it);
    const s = trip && stayOf(trip);
    if (!s?.editable) return;
    disarm();
    const a = st.after[trip.seq];
    const meal = Math.min(s.max, Math.max(s.min, s.meal + d));
    if (a.redoPre) Object.assign(a, { preMeal: meal, error: '' });
    else Object.assign(a, { redoPre: true, prePicks: null, preEdits: null, preMeal: meal, reopen: false, error: '', info: '', warn: '', result: null });
    paintList();
    el.list.querySelector(`button[data-act="pre-meal"][data-d="${d}"]`)?.focus();
  }

  /** 다시 저장할 사전정산을 한 줄로 — 바꾼 편마다 무엇으로 바뀌는지, 고친 식수. 바꾼 것이 없으면 "화면에 있는 그대로". */
  const preSummary = (plan, stay = null) => [
    ...plan.legs.map((l) => {
      const moved = l.pick?.t && l.source !== 'site' && !l.problem;
      // 고친 일자·시각 — 여비계산서의 값(바꾼 편이면 새 줄에 채워질 값)과 달라진 것만 적는다.
      const fixed = !l.edited ? [] : [l.when.date !== l.base.date ? `일자 ${md(l.when.date)}` : '',
        l.when.shr !== l.base.shr || l.when.ehr !== l.base.ehr ? `시각 ${whenText(l.when)}` : ''].filter(Boolean);
      return moved || fixed.length ? [l.label, ...(moved ? [l.row ? describeTrans(l.row) : l.blank] : []), ...fixed].join(' ') : '';
    }).filter(Boolean),
    ...(stay?.changed ? [`식비 ${stay.had}식 → ${stay.meal}식`] : []),
  ].join(' · ') || '화면에 있는 그대로';

  /**
   * 사전정산을 다시 작성하는 칸(2026-10-05 사용자 지정: "사전정산 다시하기") — 가는 편·오는 편의 교통편을 다시 고르고 `사전정산 다시 저장`을
   * 누르면, 사전정산 입력 화면의 교통편 줄을 그것으로 바꿔 다시 저장한다(savePre). 기차는 운임표의 정가이고(한 번 더 누르면 특실),
   * 비행기·버스는 사전정산에 줄을 넣지 않는다(신청할 때와 같다). 고르는 것만으로는 사이트에 아무것도 가지 않는다.
   * 편마다 일자·출발 시·도착 시는 여비계산서에 저장된 값이 든 칸으로 서서 고칠 수 있다(legsHtml 의 edit — 같은 날 사용자 지정).
   * 식비(식수)는 편 아래 일비·식비 줄의 − + 로 고친다(stayHtml — 같은 날 사용자 지정). 그 밖의 칸(기간·일비·역·요금)은 머리의 ↗ 로
   * 사전정산 입력 화면을 열어 고친다.
   */
  function preRedoHtml(it, trip, a, locked) {
    const plan = prePlanOf(trip);
    const stay = stayOf(trip);
    const dis = locked ? ' disabled' : '';
    const head = '<strong>사전정산</strong><span class="at-after-why">다시 작성 중</span>'
      + `<button type="button" class="small ghost at-reopen" data-act="pre-redo" title="${PRE_REDO_STOP}"${dis}>그만두기</button>`
      + `<button type="button" class="small ghost at-web" data-act="pre-open" title="${PRE_OPEN_TITLE}" aria-label="${PRE_OPEN_TITLE}">${WEB_ICON}</button>`;
    const notes = [...plan.notes, plan.changed || stay?.changed ? '' : '바꾼 것이 없으면 사전정산 입력 화면에 있는 그대로 다시 저장합니다'].filter(Boolean);
    return `<div class="at-after at-pre-redo"><div class="at-after-head">${head}</div>`
      + legsHtml(plan, !locked, '줄 없음', { act: 'pre-leg', graded: PRE_GRADED, check: diffCheck(trip, a), edit: true })
      + stayHtml(trip, locked)
      + notes.map((n) => `<p class="at-after-note">${escapeHtml(n)}</p>`).join('')
      + `<div class="at-leg-go"><button type="button" class="small at-request" data-act="pre-save" title="${PRE_SAVE_TITLE}"${locked || plan.problems.length ? ' disabled' : ''}>사전정산 다시 저장</button></div>`
      + (a.busy ? `<p class="at-after-note">${escapeHtml(a.stage || '사전정산을 다시 저장하는 중...')}</p>` : '')
      + (a.error ? `<p class="at-after-note error">${escapeHtml(a.error)}</p>` : '')
      + '</div>';
  }

  /** 사전정산을 다시 작성하는 칸의 교통편 아이콘을 눌렀을 때 — 기차는 한 번 더 누르면 특실이다. 사전정산에는 다시 저장할 때 들어간다. */
  function pickPreLeg(it, leg, value) {
    const trip = tripOf(it);
    const plan = trip && prePlanOf(trip);
    if (!plan) return;
    disarm();
    const a = st.after[trip.seq];
    const was = plan.legs.find((l) => l.key === leg)?.pick;
    a.prePicks = { ...a.prePicks, [leg]: nextLegPick(PRE_GRADED.includes(value) ? was : null, value) };
    a.error = '';
    paintList();
    el.list.querySelector(`button[data-act="pre-leg"][data-leg="${leg}"][data-t="${value}"]`)?.focus();
  }

  /**
   * 사전정산을 다시 저장한다(`사전정산 다시 저장`의 두 번째 누름) — src/trip.js 의 tripPreSave. 저장한 뒤 사이트가 계산서의 단계를
   * 어떻게 했는지는 다시 읽은 목록 그대로 따른다(사전정산 "작성"으로 돌아갔으면 카드에 `사전정산 완료`가 선다). 다시 읽은 교통편 줄이
   * 가는 편·오는 편의 새 바탕이 되고, 그 출장지의 교통편으로도 기억한다.
   */
  async function savePre(it) {
    const trip = tripOf(it);
    const a = trip ? st.after[trip.seq] : null;
    const plan = trip ? prePlanOf(trip) : null;
    if (!plan || a.busy || plan.problems.length) return;
    // 일비·식비 줄에서 고쳐 둔 식수 — 고친 것이 없으면 그 줄은 화면에 있는 그대로 나간다.
    const stay = stayOf(trip);
    const what = preSummary(plan, stay);
    Object.assign(a, { busy: true, error: '', info: '', warn: '', result: null, stage: '사전정산을 다시 저장하는 중...' });
    paintList();
    try {
      const r = await tripPreSave(trip, { ...plan, meals: stay?.set || null }, { name: st.trips?.me || '', onStage: (s) => { a.stage = s; paintList(); } });
      Object.assign(a, { detail: r.detail, redoPre: false, prePicks: null, preMeal: null, preEdits: null });
      keepTripRoute(trip.location, routeOfRows(r.detail.rows, trip));
      const next = r.stage.phase === 'pre' && !r.stage.done ? ' — `사전정산 완료`를 누르거나 증빙을 넣으면 다시 확정합니다' : '';
      a.info = `사전정산을 다시 저장했습니다 — ${what} · 지금 단계: ${r.stage.label}${next}`;
      setStatus(`사전정산을 다시 저장했습니다 — 여비계산서 ${trip.seq} · ${what} · ${r.stage.label}`);
      logEvent('trip', true, `여비계산서(사전정산) 다시 저장: ${trip.seq} · ${what} · ${r.stage.label}`, { seq: trip.seq, drop: plan.drop, add: plan.add.length, linked: r.linked, meals: stay?.set || null });
      await freshTrip(r.row);
    } catch (err) {
      a.error = `사전정산 다시 저장 실패: ${err.message}`;
      setError(err, '사전정산 다시 저장 실패');
      logEvent('trip', false, `여비계산서(사전정산) 다시 저장 실패: ${trip.seq} — ${err.message}`, { seq: trip.seq, auth: err instanceof AuthError });
    } finally {
      a.busy = false;
      a.stage = '';
      paintList();
    }
  }

  /**
   * 보관함에 담아 둔 증빙(당일출장 증명·항공기 증명). 여비계산서에는 붙일 칸이 없어 가지고 있다가 담당자에게 Teams·쪽지로 보낼 때
   * 같이 보낸다(2026-10-03 사용자 지정 — 보내는 것은 따로 만든다). 잘못 담은 것은 × 로 뺀다.
   */
  function keptHtml(a, locked = false) {
    if (!a.kept?.length) return '';
    // 홈의 WORKSPACE 카드에서 넣은 숙박 증빙·항공권은 홈 카드가 넣는 즉시 사후정산에 올린다(src/afterup.js, 2026-10-04 사용자 지정).
    // 여기 남아 있는 것은 그렇게 못 올린 것이다(원화 금액을 적어야 한다·상한액을 넘는데 홈 줄에서 아직 고르지 않았다·값을 못 읽었다·사이트가 받지 않았다) — 이 카드가 그때 읽은
    // 기록으로(다시 읽지 않고) 올리고, 물을 것은 여기서 묻는다. 실제 계산서를 바꾸는 누름이라 두 번 눌러야 나간다.
    const todo = todoOf(a);
    // 확정한 증빙(출장 기간과 안 맞아 알림 표시로 두었다가 사람이 맞다고 한 것)이 끼어 있으면 "홈에서 넣은"이라고 하지 않는다.
    const mine = todo.some((k) => k.confirmed);
    const goTitle = `${mine ? '보관해 둔' : '홈 카드에서 넣은'} 증빙을 그때 읽은 기록으로 사후정산에 올립니다 — 이 카드에 넣었을 때와 같습니다`;
    const go = !todo.length ? '' : `<div class="at-leg-go"><p class="at-after-note">${mine ? '확정한 증빙을 포함해' : '홈 카드에서 넣은 증빙'} ${todo.length}장은 사후정산에 아직 올리지 않았습니다</p>`
      + `<button type="button" class="small at-request" data-act="kept-go" title="${goTitle}"${locked ? ' disabled' : ''}>${mine ? '보관한 증빙을 사후정산에 올리기' : '홈에서 넣은 증빙을 사후정산에 올리기'}</button></div>`;
    // 출장 기간의 것이 아닌 문서는 알림 표시(⚠ 와 까닭)가 붙어 있다(2026-10-05 사용자 지정) — `확정`을 누르기 전에는 사후정산에
    // 올리지도 담당자에게 보내지도 않는다. 이 출장의 것이 아니면 × 로 뺀다.
    const held = a.kept.filter((k) => k.warn).length;
    const okBtn = (k) => (!k.warn ? '' : `<button type="button" class="small ghost at-kept-ok" data-act="kept-ok" data-name="${escapeHtml(k.name)}" `
      + `title="이 출장의 증빙이 맞다고 확정합니다 — 그때부터 보낼 때 같이 가고, 숙박 증빙·항공권이면 사후정산에 올릴 수 있습니다"${locked ? ' disabled' : ''}>확정</button>`);
    return `<div class="at-kept"><p class="at-after-note">보관 중인 증빙 ${a.kept.length}장 — 담당자에게 보낼 때 같이 갑니다${held ? `(⚠ 출장 기간과 안 맞는 ${held}장은 확정해야 갑니다)` : ''}</p><ul>${a.kept.map((k) =>
      `<li${k.warn ? ' class="warn"' : ''}><span${k.warn ? ` title="${escapeHtml(k.warn)}"` : ''}>${escapeHtml(`${k.label} · ${k.name}${k.todo ? ' · 사후정산에 안 올림' : ''}${k.warn ? ` · ⚠ ${k.warn}` : ''}`)}</span>${okBtn(k)}`
      + `<button type="button" class="small ghost at-kept-drop" data-act="kept-drop" data-name="${escapeHtml(k.name)}" `
      + `title="보관함에서 빼기" aria-label="${escapeHtml(k.name)} 보관함에서 빼기">×</button></li>`).join('')}</ul>${go}</div>`;
  }

  /**
   * 보관함의 증빙 가운데 홈의 WORKSPACE 카드에서 넣어 사후정산에 아직 올리지 않은 것(숙박 증빙·항공권). 홈 카드는 읽은 기록 record 와
   * todo 를 붙여 담고(src/intake.js) 곧바로 올려 표시를 걷는다(src/afterup.js) — 못 올려 남은 것은 이 카드가 그 기록으로 올리면서
   * 다시 담으면 표시가 없어진다. 홈 카드가 올린 항공권에는 표시 없이 기록만 남아 있다(다음 항공권과 같이 묶인다) — 여기서는 세지 않는다.
   */
  const todoOf = (a) => (a?.kept || []).filter((k) => k.todo && k.record);

  /**
   * 여비증빙 송부 칸(sendbox.js)에 넘길 그 출장의 사정 — 여비계산서와 단계, 사후정산 대상인가(사전정산의 교통편을 읽은 뒤에 안다),
   * 보관함의 증빙. refresh 는 보관함을 다시 읽고 카드를 다시 그린다(송부 칸에서 증빙을 넣었을 때).
   * save·confirm 은 사후정산을 아직 완료하지 않은 출장의 `보내기`(저장 → 확정 → 송부)가 부르고, again 은 그 뒤의
   * 사정을 다시 준다. hold 는 저장하기 전에 사람이 정해 줄 것이 남았을 때의 까닭이다(사후정산 칸이 정산금액을 묻고 있다).
   */
  function sendCtx(it) {
    const trip = tripOf(it);
    const a = trip ? st.after[trip.seq] || (st.after[trip.seq] = {}) : {};
    const stage = trip ? tripStage(trip, st.trips.me) : null;
    const settled = stage?.phase === 'post' && stage.done;
    const { apiKey, cli } = ai();
    return {
      it, trip, stage, kept: a.kept || [], me: st.trips?.me || st.me?.name || '',
      need: trip && a.detail ? afterNeed(trip, a.detail, st.legs[it.docNo]) : null, locked: st.busy || !!a.busy,
      // 완료한 사후정산을 카드에서 다시 작성하는 중인가 — 그러면 완료하기 전처럼 `보내기`(저장 → 확정 → 송부)가 선다.
      reopen: !!a.reopen && settled,
      // 맨 아래 보내기 위의 `사전정산 다시하기`·`사후정산 다시하기`(2026-10-05 사용자 지정) — 사전정산은 교통편을 읽은 뒤면 언제든,
      // 사후정산은 완료한 뒤에 다시 한다(완료하기 전에는 사후정산 칸이 이미 쓰는 칸이다). 켜진 것이 지금 다시 하는 중인 정산이다.
      redo: trip && a.detail ? {
        pre: { on: !!a.redoPre, title: a.redoPre ? PRE_REDO_STOP : PRE_REDO_TITLE },
        post: settled ? { on: !!a.reopen, title: a.reopen ? REOPEN_STOP : REOPEN_TITLE } : null,
      } : null,
      // 사후정산을 완료한 출장에 넣은 증빙은 읽어서 사후정산에 반영한다(runAfter 의 amend) — Claude 가 연결돼 있을 때만이다.
      read: trip && settled && !a.reopen && (apiKey || cli) ? (files, opts) => runAfter(trip.seq, files, opts) : null,
      // 증빙 넣기 아래의 웹페이지 캡처(webpick.js) — 공문 탭과 같은 칸이다.
      cap: () => capHtml(it.docNo, 'send', st.busy || !!a.busy),
      refresh: () => loadKept(it.docNo, a).then(paintList),
      save: (onStage) => saveAfter(it, onStage), confirm: (onStage) => confirmPost(it, onStage), again: () => sendCtx(it),
      hold: a.ask ? '사후정산 칸에서 정산금액을 먼저 정해 주세요'
        : todoOf(a).length ? `${todoOf(a).some((k) => k.confirmed) ? '확정한' : '홈 카드에서 넣은'} 증빙을 사후정산 칸에서 먼저 올려 주세요` : '',
    };
  }

  /** 그 출장의 보관함을 다시 읽어 카드에 맞춘다. 못 읽어도 던지지 않는다 — 보관함은 올리기와 따로다. */
  async function loadKept(docNo, a) {
    try {
      a.kept = await evidence.list(docNo);
    } catch {
      a.kept = a.kept || [];
    }
  }

  /**
   * 읽어 묶은(또는 올린) 사후정산 내역. 무엇이 들어갔고 무엇을 못 읽었는지 사람이 보고 고칠 수 있게 적는다.
   * 읽은 증빙마다 무엇의 증명인지(항공기 증명·숙박 증빙·당일출장 증명 — 출장지에서 결제한 영수증)도 적는다.
   */
  function afterResultHtml(plan) {
    const li = (s) => `<li>${escapeHtml(s)}</li>`;
    const money = (n, cur) => (n == null ? '금액 ?' : `${Number(n).toLocaleString('ko-KR')} ${cur || 'KRW'}`);
    const rows = [
      ...plan.trans.map((t) => `교통 · ${t.date || '?'} ${t.dep || '?'}→${t.arr || '?'} ${TRANS_NAME[t.transport] || t.transport}${t.grade ? ` ${t.grade}` : ''} · ${money(t.total, t.currency)}${t.comment ? ` · ${t.comment}` : ''}`),
      ...(plan.air ? [`항공 마일리지 · 항공권 출장 예 · ${plan.air.airline || '항공사 ?'} · 신규 마일리지 ${plan.air.mileage == null ? '?' : plan.air.mileage.toLocaleString('ko-KR')}${plan.air.deduction === 'Y' ? ' · 마일리지 공제 신청' : ''}`] : []),
    ];
    // 올린 숙박 줄의 내용(읽은 증빙·칸마다의 값·그 줄의 알림)은 여기 펴 두지 않는다 — 숙박비 내역의 그 줄에서 `증빙`을 누르면
    // 그 줄 아래에 펴진다(2026-10-03 사용자 지정, lodgeInfoHtml). 아직 올리지 않은 줄(물어 둔 것·못 올린 것)만 여기에 적는다.
    const same = plan.lodge.filter((l) => plan.same?.includes(l));
    const lodged = plan.saved ? plan.lodge.filter((l) => !same.includes(l)) : [];
    const pending = plan.lodge.filter((l) => !same.includes(l) && !lodged.includes(l));
    const tucked = { docs: new Set(lodged.flatMap((l) => l.sources)), notes: new Set(lodged.flatMap((l) => l.notes || [])) };
    const docs = (plan.docs || []).filter((d) => !tucked.docs.has(d.name)).map(docLine);
    const notes = [...plan.notes, ...plan.skipped].filter((n) => !tucked.notes.has(n));
    // 읽은 증빙(문서)과 그것으로 올린 줄은 다른 것이다 — 이름표를 붙여 가른다(2026-10-03 사용자가 둘을 영수증 두 장으로 읽었다).
    const label = (s) => `<p class="at-after-label">${escapeHtml(s)}</p>`;
    const done = plan.saved ? '올린' : '올릴';
    return `<div class="at-after-result${plan.saved ? ' saved' : ''}">`
      + (plan.saved ? `<p class="at-after-note ok">올렸습니다 — ${escapeHtml(plan.stage?.label || '사후정산 작성')}</p>` : '')
      + (lodged.length ? `<p class="at-after-note at-lodged-hint">숙박 줄 ${lodged.length}개를 올렸습니다 — 위 숙박비 내역에서 그 줄의 ‘증빙’을 누르면 올린 내용이 보입니다</p>` : '')
      + same.map((l) => `<p class="at-after-note at-lodged-same">${escapeHtml(`같은 숙박 줄이 이미 있어 다시 올리지 않았습니다 — ${l.company || '?'} · ${l.paydate || '?'} · ${l.sday ?? '?'}박 · ${wonOf(l.total)}`)}</p>`).join('')
      + (docs.length ? `${label(`읽은 증빙 ${docs.length}장`)}<ul class="at-after-docs">${docs.map(li).join('')}</ul>` : '')
      + pending.map((l) => cellsHtml('올릴 숙박 줄 — 아직 올리지 않았습니다', lodgeCells(l))).join('')
      + (rows.length ? `${label(`${done} 교통비·항공 내역`)}<ul class="at-after-rows">${rows.map(li).join('')}</ul>` : '')
      + (notes.length ? `<ul class="at-after-notes">${notes.map(li).join('')}</ul>` : '')
      + '</div>';
  }

  const wonOf = (n) => (n == null ? '?' : `${Number(n).toLocaleString('ko-KR')}원`);
  /** 읽은 증빙 한 장을 한 줄로 — 그 증명으로 쓸 수 없는 문서(출장지에서 결제하지 않은 영수증, 기차표 …)는 ✗ 와 까닭을 적는다. */
  // 출장 기간의 것이 아닌 문서(d.warn)는 ⚠ 와 까닭을 적는다 — 알림 표시로 보관돼 있고 확정하기 전에는 올리지도 보내지도 않는다.
  const docLine = (d) => (d.ok ? `${d.label} · ${d.name}${d.summary ? ` — ${d.summary}` : ''}`
    : d.warn ? `${d.label} ⚠ · ${d.name} — ${d.warn} · 알림 표시로 보관했습니다(확정하기 전에는 올리지도 보내지도 않습니다)`
      : `${d.label} ✗ · ${d.name} — ${d.note}`);
  /** 숙박 줄의 칸들을 이름표 아래 표로. cells 는 [칸 이름, 값] 의 목록이다. */
  const cellsHtml = (head, cells) => `<div class="at-lodged"><p class="at-after-label">${escapeHtml(head)}</p><dl>`
    + cells.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('') + '</dl></div>';

  /**
   * 숙박 줄 하나의 칸들 — 사후정산 입력 화면의 칸 이름 그대로 무엇이 올라갔는지(올라갈지) 적는다(2026-10-03 사용자 지정).
   * 정산금액은 원화이고, 문서의 금액이 외화였거나 상한액으로 낮췄으면 그 사실을, 공급가액·부가세를 되셈했으면 그것도 적는다.
   * @param {object} l src/after.js 의 숙박 줄
   * @param {object} [site] 올린 뒤 사이트에서 다시 읽은 그 줄(첨부가 남았는지 본다)
   * @returns {[string, string][]}
   */
  function lodgeCells(l, site = null) {
    const cap = lodgeCap(l);
    const foreign = l.doc && l.doc.currency !== 'KRW' && l.doc.total != null ? `문서의 금액 ${Number(l.doc.total).toLocaleString('ko-KR')} ${l.doc.currency}` : '';
    // 상한액을 넘는데 어느 금액으로 올릴지 아직 고르지 않았으면 정산금액은 정해진 것이 아니다 — 실제 금액을 정산금액인 양 적지 않는다.
    const open = lodgeAsk(l) === 'cap';
    const over = open ? null : lodgeOver(l);
    const amount = l.total == null ? `정하지 않음${foreign ? ` — ${foreign}` : ''}`
      : open ? [`정하지 않음 — 실제 ${wonOf(l.actual)}이 상한액 ${wonOf(cap.total)}을 넘습니다`, foreign].filter(Boolean).join(' · ')
        : [wonOf(l.total),
          // 상한액을 넘겨 실제 금액으로 정산하면 승인이 필요하다 — 상한액의 1.5배까지는 부서장 승인(2026-10-05 사용자 지정, src/after.js lodgeOver).
          l.capped ? `상한액으로 정산(실제 ${wonOf(l.actual)})`
            : over ? `실제 금액으로 정산(상한액 ${wonOf(cap.total)} 초과 · ${over.within ? `${over.approver} 승인 필요` : `${over.approver} 승인 범위 ${wonOf(over.limit)} 초과`})` : '',
          foreign].filter(Boolean).join(' · ');
    const calc = l.vatFrom === 'calc' ? ' (정산금액에서 역산)' : '';
    const part = (n) => (open || n == null ? '?' : `${wonOf(n)}${calc}`);
    return [
      ['업체명', l.company || '?'], ['사업자등록번호', l.companycode || '문서에 없음'], ['결제일', l.paydate || '?'], ['숙박 일수', `${l.sday ?? '?'}박`],
      ['정산금액', amount], ['공급가액', part(l.samount)], ['부가세', part(l.vat)],
      ...(cap ? [['상한액', `${wonOf(cap.total)} (1일 ${wonOf(cap.day)} × ${l.sday}박)`]] : []),
      ...(l.comment ? [['비고', l.comment]] : []),
      ['증빙', `${l.sources.join(' · ')}${site?.oldfile ? ' (첨부됨)' : ''}`],
    ];
  }

  /**
   * 숙박비 내역의 줄에서 `증빙`(또는 `손수 작성`)을 눌렀을 때 그 줄 아래에 펴는 내용(2026-10-03 사용자 지정 — 올린 내용은 늘 펴 두지 않는다).
   * 이 패널이 올린 줄이면 올릴 때 적어 둔 것(읽은 증빙·칸마다의 값과 어떻게 정했는지·그 줄의 알림, st.lodgeInfo)을 보이고,
   * 적어 둔 것이 없거나 올린 뒤 사후정산 화면에서 고쳐졌으면 **화면에 지금 있는 값**을 적는다.
   * @param {string} seq 계산서 번호
   * @param {object} row 사후정산 화면의 숙박 줄(src/after.js lodgeRowsOf)
   * @param {string} source 그 줄을 올린 증빙의 이름(손수 작성한 줄이면 빈 글)
   */
  function lodgeInfoHtml(seq, row, source) {
    const li = (s) => `<li>${escapeHtml(s)}</li>`;
    const info = st.lodgeInfo[seq]?.[row.seq];
    if (info && Array.isArray(info.cells) && lodgeSame(info.row || {}, row)) {
      const docs = info.docs || [];
      const notes = info.notes || [];
      return (docs.length ? `<p class="at-after-label">읽은 증빙 ${docs.length}장</p><ul class="at-after-docs">${docs.map(li).join('')}</ul>` : '')
        + cellsHtml(`올린 숙박 줄 (줄 번호 ${row.seq})`, info.cells)
        + (notes.length ? `<ul class="at-after-notes">${notes.map(li).join('')}</ul>` : '');
    }
    const part = (v) => lodgeAmount({ total: v, currency: row.currency });
    const head = info ? '올린 뒤 사후정산 화면에서 고쳐진 줄 — 화면에 지금 있는 값'
      : source ? '증빙으로 올린 줄 — 사후정산 화면에 지금 있는 값' : '손수 작성한 줄 — 사후정산 화면에 지금 있는 값';
    return cellsHtml(`${head} (줄 번호 ${row.seq})`, [
      ['업체명', row.company || '없음'], ['사업자등록번호', row.companycode || '없음'], ['결제일', row.paydate || '없음'], ['숙박 일수', `${row.sday || '?'}박`],
      ['정산금액', lodgeAmount(row)], ['공급가액', part(row.samount)], ['부가세', part(row.vat)],
      ...(row.comment ? [['비고', row.comment]] : []),
      ...(source ? [['증빙', source]] : []),
    ]);
  }

  /**
   * 올리기 전에 사람이 정해 줘야 하는 것(2026-10-03 사용자 지정). 정산금액은 원화로만 적으므로 외화 문서에 원화 금액이 없으면
   * 원화로 결제된 금액을 묻고, 실제 금액이 숙박비 상한액을 넘으면 상한액으로 정산할지 실제 금액으로 정산할지 묻는다.
   * 다 정해지면 그대로 올린다(answerAsk).
   */
  function askHtml(a) {
    const ask = a.ask;
    if (!ask) return '';
    const dis = a.busy || st.busy ? ' disabled' : '';
    const items = ask.plan.lodge.map((l, i) => {
      const kind = lodgeAsk(l);
      if (!kind) return '';
      const name = `${l.stay || l.company || '숙박'} ${l.sday ?? '?'}박`;
      if (kind === 'krw') {
        const doc = `${Number(l.doc.total).toLocaleString('ko-KR')} ${l.doc.currency}`;
        return `<li><p>${escapeHtml(`${name} — 문서의 금액이 ${doc} 입니다. 정산금액은 원화로 적습니다. 원화로 결제된 금액(카드 청구 금액)을 적어 주세요.`)}</p>`
          + `<div class="at-ask-row"><input type="text" inputmode="numeric" class="at-ask-krw" data-i="${i}" value="${escapeHtml(ask.krw[i] || '')}" `
          + `placeholder="원화 금액" aria-label="${escapeHtml(`${name} 원화 결제 금액`)}"${dis} /><span>원</span>`
          + `<button type="button" class="small at-request" data-act="ask-krw" data-i="${i}"${dis}>이 금액으로</button></div></li>`;
      }
      // 무엇을 묻고 무엇을 고르는지는 src/after.js 가 정한다(lodgeChoices) — 홈 카드의 출장 줄도 같은 말로 묻는다. 실제 금액이
      // 상한액의 1.5배 안이면 그 버튼에 부서장 승인이라고 적히고, 그 까닭이 버튼 아래에 선다(2026-10-05 사용자 지정).
      const { question, choices } = lodgeChoices(l);
      return `<li><p>${escapeHtml(`${name} — ${question}`)}</p><div class="at-ask-row">`
        + choices.map((c) => `<button type="button" class="small at-request" data-act="ask-${c.settle}" data-i="${i}"${dis}>${escapeHtml(c.label)}</button>`).join('')
        + `</div>${choices.filter((c) => c.note).map((c) => `<p class="at-after-note">${escapeHtml(c.note)}</p>`).join('')}</li>`;
    }).join('');
    return `<div class="at-after-ask"><p class="at-after-note"><strong>아직 올리지 않았습니다</strong> — 아래를 정해 주시면 올립니다</p><ul>${items}</ul>`
      + `<button type="button" class="small ghost at-ask-drop" data-act="ask-drop"${dis}>올리지 않기</button></div>`;
  }

  /** 열어 둔 출장 카드의 사전정산 교통편(가는 편·오는 편의 처음 값, 사후정산 조건)을 한 번 읽어 둔다. 읽히면 카드를 다시 그린다. */
  function ensureAfterDetail() {
    const it = st.items.find((x) => x.docNo === st.openDoc);
    const trip = it ? tripOf(it) : null;
    if (!trip) return;
    const a = st.after[trip.seq] || (st.after[trip.seq] = {});
    if (a.detail || a.loading || a.detailError) return;
    a.loading = true;
    tripPreDetail(trip.seq)
      // 읽은 교통편 줄은 그 출장지의 교통편으로 기억해 둔다(사이트에서 손으로 고친 것까지 — 다음에 같은 출장지면 이것이 먼저다).
      .then((d) => { a.detail = d; keepTripRoute(trip.location, routeOfRows(d.rows, trip)); }, (err) => { a.detailError = err.message; })
      .then(() => loadKept(it.docNo, a))
      .finally(() => { a.loading = false; paintList(); });
  }

  /** 목록의 줄(li)이 가리키는 출장의 여비계산서. 출장이 아니거나 계산서가 없으면 null. */
  const tripOfRow = (li) => {
    const it = li ? shownItems()[+li.dataset.i] : null;
    return it && isTrip(it) ? tripOf(it) : null;
  };

  /**
   * 증빙을 끌어다 놓거나 붙여 넣을 곳(2026-10-03 사용자 지정) — 열린 카드의 사후정산 칸이거나, **접힌 출장 줄 자체**다.
   * 줄에 놓으면 그 줄을 펴고 조건을 읽은 뒤 올린다. 돌려주는 node 는 칠할 요소, seq 는 계산서 번호다.
   */
  function afterTarget(target) {
    const node = target instanceof HTMLElement ? target : null;
    const drop = node?.closest('.at-after-drop');
    if (drop) return { node: drop, seq: drop.closest('.at-after')?.dataset.seq || '' };
    const li = node?.closest('li[data-i]');
    const trip = li ? tripOfRow(li) : null;
    return trip ? { node: li, seq: trip.seq } : null;
  }
  const afterDrop = (e) => afterTarget(e.target)?.node || null;

  /** 붙여넣기가 갈 계산서 — 열린 카드의 사후정산 칸이 먼저, 없으면 초점이 있는 출장 줄이다. */
  function pasteSeq() {
    if (el.root.classList.contains('hidden')) return '';
    const box = el.list.querySelector('.at-after[data-seq]');
    if (box) return box.dataset.seq;
    const li = document.activeElement instanceof HTMLElement ? document.activeElement.closest('#atList li[data-i]') : null;
    return tripOfRow(li)?.seq || '';
  }

  function onAfterDrag(e) {
    const t = afterTarget(e.target);
    if (!t || !hasFiles(e)) return;
    if (e.type === 'dragleave') {
      if (!t.node.contains(e.relatedTarget)) t.node.classList.remove('over');
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    t.node.classList.add('over');
  }

  function onAfterDrop(e) {
    const t = afterTarget(e.target);
    if (!t || !hasFiles(e)) return;
    e.preventDefault();
    t.node.classList.remove('over');
    runAfter(t.seq, [...e.dataTransfer.files]);
  }

  /**
   * 증빙 넣는 곳 아래의 웹페이지 캡처 단추와 탭 목록을 눌렀을 때(webpick.js) — 단추는 그 칸의 목록을 펴고 접고, 목록의 캡처는 고른
   * 탭들을 찍어 증빙으로 넣는다(captureFor). 공문 탭과 같은 칸이다.
   */
  async function onPick(r, it, target) {
    const trip = isTrip(it) ? tripOf(it) : null;
    if (!trip) return undefined;
    disarm();
    if (r.act === 'open') {
      if (st.after[trip.seq]?.busy) return undefined;
      const where = target.closest('[data-cap]')?.dataset.cap || 'after';
      try {
        if (await webPick.toggle(`${it.docNo}:${where}`)) setStatus('');
      } catch (err) {
        setStatus(err.message, 'error');
      }
      return paintList();
    }
    if (r.act === 'close') return paintList();
    if (r.act === 'go') return captureFor(it, r.key.slice(it.docNo.length + 1), r.tabs);
    return undefined;
  }

  /**
   * 고른 웹페이지들을 통째로 캡처해 증빙으로 넣는다(2026-10-08 사용자 지정: "여기도 웹페이지 카피 공문처럼 하게해줘.. 2개 동일한 기능으로").
   * 찍는 것은 공문 탭과 같다(webpick.js → src/pagecap.js: 권한 묻기 → 고른 탭을 차례로 앞에 두고 한 화면씩 → A4 장 → 화면 글자 → 보던
   * 탭으로). 페이지 하나를 PDF 하나로 묶어(pagePdfs — 예약 확인 화면이 석 장이어도 증빙은 하나) 그 칸에 파일을 넣은 것과 같은 길로 보낸다:
   * 사후정산 칸이면 읽어서 사후정산을 올리고(runAfter), 여비증빙 송부 칸이면 그 칸의 증빙 넣기와 같다(읽을 길이 있으면 읽어서 반영,
   * 없으면 그대로 담기). 화면 글자는 그 PDF 를 읽을 때 같이 준다 — 웹페이지의 글자는 OCR 보다 정확하다.
   */
  async function captureFor(it, where, tabs) {
    const trip = tripOf(it);
    if (!trip) return undefined;
    const a = st.after[trip.seq] || (st.after[trip.seq] = {});
    if (a.busy) return undefined;
    Object.assign(a, { busy: true, error: '', stage: '' });
    const step = (text) => { a.stage = text; setStatus(text); paintList(); };
    let got = null;
    let docs = [];
    try {
      got = await webPick.shoot(tabs, { today: attendToday(), onStatus: step });
      step('캡처한 페이지를 PDF 로 묶는 중…');
      const taken = (await evidence.list(it.docNo).catch(() => a.kept || [])).map((k) => k.name);
      docs = await pagePdfs(got.pages, { today: attendToday(), taken });
      if (!docs.length) throw new Error('캡처한 화면이 비어 있습니다.');
      logEvent('trip', true, `웹페이지 캡처(증빙): ${trip.seq} · ${got.what}`, { seq: trip.seq, docNo: it.docNo, files: docs.map((d) => d.file.name) });
    } catch (err) {
      docs = [];
      setStatus(`웹페이지를 캡처하지 못했습니다: ${err.message}`, 'error');
      logEvent('trip', false, `웹페이지 캡처(증빙) 실패: ${trip.seq} — ${err.message}`, { seq: trip.seq, docNo: it.docNo });
    } finally {
      Object.assign(a, { busy: false, stage: '' });
      paintList();
    }
    if (!docs.length) return undefined;
    const files = docs.map((d) => d.file);
    const texts = new Map(docs.map((d) => [d.file, d.text]));
    if (where === 'send') {
      const ctx = sendCtx(it);
      await (ctx.read ? ctx.read(files, { texts }) : sendBox.add(ctx, files));
    } else {
      await runAfter(trip.seq, files, { texts });
    }
    // 너무 길어 앞부분만 찍은 페이지와 못 찍은 탭은 읽은 뒤의 상태 줄 끝에 덧붙인다.
    if (got.notes.length) setStatus([el.status.textContent, ...got.notes].filter(Boolean).join(' — '), el.status.classList.contains('error') ? 'error' : '');
    return undefined;
  }

  /**
   * 사전정산을 완료(확정)한다 — 계산서 화면의 확정 버튼과 같은 요청이다(src/trip.js 의 tripPreConfirm). 사후정산을 올리거나 증빙을
   * 담당자에게 보내려면 사전정산이 완료돼 있어야 해서(2026-10-03 사용자 지정), 출장 카드의 `사전정산 완료` 버튼과 증빙을 넣었을 때
   * 여기로 온다. 끝나면 다시 읽은 그 계산서 줄로 카드의 단계를 맞추고(freshTrip), 그 줄을 돌려준다. 못 했으면 던진다.
   */
  async function confirmPre(trip, onStage = setStatus) {
    try {
      const r = await tripPreConfirm(trip, { name: st.trips?.me || '', onStage });
      logEvent('trip', true, r.sent ? `여비계산서 사전정산 완료(확정): ${trip.seq}` : `여비계산서 사전정산이 이미 완료돼 있음: ${trip.seq}`, { seq: trip.seq, sent: r.sent });
      await freshTrip(r.row);
      return r.row;
    } catch (err) {
      logEvent('trip', false, `여비계산서 사전정산 완료(확정) 실패: ${trip.seq} — ${err.message}`, { seq: trip.seq, auth: err instanceof AuthError });
      throw err;
    }
  }

  /** 출장 카드의 `사전정산 완료` 버튼(두 번째 누름). 되는 동안 카드가 잠기고, 결과는 카드와 상태 줄에 적힌다. */
  async function runPreConfirm(it) {
    const trip = tripOf(it);
    if (!trip) return;
    const a = st.after[trip.seq] || (st.after[trip.seq] = {});
    if (a.busy) return;
    Object.assign(a, { busy: true, error: '', info: '', result: null, stage: '사전정산을 완료(확정)하는 중...' });
    paintList();
    try {
      await confirmPre(trip, (s) => { a.stage = s; paintList(); });
      a.info = '사전정산을 완료(확정)했습니다';
      setStatus(`사전정산을 완료(확정)했습니다 — 여비계산서 ${trip.seq} · ${it.summary}`);
    } catch (err) {
      a.error = `사전정산 완료 실패: ${err.message}`;
      setError(err, '사전정산 완료 실패');
    } finally {
      a.busy = false;
      a.stage = '';
      paintList();
    }
  }

  /**
   * 사후정산을 지금 카드에 있는 대로 저장한다(2026-10-03 사용자 지정) — 여비증빙 송부 칸의 `보내기`(저장 → 확정 → 송부)가 부른다.
   * 증빙으로 읽은 숙박 줄은 넣을 때 이미 올라가 있다. 여기서는 가는 편·오는 편을 바꿨으면(또는 이 패널에서 항공권을 넣었으면) 그것을
   * 교통비·항공 내역으로 올리고, 새로 올릴 것이 없어도 입력 화면의 폼을 그대로 저장한다(화면의 `저장` 버튼과 같다) — 단계가
   * "사후정산 작성"이 돼야 확정할 수 있다. 값을 모르는 편이 있으면(항공권을 다시 넣어야 하는 편 등) 교통비 내역은 화면에 있는 그대로
   * 둔다 — 아는 편만 올리면 화면에 있던 줄이 지워진다. 저장한 뒤 다시 읽은 계산서 줄을 돌려준다. 못 했으면 던진다.
   */
  async function saveAfter(it, onStage = () => {}) {
    const trip = tripOf(it);
    if (!trip) throw new Error('여비계산서를 찾지 못했습니다. 신청 내역을 새로 읽어 주세요.');
    const a = st.after[trip.seq] || (st.after[trip.seq] = {});
    if (a.busy) throw new Error('사후정산 칸이 다른 일을 하는 중입니다. 끝난 뒤에 다시 눌러 주세요.');
    if (a.ask) throw new Error('사후정산 칸에서 정산금액을 먼저 정해 주세요.');
    const say = (s) => { a.stage = s; onStage(s); };
    Object.assign(a, { busy: true, error: '', info: '', stage: '사후정산을 저장하는 중...' });
    try {
      if (!a.detail) a.detail = await tripPreDetail(trip.seq);
      const plan = afterPlan(a.tickets || [], { trip, detail: a.detail, picks: st.legs[it.docNo] || {}, workplace: st.workplace });
      if (plan.problems.length) throw new Error(plan.problems.join(' · '));
      if (!plan.need.needed) throw new Error('당일 출장이고 비행기를 타지 않아 사후정산 대상이 아닙니다.');
      const unknown = plan.legs.filter((l) => l.pick?.t && !l.row);
      if (unknown.length) plan.trans = [];
      plan.docs = [];
      const r = await tripAfterSave(trip, trseqOf(trip), plan, { name: st.trips?.me || '', onStage: say, always: true });
      a.result = { ...plan, saved: true, same: r.same, lodgeRows: r.lodgeRows, stage: r.stage };
      if (unknown.length) a.info = `교통비 내역은 사후정산 화면에 있는 그대로 두었습니다 — ${unknown.map((l) => `${l.label}: ${l.problem}`).join(' · ')}`;
      const what = afterSummary(plan) || '화면에 있는 그대로';
      setStatus(`사후정산을 저장했습니다 — ${what}`);
      logEvent('trip', true, `여비계산서(사후정산) 저장: ${trip.seq} · ${what}`, { seq: trip.seq, notes: plan.notes });
      await freshTrip(r.row);
      return r.row;
    } catch (err) {
      logEvent('trip', false, `여비계산서(사후정산) 저장 실패: ${trip.seq} — ${err.message}`, { seq: trip.seq, auth: err instanceof AuthError });
      throw err;
    } finally {
      a.busy = false;
      a.stage = '';
      paintList();
    }
  }

  /**
   * 사후정산을 완료(확정)한다 — 계산서 화면의 확정과 같은 요청이다(src/trip.js 의 tripPostConfirm). 여비증빙 송부 칸의 `보내기`가 사후정산을
   * 저장한 뒤에 부른다. 끝나면 다시 읽은 그 계산서 줄로 카드의 단계를 맞추고(freshTrip), 그 줄을 돌려준다. 못 했으면 던진다.
   */
  async function confirmPost(it, onStage = () => {}) {
    const trip = tripOf(it);
    if (!trip) throw new Error('여비계산서를 찾지 못했습니다. 신청 내역을 새로 읽어 주세요.');
    try {
      const r = await tripPostConfirm(trip, { name: st.trips?.me || '', onStage });
      logEvent('trip', true, r.sent ? `여비계산서 사후정산 완료(확정): ${trip.seq}` : `여비계산서 사후정산이 이미 완료돼 있음: ${trip.seq}`, { seq: trip.seq, sent: r.sent });
      // 다시 작성하던 사후정산이 다시 완료됐다 — 카드는 정산 내역(보기)으로 돌아간다.
      if (st.after[trip.seq]) st.after[trip.seq].reopen = false;
      await freshTrip(r.row);
      return r.row;
    } catch (err) {
      logEvent('trip', false, `여비계산서 사후정산 완료(확정) 실패: ${trip.seq} — ${err.message}`, { seq: trip.seq, auth: err instanceof AuthError });
      throw err;
    }
  }

  /**
   * 사후정산 — 증빙(숙박 영수증·예약서·항공권)을 받는 즉시 읽어 묶고 올린다(2026-10-03 사용자 지정).
   * 사전정산을 아직 완료(확정)하지 않은 출장이면, 쓸 수 있는 증빙이 들어왔을 때 확정부터 하고 이어 간다.
   * 항공권은 그 날짜·시각의 가는 편·오는 편에 앉아 그 편을 비행기로 바꾼다(항공권이 한 편뿐이면 나머지 편은 KTX 정가).
   * 읽지 못한 필수 값이 있으면 올리지 않고 무엇이 비었는지 카드에 적는다. 올린 뒤에는 다시 읽은 그 계산서 줄로 단계를 맞춘다(freshTrip).
   * fileList 가 비었으면 증빙 없이 바꾼 가는 편·오는 편만 올린다("바꾼 교통편을 사후정산에 올리기").
   * given 은 홈의 WORKSPACE 카드에서 읽어 보관해 둔 증빙이다(todoOf) — 다시 읽지 않고 그때 읽은 기록으로 묶어 올린다.
   * 사후정산을 이미 완료한 출장에 넣은 증빙도 읽는다(amend, 2026-10-05 사용자 지정) — 숙박 증빙·항공권이면 완료한 사후정산을 다시
   * 작성하는 것으로 보고 올리고(카드에 사후정산 칸이 다시 선다), 아니면 보낼 증빙으로 담기만 한다.
   */
  async function runAfter(seq, fileList, { given = [], texts = null } = {}) {
    const it = st.items.find((x) => isTrip(x) && tripOf(x)?.seq === seq);
    const trip = it ? tripOf(it) : null;
    if (!trip) return;
    const a = st.after[seq] || (st.after[seq] = {});
    if (a.busy) return;
    // 접힌 줄에 놓았으면 그 줄을 편다 — 무엇이 읽히고 올라가는지 거기에 적힌다.
    if (st.openDoc !== it.docNo) {
      disarm();
      st.openDoc = it.docNo;
      st.cancelFor = null;
      st.cancelThen = null;
      paintList();
    }
    const stage = tripStage(trip, st.trips?.me);
    const { apiKey, cli } = ai();
    // 사후정산이 완료된 출장에 넣은 파일(여비증빙 송부 칸의 "증빙 넣기", 끌어다 놓기, 붙여넣기)도 읽는다 — 숙박 증빙·항공권이면 완료한
    // 사후정산을 다시 작성하는 것으로 보고 사후정산에 다시 올리고(amend), 그 밖의 문서는 보낼 증빙으로 담기만 한다(2026-10-05 사용자 지정:
    // "사후정산을 완료 후 보낸 후 증빙을 첨부나 복사하기나 추가 하면 다시 사후정산을 업데이트 … 할 수 있도록"). 그 전에는 읽지 않고
    // 보관함에 담기만 했다 — 지금도 읽을 길이 없으면(Claude 가 연결되지 않았다) 그렇게 한다.
    // `사후정산 다시하기`를 눌러 둔 출장이면(a.reopen) 완료하기 전과 똑같이 읽어서 올린다.
    const amend = stage.phase === 'post' && stage.done && !a.reopen;
    if (amend && (!(apiKey || cli) || !fileList?.length)) return sendBox.add(sendCtx(it), [...(fileList || [])]);
    // 증빙이 들어왔으면 사전정산을 다시 작성하던 칸은 접는다 — 읽고 올리는 것이 사후정산 칸에 적힌다.
    a.redoPre = false;
    if (!a.detail) {
      // 줄을 펴자마자 놓았으면 조건(사전정산의 교통편)을 아직 못 읽었다. 여기서 기다린다.
      a.loading = true;
      try {
        a.detail = await tripPreDetail(seq);
      } catch (err) {
        a.detailError = err.message;
        return setError(err, '사전정산의 교통편을 읽지 못했습니다');
      } finally {
        a.loading = false;
        paintList();
      }
    }
    const files = [];
    // 붙여 넣은 그림은 이름이 모두 image.png 다. 보관함의 열쇠가 파일 이름이라, 내용이 다른 그림이 같은 이름으로 오면 앞에 보관한
    // 증빙을 덮어쓴다(2026-10-03 실제로 예약서가 화면 캡처로 바뀌어 있었다) — 내용이 다르면 이름에 번호를 붙인다.
    let kept = [];
    try {
      if (fileList?.length) kept = await evidence.list(it.docNo);
    } catch { /* 보관함을 못 읽어도 증빙은 읽는다 */ }
    const nameFor = (name, dataUrl) => {
      const taken = (n) => [...kept, ...files].some((k) => k.name === n && k.dataUrl !== dataUrl);
      if (!taken(name)) return name;
      const dot = name.lastIndexOf('.');
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      let i = 2;
      while (taken(`${stem} (${i})${ext}`)) i++;
      return `${stem} (${i})${ext}`;
    };
    // 웹페이지를 캡처한 PDF 는 그 화면의 글자가 같이 온다(texts — captureFor) — 읽을 때 같이 준다(보관함에는 넣지 않는다).
    const pageText = new Map();
    for (const f of fileList || []) {
      if (!acceptsFile(EVIDENCE_ACCEPT, f)) { setStatus(`${f.name} 은 이미지나 PDF 가 아니라 뺐습니다.`, 'error'); continue; }
      if (f.size > FILE_LIMIT) { setStatus(`${f.name} 이 너무 큽니다(${Math.round(f.size / 1048576)}MB). 10MB 이하로 넣어 주세요.`, 'error'); continue; }
      try {
        const dataUrl = await readFile(f);
        const one = { name: nameFor(f.name, dataUrl), type: f.type, dataUrl };
        files.push(one);
        if (texts?.get(f)) pageText.set(one, texts.get(f));
      } catch (err) {
        setStatus(err.message, 'error');
      }
    }
    if (!files.length && fileList?.length) return;
    const fileNames = [...given.map((k) => k.name), ...files.map((f) => f.name)];
    Object.assign(a, { busy: true, error: '', info: '', warn: '', result: null,
      stage: files.length ? `증빙 ${files.length}장을 읽는 중...` : given.length ? `보관해 둔 증빙 ${given.length}장을 묶는 중...` : '가는 편·오는 편을 묶는 중...' });
    paintList();
    const onStage = (s) => { a.stage = s; paintList(); };
    // 사후정산을 올리거나 증빙을 담당자에게 보내려면 사전정산이 완료(확정)돼 있어야 한다(2026-10-03 사용자 지정) — 아직이면 확장이
    // 확정한다. row 는 지금의 계산서 줄이다: 확정하면 목록을 다시 읽은 줄로 바뀐다(출장자 번호가 그때 생긴다).
    let row = trip;
    let failed = '사후정산 실패';
    const ensurePre = async () => {
      const now = tripStage(row, st.trips?.me);
      if (now.phase !== 'pre' || now.done) return false;
      failed = '사전정산 완료 실패';
      row = await confirmPre(row, onStage);
      failed = '사후정산 실패';
      return true;
    };
    try {
      const records = given.map((k) => ({ ...k.record, file: { name: k.name, type: k.type, dataUrl: k.dataUrl } }));
      // 여러 장이면 나란히 읽힌다(2026-10-05 사용자 지정 — 한 장에 6~8초라 차례로 읽으면 장 수만큼 걸렸다). 한꺼번에 도는 수는
      // 묶여 있고(src/pool.js), 묶는 차례는 넣은 차례 그대로다. 한 장이라도 못 읽으면 전처럼 아무것도 올리지 않는다.
      const who = { trip, me: st.trips?.me || st.me?.name || '' };
      let read = 0;
      if (files.length === 1) onStage(`증빙을 읽는 중 (1/1) — ${files[0].name}`);
      records.push(...await mapPool(files, READ_POOL, async (f) => {
        const r = await receiptSmart(f, { ...who, text: pageText.get(f) || '' }, { apiKey, useNative: cli });
        if (++read < files.length) onStage(`증빙 ${files.length}장을 읽는 중 (${read}/${files.length})`);
        return { ...r.record, file: f };
      }));
      // 이 패널을 연 동안 앞서 넣은 항공권은 그 편에 그대로 앉아 있어야 한다 — 같이 묶는다(같은 파일을 다시 넣었으면 새것만 쓴다).
      const isTicket = (r) => /^flight_/.test(r.docType);
      // 물어 둔 채 아직 올리지 못한 숙박 증빙(a.ask)도 같이 묶는다 — 새 증빙을 넣었다고 그것이 사라지면 안 된다.
      const earlier = [...(a.tickets || []), ...(a.ask?.records || [])];
      const all = [...records, ...earlier.filter((t) => !records.some((r) => r.file.name === t.file.name))];
      const plan = afterPlan(all, { trip, detail: a.detail, picks: st.legs[it.docNo] || {}, workplace: st.workplace });
      a.ask = null;
      plan.docs = records.map((r) => ({ ...evidenceOf(r, trip), name: r.file.name, summary: r.summary || '' }));
      a.result = plan;
      a.seats = plan.seats;
      // 출장 기간의 것이 아닌 항공권은 편에 앉히지 않는다(afterPlan 이 뺀다) — 다음에 같이 묶을 것으로도 쥐고 있지 않는다.
      a.tickets = all.filter((r) => isTicket(r) && !evidenceOf(r, trip).warn);
      setLegs(it.docNo, plan.picks);
      // 증빙으로 쓸 수 있는 것(출장지에서 결제한 영수증·항공권·숙박 영수증)은 보관함에 담아 둔다 — 담당자에게 보낼 때 같이 간다.
      // 사후정산을 올리든 못 올리든 담는다. 숙박 영수증은 사후정산에 첨부로도 올라가지만, 담당자에게 보낼 묶음에도 들어가야 한다.
      const keep = records.filter((r) => evidenceOf(r, trip).ok);
      if (keep.length) {
        try {
          await evidence.keep(it.docNo, keep.map((r) => ({
            name: r.file.name, type: r.file.type, dataUrl: r.file.dataUrl, label: evidenceOf(r, trip).label, summary: r.summary || '',
            date: r.payDate || r.flightDate || null, total: r.total ?? null, trip: { seq: trip.seq, from: trip.from, to: trip.to, location: trip.location },
          })));
          a.info = `증빙 ${keep.length}장을 보관했습니다(${keep.map((r) => r.file.name).join(' · ')}) — 담당자에게 보낼 때 같이 갑니다`;
        } catch (err) {
          a.info = `증빙을 보관하지 못했습니다: ${err.message}`;
        }
        await loadKept(it.docNo, a);
        // 쓸 수 있는 증빙이 들어왔다 — 다녀온 출장이다. 이 증빙을 보내거나 사후정산을 올리려면 사전정산이 완료돼 있어야 한다.
        if (await ensurePre()) a.info = `사전정산을 완료(확정)했습니다 · ${a.info}`;
      }
      // 출장 기간의 것이 아닌 문서(2026-10-05 사용자 지정: "출장 기간동안의 내용이 아니면 알림을 줘 안맞다고, 맞는것만 선별취급 해서 올리고
      // 해당 없는거는 문서보관에 알림표지 하고 확정 해주기 전까지는 보내기 해도 같이 보내지 말고") — 안 맞다고 알리고, 올리지 않고
      // 알림 표시(warn)를 붙여 보관한다. 읽은 기록을 같이 둔다 — 보관 중인 증빙에서 `확정`하면 그 기록으로 올린다.
      const off = records.filter((r) => evidenceOf(r, trip).warn);
      if (off.length) {
        const why = off.map((r) => `${r.file.name}: ${evidenceOf(r, trip).warn}`).join(' · ');
        try {
          await evidence.keep(it.docNo, off.map(({ file, ...record }) => ({
            name: file.name, type: file.type, dataUrl: file.dataUrl, label: evidenceOf(record, trip).label, summary: record.summary || '',
            date: record.payDate || record.flightDate || null, total: record.total ?? null, trip: { seq: trip.seq, from: trip.from, to: trip.to, location: trip.location },
            warn: evidenceOf(record, trip).warn, record,
          })));
          a.warn = `출장 기간과 맞지 않는 증빙 ${off.length}장은 올리지 않고 알림 표시로 보관했습니다 — ${why} · 아래 보관 중인 증빙에서 확정하기 전에는 보낼 때도 빠집니다`;
        } catch (err) {
          a.warn = `출장 기간과 맞지 않는 증빙 ${off.length}장은 올리지 않았습니다 — ${why} · 보관하지도 못했습니다: ${err.message}`;
        }
        await loadKept(it.docNo, a);
        setStatus(`출장 기간과 맞지 않는 증빙이 있습니다 — ${why}`, 'error');
      }
      if (amend) {
        // 완료한 출장에 넣은 것은 그 증명으로 못 쓴다고 읽힌 문서(기차표·모르는 문서 …)도 보낼 증빙으로 담는다 — 읽지 않고 담던 자리다.
        const rest = records.filter((r) => !evidenceOf(r, trip).ok && !evidenceOf(r, trip).warn);
        if (rest.length) {
          try {
            await evidence.keep(it.docNo, rest.map((r) => ({
              name: r.file.name, type: r.file.type, dataUrl: r.file.dataUrl, label: '증빙', summary: r.summary || '', date: null, total: null,
              trip: { seq: trip.seq, from: trip.from, to: trip.to, location: trip.location },
            })));
          } catch (err) {
            a.error = `증빙을 보관하지 못했습니다: ${err.message}`;
          }
          await loadKept(it.docNo, a);
        }
        // 사후정산에 올릴 것(이 출장의 숙박 증빙·항공권)이 없으면 여기까지다 — 끝난 정산은 건드리지 않고, 카드는 정산 내역 그대로다.
        if (!records.some((r) => needsAfter(r) && evidenceOf(r, trip).ok)) {
          a.result = null;
          const names = [...keep, ...rest].map((r) => r.file.name);
          if (names.length && !a.error) {
            a.info = `증빙 ${names.length}장을 보관했습니다(${names.join(' · ')}) — 숙박 증빙·항공권이 아니어서 사후정산은 그대로 두었습니다`;
            if (!off.length) setStatus(a.info);
          }
          return;
        }
        // 완료한 사후정산을 다시 작성한다 — 아래가 완료하기 전과 같이 묶어 올리고, 카드에는 사후정산 칸이 다시 선다(`사후정산 다시하기`를
        // 누른 것과 같다). 올린 뒤에는 여비증빙 송부 칸의 `다시 보내기`가 저장 → 확정 → 송부를 잇는다.
        a.reopen = true;
      }
      if (plan.problems.length) { a.error = `올리지 않았습니다 — ${plan.problems.join(' · ')}`; return; }
      // 당일 출장이고 비행기를 타지 않았으면 사후정산은 없다. 증빙을 보관했으면 그것으로 할 일은 끝났다(잘못이 아니다).
      if (!plan.need.needed) {
        if (keep.length) a.info += ' · 당일 출장이고 비행기를 타지 않아 사후정산은 올리지 않습니다';
        else if (!off.length) a.error = '올리지 않았습니다 — 당일 출장이고 비행기를 타지 않아 사후정산 대상이 아닙니다.';
        return;
      }
      // 이번에 넣은 것에서 나온 내역이 없으면 보내지 않는다 — 앞서 넣은 항공권의 교통 줄만 되풀이해 올리지 않게.
      const fresh = !files.length || plan.lodge.length > 0 || records.some((r) => isTicket(r) && !off.includes(r));
      if (!fresh || (!plan.lodge.length && !plan.trans.length)) {
        if (!keep.length && !off.length) a.error = `넣을 내역이 없어 올리지 않았습니다 — ${plan.skipped[0] || plan.notes[0] || '숙박 증빙이나 항공권이 아닙니다'}`;
        return;
      }
      await ensurePre();
      // 숙박 줄의 정산금액을 정한다(2026-10-03 사용자 지정). 사이트에서 상한액을 읽어 붙이고, 사람이 정해 줘야 하는 것(외화 문서의
      // 원화 금액, 상한액 초과)이 있으면 올리지 않고 카드에서 묻는다 — 답하면 answerAsk 가 이어서 올린다.
      if (plan.lodge.length) onStage('숙박비 상한액을 확인하는 중...');
      for (const l of plan.lodge) lodgeSettle(Object.assign(l, await tripLodgeMax(trseqOf(row), l.nation, l.currency)));
      // 이미 사후정산에 올라가 있는 숙박 줄은 상한액을 넘어도 다시 묻지 않는다(2026-10-05 사용자 지정: "이게 확인이 안되나? 출장이랑 맞잖아") —
      // 화면의 숙박 줄을 읽어 같은 줄이 있으면 그 금액으로 정한다. 그러면 아래에서 같은 줄로 걸러져 다시 올라가지 않는다.
      if (plan.lodge.some((l) => lodgeAsk(l) === 'cap')) {
        const have = await tripAfterLodges(row.seq, trseqOf(row)).catch(() => []);
        for (const l of plan.lodge) {
          const how = lodgeAsk(l) === 'cap' ? lodgeKnown(l, have) : '';
          if (how) lodgeDecide(plan, l, how);
        }
      }
      if (plan.lodge.some(lodgeAsk)) {
        a.ask = { plan, row, records: all.filter((r) => /^lodging_/.test(r.docType)), files: fileNames, krw: {} };
        setStatus('사후정산을 아직 올리지 않았습니다 — 출장 카드에서 정산금액을 정해 주세요');
        return;
      }
      await sendAfter(it, trip, a, plan, row, fileNames, onStage);
      // 완료한 출장에 넣은 증빙인데 같은 줄이 이미 있어 아무것도 올리지 않았으면, 다시 작성하는 것으로 치지 않는다 — 정산 내역 그대로다.
      if (amend && a.result && !a.result.saved) Object.assign(a, { reopen: false, result: null, info: '같은 숙박 줄이 사후정산에 이미 있어 다시 올리지 않았습니다 — 증빙은 보관했습니다' });
    } catch (err) {
      a.error = failed === '사후정산 실패' ? err.message : `${failed}: ${err.message}`;
      setError(err, failed);
      // 사전정산 완료가 실패한 것은 confirmPre 가 이미 기록했다.
      if (failed === '사후정산 실패') logEvent('trip', false, `여비계산서(사후정산) 실패: ${trip.seq} — ${err.message}`, { seq: trip.seq, files: fileNames });
    } finally {
      a.busy = false;
      a.stage = '';
      paintList();
    }
  }

  /**
   * 묶은 사후정산을 올리고 무엇이 올라갔는지 카드에 적는다 — runAfter 와, 물은 것에 답했을 때의 answerAsk 가 같이 쓴다.
   * 같은 숙박 줄이 사이트에 이미 있으면 그 줄은 다시 올라가지 않는다(src/trip.js tripAfterSave 의 same). 못 올리면 던진다.
   */
  async function sendAfter(it, trip, a, plan, row, fileNames, onStage) {
    const r = await tripAfterSave(row, trseqOf(row), plan, { name: st.trips?.me || '', onStage });
    a.ask = null;
    a.result = { ...plan, saved: r.sent, same: r.same, lodgeRows: r.lodgeRows, stage: r.stage };
    if (!r.sent) {
      setStatus('같은 숙박 줄이 사후정산에 이미 있어 다시 올리지 않았습니다');
      return;
    }
    const sent = { ...plan, lodge: plan.lodge.filter((l) => !r.same.includes(l)) };
    rememberMine(trip.seq, r.lodgeRows, plan);
    setStatus(`사후정산을 올렸습니다 — ${afterSummary(sent)}`);
    logEvent('trip', true, `여비계산서(사후정산) 작성: ${trip.seq} · ${afterSummary(sent)}`, { seq: trip.seq, files: fileNames, notes: plan.notes, skipped: plan.skipped, lodgeSeqs: r.lodgeSeqs });
    await freshTrip(r.row);
    await lodgeBox.reload(lodgeCtx(r.row || row), { quiet: true });   // 방금 올린 줄이 숙박비 내역에 보이게 다시 읽는다
  }

  /** 지운 숙박 줄의 적어 둔 내용을 버린다 — 지우지 못했으면(그 줄이 아직 있으면) 둔다. */
  function forgetInfo(seq, lodgeSeq) {
    if (!st.lodgeInfo[seq]?.[lodgeSeq] || lodgeBox.state.by[seq]?.rows?.some((r) => r.seq === String(lodgeSeq))) return;
    const { [lodgeSeq]: _gone, ...left } = st.lodgeInfo[seq];
    st.lodgeInfo = { ...st.lodgeInfo, [seq]: left };
    if (st.lodgeOpen[seq] === String(lodgeSeq)) st.lodgeOpen[seq] = '';
    chrome.storage.local.set({ attendLodgeInfo: st.lodgeInfo });
  }

  /**
   * `상한` 버튼으로 그 줄의 정산금액을 바꿨다(lodgebox.js 의 toggleCap) — 올린 내용(펴 보는 것)의 정산금액·공급가액·부가세를 바꾼 값으로
   * 맞춘다(lodgeCells 와 같은 말이 되게 같은 길로 짓는다). 적어 둔 줄의 정산금액도 맞춰 화면의 줄과 같은 줄로 알아본다(lodgeSame).
   * @param {object} l 정한 줄(src/after.js lodgeSettle 의 결과 — actual·maxconv·sday·settle·total·samount·vat·capped·vatFrom)
   */
  function patchLodgeInfo(seq, lodgeSeq, l) {
    const info = st.lodgeInfo[seq]?.[lodgeSeq];
    if (!info?.row || !Array.isArray(info.cells)) return;
    const fresh = Object.fromEntries(lodgeCells({ ...l, company: info.row.company, paydate: info.row.paydate, sources: [] }).filter(([k]) => ['정산금액', '공급가액', '부가세'].includes(k)));
    const cells = info.cells.map(([k, v]) => [k, fresh[k] ?? v]);
    st.lodgeInfo = { ...st.lodgeInfo, [seq]: { ...st.lodgeInfo[seq], [lodgeSeq]: { ...info, row: { ...info.row, total: l.total }, cells } } };
    chrome.storage.local.set({ attendLodgeInfo: st.lodgeInfo });
  }

  /**
   * 이 패널이 올린 숙박 줄을 적어 둔다(줄 번호 → 증빙 파일 이름). 저장소에도 남겨 패널을 다시 열어도 손수 적은 줄과 가려진다.
   * 실제 금액(과 문서의 공급가액·부가세)도 적어 둔다 — 숙박비 내역의 `상한` 버튼이 상한액에서 실제 금액으로 되돌릴 때 쓴다(lodgebox.js).
   */
  function rememberMine(seq, lodgeRows, plan) {
    if (!lodgeRows.length) return;
    const mine = { ...st.lodgeMine[seq] };
    const info = { ...st.lodgeInfo[seq] };
    for (const h of lodgeRows) {
      const l = plan.lodge.find((x) => lodgeSame(x, h));
      mine[h.seq] = l?.sources.join(' · ') || '';
      // 올린 내용 — 숙박비 내역에서 그 줄의 `증빙`을 누르면 펴 보인다(lodgeInfoHtml). 글로 적어 두어 패널을 다시 열어도 그대로 보인다.
      if (l) {
        info[h.seq] = {
          row: { paydate: l.paydate, company: l.company, sday: l.sday, total: l.total }, cells: lodgeCells(l, h),
          docs: (plan.docs || []).filter((d) => l.sources.includes(d.name)).map(docLine), notes: [...(l.notes || [])],
        };
        const krw = l.doc?.currency === 'KRW';
        if (l.actual != null) lodgeBox.noteActual(seq, h.seq, { actual: l.actual, supply: krw ? l.doc.supply ?? null : null, vat: krw ? l.doc.vat ?? null : null });
      }
    }
    st.lodgeMine = { ...st.lodgeMine, [seq]: mine };
    st.lodgeInfo = { ...st.lodgeInfo, [seq]: info };
    chrome.storage.local.set({ attendLodgeMine: st.lodgeMine, attendLodgeInfo: st.lodgeInfo });
  }

  /**
   * 카드에서 물은 것(askHtml)에 답했다 — 그 숙박 줄의 정산금액을 정하고, 더 물을 것이 없으면 올린다.
   *   ask-krw  적어 준 원화 금액이 실제 금액이다        ask-cap / ask-real  상한액 / 실제 금액으로 정산한다
   *   ask-drop 올리지 않는다(읽은 증빙은 보관함에 그대로 있다)
   */
  async function answerAsk(it, btn) {
    const trip = tripOf(it);
    const a = trip ? st.after[trip.seq] : null;
    const ask = a?.ask;
    if (!ask || a.busy) return;
    const act = btn.dataset.act;
    if (act === 'ask-drop') {
      Object.assign(a, { ask: null, result: null, error: '' });
      setStatus('사후정산을 올리지 않았습니다 — 읽은 증빙은 보관함에 있습니다');
      paintList();
      return;
    }
    const l = ask.plan.lodge[+btn.dataset.i];
    if (!l) return;
    if (act === 'ask-krw') {
      const typed = String(el.list.querySelector(`.at-ask-krw[data-i="${btn.dataset.i}"]`)?.value ?? ask.krw[btn.dataset.i] ?? '').trim();
      const n = Number(typed.replace(/[,\s원]/g, ''));
      if (!typed || !Number.isFinite(n) || n <= 0) { setStatus('원화로 결제된 금액을 숫자로 적어 주세요.', 'error'); return; }
      l.actual = Math.round(n);
      lodgeSettle(l);
    } else {
      // 실제 금액으로 정산하면 승인이 필요하다는 알림이 그 줄과 결과 글에 붙는다(src/after.js lodgeDecide).
      lodgeDecide(ask.plan, l, act === 'ask-cap' ? 'cap' : 'real');
    }
    if (ask.plan.lodge.some(lodgeAsk)) {
      setStatus('사후정산을 아직 올리지 않았습니다 — 출장 카드에서 정산금액을 정해 주세요');
      paintList();
      return;
    }
    Object.assign(a, { busy: true, error: '', stage: '여비계산서(사후정산)를 올리는 중...' });
    paintList();
    try {
      await sendAfter(it, trip, a, ask.plan, ask.row, ask.files, (s) => { a.stage = s; paintList(); });
    } catch (err) {
      a.error = err.message;
      setError(err, '사후정산 실패');
      logEvent('trip', false, `여비계산서(사후정산) 실패: ${trip.seq} — ${err.message}`, { seq: trip.seq, files: ask.files });
    } finally {
      a.busy = false;
      a.stage = '';
      paintList();
    }
  }

  const daysAgo = (today, n) => {
    const [y, m, d] = today.split('-').map(Number);
    const x = new Date(y, m - 1, d - n);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };

  /**
   * 다녀온 출장의 정산이 끝났는가를 가리는 함수(src/settling.js) — 증빙을 보낸 기록(송부 칸)과 여비계산서의 단계로 본다.
   * 단계는 방금 읽은 목록을 먼저 쓰고, 아직 못 읽었으면 저장소에 담아 둔 것을 쓴다.
   */
  const settledNow = () => settledBy({ sent: sendBox.state.done, stages: st.trips?.rows ? st.trips : st.stages });

  /**
   * HR 에서 읽은 것(st.all)에서 보여줄 건을 고른다. 기간을 정했으면 근태 날짜가 그 기간에 걸친 것이고, 기본 보기면
   * 오늘부터의 것 전부와 정산이 덜 끝난 다녀온 출장이다(itemsToShow). 펴 둔 줄은 정산이 끝났어도 남긴다.
   */
  function pickItems() {
    st.items = st.range ? itemsIn(st.all, st.range.from, st.range.to)
      : itemsToShow(st.all, attendToday(), { backDays: st.back * 7, settled: settledNow(), keep: st.openDoc });
  }

  /** 여비계산서 목록이나 보낸 기록을 나중에 읽어 정산이 끝난 것으로 드러난 다녀온 출장을 기본 보기에서 뺀다. */
  function pruneSettled() {
    if (!st.range) st.items = dropSettled(st.items, attendToday(), { settled: settledNow(), keep: st.openDoc });
  }

  /**
   * 여비계산서 목록을 읽을 기간(출장기간 기준). 기간을 정했으면 그 기간이고, 기본 보기면 다녀온 출장을 볼 수 있는 가장 먼 날
   * (8주 전)부터 올려 둔 출장 가운데 가장 늦게 끝나는 날까지다. 어느 쪽이든 **보이는 출장 줄의 출장기간은 다 덮게** 넓힌다
   * (rangeCovering) — 4W 로 9/10 부터 보면 9/9~9/10 출장도 목록에 서는데, 계산서는 출장기간으로 찾으므로 9/9 부터 읽어야 그 계산서가
   * 잡힌다(2026-10-08 사용자 보고: 그 줄이 "조회 기간이 이 출장기간을 다 덮지 않습니다"라고만 했다). 머리 줄의 기간 글·날짜 칸은 그대로다.
   */
  function tripRange() {
    const today = attendToday();
    const ends = st.all.filter(isTrip).map((it) => it.to || it.from).filter(Boolean);
    const base = st.range ? { from: st.range.from, to: st.range.to }
      : { from: daysAgo(today, BACK_MAX_DAYS), to: ends.reduce((a, b) => (a > b ? a : b), today) };
    return rangeCovering(base, st.items);
  }

  /**
   * 기본 보기의 기간(2026-10-04 사용자 지정) — 다녀온 출장을 보는 가장 먼 날(고른 4주·8주 전, 안 보면 오늘)부터
   * **근태를 올려 둔 가장 늦은 날**까지다. 앞으로 잡힌 것이 없으면 오늘에서 끝난다.
   */
  function defaultRange(weeks = st.back) {
    const today = attendToday();
    const last = st.all.map((it) => it.to || it.from).filter(Boolean).reduce((a, b) => (a > b ? a : b), today);
    return { from: daysAgo(today, weeks * 7), to: last };
  }

  /** 4주·8주를 눌러 조회하는 기간 — 그만큼 전부터 근태를 올려 둔 가장 늦은 날까지다. weeks 로 어느 버튼의 것인지 안다. */
  const weekRange = (weeks) => ({ ...defaultRange(weeks), weeks });

  /** 신청 내역 제목 줄의 4W·8W 버튼(달력 버튼 왼쪽 — sidepanel.html). */
  const backButtons = () => [...(el.rangeBtn.parentElement?.querySelectorAll('button[data-back]') || [])];

  function paintRange() {
    const custom = !!st.range;
    const weeks = st.range?.weeks || 0;
    const r = st.range || defaultRange();
    el.range.textContent = spanText(r.from, r.to, attendToday());
    el.rangeHint.textContent = weeks ? `근태 날짜 기준 · ${weeks}주 전부터 전부` : custom ? '근태 날짜 기준 · 기간 지정'
      : st.back ? `오늘부터 전부 · 정산 중인 출장은 다녀온 뒤 ${st.back}주까지` : '오늘부터 전부';
    el.rangeFrom.value = r.from;
    el.rangeTo.value = r.to;
    // 달력 버튼은 날짜를 직접 정해 조회하는 중일 때 켜진다 — 4W·8W 로 조회하는 중이면 그 버튼이 켜진다.
    el.rangeBtn.classList.toggle('active', custom && !weeks);
    // 4W·8W(제목 줄 — 2026-10-05 사용자 지정)는 그 버튼으로 조회하고 있을 때만 켜져 있다 — 기본 보기와 날짜를 직접 적은 조회에서는 둘 다 꺼져 있다.
    for (const b of backButtons()) {
      const on = Number(b.dataset.back) === weeks;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  /**
   * 4주·8주를 누르면 **그만큼 전부터 근태를 올려 둔 가장 늦은 날까지를 곧바로 조회한다**(2026-10-04 사용자 지정 — 날짜 칸을 채우고
   * 조회를 누른 것과 같다: 그 기간의 것 전부). 켜져 있는 것을 다시 누르면 기본 보기로 돌아온다. 고른 주 수는 저장해 둔다 — 기본 보기와
   * 홈의 WORKSPACE 카드·현황이 정산 중인 다녀온 출장을 그 주 수까지 보인다.
   */
  function pickWeeks(weeks) {
    if (st.range?.weeks === weeks) return setRange(null);
    st.back = backWeeksOf(weeks);
    chrome.storage.local.set({ [BACK_KEY]: st.back });
    return setRange(weekRange(st.back));
  }

  /** 기간을 바꿔 다시 읽는다. null 이면 기본 보기(오늘부터 전부 + 정산 중인 다녀온 출장)로 돌아간다. */
  function setRange(range) {
    if (range && !(range.from && range.to && range.from <= range.to)) {
      return setStatus('조회 기간의 시작일이 종료일보다 늦습니다.', 'error');
    }
    st.range = range;
    st.openDoc = null;
    st.cancelFor = null;
    foldForList(!!range);
    paintRange();
    return reload();
  }

  /**
   * 기간을 정해 조회하는 것은 신청 내역을 보려는 것이다 — 그 동안 신청 폼을 접어 목록이 위로 올라오게 한다(2026-10-03 사용자 지정).
   * 기본 보기로 돌아오면 접기 전의 모양으로 되돌린다. 저장소에는 적지 않는다(패널을 다시 열면 사용자가 골라 둔 대로다).
   * 문서를 고치는 중이면 접지 않는다. 그 사이에 사용자가 손수 접거나 편 것은 그대로 둔다(setFold 가 foldedForList 를 끈다).
   */
  function foldForList(on) {
    if (on && st.formOpen && !st.edit) {
      st.foldedForList = true;
      st.formOpen = false;
      paintFold();
    } else if (!on && st.foldedForList) {
      st.foldedForList = false;
      st.formOpen = true;
      paintFold();
    }
  }

  async function fetchList() {
    const today = attendToday();
    // 기본 보기에서 가장 멀리 거슬러 보는 것은 8주 전에 다녀온 출장이다 — 4주와 8주를 오가도 읽는 범위는 같다.
    const from = st.range ? st.range.from : daysAgo(today, BACK_MAX_DAYS);
    // 신청일로 읽는다: 보여줄 기간보다 여섯 달 앞에 신청한 것부터 오늘 신청한 것까지.
    const { rows, user } = await hrListDocs({ from: monthsAgo(from < today ? from : today, LIST_REQUEST_LOOKBACK_MONTHS), to: today }, { onStage: setStatus });
    st.all = listItems(rows);
    // 취소가 결재된(원 문서가 결재완료가 아닌) 기록은 걷는다.
    const kept = pruneCancelling(st.cancelKept, st.all);
    if (Object.keys(kept).length !== Object.keys(st.cancelKept).length) {
      st.cancelKept = kept;
      chrome.storage.local.set({ [CANCELLING_KEY]: kept });
    }
    // 목록의 취소신청서를 원 문서에 잇는다 — 기다리지 않는다(이으면 다시 그린다).
    linkCancels();
    // 4주·8주로 조회하는 중이면 종료일(근태를 올려 둔 가장 늦은 날)을 방금 읽은 것으로 다시 잡는다.
    if (st.range?.weeks) st.range = weekRange(st.range.weeks);
    pickItems();
    st.loadedOnce = true;
    st.authFailed = false;
    st.me = user;
    paintRange();
    return user;
  }

  /** 방금 올린 문서가 목록에 어떤 상태로 올라와 있는지 본다. 성공 여부는 HR 의 말이 아니라 이것으로 판정한다. */
  async function confirmInList(docNo) {
    try {
      await fetchList();
    } catch {
      return null;
    }
    paintList();
    return st.all.find((it) => it.docNo === docNo) || null;
  }

  async function reload() {
    if (st.busy) return;
    disarm();
    el.listWrap.setAttribute('aria-busy', 'true');
    setStatus('신청 내역을 읽는 중...');
    try {
      await fetchList();
      // 다 읽었으면 상태 줄을 비운다 — 빈 상태 줄은 보이지 않는다("이름 · 신청 n건"은 하는 일이 없어 치웠다, 2026-10-03 사용자 지정).
      setStatus('');
      // 출장이 보이면 그 여비계산서가 어느 단계인지도 읽는다.
      if (st.items.some(isTrip)) loadTrips();
    } catch (err) {
      setError(err, '신청 내역을 읽지 못했습니다');
      logEvent('attend-list', false, `신청 내역 조회 실패: ${err.message}`, { auth: err instanceof AuthError, portal: err.portal });
    } finally {
      el.listWrap.setAttribute('aria-busy', 'false');
      paintList();
    }
  }

  /** 목록의 문서를 패널 폼 모양으로 읽는다. 패널이 그리지 못하는 모양이면 던진다. */
  async function readDocForm(it) {
    const doc = await hrGetDoc(it, { onStage: setStatus });
    const form = formFromDoc(it.formId, doc, attendToday());
    if (!form) throw new Error('이 문서는 패널에서 다루는 모양이 아닙니다. HR 에서 열어 주세요.');
    return form;
  }

  /** 읽어 온 폼을 화면에 앉힌다. edit 을 주면 그 문서를 고치고, 아니면 같은 내용의 새 신청서다. */
  function seatForm(form, edit) {
    // 새 신청서에는 올려 둔 첨부가 따라오지 않으므로 다시 붙이게 한다. 문서에 근무지가 없으면(고치는 중이어도) 적어 둔 것을 깐다.
    const workplace = form.workplace || st.workplace;
    st.form = edit ? { ...form, workplace } : { ...form, hasFile: false, workplace };
    st.edit = edit || null;
    // 불러온 폼의 교통편은 아직 손대지 않은 것이다 — 새 신청서로 불러왔으면 그 출장지에 기억해 둔 교통편을 깐다.
    st.transportSet = false;
    recallTransport();
    // "내역"에서 불러왔으면 폼이 보여야 한다 — 그 종류의 것만 보기로 돌아온다.
    if (st.view) {
      st.view = '';
      chrome.storage.local.set({ attendView: '' });
    }
    setFold(true);
    st.filled.clear();
    paintKinds();
    paintForm();
    el.form.scrollIntoView?.({ block: 'nearest' });
  }

  /** 임시저장 문서를 폼으로 불러와 고친다. */
  async function loadIntoForm(it) {
    setBusy(true);
    setStatus('문서를 불러오는 중...');
    try {
      seatForm(await readDocForm(it), it);
      setStatus(`${it.docNo} 을(를) 불러왔습니다. 고친 뒤 임시저장하거나 결재요청하세요.`);
    } catch (err) {
      setError(err, '문서를 불러오지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 이미 있는 문서에 하는 일(상신·회수·삭제·취소신청). 끝나면 목록으로 결과를 확인한다.
   *
   * then 이 'copy' 면 올린 건을 **고치는** 길이다(변경). HR 에는 올린 문서를 고치는 버튼이 없어서, 거둬들인 뒤
   * (승인 전이면 회수, 승인 뒤면 취소신청) 같은 내용을 새 신청서로 폼에 불러온다. 내용은 거둬들이기 **전에** 읽는다 —
   * 읽지 못했는데 거둬들이기만 되면 다시 쓸 것이 남지 않는다.
   */
  async function act(it, action, { reason, then } = {}) {
    const verb = ACTION_LABEL[action];
    setBusy(true);
    try {
      let detail = {};
      const again = then === 'copy' ? await readDocForm(it) : null;
      if (action === 'delete') {
        setStatus('삭제하는 중...');
        await hrDeleteDoc(it, { onStage: setStatus });
      } else {
        const job = action === 'cancel' ? buildCancelJob(it, reason) : buildDocJob(it, action);
        const r = await hrRunJob(job, { onStage: setStatus });
        detail = { stage: r.stage, said: said(r), newDocNo: action === 'cancel' ? r.docNo : undefined };
        if (!r.ok) throw new Error(failText(r));
      }
      const after = await confirmInList(it.docNo);
      // 삭제는 목록에서 사라져야 하고, 상신·회수는 상태가 바뀌어야 한다. 취소신청은 원 문서가 승인 때까지 그대로다.
      const done = action === 'delete' ? !after
        : action === 'cancel' ? true
          : !!after && after.status !== it.status;
      st.cancelFor = null;
      st.cancelThen = null;
      if (st.edit?.docNo === it.docNo) resetForm();
      if (done && again) seatForm(again, null);
      // 취소신청을 올렸으면 그 건은 결재될 때까지 "취소 중"이다 — 적어 두고, 출장이면 여비계산서(사전정산까지)를 지운다.
      const dropped = action === 'cancel' && done ? await afterCancel(it, detail.newDocNo, { keepTrip: !!again }) : '';
      const tail = (again ? '. 같은 내용을 폼에 불러왔습니다 — 시간을 고친 뒤 결재요청하세요.' : '') + dropped;
      setStatus(done
        ? `${verb}했습니다 — ${it.summary} · ${it.docNo}${action === 'cancel' ? ' (취소신청서가 결재되면 무효가 됩니다)' : ''}${tail}`
        : `${verb}했다고 HR 이 답했지만 목록의 상태가 그대로입니다 — ${it.docNo}. HR 에서 확인해 주세요.`, done ? '' : 'error');
      onChanged();
      st.sched = null;
      logEvent('attend', done, `${verb}${again ? '(변경)' : ''}: ${it.summary} · ${it.docNo}${done ? '' : ' (목록에서 미확인)'}`,
        { action, docNo: it.docNo, before: it.statusName, after: after?.statusName, reason, change: !!again, ...detail });
    } catch (err) {
      // 취소할 수 있는 문서 목록에 없다 — 이 건에는 이미 취소신청이 올라가 있다(HR 에서 올렸다 — 2026-10-07 실제로 그랬다).
      // 실패로 끝내지 않고 취소가 걸린 것으로 적어 두고, 목록을 다시 읽어 그 취소신청서를 잇는다. 출장이면 계산서를 지운다.
      if (action === 'cancel' && /취소할 수 있는 결재완료 문서 목록에/.test(err.message)) {
        st.cancelFor = null;
        st.cancelThen = null;
        await confirmInList(it.docNo);
        const dropped = await afterCancel(it, '', { keepTrip: then === 'copy', already: true });
        setStatus(`이미 취소신청이 올라가 있는 건입니다 — ${it.summary} · ${it.docNo}${dropped}`);
        logEvent('attend', true, `취소신청 이미 있음: ${it.summary} · ${it.docNo}`, { action, docNo: it.docNo });
        onChanged();
        return;
      }
      setError(err, `${verb} 실패`);
      logEvent('attend', false, `${verb} 실패: ${it.summary} · ${it.docNo} — ${err.message}`, { action, docNo: it.docNo });
    } finally {
      setBusy(false);
    }
  }

  /**
   * 취소신청을 올린 뒤의 일. 그 건을 "취소 중"으로 적어 두고(CANCELLING_KEY — 홈 카드도 읽는다), 출장이면 여비계산서를 사전정산까지
   * 지운다(2026-10-07 사용자 지정). 근태 변경(keepTrip)은 같은 출장을 새로 올리는 길이라 계산서를 남긴다. 던지지 않는다 —
   * 상태 줄에 덧붙일 말을 돌려준다.
   */
  async function afterCancel(it, cancelDocNo, { keepTrip = false, already = false } = {}) {
    // 이미 있던 취소신청(already)은 목록에서 이어 둔 기록이 있으면 그대로 둔다 — 그 취소신청서 번호를 지우지 않게.
    if (!(already && st.cancelKept[it.docNo])) {
      st.cancelKept = { ...st.cancelKept, [it.docNo]: { at: Date.now(), cancelDocNo: cancelDocNo || '' } };
    }
    chrome.storage.local.set({ [CANCELLING_KEY]: st.cancelKept });
    paintList();
    if (!isTrip(it) || keepTrip) return '';
    try {
      if (!st.trips?.rows || tripsBusy) await loadTrips();
      const row = st.trips?.rows ? tripDocFor(it, st.trips.rows, st.trips.me) : null;
      if (!row) return st.trips?.error ? ` · 여비계산서를 읽지 못해 지우지 못했습니다: ${st.trips.error}` : '';
      await tripDelete(row, { name: st.trips.me, onStage: setStatus });
      logEvent('trip', true, `여비계산서 삭제(출장 취소): ${row.seq} · ${it.summary}`, { seq: row.seq, docNo: it.docNo });
      await loadTrips();
      return ` · 여비계산서 ${row.seq}(사전정산)를 지웠습니다`;
    } catch (err) {
      logEvent('trip', false, `여비계산서 삭제 실패(출장 취소): ${it.summary} — ${err.message}`, { docNo: it.docNo });
      return ` · 여비계산서를 지우지 못했습니다: ${err.message}`;
    }
  }

  /** 문서를 HR 웹 화면에서 연다 — HR 을 새 탭으로 열고 그 문서를 HR 의 탭에 띄운다. 읽기만 하는 일이다. */
  async function openWeb(it) {
    disarm();
    setStatus('HR 에서 문서를 여는 중...');
    try {
      await hrOpenDoc(it, { onStage: setStatus });
      setStatus(`HR 탭에 열었습니다 — ${it.summary} · ${it.docNo}`);
    } catch (err) {
      setError(err, 'HR 에서 열지 못했습니다');
      logEvent('attend', false, `HR 에서 열기 실패: ${it.summary} · ${it.docNo} — ${err.message}`, { action: 'web', docNo: it.docNo });
    }
  }

  function onListClick(e) {
    const target = e.target instanceof HTMLElement ? e.target : null;
    const li = target?.closest('li[data-i]');
    const it = li ? shownItems()[+li.dataset.i] : null;
    if (!it || st.busy) return undefined;
    // 목록을 손수 누르기 시작했으면 홈 카드의 부탁(보내기)은 잊는다 — 뒤늦게 다른 카드가 펴지거나 팝업이 뜨지 않게.
    st.seek = null;
    // 증빙 넣는 곳 아래의 웹페이지 캡처 단추와 탭 목록(webpick.js).
    const pick = webPick.click(e);
    if (pick) return onPick(pick, it, target);
    const btn = target.closest('button[data-act]');
    if (!btn) {
      // 줄을 누르면 펴고, 다시 누르면 접는다. 한 번에 한 줄만 펴 둔다.
      if (!target.closest('.at-head')) return undefined;
      disarm();
      st.openDoc = st.openDoc === it.docNo ? null : it.docNo;
      st.cancelFor = null;
      st.cancelThen = null;
      paintList();
      el.list.querySelector(`li[data-i="${li.dataset.i}"] .at-head`)?.focus();
      return undefined;
    }
    const a = btn.dataset.act;
    if (a === 'web') return openWeb(it);
    if (a === 'after') {
      // 사후정산 입력 화면을 새 탭에서 연다 — 패널이 올린 것을 보거나 손으로 고칠 때.
      disarm();
      const row = tripOf(it);
      chrome.tabs.create({ url: row ? tripAfterUrl(row.seq, trseqOf(row)) : TRIP_SHELL_URL });
      return undefined;
    }
    if (a === 'trip') {
      // 여비계산서를 새 탭에서 연다. 읽기만 하는 일이라 한 번에 열린다.
      disarm();
      const row = tripOf(it);
      chrome.tabs.create({ url: row ? tripDocUrl(row) : TRIP_SHELL_URL });
      return undefined;
    }
    if (a === 'trip-refresh') return refreshTrip(it);
    if (a === 'trip-drop') {
      // 취소가 걸린 출장의 남은 여비계산서를 지운다 — 되돌릴 수 없어 두 번 눌러야 나간다.
      if (!armed(`tripdrop:${it.docNo}`, btn, '한 번 더 → 지우기')) return undefined;
      return dropTrip(it);
    }
    if (a === 'trip-pre') {
      // 사전정산 입력 화면을 새 탭에서 연다(사후정산 단계의 출장 줄에 선 1 아이콘). 읽기만 하는 일이라 한 번에 열린다.
      disarm();
      const row = tripOf(it);
      chrome.tabs.create({ url: row ? tripPreUrl(row.seq) : TRIP_SHELL_URL });
      return undefined;
    }
    if (a === 'leg') return pickLeg(it, btn.dataset.leg, btn.dataset.t);
    if (a === 'leg-diff') {
      // 편의 `다름` — 저장된 값이 다른 곳을 그 편 아래에 펴고, 다시 누르면 접는다. 보기만 한다(사이트에는 아무것도 가지 않는다).
      const row = tripOf(it);
      if (!row) return undefined;
      disarm();
      st.legDiff[row.seq] = st.legDiff[row.seq] === btn.dataset.leg ? '' : btn.dataset.leg;
      paintList();
      el.list.querySelector(`button[data-act="leg-diff"][data-leg="${btn.dataset.leg}"]`)?.focus();
      return undefined;
    }
    if (a === 'leg-fix') {
      // 펴 둔 `다름`의 일자·시각 줄에서 `이 값으로` — 견준 값(출장 일정·출장 시각)으로 고쳐 둔다. 사이트에는 다시 저장을 눌렀을 때 간다.
      const row = tripOf(it);
      const leg = row && prePlanOf(row)?.legs.find((l) => l.key === btn.dataset.leg);
      const d = leg ? legDiffs(leg, diffCheck(row, st.after[row.seq]).when).find((x) => x.key === btn.dataset.k) : null;
      if (d?.fix) pickPreEdit(it, leg.key, d.fix);
      return undefined;
    }
    if (a === 'after-reopen') {
      // 완료한 사후정산을 다시 작성한다(여비증빙 송부 칸 아래의 `사후정산 다시하기`) · 그만둔다(다시 누르거나 칸 머리의 `그만두기`).
      // 카드의 모양만 바뀐다 — 사이트에는 아무것도 가지 않는다. 사전정산을 다시 작성하던 칸은 접는다(한 번에 하나만 다시 한다).
      const row = tripOf(it);
      if (!row) return undefined;
      disarm();
      const box = st.after[row.seq] || (st.after[row.seq] = {});
      Object.assign(box, { reopen: !box.reopen, redoPre: false, prePicks: null, preMeal: null, preEdits: null, error: '', info: '', warn: '', result: null });
      paintList();
      el.list.querySelector('button[data-act="after-reopen"]')?.focus();
      return undefined;
    }
    if (a === 'pre-redo') {
      // 사전정산을 다시 작성한다(여비증빙 송부 칸 아래의 `사전정산 다시하기`) · 그만둔다. 카드의 모양만 바뀐다 — 사이트에는 다시 저장을
      // 눌렀을 때 간다(pre-save).
      const row = tripOf(it);
      if (!row) return undefined;
      disarm();
      const box = st.after[row.seq] || (st.after[row.seq] = {});
      Object.assign(box, { redoPre: !box.redoPre, prePicks: null, preMeal: null, preEdits: null, reopen: false, error: '', info: '', warn: '', result: null });
      paintList();
      el.list.querySelector('button[data-act="pre-redo"]')?.focus();
      return undefined;
    }
    if (a === 'pre-leg') return pickPreLeg(it, btn.dataset.leg, btn.dataset.t);
    // 일비·식비 줄의 − + — 식수를 고치고 사전정산을 다시 작성하는 칸을 연다. 사이트에는 다시 저장을 눌렀을 때 간다(pre-save).
    if (a === 'pre-meal') return pickPreMeal(it, +btn.dataset.d);
    if (a === 'pre-open') {
      // 사전정산 입력 화면을 새 탭에서 연다 — 교통편 말고 다른 칸을 손으로 고칠 때.
      disarm();
      const row = tripOf(it);
      chrome.tabs.create({ url: row ? tripPreUrl(row.seq) : TRIP_SHELL_URL });
      return undefined;
    }
    if (a === 'pre-save') {
      // 사전정산을 다시 저장한다 — 실제 계산서를 바꾸는 누름이라 무엇이 바뀌는지 먼저 적어 보여주고, 두 번째에 보낸다.
      const row = tripOf(it);
      const plan = row && prePlanOf(row);
      if (!plan || plan.problems.length) return undefined;
      if (!armed(`presave:${it.docNo}`, btn, '한 번 더 → 다시 저장')) {
        setStatus(`다시 저장할 사전정산 — 여비계산서 ${row.seq} · ${preSummary(plan, stayOf(row))}`);
        return undefined;
      }
      return savePre(it);
    }
    if (a === 'lodge-info') {
      // 숙박비 내역의 `증빙`·`손수 작성` — 그 줄의 내용을 펴고, 다시 누르면 접는다. 사이트에는 아무것도 가지 않는다.
      const row = tripOf(it);
      if (!row) return undefined;
      disarm();
      st.lodgeOpen[row.seq] = st.lodgeOpen[row.seq] === btn.dataset.lodge ? '' : btn.dataset.lodge;
      paintList();
      el.list.querySelector(`button[data-act="lodge-info"][data-lodge="${btn.dataset.lodge}"]`)?.focus();
      return undefined;
    }
    if (a === 'lodge-refresh' || a === 'lodge-del' || a === 'lodge-cap') {
      // 출장 카드의 숙박비 내역 — 다시 읽기는 곧바로, 지우기는 실제 계산서의 줄이 없어지는 일이라 두 번 눌러야 나간다.
      // `상한`은 그 줄의 정산금액을 상한액과 실제 금액 사이에서 바꾼다(2026-10-06 사용자 지정 — 버튼 하나, 되돌릴 수 있어 한 번에 나간다).
      const row = tripOf(it);
      if (!row) return undefined;
      if (a === 'lodge-refresh') {
        disarm();
        return lodgeBox.reload(lodgeCtx(row));
      }
      if (a === 'lodge-cap') {
        disarm();
        return lodgeBox.toggleCap(lodgeCtx(row), btn.dataset.lodge);
      }
      if (!armed(`lodge:${row.seq}:${btn.dataset.lodge}`, btn, '지우기')) {
        setStatus(`지울 숙박 줄 — ${lodgeBox.describe(row.seq, btn.dataset.lodge)} · 한 번 더 누르면 사후정산에서 지웁니다`);
        return undefined;
      }
      return lodgeBox.remove(lodgeCtx(row), btn.dataset.lodge).then(() => forgetInfo(row.seq, btn.dataset.lodge));
    }
    if (a.startsWith('ask-')) {
      // 올리기 전에 물은 것(원화 금액·상한액 초과)의 답.
      disarm();
      return answerAsk(it, btn);
    }
    if (a.startsWith('send-')) {
      // 여비증빙 송부 칸의 버튼(이전에 보낸 줄·직접 고르기·받는 사람 고르기, 보내기). `보내기`는 보낼 내용을 팝업으로 띄우고,
      // 팝업의 보내기를 눌러야 나간다 — 사후정산을 아직 완료하지 않았으면 그때 저장하고 확정한 뒤에 보낸다(2026-10-05 사용자 지정:
      // "보내기 하면 그때 '확정' 하고 보내라고" — 저장만 하거나 확정만 하는 버튼은 따로 두지 않는다).
      disarm();
      return sendBox.click(btn, sendCtx(it));
    }
    if (a === 'kept-drop') {
      // 보관함에서 증빙 하나를 뺀다. 사이트에는 아무것도 가지 않는다.
      const row = tripOf(it);
      const box = row && st.after[row.seq];
      if (!box) return undefined;
      disarm();
      return evidence.remove(it.docNo, btn.dataset.name).then(() => loadKept(it.docNo, box)).then(() => {
        setStatus(`보관함에서 뺐습니다 — ${btn.dataset.name}`);
        paintList();
      }, (err) => setStatus(`보관함에서 빼지 못했습니다: ${err.message}`, 'error'));
    }
    if (a === 'kept-ok') {
      // 출장 기간과 안 맞아 알림 표시로 둔 증빙을 이 출장의 증빙이 맞다고 확정한다(2026-10-05 사용자 지정) — 그때부터 보낼 때 같이 간다.
      // 사이트에는 아무것도 가지 않는다: 숙박 증빙·항공권이면 "사후정산에 안 올림"으로 바뀌고, 올리는 것은 아래의 올리기 버튼
      // (또는 홈 카드의 그 줄)이 한다 — 같은 숙박의 영수증과 예약서를 다 확정한 뒤에 한 번에 묶여 올라가게.
      const row = tripOf(it);
      const box = row && st.after[row.seq];
      const hit = box?.kept?.find((k) => k.name === btn.dataset.name && k.warn);
      if (!hit) return undefined;
      disarm();
      // 사후정산이 이미 완료된 출장이면 더 올릴 것이 없다 — 보낼 증빙으로만 확정한다.
      const stage = tripStage(row, st.trips?.me);
      const todo = needsAfter(hit.record) && !(stage.phase === 'post' && stage.done && !box.reopen);
      return evidence.confirm(it.docNo, hit.name, { todo }).then(() => loadKept(it.docNo, box)).then(() => {
        setStatus(`이 출장의 증빙으로 확정했습니다 — ${hit.name}${todo ? ' · 사후정산에는 아래의 올리기 버튼으로 올립니다' : ' · 담당자에게 보낼 때 같이 갑니다'}`);
        logEvent('trip', true, `증빙 확정(출장 기간과 안 맞던 것): ${row.seq} · ${hit.label} ${hit.name} — ${hit.warn}`, { seq: row.seq, docNo: it.docNo, file: hit.name });
        paintList();
      }, (err) => setStatus(`확정하지 못했습니다: ${err.message}`, 'error'));
    }
    if (a === 'kept-go') {
      // 홈의 WORKSPACE 카드에서 넣었는데 거기서 못 올린 증빙(숙박 증빙·항공권)을 사후정산에 올린다. 무엇이 올라가는지 먼저 적어 보여주고, 두 번째에 보낸다.
      const row = tripOf(it);
      const todo = row ? todoOf(st.after[row.seq]) : [];
      if (!todo.length) return undefined;
      if (!armed(`kept:${it.docNo}`, btn, '한 번 더 → 올리기')) {
        setStatus(`사후정산에 올릴 증빙 — ${todo.map((k) => `${k.label} ${k.name}`).join(' · ')}`);
        return undefined;
      }
      // 홈 카드가 지금 이 출장의 증빙을 받아 올리는 중이면 올리지 않는다 — 같은 숙박 줄이 두 번 올라가지 않게(UP_BUSY_KEY).
      return chrome.storage.local.get(UP_BUSY_KEY).then((saved) => saved?.[UP_BUSY_KEY], () => null).then((busy) => {
        if (upBusy(busy, it.docNo)) return setStatus('홈 카드가 이 증빙을 사후정산에 올리는 중입니다 — 끝난 뒤에도 남아 있으면 다시 눌러 주세요');
        const left = todoOf(st.after[row.seq]);
        return left.length ? runAfter(row.seq, [], { given: left }) : undefined;
      });
    }
    if (a === 'pre-done') {
      // 사전정산을 완료(확정)한다. 어느 계산서인지 먼저 적어 보여주고, 두 번째에 보낸다.
      const row = tripOf(it);
      if (!row) return undefined;
      if (!armed(`pre:${it.docNo}`, btn, '한 번 더 → 확정')) {
        setStatus(`완료(확정)할 사전정산 — 여비계산서 ${row.seq} · ${it.summary}`);
        return undefined;
      }
      return runPreConfirm(it);
    }
    if (a === 'legs-go') {
      // 증빙 없이 바꾼 가는 편·오는 편만 사후정산에 올린다. 무엇이 올라가는지 먼저 적어 보여주고, 두 번째에 보낸다.
      const row = tripOf(it);
      const route = row && legsOf(it, row);
      if (!route) return undefined;
      if (!armed(`legs:${it.docNo}`, btn, '한 번 더 → 올리기')) {
        setStatus(`사후정산에 올릴 교통편 — ${route.legs.filter((l) => l.pick?.t && l.row).map((l) => `${l.label} ${describeTrans(l.row)}`).join(' · ')}`);
        return undefined;
      }
      return runAfter(row.seq, []);
    }
    if (a === 'edit') return loadIntoForm(it);
    const approved = it.status === STATUS.APPROVED;
    if (a === 'cancel' || (a === 'change' && approved)) {
      // 사유를 받아야 한다. 줄 아래에 칸을 펴고, 올리는 것은 그 칸 옆의 버튼이 한다.
      const then = a === 'change' ? 'copy' : null;
      const same = st.cancelFor === it.docNo && st.cancelThen === then;
      st.cancelFor = same ? null : it.docNo;
      st.cancelThen = same ? null : then;
      disarm();
      paintList();
      $('atCancelReason')?.focus();
      return undefined;
    }
    if (a === 'cancel-go') {
      const reason = $('atCancelReason')?.value.trim() || '';
      if (!reason) return setStatus('취소 사유를 적어 주세요.', 'error');
      if (!armed(`cancel:${it.docNo}`, btn, '한 번 더 누르면 올립니다')) return undefined;
      return act(it, 'cancel', { reason, then: st.cancelThen });
    }
    if (a === 'change') {
      // 승인 전: 회수하고 같은 내용을 폼에 불러온다.
      if (!armed(`change:${it.docNo}`, btn, '한 번 더 → 회수 후 수정')) {
        setStatus(`회수하고 폼에 불러올 문서 — ${it.summary} · ${it.docNo}`);
        return undefined;
      }
      return act(it, 'recall', { then: 'copy' });
    }
    // 임시저장 문서의 결재요청은 한 번에 나간다(폼의 결재요청과 같다). 삭제·회수는 두 번 눌러야 한다.
    if (a !== 'request' && !armed(`${a}:${it.docNo}`, btn, '한 번 더')) {
      setStatus(`${ACTION_LABEL[a]}할 문서 — ${it.summary} · ${it.docNo}`);
      return undefined;
    }
    return act(it, a);
  }

  /* ---------------------------------------------------------------- 바깥에 내놓는 것 */

  function wire() {
    el.kinds.addEventListener('click', (e) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest('#atMore')) {
        st.moreOpen = !(st.moreOpen || KIND_MORE.includes(st.form.kind));
        chrome.storage.local.set({ attendMore: st.moreOpen });
        // 접힌 쪽 종류를 쓰는 중에는 접을 수 없다(paintKinds 가 펴 둔다). 다른 종류로 옮기면 접힌다.
        return paintKinds();
      }
      const v = target?.closest('button[data-view]');
      if (v) return setView(v.dataset.view);
      const b = target?.closest('button[data-kind]');
      if (b) setKind(b.dataset.kind);
      return undefined;
    });
    el.fields.addEventListener('input', onFieldInput);
    el.fields.addEventListener('change', onFieldInput);
    el.fields.addEventListener('click', onChipClick);
    el.fields.addEventListener('click', onCarClick);
    el.fields.addEventListener('dragover', onFileDrag);
    el.fields.addEventListener('dragleave', onFileDrag);
    el.fields.addEventListener('drop', onFileDrop);
    document.addEventListener('paste', onPaste);
    // 첨부 칸을 빗나가 놓은 파일을 패널이 열어 버리지 않게 한다 — 열리면 쓰던 폼이 날아간다.
    // 파일을 끄는 동안에는 놓을 칸(첨부 칸·증빙 넣는 곳)을 짙게 보여 준다 — dragover 는 끄는 내내 오므로, 끊기면(밖으로 나갔거나 놓았으면) 걷는다.
    let dragTimer = null;
    const endDrag = () => el.root.classList.remove('dragging');
    for (const type of ['dragover', 'drop']) {
      window.addEventListener(type, (e) => {
        if (!hasFiles(e)) return;
        clearTimeout(dragTimer);
        if (type === 'drop') endDrag();
        else {
          el.root.classList.add('dragging');
          dragTimer = setTimeout(endDrag, 250);
        }
        if (fileField(e) || afterDrop(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'none';
      });
    }
    el.formToggle.addEventListener('click', () => setFold(!st.formOpen));
    el.reset.addEventListener('click', resetForm);
    el.editCancel.addEventListener('click', resetForm);
    el.submit.addEventListener('click', () => send('request'));
    el.save.addEventListener('click', () => send('save'));
    el.chatGo.addEventListener('click', runChat);
    el.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) runChat(); });
    el.list.addEventListener('click', onListClick);
    // 사후정산 증빙: 열어 둔 출장 카드의 칸이나 접힌 출장 줄에 끌어다 놓거나(drop), 칸을 눌러 고르거나(change), 붙여넣기(onPaste)로 넣는다.
    el.list.addEventListener('change', (e) => {
      const input = e.target instanceof HTMLInputElement && e.target.type === 'file' ? e.target : null;
      const box = input?.closest('.at-after[data-seq]');
      if (!box) return;
      const files = [...(input.files || [])];
      input.value = '';
      runAfter(box.dataset.seq, files);
    });
    // 사전정산을 다시 작성하는 칸의 편마다의 일자·출발 시·도착 시 — 고치면 그 편의 값으로 적어 둔다(사이트에는 다시 저장을 눌렀을 때 간다).
    el.list.addEventListener('change', (e) => {
      const f = e.target instanceof HTMLElement ? e.target.closest('[data-edit][data-leg]') : null;
      const li = f?.closest('li[data-i]');
      const it = li ? shownItems()[+li.dataset.i] : null;
      if (!it || !isTrip(it)) return;
      pickPreEdit(it, f.dataset.leg, { [f.dataset.edit]: f.dataset.edit === 'date' ? f.value : +f.value });
      el.list.querySelector(`[data-edit="${f.dataset.edit}"][data-leg="${f.dataset.leg}"]`)?.focus();
    });
    // 물어본 원화 금액 칸 — 카드를 다시 그려도 적던 글이 남게 적어 두고, Enter 는 옆의 "이 금액으로"를 누른 것과 같다.
    const askInput = (e) => (e.target instanceof HTMLInputElement && e.target.classList.contains('at-ask-krw') ? e.target : null);
    el.list.addEventListener('input', (e) => {
      const input = askInput(e);
      const ask = input ? st.after[input.closest('.at-after[data-seq]')?.dataset.seq]?.ask : null;
      if (ask) ask.krw[input.dataset.i] = input.value;
    });
    el.list.addEventListener('keydown', (e) => {
      const input = askInput(e);
      if (!input || e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      input.parentElement.querySelector('button[data-act="ask-krw"]')?.click();
    });
    // 증빙 넣는 곳 아래에 펴 둔 웹페이지 목록의 체크박스(webpick.js) — 카드를 다시 그리지 않고 고른 것만 맞춘다.
    el.list.addEventListener('change', (e) => webPick.change(e));
    // 여비증빙 송부 칸의 글 칸(과제·계정, 받는 사람 찾기)과 파일 칸.
    for (const type of ['input', 'change']) {
      el.list.addEventListener(type, (e) => {
        const li = e.target instanceof HTMLElement ? e.target.closest('li[data-i]') : null;
        const it = li ? shownItems()[+li.dataset.i] : null;
        if (it && isTrip(it)) sendBox.input(e, sendCtx(it));
      });
    }
    el.list.addEventListener('dragover', onAfterDrag);
    el.list.addEventListener('dragleave', onAfterDrag);
    el.list.addEventListener('drop', onAfterDrop);
    el.openHr.addEventListener('click', () => chrome.tabs.create({ url: HR_SSO_URL }));
    // 조회 기간. 달력 버튼이 날짜 칸을 편다 — 날짜를 직접 정했으면 조회를 눌러 읽는다. 제목 줄의 4W·8W 는 누르면 그 기간을 곧바로
    // 조회한다(켜진 것을 다시 누르면 기본 보기로 돌아온다).
    el.rangeBtn.addEventListener('click', () => {
      const open = el.rangeBox.classList.toggle('hidden') === false;
      el.rangeBtn.setAttribute('aria-expanded', String(open));
      if (open) paintRange();
    });
    for (const b of backButtons()) {
      b.addEventListener('click', () => { if (!st.busy) pickWeeks(Number(b.dataset.back)); });
    }
    el.rangeGo.addEventListener('click', () => {
      if (!st.busy) setRange({ from: el.rangeFrom.value, to: el.rangeTo.value });
    });
    // 패널이 닫히면 뒷전에 열어 둔 HR 작업 탭도 치운다.
    window.addEventListener('pagehide', () => { hrCloseWorker().catch(() => {}); });
    // 홈의 WORKSPACE 카드에서 증빙을 넣었으면(보관함이 바뀌었다 — MARKS_KEY) 펴 둔 출장 카드의 보관함을 다시 읽는다.
    // 달라진 것이 있을 때만 다시 그린다 — 이 패널이 담은 것은 이미 그려져 있다.
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== 'local') return;
      // 홈 카드가 사후정산을 올리면서 적은 것(표를 앉힌 뒤의 가는 편·오는 편, 올린 숙박 줄의 표시 — src/afterup.js)을 따라간다.
      // 이 패널이 쥐고 있던 예전 값으로 그것을 덮어쓰지 않게 한다. 이 패널이 적은 것도 같은 값으로 되돌아온다.
      if (changes.attendLegs) st.legs = { ...changes.attendLegs.newValue };
      if (changes.attendLodgeMine) st.lodgeMine = { ...st.lodgeMine, ...changes.attendLodgeMine.newValue };
      if (!(MARKS_KEY in changes)) return;
      const it = st.items.find((x) => x.docNo === st.openDoc);
      const trip = it ? tripOf(it) : null;
      const a = trip ? st.after[trip.seq] : null;
      if (!a || a.busy) return;
      const shape = () => JSON.stringify((a.kept || []).map((k) => [k.name, !!k.todo, !!k.warn]));
      const before = shape();
      const was = new Set(todoOf(a).map((k) => k.name));
      loadKept(it.docNo, a).then(async () => {
        if (shape() === before) return;
        paintList();
        // 홈 카드가 그 증빙을 사후정산에 올렸다(증빙은 그대로인데 표시가 걷혔다) — 계산서의 단계와 숙박비 내역을 다시 읽어 카드에 맞춘다.
        if (a.busy || !(a.kept || []).some((k) => was.has(k.name) && !k.todo)) return;
        await loadTrips();
        const row = tripOf(it);
        if (row) await lodgeBox.reload(lodgeCtx(row), { quiet: true });
      });
    });
  }

  /** 탭이 보일 때. 마지막에 쓰던 종류를 되살리고 신청 내역을 읽는다. */
  async function show() {
    el.root.classList.remove('hidden');
    if (!st.form.kind && !st.edit) {
      const saved = await chrome.storage.local.get(['attendKind', 'attendMore', 'attendWorkplace', 'attendFormOpen', 'attendView', 'attendLegs']);
      st.legs = saved?.attendLegs && typeof saved.attendLegs === 'object' ? saved.attendLegs : {};
      st.moreOpen = !!saved?.attendMore;
      st.formOpen = saved?.attendFormOpen !== false;
      st.view = saved?.attendView === 'all' ? 'all' : '';
      st.workplace = typeof saved?.attendWorkplace === 'string' ? saved.attendWorkplace : '';
      st.form = KINDS[saved?.attendKind] ? blank(saved.attendKind) : { ...st.form, workplace: st.workplace };
    }
    // 이 패널이 올린 숙박 줄의 기록. 기다리지 않는다.
    chrome.storage.local.get(['attendLodgeMine', 'attendLodgeInfo']).then((saved) => {
      if (saved?.attendLodgeMine && typeof saved.attendLodgeMine === 'object') st.lodgeMine = { ...saved.attendLodgeMine, ...st.lodgeMine };
      if (saved?.attendLodgeInfo && typeof saved.attendLodgeInfo === 'object') st.lodgeInfo = { ...saved.attendLodgeInfo, ...st.lodgeInfo };
    }, () => {});
    // 다녀온 출장을 몇 주 뒤까지 보일지 고른 값과, 담아 둔 여비계산서 목록(오늘 읽은 것만 쓴다).
    const rule = await chrome.storage.local.get([BACK_KEY, STAGES_KEY, ROUTES_KEY, CANCELLING_KEY]);
    st.cancelKept = rule?.[CANCELLING_KEY] && typeof rule[CANCELLING_KEY] === 'object' ? { ...rule[CANCELLING_KEY], ...st.cancelKept } : st.cancelKept;
    // 출장지마다 기억해 둔 교통편(src/routes.js). 그 사이 이 패널이 새로 기억한 것이 있으면 그것이 먼저다.
    st.routes = { ...(rule?.[ROUTES_KEY] && typeof rule[ROUTES_KEY] === 'object' ? rule[ROUTES_KEY] : {}), ...st.routes };
    st.back = backWeeksOf(rule?.[BACK_KEY]);
    st.stages = stagesFresh(rule?.[STAGES_KEY], attendToday()) ? rule[STAGES_KEY] : null;
    // 여비증빙 송부 칸이 기억해 둔 것(최근에 보낸 곳, 보낸 기록)을 읽고 Teams MCP 가 닿는지 본다. 기다리지 않는다 — 읽히면 다시 그린다
    // (증빙을 이미 보낸 다녀온 출장은 기본 보기에서 빠진다).
    sendBox.load().then(() => { pruneSettled(); paintList(); }, () => {});
    // 차량 조회를 켜 둔 채 다른 탭에 다녀왔으면 다시 읽는다 — 그 사이 차량을 신청했거나 취소했을 수 있다.
    st.cars = carIdle();
    paintKinds();
    paintForm();
    paintChat();
    paintRange();
    return reload();
  }

  function hide() {
    disarm();
    el.root.classList.add('hidden');
  }

  return { wire, show, hide, reload, seek, paintReady, authFailed: () => st.authFailed, state: st };
}
