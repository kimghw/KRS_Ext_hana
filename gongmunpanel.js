// 공문 탭의 화면. 무엇을 어떤 틀에 넣을지·결재선·한도는 src/gongmun.js 가, 문서 읽기는 src/llm.js 의 gongmunSmart 가 한다.
// 여기는 그 둘을 화면에 잇기만 한다.
//
// 전자결재에는 올리지 않는다(2026-10-07) — 제목·본문을 만들어 복사하게 하고 새 공문 창을 열어 줄 뿐이다. 본문 편집기(DEXT5)는
// 스크립트로 넣은 글을 저장하지 않아, 사람이 붙여 넣는 것이 지금은 가장 확실한 길이다(src/gongmun.js 머리말).
//
//   갈래(구매·교육·출장) → 문서 넣기(캡처 붙여넣기·끌어다 놓기·고르기·보고 있는 탭 통째로 캡처·웹페이지의 부분 골라 캡처) → 읽은 칸 고치기·과제 고르기 → 제목·본문 복사 → 새 공문 열기
//
// 양식(eclass 양식·제목 틀·본문 틀)과 사전 설정(부서·부서장·참조자·과제 다섯 개)은 이 탭 아래의 접힌 칸에서 고친다.

import {
  KINDS, KIND_ORDER, FORMS, DEFAULT_FORM, MAX_PROJECTS, VARS, VAR_MARKS, FIELDS,
  KIND_KEY, PRESET_KEY, PROJECTS_KEY, TEMPLATES_KEY, DRAFT_KEY,
  templateOf, templateEdited, templatePatch, normalizePreset, normalizeProjects, fromRecord, blankDraft, summaryOf,
  overLimit, approvalLine, lineText, compose, needs, bodyHtml, draftUrl, attachName, won, moneyOf, mergeSetup, ROLE_LABEL,
  mergeDraft, applyReason, REASON_KEYS, EMPTY_ROW, eduModeOf, spreadParts, attachWithCut,
} from './src/gongmun.js';
import { gongmunSmart, gongmunSetupSmart, gongmunReasonSmart } from './src/llm.js';
import { readSlots } from './src/pagecap.js';
import { cutBoxes, cutDrop, cutName, cutQuote, CUT_PAD, PAD_STEP, MAX_PAD } from './src/quotecut.js';
import { createWebPick, pickButton } from './webpick.js';

const FILE_LIMIT = 10 * 1024 * 1024;
/** 한 번에 읽는 장 수. 로컬 CLI 다리는 여섯 장까지 받는다(native/host.mjs). 웹페이지 캡처의 그 밖의 장은 첨부에만 넣는다. */
const MAX_FILES = 5;
const SAVE_WAIT_MS = 400;
const VIA_LABEL = { cli: '로컬 CLI', api: 'API 키', local: '규칙 해석' };
/** 채팅 칸에 남겨 두는 말 수(내 말·답 합쳐서). */
const CHAT_KEEP = 6;
const DOC_LABEL = { quote: '견적서', statement: '거래명세서', order: '주문 화면', course: '교육 안내문', other: '문서', unknown: '문서' };

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** 100만원처럼 만 단위로 끊어 말한다. */
const manwon = (n) => (n % 10000 === 0 ? `${(n / 10000).toLocaleString('ko-KR')}만원` : won(n));
const formLabel = (id) => FORMS.find((f) => f.id === id)?.label || id;

/**
 * @param {{$:Function, escapeHtml:Function, logEvent:Function, ai:() => {apiKey:string, cli:boolean}, me?:() => string,
 *   copyText?:(text:string) => Promise<boolean>, flash?:(btn:HTMLElement, text:string, ms?:number) => void,
 *   webcap?:{front?:Function, start?:Function, parts?:Function}}} deps
 *   webcap 은 웹페이지를 찍는 길(src/pagecap.js — 보고 있는 탭 통째로·페이지 위의 부분 고르기·고른 부분 찍기) — 캡처 단추(webpick.js)에 넘긴다
 */
export function createGongmunPanel({ $, escapeHtml, logEvent, ai, me = () => '', copyText = defaultCopy, flash = () => {}, webcap = {} }) {
  const el = {
    root: $('gongmun'), kinds: $('gmKinds'), chat: $('gmChat'), chatInput: $('gmChatInput'), chatGo: $('gmChatGo'), chatLog: $('gmChatLog'),
    intake: $('gmIntake'), file: $('gmFile'), dropLead: $('gmDropLead'), capture: $('gmCapture'),
    fileName: $('gmFileName'), manual: $('gmManual'), soon: $('gmSoon'), status: $('gmStatus'),
    draft: $('gmDraft'), source: $('gmSource'), cut: $('gmCut'), items: $('gmItems'), limit: $('gmLimit'), projects: $('gmProjects'), projInfo: $('gmProjInfo'),
    fields: $('gmFields'), line: $('gmLine'), need: $('gmNeed'), reset: $('gmReset'),
    doc: $('gmDoc'), formName: $('gmFormName'), title: $('gmTitle'), body: $('gmBody'), edited: $('gmEdited'), regen: $('gmRegen'),
    copyTitle: $('gmCopyTitle'), copyBody: $('gmCopyBody'), open: $('gmOpen'), savePdf: $('gmSavePdf'), steps: $('gmSteps'),
    tplBox: $('gmTplBox'), tplState: $('gmTplState'), tplForm: $('gmTplForm'), tplFormId: $('gmTplFormId'),
    tplTitle: $('gmTplTitle'), tplBody: $('gmTplBody'), tplReset: $('gmTplReset'), vars: $('gmVars'),
    presetBox: $('gmPresetBox'), presetState: $('gmPresetState'), dept: $('gmDept'), head: $('gmHead'), refs: $('gmRefs'),
    projList: $('gmProjList'), projAdd: $('gmProjAdd'), projCount: $('gmProjCount'),
  };
  // 웹페이지 캡처 단추 둘(보고 있는 탭 · 부분 골라 캡처) — 출장 카드의 증빙 넣는 곳과 같은 것이다(webpick.js, 2026-10-08 사용자 지정).
  const pick = createWebPick(webcap);
  const PICK_KEY = 'gongmun';
  const st = {
    kind: 'purchase', loaded: false, busy: false, capturing: false, ready: true, chatBusy: false, chat: [], reasonBusy: false,
    preset: normalizePreset(null),
    // projects 는 저장된(이름이 있는) 과제, rows 는 사전 설정 칸에 펼쳐 둔 줄(아직 이름을 적지 않은 줄도 있다).
    projects: [], rows: [],
    // 갈래마다 고친 양식만 담는다(src/gongmun.js 의 templatePatch).
    templates: {},
    // 갈래마다 쓰고 있는 것 — { draft, source, notes, project(과제명), title·body(직접 고쳤으면 그 글, 아니면 null), files(읽은 파일 — 저장하지 않는다),
    //   parts(읽기가 가린 파일마다의 종류), cut(구매 — 가격과 그 둘레를 오린 견적서, src/quotecut.js — 저장하지 않는다) }
    work: {},
    lastProject: '',
  };

  const cur = () => st.work[st.kind] || null;
  const projectOf = (w) => st.projects.find((p) => p.name === w?.project) || null;
  const ctxOf = (w) => ({ me: me(), preset: st.preset, project: projectOf(w), today: today() });
  const tplOf = () => templateOf(st.kind, st.templates);

  function setStatus(msg, kind = '') {
    el.status.className = `status ${kind}`;
    el.status.textContent = msg;
  }

  /* ---------------------------------------------------------- 저장 */

  const timers = {};
  const later = (key, fn) => { clearTimeout(timers[key]); timers[key] = setTimeout(fn, SAVE_WAIT_MS); };

  /** 쓰고 있는 초안을 남긴다 — 패널을 닫았다 열어도 이어 쓴다. 읽은 파일(그림)과 오린 견적서는 크니 남기지 않는다. */
  function saveWork() {
    later('work', () => {
      const out = { lastProject: st.lastProject };
      for (const k of KIND_ORDER) {
        if (!st.work[k]) continue;
        const { files, cut, ...rest } = st.work[k];
        out[k] = rest;
      }
      chrome.storage.local.set({ [DRAFT_KEY]: out });
    });
  }
  const savePreset = () => later('preset', () => chrome.storage.local.set({ [PRESET_KEY]: st.preset, [PROJECTS_KEY]: normalizeProjects(st.rows) }));
  const saveTemplates = () => later('tpl', () => chrome.storage.local.set({ [TEMPLATES_KEY]: st.templates }));

  /* ---------------------------------------------------------- 갈래 */

  function paintKinds() {
    el.kinds.innerHTML = `<div class="gm-kind-row">${KIND_ORDER.map((k) => {
      const on = k === st.kind;
      const soon = KINDS[k].ready ? '' : '<small>준비 중</small>';
      return `<button type="button" class="gm-kind${on ? ' active' : ''}" data-kind="${k}" aria-pressed="${on}" title="${escapeHtml(KINDS[k].title)}">${escapeHtml(KINDS[k].label)}${soon}</button>`;
    }).join('')}</div>`;
  }

  function setKind(kind) {
    if (!KINDS[kind] || kind === st.kind) return;
    st.kind = kind;
    chrome.storage.local.set({ [KIND_KEY]: kind });
    setStatus('');
    paintKinds();
    paintIntake();
    renderFields();
    paintDraft();
    paintTpl();
  }

  /* ---------------------------------------------------------- 문서 넣기 */

  function paintIntake() {
    const k = KINDS[st.kind];
    el.soon.classList.toggle('hidden', k.ready);
    el.intake.classList.toggle('hidden', !k.reads);
    if (!k.reads) return;
    el.intake.classList.toggle('off', !st.ready);
    el.intake.setAttribute('aria-busy', String(st.busy || st.capturing));
    // 이미 읽은 초안이 있으면 더 넣는 곳이 된다 — 넣으면 앞서 넣은 것과 함께 다시 읽고 같이 첨부한다.
    const w = cur();
    const had = w?.files?.length || 0;
    el.dropLead.textContent = st.capturing ? '캡처하는 중…' : st.busy ? '읽는 중…' : w ? k.more : k.ask;
    el.file.disabled = st.busy || st.capturing;
    el.capture.innerHTML = pickButton({ picking: pick.picking(PICK_KEY), disabled: st.busy || st.capturing });
    el.manual.disabled = st.busy;
    el.manual.hidden = !!w;
    el.fileName.textContent = !st.ready ? 'Claude 가 연결되지 않아 문서를 읽을 수 없습니다 — 문서 없이 쓰기는 됩니다'
      : had ? `넣은 문서 ${had}장 — 더 넣으면 함께 다시 읽고 같이 첨부합니다(${MAX_FILES}장까지). 새로 시작하려면 읽은 내용의 비우기.` : '';
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
    const has = (name) => !!name && st.projects.some((p) => p.name === name);
    if (has(prev?.project)) return prev.project;
    if (has(st.lastProject)) return st.lastProject;
    return st.projects.length === 1 ? st.projects[0].name : '';
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
    if (!k.reads || st.busy) return;
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
    paintIntake();
    setStatus(`${kept.length || prev?.text ? '앞서 넣은 것과 함께 다시 ' : ''}읽는 중입니다${toRead.length > 1 ? `(${toRead.length}장)` : ''}…${extra}`);
    const { apiKey, cli } = ai();
    let done = false;
    try {
      const got = await gongmunSmart({ files: toRead, text: allText }, { kind, today: today() }, { apiKey, useNative: cli });
      const rec = { ...got.record, parts: spreadParts(got.record.parts, all) };
      if (rec.docType === 'unknown') throw new Error(`품의에 넣을 문서로 보이지 않습니다 — ${rec.summary}`);
      // 구매 — 쇼핑몰 화면이면 읽기가 짚은 가격과 그 둘레(quoteArea)를 오려 견적서 한 장으로 첨부한다(src/quotecut.js, 2026-10-08 사용자 지정).
      // 앞서 원래 장으로 되돌려 두었으면 더 넣어 다시 읽어도 그대로 둔다.
      const cutNotes = [];
      const cut = kind === 'purchase'
        ? await makeCut(all, cutBoxes(rec.quoteArea, all, rec.parts), { on: prev?.cut?.on ?? true, notes: cutNotes }) : null;
      const { draft: fresh, notes } = fromRecord(kind, rec, { me: me(), files: all.map((f) => f.name), cut });
      notes.push(...cutNotes);
      if (kind === 'purchase' && rec.docType === 'course') notes.push('교육 안내문으로 보입니다 — 교육 품의라면 교육 갈래에 다시 넣어 주세요');
      if (capture?.notes) notes.push(...capture.notes);
      if (held) notes.push(`캡처 ${picked.length}장 가운데 ${front}${picked.length - held}장만 읽었습니다 — 나머지 ${held}장은 첨부 PDF 에만 들어갑니다`);
      if (got.note) notes.push(got.note);
      const what = [DOC_LABEL[rec.docType] || '문서', rec.vendor, rec.quoteDate].filter(Boolean).join(' · ');
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
        paintDraft();
      }
      paintIntake();
    }
    // 과제를 이미 골랐고 사유가 비어 있으면 과제 내용으로 사유를 쓴다.
    if (done) writeReason(kind, { auto: true });
    return undefined;
  }

  /**
   * 견적서를 오린다(구매 — src/quotecut.js) — 칸(cutBoxes 가 고른 것)이 없으면 null. 못 오리면 notes 에 까닭을 적고 null 이다(넣은 장 그대로 첨부).
   * name 은 첨부 목록에 쓰는 오린 그림의 이름, drop 은 첨부에서 빠지는 장(오려 낸 화면과 같은 묶음), on 은 오린 것을 첨부하는가(원래 장으로면 false).
   * @returns {Promise<{name: string, file: object, boxes: object[], drop: string[], pad: number, on: boolean}|null>}
   */
  async function makeCut(files, boxes, { pad = CUT_PAD, on = true, notes = [] } = {}) {
    if (!boxes.length) return null;
    try {
      const blob = await cutQuote(files, boxes, { pad });
      const name = cutName(today(), files.map((f) => f.name));
      return { name, file: { name, type: 'image/png', size: blob.size, dataUrl: await readFile(blob) }, boxes, drop: cutDrop(boxes, files), pad, on };
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
    const k = KINDS[st.kind];
    if (!k.reads || st.busy || st.capturing) return;
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
   * 과제 내용(사전 설정의 과제마다 적어 둔 연구목표·연구내용)으로 사유(구매사유·교육사유)와 용도(교육목적)를 쓴다(2026-10-07 사용자 지정).
   * auto 는 저절로 부른 것이다 — 과제를 골랐고 사유가 비어 있고 Claude 에 닿을 때만 쓴다. 단추로 부르면 있던 사유를 고쳐 쓴다.
   */
  async function writeReason(kind = st.kind, { auto = false } = {}) {
    const w = st.work[kind];
    if (!w || !REASON_KEYS[kind] || st.reasonBusy) return;
    const project = projectOf(w);
    if (auto && (!project || String(w.draft[REASON_KEYS[kind].reason] || '').trim() || !st.ready)) return;
    const { apiKey, cli } = ai();
    st.reasonBusy = true;
    paintReasonBtn();
    setStatus(`${project ? `「${project.name}」 과제 내용으로 ` : ''}사유를 쓰는 중입니다…`);
    try {
      const got = await gongmunReasonSmart(kind, w.draft, project, { apiKey, useNative: cli });
      if (st.work[kind] !== w) return;
      w.draft = applyReason(kind, w.draft, got.data, { touched: w.touched || [] });
      saveWork();
      if (st.kind === kind) {
        for (const key of Object.values(REASON_KEYS[kind])) syncField(key);
        paintLive();
      }
      const hint = project?.content ? '' : ' 사전 설정에서 과제 내용을 넣어 두면 과제에 더 맞게 씁니다.';
      setStatus(`사유를 썼습니다(${VIA_LABEL[got.via] || got.via}) — 칸에서 고칠 수 있습니다.${hint}`);
      logEvent('gongmun', true, `${KINDS[kind].title} 사유 작성 · ${project?.name || '과제 없음'} · ${VIA_LABEL[got.via] || got.via}`);
    } catch (err) {
      if (!auto || st.ready) setStatus(err.message, 'error');
      logEvent('gongmun', false, `${KINDS[kind].title} 사유 작성 실패 · ${err.message}`);
    } finally {
      st.reasonBusy = false;
      paintReasonBtn();
    }
  }

  /** 칸 하나를 초안 값으로 — 쓰고 있는 칸은 건드리지 않는다. */
  function syncField(key) {
    const node = el.fields.querySelector(`[data-key="${key}"]`);
    const w = cur();
    if (node && w && document.activeElement !== node) node.value = w.draft[key] ?? '';
  }

  function paintReasonBtn() {
    const btn = el.fields.querySelector('[data-act="reason"]');
    if (!btn) return;
    btn.disabled = st.reasonBusy || !projectOf(cur());
    btn.textContent = st.reasonBusy ? '쓰는 중…' : '과제 내용으로 쓰기';
    btn.title = projectOf(cur()) ? '고른 과제의 내용(사전 설정)을 근거로 사유를 다시 씁니다' : '과제를 먼저 고르세요';
  }

  /** 문서 없이 쓴다 — Claude 가 없거나 문서가 없을 때. */
  function startManual() {
    const k = KINDS[st.kind];
    if (!k.ready || cur()) return;
    st.work[st.kind] = {
      draft: blankDraft(st.kind, { me: me() }), notes: [], touched: [], project: defaultProject(null), title: null, body: null, files: [],
      text: '', source: { label: '직접 입력', from: '', via: '', summary: '' },
    };
    saveWork();
    renderFields();
    paintDraft();
    paintIntake();
    el.fields.querySelector('input, textarea')?.focus();
  }

  function resetWork() {
    delete st.work[st.kind];
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
    const can = KINDS[st.kind].reads && !st.busy;
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
    intake({ files: [...e.dataTransfer.files] });
  }

  /**
   * 붙여넣기(Ctrl+V). 탭이 보일 때 클립보드에 파일(캡처한 화면·복사한 파일)이 있으면 읽는다. 글은 글 칸 밖에서 붙여 넣었을 때만
   * 문서로 읽는다(쇼핑몰 화면의 글을 복사해 온 것) — 칸 안의 붙여넣기는 그대로 간다.
   */
  function onPaste(e) {
    if (el.root.classList.contains('hidden') || !KINDS[st.kind].reads) return;
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

  function paintDraft() {
    const w = cur();
    const show = !!w && KINDS[st.kind].ready;
    el.draft.classList.toggle('hidden', !show);
    if (!show) {
      el.doc.classList.add('hidden');
      paintCut();
      return;
    }
    const src = w.source || {};
    const head = [src.label, src.from && src.from !== src.label ? src.from : '', VIA_LABEL[src.via] ? `${VIA_LABEL[src.via]}로 읽음` : '']
      .filter(Boolean).map(escapeHtml).join(' · ');
    // 첨부가 될 문서 — 문서 종류마다 한 줄(교육이면 교육 견적서·교육 내용).
    const attach = (w.draft.attach || []).filter((a) => a.files?.length)
      .map((a) => `${a.label}${a.files.length > 1 ? ` ${a.files.length}장` : ''}`).join(' · ');
    el.source.innerHTML = `<span>${head}</span>${attach ? `<span class="gm-attach">첨부 · ${escapeHtml(attach)}</span>` : ''}`
      + (w.notes || []).map((n) => `<span class="gm-note">${escapeHtml(n)}</span>`).join('');
    paintCut();
    const items = st.kind === 'purchase' ? w.draft.items || [] : [];
    el.items.innerHTML = items.map((it) => {
      const meta = [it.spec, it.qty != null ? `${it.qty.toLocaleString('ko-KR')}${it.unit || ''}` : '', won(it.amount)].filter(Boolean).join(' · ');
      return `<li><span class="gm-item-name">${escapeHtml(it.name)}</span>${meta ? `<span class="gm-item-meta">${escapeHtml(meta)}</span>` : ''}</li>`;
    }).join('');
    paintProjects();
    paintLive();
  }

  /**
   * 오린 견적서(구매) — 오린 그림과 어디서 오렸는지. 가격·상품명이 잘렸으면 더 넓게(둘레를 더 넣어 다시 오린다), 마땅치 않으면 원래 장으로
   * (넣은 장 그대로 첨부 — 그러면 가격 부분만으로 돌아가는 단추가 선다).
   */
  function paintCut() {
    const c = st.kind === 'purchase' ? cur()?.cut : null;
    el.cut.classList.toggle('hidden', !c);
    if (!c) {
      el.cut.innerHTML = '';
      return;
    }
    const from = [...new Set(c.boxes.map((b) => b.file))].join(', ');
    el.cut.innerHTML = c.on
      ? `<div class="gm-cut-head"><strong>견적서</strong><span>가격과 그 둘레를 오렸습니다 — ${escapeHtml(from)}</span></div>`
        + `<img src="${escapeHtml(c.file.dataUrl)}" alt="오린 견적서 — 가격과 그 둘레" />`
        + '<div class="gm-cut-acts">'
        + `<button type="button" class="ghost small" data-cut="wide" title="가격이나 상품명이 잘렸으면 둘레를 더 넣어 다시 오립니다"${c.pad >= MAX_PAD ? ' disabled' : ''}>더 넓게</button>`
        + '<button type="button" class="ghost small" data-cut="off" title="오리지 않고 넣은 장 그대로 첨부합니다">원래 장으로</button></div>'
      : '<div class="gm-cut-head"><strong>견적서</strong><span>넣은 장 그대로 첨부합니다</span></div>'
        + '<div class="gm-cut-acts"><button type="button" class="ghost small" data-cut="on" title="가격과 그 둘레만 오린 그림을 견적서로 첨부합니다">가격 부분만 첨부</button></div>';
  }

  /** 오린 견적서의 단추 — 더 넓게·원래 장으로·가격 부분만 첨부. 첨부 목록(본문 ※ 첨부·PDF)이 따라 바뀐다. */
  async function onCutClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-cut]') : null;
    const kind = st.kind;
    const w = cur();
    if (!btn || btn.disabled || !w?.cut) return;
    if (btn.dataset.cut === 'wide') {
      btn.disabled = true;
      const notes = [];
      const next = await makeCut(w.files || [], w.cut.boxes, { pad: Math.min(w.cut.pad + PAD_STEP, MAX_PAD), notes });
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
    if (st.kind === kind) paintDraft();
  }

  function paintProjects() {
    const w = cur();
    paintProjInfo();
    if (!st.projects.length) {
      el.projects.innerHTML = '<p class="gm-noproj">등록한 과제가 없습니다. <button type="button" class="ghost small" data-act="preset">과제 등록하기</button></p>';
      return;
    }
    el.projects.innerHTML = st.projects.map((p, i) => {
      const on = w?.project === p.name;
      const tip = [p.name, p.alias ? `별명 ${p.alias}` : '', p.code, p.lead ? `책임자 ${p.lead}` : ''].filter(Boolean).join(' · ');
      const meta = [p.alias ? `별명 ${p.alias}` : '', p.lead ? `책임 ${p.lead}` : ''].filter(Boolean).join(' · ');
      return `<button type="button" class="gm-proj${on ? ' active' : ''}" role="radio" aria-checked="${on}" data-proj="${i}" title="${escapeHtml(tip)}">`
        + `<span class="gm-proj-name">${escapeHtml(p.name)}</span>${meta ? `<span class="gm-proj-lead">${escapeHtml(meta)}</span>` : ''}</button>`;
    }).join('');
  }

  /**
   * 고른 과제의 기본 내용 — 별명(제목)·과제번호·연구기간(과제 개요)·과제 내용(사유의 근거)이 들어 있는지 한 줄로 보인다(2026-10-07 사용자 지정
   * "과제 기본 내용을 넣을 수 있는 칸"). 빈 것은 흐리게 적고, 고치기는 사전 설정의 그 과제 줄로 간다.
   */
  function paintProjInfo() {
    const p = projectOf(cur());
    el.projInfo.classList.toggle('hidden', !p);
    if (!p) {
      el.projInfo.innerHTML = '';
      return;
    }
    const bit = (label, value, empty) => (value ? `<span>${label} <b>${escapeHtml(value)}</b></span>` : `<span class="gm-miss">${empty}</span>`);
    el.projInfo.innerHTML = '<strong>과제 기본 내용</strong>'
      + [
        bit('별명', p.alias, '별명 없음 — 제목에 과제명이 들어갑니다'), bit('번호', p.code, '번호 없음'), bit('기간', p.period, '연구기간 없음'),
        bit('내용', p.content ? `${p.content.length.toLocaleString('ko-KR')}자` : '', '과제 내용 없음 — 사유가 일반적으로 써집니다'),
      ].join('')
      + `<button type="button" class="ghost small" data-act="preset" data-name="${escapeHtml(p.name)}">고치기</button>`;
  }

  function onProjectClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-proj], [data-act="preset"]') : null;
    if (!btn) return;
    if (btn.dataset.act === 'preset') {
      openPreset(btn.dataset.name || '');
      return;
    }
    const w = cur();
    const p = st.projects[+btn.dataset.proj];
    if (!w || !p) return;
    w.project = w.project === p.name ? '' : p.name;
    if (w.project) st.lastProject = w.project;
    saveWork();
    paintProjects();
    paintLive();
    paintReasonBtn();
    // 사유가 비어 있으면 고른 과제의 내용으로 쓴다.
    if (w.project) writeReason(st.kind, { auto: true });
  }

  function renderFields() {
    const w = cur();
    const list = FIELDS[st.kind] || [];
    if (!w || !list.length) {
      el.fields.innerHTML = '';
      return;
    }
    el.fields.innerHTML = list.map((f) => {
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
      // 사유 칸에는 과제 내용으로 쓰는 단추를 붙인다(2026-10-07 사용자 지정).
      const act = REASON_KEYS[st.kind]?.reason === f.key ? '<button type="button" class="ghost small gm-reason" data-act="reason">과제 내용으로 쓰기</button>' : '';
      return `<div class="gm-field${f.wide ? ' wide' : ''}" data-field="${f.key}"><div class="gm-field-head"><label for="${id}">${escapeHtml(f.label)}</label>${act}</div>${input}</div>`;
    }).join('');
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
      const s = el.fields.querySelector('[data-key="summary"]');
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
    if (lim.over) {
      el.limit.innerHTML = `합계 <strong>${won(lim.amount)}</strong> — 부서 ${escapeHtml(KINDS[st.kind].title)}는 <strong>${manwon(lim.limit)} 이하</strong>만 작성합니다. `
        + '합계를 잘못 읽었으면 아래 합계 칸을 고쳐 주세요.';
    } else if (lim.unknown) {
      el.limit.textContent = `합계(원)를 몰라 ${manwon(lim.limit)} 이하인지 가리지 못했습니다 — 아래 합계 칸에 부가세 포함 금액(원)을 적어 주세요.`;
    }
    const account = el.fields.querySelector('[data-key="account"]');
    if (account) account.placeholder = projectOf(w)?.account || KINDS[st.kind].account;
    const line = approvalLine(ctxOf(w));
    el.line.innerHTML = lineHtml(line);
    const left = needs(st.kind, w.draft, { preset: st.preset, project: projectOf(w), projects: st.projects });
    el.need.textContent = left.length ? `남은 것: ${left.join(' · ')}` : '';
    paintDoc(blocked);
  }

  function lineHtml(line) {
    const role = (r) => ROLE_LABEL[r] || r;
    const steps = line.steps.map((s) => `<span class="gm-step"><em>${role(s.role)}</em>${escapeHtml(s.name)}${s.why ? `<small>${s.why}</small>` : ''}</span>`);
    if (!line.steps.some((s) => s.role === '결재')) steps.push(`<span class="gm-step miss"><em>${role('결재')}</em>부서장을 정하세요</span>`);
    return `<span class="gm-steps">${steps.join('<span class="gm-arrow" aria-hidden="true">→</span>')}</span>`
      + (line.refs.length ? `<span class="gm-refs"><em>${role('참조')}</em>${escapeHtml(line.refs.join(', '))}</span>` : '')
      + line.notes.map((n) => `<span class="gm-note">${escapeHtml(n)}</span>`).join('');
  }

  /* ---------------------------------------------------------- 공문 */

  function paintDoc(blocked = false) {
    const w = cur();
    const show = !!w && KINDS[st.kind].ready && !blocked;
    el.doc.classList.toggle('hidden', !show);
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
  }

  /** 새 공문 창에서 할 일. 결재선·과제·첨부는 창에서 사람이 넣는다. */
  function stepsHtml(w, tpl) {
    const p = projectOf(w);
    const k = KINDS[st.kind];
    // 첨부는 본문의 ※ 첨부와 같은 문서들이다(교육 안내문·교육 내용 …) — 읽은 것이 없으면 갈래의 기본 문서.
    const docs = [...new Set((w.draft.attach || []).map((a) => a.label).filter(Boolean))].join(' · ') || k.doc;
    const list = [
      `<b>새 공문 열기</b> ${escapeHtml(formLabel(tpl.form))}`,
      '<b>붙여 넣기</b> 제목 칸에 제목, 본문 편집기 안을 누르고 본문(Ctrl+V)',
      `<b>결재선</b> ${escapeHtml(lineText(approvalLine(ctxOf(w))))}`,
      ...(tpl.form === DEFAULT_FORM && p ? [`<b>과제 찾기</b> 과제명으로 검색 — ${escapeHtml(p.name)}`] : []),
      ...(docs ? [`<b>첨부</b> ${escapeHtml(docs)}${w.files?.length ? ' — 아래 PDF 저장으로 받은 파일' : ''}`] : []),
      '<b>임시저장</b> 확인한 뒤 상신',
    ];
    return list.map((s) => `<li>${s}</li>`).join('');
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

  async function copyTitle() {
    const ok = await copyText(el.title.value);
    flash(el.copyTitle, ok ? '복사됨 ✓' : '복사 실패');
  }

  /** 본문은 서식(HTML — 들여쓰기·'아 래' 가운데)과 글을 같이 담는다. 편집기는 HTML 을, 메모장은 글을 받는다. */
  async function copyBody() {
    const text = el.body.value;
    let ok = false;
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([bodyHtml(text)], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      ok = true;
    } catch {
      ok = await copyText(text);
    }
    flash(el.copyBody, ok ? '복사됨 ✓' : '복사 실패');
    if (ok) logEvent('gongmun', true, `본문 복사 · ${KINDS[st.kind].title} · ${el.title.value}`);
  }

  function openDraft() {
    const tpl = tplOf();
    chrome.tabs.create({ url: draftUrl(tpl.form) });
    logEvent('gongmun', true, `새 공문 열기 · ${KINDS[st.kind].title} · ${formLabel(tpl.form)}`);
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

  /* ---------------------------------------------------------- 사전 설정 */

  function paintPreset() {
    el.dept.value = st.preset.dept;
    el.head.value = st.preset.head;
    el.refs.value = st.preset.refs.join(', ');
    paintRows();
  }

  function paintPresetState() {
    const p = st.preset;
    el.presetState.textContent = `부서장 ${p.head || '없음'} · 참조 ${p.refs.length}명 · 과제 ${st.projects.length}개`;
    el.projCount.textContent = `${st.projects.length}/${MAX_PROJECTS}`;
  }

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

  function paintRows() {
    el.projList.innerHTML = st.rows.map((p, i) => `<li class="gm-proj-row" data-i="${i}">`
      + `<div class="gm-row-head"><span>과제 ${i + 1}</span><button type="button" class="ghost small" data-act="drop" data-i="${i}" aria-label="과제 ${i + 1} 빼기">빼기</button></div>`
      + `<div class="gm-row-fields">${ROW_KEYS.map((key) => rowField(key, p)).join('')}</div></li>`).join('');
    el.projAdd.disabled = st.rows.length >= MAX_PROJECTS;
    paintPresetState();
  }

  /** 부서·부서장·참조자를 고쳤을 때. 결재선이 바로 바뀐다. */
  function onPresetInput() {
    st.preset = normalizePreset({ dept: el.dept.value, head: el.head.value, refs: el.refs.value });
    savePreset();
    paintPresetState();
    if (cur()) paintLive();
  }

  function projectsChanged() {
    st.projects = normalizeProjects(st.rows);
    savePreset();
    paintPresetState();
    if (cur()) {
      paintProjects();
      paintLive();
    }
  }

  function onRowInput(e) {
    const node = e.target instanceof Element ? e.target.closest('[data-k]') : null;
    const li = node?.closest('[data-i]');
    if (!node || !li || !st.rows[+li.dataset.i]) return;
    st.rows[+li.dataset.i][node.dataset.k] = node.value;
    projectsChanged();
  }

  function onRowClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-act="drop"]') : null;
    if (!btn) return;
    st.rows.splice(+btn.dataset.i, 1);
    paintRows();
    projectsChanged();
  }

  function addRow() {
    if (st.rows.length >= MAX_PROJECTS) return;
    st.rows.push({ ...EMPTY_ROW });
    paintRows();
    el.projList.querySelector('.gm-proj-row:last-child [data-k="name"]')?.focus();
  }

  /**
   * 초안의 "과제 등록하기"·과제 기본 내용의 "고치기" — 사전 설정을 펴고, 과제 이름이 오면 그 과제 줄의 빈 칸(별명·번호·기간·내용 차례)에,
   * 아니면 빈 줄을 하나 내 준다.
   */
  function openPreset(name = '') {
    el.presetBox.open = true;
    if (!st.rows.length) addRow();
    const i = name ? st.rows.findIndex((r) => String(r.name).trim() === name) : -1;
    const row = i >= 0 ? el.projList.querySelector(`.gm-proj-row[data-i="${i}"]`) : null;
    (row || el.presetBox).scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    if (!row) return;
    const keys = ['alias', 'code', 'period', 'content'];
    const empty = keys.find((k) => !String(st.rows[i][k] ?? '').trim());
    row.querySelector(`[data-k="${empty || 'alias'}"]`)?.focus();
  }

  /* ---------------------------------------------------------- 채팅으로 채우기 */

  function paintChat() {
    el.chatLog.innerHTML = st.chat.map((m) => `<li class="gm-say ${m.who}${m.error ? ' error' : ''}">${escapeHtml(m.text)}</li>`).join('');
  }

  /** 글 칸이 붙여 넣은 줄 수만큼 자란다(여러 줄 표를 붙여 넣으면 보이게). */
  function growChat() {
    el.chatInput.style.height = 'auto';
    el.chatInput.style.height = `${Math.min(el.chatInput.scrollHeight + 2, 160)}px`;
  }

  /**
   * 붙여 넣은 글(과제 목록 표·"과제 …, 책임자 ○○○"·"부서장 ○○○"·"참조 ○○○")을 사전 설정에 얹는다(2026-10-07 사용자 지정).
   * 과제책임자는 합의자다. Claude 가 없으면 규칙으로 읽는다. 얹은 것은 곧바로 저장되고 사전 설정 칸에 보인다.
   */
  async function runChat() {
    const text = el.chatInput.value.trim();
    if (!text || st.chatBusy) return;
    st.chatBusy = true;
    el.chatGo.disabled = true;
    const said = text.length > 160 ? `${text.slice(0, 160)}…` : text;
    const answer = { who: 'ai', text: '읽는 중...' };
    st.chat.push({ who: 'me', text: said }, answer);
    paintChat();
    el.chatInput.value = '';
    growChat();
    const { apiKey, cli } = ai();
    const w = cur();
    try {
      const got = await gongmunSetupSmart(text, { preset: st.preset, projects: st.projects, current: w?.project || '' }, { apiKey, useNative: cli });
      const res = mergeSetup(st.rows, st.preset, got.patch, { current: w?.project || '' });
      if (!res.done.length) {
        answer.error = true;
        answer.text = res.skipped.length ? res.skipped.join('\n')
          : '과제·사람을 찾지 못했습니다 — "과제명, 책임자 ○○○" 처럼 적거나 과제 목록 표를 붙여 넣어 주세요.';
      } else {
        st.rows = res.rows;
        st.preset = res.preset;
        savePreset();
        paintPreset();
        projectsChanged();
        if (w && !w.project) {
          w.project = defaultProject(w);
          saveWork();
          paintProjects();
          paintLive();
        }
        answer.text = [
          `${got.reply || '채웠습니다.'}${VIA_LABEL[got.via] ? ` (${VIA_LABEL[got.via]})` : ''}`,
          ...res.done.map((d) => `· ${d}`),
          ...res.skipped.map((d) => `· 넣지 못함 — ${d}`),
        ].join('\n');
        logEvent('gongmun-setup', true, `사전 설정 채우기 · ${res.done.join(' / ')} · ${VIA_LABEL[got.via] || got.via}`);
      }
    } catch (err) {
      answer.error = true;
      answer.text = err.message;
      logEvent('gongmun-setup', false, `사전 설정 채우기 실패 · ${err.message}`);
    } finally {
      st.chatBusy = false;
      el.chatGo.disabled = false;
      st.chat = st.chat.slice(-CHAT_KEEP);
      paintChat();
    }
  }

  function onChatKey(e) {
    // 한글은 조합 중에 Enter 가 한 번 더 온다 — 조합이 끝난 Enter 만 받는다. Shift+Enter 는 줄바꿈이다.
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    runChat();
  }

  /* ---------------------------------------------------------- 탭 */

  function wire() {
    el.kinds.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest('[data-kind]') : null;
      if (b) setKind(b.dataset.kind);
    });
    el.file.addEventListener('change', () => {
      const files = [...el.file.files];
      el.file.value = '';
      intake({ files });
    });
    el.chatGo.addEventListener('click', runChat);
    el.chatInput.addEventListener('keydown', onChatKey);
    el.chatInput.addEventListener('input', growChat);
    el.capture.addEventListener('click', onCaptureClick);
    el.manual.addEventListener('click', startManual);
    el.reset.addEventListener('click', resetWork);
    el.cut.addEventListener('click', onCutClick);
    el.projects.addEventListener('click', onProjectClick);
    el.projInfo.addEventListener('click', onProjectClick);
    el.fields.addEventListener('input', onFieldInput);
    el.fields.addEventListener('change', onFieldInput);
    el.fields.addEventListener('click', onFieldClick);
    el.title.addEventListener('input', onDocInput);
    el.body.addEventListener('input', onDocInput);
    el.regen.addEventListener('click', regen);
    el.copyTitle.addEventListener('click', copyTitle);
    el.copyBody.addEventListener('click', copyBody);
    el.open.addEventListener('click', openDraft);
    el.savePdf.addEventListener('click', savePdf);
    for (const node of [el.tplForm, el.tplFormId, el.tplTitle, el.tplBody]) {
      node.addEventListener('input', onTplInput);
      node.addEventListener('change', onTplInput);
    }
    el.tplReset.addEventListener('click', resetTpl);
    for (const node of [el.dept, el.head, el.refs]) node.addEventListener('input', onPresetInput);
    el.projList.addEventListener('input', onRowInput);
    el.projList.addEventListener('click', onRowClick);
    el.projAdd.addEventListener('click', addRow);
    for (const type of ['dragover', 'dragleave']) el.root.addEventListener(type, onDrag);
    el.root.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
  }

  /** 탭이 보일 때. 처음 한 번 저장해 둔 갈래·사전 설정·과제·양식·초안을 읽는다. */
  async function show() {
    el.root.classList.remove('hidden');
    if (!st.loaded) {
      const saved = await chrome.storage.local.get([KIND_KEY, PRESET_KEY, PROJECTS_KEY, TEMPLATES_KEY, DRAFT_KEY]);
      st.kind = KINDS[saved?.[KIND_KEY]] ? saved[KIND_KEY] : 'purchase';
      st.preset = normalizePreset(saved?.[PRESET_KEY]);
      st.projects = normalizeProjects(saved?.[PROJECTS_KEY]);
      st.rows = st.projects.map((p) => ({ ...p }));
      st.templates = saved?.[TEMPLATES_KEY] && typeof saved[TEMPLATES_KEY] === 'object' ? saved[TEMPLATES_KEY] : {};
      const kept = saved?.[DRAFT_KEY] && typeof saved[DRAFT_KEY] === 'object' ? saved[DRAFT_KEY] : {};
      st.lastProject = typeof kept.lastProject === 'string' ? kept.lastProject : '';
      for (const k of KIND_ORDER) {
        const w = kept[k];
        if (w?.draft && typeof w.draft === 'object' && !st.work[k]) {
          st.work[k] = { ...w, notes: Array.isArray(w.notes) ? w.notes : [], source: w.source || {}, files: [] };
          // 교육 구분 칸이 생기기 전에 쓰던 초안 — 교육장소로 정해 칸에 보인다.
          if (k === 'edu' && !w.draft.mode) st.work[k].draft = { ...w.draft, mode: eduModeOf(w.draft) };
        }
      }
      st.loaded = true;
    }
    paintKinds();
    paintChat();
    paintIntake();
    renderFields();
    paintDraft();
    paintTpl();
    paintPreset();
  }

  function hide() {
    el.root.classList.add('hidden');
  }

  /** 새로고침(↻). 사이트에서 읽어 올 것이 없다 — 화면만 다시 그린다. */
  async function reload() {
    return show();
  }

  /** Claude 에 닿는지. 닿지 않으면 문서 넣는 곳과 채팅 칸을 회색으로 내린다(문서 없이 쓰기·규칙으로 읽기는 된다). */
  function paintReady(ready) {
    st.ready = ready;
    el.chat.classList.toggle('off', !ready);
    paintIntake();
  }

  return { wire, show, hide, reload, paintReady, state: st };
}

async function defaultCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
