// DOC-Cruiser 의 미회람 문서를 하루에 한 번, 화면을 띄우지 않고 열어 회람 처리한다.
//
// 미회람 목록(Not_Circulation_List.aspx)의 제목 링크는 문서 보기 팝업(RfCirculation_View.aspx)을 연다.
// 그 팝업 주소를 **받기만 해도** 서버가 읽은 시각을 적는다(2026-10-01 실제로 확인 — config.js 참고).
// 그래서 여기서 하는 일은 목록을 받아 건마다 그 주소를 한 번씩 부르는 것뿐이다. 사람이 한 건씩 눌러 연 것과
// 서버에 남는 것이 같다. 목록에는 "전부 회람 처리" 버튼(btnSetCirculation)도 있지만 쓰지 않는다 —
// 사이트가 스스로 "정상 회람을 권한다"며 확인을 받는 길이고, 남는 기록이 연 것과 같은지 알 수 없다.
//
// 도는 자리는 e-Class 홈의 콘텐츠 스크립트다(home.js). 홈의 내 예약 카드가 하루에 한 번 훑는 그 자리에서
// 같이 돈다. 페이지와 같은 출처라 쿠키가 그냥 실린다.
//
// **기본은 꺼져 있다.** 읽지 않은 공문을 읽은 것으로 바꾸는 일이고 되돌릴 수 없다. 패널의 "설정 및 연결"
// 에서 본인이 켠 브라우저에서만 돈다(storage 의 docCirculate).
//
// 이 확장의 다른 곳과 같이 **한 일을 다시 읽어 확인한다.** 다 연 뒤 목록을 다시 받아, 열었는데도 남아 있는
// 건이 있으면 그렇다고 말한다.

import { NONCIR_LIST_URL, CIRC_VIEW_URL } from './config.js';
import { directFetch, AuthError } from './net.js';
import { parseHtml } from './aspnet.js';
import { todayStr } from './parse.js';
import { createLogbook, stamp } from './logbook.js';

/** 쓸지. 패널의 "설정 및 연결" 체크박스가 이 값을 쓴다. **켠다고 한 적이 없으면 끈 것으로 본다.** */
export const ENABLE_KEY = 'docCirculate';
export const circulateEnabled = (value) => value === true;
/** 마지막 실행의 상태. 하루에 한 번만 돌게 하는 표식이자, 패널이 결과를 보여주는 자리다. */
export const STATE_KEY = 'docCirculateState';
/** 도는 동안 이 간격으로 "아직 돌고 있다"를 적는다. 진행 건수도 같이 적혀 패널에 보인다. */
export const HEARTBEAT_MS = 5000;
/** '도는 중' 표식이 이보다 묵으면 그 탭은 닫힌 것으로 보고 이어받는다. */
export const STALE_MS = 60_000;
/** 한꺼번에 여는 문서 수. 사람이 탭 몇 개를 같이 여는 정도로만 둔다. */
export const CONCURRENCY = 3;

/** 목록의 제목 링크: javascript:ViewCirculationDoc('R_ID', 'RC_ID', 'EA_DOCID'). 셋째는 비어 있기도 하다. */
const VIEW_RE = /ViewCirculationDoc\(\s*'([0-9A-Fa-f]+)'\s*,\s*'([0-9A-Fa-f]+)'/;

const keyOf = (d) => `${d.rId}|${d.rcId}`;
const brief = (d) => ({ rcvNo: d.rcvNo, title: d.title });

/** 문서 한 건의 보기 주소. 사이트의 ViewCirculationDoc() 이 만드는 것과 같다. */
export const viewUrl = (d) => `${CIRC_VIEW_URL}?R_ID=${d.rId}&RC_ID=${d.rcId}`;

/* ------------------------------------------------------------ 읽기 */

/**
 * 미회람 목록에서 문서들을 뽑는다.
 *   recognized — 목록 화면이 맞는가(표나 건수 라벨이 있다). 아니면 로그인 안내이거나 모르는 화면이다
 *   declared   — 사이트가 스스로 센 건수(`425 results`). 뽑은 건수와 대조한다. 못 읽으면 null
 */
export function parseNonCirculated(html) {
  const doc = parseHtml(html);
  const label = doc.querySelector('#lblResult');
  const recognized = !!(label || doc.querySelector('#RadGridDOC'));
  const m = (label?.textContent || '').match(/\d[\d,]*/);
  const declared = m ? +m[0].replace(/,/g, '') : null;

  const docs = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href*="ViewCirculationDoc"]')) {
    const hit = (a.getAttribute('href') || '').match(VIEW_RE);
    if (!hit) continue;
    const d = { rId: hit[1], rcId: hit[2], title: a.textContent.replace(/\s+/g, ' ').trim(), rcvNo: '', rcvDate: '' };
    if (seen.has(keyOf(d))) continue;
    seen.add(keyOf(d));
    // 칸 차례: No. · Rcv No. · Title · Rcv Date · …
    const cells = [...(a.closest('tr')?.cells || [])].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
    d.rcvNo = cells[1] || '';
    d.rcvDate = cells[3] || '';
    docs.push(d);
  }
  return { recognized, declared, docs };
}

/** 미인증이면 목록 대신 "다시 로그인" alert 한 줄만 온다. 진짜 목록은 수백 KB 라 길이로도 갈린다. */
const looksSignedOut = (html) => html.length < 1500 && /로그인|sign in/i.test(html);

/** 문서 보기 화면이 맞는가. 폼이 자기 주소로 되돌아가고, 수신 번호 칸이 있다. */
const looksLikeView = (html) => /RfCirculation_View\.aspx/i.test(html) && /id="txtRcvNo"/i.test(html);

async function readList(fetchPage) {
  const { html } = await fetchPage(NONCIR_LIST_URL, { cache: 'no-store' });
  const list = parseNonCirculated(html);
  if (list.recognized) return list;
  if (looksSignedOut(html)) {
    throw new AuthError('로그인이 필요합니다. eclass 에 다시 로그인한 뒤 홈을 열면 이어서 합니다.');
  }
  throw new Error('미회람 문서 목록 화면을 알아보지 못했습니다.');
}

/* ------------------------------------------------------------ 열기 */

/**
 * 미회람 문서를 전부 한 번씩 연다.
 *
 * 한 건이 실패해도 나머지는 계속한다. 다 돌고 나면 목록을 다시 받아 무엇이 남았는지 확인한다.
 *   failed      — 못 연 건(요청 실패, 또는 문서 화면이 아닌 것이 왔다)
 *   unconfirmed — 열었는데 다시 받은 목록에 그대로 남아 있는 건
 *   remaining   — 다시 받은 목록의 건수. 다시 받지 못했으면 null
 *
 * @returns {Promise<{total: number, declared: number|null, opened: number, failed: object[],
 *   unconfirmed: object[], remaining: number|null, aborted: boolean}>}
 */
export async function circulateAll({ fetchPage = directFetch, onProgress, signal, concurrency = CONCURRENCY } = {}) {
  const first = await readList(fetchPage);
  const { docs } = first;
  const opened = [];
  const failed = [];
  let next = 0;
  let done = 0;

  const worker = async () => {
    // 끄면 다음 문서로 넘어가기 전에 멈춘다. 끈 뒤에도 읽음 처리를 하면 끈 것이 아니다.
    while (next < docs.length && !signal?.aborted) {
      const d = docs[next++];
      try {
        const { html } = await fetchPage(viewUrl(d), { cache: 'no-store' });
        if (looksLikeView(html)) opened.push(d);
        else failed.push({ ...brief(d), reason: '문서 화면을 알아보지 못했습니다' });
      } catch (err) {
        failed.push({ ...brief(d), reason: err.message });
      }
      done++;
      try { onProgress?.(done, docs.length); } catch { /* 화면 문제로 멈추지는 않는다 */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), docs.length) }, worker));

  let remaining = opened.length ? null : docs.length;
  let unconfirmed = [];
  if (opened.length) {
    try {
      const after = await readList(fetchPage);
      const left = new Set(after.docs.map(keyOf));
      remaining = after.docs.length;
      unconfirmed = opened.filter((d) => left.has(keyOf(d))).map(brief);
    } catch { /* 확인하지 못했다 — remaining 을 null 로 두어 그렇게 말한다 */ }
  }

  return {
    total: docs.length,
    declared: first.declared,
    opened: opened.length,
    failed,
    unconfirmed,
    remaining,
    aborted: done < docs.length,
  };
}

/** 결과를 한 줄로. 활동 기록과 패널의 상태 줄이 같은 말을 쓴다. */
export function describeResult(r) {
  if (!r.total) return { ok: true, text: '미회람 문서가 없습니다' };
  // 사이트가 센 건수와 뽑은 건수가 다르면 놓친 문서가 있다는 뜻이다. 다 했다고 하지 않는다.
  const miscount = r.declared != null && r.declared !== r.total;
  const clean = !r.failed.length && !r.unconfirmed.length && !miscount;
  if (clean && !r.aborted && r.opened === r.total && r.remaining === 0) {
    return { ok: true, text: `미회람 문서 ${r.total}건을 모두 열어 회람 처리했습니다` };
  }
  const bits = [`미회람 문서 ${r.total}건 중 ${r.opened}건을 열었습니다`];
  if (r.failed.length) bits.push(`실패 ${r.failed.length}건`);
  if (r.unconfirmed.length) bits.push(`열었지만 목록에 남은 ${r.unconfirmed.length}건`);
  bits.push(r.remaining == null ? '남은 건수는 확인하지 못했습니다' : `남은 미회람 ${r.remaining}건`);
  if (miscount) bits.push(`목록은 ${r.declared}건이라는데 ${r.total}건만 읽었습니다`);
  if (r.aborted) bits.push('도중에 멈췄습니다');
  return { ok: clean, text: bits.join(' · ') };
}

/** 패널의 상태 줄. 언제 한 것인지 같이 적는다. 한 번도 돌지 않았으면 빈 글. */
export function stateText(st, now = Date.now()) {
  if (!st || typeof st.at !== 'number') return '';
  if (st.state === 'running') {
    if (now - st.at >= STALE_MS) return `${stamp(st.at)} · 도중에 끊겼습니다. 다음에 홈을 열면 이어서 합니다`;
    return `열람 중${st.total ? ` ${st.done}/${st.total}` : ''}...`;
  }
  if (st.state === 'failed') return `${stamp(st.at)} · 실패: ${st.error || '알 수 없는 오류'}`;
  return `${stamp(st.at)} · ${st.text || ''}`;
}

/* ------------------------------------------------------------ 하루에 한 번 */

/**
 * 설정이 켜져 있고 오늘 아직 안 했으면 한 번 돈다.
 *
 *   오늘 끝낸 기록이 있다            → 건너뛴다(force 면 다시 한다 — 설정을 방금 켰을 때)
 *   다른 탭이 지금 돌고 있다          → 건너뛴다. 표식이 묵었으면(탭이 닫혔다) 이어받는다
 *   목록조차 못 읽었다(로그인 등)     → '끝냄'으로 적지 않는다. 다음에 홈을 열 때 다시 시도한다
 *   도중에 껐다                      → 마찬가지로 '끝냄'이 아니다
 *
 * 바깥 것은 모두 주입받는다(storage·시각·열기·기록) — 테스트가 가짜로 돌리기 위해서다.
 * @returns {Promise<{skipped: string}|{error: Error}|{result: object}>}
 */
export async function runDaily(deps = {}) {
  const storage = deps.storage || chrome.storage.local;
  const now = deps.now || (() => Date.now());
  const today = deps.today || todayStr;
  const circulate = deps.circulate || circulateAll;
  const log = deps.log || ((kind, entry) => createLogbook({ storage }).add(kind, entry));
  const { signal, force = false } = deps;

  const saved = await storage.get([ENABLE_KEY, STATE_KEY]);
  if (!circulateEnabled(saved?.[ENABLE_KEY])) return { skipped: 'off' };
  const date = today();
  const prev = saved[STATE_KEY];
  if (prev?.date === date) {
    if (prev.state === 'running' && now() - prev.at < STALE_MS) return { skipped: 'running' };
    if (prev.state === 'done' && !force) return { skipped: 'done' };
  }
  if (signal?.aborted) return { skipped: 'stopped' };

  let beat = now();
  await storage.set({ [STATE_KEY]: { date, state: 'running', at: beat } });
  const note = (kind, entry) => Promise.resolve().then(() => log(kind, entry)).catch(() => {});
  try {
    const result = await circulate({
      signal,
      onProgress: (done, total) => {
        if (now() - beat < HEARTBEAT_MS) return;
        beat = now();
        Promise.resolve(storage.set({ [STATE_KEY]: { date, state: 'running', at: beat, done, total } })).catch(() => {});
      },
    });
    const { ok, text } = describeResult(result);
    // 기록을 먼저, 상태를 나중에 적는다. 패널은 상태가 바뀌는 것을 보고 활동 로그까지 다시 그린다.
    await note('circulate', {
      ok, text,
      // 열 것이 없던 날이 이어지면 같은 줄을 날마다 쌓지 않는다.
      onlyIfChanged: !result.total,
      data: result.total ? {
        total: result.total, opened: result.opened, remaining: result.remaining,
        failed: result.failed.slice(0, 20), unconfirmed: result.unconfirmed.slice(0, 20),
      } : undefined,
    });
    await storage.set({
      [STATE_KEY]: {
        date, state: result.aborted ? 'stopped' : 'done', at: now(), ok, text,
        total: result.total, opened: result.opened, remaining: result.remaining,
      },
    });
    return { result };
  } catch (err) {
    await note('circulate', { ok: false, text: `미회람 문서 열람 실패: ${err.message}` });
    await Promise.resolve(storage.set({ [STATE_KEY]: { date, state: 'failed', at: now(), error: err.message } })).catch(() => {});
    return { error: err };
  }
}

/* ------------------------------------------------------------ 붙이기 */

/** storage 변화를 듣는다. 돌려주는 함수로 그만 듣는다. */
function defaultOnChanged(fn) {
  const ev = chrome.storage.onChanged;
  if (!ev) return () => {};
  ev.addListener(fn);
  return () => ev.removeListener(fn);
}

/**
 * 콘텐츠 스크립트가 부른다. 설정을 따라 하루 한 번 돌고, 패널에서 설정을 바꾸면 곧바로 따른다
 * — 켜면 홈을 새로고침하지 않아도 지금 돌고, 끄면 도는 중이라도 다음 문서로 넘어가기 전에 멈춘다.
 *
 * @returns {{ready: Promise, stop: Function}} ready 는 첫 실행(또는 건너뜀)이 끝나면 풀린다
 */
export function startCirculate(deps = {}) {
  const storage = deps.storage || chrome.storage.local;
  const onChanged = deps.onChanged || defaultOnChanged;
  let stopper = null;   // 지금 도는 것. 한 번에 하나만.

  const kick = (force) => {
    if (stopper) return Promise.resolve({ skipped: 'running' });
    const mine = stopper = new AbortController();
    return runDaily({ ...deps, storage, force, signal: mine.signal })
      .catch((error) => ({ error }))
      .finally(() => { if (stopper === mine) stopper = null; });
  };

  const off = onChanged((changes, area) => {
    if (area && area !== 'local') return;
    if (!(ENABLE_KEY in changes)) return;
    if (circulateEnabled(changes[ENABLE_KEY].newValue)) kick(true);
    else stopper?.abort();
  });

  return {
    ready: kick(false),
    stop() {
      off?.();
      stopper?.abort();
    },
  };
}
