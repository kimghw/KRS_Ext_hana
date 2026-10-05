// 출장 증빙에서 글자를 먼저 뽑는다(2026-10-04 사용자 지정) — PDF 는 라이브러리로 글자 층을, 그림은 OCR 로.
// 다리(native/host.mjs)가 receipt 작업의 첨부를 claude 에 넘기기 전에 부른다. 구조화(명세의 키 채우기)는 전처럼 claude 가 한다.
//
//   PDF(글자 층 있음) → pdf.js 로 뽑은 글자만 보낸다. 파일은 붙이지 않는다.
//   PDF(스캔본)       → 쪽을 그림으로 그려 OCR 한 글자를 적고, PDF 도 붙인다.
//   그림              → OCR(Tesseract, 한글+영문)한 글자를 적고, 그림도 붙인다.
//
// 그림을 같이 붙이는 까닭: OCR 은 표 안의 줄을 말없이 빠뜨리고(총액 줄·출발 시각) 흐린 사진에서는 글자가 깨진다. 2026-10-04 에 표본
// 여섯 장으로 잰 것(haiku, 맞은 칸): 그림만 67/84 · OCR 글자만 69/84 · OCR 글자 + 그림 76/84. PDF 는 글자만 주어도 PDF 째 줄 때와
// 같았다(세 장 × 2회 전부 맞음).
//
// 못 뽑으면(꾸러미가 없다·글자가 깨졌다·OCR 을 믿기 어렵다) 전처럼 파일째 읽힌다 — 여기서는 던지지 않고 까닭을 read 에 적는다.
// 꾸러미(pdfjs-dist·tesseract.js·@napi-rs/canvas)는 쓸 때 불러온다 — 증빙이 아닌 작업은 그 값을 치르지 않는다.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { sniff } from '../src/pdf.js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 글자만 보내는 PDF 의 한도 — 이보다 길거나 쪽이 많으면 자르지 않고 전처럼 PDF 째 보낸다. */
export const PDF_TEXT_MAX = 12000;
export const PDF_MAX_PAGES = 6;
/** 글자 층이 있다고 보는 가장 적은 글자 수(공백 빼고) — 스캔본은 0 이거나 쪽 번호쯤만 나온다. */
const PDF_MIN_CHARS = 40;
/** OCR 글자를 적어 줄 만하다고 보는 믿음(Tesseract 가 매긴 0~100)과 글자 수. 흐린 사진을 그대로 읽히면 30 대가 나온다. */
export const OCR_MIN_CONF = 45;
const OCR_MIN_CHARS = 20;
const OCR_TEXT_MAX = 6000;
/** 스캔한 PDF 에서 OCR 할 쪽 수와, 그 쪽을 그릴 때 긴 변의 픽셀. */
const SCAN_PAGES = 3;
const SCAN_SIDE = 2200;
/** OCR 전체에 주는 시간 — 넘기면 OCR 없이 간다. */
const OCR_LIMIT_MS = 25_000;
const OCR_LANGS = ['kor', 'eng'];
/** Tesseract 의 학습 데이터를 풀어 두는 곳(.gitignore). */
const TESSDATA = path.join(HERE, 'tessdata');

const dense = (text) => String(text || '').replace(/\s/g, '');

/** 뽑은 글자가 읽을 만한가 — 너무 적거나(스캔본), 글꼴의 글자 표가 없어 깨진 것(사설 영역·제어 문자)이 많으면 아니다. */
export function usable(text) {
  const d = dense(text);
  if (d.length < PDF_MIN_CHARS) return false;
  const broken = (d.match(/[\p{Co}\p{Cc}\p{Cn}\u{FFFD}]/gu) || []).length;
  return broken / d.length < 0.1;
}

/** node_modules 의 꾸러미 폴더. pdf.js 는 폴더를 "/" 로 끝나는 경로로 받는다. */
const pkgDir = (name, sub = '') => `${path.join(path.dirname(require.resolve(`${name}/package.json`)), sub).replaceAll(path.sep, '/')}/`;

/** PDF 를 연다(pdf.js). 다 쓰면 close 로 닫는다. */
async function openPdf(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdf.js 는 받은 바이트를 가져가 버린다 — 베낀 것을 준다(스캔본이면 같은 바이트로 한 번 더 연다).
  const task = getDocument({
    data: new Uint8Array(bytes), cMapUrl: pkgDir('pdfjs-dist', 'cmaps'), cMapPacked: true,
    standardFontDataUrl: pkgDir('pdfjs-dist', 'standard_fonts'), verbosity: 0,
  });
  return { doc: await task.promise, close: () => task.destroy().catch(() => {}) };
}

/**
 * PDF 의 글자 층을 쪽마다 뽑는다(pdf.js). 줄 바꿈은 pdf.js 가 가린 것(hasEOL)을 따른다.
 * @returns {Promise<{pages: string[], total: number}>} pages 는 앞에서 PDF_MAX_PAGES 쪽까지, total 은 문서의 쪽 수
 */
export async function pdfText(bytes) {
  const { doc, close } = await openPdf(bytes);
  try {
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, PDF_MAX_PAGES); i++) {
      const { items } = await (await doc.getPage(i)).getTextContent();
      pages.push(items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('').trim());
    }
    return { pages, total: doc.numPages };
  } finally {
    await close();
  }
}

/** 스캔한 PDF 의 앞쪽 몇 장을 PNG 로 그린다 — OCR 에 넘길 그림이다. */
export async function pdfPageImages(bytes) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const { doc, close } = await openPdf(bytes);
  try {
    const out = [];
    for (let i = 1; i <= Math.min(doc.numPages, SCAN_PAGES); i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: SCAN_SIDE / Math.max(base.width, base.height) });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      out.push(canvas.toBuffer('image/png'));
    }
    return out;
  } finally {
    await close();
  }
}

/**
 * OCR 이 읽기 좋게 그림을 다듬는다 — 작은 그림(화면 캡처)은 두 배로 키우고, 큰 사진은 줄이고, 투명한 바탕은 희게 채운다.
 * 2026-10-04 에 본 것: 가로 520 짜리 영수증 캡처는 두 배로 키워야 금액 줄이 읽혔고, 세 배는 도로 나빠졌다.
 * 돌려 찍은 사진(EXIF)은 그림을 푸는 꾸러미(@napi-rs/canvas)가 스스로 바로 세운다 — 여기서 또 돌리지 않는다.
 * 풀 수 없는 그림이면 던진다. 그 꾸러미가 없으면 받은 그대로 돌려준다.
 */
export async function ocrReady(bytes) {
  let canvasLib;
  try {
    canvasLib = await import('@napi-rs/canvas');
  } catch {
    return bytes;
  }
  const img = await canvasLib.loadImage(bytes);
  const long = Math.max(img.width, img.height);
  const scale = long < 1600 ? 2 : long > 3200 ? 3200 / long : 1;
  const canvas = canvasLib.createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer('image/png');
}

/**
 * Tesseract 의 학습 데이터를 캐시 폴더에 풀어 둔다 — npm 꾸러미(@tesseract.js-data/*)에 든 것을 쓴다. 꾸러미가 없으면 던진다:
 * 그대로 두면 tesseract.js 가 CDN 에서 받으려 드는데, 다리는 밖에 나가지 않는다(막힌 망에서는 언제 끝날지도 모른다).
 */
function seedTessdata() {
  for (const lang of OCR_LANGS) {
    const to = path.join(TESSDATA, `${lang}.traineddata`);
    if (fs.existsSync(to)) continue;
    let gz;
    try {
      gz = path.join(path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), '4.0.0_best_int', `${lang}.traineddata.gz`);
    } catch {
      throw new Error(`OCR 학습 데이터(${lang})가 없습니다 — 저장소 폴더에서 npm install 을 해 주세요`);
    }
    fs.mkdirSync(TESSDATA, { recursive: true });
    fs.writeFileSync(to, zlib.gunzipSync(fs.readFileSync(gz)));
  }
}

/** OCR 글자를 다듬는다 — 빈 줄과 길게 늘어진 빈칸(표의 칸 사이)을 줄인다. */
const tidy = (text) => String(text || '').replace(/\n{2,}/g, '\n').replace(/ {3,}/g, '   ').trim();

/**
 * 그림들을 OCR 한다(Tesseract, 한글+영문). 엔진은 한 번 띄워 차례로 읽히고, 끝나면 내린다 — 내리지 않으면 다리 프로세스가 끝나지 않는다.
 * @param {Uint8Array[]} images
 * @returns {Promise<{text: string, confidence: number}[]>}
 */
export async function ocrImages(images) {
  // 풀 수 없는 그림은 엔진을 띄우기 전에 걸러진다(여기서 던진다).
  const ready = [];
  for (const bytes of images) ready.push(Buffer.from(await ocrReady(bytes)));
  const { createWorker } = await import('tesseract.js');
  seedTessdata();
  let worker;
  let timer;
  let gaveUp = false;
  const work = (async () => {
    // errorHandler 를 주지 않으면 tesseract.js 는 엔진이 실패를 알릴 때 약속을 거절하고 나서 **또 던진다**(createWorker.js) — 그 던짐은
    // 여기서 잡히지 않아 다리가 통째로 죽는다(학습 데이터가 깨졌을 때 등). 빈 처리기를 주면 거절만 남아 아래에서 잡히고 파일째 읽힌다.
    worker = await createWorker(OCR_LANGS, 1, { cachePath: TESSDATA, cacheMethod: 'readOnly', errorHandler: () => {} });
    const out = [];
    for (const png of ready) {
      // 시간이 다 돼 이미 OCR 없이 가고 있으면 더 읽지 않는다.
      if (gaveUp) break;
      const { data } = await worker.recognize(png);
      out.push({ text: tidy(data.text), confidence: Math.round(data.confidence) });
    }
    return out;
  })();
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => { gaveUp = true; reject(new Error(`OCR 이 ${OCR_LIMIT_MS / 1000}초 안에 끝나지 않았습니다`)); }, OCR_LIMIT_MS);
    })]);
  } finally {
    clearTimeout(timer);
    if (worker) await worker.terminate().catch(() => {});
    // 엔진이 아직 뜨는 중에 시간이 다 됐으면, 뜬 뒤에 내린다.
    else work.catch(() => {}).then(() => worker?.terminate()).catch(() => {});
  }
}

/** 글자를 싸는 꼬리표가 글자 안에 들어 있으면 뺀다 — 문서의 글이 꼬리표를 닫아 버리지 못하게. */
const boxed = (text) => `<문서 글자>\n${String(text).replace(/<\/?문서 글자>/g, '')}\n</문서 글자>`;

const pdfSection = (name, text) =>
  `문서(파일 이름: ${name})는 첨부하지 않았습니다 — 아래가 그 문서(PDF)에서 뽑은 글자 전부입니다. 이 글자를 읽습니다.\n\n${boxed(text)}`;
const ocrSection = (name, text) =>
  `아래는 첨부한 문서(파일 이름: ${name})의 그림에서 OCR 로 먼저 읽은 글자입니다 — 글자·숫자를 맞춰 볼 때 쓰되, OCR 이 틀리거나 빠뜨린 곳은 그림을 따릅니다.\n\n${boxed(text)}`;

/** 여러 쪽의 글자를 하나로 — 두 쪽 이상이면 쪽 사이에 금을 긋는다. */
const joinPages = (pages) => (pages.length > 1 ? pages.map((p, i) => `— ${i + 1}쪽 —\n${p}`).join('\n\n') : pages[0] || '').trim();

/** OCR 결과(쪽마다)를 하나로 묶고, 적어 줄 만한지 가린다. 믿음은 가장 낮은 쪽의 것이다. */
function ocrVerdict(results) {
  const text = joinPages(results.map((r) => r.text)).slice(0, OCR_TEXT_MAX);
  const confidence = Math.min(...results.map((r) => r.confidence));
  return { text, confidence, chars: dense(text).length, ok: confidence >= OCR_MIN_CONF && dense(text).length >= OCR_MIN_CHARS };
}

/**
 * 첨부마다 글자를 먼저 뽑아 claude 에게 줄 글과 첨부를 다시 짓는다. 던지지 않는다 — 못 뽑은 첨부는 그대로 붙는다.
 * @param {string} input 확장이 보낸 글(출장 정보·파일 이름)
 * @param {{name:string, type:string, dataUrl:string}[]} files
 * @param {{pdf?: Function, ocr?: Function, render?: Function}} [engines] 테스트가 갈아 끼운다
 * @returns {Promise<{input: string, files: object[], read: string[], lean: boolean}>}
 *   files 는 그래도 붙일 첨부, read 는 첨부마다 어떻게 읽었는지(기록에 남긴다), lean 은 첨부 없이 글자만 가는가
 */
export async function withText(input, files, { pdf = pdfText, ocr = ocrImages, render = pdfPageImages } = {}) {
  const sections = [];
  const keep = [];
  const read = [];
  for (const f of files) {
    const bytes = Buffer.from(String(f.dataUrl || '').split(',')[1] || '', 'base64');
    try {
      if (sniff(bytes) === 'pdf') {
        const got = await pdf(bytes);
        const text = joinPages(got.pages);
        if (usable(text)) {
          if (got.total <= PDF_MAX_PAGES && text.length <= PDF_TEXT_MAX) {
            sections.push(pdfSection(f.name, text));
            read.push(`${f.name}: 글자 층 ${dense(text).length}자(${got.total}쪽) — 글자만 보냄`);
          } else {
            keep.push(f);
            read.push(`${f.name}: 글자가 김(${got.total}쪽) — 파일째 보냄`);
          }
          continue;
        }
        const o = ocrVerdict(await ocr(await render(bytes)));
        keep.push(f);
        if (o.ok) sections.push(ocrSection(f.name, o.text));
        read.push(`${f.name}: 글자 층 없음 · OCR ${o.chars}자(믿음 ${o.confidence}) — ${o.ok ? 'OCR 글자와 파일을 같이 보냄' : 'OCR 을 믿기 어려워 파일째 보냄'}`);
        continue;
      }
      const o = ocrVerdict(await ocr([bytes]));
      keep.push(f);
      if (o.ok) sections.push(ocrSection(f.name, o.text));
      read.push(`${f.name}: OCR ${o.chars}자(믿음 ${o.confidence}) — ${o.ok ? 'OCR 글자와 그림을 같이 보냄' : 'OCR 을 믿기 어려워 그림만 보냄'}`);
    } catch (err) {
      keep.push(f);
      read.push(`${f.name}: 글자를 뽑지 못함(${String(err?.message || err).slice(0, 120)}) — 파일째 보냄`);
    }
  }
  return {
    input: sections.length ? `${input}\n\n${sections.join('\n\n')}` : input,
    files: keep, read, lean: !keep.length && sections.length > 0,
  };
}
