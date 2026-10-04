// 질의 해석과 실패 원인 분석을 어디에 맡길지 고른다.
//
//   1) 로컬 Claude Code CLI (네이티브 메시징) — API 키가 필요 없다
//   2) Anthropic API 키
//   3) 규칙 기반 해석 — 아무 설정 없이도 흔한 문장은 처리된다
//
// 앞의 것이 안 되면 다음으로 내려가고, 무엇을 썼는지 항상 같이 돌려준다.
//
// **어느 길로 온 답이든 입력 명세(input.yaml)의 관문을 지난 것만 돌려준다**(src/input.js 의 structure).
// 답이 명세와 다르면 그 길은 실패한 것으로 치고 다음 길로 내려간다. 여기서 나간 것은 그대로 실행자 쪽
// (findSlots, applyPatch)으로 가므로, 구조가 틀린 것이 여기를 지나면 안 된다.

import { callClaude } from './ai.js';
import { structure, InputError } from './input.js';
import { parseLocal } from './nlq.js';
import { parseAttendLocal, fixRelativeDates } from './attend.js';

export const NATIVE_HOST = 'com.krs.meetingroom';

/**
 * 네이티브 다리에 닿는지 본다. 닿지 않으면 브라우저가 댄 까닭을 같이 돌려준다 —
 * 등록이 없는 것("not found")과 확장 ID 가 어긋난 것("forbidden")은 고치는 길이 다르다.
 * @returns {Promise<{ok: boolean, error: string}>}
 */
export async function nativeProbe() {
  try {
    const r = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { task: 'ping' });
    return r?.pong ? { ok: true, error: '' } : { ok: false, error: '다리가 ping 에 답하지 않았습니다' };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * 다리가 native/logs 에 남긴 최근 호출 기록을 받아 온다.
 * 로그 복사는 클릭 직후 클립보드에 써야 하므로 오래 기다리지 않는다.
 * @returns {Promise<{entries: object[]|null, error?: string}>}
 */
export async function nativeLogs(limit = 30, timeoutMs = 3000) {
  let timer;
  try {
    const r = await Promise.race([
      chrome.runtime.sendNativeMessage(NATIVE_HOST, { task: 'logs', limit }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${timeoutMs / 1000}초 안에 응답 없음`)), timeoutMs);
      }),
    ]);
    if (!r?.ok || !Array.isArray(r.entries)) return { entries: null, error: r?.error || '다리가 기록을 돌려주지 않았습니다' };
    return { entries: r.entries };
  } catch (err) {
    return { entries: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function nativeTask(task, input, files = []) {
  const r = await chrome.runtime.sendNativeMessage(NATIVE_HOST, files.length ? { task, input, files } : { task, input });
  if (!r?.ok) throw new Error(r?.error || '로컬 Claude 호출이 실패했습니다.');
  return r;
}

const joined = (...parts) => parts.flat().filter(Boolean).join(', ');

/**
 * 로컬 CLI → API 키 순으로 물어, **명세를 통과한 첫 답**을 돌려준다.
 * 둘 다 안 되면 data 가 없다. 왜 내려왔는지는 fails 에 남는다 — 답이 명세와 달랐던 것도 실패다.
 *
 * @param {string} task input.yaml 의 작업 이름
 * @param {{apiKey?:string, useNative?:boolean, kind?:string}} opts kind 는 화면이 정한 종류
 * @returns {Promise<{data?: object, notes?: string[], via?: 'cli'|'api', costUsd?: number, fails: string[]}>}
 */
async function askClaude(task, input, { apiKey, useNative, kind, files = [] }) {
  const fails = [];
  if (useNative) {
    try {
      const r = await nativeTask(task, input, files);
      return { ...structure(task, r.data, { kind }), via: 'cli', costUsd: r.costUsd, fails };
    } catch (err) {
      fails.push(`로컬 CLI 실패(${err.message})`);
    }
  }
  if (apiKey) {
    try {
      const data = await callClaude(task, input, { apiKey, files });
      return { ...structure(task, data, { kind }), via: 'api', fails };
    } catch (err) {
      fails.push(`API 실패(${err.message})`);
    }
  }
  return { fails };
}

/**
 * 자연어를 조회 조건으로 바꾼다.
 *
 * 회의실과 차량은 **조건의 모양이 같다**(날짜·시간·길이). 다른 것은 말투뿐이라
 * 무엇을 찾는지만 알려주고 같은 길을 쓴다. 차량이 받지 않는 조건(좌석 수·지역)은 관문이 비우고 note 에 적는다.
 *
 * @param {{apiKey?:string, today:string, useNative?:boolean, kind?:'room'|'car'}} opts
 * @returns {Promise<{filter: object, via: 'cli'|'api'|'local', costUsd?: number, note?: string, guessed?: boolean}>}
 *   guessed 는 규칙 해석이 날짜도 시간도 못 읽어 기본값으로 돌았다는 뜻이다.
 */
export async function parseSmart(text, opts) {
  const { today, kind = 'room' } = opts;
  const what = kind === 'car' ? '차량' : '회의실';
  const got = await askClaude('parse', `오늘은 ${today} 입니다.\n찾는 대상: ${what}\n\n요청: ${text}`, { ...opts, kind });
  if (got.data) return { filter: got.data, via: got.via, costUsd: got.costUsd, note: joined(got.fails, got.notes) };

  // 규칙 해석도 같은 관문을 지난다. 여기서도 어긋나면 더 내려갈 길이 없다 — 찾지 않고 다시 적게 한다.
  const local = parseLocal(text, today);
  try {
    const out = structure('parse', local, { kind });
    return { filter: out.data, via: 'local', guessed: !!local.guessed, note: joined(got.fails, out.notes) };
  } catch (err) {
    if (!(err instanceof InputError)) throw err;
    throw new Error(`조건을 읽지 못했습니다(${err.problems.join(', ')}). 날짜와 시간을 다르게 적어 주세요.`);
  }
}

/**
 * 출장 증빙(숙박 영수증·예약서·항공권) 한 장을 읽어 사후정산에 넣을 값을 뽑는다(input.yaml 의 receipt). 글이 아니라 파일을
 * 읽는 일이라 규칙 해석(local)은 없다 — 로컬 CLI 도 API 키도 안 되면 던진다. 묶는 것은 src/after.js 가 한다.
 * @param {{name:string,type:string,dataUrl:string}} file
 * @param {{trip:{from?:string,to?:string,location?:string}, me?:string}} ctx
 * @returns {Promise<{record: object, via: 'cli'|'api', costUsd?: number, note?: string}>}
 */
export async function receiptSmart(file, ctx, opts) {
  const got = await askClaude('receipt', receiptInput(file, ctx), { ...opts, kind: 'trip', files: [file] });
  if (!got.data) throw new Error(`증빙을 읽지 못했습니다 — ${joined(got.fails) || 'Claude 연결(로컬 CLI 또는 API 키)이 필요합니다'}`);
  return { record: got.data, via: got.via, costUsd: got.costUsd, note: joined(got.notes) };
}

export function receiptInput(file, { trip = {}, me = '' } = {}) {
  return `출장 정보: ${trip.from || '?'} ~ ${trip.to || trip.from || '?'}${trip.location ? ` · 출장지 ${trip.location}` : ''}${me ? ` · 출장자 ${me}` : ''}\n`
    + `첨부한 문서(파일 이름: ${file.name})를 읽어 출력 키를 채웁니다. 이 문서 한 장만 봅니다.`;
}

/**
 * 예약 실패 원인을 설명한다. 성공 여부 판정은 재조회가 이미 했다.
 * 설명을 못 얻으면(연결 없음·답이 명세와 다름) 조용히 null 이다 — 분석 없이 넘어간다.
 * @param {object} digest 종류별 실행자가 만든 요약(대상·보낸 값·응답에서 달라진 것)
 * @returns {Promise<{result: object, via: 'cli'|'api'} | null>}
 */
export async function diagnoseSmart(digest, opts) {
  const got = await askClaude('diagnose', JSON.stringify(digest, null, 2), opts);
  return got.data ? { result: got.data, via: got.via } : null;
}

const WEEKDAYS = '일월화수목금토';

/** Claude 에게 줄 글. 오늘(요일 포함)·지금 폼·앞선 대화·새 말을 한데 묶는다. 첨부파일 내용은 넣지 않는다. */
export function attendInput(text, { form = {}, today, history = [] }) {
  const [y, m, d] = today.split('-').map(Number);
  const shown = { ...form, file: form.file ? '(첨부 있음)' : null };
  const turns = history.slice(-6).map((h) => `${h.who === 'me' ? '사용자' : '도우미'}: ${h.text}`).join('\n');
  // 요일 셈을 모델에게 맡기지 않는다. 석 주 치 달력을 적어 주고 거기서 찾게 한다.
  const days = Array.from({ length: 21 }, (_, i) => {
    const x = new Date(y, m - 1, d + i);
    return `${x.getMonth() + 1}/${x.getDate()}(${WEEKDAYS[x.getDay()]})`;
  }).join(' ');
  return `오늘은 ${today} (${WEEKDAYS[new Date(y, m - 1, d).getDay()]}요일) 입니다.\n`
    + `달력(오늘부터, 한 주는 월요일에 시작): ${days}\n`
    + `지금 폼: ${JSON.stringify(shown)}\n`
    + (turns ? `앞선 대화:\n${turns}\n` : '')
    + `\n새 요청: ${text}`;
}

/** "내일"·"다음 주 수요일" 같은 상대 날짜는 규칙으로 다시 셈해 Claude 의 답을 바로잡는다. */
function dated(data, text, today) {
  const { patch, fixed } = fixRelativeDates(data, text, today);
  return fixed ? { patch, note: '날짜는 달력으로 다시 셈했습니다' } : { patch };
}

/**
 * 말로 근태 폼을 채운다. 로컬 CLI → API 키 → 규칙 해석 순이고, 무엇을 썼는지 같이 돌려준다.
 * 돌려주는 patch 는 명세의 관문을 지난 **부분 수정**이다(말하지 않은 칸은 들어 있지 않다). 종류와 갈래의
 * 짝 같은 폼 규칙은 여기서 보지 않는다 — 부르는 쪽이 src/attend.js 의 applyPatch 로 폼에 얹으며 가린다.
 * 받을 수 없어 뺀 값이 있으면 note 에 적는다.
 *
 * @param {{apiKey?:string, today:string, useNative?:boolean, form?:object, history?:object[]}} opts
 * @returns {Promise<{patch: object, reply: string, via: 'cli'|'api'|'local', costUsd?: number, note?: string}>}
 */
export async function fillAttendSmart(text, opts) {
  const { today, form = {} } = opts;
  const got = await askClaude('attend', attendInput(text, opts), { ...opts, kind: 'attend' });
  if (got.data) {
    const { reply = '', ...patch } = got.data;
    const out = dated(patch, text, today);
    return { patch: out.patch, reply, via: got.via, costUsd: got.costUsd, note: joined(got.fails, got.notes, out.note) };
  }

  const local = parseAttendLocal(text, today, form);
  const out = structure('attend', local.patch, { kind: 'attend' });
  return { patch: out.data, reply: local.reply, via: 'local', note: joined(got.fails, out.notes) };
}
