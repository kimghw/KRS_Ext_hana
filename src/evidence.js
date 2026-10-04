// 출장 증빙 보관함 — 출장 카드에 넣은 증빙을 담아 두었다가, 담당자에게 Teams·쪽지로 보낼 때 같이 보낸다
// (2026-10-03 사용자 지정). 담는 것은 신청 내역의 출장 카드(attendpanel.js)가 증빙을 읽은 뒤에 한다 —
// 증빙으로 쓸 수 있다고 가려진 것(src/after.js 의 evidenceOf 가 ok)만 담는다. label 이 무엇의 증명인지 말한다:
//
//   당일출장 증명  그 출장지에서 결제한 영수증(1박 이상 출장이면 label 은 "출장지 영수증") — 여비계산서에 붙일 칸이 없다
//   항공기 증명    항공권·항공 영수증 — 값은 사후정산에 올라가지만 파일을 붙일 칸은 없다
//   숙박 증빙      숙박 영수증·예약서 — 사후정산의 숙박 줄에 첨부로도 올라간다
//
// 출장지에서 결제하지 않은 영수증·기차표처럼 증빙으로 쓸 수 없는 것은 담지 않는다.
//
// **보내는 쪽은 여기 없다** — 꺼내 쓰는 길만 있다:
//
//   import { createEvidenceStore } from './evidence.js';
//   const files = await createEvidenceStore().list(docNo);   // docNo 는 HR 출장 신청서 번호
//   // → [{ docNo, name, type, dataUrl, label, summary, date, total, trip: {seq, from, to, location}, savedAt }, …]
//
// 파일(data URL)이 커서 chrome.storage 가 아니라 IndexedDB 에 둔다(확장의 출처에 하나 — 패널을 닫아도 남는다).

/** 보관함의 IndexedDB 이름과 저장소 이름. */
export const EVIDENCE_DB = 'krsWorkspace';
export const EVIDENCE_STORE = 'tripEvidence';

/**
 * IndexedDB 에 열쇠-값으로 담는 뒷단. 부를 때마다 열고 닫는다 — 드물게 쓰이고, 열어 둔 채 두면 버전을 올릴 때 걸린다.
 * @returns {{set: Function, delete: Function, all: Function}}
 */
export function idbBackend({ idb = globalThis.indexedDB, name = EVIDENCE_DB, store = EVIDENCE_STORE } = {}) {
  const open = () => new Promise((resolve, reject) => {
    if (!idb) { reject(new Error('이 환경에는 보관함(IndexedDB)이 없습니다.')); return; }
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('보관함을 열지 못했습니다.'));
  });
  const run = async (mode, work) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = work(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('보관함에 쓰지 못했습니다.'));
      });
    } finally {
      db.close();
    }
  };
  return {
    set: (key, value) => run('readwrite', (s) => s.put(value, key)),
    delete: (key) => run('readwrite', (s) => s.delete(key)),
    all: () => run('readonly', (s) => s.getAll()),
  };
}

/**
 * 증빙 보관함. 출장(HR 신청서 번호)마다 파일을 담고, 꺼내고, 뺀다. 같은 출장에 같은 이름의 파일을 다시 담으면 새것으로 바뀐다.
 * @param {{set: Function, delete: Function, all: Function}} [backend] 테스트는 가짜 뒷단을 준다
 * @param {{now?: () => number}} [opts]
 */
export function createEvidenceStore(backend = idbBackend(), { now = () => Date.now() } = {}) {
  const keyOf = (docNo, name) => `${docNo}|${name}`;
  return {
    /**
     * @param {string} docNo HR 출장 신청서 번호
     * @param {{name:string, type?:string, dataUrl:string, label:string, summary?:string, date?:string|null, total?:number|null, trip?:object}[]} items
     */
    async keep(docNo, items) {
      for (const it of items || []) await backend.set(keyOf(docNo, it.name), { ...it, docNo, savedAt: now() });
    },
    /** 그 출장에 담아 둔 증빙 — 담은 차례대로. */
    async list(docNo) {
      return (await backend.all()).filter((x) => x.docNo === docNo).sort((a, b) => a.savedAt - b.savedAt);
    },
    async remove(docNo, name) {
      await backend.delete(keyOf(docNo, name));
    },
  };
}
