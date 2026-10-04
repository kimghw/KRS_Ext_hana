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

import { scanDays } from './site.js';
import { scanCarDays } from './rentcar.js';
import { collectMine, datesFrom } from './mine.js';
import { MONTH_DAYS } from './monthcache.js';
import { fmtTime, todayStr } from './parse.js';
import { AuthError } from './net.js';
import { PORTAL_HOME_URL } from './config.js';
import { CARD_STYLE, ICON, setChip } from './homecard.js';
import { PLAN_GROUPS } from './attend.js';
import { PLANS_KEY, plansFresh, plansToShow, TRIP_LOOKBACK_DAYS } from './plans.js';
import { BACK_KEY, SENT_KEY, STAGES_KEY, backWeeksOf, settledBy, stagesFresh, stageNote, loadStages as readStages } from './settling.js';

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
    gubun: p.gubun || '', title: p.reason || '', status: p.status || '',
    past: p.to < start, stage: p.to < start && rule.note ? rule.note(p) : '',
  }));
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
.krs-mine:not(:has(.krs-mine-item, .krs-mine-warn:not(:empty), .krs-mine-bar:not([hidden]))) .krs-mine-body { display: none; }
.krs-mine .krs-mine-bar { height: 3px; margin: 0 0 8px; border-radius: 2px; background: #e3eaf3; overflow: hidden; }
.krs-mine .krs-mine-bar[hidden] { display: none; }
.krs-mine .krs-mine-bar > i { display: block; width: 0; height: 100%; background: #1f4e9c; transition: width .3s; }
.krs-mine .krs-mine-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
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
.krs-mine .krs-mine-past { color: #a8731f; font-weight: 600; }
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
.krs-mine .krs-card-btn[aria-pressed="true"] { border-color: #1f4e9c; background: #e3edfb; color: #1f4e9c; }
.krs-mine .krs-mine-list:not(:empty) ~ .krs-mine-warn:not(:empty) { margin-top: 8px; }
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
    <div class="krs-card-head krs-mine-head">
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
    root,
    rooms: q('rooms'), cars: q('cars'), note: q('note'), bar: q('bar'), fill: q('fill'),
    list: q('list'), warn: q('warn'), planWarn: q('planWarn'),
    plans: Object.fromEntries(PLAN_GROUPS.map((g) => [g.key, q(g.key)])),
    refresh: root.querySelector('[data-act="refresh"]'),
    showAll: root.querySelector('[data-act="all"]'),
  };
}

const HIDE_TITLE = '이 출장을 카드에서 숨깁니다 — 머리 줄의 눈 아이콘(전체 보기)으로 다시 볼 수 있습니다';
const SHOW_TITLE = '숨긴 출장입니다 — 누르면 다시 늘 보입니다';

/** 근태 한 건. 예약과 같은 모양이고, 시각이 없으면(전일·오전·오후 휴가) 그 구분을 적는다. */
function planHtml(it, i, today) {
  const sameDay = it.from.date === it.to.date;
  const at = (d) => `${dayLabel(d.date, today)}${it.timed ? ` ${fmtTime(d.minutes)}` : ''}`;
  const when = sameDay
    ? `${dayLabel(it.from.date, today)} ${it.timed ? `${fmtTime(it.from.minutes)}~${fmtTime(it.to.minutes)}` : it.gubun}`.trim()
    : `${at(it.from)} ~ ${at(it.to)}`;
  // 며칠짜리 출장·휴가는 그 기간 내내 "오늘"이다.
  const now = it.from.date <= today && today <= it.to.date;
  // 지난 출장은 "다녀온 출장"이라고 적는다 — 여비 정산을 올리라는 신호다. 다녀온 뒤 4주(고른 기간) 동안 남아 있고,
  // 여비계산서가 어느 단계인지 알면 옆에 적는다. 사후정산을 완료했거나 증빙을 보낸 출장은 여기까지 오지 않는다.
  // 그 밖에 더 볼 일이 없는 것은 줄 끝의 눈 아이콘으로 숨긴다(2026-10-03 사용자 지정). 전체 보기에서는 숨긴 것이 흐리게 보이고,
  // 그 줄의 눈 아이콘이 다시 보이게 한다.
  const eye = !it.past ? ''
    : it.tucked ? `<button type="button" class="krs-mine-hide" data-act="show" data-doc="${escapeHtml(it.docNo)}" title="${SHOW_TITLE}" aria-label="이 출장 다시 보이기">${ICON.eye}</button>`
      : `<button type="button" class="krs-mine-hide" data-act="hide" data-doc="${escapeHtml(it.docNo)}" title="${HIDE_TITLE}" aria-label="이 출장 숨기기">${ICON.eyeOff}</button>`;
  return `<li class="krs-mine-item${now ? ' today' : ''}${it.past ? ' past' : ''}${it.tucked ? ' tucked' : ''}" data-i="${i}" title="누르면 예약 패널의 근태 탭을 엽니다">`
    + `<span class="krs-mine-kind ${it.group}">${escapeHtml(it.label)}</span>`
    + '<span class="krs-mine-main">'
    + `<span class="krs-mine-when">${escapeHtml(when)}</span>`
    + (it.status ? `<span class="krs-mine-status">${escapeHtml(it.status)}</span>` : '')
    + (it.past ? `<span class="krs-mine-status krs-mine-past">다녀온 출장${it.stage ? ` · ${escapeHtml(it.stage)}` : ''}</span>` : '')
    + (it.title ? `<span class="krs-mine-sub"><span class="krs-mine-what">${escapeHtml(it.title)}</span></span>` : '')
    + '</span>' + eye + '</li>';
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
 * 다녀온 출장이 남아 있을 때만 쓰므로 그때 불러온다.
 */
async function defaultListTrips(range) {
  const { tripList } = await import('./trip.js');
  return tripList(range);
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
  let hidden = new Set();  // 숨긴 "다녀온 출장"의 신청서 번호(HIDDEN_KEY)
  let showAll = false;     // 전체 보기 — 숨긴 출장까지 보는 중인가(이 화면에서만, 기억하지 않는다)
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

  /**
   * 예약과 근태를 한 목록에 날짜순으로 섞어 그리고, 칩에 건수를 적는다. 숨긴 "다녀온 출장"은 빼고 그린다 —
   * 숨긴 것이 있으면 머리 줄에 눈 아이콘(전체 보기)이 나오고, 켜면 숨긴 것까지 흐리게 보인다. 칩은 숨기지 않은 건수다.
   */
  function paint() {
    const t = today();
    const items = view.items || [];
    const every = (view.plans || []).map((p) => ({ ...p, tucked: p.past && hidden.has(p.docNo) }));
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
   * 다녀온 출장이 남아 있는데 여비계산서의 단계를 모르면 목록을 읽어(하루에 한 번) 다시 고른다 — 사후정산이 완료된 것이 빠진다.
   * 다녀온 출장이 없으면 읽지 않는다. 못 읽어도 말하지 않는다 — 그 출장이 그대로 보일 뿐이다.
   */
  async function wantStages(force = false) {
    if (disposed || !alive() || (stages && !force) || !(view.plans || []).some((p) => p.past)) return;
    stageRun ||= readStages({ list: listTrips, force, storage, today: today() }).finally(() => { stageRun = null; });
    const got = await stageRun;
    if (disposed || !got) return;
    stages = got;
    pick();
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
      const saved = await storage.get(['spanDays', PLANS_KEY, HIDDEN_KEY, BACK_KEY, SENT_KEY, STAGES_KEY]);
      if (disposed) return;
      hidden = new Set(Array.isArray(saved[HIDDEN_KEY]) ? saved[HIDDEN_KEY] : []);
      const start = today();
      back = backWeeksOf(saved[BACK_KEY]) * 7;
      sent = saved[SENT_KEY] || {};
      stages = stagesFresh(saved[STAGES_KEY], start) ? saved[STAGES_KEY] : null;
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
    if ((!act && !li) || orphaned()) return;
    if (act === 'refresh') { run({ force: true }); runPlans({ force: true }); return; }
    if (act === 'panel') { await askPanel(); return; }
    // 다녀온 출장 한 건을 숨기거나 다시 보이게 하고(줄 끝의 눈 아이콘), 숨긴 것까지 전체를 보거나 다시 가린다(머리 줄의 눈 아이콘).
    const docNo = target.closest('[data-doc]')?.dataset.doc;
    if (act === 'hide') { await setHidden([...hidden, docNo]); return; }
    if (act === 'show') { await setHidden([...hidden].filter((d) => d !== docNo)); return; }
    if (act === 'all') { showAll = !showAll; paint(); return; }
    const it = view.all[+li.dataset.i];
    if (!it) return;
    // 패널이 어느 날짜·종류를 열지 부탁을 남기고 연다. 이미 열려 있으면 패널이 저장소 변화로 알아챈다.
    // 근태 건은 근태 탭으로 간다 — 취소·변경은 거기서 한다.
    const mode = it.kind === 'attend' ? 'attend' : it.kind === 'car' ? 'car' : 'room';
    await storage.set({ [JUMP_KEY]: { date: it.from.date, mode, at: now() } });
    await askPanel();
  });

  /** 카드를 뗀다. 도는 훑기는 다음 날짜로 넘어가기 전에 멈추고, 듣던 것도 모두 떼어낸다. */
  function destroy() {
    if (disposed) return;
    disposed = true;
    stopper.abort();
    clearTimeout(debounce);
    clearTimeout(planDebounce);
    offChanged?.();
    doc.removeEventListener('visibilitychange', onVisible);
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
