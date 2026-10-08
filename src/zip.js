// 압축 없이(store) 담는 작은 ZIP 쓰기 — R&D 탭이 스킬 묶음을 내려받게 하는 데 쓴다(src/rndskills.js).
// 라이브러리 없이 ZIP 의 세 조각(파일 머리 · 중앙 목록 · 끝 기록)만 쓴다. 파일 이름은 UTF-8(머리 플래그 비트 11).
// 받는 쪽(탐색기·unzip)은 압축 안 한 항목도 그대로 푼다.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32(IEEE) — ZIP 이 항목마다 적는 값. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const toBytes = (data) => (data instanceof Uint8Array ? data : enc.encode(String(data ?? '')));

/** ZIP 의 DOS 시각·날짜(2초 단위, 1980년부터). */
function dosTime(d) {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * 항목들을 ZIP 바이트로. 이름은 묶음 안의 길("rnd-kr-extract/SKILL.md"), data 는 글이나 바이트.
 * @param {{ name: string, data: Uint8Array|string }[]} entries
 * @param {{ date?: Date }} [opts] 항목의 시각(검사에서 못 박는다)
 * @returns {Uint8Array}
 */
export function buildZip(entries, { date = new Date() } = {}) {
  const { time, date: dd } = dosTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(String(e.name).replace(/\\/g, '/').replace(/^\/+/, ''));
    const data = toBytes(e.data);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);        // 풀려면 2.0
    local.setUint16(6, 0x0800, true);    // 이름이 UTF-8
    local.setUint16(8, 0, true);         // store
    local.setUint16(10, time, true);
    local.setUint16(12, dd, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, data);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, dd, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
  let at = 0;
  for (const b of parts) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

/**
 * buildZip 이 만든 ZIP 을 읽는다(검사용 — 압축 안 한 항목만). 중앙 목록을 따라 이름·바이트·CRC 가 맞는지 본다.
 * @returns {{ name: string, data: Uint8Array }[]}
 */
export function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let eocd = bytes.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ZIP 끝 기록이 없습니다.');
  const count = dv.getUint16(10 + eocd, true);
  let at = dv.getUint32(16 + eocd, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(at, true) !== 0x02014b50) throw new Error('중앙 목록이 깨졌습니다.');
    const method = dv.getUint16(at + 10, true);
    const crc = dv.getUint32(at + 16, true);
    const size = dv.getUint32(at + 24, true);
    const nlen = dv.getUint16(at + 28, true);
    const elen = dv.getUint16(at + 30, true);
    const clen = dv.getUint16(at + 32, true);
    const offset = dv.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nlen));
    if (method !== 0) throw new Error(`${name}: 압축한 항목은 읽지 않습니다.`);
    if (dv.getUint32(offset, true) !== 0x04034b50) throw new Error(`${name}: 파일 머리가 깨졌습니다.`);
    const lnlen = dv.getUint16(offset + 26, true);
    const lelen = dv.getUint16(offset + 28, true);
    const start = offset + 30 + lnlen + lelen;
    const data = bytes.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`${name}: CRC 가 맞지 않습니다.`);
    out.push({ name, data });
    at += 46 + nlen + elen + clen;
  }
  return out;
}
