// 네이티브 다리(native/host.mjs)가 claude CLI 를 띄우고 끝을 맺는 길 — spawnClaude·runClaude.
//
// 2026-10-05 한 번에 80초가 걸린 호출의 까닭을 짚으려고 단계별 시간과 느린 호출의 디버그 기록을 남기게 했고(사용자 지정: "호출이 왜
// 느린지 테스트 해줘"), 그 코드를 Codex(gpt-6-astra)로 검토해 나온 것을 고쳤다: 시간이 다 됐을 때 프로세스가 끝난 뒤에 정리하기,
// 다시 부를 때 앞 차례의 비용 합치기, 같은 초에 겹치지 않는 기록 이름, 답이 JSON 이 아닐 때 디버그 기록 남기기, 한글이 덩어리
// 경계에서 깨지지 않게 이어 읽기, 걸린 시간을 단조 시계로 재기.
//
// 실제 claude 는 부르지 않는다 — CLAUDE_BIN 을 node 로 바꾸고, 시험마다 claude 가 할 법한 출력을 내는 짧은 스크립트를 돌린다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const logs = fs.mkdtempSync(path.join(os.tmpdir(), 'krs-bridge-spawn-'));
process.env.KRS_HOST_NO_MAIN = '1';
process.env.KRS_BRIDGE_LOG_DIR = logs;
process.env.CLAUDE_BIN = process.execPath;
delete process.env.KRS_SLOW_MS;
const { spawnClaude, runClaude, pruneLogs, pruneTempDebug, SLOW_MS } = await import('../native/host.mjs');

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

/** 가짜 claude — node 가 code 를 돌린다. 다리가 뒤에 붙이는 `--debug-file <경로>` 는 스크립트의 인자로 들어온다. */
const fake = (code, over = {}) => ({ args: ['-e', `${PRELUDE}\n${code}`, '--'], stdin: '', env: process.env, limitMs: 10_000, cleanup: () => {}, ...over });
const PRELUDE = `
const debugFile = process.argv[process.argv.indexOf('--debug-file') + 1];
require('fs').writeFileSync(debugFile, '2026-10-05T12:00:00.000Z [DEBUG] [API:timing] first byte after 676ms\\n');
const line = (o, nl = '\\n') => process.stdout.write(JSON.stringify(o) + nl);
const result = (data, over = {}) => ({ type: 'result', subtype: 'success', result: typeof data === 'string' ? data : JSON.stringify(data), total_cost_usd: 0.01, duration_ms: 5, duration_api_ms: 4, num_turns: 1, ...over });
`;
/** 다리가 임시 폴더에 둔 CLI 디버그 임시 파일 가운데 이 프로세스의 것. */
const tempLeft = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(`krs-cli-${process.pid}-`));
const kept = () => fs.readdirSync(logs).filter((f) => f.startsWith('slow-'));
const failure = async (call) => { try { await spawnClaude(call); } catch (e) { return e; } throw new Error('실패해야 하는 호출이 성공했습니다'); };

console.log('claude 를 띄우고 끝을 맺는다');
await ta('출력 줄을 오는 대로 보고 단계별 시간을 돌려준다 — 시동·첫 답·결과, CLI 가 스스로 잰 시간, 줄의 종류별 개수. 빠르고 잘된 호출의 디버그 기록은 지운다', async () => {
  const r = await spawnClaude(fake(`
    line({ type: 'system', subtype: 'init' });
    setTimeout(() => { line({ type: 'assistant' }); line({ type: 'rate_limit_event' }); line(result({ total: 5800 })); }, 60);`));
  assert.deepEqual([r.data, r.costUsd], [{ total: 5800 }, 0.01]);
  const t = r.timing;
  assert.deepEqual([t.apiMs, t.selfMs, t.turns, t.events], [4, 5, 1, { 'system/init': 1, assistant: 1, rate_limit_event: 1, result: 1 }]);
  assert.ok(t.startMs <= t.answerMs && t.answerMs <= t.resultMs && t.resultMs <= t.ms, JSON.stringify(t));
  assert.ok(t.answerMs - t.startMs >= 40, '첫 답은 시동보다 뒤다');
  assert.equal('debug' in t, false, '느리지도 실패하지도 않았다');
  assert.deepEqual([tempLeft(), kept(), SLOW_MS], [[], [], 20_000]);
});
await ta('한글 한 자가 두 덩어리에 걸려 와도 깨지지 않는다', async () => {
  const r = await spawnClaude(fake(`
    const buf = Buffer.from(JSON.stringify(result({ vendor: '파리바게트 킨텍스 원시티점' })) + '\\n');
    const cut = buf.indexOf(Buffer.from('파')) + 1;   // '파' 의 첫 바이트 뒤에서 자른다
    process.stdout.write(buf.subarray(0, cut));
    setTimeout(() => process.stdout.write(buf.subarray(cut)), 120);`));
  assert.equal(r.data.vendor, '파리바게트 킨텍스 원시티점');
});
await ta('마지막 줄이 줄바꿈 없이 끝나도 결과 줄로 센다', async () => {
  const r = await spawnClaude(fake(`line(result({ ok: true }), '');`));
  assert.deepEqual([r.data, r.timing.events, typeof r.timing.resultMs], [{ ok: true }, { result: 1 }, 'number']);
});
await ta('답이 JSON 이 아니면 실패다 — 그 차례에 든 비용과 시간이 남고, 빨리 끝났어도 디버그 기록을 남긴다(이름이 겹치지 않는다)', async () => {
  const a = await failure(fake(`line(result('죄송하지만 읽을 수 없습니다'));`));
  const b = await failure(fake(`line(result('죄송하지만 읽을 수 없습니다'));`));
  assert.equal(a.message, '모델이 JSON 을 돌려주지 않았습니다.');
  assert.deepEqual([a.detail.costUsd, a.hard, typeof a.timing.ms], [0.01, undefined, 'number']);
  assert.match(a.timing.debug, /^slow-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}-\d+-\d+\.txt$/);
  assert.notEqual(a.timing.debug, b.timing.debug, '같은 초에 두 번 실패해도 서로 덮지 않는다');
  assert.match(fs.readFileSync(path.join(logs, a.timing.debug), 'utf8'), /\[API:timing\] first byte/);
  assert.deepEqual([kept().length, tempLeft()], [2, []]);
});
await ta('종료 코드가 0 이 아니면 실패다 — 표준 오류와 시간이 남는다', async () => {
  const e = await failure(fake(`process.stderr.write('한도 초과'); process.exit(3);`));
  assert.deepEqual([e.message, e.detail.exitCode, e.detail.stderr, typeof e.timing.ms, tempLeft()], ['한도 초과', 3, '한도 초과', 'number', []]);
});
await ta('시간이 다 되면 끊고, 프로세스가 끝난 뒤에 한 번만 정리하고 답한다 — 다시 부르지 않을 실패(hard)이고 임시 파일을 남기지 않는다', async () => {
  let cleaned = 0;
  const t0 = Date.now();
  const e = await failure(fake(`line({ type: 'system', subtype: 'init' }); setTimeout(() => {}, 30000);`, { limitMs: 400, cleanup: () => { cleaned++; } }));
  const took = Date.now() - t0;
  assert.deepEqual([e.message, e.hard, cleaned], ['CLI 응답이 0.4초 안에 오지 않았습니다.', true, 1]);
  assert.ok(e.timing.ms >= 400 && took < 3400, `끊은 뒤 오래 기다리지 않는다(${took}ms)`);
  assert.deepEqual([e.timing.events, typeof e.timing.startMs, 'answerMs' in e.timing], [{ 'system/init': 1 }, 'number', false], '어디까지 갔다가 멈췄는지 남는다');
  assert.match(e.timing.debug, /^slow-/);
  assert.deepEqual(tempLeft(), []);
});

console.log('빠른 길이 안 되면 다시 부른다');
const task = { system: '지시문' };
await ta('빠른 길에서 답은 받았는데 못 썼으면(돈은 들었다) 다시 부르고, 두 차례의 비용을 합쳐 돌려준다 — 차례마다의 시간과 비용이 남는다', async () => {
  const calls = [];
  const call = async (c) => {
    calls.push(c.args.includes('stream-json') ? 'direct' : 'tool');
    if (calls.length === 1) throw Object.assign(new Error('모델이 JSON 을 돌려주지 않았습니다.'), { detail: { costUsd: 0.05 }, timing: { ms: 10 } });
    return { data: { ok: true }, costUsd: 0.01, timing: { ms: 5 } };
  };
  const r = await runClaude(task, '내일 회의실', [], { call });
  assert.deepEqual(calls, ['direct', 'tool']);
  assert.equal(Number(r.costUsd.toFixed(4)), 0.06);
  assert.deepEqual(r.cli, [{ path: 'direct', error: '모델이 JSON 을 돌려주지 않았습니다.', ms: 10, costUsd: 0.05 }, { path: 'tool', ms: 5, costUsd: 0.01 }]);
  assert.equal('attach' in r, false, '글 작업에는 증빙을 읽은 길이 없다');
});
await ta('한 번에 됐으면 비용은 그 차례의 것 그대로다 — 글 작업도 빠른 길을 먼저 부른다', async () => {
  const r = await runClaude(task, '내일 회의실', [], { call: async () => ({ data: {}, costUsd: 0.01, timing: { ms: 5 } }) });
  assert.deepEqual([r.costUsd, r.cli], [0.01, [{ path: 'direct', ms: 5 }]]);
});
await ta('둘 다 안 됐으면 든 비용을 합쳐 실패에 적는다 — 시간 초과 같은 실패(hard)는 다시 부르지 않는다', async () => {
  let n = 0;
  const both = await runClaude(task, '글', [], { call: async () => { n++; throw Object.assign(new Error(`실패 ${n}`), { detail: { costUsd: 0.02 }, timing: { ms: n } }); } }).catch((e) => e);
  assert.deepEqual([both.message, both.detail.direct, both.detail.costUsd, both.detail.cli.map((c) => [c.path, c.ms, c.costUsd])], ['실패 2', '실패 1', 0.04, [['direct', 1, 0.02], ['tool', 2, 0.02]]]);
  n = 0;
  const hard = await runClaude(task, '글', [], { call: async () => { n++; throw Object.assign(new Error('CLI 응답이 60초 안에 오지 않았습니다.'), { hard: true, timing: { ms: 60000 } }); } }).catch((e) => e);
  assert.deepEqual([n, hard.detail.cli], [1, [{ path: 'direct', error: 'CLI 응답이 60초 안에 오지 않았습니다.', ms: 60000 }]]);
});

console.log('남은 것 치우기');
await ta('임시 폴더에 남은 CLI 디버그 임시 파일은 한 시간이 지난 것만 치운다 — 다른 파일은 건드리지 않는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krs-bridge-temp-'));
  const now = Date.now();
  for (const [f, age] of [['krs-cli-100-1791200000000-1.txt', 2 * 3600_000], ['krs-cli-100-1791207000000-2.txt', 60_000], ['other.txt', 2 * 3600_000]]) {
    fs.writeFileSync(path.join(dir, f), '');
    fs.utimesSync(path.join(dir, f), new Date(now - age), new Date(now - age));
  }
  pruneTempDebug(dir, now);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['krs-cli-100-1791207000000-2.txt', 'other.txt']);
  fs.rmSync(dir, { recursive: true, force: true });
});
await ta('느린 호출의 디버그 기록은 새 이름(밀리초·프로세스·차례가 붙은 것)도 예전 이름도 보관 기간이 지나면 지운다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krs-bridge-prune-'));
  for (const f of ['slow-2026-09-01-214346-855-1234-1.txt', 'slow-2026-09-01-214346.txt', 'slow-2026-09-16-090000-001-1234-2.txt', 'slow-notes.txt']) fs.writeFileSync(path.join(dir, f), '');
  pruneLogs(dir, new Date(2026, 8, 16, 12));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['slow-2026-09-16-090000-001-1234-2.txt', 'slow-notes.txt']);
  fs.rmSync(dir, { recursive: true, force: true });
});

fs.rmSync(logs, { recursive: true, force: true });
console.log(`\n통과 ${pass}건`);
