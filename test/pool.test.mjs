// 여러 일을 나란히 돌리는 길(src/pool.js) — 증빙 여러 장을 한꺼번에 읽힐 때 쓴다(2026-10-05 사용자 지정).
// 결과는 넣은 차례 그대로이고, 한꺼번에 도는 수는 묶여 있으며, 하나가 실패하면 아직 시작하지 않은 것은 시작하지 않는다.
import assert from 'node:assert/strict';
import { mapPool, READ_POOL } from '../src/pool.js';

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 도는 수를 세는 일 — 가장 많이 겹친 수(peak)와 시작한 차례(started)를 적는다. */
function tracked(msOf = () => 20) {
  const seen = { now: 0, peak: 0, started: [] };
  const fn = async (item, i) => {
    seen.started.push(item);
    seen.peak = Math.max(seen.peak, ++seen.now);
    await wait(msOf(item, i));
    seen.now--;
    return `${item}!`;
  };
  return { fn, seen };
}

console.log('나란히 돌리기');
await ta('결과는 넣은 차례 그대로다 — 먼저 끝난 것이 앞에 서지 않는다', async () => {
  const { fn, seen } = tracked((item) => ({ a: 60, b: 5, c: 30 }[item]));
  assert.deepEqual(await mapPool(['a', 'b', 'c'], 3, fn), ['a!', 'b!', 'c!']);
  assert.equal(seen.peak, 3, '세 개가 한꺼번에 돈다');
});
await ta('한꺼번에 도는 수는 묶인다 — 일곱 개를 넣어도 셋씩이고, 하나가 끝나면 다음 것이 이어 돈다', async () => {
  const { fn, seen } = tracked();
  const out = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, fn);
  assert.deepEqual([out, seen.peak, seen.started], [['1!', '2!', '3!', '4!', '5!', '6!', '7!'], 3, [1, 2, 3, 4, 5, 6, 7]]);
});
await ta('한 개면 그냥 그것만 돈다. 빈 목록은 빈 결과다', async () => {
  const { fn, seen } = tracked();
  assert.deepEqual([await mapPool(['x'], 3, fn), seen.peak, await mapPool([], 3, fn), await mapPool(null, 3, fn)], [['x!'], 1, [], []]);
});
await ta('하나가 던지면 그 까닭을 던지고, 아직 시작하지 않은 것은 시작하지 않는다', async () => {
  const started = [];
  const fn = async (item) => {
    started.push(item);
    await wait(item === 'a' ? 40 : 5);
    if (item === 'b') throw new Error('b 를 읽지 못했습니다');
    return item;
  };
  await assert.rejects(mapPool(['a', 'b', 'c', 'd', 'e'], 2, fn), /b 를 읽지 못했습니다/);
  await wait(80);
  assert.deepEqual(started, ['a', 'b'], '돌던 a 가 끝난 뒤에도 뒤의 것은 부르지 않았다');
});
await ta('증빙은 한꺼번에 세 장까지 읽힌다', async () => {
  assert.equal(READ_POOL, 3);
});

console.log(`\n통과 ${pass}건`);
