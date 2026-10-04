// 신청 내역 출장 카드의 "증빙 송부" 칸 — 보관함의 증빙을 PDF 하나로 묶어 담당자에게 보낸다(2026-10-03 사용자 지정).
// 언제 보낼 수 있는지·무슨 글인지는 src/send.js, 묶는 일은 src/pdf.js, 보내는 길은 src/teams.js(Teams MCP)·src/memo.js(쪽지)다.
// 여기는 그것들을 카드에 잇기만 한다. 카드를 그리고 누름을 넘겨 주는 것은 attendpanel.js 다.
//
// 보내기를 누르면 **보낼 내용이 팝업으로 뜬다**(2026-10-04 사용자 지정) — 누구에게 무슨 글이 가는지 그대로 보이고, 팝업의 보내기를
// 눌러야 나간다. 글 칸을 치는 동안에는 카드를 새로 그리지 않는다(커서가 날아간다) — 버튼만 그 자리에서 고친다.
//
// 과제·계정과 받는 사람은 **한 세트로 기억한다**(2026-10-04 사용자 지정 — 보통 같은 과제는 같은 사람에게 간다). 보낸 세트를
// 다섯까지 기억해 칩으로 보이고, 칩 하나가 둘을 함께 채운다. 가장 최근 세트는 카드를 펴면 미리 채워져 있다.
//
// 숙박·비행기가 있는 출장인데 사후정산을 아직 완료하지 않았으면(2026-10-03 사용자 지정) 버튼이 둘이다 — `사후정산 저장`은 카드에
// 있는 대로 저장만 하고, `보내기`는 저장 → 확정 → 송부를 잇는다. 저장과 확정은 attendpanel.js 가 한다(ctx.save·ctx.confirm).
// `사후정산 저장`은 실제 계산서를 바꾸는 누름이라 두 번 눌러야 나간다(confirmOf — 첫 누름에는 무엇을 할지만 적어 보여 준다).
// `보내기`는 팝업이 그 확인을 맡는다 — 저장·확정부터 한다는 것도 팝업에 적힌다.

import { sendGate, channelOf, pushRecent, pdfName, sendTitle, sendLines, evidenceCount, SETTLED_LABEL, RECENT_MAX } from './src/send.js';
import { buildPdf } from './src/pdf.js';
import { memoSuggest, memoSend, memoHtml } from './src/memo.js';
import { teamsState, teamsSendFile } from './src/teams.js';
import { EVIDENCE_ACCEPT, acceptsFile } from './src/attend.js';
import { MAIL_DOMAIN } from './src/config.js';

const FILE_LIMIT = 10 * 1024 * 1024;
const SUGGEST_WAIT_MS = 250;
const HITS_MAX = 8;
/** 보낸 기록을 몇 건까지 남기는가(출장 한 건에 하나). */
const DONE_MAX = 60;
const SAVE_TITLE = '사후정산을 카드에 있는 대로 저장합니다 — 바꾼 가는 편·오는 편이 교통비 내역으로 올라가고, 확정은 하지 않습니다';
const GO_TITLE = '사후정산을 저장하고 확정(완료)한 뒤에 증빙을 보냅니다';
const SET_TITLE = '과제·계정과 받는 사람을 함께 채웁니다';
const stamp = (at) => { const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const personText = (p) => [`${p.name || p.id}${p.title ? ` ${p.title}` : ''}`, p.dept].filter(Boolean).join(' · ');
/** 세트 하나(과제·계정 + 받는 사람)의 열쇠와 칩에 적는 글. */
const setKey = (x) => `${x.account}|${x.person.id}`;
const setText = (x) => `${x.account} · ${x.person.name || x.person.id}`;

/**
 * 세트로 기억하기 전(과제·계정과 받는 사람을 따로 기억하던 때)의 기록에서 세트를 짓는다 — 보낸 기록마다 그때의 과제·계정과
 * 받는 사람을 짝짓는다. 받는 사람을 최근 목록에서 찾지 못한 기록은 버린다.
 */
function setsFromOld(saved) {
  const people = (Array.isArray(saved?.sendPeople) ? saved.sendPeople : []).filter((p) => p?.id);
  const sent = Object.values(saved?.sendDone && typeof saved.sendDone === 'object' ? saved.sendDone : {}).sort((a, b) => a.at - b.at);
  let sets = [];
  for (const d of sent) {
    const person = people.find((p) => (p.name || p.id) === d.to);
    if (d.account && person) sets = pushRecent(sets, { account: d.account, person }, setKey);
  }
  return sets;
}

/**
 * @param {{escapeHtml:Function, logEvent:Function, evidence:object, setStatus:Function, setError:Function, repaint:Function, readFile:Function}} deps
 *   evidence 는 증빙 보관함(src/evidence.js), repaint 는 신청 내역을 다시 그리는 길, readFile 은 File → data URL 이다
 */
export function createSendBox({ escapeHtml, logEvent, evidence, setStatus, setError, repaint, readFile }) {
  // sets 는 최근에 보낸 세트(과제·계정 + 받는 사람, 다섯까지), done 은 출장(신청서 번호)마다 마지막으로 보낸 기록,
  // teams 는 Teams MCP 가 닿는지 본 결과(아직 못 봤으면 null), by 는 카드마다 고르고 있는 값, pop 은 떠 있는 팝업이다.
  // 카드의 touched 는 사람이 그 카드의 과제·계정이나 받는 사람에 손을 댔는가 — 손대기 전에는 가장 최근 세트를 깔아 준다.
  const box = { sets: [], done: {}, teams: null, probing: null, by: {}, pop: null };
  const of = (docNo) => box.by[docNo] || (box.by[docNo] = { account: '', person: null, query: '', hits: null, hitsError: '', busy: false, stage: '', error: '', timer: null, touched: false });

  /** Teams MCP 가 닿는지 본다. 결과가 오면 카드를 다시 그린다(어느 길로 가는지 적혀 있다). */
  function probe() {
    box.probing ||= teamsState().then((t) => {
      box.teams = t;
      box.probing = null;
      repaint();
      return t;
    });
    return box.probing;
  }

  /**
   * 기억해 둔 것(최근에 보낸 세트, 보낸 기록)을 읽는다. 근태 탭이 보일 때 부른다. 세트로 기억하기 전의 기록만 있으면
   * 거기서 세트를 짓는다(setsFromOld).
   */
  async function load() {
    const saved = await chrome.storage.local.get(['sendSets', 'sendAccounts', 'sendPeople', 'sendDone']);
    box.sets = Array.isArray(saved?.sendSets)
      ? saved.sendSets.filter((x) => typeof x?.account === 'string' && x.account && x.person?.id).slice(0, RECENT_MAX) : setsFromOld(saved);
    box.done = saved?.sendDone && typeof saved.sendDone === 'object' ? saved.sendDone : {};
    if (!box.teams) probe();
  }

  // 사후정산을 저장하기 전에 사람이 정해 줄 것이 남았으면(ctx.hold) 저장도, 저장부터 하는 보내기도 잠긴다.
  const canSave = (gate, s, ctx) => gate.settle && !ctx.hold && !s.busy;
  const canGo = (gate, s, ctx) => gate.ready && !!s.account.trim() && !!s.person && !s.busy && !(gate.settle && ctx.hold);
  const setOn = (x, s) => x.account === s.account.trim() && x.person.id === s.person?.id;

  /** 떠 있는 팝업을 닫는다. focus 를 주면 닫은 뒤 그리로 초점을 돌린다. */
  function closePop(focus) {
    box.pop?.remove();
    box.pop = null;
    focus?.()?.focus();
  }

  /**
   * 보내기를 누르면 뜨는 팝업 — 받는 사람·과제·계정·보내는 길과, 나갈 글(제목과 본문) 그대로다. 팝업의 보내기를 눌러야 나가고,
   * 취소·바깥 누름·Esc 는 아무것도 보내지 않고 닫는다. 사후정산을 아직 완료하지 않은 출장이면 저장 → 확정부터 한다고 적는다.
   */
  function pop(btn, ctx) {
    const s = of(ctx.it.docNo);
    const gate = sendGate(ctx);
    if (!canGo(gate, s, ctx) || ctx.locked) return;
    closePop();
    const { trip, me, kept, it } = ctx;
    const account = s.account.trim();
    // 사후정산을 확정한 뒤에 나가는 글이다 — 단계는 그때의 것을 적는다.
    const stage = gate.settle ? { ...ctx.stage, label: SETTLED_LABEL } : ctx.stage;
    const lines = sendLines({ account, me, trip, stage, reason: it.reason, kept, file: pdfName({ trip, me }) });
    const doc = btn.ownerDocument;
    const host = btn.closest('.attend') || doc.body;
    const node = doc.createElement('div');
    node.className = 'at-pop';
    node.innerHTML = '<div class="at-pop-card" role="dialog" aria-modal="true" aria-labelledby="atPopTitle"><h3 id="atPopTitle">보낼 내용</h3>'
      + `<dl class="at-pop-to"><dt>받는 사람</dt><dd>${escapeHtml(personText(s.person))}</dd><dt>과제·계정</dt><dd>${escapeHtml(account)}</dd>`
      + `<dt>보내는 길</dt><dd>${escapeHtml(`${channelOf(box.teams).label} · ${evidenceCount(kept)} → PDF 1개`)}</dd></dl>`
      + `<div class="at-pop-body"><strong>${escapeHtml(sendTitle({ account, me, trip }))}</strong>${lines.map((l) => `<span>${escapeHtml(l)}</span>`).join('')}</div>`
      + (gate.settle ? `<p class="at-pop-note">${escapeHtml(`${GO_TITLE} — 여비계산서 ${trip.seq}`)}</p>` : '')
      + '<div class="at-pop-btns"><button type="button" class="ghost" data-pop="cancel">취소</button>'
      + `<button type="button" class="primary" data-pop="go">${gate.settle ? '저장·확정 후 보내기' : '보내기'}</button></div></div>`;
    // 닫은 뒤에는 카드의 보내기 버튼으로 초점을 돌린다 — 그 사이 카드가 다시 그려졌을 수 있어 그때 다시 찾는다.
    const back = () => [...host.querySelectorAll('.at-send')].find((n) => n.dataset.doc === it.docNo)?.querySelector('button[data-act="send-go"]');
    node.addEventListener('click', (e) => {
      const act = e.target === node ? 'cancel' : e.target instanceof Element ? e.target.closest('button[data-pop]')?.dataset.pop : '';
      if (!act) return;
      closePop(back);
      // 팝업이 떠 있는 사이의 사정(보관함·단계)을 다시 받아 보낸다.
      if (act === 'go') go(ctx.again?.() || ctx);
    });
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closePop(back); return; }
      if (e.key !== 'Tab') return;
      // 초점은 팝업의 두 버튼 사이에서만 돈다.
      const btns = [...node.querySelectorAll('button')];
      e.preventDefault();
      btns[(btns.indexOf(doc.activeElement) + (e.shiftKey ? btns.length - 1 : 1)) % btns.length].focus();
    });
    host.append(node);
    box.pop = node;
    node.querySelector('button[data-pop="go"]').focus();
  }

  const hitsHtml = (s) => (s.hitsError ? `<li class="error">${escapeHtml(s.hitsError)}</li>`
    : !s.hits ? '' : !s.hits.length ? '<li class="none">찾는 사람이 없습니다</li>'
      : s.hits.map((p) => `<li><button type="button" class="at-chip" data-act="send-person" data-id="${escapeHtml(p.id)}">${escapeHtml(personText(p))}</button></li>`).join(''));

  /**
   * 출장 카드의 송부 칸. 여비계산서가 없으면 빈 글이다.
   * @param {{it:object, trip:object|null, stage:object|null, need:object|null, kept:object[], me:string, locked:boolean,
   *          save?:Function, confirm?:Function, again?:Function, hold?:string}} ctx
   *   it 은 신청 내역의 출장 한 건, trip·stage 는 그 여비계산서와 단계, need 는 사후정산 대상인가, kept 는 보관함의 증빙이다.
   *   save·confirm 은 사후정산을 저장·확정하는 길(진행 글을 받는 함수를 넘긴다, 못 하면 던진다), again 은 그 뒤의 사정을 다시 주는 길,
   *   hold 는 저장하기 전에 사람이 정해 줄 것이 남았을 때의 까닭이다
   */
  function html(ctx) {
    const { it, trip, stage, kept = [], locked } = ctx;
    if (!trip || !stage) return '';
    const s = of(it.docNo);
    // 손대지 않은 카드에는 가장 최근에 보낸 세트를 깔아 둔다 — 보통 같은 과제를 같은 사람에게 보낸다.
    if (!s.touched && !s.account && !s.person && box.sets[0]) Object.assign(s, { account: box.sets[0].account, person: box.sets[0].person });
    const gate = sendGate(ctx);
    const way = channelOf(box.teams);
    const done = box.done[it.docNo];
    const head = (how) => `<div class="at-send-head"><strong>증빙 송부</strong><span class="at-send-how"${way.note ? ` title="${escapeHtml(way.note)}"` : ''}>${escapeHtml(how)}</span></div>`;
    const doneNote = done ? `<p class="at-send-note ok">${escapeHtml(`보냈습니다 — ${stamp(done.at)} · ${done.channel} · ${done.to} · ${done.account}`)}</p>` : '';
    // 아직 보낼 때가 아니면(정산이 덜 끝났다) 까닭 한 줄만 적는다.
    if (!gate.staged) return `<div class="at-send" data-doc="${escapeHtml(it.docNo)}">${head(gate.why)}${doneNote}</div>`;

    const off = locked || s.busy ? ' disabled' : '';
    // 사후정산이 완료된 카드에는 사후정산 칸(보관 중인 증빙 목록)이 없다 — 무엇이 묶이는지 여기에 적는다.
    const files = stage.phase === 'post' && stage.done && kept.length
      ? `<ul class="at-send-files">${kept.map((k) => `<li><span>${escapeHtml(`${k.label} · ${k.name}`)}</span><button type="button" class="small ghost at-kept-drop" data-act="kept-drop" `
        + `data-name="${escapeHtml(k.name)}" title="보관함에서 빼기" aria-label="${escapeHtml(k.name)} 보관함에서 빼기"${off}>×</button></li>`).join('')}</ul>` : '';
    // 사후정산을 쓰는 중이면 증빙은 위의 사후정산 칸(증빙 넣는 곳)이 읽어서 올리고 보관한다 — 읽지 않고 담는 칸을 여기에 또 두지 않는다.
    const add = gate.settle ? '' : `<label class="at-send-add"><input type="file" multiple accept="${EVIDENCE_ACCEPT}" data-send="file" aria-label="보낼 증빙 넣기"${off} />`
      + `<span>${kept.length ? '증빙 더 넣기' : '증빙 넣기'} · 읽지 않고 그대로 묶습니다</span></label>`;
    // 최근에 보낸 세트 — 칩 하나가 과제·계정과 받는 사람을 함께 채운다.
    const sets = !box.sets.length ? '' : '<div class="at-send-row" role="group" aria-label="최근에 보낸 곳"><span class="at-label">최근에 보낸 곳</span><span class="at-chips">'
      + box.sets.map((x, i) => `<button type="button" class="at-chip${setOn(x, s) ? ' active' : ''}" data-act="send-set" data-i="${i}" aria-pressed="${setOn(x, s)}" `
        + `title="${SET_TITLE}"${off}>${escapeHtml(setText(x))}</button>`).join('') + '</span></div>';
    const person = s.person
      ? `<span class="at-send-picked">${escapeHtml(personText(s.person))}<button type="button" class="small ghost at-kept-drop" data-act="send-person-clear" title="받는 사람 바꾸기" aria-label="받는 사람 바꾸기"${off}>×</button></span>`
      : `<input type="text" data-send="person" value="${escapeHtml(s.query)}" placeholder="이름·ID 로 찾기" aria-label="받는 사람 찾기" autocomplete="off"${off} />`
        + `<ul class="at-send-hits">${hitsHtml(s)}</ul>`;
    const how = gate.ready ? `${way.label} · ${evidenceCount(kept)} → PDF 1개` : gate.why;
    // 사후정산을 아직 완료하지 않은 출장 — 저장만 하는 버튼이 보내기 옆에 서고, 보내기는 저장 → 확정 → 송부를 잇는다.
    const settleNote = !gate.settle ? '' : `<p class="at-send-note${ctx.hold ? ' error' : ''}">${escapeHtml(ctx.hold || '보내기는 사후정산을 저장하고 확정(완료)한 뒤에 보냅니다')}</p>`;
    const saveBtn = !gate.settle ? '' : `<button type="button" class="small ghost at-send-save" data-act="send-save" title="${SAVE_TITLE}"${canSave(gate, s, ctx) && !locked ? '' : ' disabled'}>사후정산 저장</button>`;
    return `<div class="at-send" data-doc="${escapeHtml(it.docNo)}">${head(how)}${doneNote}${files}${add}${sets}`
      + `<div class="at-send-row" role="group" aria-label="과제·계정"><span class="at-label">과제·계정</span>`
      + `<input type="text" data-send="account" value="${escapeHtml(s.account)}" placeholder="과제 또는 계정을 직접 적기" aria-label="과제 또는 계정" autocomplete="off"${off} /></div>`
      + `<div class="at-send-row" role="group" aria-label="받는 사람"><span class="at-label">받는 사람</span>${person}</div>`
      + settleNote
      + (s.busy ? `<p class="at-send-note">${escapeHtml(s.stage || '보내는 중...')}</p>` : '')
      + (s.error ? `<p class="at-send-note error">${escapeHtml(s.error)}</p>` : '')
      + `<div class="at-send-btns">${saveBtn}<button type="button" class="small at-request at-send-go" data-act="send-go" aria-haspopup="dialog" `
      + `title="${gate.settle ? `${GO_TITLE} — ` : ''}보낼 내용을 먼저 보여 줍니다"`
      + `${canGo(gate, s, ctx) && !locked ? '' : ' disabled'}>${done ? '다시 보내기' : '보내기'}</button></div></div>`;
  }

  /**
   * 두 번 눌러야 나가는 누름인가 — 사후정산을 저장하는 누름(`사후정산 저장`)이다. 그렇다면 첫 누름에 버튼에 적을 글(label)과
   * 상태 줄에 적을 글(status — 무엇을 하는지)을 돌려주고, 아니면 null 이다. `보내기`는 팝업이 확인을 맡아 여기에 걸리지 않는다.
   */
  function confirmOf(btn, ctx) {
    if (btn.dataset.act !== 'send-save' || !sendGate(ctx).settle) return null;
    const { it, trip } = ctx;
    return { label: '한 번 더 → 저장', status: `저장할 사후정산 — 여비계산서 ${trip.seq} · ${it.summary} · 카드에 있는 대로 저장합니다(확정은 하지 않습니다)` };
  }

  /** 글 칸을 친 뒤 — 카드를 새로 그리지 않고 버튼과 세트 칩만 맞춘다. */
  function sync(node, ctx, s) {
    const gate = sendGate(ctx);
    const go = node.querySelector('button[data-act="send-go"]');
    if (go) go.disabled = !canGo(gate, s, ctx) || !!ctx.locked;
    for (const b of node.querySelectorAll('button[data-act="send-set"]')) {
      const on = !!box.sets[+b.dataset.i] && setOn(box.sets[+b.dataset.i], s);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  /** 받는 사람 칸에 친 글로 사람을 찾는다(쪽지의 받는 사람 조회). 잠깐 기다렸다가 한 번만 묻는다. */
  function suggest(node, s) {
    clearTimeout(s.timer);
    const q = s.query.trim();
    const show = () => { const ul = node.isConnected ? node.querySelector('.at-send-hits') : null; if (ul) ul.innerHTML = hitsHtml(s); };
    if (!q) { s.hits = null; s.hitsError = ''; return show(); }
    s.timer = setTimeout(async () => {
      try {
        const hits = (await memoSuggest(q)).slice(0, HITS_MAX);
        if (s.query.trim() !== q) return;
        Object.assign(s, { hits, hitsError: '' });
      } catch (err) {
        if (s.query.trim() !== q) return;
        Object.assign(s, { hits: null, hitsError: `받는 사람을 찾지 못했습니다: ${err.message}` });
      }
      show();
    }, SUGGEST_WAIT_MS);
    return undefined;
  }

  /** 송부 칸의 글 칸·파일 칸에 무엇인가 들어왔을 때. 송부 칸의 것이 아니면 false. */
  function input(e, ctx) {
    const target = e.target instanceof HTMLElement ? e.target : null;
    const kind = target?.dataset.send;
    const node = target?.closest('.at-send');
    if (!kind || !node) return false;
    const s = of(ctx.it.docNo);
    if (kind === 'file') {
      if (e.type !== 'change') return true;
      const files = [...(target.files || [])];
      target.value = '';
      addFiles(ctx, files);
    } else if (kind === 'account') {
      Object.assign(s, { account: target.value, touched: true });
      sync(node, ctx, s);
    } else if (kind === 'person') {
      s.query = target.value;
      suggest(node, s);
    }
    return true;
  }

  /** 송부 칸에서 고른 파일을 읽지 않고 그대로 보관함에 담는다 — 사후정산이 끝난 뒤이거나 Claude 가 연결되지 않았을 때의 길이다. */
  async function addFiles({ it, trip, refresh }, fileList) {
    const items = [];
    for (const f of fileList) {
      if (!acceptsFile(EVIDENCE_ACCEPT, f)) { setStatus(`${f.name} 은 이미지나 PDF 가 아니라 뺐습니다.`, 'error'); continue; }
      if (f.size > FILE_LIMIT) { setStatus(`${f.name} 이 너무 큽니다(${Math.round(f.size / 1048576)}MB). 10MB 이하로 넣어 주세요.`, 'error'); continue; }
      try {
        items.push({ name: f.name, type: f.type, dataUrl: await readFile(f), label: '증빙', summary: '', date: null, total: null,
          trip: { seq: trip.seq, from: trip.from, to: trip.to, location: trip.location } });
      } catch (err) {
        setStatus(err.message, 'error');
      }
    }
    if (!items.length) return;
    try {
      await evidence.keep(it.docNo, items);
      setStatus(`증빙 ${items.length}장을 보관했습니다(${items.map((x) => x.name).join(' · ')}) — 보낼 때 PDF 로 묶입니다`);
    } catch (err) {
      setStatus(`증빙을 보관하지 못했습니다: ${err.message}`, 'error');
    }
    await refresh();
  }

  /** `사후정산 저장` — 카드에 있는 대로 사후정산을 저장만 한다(확정도 송부도 하지 않는다). 무엇이 저장됐는지는 attendpanel.js 가 적는다. */
  async function save(ctx) {
    const s = of(ctx.it.docNo);
    if (s.busy || !canSave(sendGate(ctx), s, ctx)) return;
    const step = (text) => { s.stage = text; repaint(); };
    Object.assign(s, { busy: true, error: '' });
    step('사후정산을 저장하는 중...');
    try {
      await ctx.save(step);
    } catch (err) {
      s.error = `사후정산 저장 실패: ${err.message}`;
      setError(err, '사후정산 저장 실패');
    } finally {
      Object.assign(s, { busy: false, stage: '' });
      repaint();
    }
  }

  /**
   * 묶어서 보낸다(팝업의 보내기가 부른다). 보낸 뒤 과제·계정과 받는 사람을 한 세트로 최근 목록의 맨 앞에 기억한다.
   * 사후정산을 아직 완료하지 않은 출장이면 저장 → 확정부터 한다(2026-10-03 사용자 지정) — 어느 하나라도 안 되면 거기서 멈추고 보내지 않는다.
   */
  async function go(ctx) {
    const { it, me } = ctx;
    let { trip, stage, need } = ctx;
    const s = of(it.docNo);
    const account = s.account.trim();
    const person = s.person;
    if (s.busy || !account || !person) return;
    const step = (text) => { s.stage = text; repaint(); };
    Object.assign(s, { busy: true, error: '' });
    let way = channelOf(box.teams);
    const name = pdfName({ trip, me });
    let failed = '';
    try {
      if (sendGate(ctx).settle) {
        if (ctx.hold) throw new Error(ctx.hold);
        failed = '사후정산 저장 실패';
        step('사후정산을 저장하는 중...');
        await ctx.save(step);
        failed = '사후정산 확정 실패';
        step('사후정산을 완료(확정)하는 중...');
        await ctx.confirm(step);
        // 확정한 뒤의 계산서 줄과 단계로 보낸다 — 글에 적히는 단계가 "사후정산 완료"다.
        ({ trip, stage, need } = ctx.again());
        if (!trip || !stage) throw new Error('확정한 뒤 여비계산서 목록을 다시 읽지 못했습니다. 신청 내역을 새로 읽은 뒤 보내기를 눌러 주세요.');
        failed = '';
      }
      step('증빙을 PDF 로 묶는 중...');
      const kept = await evidence.list(it.docNo);
      const gate = sendGate({ trip, stage, need, kept });
      if (!gate.ready || gate.settle) throw new Error(gate.why || '사후정산이 완료되지 않아 보내지 않았습니다');
      const pdf = await buildPdf(kept, { title: `여비계산서 ${trip.seq} 증빙` });
      const title = sendTitle({ account, me, trip });
      const lines = sendLines({ account, me, trip, stage, reason: it.reason, kept, file: name });
      // 어느 길로 갈지는 보내는 그 순간에 다시 본다 — 패널을 연 뒤에 Teams MCP 를 켰거나 껐을 수 있다.
      box.teams = await teamsState();
      way = channelOf(box.teams);
      step(`${way.label}로 보내는 중...`);
      if (way.channel === 'teams') {
        await teamsSendFile({ email: `${person.id}@${MAIL_DOMAIN}`, html: memoHtml([title, ...lines]), file: { name, bytes: pdf.bytes } });
      } else {
        await memoSend({ to: [person.id], title, lines, file: { name, bytes: pdf.bytes, type: 'application/pdf' }, onStage: step });
      }
      box.sets = pushRecent(box.sets, { account, person }, setKey);
      const done = { ...box.done, [it.docNo]: { at: Date.now(), channel: way.label, to: person.name || person.id, account, file: name, pages: pdf.pages } };
      box.done = Object.fromEntries(Object.entries(done).sort((a, b) => b[1].at - a[1].at).slice(0, DONE_MAX));
      await chrome.storage.local.set({ sendSets: box.sets, sendDone: box.done });
      setStatus(`${way.label}로 보냈습니다 — ${personText(person)} · ${account} · ${name}(${pdf.pages}쪽)`);
      logEvent('trip', true, `여비계산서 증빙 송부(${way.label}): ${trip.seq} → ${person.id} · ${account} · ${name} ${pdf.pages}쪽`,
        { seq: trip.seq, docNo: it.docNo, channel: way.channel, to: person.id, account, files: kept.map((k) => k.name), pages: pdf.pages });
    } catch (err) {
      s.error = failed ? `${failed}: ${err.message}` : err.message;
      setError(err, failed || '증빙 송부 실패');
      // 사후정산 저장·확정이 안 된 것은 attendpanel.js 가 이미 기록했다.
      if (!failed) logEvent('trip', false, `여비계산서 증빙 송부 실패(${way.label}): ${trip.seq} — ${err.message}`, { seq: trip.seq, docNo: it.docNo, channel: way.channel, to: person.id });
    } finally {
      Object.assign(s, { busy: false, stage: '' });
      repaint();
    }
  }

  /** 송부 칸의 버튼을 눌렀을 때(data-act 가 send- 로 시작하는 것). */
  function click(btn, ctx) {
    const s = of(ctx.it.docNo);
    const a = btn.dataset.act;
    if (a === 'send-go') return pop(btn, ctx);
    if (a === 'send-save') return save(ctx);
    if (a === 'send-set') {
      // 세트 하나가 과제·계정과 받는 사람을 함께 채운다.
      const x = box.sets[+btn.dataset.i];
      if (!x) return undefined;
      clearTimeout(s.timer);
      Object.assign(s, { account: x.account, person: x.person, query: '', hits: null, hitsError: '' });
    } else if (a === 'send-person-clear') s.person = null;
    else if (a === 'send-person') {
      const p = (s.hits || []).find((x) => x.id === btn.dataset.id);
      if (!p) return undefined;
      clearTimeout(s.timer);
      Object.assign(s, { person: p, query: '', hits: null, hitsError: '' });
    }
    Object.assign(s, { touched: true, error: '' });
    repaint();
    return undefined;
  }

  return { load, html, input, click, confirmOf, add: addFiles, state: box };
}
