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
import { parseSetupLocal, reasonInput } from './gongmun.js';

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

/** 증빙 읽기에 같이 주는 화면 글자의 한도 — 예약 확인 화면은 이보다 훨씬 짧다. 다리는 입력을 2만 자에서 자르고 OCR 글자가 그 뒤에 붙는다. */
const RECEIPT_PAGE_MAX = 12000;

/**
 * 증빙 읽기에 줄 글. text 는 웹페이지를 통째로 캡처한 증빙(예약 확인·결제 완료 화면 — 출장 카드의 웹페이지 캡처, 2026-10-08)의 화면
 * 글자다(src/pagecap.js 의 normalizeText — 머리에 [웹페이지 글자 — 제목] 주소). 그림보다 정확해 같이 준다.
 */
export function receiptInput(file, { trip = {}, me = '', text = '' } = {}) {
  const page = String(text || '').trim();
  return `출장 정보: ${trip.from || '?'} ~ ${trip.to || trip.from || '?'}${trip.location ? ` · 출장지 ${trip.location}` : ''}${me ? ` · 출장자 ${me}` : ''}\n`
    + `첨부한 문서(파일 이름: ${file.name})를 읽어 출력 키를 채웁니다. 이 문서 한 장만 봅니다.`
    + (page ? `\n이 문서는 웹페이지를 통째로 캡처한 것입니다 — 그 화면의 글자도 함께 봅니다(같은 문서입니다).\n<<<\n${page.slice(0, RECEIPT_PAGE_MAX)}\n>>>` : '');
}

/**
 * 공문(구매·교육·출장 품의)에 넣을 문서를 읽는다(input.yaml 의 gongmun). 파일(이미지·PDF) 여러 장은 한 문서의 여러 쪽으로 보고 한 번에
 * 보내며, 글을 붙여 넣었으면 글만 보낸다. 규칙 해석(local)은 없다 — 로컬 CLI 도 API 키도 안 되면 던진다.
 * 초안으로 바꾸는 것은 src/gongmun.js 의 fromRecord 다.
 * @param {{files?: {name:string,type:string,dataUrl:string}[], text?: string}} source
 * @param {{kind: 'purchase'|'edu'|'trip', today?: string}} ctx 화면이 고른 갈래
 * @returns {Promise<{record: object, via: 'cli'|'api', costUsd?: number, note?: string}>}
 */
export async function gongmunSmart(source, ctx, opts) {
  const files = source?.files || [];
  const got = await askClaude('gongmun', gongmunInput(source, ctx), { ...opts, kind: ctx.kind, files });
  if (!got.data) throw new Error(`문서를 읽지 못했습니다 — ${joined(got.fails) || 'Claude 연결(로컬 CLI 또는 API 키)이 필요합니다'}`);
  return { record: got.data, via: got.via, costUsd: got.costUsd, note: joined(got.notes) };
}

/**
 * 공문 탭의 채팅 칸 — 붙여 넣은 글(과제 목록 표·메모)에서 사전 설정 조각(과제·과제책임자(합의자)·부서장·참조자)을 뽑는다
 * (input.yaml 의 gongmunSetup). Claude 가 닿지 않으면 규칙 해석(src/gongmun.js 의 parseSetupLocal)으로 내려간다.
 * 얹는 것은 src/gongmun.js 의 mergeSetup 이다.
 * @param {{preset?: object, projects?: object[], current?: string}} now 지금 등록된 사전 설정과 초안에서 고른 과제
 * @returns {Promise<{patch: object, reply: string, via: 'cli'|'api'|'local', costUsd?: number, note?: string}>}
 */
export async function gongmunSetupSmart(text, now = {}, opts = {}) {
  const input = `지금 등록된 사전 설정: ${JSON.stringify({ ...(now.preset || {}), projects: now.projects || [] })}\n`
    + `지금 고른 과제: ${now.current || '없음'}\n\n새 글:\n<<<\n${String(text).slice(0, 8000)}\n>>>`;
  const got = await askClaude('gongmunSetup', input, { ...opts, kind: 'gongmun' });
  if (got.data) {
    const { reply = '', ...patch } = got.data;
    return { patch, reply, via: got.via, costUsd: got.costUsd, note: joined(got.fails, got.notes) };
  }
  const local = parseSetupLocal(text);
  const out = structure('gongmunSetup', local.patch, { kind: 'gongmun' });
  return { patch: out.data, reply: local.reply, via: 'local', note: joined(got.fails, out.notes) };
}

const GONGMUN_DOC = {
  purchase: '구매(견적서·거래명세서·쇼핑몰 주문 화면)', edu: '교육(교육 안내문·교육 신청 확인서·교육비 견적서)',
  trip: '출장(행사·회의·학회 안내문·초청장·출장 일정표·교통/숙박 견적서)',
  outside: '외부활동 허가(강의·자문·심사·발표·위원 위촉 요청 공문·초청장·요청 메일·행사 안내문)',
};

/**
 * 문서 읽기에 줄 글. 파일 여러 장은 같은 건의 문서들이다(교육이면 교육 견적서와 교육 내용 캡처 — 2026-10-07 사용자 지정).
 * 파일과 붙여 넣은 글이 같이 있으면 둘 다 본다.
 */
export function gongmunInput({ files = [], text = '' } = {}, { kind = 'purchase', today = '' } = {}) {
  const head = `품의 종류: ${GONGMUN_DOC[kind] || GONGMUN_DOC.purchase}\n${today ? `오늘은 ${today} 입니다.\n` : ''}`;
  // 웹페이지를 통째로 캡처하면 화면 글자가 같이 온다(src/pagecap.js 의 TEXT_MAX) — 다리가 입력을 자르는 2만 자 안에 머리말과 함께 든다.
  const pasted = String(text || '').trim() ? `\n<<<\n${String(text).slice(0, 18000)}\n>>>` : '';
  if (files.length) {
    return `${head}첨부한 문서 ${files.length}장(파일 이름: ${files.map((f) => f.name).join(', ')})을 읽어 출력 키를 채웁니다.`
      + (files.length > 1 ? ' 여러 장은 같은 건의 문서들(여러 쪽, 또는 견적서와 교육 내용 등)이니 함께 보고, parts 에 파일마다 무슨 문서인지 적습니다.' : '')
      + (pasted ? `\n사용자가 붙여 넣은 글도 함께 봅니다.${pasted}` : '');
  }
  return `${head}아래는 사용자가 붙여 넣은 글입니다. 이 글을 읽어 출력 키를 채웁니다.${pasted}`;
}

/**
 * 과제 내용으로 품의 사유(구매사유·교육사유)와 용도(교육목적)를 쓴다(input.yaml 의 gongmunReason — 2026-10-07 사용자 지정).
 * 쓰는 일이라 규칙 해석은 없다 — 로컬 CLI 도 API 키도 안 되면 던진다. 초안에 넣는 것은 src/gongmun.js 의 applyReason 이다.
 * ask 는 초안의 에이전트 칸에 사용자가 적은 말이다 — 있으면 그 말대로 고쳐 쓰고 reply 에 한 줄로 답한다(2026-10-08 사용자 지정).
 * @returns {Promise<{data: {reason: string, use: string|null, reply: string|null}, via: 'cli'|'api', costUsd?: number, note?: string}>}
 */
export async function gongmunReasonSmart(kind, draft, project, opts, { ask = '' } = {}) {
  const got = await askClaude('gongmunReason', reasonInput(kind, draft, project, { ask }), { ...opts, kind });
  if (!got.data) throw new Error(`사유를 쓰지 못했습니다 — ${joined(got.fails) || 'Claude 연결(로컬 CLI 또는 API 키)이 필요합니다'}`);
  return { data: got.data, via: got.via, costUsd: got.costUsd, note: joined(got.notes) };
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
