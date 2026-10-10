// 새 공문 창(eclass 전자결재 DocumentView)에 공문을 쓴다 — 과제(JOB-ID)·제목·수신·참조·차수·본문, 문서설정, 결재선(위임전결).
// 무엇을 쓸지는 src/gongmun.js 의 writePlan 이 정하고, 칸의 자리는 레시피(recipes/gongmun 의 fieldmap)다. 2026-10-08 사용자 지정:
// "공문에서 열기가 아니라 공문을 작성해야지. job-id 는 과제에 맞게 잘 선택하고. 문서설정, 위임전결도 같이 입력" · "공문작성은 백그라운드에서".
//
// 백그라운드 — 새 공문 창은 뒤 탭으로 열고 끝나도 앞으로 가져오지 않는다(작성 기록의 '창 보기'로 간다). 문서설정·결재선은 원래 팝업 창이지만
// 사용자 앞에 창이 뜨지 않게 그 공문 창의 툴바 문서 안 숨은 틀(iframe)에서 연다 — 팝업일 때 opener 였던 툴바를 숨은 틀의 opener 로 잇는다.
// 기다리기는 페이지가 아니라 이 쪽(패널)이 한다: 크롬은 뒤 탭의 타이머를 늦추고(숨은 지 5분이 넘으면 1분에 한 번 — 2026-10-08 실측으로
// 결재선이 멈췄다), 페이지 함수는 한 번에 한 동작만 하고 곧바로 돌아온다. 포스트백·목록 받기 같은 네트워크는 늦춰지지 않는다.
//
// 원본(krs-web-agents ea_approval · ApprovalInPrinciple vendor/ea_writer)은 Playwright 의 진짜 클릭으로 팝업을 몰았다. 확장은 진짜 클릭이
// 없으니 그 팝업이 결국 부르는 페이지 함수를 부른다(같은 출처라 틀 안을 만질 수 있다).
//   · JOB-ID — 팝업(RnDPMS Get_PMSJobID.aspx)의 격자(캔버스) 더블클릭 대신, 그 격자가 받는 목록(ListJSON_Ver2.ashx)을 받아 과제명이 같은 줄을
//     고르고 팝업이 opener 에 부르는 callBackReturnFromDialog 를 부른다. 같은 줄이 없으면 고르지 않는다(원본은 첫 줄로 넘어가는 결함이 있었다).
//   · 본문 — <control>_SetHTMLBody(저장 뒤에도 남는 길)로 넣고 <control>_GetTextBody 로 다시 읽는다.
//   · 문서설정 — 툴바의 ShowSetupDocument 가 열 주소(DialogBoxReturn → DocumentSetting.aspx)를 숨은 틀로 열어 수신처는 SetReceiverValue('내부결재-,-내부결재')
//     (수신처 창의 '내부결재' 단추와 확인이 opener 에 부르는 것), 칸을 고른 뒤 __Page_FormSubmitCallback(2)(발송경고 창의 '예'가 부르는 것).
//     설정이 툴바의 SetupDocSetting 으로 돌아오면 됐다. 그 화면은 끝에 window.top.close() 를 부른다 — 공문 창이 닫히지 않게 그동안 막는다.
//   · 결재선 — ShowApplineWin 이 열 주소(ApprovalLineSettingBase → ApprovalLineSetting.aspx)를 숨은 틀로 열어 이름 검색(ibtnSearch) → 조직도 트리
//     (RadTreeView1)의 사람을 Telerik API 로 고르고 결재·합의·참조(btnAPP·btnAGR·btnREF) → 트리를 다시 읽어 맞으면 저장(ibtnAppLineSave).
//     결재선이 툴바의 CallBackApplineWinCallBack 으로 돌아오면 됐다. 맞지 않으면 저장하지 않고 닫는다 — 창에서 결재선을 넣으라고 적는다.
//     사람은 이름 검색(포스트백)으로 찾고, 고른 사람은 RadTreeView1_ClientState 의 selectedNodes 로 포스트백에 실린다(2026-10-09 새 창 실측 — 작성기 전체가 합의·참조까지 dry 로 여섯 단계 다 됨, 저장과 둘째 합의자의 추가/변경 창은 아직). 창을 오래 두면(하룻밤) 서버 쪽
//     문서 맥락이 사라져 기안자 줄이 이름 없이 '[]' 로, 조직도는 뿌리 한 줄로 뜬다(2026-10-09 실측 — 새로 연 창은 기안자와 조직도 195줄이 있다).
//     그런 창에는 넣지 않고 창을 닫고 다시 작성하라고 적는다.
// 임시저장(lbtnGianSave)·상신(lbtnGianReport)·미리보기(lbtnGianPreview — 안에서 저장한다)는 누르지 않는다. 확인하고 올리는 것은 사람이다.

const FRAME_WAIT_MS = 45000;
const STEP_MS = 60000;
const POLL_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 단계 — 화면의 작성 기록 차례다. */
export const STEPS = [
  { key: 'open', label: '새 공문 창' },
  { key: 'job', label: '과제(Job Id)' },
  { key: 'fields', label: '제목·차수' },
  { key: 'body', label: '본문' },
  { key: 'setting', label: '문서설정' },
  { key: 'line', label: '결재선(위임전결)' },
];

/* ------------------------------------------------------------ 페이지 안에서 도는 함수(MAIN world — 그대로 직렬화되니 바깥 이름을 쓰지 않는다) */

/** 프레임마다 — 본문 틀(칸 지도의 anchor 와 편집기 함수가 있는 곳)인가, 툴바인가, 성명 입력에 멈췄나. */
function pageProbe(anchor, control) {
  try {
    return {
      url: location.href,
      ready: document.readyState === 'complete',
      form: !!(anchor && document.querySelector(anchor)) && (!control || typeof window[`${control}_SetHTMLBody`] === 'function'),
      toolbar: typeof window.ShowSetupDocument === 'function' && typeof window.ShowApplineWin === 'function',
      login: /loginbyname/i.test(location.pathname) && !!document.querySelector('#txtUserName'),
      docId: (location.search.match(/[?&]DOCID=([^&]+)/i) || [])[1] || '',
    };
  } catch (e) {
    return null;
  }
}

/**
 * 과제 목록(R&D PMS)에서 이 과제를 찾는다. 번호가 RND-20-2026·RND00202026 꼴이면 번호로, 아니면 과제명(빈칸 무시)으로 같은 줄만.
 * 여럿이면 진행 중인 것, 그래도 여럿이면 고르지 않는다. picker 면 팝업이 하던 대로 callback 을 부르고 숨은 칸을 다시 읽는다.
 */
async function pageJob(spec) {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
  const q = new URLSearchParams({
    SYSTEMID: 'RD', SEARCHTYPE_P: 'true', SEARCHTYPE_N: 'true', SEARCHTYPE_J: '0', SEARCHTYPE_C: '0', SEARCHTEXT: '',
    DEPTID: '', FROMDATE: '', TODATE: '', PROJECT_CLASS: '', CONTRACTOR: '', IS_PROCESSING: 'true',
  });
  let rows = [];
  try {
    const r = await fetch(`${spec.list}?${q}`, { credentials: 'include' });
    let data = JSON.parse(await r.text());
    if (typeof data === 'string') data = JSON.parse(data);
    rows = Array.isArray(data) ? data : (data && data.Table) || [];
  } catch (e) {
    return { ok: false, why: '과제 목록(R&D PMS)을 받지 못했습니다' };
  }
  const byCode = /^rnd-?\d/i.test(String(spec.code || '').trim());
  let hits = byCode
    ? rows.filter((r) => [r.Project_ID_DASH, r.Project_ID].some((v) => norm(v) === norm(spec.code)))
    : rows.filter((r) => norm(r.Project_Name) === norm(spec.name));
  if (hits.length > 1) {
    const live = hits.filter((r) => r.Process === '진행');
    if (live.length) hits = live;
  }
  if (!hits.length) return { ok: false, why: `과제 목록에 '${spec.name}' 와 이름이 같은 과제가 없습니다 — 창의 Job Id. 검색으로 고르세요`, rows: rows.length };
  if (hits.length > 1) return { ok: false, why: `이름이 같은 과제가 ${hits.length}개입니다(${hits.map((r) => r.Project_ID_DASH).join(', ')}) — 창에서 고르세요` };
  const h = hits[0];
  const out = { ok: true, id: h.Project_ID, dash: h.Project_ID_DASH, name: h.Project_Name, turn: String(h.TURN || '') };
  if (spec.mode !== 'picker') return out;
  const fn = window[spec.callback];
  if (typeof fn !== 'function') return { ...out, ok: false, why: '이 양식에 과제 고르기 함수가 없습니다' };
  try {
    fn([h.Project_ID, h.Project_Name, h.FromDate_Contract, h.ToDate_Contract, h.DEPT_CODE, h.User_Name, h.User_ID].map((v) => (v == null ? '' : v)).join('|'));
  } catch (e) {
    return { ...out, ok: false, why: `과제를 넣지 못했습니다 (${e && e.message})` };
  }
  const hidden = document.querySelector(spec.hidden);
  return hidden && hidden.value === h.Project_ID ? out : { ...out, ok: false, why: '과제를 넣었는데 Job Id. 칸이 비어 있습니다' };
}

/** 글 칸을 채운다 — value 와 value 속성(양식의 검사가 속성을 읽는다)을 같이, 그리고 input·change. label 이 있으면 그 표시줄 글도. */
function pageFill(list) {
  return list.map((f) => {
    const el = document.querySelector(f.selector);
    if (!el) return { key: f.key, ok: false, why: '칸이 없습니다' };
    const v = String(f.value == null ? '' : f.value).slice(0, f.max || 10000);
    el.value = v;
    if (el.tagName === 'INPUT') el.setAttribute('value', v);
    for (const type of ['input', 'change']) el.dispatchEvent(new Event(type, { bubbles: true }));
    const label = f.label && document.querySelector(f.label);
    if (label) label.textContent = v;
    return { key: f.key, ok: el.value === v, value: el.value };
  });
}

/** 본문 — 편집기 함수가 있으면 넣고(check 면 넣지 않고) 글로 다시 읽어 앞부분이 들어갔는지 본다. 편집기가 덜 떴으면 ready: false. */
function pageBody(spec) {
  const squash = (s) => String(s == null ? '' : s).replace(/\s+/g, '');
  const set = window[`${spec.control}_SetHTMLBody`];
  const get = window[`${spec.control}_GetTextBody`];
  if (typeof set !== 'function' || typeof get !== 'function') return { ready: false, ok: false };
  const want = squash(spec.text).slice(0, 40);
  try { if (!spec.check) set(spec.html); } catch (e) { return { ready: false, ok: false }; }
  let got = '';
  try { got = String(get() || ''); } catch (e) { got = ''; }
  return { ready: true, ok: !!want && squash(got).includes(want), length: got.length };
}

/**
 * 문서설정·결재선 — 툴바 프레임에서 한 동작씩. 화면은 이 툴바 문서 안의 숨은 틀이다(팝업 창 대신 — 사용자 앞에 창이 뜨지 않는다).
 * 차례(패널이 부른다): setting:open → setting:ready(될 때까지) → setting:fill → setting:confirm → setting:done(될 때까지), 아니면 setting:close.
 * line:open → line:ready → (line:search → line:ready → line:pick → line:anchor? → line:press → line:ready → line:pup?)… → line:tree → line:save → line:done.
 */
function pageDialog(op, arg) {
  const S = window.__krsws || (window.__krsws = { said: [] });
  const ID = 'ctl00_ContentPlaceHolder1_';
  const frameFor = (owner, url, key) => {
    const d = owner.document;
    const f = d.createElement('iframe');
    f.setAttribute('data-krsws', key);
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;left:-12000px;top:0;width:1000px;height:760px;border:0;visibility:hidden';
    f.src = url;
    (d.body || d.documentElement).appendChild(f);
    return f;
  };
  // 알림은 받아 적고(뒤 탭의 alert 는 그 창의 스크립트를 세운다), 확인은 예, 창 열기는 숨은 틀로.
  const quiet = (w, key) => {
    try {
      if (!w || w.__krswsQuiet) return;
      w.__krswsQuiet = true;
      w.alert = (m) => { S.said.push(String(m)); };
      w.confirm = (m) => { S.said.push(String(m)); return true; };
      w.open = (url) => { const f = frameFor(w, url, `${key}-pup`); return f.contentWindow; };
    } catch (e) { /* 다른 문서로 바뀌는 중 */ }
  };
  // 숨은 틀의 창 — 팝업이었다면 opener 는 이 툴바다. 열린 화면이 opener 의 함수를 부르므로 잇는다.
  const adopt = (f, key) => {
    const w = f && f.contentWindow;
    if (!w) return null;
    try { if (w.opener !== window) w.opener = window; } catch (e) { /* 덜 뜬 틀 */ }
    quiet(w, key);
    return w;
  };
  // 화면이 떴는가 — readyState 가 complete 가 되기를 기다리지 않는다. 결재선 화면은 닫기 그림을 사내 주소(intra.realweb21.com)에서 받는데 그것이
  // 끝나지 않아 몇 분이고 interactive 에 머문다(2026-10-09 실측). 스크립트(Sys.Application·Telerik 객체)는 interactive 때 이미 다 섰다.
  const inner = (w, test) => {
    if (!w) return null;
    const wins = [w];
    try { for (let i = 0; i < w.frames.length; i++) wins.push(w.frames[i]); } catch (e) { /* 덜 뜬 틀 */ }
    return wins.find((x) => { try { return x.document.readyState !== 'loading' && !!test(x); } catch (e) { return false; } }) || null;
  };
  const capture = (fn) => {
    let url = '';
    const open = window.open;
    window.open = (u) => { url = String(u || ''); return null; };
    try { fn(); } catch (e) { /* ShowApplineWin 은 창 대신 null 을 받고 뒤에서 예외를 삼킨다 */ } finally { window.open = open; }
    return url;
  };
  const frameOf = (key) => document.querySelector(`iframe[data-krsws="${key}"]`);
  const settingWin = () => {
    const x = inner(adopt(frameOf('setting'), 'setting'), (y) => y.document.getElementById(`${ID}ddlSavePeriod`)
      && typeof y.SetReceiverValue === 'function' && typeof y.$find === 'function' && y.$find(`${ID}rlbReceiver`));
    if (x) quiet(x, 'setting');
    return x;
  };
  const lineWin = () => {
    const x = inner(adopt(frameOf('line'), 'line'), (y) => y.document.getElementById('txtName') && typeof y.$find === 'function'
      && y.$find('RadTreeView1') && y.$find('RadTreeView2'));
    if (x) quiet(x, 'line');
    return x;
  };
  const text = (x) => { try { return (x.document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160); } catch (e) { return ''; } };
  const lastSaid = () => S.said[S.said.length - 1] || '';
  // 끝낼 때 — 숨은 틀을 치우고 잠시 바꿔 둔 것(툴바의 콜백·공문 창의 close)을 되돌린다.
  const restore = (key) => {
    const r = S.restore && S.restore[key];
    if (r) { try { r(); } catch (e) { /* 이미 되돌림 */ } delete S.restore[key]; }
    const f = frameOf(key);
    if (f) f.remove();
  };
  const hook = (key, name, flag) => {
    S.restore = S.restore || {};
    const prev = window[name];
    S[flag] = false;
    window[name] = function (...a) { S[flag] = true; try { return typeof prev === 'function' ? prev.apply(this, a) : undefined; } catch (e) { return undefined; } };
    let top = null;
    try { top = window.top; top.close = () => { S.topClose = true; }; } catch (e) { top = null; }
    S.restore[key] = () => { window[name] = prev; try { if (top) delete top.close; } catch (e) { /* 그대로 */ } };
  };
  const matches = (t, name) => { const s = String(t || '').trim(); return s === name || (s.startsWith(name) && ' ([/·,'.includes(s[name.length])); };
  // 포스트백은 클릭 이벤트 안에서 부른다 — ASP.NET AJAX(PageRequestManager._doPostBack)는 window.event 가 없으면 호출 사슬을 거슬러
  // arguments.caller 를 읽는데, 사슬에 엄격 모드·화살표 함수가 있으면 예외로 멈춘다(2026-10-08 실측). 진짜 단추가 있으면 그것을 누르고,
  // 함수만 부르는 곳은 그 자리 옆에 숨은 단추를 잠깐 세워 onclick 으로 부른다(가까운 UpdatePanel 안이라 비동기 포스트백도 그대로다).
  const press = (x, id) => {
    const el = x.document.getElementById(id);
    if (!el) return false;
    // 결재선 화면은 단추(.appSettingBtn)의 mousedown 에서 조직도·결재선 트리의 클라이언트 상태를 저장한다(scrollConvertInt → updateClientState).
    // click() 만으로는 mousedown 이 없으니 먼저 보낸다 — 고른 사람이 포스트백에 실리는 길이다.
    try { el.dispatchEvent(new x.MouseEvent('mousedown', { bubbles: true })); el.dispatchEvent(new x.MouseEvent('mouseup', { bubbles: true })); } catch (e) { /* 이벤트를 못 만들면 click 만 */ }
    el.click();
    return true;
  };
  const fire = (x, nearId, code) => {
    const near = x.document.getElementById(nearId);
    const b = x.document.createElement('button');
    b.type = 'button';
    b.style.display = 'none';
    b.setAttribute('onclick', `${code}; return false;`);
    ((near && near.parentNode) || x.document.body).appendChild(b);
    b.click();
    b.remove();
  };

  switch (op) {
    case 'setting:open': {
      restore('setting');
      const url = capture(() => window.ShowSetupDocument());
      if (!url) return { ok: false, why: '문서설정 화면 주소를 얻지 못했습니다' };
      frameFor(window, url, 'setting');
      return { ok: true };
    }
    case 'setting:ready':
      return { ready: !!settingWin() };
    case 'setting:fill': {
      const x = settingWin();
      if (!x) return { ok: false, why: '문서설정 화면이 없습니다' };
      const s = arg || {};
      const d = x.document;
      const el = (id) => d.getElementById(ID + id);
      const errors = [];
      const choose = (id, value, label) => {
        const sel = el(id);
        if (!sel) return errors.push(`${label} 칸이 없습니다`);
        if (![...sel.options].some((o) => o.value === value)) return errors.push(`${label} ${value} 가 선택지에 없습니다`);
        sel.value = value;
        sel.dispatchEvent(new x.Event('change', { bubbles: true }));
        return true;
      };
      if (s.receiver) x.SetReceiverValue(`${s.receiver}-,-${s.receiver}`);
      choose('ddlSavePeriod', s.retention, '보존년한');
      if (s.docNo) choose('ddlDocNo', s.docNo, 'Doc No.(문서번호 부서)');
      else errors.push('문서번호 부서 코드가 없습니다(공문 설정)');
      const radio = [...d.querySelectorAll('input[name="ctl00$ContentPlaceHolder1$rblSafeDegree"]')].find((r) => r.value === s.scopeCode);
      if (radio) radio.checked = true;
      else errors.push(`공개범위 ${s.scope} 가 없습니다`);
      for (const [id, on] of [['chkEmergency', s.emergency], ['chkApprovingOpen', s.approvingOpen], ['chkDRM', s.drm]]) if (el(id)) el(id).checked = !!on;
      if (el('txtTag')) el('txtTag').value = s.tag || '';
      const picked = { receiver: (el('hfReceiversText') || {}).value || '', retention: (el('ddlSavePeriod') || {}).value, docNo: (el('ddlDocNo') || {}).value };
      return errors.length ? { ok: false, why: errors.join(' · '), picked } : { ok: true, picked };
    }
    case 'setting:confirm': {
      const x = settingWin();
      if (!x) return { ok: false, why: '문서설정 화면이 없습니다' };
      hook('setting', 'SetupDocSetting', 'settingDone');
      fire(x, `${ID}lbtnConfirm`, typeof x.__Page_FormSubmitCallback === 'function' ? '__Page_FormSubmitCallback(2)' : "__doPostBack('ctl00$ContentPlaceHolder1$lbtnConfirm', '')");
      return { ok: true };
    }
    case 'setting:done': {
      if (!S.settingDone) return { done: false, msg: lastSaid() || text(settingWin() || {}) };
      restore('setting');
      return { done: true };
    }
    case 'setting:close':
      restore('setting');
      return { ok: true };

    case 'line:open': {
      restore('line');
      S.team = String((arg && arg.team) || '').trim();
      const url = capture(() => window.ShowApplineWin());
      if (!url) return { ok: false, why: '결재선 화면 주소를 얻지 못했습니다' };
      frameFor(window, url, 'line');
      return { ok: true };
    }
    case 'line:ready': {
      const x = lineWin();
      const prm = x && x.Sys && x.Sys.WebForms && x.Sys.WebForms.PageRequestManager && x.Sys.WebForms.PageRequestManager.getInstance();
      let state = '';
      try { const f = frameOf('line'); state = f && f.contentWindow ? `${f.contentWindow.document.readyState}/${f.contentWindow.frames[0] ? f.contentWindow.frames[0].document.readyState : '-'}` : '틀 없음'; } catch (e) { state = '?'; }
      let drafter = '';
      try { const n = x && x.$find('RadTreeView2').get_nodes().getNode(0); drafter = n ? String(n.get_text() || '').trim() : ''; } catch (e) { drafter = ''; }
      return { ready: !!x && (!prm || !prm.get_isInAsyncPostBack()), state, drafter, msg: x ? ((x.document.getElementById('lblMsg') || {}).innerText || '') : '', said: lastSaid() };
    }
    case 'line:search': {
      const x = lineWin();
      if (!x) return { ok: false, why: '결재선 화면이 없습니다' };
      x.document.getElementById('txtName').value = arg;
      if (!press(x, 'ibtnSearch')) return { ok: false, why: '검색 단추가 없습니다' };
      return { ok: true };
    }
    case 'line:pick': {
      const x = lineWin();
      if (!x) return { ok: false, why: '결재선 화면이 없습니다' };
      let hits = x.$find('RadTreeView1').get_allNodes().filter((n) => matches(n.get_text(), arg));
      if (hits.length > 1 && S.team) {
        const team = (t) => ((String(t || '').match(/\[([^\]]*)\]\s*$/) || [])[1] || '').trim();
        const mine = hits.filter((n) => team(n.get_text()) === S.team);
        if (mine.length === 1) hits = mine;
      }
      if (hits.length !== 1) {
        return { ok: false, why: hits.length ? `${arg} — 조직도에 ${hits.length}명(${hits.map((n) => n.get_text()).join(', ')})` : `${arg} — 조직도에서 찾지 못했습니다` };
      }
      const tree = x.$find('RadTreeView1');
      hits[0].select();
      // 서버가 읽는 것은 RadTreeView1_ClientState 의 selectedNodes 다(2026-10-09 실측 — 처음은 모두 빈 배열). 저장해 두고 들었는지 본다.
      try { tree.updateClientState(); } catch (e) { /* 그대로 */ }
      let picked = false;
      try { picked = (JSON.parse((x.document.getElementById('RadTreeView1_ClientState') || {}).value || '{}').selectedNodes || []).length > 0; } catch (e) { picked = false; }
      if (!picked) return { ok: false, why: `${arg} — 조직도에서 골랐는데 선택이 저장되지 않았습니다` };
      return { ok: true, text: hits[0].get_text() };
    }
    case 'line:anchor': {
      // 합의는 기안자 줄(맨 앞 — 시스템이 세운 담당)에 단다: 기안 → 합의 → 결재(2026-10-07 사용자 지정, ApprovalInPrinciple 의 kind: 작성자).
      // 결재선 트리는 누르면 포스트백하는 트리(_postBackOnClick)라 select() 가 곧 포스트백이다 — 스크립트에서 바로 부르면 ASP.NET AJAX 가 호출 사슬을
      // 읽다 엄격 모드 예외로 멈춘다(2026-10-09 실측). 숨은 단추의 onclick 안(window.event 가 있음)에서 부르고, 패널은 포스트백이 끝나기를 기다린다.
      const x = lineWin();
      if (!x) return { ok: false, why: '결재선 화면이 없습니다' };
      const n = x.$find('RadTreeView2').get_nodes().getNode(0);
      if (!n) return { ok: false, why: '결재선에 기안자 줄이 없습니다' };
      fire(x, 'RadTreeView2', "$find('RadTreeView2').get_nodes().getNode(0).select()");
      return { ok: true, text: n.get_text() };
    }
    case 'line:press': {
      const x = lineWin();
      if (!x) return { ok: false, why: '결재선 화면이 없습니다' };
      if (!press(x, arg)) return { ok: false, why: `${arg} 단추가 없습니다` };
      return { ok: true };
    }
    case 'line:pup': {
      // 둘째 합의부터 '합의자를 추가/변경 하시겠습니까?' 화면이 뜬다 — 추가(ImageButton1). 변경은 앞 합의자를 바꾼다.
      const x = lineWin();
      const pf = x && [...x.document.querySelectorAll('iframe[data-krsws="line-pup"]')].pop();
      if (!pf) return { pup: false };
      const pw = pf.contentWindow;
      try {
        if (pw.document.readyState !== 'complete' || !pw.document.getElementById('ImageButton1')) return { pup: true, ready: false };
        if (pw.opener !== x) pw.opener = x;
        quiet(pw, 'line');
        pw.document.getElementById('ImageButton1').click();
      } catch (e) { return { pup: true, ready: false }; }
      setTimeout(() => pf.remove(), 3000);
      return { pup: true, clicked: true };
    }
    case 'line:tree': {
      const x = lineWin();
      if (!x) return { line: [], refs: [] };
      const classify = (imgs) => {
        const n = imgs.map((s) => s.toLowerCase());
        if (n.some((s) => s === 'ref.gif')) return '참조';
        if (n.some((s) => /^app\d+\.gif$/.test(s))) return '결재';
        if (n.some((s) => s === 'conmc.gif' || s === 'rconmc.gif')) return '합의';
        return '?';
      };
      const read = (id) => [...x.document.querySelectorAll(`#${id} li.rtLI`)].map((li, i) => {
        const sp = li.querySelector('span.rtIn');
        const own = [...li.querySelectorAll(':scope > div img')].map((im) => (im.src || '').split('/').pop());
        const role = classify(own.length ? own : [...li.querySelectorAll('img')].map((im) => (im.src || '').split('/').pop()));
        return { name: sp ? sp.textContent.trim() : '', role: id === 'RadTreeView2' && i === 0 && role === '결재' ? '기안' : role };
      });
      return { line: read('RadTreeView2'), refs: read('treREF') };
    }
    case 'line:save': {
      const x = lineWin();
      if (!x) return { ok: false, why: '결재선 화면이 없습니다' };
      hook('line', 'CallBackApplineWinCallBack', 'lineDone');
      if (!press(x, 'ibtnAppLineSave')) return { ok: false, why: '저장 단추가 없습니다' };
      return { ok: true };
    }
    case 'line:done': {
      if (!S.lineDone) {
        const x = lineWin();
        return { done: false, msg: lastSaid() || (x ? (x.document.getElementById('lblMsg') || {}).innerText || '' : '') };
      }
      restore('line');
      return { done: true };
    }
    case 'line:close':
      restore('line');
      return { ok: true };
    default:
      return { ok: false, why: `모르는 동작 ${op}` };
  }
}

/** 테스트와 실제 브라우저 검사가 같은 함수를 쓰도록 내놓는다. */
export const injected = { pageProbe, pageJob, pageFill, pageBody, pageDialog };

/* ------------------------------------------------------------ 패널 쪽 */

/** 차수 — 과제 목록의 TURN('1 / 0' — 지금 차수 / 전체)의 앞 수. */
export const turnDegree = (turn) => {
  const n = parseInt(String(turn || '').split('/')[0], 10);
  return n > 0 ? String(n) : '';
};

/**
 * 공문을 쓴다. 새 공문 창을 뒤 탭으로 열고, 레시피의 칸 지도대로 차례로 넣는다. 한 단계가 안 돼도 다음 단계는 해 본다(본문이 안 들어가도
 * 결재선은 넣을 수 있다) — 무엇이 됐고 무엇이 안 됐는지를 단계마다 돌려준다. 칸 지도가 없는 양식은 창만 연다.
 * dry 면 문서설정·결재선은 넣어 보고 다시 읽기만 하고 확인·저장하지 않는다(원본 러너의 --dry). 창의 다른 칸은 넣는다(저장은 안 된 채).
 * @param {object} plan src/gongmun.js 의 writePlan
 * @param {{onStep?: (step: {key:string, label:string, ok:boolean|null, detail:string}) => void, api?: object, dry?: boolean, tabId?: number}} [opts]
 *   tabId 를 주면 새 창을 열지 않고 그 탭(이미 열린 새 공문 창)에 쓴다 — 실제 브라우저 검사용.
 * @returns {Promise<{tabId:number|null, docId:string, steps: object[]}>}
 */
export async function writeGongmun(plan, { onStep = () => {}, api = globalThis.chrome, dry = false, tabId: given = null } = {}) {
  const steps = [];
  const label = (key) => STEPS.find((s) => s.key === key)?.label || key;
  const report = (key, ok, detail = '') => {
    const step = { key, label: label(key), ok, detail };
    const i = steps.findIndex((s) => s.key === key);
    if (i >= 0) steps[i] = step; else steps.push(step);
    onStep(step);
    return step;
  };
  // 창에 뜬 알림(alert)은 그 창의 스크립트를 멈춰 세운다 — 마냥 기다리지 않게 부를 때마다 시간을 건다. 끝나면 타이머를 치운다.
  const run = async (tabId, frameId, func, args, ms = STEP_MS) => {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('창이 답하지 않습니다 — 공문 창에 뜬 알림을 닫았는지 보세요')), ms); });
    try {
      return (await Promise.race([api.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'MAIN', func, args }), late]))?.[0]?.result;
    } finally {
      clearTimeout(timer);
    }
  };

  report('open', null, '뒤에서 여는 중…');
  let tabId = given;
  if (tabId == null) {
    const tab = await api.tabs.create({ url: plan.url, active: false });
    tabId = tab?.id ?? null;
  }
  if (tabId == null) return { tabId, docId: '', steps: [report('open', false, '창을 열지 못했습니다')] };
  if (!plan.known) {
    report('open', true, `칸 지도가 없는 양식(${plan.form})이라 창만 열었습니다`);
    return { tabId, docId: '', steps };
  }

  // 본문 틀과 툴바가 다 뜰 때까지 — 두 번 잇달아 보여야 뜬 것이다(편집기가 늦게 붙는다).
  const control = plan.fields.body?.control || '';
  let form = null;
  let toolbar = null;
  let docId = '';
  let steady = 0;
  let loginSince = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < FRAME_WAIT_MS) {
    await sleep(600);
    const all = await api.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: pageProbe, args: [plan.anchor, control] }).catch(() => []);
    const hit = (all || []).filter((r) => r?.result);
    const f = hit.find((r) => r.result.form && r.result.ready);
    const tb = hit.find((r) => r.result.toolbar && r.result.ready);
    if (hit.some((r) => r.result.login)) {
      loginSince ||= Date.now();
      if (Date.now() - loginSince > 8000) return { tabId, docId: '', steps: [report('open', false, '전자결재가 성명을 묻고 멈췄습니다 — 창에서 성명을 넣고 들어간 뒤 다시 누르세요')] };
    } else loginSince = 0;
    steady = f && tb ? steady + 1 : 0;
    if (steady >= 2) {
      form = f.frameId;
      toolbar = tb.frameId;
      docId = f.result.docId || '';
      break;
    }
  }
  if (form == null) return { tabId, docId: '', steps: [report('open', false, '새 공문 창이 다 뜨지 않았습니다 — 창을 확인하고 다시 누르세요')] };
  report('open', true, docId ? `문서 ${docId}` : '');

  const v = plan.values;
  const fields = Object.entries(plan.fields).map(([key, f]) => ({ key, ...f }));
  const guard = async (key, fn) => {
    try { return await fn(); } catch (err) { report(key, false, err.message); return null; }
  };
  /** 페이지 함수를 되물어 test 가 맞을 때까지 — 기다림은 이 쪽 타이머라 뒤 탭이 늦춰져도 그대로다. */
  const until = async (call, test, ms) => {
    const t1 = Date.now();
    let last = null;
    while (Date.now() - t1 < ms) {
      last = await call().catch(() => null);
      if (last && test(last)) return last;
      await sleep(POLL_MS);
    }
    return { ...(last || {}), timeout: true };
  };
  const dialog = (op, arg = null) => run(tabId, toolbar, pageDialog, [op, arg], 20000);
  /** 예외로 끝나도 숨은 틀과 잠시 바꿔 둔 것을 치운다. */
  const tidy = async (key, fn) => {
    try { return await fn(); } catch (err) { await dialog(`${key}:close`).catch(() => {}); throw err; }
  };

  // 과제(JOB-ID) — 연구업무추진품의는 고르기(picker), 기안문은 글 칸(과제 번호).
  let job = null;
  const jobField = fields.find((f) => f.source === 'job' || f.source === 'jobText');
  if (jobField && (v.job.name || v.job.code)) {
    report('job', null, '과제 목록에서 찾는 중…');
    job = await guard('job', () => run(tabId, form, pageJob, [{
      mode: jobField.kind, list: jobField.list || '/RnDPMS/View/PMS/ListJSON_Ver2.ashx', callback: jobField.callback, hidden: jobField.hidden, name: v.job.name, code: v.job.code,
    }]));
    if (job && jobField.kind === 'picker') report('job', !!job.ok, job.ok ? `${job.dash} · ${job.name}` : job.why);
  } else if (jobField) report('job', false, '고른 과제가 없습니다');

  // 제목·수신·참조·차수(+ 기안문의 Job Id. 글 칸)
  const value = (f) => {
    if (f.source === 'degree') return v.degree || turnDegree(job?.turn);
    if (f.source === 'jobText') return job?.ok ? job.dash : '';
    return v[f.source] ?? '';
  };
  const texts = fields.filter((f) => f.kind === 'title' || f.kind === 'text')
    .map((f) => ({ key: f.key, selector: f.selector, label: f.label, max: f.max, value: value(f), source: f.source }))
    .filter((f) => f.source === 'title' || String(f.value).trim());
  const filled = await guard('fields', () => run(tabId, form, pageFill, [texts]));
  if (filled) {
    const bad = filled.filter((r) => !r.ok);
    const deg = texts.find((f) => f.source === 'degree');
    report('fields', !bad.length, bad.length ? bad.map((r) => `${r.key} ${r.why || '들어가지 않음'}`).join(' · ') : `제목${deg ? ` · 차수 ${deg.value}` : ''}`);
  }
  if (jobField?.kind === 'text') report('job', !!job?.ok && !!filled?.find((r) => r.key === jobField.key)?.ok, job?.ok ? `${job.dash} (글 칸)` : job?.why || '');

  // 본문 — 편집기가 늦게 붙으면 붙을 때까지.
  const putBody = (check) => until(() => run(tabId, form, pageBody, [{ control, html: v.html, text: v.body, check }]), (r) => r.ready, 15000);
  if (plan.fields.body) {
    report('body', null, '넣는 중…');
    const body = await guard('body', () => putBody(false));
    if (body) report('body', !!body.ok, body.ok ? `${body.length}자` : '본문 편집기가 글을 받지 않았습니다');
  }

  // 문서설정 — 공문 창 안의 숨은 틀에서.
  report('setting', null, '문서설정 넣는 중…');
  const setting = await guard('setting', () => tidy('setting', async () => {
    const opened = await dialog('setting:open');
    if (!opened?.ok) return opened || { ok: false, why: '문서설정을 열지 못했습니다' };
    if (!(await until(() => dialog('setting:ready'), (r) => r.ready, 30000)).ready) {
      await dialog('setting:close');
      return { ok: false, why: '문서설정 화면이 뜨지 않았습니다 — 창의 문서설정에서 넣어 주세요' };
    }
    const fill = await dialog('setting:fill', plan.setting);
    if (!fill?.ok || dry) {
      // 틀린 것이 하나라도 있으면 확인하지 않는다 — 반쯤 맞는 설정을 서버에 남기지 않는다(ApprovalInPrinciple docsetting.py 와 같다).
      await dialog('setting:close');
      return fill?.ok ? { ok: true, dry: true, ...fill.picked } : { ok: false, why: `${fill?.why || '문서설정을 넣지 못했습니다'} — 창의 문서설정에서 넣어 주세요` };
    }
    await dialog('setting:confirm');
    const done = await until(() => dialog('setting:done'), (r) => r.done, 25000);
    if (!done.done) {
      await dialog('setting:close');
      return { ok: false, why: `문서설정이 확인되지 않았습니다${done.msg ? ` (${done.msg})` : ''} — 창의 문서설정을 확인하세요` };
    }
    return { ok: true, ...fill.picked };
  }));
  if (setting) {
    report('setting', !!setting.ok, setting.ok
      ? `${setting.dry ? '시험 — 확인 안 함 · ' : ''}보존 ${plan.setting.retentionText} · Doc No. ${setting.docNo} · 수신 ${setting.receiver || '없음'}` : setting.why);
  }

  // 결재선 — 부서장부터 전결권자까지 결재, 과제책임자 합의, 참조.
  const ln = plan.line;
  if (ln.missing?.length) report('line', false, `${ln.missing.join('·')} 이름이 공문 설정에 없습니다 — 결재선은 넣지 않았습니다`);
  else if (!ln.approvers.length) report('line', false, '결재자가 없습니다(공문 설정의 부서장)');
  else {
    report('line', null, '결재선 넣는 중…');
    const done = await guard('line', () => tidy('line', async () => {
      const opened = await dialog('line:open', { team: ln.team || '' });
      if (!opened?.ok) return opened || { ok: false, why: '결재선을 열지 못했습니다' };
      const idle = () => until(() => dialog('line:ready'), (r) => r.ready, 25000);
      const first = await idle();
      if (!first.ready) {
        await dialog('line:close');
        return { ok: false, why: '결재선 화면이 뜨지 않았습니다 — 창의 결재선에서 넣어 주세요' };
      }
      // 기안자 줄이 이름 없이 '[]' 면 창이 오래돼 서버 쪽 문서 맥락이 사라진 것이다(2026-10-09 실측 — 조직도도 뿌리 한 줄뿐). 넣지 않는다.
      if (!first.drafter || /^\[\s*\]$/.test(first.drafter)) {
        await dialog('line:close');
        return { ok: false, why: '결재선 화면에 기안자가 없습니다(창이 오래됐거나 로그인이 바뀜) — 창을 닫고 다시 작성하세요' };
      }
      const errors = [];
      const pick = async (name) => {
        await dialog('line:search', name);
        await sleep(300);
        await idle();
        const got = await dialog('line:pick', name);
        if (!got?.ok) errors.push(got?.why || `${name} — 고르지 못했습니다`);
        return !!got?.ok;
      };
      const press = async (button) => {
        await dialog('line:press', button);
        await sleep(300);
        return idle();
      };
      // 기안자 줄 고르기도 포스트백이다 — 끝나기 전에 합의 단추를 누르면 앞 요청이 끊긴다.
      const anchor = async () => {
        const got = await dialog('line:anchor');
        if (!got?.ok) errors.push(got?.why || '기안자 줄을 고르지 못했습니다');
        await sleep(300);
        await idle();
        return !!got?.ok;
      };
      for (const name of ln.approvers) if (await pick(name)) await press('btnAPP');
      for (const name of ln.agree) {
        if (!(await pick(name))) continue;
        if (!(await anchor())) continue;
        await press('btnAGR');
        await until(() => dialog('line:pup'), (r) => !r.pup || r.clicked, 4000);
        await idle();
      }
      for (const name of ln.refs) if (await pick(name)) await press('btnREF');
      const now = await dialog('line:tree');
      const has = (list, name, role) => (list || []).some((x) => (x.name === name || (x.name.startsWith(name) && ' ([/·,'.includes(x.name[name.length]))) && x.role === role);
      for (const name of ln.approvers) if (!has(now?.line, name, '결재')) errors.push(`${name} 결재가 결재선에 없습니다`);
      for (const name of ln.agree) if (!has(now?.line, name, '합의')) errors.push(`${name} 합의가 결재선에 없습니다`);
      for (const name of ln.refs) if (!has(now?.refs, name, '참조')) errors.push(`${name} 참조가 결재선에 없습니다`);
      const shown = (now?.line || []).map((x) => `${x.role} ${x.name}`).concat((now?.refs || []).map((x) => `참조 ${x.name}`));
      if (errors.length || dry) {
        const last = await dialog('line:ready');
        await dialog('line:close');
        return errors.length
          ? { ok: false, why: `${[...new Set(errors)].join(' · ')}${last?.msg || last?.said ? ` (${last.msg || last.said})` : ''} — 저장하지 않았습니다. 창의 결재선에서 넣어 주세요${shown.length ? ` (지금: ${shown.join(' → ')})` : ''}`, shown }
          : { ok: true, dry: true, shown };
      }
      await dialog('line:save');
      const saved = await until(() => dialog('line:done'), (r) => r.done, 25000);
      if (!saved.done) {
        await dialog('line:close');
        return { ok: false, why: `결재선이 저장되지 않았습니다${saved.msg ? ` (${saved.msg})` : ''} — 창의 결재선을 확인하세요`, shown };
      }
      return { ok: true, shown };
    }));
    if (done) report('line', !!done.ok, done.ok ? `${done.dry ? '시험 — 저장 안 함 · ' : ''}전결 ${ln.rank} · ${done.shown.join(' → ')}` : done.why);
  }

  // 화면을 오간 뒤 본문이 살아 있는지 — 사라졌으면 한 번 다시 넣는다(ApprovalInPrinciple 의 reverify_planned).
  if (plan.fields.body && steps.find((s) => s.key === 'body')?.ok) {
    const still = await run(tabId, form, pageBody, [{ control, text: v.body, check: true }]).catch(() => null);
    if (still && still.ready && !still.ok) {
      const again = await putBody(false).catch(() => null);
      report('body', !!again?.ok, again?.ok ? '화면을 오간 뒤 사라져 다시 넣었습니다' : '화면을 오간 뒤 본문이 사라졌습니다 — 창에서 확인하세요');
    }
  }
  return { tabId, docId, steps };
}

/** 작성한 공문 창을 앞으로 — 작성 기록의 '창 보기'. 닫혔으면 false. */
export async function showTab(tabId, api = globalThis.chrome) {
  try {
    const tab = await api.tabs.update(tabId, { active: true });
    if (tab?.windowId != null) await api.windows?.update?.(tab.windowId, { focused: true });
    return true;
  } catch {
    return false;
  }
}
