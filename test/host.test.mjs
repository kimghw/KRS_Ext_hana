// 네이티브 다리(native/host.mjs)의 호출 기록.
//
// 앞부분은 handle() 에 가짜 claude 를 끼워 기록 내용을 본다. 뒷부분은 크롬이 하듯 다리를
// 실제 프로세스로 띄워, 파일에 한 줄이 남고 logs 작업으로 그 줄을 돌려받는지 본다.
// 실제 claude 는 부르지 않는다 — CLAUDE_BIN 을 node 로 바꿔 끼우면 낯선 플래그에 곧바로 죽는다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.KRS_HOST_NO_MAIN = '1';
const { handle, writeLog, tailLogs, pruneLogs, cliCall, canAttach, envelopeOf } = await import('../native/host.mjs');

const HOST = fileURLToPath(new URL('../native/host.mjs', import.meta.url));

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'krs-bridge-log-'));
const pad = (n) => String(n).padStart(2, '0');
const dayName = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.jsonl`;

console.log('첨부 파일(출장 증빙)은 run 에 넘기고 기록에는 이름·크기만 남긴다');
{
  const logged = [];
  const seen = [];
  const files = [{ name: 'r.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }, { bad: true }, { name: 'x.txt', type: 'text/plain', dataUrl: 'not-a-data-url' }];
  const res = await handle({ task: 'receipt', input: '출장 정보', files }, {
    log: (e) => logged.push(e), run: async (_t, _i, f) => { seen.push(f); return { data: { docType: 'unknown', summary: 's' }, costUsd: 0 }; },
  });
  await ta('모양이 맞는 파일(data URL)만 넘어간다', async () => {
    assert.equal(res.ok, true);
    assert.deepEqual(seen[0], [{ name: 'r.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }]);
  });
  await ta('기록에는 파일 이름과 크기만 — 그림 자체는 남기지 않는다', async () => {
    assert.deepEqual(logged.at(-1).files, ['r.png (image/png, 0KB)']);
    assert.ok(!JSON.stringify(logged.at(-1)).includes('AAAA'));
  });
  const plain = await handle({ task: 'parse', input: '내일' }, { log: (e) => logged.push(e), run: async (_t, _i, f) => { seen.push(f); return { data: {} }; } });
  await ta('첨부가 없으면 빈 목록이 가고 기록에 files 가 없다', async () => {
    assert.equal(plain.ok, true);
    assert.deepEqual(seen.at(-1), []);
    assert.equal('files' in logged.at(-1), false);
  });
}

console.log('첨부를 읽히는 두 길 — 메시지에 바로 싣기(빠른 길)와 Read 도구로 읽히기');
{
  const task = { system: '지시문' };
  const png = { name: '영수증.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' };
  const pdf = { name: '항공권.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERg==' };
  await ta('바로 싣는 길: 그림은 image, PDF 는 document 블록으로 표준 입력 한 줄에 실리고, 파일 경로도 도구도 없다', async () => {
    const call = cliCall(task, '출장 정보', [png, pdf], { direct: true });
    assert.deepEqual(JSON.parse(call.stdin), { type: 'user', message: { role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERg==' } },
      { type: 'text', text: '출장 정보' },
    ] } });
    assert.ok(call.stdin.endsWith('\n'));
    const flag = (name) => call.args[call.args.indexOf(name) + 1];
    assert.deepEqual([flag('--input-format'), flag('--output-format'), flag('--system-prompt'), flag('--tools')], ['stream-json', 'stream-json', '지시문', '']);
    assert.ok(['--safe-mode', '--strict-mcp-config', '--no-session-persistence'].every((f) => call.args.includes(f)), '사용자 설정을 싣지 않고 세션 기록도 남기지 않는다');
    assert.ok(!call.args.some((a) => /Read 도구|AAAA/.test(a)), '그림은 인자가 아니라 표준 입력으로 간다');
    assert.equal(call.env.MAX_THINKING_TOKENS, '1024', '생각은 조금만 한다');
    call.cleanup();
  });
  await ta('Read 로 읽히는 길: 파일을 임시 폴더에 내려 그 경로를 프롬프트에 적고 Read 만 열어 준다 — 끝나면 지운다', async () => {
    const call = cliCall(task, '출장 정보', [png]);
    const prompt = call.args[call.args.indexOf('-p') + 1];
    const file = prompt.match(/^- (.+receipt-1\.png)$/m)?.[1];
    assert.match(prompt, /^출장 정보\n\n첨부 파일\(Read 도구로 열어서 보세요\):/);
    assert.ok(file && fs.existsSync(file));
    assert.deepEqual([call.args[call.args.indexOf('--allowedTools') + 1], call.stdin, call.limitMs, call.env.MAX_THINKING_TOKENS], ['Read', '', 120_000, process.env.MAX_THINKING_TOKENS]);
    call.cleanup();
    assert.equal(fs.existsSync(file), false);
  });
  await ta('첨부가 없으면 전과 같은 인자다 — 프롬프트는 인자로 가고 Read 도 막는다', async () => {
    const call = cliCall(task, '내일 오후 회의실');
    assert.deepEqual(call.args.slice(0, 4), ['-p', '내일 오후 회의실', '--output-format', 'json']);
    assert.ok(call.args.includes('Read') && !call.args.includes('--allowedTools'));
    assert.deepEqual([call.stdin, call.limitMs], ['', 60_000]);
  });
  await ta('바로 실을 수 있는 것은 PDF 와 API 가 받는 그림 형식뿐이다 — 낯선 형식과 너무 큰 그림은 Read 로 읽힌다', async () => {
    const big = { name: '큰사진.jpg', type: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${'A'.repeat(5 * 1024 * 1024)}` };
    assert.deepEqual([png, pdf, { ...png, type: 'image/bmp' }, { ...png, type: '' }, big].map(canAttach), [true, true, false, false, false]);
  });
  await ta('출력에서 결과를 꺼낸다 — json 은 객체 하나, stream-json 은 마지막 result 줄', async () => {
    assert.deepEqual(envelopeOf('{"type":"result","result":"{}","is_error":false}'), { type: 'result', result: '{}', is_error: false });
    const stream = ['{"type":"system","subtype":"init"}', '{"type":"assistant","message":{}}', '{"type":"result","result":"{\\"a\\":1}","total_cost_usd":0.01}', ''].join('\n');
    assert.deepEqual(envelopeOf(stream), { type: 'result', result: '{"a":1}', total_cost_usd: 0.01 });
    assert.equal(envelopeOf('bad option: --x'), null);
  });
  const logged = [];
  await handle({ task: 'receipt', input: '출장 정보', files: [png] }, { log: (e) => logged.push(e), run: async () => ({ data: { docType: 'unknown' }, costUsd: 0, attach: 'direct' }) });
  await ta('어느 길로 읽었는지 기록에 남는다', async () => assert.equal(logged.at(-1).attach, 'direct'));
}

console.log('무엇을 남기나 (가짜 claude)');
{
  const logged = [];
  const log = (e) => logged.push(e);

  const okRes = await handle({ task: 'parse', input: '내일 오후 회의실' }, {
    log, run: async () => ({ data: { summary: '내일 14시' }, costUsd: 0.012 }),
  });
  await ta('성공 응답은 전과 같다', async () =>
    assert.deepEqual(okRes, { ok: true, data: { summary: '내일 14시' }, costUsd: 0.012 }));
  await ta('성공도 남긴다 — 작업·입력·결과·비용·걸린 시간', async () => {
    const e = logged.at(-1);
    assert.equal(e.task, 'parse');
    assert.equal(e.ok, true);
    assert.equal(e.input, '내일 오후 회의실');
    assert.deepEqual(e.data, { summary: '내일 14시' });
    assert.equal(e.costUsd, 0.012);
    assert.equal(typeof e.ms, 'number');
    assert.ok(e.model);
  });

  const boom = Object.assign(new Error('claude 종료 코드 1'), { detail: { exitCode: 1, stderr: 'not logged in' } });
  const failRes = await handle({ task: 'diagnose', input: '{}' }, { log, run: async () => { throw boom; } });
  await ta('실패 응답에는 message 만 간다', async () =>
    assert.deepEqual(failRes, { ok: false, error: 'claude 종료 코드 1' }));
  await ta('실패 기록에는 종료 코드와 stderr 까지', async () => {
    const e = logged.at(-1);
    assert.equal(e.ok, false);
    assert.equal(e.exitCode, 1);
    assert.equal(e.stderr, 'not logged in');
  });

  await handle({ task: 'parse', input: 'x'.repeat(5000) }, { log, run: async () => ({ data: {} }) });
  await ta('긴 입력은 잘라서 남긴다', async () => {
    const e = logged.at(-1);
    assert.ok(e.input.length < 1600);
    assert.match(e.input, /…\(5000자\)$/);
  });

  const before = logged.length;
  await ta('ping 은 남기지 않는다', async () => {
    assert.deepEqual(await handle({ task: 'ping' }, { log }), { ok: true, pong: true });
    assert.equal(logged.length, before);
  });
  await ta('logs 도 남기지 않고 tail 결과를 돌려준다', async () => {
    const r = await handle({ task: 'logs', limit: 7 }, { log, tail: (n) => [{ n }] });
    assert.deepEqual(r, { ok: true, entries: [{ n: 7 }] });
    assert.equal(logged.length, before);
  });
  await ta('모르는 작업은 남긴다', async () => {
    const r = await handle({ task: 'rm -rf' }, { log });
    assert.equal(r.ok, false);
    assert.equal(logged.at(-1).task, 'rm -rf');
  });
  await ta('객체의 내장 속성 이름은 작업이 아니다', async () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      const r = await handle({ task: name, input: 'x' }, { log, run: async () => assert.fail('부르면 안 됨') });
      assert.equal(r.ok, false, name);
    }
  });
  await ta('근태 채우기(attend)는 정해 둔 작업이다 — 고정된 지시문으로 claude 를 부른다', async () => {
    let seen = null;
    const r = await handle({ task: 'attend', input: '오늘은 2026-10-02 (금요일) 입니다.\n새 요청: 내일 외근' }, {
      log, run: async (task, input) => { seen = { task, input }; return { data: { kind: 'out', reply: '외근' }, costUsd: 0.001 }; },
    });
    assert.deepEqual(r, { ok: true, data: { kind: 'out', reply: '외근' }, costUsd: 0.001 });
    assert.match(seen.task.system, /장소와 목적을 지어내지 않습니다/);
    assert.match(seen.task.system, /부서소통회/);
    assert.equal(logged.at(-1).task, 'attend');
  });
  await ta('지시문은 입력 명세(input.yaml)에서 만든 것이다 — API 길과 같은 글에 "JSON 만" 이 붙는다', async () => {
    const { systemPrompt, TASKS } = await import('../src/input.js');
    for (const name of Object.keys(TASKS)) {
      let seen = null;
      await handle({ task: name, input: 'x' }, { log, run: async (task) => { seen = task; return { data: {} }; } });
      assert.equal(seen.system, systemPrompt(name, { jsonOnly: true }), name);
      assert.ok(seen.system.startsWith(systemPrompt(name)), `${name}: API 지시문에 덧붙인 것이어야 한다`);
      assert.match(seen.system, /JSON 객체 하나만 출력합니다/);
    }
  });
  await ta('빈 입력도 남긴다', async () => {
    const r = await handle({ task: 'parse', input: '  ' }, { log, run: async () => assert.fail('부르면 안 됨') });
    assert.equal(r.ok, false);
    assert.equal(logged.at(-1).error, '입력이 비어 있습니다.');
  });
}

console.log('파일');
{
  const dir = path.join(tmp, 'unit');
  writeLog({ task: 'parse', ok: true, n: 1 }, dir);
  writeLog({ task: 'parse', ok: false, n: 2 }, dir);
  const file = path.join(dir, dayName(new Date()));

  await ta('오늘 날짜 파일에 한 줄씩 붙인다', async () => {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]).n, 2);
    assert.ok(JSON.parse(lines[0]).at);
  });

  fs.writeFileSync(path.join(dir, '2026-01-01.jsonl'), `${JSON.stringify({ n: 0 })}\n`);
  fs.appendFileSync(file, '{"n": 3, "반쯤');
  await ta('최근 것부터 모아 오래된 순으로 돌려준다 (날짜 파일을 넘나든다)', async () =>
    assert.deepEqual(tailLogs(3, dir).map((e) => e.n), [0, 1, 2]));
  await ta('반쯤 쓰인 줄은 건너뛴다', async () => assert.equal(tailLogs(50, dir).length, 3));
  await ta('한 번에 50건까지만', async () => {
    const many = path.join(tmp, 'many');
    for (let i = 0; i < 80; i++) writeLog({ n: i }, many);
    const got = tailLogs(999, many);
    assert.equal(got.length, 50);
    assert.equal(got.at(-1).n, 79);
  });
  await ta('1MB 한도 안으로 줄인다', async () => {
    const fat = path.join(tmp, 'fat');
    for (let i = 0; i < 50; i++) writeLog({ n: i, pad: '가'.repeat(20000) }, fat);
    const got = tailLogs(50, fat);
    assert.ok(Buffer.byteLength(JSON.stringify(got)) <= 512 * 1024);
    assert.equal(got.at(-1).n, 49);
  });
  await ta('폴더가 없으면 빈 목록', async () => assert.deepEqual(tailLogs(5, path.join(tmp, 'none')), []));
  await ta('기록을 못 써도 예외를 내지 않는다', async () => {
    const blocker = path.join(tmp, 'blocker');
    fs.writeFileSync(blocker, '');      // 파일 아래에 폴더를 만들 수 없다
    writeLog({ n: 1 }, path.join(blocker, 'logs'));
  });

  await ta('보관 기간(14일)이 지난 파일만 지운다', async () => {
    const now = new Date(2026, 8, 16, 12);
    const keep = path.join(tmp, 'prune');
    fs.mkdirSync(keep);
    for (const f of ['2026-08-01.jsonl', '2026-09-01.jsonl', '2026-09-02.jsonl', '2026-09-16.jsonl', 'notes.txt']) {
      fs.writeFileSync(path.join(keep, f), '');
    }
    pruneLogs(keep, now);
    assert.deepEqual(fs.readdirSync(keep).sort(), ['2026-09-02.jsonl', '2026-09-16.jsonl', 'notes.txt']);
  });
}

console.log('실제 프로세스로 (크롬이 띄우는 것처럼)');
{
  const dir = path.join(tmp, 'e2e');

  /** 다리를 띄워 메시지 하나를 보내고 응답 하나를 받는다. */
  function roundTrip(msg) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, KRS_BRIDGE_LOG_DIR: dir, CLAUDE_BIN: process.execPath };
      delete env.KRS_HOST_NO_MAIN;
      const child = spawn(process.execPath, [HOST], { env, windowsHide: true });
      const timer = setTimeout(() => { child.kill(); reject(new Error('다리가 20초 안에 답하지 않았습니다')); }, 20_000);
      let acc = Buffer.alloc(0);
      child.stdout.on('data', (d) => {
        acc = Buffer.concat([acc, d]);
        if (acc.length < 4 || acc.length < 4 + acc.readUInt32LE(0)) return;
        clearTimeout(timer);
        const size = acc.readUInt32LE(0);
        assert.equal(acc.length, 4 + size, 'stdout 에 응답 말고 다른 것이 섞였다');
        child.kill();
        resolve(JSON.parse(acc.subarray(4, 4 + size).toString('utf8')));
      });
      child.on('error', reject);
      const body = Buffer.from(JSON.stringify(msg), 'utf8');
      const len = Buffer.alloc(4);
      len.writeUInt32LE(body.length, 0);
      child.stdin.write(Buffer.concat([len, body]));
    });
  }

  const res = await roundTrip({ task: 'parse', input: '내일 회의실' });
  await ta('claude 가 실패하면 실패로 답한다', async () => {
    assert.equal(res.ok, false);
    assert.ok(res.error);
  });
  await ta('그 실패가 파일에 남는다 (종료 코드·stderr 포함)', async () => {
    const line = JSON.parse(fs.readFileSync(path.join(dir, dayName(new Date())), 'utf8').trim().split('\n').at(-1));
    assert.equal(line.task, 'parse');
    assert.equal(line.ok, false);
    assert.notEqual(line.exitCode, 0);
    assert.match(line.stderr, /bad option/);
    assert.equal(line.input, '내일 회의실');
  });

  const logs = await roundTrip({ task: 'logs', limit: 10 });
  await ta('logs 작업이 방금 그 기록을 돌려준다', async () => {
    assert.equal(logs.ok, true);
    assert.equal(logs.entries.at(-1).input, '내일 회의실');
  });

  const ping = await roundTrip({ task: 'ping' });
  await ta('ping 은 그대로 되고 기록은 늘지 않는다', async () => {
    assert.deepEqual(ping, { ok: true, pong: true });
    assert.equal(fs.readFileSync(path.join(dir, dayName(new Date())), 'utf8').trim().split('\n').length, 1);
  });
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n통과 ${pass}건`);
