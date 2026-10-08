#!/usr/bin/env node
// RND 프로젝트(E:\dev\RND\.claude\skills)에서 차년도 YAML 을 뽑는 데 쓰는 Claude Code 스킬 다섯 개를 rnd/skills/ 로 복사해 두고(묶음),
// 목록(rnd/skills.json — 이름·요약·인자·파일·크기)을 만든다. R&D 탭이 그 목록을 보여 주고 묶음을 zip 으로 내려받게 한다(src/rndskills.js).
// 이 확장은 YAML 을 뽑지 않는다 — 묶음을 다른 프로젝트의 .claude/skills/ 에 풀어 Claude Code 에서 쓰는 것이다(2026-10-08 사용자 지정).
//
//   node tools/rndskills.mjs sync [--source <RND 의 .claude/skills 경로>]   # 원본에서 다시 복사하고 목록을 만든다
//   node tools/rndskills.mjs check [--source <경로>]                        # 복사본이 원본과 다른지 본다(다르면 1 로 끝남)
//   node tools/rndskills.mjs list                                           # 목록을 보인다
//
// 빼는 것: __pycache__·*.pyc(파이썬 캐시), export.config.yaml·publish.config.yaml(사람마다 다른 실값 — RND 의 .toolignore 와 같다), *.tmp·*.bak.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'rnd', 'skills');
const MANIFEST = path.join(ROOT, 'rnd', 'skills.json');
const DEFAULT_SOURCE = 'E:/dev/RND/.claude/skills';
/** 차년도 YAML 파이프라인의 스킬 — 뽑기 → 이력 → 변경(인건비·비목) → 최신본 모으기. 게시(rnd-project-publish)는 YAML 을 뽑는 일이 아니라 뺀다. */
export const SKILLS = ['rnd-kr-extract', 'rnd-kr-history', 'rnd-manpower-change', 'rnd-budget-change', 'rnd-export-latest'];

export const excluded = (rel) => /(^|\/)__pycache__(\/|$)/.test(rel) || /\.pyc$/i.test(rel) || /(^|\/)(export|publish)\.config\.yaml$/.test(rel) || /\.(tmp|bak)$/i.test(rel);

function walk(dir, base = dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (ent.isDirectory()) out.push(...walk(full, base));
    else if (!excluded(rel)) out.push(rel);
  }
  return out.sort();
}

/** SKILL.md 머리(--- … ---)의 name·description·when_to_use·argument-hint. 여러 줄 값(`>-`·`|`)은 들여쓴 줄을 이어 붙이고, 겉 따옴표는 뗀다. */
export function frontmatter(md) {
  const m = String(md).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const lines = (m ? m[1] : '').split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[>|][-+]?$/.test(v)) {
      const parts = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      v = parts.join(' ');
    }
    out[kv[1]] = v.replace(/^"(.*)"$/, '$1').trim();
  }
  return out;
}

/** 긴 description 에서 첫 문장만 — 목록 한 줄에 쓴다. */
export const summaryOf = (desc, max = 140) => {
  const s = String(desc ?? '').replace(/\s+/g, ' ').trim();
  const cut = s.search(/[.。] /);
  const first = cut > 20 ? s.slice(0, cut + 1) : s;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
};

function argOf(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : '';
}

function buildManifest(source) {
  const skills = [];
  for (const name of SKILLS) {
    const dir = path.join(DEST, name);
    if (!fs.existsSync(dir)) throw new Error(`${name} 이 rnd/skills 에 없습니다 — sync 를 먼저 돌리세요.`);
    const files = walk(dir).map((rel) => ({ path: rel, bytes: fs.statSync(path.join(dir, rel)).size }));
    const fm = frontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
    skills.push({
      name, summary: summaryOf(fm.description), when: fm.when_to_use || '', hint: fm['argument-hint'] || '',
      files, bytes: files.reduce((s, f) => s + f.bytes, 0),
    });
  }
  return { source, syncedAt: new Date().toISOString().slice(0, 10), skills };
}

function sync(source) {
  for (const name of SKILLS) {
    const from = path.join(source, name);
    if (!fs.existsSync(path.join(from, 'SKILL.md'))) throw new Error(`원본에 ${name}/SKILL.md 가 없습니다: ${from}`);
    const to = path.join(DEST, name);
    fs.rmSync(to, { recursive: true, force: true });
    for (const rel of walk(from)) {
      const target = path.join(to, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(from, rel), target);
    }
  }
  const manifest = buildManifest(source.split(path.sep).join('/'));
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function check(source) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const diffs = [];
  for (const s of manifest.skills) {
    const from = path.join(source, s.name);
    const have = new Set(s.files.map((f) => f.path));
    const there = fs.existsSync(from) ? walk(from) : [];
    for (const rel of there) if (!have.has(rel)) diffs.push(`${s.name}/${rel}: 원본에만 있음`);
    for (const f of s.files) {
      const a = path.join(DEST, s.name, f.path);
      const b = path.join(from, f.path);
      if (!fs.existsSync(b)) diffs.push(`${s.name}/${f.path}: 원본에 없음`);
      else if (!fs.existsSync(a)) diffs.push(`${s.name}/${f.path}: 복사본에 없음`);
      else if (!fs.readFileSync(a).equals(fs.readFileSync(b))) diffs.push(`${s.name}/${f.path}: 내용이 다름`);
    }
  }
  return diffs;
}

function list() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  console.log(`rnd/skills — ${manifest.skills.length}개 (원본 ${manifest.source}, 복사 ${manifest.syncedAt})`);
  for (const s of manifest.skills) console.log(`  ${s.name.padEnd(20)} 파일 ${String(s.files.length).padStart(2)}개 · ${Math.round(s.bytes / 1024)}K — ${s.summary}`);
}

// 검사(test/rndskills.test.mjs)가 함수만 끌어다 쓸 수 있게, 명령줄로 직접 돌렸을 때만 움직인다.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const action = process.argv[2] || 'list';
  const source = path.resolve(argOf('--source') || DEFAULT_SOURCE);
  if (action === 'sync') {
    const m = sync(source);
    console.log(`복사했습니다 — ${m.skills.map((s) => `${s.name}(${s.files.length})`).join(' · ')} → rnd/skills, 목록 rnd/skills.json`);
  } else if (action === 'check') {
    const diffs = check(source);
    if (diffs.length) {
      console.log(`원본과 다른 것 ${diffs.length}건:\n  ${diffs.join('\n  ')}\n→ node tools/rndskills.mjs sync`);
      process.exit(1);
    }
    console.log('복사본이 원본과 같습니다.');
  } else if (action === 'list') {
    list();
  } else {
    console.log('쓰는 법: node tools/rndskills.mjs sync|check|list [--source <RND 의 .claude/skills 경로>]');
    process.exit(2);
  }
}
