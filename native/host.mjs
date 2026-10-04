// 크롬 확장과 로컬 Claude Code CLI 를 잇는 네이티브 메시징 호스트.
//
// 확장은 임의의 명령을 보낼 수 없다. 입력 명세(input.yaml)에 적힌 작업(task)만 실행하고
// 시스템 프롬프트도 그 명세에서 만든 것으로 고정돼 있다. 확장이 보내는 것은 작업 이름과 입력 텍스트뿐이다.
// 호출마다 native/logs/<날짜>.jsonl 에 한 줄씩 남기고, logs 작업으로 최근 것을 돌려준다.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TASKS as SPEC_TASKS, systemPrompt } from '../src/input.js';

const MODEL = 'claude-haiku-4-5';
// 첨부(출장 증빙)를 읽을 때 생각(thinking)에 쓰는 토큰의 상한. CLI 기본값이면 한 장에 25초쯤, 끄면(0) 6초지만 법인카드인지 같은
// 판단을 틀렸다(2026-10-03 같은 영수증으로 세 번씩 잼) — 가장 작은 값을 준다: 15초쯤이고 판단은 기본값과 같았다.
const FILE_THINKING_TOKENS = '1024';
// 메시지에 바로 실을 수 있는 그림 형식과 크기(API 는 그림 하나를 base64 5MB 까지 받는다). 그 밖의 것은 파일로 내려 Read 도구로 읽게 한다.
const DIRECT_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const DIRECT_IMAGE_MAX = 3.5 * 1024 * 1024;

// PATH 에서 찾는다. 다른 곳에 있으면 CLAUDE_BIN 환경변수로 알려주면 된다.
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

// 작업과 지시문은 입력 명세(input.yaml → src/inputspec.js)에서 온다. 확장의 API 길(src/ai.js)과 같은 지시문이고,
// 이 길에는 구조화 출력이 없으므로 JSON 만 내라는 말을 덧붙인다. 돌려준 답은 확장이 같은 명세로 검증한다.
const TASKS = Object.fromEntries(Object.keys(SPEC_TASKS).map((name) =>
  [name, { system: systemPrompt(name, { jsonOnly: true }) }]));

/* ------------------------------------------------------------- 호출 기록 */

// 확장은 파일을 쓸 수 없다. 다리 쪽 사정(종료 코드, stderr, 모델이 돌려준 원문)은
// 여기서 남기지 않으면 어디에도 남지 않는다. 날짜별 JSONL 로 쓰고 오래된 것은 지운다.
const LOG_DIR = process.env.KRS_BRIDGE_LOG_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'logs');
const LOG_KEEP_DAYS = 14;
const LOG_TAIL_MAX = 50;
// 다리 → 크롬 메시지는 1MB 까지다. 기록을 돌려줄 때 넉넉히 그 절반에서 끊는다.
const LOG_TAIL_BYTES = 512 * 1024;
const LOG_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const clip = (s, n) =>
  (typeof s === 'string' && s.length > n ? `${s.slice(0, n)}…(${s.length}자)` : s);

/** 한 줄 남긴다. 실패해도 응답은 보내야 하므로 삼킨다 — stdout 에는 절대 쓰지 않는다(프레임이 깨진다). */
export function writeLog(entry, dir = LOG_DIR) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
    fs.appendFileSync(path.join(dir, `${localDay(new Date())}.jsonl`), `${line}\n`);
  } catch {
    // 기록 실패로 다리가 멈추면 안 된다
  }
}

/** 보관 기간이 지난 날짜 파일을 지운다. */
export function pruneLogs(dir = LOG_DIR, now = new Date()) {
  try {
    const cutoff = localDay(new Date(now.getTime() - LOG_KEEP_DAYS * 86_400_000));
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(LOG_FILE);
      if (m && m[1] < cutoff) fs.unlinkSync(path.join(dir, f));
    }
  } catch {
    // 폴더가 아직 없으면 지울 것도 없다
  }
}

/** 최근 기록 n 건(오래된 것부터). 반쯤 쓰인 줄은 건너뛴다. */
export function tailLogs(n, dir = LOG_DIR) {
  const want = Math.min(Math.max(Number(n) || LOG_TAIL_MAX, 1), LOG_TAIL_MAX);
  const out = [];
  try {
    const files = fs.readdirSync(dir).filter((f) => LOG_FILE.test(f)).sort().reverse();
    for (const f of files) {
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
      for (let i = lines.length - 1; i >= 0 && out.length < want; i--) {
        if (!lines[i].trim()) continue;
        try { out.push(JSON.parse(lines[i])); } catch { /* 건너뛴다 */ }
      }
      if (out.length >= want) break;
    }
  } catch {
    return [];
  }
  out.reverse();
  while (out.length > 1 && Buffer.byteLength(JSON.stringify(out)) > LOG_TAIL_BYTES) out.shift();
  return out;
}

/* ------------------------------------------------- 네이티브 메시징 프레임 */

function send(obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length, 0);
  process.stdout.write(len);
  process.stdout.write(buf);
}

function onMessage(handler) {
  let acc = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    acc = Buffer.concat([acc, chunk]);
    for (;;) {
      if (acc.length < 4) return;
      const size = acc.readUInt32LE(0);
      if (acc.length < 4 + size) return;
      const body = acc.subarray(4, 4 + size);
      acc = acc.subarray(4 + size);
      let msg;
      try {
        msg = JSON.parse(body.toString('utf8'));
      } catch {
        writeLog({ task: '(읽지 못함)', ok: false, error: '요청을 읽지 못했습니다.', bytes: size });
        send({ ok: false, error: '요청을 읽지 못했습니다.' });
        continue;
      }
      handler(msg);
    }
  });
}

/* ------------------------------------------------------------- CLI 호출 */

/** 모델이 ```json 펜스를 붙여 오는 경우가 있어 벗겨낸다. */
function stripFence(text) {
  const t = (text || '').trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return (m ? m[1] : t).trim();
}

/** 기록에 남길 사정을 붙인 오류. 확장에는 message 만 간다. */
const fail = (message, detail) => Object.assign(new Error(message), { detail });

/**
 * 첨부(출장 증빙)를 임시 폴더에 파일로 내려 둔다. CLI 는 파일을 인자로 받지 않으므로 Read 도구로 읽게 하고, 끝나면 폴더째 지운다.
 * @returns {{paths: string[], cleanup: Function}}
 */
function stageFiles(files) {
  if (!files.length) return { paths: [], cleanup: () => {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krs-receipt-'));
  const paths = files.map((f, i) => {
    const ext = (String(f.name || '').match(/\.([a-z0-9]{1,5})$/i) || [])[1] || (f.type === 'application/pdf' ? 'pdf' : 'png');
    const p = path.join(dir, `receipt-${i + 1}.${ext.toLowerCase()}`);
    fs.writeFileSync(p, Buffer.from(String(f.dataUrl || '').split(',')[1] || '', 'base64'));
    return p;
  });
  return { paths, cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 임시 파일이다 */ } } };
}

const base64Of = (f) => String(f.dataUrl || '').split(',')[1] || '';

/** 메시지에 바로 실을 수 있는 첨부인가 — PDF 와 API 가 받는 그림 형식, 그림은 크기 한도 안이어야 한다. */
export const canAttach = (f) => f.type === 'application/pdf' || (DIRECT_IMAGE.has(f.type) && base64Of(f).length * 0.75 <= DIRECT_IMAGE_MAX);

/** 첨부 하나를 메시지의 내용 블록으로 — 그림은 image, PDF 는 document(확장의 API 길 src/ai.js 의 fileBlock 과 같은 모양). */
const attachBlock = (f) => ({ type: f.type === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: f.type, data: base64Of(f) } });

/**
 * claude 를 어떻게 부를지 짓는다(인자·표준 입력·환경). 첨부가 있으면 길이 둘이다.
 *  - direct: 첨부를 메시지에 바로 싣는다(stream-json 입력). 모델이 한 차례만 돌고 생각도 조금만 한다 — 빠른 길이다
 *    (2026-10-03 같은 영수증 한 장: 아래 길 77초 → 이 길 15초쯤).
 *  - 아니면: 첨부를 임시 폴더에 내려 두고 Read 도구로 읽게 한다. 모델이 두 차례 돈다(도구 부르기 + 답) — 전부터 쓰던 길이고,
 *    바로 싣지 못하는 첨부와 direct 가 안 되는 CLI 에서 쓴다.
 * @returns {{args: string[], stdin: string, env: object, limitMs: number, cleanup: Function}}
 */
export function cliCall(task, input, files = [], { direct = false } = {}) {
  // 기본 에이전트 프롬프트를 빼면 캐시 토큰이 38K -> 4K 로 줄고 지시도 잘 따른다
  const common = ['--model', MODEL, '--system-prompt', task.system, '--exclude-dynamic-system-prompt-sections'];
  if (direct) {
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [...files.map(attachBlock), { type: 'text', text: input }] } });
    return {
      args: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', ...common,
        // 그림을 보고 답만 하면 된다 — 사용자 설정(훅·MCP·스킬·플러그인)은 싣지 않고 도구도 주지 않는다.
        // 세션 기록도 남기지 않는다(영수증 그림이 기록 파일에 쌓이지 않게).
        '--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--tools', ''],
      stdin: `${line}\n`, env: { ...process.env, MAX_THINKING_TOKENS: FILE_THINKING_TOKENS }, limitMs: 120_000, cleanup: () => {},
    };
  }
  const { paths, cleanup } = stageFiles(files);
  const prompt = paths.length ? `${input}\n\n첨부 파일(Read 도구로 열어서 보세요):\n${paths.map((p) => `- ${p}`).join('\n')}` : input;
  return {
    args: [
      '-p', prompt,
      '--output-format', 'json',
      ...common,
      // 첨부가 있을 때만 Read 를 열어 준다 — 그 파일을 보라는 뜻이다. 나머지 도구는 늘 막는다.
      '--disallowedTools', 'Bash', ...(paths.length ? [] : ['Read']), 'Write', 'Edit', 'Glob', 'Grep',
      'WebFetch', 'WebSearch', 'Task',
      ...(paths.length ? ['--allowedTools', 'Read'] : []),
    ],
    stdin: '', env: process.env, limitMs: paths.length ? 120_000 : 60_000, cleanup,
  };
}

/** CLI 의 출력에서 결과를 꺼낸다 — json 출력은 객체 하나, stream-json 출력은 줄마다 객체이고 마지막 result 줄이 결과다. */
export function envelopeOf(out) {
  try {
    return JSON.parse(out);
  } catch { /* 줄마다 JSON 인 출력이다 */ }
  for (const line of String(out).split('\n').reverse()) {
    try {
      const o = JSON.parse(line);
      if (o?.type === 'result') return o;
    } catch { /* 결과 줄이 아니다 */ }
  }
  return null;
}

/**
 * 첨부가 모두 바로 실을 수 있는 것이면 빠른 길(direct)로 부르고, 그 길이 안 되면 전처럼 Read 도구로 읽게 해 다시 부른다.
 * 시간 초과와 실행 실패(hard)는 다시 해도 같으므로 되풀이하지 않는다. attach 는 어느 길로 읽었는지다(기록에 남긴다).
 */
async function runClaude(task, input, files = []) {
  let first = null;
  if (files.length && files.every(canAttach)) {
    try {
      return { ...(await spawnClaude(cliCall(task, input, files, { direct: true }))), attach: 'direct' };
    } catch (e) {
      if (e.hard) throw e;
      first = e;
    }
  }
  try {
    return { ...(await spawnClaude(cliCall(task, input, files))), ...(files.length ? { attach: 'read' } : {}) };
  } catch (e) {
    if (first) e.detail = { ...e.detail, direct: first.message };
    throw e;
  }
}

function spawnClaude({ args, stdin, env, limitMs, cleanup }) {
  return new Promise((resolve, reject) => {
    // shell 을 쓰면 Windows 에서 인자가 이어붙기만 해서 공백 섞인 프롬프트가 깨진다.
    // claude 는 실제 실행 파일이므로 셸 없이 직접 띄운다.
    const child = spawn(CLAUDE_BIN, args, { shell: false, windowsHide: true, env });

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      cleanup();
      reject(Object.assign(new Error(`CLI 응답이 ${limitMs / 1000}초 안에 오지 않았습니다.`), { hard: true }));
    }, limitMs);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      cleanup();
      reject(Object.assign(fail(`claude 실행 실패: ${e.message}`, { bin: CLAUDE_BIN, code: e.code }), { hard: true }));
    });
    // 표준 입력은 곧바로 닫는다 — 프롬프트를 인자로 준 길은 더 들어올 글이 없고, 첨부를 싣는 길은 메시지 한 줄을 쓰고 닫는다.
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
    child.on('close', (code) => {
      clearTimeout(timer);
      cleanup();
      if (code !== 0) {
        return reject(fail(err.trim().slice(0, 300) || `claude 종료 코드 ${code}`,
          { exitCode: code, stderr: clip(err.trim(), 2000), stdout: clip(out.trim(), 1000) }));
      }

      const env = envelopeOf(out);
      if (!env) {
        return reject(fail('CLI 출력을 해석하지 못했습니다.', { stdout: clip(out.trim(), 2000) }));
      }
      if (env.is_error) {
        return reject(fail(env.result || 'CLI 오류', { subtype: env.subtype, costUsd: env.total_cost_usd }));
      }

      try {
        resolve({ data: JSON.parse(stripFence(env.result)), costUsd: env.total_cost_usd });
      } catch {
        reject(fail('모델이 JSON 을 돌려주지 않았습니다.',
          { raw: clip(env.result, 2000), costUsd: env.total_cost_usd }));
      }
    });
  });
}

/* ------------------------------------------------------------ 요청 처리 */

/**
 * 요청 하나를 처리해 돌려줄 응답을 만든다. claude 를 부른 것은 성패와 상관없이 기록한다.
 * ping 과 logs 는 부를 때마다 남기면 기록이 그것으로 찬다 — 남기지 않는다.
 *
 * @param {object} msg
 * @param {{ run?: Function, log?: Function, tail?: Function }} [deps] 테스트가 갈아 끼운다
 */
export async function handle(msg, { run = runClaude, log = writeLog, tail = tailLogs } = {}) {
  if (msg?.task === 'ping') return { ok: true, pong: true };
  if (msg?.task === 'logs') return { ok: true, entries: tail(msg.limit) };

  // 명세에 적힌 이름만 받는다('constructor' 같은 이름이 객체의 내장 속성에 걸리지 않게).
  const task = typeof msg?.task === 'string' && Object.hasOwn(TASKS, msg.task) ? TASKS[msg.task] : null;
  if (!task) {
    const error = `알 수 없는 작업: ${msg?.task}`;
    log({ task: String(msg?.task), ok: false, error });
    return { ok: false, error };
  }

  const input = typeof msg.input === 'string' ? msg.input : '';
  if (!input.trim()) {
    log({ task: msg.task, ok: false, error: '입력이 비어 있습니다.' });
    return { ok: false, error: '입력이 비어 있습니다.' };
  }

  // 첨부(출장 증빙). 모양이 맞는 것만, 여섯 장까지. 기록에는 이름과 크기만 남긴다 — 영수증 그림을 기록 파일에 쌓지 않는다.
  const files = (Array.isArray(msg.files) ? msg.files : [])
    .filter((f) => f && typeof f.dataUrl === 'string' && /^data:[^;]+;base64,/.test(f.dataUrl)).slice(0, 6)
    .map((f) => ({ name: String(f.name || 'file'), type: String(f.type || ''), dataUrl: f.dataUrl }));
  const started = Date.now();
  const base = { task: msg.task, model: MODEL, input: clip(input, 1500),
    ...(files.length ? { files: files.map((f) => `${f.name} (${f.type}, ${Math.round((f.dataUrl.length * 3) / 4 / 1024)}KB)`) } : {}) };
  try {
    const { data, costUsd, attach } = await run(task, input.slice(0, 20000), files);
    log({ ...base, ok: true, ms: Date.now() - started, costUsd, ...(attach ? { attach } : {}), data });
    return { ok: true, data, costUsd };
  } catch (e) {
    log({ ...base, ok: false, ms: Date.now() - started, error: e.message, ...e.detail });
    return { ok: false, error: e.message };
  }
}

/* ---------------------------------------------------------------- 진입 */

// 테스트는 handle 만 가져다 쓴다. 크롬이 띄울 때는 이 변수가 없으므로 늘 아래가 돈다.
if (process.env.KRS_HOST_NO_MAIN !== '1') {
  pruneLogs();
  onMessage(async (msg) => {
    // 기록을 먼저 쓰고 응답한다. 응답을 받은 크롬은 곧바로 이 프로세스를 끊을 수 있다.
    send(await handle(msg));
  });
}
