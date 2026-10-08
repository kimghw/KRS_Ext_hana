// R&D 탭의 화면. 차년도 자르기·예산 셈·저절로 남는 변경이력·요약·가져오기·내보내기는 src/rnd.js 가 하고,
// 여기는 그것을 화면에 잇고 chrome.storage(rndBook)에 남긴다.
//
//   과제 칩(별명) → 차년도 칩(오늘이 든 것에 "올해") → 예산(비목 줄) · 연구내역 · 변경이력 → 요약 복사 · JSON 저장·불러오기
//
// 어디에도 올리지 않는다 — 이 브라우저에만 남는다. 공문 탭의 사전 설정 과제를 가져올 수 있다(처음 열 때 과제가 없으면 저절로).
// 예산 **계획**을 고치거나 비목을 빼면, 과제의 책임자·연구기간을 고치면 변경이력에 저절로 한 줄이 남고 사유만 사람이 적는다.

import {
  BOOK_KEY, MAX_PROJECTS, CHANGE_KINDS, normalizeBook, normalizeProject, projectOf, viewYear, yearBook, yearsOf, currentYear, yearLabel, yearState,
  periodText, dot, todayStr, isYmd, amountOf, comma, shortWon, budgetTotals, budgetChanges, projectChanges, newestFirst, newId,
  fromGongmun, mergeProjects, restoreBook, exportJson, exportName, importJson, summaryText,
} from './src/rnd.js';
import { PROJECTS_KEY as GM_PROJECTS_KEY } from './src/gongmun.js';

const SAVE_WAIT_MS = 400;
/** 지우기 버튼은 두 번 누른다 — 처음 누르면 이만큼 동안 "정말 지우기" 로 바뀌고, 그 안에 다시 누르면 지운다. */
const CONFIRM_MS = 3000;

/**
 * @param {{$:Function, escapeHtml:Function, logEvent:Function, copyText?:(text:string) => Promise<boolean>,
 *   flash?:(btn:HTMLElement, text:string, ms?:number) => void, download?:(text:string, filename:string) => Promise<void>,
 *   today?:() => string}} deps today 는 검사에서 날짜를 못 박는 데 쓴다
 */
export function createRndPanel({ $, escapeHtml, logEvent, copyText = defaultCopy, flash = () => {}, download = defaultDownload, today = todayStr }) {
  const el = {
    root: $('rnd'), projects: $('rdProjects'), empty: $('rdEmpty'), emptyImport: $('rdEmptyImport'), emptyAdd: $('rdEmptyAdd'),
    head: $('rdHead'), name: $('rdName'), edit: $('rdEdit'), meta: $('rdMeta'), years: $('rdYears'), yearNote: $('rdYearNote'),
    form: $('rdForm'), formTitle: $('rdFormTitle'), fName: $('rdFName'), fAlias: $('rdFAlias'), fCode: $('rdFCode'), fLead: $('rdFLead'),
    fStart: $('rdFStart'), fEnd: $('rdFEnd'), fNote: $('rdFNote'), fNeed: $('rdFNeed'), fSave: $('rdFSave'), fCancel: $('rdFCancel'), fDel: $('rdFDel'),
    status: $('rdStatus'), body: $('rdBody'),
    budgetState: $('rdBudgetState'), budget: $('rdBudget'), budgetSum: $('rdBudgetSum'), budgetAdd: $('rdBudgetAdd'),
    logState: $('rdLogState'), logDate: $('rdLogDate'), logTitle: $('rdLogTitle'), logText: $('rdLogText'), logAdd: $('rdLogAdd'), logCancel: $('rdLogCancel'), logs: $('rdLogs'),
    changeState: $('rdChangeState'), chDate: $('rdChDate'), chKind: $('rdChKind'), chItem: $('rdChItem'), chBefore: $('rdChBefore'), chAfter: $('rdChAfter'),
    chReason: $('rdChReason'), chAdd: $('rdChAdd'), chCancel: $('rdChCancel'), changes: $('rdChanges'),
    copy: $('rdCopy'), export: $('rdExport'), import: $('rdImport'), importGm: $('rdImportGm'),
  };
  const st = {
    loaded: false, book: normalizeBook(null),
    // editing 은 고치는 중인 과제 id('new' 는 새 과제). snap 은 그린 시점의 예산 줄 — 계획이 바뀌었는지 이것과 견준다.
    editing: null, snap: [], logEdit: null, chEdit: null,
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
    const ys = yearsOf(p);
    const meta = [];
    if (p.alias) meta.push(p.name);
    if (p.code) meta.push(`과제번호 ${p.code}`);
    if (p.lead) meta.push(`책임자 ${p.lead}`);
    meta.push(p.start ? `연구기간 ${periodText(p)} (총 ${ys.length}차년도)` : '연구기간 미정 — 과제 고치기에서 시작일·종료일을 적으세요');
    if (p.note) meta.push(p.note);
    el.meta.innerHTML = meta.map((m) => `<span>${escapeHtml(m)}</span>`).join('');
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
      start: el.fStart.value, end: el.fEnd.value, note: el.fNote.value,
    });
    if (!draft.name) {
      el.fNeed.textContent = '과제명을 적으세요.';
      el.fName.focus();
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
      Object.assign(p, { name: draft.name, alias: draft.alias, code: draft.code, lead: draft.lead, start: draft.start, end: draft.end, note: draft.note });
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

  /* ---------------------------------------------------------- 연구내역 */

  function paintLogs() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    el.logs.innerHTML = newestFirst(b.logs).map((l) => `<li data-log="${l.id}"${l.id === st.logEdit ? ' class="editing"' : ''}>`
      + `<div class="rd-row-head"><span class="rd-date">${escapeHtml(dot(l.date) || '날짜 없음')}</span><strong class="rd-title">${escapeHtml(l.title)}</strong>`
      + `<span class="rd-row-btns"><button type="button" class="ghost small" data-edit="${l.id}">고치기</button><button type="button" class="ghost small rd-del" data-del="${l.id}">지우기</button></span></div>`
      + (l.text ? `<p class="rd-text">${escapeHtml(l.text)}</p>` : '')
      + '</li>').join('');
    el.logState.textContent = b.logs.length ? `${b.logs.length}건` : '적은 것 없음';
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
      setStatus('연구내역의 제목이나 내용을 적으세요.', 'error');
      el.logTitle.focus();
      return;
    }
    const date = isYmd(el.logDate.value) ? el.logDate.value : today();
    const hit = st.logEdit ? b.logs.find((x) => x.id === st.logEdit) : null;
    if (hit) {
      Object.assign(hit, { date, title, text });
      setStatus('연구내역을 고쳤습니다.');
    } else {
      b.logs.push({ id: newId(), date, title, text });
      setStatus('연구내역을 적었습니다.');
    }
    clearLogForm();
    paintLogs();
    save();
  }

  function onLogsClick(e) {
    const btn = e.target instanceof HTMLElement ? e.target.closest('button[data-edit],button[data-del]') : null;
    const p = cur();
    if (!btn || !p) return;
    const b = curBook(p);
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
    setStatus('연구내역을 지웠습니다.');
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
        + `<span class="rd-row-btns"><button type="button" class="ghost small" data-edit="${c.id}">고치기</button><button type="button" class="ghost small rd-del" data-del="${c.id}">지우기</button></span></div>`
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
    const btn = e.target instanceof HTMLElement ? e.target.closest('button[data-edit],button[data-del]') : null;
    const p = cur();
    if (!btn || !p) return;
    const b = curBook(p);
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

  /* ---------------------------------------------------------- 요약·파일·가져오기 */

  async function copySummary() {
    const p = cur();
    if (!p) return;
    const ok = await copyText(summaryText(p, curYear(p), today()));
    flash(el.copy, ok ? '복사했습니다 ✓' : '복사하지 못했습니다');
    logEvent('rnd', ok, `R&D 요약 복사: ${label(p)} ${yearLabel(curYear(p))}`);
  }

  async function exportBook() {
    const name = exportName(today());
    try {
      await download(exportJson(st.book), name);
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

  /** 공문 탭의 사전 설정 과제를 가져온다. quiet 면(처음 열 때) 없어도 말하지 않는다. */
  async function importGongmun({ quiet = false } = {}) {
    const saved = await chrome.storage.local.get(GM_PROJECTS_KEY);
    const inc = fromGongmun(saved?.[GM_PROJECTS_KEY]);
    if (!inc.length) {
      if (!quiet) setStatus('공문 탭의 사전 설정에 과제가 없습니다.', 'error');
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

  /* ---------------------------------------------------------- 그리기·배선 */

  function paintAll() {
    paintProjects();
    paintHead();
    if (!cur()) return;
    paintBudget();
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
    el.export.addEventListener('click', exportBook);
    el.import.addEventListener('change', () => {
      const file = el.import.files?.[0];
      el.import.value = '';
      importFile(file);
    });
    el.importGm.addEventListener('click', () => importGongmun());
  }

  async function show() {
    el.root.classList.remove('hidden');
    if (!st.loaded) {
      const saved = await chrome.storage.local.get([BOOK_KEY, GM_PROJECTS_KEY]);
      st.book = normalizeBook(saved?.[BOOK_KEY]);
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
  }

  function hide() {
    el.root.classList.add('hidden');
  }

  return { wire, show, hide, book: () => st.book };
}

async function defaultCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** JSON 글을 파일로 내려받는다 — 확장의 downloads 권한으로, 없으면 링크를 눌러서. */
async function defaultDownload(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
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
