// 크롬 확장과 로컬 Claude Code CLI 를 잇는 네이티브 메시징 호스트.
//
// 확장은 임의의 명령을 보낼 수 없다. 입력 명세(input.yaml)에 적힌 작업(task)만 실행하고
// 시스템 프롬프트도 그 명세에서 만든 것으로 고정돼 있다. 확장이 보내는 것은 작업 이름과 입력 텍스트뿐이다.
// 첨부가 붙는 문서 읽기(receipt 의 출장 증빙, gongmun 의 견적서·교육 안내문·웹페이지 캡처)는 claude 에 넘기기 전에 글자를 먼저 뽑는다 —
// PDF 는 글자 층, 그림은 OCR(native/doctext.mjs).
// 호출마다 native/logs/<날짜>.jsonl 에 한 줄씩 남기고, logs 작업으로 최근 것을 돌려준다.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TASKS as SPEC_TASKS, systemPrompt } from '../src/input.js';
import { gitStatus, gitPull } from './gitsync.mjs';

// 2026-10-05 사용자 지정: "모두 opus 5.5로 변경해줘" — 그 전에는 빨리 답하는 claude-haiku-4-5 였다(2026-10-03).
const MODEL = 'claude-opus-5-5';
// 생각의 깊이(effort). Opus 5.5 는 생각을 끌 수 없고 생각 토큰의 상한(MAX_THINKING_TOKENS — haiku 때는 1024 를 줬다)도 받지 않는다
// — 깊이는 이것으로만 정한다. 값을 읽어 칸을 채우는 일이라 가장 낮은 단계로 둔다(빠르고, 판단은 모델이 필요한 만큼 생각한다).
// 확장의 API 길(src/ai.js 의 EFFORT)과 같은 값이다.
const EFFORT = 'low';
// 메시지에 바로 실을 수 있는 그림 형식과 크기(API 는 그림 하나를 base64 5MB 까지 받는다). 그 밖의 것은 파일로 내려 Read 도구로 읽게 한다.
const DIRECT_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const DIRECT_IMAGE_MAX = 3.5 * 1024 * 1024;

// PATH 에서 찾는다. 다른 곳에 있으면 CLAUDE_BIN 환경변수로 알려주면 된다.
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
// claude 를 띄울 때의 환경. CLI 는 시동할 때와 끝낼 때 꼭 필요하지 않은 통신(사용 통계 보내기·업데이트 확인 등)을 하고, 다리는 그
// 프로세스가 끝나기를 기다린다 — 2026-10-05 에 잰 것: 그것을 끄면 한 번에 3.2초 → 2.0초(시동 0.9 → 0.5초, 끝내기 0.8 → 0초)이고,
// 그 통신이 막히거나 늦을 때 호출이 통째로 기다리는 일도 없어진다. 다리가 띄우는 이 한 번짜리 호출에만 건다(사용자의 CLI 설정은 그대로다).
const cliEnv = () => ({ ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });

// 작업과 지시문은 입력 명세(input.yaml → src/inputspec.js)와 공문 레시피(gongmun.<갈래> → src/gmrecipe.js)에서 온다. 확장의 API 길(src/ai.js)과 같은 지시문이고,
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
// 느린 호출의 까닭을 짚으려고 남기는 claude CLI 의 디버그 기록(2026-10-05 사용자 지정: "호출이 왜 느린지 테스트 해줘").
// CLI 는 부를 때마다 디버그 기록(--debug-file)을 임시 파일에 쓰고, 다리는 **느렸거나 실패한 호출의 것만** 기록 폴더로 옮겨 둔다
// (slow-날짜-시각.txt, 호출 기록의 cli[].debug 에 그 이름이 적힌다). 거기에는 CLI 가 시동·API 요청·첫 응답·재시도·끝내기에
// 쓴 시각이 줄마다 적혀 있다 — 프롬프트의 글이나 토큰은 들어 있지 않다(2026-10-05 실제 기록으로 확인). 날짜별 기록과 같이 지운다.
const SLOW_FILE = /^slow-(\d{4}-\d{2}-\d{2})-\d{6}(?:-[\w-]+)?\.txt$/;
// CLI 가 디버그 기록을 쓰는 임시 파일(임시 폴더). 평소에는 호출이 끝날 때 지운다 — 크롬이 다리를 먼저 끊어 못 지운 것은 다음에 뜰 때 치운다.
const TEMP_DEBUG = /^krs-cli-\d+-\d+-\d+\.txt$/;
const TEMP_DEBUG_KEEP_MS = 60 * 60_000;
// 시간이 다 돼 CLI 를 끊은 뒤, 그 프로세스가 끝나기(디버그 기록이 닫히기)를 이만큼만 더 기다린다.
const KILL_GRACE_MS = 3000;
let spawnSeq = 0;
// 몇 초부터 느린 호출로 보는가. 평소 한 번에 6~8초다 — KRS_SLOW_MS 환경변수로 바꿀 수 있다(0 이면 모든 호출의 디버그 기록을 남긴다).
export const SLOW_MS = process.env.KRS_SLOW_MS != null && process.env.KRS_SLOW_MS !== '' && Number.isFinite(Number(process.env.KRS_SLOW_MS))
  ? Number(process.env.KRS_SLOW_MS) : 20_000;
const SLOW_KEEP_CHARS = 200_000;

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
      const m = f.match(LOG_FILE) || f.match(SLOW_FILE);
      if (m && m[1] < cutoff) fs.unlinkSync(path.join(dir, f));
    }
  } catch {
    // 폴더가 아직 없으면 지울 것도 없다
  }
}

/** 임시 폴더에 남은 CLI 디버그 임시 파일 가운데 오래된 것을 치운다(다리가 답한 뒤 곧 끊겨 못 지운 것). */
export function pruneTempDebug(dir = os.tmpdir(), now = Date.now()) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!TEMP_DEBUG.test(f)) continue;
      const p = path.join(dir, f);
      try {
        if (now - fs.statSync(p).mtimeMs > TEMP_DEBUG_KEEP_MS) fs.unlinkSync(p);
      } catch { /* 아직 잡혀 있거나 그 사이 없어졌다 */ }
    }
  } catch { /* 임시 폴더를 못 읽으면 치울 것도 없다 */ }
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

// 표준 출력은 크롬과 말하는 길이다 — 프레임 말고는 한 글자도 섞이면 안 된다(섞이면 크롬이 응답을 읽지 못한다).
let writeFrame = (buf) => process.stdout.write(buf);

/**
 * 표준 출력에 쓰이는 것을 모두 표준 오류로 돌리고, 본래의 쓰는 길을 돌려준다 — 프레임만 그 길로 쓴다.
 * 증빙에서 글자를 뽑는 꾸러미가 console.log 로 찍는 것(pdf.js 의 경고, OCR 엔진의 말)이 프레임에 섞이지 않게 한다.
 */
export function guardStdout(out = process.stdout, err = process.stderr) {
  const raw = out.write.bind(out);
  out.write = (chunk, ...rest) => err.write(chunk, ...rest);
  return raw;
}

function send(obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length, 0);
  writeFrame(len);
  writeFrame(buf);
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
 *    (2026-10-03 같은 영수증 한 장: 아래 길 77초 → 이 길 15초쯤). 글자만 뽑아 보내는 증빙(첨부 없음)도 이 길로 간다.
 *  - 아니면: 첨부를 임시 폴더에 내려 두고 Read 도구로 읽게 한다. 모델이 두 차례 돈다(도구 부르기 + 답) — 전부터 쓰던 길이고,
 *    바로 싣지 못하는 첨부와 direct 가 안 되는 CLI 에서 쓴다.
 * @returns {{args: string[], stdin: string, env: object, limitMs: number, cleanup: Function}}
 */
export function cliCall(task, input, files = [], { direct = false } = {}) {
  // 기본 에이전트 프롬프트를 빼면 캐시 토큰이 38K -> 4K 로 줄고 지시도 잘 따른다
  const common = ['--model', MODEL, '--effort', EFFORT, '--system-prompt', task.system, '--exclude-dynamic-system-prompt-sections'];
  if (direct) {
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [...files.map(attachBlock), { type: 'text', text: input }] } });
    return {
      args: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', ...common,
        // 그림을 보고 답만 하면 된다 — 사용자 설정(훅·MCP·스킬·플러그인)은 싣지 않고 도구도 주지 않는다.
        // 세션 기록도 남기지 않는다(영수증 그림이 기록 파일에 쌓이지 않게).
        '--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--tools', ''],
      stdin: `${line}\n`, env: cliEnv(), limitMs: files.length ? 120_000 : 60_000, cleanup: () => {},
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
    stdin: '', env: cliEnv(), limitMs: paths.length ? 120_000 : 60_000, cleanup,
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
 * 첨부가 모두 바로 실을 수 있는 것이면(첨부가 없는 글 작업도) 빠른 길(direct)로 부르고, 그 길이 안 되면 전처럼 다시 부른다
 * (첨부는 Read 도구로 읽게 한다). 시간 초과와 실행 실패(hard)는 다시 해도 같으므로 되풀이하지 않는다.
 * attach 는 증빙을 어느 길로 읽었는지다(기록에 남긴다). lean 은 증빙에서 글자만 뽑아 첨부 없이 보내는 것이다(native/doctext.mjs) — attach 는 'text' 다.
 * 글 작업(말로 찾기·근태 채우기·원인 설명)도 빠른 길로 간다(2026-10-05 에 잰 것: 사용자 설정을 다 싣는 길 6초대 → 빠른 길 3초 안팎 —
 * 그 길은 사용자의 MCP 서버·훅을 띄우느라 시동이 길고, 그것들이 늦으면 같이 기다린다).
 */
export async function runClaude(task, input, files = [], { lean = false, call = spawnClaude } = {}) {
  let first = null;
  // cli 는 claude 를 부른 차례마다의 시간이다(기록에 남긴다 — 느린 호출이 어디서 걸렸는지 본다). 빠른 길이 안 돼 다시 부르면 둘이다.
  const cli = [];
  if (files.every(canAttach)) {
    try {
      const { timing, ...r } = await call(cliCall(task, input, files, { direct: true }));
      return { ...r, ...(files.length ? { attach: 'direct' } : lean ? { attach: 'text' } : {}), cli: [{ path: 'direct', ...timing }] };
    } catch (e) {
      // 답은 받았는데 못 쓴 차례(JSON 이 아니다 등)에도 돈은 들었다 — 차례에 적어 두고 끝에 합친다.
      cli.push({ path: 'direct', error: clip(e.message, 200), ...e.timing, ...(e.detail?.costUsd != null ? { costUsd: e.detail.costUsd } : {}) });
      if (e.hard) {
        e.detail = { ...e.detail, cli };
        throw e;
      }
      first = e;
    }
  }
  try {
    const { timing, ...r } = await call(cliCall(task, input, files));
    const spent = cli.reduce((a, c) => a + (c.costUsd || 0), 0);
    return { ...r, ...(spent ? { costUsd: (r.costUsd || 0) + spent } : {}), ...(files.length ? { attach: 'read' } : lean ? { attach: 'text' } : {}),
      cli: [...cli, { path: 'tool', ...timing, ...(spent ? { costUsd: r.costUsd } : {}) }] };
  } catch (e) {
    cli.push({ path: 'tool', error: clip(e.message, 200), ...e.timing, ...(e.detail?.costUsd != null ? { costUsd: e.detail.costUsd } : {}) });
    const spent = cli.reduce((a, c) => a + (c.costUsd || 0), 0);
    e.detail = { ...e.detail, ...(first ? { direct: first.message } : {}), ...(spent ? { costUsd: spent } : {}), cli };
    throw e;
  }
}

export function spawnClaude({ args, stdin, env, limitMs, cleanup }) {
  return new Promise((resolve, reject) => {
    // shell 을 쓰면 Windows 에서 인자가 이어붙기만 해서 공백 섞인 프롬프트가 깨진다.
    // claude 는 실제 실행 파일이므로 셸 없이 직접 띄운다.
    // 걸린 시간은 단조 시계로 잰다 — 벽시계가 맞춰지거나 바뀌어도 시간이 부풀지 않는다. 파일 이름에만 벽시계를 쓴다.
    const startedAt = new Date();
    const t0 = performance.now();
    const elapsed = () => Math.round(performance.now() - t0);
    const seq = ++spawnSeq;
    // CLI 의 디버그 기록을 임시 파일로 받는다 — 느렸거나 실패했을 때만 기록 폴더로 옮겨 두고(keepDebug), 아니면 지운다.
    const debugFile = path.join(os.tmpdir(), `krs-cli-${process.pid}-${startedAt.getTime()}-${seq}.txt`);
    const child = spawn(CLAUDE_BIN, [...args, '--debug-file', debugFile], { shell: false, windowsHide: true, env });
    // 출력은 글자로 이어 받는다 — 덩어리마다 따로 풀면 한글 한 자가 두 덩어리에 걸렸을 때 깨진다.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const keepDebug = (ms, failed) => {
      let name = '';
      try {
        if (ms >= SLOW_MS || failed) {
          const text = fs.readFileSync(debugFile, 'utf8');
          const d = startedAt;
          // 같은 초에 여러 번 불러도(빠른 길이 곧바로 안 돼 다시 부른 것, 다리 여럿) 겹치지 않게 밀리초·프로세스·차례를 붙인다.
          name = `slow-${localDay(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}-${process.pid}-${seq}.txt`;
          fs.mkdirSync(LOG_DIR, { recursive: true });
          // 너무 길면 앞과 뒤만 둔다 — 시동은 앞에, 기다린 까닭과 끝내기는 뒤에 있다.
          fs.writeFileSync(path.join(LOG_DIR, name), text.length > SLOW_KEEP_CHARS * 2
            ? `${text.slice(0, SLOW_KEEP_CHARS)}\n…(${text.length}자 가운데 앞뒤만)…\n${text.slice(-SLOW_KEEP_CHARS)}` : text);
        }
      } catch { name = ''; /* 디버그 기록이 없거나 못 옮겼다 — 시간은 남는다 */ }
      try { fs.rmSync(debugFile, { force: true }); } catch { /* 아직 잡혀 있으면 임시 폴더에 남을 뿐이다 */ }
      return name ? { debug: name } : {};
    };

    let out = '';
    let err = '';
    // 어디서 시간이 갔는지 기록에 남긴다(2026-10-05 한 번에 80초가 걸린 호출이 있었는데 전체 시간만 남아 까닭을 못 짚었다).
    // 출력 줄(stream-json)을 오는 대로 보고, 종류마다 처음 온 때를 적는다 — 시동(system/init)·첫 답(assistant)·끝(result).
    // 줄의 종류별 개수(events)도 적는다: 다시 부르기(재시도) 같은 줄이 섞였으면 거기서 보인다.
    const at = {};
    const events = {};
    let pending = '';
    const mark = (k) => { if (!(k in at)) at[k] = elapsed(); };
    const scan = (chunk) => {
      pending += chunk;
      for (let i = pending.indexOf('\n'); i >= 0; i = pending.indexOf('\n')) {
        const line = pending.slice(0, i).trim();
        pending = pending.slice(i + 1);
        if (!line) continue;
        try {
          const o = JSON.parse(line);
          const kind = o?.type === 'system' && o.subtype ? `system/${o.subtype}` : String(o?.type || '?');
          events[kind] = (events[kind] || 0) + 1;
          mark(kind);
        } catch { /* JSON 한 줄이 아니다(json 출력은 끝에 객체 하나가 온다) */ }
      }
    };
    /**
     * 이 호출의 시간 — ms 전체, startMs 시동까지, answerMs 첫 답까지, resultMs 결과 줄까지(그 뒤는 끝내기다),
     * apiMs·selfMs·turns 는 CLI 가 스스로 잰 것(API 에 쓴 시간·전체·차례). 느렸거나 실패(failed)했으면 debug 에 남겨 둔 디버그 기록의 이름이 붙는다.
     */
    const timing = (env = null, failed = false) => {
      const ms = elapsed();
      return {
        ms,
        ...(at.out != null ? { outMs: at.out } : {}),
        ...(at['system/init'] != null ? { startMs: at['system/init'] } : {}),
        ...(at.assistant != null ? { answerMs: at.assistant } : {}),
        ...(at.result != null ? { resultMs: at.result } : {}),
        ...(env?.duration_api_ms != null ? { apiMs: env.duration_api_ms } : {}),
        ...(env?.duration_ms != null ? { selfMs: env.duration_ms } : {}),
        ...(env?.num_turns != null ? { turns: env.num_turns } : {}),
        ...(Object.keys(events).length ? { events } : {}),
        ...keepDebug(ms, failed),
      };
    };
    // 정리와 응답은 **프로세스가 끝난 뒤에 한 번만** 한다(finish) — 시간이 다 됐을 때도 끊고 나서 끝나기를 잠깐 기다린다:
    // 아직 열려 있는 디버그 기록을 읽고 지우려다 임시 파일을 남기거나, 답한 뒤에 정리가 돌지 않는 일이 없게.
    let timedOut = false;
    let spawnError = null;
    let settled = false;
    let grace = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      grace = setTimeout(() => finish(null), KILL_GRACE_MS);
    }, limitMs);

    child.stdout.on('data', (d) => { mark('out'); out += d; scan(d); });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      spawnError = e;
      finish(null);
    });
    // 표준 입력은 곧바로 닫는다 — 프롬프트를 인자로 준 길은 더 들어올 글이 없고, 첨부를 싣는 길은 메시지 한 줄을 쓰고 닫는다.
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
    child.on('close', (code) => finish(code));
    function finish(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      scan('\n');   // 줄바꿈 없이 끝난 마지막 줄도 센다
      cleanup();
      if (spawnError) {
        return reject(Object.assign(fail(`claude 실행 실패: ${spawnError.message}`, { bin: CLAUDE_BIN, code: spawnError.code }), { hard: true, timing: timing(null, true) }));
      }
      if (timedOut) {
        return reject(Object.assign(new Error(`CLI 응답이 ${limitMs / 1000}초 안에 오지 않았습니다.`), { hard: true, timing: timing(null, true) }));
      }
      if (code !== 0) {
        return reject(Object.assign(fail(err.trim().slice(0, 300) || `claude 종료 코드 ${code}`,
          { exitCode: code, stderr: clip(err.trim(), 2000), stdout: clip(out.trim(), 1000) }), { timing: timing(null, true) }));
      }

      const env = envelopeOf(out);
      if (!env) {
        return reject(Object.assign(fail('CLI 출력을 해석하지 못했습니다.', { stdout: clip(out.trim(), 2000) }), { timing: timing(null, true) }));
      }
      if (env.is_error) {
        return reject(Object.assign(fail(env.result || 'CLI 오류', { subtype: env.subtype, costUsd: env.total_cost_usd }), { timing: timing(env, true) }));
      }

      try {
        resolve({ data: JSON.parse(stripFence(env.result)), costUsd: env.total_cost_usd, timing: timing(env) });
      } catch {
        reject(Object.assign(fail('모델이 JSON 을 돌려주지 않았습니다.',
          { raw: clip(env.result, 2000), costUsd: env.total_cost_usd }), { timing: timing(env, true) }));
      }
    }
  });
}

/* ------------------------------------------------------------ 요청 처리 */

/**
 * 첨부에서 글자를 먼저 뽑는 작업 — 출장 증빙(receipt)과 공문 문서(gongmun.<갈래> — 견적서·교육 안내문·웹페이지 캡처, 2026-10-08).
 * 공문 문서 읽기는 갈래마다 작업이 따로다(공문 레시피가 만든다 — src/gmrecipe.js 의 tasks).
 */
export const TEXT_FIRST = new Set(['receipt', ...Object.keys(TASKS).filter((name) => name.startsWith('gongmun.'))]);

/**
 * 첨부에서 글자를 먼저 뽑는다(native/doctext.mjs 의 withText). 그 모듈과 꾸러미(pdfjs-dist·tesseract.js)는 첨부를 읽을 때만
 * 불러온다. 못 불러오면(새 PC 에서 npm install 을 안 했다) 전처럼 파일째 읽히고, 그 까닭이 기록의 read 에 남는다.
 */
async function extractText(input, files) {
  try {
    const { withText } = await import('./doctext.mjs');
    return await withText(input, files);
  } catch (e) {
    return { input, files, read: [`글자 뽑기를 건너뜀(${String(e?.message || e).slice(0, 160)}) — 파일째 보냄`], lean: false };
  }
}

/**
 * 요청 하나를 처리해 돌려줄 응답을 만든다. claude 를 부른 것은 성패와 상관없이 기록한다.
 * ping 과 logs 는 부를 때마다 남기면 기록이 그것으로 찬다 — 남기지 않는다.
 * gitStatus·gitPull 은 패널 머리의 git 아이콘이 부른다(native/gitsync.mjs — 명령은 거기 고정돼 있고 확장이 넘기는 값은 없다).
 * 확인은 몇 분마다 돌아 남기지 않고, 받기는 파일을 바꾸므로 남긴다.
 *
 * @param {object} msg
 * @param {{ run?: Function, log?: Function, tail?: Function, text?: Function, git?: {status: Function, pull: Function} }} [deps] 테스트가 갈아 끼운다
 */
export async function handle(msg, { run = runClaude, log = writeLog, tail = tailLogs, text = extractText, git = { status: gitStatus, pull: gitPull } } = {}) {
  if (msg?.task === 'ping') return { ok: true, pong: true };
  if (msg?.task === 'logs') return { ok: true, entries: tail(msg.limit) };
  if (msg?.task === 'gitStatus') return git.status();
  if (msg?.task === 'gitPull') {
    const started = Date.now();
    const r = await git.pull();
    log({ task: 'gitPull', ms: Date.now() - started, ...r });
    return r;
  }

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

  // 첨부(출장 증빙·공문 문서). 모양이 맞는 것만, 여섯 장까지. 기록에는 이름과 크기만 남긴다 — 영수증 그림을 기록 파일에 쌓지 않는다.
  const files = (Array.isArray(msg.files) ? msg.files : [])
    .filter((f) => f && typeof f.dataUrl === 'string' && /^data:[^;]+;base64,/.test(f.dataUrl)).slice(0, 6)
    .map((f) => ({ name: String(f.name || 'file'), type: String(f.type || ''), dataUrl: f.dataUrl }));
  const started = Date.now();
  const base = { task: msg.task, model: MODEL, input: clip(input, 1500),
    ...(files.length ? { files: files.map((f) => `${f.name} (${f.type}, ${Math.round((f.dataUrl.length * 3) / 4 / 1024)}KB)`) } : {}) };
  // 증빙과 공문 문서는 글자를 먼저 뽑는다(TEXT_FIRST) — PDF 는 뽑은 글자만 보내고, 그림은 OCR 글자를 그림과 같이 보낸다. 뽑은 글자는
  // 기록에 남기지 않는다(어떻게 읽었는지 read 만 남긴다).
  let call = { input: input.slice(0, 20000), files, read: [], lean: false };
  // 어디서 시간이 갔는지도 남긴다 — textMs 는 글자 뽑기(PDF 글자 층·OCR), cli 는 claude 를 부른 차례마다의 시간(runClaude).
  let textMs = null;
  if (TEXT_FIRST.has(msg.task) && files.length) {
    const t0 = Date.now();
    call = await text(call.input, files);
    textMs = Date.now() - t0;
  }
  const how = { ...(textMs != null ? { textMs } : {}), ...(call.read.length ? { read: call.read } : {}) };
  try {
    const { data, costUsd, attach, cli } = await run(task, call.input, call.files, { lean: call.lean });
    log({ ...base, ok: true, ms: Date.now() - started, costUsd, ...(attach ? { attach } : {}), ...how, ...(cli ? { cli } : {}), data });
    return { ok: true, data, costUsd };
  } catch (e) {
    log({ ...base, ok: false, ms: Date.now() - started, error: e.message, ...how, ...e.detail });
    return { ok: false, error: e.message };
  }
}

/* ---------------------------------------------------------------- 진입 */

// 테스트는 handle 만 가져다 쓴다. 크롬이 띄울 때는 이 변수가 없으므로 늘 아래가 돈다.
if (process.env.KRS_HOST_NO_MAIN !== '1') {
  writeFrame = guardStdout();
  pruneLogs();
  pruneTempDebug();
  onMessage(async (msg) => {
    // 기록을 먼저 쓰고 응답한다. 응답을 받은 크롬은 곧바로 이 프로세스를 끊을 수 있다.
    send(await handle(msg));
  });
}
