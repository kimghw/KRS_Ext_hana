// 확장 폴더(이 폴더의 위 — git 저장소)를 GitHub 과 맞춰 본다. 패널 머리의 git 아이콘(gitsync.js)이 다리(host.mjs)를 거쳐 부른다.
//
// 확장이 git 에 넘기는 값은 없다. 할 수 있는 일은 둘뿐이고 명령도 여기 고정돼 있다.
//  - status: 받아 오기(fetch)를 한 뒤 올라간 곳(upstream)보다 몇 커밋 뒤졌는지·앞섰는지, 새 커밋의 줄, 고치고 있는 파일과 겹치는 것
//  - pull: 빨리 감기로만 받는다(pull --ff-only). 갈라졌거나 고치고 있는 파일과 겹치면 git 이 거절하고, 그 까닭을 돌려준다
//    — 고치던 것을 덮거나 병합 커밋을 만들지 않는다.
// 다리에는 창이 없어 git 이 비밀번호를 물으면 답할 사람이 없다 — 묻지 않고 실패하게 한다(GIT_TERMINAL_PROMPT·GCM_INTERACTIVE).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = process.env.KRS_GIT_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GIT_BIN = process.env.GIT_BIN || 'git';
/** 아이콘의 풍선 말에 보이는 새 커밋 줄 수의 한도. */
const COMMITS_MAX = 10;
const FILES_MAX = 30;
/** 받은 뒤 확장을 다시 불러오지 않아도 되는 파일 — 브라우저가 싣지 않는 것(설명·검사·도구·스킬). 다리(native/)는 부를 때마다 새로 뜬다. */
const NO_RELOAD = /^(README\.md$|test\/|tools\/|native\/|gmail\/|\.claude\/)/;

// git 의 말은 영어로 받는다(LC_ALL=C) — 거절한 까닭을 그 말로 가린다. 커밋 제목·파일 이름의 한글은 그대로 온다(core.quotepath=false).
const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' });

const clip = (s, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);
const lines = (r) => (r.code === 0 && r.out ? r.out.split('\n').map((l) => l.trim()).filter(Boolean) : []);

/**
 * git 을 한 번 부른다. 던지지 않는다 — 실행이 안 되거나 시간이 다 되면 code 가 -1 이다.
 * @returns {Promise<{code: number, out: string, err: string}>}
 */
export function runGit(args, { cwd = REPO, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const child = spawn(GIT_BIN, ['-c', 'core.quotepath=false', ...args], { cwd, shell: false, windowsHide: true, env: gitEnv() });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const finish = (code, why = '') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out: out.trim(), err: (why || err).trim() });
    };
    const timer = setTimeout(() => { child.kill(); finish(-1, `git ${args[0]} 이 ${timeoutMs / 1000}초 안에 끝나지 않았습니다.`); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish(-1, `git 실행 실패: ${e.message}`));
    child.on('close', (code) => finish(code ?? -1));
  });
}

/** git 이 거절한 말을 사람이 할 일로 바꾼다. 모르는 말이면 그대로(잘라서) 둔다. */
export function gitError(err) {
  const s = String(err || '').trim();
  if (/would be overwritten/i.test(s)) {
    const files = s.split('\n').filter((l) => /^\s/.test(l)).map((l) => l.trim()).filter(Boolean);
    return `고치고 있는 파일과 겹쳐 받지 않았습니다${files.length ? `(${files.slice(0, 5).join(', ')}${files.length > 5 ? ` 외 ${files.length - 5}개` : ''})` : ''} — 커밋하거나 치운 뒤 다시 누르세요.`;
  }
  if (/not possible to fast-forward|diverg/i.test(s)) return '여기에만 있는 커밋이 있어 빨리 감기로 받을 수 없습니다 — 터미널에서 직접 pull 하세요.';
  if (/authentication failed|could not read username|terminal prompts disabled|permission denied/i.test(s)) {
    return 'GitHub 인증이 필요합니다 — 터미널에서 한 번 git pull 해 로그인해 두세요.';
  }
  if (/could not resolve host|unable to access|failed to connect|timed out/i.test(s)) return 'GitHub 에 닿지 못했습니다(네트워크).';
  if (/index\.lock|another git process/i.test(s)) return '다른 git 작업이 돌고 있습니다 — 잠시 뒤 다시 누르세요.';
  return clip(s) || 'git 이 까닭 없이 실패했습니다.';
}

/**
 * 받아 오기를 한 뒤 올라간 곳과 비교한다. 받아 오기가 안 돼도(오프라인·인증) 마지막으로 받아 둔 것과는 비교한다 — 그 까닭은 fetchError.
 * @returns {Promise<{ok: true, branch: string, upstream: string, ahead: number, behind: number,
 *   commits: {hash: string, author: string, date: string, subject: string}[], dirty: number, overlap: string[], fetchError?: string}
 *   | {ok: false, error: string}>}
 */
export async function gitStatus({ git = runGit, fetch = true } = {}) {
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch.code !== 0) return { ok: false, error: `git 저장소가 아닙니다 — ${gitError(branch.err)}` };
  const up = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (up.code !== 0) return { ok: false, error: `${branch.out} 가지에 올라간 곳(upstream)이 없습니다.` };
  const fetched = fetch ? await git(['fetch', '--quiet']) : null;
  const count = await git(['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  const [ahead, behind] = count.out.split(/\s+/).map(Number);
  if (count.code !== 0 || !Number.isFinite(ahead) || !Number.isFinite(behind)) return { ok: false, error: `비교하지 못했습니다 — ${gitError(count.err)}` };
  const commits = behind
    ? lines(await git(['log', `--max-count=${COMMITS_MAX}`, '--format=%h%x1f%an%x1f%cI%x1f%s', 'HEAD..@{u}'])).map((l) => {
      const [hash, author, date, subject] = l.split('\x1f');
      return { hash, author, date, subject };
    })
    : [];
  // 고치고 있는 파일(커밋하지 않은 것)과, 받을 커밋이 바꾸는 파일이 겹치면 git 이 받기를 거절한다 — 누르기 전에 알린다.
  const mine = lines(await git(['diff', '--name-only', 'HEAD']));
  const incoming = behind ? lines(await git(['diff', '--name-only', 'HEAD...@{u}'])) : [];
  const overlap = incoming.filter((f) => mine.includes(f)).slice(0, FILES_MAX);
  return {
    ok: true, branch: branch.out, upstream: up.out, ahead, behind, commits, dirty: mine.length, overlap,
    ...(fetched && fetched.code !== 0 ? { fetchError: gitError(fetched.err) } : {}),
  };
}

/**
 * 빨리 감기로만 받는다. 받은 커밋 수와 바뀐 파일, 확장을 다시 불러와야 하는지(reload), package.json 이 바뀌었는지(deps)를 돌려준다.
 * @returns {Promise<{ok: true, from: string, to: string, pulled: number, files: string[], fileCount: number, reload: boolean, deps: boolean}
 *   | {ok: false, error: string}>}
 */
export async function gitPull({ git = runGit } = {}) {
  const before = await git(['rev-parse', 'HEAD']);
  if (before.code !== 0) return { ok: false, error: `git 저장소가 아닙니다 — ${gitError(before.err)}` };
  // --no-rebase: 사용자 설정(pull.rebase)이 무엇이든 빨리 감기만 한다.
  const pulled = await git(['pull', '--ff-only', '--no-rebase', '--quiet'], { timeoutMs: 60_000 });
  if (pulled.code !== 0) return { ok: false, error: gitError(pulled.err) };
  const after = await git(['rev-parse', 'HEAD']);
  const moved = after.code === 0 && after.out !== before.out;
  const changed = moved ? lines(await git(['diff', '--name-only', before.out, after.out])) : [];
  const n = moved ? Number((await git(['rev-list', '--count', `${before.out}..${after.out}`])).out) || 0 : 0;
  return {
    ok: true, from: before.out.slice(0, 7), to: (after.out || before.out).slice(0, 7), pulled: n,
    files: changed.slice(0, FILES_MAX), fileCount: changed.length,
    reload: changed.some((f) => !NO_RELOAD.test(f)), deps: changed.some((f) => /^package(-lock)?\.json$/.test(f)),
  };
}
