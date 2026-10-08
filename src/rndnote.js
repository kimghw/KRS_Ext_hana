// R&D 과제 정보를 원노트에 두고 다른 기기와 함께 쓰는 선택 기능(2026-10-08 사용자 지정) — 순수 로직과 원노트 페이지 접근.
// 화면(켜기·섹션 고르기·지금 맞추기)과 언제 맞출지는 rndpanel.js 가 한다.
//
// 확장이 Microsoft 에 직접 로그인하지 않는다 — 이 PC 에서 도는 KR_MS365_mcp 의 onenote 서버(http://localhost:5005/mcp,
// MCP Streamable HTTP)에 기댄다. 연결은 Teams 와 같은 손잡이(src/teams.js 의 connect)를 쓰고, 도구는 read_onenote(list_sections ·
// list_pages · get_content include_ids) · write_onenote(create_page · append · replace target) · sync_onenote_db 다.
// 다른 기기는 그 기기의 확장 + MCP 서버(각자 Microsoft 로그인)로 같은 노트북의 같은 섹션을 고르면 같은 페이지를 쓴다 —
// 노트북은 OneDrive 로 동기화되니 휴대폰 OneNote 앱에서도 표로 보인다.
//
// 페이지: 고른 섹션 안의 PAGE_TITLE 한 장. 그 안의 표 하나(<table data-id="krs-rnd-projects">)가 블록이다 —
// 제목 줄 · 머리글 · 과제마다 한 줄(별칭·과제명·과제번호·책임자·연구기간·비고) · 맨 아래 기계용 한 칸(krsrnd1: + base64 UTF-8 JSON).
// 기준은 JSON 이고 표는 보기용이라 원노트에서 표를 손으로 고쳐도 다음에 맞출 때 덮인다. base64 라 OneNote 가 따옴표·기호를 바꿔도 안전.
// (Graph 의 replace 는 div 를 못 바꾸고, '#data-id' 를 target 으로 주면 table 이 500 을 낸다 — include_ids 로 읽은 생성 id 로 표를 통째로
// 바꾼다. kr_ext_rerp 의 lib/plus-onenote.js 가 2026-09-27 에 확인한 길.)
//
// 올리는 것은 **과제 정보만**(INFO_KEYS) — 예산·참여연구자·계획·진행 기록·변경이력은 이 브라우저에만 남는다.
// 맞추기(syncInfo): 과제마다 마지막으로 고친 시각(ts)이 늦은 쪽이 이긴다. 이 기기에서 고친 것은 지난번에 맞춘 모습(memo 의 지문)과
// 달라진 것으로 안다 — 고치는 곳마다 시각을 적지 않아도 된다. 지운 과제는 묘비(del)로 퍼뜨린다(90일 지나면 버림).
// 다른 기기에서 따로 만든 같은 과제(과제번호, 없으면 과제명이 같음)는 원노트 쪽 id 로 맞춘다 — 처음 맞추는 과제는 원노트 쪽이 기준.

import { connect } from './teams.js';
import { normalizeProject, MAX_PROJECTS } from './rnd.js';

export const NOTE_KEY = 'rndNote';
export const ONENOTE_MCP_URL = 'http://localhost:5005/mcp';
export const PAGE_TITLE = '[R&D 과제 정보] KRS WORKSPACE';
export const BLOCK_ID = 'krs-rnd-projects';
/** 원노트로 가는 과제 정보 — 이것만 맞춘다. */
export const INFO_KEYS = Object.freeze(['name', 'alias', 'code', 'lead', 'start', 'end', 'calendar', 'note']);
const TOMB_DAYS = 90;
const MARK = 'krsrnd1:';

/** 저장해 두는 원노트 맞추기 형편(chrome.storage 의 rndNote). memo 는 지난번에 맞춘 과제마다의 지문·시각, del 은 묘비. */
export function normalizeNote(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
  const map = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return {
    on: o.on === true, sectionId: str(o.sectionId), sectionLabel: str(o.sectionLabel), pageId: str(o.pageId), webUrl: str(o.webUrl, 2000),
    at: Number.isFinite(o.at) ? o.at : 0, memo: map(o.memo), del: map(o.del), last: str(o.last, 600), error: str(o.error, 600),
  };
}

/* ------------------------------------------------------------ 과제 정보·지문 */

const keyOf = (s) => String(s ?? '').replace(/\s/g, '').toLowerCase();
/** 같은 과제인가 — 과제번호가 둘 다 있으면 그것으로, 아니면 과제명으로(src/rnd.js 의 mergeProjects 와 같은 규칙). */
const sameProject = (a, b) => (a.code && b.code ? keyOf(a.code) === keyOf(b.code) : keyOf(a.name) === keyOf(b.name));

export const infoOf = (p) => Object.fromEntries([['id', p.id], ...INFO_KEYS.map((k) => [k, k === 'calendar' ? p[k] === true : p[k] || ''])]);
/** 과제 정보의 지문 — 지난번에 맞춘 뒤로 이 기기에서 고쳤는지 본다. */
export const infoHash = (p) => JSON.stringify(INFO_KEYS.map((k) => (k === 'calendar' ? p[k] === true : p[k] || '')));
/** 장부 전체 과제 정보의 지문 — 고친 것이 있어 맞출 때가 됐는지 본다. */
export const bookHash = (book) => JSON.stringify(book.projects.map((p) => [p.id, infoHash(p)]));

/**
 * 이 기기의 과제 정보와 원노트의 것을 맞춘다.
 * @param {object[]} local 장부의 과제들(id·과제 정보)
 * @param {{projects: object[], del: object}} remote 원노트 블록에서 읽은 것(없으면 빈 것)
 * @param {{memo?: object, del?: object, now?: number}} state 지난번에 맞춘 지문(memo)과 이 기기의 묘비(del)
 * @returns {{ renames: [string,string][], projects: object[], added: string[], updated: string[], removed: string[], page: object, memo: object, del: object, push: boolean }}
 *   projects 는 맞춘 뒤의 과제 정보(장부 차례 · 원노트에서 온 것은 뒤에), renames 는 원노트 id 로 바꿀 이 기기의 과제 id.
 */
export function syncInfo(local, remote, { memo = {}, del = {}, now = Date.now() } = {}) {
  const rem = (remote?.projects || []).map((r) => ({ ...infoOf(normalizeProject(r)), ts: Number.isFinite(r?.ts) ? r.ts : 0 })).filter((r) => r.id && r.name);
  const remById = new Map(rem.map((r) => [r.id, r]));
  // 다른 기기에서 따로 만든 같은 과제 — 원노트 쪽 id 로 맞춘다.
  const renames = [];
  const loc = local.map((p) => infoOf(p));
  for (const r of rem) {
    if (loc.some((l) => l.id === r.id)) continue;
    const l = loc.find((x) => !remById.has(x.id) && !renames.some(([, to]) => to === x.id) && sameProject(x, r));
    if (l) {
      renames.push([l.id, r.id]);
      l.id = r.id;
    }
  }
  const locById = new Map(loc.map((l) => [l.id, l]));
  // 이 기기의 시각 — 지난번과 같으면 그때의 시각, 달라졌으면 지금. 처음 맞추는데 원노트에 있으면 원노트가 기준(0).
  const lts = (l) => {
    const m = memo[l.id];
    if (!m) return remById.has(l.id) ? 0 : now;
    return m.h === infoHash(l) ? m.ts : now;
  };
  // 묘비 — 원노트의 것 + 이 기기의 것 + 지난번에 맞췄는데 이 기기에서 사라진 과제. 오래된 것은 버린다.
  const tombs = {};
  const tomb = (id, ts) => { if (Number.isFinite(ts) && ts > (tombs[id] || 0)) tombs[id] = ts; };
  for (const [id, ts] of Object.entries(remote?.del || {})) tomb(id, ts);
  for (const [id, ts] of Object.entries(del || {})) tomb(id, ts);
  for (const id of Object.keys(memo)) if (!locById.has(id) && !renames.some(([from]) => from === id)) tomb(id, now);
  for (const [id, ts] of Object.entries(tombs)) if (now - ts > TOMB_DAYS * 864e5) delete tombs[id];

  const kept = [];
  const ids = [...loc.map((l) => l.id), ...rem.map((r) => r.id).filter((id) => !locById.has(id))];
  for (const id of ids) {
    const l = locById.get(id);
    const r = remById.get(id);
    const lt = l ? lts(l) : -1;
    // 같은 시각이면 원노트 쪽 — 처음 맞추는 과제(0)와, 양쪽이 지난번 그대로인 과제(같은 글)다.
    const win = l && r ? (lt > r.ts ? { ...l, ts: lt } : r) : l ? { ...l, ts: lt } : r;
    if ((tombs[id] || 0) >= win.ts) continue;
    delete tombs[id];   // 묘비보다 늦게 고친 과제는 살아 있다
    kept.push(win);
  }
  const keptIds = new Set(kept.map((k) => k.id));
  const added = kept.filter((k) => !locById.has(k.id)).map((k) => k.id).slice(0, Math.max(0, MAX_PROJECTS - loc.length));
  const updated = kept.filter((k) => locById.has(k.id) && infoHash(k) !== infoHash(locById.get(k.id))).map((k) => k.id);
  const removed = loc.filter((l) => !keptIds.has(l.id)).map((l) => l.id);
  const page = { projects: kept, del: tombs };
  const sig = (x) => JSON.stringify([x.projects.map((p) => [p.id, p.ts, infoHash(p)]).sort(), Object.entries(x.del || {}).sort()]);
  const push = !remote || sig(page) !== sig({ projects: rem, del: remote.del || {} });
  // 지문은 이 기기에 있게 될 과제만 — 과제가 열 개 차서 못 들인 것을 다음번에 "이 기기에서 지웠다" 로 읽지 않게.
  const mine = new Set([...loc.map((l) => l.id), ...added]);
  const nextMemo = Object.fromEntries(kept.filter((k) => mine.has(k.id)).map((k) => [k.id, { h: infoHash(k), ts: k.ts }]));
  return { renames, projects: kept, added, updated, removed, page, memo: nextMemo, del: tombs, push };
}

/* ------------------------------------------------------------ 블록(표 하나) */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dot = (s) => (s ? String(s).replace(/-/g, '.') : '');
const b64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const stamp = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

/** 원노트에 쓸 표 — OneNote 표는 셀 병합이 없어 제목·기계용 글은 첫 칸에 둔다. */
export function blockHtml(page, at = Date.now()) {
  const cols = ['별칭', '과제명', '과제번호', '책임자', '연구기간', '비고'];
  const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  const blank = (first) => row([first, ...cols.slice(1).map(() => '')]);
  const data = { v: 1, at, projects: page.projects.map((p) => ({ ...infoOf(p), ts: p.ts || 0 })), del: page.del || {} };
  return `<table data-id="${BLOCK_ID}" border="1">`
    + blank(`<b>R&amp;D 과제 정보</b> · KRS WORKSPACE 가 맞춥니다 · ${stamp(at)} · 표를 고쳐도 다음에 맞출 때 덮입니다`)
    + row(cols.map((c) => `<b>${c}</b>`))
    + page.projects.map((p) => row([esc(p.alias), esc(p.name), esc(p.code), esc(p.lead), p.start ? `${dot(p.start)} ~ ${dot(p.end)}` : '', esc(p.note)])).join('')
    + blank(`${MARK}${b64(JSON.stringify(data))}`)
    + '</table>';
}

/** 페이지 HTML 에서 data-id 가 BLOCK_ID 인 표 → { html, inner, id(생성 id — replace 의 target) } | null. Graph 는 속성 차례를 바꿔 돌려준다. */
export function findBlock(html) {
  const m = new RegExp(`<table\\b[^>]*\\bdata-id="${BLOCK_ID}"[^>]*>([\\s\\S]*?)<\\/table>`, 'i').exec(html || '');
  if (!m) return null;
  const open = /^<[^>]*>/.exec(m[0])[0];
  return { html: m[0], inner: m[1], id: /\sid="([^"]+)"/i.exec(open)?.[1] || '' };
}

/** 블록 안쪽 HTML → { at, projects, del } | null. 태그를 걷어낸 글에서 표시 뒤의 base64 를 읽는다(OneNote 가 줄을 나누거나 span 으로 감싸도 된다). */
export function readBlock(inner) {
  const text = String(inner || '').replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&')
    .replace(/\s+/g, '');
  const m = text.match(/krsrnd1:([A-Za-z0-9+/=]+)/);
  if (!m) return null;
  try {
    const o = JSON.parse(unb64(m[1]));
    return { at: Number(o.at) || 0, projects: Array.isArray(o.projects) ? o.projects : [], del: o.del && typeof o.del === 'object' ? o.del : {} };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ 원노트 페이지(MCP) */

/**
 * onenote MCP 서버에 붙는다 — tool(name, args) 은 도구의 답(JSON)을 준다. 닿지 않으면 알아들을 말로 던진다.
 * @returns {Promise<{tool: (name:string, args:object, ms?:number) => Promise<any>}>}
 */
export async function openNote({ url = ONENOTE_MCP_URL, fetchFn = fetch } = {}) {
  let mcp;
  try {
    mcp = await connect(url, fetchFn, 4000, 'OneNote MCP');
  } catch (err) {
    throw new Error(`이 PC 의 OneNote MCP 서버(${url})에 닿지 않습니다 — KR_MS365_mcp 의 onenote 서버를 띄우세요. (${err?.message || err})`);
  }
  return {
    async tool(name, args, ms = 30000) {
      const r = await mcp.call('tools/call', { name, arguments: args }, ms);
      const text = (r?.content || []).map((c) => c.text || '').join('');
      let json = null;
      try { json = JSON.parse(text); } catch { /* 글로 답했다 */ }
      if (r?.isError || json?.success === false) throw new Error(json?.error || text.slice(0, 300) || `${name} 이(가) 실패했습니다`);
      return json ?? { text };
    },
  };
}

/** 섹션 목록 → [{ id, label("노트북 › 섹션") }] — 내가 연 모든 노트북. 공유 노트북은 OneNote 에서 한 번 열어 둬야 나온다. */
export async function listSections(nc) {
  const r = await nc.tool('read_onenote', { action: 'list_sections', top: 500 });
  return (r?.sections || []).filter((s) => s?.id).map((s) => ({ id: s.id, label: `${s.parent_notebook_name || '?'} › ${s.display_name || ''}` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

/**
 * 섹션 안의 과제 정보 페이지를 찾는다 — 목록은 MCP 의 이 PC 저장분이라 못 찾으면 sync_onenote_db 로 새로 받고 한 번 더. 없으면 null.
 * @returns {Promise<{pageId: string, webUrl: string}|null>}
 */
export async function findPage(nc, sectionId) {
  const look = async () => {
    const r = await nc.tool('read_onenote', { action: 'list_pages', section_id: sectionId, top: 5000 });
    const p = (r?.pages || []).find((x) => String(x?.title || '').trim() === PAGE_TITLE);
    return p ? { pageId: p.page_id || p.id, webUrl: p.web_url || '' } : null;
  };
  const hit = await look();
  if (hit) return hit;
  await nc.tool('sync_onenote_db', {}, 120000);
  return look();
}

export async function createPage(nc, sectionId, html) {
  const r = await nc.tool('write_onenote', { action: 'create_page', section_id: sectionId, title: PAGE_TITLE, content: html });
  const p = r?.page || {};
  if (!p.id) throw new Error('원노트 페이지를 만들었지만 id 를 받지 못했습니다.');
  return { pageId: p.id, webUrl: p.web_url || '' };
}

/** 페이지 HTML(생성 id 포함 — replace 의 target 을 얻는다). */
export async function readPage(nc, pageId) {
  const r = await nc.tool('read_onenote', { action: 'get_content', page_id: pageId, include_ids: true });
  if (typeof r?.content !== 'string') throw new Error('원노트 페이지 내용을 받지 못했습니다.');
  return r.content;
}

/** 블록을 쓴다 — 있던 표는 그 생성 id 로 통째로 바꾸고, 없으면 본문 끝에 붙인다. */
export function writeBlock(nc, pageId, html, block) {
  return block?.id
    ? nc.tool('write_onenote', { action: 'replace', page_id: pageId, target: block.id, content: html })
    : nc.tool('write_onenote', { action: 'append', page_id: pageId, content: html });
}
