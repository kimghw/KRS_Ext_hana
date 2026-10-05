// 홈의 WORKSPACE 카드에서 출장 줄에 놓거나 붙여 넣은 증빙을 받는 길(2026-10-04 사용자 지정).
//
// 카드는 콘텐츠 스크립트라 Claude(로컬 CLI·API 키)도 보관함(확장의 IndexedDB)도 쓸 수 없다 — 배경(서비스 워커)이 이 길로 대신 받는다.
// 패널의 출장 카드가 증빙을 받을 때와 같은 판단을 쓴다: 한 장씩 읽어(src/llm.js 의 receiptSmart) 무엇의 증명인지 가리고
// (src/after.js 의 evidenceOf), 증빙으로 쓸 수 있는 것만 보관함(src/evidence.js)에 담는다.
//
// **여기서는 여비계산서를 바꾸지 않는다** — 읽어서 담기만 한다. 숙박 증빙·항공권은 사후정산에도 올라가야 하므로 읽은 기록(record)과
// "사후정산에 아직 올리지 않음"(todo)을 붙여 담는다. 올리는 것은 홈 카드가 이어서 한다(src/afterup.js — 2026-10-04 사용자 지정:
// "올리면 바로 사후등록") — 그 기록으로 다시 읽지 않고 올리고 표시를 걷는다. 올리기 전에 사람이 정해 줄 것(외화 문서의 원화 금액,
// 상한액 초과)이 있으면 표시가 남고, 패널의 출장 카드가 물어서 올린다.
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
 * 보관함에 담는 일은 줄을 세운다 — 홈 카드가 여러 장을 나란히 읽혀도(src/home.js 의 takeFiles, 2026-10-05) 이름 고르기(uniqueName —
 * 그때 보관함에 있는 것을 본다)와 담기가 서로 끼어들지 않게. 줄을 세우지 않으면 이름이 같은 다른 그림 두 장이 서로를 못 보고 같은
 * 이름으로 담겨 한 장이 덮인다. 읽기(Claude)는 줄 밖에서 나란히 돈다.
 */
let shelfLine = Promise.resolve();
function inLine(work) {
  const run = shelfLine.then(work);
  shelfLine = run.catch(() => {});
  return run;
}

/**
 * 증빙 한 장을 받는다. 던지지 않는다 — 못 받으면 까닭을 답한다.
 * @param {{docNo: string, trip: {seq?: string, from: string, to: string, location?: string}, me?: string,
 *          file: {name: string, type?: string, dataUrl: string}, settled?: boolean}} ask
 *   docNo 는 HR 출장 신청서 번호, trip 은 그 출장의 여비계산서, settled 는 사후정산이 완료된 출장인가(읽지 않고 담는다)
 * @param {{store: {list: Function, keep: Function}, read: (file: object, ctx: object) => Promise<{record: object}>}} deps
 * @returns {Promise<{ok: boolean, kept?: boolean, name?: string, label?: string, note?: string, warn?: string, summary?: string, todo?: boolean, error?: string}>}
 *   kept 가 거짓이면 읽었지만 증빙으로 쓸 수 없는 문서다(note 가 그 까닭). todo 는 사후정산에도 올려야 하는 증빙인가.
 *   warn 이 있으면 출장 기간의 것이 아니라 알림 표시로 담은 것이다(그 까닭) — 올리지도 보내지도 않는다
 */
export async function intakeEvidence({ docNo, trip, me = '', file, settled = false } = {}, { store, read }) {
  if (!docNo || !trip?.from) return { ok: false, error: '어느 출장의 증빙인지 알 수 없습니다.' };
  if (typeof file?.dataUrl !== 'string' || !file.dataUrl.startsWith('data:')) return { ok: false, error: '받을 파일이 없습니다.' };
  if (sizeOf(file.dataUrl) > INTAKE_LIMIT) return { ok: false, error: `${file.name || '파일'} 이 너무 큽니다. 10MB 이하로 넣어 주세요.` };
  try {
    const f = { name: String(file.name || 'image.png'), type: String(file.type || ''), dataUrl: file.dataUrl };
    const ref = { seq: trip.seq || '', from: trip.from, to: trip.to || trip.from, location: trip.location || '' };
    /**
     * 담는다 — 이름은 담는 그때 보관함에 있는 것을 보고 고른다(uniqueName). 한 번에 한 장씩이다(inLine).
     * 보관함을 못 읽어도 담아 본다 — 못 담으면 그때 까닭이 나온다. 담은 이름을 돌려준다.
     */
    const keep = (item) => inLine(async () => {
      const kept = await store.list(docNo).catch(() => []);
      const name = uniqueName(f.name, f.dataUrl, kept);
      await store.keep(docNo, [{ ...f, name, ...item }]);
      return name;
    });
    if (settled) {
      const name = await keep({ label: PLAIN_LABEL, summary: '', date: null, total: null, trip: ref });
      return { ok: true, kept: true, name, label: PLAIN_LABEL, note: '', summary: '', todo: false };
    }
    const { record } = await read(f, { trip: ref, me });
    const e = evidenceOf(record, ref);
    const summary = record?.summary || '';
    // 출장 기간의 것이 아닌 문서(2026-10-05 사용자 지정) — 버리지 않고 알림 표시(warn)를 붙여 담는다. 사후정산에 올리지 않고
    // (todo 를 붙이지 않는다), 사람이 확정하기 전에는 담당자에게 보낼 때도 빠진다. 읽은 기록은 같이 둔다 — 확정하면 그 기록으로 올린다.
    if (e.warn) {
      const name = await keep({
        label: e.label, summary, date: record.payDate || record.flightDate || null, total: record.total ?? null, trip: ref, warn: e.warn, record,
      });
      return { ok: true, kept: true, name, label: e.label, note: '', warn: e.warn, summary, todo: false };
    }
    if (!e.ok) return { ok: true, kept: false, name: f.name, label: e.label, note: e.note, summary, todo: false };
    const todo = NEEDS_AFTER.test(record.docType || '');
    const name = await keep({
      label: e.label, summary, date: record.payDate || record.flightDate || null, total: record.total ?? null, trip: ref,
      ...(todo ? { todo: true, record } : {}),
    });
    return { ok: true, kept: true, name, label: e.label, note: '', summary, todo };
  } catch (err) {
    return { ok: false, name: String(file.name || ''), error: err?.message || String(err) };
  }
}
