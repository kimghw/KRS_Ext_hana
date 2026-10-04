// Teams MCP(이 PC 에 띄운 KR_MS365_mcp 의 teams 서버)로 보내는 길 — 닿는지 보고, 닿으면 파일과 글을 채팅으로 보낸다.
//
// 증빙은 Teams MCP 가 연결돼 있으면 Teams 로, 아니면 쪽지로 보낸다(2026-10-03 사용자 지정). "연결돼 있다"는 것은
// 이 PC 의 http://localhost:5003/mcp (MCP Streamable HTTP)가 답하고, **파일을 보내는 도구가 있다**는 뜻이다.
//
// 파일을 보내는 도구(FILE_TOOL)는 2026-10-03 에 KR_MS365_mcp 에 더했다(spec/param_spec/teams.yaml) — 그 전의 채팅 도구는 글만 보냈다:
//
//   handler_teams_send_chat_file { recipient_email, content, content_type: 'html', file_name, file_base64 }
//     → 파일을 보내는 사람의 OneDrive("Microsoft Teams Chat Files")에 올리고, 받는 사람과의 1:1 채팅에 첨부로 달아 글을 보낸다.
//       받는 사람이 나 자신이면 나의 Notes 채팅으로 간다. 답의 글(JSON)에 success 가 참이어야 한다.
//
// 그 도구가 없는 예전 서버가 떠 있으면 canSendFile 이 거짓이라 쪽지로 간다(teamsSendFile 을 부르면 던진다).
// 같은 날 본인의 Notes 채팅으로 실제로 보내 확인했다(이 파일의 코드 → 서버 → Graph). 다른 사람에게 보내는 길(1:1 채팅 찾기·
// 파일 읽기 권한 주기)은 서버의 테스트로만 확인했고 실제로 보내 본 적은 없다.

/** Teams MCP 의 주소(KR_MS365_mcp 의 spec/param_spec/teams.yaml: port 5003). manifest 의 host_permissions 에 있어야 닿는다. */
export const TEAMS_MCP_URL = 'http://localhost:5003/mcp';
/** 파일을 보내는 도구의 이름. 서버의 도구 목록에 이것이 있어야 Teams 로 보낸다. */
export const FILE_TOOL = 'handler_teams_send_chat_file';
const PROTOCOL = '2025-03-26';
const PROBE_TIMEOUT_MS = 2500;
const SEND_TIMEOUT_MS = 60000;

/** 답의 본문에서 그 번호의 JSON-RPC 답을 꺼낸다 — 서버는 JSON 한 덩이나 SSE("data: {…}" 줄)로 답한다. */
export function rpcReply(text, id) {
  const chunks = /^\s*\{/.test(text) ? [text] : String(text || '').split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5));
  for (const c of chunks) {
    try {
      const msg = JSON.parse(c);
      if (msg?.id === id) return msg;
    } catch { /* 반쯤 온 줄 */ }
  }
  return null;
}

/** MCP 서버와 한 번 붙어(initialize) 도구를 부를 수 있는 손잡이를 준다. 닿지 않으면 던진다. */
async function connect(url, fetchFn, timeoutMs) {
  let session = '';
  let seq = 0;
  const post = async (body, ms = timeoutMs) => {
    const res = await fetchFn(url, {
      method: 'POST', signal: AbortSignal.timeout(ms),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(session ? { 'Mcp-Session-Id': session, 'MCP-Protocol-Version': PROTOCOL } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Teams MCP 가 HTTP ${res.status} 로 답했습니다`);
    session = res.headers.get('mcp-session-id') || session;
    return res.text();
  };
  const call = async (method, params, ms) => {
    const id = ++seq;
    const reply = rpcReply(await post({ jsonrpc: '2.0', id, method, params }, ms), id);
    if (!reply) throw new Error('Teams MCP 의 답을 읽지 못했습니다');
    if (reply.error) throw new Error(reply.error.message || 'Teams MCP 오류');
    return reply.result;
  };
  await call('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'krs-workspace', version: '1' } });
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return { call };
}

/**
 * Teams MCP 가 닿는가, 파일을 보낼 수 있는가. 던지지 않는다 — 닿지 않는 것이 보통이다(대부분의 PC 에는 이 서버가 없다).
 * @returns {Promise<{up: boolean, canSendFile: boolean, tools: string[], error: string}>}
 */
export async function teamsState({ url = TEAMS_MCP_URL, fetchFn = fetch } = {}) {
  try {
    const mcp = await connect(url, fetchFn, PROBE_TIMEOUT_MS);
    const tools = ((await mcp.call('tools/list', {}))?.tools || []).map((t) => t.name);
    return { up: true, canSendFile: tools.includes(FILE_TOOL), tools, error: '' };
  } catch (err) {
    return { up: false, canSendFile: false, tools: [], error: String(err?.message || err) };
  }
}

const base64Of = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * 받는 사람과의 Teams 채팅에 파일을 붙여 글을 보낸다(FILE_TOOL). 서버에 그 도구가 없으면 던진다.
 * @param {{email: string, html: string, file: {name:string, bytes:Uint8Array}}} msg
 */
export async function teamsSendFile({ email, html, file }, { url = TEAMS_MCP_URL, fetchFn = fetch } = {}) {
  const mcp = await connect(url, fetchFn, PROBE_TIMEOUT_MS);
  const tools = ((await mcp.call('tools/list', {}))?.tools || []).map((t) => t.name);
  if (!tools.includes(FILE_TOOL)) throw new Error('Teams MCP 에 파일을 보내는 도구가 없습니다.');
  const result = await mcp.call('tools/call', {
    name: FILE_TOOL,
    arguments: { recipient_email: email, content: html, content_type: 'html', file_name: file.name, file_base64: base64Of(file.bytes) },
  }, SEND_TIMEOUT_MS);
  const text = (result?.content || []).map((c) => c.text || '').join('');
  let out = null;
  try { out = JSON.parse(text); } catch { /* 글로 답했다 */ }
  // 보냈다고 **분명히** 답했을 때만 보낸 것으로 친다 — 읽지 못한 답을 성공으로 넘기지 않는다.
  if (result?.isError || out?.success !== true) throw new Error(out?.error || text.slice(0, 200) || 'Teams 로 보내지 못했습니다.');
  return { messageId: out.message_id || '' };
}
