// 압축 없이 담는 작은 ZIP 쓰기·읽기 — src/zip.js. CRC-32, 세 조각(파일 머리·중앙 목록·끝 기록), UTF-8 이름, DOS 시각, 왕복, 깨진 것 거르기.
import assert from 'node:assert/strict';

import { crc32, buildZip, readZip } from '../src/zip.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const enc = new TextEncoder();
const dec = new TextDecoder();

console.log('ZIP');
t('CRC-32 — 알려진 값', () => {
  assert.equal(crc32(enc.encode('abc')), 0x352441c2);
  assert.equal(crc32(enc.encode('The quick brown fox jumps over the lazy dog')), 0x414fa339);
  assert.equal(crc32(new Uint8Array()), 0);
});
t('쓰고 다시 읽으면 그대로 — 글·바이트·빈 항목, 한글 이름, 머리와 끝 기록', () => {
  const z = buildZip([{ name: 'a/한글.txt', data: '가나다' }, { name: 'b.bin', data: new Uint8Array([0, 255, 1]) }, { name: '\\empty', data: '' }], { date: new Date(2026, 9, 8, 11, 22, 34) });
  assert.deepEqual([...z.subarray(0, 4)], [0x50, 0x4b, 3, 4], '파일 머리');
  assert.deepEqual([...z.subarray(z.length - 22, z.length - 18)], [0x50, 0x4b, 5, 6], '끝 기록');
  const dv = new DataView(z.buffer);
  assert.equal(dv.getUint16(6, true), 0x0800, '이름이 UTF-8');
  assert.equal(dv.getUint16(8, true), 0, '압축 안 함');
  assert.equal(dv.getUint16(10, true), (11 << 11) | (22 << 5) | 17, 'DOS 시각(2초 단위)');
  assert.equal(dv.getUint16(12, true), ((2026 - 1980) << 9) | (10 << 5) | 8, 'DOS 날짜');
  const back = readZip(z);
  assert.deepEqual(back.map((e) => e.name), ['a/한글.txt', 'b.bin', 'empty'], '역슬래시·앞의 빗금은 뗀다');
  assert.equal(dec.decode(back[0].data), '가나다');
  assert.deepEqual([...back[1].data], [0, 255, 1]);
  assert.equal(back[2].data.length, 0);
  assert.equal(dv.getUint16(z.length - 22 + 10, true), 3, '항목 수');
});
t('항목이 없어도 ZIP 이고, 큰 바이트도 그대로', () => {
  assert.deepEqual(readZip(buildZip([])), []);
  const big = new Uint8Array(70000).map((_, i) => i % 251);
  assert.deepEqual(readZip(buildZip([{ name: 'big', data: big }]))[0].data, big);
});
t('깨진 것은 거른다 — 끝 기록 없음, CRC 안 맞음', () => {
  assert.throws(() => readZip(new Uint8Array(10)), /끝 기록/);
  const z = buildZip([{ name: 'x', data: 'y' }]);
  z[31] ^= 0xff;   // 파일 머리(30) + 이름(1) 뒤의 첫 바이트
  assert.throws(() => readZip(z), /CRC/);
});

console.log(`\n${pass} passed`);
