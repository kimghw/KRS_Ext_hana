// e-Class 홈에 붙이는 카드들(내 예약 · 접수 미확인 공문)의 공통 겉모습.
//
// 홈에는 다른 확장의 "R&D ERP 현황" 카드가 같이 뜬다. 그 옆에서 따로 놀지 않게 같은 모양을 쓴다
// (2026-10-02 그 카드의 계산된 스타일을 읽어 맞춘 값): 위쪽 3px 남색 띠, 옅은 남색 머리 줄, 굵은 남색 제목,
// 알약 모양 건수 칩(이름 + 굵은 숫자), 점이 붙은 읽은 시각, 오른쪽의 26×24 아이콘 버튼.
// 머리 줄에는 건수와 읽은 때만 둔다 — "없습니다" 같은 말은 적지 않는다. 0 이면 칩이 0 이라고 말한다.
//
// 카드마다 이 스타일을 자기 <style> 에 같이 넣는다. 모두 .krs-card 아래로 묶여 사이트 CSS 와 섞이지 않는다.

export const CARD_STYLE = `
.krs-card { color: #222; font: 13px/1.45 -apple-system, "Segoe UI", "Malgun Gothic", "맑은 고딕", Roboto, sans-serif; }
.krs-card .krs-card-panel { overflow: hidden; border: 1px solid #d5dbe3; border-top: 3px solid #1f4e9c; border-radius: 10px; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .08); }
.krs-card .krs-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 14px; background: #f5f8fc; color: #1f4e9c; }
.krs-card .krs-card-title { margin: 0; color: #1f4e9c; font-size: 14px; font-weight: 700; line-height: 1.45; white-space: nowrap; }
.krs-card .krs-card-chips { display: flex; gap: 6px; }
.krs-card .krs-card-chip { display: flex; align-items: center; gap: 5px; height: 22px; padding: 0 9px; border-radius: 12px; background: #eef1f5; font-size: 11.5px; line-height: 22px; white-space: nowrap; }
.krs-card .krs-card-chip:has(b.on) { background: #e3edfb; }
.krs-card .krs-card-chip > span { color: #222; font-weight: 600; }
.krs-card .krs-card-chip > b { color: #1f4e9c; font-size: 13px; font-weight: 800; }
.krs-card .krs-card-chip > b:empty::after { content: "–"; color: #8798b0; font-weight: 400; }
.krs-card .krs-card-note { flex: 1 1 auto; min-width: 0; color: #607089; font-size: 11px; }
.krs-card .krs-card-note:not(:empty)::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: #8798b0; vertical-align: 1px; }
.krs-card .krs-card-tools { display: flex; gap: 6px; margin-left: auto; }
.krs-card .krs-card-btn { display: flex; align-items: center; justify-content: center; width: 26px; height: 24px; padding: 0; border: 1px solid #e3eaf3; border-radius: 7px; background: #fff; color: #67768e; box-shadow: 0 1px 1px rgba(16, 24, 40, .04); cursor: pointer; }
.krs-card .krs-card-btn:hover { border-color: #b7cdf0; background: #f5f8fc; color: #1f4e9c; }
.krs-card .krs-card-btn:disabled { opacity: .55; cursor: default; }
.krs-card .krs-card-btn[hidden] { display: none; }
.krs-card .krs-card-btn svg { display: block; pointer-events: none; transition: transform .15s; }
.krs-card .krs-card-btn[aria-expanded="true"] svg { transform: rotate(180deg); }
.krs-card[aria-busy="true"] .krs-card-btn[data-act="refresh"] svg { animation: krs-card-spin 1s linear infinite; }
@keyframes krs-card-spin { to { transform: rotate(360deg); } }
.krs-card .krs-card-body { padding: 10px 14px 12px; border-top: 1px solid #e3eaf3; }
.krs-card .krs-card-warn { margin: 0; color: #a7691a; font-size: 12px; }
.krs-card .krs-card-warn:empty { display: none; }
`;

const svg = (inner) => '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" '
  + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

/** 머리 줄 아이콘. R&D ERP 현황 카드와 같은 선 굵기·크기다. */
export const ICON = {
  refresh: svg('<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'
    + '<path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>'),
  chevron: svg('<polyline points="6 9 12 15 18 9"/>'),
  panel: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>'),
  // 보이기(눈) · 숨기기(빗금 친 눈)
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.5 3.5M6.4 6.4C3.6 8.3 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.4"/>'
    + '<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/>'),
};

/** 칩의 숫자를 적는다. 0 보다 크면 칩이 파랗게 도드라진다. 아직 모르면(null) 줄표다. */
export function setChip(el, n) {
  el.textContent = n == null ? '' : String(n);
  el.classList.toggle('on', n > 0);
}
