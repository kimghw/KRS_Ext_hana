// 참조 데이터(references/)의 현황을 보고, 밖에서 가져오는 것을 다시 가져온다 — `/refdata` 스킬이 부른다.
//
//   node tools/refdata.mjs [status]                                       현황표 + 다음 할 일
//   node tools/refdata.mjs ktx [<xls 경로|주소>] [--basis YYYY-MM-DD] [--dry-run]   코레일 KTX 운임표를 받아 다시 가져온다
//   node tools/refdata.mjs mileage                                        항공 마일리지 표를 원본과 맞춰 보게 찍는다
//   node tools/refdata.mjs gen | check                                    두 생성기를 돌린다 / 어긋났는지만 본다
//
// 밖에서 오는 것은 둘이다. KTX 공식 운임표는 코레일이 올려 둔 엑셀이라 받아서 가져올 수 있고(ktx), 항공 마일리지 표는 항공사 홈페이지가
// 자동 접근을 막아 사람이 페이지를 열어 맞춰 본다(mileage). 나머지(여비 규칙·길잡이·입력 명세)는 사람이 정해 손으로 고치는 것이다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REF = path.join(ROOT, 'references');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
/** 공식 운임표를 가져온 지 이만큼 지나면 코레일 표가 바뀌었는지 보라고 한다(내가 정한 값 — 운임은 한 해에 한 번도 잘 안 바뀐다). */
const KTX_STALE_DAYS = 90;
/** OLE2(xls) 파일의 첫 여덟 바이트. 주소가 바뀌어 안내 페이지(HTML)가 오면 여기서 걸린다. */
const XLS_MAGIC = 'd0cf11e0a1b11ae1';

const yaml = (name) => parse(fs.readFileSync(path.join(REF, name), 'utf8'));
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const daysSince = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(date || '') ? Math.round((new Date(today()) - new Date(date)) / 86400000) : null);
const ago = (date) => { const n = daysSince(date); return n == null ? '' : n === 0 ? '(오늘)' : `(${n}일 전)`; };
const isUrl = (s) => /^https?:\/\//i.test(s || '');
const option = (args, name) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : ''; };

/** 생성기를 돌린다. 화면에 그대로 찍고 종료 코드를 돌려준다. */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
  if (r.error) { console.error(`${cmd} 를 돌리지 못했습니다: ${r.error.message}`); return 1; }
  return r.status ?? 1;
}
const node = (script, ...args) => run(process.execPath, [path.join('tools', script), ...args]);

/** 생성물이 원본과 같은가 — 조용히 돌려 결과만 본다. */
function inSync(script) {
  const r = spawnSync(process.execPath, [path.join('tools', script), '--check'], { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, said: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

/** 화면 캡처(test/fixtures)의 이름에 든 날짜들 — 사이트 화면이 바뀌었을 때 다시 받아야 하는 것. */
function fixtureDates() {
  if (!fs.existsSync(FIXTURES)) return [];
  return fs.readdirSync(FIXTURES).map((name) => name.match(/(\d{4}-\d{2}-\d{2})/)?.[1]).filter(Boolean).sort();
}

function status() {
  const official = yaml('ktx-fares-official.yaml');
  const fares = yaml('ktx-fares.yaml');
  const mileage = yaml('air-mileage.yaml');
  const input = yaml('input.yaml');
  const captures = fixtureDates();
  const airRoutes = mileage.airlines.reduce((n, line) => n + line.routes.length, 0);
  const checks = [['src/inputspec.js', inSync('gen-input.mjs')], ['src/travelspec.js · references/review.md', inSync('gen-travel.mjs')]];

  const rows = [
    ['KTX 공식 운임', 'ktx-fares-official.yaml', `${official.routes.length}구간 · 기준일 ${official.basis} · ${official.imported} 가져옴 ${ago(official.imported)}`, '밖에서 가져옴 — ktx'],
    ['KTX 손으로 고친 것', 'ktx-fares.yaml', `운임 ${(fares.routes || []).length}구간 · 도시→역 ${Object.keys(fares.places || {}).length}곳 · 갈아타는 역 ${(fares.transfers || []).join('·')}`, '손으로 고침'],
    ['항공 마일리지', 'air-mileage.yaml', `${mileage.airlines.map((line) => line.name).join('·')} ${airRoutes}구간 · 기준일 ${mileage.basis} · ${mileage.checked ? `${mileage.checked} 원본과 맞춰 봄 ${ago(mileage.checked)}` : '원본과 맞춰 보지 못함'}`, '밖에서 옴(사람이 맞춰 봄) — mileage'],
    ['여비 규칙', 'travel-rules.yaml', '식수·일비·출장기간 구분·교통편', '손으로 고침'],
    ['LLM 입력 명세', 'input.yaml', `작업 ${Object.keys(input.tasks).join('·')}`, '손으로 고침'],
    ['사이트 화면 캡처', 'test/fixtures/', captures.length ? `${captures.length}개 · ${captures[0]}${captures.at(-1) !== captures[0] ? ` ~ ${captures.at(-1)}` : ''} ${ago(captures[0])}` : '없음', '사이트에서 받음 — 스킬의 "화면 캡처"'],
  ];
  console.log(`참조 데이터 현황 (${today()})\n`);
  for (const [what, file, state, how] of rows) console.log(`- ${what} [${file}]\n    ${state}\n    ${how}`);
  console.log('\n생성물');
  for (const [name, c] of checks) console.log(`- [${c.ok ? 'OK' : '--'}] ${name}${c.ok ? '' : ` — ${c.said.split('\n')[0]}`}`);

  const todo = [];
  if (checks.some(([, c]) => !c.ok)) todo.push('생성물이 원본과 어긋났다 — `node tools/refdata.mjs gen`(npm run gen)');
  if (!mileage.checked) todo.push('항공 마일리지 표를 원본과 맞춰 본 적이 없다 — `/refdata mileage`');
  if ((daysSince(official.imported) ?? 0) > KTX_STALE_DAYS) todo.push(`KTX 공식 운임을 가져온 지 ${KTX_STALE_DAYS}일이 넘었다 — \`/refdata ktx --dry-run\` 으로 코레일 표가 바뀌었는지 본다`);
  console.log(`\n다음 할 일\n${todo.length ? todo.map((line) => `- ${line}`).join('\n') : '- 없다'}`);
  console.log('\n확장이 실제로 쓰는 값은 references/review.md 에서 표로 본다.');
  return checks.every(([, c]) => c.ok) ? 0 : 1;
}

/** 주소에서 엑셀을 받아 임시 폴더에 둔다. 엑셀이 아니면(주소가 바뀌어 안내 페이지가 오면) 멈춘다. */
async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`받지 못했습니다(HTTP ${res.status}) — 코레일이 주소를 바꿨을 수 있습니다: ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.subarray(0, 8).toString('hex') !== XLS_MAGIC) throw new Error(`받은 것이 엑셀(xls)이 아닙니다(${bytes.length}바이트) — 코레일이 주소를 바꿨을 수 있습니다: ${url}`);
  const dir = path.join(os.tmpdir(), 'krs-refdata');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ktx-fares-${today()}.xls`);
  fs.writeFileSync(file, bytes);
  console.log(`받았습니다: ${file} (${bytes.length.toLocaleString('en-US')}바이트)`);
  return file;
}

async function ktx(args) {
  const official = yaml('ktx-fares-official.yaml');
  const given = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--basis') || '';
  const from = given || official.source;
  const dry = args.includes('--dry-run');
  const basis = option(args, '--basis');
  if (!from) { console.error('받을 주소가 없습니다 — 엑셀 경로나 주소를 주세요.'); return 1; }
  // 새 주소의 표는 새 운임이다 — 기준일을 같이 받아 적지 않으면 예전 기준일이 남아 검토표가 틀린 날짜를 말한다.
  if (!dry && isUrl(from) && from !== official.source && !basis) {
    console.error(`새 주소입니다 — 그 표의 운임 기준일을 같이 주세요: --basis YYYY-MM-DD\n  지금 적힌 것: 기준일 ${official.basis} · ${official.source}`);
    return 1;
  }
  let file = from;
  if (isUrl(from)) {
    try { file = await download(from); } catch (err) { console.error(err.message); return 1; }
  } else if (!fs.existsSync(from)) { console.error(`파일이 없습니다: ${from}`); return 1; }

  const importer = ['run', '--with', 'xlrd', path.join('tools', 'import-ktx-fares.py'), file,
    ...(basis ? ['--basis', basis] : []), ...(isUrl(from) ? ['--source', from] : []), ...(dry ? ['--dry-run'] : [])];
  const code = run('uv', importer);
  if (code || dry) return code;
  console.log('\n생성물을 다시 만듭니다.');
  const gen = node('gen-travel.mjs');
  if (!gen) console.log('\n운임이 바뀌었으면 실제 운임을 적어 둔 테스트(test/travel·tripcard·wiring …)의 기대값도 같이 고친다 — `npm test` 가 짚어 준다.');
  return gen;
}

function mileage() {
  const table = yaml('air-mileage.yaml');
  console.log(`항공 마일리지 표 — 기준일 ${table.basis} · ${table.checked ? `${table.checked} 원본과 맞춰 봄` : '아직 원본과 맞춰 보지 못함'}`);
  console.log(`맞춰 볼 원본: ${table.source || '(source 가 없다)'}\n`);
  for (const line of table.airlines) {
    console.log(`${line.name} — 적립률 일반석 ${line.rates.standard}% · 특실 ${line.rates.first}%`);
    for (const r of line.routes) {
      const earn = (grade) => Math.round((r.miles * line.rates[grade]) / 100);
      console.log(`  ${r.a}↔${r.b}  구간 ${r.miles}마일  (일반석 ${earn('standard')} · 특실 ${earn('first')})`);
    }
  }
  console.log('\n원본 페이지는 자동 접근을 막는다 — 사람이 브라우저로 열어 위 값과 맞춰 본다.');
  console.log('다르면 references/air-mileage.yaml 의 그 줄을 고치고, 맞춰 본 날을 checked 에 적은 뒤 `node tools/refdata.mjs gen`.');
  return 0;
}

const [cmd = 'status', ...args] = process.argv.slice(2);
const commands = {
  status,
  ktx: () => ktx(args),
  mileage,
  gen: () => node('gen-input.mjs') || node('gen-travel.mjs'),
  check: () => Math.max(node('gen-input.mjs', '--check'), node('gen-travel.mjs', '--check')),
};
if (!commands[cmd]) {
  console.error(`모르는 명령: ${cmd}\n쓰는 법: node tools/refdata.mjs [status | ktx [<xls 경로|주소>] [--basis YYYY-MM-DD] [--dry-run] | mileage | gen | check]`);
  process.exit(2);
}
process.exit(await commands[cmd]());
