// siteFetch 가 문맥(콘텐츠 스크립트 / 패널)마다 바르게 끝나는지, 그리고 앱이 "sign in" 을 돌려줬을 때
// 포털 상태를 확인해 만료·재시도·안내를 가려 말하는지.
// chrome.tabs 가 없다고 TypeError 로 죽으면 카드는 "Cannot read properties of undefined" 를 보여주게 된다.
import assert from 'node:assert/strict';
import { siteFetch, AuthError, canTabFetch, portalState } from '../src/net.js';
import { PORTAL_HOME_URL } from '../src/config.js';

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const page = (html, { ok = true, status = 200, url = 'https://eclass.krs.co.kr/x', type = 'basic' } = {}) => ({
  ok, status, statusText: '', url, type,
  headers: { get: () => 'text/html; charset=utf-8' },
  arrayBuffer: async () => new TextEncoder().encode(html).buffer,
});
/** redirect:'manual' 로 부른 요청이 리다이렉트를 만나면 브라우저는 이렇게 돌려준다. */
const redirect = () => ({
  ok: false, status: 0, type: 'opaqueredirect', url: '', headers: { get: () => null },
  arrayBuffer: async () => new ArrayBuffer(0),
});
const LOGGED_IN = '<html><body>' + 'x'.repeat(2000) + '<table id="RG_MAIN_ctl00"></table></body></html>';
const SIGN_IN = '<script>alert("You must sign in.");</script>';
const HOME = '<html><body>' + 'h'.repeat(3000) + '<div id="intraMenu"></div></body></html>';
const LOGIN_FORM = '<html><body><form><input id="tbUserId" name="UserId"></form></body></html>';

const isHome = (url) => String(url) === PORTAL_HOME_URL;

/** 주소별로 응답을 정하고, 무엇을 어떻게 불렀는지 남기는 fetch 흉내. 함수를 주면 부를 때마다 만든다. */
function fakeFetch({ app, home }) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), redirect: init.redirect });
    const r = isHome(url) ? home : app;
    return typeof r === 'function' ? r() : r;
  };
  fn.calls = calls;
  return fn;
}

console.log('콘텐츠 스크립트 문맥 (chrome.tabs 없음)');
globalThis.chrome = { runtime: {} };
await ta('탭 경유를 쓸 수 없다고 안다', async () => assert.equal(canTabFetch(), false));
await ta('직접 요청이 되면 그대로 돌려준다', async () => {
  globalThis.fetch = fakeFetch({ app: page(LOGGED_IN) });
  const r = await siteFetch('https://eclass.krs.co.kr/x');
  assert.equal(r.via, 'direct');
  assert.match(r.html, /RG_MAIN/);
  assert.equal(globalThis.fetch.calls.length, 1, '로그인돼 있으면 포털을 확인하지 않는다');
});
await ta('미인증 응답이면 TypeError 가 아니라 AuthError', async () => {
  globalThis.fetch = fakeFetch({ app: page(SIGN_IN), home: redirect() });
  await assert.rejects(siteFetch('https://eclass.krs.co.kr/x'),
    (err) => err instanceof AuthError && /로그인이 필요/.test(err.message));
});
await ta('포털이 로그인 폼으로 보내면(302) 만료라고 말하고, 리다이렉트는 따라가지 않는다', async () => {
  const f = globalThis.fetch = fakeFetch({ app: page(SIGN_IN), home: redirect() });
  await assert.rejects(siteFetch('https://eclass.krs.co.kr/x'),
    (err) => err instanceof AuthError && err.portal === 'expired'
      && /만료/.test(err.message) && /자동으로 이어/.test(err.message));
  const probe = f.calls.filter((c) => isHome(c.url));
  assert.equal(probe.length, 1);
  assert.equal(probe[0].redirect, 'manual', '홈은 manual 로만 부른다 — 따라가면 남은 쿠키가 지워진다');
  assert.equal(f.calls.length, 2, '포털이 풀렸으면 앱을 다시 두드리지 않는다');
});
await ta('포털은 살아 있는데 앱만 sign in 이면 한 번 더 해 보고, 되면 그 결과를 쓴다', async () => {
  let n = 0;
  globalThis.fetch = fakeFetch({ app: () => page(++n === 1 ? SIGN_IN : LOGGED_IN), home: page(HOME) });
  const r = await siteFetch('https://eclass.krs.co.kr/x');
  assert.equal(r.via, 'retry');
  assert.equal(n, 2);
});
await ta('다시 해도 sign in 이면 포털은 살아 있다고 말하고, 앱은 두 번까지만 두드린다', async () => {
  const f = globalThis.fetch = fakeFetch({ app: page(SIGN_IN), home: page(HOME) });
  await assert.rejects(siteFetch('https://eclass.krs.co.kr/x'),
    (err) => err instanceof AuthError && err.portal === 'alive' && /eclass 는 로그인돼 있는데/.test(err.message));
  assert.equal(f.calls.filter((c) => !isHome(c.url)).length, 2);
});
await ta('홈이 200 으로 로그인 폼을 그려 줘도 만료로 본다', async () => {
  globalThis.fetch = fakeFetch({ app: page(SIGN_IN), home: page(LOGIN_FORM) });
  await assert.rejects(siteFetch('https://eclass.krs.co.kr/x'), (err) => err.portal === 'expired');
});
await ta('포털 확인이 실패하면 모른다고 하고 예전 문구로 안내한다', async () => {
  globalThis.fetch = fakeFetch({ app: page(SIGN_IN), home: () => { throw new Error('Failed to fetch'); } });
  await assert.rejects(siteFetch('https://eclass.krs.co.kr/x'),
    (err) => err instanceof AuthError && err.portal === 'unknown' && /eclass 에 로그인한 뒤/.test(err.message));
});
await ta('직접 요청이 실패하면 그 실패를 그대로 말한다', async () => {
  globalThis.fetch = async () => { throw new Error('Failed to fetch'); };
  await assert.rejects(siteFetch('https://eclass.krs.co.kr/x'), /Failed to fetch/);
});
await ta('HTTP 오류도 본문 한 줄과 함께', async () => {
  globalThis.fetch = async () => page(
    '<html><head><title>Runtime Error</title></head><body><b>Exception Details: </b>System.NullReferenceException: 개체 참조</body></html>',
    { ok: false, status: 500 },
  );
  await assert.rejects(siteFetch('https://eclass.krs.co.kr/x'), /HTTP 500.*NullReference/);
});

console.log('portalState 만');
await ta('200 홈 → alive', async () => {
  globalThis.fetch = async () => page(HOME);
  assert.equal(await portalState(), 'alive');
});
await ta('리다이렉트 → expired', async () => {
  globalThis.fetch = async () => redirect();
  assert.equal(await portalState(), 'expired');
});
await ta('302 를 그대로 받아도 expired', async () => {
  globalThis.fetch = async () => page('', { ok: false, status: 302 });
  assert.equal(await portalState(), 'expired');
});
await ta('네트워크 오류 → unknown', async () => {
  globalThis.fetch = async () => { throw new Error('x'); };
  assert.equal(await portalState(), 'unknown');
});

console.log('패널 문맥 (chrome.tabs 있음)');
await ta('탭 경유를 쓸 수 있다고 안다', async () => {
  globalThis.chrome = { tabs: { query: async () => [] }, scripting: { executeScript: async () => [] } };
  assert.equal(canTabFetch(), true);
});
await ta('미인증인데 열린 탭이 없으면 "탭이 없다" 가 아니라 포털 상태로 말한다', async () => {
  globalThis.fetch = fakeFetch({ app: page(SIGN_IN), home: redirect() });
  await assert.rejects(siteFetch('https://eclass.krs.co.kr/x'),
    (err) => err instanceof AuthError && err.portal === 'expired' && !/탭이 없/.test(err.message));
});
await ta('네트워크가 막혔고 탭도 없으면 로그인 문제가 아니라 그 실패다', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(siteFetch('https://eclass.krs.co.kr/x'),
    (err) => !(err instanceof AuthError) && /offline/.test(err.message));
});
await ta('탭이 있고 탭에서는 로그인돼 있으면 그 결과를 쓴다', async () => {
  globalThis.chrome = {
    tabs: { query: async () => [{ id: 7, status: 'complete' }] },
    scripting: {
      executeScript: async () => [{ result: { ok: true, status: 200, html: LOGGED_IN, finalUrl: 'https://eclass.krs.co.kr/x' } }],
    },
  };
  globalThis.fetch = fakeFetch({ app: page(SIGN_IN), home: redirect() });
  const r = await siteFetch('https://eclass.krs.co.kr/x');
  assert.equal(r.via, 'tab');
});

console.log(`\n통과 ${pass}건`);
