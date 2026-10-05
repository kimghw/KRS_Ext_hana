import { hrListDocs, hrCloseWorker, hrWorkerAlive } from './src/hr.js';
import { loadPlans } from './src/plans.js';
import { receiptSmart } from './src/llm.js';
import { todayStr } from './src/parse.js';
import { createEvidenceStore } from './src/evidence.js';
import { intakeEvidence } from './src/intake.js';
import { createLogbook } from './src/logbook.js';

// 툴바 아이콘 클릭 시 사이드 패널이 열리도록 한다.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('sidePanel.setPanelBehavior 실패:', err));

/**
 * 홈의 WORKSPACE 카드(콘텐츠 스크립트)는 sidePanel API 를 직접 못 부른다. 그 탭에 패널을 열어 달라는
 * 부탁을 대신 들어준다. sidePanel.open 은 사용자 동작에 응해서만 열리는데, 카드의 버튼 클릭에서
 * 온 메시지는 그 동작을 물려받는다.
 */
function openSidePanel(sender) {
  const tabId = sender.tab?.id;
  const opening = tabId == null
    ? Promise.reject(new Error('어느 탭인지 알 수 없습니다.'))
    : chrome.sidePanel.open({ tabId });
  return opening.then(
    () => ({ ok: true }),
    (err) => ({ ok: false, error: err?.message || String(err) }),
  );
}

// 홈 탭이 여럿이면 부탁도 여럿 온다. 읽는 중이면 그 읽기에 같이 태운다.
let plansRun = null;

/**
 * 홈의 WORKSPACE 카드가 근태(출장·외근·휴가)를 읽어 달라고 한다. HR 은 eclass 와 다른 출처이고 HR 작업 탭을
 * 거쳐야 읽히는데, 콘텐츠 스크립트에는 탭을 다루는 API 가 없다. 패널의 현황 탭과 같은 길(src/plans.js)로 읽어
 * 같은 자리에 담는다 — 오늘 읽어 둔 것이 있으면 HR 을 열지 않는다.
 *
 * 패널이 쓰던 작업 탭이 있으면 그대로 빌려 쓰고 건드리지 않는다. 없어서 여기서 열었으면 읽은 뒤 닫는다
 * — 패널이 없으면 그 탭을 치워 줄 것이 없다.
 */
function readPlans(force) {
  plansRun ||= (async () => {
    const had = await hrWorkerAlive().catch(() => true);
    try {
      return await loadPlans(todayStr(), { force, listDocs: hrListDocs });
    } finally {
      if (!had) await hrCloseWorker();
    }
  })().then(
    (r) => ({ ok: true, ...r }),
    (err) => ({ ok: false, items: [], error: err?.message || String(err) }),
  ).finally(() => { plansRun = null; });
  return plansRun;
}

/** 서비스 워커는 30초 동안 일이 없으면 잠든다. 증빙 한 장을 읽는 데는 그보다 오래 걸릴 수 있어, 읽는 동안 이 간격으로 깨워 둔다. */
const AWAKE_MS = 20_000;

/**
 * 사후정산 입력 화면(콘텐츠 스크립트 src/afterpage.js)이 증빙 한 장을 읽어 달라고 한다. 로컬 CLI 다리(네이티브 메시징)와
 * API 키는 콘텐츠 스크립트에서 쓸 수 없다. 패널의 출장 카드와 같은 길(src/llm.js 의 receiptSmart — 로컬 CLI → API 키)로 읽고,
 * 명세(input.yaml 의 receipt)를 지난 기록만 돌려준다. 읽기만 한다 — 화면의 칸을 채우는 것은 그 화면의 스크립트다.
 * @returns {Promise<{ok: boolean, record?: object, via?: string, note?: string, error?: string}>}
 */
async function readReceipt(msg) {
  const file = msg?.file;
  if (typeof file?.dataUrl !== 'string' || !file.dataUrl.startsWith('data:')) return { ok: false, error: '읽을 파일이 없습니다.' };
  const awake = setInterval(() => chrome.runtime.getPlatformInfo?.(() => {}), AWAKE_MS);
  try {
    const { apiKey = '' } = await chrome.storage.local.get('apiKey');
    const r = await receiptSmart(
      { name: String(file.name || 'receipt'), type: String(file.type || ''), dataUrl: file.dataUrl },
      { trip: msg.ctx?.trip || {}, me: String(msg.ctx?.me || '') },
      { apiKey, useNative: true },
    );
    return { ok: true, record: r.record, via: r.via, note: r.note || '' };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearInterval(awake);
  }
}

/**
 * 홈의 WORKSPACE 카드가 출장 줄에 놓거나 붙여 넣은 증빙 한 장을 받아 달라고 한다(2026-10-04 사용자 지정). 카드는 콘텐츠 스크립트라
 * Claude 도 보관함(확장의 IndexedDB)도 쓸 수 없다. 패널의 출장 카드와 같은 판단(src/intake.js)으로 읽어 증빙으로 쓸 수 있는 것만
 * 보관함에 담는다 — 여기서는 여비계산서를 바꾸지 않는다(사후정산에는 홈 카드가 이어서 올린다 — src/afterup.js). 무엇을 받았는지는 활동 기록에 남긴다.
 * @returns {Promise<{ok: boolean, kept?: boolean, name?: string, label?: string, note?: string, todo?: boolean, error?: string}>}
 */
async function keepEvidence(msg) {
  const awake = setInterval(() => chrome.runtime.getPlatformInfo?.(() => {}), AWAKE_MS);
  try {
    const { apiKey = '' } = await chrome.storage.local.get('apiKey');
    const r = await intakeEvidence(msg, {
      store: createEvidenceStore(),
      read: (file, ctx) => receiptSmart(file, ctx, { apiKey, useNative: true }),
    });
    const what = !r.ok ? `실패 — ${r.error}` : !r.kept ? `${r.label} — 증빙으로 쓸 수 없음(${r.note})`
      : r.warn ? `${r.label} — 출장 기간과 안 맞아 알림 표시로 보관(${r.warn})` : `${r.label} 보관`;
    createLogbook({ storage: chrome.storage.local })
      .add('trip', { ok: r.ok, text: `홈 카드에서 받은 증빙: ${r.name || msg?.file?.name || '?'} · ${what}`, data: { docNo: msg?.docNo, seq: msg?.trip?.seq, todo: !!r.todo } })
      .catch(() => {});
    return r;
  } finally {
    clearInterval(awake);
  }
}

/** 홈의 WORKSPACE 카드가 보관함에 무엇이 들어 있는지 줄여 적어 달라고 한다(src/evidence.js 의 MARKS_KEY) — 적어 둔 것이 아직 없을 때 한 번이다. */
function syncMarks() {
  return createEvidenceStore().sync().then(
    (marks) => ({ ok: true, marks }),
    (err) => ({ ok: false, error: err?.message || String(err) }),
  );
}

/**
 * 홈의 WORKSPACE 카드가 넣은 증빙을 그 자리에서 사후정산에 올릴 때(src/afterup.js) 보관함에 부탁하는 것들 — 카드는 보관함을 못 읽는다.
 *   evidenceGiven  그 출장의 증빙 가운데 읽은 기록이 붙은 것(파일은 빼고) — 아직 안 올린 것(todo)과 앞서 올린 항공권이다
 *   evidenceFile   증빙 한 장의 파일(숙박 줄의 첨부로 올라간다)
 *   evidenceDone   올렸다 — "아직 안 올림" 표시를 걷는다
 * 던지지 않는다 — 못 하면 까닭을 답한다.
 */
function shelf(work) {
  return Promise.resolve().then(() => work(createEvidenceStore())).then(
    (r) => ({ ok: true, ...r }),
    (err) => ({ ok: false, error: err?.message || String(err) }),
  );
}
const givenEvidence = (msg) => shelf(async (store) => ({
  // 출장 기간과 안 맞아 알림 표시로 둔 것(warn)은 주지 않는다 — 확정하기 전에는 올리지 않는다.
  items: (await store.list(String(msg?.docNo || ''))).filter((k) => k.record && !k.warn)
    .map((k) => ({ name: k.name, type: k.type || '', label: k.label, todo: !!k.todo, record: k.record })),
}));
const evidenceFile = (msg) => shelf(async (store) => {
  const hit = (await store.list(String(msg?.docNo || ''))).find((k) => k.name === msg?.name);
  if (!hit) throw new Error('보관함에 그 파일이 없습니다.');
  return { dataUrl: hit.dataUrl };
});
const evidenceDone = (msg) => shelf(async (store) => ({ settled: await store.settle(String(msg?.docNo || ''), Array.isArray(msg?.names) ? msg.names : []) }));

/** 홈의 WORKSPACE 카드가 여비계산서에 한 일(사전정산 완료·사후정산 올리기)을 활동 기록에 남겨 달라고 한다 — 기록은 한 곳에서 줄 세워 쓴다. */
function logTrip(msg) {
  return createLogbook({ storage: chrome.storage.local })
    .add('trip', { ok: msg?.ok !== false, text: String(msg?.text || ''), data: msg?.data })
    .then(() => ({ ok: true }), (err) => ({ ok: false, error: err?.message || String(err) }));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'openSidePanel') openSidePanel(sender).then(sendResponse);
  else if (msg?.type === 'hrPlans') readPlans(!!msg.force).then(sendResponse);
  else if (msg?.type === 'receiptRead') readReceipt(msg).then(sendResponse);
  else if (msg?.type === 'evidenceKeep') keepEvidence(msg).catch((err) => ({ ok: false, error: err?.message || String(err) })).then(sendResponse);
  else if (msg?.type === 'evidenceMarks') syncMarks().then(sendResponse);
  else if (msg?.type === 'evidenceGiven') givenEvidence(msg).then(sendResponse);
  else if (msg?.type === 'evidenceFile') evidenceFile(msg).then(sendResponse);
  else if (msg?.type === 'evidenceDone') evidenceDone(msg).then(sendResponse);
  else if (msg?.type === 'tripLog') logTrip(msg).then(sendResponse);
  else return false;
  return true;   // 답은 나중에 준다
});
