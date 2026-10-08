// 웹페이지를 캡처한다 — 공문 탭의 문서 넣는 곳과 출장 카드의 증빙 넣는 곳 아래의 두 단추(webpick.js, 2026-10-08 사용자 지정:
// "현재 보고 있는 탭 아이콘 하나.. 그리고 부분적으로 선택할 수 있는 버튼 하나").
//   · 보고 있는 탭 — 그 탭을 위에서 아래까지 통째로(captureFront → captureTabs).
//   · 부분 골라 캡처 — 페이지 위에 고르기 막을 씌워 프레임(틀·상자)을 눌러 하나 이상 고르고(pagePick), 고른 것만 잘라 찍는다
//     (captureTabParts → captureParts → capturePart). eClass 포털처럼 본문이 틀(iframe) 안에서 따로 내려가는 화면은 틀 안을 내려가며 찍는다.
// 여러 탭을 차례로 앞에 두고 찍는 길(captureMany)은 보고 있는 탭 하나를 찍을 때도 그대로 쓴다(탭 목록에서 고르던 때의 것 — 2026-10-08 앞서).
//
// chrome.tabs.captureVisibleTab 은 보이는 만큼만 찍는다. 그래서 탭 안에서 한 화면씩 내려가며 찍고(초당 두 장 제한 — SHOT_GAP_MS), 찍은 것을
// 한 장으로 이어 A4 비율(가로 : 세로 = 210 : 297)로 자른다 — 그 장들이 공문 읽기(src/llm.js 의 gongmunSmart)에 가고, 그대로 첨부 PDF
// (src/pdf.js 의 buildPdf — 한 장에 한 쪽)가 된다. 같이 그 화면의 글자(innerText)도 가져온다 — 화면의 글자는 OCR 보다 정확하다.
// 로컬 CLI 다리는 그림을 OCR 한 글자를 그림과 같이 보낸다(native/host.mjs → native/doctext.mjs).
//
// 여기는 두 층이다. capturePage(탭 하나)·captureMany(고른 탭들)·capturePart(고른 부분 하나)·captureParts 는 찍는 차례(탭에서 돌릴 함수·
// 찍기·잇기·탭 바꾸기를 밖에서 받는다 — 테스트가 갈아 끼운다)이고, captureFront·startPick·captureTabParts·captureTabs 가 chrome API 를
// 그 자리에 꽂는다. pageInfo·pageStep·pageDone·pagePick·pickCancel·frameProbe·partInfo·partStep·partDone 은 chrome.scripting 이
// **글자 그대로** 탭에 옮겨 돌리는 함수다 — 바깥 변수를 쓰면 안 된다.

/** 한 번에 찍는 화면 수의 한도 — 끝없이 이어지는 화면(무한 스크롤)을 끝까지 쫓지 않는다. */
export const MAX_SHOTS = 30;
/** 찍기 사이의 틈 — captureVisibleTab 은 초당 두 장까지고, 내려간 뒤 늦게 그려지는 것(지연 로딩 그림)도 기다린다. */
export const SHOT_GAP_MS = 600;
/** 저장하는 배율의 한도 — 고배율 화면(devicePixelRatio 2 이상)을 그대로 두면 장마다 수 MB 가 된다. */
export const MAX_SCALE = 2;
/** A4 의 세로/가로. */
export const A4_RATIO = 297 / 210;
/** 화면 글자의 한도 — 다리는 입력을 2만 자에서 자르고(native/host.mjs), 머리말(품의 종류·파일 이름)이 앞에 붙는다. 탭을 여럿 고르면 나눠 쓴다. */
export const TEXT_MAX = 18000;
/** 탭마다 글자에 붙는 머리말([웹페이지 글자 — 제목] 주소)과 이음 줄의 몫 — 여러 탭의 글자를 합쳐도 TEXT_MAX 안에 들게 뺀다. */
const TEXT_HEAD = 300;
/** 앞에 둔 탭이 다 읽힐 때까지 기다리는 한도 — 잠든 탭(discarded)은 앞에 두면 다시 읽는다. */
const READY_MS = 15000;

/* ------------------------------------------------------------ 탭 안에서 도는 함수 */

/**
 * 페이지의 크기와 글자. 글자는 body 의 innerText(보이는 글자만 — 숨은 메뉴·스크립트는 빠진다)이고, 그것이 없는 환경이면 textContent 다.
 * 글자는 여기서 넉넉히 자르고, 다듬는 것은 normalizeText 가 한다.
 */
export function pageInfo() {
  const doc = document.documentElement;
  const body = document.body;
  const raw = body ? (body.innerText ?? body.textContent) : '';
  return {
    url: location.href,
    title: document.title || '',
    scrollHeight: Math.max(doc ? doc.scrollHeight : 0, body ? body.scrollHeight : 0),
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    dpr: window.devicePixelRatio || 1,
    scrollY: window.scrollY,
    text: String(raw || '').slice(0, 60000),
  };
}

/**
 * 한 화면 내려간다. 두 번째 장부터는 고정된 띠(position: fixed·sticky — 머리 메뉴·채팅 단추·쿠키 안내)를 숨긴다 — 장마다 되풀이해
 * 찍히지 않게. 숨긴 것과 원래 스크롤 방식은 window.__krsCap 에 두었다가 pageDone 이 되돌린다. 실제로 선 자리를 돌려준다
 * (끝에서는 바라던 자리보다 덜 내려간다).
 */
export function pageStep(y, hideFixed) {
  const html = document.documentElement;
  const keep = (window.__krsCap ||= { behavior: html.style.scrollBehavior, hidden: [] });
  html.style.scrollBehavior = 'auto';
  if (hideFixed && !keep.hidden.length && document.body) {
    for (const el of document.body.querySelectorAll('*')) {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      keep.hidden.push([el, el.style.visibility]);
      el.style.visibility = 'hidden';
    }
  }
  window.scrollTo(0, y);
  return window.scrollY;
}

/** 다 찍었다 — 숨긴 것과 스크롤 방식·자리를 되돌린다. */
export function pageDone(y) {
  const keep = window.__krsCap;
  if (keep) {
    for (const [el, v] of keep.hidden) el.style.visibility = v;
    document.documentElement.style.scrollBehavior = keep.behavior;
    delete window.__krsCap;
  }
  window.scrollTo(0, y);
}

/**
 * 페이지 위에서 찍을 부분을 고르게 한다(2026-10-08 사용자 지정: "탭이 아니라 프레임으로 선택"). 페이지에 투명한 막을 씌우고, 마우스가
 * 가리키는 프레임(틀 iframe·테두리나 그림자나 바탕색이 있는 상자·표·스크롤 상자 …)에 점선 칸을 그린다. 누르면 고르고(번호가 붙는다)
 * 다시 누르면 뺀다 — 여러 개 고를 수 있다. ↑ 는 한 겹 큰 칸, ↓ 는 다시 작은 칸이다. 막이 위에 있어 틀 안을 눌러도 틀 자체가 골라진다.
 * 위쪽 띠의 캡처(Enter)를 누르면 고른 차례대로 요소에 data-krs-cap="번호" 를 달고 그 목록을, 취소(Esc)면 null 을 준다 —
 * executeScript 는 이 약속이 풀릴 때까지 기다린다. 막은 shadow DOM 이라 페이지의 CSS 와 섞이지 않는다.
 * @returns {Promise<{n: number, tag: string, title: string, frame: {href: string|null, src: string, name: string, w: number, h: number}|null}[]|null>}
 */
export function pagePick() {
  window.__krsPick?.cancel();
  return new Promise((resolve) => {
    const MIN_W = 120;
    const MIN_H = 40;
    const FRAME = /^(IFRAME|FRAME|EMBED|OBJECT|CANVAS|VIDEO|IMG)$/i;
    const BLOCK = /^(TABLE|SECTION|ARTICLE|MAIN|ASIDE|FORM|FIELDSET|FIGURE|DIALOG)$/;
    const NAMED = /(^|[\s_-])(card|panel|box|portlet|widget|module|frame|section|article|content|container|board|modal|dialog)/i;
    const host = document.createElement('div');
    host.setAttribute('data-krs-pick', '');
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';
    const sh = host.attachShadow({ mode: 'open' });
    const CSS = `
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif; }
      .veil { position: fixed; inset: 0; cursor: crosshair; }
      .box { position: fixed; pointer-events: none; border: 2px solid #007aff; border-radius: 3px; background: rgba(0, 122, 255, .14); }
      .box.hover { border-style: dashed; background: rgba(0, 122, 255, .06); }
      .box b { position: absolute; top: -2px; left: -2px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 3px 0 7px 0; background: #007aff; color: #fff; font-size: 13px; font-weight: 700; line-height: 22px; text-align: center; }
      .tag { position: absolute; bottom: 100%; left: -2px; margin-bottom: 3px; padding: 1px 7px; border-radius: 5px; background: #1d1d1f; color: #fff; font-size: 12px; line-height: 19px; white-space: nowrap; }
      .tag.in { bottom: auto; top: 3px; left: 3px; margin: 0; }
      .bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; width: max-content; max-width: calc(100vw - 24px); padding: 8px 10px 8px 14px; border-radius: 12px; background: #1d1d1f; color: #fff; font-size: 13px; line-height: 1.4; box-shadow: 0 6px 24px rgba(0, 0, 0, .28); }
      .bar span { min-width: 0; }
      .bar small { display: block; color: #b9b9c2; font-size: 12px; }
      .bar button { flex: none; min-height: 30px; padding: 4px 12px; border: 0; border-radius: 8px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
      .go { background: #007aff; }
      .go:disabled { opacity: .45; cursor: default; }
      .no { background: #3a3a3f; }`;
    // 모양은 만들어 붙이는 스타일시트로 준다 — 페이지의 CSP(style-src)가 <style> 을 막아도 막이 흐트러지지 않게. 못 만들면 <style>.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      sh.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      sh.append(style);
    }
    sh.innerHTML += `<div class="veil"></div><div class="marks"></div><div class="box hover" hidden><span class="tag"></span></div>
    <div class="bar"><span>캡처할 부분을 누르세요 — 여러 개 고를 수 있습니다<small>↑ 더 큰 칸 · ↓ 작은 칸 · 다시 누르면 빼기 · Enter 캡처 · Esc 취소</small></span>
    <button type="button" class="go" disabled>캡처</button><button type="button" class="no">취소</button></div>`;
    const veil = sh.querySelector('.veil');
    const marks = sh.querySelector('.marks');
    const hover = sh.querySelector('.box.hover');
    const tag = sh.querySelector('.tag');
    const go = sh.querySelector('.go');
    const chosen = [];
    let chain = [];
    let level = 0;
    let last = null;

    const clear = (c) => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c);
    /** 프레임으로 볼 것 — 틀·그림, 큰 덩어리 태그, 스크롤 상자, 테두리(세 면 이상)·그림자·둘레와 다른 바탕색, 카드·패널 같은 이름. */
    function isFrame(el) {
      if (!(el instanceof Element) || el === document.documentElement || el === document.body) return false;
      const r = el.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) return false;
      if (FRAME.test(el.tagName)) return true;
      const cs = getComputedStyle(el);
      if (cs.display === 'contents' || cs.display.startsWith('inline') || cs.display.startsWith('table-')) return false;
      if (BLOCK.test(el.tagName)) return true;
      if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll|overlay)/.test(cs.overflowY)) return true;
      const sides = ['Top', 'Right', 'Bottom', 'Left']
        .filter((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none' && !clear(cs[`border${s}Color`]));
      if (sides.length >= 3 || (cs.boxShadow && cs.boxShadow !== 'none')) return true;
      if (!clear(cs.backgroundColor)) {
        let p = el.parentElement;
        let bg = '';
        while (p && clear(bg = getComputedStyle(p).backgroundColor)) p = p.parentElement;
        if ((p ? bg : 'rgb(255, 255, 255)') !== cs.backgroundColor) return true;
      }
      const cls = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
      return NAMED.test(cls) || NAMED.test(el.id || '');
    }
    /** 그 자리의 프레임들 — 안쪽부터 바깥으로. 프레임이 없으면 넉넉한 크기의 가장 안쪽 요소 하나. */
    function chainAt(x, y) {
      const hit = document.elementsFromPoint(x, y).find((e) => e !== host);
      const out = [];
      for (let e = hit; e && e !== document.documentElement; e = e.parentElement) if (isFrame(e)) out.push(e);
      for (let e = hit; !out.length && e && e !== document.documentElement && e !== document.body; e = e.parentElement) {
        const r = e.getBoundingClientRect();
        if (r.width >= MIN_W && r.height >= MIN_H) out.push(e);
      }
      return out;
    }
    const place = (node, el) => {
      const r = el.getBoundingClientRect();
      Object.assign(node.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      return r;
    };
    const kindOf = (el) => (/^(IFRAME|FRAME)$/.test(el.tagName) ? '틀' : el.tagName === 'TABLE' ? '표' : FRAME.test(el.tagName) ? '그림' : '칸');
    function paintHover() {
      const el = chain[level];
      hover.hidden = !el;
      if (!el) return;
      const r = place(hover, el);
      tag.classList.toggle('in', r.top < 26);
      tag.textContent = `${chosen.includes(el) ? '누르면 빼기' : '누르면 고르기'} · ${kindOf(el)} ${Math.round(r.width)}×${Math.round(r.height)}`
        + `${level < chain.length - 1 ? ' · ↑ 더 큰 칸' : ''}${level > 0 ? ' · ↓ 작은 칸' : ''}`;
    }
    function paintMarks() {
      marks.replaceChildren(...chosen.map((el, i) => {
        const d = document.createElement('div');
        d.className = 'box';
        const b = document.createElement('b');
        b.textContent = String(i + 1);
        d.append(b);
        place(d, el);
        return d;
      }));
      go.disabled = !chosen.length;
      go.textContent = chosen.length ? `${chosen.length}개 캡처` : '캡처';
    }
    function aim() {
      if (!last) return;
      const c = chainAt(last[0], last[1]);
      if (c[0] !== chain[0]) {
        chain = c;
        level = 0;
      } else chain = c;
      level = Math.min(level, Math.max(chain.length - 1, 0));
    }
    const onMove = (e) => {
      last = [e.clientX, e.clientY];
      aim();
      paintHover();
    };
    const onScroll = () => {
      aim();
      paintHover();
      paintMarks();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(null);
      else if (e.key === 'Enter') { if (chosen.length) finish(chosen); }
      else if (e.key === 'ArrowUp') { if (level < chain.length - 1) level++; paintHover(); }
      else if (e.key === 'ArrowDown') { if (level > 0) level--; paintHover(); }
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    veil.addEventListener('mousemove', onMove);
    veil.addEventListener('mousedown', (e) => e.preventDefault());
    veil.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onMove(e);
      const el = chain[level];
      if (!el) return;
      const i = chosen.indexOf(el);
      if (i >= 0) chosen.splice(i, 1);
      else chosen.push(el);
      paintMarks();
      paintHover();
    });
    go.addEventListener('click', () => finish(chosen));
    sh.querySelector('.no').addEventListener('click', () => finish(null));
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);

    function finish(list) {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      host.remove();
      delete window.__krsPick;
      if (!list?.length) return resolve(null);
      for (const old of document.querySelectorAll('[data-krs-cap]')) old.removeAttribute('data-krs-cap');
      return resolve(list.map((el, i) => {
        el.setAttribute('data-krs-cap', String(i + 1));
        const isFrameEl = /^(IFRAME|FRAME)$/.test(el.tagName);
        let href = null;
        let inner = '';
        if (isFrameEl) {
          try {
            href = el.contentWindow.location.href;
            inner = el.contentDocument?.title || '';
          } catch {
            href = null;   // 다른 사이트의 틀 — 주소·제목을 못 본다
          }
        }
        const head = isFrameEl ? null : el.querySelector('h1, h2, h3, h4, caption, legend');
        const first = isFrameEl ? '' : String(el.innerText ?? el.textContent ?? '').trim().split('\n')[0];
        const title = String((isFrameEl ? inner || el.title || el.name : (head && (head.innerText ?? head.textContent)) || first) || '')
          .replace(/\s+/g, ' ').trim().slice(0, 60);
        return {
          n: i + 1, tag: el.tagName.toLowerCase(), title,
          frame: isFrameEl ? { href, src: el.src || '', name: el.name || '', w: el.clientWidth, h: el.clientHeight } : null,
        };
      }));
    }
    window.__krsPick = { cancel: () => finish(null) };
    document.documentElement.append(host);
    paintMarks();
  });
}

/** 페이지 위의 고르기를 그만둔다 — 패널의 고르기 취소. */
export function pickCancel() {
  window.__krsPick?.cancel();
  return true;
}

/** 틀마다 주소·이름·크기 — 고른 틀(iframe)이 어느 frameId 인지 맞춘다(matchFrame). child 는 맨 위 문서 바로 아래의 틀이다. */
export function frameProbe() {
  return { href: location.href, name: window.name, w: window.innerWidth, h: window.innerHeight, child: window !== window.top && window.parent === window.top };
}

/**
 * 고른 부분(data-krs-cap="n")의 자리와 글자. edge 는 테두리 안쪽(틀이면 틀 안의 창, 스크롤 상자면 보이는 칸)이고, box 는 안이 따로
 * 내려가는 상자일 때의 높이다. 글자는 그 요소의 innerText(같은 사이트의 틀이면 틀 안의 글자)다.
 */
export function partInfo(n) {
  const el = document.querySelector(`[data-krs-cap="${n}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const isFrameEl = /^(IFRAME|FRAME)$/.test(el.tagName);
  const box = !isFrameEl && el.scrollHeight > el.clientHeight + 4 && /(auto|scroll|overlay)/.test(cs.overflowY);
  let text = '';
  try {
    text = isFrameEl ? el.contentDocument?.body?.innerText || '' : el.innerText || el.textContent || '';
  } catch {
    text = '';
  }
  return {
    url: location.href, title: document.title || '', vw: window.innerWidth, vh: window.innerHeight, scrollY: window.scrollY,
    top: r.top + window.scrollY, width: r.width, height: r.height,
    edge: { top: el.clientTop, left: el.clientLeft, w: el.clientWidth || r.width, h: el.clientHeight || r.height },
    frame: isFrameEl, box: box ? { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight } : null,
    text: String(text).slice(0, 60000),
  };
}

/**
 * 고른 부분을 찍을 자리에 둔다. rel 이 있으면 그 부분의 머리에서 rel 만큼 내려간 곳을 그 부분이 든 스크롤 칸(그 부분을 품은 가장 가까운
 * 스크롤 상자 — 없으면 창)의 맨 위에 둔다(처음에는 scrollIntoView 로 바깥 칸들까지 맞춘다 — 창이 아니라 안쪽 상자가 내려가는 페이지도 있다).
 * inner 가 있으면 그 부분(스크롤 상자) 안을 그만큼 내린다. 처음 한 번 그 부분을 품지도 그 안에 있지도 않은 고정 띠(position: fixed·sticky —
 * 머리 메뉴·채팅 단추)를 숨긴다(부분을 가리지 않게). 그 부분의 창 안 자리와, 보이는 칸(clip — 창과 스크롤 칸이 겹치는 곳)을 돌려준다.
 */
export function partStep(n, rel, inner) {
  const el = document.querySelector(`[data-krs-cap="${n}"]`);
  if (!el) return null;
  const html = document.documentElement;
  const keep = (window.__krsCap ||= { behavior: html.style.scrollBehavior, hidden: [], boxes: [], x: window.scrollX, y: window.scrollY });
  html.style.scrollBehavior = 'auto';
  const save = (b) => {
    if (!keep.boxes.some(([x]) => x === b)) keep.boxes.push([b, b.scrollTop, b.style.scrollBehavior]);
    b.style.scrollBehavior = 'auto';
  };
  let sc = null;
  for (let p = el.parentElement; p && p !== document.body && p !== html; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight + 1 && /(auto|scroll|overlay)/.test(getComputedStyle(p).overflowY)) {
      sc = p;
      break;
    }
  }
  const view = () => {
    if (!sc) return { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
    const r = sc.getBoundingClientRect();
    const top = r.top + sc.clientTop;
    const left = r.left + sc.clientLeft;
    return { top: Math.max(top, 0), left: Math.max(left, 0), bottom: Math.min(top + sc.clientHeight, window.innerHeight), right: Math.min(left + sc.clientWidth, window.innerWidth) };
  };
  if (!keep.hid && document.body) {
    keep.hid = true;
    for (const x of document.body.querySelectorAll('*')) {
      if (x.contains(el) || el.contains(x)) continue;
      const pos = getComputedStyle(x).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      keep.hidden.push([x, x.style.visibility]);
      x.style.visibility = 'hidden';
    }
  }
  if (rel != null) {
    if (sc) save(sc);
    if (!keep.placed) {
      keep.placed = true;
      el.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
    }
    const d = el.getBoundingClientRect().top - view().top + rel;
    if (sc) sc.scrollTop += d;
    else window.scrollBy(0, d);
  }
  if (inner != null) {
    save(el);
    el.scrollTop = inner;
  }
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height, inner: el.scrollTop, clip: view() };
}

/** 그 부분을 다 찍었다 — 숨긴 띠·스크롤 칸과 상자 안 자리·창 자리를 되돌리고 표시(data-krs-cap)를 뗀다. */
export function partDone(n) {
  const keep = window.__krsCap;
  if (keep) {
    for (const [x, v] of keep.hidden) x.style.visibility = v;
    for (const [b, top, sb] of keep.boxes) {
      b.scrollTop = top;
      b.style.scrollBehavior = sb;
    }
    window.scrollTo(keep.x, keep.y);
    document.documentElement.style.scrollBehavior = keep.behavior;
    delete window.__krsCap;
  }
  document.querySelector(`[data-krs-cap="${n}"]`)?.removeAttribute('data-krs-cap');
}

/* ------------------------------------------------------------ 순수 셈 */

/**
 * 찍을 자리. 한 화면 높이씩 내려가고, 마지막은 끝에 맞춘다(끝 화면은 앞 화면과 겹친다). MAX_SHOTS 를 넘는 긴 페이지는 앞부분만
 * 찍고 cut 에 표시한다. height 는 찍히는 높이(CSS px)다.
 * @returns {{steps: number[], height: number, cut: boolean}}
 */
export function shotPlan({ scrollHeight, viewportHeight }) {
  const vh = Math.max(1, Math.floor(Number(viewportHeight) || 0));
  const total = Math.max(vh, Math.floor(Number(scrollHeight) || 0));
  const steps = [];
  for (let y = 0; y < total && steps.length < MAX_SHOTS; y += vh) steps.push(Math.min(y, total - vh));
  const reached = steps.at(-1) + vh;
  const cut = reached < total;
  return { steps, height: cut ? reached : total, cut };
}

/**
 * 이은 그림을 자를 자리(CSS px). 한 장의 높이가 tileHeight 이고, 끝의 짧은 꼬리(한 장의 1/5 미만)는 앞 장에 붙인다 —
 * 몇 줄짜리 쪽을 따로 내지 않는다.
 * @returns {{y: number, h: number}[]}
 */
export function tileRanges(totalHeight, tileHeight) {
  const th = Math.max(1, Math.floor(Number(tileHeight) || 0));
  const total = Math.max(0, Math.floor(Number(totalHeight) || 0));
  const out = [];
  for (let y = 0; y < total; y += th) out.push({ y, h: Math.min(th, total - y) });
  if (out.length > 1 && out.at(-1).h < th / 5) {
    const tail = out.pop();
    out.at(-1).h += tail.h;
  }
  return out;
}

/** 캡처할 수 있는 주소인가 — 브라우저 안쪽 화면(chrome://·확장 화면)과 파일은 스크립트를 넣지 못한다. */
export function capturable(url) {
  const u = String(url || '');
  if (/^https?:\/\//i.test(u)) return { ok: true, why: '' };
  if (!u) return { ok: false, why: '캡처할 탭이 없습니다 — 읽을 웹페이지를 이 창에서 열어 두세요.' };
  return { ok: false, why: '이 화면은 캡처할 수 없습니다(브라우저 안쪽 화면·파일) — 읽을 웹페이지 탭을 앞에 두고 다시 누르세요.' };
}

/** 주소의 호스트 — 파일 이름에 쓴다(www. 은 뺀다). */
export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '') || 'page';
  } catch {
    return 'page';
  }
}

/** 장의 파일 이름 — 화면캡처_inflearn.com_2026-10-08_1.png. 이름의 꼴로 읽기가 무엇인지 알아본다(input.yaml gongmun 의 parts). */
export const tileName = (host, today, n) => `화면캡처_${String(host).replace(/[\\/:*?"<>|\s]+/g, '')}${today ? `_${today}` : ''}_${n}.png`;

/**
 * 화면 글자를 다듬는다 — 줄마다 앞뒤 빈칸을 지우고, 빈 줄은 하나로, 한도를 넘으면 자르고 표시한다.
 * 머리에 무슨 화면인지(제목·주소)를 적어 읽기가 "붙여 넣은 글" 이 아니라 웹페이지의 글자임을 알게 한다.
 */
export function normalizeText(raw, { title = '', url = '', max = TEXT_MAX } = {}) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ')
    .split('\n').map((l) => l.replace(/ {2,}/g, ' ').trim());
  const out = [];
  for (const l of lines) {
    if (!l && !out.at(-1)) continue;   // 빈 줄은 하나만
    out.push(l);
  }
  let body = out.join('\n').trim();
  if (body.length > max) body = `${body.slice(0, max).trimEnd()}\n…(너무 길어 여기서 잘랐습니다)`;
  const head = `[웹페이지 글자${title ? ` — ${String(title).trim()}` : ''}]${url ? ` ${url}` : ''}`;
  return body ? `${head}\n${body}` : '';
}

/**
 * 읽기에 보낼 장을 고른다 — 탭을 여럿 찍었으면 탭마다 첫 장부터 돌아가며(1번 탭 1쪽, 2번 탭 1쪽, 1번 탭 2쪽 …) room 장까지.
 * 긴 페이지 하나가 자리를 다 차지해 뒤 탭은 한 장도 못 읽히는 일이 없게 한다. 못 고른 장은 첨부에만 간다.
 * @param {number[]} counts 탭마다 장 수(찍은 차례대로)
 * @returns {boolean[]} 장마다(탭 차례로 이어서) 읽기에 보내면 true
 */
export function readSlots(counts, room) {
  const out = (counts || []).map((n) => Array(Math.max(0, n | 0)).fill(false));
  let left = Math.max(0, room | 0);
  for (let page = 0; left > 0 && out.some((p) => page < p.length); page++) {
    for (const p of out) {
      if (left > 0 && page < p.length) {
        p[page] = true;
        left--;
      }
    }
  }
  return out.flat();
}

/* ------------------------------------------------------------ 잇고 자르기 (브라우저) */

/** data URL 의 바이트. fetch 를 쓰지 않는다 — 패널의 fetch 는 사이트 요청용이다. 견적서 오리기(src/quotecut.js)도 쓴다. */
export function blobOf(dataUrl) {
  const [meta, b64 = ''] = String(dataUrl).split(',');
  const type = (meta.match(/^data:([^;]+)/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * 찍은 화면들을 A4 비율의 장으로 잇고 자른다. 거대한 캔버스 하나를 만들지 않는다 — 장마다 캔버스를 내고 거기에 걸치는 화면만 그린다
 * (화면 서른 장을 한 장으로 이으면 메모리를 수백 MB 쓴다). 그림은 쓸 때마다 풀고 바로 닫는다.
 * 배율은 첫 화면의 픽셀 폭 / 뷰포트 폭(= devicePixelRatio × 확대)이고, MAX_SCALE 을 넘으면 줄여 저장한다.
 * 부분을 찍은 것(capturePart)은 화면마다 crop(창 안의 x·y·w·h)만 오려 붙이고, 장의 폭은 width(그 부분의 폭)다.
 * @param {{shots: {dataUrl: string, y: number, h: number, crop?: {x: number, y: number, w: number, h: number}}[], viewportWidth: number,
 *   width?: number, totalHeight: number, tileHeight: number}} job y·h·crop 은 CSS px
 * @returns {Promise<Blob[]>} PNG 장들
 */
export async function stitchTiles({ shots, viewportWidth, width: cssWidth = viewportWidth, totalHeight, tileHeight }, { bitmapOf = (d) => createImageBitmap(blobOf(d)) } = {}) {
  if (!shots?.length) throw new Error('찍은 화면이 없습니다.');
  if (typeof OffscreenCanvas !== 'function') throw new Error('이 브라우저에서는 캡처를 이을 수 없습니다.');
  const first = await bitmapOf(shots[0].dataUrl);
  const scale = first.width / Math.max(1, viewportWidth);
  first.close?.();
  const k = Math.min(scale, MAX_SCALE);
  const width = Math.max(1, Math.round(cssWidth * k));
  const out = [];
  for (const r of tileRanges(totalHeight, tileHeight)) {
    const canvas = new OffscreenCanvas(width, Math.max(1, Math.round(r.h * k)));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const s of shots) {
      if (s.y + s.h <= r.y || s.y >= r.y + r.h) continue;
      const bm = await bitmapOf(s.dataUrl);
      const c = s.crop;
      if (c) {
        ctx.drawImage(bm, Math.round(c.x * scale), Math.round(c.y * scale), Math.round(c.w * scale), Math.round(c.h * scale),
          0, Math.round((s.y - r.y) * k), Math.round(c.w * k), Math.round(c.h * k));
      } else {
        ctx.drawImage(bm, 0, Math.round((s.y - r.y) * k), Math.round((bm.width * k) / scale), Math.round((bm.height * k) / scale));
      }
      bm.close?.();
    }
    out.push(await canvas.convertToBlob({ type: 'image/png' }));
  }
  return out;
}

/* ------------------------------------------------------------ 찍는 차례 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 탭 하나를 통째로 찍어 장(File)과 글자로 돌려준다.
 * @param {{tab: {url?: string}, exec: (func: Function, args?: any[]) => Promise<any>, shoot: () => Promise<string>, wait?: Function,
 *   stitch?: Function, today?: string, seq?: number, textMax?: number, onProgress?: (done: number, total: number) => void}} deps
 *   exec 는 탭 안에서 함수를 돌려 결과를 주고, shoot 는 보이는 화면을 PNG data URL 로 찍는다. seq 는 첫 장의 번호다(같은 사이트의 앞 탭에 잇는다)
 * @returns {Promise<{files: File[], text: string, title: string, url: string, host: string, shots: number, tiles: number, cut: boolean}>}
 */
export async function capturePage({ tab, exec, shoot, wait = sleep, stitch = stitchTiles, today = '', seq = 1, textMax = TEXT_MAX, onProgress = () => {} }) {
  const can = capturable(tab?.url);
  if (!can.ok) throw new Error(can.why);
  const info = await exec(pageInfo, []);
  if (!info || !Number.isFinite(info.viewportWidth) || !Number.isFinite(info.viewportHeight)) {
    throw new Error('페이지를 읽지 못했습니다 — 이 화면에는 스크립트를 넣을 수 없습니다.');
  }
  const plan = shotPlan(info);
  const shots = [];
  try {
    for (const [i, y] of plan.steps.entries()) {
      const at = await exec(pageStep, [y, i > 0]);
      await wait(SHOT_GAP_MS);
      onProgress(i + 1, plan.steps.length);
      shots.push({ dataUrl: await shoot(), y: Number.isFinite(at) ? at : y, h: info.viewportHeight });
    }
  } finally {
    await Promise.resolve().then(() => exec(pageDone, [info.scrollY || 0])).catch(() => {});
  }
  const tileHeight = Math.round(info.viewportWidth * A4_RATIO);
  const blobs = await stitch({ shots, viewportWidth: info.viewportWidth, totalHeight: plan.height, tileHeight });
  const url = info.url || tab.url || '';
  const host = hostOf(url);
  const files = blobs.map((b, i) => new File([b], tileName(host, today, seq + i), { type: 'image/png' }));
  return { files, text: normalizeText(info.text, { title: info.title, url, max: textMax }), title: info.title || '', url, host, shots: shots.length, tiles: files.length, cut: plan.cut };
}

/**
 * 고른 탭들을 차례로 앞에 두고(activate) 통째로 찍는다 — captureVisibleTab 은 앞에 있는 탭만 찍는다. 다 찍으면(실패해도) 처음 보던 탭을
 * 다시 앞에 둔다(back). 한 탭이 실패해도 나머지는 찍고 까닭을 failed 에 남긴다 — 하나도 못 찍으면 던진다.
 * 장 번호는 사이트마다 이어 간다(같은 사이트의 두 탭이 같은 이름을 내지 않게). 화면 글자의 한도는 탭 수로 나눈다.
 * @param {{tabs: {id: number, url: string, title?: string}[], activate: (tab: object) => Promise<void>, back: () => Promise<void>,
 *   execIn: (tab: object) => Function, shoot: () => Promise<string>, wait?: Function, stitch?: Function, today?: string,
 *   onProgress?: (done: number, total: number, nth: number, of: number) => void}} deps
 * @returns {Promise<{pages: object[], failed: {title: string, why: string}[]}>} pages 는 찍은 탭마다 capturePage 의 결과(고른 차례)
 */
export async function captureMany({ tabs, activate, back, execIn, shoot, wait = sleep, stitch = stitchTiles, today = '', onProgress = () => {} }) {
  const list = tabs || [];
  if (!list.length) throw new Error('캡처할 웹페이지를 고르세요.');
  const textMax = list.length > 1 ? Math.floor(TEXT_MAX / list.length) - TEXT_HEAD : TEXT_MAX;
  const next = {};
  const pages = [];
  const failed = [];
  try {
    for (const [i, tab] of list.entries()) {
      const host = hostOf(tab.url);
      try {
        await activate(tab);
        const got = await capturePage({
          tab, exec: execIn(tab), shoot, wait, stitch, today, seq: next[host] || 1, textMax,
          onProgress: (done, total) => onProgress(done, total, i + 1, list.length),
        });
        next[host] = (next[host] || 1) + got.files.length;
        pages.push(got);
      } catch (err) {
        failed.push({ title: String(tab.title || host), why: err?.message || String(err) });
      }
    }
  } finally {
    await Promise.resolve().then(back).catch(() => {});
  }
  if (!pages.length) {
    throw new Error(failed.length === 1 ? failed[0].why : `고른 웹페이지를 하나도 찍지 못했습니다 — ${failed.map((f) => `${f.title}: ${f.why}`).join(' / ')}`);
  }
  return { pages, failed };
}

/**
 * 페이지 위에서 고른 부분(pagePick 이 data-krs-cap="n" 을 단 요소) 하나를 찍는다 — 그 부분만 오려 A4 비율의 장으로 잇는다. 세 갈래다.
 *  · 틀(iframe) 안이 따로 내려가면 — 창은 틀의 머리에 두고 틀 안을 틀의 보이는 높이씩 내리며 찍는다(eClass 포털의 본문 틀).
 *  · 상자 안이 따로 내려가면(overflow: auto) — 같은 식으로 상자 안을 내린다.
 *  · 아니면 — 그 부분이 든 스크롤 칸(창, 또는 안쪽 상자)을 내리며 그 부분의 머리부터 끝까지 찍는다(한 화면보다 짧으면 한 번).
 * 그 부분을 품지도 그 안에 있지도 않은 고정 띠는 첫 장부터 숨긴다. 다 찍으면(실패해도) 자리와 숨긴 것을 되돌린다.
 * 글자는 그 부분의 글자다(틀이면 틀 안의 글자 — 다른 사이트의 틀이어도 frame 으로 읽는다).
 * @param {{part: {n: number, title?: string}, exec: Function, frame?: Function|null, shoot: () => Promise<string>, wait?: Function,
 *   stitch?: Function, today?: string, seq?: number, textMax?: number, onProgress?: (done: number, total: number) => void}} deps
 *   exec 는 탭의 맨 위 문서에서, frame 은 고른 틀 안에서 함수를 돌린다(틀을 못 맞췄으면 null — 틀이 보이는 만큼만 찍는다)
 * @returns {Promise<{files: File[], text: string, title: string, url: string, host: string, shots: number, tiles: number, cut: boolean, part: number}>}
 */
export async function capturePart({ part, exec, frame = null, shoot, wait = sleep, stitch = stitchTiles, today = '', seq = 1, textMax = TEXT_MAX, onProgress = () => {} }) {
  const lost = () => new Error('고른 부분을 찾지 못했습니다 — 페이지가 바뀌었으면 다시 고르세요.');
  const info = await exec(partInfo, [part.n]);
  if (!info || !Number.isFinite(info.vw) || !Number.isFinite(info.vh)) throw lost();
  const inFrame = info.frame && frame ? await Promise.resolve().then(() => frame(pageInfo, [])).catch(() => null) : null;
  const shots = [];
  let width = 0;
  let plan = null;
  let total = 0;   // 이어 붙일 높이 — shotPlan 은 한 화면보다 짧아도 한 화면 높이를 주니 부분의 높이로 줄인다
  const snap = async (i) => {
    await wait(SHOT_GAP_MS);
    onProgress(i + 1, plan.steps.length);
    return shoot();
  };
  try {
    // 그 부분의 머리를 보이는 칸의 맨 위에 둔다(페이지 끝이면 덜 내려간다).
    const head = await exec(partStep, [part.n, 0, null]);
    if (!head) throw lost();
    // 보이는 칸 — 창과, 그 부분이 든 스크롤 칸이 겹치는 곳(partStep 이 준다).
    const clip = head.clip || { top: 0, left: 0, bottom: info.vh, right: info.vw };
    const inner = inFrame && inFrame.scrollHeight > inFrame.viewportHeight + 4 ? 'frame' : info.box ? 'box' : '';
    if (inner) {
      // 테두리 안쪽에서 보이는 칸이 한 화면이다.
      const left = head.left + info.edge.left;
      const top = head.top + info.edge.top;
      const x = Math.max(left, clip.left);
      const y = Math.max(top, clip.top);
      const w = Math.min(left + info.edge.w, clip.right) - x;
      const h = Math.min(top + info.edge.h, clip.bottom) - y;
      if (w < 1 || h < 1) throw new Error('고른 부분이 화면에 보이지 않습니다.');
      const full = inner === 'frame' ? inFrame.scrollHeight : info.box.scrollHeight;
      plan = shotPlan({ scrollHeight: full, viewportHeight: h });
      total = Math.min(plan.height, full);
      for (const [i, sy] of plan.steps.entries()) {
        const at = inner === 'frame' ? await frame(pageStep, [sy, i > 0]) : (await exec(partStep, [part.n, null, sy]))?.inner;
        shots.push({ dataUrl: await snap(i), y: Number.isFinite(at) ? at : sy, h, crop: { x, y, w, h } });
      }
      width = w;
    } else {
      const x = Math.max(head.left, clip.left);
      width = Math.min(head.left + head.width, clip.right) - x;
      const view = clip.bottom - clip.top;
      if (width < 1 || view < 1) throw new Error('고른 부분이 화면에 보이지 않습니다.');
      plan = shotPlan({ scrollHeight: info.height, viewportHeight: view });
      total = Math.min(plan.height, Math.ceil(info.height));
      let prev = null;
      for (const [i, sy] of plan.steps.entries()) {
        const at = i === 0 ? head : await exec(partStep, [part.n, sy, null]);
        if (!at || (prev && at.top === prev.top)) continue;   // 더 내려가지 않았다(페이지 끝·스크롤이 막힘)
        prev = at;
        const c = at.clip || clip;
        const top = Math.max(at.top, c.top);
        const bottom = Math.min(at.top + at.height, c.bottom);
        if (bottom - top < 1) continue;
        shots.push({ dataUrl: await snap(i), y: top - at.top, h: bottom - top, crop: { x, y: top, w: width, h: bottom - top } });
      }
    }
  } finally {
    if (inFrame) await Promise.resolve().then(() => frame(pageDone, [inFrame.scrollY || 0])).catch(() => {});
    await Promise.resolve().then(() => exec(partDone, [part.n])).catch(() => {});
  }
  const blobs = await stitch({ shots, viewportWidth: info.vw, width, totalHeight: total, tileHeight: Math.round(width * A4_RATIO) });
  const url = info.url || '';
  const host = hostOf(url);
  const files = blobs.map((b, i) => new File([b], tileName(host, today, seq + i), { type: 'image/png' }));
  const text = normalizeText(inFrame?.text || info.text, { title: [info.title, part.title].filter(Boolean).join(' — '), url: inFrame?.url || url, max: textMax });
  return { files, text, title: part.title || info.title || '', url, host, shots: shots.length, tiles: files.length, cut: plan.cut, part: part.n };
}

/**
 * 고른 부분들을 고른 차례대로 찍는다 — 부분 하나가 한 묶음(페이지 하나와 같다)이다. 한 부분이 실패해도 나머지는 찍고 까닭을 남긴다.
 * 장 번호는 이어 가고, 글자의 한도는 부분 수로 나눈다. frameOf 는 고른 틀의 frameId 를 맞춰 그 틀 안에서 돌리는 함수를 준다(못 맞추면 null).
 * @returns {Promise<{pages: object[], failed: {title: string, why: string}[]}>}
 */
export async function captureParts({ parts, exec, frameOf = async () => null, shoot, wait = sleep, stitch = stitchTiles, today = '', onProgress = () => {} }) {
  const list = parts || [];
  if (!list.length) throw new Error('캡처할 부분을 고르세요.');
  const textMax = list.length > 1 ? Math.floor(TEXT_MAX / list.length) - TEXT_HEAD : TEXT_MAX;
  let seq = 1;
  const pages = [];
  const failed = [];
  for (const [i, part] of list.entries()) {
    try {
      const frame = part.frame ? await Promise.resolve().then(() => frameOf(part.frame)).catch(() => null) : null;
      const got = await capturePart({ part, exec, frame, shoot, wait, stitch, today, seq, textMax, onProgress: (done, total) => onProgress(done, total, i + 1, list.length) });
      seq += got.files.length;
      pages.push(got);
    } catch (err) {
      failed.push({ title: part.title || `${i + 1}번째 부분`, why: err?.message || String(err) });
    }
  }
  if (!pages.length) {
    throw new Error(failed.length === 1 ? failed[0].why : `고른 부분을 하나도 찍지 못했습니다 — ${failed.map((f) => `${f.title}: ${f.why}`).join(' / ')}`);
  }
  return { pages, failed };
}

/**
 * 고른 틀이 어느 frameId 인지 — frameProbe 를 모든 틀에 돌린 결과에서 맨 위 문서 바로 아래의 틀만 본다. 주소(같은 사이트면 지금 주소)·
 * 이름·src·크기 차례로, 하나로 좁혀지는 것을 쓴다. 틀이 하나뿐이면 그것이다. 못 맞추면 null.
 */
export function matchFrame(frames, want) {
  if (!want) return null;
  const kids = (frames || []).filter((f) => f && f.frameId !== 0 && f.child);
  const tries = [
    (f) => !!want.href && f.href === want.href,
    (f) => !!want.name && f.name === want.name,
    (f) => !!want.src && f.href === want.src,
    (f) => Math.abs(f.w - want.w) <= 1 && Math.abs(f.h - want.h) <= 1,
  ];
  for (const ok of tries) {
    const hit = kids.filter(ok);
    if (hit.length === 1) return hit[0].frameId;
  }
  return kids.length === 1 ? kids[0].frameId : null;
}

/* ------------------------------------------------------------ chrome 에 꽂기 */

const ALL_SITES = { origins: ['<all_urls>'] };

/**
 * 사이트 접근 권한. captureVisibleTab 은 <all_urls>(또는 activeTab) 가 있어야 하고, 그 탭에 스크립트를 넣는 데도 호스트 권한이 든다.
 * 매니페스트의 optional_host_permissions 에 두고 처음 누를 때 한 번 묻는다(허용하면 남는다). 거절하면 까닭을 던진다.
 */
async function ensureSites() {
  if (!chrome.permissions?.contains) return;
  if (await chrome.permissions.contains(ALL_SITES)) return;
  const ok = await chrome.permissions.request(ALL_SITES).catch((e) => { throw new Error(`사이트 접근 권한을 묻지 못했습니다 — ${e?.message || e}`); });
  if (!ok) throw new Error('웹페이지를 캡처하려면 사이트 접근 권한이 필요합니다 — 다시 누르고 허용해 주세요.');
}

function needApi() {
  if (typeof chrome === 'undefined' || !chrome.tabs?.captureVisibleTab || !chrome.scripting?.executeScript) {
    throw new Error('이 브라우저에서는 웹페이지를 캡처할 수 없습니다.');
  }
}

/** 탭을 앞에 두고 다 읽힐 때까지 기다린다 — 잠든 탭은 앞에 두면 다시 읽는다. 그려질 틈은 찍기 전의 SHOT_GAP_MS 가 준다. */
async function bringUp(tabId) {
  const gone = () => new Error('탭이 닫혔습니다 — 다시 골라 주세요.');
  await chrome.tabs.update(tabId, { active: true }).catch(() => { throw gone(); });
  for (let t = 0; t < READY_MS; t += 200) {
    const now = await chrome.tabs.get(tabId).catch(() => null);
    if (!now) throw gone();
    if (now.active && now.status === 'complete') return;
    await sleep(200);
  }
}

/**
 * 탭들을 통째로 찍는다 — 지금은 보고 있는 탭 하나(captureFront)다. 권한은 사용자 동작(단추 누름) 안에서 먼저 묻는다.
 * 찍는 동안 그 탭들이 차례로 앞에 나왔다가, 끝나면 누르기 전에 보던 탭으로 돌아온다.
 * @param {{id: number, url: string, title?: string}[]} tabs
 * @param {{today?: string, onProgress?: Function}} [opts]
 */
export async function captureTabs(tabs, opts = {}) {
  needApi();
  await ensureSites();
  const win = await chrome.windows.getCurrent();
  const [front] = await chrome.tabs.query({ active: true, windowId: win.id });
  return captureMany({
    tabs,
    activate: (tab) => bringUp(tab.id),
    back: () => (front ? chrome.tabs.update(front.id, { active: true }) : undefined),
    execIn: (tab) => async (func, args = []) => (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }))?.[0]?.result,
    shoot: () => chrome.tabs.captureVisibleTab(win.id, { format: 'png' }),
    ...opts,
  });
}

/** 보고 있는 탭(이 창의 앞 탭) — 찍을 수 없는 화면(브라우저 안쪽 화면·파일)이면 까닭을 던진다. */
export async function frontTab() {
  needApi();
  const win = await chrome.windows.getCurrent();
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  const can = capturable(tab?.url);
  if (!can.ok) throw new Error(can.why);
  return { id: tab.id, url: tab.url, title: String(tab.title || '').trim() || hostOf(tab.url), host: hostOf(tab.url), active: true, windowId: win.id };
}

/** 보고 있는 탭을 위에서 아래까지 통째로 찍는다 — "보고 있는 탭" 단추. 권한은 단추 누름 안에서 먼저 묻는다. */
export async function captureFront(opts = {}) {
  needApi();
  await ensureSites();
  return captureTabs([await frontTab()], opts);
}

/**
 * 보고 있는 탭 위에 고르기 막을 씌운다(pagePick) — "부분 골라 캡처" 단추. done 은 사용자가 페이지의 캡처를 누르면 고른 부분들로,
 * 취소하면 null 로 풀린다. cancel 은 패널의 "고르기 취소"다(페이지의 막을 걷는다).
 * @returns {Promise<{tab: object, done: Promise<object[]|null>, cancel: () => Promise<void>}>}
 */
export async function startPick() {
  needApi();
  await ensureSites();
  const tab = await frontTab();
  const done = chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pagePick })
    .then((r) => r?.[0]?.result || null, (e) => { throw new Error(`페이지에서 고르지 못했습니다 — ${e?.message || e}`); });
  const cancel = () => chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pickCancel }).then(() => {}, () => {});
  return { tab, done, cancel };
}

/**
 * 고른 부분들을 찍는다(captureParts) — 고른 탭을 앞에 두고(고르는 사이에 탭을 바꿨을 수 있다) 부분마다 찍는다.
 * 고른 틀은 모든 틀에 frameProbe 를 돌려 frameId 를 맞추고(matchFrame), 그 틀 안에서 pageInfo·pageStep·pageDone 을 돌린다.
 */
export async function captureTabParts(tab, parts, opts = {}) {
  needApi();
  await bringUp(tab.id);
  const run = async (func, args = [], frameId = null) => (await chrome.scripting.executeScript({
    target: frameId == null ? { tabId: tab.id } : { tabId: tab.id, frameIds: [frameId] }, func, args,
  }))?.[0]?.result;
  const frameOf = async (want) => {
    const all = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: frameProbe }).catch(() => []);
    const id = matchFrame((all || []).map((r) => ({ frameId: r.frameId, ...(r.result || {}) })), want);
    return id == null ? null : (func, args = []) => run(func, args, id);
  };
  return captureParts({
    parts, exec: (func, args = []) => run(func, args), frameOf,
    shoot: () => chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }), ...opts,
  });
}
