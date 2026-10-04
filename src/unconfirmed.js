// e-Class 홈의 WORKSPACE 카드 위에 "접수 미확인 공문" 카드를 붙인다.
//
// DOC Cruiser Monitoring 의 "3) Uncfm. Rcv DOC" — 내 앞으로 왔는데 아직 접수 확인을 하지 않은 공문이다.
// 그 숫자가 여는 목록(Rcv_Not_Confirm_List.aspx)을 받아 **제목만** 늘어놓고, 누르면 사이트의 제목 링크가
// 여는 것과 같은 문서 창(RfReceivePrefer_View.aspx)을 띄운다.
//
// 이 카드가 스스로 하는 요청은 **목록 하나뿐**이다. 문서 창은 사람이 눌렀을 때만 열린다 — 미회람 문서처럼
// 받기만 해도 서버에 기록이 남는 화면일 수 있어, 확장이 대신 열어 보지 않는다.
//
// 목록은 요청 한 번(25KB)이라 담아 두지 않고 홈을 열 때마다 받는다. 문서 창에서 접수 확인을 하고 홈으로
// 돌아오면(창에 초점이 돌아오면) 다시 받아 그 건이 빠진 것을 보여준다.
//
// 겉모습은 WORKSPACE 카드와 같은 홈 카드 공통 스타일(src/homecard.js)이고, 안쪽은 krs-uncfm-* 자체 스타일만 쓴다.
// **처음에는 머리 한 줄**(이름·건수 칩·읽은 시각)만 보이고, 머리 줄이나 화살표 버튼을 눌러야 제목 목록이 나온다
// — 홈을 열 때마다 공문 제목이 자리를 차지하지 않게. 못 읽었다는 경고는 접혀 있어도 보인다.

import { UNCFM_LIST_URL, RCV_VIEW_URL, RCV_OFFLINE_VIEW_URL } from './config.js';
import { directFetch } from './net.js';
import { parseHtml } from './aspnet.js';
import { findAnchor, ROOT_ID as MINE_ROOT_ID } from './home.js';
import { CARD_STYLE, ICON, setChip } from './homecard.js';

/** 카드를 쓸지. 패널의 "설정 및 연결" 체크박스가 이 값을 쓴다. 값이 없으면 켠 것으로 본다. */
export const ENABLE_KEY = 'homeUncfm';
export const unconfirmedEnabled = (value) => value !== false;
/** 카드의 루트 요소 id. */
export const ROOT_ID = 'krsUncfm';
/** 홈으로 돌아올 때 다시 받되, 방금 받았으면 건너뛴다. 창을 오갈 때마다 사이트를 두드리지 않게. */
export const REFRESH_GAP_MS = 10_000;
/** 문서 창 크기. 사이트의 ViewRcvDoc_Ex 가 여는 것과 같다. */
export const POPUP = { width: 860, height: 800 };

/** 목록의 제목 링크: javascript:ViewRcvDoc_Ex('R_ID', 'S_ID'). 오프라인 문서는 둘째가 비어 있다. */
const VIEW_RE = /ViewRcvDoc_Ex\(\s*'([0-9A-Fa-f]+)'\s*,\s*'([0-9A-Fa-f]*)'/;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const pad = (n) => String(n).padStart(2, '0');

/** 문서 한 건의 보기 주소. 사이트의 ViewRcvDoc_Ex() 가 만드는 것과 같다. */
export const viewUrl = (d) => `${d.sId ? RCV_VIEW_URL : RCV_OFFLINE_VIEW_URL}?R_ID=${d.rId}`;

/* ------------------------------------------------------------ 읽기 */

/**
 * 접수 미확인 목록에서 문서들을 뽑는다.
 *   recognized — 목록 화면이 맞는가(표나 건수 라벨이 있다). 아니면 로그인 안내이거나 모르는 화면이다
 *   declared   — 사이트가 스스로 센 건수(`2 results`). 뽑은 건수와 대조한다. 못 읽으면 null
 */
export function parseUnconfirmed(html) {
  const doc = parseHtml(html);
  const label = doc.querySelector('#lblResult');
  const recognized = !!(label || doc.querySelector('#RadGridDOC'));
  const m = (label?.textContent || '').match(/\d[\d,]*/);
  const declared = m ? +m[0].replace(/,/g, '') : null;

  const docs = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href*="ViewRcvDoc_Ex"]')) {
    const hit = (a.getAttribute('href') || '').match(VIEW_RE);
    if (!hit || seen.has(hit[1])) continue;
    seen.add(hit[1]);
    // 칸 차례: No. · Doc No. · Title · Rcv Date · P.I.C · Snd No. · Sender · …
    const cells = [...(a.closest('tr')?.cells || [])].map((c) => clean(c.textContent));
    docs.push({
      rId: hit[1], sId: hit[2], title: clean(a.textContent),
      docNo: cells[1] || '', rcvDate: cells[3] || '', sender: cells[6] || '',
    });
  }
  return { recognized, declared, docs };
}

/** 미인증이면 목록 대신 "다시 로그인" alert 한 줄만 온다(미회람 목록과 같은 앱이다). */
const looksSignedOut = (html) => html.length < 1500 && /로그인|sign in/i.test(html);

/** 목록을 받는다. 목록 화면이 아니면 "없다"로 넘기지 않고 던진다. */
export async function readUnconfirmed(fetchPage = directFetch) {
  const { html } = await fetchPage(UNCFM_LIST_URL, { cache: 'no-store' });
  const list = parseUnconfirmed(html);
  if (list.recognized) return list;
  if (looksSignedOut(html)) throw new Error('로그인이 필요합니다. eclass 에 다시 로그인한 뒤 새로고침하세요.');
  throw new Error('접수 미확인 문서 목록 화면을 알아보지 못했습니다.');
}

/* ------------------------------------------------------------ 자리 찾기 */

/**
 * 카드를 어디에 붙일지. WORKSPACE 카드가 이미 있으면 그 바로 위, 없으면 WORKSPACE 카드가 붙을 자리다
 * — WORKSPACE 카드는 그 뒤에 와도 Popup Notice 바로 앞에 끼어들므로 어느 쪽이 먼저든 이 카드가 위에 온다.
 */
export function findSpot(doc) {
  const mine = doc.getElementById(MINE_ROOT_ID);
  if (mine?.parentElement) return { mode: 'before', el: mine };
  return findAnchor(doc);
}

/* ------------------------------------------------------------ 그리기 */

const STYLE = `${CARD_STYLE}
.krs-uncfm:not(:has(.krs-uncfm-list:not([hidden]) .krs-uncfm-item, .krs-uncfm-warn:not(:empty))) .krs-uncfm-body { display: none; }
.krs-uncfm .krs-uncfm-head.can-open { cursor: pointer; }
.krs-uncfm .krs-uncfm-body { padding-top: 6px; padding-bottom: 8px; }
.krs-uncfm .krs-uncfm-list { margin: 0; padding: 0; list-style: none; }
.krs-uncfm .krs-uncfm-list[hidden] { display: none; }
.krs-uncfm[aria-busy="true"] .krs-uncfm-list { opacity: .7; }
.krs-uncfm .krs-uncfm-list li + li { border-top: 1px solid #e3eaf3; }
.krs-uncfm .krs-uncfm-item { display: block; padding: 6px 2px; overflow: hidden; color: #1f4e9c; font-size: 13px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
.krs-uncfm .krs-uncfm-item:hover { color: #1a5fb4; text-decoration: underline; }
.krs-uncfm .krs-uncfm-list:not(:empty, [hidden]) ~ .krs-uncfm-warn:not(:empty) { margin-top: 8px; }
`;

/** 홈 카드의 공통 겉(homecard.js)을 만든다. 안쪽 목록은 읽은 뒤에 채운다. */
function buildCard(doc) {
  const root = doc.createElement('div');
  root.id = ROOT_ID;
  root.className = 'row pt-3 mt-1 krs-card krs-uncfm';
  root.innerHTML = `<style>${STYLE}</style>
<div class="col-12">
  <div class="krs-card-panel">
    <div class="krs-card-head krs-uncfm-head" data-act="toggle">
      <span class="krs-card-title krs-uncfm-title">접수 미확인 공문</span>
      <span class="krs-card-chips">
        <span class="krs-card-chip" title="아직 접수 확인을 하지 않은 공문"><span>미확인</span><b data-role="count"></b></span>
      </span>
      <span class="krs-card-note" data-role="note"></span>
      <span class="krs-card-tools">
        <button type="button" class="krs-card-btn" data-act="refresh" title="새로고침 — DOC-Cruiser 의 접수 미확인 목록을 다시 받습니다" aria-label="새로고침">${ICON.refresh}</button>
        <button type="button" class="krs-card-btn" data-act="toggle" data-role="toggle" aria-expanded="false" hidden>${ICON.chevron}</button>
      </span>
    </div>
    <div class="krs-card-body krs-uncfm-body">
      <ul class="krs-uncfm-list" data-role="list" hidden></ul>
      <p class="krs-card-warn krs-uncfm-warn" data-role="warn"></p>
    </div>
  </div>
</div>`;
  const q = (role) => root.querySelector(`[data-role="${role}"]`);
  return {
    root, head: root.querySelector('.krs-uncfm-head'),
    count: q('count'), note: q('note'), list: q('list'), warn: q('warn'), toggle: q('toggle'),
    refresh: root.querySelector('[data-act="refresh"]'),
  };
}

/**
 * 한 줄. 보이는 것은 제목뿐이고, 문서 번호·접수일·보낸 곳은 툴팁에 둔다.
 * 링크(<a>)로 만든다 — Ctrl·가운데 클릭으로 새 탭에 여는 것과 주소 복사가 그냥 된다.
 */
function itemEl(doc, d, i) {
  const li = doc.createElement('li');
  const a = doc.createElement('a');
  a.className = 'krs-uncfm-item';
  a.href = viewUrl(d);
  a.target = '_blank';
  a.rel = 'noopener';
  a.dataset.i = String(i);
  a.title = [d.docNo, d.rcvDate, d.sender].filter(Boolean).join(' · ');
  a.textContent = d.title || d.docNo || '(제목 없음)';
  li.append(a);
  return li;
}

/** 사이트의 OpenWindow() 처럼 화면 가운데에 작은 창으로 연다. */
function openPopup(win, url) {
  const left = Math.max(0, Math.round(((win.screen?.availWidth || POPUP.width) - POPUP.width) / 2));
  const top = Math.max(0, Math.round(((win.screen?.availHeight || POPUP.height) - POPUP.height) / 2));
  const popup = win.open(url, '_blank',
    `height=${POPUP.height},width=${POPUP.width},top=${top},left=${left},status=yes,menubar=no,scrollbars=yes,resizable=yes`);
  popup?.focus();
  return popup;
}

/* ------------------------------------------------------------ 붙이기 */

/** storage 변화를 듣는다. 돌려주는 함수로 그만 듣는다 — 카드를 끄면 떼어야 한다. */
function defaultOnChanged(fn) {
  const ev = chrome.storage.onChanged;
  if (!ev) return () => {};
  ev.addListener(fn);
  return () => ev.removeListener(fn);
}

/**
 * 홈 문서에 카드를 붙이고 목록을 받기 시작한다.
 *
 * 바깥 것은 주입받는다(요청·시각·창 열기) — 테스트가 가짜로 돌리기 위해서다.
 * @returns {{root: Element, ready: Promise, refresh: Function, destroy: Function}|null}
 *   알아보는 자리가 없으면 null
 */
export function createUnconfirmedCard(doc, deps = {}) {
  const spot = findSpot(doc);
  if (!spot) return null;

  const win = doc.defaultView;
  const fetchPage = deps.fetchPage || directFetch;
  const now = deps.now || (() => Date.now());
  const openDoc = deps.openDoc || ((url) => openPopup(win, url));
  const visible = deps.visible || (() => doc.visibilityState !== 'hidden');

  // 확장을 다시 올렸거나 두 번 불렸으면 먼저 것은 치운다.
  doc.getElementById(ROOT_ID)?.remove();
  const ui = buildCard(doc);
  if (spot.mode === 'before') spot.el.parentElement.insertBefore(ui.root, spot.el);
  else spot.el.prepend(ui.root);

  let docs = [];
  let have = false;        // 한 번이라도 목록을 읽었다
  let running = null;      // 지금 도는 읽기. 한 번에 하나만.
  let lastAt = 0;
  let disposed = false;
  let open = false;        // 제목 목록을 펼쳤는가. 처음에는 머리 한 줄이다

  const setBusy = (on) => {
    ui.root.setAttribute('aria-busy', String(on));
    ui.refresh.disabled = on;
  };

  /** 목록을 펼치거나 접는다. 다시 받아도 펼친 것은 펼친 채로 둔다. */
  function setOpen(on) {
    open = on;
    ui.list.hidden = !open;
    const label = open ? '접기' : '펼치기';
    ui.toggle.setAttribute('aria-expanded', String(open));
    ui.toggle.setAttribute('aria-label', label);
    ui.toggle.title = label;
    ui.head.title = docs.length ? `클릭: ${label}` : '';
  }
  setOpen(false);

  function paint(list, at) {
    docs = list.docs;
    have = true;
    // 펼칠 것이 없으면 펼치기 버튼도 두지 않는다. 건수는 칩이 말한다 — 0 건이라고 따로 적지 않는다.
    ui.toggle.hidden = !docs.length;
    ui.head.classList.toggle('can-open', docs.length > 0);
    setChip(ui.count, docs.length);
    setOpen(open);
    ui.list.replaceChildren(...docs.map((d, i) => itemEl(doc, d, i)));
    const t = new Date(at);
    ui.note.textContent = `${pad(t.getHours())}:${pad(t.getMinutes())} 읽음`;
    // 사이트가 센 건수와 뽑은 건수가 다르면 놓친 문서가 있다는 뜻이다. 다 보여준 것처럼 넘기지 않는다.
    ui.warn.textContent = list.declared != null && list.declared !== docs.length
      ? `⚠ 목록은 ${list.declared}건이라는데 ${docs.length}건만 읽었습니다` : '';
  }

  /** 목록을 받아 그린다. 못 읽으면 먼저 읽어 둔 것은 그대로 두고 그 사실을 말한다. */
  function run() {
    if (disposed) return Promise.resolve();
    if (running) return running;
    setBusy(true);
    if (!have) ui.note.textContent = '읽는 중...';
    running = (async () => {
      try {
        const list = await readUnconfirmed(fetchPage);
        if (!disposed) paint(list, now());
      } catch (err) {
        if (disposed) return;
        if (!have) ui.note.textContent = '';
        ui.warn.textContent = `읽지 못했습니다: ${err.message}${have ? ' (목록은 먼저 읽어 둔 것입니다)' : ''}`;
      } finally {
        lastAt = now();
        setBusy(false);
        running = null;
      }
    })();
    return running;
  }

  // 문서 창에서 접수 확인을 하고 돌아오면 그 건이 빠져 있어야 한다. 창·탭으로 돌아올 때 다시 받는다.
  const onBack = () => {
    if (!disposed && visible() && now() - lastAt >= REFRESH_GAP_MS) run();
  };
  win?.addEventListener('focus', onBack);
  doc.addEventListener('visibilitychange', onBack);

  ui.root.addEventListener('click', (e) => {
    const target = e.target?.closest ? e.target : null;
    const act = target?.closest('[data-act]')?.dataset.act;
    if (act === 'refresh') { run(); return; }
    // 머리 줄 어디를 눌러도 펼치고 접는다(화살표 버튼도 같은 일). 펼칠 것이 없으면 아무 일도 없다.
    if (act === 'toggle') { if (docs.length) setOpen(!open); return; }
    const a = target?.closest('a[data-i]');
    const d = a ? docs[+a.dataset.i] : null;
    if (!d) return;
    // 그냥 누르면 사이트처럼 작은 창으로 연다. Ctrl·Shift·가운데 클릭은 링크 그대로 둔다(새 탭·새 창).
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    openDoc(viewUrl(d), d);
  });

  /** 카드를 뗀다. 듣던 것도 모두 떼어낸다. */
  function destroy() {
    if (disposed) return;
    disposed = true;
    win?.removeEventListener('focus', onBack);
    doc.removeEventListener('visibilitychange', onBack);
    ui.root.remove();
  }

  return {
    root: ui.root,
    ready: run(),
    refresh: run,
    destroy,
    get destroyed() { return disposed; },
  };
}

/**
 * 설정(ENABLE_KEY)을 따라 카드를 붙이거나 뗀다. 콘텐츠 스크립트는 이것을 부른다.
 * 패널에서 체크박스를 바꾸면 열려 있는 홈에도 곧바로 반영된다.
 * @returns {Promise<{card: object|null, stop: Function}>}
 */
export async function startUnconfirmed(doc, deps = {}) {
  const storage = deps.storage || chrome.storage.local;
  const onChanged = deps.onChanged || defaultOnChanged;
  let card = null;

  const apply = (on) => {
    if (on && !card) card = createUnconfirmedCard(doc, deps);
    else if (!on && card) {
      card.destroy();
      card = null;
    }
  };

  const off = onChanged((changes, area) => {
    if (area && area !== 'local') return;
    if (ENABLE_KEY in changes) apply(unconfirmedEnabled(changes[ENABLE_KEY].newValue));
  });

  const saved = await storage.get(ENABLE_KEY);
  apply(unconfirmedEnabled(saved?.[ENABLE_KEY]));
  await card?.ready;

  return {
    get card() { return card; },
    stop() {
      off?.();
      apply(false);
    },
  };
}
