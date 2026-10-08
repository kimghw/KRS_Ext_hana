// 웹페이지 캡처(src/pagecap.js) — 찍을 자리·A4 장 자르기·글자 다듬기·찍는 차례(가짜 탭)·여러 탭·고르기 막(jsdom)·고른 칸 찍기(가짜 페이지)·잇기(가짜 캔버스).
// 화면 쪽(공문 탭의 단추 둘 → 읽기 → 첨부 PDF)은 test/wiring.test.mjs, 출장 카드 쪽은 test/tripcap.test.mjs 가 본다.
import assert from 'node:assert/strict';

import {
  MAX_SHOTS, SHOT_GAP_MS, MAX_SCALE, A4_RATIO, TEXT_MAX, shotPlan, tileRanges, capturable, hostOf, tileName, normalizeText,
  stitchTiles, capturePage, captureMany, readSlots, pageInfo, pageStep, pageDone,
  pagePick, pickCancel, frameProbe, partInfo, partStep, partDone, capturePart, captureParts, matchFrame,
} from '../src/pagecap.js';
import { JSDOM } from 'jsdom';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

console.log('찍을 자리');
t('한 화면 높이씩 내려가고 마지막은 끝에 맞춘다 — 끝 화면은 앞 화면과 겹친다', () => {
  assert.deepEqual(shotPlan({ scrollHeight: 2500, viewportHeight: 1000 }), { steps: [0, 1000, 1500], height: 2500, cut: false });
  assert.deepEqual(shotPlan({ scrollHeight: 2000, viewportHeight: 1000 }), { steps: [0, 1000], height: 2000, cut: false });
});
t('한 화면보다 짧은 페이지는 한 장이다', () => {
  assert.deepEqual(shotPlan({ scrollHeight: 400, viewportHeight: 1000 }), { steps: [0], height: 1000, cut: false });
  assert.deepEqual(shotPlan({ scrollHeight: 0, viewportHeight: 0 }), { steps: [0], height: 1, cut: false });
});
t(`${MAX_SHOTS}화면을 넘는 긴 페이지는 앞부분만 찍고 cut 에 표시한다`, () => {
  const plan = shotPlan({ scrollHeight: 100_000, viewportHeight: 1000 });
  assert.equal(plan.steps.length, MAX_SHOTS);
  assert.deepEqual([plan.height, plan.cut], [MAX_SHOTS * 1000, true]);
});
t('찍기 사이의 틈은 captureVisibleTab 의 초당 두 장 제한보다 길다', () => assert.ok(SHOT_GAP_MS >= 500));

console.log('A4 장 자르기');
t('한 장의 높이로 자르고 끝의 짧은 꼬리(1/5 미만)는 앞 장에 붙인다', () => {
  assert.deepEqual(tileRanges(5000, 1697), [{ y: 0, h: 1697 }, { y: 1697, h: 1697 }, { y: 3394, h: 1606 }]);
  assert.deepEqual(tileRanges(3500, 1697), [{ y: 0, h: 1697 }, { y: 1697, h: 1803 }], '106px 꼬리는 앞 장에');
  assert.deepEqual(tileRanges(3800, 1697), [{ y: 0, h: 1697 }, { y: 1697, h: 1697 }, { y: 3394, h: 406 }], '406px 는 한 장');
});
t('한 장보다 짧으면 그 높이 한 장, 0 이면 없다', () => {
  assert.deepEqual(tileRanges(300, 1697), [{ y: 0, h: 300 }]);
  assert.deepEqual(tileRanges(0, 1697), []);
});
t('A4 비율', () => assert.ok(Math.abs(A4_RATIO - 1.4143) < 0.001));

console.log('주소·이름·글자');
t('http·https 만 캡처한다 — 브라우저 안쪽 화면·빈 탭은 까닭을 말한다', () => {
  assert.equal(capturable('https://www.inflearn.com/course/x').ok, true);
  assert.equal(capturable('http://intra/').ok, true);
  assert.match(capturable('chrome://extensions').why, /캡처할 수 없습니다/);
  assert.match(capturable('chrome-extension://abc/sidepanel.html').why, /캡처할 수 없습니다/);
  assert.match(capturable('').why, /캡처할 탭이 없습니다/);
});
t('호스트는 www. 을 뺀다, 이름은 화면캡처_호스트_날짜_n.png', () => {
  assert.equal(hostOf('https://www.inflearn.com/course/x?a=1'), 'inflearn.com');
  assert.equal(hostOf('nonsense'), 'page');
  assert.equal(tileName('inflearn.com', '2026-10-08', 3), '화면캡처_inflearn.com_2026-10-08_3.png');
  assert.equal(tileName('a:b/c', '', 1), '화면캡처_abc_1.png', '파일 이름에 못 쓰는 글자는 뺀다');
});
t('화면 글자는 머리말(제목·주소)을 달고, 빈 줄은 하나로, 빈칸은 하나로', () => {
  const got = normalizeText('  강의 소개 \n\n\n\n커리큘럼\t섹션 1 ·  강의 2\r\n\n  ', { title: 'Hermes Bot 강의 - 인프런', url: 'https://www.inflearn.com/course/x' });
  assert.equal(got, '[웹페이지 글자 — Hermes Bot 강의 - 인프런] https://www.inflearn.com/course/x\n강의 소개\n\n커리큘럼 섹션 1 · 강의 2');
  assert.equal(normalizeText('   \n\n'), '', '글자가 없으면 빈 글');
});
t(`글자는 ${TEXT_MAX}자에서 자르고 잘랐다고 적는다`, () => {
  const got = normalizeText('가'.repeat(TEXT_MAX + 500));
  assert.ok(got.length < TEXT_MAX + 100);
  assert.match(got, /…\(너무 길어 여기서 잘랐습니다\)$/);
});

console.log('탭 안에서 도는 함수 — 바깥 변수를 쓰지 않는다(chrome.scripting 이 글자 그대로 옮긴다)');
/** 다른 창(jsdom)에서 만든 것은 프로토타입이 달라 deepEqual 이 다르다고 본다 — 글로 옮겼다 되돌린다. */
const plain = (x) => JSON.parse(JSON.stringify(x));
const IN_PAGE = [pageInfo, pageStep, pageDone, pagePick, pickCancel, frameProbe, partInfo, partStep, partDone];
t('탭 안에서 도는 함수들은 import 한 것도 모듈의 상수도 쓰지 않는다', () => {
  for (const fn of IN_PAGE) {
    const src = fn.toString();
    assert.ok(!/MAX_SHOTS|SHOT_GAP_MS|A4_RATIO|TEXT_MAX|TEXT_HEAD|READY_MS|normalizeText|tileRanges|shotPlan|hostOf|capturable|sleep\(/.test(src), `${fn.name} 이 모듈의 것을 쓴다`);
  }
});
t('글자 그대로 다른 창에 옮겨도 돈다 — chrome.scripting 이 하는 것처럼 페이지 창에서 소스로 다시 만든다', () => {
  const { window } = new JSDOM('<p data-krs-cap="1">글자</p>', { runScripts: 'outside-only', url: 'https://a.b/x' });
  for (const fn of IN_PAGE) assert.equal(typeof window.eval(`(${fn.toString()})`), 'function', fn.name);
  const info = window.eval(`(${partInfo.toString()})`)(1);
  assert.deepEqual([info.url, info.text, info.frame, info.box], ['https://a.b/x', '글자', false, null]);
  assert.deepEqual(plain(window.eval(`(${frameProbe.toString()})`)()), { href: 'https://a.b/x', name: '', w: 1024, h: 768, child: false });
});

console.log('페이지 위에서 부분 고르기 (jsdom — 자리는 data-rect 로 흉내)');
{
  // 카드(.card) 안에 문단, 그 둘레에 section, 옆에 본문 틀(iframe), 작은 단추(프레임이 아님). 자리는 data-rect="x y w h".
  const { window } = new JSDOM(`<body data-rect="0 0 1200 2000">
    <section id="sec" data-rect="0 100 1200 900"><div id="card" class="card" data-rect="20 120 600 300"><h3 data-rect="30 130 300 30">교육 안내</h3>
      <p id="p" data-rect="30 170 500 40">강의 소개 글</p><button id="btn" data-rect="30 220 80 30">신청</button></div></section>
    <iframe id="frm" name="content-iframe" src="https://a.b/frame" data-rect="0 1000 1200 800"></iframe></body>`, { runScripts: 'outside-only', url: 'https://a.b/' });
  const { document } = window;
  const rect = (el) => {
    const [x, y, w, h] = (el.dataset?.rect || '0 0 0 0').split(' ').map(Number);
    return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y };
  };
  window.Element.prototype.getBoundingClientRect = function () { return rect(this); };
  // 그 자리에 걸친 요소들 — 깊은 것부터(맨 위에 그려진 것부터). 고르기 막(host)이 있으면 그것이 맨 앞이다.
  document.elementsFromPoint = (x, y) => {
    const hits = [...document.querySelectorAll('[data-rect]')].filter((el) => { const r = rect(el); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; });
    hits.sort((a, b) => (a.contains(b) ? 1 : b.contains(a) ? -1 : 0));
    const host = document.querySelector('[data-krs-pick]');
    return host ? [host, ...hits] : hits;
  };
  const pick = window.eval(`(${pagePick.toString()})`);
  const shadow = () => document.querySelector('[data-krs-pick]')?.shadowRoot;
  const mouse = (type, x, y) => shadow().querySelector('.veil').dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
  const key = (k) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  const done = pick();
  await ta('막을 씌우고 위쪽 띠에 안내와 캡처(꺼짐)·취소가 선다 — shadow DOM 이라 페이지 CSS 와 섞이지 않는다', async () => {
    assert.ok(shadow(), '고르기 막');
    assert.match(shadow().querySelector('.bar').textContent, /캡처할 부분을 누르세요 — 여러 개 고를 수 있습니다/);
    assert.ok(shadow().querySelector('.go').disabled);
  });
  await ta('문단을 가리키면 그것을 품은 카드가 점선 칸이 되고, ↑ 는 한 겹 큰 칸(section) — 작은 단추는 프레임이 아니다', async () => {
    mouse('mousemove', 40, 180);
    const hover = shadow().querySelector('.box.hover');
    assert.ok(!hover.hidden);
    assert.deepEqual([hover.style.left, hover.style.top, hover.style.width, hover.style.height], ['20px', '120px', '600px', '300px']);
    assert.match(shadow().querySelector('.tag').textContent, /누르면 고르기 · 칸 600×300 · ↑ 더 큰 칸/);
    key('ArrowUp');
    assert.equal(hover.style.height, '900px', 'section');
    key('ArrowDown');
    assert.equal(hover.style.height, '300px');
    mouse('mousemove', 40, 230);
    assert.equal(hover.style.width, '600px', '단추 위여도 카드');
  });
  await ta('누르면 번호가 붙어 골라지고, 다시 누르면 빠진다 — 틀(iframe)은 틀째로 골라진다', async () => {
    mouse('click', 40, 180);
    assert.deepEqual([...shadow().querySelectorAll('.marks .box b')].map((b) => b.textContent), ['1']);
    assert.equal(shadow().querySelector('.go').textContent, '1개 캡처');
    mouse('mousemove', 600, 1500);
    mouse('click', 600, 1500);
    key('ArrowUp');   // 틀 위로는 더 큰 칸이 없다(body 는 프레임이 아니다)
    mouse('mousemove', 700, 500);
    key('ArrowUp');
    mouse('click', 700, 500);   // section 을 고르고
    assert.equal(shadow().querySelector('.go').textContent, '3개 캡처');
    mouse('click', 700, 500);   // 다시 누르면 빠진다
    assert.equal(shadow().querySelector('.go').textContent, '2개 캡처');
  });
  await ta('Enter 면 고른 차례대로 data-krs-cap 을 달고 목록을 준다 — 막은 걷힌다', async () => {
    key('Enter');
    const got = plain(await done);
    assert.equal(shadow(), undefined);
    assert.deepEqual(got, [
      { n: 1, tag: 'div', title: '교육 안내', frame: null },
      { n: 2, tag: 'iframe', title: 'content-iframe', frame: { href: got[1].frame.href, src: 'https://a.b/frame', name: 'content-iframe', w: 0, h: 0 } },
    ]);
    assert.deepEqual([document.getElementById('card').dataset.krsCap, document.getElementById('frm').dataset.krsCap], ['1', '2']);
    assert.equal(window.__krsPick, undefined);
  });
  await ta('Esc·취소·pickCancel 은 null — 앞서 단 표시는 그대로 둔다', async () => {
    const a = pick();
    key('Escape');
    assert.equal(await a, null);
    const b = pick();
    shadow().querySelector('.no').click();
    assert.equal(await b, null);
    const c = pick();
    window.eval(`(${pickCancel.toString()})`)();
    assert.equal(await c, null);
    assert.equal(document.querySelector('[data-krs-pick]'), null);
  });
  await ta('아무것도 고르지 않으면 Enter 는 듣지 않는다', async () => {
    const d = pick();
    key('Enter');
    assert.ok(shadow(), '그대로 고르는 중');
    key('Escape');
    assert.equal(await d, null);
  });
}

console.log('찍는 차례 (가짜 탭)');
/** 가짜 탭 — 높이 4200, 뷰포트 1200×1000. 찍을 때마다 자리를 적어 두고, 끝에 되돌렸는지 본다. */
function fakeTab({ scrollHeight = 4200, text = '강의 소개\n\n\n커리큘럼' } = {}) {
  const log = [];
  const page = { scrollY: 350, hidden: null };
  const exec = async (func, args) => {
    log.push([func.name, ...args]);
    if (func === pageInfo) {
      return { url: 'https://www.inflearn.com/course/x', title: 'Hermes Bot 강의', scrollHeight, viewportHeight: 1000, viewportWidth: 1200, dpr: 1.25, scrollY: page.scrollY, text };
    }
    if (func === pageStep) {
      const [y, hide] = args;
      if (hide) page.hidden = true;
      page.scrollY = Math.min(y, scrollHeight - 1000);
      return page.scrollY;
    }
    if (func === pageDone) {
      page.hidden = false;
      page.scrollY = args[0];
      return null;
    }
    throw new Error(`모르는 함수 ${func.name}`);
  };
  let shots = 0;
  const shoot = async () => `data:image/png;base64,${Buffer.from(`shot-${shots++}-at-${page.scrollY}`).toString('base64')}`;
  return { exec, shoot, log, page };
}

await ta('한 화면씩 내려가며 찍고(두 번째부터 고정 띠 숨김) 끝에 되돌린 뒤, A4 장과 머리말 단 글자를 돌려준다', async () => {
  const tab = fakeTab();
  const waits = [];
  const progress = [];
  let job;
  const got = await capturePage({
    tab: { url: 'https://www.inflearn.com/course/x' }, exec: tab.exec, shoot: tab.shoot, today: '2026-10-08',
    wait: async (ms) => { waits.push(ms); },
    stitch: async (j) => { job = j; return j.shots.map(() => new Blob(['png'], { type: 'image/png' })).slice(0, 3); },
    onProgress: (a, b) => progress.push(`${a}/${b}`),
  });
  // 4200 / 1000 → 0, 1000, 2000, 3000, 3200(끝에 맞춤)
  assert.deepEqual(tab.log.map((l) => l.join(' ')), ['pageInfo', 'pageStep 0 false', 'pageStep 1000 true', 'pageStep 2000 true', 'pageStep 3000 true', 'pageStep 3200 true', 'pageDone 350']);
  assert.deepEqual([tab.page.scrollY, tab.page.hidden], [350, false], '자리와 숨긴 것을 되돌렸다');
  assert.deepEqual(waits, Array(5).fill(SHOT_GAP_MS));
  assert.deepEqual(progress, ['1/5', '2/5', '3/5', '4/5', '5/5']);
  assert.deepEqual(job.shots.map((s) => [s.y, s.h]), [[0, 1000], [1000, 1000], [2000, 1000], [3000, 1000], [3200, 1000]], '실제로 선 자리를 쓴다');
  assert.deepEqual([job.viewportWidth, job.totalHeight, job.tileHeight], [1200, 4200, Math.round(1200 * A4_RATIO)]);
  assert.deepEqual(got.files.map((f) => [f.name, f.type]), [
    ['화면캡처_inflearn.com_2026-10-08_1.png', 'image/png'], ['화면캡처_inflearn.com_2026-10-08_2.png', 'image/png'], ['화면캡처_inflearn.com_2026-10-08_3.png', 'image/png'],
  ]);
  assert.equal(got.text, '[웹페이지 글자 — Hermes Bot 강의] https://www.inflearn.com/course/x\n강의 소개\n\n커리큘럼');
  assert.deepEqual([got.host, got.shots, got.tiles, got.cut, got.title], ['inflearn.com', 5, 3, false, 'Hermes Bot 강의']);
});
await ta('찍다가 실패해도 탭을 되돌린다', async () => {
  const tab = fakeTab();
  let n = 0;
  const shoot = async () => { if (++n === 2) throw new Error('Tabs cannot be edited right now'); return tab.shoot(); };
  await assert.rejects(capturePage({ tab: { url: 'https://a.b/' }, exec: tab.exec, shoot, wait: async () => {}, stitch: async () => [] }), /Tabs cannot be edited/);
  assert.equal(tab.log.at(-1)[0], 'pageDone');
  assert.deepEqual([tab.page.scrollY, tab.page.hidden], [350, false]);
});
await ta('캡처할 수 없는 주소는 탭을 건드리지 않고 던진다', async () => {
  const tab = fakeTab();
  await assert.rejects(capturePage({ tab: { url: 'chrome://extensions' }, exec: tab.exec, shoot: tab.shoot }), /캡처할 수 없습니다/);
  assert.deepEqual(tab.log, []);
});
await ta('긴 페이지는 앞부분만 찍고 cut 을 알린다', async () => {
  const tab = fakeTab({ scrollHeight: 100_000 });
  const got = await capturePage({ tab: { url: 'https://a.b/' }, exec: tab.exec, shoot: tab.shoot, wait: async () => {}, stitch: async (j) => j.shots.slice(0, 1).map(() => new Blob(['x'])) });
  assert.deepEqual([got.shots, got.cut], [MAX_SHOTS, true]);
});

console.log('여러 탭 (2026-10-08 — 전체 또는 하나 이상 골라 찍기)');
t('읽기 자리는 탭마다 첫 장부터 돌아가며 나눈다 — 긴 탭 하나가 다 차지하지 않는다', () => {
  assert.deepEqual(readSlots([4, 3], 5), [true, true, true, false, true, true, false]);
  assert.deepEqual(readSlots([7], 5), [true, true, true, true, true, false, false], '탭 하나면 앞 다섯 장');
  assert.deepEqual(readSlots([1, 6, 1], 5), [true, true, true, true, false, false, false, true]);
  assert.deepEqual(readSlots([2, 2], 0), [false, false, false, false], '자리가 없으면 모두 첨부에만');
  assert.deepEqual(readSlots([2, 1], 9), [true, true, true]);
});
/** 가짜 창 — 탭마다 fakeTab 을 두고, 앞에 둔 탭을 적어 둔다. */
function fakeWindow(pages) {
  const front = { id: 9 };
  const order = [];
  const tabs = Object.fromEntries(Object.entries(pages).map(([id, opts]) => [id, fakeTab(opts)]));
  return {
    front, order, tabs,
    activate: async (tab) => { if (tab.id === 66) throw new Error('탭이 닫혔습니다'); front.id = tab.id; order.push(tab.id); },
    back: async () => { front.id = 9; order.push(9); },
    execIn: (tab) => tabs[tab.id].exec,
    shoot: async () => tabs[front.id].shoot(),
  };
}
const stitchAll = async (j) => j.shots.map(() => new Blob(['png'], { type: 'image/png' }));
await ta('고른 탭을 차례로 앞에 두고 찍은 뒤 보던 탭으로 돌아온다 — 같은 사이트는 장 번호를 잇고, 글자 한도는 탭 수로 나눈다', async () => {
  const win = fakeWindow({ 1: { scrollHeight: 2000, text: '가'.repeat(TEXT_MAX) }, 2: { scrollHeight: 1000, text: '나'.repeat(TEXT_MAX) } });
  const progress = [];
  const got = await captureMany({
    tabs: [{ id: 1, url: 'https://www.inflearn.com/course/x', title: '강의' }, { id: 2, url: 'https://www.inflearn.com/course/x/curriculum', title: '커리큘럼' }],
    activate: win.activate, back: win.back, execIn: win.execIn, shoot: win.shoot, wait: async () => {}, stitch: stitchAll, today: '2026-10-08',
    onProgress: (...a) => progress.push(a.join(' ')),
  });
  assert.deepEqual(win.order, [1, 2, 9]);
  assert.deepEqual(progress, ['1 2 1 2', '2 2 1 2', '1 1 2 2']);
  assert.deepEqual(got.pages.map((p) => p.files.map((f) => f.name.replace('화면캡처_inflearn.com_2026-10-08_', ''))), [['1.png', '2.png'], ['3.png']]);
  assert.deepEqual(got.failed, []);
  const total = got.pages.reduce((n, p) => n + p.text.length, 0) + 2;   // 이음 줄
  assert.ok(total <= TEXT_MAX, `두 탭의 글자를 합쳐 ${total}자 — ${TEXT_MAX}자 안이어야 한다`);
  assert.ok(got.pages.every((p) => /잘랐습니다\)$/.test(p.text)));
});
await ta('한 탭이 실패해도 나머지는 찍고 까닭을 남긴다, 모두 실패하면 던지고 그래도 보던 탭으로 돌아온다', async () => {
  const win = fakeWindow({ 1: {} });
  const got = await captureMany({
    tabs: [{ id: 66, url: 'https://gone.example/', title: '닫힌 탭' }, { id: 1, url: 'https://a.b/', title: '강의' }],
    activate: win.activate, back: win.back, execIn: win.execIn, shoot: win.shoot, wait: async () => {}, stitch: stitchAll,
  });
  assert.deepEqual([got.pages.length, got.failed], [1, [{ title: '닫힌 탭', why: '탭이 닫혔습니다' }]]);
  const win2 = fakeWindow({});
  await assert.rejects(captureMany({ tabs: [{ id: 66, url: 'https://gone.example/', title: '닫힌 탭' }], activate: win2.activate, back: win2.back, execIn: win2.execIn, shoot: win2.shoot }), /탭이 닫혔습니다/);
  assert.deepEqual(win2.order, [9]);
  await assert.rejects(captureMany({ tabs: [], activate: win2.activate, back: win2.back }), /고르세요/);
});

console.log('고른 부분 찍기 (가짜 페이지 — 창 1200×1000)');
/**
 * 가짜 페이지 — 고른 부분 n 의 자리(문서 기준 top·left·width·height)와 창 자리를 들고, partStep 이 창·상자를 내리면 창 안 자리를 셈한다.
 * box 를 주면 상자 안이 따로 내려가고(scrollHeight), frame 을 주면 그 틀 안의 가짜 창(pageInfo·pageStep·pageDone)을 준다.
 */
function fakePart({ top = 1500, left = 100, width = 800, height = 2500, box = null, frame = null, pageHeight = 6000, text = '카드 글자' } = {}) {
  const log = [];
  const page = { scrollY: 200, inner: 0, hidden: false, done: false };
  const vh = 1000;
  const at = () => ({ top: top - page.scrollY, left, width, height, inner: page.inner });
  const exec = async (func, args) => {
    log.push([func.name, ...args]);
    if (func === partInfo) {
      return { url: 'https://eclass.krs.co.kr/x', title: '공지', vw: 1200, vh, scrollY: page.scrollY, top, width, height,
        edge: { top: 1, left: 1, w: width - 2, h: height - 2 }, frame: !!frame, box: box ? { scrollTop: 0, scrollHeight: box } : null, text };
    }
    if (func === partStep) {
      // rel 은 부분의 머리에서 내려간 만큼 — 창을 부분의 머리 + rel 로 내린다(페이지 끝에서 멈춘다).
      const [, rel, inner] = args;
      page.hidden = true;
      if (rel != null) page.scrollY = Math.max(0, Math.min(top + rel, pageHeight - vh));
      if (inner != null) page.inner = Math.min(inner, box - (height - 2));
      return at();
    }
    if (func === partDone) {
      Object.assign(page, { hidden: false, done: true, scrollY: 200, inner: 0 });
      return null;
    }
    throw new Error(`모르는 함수 ${func.name}`);
  };
  const flog = [];
  const fpage = { scrollY: 0 };
  const inFrame = frame && (async (func, args) => {
    flog.push([func.name, ...args]);
    if (func === pageInfo) return { url: 'https://eclass.krs.co.kr/frame', title: '본문', scrollHeight: frame, viewportHeight: height - 2, viewportWidth: width - 2, dpr: 1, scrollY: 0, text: '틀 안 글자' };
    if (func === pageStep) { fpage.scrollY = Math.min(args[0], frame - (height - 2)); return fpage.scrollY; }
    if (func === pageDone) { fpage.scrollY = args[0]; return null; }
    throw new Error(`모르는 함수 ${func.name}`);
  });
  const shoot = async () => `data:image/png;base64,${Buffer.from(`at-${page.scrollY}-${page.inner}-${fpage.scrollY}`).toString('base64')}`;
  return { exec, frame: inFrame || null, shoot, log, flog, page };
}
const keepJob = (into) => async (j) => { into.job = j; return j.shots.map(() => new Blob(['png'], { type: 'image/png' })); };
await ta('창 모드 — 부분의 머리로 창을 내리고 한 화면씩 찍어, 부분의 칸만 오려 잇는다. 끝에 창·숨긴 띠를 되돌린다', async () => {
  const p = fakePart();
  const out = {};
  const got = await capturePart({ part: { n: 1, title: '교육 안내' }, exec: p.exec, shoot: p.shoot, wait: async () => {}, stitch: keepJob(out), today: '2026-10-08', seq: 3 });
  // 높이 2500 / 창 1000 → 부분 안 0·1000·1500(창 1500·2500·3000)
  assert.deepEqual(p.log.map((l) => l.join(' ')), ['partInfo 1', 'partStep 1 0 ', 'partStep 1 1000 ', 'partStep 1 1500 ', 'partDone 1']);
  assert.deepEqual(out.job.shots.map((s) => [s.y, s.h, s.crop]), [
    [0, 1000, { x: 100, y: 0, w: 800, h: 1000 }], [1000, 1000, { x: 100, y: 0, w: 800, h: 1000 }], [1500, 1000, { x: 100, y: 0, w: 800, h: 1000 }],
  ]);
  assert.deepEqual([out.job.viewportWidth, out.job.width, out.job.totalHeight, out.job.tileHeight], [1200, 800, 2500, Math.round(800 * A4_RATIO)]);
  assert.deepEqual([p.page.done, p.page.hidden, p.page.scrollY], [true, false, 200]);
  assert.deepEqual(got.files.map((f) => f.name), ['화면캡처_eclass.krs.co.kr_2026-10-08_3.png', '화면캡처_eclass.krs.co.kr_2026-10-08_4.png', '화면캡처_eclass.krs.co.kr_2026-10-08_5.png']);
  assert.equal(got.text, '[웹페이지 글자 — 공지 — 교육 안내] https://eclass.krs.co.kr/x\n카드 글자');
  assert.deepEqual([got.title, got.host, got.part, got.cut], ['교육 안내', 'eclass.krs.co.kr', 1, false]);
});
await ta('창 모드 — 페이지 끝이라 부분의 머리까지 못 내려가면 창 안의 그 자리에서 오리고, 한 화면보다 짧으면 그 높이 한 장이다', async () => {
  const p = fakePart({ top: 4800, height: 400, pageHeight: 5200 });
  const out = {};
  await capturePart({ part: { n: 2 }, exec: p.exec, shoot: p.shoot, wait: async () => {}, stitch: keepJob(out) });
  // 창은 4200 까지만 내려간다 — 부분은 창 안 600 에서 1000 까지
  assert.deepEqual(out.job.shots.map((s) => [s.y, s.h, s.crop.y]), [[0, 400, 600]]);
  assert.equal(out.job.totalHeight, 400);
});
await ta('창 모드 — 창이 내려가지 않는 페이지(스크롤이 막힘)면 같은 자리를 또 찍지 않는다', async () => {
  const p = fakePart({ top: 300, height: 1400, pageHeight: 1000 });
  const out = {};
  await capturePart({ part: { n: 1 }, exec: p.exec, shoot: p.shoot, wait: async () => {}, stitch: keepJob(out) });
  assert.deepEqual(out.job.shots.map((s) => [s.y, s.h, s.crop.y]), [[0, 700, 300]]);
});
await ta('상자 모드 — 안이 따로 내려가는 상자는 창을 상자 머리에 두고 상자 안을 보이는 높이씩 내린다', async () => {
  const p = fakePart({ top: 300, height: 402, width: 602, box: 1500 });
  const out = {};
  await capturePart({ part: { n: 1 }, exec: p.exec, shoot: p.shoot, wait: async () => {}, stitch: keepJob(out) });
  // 보이는 칸 400(테두리 안쪽) — 상자 안 0·400·800·1100
  assert.deepEqual(p.log.map((l) => l.join(' ')), ['partInfo 1', 'partStep 1 0 ', 'partStep 1  0', 'partStep 1  400', 'partStep 1  800', 'partStep 1  1100', 'partDone 1']);
  assert.deepEqual(out.job.shots.map((s) => s.y), [0, 400, 800, 1100]);
  assert.deepEqual(out.job.shots[0].crop, { x: 101, y: 1, w: 600, h: 400 });
  assert.deepEqual([out.job.width, out.job.totalHeight], [600, 1500]);
});
await ta('틀 모드 — 틀 안이 따로 내려가면(eClass 본문 틀) 틀 안을 내리며 찍고, 글자는 틀 안의 것이다. 틀의 자리도 되돌린다', async () => {
  const p = fakePart({ top: 80, left: 0, height: 702, width: 1202, frame: 2000 });
  const out = {};
  const got = await capturePart({ part: { n: 1, title: 'content-iframe' }, exec: p.exec, frame: p.frame, shoot: p.shoot, wait: async () => {}, stitch: keepJob(out) });
  assert.deepEqual(p.flog.map((l) => l.join(' ')), ['pageInfo', 'pageStep 0 false', 'pageStep 700 true', 'pageStep 1300 true', 'pageDone 0']);
  assert.deepEqual(out.job.shots.map((s) => [s.y, s.h]), [[0, 700], [700, 700], [1300, 700]]);
  assert.deepEqual(out.job.shots[0].crop, { x: 1, y: 1, w: 1199, h: 700 }, '창 폭(1200) 밖은 뺀다');
  assert.match(got.text, /^\[웹페이지 글자 — 공지 — content-iframe\] https:\/\/eclass\.krs\.co\.kr\/frame\n틀 안 글자$/);
  assert.equal(p.page.done, true);
});
await ta('틀을 못 맞췄으면(frame 없음) 창 모드로 틀이 보이는 만큼 찍는다', async () => {
  const p = fakePart({ top: 80, height: 702, width: 1202, frame: 2000 });
  const out = {};
  await capturePart({ part: { n: 1 }, exec: p.exec, frame: null, shoot: p.shoot, wait: async () => {}, stitch: keepJob(out) });
  assert.equal(out.job.shots.length, 1);
  assert.equal(out.job.totalHeight, 702);
});
await ta('부분이 사라졌으면 까닭을 던진다 — 여러 부분이면 나머지는 찍고 장 번호를 잇는다', async () => {
  const gone = { exec: async (func) => (func === partInfo ? null : null) };
  await assert.rejects(capturePart({ part: { n: 1 }, exec: gone.exec, shoot: async () => '' }), /고른 부분을 찾지 못했습니다/);
  const p = fakePart({ height: 600 });
  const exec = async (func, args) => (args[0] === 9 ? null : p.exec(func, args));
  const out = {};
  const progress = [];
  const got = await captureParts({
    parts: [{ n: 1, title: '첫 칸' }, { n: 9, title: '사라진 칸' }, { n: 1, title: '다시 첫 칸' }], exec, shoot: p.shoot, wait: async () => {},
    stitch: keepJob(out), today: '2026-10-08', onProgress: (...a) => progress.push(a.join(' ')),
  });
  assert.deepEqual(got.pages.map((x) => x.files.map((f) => f.name.slice(-6))), [['_1.png'], ['_2.png']]);
  assert.deepEqual(got.failed, [{ title: '사라진 칸', why: '고른 부분을 찾지 못했습니다 — 페이지가 바뀌었으면 다시 고르세요.' }]);
  assert.deepEqual(progress, ['1 1 1 3', '1 1 3 3']);
  await assert.rejects(captureParts({ parts: [], exec }), /고르세요/);
});
t('고른 틀의 frameId — 지금 주소 → 이름 → src → 크기, 하나로 좁혀지는 것. 맨 위 문서 바로 아래의 틀만 본다', () => {
  const frames = [
    { frameId: 0, href: 'https://e/', child: false },
    { frameId: 3, href: 'https://e/content?id=1', name: 'content-iframe', w: 1200, h: 700, child: true },
    { frameId: 4, href: 'https://ads/', name: '', w: 300, h: 250, child: true },
    { frameId: 5, href: 'https://e/content?id=1', name: 'inner', w: 1200, h: 700, child: false },
  ];
  assert.equal(matchFrame(frames, { href: 'https://e/content?id=1', name: '', src: '', w: 0, h: 0 }), 3);
  assert.equal(matchFrame(frames, { href: null, name: 'content-iframe', src: 'https://e/old', w: 0, h: 0 }), 3, '다른 사이트의 틀은 이름으로');
  assert.equal(matchFrame(frames, { href: null, name: '', src: 'https://ads/', w: 0, h: 0 }), 4);
  assert.equal(matchFrame(frames, { href: null, name: '', src: '', w: 300, h: 250 }), 4);
  assert.equal(matchFrame(frames, { href: null, name: '', src: '', w: 10, h: 10 }), null);
  assert.equal(matchFrame([frames[0], frames[2]], { href: null, name: 'x', src: '', w: 0, h: 0 }), 4, '틀이 하나뿐이면 그것');
  assert.equal(matchFrame(frames, null), null);
});

console.log('잇고 자르기 (가짜 캔버스)');
{
  // 가짜 캔버스 — 그린 것(어느 화면을 어느 자리에)과 만든 장의 크기를 적어 둔다.
  const made = [];
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; this.drawn = []; made.push(this); }
    // drawImage 는 다섯 인자(통째로)와 아홉 인자(오려서 — 오린 자리는 끝에 붙여 적는다) 둘 다 받는다.
    getContext() { const c = this; return { fillRect() {}, drawImage(bm, ...a) { c.drawn.push(a.length === 8 ? [bm.tag, ...a.slice(4), a.slice(0, 4)] : [bm.tag, ...a]); } }; }
    async convertToBlob({ type }) { return new Blob([`tile-${this.height}`], { type }); }
  };
  const opened = [];
  const bitmapOf = async (dataUrl) => {
    const tag = Buffer.from(dataUrl.split(',')[1], 'base64').toString();
    const bm = { tag, width: 1500, height: 1250, closed: false, close() { this.closed = true; } };   // 1200×1000 CSS 를 1.25 배로 찍은 것
    opened.push(bm);
    return bm;
  };
  const shot = (tag) => `data:image/png;base64,${Buffer.from(tag).toString('base64')}`;
  await ta('장마다 캔버스를 내어 걸치는 화면만 그리고(배율은 첫 화면으로 잰다), 쓴 그림은 닫는다', async () => {
    made.length = 0;
    const shots = [{ dataUrl: shot('s0'), y: 0, h: 1000 }, { dataUrl: shot('s1'), y: 1000, h: 1000 }, { dataUrl: shot('s2'), y: 1200, h: 1000 }];
    const blobs = await stitchTiles({ shots, viewportWidth: 1200, totalHeight: 2200, tileHeight: 1697 }, { bitmapOf });
    assert.equal(blobs.length, 2);
    assert.deepEqual(made.map((c) => [c.width, c.height]), [[1500, 2121], [1500, 629]]);   // 1.25 배 저장
    assert.deepEqual(made[0].drawn, [['s0', 0, 0, 1500, 1250], ['s1', 0, 1250, 1500, 1250], ['s2', 0, 1500, 1500, 1250]]);
    assert.deepEqual(made[1].drawn, [['s1', 0, -871, 1500, 1250], ['s2', 0, -621, 1500, 1250]], '첫 화면은 둘째 장에 걸치지 않는다');
    assert.ok(opened.every((bm) => bm.closed));
    assert.deepEqual(await Promise.all(blobs.map((b) => b.text())), ['tile-2121', 'tile-629']);
  });
  await ta(`배율이 ${MAX_SCALE} 을 넘으면 줄여 저장한다`, async () => {
    made.length = 0;
    const big = async () => ({ tag: 'b', width: 3600, height: 3000, close() {} });   // 3 배
    await stitchTiles({ shots: [{ dataUrl: shot('b'), y: 0, h: 1000 }], viewportWidth: 1200, totalHeight: 1000, tileHeight: 1697 }, { bitmapOf: big });
    assert.deepEqual(made.map((c) => [c.width, c.height]), [[2400, 2000]]);
    assert.deepEqual(made[0].drawn, [['b', 0, 0, 2400, 2000]]);
  });
  await ta('부분을 찍은 것은 화면마다 crop 만 오려 붙이고, 장의 폭은 그 부분의 폭이다', async () => {
    made.length = 0;
    const shots = [{ dataUrl: shot('c0'), y: 0, h: 1000, crop: { x: 100, y: 0, w: 800, h: 1000 } }, { dataUrl: shot('c1'), y: 600, h: 400, crop: { x: 100, y: 600, w: 800, h: 400 } }];
    await stitchTiles({ shots, viewportWidth: 1200, width: 800, totalHeight: 1000, tileHeight: 1131 }, { bitmapOf });
    assert.deepEqual(made.map((c) => [c.width, c.height]), [[1000, 1250]], '1.25 배');
    assert.deepEqual(made[0].drawn, [['c0', 0, 0, 1000, 1250, [125, 0, 1000, 1250]], ['c1', 0, 750, 1000, 500, [125, 750, 1000, 500]]]);
  });
  await ta('찍은 것이 없으면 던진다', async () => {
    await assert.rejects(stitchTiles({ shots: [], viewportWidth: 1200, totalHeight: 0, tileHeight: 1697 }, { bitmapOf }), /찍은 화면이 없습니다/);
  });
  delete globalThis.OffscreenCanvas;
}

console.log(`\n${pass} passed`);
