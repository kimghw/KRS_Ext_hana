// 웹페이지 골라 통째로 캡처 — 이 창에 열어 둔 웹페이지(탭)를 늘어놓고 전체 또는 하나 이상 골라 찍는 칸(2026-10-08 사용자 지정).
// 공문 탭의 문서 넣는 곳(gongmunpanel.js)과 출장 카드의 증빙 넣는 곳(attendpanel.js — 사후정산 칸·여비증빙 송부 칸)이 **같은 칸**을
// 쓴다(2026-10-08 사용자 지정: "여기도 웹페이지 카피 공문처럼 하게해줘.. 2개 동일한 기능으로"). 찍는 일은 src/pagecap.js 다.
//
//   단추(웹페이지 골라 통째로 캡처해 읽기) → 탭 목록(체크박스 · 맨 위에 전체) → 고른 n개 캡처해 읽기 → 찍은 장·화면 글자 → 그 곳의 읽기
//
// 아무것도 미리 고르지 않는다(탭이 하나뿐이면 그것) — 옆에 띄워 둔 받은 편지함 같은 화면이 모르는 새 찍히지 않게. 단추를 다시 누르면 접는다.
// 칸은 글(html)로 그린다 — 출장 카드는 다시 그릴 때마다 innerHTML 을 통째로 바꾸므로, 펴 둔 목록과 고른 탭은 여기(st)에 둔다.
// 한 번에 한 곳만 편다(key — 공문 탭은 'gongmun', 출장 카드는 신청서 번호와 칸). 누름은 data-pick 으로 가린다(그 패널의 data-act 와 겹치지 않게).
//
// 찍은 장을 무엇으로 쓰는지는 곳마다 다르다 — 공문은 장들을 그대로 읽고 문서마다 첨부 PDF 로 묶는다. 출장 증빙은 페이지 하나를 PDF
// 하나로 묶어 증빙 한 장으로 읽는다(pagePdfs — 예약 확인 화면이 A4 석 장이어도 증빙은 하나다).

import { webTabs, captureTabs, MAX_SHOTS } from './src/pagecap.js';
import { buildPdf } from './src/pdf.js';

export const PICK_LABEL = '웹페이지 골라 통째로 캡처해 읽기';
export const PICK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M8 5V3m8 2V3"/></svg>';
export const NO_TABS = '캡처할 웹페이지가 없습니다 — 읽을 웹페이지를 이 창의 탭으로 열어 두세요(브라우저 안쪽 화면·파일은 찍지 못합니다).';
/** 출장 증빙으로 묶는 장의 JPEG 품질 — PNG 그대로면 그림이 많은 예약 화면 한 페이지가 10MB 를 넘는다. */
const JPEG_QUALITY = 0.85;

const goText = (n) => (n ? `고른 ${n}개 캡처해 읽기` : '캡처할 웹페이지를 고르세요');

/**
 * @param {{escapeHtml: Function, listTabs?: () => Promise<object[]>, capture?: (tabs: object[], opts: object) => Promise<object>}} deps
 *   listTabs 는 이 창에 열어 둔 웹페이지 탭들, capture 는 고른 탭들을 통째로 찍는 길(src/pagecap.js — 테스트가 갈아 끼운다)
 */
export function createWebPick({ escapeHtml, listTabs = webTabs, capture = captureTabs }) {
  // key 는 펴 둔 곳, tabs 는 펴 둔 탭 목록(접혀 있으면 null), pick 은 고른 탭 id.
  const st = { key: null, tabs: null, pick: new Set() };
  const isOpen = (key) => !!st.tabs && st.key === key;

  /** 그 곳의 목록을 편다(탭 목록을 새로 읽는다) — 이미 펴 있으면 접는다. 폈으면 true. 탭을 못 읽었거나 찍을 탭이 없으면 던진다. */
  async function toggle(key) {
    if (isOpen(key)) {
      close();
      return false;
    }
    const tabs = await listTabs();
    if (!tabs.length) throw new Error(NO_TABS);
    Object.assign(st, { key, tabs, pick: new Set(tabs.length === 1 ? [tabs[0].id] : []) });
    return true;
  }

  function close() {
    Object.assign(st, { key: null, tabs: null, pick: new Set() });
  }

  /** 목록의 속 — 머리(전체 · 몇 개 · 안내), 줄마다 체크박스·제목·사이트(보고 있는 탭이면 그렇게 적는다), 캡처·닫기. 펴 있지 않으면 ''. */
  function inner({ busy = false } = {}) {
    if (!st.tabs) return '';
    const n = st.pick.size;
    const on = (b) => (b ? ' checked' : '');
    const rows = st.tabs.map((t) => `<li><label class="wp-tab" title="${escapeHtml(t.url)}">`
      + `<input type="checkbox" data-tab="${t.id}"${on(st.pick.has(t.id))} />`
      + `<span class="wp-tab-text"><span class="wp-tab-title">${escapeHtml(t.title)}</span>`
      + `<span class="wp-tab-host">${escapeHtml(t.host)}${t.active ? ' · 보고 있는 탭' : ''}</span></span></label></li>`).join('');
    return '<div class="wp-head">'
      + `<label class="wp-all"><input type="checkbox" data-pick="all"${on(n === st.tabs.length)} />전체 <small>${st.tabs.length}개</small></label>`
      + '<span class="wp-hint">캡처할 웹페이지를 고르세요</span></div>'
      + `<ul class="wp-list">${rows}</ul>`
      + `<div class="wp-go"><button type="button" class="primary small" data-pick="go"${!n || busy ? ' disabled' : ''}>${goText(n)}</button>`
      + '<button type="button" class="ghost small" data-pick="close">닫기</button></div>';
  }

  /** 그 곳에 펴 둔 목록(칸째) — 다시 그리는 화면(출장 카드)이 제자리에 넣는다. 펴 있지 않으면 ''. 그린 뒤 sync 로 반쯤 표시를 맞춘다. */
  const html = (key, opts = {}) => (isOpen(key) ? `<div class="wp-tabs" role="group" aria-label="캡처할 웹페이지"${opts.busy ? ' data-busy="1"' : ''}>${inner(opts)}</div>` : '');

  /**
   * 고른 상태를 체크박스·전체(일부만 골랐으면 반쯤 — 이것은 글로 그릴 수 없다)·캡처 단추에 맞춘다. root 는 목록이거나 그것을 품은 곳이다.
   * busy 를 주지 않으면 그릴 때의 것(html 의 data-busy)을 따른다.
   */
  function sync(at, { busy } = {}) {
    const root = !st.tabs || !at ? null : at.matches('.wp-tabs') ? at : at.querySelector('.wp-tabs') || at.closest('.wp-tabs');
    if (!root) return;
    busy ??= root.dataset.busy === '1';
    for (const box of root.querySelectorAll('input[data-tab]')) box.checked = st.pick.has(Number(box.dataset.tab));
    const n = st.pick.size;
    const all = root.querySelector('input[data-pick="all"]');
    if (all) {
      all.checked = n === st.tabs.length;
      all.indeterminate = n > 0 && n < st.tabs.length;
    }
    const go = root.querySelector('button[data-pick="go"]');
    if (go) {
      go.disabled = !n || busy;
      go.textContent = goText(n);
    }
  }

  /** 체크박스를 눌렀을 때 — 고른 것을 고치고 맞춘다. 목록의 체크박스가 아니면 false. */
  function change(e, opts) {
    const box = e.target instanceof Element ? e.target.closest('input[data-tab], input[data-pick="all"]') : null;
    if (!box || !st.tabs) return false;
    if (box.dataset.pick === 'all') st.pick = new Set(box.checked ? st.tabs.map((t) => t.id) : []);
    else if (box.checked) st.pick.add(Number(box.dataset.tab));
    else st.pick.delete(Number(box.dataset.tab));
    sync(box, opts);
    return true;
  }

  /**
   * 목록의 단추를 눌렀을 때. 닫기는 접고 {act: 'close'}, 캡처는 접고 {act: 'go', tabs}(고른 차례가 아니라 탭 차례)를 돌려준다 —
   * 찍는 것은 부른 곳이 한다(shoot). key 는 목록을 펴 두었던 곳이다. 단추를 연 곳(data-pick="open")이면 {act: 'open'}. 목록의 단추가 아니면 null.
   */
  function click(e) {
    const btn = e.target instanceof Element ? e.target.closest('button[data-pick]') : null;
    if (!btn) return null;
    const act = btn.dataset.pick;
    if (act === 'open') return { act };
    if (!st.tabs) return { act: 'none' };
    const { key } = st;
    if (act === 'close') {
      close();
      return { act, key };
    }
    if (act === 'go') {
      const tabs = st.tabs.filter((t) => st.pick.has(t.id));
      if (!tabs.length) return { act: 'none' };
      close();
      return { act, tabs, key };
    }
    return { act: 'none' };
  }

  /**
   * 고른 탭들을 찍는다 — 진행은 onStatus 로 알린다(몇 번째 페이지 · 몇 번째 화면). 빈 페이지는 빼고, 너무 길어 앞부분만 찍은 페이지와
   * 못 찍은 탭은 notes 로, 기록에 남길 한 줄은 what 으로 준다. 하나도 못 찍었으면 던진다.
   * @returns {Promise<{pages: object[], failed: object[], notes: string[], what: string}>} pages 는 src/pagecap.js 의 capturePage 결과
   */
  async function shoot(tabs, { today = '', onStatus = () => {} } = {}) {
    onStatus(tabs.length > 1 ? `웹페이지 ${tabs.length}개를 캡처하는 중입니다…` : '웹페이지를 캡처하는 중입니다…');
    const got = await capture(tabs, {
      today,
      onProgress: (done, total, nth, of) => onStatus(`웹페이지를 캡처하는 중입니다…${of > 1 ? ` ${nth}/${of}번째 페이지` : ''} ${done}/${total}`),
    });
    const what = got.pages.map((p) => `${p.host} 화면 ${p.shots}개 → ${p.tiles}장${p.cut ? '(너무 길어 앞부분만)' : ''}`).join(', ')
      + (got.failed.length ? ` · 못 찍음 ${got.failed.length}개` : '');
    const pages = got.pages.filter((p) => p.files.length || p.text);
    if (!pages.length) throw new Error('캡처한 화면이 비어 있습니다.');
    const many = pages.length > 1;
    const notes = [
      ...pages.filter((p) => p.cut).map((p) => `${many ? `${p.host} — ` : ''}페이지가 너무 길어 앞부분(화면 ${MAX_SHOTS}개)만 캡처했습니다`),
      ...got.failed.map((f) => `찍지 못한 페이지 — ${f.title}: ${f.why}`),
    ];
    return { pages, failed: got.failed, notes, what };
  }

  return { isOpen, toggle, close, inner, html, sync, change, click, shoot, state: st };
}

/** 단추 — 다시 그리는 화면(출장 카드)이 목록 위에 세운다. 펴 있으면 aria-expanded 가 true 다. */
export const pickButton = ({ open = false, disabled = false, title = '' } = {}, escapeHtml = (s) => s) => `<button type="button" class="ghost small wp-open" data-pick="open" aria-expanded="${open}"`
  + `${title ? ` title="${escapeHtml(title)}"` : ''}${disabled ? ' disabled' : ''}>${PICK_ICON}${PICK_LABEL}</button>`;

/** 페이지 PDF 의 이름 — 화면캡처_agoda.com_2026-10-08.pdf, 같은 사이트의 둘째부터 _2 를 붙인다. */
export const pageName = (host, today, n = 1) => `화면캡처_${String(host).replace(/[\\/:*?"<>|\s]+/g, '')}${today ? `_${today}` : ''}${n > 1 ? `_${n}` : ''}.pdf`;

/** 장 하나를 JPEG 로 — 그릴 길이 없거나(테스트) 줄지 않으면 그대로 둔다. */
async function toJpeg(file) {
  if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') return file;
  try {
    const bm = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bm.width, bm.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, bm.width, bm.height);
    ctx.drawImage(bm, 0, 0);
    bm.close?.();
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    return out.size && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

/**
 * 찍은 페이지마다 그 장들을 PDF 하나로 묶는다 — 출장 증빙은 페이지 하나가 증빙 하나다(예약 확인 화면이 A4 석 장이어도). 장은 JPEG 로
 * 줄여 묶는다(증빙은 보관함에 남고 송부 PDF 에도 들어간다). 화면 글자(text)는 그 PDF 를 읽을 때 같이 준다.
 * taken 은 이미 쓰는 이름(보관함의 증빙) — 보관함의 열쇠가 이름이라, 같은 날 같은 사이트를 또 찍으면 _2 … 로 비켜 앞의 것을 덮지 않는다.
 * @returns {Promise<{file: File, text: string, host: string, pages: number}[]>}
 */
export async function pagePdfs(pages, { today = '', taken = [], build = buildPdf, shrink = toJpeg } = {}) {
  const used = new Set(taken);
  const out = [];
  for (const p of pages) {
    if (!p.files.length) continue;
    const parts = [];
    for (const f of p.files) {
      const small = await shrink(f);
      parts.push({ name: f.name, bytes: new Uint8Array(await small.arrayBuffer()) });
    }
    const pdf = await build(parts, { title: p.title || p.host });
    let n = 1;
    while (used.has(pageName(p.host, today, n))) n++;
    used.add(pageName(p.host, today, n));
    const file = new File([pdf.bytes], pageName(p.host, today, n), { type: 'application/pdf' });
    out.push({ file, text: p.text || '', host: p.host, pages: pdf.pages });
  }
  return out;
}
