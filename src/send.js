// 여비계산서 증빙 송부의 순수 로직 — 언제 보낼 수 있는지, 무엇을 어떤 글로 보내는지, 최근에 쓴 과제·계정을 어떻게 기억하는지.
// 화면은 sendbox.js, PDF 로 묶는 일은 src/pdf.js, 보내는 길은 src/teams.js(Teams MCP)와 src/memo.js(eclass 쪽지)다.
//
// 사용자가 정한 규칙(2026-10-03):
//   - 숙박도 비행기도 없으면(당일) **사전정산을 마친 뒤** 당일증빙을 PDF 로 해서 보낸다.
//   - 숙박했거나 비행기를 탔으면 **사후정산이 완료된 뒤** 관련 증빙을 PDF 하나로 묶어 보낸다.
//     사후정산을 아직 완료하지 않았으면 송부 칸에 `사후정산 저장`과 `보내기`가 서고, 보내기가 저장 → 확정 → 송부를 잇는다.
//   - Teams MCP 가 연결돼 있으면 Teams 로, 아니면 쪽지로 보낸다. 어느 길로 보낼지는 송부 칸의 `보내는 길` 칩으로 고를 수 있다
//     (2026-10-04 사용자 지정) — 쪽지를 고르면 Teams MCP 가 연결돼 있어도 쪽지로 간다.
//   - 보내는 PDF 의 맨 앞은 **확정한 여비계산서의 출력**이다(2026-10-04 사용자 지정: "확정한 다음에 출력해서 증빙들과 합쳐서 보내야지").
//     계산서를 PDF 로 받지 못하면 보내지 않는다(src/calpdf.js, sendbox.js 의 go).
//   - 보낼 때 어떤 과제 또는 계정인지 묻는다 — 이전에 보낸 세 곳에서 고르거나 직접 적는다. 이전에 보낸 곳은 과제·계정 · 받는 사람 ·
//     보내는 길이 한 줄이고, 줄을 고르면 그 셋으로 보낸다(2026-10-04 사용자 지정: "3개 정도 리스트해서 이전 보낸 정보로").
//   - 보내는 글의 형식은 만든 뒤에 사용자가 검토한다 → 글은 sendTitle·sendLines 두 함수에만 있다.

/** 이전에 보낸 곳을 몇 줄까지 기억하고 보이는가(과제·계정 + 받는 사람 + 보내는 길). */
export const RECENT_MAX = 3;

/** 최근 목록의 맨 앞에 넣는다 — 같은 것이 있으면 앞으로 옮기고, RECENT_MAX 개를 넘으면 오래된 것을 버린다. */
export function pushRecent(list, value, keyOf = (x) => x) {
  if (value == null || value === '') return (list || []).slice(0, RECENT_MAX);
  const key = keyOf(value);
  return [value, ...(list || []).filter((x) => keyOf(x) !== key)].slice(0, RECENT_MAX);
}

/**
 * 지금 보낼 수 있는가. kind 는 'day'(당일·비행기 없음 — 사전정산 뒤에 보낸다)·'after'(숙박·비행기 — 사후정산 완료 뒤에 보낸다).
 * @param {{trip: object|null, stage: {phase:'pre'|'post', done:boolean}|null, need: {needed:boolean}|null, kept: object[]}} ctx
 *   trip 은 여비계산서, stage 는 그 단계(src/travel.js tripStage), need 는 사후정산 대상인가(src/after.js afterNeed — 사전정산의
 *   교통편을 아직 못 읽었으면 null), kept 는 보관함의 증빙이다
 * @returns {{ready: boolean, staged: boolean, settle: boolean, kind: 'day'|'after'|'', why: string}} staged 는 정산이 보낼 단계까지 왔는가
 *   (증빙만 있으면 된다), settle 은 사후정산을 아직 완료하지 않았는가 — 보내기가 사후정산을 저장하고 확정한 뒤에 보낸다(2026-10-03
 *   사용자 지정). ready 가 거짓이면 why 가 그 까닭이다
 */
export function sendGate({ trip, stage, need, kept }) {
  const wait = (kind, why) => ({ ready: false, staged: false, settle: false, kind, why });
  if (!trip || !stage) return wait('', '여비계산서가 있어야 보낼 수 있습니다');
  if (stage.phase !== 'post' && !need) return wait('', '사전정산의 교통편을 확인하는 중입니다');
  const kind = stage.phase === 'post' || need.needed ? 'after' : 'day';
  if (stage.phase === 'pre' && !stage.done) {
    return wait(kind, kind === 'after' ? '사전정산을 완료한 뒤에 사후정산을 저장하고 보냅니다' : '사전정산이 완료된 뒤에 보냅니다');
  }
  const settle = kind === 'after' && !(stage.phase === 'post' && stage.done);
  if (!kept?.length) {
    return { ready: false, staged: true, settle, kind, why: kind === 'day' ? '당일증빙(출장지에서 결제한 영수증)을 넣어 주세요' : '보낼 증빙이 없습니다 — 증빙을 넣어 주세요' };
  }
  return { ready: true, staged: true, settle, kind, why: '' };
}

/** 사후정산을 확정한 뒤의 단계 이름 — 보내기 전의 "보낼 내용"에 적는다(보낼 때는 확정이 끝나 있다). */
export const SETTLED_LABEL = '사후정산 완료';

/** 고를 수 있는 길 — 송부 칸의 `보내는 길` 칩이다(2026-10-04 사용자 지정). */
export const WAYS = [{ channel: 'teams', label: 'Teams' }, { channel: 'memo', label: '쪽지' }];

/** 고른 길로 읽는다 — 'teams'·'memo' 가 아니면 고르지 않은 것('')이다. */
export const wantOf = (v) => (v === 'teams' || v === 'memo' ? v : '');

/** 보낸 기록에 적힌 길의 이름('Teams'·'쪽지')을 길로 읽는다 — 모르는 이름이면 ''. */
export const wantOfLabel = (label) => WAYS.find((w) => w.label === label)?.channel || '';

/** 지금 Teams 로 보낼 수 없는 까닭. 보낼 수 있으면 빈 글이다. teams 는 Teams MCP 를 본 결과(아직 못 봤으면 null). */
export function teamsWhy(teams) {
  if (!teams) return 'Teams MCP 가 닿는지 확인하는 중입니다';
  if (!teams.up) return 'Teams MCP 가 연결돼 있지 않습니다';
  return teams.canSendFile ? '' : 'Teams MCP 는 연결돼 있지만 파일을 보내는 도구가 없습니다';
}

/**
 * 어느 길로 보내는가 — 쪽지를 골랐으면(want 가 'memo') 쪽지다. 고르지 않았거나 Teams 를 골랐으면 Teams MCP 가 닿고 파일을 보낼 수
 * 있을 때 Teams, 아니면 쪽지다. note 는 Teams 로 못 가고 쪽지로 가는 까닭(있을 때만).
 */
export function channelOf(teams, want = '') {
  if (want === 'memo') return { channel: 'memo', label: '쪽지', note: '' };
  if (teams?.up && teams.canSendFile) return { channel: 'teams', label: 'Teams', note: '' };
  return { channel: 'memo', label: '쪽지', note: teams?.up ? 'Teams MCP 는 연결돼 있지만 파일을 보내는 도구가 없어 쪽지로 보냅니다' : '' };
}

const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8)}`;
const span = (trip) => (trip.to && trip.to !== trip.from ? `${trip.from} ~ ${trip.to}` : trip.from);
/** 파일 이름에 쓸 수 없는 글자를 뺀다. */
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 20);

/** 묶은 PDF 의 이름 — "여비증빙_145580_김거화.pdf". */
export const pdfName = ({ trip, me }) => `여비증빙_${trip.seq}${safe(me) ? `_${safe(me)}` : ''}.pdf`;

/** 증빙을 무엇이 몇 장인지로 줄인다 — "항공기 증명 1장 · 숙박 증빙 2장". */
export function evidenceCount(kept) {
  const count = new Map();
  for (const k of kept || []) count.set(k.label || '증빙', (count.get(k.label || '증빙') || 0) + 1);
  return [...count].map(([label, n]) => `${label} ${n}장`).join(' · ');
}

/** 묶은 PDF 의 맨 앞에 붙는 여비계산서 출력의 이름 — "여비계산서_145580.pdf". */
export const calName = ({ trip }) => `여비계산서_${trip.seq}.pdf`;

/** 묶이는 것 전부 — 확정한 여비계산서의 출력이 맨 앞이고 증빙이 뒤따른다. "여비계산서 1부 · 숙박 증빙 2장". */
export const packCount = (kept) => ['여비계산서 1부', evidenceCount(kept)].filter(Boolean).join(' · ');

/** 보내는 글의 제목. */
export function sendTitle({ account, me, trip }) {
  const days = trip.to && trip.to !== trip.from ? `${md(trip.from)}~${md(trip.to)}` : md(trip.from);
  return `[여비 증빙] ${account} · ${me ? `${me} ` : ''}${days} ${trip.location || ''}`.trim();
}

/**
 * 보내는 글의 본문 — 한 줄에 한 가지씩. 쪽지에는 문단으로, Teams 에는 줄바꿈으로 들어간다.
 * @param {{account:string, me:string, trip:object, stage:{label:string}, reason?:string, kept:object[], file:string}} ctx
 */
export function sendLines({ account, me, trip, stage, reason = '', kept, file }) {
  return [
    '여비계산서와 증빙을 보냅니다.',
    `과제·계정: ${account}`,
    `출장자: ${me || '-'}`,
    `출장: ${span(trip)}${trip.location ? ` · ${trip.location}` : ''}`,
    ...(String(reason).trim() ? [`목적: ${String(reason).trim()}`] : []),
    `여비계산서: ${trip.seq} (${stage.label})`,
    `첨부: ${file} — ${packCount(kept)}`,
  ];
}
