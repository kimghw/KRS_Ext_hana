// 생성물 — 고치지 않는다. input.yaml 을 고치고 `node tools/gen-input.mjs` 를 돌린다.
export const INPUT_SPEC = {
  "version": 1,
  "tasks": {
    "parse": {
      "title": "회의실·차량 조회 조건",
      "kinds": [
        "room",
        "car"
      ],
      "consumer": {
        "module": "src/search.js",
        "export": "findSlots"
      },
      "next": "사용자가 후보를 고른다 → src/runners.js 의 room·car 실행자가 예약한다(reserve)",
      "variants": {
        "car": {
          "clear": {
            "minSeats": "차량은 좌석 수를 알 수 없어 인원 조건은 뺐습니다",
            "region": "차량은 지역을 가리지 않아 지역 조건은 뺐습니다"
          }
        }
      },
      "role": "당신은 사내 회의실·업무용 차량 예약 도우미입니다. 사용자의 한국어 요청을 조회 조건으로 바꿉니다. 회의실을 찾는지 차량을 찾는지는 입력의 \"찾는 대상\" 줄이 알려 줍니다. 두 경우 모두 같은 키를 씁니다.",
      "fields": {
        "dateFrom": {
          "type": "date",
          "required": true,
          "desc": "조회 시작일"
        },
        "dateTo": {
          "type": "date",
          "required": true,
          "desc": "조회 종료일(포함)"
        },
        "hourFrom": {
          "type": "integer",
          "required": true,
          "min": 0,
          "max": 23,
          "desc": "하루 중 조회 시작 시"
        },
        "hourTo": {
          "type": "integer",
          "required": true,
          "min": 1,
          "max": 24,
          "desc": "하루 중 조회 종료 시"
        },
        "minSeats": {
          "type": "integer",
          "min": 1,
          "max": 999,
          "desc": "필요한 최소 좌석 수"
        },
        "minHours": {
          "type": "number",
          "min": 0.5,
          "max": 24,
          "desc": "연속으로 필요한 최소 시간"
        },
        "region": {
          "type": "enum",
          "values": [
            "부산",
            "서울"
          ],
          "desc": "지역"
        },
        "summary": {
          "type": "string",
          "required": true,
          "max": 200,
          "desc": "해석한 조건을 한 줄로 요약(한국어)"
        }
      },
      "checks": [
        {
          "left": "dateFrom",
          "op": "<=",
          "right": "dateTo",
          "message": "종료일이 시작일보다 앞섭니다"
        },
        {
          "left": "hourFrom",
          "op": "<",
          "right": "hourTo",
          "message": "종료 시가 시작 시보다 늦어야 합니다"
        }
      ],
      "rules": [
        "날짜가 없으면 오늘 하루만 조회합니다(dateFrom = dateTo = 오늘).",
        "\"내일\", \"이번 주\", \"다음 주\" 같은 표현은 오늘을 기준으로 실제 날짜로 바꿉니다.",
        "연도가 없으면 오늘과 같은 해로 봅니다.",
        "시간대가 없으면 hourFrom 9, hourTo 18 로 둡니다.",
        "\"10명\" 처럼 인원이 나오면 minSeats 에 넣습니다. 차량에는 좌석 정보가 없으므로 찾는 대상이 차량이면 minSeats 는 항상 null 입니다.",
        "\"2시간짜리\" 처럼 필요한 길이가 나오면 minHours 에 넣습니다.",
        "지역은 부산 또는 서울만 가능합니다.",
        "summary 는 사용자가 확인할 수 있게 해석 결과를 한 줄로 적습니다."
      ]
    },
    "attend": {
      "title": "근태 신청 폼 조각",
      "kinds": [
        "attend"
      ],
      "partial": true,
      "consumer": {
        "module": "src/attend.js",
        "export": "applyPatch"
      },
      "next": "사용자가 폼을 확인하고 누른다 → src/attend.js buildJob → src/hr.js hrRunJob",
      "role": "당신은 사내 근태 신청 도우미입니다. 사용자의 말에서 근태 신청 폼에 넣을 값을 뽑습니다. 입력에는 오늘 날짜와 달력, 지금 폼(JSON), 앞선 대화, 새 요청이 들어 있습니다.",
      "fields": {
        "kind": {
          "type": "enum",
          "values": [
            "flex",
            "out",
            "leaveout",
            "trip",
            "leave",
            "health"
          ],
          "desc": "근태 종류. flex(유연근무)·out(외근·교육·부서소통회)·leaveout(외출)·trip(출장)·leave(휴가)·health(건강검진)"
        },
        "sub": {
          "type": "enum",
          "values": [
            "OD",
            "TR",
            "MEET",
            "LY",
            "LH"
          ],
          "desc": "종류 안의 갈래. out 이면 OD(외근)·TR(교육)·MEET(부서소통회), leave 이면 LY(연차·반차)·LH(체력단련)"
        },
        "half": {
          "type": "enum",
          "values": [
            "am",
            "pm",
            "full"
          ],
          "desc": "하루짜리 연차의 구분. am(오전 반차)·pm(오후 반차)·full(전일). 휴가가 아니면 null"
        },
        "dateFrom": {
          "type": "date",
          "desc": "날짜(출장·휴가는 시작일)"
        },
        "dateTo": {
          "type": "date",
          "desc": "여러 날 출장·휴가의 종료일. 그 외에는 null"
        },
        "days": {
          "type": "integer",
          "min": 1,
          "max": 31,
          "desc": "출장·휴가가 며칠간인지(당일 1, 1박 2일이면 2). 출장·휴가가 아니면 null"
        },
        "start": {
          "type": "time",
          "desc": "시작 시각"
        },
        "end": {
          "type": "time",
          "desc": "종료 시각"
        },
        "place": {
          "type": "string",
          "max": 200,
          "desc": "장소. 출장이면 출장지(도시·지역 — 예: 대전)"
        },
        "venue": {
          "type": "string",
          "max": 200,
          "desc": "출장의 장소(찾아갈 기관·건물 — 예: 한국기계연구원). 출장이 아니면 null"
        },
        "purpose": {
          "type": "string",
          "max": 200,
          "desc": "목적·사유"
        },
        "flexStart": {
          "type": "enum",
          "values": [
            "07:00",
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00",
            "11:00"
          ],
          "desc": "유연근무의 새 출근시간(당일·전체일 때)"
        },
        "flexMode": {
          "type": "enum",
          "values": [
            "day",
            "week",
            "all"
          ],
          "desc": "유연근무를 넣는 길. day(당일)·week(주간·요일별)·all(전체·매일·월~금 모두)"
        },
        "flexMon": {
          "type": "enum",
          "values": [
            "07:00",
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00",
            "11:00"
          ],
          "desc": "주간 유연근무의 월요일 출근시간"
        },
        "flexTue": {
          "type": "enum",
          "values": [
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00"
          ],
          "desc": "주간 유연근무의 화요일 출근시간"
        },
        "flexWed": {
          "type": "enum",
          "values": [
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00"
          ],
          "desc": "주간 유연근무의 수요일 출근시간"
        },
        "flexThu": {
          "type": "enum",
          "values": [
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00"
          ],
          "desc": "주간 유연근무의 목요일 출근시간"
        },
        "flexFri": {
          "type": "enum",
          "values": [
            "07:00",
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00",
            "11:00"
          ],
          "desc": "주간 유연근무의 금요일 출근시간"
        },
        "allDay": {
          "type": "boolean",
          "desc": "건강검진을 하루 전체로 올리는가. 건강검진이 아니면 null"
        },
        "wfa": {
          "type": "boolean",
          "desc": "연차를 가족 기념일(생일·결혼기념일·어린이날 …)에 쓰는가 — \"기념일\"·\"기념일 지원\" 이라고 말했을 때만 true. 그 밖에는 null"
        },
        "reply": {
          "type": "string",
          "max": 300,
          "desc": "무엇을 채웠는지 한국어 한 문장"
        }
      },
      "checks": [
        {
          "left": "dateFrom",
          "op": "<=",
          "right": "dateTo",
          "drop": "dateTo",
          "message": "종료일이 시작일보다 앞서 종료일은 뺐습니다"
        }
      ],
      "rules": [
        "**이번 말에서 사용자가 말한 것만** 채웁니다. 말하지 않은 칸은 null 입니다. 장소와 목적을 지어내지 않습니다.",
        "지금 폼에 이미 들어 있는 값을 되풀이하지 않습니다. 바꾸라고 한 것만 넣습니다.",
        "\"내일\", \"다음 주 수요일\" 같은 표현은 오늘을 기준으로 실제 날짜로 바꿉니다. 연도가 없으면 오늘과 같은 해입니다.",
        "요일은 셈하지 말고 입력의 달력 줄에서 찾습니다.",
        "flex 는 유연근무(출근시간 변경. 자율출퇴근·시차출근이라고도 말합니다)입니다. 넣는 길(flexMode)은 셋입니다 — day(당일: 그 날 하루), week(주간: 월~금 요일마다), all(전체: 월~금 모두 같은 시간).",
        "flexMode 가 week 이면 말한 요일의 출근시간만 flexMon~flexFri 에 넣고 flexStart 는 null 입니다. day·all 이면 flexStart 를 쓰고 flexMon~flexFri 는 null 입니다.",
        "07:00·11:00 출근은 월요일·금요일에만 있습니다.",
        "교육은 kind 가 out 이고 sub 가 TR 입니다. 외근이라고 말했으면 sub 는 OD 입니다.",
        "부서소통회(소통회)는 kind 가 out 이고 sub 가 MEET 입니다. 시각(13:00~14:00)과 목적(\"부서소통회\")은 폼이 채우므로, 사용자가 다르게 말했을 때만 start·end·purpose 를 넣습니다.",
        "휴가(leave)의 sub 는 LY(연차·반차) 또는 LH(체력단련·체력관리)이고, 그냥 \"휴가\"라고만 했으면 sub 는 null 입니다.",
        "출장(trip)은 출장지(place — 도시·지역)와 장소(venue — 찾아갈 기관·건물)를 나눠 넣습니다. \"대전 한국기계연구원\" 이면 place 는 대전, venue 는 한국기계연구원입니다. 장소만 말했으면(\"KAIST\") 그 장소가 있는 도시를 place 에, 장소를 venue 에 넣습니다. 출장이 아니면 venue 는 null 이고 장소는 place 에 넣습니다.",
        "\"오전 반차\"·\"오후 반차\"는 half 에 am·pm 을, 하루 종일이라고 했으면 full 을 넣습니다. 휴가에는 장소·목적이 없습니다.",
        "시각은 24시간제 HH:MM 입니다. 외근·외출·건강검진은 30분 단위, 출장·교육은 정시 단위입니다.",
        "\"2시부터 3시간\" 처럼 길이로 말했으면 end 에 끝나는 시각을 셈해 넣습니다.",
        "dateTo 는 여러 날 출장·휴가일 때만 넣습니다. \"1박 2일\"·\"3일간\" 처럼 기간으로 말했으면 days 에 날 수를 넣습니다(당일은 1).",
        "allDay 는 건강검진일 때만 true/false 이고, 그 외에는 null 입니다.",
        "\"가족 기념일\"·\"기념일 지원\"·\"결혼기념일에 연차\" 처럼 기념일을 말했으면 kind 는 leave, sub 는 LY, wfa 는 true 입니다. 기념일의 내용(대상자·신청사항·금액)은 폼의 칸에서 적으므로 넣지 않습니다.",
        "reply 에는 **무엇을 채웠는지만** 한 문장으로 적습니다(\"…채웠습니다\"). 아직 아무것도 올라가지 않았으므로 등록·신청했다고 말하지 않고, 비어 있는 칸은 적지 않습니다(화면이 따로 보여 줍니다)."
      ]
    },
    "receipt": {
      "title": "출장 증빙(숙박 영수증·예약서·항공권·출장지에서 결제한 영수증) 읽기",
      "kinds": [
        "trip"
      ],
      "consumer": {
        "module": "src/after.js",
        "export": "afterPlan"
      },
      "next": "src/after.js afterPlan 이 숙박비·교통비·항공 마일리지로 묶는다 → src/trip.js tripAfterSave 가 eclass 여비계산서 사후정산(AfterTrip/Save)에 올린다",
      "role": "당신은 사내 출장 여비 정산 도우미입니다. 첨부한 문서 한 장(숙박 영수증·인보이스·숙박 예약 확인서·항공권·기차표·카드 영수증·전자영수증 등의 이미지나 PDF)을 읽어 여비계산서 정산에 넣을 값을 뽑습니다. 입력에는 출장 정보(기간·출장지·출장자)와 파일 이름이 들어 있습니다.",
      "fields": {
        "docType": {
          "type": "enum",
          "required": true,
          "values": [
            "lodging_receipt",
            "lodging_booking",
            "flight_ticket",
            "flight_receipt",
            "train_ticket",
            "bus_ticket",
            "other_receipt",
            "unknown"
          ],
          "desc": "문서 종류. lodging_receipt(숙박 결제 영수증·인보이스)·lodging_booking(숙박 예약 확인서)·flight_ticket(항공권·탑승권·e-티켓)·flight_receipt(항공권 결제 영수증)·train_ticket(기차표)·bus_ticket(버스표)·other_receipt(그 밖의 영수증)·unknown(모름)"
        },
        "vendor": {
          "type": "string",
          "max": 100,
          "desc": "업체명(실제로 묵은 숙박업소·가맹점 이름 또는 항공사)"
        },
        "seller": {
          "type": "string",
          "max": 100,
          "desc": "구매처 — 돈을 받은 곳. 예약 대행사를 거쳐 샀으면 그 대행사(아고다·부킹닷컴·야놀자 등), 직접 결제했으면 그 업체"
        },
        "sellerBiz": {
          "type": "string",
          "max": 100,
          "desc": "구매처의 사업자명(문서에 적힌 상호·법인명 — \"Agoda Company Pte. Ltd.\", \"(주)야놀자\"). 적혀 있지 않으면 null"
        },
        "bizNo": {
          "type": "string",
          "max": 20,
          "desc": "구매처의 사업자등록번호(000-00-00000). 적혀 있지 않으면 null"
        },
        "payDate": {
          "type": "date",
          "desc": "결제일(영수증의 승인·결제 날짜)"
        },
        "payPlace": {
          "type": "string",
          "max": 100,
          "desc": "결제한 곳 — 영수증에 적힌 가맹점 주소나 지역(시·군·구까지). 적혀 있지 않으면 null"
        },
        "atDestination": {
          "type": "boolean",
          "desc": "그 밖의 영수증(other_receipt)이 입력의 출장지와 같은 지역(시·군·구)에서 결제된 것인가. 영수증의 주소·지점명으로 가리고, 알 수 없으면 null"
        },
        "checkIn": {
          "type": "date",
          "desc": "숙박 체크인 날짜"
        },
        "checkOut": {
          "type": "date",
          "desc": "숙박 체크아웃 날짜"
        },
        "nights": {
          "type": "integer",
          "min": 1,
          "max": 60,
          "desc": "숙박 일수(박)"
        },
        "total": {
          "type": "number",
          "min": 0,
          "desc": "총 결제 금액(숫자만) — 문서에 적힌 화폐(currency)의 금액"
        },
        "totalKRW": {
          "type": "number",
          "min": 0,
          "desc": "외화 문서에 원화로 결제·청구된 금액이 같이 적혀 있을 때 그 원화 금액. 원화 문서이거나 적혀 있지 않으면 null"
        },
        "supply": {
          "type": "number",
          "min": 0,
          "desc": "공급가액(부가세를 뺀 금액) — 문서에 따로 적혀 있을 때만"
        },
        "vat": {
          "type": "number",
          "min": 0,
          "desc": "부가세 — 문서에 따로 적혀 있을 때만"
        },
        "currency": {
          "type": "enum",
          "values": [
            "KRW",
            "USD",
            "EUR",
            "JPY",
            "CNY",
            "TWD",
            "AED",
            "SGD",
            "MYR",
            "CAD",
            "AUD",
            "NZD",
            "VND",
            "JOD",
            "KWD",
            "BHD",
            "ZAR",
            "RUB",
            "INR",
            "PKR",
            "IDR",
            "TRY",
            "SAR",
            "QAR",
            "BRL",
            "THB",
            "BND",
            "ILS",
            "PLN",
            "SEK",
            "CZK",
            "DKK",
            "NOK",
            "BDT",
            "KZT",
            "MNT",
            "GBP",
            "EGP",
            "PHP",
            "MXN",
            "HUF",
            "CHF",
            "HKD"
          ],
          "desc": "화폐(ISO 세 글자 코드)"
        },
        "corporateCard": {
          "type": "boolean",
          "desc": "법인카드로 결제했다고 문서에 적혀 있는가"
        },
        "transport": {
          "type": "enum",
          "values": [
            "plane",
            "train",
            "subway",
            "ship",
            "bus",
            "taxi"
          ],
          "desc": "교통비 문서(표·교통비 영수증)의 교통수단. plane(비행기)·train(기차)·subway(지하철)·ship(선박)·bus(버스)·taxi(택시). 교통비 문서가 아니면 null"
        },
        "airline": {
          "type": "string",
          "max": 50,
          "desc": "항공사 이름(한국어로 — 대한항공·아시아나항공·에어프레미아·제주항공 등)"
        },
        "flightNo": {
          "type": "string",
          "max": 20,
          "desc": "편명(KE1234)"
        },
        "flightDate": {
          "type": "date",
          "desc": "탑승일(비행기·기차·버스·택시 등을 탄 날)"
        },
        "depPlace": {
          "type": "string",
          "max": 50,
          "desc": "출발지(도시·공항·역)"
        },
        "arrPlace": {
          "type": "string",
          "max": 50,
          "desc": "도착지(도시·공항·역)"
        },
        "depTime": {
          "type": "time",
          "desc": "출발 시각"
        },
        "arrTime": {
          "type": "time",
          "desc": "도착 시각"
        },
        "seatClass": {
          "type": "string",
          "max": 20,
          "desc": "좌석 등급(일반석·비즈니스 등)"
        },
        "retDate": {
          "type": "date",
          "desc": "왕복표의 돌아오는 편 탑승일. 편도면 null"
        },
        "retDepPlace": {
          "type": "string",
          "max": 50,
          "desc": "왕복표의 돌아오는 편 출발지. 편도면 null"
        },
        "retArrPlace": {
          "type": "string",
          "max": 50,
          "desc": "왕복표의 돌아오는 편 도착지. 편도면 null"
        },
        "retDepTime": {
          "type": "time",
          "desc": "왕복표의 돌아오는 편 출발 시각. 편도면 null"
        },
        "retFlightNo": {
          "type": "string",
          "max": 20,
          "desc": "왕복표의 돌아오는 편 편명. 편도면 null"
        },
        "mileage": {
          "type": "integer",
          "min": 0,
          "max": 100000,
          "desc": "이 항공권으로 적립되는 마일리지(문서에 적혀 있을 때만)"
        },
        "passenger": {
          "type": "string",
          "max": 50,
          "desc": "탑승자·투숙자 이름"
        },
        "extra": {
          "type": "string",
          "max": 300,
          "desc": "계산서에 넣지 않지만 알아 둘 추가 정보(조식 포함·예약번호·취소 규정·수하물 등). 없으면 null"
        },
        "summary": {
          "type": "string",
          "required": true,
          "max": 200,
          "desc": "문서를 한 줄로 요약(한국어)"
        }
      },
      "checks": [
        {
          "left": "checkIn",
          "op": "<=",
          "right": "checkOut",
          "drop": "checkOut",
          "message": "체크아웃이 체크인보다 앞서 체크아웃은 뺐습니다"
        }
      ],
      "rules": [
        "문서에 적힌 것만 채웁니다. 적혀 있지 않은 값은 null 이고, 추측하거나 지어내지 않습니다.",
        "증빙은 **원본 문서**(영수증·인보이스·예약 확인서·표, 또는 그것을 보여 주는 예약 사이트·앱의 화면)입니다. 정산 프로그램의 화면을 찍은 것 — 여비계산서·사후정산 입력 화면, \"증빙 넣는 곳\"·\"사후정산\"·\"올렸습니다\"·\"보관했습니다\" 같은 글이 보이는 출장 카드 화면, 읽은 증빙의 요약이나 목록만 적힌 화면 — 은 증빙이 아닙니다. 그런 화면이면 docType 은 unknown 이고 나머지 값은 null 이며, summary 에 무슨 화면인지 적습니다.",
        "금액은 쉼표·통화 기호 없이 숫자만 적습니다. 날짜는 YYYY-MM-DD, 시각은 24시간제 HH:MM 입니다.",
        "숙박 예약 확인서(결제 영수증이 아닌 것)는 lodging_booking 이고, 예약 금액이 있으면 total 에 적습니다.",
        "seller 는 **돈을 받은 곳(구매처)**입니다. 예약 대행사(아고다·부킹닷컴·호텔스닷컴·익스피디아·트립닷컴·야놀자·여기어때 등)를 거쳐 결제한 문서면 그 대행사를 한국에서 부르는 이름으로 적고(Agoda → 아고다, Booking.com → 부킹닷컴), 숙박업소나 가맹점에 직접 결제한 문서면 그 업체 이름을 적습니다. vendor 에는 언제나 실제로 묵은 숙박업소(또는 가맹점·항공사) 이름을 적습니다.",
        "sellerBiz 는 문서에 적힌 구매처의 사업자명(상호·법인명)이고 bizNo 는 그 구매처의 사업자등록번호입니다. 문서에 적혀 있을 때만 적습니다.",
        "total 은 문서에 적힌 화폐의 금액이고 currency 는 그 화폐입니다. 외화 문서에 원화로 결제·청구된 금액이 같이 적혀 있으면 totalKRW 에 적습니다 — 환율로 셈하지 않습니다. 원화 문서면 totalKRW 는 null 입니다.",
        "supply(공급가액)·vat(부가세)는 문서에 따로 적혀 있을 때만 적습니다. 총액에서 셈해 넣지 않습니다.",
        "체크인·체크아웃이 모두 있으면 nights 는 그 차이(박 수)입니다.",
        "항공권이면 airline 은 한국어 이름으로 적습니다(Korean Air → 대한항공, Asiana → 아시아나항공).",
        "왕복표(한 장에 가는 편과 오는 편이 같이 있는 것)면 가는 편을 flightDate·depPlace·arrPlace·depTime·flightNo 에, 오는 편을 retDate·retDepPlace·retArrPlace·retDepTime·retFlightNo 에 적습니다. total 은 문서의 총 결제 금액 그대로입니다.",
        "편도표면 ret 으로 시작하는 칸은 모두 null 입니다. 여정이 셋 이상이면 처음 두 여정을 적고 나머지는 extra 에 적습니다.",
        "기차표(train_ticket)·버스표(bus_ticket)도 항공권처럼 탑승일(flightDate)·출발지(depPlace)·도착지(arrPlace)·출발 시각·도착 시각·좌석 등급(seatClass)·total 을 적습니다. airline·flightNo 는 null 입니다.",
        "transport 는 교통비 문서일 때만 적습니다 — 항공권은 plane, 기차표는 train, 버스표는 bus 입니다. 택시·지하철·선박처럼 표 종류가 따로 없는 교통비 영수증은 docType 을 other_receipt 로 두고 transport 에 수단을 적으며, 탄 날을 flightDate 에, 출발지·도착지가 적혀 있으면 depPlace·arrPlace 에 적습니다. 식당·카페·숙박처럼 교통비가 아니면 transport 는 null 입니다.",
        "그 밖의 영수증(other_receipt — 식당·카페·편의점·택시 등의 카드 영수증)은 vendor·payDate·total 과 함께 payPlace(가맹점 주소·지역)를 적고, 그곳이 입력의 출장지와 같은 지역이면 atDestination 을 true, 다른 지역이면 false 로 적습니다. 주소·지점명이 없어 알 수 없으면 null 입니다 — 추측하지 않습니다.",
        "atDestination 은 other_receipt 일 때만 true/false 이고, 그 밖의 문서에서는 null 입니다.",
        "corporateCard 는 문서에 법인카드라고 적혀 있을 때만 true 이고, 알 수 없으면 null 입니다.",
        "summary 는 무엇의 어떤 문서인지 한 줄로 적습니다(\"○○호텔 1박 결제 영수증 143,000원\")."
      ]
    },
    "gongmun": {
      "title": "공문(구매·교육·출장 품의·외부활동 허가 신청서)에 넣을 견적서·교육 안내문·행사 안내문·요청 공문 읽기",
      "kinds": [
        "purchase",
        "edu",
        "trip",
        "outside"
      ],
      "consumer": {
        "module": "src/gongmun.js",
        "export": "fromRecord"
      },
      "next": "src/gongmun.js fromRecord 가 초안으로 바꾼다 → 사용자가 과제를 고른다 → compose 가 양식에 넣어 제목·본문을 만든다(전자결재에는 사용자가 붙여 넣는다)",
      "role": "당신은 사내 연구부서의 전자결재 품의(구매품의·교육품의·출장품의)와 외부활동 허가 신청서 작성 도우미입니다. 첨부한 문서(견적서·거래명세서·쇼핑몰 주문/장바구니 화면·교육 안내문· 교육 신청 확인서·행사/회의/학회 안내문·초청장·출장 일정표·강의/자문/심사/발표/위원 위촉 요청 공문이나 메일 등의 이미지나 PDF) 또는 붙여 넣은 글을 읽어 품의에 넣을 값을 뽑습니다. 입력의 \"품의 종류\" 줄이 구매인지 교육인지 출장인지 외부활동 허가인지 알려 줍니다.",
      "fields": {
        "docType": {
          "type": "enum",
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
          ],
          "desc": "문서 종류. quote(견적서)·statement(거래명세서·청구서·인보이스)·order(쇼핑몰 주문서·장바구니·상품 화면)·course(교육 안내문·교육 신청 확인서)·event(행사·회의·학회 안내문·초청장·출장 일정표)·request(강의·자문·심사·발표·위원 위촉 등 외부활동 요청 공문·요청 메일)·other(그 밖)·unknown(모름)"
        },
        "vendor": {
          "type": "string",
          "max": 100,
          "desc": "공급자 — 견적을 낸 업체·판매처(교육이면 교육기관, 외부활동이면 요청한 기관). 상호 그대로"
        },
        "bizNo": {
          "type": "string",
          "max": 20,
          "desc": "공급자의 사업자등록번호(000-00-00000). 적혀 있지 않으면 null"
        },
        "quoteDate": {
          "type": "date",
          "desc": "견적일·발행일·주문일"
        },
        "items": {
          "type": "list",
          "max": 30,
          "desc": "품목. 문서의 품목 표에 적힌 차례대로 한 줄씩 — 교육이면 교육비 줄",
          "item": {
            "name": {
              "type": "string",
              "required": true,
              "max": 200,
              "desc": "품목명·모델명(문서에 적힌 그대로)"
            },
            "spec": {
              "type": "string",
              "max": 300,
              "desc": "규격·사양(문서에 적힌 핵심을 ' · ' 로 나열)"
            },
            "qty": {
              "type": "number",
              "min": 0,
              "desc": "수량"
            },
            "unit": {
              "type": "string",
              "max": 10,
              "desc": "단위(개·대·EA·식 등)"
            },
            "unitPrice": {
              "type": "number",
              "min": 0,
              "desc": "단가"
            },
            "amount": {
              "type": "number",
              "min": 0,
              "desc": "그 줄의 금액(문서에 적힌 그대로)"
            }
          }
        },
        "supply": {
          "type": "number",
          "min": 0,
          "desc": "공급가액 합계(부가세를 뺀 금액) — 문서에 따로 적혀 있을 때만"
        },
        "vat": {
          "type": "number",
          "min": 0,
          "desc": "부가세 합계 — 문서에 따로 적혀 있을 때만"
        },
        "total": {
          "type": "number",
          "min": 0,
          "desc": "부가세를 포함한 최종 합계(결제·청구할 금액)"
        },
        "currency": {
          "type": "enum",
          "values": [
            "KRW",
            "USD",
            "EUR",
            "JPY",
            "CNY",
            "GBP"
          ],
          "desc": "화폐(ISO 세 글자 코드)"
        },
        "gist": {
          "type": "string",
          "required": true,
          "max": 60,
          "desc": "제목에 쓸 짧은 이름 — 구매면 대표 품목(여러 개면 \"… 외 N건\"), 교육이면 교육명, 출장이면 행사·회의명, 외부활동이면 활동명(강의 제목·자문 주제)"
        },
        "use": {
          "type": "string",
          "max": 120,
          "desc": "쓰임 — 구매면 품목의 용도, 교육이면 교육 목적, 출장이면 출장 목적(\"○○ 학회 참석 및 발표\"), 외부활동이면 활동 목적(\"○○ 대학 특강으로 연구 성과 확산\")을 짧은 구절로"
        },
        "courseName": {
          "type": "string",
          "max": 150,
          "desc": "교육명(교육 문서일 때만)"
        },
        "courseFrom": {
          "type": "date",
          "desc": "교육 시작일"
        },
        "courseTo": {
          "type": "date",
          "desc": "교육 종료일"
        },
        "courseHours": {
          "type": "string",
          "max": 50,
          "desc": "교육시간(예: \"3일 21시간\", \"09:00~18:00\")"
        },
        "place": {
          "type": "string",
          "max": 100,
          "desc": "교육장소 또는 외부활동 장소(온라인이면 \"온라인\")"
        },
        "topics": {
          "type": "string",
          "max": 400,
          "desc": "교육 내용 — 커리큘럼·주요 강의 주제, 또는 외부활동 내용(강의 주제·자문 사항·심사 대상)을 \" · \" 로 나열(교육·외부활동 문서일 때만)"
        },
        "tripPlace": {
          "type": "string",
          "max": 100,
          "desc": "출장지 — 행사·회의가 열리는 도시와 기관(출장 문서일 때만, 예: \"대전(한국기계연구원)\")"
        },
        "tripFrom": {
          "type": "date",
          "desc": "출장 시작일 — 행사·회의의 시작일(출장 문서일 때만)"
        },
        "tripTo": {
          "type": "date",
          "desc": "출장 종료일 — 행사·회의의 종료일(출장 문서일 때만)"
        },
        "activityType": {
          "type": "enum",
          "values": [
            "lecture",
            "advisory",
            "review",
            "talk",
            "committee",
            "writing",
            "other"
          ],
          "desc": "외부활동 구분(외부활동 문서일 때만). lecture(강의·특강)·advisory(자문)·review(심사·평가)·talk(발표·강연)·committee(위원·위원회 활동)·writing(집필·기고)·other(그 밖)"
        },
        "actFrom": {
          "type": "date",
          "desc": "외부활동 시작일(외부활동 문서일 때만)"
        },
        "actTo": {
          "type": "date",
          "desc": "외부활동 종료일 — 하루면 시작일과 같다(외부활동 문서일 때만)"
        },
        "actHours": {
          "type": "string",
          "max": 50,
          "desc": "외부활동 시간(예: \"14:00~16:00 (2시간)\", 외부활동 문서일 때만)"
        },
        "parts": {
          "type": "list",
          "max": 10,
          "desc": "파일. 첨부한 파일마다 무슨 문서인지 — 공문의 첨부 목록이 된다. 글만 붙여 넣었으면 null",
          "item": {
            "file": {
              "type": "string",
              "required": true,
              "max": 200,
              "desc": "파일 이름(입력에 적힌 그대로)"
            },
            "kind": {
              "type": "enum",
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
              ],
              "desc": "quote(견적서)·statement(거래명세서·청구서)·order(주문 화면·예약 내역)·course(교육 안내문·신청 확인서)·content(교육 내용·커리큘럼·강의 계획·행사 일정·외부활동 자료)·event(행사·회의·학회 안내문·초청장)·request(외부활동 요청 공문·요청 메일·위촉장)·other(그 밖)"
            }
          }
        },
        "quoteArea": {
          "type": "list",
          "max": 4,
          "desc": "견적서로 오릴 칸. 구매·교육이고 견적서 양식이 아닌 화면(쇼핑몰 상품·장바구니·주문 화면, 온라인 강의·교육 신청 화면 캡처)일 때만, 가격과 그 둘레가 든 칸을 그림마다 한 줄로. 그 밖에는 null",
          "item": {
            "file": {
              "type": "string",
              "required": true,
              "max": 200,
              "desc": "그림 파일 이름(입력에 적힌 그대로)"
            },
            "left": {
              "type": "number",
              "required": true,
              "min": 0,
              "max": 100,
              "desc": "칸의 왼쪽 끝 — 그림 폭의 %(0 이 왼쪽 끝)"
            },
            "top": {
              "type": "number",
              "required": true,
              "min": 0,
              "max": 100,
              "desc": "칸의 위쪽 끝 — 그림 높이의 %(0 이 맨 위)"
            },
            "right": {
              "type": "number",
              "required": true,
              "min": 0,
              "max": 100,
              "desc": "칸의 오른쪽 끝 — 그림 폭의 %(100 이 오른쪽 끝)"
            },
            "bottom": {
              "type": "number",
              "required": true,
              "min": 0,
              "max": 100,
              "desc": "칸의 아래쪽 끝 — 그림 높이의 %(100 이 맨 아래)"
            }
          }
        },
        "summary": {
          "type": "string",
          "required": true,
          "max": 200,
          "desc": "문서를 한 줄로 요약(한국어)"
        }
      },
      "checks": [
        {
          "left": "courseFrom",
          "op": "<=",
          "right": "courseTo",
          "drop": "courseTo",
          "message": "교육 종료일이 시작일보다 앞서 종료일은 뺐습니다"
        },
        {
          "left": "tripFrom",
          "op": "<=",
          "right": "tripTo",
          "drop": "tripTo",
          "message": "출장 종료일이 시작일보다 앞서 종료일은 뺐습니다"
        },
        {
          "left": "actFrom",
          "op": "<=",
          "right": "actTo",
          "drop": "actTo",
          "message": "외부활동 종료일이 시작일보다 앞서 종료일은 뺐습니다"
        }
      ],
      "rules": [
        "문서에 적힌 것만 채웁니다. 적혀 있지 않은 값은 null 이고, 추측하거나 지어내지 않습니다. use 만 예외입니다(아래).",
        "금액은 쉼표·통화 기호 없이 숫자만 적습니다. 날짜는 YYYY-MM-DD 입니다.",
        "total 은 부가세를 포함한 최종 금액입니다. 할인이 있으면 할인을 뺀 금액입니다. 문서에 \"부가세 별도\"이고 합계가 공급가액뿐이면 total 은 null 로 두고 supply 에 적습니다 — 셈해 넣지 않습니다.",
        "items 는 문서의 품목 표를 차례대로 옮깁니다. 배송비·설치비처럼 따로 적힌 줄도 품목으로 넣습니다. name 은 문서에 적힌 품목명·모델명 그대로이고 요약하지 않습니다.",
        "쇼핑몰 화면이면 vendor 는 판매자(없으면 쇼핑몰 이름)이고 quoteDate 는 주문일입니다. 주문 전 장바구니·상품 화면이면 quoteDate 는 null 입니다.",
        "gist 는 공문 제목에 들어갑니다. 구매면 대표 품목을 짧게(모델 번호는 빼도 됩니다), 품목이 둘 이상이면 \"대표 품목 외 N건\" 으로 적고, 교육이면 교육명을 적습니다.",
        "use 는 공문의 용도·교육목적 칸의 초안입니다. 문서에 적혀 있으면 그대로, 없으면 품목(교육이면 교육 내용)으로 보아 연구부서에서 흔히 쓰는 쓰임을 한 구절로 적습니다(\"연구 데이터 저장·백업용\", \"전력변환 회로 설계 역량 강화\"). 사용자가 고칩니다. 사유는 여기서 쓰지 않습니다(과제 내용을 보고 따로 씁니다).",
        "course 로 시작하는 칸은 교육 문서일 때만, place·topics 는 교육·외부활동 문서일 때만 적고, 그 밖의 문서에서는 null 입니다. 교육비는 total 에 적습니다.",
        "출장이면 행사·회의·학회 안내문·초청장·출장 일정표에서 tripPlace(열리는 도시와 기관)·tripFrom·tripTo(행사 기간)를 적고, gist 에 행사·회의명, use 에 출장 목적(\"○○ 학회 참석 및 발표\")을 적습니다. 교통·숙박 견적서가 함께 있으면 그 합계를 total(예상경비)에 적고, 없으면 total 은 null 입니다. trip 으로 시작하는 칸은 출장 문서일 때만 적고 그 밖에는 null 입니다.",
        "외부활동 허가면 요청 공문·초청장·위촉 요청 메일·행사 안내문에서 vendor(요청한 기관), gist(활동명 — 강의 제목·자문 주제·심사 대상), activityType(강의·자문·심사·발표·위원·집필 가운데), actFrom·actTo(활동 기간 — 하루면 같은 날), actHours(활동 시간), place(장소), topics(활동 내용), use(활동 목적)를 적습니다. 사례비·강사료·자문료가 적혀 있으면 total 에, 없으면 total 은 null 입니다. activityType 과 act 로 시작하는 칸은 외부활동 문서일 때만 적고 그 밖에는 null 입니다.",
        "첨부한 파일이 여러 개면 같은 건의 문서들입니다(교육 견적서와 교육 내용 캡처, 견적서 여러 쪽 등). 값은 모두를 함께 보고 채우고, parts 에 파일마다 무슨 문서인지 적습니다. 교육 내용(커리큘럼·강의 계획) 화면은 content 이고, 그 내용은 topics 에 적습니다.",
        "교육 공문의 첨부는 교육 견적서와 교육 내용 둘입니다. 교육이면 parts 에서 견적서는 quote, 청구서는 statement, 수강료·결제 칸만 있는 장은 order 이고, 교육 안내·강의 소개·커리큘럼·수업 목록이 든 장은 content 입니다.",
        "quoteArea 는 구매·교육일 때만 적습니다. 첨부한 그림이 견적서·거래명세서 양식이 아니라 쇼핑몰 상품·장바구니·주문 화면처럼 가격이 화면 일부에만 있는 캡처이면, 가격과 그 둘레(상품명·모델·옵션·수량·단가·할인·배송비·합계·판매자)가 함께 든 칸을 그림의 % 로 적습니다 — 이 칸을 오려 공문의 견적서로 첨부합니다. 가격 글자가 잘리지 않게 넉넉히 잡고, 추천 상품·광고·리뷰·상품 상세 설명·메뉴는 넣지 않습니다. 그 칸이 두 장에 걸쳐 있으면 장마다 한 줄씩 위에서 아래 차례로 적습니다.",
        "교육이고 견적서 양식 없이 온라인 강의·교육 신청 화면(인프런·유데미 같은 강의 페이지)이면, 수강료(정가·할인가·결제 금액)와 그 둘레(강의명·교육기관·수강 기간·수강 옵션)가 함께 든 칸을 quoteArea 에 적습니다 — 이 칸을 오려 교육 견적서로 첨부합니다. 수강료가 보이지 않는 화면이면 null 입니다.",
        "구매라도 강의(온라인 강의·교육 상품)를 사는 화면이면 parts 에서 강의 소개·커리큘럼·수업 목록이 든 장은 content 입니다 — 오린 견적서와 함께 강의 내용으로 첨부합니다. 가격·결제 칸만 있는 장은 order 입니다.",
        "quoteArea 는 첨부한 문서에 견적서·거래명세서 양식이 있거나, 가격이 든 것이 PDF 이거나, 글만 붙여 넣었거나, 출장·외부활동이면 null 입니다.",
        "품의에 넣을 문서가 아닌 화면(결재 화면·이 프로그램의 화면·메일 목록 등)이면 docType 은 unknown 이고 나머지 값은 null 이며, gist 와 summary 에 무슨 화면인지 적습니다.",
        "summary 는 무엇의 어떤 문서인지 한 줄로 적습니다(\"OO상사 모니터 외 1건 견적서 989,000원\")."
      ]
    },
    "gongmunSetup": {
      "title": "공문 사전 설정(과제·과제책임자·과제 별명·연구기간·부서장·참조자) 조각",
      "kinds": [
        "gongmun"
      ],
      "partial": true,
      "consumer": {
        "module": "src/gongmun.js",
        "export": "mergeSetup"
      },
      "next": "src/gongmun.js mergeSetup 이 사전 설정에 얹는다 → 사용자가 사전 설정 칸에서 확인한다(저장은 패널이 한다)",
      "role": "당신은 전자결재 품의 작성 도우미입니다. 사용자가 붙여 넣은 글(과제 목록 표를 복사한 것, 메모, 문장)에서 품의의 사전 설정에 넣을 값을 뽑습니다. 입력에는 지금 등록된 사전 설정(JSON)과 새 글이 들어 있습니다.",
      "fields": {
        "projects": {
          "type": "list",
          "max": 5,
          "desc": "과제. 글에 나온 과제마다 한 줄 — 과제가 나오지 않았으면 null",
          "item": {
            "name": {
              "type": "string",
              "required": true,
              "max": 200,
              "desc": "과제명(글에 적힌 그대로 — 전자결재 과제 찾기에 그대로 쓴다)"
            },
            "code": {
              "type": "string",
              "max": 40,
              "desc": "과제번호(예: RND-20-2026)"
            },
            "lead": {
              "type": "string",
              "max": 40,
              "desc": "과제책임자 이름 — 품의의 합의자가 된다"
            },
            "alias": {
              "type": "string",
              "max": 60,
              "desc": "과제 별명(약칭·줄임말) — 글에 \"별명\"·\"약칭\" 으로 적혀 있을 때만. 교육·출장 품의 제목 \"<별명> 수행을 위한 … 품의\" 에 들어간다"
            },
            "period": {
              "type": "string",
              "max": 60,
              "desc": "연구기간 — 글에 적힌 그대로(예: 2026.04.01 ~ 2029.12.31). 본문 과제 개요에 들어간다"
            },
            "about": {
              "type": "string",
              "max": 300,
              "desc": "과제 개요 — 글에 과제의 목적이 적혀 있을 때만. \"…을 수행하고 있습니다\" 로 끝나는 한 구절(본문 첫 줄에 들어간다)"
            },
            "content": {
              "type": "string",
              "max": 3000,
              "desc": "과제 내용 — 연구목표·연구내용·과제 설명을 글에 적힌 그대로(품의 사유를 쓰는 근거가 된다)"
            }
          }
        },
        "dept": {
          "type": "string",
          "max": 100,
          "desc": "기안 부서(예: 연구본부 수소전기추진연구팀)"
        },
        "lead": {
          "type": "string",
          "max": 40,
          "desc": "과제를 말하지 않고 과제책임자(합의자)만 적었을 때 그 이름 — 입력의 \"지금 고른 과제\"의 합의자가 된다"
        },
        "content": {
          "type": "string",
          "max": 3000,
          "desc": "과제를 말하지 않고 과제 내용(연구목표·연구내용)만 붙여 넣었을 때 그 글 — 입력의 \"지금 고른 과제\"의 내용이 된다"
        },
        "alias": {
          "type": "string",
          "max": 60,
          "desc": "과제를 말하지 않고 과제 별명만 적었을 때 그 별명 — 입력의 \"지금 고른 과제\"의 별명이 된다"
        },
        "period": {
          "type": "string",
          "max": 60,
          "desc": "과제를 말하지 않고 연구기간만 적었을 때 그 기간 — 입력의 \"지금 고른 과제\"의 연구기간이 된다"
        },
        "head": {
          "type": "string",
          "max": 40,
          "desc": "부서장 이름(품의의 결재자)"
        },
        "refs": {
          "type": "string",
          "max": 300,
          "desc": "참조자 이름들 — 쉼표로 나눈 전체 목록"
        },
        "reply": {
          "type": "string",
          "max": 300,
          "desc": "무엇을 채웠는지 한국어 한 문장"
        }
      },
      "rules": [
        "글에 적힌 것만 채웁니다. 적혀 있지 않은 값은 null 이고, 추측하거나 지어내지 않습니다.",
        "사람 칸(lead·head·refs)에는 이름만 적습니다 — 직급·직책(수석·책임·선임·팀장·PI 등)과 존칭은 뗍니다(\"박기도 책임\" → \"박기도\").",
        "\"책임자\"·\"연구책임자\"·\"과제책임자\"·\"PI\"·\"합의자\"·\"합의\" 로 적힌 사람은 그 과제의 lead 입니다. \"부서장\"·\"팀장\"·\"결재\" 로 적힌 사람은 head, \"참조\" 로 적힌 사람들은 refs 입니다.",
        "표를 복사한 글이면 줄마다 과제 하나입니다. 과제명·과제번호·책임자 칸을 가려 넣고, 머리글 줄(과제명·책임자 같은 제목만 있는 줄)은 과제가 아닙니다.",
        "지금 등록된 과제와 이름(또는 번호)이 같은 과제는 같은 과제입니다 — 그 과제의 이름을 그대로 적고 바뀐 칸만 채웁니다.",
        "refs 는 참조자 전체 목록입니다. 지금 등록된 참조자에 더하라고 했으면 그들도 함께 적고, 바꾸라고 했으면 새 목록만 적습니다.",
        "과제는 다섯 개까지 등록합니다. 글에 그보다 많으면 처음 다섯 개만 적고 reply 에 그 사실을 적습니다.",
        "과제를 말하지 않고 \"합의자 ○○○\"·\"책임자 ○○○\" 처럼 사람만 적었으면 projects 는 null 이고 lead 에 그 이름을 적습니다. 과제를 말했으면 lead 는 null 입니다(그 과제 줄의 lead 에 적습니다).",
        "과제 내용(연구목표·연구내용·과제 설명)은 요약하지 않고 글에 적힌 그대로 content 에 옮깁니다. 과제를 말했으면 그 과제 줄의 content 에, 과제 없이 내용만 붙여 넣었으면 바깥 content 에 적습니다.",
        "\"별명\"·\"약칭\"·\"줄여서\" 로 적힌 짧은 이름은 alias, \"연구기간\"·\"과제기간\"·\"기간\" 으로 적힌 기간은 period 입니다. 과제명을 줄여 별명을 지어내지 않습니다. 과제를 말했으면 그 과제 줄에, 과제 없이 적었으면 바깥 alias·period 에 적습니다.",
        "reply 에는 무엇을 채웠는지만 한 문장으로 적습니다(\"과제 2개와 합의자를 채웠습니다\")."
      ]
    },
    "gongmunReason": {
      "title": "품의 사유(구매사유·교육사유·출장사유·외부활동 신청사유)와 용도·교육목적·출장목적·활동목적 쓰기",
      "kinds": [
        "purchase",
        "edu",
        "trip",
        "outside"
      ],
      "consumer": {
        "module": "src/gongmun.js",
        "export": "applyReason"
      },
      "next": "src/gongmun.js applyReason 이 초안의 사유·용도 칸에 넣는다 → 사용자가 고친다 → compose 가 본문에 넣는다",
      "role": "당신은 연구부서의 전자결재 품의 작성 도우미입니다. 입력의 과제 정보(과제명·과제 내용)와 품의할 것(구매 품목·교육·출장·외부활동)을 보고 품의 본문의 사유와 용도(교육이면 교육목적, 출장이면 출장목적, 외부활동이면 활동목적)를 공문체로 씁니다. 입력에 사용자의 말이 있으면 그 요청대로 고쳐 씁니다.",
      "fields": {
        "reason": {
          "type": "string",
          "required": true,
          "max": 400,
          "desc": "사유 — 구매면 구매사유, 교육이면 교육사유, 출장이면 출장사유, 외부활동 허가면 신청사유. 과제 내용과 이어지는 필요성을 1~2문장으로, \"…필요함\" 처럼 명사형으로 끝맺는다"
        },
        "use": {
          "type": "string",
          "max": 120,
          "desc": "구매면 용도, 교육이면 교육목적, 출장이면 출장목적, 외부활동이면 활동목적 — 짧은 구절(끝에 마침표 없이)"
        },
        "reply": {
          "type": "string",
          "max": 200,
          "desc": "사용자의 말이 있을 때 무엇을 어떻게 고쳤는지(또는 왜 못 고쳤는지) 한 줄. 사용자의 말이 없으면 null"
        }
      },
      "rules": [
        "과제 내용이 R&D 탭의 연구 내용이면 그 차년도의 연구개발 계획(개발목표·개발내용·성능목표·주요결과물·수행일정)과 진행 기록입니다. 그 가운데 품의할 것과 이어지는 목표·내용·결과물을 골라 사유의 근거로 삼습니다.",
        "입력에 \"사용자의 말\"이 있으면 그 요청대로 사유와 용도를 고쳐 씁니다 — 지금 적힌 사유가 있으면 그것을 바탕으로 합니다. 요청이 사유·용도와 무관하면 지금 적힌 것을 그대로 돌려주고 reply 에 그렇게 적습니다. 요청이어도 과제 내용에 없는 과업·수치는 지어내지 않습니다.",
        "사유는 과제 내용에 적힌 연구목표·연구내용을 근거로 씁니다. 과제 내용에 없는 연구 과업·수치·일정을 지어내지 않습니다.",
        "과제 내용이 비었거나 품의할 것과 이어지는 대목이 없으면, 과제명과 품목(교육) 자체의 쓰임만으로 일반적인 필요성을 씁니다.",
        "공문체로 씁니다 — 문장을 \"…필요함\"·\"…위함\" 처럼 명사형으로 끝맺고, 경어·구어(\"합니다\", \"해요\")를 쓰지 않습니다.",
        "금액·업체·날짜는 사유에 넣지 않습니다(본문의 다른 줄에 있습니다).",
        "use 는 구매면 품목의 쓰임(\"연구 데이터 저장·백업용\"), 교육이면 교육 내용으로 보아 무엇의 역량을 기르는지(\"전력변환 회로 설계 역량 강화\"), 출장이면 무엇을 하러 가는지(\"○○ 학회 참석 및 연구 결과 발표\"), 외부활동이면 그 활동이 과제·기관에 어떤 뜻인지(\"○○ 대학 특강을 통한 연구 성과 확산\")를 짧은 구절로 씁니다. 입력에 이미 적힌 용도(교육목적·출장목적·활동목적)가 있으면 그것을 다듬어 씁니다.",
        "외부활동 허가의 신청사유는 그 활동(강의·자문·심사·발표·위원 활동)이 과제 수행이나 연구 성과의 확산·활용과 어떻게 이어지는지, 직무와 상충하지 않는지를 적습니다."
      ]
    },
    "diagnose": {
      "title": "예약 실패 원인 설명",
      "kinds": [
        "room",
        "car"
      ],
      "consumer": {
        "module": "src/llm.js",
        "export": "diagnoseSmart"
      },
      "next": "없음 — 화면·활동 기록에 표시만 한다",
      "role": "당신은 ASP.NET WebForms 사내 시스템에 회의실·차량 예약을 자동 제출하는 프로그램의 진단 도우미입니다. 예약을 제출했지만 다시 조회했을 때 그 예약이 보이지 않았습니다. 입력은 저장 요청에 보낸 값과, 응답 페이지에서 **제출 전과 달라진 부분만** 추린 요약(JSON)입니다. 회의실인지 차량인지는 요약의 \"대상\" 이 알려 줍니다.",
      "fields": {
        "verdict": {
          "type": "enum",
          "required": true,
          "values": [
            "rejected",
            "maybe_saved",
            "unknown"
          ],
          "desc": "사이트가 거부한 것인지(rejected), 저장은 된 것 같은데 화면에 안 보이는 것인지(maybe_saved), 알 수 없는지(unknown)"
        },
        "siteMessage": {
          "type": "string",
          "max": 300,
          "desc": "사이트가 사용자에게 실제로 띄운 문구"
        },
        "cause": {
          "type": "string",
          "required": true,
          "max": 400,
          "desc": "원인을 한국어 한두 문장으로"
        },
        "fix": {
          "type": "string",
          "max": 200,
          "desc": "사용자가 할 수 있는 조치를 한국어 한 문장으로"
        }
      },
      "rules": [
        "응답에 새로 나타난 alert/스크립트나 안내 문구가 거부 사유를 말하고 있으면 verdict 는 rejected 입니다.",
        "거부 흔적이 전혀 없고 폼 값도 정상이면 verdict 는 maybe_saved 입니다(승인 대기 등으로 목록에 안 보일 수 있음).",
        "근거가 부족하면 verdict 는 unknown 입니다.",
        "예약이 됐는지 안 됐는지는 이미 재조회로 확인했습니다. 원인만 설명합니다.",
        "추측을 사실처럼 쓰지 않습니다. 근거가 없으면 없다고 합니다.",
        "한국어로, 짧고 구체적으로 씁니다."
      ]
    }
  }
};
