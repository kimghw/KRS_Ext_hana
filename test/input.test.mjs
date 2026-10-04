// 입력 명세(input.yaml)와 그것을 쓰는 것들이 어긋나지 않았는지 본다.
//
//   input.yaml  ──(tools/gen-input.mjs)──▶  src/inputspec.js  ──▶  지시문·스키마·관문(src/input.js)
//
// 명세는 손으로 고치는 파일이고 생성물은 커밋돼 있다. 한쪽만 고치면 LLM 이 받는 지시문과
// 관문이 받는 값이 조용히 갈린다 — 여기서 잡는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { render, checkSpec } from '../tools/gen-input.mjs';
import { TASKS, systemPrompt, jsonSchema, structure, InputError } from '../src/input.js';
import { KINDS, SUBS, FLEX_TIMES, FLEX_MODES, FLEX_DAYS, MAX_TRIP_DAYS, flexTimesFor, normalizePatch } from '../src/attend.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');

console.log('명세와 생성물');
t('src/inputspec.js 는 input.yaml 로 만든 그대로다 (어긋났으면 node tools/gen-input.mjs)', () => {
  assert.equal(read('src/inputspec.js'), render(read('references/input.yaml')));
});
t('명세의 모양이 틀리면 생성기가 거부한다', () => {
  assert.deepEqual(checkSpec({ tasks: TASKS }), []);
  const broken = structuredClone({ tasks: TASKS });
  broken.tasks.parse.fields.region.type = 'place';
  broken.tasks.parse.checks.push({ left: 'dateFrom', op: '>', right: 'nowhere', message: 'x' });
  broken.tasks.parse.variants.car.clear.summary = '필수 칸을 비운다';
  Object.assign(broken.tasks.attend.fields.days, { min: 31, max: 1 });
  const errors = checkSpec(broken).join('\n');
  assert.match(errors, /days: min\(31\)이 max\(1\)보다 큽니다/);
  assert.match(errors, /region: 모르는 형 place/);
  assert.match(errors, /없는 칸\(dateFrom, nowhere\)/);
  assert.match(errors, /모르는 비교 >/);
  assert.match(errors, /필수 칸\(summary\)은 비울 수 없습니다/);
});
t('작업마다 구조를 받는 코드(consumer)가 실제로 있다', () => {
  for (const [name, task] of Object.entries(TASKS)) {
    const src = read(task.consumer.module);
    assert.match(src, new RegExp(`export (async )?function ${task.consumer.export}\\b`), `${name}: ${task.consumer.module} 에 ${task.consumer.export} 가 없다`);
  }
});

console.log('근태 명세는 폼 규칙(src/attend.js)과 같은 값을 말한다');
{
  const f = TASKS.attend.fields;
  const starts = FLEX_TIMES.map((x) => x.start);
  t('종류·갈래·유연근무 방식', () => {
    assert.deepEqual(f.kind.values.slice().sort(), Object.keys(KINDS).sort());
    assert.deepEqual(f.sub.values.slice().sort(), Object.values(SUBS).flat().map((s) => s.value).sort());
    assert.deepEqual(f.flexMode.values, FLEX_MODES.map((m) => m.value));
  });
  t('출근시간 — 요일마다 고를 수 있는 값이 다르다', () => {
    assert.deepEqual(f.flexStart.values, starts);
    for (const d of FLEX_DAYS) assert.deepEqual(f[d.key].values, flexTimesFor(d.wide).map((x) => x.start), d.key);
  });
  t('며칠간의 한도', () => assert.equal(f.days.max, MAX_TRIP_DAYS));
  t('관문을 지난 조각은 폼 쪽 정규화(normalizePatch)가 하나도 버리지 않는다', () => {
    const raw = { kind: 'flex', sub: 'OD', half: 'pm', dateFrom: '2026-10-05', dateTo: '2026-10-06', days: 2, start: '9:00', end: '18:00',
      place: ' 부산 ', purpose: '회의', flexStart: '09:30', flexMode: 'week', flexMon: '07:00', flexTue: '08:00', flexWed: '10:00',
      flexThu: '09:00', flexFri: '11:00', allDay: false, reply: '채웠습니다' };
    const { data, notes } = structure('attend', raw);
    assert.deepEqual(notes, []);
    const { reply, ...patch } = data;
    assert.equal(reply, '채웠습니다');
    assert.deepEqual(normalizePatch(patch), patch);
  });
}

console.log('지시문과 스키마');
t('지시문에는 명세의 칸과 규칙이 모두 들어간다', () => {
  for (const [name, task] of Object.entries(TASKS)) {
    const text = systemPrompt(name);
    for (const key of Object.keys(task.fields)) assert.ok(text.includes(`- ${key} (`), `${name}.${key}`);
    for (const rule of task.rules) assert.ok(text.includes(rule), `${name}: ${rule}`);
    assert.ok(!text.includes('JSON 객체 하나만'), '구조화 출력이 있는 길에는 붙이지 않는다');
    assert.ok(systemPrompt(name, { jsonOnly: true }).includes('JSON 객체 하나만 출력합니다'));
  }
});
t('스키마는 구조화 출력이 받는 말만 쓴다 — 수 범위·글 길이는 넣지 않는다', () => {
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'description', 'enum', 'anyOf']);
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    for (const [k, v] of Object.entries(node)) {
      if (k !== 'properties') assert.ok(allowed.has(k), `받지 않는 키: ${k}`);
      else for (const p of Object.values(v)) walk(p);
      if (k === 'anyOf') walk(v);
    }
  };
  for (const name of Object.keys(TASKS)) {
    const schema = jsonSchema(name);
    walk(schema);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, Object.keys(TASKS[name].fields), '모든 키를 받는다(없는 값은 null)');
  }
  assert.deepEqual(jsonSchema('parse').properties.hourFrom, { type: 'integer', description: '하루 중 조회 시작 시 (정수 0~23)' });
  assert.deepEqual(jsonSchema('parse').properties.region, { anyOf: [{ type: 'string', enum: ['부산', '서울'] }, { type: 'null' }], description: '지역' });
});

console.log('관문');
const FILTER = { dateFrom: '2026-10-05', dateTo: '2026-10-06', hourFrom: 9, hourTo: 18, minSeats: 8, minHours: 2, region: '부산', summary: '10/5~6 부산 8명' };
const problemsOf = (task, raw, ctx) => {
  try { structure(task, raw, ctx); } catch (err) { assert.ok(err instanceof InputError); return err.problems; }
  return assert.fail('던져야 한다');
};
t('맞는 답은 그대로 지난다', () => assert.deepEqual(structure('parse', FILTER, { kind: 'room' }), { data: FILTER, notes: [] }));
t('객체가 아니면 받지 않는다', () => {
  for (const raw of [null, 'x', 3, [FILTER]]) assert.deepEqual(problemsOf('parse', raw), ['JSON 객체가 아닙니다']);
});
t('모르는 작업은 받지 않는다', () => assert.deepEqual(problemsOf('reserve', FILTER), ['모르는 작업 reserve']));
t('필수 칸이 없거나 틀리면 통째로 버린다', () => {
  assert.deepEqual(problemsOf('parse', { ...FILTER, dateTo: undefined }), ['dateTo 가 없습니다']);
  assert.deepEqual(problemsOf('parse', { ...FILTER, hourFrom: 24 }), ['hourFrom 값(24)이 틀렸습니다']);
  assert.deepEqual(problemsOf('parse', { ...FILTER, hourTo: 9.5 }), ['hourTo 값(9.5)이 틀렸습니다']);
  assert.deepEqual(problemsOf('parse', { ...FILTER, summary: '   ' }), ['summary 가 없습니다']);
});
t('달력에 없는 날은 날짜가 아니다', () => {
  assert.deepEqual(problemsOf('parse', { ...FILTER, dateFrom: '2026-02-30' }), ['dateFrom 값(2026-02-30)이 틀렸습니다']);
  assert.deepEqual(problemsOf('parse', { ...FILTER, dateFrom: '2026-13-01' }), ['dateFrom 값(2026-13-01)이 틀렸습니다']);
  assert.equal(structure('parse', { ...FILTER, dateFrom: '2028-02-29', dateTo: '2028-02-29' }).data.dateFrom, '2028-02-29');
});
t('칸 사이의 관계가 어긋나면 통째로 버린다', () => {
  assert.deepEqual(problemsOf('parse', { ...FILTER, dateTo: '2026-10-04' }), ['종료일이 시작일보다 앞섭니다']);
  assert.deepEqual(problemsOf('parse', { ...FILTER, hourTo: 9 }), ['종료 시가 시작 시보다 늦어야 합니다']);
  assert.equal(structure('parse', { ...FILTER, dateTo: FILTER.dateFrom }).data.dateTo, FILTER.dateFrom, '하루짜리는 된다');
});
t('근태의 종료일이 시작일보다 앞서면 종료일만 비우고 알린다', () => {
  const { data, notes } = structure('attend', { kind: 'trip', dateFrom: '2026-10-05', dateTo: '2026-10-01' });
  assert.deepEqual(data, { kind: 'trip', dateFrom: '2026-10-05' });
  assert.deepEqual(notes, ['종료일이 시작일보다 앞서 종료일은 뺐습니다']);
});
t('진단은 정해 둔 판정만 받는다', () => {
  assert.deepEqual(problemsOf('diagnose', { verdict: 'saved', cause: '됐습니다' }), ['verdict 값(saved)이 틀렸습니다']);
  assert.deepEqual(structure('diagnose', { verdict: 'unknown', cause: '근거가 없습니다', siteMessage: '', fix: null }).data,
    { verdict: 'unknown', siteMessage: null, cause: '근거가 없습니다', fix: null });
});
t('긴 글은 한도에서 자른다', () => {
  assert.equal(structure('attend', { purpose: '가'.repeat(500) }).data.purpose.length, 200);
});

console.log(`\n통과 ${pass}건`);
