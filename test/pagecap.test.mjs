// 보고 있는 웹페이지 통째로 캡처(src/pagecap.js) — 찍을 자리·A4 장 자르기·글자 다듬기·찍는 차례(가짜 탭)·잇기(가짜 캔버스).
// 화면 쪽(공문 탭의 단추 → 읽기 → 첨부 PDF)은 test/wiring.test.mjs 의 "공문 탭 — 웹페이지 통째로 캡처" 가 본다.
import assert from 'node:assert/strict';

import {
  MAX_SHOTS, SHOT_GAP_MS, MAX_SCALE, A4_RATIO, TEXT_MAX, shotPlan, tileRanges, capturable, hostOf, tileName, normalizeText,
  stitchTiles, capturePage, pageInfo, pageStep, pageDone,
} from '../src/pagecap.js';

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
t('pageInfo·pageStep·pageDone 은 import 한 것도 모듈의 상수도 쓰지 않는다', () => {
  for (const fn of [pageInfo, pageStep, pageDone]) {
    const src = fn.toString();
    assert.ok(!/MAX_SHOTS|SHOT_GAP_MS|A4_RATIO|TEXT_MAX|normalizeText|tileRanges|shotPlan/.test(src), `${fn.name} 이 모듈의 것을 쓴다`);
  }
});

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

console.log('잇고 자르기 (가짜 캔버스)');
{
  // 가짜 캔버스 — 그린 것(어느 화면을 어느 자리에)과 만든 장의 크기를 적어 둔다.
  const made = [];
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; this.drawn = []; made.push(this); }
    getContext() { const c = this; return { fillRect() {}, drawImage(bm, x, y, w, h) { c.drawn.push([bm.tag, x, y, w, h]); } }; }
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
  await ta('찍은 것이 없으면 던진다', async () => {
    await assert.rejects(stitchTiles({ shots: [], viewportWidth: 1200, totalHeight: 0, tileHeight: 1697 }, { bitmapOf }), /찍은 화면이 없습니다/);
  });
  delete globalThis.OffscreenCanvas;
}

console.log(`\n${pass} passed`);
