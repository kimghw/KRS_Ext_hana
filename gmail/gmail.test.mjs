// Gmail API 시험 구현(gmail/gmail.mjs·loopback.mjs) — OAuth 주소·토큰 바꾸기·새로 받기, 메시지 읽기, 기간 검색어, Gmail 호출, 동의 뒤 돌아오는 곳.
// 구글에 닿지 않는다 — fetch 는 가짜이고, 돌아오는 곳만 이 PC 의 빈 포트를 실제로 연다. 실행: node gmail/gmail.test.mjs
import assert from 'node:assert/strict';
import {
  SCOPE, AUTH_URL, TOKEN_URL, API_URL, clientOf, pkce, authUrl, exchangeCode, refreshAccess, tokenSource, readMessage, periodQuery, gmailClient,
} from './gmail.mjs';
import { waitForCode } from './loopback.mjs';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const CLIENT = { clientId: 'id-1.apps.googleusercontent.com', clientSecret: 'secret-1' };
const b64 = (s) => Buffer.from(s).toString('base64url');
/** 답을 차례로 내주는 가짜 fetch — 부른 것을 calls 에 적는다. */
const fakeFetch = (...replies) => {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, form: init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null });
    const r = replies.shift();
    if (!r) throw new Error(`답이 준비되지 않은 호출: ${url}`);
    return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r.body };
  };
  return { fn, calls };
};

console.log('클라이언트 정보와 동의 주소');
t('구글이 내려 주는 JSON(installed·web)과 평평한 것에서 ID 와 보안 비밀을 꺼낸다', () => {
  assert.deepEqual(clientOf({ installed: { client_id: 'a', client_secret: 'b', redirect_uris: ['http://localhost'] } }), { clientId: 'a', clientSecret: 'b' });
  assert.deepEqual(clientOf({ web: { client_id: 'a', client_secret: 'b' } }), { clientId: 'a', clientSecret: 'b' });
  assert.deepEqual(clientOf({ client_id: 'a', client_secret: 'b' }), { clientId: 'a', clientSecret: 'b' });
  assert.throws(() => clientOf({ installed: { client_id: 'a' } }), /client_secret/);
  assert.throws(() => clientOf(null), /client_id/);
});
t('PKCE 는 RFC 7636 의 예와 같은 값을 낸다', () => {
  const octets = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121];
  assert.deepEqual(pkce(Buffer.from(octets)), { verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' });
  assert.notEqual(pkce().verifier, pkce().verifier, '줄 때마다 새 값이다');
});
t('동의 주소는 읽기 전용 범위·offline·consent·S256 을 싣고, 계정 힌트는 줄 때만 싣는다', () => {
  const u = new URL(authUrl({ clientId: CLIENT.clientId, redirectUri: 'http://127.0.0.1:5123', challenge: 'ch', state: 'st' }));
  assert.equal(u.origin + u.pathname, AUTH_URL);
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    client_id: CLIENT.clientId, redirect_uri: 'http://127.0.0.1:5123', response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', code_challenge: 'ch', code_challenge_method: 'S256', state: 'st',
  });
  assert.equal(SCOPE, 'https://www.googleapis.com/auth/gmail.readonly');
  const hinted = new URL(authUrl({ clientId: 'c', redirectUri: 'r', challenge: 'ch', state: 'st', loginHint: 'me@gmail.com' }));
  assert.equal(hinted.searchParams.get('login_hint'), 'me@gmail.com');
});

console.log('토큰');
await ta('code 를 토큰으로 바꾼다 — 만료 시각은 지금에 expires_in 을 더한 것', async () => {
  const f = fakeFetch({ body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3599, scope: SCOPE } });
  const token = await exchangeCode({ client: CLIENT, code: 'code-1', verifier: 'ver-1', redirectUri: 'http://127.0.0.1:5123' }, { fetchFn: f.fn, now: () => 1_000_000 });
  assert.deepEqual(token, { access_token: 'at-1', expires_at: 1_000_000 + 3_599_000, scope: SCOPE, refresh_token: 'rt-1' });
  assert.deepEqual(f.calls, [{
    url: TOKEN_URL, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    form: { code: 'code-1', client_id: CLIENT.clientId, client_secret: 'secret-1', redirect_uri: 'http://127.0.0.1:5123', grant_type: 'authorization_code', code_verifier: 'ver-1' },
  }]);
});
await ta('refresh 토큰이 안 왔거나 구글이 거절하면 까닭을 말한다', async () => {
  const none = fakeFetch({ body: { access_token: 'at-1', expires_in: 3599 } });
  await assert.rejects(exchangeCode({ client: CLIENT, code: 'c', verifier: 'v', redirectUri: 'r' }, { fetchFn: none.fn }), /refresh 토큰이 오지 않았습니다/);
  const bad = fakeFetch({ status: 400, body: { error: 'invalid_client', error_description: 'Unauthorized' } });
  await assert.rejects(exchangeCode({ client: CLIENT, code: 'c', verifier: 'v', redirectUri: 'r' }, { fetchFn: bad.fn }), /invalid_client — Unauthorized/);
});
await ta('새로 받을 때 refresh 토큰은 그대로 두고(답에 없다), 답에 새것이 오면 바꾼다', async () => {
  const old = { access_token: 'at-0', refresh_token: 'rt-1', expires_at: 5, scope: SCOPE, email: 'me@gmail.com' };
  const f = fakeFetch({ body: { access_token: 'at-2', expires_in: 100 } }, { body: { access_token: 'at-3', expires_in: 100, refresh_token: 'rt-2' } });
  assert.deepEqual(await refreshAccess({ client: CLIENT, token: old }, { fetchFn: f.fn, now: () => 1000 }),
    { access_token: 'at-2', refresh_token: 'rt-1', expires_at: 101_000, scope: SCOPE, email: 'me@gmail.com' });
  assert.deepEqual(f.calls[0].form, { client_id: CLIENT.clientId, client_secret: 'secret-1', refresh_token: 'rt-1', grant_type: 'refresh_token' });
  assert.equal((await refreshAccess({ client: CLIENT, token: old }, { fetchFn: f.fn, now: () => 1000 })).refresh_token, 'rt-2');
});
await ta('refresh 토큰이 죽었으면(invalid_grant) 다시 동의하라고 한다 — 다른 오류는 그대로 올린다', async () => {
  const dead = fakeFetch({ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } });
  await assert.rejects(refreshAccess({ client: CLIENT, token: { refresh_token: 'rt' } }, { fetchFn: dead.fn }), (e) => e.code === 'reauth' && /동의를 다시/.test(e.message));
  const down = fakeFetch({ status: 500, body: {} });
  await assert.rejects(refreshAccess({ client: CLIENT, token: { refresh_token: 'rt' } }, { fetchFn: down.fn }), (e) => e.code !== 'reauth' && /HTTP 500/.test(e.message));
});
await ta('access 토큰은 남은 시간이 1분 넘으면 그대로 쓰고, 아니면 새로 받아 보관한다', async () => {
  let kept = { access_token: 'at-1', refresh_token: 'rt-1', expires_at: 200_000 };
  const saved = [];
  const f = fakeFetch({ body: { access_token: 'at-2', expires_in: 3600 } });
  const source = (now) => tokenSource({ client: CLIENT, load: () => kept, save: (x) => { kept = x; saved.push(x); } }, { fetchFn: f.fn, now: () => now });
  assert.equal(await source(100_000)(), 'at-1');
  assert.equal(f.calls.length, 0, '남은 시간이 있으면 구글을 부르지 않는다');
  assert.equal(await source(150_000)(), 'at-2', '만료 50초 전이면 새로 받는다');
  assert.deepEqual(saved, [{ access_token: 'at-2', refresh_token: 'rt-1', expires_at: 150_000 + 3_600_000, scope: '' }]);
  await assert.rejects(tokenSource({ client: CLIENT, load: () => null, save: () => {} })(), (e) => e.code === 'reauth' && /auth 를 먼저/.test(e.message));
});

console.log('메시지 읽기');
const RAW = {
  id: 'm-1', threadId: 'th-1', internalDate: '1789000000000', snippet: '예약이 확정되었습니다',
  payload: {
    mimeType: 'multipart/mixed',
    headers: [{ name: 'From', value: '호텔 <stay@hotel.example>' }, { name: 'TO', value: 'me@gmail.com' }, { name: 'subject', value: '[호텔] 예약 확인서' }],
    body: { size: 0 },
    parts: [
      { mimeType: 'multipart/related', filename: '', body: { size: 0 }, parts: [
        { mimeType: 'multipart/alternative', filename: '', body: { size: 0 }, parts: [
          { mimeType: 'text/plain', filename: '', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { size: 9, data: b64('예약 확인') } },
          { mimeType: 'text/html', filename: '', headers: [{ name: 'Content-Type', value: 'text/html; charset=euc-kr' }], body: { size: 6, data: Buffer.from([0x3c, 0x62, 0x3e, 0xbf, 0xb5, 0xbc, 0xf6, 0xc1, 0xf5, 0x3c, 0x2f, 0x62, 0x3e]).toString('base64url') } },
        ] },
        { mimeType: 'image/png', filename: 'logo.png', headers: [{ name: 'Content-ID', value: '<logo>' }], body: { size: 120, attachmentId: 'att-logo' } },
      ] },
      { mimeType: 'application/pdf', filename: '영수증.pdf', headers: [{ name: 'Content-Disposition', value: 'attachment; filename="영수증.pdf"' }], body: { size: 20480, attachmentId: 'att-pdf' } },
      { mimeType: 'text/plain', filename: 'memo.txt', headers: [], body: { size: 2, data: b64('hi') } },
    ],
  },
};
t('여러 겹의 조각에서 본문(평문·HTML)과 첨부를 가려내고, 머리글은 대소문자를 가리지 않는다', () => {
  const m = readMessage(RAW);
  assert.deepEqual([m.id, m.threadId, m.from, m.to, m.subject, m.snippet], ['m-1', 'th-1', '호텔 <stay@hotel.example>', 'me@gmail.com', '[호텔] 예약 확인서', '예약이 확정되었습니다']);
  assert.equal(m.date, new Date(1789000000000).toISOString());
  assert.equal(m.text, '예약 확인');
  assert.deepEqual(m.attachments, [
    { name: 'logo.png', type: 'image/png', size: 120, attachmentId: 'att-logo', inline: true },
    { name: '영수증.pdf', type: 'application/pdf', size: 20480, attachmentId: 'att-pdf', inline: false },
    { name: 'memo.txt', type: 'text/plain', size: 2, attachmentId: '', data: b64('hi'), inline: false },
  ]);
});
t('본문 조각의 글자 집합(EUC-KR)대로 읽고, 모르는 이름이면 UTF-8 로 읽는다', () => {
  assert.equal(readMessage(RAW).html, '<b>영수증</b>');
  const odd = { payload: { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=x-nope' }], body: { data: b64('그대로') } } };
  assert.equal(readMessage(odd).text, '그대로');
});
t('조각이 없는 메일(본문만)과 빈 메일도 읽는다', () => {
  const plain = readMessage({ id: 'm-2', payload: { mimeType: 'text/html', headers: [{ name: 'Subject', value: '본문만' }], body: { data: b64('<p>본문</p>') } } });
  assert.deepEqual([plain.subject, plain.html, plain.text, plain.attachments, plain.date], ['본문만', '<p>본문</p>', '', [], '']);
  assert.deepEqual(readMessage({}).attachments, []);
});

console.log('기간 검색어');
t('끝 날에 하루를 더한다(Gmail 의 before 는 그날을 뺀다) — 달·해를 넘겨도 맞다', () => {
  assert.equal(periodQuery('2026-09-09', '2026-09-10'), 'after:2026/09/09 before:2026/09/11');
  assert.equal(periodQuery('2026-09-30'), 'after:2026/09/30 before:2026/10/01');
  assert.equal(periodQuery('2026-12-31', '2026-12-31', 'has:attachment'), 'after:2026/12/31 before:2027/01/01 has:attachment');
  assert.throws(() => periodQuery('9/9'), /날짜를 읽지 못했습니다/);
});

console.log('Gmail 호출');
await ta('찾기는 목록을 받고 메일을 하나씩 읽는다 — 호출마다 토큰을 싣는다', async () => {
  const f = fakeFetch({ body: { messages: [{ id: 'm-1' }, { id: 'm-2' }], resultSizeEstimate: 7 } }, { body: RAW }, { body: { id: 'm-2', payload: { headers: [] } } });
  const g = gmailClient({ getToken: async () => 'at-1', fetchFn: f.fn });
  const r = await g.search('영수증 has:attachment', { max: 2 });
  assert.equal(r.total, 7);
  assert.deepEqual(r.messages.map((m) => [m.id, m.attachments.length]), [['m-1', 3], ['m-2', 0]]);
  assert.deepEqual(f.calls.map((c) => c.url), [
    `${API_URL}/messages?q=%EC%98%81%EC%88%98%EC%A6%9D+has%3Aattachment&maxResults=2`, `${API_URL}/messages/m-1?format=full`, `${API_URL}/messages/m-2?format=full`,
  ]);
  assert.ok(f.calls.every((c) => c.headers.Authorization === 'Bearer at-1' && c.method === 'GET'));
  const none = gmailClient({ getToken: async () => 'at-1', fetchFn: fakeFetch({ body: { resultSizeEstimate: 0 } }).fn });
  assert.deepEqual(await none.search('없는 것'), { total: 0, messages: [] });
});
await ta('첨부는 attachmentId 로 받고, 메시지에 바로 실려 온 것은 다시 받지 않는다', async () => {
  const f = fakeFetch({ body: { size: 4, data: b64('%PDF') } });
  const g = gmailClient({ getToken: async () => 'at-1', fetchFn: f.fn });
  const [, pdf, memo] = readMessage(RAW).attachments;
  assert.equal((await g.attachment('m-1', pdf)).toString(), '%PDF');
  assert.equal((await g.attachment('m-1', memo)).toString(), 'hi');
  assert.deepEqual(f.calls.map((c) => c.url), [`${API_URL}/messages/m-1/attachments/att-pdf`]);
});
await ta('Gmail 이 거절하면 상태와 구글의 말을 싣는다', async () => {
  const f = fakeFetch({ status: 403, body: { error: { message: 'Gmail API has not been used in project' } } });
  await assert.rejects(gmailClient({ getToken: async () => 'at', fetchFn: f.fn }).profile(), /HTTP 403 .* Gmail API has not been used/);
});

console.log('동의 뒤 돌아오는 곳');
await ta('code 를 한 번 받고 닫는다 — 곁다리 호출(favicon)은 기다림을 끝내지 않는다', async () => {
  const w = waitForCode('st-1', { timeoutMs: 5000 });
  const base = `http://127.0.0.1:${await w.listening}`;
  assert.equal((await fetch(`${base}/favicon.ico`)).status, 404);
  const res = await fetch(`${base}/?state=st-1&code=code-9&scope=x`);
  assert.match(await res.text(), /구글 동의를 받았습니다/);
  assert.equal(await w.result, 'code-9');
  await assert.rejects(fetch(`${base}/?state=st-1&code=again`), '받은 뒤에는 닫혀 있다');
});
await ta('state 가 다르거나 사용자가 거절했거나 시간이 지나면 던진다', async () => {
  const wrong = waitForCode('st-1', { timeoutMs: 5000 });
  await fetch(`http://127.0.0.1:${await wrong.listening}/?state=other&code=c`);
  await assert.rejects(wrong.result, /state 가 다릅니다/);
  const denied = waitForCode('st-1', { timeoutMs: 5000 });
  await fetch(`http://127.0.0.1:${await denied.listening}/?error=access_denied&state=st-1`);
  await assert.rejects(denied.result, /동의가 거절됐습니다: access_denied/);
  const late = waitForCode('st-1', { timeoutMs: 30 });
  await assert.rejects(late.result, /동의가 오지 않았습니다/);
});

console.log(`\n${pass}개 통과`);
