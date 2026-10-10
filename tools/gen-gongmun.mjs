// recipes/gongmun → src/gmrecipe.js
//
// 공문 레시피(krs-web-agents ea_recipes 와 같은 층: 유닛 → forms/<폼> → purposes/<목적>)를 확장이 읽는 JS 모듈 하나로 옮긴다.
// 확장은 번들러 없는 순수 ES 모듈이라 YAML 을 읽지 못한다. 레시피를 고친 뒤 `node tools/gen-gongmun.mjs`(npm run gen)를 돌린다.
// `--check` 는 쓰지 않고 어긋났는지만 본다. 틀린 레시피는 무엇이 틀렸는지만 말하고 끝낸다 — 틀린 레시피로 공문을 쓰면 조용히 틀린다.
// `--prompt <갈래>` 는 그 갈래의 문서를 읽을 때 Claude 가 받는 지시문 전문을, `--prompt <갈래> reason` 은 사유 쓰기의 지시문을,
// `--prompt setup` 은 공문 설정 채우기의 지시문을 보인다(레시피에서 바로 만든다 — 생성물을 다시 만들지 않는다).
//
//   recipes/gongmun/
//     registries/delegation.yaml   위임전결(rule_key → 기준·전결권자·근거)
//     registries/settings.yaml     문서설정(프로파일·부서 코드·선택지)
//     registries/reading.yaml      문서 읽기의 공통 지시문(역할·문서 종류·첨부 파일 종류·요약·견적서 오릴 칸·규칙)
//     registries/writing.yaml      사유 쓰기의 공통 지시문(역할·답 한 줄·규칙)
//     registries/setup.yaml        공문 설정 채우기의 지시문(과제·과제책임자·부서장·참조자)
//     registries/vars.yaml         틀의 공통 자리(부서·과제명·첨부 …)의 뜻
//     <유닛>/forms/<폼>/manifest.yaml · fieldmap.yaml
//     <유닛>/forms/<폼>/purposes/<목적>/purpose.yaml · body_spec.yaml · attach_rules.yaml
//
// Claude 에게 주는 작업(input.yaml 과 같은 꼴)을 셋 만들어 생성물의 tasks 에 둔다 — src/input.js 가 input.yaml 의 작업과 함께 쓴다.
//   gongmun.<목적>        문서 읽기 — reading.yaml + 갈래의 purpose.yaml(칸마다 read·example, reads, reading, quote_crop)
//   gongmunReason.<목적>  사유 쓰기 — writing.yaml + 갈래의 purpose.yaml(칸마다 write·example, writing)
//   gongmunSetup          공문 설정 채우기 — setup.yaml

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { checkSpec } from './gen-input.mjs';

const ROOT = fileURLToPath(new URL('../recipes/gongmun/', import.meta.url));
const TARGET = new URL('../src/gmrecipe.js', import.meta.url);

const FIELD_KINDS = new Set(['text', 'title', 'picker', 'dext5']);
const SOURCES = new Set(['title', 'recipient', 'reference', 'degree', 'job', 'jobText', 'body']);
/** 초안 칸(purpose.yaml fields)의 형. 읽기만 하는 키(reads·reading.yaml)는 number(수)·list(목록)도 쓴다. */
const FIELD_TYPES = new Set(['text', 'money', 'date', 'choice']);
const READ_TYPES = new Set([...FIELD_TYPES, 'number', 'list']);
/** 칸의 값이 어디서 오는가 — purchase/purpose.yaml 머리말. */
const FROMS = new Set(['document', 'write', 'me', 'user', 'auto', 'setup']);
/** 틀 자리의 꼴 — purchase/body_spec.yaml 머리말. 두 칸을 쓰는 꼴(period·qty)은 from 이 [앞, 뒤] 다. */
const SHOWS = new Set(['text', 'won', 'date', 'period', 'count', 'qty']);
const PAIR_SHOWS = new Set(['period', 'qty']);
/** 틀의 공통 자리 — src/gongmun.js 의 varsFor 가 채우는 이름. registries/vars.yaml 의 common 이 이것과 같아야 한다. */
export const COMMON_VARS = ['부서', '기안자', '과제명', '과제별명', '과제번호', '연구기간', '과제책임자', '과제개요', '계정', '오늘', '첨부'];
const TPL_MARKS = new Set(['차례', '세부차례']);
/** 지시문의 역할에 쓸 수 있는 자리 — 읽기(reading.yaml)와 사유 쓰기(writing.yaml). */
const ROLE_SLOTS = new Set(['품의', '문서']);
const WRITE_SLOTS = new Set(['품의', '칸']);
/** 값이 Claude 에게 가는 지시문인 칸의 from — 읽는 칸(document)과 쓰는 칸(write). */
const PROMPTED = new Set(['document', 'write']);
const BASES = new Set(['amount', 'division', 'none']);
const PURPOSE_FILES = ['purpose.yaml', 'body_spec.yaml', 'attach_rules.yaml'];

const isStr = (v) => typeof v === 'string' && !!v.trim();
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const typeOf = (k) => k?.type ?? 'text';

/** 예시(example)가 그 형의 모양인가 — 틀리면 무엇이 틀렸는지. 예시는 Claude 가 따라 쓰는 꼴이라 틀리면 답도 틀린다. */
function exampleProblem(k) {
  const v = k.example;
  switch (typeOf(k)) {
    case 'date': {
      const m = typeof v === 'string' && v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const d = m && new Date(+m[1], +m[2] - 1, +m[3]);
      return d && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? '' : `example(${v})은 YYYY-MM-DD 날짜여야 합니다`;
    }
    case 'money':
    case 'number': return Number.isFinite(v) && v >= 0 ? '' : `example(${v})은 쉼표·원 없는 수여야 합니다`;
    case 'choice': return list(k.options).includes(v) ? '' : `example(${v})이 options 에 없습니다`;
    case 'list': return 'list 에는 example 을 두지 않습니다 — 줄의 키(item)마다 둡니다';
    default: return typeof v === 'string' || Number.isFinite(v) ? '' : 'example 은 글이어야 합니다';
  }
}

/**
 * Claude 에게 주는 키 하나(reading.yaml·setup.yaml 의 키, reads, 목록의 줄 키 — verb 'read' / writing.yaml 의 키 — verb 'write')의 모양.
 * names 는 화면이 그 값(고르는 키의 options)을 부르는 이름이다 — Claude 에게는 가지 않는다.
 */
function checkReadKey(at, where, k, nested = false, verb = 'read') {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(k?.key || '')) return at(where, `key(${k?.key})는 영문·숫자 이름이어야 합니다`);
  const w = `${where} ${k.key}`;
  const type = typeOf(k);
  if (!READ_TYPES.has(type)) at(w, `모르는 type ${type}`);
  if (!isStr(k[verb])) at(w, `${verb}(${verb === 'read' ? '읽는' : '쓰는'} 법 — Claude 에게 가는 지시문)가 비어 있습니다`);
  if (type === 'choice' && !(list(k.options).length && k.options.every(isStr))) at(w, 'choice 는 options 가 있어야 합니다');
  if ('names' in k && !(type === 'choice' && isObj(k.names) && Object.entries(k.names).every(([v, n]) => k.options.includes(v) && isStr(n)))) {
    at(w, 'names 는 options 의 값: 화면 이름 꼴이어야 합니다');
  }
  if ('max' in k && !(Number.isFinite(k.max) && k.max > 0)) at(w, 'max 는 양의 수여야 합니다');
  if ('required' in k && typeof k.required !== 'boolean') at(w, 'required 는 true·false 여야 합니다');
  if ('example' in k) { const bad = exampleProblem(k); if (bad) at(w, bad); }
  if (type !== 'list') return undefined;
  if (nested) return at(w, '목록 안에 목록을 둘 수 없습니다');
  if (!list(k.item).length) at(w, '목록은 줄의 키(item)가 있어야 합니다');
  for (const x of list(k.item)) checkReadKey(at, `${w}.item`, x, true, verb);
  return dupes(at, `${w}.item`, list(k.item).map((x) => x?.key));
}

function dupes(at, where, keys) {
  const seen = new Set();
  for (const k of keys) {
    if (k && seen.has(k)) at(where, `key ${k} 가 두 번 나옵니다`);
    seen.add(k);
  }
}

/** 틀에 쓴 이름. {이름} · {이름:은} · {이름?} — src/gongmun.js 의 fillTemplate 과 같은 꼴. */
const tokensOf = (s) => [...String(s).matchAll(/\{([^{}:?\s]+)(?::[^{}\s]+)?\??\}/g)].map((m) => m[1]);

/** 틀에 쓴 이름이 다 있는가 — 목록({{#이름}} … {{/이름}}) 안은 그 목록의 자리와 {번호}도 쓴다. */
function templateProblems(tpl, outer, lists) {
  const out = [];
  const rest = String(tpl).replace(/\{\{#([^{}\s]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_w, name, inner) => {
    if (!lists[name]) out.push(`{{#${name}}} 목록이 lists 에 없습니다`);
    else for (const t of tokensOf(inner)) if (!(t in lists[name].vars) && t !== '번호' && !outer.has(t)) out.push(`{{#${name}}} 안의 {${t}} 가 그 목록의 vars·공통 자리에 없습니다`);
    return '';
  });
  if (/\{\{[#/]/.test(rest)) out.push('{{#…}} 과 {{/…}} 의 짝이 맞지 않습니다');
  for (const t of tokensOf(rest)) if (!outer.has(t) && !TPL_MARKS.has(t)) out.push(`{${t}} 가 vars·공통 자리(registries/vars.yaml)에 없습니다`);
  return [...new Set(out)];
}

/** 틀 자리 하나({ from, show, or, desc }) — keys 는 from 으로 가리킬 수 있는 칸, lists 는 그 가운데 목록인 칸. */
function checkVar(at, where, v, keys, lists, { needDesc = true } = {}) {
  if (!isObj(v)) return at(where, '{ from, show, desc } 꼴이어야 합니다');
  const show = v.show ?? 'text';
  if (!SHOWS.has(show)) at(where, `모르는 show ${show} — ${[...SHOWS].join('·')}`);
  const from = Array.isArray(v.from) ? v.from : [v.from];
  if (PAIR_SHOWS.has(show) ? from.length !== 2 : from.length !== 1) at(where, `show ${show} 는 from 이 ${PAIR_SHOWS.has(show) ? '[앞, 뒤] 두 칸' : '한 칸'}이어야 합니다`);
  for (const k of from) if (!keys.has(k)) at(where, `from 의 ${k} 가 칸(key)에 없습니다`);
  if (show === 'count' && !lists.has(from[0])) at(where, 'show count 는 목록(list) 칸을 가리켜야 합니다');
  if ('or' in v && v.or !== 'me') at(where, 'or 는 me(내 이름)만 됩니다');
  if (needDesc && !isStr(v.desc)) at(where, 'desc(양식 칸 아래 보이는 뜻)가 비어 있습니다');
  return undefined;
}
const dirs = (p) => (fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name).sort() : []);

/** 레시피 폴더를 읽어 하나의 덩어리로. 파일을 읽지 못하면 errors 에 적는다(검사는 checkRecipe). */
export function readRecipe(root = ROOT) {
  const errors = [];
  const load = (file) => {
    const rel = path.relative(root, file).replaceAll('\\', '/');
    if (!fs.existsSync(file)) { errors.push(`${rel} 가 없습니다`); return null; }
    try {
      const data = parse(fs.readFileSync(file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) { errors.push(`${rel}: 맨 위는 이름: 값 꼴이어야 합니다`); return null; }
      return data;
    } catch (err) { errors.push(`${rel}: ${err.message.split('\n')[0]}`); return null; }
  };
  const delegation = load(path.join(root, 'registries', 'delegation.yaml'));
  const settings = load(path.join(root, 'registries', 'settings.yaml'));
  const reading = load(path.join(root, 'registries', 'reading.yaml'));
  const writing = load(path.join(root, 'registries', 'writing.yaml'));
  const setup = load(path.join(root, 'registries', 'setup.yaml'));
  const vars = load(path.join(root, 'registries', 'vars.yaml'));
  const forms = [];
  for (const unit of dirs(root).filter((d) => d !== 'registries')) {
    for (const slug of dirs(path.join(root, unit, 'forms'))) {
      const dir = path.join(root, unit, 'forms', slug);
      const manifest = load(path.join(dir, 'manifest.yaml'));
      const fieldmap = load(path.join(dir, 'fieldmap.yaml'));
      const purposes = dirs(path.join(dir, 'purposes')).map((id) => {
        const pdir = path.join(dir, 'purposes', id);
        const [purpose, body, attach] = PURPOSE_FILES.map((f) => load(path.join(pdir, f)));
        return { id, purpose, body, attach };
      });
      forms.push({ unit, slug, manifest, fieldmap, purposes });
    }
  }
  return { delegation, settings, reading, writing, setup, vars, forms, errors };
}

/** 레시피의 모양과 서로 가리키는 것(rule_key·프로파일·칸)을 본다. */
export function checkRecipe({ delegation, settings, reading, writing, setup, vars, forms, errors: readErrors = [] }) {
  const errors = [...readErrors];
  if (readErrors.length) return errors;
  const at = (where, msg) => errors.push(`${where}: ${msg}`);

  // 위임전결
  const ranks = Array.isArray(delegation.ranks) ? delegation.ranks : [];
  if (!ranks.length || ranks.some((r) => !isStr(r))) at('delegation.yaml', 'ranks 는 직책 이름의 목록이어야 합니다');
  for (const [key, r] of Object.entries(delegation.rules || {})) {
    const w = `delegation.yaml rules.${key}`;
    if (!isStr(r?.source)) at(w, 'source(규정 근거)가 없습니다 — 근거 없는 전결권자는 넣지 않습니다');
    if (!BASES.has(r?.basis)) at(w, `모르는 basis ${r?.basis}`);
    const known = (a) => ranks.includes(a);
    if (r?.basis === 'amount') {
      const steps = Array.isArray(r.steps) ? r.steps : [];
      if (!steps.length) at(w, 'steps 가 비어 있습니다');
      steps.forEach((s, i) => {
        if (!known(s?.approver)) at(w, `steps[${i}] 의 전결권자 ${s?.approver} 가 ranks 에 없습니다`);
        const last = i === steps.length - 1;
        if (last ? s.max !== null : !(Number.isFinite(s.max) && s.max > 0)) at(w, `steps[${i}] 의 max 는 ${last ? '마지막 줄이라 null' : '양의 금액'}이어야 합니다`);
        if (i && Number.isFinite(s.max) && !(s.max > steps[i - 1].max)) at(w, `steps[${i}] 의 max 가 앞 줄보다 커야 합니다`);
      });
    } else if (r?.basis === 'division') {
      if (!isStr(r.division_field)) at(w, 'division_field 가 없습니다');
      const ds = Object.entries(r.divisions || {});
      if (!ds.length) at(w, 'divisions 가 비어 있습니다');
      for (const [d, a] of ds) if (!known(a)) at(w, `divisions.${d} 의 전결권자 ${a} 가 ranks 에 없습니다`);
    } else if (r?.basis === 'none' && !known(r.approver)) at(w, `전결권자 ${r.approver} 가 ranks 에 없습니다`);
  }

  // 문서설정
  const opt = settings.options || {};
  const checkSetting = (where, s) => {
    if (!s || typeof s !== 'object') return at(where, '이름: 값 꼴이어야 합니다');
    if ('retention' in s && !(String(s.retention) in (opt.retention || {}))) at(where, `보존년한 ${s.retention} 가 options.retention 에 없습니다`);
    if ('scope' in s && !(s.scope in (opt.scope || {}))) at(where, `공개범위 ${s.scope} 가 options.scope 에 없습니다`);
    if ('receiver' in s && !(opt.receiver || []).includes(s.receiver)) at(where, `수신처 ${s.receiver} 가 options.receiver 에 없습니다`);
    for (const k of ['emergency', 'approving_open', 'drm']) if (k in s && typeof s[k] !== 'boolean') at(where, `${k} 는 true·false 여야 합니다`);
    return undefined;
  };
  checkSetting('settings.yaml defaults', settings.defaults);
  for (const [name, p] of Object.entries(settings.profiles || {})) checkSetting(`settings.yaml profiles.${name}`, p || {});
  for (const [team, code] of Object.entries(settings.teams || {})) if (!/^\d{4}$/.test(String(code))) at('settings.yaml teams', `${team} 의 코드 ${code} 는 네 자리 숫자여야 합니다`);
  const docNoOpts = settings.doc_no_options || {};
  for (const [code, name] of Object.entries(docNoOpts)) if (!/^\d{4}$/.test(String(code)) || !String(name ?? '').trim()) at('settings.yaml doc_no_options', `${code} 는 네 자리 숫자 코드와 이름이어야 합니다`);
  for (const [team, code] of Object.entries(settings.teams || {})) if (Object.keys(docNoOpts).length && !(String(code) in docNoOpts)) at('settings.yaml teams', `${team} 의 코드 ${code} 가 doc_no_options 에 없습니다`);

  // 문서 읽기의 공통 지시문
  if (!isStr(reading.role)) at('reading.yaml', 'role 이 비어 있습니다');
  for (const t of tokensOf(reading.role || '')) if (!ROLE_SLOTS.has(t)) at('reading.yaml role', `{${t}} 는 쓸 수 없는 자리입니다 — {품의}·{문서}만`);
  for (const part of ['before', 'after']) for (const k of list(reading[part])) checkReadKey(at, `reading.yaml ${part}`, k);
  const qa = reading.quote_area;
  if (!isObj(qa) || typeOf(qa) !== 'list') at('reading.yaml', 'quote_area 는 견적서로 오릴 칸의 목록(type: list)이어야 합니다');
  else checkReadKey(at, 'reading.yaml quote_area', qa);
  if (!list(reading.rules).every(isStr)) at('reading.yaml', 'rules 는 글의 목록이어야 합니다');
  const commonKeys = [...list(reading.before), ...list(reading.after), ...(isObj(qa) ? [qa] : [])].map((k) => k?.key);
  dupes(at, 'reading.yaml', commonKeys);

  // 사유 쓰기의 공통 지시문
  if (!isStr(writing.role)) at('writing.yaml', 'role 이 비어 있습니다');
  for (const t of tokensOf(writing.role || '')) if (!WRITE_SLOTS.has(t)) at('writing.yaml role', `{${t}} 는 쓸 수 없는 자리입니다 — {품의}·{칸}만`);
  for (const k of list(writing.after)) checkReadKey(at, 'writing.yaml after', k, false, 'write');
  if (!list(writing.rules).every(isStr)) at('writing.yaml', 'rules 는 글의 목록이어야 합니다');

  // 공문 설정 채우기
  if (!isStr(setup.role)) at('setup.yaml', 'role 이 비어 있습니다');
  if (!list(setup.keys).length) at('setup.yaml', 'keys 가 비어 있습니다');
  for (const k of list(setup.keys)) checkReadKey(at, 'setup.yaml keys', k);
  dupes(at, 'setup.yaml keys', list(setup.keys).map((k) => k?.key));
  if (!list(setup.rules).every(isStr)) at('setup.yaml', 'rules 는 글의 목록이어야 합니다');

  // 틀의 공통 자리 — 코드가 채우는 이름과 같아야 한다.
  const common = isObj(vars.common) ? vars.common : {};
  for (const name of COMMON_VARS) if (!isStr(common[name])) at('vars.yaml common', `${name} 의 뜻이 비어 있습니다`);
  for (const name of Object.keys(common)) if (!COMMON_VARS.includes(name)) at('vars.yaml common', `${name} 는 코드가 채우지 않는 자리입니다 — 갈래만의 자리는 body_spec.yaml 의 vars 에 둡니다`);

  // 폼과 목적
  const formIds = new Set();
  const purposeIds = new Set();
  for (const f of forms) {
    const w = `${f.unit}/forms/${f.slug}`;
    const m = f.manifest || {};
    if (!/^[A-Za-z0-9_]+$/.test(m.form_id || '')) at(`${w}/manifest.yaml`, `form_id ${m.form_id} 가 틀렸습니다`);
    if (formIds.has(m.form_id)) at(`${w}/manifest.yaml`, `form_id ${m.form_id} 가 두 번 나옵니다`);
    formIds.add(m.form_id);
    if (!isStr(m.label)) at(`${w}/manifest.yaml`, 'label 이 비어 있습니다');
    const listed = Array.isArray(m.purposes) ? m.purposes : [];
    const have = f.purposes.map((p) => p.id);
    for (const id of listed) if (!have.includes(id)) at(`${w}/manifest.yaml`, `purposes 의 ${id} 폴더가 없습니다`);
    for (const id of have) if (!listed.includes(id)) at(`${w}/manifest.yaml`, `purposes/${id} 폴더가 purposes 목록에 없습니다`);
    const fm = f.fieldmap || {};
    if (!isStr(fm.anchor)) at(`${w}/fieldmap.yaml`, 'anchor 가 없습니다');
    for (const [key, fld] of Object.entries(fm.fields || {})) {
      const fw = `${w}/fieldmap.yaml fields.${key}`;
      if (!FIELD_KINDS.has(fld?.kind)) at(fw, `모르는 kind ${fld?.kind}`);
      if (!SOURCES.has(fld?.source)) at(fw, `모르는 source ${fld?.source}`);
      if (['text', 'title'].includes(fld?.kind) && !isStr(fld.selector)) at(fw, 'selector 가 없습니다');
      if (fld?.kind === 'picker' && !(isStr(fld.hidden) && isStr(fld.callback) && isStr(fld.list))) at(fw, 'picker 는 hidden·callback·list 가 있어야 합니다');
      if (fld?.kind === 'dext5' && !isStr(fld.control)) at(fw, 'dext5 는 control 이 있어야 합니다');
    }
    if (!Object.values(fm.fields || {}).some((x) => x?.source === 'title')) at(`${w}/fieldmap.yaml`, '제목(source: title) 칸이 없습니다');
    for (const p of f.purposes) {
      const pw = `${w}/purposes/${p.id}`;
      const pu = p.purpose || {};
      if (pu.purpose_id !== p.id) at(`${pw}/purpose.yaml`, `purpose_id(${pu.purpose_id})가 폴더 이름과 다릅니다`);
      if (purposeIds.has(p.id)) at(pw, '같은 목적이 두 폼에 있습니다');
      purposeIds.add(p.id);
      for (const k of ['label', 'title', 'rule_key', 'document_setting']) if (!isStr(pu[k])) at(`${pw}/purpose.yaml`, `${k} 가 비어 있습니다`);
      if (pu.limit !== null && !(Number.isFinite(pu.limit) && pu.limit > 0)) at(`${pw}/purpose.yaml`, 'limit 는 양의 금액이나 null 이어야 합니다');
      if (typeof pu.account !== 'string') at(`${pw}/purpose.yaml`, 'account 는 글이어야 합니다(없으면 빈 글)');
      const fields = Array.isArray(pu.fields) ? pu.fields : [];
      if (!fields.length) at(`${pw}/purpose.yaml`, 'fields 가 비어 있습니다');
      const keys = fields.map((x) => x?.key);
      fields.forEach((x, i) => {
        const fw = `${pw}/purpose.yaml fields[${i}]${isStr(x?.key) ? `(${x.key})` : ''}`;
        if (!isStr(x?.key) || !isStr(x?.label)) at(fw, 'key·label 이 있어야 합니다');
        if (!FIELD_TYPES.has(typeOf(x))) at(fw, `모르는 type ${x?.type} — ${[...FIELD_TYPES].join('·')}`);
        if (x?.type === 'choice' && !(Array.isArray(x.options) && x.options.length && x.options.every(isStr))) at(fw, 'choice 는 options 가 있어야 합니다');
        if (!FROMS.has(x?.from)) at(fw, `from 은 ${[...FROMS].join('·')} 가운데 하나여야 합니다(지금 ${x?.from})`);
        // read·write·example 은 Claude 에게 가는 글이다 — 그 글이 가지 않는 칸에 적으면 아무 데도 가지 않아 고친 사람이 속는다.
        if (x?.from === 'document' && !isStr(x.read)) at(fw, 'from: document 칸은 read(읽는 법 — Claude 에게 가는 지시문)가 있어야 합니다');
        if (x?.from === 'write' && !isStr(x.write)) at(fw, 'from: write 칸은 write(쓰는 법 — Claude 에게 가는 지시문)가 있어야 합니다');
        if (x && x.from !== 'document' && 'read' in x) at(fw, 'read 는 from: document 칸에만 씁니다 — 이 칸은 문서에서 읽지 않아 Claude 에게 가지 않습니다');
        if (x && !PROMPTED.has(x.from)) for (const k of ['write', 'example']) if (k in x) at(fw, `${k} 는 from: document·write 칸에만 씁니다 — 이 칸의 값은 Claude 가 정하지 않습니다`);
        if (x && 'write' in x && !isStr(x.write)) at(fw, 'write 가 비어 있습니다');
        if (x && 'example' in x) { const bad = exampleProblem(x); if (bad) at(fw, bad); }
        if (x && 'online' in x && !(x.key === 'mode' && list(x.online).length && x.online.every(isStr))) at(fw, 'online 은 교육 구분(mode) 칸의 말 목록이어야 합니다');
        if (x && 'required' in x) at(fw, 'fields 에는 required 대신 need(남은 것에 뜨는 이름)를 씁니다');
        if (x && 'need' in x && !isStr(x.need)) at(fw, 'need 는 남은 것에 뜨는 이름(글)이어야 합니다');
        if (x && 'max' in x && !(Number.isFinite(x.max) && x.max > 0)) at(fw, 'max 는 양의 수여야 합니다');
        if (x && 'not_before' in x) {
          const to = fields.find((f) => f?.key === x.not_before);
          if (typeOf(x) !== 'date' || typeOf(to) !== 'date' || to === x) at(fw, `not_before(${x.not_before})는 날짜 칸이 다른 날짜 칸의 key 를 가리켜야 합니다`);
        }
      });
      if (new Set(keys).size !== keys.length) at(`${pw}/purpose.yaml`, 'fields 의 key 가 겹칩니다');
      // 문서 읽기 — 이 갈래에 넣는 문서·규칙, 칸에 없이 더 읽는 것(reads), 견적서 오리기(quote_crop).
      const rd = pu.reading;
      if (!isObj(rd) || !isStr(rd.docs)) at(`${pw}/purpose.yaml`, 'reading.docs(이 갈래에 넣는 문서)가 비어 있습니다');
      if (isObj(rd) && !(Array.isArray(rd.rules) && rd.rules.every(isStr))) at(`${pw}/purpose.yaml`, 'reading.rules 는 글의 목록이어야 합니다(없으면 [])');
      const reads = list(pu.reads);
      if ('reads' in pu && !Array.isArray(pu.reads)) at(`${pw}/purpose.yaml`, 'reads 는 { key, type, read } 의 목록이어야 합니다');
      for (const k of reads) checkReadKey(at, `${pw}/purpose.yaml reads`, k);
      const crop = pu.quote_crop;
      if (crop != null) {
        const cw = `${pw}/purpose.yaml quote_crop`;
        if (!isObj(crop)) at(cw, '{ when, keep, drop, read } 꼴이어야 합니다');
        else {
          if (!isStr(crop.when)) at(cw, 'when(오리는 때)이 비어 있습니다');
          if (!(list(crop.keep).length && crop.keep.every(isStr))) at(cw, 'keep(오린 칸에 꼭 들어갈 것)은 글의 목록이어야 합니다');
          if (!list(crop.drop).every(isStr)) at(cw, 'drop(넣지 않을 것)은 글의 목록이어야 합니다');
          if ('read' in crop && !isStr(crop.read)) at(cw, 'read 가 비어 있습니다');
        }
      }
      // 읽는 키는 한 답 안에서 겹치면 안 된다 — 공통 키·문서에서 읽는 칸·reads·오릴 칸.
      const docKeys = fields.filter((x) => x?.from === 'document').map((x) => x.key);
      dupes(at, `${pw}/purpose.yaml 의 읽는 키(reading.yaml 공통 키 포함)`, [...commonKeys.filter((k) => k !== qa?.key), ...docKeys, ...reads.map((k) => k?.key), ...(crop ? [qa?.key] : [])]);
      const rule = delegation.rules?.[pu.rule_key];
      if (!rule) at(`${pw}/purpose.yaml`, `rule_key ${pu.rule_key} 가 delegation.yaml 에 없습니다`);
      if (rule?.basis === 'amount' && !keys.includes(pu.amount_field)) at(`${pw}/purpose.yaml`, `금액 기준 전결이라 amount_field(${pu.amount_field})가 fields 에 있어야 합니다`);
      if (rule?.basis === 'division') {
        const df = fields.find((x) => x?.key === rule.division_field);
        if (!df) at(`${pw}/purpose.yaml`, `구분 기준 전결이라 ${rule.division_field} 칸이 있어야 합니다`);
        else if (!Object.keys(rule.divisions || {}).every((d) => (df.options || []).includes(d))) at(`${pw}/purpose.yaml`, `${rule.division_field} 칸의 options 가 divisions 를 다 담지 않습니다`);
      }
      if (pu.amount_field != null && !keys.includes(pu.amount_field)) at(`${pw}/purpose.yaml`, `amount_field(${pu.amount_field})가 fields 에 없습니다`);
      if (!(pu.document_setting in (settings.profiles || {}))) at(`${pw}/purpose.yaml`, `document_setting ${pu.document_setting} 가 settings.yaml profiles 에 없습니다`);
      const b = p.body || {};
      if (!isStr(b.title) || !isStr(b.body)) at(`${pw}/body_spec.yaml`, 'title 과 body 가 있어야 합니다');
      // 틀의 자리 — from 은 초안의 칸(fields·reads), 목록 자리의 from 은 그 줄의 키.
      const bw = `${pw}/body_spec.yaml`;
      const draftKeys = new Set([...keys, ...reads.map((k) => k?.key)]);
      const listKeys = new Set(reads.filter((k) => typeOf(k) === 'list').map((k) => k.key));
      if (!isObj(b.vars)) at(bw, 'vars 는 이름: { from, show, desc } 꼴이어야 합니다');
      for (const [name, v] of Object.entries(isObj(b.vars) ? b.vars : {})) {
        if (COMMON_VARS.includes(name) || TPL_MARKS.has(name)) at(`${bw} vars.${name}`, '공통 자리와 이름이 같습니다');
        checkVar(at, `${bw} vars.${name}`, v, draftKeys, listKeys);
      }
      if ('lists' in b && !isObj(b.lists)) at(bw, 'lists 는 이름: { from, desc, vars } 꼴이어야 합니다');
      for (const [name, l] of Object.entries(isObj(b.lists) ? b.lists : {})) {
        const lw = `${bw} lists.${name}`;
        if (!isObj(l) || !listKeys.has(l.from)) { at(lw, `from(${l?.from})은 reads 의 목록(list) 칸이어야 합니다`); continue; }
        if (!isStr(l.desc)) at(lw, 'desc 가 비어 있습니다');
        const itemKeys = new Set(list(reads.find((k) => k.key === l.from).item).map((x) => x?.key));
        if (!isObj(l.vars) || !Object.keys(l.vars).length) at(lw, 'vars(줄 안의 자리)가 비어 있습니다');
        for (const [n, v] of Object.entries(isObj(l.vars) ? l.vars : {})) checkVar(at, `${lw}.vars.${n}`, v, itemKeys, new Set(), { needDesc: false });
      }
      const outer = new Set([...COMMON_VARS, ...Object.keys(isObj(b.vars) ? b.vars : {})]);
      const lists = Object.fromEntries(Object.entries(isObj(b.lists) ? b.lists : {}).map(([n, l]) => [n, { vars: isObj(l?.vars) ? l.vars : {} }]));
      for (const part of ['title', 'body']) for (const bad of templateProblems(b[part] || '', outer, lists)) at(`${bw} ${part}`, bad);
      // 사유 쓰기 — write 가 있는 칸이 있으면 '품의할 것' 줄(writing.context — 틀과 같은 꼴, 자리 이름도 같다)이 있어야 하고, 사유 칸(from: write)은 하나다.
      const writes = fields.filter((x) => x && 'write' in x);
      const wr = pu.writing;
      if (writes.length) {
        if (fields.filter((x) => x?.from === 'write').length !== 1) at(`${pw}/purpose.yaml`, '과제 내용으로 쓰는 칸(from: write — 사유)은 하나여야 합니다');
        if (!isObj(wr) || !isStr(wr.context)) at(`${pw}/purpose.yaml`, 'writing.context(Claude 에게 보여 줄 품의할 것)가 비어 있습니다');
        else for (const bad of templateProblems(wr.context, outer, lists)) at(`${pw}/purpose.yaml writing.context`, bad);
        if (isObj(wr) && !(Array.isArray(wr.rules) && wr.rules.every(isStr))) at(`${pw}/purpose.yaml`, 'writing.rules 는 글의 목록이어야 합니다(없으면 [])');
        dupes(at, `${pw}/purpose.yaml 의 쓰는 키(writing.yaml 공통 키 포함)`, [...writes.map((x) => x.key), ...list(writing.after).map((k) => k?.key)]);
      } else if (wr != null) at(`${pw}/purpose.yaml`, 'writing 이 있는데 write 가 있는 칸이 없습니다');
      const a = p.attach || {};
      for (const k of ['doc', 'ask', 'more']) if (!isStr(a[k])) at(`${pw}/attach_rules.yaml`, `${k} 가 비어 있습니다`);
      if (!keys.includes(a.who)) at(`${pw}/attach_rules.yaml`, `who(${a.who})는 첨부 이름에 붙일 초안 칸 — purpose.yaml 의 fields key 여야 합니다`);
      if (!Array.isArray(a.need) || a.need.some((d) => !isStr(d?.label) || !isStr(d?.more))) at(`${pw}/attach_rules.yaml`, 'need 는 {label, more} 의 목록이어야 합니다');
      if (!a.parts || typeof a.parts !== 'object' || Object.values(a.parts).some((v) => !isStr(v))) at(`${pw}/attach_rules.yaml`, 'parts 는 종류: 이름 꼴이어야 합니다');
    }
  }
  if (!purposeIds.size) errors.push('목적(purposes)이 하나도 없습니다');
  return errors;
}

/* ------------------------------------------------------------ 문서 읽기의 지시문 */

/** 레시피의 형 → input.yaml 의 형(src/input.js 가 지시문·스키마·관문을 만든다). money 는 원 단위 수다. */
const SPEC_TYPE = { text: 'string', money: 'number', number: 'number', date: 'date', choice: 'enum', list: 'list' };
const sentence = (s) => String(s).replace(/\s+/g, ' ').trim().replace(/[.。]?$/, '.');
const exampleText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
/** 끝 글자에 받침이 있는가(한글만 — 모르면 없다고 본다). */
const batchim = (w) => { const c = String(w).trim().at(-1)?.charCodeAt(0) ?? 0; return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0; };

/** 읽는 키 하나 → input.yaml 꼴의 칸. 설명(desc)은 read 에 예시를 붙인 것 — 그대로 Claude 에게 간다. */
function specField(k) {
  const type = typeOf(k);
  const read = String(k.read).replace(/\s+/g, ' ').trim();
  const desc = 'example' in k ? `${sentence(read)} 예: ${exampleText(k.example)}` : read;
  const out = { type: SPEC_TYPE[type], desc };
  if (k.required) out.required = true;
  if (type === 'choice') out.values = [...k.options];
  if (type === 'money' || type === 'number') {
    out.min = 0;
    if (k.max != null) out.max = k.max;
  }
  if (type === 'text') out.max = k.max ?? (k.area ? 1000 : 200);
  if (type === 'list') {
    out.max = k.max ?? 30;
    out.item = Object.fromEntries(k.item.map((x) => [x.key, specField(x)]));
  }
  return out;
}

/** 견적서로 오릴 칸 — 공통 꼴(reading.yaml quote_area)에 갈래의 quote_crop(오리는 때·꼭 들어갈 것·넣지 않을 것·잡는 법)을 붙인다. */
function cropField(qa, crop) {
  const read = [
    sentence(qa.read), sentence(`오리는 때: ${crop.when}`), sentence(`오린 칸에 꼭 들어갈 것: ${crop.keep.join('·')}`),
    crop.drop?.length ? sentence(`넣지 않을 것: ${crop.drop.join('·')}`) : '', crop.read ? sentence(crop.read) : '',
  ].filter(Boolean).join(' ');
  return specField({ ...qa, read });
}

/**
 * 갈래 하나의 문서 읽기 작업(input.yaml 의 작업과 같은 꼴 — gongmun.<목적>). 키의 차례는 reading.yaml before → 문서에서 읽는 칸 → reads →
 * 오릴 칸 → after 다. 종료일이 시작일보다 앞서면(not_before) 종료일만 비우고 알린다.
 */
export function taskOf(purpose, reading) {
  const docFields = purpose.fields.filter((f) => f.from === 'document');
  const fields = Object.fromEntries([
    ...list(reading.before).map((k) => [k.key, specField(k)]),
    ...docFields.map((f) => [f.key, specField(f)]),
    ...list(purpose.reads).map((k) => [k.key, specField(k)]),
    ...(purpose.quote_crop ? [[reading.quote_area.key, cropField(reading.quote_area, purpose.quote_crop)]] : []),
    ...list(reading.after).map((k) => [k.key, specField(k)]),
  ]);
  const label = (key) => purpose.fields.find((f) => f.key === key)?.label || key;
  const checks = docFields.filter((f) => f.not_before).map((f) => {
    const [to, from] = [label(f.key), label(f.not_before)];
    return {
      left: f.not_before, op: '<=', right: f.key, drop: f.key,
      message: `${purpose.label} ${to}${batchim(to) ? '이' : '가'} ${from}보다 앞서 ${to}${batchim(to) ? '은' : '는'} 뺐습니다`,
    };
  });
  return {
    title: `${purpose.title}에 넣을 문서 읽기 — ${purpose.reading.docs}`,
    kinds: [purpose.id],
    consumer: { module: 'src/gongmun.js', export: 'fromRecord' },
    next: 'src/gongmun.js fromRecord 가 초안으로 바꾼다 → 사용자가 과제를 고르고 칸을 고친다 → compose 가 틀에 넣어 제목·본문을 만든다',
    role: String(reading.role).replace(/\s+/g, ' ').trim().replaceAll('{품의}', purpose.title).replaceAll('{문서}', purpose.reading.docs),
    fields,
    ...(checks.length ? { checks } : {}),
    rules: [...reading.rules, ...purpose.reading.rules].map((r) => String(r).replace(/\s+/g, ' ').trim()),
  };
}

/* ------------------------------------------------------------ 사유 쓰기·공문 설정 채우기의 지시문 */

/**
 * 갈래 하나의 사유 쓰기 작업(gongmunReason.<목적>). 출력 키는 write 가 있는 칸(사유 — from: write, 그리고 다듬어 쓰는 용도·목적)이고 키 이름이
 * 초안 칸의 key 다. 사유 칸은 꼭 있어야 한다 — 없는 답은 버린다.
 */
export function writeTaskOf(purpose, writing) {
  const writes = purpose.fields.filter((f) => isStr(f.write));
  const names = writes.map((f) => f.label).join('·');
  return {
    title: `${purpose.title}의 ${names} 쓰기`,
    kinds: [purpose.id],
    consumer: { module: 'src/gongmun.js', export: 'applyReason' },
    next: 'src/gongmun.js applyReason 이 초안의 칸에 넣는다 → 사용자가 고친다 → compose 가 본문에 넣는다',
    role: String(writing.role).replace(/\s+/g, ' ').trim().replaceAll('{품의}', purpose.title).replaceAll('{칸}', names),
    fields: Object.fromEntries([
      ...writes.map((f) => [f.key, specField({ ...f, read: f.write, required: f.from === 'write' })]),
      ...list(writing.after).map((k) => [k.key, specField({ ...k, read: k.write })]),
    ]),
    rules: [...writing.rules, ...purpose.writing.rules].map((r) => String(r).replace(/\s+/g, ' ').trim()),
  };
}

/** 공문 설정 채우기 작업(gongmunSetup) — 부분 수정이다(말하지 않은 칸은 빠진다). */
export function setupTaskOf(setup) {
  return {
    title: '공문 공문 설정(과제·과제책임자·과제 별명·연구기간·부서장·참조자) 조각',
    kinds: ['gongmun'],
    partial: true,
    consumer: { module: 'src/gongmun.js', export: 'mergeSetup' },
    next: 'src/gongmun.js mergeSetup 이 공문 설정에 얹는다 → 사용자가 공문 설정 칸에서 확인한다(저장은 패널이 한다)',
    role: String(setup.role).replace(/\s+/g, ' ').trim(),
    fields: Object.fromEntries(setup.keys.map((k) => [k.key, specField(k)])),
    rules: setup.rules.map((r) => String(r).replace(/\s+/g, ' ').trim()),
  };
}

/** 확장이 쓰는 꼴로 — 목적이 있는 폼이 앞이고, 갈래 차례는 manifest 의 purposes 차례다. */
export function buildRecipe(raw) {
  const forms = [...raw.forms].sort((a, b) => (b.purposes.length > 0) - (a.purposes.length > 0) || a.unit.localeCompare(b.unit));
  const docType = list(raw.reading.before).concat(list(raw.reading.after)).find((k) => k.key === 'docType');
  const out = {
    forms: {}, order: [], purposes: {}, delegation: raw.delegation, settings: raw.settings, vars: raw.vars.common,
    docNames: docType?.names || {}, tasks: { gongmunSetup: setupTaskOf(raw.setup) },
  };
  for (const f of forms) {
    const m = f.manifest;
    out.forms[m.form_id] = { id: m.form_id, label: m.label, unit: f.unit, slug: f.slug, anchor: f.fieldmap.anchor, fields: f.fieldmap.fields };
    for (const id of m.purposes || []) {
      const p = f.purposes.find((x) => x.id === id);
      const { purpose_id: _id, fields, reads = [], reading, quote_crop: crop = null, writing = null, ...rest } = p.purpose;
      out.order.push(id);
      out.purposes[id] = {
        id, form: m.form_id, ...rest, fields, reads, reading, quote_crop: crop, writing,
        template: { title: p.body.title, body: p.body.body }, vars: p.body.vars, lists: p.body.lists || {},
        attach: { doc: p.attach.doc, ask: p.attach.ask, more: p.attach.more, need: p.attach.need, parts: p.attach.parts, who: p.attach.who },
      };
      out.tasks[`gongmun.${id}`] = taskOf(out.purposes[id], raw.reading);
      if (writing) out.tasks[`gongmunReason.${id}`] = writeTaskOf(out.purposes[id], raw.writing);
    }
  }
  return out;
}

/** 레시피를 읽고 검사해 확장이 쓰는 꼴로. 틀린 레시피는 무엇이 틀렸는지 적어 던진다. */
export function build(root = ROOT) {
  const raw = readRecipe(root);
  const errors = checkRecipe(raw);
  if (errors.length) throw new Error(`공문 레시피(recipes/gongmun)가 틀렸습니다:\n- ${errors.join('\n- ')}`);
  const out = buildRecipe(raw);
  // 만든 읽기 작업도 input.yaml 의 작업과 같은 검사를 지난다 — 지시문·스키마·관문이 같은 꼴을 읽는다.
  const specErrors = checkSpec({ tasks: out.tasks });
  if (specErrors.length) throw new Error(`공문 레시피의 문서 읽기 작업이 틀렸습니다:\n- ${specErrors.join('\n- ')}`);
  return out;
}

/** 레시피 폴더를 읽어 src/gmrecipe.js 의 글을 만든다. */
export function render(root = ROOT) {
  return '// 생성물 — 고치지 않는다. recipes/gongmun 을 고치고 `node tools/gen-gongmun.mjs` 를 돌린다.\n'
    + `export const RECIPE = ${JSON.stringify(build(root), null, 2)};\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--prompt')) {
  // 지시문 전문 — 레시피에서 바로 만든다. 글로 바꾸는 것은 확장과 같은 함수(src/input.js 의 promptOf)다.
  // --prompt <갈래>(문서 읽기) · --prompt <갈래> reason(사유 쓰기) · --prompt setup(공문 설정 채우기)
  const [what, how] = process.argv.slice(process.argv.indexOf('--prompt') + 1);
  let recipe;
  try { recipe = build(); } catch (err) { console.error(err.message); process.exit(1); }
  const task = recipe.tasks[what === 'setup' ? 'gongmunSetup' : how === 'reason' ? `gongmunReason.${what}` : `gongmun.${what}`];
  if (!task) {
    console.error(`갈래를 적어 주세요 — ${recipe.order.join(' · ')} (예: --prompt edu · --prompt edu reason · --prompt setup)`);
    process.exit(1);
  }
  const { promptOf } = await import('../src/input.js');
  console.log(promptOf(task));
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let next;
  try { next = render(); } catch (err) { console.error(err.message); process.exit(1); }
  const now = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (process.argv.includes('--check')) {
    if (now !== next) {
      console.error('src/gmrecipe.js 가 recipes/gongmun 과 어긋났습니다. `node tools/gen-gongmun.mjs` 를 돌리세요.');
      process.exit(1);
    }
    console.log('src/gmrecipe.js 는 레시피와 같습니다.');
  } else if (now === next) {
    console.log('src/gmrecipe.js — 바뀐 것 없음');
  } else {
    fs.writeFileSync(TARGET, next);
    console.log('src/gmrecipe.js 를 다시 만들었습니다.');
  }
}
