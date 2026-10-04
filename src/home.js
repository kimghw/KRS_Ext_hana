// e-Class 홈(eClassVer4/Home/Index) 맨 위에 "WORKSPACE" 카드를 붙인다(예전 이름은 "내 예약").
//
// 사이드패널을 열지 않아도 홈에 들어오면 오늘부터 한 달 안의 내 회의실·차량 예약과 근태(출장·외근·휴가)가
// 보이게 한다. 훑기(site/rentcar)와 내 예약 판정(mine)은 사이드패널과 **같은 모듈**을 그대로 쓴다. 다른 점은 둘이다.
//
//   1) 콘텐츠 스크립트라 페이지와 같은 출처에서 요청한다. 쿠키가 그냥 실리고, 탭 경유 폴백은 없다.
//   2) 훑은 결과를 chrome.storage 에 담아 둔다. 홈은 하루에도 여러 번 여는 화면이라 그때마다
//      서른 날을 다시 두드릴 수 없다. 담긴 것은 **언제 읽었는지**와 함께 보여주고, 다시 훑는 때는 셋뿐이다.
//        - 하루에 한 번: 오늘 읽어 둔 것이 없을 때
//        - 이 확장으로 예약·취소·수정했을 때: 패널이 이 캐시를 지우고, 카드는 그것을 보고 다시 훑는다
//        - 새로고침 버튼을 눌렀을 때
//
// 근태는 HR(다른 출처)에 있어 여기서 직접 읽지 못한다. 배경(서비스 워커)에게 부탁하면 패널의 현황 탭과 같은 길
// (src/plans.js)로 읽어 같은 자리(hrPlans)에 담아 준다. 이것도 하루에 한 번이고, 패널이 오늘 읽어 두었으면
// 그것을 그대로 쓴다. 회의실·차량 훑기와는 따로 돈다 — HR 이 느리거나 막혀도 예약 목록을 붙잡지 않는다.
//
// 겉모습은 홈 카드 공통 스타일(src/homecard.js — R&D ERP 현황 카드와 같은 색·칩·아이콘 버튼)을 쓰고,
// 안쪽 목록은 krs-mine-* 접두어의 자체 스타일만 쓴다 — 사이트 CSS 가 바뀌어도 목록은 읽힌다.
// 예약도 경고도 없으면 본문을 접어 머리 한 줄(건수 칩 · 읽은 때)만 남긴다. "없습니다" 같은 말은 적지 않는다.
// 목록이 있으면 머리 줄이나 화살표 버튼으로 접고 편다(2026-10-04 사용자 지정 — 접수 미확인 공문 카드와 같은 버튼). 접은 것은
// 기억한다(FOLD_KEY) — 홈은 하루에도 여러 번 여는 화면이다. 접혀 있어도 건수 칩과 경고는 보인다.
//
// **출장 줄은 여비 증빙을 받는다**(2026-10-04 사용자 지정). 줄에 파일을 끌어다 놓거나, 마우스를 올리고 화면 캡처를 붙여 넣으면(Ctrl+V)
// 그 출장의 증빙으로 들어간다 — 배경이 한 장씩 읽어 증빙으로 쓸 수 있는 것만 보관함에 담는다(src/intake.js). 줄의 오른쪽에는
// 선 아이콘 여섯이 세 개씩 두 줄로 선다: 가는 편·오는 편(교통편 — 기차·비행기·버스)·숙박 / 항공권·출장증빙·보냄. 들어와 있으면(보냈으면)
// 파란 선, 없으면 회색 선이다(tripMarks). 예전에 적던 "다녀온 출장 · 사전정산 완료"는 글로 적지 않고 줄의 풍선말로 옮겼다.
// 그 가운데 보냄(종이비행기)은 누르는 것이다 — **보내기**: 패널을 열어 그 출장 카드의 여비증빙 송부 칸으로 가고 보낼 내용을 띄운다(2026-10-04
// 사용자 지정). 아이콘 옆(숨기기 눈 아이콘 아래)에는 **계산서 보기**가 선다 — 그 출장의 여비계산서 화면을 새 탭으로 연다.
// 가는 편·오는 편은 사전정산의 교통편 줄(하루에 한 번 읽어 LEGS_KEY 에 담는다)에 패널의 출장 카드에서 고른 것(PICKS_KEY)을 얹은 것이고,
// 숙박·항공권·출장증빙은 보관함에 담긴 증빙(src/evidence.js 의 MARKS_KEY), 보냄은 패널의 여비증빙 송부 칸이 적는 보낸 기록(SENT_KEY)이다.
// **여비계산서는 여기서 바꾸지 않는다** — 숙박 증빙·항공권을 사후정산에 올리는 것은 패널의 출장 카드가 한다(실제 계산서를 바꾸는
// 일이고, 정산금액을 물어야 할 때가 있다).

import { scanDays } from './site.js';
import { scanCarDays } from './rentcar.js';
import { collectMine, datesFrom } from './mine.js';
import { MONTH_DAYS } from './monthcache.js';
import { fmtTime, todayStr } from './parse.js';
import { AuthError } from './net.js';
import { PORTAL_HOME_URL } from './config.js';
import { CARD_STYLE, ICON, setChip } from './homecard.js';
import { PLAN_GROUPS, EVIDENCE_ACCEPT, acceptsFile } from './attend.js';
import { PLANS_KEY, plansFresh, plansToShow, TRIP_LOOKBACK_DAYS } from './plans.js';
import { BACK_KEY, SENT_KEY, STAGES_KEY, backWeeksOf, settledBy, stagesFresh, stageNote, loadStages as readStages } from './settling.js';
import { TRANSPORTS, tripDocFor, tripStage, tripIconState, legsOfRows, pickOfRow, describeTrans } from './travel.js';
import { MARKS_KEY } from './evidence.js';
import { INTAKE_LIMIT } from './intake.js';

/** 훑은 결과를 담는 storage 키. 패널은 예약·취소 뒤 이 키를 지워 카드에게 알린다. */
export const CACHE_KEY = 'homeMine';
/** 카드를 쓸지. 패널 머리의 체크박스가 이 값을 쓴다. 값이 없으면 켠 것으로 본다. */
export const ENABLE_KEY = 'homeCard';
export const homeEnabled = (value) => value !== false;
/** 카드에서 한 건을 누르면 남기는 "이 날짜로 가 달라"는 부탁. 패널이 읽고 지운다. */
export const JUMP_KEY = 'homeJump';
/** 부탁이 이보다 묵으면 패널은 무시한다. 며칠 전 누른 것이 다음에 패널을 열 때 튀어나오면 안 된다. */
export const JUMP_TTL_MS = 60_000;
/** 카드에서 숨긴 "다녀온 출장"의 신청서 번호들을 담는 storage 키. 머리 줄의 눈 아이콘(전체 보기)을 켜면 숨긴 것까지 보인다. */
export const HIDDEN_KEY = 'homeHiddenTrips';
/** 카드의 목록을 접어 두었는가(true 면 접힘)를 담는 storage 키. 값이 없으면 펴 둔 것이다. */
export const FOLD_KEY = 'homeFolded';
/**
 * 출장마다 사전정산의 가는 편·오는 편을 읽어 담아 두는 storage 키 — { day, by: { 계산서 번호: { go, back } } }. 편 하나는
 * { t: 교통편, g: 등급, text: "KTX 부산→서울 일반석 54,400원" } 이고, 사전정산에 그 편의 줄이 없으면 null 이다. 하루에 한 번 읽는다.
 */
export const LEGS_KEY = 'homeLegs';
/** 패널의 출장 카드에서 고른 가는 편·오는 편(attendpanel.js 가 적는다) — { 신청서 번호: { go: {t, g}, back: {t, g} } }. */
export const PICKS_KEY = 'attendLegs';
/** 카드의 루트 요소 id. CDP 검사가 이걸로 찾는다. */
export const ROOT_ID = 'krsMine';
/** 패널이 예약·취소를 연달아 하면 알림이 몰려온다. 이만큼 모아서 한 번만 훑는다. */
export const RESCAN_DEBOUNCE_MS = 1500;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const WHY_LABEL = { name: '이름 일치', booked: '내가 넣음' };

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const shortLabel = (dateStr) => {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
};

/** 'YYYY-MM-DD' → '9/17 (수)'. 오늘은 말로 — 목록에서 눈에 먼저 들어와야 하는 날이다. */
export function dayLabel(dateStr, today = todayStr()) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return dateStr === today ? `오늘 (${wd})` : `${m}/${d} (${wd})`;
}

/** 읽은 지 얼마나 됐는지. 카드는 늘 이걸 같이 적는다 — 묵은 현황을 지금 것처럼 보이면 안 된다. */
export function agoText(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

const rangeText = (dates) => `${shortLabel(dates[0])}~${shortLabel(dates[dates.length - 1])}`;

/** 저장소에서 읽은 값이 객체면 그대로, 아니면(없거나 다른 모양) 기본값. */
const objectOr = (value, fallback) => (value && typeof value === 'object' ? value : fallback);

/* ------------------------------------------------------------ 자리 찾기 */

/**
 * 카드를 어디에 붙일지. 홈의 첫 카드(Popup Notice, #divPopupInfo) 바로 앞이 첫째 후보다.
 * 알아보는 자리가 없으면 null — 엉뚱한 화면에 띄우느니 안 붙인다.
 */
export function findAnchor(doc) {
  const notice = doc.querySelector('#divPopupInfo');
  if (notice?.parentElement) return { mode: 'before', el: notice };
  const content = doc.querySelector('.page-content');
  if (content) return { mode: 'prepend', el: content };
  return null;
}

/* ------------------------------------------------------------ 캐시 */

/** 기간은 패널의 내 예약 탭 설정(spanDays)을 그대로 쓴다. 두 화면이 다른 기간을 보면 서로 어긋나 보인다. */
export function spanOf(saved) {
  const n = +saved;
  return Number.isInteger(n) && n >= 1 && n <= 90 ? n : MONTH_DAYS;
}

/**
 * 담긴 것을 그대로 써도 되는지. 시작일·기간·이름이 모두 같아야 한다.
 * 이름이 바뀌면 판정이 바뀌고, 날이 바뀌면 어제 것은 오늘 것이 아니다.
 * 오늘 읽은 것이면 몇 시간이 지났어도 쓴다 — 스스로 다시 훑는 건 하루에 한 번뿐이다.
 */
export function cacheUsable(cache, { start, days, name = '' }) {
  return !!cache && Array.isArray(cache.items) && typeof cache.at === 'number'
    && cache.start === start && cache.days === days && (cache.name || '') === (name || '');
}

/** 화면에 필요한 것만 남긴다. record(파싱 원본)는 storage 에 넣지 않는다. */
const slim = (it) => ({
  kind: it.kind, why: it.why, from: it.from, to: it.to,
  room: it.room, title: it.title, status: it.status, owner: it.owner,
});

/**
 * 훑은 날들에서 내 예약을 추리고, 못 읽은 날을 센다.
 * 못 읽은 날을 조용히 넘기면 "내 예약이 없다"는 거짓말이 된다 — 그래서 여기서 같이 센다.
 *   skippedDates — 읽었지만 확신할 수 없어 뺀 날
 *   unread       — 회의실이든 차량이든 기록 자체가 없는 날(훑기가 도중에 죽었을 때)
 */
export function summarize(dates, days, { name = '', booked = [], failed = [] } = {}) {
  const { items, skipped } = collectMine(days, { name, booked });
  const skippedDates = [...new Set(skipped.map((s) => s.date))];
  const have = new Set(days.map((d) => `${d.kind}|${d.date}`));
  const unread = dates.filter((d) => !have.has(`room|${d}`) || !have.has(`car|${d}`));
  return { items: items.map(slim), skippedDates, unread, failed: [...failed] };
}

/* ------------------------------------------------------------ 근태 */

const clockMinutes = (t) => (/^\d{2}:\d{2}$/.test(t || '') ? +t.slice(0, 2) * 60 + +t.slice(3) : 0);

/**
 * 읽어 둔 근태에서 카드에 올릴 것만 — 그 기간에 걸친 출장·외근·휴가(PLAN_GROUPS)를 예약과 같은 한 건 모양으로.
 * 올려 두었거나 결재가 끝난 것만이고(plansIn), 시각이 없는 건(전일 휴가)은 timed 가 거짓이다.
 * 출장만은 다녀온 뒤 4주까지 남는다(plansToShow) — 다녀온 출장은 여비를 정산해야 해서 눈에 띄어야 한다.
 * 몇 주까지 남길지(4주·8주·안 봄)는 근태 탭의 신청 내역에서 고른 값을 따르고, 사후정산이 완료됐거나 증빙을 담당자에게 보낸
 * 출장은 올리지 않는다(2026-10-04 사용자 지정 — rule 은 src/settling.js 의 규칙이다). 그래도 남은 것은 그 줄의 눈 아이콘으로
 * 한 건씩 숨기고(HIDDEN_KEY), 머리 줄의 눈 아이콘으로 숨긴 것까지 전체를 본다.
 * @param {{backDays?: number, settled?: Function, note?: (plan: object) => string}} [rule] note 는 다녀온 출장 옆에 적을 여비계산서 단계
 */
export function planItems(raw, start, end, rule = {}) {
  return plansToShow(raw, start, end, rule).filter((p) => p.group).map((p) => ({
    kind: 'attend', group: p.group, label: p.label, docNo: p.docNo, timed: !!(p.start && p.end),
    from: { date: p.from, minutes: clockMinutes(p.start) }, to: { date: p.to, minutes: clockMinutes(p.end) },
    // status 는 HR 의 결재 상태 이름(결재요청·결재완료), state 는 그것을 줄인 말(신청·승인) — 종류 딱지 아래에 적는 것이다.
    gubun: p.gubun || '', title: p.reason || '', status: p.status || '', state: p.state || p.status || '',
    past: p.to < start, stage: p.to < start && rule.note ? rule.note(p) : '',
  }));
}

/* ------------------------------------------------------------ 출장 줄의 아이콘 */

const mark = (inner) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" '
  + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

/**
 * 출장 줄의 선 아이콘. 교통편(기차·비행기·버스)은 패널의 출장 카드와 같은 그림이고, 숙박은 침대, 항공권은 비행기가 든 표,
 * 출장증빙은 영수증, 보냄(증빙을 담당자에게 보냈는가)은 종이비행기다.
 * 색은 CSS 가 입힌다(.krs-mine-mark — 회색, .on — 파랑).
 */
const MARK_ICON = {
  train: mark('<path d="M7 3h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"/><path d="M4 11h16M8 21l2-3M16 21l-2-3M8.5 14.5h.01M15.5 14.5h.01"/>'),
  plane: mark('<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/>'),
  bus: mark('<path d="M4.5 16.5h-1a1 1 0 0 1-1-1V8A1.5 1.5 0 0 1 4 6.5h13a2 2 0 0 1 1.8 1.1l2.2 4.4c.3.6.5 1.3.5 2v1.5a1 1 0 0 1-1 1h-1M9.5 16.5h5"/>'
    + '<path d="M2.5 11.5h18.2M8.5 6.5v5M14 6.5v5"/><circle cx="7" cy="16.5" r="2"/><circle cx="17" cy="16.5" r="2"/>'),
  lodge: mark('<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>'),
  // 항공권 — 표 안에 비행기가 든 그림이다(2026-10-04 사용자 지정: 표만 그린 것은 비행기 표로 보이지 않았다). 작은 크기에서도
  // 비행기로 읽히게 안의 비행기만 속을 채웠다.
  ticket: mark('<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>'
    + '<path fill="currentColor" stroke="none" transform="translate(12 12) rotate(90) scale(.46) translate(-12 -12)" '
    + 'd="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>'),
  proof: mark('<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  sent: mark('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
};
/**
 * 계산서 보기의 그림 — 패널의 출장 카드에서 여비계산서를 여는 버튼과 같다: 문서 안에 숫자(1 사전정산 · 2 사후정산)가 적혀 있고,
 * 색이 단계를 말한다(회색 미작성·대기, 녹색 작성 중, 파랑 완료 — src/travel.js 의 tripIconState). 영수증 그림(출장증빙)과 헷갈리지 않는다.
 */
const BILL_DIGIT = { 1: 'M10.5 12 12.5 10.5V18M10.5 18h4', 2: 'M10.3 12.3a2.3 2.3 0 1 1 4.4 1.2c-.9 1.6-4.4 2.7-4.4 4.5h4.6' };
const billIcon = (n) => mark(`<path d="M6 3h9l4 4v14H6Z"/><path d="M15 3v4h4"/><path d="${BILL_DIGIT[n] || BILL_DIGIT[1]}"/>`);

const TRANSPORT_NAME = Object.fromEntries(TRANSPORTS.map((o) => [o.value, o.label]));
const LEG_MARKS = [{ key: 'go', label: '가는 편' }, { key: 'back', label: '오는 편' }];
/** 보관함의 이름표(src/after.js 의 evidenceOf) 가운데 숙박·항공권의 것. 나머지(당일출장 증명·출장지 영수증·증빙)는 출장증빙이다. */
const LODGE_LABEL = '숙박 증빙';
const FLIGHT_LABEL = '항공기 증명';
const TODO_NOTE = '사후정산에는 아직 올리지 않았습니다(예약 패널의 출장 카드에서 올립니다)';
/** 보냄 아이콘(보내기)을 누르면 하는 일 — 실제로 나가는 것은 패널에 뜨는 팝업의 보내기를 눌렀을 때다. */
const SEND_HOW = '누르면 예약 패널의 출장 카드(여비증빙 송부)를 열어 보낼 내용을 보여 줍니다';
const SEND_AGAIN = '누르면 예약 패널의 여비증빙 송부 칸을 엽니다(다시 보내기)';
const pad2 = (n) => String(n).padStart(2, '0');
/** 보낸 때를 "10/4 14:32" 로. */
const sentStamp = (at) => { const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/**
 * 사전정산의 교통편 줄(src/trip.js tripPreDetail 의 rows)을 가는 편·오는 편으로 줄인다 — LEGS_KEY 에 담는 모양이다.
 * 편 하나는 { t, g, text } 이고(t 는 패널이 모르는 수단이면 빈 글), 그 편의 줄이 없으면 null 이다.
 */
export function legsSlim(rows, trip) {
  const site = legsOfRows(rows, trip);
  const one = (row) => (row ? { ...pickOfRow(row), text: describeTrans(row) } : null);
  return { go: one(site.go), back: one(site.back) };
}

/**
 * 출장 한 건의 아이콘 여섯(2026-10-04 사용자 지정) — 가는 편·오는 편(교통편), 숙박, 항공권, 출장증빙, 보냄. on 이면 파란 선이고
 * 아니면 회색 선이다. 가는 편·오는 편은 사전정산의 줄에 패널에서 고른 것을 얹은 것이고(고른 것이 먼저다), 숙박·항공권·출장증빙은
 * 보관함의 증빙이며, 보냄은 증빙을 담당자에게 보낸 기록(패널의 여비증빙 송부 칸이 적는 SENT_KEY)이다. 가는 편이 먼저, 오는 편이 그다음이다
 * — 방향 화살표는 두지 않는다(같은 날 사용자 지정: 차례로 안다).
 * @param {{doc?: object|null, known?: boolean, legs?: {go: object|null, back: object|null}|null, picks?: object|null, kept?: object[],
 *          sent?: {at?: number, channel?: string, to?: string, account?: string}|null}} of
 *   doc 은 그 출장의 여비계산서(없으면 null), known 은 여비계산서 목록을 읽었는가, legs 는 사전정산의 편(아직 못 읽었으면 null),
 *   picks 는 패널에서 고른 편, kept 는 보관함의 증빙(MARKS_KEY 의 그 출장 몫), sent 는 그 출장의 보낸 기록(없으면 null)
 * @returns {{key: string, icon: string, on: boolean, title: string}[]}
 */
export function tripMarks({ doc = null, known = false, legs = null, picks = null, kept = [], sent = null } = {}) {
  const leg = ({ key, label }) => {
    const pick = picks?.[key]?.t ? picks[key] : null;
    const site = legs?.[key] || null;
    const t = pick?.t || site?.t || '';
    // 패널에서 고른 것이 사전정산의 줄과 같으면(증빙을 넣으면 패널이 그때의 편을 적어 둔다) 사전정산의 줄을 그대로 말한다.
    const same = !!pick && !!site && pick.t === site.t && pick.g === site.g;
    const what = pick && !same ? `${TRANSPORT_NAME[pick.t] || pick.t}${pick.g === 'first' ? ' 특실' : ''} · 예약 패널에서 고름` : site?.text || '';
    const why = !known ? '여비계산서 목록을 아직 읽지 못했습니다' : !doc ? '여비계산서가 없습니다'
      : !legs ? '사전정산의 교통편을 아직 읽지 못했습니다' : '사전정산에 이 편의 교통편이 없습니다';
    const on = !!(pick || site);
    return { key, icon: MARK_ICON[t] ? t : 'train', on, title: on ? `${label} — ${what}` : `${label} 없음 — ${why}` };
  };
  const files = (icon, name, list, hint) => {
    const todo = list.some((k) => k.todo);
    return {
      key: icon, icon, on: list.length > 0,
      title: list.length ? `${name} ${list.length}장 — ${list.map((k) => k.name).join(' · ')}${todo ? ` · ${TODO_NOTE}` : ''}`
        : `${name} 없음 — ${hint} 이 줄에 끌어다 놓거나, 마우스를 올리고 붙여 넣으세요(Ctrl+V)`,
    };
  };
  const all = kept || [];
  return [
    ...LEG_MARKS.map(leg),
    files('lodge', '숙박 증빙', all.filter((k) => k.label === LODGE_LABEL), '숙박 영수증·예약서를'),
    files('ticket', '항공권', all.filter((k) => k.label === FLIGHT_LABEL), '항공권·항공 영수증을'),
    files('proof', '출장증빙', all.filter((k) => k.label !== LODGE_LABEL && k.label !== FLIGHT_LABEL), '출장지에서 결제한 영수증을'),
    {
      key: 'sent', icon: 'sent', on: !!sent,
      // 이 아이콘은 누르는 것이다(보내기) — 누르면 패널이 그 출장 카드의 여비증빙 송부 칸을 열고 보낼 내용을 보여 준다.
      title: sent ? `증빙 보냄 — ${[sent.at ? sentStamp(sent.at) : '', sent.channel, sent.to, sent.account].filter(Boolean).join(' · ')} · ${SEND_AGAIN}`
        : `증빙 보내기 — 아직 보내지 않았습니다 · ${SEND_HOW}`,
    },
  ];
}

/* ------------------------------------------------------------ 훑기 */

/**
 * 회의실 한 바퀴, 차량 한 바퀴. 한쪽이 실패해도 다른 쪽은 계속한다.
 * 지역은 옮기지 않는다 — 예약 목록에는 전 지역이 다 들어 있고, 내 예약은 지역을 가리지 않는다.
 */
async function scanMine(dates, { scanRooms, scanCars, onDay, onProgress, signal }) {
  const days = [];
  const failed = [];
  let authError = null;
  const feed = (day) => {
    if (signal?.aborted) return;
    days.push(day);
    try { onDay?.(days); } catch { /* 화면 문제로 훑기를 멈추지는 않는다 */ }
  };
  const phase = async (idx, label, fn) => {
    // 카드를 껐으면 남은 바퀴는 돌지 않는다. 끈 뒤에도 사이트를 두드리면 끈 것이 아니다.
    if (signal?.aborted) return;
    try {
      await fn((date, i, n) => onProgress?.(idx, label, date, i, n));
    } catch (err) {
      if (err instanceof AuthError) authError = err;
      failed.push(`${label} 훑기 실패: ${err.message}`);
    }
  };
  await phase(0, '회의실', (p) => scanRooms(dates, p, { onDay: feed, signal }));
  await phase(1, '차량', (p) => scanCars(dates, p, { onDay: feed, signal }));
  return { days, failed, authError };
}

/* ------------------------------------------------------------ 그리기 */

const STYLE = `${CARD_STYLE}
.krs-mine:not(:has(.krs-mine-list:not([hidden]) .krs-mine-item, .krs-mine-warn:not(:empty), .krs-mine-bar:not([hidden]))) .krs-mine-body { display: none; }
.krs-mine .krs-mine-head.can-open { cursor: pointer; }
.krs-mine .krs-mine-bar { height: 3px; margin: 0 0 8px; border-radius: 2px; background: #e3eaf3; overflow: hidden; }
.krs-mine .krs-mine-bar[hidden] { display: none; }
.krs-mine .krs-mine-bar > i { display: block; width: 0; height: 100%; background: #1f4e9c; transition: width .3s; }
.krs-mine .krs-mine-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.krs-mine .krs-mine-list[hidden] { display: none; }
.krs-mine[aria-busy="true"] .krs-mine-list { opacity: .7; }
.krs-mine .krs-mine-item { display: flex; align-items: flex-start; gap: 9px; flex: 1 1 280px; max-width: 460px; padding: 8px 12px; border: 1px solid #d5dbe3; border-radius: 8px; background: #fff; color: #222; font-size: 13px; line-height: 1.35; cursor: pointer; }
.krs-mine .krs-mine-item:hover { border-color: #1f4e9c; background: #f5f8fc; }
.krs-mine .krs-mine-item.today { border-left: 3px solid #1f4e9c; }
.krs-mine .krs-mine-kind { flex: none; margin-top: 1px; padding: 2px 8px; border-radius: 10px; background: #e3edfb; color: #1f4e9c; font-size: 11px; font-weight: 700; white-space: nowrap; }
.krs-mine .krs-mine-kind.car { background: #e3f3ea; color: #1f7a45; }
.krs-mine .krs-mine-kind.trip { background: #fdecd8; color: #9a5200; }
.krs-mine .krs-mine-kind.out { background: #ece7fa; color: #5a3fa6; }
.krs-mine .krs-mine-kind.leave { background: #fbe5ec; color: #a8325c; }
.krs-mine .krs-mine-main { flex: 1; min-width: 0; }
.krs-mine .krs-mine-when { font-weight: 600; font-variant-numeric: tabular-nums; }
.krs-mine .krs-mine-status { margin-left: 6px; color: #607089; font-size: 11px; }
.krs-mine .krs-mine-sub { display: flex; gap: 6px; min-width: 0; margin-top: 2px; color: #607089; font-size: 12px; }
.krs-mine .krs-mine-room { flex: none; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.krs-mine .krs-mine-topic { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.krs-mine .krs-mine-topic::before { content: "·"; margin-right: 6px; color: #8798b0; }
.krs-mine .krs-mine-what { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.krs-mine .krs-mine-why { flex: none; margin-top: 2px; color: #8798b0; font-size: 11px; white-space: nowrap; }
.krs-mine .krs-mine-hide { display: flex; align-items: center; justify-content: center; flex: none; width: 24px; height: 22px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #8798b0; cursor: pointer; }
.krs-mine .krs-mine-hide:hover { background: #e3eaf3; color: #1f4e9c; }
.krs-mine .krs-mine-hide svg { display: block; pointer-events: none; }
.krs-mine .krs-mine-item.tucked { opacity: .55; }
.krs-mine .krs-mine-item.over { border-style: dashed; border-color: #1f4e9c; background: #eef4fd; }
.krs-mine .krs-mine-tag { display: flex; flex-direction: column; align-items: center; gap: 3px; flex: none; }
.krs-mine .krs-mine-state { color: #607089; font-size: 11px; line-height: 1.2; white-space: nowrap; }
.krs-mine .krs-mine-item.is-trip { flex: 0 1 auto; max-width: 500px; }
.krs-mine .krs-mine-item.is-trip .krs-mine-main { flex: 0 1 auto; }
.krs-mine .krs-mine-item.is-trip .krs-mine-sub, .krs-mine .krs-mine-item.is-trip .krs-mine-drop { width: 0; min-width: 100%; }
.krs-mine .krs-mine-marks { display: grid; grid-template-columns: repeat(3, 16px); gap: 5px 8px; flex: none; margin-top: 1px; }
.krs-mine .krs-mine-mark { display: inline-flex; color: #aab4c3; line-height: 1; }
.krs-mine .krs-mine-mark.on { color: #1f4e9c; }
.krs-mine .krs-mine-mark svg { display: block; pointer-events: none; }
.krs-mine button.krs-mine-mark { margin: -3px; padding: 3px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; }
.krs-mine button.krs-mine-mark:hover { background: #e3eaf3; color: #1f4e9c; }
.krs-mine .krs-mine-acts { display: grid; grid-template-rows: 18px 18px; row-gap: 3px; flex: none; }
.krs-mine .krs-mine-acts .krs-mine-hide { grid-row: 1; height: 18px; }
.krs-mine .krs-mine-bill { display: flex; align-items: center; justify-content: center; grid-row: 2; width: 24px; height: 18px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #aab4c3; cursor: pointer; }
.krs-mine .krs-mine-bill.doing { color: #2e9e5b; }
.krs-mine .krs-mine-bill.done { color: #1f4e9c; }
.krs-mine .krs-mine-bill:hover { background: #e3eaf3; color: #1f4e9c; }
.krs-mine .krs-mine-bill svg { display: block; pointer-events: none; }
.krs-mine .krs-mine-drop { display: block; margin-top: 4px; color: #1f7a45; font-size: 11.5px; word-break: keep-all; overflow-wrap: anywhere; }
.krs-mine .krs-mine-drop.busy { color: #607089; }
.krs-mine .krs-mine-drop.error { color: #a7691a; }
.krs-mine .krs-card-btn[aria-pressed="true"] { border-color: #1f4e9c; background: #e3edfb; color: #1f4e9c; }
.krs-mine .krs-mine-list:not(:empty, [hidden]) ~ .krs-mine-warn:not(:empty) { margin-top: 8px; }
.krs-mine .krs-mine-warn:not(:empty) + .krs-mine-warn:not(:empty) { margin-top: 2px; }
.krs-mine .krs-mine-login { margin-left: 4px; color: #1f4e9c; text-decoration: underline; }
`;

/** 근태 칩의 풍선말. 휴가는 연차·체력단련이고, 외근에는 같은 신청서로 올리는 교육이 들어간다. */
const PLAN_CHIP_TITLE = {
  trip: '오늘부터의 내 출장과, 다녀온 뒤 여비 정산이 덜 끝난 출장 (결재요청·결재완료)',
  out: '오늘부터의 내 외근·교육 (결재요청·결재완료)',
  leave: '오늘부터의 내 휴가 — 연차·체력단련 (결재요청·결재완료)',
};

/** 홈 카드의 공통 겉(homecard.js)을 만들고, 안쪽 목록은 우리 것으로 채운다. */
function buildStrip(doc) {
  const root = doc.createElement('div');
  root.id = ROOT_ID;
  root.className = 'row pt-3 mt-1 krs-card krs-mine';
  root.innerHTML = `<style>${STYLE}</style>
<div class="col-12">
  <div class="krs-card-panel">
    <div class="krs-card-head krs-mine-head" data-act="toggle">
      <span class="krs-card-title krs-mine-title">WORKSPACE</span>
      <span class="krs-card-chips">
        <span class="krs-card-chip" title="오늘부터의 내 회의실 예약"><span>회의실</span><b data-role="rooms"></b></span>
        <span class="krs-card-chip" title="오늘부터의 내 차량 예약"><span>차량</span><b data-role="cars"></b></span>
${PLAN_GROUPS.map((g) => `        <span class="krs-card-chip" title="${PLAN_CHIP_TITLE[g.key]}"><span>${g.label}</span><b data-role="${g.key}"></b></span>`).join('\n')}
      </span>
      <span class="krs-card-note" data-role="note"></span>
      <span class="krs-card-tools">
        <button type="button" class="krs-card-btn" data-act="all" aria-pressed="false" hidden>${ICON.eye}</button>
        <button type="button" class="krs-card-btn" data-act="refresh" title="새로고침 — 담아 둔 것을 버리고 사이트와 HR 을 다시 읽습니다" aria-label="새로고침">${ICON.refresh}</button>
        <button type="button" class="krs-card-btn" data-act="panel" title="예약 패널 열기 — 확장의 사이드 패널에서 예약·근태를 올리고 고칩니다" aria-label="예약 패널 열기">${ICON.panel}</button>
        <button type="button" class="krs-card-btn" data-act="toggle" data-role="toggle" aria-expanded="true" hidden>${ICON.chevron}</button>
      </span>
    </div>
    <div class="krs-card-body krs-mine-body">
      <div class="krs-mine-bar" data-role="bar" hidden><i data-role="fill"></i></div>
      <ul class="krs-mine-list" data-role="list"></ul>
      <p class="krs-card-warn krs-mine-warn" data-role="warn"></p>
      <p class="krs-card-warn krs-mine-warn" data-role="planWarn"></p>
    </div>
  </div>
</div>`;
  const q = (role) => root.querySelector(`[data-role="${role}"]`);
  return {
    root, head: root.querySelector('.krs-mine-head'), toggle: q('toggle'),
    rooms: q('rooms'), cars: q('cars'), note: q('note'), bar: q('bar'), fill: q('fill'),
    list: q('list'), warn: q('warn'), planWarn: q('planWarn'),
    plans: Object.fromEntries(PLAN_GROUPS.map((g) => [g.key, q(g.key)])),
    refresh: root.querySelector('[data-act="refresh"]'),
    showAll: root.querySelector('[data-act="all"]'),
  };
}

const HIDE_TITLE = '이 출장을 카드에서 숨깁니다 — 머리 줄의 눈 아이콘(전체 보기)으로 다시 볼 수 있습니다';
const SHOW_TITLE = '숨긴 출장입니다 — 누르면 다시 늘 보입니다';
const TRIP_TITLE = '누르면 예약 패널의 근태 탭을 엽니다 · 증빙(이미지·PDF)을 이 줄에 끌어다 놓거나, 마우스를 올리고 붙여 넣으면(Ctrl+V) 이 출장의 증빙으로 들어갑니다';

/** 근태 한 건. 예약과 같은 모양이고, 시각이 없으면(전일·오전·오후 휴가) 그 구분을 적는다. */
function planHtml(it, i, today) {
  const sameDay = it.from.date === it.to.date;
  const at = (d) => `${dayLabel(d.date, today)}${it.timed ? ` ${fmtTime(d.minutes)}` : ''}`;
  const when = sameDay
    ? `${dayLabel(it.from.date, today)} ${it.timed ? `${fmtTime(it.from.minutes)}~${fmtTime(it.to.minutes)}` : it.gubun}`.trim()
    : `${at(it.from)} ~ ${at(it.to)}`;
  // 며칠짜리 출장·휴가는 그 기간 내내 "오늘"이다.
  const now = it.from.date <= today && today <= it.to.date;
  // 지난 출장은 다녀온 뒤 4주(고른 기간) 동안 남아 있다 — 여비 정산을 올리라는 신호다. "다녀온 출장"과 여비계산서의 단계는
  // 글로 적지 않고 줄의 풍선말에 둔다(past — 2026-10-04 사용자 지정: 그 자리에 아이콘이 선다). 사후정산을 완료했거나 증빙을 보낸
  // 출장은 여기까지 오지 않는다.
  // 그 밖에 더 볼 일이 없는 것은 줄 끝의 눈 아이콘으로 숨긴다(2026-10-03 사용자 지정). 전체 보기에서는 숨긴 것이 흐리게 보이고,
  // 그 줄의 눈 아이콘이 다시 보이게 한다.
  const past = it.past ? `다녀온 출장${it.stage ? ` · ${it.stage}` : ''}` : '';
  const eye = !it.past ? ''
    : it.tucked ? `<button type="button" class="krs-mine-hide" data-act="show" data-doc="${escapeHtml(it.docNo)}" title="${SHOW_TITLE}" aria-label="이 출장 다시 보이기">${ICON.eye}</button>`
      : `<button type="button" class="krs-mine-hide" data-act="hide" data-doc="${escapeHtml(it.docNo)}" title="${HIDE_TITLE}" aria-label="이 출장 숨기기">${ICON.eyeOff}</button>`;
  // 출장 줄은 여비 증빙을 받는다 — 줄의 오른쪽에 아이콘 여섯(tripMarks)이 세 개씩 두 줄로 따로 서고(2026-10-04 사용자 지정 — 글 옆에 두면
  // 좁은 줄에서 아이콘만 가운데 줄로 떨어졌다), 내용 아래에 방금 넣은 증빙이 어떻게 됐는지 한 줄(it.drop)이 선다.
  // 보냄(종이비행기)은 누르는 것이다 — 보내기(2026-10-04 사용자 지정). 나머지 다섯은 보여 주기만 한다.
  const markHtml = (m) => (m.key === 'sent'
    ? `<button type="button" class="krs-mine-mark ${m.key}${m.on ? ' on' : ''}" data-act="send" data-doc="${escapeHtml(it.docNo)}" title="${escapeHtml(m.title)}" aria-label="${escapeHtml(m.title)}">${MARK_ICON[m.icon]}</button>`
    : `<span class="krs-mine-mark ${m.key}${m.on ? ' on' : ''}" role="img" title="${escapeHtml(m.title)}" aria-label="${escapeHtml(m.title)}">${MARK_ICON[m.icon]}</span>`);
  const marks = !it.marks ? '' : `<span class="krs-mine-marks" role="group" aria-label="${escapeHtml(past ? `여비 증빙 — ${past}` : '여비 증빙')}">${it.marks.map(markHtml).join('')}</span>`;
  // 계산서 보기 — 그 출장의 여비계산서 화면을 새 탭으로 연다. 그림은 패널의 계산서 버튼과 같다(문서 안의 1·2, 색이 단계).
  // 계산서가 없으면(또는 목록을 아직 못 읽었으면) 회색 1 이고 누르면 까닭을 말한다.
  const billTip = !it.bill ? '' : it.bill.seq ? `계산서 보기 — 여비계산서 ${it.bill.seq} · ${it.bill.label} · 누르면 새 탭에서 엽니다` : `계산서 보기 — ${it.bill.why}`;
  const bill = !it.bill ? '' : `<button type="button" class="krs-mine-bill ${it.bill.state}" data-act="bill" data-doc="${escapeHtml(it.docNo)}" `
    + `title="${escapeHtml(billTip)}" aria-label="${escapeHtml(billTip)}"${it.bill.seq ? '' : ' aria-disabled="true"'}>${billIcon(it.bill.digit)}</button>`;
  // 줄 끝의 누르는 것들 — 위에 숨기기(다녀온 출장만), 아래에 계산서 보기. 아이콘 두 줄과 높이를 맞춘다.
  const acts = it.marks ? `<span class="krs-mine-acts">${eye}${bill}</span>` : eye;
  const drop = !it.drop?.text ? '' : `<span class="krs-mine-drop${it.drop.busy ? ' busy' : it.drop.error ? ' error' : ''}">${escapeHtml(it.drop.text)}</span>`;
  const cls = `krs-mine-item${now ? ' today' : ''}${it.past ? ' past' : ''}${it.tucked ? ' tucked' : ''}${it.marks ? ' is-trip' : ''}`;
  const doc = it.marks ? ` data-doc="${escapeHtml(it.docNo)}"` : '';
  const tip = `${past ? `${past} — ` : ''}${it.marks ? TRIP_TITLE : '누르면 예약 패널의 근태 탭을 엽니다'}`;
  // 결재 상태는 종류 딱지 아래에 줄인 말(신청·승인)로 적는다(2026-10-04 사용자 지정 — 날짜 옆의 "결재완료"를 이리로 옮겼다).
  // HR 의 이름 그대로는 풍선말에 있다.
  const state = it.state ? `<span class="krs-mine-state" title="${escapeHtml(it.status)}">${escapeHtml(it.state)}</span>` : '';
  return `<li class="${cls}" data-i="${i}"${doc} title="${escapeHtml(tip)}">`
    + `<span class="krs-mine-tag"><span class="krs-mine-kind ${it.group}">${escapeHtml(it.label)}</span>${state}</span>`
    + '<span class="krs-mine-main">'
    + `<span class="krs-mine-when">${escapeHtml(when)}</span>`
    // 출장 줄의 내용은 날짜·시각이 끝나는 데까지만 적고 줄인다(같은 날 사용자 지정, CSS) — 전체는 풍선말에 있다.
    + (it.title ? `<span class="krs-mine-sub"><span class="krs-mine-what" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</span></span>` : '')
    + drop
    + '</span>' + marks + acts + '</li>';
}

function itemHtml(it, i, today) {
  if (it.kind === 'attend') return planHtml(it, i, today);
  const sameDay = it.from.date === it.to.date;
  const when = sameDay
    ? `${dayLabel(it.from.date, today)} ${fmtTime(it.from.minutes)}~${fmtTime(it.to.minutes)}`
    : `${dayLabel(it.from.date, today)} ${fmtTime(it.from.minutes)} ~ ${dayLabel(it.to.date, today)} ${fmtTime(it.to.minutes)}`;
  const why = WHY_LABEL[it.why] || '';
  return `<li class="krs-mine-item${it.from.date === today ? ' today' : ''}" data-i="${i}" title="누르면 예약 패널에서 이 날짜를 엽니다">`
    + `<span class="krs-mine-kind ${it.kind}">${it.kind === 'car' ? '차량' : '회의실'}</span>`
    + '<span class="krs-mine-main">'
    + `<span class="krs-mine-when">${escapeHtml(when)}</span>`
    + (it.status ? `<span class="krs-mine-status">${escapeHtml(it.status)}</span>` : '')
    + '<span class="krs-mine-sub">'
    + `<span class="krs-mine-room">${escapeHtml(it.room)}</span>`
    + (it.title ? `<span class="krs-mine-topic">${escapeHtml(it.title)}</span>` : '')
    + '</span></span>'
    + (why ? `<span class="krs-mine-why" title="이 건을 내 것으로 본 근거">${why}</span>` : '')
    + '</li>';
}

/* ------------------------------------------------------------ 붙이기 */

/** 배경(서비스 워커)에게 이 탭에 패널을 열어 달라고 한다. 콘텐츠 스크립트는 sidePanel API 를 직접 못 부른다. */
async function defaultOpenPanel() {
  const r = await chrome.runtime.sendMessage({ type: 'openSidePanel' });
  return r || { ok: false, error: '응답이 없습니다' };
}

/**
 * 배경(서비스 워커)에게 근태를 읽어 달라고 한다. HR 은 다른 출처이고 HR 작업 탭을 거쳐야 읽히는데,
 * 콘텐츠 스크립트에는 탭을 다루는 API 가 없다. 배경은 읽은 것을 storage(PLANS_KEY)에도 담는다.
 * @returns {Promise<{items: object[], error: string}>}
 */
async function defaultLoadPlans({ force = false } = {}) {
  const r = await chrome.runtime.sendMessage({ type: 'hrPlans', force });
  return r || { items: [], error: '응답이 없습니다' };
}

/**
 * 여비계산서 목록을 읽는 길(src/trip.js 의 tripList). 홈은 eclass 와 같은 출처라 여기서 바로 읽힌다.
 * 카드에 출장이 올라와 있을 때만 쓰므로 그때 불러온다.
 */
async function defaultListTrips(range) {
  const { tripList } = await import('./trip.js');
  return tripList(range);
}

/** 사전정산의 교통편 줄을 읽는 길(src/trip.js 의 tripPreDetail) — 출장 줄의 가는 편·오는 편 아이콘이 본다. 읽기만 한다. */
async function defaultPreDetail(seq) {
  const { tripPreDetail } = await import('./trip.js');
  return tripPreDetail(seq);
}

/**
 * 배경(서비스 워커)에게 증빙 한 장을 받아 달라고 한다(src/intake.js) — Claude 로 읽고 보관함(확장의 IndexedDB)에 담는 일은
 * 콘텐츠 스크립트에서 할 수 없다.
 * @param {{docNo: string, trip: object, me: string, file: {name: string, type: string, dataUrl: string}, settled: boolean}} ask
 */
async function defaultKeepEvidence(ask) {
  const r = await chrome.runtime.sendMessage({ type: 'evidenceKeep', ...ask });
  return r || { ok: false, error: '응답이 없습니다' };
}

/** 배경에게 보관함에 무엇이 들어 있는지 줄여 적어 달라고 한다(MARKS_KEY). 적어 둔 것이 없을 때와 새로고침 때다. */
async function defaultSyncMarks() {
  const r = await chrome.runtime.sendMessage({ type: 'evidenceMarks' });
  return r || { ok: false, error: '응답이 없습니다' };
}

/** 여비계산서 화면(계산서)을 새 탭으로 연다 — 출장 줄의 `계산서 보기`. 패널의 출장 카드가 여는 것과 같은 화면이다. 읽기만 하는 일이다. */
async function defaultOpenBill(seq, trseq) {
  const { tripCalUrl } = await import('./trip.js');
  window.open(tripCalUrl(seq, trseq), '_blank', 'noopener');
}

/** File → data URL. */
function defaultReadFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    fr.readAsDataURL(file);
  });
}

/**
 * 이 스크립트가 아직 확장과 이어져 있는가. 확장을 다시 올리면(업데이트·새로고침) 먼저 열려 있던 홈의
 * 스크립트는 끊겨 runtime.id 가 사라지고, 그 뒤로 storage·메시지는 "Extension context invalidated" 만 던진다.
 */
const defaultAlive = () => typeof chrome === 'undefined' || !!chrome.runtime?.id;

/** storage 변화를 듣는다. 돌려주는 함수로 그만 듣는다 — 카드를 끄면 떼어야 한다. */
function defaultOnChanged(fn) {
  const ev = chrome.storage.onChanged;
  if (!ev) return () => {};
  ev.addListener(fn);
  return () => ev.removeListener(fn);
}

/**
 * 홈 문서에 카드를 붙이고 첫 조회가 끝날 때까지 기다린다.
 * @returns {Promise<object|null>} createHomeCard 의 손잡이. 알아보는 자리가 없으면 null
 */
export async function mountHome(doc, deps = {}) {
  const card = createHomeCard(doc, deps);
  if (!card) return null;
  await card.ready;
  return card;
}

/**
 * 설정(ENABLE_KEY)을 따라 카드를 붙이거나 뗀다. 콘텐츠 스크립트는 이것을 부른다.
 *
 * 패널에서 체크박스를 바꾸면 열려 있는 홈에도 곧바로 반영된다 — 끄면 카드가 사라지고 도는 훑기도 멈추고,
 * 켜면 새로고침 없이 다시 붙는다.
 * @returns {Promise<{card: object|null, stop: Function}>}
 */
export async function startHome(doc, deps = {}) {
  const storage = deps.storage || chrome.storage.local;
  const onChanged = deps.onChanged || defaultOnChanged;
  let card = null;

  const apply = (on) => {
    if (on && !card) card = createHomeCard(doc, deps);
    else if (!on && card) {
      card.destroy();
      card = null;
    }
  };

  const off = onChanged((changes, area) => {
    if (area && area !== 'local') return;
    if (ENABLE_KEY in changes) apply(homeEnabled(changes[ENABLE_KEY].newValue));
  });

  const saved = await storage.get(ENABLE_KEY);
  apply(homeEnabled(saved?.[ENABLE_KEY]));
  await card?.ready;

  return {
    get card() { return card; },
    stop() {
      off?.();
      apply(false);
    },
  };
}

/**
 * 홈 문서에 카드를 붙이고 첫 조회를 시작한다. 조회를 기다리지 않고 곧바로 손잡이를 돌려준다
 * — 서른 날을 훑는 동안에도 끌 수 있어야 하기 때문이다.
 *
 * 바깥 것은 모두 주입받는다(storage·훑기·시각·패널 열기) — 테스트가 가짜로 돌리기 위해서다.
 * @returns {{root: Element, ready: Promise, refresh: Function, destroy: Function}|null}
 *   알아보는 자리가 없으면 null
 */
export function createHomeCard(doc, deps = {}) {
  const anchor = findAnchor(doc);
  if (!anchor) return null;

  const storage = deps.storage || chrome.storage.local;
  const onChanged = deps.onChanged || defaultOnChanged;
  const now = deps.now || (() => Date.now());
  const today = deps.today || todayStr;
  const scanRooms = deps.scanRooms || scanDays;
  const scanCars = deps.scanCars || scanCarDays;
  const debounceMs = deps.debounceMs ?? RESCAN_DEBOUNCE_MS;
  const openPanel = deps.openPanel || defaultOpenPanel;
  const loadPlans = deps.loadPlans || defaultLoadPlans;
  const listTrips = deps.listTrips || defaultListTrips;
  const preDetail = deps.preDetail || defaultPreDetail;
  const keepEvidence = deps.keepEvidence || defaultKeepEvidence;
  const syncMarks = deps.syncMarks || defaultSyncMarks;
  const openBill = deps.openBill || defaultOpenBill;
  const readFile = deps.readFile || defaultReadFile;
  const visible = deps.visible || (() => doc.visibilityState !== 'hidden');
  const alive = deps.alive || defaultAlive;

  // 확장을 다시 올렸거나 두 번 불렸으면 먼저 것은 치운다.
  doc.getElementById(ROOT_ID)?.remove();
  const ui = buildStrip(doc);
  if (anchor.mode === 'before') anchor.el.parentElement.insertBefore(ui.root, anchor.el);
  else anchor.el.prepend(ui.root);

  // items 는 회의실·차량 예약, plans 는 근태. 아직 모르면 null 이다 — 못 읽은 것을 0 건이라고 하지 않는다.
  // all 은 둘을 날짜순으로 섞은, 화면에 그린 그대로의 목록이다. raw 는 읽어 둔 근태 그대로({ items, start, end }) —
  // 다녀온 출장을 고르는 규칙이 바뀌면 여기서 다시 고른다.
  const view = { items: null, plans: null, all: [], raw: null };
  // 다녀온 출장을 고르는 규칙(src/settling.js): 며칠 뒤까지 남기는가, 증빙을 보낸 기록, 읽어 둔 여비계산서 목록(모르면 null).
  let back = TRIP_LOOKBACK_DAYS;
  let sent = {};
  let stages = null;
  let stageRun = null;     // 지금 도는 여비계산서 목록 읽기
  // 출장 줄의 아이콘이 보는 것: 보관함의 증빙(MARKS_KEY — 아직 모르면 null), 패널에서 고른 가는 편·오는 편(PICKS_KEY),
  // 사전정산의 가는 편·오는 편(LEGS_KEY — 오늘 읽은 것만).
  let kept = null;
  let picks = {};
  let legs = { day: '', by: {} };
  let legRun = null;             // 지금 도는 사전정산 교통편 읽기
  const legTried = new Set();    // 이 화면에서 읽어 본 계산서 — 못 읽은 것을 그릴 때마다 다시 두드리지 않는다
  let marksAsked = false;        // 보관함을 줄여 적어 달라고 배경에 부탁했는가(적어 둔 것이 없을 때 한 번)
  const drops = new Map();       // 신청서 번호 → 방금 넣은 증빙이 어떻게 됐는지({ busy, error, text })
  let hot = '';                  // 마우스가 올라가 있는 출장 줄의 신청서 번호 — 붙여넣기가 갈 곳이다
  let hidden = new Set();  // 숨긴 "다녀온 출장"의 신청서 번호(HIDDEN_KEY)
  let showAll = false;     // 전체 보기 — 숨긴 출장까지 보는 중인가(이 화면에서만, 기억하지 않는다)
  let open = true;         // 목록을 펴 두었는가. 접은 것은 기억한다(FOLD_KEY)
  let running = null;      // 지금 도는 훑기. 한 번에 하나만.
  let rerun = false;       // 도는 중에 다시 훑을 일이 생겼다
  let needRescan = false;  // 안 보이는 사이에 생긴 일. 보이면 훑는다
  let debounce = null;
  let planRun = null;      // 지금 도는 근태 읽기. 훑기와 따로 돈다.
  let planRerun = false;
  let needPlans = false;
  let planDebounce = null;
  let disposed = false;    // 카드를 뗐다. 그 뒤로는 아무것도 하지 않는다
  const stopper = new AbortController();

  const setBusy = (on) => {
    ui.root.setAttribute('aria-busy', String(on));
    ui.refresh.disabled = on;
  };

  /** 목록을 펴거나 접는다. 접혀 있어도 머리 줄의 건수 칩과 본문의 경고·진행 막대는 보인다. */
  function setOpen(on) {
    open = on;
    ui.list.hidden = !open;
    const label = open ? '접기' : '펼치기';
    ui.toggle.setAttribute('aria-expanded', String(open));
    ui.toggle.setAttribute('aria-label', label);
    ui.toggle.title = label;
    ui.head.title = view.all.length ? `클릭: ${label}` : '';
  }
  setOpen(true);
  // 접어 둔 것을 기억해 두었으면 접은 채로 시작한다. 못 읽으면(확장과 끊김) 펴 둔다. 읽는 사이에 이미 접거나 폈으면
  // (눌렀거나 다른 창에서 바꿨다) 늦게 온 이 답은 버린다 — 예전 값이 방금 고른 것을 덮지 않게.
  let foldChosen = false;
  Promise.resolve().then(() => storage.get(FOLD_KEY)).then((saved) => {
    if (!disposed && !foldChosen && saved?.[FOLD_KEY] === true) setOpen(false);
  }).catch(() => {});

  const isTrip = (p) => p.kind === 'attend' && p.group === 'trip';
  /** 그 출장의 여비계산서(기간과 출장자가 같은 것). 목록을 못 읽었거나 계산서가 없으면 null. */
  const docOf = (p) => (stages?.rows ? tripDocFor({ from: p.from.date, to: p.to.date }, stages.rows, stages.me) : null);
  /**
   * 그 출장 줄의 `계산서 보기`가 열 계산서 — 번호·내 출장자 번호·지금 단계와, 그림에 적을 숫자·색(tripIconState).
   * 계산서가 없거나 목록을 아직 못 읽었으면 번호 없이 까닭만 든다.
   */
  function billFor(p) {
    const row = docOf(p);
    if (!row) return { ...tripIconState(null, null), seq: '', why: stages?.rows ? '여비계산서가 없습니다' : '여비계산서 목록을 아직 읽지 못했습니다' };
    const me = row.travelers.find((t) => t.name === stages.me) || row.travelers[0];
    const stage = tripStage(row, stages.me);
    return { ...tripIconState(row, stage), seq: row.seq, trseq: me?.trseq || '', label: stage.label };
  }
  /** 그 출장 줄의 아이콘 여섯 — 지금 아는 것(여비계산서·사전정산의 편·패널에서 고른 편·보관함·보낸 기록)으로 짓는다. */
  function marksFor(p) {
    const row = docOf(p);
    return tripMarks({
      doc: row, known: !!stages?.rows, legs: row ? legs.by[row.seq] || null : null, picks: picks[p.docNo], kept: kept?.[p.docNo] || [], sent: sent[p.docNo] || null,
    });
  }

  /**
   * 예약과 근태를 한 목록에 날짜순으로 섞어 그리고, 칩에 건수를 적는다. 숨긴 "다녀온 출장"은 빼고 그린다 —
   * 숨긴 것이 있으면 머리 줄에 눈 아이콘(전체 보기)이 나오고, 켜면 숨긴 것까지 흐리게 보인다. 칩은 숨기지 않은 건수다.
   */
  function paint() {
    const t = today();
    const items = view.items || [];
    const every = (view.plans || []).map((p) => ({
      ...p, tucked: p.past && hidden.has(p.docNo),
      ...(isTrip(p) ? { marks: marksFor(p), drop: drops.get(p.docNo) || null, bill: billFor(p) } : {}),
    }));
    const tucked = every.filter((p) => p.tucked).length;
    if (!tucked) showAll = false;
    const plans = every.filter((p) => showAll || !p.tucked);
    ui.showAll.hidden = !tucked;
    ui.showAll.setAttribute('aria-pressed', String(showAll));
    ui.showAll.title = showAll ? `숨긴 출장 ${tucked}건까지 보는 중 — 누르면 다시 가립니다` : `전체 보기 — 숨긴 출장 ${tucked}건까지 봅니다`;
    ui.showAll.setAttribute('aria-label', ui.showAll.title);
    view.all = [...items, ...plans].sort((a, b) =>
      a.from.date.localeCompare(b.from.date) || a.from.minutes - b.from.minutes);
    const cars = items.filter((it) => it.kind === 'car').length;
    setChip(ui.rooms, view.items ? items.length - cars : null);
    setChip(ui.cars, view.items ? cars : null);
    for (const g of PLAN_GROUPS) {
      setChip(ui.plans[g.key], view.plans ? plans.filter((p) => p.group === g.key && !p.tucked).length : null);
    }
    ui.list.innerHTML = view.all.map((it, i) => itemHtml(it, i, t)).join('');
    // 접을 것이 없으면 화살표 버튼도 두지 않는다.
    ui.toggle.hidden = !view.all.length;
    ui.head.classList.toggle('can-open', view.all.length > 0);
    setOpen(open);
  }

  function paintList(items) {
    view.items = items;
    paint();
  }

  /** 읽어 둔 근태에서 카드에 올릴 것을 지금 규칙(다녀온 출장을 몇 주까지 · 정산이 끝난 것은 뺌)으로 다시 고른다. */
  function pick() {
    if (!view.raw) return;
    view.plans = planItems(view.raw.items, view.raw.start, view.raw.end,
      { backDays: back, settled: settledBy({ sent, stages }), note: (p) => stageNote(p, stages) });
    paint();
  }

  /**
   * 출장이 올라와 있는데 그 여비계산서를 모르면 목록을 읽어(하루에 한 번) 다시 고른다 — 사후정산이 완료된 다녀온 출장이 빠지고,
   * 출장 줄마다 계산서가 걸려 아이콘과 증빙 받기가 된다. 보이는 출장의 가장 늦은 끝 날까지 읽는다(앞으로의 출장의 계산서도 본다).
   * 출장이 한 건도 없으면 읽지 않는다. 못 읽어도 말하지 않는다 — 그 출장이 그대로 보일 뿐이다.
   */
  async function wantStages(force = false) {
    const trips = (view.plans || []).filter(isTrip);
    if (disposed || !alive() || !trips.length) return;
    // 보관함에 무엇이 있는지는 따로 묻는다 — 여비계산서를 못 읽어도 증빙 아이콘은 그려진다.
    const marks = force || (kept === null && !marksAsked) ? askMarks() : null;
    const until = trips.reduce((a, p) => (p.to.date > a ? p.to.date : a), today());
    // 출장지가 안 적힌 것은 예전 모양으로 담아 둔 목록이다 — 증빙을 읽을 때 출장지를 알려 줘야 하므로 다시 읽는다.
    const bare = !!stages?.rows?.some((r) => r.location === undefined);
    if (force || bare || !stagesFresh(stages, today(), until)) {
      stageRun ||= readStages({ list: listTrips, force: force || bare, storage, today: today(), until }).finally(() => { stageRun = null; });
      const got = await stageRun;
      if (disposed) return;
      if (got) {
        stages = got;
        pick();
      }
    }
    await wantLegs(force);
    await marks;
  }

  /**
   * 출장 줄의 가는 편·오는 편 아이콘이 볼 사전정산의 교통편을 읽는다 — 계산서마다 하루에 한 번이고(LEGS_KEY), 읽는 대로 그린다.
   * 못 읽으면 그 편의 아이콘이 회색으로 남을 뿐이다. force(새로고침)면 담아 둔 것을 버리고 다시 읽는다.
   */
  function wantLegs(force = false) {
    if (disposed || !alive() || !stages?.rows) return undefined;
    if (legRun) return legRun;
    const t = today();
    if (force || legs.day !== t) {
      legs = { day: t, by: {} };
      legTried.clear();
    }
    const rows = new Map((view.plans || []).filter(isTrip).map(docOf).filter(Boolean).map((r) => [r.seq, r]));
    const todo = [...rows.values()].filter((r) => !(r.seq in legs.by) && !legTried.has(r.seq));
    if (!todo.length) return undefined;
    legRun = (async () => {
      let got = false;
      for (const row of todo) {
        if (disposed) return;
        legTried.add(row.seq);
        try {
          const detail = await preDetail(row.seq);
          if (disposed) return;
          legs.by[row.seq] = legsSlim(detail.rows, row);
          got = true;
          paint();
        } catch { /* 못 읽은 편은 회색으로 남는다 */ }
      }
      if (got) await storage.set({ [LEGS_KEY]: legs }).catch(() => {});
    })().finally(() => { legRun = null; });
    return legRun;
  }

  /**
   * 보관함에 무엇이 들어 있는지(MARKS_KEY)를 배경에 줄여 적어 달라고 한다 — 적어 둔 것이 아직 없을 때 한 번, 그리고 새로고침 때다.
   * 답이 오면 그것으로 그린다(배경이 저장소에도 적으므로 다른 창의 홈도 따라온다). 못 받아도 말하지 않는다 — 아이콘이 회색일 뿐이다.
   */
  async function askMarks() {
    marksAsked = true;
    const r = await syncMarks().catch(() => null);
    if (disposed || !r?.ok || !r.marks) return;
    kept = r.marks;
    paint();
  }

  /**
   * 출장 줄에 놓거나 붙여 넣은 파일을 그 출장의 증빙으로 넣는다(2026-10-04 사용자 지정). 배경이 한 장씩 읽어 증빙으로 쓸 수 있는 것만
   * 보관함에 담고(src/intake.js), 어떻게 됐는지는 그 줄에 적는다 — 아이콘은 보관함이 바뀐 것(MARKS_KEY)을 보고 따라온다.
   * 여비계산서는 바꾸지 않는다. 사후정산이 완료된 출장이면 읽지 않고 보낼 증빙으로 담는다(패널의 출장 카드와 같다).
   */
  async function takeFiles(it, fileList) {
    if (disposed || orphaned() || drops.get(it.docNo)?.busy) return;
    const say = (state) => {
      drops.set(it.docNo, state);
      paint();
    };
    const row = docOf(it);
    if (!row) {
      say({ error: true, text: stages?.rows
        ? '여비계산서가 없는 출장이라 증빙을 받지 못했습니다 — 예약 패널의 근태 탭에서 여비계산서를 확인해 주세요'
        : '여비계산서 목록을 아직 읽지 못해 증빙을 받지 못했습니다 — 새로고침한 뒤 다시 넣어 주세요' });
      return;
    }
    const stage = tripStage(row, stages.me);
    const settled = stage.phase === 'post' && stage.done;
    const trip = { seq: row.seq, from: row.from, to: row.to, location: row.location || '' };
    const lines = [];
    const files = [];
    let bad = false;
    for (const f of fileList) {
      const no = !acceptsFile(EVIDENCE_ACCEPT, f) ? '이미지나 PDF 가 아니라 뺐습니다'
        : f.size > INTAKE_LIMIT ? `너무 큽니다(${Math.round(f.size / 1048576)}MB) — 10MB 이하로 넣어 주세요` : '';
      try {
        if (no) throw new Error(no);
        files.push({ name: f.name, type: f.type, dataUrl: await readFile(f) });
      } catch (err) {
        bad = true;
        lines.push(`${f.name}: ${err.message}`);
      }
    }
    let todo = false;
    for (const [i, f] of files.entries()) {
      say({ busy: true, text: `증빙을 ${settled ? '담는' : '읽는'} 중 (${i + 1}/${files.length}) — ${f.name}` });
      const r = await keepEvidence({ docNo: it.docNo, trip, me: stages.me || '', file: f, settled }).catch((err) => ({ ok: false, error: err.message }));
      if (disposed) return;
      if (r?.ok && r.kept) {
        lines.push(`${r.name}: ${r.label}으로 보관했습니다`);
        todo ||= !!r.todo;
      } else {
        bad = true;
        lines.push(r?.ok ? `${r.name}: ${r.label} ✗ — ${r.note}` : `${f.name}: ${r?.error || '응답이 없습니다'}`);
      }
    }
    say({ error: bad, text: `${lines.join(' · ')}${todo ? ' · 사후정산에는 예약 패널의 출장 카드에서 올립니다' : ''}` });
  }

  /** 숨긴 출장을 바꿔 담고 다시 그린다. 목록에서 이미 빠진 출장(고른 기간이 지났다)의 번호는 버린다. */
  async function setHidden(docNos) {
    const live = new Set((view.plans || []).filter((p) => p.past).map((p) => p.docNo));
    hidden = new Set(docNos.filter((d) => live.has(d)));
    paint();
    await storage.set({ [HIDDEN_KEY]: [...hidden] });
  }

  function paintProgress(range, phase, label, date, i, n) {
    ui.bar.hidden = false;
    ui.fill.style.width = `${Math.round(((phase * n + i) / (n * 2)) * 100)}%`;
    ui.note.textContent = `${range} · ${label} 훑는 중 ${i}/${n}${date ? ` · ${shortLabel(date)}` : ''}`;
  }

  /** 담긴(또는 방금 훑은) 결과를 그린다. 언제 읽은 것인지, 무엇을 못 읽었는지 같이 적는다. */
  function paintResult(cache, name) {
    const dates = datesFrom(cache.start, cache.days);
    const range = rangeText(dates);
    paintList(cache.items);
    ui.bar.hidden = true;
    ui.note.textContent = `${range} · ${agoText(cache.at, now())} 읽음`;
    ui.note.title = new Date(cache.at).toLocaleString();

    const warn = [];
    if (!name) warn.push('이름을 넣으면 예약자 이름으로도 찾습니다 — 예약 패널의 "설정 및 연결"');
    if (cache.skippedDates?.length) warn.push(`⚠ ${cache.skippedDates.length}일은 확인 불가라 제외했습니다`);
    if (cache.unread?.length) warn.push(`⚠ ${cache.unread.length}일은 아예 읽지 못했습니다`);
    warn.push(...(cache.failed || []));
    ui.warn.textContent = warn.join(' · ');
  }

  /** 잠깐 보였다 사라지는 안내. 경고 줄을 빌려 쓰고 원래 글로 되돌린다. */
  function flash(msg) {
    const prev = ui.warn.textContent;
    ui.warn.textContent = msg;
    setTimeout(() => { if (ui.warn.textContent === msg) ui.warn.textContent = prev; }, 6000);
  }

  /**
   * 확장과 끊겼으면 그렇다고 말한다. 끊긴 카드는 읽어 둔 것을 보여줄 뿐 더 할 수 있는 일이 없다
   * — 조용히 오류만 내느니 어떻게 되살리는지 적는다.
   */
  function orphaned() {
    if (alive()) return false;
    ui.warn.textContent = '확장이 다시 올려져 이 카드는 멈췄습니다. 페이지를 새로고침하면 다시 붙습니다.';
    return true;
  }

  /**
   * 담긴 것을 보여주고, 필요하면 훑는다.
   *   오늘 읽어 둔 것이 없다       → 훑는다(진행 막대). 하루에 한 번이 여기다
   *   오늘 읽어 둔 것이 있다       → 그것만 보여준다. 몇 시간이 지났어도 다시 훑지 않는다
   *   force(새로고침·예약 변경)    → 먼저 보여주고 다시 훑어 바꿔 끼운다
   */
  async function run({ force = false } = {}) {
    if (disposed || orphaned()) return undefined;
    if (running) {
      if (force) rerun = true;
      return running;
    }
    running = (async () => {
      const saved = await storage.get(['myName', 'justBooked', 'spanDays', CACHE_KEY]);
      if (disposed) return;
      const name = String(saved.myName || '').trim();
      const booked = Array.isArray(saved.justBooked) ? saved.justBooked : [];
      const days = spanOf(saved.spanDays);
      const start = today();
      const dates = datesFrom(start, days);
      const range = rangeText(dates);
      const cache = saved[CACHE_KEY];
      const usable = cacheUsable(cache, { start, days, name });

      if (usable) paintResult(cache, name);
      if (usable && !force) return;

      setBusy(true);
      if (!usable) ui.warn.textContent = '';
      ui.note.textContent = `${range} · 훑는 중...`;
      try {
        const res = await scanMine(dates, {
          scanRooms, scanCars,
          // 읽는 대로 목록이 차오르게 한다. 서른 날을 다 기다린 뒤에야 첫 줄이 보이면 아무것도 안 하는 것처럼 보인다.
          onDay: (soFar) => paintList(summarize(dates, soFar, { name, booked }).items),
          onProgress: (phase, label, date, i, n) => paintProgress(range, phase, label, date, i, n),
          signal: stopper.signal,
        });
        // 도중에 껐다. 반쯤 읽은 것을 담으면 다음에 켰을 때 "다 읽은 것"처럼 보인다.
        if (disposed) return;

        if (!res.days.length) {
          // 한 날도 못 읽었다. 목록이 아니라 그 사실을 보여주고, 담지도 않는다 — 다음에 열면 다시 시도한다.
          if (usable) paintResult(cache, name);
          else { ui.bar.hidden = true; ui.note.textContent = range; }
          const why = res.authError ? res.authError.message : res.failed.join(' · ');
          ui.warn.textContent = `${why}${usable ? ` (아래는 ${agoText(cache.at, now())} 읽어 둔 것입니다)` : ''}`;
          // 포털 로그인이 풀린 것이면 지금 보이는 홈도 껍데기만 남은 것이다(밤새 열어 둔 탭).
          // 홈을 다시 열면 로그인 폼을 거쳐 돌아오고, 그러면 카드도 새로 붙어 훑는다.
          if (res.authError?.portal === 'expired') {
            const a = doc.createElement('a');
            a.href = PORTAL_HOME_URL;
            a.className = 'krs-mine-login';
            a.textContent = 'eclass 다시 로그인';
            ui.warn.append(' ', a);
          }
          return;
        }

        const payload = {
          at: now(), start, days, name,
          ...summarize(dates, res.days, { name, booked, failed: res.failed }),
        };
        await storage.set({ [CACHE_KEY]: payload });
        paintResult(payload, name);
      } catch (err) {
        ui.bar.hidden = true;
        // 훑는 사이에 확장이 다시 올려졌으면 결과를 담다가 여기로 온다.
        if (!orphaned()) ui.warn.textContent = `훑기 실패: ${err.message}`;
      } finally {
        setBusy(false);
      }
    })().finally(() => {
      running = null;
      if (rerun && !disposed) {
        rerun = false;
        run({ force: true });
      }
    });
    return running;
  }

  /**
   * 근태(출장·외근·휴가)를 읽어 그린다. 회의실·차량 훑기와 따로 돈다.
   *   오늘 읽어 둔 것이 있다(패널이 읽었든 배경이 읽었든) → 그것만 보여준다
   *   없다 · force(새로고침)                           → 배경에게 읽어 달라고 한다
   * 못 읽으면 칩을 0 으로 두지 않고(줄표) 그 사실을 적는다.
   */
  function runPlans({ force = false } = {}) {
    if (disposed || !alive()) return undefined;
    if (planRun) {
      if (force) planRerun = true;
      return planRun;
    }
    planRun = (async () => {
      const saved = await storage.get(['spanDays', PLANS_KEY, HIDDEN_KEY, BACK_KEY, SENT_KEY, STAGES_KEY, MARKS_KEY, PICKS_KEY, LEGS_KEY]);
      if (disposed) return;
      hidden = new Set(Array.isArray(saved[HIDDEN_KEY]) ? saved[HIDDEN_KEY] : []);
      const start = today();
      back = backWeeksOf(saved[BACK_KEY]) * 7;
      sent = saved[SENT_KEY] || {};
      stages = stagesFresh(saved[STAGES_KEY], start) ? saved[STAGES_KEY] : null;
      kept = objectOr(saved[MARKS_KEY], null);
      picks = objectOr(saved[PICKS_KEY], {});
      if (saved[LEGS_KEY]?.day === start) legs = { day: start, by: { ...objectOr(saved[LEGS_KEY].by, {}), ...(legs.day === start ? legs.by : {}) } };
      const dates = datesFrom(start, spanOf(saved.spanDays));
      const show = (raw) => {
        view.raw = { items: raw, start, end: dates[dates.length - 1] };
        pick();
      };
      const cache = saved[PLANS_KEY];
      const fresh = plansFresh(cache, start, start);
      if (fresh) show(cache.items);
      if (fresh && !force) {
        ui.planWarn.textContent = '';
        await wantStages();
        return;
      }
      const r = await loadPlans({ force });
      if (disposed) return;
      if (!r.error) show(r.items || []);
      ui.planWarn.textContent = r.error
        ? `⚠ 근태(출장·외근·휴가)는 읽지 못했습니다: ${r.error}${fresh ? ' (보이는 근태는 먼저 읽어 둔 것입니다)' : ''}`
        : '';
      await wantStages(force);
    })().catch((err) => {
      // 읽는 사이에 확장이 다시 올려졌으면 예약 쪽이 그 안내를 한다.
      if (!disposed && alive()) ui.planWarn.textContent = `⚠ 근태(출장·외근·휴가)는 읽지 못했습니다: ${err.message}`;
    }).finally(() => {
      planRun = null;
      if (planRerun && !disposed) {
        planRerun = false;
        runPlans({ force: true });
      }
    });
    return planRun;
  }

  /** 근태가 바뀌었을 수 있다(패널이 담아 둔 것을 지웠다). 보이면 곧 읽고, 안 보이면 보일 때 읽는다. */
  function wantPlans() {
    if (disposed) return;
    if (!visible()) {
      needPlans = true;
      return;
    }
    clearTimeout(planDebounce);
    planDebounce = setTimeout(() => runPlans(), debounceMs);
  }

  /** 예약이 바뀌었을 수 있다. 보이면 곧(몰려오는 알림은 모아서) 훑고, 안 보이면 보일 때 훑는다. */
  function wantRescan() {
    if (disposed) return;
    if (!visible()) {
      needRescan = true;
      return;
    }
    clearTimeout(debounce);
    debounce = setTimeout(() => run({ force: true }), debounceMs);
  }

  const offChanged = onChanged((changes, area) => {
    if (area && area !== 'local') return;
    // 패널이 예약·취소·수정 뒤 캐시를 지웠거나 넣은 기록(justBooked)을 고쳤다 — 이 확장으로 예약이 바뀐 것이다.
    const gone = CACHE_KEY in changes && changes[CACHE_KEY].newValue === undefined;
    // 이름·기간이 바뀌면 담긴 것은 다른 조건으로 읽은 것이라 더는 맞지 않는다.
    const settings = ['myName', 'justBooked', 'spanDays'].some((k) => k in changes);
    if (gone || settings) wantRescan();
    // 근태: 패널이 근태를 올리거나 거둬들인 뒤 담아 둔 것을 지웠으면 다시 읽고, 누군가 새로 담았으면 그것을 그린다.
    // 기간이 바뀌면 담긴 것에서 다시 고른다(HR 을 다시 읽을 일은 아니다).
    if (PLANS_KEY in changes) {
      if (changes[PLANS_KEY].newValue === undefined) wantPlans();
      else runPlans();
    } else if ('spanDays' in changes) runPlans();
    // 다녀온 출장을 고르는 규칙이 바뀌었다 — 패널에서 기간(4주·8주·안 봄)을 바꿨거나, 증빙을 보냈거나, 여비계산서 목록을 새로 읽었다.
    if (BACK_KEY in changes) {
      back = backWeeksOf(changes[BACK_KEY].newValue) * 7;
      pick();
      wantStages().catch(() => {});
    }
    if (SENT_KEY in changes) {
      sent = changes[SENT_KEY].newValue || {};
      pick();
    }
    if (STAGES_KEY in changes) {
      const value = changes[STAGES_KEY].newValue;
      stages = stagesFresh(value, today()) ? value : null;
      pick();
      // 새로 걸린 계산서가 있으면 그 사전정산의 교통편도 읽는다.
      wantLegs();
    }
    // 출장 줄의 아이콘이 보는 것들: 보관함에 증빙이 들어오거나 빠졌다(이 카드에서 넣었든 패널에서 넣었든), 패널에서 가는 편·오는 편을
    // 바꿨다, 다른 창의 홈이 사전정산의 교통편을 읽어 담았다.
    if (MARKS_KEY in changes) {
      kept = objectOr(changes[MARKS_KEY].newValue, null);
      paint();
    }
    if (PICKS_KEY in changes) {
      picks = objectOr(changes[PICKS_KEY].newValue, {});
      paint();
    }
    if (LEGS_KEY in changes) {
      const value = changes[LEGS_KEY].newValue;
      if (value?.day === today() && legs.day === value.day) {
        legs = { day: value.day, by: { ...legs.by, ...objectOr(value.by, {}) } };
        paint();
      }
    }
    // 다른 창의 홈에서 카드를 접거나 폈다.
    if (FOLD_KEY in changes) {
      foldChosen = true;
      setOpen(changes[FOLD_KEY].newValue !== true);
    }
    // 다른 창의 홈에서 출장을 숨기거나 다시 보이게 했다.
    if (HIDDEN_KEY in changes) {
      hidden = new Set(Array.isArray(changes[HIDDEN_KEY].newValue) ? changes[HIDDEN_KEY].newValue : []);
      paint();
    }
  });
  const onVisible = () => {
    if (!visible()) return;
    if (needRescan) {
      needRescan = false;
      run({ force: true });
    }
    if (needPlans) {
      needPlans = false;
      runPlans();
    }
  };
  doc.addEventListener('visibilitychange', onVisible);

  async function askPanel() {
    const r = await openPanel().catch((err) => ({ ok: false, error: err.message }));
    if (!r?.ok) flash(`패널을 여기서 열 수 없습니다 — 툴바의 확장 아이콘을 누르세요.${r?.error ? ` (${r.error})` : ''}`);
  }

  ui.root.addEventListener('click', async (e) => {
    const target = e.target?.closest ? e.target : null;
    const act = target?.closest('[data-act]')?.dataset.act;
    const li = act ? null : target?.closest('li[data-i]');
    // 머리 줄 어디를 눌러도 접고 편다(화살표 버튼도 같은 일). 접을 것이 없으면 아무 일도 없다. 이 화면의 일이라 확장과
    // 끊겨 있어도 되고, 고른 것은 담아 둔다(끊겼으면 못 담을 뿐이다).
    if (act === 'toggle') {
      if (!view.all.length) return;
      foldChosen = true;
      setOpen(!open);
      try { await storage.set({ [FOLD_KEY]: !open }); } catch { /* 다음에 열면 펴져 있을 뿐이다 */ }
      return;
    }
    if ((!act && !li) || orphaned()) return;
    if (act === 'refresh') { run({ force: true }); runPlans({ force: true }); return; }
    if (act === 'panel') { await askPanel(); return; }
    // 다녀온 출장 한 건을 숨기거나 다시 보이게 하고(줄 끝의 눈 아이콘), 숨긴 것까지 전체를 보거나 다시 가린다(머리 줄의 눈 아이콘).
    const docNo = target.closest('[data-doc]')?.dataset.doc;
    if (act === 'hide') { await setHidden([...hidden, docNo]); return; }
    if (act === 'show') { await setHidden([...hidden].filter((d) => d !== docNo)); return; }
    if (act === 'all') { showAll = !showAll; paint(); return; }
    // 출장 줄의 계산서 보기 — 그 출장의 여비계산서 화면을 새 탭으로 연다. 계산서가 없으면 열 것이 없다고 말한다.
    if (act === 'bill') {
      const bill = view.all.find((p) => p.docNo === docNo)?.bill;
      if (!bill) return;
      if (!bill.seq) { flash(`${bill.why} — 예약 패널의 근태 탭에서 확인해 주세요.`); return; }
      await Promise.resolve().then(() => openBill(bill.seq, bill.trseq)).catch((err) => flash(`계산서를 열지 못했습니다: ${err.message}`));
      return;
    }
    // 출장 줄의 보내기(종이비행기) — 패널에 그 출장 카드의 여비증빙 송부 칸을 열어 달라는 부탁을 남기고 연다. 실제로 나가는 것은
    // 패널에 뜨는 보낼 내용 팝업의 보내기를 눌렀을 때다(받는 사람·과제·계정과 보관함은 패널이 안다).
    if (act === 'send') {
      const trip = view.all.find((p) => p.docNo === docNo);
      if (!trip) return;
      await storage.set({ [JUMP_KEY]: { date: trip.from.date, mode: 'attend', docNo, focus: 'send', at: now() } });
      await askPanel();
      return;
    }
    const it = view.all[+li.dataset.i];
    if (!it) return;
    // 패널이 어느 날짜·종류를 열지 부탁을 남기고 연다. 이미 열려 있으면 패널이 저장소 변화로 알아챈다.
    // 근태 건은 근태 탭으로 간다 — 취소·변경은 거기서 한다.
    const mode = it.kind === 'attend' ? 'attend' : it.kind === 'car' ? 'car' : 'room';
    await storage.set({ [JUMP_KEY]: { date: it.from.date, mode, at: now() } });
    await askPanel();
  });

  /* 출장 줄에 증빙 넣기 — 끌어다 놓기와 붙여넣기 */

  const tripLi = (node) => (node?.closest ? node.closest('li.krs-mine-item.is-trip') : null);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  /**
   * 파일을 카드 위로 끌고 왔을 때. 출장 줄 위면 놓을 수 있는 자리로 칠하고, 카드의 다른 곳이면 놓을 수 없는 자리로 보인다 —
   * 줄을 살짝 벗어나 놓아도 브라우저가 그 파일로 넘어가 버리지 않게 카드 전체에서 기본 동작을 막는다.
   */
  function onDrag(e) {
    if (!hasFiles(e)) return;
    const li = tripLi(e.target);
    if (e.type === 'dragleave') {
      if (li && !li.contains(e.relatedTarget)) li.classList.remove('over');
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = li ? 'copy' : 'none';
    li?.classList.add('over');
  }

  function onDrop(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const li = tripLi(e.target);
    const it = li ? view.all[+li.dataset.i] : null;
    li?.classList.remove('over');
    if (it) takeFiles(it, [...e.dataTransfer.files]);
  }

  /**
   * 붙여넣기(화면 캡처 등)가 갈 출장 — 마우스가 올라가 있는 출장 줄이고, 카드에 출장이 하나뿐이면 어디서 붙여 넣든 그 출장이다.
   * 여럿인데 어느 줄인지 모르면 넣지 않고 어떻게 고르는지 말한다. 글 칸에 붙여 넣는 중이거나 목록을 접어 두었으면 건드리지 않는다.
   */
  function onPaste(e) {
    const files = [...(e.clipboardData?.files || [])];
    if (disposed || !files.length || !open) return;
    if (e.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    const trips = view.all.filter(isTrip);
    if (!trips.length) return;
    const it = trips.find((p) => p.docNo === hot) || (trips.length === 1 ? trips[0] : null);
    if (!it) {
      flash('붙여 넣을 출장 줄에 마우스를 올리고 Ctrl+V 를 누르세요 — 출장이 여럿이라 어느 출장의 증빙인지 알 수 없습니다.');
      return;
    }
    e.preventDefault();
    takeFiles(it, files);
  }

  for (const type of ['dragover', 'dragleave']) ui.root.addEventListener(type, onDrag);
  ui.root.addEventListener('drop', onDrop);
  ui.root.addEventListener('mouseover', (e) => { hot = tripLi(e.target)?.dataset.doc || ''; });
  ui.root.addEventListener('mouseleave', () => { hot = ''; });
  doc.addEventListener('paste', onPaste);

  /** 카드를 뗀다. 도는 훑기는 다음 날짜로 넘어가기 전에 멈추고, 듣던 것도 모두 떼어낸다. */
  function destroy() {
    if (disposed) return;
    disposed = true;
    stopper.abort();
    clearTimeout(debounce);
    clearTimeout(planDebounce);
    offChanged?.();
    doc.removeEventListener('visibilitychange', onVisible);
    doc.removeEventListener('paste', onPaste);
    ui.root.remove();
  }

  return {
    root: ui.root,
    ready: Promise.all([run(), runPlans()]),
    refresh: (opts) => Promise.all([run({ force: true, ...opts }), runPlans({ force: true })]),
    destroy,
    get destroyed() { return disposed; },
  };
}
