// R&D 과제 관리의 순수 로직 — 화면은 rndpanel.js 가 그리고, 저장은 패널이 chrome.storage(rndBook)에 한다.
//
// 과제마다 연구기간을 **차년도**(1차년도·2차년도 … — 시작일부터 한 해씩, 마지막은 종료일까지)로 자르고, 차년도마다
// **예산**(비목별 계획·집행)·**연구내역**(logs — 날짜·제목·내용)·**변경이력**(날짜·구분·항목·변경 전·후·사유)을 둔다.
// 연구내역 가운데 연구개발계획서(YAML)에서 온 두 줄(key 'roster'·'plan')은 화면에서 참여연구자·연구개발 계획 칸으로 따로 보이고,
// 나머지(손으로 적은 줄)는 진행 기록 칸에 보인다. 과제는 칩·머리에 별칭으로 보이니 별칭은 과제끼리 겹치지 않게 한다(aliasOwner).
// 예산 **계획**을 고치거나 비목을 빼면, 과제의 책임자·연구기간을 고치면 변경이력에 저절로 한 줄이 남는다(auto) — 사유만 사람이 적는다.
// 집행액은 쓰는 대로 바뀌는 값이라 변경이 아니다.
//
// 과제 목록은 공문 탭의 사전 설정(gongmunProjects — 과제명·별명·과제번호·책임자·연구기간 글)에서 가져올 수 있다.
// 과제번호(없으면 과제명)가 같으면 같은 과제로 보고 빈 칸만 채운다(mergeProjects). 여기 담은 것은 이 브라우저에만 남으니
// JSON 으로 내보내고(exportJson) 들여올(importJson) 수 있다.

export const BOOK_KEY = 'rndBook';
export const MAX_PROJECTS = 10;
/** 한 과제를 자를 수 있는 차년도 수의 한도 — 연구기간을 잘못 적어도(2026~2099) 끝없이 자르지 않는다. */
export const MAX_YEARS = 20;
/** 국가연구개발사업 연구개발비 사용 기준의 비목 차례 — 빈 차년도에 처음 까는 줄. 더하고 빼고 이름을 고칠 수 있다. */
export const BUDGET_ITEMS = Object.freeze(['인건비', '연구시설·장비비', '연구재료비', '연구활동비', '연구수당', '간접비']);
/** 변경이력의 구분. 저절로 남는 줄은 예산(계획·비목)·연구기간·연구진(과제책임자)이다. */
export const CHANGE_KINDS = Object.freeze(['예산', '연구내용', '연구기간', '연구진', '기타']);
/** calendar 는 차년도를 1월 1일에 끊는 과제(산업부 과제처럼 첫 해만 협약일~12.31, 그 뒤는 해마다) — 아니면 시작일부터 한 해씩. */
export const EMPTY_PROJECT = Object.freeze({ id: '', name: '', alias: '', code: '', lead: '', start: '', end: '', note: '', calendar: false, years: {} });

const text = (v, max = 2000) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').slice(0, max).trim() : '');
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (s) => String(s ?? '').replace(/\s/g, '').toLowerCase();

/* ------------------------------------------------------------ 날짜 */

export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => ymd(new Date());
/** "2026-04-01" → "2026.04.01" */
export const dot = (s) => (s ? String(s).replace(/-/g, '.') : '');
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
/** 달력에 있는 날짜인가(2026-02-30 은 아니다). */
export const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parse(s)) === s;
const addYears = (s, n) => { const d = parse(s); d.setFullYear(d.getFullYear() + n); return ymd(d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };

/**
 * 연구기간 글 → 시작일·종료일. "2026.04.01 ~ 2029.12.31" · "2026-04-01~2029-12-31" · "2026.4.1 - 2029.12.31" 을 읽는다.
 * 날짜가 하나뿐이면 시작일만, 하나도 없으면 null.
 */
export function periodOf(s) {
  const found = [...String(s ?? '').matchAll(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/g)]
    .map((m) => `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`)
    .filter(isYmd);
  if (!found.length) return null;
  return { start: found[0], end: found[1] && found[1] >= found[0] ? found[1] : '' };
}

/** { start, end } → "2026.04.01 ~ 2029.12.31". 종료일이 없으면 "2026.04.01 ~". 시작일이 없으면 빈 글. */
export const periodText = (p) => (p?.start ? `${dot(p.start)} ~${p.end ? ` ${dot(p.end)}` : ''}` : '');

/* ------------------------------------------------------------ 돈 */

/**
 * 금액 글 → 원. "1,500,000" · "1500000원" · "150만" · "1.5억" · "3천만" 을 읽는다. 비었거나 못 읽으면 null.
 * 숫자가 오면 그대로(음수·무한은 null).
 */
export function amountOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  const s = String(v ?? '').replace(/[,\s원₩]/g, '');
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)(억|천만|백만|만|천)?$/);
  if (!m) return null;
  const mul = { 억: 1e8, 천만: 1e7, 백만: 1e6, 만: 1e4, 천: 1e3 }[m[2]] || 1;
  return Math.round(Number(m[1]) * mul);
}
export const comma = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : '');
export const won = (n) => (Number.isFinite(n) ? `${comma(n)}원` : '');
/** 1.2억 · 3,500만 · 5,000원 처럼 짧게 — 접힌 칸의 머리와 과제 칩에 쓴다. */
export function shortWon(n) {
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(Math.round(n));
  if (a >= 1e8) return `${sign}${(Math.round(a / 1e7) / 10).toLocaleString('ko-KR')}억`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString('ko-KR')}만`;
  return `${sign}${a.toLocaleString('ko-KR')}원`;
}

/* ------------------------------------------------------------ 차년도 */

export const yearLabel = (n) => `${n}차년도`;

/**
 * 연구기간을 차년도로 자른다 — 시작일부터 한 해씩(4월 1일 시작이면 이듬해 3월 31일까지), 마지막은 종료일까지.
 * calendar 과제는 1월 1일에 끊는다 — 1차년도는 시작일부터 그해 12월 31일까지, 그 뒤는 해마다 1월 1일부터(산업부 과제의 연차).
 * 종료일이 없으면 한 해, 시작일이 없으면 기간 없는 1차년도 하나(span 이 비어 있다 — 연구기간을 적으라고 보인다).
 * @returns {{ n:number, start:string, end:string }[]}
 */
export function yearsOf(project) {
  const start = isYmd(project?.start) ? project.start : '';
  const end = isYmd(project?.end) ? project.end : '';
  if (!start) return [{ n: 1, start: '', end: '' }];
  const last = end && end >= start ? end : project?.calendar ? `${start.slice(0, 4)}-12-31` : addDays(addYears(start, 1), -1);
  const out = [];
  for (let n = 1, from = start; from <= last && n <= MAX_YEARS; n++) {
    const to = project?.calendar ? `${from.slice(0, 4)}-12-31` : addDays(addYears(start, n), -1);
    out.push({ n, start: from, end: to < last ? to : last });
    from = addDays(to, 1);
  }
  return out;
}

/** "1차년도" · "3차년도" · 3 → 3. 못 읽으면 0. */
export const yearNo = (v) => {
  const m = String(v ?? '').match(/(\d{1,2})\s*차/);
  const n = m ? Number(m[1]) : Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MAX_YEARS ? n : 0;
};

/** 오늘이 든 차년도. 시작 전이면 1차년도, 끝난 뒤면 마지막 차년도. */
export function currentYear(project, today = todayStr()) {
  const ys = yearsOf(project);
  const hit = ys.find((y) => y.start && y.start <= today && today <= y.end);
  if (hit) return hit.n;
  if (ys[0].start && today < ys[0].start) return 1;
  return ys[ys.length - 1].n;
}

/** 차년도의 형편 — 진행 중(올해) · 예정 · 지남 · 연구기간 미정. */
export function yearState(y, today = todayStr()) {
  if (!y?.start) return '연구기간 미정';
  if (today < y.start) return '예정';
  if (today > y.end) return '지남';
  return '진행 중';
}

/* ------------------------------------------------------------ 모양 */

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 빈 차년도 — 기본 비목 여섯 줄, 연구내역·변경이력 없음. */
export function blankYear() {
  return { budget: BUDGET_ITEMS.map((item) => ({ id: newId(), item, plan: null, used: null })), logs: [], changes: [] };
}

/** key 는 파일에서 들여온 줄의 꼬리표(src/rndyaml.js) — 같은 파일을 다시 넣어도 그 줄을 다시 만들지 않는다. 손으로 적은 줄에는 없다. */
const withKey = (o, raw) => (text(raw?.key, 120) ? { ...o, key: text(raw.key, 120) } : o);
const normalizeRow = (r) => ({ id: text(r?.id, 40) || newId(), item: text(r?.item, 60), plan: amountOf(r?.plan), used: amountOf(r?.used) });
const normalizeLog = (l) => withKey({ id: text(l?.id, 40) || newId(), date: isYmd(l?.date) ? l.date : '', title: text(l?.title, 200), text: text(l?.text, 4000) }, l);
const normalizeChange = (c) => withKey({
  id: text(c?.id, 40) || newId(), date: isYmd(c?.date) ? c.date : '', kind: CHANGE_KINDS.includes(c?.kind) ? c.kind : '기타',
  item: text(c?.item, 100), before: text(c?.before, 300), after: text(c?.after, 300), reason: text(c?.reason, 1000), auto: c?.auto === true,
}, c);

/**
 * 저장된 차년도를 지금 모양으로. 비목 줄은 이름이 빈 것도 둔다(적는 중일 수 있다) — 내용 없는 연구내역·변경이력은 버린다.
 * snapshot 은 마지막으로 들여온 연구개발계획서 스냅샷(src/rndyaml.js — rev·날짜·파일 이름). 없으면 아직 안 들여온 차년도다.
 */
export function normalizeYear(raw) {
  const y = blankYear();
  if (!raw || typeof raw !== 'object') return y;
  if (Array.isArray(raw.budget)) y.budget = raw.budget.map(normalizeRow);
  if (Array.isArray(raw.logs)) y.logs = raw.logs.map(normalizeLog).filter((l) => l.title || l.text);
  if (Array.isArray(raw.changes)) y.changes = raw.changes.map(normalizeChange).filter((c) => c.item || c.before || c.after || c.reason);
  if (raw.snapshot && typeof raw.snapshot === 'object') {
    y.snapshot = {
      rev: text(raw.snapshot.rev, 20), date: isYmd(raw.snapshot.date) ? raw.snapshot.date : '', file: text(raw.snapshot.file, 200),
      // 그 스냅샷이 계획을 적어 준 비목들 — 다음 스냅샷에 빠진 비목은 계획을 비운다.
      items: (Array.isArray(raw.snapshot.items) ? raw.snapshot.items : []).map((s) => text(s, 60)).filter(Boolean),
    };
  }
  return y;
}

/**
 * 저장된 과제를 지금 모양으로. start·end 는 날짜 칸이고, period 는 공문 탭에서 오는 "2026.04.01 ~ 2029.12.31" 글 —
 * 날짜 칸이 비었을 때만 글에서 읽는다. 시작일보다 앞선 종료일은 버린다.
 */
export function normalizeProject(raw) {
  const p = { ...EMPTY_PROJECT, years: {} };
  if (!raw || typeof raw !== 'object') return p;
  p.id = text(raw.id, 40) || newId();
  p.name = text(raw.name, 200);
  p.alias = text(raw.alias, 60);
  p.code = text(raw.code, 40);
  p.lead = text(raw.lead, 40);
  const per = periodOf(raw.period);
  p.start = isYmd(raw.start) ? raw.start : per?.start || '';
  p.end = isYmd(raw.end) ? raw.end : per?.end || '';
  if (!p.start || (p.end && p.end < p.start)) p.end = '';
  p.note = text(raw.note, 1000);
  p.calendar = raw.calendar === true;
  const years = raw.years && typeof raw.years === 'object' ? raw.years : {};
  for (const [k, v] of Object.entries(years)) {
    const n = Number(k);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_YEARS) p.years[n] = normalizeYear(v);
  }
  return p;
}

/**
 * 저장된 장부(rndBook)를 지금 모양으로. 이름 없는 과제는 버리고 열 개까지 둔다.
 * current 는 보고 있던 과제와, 과제마다 보고 있던 차년도(없으면 오늘이 든 차년도).
 */
export function normalizeBook(raw) {
  const projects = (Array.isArray(raw?.projects) ? raw.projects : []).map(normalizeProject).filter((p) => p.name).slice(0, MAX_PROJECTS);
  const cur = raw?.current && typeof raw.current === 'object' ? raw.current : {};
  const project = projects.some((p) => p.id === cur.project) ? cur.project : projects[0]?.id || '';
  const year = {};
  for (const [id, n] of Object.entries(cur.year && typeof cur.year === 'object' ? cur.year : {})) {
    if (projects.some((p) => p.id === id) && Number.isInteger(n) && n >= 1 && n <= MAX_YEARS) year[id] = n;
  }
  return { projects, current: { project, year } };
}

/** 장부에서 과제 하나. 없으면 null. */
export const projectOf = (book, id) => book.projects.find((p) => p.id === id) || null;

/** 별칭이 같은(띄어쓰기·대소문자는 가리지 않는다) 과제 — exceptId 의 과제는 빼고. 없거나 별칭이 비었으면 null. */
export const aliasOwner = (book, alias, exceptId = '') =>
  (keyOf(alias) ? book.projects.find((p) => p.id !== exceptId && keyOf(p.alias) === keyOf(alias)) || null : null);

/**
 * 과제의 보고 있는 차년도 — 골라 둔 것이 아직 있는 차년도면 그것, 아니면 오늘이 든 차년도.
 * 연구기간을 고쳐 차년도 수가 줄면 골라 둔 것이 없어질 수 있다.
 */
export function viewYear(book, project, today = todayStr()) {
  const n = book.current.year[project.id];
  return n && yearsOf(project).some((y) => y.n === n) ? n : currentYear(project, today);
}

/** 차년도 장부 — 없으면 빈 것을 만들어 과제에 둔다. */
export function yearBook(project, n) {
  if (!project.years[n]) project.years[n] = blankYear();
  return project.years[n];
}

/* ------------------------------------------------------------ 예산 */

/** 비목 줄들의 합계·잔액·집행률(%). 계획이 없으면 집행률은 null. */
export function budgetTotals(rows) {
  let plan = 0;
  let used = 0;
  for (const r of rows || []) {
    plan += r.plan || 0;
    used += r.used || 0;
  }
  return { plan, used, left: plan - used, rate: plan > 0 ? Math.round((used / plan) * 100) : null };
}

/**
 * 예산 계획이 바뀐 줄을 변경이력으로. 전에 적어 둔 계획(0 보다 큼)이 있던 줄만 — 처음 적는 것은 변경이 아니다.
 * 계획이 있던 비목을 뺀 것도 남긴다. 줄은 id 로 맞춘다(비목 이름을 고쳐도 같은 줄).
 */
export function budgetChanges(before, after, date = todayStr()) {
  const out = [];
  const entry = (item, b, a) => ({ id: newId(), date, kind: '예산', item, before: b, after: a, reason: '', auto: true });
  const prev = new Map((before || []).map((r) => [r.id, r]));
  for (const r of after || []) {
    const b = prev.get(r.id);
    if (!b || !(b.plan > 0) || b.plan === r.plan) continue;
    out.push(entry(r.item || b.item, won(b.plan), r.plan == null ? '(비움)' : won(r.plan)));
  }
  const kept = new Set((after || []).map((r) => r.id));
  for (const b of before || []) {
    if (!kept.has(b.id) && b.plan > 0) out.push(entry(b.item, won(b.plan), '(비목 뺌)'));
  }
  return out;
}

/** 과제의 책임자·연구기간을 고치면 변경이력으로 — 전에 적힌 값이 있을 때만(처음 적는 것은 변경이 아니다). */
export function projectChanges(before, after, date = todayStr()) {
  const out = [];
  const entry = (kind, item, b, a) => out.push({ id: newId(), date, kind, item, before: b, after: a, reason: '', auto: true });
  if (before.lead && after.lead !== before.lead) entry('연구진', '과제책임자', before.lead, after.lead || '(비움)');
  const pb = periodText(before);
  const pa = periodText(after);
  if (pb && pa !== pb) entry('연구기간', '연구기간', pb, pa || '(비움)');
  if (pb && !!before.calendar !== !!after.calendar) entry('연구기간', '차년도 끊는 기준', calendarLabel(before.calendar), calendarLabel(after.calendar));
  return out;
}

export const calendarLabel = (calendar) => (calendar ? '1월 1일(첫 해는 시작일부터 12월 31일까지)' : '시작일부터 한 해씩');

/** 계획서에서 온 연구내역 한 줄 — src/rndyaml.js 가 key 'roster'(참여연구자)·'plan'(연구개발 계획)으로 넣는다. 없으면 null. */
export const fileLog = (y, key) => (y?.logs || []).find((l) => l.key === key) || null;
/** 손으로 적은 진행 기록 — 계획서에서 온 줄(key 가 있는 것)은 뺀다. */
export const noteLogs = (y) => (y?.logs || []).filter((l) => !l.key);

/** 날짜가 늦은 것부터. 같은 날은 넣은 차례 그대로(뒤에 넣은 것이 앞). */
export const newestFirst = (list) => [...(list || [])].map((x, i) => [x, i]).sort((a, b) => (b[0].date || '').localeCompare(a[0].date || '') || b[1] - a[1]).map(([x]) => x);

/* ------------------------------------------------------------ 가져오기·내보내기 */

/** 공문 탭의 사전 설정 과제(gongmunProjects)를 이 모양으로. 연구기간 글은 시작일·종료일로 읽는다. */
export function fromGongmun(list) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => text(p?.name))
    .map((p) => normalizeProject({ name: p.name, alias: p.alias, code: p.code, lead: p.lead, period: p.period }));
}

/**
 * 과제를 보탠다 — 과제번호(둘 다 있으면)나 과제명이 같으면 같은 과제로 보고 빈 칸만 채운다. 열 개를 넘는 것은 넣지 않는다(skipped).
 * @returns {{ book: object, added: string[], filled: string[], skipped: string[] }}
 */
export function mergeProjects(book, incoming) {
  const projects = book.projects.map((p) => ({ ...p }));
  const added = [];
  const filled = [];
  const skipped = [];
  const same = (a, b) => (a.code && b.code ? keyOf(a.code) === keyOf(b.code) : keyOf(a.name) === keyOf(b.name));
  for (const inc of incoming || []) {
    if (!inc?.name) continue;
    const hit = projects.find((p) => same(p, inc));
    if (!hit) {
      if (projects.length >= MAX_PROJECTS) {
        skipped.push(inc.name);
        continue;
      }
      projects.push({ ...normalizeProject(inc), id: newId(), years: {} });
      added.push(inc.name);
      continue;
    }
    let touched = false;
    for (const k of ['alias', 'code', 'lead', 'start', 'end', 'calendar']) {
      if (!hit[k] && inc[k]) {
        hit[k] = inc[k];
        touched = true;
      }
    }
    if (touched) filled.push(hit.name);
  }
  return { book: normalizeBook({ ...book, projects }), added, filled, skipped };
}

/** 장부를 파일로. 무엇의 파일인지 머리에 적는다 — 들여올 때 가린다. */
export const exportJson = (book, now = new Date()) =>
  JSON.stringify({ app: 'KRS WORKSPACE', kind: 'rndBook', version: 1, savedAt: now.toISOString(), ...book }, null, 2);

export const exportName = (today = todayStr()) => `R&D과제_${today}.json`;

/**
 * 파일에서 들여온 장부를 지금 장부에 얹는다 — 같은 id 의 과제는 파일 것으로 바꾸고, 없던 과제는 더하고, 파일에 없는 과제는 그대로 둔다.
 * 통째로 갈아 끼우지 않는 까닭: 다른 PC 의 파일을 들여오다 이 PC 에서만 적어 둔 과제를 잃지 않게.
 * @returns {{ book: object, replaced: string[], added: string[] }}
 */
export function restoreBook(book, incoming) {
  const replaced = [];
  const added = [];
  const projects = book.projects.map((p) => {
    const q = incoming.projects.find((x) => x.id === p.id);
    if (q) replaced.push(q.name);
    return q || p;
  });
  for (const q of incoming.projects) {
    if (projects.some((p) => p.id === q.id)) continue;
    projects.push(q);
    added.push(q.name);
  }
  const out = normalizeBook({ projects, current: { project: incoming.current.project, year: { ...book.current.year, ...incoming.current.year } } });
  return { book: out, replaced, added };
}

/** 파일 글 → 장부. JSON 이 아니거나 과제 목록이 없으면 Error. */
export function importJson(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error('JSON 파일이 아닙니다.');
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.projects)) throw new Error('R&D 과제 파일이 아닙니다 — projects 목록이 없습니다.');
  const book = normalizeBook(obj);
  if (!book.projects.length) throw new Error('파일에 과제가 없습니다.');
  return book;
}

/* ------------------------------------------------------------ 연구내역 글의 꼴 */

/**
 * 계획서에서 온 참여연구자 글("홍길동 — 수석 · 20% · 9개월 · 인건비 15,000,000원" 줄들)을 표의 줄로. 그 꼴이 아니면 null.
 * @returns {{ name:string, role:string, rate:string, months:string, pay:string }[]|null}
 */
export function parseRoster(text) {
  const lines = String(text ?? '').split('\n').filter((s) => s.trim());
  if (!lines.length) return null;
  const out = [];
  for (const s of lines) {
    const m = s.trim().match(/^(\S+)(?: — (.+))?$/);
    if (!m) return null;
    const p = { name: m[1], role: '', rate: '', months: '', pay: '' };
    for (const bit of (m[2] || '').split(' · ')) {
      const b = bit.trim();
      if (!b) continue;
      if (/^\d+(\.\d+)?%$/.test(b)) p.rate = b;
      else if (/^\d+개월$/.test(b)) p.months = b;
      else if (/^인건비 /.test(b)) p.pay = b.replace(/^인건비 /, '');
      else p.role = p.role ? `${p.role} ${b}` : b;
    }
    out.push(p);
  }
  return out.some((p) => p.rate || p.pay || p.months) ? out : null;
}

/**
 * 계획서에서 온 연구개발 계획 글(■ 절 · "1. " 번호 · "- " 줄표 · "  · " 점)을 절과 항목으로. ■ 절이 하나도 없으면 null.
 * 절 제목 뒤의 괄호("■ 수행일정 (9개월)")는 note 로. 항목의 n 은 번호(없으면 0), subs 는 그 항목 아래의 점 줄.
 * @returns {{ title:string, note:string, items:{ n:number, text:string, subs:string[] }[] }[]|null}
 */
export function parseSections(text) {
  const lines = String(text ?? '').split('\n');
  if (!lines.some((s) => /^■ /.test(s))) return null;
  const out = [];
  let cur = null;
  for (const raw of lines) {
    const s = raw.replace(/\s+$/, '');
    if (!s.trim()) continue;
    const head = s.match(/^■ (.+?)(?: \((.+)\))?$/);
    if (head) {
      cur = { title: head[1], note: head[2] || '', items: [] };
      out.push(cur);
      continue;
    }
    if (!cur) {
      cur = { title: '', note: '', items: [] };
      out.push(cur);
    }
    const num = s.match(/^(\d+)\. (.+)$/);
    if (num) {
      cur.items.push({ n: +num[1], text: num[2], subs: [] });
      continue;
    }
    const sub = s.match(/^\s+[·•] (.+)$/);
    if (sub && cur.items.length) {
      cur.items[cur.items.length - 1].subs.push(sub[1]);
      continue;
    }
    const dash = s.match(/^- (.+)$/);
    cur.items.push({ n: 0, text: dash ? dash[1] : s.trim(), subs: [] });
  }
  return out;
}

/* ------------------------------------------------------------ 복사할 글 */

/** 비목별 계획·집행·잔액·집행률과 합계를 탭으로 나눈 표로 — 엑셀·한글 표에 그대로 붙는다. 적은 것이 없는 줄은 뺀다. */
export function budgetTsv(rows) {
  const list = (rows || []).filter((r) => r.item && (r.plan != null || r.used != null));
  const sum = budgetTotals(list);
  const line = (name, plan, used) => [name, comma(plan), comma(used), comma(plan - used), plan > 0 ? `${Math.round((used / plan) * 100)}%` : ''].join('\t');
  return ['비목\t계획(원)\t집행(원)\t잔액(원)\t집행률', ...list.map((r) => line(r.item, r.plan || 0, r.used || 0)), ...(list.length ? [line('합계', sum.plan, sum.used)] : [])].join('\n');
}

/** 연구내역 한 줄을 복사할 글로 — 참여연구자(표의 줄들)는 탭으로 나눈 표, 그 밖은 제목 줄 아래 글 그대로. */
export function entryText(l) {
  const people = parseRoster(l.text);
  if (people) {
    const cols = [['name', '성명'], ['role', '직위'], ['rate', '계상률'], ['months', '참여'], ['pay', '계상인건비']].filter(([k]) => people.some((x) => x[k]));
    return [l.title, cols.map(([, h]) => h).join('\t'), ...people.map((x) => cols.map(([k]) => x[k]).join('\t'))].filter(Boolean).join('\n');
  }
  return [l.title, l.text].filter(Boolean).join('\n');
}

/** 연구내역들을 이른 것부터 한 줄씩 — 한 줄 내용은 제목 뒤에 잇고, 여러 줄은 제목 아래 들여 쓴다. */
export function logLines(logs) {
  const out = [];
  for (const l of [...(logs || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    const head = `- ${dot(l.date) || '날짜 없음'} ${l.title}`;
    const body = String(l.text ?? '').split('\n').filter((s) => s.trim());
    if (!body.length) out.push(head);
    else if (body.length === 1) out.push(`${head}${l.title ? ' — ' : ''}${body[0]}`);
    else out.push(head, ...body.map((s) => `  ${s}`));
  }
  return out;
}

/** 변경이력 한 줄 — "2026.07.15 [예산] 연구활동비: 50,000,000원 → 40,000,000원 (사유)". */
export function changeLine(c) {
  const diff = c.before || c.after ? `: ${c.before || '(없음)'} → ${c.after || '(없음)'}` : '';
  return `${dot(c.date) || '날짜 없음'} [${c.kind}] ${c.item}${diff}${c.reason ? ` (${c.reason})` : ''}`;
}

/** 변경이력들을 이른 것부터 한 줄씩. */
export const changeLines = (changes) => [...(changes || [])].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((c) => `- ${changeLine(c)}`);

/* ------------------------------------------------------------ 요약 */

/** 과제 한 차년도를 붙여 넣을 글로 — 과제 개요 · 예산표 · 참여연구자 · 연구개발 계획(계획서에서 온 것이 있을 때) · 진행 기록 · 변경이력. */
export function summaryText(project, n, today = todayStr()) {
  const ys = yearsOf(project);
  const y = ys.find((x) => x.n === n) || ys[0];
  const book = project.years[y.n] || blankYear();
  const lines = [];
  lines.push(`[${project.alias || project.name}] ${yearLabel(y.n)}${y.start ? ` (${dot(y.start)} ~ ${dot(y.end)})` : ''} — ${yearState(y, today)}`);
  lines.push(`과제명: ${project.name}`);
  if (project.code) lines.push(`과제번호: ${project.code}`);
  if (project.lead) lines.push(`과제책임자: ${project.lead}`);
  if (project.start) lines.push(`연구기간: ${periodText(project)} (총 ${ys.length}차년도)`);
  if (project.note) lines.push(`비고: ${project.note}`);

  const rows = book.budget.filter((r) => r.item && (r.plan != null || r.used != null));
  const sum = budgetTotals(rows);
  lines.push('', `■ 예산 (${yearLabel(y.n)})`);
  if (!rows.length) lines.push('- 적은 것 없음');
  for (const r of rows) {
    const rate = r.plan > 0 ? ` · 집행률 ${Math.round(((r.used || 0) / r.plan) * 100)}%` : '';
    lines.push(`- ${r.item}: 계획 ${won(r.plan || 0)} · 집행 ${won(r.used || 0)} · 잔액 ${won((r.plan || 0) - (r.used || 0))}${rate}`);
  }
  if (rows.length) lines.push(`- 합계: 계획 ${won(sum.plan)} · 집행 ${won(sum.used)} · 잔액 ${won(sum.left)}${sum.rate == null ? '' : ` · 집행률 ${sum.rate}%`}`);

  const roster = fileLog(book, 'roster');
  if (roster) {
    const people = parseRoster(roster.text);
    lines.push('', `■ 참여연구자${people ? ` (${people.length}명)` : ''}`, ...roster.text.split('\n').filter((s) => s.trim()).map((s) => `- ${s.trim()}`));
  }
  // 계획 글에는 ■ 절이 있으니 한 칸 들여 이 절 아래로 넣는다.
  const plan = fileLog(book, 'plan');
  if (plan) lines.push('', '■ 연구개발 계획', ...plan.text.split('\n').filter((s) => s.trim()).map((s) => `  ${s}`));

  const notes = noteLogs(book);
  lines.push('', `■ 진행 기록 (${notes.length}건)`);
  lines.push(...(notes.length ? logLines(notes) : ['- 적은 것 없음']));

  lines.push('', `■ 변경이력 (${book.changes.length}건)`);
  lines.push(...(book.changes.length ? changeLines(book.changes) : ['- 적은 것 없음']));
  return lines.join('\n');
}
