// eclass 쪽지(Message)로 보내는 길 — 받는 사람을 찾고, 글과 첨부 하나를 보낸다.
//
// 쪽지 쓰기 화면(/eClassVer4/Message/NewMessage)이 하는 차례 그대로다(2026-10-03 그 화면의 message-write-script.js 와
// 첨부 컴포넌트 DEXTUploadX5 의 소스에서 확인):
//
//   1) POST Message/SaveDraft   dId(빈 값)·title·to(사용자 ID, 쉼표)·cc·content(HTML)·likeSingle·uploadedFile·deletedFile → { isSuccess, dId }
//   2) POST Message/DraftFileUp?pType=SEND   multipart — DEXTUploadX5_AuthKey·ControlId·UniqueId·Folder·EXIFData·FileData·MetaData
//                               → "SEND:<파일 정보>" (글)
//   3) POST Message/SaveDraft   같은 값에 dId 와 uploadedFile = <파일 정보>
//   4) POST Message/SendDraft   dId → { isSuccess }
//
// 받는 사람 찾기는 GET Message/GetRecipientSuggestions?query= (쓰기 화면의 자동완성이 부르는 것)이다.
//
// 2026-10-03 사용자 허락을 받고 본인에게 시험 쪽지 한 통을 실제로 보내 확인했다 — 1~4 가 적힌 대로 답했고
// (SaveDraft `{"isSuccess":true,"dId":"…"}`, DraftFileUp `SEND:<이름>|<크기>|pdf:`, SendDraft `{"isSuccess":true}`), 받은 쪽지에 PDF 가 붙어 있었다.
// 사이트의 답은 단계마다 확인하고, 기대한 답이 아니면 그 자리에서 멈춘다. 멈추면 임시 보관함(Drafts)에 쓰다 만 쪽지가 남을 수 있다 — 그 사실을 말해 준다.

import { ORIGIN } from './config.js';
import { AuthError, siteFetch, directFetch } from './net.js';

const BASE = `${ORIGIN}/eClassVer4/Message`;
/** 쪽지 쓰기 화면. 로그인이 살아 있는지, 직접 요청이 되는지 여기를 읽어 본다. */
export const MEMO_WRITE_URL = `${BASE}/NewMessage`;
/** 첨부 컴포넌트의 설정 파일 — 올릴 때 같이 보내는 제품 열쇠(authkey)가 여기 적혀 있다. */
const DEXT_CONFIG_URL = `${ORIGIN}/intra/intranet/DEXT_X5_V4_3/dextuploadx5-configuration.js`;
/** 쓰기 화면이 첨부 컴포넌트에 붙인 이름(dx5.create 의 id). */
const DEXT_CONTROL = 'dext5';

const LOGIN = '로그인이 필요합니다. eclass 에 로그인한 뒤 다시 시도하세요.';
const looksLogin = (html) => /id="tbUserId"|Account\/Log(in|out)|You must sign in/i.test(html || '');
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };

function jsonOf(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    if (looksLogin(text)) throw new AuthError(LOGIN);
    throw new Error(`${what}: 쪽지 화면이 알 수 없는 답을 했습니다.`);
  }
}

/**
 * 이름·ID·부서로 받는 사람을 찾는다(쪽지 쓰기 화면의 자동완성과 같은 조회). 읽기만 한다.
 * @returns {Promise<{id:string, name:string, title:string, dept:string}[]>}
 */
export async function memoSuggest(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const r = await siteFetch(`${BASE}/GetRecipientSuggestions?query=${encodeURIComponent(q)}`);
  const list = jsonOf(r.html, '받는 사람 찾기');
  return (Array.isArray(list) ? list : []).filter((x) => x?.userId).map((x) => ({
    id: String(x.userId), name: String(x.userName || '').trim(), title: String(x.empDegree || '').trim(), dept: String(x.deptName || '').trim(),
  }));
}

/** 설정 파일에서 지금 쓰는(주석이 아닌) 제품 열쇠를 읽는다. 없으면 빈 글. */
export function dextAuthKey(source) {
  const live = String(source || '').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  return (live.match(/authkey\s*:\s*"([^"]+)"/) || [])[1] || '';
}

/** 글 줄들을 쪽지 본문(HTML)으로. */
export const memoHtml = (lines) => (lines || []).map((line) =>
  `<p>${String(line).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) || '<br>'}</p>`).join('');

/**
 * 쪽지를 보낸다. 첨부는 하나(묶은 PDF)다.
 * @param {{to: string[], title: string, lines: string[], file?: {name:string, bytes:Uint8Array, type?:string}, onStage?: Function}} memo
 *   to 는 받는 사람의 사용자 ID 들
 * @returns {Promise<{dId: string, file: string}>} dId 는 쪽지가 임시저장될 때 받은 번호, file 은 사이트가 받은 첨부 정보
 */
export async function memoSend({ to, title, lines, file = null, onStage = () => {} }) {
  if (!to?.length) throw new Error('받는 사람이 없습니다.');
  if (!String(title || '').trim()) throw new Error('쪽지 제목이 비어 있습니다.');
  onStage('쪽지 화면을 확인하는 중...');
  const page = await siteFetch(MEMO_WRITE_URL);
  if (!/id="formMain"/.test(page.html)) {
    if (looksLogin(page.html)) throw new AuthError(LOGIN);
    throw new Error('쪽지 쓰기 화면의 모양이 다릅니다.');
  }
  // 첨부(multipart)는 탭을 거쳐 보낼 수 없다. 직접 요청이 막힌 환경이면 화면에서 보내게 한다.
  if (page.via === 'tab') throw new Error('확장의 직접 요청이 막혀 쪽지를 보내지 못했습니다. eclass 의 쪽지 화면에서 보내 주세요.');

  const draft = { title: String(title).trim(), to: to.join(','), cc: '', content: memoHtml(lines), likeSingle: '0', deletedFile: '' };
  const save = async (dId, uploadedFile) => {
    const r = await directFetch(`${BASE}/SaveDraft`, { method: 'POST', headers: FORM, body: new URLSearchParams({ dId, ...draft, uploadedFile }).toString() });
    const out = jsonOf(r.html, '쪽지 임시저장');
    if (!out?.isSuccess || !out.dId) throw new Error('쪽지를 임시저장하지 못했습니다(사이트가 실패라고 답했습니다).');
    return String(out.dId);
  };

  onStage('쪽지를 쓰는 중...');
  const dId = await save('', '');
  const left = ' eclass 쪽지의 임시 보관함(Drafts)에 쓰다 만 쪽지가 남아 있을 수 있습니다.';
  let info = '';
  try {
    if (file) {
      onStage(`첨부를 올리는 중 — ${file.name}`);
      const key = dextAuthKey((await directFetch(DEXT_CONFIG_URL)).html);
      if (!key) throw new Error('첨부 컴포넌트의 설정을 읽지 못했습니다.');
      const body = new FormData();
      body.append('DEXTUploadX5_AuthKey', key);
      body.append('DEXTUploadX5_ControlId', DEXT_CONTROL);
      body.append('DEXTUploadX5_UniqueId', `DX5-${Date.now()}-0`);
      body.append('DEXTUploadX5_Folder', '');
      body.append('DEXTUploadX5_EXIFData', '');
      body.append('DEXTUploadX5_FileData', new Blob([file.bytes], { type: file.type || 'application/pdf' }), file.name);
      body.append('DEXTUploadX5_MetaData', '');
      const up = (await directFetch(`${BASE}/DraftFileUp?pType=SEND`, { method: 'POST', body })).html;
      // 답은 "SEND:<파일 정보>" 다. 그 밖의 답이면 첨부가 받아들여지지 않은 것이다 — 첨부 없이 보내지 않는다.
      if (!/^SEND:.+/.test(up.trim())) throw new Error(looksLogin(up) ? LOGIN : '사이트가 첨부를 받지 않았습니다.');
      info = up.trim().slice('SEND:'.length);
      await save(dId, info);
    }
    onStage('쪽지를 보내는 중...');
    const sent = jsonOf((await directFetch(`${BASE}/SendDraft`, { method: 'POST', headers: FORM, body: new URLSearchParams({ dId }).toString() })).html, '쪽지 보내기');
    if (!sent?.isSuccess) throw new Error('사이트가 쪽지를 보내지 못했다고 답했습니다.');
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new Error(`${err.message}${left}`);
  }
  return { dId, file: info };
}
