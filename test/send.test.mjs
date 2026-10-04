// 여비계산서 증빙 송부의 규칙(src/send.js)과 Teams MCP 확인(src/teams.js) — 언제 보내는지, 어느 길로, 무슨 글로, 최근 과제·계정.
import assert from 'node:assert/strict';
import { sendGate, channelOf, pushRecent, pdfName, sendTitle, sendLines, evidenceCount, RECENT_MAX } from '../src/send.js';
import { teamsState, teamsSendFile, rpcReply, FILE_TOOL, TEAMS_MCP_URL } from '../src/teams.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const TRIP = { seq: '145580', from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시 킨텍스' };
const DAY = { seq: '145600', from: '2026-09-23', to: '2026-09-23', location: '서울 본사' };
const pre = (done) => ({ phase: 'pre', done, label: `사전정산 ${done ? '완료' : '작성'}` });
const post = (done) => ({ phase: 'post', done, label: `사후정산 ${done ? '완료' : '작성'}` });
const KEPT = [{ label: '항공기 증명', name: '오는편.pdf' }, { label: '숙박 증빙', name: '호텔.jpg' }, { label: '숙박 증빙', name: '예약.pdf' }];
const gate = (o) => { const g = sendGate(o); return [g.ready, g.staged, g.kind, g.why]; };

console.log('언제 보낼 수 있는가');
t('숙박도 비행기도 없으면(당일) 사전정산을 마친 뒤 당일증빙이 있을 때 보낸다', () => {
  assert.deepEqual(gate({ trip: DAY, stage: pre(true), need: { needed: false }, kept: [KEPT[0]] }), [true, true, 'day', '']);
  assert.deepEqual(gate({ trip: DAY, stage: pre(false), need: { needed: false }, kept: [KEPT[0]] }), [false, false, 'day', '사전정산이 완료된 뒤에 보냅니다']);
  assert.deepEqual(gate({ trip: DAY, stage: pre(true), need: { needed: false }, kept: [] }), [false, true, 'day', '당일증빙(출장지에서 결제한 영수증)을 넣어 주세요']);
});
t('숙박했거나 비행기를 탔으면 사후정산이 완료된 뒤에 보낸다 — 아직이면 송부 칸은 열리고, 보내기가 사후정산을 저장·확정부터 한다(settle)', () => {
  const settle = (o) => sendGate(o).settle;
  assert.deepEqual(gate({ trip: TRIP, stage: pre(false), need: { needed: true }, kept: KEPT }), [false, false, 'after', '사전정산을 완료한 뒤에 사후정산을 저장하고 보냅니다']);
  assert.deepEqual(gate({ trip: TRIP, stage: pre(true), need: { needed: true }, kept: KEPT }), [true, true, 'after', '']);
  assert.deepEqual(gate({ trip: TRIP, stage: post(false), need: { needed: true }, kept: KEPT }), [true, true, 'after', '']);
  assert.deepEqual(gate({ trip: TRIP, stage: post(false), need: { needed: true }, kept: [] }), [false, true, 'after', '보낼 증빙이 없습니다 — 증빙을 넣어 주세요']);
  assert.deepEqual(gate({ trip: TRIP, stage: post(true), need: { needed: true }, kept: KEPT }), [true, true, 'after', '']);
  assert.deepEqual(gate({ trip: TRIP, stage: post(true), need: null, kept: [] }), [false, true, 'after', '보낼 증빙이 없습니다 — 증빙을 넣어 주세요'],
    '사후정산이 완료됐으면 사전정산의 교통편을 못 읽었어도 단계는 됐다');
  assert.deepEqual([pre(false), pre(true), post(false), post(true)].map((stage) => settle({ trip: TRIP, stage, need: { needed: true }, kept: KEPT })), [false, true, true, false],
    '사전정산을 완료한 뒤부터 사후정산을 완료하기 전까지만 저장·확정이 남아 있다');
  assert.equal(settle({ trip: DAY, stage: pre(true), need: { needed: false }, kept: [KEPT[0]] }), false, '당일 출장에는 사후정산이 없다');
});
t('여비계산서가 없거나 사전정산의 교통편을 아직 못 읽었으면 까닭을 말한다', () => {
  assert.deepEqual(gate({ trip: null, stage: null, need: null, kept: KEPT }), [false, false, '', '여비계산서가 있어야 보낼 수 있습니다']);
  assert.deepEqual(gate({ trip: DAY, stage: pre(true), need: null, kept: KEPT }), [false, false, '', '사전정산의 교통편을 확인하는 중입니다']);
});

console.log('어느 길로 보내는가');
t('Teams MCP 가 닿고 파일을 보낼 수 있으면 Teams, 아니면 쪽지 — 닿는데 파일 도구가 없으면 까닭을 적는다', () => {
  assert.deepEqual(channelOf({ up: true, canSendFile: true }), { channel: 'teams', label: 'Teams', note: '' });
  assert.deepEqual(channelOf({ up: false, canSendFile: false }), { channel: 'memo', label: '쪽지', note: '' });
  assert.deepEqual(channelOf(null), { channel: 'memo', label: '쪽지', note: '' });
  assert.match(channelOf({ up: true, canSendFile: false }).note, /Teams MCP 는 연결돼 있지만 파일을 보내는 도구가 없어 쪽지로 보냅니다/);
});

console.log('최근에 쓴 과제·계정');
t('쓴 것이 맨 앞으로 오고, 같은 것은 하나만, 다섯 개까지 남는다', () => {
  let list = [];
  for (const a of ['A', 'B', 'C', 'D', 'E', 'F', 'B']) list = pushRecent(list, a);
  assert.deepEqual(list, ['B', 'F', 'E', 'D', 'C']);
  assert.equal(RECENT_MAX, 5);
  assert.deepEqual(pushRecent(['A'], ''), ['A'], '빈 값은 넣지 않는다');
  assert.deepEqual(pushRecent([{ id: 'kim', name: '옛 이름' }, { id: 'lee' }], { id: 'kim', name: '김' }, (p) => p.id), [{ id: 'kim', name: '김' }, { id: 'lee' }]);
});

console.log('보내는 글');
t('PDF 이름과 증빙 수', () => {
  assert.equal(pdfName({ trip: TRIP, me: '김거화' }), '여비증빙_145580_김거화.pdf');
  assert.equal(pdfName({ trip: TRIP, me: '' }), '여비증빙_145580.pdf');
  assert.equal(evidenceCount(KEPT), '항공기 증명 1장 · 숙박 증빙 2장');
});
t('제목과 본문 — 과제·계정, 출장자, 기간·출장지, 목적, 계산서 번호와 단계, 첨부', () => {
  assert.equal(sendTitle({ account: 'RND-2026-01', me: '김거화', trip: TRIP }), '[여비 증빙] RND-2026-01 · 김거화 9/9~9/10 경기도 고양시 킨텍스');
  assert.equal(sendTitle({ account: '일반관리비', me: '김거화', trip: DAY }), '[여비 증빙] 일반관리비 · 김거화 9/23 서울 본사');
  assert.deepEqual(sendLines({ account: 'RND-2026-01', me: '김거화', trip: TRIP, stage: post(true), reason: 'K-Battery Show 참석', kept: KEPT, file: '여비증빙_145580_김거화.pdf' }), [
    '여비계산서 증빙을 보냅니다.', '과제·계정: RND-2026-01', '출장자: 김거화', '출장: 2026-09-09 ~ 2026-09-10 · 경기도 고양시 킨텍스', '목적: K-Battery Show 참석',
    '여비계산서: 145580 (사후정산 완료)', '첨부: 여비증빙_145580_김거화.pdf — 항공기 증명 1장 · 숙박 증빙 2장',
  ]);
  assert.equal(sendLines({ account: 'A', me: '', trip: DAY, stage: pre(true), kept: [KEPT[0]], file: 'f.pdf' })[3], '출장: 2026-09-23 · 서울 본사');
});

console.log('Teams MCP 가 닿는가');
/** 가짜 MCP 서버. tools 를 주면 그 도구들을 내놓고, 안 주면 닿지 않는다. */
function fakeMcp(tools, calls = []) {
  return async (url, init) => {
    if (!tools) throw new TypeError('Failed to fetch');
    const msg = JSON.parse(init.body);
    calls.push({ url, method: msg.method, params: msg.params, session: init.headers['Mcp-Session-Id'] || '' });
    const reply = (result) => new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`,
      { status: 200, headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 's-1' } });
    if (msg.method === 'initialize') return reply({ protocolVersion: '2025-03-26', capabilities: {} });
    if (msg.method === 'notifications/initialized') return new Response('', { status: 202 });
    if (msg.method === 'tools/list') return reply({ tools: tools.map((name) => ({ name })) });
    if (msg.method === 'tools/call') return reply({ content: [{ type: 'text', text: JSON.stringify({ success: true, message_id: 'm-9' }) }] });
    return new Response('', { status: 404 });
  };
}
t('답은 JSON 한 덩이로도, SSE 의 data 줄로도 온다', () => {
  assert.deepEqual(rpcReply('{"jsonrpc":"2.0","id":2,"result":{"a":1}}', 2).result, { a: 1 });
  assert.deepEqual(rpcReply('event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"b":2}}\n\n', 3).result, { b: 2 });
  assert.equal(rpcReply('event: message\ndata: {"id":1}\n', 9), null);
});
await ta('서버가 없으면 닿지 않는다고 답한다(던지지 않는다)', async () => {
  const s = await teamsState({ fetchFn: fakeMcp(null) });
  assert.deepEqual([s.up, s.canSendFile, s.tools], [false, false, []]);
  assert.match(s.error, /Failed to fetch/);
});
await ta('지금의 Teams MCP(글만 보내는 도구)는 닿아도 파일을 못 보낸다 — 쪽지로 간다', async () => {
  const calls = [];
  const s = await teamsState({ fetchFn: fakeMcp(['handler_teams_send_chat_message', 'handler_teams_list_chats'], calls) });
  assert.deepEqual([s.up, s.canSendFile, s.tools.length], [true, false, 2]);
  assert.deepEqual(calls.map((c) => [c.url, c.method, c.session]), [[TEAMS_MCP_URL, 'initialize', ''], [TEAMS_MCP_URL, 'notifications/initialized', 's-1'], [TEAMS_MCP_URL, 'tools/list', 's-1']]);
  assert.equal(channelOf(s).channel, 'memo');
  await assert.rejects(teamsSendFile({ email: 'a@krs.co.kr', html: '<p>x</p>', file: { name: 'a.pdf', bytes: new Uint8Array([1]) } },
    { fetchFn: fakeMcp(['handler_teams_send_chat_message']) }), /파일을 보내는 도구가 없습니다/);
});
await ta('파일을 보내는 도구가 있으면 Teams 로 — 받는 사람 메일, 글(HTML), 파일 이름과 내용(base64)을 넘긴다', async () => {
  const calls = [];
  const fetchFn = fakeMcp(['handler_teams_send_chat_message', FILE_TOOL], calls);
  assert.equal(channelOf(await teamsState({ fetchFn })).channel, 'teams');
  const r = await teamsSendFile({ email: 'hong@krs.co.kr', html: '<p>글</p>', file: { name: '여비증빙_1.pdf', bytes: new Uint8Array([37, 80, 68, 70]) } }, { fetchFn });
  assert.equal(r.messageId, 'm-9');
  assert.deepEqual(calls.at(-1).params, { name: FILE_TOOL,
    arguments: { recipient_email: 'hong@krs.co.kr', content: '<p>글</p>', content_type: 'html', file_name: '여비증빙_1.pdf', file_base64: 'JVBERg==' } });
});

console.log(`\n통과 ${pass}건`);
