// 구매 공문의 견적서 오리기(2026-10-08 사용자 지정: "구매 공문 작성시 데이터를 넣어주면 견적서 부분을 추출할 수 있어야해. 가격부분과 주변 내용을
// 캡쳐 하면 될거 같은데"). 쇼핑몰 상품·장바구니·주문 화면은 견적서 양식이 아니다 — 화면을 통째로(웹페이지 캡처면 A4 여러 장) 붙이지 않고,
// 가격과 그 둘레(상품명·옵션·수량·배송비·합계·판매자)만 오려 견적서 한 장으로 첨부한다.
//
// 어디를 오릴지는 읽기가 정한다(input.yaml gongmun 의 quoteArea — 그림마다 % 칸). 여기는 그 칸을 고르고(cutBoxes), 넉넉히 넓혀 픽셀 자리로
// 바꾸고(cutPlan), 그림에서 오려 위아래로 잇는다(cutQuote). 오려 낸 화면(같은 묶음의 장들)은 첨부에서 빠지되, 강의 소개·커리큘럼 장은 강의 내용으로
// 남는다(cutDrop → src/gongmun.js 의 attachWithCut).
// 교육도 같다(2026-10-08 사용자 지정: "교육은 첨부로 '견적서' 그리고 '교육내용'") — 온라인 강의 페이지 캡처에서 수강료 칸을 오려 교육 견적서로,
// 강의 소개·커리큘럼 장은 교육 내용으로 첨부한다.
// 화면(gongmunpanel.js)은 오린 그림을 보여 주고, 가격이 잘렸으면 "더 넓게"(PAD_STEP), 오린 것이 마땅치 않으면 "원래 장으로" 되돌린다.

import { blobOf } from './pagecap.js';

/** 칸 둘레에 더 넣는 몫 — 그림의 짧은 변에 대한 비. 읽기가 잡은 칸이 가격 글자에 바짝 붙어도 잘리지 않게. */
export const CUT_PAD = 0.03;
/** "더 넓게" 를 한 번 누를 때 더하는 몫과 그 한도. */
export const PAD_STEP = 0.05;
export const MAX_PAD = 0.25;
/** 칸으로 볼 가장 작은 폭·높이(%) — 그보다 작으면 잘못 잡은 것이다. */
const MIN_SIDE = 2;
/** 견적서·거래명세서 양식으로 가린 문서는 통째로 견적서다 — 오리지 않는다. */
const FORMAL = new Set(['quote', 'statement']);
/**
 * 강의 소개·커리큘럼 — 오려 낸 화면 묶음에 있어도 첨부에 남긴다(cutDrop). 교육이면 금액 칸(주문·결제 화면)이 아닌 장은 모두 교육 내용으로
 * 남는다(src/gongmun.js 의 PART_LABEL.edu).
 */
const KEEP = { purchase: new Set(['course', 'content']), edu: new Set(['course', 'content', 'event', 'other']) };

/**
 * 읽기가 준 칸 가운데 오릴 수 있는 것 — 넣은 그림(PDF 는 오리지 못한다)에 있고, 견적서 양식으로 가린 파일이 아니며, 왼쪽<오른쪽·위<아래로
 * 너무 작지 않은 것. 넣은 차례(웹페이지 캡처면 위에서 아래)로 줄 세운다. 칸을 0~1 의 비로 적어 왔으면 % 로 고친다.
 * @param {{file:string, left:number, top:number, right:number, bottom:number}[]|null} area 읽기의 답(quoteArea)
 * @param {{name:string, type:string}[]} files 넣은 차례의 파일
 * @param {{file:string, kind:string}[]} [parts] 읽기가 가린 파일마다의 문서 종류
 * @returns {{file:string, left:number, top:number, right:number, bottom:number}[]}
 */
export function cutBoxes(area, files = [], parts = []) {
  const order = new Map((files || []).map((f, i) => [f.name, i]));
  const out = [];
  for (const b of Array.isArray(area) ? area : []) {
    const f = (files || []).find((x) => x.name === b?.file);
    if (!f || !/^image\//.test(f.type || '')) continue;
    if (FORMAL.has((parts || []).find((p) => p?.file === f.name)?.kind)) continue;
    let side = [b.left, b.top, b.right, b.bottom].map(Number);
    if (!side.every(Number.isFinite)) continue;
    if (Math.max(...side) <= 1) side = side.map((v) => v * 100);
    const [left, top, right, bottom] = side.map((v) => Math.min(100, Math.max(0, v)));
    if (right - left < MIN_SIDE || bottom - top < MIN_SIDE) continue;
    out.push({ file: f.name, left, top, right, bottom });
  }
  return out.sort((a, b) => order.get(a.file) - order.get(b.file) || a.top - b.top);
}

/**
 * 오릴 자리(픽셀). 칸을 사방으로 pad(그림의 짧은 변에 대한 비)만큼 넓히고 그림 밖은 자른다. 조각은 위아래로 잇는다 — 그림의 폭이 모두 같으면
 * (웹페이지 캡처의 장들) 좌우를 모든 칸을 품는 하나로 맞춘다(두 장에 걸친 칸이 어긋나지 않게).
 * @param {{left:number, top:number, right:number, bottom:number}[]} boxes cutBoxes 가 고른 칸
 * @param {{width:number, height:number}[]} sizes 칸마다 그 그림의 크기
 * @returns {{rects: {x:number, y:number, w:number, h:number}[], width: number, height: number}}
 */
export function cutPlan(boxes, sizes, pad = CUT_PAD) {
  const rects = boxes.map((b, i) => {
    const { width: W, height: H } = sizes[i];
    const p = Math.round(Math.max(0, pad) * Math.min(W, H));
    const x0 = Math.max(0, Math.floor((b.left / 100) * W - p));
    const x1 = Math.min(W, Math.ceil((b.right / 100) * W + p));
    const y0 = Math.max(0, Math.floor((b.top / 100) * H - p));
    const y1 = Math.min(H, Math.ceil((b.bottom / 100) * H + p));
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  });
  if (rects.length > 1 && sizes.every((s) => s.width === sizes[0].width)) {
    const x0 = Math.min(...rects.map((r) => r.x));
    const x1 = Math.max(...rects.map((r) => r.x + r.w));
    for (const r of rects) Object.assign(r, { x: x0, w: x1 - x0 });
  }
  return { rects, width: Math.max(1, ...rects.map((r) => r.w)), height: rects.reduce((a, r) => a + r.h, 0) };
}

/**
 * 견적서를 오린 뒤 첨부에서 뺄 장 — 오린 그림과, 그 그림과 같은 묶음(웹페이지를 통째로 찍은 장들·고른 부분 하나)의 나머지 장.
 * 따로 넣은 그림·PDF 와 다른 묶음은 둔다. 강의(교육 상품)의 소개·커리큘럼으로 가린 장(course·content)은 묶음 안이어도 남긴다 — 오린 견적서와
 * 함께 강의 내용으로 첨부한다(2026-10-08 사용자 지정: "공문에는 견적서 랑,, 강의 내용도 첨부파일로 들어 가야함"). 교육이면 그 밖의 장도 교육 내용으로 남는다.
 * @param {{file:string}[]} boxes
 * @param {{name:string, group?:string}[]} files
 * @param {{file:string, kind:string}[]} [parts] 읽기가 가린 파일마다의 종류(묶음 안에서 이어 받은 것까지 — src/gongmun.js 의 spreadParts)
 * @param {'purchase'|'edu'} [kind] 갈래
 * @returns {string[]} 파일 이름
 */
export function cutDrop(boxes, files = [], parts = [], kind = 'purchase') {
  const from = new Set((boxes || []).map((b) => b.file));
  const groups = new Set((files || []).filter((f) => from.has(f.name) && f.group).map((f) => f.group));
  const keep = KEEP[kind] || KEEP.purchase;
  const lecture = (name) => keep.has((parts || []).find((p) => p?.file === name)?.kind);
  return (files || []).filter((f) => (from.has(f.name) || (f.group && groups.has(f.group))) && !lecture(f.name)).map((f) => f.name);
}

/** 오린 견적서 그림의 이름 — 견적서_가격부분_2026-10-08.png. 넣은 파일과 겹치면 _2 … 를 붙인다. */
export function cutName(today, taken = []) {
  const base = `견적서_가격부분${today ? `_${today}` : ''}.png`;
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = base.replace(/\.png$/, `_${i}.png`);
  return name;
}

/**
 * 칸들을 그림에서 오려 위아래로 이은 PNG 하나(브라우저). 그림은 다 그린 뒤 닫는다.
 * @param {{name:string, dataUrl:string}[]} files 넣은 파일
 * @param {{file:string, left:number, top:number, right:number, bottom:number}[]} boxes cutBoxes 가 고른 칸
 * @param {{pad?: number, bitmapOf?: (file: object) => Promise<ImageBitmap>}} [opts] bitmapOf 는 테스트가 갈아 끼운다
 * @returns {Promise<Blob>}
 */
export async function cutQuote(files, boxes, { pad = CUT_PAD, bitmapOf = (f) => createImageBitmap(blobOf(f.dataUrl)) } = {}) {
  if (!boxes?.length) throw new Error('오릴 칸이 없습니다.');
  if (typeof OffscreenCanvas !== 'function') throw new Error('이 브라우저에서는 그림을 오릴 수 없습니다.');
  const bitmaps = [];
  try {
    for (const b of boxes) {
      const f = (files || []).find((x) => x.name === b.file);
      if (!f) throw new Error(`오릴 그림이 없습니다 — ${b.file}`);
      bitmaps.push(await bitmapOf(f));
    }
    const plan = cutPlan(boxes, bitmaps, pad);
    const canvas = new OffscreenCanvas(plan.width, plan.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, plan.width, plan.height);
    let y = 0;
    for (const [i, r] of plan.rects.entries()) {
      ctx.drawImage(bitmaps[i], r.x, r.y, r.w, r.h, 0, y, r.w, r.h);
      y += r.h;
    }
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    for (const bm of bitmaps) bm.close?.();
  }
}
