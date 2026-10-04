// 홈의 WORKSPACE 카드에서 출장 줄에 놓거나 붙여 넣은 증빙을 받는 길(2026-10-04 사용자 지정).
//
// 카드는 콘텐츠 스크립트라 Claude(로컬 CLI·API 키)도 보관함(확장의 IndexedDB)도 쓸 수 없다 — 배경(서비스 워커)이 이 길로 대신 받는다.
// 패널의 출장 카드가 증빙을 받을 때와 같은 판단을 쓴다: 한 장씩 읽어(src/llm.js 의 receiptSmart) 무엇의 증명인지 가리고
// (src/after.js 의 evidenceOf), 증빙으로 쓸 수 있는 것만 보관함(src/evidence.js)에 담는다.
//
// **여기서는 여비계산서를 바꾸지 않는다.** 숙박 증빙·항공권은 사후정산에도 올라가야 하지만, 그것은 실제 계산서를 바꾸는 일이고
// 올리기 전에 사람이 정해 줄 것(외화 문서의 원화 금액, 상한액 초과)이 있을 수 있다 — 패널의 출장 카드가 한다. 그래서 그런 증빙에는
// 읽은 기록(record)과 "사후정산에 아직 올리지 않음"(todo)을 붙여 담고, 패널은 그 기록으로 다시 읽지 않고 올린다.
//
// 이 파일은 DOM·네트워크 없이 돈다 — 읽는 길(read)과 보관함(store)은 주입받는다.

import { evidenceOf } from './after.js';

/** 받는 파일의 크기 한도 — 패널의 출장 카드와 같다. */
export const INTAKE_LIMIT = 10 * 1024 * 1024;
/** 사후정산에도 올라가야 하는 문서(숙박 영수증·예약서, 항공권·항공 영수증). */
const NEEDS_AFTER = /^(lodging|flight)_/;
/** 사후정산이 완료된 출장에 넣은 파일의 이름표 — 읽지 않고 보낼 증빙으로 담는다(패널 송부 칸의 "증빙 넣기"와 같다). */
export const PLAIN_LABEL = '증빙';

/** data URL 의 내용이 몇 바이트쯤인가(base64 길이로 어림). */
const sizeOf = (dataUrl) => Math.floor((String(dataUrl).length - String(dataUrl).indexOf(',') - 1) * 0.75);

/**
 * 보관함의 열쇠는 파일 이름이다. 붙여 넣은 그림은 이름이 모두 image.png 라, 내용이 다른 그림이 같은 이름으로 오면 앞에 보관한
 * 증빙을 덮어쓴다 — 내용이 다르면 이름에 번호를 붙인다(패널의 출장 카드와 같은 규칙). 같은 내용이면 같은 이름 그대로다(새것으로 바뀐다).
 */
export function uniqueName(name, dataUrl, kept) {
  const taken = (n) => (kept || []).some((k) => k.name === n && k.dataUrl !== dataUrl);
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let i = 2;
  while (taken(`${stem} (${i})${ext}`)) i++;
  return `${stem} (${i})${ext}`;
}

/**
 * 증빙 한 장을 받는다. 던지지 않는다 — 못 받으면 까닭을 답한다.
 * @param {{docNo: string, trip: {seq?: string, from: string, to: string, location?: string}, me?: string,
 *          file: {name: string, type?: string, dataUrl: string}, settled?: boolean}} ask
 *   docNo 는 HR 출장 신청서 번호, trip 은 그 출장의 여비계산서, settled 는 사후정산이 완료된 출장인가(읽지 않고 담는다)
 * @param {{store: {list: Function, keep: Function}, read: (file: object, ctx: object) => Promise<{record: object}>}} deps
 * @returns {Promise<{ok: boolean, kept?: boolean, name?: string, label?: string, note?: string, summary?: string, todo?: boolean, error?: string}>}
 *   kept 가 거짓이면 읽었지만 증빙으로 쓸 수 없는 문서다(note 가 그 까닭). todo 는 사후정산에도 올려야 하는 증빙인가
 */
export async function intakeEvidence({ docNo, trip, me = '', file, settled = false } = {}, { store, read }) {
  if (!docNo || !trip?.from) return { ok: false, error: '어느 출장의 증빙인지 알 수 없습니다.' };
  if (typeof file?.dataUrl !== 'string' || !file.dataUrl.startsWith('data:')) return { ok: false, error: '받을 파일이 없습니다.' };
  if (sizeOf(file.dataUrl) > INTAKE_LIMIT) return { ok: false, error: `${file.name || '파일'} 이 너무 큽니다. 10MB 이하로 넣어 주세요.` };
  try {
    // 보관함을 못 읽어도 증빙은 읽는다 — 담을 때 다시 말한다.
    const kept = await store.list(docNo).catch(() => []);
    const f = { name: uniqueName(String(file.name || 'image.png'), file.dataUrl, kept), type: String(file.type || ''), dataUrl: file.dataUrl };
    const ref = { seq: trip.seq || '', from: trip.from, to: trip.to || trip.from, location: trip.location || '' };
    if (settled) {
      await store.keep(docNo, [{ ...f, label: PLAIN_LABEL, summary: '', date: null, total: null, trip: ref }]);
      return { ok: true, kept: true, name: f.name, label: PLAIN_LABEL, note: '', summary: '', todo: false };
    }
    const { record } = await read(f, { trip: ref, me });
    const e = evidenceOf(record, ref);
    const summary = record?.summary || '';
    if (!e.ok) return { ok: true, kept: false, name: f.name, label: e.label, note: e.note, summary, todo: false };
    const todo = NEEDS_AFTER.test(record.docType || '');
    await store.keep(docNo, [{
      ...f, label: e.label, summary, date: record.payDate || record.flightDate || null, total: record.total ?? null, trip: ref,
      ...(todo ? { todo: true, record } : {}),
    }]);
    return { ok: true, kept: true, name: f.name, label: e.label, note: '', summary, todo };
  } catch (err) {
    return { ok: false, name: String(file.name || ''), error: err?.message || String(err) };
  }
}
