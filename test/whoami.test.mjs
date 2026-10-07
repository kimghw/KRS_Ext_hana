// 로그인한 사람의 이름 — 홈 머리글의 사용자 ID 와 인명 조회(src/whoami.js).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { portalUserId, lookupName } from '../src/whoami.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const doc = (html) => new JSDOM(html, { url: 'https://eclass.krs.co.kr/eClassVer4/Home/Index' }).window.document;

// 2026-10-06 홈 머리글 그대로(영문 모드 — 이름은 영문으로 나온다).
const HEADER = '<li class="emp_img nav-item dropdown"><a class="nav-link dropdown-toggle" href="#">'
  + '<img id="id-navbar-user-image" class="d-none d-lg-inline-block" src="/intra/intranet/member/pic/kimghw.gif" alt="kimghw"></a>'
  + '<div class="dropdown-menu"><div class="dropdown-header"> KIM Geohwa </div>'
  + '<a href="https://www.krs.co.kr/BusinessCard/External/Card?user_id=a2ltZ2h3&amp;share=Y">My BusinessCard</a></div></li>';

console.log('홈 머리글의 사용자 ID');
t('사진의 alt', () => assert.equal(portalUserId(doc(`<body>${HEADER}</body>`)), 'kimghw'));
t('alt 가 없으면 사진 경로', () =>
  assert.equal(portalUserId(doc('<body><img id="id-navbar-user-image" src="/intra/intranet/member/pic/hong.gif"></body>')), 'hong'));
t('사진이 없으면 명함 링크의 base64', () =>
  assert.equal(portalUserId(doc('<body><a href="https://www.krs.co.kr/BusinessCard/External/Card?user_id=aG9uZw%3D%3D&share=Y">x</a></body>')), 'hong'));
t('아무것도 없으면 빈 글', () => assert.equal(portalUserId(doc('<body><p>x</p></body>')), ''));
t('문서가 없어도 빈 글', () => assert.equal(portalUserId(null), ''));

console.log('인명에서 이름');
await ta('ID 가 같은 줄의 이름(대소문자 무시)', async () => {
  const calls = [];
  const suggest = async (q) => { calls.push(q); return [{ id: 'kimgh', name: '김기호' }, { id: 'KIMGHW', name: ' 김거화 ' }]; };
  assert.equal(await lookupName('kimghw', { suggest }), '김거화');
  assert.deepEqual(calls, ['kimghw']);
});
await ta('그 ID 가 없으면 빈 글', async () =>
  assert.equal(await lookupName('nobody', { suggest: async () => [{ id: 'hong', name: '홍길동' }] }), ''));
await ta('빈 ID 는 묻지 않는다', async () => {
  let asked = 0;
  assert.equal(await lookupName('  ', { suggest: async () => { asked++; return []; } }), '');
  assert.equal(asked, 0);
});
await ta('조회 실패는 그대로 던진다', async () =>
  assert.rejects(lookupName('kimghw', { suggest: async () => { throw new Error('HTTP 500'); } }), /HTTP 500/));

console.log(`\n${pass} 개 통과`);
