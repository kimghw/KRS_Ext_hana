// 웹페이지 캡처 단추 둘 — 공문 탭의 문서 넣는 곳(gongmunpanel.js)과 출장 카드의 증빙 넣는 곳(attendpanel.js — 사후정산 칸·여비증빙 송부 칸)이
// **같은 단추**를 쓴다(2026-10-08 사용자 지정: "여기도 웹페이지 카피 공문처럼 하게해줘.. 2개 동일한 기능으로"). 찍는 일은 src/pagecap.js 다.
//
//   [전체]  보고 있는 탭을 위에서 아래까지 통째로 → 찍은 장·화면 글자 → 그 곳의 읽기
//   [부분]  페이지 위에서 프레임(틀·상자)을 눌러 하나 이상 고르고 위쪽 띠의 캡처 → 고른 것만 찍은 장·글자 → 그 곳의 읽기
//
// 2026-10-08 사용자 지정: "탭이 아니라 프레임으로 선택할 수 있지 않냐? … 현재 보고 있는 탭 아이콘 하나.. 그리고 부분적으로 선택할 수 있는
// 버튼 하나" — 그 전에는 이 창의 탭 목록을 펴서 골랐다. 고르는 동안에는 부분 단추가 "고르기 취소"가 되고 탭 단추는 잠긴다.
// 단추 글자는 "전체 · 부분" 이다(같은 날 사용자 지정: "전체, 부분 이라고 써줘,, 전체는 글자가 안보이잖아" — 그 전에는 보고 있는 탭이 아이콘만이었다).
// 한 번에 한 곳에서만 고른다(key — 공문 탭은 'gongmun', 출장 카드는 신청서 번호와 칸). 누름은 data-pick 으로 가린다(그 패널의 data-act 와 겹치지 않게).
//
// 찍은 장을 무엇으로 쓰는지는 곳마다 다르다 — 공문은 장들을 그대로 읽고 문서마다 첨부 PDF 로 묶는다. 출장 증빙은 페이지(고른 부분) 하나를
// PDF 하나로 묶어 증빙 한 장으로 읽는다(pagePdfs — 예약 확인 화면이 A4 석 장이어도 증빙은 하나다).

import { captureFront, startPick, captureTabParts, MAX_SHOTS } from './src/pagecap.js';
import { buildPdf } from './src/pdf.js';

export const TAB_LABEL = '전체';
export const PART_LABEL = '부분';
export const PART_STOP = '고르기 취소';
/** 보고 있는 탭 — 브라우저 창(위에 탭 점 둘). */
export const TAB_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01"/></svg>';
/** 부분 고르기 — 고르는 칸의 네 귀와 그 안의 상자. */
export const PART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>';
const TAB_TITLE = `전체 캡처 — 이 창에서 보고 있는 웹페이지를 위에서 아래까지 캡처하고 화면의 글자와 함께 읽습니다. 처음 한 번 사이트 접근 권한을 묻습니다.`;
const PART_TITLE = '부분 캡처 — 보고 있는 웹페이지 위에서 캡처할 부분(틀·상자 같은 프레임)을 눌러 하나 이상 고르고, 페이지 위쪽 띠의 캡처를 누르면 고른 것만 캡처해 읽습니다. '
  + '틀 안이 따로 내려가는 화면(eClass 본문 등)은 틀 안을 끝까지 찍습니다.';
const PICK_HINT = '웹페이지에서 캡처할 부분(프레임)을 누르세요 — 여러 개 고를 수 있고, ↑ 는 더 큰 칸입니다. 다 고르면 페이지 위쪽 띠의 캡처를 누릅니다.';
/** 출장 증빙으로 묶는 장의 JPEG 품질 — PNG 그대로면 그림이 많은 예약 화면 한 페이지가 10MB 를 넘는다. */
const JPEG_QUALITY = 0.85;

/**
 * @param {{front?: Function, start?: Function, parts?: Function}} [deps] front 는 보고 있는 탭을 통째로 찍는 길, start 는 페이지 위의 고르기를
 *   여는 길({tab, done, cancel}), parts 는 고른 부분들을 찍는 길이다(src/pagecap.js — 테스트가 갈아 끼운다)
 */
export function createWebPick({ front = captureFront, start = startPick, parts = captureTabParts } = {}) {
  // 고르는 중이면 그 곳(key)과 페이지의 고르기(handle), 패널에서 그만두는 길(quit).
  const st = { key: null, handle: null, quit: null };
  /** 그 곳에서(key 를 주지 않으면 어디서든) 고르는 중인가. */
  const picking = (key) => !!st.handle && (key == null || st.key === key);

  /** 고르기를 그만둔다 — 페이지의 막을 걷고, 기다리던 shoot 를 풀어 준다(why: 'stop' 이면 그만뒀다고 알리고, 'switch' 면 조용히). */
  function stop(why = 'stop') {
    if (!st.handle) return;
    const { handle, quit } = st;
    Object.assign(st, { key: null, handle: null, quit: null });
    handle.cancel();
    quit(why);
  }

  /** 단추를 눌렀을 때 — {act: 'tab'|'part'}. 이 단추가 아니면 null. 찍는 것은 부른 곳이 shoot 로 한다. */
  function click(e) {
    const btn = e.target instanceof Element ? e.target.closest('button[data-pick]') : null;
    return btn && !btn.disabled ? { act: btn.dataset.pick } : null;
  }

  /**
   * 찍는다. tab 은 보고 있는 탭을 통째로, part 는 페이지 위에서 고르게 한 뒤 고른 부분들을 찍는다 — 그 곳에서 고르는 중에 part 를 다시
   * 누르면 고르기를 그만두고 null 이다. 페이지에서 취소해도 null 이다. 진행은 onStatus 로 알리고(고르기를 시작·마칠 때도 — 부른 곳이
   * 단추를 다시 그린다), 정말 찍기 시작할 때 onStart 를 부른다(부른 곳이 잠근다). 빈 것은 빼고, 너무 길어 앞부분만 찍은 것과 못 찍은 것은
   * notes 로, 기록에 남길 한 줄은 what 으로 준다. 하나도 못 찍었으면 던진다.
   * @returns {Promise<{pages: object[], failed: object[], notes: string[], what: string}|null>} pages 는 src/pagecap.js 의 capturePage·capturePart 결과
   */
  async function shoot(act, { key = '', today = '', onStatus = () => {}, onStart = () => {} } = {}) {
    if (st.handle) {
      const again = act === 'part' && st.key === key;
      stop(again ? 'stop' : 'switch');
      if (again) return null;
    }
    let got;
    if (act === 'tab') {
      onStart();
      onStatus('보고 있는 탭을 캡처하는 중입니다…');
      got = await front({ today, onProgress: (done, total) => onStatus(`보고 있는 탭을 캡처하는 중입니다… ${done}/${total}`) });
    } else if (act === 'part') {
      const handle = await start();
      const stopped = new Promise((resolve) => { st.quit = (why) => resolve({ why }); });
      Object.assign(st, { key, handle });
      onStatus(PICK_HINT);
      let chosen;
      try {
        chosen = await Promise.race([handle.done, stopped]);
      } finally {
        if (st.handle === handle) Object.assign(st, { key: null, handle: null, quit: null });
      }
      if (!Array.isArray(chosen) || !chosen.length) {
        if (chosen?.why !== 'switch') onStatus('부분 고르기를 그만뒀습니다.');
        return null;
      }
      onStart();
      onStatus(`고른 ${chosen.length}개를 캡처하는 중입니다…`);
      got = await parts(handle.tab, chosen, {
        today,
        onProgress: (done, total, nth, of) => onStatus(`고른 부분을 캡처하는 중입니다…${of > 1 ? ` ${nth}/${of}번째` : ''} ${done}/${total}`),
      });
    } else {
      return null;
    }
    const what = got.pages.map((p) => `${p.part ? `부분 ${p.part} ` : ''}${p.host} 화면 ${p.shots}개 → ${p.tiles}장${p.cut ? '(너무 길어 앞부분만)' : ''}`).join(', ')
      + (got.failed.length ? ` · 못 찍음 ${got.failed.length}개` : '');
    const pages = got.pages.filter((p) => p.files.length || p.text);
    if (!pages.length) throw new Error('캡처한 화면이 비어 있습니다.');
    const many = pages.length > 1;
    const notes = [
      ...pages.filter((p) => p.cut).map((p) => `${many ? `${p.title || p.host} — ` : ''}${p.part ? '고른 부분이' : '페이지가'} 너무 길어 앞부분(화면 ${MAX_SHOTS}개)만 캡처했습니다`),
      ...got.failed.map((f) => `찍지 못한 ${act === 'part' ? '부분' : '페이지'} — ${f.title}: ${f.why}`),
    ];
    return { pages, failed: got.failed, notes, what };
  }

  return { picking, stop, click, shoot, state: st };
}

/**
 * 단추 둘 — 전체(보고 있는 탭 통째로)와 부분(골라 캡처). 그 곳에서 고르는 중(picking)이면 부분 단추가 "고르기 취소"가 되고(누르면 그만둔다)
 * 탭 단추는 잠긴다. disabled 는 둘 다 잠그되, 고르는 중의 취소는 남긴다.
 */
export const pickButton = ({ picking = false, disabled = false } = {}) => '<span class="wp-btns">'
  + `<button type="button" class="ghost small wp-open wp-front" data-pick="tab" title="${TAB_TITLE}"${disabled || picking ? ' disabled' : ''}>${TAB_ICON}${TAB_LABEL}</button>`
  + `<button type="button" class="ghost small wp-open wp-part${picking ? ' on' : ''}" data-pick="part" aria-pressed="${picking}" `
  + `title="${picking ? '페이지 위의 고르기를 그만둡니다' : PART_TITLE}"${disabled && !picking ? ' disabled' : ''}>${PART_ICON}${picking ? PART_STOP : PART_LABEL}</button></span>`;

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
