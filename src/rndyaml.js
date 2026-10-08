// 연구개발계획서 스냅샷(RND 폴더의 KR_<과제>.yaml)과 그 이력 파일(history/revisions.yaml · budget_history.yaml · researchers_history.yaml)을
// R&D 장부에 넣는 순수 로직. YAML 글은 패널이 vendor/yaml 로 풀어 객체로 주고, 여기는 그 객체를 과제·차년도에 맞춰 넣는다.
//
// 파일 가리기(kindOf): meta.과제명 이 있으면 스냅샷, revisions: 목록이 있으면 개정 레지스트리, entity: budget|researchers 는 이력.
// - 스냅샷: 과제(과제명·과제번호·책임자·연구기간·차년도 끊는 기준)와 그 차년도의 예산(비목별, 천원 → 원), 연구개발 계획(목표·내용·성능목표·
//   결과물·일정)과 참여연구자를 연구내역 두 줄로. 같은 차년도에 다시 넣으면(r1·r2 재생성본) 달라진 비목·계획·참여연구자를 변경이력에
//   남긴다 — 처음 넣는 것은 기준선이라 남기지 않는다(손으로 적어 둔 계획이 있던 줄은 빼고). 사유는 파일 머리의 "변경분:" 주석.
// - 이력 파일: 과제명이 없어 보고 있는 과제에 넣는다(project: 줄의 주석에 과제명이 있으면 그것으로 찾는다). rev 마다 변경이력 한 줄.
// 들여온 줄에는 key 가 붙어 같은 파일을 다시 넣어도 겹치지 않는다.

import {
  MAX_PROJECTS, isYmd, yearNo, amountOf, won, todayStr, newId, normalizeProject, projectChanges, yearBook,
} from './rnd.js';

export const UNIT = Object.freeze({ 천원: 1000, 원: 1, 백만원: 1e6 });
export const KIND_LABEL = Object.freeze({ snapshot: '연구개발계획서 스냅샷', revisions: '개정 레지스트리', budget: '예산 이력', researchers: '참여연구원 이력' });
/** 여러 파일을 한꺼번에 넣을 때의 차례 — 스냅샷이 과제·차년도를 만들고, 레지스트리가 rev 의 날짜를 주고, 이력이 그 날짜를 쓴다. */
export const KIND_ORDER = Object.freeze(['snapshot', 'revisions', 'budget', 'researchers']);
/** 파일의 비목 이름 → 장부의 비목 이름. 없는 것은 파일 이름 그대로. */
const ITEM_ALIAS = { 연구시설장비비: '연구시설·장비비' };
const SKIP_KEYS = new Set(['연차', '직접비', '소계', '총액', '합계', '연구개발비총액']);
const str = (v) => (v == null ? '' : String(v)).trim();
const norm = (s) => str(s).replace(/^(직접비|간접비)\//, '').replace(/[\s·/]/g, '');
/** 파일의 비목 이름을 장부 이름으로 — "직접비/연구시설장비비" → "연구시설·장비비". */
export const itemName = (k) => { const n = norm(k); return ITEM_ALIAS[n] || str(k).replace(/^(직접비|간접비)\//, ''); };
export const sameItem = (a, b) => norm(itemName(a)) === norm(itemName(b));
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m, 0).getDate();

/* ------------------------------------------------------------ 글 읽기 */

/** 파일 머리의 주석(첫 키 앞의 `# …` 줄들) — `[재생성 r2]` 같은 꼬리표와 "변경분: …" 줄을 뽑는다. */
export function headerOf(text) {
  const lines = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (!l.startsWith('#')) break;
    lines.push(l.replace(/^#\s?/, ''));
  }
  const tag = lines[0]?.match(/^\[([^\]]+)\]/)?.[1] || '';
  const changed = lines.map((l) => l.match(/^변경분\s*[:：]\s*(.+)$/)?.[1]).find(Boolean) || '';
  return { lines, tag, changed: changed.trim() };
}

/** 이력 파일의 `project: SSCB   # MW급 … 개발` 줄 — 주석에 적힌 과제명. 없으면 빈 글. */
export function projectHint(text) {
  const m = String(text ?? '').match(/^project:[^#\n]*#\s*(.+)$/m);
  return m ? m[1].trim() : '';
}

/**
 * 연구기간 글 → 시작일·종료일. 달까지만 적은 것("2026-04 ~ 2029-12")은 그 달의 첫날·마지막 날로, 날까지 적은 것은 그대로.
 * 하나뿐이면 시작일만. 없으면 null.
 */
export function periodOfLoose(s) {
  const found = [...String(s ?? '').matchAll(/(\d{4})[.\-/](\d{1,2})(?:[.\-/](\d{1,2}))?/g)]
    .map((m) => ({ y: +m[1], m: +m[2], d: m[3] ? +m[3] : 0 }))
    .filter((t) => t.m >= 1 && t.m <= 12 && t.d <= lastDay(t.y, t.m));
  if (!found.length) return null;
  const a = found[0];
  const b = found[1];
  const start = `${a.y}-${pad(a.m)}-${pad(a.d || 1)}`;
  const end = b ? `${b.y}-${pad(b.m)}-${pad(b.d || lastDay(b.y, b.m))}` : '';
  return { start, end: end && end >= start ? end : '' };
}

/** 무슨 파일인가 — 'snapshot' · 'revisions' · 'budget' · 'researchers' · ''(모르는 파일). */
export function kindOf(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  if (obj.meta && typeof obj.meta === 'object' && str(obj.meta.과제명)) return 'snapshot';
  if (Array.isArray(obj.revisions)) return 'revisions';
  if (obj.entity === 'budget' && Array.isArray(obj.items)) return 'budget';
  if (obj.entity === 'researchers' && Array.isArray(obj.items)) return 'researchers';
  return '';
}

/* ------------------------------------------------------------ 스냅샷 읽기 */

/**
 * 차년도를 1월 1일에 끊는 과제인가. 연차별기간이 있으면 2차년도가 1월 1일에 시작하는지로, 없으면 1차년도 기간개월이 12월에 끝나는지로,
 * 그것도 없으면 연구기간이 12월에 끝나면서 1월에 시작하지 않는지로(산업부 과제의 꼴) 가린다.
 */
function isCalendar({ start, end, ranges, schedule }) {
  if (ranges) {
    const second = Object.entries(ranges).find(([k]) => yearNo(k) === 2);
    const p = second ? periodOfLoose(second[1]) : null;
    if (p?.start) return p.start.endsWith('-01-01');
  }
  if (!start) return false;
  const sm = Number(start.slice(5, 7));
  const first = Array.isArray(schedule) ? schedule.find((s) => yearNo(s?.연차) === 1) : null;
  const months = Number(first?.기간개월);
  if (Number.isInteger(months) && months > 0 && months < 12) return sm + months - 1 === 12;
  return !!end && end.slice(5, 7) === '12' && sm !== 1;
}

function readBudget(budget, n, mul) {
  const rows = Array.isArray(budget?.비목별) ? budget.비목별 : [];
  const row = rows.find((r) => yearNo(r?.연차) === n);
  if (!row || typeof row !== 'object') return [];
  const out = [];
  const push = (k, v) => {
    if (SKIP_KEYS.has(k)) return;
    const amt = amountOf(v);
    // 0 원 비목은 계획이 없는 것이다 — 줄은 두되 비워 둔다.
    if (!amt) return;
    out.push({ item: itemName(k), plan: Math.round(amt * mul) });
  };
  const direct = row.직접비 && typeof row.직접비 === 'object' ? row.직접비 : {};
  for (const [k, v] of Object.entries(direct)) push(k, v);
  for (const [k, v] of Object.entries(row)) if (k !== '직접비' && (typeof v !== 'object' || v === null)) push(k, v);
  return out;
}

function readPlan(content, n) {
  if (!content || typeof content !== 'object') return null;
  const list = (v) => (Array.isArray(v) ? v : []);
  const goal = list(content.목표).find((g) => yearNo(g?.연차) === n);
  const goals = list(goal?.개발목표).map(str).filter(Boolean);
  const lines = [];
  if (goals.length) {
    lines.push('■ 개발목표');
    goals.forEach((g, i) => lines.push(`${i + 1}. ${g}`));
  }
  const items = list(goal?.개발내용);
  if (items.length) {
    lines.push('■ 개발내용');
    for (const it of items) {
      if (str(it?.항목)) lines.push(`- ${str(it.항목)}`);
      for (const s of list(it?.세부)) if (str(s)) lines.push(`  · ${str(s)}`);
    }
  }
  const perf = list(content.성능목표).filter((p) => p?.목표치 && typeof p.목표치 === 'object' && Object.keys(p.목표치).some((k) => yearNo(k) === n));
  if (perf.length) {
    lines.push('■ 성능목표');
    for (const p of perf) {
      const v = Object.entries(p.목표치).find(([k]) => yearNo(k) === n)?.[1];
      lines.push(`- ${str(p.평가항목)}: ${v ?? ''}${str(p.단위) ? ` ${str(p.단위)}` : ''}${str(p.평가방법) ? ` (${str(p.평가방법)})` : ''}`);
    }
  }
  const outs = list(content.주요결과물).find((r) => yearNo(r?.연차) === n);
  if (list(outs?.결과물).length) {
    lines.push('■ 주요결과물');
    for (const r of outs.결과물) if (str(r)) lines.push(`- ${str(r)}`);
  }
  const sched = list(content.수행일정).find((s) => yearNo(s?.연차) === n);
  if (sched) {
    const parts = list(sched.항목).map((a) => `${str(a?.개발내용)}${a?.기간주 ? ` ${a.기간주}주` : ''}`).filter((s) => s.trim());
    if (sched.기간개월 || parts.length) lines.push(`■ 수행일정${sched.기간개월 ? ` (${sched.기간개월}개월)` : ''}`, ...parts.map((p) => `- ${p}`));
  }
  return lines.length ? { title: `연구개발 계획 — ${n}차년도`, text: lines.join('\n'), goals } : null;
}

function readRoster(list, n, mul) {
  const y = (Array.isArray(list) ? list : []).find((r) => yearNo(r?.연차) === n);
  const people = Array.isArray(y?.참여자) ? y.참여자.filter((p) => str(p?.성명)) : [];
  if (!people.length) return null;
  const lines = people.map((p) => {
    const pay = amountOf(p?.계상인건비);
    const bits = [str(p?.직위), p?.계상률 != null ? `${p.계상률}%` : '', p?.참여기간_개월 ? `${p.참여기간_개월}개월` : '', pay != null ? `인건비 ${won(pay * mul)}` : ''].filter(Boolean);
    return `${str(p.성명)}${bits.length ? ` — ${bits.join(' · ')}` : ''}`;
  });
  return { title: `참여연구자 — ${n}차년도`, text: lines.join('\n') };
}

/**
 * 스냅샷 객체 → 넣을 것. 연구기간은 연차별기간이 있으면 그 처음·끝, 아니면 meta.기간(달까지만 적혀 있어도 됨).
 * @returns {{ project: object, n: number, rev: string, date: string, budget: {item:string, plan:number}[], plan: object|null, roster: object|null }}
 */
export function readSnapshot(obj) {
  const m = obj?.meta && typeof obj.meta === 'object' ? obj.meta : {};
  const cover = m.표지 && typeof m.표지 === 'object' ? m.표지 : {};
  const name = str(m.과제명);
  const code = str(m.연구개발과제번호 || cover.연구개발과제번호);
  const lead = str(cover.KR?.책임자 || m.KR연구책임자 || m.연구책임자 || m.책임자);
  const n = yearNo(m.차년도) || 1;
  const period = periodOfLoose(m.기간);
  const ranges = m.연차별기간 && typeof m.연차별기간 === 'object' ? m.연차별기간 : null;
  let start = period?.start || '';
  let end = period?.end || '';
  if (ranges) {
    const rs = Object.entries(ranges).map(([k, v]) => [yearNo(k), periodOfLoose(v)]).filter(([k, p]) => k && p?.start).sort((a, b) => a[0] - b[0]);
    if (rs.length) {
      start = rs[0][1].start;
      end = rs[rs.length - 1][1].end || rs[rs.length - 1][1].start || end;
    }
  }
  const calendar = isCalendar({ start, end, ranges, schedule: obj?.연구개발내용?.수행일정 });
  const biz = cover.사업명 && typeof cover.사업명 === 'object' ? str(cover.사업명.세부) : str(cover.사업명);
  const main = str(cover.주관연구개발기관?.기관명 || m.주관연구개발기관);
  const note = [str(cover.중앙행정기관), biz, main ? `주관 ${main}` : ''].filter(Boolean).join(' · ');
  const mul = UNIT[str(obj?.예산?.단위)] ?? 1000;
  return {
    project: { name, code, lead, start, end, calendar, note },
    n, rev: str(m.rev), date: isYmd(str(m.협약일)) ? str(m.협약일) : '',
    budget: readBudget(obj?.예산, n, mul), plan: readPlan(obj?.연구개발내용, n), roster: readRoster(obj?.예산?.참여연구자인건비, n, mul),
  };
}

/* ------------------------------------------------------------ 장부에 넣기 */

const keyOf = (s) => str(s).replace(/\s/g, '').toLowerCase();
/** 과제번호(둘 다 있으면)나 과제명이 같은 과제. */
export function findProject(book, { code = '', name = '' } = {}) {
  return book.projects.find((p) => (code && p.code ? keyOf(p.code) === keyOf(code) : name && keyOf(p.name) === keyOf(name))) || null;
}

const change = (kind, item, before, after, reason, date, key, auto = false) => ({ id: newId(), date, kind, item, before, after, reason, auto, key });

/** 연구내역 한 줄을 key 로 찾아 넣거나 고친다. 돌려주는 것: 'added' · 'updated' · 'same', 그리고 고치기 전 글. */
function upsertLog(y, key, { date, title, text }) {
  const hit = y.logs.find((l) => l.key === key);
  if (!hit) {
    y.logs.push({ id: newId(), date, title, text, key });
    return { state: 'added', before: '' };
  }
  if (hit.text === text && hit.title === title) return { state: 'same', before: hit.text };
  const before = hit.text;
  hit.title = title;
  hit.text = text;
  return { state: 'updated', before };
}

const goalsOf = (text) => String(text ?? '').split('\n').filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s/, '')).join(' / ');
const rosterOf = (text) => String(text ?? '').split('\n').map((l) => { const m = l.match(/^(\S+)(?: — .*?(\d+(?:\.\d+)?%))?/); return m ? `${m[1]}${m[2] ? ` ${m[2]}` : ''}` : ''; }).filter(Boolean).join(' · ');

/**
 * 스냅샷을 장부에 넣는다 — 과제를 찾거나(과제번호·과제명) 만들고, 그 차년도의 예산 계획·연구개발 계획·참여연구자를 넣는다.
 * 같은 차년도에 두 번째로 넣는 것(y.snapshot 이 있음)은 달라진 것을 전부 변경이력에 남긴다. 처음은 기준선 — 손으로 적어 둔 계획이 있던 줄만 남긴다.
 * @returns {{ project: object, created: boolean, n: number, budget: number, changes: object[], logs: string[] }}
 */
export function applySnapshot(book, snap, { today = todayStr(), header = { tag: '', changed: '' }, file = '' } = {}) {
  if (!snap?.project?.name) throw new Error('스냅샷에 과제명(meta.과제명)이 없습니다.');
  const reason = header.changed || (snap.rev ? `${snap.rev} 스냅샷 반영` : '스냅샷 반영');
  const report = { project: null, created: false, n: snap.n, budget: 0, changes: [], logs: [] };
  let p = findProject(book, snap.project);
  if (!p) {
    if (book.projects.length >= MAX_PROJECTS) throw new Error(`과제는 ${MAX_PROJECTS}개까지입니다 — 하나를 지우고 다시 넣으세요.`);
    p = normalizeProject(snap.project);
    book.projects.push(p);
    report.created = true;
  } else {
    const draft = { ...p };
    for (const k of ['code', 'lead', 'note']) if (!draft[k] && snap.project[k]) draft[k] = snap.project[k];
    // 연구기간·차년도 끊는 기준은 계획서가 정본이다.
    if (snap.project.start) {
      draft.start = snap.project.start;
      draft.end = snap.project.end || draft.end;
      draft.calendar = snap.project.calendar;
    }
    const ch = projectChanges(p, draft, today).map((c) => ({ ...c, reason, auto: false }));
    Object.assign(p, draft);
    if (ch.length) yearBook(p, snap.n).changes.push(...ch);
    report.changes.push(...ch);
  }
  report.project = p;
  book.current.project = p.id;
  book.current.year[p.id] = snap.n;
  const y = yearBook(p, snap.n);
  const baseline = !y.snapshot;
  const prevItems = y.snapshot?.items || [];
  const date = snap.date || today;

  // 예산 — 파일의 비목은 계획을 넣고, 지난 스냅샷이 적어 준 비목 가운데 이번에 빠진 것은 비운다.
  const touched = new Set();
  for (const b of snap.budget) {
    let row = y.budget.find((r) => sameItem(r.item, b.item));
    if (!row) {
      row = { id: newId(), item: b.item, plan: null, used: null };
      y.budget.push(row);
    }
    touched.add(row.id);
    if (row.plan !== b.plan) {
      if (!baseline || row.plan > 0) {
        const c = change('예산', row.item, row.plan == null ? '(없음)' : won(row.plan), won(b.plan), reason, today, `snapshot:${snap.rev || 'r'}:${snap.n}:${norm(row.item)}`, false);
        y.changes.push(c);
        report.changes.push(c);
      }
      row.plan = b.plan;
    }
    report.budget++;
  }
  for (const name of prevItems) {
    const row = y.budget.find((r) => sameItem(r.item, name));
    if (!row || touched.has(row.id) || row.plan == null) continue;
    const c = change('예산', row.item, won(row.plan), '(비목 뺌)', reason, today, `snapshot:${snap.rev || 'r'}:${snap.n}:${norm(row.item)}`, false);
    y.changes.push(c);
    report.changes.push(c);
    row.plan = null;
  }

  // 연구내역 — 계획·참여연구자. 두 번째부터는 달라진 것을 변경이력에.
  for (const [key, entry, kind, item, summarize] of [['plan', snap.plan, '연구내용', '연구개발 계획', goalsOf], ['roster', snap.roster, '연구진', '참여연구자', rosterOf]]) {
    if (!entry) continue;
    const r = upsertLog(y, key, { date, title: entry.title, text: entry.text });
    if (r.state !== 'same') report.logs.push(`${entry.title} ${r.state === 'added' ? '넣음' : '고침'}`);
    if (r.state === 'updated' && !baseline) {
      const b = summarize(r.before);
      const a = summarize(entry.text);
      const c = change(kind, item, b === a ? '(세부 내용)' : b, b === a ? '(세부 내용 갱신)' : a, reason, today, `snapshot:${snap.rev || 'r'}:${snap.n}:${key}`, false);
      y.changes.push(c);
      report.changes.push(c);
    }
  }

  y.snapshot = { rev: snap.rev, date: today, file, items: snap.budget.map((b) => b.item) };
  return report;
}

/** 같은 차년도의 변경이력 가운데 그 rev 의 날짜(개정 레지스트리가 먼저 들어왔으면 있다). */
const revDate = (y, rev) => (rev ? y.changes.find((c) => c.key === `rev:${rev}`)?.date || '' : '');
const kindOfLoad = (type, loads) => {
  if (type === '최초협약') return '기타';
  const l = (Array.isArray(loads) ? loads : []).map(str);
  if (l.length === 1) return { budget: '예산', researchers: '연구진', objectives: '연구내용' }[l[0]] || '기타';
  return '기타';
};

/**
 * 개정 레지스트리(history/revisions.yaml)를 보고 있는 과제·차년도의 변경이력으로 — rev 마다 한 줄(날짜·type·사유). 같은 rev 는 다시 만들지 않고 고친다.
 * @returns {{ n: number, added: number, updated: number }}
 */
export function applyRevisions(book, obj, { project, n = 0, today = todayStr() } = {}) {
  if (!project) throw new Error('넣을 과제가 없습니다 — 먼저 그 과제의 스냅샷(KR_<과제>.yaml)을 넣거나 과제를 고르세요.');
  const yearN = yearNo(obj?.연차) || n || 1;
  const y = yearBook(project, yearN);
  const report = { n: yearN, added: 0, updated: 0 };
  for (const r of Array.isArray(obj?.revisions) ? obj.revisions : []) {
    const rev = str(r?.rev);
    if (!rev) continue;
    const fields = {
      date: isYmd(str(r.date)) ? str(r.date) : today, kind: kindOfLoad(str(r.type), r.적재), item: `${rev} ${str(r.type)}`.trim(),
      reason: `${str(r.reason)}${str(r.status) && str(r.status) !== '확정' ? ` (${str(r.status)})` : ''}`.trim(),
    };
    const hit = y.changes.find((c) => c.key === `rev:${rev}`);
    if (hit) {
      if (Object.entries(fields).some(([k, v]) => hit[k] !== v)) {
        Object.assign(hit, fields);
        report.updated++;
      }
      continue;
    }
    y.changes.push({ id: newId(), ...fields, before: '', after: '', auto: false, key: `rev:${rev}` });
    report.added++;
  }
  book.current.project = project.id;
  book.current.year[project.id] = yearN;
  return report;
}

/** 변경이력의 금액 글("(없음)" · "0원" · "10,000,000원")을 원으로 — 없는 것은 0. */
const moneyIn = (s) => amountOf(String(s ?? '').replace(/\(.*?\)/g, '')) ?? 0;

/**
 * 예산 이력(history/budget_history.yaml) — 비목마다 history 의 이웃 rev 사이를 변경이력 한 줄로(사유는 파일의 것), 현재 금액은 그 비목의 계획으로.
 * 스냅샷(r2 재생성본)이 먼저 들어와 같은 변경(비목·전·후 같음)이 이미 있으면 새 줄 대신 그 줄에 파일의 사유·날짜를 붙인다(updated).
 * @returns {{ n: number, added: number, updated: number, budget: number }}
 */
export function applyBudgetHistory(book, obj, { project, n = 0, today = todayStr() } = {}) {
  if (!project) throw new Error('넣을 과제가 없습니다 — 먼저 그 과제의 스냅샷(KR_<과제>.yaml)을 넣거나 과제를 고르세요.');
  const mul = UNIT[str(obj?.unit)] ?? 1000;
  const items = Array.isArray(obj?.items) ? obj.items : [];
  const yearN = yearNo(items.find((it) => it?.연차)?.연차) || n || 1;
  const y = yearBook(project, yearN);
  const report = { n: yearN, added: 0, updated: 0, budget: 0 };
  for (const it of items) {
    const raw = str(it?.비목);
    if (!raw || SKIP_KEYS.has(norm(raw)) || norm(raw) === '연구개발비총액') continue;
    const name = itemName(raw);
    const hist = Array.isArray(it.history) ? it.history : [];
    for (let i = 1; i < hist.length; i++) {
      const prev = hist[i - 1];
      const cur = hist[i];
      const rev = str(cur?.rev);
      const key = `budget:${rev}:${norm(name)}`;
      if (!rev || y.changes.some((c) => c.key === key)) continue;
      const a = (amountOf(prev?.금액) ?? 0) * mul;
      const b = (amountOf(cur?.금액) ?? 0) * mul;
      const date = revDate(y, rev) || today;
      const dup = y.changes.find((c) => c.kind === '예산' && !c.key?.startsWith('budget:') && sameItem(c.item, name) && moneyIn(c.before) === a && moneyIn(c.after) === b);
      if (dup) {
        Object.assign(dup, { reason: str(cur?.사유) || dup.reason, date: revDate(y, rev) || dup.date, key });
        report.updated++;
        continue;
      }
      y.changes.push(change('예산', name, won(a), won(b), str(cur?.사유), date, key));
      report.added++;
    }
    const now = amountOf(it.금액);
    if (now == null) continue;
    let row = y.budget.find((r) => sameItem(r.item, name));
    if (!row) {
      row = { id: newId(), item: name, plan: null, used: null };
      y.budget.push(row);
    }
    row.plan = now ? Math.round(now * mul) : null;
    report.budget++;
  }
  book.current.project = project.id;
  book.current.year[project.id] = yearN;
  return report;
}

const WATCH = ['status', '참여기간참여율', '인건비', '급여총액'];
/** 참여연구원 한 사람의 형편을 한 줄로 — "활성 · 참여율 15% · 인건비 11,250천원". */
function personText(state, unitLabel) {
  if (str(state.status) === '제외') return '제외';
  const bits = [str(state.status), state.참여기간참여율 != null ? `참여율 ${state.참여기간참여율}%` : '', state.인건비 != null ? `인건비 ${Number(state.인건비).toLocaleString('ko-KR')}${unitLabel}` : ''].filter(Boolean);
  return bits.join(' · ') || '(기록 없음)';
}

/**
 * 참여연구원 이력(history/researchers_history.yaml) — 사람마다 history 의 이웃 rev 사이에 참여율·인건비·제외가 달라졌으면 변경이력 한 줄(연구진).
 * history 는 바뀐 칸만 겹쳐 적는 꼴(sparse)이라 앞의 것에 덧대어 읽는다.
 * @returns {{ n: number, added: number }}
 */
export function applyResearchersHistory(book, obj, { project, n = 0, today = todayStr() } = {}) {
  if (!project) throw new Error('넣을 과제가 없습니다 — 먼저 그 과제의 스냅샷(KR_<과제>.yaml)을 넣거나 과제를 고르세요.');
  const items = Array.isArray(obj?.items) ? obj.items : [];
  const yearN = yearNo(items.find((it) => it?.연차)?.연차) || n || 1;
  const y = yearBook(project, yearN);
  const unitLabel = str(obj?.unit) === '원' ? '원' : '천원';
  const report = { n: yearN, added: 0 };
  for (const it of items) {
    const name = str(it?.성명);
    const hist = Array.isArray(it?.history) ? it.history : [];
    if (!name || hist.length < 2) continue;
    let state = {};
    let prev = null;
    for (const rec of hist) {
      const next = { ...state };
      for (const k of WATCH) if (rec && rec[k] != null) next[k] = rec[k];
      if (prev) {
        const rev = str(rec?.rev);
        const key = `researchers:${rev}:${name}`;
        const differs = WATCH.some((k) => String(prev[k] ?? '') !== String(next[k] ?? ''));
        if (rev && differs && !y.changes.some((c) => c.key === key)) {
          y.changes.push(change('연구진', name, personText(prev, unitLabel), personText(next, unitLabel), str(rec?.사유), revDate(y, rev) || today, key));
          report.added++;
        }
      }
      prev = next;
      state = next;
    }
  }
  book.current.project = project.id;
  book.current.year[project.id] = yearN;
  return report;
}

/**
 * 풀어 둔 YAML 객체 하나를 장부에 넣는다 — 종류를 가려 알맞은 길로. 이력 파일은 주석의 과제명으로 과제를 찾고, 없으면 보고 있는 과제.
 * @param {{ text?: string, file?: string, current?: object|null, n?: number, today?: string }} opts text 는 원문(머리 주석·과제명 주석을 읽는다)
 * @returns {{ kind: string, label: string, summary: string, project: object|null }}
 */
export function applyYaml(book, obj, { text = '', file = '', current = null, n = 0, today = todayStr() } = {}) {
  const kind = kindOf(obj);
  if (!kind) throw new Error('아는 모양의 YAML 이 아닙니다 — 연구개발계획서 스냅샷(meta.과제명)이나 history 의 revisions·budget·researchers 파일을 넣으세요.');
  const label = KIND_LABEL[kind];
  if (kind === 'snapshot') {
    const snap = readSnapshot(obj);
    const r = applySnapshot(book, snap, { today, header: headerOf(text), file });
    const bits = [`${r.created ? '과제 만듦' : '과제 찾음'}: ${r.project.alias || r.project.name}`, `${r.n}차년도`, r.budget ? `비목 ${r.budget}개` : '', ...r.logs, r.changes.length ? `변경이력 ${r.changes.length}건` : ''];
    return { kind, label, summary: bits.filter(Boolean).join(' · '), project: r.project };
  }
  const hint = projectHint(text);
  const project = (hint && findProject(book, { name: hint })) || current;
  const opts = { project, n, today };
  if (kind === 'revisions') {
    const r = applyRevisions(book, obj, opts);
    return { kind, label, summary: `${project.alias || project.name} ${r.n}차년도 · 변경이력 ${r.added}건 넣음${r.updated ? ` · ${r.updated}건 고침` : ''}`, project };
  }
  if (kind === 'budget') {
    const r = applyBudgetHistory(book, obj, opts);
    return { kind, label, summary: `${project.alias || project.name} ${r.n}차년도 · 변경이력 ${r.added}건 넣음${r.updated ? ` · ${r.updated}건에 사유 붙임` : ''} · 비목 ${r.budget}개`, project };
  }
  const r = applyResearchersHistory(book, obj, opts);
  return { kind, label, summary: `${project.alias || project.name} ${r.n}차년도 · 변경이력 ${r.added}건 넣음`, project };
}
