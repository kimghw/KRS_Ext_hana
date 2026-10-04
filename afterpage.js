// eclass 여비계산서의 **사후정산 입력 화면**(/BusinessTrip/AfterTrip)에 "증빙으로 입력"을 붙이는 콘텐츠 스크립트의 시동 부분.
//
// 증빙(영수증·인보이스·항공권)을 화면에 끌어다 놓거나 붙여 넣거나 고르면, 읽어서 숙박비·교통비 내역에 줄을 추가하고
// 칸을 채운다(src/afterpage.js). 저장은 누르지 않는다.
//
// home.js 와 같은 까닭으로 모듈을 동적으로 불러온다(콘텐츠 스크립트는 import 문을 못 쓴다). 매니페스트는 eclass 전체의
// 모든 프레임에 붙인다 — 이 화면은 포털 껍데기의 iframe 안에서도, 탭에서 바로도 열리고 경로의 대소문자도 들쭉날쭉하다.
// 그래서 여기서 경로를 보고 사후정산 입력 화면이 아니면 곧바로 끝낸다.
(() => {
  if (!/^\/businesstrip\/aftertrip(\/|$)/i.test(location.pathname)) return;

  import(chrome.runtime.getURL('src/afterpage.js'))
    .then(({ startAfterPage }) => startAfterPage(document))
    .catch((err) => {
      // 확장이 다시 올려져 끊긴 것(runtime.id 가 사라진다)은 새로고침하면 풀리는 일이라 오류로 올리지 않는다.
      if (chrome.runtime?.id) console.warn('[KRS WORKSPACE] 사후정산 화면에 증빙으로 입력을 붙이지 못했습니다:', err);
    });
})();
