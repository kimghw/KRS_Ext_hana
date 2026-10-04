// 여비계산서를 PDF 로 받는다 — 담당자에게 보낼 때 증빙 앞에 붙인다(2026-10-04 사용자 지정: "확정한 다음에 출력해서 증빙들과 합쳐서").
//
// 계산서 화면(CalPrint)의 본문은 사이트의 리포트 서버(ClipReport 5)가 그린다. 화면은 열릴 때 리포트 서버의 reportView.aspx 에
// 리포트 파일·연결 이름·매개변수(MSEQ=계산서:TSEQ=출장자:LAN)를 폼으로 보내고, 뷰어(clipreport5.js)가 그 답에 적힌 리포트 열쇠로
// Clip.aspx 와 말한다. 뷰어의 인쇄 버튼은 "PDF 로 인쇄"로 맞춰져 있어(setReportDirectPrintButton(true, 0)) 서버가 PDF 를 만들어 준다.
// 여기는 그 차례를 그대로 따른다(2026-10-04 뷰어 스크립트를 읽고, 계산서 143884 로 실제로 받아 확인했다 — 1쪽):
//
//   POST reportView.aspx  {crfName, xmlData, dataConnetion, param, saveReportType}          → 화면 글 안의 reportkey(JSON, uid)
//   POST Clip.aspx  ClipType=pageCheck         ClipData={reportkey, s_time}                 → {id:2, resValue:{status, count, endReport}}
//   POST Clip.aspx  ClipType=PDFPrint          ClipData={reportkey, startNum, endNum, …}    → {id:5, resValue:{status}}
//   POST Clip.aspx  ClipType=fileDownloadCheck ClipData={reportkey, s_time}                 → {id:4, resValue:{status, progress}}
//   POST Clip.aspx  ClipType=PDFPrintDownload  ClipData={reportkey}                         → application/pdf
//
// pageCheck 는 endReport 가 참일 때까지, fileDownloadCheck 는 status 가 참일 때까지 되풀이한다(뷰어도 그렇게 기다린다).
// 계산서의 값은 아무것도 바뀌지 않는다 — 계산서를 열어 인쇄 버튼을 누른 것과 같다.

import { ORIGIN } from './config.js';
import { AuthError, REQUEST_TIMEOUT_MS } from './net.js';

const VIEW_PATH = '/ClipReport/reportView.aspx';
const VIEW_URL = `${ORIGIN}${VIEW_PATH}`;
const CLIP_URL = `${ORIGIN}/ClipReport/Clip.aspx`;
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
/** 리포트가 다 그려지기를, PDF 가 다 만들어지기를 몇 번까지 물어보는가(물음 사이는 PAUSE_MS). */
const TRIES = 40;
const PAUSE_MS = 700;
const DOWNLOAD_TIMEOUT_MS = 60000;
const LOGIN = '로그인이 필요합니다. eclass 에 로그인한 뒤 다시 시도하세요.';
const looksLogin = (html) => /id="tbUserId"|Account\/Log(in|out)|You must sign in/i.test(html || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 계산서 화면의 글에서 리포트 서버에 보내는 폼을 읽는다. 화면이 리포트를 부르지 않으면(모양이 다르면) null.
 * @returns {{crfName:string, xmlData:string, dataConnetion:string, param:string, saveReportType:string}|null}
 *   dataConnetion 은 사이트가 쓰는 칸 이름 그대로다(리포트 서버의 오타)
 */
export function calReport(html) {
  const text = String(html || '');
  if (!text.includes(VIEW_PATH)) return null;
  const pick = (re) => (re.exec(text) || [])[1];
  const crfName = pick(/\brebUrl\s*=\s*['"]([^'"]+\.reb)['"]/);
  const param = pick(/\bparam\s*:\s*['"]([^'"]*)['"]/);
  const dataConnetion = pick(/\bdataConnetion\s*:\s*['"]([^'"]*)['"]/);
  if (!crfName || !param || !dataConnetion) return null;
  return { crfName: encodeURI(crfName), xmlData: '', dataConnetion, param, saveReportType: pick(/\bsaveReportType\s*:\s*['"]([^'"]*)['"]/) || 'pdf' };
}

/** 리포트의 매개변수(MSEQ=계산서:TSEQ=출장자:LAN=K)에서 계산서 번호와 출장자 번호를 읽는다. */
export function reportTarget(param) {
  const of = Object.fromEntries(String(param || '').split(':').map((kv) => kv.split('=')));
  return { seq: of.MSEQ || '', trseq: of.TSEQ || '' };
}

/**
 * 리포트를 PDF 로 받는다.
 * @param {object} report calReport 가 읽은 폼
 * @param {{fetchFn?:Function, onStage?:Function, pause?:Function}} [opts] pause 는 물음 사이에 쉬는 길(테스트가 갈아 끼운다)
 * @returns {Promise<{bytes: Uint8Array, pages: number}>} pages 는 리포트 서버가 말한 쪽수
 */
export async function reportPdf(report, { fetchFn = fetch, onStage = () => {}, pause = sleep } = {}) {
  const send = async (url, body, ms = REQUEST_TIMEOUT_MS) => {
    let res;
    try {
      res = await fetchFn(url, { method: 'POST', credentials: 'include', headers: FORM, body, signal: AbortSignal.timeout(ms) });
    } catch (err) {
      throw new Error(err?.name === 'TimeoutError' ? `리포트 서버가 ${ms / 1000}초 안에 답하지 않았습니다.` : `리포트 서버에 닿지 못했습니다(${err?.message || err}).`);
    }
    if (!res.ok) throw new Error(`리포트 서버가 HTTP ${res.status} 로 답했습니다.`);
    return res;
  };
  const clip = (type, data, ms) => send(CLIP_URL, `ClipType=${type}&ClipData=${encodeURIComponent(JSON.stringify(data))}`, ms);
  /** Clip.aspx 의 답({id, resValue})에서 resValue 를 꺼낸다. 읽지 못하면 던진다. */
  const ask = async (type, data, what) => {
    const text = await (await clip(type, data)).text();
    let value = null;
    try { value = JSON.parse(text)?.resValue; } catch { /* JSON 이 아니다 */ }
    if (!value) throw new Error(`리포트 서버의 답을 읽지 못했습니다(${what}).`);
    return value;
  };

  onStage('여비계산서를 여는 중...');
  const view = await (await send(VIEW_URL, new URLSearchParams(report).toString())).text();
  let key = null;
  try { key = JSON.parse((/\breportkey\s*=\s*'(\{[^']*\})'/.exec(view) || [])[1]); } catch { /* 열쇠가 없다 */ }
  const uid = key?.uid || key?.reportkey;
  if (!uid || key.status === false) {
    if (looksLogin(view)) throw new AuthError(LOGIN);
    throw new Error('리포트 서버가 여비계산서를 열지 못했습니다.');
  }

  let pages = 0;
  for (let i = 0; i < TRIES && !pages; i++) {
    const r = await ask('pageCheck', { reportkey: uid, s_time: `t${i}` }, '쪽수 확인');
    if (!r.status) throw new Error('리포트 서버가 여비계산서를 그리지 못했습니다.');
    if (r.endReport) {
      if (!(r.count > 0)) throw new Error('여비계산서에 쪽이 없습니다.');
      pages = r.count;
    } else await pause(PAUSE_MS);
  }
  if (!pages) throw new Error('여비계산서가 다 그려지기를 기다리다 그만두었습니다.');

  onStage('여비계산서를 PDF 로 받는 중...');
  const made = await ask('PDFPrint', { reportkey: uid, startNum: 1, endNum: pages, isTextImage: false, drawDashedLineDirectly: true }, 'PDF 만들기');
  if (!made.status) throw new Error('리포트 서버가 여비계산서를 PDF 로 만들지 못했습니다.');
  let ready = false;
  for (let i = 0; i < TRIES && !ready; i++) {
    ready = !!(await ask('fileDownloadCheck', { reportkey: uid, s_time: `t${i}` }, 'PDF 확인')).status;
    if (!ready) await pause(PAUSE_MS);
  }
  if (!ready) throw new Error('여비계산서 PDF 가 다 만들어지기를 기다리다 그만두었습니다.');

  const bytes = new Uint8Array(await (await clip('PDFPrintDownload', { reportkey: uid }, DOWNLOAD_TIMEOUT_MS)).arrayBuffer());
  // "%PDF" 로 시작해야 PDF 다 — 오류 화면(글)을 PDF 라고 묶어 보내지 않는다.
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new Error('리포트 서버가 준 것이 PDF 가 아닙니다.');
  return { bytes, pages };
}
