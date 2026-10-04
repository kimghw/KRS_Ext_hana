// 현황에 보여줄 근태(출장·외근·휴가 …)를 HR 에서 읽어 담아 둔다.
//
// 패널의 현황 탭과 배경(홈의 WORKSPACE 카드가 부탁한다)이 같은 것을 쓴다 — 한쪽이 오늘 읽어 두면
// 다른 쪽은 HR 을 열지 않는다. HR 문서함은 신청일로만 거를 수 있어서, 넉넉히 거슬러 올라가 읽어 두고
// 근태 날짜로 고르는 일(plansIn)은 보여주는 쪽이 한다. 예약처럼 하루에 한 번만 읽고, ↻ 를 누르거나
// 근태를 올린 뒤(패널이 이 키를 지운다)에 다시 읽는다.
//
// HR 과 말하는 길(src/hr.js 의 hrListDocs)은 주입받는다. 콘텐츠 스크립트는 그 길을 쓸 수 없지만
// 담아 둔 것이 오늘 것인지는 봐야 하므로, 이 파일은 HR 쪽을 끌어오지 않는다.

import { listItems, plansIn } from './attend.js';
import { todayStr } from './parse.js';

/** 읽어 둔 근태를 담는 storage 키. { day, since, items } */
export const PLANS_KEY = 'hrPlans';
const PLANS_LOOKBACK_DAYS = 180;
/** 읽을 때 더 거슬러 올라가 두는 여유. 날짜를 하루씩 앞으로 넘길 때마다 HR 을 다시 읽지 않게 한다. */
const PLANS_SLACK_DAYS = 60;

const addDays = (str, n) => {
  const [y, m, d] = str.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/**
 * 현황·홈 카드에 지난 출장을 보여 주는 날 수. 다녀온 출장은 여비를 정산해야 해서 **다녀온 뒤 4주까지** 남는다
 * (2026-10-03 사용자 지정 — 일주일 → 2주, 2026-10-04 에 4주로). 4주·8주·안 봄 가운데 고를 수 있고(2026-10-04 사용자 지정 —
 * src/settling.js 의 BACK_KEY), 이것은 따로 고르지 않았을 때의 값이다(BACK_DEFAULT 와 같은 4주).
 */
export const TRIP_LOOKBACK_DAYS = 28;

/**
 * 현황(패널)과 홈 카드에 올릴 근태. 기간은 start~end 이지만 **출장만은 start 의 4주(backDays) 전부터** — 다녀온 출장의
 * 여비계산서를 올려야 하므로 지난 출장이 눈에 띄어야 한다. 그 가운데 정산이 끝난 것(사후정산 완료·증빙 송부 — settled)은 뺀다.
 * 그 밖의 종류는 start 전에 끝난 것을 뺀다. 두 화면이 같은 규칙을 써야 서로 어긋나 보이지 않는다 — rule 은 src/settling.js 의
 * tripRule 이 저장소에서 읽어 준다.
 * @param {object[]} items listItems 의 결과
 * @param {{backDays?: number, settled?: (plan: object) => string}} [rule]
 */
export function plansToShow(items, start, end, { backDays = TRIP_LOOKBACK_DAYS, settled = () => '' } = {}) {
  return plansIn(items, addDays(start, -backDays), end).filter((p) => p.to >= start || (p.group === 'trip' && !settled(p)));
}

/** start 부터 보여주려면 신청일을 어디까지 거슬러 읽어 두어야 하는지. */
const needSince = (start, today) => addDays(start < today ? start : today, -PLANS_LOOKBACK_DAYS);

/** 담아 둔 것을 그대로 써도 되는가 — 오늘 읽었고, start 부터 보여줄 만큼 거슬러 읽어 둔 것이다. */
export function plansFresh(saved, start, today = todayStr()) {
  return !!saved && saved.day === today && Array.isArray(saved.items) && saved.since <= needSince(start, today);
}

/**
 * 현황에 보여줄 근태를 읽는다. 던지지 않는다 — 근태를 못 읽어도 예약 목록은 보여야 한다.
 * @param {string} start 보여줄 기간의 첫 날
 * @param {{force?: boolean, listDocs: Function}} opts listDocs 는 src/hr.js 의 hrListDocs
 * @returns {Promise<{items: object[], error: string}>}
 */
export async function loadPlans(start, { force = false, listDocs } = {}) {
  const today = todayStr();
  const saved = (await chrome.storage.local.get(PLANS_KEY))?.[PLANS_KEY];
  if (!force && plansFresh(saved, start, today)) return { items: saved.items, error: '' };
  const since = addDays(needSince(start, today), -PLANS_SLACK_DAYS);
  try {
    const { rows } = await listDocs({ from: since, to: today });
    const items = listItems(rows).map(({ docNo, status, statusName, formId, kindName, from, to, start: s, end: e, gubun, reason }) =>
      ({ docNo, status, statusName, formId, kindName, from, to, start: s, end: e, gubun, reason }));
    await chrome.storage.local.set({ [PLANS_KEY]: { day: today, since, items } });
    return { items, error: '' };
  } catch (err) {
    // 오늘 읽어 둔 것이 있으면 그것이라도 보여준다.
    return { items: saved?.day === today ? saved.items || [] : [], error: err.message };
  }
}
