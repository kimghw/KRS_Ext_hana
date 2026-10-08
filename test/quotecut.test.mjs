// 구매 공문의 견적서 오리기(src/quotecut.js) — 칸 고르기·넓히기·빼는 장·이름·오려 잇기(가짜 캔버스).
// 화면 쪽(쇼핑몰 화면을 넣으면 가격 부분을 오려 견적서로 첨부 → 더 넓게·원래 장으로 → 첨부 PDF)은 test/wiring.test.mjs 가 본다.
import assert from 'node:assert/strict';

import { CUT_PAD, PAD_STEP, MAX_PAD, cutBoxes, cutPlan, cutDrop, cutName, cutQuote } from '../src/quotecut.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const png = (name, group) => ({ name, type: 'image/png', ...(group ? { group } : {}) });

console.log('오릴 칸 고르기');
t('넣은 그림에 있는 칸만 — PDF·없는 파일·견적서 양식으로 가린 파일은 오리지 않는다', () => {
  const files = [png('a.png'), { name: 'q.pdf', type: 'application/pdf' }, png('quote.png')];
  const parts = [{ file: 'quote.png', kind: 'quote' }, { file: 'a.png', kind: 'order' }];
  const area = [
    { file: 'a.png', left: 5, top: 10, right: 95, bottom: 40 }, { file: 'q.pdf', left: 0, top: 0, right: 50, bottom: 50 },
    { file: 'none.png', left: 0, top: 0, right: 50, bottom: 50 }, { file: 'quote.png', left: 0, top: 0, right: 50, bottom: 50 },
  ];
  assert.deepEqual(cutBoxes(area, files, parts), [{ file: 'a.png', left: 5, top: 10, right: 95, bottom: 40 }]);
  assert.deepEqual(cutBoxes(null, files), []);
});
t('뒤집혔거나 너무 작은 칸은 버리고, 0~1 의 비로 적어 왔으면 % 로 고친다', () => {
  const files = [png('a.png')];
  assert.deepEqual(cutBoxes([{ file: 'a.png', left: 50, top: 10, right: 20, bottom: 40 }], files), [], '왼쪽이 오른쪽보다 크다');
  assert.deepEqual(cutBoxes([{ file: 'a.png', left: 10, top: 10, right: 11, bottom: 40 }], files), [], '폭 1%');
  assert.deepEqual(cutBoxes([{ file: 'a.png', left: 0.1, top: 0.2, right: 0.9, bottom: 0.5 }], files), [{ file: 'a.png', left: 10, top: 20, right: 90, bottom: 50 }]);
});
t('넣은 차례(웹페이지 캡처면 위에서 아래)로 줄 세운다 — 두 장에 걸친 칸', () => {
  const files = [png('t_1.png', 'g'), png('t_2.png', 'g')];
  const out = cutBoxes([{ file: 't_2.png', left: 5, top: 0, right: 60, bottom: 20 }, { file: 't_1.png', left: 5, top: 80, right: 60, bottom: 100 }], files);
  assert.deepEqual(out.map((b) => b.file), ['t_1.png', 't_2.png']);
});

console.log('오릴 자리 — 넓히기·잇기');
t(`칸을 사방으로 짧은 변의 ${CUT_PAD * 100}%만큼 넓히고 그림 밖은 자른다`, () => {
  const plan = cutPlan([{ left: 10, top: 10, right: 60, bottom: 30 }], [{ width: 1000, height: 2000 }]);
  // 짧은 변 1000 × 0.03 = 30px — 가로·세로 같은 몫.
  assert.deepEqual(plan, { rects: [{ x: 70, y: 170, w: 560, h: 460 }], width: 560, height: 460 });
  const edge = cutPlan([{ left: 0, top: 0, right: 100, bottom: 100 }], [{ width: 800, height: 600 }]);
  assert.deepEqual(edge.rects, [{ x: 0, y: 0, w: 800, h: 600 }], '그림 밖으로 나가지 않는다');
});
t('더 넓게는 몫을 키운다 — 한도가 있다', () => {
  const a = cutPlan([{ left: 40, top: 40, right: 60, bottom: 60 }], [{ width: 1000, height: 1000 }], CUT_PAD + PAD_STEP);
  assert.deepEqual(a.rects, [{ x: 320, y: 320, w: 360, h: 360 }]);
  assert.ok(MAX_PAD > CUT_PAD && MAX_PAD < 0.5);
});
t('폭이 같은 장들(웹페이지 캡처)은 좌우를 하나로 맞춰 위아래로 잇는다 — 폭이 다르면 제 자리대로', () => {
  const plan = cutPlan([{ left: 10, top: 80, right: 50, bottom: 100 }, { left: 20, top: 0, right: 70, bottom: 10 }],
    [{ width: 1000, height: 1414 }, { width: 1000, height: 1414 }], 0);
  assert.deepEqual(plan.rects, [{ x: 100, y: 1131, w: 600, h: 283 }, { x: 100, y: 0, w: 600, h: 142 }]);
  assert.deepEqual([plan.width, plan.height], [600, 425]);
  const mixed = cutPlan([{ left: 10, top: 0, right: 50, bottom: 50 }, { left: 20, top: 0, right: 70, bottom: 50 }], [{ width: 1000, height: 1000 }, { width: 500, height: 500 }], 0);
  assert.deepEqual(mixed.rects.map((r) => [r.x, r.w]), [[100, 400], [100, 250]]);
  assert.equal(mixed.width, 400);
});

console.log('첨부에서 빠지는 장·이름');
t('오린 그림과 같은 묶음의 장은 빠지고, 따로 넣은 그림·다른 묶음은 남는다', () => {
  const files = [png('t_1.png', 'cap1'), png('t_2.png', 'cap1'), png('t_3.png', 'cap1'), png('spec.png'), png('p_1.png', 'cap2'), { name: 'x.pdf', type: 'application/pdf' }];
  assert.deepEqual(cutDrop([{ file: 't_1.png' }], files), ['t_1.png', 't_2.png', 't_3.png']);
  assert.deepEqual(cutDrop([{ file: 'spec.png' }], files), ['spec.png'], '묶음이 아니면 그 그림만');
});
t('오린 그림의 이름 — 넣은 파일과 겹치면 _2', () => {
  assert.equal(cutName('2026-10-08'), '견적서_가격부분_2026-10-08.png');
  assert.equal(cutName('2026-10-08', ['견적서_가격부분_2026-10-08.png']), '견적서_가격부분_2026-10-08_2.png');
  assert.equal(cutName(''), '견적서_가격부분.png');
});

console.log('오려 잇기 (가짜 캔버스)');
{
  const made = [];
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; this.drawn = []; made.push(this); }
    getContext() { const c = this; return { fillRect() {}, drawImage(bm, ...a) { c.drawn.push([bm.tag, ...a]); } }; }
    async convertToBlob({ type }) { return new Blob([`cut-${this.width}x${this.height}`], { type }); }
  };
  const opened = [];
  const bitmapOf = async (f) => {
    const bm = { tag: f.name, width: 1000, height: 1414, closed: false, close() { this.closed = true; } };
    opened.push(bm);
    return bm;
  };
  const files = [{ name: 't_1.png', dataUrl: 'data:,' }, { name: 't_2.png', dataUrl: 'data:,' }];
  await ta('칸마다 그림에서 오려 위아래로 잇고, 연 그림은 닫는다', async () => {
    const blob = await cutQuote(files, [{ file: 't_1.png', left: 10, top: 80, right: 50, bottom: 100 }, { file: 't_2.png', left: 20, top: 0, right: 70, bottom: 10 }], { pad: 0, bitmapOf });
    assert.deepEqual(made.map((c) => [c.width, c.height]), [[600, 425]]);
    assert.deepEqual(made[0].drawn, [['t_1.png', 100, 1131, 600, 283, 0, 0, 600, 283], ['t_2.png', 100, 0, 600, 142, 0, 283, 600, 142]]);
    assert.ok(opened.every((bm) => bm.closed));
    assert.equal(await blob.text(), 'cut-600x425');
    assert.equal(blob.type, 'image/png');
  });
  await ta('칸이 없거나 그림이 없으면 던진다 — 연 그림은 닫는다', async () => {
    await assert.rejects(cutQuote(files, [], { bitmapOf }), /오릴 칸이 없습니다/);
    opened.length = 0;
    await assert.rejects(cutQuote(files, [{ file: 't_1.png', left: 0, top: 0, right: 50, bottom: 50 }, { file: 'x.png', left: 0, top: 0, right: 50, bottom: 50 }], { bitmapOf }), /오릴 그림이 없습니다 — x\.png/);
    assert.ok(opened.length === 1 && opened[0].closed);
  });
  delete globalThis.OffscreenCanvas;
  await ta('캔버스가 없는 곳에서는 까닭을 말한다', async () => {
    await assert.rejects(cutQuote(files, [{ file: 't_1.png', left: 0, top: 0, right: 50, bottom: 50 }], { bitmapOf }), /그림을 오릴 수 없습니다/);
  });
}

console.log(`통과 ${pass}건`);
