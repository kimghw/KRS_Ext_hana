// 증빙을 PDF 하나로 묶기(src/pdf.js) — 그림은 한 장에 한 쪽, PDF 는 쪽을 그대로 옮기고, 돌려 찍은 사진은 바로 세운다.
import assert from 'node:assert/strict';
import { PDFDocument } from '../vendor/pdf-lib.esm.min.js';
import { buildPdf, sniff, exifOrientation, bytesOf } from '../src/pdf.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const url = (bytes, type) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
const file = (name, bytes, type) => ({ name, type, dataUrl: url(bytes, type) });

/** 가로 400 × 세로 100 이라고 적힌 JPEG(머리만 고친 것 — 묶을 때는 크기만 읽는다). orientation 을 주면 EXIF 를 끼운다. */
function wideJpeg(orientation = 0) {
  const src = Buffer.from(JPG, 'base64');
  const sof = src.indexOf(Buffer.from([0xff, 0xc2]));
  src.writeUInt16BE(100, sof + 5);
  src.writeUInt16BE(400, sof + 7);
  if (!orientation) return src;
  const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body]);
  return Buffer.concat([src.subarray(0, 2), app1, src.subarray(2)]);
}

async function twoPagePdf() {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  doc.addPage([500, 200]);
  return doc.save();
}
const sizes = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);

console.log('파일 앞머리로 종류를 가린다');
t('PDF·JPEG·PNG 는 이름이 아니라 앞머리로 안다 — 그 밖은 빈 글', () => {
  assert.deepEqual([sniff(Buffer.from('%PDF-1.7')), sniff(Buffer.from(JPG, 'base64')), sniff(Buffer.from(PNG, 'base64')), sniff(Buffer.from('GIF89a'))], ['pdf', 'jpg', 'png', '']);
  assert.equal(bytesOf(url(Buffer.from('abc'), 'text/plain')).length, 3);
});
t('돌려 찍은 표시(EXIF)를 읽는다 — 없으면 1', () => {
  assert.deepEqual([exifOrientation(wideJpeg()), exifOrientation(wideJpeg(6)), exifOrientation(wideJpeg(3)), exifOrientation(wideJpeg(8))], [1, 6, 3, 8]);
});

console.log('PDF 하나로 묶는다');
await ta('그림은 한 장에 한 쪽, PDF 는 쪽을 그대로 — 넣은 차례대로 묶이고 파일마다 몇 쪽인지 돌려준다', async () => {
  const out = await buildPdf([
    file('영수증.png', Buffer.from(PNG, 'base64'), 'image/png'),
    file('항공권.pdf', await twoPagePdf(), 'application/pdf'),
    file('가로사진.jpg', wideJpeg(), 'image/jpeg'),
  ], { title: '여비계산서 145580 증빙' });
  assert.equal(out.pages, 4);
  assert.deepEqual(out.parts, [{ name: '영수증.png', pages: 1 }, { name: '항공권.pdf', pages: 2 }, { name: '가로사진.jpg', pages: 1 }]);
  assert.deepEqual(await sizes(out.bytes), [[595, 842], [300, 400], [500, 200], [842, 595]], '세로 그림은 A4 세로, 넓은 그림은 A4 가로, PDF 는 제 크기');
  assert.equal(sniff(out.bytes), 'pdf');
  assert.equal((await PDFDocument.load(out.bytes)).getTitle(), '여비계산서 145580 증빙');
});
await ta('시계 방향으로 돌려야 서는 사진(EXIF 6·8)은 선 모양으로 쪽을 잡는다 — 넓게 찍혔어도 세로 쪽이다', async () => {
  assert.deepEqual(await sizes((await buildPdf([file('a.jpg', wideJpeg(6), 'image/jpeg')])).bytes), [[595, 842]]);
  assert.deepEqual(await sizes((await buildPdf([file('a.jpg', wideJpeg(8), 'image/jpeg')])).bytes), [[595, 842]]);
  assert.deepEqual(await sizes((await buildPdf([file('a.jpg', wideJpeg(3), 'image/jpeg')])).bytes), [[842, 595]], '뒤집힌 것(3)은 가로 그대로다');
});
await ta('.jpg 라는 이름의 PNG 도 PNG 로 넣는다', async () => {
  assert.equal((await buildPdf([file('캡처.jpg', Buffer.from(PNG, 'base64'), 'image/jpeg')])).pages, 1);
});
await ta('그 밖의 그림은 PNG 로 바꿔 넣고, 바꿀 수단이 없으면 무엇을 넣으라고 말한다', async () => {
  const gif = file('움짤.gif', Buffer.from('GIF89a....'), 'image/gif');
  assert.equal((await buildPdf([gif], { toPng: async () => Buffer.from(PNG, 'base64') })).pages, 1);
  await assert.rejects(buildPdf([gif]), /움짤\.gif: 이 형식은 PDF 로 바꾸지 못했습니다/);
});
await ta('읽지 못하는 PDF 와 빈 목록은 던진다', async () => {
  await assert.rejects(buildPdf([file('깨진.pdf', Buffer.from('%PDF-1.7 깨진 파일'), 'application/pdf')]), /깨진\.pdf: PDF 를 읽지 못했습니다/);
  await assert.rejects(buildPdf([]), /묶을 증빙이 없습니다/);
});

console.log(`\n통과 ${pass}건`);
