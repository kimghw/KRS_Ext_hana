// 한 번 읽은 하루치 현황을 담아 두는 곳. 회의실·차량·내 예약 세 탭이 같은 것을 본다.
//
// 훑기는 하루에 요청 한 번이지만 한 달이면 서른 번이다. 패널을 열거나 탭을 옮길 때마다
// 다시 훑으면 느린 사이트를 계속 두드리게 된다. 그래서 **하루에 한 번만 훑고, 그 뒤로는
// 여기서 꺼내 쓴다.** 패널을 닫았다 열어도 남도록 저장소(chrome.storage)에도 같이 적는다.
//
// 다시 읽는 때는 셋뿐이다.
//   - 날이 바뀌었을 때: 오늘 읽은 것이 아니면 묵은 것이다
//   - 예약·취소로 그 날을 버렸을 때(drop)
//   - 새로고침을 눌렀을 때(부르는 쪽이 그 기간을 drop 하고 다시 훑는다)
// 확인 불가로 읽힌 날만은 10분 뒤에 다시 읽어 본다 — 잠깐의 실패가 하루 종일 남으면 안 된다.
//
// 담은 값에는 **언제 읽었는지**가 붙는다. 얼마나 묵었는지 말할 수 없는 캐시는 이미 찬 칸을
// "예약 가능"으로 보여주게 되는데, 이 앱에서 가장 나쁜 실패다. 그래서 화면에 그릴 때는
// 읽은 시각을 함께 말한다.

/** 시작할 때 미리 훑는 날 수. "한 달". */
export const MONTH_DAYS = 30;

/** 확인 불가로 읽힌 날을 다시 읽어 보기까지. 제대로 읽힌 날은 그날 하루를 쓴다. */
export const RETRY_MS = 10 * 60_000;

/** 저장소 키의 머리. 하루치가 `day|room|2026-10-02` 처럼 한 칸씩 들어간다. */
export const DAY_KEY_PREFIX = 'day|';

/** 세 탭이 쓰는 두 가지 현황. */
export const KINDS = ['room', 'car'];

const keyOf = (kind, date) => `${kind}|${date}`;

/** 그 시각의 날짜(로컬). 오늘 읽은 것인지 가르는 데 쓴다. */
const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

const looksLikeDay = (rec) =>
  !!rec && typeof rec === 'object' && !!rec.kind && !!rec.date && typeof rec.at === 'number';

/**
 * 날짜별 기록 보관소.
 *
 * @param {{retryMs?: number, now?: () => number, storage?: {get: Function, set: Function, remove: Function}}} opts
 *   시각은 주입받는다 — 테스트에서 묵히려고. storage 를 주면 담고 버릴 때마다 거기에도 적는다.
 */
export function createDayStore({ retryMs = RETRY_MS, now = () => Date.now(), storage = null } = {}) {
  const days = new Map();

  const readToday = (rec) => dayOf(rec.at) === dayOf(now());
  const isFresh = (rec) => {
    if (!rec) return false;
    // 확인 불가는 잠깐의 실패일 수 있다. 하루를 통째로 그렇게 두지 않는다.
    if (rec.confident === false) return now() - rec.at < retryMs;
    return readToday(rec);
  };
  const pick = (kind, date) => days.get(keyOf(kind, date)) || null;

  // 저장소에 적는 일은 곁다리다. 실패해도(용량·끊긴 확장) 메모리에 담긴 것은 그대로 쓴다.
  // 하루치를 한 칸씩 따로 적는다 — 창마다 패널이 따로 떠 있을 수 있어 통째로 적으면 서로 덮는다.
  const persist = (fn) => {
    if (storage) Promise.resolve().then(fn).catch(() => {});
  };

  const store = {
    /** 하루치를 담는다. 읽은 시각(at)을 붙여 돌려준다. */
    put(day) {
      if (!day || !day.kind || !day.date) return null;
      const rec = { ...day, at: now() };
      const key = keyOf(day.kind, day.date);
      days.set(key, rec);
      persist(() => storage.set({ [DAY_KEY_PREFIX + key]: rec }));
      return rec;
    },

    /** 담긴 기록. 묵었어도 준다 — 부르는 쪽이 '언제 읽은 것'인지 말할 수 있게. */
    get(kind, date) { return pick(kind, date); },

    /** 담겨 있고 아직 묵지 않았는가. */
    fresh(kind, date) { return isFresh(pick(kind, date)); },

    /** 그 날짜들이 모두(회의실·차량 둘 다) 신선하게 담겨 있는가. */
    covers(dates, kinds = KINDS) {
      return dates.every((date) => kinds.every((kind) => isFresh(pick(kind, date))));
    },

    /** 아직 읽지 않았거나 묵어서 다시 읽어야 할 날짜만. 훑을 목록이 된다. */
    missing(dates, kinds = KINDS) {
      return dates.filter((date) => kinds.some((kind) => !isFresh(pick(kind, date))));
    },

    /** 그 날짜들의 기록. 없는 날은 그냥 빠진다(내 예약 집계에 그대로 넘긴다). */
    list(dates, kinds = KINDS) {
      const out = [];
      for (const date of dates) {
        for (const kind of kinds) {
          const rec = pick(kind, date);
          if (rec) out.push(rec);
        }
      }
      return out;
    },

    /** 그 범위에서 가장 오래전에 읽은 시각. 0 이면 담긴 게 없다. */
    oldest(dates, kinds = KINDS) {
      let min = 0;
      for (const rec of store.list(dates, kinds)) if (!min || rec.at < min) min = rec.at;
      return min;
    },

    /** 예약·취소로 낡아진 날을 버린다. 버린 날은 다음에 다시 읽는다. */
    drop(dates, kinds = KINDS) {
      const gone = [];
      for (const date of dates) {
        for (const kind of kinds) {
          const key = keyOf(kind, date);
          days.delete(key);
          gone.push(DAY_KEY_PREFIX + key);
        }
      }
      if (gone.length) persist(() => storage.remove(gone));
    },

    /**
     * 저장소에 적어 둔 것을 불러온다. 패널을 열 때 한 번 부른다.
     * **오늘 읽은 것만** 되살리고 나머지는 저장소에서도 지운다 — 어제 것은 어차피 다시 읽는다.
     * @returns {Promise<number>} 되살린 기록 수
     */
    async restore() {
      if (!storage) return 0;
      const all = await storage.get(null);
      const gone = [];
      let n = 0;
      for (const [name, rec] of Object.entries(all || {})) {
        if (!name.startsWith(DAY_KEY_PREFIX)) continue;
        const key = name.slice(DAY_KEY_PREFIX.length);
        if (!looksLikeDay(rec) || keyOf(rec.kind, rec.date) !== key || !readToday(rec)) {
          gone.push(name);
          continue;
        }
        const have = days.get(key);
        if (!have || have.at < rec.at) days.set(key, rec);
        n++;
      }
      if (gone.length) persist(() => storage.remove(gone));
      return n;
    },

    /**
     * 다른 창의 패널이 담거나 버린 것을 따라간다(storage.onChanged 의 changes 를 그대로 넘긴다).
     * 따로 쥐고만 있으면 저쪽에서 취소한 날이 이쪽에는 하루 종일 남는다.
     */
    sync(changes) {
      for (const [name, change] of Object.entries(changes || {})) {
        if (!name.startsWith(DAY_KEY_PREFIX)) continue;
        const key = name.slice(DAY_KEY_PREFIX.length);
        const rec = change?.newValue;
        if (rec === undefined) {
          days.delete(key);
          continue;
        }
        if (!looksLikeDay(rec) || keyOf(rec.kind, rec.date) !== key) continue;
        // 내가 방금 적은 것도 되돌아온다. 더 새것을 쥐고 있으면 그것을 지킨다.
        const have = days.get(key);
        if (!have || have.at <= rec.at) days.set(key, rec);
      }
    },

    size() { return days.size; },

    clear() {
      const gone = [...days.keys()].map((key) => DAY_KEY_PREFIX + key);
      days.clear();
      if (gone.length) persist(() => storage.remove(gone));
    },
  };

  return store;
}
