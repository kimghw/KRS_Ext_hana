// 생성물 — 고치지 않는다. recipes/gongmun 을 고치고 `node tools/gen-gongmun.mjs` 를 돌린다.
export const RECIPE = {
  "forms": {
    "KR_EA_Research_Task": {
      "id": "KR_EA_Research_Task",
      "label": "연구업무추진품의",
      "unit": "research-form",
      "slug": "research_task",
      "anchor": "#ctl00_ApplineInfoInReportKRTA1_txtDocTitle",
      "fields": {
        "title": {
          "kind": "title",
          "selector": "#ctl00_ApplineInfoInReportKRTA1_txtDocTitle",
          "label": "#ctl00_ApplineInfoInReportKRTA1_lblDocTitle",
          "max": 99,
          "source": "title"
        },
        "recipient": {
          "kind": "text",
          "selector": "#ctl00_ContentPlaceHolder_Content_txtRecieve",
          "source": "recipient"
        },
        "reference": {
          "kind": "text",
          "selector": "#ctl00_ContentPlaceHolder_Content_txtReference",
          "source": "reference"
        },
        "degree": {
          "kind": "text",
          "selector": "#ctl00_ContentPlaceHolder_Content_txtDegree",
          "source": "degree"
        },
        "job": {
          "kind": "picker",
          "hidden": "#ctl00_ContentPlaceHolder_Content_hidJobID",
          "label": "#ctl00_ContentPlaceHolder_Content_lblJobID",
          "callback": "callBackReturnFromDialog",
          "list": "/RnDPMS/View/PMS/ListJSON_Ver2.ashx",
          "source": "job"
        },
        "body": {
          "kind": "dext5",
          "control": "ctl00_ContentPlaceHolder_Content_EditorControl1",
          "source": "body"
        }
      }
    },
    "KR_EA_Form2": {
      "id": "KR_EA_Form2",
      "label": "기안문",
      "unit": "draft-form",
      "slug": "kr_ea_form2",
      "anchor": "#ctl00_ApplineInfoInReportKRTA1_txtDocTitle",
      "fields": {
        "title": {
          "kind": "title",
          "selector": "#ctl00_ApplineInfoInReportKRTA1_txtDocTitle",
          "label": "#ctl00_ApplineInfoInReportKRTA1_lblDocTitle",
          "max": 99,
          "source": "title"
        },
        "reference": {
          "kind": "text",
          "selector": "#ctl00_ContentPlaceHolder_Content_txtReference",
          "source": "reference"
        },
        "job": {
          "kind": "text",
          "selector": "#ctl00_ContentPlaceHolder_Content_txtJobId",
          "source": "jobText"
        },
        "body": {
          "kind": "dext5",
          "control": "ctl00_ContentPlaceHolder_Content_EditorControl1",
          "source": "body"
        }
      }
    }
  },
  "order": [
    "purchase",
    "edu",
    "trip",
    "outside"
  ],
  "purposes": {
    "purchase": {
      "id": "purchase",
      "form": "KR_EA_Research_Task",
      "label": "구매",
      "title": "구매품의",
      "rule_key": "연구비집행",
      "amount_field": "total",
      "document_setting": "연구품의",
      "limit": 1000000,
      "account": "연구활동비(연구실운용비)",
      "fields": [
        {
          "key": "gist",
          "label": "품목 요지 (제목)",
          "wide": true,
          "from": "document",
          "need": "품목",
          "read": "공문 제목에 들어갈 짧은 품목 이름. 대표 품목을 짧게 적고(모델 번호는 빼도 됩니다), 품목이 둘 이상이면 \"대표 품목 외 N건\" 으로 적습니다.",
          "example": "34인치 모니터 외 1건"
        },
        {
          "key": "vendor",
          "label": "구매처",
          "from": "document",
          "read": "견적을 낸 업체·판매처 — 상호 그대로. 쇼핑몰 화면이면 판매자이고, 판매자가 없으면 쇼핑몰 이름입니다.",
          "example": "(주)OO상사"
        },
        {
          "key": "total",
          "label": "합계 (VAT 포함, 원)",
          "type": "money",
          "from": "document",
          "need": "합계",
          "read": "부가세를 포함한 최종 합계(결제·청구할 금액). 할인이 있으면 할인을 뺀 금액입니다. 문서에 \"부가세 별도\" 이고 합계가 공급가액뿐이면 null 로 두고 supply 에 적습니다 — 셈해 넣지 않습니다.",
          "example": 989000
        },
        {
          "key": "use",
          "label": "용도",
          "wide": true,
          "open": true,
          "from": "document",
          "need": "용도",
          "read": "공문 용도 칸의 초안 — 품목의 쓰임을 짧은 구절로. 문서에 적혀 있으면 그대로, 없으면 품목으로 보아 연구부서에서 흔히 쓰는 쓰임을 적습니다 (사용자가 고칩니다). 사유는 여기서 쓰지 않습니다.",
          "write": "품목의 쓰임을 짧은 구절로(끝에 마침표 없이). 지금 적힌 용도가 있으면 그것을 다듬어 씁니다.",
          "example": "연구 데이터 저장·백업용"
        },
        {
          "key": "reason",
          "label": "구매사유",
          "wide": true,
          "area": true,
          "open": true,
          "placeholder": "과제와 이어지는 필요성 — 비워 두지 않습니다",
          "from": "write",
          "need": "구매사유",
          "write": "이 품목이 과제 수행에 왜 필요한지 — 과제 내용과 이어지는 필요성을 1~2문장으로, \"…필요함\" 처럼 명사형으로 끝맺습니다.",
          "example": "과제의 MVDC 차단기 시험 데이터 저장·분석에 필요함"
        },
        {
          "key": "summary",
          "label": "요약 (2. 이와 관련하여 …)",
          "wide": true,
          "from": "auto"
        },
        {
          "key": "account",
          "label": "구매계정",
          "wide": true,
          "from": "setup"
        }
      ],
      "reads": [
        {
          "key": "items",
          "type": "list",
          "max": 30,
          "read": "품목. 문서의 품목 표를 적힌 차례대로 한 줄씩 옮깁니다. 배송비·설치비처럼 따로 적힌 줄도 품목으로 넣습니다.",
          "item": [
            {
              "key": "name",
              "required": true,
              "max": 200,
              "read": "품목명·모델명 — 문서에 적힌 그대로(요약하지 않습니다)",
              "example": "LG 34WQ75C 34인치 모니터"
            },
            {
              "key": "spec",
              "max": 300,
              "read": "규격·사양 — 문서에 적힌 핵심을 ' · ' 로 나열",
              "example": "WQHD · 커브드 · USB-C"
            },
            {
              "key": "qty",
              "type": "number",
              "read": "수량",
              "example": 1
            },
            {
              "key": "unit",
              "max": 10,
              "read": "단위(개·대·EA·식 등)",
              "example": "대"
            },
            {
              "key": "unitPrice",
              "type": "money",
              "read": "단가",
              "example": 890000
            },
            {
              "key": "amount",
              "type": "money",
              "read": "그 줄의 금액 — 문서에 적힌 그대로",
              "example": 890000
            }
          ]
        },
        {
          "key": "quoteDate",
          "type": "date",
          "read": "견적일·발행일·주문일. 쇼핑몰 화면이면 주문일이고, 주문 전 장바구니·상품 화면이면 null 입니다.",
          "example": "2026-10-01"
        },
        {
          "key": "supply",
          "type": "money",
          "read": "공급가액 합계(부가세를 뺀 금액) — 문서에 따로 적혀 있을 때만",
          "example": 899091
        },
        {
          "key": "vat",
          "type": "money",
          "read": "부가세 합계 — 문서에 따로 적혀 있을 때만",
          "example": 89909
        }
      ],
      "reading": {
        "docs": "견적서·거래명세서·쇼핑몰 주문 화면",
        "rules": [
          "구매라도 강의(온라인 강의·교육 상품)를 사는 화면이면 parts 에서 강의 소개·커리큘럼·수업 목록이 든 장은 content 입니다 — 오린 견적서와 함께 강의 내용으로 첨부합니다. 가격·결제 칸만 있는 장은 order 입니다."
        ]
      },
      "quote_crop": {
        "when": "첨부한 그림이 견적서·거래명세서 양식이 아니라 쇼핑몰 상품·장바구니·주문 화면처럼 가격이 화면 일부에만 있는 캡처일 때",
        "keep": [
          "상품명",
          "모델·옵션",
          "수량",
          "단가",
          "할인",
          "배송비",
          "합계",
          "판매자"
        ],
        "drop": [
          "추천 상품",
          "광고",
          "리뷰",
          "상품 상세 설명",
          "메뉴"
        ],
        "read": "가격 글자가 잘리지 않게 넉넉히 잡습니다. 그 칸이 두 장에 걸쳐 있으면 장마다 한 줄씩 위에서 아래 차례로 적습니다."
      },
      "writing": {
        "context": "{{#품목}}\n품목: {품목명}\n  사양: {사양?}\n  수량: {수량?}\n{{/품목}}\n품목 요지: {품목요지?}\n지금 적힌 용도: {용도?}",
        "rules": []
      },
      "template": {
        "title": "{품목요지} 구매 품의",
        "body": "1. {부서:은} {과제개요}.\n2. 이와 관련하여 {요약} 아래와 같이 품의하오니 재가하여 주시기 바랍니다.\n\n------------ 아   래 ------------\n\n{차례}. 구매 내역\n{{#품목}}\n    ({번호}) 구매품 : {품목명}\n        - 사양 : {사양?}\n        - 수량 : {수량?}\n        - 금액 : {금액?}\n{{/품목}}\n{차례}. 구매금액 : {합계} (VAT 포함)\n{차례}. 구매처 : {업체}\n{차례}. 구매계정 : {계정}\n{차례}. 용도 : {용도}\n{차례}. 구매사유 : {구매사유}\n\n※ 첨 부\n{첨부}"
      },
      "vars": {
        "품목요지": {
          "from": "gist",
          "desc": "제목에 쓸 품목 이름"
        },
        "요약": {
          "from": "summary",
          "desc": "…을 구매하고자"
        },
        "업체": {
          "from": "vendor",
          "desc": "구매처"
        },
        "견적일": {
          "from": "quoteDate",
          "show": "date",
          "desc": "견적일 — 2026. 10. 1."
        },
        "합계": {
          "from": "total",
          "show": "won",
          "desc": "합계 — 989",
          "000원": null
        },
        "용도": {
          "from": "use",
          "desc": "용도"
        },
        "구매사유": {
          "from": "reason",
          "desc": "구매사유(과제 내용으로 쓴다)"
        },
        "품목수": {
          "from": "items",
          "show": "count",
          "desc": "품목 수"
        }
      },
      "lists": {
        "품목": {
          "from": "items",
          "desc": "품목마다 되풀이",
          "vars": {
            "품목명": {
              "from": "name"
            },
            "사양": {
              "from": "spec"
            },
            "수량": {
              "from": [
                "qty",
                "unit"
              ],
              "show": "qty"
            },
            "단위": {
              "from": "unit"
            },
            "단가": {
              "from": "unitPrice",
              "show": "won"
            },
            "금액": {
              "from": "amount",
              "show": "won"
            }
          }
        }
      },
      "attach": {
        "doc": "견적서",
        "ask": "견적서를 넣으세요",
        "more": "견적서 다음 쪽·거래명세서 더 넣기",
        "need": [],
        "parts": {
          "quote": "견적서",
          "statement": "거래명세서",
          "order": "주문 내역",
          "course": "강의 내용",
          "content": "강의 내용",
          "other": "참고 자료"
        },
        "who": "vendor"
      }
    },
    "edu": {
      "id": "edu",
      "form": "KR_EA_Research_Task",
      "label": "교육",
      "title": "교육품의",
      "rule_key": "연구비집행",
      "amount_field": "fee",
      "document_setting": "연구품의",
      "limit": null,
      "account": "연구활동비(교육훈련비)",
      "fields": [
        {
          "key": "course",
          "label": "교육명",
          "wide": true,
          "from": "document",
          "need": "교육명",
          "read": "교육 과정의 이름 — 안내문·신청 확인서·견적서에 적힌 그대로(회차·기수 표시도 그대로).",
          "example": "전력변환 설계 실무(3기)"
        },
        {
          "key": "provider",
          "label": "교육기관",
          "from": "document",
          "read": "교육을 여는 기관·업체 — 상호 그대로. 온라인 강의면 강의 플랫폼 이름입니다.",
          "example": "한국전력기술교육원"
        },
        {
          "key": "fee",
          "label": "교육비 (VAT 포함, 원)",
          "type": "money",
          "from": "document",
          "need": "교육비",
          "read": "부가세를 포함해 실제로 낼 교육비 — 할인을 뺀 결제 금액. \"부가세 별도\" 이고 공급가액만 있으면 null 로 두고 supply 에 적습니다 — 셈해 넣지 않습니다.",
          "example": 450000
        },
        {
          "key": "from",
          "label": "시작일",
          "type": "date",
          "from": "document",
          "need": "교육기간",
          "read": "교육이 실제로 열리는 첫날. 신청 마감일·결제일·수강 가능 기한(\"수강기한 90일\")과 헷갈리지 않습니다. 연도가 적혀 있지 않으면 문서 발행일(없으면 오늘)의 연도를 붙입니다. 날짜 없이 언제든 듣는 온라인 강의면 null 입니다.",
          "example": "2026-11-03"
        },
        {
          "key": "to",
          "label": "종료일",
          "type": "date",
          "from": "document",
          "not_before": "from",
          "read": "교육의 마지막 날. 하루짜리 교육이면 시작일과 같은 날입니다.",
          "example": "2026-11-05"
        },
        {
          "key": "place",
          "label": "교육장소",
          "from": "document",
          "read": "교육이 열리는 곳 — 도시와 기관·강의실. 온라인 강의면 \"온라인\", 실시간 화상 교육이면 \"온라인(Zoom)\" 처럼 적습니다.",
          "example": "대전 한국전력기술교육원"
        },
        {
          "key": "mode",
          "label": "교육 구분 (제목)",
          "type": "choice",
          "options": [
            "교육",
            "온라인교육"
          ],
          "from": "auto",
          "online": [
            "온라인",
            "online",
            "비대면",
            "원격",
            "이러닝",
            "e-learning",
            "elearning",
            "웨비나",
            "webinar",
            "인터넷강의",
            "인강",
            "동영상강의",
            "VOD",
            "인프런",
            "inflearn",
            "유데미",
            "udemy",
            "코세라",
            "coursera",
            "패스트캠퍼스",
            "클래스101",
            "K-MOOC",
            "KMOOC"
          ]
        },
        {
          "key": "hours",
          "label": "교육시간",
          "wide": true,
          "from": "document",
          "read": "교육 시간 — 총 시간과 하루 시간표를 적힌 대로. 온라인 강의면 총 재생 시간이나 수업 수입니다.",
          "example": "3일 21시간(09:00~17:00)"
        },
        {
          "key": "topics",
          "label": "교육내용",
          "wide": true,
          "area": true,
          "max": 400,
          "from": "document",
          "read": "교육 내용 — 커리큘럼·주요 강의 주제를 \" · \" 로 나열합니다. 교육 내용(커리큘럼) 캡처가 함께 왔으면 그 장을 보고 적습니다.",
          "example": "DC-DC 컨버터 설계 · 제어 루프 설계 · 시뮬레이션 실습"
        },
        {
          "key": "attendees",
          "label": "참석자",
          "wide": true,
          "from": "me"
        },
        {
          "key": "purpose",
          "label": "교육목적",
          "wide": true,
          "open": true,
          "from": "document",
          "need": "교육목적",
          "read": "교육으로 무엇의 역량을 기르는지 짧은 구절로. 문서에 적혀 있으면 그대로, 없으면 교육 내용으로 보아 적습니다(사용자가 고칩니다).",
          "write": "교육 내용으로 보아 무엇의 역량을 기르는지 짧은 구절로(끝에 마침표 없이). 지금 적힌 교육목적이 있으면 그것을 다듬어 씁니다.",
          "example": "전력변환 회로 설계 역량 강화"
        },
        {
          "key": "reason",
          "label": "교육사유",
          "wide": true,
          "area": true,
          "open": true,
          "placeholder": "과제와 이어지는 필요성 — 비워 두지 않습니다",
          "from": "write",
          "need": "교육사유",
          "write": "이 교육이 과제 수행에 왜 필요한지 — 과제 내용과 이어지는 필요성을 1~2문장으로, \"…필요함\" 처럼 명사형으로 끝맺습니다.",
          "example": "과제의 MVDC 전력변환기 설계 역량 확보에 필요함"
        },
        {
          "key": "account",
          "label": "예산계정",
          "wide": true,
          "from": "setup"
        }
      ],
      "reads": [
        {
          "key": "supply",
          "type": "money",
          "read": "공급가액(부가세를 뺀 교육비) — 문서에 따로 적혀 있을 때만",
          "example": 409091
        },
        {
          "key": "vat",
          "type": "money",
          "read": "부가세 — 문서에 따로 적혀 있을 때만",
          "example": 40909
        }
      ],
      "reading": {
        "docs": "교육 안내문·교육 신청 확인서·교육비 견적서",
        "rules": [
          "교육 공문의 첨부는 교육 견적서와 교육 내용 둘입니다. parts 에서 견적서는 quote, 청구서는 statement, 수강료·결제 칸만 있는 장은 order 이고, 교육 안내·강의 소개·커리큘럼·수업 목록이 든 장은 content 입니다."
        ]
      },
      "quote_crop": {
        "when": "견적서 양식 없이 온라인 강의·교육 신청 화면(인프런·유데미 같은 강의 페이지)을 캡처한 그림일 때 — 수강료가 보이지 않는 화면이면 null",
        "keep": [
          "수강료(정가·할인가·결제 금액)",
          "강의명",
          "교육기관",
          "수강 기간",
          "수강 옵션"
        ],
        "drop": [
          "강의 소개 글",
          "커리큘럼",
          "수강평",
          "추천 강의",
          "광고",
          "메뉴"
        ],
        "read": "가격 글자가 잘리지 않게 넉넉히 잡습니다. 그 칸이 두 장에 걸쳐 있으면 장마다 한 줄씩 위에서 아래 차례로 적습니다."
      },
      "writing": {
        "context": "교육명: {교육명}\n교육기관: {교육기관?}\n교육 내용: {교육내용?}\n지금 적힌 교육목적: {교육목적?}",
        "rules": []
      },
      "template": {
        "title": "{과제별명} 수행을 위한 {교육구분} 품의",
        "body": "1. {부서:은} {과제개요}.\n2. 이와 관련하여 {교육목적:을} 위하여 아래와 같이 {교육구분:에} 참가하고자 하오니 재가하여 주시기 바랍니다.\n\n------------ 아   래 ------------\n\n{차례}. 과제 개요\n    {세부차례} 과 제 명 : {과제명}\n    {세부차례} 과제번호 : {과제번호?}\n    {세부차례} 연구기간 : {연구기간?}\n    {세부차례} 과제책임자 : {과제책임자?}\n{차례}. 교육 내용\n    {세부차례} 교 육 명 : {교육명}\n    {세부차례} 교육기관 : {교육기관}\n    {세부차례} 교육기간 : {교육기간}\n    {세부차례} 교육시간 : {교육시간?}\n    {세부차례} 교육장소 : {교육장소}\n    {세부차례} 교육내용 : {교육내용?}\n    {세부차례} 참 석 자 : {참석자}\n    {세부차례} 교 육 비 : {교육비} (VAT 포함)\n    {세부차례} 예산계정 : {계정}\n    {세부차례} 교육사유 : {교육사유}\n\n※ 첨 부\n{첨부}"
      },
      "vars": {
        "교육구분": {
          "from": "mode",
          "desc": "교육 또는 온라인교육 — 교육 구분 칸(교육장소가 온라인이면 저절로)"
        },
        "교육명": {
          "from": "course",
          "desc": "교육명"
        },
        "교육기관": {
          "from": "provider",
          "desc": "교육기관"
        },
        "교육기간": {
          "from": [
            "from",
            "to"
          ],
          "show": "period",
          "desc": "시작일 ~ 종료일(며칠) — 2026. 11. 3. ~ 2026. 11. 5. (3일), 하루면 2026. 11. 3. (1일)"
        },
        "교육시간": {
          "from": "hours",
          "desc": "교육시간"
        },
        "교육장소": {
          "from": "place",
          "desc": "교육장소"
        },
        "교육내용": {
          "from": "topics",
          "desc": "교육 내용(커리큘럼)"
        },
        "참석자": {
          "from": "attendees",
          "or": "me",
          "desc": "참석자(비면 내 이름)"
        },
        "교육비": {
          "from": "fee",
          "show": "won",
          "desc": "교육비 — 450",
          "000원": null
        },
        "교육목적": {
          "from": "purpose",
          "desc": "교육목적"
        },
        "교육사유": {
          "from": "reason",
          "desc": "교육사유(과제 내용으로 쓴다)"
        }
      },
      "lists": {},
      "attach": {
        "doc": "교육 견적서",
        "ask": "교육 견적서·교육 내용을 넣으세요",
        "more": "교육 내용(커리큘럼) 캡처 더 넣기",
        "need": [
          {
            "label": "교육 견적서",
            "more": "교육 견적서(수강료 화면) 더 넣기"
          },
          {
            "label": "교육 내용",
            "more": "교육 내용(커리큘럼) 캡처 더 넣기"
          }
        ],
        "parts": {
          "quote": "교육 견적서",
          "statement": "교육 견적서",
          "order": "교육 견적서",
          "course": "교육 내용",
          "content": "교육 내용",
          "event": "교육 내용",
          "other": "교육 내용"
        },
        "who": "provider"
      }
    },
    "trip": {
      "id": "trip",
      "form": "KR_EA_Research_Task",
      "label": "출장",
      "title": "출장품의",
      "rule_key": "출장",
      "amount_field": "cost",
      "document_setting": "연구품의",
      "limit": null,
      "account": "연구활동비(국내여비)",
      "fields": [
        {
          "key": "place",
          "label": "출장지",
          "wide": true,
          "from": "document",
          "need": "출장지",
          "read": "행사·회의가 열리는 도시와 기관 — \"도시(기관)\" 꼴로 적습니다.",
          "example": "대전(한국기계연구원)"
        },
        {
          "key": "from",
          "label": "시작일",
          "type": "date",
          "from": "document",
          "need": "출장기간",
          "read": "출장 시작일 — 행사·회의의 첫날. 참가 신청·등록 마감일과 헷갈리지 않습니다. 연도가 적혀 있지 않으면 문서 발행일(없으면 오늘)의 연도를 붙입니다.",
          "example": "2026-10-20"
        },
        {
          "key": "to",
          "label": "종료일",
          "type": "date",
          "from": "document",
          "not_before": "from",
          "read": "출장 종료일 — 행사·회의의 마지막 날. 하루짜리면 시작일과 같은 날입니다.",
          "example": "2026-10-21"
        },
        {
          "key": "who",
          "label": "출장자",
          "wide": true,
          "from": "me"
        },
        {
          "key": "cost",
          "label": "예상경비 (원)",
          "type": "money",
          "from": "document",
          "need": "예상경비",
          "read": "교통·숙박 견적서가 함께 있으면 그 합계(부가세 포함)입니다. 행사 안내문·초청장만 있으면 null 입니다.",
          "example": 300000
        },
        {
          "key": "division",
          "label": "출장 구분 (위임전결)",
          "type": "choice",
          "options": [
            "국내",
            "해외"
          ],
          "from": "user"
        },
        {
          "key": "purpose",
          "label": "출장목적",
          "wide": true,
          "open": true,
          "from": "document",
          "need": "출장목적",
          "read": "무엇을 하러 가는지 짧은 구절로. 문서에 적혀 있으면 그대로, 없으면 행사·회의명으로 \"○○ 참석\" 처럼 적습니다 — 비워 두지 않습니다.",
          "write": "무엇을 하러 가는지 짧은 구절로(끝에 마침표 없이). 지금 적힌 출장목적이 있으면 그것을 다듬어 씁니다.",
          "example": "2026 한국조선해양기자재 학회 참석 및 발표"
        },
        {
          "key": "reason",
          "label": "출장사유",
          "wide": true,
          "area": true,
          "open": true,
          "placeholder": "과제와 이어지는 필요성 — 비워 두지 않습니다",
          "from": "write",
          "need": "출장사유",
          "write": "이 출장이 과제 수행에 왜 필요한지 — 과제 내용과 이어지는 필요성을 1~2문장으로, \"…필요함\" 처럼 명사형으로 끝맺습니다.",
          "example": "과제의 실증 시험 결과를 확인하고 시험 조건을 협의하기 위해 필요함"
        },
        {
          "key": "account",
          "label": "예산계정",
          "wide": true,
          "from": "setup"
        }
      ],
      "reads": [],
      "reading": {
        "docs": "행사·회의·학회 안내문·초청장·출장 일정표·교통/숙박 견적서",
        "rules": []
      },
      "quote_crop": null,
      "writing": {
        "context": "출장지: {출장지}\n출장기간: {출장기간?}\n지금 적힌 출장목적: {출장목적?}",
        "rules": []
      },
      "template": {
        "title": "{과제별명} 수행을 위한 출장 품의",
        "body": "1. {부서:은} {과제개요}.\n2. 이와 관련하여 {출장목적:을} 위하여 아래와 같이 출장하고자 하오니 재가하여 주시기 바랍니다.\n\n------------ 아   래 ------------\n\n{차례}. 과제 개요\n    {세부차례} 과 제 명 : {과제명}\n    {세부차례} 과제번호 : {과제번호?}\n    {세부차례} 연구기간 : {연구기간?}\n    {세부차례} 과제책임자 : {과제책임자?}\n{차례}. 출장 내용\n    {세부차례} 출 장 지 : {출장지}\n    {세부차례} 출장기간 : {출장기간}\n    {세부차례} 출 장 자 : {출장자}\n    {세부차례} 출장목적 : {출장목적}\n    {세부차례} 출장사유 : {출장사유}\n    {세부차례} 예상경비 : {예상경비}\n    {세부차례} 예산계정 : {계정}\n\n※ 첨 부\n{첨부}"
      },
      "vars": {
        "출장지": {
          "from": "place",
          "desc": "출장지"
        },
        "출장기간": {
          "from": [
            "from",
            "to"
          ],
          "show": "period",
          "desc": "시작일 ~ 종료일(며칠) — 2026. 10. 20. ~ 2026. 10. 21. (2일), 하루면 2026. 10. 20. (1일)"
        },
        "출장자": {
          "from": "who",
          "or": "me",
          "desc": "출장자(비면 내 이름)"
        },
        "출장목적": {
          "from": "purpose",
          "desc": "출장목적"
        },
        "출장사유": {
          "from": "reason",
          "desc": "출장사유(과제 내용으로 쓴다)"
        },
        "예상경비": {
          "from": "cost",
          "show": "won",
          "desc": "예상경비 — 300",
          "000원": null
        }
      },
      "lists": {},
      "attach": {
        "doc": "행사 안내문",
        "ask": "행사·회의 안내문이나 초청장을 넣으세요",
        "more": "교통·숙박 견적서 더 넣기",
        "need": [],
        "parts": {
          "event": "행사 안내문",
          "course": "행사 안내문",
          "content": "행사 일정",
          "quote": "견적서",
          "statement": "청구서",
          "order": "예약 내역",
          "other": "참고 자료"
        },
        "who": "place"
      }
    },
    "outside": {
      "id": "outside",
      "form": "KR_EA_Research_Task",
      "label": "외부활동",
      "title": "외부활동 허가 신청서",
      "rule_key": "외부활동",
      "amount_field": null,
      "document_setting": "연구품의",
      "limit": null,
      "account": "",
      "fields": [
        {
          "key": "type",
          "label": "활동 구분 (제목)",
          "type": "choice",
          "options": [
            "강의",
            "자문",
            "심사·평가",
            "발표",
            "위원 활동",
            "집필",
            "기타"
          ],
          "from": "document",
          "read": "외부활동의 구분 — 강의·특강은 강의, 자문은 자문, 심사·평가위원은 심사·평가, 발표·강연은 발표, 위원회 위촉은 위원 활동, 집필·기고는 집필, 그 밖은 기타.",
          "example": "강의"
        },
        {
          "key": "org",
          "label": "요청 기관",
          "from": "document",
          "need": "요청 기관",
          "read": "활동을 요청한 기관·부서 — 공문의 발신 기관이나 메일을 보낸 곳의 이름 그대로.",
          "example": "부산대학교 조선해양공학과"
        },
        {
          "key": "subject",
          "label": "활동명 (주제)",
          "wide": true,
          "from": "document",
          "need": "활동명",
          "read": "활동명 — 강의 제목·자문 주제·심사 대상. 공문 본문에 들어가니 문서에 적힌 제목을 짧게 적습니다.",
          "example": "MVDC 차단기 기술 특강"
        },
        {
          "key": "from",
          "label": "시작일",
          "type": "date",
          "from": "document",
          "need": "활동기간",
          "read": "외부활동의 첫날. 연도가 적혀 있지 않으면 문서 발행일(없으면 오늘)의 연도를 붙입니다.",
          "example": "2026-11-05"
        },
        {
          "key": "to",
          "label": "종료일",
          "type": "date",
          "from": "document",
          "not_before": "from",
          "read": "외부활동의 마지막 날 — 하루면 시작일과 같은 날입니다.",
          "example": "2026-11-05"
        },
        {
          "key": "hours",
          "label": "활동시간",
          "from": "document",
          "read": "활동 시간 — 시각과 길이를 적힌 대로.",
          "example": "14:00~16:00 (2시간)"
        },
        {
          "key": "place",
          "label": "활동장소",
          "from": "document",
          "need": "활동장소",
          "read": "활동 장소 — 기관·건물·호실. 온라인이면 \"온라인\" 입니다.",
          "example": "부산대학교 공학관"
        },
        {
          "key": "fee",
          "label": "사례비 (원, 없으면 비움)",
          "type": "money",
          "from": "document",
          "read": "사례비·강사료·자문료 — 적혀 있으면 그 금액, 없으면 null 입니다.",
          "example": 300000
        },
        {
          "key": "topics",
          "label": "활동내용",
          "wide": true,
          "area": true,
          "max": 400,
          "from": "document",
          "read": "활동 내용 — 강의 주제·자문 사항·심사 대상을 \" · \" 로 나열합니다.",
          "example": "MVDC 차단기 개요 · 시험 결과"
        },
        {
          "key": "who",
          "label": "활동자",
          "wide": true,
          "from": "me"
        },
        {
          "key": "purpose",
          "label": "활동목적",
          "wide": true,
          "open": true,
          "from": "document",
          "need": "활동목적",
          "read": "그 활동이 과제·기관에 어떤 뜻인지 짧은 구절로. 문서에 적혀 있으면 그대로, 없으면 활동 내용으로 보아 적습니다(사용자가 고칩니다).",
          "write": "그 활동이 과제·기관에 어떤 뜻인지 짧은 구절로(끝에 마침표 없이). 지금 적힌 활동목적이 있으면 그것을 다듬어 씁니다.",
          "example": "부산대 특강을 통한 연구 성과 확산"
        },
        {
          "key": "reason",
          "label": "신청사유",
          "wide": true,
          "area": true,
          "open": true,
          "placeholder": "과제와 이어지는 필요성 — 비워 두지 않습니다",
          "from": "write",
          "need": "신청사유",
          "write": "그 활동(강의·자문·심사·발표·위원 활동)이 과제 수행이나 연구 성과의 확산·활용과 어떻게 이어지는지, 직무와 상충하지 않는지를 1~2문장으로, \"…필요함\"·\"…위함\" 처럼 명사형으로 끝맺습니다.",
          "example": "과제에서 얻은 MVDC 차단기 시험 성과를 학계에 확산하기 위함이며 직무와 상충하지 않음"
        }
      ],
      "reads": [],
      "reading": {
        "docs": "강의·자문·심사·발표·위원 위촉 요청 공문·초청장·요청 메일·행사 안내문",
        "rules": []
      },
      "quote_crop": null,
      "writing": {
        "context": "외부활동: {활동구분} — {활동명}\n요청 기관: {요청기관?}\n활동기간: {활동기간?}\n활동 내용: {활동내용?}\n지금 적힌 활동목적: {활동목적?}",
        "rules": []
      },
      "template": {
        "title": "{요청기관} {활동구분} 외부활동 허가 신청",
        "body": "1. {부서:은} {과제개요}.\n2. 이와 관련하여 {요청기관}의 요청으로 아래와 같이 외부활동({활동구분})을 하고자 하오니 허가하여 주시기 바랍니다.\n\n------------ 아   래 ------------\n\n{차례}. 과제 개요\n    {세부차례} 과 제 명 : {과제명}\n    {세부차례} 과제번호 : {과제번호?}\n    {세부차례} 연구기간 : {연구기간?}\n    {세부차례} 과제책임자 : {과제책임자?}\n{차례}. 외부활동 내용\n    {세부차례} 활동구분 : {활동구분}\n    {세부차례} 요청기관 : {요청기관}\n    {세부차례} 활 동 명 : {활동명}\n    {세부차례} 활동기간 : {활동기간}\n    {세부차례} 활동시간 : {활동시간?}\n    {세부차례} 활동장소 : {활동장소}\n    {세부차례} 활동내용 : {활동내용?}\n    {세부차례} 활 동 자 : {활동자}\n    {세부차례} 사 례 비 : {사례비?}\n    {세부차례} 활동목적 : {활동목적}\n    {세부차례} 신청사유 : {신청사유}\n\n※ 첨 부\n{첨부}"
      },
      "vars": {
        "활동구분": {
          "from": "type",
          "desc": "강의·자문·심사·평가·발표·위원 활동·집필·기타 — 활동 구분 칸"
        },
        "요청기관": {
          "from": "org",
          "desc": "요청 기관"
        },
        "활동명": {
          "from": "subject",
          "desc": "활동명(강의 제목·자문 주제)"
        },
        "활동기간": {
          "from": [
            "from",
            "to"
          ],
          "show": "period",
          "desc": "시작일 ~ 종료일(며칠) — 2026. 11. 5. (1일)"
        },
        "활동시간": {
          "from": "hours",
          "desc": "활동시간"
        },
        "활동장소": {
          "from": "place",
          "desc": "활동장소"
        },
        "활동내용": {
          "from": "topics",
          "desc": "활동 내용"
        },
        "활동자": {
          "from": "who",
          "or": "me",
          "desc": "활동자(비면 내 이름)"
        },
        "사례비": {
          "from": "fee",
          "show": "won",
          "desc": "사례비 — 300",
          "000원": null
        },
        "활동목적": {
          "from": "purpose",
          "desc": "활동목적"
        },
        "신청사유": {
          "from": "reason",
          "desc": "신청사유(과제 내용으로 쓴다)"
        }
      },
      "lists": {},
      "attach": {
        "doc": "요청 공문",
        "ask": "외부활동 요청 공문·메일(강의·자문·심사·발표 의뢰)을 넣으세요",
        "more": "행사 안내·일정표 더 넣기",
        "need": [],
        "parts": {
          "request": "요청 공문",
          "event": "행사 안내문",
          "course": "행사 안내문",
          "content": "활동 자료",
          "quote": "견적서",
          "statement": "청구서",
          "order": "예약 내역",
          "other": "참고 자료"
        },
        "who": "org"
      }
    }
  },
  "delegation": {
    "ranks": [
      "팀장",
      "소장",
      "본부장"
    ],
    "rules": {
      "연구비집행": {
        "label": "국가R&D 연구비 집행",
        "basis": "amount",
        "steps": [
          {
            "max": 20000000,
            "approver": "팀장"
          },
          {
            "max": null,
            "approver": "소장"
          }
        ],
        "source": "QI-01K Rev164 45절 연구수행 — 국가R&D 연구비 집행 : 2천만원 이하 팀장 · 2천만원 초과 소장"
      },
      "출장": {
        "label": "출장",
        "basis": "division",
        "division_field": "division",
        "divisions": {
          "국내": "팀장",
          "해외": "본부장"
        },
        "source": "구본 ea_rules.yaml 출장(국내 팀장 · 해외 본부장, 확정) — krs-web-agents ea_approval 규정 키 출장"
      },
      "외부활동": {
        "label": "외부활동 허가",
        "basis": "none",
        "approver": "팀장",
        "source": "QI-01K 45절에 행 없음 — 부서장 결재(이 확장의 기존 결재선, 2026-10-08). 규정 행을 찾으면 여기를 고친다"
      }
    }
  },
  "settings": {
    "defaults": {
      "retention": "120",
      "doc_no": "team",
      "receiver": "내부결재",
      "scope": "결재선",
      "emergency": false,
      "approving_open": false,
      "drm": false,
      "tag": ""
    },
    "profiles": {
      "연구품의": {}
    },
    "teams": {
      "수소전기추진연구팀": "8100",
      "대체연료기술연구팀": "7600",
      "시스템안전연구팀": "7700",
      "연구지원팀": "7800",
      "자율운항선박연구팀": "8200"
    },
    "doc_no_options": {
      "1000": "Quality Management Team",
      "1100": "Audit Team",
      "1200": "International Relations Team",
      "2100": "Planning & Coordination Team",
      "2200": "Strategy Team",
      "2300": "Legal Affairs Team",
      "2400": "Human Resource Management Team",
      "2500": "Finance Team",
      "2600": "General Affairs Team",
      "2700": "Education Team",
      "2800": "External Affairs and PR Team",
      "2900": "Academy Business Team",
      "3000": "Survey Team",
      "3100": "Class Register and Record Team",
      "3200": "GAS Carrier Survey Technology Team",
      "4000": "Hull Technology Team 2",
      "4100": "Hull Technology Team 1",
      "4200": "Stability & Tonnage Team",
      "4300": "Machinery & Piping Team 1",
      "4400": "Digital Solutions Team",
      "4500": "Machinery & Piping Team 2",
      "4600": "Certification of Material & Components Team",
      "4700": "Hull Rule Development Team",
      "4800": "Machinery Rule Development Team",
      "4900": "Technology Planning Team",
      "5000": "Domestic Business Development Team",
      "5100": "Technical Business Development Team",
      "5200": "Overseas Business Development Team",
      "5300": "Management System Certification Center",
      "5301": "North Europe TFT",
      "5400": "Conformity Assessment Center",
      "5500": "Academy Center",
      "5600": "Naval Business Planning Team",
      "5700": "Naval Vessel Technology Team",
      "5800": "Naval Vessel Survey Team",
      "5900": "Wind Energy Business Team",
      "6000": "Statutory Service Team",
      "6100": "Convention & Legislation Service Team",
      "6200": "Statutory System Certification  Team",
      "7000": "AI Technology Development Team",
      "7100": "ICT Solution Team",
      "7200": "Advanced Technology Convergence Team",
      "7300": "DT System Development Team",
      "7400": "Green Ship Technology Team",
      "7500": "Ship & Offshore Technology Team",
      "7600": "Alternative Fuel Technology Research Team",
      "7700": "System Safety Research Team",
      "7800": "R&D Support Team",
      "7900": "Maritime Autonomous Surface Ships TFT",
      "8000": "Common",
      "8100": "Hydrogen & Electric Propulsion Research Team",
      "8200": "Autonomous Ship Research Team",
      "8900": "KR Hellas Ltd. Administrative Team",
      "8901": "KR Hellas Ltd. Quality Management Team",
      "8902": "KR Hellas Ltd. TechnicalCertification Team",
      "8903": "KRH Product Certification Team",
      "8904": "KRH Boiler and Pressure Vessel Team",
      "8905": "KRH System Certificate Team",
      "9100": "Employee Welfare Fund",
      "9200": "MAZ Mutual Aid Society",
      "9300": "KR Brunei",
      "9400": "BFA System TFT",
      "9500": "Occupational Health & Safety Team"
    },
    "options": {
      "retention": {
        "12": "1년",
        "24": "2년",
        "36": "3년",
        "60": "5년",
        "120": "10년",
        "240": "20년",
        "1200": "영구"
      },
      "scope": {
        "결재선": "YNN",
        "기안부서": "NNY"
      },
      "receiver": [
        "내부결재",
        "KRE"
      ]
    }
  },
  "vars": {
    "부서": "공문 설정의 부서",
    "기안자": "내 이름",
    "과제명": "고른 과제",
    "과제별명": "고른 과제의 별명 — 제목에 쓴다(비면 과제명)",
    "과제번호": "고른 과제의 번호",
    "연구기간": "고른 과제의 연구기간 — 과제에 적힌 그대로",
    "과제책임자": "고른 과제의 책임자(합의자)",
    "과제개요": "과제 개요(비면 「과제명」 과제를 수행하고 있습니다)",
    "계정": "계정 — 초안의 계정 칸, 비면 과제의 계정, 그것도 없으면 갈래의 기본 계정",
    "오늘": "오늘 날짜 — 2026. 10. 9.",
    "첨부": "첨부 목록 — 읽은 문서마다 한 줄, 마지막 줄에 끝."
  },
  "docNames": {
    "quote": "견적서",
    "statement": "거래명세서",
    "order": "주문 화면",
    "course": "교육 안내문",
    "event": "행사 안내문",
    "request": "요청 공문",
    "other": "문서",
    "unknown": "문서"
  },
  "tasks": {
    "gongmunSetup": {
      "title": "공문 공문 설정(과제·과제책임자·과제 별명·연구기간·부서장·참조자) 조각",
      "kinds": [
        "gongmun"
      ],
      "partial": true,
      "consumer": {
        "module": "src/gongmun.js",
        "export": "mergeSetup"
      },
      "next": "src/gongmun.js mergeSetup 이 공문 설정에 얹는다 → 사용자가 공문 설정 칸에서 확인한다(저장은 패널이 한다)",
      "role": "당신은 전자결재 품의 작성 도우미입니다. 사용자가 붙여 넣은 글(과제 목록 표를 복사한 것, 메모, 문장)에서 품의의 공문 설정에 넣을 값을 뽑습니다. 입력에는 지금 등록된 공문 설정(JSON)과 새 글이 들어 있습니다.",
      "fields": {
        "projects": {
          "type": "list",
          "desc": "과제. 글에 나온 과제마다 한 줄 — 과제가 나오지 않았으면 null",
          "max": 10,
          "item": {
            "name": {
              "type": "string",
              "desc": "과제명(글에 적힌 그대로 — 전자결재 과제 찾기에 그대로 쓴다). 예: MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발",
              "required": true,
              "max": 200
            },
            "code": {
              "type": "string",
              "desc": "과제번호. 예: RND-20-2026",
              "max": 40
            },
            "lead": {
              "type": "string",
              "desc": "과제책임자 이름 — 품의의 합의자가 된다. 예: 박기도",
              "max": 40
            },
            "alias": {
              "type": "string",
              "desc": "과제 별명(약칭·줄임말) — 글에 \"별명\"·\"약칭\" 으로 적혀 있을 때만. 교육·출장 품의 제목 \"<별명> 수행을 위한 … 품의\" 에 들어간다. 예: 차단기 과제",
              "max": 60
            },
            "period": {
              "type": "string",
              "desc": "연구기간 — 글에 적힌 그대로. 본문 과제 개요에 들어간다. 예: 2026.04.01 ~ 2029.12.31",
              "max": 60
            },
            "about": {
              "type": "string",
              "desc": "과제 개요 — 글에 과제의 목적이 적혀 있을 때만. \"…을 수행하고 있습니다\" 로 끝나는 한 구절(본문 첫 줄에 들어간다)",
              "max": 300
            },
            "content": {
              "type": "string",
              "desc": "과제 내용 — 연구목표·연구내용·과제 설명을 글에 적힌 그대로(품의 사유를 쓰는 근거가 된다)",
              "max": 3000
            }
          }
        },
        "dept": {
          "type": "string",
          "desc": "기안 부서. 예: 연구본부 수소전기추진연구팀",
          "max": 100
        },
        "lead": {
          "type": "string",
          "desc": "과제를 말하지 않고 과제책임자(합의자)만 적었을 때 그 이름 — 입력의 \"지금 고른 과제\"의 합의자가 된다",
          "max": 40
        },
        "content": {
          "type": "string",
          "desc": "과제를 말하지 않고 과제 내용(연구목표·연구내용)만 붙여 넣었을 때 그 글 — 입력의 \"지금 고른 과제\"의 내용이 된다",
          "max": 3000
        },
        "alias": {
          "type": "string",
          "desc": "과제를 말하지 않고 과제 별명만 적었을 때 그 별명 — 입력의 \"지금 고른 과제\"의 별명이 된다",
          "max": 60
        },
        "period": {
          "type": "string",
          "desc": "과제를 말하지 않고 연구기간만 적었을 때 그 기간 — 입력의 \"지금 고른 과제\"의 연구기간이 된다",
          "max": 60
        },
        "head": {
          "type": "string",
          "desc": "부서장 이름(품의의 결재자). 예: 노길태",
          "max": 40
        },
        "refs": {
          "type": "string",
          "desc": "참조자 이름들 — 쉼표로 나눈 전체 목록. 예: 홍길동, 이몽룡",
          "max": 300
        },
        "reply": {
          "type": "string",
          "desc": "무엇을 채웠는지 한국어 한 문장",
          "max": 300
        }
      },
      "rules": [
        "글에 적힌 것만 채웁니다. 적혀 있지 않은 값은 null 이고, 추측하거나 지어내지 않습니다.",
        "사람 칸(lead·head·refs)에는 이름만 적습니다 — 직급·직책(수석·책임·선임·팀장·PI 등)과 존칭은 뗍니다(\"박기도 책임\" → \"박기도\").",
        "\"책임자\"·\"연구책임자\"·\"과제책임자\"·\"PI\"·\"합의자\"·\"합의\" 로 적힌 사람은 그 과제의 lead 입니다. \"부서장\"·\"팀장\"·\"결재\" 로 적힌 사람은 head, \"참조\" 로 적힌 사람들은 refs 입니다.",
        "표를 복사한 글이면 줄마다 과제 하나입니다. 과제명·과제번호·책임자 칸을 가려 넣고, 머리글 줄(과제명·책임자 같은 제목만 있는 줄)은 과제가 아닙니다.",
        "지금 등록된 과제와 이름(또는 번호)이 같은 과제는 같은 과제입니다 — 그 과제의 이름을 그대로 적고 바뀐 칸만 채웁니다.",
        "refs 는 참조자 전체 목록입니다. 지금 등록된 참조자에 더하라고 했으면 그들도 함께 적고, 바꾸라고 했으면 새 목록만 적습니다.",
        "과제는 열 개까지 등록합니다. 글에 그보다 많으면 처음 열 개만 적고 reply 에 그 사실을 적습니다.",
        "과제를 말하지 않고 \"합의자 ○○○\"·\"책임자 ○○○\" 처럼 사람만 적었으면 projects 는 null 이고 lead 에 그 이름을 적습니다. 과제를 말했으면 lead 는 null 입니다(그 과제 줄의 lead 에 적습니다).",
        "과제 내용(연구목표·연구내용·과제 설명)은 요약하지 않고 글에 적힌 그대로 content 에 옮깁니다. 과제를 말했으면 그 과제 줄의 content 에, 과제 없이 내용만 붙여 넣었으면 바깥 content 에 적습니다.",
        "\"별명\"·\"약칭\"·\"줄여서\" 로 적힌 짧은 이름은 alias, \"연구기간\"·\"과제기간\"·\"기간\" 으로 적힌 기간은 period 입니다. 과제명을 줄여 별명을 지어내지 않습니다. 과제를 말했으면 그 과제 줄에, 과제 없이 적었으면 바깥 alias·period 에 적습니다.",
        "reply 에는 무엇을 채웠는지만 한 문장으로 적습니다(\"과제 2개와 합의자를 채웠습니다\")."
      ]
    },
    "gongmun.purchase": {
      "title": "구매품의에 넣을 문서 읽기 — 견적서·거래명세서·쇼핑몰 주문 화면",
      "kinds": [
        "purchase"
      ],
      "consumer": {
        "module": "src/gongmun.js",
        "export": "fromRecord"
      },
      "next": "src/gongmun.js fromRecord 가 초안으로 바꾼다 → 사용자가 과제를 고르고 칸을 고친다 → compose 가 틀에 넣어 제목·본문을 만든다",
      "role": "당신은 사내 연구부서의 전자결재 품의 작성 도우미입니다. 첨부한 문서(견적서·거래명세서·쇼핑몰 주문 화면 등의 이미지나 PDF) 또는 붙여 넣은 글을 읽어 구매품의에 넣을 값을 뽑습니다.",
      "fields": {
        "docType": {
          "type": "enum",
          "desc": "문서 종류. quote(견적서)·statement(거래명세서·청구서·인보이스)·order(쇼핑몰 주문서·장바구니·상품 화면)·course(교육 안내문·교육 신청 확인서)·event(행사·회의·학회 안내문·초청장·출장 일정표)·request(강의·자문·심사·발표·위원 위촉 등 외부활동 요청 공문·요청 메일)·other(그 밖)·unknown(모름)",
          "required": true,
          "values": [
            "quote",
            "statement",
            "order",
            "course",
            "event",
            "request",
            "other",
            "unknown"
          ]
        },
        "gist": {
          "type": "string",
          "desc": "공문 제목에 들어갈 짧은 품목 이름. 대표 품목을 짧게 적고(모델 번호는 빼도 됩니다), 품목이 둘 이상이면 \"대표 품목 외 N건\" 으로 적습니다. 예: 34인치 모니터 외 1건",
          "max": 200
        },
        "vendor": {
          "type": "string",
          "desc": "견적을 낸 업체·판매처 — 상호 그대로. 쇼핑몰 화면이면 판매자이고, 판매자가 없으면 쇼핑몰 이름입니다. 예: (주)OO상사",
          "max": 200
        },
        "total": {
          "type": "number",
          "desc": "부가세를 포함한 최종 합계(결제·청구할 금액). 할인이 있으면 할인을 뺀 금액입니다. 문서에 \"부가세 별도\" 이고 합계가 공급가액뿐이면 null 로 두고 supply 에 적습니다 — 셈해 넣지 않습니다. 예: 989000",
          "min": 0
        },
        "use": {
          "type": "string",
          "desc": "공문 용도 칸의 초안 — 품목의 쓰임을 짧은 구절로. 문서에 적혀 있으면 그대로, 없으면 품목으로 보아 연구부서에서 흔히 쓰는 쓰임을 적습니다 (사용자가 고칩니다). 사유는 여기서 쓰지 않습니다. 예: 연구 데이터 저장·백업용",
          "max": 200
        },
        "items": {
          "type": "list",
          "desc": "품목. 문서의 품목 표를 적힌 차례대로 한 줄씩 옮깁니다. 배송비·설치비처럼 따로 적힌 줄도 품목으로 넣습니다.",
          "max": 30,
          "item": {
            "name": {
              "type": "string",
              "desc": "품목명·모델명 — 문서에 적힌 그대로(요약하지 않습니다). 예: LG 34WQ75C 34인치 모니터",
              "required": true,
              "max": 200
            },
            "spec": {
              "type": "string",
              "desc": "규격·사양 — 문서에 적힌 핵심을 ' · ' 로 나열. 예: WQHD · 커브드 · USB-C",
              "max": 300
            },
            "qty": {
              "type": "number",
              "desc": "수량. 예: 1",
              "min": 0
            },
            "unit": {
              "type": "string",
              "desc": "단위(개·대·EA·식 등). 예: 대",
              "max": 10
            },
            "unitPrice": {
              "type": "number",
              "desc": "단가. 예: 890000",
              "min": 0
            },
            "amount": {
              "type": "number",
              "desc": "그 줄의 금액 — 문서에 적힌 그대로. 예: 890000",
              "min": 0
            }
          }
        },
        "quoteDate": {
          "type": "date",
          "desc": "견적일·발행일·주문일. 쇼핑몰 화면이면 주문일이고, 주문 전 장바구니·상품 화면이면 null 입니다. 예: 2026-10-01"
        },
        "supply": {
          "type": "number",
          "desc": "공급가액 합계(부가세를 뺀 금액) — 문서에 따로 적혀 있을 때만. 예: 899091",
          "min": 0
        },
        "vat": {
          "type": "number",
          "desc": "부가세 합계 — 문서에 따로 적혀 있을 때만. 예: 89909",
          "min": 0
        },
        "quoteArea": {
          "type": "list",
          "desc": "견적서로 오릴 칸. 가격과 그 둘레가 함께 든 칸을 그림마다 한 줄, 그림의 % 로 적습니다 — 이 칸을 오려 공문의 견적서로 첨부합니다. 첨부한 문서에 견적서·거래명세서 양식이 있거나, 가격이 든 것이 PDF 이거나, 글만 붙여 넣었으면 null 입니다. 오리는 때: 첨부한 그림이 견적서·거래명세서 양식이 아니라 쇼핑몰 상품·장바구니·주문 화면처럼 가격이 화면 일부에만 있는 캡처일 때. 오린 칸에 꼭 들어갈 것: 상품명·모델·옵션·수량·단가·할인·배송비·합계·판매자. 넣지 않을 것: 추천 상품·광고·리뷰·상품 상세 설명·메뉴. 가격 글자가 잘리지 않게 넉넉히 잡습니다. 그 칸이 두 장에 걸쳐 있으면 장마다 한 줄씩 위에서 아래 차례로 적습니다.",
          "max": 4,
          "item": {
            "file": {
              "type": "string",
              "desc": "그림 파일 이름(입력에 적힌 그대로)",
              "required": true,
              "max": 200
            },
            "left": {
              "type": "number",
              "desc": "칸의 왼쪽 끝 — 그림 폭의 %(0 이 왼쪽 끝)",
              "required": true,
              "min": 0,
              "max": 100
            },
            "top": {
              "type": "number",
              "desc": "칸의 위쪽 끝 — 그림 높이의 %(0 이 맨 위)",
              "required": true,
              "min": 0,
              "max": 100
            },
            "right": {
              "type": "number",
              "desc": "칸의 오른쪽 끝 — 그림 폭의 %(100 이 오른쪽 끝)",
              "required": true,
              "min": 0,
              "max": 100
            },
            "bottom": {
              "type": "number",
              "desc": "칸의 아래쪽 끝 — 그림 높이의 %(100 이 맨 아래)",
              "required": true,
              "min": 0,
              "max": 100
            }
          }
        },
        "currency": {
          "type": "enum",
          "desc": "금액의 화폐(ISO 세 글자 코드). 예: KRW",
          "values": [
            "KRW",
            "USD",
            "EUR",
            "JPY",
            "CNY",
            "GBP"
          ]
        },
        "parts": {
          "type": "list",
          "desc": "파일. 첨부한 파일마다 무슨 문서인지 — 공문의 첨부 목록이 된다. 글만 붙여 넣었으면 null",
          "max": 10,
          "item": {
            "file": {
              "type": "string",
              "desc": "파일 이름(입력에 적힌 그대로)",
              "required": true,
              "max": 200
            },
            "kind": {
              "type": "enum",
              "desc": "quote(견적서)·statement(거래명세서·청구서)·order(주문 화면·예약 내역)·course(교육 안내문·신청 확인서)·content(교육 내용·커리큘럼·강의 계획·행사 일정·외부활동 자료)·event(행사·회의·학회 안내문·초청장)·request(외부활동 요청 공문·요청 메일·위촉장)·other(그 밖)",
              "required": true,
              "values": [
                "quote",
                "statement",
                "order",
                "course",
                "content",
                "event",
                "request",
                "other"
              ]
            }
          }
        },
        "summary": {
          "type": "string",
          "desc": "무엇의 어떤 문서인지 한국어 한 줄. 예: OO상사 모니터 외 1건 견적서 989,000원",
          "required": true,
          "max": 200
        }
      },
      "rules": [
        "문서에 적힌 것만 채웁니다. 적혀 있지 않은 값은 null 이고, 추측하거나 지어내지 않습니다. 키의 설명이 \"없으면 … 적습니다\" 라고 한 키만 예외입니다.",
        "금액은 쉼표·통화 기호 없이 숫자만 적습니다. 날짜는 YYYY-MM-DD 입니다.",
        "첨부한 파일이 여러 개면 같은 건의 문서들입니다(견적서 여러 쪽, 견적서와 교육 내용 캡처 등). 값은 모두를 함께 보고 채우고, parts 에 파일마다 무슨 문서인지 적습니다.",
        "품의에 넣을 문서가 아닌 화면(결재 화면·이 프로그램의 화면·메일 목록 등)이면 docType 은 unknown 이고 나머지 값은 null 이며, summary 에 무슨 화면인지 적습니다.",
        "구매라도 강의(온라인 강의·교육 상품)를 사는 화면이면 parts 에서 강의 소개·커리큘럼·수업 목록이 든 장은 content 입니다 — 오린 견적서와 함께 강의 내용으로 첨부합니다. 가격·결제 칸만 있는 장은 order 입니다."
      ]
    },
    "gongmunReason.purchase": {
      "title": "구매품의의 용도·구매사유 쓰기",
      "kinds": [
        "purchase"
      ],
      "consumer": {
        "module": "src/gongmun.js",
        "export": "applyReason"
      },
      "next": "src/gongmun.js applyReason 이 초안의 칸에 넣는다 → 사용자가 고친다 → compose 가 본문에 넣는다",
      "role": "당신은 연구부서의 전자결재 품의 작성 도우미입니다. 입력의 과제 정보(과제명·과제 내용)와 품의할 것을 보고 구매품의 본문에 들어갈 다음 칸을 공문체로 씁니다: 용도·구매사유. 입력에 사용자의 말이 있으면 그 요청대로 고쳐 씁니다.",
      "fields": {
        "use": {
          "type": "string",
          "desc": "품목의 쓰임을 짧은 구절로(끝에 마침표 없이). 지금 적힌 용도가 있으면 그것을 다듬어 씁니다. 예: 연구 데이터 저장·백업용",
          "max": 200
        },
        "reason": {
          "type": "string",
          "desc": "이 품목이 과제 수행에 왜 필요한지 — 과제 내용과 이어지는 필요성을 1~2문장으로, \"…필요함\" 처럼 명사형으로 끝맺습니다. 예: 과제의 MVDC 차단기 시험 데이터 저장·분석에 필요함",
          "required": true,
          "max": 1000
        },
        "reply": {
          "type": "string",
          "desc": "사용자의 말이 있을 때 무엇을 어떻게 고쳤는지(또는 왜 못 고쳤는지) 한 줄. 사용자의 말이 없으면 null",
          "max": 300
        }
      },
      "rules": [
        "과제 내용이 R&D 탭의 연구 내용이면 그 차년도의 연구개발 계획(개발목표·개발내용·성능목표·주요결과물·수행일정)과 진행 기록입니다. 그 가운데 품의할 것과 이어지는 목표·내용·결과물을 골라 사유의 근거로 삼습니다.",
        "입력에 \"사용자의 말\"이 있으면 그 요청대로 사유와 용도를 고쳐 씁니다 — 지금 적힌 사유가 있으면 그것을 바탕으로 합니다. 요청이 사유·용도와 무관하면 지금 적힌 것을 그대로 돌려주고 reply 에 그렇게 적습니다. 요청이어도 과제 내용에 없는 과업·수치는 지어내지 않습니다.",
        "사유는 과제 내용에 적힌 연구목표·연구내용을 근거로 씁니다. 과제 내용에 없는 연구 과업·수치·일정을 지어내지 않습니다.",
        "과제 내용이 비었거나 품의할 것과 이어지는 대목이 없으면, 과제명과 품의할 것 자체의 쓰임만으로 일반적인 필요성을 씁니다.",
        "공문체로 씁니다 — 문장을 \"…필요함\"·\"…위함\" 처럼 명사형으로 끝맺고, 경어·구어(\"합니다\", \"해요\")를 쓰지 않습니다.",
        "금액·업체·날짜는 사유에 넣지 않습니다(본문의 다른 줄에 있습니다)."
      ]
    },
    "gongmun.edu": {
      "title": "교육품의에 넣을 문서 읽기 — 교육 안내문·교육 신청 확인서·교육비 견적서",
      "kinds": [
        "edu"
      ],
      "consumer": {
        "module": "src/gongmun.js",
        "export": "fromRecord"
      },
      "next": "src/gongmun.js fromRecord 가 초안으로 바꾼다 → 사용자가 과제를 고르고 칸을 고친다 → compose 가 틀에 넣어 제목·본문을 만든다",
      "role": "당신은 사내 연구부서의 전자결재 품의 작성 도우미입니다. 첨부한 문서(교육 안내문·교육 신청 확인서·교육비 견적서 등의 이미지나 PDF) 또는 붙여 넣은 글을 읽어 교육품의에 넣을 값을 뽑습니다.",
      "fields": {
        "docType": {
          "type": "enum",
          "desc": "문서 종류. quote(견적서)·statement(거래명세서·청구서·인보이스)·order(쇼핑몰 주문서·장바구니·상품 화면)·course(교육 안내문·교육 신청 확인서)·event(행사·회의·학회 안내문·초청장·출장 일정표)·request(강의·자문·심사·발표·위원 위촉 등 외부활동 요청 공문·요청 메일)·other(그 밖)·unknown(모름)",
          "required": true,
          "values": [
            "quote",
            "statement",
            "order",
            "course",
            "event",
            "request",
            "other",
            "unknown"
          ]
        },
        "course": {
          "type": "string",
          "desc": "교육 과정의 이름 — 안내문·신청 확인서·견적서에 적힌 그대로(회차·기수 표시도 그대로). 예: 전력변환 설계 실무(3기)",
          "max": 200
        },
        "provider": {
          "type": "string",
          "desc": "교육을 여는 기관·업체 — 상호 그대로. 온라인 강의면 강의 플랫폼 이름입니다. 예: 한국전력기술교육원",
          "max": 200
        },
        "fee": {
          "type": "number",
          "desc": "부가세를 포함해 실제로 낼 교육비 — 할인을 뺀 결제 금액. \"부가세 별도\" 이고 공급가액만 있으면 null 로 두고 supply 에 적습니다 — 셈해 넣지 않습니다. 예: 450000",
          "min": 0
        },
        "from": {
          "type": "date",
          "desc": "교육이 실제로 열리는 첫날. 신청 마감일·결제일·수강 가능 기한(\"수강기한 90일\")과 헷갈리지 않습니다. 연도가 적혀 있지 않으면 문서 발행일(없으면 오늘)의 연도를 붙입니다. 날짜 없이 언제든 듣는 온라인 강의면 null 입니다. 예: 2026-11-03"
        },
        "to": {
          "type": "date",
          "desc": "교육의 마지막 날. 하루짜리 교육이면 시작일과 같은 날입니다. 예: 2026-11-05"
        },
        "place": {
          "type": "string",
          "desc": "교육이 열리는 곳 — 도시와 기관·강의실. 온라인 강의면 \"온라인\", 실시간 화상 교육이면 \"온라인(Zoom)\" 처럼 적습니다. 예: 대전 한국전력기술교육원",
          "max": 200
        },
        "hours": {
          "type": "string",
          "desc": "교육 시간 — 총 시간과 하루 시간표를 적힌 대로. 온라인 강의면 총 재생 시간이나 수업 수입니다. 예: 3일 21시간(09:00~17:00)",
          "max": 200
        },
        "topics": {
          "type": "string",
          "desc": "교육 내용 — 커리큘럼·주요 강의 주제를 \" · \" 로 나열합니다. 교육 내용(커리큘럼) 캡처가 함께 왔으면 그 장을 보고 적습니다. 예: DC-DC 컨버터 설계 · 제어 루프 설계 · 시뮬레이션 실습",
          "max": 400
        },
        "purpose": {
          "type": "string",
          "desc": "교육으로 무엇의 역량을 기르는지 짧은 구절로. 문서에 적혀 있으면 그대로, 없으면 교육 내용으로 보아 적습니다(사용자가 고칩니다). 예: 전력변환 회로 설계 역량 강화",
          "max": 200
        },
        "supply": {
          "type": "number",
          "desc": "공급가액(부가세를 뺀 교육비) — 문서에 따로 적혀 있을 때만. 예: 409091",
          "min": 0
        },
        "vat": {
          "type": "number",
          "desc": "부가세 — 문서에 따로 적혀 있을 때만. 예: 40909",
          "min": 0
        },
        "quoteArea": {
          "type": "list",
          "desc": "견적서로 오릴 칸. 가격과 그 둘레가 함께 든 칸을 그림마다 한 줄, 그림의 % 로 적습니다 — 이 칸을 오려 공문의 견적서로 첨부합니다. 첨부한 문서에 견적서·거래명세서 양식이 있거나, 가격이 든 것이 PDF 이거나, 글만 붙여 넣었으면 null 입니다. 오리는 때: 견적서 양식 없이 온라인 강의·교육 신청 화면(인프런·유데미 같은 강의 페이지)을 캡처한 그림일 때 — 수강료가 보이지 않는 화면이면 null. 오린 칸에 꼭 들어갈 것: 수강료(정가·할인가·결제 금액)·강의명·교육기관·수강 기간·수강 옵션. 넣지 않을 것: 강의 소개 글·커리큘럼·수강평·추천 강의·광고·메뉴. 가격 글자가 잘리지 않게 넉넉히 잡습니다. 그 칸이 두 장에 걸쳐 있으면 장마다 한 줄씩 위에서 아래 차례로 적습니다.",
          "max": 4,
          "item": {
            "file": {
              "type": "string",
              "desc": "그림 파일 이름(입력에 적힌 그대로)",
              "required": true,
              "max": 200
            },
            "left": {
              "type": "number",
              "desc": "칸의 왼쪽 끝 — 그림 폭의 %(0 이 왼쪽 끝)",
              "required": true,
              "min": 0,
              "max": 100
            },
            "top": {
              "type": "number",
              "desc": "칸의 위쪽 끝 — 그림 높이의 %(0 이 맨 위)",
              "required": true,
              "min": 0,
              "max": 100
            },
            "right": {
              "type": "number",
              "desc": "칸의 오른쪽 끝 — 그림 폭의 %(100 이 오른쪽 끝)",
              "required": true,
              "min": 0,
              "max": 100
            },
            "bottom": {
              "type": "number",
              "desc": "칸의 아래쪽 끝 — 그림 높이의 %(100 이 맨 아래)",
              "required": true,
              "min": 0,
              "max": 100
            }
          }
        },
        "currency": {
          "type": "enum",
          "desc": "금액의 화폐(ISO 세 글자 코드). 예: KRW",
          "values": [
            "KRW",
            "USD",
            "EUR",
            "JPY",
            "CNY",
            "GBP"
          ]
        },
        "parts": {
          "type": "list",
          "desc": "파일. 첨부한 파일마다 무슨 문서인지 — 공문의 첨부 목록이 된다. 글만 붙여 넣었으면 null",
          "max": 10,
          "item": {
            "file": {
              "type": "string",
              "desc": "파일 이름(입력에 적힌 그대로)",
              "required": true,
              "max": 200
            },
            "kind": {
              "type": "enum",
              "desc": "quote(견적서)·statement(거래명세서·청구서)·order(주문 화면·예약 내역)·course(교육 안내문·신청 확인서)·content(교육 내용·커리큘럼·강의 계획·행사 일정·외부활동 자료)·event(행사·회의·학회 안내문·초청장)·request(외부활동 요청 공문·요청 메일·위촉장)·other(그 밖)",
              "required": true,
              "values": [
                "quote",
                "statement",
                "order",
                "course",
                "content",
                "event",
                "request",
                "other"
              ]
            }
          }
        },
        "summary": {
          "type": "string",
          "desc": "무엇의 어떤 문서인지 한국어 한 줄. 예: OO상사 모니터 외 1건 견적서 989,000원",
          "required": true,
          "max": 200
        }
      },
      "checks": [
        {
          "left": "from",
          "op": "<=",
          "right": "to",
          "drop": "to",
          "message": "교육 종료일이 시작일보다 앞서 종료일은 뺐습니다"
        }
      ],
      "rules": [
        "문서에 적힌 것만 채웁니다. 적혀 있지 않은 값은 null 이고, 추측하거나 지어내지 않습니다. 키의 설명이 \"없으면 … 적습니다\" 라고 한 키만 예외입니다.",
        "금액은 쉼표·통화 기호 없이 숫자만 적습니다. 날짜는 YYYY-MM-DD 입니다.",
        "첨부한 파일이 여러 개면 같은 건의 문서들입니다(견적서 여러 쪽, 견적서와 교육 내용 캡처 등). 값은 모두를 함께 보고 채우고, parts 에 파일마다 무슨 문서인지 적습니다.",
        "품의에 넣을 문서가 아닌 화면(결재 화면·이 프로그램의 화면·메일 목록 등)이면 docType 은 unknown 이고 나머지 값은 null 이며, summary 에 무슨 화면인지 적습니다.",
        "교육 공문의 첨부는 교육 견적서와 교육 내용 둘입니다. parts 에서 견적서는 quote, 청구서는 statement, 수강료·결제 칸만 있는 장은 order 이고, 교육 안내·강의 소개·커리큘럼·수업 목록이 든 장은 content 입니다."
      ]
    },
    "gongmunReason.edu": {
      "title": "교육품의의 교육목적·교육사유 쓰기",
      "kinds": [
        "edu"
      ],
      "consumer": {
        "module": "src/gongmun.js",
        "export": "applyReason"
      },
      "next": "src/gongmun.js applyReason 이 초안의 칸에 넣는다 → 사용자가 고친다 → compose 가 본문에 넣는다",
      "role": "당신은 연구부서의 전자결재 품의 작성 도우미입니다. 입력의 과제 정보(과제명·과제 내용)와 품의할 것을 보고 교육품의 본문에 들어갈 다음 칸을 공문체로 씁니다: 교육목적·교육사유. 입력에 사용자의 말이 있으면 그 요청대로 고쳐 씁니다.",
      "fields": {
        "purpose": {
          "type": "string",
          "desc": "교육 내용으로 보아 무엇의 역량을 기르는지 짧은 구절로(끝에 마침표 없이). 지금 적힌 교육목적이 있으면 그것을 다듬어 씁니다. 예: 전력변환 회로 설계 역량 강화",
          "max": 200
        },
        "reason": {
          "type": "string",
          "desc": "이 교육이 과제 수행에 왜 필요한지 — 과제 내용과 이어지는 필요성을 1~2문장으로, \"…필요함\" 처럼 명사형으로 끝맺습니다. 예: 과제의 MVDC 전력변환기 설계 역량 확보에 필요함",
          "required": true,
          "max": 1000
        },
        "reply": {
          "type": "string",
          "desc": "사용자의 말이 있을 때 무엇을 어떻게 고쳤는지(또는 왜 못 고쳤는지) 한 줄. 사용자의 말이 없으면 null",
          "max": 300
        }
      },
      "rules": [
        "과제 내용이 R&D 탭의 연구 내용이면 그 차년도의 연구개발 계획(개발목표·개발내용·성능목표·주요결과물·수행일정)과 진행 기록입니다. 그 가운데 품의할 것과 이어지는 목표·내용·결과물을 골라 사유의 근거로 삼습니다.",
        "입력에 \"사용자의 말\"이 있으면 그 요청대로 사유와 용도를 고쳐 씁니다 — 지금 적힌 사유가 있으면 그것을 바탕으로 합니다. 요청이 사유·용도와 무관하면 지금 적힌 것을 그대로 돌려주고 reply 에 그렇게 적습니다. 요청이어도 과제 내용에 없는 과업·수치는 지어내지 않습니다.",
        "사유는 과제 내용에 적힌 연구목표·연구내용을 근거로 씁니다. 과제 내용에 없는 연구 과업·수치·일정을 지어내지 않습니다.",
        "과제 내용이 비었거나 품의할 것과 이어지는 대목이 없으면, 과제명과 품의할 것 자체의 쓰임만으로 일반적인 필요성을 씁니다.",
        "공문체로 씁니다 — 문장을 \"…필요함\"·\"…위함\" 처럼 명사형으로 끝맺고, 경어·구어(\"합니다\", \"해요\")를 쓰지 않습니다.",
        "금액·업체·날짜는 사유에 넣지 않습니다(본문의 다른 줄에 있습니다)."
      ]
    },
    "gongmun.trip": {
      "title": "출장품의에 넣을 문서 읽기 — 행사·회의·학회 안내문·초청장·출장 일정표·교통/숙박 견적서",
      "kinds": [
        "trip"
      ],
      "consumer": {
        "module": "src/gongmun.js",
        "export": "fromRecord"
      },
      "next": "src/gongmun.js fromRecord 가 초안으로 바꾼다 → 사용자가 과제를 고르고 칸을 고친다 → compose 가 틀에 넣어 제목·본문을 만든다",
      "role": "당신은 사내 연구부서의 전자결재 품의 작성 도우미입니다. 첨부한 문서(행사·회의·학회 안내문·초청장·출장 일정표·교통/숙박 견적서 등의 이미지나 PDF) 또는 붙여 넣은 글을 읽어 출장품의에 넣을 값을 뽑습니다.",
      "fields": {
        "docType": {
          "type": "enum",
          "desc": "문서 종류. quote(견적서)·statement(거래명세서·청구서·인보이스)·order(쇼핑몰 주문서·장바구니·상품 화면)·course(교육 안내문·교육 신청 확인서)·event(행사·회의·학회 안내문·초청장·출장 일정표)·request(강의·자문·심사·발표·위원 위촉 등 외부활동 요청 공문·요청 메일)·other(그 밖)·unknown(모름)",
          "required": true,
          "values": [
            "quote",
            "statement",
            "order",
            "course",
            "event",
            "request",
            "other",
            "unknown"
          ]
        },
        "place": {
          "type": "string",
          "desc": "행사·회의가 열리는 도시와 기관 — \"도시(기관)\" 꼴로 적습니다. 예: 대전(한국기계연구원)",
          "max": 200
        },
        "from": {
          "type": "date",
          "desc": "출장 시작일 — 행사·회의의 첫날. 참가 신청·등록 마감일과 헷갈리지 않습니다. 연도가 적혀 있지 않으면 문서 발행일(없으면 오늘)의 연도를 붙입니다. 예: 2026-10-20"
        },
        "to": {
          "type": "date",
          "desc": "출장 종료일 — 행사·회의의 마지막 날. 하루짜리면 시작일과 같은 날입니다. 예: 2026-10-21"
        },
        "cost": {
          "type": "number",
          "desc": "교통·숙박 견적서가 함께 있으면 그 합계(부가세 포함)입니다. 행사 안내문·초청장만 있으면 null 입니다. 예: 300000",
          "min": 0
        },
        "purpose": {
          "type": "string",
          "desc": "무엇을 하러 가는지 짧은 구절로. 문서에 적혀 있으면 그대로, 없으면 행사·회의명으로 \"○○ 참석\" 처럼 적습니다 — 비워 두지 않습니다. 예: 2026 한국조선해양기자재 학회 참석 및 발표",
          "max": 200
        },
        "currency": {
          "type": "enum",
          "desc": "금액의 화폐(ISO 세 글자 코드). 예: KRW",
          "values": [
            "KRW",
            "USD",
            "EUR",
            "JPY",
            "CNY",
            "GBP"
          ]
        },
        "parts": {
          "type": "list",
          "desc": "파일. 첨부한 파일마다 무슨 문서인지 — 공문의 첨부 목록이 된다. 글만 붙여 넣었으면 null",
          "max": 10,
          "item": {
            "file": {
              "type": "string",
              "desc": "파일 이름(입력에 적힌 그대로)",
              "required": true,
              "max": 200
            },
            "kind": {
              "type": "enum",
              "desc": "quote(견적서)·statement(거래명세서·청구서)·order(주문 화면·예약 내역)·course(교육 안내문·신청 확인서)·content(교육 내용·커리큘럼·강의 계획·행사 일정·외부활동 자료)·event(행사·회의·학회 안내문·초청장)·request(외부활동 요청 공문·요청 메일·위촉장)·other(그 밖)",
              "required": true,
              "values": [
                "quote",
                "statement",
                "order",
                "course",
                "content",
                "event",
                "request",
                "other"
              ]
            }
          }
        },
        "summary": {
          "type": "string",
          "desc": "무엇의 어떤 문서인지 한국어 한 줄. 예: OO상사 모니터 외 1건 견적서 989,000원",
          "required": true,
          "max": 200
        }
      },
      "checks": [
        {
          "left": "from",
          "op": "<=",
          "right": "to",
          "drop": "to",
          "message": "출장 종료일이 시작일보다 앞서 종료일은 뺐습니다"
        }
      ],
      "rules": [
        "문서에 적힌 것만 채웁니다. 적혀 있지 않은 값은 null 이고, 추측하거나 지어내지 않습니다. 키의 설명이 \"없으면 … 적습니다\" 라고 한 키만 예외입니다.",
        "금액은 쉼표·통화 기호 없이 숫자만 적습니다. 날짜는 YYYY-MM-DD 입니다.",
        "첨부한 파일이 여러 개면 같은 건의 문서들입니다(견적서 여러 쪽, 견적서와 교육 내용 캡처 등). 값은 모두를 함께 보고 채우고, parts 에 파일마다 무슨 문서인지 적습니다.",
        "품의에 넣을 문서가 아닌 화면(결재 화면·이 프로그램의 화면·메일 목록 등)이면 docType 은 unknown 이고 나머지 값은 null 이며, summary 에 무슨 화면인지 적습니다."
      ]
    },
    "gongmunReason.trip": {
      "title": "출장품의의 출장목적·출장사유 쓰기",
      "kinds": [
        "trip"
      ],
      "consumer": {
        "module": "src/gongmun.js",
        "export": "applyReason"
      },
      "next": "src/gongmun.js applyReason 이 초안의 칸에 넣는다 → 사용자가 고친다 → compose 가 본문에 넣는다",
      "role": "당신은 연구부서의 전자결재 품의 작성 도우미입니다. 입력의 과제 정보(과제명·과제 내용)와 품의할 것을 보고 출장품의 본문에 들어갈 다음 칸을 공문체로 씁니다: 출장목적·출장사유. 입력에 사용자의 말이 있으면 그 요청대로 고쳐 씁니다.",
      "fields": {
        "purpose": {
          "type": "string",
          "desc": "무엇을 하러 가는지 짧은 구절로(끝에 마침표 없이). 지금 적힌 출장목적이 있으면 그것을 다듬어 씁니다. 예: 2026 한국조선해양기자재 학회 참석 및 발표",
          "max": 200
        },
        "reason": {
          "type": "string",
          "desc": "이 출장이 과제 수행에 왜 필요한지 — 과제 내용과 이어지는 필요성을 1~2문장으로, \"…필요함\" 처럼 명사형으로 끝맺습니다. 예: 과제의 실증 시험 결과를 확인하고 시험 조건을 협의하기 위해 필요함",
          "required": true,
          "max": 1000
        },
        "reply": {
          "type": "string",
          "desc": "사용자의 말이 있을 때 무엇을 어떻게 고쳤는지(또는 왜 못 고쳤는지) 한 줄. 사용자의 말이 없으면 null",
          "max": 300
        }
      },
      "rules": [
        "과제 내용이 R&D 탭의 연구 내용이면 그 차년도의 연구개발 계획(개발목표·개발내용·성능목표·주요결과물·수행일정)과 진행 기록입니다. 그 가운데 품의할 것과 이어지는 목표·내용·결과물을 골라 사유의 근거로 삼습니다.",
        "입력에 \"사용자의 말\"이 있으면 그 요청대로 사유와 용도를 고쳐 씁니다 — 지금 적힌 사유가 있으면 그것을 바탕으로 합니다. 요청이 사유·용도와 무관하면 지금 적힌 것을 그대로 돌려주고 reply 에 그렇게 적습니다. 요청이어도 과제 내용에 없는 과업·수치는 지어내지 않습니다.",
        "사유는 과제 내용에 적힌 연구목표·연구내용을 근거로 씁니다. 과제 내용에 없는 연구 과업·수치·일정을 지어내지 않습니다.",
        "과제 내용이 비었거나 품의할 것과 이어지는 대목이 없으면, 과제명과 품의할 것 자체의 쓰임만으로 일반적인 필요성을 씁니다.",
        "공문체로 씁니다 — 문장을 \"…필요함\"·\"…위함\" 처럼 명사형으로 끝맺고, 경어·구어(\"합니다\", \"해요\")를 쓰지 않습니다.",
        "금액·업체·날짜는 사유에 넣지 않습니다(본문의 다른 줄에 있습니다)."
      ]
    },
    "gongmun.outside": {
      "title": "외부활동 허가 신청서에 넣을 문서 읽기 — 강의·자문·심사·발표·위원 위촉 요청 공문·초청장·요청 메일·행사 안내문",
      "kinds": [
        "outside"
      ],
      "consumer": {
        "module": "src/gongmun.js",
        "export": "fromRecord"
      },
      "next": "src/gongmun.js fromRecord 가 초안으로 바꾼다 → 사용자가 과제를 고르고 칸을 고친다 → compose 가 틀에 넣어 제목·본문을 만든다",
      "role": "당신은 사내 연구부서의 전자결재 품의 작성 도우미입니다. 첨부한 문서(강의·자문·심사·발표·위원 위촉 요청 공문·초청장·요청 메일·행사 안내문 등의 이미지나 PDF) 또는 붙여 넣은 글을 읽어 외부활동 허가 신청서에 넣을 값을 뽑습니다.",
      "fields": {
        "docType": {
          "type": "enum",
          "desc": "문서 종류. quote(견적서)·statement(거래명세서·청구서·인보이스)·order(쇼핑몰 주문서·장바구니·상품 화면)·course(교육 안내문·교육 신청 확인서)·event(행사·회의·학회 안내문·초청장·출장 일정표)·request(강의·자문·심사·발표·위원 위촉 등 외부활동 요청 공문·요청 메일)·other(그 밖)·unknown(모름)",
          "required": true,
          "values": [
            "quote",
            "statement",
            "order",
            "course",
            "event",
            "request",
            "other",
            "unknown"
          ]
        },
        "type": {
          "type": "enum",
          "desc": "외부활동의 구분 — 강의·특강은 강의, 자문은 자문, 심사·평가위원은 심사·평가, 발표·강연은 발표, 위원회 위촉은 위원 활동, 집필·기고는 집필, 그 밖은 기타. 예: 강의",
          "values": [
            "강의",
            "자문",
            "심사·평가",
            "발표",
            "위원 활동",
            "집필",
            "기타"
          ]
        },
        "org": {
          "type": "string",
          "desc": "활동을 요청한 기관·부서 — 공문의 발신 기관이나 메일을 보낸 곳의 이름 그대로. 예: 부산대학교 조선해양공학과",
          "max": 200
        },
        "subject": {
          "type": "string",
          "desc": "활동명 — 강의 제목·자문 주제·심사 대상. 공문 본문에 들어가니 문서에 적힌 제목을 짧게 적습니다. 예: MVDC 차단기 기술 특강",
          "max": 200
        },
        "from": {
          "type": "date",
          "desc": "외부활동의 첫날. 연도가 적혀 있지 않으면 문서 발행일(없으면 오늘)의 연도를 붙입니다. 예: 2026-11-05"
        },
        "to": {
          "type": "date",
          "desc": "외부활동의 마지막 날 — 하루면 시작일과 같은 날입니다. 예: 2026-11-05"
        },
        "hours": {
          "type": "string",
          "desc": "활동 시간 — 시각과 길이를 적힌 대로. 예: 14:00~16:00 (2시간)",
          "max": 200
        },
        "place": {
          "type": "string",
          "desc": "활동 장소 — 기관·건물·호실. 온라인이면 \"온라인\" 입니다. 예: 부산대학교 공학관",
          "max": 200
        },
        "fee": {
          "type": "number",
          "desc": "사례비·강사료·자문료 — 적혀 있으면 그 금액, 없으면 null 입니다. 예: 300000",
          "min": 0
        },
        "topics": {
          "type": "string",
          "desc": "활동 내용 — 강의 주제·자문 사항·심사 대상을 \" · \" 로 나열합니다. 예: MVDC 차단기 개요 · 시험 결과",
          "max": 400
        },
        "purpose": {
          "type": "string",
          "desc": "그 활동이 과제·기관에 어떤 뜻인지 짧은 구절로. 문서에 적혀 있으면 그대로, 없으면 활동 내용으로 보아 적습니다(사용자가 고칩니다). 예: 부산대 특강을 통한 연구 성과 확산",
          "max": 200
        },
        "currency": {
          "type": "enum",
          "desc": "금액의 화폐(ISO 세 글자 코드). 예: KRW",
          "values": [
            "KRW",
            "USD",
            "EUR",
            "JPY",
            "CNY",
            "GBP"
          ]
        },
        "parts": {
          "type": "list",
          "desc": "파일. 첨부한 파일마다 무슨 문서인지 — 공문의 첨부 목록이 된다. 글만 붙여 넣었으면 null",
          "max": 10,
          "item": {
            "file": {
              "type": "string",
              "desc": "파일 이름(입력에 적힌 그대로)",
              "required": true,
              "max": 200
            },
            "kind": {
              "type": "enum",
              "desc": "quote(견적서)·statement(거래명세서·청구서)·order(주문 화면·예약 내역)·course(교육 안내문·신청 확인서)·content(교육 내용·커리큘럼·강의 계획·행사 일정·외부활동 자료)·event(행사·회의·학회 안내문·초청장)·request(외부활동 요청 공문·요청 메일·위촉장)·other(그 밖)",
              "required": true,
              "values": [
                "quote",
                "statement",
                "order",
                "course",
                "content",
                "event",
                "request",
                "other"
              ]
            }
          }
        },
        "summary": {
          "type": "string",
          "desc": "무엇의 어떤 문서인지 한국어 한 줄. 예: OO상사 모니터 외 1건 견적서 989,000원",
          "required": true,
          "max": 200
        }
      },
      "checks": [
        {
          "left": "from",
          "op": "<=",
          "right": "to",
          "drop": "to",
          "message": "외부활동 종료일이 시작일보다 앞서 종료일은 뺐습니다"
        }
      ],
      "rules": [
        "문서에 적힌 것만 채웁니다. 적혀 있지 않은 값은 null 이고, 추측하거나 지어내지 않습니다. 키의 설명이 \"없으면 … 적습니다\" 라고 한 키만 예외입니다.",
        "금액은 쉼표·통화 기호 없이 숫자만 적습니다. 날짜는 YYYY-MM-DD 입니다.",
        "첨부한 파일이 여러 개면 같은 건의 문서들입니다(견적서 여러 쪽, 견적서와 교육 내용 캡처 등). 값은 모두를 함께 보고 채우고, parts 에 파일마다 무슨 문서인지 적습니다.",
        "품의에 넣을 문서가 아닌 화면(결재 화면·이 프로그램의 화면·메일 목록 등)이면 docType 은 unknown 이고 나머지 값은 null 이며, summary 에 무슨 화면인지 적습니다."
      ]
    },
    "gongmunReason.outside": {
      "title": "외부활동 허가 신청서의 활동목적·신청사유 쓰기",
      "kinds": [
        "outside"
      ],
      "consumer": {
        "module": "src/gongmun.js",
        "export": "applyReason"
      },
      "next": "src/gongmun.js applyReason 이 초안의 칸에 넣는다 → 사용자가 고친다 → compose 가 본문에 넣는다",
      "role": "당신은 연구부서의 전자결재 품의 작성 도우미입니다. 입력의 과제 정보(과제명·과제 내용)와 품의할 것을 보고 외부활동 허가 신청서 본문에 들어갈 다음 칸을 공문체로 씁니다: 활동목적·신청사유. 입력에 사용자의 말이 있으면 그 요청대로 고쳐 씁니다.",
      "fields": {
        "purpose": {
          "type": "string",
          "desc": "그 활동이 과제·기관에 어떤 뜻인지 짧은 구절로(끝에 마침표 없이). 지금 적힌 활동목적이 있으면 그것을 다듬어 씁니다. 예: 부산대 특강을 통한 연구 성과 확산",
          "max": 200
        },
        "reason": {
          "type": "string",
          "desc": "그 활동(강의·자문·심사·발표·위원 활동)이 과제 수행이나 연구 성과의 확산·활용과 어떻게 이어지는지, 직무와 상충하지 않는지를 1~2문장으로, \"…필요함\"·\"…위함\" 처럼 명사형으로 끝맺습니다. 예: 과제에서 얻은 MVDC 차단기 시험 성과를 학계에 확산하기 위함이며 직무와 상충하지 않음",
          "required": true,
          "max": 1000
        },
        "reply": {
          "type": "string",
          "desc": "사용자의 말이 있을 때 무엇을 어떻게 고쳤는지(또는 왜 못 고쳤는지) 한 줄. 사용자의 말이 없으면 null",
          "max": 300
        }
      },
      "rules": [
        "과제 내용이 R&D 탭의 연구 내용이면 그 차년도의 연구개발 계획(개발목표·개발내용·성능목표·주요결과물·수행일정)과 진행 기록입니다. 그 가운데 품의할 것과 이어지는 목표·내용·결과물을 골라 사유의 근거로 삼습니다.",
        "입력에 \"사용자의 말\"이 있으면 그 요청대로 사유와 용도를 고쳐 씁니다 — 지금 적힌 사유가 있으면 그것을 바탕으로 합니다. 요청이 사유·용도와 무관하면 지금 적힌 것을 그대로 돌려주고 reply 에 그렇게 적습니다. 요청이어도 과제 내용에 없는 과업·수치는 지어내지 않습니다.",
        "사유는 과제 내용에 적힌 연구목표·연구내용을 근거로 씁니다. 과제 내용에 없는 연구 과업·수치·일정을 지어내지 않습니다.",
        "과제 내용이 비었거나 품의할 것과 이어지는 대목이 없으면, 과제명과 품의할 것 자체의 쓰임만으로 일반적인 필요성을 씁니다.",
        "공문체로 씁니다 — 문장을 \"…필요함\"·\"…위함\" 처럼 명사형으로 끝맺고, 경어·구어(\"합니다\", \"해요\")를 쓰지 않습니다.",
        "금액·업체·날짜는 사유에 넣지 않습니다(본문의 다른 줄에 있습니다)."
      ]
    }
  }
};
