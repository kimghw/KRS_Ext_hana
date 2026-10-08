// 이 창에 열어 둔 웹페이지(탭)를 위에서 아래까지 통째로 캡처한다 — 공문 탭의 "웹페이지 골라 통째로 캡처해 읽기"(2026-10-08 사용자 지정).
// 찍을 탭은 패널에서 전체 또는 하나 이상 골라 준다(webTabs) — 활성 탭만 찍으면 옆에 띄워 둔 메일함이 찍힌다(2026-10-08 사용자 지정).
//
// chrome.tabs.captureVisibleTab 은 보이는 만큼만 찍는다. 그래서 탭 안에서 한 화면씩 내려가며 찍고(초당 두 장 제한 — SHOT_GAP_MS), 찍은 것을
// 한 장으로 이어 A4 비율(가로 : 세로 = 210 : 297)로 자른다 — 그 장들이 공문 읽기(src/llm.js 의 gongmunSmart)에 가고, 그대로 첨부 PDF
// (src/pdf.js 의 buildPdf — 한 장에 한 쪽)가 된다. 같이 그 화면의 글자(innerText)도 가져온다 — 화면의 글자는 OCR 보다 정확하다.
// 로컬 CLI 다리는 그림을 OCR 한 글자를 그림과 같이 보낸다(native/host.mjs → native/doctext.mjs).
//
// 여기는 두 층이다. capturePage(탭 하나)·captureMany(고른 탭들을 차례로 앞에 두고 찍기)는 찍는 차례(탭에서 돌릴 함수·찍기·잇기·탭 바꾸기를
// 밖에서 받는다 — 테스트가 갈아 끼운다)이고, webTabs·captureTabs 가 chrome API 를 그 자리에 꽂는다. pageInfo·pageStep·pageDone 은 chrome.scripting 이 **글자 그대로** 탭에 옮겨 돌리는
// 함수다 — 바깥 변수를 쓰면 안 된다.

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

/** data URL 의 바이트. fetch 를 쓰지 않는다 — 패널의 fetch 는 사이트 요청용이다. */
function blobOf(dataUrl) {
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
 * @param {{shots: {dataUrl: string, y: number, h: number}[], viewportWidth: number, totalHeight: number, tileHeight: number}} job y·h 는 CSS px
 * @returns {Promise<Blob[]>} PNG 장들
 */
export async function stitchTiles({ shots, viewportWidth, totalHeight, tileHeight }, { bitmapOf = (d) => createImageBitmap(blobOf(d)) } = {}) {
  if (!shots?.length) throw new Error('찍은 화면이 없습니다.');
  if (typeof OffscreenCanvas !== 'function') throw new Error('이 브라우저에서는 캡처를 이을 수 없습니다.');
  const first = await bitmapOf(shots[0].dataUrl);
  const scale = first.width / Math.max(1, viewportWidth);
  first.close?.();
  const k = Math.min(scale, MAX_SCALE);
  const width = Math.round(viewportWidth * k);
  const out = [];
  for (const r of tileRanges(totalHeight, tileHeight)) {
    const canvas = new OffscreenCanvas(width, Math.max(1, Math.round(r.h * k)));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const s of shots) {
      if (s.y + s.h <= r.y || s.y >= r.y + r.h) continue;
      const bm = await bitmapOf(s.dataUrl);
      ctx.drawImage(bm, 0, Math.round((s.y - r.y) * k), Math.round((bm.width * k) / scale), Math.round((bm.height * k) / scale));
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

/**
 * 이 창에 열어 둔 웹페이지 탭들 — 패널이 찍을 것을 고르게 늘어놓는다. 브라우저 안쪽 화면·파일은 찍지 못하니 뺀다.
 * 주소·제목은 tabs 권한으로 보인다(사이트 접근 권한은 찍을 때 묻는다).
 * @returns {Promise<{id: number, url: string, title: string, host: string, active: boolean}[]>} 탭 차례대로
 */
export async function webTabs() {
  needApi();
  const win = await chrome.windows.getCurrent();
  const all = await chrome.tabs.query({ windowId: win.id });
  return all.filter((t) => capturable(t.url).ok)
    .map((t) => ({ id: t.id, url: t.url, title: String(t.title || '').trim() || hostOf(t.url), host: hostOf(t.url), active: !!t.active }));
}

/** 탭을 앞에 두고 다 읽힐 때까지 기다린다 — 잠든 탭은 앞에 두면 다시 읽는다. 그려질 틈은 찍기 전의 SHOT_GAP_MS 가 준다. */
async function bringUp(tabId) {
  const gone = () => new Error('탭이 닫혔습니다 — 목록을 다시 열어 고르세요.');
  await chrome.tabs.update(tabId, { active: true }).catch(() => { throw gone(); });
  for (let t = 0; t < READY_MS; t += 200) {
    const now = await chrome.tabs.get(tabId).catch(() => null);
    if (!now) throw gone();
    if (now.active && now.status === 'complete') return;
    await sleep(200);
  }
}

/**
 * 고른 탭들을 통째로 찍는다 — 패널의 "캡처해 읽기" 단추가 부른다. 권한은 사용자 동작(단추 누름) 안에서 먼저 묻는다.
 * 찍는 동안 고른 탭이 차례로 앞에 나왔다가, 끝나면 누르기 전에 보던 탭으로 돌아온다.
 * @param {{id: number, url: string, title?: string}[]} tabs webTabs 에서 고른 것
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
