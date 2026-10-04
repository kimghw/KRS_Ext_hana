// 여비계산서를 PDF 로 받는 길(src/calpdf.js) — 계산서 화면이 리포트 서버(ClipReport)에 보내는 폼을 읽고, 뷰어가 하는 차례대로
// 물어 PDF 를 받는다(2026-10-04 사용자 지정: 확정한 계산서를 출력해 증빙과 합쳐 보낸다). 리포트 서버는 흉내 낸다.
import assert from 'node:assert/strict';
import { calReport, reportTarget, reportPdf } from '../src/calpdf.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

// 실제 계산서 화면(2026-10-04, CalPrint?seq=143884)의 리포트 부르는 글 그대로.
const CAL = `<div class="bt-steps"></div><iframe id="ClipReportFm" name="ClipReportFm"></iframe>
<script>
  window.addEventListener('load', function () {
    var viewUrl = 'https://eclass.krs.co.kr' + '/ClipReport/reportView.aspx';
    var rebUrl = 'https://eclass.krs.co.kr/intra/intranet/VSDotNet/BusinessTrip/rebfiles/rptCalResult.reb';
    var fields = {
      crfName: encodeURI(rebUrl),
      xmlData: '',
      dataConnetion: 'sql_krextra',          // (ClipReport's field name is misspelled)
      param: 'MSEQ=143884:TSEQ=156032:LAN=K',
      saveReportType: 'pdf'
    };
  });
</script>`;
const REPORT = {
  crfName: 'https://eclass.krs.co.kr/intra/intranet/VSDotNet/BusinessTrip/rebfiles/rptCalResult.reb', xmlData: '',
  dataConnetion: 'sql_krextra', param: 'MSEQ=143884:TSEQ=156032:LAN=K', saveReportType: 'pdf',
};

console.log('계산서 화면에서 리포트 폼을 읽는다');
t('리포트 파일·연결 이름·매개변수(계산서:출장자:말)를 화면의 글에서 읽는다', () => {
  assert.deepEqual(calReport(CAL), REPORT);
  assert.deepEqual(reportTarget(REPORT.param), { seq: '143884', trseq: '156032' });
});
t('리포트를 부르지 않는 화면이면(모양이 다르다) null 이다', () => {
  assert.equal(calReport('<div class="bt-steps"></div>'), null);
  assert.equal(calReport(CAL.replace(/param: '[^']*',/, '')), null, '매개변수가 없으면 보낼 것이 없다');
  assert.equal(calReport(''), null);
  assert.deepEqual(reportTarget(''), { seq: '', trseq: '' });
});

/** 가짜 리포트 서버. waits 만큼 "아직"이라고 답한 뒤에 된다. calls 에 간 것을 적는다. */
function fakeServer({ view, pageWaits = 0, fileWaits = 0, pages = 1, pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), calls = [] } = {}) {
  let pageLeft = pageWaits;
  let fileLeft = fileWaits;
  const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return async (url, init) => {
    const form = new URLSearchParams(init.body);
    assert.deepEqual([init.method, init.credentials], ['POST', 'include']);
    if (String(url).endsWith('/ClipReport/reportView.aspx')) {
      calls.push(['view', Object.fromEntries(form)]);
      return new Response(view ?? `<script>var reportkey = '{"uid":"k-9","st":1,"reportkey":"k-9","isSync":false,"status":true}';</script>`, { status: 200 });
    }
    assert.equal(String(url), 'https://eclass.krs.co.kr/ClipReport/Clip.aspx');
    const type = form.get('ClipType');
    const data = JSON.parse(form.get('ClipData'));
    calls.push([type, data]);
    if (type === 'pageCheck') return json({ id: 2, resValue: pageLeft-- > 0 ? { status: true, count: 0, endReport: false } : { status: true, count: pages, endReport: true } });
    if (type === 'PDFPrint') return json({ id: 5, resValue: { status: true, exportKey: 'e-1' } });
    if (type === 'fileDownloadCheck') return json({ id: 4, resValue: { status: fileLeft-- <= 0, progress: 100 } });
    if (type === 'PDFPrintDownload') return new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } });
    return new Response('', { status: 404 });
  };
}
const quick = { pause: async () => {} };

console.log('리포트를 PDF 로 받는다');
await ta('뷰어와 같은 차례 — 열기 → 쪽수 확인 → PDF 만들기 → 다 됐는지 확인 → 내려받기', async () => {
  const calls = [];
  const stages = [];
  const r = await reportPdf(REPORT, { fetchFn: fakeServer({ calls, pages: 2 }), onStage: (s) => stages.push(s), ...quick });
  assert.deepEqual([r.pages, [...r.bytes.subarray(0, 4)]], [2, [0x25, 0x50, 0x44, 0x46]]);
  assert.deepEqual(calls.map((c) => c[0]), ['view', 'pageCheck', 'PDFPrint', 'fileDownloadCheck', 'PDFPrintDownload']);
  assert.deepEqual(calls[0][1], REPORT, '계산서 화면이 보내는 폼 그대로다');
  assert.deepEqual(calls[2][1], { reportkey: 'k-9', startNum: 1, endNum: 2, isTextImage: false, drawDashedLineDirectly: true }, '처음부터 끝 쪽까지');
  assert.deepEqual(calls[4][1], { reportkey: 'k-9' });
  assert.deepEqual(stages, ['여비계산서를 여는 중...', '여비계산서를 PDF 로 받는 중...']);
});
await ta('리포트가 아직 그려지는 중이거나 PDF 가 아직 만들어지는 중이면 될 때까지 다시 묻는다', async () => {
  const calls = [];
  let paused = 0;
  const r = await reportPdf(REPORT, { fetchFn: fakeServer({ calls, pageWaits: 2, fileWaits: 3 }), pause: async () => { paused++; } });
  assert.equal(r.pages, 1);
  assert.deepEqual(calls.map((c) => c[0]), ['view', 'pageCheck', 'pageCheck', 'pageCheck', 'PDFPrint', 'fileDownloadCheck', 'fileDownloadCheck', 'fileDownloadCheck', 'fileDownloadCheck', 'PDFPrintDownload']);
  assert.equal(paused, 5, '아직이라는 답마다 한 번 쉰다');
});
await ta('끝내 안 되면 그만둔다 — 내려받기를 보내지 않는다', async () => {
  const calls = [];
  await assert.rejects(reportPdf(REPORT, { fetchFn: fakeServer({ calls, pageWaits: 1000 }), ...quick }), /다 그려지기를 기다리다 그만두었습니다/);
  assert.ok(!calls.some((c) => c[0] === 'PDFPrint'));
  await assert.rejects(reportPdf(REPORT, { fetchFn: fakeServer({ fileWaits: 1000 }), ...quick }), /PDF 가 다 만들어지기를 기다리다 그만두었습니다/);
});
await ta('리포트 서버가 계산서를 열지 못하면(열쇠가 없다) 까닭을 말한다 — 로그인 화면이면 로그인이 필요하다고 한다', async () => {
  await assert.rejects(reportPdf(REPORT, { fetchFn: fakeServer({ view: '<script>alert("error")</script>' }), ...quick }), /리포트 서버가 여비계산서를 열지 못했습니다/);
  await assert.rejects(reportPdf(REPORT, { fetchFn: fakeServer({ view: `<script>var reportkey = '{"uid":"k","status":false}';</script>` }), ...quick }), /열지 못했습니다/);
  await assert.rejects(reportPdf(REPORT, { fetchFn: fakeServer({ view: '<input id="tbUserId">' }), ...quick }), (err) => err.name === 'AuthError' && /^로그인이 필요합니다/.test(err.message));
});
await ta('쪽이 없는 리포트, PDF 가 아닌 답, 닿지 않는 서버 — 모두 받지 않고 던진다', async () => {
  await assert.rejects(reportPdf(REPORT, { fetchFn: fakeServer({ pages: 0 }), ...quick }), /여비계산서에 쪽이 없습니다/);
  await assert.rejects(reportPdf(REPORT, { fetchFn: fakeServer({ pdf: new TextEncoder().encode('<html>오류</html>') }), ...quick }), /PDF 가 아닙니다/);
  await assert.rejects(reportPdf(REPORT, { fetchFn: async () => { throw new TypeError('Failed to fetch'); }, ...quick }), /리포트 서버에 닿지 못했습니다\(Failed to fetch\)/);
  await assert.rejects(reportPdf(REPORT, { fetchFn: async () => new Response('', { status: 500 }), ...quick }), /리포트 서버가 HTTP 500 로 답했습니다/);
});

console.log(`\n통과 ${pass}건`);
