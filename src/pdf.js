// 증빙 여러 장(그림·PDF)을 PDF 하나로 묶는다 — 담당자에게 보낼 때 붙이는 파일이다(2026-10-03 사용자 지정).
// 맨 앞에는 확정한 여비계산서의 출력(PDF, src/calpdf.js)이 온다(2026-10-04 사용자 지정) — 그것은 sendbox.js 가 받아 첫 파일로 넘긴다.
//
//   그림(JPEG·PNG) → 한 장에 한 쪽(A4, 넓은 그림은 가로). 휴대폰 사진의 돌려 찍은 표시(EXIF)는 바로 세워 넣는다.
//   PDF            → 그 쪽들을 그대로 옮겨 붙인다. 암호가 걸린 PDF 는 옮길 수 없어 던진다.
//   그 밖의 그림    → 브라우저가 풀 수 있으면(WebP·GIF·BMP) PNG 로 바꿔 넣는다. 못 풀면 던진다.
//
// 무엇인지는 이름·형식이 아니라 **파일 앞머리**로 가린다 — 캡처를 .jpg 로 저장한 PNG 가 흔하다.
// 글자는 그리지 않는다(pdf-lib 의 기본 글꼴에는 한글이 없다). 묶는 일은 vendor/pdf-lib 이 한다.

import { PDFDocument, degrees } from '../vendor/pdf-lib.esm.min.js';

/** A4(pt)와 가장자리 여백. */
const A4 = [595.28, 841.89];
const MARGIN = 28;

/** data URL 을 바이트로. */
export function bytesOf(dataUrl) {
  const bin = atob(String(dataUrl || '').split(',')[1] || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 파일 앞머리로 가린 종류 — 'pdf' | 'jpg' | 'png' | ''(그 밖). */
export function sniff(bytes) {
  const at = (i) => bytes[i];
  if (at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46) return 'pdf';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpg';
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png';
  return '';
}

/**
 * JPEG 의 돌려 찍은 표시(EXIF Orientation, 1~8). 없거나 못 읽으면 1(그대로)이다.
 * 3 은 뒤집힌 것, 6 은 시계 방향으로 90° 돌려야 서는 것, 8 은 반시계 방향으로 90° 돌려야 서는 것이다.
 */
export function exifOrientation(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  while (at + 4 <= view.byteLength && view.getUint8(at) === 0xff) {
    const marker = view.getUint8(at + 1);
    const size = view.getUint16(at + 2);
    if (marker === 0xe1 && at + 10 <= view.byteLength && view.getUint32(at + 4) === 0x45786966) {   // "Exif"
      const tiff = at + 10;
      if (tiff + 8 > view.byteLength) return 1;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > view.byteLength) return 1;
      const count = view.getUint16(ifd, little);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > view.byteLength) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const v = view.getUint16(entry + 8, little);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    if (marker === 0xda || size < 2) break;   // 그림 본문이 시작됐다
    at += 2 + size;
  }
  return 1;
}

/** 브라우저가 풀 수 있는 그림을 PNG 바이트로 바꾼다(WebP·GIF·BMP). 풀 수단이 없는 환경이면 null. */
async function browserToPng(file, bytes) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  const bitmap = await createImageBitmap(new Blob([bytes], { type: file.type || 'application/octet-stream' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

/** 그림 한 장을 한 쪽에 앉힌다 — 여백 안에 맞추되 키우지는 않는다. turn 은 바로 세우려고 시계 방향으로 돌릴 각도(0·90·180·270)다. */
function drawImagePage(out, image, turn) {
  const side = turn === 90 || turn === 270;
  const [w, h] = side ? [image.height, image.width] : [image.width, image.height];   // 바로 선 뒤의 크기
  const [pw, ph] = w > h ? [A4[1], A4[0]] : A4;
  const scale = Math.min((pw - MARGIN * 2) / w, (ph - MARGIN * 2) / h, 1);
  const dw = w * scale;
  const dh = h * scale;
  const x = (pw - dw) / 2;
  const y = (ph - dh) / 2;
  const page = out.addPage([pw, ph]);
  // pdf-lib 은 그림의 왼쪽 아래 구석을 축으로 반시계 방향으로 돌린다. 돌린 뒤에 (x, y)~(x+dw, y+dh) 에 놓이게 축을 옮긴다.
  if (turn === 90) page.drawImage(image, { x, y: y + dh, width: dh, height: dw, rotate: degrees(-90) });
  else if (turn === 180) page.drawImage(image, { x: x + dw, y: y + dh, width: dw, height: dh, rotate: degrees(180) });
  else if (turn === 270) page.drawImage(image, { x: x + dw, y, width: dh, height: dw, rotate: degrees(90) });
  else page.drawImage(image, { x, y, width: dw, height: dh });
}

const TURN_OF = { 3: 180, 4: 180, 5: 90, 6: 90, 7: 270, 8: 270 };

/**
 * 증빙들을 차례대로 PDF 하나로 묶는다.
 * @param {{name:string, type?:string, dataUrl?:string, bytes?:Uint8Array}[]} files 보관함(src/evidence.js)에서 꺼낸 것 그대로.
 *   바이트를 이미 가진 것(사이트에서 받은 여비계산서 PDF)은 dataUrl 대신 bytes 로 준다
 * @param {{title?:string, toPng?:Function}} [opts] title 은 문서 제목, toPng 는 그 밖의 그림을 PNG 바이트로 바꾸는 길(테스트가 갈아 끼운다)
 * @returns {Promise<{bytes: Uint8Array, pages: number, parts: {name:string, pages:number}[]}>} parts 는 파일마다 몇 쪽이 들어갔는가
 */
export async function buildPdf(files, { title = '', toPng = browserToPng } = {}) {
  if (!files?.length) throw new Error('묶을 증빙이 없습니다.');
  const out = await PDFDocument.create();
  if (title) out.setTitle(title);
  const parts = [];
  for (const f of files) {
    const bytes = f.bytes || bytesOf(f.dataUrl);
    const kind = sniff(bytes);
    const before = out.getPageCount();
    if (kind === 'pdf') {
      let pages;
      try {
        // 깨진 파일은 여는 데서가 아니라 쪽을 셀 때 걸리기도 한다 — 옮겨 오는 데까지를 한데 본다.
        const src = await PDFDocument.load(bytes);
        pages = await out.copyPages(src, src.getPageIndices());
      } catch (err) {
        throw new Error(/encrypted/i.test(err.message)
          ? `${f.name}: 암호가 걸린 PDF 라 묶지 못했습니다 — 인쇄(PDF 로 저장)한 것을 다시 넣어 주세요`
          : `${f.name}: PDF 를 읽지 못했습니다`);
      }
      for (const page of pages) out.addPage(page);
    } else if (kind === 'jpg') {
      drawImagePage(out, await out.embedJpg(bytes), TURN_OF[exifOrientation(bytes)] || 0);
    } else {
      const png = kind === 'png' ? bytes : await Promise.resolve(toPng(f, bytes)).catch(() => null);
      if (!png) throw new Error(`${f.name}: 이 형식은 PDF 로 바꾸지 못했습니다 — JPG·PNG·PDF 로 넣어 주세요`);
      drawImagePage(out, await out.embedPng(png), 0);
    }
    parts.push({ name: f.name, pages: out.getPageCount() - before });
  }
  return { bytes: await out.save(), pages: out.getPageCount(), parts };
}
