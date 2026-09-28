// 인명 검색 결과의 인명 카드에 "Teams" 버튼을 붙이는 콘텐츠 스크립트의 시동 부분.
//
// home.js 와 같은 얼개다 — 콘텐츠 스크립트는 import 문을 못 쓰므로 확장 안의 모듈을 동적으로 불러온다.
// 매니페스트는 eclass 전체에 붙이지만, 붙일 화면은 경로가 아니라 **카드가 있는지**로 고른다.
// 검색 결과(searchmember/MemberList)뿐 아니라 같은 카드가 뜨는 화면(부서 페이지 등)을 한 번에 덮고,
// 경로 대소문자가 들쭉날쭉한 것도 피한다.
// 붙일지 말지는 패널의 "설정 및 연결" 체크박스(storage 의 teamsButton)를 따른다. 꺼져 있어도 모듈은
// 불러 둔다 — 패널에서 다시 켜면 새로고침 없이 붙어야 하기 때문이다.
(() => {
  if (!document.querySelector('.search_info_btn')) return;

  import(chrome.runtime.getURL('src/people.js'))
    .then(({ startPeople }) => startPeople(document))
    .catch((err) => console.warn('[KRS WORKSPACE] 인명 카드에 Teams 버튼을 붙이지 못했습니다:', err));
})();
