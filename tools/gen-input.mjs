// input.yaml → src/inputspec.js
//
// 확장은 번들러 없는 순수 ES 모듈이라 YAML 을 읽지 못한다. 그래서 명세를 JS 모듈로 옮겨 둔다.
// input.yaml 을 고친 뒤에 `node tools/gen-input.mjs` 를 돌린다. `--check` 는 쓰지 않고 어긋났는지만 본다.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const SOURCE = new URL('../references/input.yaml', import.meta.url);
const TARGET = new URL('../src/inputspec.js', import.meta.url);

const TYPES = new Set(['date', 'time', 'integer', 'number', 'string', 'enum', 'boolean']);
const OPS = new Set(['<', '<=']);

/** 명세의 모양을 본다. 틀린 명세로 지시문과 관문을 만들면 틀린 것이 조용히 통과한다. */
export function checkSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object' || !spec.tasks || typeof spec.tasks !== 'object') return ['tasks 가 없습니다'];
  for (const [name, task] of Object.entries(spec.tasks)) {
    const at = (msg) => errors.push(`${name}: ${msg}`);
    for (const key of ['title', 'role', 'next']) if (typeof task[key] !== 'string' || !task[key].trim()) at(`${key} 가 비어 있습니다`);
    if (!Array.isArray(task.kinds) || !task.kinds.length) at('kinds 가 비어 있습니다');
    if (typeof task.consumer?.module !== 'string' || typeof task.consumer?.export !== 'string') at('consumer 는 module 과 export 가 있어야 합니다');
    if (!Array.isArray(task.rules) || task.rules.some((r) => typeof r !== 'string')) at('rules 는 글의 목록이어야 합니다');
    const fields = task.fields && typeof task.fields === 'object' ? task.fields : {};
    if (!Object.keys(fields).length) at('fields 가 비어 있습니다');
    for (const [key, f] of Object.entries(fields)) {
      if (!TYPES.has(f?.type)) { at(`${key}: 모르는 형 ${f?.type}`); continue; }
      if (typeof f.desc !== 'string' || !f.desc.trim()) at(`${key}: desc 가 비어 있습니다`);
      if (f.type === 'enum' && (!Array.isArray(f.values) || !f.values.length || f.values.some((v) => typeof v !== 'string'))) {
        at(`${key}: enum 은 글로 된 values 가 있어야 합니다`);
      }
      for (const lim of ['min', 'max']) if (lim in f && typeof f[lim] !== 'number') at(`${key}: ${lim} 은 수여야 합니다`);
    }
    for (const c of task.checks || []) {
      if (!(c.left in fields) || !(c.right in fields)) at(`checks: 없는 칸(${c.left}, ${c.right})`);
      if (!OPS.has(c.op)) at(`checks: 모르는 비교 ${c.op}`);
      if (c.drop && !(c.drop in fields)) at(`checks: drop 이 없는 칸(${c.drop})`);
      if (c.drop && fields[c.drop]?.required) at(`checks: 필수 칸(${c.drop})은 비울 수 없습니다`);
      if (typeof c.message !== 'string' || !c.message.trim()) at('checks: message 가 비어 있습니다');
    }
    for (const [kind, v] of Object.entries(task.variants || {})) {
      if (!(task.kinds || []).includes(kind)) at(`variants: kinds 에 없는 종류 ${kind}`);
      for (const [key, message] of Object.entries(v?.clear || {})) {
        if (!(key in fields)) at(`variants.${kind}: 없는 칸 ${key}`);
        else if (fields[key].required) at(`variants.${kind}: 필수 칸(${key})은 비울 수 없습니다`);
        if (typeof message !== 'string' || !message.trim()) at(`variants.${kind}.${key}: 알릴 말이 비어 있습니다`);
      }
    }
  }
  return errors;
}

/** input.yaml 을 읽어 src/inputspec.js 에 들어갈 글을 만든다. */
export function render(yamlText) {
  const spec = parse(yamlText);
  const errors = checkSpec(spec);
  if (errors.length) throw new Error(`input.yaml 이 틀렸습니다:\n- ${errors.join('\n- ')}`);
  return '// 생성물 — 고치지 않는다. input.yaml 을 고치고 `node tools/gen-input.mjs` 를 돌린다.\n'
    + `export const INPUT_SPEC = ${JSON.stringify(spec, null, 2)};\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = render(fs.readFileSync(SOURCE, 'utf8'));
  const now = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (process.argv.includes('--check')) {
    if (now !== next) {
      console.error('src/inputspec.js 가 input.yaml 과 어긋났습니다. `node tools/gen-input.mjs` 를 돌리세요.');
      process.exit(1);
    }
    console.log('src/inputspec.js 는 input.yaml 과 같습니다.');
  } else {
    fs.writeFileSync(TARGET, next);
    console.log(now === next ? '바뀐 것이 없습니다.' : 'src/inputspec.js 를 다시 만들었습니다.');
  }
}
