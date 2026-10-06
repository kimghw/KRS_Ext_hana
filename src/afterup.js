// 홈의 WORKSPACE 카드에서 넣은 숙박 증빙·항공권을 **넣은 그 자리에서** 사후정산에 올리는 길
// (2026-10-04 사용자 지정: "올리면 바로 사후등록 하게 해줘, 항공권도 동일하게").
//
// 처음에는 홈 카드가 읽어서 보관만 하고 사후정산은 패널의 출장 카드에서 버튼으로 올렸다. 이제는 홈 카드가 증빙을 보관한 뒤 곧바로
// 이 길로 올린다 — 패널의 출장 카드에 넣었을 때와 같은 차례다(attendpanel.js 의 runAfter): 그때 읽은 기록으로 묶고(다시 읽지 않는다),
// 사전정산을 아직 완료하지 않았으면 확정부터 하고, 숙박비 상한액을 읽어 정산금액을 정한 뒤 사후정산 입력 화면의 폼으로 올린다.
//
// 홈 카드는 eclass 와 같은 출처라 여비계산서 화면을 여기서 바로 읽고 쓴다(src/trip.js). 보관함(확장의 IndexedDB)은 못 읽으므로
// 읽은 기록·파일·"아직 안 올림" 표시는 배경에 부탁한다(background.js 의 evidenceGiven·evidenceFile·evidenceDone).
//
// **숙박비가 상한액을 넘으면 넣은 자리에서 묻는다**(2026-10-05 사용자 지정: "홈 줄에서 바로 고르기: 넣은 자리에서 상한액/실제 금액 버튼이
// 뜹니다. 그리고 상한액의 1.5배는 부서장 승인") — 올리지 않고 무엇을 고를지(ask — src/after.js 의 lodgeChoices: 상한액으로 / 실제 금액으로,
// 1.5배 이내면 부서장 승인)를 돌려주고, 홈 카드가 그 줄에 버튼을 세운다. 고른 것(settle)을 들고 다시 부르면 그 금액으로 올린다.
//
// **올리지 않고 남겨 두는 때**(hold) — 표시(todo)는 그대로이고, 패널의 출장 카드에 `홈에서 넣은 증빙을 사후정산에 올리기` 버튼이 선다:
//   - 외화 문서인데 원화로 결제한 금액이 문서에 없다(src/after.js 의 lodgeAsk 'krw') — 금액을 적어야 해서 패널의 카드가 묻는다.
//   - 필수 값을 읽지 못했다(afterPlan 의 problems).
//   - 교통비 내역을 바꿔야 하는데 값을 모르는 편이 있다(항공권이 없는 비행기 편 등) — 아는 편만 올리면 화면에 있던 줄이 지워진다.
//   - 사이트가 받지 않았다(로그인 만료 등).
//
// 이 파일은 DOM 을 만지지 않는다. 사이트와 말하는 길(site)·배경에 부탁하는 길(given·fileOf·done·log)·저장소는 주입받는다.

import { afterPlan, afterSummary, lodgeAsk, lodgeSettle, lodgeSame, lodgeChoices, lodgeDecide, lodgeKnown, lodgeApproval } from './after.js';
import { tripStage } from './travel.js';
import { noteStages } from './settling.js';

/** 패널의 출장 카드에서 고른 가는 편·오는 편, 근무지에 적어 둔 글, 이 확장이 올린 숙박 줄의 표시 — 패널(attendpanel.js)이 쓰는 storage 키다. */
const PICKS_KEY = 'attendLegs';
const WORKPLACE_KEY = 'attendWorkplace';
const MINE_KEY = 'attendLodgeMine';
/** 이 확장이 올린 숙박 줄의 실제 금액 — 패널 숙박비 내역의 `상한` 버튼이 상한액에서 실제 금액으로 되돌릴 때 쓴다(lodgebox.js 의 ACTUAL_KEY). */
const ACTUAL_KEY = 'attendLodgeActual';

/**
 * 홈 카드가 그 출장의 증빙을 받아 올리는 동안 적어 두는 storage 키 — { 신청서 번호: 시작한 때 }.
 * 그동안 패널의 출장 카드는 같은 증빙을 올리는 버튼을 받지 않는다(같은 숙박 줄이 두 번 올라가지 않게).
 * 홈 탭이 도중에 닫히면 지워지지 않으므로 UP_BUSY_MS 가 지나면 없는 것으로 친다.
 */
export const UP_BUSY_KEY = 'afterUpBusy';
export const UP_BUSY_MS = 3 * 60_000;
export const upBusy = (saved, docNo, now = Date.now()) => now - (Number(saved?.[docNo]) || 0) < UP_BUSY_MS;

const FLIGHT = /^flight_/;
/** 패널에서 올리라는 꼬리말 — 남겨 둔 증빙은 패널의 출장 카드가 올린다(물을 것은 거기서 묻는다). */
export const PANEL_HOW = '예약 패널의 출장 카드에서 올려 주세요';
/** 상한액을 넘는 숙박이 있어 고르기를 기다릴 때 출장 줄에 적는 말 — 그 아래에 묻는 말(lodgeChoices 의 question)과 고르는 버튼이 선다. */
export const ASK_TEXT = '사후정산은 아직 올리지 않았습니다 — 아래에서 정산금액을 골라 주세요';
/** 숙박 줄을 가리키는 열쇠 — 그 줄을 이룬 증빙 파일 이름들이다. 다시 묶어도(같은 증빙이면) 같은 열쇠가 나온다. */
export const lodgeKey = (l) => (l?.sources || []).join(' | ');

/** 배경(서비스 워커)에 부탁한다. 답이 없거나 못 했다고 하면 던진다. */
async function ask(msg) {
  const r = await chrome.runtime.sendMessage(msg);
  if (!r?.ok) throw new Error(r?.error || '응답이 없습니다');
  return r;
}
const defaultGiven = async (docNo) => (await ask({ type: 'evidenceGiven', docNo })).items || [];
const defaultFileOf = async (docNo, name) => (await ask({ type: 'evidenceFile', docNo, name })).dataUrl || '';
const defaultDone = (docNo, names) => ask({ type: 'evidenceDone', docNo, names });
const defaultLog = (ok, text, data) => chrome.runtime.sendMessage({ type: 'tripLog', ok, text, data });
/** 여비계산서와 말하는 길(src/trip.js). 올릴 때만 불러온다. */
async function defaultSite() {
  const t = await import('./trip.js');
  return { list: t.tripList, preDetail: t.tripPreDetail, preConfirm: t.tripPreConfirm, lodgeMax: t.tripLodgeMax, haveLodges: t.tripAfterLodges, afterSave: t.tripAfterSave };
}

/**
 * 그 출장의 보관함에서 홈 카드가 넣어 둔 증빙(사후정산에 아직 안 올린 숙박 증빙·항공권)을 사후정산에 올린다. 던지지 않는다.
 *
 * 앞서 올린 항공권(표시는 걷혔고 읽은 기록은 남아 있다)도 같이 묶는다 — 가는 편 항공권을 먼저, 오는 편 항공권을 나중에 넣어도
 * 두 편이 다 비행기로 올라간다(따로 묶으면 나중 것만 남고 앞의 편은 값을 모르는 편이 된다).
 *
 * @param {{docNo: string, row: {seq: string, from: string, to: string}, me?: string, settle?: Record<string, 'cap'|'real'>}} trip
 *   docNo 는 HR 출장 신청서 번호, row 는 그 출장의 여비계산서, settle 은 상한액을 넘는 숙박 줄에 사람이 고른 것(lodgeKey → 상한액으로 / 실제 금액으로)
 * @param {{given?: Function, fileOf?: Function, done?: Function, log?: Function, site?: object, storage?: object, onStage?: Function}} [deps]
 * @returns {Promise<{ok: boolean, sent: boolean, hold: boolean, text: string,
 *                    ask?: {key: string, question: string, choices: {settle: string, label: string, note?: string}[]}[]}>}
 *   sent 는 사이트에 올렸는가, hold 는 올리지 않고 남겨 두었는가, text 는 출장 줄에 적을 한 줄(올릴 것이 없었으면 빈 글).
 *   ask 가 있으면 상한액을 넘는 숙박 줄마다 무엇을 고를지다 — 고른 것을 settle 에 담아 다시 부른다(ask 없이 hold 면 패널에서 올린다)
 */
export async function afterUp({ docNo, row, me = '', settle = {} } = {}, deps = {}) {
  const { given = defaultGiven, fileOf = defaultFileOf, done = defaultDone, log = defaultLog, onStage = () => {} } = deps;
  const storage = deps.storage || chrome.storage.local;
  const held = (why) => ({ ok: false, sent: false, hold: true, text: `사후정산에는 올리지 않았습니다 — ${why} · ${PANEL_HOW}` });
  const note = (ok, text, data) => Promise.resolve().then(() => log(ok, text, { docNo, seq: row?.seq, from: 'home', ...data })).catch(() => {});
  let names = [];
  try {
    // 출장 기간과 안 맞아 알림 표시로 둔 증빙(warn)은 확정하기 전에는 올리지 않는다(2026-10-05 사용자 지정) — 배경도 주지 않는다.
    const items = (await given(docNo)).filter((k) => k.record && !k.warn);
    const todo = items.filter((k) => k.todo);
    if (!todo.length) return { ok: true, sent: false, hold: false, text: '' };
    names = todo.map((k) => k.name);
    const site = deps.site || await defaultSite();

    // 담아 둔 여비계산서 목록은 하루에 한 번 읽은 것이다 — 단계와 출장자 번호는 지금 것을 본다.
    onStage('여비계산서를 확인하는 중...');
    const list = await site.list({ from: row.from, to: row.to });
    const name = list.me || me;
    let cur = list.rows.find((r) => r.seq === row.seq);
    if (!cur) throw new Error('여비계산서를 목록에서 찾지 못했습니다.');
    const first = tripStage(cur, name);
    if (first.phase === 'post' && first.done) {
      // 사후정산이 이미 완료됐다 — 올릴 수 없다. 증빙은 보낼 때 같이 가므로 표시만 걷는다.
      await done(docNo, names);
      return { ok: true, sent: false, hold: false, text: '사후정산이 이미 완료돼 있어 올리지 않았습니다 — 증빙은 담당자에게 보낼 때 같이 갑니다' };
    }

    const saved = await storage.get([PICKS_KEY, WORKPLACE_KEY]);
    const records = items.filter((k) => k.todo || FLIGHT.test(k.record.docType || ''))
      .map((k) => ({ ...k.record, file: { name: k.name, type: k.type || '', dataUrl: '' } }));
    const detail = await site.preDetail(cur.seq);
    const plan = afterPlan(records, { trip: cur, detail, picks: saved?.[PICKS_KEY]?.[docNo] || {}, workplace: typeof saved?.[WORKPLACE_KEY] === 'string' ? saved[WORKPLACE_KEY] : '' });
    if (plan.problems.length) return held(plan.problems.join(' · '));
    if (!plan.need.needed || (!plan.lodge.length && !plan.trans.length)) {
      // 사후정산에 넣을 것이 없는 증빙이다(당일 출장의 숙박 영수증 등) — 보관은 돼 있고, 더 할 일이 없으니 표시를 걷는다.
      await done(docNo, names);
      return { ok: true, sent: false, hold: false, text: !plan.need.needed ? '당일 출장이고 비행기를 타지 않아 사후정산은 올리지 않습니다'
        : `사후정산에 넣을 내역이 없어 올리지 않았습니다 — ${plan.skipped[0] || plan.notes[0] || '숙박 증빙이나 항공권이 아닙니다'}` };
    }
    // 교통비 줄을 올리면 화면에 있던 교통 줄은 지워지고 새 줄로 바뀐다(src/after.js 의 afterFields) — 값을 모르는 편이 있으면 그 편이 빠진다.
    const blind = plan.trans.length ? plan.legs.filter((l) => l.pick?.t && !l.row) : [];
    if (blind.length) return held(blind.map((l) => `${l.label}: ${l.problem}`).join(' · '));

    // 사후정산을 올리려면 사전정산이 완료(확정)돼 있어야 한다 — 아직이면 확정한다(패널의 출장 카드에 증빙을 넣었을 때와 같다).
    let confirmed = false;
    if (first.phase === 'pre' && !first.done) {
      const r = await site.preConfirm(cur, { name, onStage });
      cur = r.row;
      confirmed = r.sent;
      note(true, r.sent ? `여비계산서 사전정산 완료(확정): ${cur.seq}` : `여비계산서 사전정산이 이미 완료돼 있음: ${cur.seq}`, { sent: r.sent });
      noteStages({ rows: [cur], me: name, from: cur.from, to: cur.to }, { storage }).catch(() => {});
    }
    const trseq = (cur.travelers.find((t) => t.name === name) || cur.travelers[0])?.trseq || '';

    // 숙박 줄의 정산금액 — 사이트의 상한액을 붙여 정한다. 상한액을 넘는 줄은 사람이 고른 것(settle)대로 정하고(src/after.js 의
    // lodgeDecide — 실제 금액으로 정산하면 부서장 승인 알림이 붙는다), 아직 고르지 않았으면 올리지 않고 무엇을 고를지 돌려준다
    // (홈 카드가 그 줄에 버튼을 세운다). 외화 문서의 원화 금액은 적어야 하는 것이라 패널의 카드가 묻는다.
    if (plan.lodge.length) onStage('숙박비 상한액을 확인하는 중...');
    // 이미 사후정산에 올라가 있는 숙박 줄은 다시 묻지 않는다(2026-10-05 사용자 지정: "이게 확인이 안되나? 출장이랑 맞잖아") —
    // 화면의 숙박 줄을 읽어 같은 줄이 있으면 그 금액으로 정한다. 그러면 아래에서 같은 줄로 걸러져 올라가지 않고 표시만 걷힌다.
    let have = null;
    for (const l of plan.lodge) {
      lodgeSettle(Object.assign(l, await site.lodgeMax(trseq, l.nation, l.currency)));
      let how = settle?.[lodgeKey(l)];
      if (lodgeAsk(l) === 'cap' && how !== 'cap' && how !== 'real' && site.haveLodges) {
        have ??= await Promise.resolve().then(() => site.haveLodges(cur.seq, trseq)).catch(() => []);
        how = lodgeKnown(l, have);
      }
      if (lodgeAsk(l) === 'cap' && (how === 'cap' || how === 'real')) lodgeDecide(plan, l, how);
    }
    const open = plan.lodge.filter(lodgeAsk);
    if (open.some((l) => lodgeAsk(l) === 'krw')) return held('외화 문서라 원화로 결제한 금액을 적어야 합니다');
    if (open.length) {
      const ask = open.map((l) => ({ key: lodgeKey(l), ...lodgeChoices(l) }));
      if (ask.some((a) => !a.choices?.length)) return held('숙박비가 상한액을 넘어 어느 금액으로 정산할지 골라야 합니다');
      return { ok: true, sent: false, hold: true, ask, text: `${confirmed ? '사전정산을 완료(확정)했습니다 · ' : ''}${ASK_TEXT}` };
    }
    // 숙박 줄의 첨부 — 파일은 보관함에 있다. 못 꺼내도 값은 올라간다.
    for (const l of plan.lodge) {
      if (!l.file) continue;
      l.file.dataUrl = await fileOf(docNo, l.file.name).catch(() => '');
      if (!l.file.dataUrl) l.file = null;
    }

    const r = await site.afterSave(cur, trseq, plan, { name, onStage });
    await done(docNo, names);
    await remember(storage, { docNo, seq: cur.seq, plan, lodgeRows: r.lodgeRows });
    if (!r.sent) return { ok: true, sent: false, hold: false, text: '같은 숙박 줄이 사후정산에 이미 있어 다시 올리지 않았습니다' };
    const sent = { ...plan, lodge: plan.lodge.filter((l) => !r.same.includes(l)) };
    const summary = afterSummary(sent);
    // 패널의 출장 카드가 남기는 기록과 같은 머리다 — 숙박비 내역이 이 기록으로 "증빙으로 올린 줄"을 알아본다(lodgebox.js 의 lodgeLogged).
    note(true, `여비계산서(사후정산) 작성: ${cur.seq} · ${summary} · 홈 카드에서 넣은 증빙`,
      { files: names, notes: plan.notes, skipped: plan.skipped, lodgeSeqs: r.lodgeSeqs, ...(Object.keys(settle || {}).length ? { settle } : {}) });
    noteStages({ rows: [r.row || cur], me: name, from: cur.from, to: cur.to }, { storage }).catch(() => {});
    // brief 는 접어 둔 알림에 적을 한 줄이다(홈 줄은 알림을 접어 두고, 펴면 text 전부가 보인다) — 무엇이 올라갔는지와, 승인을 받아야
    // 하는 줄이 있으면 그 사실만 적는다. 그 밖의 알림(추가 정보 등)은 펴야 보인다.
    const head = `${confirmed ? '사전정산을 완료(확정)하고 ' : ''}사후정산을 올렸습니다 — ${summary}`;
    const approvals = [...new Set(sent.lodge.map((l) => lodgeApproval(l).split(' — ')[0]).filter(Boolean))];
    return { ok: true, sent: true, hold: false, brief: [head, ...approvals].join(' · '), text: [head, ...plan.notes].join(' · ') };
  } catch (err) {
    const why = err?.message || String(err);
    note(false, `여비계산서(사후정산) 실패: ${row?.seq} — ${why} · 홈 카드에서 넣은 증빙`, { files: names });
    return { ok: false, sent: false, hold: true, text: `사후정산에 올리지 못했습니다 — ${why} · ${PANEL_HOW}` };
  }
}

/**
 * 올린 뒤에 패널이 볼 것을 적어 둔다 — 표를 앉힌 뒤의 가는 편·오는 편(홈 카드의 아이콘과 패널의 출장 카드가 본다)과,
 * 이 확장이 올린 숙박 줄의 표시(줄 번호 → 증빙 파일 이름, 패널의 숙박비 내역이 "증빙"이라고 적는다)와 실제 금액(문서의 공급가액·부가세도 —
 * 패널의 `상한` 버튼이 상한액에서 실제 금액으로 되돌릴 때 쓴다). 못 적어도 올린 것은 올린 것이다.
 */
async function remember(storage, { docNo, seq, plan, lodgeRows }) {
  try {
    const saved = await storage.get([PICKS_KEY, MINE_KEY, ACTUAL_KEY]);
    const next = {};
    if (plan.picks?.go || plan.picks?.back) next[PICKS_KEY] = { ...saved?.[PICKS_KEY], [docNo]: plan.picks };
    if (lodgeRows?.length) {
      const mine = { ...saved?.[MINE_KEY]?.[seq] };
      const actual = { ...saved?.[ACTUAL_KEY]?.[seq] };
      for (const h of lodgeRows) {
        const l = plan.lodge.find((x) => lodgeSame(x, h));
        mine[h.seq] = l?.sources.join(' · ') || '';
        const krw = l?.doc?.currency === 'KRW';
        if (l?.actual != null) actual[h.seq] = { actual: l.actual, supply: krw ? l.doc.supply ?? null : null, vat: krw ? l.doc.vat ?? null : null };
      }
      next[MINE_KEY] = { ...saved?.[MINE_KEY], [seq]: mine };
      if (Object.keys(actual).length) next[ACTUAL_KEY] = { ...saved?.[ACTUAL_KEY], [seq]: actual };
    }
    if (Object.keys(next).length) await storage.set(next);
  } catch { /* 표시는 곁다리다 */ }
}
