// 연결 지침(src/bridgeguide.js): 확장 폴더를 어디서 알아내는지, 지침에 무엇이 들어가는지.
import assert from 'node:assert/strict';

const { rootFromManifest, bridgeRoot, bridgeGuide } = await import('../src/bridgeguide.js');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const ID = 'ljcjjfkplgjkibebhnlikmjnfoffpdno';
const ROOT = 'E:\\dev\\meeting_room';
const manifest = (id = ID, root = ROOT) => ({
  name: 'com.krs.meetingroom',
  path: `${root}\\native\\claude-bridge.bat`,
  allowed_origins: [`chrome-extension://${id}/`],
});

console.log('확장 폴더 알아내기');
t('매니페스트의 ID 가 지금 ID 와 같으면 그 경로가 확장 폴더다', () =>
  assert.deepEqual(rootFromManifest(manifest(), ID), { root: ROOT, hint: '' }));
t('ID 가 다르면(폴더를 옮겼거나 다른 ID 로 등록) 믿지 않고 후보로만 준다', () =>
  assert.deepEqual(rootFromManifest(manifest('a'.repeat(32)), ID), { root: '', hint: ROOT }));
t('다리 파일 경로가 아니면 아무것도 주지 않는다', () => {
  assert.deepEqual(rootFromManifest({ path: 'C:\\other\\thing.exe', allowed_origins: [`chrome-extension://${ID}/`] }, ID), { root: '', hint: '' });
  assert.deepEqual(rootFromManifest(null, ID), { root: '', hint: '' });
});
await ta('등록한 적이 없어 파일이 없으면 빈 값 (예외를 밖으로 던지지 않는다)', async () => {
  globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://${ID}/${p}` } };
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await bridgeRoot(ID), { root: '', hint: '' });
});
await ta('파일이 있으면 native 폴더의 매니페스트를 읽는다', async () => {
  let asked = '';
  globalThis.fetch = async (url) => { asked = url; return { ok: true, json: async () => manifest() }; };
  assert.deepEqual(await bridgeRoot(ID), { root: ROOT, hint: '' });
  assert.equal(asked, `chrome-extension://${ID}/native/com.krs.meetingroom.json`);
});

console.log('지침 글');
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
t('확장 폴더를 알면 폴더·ID·증상을 적고, 명령을 그 경로로 완성해 준다', () => {
  const text = bridgeGuide({ id: ID, root: ROOT, error: 'Specified native messaging host not found.', version: '0.4.0', userAgent: CHROME_UA });
  assert.match(text, /확장 폴더\(작업 폴더\): E:\\dev\\meeting_room\n/);
  assert.match(text, new RegExp(`확장 ID: ${ID}`));
  assert.match(text, /브라우저: 크롬 141 · 확장 v0\.4\.0/);
  assert.match(text, /"Specified native messaging host not found\."\n {2}→ 흔히 호스트가 등록되지 않았거나/);
  assert.ok(text.includes(`-File "${ROOT}\\.claude\\skills\\bridge\\bridge_ops.ps1" check`));
  assert.ok(text.includes(`bridge_ops.ps1" install ${ID}`));
  assert.ok(text.includes('bridge_ops.ps1" restart chrome'));
  assert.ok(!text.includes('<확장 폴더>'));
});
t('폴더를 모르면 찾는 법을 적고, 명령에는 자리만 남긴다 — 믿지 못할 후보는 그렇다고 적는다', () => {
  const text = bridgeGuide({ id: ID, hint: 'D:\\old\\meeting_room', error: 'Access to the specified native messaging host is forbidden.', userAgent: CHROME_UA });
  assert.match(text, /자기 폴더의 경로를 알 수 없어/);
  assert.match(text, /D:\\old\\meeting_room 로 적혀 있지만/);
  assert.match(text, /chrome:\/\/extensions 에서 이 확장 카드의 "로드 위치"/);
  assert.match(text, /allowed_origins 가 이 확장 ID 와 다른 경우/);
  assert.ok(text.includes('-File "<확장 폴더>\\.claude\\skills\\bridge\\bridge_ops.ps1" check'));
});
t('엣지에서는 엣지 주소와 엣지 재시작 명령을 적는다', () => {
  const text = bridgeGuide({ id: ID, userAgent: `${CHROME_UA} Edg/141.0.0.0` });
  assert.match(text, /브라우저: 엣지 141/);
  assert.match(text, /edge:\/\/extensions/);
  assert.ok(text.includes('bridge_ops.ps1" restart edge'));
});
t('까닭을 모르면 증상 줄에 짐작을 붙이지 않는다', () => {
  const text = bridgeGuide({ id: ID, root: ROOT });
  assert.match(text, /com\.krs\.meetingroom 에 닿지 않습니다\n\n## 배경/);
});

console.log(`\n통과 ${pass}건`);
