// HR(hr.krs.co.kr) 과 말하는 길. 근태 신청서를 조회하고, 사이트의 저장·결재요청·회수 함수를 부른다.
//
// HR 은 eclass 와 다른 시스템이다. eclass 에 로그인돼 있으면 SSO 주소(홈의 "HR System" 링크와 같은 주소)가
// HR 세션을 만들어 준다. HR 화면은 X-Frame-Options: SAMEORIGIN 이라 패널 안에 넣을 수 없고, 폼은 HR 껍데기
// 안의 iframe 에서만 제대로 돈다. 그래서 **HR 작업 탭**을 뒷전에 하나 열고 그 안에서 일한다.
//
// 값을 넣고 저장하는 일은 요청을 흉내 내지 않는다. 폼 화면을 작업 탭의 숨은 iframe 에 띄우고, 그 화면의
// 자기 함수(saveTrav100·apprRequest·apprReqCancel …)를 그대로 부른다. 결재선·문서번호·숨은 칸을 사이트가
// 스스로 채우므로 사람이 그 화면에서 버튼을 누른 것과 같은 요청이 나간다(2026-10-02 화면 소스로 확인).

import { ORIGIN } from './config.js';
import { AuthError, portalState } from './net.js';

export const HR_ORIGIN = 'https://hr.krs.co.kr';
/** eclass 홈의 "HR System 열기" 링크가 여는 주소. 로그인돼 있으면 HR 첫 화면으로 넘어간다. */
export const HR_SSO_URL = `${ORIGIN}/eClassVer4/External/SSOMessage`;
export const HR_LIST_API = '/empmenu/docappr/docapprdocmstremp100';

/** 작업 탭 번호를 적어 두는 자리. 패널을 닫았다 열어도 같은 탭을 다시 쓴다. */
export const TAB_KEY = 'hrWorkerTab';

export class HrError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'HrError';
    Object.assign(this, extra);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------- HR 탭 안에서 도는 함수들 */
// 아래 함수들은 chrome.scripting 으로 **글자 그대로** 옮겨져 HR 탭에서 돈다. 바깥 변수를 쓰면 안 된다.

/** 껍데기 화면인가, 로그인 폼으로 떨어졌는가. */
function pageShell() {
  return {
    href: location.href,
    shell: !!document.querySelector('iframe[name=mainframe]'),
    login: !!document.querySelector('#username') && !!document.querySelector('#password'),
  };
}

/** 같은 출처 요청. 사이트의 jQuery 요청과 같은 머리말을 단다. */
async function pageFetch(path, init) {
  try {
    const res = await fetch(path, {
      credentials: 'include', ...(init || {}),
      headers: { Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest', ...((init && init.headers) || {}) },
    });
    return { status: res.status, url: res.url, text: await res.text() };
  } catch (e) {
    return { status: 0, url: '', text: '', error: String((e && e.message) || e) };
  }
}

/** 폼을 띄울 숨은 iframe 을 단다. 보이는 화면(mainframe)은 건드리지 않는다. */
function pageMount(name, route) {
  for (const old of document.querySelectorAll('iframe[data-krsws]')) old.remove();
  const f = document.createElement('iframe');
  f.name = name;
  f.dataset.krsws = '1';
  // 폼 화면이 제목 줄을 그릴 때 읽는다. 없으면 예외를 삼키고 넘어가지만 맞춰 준다.
  f.dataset.breadcrumb = 'KRS WORKSPACE>근태>신청';
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  // display:none 이면 사이트의 보임 판정과 표(RealGrid) 크기 계산이 틀어진다. 화면 밖으로만 뺀다.
  f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1400px;height:1000px;border:0;opacity:0;pointer-events:none';
  f.src = route;
  document.body.append(f);
  return true;
}

function pageUnmount() {
  for (const old of document.querySelectorAll('iframe[data-krsws]')) old.remove();
  return true;
}

/** 모든 프레임에서 돈다. 이름이 맞는 프레임만 답한다 — 폼 초기화(동기 요청 여럿)가 끝났는지 본다. */
function frameProbe(name, ready) {
  if (window.name !== name) return null;
  try {
    const jq = window.jQuery;
    const sel = ready.sel ? document.querySelector(ready.sel) : null;
    const ok = document.readyState === 'complete' && !!jq && jq.active === 0
      && (!ready.fn || typeof window[ready.fn] === 'function')
      && (!ready.sel || (!!sel && sel.options && sel.options.length > 1))
      && (!ready.global || !!window[ready.global]);
    return { ready: ok, href: location.href };
  } catch (e) {
    return { ready: false, href: location.href, error: String((e && e.message) || e) };
  }
}

/**
 * 폼 프레임 안에서 일감을 돈다(MAIN 세계 — 사이트의 jQuery 와 함수를 직접 쓴다).
 *   문서 열기 → 값 넣기 → 다시 읽어 확인 → (맞으면) 사이트 함수 호출 → 사이트가 띄운 문구 수집
 * 확인이 하나라도 어긋나면 버튼을 누르지 않는다. 사이트의 알림·확인 창은 이 프레임 안에서만 가로챈다.
 */
async function frameRun(job) {
  const out = { ok: false, stage: 'start', dialogs: [], errors: [], ajax: [], read: {}, docNo: '', message: '' };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const plain = (s) => String(s == null ? '' : s).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  try {
    const $ = window.jQuery;
    if (!$) throw new Error('HR 화면이 준비되지 않았습니다.');

    // 누른 것으로 칠 확인 창은 이 셋뿐이다. 결재선 확인 같은 다른 물음에는 답하지 않고 멈춘다.
    const ACCEPT = /저장 하시겠습니까|결재요청 하시겠습니까|회수 하시겠습니까/;
    const note = (kind) => function (message, title, cb) {
      if (typeof title === 'function') cb = title;
      out.dialogs.push({ kind, text: plain(message) });
      if (typeof cb === 'function') {
        try { cb(true); } catch (e) { out.errors.push('알림 뒤처리 오류: ' + ((e && e.message) || e)); }
      }
    };
    $.alert = note('alert');
    $.error = note('error');
    $.warning = note('warning');
    $.dialog = note('dialog');
    $.confirm = function (message, title, cb) {
      if (typeof title === 'function') cb = title;
      const text = plain(message);
      const yes = !!job.fn && ACCEPT.test(text);
      out.dialogs.push({ kind: 'confirm', text, accepted: yes });
      if (yes && typeof cb === 'function') cb(true);
    };
    window.alert = function (m) { out.dialogs.push({ kind: 'native', text: plain(m) }); };
    $(document).ajaxError(function (ev, xhr, settings) {
      out.ajax.push({ status: xhr && xhr.status, url: String((settings && settings.url) || '').slice(0, 120) });
    });
    const docNoNow = () => String($('input[name=docNo]').first().val() || '');

    if (job.open) {
      out.stage = 'open';
      if (typeof window.sendMdiParamCallback !== 'function') throw new Error('문서를 여는 사이트 함수를 찾지 못했습니다.');
      window.sendMdiParamCallback({ docNo: job.open.docNo, statusCode: job.open.statusCode });
      const t0 = Date.now();
      while (Date.now() - t0 < 25000 && !($.active === 0 && docNoNow() === job.open.docNo)) await wait(300);
      if (docNoNow() !== job.open.docNo) throw new Error('문서 ' + job.open.docNo + ' 을(를) 열지 못했습니다.');
      // 사이트가 문서를 폼에 앉힌 뒤 0.2~0.5초 뒤에 값을 한 번 더 덮는다. 그게 끝난 뒤에 손댄다.
      await wait(1800);
    }

    if (job.action === 'recall') {
      const btn = document.querySelector('#btnApprReqCancel');
      if (!btn || btn.disabled || getComputedStyle(btn).display === 'none') {
        throw new Error('회수할 수 없는 상태입니다(결재가 이미 진행됐거나 끝난 문서).');
      }
    }

    out.stage = 'fill';
    for (const op of job.ops || []) {
      if (op.op === 'wait') { await wait(op.ms); continue; }
      if (op.op === 'idle') {
        // 사이트가 방금 보낸 요청(Weekly 를 고르면 읽는 근무시간표)이 끝나기를 기다린다. 그 답이 칸을 덮어쓴다.
        const t0 = Date.now();
        await wait(op.ms);
        while ($.active > 0 && Date.now() - t0 < 15000) await wait(200);
        continue;
      }
      if (op.op === 'set') {
        const el = $(op.sel);
        if (!el.length) { out.errors.push(op.label + ': 칸을 찾지 못했습니다(' + op.sel + ')'); continue; }
        el.val(op.value);
        for (const ev of op.events || ['change']) el.trigger(ev);
        continue;
      }
      if (op.op === 'radio') {
        const r = $('input[name="' + op.name + '"]').filter(function () { return this.value === op.value; });
        if (!r.length) { out.errors.push(op.label + ': 선택지를 찾지 못했습니다'); continue; }
        r.prop('checked', true).trigger('change');
        if (!r.prop('checked')) out.errors.push(op.label + ': 선택되지 않았습니다');
        continue;
      }
      if (op.op === 'file') {
        const drop = window.$fileDrop;
        if (!drop || typeof drop.addFiles !== 'function') { out.errors.push('첨부 칸을 찾지 못했습니다'); continue; }
        const bin = atob(String(op.dataUrl).split(',')[1] || '');
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        drop.addFiles([new File([bytes], op.name, { type: op.type || 'application/octet-stream' })]);
        if (!(drop.getCheckedFiles().length > 0)) out.errors.push('첨부파일이 붙지 않았습니다');
        continue;
      }
      if (op.op === 'flexRow') {
        const g = window.docapprflex100Grid;
        if (!g) { out.errors.push('유연근무 표를 찾지 못했습니다'); continue; }
        if (op.edit) {
          const rows = g.getData();
          if (!rows.length) { out.errors.push('고칠 줄이 없습니다'); continue; }
          for (const key of Object.keys(op.row)) g.setValue(rows[0].rowKey, key, op.row[key]);
        } else {
          g.appendRow(op.row, false);
        }
        try { g.getGrid().commit(true); } catch (e) { /* 편집 중이 아니면 할 일이 없다 */ }
        const now = g.getData().find(function (r) { return String(r.wcDate) === op.row.wcDate; });
        if (!now || String(now.wcTime) !== op.row.wcTime || String(now.reqRsn) !== op.row.reqRsn) {
          out.errors.push('유연근무 줄이 들어가지 않았습니다');
        }
        continue;
      }
      if (op.op === 'cancelRow') {
        const g = window[op.grid];
        if (!g || typeof window.insertGridRow !== 'function') { out.errors.push('취소신청 표를 찾지 못했습니다'); continue; }
        let rows = null;
        $.ajax({ url: op.pop, type: 'GET', async: false, data: Object.assign({ emplNo: $('input[name=userId]').val() }, op.params), success: function (d) { rows = d; } });
        const hits = (rows || []).filter(function (r) { return r.docNo === op.docNo; });
        if (!hits.length) throw new Error('취소할 수 있는 결재완료 문서 목록에 ' + op.docNo + ' 이(가) 없습니다.');
        for (const row of hits) window.insertGridRow(row);
        for (const row of g.getData()) if (row.befDocNo === op.docNo) g.setValue(row.rowKey, 'cnclRsn', op.reason);
        try { g.getGrid().commit(true); } catch (e) { /* 위와 같다 */ }
        const set = g.getData().filter(function (r) { return r.befDocNo === op.docNo && r.cnclRsn === op.reason; });
        if (set.length !== hits.length) out.errors.push('취소 사유가 들어가지 않았습니다');
        out.read.cancelRows = set.length;
        continue;
      }
      out.errors.push('모르는 작업: ' + op.op);
    }

    out.stage = 'check';
    for (const ex of job.expect || []) {
      const cur = String($(ex.sel).val() == null ? '' : $(ex.sel).val());
      const same = 'num' in ex ? Math.abs(parseFloat(cur) - ex.num) < 0.011 : cur === String(ex.value);
      if (!same) out.errors.push(ex.label + ': ' + ('num' in ex ? ex.num : ex.value) + ' 이어야 하는데 ' + (cur || '빈칸') + ' 입니다');
    }
    for (const key of Object.keys(job.read || {})) {
      const r = job.read[key];
      if (typeof r === 'string') out.read[key] = String($(r).val() == null ? '' : $(r).val());
      else if (r && r.grid && window[r.grid]) {
        out.read[key] = window[r.grid].getData().map(function (row) {
          const o = {};
          for (const f of r.fields) o[f] = row[f];
          return o;
        });
      }
    }
    out.docNo = docNoNow();
    // 값을 넣는 동안 사이트의 요청이 거절됐으면(가끔 403 이 온다) 일수·시간 계산이 빠졌을 수 있다.
    if (out.ajax.length) out.errors.push('HR 이 요청을 거절했습니다(HTTP ' + out.ajax[0].status + '). 잠시 뒤 다시 시도하세요');
    // 하나라도 어긋났으면 누르지 않는다. 빈 폼을 저장해 버리는 것보다 멈추는 편이 낫다.
    if (out.errors.length) return out;

    if (!job.fn) {
      // 넣어 보기만 할 때는 사이트의 검증 함수까지만 돌린다(알림만 띄우고 아무것도 보내지 않는다).
      if (job.validate && typeof window.chkValidation === 'function') out.valid = window.chkValidation() === true;
      out.ok = true;
      out.stage = 'done';
      return out;
    }

    out.stage = 'act';
    const fn = window[job.fn];
    if (typeof fn !== 'function') throw new Error('사이트 함수 ' + job.fn + ' 을(를) 찾지 못했습니다.');
    const DONE = { save: /저장 되었습니다/, request: /결재 요청되었습니다/, recall: /회수되었습니다/ }[job.action];
    const from = out.dialogs.length;
    const said = () => out.dialogs.slice(from).filter(function (d) { return d.kind !== 'confirm'; });
    fn();
    const t0 = Date.now();
    let quiet = 0;
    while (Date.now() - t0 < (job.timeoutMs || 45000)) {
      if (said().some(function (d) { return DONE.test(d.text); })) { out.ok = true; break; }
      const idle = $.active === 0;
      // 사이트가 묻기만 하고 우리가 답하지 않은 확인 창이 있으면 더 기다릴 것이 없다.
      if (out.dialogs.slice(from).some(function (d) { return d.kind === 'confirm' && !d.accepted; })) break;
      if (idle && (said().length || out.ajax.length)) {
        await wait(600);   // 성공 문구가 바로 뒤따라오는지 한 번 더 본다
        if (said().some(function (d) { return DONE.test(d.text); })) out.ok = true;
        break;
      }
      quiet = idle ? quiet + 1 : 0;
      if (quiet > 40) break;   // 10초 동안 아무 일도 없었다
      await wait(250);
    }
    out.docNo = docNoNow() || out.docNo;
    const last = said().slice(-1)[0] || out.dialogs.slice(-1)[0];
    out.message = last ? last.text : '';
    out.stage = 'done';
    return out;
  } catch (e) {
    out.errors.push(String((e && e.message) || e));
    return out;
  }
}

/**
 * 껍데기 화면에서 돈다(MAIN 세계). 결재문서함에서 줄을 두 번 누른 것과 같은 길로 문서를 HR 의 탭에 연다
 * — 문서 번호를 사이트의 열쇠로 감싸 화면 주소에 붙이고, 사이트의 탭 열기 함수에 넘긴다(pageMdiTabOpen).
 * 껍데기가 아직 덜 떴으면 ready 가 거짓이다(부르는 쪽이 다시 묻는다).
 */
async function pageOpenDoc(doc) {
  try {
    // 탭 열기 함수는 **안쪽 화면**(메인페이지 등)의 것을 부른다. 껍데기에도 같은 함수가 있지만 탭 줄을 가리키는 변수가
    // 비어 있어서(스크립트가 탭 줄보다 먼저 읽힌다), 거기서 부르면 문서가 탭 줄에 안 붙고 가려진 채 열린다
    // (2026-10-02 실제 화면에서 확인).
    let host = null;
    for (const f of document.querySelectorAll('iframe')) {
      try {
        const w = f.contentWindow;
        if (w.document.readyState === 'complete' && typeof w.getMdiData === 'function'
          && typeof w.pageMdiOnLoad_new === 'function' && w.CryptoJS && w.$_key) { host = w; break; }
      } catch (e) { /* 덜 뜬 프레임 */ }
    }
    if (!host) return { ready: false };
    const param = host.btoa(host.CryptoJS.AES.encrypt(JSON.stringify(doc.param), host.$_key).toString());
    // 사이트의 조회는 실패해도 답하지 않는다. 마냥 기다리지 않게 시간을 건다.
    const value = await Promise.race([
      host.getMdiData(doc.pgmId, doc.pgmUrlAd),
      new Promise((r) => setTimeout(() => r(null), 10000)),
    ]);
    if (value == null || value === '') return { ready: true, opened: false };
    host.pageMdiOnLoad_new(value, doc.pgmUrlAd + '?mdiparam=' + param);
    return { ready: true, opened: true };
  } catch (e) {
    return { ready: true, opened: false, error: String((e && e.message) || e) };
  }
}

/** 테스트와 실제 브라우저 검사가 같은 함수를 쓰도록 내놓는다. */
export const injected = { pageShell, pageFetch, pageMount, pageUnmount, frameProbe, frameRun, pageOpenDoc };

/* ------------------------------------------------------------ 작업 탭 */

const exec = (tabId, func, args = [], opts = {}) => chrome.scripting.executeScript({
  target: opts.all ? { tabId, allFrames: true } : { tabId, frameIds: [opts.frameId ?? 0] },
  world: opts.world || 'ISOLATED', func, args,
});

const firstResult = async (p) => (await p)?.[0]?.result;

async function rememberTab(id) {
  await chrome.storage.local.set({ [TAB_KEY]: id == null ? null : { id } });
}

async function knownTab() {
  const saved = (await chrome.storage.local.get(TAB_KEY))?.[TAB_KEY];
  if (!saved?.id || !chrome.tabs?.get) return null;
  try {
    return await chrome.tabs.get(saved.id);
  } catch {
    return null;   // 닫힌 탭이다
  }
}

/** 응답이 "로그인 풀림"인가. HR 은 401·419 를 주거나 로그인 화면(HTML)으로 돌린다. */
const sessionDead = (r) => !r || [0, 401, 403, 419].includes(r.status)
  || /loggedout|\/login/i.test(r.url || '') || /^\s*</.test(r.text || '');

async function whoAmI(tabId) {
  const shell = await firstResult(exec(tabId, pageShell)).catch(() => null);
  if (!shell?.shell || shell.login) return null;
  const r = await firstResult(exec(tabId, pageFetch, ['/api/user', null])).catch(() => null);
  if (sessionDead(r)) return null;
  try {
    const u = JSON.parse(r.text);
    return u?.loginUserId ? { emplNo: String(u.loginUserId), name: u.loginUserNm || '', dept: u.loginDeptName || '' } : null;
  } catch {
    return null;
  }
}

const LOGIN_EXPIRED = '로그인이 필요합니다. eclass 로그인이 만료됐습니다. eclass 에 다시 로그인한 뒤 다시 시도하세요.';
const SSO_WAIT_MS = 30000;
const SESSION_TRUST_MS = 15000;

let session = null;   // { tabId, user, at }
let workerTabId = null;   // 이 패널이 쓰고 있는 작업 탭. 닫힐 때 치울 것을 바로 알기 위해 따로 든다.

/**
 * HR 작업 탭을 준비한다. 살아 있는 탭이 있으면 그대로 쓰고, 없으면 SSO 주소를 뒷전 탭으로 연다.
 * eclass 로그인이 풀려 있으면 SSO 를 열지 않는다 — 풀린 채로 따라가면 남은 쿠키까지 지워진다.
 * @returns {Promise<{tabId:number, user:{emplNo:string,name:string,dept:string}}>}
 */
export async function hrSession({ onStage = () => {} } = {}) {
  // 방금 확인한 세션은 다시 묻지 않는다. 한 번의 조작이 요청 서너 개로 이어지기 때문이다.
  if (session && Date.now() - session.at < SESSION_TRUST_MS) return session;
  const tab = await knownTab();
  if (tab && (tab.url || '').startsWith(HR_ORIGIN)) {
    const user = await whoAmI(tab.id);
    if (user) {
      workerTabId = tab.id;
      return (session = { tabId: tab.id, user, at: Date.now() });
    }
  }

  const portal = await portalState();
  if (portal === 'expired') throw new AuthError(LOGIN_EXPIRED, { portal });

  onStage('HR 에 연결하는 중...');
  let tabId = tab?.id ?? null;
  if (tabId != null) await chrome.tabs.update(tabId, { url: HR_SSO_URL });
  else tabId = (await chrome.tabs.create({ url: HR_SSO_URL, active: false }))?.id ?? null;
  if (tabId == null) throw new HrError('HR 작업 탭을 열지 못했습니다.');
  await rememberTab(tabId);
  workerTabId = tabId;

  const t0 = Date.now();
  while (Date.now() - t0 < SSO_WAIT_MS) {
    await sleep(500);
    let now;
    try { now = await chrome.tabs.get(tabId); } catch { throw new HrError('HR 작업 탭이 닫혔습니다. 다시 시도하세요.'); }
    const url = now.url || '';
    if (/\/Account\/Log(in|out)/i.test(url)) throw new AuthError(LOGIN_EXPIRED, { portal: 'expired' });
    if (url.startsWith(HR_ORIGIN) && !/sso-proc/i.test(url) && now.status === 'complete') {
      const user = await whoAmI(tabId);
      if (user) return (session = { tabId, user, at: Date.now() });
    }
  }
  throw new HrError('HR 에 들어가지 못했습니다. eclass 홈의 HR System 이 열리는지 확인해 주세요.');
}

/**
 * 적어 둔 작업 탭이 아직 열려 있는가. 배경은 이것으로 "내가 연 탭만 닫는다"를 가린다
 * — 패널이 쓰고 있는 탭을 배경이 닫으면 패널의 다음 요청이 끊긴다.
 */
export const hrWorkerAlive = async () => !!(await knownTab());

/**
 * 패널이 닫힐 때 작업 탭을 치운다. 닫히는 중에는 기다릴 수 없으므로 탭 닫기를 **곧바로** 부른다
 * (저장소를 먼저 읽고 닫으면 그 사이에 패널이 사라져 탭이 남는다 — 2026-10-02 실제로 남았다).
 */
export function hrCloseWorker() {
  const id = workerTabId;
  session = null;
  workerTabId = null;
  if (id == null) return Promise.resolve();
  const gone = Promise.resolve(chrome.tabs.remove(id)).catch(() => {});
  rememberTab(null).catch(() => {});
  return gone;
}

// HR 일은 한 번에 하나씩 한다. 폼 프레임이 하나뿐이라 겹치면 서로의 화면을 갈아 치운다.
let chain = Promise.resolve();
const serial = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
};

async function request(path, init, opts) {
  let s = await hrSession(opts);
  let r = await firstResult(exec(s.tabId, pageFetch, [path, init || null])).catch(() => null);
  if (sessionDead(r)) {
    // 세션이 그 사이 풀렸다. 한 번만 다시 들어가 본다.
    session = null;
    await chrome.tabs.update(s.tabId, { url: 'about:blank' }).catch(() => {});
    s = await hrSession(opts);
    r = await firstResult(exec(s.tabId, pageFetch, [path, init || null])).catch(() => null);
  }
  if (sessionDead(r)) throw new HrError('HR 로그인이 유지되지 않습니다. 잠시 뒤 다시 시도하세요.');
  if (r.status < 200 || r.status >= 300) throw new HrError(`HR 응답 오류 (HTTP ${r.status})`, { status: r.status, body: r.text.slice(0, 500) });
  return { text: r.text, session: s };
}

const query = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();

const parseJson = (text, what) => {
  try { return JSON.parse(text); } catch { throw new HrError(`${what} 응답을 읽지 못했습니다.`); }
};

/**
 * 내 신청 내역(결재문서함). 화면의 조회 버튼과 같은 요청이다.
 * @param {{from:string,to:string}} range 신청일 기준 YYYY-MM-DD
 * @returns {Promise<{rows: object[], user: object}>}
 */
export function hrListDocs({ from, to }, opts) {
  return serial(async () => {
    const s = await hrSession(opts);
    const q = query({ reqDateFrom: from, reqDateTo: to, formId: '', statusCode: '', searchEmplNo: s.user.emplNo, searchEmplNameHan: '' });
    const { text } = await request(`${HR_LIST_API}/search?${q}`, null, opts);
    const rows = parseJson(text, '신청 내역');
    if (!Array.isArray(rows)) throw new HrError('신청 내역 응답의 모양이 다릅니다.');
    return { rows, user: s.user };
  });
}

/**
 * 이번 주 근무시간표 — 요일별 유연근무 시간 코드(monTime … friTime). 유연근무 신청서 화면이 띄우는 것과 같은 조회다.
 * 반차를 올릴 때 그 날 출근시간이 정시인지 보는 데 쓴다.
 */
export function hrWeekTimes(opts) {
  return serial(async () => {
    const s = await hrSession(opts);
    const { text } = await request(`/uhr/docappr/apprflex100/current-week-work-time?${query({ emplNo: s.user.emplNo })}`, null, opts);
    const data = parseJson(text, '근무시간표');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  });
}

/** 문서 한 건의 내용. 수정·복사할 때 폼을 채우는 데 쓴다. */
export function hrGetDoc(item, opts) {
  return serial(async () => {
    const { text } = await request(`${item.api}?${query({ docNo: item.docNo, statusCode: item.status })}`, null, opts);
    const rows = parseJson(text, '문서');
    return Array.isArray(rows) ? rows[0] || null : rows;
  });
}

/**
 * 문서를 지운다(임시저장·회수한 문서). 문서함의 삭제 버튼과 같은 요청이다. 지워진 건수를 돌려준다.
 * 문서함 화면은 임시저장에만 그 버튼을 보여 준다 — 회수한 문서는 서버가 받지 않을 수 있고, 그때는 던진다.
 */
export function hrDeleteDoc(item, opts) {
  return serial(async () => {
    const { text } = await request(`${HR_LIST_API}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: query({ docNo: item.docNo, statusCode: item.status }),
    }, opts);
    const n = Number(text);
    if (!(n > 0)) throw new HrError('삭제되지 않았습니다.', { body: text.slice(0, 200) });
    return n;
  });
}

const OPEN_WAIT_MS = 30000;

/**
 * 문서를 HR 웹 화면에서 보여준다 — HR 을 새 탭으로 앞에 열고, 그 문서를 HR 의 탭에 띄운다.
 * 작업 탭은 쓰지 않는다(패널이 닫히면 같이 닫히는 뒷전 탭이다).
 * @param {{web:{pgmId:string|number, pgmUrlAd:string, param:object}|null}} item listItem 의 결과
 * @returns {Promise<number>} 연 탭 번호
 */
export async function hrOpenDoc(item, opts = {}) {
  if (!item?.web?.pgmUrlAd) throw new HrError('이 문서는 HR 화면 주소를 알 수 없습니다.');
  // HR 세션부터 확인한다. 풀려 있으면 여기서 다시 들어가고, eclass 까지 풀렸으면 만료라고 던진다.
  await serial(() => hrSession(opts));
  const tabId = (await chrome.tabs.create({ url: `${HR_ORIGIN}/`, active: true }))?.id ?? null;
  if (tabId == null) throw new HrError('HR 탭을 열지 못했습니다.');
  const t0 = Date.now();
  while (Date.now() - t0 < OPEN_WAIT_MS) {
    await sleep(500);
    let now;
    try { now = await chrome.tabs.get(tabId); } catch { throw new HrError('HR 탭이 닫혔습니다.'); }
    if (now.status !== 'complete' || !(now.url || '').startsWith(HR_ORIGIN)) continue;
    const r = await firstResult(exec(tabId, pageOpenDoc, [item.web], { world: 'MAIN' })).catch(() => null);
    if (!r?.ready) continue;
    if (!r.opened) throw new HrError(`HR 이 이 문서의 화면을 열어 주지 않았습니다${r.error ? ` (${r.error})` : ''}. 열린 HR 탭의 결재문서함에서 찾아 주세요.`);
    return tabId;
  }
  throw new HrError('HR 화면이 뜨지 않았습니다. 열린 HR 탭의 결재문서함에서 찾아 주세요.');
}

const FRAME_WAIT_MS = 60000;

/**
 * 일감을 HR 폼 화면에서 돈다.
 * @returns {Promise<object>} frameRun 의 결과 — ok, errors, dialogs, read, docNo, message
 */
export function hrRunJob(job, opts = {}) {
  const onStage = opts.onStage || (() => {});
  return serial(async () => {
    const s = await hrSession(opts);
    const name = `krsws-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    onStage('HR 화면을 여는 중...');
    try {
      await exec(s.tabId, pageMount, [name, job.route]);
    } catch (err) {
      session = null;   // 탭이 닫혔을 수 있다. 다음 시도에서 다시 연다.
      throw new HrError(`HR 작업 탭에 닿지 못했습니다. 다시 시도하세요. (${err.message})`);
    }
    try {
      let frameId = null;
      let steady = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < FRAME_WAIT_MS) {
        await sleep(500);
        const results = await exec(s.tabId, frameProbe, [name, job.ready || {}], { all: true, world: 'MAIN' }).catch(() => []);
        const hit = (results || []).find((r) => r?.result);
        // 한 번 준비됐다고 믿지 않는다. 두 번 잇달아 준비돼 있어야 초기화가 끝난 것이다.
        steady = hit?.result?.ready ? steady + 1 : 0;
        if (steady >= 2) { frameId = hit.frameId; break; }
      }
      if (frameId == null) throw new HrError('HR 폼 화면이 뜨지 않았습니다. 잠시 뒤 다시 시도하세요.');
      onStage(job.fn ? 'HR 에 올리는 중...' : '값을 넣어 보는 중...');
      const result = await firstResult(exec(s.tabId, frameRun, [job], { frameId, world: 'MAIN' }));
      if (!result) throw new HrError('HR 화면이 답하지 않았습니다.');
      return result;
    } finally {
      await exec(s.tabId, pageUnmount).catch(() => {});
    }
  });
}
