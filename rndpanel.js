// R&D 탭의 화면. 차년도 자르기·예산 셈·저절로 남는 변경이력·요약·가져오기·내보내기는 src/rnd.js 가 하고,
// 여기는 그것을 화면에 잇고 chrome.storage(rndBook)에 남긴다.
//
//   과제 칩(별칭) → 머리(별칭 한 줄 — 펴면 과제 정보) · 차년도 칩(오늘이 든 것에 "올해")
//   → 예산(비목 줄) · 참여연구자 · 연구개발 계획 · 진행 기록 · 변경이력 → 요약 복사 · JSON 저장·불러오기 → 연구개발계획서 YAML 넣기
//
// 어디에도 올리지 않는다 — 이 브라우저에만 남는다. 공문 탭의 공문 설정 과제를 가져올 수 있다(처음 열 때 과제가 없으면 저절로).
// 예산 **계획**을 고치거나 비목을 빼면, 과제의 책임자·연구기간을 고치면 변경이력에 저절로 한 줄이 남고 사유만 사람이 적는다.
// 과제는 별칭으로 다룬다 — 폼에서 별칭은 필수이고 과제끼리 겹치지 않으며, 별칭이 없는 과제는 머리에 정하는 칸이 선다.

import {
  BOOK_KEY, MAX_PROJECTS, CHANGE_KINDS, normalizeBook, normalizeProject, projectOf, aliasOwner, viewYear, yearBook, yearsOf, currentYear, yearLabel, yearState,
  periodText, dot, todayStr, isYmd, amountOf, comma, shortWon, budgetTotals, budgetChanges, projectChanges, newestFirst, newId,
  fromGongmun, mergeProjects, restoreBook, exportJson, exportName, importJson, summaryText, parseRoster, parseSections, fileLog, noteLogs,
  budgetTsv, entryText, logLines, changeLine, changeLines,
} from './src/rnd.js';
import { PROJECTS_KEY as GM_PROJECTS_KEY } from './src/gongmun.js';
import { kindOf, applyYaml, KIND_ORDER, revOf } from './src/rndyaml.js';
import { MANIFEST_PATH, checkManifest, skillGuide, bundleSkills, zipName, kb } from './src/rndskills.js';
import {
  NOTE_KEY, INFO_KEYS, normalizeNote, bookHash, syncInfo, blockHtml, findBlock, readBlock, openNote as defaultOpenNote,
  listSections, findPage, createPage, readPage, writeBlock,
} from './src/rndnote.js';

const SAVE_WAIT_MS = 400;
/** 지우기 버튼은 두 번 누른다 — 처음 누르면 이만큼 동안 "정말 지우기" 로 바뀌고, 그 안에 다시 누르면 지운다. */
const CONFIRM_MS = 3000;
/** 원노트 공유가 켜져 있으면 과제 정보를 고친 뒤 이만큼 기다렸다 맞춘다(그 사이 더 고치면 모아서 한 번). 탭을 열 때는 이만큼 지났을 때만. */
const NOTE_WAIT_MS = 1200;
const NOTE_OPEN_MS = 60_000;
/** 복사 아이콘(sidepanel.html 의 것과 같다) — 누르면 잠깐 체크(못 했으면 ×)로 바뀌었다 돌아온다. */
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>';
const DONE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>';
const FAIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
const copyBtn = (attr, what) => `<button type="button" class="rd-icon" ${attr} title="${what} 복사" aria-label="${what} 복사">${COPY_ICON}</button>`;

/**
 * @param {{$:Function, escapeHtml:Function, logEvent:Function, copyText?:(text:string) => Promise<boolean>,
 *   flash?:(btn:HTMLElement, text:string, ms?:number) => void, download?:(data:string|Uint8Array, filename:string, type?:string) => Promise<void>,
 *   readAsset?:(path:string, as?:'text'|'bytes') => Promise<string|Uint8Array>, today?:() => string,
 *   openNote?:() => Promise<{tool:(name:string, args:object, ms?:number) => Promise<any>}>}} deps
 *   readAsset 은 확장 안의 파일(rnd/skills.json · rnd/skills/…)을 읽는 길, today 는 검사에서 날짜를 못 박는 데 쓴다,
 *   openNote 는 OneNote MCP 서버에 붙는 길(검사에서는 흉내)
 */
export function createRndPanel({ $, escapeHtml, logEvent, copyText = defaultCopy, flash = () => {}, download = defaultDownload, readAsset = defaultReadAsset, today = todayStr, openNote = defaultOpenNote }) {
  const el = {
    root: $('rnd'), projects: $('rdProjects'), empty: $('rdEmpty'), emptyImport: $('rdEmptyImport'), emptyAdd: $('rdEmptyAdd'),
    intake: $('rdIntake'), yaml: $('rdYaml'),
    head: $('rdHead'), info: $('rdInfo'), name: $('rdName'), edit: $('rdEdit'), meta: $('rdMeta'), years: $('rdYears'), yearNote: $('rdYearNote'),
    aliasAsk: $('rdAliasAsk'), aliasIn: $('rdAliasIn'), aliasSet: $('rdAliasSet'),
    form: $('rdForm'), formTitle: $('rdFormTitle'), fName: $('rdFName'), fAlias: $('rdFAlias'), fCode: $('rdFCode'), fLead: $('rdFLead'),
    fStart: $('rdFStart'), fEnd: $('rdFEnd'), fCalendar: $('rdFCalendar'), fNote: $('rdFNote'), fNeed: $('rdFNeed'), fSave: $('rdFSave'), fCancel: $('rdFCancel'), fDel: $('rdFDel'),
    status: $('rdStatus'), body: $('rdBody'),
    budgetState: $('rdBudgetState'), budget: $('rdBudget'), budgetSum: $('rdBudgetSum'), budgetAdd: $('rdBudgetAdd'), budgetCopy: $('rdBudgetCopy'),
    rosterState: $('rdRosterState'), roster: $('rdRoster'), rosterTools: $('rdRosterTools'), rosterSrc: $('rdRosterSrc'), rosterCopy: $('rdRosterCopy'),
    planState: $('rdPlanState'), plan: $('rdPlan'), planTools: $('rdPlanTools'), planSrc: $('rdPlanSrc'), planCopy: $('rdPlanCopy'),
    logState: $('rdLogState'), logDate: $('rdLogDate'), logTitle: $('rdLogTitle'), logText: $('rdLogText'), logAdd: $('rdLogAdd'), logCancel: $('rdLogCancel'), logs: $('rdLogs'), logsCopy: $('rdLogsCopy'),
    changeState: $('rdChangeState'), chDate: $('rdChDate'), chKind: $('rdChKind'), chItem: $('rdChItem'), chBefore: $('rdChBefore'), chAfter: $('rdChAfter'),
    chReason: $('rdChReason'), chAdd: $('rdChAdd'), chCancel: $('rdChCancel'), changes: $('rdChanges'), changesCopy: $('rdChangesCopy'),
    copy: $('rdCopy'), export: $('rdExport'), import: $('rdImport'), importGm: $('rdImportGm'),
    skillBox: $('rdSkillBox'), skillState: $('rdSkillState'), skills: $('rdSkills'), skillZip: $('rdSkillZip'), skillGuide: $('rdSkillGuide'),
    noteState: $('rdNoteState'), noteOn: $('rdNoteOn'), noteSection: $('rdNoteSection'), noteSections: $('rdNoteSections'), noteSync: $('rdNoteSync'),
    noteOpen: $('rdNoteOpen'), noteMsg: $('rdNoteMsg'),
  };
  const st = {
    loaded: false, book: normalizeBook(null),
    // editing 은 고치는 중인 과제 id('new' 는 새 과제). snap 은 그린 시점의 예산 줄 — 계획이 바뀌었는지 이것과 견준다.
    editing: null, snap: [], logEdit: null, chEdit: null,
    // 스킬 목록(rnd/skills.json)은 그 칸을 처음 펼 때 읽는다. 못 읽었으면 까닭을 둔다.
    manifest: null, manifestError: '',
    // 원노트 공유 — 저장해 두는 형편(rndNote), 마지막으로 맞춘 장부의 지문(고친 것이 있는지), 도는 중인 맞추기와 그 사이 들어온 요청.
    note: normalizeNote(null), noteHash: '', noteRun: null, noteAgain: false, noteBusy: false,
  };

  const cur = () => projectOf(st.book, st.book.current.project);
  const curYear = (p) => viewYear(st.book, p, today());
  const curBook = (p) => yearBook(p, curYear(p));
  const label = (p) => p.alias || p.name;

  function setStatus(msg, kind = '') {
    el.status.className = `status ${kind}`;
    el.status.textContent = msg;
  }

  /* ---------------------------------------------------------- 저장 */

  let timer = null;
  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => chrome.storage.local.set({ [BOOK_KEY]: st.book }), SAVE_WAIT_MS);
    noteSoon();
  }

  /* ---------------------------------------------------------- 두 번 누르기 */

  const armed = new WeakMap();
  /** 처음 누르면 글이 바뀌고(CONFIRM_MS 동안), 그 안에 다시 누르면 true. */
  function confirmTwice(btn, text) {
    if (armed.has(btn)) {
      clearTimeout(armed.get(btn));
      armed.delete(btn);
      btn.classList.remove('armed');
      return true;
    }
    const was = btn.textContent;
    btn.textContent = text;
    btn.classList.add('armed');
    armed.set(btn, setTimeout(() => {
      armed.delete(btn);
      btn.textContent = was;
      btn.classList.remove('armed');
    }, CONFIRM_MS));
    return false;
  }

  /* ---------------------------------------------------------- 과제 */

  function paintProjects() {
    const p = cur();
    const full = st.book.projects.length >= MAX_PROJECTS;
    const chips = st.book.projects.map((x) => {
      const on = x.id === p?.id;
      return `<button type="button" class="rd-proj${on ? ' active' : ''}" data-proj="${x.id}" aria-pressed="${on}" title="${escapeHtml(x.name)}${x.code ? ` · ${escapeHtml(x.code)}` : ''}">${escapeHtml(label(x))}</button>`;
    });
    chips.push(`<button type="button" class="rd-proj rd-proj-add" data-add="1" aria-label="과제 더하기" title="${full ? `과제는 ${MAX_PROJECTS}개까지입니다` : '과제 더하기'}"${full ? ' disabled' : ''}>＋</button>`);
    el.projects.innerHTML = chips.join('');
    el.projects.classList.toggle('hidden', !st.book.projects.length);
    el.empty.classList.toggle('hidden', !!st.book.projects.length || st.editing != null);
  }

  function pickProject(id) {
    if (!projectOf(st.book, id) || id === st.book.current.project) return;
    st.book.current.project = id;
    clearLogForm();
    clearChangeForm();
    setStatus('');
    paintAll();
    save();
  }

  function paintHead() {
    const p = cur();
    const editing = st.editing != null;
    el.head.classList.toggle('hidden', !p || editing);
    el.body.classList.toggle('hidden', !p || editing);
    if (!p) return;
    el.name.textContent = label(p);
    el.name.title = p.name;
    el.aliasAsk.classList.toggle('hidden', !!p.alias);
    const ys = yearsOf(p);
    // 과제 정보는 접힌 칸 안에 — 머리에는 별칭 한 줄과 차년도 칩만 늘 보인다.
    const meta = [['과제명', p.name]];
    if (p.code) meta.push(['과제번호', p.code]);
    if (p.lead) meta.push(['책임자', p.lead]);
    meta.push(['연구기간', p.start ? `${periodText(p)} (총 ${ys.length}차년도${p.calendar ? ' · 1월 1일 기준' : ''})` : '미정 — 과제 고치기에서 시작일·종료일을 적으세요']);
    if (p.note) meta.push(['비고', p.note]);
    el.meta.innerHTML = meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
    const now = currentYear(p, today());
    const view = curYear(p);
    el.years.innerHTML = ys.map((y) => {
      const on = y.n === view;
      const title = y.start ? `${dot(y.start)} ~ ${dot(y.end)}` : '연구기간 미정';
      return `<button type="button" class="rd-year${on ? ' active' : ''}${y.n === now ? ' now' : ''}" data-year="${y.n}" aria-pressed="${on}" title="${title}">${yearLabel(y.n)}${y.n === now && y.start ? '<small>올해</small>' : ''}</button>`;
    }).join('');
    const y = ys.find((x) => x.n === view) || ys[0];
    el.yearNote.textContent = `${yearLabel(y.n)}${y.start ? ` · ${dot(y.start)} ~ ${dot(y.end)}` : ''} · ${yearState(y, today())}`;
  }

  /** 별칭이 없는 과제에 머리의 칸에서 별칭을 정한다 — 다른 과제의 별칭과 겹치면 안 된다. */
  function setAlias() {
    const p = cur();
    if (!p) return;
    const alias = el.aliasIn.value.trim().slice(0, 60);
    const dup = aliasOwner(st.book, alias, p.id);
    if (!alias || dup) {
      setStatus(alias ? `같은 별칭의 과제가 있습니다 — ${dup.name}` : '별칭을 적으세요 — 예) SSCB', 'error');
      el.aliasIn.focus();
      return;
    }
    p.alias = alias;
    el.aliasIn.value = '';
    setStatus(`별칭을 정했습니다 — ${alias}`);
    logEvent('rnd', true, `R&D 과제 별칭: ${p.name} → ${alias}`);
    paintAll();
    save();
  }

  function pickYear(n) {
    const p = cur();
    if (!p || !yearsOf(p).some((y) => y.n === n) || n === curYear(p)) return;
    st.book.current.year[p.id] = n;
    clearLogForm();
    clearChangeForm();
    setStatus('');
    paintAll();
    save();
  }

  /* ---------------------------------------------------------- 과제 폼 */

  function openForm(id) {
    const p = id === 'new' ? normalizeProject({}) : projectOf(st.book, id);
    if (!p) return;
    st.editing = id;
    el.formTitle.textContent = id === 'new' ? '새 과제' : '과제 고치기';
    el.fName.value = p.name;
    el.fAlias.value = p.alias;
    el.fCode.value = p.code;
    el.fLead.value = p.lead;
    el.fStart.value = p.start;
    el.fEnd.value = p.end;
    el.fCalendar.checked = !!p.calendar;
    el.fNote.value = p.note;
    el.fNeed.textContent = '';
    el.fDel.classList.toggle('hidden', id === 'new');
    el.form.classList.remove('hidden');
    paintProjects();
    paintHead();
    el.fName.focus();
  }

  function closeForm() {
    st.editing = null;
    el.form.classList.add('hidden');
    paintAll();
  }

  function saveForm() {
    const draft = normalizeProject({
      id: st.editing === 'new' ? '' : st.editing, name: el.fName.value, alias: el.fAlias.value, code: el.fCode.value, lead: el.fLead.value,
      start: el.fStart.value, end: el.fEnd.value, calendar: el.fCalendar.checked, note: el.fNote.value,
    });
    if (!draft.name) {
      el.fNeed.textContent = '과제명을 적으세요.';
      el.fName.focus();
      return;
    }
    const dup = aliasOwner(st.book, draft.alias, st.editing === 'new' ? '' : st.editing);
    if (!draft.alias || dup) {
      el.fNeed.textContent = dup ? `같은 별칭의 과제가 있습니다 — ${dup.name}` : '별칭을 적으세요 — 칩과 머리에 과제명 대신 이 이름으로 보입니다.';
      el.fAlias.focus();
      return;
    }
    if (el.fStart.value && el.fEnd.value && el.fEnd.value < el.fStart.value) {
      el.fNeed.textContent = '종료일이 시작일보다 앞섭니다.';
      el.fEnd.focus();
      return;
    }
    if (st.editing === 'new') {
      if (st.book.projects.length >= MAX_PROJECTS) {
        el.fNeed.textContent = `과제는 ${MAX_PROJECTS}개까지입니다.`;
        return;
      }
      st.book.projects.push(draft);
      st.book.current.project = draft.id;
      logEvent('rnd', true, `R&D 과제 더함: ${draft.name}`);
      setStatus(`과제를 더했습니다 — ${label(draft)}`);
    } else {
      const p = projectOf(st.book, st.editing);
      if (!p) return closeForm();
      const changes = projectChanges(p, draft, today());
      Object.assign(p, { name: draft.name, alias: draft.alias, code: draft.code, lead: draft.lead, start: draft.start, end: draft.end, calendar: draft.calendar, note: draft.note });
      if (changes.length) {
        // 연구기간이 바뀌어 차년도가 달라졌을 수 있다 — 고친 뒤의 보고 있는 차년도에 남긴다.
        yearBook(p, viewYear(st.book, p, today())).changes.push(...changes);
        setStatus(`과제 정보를 고치고 변경이력에 ${changes.length}건을 남겼습니다 — 사유를 적어 두세요.`);
      } else {
        setStatus('과제 정보를 고쳤습니다.');
      }
    }
    closeForm();
    save();
  }

  function delProject() {
    const p = projectOf(st.book, st.editing);
    if (!p) return;
    if (!confirmTwice(el.fDel, '정말 지우기')) return;
    st.book.projects = st.book.projects.filter((x) => x.id !== p.id);
    delete st.book.current.year[p.id];
    st.book.current.project = st.book.projects[0]?.id || '';
    logEvent('rnd', true, `R&D 과제 지움: ${p.name}`);
    setStatus(`과제를 지웠습니다 — ${label(p)}`);
    closeForm();
    save();
  }

  /* ---------------------------------------------------------- 예산 */

  const left = (r) => (r.plan != null || r.used != null ? (r.plan || 0) - (r.used || 0) : null);
  const rate = (r) => (r.plan > 0 ? Math.round(((r.used || 0) / r.plan) * 100) : 0);

  function rowHtml(r) {
    const l = left(r);
    const name = escapeHtml(r.item || '비목');
    return `<div class="rd-brow" role="row" data-row="${r.id}">`
      + `<input type="text" data-k="item" value="${escapeHtml(r.item)}" placeholder="비목" aria-label="비목" autocomplete="off" />`
      + `<input type="text" data-k="plan" value="${r.plan == null ? '' : comma(r.plan)}" placeholder="0" inputmode="numeric" aria-label="${name} 계획" autocomplete="off" />`
      + `<input type="text" data-k="used" value="${r.used == null ? '' : comma(r.used)}" placeholder="0" inputmode="numeric" aria-label="${name} 집행" autocomplete="off" />`
      + `<span class="rd-left${l < 0 ? ' over' : ''}" data-left title="잔액">${l == null ? '' : comma(l)}</span>`
      + `<button type="button" class="rd-brow-del" data-del="${r.id}" title="이 비목 빼기" aria-label="${name} 빼기">×</button>`
      + `<i class="rd-bar${rate(r) > 100 ? ' over' : ''}" style="width:${Math.min(100, rate(r))}%" aria-hidden="true"></i>`
      + '</div>';
  }

  function paintBudget() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    el.budget.innerHTML = b.budget.map(rowHtml).join('');
    paintSum(b);
    st.snap = b.budget.map((r) => ({ ...r }));
  }

  function paintSum(b) {
    const sum = budgetTotals(b.budget);
    const any = b.budget.some((r) => r.plan != null || r.used != null);
    el.budgetSum.innerHTML = any
      ? `<span>합계</span><span>${comma(sum.plan)}</span><span>${comma(sum.used)}</span><span class="rd-left${sum.left < 0 ? ' over' : ''}">${comma(sum.left)}</span><span></span>`
      : '';
    el.budgetState.textContent = any ? `계획 ${shortWon(sum.plan)} · 집행 ${shortWon(sum.used)}${sum.rate == null ? '' : ` (${sum.rate}%)`}` : '적은 것 없음';
  }

  /** 한 줄의 금액을 다시 적는다 — 줄을 통째로 다시 그리면 Tab 으로 옮겨 가던 초점이 사라진다. */
  function refreshRow(rowEl, r) {
    for (const k of ['plan', 'used']) {
      const input = rowEl.querySelector(`[data-k="${k}"]`);
      if (input && document.activeElement !== input) input.value = r[k] == null ? '' : comma(r[k]);
    }
    const l = left(r);
    const span = rowEl.querySelector('[data-left]');
    span.textContent = l == null ? '' : comma(l);
    span.classList.toggle('over', l < 0);
    const bar = rowEl.querySelector('.rd-bar');
    bar.style.width = `${Math.min(100, rate(r))}%`;
    bar.classList.toggle('over', rate(r) > 100);
  }

  function rowOf(e) {
    const node = e.target;
    const rowEl = node instanceof HTMLElement ? node.closest('[data-row]') : null;
    const p = cur();
    const r = rowEl && p ? curBook(p).budget.find((x) => x.id === rowEl.dataset.row) : null;
    return r ? { node, rowEl, p, r } : null;
  }

  function onBudgetInput(e) {
    const hit = rowOf(e);
    if (!hit || hit.node.dataset.k !== 'item') return;
    hit.r.item = hit.node.value.trim().slice(0, 60);
    save();
  }

  /** 금액은 다 적고(change) 읽는다 — 적는 중의 "1,5" 를 읽으면 틀린다. */
  function onBudgetChange(e) {
    const hit = rowOf(e);
    if (!hit || !['plan', 'used'].includes(hit.node.dataset.k)) return;
    const { node, rowEl, p, r } = hit;
    const k = node.dataset.k;
    const v = amountOf(node.value);
    if (node.value.trim() && v == null) {
      setStatus(`금액을 읽지 못했습니다 — "${node.value}". 1,500,000 처럼 숫자로, 또는 150만 · 1.5억 처럼 적으세요.`, 'error');
      node.value = r[k] == null ? '' : comma(r[k]);
      return;
    }
    if (r[k] === v) return;
    r[k] = v;
    node.value = v == null ? '' : comma(v);
    commitBudget(p, rowEl, r);
  }

  /** 예산 줄을 적은 뒤 — 계획이 바뀐 줄을 변경이력에 남긴다. rowEl 을 주면 그 줄만 다시 적고, 없으면 표를 다시 그린다. */
  function commitBudget(p, rowEl = null, r = null) {
    const b = curBook(p);
    const changes = budgetChanges(st.snap, b.budget, today());
    if (changes.length) {
      b.changes.push(...changes);
      setStatus(`예산 계획이 바뀌어 변경이력에 ${changes.length}건을 남겼습니다 — 사유를 적어 두세요.`);
      paintChanges();
    }
    if (rowEl && r) {
      refreshRow(rowEl, r);
      paintSum(b);
      st.snap = b.budget.map((x) => ({ ...x }));
    } else {
      paintBudget();
    }
    save();
  }

  function addBudgetRow() {
    const p = cur();
    if (!p) return;
    curBook(p).budget.push({ id: newId(), item: '', plan: null, used: null });
    paintBudget();
    save();
    el.budget.querySelector('.rd-brow:last-child [data-k="item"]')?.focus();
  }

  function onBudgetClick(e) {
    const btn = e.target instanceof HTMLElement ? e.target.closest('[data-del]') : null;
    const p = cur();
    if (!btn || !p) return;
    const b = curBook(p);
    const r = b.budget.find((x) => x.id === btn.dataset.del);
    if (!r) return;
    // 금액이 적힌 줄은 두 번 눌러야 뺀다. 빈 줄은 바로.
    if ((r.plan || r.used) && !confirmTwice(btn, '정말')) return;
    b.budget = b.budget.filter((x) => x !== r);
    commitBudget(p);
  }

  /* ---------------------------------------------------------- 참여연구자 · 연구개발 계획(계획서에서 온 것) */

  /** 계획서(YAML)에서 온 두 줄을 저마다의 칸에 — 참여연구자는 표, 계획은 절 제목과 목록. 없으면 넣는 곳을 짚어 준다. */
  function paintFiles() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    const src = `연구개발계획서${b.snapshot?.rev ? ` ${b.snapshot.rev}` : ''} 기준`;
    const none = (what) => `<p class="rd-hint">아직 없습니다 — 맨 아래 칸에 연구개발계획서 YAML(KR_&lt;과제&gt;.yaml)을 넣으면 이 차년도의 ${what} 섭니다.</p>`;

    const roster = fileLog(b, 'roster');
    const people = roster ? parseRoster(roster.text) : null;
    const pay = (people || []).reduce((a, x) => a + (amountOf(x.pay) || 0), 0);
    el.roster.innerHTML = roster ? (people ? rosterHtml(people) : `<p class="rd-text">${escapeHtml(roster.text)}</p>`) : none('참여연구자가');
    el.rosterState.textContent = !roster ? '계획서 없음' : people ? `${people.length}명${pay ? ` · 인건비 ${shortWon(pay)}` : ''}` : '있음';
    el.rosterSrc.textContent = roster ? src : '';
    el.rosterTools.classList.toggle('hidden', !roster);

    const plan = fileLog(b, 'plan');
    const secs = plan ? parseSections(plan.text) : null;
    const goals = secs?.find((s) => s.title === '개발목표')?.items.length || 0;
    const months = secs?.find((s) => s.title === '수행일정')?.note || '';
    el.plan.innerHTML = plan ? (secs ? sectionsHtml(secs) : `<p class="rd-text">${escapeHtml(plan.text)}</p>`) : none('연구개발 계획이');
    el.planState.textContent = !plan ? '계획서 없음' : [goals ? `목표 ${goals}개` : '', months].filter(Boolean).join(' · ') || '있음';
    el.planSrc.textContent = plan ? src : '';
    el.planTools.classList.toggle('hidden', !plan);
  }

  /* ---------------------------------------------------------- 진행 기록(손으로 적는 연구내역) */

  function paintLogs() {
    const p = cur();
    if (!p) return;
    const notes = noteLogs(curBook(p));
    el.logs.innerHTML = newestFirst(notes).map((l) => `<li data-log="${l.id}" class="${l.id === st.logEdit ? 'editing' : ''}">`
      + `<div class="rd-row-head"><span class="rd-date">${escapeHtml(dot(l.date) || '날짜 없음')}</span><strong class="rd-title">${escapeHtml(l.title)}</strong>`
      + `<span class="rd-row-btns">${copyBtn(`data-copy="${l.id}"`, '이 줄')}<button type="button" class="ghost small" data-edit="${l.id}">고치기</button><button type="button" class="ghost small rd-del" data-del="${l.id}">지우기</button></span></div>`
      + logBody(l)
      + '</li>').join('');
    el.logState.textContent = notes.length ? `${notes.length}건` : '적은 것 없음';
  }

  /**
   * 기록의 내용을 보기 좋게 — 참여연구자 줄들은 표로, ■ 절·번호·줄표·점은 절 제목과 목록으로, 그 밖의 글은 그대로.
   * 글은 안 바꾼다(고치기·요약 복사는 글 그대로) — 보일 때만 꼴을 입힌다.
   */
  function logBody(l) {
    if (!l.text) return '';
    const people = parseRoster(l.text);
    if (people) return rosterHtml(people);
    const secs = parseSections(l.text);
    if (secs) return sectionsHtml(secs);
    return `<p class="rd-text">${escapeHtml(l.text)}</p>`;
  }

  function rosterHtml(people) {
    const cols = [['name', '성명'], ['role', '직위'], ['rate', '계상률'], ['months', '참여'], ['pay', '계상인건비']].filter(([k]) => people.some((x) => x[k]));
    return `<table class="rd-table"><thead><tr>${cols.map(([, h]) => `<th>${h}</th>`).join('')}</tr></thead><tbody>`
      + people.map((x) => `<tr>${cols.map(([k]) => `<td class="rd-td-${k}">${escapeHtml(x[k])}</td>`).join('')}</tr>`).join('')
      + '</tbody></table>';
  }

  function sectionsHtml(secs) {
    // "항목: 값" 꼴은 항목을 굵게 — 성능목표의 "규정 공백 분석: 1 건 (자체평가)".
    const line = (s) => {
      const m = s.match(/^([^:：]{2,40})[:：] (.+)$/);
      return m ? `<b>${escapeHtml(m[1])}</b> ${escapeHtml(m[2])}` : escapeHtml(s);
    };
    const item = (it) => `<li>${line(it.text)}${it.subs.length ? `<ul>${it.subs.map((x) => `<li>${line(x)}</li>`).join('')}</ul>` : ''}</li>`;
    return `<div class="rd-secs">${secs.map((s) => {
      const tag = s.items.length && s.items.every((it) => it.n > 0) ? 'ol' : 'ul';
      const head = s.title ? `<h4>${escapeHtml(s.title)}${s.note ? `<small>${escapeHtml(s.note)}</small>` : ''}</h4>` : '';
      return `<section class="rd-sec">${head}<${tag}>${s.items.map(item).join('')}</${tag}></section>`;
    }).join('')}</div>`;
  }

  function clearLogForm() {
    st.logEdit = null;
    el.logDate.value = today();
    el.logTitle.value = '';
    el.logText.value = '';
    el.logAdd.textContent = '기록';
    el.logCancel.classList.add('hidden');
  }

  function addLog() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    const title = el.logTitle.value.trim().slice(0, 200);
    const text = el.logText.value.trim().slice(0, 4000);
    if (!title && !text) {
      setStatus('진행 기록의 제목이나 내용을 적으세요.', 'error');
      el.logTitle.focus();
      return;
    }
    const date = isYmd(el.logDate.value) ? el.logDate.value : today();
    const hit = st.logEdit ? b.logs.find((x) => x.id === st.logEdit) : null;
    if (hit) {
      Object.assign(hit, { date, title, text });
      setStatus('진행 기록을 고쳤습니다.');
    } else {
      b.logs.push({ id: newId(), date, title, text });
      setStatus('진행 기록을 적었습니다.');
    }
    clearLogForm();
    paintLogs();
    save();
  }

  function onLogsClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('button[data-copy],button[data-edit],button[data-del]') : null;
    const p = cur();
    if (!btn || !p) return;
    const b = curBook(p);
    if (btn.dataset.copy) {
      const l = b.logs.find((x) => x.id === btn.dataset.copy);
      if (l) copyWith(btn, entryText(l), `진행 기록 한 줄: ${l.title}`);
      return;
    }
    if (btn.dataset.edit) {
      const l = b.logs.find((x) => x.id === btn.dataset.edit);
      if (!l) return;
      st.logEdit = l.id;
      el.logDate.value = l.date || today();
      el.logTitle.value = l.title;
      el.logText.value = l.text;
      el.logAdd.textContent = '저장';
      el.logCancel.classList.remove('hidden');
      paintLogs();
      el.logTitle.focus();
      return;
    }
    if (!confirmTwice(btn, '정말 지우기')) return;
    b.logs = b.logs.filter((x) => x.id !== btn.dataset.del);
    if (st.logEdit === btn.dataset.del) clearLogForm();
    paintLogs();
    save();
    setStatus('진행 기록을 지웠습니다.');
  }

  /* ---------------------------------------------------------- 변경이력 */

  function paintChanges() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    el.changes.innerHTML = newestFirst(b.changes).map((c) => {
      const diff = c.before || c.after ? `<p class="rd-diff"><s>${escapeHtml(c.before || '(없음)')}</s><span class="rd-arrow" aria-hidden="true">→</span><b>${escapeHtml(c.after || '(없음)')}</b></p>` : '';
      // 사유가 비었으면 그 자리에서 적는 칸 — 저절로 남은 줄은 왜 바꿨는지를 사람이 적어야 이력이 된다.
      const reason = c.reason
        ? `<p class="rd-reason">${escapeHtml(c.reason)}</p>`
        : `<input type="text" class="rd-reason-in" data-reason="${c.id}" placeholder="${c.auto ? '사유 — 저절로 남은 줄입니다. 왜 바꿨는지 적어 두세요' : '사유'}" aria-label="사유" autocomplete="off" />`;
      return `<li data-ch="${c.id}" class="${c.auto ? 'auto' : ''}${c.id === st.chEdit ? ' editing' : ''}">`
        + `<div class="rd-row-head"><span class="rd-date">${escapeHtml(dot(c.date) || '날짜 없음')}</span><span class="rd-kind">${escapeHtml(c.kind)}</span><strong class="rd-title">${escapeHtml(c.item)}</strong>`
        + `<span class="rd-row-btns">${copyBtn(`data-copy="${c.id}"`, '이 줄')}<button type="button" class="ghost small" data-edit="${c.id}">고치기</button><button type="button" class="ghost small rd-del" data-del="${c.id}">지우기</button></span></div>`
        + diff + reason + '</li>';
    }).join('');
    const open = b.changes.filter((c) => c.auto && !c.reason).length;
    el.changeState.textContent = b.changes.length ? `${b.changes.length}건${open ? ` · 사유 없음 ${open}` : ''}` : '적은 것 없음';
  }

  function clearChangeForm() {
    st.chEdit = null;
    el.chDate.value = today();
    el.chKind.value = CHANGE_KINDS[0];
    for (const node of [el.chItem, el.chBefore, el.chAfter, el.chReason]) node.value = '';
    el.chAdd.textContent = '기록';
    el.chCancel.classList.add('hidden');
  }

  function addChange() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    const item = el.chItem.value.trim().slice(0, 100);
    const before = el.chBefore.value.trim().slice(0, 300);
    const after = el.chAfter.value.trim().slice(0, 300);
    const reason = el.chReason.value.trim().slice(0, 1000);
    if (!item && !before && !after && !reason) {
      setStatus('변경이력의 항목이나 변경 전·후를 적으세요.', 'error');
      el.chItem.focus();
      return;
    }
    const date = isYmd(el.chDate.value) ? el.chDate.value : today();
    const kind = CHANGE_KINDS.includes(el.chKind.value) ? el.chKind.value : '기타';
    const hit = st.chEdit ? b.changes.find((x) => x.id === st.chEdit) : null;
    if (hit) {
      Object.assign(hit, { date, kind, item, before, after, reason });
      setStatus('변경이력을 고쳤습니다.');
    } else {
      b.changes.push({ id: newId(), date, kind, item, before, after, reason, auto: false });
      setStatus('변경이력을 적었습니다.');
    }
    clearChangeForm();
    paintChanges();
    save();
  }

  function onChangesClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('button[data-copy],button[data-edit],button[data-del]') : null;
    const p = cur();
    if (!btn || !p) return;
    const b = curBook(p);
    if (btn.dataset.copy) {
      const c = b.changes.find((x) => x.id === btn.dataset.copy);
      if (c) copyWith(btn, changeLine(c), `변경이력 한 줄: ${c.item}`);
      return;
    }
    if (btn.dataset.edit) {
      const c = b.changes.find((x) => x.id === btn.dataset.edit);
      if (!c) return;
      st.chEdit = c.id;
      el.chDate.value = c.date || today();
      el.chKind.value = c.kind;
      el.chItem.value = c.item;
      el.chBefore.value = c.before;
      el.chAfter.value = c.after;
      el.chReason.value = c.reason;
      el.chAdd.textContent = '저장';
      el.chCancel.classList.remove('hidden');
      paintChanges();
      el.chItem.focus();
      return;
    }
    if (!confirmTwice(btn, '정말 지우기')) return;
    b.changes = b.changes.filter((x) => x.id !== btn.dataset.del);
    if (st.chEdit === btn.dataset.del) clearChangeForm();
    paintChanges();
    save();
    setStatus('변경이력을 지웠습니다.');
  }

  /** 줄 안의 사유 칸 — 다 적고 나가면(change) 그 줄에 붙는다. */
  function onReasonChange(e) {
    const node = e.target;
    if (!(node instanceof HTMLElement) || node.tagName !== 'INPUT' || !node.dataset.reason) return;
    const p = cur();
    const c = p ? curBook(p).changes.find((x) => x.id === node.dataset.reason) : null;
    if (!c) return;
    c.reason = node.value.trim().slice(0, 1000);
    if (c.reason) paintChanges();
    save();
  }

  /* ---------------------------------------------------------- 복사 */

  const iconTimers = new WeakMap();
  /** 복사 아이콘을 잠깐 체크(못 했으면 ×)로 — 글자 단추처럼 flash 로 글을 바꾸면 아이콘이 지워진다. */
  function iconFlash(btn, ok) {
    clearTimeout(iconTimers.get(btn));
    btn.classList.toggle('done', ok);
    btn.classList.toggle('fail', !ok);
    btn.innerHTML = ok ? DONE_ICON : FAIL_ICON;
    iconTimers.set(btn, setTimeout(() => {
      btn.classList.remove('done', 'fail');
      btn.innerHTML = COPY_ICON;
    }, ok ? 1500 : 3000));
  }

  /** 글을 복사하고 누른 버튼에 결과를 잠깐 보인다(아이콘 단추는 체크로). what 은 활동 기록에 적는 말. */
  async function copyWith(btn, text, what) {
    const p = cur();
    const ok = await copyText(text);
    if (btn.classList.contains('rd-icon')) iconFlash(btn, ok);
    else flash(btn, ok ? '복사됨 ✓' : '복사 못 함');
    logEvent('rnd', ok, `R&D 복사 — ${what}${p ? ` (${label(p)} ${yearLabel(curYear(p))})` : ''}`);
  }

  async function copySummary() {
    const p = cur();
    if (!p) return;
    const ok = await copyText(summaryText(p, curYear(p), today()));
    flash(el.copy, ok ? '복사했습니다 ✓' : '복사하지 못했습니다');
    logEvent('rnd', ok, `R&D 요약 복사: ${label(p)} ${yearLabel(curYear(p))}`);
  }

  const copyBudget = () => { const p = cur(); if (p) copyWith(el.budgetCopy, budgetTsv(curBook(p).budget), '예산 표'); };
  const copyLogs = () => { const p = cur(); const notes = p ? noteLogs(curBook(p)) : []; if (p) copyWith(el.logsCopy, logLines(notes).join('\n'), `진행 기록 ${notes.length}건`); };
  const copyFile = (btn, key, what) => { const p = cur(); const l = p ? fileLog(curBook(p), key) : null; if (l) copyWith(btn, entryText(l), what); };
  const copyChanges = () => { const p = cur(); if (p) copyWith(el.changesCopy, changeLines(curBook(p).changes).join('\n'), `변경이력 ${curBook(p).changes.length}건`); };

  /* ---------------------------------------------------------- 파일·가져오기 */

  async function exportBook() {
    const name = exportName(today());
    try {
      await download(exportJson(st.book), name, 'application/json');
      setStatus(`저장했습니다 — ${name}`);
      logEvent('rnd', true, `R&D 과제 JSON 저장: 과제 ${st.book.projects.length}개`, { name });
    } catch (err) {
      setStatus(`저장하지 못했습니다 — ${err.message}`, 'error');
    }
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const incoming = importJson(await readText(file));
      const res = restoreBook(st.book, incoming);
      st.book = res.book;
      st.editing = null;
      el.form.classList.add('hidden');
      clearLogForm();
      clearChangeForm();
      paintAll();
      save();
      setStatus(`들여왔습니다 — 바꿈 ${res.replaced.length} · 더함 ${res.added.length} (과제 ${st.book.projects.length}개)`);
      logEvent('rnd', true, `R&D 과제 JSON 불러옴: 바꿈 ${res.replaced.length} · 더함 ${res.added.length}`, { name: file.name });
    } catch (err) {
      setStatus(`들여오지 못했습니다 — ${err.message}`, 'error');
      logEvent('rnd', false, `R&D 과제 JSON 불러오기 실패: ${err.message}`, { name: file.name });
    }
  }

  /** 공문 탭의 공문 설정 과제를 가져온다. quiet 면(처음 열 때) 없어도 말하지 않는다. */
  async function importGongmun({ quiet = false } = {}) {
    const saved = await chrome.storage.local.get(GM_PROJECTS_KEY);
    const inc = fromGongmun(saved?.[GM_PROJECTS_KEY]);
    if (!inc.length) {
      if (!quiet) setStatus('공문 탭의 공문 설정에 과제가 없습니다.', 'error');
      return 0;
    }
    const res = mergeProjects(st.book, inc);
    st.book = res.book;
    const n = res.added.length + res.filled.length;
    const parts = [res.added.length ? `더함 ${res.added.length}` : '', res.filled.length ? `빈 칸 채움 ${res.filled.length}` : '', res.skipped.length ? `${MAX_PROJECTS}개를 넘어 뺌 ${res.skipped.length}` : ''].filter(Boolean);
    setStatus(n ? `공문 탭의 과제를 가져왔습니다 — ${parts.join(' · ')}` : '공문 탭의 과제는 이미 다 있습니다.');
    if (n) {
      logEvent('rnd', true, `공문 탭의 과제 가져옴: ${parts.join(' · ')}`);
      save();
    }
    paintAll();
    return n;
  }

  function readText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      fr.readAsText(file);
    });
  }

  /* ---------------------------------------------------------- 연구개발계획서 YAML 넣기 */

  let yamlLib = null;
  /** YAML 풀이(vendor/yaml — npm yaml 2.9.1 의 브라우저 빌드)는 처음 넣을 때만 읽어 들인다. */
  const loadYaml = async () => (yamlLib ||= await import('./vendor/yaml/index.js'));
  const isYamlFile = (f) => /\.ya?ml$/i.test(f?.name || '') || /yaml/i.test(f?.type || '');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  async function intakeFiles(files) {
    const list = [...(files || [])].filter(isYamlFile);
    if (!list.length) {
      setStatus('YAML 파일(.yaml · .yml)만 넣을 수 있습니다 — RND 폴더의 KR_<과제>.yaml 이나 history/*.yaml.', 'error');
      return;
    }
    const texts = [];
    for (const f of list) {
      try {
        texts.push({ name: f.name, text: await readText(f) });
      } catch (err) {
        setStatus(`${f.name}: ${err.message}`, 'error');
        return;
      }
    }
    await intakeTexts(texts);
  }

  /**
   * YAML 글들을 장부에 넣는다 — 풀어서 종류를 가리고(스냅샷 → 개정 레지스트리 → 예산 이력 → 참여연구원 이력 차례), 하나씩 넣는다.
   * 이력 파일은 주석의 과제명으로 과제를 찾고 없으면 보고 있는 과제에 넣는다. 하나라도 들어갔으면 그린 뒤 저장한다.
   */
  async function intakeTexts(texts) {
    el.intake.setAttribute('aria-busy', 'true');
    const lines = [];
    try {
      const { parse } = await loadYaml();
      const docs = [];
      for (const { name, text } of texts) {
        const what = name || '붙여 넣은 글';
        let obj;
        try {
          obj = parse(text);
        } catch (err) {
          throw new Error(`${what}: YAML 을 읽지 못했습니다 — ${String(err.message || err).split('\n')[0]}`);
        }
        const kind = kindOf(obj);
        if (!kind) throw new Error(`${what}: 아는 모양의 YAML 이 아닙니다 — 연구개발계획서 스냅샷(meta.과제명)이나 history 의 revisions·budget·researchers 파일을 넣으세요.`);
        docs.push({ name, text, obj, kind });
      }
      // 종류 차례(스냅샷 → 레지스트리 → 예산 → 참여연구원), 같은 종류는 판 차례(r0 → r1 → r2) — 놓인 차례와 상관없이 최종본이 남는다.
      docs.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || revOf(a.obj) - revOf(b.obj));
      for (const d of docs) {
        const p = cur();
        const res = applyYaml(st.book, d.obj, { text: d.text, file: d.name, current: p, n: p ? curYear(p) : 0, today: today() });
        lines.push(`${res.label}${d.name ? `(${d.name})` : ''}: ${res.summary}`);
        logEvent('rnd', true, `R&D YAML 넣음 — ${res.label}: ${res.summary}`, { file: d.name });
      }
      setStatus(lines.join(' / '));
    } catch (err) {
      setStatus(`${lines.length ? `${lines.join(' / ')} / ` : ''}${err.message}`, 'error');
      logEvent('rnd', false, `R&D YAML 넣기 실패: ${err.message}`);
    } finally {
      el.intake.removeAttribute('aria-busy');
      if (lines.length) {
        st.book = normalizeBook(st.book);
        clearLogForm();
        clearChangeForm();
        paintAll();
        save();
      }
      // 넣는 칸은 맨 아래라 알림 줄(머리 아래)이 화면 밖일 수 있다 — 결과가 보이게 끌어온다.
      el.status.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function onDrag(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (e.type === 'dragleave') {
      if (!el.root.contains(e.relatedTarget)) el.intake.classList.remove('over');
      return;
    }
    el.intake.classList.add('over');
  }

  function onDrop(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    el.intake.classList.remove('over');
    intakeFiles(e.dataTransfer.files);
  }

  /** 붙여 넣기 — 파일이면 그대로, 글이면 YAML 처럼 보일 때만(칸에 적는 중이면 가로채지 않는다). */
  function onPaste(e) {
    if (el.root.classList.contains('hidden')) return;
    const files = [...(e.clipboardData?.files || [])].filter(isYamlFile);
    if (files.length) {
      e.preventDefault();
      intakeFiles(files);
      return;
    }
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]');
    const text = typing ? '' : (e.clipboardData?.getData('text/plain') || '').trim();
    if (!text || !/^(#|meta:|entity:|project:|revisions:)/m.test(text)) return;
    e.preventDefault();
    intakeTexts([{ name: '', text }]);
  }

  /* ---------------------------------------------------------- 차년도 YAML 뽑는 스킬 */

  /** 스킬 목록(rnd/skills.json)을 읽어(한 번만) 그린다 — 칸을 펼 때나 버튼을 누를 때. 못 읽었으면 null. */
  async function loadManifest() {
    if (!st.manifest && !st.manifestError) {
      try {
        st.manifest = checkManifest(JSON.parse(await readAsset(MANIFEST_PATH)));
      } catch (err) {
        st.manifestError = err.message;
      }
    }
    paintSkills();
    return st.manifest;
  }

  function paintSkills() {
    const m = st.manifest;
    el.skillZip.disabled = !!st.manifestError;
    el.skillGuide.disabled = !!st.manifestError;
    if (!m) {
      el.skills.innerHTML = st.manifestError ? `<li class="rd-skill-miss">스킬 목록을 읽지 못했습니다 — ${escapeHtml(st.manifestError)}</li>` : '';
      el.skillState.textContent = st.manifestError ? '목록 없음' : 'Claude Code 스킬 묶음';
      return;
    }
    el.skills.innerHTML = m.skills.map((s) => `<li title="${escapeHtml(s.hint ? `인자: ${s.hint}` : '')}"><strong>${escapeHtml(s.name)}</strong><small>파일 ${s.files.length}개 · ${kb(s.bytes)}</small><p>${escapeHtml(s.summary || '')}</p></li>`).join('');
    el.skillState.textContent = `스킬 ${m.skills.length}개 · ${kb(m.skills.reduce((a, s) => a + s.bytes, 0))} · 복사 ${m.syncedAt || '?'}`;
  }

  /** 스킬 다섯 개를 zip 하나로 내려받는다 — 맨 앞에 쓰는 법(README.md). 받아서 과제 작업 프로젝트의 .claude/skills/ 에 푼다. */
  async function saveSkillZip() {
    const m = await loadManifest();
    if (!m) {
      setStatus(`스킬 목록을 읽지 못했습니다 — ${st.manifestError}`, 'error');
      return;
    }
    el.skillZip.disabled = true;
    try {
      const bytes = await bundleSkills(m, (path) => readAsset(path, 'bytes'), { today: today() });
      const name = zipName(today());
      await download(bytes, name, 'application/zip');
      flash(el.skillZip, '저장됨 ✓');
      setStatus(`스킬 묶음을 저장했습니다 — ${name} (${kb(bytes.length)}). 과제 작업 프로젝트의 .claude/skills/ 에 푸세요.`);
      logEvent('rnd', true, `R&D 스킬 묶음 저장: ${name}`, { bytes: bytes.length });
    } catch (err) {
      setStatus(`스킬 묶음을 만들지 못했습니다 — ${err.message}`, 'error');
      logEvent('rnd', false, `R&D 스킬 묶음 실패: ${err.message}`);
    } finally {
      el.skillZip.disabled = !!st.manifestError;
    }
  }

  async function copySkillGuide() {
    const m = await loadManifest();
    if (!m) {
      setStatus(`스킬 목록을 읽지 못했습니다 — ${st.manifestError}`, 'error');
      return;
    }
    copyWith(el.skillGuide, skillGuide(m, { today: today() }), '스킬 쓰는 법');
  }

  /* ---------------------------------------------------------- 원노트 공유(선택) */

  const saveNote = () => chrome.storage.local.set({ [NOTE_KEY]: st.note });
  const when = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  function paintNote() {
    const n = st.note;
    const busy = st.noteBusy;
    el.noteOn.checked = n.on;
    // 다시 열면 섹션 목록은 아직 안 불러왔다 — 고른 섹션 하나는 이름으로 세워 둔다.
    if (n.sectionId && ![...el.noteSection.options].some((o) => o.value === n.sectionId)) {
      el.noteSection.add(Object.assign(document.createElement('option'), { value: n.sectionId, textContent: n.sectionLabel || n.sectionId }));
    }
    el.noteSection.value = n.sectionId;
    el.noteSection.disabled = !n.on || busy;
    el.noteSections.disabled = !n.on || busy;
    el.noteSync.disabled = !n.on || !n.sectionId || busy;
    el.noteOpen.classList.toggle('hidden', !n.on || !n.webUrl);
    if (n.webUrl) el.noteOpen.href = n.webUrl;
    el.noteState.textContent = !n.on ? '꺼짐' : busy ? '맞추는 중…' : n.error ? '못 맞춤' : !n.sectionId ? '섹션을 고르세요' : n.at ? `맞춤 ${when(n.at)}` : '켜짐';
    el.noteMsg.textContent = n.on ? n.error || n.last : '';
    el.noteMsg.classList.toggle('error', !!n.error);
  }

  async function onNoteToggle() {
    st.note.on = el.noteOn.checked;
    st.note.error = '';
    saveNote();
    paintNote();
    logEvent('rnd', true, `R&D 원노트 공유 ${st.note.on ? '켬' : '끔'}`);
    if (!st.note.on) return;
    if (st.note.sectionId) await noteSync('켬');
    else await loadSections();
  }

  /** 내 노트북들의 섹션을 불러와 고르게 한다 — 다른 기기에서도 같은 섹션을 고르면 같은 페이지를 쓴다. */
  async function loadSections() {
    st.noteBusy = true;
    paintNote();
    try {
      const list = await listSections(await openNote());
      el.noteSection.innerHTML = `<option value="">섹션 고르기 — ${list.length}개</option>`
        + list.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)}</option>`).join('');
      st.note.error = '';
      st.note.last = list.length ? '과제 정보를 둘 섹션을 고르세요 — 다른 기기에서도 같은 노트북의 같은 섹션을 고릅니다.' : '섹션이 없습니다 — OneNote 에서 섹션을 하나 만들고 다시 불러오세요.';
    } catch (err) {
      st.note.error = String(err?.message || err);
    } finally {
      st.noteBusy = false;
      saveNote();
      paintNote();
    }
  }

  /** 섹션을 고르면 그 섹션의 페이지와 처음부터 맞춘다(지난 지문·묘비는 다른 페이지의 것이라 버린다). */
  async function onNoteSection() {
    const opt = el.noteSection.selectedOptions[0];
    Object.assign(st.note, { sectionId: el.noteSection.value, sectionLabel: el.noteSection.value ? opt?.textContent || '' : '', pageId: '', webUrl: '', memo: {}, del: {}, at: 0, error: '', last: '' });
    saveNote();
    paintNote();
    if (st.note.sectionId) await noteSync('섹션 고름');
  }

  /** 과제 정보를 고쳤으면(지난번에 맞춘 지문과 다르면) 잠깐 뒤 맞춘다. */
  let noteTimer = null;
  function noteSoon() {
    if (!st.note.on || !st.note.sectionId || bookHash(st.book) === st.noteHash) return;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => noteSync('고침'), NOTE_WAIT_MS);
  }

  /** 원노트에서 받은 것을 장부에 — 원노트 id 로 바꾸기 · 고침 · 더함 · 지움. 차년도 내용(예산·기록 …)은 건드리지 않는다. */
  function applyNote(res) {
    const b = st.book;
    for (const [from, to] of res.renames) {
      const p = projectOf(b, from);
      if (!p) continue;
      p.id = to;
      if (b.current.project === from) b.current.project = to;
      if (from in b.current.year) {
        b.current.year[to] = b.current.year[from];
        delete b.current.year[from];
      }
    }
    const info = new Map(res.projects.map((p) => [p.id, p]));
    for (const id of res.updated) {
      const p = projectOf(b, id);
      if (p) for (const k of INFO_KEYS) p[k] = info.get(id)[k];
    }
    for (const id of res.added) b.projects.push(normalizeProject({ ...info.get(id), years: {} }));
    b.projects = b.projects.filter((p) => !res.removed.includes(p.id));
    for (const id of res.removed) delete b.current.year[id];
    st.book = normalizeBook(b);
    if (st.editing && st.editing !== 'new' && !projectOf(st.book, st.editing)) {
      st.editing = null;
      el.form.classList.add('hidden');
    }
  }

  /**
   * 원노트의 과제 정보 페이지와 맞춘다 — 찾고(없으면 만들고) 읽어 syncInfo 로 맞춘 뒤, 장부에 받고 달라졌으면 페이지에 쓴다.
   * 한 번에 하나만 돈다(도는 중에 들어온 요청은 끝난 뒤 한 번 더). 던지지 않는다 — 까닭은 칸에 보인다.
   */
  function noteSync(reason = '') {
    if (!st.note.on || !st.note.sectionId) return Promise.resolve(false);
    clearTimeout(noteTimer);
    if (st.noteRun) {
      st.noteAgain = true;
      return st.noteRun;
    }
    st.noteRun = (async () => {
      st.noteBusy = true;
      paintNote();
      let ok = false;
      try {
        const nc = await openNote();
        const sectionId = st.note.sectionId;
        let page = st.note.pageId ? { pageId: st.note.pageId, webUrl: st.note.webUrl } : await findPage(nc, sectionId);
        let html = '';
        if (page) {
          try {
            html = await readPage(nc, page.pageId);
          } catch (err) {
            // 기억해 둔 페이지가 지워졌거나 옮겨졌을 수 있다 — 섹션에서 다시 찾는다.
            if (!st.note.pageId) throw err;
            page = await findPage(nc, sectionId);
            html = page ? await readPage(nc, page.pageId) : '';
          }
        }
        const block = html ? findBlock(html) : null;
        const remote = (block && readBlock(block.inner)) || { projects: [], del: {} };
        const res = syncInfo(st.book.projects, remote, { memo: st.note.memo, del: st.note.del, now: Date.now() });
        const local = res.renames.length + res.added.length + res.updated.length + res.removed.length;
        if (local) {
          applyNote(res);
          paintAll();
        }
        st.noteHash = bookHash(st.book);
        if (local) save();
        const out = blockHtml(res.page);
        if (!page) page = await createPage(nc, sectionId, out);
        else if (res.push || !block) await writeBlock(nc, page.pageId, out, block);
        const parts = [
          res.added.length ? `원노트에서 더함 ${res.added.length}` : '', res.updated.length ? `받아 고침 ${res.updated.length}` : '',
          res.removed.length ? `지움 ${res.removed.length}` : '', res.renames.length ? `같은 과제 묶음 ${res.renames.length}` : '',
          res.push || !block ? '원노트에 씀' : '',
        ].filter(Boolean);
        const msg = `맞췄습니다 — ${parts.join(' · ') || '달라진 것 없음'} (과제 ${res.projects.length}개)`;
        Object.assign(st.note, { pageId: page.pageId, webUrl: page.webUrl || st.note.webUrl, memo: res.memo, del: res.del, at: Date.now(), error: '', last: msg });
        logEvent('rnd', true, `R&D 원노트 맞춤(${reason}): ${parts.join(' · ') || '같음'}`);
        ok = true;
      } catch (err) {
        st.note.error = `원노트와 맞추지 못했습니다 — ${String(err?.message || err)}`;
        logEvent('rnd', false, `R&D 원노트 맞추기 실패(${reason}): ${String(err?.message || err)}`);
      } finally {
        st.noteBusy = false;
        st.noteRun = null;
        saveNote();
        paintNote();
      }
      if (st.noteAgain) {
        st.noteAgain = false;
        return noteSync('다시');
      }
      return ok;
    })();
    return st.noteRun;
  }

  /* ---------------------------------------------------------- 그리기·배선 */

  function paintAll() {
    paintProjects();
    paintHead();
    if (!cur()) return;
    paintBudget();
    paintFiles();
    paintLogs();
    paintChanges();
  }

  function wire() {
    el.chKind.innerHTML = CHANGE_KINDS.map((k) => `<option value="${k}">${k}</option>`).join('');
    el.projects.addEventListener('click', (e) => {
      const b = e.target instanceof HTMLElement ? e.target.closest('[data-proj],[data-add]') : null;
      if (!b) return;
      if (b.dataset.add) openForm('new');
      else pickProject(b.dataset.proj);
    });
    el.emptyAdd.addEventListener('click', () => openForm('new'));
    el.emptyImport.addEventListener('click', () => importGongmun());
    el.edit.addEventListener('click', () => { const p = cur(); if (p) openForm(p.id); });
    el.aliasSet.addEventListener('click', setAlias);
    el.aliasIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setAlias(); } });
    el.years.addEventListener('click', (e) => {
      const b = e.target instanceof HTMLElement ? e.target.closest('[data-year]') : null;
      if (b) pickYear(+b.dataset.year);
    });
    el.fSave.addEventListener('click', saveForm);
    el.fCancel.addEventListener('click', closeForm);
    el.fDel.addEventListener('click', delProject);
    el.form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLElement && e.target.tagName === 'INPUT') {
        e.preventDefault();
        saveForm();
      }
      if (e.key === 'Escape') closeForm();
    });
    el.budget.addEventListener('input', onBudgetInput);
    el.budget.addEventListener('change', onBudgetChange);
    el.budget.addEventListener('click', onBudgetClick);
    el.budgetAdd.addEventListener('click', addBudgetRow);
    el.logAdd.addEventListener('click', addLog);
    el.logCancel.addEventListener('click', () => { clearLogForm(); paintLogs(); });
    el.logTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLog(); } });
    el.logs.addEventListener('click', onLogsClick);
    el.chAdd.addEventListener('click', addChange);
    el.chCancel.addEventListener('click', () => { clearChangeForm(); paintChanges(); });
    el.changes.addEventListener('click', onChangesClick);
    el.changes.addEventListener('change', onReasonChange);
    el.copy.addEventListener('click', copySummary);
    el.budgetCopy.addEventListener('click', copyBudget);
    el.rosterCopy.addEventListener('click', () => copyFile(el.rosterCopy, 'roster', '참여연구자 표'));
    el.planCopy.addEventListener('click', () => copyFile(el.planCopy, 'plan', '연구개발 계획'));
    el.logsCopy.addEventListener('click', copyLogs);
    el.changesCopy.addEventListener('click', copyChanges);
    el.export.addEventListener('click', exportBook);
    el.import.addEventListener('change', () => {
      const file = el.import.files?.[0];
      el.import.value = '';
      importFile(file);
    });
    el.importGm.addEventListener('click', () => importGongmun());
    el.skillBox.addEventListener('toggle', () => { if (el.skillBox.open) loadManifest(); });
    el.skillZip.addEventListener('click', saveSkillZip);
    el.skillGuide.addEventListener('click', copySkillGuide);
    el.yaml.addEventListener('change', () => {
      const files = [...(el.yaml.files || [])];
      el.yaml.value = '';
      intakeFiles(files);
    });
    for (const type of ['dragover', 'dragleave']) el.root.addEventListener(type, onDrag);
    el.root.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    el.noteOn.addEventListener('change', onNoteToggle);
    el.noteSection.addEventListener('change', onNoteSection);
    el.noteSections.addEventListener('click', loadSections);
    el.noteSync.addEventListener('click', () => noteSync('지금 맞추기'));
  }

  async function show() {
    el.root.classList.remove('hidden');
    if (!st.loaded) {
      const saved = await chrome.storage.local.get([BOOK_KEY, GM_PROJECTS_KEY, NOTE_KEY]);
      st.book = normalizeBook(saved?.[BOOK_KEY]);
      st.note = normalizeNote(saved?.[NOTE_KEY]);
      st.loaded = true;
      clearLogForm();
      clearChangeForm();
      // 처음 열었는데 과제가 없으면 공문 탭의 과제를 그대로 가져온다 — 다시 적을 까닭이 없다.
      if (!st.book.projects.length) {
        const inc = fromGongmun(saved?.[GM_PROJECTS_KEY]);
        if (inc.length) {
          st.book = mergeProjects(st.book, inc).book;
          setStatus(`공문 탭의 과제 ${st.book.projects.length}개를 가져왔습니다.`);
          logEvent('rnd', true, `공문 탭의 과제 가져옴(처음 열 때): ${st.book.projects.length}개`);
          save();
        }
      }
    }
    paintAll();
    paintNote();
    // 원노트 공유가 켜져 있으면 열 때 맞춘다 — 다른 기기에서 고친 과제 정보를 받는다(막 맞췄으면 건너뛴다). 기다리지 않는다.
    if (st.note.on && st.note.sectionId && Date.now() - st.note.at > NOTE_OPEN_MS) noteSync('열 때');
  }

  function hide() {
    el.root.classList.add('hidden');
  }

  return { wire, show, hide, book: () => st.book, skills: loadManifest, note: () => st.note, noteSync };
}

async function defaultCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 확장 안의 파일(rnd/skills.json · rnd/skills/…)을 읽는다 — 글로, 또는 바이트로. */
async function defaultReadAsset(path, as = 'text') {
  const res = await fetch(chrome.runtime.getURL(path));
  if (!res.ok) throw new Error(`${path} (${res.status})`);
  return as === 'bytes' ? new Uint8Array(await res.arrayBuffer()) : res.text();
}

/** 글이나 바이트를 파일로 내려받는다 — 확장의 downloads 권한으로, 없으면 링크를 눌러서. */
async function defaultDownload(data, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  try {
    if (chrome.downloads?.download) {
      await chrome.downloads.download({ url, filename, saveAs: true });
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
