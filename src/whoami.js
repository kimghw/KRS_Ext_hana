// 로그인한 사람이 누구인지 — e-Class 홈이 알려주는 것으로 알아낸다.
//
// 조회 화면(회의실·차량 목록)은 로그인한 사람의 이름을 어디에도 적어주지 않지만(src/mine.js), **e-Class 홈의 머리글은
// 사용자 ID 를 적어 둔다**(2026-10-06 확인: 오른쪽 위 사진 `#id-navbar-user-image` 의 alt 와 src `/intra/intranet/member/pic/<ID>.gif`,
// 명함 링크 `BusinessCard/External/Card?user_id=<base64 ID>`). 머리글의 이름은 **포털 언어를 따라** 영문으로도 나오므로
// (영문 모드면 "KIM Geohwa") 쓰지 않는다 — 회의실 목록의 예약자는 언제나 한글이다.
//
// 그 ID 로 쪽지의 받는 사람 찾기(src/memo.js memoSuggest — GET Message/GetRecipientSuggestions?query=)를 부르면 인명이
// 한글 이름(userName)을 준다(2026-10-06 확인: `kimghw` → `김거화`, 영문 이름으로 물어도 같은 줄). 읽기만 하는 조회다.
import { memoSuggest } from './memo.js';

/** 홈 머리글에서 로그인한 사람의 사용자 ID 를 읽는다. 없으면 빈 글. */
export function portalUserId(doc) {
  const img = doc?.querySelector?.('#id-navbar-user-image');
  const alt = String(img?.getAttribute('alt') || '').trim();
  if (alt) return alt;
  const src = String(img?.getAttribute('src') || '');
  const m = src.match(/\/member\/pic\/([^/.?]+)\./i);
  if (m) return m[1];
  const card = doc?.querySelector?.('a[href*="BusinessCard"][href*="user_id="]');
  const q = String(card?.getAttribute('href') || '').match(/[?&]user_id=([^&]+)/);
  if (q) {
    try { return String(globalThis.atob(decodeURIComponent(q[1]))).trim(); } catch { /* base64 가 아니면 모른다 */ }
  }
  return '';
}

/**
 * 사용자 ID 의 한글 이름. 인명에서 그 ID 의 줄을 찾는다 — 이름으로 찾으면 동명이인이 섞이지만 ID 는 하나다.
 * @returns {Promise<string>} 없으면 빈 글. 조회 실패(로그인 풀림 등)는 그대로 던진다
 */
export async function lookupName(id, { suggest = memoSuggest } = {}) {
  const want = String(id || '').trim().toLowerCase();
  if (!want) return '';
  const list = await suggest(want);
  const hit = (Array.isArray(list) ? list : []).find((x) => String(x?.id || '').trim().toLowerCase() === want);
  return hit ? String(hit.name || '').trim() : '';
}
