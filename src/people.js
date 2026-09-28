// 인명 검색 결과(eClassVer4/searchmember/MemberList 등)의 인명 카드에 "Teams" 버튼을 붙인다.
//
// 카드의 Ext·Mobile·Task 줄(.search_info_btn) 끝에 같은 모양의 버튼을 하나 더 두고, 누르면 그 사람과의
// Teams 1:1 채팅 딥링크가 새 탭으로 열린다. 앱 설치·인증·서버 없이 URL 만으로 Teams 앱(또는 웹)이
// 채팅을 연다 — 이 확장이 하는 일은 링크를 만들어 붙이는 것뿐이다.
//
// 상대는 이메일로 지목해야 하는데 카드에 이메일은 없다. 대신 사용자 ID 가 여러 곳에 있다 — 프로필 사진
// (`/intra/intranet/member/pic/<id>.gif` 과 툴팁 제목), 사진의 copyToClipboard('<id>'), Task 버튼의
// titleMouseOver(event, this, '<id>', …). 사내 메일은 `<id>@krs.co.kr` 이다(config.js MAIL_DOMAIN).
// ID 를 못 찾은 카드에는 버튼을 붙이지 않는다 — 엉뚱한 사람에게 이어지는 버튼보다 없는 것이 낫다.
//
// 붙일지 말지는 패널의 "설정 및 연결" 체크박스(storage 의 teamsButton)를 따른다. 홈 카드와 같은 방식이다
// — 꺼도 모듈은 불러 두고, 켜면 새로고침 없이 붙고, 끄면 열려 있는 화면에서도 곧바로 사라진다.

import { MAIL_DOMAIN, TEAMS_CHAT_URL } from './config.js';

/** 버튼을 쓸지. 패널의 "설정 및 연결" 체크박스가 이 값을 쓴다. 값이 없으면 켠 것으로 본다. */
export const ENABLE_KEY = 'teamsButton';
export const teamsEnabled = (value) => value !== false;
/** 우리가 붙인 버튼과 스타일의 표식. 다시 붙일 때 중복을 막고, 뗄 때 이걸로 찾는다. */
export const BTN_CLASS = 'krs-teams-btn';
export const STYLE_ID = 'krsTeamsStyle';
/** 카드의 버튼 줄. Ext·Mobile·Task 가 여기 들어 있다(2026-09-28 MemberList 캡처). */
export const ROW_SELECTOR = '.search_info_btn';

/** 사용자 ID 로 쓸 수 있는 글자. 사진 파일명이자 로그인 ID 다. */
const ID_RE = /^[A-Za-z0-9_.-]+$/;
/** 사진이 없을 때 사이트가 onerror 로 바꿔 끼우는 자리표시자. 이건 ID 가 아니다. */
const PLACEHOLDER_ID = '00000';
const PIC_RE = /\/member\/pic\/([A-Za-z0-9_.-]+)\.[A-Za-z]+/;
const CLIP_RE = /copyToClipboard\(\s*'([^']+)'/;
const TASK_RE = /titleMouseOver\(\s*event\s*,\s*this\s*,\s*'([^']+)'/;

const cleanId = (value) => {
  const id = String(value ?? '').trim();
  return id && id !== PLACEHOLDER_ID && ID_RE.test(id) ? id : null;
};

/** 버튼 줄이 속한 카드. 검색 결과는 `.item.person_main`, 그 안이 `.profile-card` 다. */
export const cardOf = (row) => row.closest('.item') || row.closest('.profile-card') || row.parentElement;

/**
 * 카드에서 사용자 ID 를 찾는다. 믿을 만한 자리부터 본다 — 사진 툴팁 제목과 copyToClipboard 는 ID 그대로이고,
 * 사진 src 는 사진이 없으면 onerror 가 00000 으로 바꿔 끼워 두었을 수 있다.
 * @returns {string|null}
 */
export function userIdOf(card) {
  if (!card) return null;
  const pic = card.querySelector('img.profile-pic') || card.querySelector('img[src*="/member/pic/"]');
  if (pic) {
    for (const attr of ['data-original-title', 'title']) {
      const id = cleanId(pic.getAttribute(attr));
      if (id) return id;
    }
    const clip = cleanId(pic.getAttribute('onclick')?.match(CLIP_RE)?.[1]);
    if (clip) return clip;
  }
  for (const btn of card.querySelectorAll('[onmouseover]')) {
    const id = cleanId(btn.getAttribute('onmouseover')?.match(TASK_RE)?.[1]);
    if (id) return id;
  }
  if (pic) {
    const id = cleanId(pic.getAttribute('src')?.match(PIC_RE)?.[1]);
    if (id) return id;
  }
  return null;
}

/** 카드의 이름. 한글 이름이 먼저, 없으면 영문. 툴팁 문구에만 쓴다. */
export function nameOf(card) {
  const text = (sel) => (card?.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
  return text('h3.Korean') || text('h3.English') || text('h3') || '';
}

export const emailOf = (userId) => `${userId}@${MAIL_DOMAIN}`;

/** Teams 1:1 채팅 딥링크. 여러 명이면 쉼표로 이어 그룹 채팅이 되지만 여기서는 한 명뿐이다. */
export const teamsChatUrl = (email) => `${TEAMS_CHAT_URL}?users=${encodeURIComponent(email)}`;

/* ------------------------------------------------------------ 그리기 */

// 사이트 버튼과 같은 치수에 Teams 색만 입힌다. 사이트의 치수 규칙은 `.search_info_btn button` 이라 <a> 에는
// 안 오므로 여기서 같은 값을 준다(2026-09-28 계산 스타일: display flex · 80px · 14px · 10px 15px · margin 0).
// 버튼 줄은 flex nowrap 에 셋이 딱 맞는 폭(80×3 + 10×2 = 260px)이라 넷째가 들어갈 자리가 없다 — 우리 버튼이
// 있을 때만 줄을 바꾸게 해 Teams 가 아래 줄 가운데에 온다. 카드가 overflow hidden 이라 안 바꾸면 양끝이 잘린다.
const STYLE = `
a.${BTN_CLASS}, a.${BTN_CLASS}:visited {
  display: flex; justify-content: center; align-items: center; width: 80px; margin: 0; padding: 10px 15px;
  font-size: 14px; white-space: nowrap; color: #5b5fc7; border-color: #5b5fc7; text-decoration: none;
}
a.${BTN_CLASS}:hover, a.${BTN_CLASS}:focus { color: #fff; background: #5b5fc7; border-color: #5b5fc7; text-decoration: none; }
${ROW_SELECTOR}:has(.${BTN_CLASS}) { flex-wrap: wrap; }
`;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  (doc.head || doc.documentElement).append(style);
}

/**
 * 버튼 하나. 링크(<a>)로 만든다 — 가운데 클릭·주소 복사가 그냥 되고, 팝업 차단에 걸릴 일도 없다.
 * 아이콘은 사이트가 쓰는 Font Awesome 6 의 것이라 사이트 버튼과 같은 자리에 같은 크기로 그려진다.
 */
export function buildButton(doc, { email, name }) {
  const a = doc.createElement('a');
  a.className = `btn btn-outline-primary mb-1 ${BTN_CLASS}`;
  a.href = teamsChatUrl(email);
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = `Teams 에서 ${name ? `${name} ` : ''}1:1 채팅 (${email})`;
  const icon = doc.createElement('i');
  icon.className = 'fa-solid fa-comment-dots';
  icon.style.cssText = 'margin-right:10px; pointer-events:none;';
  a.append(icon, 'Teams');
  return a;
}

/**
 * 문서 안의 모든 버튼 줄에 Teams 버튼을 붙인다. 이미 붙은 줄과 ID 를 못 찾은 카드는 건너뛴다 —
 * 여러 번 불러도 버튼은 줄마다 하나다.
 * @returns {number} 이번에 새로 붙인 수
 */
export function mountTeams(doc) {
  let added = 0;
  for (const row of doc.querySelectorAll(ROW_SELECTOR)) {
    if (row.querySelector(`.${BTN_CLASS}`)) continue;
    const card = cardOf(row);
    const id = userIdOf(card);
    if (!id) continue;
    ensureStyle(doc);
    row.append(buildButton(doc, { email: emailOf(id), name: nameOf(card) }));
    added++;
  }
  return added;
}

/** 붙인 것을 모두 뗀다. 스타일도 같이. */
export function unmountTeams(doc) {
  for (const a of doc.querySelectorAll(`.${BTN_CLASS}`)) a.remove();
  doc.getElementById(STYLE_ID)?.remove();
}

/* ------------------------------------------------------------ 시동 */

/** storage 변화를 듣는다. 돌려주는 함수로 그만 듣는다. */
function defaultOnChanged(fn) {
  const ev = chrome.storage.onChanged;
  if (!ev) return () => {};
  ev.addListener(fn);
  return () => ev.removeListener(fn);
}

/**
 * 설정(ENABLE_KEY)을 따라 버튼을 붙이거나 뗀다. 콘텐츠 스크립트는 이것을 부른다.
 *
 * 켜져 있는 동안은 문서 변화도 지켜본다 — "메인 / 파견·겸무" 처럼 카드가 나중에 나타나는 화면에서도
 * 새 카드에 버튼이 붙게. 끄면 지켜보는 것도 그만둔다.
 *
 * 바깥 것은 주입받는다(storage·onChanged) — 테스트가 가짜로 돌리기 위해서다.
 * @returns {Promise<{mounted: boolean, stop: Function}>}
 */
export async function startPeople(doc, deps = {}) {
  const storage = deps.storage || chrome.storage.local;
  const onChanged = deps.onChanged || defaultOnChanged;
  const Observer = deps.MutationObserver || doc.defaultView?.MutationObserver;
  let on = false;
  let observer = null;
  let pending = false;

  const remount = () => {
    pending = false;
    if (on) mountTeams(doc);
  };

  const apply = (next) => {
    if (next === on) return;
    on = next;
    if (on) {
      mountTeams(doc);
      if (Observer && doc.body) {
        observer = new Observer(() => {
          // 카드 하나에 여러 변화가 몰려온다. 한 번만 훑는다.
          if (pending) return;
          pending = true;
          setTimeout(remount, 0);
        });
        observer.observe(doc.body, { childList: true, subtree: true });
      }
    } else {
      observer?.disconnect();
      observer = null;
      unmountTeams(doc);
    }
  };

  const off = onChanged((changes, area) => {
    if (area && area !== 'local') return;
    if (ENABLE_KEY in changes) apply(teamsEnabled(changes[ENABLE_KEY].newValue));
  });

  const saved = await storage.get(ENABLE_KEY);
  apply(teamsEnabled(saved?.[ENABLE_KEY]));

  return {
    get mounted() { return on; },
    stop() {
      off?.();
      apply(false);
    },
  };
}
