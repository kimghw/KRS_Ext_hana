// LLM 입력 명세(input.yaml → inputspec.js)를 쓰는 곳.
//
//   systemPrompt(task)          LLM 에게 주는 지시문. 로컬 CLI 다리와 API 가 같은 것을 쓴다
//   jsonSchema(task)            API 의 구조화 출력 스키마
//   structure(task, raw, ctx)   돌아온 답을 실행자에 넘기기 전에 지나는 관문 — 검증하고 정규화한다
//
// LLM 이 정하는 것은 명세에 적힌 칸의 값뿐이다. 어느 종류(회의실·차량·근태)인지, 어느 함수·주소로
// 갈지는 화면이 정하고 여기서는 받지 않는다. 명세에 없는 키는 버린다.
//
// 확장(브라우저)과 네이티브 다리(Node)가 같이 읽는다. DOM 도 Node API 도 쓰지 않는다.
//
// 작업은 input.yaml 의 것에, 공문 문서 읽기(gongmun.<갈래>)를 더한다 — 그것은 공문 레시피(recipes/gongmun)의 칸마다 적힌 읽는 법으로
// 만든다(tools/gen-gongmun.mjs → src/gmrecipe.js 의 tasks).

import { INPUT_SPEC } from './inputspec.js';
import { RECIPE } from './gmrecipe.js';

export const TASKS = { ...INPUT_SPEC.tasks, ...RECIPE.tasks };

/** 답이 명세와 달라 실행자에 넘길 수 없다. problems 는 무엇이 어긋났는지다. */
export class InputError extends Error {
  constructor(task, problems) {
    super(`답이 입력 명세와 다릅니다 — ${problems.join(', ')}`);
    this.name = 'InputError';
    this.task = task;
    this.problems = problems;
  }
}

const specOf = (task) => {
  // 이름이 명세에 있는 것만 받는다. 'constructor' 같은 이름이 객체의 내장 속성에 걸리면 안 된다.
  if (typeof task !== 'string' || !Object.hasOwn(TASKS, task)) throw new InputError(task, [`모르는 작업 ${task}`]);
  return TASKS[task];
};

/* ------------------------------------------------------------ 지시문·스키마 */

const range = (f) => (f.min != null && f.max != null ? ` ${f.min}~${f.max}` : f.min != null ? ` ${f.min} 이상` : f.max != null ? ` ${f.max} 이하` : '');

/** 사람이 읽는 형 이름. 지시문과 스키마 설명에 같이 쓴다. */
function typeLabel(f) {
  switch (f.type) {
    case 'date': return '날짜 YYYY-MM-DD';
    case 'time': return '시각 HH:MM';
    case 'integer': return `정수${range(f)}`;
    case 'number': return `수${range(f)}`;
    case 'enum': return f.values.map((v) => `"${v}"`).join(' | ');
    case 'boolean': return 'true | false';
    case 'list': return `목록(${f.max ?? 50}줄까지) — 줄마다 아래 키의 객체`;
    default: return '글';
  }
}

/** 칸 한 줄의 설명. 목록이면 그 아래에 줄의 키를 들여 적는다. */
function keyLines(key, f, indent = '') {
  const head = `${indent}- ${key} (${typeLabel(f)}${f.required ? ', 필수' : ' 또는 null'}): ${f.desc}`;
  if (f.type !== 'list') return [head];
  return [head, ...Object.entries(f.item).flatMap(([k, sf]) => keyLines(k, sf, `${indent}    `))];
}

/**
 * LLM 에게 주는 지시문. 명세의 역할·칸·규칙을 그대로 옮긴다.
 * jsonOnly 는 구조화 출력이 없는 길(로컬 CLI)에서 JSON 만 내라는 말을 덧붙인다.
 */
export function systemPrompt(task, { jsonOnly = false } = {}) {
  return promptOf(specOf(task), { jsonOnly });
}

/** 작업 명세 하나의 지시문 — systemPrompt 와 같은 글(생성기가 레시피에서 바로 만든 작업을 보일 때도 쓴다). */
export function promptOf(spec, { jsonOnly = false } = {}) {
  const keys = Object.entries(spec.fields).flatMap(([key, f]) => keyLines(key, f));
  return [
    spec.role,
    '',
    '출력 키:',
    ...keys,
    '',
    '규칙:',
    ...spec.rules.map((r) => `- ${r}`),
    `- 필수가 아닌 키는 ${spec.partial ? '사용자가 말하지 않았으면' : '해당하는 값이 없으면'} null 입니다.`,
    ...(jsonOnly ? ['', 'JSON 객체 하나만 출력합니다. 설명·마크다운·코드 펜스를 붙이지 않습니다. 위의 키를 모두 넣습니다.'] : []),
  ].join('\n');
}

const JSON_TYPE = { date: 'string', time: 'string', string: 'string', enum: 'string', integer: 'integer', number: 'number', boolean: 'boolean', list: 'array' };

/** 칸 하나의 스키마. 목록은 줄마다 같은 모양의 객체다(줄 안의 칸도 모두 받고, 없는 값은 null). */
function propOf(f) {
  const description = f.type === 'enum' || f.type === 'boolean' || f.type === 'string' || f.type === 'list' ? f.desc : `${f.desc} (${typeLabel(f)})`;
  const base = { type: JSON_TYPE[f.type], ...(f.type === 'enum' ? { enum: f.values } : {}), ...(f.type === 'list' ? { items: objectOf(f.item) } : {}) };
  return f.required ? { ...base, description } : { anyOf: [base, { type: 'null' }], description };
}

function objectOf(fields) {
  const properties = {};
  for (const [key, f] of Object.entries(fields)) properties[key] = propOf(f);
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

/**
 * API 구조화 출력(output_config.format)에 넘길 스키마.
 * 구조화 출력은 수 범위(minimum·maximum)와 글 길이를 받지 않는다 — 설명에 적고, 지키는지는 관문이 본다.
 */
export function jsonSchema(task) {
  return objectOf(specOf(task).fields);
}

/* ------------------------------------------------------------------ 관문 */

const pad = (n) => String(n).padStart(2, '0');

function asDate(v) {
  const m = typeof v === 'string' ? v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return undefined;
  // 모양만 맞고 달력에 없는 날(2월 30일)은 받지 않는다.
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? m[0] : undefined;
}

function asTime(v) {
  const m = typeof v === 'string' ? v.trim().match(/^(\d{1,2}):(\d{2})$/) : null;
  return m && +m[1] < 24 && +m[2] < 60 ? `${pad(+m[1])}:${m[2]}` : undefined;
}

function asNumber(v, f) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isFinite(n) || (f.type === 'integer' && !Number.isInteger(n))) return undefined;
  return (f.min != null && n < f.min) || (f.max != null && n > f.max) ? undefined : n;
}

/** 값을 그 칸의 형으로 바꾼다. 받을 수 없으면 undefined. */
function convert(f, v) {
  switch (f.type) {
    case 'date': return asDate(v);
    case 'time': return asTime(v);
    case 'integer':
    case 'number': return asNumber(v, f);
    case 'enum': return typeof v === 'string' && f.values.includes(v.trim()) ? v.trim() : undefined;
    case 'boolean': return typeof v === 'boolean' ? v : undefined;
    case 'string': return typeof v === 'string' ? v.trim().slice(0, f.max ?? 2000) : undefined;
    case 'list': return asList(f, v)?.rows;
    default: return undefined;
  }
}

/**
 * 목록. 줄마다 줄의 칸(item)을 같은 규칙으로 본다 — 줄의 필수 칸이 없거나 틀리면 그 줄을 빼고, 나머지 칸은 틀리면 비운다.
 * 배열이 아니면 받지 않는다(undefined). dropped 는 뺀 줄 수다.
 */
function asList(f, v) {
  if (!Array.isArray(v)) return undefined;
  const rows = [];
  let dropped = 0;
  for (const x of v.slice(0, f.max ?? 50)) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) { dropped++; continue; }
    const row = {};
    let ok = true;
    for (const [k, sf] of Object.entries(f.item)) {
      const sv = x[k];
      const absent = sv == null || (typeof sv === 'string' && !sv.trim());
      const val = absent ? undefined : convert(sf, sv);
      row[k] = val ?? null;
      if (val === undefined && sf.required) ok = false;
    }
    if (ok) rows.push(row);
    else dropped++;
  }
  return { rows, dropped };
}

const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return String(s).length > 30 ? `${String(s).slice(0, 30)}…` : String(s);
};

/** 칸을 사람에게 부를 이름 — 설명의 첫 마디. */
const nameOf = (f, key) => String(f.desc || key).split(/[.,(:]/)[0].trim() || key;

/**
 * 답을 명세로 검증·정규화한다. **어느 길로 온 답이든**(로컬 CLI·API·규칙 해석) 실행자에 넘기기 전에 여기를 지난다.
 *
 * - 필수 칸이 없거나 틀리면, 또는 칸 사이의 관계(checks)가 어긋나면 InputError 를 던진다. 부르는 쪽은 다음 길로 내려간다.
 * - 필수가 아닌 칸이 틀리면 그 칸만 비우고 notes 에 적는다. 말없이 버리면 사용자는 반영된 줄 안다.
 * - ctx.kind 가 받지 않는 조건(variants)은 비우고 notes 에 적는다.
 * - 부분 수정(partial)이면 비어 있는 칸은 아예 빼고 돌려준다 — null 은 "지우기"가 아니다.
 *
 * @param {string} task input.yaml 의 작업 이름
 * @param {unknown} raw LLM 또는 규칙 해석이 준 것
 * @param {{kind?: string}} [ctx] 화면이 정한 종류
 * @returns {{data: object, notes: string[]}}
 */
export function structure(task, raw, { kind } = {}) {
  const spec = specOf(task);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InputError(task, ['JSON 객체가 아닙니다']);

  const data = {};
  const problems = [];
  const notes = [];
  for (const [key, f] of Object.entries(spec.fields)) {
    const v = raw[key];
    const absent = v == null || (typeof v === 'string' && !v.trim());
    const value = absent ? undefined : convert(f, v);
    data[key] = value ?? null;
    // 목록은 받되 틀린 줄만 뺐으면 그 사실을 알린다. 필수 목록이 다 빠져 비었으면 없는 것과 같다.
    if (f.type === 'list' && value) {
      const dropped = asList(f, v).dropped;
      if (dropped) notes.push(`${nameOf(f, key)} 중 ${dropped}줄은 받을 수 없어 뺐습니다`);
      if (!value.length && f.required) problems.push(`${key} 가 비어 있습니다`);
      continue;
    }
    if (value !== undefined) continue;
    if (f.required) problems.push(absent ? `${key} 가 없습니다` : `${key} 값(${show(v)})이 틀렸습니다`);
    else if (!absent) notes.push(`${nameOf(f, key)} 값(${show(v)})은 받을 수 없어 뺐습니다`);
  }

  for (const c of spec.checks || []) {
    const a = data[c.left];
    const b = data[c.right];
    if (a == null || b == null || (c.op === '<' ? a < b : a <= b)) continue;
    if (c.drop) {
      data[c.drop] = null;
      notes.push(c.message);
    } else {
      problems.push(c.message);
    }
  }
  if (problems.length) throw new InputError(task, problems);

  for (const [key, message] of Object.entries(spec.variants?.[kind]?.clear || {})) {
    if (data[key] == null) continue;
    data[key] = null;
    notes.push(message);
  }

  if (spec.partial) for (const key of Object.keys(data)) if (data[key] == null) delete data[key];
  return { data, notes };
}
