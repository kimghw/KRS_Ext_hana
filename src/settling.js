// 다녀온 출장 가운데 여비 정산이 덜 끝난 것만 남기는 규칙 — 신청 내역(근태 탭)·현황·홈의 WORKSPACE 카드가 같이 쓴다
// (2026-10-04 사용자 지정).
//
//   - 앞으로의 것은 그대로 보이고, 지난 것은 **출장만** 다녀온 뒤 4주(또는 8주)까지 남는다 — 여비를 정산해야 해서다.
//     안 보기로 하면(0) 남지 않는다. 고른 값은 저장소(BACK_KEY)에 있고 세 화면이 같이 따른다.
//     (처음에는 2주·4주였다 — 같은 날 사용자가 4주·8주로 바꿨다. 2주 전에 다녀온 출장도 정산이 남아 있었다.)
//   - 그 가운데 **사후정산이 완료됐거나 증빙을 담당자에게 보낸 출장은 뺀다** — 더 할 일이 없다.
//     보낸 기록은 송부 칸(sendbox.js)이 저장소(SENT_KEY)에 적어 두는 것이고, 여비계산서의 단계는 eclass 의 목록 화면에 있다.
//
// 여비계산서 목록은 하루에 한 번만 읽어 담아 둔다(STAGES_KEY) — 홈은 하루에도 여러 번 여는 화면이다. 근태 탭은 목록을
// 읽을 때마다 거기에 덧대 준다(noteStages) — 패널에서 정산을 마치면 홈 카드도 곧 따라온다.
// 목록을 읽는 길(src/trip.js 의 tripList)은 주입받는다 — 이 파일은 규칙과 저장소만 다룬다.

import { itemsIn, isPast, STATUS, CANCELLING_KEY } from './attend.js';
import { tripDocFor, tripStage } from './travel.js';
import { todayStr } from './parse.js';

/** 다녀온 출장을 몇 주 뒤까지 보일지 고른 값을 담는 storage 키. 0 은 지난 출장을 보이지 않는 것이다. */
export const BACK_KEY = 'tripBackWeeks';
export const BACK_CHOICES = [0, 4, 8];
export const BACK_DEFAULT = 4;
/** 고를 수 있는 가장 긴 기간(8주). 여비계산서 목록은 늘 이만큼 거슬러 읽어 둔다 — 4주와 8주를 오갈 때 다시 읽지 않는다. */
export const BACK_MAX_DAYS = 56;
export const backWeeksOf = (saved) => (BACK_CHOICES.includes(saved) ? saved : BACK_DEFAULT);

/** 송부 칸(sendbox.js)이 보낸 기록을 적어 두는 storage 키 — { 신청서 번호: { at, channel, to, account … } }. */
export const SENT_KEY = 'sendDone';
/**
 * 읽어 둔 여비계산서 목록을 담는 storage 키. { day, since, until, me, rows } — rows 는 since 부터 until 까지(출장기간 기준)에 걸친 계산서다.
 * until 은 보통 오늘이고(stagesWindow), 앞으로의 출장까지 읽었으면 그 끝 날이다 — 홈의 WORKSPACE 카드는 출장 줄마다 아이콘을 그리려고
 * 오늘부터의 출장의 계산서도 본다(2026-10-04). until 이 없는 예전 값은 오늘까지 읽은 것이다.
 */
export const STAGES_KEY = 'tripStages';

const addDays = (str, n) => {
  const [y, m, d] = str.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** 여비계산서 목록을 읽어 두는 창(출장기간 기준) — 다녀온 출장을 볼 수 있는 가장 먼 날부터 오늘까지. */
export const stagesWindow = (today) => ({ from: addDays(today, -BACK_MAX_DAYS), to: today });

/**
 * 단계를 가리는 데 쓰는 것만 남긴다(기간·사전정산·출장자마다의 사후정산). 출장지는 홈 카드가 증빙을 읽을 때 쓰고(출장지에서 결제했는가),
 * 출장자 번호(trseq — 계산서를 확정한 뒤에 생긴다)는 홈 카드의 `계산서 보기`가 그 출장자의 계산서 화면을 열 때 쓴다.
 */
const slim = (r) => ({
  seq: r.seq, from: r.from, to: r.to, pre: r.pre, location: r.location || '',
  travelers: (r.travelers || []).map((t) => ({ name: t.name, post: t.post, ...(t.trseq ? { trseq: t.trseq } : {}) })),
});

/**
 * 담아 둔 여비계산서 목록을 그대로 써도 되는가 — 오늘 읽었고, 창의 처음(8주 전)부터 읽어 둔 것이다.
 * until 을 주면 그날까지의 출장을 덮는가도 본다(홈 카드가 앞으로의 출장의 계산서를 찾을 때).
 */
export function stagesFresh(saved, today = todayStr(), until = today) {
  return !!saved && saved.day === today && Array.isArray(saved.rows) && saved.since <= stagesWindow(today).from
    && (saved.until || saved.day) >= until;
}

/** 그 출장의 여비계산서가 어느 단계인가(src/travel.js 의 tripStage). 목록을 못 읽었거나 계산서가 없으면 null. */
export function stageFor(trip, stages) {
  const row = stages?.rows ? tripDocFor(trip, stages.rows, stages.me) : null;
  return row ? tripStage(row, stages.me) : null;
}

/** 다녀온 출장 옆에 적을 단계 — "사전정산 완료" · "여비계산서 없음". 목록을 못 읽었으면 빈 글이다(모르는 것을 없다고 하지 않는다). */
export function stageNote(trip, stages) {
  return stages?.rows ? stageFor(trip, stages)?.label || '여비계산서 없음' : '';
}

/**
 * 그 출장의 정산이 끝났는가를 가리는 함수 — 'sent'(증빙을 담당자에게 보냈다) · 'post'(사후정산 완료) · ''(아직).
 * 여비계산서 목록을 못 읽었으면(stages 가 null) 보낸 기록만 본다 — 모르는 것을 끝났다고 하지 않는다.
 * @param {{sent?: object|null, stages?: {rows: object[], me: string}|null}} known
 * @returns {(trip: {docNo: string, from: string, to: string}) => 'sent'|'post'|''}
 */
export function settledBy({ sent = null, stages = null } = {}) {
  return (trip) => {
    if (sent?.[trip.docNo]) return 'sent';
    const stage = stageFor(trip, stages);
    return stage?.phase === 'post' && stage.done ? 'post' : '';
  };
}

/** 다녀온 출장으로 치는 결재 상태 — 올려 두었거나 결재가 끝난 것. 임시저장·반려·회수는 다녀온 출장이 아니다. */
const LIVE = new Set([STATUS.WAIT, STATUS.REQUESTED, STATUS.APPROVED]);
const FOREVER = '9999-12-31';
const isTrip = (it) => it.formId === 'TR';

/**
 * 신청 내역의 기본 보기 — **오늘부터의 것은 전부**(끝이 없다), 지난 것은 **정산이 덜 끝난 출장만** 다녀온 뒤 backDays 일까지.
 * keep 은 펴 둔 줄의 신청서 번호다 — 방금 정산을 마친 카드가 눈앞에서 사라지지 않게 그 줄은 남긴다.
 * @param {object[]} items src/attend.js listItems 의 결과
 * @param {{backDays?: number, settled?: Function, keep?: string}} rule settled 는 settledBy 의 결과
 */
export function itemsToShow(items, today, { backDays = 0, settled = () => '', keep = '' } = {}) {
  return itemsIn(items, addDays(today, -backDays), FOREVER).filter((it) => !isPast(it, today)
    || (isTrip(it) && LIVE.has(it.status) && (it.docNo === keep || !settled(it))));
}

/** 이미 고른 목록에서, 정산이 끝난 것으로 드러난 다녀온 출장을 뺀다 — 여비계산서 목록이나 보낸 기록을 나중에 읽었을 때다. */
export function dropSettled(items, today, { settled = () => '', keep = '' } = {}) {
  return (items || []).filter((it) => !(isTrip(it) && isPast(it, today) && it.docNo !== keep && settled(it)));
}

/**
 * 저장소에서 지금 규칙을 읽는다 — src/plans.js 의 plansToShow 에 그대로 넘긴다. 여비계산서 목록은 오늘 읽어 둔 것만 쓴다
 * (없으면 stages 가 null 이고, 읽어 오는 것은 loadStages 다).
 * @returns {Promise<{backDays: number, settled: Function, stages: object|null}>}
 */
export async function tripRule({ storage = chrome.storage.local, today = todayStr() } = {}) {
  const saved = await storage.get([BACK_KEY, SENT_KEY, STAGES_KEY, CANCELLING_KEY]);
  const stages = stagesFresh(saved?.[STAGES_KEY], today) ? saved[STAGES_KEY] : null;
  return {
    backDays: backWeeksOf(saved?.[BACK_KEY]) * 7, settled: settledBy({ sent: saved?.[SENT_KEY], stages }), stages,
    // 취소신청을 올려 둔 건의 기록 — 현황·홈 카드가 그 건의 상태를 "취소 중"으로 적는다.
    cancelling: saved?.[CANCELLING_KEY] && typeof saved[CANCELLING_KEY] === 'object' ? saved[CANCELLING_KEY] : null,
  };
}

/**
 * 담아 둔 여비계산서 목록을 준다. 오늘 읽어 둔 것이 없거나 force 면 list 로 창을 읽어 담는다.
 * 던지지 않는다 — 못 읽으면 null 이고, 그러면 보낸 기록만으로 고른다(다녀온 출장이 더 보일 뿐 빠지지는 않는다).
 * @param {{list: (range: {from: string, to: string}) => Promise<{rows: object[], me: string}>, force?: boolean, until?: string}} opts
 *   list 는 src/trip.js 의 tripList, until 은 어느 날까지의 출장을 덮어야 하는가(기본은 오늘 — 홈 카드는 보이는 출장의 가장 늦은 끝 날을 준다)
 * @returns {Promise<{day: string, since: string, until: string, me: string, rows: object[]}|null>}
 */
export async function loadStages({ list, force = false, storage = chrome.storage.local, today = todayStr(), until = today } = {}) {
  const saved = (await storage.get(STAGES_KEY))?.[STAGES_KEY];
  if (stagesFresh(saved, today, until) && !force) return saved;
  try {
    const win = stagesWindow(today);
    const to = until > win.to ? until : win.to;
    const r = await list({ from: win.from, to });
    const value = { day: today, since: win.from, until: to, me: r.me || '', rows: (r.rows || []).map(slim) };
    await storage.set({ [STAGES_KEY]: value });
    return value;
  } catch {
    // 앞으로의 출장까지는 못 덮어도, 오늘 읽어 둔 것이면 다녀온 출장의 단계는 거기에 있다.
    return stagesFresh(saved, today) ? saved : null;
  }
}

/**
 * 근태 탭이 여비계산서 목록을 읽었을 때 담아 둔 것에 덧댄다. 창을 다 읽은 것이면 통째로 바꾸고, 일부만 읽은 것이면
 * (기간을 따로 정해 조회했다) 오늘 담아 둔 것이 있을 때 같은 계산서만 바꿔 끼운다. 달라진 것이 없으면 적지 않는다.
 * 창을 다 읽은 것이면 읽은 끝 날(to)까지가 담긴다 — 근태 탭은 올려 둔 가장 늦은 출장까지 읽으므로 앞으로의 출장의 계산서도 들어간다.
 * @param {{rows: object[], me: string, from: string, to: string}} read from·to 는 읽은 기간(출장기간 기준)
 */
export async function noteStages({ rows, me, from, to }, { storage = chrome.storage.local, today = todayStr() } = {}) {
  const win = stagesWindow(today);
  const saved = (await storage.get(STAGES_KEY))?.[STAGES_KEY];
  const fresh = stagesFresh(saved, today);
  const whole = from <= win.from && to >= win.to;
  if (!whole && !fresh) return;
  // 어디까지 덮는가 — 창을 다 읽었으면 읽은 끝 날, 일부만 읽었으면 담아 둔 것이 덮던 데까지다(일부 읽기는 덮는 범위를 넓히지 않는다).
  const until = whole ? to : saved.until || saved.day;
  const got = (rows || []).filter((r) => r.to >= win.from && r.from <= until).map(slim);
  const next = whole ? got : [...saved.rows.filter((r) => !got.some((g) => g.seq === r.seq)), ...got];
  const value = { day: today, since: win.from, until, me: me || saved?.me || '', rows: next };
  if (fresh && JSON.stringify(saved) === JSON.stringify(value)) return;
  await storage.set({ [STAGES_KEY]: value });
}
