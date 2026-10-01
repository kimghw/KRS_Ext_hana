import { ORIGIN, PORTAL_HOME_URL } from './config.js';

/**
 * 로그인이 필요하거나 세션이 끊겼을 때 던진다.
 * portal — 그 순간 포털(eClassVer4) 로그인 상태. 'expired' | 'alive' | 'unknown'.
 *   화면은 이걸로 "다시 로그인하세요" 와 "회의실 메뉴를 한 번 열어 주세요" 를 가려 말한다.
 */
export class AuthError extends Error {
  constructor(message, { portal = 'unknown' } = {}) {
    super(message);
    this.name = 'AuthError';
    this.portal = portal;
  }
}

/** 탭 경유를 하려 했지만 eclass 탭이 하나도 없다. 로그인 문제가 아니라 폴백이 없다는 뜻이다. */
class NoTabError extends Error {}

/**
 * ASP.NET 쪽은 미인증이면 200 으로 alert 스크립트 한 줄만 돌려준다.
 * ("You must sign in.") 상태 코드로는 구분할 수 없어 본문으로 판정한다.
 */
function looksUnauthenticated(html) {
  if (!html) return true;
  if (/You must sign in|다시 로그인|로그인이 필요/i.test(html)) return true;
  // 본문이 거의 없고 Login 페이지로 튕기는 스크립트만 있는 경우
  return html.length < 1500 && /location\.(href|replace)[^;]*Login/i.test(html);
}

/**
 * 오류 응답에서 **사람이 읽을 한 줄**을 뽑는다.
 *
 * "HTTP 500" 만 보여주면 무엇이 잘못됐는지 알 길이 없다. ASP.NET 오류 화면은 제목과 큰 글씨에
 * 예외 종류·문구를 적어 주므로 그것만 짧게 데려온다. 본문 전체는 err.body 로 따로 넘겨
 * 진단(buildSaveDigest)이 쓰게 한다.
 */
export function describeErrorPage(html) {
  const text = String(html || '');
  const pick = (re) => {
    const m = text.match(re);
    return m ? m[1].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';
  };
  const detail = pick(/Exception Details:\s*<\/b>\s*([^<]{3,200})/i)
    || pick(/<title>\s*([^<]{3,200})<\/title>/i)
    || pick(/<h2>\s*(?:<i>)?\s*([\s\S]{3,200}?)<\/(?:i|h2)>/i);
  // 노란 화면의 기본 제목("Runtime Error")은 아무것도 알려주지 않는다. 없느니만 못하다.
  return /^(runtime error|오류|error)$/i.test(detail) ? '' : detail;
}

/** Content-Type / meta charset 을 존중해 디코딩한다(구형 페이지는 EUC-KR 일 수 있음). */
async function decodeResponse(res) {
  const buf = await res.arrayBuffer();
  const ct = res.headers.get('content-type') || '';
  let charset = (ct.match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!charset) {
    const head = new TextDecoder('utf-8').decode(buf.slice(0, 4096));
    charset = (head.match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
  }
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/** 확장 컨텍스트에서 직접 요청. host_permissions 덕분에 쿠키가 실린다. */
/** 응답이 안 오면 영원히 기다리게 된다. 화면이 "...중"에서 멈춰 버리므로 끊는다. */
export const REQUEST_TIMEOUT_MS = 20000;

export async function directFetch(url, init) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      credentials: 'include', redirect: 'follow', ...init, signal: ac.signal,
    });
    if (!res.ok) {
      // 오류 본문을 버리지 않는다. 사이트가 왜 거절했는지는 여기에만 적혀 있다.
      const body = await decodeResponse(res).catch(() => '');
      throw httpError(res.status, res.statusText, body);
    }
    return { html: await decodeResponse(res), finalUrl: res.url || url };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`응답이 ${REQUEST_TIMEOUT_MS / 1000}초 안에 오지 않았습니다.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** HTTP 오류를 본문까지 달아 던진다. 부르는 쪽이 진단에 쓴다. */
function httpError(status, statusText, body) {
  const detail = describeErrorPage(body);
  const err = new Error(`HTTP ${status}${statusText ? ` ${statusText}` : ''}${detail ? ` — ${detail}` : ''}`);
  err.status = status;
  err.body = body || '';
  return err;
}

/** 약속이 제 시간에 안 끝나면 끊는다. 끝나면 타이머도 치운다 — 남겨 두면 프로세스(테스트)가 매달린다. */
function withTimeout(promise, ms, what) {
  let timer;
  const guard = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${what}이 ${ms / 1000}초 안에 끝나지 않았습니다.`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/* ------------------------------------------------------------ 포털 상태 */

/** 포털 상태 확인은 가볍게 끊는다. 홈이 500KB 라 본문은 앞부분만 보고 버린다. */
export const PORTAL_PROBE_TIMEOUT_MS = 8000;
const PORTAL_PROBE_HEAD_BYTES = 65536;

/** 응답 본문의 앞부분만 읽고 나머지는 끊는다. 스트림이 없으면(테스트의 가짜 응답) 통째로 읽는다. */
async function readHead(res, limit) {
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    while (got < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.byteLength;
    }
    reader.cancel().catch(() => {});
    const buf = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    return new TextDecoder('utf-8').decode(buf);
  }
  if (res.arrayBuffer) return new TextDecoder('utf-8').decode(await res.arrayBuffer()).slice(0, limit);
  return '';
}

/**
 * 포털(eClassVer4) 로그인이 살아 있는가. 홈을 **redirect:'manual'** 로 불러 본다.
 *   200 에 홈 본문                          → 'alive'
 *   리다이렉트(302 → Logout → Login) 또는 로그인 폼 → 'expired'
 *   네트워크 오류 등                         → 'unknown'
 *
 * 따라가지 않는 것이 핵심이다. 서버 세션이 이미 끝났으면 홈은 Account/Logout 으로 보내는데,
 * 그것을 따라가는 요청이 남은 쿠키까지 지운다(2026-09-27 실제로 겪음). 확인만 하고 손대지 않는다.
 * 확장 출처에서는 리다이렉트가 type 'opaqueredirect'·status 0 으로 온다.
 *
 * 당일 쿠키는 로그인 시각 기준으로 한꺼번에 만료되고, 홈을 다시 불러도 연장되지 않는다(2026-09-27 관찰).
 * 그래서 이 함수는 되살리는 것이 아니라 **어떤 상태인지 정확히 말하기 위한** 것이다.
 */
export async function portalState(url = PORTAL_HOME_URL) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PORTAL_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      credentials: 'include', redirect: 'manual', cache: 'no-store', signal: ac.signal,
    });
    if (res.type === 'opaqueredirect' || res.status === 0 || (res.status >= 300 && res.status < 400)) return 'expired';
    if (!res.ok) return 'unknown';
    const head = await readHead(res, PORTAL_PROBE_HEAD_BYTES).catch(() => '');
    // 홈이 200 으로 로그인 폼을 그려 줄 때를 대비한다(지금은 302 지만 바뀔 수 있다).
    if (/id="tbUserId"|name="UserId"/i.test(head)) return 'expired';
    return 'alive';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

/** 포털 상태별 안내. 모두 "로그인이 필요합니다" 로 시작해 화면·기록이 같은 말로 걸러 낼 수 있게 한다. */
const LOGIN_MESSAGE = {
  expired: '로그인이 필요합니다. eclass 로그인이 만료됐습니다(로그인한 뒤 18시간쯤 지나면 풀립니다). eclass 에 다시 로그인하면 자동으로 이어집니다.',
  alive: '로그인이 필요합니다. eclass 는 로그인돼 있는데 회의실·차량 화면이 로그인 정보를 받지 못했습니다. eclass 의 회의실 메뉴를 한 번 열거나 다시 로그인해 주세요.',
  unknown: '로그인이 필요합니다. eclass 에 로그인한 뒤 다시 조회하세요.',
};

/* ------------------------------------------------------------ 탭 경유 */

/** 로그인된 eclass 탭을 찾는다. */
async function findSiteTab() {
  const tabs = await chrome.tabs.query({ url: `${ORIGIN}/*` });
  if (!tabs.length) return null;
  return tabs.find((t) => t.status === 'complete') || tabs[0];
}

/**
 * 탭 안에서 같은 출처로 요청한다.
 * SameSite 등으로 확장에서의 직접 요청이 막히는 환경을 위한 폴백.
 */
async function tabFetch(url, init) {
  const tab = await findSiteTab();
  if (!tab) throw new NoTabError('열려 있는 eclass 탭이 없습니다.');
  const [injection] = await withTimeout(chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (u, i) => {
      const res = await fetch(u, { credentials: 'include', redirect: 'follow', ...(i || {}) });
      const buf = await res.arrayBuffer();
      const ct = res.headers.get('content-type') || '';
      let cs = (ct.match(/charset=["']?([\w-]+)/i) || [])[1];
      if (!cs) {
        const head = new TextDecoder('utf-8').decode(buf.slice(0, 4096));
        cs = (head.match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
      }
      let text;
      try {
        text = new TextDecoder(cs).decode(buf);
      } catch {
        text = new TextDecoder('utf-8').decode(buf);
      }
      return { ok: res.ok, status: res.status, html: text, finalUrl: res.url || u };
    },
    args: [url, init || null],
  }), REQUEST_TIMEOUT_MS + 5000, '탭을 통한 요청');
  const r = injection?.result;
  if (!r) throw new Error('탭을 통한 요청에 실패했습니다.');
  if (!r.ok) throw httpError(r.status, '', r.html);
  return { html: r.html, finalUrl: r.finalUrl };
}

/** 탭 경유 폴백을 쓸 수 있는 문맥인가. 콘텐츠 스크립트에는 tabs·scripting 이 없다(그쪽은 직접 요청이 곧 탭 안 요청이다). */
export const canTabFetch = () =>
  typeof chrome !== 'undefined' && !!chrome.tabs?.query && !!chrome.scripting?.executeScript;

/* ------------------------------------------------------------ 본 요청 */

/**
 * 사이트에 요청한다. 직접 요청 → (미인증이면) 탭 경유 → (그래도 미인증이면) 포털 상태 확인 순이다.
 *
 * 앱이 "sign in" 을 돌려줬다고 바로 "로그인하세요" 라고 하지 않는다. 포털이 살아 있는지 확인해
 *   - 포털도 풀렸으면: 만료됐다고, 다시 로그인하면 자동으로 이어진다고 말한다(portal 'expired').
 *   - 포털은 살아 있으면: 한 번 더 시도해 보고(두 요청 사이에 로그인이 돌아왔을 수 있다), 그래도
 *     안 되면 앱만 로그인 정보를 못 받은 것이라고 말한다(portal 'alive').
 * 네트워크 오류·HTTP 오류는 로그인 문제가 아니다 — 그 실패를 그대로 말한다. 예전에는 직접 요청이
 * 실패하고 탭도 없으면 "열려 있는 eclass 탭이 없습니다" 라고 했는데, 그것은 로그인과 무관한 안내였다.
 *
 * @returns {Promise<{html: string, finalUrl: string, via: 'direct'|'tab'|'retry'}>}
 */
export async function siteFetch(url, init) {
  let directError = null;
  let unauthenticated = false;
  try {
    const r = await directFetch(url, init);
    if (!looksUnauthenticated(r.html)) return { ...r, via: 'direct' };
    unauthenticated = true;
  } catch (err) {
    directError = err;
  }

  // 탭 경유. 탭이 없으면 그냥 다음으로 넘어간다 — 없는 것은 실패가 아니다.
  if (canTabFetch()) {
    try {
      const r = await tabFetch(url, init);
      if (!looksUnauthenticated(r.html)) return { ...r, via: 'tab' };
      unauthenticated = true;
    } catch (err) {
      if (!(err instanceof NoTabError)) {
        if (directError) throw directError;
        throw err;
      }
    }
  }

  // 미인증을 본 적이 없으면 로그인 문제가 아니다. 막힌 네트워크를 "로그인하세요" 로 둔갑시키지 않는다.
  if (!unauthenticated) throw directError || new Error('요청에 실패했습니다.');

  const portal = await portalState();
  if (portal === 'alive') {
    try {
      const r = await directFetch(url, init);
      if (!looksUnauthenticated(r.html)) return { ...r, via: 'retry' };
    } catch { /* 아래에서 안내한다 */ }
  }
  throw new AuthError(LOGIN_MESSAGE[portal] || LOGIN_MESSAGE.unknown, { portal });
}
