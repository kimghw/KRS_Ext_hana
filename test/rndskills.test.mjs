// 차년도 YAML 뽑는 스킬 묶음 — rnd/skills(복사본)·rnd/skills.json(목록)이 서로 맞는지, 복사 도구(tools/rndskills.mjs)의 머리글 읽기·빼는 것,
// 쓰는 법 글(skillGuide)과 zip 묶음(bundleSkills — src/rndskills.js). 원본(E:\dev\RND)이 없는 PC 에서도 돈다 — 복사본만 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SKILLS, excluded, frontmatter, summaryOf } from '../tools/rndskills.mjs';
import { MANIFEST_PATH, SKILLS_DIR, PIPELINE, zipName, kb, checkManifest, skillGuide, bundleSkills } from '../src/rndskills.js';
import { readZip } from '../src/zip.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_PATH), 'utf8'));

const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  const rel = path.relative(base, full).split(path.sep).join('/');
  return e.isDirectory() ? walk(full, base) : excluded(rel) ? [] : [rel];
}).sort();

console.log('복사본과 목록');
t('스킬 다섯 개가 차례대로 있고 저마다 SKILL.md 가 있다', () => {
  assert.deepEqual(manifest.skills.map((s) => s.name), [...SKILLS]);
  assert.deepEqual([...SKILLS], ['rnd-kr-extract', 'rnd-kr-history', 'rnd-manpower-change', 'rnd-budget-change', 'rnd-export-latest']);
  for (const s of manifest.skills) assert.ok(s.files.some((f) => f.path === 'SKILL.md'), s.name);
  assert.match(manifest.syncedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(manifest.source);
});
t('목록의 파일이 rnd/skills 의 파일과 하나하나 맞는다(이름·크기), 파이썬 캐시·실값 설정은 없다', () => {
  for (const s of manifest.skills) {
    const dir = path.join(ROOT, SKILLS_DIR, s.name);
    assert.deepEqual(s.files.map((f) => f.path), walk(dir), s.name);
    for (const f of s.files) assert.equal(fs.statSync(path.join(dir, f.path)).size, f.bytes, `${s.name}/${f.path}`);
    assert.equal(s.bytes, s.files.reduce((a, f) => a + f.bytes, 0));
    assert.ok(!s.files.some((f) => /__pycache__|\.pyc$|(export|publish)\.config\.yaml$/.test(f.path)));
  }
});
t('요약·인자는 SKILL.md 머리에서 왔다 — 여러 줄 설명도 한 줄로', () => {
  for (const s of manifest.skills) {
    const fm = frontmatter(fs.readFileSync(path.join(ROOT, SKILLS_DIR, s.name, 'SKILL.md'), 'utf8'));
    assert.equal(fm.name, s.name);
    assert.equal(s.summary, summaryOf(fm.description));
    assert.ok(s.summary.length > 20 && !/^[>|]/.test(s.summary), `${s.name}: ${s.summary}`);
    assert.equal(s.hint, fm['argument-hint'] || '');
    assert.ok(s.hint.includes('help') || s.hint.includes('--'), `${s.name} 인자`);
  }
});

console.log('복사 도구');
t('빼는 것 — 파이썬 캐시·실값 설정·임시 파일', () => {
  for (const rel of ['__pycache__/x.pyc', 'scripts/__pycache__/a.cpython-312.pyc', 'a/__pycache__', 'export.config.yaml', 'x/publish.config.yaml', 'a.tmp', 'b.BAK']) assert.ok(excluded(rel), rel);
  for (const rel of ['SKILL.md', 'export.config.tpl.yaml', 'publish.config.tpl.yaml', 'scripts/year_slice.py', 'templates/history/revisions.yaml', 'architecture.svg']) assert.ok(!excluded(rel), rel);
});
t('머리글 읽기 — 한 줄 값, 따옴표, 여러 줄 값(>- · |)', () => {
  const fm = frontmatter('---\nname: x\ndescription: >-\n  첫 줄.\n  둘째 줄\nargument-hint: "[<a>] | help"\nwhen_to_use: |\n  가\n  나\n---\n# 본문\nname: 아님');
  assert.deepEqual(fm, { name: 'x', description: '첫 줄. 둘째 줄', 'argument-hint': '[<a>] | help', when_to_use: '가 나' });
  assert.deepEqual(frontmatter('머리 없음'), {});
  assert.equal(summaryOf('첫 문장이다. 둘째 문장이다.'), '첫 문장이다. 둘째 문장이다.', '스무 자가 안 되는 첫 문장은 안 자른다');
  assert.equal(summaryOf('아주 길어서 스무 자를 넘기는 첫 문장은 여기까지다. 둘째 문장'), '아주 길어서 스무 자를 넘기는 첫 문장은 여기까지다.');
  assert.equal(summaryOf('x'.repeat(200)).length, 140);
  assert.equal(summaryOf(null), '');
});

console.log('쓰는 법·묶음');
t('목록 검사', () => {
  assert.equal(checkManifest(manifest), manifest);
  assert.throws(() => checkManifest(null), /비어 있습니다/);
  assert.throws(() => checkManifest({ skills: [] }), /비어 있습니다/);
  assert.throws(() => checkManifest({ skills: [{ name: 'a', files: [{ path: 'x' }] }] }), /SKILL\.md/);
  assert.equal(zipName('2026-10-08'), 'rnd-skills_2026-10-08.zip');
  assert.deepEqual([kb(500), kb(1024), kb(150 * 1024), kb(2 * 1024 * 1024)], ['1K', '1K', '150K', '2.0M']);
});
t('쓰는 법 — 풀 곳, 차례 다섯에 명령·산출물, R&D 탭에 넣기, 스킬마다 요약과 인자', () => {
  const g = skillGuide(manifest, { today: '2026-10-08' });
  assert.match(g, /^KRS WORKSPACE — R&D 과제의 차년도 YAML 을 뽑는 Claude Code 스킬 묶음 \(2026-10-08\)\n원본: RND 프로젝트의 \.claude\/skills \(복사 \d{4}-\d{2}-\d{2}\) · 묶음 파일: rnd-skills_2026-10-08\.zip\n/);
  assert.match(g, /\n풀기: zip 을 과제 작업 프로젝트의 \.claude\/skills\/ 에 풉니다/);
  PIPELINE.forEach((p, i) => {
    assert.ok(g.includes(`\n${i + 1}. ${p.step} — ${p.run}\n   → ${p.out}`), p.skill);
    assert.ok(manifest.skills.some((s) => s.name === p.skill), `${p.skill} 은 묶음에 있어야 한다`);
  });
  assert.match(g, /\n6\. 나온 YAML\(.*\)을 KRS WORKSPACE 의 R&D 탭 "연구개발계획서 YAML 넣기" 에 끌어다 놓으면/);
  for (const s of manifest.skills) assert.ok(g.includes(`\n- ${s.name} — ${s.summary}\n  인자: ${s.hint}`), s.name);
  assert.match(skillGuide(manifest), /묶음\n원본/, '날짜 없이도');
  assert.match(skillGuide(manifest), /rnd-skills_YYYY-MM-DD\.zip/);
});
await ta('zip 묶음 — README.md 가 맨 앞, 파일은 전부 그대로', async () => {
  const read = async (p) => new Uint8Array(fs.readFileSync(path.join(ROOT, p)));
  const bytes = await bundleSkills(manifest, read, { today: '2026-10-08', date: new Date(2026, 9, 8) });
  const entries = readZip(bytes);
  const total = manifest.skills.reduce((a, s) => a + s.files.length, 0);
  assert.equal(entries.length, total + 1);
  assert.equal(entries[0].name, 'README.md');
  assert.equal(new TextDecoder().decode(entries[0].data), `${skillGuide(manifest, { today: '2026-10-08' })}\n`);
  for (const s of manifest.skills) {
    for (const f of s.files) {
      const e = entries.find((x) => x.name === `${s.name}/${f.path}`);
      assert.ok(e, `${s.name}/${f.path}`);
      assert.ok(Buffer.from(e.data).equals(fs.readFileSync(path.join(ROOT, SKILLS_DIR, s.name, f.path))), `${s.name}/${f.path} 내용`);
    }
  }
  await assert.rejects(() => bundleSkills({ skills: [] }, read), /비어 있습니다/);
});

console.log(`\n${pass} passed`);
