// Gmail API 로 메일을 읽는 길 — OAuth(데스크톱 앱 클라이언트 + PKCE)와 메일 찾기·읽기·첨부 받기.
//
// 확장과 따로 도는 시험 구현이다(2026-10-04 사용자 지정: "별도 폴더에 일단 구현"). 의존성 없이 Node 22+ 의 fetch 만 쓴다.
// 이 파일은 디스크를 건드리지 않는다 — 클라이언트 정보와 토큰은 주입받고(store.mjs 가 파일로 둔다), fetch 도 주입받아 시험한다.
//
// 인증이 풀리는 때(구글 문서로 확인, 2026-10-04): OAuth 앱의 게시 상태가 "테스트"면 refresh 토큰이 7일 뒤 죽는다.
// "프로덕션"이면 6개월 동안 안 쓰거나, 구글 비밀번호를 바꾸거나, 사용자가 철회할 때만 죽는다 — 그래서 프로덕션으로 게시해 쓴다.
// 범위는 읽기 전용(gmail.readonly)이라 메일을 읽어도 읽음 표시가 바뀌지 않는다.

import crypto from 'node:crypto';

export const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const API_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
/** access 토큰은 만료 1분 전부터 새로 받는다. */
const EXPIRY_MARGIN_MS = 60_000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/* ------------------------------------------------------------------ OAuth */

/**
 * 구글이 내려 주는 클라이언트 JSON({"installed": {...}} 또는 {"web": {...}})이나 평평한 것에서 ID 와 보안 비밀을 꺼낸다.
 * @returns {{clientId: string, clientSecret: string}}
 */
export function clientOf(json) {
  const c = json?.installed || json?.web || json || {};
  const clientId = c.client_id || c.clientId || '';
  const clientSecret = c.client_secret || c.clientSecret || '';
  if (!clientId || !clientSecret) throw new Error('클라이언트 JSON 에 client_id 와 client_secret 이 있어야 합니다.');
  return { clientId, clientSecret };
}

/** PKCE 의 한 쌍 — verifier 는 토큰을 바꿀 때, challenge 는 동의 주소에 싣는다. */
export function pkce(random = crypto.randomBytes(32)) {
  const verifier = b64url(random);
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

/**
 * 동의 화면의 주소. refresh 토큰을 꼭 받으려고 offline + prompt=consent 를 준다(없으면 두 번째 동의부터 refresh 토큰이 안 온다).
 * @param {{clientId: string, redirectUri: string, challenge: string, state: string, loginHint?: string}} o
 */
export function authUrl({ clientId, redirectUri, challenge, state, loginHint = '' }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `${AUTH_URL}?${q}`;
}

/** 토큰 주소에 폼을 보낸다. 구글이 거절하면 그 까닭(error·error_description)을 실어 던진다. */
async function tokenPost(form, fetchFn) {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const err = new Error(`구글이 토큰을 주지 않았습니다: ${body.error || `HTTP ${res.status}`}${body.error_description ? ` — ${body.error_description}` : ''}`);
    err.code = body.error || '';
    throw err;
  }
  return body;
}

/** 답으로 온 토큰을 보관할 모양으로 — expires_at 은 지금 시각에 expires_in 을 더한 것(ms). */
const tokenOf = (body, now, prev = {}) => ({
  ...prev,
  access_token: body.access_token,
  expires_at: now + (Number(body.expires_in) || 0) * 1000,
  scope: body.scope || prev.scope || '',
  ...(body.refresh_token ? { refresh_token: body.refresh_token } : {}),
});

/**
 * 동의 뒤 돌아온 code 를 토큰으로 바꾼다.
 * @returns {Promise<{access_token: string, refresh_token: string, expires_at: number, scope: string}>}
 */
export async function exchangeCode({ client, code, verifier, redirectUri }, { fetchFn = fetch, now = Date.now } = {}) {
  const body = await tokenPost({
    code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirectUri,
    grant_type: 'authorization_code', code_verifier: verifier,
  }, fetchFn);
  if (!body.refresh_token) throw new Error('refresh 토큰이 오지 않았습니다 — 동의를 다시 해 주세요.');
  return tokenOf(body, now());
}

/** refresh 토큰으로 access 토큰을 새로 받는다. invalid_grant 면 refresh 토큰이 죽은 것이다(다시 동의). */
export async function refreshAccess({ client, token }, { fetchFn = fetch, now = Date.now } = {}) {
  try {
    const body = await tokenPost({
      client_id: client.clientId, client_secret: client.clientSecret, refresh_token: token.refresh_token, grant_type: 'refresh_token',
    }, fetchFn);
    return tokenOf(body, now(), token);
  } catch (err) {
    if (err.code === 'invalid_grant') {
      const e = new Error('구글 인증이 풀렸습니다(refresh 토큰 만료·철회) — 동의를 다시 해 주세요.');
      e.code = 'reauth';
      throw e;
    }
    throw err;
  }
}

/**
 * 쓸 수 있는 access 토큰을 주는 함수를 만든다 — 남은 시간이 없으면 새로 받고, 받은 것은 save 로 넘겨 보관하게 한다.
 * @param {{client: object, load: () => object|null, save: (token: object) => void}} o
 */
export function tokenSource({ client, load, save }, { fetchFn = fetch, now = Date.now } = {}) {
  return async () => {
    const token = load();
    if (!token?.refresh_token) {
      const e = new Error('구글 동의가 아직 없습니다 — auth 를 먼저 해 주세요.');
      e.code = 'reauth';
      throw e;
    }
    if (token.access_token && token.expires_at - EXPIRY_MARGIN_MS > now()) return token.access_token;
    const fresh = await refreshAccess({ client, token }, { fetchFn, now });
    save(fresh);
    return fresh.access_token;
  };
}

/* ------------------------------------------------------------------ 메일 */

const headerOf = (headers, name) => (headers || []).find((h) => String(h.name).toLowerCase() === name)?.value || '';

/** 본문 조각의 글자 집합 — 국내 영수증 메일은 EUC-KR 이 흔하다. 모르는 이름이면 UTF-8 로 읽는다. */
function decodeText(part) {
  const bytes = Buffer.from(part.body.data, 'base64url');
  const charset = (headerOf(part.headers, 'content-type').match(/charset="?([\w-]+)"?/i) || [])[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

/**
 * Gmail 의 메시지(format=full)를 읽기 좋은 모양으로. 본문은 처음 만난 text/plain·text/html 이고, 파일 이름이 있는 조각은 첨부다.
 * 첨부의 내용은 여기 없다(attachmentId 로 따로 받는다) — 작은 것은 data 가 바로 올 때가 있어 그대로 실어 둔다.
 * @returns {{id: string, threadId: string, date: string, from: string, to: string, subject: string, snippet: string,
 *            text: string, html: string, attachments: {name: string, type: string, size: number, attachmentId: string, data?: string, inline: boolean}[]}}
 */
export function readMessage(raw) {
  const out = { text: '', html: '', attachments: [] };
  const walk = (part) => {
    if (!part) return;
    const body = part.body || {};
    if (part.filename) {
      out.attachments.push({
        name: part.filename, type: part.mimeType || '', size: body.size || 0, attachmentId: body.attachmentId || '',
        ...(body.data ? { data: body.data } : {}),
        inline: /^inline/i.test(headerOf(part.headers, 'content-disposition')) || !!headerOf(part.headers, 'content-id'),
      });
    } else if (body.data && part.mimeType === 'text/plain' && !out.text) out.text = decodeText(part);
    else if (body.data && part.mimeType === 'text/html' && !out.html) out.html = decodeText(part);
    for (const p of part.parts || []) walk(p);
  };
  walk(raw.payload);
  const h = raw.payload?.headers;
  return {
    id: raw.id || '', threadId: raw.threadId || '',
    date: raw.internalDate ? new Date(Number(raw.internalDate)).toISOString() : '',
    from: headerOf(h, 'from'), to: headerOf(h, 'to'), subject: headerOf(h, 'subject'), snippet: raw.snippet || '',
    ...out,
  };
}

/** 출장 기간으로 찾는 검색어 — Gmail 의 before 는 그날을 빼므로 끝 날에 하루를 더한다. 날짜는 YYYY-MM-DD. */
export function periodQuery(from, to, extra = '') {
  const day = (s, plus = 0) => {
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new Error(`날짜를 읽지 못했습니다: ${s}`);
    d.setUTCDate(d.getUTCDate() + plus);
    return d.toISOString().slice(0, 10).replaceAll('-', '/');
  };
  return [`after:${day(from)}`, `before:${day(to || from, 1)}`, extra].filter(Boolean).join(' ');
}

/**
 * Gmail 을 부르는 손잡이.
 * @param {{getToken: () => Promise<string>, fetchFn?: typeof fetch}} o
 */
export function gmailClient({ getToken, fetchFn = fetch }) {
  const get = async (path) => {
    const res = await fetchFn(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${await getToken()}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gmail 이 HTTP ${res.status} 로 답했습니다${body.error?.message ? ` — ${body.error.message}` : ''}`);
    return body;
  };
  /** 메일 하나(본문·첨부 목록까지). */
  const message = async (id) => readMessage(await get(`/messages/${encodeURIComponent(id)}?format=full`));
  return {
    /** 로그인한 계정 — {emailAddress, messagesTotal}. 닿는지 볼 때 쓴다. */
    profile: () => get('/profile'),
    /**
     * Gmail 검색어(웹의 검색 칸과 같은 문법)로 찾는다. 새것부터 max 통까지 읽어 준다.
     * @returns {Promise<{total: number, messages: ReturnType<typeof readMessage>[]}>} total 은 구글의 어림값
     */
    search: async (q, { max = 10 } = {}) => {
      const list = await get(`/messages?${new URLSearchParams({ q, maxResults: String(max) })}`);
      const messages = await Promise.all((list.messages || []).map((m) => message(m.id)));
      return { total: list.resultSizeEstimate ?? messages.length, messages };
    },
    message,
    /** 첨부의 내용(바이트). 메시지에 data 가 바로 실려 온 작은 첨부는 그것을 쓴다. */
    attachment: async (messageId, att) => {
      if (att.data) return Buffer.from(att.data, 'base64url');
      const body = await get(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(att.attachmentId)}`);
      return Buffer.from(body.data || '', 'base64url');
    },
  };
}
