// 여러 일을 나란히 돌리되, 한꺼번에 도는 수를 묶는다.
//
// 출장 증빙은 한 장을 읽는 데 6~8초가 걸린다(글자 뽑기 + Claude). 한 장씩 차례로 읽으면 장 수만큼 걸려서, 여러 장을 넣었을 때는
// 나란히 읽힌다(2026-10-05 사용자 지정 — 실제로 잰 것: 두 장 14.7초, 세 장을 나란히 부르면 10초). 다만 한 장마다 로컬 CLI 다리가
// 프로세스를 하나씩 띄우고 그림은 OCR 까지 돌리므로, 스무 장을 넣었다고 스무 개를 한꺼번에 띄우지는 않는다.

/** 증빙을 한꺼번에 몇 장까지 읽히는가. */
export const READ_POOL = 3;

/**
 * items 를 limit 개씩 나란히 fn 에 넘기고, **넣은 차례대로** 결과를 돌려준다(먼저 끝난 것이 앞에 서지 않는다).
 * 하나라도 던지면 아직 시작하지 않은 것은 시작하지 않고 그 까닭을 던진다 — 이미 돌던 것은 끝까지 돈다(결과는 버린다).
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapPool(items, limit, fn) {
  const list = [...(items || [])];
  const out = new Array(list.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < list.length) {
      const i = next++;
      try {
        out[i] = await fn(list[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(Number(limit) || 1, 1), list.length) }, worker));
  return out;
}
