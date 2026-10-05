// 신청 내역 출장 카드의 "여비증빙 송부" 칸 — 보관함의 증빙을 PDF 하나로 묶어 담당자에게 보낸다(2026-10-03 사용자 지정).
// 언제 보낼 수 있는지·무슨 글인지는 src/send.js, 묶는 일은 src/pdf.js, 보내는 길은 src/teams.js(Teams MCP)·src/memo.js(쪽지)다.
// 여기는 그것들을 카드에 잇기만 한다. 카드를 그리고 누름을 넘겨 주는 것은 attendpanel.js 다.
//
// 묶는 PDF 의 **맨 앞은 확정한 여비계산서의 출력**이다(2026-10-04 사용자 지정: "확정한 다음에 출력해서 증빙들과 합쳐서 보내야지") —
// 보내는 순간에(사후정산을 확정해야 하면 확정한 뒤에) 사이트의 리포트 서버에서 계산서를 PDF 로 받아(src/trip.js tripCalPdf →
// src/calpdf.js) 증빙 앞에 붙인다. 계산서를 받지 못하면 증빙만 보내지 않고 멈춘다.
//
// 보내기를 누르면 **보낼 내용이 팝업으로 뜬다**(2026-10-04 사용자 지정) — 누구에게 무슨 글이 가는지 그대로 보이고, 팝업의 보내기를
// 눌러야 나간다. 글 칸을 치는 동안에는 카드를 새로 그리지 않는다(커서가 날아간다) — 버튼만 그 자리에서 고친다.
//
// 과제·계정과 받는 사람, 보내는 길은 **한 세트로 기억한다**(2026-10-04 사용자 지정 — 보통 같은 과제는 같은 사람에게 간다).
// 이전에 보낸 세트를 셋까지 **한 줄에 하나씩** 보이고(과제·계정 · 받는 사람 · 보내는 길), 줄을 누르면 그 셋으로 보낸다 — 켜진 줄이
// 지금 보내는 곳이다. 가장 최근 세트는 카드를 펴면 미리 켜져 있다. 직접 고르는 칸(과제·계정, 받는 사람, 보내는 길)은 **접혀 있고**
// `직접 고르기`로 편다(2026-10-04 사용자 지정: "접었다가 … 3개 정도 리스트해서 이전 보낸 정보로"). 이전에 보낸 곳이 없거나 지금
// 고른 곳이 그 줄들에 없으면 칸이 펴져 있다 — 보이지 않는 곳으로 보내지 않는다.
// 줄의 보내는 길은 글이 아니라 **아이콘**이고(Teams 로고 · 쪽지 말풍선), `직접 고르기`도 첫 줄 오른쪽의 목록 아이콘이다
// (2026-10-04 사용자 지정: "teams 는 진짜 팀즈 아이콘, 직접 고르기는 teams 오른쪽에 … 리스트업 아이콘").
//
// 어느 길로 보낼지는 편 칸의 `보내는 길` 칩(Teams · 쪽지)으로 **고른다**(2026-10-04 사용자 지정). 켜진 칩이 지금 나가는 길이고,
// 고른 것은 기억한다. 고르지 않았으면 Teams MCP 가 닿을 때 Teams, 아니면 쪽지다. Teams 로 가려는 누름(Teams 칩, Teams 로 보냈던
// 줄)은 Teams MCP 를 다시 본다 — 닿지 않으면 까닭을 카드에 적고 쪽지로 둔다. 팝업에서 확인한 길과 보내는 순간의 길이 다르면
// 아무것도 보내지 않는다.
//
// 숙박·비행기가 있는 출장인데 사후정산을 아직 완료하지 않았으면 `보내기`가 사후정산 저장 → 확정 → 송부를 잇는다(2026-10-03 사용자 지정).
// 저장과 확정은 attendpanel.js 가 한다(ctx.save·ctx.confirm). **저장만 하거나 확정만 하는 버튼은 두지 않는다**(2026-10-05 사용자 지정:
// "파일올라가면 다 자동 저장인거고" · "보내기 하면 그때 '확정' 하고 보내라고") — 증빙을 넣으면 그때 저장되고, 확정은 보낼 때 한다.
// 처음에는 `사후정산 저장` 버튼이 `보내기` 옆에 있었다. 완료한 사후정산을 출장 카드에서 다시 작성하는 중일 때도(ctx.reopen, 2026-10-04
// 사용자 지정) `보내기`가 저장 → 확정부터 한다. 숙박·비행기 출장은 보관한 증빙이 없어도 보낸다 — 여비계산서의 출력만 나간다
// (2026-10-04 사용자 지정, src/send.js sendGate). `보내기`는 팝업이 확인을 맡는다 — 저장·확정부터 한다는 것도 팝업에 적힌다.
//
// 2026-10-05 사용자 지정(정산을 마치고 보낸 카드를 보고): "여기에서 사후정산 다시하기, 사전정산 다시하기 기능이 있으면 좋겠어. 맨 아래
// 다시 보내기 했으면 좋겠고 … 보내기 이력에서.. 이력을 삭제할 수도 있으면 좋겠어" — 맨 아래의 보내기 바로 위에 `사전정산 다시하기`·
// `사후정산 다시하기`가 서고(ctx.redo — 무엇을 하는지는 attendpanel.js), 이전에 보낸 곳의 줄마다 × 가, 보낸 기록(`보냈습니다 — …`)
// 옆에도 × 가 선다. 지우는 것은 패널이 기억해 둔 것뿐이다. 사후정산을 완료한 출장에 넣은 증빙은 읽어서 사후정산에 반영한다(ctx.read).

import { sendGate, sendable, heldNote, channelOf, teamsWhy, wantOf, wantOfLabel, WAYS, pushRecent, pdfName, calName, sendTitle, sendLines, packCount, SETTLED_LABEL, RECENT_MAX } from './src/send.js';
import { buildPdf } from './src/pdf.js';
import { tripCalPdf } from './src/trip.js';
import { memoSuggest, memoSend, memoHtml } from './src/memo.js';
import { teamsState, teamsSendFile } from './src/teams.js';
import { EVIDENCE_ACCEPT, acceptsFile } from './src/attend.js';
import { MAIL_DOMAIN } from './src/config.js';

const FILE_LIMIT = 10 * 1024 * 1024;
const SUGGEST_WAIT_MS = 250;
const HITS_MAX = 8;
/** 보낸 기록을 몇 건까지 남기는가(출장 한 건에 하나). */
const DONE_MAX = 60;
const GO_TITLE = '사후정산을 저장하고 확정(완료)한 뒤에 증빙을 보냅니다';
const SET_TITLE = '이 과제·계정과 받는 사람, 보내는 길로 보냅니다';
const SET_DEL_TITLE = '이 줄을 이전에 보낸 곳에서 지웁니다';
const DONE_DEL_TITLE = '이 보낸 기록을 지웁니다 — 패널의 기록만 지웁니다(보낸 것이 취소되지는 않습니다)';
const ADD_READ = '읽어서 사후정산에 반영합니다';
const ADD_READ_TITLE = '숙박 증빙·항공권이면 읽어서 사후정산에 다시 올리고, 그 밖의 문서는 보낼 증빙으로 담습니다';
const FOLD_TITLE = '과제·계정, 받는 사람, 보내는 길을 직접 고릅니다';
const WAY_RETRY = 'Teams 서버(localhost:5003)를 켠 뒤';
// 이전에 보낸 줄에 적는 보내는 길의 아이콘 — Teams 는 Teams 로고(제 색 그대로), 쪽지는 말풍선이다.
const WAY_ICON = {
  teams: '<svg viewBox="0 0 2228.833 2073.333" aria-hidden="true"><g stroke="none">'
    + '<path fill="#5059C9" d="M1554.637,777.5h575.713c54.391,0,98.483,44.092,98.483,98.483v524.398c0,199.901-162.051,361.952-361.952,361.952h-1.711c-199.901,0.028-361.975-162-362.004-361.901V828.971C1503.167,800.544,1526.211,777.5,1554.637,777.5z"/>'
    + '<circle fill="#5059C9" cx="1943.75" cy="440.583" r="233.25"/><circle fill="#7B83EB" cx="1218.083" cy="336.917" r="336.917"/>'
    + '<path fill="#7B83EB" d="M1667.323,777.5H717.01c-53.743,1.33-96.257,45.931-95.01,99.676v598.105c-7.505,322.519,247.657,590.16,570.167,598.053c322.51-7.893,577.671-275.534,570.167-598.053V877.176C1763.579,823.431,1721.066,778.83,1667.323,777.5z"/>'
    + '<path fill="#4B53BC" d="M95.01,466.5h950.312c52.473,0,95.01,42.538,95.01,95.01v950.312c0,52.473-42.538,95.01-95.01,95.01H95.01c-52.473,0-95.01-42.538-95.01-95.01V561.51C0,509.038,42.538,466.5,95.01,466.5z"/>'
    + '<path fill="#FFF" d="M820.211,828.193H630.241v517.297H509.211V828.193H320.123V727.844h500.088V828.193z"/></g></svg>',
  memo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M5 3.5h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7.2L7 21.5v-4H5a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3Z"/></svg>',
};
const FOLD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/></svg>';
const stamp = (at) => { const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const whoText = (p) => `${p.name || p.id}${p.title ? ` ${p.title}` : ''}`;
const personText = (p) => [whoText(p), p.dept].filter(Boolean).join(' · ');
/** 세트 하나(과제·계정 + 받는 사람 + 보내는 길)의 열쇠 — 같은 과제를 같은 사람에게 보낸 것은 한 줄이고, 길은 마지막에 보낸 것이다. */
const setKey = (x) => `${x.account}|${x.person.id}`;
const sentOf = (saved) => Object.values(saved?.sendDone && typeof saved.sendDone === 'object' ? saved.sendDone : {}).sort((a, b) => a.at - b.at);

/**
 * 세트로 기억하기 전(과제·계정과 받는 사람을 따로 기억하던 때)의 기록에서 세트를 짓는다 — 보낸 기록마다 그때의 과제·계정과
 * 받는 사람, 보낸 길을 짝짓는다. 받는 사람을 최근 목록에서 찾지 못한 기록은 버린다.
 */
function setsFromOld(saved) {
  const people = (Array.isArray(saved?.sendPeople) ? saved.sendPeople : []).filter((p) => p?.id);
  let sets = [];
  for (const d of sentOf(saved)) {
    const person = people.find((p) => (p.name || p.id) === d.to);
    if (d.account && person) sets = pushRecent(sets, { account: d.account, person, way: wantOfLabel(d.channel) }, setKey);
  }
  return sets;
}

/** 길을 같이 기억하기 전의 세트에 길을 채운다 — 그 과제·계정을 그 사람에게 마지막으로 보낸 기록의 길이다. 기록이 없으면 ''(그때그때의 길). */
function withWay(x, saved) {
  const last = sentOf(saved).filter((d) => d.account === x.account && d.to === (x.person.name || x.person.id)).pop();
  return { ...x, way: wantOf(x.way) || wantOfLabel(last?.channel) };
}

/**
 * @param {{escapeHtml:Function, logEvent:Function, evidence:object, setStatus:Function, setError:Function, repaint:Function, readFile:Function}} deps
 *   evidence 는 증빙 보관함(src/evidence.js), repaint 는 신청 내역을 다시 그리는 길, readFile 은 File → data URL 이다
 */
export function createSendBox({ escapeHtml, logEvent, evidence, setStatus, setError, repaint, readFile }) {
  // sets 는 이전에 보낸 세트(과제·계정 + 받는 사람 + 보내는 길, 셋까지), done 은 출장(신청서 번호)마다 마지막으로 보낸 기록,
  // teams 는 Teams MCP 가 닿는지 본 결과(아직 못 봤으면 null), want 는 마지막으로 고른 길('teams'·'memo', 고르지 않았으면 ''),
  // by 는 카드마다 고르고 있는 값, pop 은 떠 있는 팝업이다.
  // 카드의 touched 는 사람이 그 카드의 과제·계정이나 받는 사람에 손을 댔는가 — 손대기 전에는 가장 최근 세트를 깔아 준다.
  // 카드의 want 는 그 카드에서 가려는 길(고른 줄의 길이거나 칩으로 고른 길, 없으면 box.want 를 따른다), open 은 직접 고르는 칸을 폈는가.
  const box = { sets: [], done: {}, teams: null, want: '', probing: null, by: {}, pop: null };
  const of = (docNo) => box.by[docNo] || (box.by[docNo] = { account: '', person: null, want: '', open: false, query: '', hits: null, hitsError: '', busy: false, stage: '', error: '', timer: null, touched: false });
  /** 그 카드에서 가려는 길과, 지금 나가는 길 — 가려는 길과 Teams MCP 의 사정으로 정해진다. */
  const wantNow = (s) => s.want || box.want;
  const wayNow = (s) => channelOf(box.teams, wantNow(s));

  /** Teams MCP 가 닿는지 본다. 카드에 적힌 것(어느 길로 가는지, Teams 로 못 가는 까닭)이 달라졌을 때만 카드를 다시 그린다. */
  function probe() {
    box.probing ||= teamsState().then((t) => {
      const before = teamsWhy(box.teams);
      box.teams = t;
      box.probing = null;
      if (teamsWhy(t) !== before) repaint();
      return t;
    });
    return box.probing;
  }

  /**
   * 기억해 둔 것(이전에 보낸 세트, 보낸 기록, 고른 길)을 읽는다. 근태 탭이 보일 때 부른다. 세트로 기억하기 전의 기록만 있으면
   * 거기서 세트를 짓고(setsFromOld), 길을 같이 기억하기 전의 세트에는 보낸 기록의 길을 채운다(withWay).
   * Teams MCP 는 부를 때마다 다시 본다 — 다른 탭에 다녀온 사이에 켰거나 껐을 수 있다.
   */
  async function load() {
    const saved = await chrome.storage.local.get(['sendSets', 'sendAccounts', 'sendPeople', 'sendDone', 'sendWay']);
    box.sets = Array.isArray(saved?.sendSets)
      ? saved.sendSets.filter((x) => typeof x?.account === 'string' && x.account && x.person?.id).slice(0, RECENT_MAX).map((x) => withWay(x, saved)) : setsFromOld(saved);
    box.done = saved?.sendDone && typeof saved.sendDone === 'object' ? saved.sendDone : {};
    box.want = wantOf(saved?.sendWay);
    probe();
  }

  // 사후정산을 저장하기 전에 사람이 정해 줄 것이 남았으면(ctx.hold) 저장부터 하는 보내기가 잠긴다.
  const canGo = (gate, s, ctx) => gate.ready && !!s.account.trim() && !!s.person && !s.busy && !(gate.settle && ctx.hold);
  /** 그 줄이 지금 보내는 곳인가 — 과제·계정과 받는 사람이 같고, 줄에 길이 적혀 있으면 가려는 길도 같다. */
  const setOn = (x, s) => x.account === s.account.trim() && x.person.id === s.person?.id
    && (!wantOf(x.way) || x.way === (wantNow(s) || wayNow(s).channel));
  const anyOn = (s) => box.sets.some((x) => setOn(x, s));

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
    const { trip, me, it } = ctx;
    // 출장 기간과 안 맞아 확정을 기다리는 증빙은 묶지 않는다 — 무엇이 빠지는지 팝업에 적는다.
    const kept = sendable(ctx.kept);
    const held = heldNote(ctx.kept);
    const account = s.account.trim();
    // 사후정산을 확정한 뒤에 나가는 글이다 — 단계는 그때의 것을 적는다.
    const stage = gate.settle ? { ...ctx.stage, label: SETTLED_LABEL } : ctx.stage;
    const lines = sendLines({ account, me, trip, stage, reason: it.reason, kept, file: pdfName({ trip, me }) });
    // 팝업에 적는 길 — 보낼 때 이 길이 아니면 보내지 않는다(go).
    const way = wayNow(s);
    const doc = btn.ownerDocument;
    const host = btn.closest('.attend') || doc.body;
    const node = doc.createElement('div');
    node.className = 'at-pop';
    node.innerHTML = '<div class="at-pop-card" role="dialog" aria-modal="true" aria-labelledby="atPopTitle"><h3 id="atPopTitle">보낼 내용</h3>'
      + `<dl class="at-pop-to"><dt>받는 사람</dt><dd>${escapeHtml(personText(s.person))}</dd><dt>과제·계정</dt><dd>${escapeHtml(account)}</dd>`
      + `<dt>보내는 길</dt><dd>${escapeHtml(`${way.label} · ${packCount(kept)} → PDF 1개`)}</dd></dl>`
      + `<div class="at-pop-body"><strong>${escapeHtml(sendTitle({ account, me, trip }))}</strong>${lines.map((l) => `<span>${escapeHtml(l)}</span>`).join('')}</div>`
      + (gate.settle ? `<p class="at-pop-note">${escapeHtml(`${GO_TITLE} — 여비계산서 ${trip.seq}`)}</p>` : '')
      + (held ? `<p class="at-pop-note at-pop-held">${escapeHtml(held)}</p>` : '')
      + '<div class="at-pop-btns"><button type="button" class="ghost" data-pop="cancel">취소</button>'
      + `<button type="button" class="primary" data-pop="go">${gate.settle ? '저장·확정 후 보내기' : '보내기'}</button></div></div>`;
    // 닫은 뒤에는 카드의 보내기 버튼으로 초점을 돌린다 — 그 사이 카드가 다시 그려졌을 수 있어 그때 다시 찾는다.
    const back = () => [...host.querySelectorAll('.at-send')].find((n) => n.dataset.doc === it.docNo)?.querySelector('button[data-act="send-go"]');
    node.addEventListener('click', (e) => {
      const act = e.target === node ? 'cancel' : e.target instanceof Element ? e.target.closest('button[data-pop]')?.dataset.pop : '';
      if (!act) return;
      closePop(back);
      // 팝업이 떠 있는 사이의 사정(보관함·단계)을 다시 받아 보낸다.
      if (act === 'go') go(ctx.again?.() || ctx, way);
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
   *          save?:Function, confirm?:Function, again?:Function, hold?:string, reopen?:boolean}} ctx
   *   it 은 신청 내역의 출장 한 건, trip·stage 는 그 여비계산서와 단계, need 는 사후정산 대상인가, kept 는 보관함의 증빙이다.
   *   reopen 은 완료한 사후정산을 출장 카드에서 다시 작성하는 중인가다(그러면 완료하기 전처럼 저장 → 확정부터 한다).
   *   save·confirm 은 사후정산을 저장·확정하는 길(진행 글을 받는 함수를 넘긴다, 못 하면 던진다), again 은 그 뒤의 사정을 다시 주는 길,
   *   hold 는 저장하기 전에 사람이 정해 줄 것이 남았을 때의 까닭이다.
   *   redo 는 맨 아래 보내기 위에 서는 `사전정산 다시하기`·`사후정산 다시하기`({pre, post} — 저마다 {on, title} 이거나, 그 버튼이 설 때가
   *   아니면 null), read 는 사후정산을 완료한 출장에 넣은 증빙을 읽어 사후정산에 반영하는 길이다(없으면 읽지 않고 그대로 담는다)
   */
  function html(ctx) {
    const { it, trip, stage, locked } = ctx;
    if (!trip || !stage) return '';
    // all 은 보관함의 증빙 전부, kept 는 그 가운데 보내는 것이다 — 출장 기간과 안 맞아 알림 표시가 붙은 것은 확정하기 전에는 빠진다.
    const all = ctx.kept || [];
    const kept = sendable(all);
    const held = heldNote(all);
    const s = of(it.docNo);
    // 손대지 않은 카드에는 가장 최근에 보낸 세트를 깔아 둔다 — 보통 같은 과제를 같은 사람에게 같은 길로 보낸다.
    if (!s.touched && !s.account && !s.person && box.sets[0]) Object.assign(s, { account: box.sets[0].account, person: box.sets[0].person, want: wantOf(box.sets[0].way) });
    const gate = sendGate(ctx);
    const way = wayNow(s);
    const done = box.done[it.docNo];
    // Teams 로 못 가는 까닭 — Teams 로 가려던 카드라면 칸 머리에 마우스를 올렸을 때 왜 쪽지인지 보인다.
    const noTeams = teamsWhy(box.teams);
    const wayNote = way.note || (wantNow(s) === 'teams' && noTeams ? `${noTeams} — 지금은 쪽지로 갑니다` : '');
    const head = (how) => `<div class="at-send-head"><strong>여비증빙 송부</strong><span class="at-send-how"${wayNote ? ` title="${escapeHtml(wayNote)}"` : ''}>${escapeHtml(how)}</span></div>`;
    const off = locked || s.busy ? ' disabled' : '';
    // 보낸 기록은 × 로 지울 수 있다(2026-10-05 사용자 지정: "보내기 이력에서.. 이력을 삭제") — 패널의 기록만 지운다.
    const doneNote = done ? `<div class="at-send-done"><p class="at-send-note ok">${escapeHtml(`보냈습니다 — ${stamp(done.at)} · ${done.channel} · ${done.to} · ${done.account}`)}</p>`
      + `<button type="button" class="small ghost at-kept-drop" data-act="send-done-del" title="${DONE_DEL_TITLE}" aria-label="보낸 기록 지우기"${off}>×</button></div>` : '';
    // 정산을 다시 하는 버튼(2026-10-05 사용자 지정: "여기에서 사후정산 다시하기, 사전정산 다시하기 … 맨 아래 다시 보내기") — 맨 아래의
    // 보내기 바로 위에 선다. 켜진 버튼이 지금 다시 하는 중인 정산이고, 다시 누르면 그만둔다. 누름은 attendpanel.js 가 받는다.
    const redoBtn = (r, act, label) => (!r ? '' : `<button type="button" class="small ghost at-redo${r.on ? ' active' : ''}" data-act="${act}" `
      + `aria-pressed="${!!r.on}" title="${escapeHtml(r.title || '')}"${off}>${label}</button>`);
    const redo = !ctx.redo?.pre && !ctx.redo?.post ? '' : `<div class="at-send-redo" role="group" aria-label="정산 다시하기">`
      + `${redoBtn(ctx.redo.pre, 'pre-redo', '사전정산 다시하기')}${redoBtn(ctx.redo.post, 'after-reopen', '사후정산 다시하기')}</div>`;
    // 아직 보낼 때가 아니면(정산이 덜 끝났다) 까닭 한 줄만 적는다. 보낸 기록은 여기서도 맨 아래다.
    if (!gate.staged) return `<div class="at-send" data-doc="${escapeHtml(it.docNo)}">${head(gate.why)}${redo}${doneNote}</div>`;

    // 사후정산이 완료된 카드에는 사후정산 칸(보관 중인 증빙 목록)이 없다 — 무엇이 묶이는지 여기에 적는다.
    // 완료한 사후정산을 다시 작성하는 중이면(gate.settle) 사후정산 칸이 다시 서 있어 거기에 적힌다.
    // 알림 표시가 붙은 증빙에는 까닭과 `확정` 버튼이 선다 — 확정하면 그때부터 같이 간다.
    const okBtn = (k) => (!k.warn ? '' : `<button type="button" class="small ghost at-kept-ok" data-act="kept-ok" data-name="${escapeHtml(k.name)}" `
      + `title="이 출장의 증빙이 맞다고 확정합니다 — 그때부터 보낼 때 같이 갑니다"${off}>확정</button>`);
    const files = !gate.settle && stage.phase === 'post' && stage.done && all.length
      ? `<ul class="at-send-files">${all.map((k) => `<li${k.warn ? ' class="warn"' : ''}><span${k.warn ? ` title="${escapeHtml(k.warn)}"` : ''}>${escapeHtml(`${k.label} · ${k.name}${k.warn ? ` · ⚠ ${k.warn}` : ''}`)}</span>${okBtn(k)}`
        + `<button type="button" class="small ghost at-kept-drop" data-act="kept-drop" `
        + `data-name="${escapeHtml(k.name)}" title="보관함에서 빼기" aria-label="${escapeHtml(k.name)} 보관함에서 빼기"${off}>×</button></li>`).join('')}</ul>` : '';
    // 사후정산을 쓰는 중이면 증빙은 위의 사후정산 칸(증빙 넣는 곳)이 읽어서 올리고 보관한다 — 읽지 않고 담는 칸을 여기에 또 두지 않는다.
    // 사후정산을 완료한 출장에 넣는 증빙은 읽어서, 숙박 증빙·항공권이면 사후정산에 다시 올린다(ctx.read — 2026-10-05 사용자 지정:
    // "사후정산을 완료 후 보낸 후 증빙을 … 추가 하면 다시 사후정산을 업데이트"). 읽을 길이 없으면(ctx.read 가 없다) 전처럼 그대로 묶는다.
    const add = gate.settle ? '' : `<label class="at-send-add"${ctx.read ? ` title="${ADD_READ_TITLE}"` : ''}><input type="file" multiple accept="${EVIDENCE_ACCEPT}" data-send="file" aria-label="보낼 증빙 넣기"${off} />`
      + `<span>${all.length ? '증빙 더 넣기' : '증빙 넣기'} · ${ctx.read ? ADD_READ : '읽지 않고 그대로 묶습니다'}</span></label>`;
    // 이전에 보낸 곳(2026-10-04 사용자 지정) — 한 줄이 과제·계정 · 받는 사람 · 보내는 길이고, 누르면 그 셋으로 보낸다. 켜진 줄이
    // 지금 보내는 곳이다. 길은 아이콘으로 적고(이름은 낭독기와 마우스를 올렸을 때만), Teams 로 보냈던 줄인데 지금 Teams 로 못 가면
    // 아이콘이 흐리다. 직접 고르는 칸은 접혀 있고 첫 줄 오른쪽의 목록 아이콘으로 편다 — 켜진 줄이 없으면(이전에 보낸 곳이 없거나,
    // 지금 고른 곳이 줄에 없다) 접을 수 없다.
    const open = s.open || !anyOn(s);
    const wayTag = (x) => {
      const w = WAYS.find((v) => v.channel === x.way);
      if (!w) return '';
      const dim = w.channel === 'teams' && !!noTeams;
      return `<span class="at-send-set-way${dim ? ' dim' : ''}" title="${escapeHtml(dim ? `${w.label} — ${noTeams}` : w.label)}">${WAY_ICON[w.channel]}<span class="sr-only">${escapeHtml(w.label)}</span></span>`;
    };
    const setTitle = (x) => `${personText(x.person)} — ${SET_TITLE}${x.way === 'teams' && noTeams ? ` (${noTeams} — 누르면 다시 확인합니다)` : ''}`;
    // 줄마다 오른쪽 끝의 × 가 그 줄을 이전에 보낸 곳에서 지운다(2026-10-05 사용자 지정: "보내기 이력에서.. 이력을 삭제").
    const rows = box.sets.map((x, i) => `<button type="button" class="at-send-set${setOn(x, s) ? ' active' : ''}" data-act="send-set" data-i="${i}" aria-pressed="${setOn(x, s)}" `
      + `title="${escapeHtml(setTitle(x))}"${off}><strong>${escapeHtml(x.account)}</strong><span class="at-send-set-who">${escapeHtml(whoText(x.person))}</span>${wayTag(x)}</button>`);
    const dels = box.sets.map((x, i) => `<button type="button" class="small ghost at-send-set-del" data-act="send-set-del" data-i="${i}" title="${SET_DEL_TITLE}" `
      + `aria-label="${escapeHtml(`${x.account} · ${whoText(x.person)} 지우기`)}"${off}>×</button>`);
    const fold = `<button type="button" class="at-send-fold" data-act="send-fold" aria-expanded="${open}" aria-label="직접 고르기" title="${FOLD_TITLE}"${anyOn(s) ? '' : ' hidden'}>${FOLD_ICON}</button>`;
    const sets = !rows.length ? '' : `<div class="at-send-sets" role="group" aria-label="이전에 보낸 곳">${rows[0]}${fold}${dels[0]}${rows.slice(1).map((r, i) => r + dels[i + 1]).join('')}</div>`;
    const person = s.person
      ? `<span class="at-send-picked" title="${escapeHtml(personText(s.person))}"><span class="at-send-who">${escapeHtml(personText(s.person))}</span><button type="button" class="small ghost at-kept-drop" data-act="send-person-clear" title="받는 사람 바꾸기" aria-label="받는 사람 바꾸기"${off}>×</button></span>`
      : `<input type="text" data-send="person" value="${escapeHtml(s.query)}" placeholder="이름·ID 로 찾기" aria-label="받는 사람 찾기" autocomplete="off"${off} />`
        + `<ul class="at-send-hits">${hitsHtml(s)}</ul>`;
    const how = gate.ready ? `${way.label} · ${packCount(kept)} → PDF 1개` : gate.why;
    // 보내는 길(2026-10-04 사용자 지정) — 켜진 칩이 지금 나가는 길이다. Teams 로 못 가는 사정이면 Teams 칩에 까닭이 적혀 있고,
    // 누르면 Teams MCP 를 다시 본다.
    const wayTitle = (w) => (w.channel === 'teams' ? (noTeams ? `${noTeams} — 누르면 다시 확인합니다` : 'Teams 채팅으로 보냅니다') : 'eclass 쪽지로 보냅니다');
    const ways = '<div class="at-send-row at-send-way" role="group" aria-label="보내는 길"><span class="at-label">보내는 길</span><span class="at-chips">'
      + WAYS.map((w) => `<button type="button" class="at-chip${w.channel === way.channel ? ' active' : ''}${w.channel === 'teams' && noTeams ? ' dim' : ''}" data-act="send-way" `
        + `data-way="${w.channel}" aria-pressed="${w.channel === way.channel}" title="${escapeHtml(wayTitle(w))}"${off}>${escapeHtml(w.label)}</button>`).join('') + '</span></div>';
    // 사후정산을 아직 완료하지 않은 출장 — 버튼은 보내기 하나이고, 보내기가 저장 → 확정 → 송부를 잇는다(확정은 보낼 때 한다).
    // 저장·확정부터 한다는 안내는 카드에 적지 않는다(2026-10-04 사용자 지정) — 보내기 버튼의 title 과 팝업에 적혀 있다.
    // 저장하기 전에 사람이 정해 줄 것이 남았을 때의 까닭(ctx.hold)만 적는다.
    const settleNote = gate.settle && ctx.hold ? `<p class="at-send-note error">${escapeHtml(ctx.hold)}</p>` : '';
    // 직접 고르는 칸 — 과제·계정과 받는 사람은 한 줄에 나란히 선다(2026-10-04 사용자 지정, 칸이 좁아 과제·계정의 안내 글은 짧게
    // 적는다). 그 아래가 보내는 길이다.
    const form = !open ? '' : `<div class="at-send-pair"><div class="at-send-row" role="group" aria-label="과제·계정"><span class="at-label">과제·계정</span>`
      + `<input type="text" data-send="account" value="${escapeHtml(s.account)}" placeholder="직접 적기" title="과제 또는 계정을 직접 적기" aria-label="과제 또는 계정" autocomplete="off"${off} /></div>`
      + `<div class="at-send-row" role="group" aria-label="받는 사람"><span class="at-label">받는 사람</span>${person}</div></div>`
      + ways;
    // 차례(2026-10-05 사용자 지정: 보낸 기록과 증빙 목록을 가리키며 "이 부분이 보내기 아래에 위치 하도록") — 정산 내역 바로 아래에 보낼 곳과
    // `보내기`가 서고, 보낸 기록(보냈습니다 — …)과 묶이는 증빙의 목록은 `보내기` 아래다. 그 전에는 칸 머리 바로 아래였다(머리로 되돌리지 않는다).
    return `<div class="at-send" data-doc="${escapeHtml(it.docNo)}">${head(how)}${add}${sets}${form}`
      + settleNote
      + (held ? `<p class="at-send-note error at-send-held">${escapeHtml(held)}</p>` : '')
      + (s.busy ? `<p class="at-send-note">${escapeHtml(s.stage || '보내는 중...')}</p>` : '')
      + (s.error ? `<p class="at-send-note error">${escapeHtml(s.error)}</p>` : '')
      + redo
      + `<div class="at-send-btns"><button type="button" class="small at-request at-send-go" data-act="send-go" aria-haspopup="dialog" `
      + `title="${gate.settle ? `${GO_TITLE} — ` : ''}보낼 내용을 먼저 보여 줍니다"`
      + `${canGo(gate, s, ctx) && !locked ? '' : ' disabled'}>${done ? '다시 보내기' : '보내기'}</button></div>`
      + `${doneNote}${files}</div>`;
  }

  /** 글 칸을 친 뒤 — 카드를 새로 그리지 않고 버튼과 이전에 보낸 줄(켜짐, 접을 수 있는가)만 맞춘다. */
  function sync(node, ctx, s) {
    const gate = sendGate(ctx);
    const go = node.querySelector('button[data-act="send-go"]');
    if (go) go.disabled = !canGo(gate, s, ctx) || !!ctx.locked;
    for (const b of node.querySelectorAll('button[data-act="send-set"]')) {
      const on = !!box.sets[+b.dataset.i] && setOn(box.sets[+b.dataset.i], s);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const fold = node.querySelector('button[data-act="send-fold"]');
    if (fold) fold.hidden = !anyOn(s);
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
      // 사후정산을 완료한 출장이면 읽어서 사후정산에 반영하는 길로 넘긴다(ctx.read) — 읽을 길이 없으면 그대로 담는다.
      if (ctx.read) ctx.read(files);
      else addFiles(ctx, files);
    } else if (kind === 'account') {
      // 치는 칸은 펴 둔다 — 친 글이 이전에 보낸 줄과 같아져도 다음에 그릴 때 접히지 않는다.
      Object.assign(s, { account: target.value, touched: true, open: true });
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

  /**
   * 묶어서 보낸다(팝업의 보내기가 부른다). 보낸 뒤 과제·계정과 받는 사람을 한 세트로 최근 목록의 맨 앞에 기억한다.
   * 사후정산을 아직 완료하지 않은 출장이면 저장 → 확정부터 한다(2026-10-03 사용자 지정) — 어느 하나라도 안 되면 거기서 멈추고 보내지 않는다.
   * shown 은 팝업에 적혀 있던 길이다 — 지금 나가는 길이 그것과 다르면 아무것도 하지 않고 멈춘다.
   */
  async function go(ctx, shown) {
    const { it, me } = ctx;
    let { trip, stage, need } = ctx;
    const s = of(it.docNo);
    const account = s.account.trim();
    const person = s.person;
    if (s.busy || !account || !person) return;
    const step = (text) => { s.stage = text; repaint(); };
    Object.assign(s, { busy: true, error: '' });
    let way = wayNow(s);
    const name = pdfName({ trip, me });
    let failed = '';
    try {
      // 어느 길로 갈지는 보내는 그 순간에 다시 본다 — 패널을 연 뒤에 Teams MCP 를 켰거나 껐을 수 있다. 팝업에서 확인한 길과
      // 달라졌으면 다른 길로 돌려 보내지 않고, 사후정산 저장·확정도 하기 전에 멈춘다.
      step('보내는 길을 확인하는 중...');
      box.teams = await teamsState();
      way = wayNow(s);
      if (shown && way.channel !== shown.channel) {
        throw new Error(`보내는 길이 달라져 보내지 않았습니다(확인한 길: ${shown.label} → 지금: ${way.label}) — 보내기를 다시 눌러 확인해 주세요`);
      }
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
      // 출장 기간과 안 맞아 확정을 기다리는 증빙은 묶지 않는다(2026-10-05 사용자 지정) — 보관함에는 그대로 남는다.
      const kept = sendable(await evidence.list(it.docNo));
      const gate = sendGate({ trip, stage, need, kept });
      if (!gate.ready || gate.settle) throw new Error(gate.why || '사후정산이 완료되지 않아 보내지 않았습니다');
      // 확정한 여비계산서를 출력(PDF)해 증빙 앞에 붙인다(2026-10-04 사용자 지정) — 받지 못하면 증빙만 보내지 않고 멈춘다.
      // 로그인이 풀린 것은 그 말 그대로 둔다(화면이 그 글로 로그인 안내를 가린다).
      step('여비계산서를 PDF 로 받는 중...');
      const cal = await tripCalPdf(trip, { name: me, onStage: step }).catch((err) => {
        if (err.name !== 'AuthError') err.message = `여비계산서를 PDF 로 받지 못해 보내지 않았습니다 — ${err.message}`;
        throw err;
      });
      step('여비계산서와 증빙을 PDF 로 묶는 중...');
      const pdf = await buildPdf([{ name: calName({ trip }), bytes: cal.bytes }, ...kept], { title: `여비계산서 ${trip.seq} 증빙` });
      const title = sendTitle({ account, me, trip });
      const lines = sendLines({ account, me, trip, stage, reason: it.reason, kept, file: name });
      step(`${way.label}로 보내는 중...`);
      if (way.channel === 'teams') {
        await teamsSendFile({ email: `${person.id}@${MAIL_DOMAIN}`, html: memoHtml([title, ...lines]), file: { name, bytes: pdf.bytes } });
      } else {
        await memoSend({ to: [person.id], title, lines, file: { name, bytes: pdf.bytes, type: 'application/pdf' }, onStage: step });
      }
      // 보낸 곳이 맨 윗줄에 서고 켜진다 — 직접 고르던 칸은 접는다.
      box.sets = pushRecent(box.sets, { account, person, way: way.channel }, setKey);
      Object.assign(s, { want: way.channel, open: false });
      const done = { ...box.done, [it.docNo]: { at: Date.now(), channel: way.label, to: person.name || person.id, account, file: name, pages: pdf.pages } };
      box.done = Object.fromEntries(Object.entries(done).sort((a, b) => b[1].at - a[1].at).slice(0, DONE_MAX));
      await chrome.storage.local.set({ sendSets: box.sets, sendDone: box.done });
      setStatus(`${way.label}로 보냈습니다 — ${personText(person)} · ${account} · ${name}(${pdf.pages}쪽)`);
      logEvent('trip', true, `여비계산서 증빙 송부(${way.label}): ${trip.seq} → ${person.id} · ${account} · ${name} ${pdf.pages}쪽`,
        { seq: trip.seq, docNo: it.docNo, channel: way.channel, to: person.id, account, files: [calName({ trip }), ...kept.map((k) => k.name)], pages: pdf.pages });
    } catch (err) {
      s.error = failed ? `${failed}: ${err.message}` : err.message;
      setError(err, failed || '여비증빙 송부 실패');
      // 사후정산 저장·확정이 안 된 것은 attendpanel.js 가 이미 기록했다.
      if (!failed) logEvent('trip', false, `여비계산서 증빙 송부 실패(${way.label}): ${trip.seq} — ${err.message}`, { seq: trip.seq, docNo: it.docNo, channel: way.channel, to: person.id });
    } finally {
      Object.assign(s, { busy: false, stage: '' });
      repaint();
    }
  }

  /**
   * Teams 로 가려는 카드에서 Teams MCP 를 그 자리에서 다시 본다(패널을 연 뒤에 켰을 수 있다) — 닿지 않으면 까닭을 카드에 적는다
   * (길은 쪽지로 남고, 닿게 되면 Teams 로 간다). again 은 서버를 켠 뒤 무엇을 다시 누르라고 적을지다.
   */
  async function checkTeams(s, again) {
    Object.assign(s, { busy: true, stage: 'Teams MCP 가 닿는지 확인하는 중...' });
    repaint();
    box.teams = await teamsState();
    Object.assign(s, { busy: false, stage: '' });
    const why = teamsWhy(box.teams);
    if (why) s.error = `${why} — 지금은 쪽지로 갑니다${box.teams.up ? '' : `. ${WAY_RETRY} ${again} 다시 눌러 주세요`}`;
    repaint();
  }

  /** `보내는 길` 칩 — 그 카드의 길을 바꾸고, 고른 길을 기억한다(이전에 보낸 곳이 없는 카드가 이 길을 따른다). */
  async function pickWay(want, s) {
    if (!wantOf(want) || s.busy) return;
    Object.assign(s, { want, open: true, error: '' });
    box.want = want;
    if (want === 'teams') await checkTeams(s, 'Teams 를');
    else repaint();
    await chrome.storage.local.set({ sendWay: want });
  }

  /**
   * 이전에 보낸 곳의 한 줄을 지운다(2026-10-05 사용자 지정: "보내기 이력에서.. 이력을 삭제") — 패널이 기억해 둔 줄만 지운다.
   * 그 줄을 고르고 있던 카드는 비운다 — 손대지 않은 카드가 되어 남은 맨 윗줄이 다시 깔리고, 남은 줄이 없으면 직접 고르는 칸이 펴진다.
   */
  async function dropSet(i) {
    const x = box.sets[i];
    if (!x) return;
    box.sets = box.sets.filter((_, n) => n !== i);
    for (const s of Object.values(box.by)) {
      if (s.busy || s.account.trim() !== x.account || s.person?.id !== x.person.id) continue;
      clearTimeout(s.timer);
      Object.assign(s, { account: '', person: null, want: '', open: false, query: '', hits: null, hitsError: '', error: '', touched: false });
    }
    repaint();
    await chrome.storage.local.set({ sendSets: box.sets });
    setStatus(`이전에 보낸 곳에서 지웠습니다 — ${x.account} · ${whoText(x.person)}`);
  }

  /** 그 출장의 보낸 기록을 지운다 — 패널의 기록만 지운다(보낸 것이 취소되지는 않는다). 버튼은 `보내기`로 돌아간다. */
  async function dropDone(docNo) {
    const d = box.done[docNo];
    if (!d) return;
    const { [docNo]: _gone, ...left } = box.done;
    box.done = left;
    repaint();
    await chrome.storage.local.set({ sendDone: box.done });
    const what = `${stamp(d.at)} · ${d.channel} · ${d.to} · ${d.account}`;
    setStatus(`보낸 기록을 지웠습니다 — ${what}`);
    logEvent('trip', true, `여비증빙 보낸 기록 지움: ${docNo} — ${what}`, { docNo });
  }

  /** 송부 칸의 버튼을 눌렀을 때(data-act 가 send- 로 시작하는 것). */
  function click(btn, ctx) {
    const s = of(ctx.it.docNo);
    const a = btn.dataset.act;
    if (a === 'send-go') return pop(btn, ctx);
    if (a === 'send-way') return pickWay(btn.dataset.way, s);
    if (a === 'send-set-del') return s.busy ? undefined : dropSet(+btn.dataset.i);
    if (a === 'send-done-del') return s.busy ? undefined : dropDone(ctx.it.docNo);
    if (a === 'send-fold') {
      // 직접 고르는 칸을 펴고 접는다 — 고른 것은 그대로다.
      s.open = !s.open;
      repaint();
      return undefined;
    }
    if (a === 'send-set') {
      // 이전에 보낸 줄 하나가 과제·계정과 받는 사람, 보내는 길을 함께 정한다(길을 같이 기억하기 전의 줄이면 길은 그대로 둔다).
      const x = box.sets[+btn.dataset.i];
      if (!x || s.busy) return undefined;
      clearTimeout(s.timer);
      Object.assign(s, { account: x.account, person: x.person, want: wantOf(x.way) || s.want, query: '', hits: null, hitsError: '', touched: true, error: '' });
      // Teams 로 보냈던 줄인데 지금 Teams 로 못 가는 사정이면 다시 확인한다 — 닿지 않으면 까닭이 카드에 남는다.
      if (x.way === 'teams' && teamsWhy(box.teams)) return checkTeams(s, '그 줄을');
      repaint();
      return undefined;
    }
    // 아래는 직접 고르는 칸의 누름이다 — 그 칸은 펴 둔다.
    if (a === 'send-person-clear') s.person = null;
    else if (a === 'send-person') {
      const p = (s.hits || []).find((x) => x.id === btn.dataset.id);
      if (!p) return undefined;
      clearTimeout(s.timer);
      Object.assign(s, { person: p, query: '', hits: null, hitsError: '' });
    }
    Object.assign(s, { touched: true, open: true, error: '' });
    repaint();
    return undefined;
  }

  return { load, html, input, click, add: addFiles, state: box };
}
