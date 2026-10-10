// 공문 탭의 화면. 무엇을 어떤 틀에 넣을지·결재선·한도는 src/gongmun.js 가, 문서 읽기는 src/llm.js 의 gongmunSmart 가 한다.
// 여기는 그 둘을 화면에 잇기만 한다.
//
// 'eclass 에 공문 작성' 은 새 공문 창을 열어 과제(Job Id)·제목·차수·본문·문서설정·결재선(위임전결)을 넣는다(src/gmwrite.js — 2026-10-08 사용자 지정:
// "공문에서 열기가 아니라 공문을 작성해야지"). 첨부·임시저장·상신은 창에서 사람이 한다. 제목·본문 복사 단추는 뺐다(같은 날 — 창에 바로 넣는다).
//
//   갈래(구매·교육·출장) → 과제 고르기(갈래 아래의 별칭 칩) → 문서 넣기(캡처 붙여넣기·끌어다 놓기·고르기·보고 있는 탭 통째로 캡처·웹페이지의 부분 골라 캡처) → 읽은 칸 고치기 → 문서설정·위임전결 → eclass 에 공문 작성
//
// 양식(eclass 양식·제목 틀·본문 틀)과 공문 설정(부서·부서장·소장·본부장·문서번호 부서·참조자·과제 — R&D 탭에 과제가 있으면 그 과제들)은 이 탭 아래의 접힌 칸에서 고친다.
// 갈래·틀·칸·위임전결·문서설정의 원본은 레시피(recipes/gongmun)다.

import {
  KINDS, KIND_ORDER, FORMS, MAX_PROJECTS, VARS, VAR_MARKS, FIELDS,
  KIND_KEY, PRESET_KEY, PROJECTS_KEY, TEMPLATES_KEY, DRAFT_KEY, RND_EXTRA_KEY,
  templateOf, templateEdited, templatePatch, normalizePreset, normalizeProjects, normalizeRndExtra, sameProject, fromRecord, blankDraft, summaryOf,
  overLimit, approvalLine, lineText, compose, needs, attachName, whoOf, DOC_NAMES, won, moneyOf, docNoCandidates, ROLE_LABEL,
  mergeDraft, applyReason, REASON_KEYS, EMPTY_ROW, eduModeOf, spreadParts, attachWithCut, rndProjects, moreLead,
  writePlan, docSettingOf, settingText, settingPatch, delegationOf, RANKS, RANK_WHY, SETTING_OPTIONS,
} from './src/gongmun.js';
import { writeGongmun, showTab } from './src/gmwrite.js';
import { BOOK_KEY, normalizeBook, MAX_PROJECTS as RND_MAX } from './src/rnd.js';
import { gongmunSmart, gongmunReasonSmart } from './src/llm.js';
import { readSlots } from './src/pagecap.js';
import { cutBoxes, cutDrop, cutName, cutQuote, CUT_PAD, PAD_STEP, MAX_PAD } from './src/quotecut.js';
import { createWebPick, pickButton } from './webpick.js';

const FILE_LIMIT = 10 * 1024 * 1024;
/** 한 번에 읽는 장 수. 로컬 CLI 다리는 여섯 장까지 받는다(native/host.mjs). 웹페이지 캡처의 그 밖의 장은 첨부에만 넣는다. */
const MAX_FILES = 5;
const SAVE_WAIT_MS = 400;
/** 화면의 접힘·선택 탭은 초안 및 eclass 작성 결과 탭 ID와 별도로 저장한다. */
const VIEW_KEY = 'gongmunView';
/** 오린 견적서(저장소에 두지 않는 것)를 비교작성 탭에 건네는 세션 저장소 키 — 창을 다 닫으면 사라진다. */
const CUT_KEY = 'gongmunCut';
/** 이 창의 표 — 저장한 초안에 적어 두어(by) 저장소 변화가 내가 쓴 것인지 가린다(사이드패널과 비교작성 탭이 같은 초안을 본다). */
const INSTANCE = Math.random().toString(36).slice(2, 10);
/** 비교작성 탭에 초안이 없을 때의 안내. */
const NO_DRAFT_TAB = '사이드패널의 공문 탭에서 문서를 넣거나 문서 없이 쓰기를 누르면 여기에 보입니다.';
const VIA_LABEL = { cli: '로컬 CLI', api: 'API 키', local: '규칙 해석' };
/** 견적서를 오리는 갈래 — 구매(쇼핑몰 화면)와 교육(온라인 강의 페이지의 수강료 칸 — 2026-10-08 사용자 지정). 레시피 purpose.yaml 의 quote_crop. */
const CUT_KINDS = new Set(KIND_ORDER.filter((k) => KINDS[k].cut));
/** 채팅 칸에 남겨 두는 말 수(내 말·답 합쳐서). */
const CHAT_KEEP = 6;
/** 과제를 갈래 아래의 별칭 칩(gmProjBar)에서 먼저 고르는 갈래(2026-10-08 사용자 지정). 외부활동은 작성 내용 탭 안에서 고른다. */
const PICK_FIRST = ['purchase', 'edu', 'trip'];

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** 100만원처럼 만 단위로 끊어 말한다. */
const manwon = (n) => (n % 10000 === 0 ? `${(n / 10000).toLocaleString('ko-KR')}만원` : won(n));
const formLabel = (id) => FORMS.find((f) => f.id === id)?.label || id;

/**
 * @param {{$:Function, escapeHtml:Function, logEvent:Function, ai:() => {apiKey:string, cli:boolean}, me?:() => string,
 *   flash?:(btn:HTMLElement, text:string, ms?:number) => void,
 *   webcap?:{front?:Function, start?:Function, parts?:Function}}} deps
 *   webcap 은 웹페이지를 찍는 길(src/pagecap.js — 보고 있는 탭 통째로·페이지 위의 부분 고르기·고른 부분 찍기) — 캡처 단추(webpick.js)에 넘긴다
 *   compareTab 은 비교작성 탭일 때의 갈래(sidepanel.html?compare=갈래 — sidepanel.js) — 그 갈래의 초안을 작성 내용(공문)·읽은 내용 두 칸으로 넓게 보인다
 */
export function createGongmunPanel({ $, escapeHtml, logEvent, ai, me = () => '', flash = () => {}, webcap = {}, compareTab = '' }) {
  const el = {
    root: $('gongmun'), kinds: $('gmKinds'), projBar: $('gmProjBar'), pick: $('gmPick'), projLabel: $('gmProjLabel'),
    intake: $('gmIntake'), evidenceCount: $('gmEvidenceCount'), evidenceToggle: $('gmEvidenceToggle'), evidenceBody: $('gmEvidenceBody'), file: $('gmFile'), dropLead: $('gmDropLead'), capture: $('gmCapture'),
    manual: $('gmManual'), status: $('gmStatus'),
    // 읽은 내용 탭(readView) — 읽은 칸(moreFields — 펼쳐 두는 칸이 아닌 것)·품목·오린 견적서. 비교작성이면 고른 탭 오른쪽에 나란히 선다.
    draft: $('gmDraft'), readView: $('gmReadView'), moreFields: $('gmMoreFields'), compare: $('gmCompare'),
    agent: $('gmAgent'), agentInput: $('gmAgentInput'), agentGo: $('gmAgentGo'), agentLog: $('gmAgentLog'),
    source: $('gmSource'), cut: $('gmCut'), items: $('gmItems'), limit: $('gmLimit'), projects: $('gmProjects'), projInfo: $('gmProjInfo'),
    fields: $('gmFields'), line: $('gmLine'), need: $('gmNeed'), reset: $('gmReset'),
    workspace: $('gmWorkspace'), workspaceBody: $('gmWorkspaceBody'), workspaceToggle: $('gmWorkspaceToggle'), workspaceFoldLabel: $('gmWorkspaceFoldLabel'),
    viewTabs: $('gmViewTabs'), viewDraft: $('gmViewDraft'), viewDoc: $('gmViewDoc'), viewRead: $('gmViewRead'),
    doc: $('gmDoc'), formName: $('gmFormName'), title: $('gmTitle'), body: $('gmBody'), edited: $('gmEdited'), regen: $('gmRegen'),
    write: $('gmWrite'), writeLog: $('gmWriteLog'), savePdf: $('gmSavePdf'), steps: $('gmSteps'),
    setBox: $('gmSetBox'), setState: $('gmSetState'), rank: $('gmRank'), rankWhy: $('gmRankWhy'), retention: $('gmRetention'), docNoOne: $('gmDocNoOne'),
    receiver: $('gmReceiver'), scope: $('gmScope'), emergency: $('gmEmergency'), approvingOpen: $('gmApprovingOpen'), drm: $('gmDrm'), tag: $('gmTag'), setReset: $('gmSetReset'),
    tplBox: $('gmTplBox'), tplState: $('gmTplState'), tplForm: $('gmTplForm'), tplFormId: $('gmTplFormId'),
    tplTitle: $('gmTplTitle'), tplBody: $('gmTplBody'), tplReset: $('gmTplReset'), vars: $('gmVars'),
    presetBox: $('gmPresetBox'), presetState: $('gmPresetState'), dept: $('gmDept'), head: $('gmHead'), refs: $('gmRefs'),
    director: $('gmDirector'), chief: $('gmChief'), docNo: $('gmDocNo'), docNoHint: $('gmDocNoHint'),
    projList: $('gmProjList'), projAdd: $('gmProjAdd'), projCount: $('gmProjCount'),
  };
  // 웹페이지 캡처 단추 둘(보고 있는 탭 · 부분 골라 캡처) — 출장 카드의 증빙 넣는 곳과 같은 것이다(webpick.js, 2026-10-08 사용자 지정).
  const pick = createWebPick(webcap);
  const PICK_KEY = 'gongmun';
  const st = {
    kind: 'purchase', loaded: false, busy: false, capturing: false, ready: true, reasonBusy: false, writing: false, lastTab: null,
    preset: normalizePreset(null),
    // projects 는 저장된(이름이 있는) 과제, rows 는 공문 설정 칸에 펼쳐 둔 줄(아직 이름을 적지 않은 줄도 있다).
    projects: [], rows: [],
    // 초안에서 고르는 과제는 R&D 탭의 과제다(rndBook — src/gongmun.js 의 rndProjects, 2026-10-08 사용자 지정). book 은 탭을 열 때마다 다시 읽는다.
    // R&D 탭에 과제가 없으면 공문 설정의 과제를 고른다. extra 는 R&D 과제마다 공문 설정에서 적은 개요·계정이다(normalizeRndExtra).
    book: null, rnd: [], extra: {},
    // 갈래마다 고친 양식만 담는다(src/gongmun.js 의 templatePatch).
    templates: {},
    // 갈래마다 쓰고 있는 것 — { draft, source, notes, project(과제명), title·body(직접 고쳤으면 그 글, 아니면 null), files(읽은 파일 — 저장하지 않는다),
    //   parts(읽기가 가린 파일마다의 종류), cut(구매·교육 — 가격과 그 둘레를 오린 견적서, src/quotecut.js — 저장하지 않는다) }
    work: {},
    // tab 은 작성 내용(draft)·공문(doc)·읽은 내용(read). 비교작성 탭(compareTab)이면 읽은 내용은 늘 오른쪽에 있어 tab 은 draft·doc 뿐이고 저장하지 않는다.
    view: { tab: 'draft', evidenceOpen: true, workspaceOpen: true },
    // 비교작성 탭이면 그 갈래(sidepanel.html?compare=갈래). 사이드패널이면 ''.
    compareTab: KINDS[compareTab] ? compareTab : '',
    // 갈래마다 한도에 걸려 있는지 — 새로 걸릴 때 한 번만 읽은 내용 탭으로 간다(칸을 고칠 때마다 가지 않게).
    blocked: {},
    // 고친 초안을 아직 저장소에 쓰지 않았다(saveWork 의 미룸) — 그 사이 다른 창이 쓴 같은 갈래는 받지 않는다(곧 나갈 내 저장이 이긴다).
    dirty: false,
    // 갈래마다 세션 저장소에 건넨 오린 견적서 — 같은 것이면 다시 건네지 않는다.
    stashed: {},
    lastProject: '',
  };

  const cur = () => st.work[st.kind] || null;
  /** 초안에서 고르는 과제 — R&D 탭의 과제, 없으면 공문 설정의 과제. */
  const choices = () => (st.rnd.length ? st.rnd : st.projects);
  const projectOf = (w) => choices().find((p) => p.name === w?.project) || null;
  const ctxOf = (w) => ({ me: me(), preset: st.preset, project: projectOf(w), today: today() });
  /** 결재선의 맥락 — 갈래·초안(금액·출장 구분)·이 공문에서 고른 전결권자까지(위임전결). */
  const lineCtx = (w) => ({ ...ctxOf(w), kind: st.kind, draft: w?.draft || {}, rank: w?.rank || '' });
  const tplOf = () => templateOf(st.kind, st.templates);

  function setStatus(msg, kind = '') {
    el.status.className = `status ${kind}`;
    el.status.textContent = msg;
  }

  /* ---------------------------------------------------------- 저장 */

  const timers = {};
  const later = (key, fn) => { clearTimeout(timers[key]); timers[key] = setTimeout(fn, SAVE_WAIT_MS); };

  /**
   * 쓰고 있는 초안을 남긴다 — 패널을 닫았다 열어도 이어 쓴다. 읽은 파일(그림)과 오린 견적서는 크니 남기지 않는다.
   * 사이드패널과 비교작성 탭이 같은 것을 보며 쓰니 이 창의 표(by)를 적어 둔다 — 저장소 변화가 돌아오면 내 것은 건너뛴다(onStorageChanged).
   */
  function saveWork() {
    st.dirty = true;
    later('work', () => {
      const out = { lastProject: st.lastProject, by: INSTANCE };
      for (const k of KIND_ORDER) {
        if (!st.work[k]) continue;
        const { files, cut, ...rest } = st.work[k];
        out[k] = rest;
      }
      Promise.resolve(chrome.storage.local.set({ [DRAFT_KEY]: out })).catch(() => {}).then(() => { st.dirty = false; });
    });
  }
  const savePreset = () => later('preset', () => chrome.storage.local.set({
    [PRESET_KEY]: st.preset, [PROJECTS_KEY]: normalizeProjects(st.rows), [RND_EXTRA_KEY]: normalizeRndExtra(st.extra),
  }));
  const saveTemplates = () => later('tpl', () => chrome.storage.local.set({ [TEMPLATES_KEY]: st.templates }));
  /** 비교작성 탭은 늘 두 칸이라 화면 상태를 남기지 않는다 — 사이드패널의 탭·접힘을 건드리지 않게. */
  const saveView = () => { if (!st.compareTab) later('view', () => chrome.storage.local.set({ [VIEW_KEY]: { ...st.view } })); };

  /** 저장소의 초안 한 벌을 이 창의 것으로 — 읽은 파일·오린 견적서는 저장소에 없으니 keep(이 창이 들고 있던 것)에서 잇는다. */
  function restoreWork(k, w, keep = null) {
    const out = { ...w, notes: Array.isArray(w.notes) ? w.notes : [], source: w.source || {}, files: keep?.files || [], cut: keep?.cut || null };
    // 교육 구분 칸이 생기기 전에 쓰던 초안 — 교육장소로 정해 칸에 보인다.
    if (k === 'edu' && !w.draft.mode) out.draft = { ...w.draft, mode: eduModeOf(w.draft) };
    return out;
  }

  /**
   * 다른 창이 쓴 초안을 따라간다 — 사이드패널과 비교작성 탭은 같은 초안(DRAFT_KEY)을 보며 쓴다(2026-10-09 사용자 지정: "비교작성은 사이드패널이
   * 아니라 크롬 탭에"). 내가 쓴 것(by)은 건너뛰고, 이 창이 고치는 중인 갈래(dirty — 아직 저장 전)는 두어 곧 나갈 내 저장이 이긴다. 쓰고 있는 칸이
   * 있으면 칸을 다시 그리지 않고 값만 맞춘다(syncField). 오린 견적서는 사이드패널이 세션 저장소(CUT_KEY)로 건네고, 바뀌면 그것도 따라간다.
   */
  function onStorageChanged(changes, area) {
    if (area === 'session') {
      if (changes[CUT_KEY]) applyCut(changes[CUT_KEY].newValue);
      return;
    }
    if (area !== 'local' || !changes[DRAFT_KEY] || !st.loaded) return;
    const kept = changes[DRAFT_KEY].newValue;
    if (!kept || typeof kept !== 'object' || kept.by === INSTANCE) return;
    let repaint = false;
    for (const k of KIND_ORDER) {
      if (st.dirty && k === st.kind) continue;
      const w = kept[k];
      if (!w?.draft || typeof w.draft !== 'object') {
        if (st.work[k]) {
          delete st.work[k];
          delete st.blocked[k];
          repaint = repaint || k === st.kind;
        }
        continue;
      }
      st.work[k] = restoreWork(k, w, st.work[k]);
      repaint = repaint || k === st.kind;
    }
    if (typeof kept.lastProject === 'string') st.lastProject = kept.lastProject;
    if (!repaint) return;
    const active = document.activeElement;
    const typing = !!active && el.workspace.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
    if (typing && cur()) for (const f of FIELDS[st.kind] || []) syncField(f.key);
    else renderFields();
    paintDraft();
    paintIntake();
  }

  /**
   * 오린 견적서를 비교작성 탭에 건넨다 — 저장소에 두지 않는 것이라 세션 저장소(CUT_KEY — 창을 다 닫으면 사라짐)로. 사이드패널만 건네고,
   * 갈래마다 같은 것이면 다시 쓰지 않는다(그림이 커서). force 는 비교작성 탭을 열 때 — 그 탭이 받을 것을 먼저 둔다.
   */
  function stashCut(force = false) {
    const session = chrome.storage.session;
    if (!session?.set || st.compareTab) return Promise.resolve();
    const out = {};
    let changed = force;
    for (const k of KIND_ORDER) {
      const c = st.work[k]?.cut || null;
      if (c) out[k] = c;
      if (st.stashed[k] !== c) changed = true;
      st.stashed[k] = c;
    }
    if (!changed) return Promise.resolve();
    return Promise.resolve(session.set({ [CUT_KEY]: out })).catch(() => {});
  }

  /** 비교작성 탭 — 사이드패널이 건넨 오린 견적서를 초안에 붙인다(세션 저장소를 읽거나 그 변화를 받아서). */
  function applyCut(all) {
    if (!st.compareTab) return;
    for (const k of KIND_ORDER) if (st.work[k]) st.work[k].cut = all?.[k] || null;
    paintCut();
  }

  async function pullCut() {
    const session = chrome.storage.session;
    if (!session?.get || !st.compareTab) return;
    const got = await Promise.resolve(session.get([CUT_KEY])).catch(() => null);
    applyCut(got?.[CUT_KEY]);
  }

  /**
   * 비교작성 — 사이드패널은 좁으니 확장 페이지(sidepanel.html?compare=갈래)를 크롬 탭으로 열어 고른 탭(작성 내용·공문)을 왼쪽에, 읽은 내용을
   * 오른쪽에 나란히 두고 쓴다(2026-10-09 사용자 지정: "비교작성 버튼을 추가 해서 … 비교하면서 작성", "사이드패널이 아니라 크롬 탭에"). 이미 열려
   * 있으면 그 탭을 앞에 둔다(갈래가 다르면 바꾼다). 두 창은 같은 초안(저장소)을 보며 쓴다 — 한쪽에서 고치면 다른 쪽이 따라간다(onStorageChanged).
   */
  async function openCompare() {
    if (!cur() || st.compareTab) return;
    const kind = st.kind;
    await stashCut(true);
    const page = chrome.runtime.getURL('sidepanel.html');
    const url = `${page}?compare=${kind}`;
    const tabs = await Promise.resolve(chrome.tabs.query({})).catch(() => []);
    const open = (tabs || []).find((t) => String(t.url || '').startsWith(page) && /[?&]compare=/.test(t.url));
    if (open) {
      await chrome.tabs.update(open.id, open.url === url ? { active: true } : { active: true, url });
      if (open.windowId != null) await Promise.resolve(chrome.windows?.update?.(open.windowId, { focused: true })).catch(() => {});
    } else {
      await chrome.tabs.create({ url });
    }
    logEvent('gongmun', true, `${KINDS[kind].title} 비교작성 탭 ${open ? '앞에' : '열기'}`);
  }

  /* ---------------------------------------------------------- 접기·화면 탭 */

  const TAB_LABEL = { draft: '작성 내용', doc: '공문', read: '읽은 내용' };

  /**
   * 탭 전환·접기는 입력 노드를 유지하고 가시성만 바꾼다. .hidden 클래스는 초안 없음·한도 차단에만 쓴다.
   * 비교작성 탭(st.compareTab)이면 고른 탭(작성 내용·공문)과 읽은 내용을 함께 보이고 몸통을 두 칸으로 나눈다(sidepanel.css 의 .compare) —
   * 읽은 내용 탭은 늘 오른쪽에 있으니 고를 수 없고, 비교작성 단추(탭을 여는 것)는 숨는다.
   */
  function paintView() {
    const show = !!cur();
    const canDoc = show && !el.doc.classList.contains('hidden');
    if (!canDoc && st.view.tab === 'doc') {
      st.view.tab = 'draft';
      saveView();
    }
    const compare = show && !!st.compareTab;
    if (compare && st.view.tab === 'read') st.view.tab = 'draft';
    el.workspace.classList.toggle('hidden', !show);
    el.workspace.classList.toggle('folded', !st.view.workspaceOpen);
    el.workspaceBody.hidden = !st.view.workspaceOpen;
    el.workspaceBody.classList.toggle('compare', compare);
    el.workspaceToggle.setAttribute('aria-expanded', String(st.view.workspaceOpen));
    el.workspaceFoldLabel.textContent = st.view.workspaceOpen ? '접기' : '펼치기';
    const label = `${compare ? `${TAB_LABEL[st.view.tab]}·읽은 내용` : TAB_LABEL[st.view.tab]} ${st.view.workspaceOpen ? '접기' : '펼치기'}`;
    el.workspaceToggle.setAttribute('aria-label', label);
    el.workspaceToggle.title = label;
    el.viewDoc.disabled = !canDoc;
    el.viewDoc.title = show && !canDoc ? '참고 문서에서 합계 금액을 확인하세요' : '공문 제목·본문·문서설정';
    el.viewRead.disabled = compare;
    if (compare) el.viewRead.title = '비교작성 — 읽은 내용은 오른쪽에 있습니다';
    el.compare.hidden = !!st.compareTab;
    for (const [tab, panel, name] of [[el.viewDraft, el.draft, 'draft'], [el.viewDoc, el.doc, 'doc'], [el.viewRead, el.readView, 'read']]) {
      const active = st.view.tab === name;
      const beside = compare && name === 'read';
      tab.classList.toggle('active', active);
      tab.classList.toggle('beside', beside);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panel.hidden = !show || !(active || beside);
    }
    el.evidenceBody.hidden = !st.view.evidenceOpen;
    el.evidenceToggle.setAttribute('aria-expanded', String(st.view.evidenceOpen));
    el.evidenceToggle.title = `참고 문서 ${st.view.evidenceOpen ? '접기' : '펼치기'}`;
  }

  function revealEvidence() {
    if (st.view.evidenceOpen) return;
    st.view.evidenceOpen = true;
    saveView();
  }

  /** 읽은 내용 탭을 연다 — 읽은 칸에 채울 것이 남았거나 한도에 걸렸을 때. 비교작성 탭이면 이미 오른쪽에 보이니 탭은 두고 접힌 몸통만 편다. */
  function showRead() {
    if (!st.compareTab) st.view.tab = 'read';
    st.view.workspaceOpen = true;
    saveView();
  }

  function selectView(tab) {
    if (!TAB_LABEL[tab]) return;
    if ((tab === 'doc' && el.viewDoc.disabled) || (tab === 'read' && st.compareTab)) return;
    st.view.tab = tab;
    st.view.workspaceOpen = true;
    paintView();
    saveView();
  }

  function onViewClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-gm-view]') : null;
    if (btn && !btn.disabled) selectView(btn.dataset.gmView);
  }

  function onViewKey(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-gm-view]') : null;
    if (!btn || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const tabs = [el.viewDraft, el.viewDoc, el.viewRead].filter((t) => !t.disabled);
    const i = tabs.indexOf(btn);
    const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1)
      : tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    selectView(next.dataset.gmView);
    next.focus();
  }

  /* ---------------------------------------------------------- 갈래 */

  function paintKinds() {
    el.kinds.innerHTML = `<div class="gm-kind-row">${KIND_ORDER.map((k) => {
      const on = k === st.kind;
      return `<button type="button" class="gm-kind${on ? ' active' : ''}" data-kind="${k}" aria-pressed="${on}" title="${escapeHtml(KINDS[k].title)}">${escapeHtml(KINDS[k].label)}</button>`;
    }).join('')}</div>`;
  }

  function setKind(kind) {
    if (!KINDS[kind] || kind === st.kind) return;
    st.kind = kind;
    // 비교작성 탭에서 갈래를 바꿔도 사이드패널이 다음에 열릴 갈래는 건드리지 않는다.
    if (!st.compareTab) chrome.storage.local.set({ [KIND_KEY]: kind });
    setStatus('');
    paintKinds();
    paintIntake();
    renderFields();
    paintDraft({ fold: true });
    paintTpl();
  }

  /* ---------------------------------------------------------- 문서 넣기 */

  /**
   * 문서 넣는 곳 — 세 갈래가 같은 곳을 쓴다(2026-10-08 사용자 지정: "구매, 교육, 출장 모두 동일한 캡처/파일 넣기 기능"). 상자 안의 말은 머리말과
   * 안내 한 줄("드래그 · 붙여넣기 · 캡처 가능")뿐이다 — 넣은 장 수·한도 안내 두 줄은 뺐다(같은 날 사용자 지정: "중간에 3줄이나 있는 건 모두 삭제").
   * 이미 읽은 초안이 있으면 낮은 추가 행으로 줄이고 머리말이 더 넣는 말(KINDS.more — 꼭 드는 첨부가 빠졌으면 그것, moreLead)이 된다 — 넣으면 앞서 넣은 것과 함께 다시 읽고
   * 같이 첨부한다. 한도(MAX_FILES)는 넘길 때 상태 줄이 말한다.
   */
  function paintIntake() {
    const k = KINDS[st.kind];
    el.intake.classList.toggle('off', !st.ready);
    el.intake.setAttribute('aria-busy', String(st.busy || st.capturing));
    const w = cur();
    el.intake.classList.toggle('compact', !!w);
    const docs = (w?.draft.attach || []).filter((a) => a.files?.length);
    el.evidenceCount.textContent = !w ? '' : docs.length ? `첨부 ${docs.length}종` : w.source?.label === '직접 입력' ? '직접 입력' : '문서 읽음';
    el.dropLead.textContent = st.capturing ? '캡처하는 중…' : st.busy ? '읽는 중…' : w ? moreLead(st.kind, w.draft.attach) : k.ask;
    el.file.disabled = st.busy || st.capturing;
    el.capture.innerHTML = pickButton({ picking: pick.picking(PICK_KEY), disabled: st.busy || st.capturing });
    el.manual.disabled = st.busy;
    el.manual.hidden = !!w;
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      fr.readAsDataURL(file);
    });
  }

  /** 캡처한 화면은 이름 없이("image.png") 온다. 무엇인지 보이게 문서 이름과 날짜를 붙인다. */
  /**
   * 캡처한 화면은 이름 없이("image.png") 온다. 무엇인지 보이게 문서 이름과 날짜를 붙인다. 이름은 초안 안에서 겹치지 않게 한다 —
   * 읽기가 파일 이름으로 문서 종류(견적서·교육 내용)를 짚어 돌려준다(input.yaml gongmun 의 parts).
   */
  function namedPaste(file, taken = []) {
    const base = /^image\.[a-z0-9]+$/i.test(file.name || '') ? `캡처_${today()}.${file.name.split('.').pop().toLowerCase()}` : file.name;
    let name = base;
    for (let i = 2; taken.includes(name); i++) name = base.replace(/(\.[^.]+)?$/, (ext) => `_${i}${ext}`);
    if (name === file.name) return file;
    // file.constructor 는 그 파일이 온 창의 File 이다 — 다른 창(검사 환경)의 File 로 싸면 FileReader 가 읽지 못한다.
    return new file.constructor([file], name, { type: file.type });
  }

  /** 읽을 곳을 정한다 — 쓰던 과제가 아직 있으면 그것, 아니면 마지막에 고른 과제, 과제가 하나뿐이면 그것. */
  function defaultProject(prev) {
    const list = choices();
    const has = (name) => !!name && list.some((p) => p.name === name);
    if (has(prev?.project)) return prev.project;
    if (has(st.lastProject)) return st.lastProject;
    return list.length === 1 ? list[0].name : '';
  }

  /** 읽기에 보내는 파일인가 — 웹페이지 캡처의 뒷장(자리가 모자라 첨부에만 넣는 장)은 보내지 않는다. */
  const readable = (f) => !f.attachOnly;

  /** 넣은 파일을 한 줄로 — 웹페이지 캡처의 장들은 묶어 "화면캡처_inflearn.com_2026-10-08 7장" 으로 적는다. */
  function filesLine(files) {
    const out = [];
    const seen = new Set();
    for (const f of files) {
      if (!f.group) {
        out.push(f.name);
        continue;
      }
      if (seen.has(f.group)) continue;
      seen.add(f.group);
      const n = files.filter((x) => x.group === f.group).length;
      out.push(n > 1 ? `${f.name.replace(/_\d+(\.[^.]+)?$/, '')} ${n}장` : f.name);
    }
    return out.join(', ');
  }

  /**
   * 문서를 읽어 초안을 만든다. 파일(그림·PDF)은 다섯 장까지 같은 건의 문서들로 보고 한 번에 읽는다.
   * 이미 읽은 초안에 더 넣으면 앞서 넣은 것과 **함께 다시 읽는다** — 교육 견적서 뒤에 교육 내용 캡처를 넣는 것이다(2026-10-07 사용자 지정).
   * 넣은 파일은 모두 첨부가 된다(문서 종류마다 한 줄 — src/gongmun.js 의 attachList). 다시 읽어도 사용자가 고친 칸은 그대로 둔다.
   * 읽는 사이에 갈래를 바꿨어도 읽기를 시작한 갈래에 담는다.
   *
   * capture 는 웹페이지를 통째로 캡처한 장들을 넣을 때다(captureTab) — 장 수가 정해져 오지 않으니 읽기에는 남은 자리만큼만 보내고
   * 나머지 장은 첨부(PDF)에만 넣는다(attachOnly). 탭을 여럿 찍었으면 탭마다 첫 장부터 돌아가며 자리를 나눈다(readSlots).
   * 한 탭의 장들은 한 묶음(group)이라 읽기가 가린 종류를 뒷장도 이어 받는다(spreadParts). 화면 글자(text)는 붙여 넣은 글과 같은 자리로 간다.
   * @param {{files?: File[], text?: string, capture?: {groups: string[], counts: number[], notes?: string[]}|null}} input
   *   capture.groups 는 장마다 묶음, counts 는 탭마다 장 수(찍은 차례), notes 는 읽은 내용에 덧붙일 말(너무 길어 잘린 페이지·못 찍은 탭)
   */
  async function intake({ files = [], text = '', capture = null }) {
    const kind = st.kind;
    const k = KINDS[kind];
    if (st.busy) return;
    const prev = st.work[kind] || null;
    const kept = prev?.files || [];
    const room = Math.max(MAX_FILES - kept.filter(readable).length, 0);
    if (files.length && room <= 0 && !capture) return setStatus(`파일은 ${MAX_FILES}장까지 넣습니다 — 새로 시작하려면 읽은 내용의 비우기를 누르세요.`, 'error');
    const slots = capture ? readSlots(capture.counts, room) : [];
    const picked = [];
    for (const [i, f] of (capture ? files : files.slice(0, room)).entries()) {
      if (!/^image\//.test(f.type) && f.type !== 'application/pdf') return setStatus(`그림·PDF 만 읽습니다 — ${f.name}`, 'error');
      if (f.size > FILE_LIMIT) return setStatus(`파일이 너무 큽니다(${Math.round(f.size / 1048576)}MB) — 10MB 이하로 넣어 주세요.`, 'error');
      try {
        const named = namedPaste(f, [...kept, ...picked].map((x) => x.name));
        picked.push({
          name: named.name, type: f.type, size: f.size, dataUrl: await readFile(named),
          ...(capture ? { group: capture.groups[i], attachOnly: !slots[i] } : {}),
        });
      } catch (err) {
        return setStatus(err.message, 'error');
      }
    }
    if (!picked.length && !text.trim()) return undefined;
    const all = [...kept, ...picked];
    const toRead = all.filter(readable);
    const allText = [prev?.text || '', text].filter((s) => s.trim()).join('\n\n');
    const held = picked.filter((f) => f.attachOnly).length;
    // 탭을 여럿 찍었으면 읽는 장은 탭마다 앞쪽에서 고른다(readSlots) — "앞 n장" 이 아니다.
    const front = capture?.counts?.length > 1 ? '페이지마다 앞쪽부터 ' : '앞 ';
    const extra = capture
      ? (held ? ` · 캡처 ${picked.length}장 가운데 ${front}${picked.length - held}장과 화면 글자를 읽고, 나머지는 첨부에만 넣습니다` : ' · 화면 글자도 함께 읽습니다')
      : files.length > room ? ` · ${MAX_FILES}장까지만 넣습니다` : '';
    st.busy = true;
    revealEvidence();
    paintView();
    paintIntake();
    setStatus(`${kept.length || prev?.text ? '앞서 넣은 것과 함께 다시 ' : ''}읽는 중입니다${toRead.length > 1 ? `(${toRead.length}장)` : ''}…${extra}`);
    const { apiKey, cli } = ai();
    let done = false;
    try {
      const got = await gongmunSmart({ files: toRead, text: allText }, { kind, today: today() }, { apiKey, useNative: cli });
      const rec = { ...got.record, parts: spreadParts(got.record.parts, all) };
      if (rec.docType === 'unknown') throw new Error(`품의에 넣을 문서로 보이지 않습니다 — ${rec.summary}`);
      // 구매 — 쇼핑몰 화면이면 읽기가 짚은 가격과 그 둘레(quoteArea)를 오려 견적서 한 장으로 첨부한다(src/quotecut.js, 2026-10-08 사용자 지정).
      // 교육도 온라인 강의 페이지면 수강료 칸을 오려 교육 견적서로 첨부하고, 강의 소개·커리큘럼 장은 교육 내용으로 남긴다(같은 날 사용자 지정).
      // 앞서 원래 장으로 되돌려 두었으면 더 넣어 다시 읽어도 그대로 둔다.
      const cutNotes = [];
      const cut = CUT_KINDS.has(kind)
        ? await makeCut(all, cutBoxes(rec.quoteArea, all, rec.parts), { kind, parts: rec.parts, on: prev?.cut?.on ?? true, notes: cutNotes }) : null;
      const { draft: fresh, notes } = fromRecord(kind, rec, { me: me(), files: all.map((f) => f.name), cut });
      notes.push(...cutNotes);
      if (kind === 'purchase' && rec.docType === 'course') notes.push('교육 안내문으로 보입니다 — 교육 품의라면 교육 갈래에 다시 넣어 주세요');
      if (capture?.notes) notes.push(...capture.notes);
      if (held) notes.push(`캡처 ${picked.length}장 가운데 ${front}${picked.length - held}장만 읽었습니다 — 나머지 ${held}장은 첨부 PDF 에만 들어갑니다`);
      if (got.note) notes.push(got.note);
      // 읽은 문서의 머리 — 문서 종류(레시피 reading.yaml 의 docType names) · 누구의 것(attach_rules.yaml 의 who — 구매처·교육기관·출장지·요청 기관) · 견적일.
      const what = [DOC_NAMES[rec.docType] || '문서', whoOf(kind, fresh), fresh.quoteDate].filter(Boolean).join(' · ');
      const touched = prev?.touched || [];
      st.work[kind] = {
        draft: prev ? mergeDraft(prev.draft, fresh, touched) : fresh, notes, touched, project: defaultProject(prev),
        title: prev?.title ?? null, body: prev?.body ?? null, files: all, text: allText, parts: rec.parts, cut,
        source: { label: what, from: all.length ? filesLine(all) : '붙여 넣은 글', via: got.via, summary: rec.summary },
      };
      saveWork();
      done = true;
      logEvent('gongmun', true, `${k.title} 문서 읽음 · ${rec.summary} · ${all.length}장 · ${VIA_LABEL[got.via] || got.via}`);
      setStatus(`읽었습니다(${VIA_LABEL[got.via] || got.via}) — ${rec.summary}`);
    } catch (err) {
      setStatus(err.message, 'error');
      logEvent('gongmun', false, `${k.title} 문서 읽기 실패 · ${err.message}`);
    } finally {
      st.busy = false;
      if (kind === st.kind) {
        renderFields();
        paintDraft({ fold: done, reveal: done });
      }
      paintIntake();
    }
    // 과제를 이미 골랐고 사유가 비어 있으면 과제 내용으로 사유를 쓴다.
    if (done) writeReason(kind, { auto: true });
    return undefined;
  }

  /**
   * 견적서를 오린다(구매·교육 — src/quotecut.js) — 칸(cutBoxes 가 고른 것)이 없으면 null. 못 오리면 notes 에 까닭을 적고 null 이다(넣은 장 그대로 첨부).
   * name 은 첨부 목록에 쓰는 오린 그림의 이름, drop 은 첨부에서 빠지는 장(오려 낸 화면과 같은 묶음), on 은 오린 것을 첨부하는가(원래 장으로면 false).
   * @returns {Promise<{name: string, file: object, boxes: object[], drop: string[], pad: number, on: boolean}|null>}
   */
  async function makeCut(files, boxes, { kind = 'purchase', parts = [], pad = CUT_PAD, on = true, notes = [] } = {}) {
    if (!boxes.length) return null;
    try {
      const blob = await cutQuote(files, boxes, { pad });
      const name = cutName(today(), files.map((f) => f.name));
      return { name, file: { name, type: 'image/png', size: blob.size, dataUrl: await readFile(blob) }, boxes, drop: cutDrop(boxes, files, parts, kind), pad, on };
    } catch (err) {
      notes.push(`견적서 부분을 오리지 못했습니다 — 넣은 장 그대로 첨부합니다(${err.message})`);
      return null;
    }
  }

  /** 캡처 단추를 눌렀을 때(webpick.js) — 보고 있는 탭이면 통째로, 부분이면 페이지 위에서 고르게 한다(고르는 중에 다시 누르면 그만둔다). */
  function onCaptureClick(e) {
    const r = pick.click(e);
    if (r) captureTab(r.act);
  }

  /**
   * 웹페이지를 캡처해 읽는다(2026-10-08 사용자 지정) — 교육 안내 페이지를 조각조각 캡처해 붙여 넣지 않아도 된다. act 는 단추다:
   * 'tab' 은 보고 있는 탭을 통째로, 'part' 는 페이지 위에서 프레임(틀·상자)을 하나 이상 골라 그것만("탭이 아니라 프레임으로 선택").
   * 찍는 일은 src/pagecap.js 가 한다(사이트 접근 권한 묻기 → 한 화면씩 찍기 → A4 장으로 자르기 → 화면 글자). 여기서는 그 장들과 글자를
   * 문서 넣기와 같은 길(intake)로 읽힌다 — 페이지(고른 부분)마다 한 묶음이고, 읽은 뒤 첨부 PDF 저장을 누르면 그 장들이 문서(교육 내용 등)마다
   * PDF 하나가 된다. 고르는 동안은 잠그지 않는다 — 찍기 시작할 때(onStart) 잠근다.
   */
  async function captureTab(act) {
    if (st.busy || st.capturing) return;
    let got = null;
    try {
      got = await pick.shoot(act, {
        key: PICK_KEY, today: today(),
        onStatus: (text) => { setStatus(text); paintIntake(); },
        onStart: () => { st.capturing = true; paintIntake(); },
      });
      if (got) logEvent('gongmun', true, `웹페이지 캡처 · ${got.what}`);
    } catch (err) {
      setStatus(err.message, 'error');
      logEvent('gongmun', false, `웹페이지 캡처 실패 · ${err.message}`);
    } finally {
      st.capturing = false;
      paintIntake();
    }
    if (!got) return;
    const { pages, notes } = got;
    const id = `cap${Date.now()}`;
    return intake({
      files: pages.flatMap((p) => p.files),
      text: pages.map((p) => p.text).filter(Boolean).join('\n\n'),
      capture: { groups: pages.flatMap((p, i) => p.files.map(() => `${id}_${i}`)), counts: pages.map((p) => p.files.length), notes },
    });
  }

  /**
   * 과제의 연구 내용(R&D 탭의 연구개발 계획·진행 기록 — src/gongmun.js 의 rndProjects. 공문 설정의 과제면 거기 적은 과제 내용)으로
   * 사유(구매사유·교육사유)와 용도(교육목적)를 쓴다(2026-10-07 사용자 지정, 2026-10-08 R&D 탭의 과제로). auto 는 저절로 부른 것이다 — 과제를
   * 골랐고 사유가 비어 있고 Claude 에 닿을 때만 쓴다. 단추로 부르면 있던 사유를 고쳐 쓴다. ask 는 에이전트 칸에 적은 말이다 — 그 말대로 고쳐 쓰고
   * 답 한 줄(reply)을 돌려준다.
   * @returns {Promise<{reply: string, error?: string}|null>} 쓰지 않았으면(바쁨·초안 없음·auto 의 조건·그 사이 초안이 바뀜) null
   */
  async function writeReason(kind = st.kind, { auto = false, ask = '' } = {}) {
    const w = st.work[kind];
    if (!w || !REASON_KEYS[kind] || st.reasonBusy) return null;
    const project = projectOf(w);
    if (auto && (!project || String(w.draft[REASON_KEYS[kind].reason] || '').trim() || !st.ready)) return null;
    const { apiKey, cli } = ai();
    const basis = project?.rnd ? '연구 내용' : '과제 내용';
    st.reasonBusy = true;
    paintReasonBtn();
    paintAgent();
    setStatus(ask ? '에이전트가 용도·사유를 고쳐 쓰는 중입니다…' : `${project ? `「${project.name}」 ${basis}으로 ` : ''}사유를 쓰는 중입니다…`);
    try {
      const got = await gongmunReasonSmart(kind, w.draft, project, { apiKey, useNative: cli }, { ask });
      if (st.work[kind] !== w) return null;
      w.draft = applyReason(kind, w.draft, got.data, { touched: w.touched || [], asked: !!ask });
      saveWork();
      if (st.kind === kind) {
        for (const key of Object.values(REASON_KEYS[kind])) syncField(key);
        paintLive();
      }
      const hint = project?.content ? ''
        : project?.rnd ? ' R&D 탭에 연구개발 계획(계획서 YAML)이나 진행 기록을 넣어 두면 과제에 더 맞게 씁니다.' : ' 공문 설정에서 과제 내용을 넣어 두면 과제에 더 맞게 씁니다.';
      setStatus(`${ask ? '고쳐 썼습니다' : '사유를 썼습니다'}(${VIA_LABEL[got.via] || got.via}) — 칸에서 고칠 수 있습니다.${hint}`);
      logEvent('gongmun', true, `${KINDS[kind].title} 사유 ${ask ? '고쳐 쓰기' : '작성'} · ${project?.name || '과제 없음'} · ${VIA_LABEL[got.via] || got.via}`);
      return { reply: String(got.data.reply || '').trim() };
    } catch (err) {
      if (!auto || st.ready) setStatus(err.message, 'error');
      logEvent('gongmun', false, `${KINDS[kind].title} 사유 작성 실패 · ${err.message}`);
      return { reply: '', error: err.message };
    } finally {
      st.reasonBusy = false;
      paintReasonBtn();
      paintAgent();
    }
  }

  /** 칸 하나를 초안 값으로 — 쓰고 있는 칸은 건드리지 않는다. 펼친 칸이든 접힌 칸이든. */
  function syncField(key) {
    const node = el.root.querySelector(`[data-key="${key}"]`);
    const w = cur();
    if (node && w && document.activeElement !== node) node.value = w.draft[key] ?? '';
  }

  function paintReasonBtn() {
    const btn = el.fields.querySelector('[data-act="reason"]');
    if (!btn) return;
    const p = projectOf(cur());
    btn.disabled = st.reasonBusy || !p;
    btn.textContent = st.reasonBusy ? '쓰는 중…' : p?.rnd ? '연구 내용으로 쓰기' : '과제 내용으로 쓰기';
    btn.title = !p ? '과제를 먼저 고르세요'
      : p.rnd ? '고른 과제의 연구 내용(R&D 탭의 연구개발 계획·진행 기록)을 근거로 사유를 다시 씁니다' : '고른 과제의 내용(공문 설정)을 근거로 사유를 다시 씁니다';
  }

  /* ---------------------------------------------------------- 에이전트 칸 */

  /** 에이전트 칸 — 초안마다의 주고받은 말(w.agent)과 보내기 단추. */
  function paintAgent() {
    const w = cur();
    el.agent.classList.toggle('hidden', !w || !REASON_KEYS[st.kind]);
    el.agentGo.disabled = st.reasonBusy;
    el.agentLog.innerHTML = (w?.agent || []).map((m) => `<li class="gm-say ${m.who}${m.error ? ' error' : ''}">${escapeHtml(m.text)}</li>`).join('');
  }

  function growAgent() {
    el.agentInput.style.height = 'auto';
    el.agentInput.style.height = `${Math.min(el.agentInput.scrollHeight + 2, 160)}px`;
  }

  /**
   * 에이전트 칸에 적은 말대로 고른 과제의 연구 내용(R&D 탭)을 보고 용도·사유를 고쳐 쓴다(2026-10-08 사용자 지정: "에이전트 기능을 이용해서
   * 대상 rnd 의 연구 내용을 보고 자동으로 입력 … 채팅 기능을 사용할 수 있게"). 쓰는 길은 writeReason(gongmunReasonSmart — 로컬 CLI·API 키)과 같고,
   * 답 한 줄을 칸 아래에 남긴다(초안마다 CHAT_KEEP 개).
   */
  async function runAgent() {
    const kind = st.kind;
    const w = cur();
    const text = el.agentInput.value.trim();
    if (!text || !w || !REASON_KEYS[kind] || st.reasonBusy) return;
    const answer = { who: 'ai', text: '고쳐 쓰는 중...' };
    w.agent = [...(w.agent || []), { who: 'me', text: text.length > 160 ? `${text.slice(0, 160)}…` : text }, answer];
    el.agentInput.value = '';
    growAgent();
    paintAgent();
    const got = await writeReason(kind, { ask: text });
    if (!got) answer.text = '그 사이 초안이 바뀌어 넣지 않았습니다.';
    else if (got.error) Object.assign(answer, { text: got.error, error: true });
    else answer.text = got.reply || '용도·사유를 고쳐 썼습니다.';
    w.agent = w.agent.slice(-CHAT_KEEP);
    saveWork();
    if (st.kind === kind) paintAgent();
  }

  function onAgentKey(e) {
    // 한글은 조합 중에 Enter 가 한 번 더 온다 — 조합이 끝난 Enter 만 받는다. Shift+Enter 는 줄바꿈이다.
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    runAgent();
  }

  /** 문서 없이 쓴다 — Claude 가 없거나 문서가 없을 때. 읽은 칸(품목·합계…)이 비어 있으니 읽은 내용 탭이 열린다(비교작성이면 그대로 오른쪽에). */
  function startManual() {
    if (cur()) return;
    st.view = { ...st.view, tab: 'draft', evidenceOpen: true, workspaceOpen: true };
    saveView();
    st.work[st.kind] = {
      draft: blankDraft(st.kind, { me: me() }), notes: [], touched: [], project: defaultProject(null), title: null, body: null, files: [],
      text: '', source: { label: '직접 입력', from: '', via: '', summary: '' },
    };
    saveWork();
    renderFields();
    paintDraft({ fold: true });
    paintIntake();
    (!el.readView.hidden && foldedNeeds(cur()) ? el.moreFields : el.fields).querySelector('input, textarea')?.focus();
  }

  function resetWork() {
    delete st.work[st.kind];
    delete st.blocked[st.kind];
    st.view = { ...st.view, tab: 'draft', evidenceOpen: true, workspaceOpen: true };
    saveView();
    saveWork();
    setStatus('');
    renderFields();
    paintDraft();
    paintIntake();
  }

  const hasFiles = (e) => !!e.dataTransfer?.types?.includes('Files');

  /**
   * 파일을 탭 위로 끌고 왔을 때. 근태 패널이 창에 걸어 둔 가드(엉뚱한 곳에 놓으면 막는다)까지 가지 않게 여기서 멈춘다 —
   * 이 탭은 어디에 놓아도 문서 넣는 곳으로 받는다.
   */
  function onDrag(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    // 비교작성 탭은 문서를 읽지 않는다(읽은 파일은 사이드패널에만 있다) — 놓아도 받지 않는다.
    const can = !st.busy && !st.compareTab;
    e.dataTransfer.dropEffect = can ? 'copy' : 'none';
    if (e.type === 'dragleave') {
      if (!el.root.contains(e.relatedTarget)) el.intake.classList.remove('over');
      return;
    }
    el.intake.classList.toggle('over', can);
  }

  function onDrop(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    el.intake.classList.remove('over');
    if (st.compareTab) return;
    intake({ files: [...e.dataTransfer.files] });
  }

  /**
   * 붙여넣기(Ctrl+V). 탭이 보일 때 클립보드에 파일(캡처한 화면·복사한 파일)이 있으면 읽는다. 글은 글 칸 밖에서 붙여 넣었을 때만
   * 문서로 읽는다(쇼핑몰 화면의 글을 복사해 온 것) — 칸 안의 붙여넣기는 그대로 간다.
   */
  function onPaste(e) {
    if (el.root.classList.contains('hidden') || st.compareTab) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      intake({ files });
      return;
    }
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]');
    const text = typing ? '' : (e.clipboardData?.getData('text/plain') || '').trim();
    if (!text) return;
    e.preventDefault();
    intake({ text });
  }

  /* ---------------------------------------------------------- 초안 */

  /**
   * 작업 카드의 읽은 내용 탭(출처·오린 견적서·품목·읽은 칸)과 작성 내용 탭(과제·용도·사유·에이전트·결재선)을 함께 그린다.
   * fold 는 새 초안을 그릴 때다 — 읽은 칸에 채울 것이 남았거나(문서 없이 쓰기·합계를 못 읽음) 한도에 걸렸으면 읽은 내용 탭을 열고
   * (비교작성이면 이미 오른쪽에 있다), 아니면 작성 내용 탭으로 간다. 오린 견적서의 단추처럼 탭 안에서 다시 그릴 때는 그대로 둔다.
   * reveal 은 문서를 읽은 뒤다 — 읽은 내용 탭을 열었으면 접힌 몸통을 편다.
   */
  function paintDraft({ fold = false, reveal = false } = {}) {
    const w = cur();
    const show = !!w;
    el.draft.classList.toggle('hidden', !show);
    el.readView.classList.toggle('hidden', !show);
    el.reset.hidden = !show;
    // 비교작성 탭에 초안이 없으면(아직 안 읽었거나 사이드패널에서 비움) 어디서 넣는지 말한다.
    if (st.compareTab && (!show || el.status.textContent === NO_DRAFT_TAB)) setStatus(show ? '' : NO_DRAFT_TAB);
    if (!show) {
      el.doc.classList.add('hidden');
      paintView();
      paintCut();
      paintAgent();
      paintProjects();
      return;
    }
    paintSource();
    const items = st.kind === 'purchase' ? w.draft.items || [] : [];
    el.items.innerHTML = items.map((it) => {
      const meta = [it.spec, it.qty != null ? `${it.qty.toLocaleString('ko-KR')}${it.unit || ''}` : '', won(it.amount)].filter(Boolean).join(' · ');
      return `<li><span class="gm-item-name">${escapeHtml(it.name)}</span>${meta ? `<span class="gm-item-meta">${escapeHtml(meta)}</span>` : ''}</li>`;
    }).join('');
    if (fold) {
      st.blocked[st.kind] = false;   // 새 초안 — 한도에 걸려 있으면 paintLive 가 다시 읽은 내용 탭으로 간다
      if (foldedNeeds(w)) showRead();
      else if (st.view.tab === 'read') st.view.tab = 'draft';
      saveView();
    }
    if (reveal && st.view.tab === 'read') st.view.workspaceOpen = true;
    paintProjects();
    paintAgent();
    paintLive();
  }

  /** 읽은 문서의 줄 — 무엇을 읽었는지·첨부가 될 문서·알림, 접힌 머리의 한 줄, 오린 견적서. 첨부가 바뀌면(오린 견적서의 단추) 이것만 다시 그린다. */
  function paintSource() {
    const w = cur();
    if (!w) return;
    const src = w.source || {};
    const head = [src.label, src.from && src.from !== src.label ? src.from : '', VIA_LABEL[src.via] ? `${VIA_LABEL[src.via]}로 읽음` : '']
      .filter(Boolean).map(escapeHtml).join(' · ');
    // 첨부가 될 문서 — 문서 종류마다 한 줄(교육이면 교육 견적서·교육 내용, 오린 견적서면 견적서·강의 내용).
    const attach = (w.draft.attach || []).filter((a) => a.files?.length)
      .map((a) => `${a.label}${a.files.length > 1 ? ` ${a.files.length}장` : ''}`).join(' · ');
    el.source.innerHTML = `<span>${head}</span>${attach ? `<span class="gm-attach">첨부 · ${escapeHtml(attach)}</span>` : ''}`
      + (w.notes || []).map((n) => `<span class="gm-note">${escapeHtml(n)}</span>`).join('');
    el.viewRead.title = [src.label, attach ? `첨부 ${attach}` : ''].filter(Boolean).join(' · ') || '읽은 문서의 칸·품목·첨부';
    paintCut();
  }

  /**
   * 읽은 칸(접힌 칸)에 채울 것이 남았는가 — 한도에 걸렸거나 품목·합계(교육이면 교육명·교육기간·교육비)가 비었다. 접힌 칸의 이름은 needs(src/gongmun.js)가
   * 부르는 이름 — 레시피 purpose.yaml 의 need 다. 그것이 남았으면 읽은 문서 칸을 펴 둔다.
   */
  function foldedNeeds(w) {
    const lim = overLimit(st.kind, w.draft);
    const folded = new Set((FIELDS[st.kind] || []).filter((f) => !f.open).map((f) => f.need).filter(Boolean));
    return lim.over || lim.unknown || needs(st.kind, w.draft, { preset: st.preset, project: projectOf(w), projects: choices(), rank: w.rank || '', setting: w.setting || {} }).some((n) => folded.has(n));
  }

  /**
   * 오린 견적서(구매·교육) — 오린 그림과 어디서 오렸는지. 가격·상품명이 잘렸으면 더 넓게(둘레를 더 넣어 다시 오린다), 마땅치 않으면 원래 장으로
   * (넣은 장 그대로 첨부 — 그러면 가격 부분만으로 돌아가는 단추가 선다).
   */
  function paintCut() {
    const c = CUT_KINDS.has(st.kind) ? cur()?.cut : null;
    el.cut.classList.toggle('hidden', !c);
    stashCut();
    if (!c) {
      el.cut.innerHTML = '';
      return;
    }
    const from = [...new Set(c.boxes.map((b) => b.file))].join(', ');
    const doc = escapeHtml(KINDS[st.kind].doc);
    el.cut.innerHTML = c.on
      ? `<div class="gm-cut-head"><strong>${doc}</strong><span>가격과 그 둘레를 오렸습니다 — ${escapeHtml(from)}</span></div>`
        + `<img src="${escapeHtml(c.file.dataUrl)}" alt="오린 견적서 — 가격과 그 둘레" />`
        + '<div class="gm-cut-acts">'
        + `<button type="button" class="ghost small" data-cut="wide" title="가격이나 상품명이 잘렸으면 둘레를 더 넣어 다시 오립니다"${c.pad >= MAX_PAD ? ' disabled' : ''}>더 넓게</button>`
        + '<button type="button" class="ghost small" data-cut="off" title="오리지 않고 넣은 장 그대로 첨부합니다">원래 장으로</button></div>'
      : `<div class="gm-cut-head"><strong>${doc}</strong><span>넣은 장 그대로 첨부합니다</span></div>`
        + `<div class="gm-cut-acts"><button type="button" class="ghost small" data-cut="on" title="가격과 그 둘레만 오린 그림을 ${doc}로 첨부합니다">가격 부분만 첨부</button></div>`;
  }

  /** 오린 견적서의 단추 — 더 넓게·원래 장으로·가격 부분만 첨부. 첨부 목록(본문 ※ 첨부·PDF)이 따라 바뀐다. */
  async function onCutClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-cut]') : null;
    const kind = st.kind;
    const w = cur();
    // 비교작성 탭은 읽은 장(w.files)이 없어 다시 오리지 못한다 — 단추는 숨겨 두었다(sidepanel.css).
    if (!btn || btn.disabled || !w?.cut || st.compareTab) return;
    if (btn.dataset.cut === 'wide') {
      btn.disabled = true;
      const notes = [];
      const next = await makeCut(w.files || [], w.cut.boxes, { kind, parts: w.parts, pad: Math.min(w.cut.pad + PAD_STEP, MAX_PAD), notes });
      if (st.work[kind] !== w) return;   // 그 사이 비웠거나 다시 읽었다
      if (!next) {
        btn.disabled = false;
        setStatus(notes[0], 'error');
        return;
      }
      w.cut = next;
    } else {
      w.cut.on = btn.dataset.cut === 'on';
    }
    w.draft.attach = attachWithCut(kind, w.parts, (w.files || []).map((f) => f.name), w.cut);
    saveWork();
    if (st.kind === kind) {
      paintSource();
      paintLive();
      paintIntake();   // 교육 견적서가 빠지면 넣는 곳의 말이 그것을 넣으라고 한다(moreLead)
    }
  }

  const NO_PROJECT = '<p class="gm-noproj">과제가 없습니다. <button type="button" class="ghost small" data-act="rnd">R&amp;D 탭에서 과제 더하기</button></p>';

  /**
   * 과제 칩 — R&D 탭의 과제(없으면 공문 설정의 과제). 구매·교육·출장은 갈래 아래의 과제 줄(PICK_FIRST — 별칭 칩)에서, 외부활동은 작성 내용 탭
   * 안의 목록(과제명과 별칭·책임자)에서 고른다. 초안이 없을 때도 그린다 — 과제 줄은 문서를 넣기 전에 고른다.
   */
  function paintProjects() {
    const first = PICK_FIRST.includes(st.kind);
    el.projBar.classList.toggle('hidden', !first);
    el.projLabel.classList.toggle('hidden', first);
    el.projects.classList.toggle('hidden', first);
    paintProjInfo();
    if (first) paintPick();
    else paintProjList();
  }

  /**
   * 갈래 아래의 과제 줄 — 칩은 R&D 탭처럼 별칭(없으면 과제명)이고 과제명·과제번호·책임자는 툴팁이다. 초안이 있으면 그 초안의 과제, 없으면 넣을 문서가
   * 시작할 과제(defaultProject — 마지막에 고른 과제, 과제가 하나뿐이면 그것)가 켜진다. 아무것도 켜지지 않았으면 머리말이 고르라고 한다.
   */
  function paintPick() {
    const w = cur();
    const list = choices();
    const picked = w ? w.project : defaultProject(null);
    const on = list.some((p) => p.name === picked);
    el.projBar.classList.toggle('need', !!list.length && !on);
    el.projBar.querySelector('.gm-projbar-label').textContent = list.length && !on ? '과제 선택' : '연결 과제';
    el.pick.innerHTML = list.length ? list.map((p, i) => {
      const active = p.name === picked;
      const tip = [p.name, p.code, p.lead ? `책임자 ${p.lead}` : ''].filter(Boolean).join(' · ');
      return `<button type="button" class="gm-pick${active ? ' active' : ''}" role="radio" aria-checked="${active}" data-proj="${i}" title="${escapeHtml(tip)}">`
        + `${escapeHtml(p.alias || p.name)}</button>`;
    }).join('') : NO_PROJECT;
  }

  /** 작성 내용 탭 안의 과제 목록(외부활동) — 과제명과 별명·책임자. */
  function paintProjList() {
    const w = cur();
    const list = choices();
    if (!list.length) {
      el.projects.innerHTML = NO_PROJECT;
      return;
    }
    el.projects.innerHTML = list.map((p, i) => {
      const on = w?.project === p.name;
      const tip = [p.name, p.alias ? `별명 ${p.alias}` : '', p.code, p.lead ? `책임자 ${p.lead}` : ''].filter(Boolean).join(' · ');
      const meta = [p.alias ? `별명 ${p.alias}` : '', p.lead ? `책임 ${p.lead}` : ''].filter(Boolean).join(' · ');
      return `<button type="button" class="gm-proj${on ? ' active' : ''}" role="radio" aria-checked="${on}" data-proj="${i}" title="${escapeHtml(tip)}">`
        + `<span class="gm-proj-name">${escapeHtml(p.name)}</span>${meta ? `<span class="gm-proj-lead">${escapeHtml(meta)}</span>` : ''}</button>`;
    }).join('');
  }

  /**
   * 고른 과제의 기본 내용 — 별명(제목)·과제번호·연구기간(과제 개요)·책임자(합의자)·내용(사유의 근거)이 들어 있는지 한 줄로 보인다(2026-10-07 사용자 지정
   * "과제 기본 내용을 넣을 수 있는 칸"). 빈 것은 흐리게 적는다. R&D 탭의 과제면 내용은 연구 내용(연구개발 계획 n차년도·진행 기록 n건)이고
   * 단추는 R&D 탭으로 간다. 공문 설정의 과제면 고치기는 공문 설정의 그 과제 줄로 간다.
   */
  function paintProjInfo() {
    const p = projectOf(cur());
    el.projInfo.classList.toggle('hidden', !p);
    if (!p) {
      el.projInfo.innerHTML = '';
      return;
    }
    const bit = (label, value, empty) => (value ? `<span>${label} <b>${escapeHtml(value)}</b></span>` : `<span class="gm-miss">${empty}</span>`);
    const research = p.rnd
      ? bit('연구 내용', [p.rnd.plan ? `연구개발 계획 ${p.rnd.plan}차년도` : '', p.rnd.logs ? `진행 기록 ${p.rnd.logs}건` : ''].filter(Boolean).join(' · ') || (p.content ? `${p.content.length.toLocaleString('ko-KR')}자` : ''),
        '연구 내용 없음 — R&D 탭에 계획서 YAML·진행 기록을 넣으면 사유가 과제에 맞게 써집니다')
      : bit('내용', p.content ? `${p.content.length.toLocaleString('ko-KR')}자` : '', '과제 내용 없음 — 사유가 일반적으로 써집니다');
    el.projInfo.innerHTML = '<strong>과제 기본 내용</strong>'
      + [bit('별명', p.alias, '별명 없음 — 제목에 과제명이 들어갑니다'), bit('번호', p.code, '번호 없음'), bit('기간', p.period, '연구기간 없음'),
        bit('책임자', p.lead, '책임자 없음 — 합의자가 빕니다'), research].join('')
      + (p.rnd ? '<button type="button" class="ghost small" data-act="rnd">R&amp;D 탭</button>'
        : `<button type="button" class="ghost small" data-act="preset" data-name="${escapeHtml(p.name)}">고치기</button>`);
  }

  function onProjectClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-proj], [data-act="preset"], [data-act="rnd"]') : null;
    if (!btn) return;
    if (btn.dataset.act === 'preset') {
      openPreset(btn.dataset.name || '');
      return;
    }
    // R&D 탭으로 — 과제를 더하거나 연구 내용(계획서 YAML·진행 기록)을 넣는다. 돌아오면 다시 읽는다(show).
    if (btn.dataset.act === 'rnd') {
      $('tabRnd')?.click();
      return;
    }
    const w = cur();
    const p = choices()[+btn.dataset.proj];
    if (!p) return;
    const first = PICK_FIRST.includes(st.kind);
    // 문서를 넣기 전에 과제 줄에서 고른다 — 다음에 넣는 문서(문서 없이 쓰기도)가 이 과제로 시작한다(defaultProject).
    if (!w) {
      if (!first) return;
      st.lastProject = p.name;
      saveWork();
      paintProjects();
      return;
    }
    // 과제 줄은 하나를 고르는 곳이라 켜진 칩을 다시 눌러도 그대로다. 카드 안의 목록(외부활동)은 다시 누르면 고른 것을 푼다.
    const next = first || w.project !== p.name ? p.name : '';
    if (next === w.project) return;
    w.project = next;
    if (w.project) st.lastProject = w.project;
    saveWork();
    paintProjects();
    paintLive();
    paintReasonBtn();
    // 사유가 비어 있으면 고른 과제의 연구 내용으로 쓴다.
    if (w.project) writeReason(st.kind, { auto: true });
  }

  /** 칸 하나. 사유 칸에는 연구 내용(과제 내용)으로 쓰는 단추를 붙인다(2026-10-07 사용자 지정). */
  function fieldHtml(f, w) {
    const id = `gmF_${f.key}`;
    const raw = w.draft[f.key];
    const value = f.type === 'money' ? (moneyOf(raw) != null ? moneyOf(raw).toLocaleString('ko-KR') : '') : (raw ?? '');
    const ph = f.placeholder || '';
    const input = f.type === 'choice'
      ? `<select id="${id}" data-key="${f.key}">${f.options.map((o) => `<option${o === value ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`
      : f.area
        ? `<textarea id="${id}" data-key="${f.key}" rows="2" placeholder="${escapeHtml(ph)}">${escapeHtml(value)}</textarea>`
        : `<input id="${id}" data-key="${f.key}" type="${f.type === 'date' ? 'date' : 'text'}"${f.type === 'money' ? ' inputmode="numeric"' : ''}`
          + ` value="${escapeHtml(value)}" placeholder="${escapeHtml(ph)}" autocomplete="off" />`;
    const act = REASON_KEYS[st.kind]?.reason === f.key ? '<button type="button" class="ghost small gm-reason" data-act="reason">과제 내용으로 쓰기</button>' : '';
    return `<div class="gm-field${f.wide ? ' wide' : ''}" data-field="${f.key}"><div class="gm-field-head"><label for="${id}">${escapeHtml(f.label)}</label>${act}</div>${input}</div>`;
  }

  /** 초안의 칸 — 펼쳐 두는 칸(open: 용도·사유)은 위에, 나머지 읽은 칸은 접힌 읽은 문서 안에 그린다. */
  function renderFields() {
    const w = cur();
    const list = FIELDS[st.kind] || [];
    el.fields.innerHTML = w ? list.filter((f) => f.open).map((f) => fieldHtml(f, w)).join('') : '';
    el.moreFields.innerHTML = w ? list.filter((f) => !f.open).map((f) => fieldHtml(f, w)).join('') : '';
    paintReasonBtn();
  }

  function onFieldInput(e) {
    const node = e.target instanceof Element ? e.target.closest('[data-key]') : null;
    const w = cur();
    const f = node && (FIELDS[st.kind] || []).find((x) => x.key === node.dataset.key);
    if (!w || !f) return;
    if (f.key === 'gist' && w.draft.summary === summaryOf(w.draft.gist)) {
      // 요약을 손대지 않았으면 품목 요지를 따라간다.
      w.draft.summary = summaryOf(node.value);
      const s = el.moreFields.querySelector('[data-key="summary"]');
      if (s) s.value = w.draft.summary;
    }
    w.draft[f.key] = f.type === 'money' ? moneyOf(node.value) : node.value;
    if (e.type === 'change' && f.type === 'money' && moneyOf(node.value) != null) node.value = moneyOf(node.value).toLocaleString('ko-KR');
    // 교육 구분을 손대지 않았으면 교육장소·교육기관을 따라간다("온라인" 이라 적으면 제목이 온라인교육 품의가 된다).
    if ((f.key === 'place' || f.key === 'provider') && 'mode' in w.draft && !(w.touched || []).includes('mode')) {
      w.draft.mode = eduModeOf({ ...w.draft, mode: '' });
      syncField('mode');
    }
    // 사용자가 고친 칸 — 문서를 더 넣어 다시 읽어도 그대로 둔다(src/gongmun.js 의 mergeDraft).
    w.touched = [...new Set([...(w.touched || []), f.key])];
    saveWork();
    paintLive();
  }

  /** 사유 칸 옆의 "과제 내용으로 쓰기". */
  function onFieldClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-act="reason"]') : null;
    if (btn && !btn.disabled) writeReason(st.kind);
  }

  /** 칸을 고칠 때마다 바뀌는 것 — 한도, 결재선, 남은 것, 공문. */
  function paintLive() {
    const w = cur();
    if (!w) return;
    const lim = overLimit(st.kind, w.draft);
    const blocked = lim.over || lim.unknown;
    el.limit.classList.toggle('hidden', !blocked);
    el.limit.classList.toggle('warn', !lim.over);
    // 합계 칸은 읽은 내용 탭에 있다 — 새로 한도에 걸리면 그 탭을 열고(비교작성이면 오른쪽에 있다) 한도 알림이 있는 참고 문서도 편다.
    if (blocked && !st.blocked[st.kind]) {
      showRead();
      revealEvidence();
    }
    st.blocked[st.kind] = blocked;
    if (lim.over) {
      el.limit.innerHTML = `합계 <strong>${won(lim.amount)}</strong> — 부서 ${escapeHtml(KINDS[st.kind].title)}는 <strong>${manwon(lim.limit)} 이하</strong>만 작성합니다. `
        + '합계를 잘못 읽었으면 읽은 문서의 합계 칸을 고쳐 주세요.';
    } else if (lim.unknown) {
      el.limit.textContent = `합계(원)를 몰라 ${manwon(lim.limit)} 이하인지 가리지 못했습니다 — 읽은 문서의 합계 칸에 부가세 포함 금액(원)을 적어 주세요.`;
    }
    const account = el.moreFields.querySelector('[data-key="account"]');
    if (account) account.placeholder = projectOf(w)?.account || KINDS[st.kind].account;
    const p = projectOf(w);
    el.line.innerHTML = lineHtml(approvalLine(lineCtx(w)), { needLead: !!p && !String(p.lead || '').trim() });
    const left = needs(st.kind, w.draft, { preset: st.preset, project: projectOf(w), projects: choices(), rank: w.rank || '', setting: w.setting || {} });
    el.need.textContent = left.length ? `남은 것: ${left.join(' · ')}` : '';
    paintDoc(blocked);
  }

  /**
   * 결재선 한 줄. 과제책임자가 기안자 본인이 아니면 합의자다(src/gongmun.js 의 approvalLine) — 과제를 골랐는데 책임자가 비면(needLead)
   * 합의 자리를 빈 칸으로 붉게 세워 둔다(2026-10-08 사용자 지정: "과제 책임자가 본인이 아니면 과제 책임자 합의로 들어가야 함").
   */
  function lineHtml(line, { needLead = false } = {}) {
    const role = (r) => ROLE_LABEL[r] || r;
    const last = line.missing?.length ? -1 : line.steps.findLastIndex((s) => s.role === '결재');
    const steps = line.steps.map((s, i) => `<span class="gm-step"><em>${role(s.role)}</em>${escapeHtml(s.name)}${s.why ? `<small>${s.why}${i === last && line.delegation ? ' · 전결' : ''}</small>` : ''}</span>`);
    if (needLead) steps.splice(1, 0, `<span class="gm-step miss"><em>${role('합의')}</em>과제책임자를 정하세요</span>`);
    // 위임전결로 결재선에 설 직책 가운데 공문 설정에 이름이 없는 것(부서장·소장·본부장).
    for (const r of line.missing || []) steps.push(`<span class="gm-step miss"><em>${role('결재')}</em>${RANK_WHY[r] || r}을 정하세요</span>`);
    return `<span class="gm-steps">${steps.join('<span class="gm-arrow" aria-hidden="true">→</span>')}</span>`
      + (line.refs.length ? `<span class="gm-refs"><em>${role('참조')}</em>${escapeHtml(line.refs.join(', '))}</span>` : '')
      + line.notes.map((n) => `<span class="gm-note">${escapeHtml(n)}</span>`).join('');
  }

  /* ---------------------------------------------------------- 공문 */

  function paintDoc(blocked = false) {
    const w = cur();
    const show = !!w && !blocked;
    el.doc.classList.toggle('hidden', !show);
    paintView();
    if (!show) return;
    const tpl = tplOf();
    const c = compose(st.kind, w.draft, ctxOf(w), tpl);
    el.formName.textContent = formLabel(tpl.form);
    if (document.activeElement !== el.title) el.title.value = w.title ?? c.title;
    if (document.activeElement !== el.body) el.body.value = w.body ?? c.body;
    el.edited.classList.toggle('hidden', w.title == null && w.body == null);
    const groups = pdfGroups(w);
    el.savePdf.classList.toggle('hidden', !groups.length);
    el.savePdf.textContent = groups.length > 1 ? `첨부 PDF ${groups.length}개 저장 (${groups.map((g) => g.label).join(' · ')})`
      : `${groups[0]?.label || KINDS[st.kind].doc} PDF 저장 (첨부용)`;
    el.steps.innerHTML = stepsHtml(w, tpl);
    paintSet(w);
  }

  /* ---------------------------------------------------------- 문서설정·위임전결 */

  const opt = (value, label, on) => `<option value="${escapeHtml(value)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  /** 문서설정·위임전결 칸 — 레시피의 기본값에 이 공문에서 바꾼 것(w.setting·w.rank)을 얹어 보인다. */
  function paintSet(w) {
    const s = docSettingOf(st.kind, st.preset, w.setting);
    const d = delegationOf(st.kind, w.draft, { rank: w.rank || '' });
    el.rank.innerHTML = opt('', `규정대로 — ${d?.auto || RANKS[0]} 전결`, !w.rank) + RANKS.map((r) => opt(r, `${r} 전결`, w.rank === r)).join('');
    el.rankWhy.textContent = d ? `${d.label} · ${d.basis || '금액 무관'} → ${d.auto} 전결${d.unknown ? '(금액을 몰라 맨 아래 구간)' : ''} — ${d.source}` : '';
    el.retention.innerHTML = Object.entries(SETTING_OPTIONS.retention).map(([v, t]) => opt(v, t, v === s.retention)).join('');
    el.receiver.innerHTML = SETTING_OPTIONS.receiver.map((r) => opt(r, r, r === s.receiver)).join('');
    el.scope.innerHTML = Object.keys(SETTING_OPTIONS.scope).map((k) => opt(k, k, k === s.scope)).join('');
    if (document.activeElement !== el.docNoOne) el.docNoOne.value = s.docNo;
    el.docNoOne.placeholder = '공문 설정의 문서번호 부서 코드';
    el.docNoOne.title = s.docNoFrom ? `${s.docNoFrom}에서` : '';
    el.emergency.checked = s.emergency;
    el.approvingOpen.checked = s.approvingOpen;
    el.drm.checked = s.drm;
    if (document.activeElement !== el.tag) el.tag.value = s.tag;
    el.setState.textContent = `전결 ${d?.rank || RANKS[0]} · ${settingText(s)}`;
    el.setReset.disabled = !Object.keys(w.setting || {}).length && !w.rank;
  }

  /** 문서설정·위임전결을 고쳤을 때 — 레시피 기본값과 다른 것만 이 공문에 남긴다. */
  function onSetInput() {
    const w = cur();
    if (!w) return;
    const base = docSettingOf(st.kind, st.preset, {});
    const now = settingPatch({
      retention: el.retention.value, docNo: el.docNoOne.value, receiver: el.receiver.value, scope: el.scope.value,
      emergency: el.emergency.checked, approvingOpen: el.approvingOpen.checked, drm: el.drm.checked, tag: el.tag.value,
    });
    w.setting = Object.fromEntries(Object.entries(now).filter(([k, v]) => v !== base[k]));
    w.rank = RANKS.includes(el.rank.value) ? el.rank.value : '';
    saveWork();
    paintLive();
  }

  function resetSet() {
    const w = cur();
    if (!w) return;
    w.setting = {};
    w.rank = '';
    saveWork();
    paintLive();
  }

  /** 'eclass 에 공문 작성' 이 넣는 것과, 그 뒤 창에서 사람이 할 일(첨부·임시저장·상신). */
  function stepsHtml(w, tpl) {
    const p = projectOf(w);
    const k = KINDS[st.kind];
    const known = FORMS.some((f) => f.id === tpl.form);
    // 첨부는 본문의 ※ 첨부와 같은 문서들이다(교육 안내문·교육 내용 …) — 읽은 것이 없으면 갈래의 기본 문서.
    const docs = [...new Set((w.draft.attach || []).map((a) => a.label).filter(Boolean))].join(' · ') || k.doc;
    const list = [
      known ? `<b>공문 작성</b> ${escapeHtml(formLabel(tpl.form))} — ${p ? `과제 ${escapeHtml(p.alias || p.name)} · ` : ''}제목 · 본문 · 문서설정 · 결재선을 창에 넣습니다`
        : `<b>새 공문 열기</b> ${escapeHtml(formLabel(tpl.form))} — 칸 지도가 없는 양식이라 창만 엽니다`,
      `<b>결재선</b> ${escapeHtml(lineText(approvalLine(lineCtx(w))))}`,
      ...(docs ? [`<b>첨부</b> ${escapeHtml(docs)}${w.files?.length ? ' — 아래 PDF 저장으로 받은 파일을 창의 파일첨부로' : ''}`] : []),
      '<b>임시저장</b> 창에서 확인한 뒤 상신',
    ];
    return list.map((x) => `<li>${x}</li>`).join('');
  }

  function onDocInput(e) {
    const w = cur();
    if (!w) return;
    if (e.target === el.title) w.title = el.title.value;
    else w.body = el.body.value;
    saveWork();
    el.edited.classList.remove('hidden');
  }

  /** 직접 고친 제목·본문을 버리고 양식으로 다시 만든다. */
  function regen() {
    const w = cur();
    if (!w) return;
    w.title = null;
    w.body = null;
    saveWork();
    paintLive();
  }

  /** 작성 기록 한 줄 — 됐다 · 안 됐다 · 하는 중. */
  const stepLi = (x) => `<li class="${x.ok === true ? 'ok' : x.ok === false ? 'bad' : 'busy'}"><b>${escapeHtml(x.label)}</b>${x.detail ? ` ${escapeHtml(x.detail)}` : ''}</li>`;

  /**
   * 새 공문 창을 뒤 탭으로 열고 과제·제목·차수·본문·문서설정·결재선을 넣는다(src/gmwrite.js — 2026-10-08 사용자 지정 "공문작성은 백그라운드에서").
   * 패널은 그대로 두고 작성 기록만 쌓으며, 끝나면 기록 끝의 '창 보기'로 그 탭을 앞으로 가져온다. 임시저장·상신은 창에서 사람이 한다.
   */
  async function writeDoc() {
    const w = cur();
    if (!w || st.writing) return undefined;
    const plan = writePlan(st.kind, {
      title: el.title.value, body: el.body.value, draft: w.draft, form: tplOf().form, setting: w.setting, rank: w.rank,
    }, ctxOf(w));
    if (!plan.values.title) return setStatus('제목이 비어 있습니다 — 공문 칸의 제목을 적어 주세요.', 'error');
    st.writing = true;
    el.write.disabled = true;
    el.write.textContent = '공문 작성 중…';
    el.writeLog.classList.remove('hidden');
    el.writeLog.innerHTML = '';
    const shown = new Map();
    const paintStep = (x) => { shown.set(x.key, x); el.writeLog.innerHTML = [...shown.values()].map(stepLi).join(''); };
    setStatus('뒤 탭에서 공문을 쓰는 중입니다 — 다른 일을 하셔도 됩니다.');
    try {
      const res = await writeGongmun(plan, { onStep: paintStep });
      const bad = res.steps.filter((x) => x.ok === false);
      st.lastTab = res.tabId;
      if (res.tabId != null) el.writeLog.insertAdjacentHTML('beforeend', '<li class="gm-write-show"><button type="button" class="ghost small" data-act="show-tab">창 보기</button></li>');
      setStatus(bad.length ? `뒤 탭에 공문을 썼습니다 — ${bad.map((x) => x.label).join('·')}은(는) 창 보기로 열어 확인하세요.`
        : '뒤 탭에 공문을 썼습니다 — 창 보기로 열어 확인하고 첨부·임시저장 뒤 상신하세요.', bad.length ? 'error' : '');
      logEvent('gongmun', !bad.length, `공문 작성 · ${KINDS[st.kind].title} · ${plan.values.title}${res.docId ? ` · ${res.docId}` : ''}${bad.length ? ` · 안 된 것: ${bad.map((x) => x.label).join('·')}` : ''}`);
    } catch (err) {
      setStatus(`공문을 쓰지 못했습니다 — ${err.message}`, 'error');
      logEvent('gongmun', false, `공문 작성 실패 · ${KINDS[st.kind].title} · ${err.message}`);
    } finally {
      st.writing = false;
      el.write.disabled = false;
      el.write.textContent = 'eclass 에 공문 작성';
    }
    return undefined;
  }

  /** 작성 기록의 '창 보기' — 작성한 공문 탭을 앞으로. 닫았으면 그렇다고 말한다. */
  async function onWriteLogClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-act="show-tab"]') : null;
    if (!btn || st.lastTab == null) return;
    if (!(await showTab(st.lastTab))) setStatus('공문 창이 닫혔습니다 — 다시 작성하세요.', 'error');
  }

  /** 읽은 문서를 PDF 하나로 묶어 내려받는다 — 전자결재 첨부로 쓴다(원본 ea_approval 도 견적서를 PDF 로 바꿔 붙인다). */
  /** 첨부할 파일 — 견적서를 오렸으면(cut) 오린 그림이 앞에 오고, 오려 낸 화면의 장(cut.drop)은 빠진다. */
  function attachFiles(w) {
    const files = w?.files || [];
    const c = w?.cut;
    return c?.on ? [c.file, ...files.filter((f) => !c.drop.includes(f.name))] : files;
  }

  /** 첨부 목록의 문서마다 묶을 파일. 어느 묶음에도 없는 파일은 갈래의 기본 문서로 묶는다. */
  function pdfGroups(w) {
    const files = attachFiles(w);
    if (!files.length) return [];
    const groups = (w.draft.attach || []).map((a) => ({ label: a.label, files: files.filter((f) => a.files?.includes(f.name)) })).filter((g) => g.files.length);
    const rest = files.filter((f) => !groups.some((g) => g.files.includes(f)));
    if (rest.length) groups.push({ label: KINDS[st.kind].doc || '첨부', files: rest });
    return groups;
  }

  /** 첨부할 문서를 문서마다 PDF 하나로 묶어 내려받는다 — 교육 견적서·교육 내용이 따로 한 파일씩이다(전자결재 첨부 칸은 다섯 개). */
  async function savePdf() {
    const w = cur();
    const groups = pdfGroups(w);
    if (!groups.length) return;
    el.savePdf.disabled = true;
    try {
      const { buildPdf } = await import('./src/pdf.js');
      for (const g of groups) {
        const { bytes } = await buildPdf(g.files, { title: `${el.title.value} — ${g.label}` });
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        try {
          await chrome.downloads.download({ url, filename: attachName(st.kind, w.draft, today(), g.label), saveAs: false });
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
      }
      flash(el.savePdf, groups.length > 1 ? `${groups.length}개 저장됨 ✓` : '저장됨 ✓');
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      el.savePdf.disabled = false;
    }
  }

  /* ---------------------------------------------------------- 양식 */

  function paintTpl() {
    const tpl = tplOf();
    const known = FORMS.some((f) => f.id === tpl.form);
    el.tplForm.innerHTML = FORMS.map((f) => `<option value="${f.id}">${escapeHtml(f.label)}</option>`).join('') + '<option value="">양식 ID 직접 적기</option>';
    el.tplForm.value = known ? tpl.form : '';
    el.tplFormId.hidden = known;
    if (document.activeElement !== el.tplFormId) el.tplFormId.value = known ? '' : tpl.form;
    if (document.activeElement !== el.tplTitle) el.tplTitle.value = tpl.title;
    if (document.activeElement !== el.tplBody) el.tplBody.value = tpl.body;
    el.vars.innerHTML = [...VARS[st.kind], ...VAR_MARKS].map(([t, d]) => `<dt>${escapeHtml(t)}</dt><dd>${escapeHtml(d)}</dd>`).join('');
    paintTplState();
  }

  function paintTplState() {
    const edited = templateEdited(st.kind, st.templates);
    el.tplState.textContent = `${KINDS[st.kind].label} · ${edited ? '고친 양식' : '기본 양식'}`;
    el.tplReset.disabled = !edited;
  }

  function onTplInput() {
    el.tplFormId.hidden = !!el.tplForm.value;
    const form = el.tplForm.value || el.tplFormId.value.trim();
    st.templates = { ...st.templates, [st.kind]: templatePatch(st.kind, { form, title: el.tplTitle.value, body: el.tplBody.value }) };
    saveTemplates();
    paintTplState();
    if (cur()) paintLive();
  }

  function resetTpl() {
    const { [st.kind]: _, ...rest } = st.templates;
    st.templates = rest;
    saveTemplates();
    paintTpl();
    if (cur()) paintLive();
    logEvent('gongmun', true, `${KINDS[st.kind].title} 양식을 기본으로 되돌림`);
  }

  /* ---------------------------------------------------------- 공문 설정 */

  function paintPreset() {
    el.dept.value = st.preset.dept;
    el.head.value = st.preset.head;
    el.director.value = st.preset.director;
    el.chief.value = st.preset.chief;
    el.docNo.value = st.preset.docNo;
    el.refs.value = st.preset.refs.join(', ');
    paintDocNoHint();
    paintRows();
  }

  function paintPresetState() {
    // 접힌 줄에는 결재선에 설 사람(부서장·소장·본부장)만 보인다(2026-10-09 사용자 지정: "부서장,소장,본부장까지만 표기"). 참조·과제 수는 펴면 보인다.
    const p = st.preset;
    el.presetState.textContent = `부서장 ${p.head || '없음'}${p.director ? ` · 소장 ${p.director}` : ''}${p.chief ? ` · 본부장 ${p.chief}` : ''}`;
    // R&D 탭과 이어져 있으면 그 과제 수, 아니면 여기 적은 과제 수. 한도(열 개)는 정해 둔 몫이 아니라 적지 않는다 — 다 차면 더하기 단추가 잠기며 말한다
    // (2026-10-10 사용자 지정: "꼭 5개일 필요는 없어. 가끔 연장되거나 겹치는 경우 몇개 더 있더라").
    el.projCount.textContent = String(linked() ? st.rnd.length : st.projects.length);
  }

  /**
   * 공문 설정의 과제가 R&D 탭의 과제인가(2026-10-10 사용자 지정: "rnd 에 과제 들어가 있는거 추가하면되잖아. 그거랑 연동되어야") — R&D 탭에 과제가
   * 있으면 그 과제들이 여기 그대로 서고(과제명·별칭·번호·책임자·연구기간·연구 내용은 R&D 탭이 원본), 공문에만 쓰는 개요·계정만 여기서 적는다.
   * R&D 탭이 비어 있으면 예전처럼 여기에 과제를 적는다(R&D 탭을 처음 열 때 그 과제들을 가져간다).
   */
  const linked = () => st.rnd.length > 0;

  // [칸, 안내, 한 줄을 다 쓰는가, 여러 줄인가]. 과제 내용은 구매사유·교육사유를 쓰는 근거다(2026-10-07 사용자 지정).
  // 별명은 교육·출장 품의 제목("[과제 별명] 수행을 위한 … 품의"), 과제번호·연구기간은 본문 '가. 과제 개요'에 들어간다.
  const ROW_KEYS = [
    ['name', '과제명 — 전자결재 과제 찾기에 이 이름 그대로 씁니다', true],
    ['alias', '과제 별명 — 교육·출장 품의 제목에 씁니다 (예: 차단기 과제)'], ['code', '과제번호 (예: RND-20-2026)'],
    ['lead', '합의자 — 과제책임자 이름'], ['period', '연구기간 (예: 2026.04.01 ~ 2029.12.31)'],
    ['content', '과제 내용 — 연구목표·연구내용 (구매사유·교육사유를 이 내용으로 씁니다)', true, true],
    ['about', '과제 개요 — 본문 첫 줄 (비우면 「과제명」 과제를 수행하고 있습니다)', true], ['account', '계정 — 비우면 갈래 기본값', true],
  ];

  function rowField([k, ph, wide, area], p) {
    const label = escapeHtml(ph.split(' —')[0].split(' (')[0]);
    return area
      ? `<textarea data-k="${k}" class="wide" rows="3" placeholder="${escapeHtml(ph)}" aria-label="${label}">${escapeHtml(p[k] || '')}</textarea>`
      : `<input type="text" data-k="${k}"${wide ? ' class="wide"' : ''} value="${escapeHtml(p[k] || '')}" placeholder="${escapeHtml(ph)}" aria-label="${label}" autocomplete="off" />`;
  }

  /** 여기 적는 과제 한 줄(R&D 탭이 비었을 때, 또는 R&D 탭에 없는 과제). i 는 st.rows 의 차례다. */
  const rowHtml = (p, i, n = i + 1) => `<li class="gm-proj-row" data-i="${i}">`
    + `<div class="gm-row-head"><span>과제 ${n}</span><button type="button" class="ghost small" data-act="drop" data-i="${i}" aria-label="과제 ${n} 빼기">빼기</button></div>`
    + `<div class="gm-row-fields">${ROW_KEYS.map((key) => rowField(key, p)).join('')}</div></li>`;

  // R&D 과제 줄에서 적는 것 — 공문에만 쓰는 개요·계정(ROW_KEYS 의 그 둘과 같은 안내).
  const EXTRA_KEYS = ROW_KEYS.filter(([k]) => k === 'about' || k === 'account');

  /**
   * R&D 탭의 과제 한 줄 — 별칭(없으면 과제명)과 R&D 탭에 적힌 과제명·번호·책임자·연구기간·연구 내용을 보이고(고치는 곳은 R&D 탭),
   * 공문에만 쓰는 개요·계정 칸을 둔다. p 는 rndProjects 의 것(빈 칸은 공문 설정의 같은 과제 줄에서 채운 값이다).
   */
  function linkedHtml(p) {
    const meta = [p.code, p.lead ? `책임자 ${p.lead}` : '', p.period,
      p.rnd.plan ? `연구개발 계획 ${p.rnd.plan}차년도` : '', p.rnd.logs ? `진행 기록 ${p.rnd.logs}건` : ''].filter(Boolean).join(' · ');
    const field = ([k, ph]) => `<input type="text" data-x="${k}" class="wide" value="${escapeHtml(p[k] || '')}" placeholder="${escapeHtml(ph)}" `
      + `aria-label="${escapeHtml(ph.split(' —')[0])}" autocomplete="off" />`;
    return `<li class="gm-proj-row gm-proj-linked" data-rnd="${escapeHtml(p.rnd.id)}">`
      + `<div class="gm-row-head"><span class="gm-linked-name" title="${escapeHtml(p.name)}">${escapeHtml(p.alias || p.name)}</span>`
      + '<button type="button" class="ghost small" data-act="rnd" title="과제명·별칭·번호·책임자·연구기간·연구 내용은 R&amp;D 탭에서 고칩니다">R&amp;D 탭</button></div>'
      + `<p class="gm-linked-meta">${p.alias ? `${escapeHtml(p.name)}${meta ? ' · ' : ''}` : ''}${escapeHtml(meta)}</p>`
      + `<div class="gm-row-fields">${EXTRA_KEYS.map(field).join('')}</div></li>`;
  }

  function paintRows() {
    if (linked()) {
      // R&D 탭의 과제들 — 그 아래에, 여기 적어 두었지만 R&D 탭에 없는 과제(초안에서 고르지 않는다)를 고치거나 빼게 남긴다.
      const book = st.book?.projects || [];
      const orphans = st.rows.map((r, i) => [r, i]).filter(([r]) => String(r.name ?? '').trim() && !book.some((p) => sameProject(p, r)));
      el.projList.innerHTML = st.rnd.map(linkedHtml).join('')
        + (orphans.length ? '<li class="gm-proj-orphan">R&amp;D 탭에 없는 과제 — 초안에서 고르지 않습니다. R&amp;D 탭의 "공문 탭의 과제 가져오기"로 옮기거나 빼세요.</li>'
          + orphans.map(([r, i], n) => rowHtml(r, i, n + 1)).join('') : '');
      el.projAdd.textContent = 'R&D 탭에서 과제 더하기';
      el.projAdd.disabled = st.rnd.length >= RND_MAX;
    } else {
      el.projList.innerHTML = st.rows.map((p, i) => rowHtml(p, i)).join('');
      el.projAdd.textContent = '과제 더하기';
      el.projAdd.disabled = st.rows.length >= MAX_PROJECTS;
    }
    el.projAdd.title = el.projAdd.disabled ? `과제는 ${linked() ? RND_MAX : MAX_PROJECTS}개까지입니다` : '';
    paintPresetState();
  }

  /** 부서·부서장·참조자를 고쳤을 때. 결재선이 바로 바뀐다. */
  function onPresetInput() {
    st.preset = normalizePreset({
      dept: el.dept.value, head: el.head.value, refs: el.refs.value, director: el.director.value, chief: el.chief.value, docNo: el.docNo.value,
    });
    savePreset();
    paintPresetState();
    paintDocNoHint();
    if (cur()) paintLive();
  }

  function projectsChanged() {
    st.projects = normalizeProjects(st.rows);
    // R&D 탭의 과제도 공문 설정에서 개요·계정(비면 책임자·별칭)을 받는다.
    if (st.book) st.rnd = rndProjects(st.book, st.projects, today(), st.extra);
    savePreset();
    paintPresetState();
    paintProjects();
    if (cur()) paintLive();
  }

  function onRowInput(e) {
    // R&D 과제 줄의 개요·계정 — 그 줄의 두 칸을 함께 담는다(한쪽만 고쳐도 다른 쪽이 공문 설정 줄에서 온 값을 잃지 않게).
    const own = e.target instanceof Element ? e.target.closest('[data-rnd]') : null;
    if (own) {
      const val = (k) => own.querySelector(`[data-x="${k}"]`)?.value || '';
      st.extra = { ...st.extra, [own.dataset.rnd]: { about: val('about'), account: val('account') } };
      projectsChanged();
      return;
    }
    const node = e.target instanceof Element ? e.target.closest('[data-k]') : null;
    const li = node?.closest('[data-i]');
    if (!node || !li || !st.rows[+li.dataset.i]) return;
    st.rows[+li.dataset.i][node.dataset.k] = node.value;
    projectsChanged();
  }

  function onRowClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-act="drop"], [data-act="rnd"]') : null;
    if (!btn) return;
    if (btn.dataset.act === 'rnd') {
      $('tabRnd')?.click();
      return;
    }
    st.rows.splice(+btn.dataset.i, 1);
    paintRows();
    projectsChanged();
  }

  function addRow() {
    // R&D 탭과 이어져 있으면 과제는 R&D 탭에서 더한다 — 돌아오면 여기에 선다(show 가 장부를 다시 읽는다).
    if (linked()) {
      $('tabRnd')?.click();
      return;
    }
    if (st.rows.length >= MAX_PROJECTS) return;
    st.rows.push({ ...EMPTY_ROW });
    paintRows();
    el.projList.querySelector('.gm-proj-row:last-child [data-k="name"]')?.focus();
  }

  /**
   * 초안의 "과제 등록하기"·과제 기본 내용의 "고치기" — 공문 설정을 펴고, 과제 이름이 오면 그 과제 줄의 빈 칸(별명·번호·기간·내용 차례)에,
   * 아니면 빈 줄을 하나 내 준다.
   */
  function openPreset(name = '') {
    el.presetBox.open = true;
    if (!st.rows.length && !linked()) addRow();
    const i = name ? st.rows.findIndex((r) => String(r.name).trim() === name) : -1;
    const row = i >= 0 ? el.projList.querySelector(`.gm-proj-row[data-i="${i}"]`) : null;
    (row || el.presetBox).scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    if (!row) return;
    const keys = ['alias', 'code', 'period', 'content'];
    const empty = keys.find((k) => !String(st.rows[i][k] ?? '').trim());
    row.querySelector(`[data-k="${empty || 'alias'}"]`)?.focus();
  }

  /* ---------------------------------------------------------- 문서번호 코드 */

  /**
   * 부서로 문서번호 코드(문서설정 Doc No.)를 찾아 보여 준다(2026-10-09 사용자 지정: "부서는 내 부서를 입력하면 되고 2개면 선택하라고"). 코드가 적혀 있으면
   * 그 코드의 팀 이름을, 비어 있으면 부서로 찾은 것을 적는다 — 하나면 그것을 쓰고(docSettingOf 가 같은 표로 찾는다), 둘 이상이거나 없으면 문서설정 창의
   * 목록(레시피 settings.yaml 의 doc_no_options)에서 고르는 칸을 낸다. 완료한 문서의 문서설정 화면에는 Doc No. 가 보이지 않아(2026-10-09 읽기 전용 실측)
   * 보낸 공문에서 읽어 오지는 않는다.
   */
  function paintDocNoHint() {
    const c = docNoCandidates(st.preset.dept, st.preset.docNo);
    el.docNoHint.classList.toggle('bad', c.state === 'unknown');
    const option = (o) => `<option value="${escapeHtml(o.code)}">(${escapeHtml(o.code)}) ${escapeHtml(o.team ? `${o.team} — ${o.name}` : o.name)}</option>`;
    const pick = (list, lead) => `${escapeHtml(lead)}<select aria-label="문서번호 코드 고르기"><option value="">고르세요</option>${list.map(option).join('')}</select>`;
    el.docNoHint.innerHTML = c.state === 'set' ? `(${escapeHtml(c.code)}) ${escapeHtml(c.name)}`
      : c.state === 'unknown' ? `코드 ${escapeHtml(c.code)} 은(는) 문서설정 창의 목록에 없습니다 — 다시 확인하세요`
        : c.state === 'one' ? `부서로 찾음: (${escapeHtml(c.code)}) ${escapeHtml(c.name)} — 비워 두면 이 코드를 씁니다`
          : c.state === 'many' ? pick(c.matches, `부서에 맞는 코드가 ${c.matches.length}개입니다 — 고르세요`)
            : c.state === 'none' ? pick(c.all, '부서에 맞는 코드를 찾지 못했습니다 — 문서설정 창의 목록에서 고르세요')
              : '';
  }

  /** 안내 칸의 목록에서 고르면 문서번호 코드 칸에 들어간다. */
  function onDocNoPick(e) {
    const sel = e.target instanceof Element && e.target.tagName === 'SELECT' ? e.target : null;
    if (!sel || !sel.value) return;
    el.docNo.value = sel.value;
    onPresetInput();
  }

  /* ---------------------------------------------------------- 탭 */

  function wire() {
    el.evidenceToggle.addEventListener('click', () => {
      st.view.evidenceOpen = !st.view.evidenceOpen;
      paintView();
      saveView();
    });
    el.workspaceToggle.addEventListener('click', () => {
      st.view.workspaceOpen = !st.view.workspaceOpen;
      paintView();
      saveView();
    });
    el.viewTabs.addEventListener('click', onViewClick);
    el.viewTabs.addEventListener('keydown', onViewKey);
    el.compare.addEventListener('click', openCompare);
    // 사이드패널과 비교작성 탭이 같은 초안을 본다 — 다른 창이 쓴 것을 따라간다.
    chrome.storage.onChanged?.addListener(onStorageChanged);
    el.kinds.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest('[data-kind]') : null;
      if (b) setKind(b.dataset.kind);
    });
    el.file.addEventListener('change', () => {
      const files = [...el.file.files];
      el.file.value = '';
      intake({ files });
    });
    el.agentGo.addEventListener('click', runAgent);
    el.agentInput.addEventListener('keydown', onAgentKey);
    el.agentInput.addEventListener('input', growAgent);
    el.capture.addEventListener('click', onCaptureClick);
    el.manual.addEventListener('click', startManual);
    el.reset.addEventListener('click', resetWork);
    el.cut.addEventListener('click', onCutClick);
    el.pick.addEventListener('click', onProjectClick);
    el.projects.addEventListener('click', onProjectClick);
    el.projInfo.addEventListener('click', onProjectClick);
    el.fields.addEventListener('input', onFieldInput);
    el.fields.addEventListener('change', onFieldInput);
    el.moreFields.addEventListener('input', onFieldInput);
    el.moreFields.addEventListener('change', onFieldInput);
    el.fields.addEventListener('click', onFieldClick);
    el.title.addEventListener('input', onDocInput);
    el.body.addEventListener('input', onDocInput);
    el.regen.addEventListener('click', regen);
    el.write.addEventListener('click', writeDoc);
    el.writeLog.addEventListener('click', onWriteLogClick);
    for (const node of [el.rank, el.retention, el.docNoOne, el.receiver, el.scope, el.emergency, el.approvingOpen, el.drm, el.tag]) {
      node.addEventListener(node.tagName === 'SELECT' || node.type === 'checkbox' ? 'change' : 'input', onSetInput);
    }
    el.setReset.addEventListener('click', resetSet);
    el.savePdf.addEventListener('click', savePdf);
    for (const node of [el.tplForm, el.tplFormId, el.tplTitle, el.tplBody]) {
      node.addEventListener('input', onTplInput);
      node.addEventListener('change', onTplInput);
    }
    el.tplReset.addEventListener('click', resetTpl);
    for (const node of [el.dept, el.head, el.refs, el.director, el.chief, el.docNo]) node.addEventListener('input', onPresetInput);
    el.docNoHint.addEventListener('change', onDocNoPick);
    el.projList.addEventListener('input', onRowInput);
    el.projList.addEventListener('click', onRowClick);
    el.projAdd.addEventListener('click', addRow);
    for (const type of ['dragover', 'dragleave']) el.root.addEventListener(type, onDrag);
    el.root.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
  }

  /** 탭이 보일 때. 처음 한 번 저장해 둔 갈래·공문 설정·과제·양식·초안을 읽는다. */
  async function show() {
    el.root.classList.remove('hidden');
    if (!st.loaded) {
      const saved = await chrome.storage.local.get([KIND_KEY, PRESET_KEY, PROJECTS_KEY, RND_EXTRA_KEY, TEMPLATES_KEY, DRAFT_KEY, VIEW_KEY]);
      const view = saved?.[VIEW_KEY];
      // 비교작성 탭은 늘 두 칸(작성 내용·읽은 내용)으로 시작하고 연 갈래를 본다.
      if (!st.compareTab) st.view = { tab: TAB_LABEL[view?.tab] ? view.tab : 'draft', evidenceOpen: view?.evidenceOpen !== false, workspaceOpen: view?.workspaceOpen !== false };
      st.kind = st.compareTab || (KINDS[saved?.[KIND_KEY]] ? saved[KIND_KEY] : 'purchase');
      st.preset = normalizePreset(saved?.[PRESET_KEY]);
      st.projects = normalizeProjects(saved?.[PROJECTS_KEY]);
      st.rows = st.projects.map((p) => ({ ...p }));
      st.extra = normalizeRndExtra(saved?.[RND_EXTRA_KEY]);
      st.templates = saved?.[TEMPLATES_KEY] && typeof saved[TEMPLATES_KEY] === 'object' ? saved[TEMPLATES_KEY] : {};
      const kept = saved?.[DRAFT_KEY] && typeof saved[DRAFT_KEY] === 'object' ? saved[DRAFT_KEY] : {};
      st.lastProject = typeof kept.lastProject === 'string' ? kept.lastProject : '';
      for (const k of KIND_ORDER) {
        const w = kept[k];
        if (w?.draft && typeof w.draft === 'object' && !st.work[k]) st.work[k] = restoreWork(k, w);
      }
      st.loaded = true;
      await pullCut();   // 비교작성 탭 — 사이드패널이 건넨 오린 견적서
    }
    await loadBook();
    paintKinds();
    paintIntake();
    renderFields();
    paintDraft({ fold: true });
    paintTpl();
    paintPreset();
  }

  /** R&D 탭의 장부(rndBook)를 읽어 초안에서 고를 과제로 — 탭을 열 때마다(R&D 탭에서 과제·연구 내용을 고치고 돌아온다). */
  async function loadBook() {
    const saved = await chrome.storage.local.get([BOOK_KEY]);
    st.book = normalizeBook(saved?.[BOOK_KEY]);
    st.rnd = rndProjects(st.book, st.projects, today(), st.extra);
  }

  function hide() {
    el.root.classList.add('hidden');
  }

  /** 새로고침(↻). 사이트에서 읽어 올 것이 없다 — 화면만 다시 그린다. */
  async function reload() {
    return show();
  }

  /** Claude 에 닿는지. 닿지 않으면 문서 넣는 곳과 에이전트 칸을 회색으로 내린다(문서 없이 쓰기·규칙으로 읽기는 된다). */
  function paintReady(ready) {
    st.ready = ready;
    el.agent.classList.toggle('off', !ready);
    paintIntake();
  }

  return { wire, show, hide, reload, paintReady, state: st, compareTab: st.compareTab };
}
