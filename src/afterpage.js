// 사후정산 입력 화면(eclass /BusinessTrip/AfterTrip)에 **증빙을 놓으면 줄을 더해 칸을 채운다**(2026-10-03 사용자 지정).
//
//   끌어다 놓기 · 붙여넣기(Ctrl+V) · "+ 증빙으로 입력"(파일 고르기) · (첨부 칸이 보이면) 숙박 줄의 첨부 칸에서 고른 파일
//     → 배경(서비스 워커)이 Claude 로 한 장씩 읽는다(input.yaml 의 receipt — 패널의 출장 카드와 같은 명세·같은 길)
//     → 문서에 맞는 표(숙박비·교통비·기타 비용)의 "+ ADD입력"을 대신 눌러 줄을 만들고 읽은 값을 넣는다.
//
// **저장은 누르지 않는다.** 화면의 칸만 채운다 — 채운 칸은 노랗게, 못 읽은 필수 칸은 비워 둔 채 붉게 표시하고,
// 사람이 확인해 저장을 누른다. 틀린 값으로 채우느니 비워 둔다.
//
// 패널의 출장 카드(src/after.js 의 afterPlan)와 다른 점: 거기서는 기차표를 받지 않고(KTX 는 정가) 가는 편·오는 편으로 묶지만,
// 여기서는 사용자가 이 화면에 직접 놓은 것이므로 **문서에 적힌 대로** 한 장이 한 줄(왕복표는 두 줄)이 된다.
//
// 콘텐츠 스크립트는 격리된 세계라 사이트 함수(addLodge·setChk …)를 직접 못 부른다. 버튼을 누르고(click) 값이 바뀌었다고
// 알리면(change·input) 화면에 적힌 onclick·onchange 가 사이트 쪽에서 돈다 — 숙박비 상한 조회(calcMaxLodgeRow)도 그렇게 따라온다.
// 칸 이름(lodge_*, tr_*, other_*, air_*)과 줄을 만드는 함수는 2026-10-03 실제 사후정산 입력 화면 소스에서 확인했다.

import { AFTER_TRANSPORT, DOMESTIC, LODGE_CURRENCY, lodgeOf, lodgeSettle, vendorKey } from './after.js';
import { milesOf, isFirstSeat, describeMiles } from './mileage.js';
import { EVIDENCE_ACCEPT, acceptsFile } from './attend.js';

export const ROOT_ID = 'krsw-after-box';
const STYLE_ID = 'krsw-after-style';
const FILE_LIMIT = 10 * 1024 * 1024;
const MAX_LINES = 8;
const FILLED = 'krsw-filled';
const MISSING = 'krsw-missing';
const DRAGGING = 'krsw-dragging';
const OVER = 'krsw-over';

/** 화면의 세 내역 표. add 는 "+ ADD입력" 버튼이 부르는 사이트 함수 이름이다. */
export const SECTIONS = {
  lodge: { title: '숙박비 내역', body: 'lodgeBody', add: 'addLodge' },
  tr: { title: '교통비 내역', body: 'trBody', add: 'addTr' },
  other: { title: '기타 비용', body: 'otherBody', add: 'addOther' },
};

/* ------------------------------------------------------------ 읽은 기록 → 넣을 줄 (DOM 없이) */

const LODGING = new Set(['lodging_receipt', 'lodging_booking']);
/** 문서 종류가 말해 주는 교통수단. 택시·지하철·선박은 표 종류가 따로 없어 읽은 transport 를 본다. */
const RIDE_OF_DOC = { flight_ticket: 'plane', flight_receipt: 'plane', train_ticket: 'train', bus_ticket: 'bus' };
const RIDE_VALUE = {
  plane: AFTER_TRANSPORT.plane, train: AFTER_TRANSPORT.train, subway: AFTER_TRANSPORT.subway,
  ship: AFTER_TRANSPORT.ship, bus: AFTER_TRANSPORT.bus, taxi: AFTER_TRANSPORT.etc,
};
const DOC_NAME = {
  lodging_receipt: '숙박 영수증', lodging_booking: '숙박 예약 확인서', flight_ticket: '항공권', flight_receipt: '항공권 영수증',
  train_ticket: '기차표', bus_ticket: '버스표',
};
const LODGE_REQUIRED = { lodge_company: '업체명', lodge_paydate: '결재일자', lodge_sday: '숙박 일수', lodge_total: '정산금액' };
const TR_REQUIRED = { tr_date: '일자', tr_dep: '출발지', tr_arr: '도착지', tr_total: '합계' };
/** 예약 확인서가 채운 값 가운데 결제 영수증이 오면 바꿀 것 — 금액과 결제일은 영수증이 맞다. */
const BOOKING_WEAK = ['lodge_paydate', 'lodge_total', 'lodge_samount', 'lodge_vat'];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const money = (n) => (n == null ? '' : String(Math.round(n * 100) / 100));
const hourOf = (t) => (/^\d{2}:\d{2}$/.test(t || '') ? String(+t.slice(0, 2)) : '');

/**
 * 읽은 증빙 한 장(input.yaml 의 receipt)을 이 화면의 어느 표에 어떤 줄로 넣을지 정한다.
 *
 * - 숙박 영수증·인보이스·예약 확인서 → 숙박비 내역 한 줄. 업체명은 산 곳(구매처)이고 묵은 곳은 비고에, 정산금액은 원화로만 넣는다
 *   (외화 문서에 원화 금액이 없으면 비워 둔다). 공급가액·부가세는 문서에 없으면 정산금액에서 되셈한다.
 * - 항공권·기차표·버스표, 택시·지하철·선박 영수증 → 교통비 내역. 왕복표 한 장은 두 줄이고 합계를 반씩 나눈다
 *   (src/travel.js 의 ticketsOf 와 같은 셈). 항공권이면 항공 마일리지 칸도 켠다(항공권 출장 = 예) — 신규 마일리지는 문서에 적힌 값,
 *   없으면 항공 마일리지 표(air-mileage.yaml)의 값이다.
 * - 그 밖의 영수증·모르는 문서는 **놓은 표**(hint)를 따른다 — 어느 표에 놓았는지 모르면 넣지 않는다.
 *   문서 종류가 뚜렷하면 놓은 표와 달라도 종류에 맞는 표로 간다(notes 에 적는다).
 *
 * @param {object} record receipt 명세를 지난 기록
 * @param {string} [hint] 사용자가 놓은 표(lodge·tr·other). 모르면 빈 글
 * @returns {{section: string, rows: {values: Record<string,string>, required: Record<string,string>, cocard: boolean,
 *            key?: string, weak?: string[], strong?: boolean}[], air: {airline: string, mileage: number|null}|null, notes: string[]}}
 *   values 는 칸 이름 → 넣을 값(빈 글이면 넣지 않는다), required 는 칸 이름 → 못 읽었을 때 부를 이름이다
 */
export function fillPlan(record, hint = '') {
  const r = record || {};
  const notes = [];
  const rows = [];
  let air = null;
  const lodging = LODGING.has(r.docType);
  const ride = lodging ? '' : RIDE_OF_DOC[r.docType] || r.transport || '';
  const section = lodging ? 'lodge' : ride ? 'tr' : Object.hasOwn(SECTIONS, hint) ? hint : '';
  const total = num(r.total);
  const cocard = r.corporateCard === true;
  const currency = r.currency || '';

  if (!section) {
    notes.push(`${r.docType === 'other_receipt' ? '숙박·교통 증빙이 아닌 영수증입니다' : '무슨 문서인지 읽지 못했습니다'} — 넣을 표(숙박비·교통비·기타 비용) 위에 놓으면 그 표에 채웁니다`);
  } else if (Object.hasOwn(SECTIONS, hint) && hint !== section) {
    notes.push(`${DOC_NAME[r.docType] || '교통비 영수증'}(이)라 ${SECTIONS[section].title}에 넣었습니다`);
  }

  if (section === 'lodge') {
    // 출장 카드와 같은 셈이다(src/after.js 의 lodgeOf·lodgeSettle, 2026-10-03 사용자 지정) — 업체명은 산 곳(구매처)이고 묵은 곳은
    // 비고에, 정산금액은 원화로만, 공급가액·부가세는 문서에 없으면 정산금액에서 되셈한다. 상한액은 화면이 정산금액 아래에 보여 준다.
    const booking = r.docType === 'lodging_booking';
    const l = lodgeSettle(lodgeOf(booking ? [] : [r], booking ? [r] : []));
    const foreign = l.doc.currency !== LODGE_CURRENCY;
    rows.push({
      values: {
        lodge_paydate: l.paydate || '', lodge_sday: money(l.sday), lodge_company: l.company, lodge_companycode: l.companycode, lodge_currency: LODGE_CURRENCY,
        lodge_total: money(l.total), lodge_samount: money(l.samount), lodge_vat: money(l.vat), lodge_comment: l.comment,
      },
      required: LODGE_REQUIRED, cocard, key: vendorKey(r.vendor), weak: booking ? BOOKING_WEAK : [], strong: r.docType === 'lodging_receipt', foreign,
    });
    if (booking) notes.push('예약 확인서입니다 — 금액은 예약 금액입니다(결제 영수증을 같이 넣으면 그 값으로 바꿉니다)');
    else if (!lodging) notes.push('숙박 증빙으로 읽히지는 않았습니다 — 채운 값을 확인해 주세요');
    if (foreign && l.doc.total != null) {
      notes.push(l.total == null
        ? `외화 문서입니다(${money(l.doc.total)} ${l.doc.currency}) — 정산금액은 원화로 적습니다. 원화로 결제된 금액을 정산금액 칸에 적어 주세요`
        : `외화 문서입니다(${money(l.doc.total)} ${l.doc.currency}) — 문서에 적힌 원화 금액을 정산금액에 넣었습니다`);
    }
    if (l.vatFrom === 'calc') notes.push('공급가액·부가세는 문서에 없어 정산금액에서 역산했습니다(÷ 1.1)');
  }

  if (section === 'tr') {
    const ticket = !!RIDE_OF_DOC[r.docType];
    const round = !!(r.retDate || text(r.retDepPlace) || text(r.retArrPlace));
    const first = total != null && round ? Math.ceil(total / 2) : total;
    // 비고에는 항공사·편명을, 표가 아닌 영수증(택시 등)이면 가맹점 이름을 적는다.
    const name = (no) => [text(r.airline), text(no)].filter(Boolean).join(' ') || (ticket ? '' : text(r.vendor));
    const leg = (o) => ({
      values: {
        tr_date: o.date, tr_shr: o.shr, tr_ehr: o.ehr, tr_dep: o.dep, tr_arr: o.arr, tr_transport: RIDE_VALUE[ride] || AFTER_TRANSPORT.etc,
        tr_grade: text(r.seatClass), tr_total: money(o.total), tr_currency: currency, tr_comment: o.comment,
      },
      required: TR_REQUIRED, cocard,
    });
    // 표의 날짜는 탄 날이다. 표가 아닌 영수증은 탄 날이 따로 없으면 결제일이 그날이다.
    rows.push(leg({
      date: r.flightDate || (ticket ? '' : r.payDate) || '', shr: hourOf(r.depTime), ehr: hourOf(r.arrTime),
      dep: text(r.depPlace), arr: text(r.arrPlace), total: first, comment: name(r.flightNo),
    }));
    if (round) {
      rows.push(leg({
        date: r.retDate || '', shr: hourOf(r.retDepTime), ehr: '', dep: text(r.retDepPlace) || text(r.arrPlace), arr: text(r.retArrPlace) || text(r.depPlace),
        total: total != null ? total - first : null, comment: name(r.retFlightNo),
      }));
      notes.push('왕복표라 합계를 두 줄에 반씩 나눴습니다 — 확인해 주세요');
    }
    if (!ride) notes.push('교통수단을 읽지 못해 "기타(택시등)"로 두었습니다 — 확인해 주세요');
    if (ride === 'plane') {
      // 신규 마일리지(2026-10-04 사용자 지정): 문서에 적혀 있으면 그 값이고, 없으면 항공 마일리지 표(air-mileage.yaml)에서 편마다 찾아
      // 더한다 — 좌석 등급이 프레스티지·비즈니스면 그 적립률이다. 표에 없는 항공사·구간이 하나라도 있으면 채우지 않는다.
      let mileage = num(r.mileage);
      if (mileage == null) {
        const first = isFirstSeat(r.seatClass);
        const found = rows.map((x) => milesOf({ airline: r.airline, dep: x.values.tr_dep, arr: x.values.tr_arr, first }));
        if (found.every(Boolean)) {
          mileage = found.reduce((sum, m) => sum + m.miles, 0);
          notes.push(`신규 마일리지는 항공 마일리지 표에서 찾았습니다 — ${found.map(describeMiles).join(' · ')}`);
        }
      }
      air = { airline: text(r.airline), mileage };
    }
  }

  if (section === 'other') {
    rows.push({
      values: { other_total: money(total), other_currency: currency, other_comment: [text(r.vendor), r.payDate || ''].filter(Boolean).join(' ') },
      required: { other_total: '금액' }, cocard: false,
    });
  }

  if (text(r.extra)) notes.push(`추가 정보 — ${text(r.extra)}`);
  return { section, rows, air, notes };
}

/**
 * 숙박 줄의 출장지(국가) 선택지 가운데 이 출장지에 맞는 것. 선택지 글은 "미국" 또는 "미국-뉴욕" 꼴이다.
 * 출장지에 적힌 **낱말이 선택지의 나라·도시 이름과 똑같을 때만** 고른다("타이베이"가 "타이"에 걸리지 않게) —
 * 여럿이면 맞은 이름이 많은 쪽(나라와 도시가 다 맞은 것)이다. 국내 출장지(고양·부산 …)는 맞는 것이 없어 null 이다.
 * @param {{value: string, text: string}[]} options
 */
export function nationOf(options, location) {
  const words = new Set(text(location).split(/[\s,·()/-]+/).filter(Boolean));
  let best = null;
  for (const o of options || []) {
    const parts = String(o.text || '').split('-').map((s) => s.trim()).filter(Boolean);
    const hit = parts.filter((p) => words.has(p)).length;
    if (hit && (!best || hit > best.hit)) best = { value: o.value, text: String(o.text).trim(), hit };
  }
  return best && { value: best.value, text: best.text };
}

/** 화면 머리의 출장 정보 — Claude 에게 읽을 문서의 맥락으로 준다(src/llm.js 의 receiptInput). */
export function tripOfPage(doc) {
  const cell = (label) => {
    for (const th of doc.querySelectorAll('#tripInfoTbl th')) {
      if (th.textContent.trim() === label) return (th.nextElementSibling?.textContent || '').trim();
    }
    return '';
  };
  const days = cell('출장기간').match(/\d{4}-\d{2}-\d{2}/g) || [];
  const pic = doc.querySelector('#drPIC');
  return { trip: { from: days[0] || '', to: days[1] || days[0] || '', location: cell('출장지') }, me: (pic?.selectedOptions?.[0]?.textContent || '').trim() };
}

/* ------------------------------------------------------------ 화면 */

const STYLE = `
#${ROOT_ID} { position: fixed; right: 16px; bottom: 16px; z-index: 9998; width: 380px; max-width: calc(100vw - 32px); max-height: 60vh;
  display: flex; flex-direction: column; background: #fff; border: 1px solid #1c5fae; border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .18); font-size: 12px; line-height: 1.5; color: #222; text-align: left; }
#${ROOT_ID}[hidden] { display: none; }
#${ROOT_ID} .krsw-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #1c5fae; color: #fff; border-radius: 7px 7px 0 0; }
#${ROOT_ID} .krsw-head span { flex: 1; font-size: 11px; opacity: .8; }
#${ROOT_ID} .krsw-close { border: 0; background: none; color: #fff; font-size: 16px; line-height: 1; cursor: pointer; padding: 0 2px; }
#${ROOT_ID} .krsw-list { list-style: none; margin: 0; padding: 6px 10px; overflow-y: auto; }
#${ROOT_ID} .krsw-item { padding: 6px 0; border-bottom: 1px solid #e6ebf2; }
#${ROOT_ID} .krsw-item:last-child { border-bottom: 0; }
#${ROOT_ID} .krsw-item b { display: block; word-break: break-all; }
#${ROOT_ID} .krsw-msg { display: block; color: #1c5fae; }
#${ROOT_ID} .krsw-item[data-state="ok"] .krsw-msg { color: #1a7f37; }
#${ROOT_ID} .krsw-item[data-state="warn"] .krsw-msg { color: #9a6700; }
#${ROOT_ID} .krsw-item[data-state="error"] .krsw-msg { color: #cf222e; }
#${ROOT_ID} .krsw-notes { margin: 2px 0 0; padding-left: 16px; color: #555; }
#${ROOT_ID} .krsw-foot { margin: 0; padding: 6px 10px 8px; border-top: 1px solid #e6ebf2; color: #555; }
.krsw-tools { display: inline-flex; align-items: center; gap: 6px; }
.krsw-tip { margin: -6px 0 8px; font-size: 12px; color: #5a6b85; }
.${FILLED} { background-color: #fff8d6 !important; }
input[type="checkbox"].${FILLED}, input[type="file"].${FILLED} { outline: 2px solid #f0c000; outline-offset: 1px; }
.${MISSING} { background-color: #fff0f0 !important; outline: 2px solid #d33; outline-offset: -1px; }
form.${DRAGGING} table.list { outline: 2px dashed #9db8dc; outline-offset: 3px; }
form.${DRAGGING} table.list.${OVER} { outline: 2px solid #1c5fae; background: #f3f8ff; }
`;

const GONE = '확장이 다시 올려져 이 화면과 끊겼습니다 — 적어 둔 값을 저장한 뒤 화면을 새로고침해 주세요';

/** 배경(서비스 워커)에게 증빙 한 장을 읽어 달라고 한다. 네이티브 다리(로컬 CLI)와 API 키는 콘텐츠 스크립트에서 못 쓴다. */
async function defaultRead(file, ctx) {
  const r = await chrome.runtime.sendMessage({ type: 'receiptRead', file, ctx });
  return r || { ok: false, error: '확장의 응답이 없습니다' };
}

/** 이 스크립트가 아직 확장과 이어져 있는가(src/home.js 의 defaultAlive 와 같다). */
const defaultAlive = () => typeof chrome === 'undefined' || !!chrome.runtime?.id;

/** 숙박 줄의 첨부 칸에 파일을 붙인다 — 사용자가 고른 것과 같이 폼과 함께 올라간다. */
function defaultAttach(input, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
}

function readDataUrl(doc, file) {
  return new Promise((resolve, reject) => {
    const fr = new doc.defaultView.FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('파일을 읽지 못했습니다'));
    fr.readAsDataURL(file);
  });
}

/**
 * 사후정산 입력 화면에 "증빙으로 입력"을 붙인다. 화면이 그 모양이 아니면(폼·표가 없으면) 아무것도 하지 않는다.
 *
 * @param {Document} doc
 * @param {{read?: Function, attach?: Function, alive?: Function}} [deps] 테스트가 갈아 끼운다
 *   read(file{name,type,dataUrl}, ctx{trip,me}) → {ok, record, error}
 * @returns {{handleFiles: (files: File[], hint?: object) => Promise<void>, box: HTMLElement}|null}
 */
export function startAfterPage(doc, deps = {}) {
  const { read = defaultRead, attach = defaultAttach, alive = defaultAlive } = deps;
  const form = doc.querySelector('form#frm');
  const bodies = Object.fromEntries(Object.entries(SECTIONS).map(([key, sec]) => [key, doc.getElementById(sec.body)]));
  if (!form || !bodies.lodge || !bodies.tr || doc.getElementById(ROOT_ID)) return null;

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  (doc.head || doc.documentElement).append(style);

  const Event = doc.defaultView.Event;
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const field = (tr, name) => tr.querySelector(`[name="${name}"]`);
  /** 채운 칸의 표시. 값이 바뀌었다고 알린(fire) 뒤에 부른다 — 알리면 아래 onEdit 이 표시를 지운다. */
  const mark = (el, weak = false) => {
    el.classList.remove(MISSING);
    el.classList.add(FILLED);
    if (weak) el.dataset.krsw = 'weak';
    else delete el.dataset.krsw;
  };
  // 사람이 고친 칸은 더는 "확장이 채운 칸"이 아니다.
  const onEdit = (e) => {
    const el = e.target;
    if (!el?.classList) return;
    el.classList.remove(FILLED, MISSING);
    if (el.dataset) delete el.dataset.krsw;
  };
  doc.addEventListener('input', onEdit, true);
  doc.addEventListener('change', onEdit, true);

  /* ---- 상태 상자 */
  const box = doc.createElement('div');
  box.id = ROOT_ID;
  box.hidden = true;
  box.innerHTML = '<div class="krsw-head"><strong>증빙으로 입력</strong><span>KRS WORKSPACE</span>'
    + '<button type="button" class="krsw-close" aria-label="닫기" title="닫기">×</button></div>'
    + '<ul class="krsw-list"></ul>'
    + '<p class="krsw-foot">채운 칸(노란색)을 확인한 뒤 저장을 눌러 주세요 — 확장은 저장을 누르지 않습니다. '
    + '읽은 값만 넣습니다(증빙 파일은 첨부 칸이 보이는 숙박 줄에만 붙습니다).</p>';
  doc.body.append(box);
  const list = box.querySelector('.krsw-list');
  box.querySelector('.krsw-close').addEventListener('click', () => { box.hidden = true; });

  /** 파일 하나의 줄. 돌려주는 함수로 상태(busy·ok·warn·error)와 글을 바꾼다. */
  function addLine(name) {
    const li = doc.createElement('li');
    li.className = 'krsw-item';
    const head = doc.createElement('b');
    head.textContent = name;
    const msg = doc.createElement('span');
    msg.className = 'krsw-msg';
    const more = doc.createElement('ul');
    more.className = 'krsw-notes';
    li.append(head, msg, more);
    list.append(li);
    while (list.children.length > MAX_LINES) list.firstElementChild.remove();
    box.hidden = false;
    return (state, message, notes = []) => {
      li.dataset.state = state;
      msg.textContent = message;
      more.replaceChildren(...notes.map((n) => {
        const x = doc.createElement('li');
        x.textContent = n;
        return x;
      }));
      li.scrollIntoView?.({ block: 'nearest' });
    };
  }

  /* ---- 줄 찾기·만들기 */
  const texts = (tr) => [...tr.querySelectorAll('input[type="text"], input[type="date"], textarea')];
  /** 지움 표시가 안 된, 화면에 보이는 줄인가(사이트의 delRow 는 저장된 줄을 숨기고 _del = 1 로 둔다). */
  const live = (tr) => tr.style.display !== 'none' && tr.querySelector('input[name$="_del"]')?.value !== '1';
  /** 아무 글도 적지 않은 새 줄인가. */
  const empty = (tr) => !texts(tr).some((el) => el.value.trim()) && !tr.querySelector('input[name$="_seq"]')?.value;
  /** 다시 써도 되는 빈 줄인가 — 첨부를 골라 둔 줄은 사람이 쓰려던 줄이라 건드리지 않는다. */
  const blank = (tr) => empty(tr) && ![...tr.querySelectorAll('input[type="file"]')].some((el) => el.files?.length);

  /** 같은 것을 적은 줄이 이미 있는가 — 숙박은 같은 업체, 교통은 같은 날·수단·구간. */
  function sameRow(section, row) {
    const rows = [...bodies[section].children].filter(live);
    // 업체명 칸에는 산 곳(아고다 …)이 들어가므로 묵은 곳으로 견준다 — 이 화면에서 채운 줄은 표시(krswStay)로, 저장돼 있던 줄은
    // 업체명(직접 결제)이나 비고의 첫머리(대행사에서 산 것)로.
    const stays = (tr) => [tr.dataset.krswStay, vendorKey(field(tr, 'lodge_company')?.value), vendorKey((field(tr, 'lodge_comment')?.value || '').split(' · ')[0])];
    if (section === 'lodge') return (row.key && rows.find((tr) => stays(tr).includes(row.key))) || null;
    if (section === 'tr' && row.values.tr_date) {
      return rows.find((tr) => ['tr_date', 'tr_transport', 'tr_dep', 'tr_arr'].every((n) => (field(tr, n)?.value || '').trim() === row.values[n])) || null;
    }
    return null;
  }

  /** 화면의 "+ ADD입력"을 대신 누른다. 새 줄이 생기지 않았으면 null. */
  function addRow(section) {
    const body = bodies[section];
    const before = body.lastElementChild;
    form.querySelector(`button[onclick*="${SECTIONS[section].add}"]`)?.click();
    const tr = body.lastElementChild;
    return tr && tr !== before ? tr : null;
  }

  /* ---- 칸 채우기 */
  /** merge 면 비어 있는 칸만 채운다(있던 줄에 얹는 것). 예약 확인서가 채운 칸(weak)은 결제 영수증(strong)이 바꾼다. */
  function fillRow(tr, row, merge, notes) {
    for (const [name, value] of Object.entries(row.values)) {
      const el = field(tr, name);
      if (!el || value === '') continue;
      if (el.tagName === 'SELECT') {
        if (merge || el.value === value) continue;
        if (![...el.options].some((o) => o.value === value)) { notes.push(`"${value}"은(는) 화면의 선택지에 없어 고르지 못했습니다`); continue; }
        el.value = value;
        fire(el, 'change');
        mark(el);
      } else if (!el.value.trim() || (row.strong && el.dataset.krsw === 'weak')) {
        el.value = value;
        mark(el, row.weak?.includes(name));
      }
    }
    // 법인카드: 문서에 법인카드라고 적혀 있을 때만 켠다(끄지는 않는다). 체크박스 옆의 숨은 칸이 폼으로 가는 값이다.
    const cb = tr.querySelector('input[type="checkbox"]');
    if (row.cocard && cb && !cb.checked) {
      cb.click();
      const hidden = tr.querySelector('input[type="hidden"][name$="_cocard"]');
      if (hidden) hidden.value = '1';
      mark(cb);
    }
  }

  /** 새 숙박 줄의 출장지(국가)를 화면 머리의 출장지에 맞춰 고른다. 바꾸면 화면이 숙박비 상한을 다시 조회한다. */
  function pickNation(tr, row, notes) {
    const sel = field(tr, 'lodge_nation');
    if (!sel) return;
    const hit = nationOf([...sel.options].map((o) => ({ value: o.value, text: o.textContent })), tripOfPage(doc).trip.location);
    if (hit && hit.value !== sel.value) {
      sel.value = hit.value;
      fire(sel, 'change');
      mark(sel);
      notes.push(`출장지를 "${hit.text}"(으)로 골랐습니다 — 확인해 주세요`);
    } else if (!hit && sel.value === DOMESTIC.nation && row.foreign) {
      notes.push('외화 문서입니다 — 숙박 줄의 출장지(국가)를 확인해 주세요');
    }
  }

  /** 화면에 그려지는 칸인가 — 자기나 조상이 display: none 이면 아니다. */
  const shown = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (doc.defaultView.getComputedStyle(n).display === 'none') return false;
    }
    return true;
  };

  /**
   * 숙박 줄의 첨부 칸에 읽은 파일을 붙인다. 이미 붙어 있으면 둔다 — 예약 확인서를 붙여 둔 자리는 결제 영수증이 바꾼다.
   * **첨부 칸이 보일 때만** 붙인다. 2026-10-03 화면은 그 칸(.lodge-file)을 CSS 로 숨겨 두었다 — 숨은 칸에 붙이면 사람이 보지도
   * 떼지도 못하는 파일이 저장 때 같이 올라간다.
   */
  function attachTo(tr, row, file, hint, notes) {
    const input = tr.querySelector('input[type="file"]');
    if (!input || hint.attached || !shown(input)) return;
    if (field(tr, 'lodge_oldfile')?.value) { notes.push('이미 올린 첨부가 있어 파일은 붙이지 않았습니다'); return; }
    if (input.files?.length && !(row.strong && input.dataset.krsw === 'weak')) return;
    try {
      attach(input, file);
      mark(input, row.weak?.length > 0);
      notes.push('숙박 줄의 첨부 칸에 파일을 붙였습니다');
    } catch {
      notes.push('첨부 칸에 파일을 붙이지 못했습니다 — 첨부 칸에서 직접 골라 주세요');
    }
  }

  /** 항공권을 읽었으면 항공 마일리지 칸을 켠다 — 항공권 출장 = 예(업무 마일리지 발생은 화면 기본값이 예다), 항공사, 신규 마일리지. */
  function setAir(air, notes) {
    const abroad = doc.getElementById('air_abroad');
    if (!abroad) return;
    if (abroad.value !== 'Y') {
      abroad.value = 'Y';
      fire(abroad, 'change');
      mark(abroad);
      notes.push('항공권 출장을 "예"로 바꿨습니다 — 항공 마일리지 칸을 확인해 주세요');
    }
    const airline = form.querySelector('[name="air_bizairline"]');
    if (airline && !airline.value.trim() && air.airline) {
      airline.value = air.airline;
      mark(airline);
    }
    const mile = form.querySelector('[name="air_mileage"]');
    if (!mile) return;
    if (air.mileage == null) {
      if (!mile.value.trim()) notes.push('항공권에 적립 마일리지가 적혀 있지 않고 항공 마일리지 표에도 없습니다 — 신규 마일리지를 적어 주세요');
    } else if (!mile.value.trim()) {
      mile.value = String(air.mileage);
      fire(mile, 'input');   // 화면이 공제 금액을 다시 셈한다(calcAirMiles)
      mark(mile);
    } else if (mile.value.trim() !== String(air.mileage)) {
      notes.push(`신규 마일리지 칸에 이미 값이 있어 그대로 두었습니다(이 표: ${air.mileage}마일)`);
    }
  }

  /**
   * 정한 줄들을 화면에 넣는다. 줄은 차례로 — 놓은 그 줄(비어 있을 때) → 같은 것을 적은 줄(빈 칸만) → 비어 있는 새 줄 → "+ ADD입력".
   * @returns {{missing: string[], notes: string[], merged: boolean}}
   */
  function place(plan, file, hint) {
    const sec = SECTIONS[plan.section];
    const body = bodies[plan.section];
    if (!body) throw new Error(`화면에 ${sec.title} 표가 없습니다`);
    const notes = [...plan.notes];
    const missing = new Set();
    // 놓은 줄은 비어 있을 때만 그 줄을 쓴다(다 적힌 줄 위에 놓은 것은 표에 놓은 것이다). 첨부 칸에서 직접 고른 줄은 그 줄이다.
    let target = hint.row && body.contains(hint.row) && live(hint.row) && (hint.attached || empty(hint.row)) ? hint.row : null;
    let merged = false;
    let last = null;
    for (const row of plan.rows) {
      let tr = target;
      let merge = !!tr && !empty(tr);
      target = null;
      if (!tr) {
        tr = sameRow(plan.section, row);
        merge = !!tr;
        if (tr) {
          notes.push(plan.section === 'lodge'
            ? '같은 업체의 줄이 있어 그 줄의 빈 칸을 채웠습니다 — 다른 숙박이면 "+ ADD입력"으로 줄을 만든 뒤 그 줄에 놓아 주세요'
            : '같은 날·같은 구간의 줄이 이미 있어 빈 칸만 채웠습니다');
        }
      }
      if (!tr) tr = [...body.children].find((x) => live(x) && blank(x)) || addRow(plan.section);
      if (!tr) throw new Error(`${sec.title}에 줄을 추가하지 못했습니다 — 화면의 "+ ADD입력"을 누른 뒤 그 줄에 놓아 주세요`);
      fillRow(tr, row, merge, notes);
      if (plan.section === 'lodge') {
        if (row.key) tr.dataset.krswStay = row.key;
        if (!merge) pickNation(tr, row, notes);
        attachTo(tr, row, file, hint, notes);
      }
      for (const [name, label] of Object.entries(row.required)) {
        const el = field(tr, name);
        if (el && !el.value.trim()) { el.classList.add(MISSING); missing.add(label); }
      }
      merged ||= merge;
      last = tr;
    }
    if (plan.air) setAir(plan.air, notes);
    last?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    return { missing: [...missing], notes, merged };
  }

  /* ---- 파일 받기 */
  async function one(file, line, hint) {
    try {
      if (!acceptsFile(EVIDENCE_ACCEPT, file)) return line('error', '이미지나 PDF 가 아니라 읽지 않았습니다');
      if (file.size > FILE_LIMIT) return line('error', `너무 큽니다(${Math.round(file.size / 1048576)}MB) — 10MB 이하로 넣어 주세요`);
      if (!alive()) return line('error', GONE);
      line('busy', '읽는 중...');
      const r = await read({ name: file.name || 'receipt', type: file.type || '', dataUrl: await readDataUrl(doc, file) }, tripOfPage(doc));
      if (!r?.ok || !r.record) return line('error', r?.error || '증빙을 읽지 못했습니다');
      const plan = fillPlan(r.record, hint.section);
      const what = text(r.record.summary);
      if (!plan.section) return line('warn', `넣지 않았습니다${what ? ` — ${what}` : ''}`, plan.notes);
      const done = place(plan, file, hint);
      const title = SECTIONS[plan.section].title;
      const where = done.merged ? `${title}의 있던 줄에 채웠습니다` : plan.rows.length > 1 ? `${title}에 ${plan.rows.length}줄을 넣었습니다` : `${title}에 넣었습니다`;
      const notes = done.missing.length ? [`못 읽은 칸(붉게 표시): ${done.missing.join('·')} — 직접 적어 주세요`, ...done.notes] : done.notes;
      return line(done.missing.length ? 'warn' : 'ok', `${where}${what ? ` — ${what}` : ''}`, notes);
    } catch (err) {
      return line('error', alive() ? err?.message || String(err) : GONE);
    }
  }

  // 한 장씩 차례로 읽는다 — 줄을 더하는 차례가 섞이지 않게, 그리고 같은 업체의 영수증·예약서가 한 줄로 모이게.
  let chain = Promise.resolve();
  /**
   * @param {Iterable<File>} fileList
   * @param {{section?: string, row?: Element|null, attached?: boolean}} [hint] 놓은 표·줄. attached 는 그 줄의 첨부 칸에서 직접 고른 파일이다
   */
  function handleFiles(fileList, hint = {}) {
    for (const file of [...(fileList || [])]) {
      const line = addLine(file.name || '붙여 넣은 그림');
      line('busy', '기다리는 중...');
      chain = chain.then(() => one(file, line, hint));
    }
    return chain;
  }

  /* ---- 놓을 자리: 표와 그 머리 줄(제목 + 버튼) */
  const areas = Object.fromEntries(Object.entries(bodies).filter(([, body]) => body).map(([key, body]) => {
    const table = body.closest('table');
    return [key, { table, head: table?.previousElementSibling || null }];
  }));
  const sectionAt = (el) => Object.keys(areas).find((key) => areas[key].table?.contains(el) || areas[key].head?.contains(el)) || '';
  const hintAt = (el) => ({ section: el ? sectionAt(el) : '', row: el?.closest?.('tbody tr') || null });

  // "+ ADD입력" 옆에 파일을 고르는 버튼을 둔다. 사이트 버튼은 그대로 두고 한 묶음으로 오른쪽에 세운다.
  for (const key of Object.keys(areas)) {
    const addBtn = form.querySelector(`button[onclick*="${SECTIONS[key].add}"]`);
    if (!addBtn) continue;
    const tools = doc.createElement('span');
    tools.className = 'krsw-tools';
    const pick = doc.createElement('button');
    pick.type = 'button';
    pick.className = `${addBtn.className} krsw-pick`;
    pick.textContent = '+ 증빙으로 입력';
    pick.title = '영수증·인보이스·항공권·기차표(이미지·PDF)를 고르면 읽어서 줄을 추가하고 칸을 채웁니다. 이 화면에 끌어다 놓거나 붙여 넣어도(Ctrl+V) 됩니다.';
    const input = doc.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = EVIDENCE_ACCEPT;
    input.hidden = true;
    pick.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const files = [...input.files];
      input.value = '';
      handleFiles(files, { section: key });
    });
    addBtn.before(tools);
    tools.append(pick, input, addBtn);
  }
  if (areas.lodge.table) {
    const tip = doc.createElement('p');
    tip.className = 'krsw-tip';
    tip.textContent = '증빙(영수증·인보이스·항공권·기차표의 이미지·PDF)을 이 화면에 끌어다 놓거나 붙여 넣으면(Ctrl+V) 읽어서 줄을 추가하고 칸을 채웁니다 · KRS WORKSPACE';
    areas.lodge.table.before(tip);
  }

  // 끌어다 놓기. 파일을 끄는 동안 놓을 표를 보여 준다 — dragover 는 끄는 내내 오므로, 끊기면(밖으로 나갔거나 놓았으면) 표시를 걷는다.
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  let dragTimer = null;
  const endDrag = () => {
    form.classList.remove(DRAGGING);
    for (const { table } of Object.values(areas)) table?.classList.remove(OVER);
  };
  doc.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    form.classList.add(DRAGGING);
    const at = sectionAt(e.target);
    for (const [key, { table }] of Object.entries(areas)) table?.classList.toggle(OVER, key === at);
    clearTimeout(dragTimer);
    dragTimer = setTimeout(endDrag, 250);
  });
  // 화면 어디에 놓아도 받는다 — 받지 않으면 브라우저가 그 파일을 열어 적어 둔 폼이 날아간다.
  doc.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    clearTimeout(dragTimer);
    endDrag();
    handleFiles(e.dataTransfer.files, hintAt(e.target));
  });
  // 붙여넣기. 글을 붙여 넣는 것은 건드리지 않는다 — 클립보드에 파일(캡처한 그림 포함)이 있을 때만 받는다.
  doc.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    handleFiles(files, hintAt(doc.activeElement));
  });
  // 숙박 줄의 첨부 칸에서 직접 고른 파일도 읽어 그 줄을 채운다(파일은 사람이 이미 붙였다).
  doc.addEventListener('change', (e) => {
    const input = e.target;
    if (input?.type !== 'file' || input.name !== 'lodge_file' || !input.files?.length) return;
    handleFiles([input.files[0]], { section: 'lodge', row: input.closest('tr'), attached: true });
  });

  return { handleFiles, box };
}
