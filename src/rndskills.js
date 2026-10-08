// R&D 탭의 "차년도 YAML 뽑는 스킬" 칸 — RND 프로젝트의 Claude Code 스킬 다섯 개(rnd/skills/, 목록 rnd/skills.json — tools/rndskills.mjs sync)를
// 보여 주고, zip 으로 묶어 내려받게 하고, 쓰는 법(차례·명령)을 글로 복사하게 한다. 이 확장은 YAML 을 뽑지 않는다 — 묶음을 과제 작업 프로젝트의
// .claude/skills/ 에 풀어 Claude Code 에서 돌리고, 나온 YAML 을 R&D 탭에 넣는 것이다(2026-10-08 사용자 지정).

import { buildZip } from './zip.js';

export const MANIFEST_PATH = 'rnd/skills.json';
export const SKILLS_DIR = 'rnd/skills';

/** 뽑는 차례 — 스킬 이름과 그 단계에서 부르는 꼴·나오는 것. 쓰는 법 글과 칸의 설명이 이것을 쓴다. */
export const PIPELINE = Object.freeze([
  { skill: 'rnd-kr-extract', step: '연구개발계획서(PDF·HWP)를 구조화', run: '/rnd-kr-extract <계획서.pdf> --format structured --stage <n>차년도', out: 'RND_PROJECT/<과제>/<n>차년도/KR_<과제>.yaml (그 차년도의 KR 연구개발 내용·예산) · history/ 에 r0 기준선' },
  { skill: 'rnd-manpower-change', step: '참여연구원이 바뀌면 인건비 재배분안', run: '/rnd-manpower-change <KR_과제.yaml> --year <n>차년도 [--adjust <성명>]', out: '참여연구자인건비_변경비교 YAML · 변경안 PDF' },
  { skill: 'rnd-budget-change', step: '비목 사이 예산을 옮기면', run: '/rnd-budget-change <KR_과제.yaml> --year <n>차년도 --from <비목> --to <비목> --amount <천원>', out: '연구개발비비목_변경비교 YAML · 변경안 PDF' },
  { skill: 'rnd-kr-history', step: '변경을 이력에 적재하고 현행 스냅샷 재생성', run: '/rnd-kr-history <변경비교.yaml> --type 연차변경|계획수정 --source <근거문서>  →  /rnd-kr-history <과제이름>', out: 'history/revisions.yaml · budget_history.yaml · researchers_history.yaml · changelog.md · KR_<과제>_r{N}.yaml' },
  { skill: 'rnd-export-latest', step: '과제별 최신 스냅샷을 한 폴더로', run: '/rnd-export-latest [<대상폴더>]', out: 'RND_PROJECT/_export/KR_<과제>.yaml' },
]);

export const zipName = (today) => `rnd-skills_${today}.zip`;
export const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}M` : `${Math.max(1, Math.round(n / 1024))}K`);

/** 목록(rnd/skills.json)이 쓸 만한 모양인지 — 아니면 Error. */
export function checkManifest(m) {
  if (!m || !Array.isArray(m.skills) || !m.skills.length) throw new Error('스킬 목록(rnd/skills.json)이 비어 있습니다 — node tools/rndskills.mjs sync');
  for (const s of m.skills) {
    if (!s.name || !Array.isArray(s.files) || !s.files.some((f) => f.path === 'SKILL.md')) throw new Error(`스킬 ${s.name || '?'} 에 SKILL.md 가 없습니다.`);
  }
  return m;
}

/**
 * 쓰는 법 — 붙여 넣어 읽을 글(코딩 에이전트에 주어도 된다). zip 을 어디에 풀고, 어떤 차례로 무엇을 부르고, 무엇이 나오며, 그것을 R&D 탭에 어떻게 넣는지.
 * @param {object} manifest rnd/skills.json
 * @param {{ today?: string }} [opts]
 */
export function skillGuide(manifest, { today = '' } = {}) {
  const lines = [
    `KRS WORKSPACE — R&D 과제의 차년도 YAML 을 뽑는 Claude Code 스킬 묶음${today ? ` (${today})` : ''}`,
    `원본: RND 프로젝트의 .claude/skills (복사 ${manifest?.syncedAt || '?'}) · 묶음 파일: ${zipName(today || 'YYYY-MM-DD')}`,
    '',
    '풀기: zip 을 과제 작업 프로젝트의 .claude/skills/ 에 풉니다 → .claude/skills/rnd-kr-extract/ … 다섯 폴더. (python 스크립트가 든 스킬은 python 3 이 있어야 합니다)',
    '',
    '차례:',
  ];
  PIPELINE.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.step} — ${p.run}`, `   → ${p.out}`);
  });
  lines.push(
    `${PIPELINE.length + 1}. 나온 YAML(KR_<과제>.yaml · KR_<과제>_r{N}.yaml · history/*.yaml)을 KRS WORKSPACE 의 R&D 탭 "연구개발계획서 YAML 넣기" 에 끌어다 놓으면 과제·차년도의 예산·연구내역·변경이력에 들어갑니다.`,
    '',
    '스킬:',
  );
  for (const s of manifest?.skills || []) {
    lines.push(`- ${s.name} — ${s.summary || ''}`);
    if (s.hint) lines.push(`  인자: ${s.hint}`);
  }
  return lines.join('\n');
}

/**
 * 스킬 파일들을 읽어 zip 하나로. 맨 앞에 README.md(쓰는 법)를 넣는다. read(path) 는 확장 안의 파일을 바이트로 주는 길(패널이 fetch 로 댄다).
 * @param {object} manifest
 * @param {(path: string) => Promise<Uint8Array>} read
 * @param {{ today?: string, date?: Date }} [opts]
 */
export async function bundleSkills(manifest, read, { today = '', date = new Date() } = {}) {
  checkManifest(manifest);
  const entries = [{ name: 'README.md', data: `${skillGuide(manifest, { today })}\n` }];
  for (const s of manifest.skills) {
    for (const f of s.files) entries.push({ name: `${s.name}/${f.path}`, data: await read(`${SKILLS_DIR}/${s.name}/${f.path}`) });
  }
  return buildZip(entries, { date });
}
