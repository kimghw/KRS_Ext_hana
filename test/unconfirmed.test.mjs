// 홈의 접수 미확인 공문 카드: 목록 읽기, 제목만 그리기, 누르면 그 문서 창, 내 예약 카드 위 자리, 설정 따르기.
// 가장 중요한 건 둘이다 — **확장이 문서를 대신 열지 않는 것**(요청은 목록 하나뿐)과,
// 못 읽은 것을 "공문이 없습니다"로 넘기지 않는 것.
//
// 목록 markup 은 2026-10-02 실제 화면을 본뜬 것이다. 실제 캡처에는 사내 공문 제목이 들어 있어 저장소에 두지 않는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  parseUnconfirmed, readUnconfirmed, viewUrl, findSpot, createUnconfirmedCard, startUnconfirmed,
  unconfirmedEnabled, ENABLE_KEY, ROOT_ID, REFRESH_GAP_MS, POPUP,
} from '../src/unconfirmed.js';
import { ROOT_ID as MINE_ROOT_ID } from '../src/home.js';
import { UNCFM_LIST_URL, RCV_VIEW_URL, RCV_OFFLINE_VIEW_URL } from '../src/config.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
globalThis.DOMParser = new JSDOM('').window.DOMParser;

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const NOW = new Date('2026-10-02T09:05:00').getTime();

/* ------------------------------------------------------------ 가짜 사이트 */

const DOCS = [
  { rId: 'AB4487E16DEE35CDFDA4BBADA2E4980A', sId: 'DF8ED5DCDEF8519219ED5370FFDD1C33', docNo: 'HER-125-2026', title: '경진대회(KR-R&amp;D Challenge) 개최 안내', date: '2026.10.02', sndNo: 'RST7800-170-2026', sender: 'R&amp;D Support Team' },
  { rId: 'DA23FECD48980363E8B4ACB120C65ECF', sId: 'E5275F93448ED1A8B05D8C2AEBFA7AED', docNo: 'HER-123-2026', title: '기술검토 회신 - &lt;Skid Unit&gt;', date: '2026.09.29', sndNo: 'HUT8100-2575-2026', sender: 'Hull Technology Team 2' },
  // 오프라인 문서는 둘째 인자(S_ID)가 비어 있다.
  { rId: '461893A7831FD9689077B653509179FB', sId: '', docNo: 'HER-101-2026', title: '우편으로 온 문서', date: '2026.09.20', sndNo: '', sender: 'Outside' },
];

const row = (d, i) => `<tr class="${i % 2 ? 'rgAltRow' : 'rgRow'}" id="RadGridDOC_ctl00__${i}">
  <td align="center" style="width:40px;"> ${i + 1} </td><td align="center" style="width:100px;">${d.docNo}</td><td>
  <a id="RadGridDOC_ctl00_ctl${String(4 + 2 * i).padStart(2, '0')}_hlViewSndDoc" href="javascript:ViewRcvDoc_Ex('${d.rId}', '${d.sId}');">${d.title}</a>
  </td><td align="center" style="width:60px;">${d.date}</td><td align="center">HONG Gildong</td><td align="center">${d.sndNo}</td><td>${d.sender}</td><td align="center">KANG Munjong</td><td>&nbsp;</td>
</tr>`;

const listHtml = (docs, declared = docs.length) => `<html><head><title>Unconfirmed receipt documents</title></head><body>
<form method="post" action="./Rcv_Not_Confirm_List.aspx" id="frmNET">
<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="${'v'.repeat(2000)}">
<div id="pnlFound"><table><tbody><tr><td class="listTitleNew">Unconfirmed receipt documents</td>
<td><span id="lblUserInfo"><b>HONG Gildong (<font color="magenta">HER</font>)</b></span></td>
<td><span id="lblResult"><font color="red"><b>${declared}</b></font> results</span></td></tr></tbody></table>
<div id="RadGridDOC" class="RadGrid RadGrid_Office2007"><table class="rgMasterTable" id="RadGridDOC_ctl00">
<thead><tr><th class="rgHeader">No.</th><th class="rgHeader"><a onclick="return false;" href="javascript:__doPostBack('RadGridDOC$ctl00$ctl02$ctl01$ctl00','')">Doc No.</a></th>
<th class="rgHeader"><a href="javascript:__doPostBack('RadGridDOC$ctl00$ctl02$ctl01$ctl01','')">Title</a></th><th class="rgHeader">Rcv Date</th><th class="rgHeader">P.I.C</th>
<th class="rgHeader">Snd No.</th><th class="rgHeader">Sender</th><th class="rgHeader">Snd P.I.C</th><th class="rgHeader">Job Id.</th></tr></thead>
<tbody>${docs.map(row).join('')}</tbody></table></div></div>
</form></body></html>`;

// 미인증이면 목록 대신 이 한 줄이 200 으로 온다(같은 앱의 미회람 목록에서 2026-10-01 확인).
const SIGNED_OUT = '<script language=\'javascript\'>alert("올바른 로그인 정보가 없습니다.\\r\\n\\r\\n다시 로그인하여 주시기 바랍니다!");history.back();</script>';

/** 목록만 내주는 가짜 사이트. 무엇을 불렀는지 남긴다 — 문서 주소를 부르면 안 된다. */
function fakeSite(docs = DOCS, { html = null, fail = null } = {}) {
  const site = {
    docs: [...docs],
    calls: [],
    html, fail,
    fetchPage: async (url, init) => {
      site.calls.push({ url, init });
      if (site.fail) throw site.fail;
      return { html: site.html ?? listHtml(site.docs), finalUrl: url };
    },
  };
  return site;
}

/** chrome.storage.local 흉내. 바꾼 것은 onChanged 로 알린다 — 진짜처럼. */
function fakeStorage(init = {}) {
  const data = structuredClone(init);
  const listeners = [];
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
      for (const fn of [...listeners]) fn(changes, 'local');
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

// 2026-09-17 캡처의 홈 뼈대: 본문 첫 카드가 Popup Notice(#divPopupInfo)다.
const HOME = '<html><body><div class="page-content container">'
  + '<div class="row pt-3 mt-1" id="divPopupInfo"><div class="col-12">Popup Notice</div></div>'
  + '<div class="row" id="divkrinfo"></div></div></body></html>';
const HOME_WITH_MINE = HOME.replace('<div class="row pt-3 mt-1" id="divPopupInfo">',
  `<div class="row pt-3 mt-1 krs-mine" id="${MINE_ROOT_ID}"></div><div class="row pt-3 mt-1" id="divPopupInfo">`);

const homeDoc = (html = HOME) =>
  new JSDOM(html, { url: 'https://eclass.krs.co.kr/eClassVer4/Home/Index' }).window.document;

/** 카드를 붙이고 첫 읽기를 기다린다. 바깥 것은 전부 가짜다. */
async function mount({ site = fakeSite(), doc = homeDoc(), clock = { now: NOW }, visible = () => true } = {}) {
  const opened = [];
  const card = createUnconfirmedCard(doc, {
    fetchPage: site.fetchPage, now: () => clock.now, visible, openDoc: (url) => { opened.push(url); },
  });
  await card?.ready;
  const root = doc.getElementById(ROOT_ID);
  const text = (role) => (root?.querySelector(`[data-role="${role}"]`)?.textContent || '').trim();
  return {
    card, doc, root, site, opened, clock, text,
    items: () => [...(root?.querySelectorAll('a.krs-uncfm-item') || [])],
    click: (el, init = {}) => el.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, ...init })),
  };
}

/* ------------------------------------------------------------ 읽기 */

console.log('목록 읽기');
{
  const p = parseUnconfirmed(listHtml(DOCS));
  t('목록 화면을 알아본다', () => assert.equal(p.recognized, true));
  t('사이트가 센 건수', () => assert.equal(p.declared, 3));
  t('건마다 ID·제목·문서 번호·접수일·보낸 곳', () => {
    assert.equal(p.docs.length, 3);
    assert.deepEqual(p.docs[0], {
      rId: DOCS[0].rId, sId: DOCS[0].sId, title: '경진대회(KR-R&D Challenge) 개최 안내',
      docNo: 'HER-125-2026', rcvDate: '2026.10.02', sender: 'R&D Support Team',
    });
  });
  t('머리 줄의 정렬 링크는 문서가 아니다', () => assert.ok(p.docs.every((d) => d.rId.length === 32)));
  t('오프라인 문서는 S_ID 가 비어 있다', () => assert.equal(p.docs[2].sId, ''));
  t('같은 문서가 두 번 나와도 한 번만', () =>
    assert.equal(parseUnconfirmed(listHtml([DOCS[0], DOCS[0]])).docs.length, 1));
  t('한 건도 없는 목록도 목록이다', () => {
    const e = parseUnconfirmed(listHtml([]));
    assert.deepEqual([e.recognized, e.declared, e.docs.length], [true, 0, 0]);
  });
  t('로그인 안내는 목록이 아니다', () => assert.equal(parseUnconfirmed(SIGNED_OUT).recognized, false));
}

console.log('문서 주소');
t('사이트의 ViewRcvDoc_Ex 가 여는 주소 그대로', () =>
  assert.equal(viewUrl(DOCS[0]), `https://eclass.krs.co.kr/DOCCruiser/Popup/RfReceivePrefer_View.aspx?R_ID=${DOCS[0].rId}`));
t('오프라인 문서는 오프라인 보기 화면', () =>
  assert.equal(viewUrl(DOCS[2]), `https://eclass.krs.co.kr/DOCCruiser/Popup/RfReceivePreferOffLine_View.aspx?R_ID=${DOCS[2].rId}`));
t('주소는 사이트의 것 그대로', () => {
  assert.equal(UNCFM_LIST_URL, 'https://eclass.krs.co.kr/intra/intranet/VSDotNet/DORSY/Rcv/Rcv_Not_Confirm_List.aspx');
  assert.equal(RCV_VIEW_URL, 'https://eclass.krs.co.kr/DOCCruiser/Popup/RfReceivePrefer_View.aspx');
  assert.equal(RCV_OFFLINE_VIEW_URL, 'https://eclass.krs.co.kr/DOCCruiser/Popup/RfReceivePreferOffLine_View.aspx');
  assert.deepEqual(POPUP, { width: 860, height: 800 });
});

console.log('목록이 아닌 것이 오면');
await ta('로그인이 풀렸으면 그렇게 말한다', async () =>
  assert.rejects(readUnconfirmed(fakeSite([], { html: SIGNED_OUT }).fetchPage), /로그인이 필요합니다/));
await ta('모르는 화면이면 알아보지 못했다고 한다', async () =>
  assert.rejects(readUnconfirmed(fakeSite([], { html: '<html><body><h2>Runtime Error</h2></body></html>' }).fetchPage), /알아보지 못했습니다/));

/* ------------------------------------------------------------ 자리 */

console.log('자리 찾기');
t('내 예약 카드가 있으면 그 바로 위', () => {
  const s = findSpot(homeDoc(HOME_WITH_MINE));
  assert.deepEqual([s.mode, s.el.id], ['before', MINE_ROOT_ID]);
});
t('내 예약 카드가 아직 없으면 그 카드가 붙을 자리(Popup Notice 앞)', () => {
  const s = findSpot(homeDoc());
  assert.deepEqual([s.mode, s.el.id], ['before', 'divPopupInfo']);
});
t('알아보는 자리가 없으면 null', () =>
  assert.equal(findSpot(homeDoc('<html><body><div>다른 화면</div></body></html>')), null));
await ta('내 예약 카드 위에 붙는다', async () => {
  const m = await mount({ doc: homeDoc(HOME_WITH_MINE) });
  assert.equal(m.root.nextElementSibling.id, MINE_ROOT_ID);
});
await ta('내 예약 카드가 나중에 Popup Notice 앞에 끼어들어도 이 카드가 위다', async () => {
  const m = await mount();
  const mine = m.doc.createElement('div');
  mine.id = MINE_ROOT_ID;
  const notice = m.doc.getElementById('divPopupInfo');
  notice.parentElement.insertBefore(mine, notice);
  assert.equal(m.root.nextElementSibling.id, MINE_ROOT_ID);
});
await ta('알아보는 자리가 없으면 붙이지도 읽지도 않는다', async () => {
  const site = fakeSite();
  const m = await mount({ site, doc: homeDoc('<html><body><div>다른 화면</div></body></html>') });
  assert.equal(m.card, null);
  assert.equal(site.calls.length, 0);
});

/* ------------------------------------------------------------ 카드 */

console.log('제목만 보여준다');
await ta('건마다 한 줄, 보이는 글은 제목뿐', async () => {
  const m = await mount();
  assert.deepEqual(m.items().map((a) => a.textContent),
    ['경진대회(KR-R&D Challenge) 개최 안내', '기술검토 회신 - <Skid Unit>', '우편으로 온 문서']);
  assert.equal(m.text('count'), '3');
  assert.equal(m.text('warn'), '');
  assert.equal(m.text('note'), '09:05 읽음');
});
await ta('제목은 글자로만 넣는다(markup 으로 풀리지 않는다)', async () => {
  const m = await mount();
  assert.equal(m.items()[1].children.length, 0);
});
await ta('문서 번호·접수일·보낸 곳은 툴팁에', async () => {
  const m = await mount();
  assert.equal(m.items()[0].title, 'HER-125-2026 · 2026.10.02 · R&D Support Team');
});
await ta('요청은 목록 하나뿐 — 문서 주소는 부르지 않는다', async () => {
  const m = await mount();
  assert.deepEqual(m.site.calls.map((c) => c.url), [UNCFM_LIST_URL]);
  assert.equal(m.site.calls[0].init.cache, 'no-store');
});
await ta('한 건도 없으면 칩이 0 이라고만 한다 — "없습니다" 같은 말은 적지 않는다', async () => {
  const m = await mount({ site: fakeSite([]) });
  assert.equal(m.text('count'), '0');
  assert.equal(m.root.querySelector('[data-role="count"]').classList.contains('on'), false);
  assert.doesNotMatch(m.root.querySelector('.krs-uncfm-head').textContent, /없습니다/);
  assert.equal(m.text('note'), '09:05 읽음');
  assert.equal(m.root.querySelector('.krs-uncfm-body').textContent.trim(), '', '본문에 글이 남으면 한 줄로 접히지 않는다');
});
await ta('건수가 있으면 칩이 도드라진다', async () => {
  const m = await mount();
  assert.equal(m.root.querySelector('[data-role="count"]').classList.contains('on'), true);
});
await ta('버튼은 글자가 아니라 아이콘이고, 무엇인지는 툴팁·aria-label 이 말한다', async () => {
  const m = await mount();
  for (const b of m.root.querySelectorAll('button')) {
    assert.ok(b.querySelector('svg'), '아이콘이 없다');
    assert.equal(b.textContent.trim(), '');
    assert.ok(b.getAttribute('aria-label'), 'aria-label 이 없다');
  }
});
await ta('사이트가 센 건수와 다르면 놓친 것이 있다고 말한다', async () => {
  const m = await mount({ site: fakeSite(DOCS, { html: listHtml(DOCS, 5) }) });
  assert.match(m.text('warn'), /5건이라는데 3건만/);
});

console.log('처음에는 한 줄, 펼치면 목록');
{
  const toggle = (m) => m.root.querySelector('button[data-act="toggle"]');
  const list = (m) => m.root.querySelector('[data-role="list"]');
  await ta('처음에는 접혀 있다 — 건수는 머리 줄에, 목록은 감춰 둔다', async () => {
    const m = await mount();
    assert.equal(list(m).hidden, true);
    assert.equal(m.text('count'), '3');
    assert.equal(toggle(m).hidden, false);
    assert.equal(toggle(m).title, '펼치기');
    assert.equal(toggle(m).getAttribute('aria-expanded'), 'false');
  });
  await ta('펼치기를 누르면 목록이 보이고 버튼은 접기가 된다', async () => {
    const m = await mount();
    m.click(toggle(m));
    assert.equal(list(m).hidden, false);
    assert.equal(toggle(m).title, '접기');
    assert.equal(toggle(m).getAttribute('aria-expanded'), 'true');
    assert.equal(m.site.calls.length, 1, '펼친다고 다시 받지는 않는다');
  });
  await ta('접기를 누르면 다시 한 줄', async () => {
    const m = await mount();
    m.click(toggle(m));
    m.click(toggle(m));
    assert.equal(list(m).hidden, true);
    assert.equal(toggle(m).title, '펼치기');
  });
  await ta('펼친 채로 다시 받아도 펼친 채다', async () => {
    const m = await mount();
    m.click(toggle(m));
    m.site.docs.shift();
    m.click(m.root.querySelector('[data-act="refresh"]'));
    await tick();
    assert.equal(list(m).hidden, false);
    assert.equal(m.items().length, 2);
  });
  await ta('머리 줄을 눌러도 펼치고 접는다', async () => {
    const m = await mount();
    m.click(m.root.querySelector('.krs-uncfm-title'));
    assert.equal(list(m).hidden, false);
    m.click(m.root.querySelector('[data-role="note"]'));
    assert.equal(list(m).hidden, true);
  });
  await ta('새로고침 버튼은 머리 줄 안에 있어도 펼치지 않는다', async () => {
    const m = await mount();
    m.click(m.root.querySelector('[data-act="refresh"]'));
    await tick();
    assert.equal(list(m).hidden, true);
    assert.equal(m.site.calls.length, 2);
  });
  await ta('공문이 없으면 펼치기 버튼도 없고, 머리 줄을 눌러도 펼쳐지지 않는다', async () => {
    const m = await mount({ site: fakeSite([]) });
    assert.equal(toggle(m).hidden, true);
    m.click(m.root.querySelector('.krs-uncfm-title'));
    assert.equal(list(m).hidden, true);
  });
  await ta('접혀 있어도 못 읽었다는 경고는 목록 밖에 있어 보인다', async () => {
    const m = await mount({ site: fakeSite(DOCS, { fail: new Error('HTTP 500') }) });
    const warn = m.root.querySelector('[data-role="warn"]');
    assert.match(warn.textContent, /읽지 못했습니다/);
    assert.equal(warn.closest('[hidden]'), null);
    assert.equal(toggle(m).hidden, true, '읽은 것이 없으면 펼칠 것도 없다');
  });
}

console.log('누르면 그 공문');
await ta('제목을 누르면 그 문서 창을 연다', async () => {
  const m = await mount();
  m.click(m.items()[1]);
  assert.deepEqual(m.opened, [`${RCV_VIEW_URL}?R_ID=${DOCS[1].rId}`]);
  assert.equal(m.site.calls.length, 1, '누른다고 확장이 요청을 보내지는 않는다');
});
await ta('오프라인 문서는 오프라인 보기 창', async () => {
  const m = await mount();
  m.click(m.items()[2]);
  assert.deepEqual(m.opened, [`${RCV_OFFLINE_VIEW_URL}?R_ID=${DOCS[2].rId}`]);
});
await ta('링크 주소도 같은 문서라 Ctrl·가운데 클릭은 브라우저에 맡긴다', async () => {
  const m = await mount();
  assert.equal(m.items()[0].href, `${RCV_VIEW_URL}?R_ID=${DOCS[0].rId}`);
  assert.equal(m.items()[0].target, '_blank');
  m.click(m.items()[0], { ctrlKey: true });
  m.click(m.items()[0], { button: 1 });
  assert.equal(m.opened.length, 0);
});

console.log('못 읽으면 없다고 하지 않는다');
await ta('로그인이 풀렸으면 그 사실을 적고, 없다고 하지 않는다', async () => {
  const m = await mount({ site: fakeSite([], { html: SIGNED_OUT }) });
  assert.match(m.text('warn'), /읽지 못했습니다: 로그인이 필요합니다/);
  assert.equal(m.text('count'), '', '못 읽었는데 0 건이라고 하면 안 된다');
  assert.equal(m.items().length, 0);
});
await ta('요청이 실패하면 이유를 적는다', async () => {
  const m = await mount({ site: fakeSite(DOCS, { fail: new Error('HTTP 500') }) });
  assert.match(m.text('warn'), /읽지 못했습니다: HTTP 500/);
  assert.equal(m.text('count'), '', '못 읽었는데 0 건이라고 하면 안 된다');
});
await ta('다시 받다가 실패하면 먼저 읽은 목록은 남기고 그렇다고 말한다', async () => {
  const m = await mount();
  m.site.fail = new Error('응답이 20초 안에 오지 않았습니다.');
  m.click(m.root.querySelector('[data-act="refresh"]'));
  await tick();
  assert.equal(m.items().length, 3);
  assert.match(m.text('warn'), /응답이 20초.*먼저 읽어 둔 것/);
});

console.log('다시 받기');
await ta('새로고침 버튼은 목록을 다시 받아 바꿔 끼운다', async () => {
  const m = await mount();
  m.site.docs.shift();
  m.click(m.root.querySelector('[data-act="refresh"]'));
  await tick();
  assert.equal(m.site.calls.length, 2);
  assert.equal(m.items().length, 2);
  assert.equal(m.text('count'), '2');
});
await ta('문서 창에서 돌아오면(창에 초점) 다시 받는다 — 접수 확인한 건이 빠진다', async () => {
  const m = await mount();
  m.site.docs.shift();
  m.clock.now += REFRESH_GAP_MS;
  m.doc.defaultView.dispatchEvent(new m.doc.defaultView.Event('focus'));
  await tick();
  assert.equal(m.site.calls.length, 2);
  assert.equal(m.items().length, 2);
});
await ta('방금 받았으면 초점이 돌아와도 다시 받지 않는다', async () => {
  const m = await mount();
  m.clock.now += REFRESH_GAP_MS - 1;
  m.doc.defaultView.dispatchEvent(new m.doc.defaultView.Event('focus'));
  await tick();
  assert.equal(m.site.calls.length, 1);
});
await ta('안 보이는 탭은 받지 않고, 보이면 받는다', async () => {
  let shown = false;
  const m = await mount({ visible: () => shown });
  m.clock.now += REFRESH_GAP_MS;
  m.doc.dispatchEvent(new m.doc.defaultView.Event('visibilitychange'));
  await tick();
  assert.equal(m.site.calls.length, 1);
  shown = true;
  m.doc.dispatchEvent(new m.doc.defaultView.Event('visibilitychange'));
  await tick();
  assert.equal(m.site.calls.length, 2);
});

/* ------------------------------------------------------------ 설정 */

console.log('켜고 끄기 (패널의 체크박스)');
t('값이 없으면 켠 것, false 일 때만 끈 것', () => {
  assert.equal(unconfirmedEnabled(undefined), true);
  assert.equal(unconfirmedEnabled(true), true);
  assert.equal(unconfirmedEnabled(false), false);
});

async function start(init = {}, site = fakeSite()) {
  const storage = fakeStorage(init);
  const doc = homeDoc();
  const ctl = await startUnconfirmed(doc, {
    storage, onChanged: storage.onChanged, fetchPage: site.fetchPage, now: () => NOW, openDoc: () => {},
  });
  return { ctl, doc, storage, site, root: () => doc.getElementById(ROOT_ID) };
}

await ta('설정이 없으면 켠 것으로 보고 붙인다', async () => {
  const s = await start();
  assert.ok(s.root());
  assert.equal(s.site.calls.length, 1);
});
await ta('꺼져 있으면 붙이지도 읽지도 않는다', async () => {
  const s = await start({ [ENABLE_KEY]: false });
  assert.equal(s.root(), null);
  assert.equal(s.site.calls.length, 0);
});
await ta('끄면 열려 있는 홈에서 곧바로 사라지고, 그 뒤로는 초점이 돌아와도 읽지 않는다', async () => {
  const s = await start();
  await s.storage.set({ [ENABLE_KEY]: false });
  assert.equal(s.root(), null);
  assert.equal(s.ctl.card, null);
  s.doc.defaultView.dispatchEvent(new s.doc.defaultView.Event('focus'));
  await tick();
  assert.equal(s.site.calls.length, 1);
});
await ta('다시 켜면 새로고침 없이 붙는다', async () => {
  const s = await start({ [ENABLE_KEY]: false });
  await s.storage.set({ [ENABLE_KEY]: true });
  await tick();
  assert.ok(s.root());
  assert.equal(s.root().querySelectorAll('a.krs-uncfm-item').length, 3);
});
await ta('켜기를 거듭 받아도 카드는 하나', async () => {
  const s = await start();
  await s.storage.set({ [ENABLE_KEY]: true });
  await s.storage.set({ [ENABLE_KEY]: true });
  await tick();
  assert.equal(s.doc.querySelectorAll(`#${ROOT_ID}`).length, 1);
});
await ta('stop 하면 카드를 떼고 설정 변화도 더 듣지 않는다', async () => {
  const s = await start();
  s.ctl.stop();
  assert.equal(s.root(), null);
  assert.equal(s.storage.listenerCount(), 0);
  await s.storage.set({ [ENABLE_KEY]: true });
  assert.equal(s.root(), null);
});

/* ------------------------------------------------------------ 배선 */

console.log('확장 배선');
{
  const root = new URL('../', import.meta.url);
  const boot = fs.readFileSync(new URL('home.js', root), 'utf8');
  const panel = new JSDOM(fs.readFileSync(new URL('sidepanel.html', root), 'utf8')).window.document;
  t('홈의 시동 스크립트가 src/unconfirmed.js 를 불러 startUnconfirmed 를 부른다', () => {
    assert.match(boot, /getURL\('src\/unconfirmed\.js'\)/);
    assert.match(boot, /startUnconfirmed\(document\)/);
  });
  t('패널의 체크박스는 켜진 채로 들어 있다', () => {
    const box = panel.getElementById('homeUncfm');
    assert.ok(box, '체크박스가 없다');
    assert.equal(box.hasAttribute('checked'), true);
    assert.match(box.closest('details.diag')?.querySelector('summary')?.textContent || '', /설정 및 연결/);
  });
  t('설정 이름', () => assert.equal(ENABLE_KEY, 'homeUncfm'));
}

console.log(`\n통과 ${pass}건`);
