// 신청 내역 출장 카드의 "숙박비 내역" — 사후정산 입력 화면에 **지금 있는** 숙박 줄을 가는 편·오는 편 아래에 한 줄씩 보인다
// (2026-10-03 사용자 지정: 업체명(길면 줄임)·정산금액, 화면에 세 줄이 있으면 세 줄 다, 지우기와 다시 읽기).
// 이 패널이 증빙으로 올린 줄만이 아니라 화면에서 손수 적은 줄도 보이고, 어느 쪽인지 줄마다 적는다 — 증빙 없이 적힌 줄은 "손수 작성"이다.
// 읽고 지우는 길은 src/trip.js(tripAfterLodges·tripAfterLodgeDelete)다. 카드를 그리고 누름을 넘겨 주는 것은 attendpanel.js 다.
//
// 지우기는 실제 계산서의 줄이 없어지는 일이라 두 번 눌러야 나간다 — 두 번 누르기는 attendpanel.js 가 한다(다른 버튼과 같은 길).

import { tripAfterLodges, tripAfterLodgeDelete } from './src/trip.js';
import { LOG_KEY } from './src/logbook.js';

const REFRESH_TITLE = '숙박비 내역 다시 읽기 — 사후정산 화면에서 고친 것을 가져옵니다';
const REFRESH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17"/></svg>';
/** 이 패널이 증빙으로 올린 숙박 줄의 표시 — { [계산서 번호]: { [숙박 줄 번호]: 파일 이름 } }. 올릴 때 attendpanel.js 의 runAfter 가 적는다. */
const MINE_KEY = 'attendLodgeMine';
/** 보관함에서 숙박 증빙을 부르는 이름(src/after.js 의 evidenceOf). */
const LODGE_LABEL = '숙박 증빙';
const HAND_TITLE = '이 패널에서 올린 증빙으로 작성한 줄이 아닙니다 — 사후정산 화면에서 손수 작성한 줄입니다';
/** 표시(증빙·손수 작성)의 풍선말 꼬리 — 누르면 그 줄의 내용이 펴진다. */
const INFO_HOW = ' · 누르면 내용이 보입니다';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const day = (s) => (DATE_RE.test(s || '') ? `${+s.slice(5, 7)}/${+s.slice(8)}` : '');
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null; };

/** 정산금액을 화폐와 함께 — 원화는 "125,052원", 외화는 "88.46 USD". */
export function lodgeAmount(row) {
  const n = num(row?.total);
  if (n == null) return '금액 ?';
  const text = n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return !row.currency || row.currency === 'KRW' ? `${text}원` : `${text} ${row.currency}`;
}

/**
 * 그 줄이 어디서 왔는가 — 이 패널이 증빙으로 올린 줄이면 그 파일 이름, 아니면 빈 글(화면에서 손수 적은 줄).
 * 올릴 때 적어 둔 표시(줄 번호 → 파일 이름)가 먼저다. 표시를 적기 전에 올린 줄은 보관함의 숙박 증빙 가운데 금액이 같은 것,
 * 그것도 없으면 활동 기록에 남은 "사후정산 작성"의 숙박 줄(박 수·정산금액이 같은 것)로 알아본다 — 붙여 넣은 그림은 이름이 같아
 * (image.png) 보관함에는 마지막 한 장만 남지만, 올린 것은 기록에 다 남아 있다.
 * @param {{seq:string,total:string,sday?:string,currency?:string}} row 화면의 숙박 줄
 * @param {Record<string,string>} mine 이 계산서의 표시
 * @param {{name:string,label:string,total:number|null}[]} kept 보관함의 증빙
 * @param {{text:string,file:string}[]} logged 활동 기록에서 추린 이 계산서의 "사후정산 작성"
 */
export function lodgeSource(row, mine = {}, kept = [], logged = []) {
  if (mine?.[row.seq]) return String(mine[row.seq]);
  const total = num(row.total);
  if (total == null) return '';
  const hit = (kept || []).find((k) => k.label === LODGE_LABEL && k.total != null && Number(k.total) === total);
  if (hit) return hit.name;
  // 기록의 글은 src/after.js 의 afterSummary 가 쓴 것이다 — "숙박 업체명 1박 88.46 USD".
  const said = (logged || []).find((l) => l.text.includes(` ${Number(row.sday)}박 ${lodgeAmount(row)}`));
  return said ? said.file || '올린 증빙' : '';
}

/** 활동 기록에서 그 계산서의 사후정산을 올린 기록만 추린다(성공한 것). file 은 그때 넣은 파일 이름들이다. */
export function lodgeLogged(entries, seq) {
  const head = `여비계산서(사후정산) 작성: ${seq} ·`;
  return (Array.isArray(entries) ? entries : []).filter((e) => e?.kind === 'trip' && e.ok && String(e.text || '').startsWith(head))
    .map((e) => ({ text: e.text, file: (Array.isArray(e.data?.files) ? e.data.files : []).join(' · ') }));
}

/**
 * @param {{escapeHtml:Function, logEvent:Function, setStatus:Function, setError:Function, repaint:Function}} deps
 *   repaint 는 신청 내역을 다시 그리는 길이다
 */
export function createLodgeBox({ escapeHtml, logEvent, setStatus, setError, repaint }) {
  // by 는 계산서마다의 사정이다: rows 는 화면에서 읽은 숙박 줄(아직 못 읽었으면 null), mine 은 저장해 둔 표시,
  // logged 는 활동 기록에 남은 이 계산서의 "사후정산 작성", busy 는 지우는 중인 줄 번호, error 는 읽거나 지우다 난 일이다.
  const box = { by: {} };
  const of = (seq) => box.by[seq] || (box.by[seq] = { rows: null, mine: {}, logged: [], loading: false, busy: '', error: '' });
  const what = (row) => `${row.company || '업체명 없음'} · ${day(row.paydate) || '결제일 ?'} · ${lodgeAmount(row)}`;

  async function load(ctx, { quiet = true } = {}) {
    const { trip, trseq } = ctx;
    const s = of(trip.seq);
    if (s.loading || s.busy) return;
    Object.assign(s, { loading: true, error: '' });
    if (!quiet) repaint();
    try {
      const [rows, saved] = await Promise.all([tripAfterLodges(trip.seq, trseq), chrome.storage.local.get([MINE_KEY, LOG_KEY])]);
      Object.assign(s, { rows, mine: saved?.[MINE_KEY]?.[trip.seq] || {}, logged: lodgeLogged(saved?.[LOG_KEY], trip.seq) });
      if (!quiet) setStatus(`숙박비 내역을 다시 읽었습니다 — ${rows.length ? `${rows.length}줄` : '없음'} · 여비계산서 ${trip.seq}`);
    } catch (err) {
      s.error = `숙박비 내역을 읽지 못했습니다: ${err.message}`;
      if (!quiet) setError(err, '숙박비 내역 읽기 실패');
    } finally {
      s.loading = false;
      repaint();
    }
  }

  /** 열어 둔 카드의 숙박 줄을 한 번 읽어 둔다. 이미 읽었거나 읽는 중이거나 못 읽었으면(다시 읽기는 버튼으로) 두 번 하지 않는다. */
  function ensure(ctx) {
    if (!ctx?.trip || !ctx.trseq) return;
    const s = of(ctx.trip.seq);
    if (!s.rows && !s.loading && !s.error) load(ctx);
  }

  /** 다시 읽는다 — 새로고침 버튼(quiet 가 아니면 상태 줄에 적는다)과, 사후정산을 올린 뒤. */
  const reload = (ctx, { quiet = false } = {}) => (ctx?.trip && ctx.trseq ? load(ctx, { quiet }) : Promise.resolve());

  /** 지우려는 줄을 한 줄로 — 첫 번째 누름에서 상태 줄에 적어 무엇이 지워지는지 보인다. */
  function describe(seq, lodgeSeq) {
    const row = of(seq).rows?.find((r) => r.seq === String(lodgeSeq));
    return row ? what(row) : '';
  }

  /** 저장해 둔 표시에서 그 줄을 뺀다. 못 고쳐도 지운 것은 지운 것이라 던지지 않는다. */
  async function forget(ctx, lodgeSeq) {
    delete of(ctx.trip.seq).mine[lodgeSeq];
    if (ctx.mine) delete ctx.mine[lodgeSeq];
    try {
      const all = (await chrome.storage.local.get(MINE_KEY))?.[MINE_KEY];
      const marks = all?.[ctx.trip.seq];
      if (!marks) return;
      delete marks[lodgeSeq];
      if (!Object.keys(marks).length) delete all[ctx.trip.seq];
      await chrome.storage.local.set({ [MINE_KEY]: all });
    } catch { /* 표시는 다음에 읽을 때 화면의 줄과 맞지 않아도 해가 없다 */ }
  }

  /** 숙박 줄 하나를 사후정산에서 지운다(두 번째 누름). 지운 뒤의 줄은 화면을 다시 읽은 것이다. */
  async function remove(ctx, lodgeSeq) {
    const { trip, trseq } = ctx;
    const s = of(trip.seq);
    const row = s.rows?.find((r) => r.seq === String(lodgeSeq));
    if (!row || s.busy || s.loading) return;
    const text = what(row);
    Object.assign(s, { busy: row.seq, error: '' });
    repaint();
    try {
      s.rows = await tripAfterLodgeDelete(trip.seq, trseq, row.seq);
      await forget(ctx, row.seq);
      setStatus(`숙박 줄을 지웠습니다 — ${text} · 여비계산서 ${trip.seq}`);
      logEvent('trip', true, `여비계산서(사후정산) 숙박 줄 삭제: ${trip.seq} · ${text}`, { seq: trip.seq, lodgeSeq: row.seq });
    } catch (err) {
      s.error = `숙박 줄을 지우지 못했습니다: ${err.message}`;
      setError(err, '숙박 줄 삭제 실패');
      logEvent('trip', false, `여비계산서(사후정산) 숙박 줄 삭제 실패: ${trip.seq} · ${text} — ${err.message}`, { seq: trip.seq, lodgeSeq: row.seq });
    } finally {
      s.busy = '';
      repaint();
    }
  }

  /**
   * 출장 카드의 숙박비 내역. 출장자 번호가 없으면(사후정산을 쓸 단계가 아니다) 빈 글이다.
   * @param {{trip:object, trseq:string, kept?:object[], mine?:Record<string,string>, locked?:boolean, lodging?:boolean,
   *          open?:string, detail?:(row:object, source:string) => string}} ctx
   *   trip 은 여비계산서 목록의 한 줄, kept 는 보관함의 증빙, mine 은 이 패널이 올린 줄의 표시(패널이 들고 있는 것),
   *   locked 는 카드가 다른 일을 하는 중인가, lodging 은 숙박이 있는 출장인가(당일 출장은 줄이 있을 때만 보인다),
   *   open 은 내용을 펴 둔 줄의 번호, detail 은 그 줄 아래에 펼 내용(HTML — 카드가 짓는다)
   */
  function html(ctx) {
    const { trip, trseq, kept = [], locked = false, lodging = false } = ctx || {};
    if (!trip || !trseq) return '';
    const s = of(trip.seq);
    if (!s.rows && !s.error) return lodging ? '<div class="at-lodges"><p class="at-lodge-note">숙박비 내역을 읽는 중...</p></div>' : '';
    const rows = s.rows || [];
    if (!rows.length && !lodging && !s.error) return '';
    const off = locked || s.busy || s.loading ? ' disabled' : '';
    const mine = { ...s.mine, ...ctx.mine };
    const sources = rows.map((r) => lodgeSource(r, mine, kept, s.logged));
    const hand = sources.filter((x) => !x).length;
    const count = !s.rows ? '' : !rows.length ? '사후정산 화면에 아직 없습니다' : `${rows.length}줄${hand ? ` · 손수 작성 ${hand}줄` : ''}`;
    const head = `<div class="at-lodge-head"><strong>숙박비 내역</strong><span class="at-lodge-count">${escapeHtml(count)}</span>`
      + `<button type="button" class="small ghost at-lodge-refresh${s.loading ? ' spin' : ''}" data-act="lodge-refresh" title="${REFRESH_TITLE}" aria-label="${REFRESH_TITLE}"`
      + `${locked || s.busy || s.loading ? ' disabled' : ''}>${REFRESH_ICON}</button></div>`;
    const line = (r, i) => {
      const name = r.company || '업체명 없음';
      // 표시는 누르는 것이다(2026-10-03 사용자 지정) — 누르면 그 줄 아래에 올린 내용(손수 작성한 줄이면 화면의 값)이 펴지고, 다시 누르면 접힌다.
      // 무엇을 펴 보일지는 카드(attendpanel.js)가 정한다: ctx.open 은 펴 둔 줄 번호, ctx.detail 은 그 줄의 내용(HTML)이다.
      const open = !!ctx.detail && ctx.open === r.seq;
      const info = `data-act="lodge-info" data-lodge="${escapeHtml(r.seq)}" aria-expanded="${open}"`;
      const src = sources[i]
        ? `<button type="button" class="at-lodge-src" ${info} title="${escapeHtml(`이 패널에서 증빙(${sources[i]})으로 올린 줄입니다${INFO_HOW}`)}">증빙</button>`
        : `<button type="button" class="at-lodge-src hand" ${info} title="${HAND_TITLE}${INFO_HOW}">손수 작성</button>`;
      const del = `이 숙박 줄을 사후정산에서 지우기 — ${what(r)}`;
      // 업체명은 좁으면 줄임표로 잘린다(CSS) — 전체 이름은 풍선말에 있다. 박 수도 거기에 둔다.
      return `<div class="at-lodge${s.busy === r.seq ? ' busy' : ''}" data-lodge="${escapeHtml(r.seq)}">`
        + `<span class="at-leg-name">숙박 <span class="at-leg-day">${day(r.paydate)}</span></span>`
        + `<span class="at-lodge-company" title="${escapeHtml(`${name}${r.sday ? ` · ${r.sday}박` : ''}`)}">${escapeHtml(name)}</span>`
        + `<span class="at-lodge-total">${escapeHtml(lodgeAmount(r))}</span>${src}`
        + `<button type="button" class="small ghost at-lodge-del" data-act="lodge-del" data-lodge="${escapeHtml(r.seq)}" title="${escapeHtml(del)}" aria-label="${escapeHtml(del)}"${off}>×</button></div>`
        + (open ? `<div class="at-lodge-info">${ctx.detail(r, sources[i])}</div>` : '');
    };
    return `<div class="at-lodges" data-seq="${escapeHtml(trip.seq)}">${head}${rows.length ? `<div class="at-lodge-rows">${rows.map(line).join('')}</div>` : ''}`
      + (s.error ? `<p class="at-lodge-note error">${escapeHtml(s.error)}</p>` : '') + '</div>';
  }

  return { html, ensure, reload, remove, describe, state: box };
}
