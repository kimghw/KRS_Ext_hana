// 인명 검색 카드의 Teams 버튼: 사용자 ID 찾기, 링크 모양, 붙이기·떼기, 설정과의 연동, 매니페스트 배선.
// 가장 중요한 건 **ID 를 못 찾은 카드에 버튼을 붙이지 않는 것**이다 — 엉뚱한 사람에게 이어지면 안 된다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  userIdOf, nameOf, emailOf, teamsChatUrl, cardOf, buildButton, mountTeams, unmountTeams, startPeople,
  ENABLE_KEY, teamsEnabled, BTN_CLASS, STYLE_ID, ROW_SELECTOR,
} from '../src/people.js';
import { MAIL_DOMAIN, TEAMS_CHAT_URL } from '../src/config.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/**
 * 2026-09-28 MemberList 캡처의 인명 카드 뼈대. 사진·이름·버튼 줄만 남겼다.
 * 옵션으로 ID 가 어디에 있는지를 바꿔 가며 찾기 순서를 본다.
 */
function card({
  id = 'kimghw', name = '김거화', tooltip = true, clip = true, task = true, src = true, picTitle = false,
} = {}) {
  const picAttrs = [
    src ? `src="/intra/intranet/member/pic/${id}.gif"` : 'src="/intra/intranet/member/pic/00000.gif"',
    'onerror="this.src=\'/intra/intranet/member/pic/00000.gif\'"',
    'class="profile-pic tooltip-6" data-toggle="tooltip"',
    picTitle ? `title="${id}"` : 'title=""',
    tooltip ? `data-original-title="${id}"` : '',
    clip ? `onclick="copyToClipboard('${id}')"` : '',
  ].join(' ');
  return `<div class="item person_main"><div class="profile-card card">
    <div class="image"><img ${picAttrs}></div>
    <div class="row search_info_main"><div class="search_info_name">
      <h3 style="display:block;" class="Korean">
        ${name}
      </h3>
      <h3 style="display:none;" class="English">KIM Geohwa</h3>
    </div></div>
    <div class="search_info_btn">
      <button type="button" class="btn btn-outline-primary mb-1" onclick="RunCall(this, '8764')"><i class="fa-solid fa-headset"></i>Ext</button>
      <button type="button" class="btn btn-outline-orange mb-1"><i class="fa-solid fa-mobile"></i>Mobile</button>
      <button type="button" class="btn btn-outline-purple mb-1" ${task ? `onmouseover="titleMouseOver(event, this, '${id}', '-&nbsp;과제', '-&nbsp;R&amp;D')"` : ''} onmouseout="titleMouseOut(event, this)"><i class="fa-solid fa-user"></i>Task</button>
    </div>
  </div></div>`;
}

function pageDoc(body) {
  const dom = new JSDOM(`<html><head></head><body>${body}</body></html>`, {
    url: 'https://eclass.krs.co.kr/eClassVer4/searchmember/MemberList?searchOption=NAME&searchText=%EA%B9%80',
  });
  return dom.window.document;
}

const rowOf = (doc, i = 0) => doc.querySelectorAll(ROW_SELECTOR)[i];
const btnsOf = (doc) => [...doc.querySelectorAll(`.${BTN_CLASS}`)];

/** chrome.storage.local 흉내. 바꾼 것은 onChanged 로 알린다. */
function fakeStorage(init = {}) {
  const data = structuredClone(init);
  const listeners = [];
  const fire = (changes) => { for (const fn of listeners) fn(changes, 'local'); };
  return {
    data,
    get: async (keys) => {
      const out = {};
      for (const k of [].concat(keys)) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    set: async (obj) => {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
        data[k] = structuredClone(v);
      }
      fire(changes);
    },
    onChanged: (fn) => {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    listenerCount: () => listeners.length,
  };
}

console.log('사용자 ID 찾기 — 카드의 어느 자리에 있든');
{
  const idOf = (opts) => userIdOf(cardOf(rowOf(pageDoc(card(opts)))));
  t('사진 툴팁 제목(data-original-title)', () => assert.equal(idOf({}), 'kimghw'));
  t('툴팁이 아직 안 만들어졌으면 title', () =>
    assert.equal(idOf({ tooltip: false, clip: false, task: false, src: false, picTitle: true }), 'kimghw'));
  t('사진의 copyToClipboard', () => assert.equal(idOf({ tooltip: false, task: false, src: false }), 'kimghw'));
  t('Task 버튼의 titleMouseOver', () => assert.equal(idOf({ tooltip: false, clip: false, src: false }), 'kimghw'));
  t('마지막으로 사진 파일명', () => assert.equal(idOf({ tooltip: false, clip: false, task: false }), 'kimghw'));
  t('사진이 없어 자리표시자(00000)로 바뀐 src 는 ID 가 아니다', () =>
    assert.equal(idOf({ tooltip: false, clip: false, task: false, src: false }), null));
  t('어디에도 없으면 null', () => {
    const doc = pageDoc('<div class="item person_main"><div class="search_info_btn"><button>Task</button></div></div>');
    assert.equal(userIdOf(cardOf(rowOf(doc))), null);
  });
  t('이상한 글자가 섞인 값은 ID 로 보지 않는다', () =>
    assert.equal(idOf({ id: "a'b<c", tooltip: true, clip: false, task: false, src: false }), null));
  t('점·밑줄·하이픈은 ID 에 올 수 있다', () => assert.equal(idOf({ id: 'kim.gh_w-2' }), 'kim.gh_w-2'));
}

console.log('이름·메일·링크');
{
  const doc = pageDoc(card());
  t('한글 이름을 다듬어 준다', () => assert.equal(nameOf(cardOf(rowOf(doc))), '김거화'));
  t('한글이 없으면 영문', () => {
    const d = pageDoc(card().replace(/<h3 style="display:block;" class="Korean">[\s\S]*?<\/h3>/, ''));
    assert.equal(nameOf(cardOf(rowOf(d))), 'KIM Geohwa');
  });
  t('메일은 <id>@krs.co.kr', () => {
    assert.equal(MAIL_DOMAIN, 'krs.co.kr');
    assert.equal(emailOf('kimghw'), 'kimghw@krs.co.kr');
  });
  t('딥링크는 Teams 채팅 주소에 users 로', () => {
    assert.equal(teamsChatUrl('kimghw@krs.co.kr'), `${TEAMS_CHAT_URL}?users=kimghw%40krs.co.kr`);
    assert.match(TEAMS_CHAT_URL, /^https:\/\/teams\.microsoft\.com\/l\/chat\/0\/0$/);
  });
}

console.log('버튼 모양');
{
  const doc = pageDoc('');
  const a = buildButton(doc, { email: 'kimghw@krs.co.kr', name: '김거화' });
  t('사이트 버튼과 같은 틀(.btn.btn-outline-*.mb-1)에 우리 표식', () => {
    for (const c of ['btn', 'btn-outline-primary', 'mb-1', BTN_CLASS]) assert.ok(a.classList.contains(c), c);
  });
  t('링크라서 새 탭으로, 열린 탭이 우리 창을 못 건드리게', () => {
    assert.equal(a.tagName, 'A');
    assert.equal(a.target, '_blank');
    assert.equal(a.rel, 'noopener');
    assert.equal(a.href, teamsChatUrl('kimghw@krs.co.kr'));
  });
  t('글자는 Teams, 아이콘은 사이트의 Font Awesome', () => {
    assert.equal(a.textContent, 'Teams');
    assert.ok(a.querySelector('i.fa-solid'));
  });
  t('툴팁에 이름과 메일', () => assert.match(a.title, /김거화.*kimghw@krs\.co\.kr/));
  t('이름이 없어도 툴팁은 된다', () =>
    assert.match(buildButton(doc, { email: 'x@krs.co.kr', name: '' }).title, /^Teams 에서 1:1 채팅/));
}

console.log('붙이기·떼기');
{
  const doc = pageDoc(card() + card({ id: 'gihkim', name: '김기현' }) + card({ tooltip: false, clip: false, task: false, src: false }));
  t('ID 를 찾은 카드에만 붙는다 — 셋 중 둘', () => {
    assert.equal(mountTeams(doc), 2);
    assert.equal(btnsOf(doc).length, 2);
    assert.equal(rowOf(doc, 2).querySelector(`.${BTN_CLASS}`), null, 'ID 없는 카드에 버튼이 붙었다');
  });
  t('버튼 줄(.search_info_btn) 맨 끝, Task 다음', () => {
    const row = rowOf(doc);
    const last = row.lastElementChild;
    assert.ok(last.classList.contains(BTN_CLASS));
    assert.match(last.previousElementSibling.textContent, /Task/);
  });
  t('카드마다 제 사람에게 간다', () => {
    const [a, b] = btnsOf(doc);
    assert.equal(a.href, teamsChatUrl('kimghw@krs.co.kr'));
    assert.equal(b.href, teamsChatUrl('gihkim@krs.co.kr'));
    assert.match(b.title, /김기현/);
  });
  t('스타일은 한 번만', () => assert.equal(doc.querySelectorAll(`#${STYLE_ID}`).length, 1));
  t('사이트 버튼과 같은 폭(80px)이고, 넷째가 들어갈 자리가 없어 줄을 바꾼다', () => {
    const css = doc.getElementById(STYLE_ID).textContent;
    assert.match(css, /width:\s*80px/);
    assert.match(css, /font-size:\s*14px/);
    // 줄바꿈은 우리 버튼이 있는 줄에만 — 사이트의 다른 버튼 줄 모양은 건드리지 않는다.
    const wrapRule = css.split('}').find((r) => r.includes(`${ROW_SELECTOR}:has(.${BTN_CLASS})`));
    assert.ok(wrapRule, '줄바꿈 규칙이 없다');
    assert.match(wrapRule, /flex-wrap:\s*wrap/);
  });
  t('다시 불러도 더 붙지 않는다', () => {
    assert.equal(mountTeams(doc), 0);
    assert.equal(btnsOf(doc).length, 2);
    assert.equal(doc.querySelectorAll(`#${STYLE_ID}`).length, 1);
  });
  t('떼면 버튼도 스타일도 사라지고, 사이트 버튼은 그대로', () => {
    unmountTeams(doc);
    assert.equal(btnsOf(doc).length, 0);
    assert.equal(doc.getElementById(STYLE_ID), null);
    assert.equal(rowOf(doc).querySelectorAll('button').length, 3);
  });
  t('카드가 없는 문서에서는 아무것도 안 한다', () => {
    const empty = pageDoc('<div class="page-content"></div>');
    assert.equal(mountTeams(empty), 0);
    assert.equal(empty.getElementById(STYLE_ID), null);
  });
}

console.log('설정을 따른다 — 켜고 끄기, 나중에 나타난 카드');
{
  t('값이 없으면 켠 것', () => {
    assert.equal(ENABLE_KEY, 'teamsButton');
    assert.equal(teamsEnabled(undefined), true);
    assert.equal(teamsEnabled(true), true);
    assert.equal(teamsEnabled(false), false);
  });

  await ta('설정이 없으면 붙인다', async () => {
    const doc = pageDoc(card());
    const storage = fakeStorage();
    const h = await startPeople(doc, { storage, onChanged: storage.onChanged });
    assert.equal(h.mounted, true);
    assert.equal(btnsOf(doc).length, 1);
    h.stop();
  });

  await ta('꺼 둔 설정이면 붙이지 않는다', async () => {
    const doc = pageDoc(card());
    const storage = fakeStorage({ [ENABLE_KEY]: false });
    const h = await startPeople(doc, { storage, onChanged: storage.onChanged });
    assert.equal(h.mounted, false);
    assert.equal(btnsOf(doc).length, 0);
    h.stop();
  });

  await ta('패널에서 끄면 곧바로 사라지고, 켜면 돌아온다', async () => {
    const doc = pageDoc(card());
    const storage = fakeStorage();
    const h = await startPeople(doc, { storage, onChanged: storage.onChanged });
    await storage.set({ [ENABLE_KEY]: false });
    assert.equal(btnsOf(doc).length, 0);
    assert.equal(h.mounted, false);
    await storage.set({ [ENABLE_KEY]: true });
    assert.equal(btnsOf(doc).length, 1);
    assert.equal(h.mounted, true);
    h.stop();
  });

  await ta('다른 설정이 바뀌는 것에는 반응하지 않는다', async () => {
    const doc = pageDoc(card());
    const storage = fakeStorage();
    const h = await startPeople(doc, { storage, onChanged: storage.onChanged });
    const before = btnsOf(doc)[0];
    await storage.set({ myName: '홍길동', homeCard: false });
    assert.equal(btnsOf(doc)[0], before, '버튼이 다시 만들어졌다');
    h.stop();
  });

  await ta('켜져 있는 동안 나타난 카드에도 붙는다', async () => {
    const doc = pageDoc(card());
    const storage = fakeStorage();
    const h = await startPeople(doc, { storage, onChanged: storage.onChanged });
    assert.equal(btnsOf(doc).length, 1);
    doc.body.insertAdjacentHTML('beforeend', card({ id: 'gihkim', name: '김기현' }));
    await tick();
    assert.equal(btnsOf(doc).length, 2);
    assert.equal(btnsOf(doc)[1].href, teamsChatUrl('gihkim@krs.co.kr'));
    h.stop();
  });

  await ta('꺼진 뒤에 나타난 카드에는 붙지 않는다', async () => {
    const doc = pageDoc(card());
    const storage = fakeStorage();
    const h = await startPeople(doc, { storage, onChanged: storage.onChanged });
    await storage.set({ [ENABLE_KEY]: false });
    doc.body.insertAdjacentHTML('beforeend', card({ id: 'gihkim' }));
    await tick();
    assert.equal(btnsOf(doc).length, 0);
    h.stop();
  });

  await ta('stop 은 떼고, 듣던 것도 놓는다', async () => {
    const doc = pageDoc(card());
    const storage = fakeStorage();
    const h = await startPeople(doc, { storage, onChanged: storage.onChanged });
    assert.equal(storage.listenerCount(), 1);
    h.stop();
    assert.equal(btnsOf(doc).length, 0);
    assert.equal(storage.listenerCount(), 0);
    await storage.set({ [ENABLE_KEY]: true });
    assert.equal(btnsOf(doc).length, 0, '그만둔 뒤에도 설정에 반응했다');
  });
}

console.log('확장 배선');
{
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
  const boot = fs.readFileSync(new URL('people.js', root), 'utf8');
  t('eclass 에 people.js 콘텐츠 스크립트가 붙는다 (home.js 와 같은 항목)', () => {
    const cs = (manifest.content_scripts || []).find((c) => c.js.includes('people.js'));
    assert.ok(cs, 'content_scripts 에 people.js 가 없다');
    assert.ok(cs.js.includes('home.js'));
    assert.ok(cs.matches.some((m) => m.startsWith('https://eclass.krs.co.kr/')));
  });
  t('시동 스크립트는 src/people.js 를 동적으로 불러온다', () => assert.match(boot, /getURL\('src\/people\.js'\)/));
  t('시동 스크립트는 설정을 따르는 startPeople 을 부른다', () => assert.match(boot, /startPeople\(document\)/));
  t('경로가 아니라 카드가 있는지로 붙일 화면을 고른다', () => {
    assert.match(boot, /querySelector\('\.search_info_btn'\)/);
    assert.doesNotMatch(boot, /location\.pathname/);
  });
}

console.log(`\n통과 ${pass}건`);
