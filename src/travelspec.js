// 생성물 — 고치지 않는다. travel-rules.yaml·ktx-fares.yaml(·ktx-fares-official.yaml)·air-mileage.yaml 을 고치고 `node tools/gen-travel.mjs` 를 돌린다.
export const TRAVEL_RULES = {
  "version": 1,
  "period": {
    "day_trip": {
      "code": "1",
      "label": "당일출장(주재국)",
      "when": "출발일과 도착일이 같은 날(며칠간 = 1)",
      "area": "O"
    },
    "general": {
      "code": "0",
      "label": "일반출장",
      "when": "1박 이상(며칠간 >= 2)"
    }
  },
  "nation": {
    "code": "KR||",
    "label": "대한민국"
  },
  "daily": {
    "per_day": 1
  },
  "meals": {
    "per_day": 3,
    "lunch": "always",
    "breakfast": {
      "first_day_depart_hour_at_most": 7
    },
    "dinner": {
      "last_day_arrive_hour_at_least": 20
    }
  },
  "transport": {
    "method": {
      "code": "E",
      "label": "대중교통"
    },
    "choices": [
      {
        "value": "train",
        "label": "기차(KTX)",
        "site": "Train",
        "auto": true
      },
      {
        "value": "plane",
        "label": "비행기",
        "site": "Airplane",
        "auto": false
      },
      {
        "value": "bus",
        "label": "버스",
        "site": "Bus",
        "auto": false
      }
    ],
    "default": "train",
    "train": {
      "grade": "standard",
      "grade_labels": {
        "standard": "일반석",
        "first": "특실"
      },
      "currency": "KRW",
      "link_site_fee": true
    }
  },
  "lodging": {
    "over_cap": {
      "approve_rate": 1.5,
      "approver": "부서장",
      "source": "사용자 지정(2026-10-05) — 규정 원문은 확인하지 못함",
      "checked": null
    }
  }
};

export const KTX_FARES = {
  "version": 1,
  "weekend_days": [
    "금",
    "토",
    "일"
  ],
  "routes": [
    {
      "a": "행신",
      "b": "서울",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "행신",
      "b": "광명",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "행신",
      "b": "천안아산",
      "standard": 14200,
      "first": 20600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "행신",
      "b": "오송",
      "standard": 18200,
      "first": 26400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "행신",
      "b": "대전",
      "standard": 22900,
      "first": 33200,
      "source": "official",
      "hours": 2
    },
    {
      "a": "행신",
      "b": "김천구미",
      "standard": 33200,
      "first": 48100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "동대구",
      "standard": 40300,
      "first": 58400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "경주",
      "standard": 45800,
      "first": 66400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "울산",
      "standard": 49800,
      "first": 72200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "부산",
      "standard": 55700,
      "first": 80800,
      "source": "official",
      "hours": 4
    },
    {
      "a": "서울",
      "b": "광명",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서울",
      "b": "천안아산",
      "standard": 12800,
      "first": 18600,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서울",
      "b": "오송",
      "standard": 16900,
      "first": 24500,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서울",
      "b": "대전",
      "standard": 21600,
      "first": 31300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서울",
      "b": "김천구미",
      "standard": 31900,
      "first": 46300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서울",
      "b": "동대구",
      "standard": 39000,
      "first": 56600,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "경주",
      "standard": 44500,
      "first": 64500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "울산",
      "standard": 48400,
      "first": 70200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "부산",
      "standard": 54400,
      "first": 78900,
      "source": "official",
      "hours": 4
    },
    {
      "a": "광명",
      "b": "천안아산",
      "standard": 10600,
      "first": 15400,
      "source": "official",
      "hours": 1
    },
    {
      "a": "광명",
      "b": "오송",
      "standard": 14700,
      "first": 21300,
      "source": "official",
      "hours": 1
    },
    {
      "a": "광명",
      "b": "대전",
      "standard": 19400,
      "first": 28100,
      "source": "official",
      "hours": 1
    },
    {
      "a": "광명",
      "b": "김천구미",
      "standard": 29800,
      "first": 43200,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광명",
      "b": "동대구",
      "standard": 36900,
      "first": 53500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광명",
      "b": "경주",
      "standard": 42300,
      "first": 61300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "울산",
      "standard": 46300,
      "first": 67100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "부산",
      "standard": 52200,
      "first": 75700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "천안아산",
      "b": "오송",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "천안아산",
      "b": "대전",
      "standard": 8800,
      "first": 12800,
      "source": "official",
      "hours": 1
    },
    {
      "a": "천안아산",
      "b": "김천구미",
      "standard": 19200,
      "first": 27800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "동대구",
      "standard": 26400,
      "first": 38300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "경주",
      "standard": 31900,
      "first": 46300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "울산",
      "standard": 35800,
      "first": 51900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "부산",
      "standard": 41800,
      "first": 60600,
      "source": "official",
      "hours": 3
    },
    {
      "a": "오송",
      "b": "대전",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "오송",
      "b": "김천구미",
      "standard": 15100,
      "first": 21900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "오송",
      "b": "동대구",
      "standard": 22300,
      "first": 32300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "경주",
      "standard": 27800,
      "first": 40300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "울산",
      "standard": 31800,
      "first": 46100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "부산",
      "standard": 37800,
      "first": 54800,
      "source": "official",
      "hours": 3
    },
    {
      "a": "대전",
      "b": "김천구미",
      "standard": 10400,
      "first": 15100,
      "source": "official",
      "hours": 1
    },
    {
      "a": "대전",
      "b": "동대구",
      "standard": 17600,
      "first": 25500,
      "source": "official",
      "hours": 1
    },
    {
      "a": "대전",
      "b": "경주",
      "standard": 23100,
      "first": 33500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "대전",
      "b": "울산",
      "standard": 27200,
      "first": 39400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "대전",
      "b": "부산",
      "standard": 33100,
      "first": 48000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "김천구미",
      "b": "동대구",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "김천구미",
      "b": "경주",
      "standard": 12800,
      "first": 18600,
      "source": "official",
      "hours": 1
    },
    {
      "a": "김천구미",
      "b": "울산",
      "standard": 16700,
      "first": 24200,
      "source": "official",
      "hours": 2
    },
    {
      "a": "김천구미",
      "b": "부산",
      "standard": 22800,
      "first": 33100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동대구",
      "b": "경주",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "동대구",
      "b": "울산",
      "standard": 9500,
      "first": 13800,
      "source": "official",
      "hours": 1
    },
    {
      "a": "동대구",
      "b": "부산",
      "standard": 15600,
      "first": 22600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "경주",
      "b": "울산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "경주",
      "b": "부산",
      "standard": 10100,
      "first": 14600,
      "source": "official",
      "hours": 1
    },
    {
      "a": "울산",
      "b": "부산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "행신",
      "b": "서대구",
      "standard": 39300,
      "first": 57000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "서대구",
      "standard": 37900,
      "first": 55000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "서대구",
      "standard": 35900,
      "first": 52100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "서대구",
      "standard": 25300,
      "first": 36700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "서대구",
      "standard": 21300,
      "first": 30900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "대전",
      "b": "서대구",
      "standard": 16600,
      "first": 24100,
      "source": "official",
      "hours": 1
    },
    {
      "a": "김천구미",
      "b": "서대구",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서대구",
      "b": "동대구",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서대구",
      "b": "경주",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서대구",
      "b": "울산",
      "standard": 10300,
      "first": 14900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서대구",
      "b": "부산",
      "standard": 16300,
      "first": 23600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "행신",
      "b": "경산",
      "standard": 41400,
      "first": 60000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "밀양",
      "standard": 45300,
      "first": 65700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "물금",
      "standard": 48000,
      "first": 69600,
      "source": "official",
      "hours": 4
    },
    {
      "a": "행신",
      "b": "구포",
      "standard": 49200,
      "first": 71300,
      "source": "official",
      "hours": 4
    },
    {
      "a": "서울",
      "b": "경산",
      "standard": 40100,
      "first": 58100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "밀양",
      "standard": 43900,
      "first": 63700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "물금",
      "standard": 46600,
      "first": 67600,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "구포",
      "standard": 47800,
      "first": 69300,
      "source": "official",
      "hours": 4
    },
    {
      "a": "광명",
      "b": "경산",
      "standard": 37900,
      "first": 55000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광명",
      "b": "밀양",
      "standard": 41800,
      "first": 60600,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "물금",
      "standard": 44600,
      "first": 64700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "구포",
      "standard": 45700,
      "first": 66300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "천안아산",
      "b": "경산",
      "standard": 27600,
      "first": 40000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "밀양",
      "standard": 31400,
      "first": 45500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "물금",
      "standard": 34100,
      "first": 49400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "천안아산",
      "b": "구포",
      "standard": 35300,
      "first": 51200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "오송",
      "b": "경산",
      "standard": 23400,
      "first": 33900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "밀양",
      "standard": 27300,
      "first": 39600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "물금",
      "standard": 30100,
      "first": 43600,
      "source": "official",
      "hours": 3
    },
    {
      "a": "오송",
      "b": "구포",
      "standard": 31100,
      "first": 45100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "대전",
      "b": "경산",
      "standard": 18700,
      "first": 27100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "대전",
      "b": "밀양",
      "standard": 22700,
      "first": 32900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "대전",
      "b": "물금",
      "standard": 25400,
      "first": 36800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "대전",
      "b": "구포",
      "standard": 26600,
      "first": 38600,
      "source": "official",
      "hours": 3
    },
    {
      "a": "김천구미",
      "b": "경산",
      "standard": 8300,
      "first": 12000,
      "source": "official",
      "hours": 1
    },
    {
      "a": "김천구미",
      "b": "밀양",
      "standard": 12200,
      "first": 17700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "김천구미",
      "b": "물금",
      "standard": 15100,
      "first": 21900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "김천구미",
      "b": "구포",
      "standard": 16200,
      "first": 23500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동대구",
      "b": "경산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "동대구",
      "b": "밀양",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "동대구",
      "b": "물금",
      "standard": 8500,
      "first": 12300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동대구",
      "b": "구포",
      "standard": 9700,
      "first": 14100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "경산",
      "b": "밀양",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "경산",
      "b": "물금",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "경산",
      "b": "구포",
      "standard": 8500,
      "first": 12300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "경산",
      "b": "부산",
      "standard": 10200,
      "first": 14800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "밀양",
      "b": "물금",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "밀양",
      "b": "구포",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "밀양",
      "b": "부산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "물금",
      "b": "구포",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "물금",
      "b": "부산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "구포",
      "b": "부산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서대구",
      "b": "경산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서대구",
      "b": "밀양",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서대구",
      "b": "물금",
      "standard": 9200,
      "first": 13300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서대구",
      "b": "구포",
      "standard": 10500,
      "first": 15200,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서울",
      "b": "영등포",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서울",
      "b": "수원",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "영등포",
      "b": "수원",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "영등포",
      "b": "대전",
      "standard": 15500,
      "first": 22500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "영등포",
      "b": "김천구미",
      "standard": 24600,
      "first": 35700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "영등포",
      "b": "동대구",
      "standard": 31800,
      "first": 46100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "영등포",
      "b": "경주",
      "standard": 37200,
      "first": 53900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "영등포",
      "b": "울산",
      "standard": 41200,
      "first": 59500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "영등포",
      "b": "부산",
      "standard": 47200,
      "first": 67400,
      "source": "official",
      "hours": 4
    },
    {
      "a": "수원",
      "b": "대전",
      "standard": 12300,
      "first": 17800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "수원",
      "b": "김천구미",
      "standard": 21700,
      "first": 31500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "수원",
      "b": "동대구",
      "standard": 28900,
      "first": 41900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수원",
      "b": "경주",
      "standard": 34300,
      "first": 49700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수원",
      "b": "울산",
      "standard": 38300,
      "first": 55500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수원",
      "b": "부산",
      "standard": 44300,
      "first": 64200,
      "source": "official",
      "hours": 4
    },
    {
      "a": "행신",
      "b": "진영",
      "standard": 47500,
      "first": 68900,
      "source": "official",
      "hours": 4
    },
    {
      "a": "행신",
      "b": "창원중앙",
      "standard": 48700,
      "first": 70600,
      "source": "official",
      "hours": 4
    },
    {
      "a": "행신",
      "b": "창원",
      "standard": 49600,
      "first": 71900,
      "source": "official",
      "hours": 4
    },
    {
      "a": "행신",
      "b": "마산",
      "standard": 50000,
      "first": 72500,
      "source": "official",
      "hours": 4
    },
    {
      "a": "행신",
      "b": "진주",
      "standard": 54400,
      "first": 78900,
      "source": "official",
      "hours": 5
    },
    {
      "a": "서울",
      "b": "진영",
      "standard": 46200,
      "first": 67000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "창원중앙",
      "standard": 47400,
      "first": 68700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "창원",
      "standard": 48400,
      "first": 70200,
      "source": "official",
      "hours": 4
    },
    {
      "a": "서울",
      "b": "마산",
      "standard": 48600,
      "first": 70500,
      "source": "official",
      "hours": 4
    },
    {
      "a": "서울",
      "b": "진주",
      "standard": 53100,
      "first": 77000,
      "source": "official",
      "hours": 4
    },
    {
      "a": "광명",
      "b": "진영",
      "standard": 44000,
      "first": 63800,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "창원중앙",
      "standard": 45300,
      "first": 65700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "창원",
      "standard": 46200,
      "first": 67000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "마산",
      "standard": 46500,
      "first": 67400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "진주",
      "standard": 50900,
      "first": 73800,
      "source": "official",
      "hours": 4
    },
    {
      "a": "천안아산",
      "b": "진영",
      "standard": 33600,
      "first": 48700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "천안아산",
      "b": "창원중앙",
      "standard": 34800,
      "first": 50500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "천안아산",
      "b": "창원",
      "standard": 35800,
      "first": 51900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "천안아산",
      "b": "마산",
      "standard": 36100,
      "first": 52300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "천안아산",
      "b": "진주",
      "standard": 40500,
      "first": 58700,
      "source": "official",
      "hours": 4
    },
    {
      "a": "오송",
      "b": "진영",
      "standard": 29500,
      "first": 42800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "창원중앙",
      "standard": 30800,
      "first": 44700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "오송",
      "b": "창원",
      "standard": 31700,
      "first": 46000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "오송",
      "b": "마산",
      "standard": 32100,
      "first": 46500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "오송",
      "b": "진주",
      "standard": 36400,
      "first": 52800,
      "source": "official",
      "hours": 3
    },
    {
      "a": "대전",
      "b": "진영",
      "standard": 24900,
      "first": 36100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "대전",
      "b": "창원중앙",
      "standard": 26100,
      "first": 37800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "대전",
      "b": "창원",
      "standard": 27000,
      "first": 39200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "대전",
      "b": "마산",
      "standard": 27400,
      "first": 39700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "대전",
      "b": "진주",
      "standard": 31900,
      "first": 46300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "김천구미",
      "b": "진영",
      "standard": 14500,
      "first": 21000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "김천구미",
      "b": "창원중앙",
      "standard": 15800,
      "first": 22900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "김천구미",
      "b": "창원",
      "standard": 16700,
      "first": 24200,
      "source": "official",
      "hours": 2
    },
    {
      "a": "김천구미",
      "b": "마산",
      "standard": 17100,
      "first": 24800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "김천구미",
      "b": "진주",
      "standard": 21500,
      "first": 31200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동대구",
      "b": "진영",
      "standard": 7900,
      "first": 11500,
      "source": "official",
      "hours": 1
    },
    {
      "a": "동대구",
      "b": "창원중앙",
      "standard": 9300,
      "first": 13500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동대구",
      "b": "창원",
      "standard": 10300,
      "first": 14900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동대구",
      "b": "마산",
      "standard": 10700,
      "first": 15500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동대구",
      "b": "진주",
      "standard": 15500,
      "first": 22500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "경산",
      "b": "진영",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "경산",
      "b": "창원중앙",
      "standard": 8100,
      "first": 11700,
      "source": "official",
      "hours": 1
    },
    {
      "a": "경산",
      "b": "창원",
      "standard": 9100,
      "first": 13200,
      "source": "official",
      "hours": 2
    },
    {
      "a": "경산",
      "b": "마산",
      "standard": 9500,
      "first": 13800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "경산",
      "b": "진주",
      "standard": 14300,
      "first": 20700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "밀양",
      "b": "진영",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "밀양",
      "b": "창원중앙",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "밀양",
      "b": "창원",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "밀양",
      "b": "마산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "밀양",
      "b": "진주",
      "standard": 10100,
      "first": 14600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "진영",
      "b": "창원중앙",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "진영",
      "b": "창원",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "진영",
      "b": "마산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "진영",
      "b": "진주",
      "standard": 7600,
      "first": 11000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "창원중앙",
      "b": "창원",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "창원중앙",
      "b": "마산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "창원중앙",
      "b": "진주",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "창원",
      "b": "마산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "창원",
      "b": "진주",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "마산",
      "b": "진주",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서대구",
      "b": "진영",
      "standard": 8600,
      "first": 12500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서대구",
      "b": "창원중앙",
      "standard": 10000,
      "first": 14500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서대구",
      "b": "창원",
      "standard": 11000,
      "first": 16000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서대구",
      "b": "마산",
      "standard": 11400,
      "first": 16500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서대구",
      "b": "진주",
      "standard": 16200,
      "first": 23500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "행신",
      "b": "포항",
      "standard": 50200,
      "first": 72800,
      "source": "official",
      "hours": 4
    },
    {
      "a": "서울",
      "b": "포항",
      "standard": 48800,
      "first": 70800,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "포항",
      "standard": 46800,
      "first": 67900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "천안아산",
      "b": "포항",
      "standard": 36300,
      "first": 52600,
      "source": "official",
      "hours": 3
    },
    {
      "a": "오송",
      "b": "포항",
      "standard": 32300,
      "first": 46800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "대전",
      "b": "포항",
      "standard": 27600,
      "first": 40000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "김천구미",
      "b": "포항",
      "standard": 17300,
      "first": 25100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동대구",
      "b": "포항",
      "standard": 10100,
      "first": 14600,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서대구",
      "b": "포항",
      "standard": 10700,
      "first": 15500,
      "source": "official",
      "hours": 1
    },
    {
      "a": "행신",
      "b": "용산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "행신",
      "b": "영등포",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "행신",
      "b": "공주",
      "standard": 24500,
      "first": 35500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "행신",
      "b": "익산",
      "standard": 30900,
      "first": 44800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "행신",
      "b": "정읍",
      "standard": 36800,
      "first": 53400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "광주송정",
      "standard": 43700,
      "first": 63400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "나주",
      "standard": 45100,
      "first": 65400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "목포",
      "standard": 49600,
      "first": 71900,
      "source": "official",
      "hours": 4
    },
    {
      "a": "서울",
      "b": "용산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서울",
      "b": "공주",
      "standard": 23200,
      "first": 33600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서울",
      "b": "익산",
      "standard": 29700,
      "first": 43100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서울",
      "b": "정읍",
      "standard": 35500,
      "first": 51500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서울",
      "b": "광주송정",
      "standard": 42400,
      "first": 61500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "나주",
      "standard": 43800,
      "first": 63500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "목포",
      "standard": 48300,
      "first": 70000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "용산",
      "b": "영등포",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "용산",
      "b": "광명",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "용산",
      "b": "천안아산",
      "standard": 12500,
      "first": 18100,
      "source": "official",
      "hours": 1
    },
    {
      "a": "용산",
      "b": "오송",
      "standard": 16600,
      "first": 24100,
      "source": "official",
      "hours": 1
    },
    {
      "a": "용산",
      "b": "공주",
      "standard": 22800,
      "first": 33100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "용산",
      "b": "익산",
      "standard": 29300,
      "first": 42500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "용산",
      "b": "정읍",
      "standard": 35200,
      "first": 51000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "용산",
      "b": "광주송정",
      "standard": 42000,
      "first": 60900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "용산",
      "b": "나주",
      "standard": 43500,
      "first": 63100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "용산",
      "b": "목포",
      "standard": 48000,
      "first": 69600,
      "source": "official",
      "hours": 3
    },
    {
      "a": "영등포",
      "b": "광명",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "영등포",
      "b": "천안아산",
      "standard": 11900,
      "first": 17300,
      "source": "official",
      "hours": 1
    },
    {
      "a": "영등포",
      "b": "오송",
      "standard": 16100,
      "first": 23300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "영등포",
      "b": "공주",
      "standard": 22400,
      "first": 32500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "영등포",
      "b": "익산",
      "standard": 28800,
      "first": 41800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "영등포",
      "b": "정읍",
      "standard": 34700,
      "first": 50300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "영등포",
      "b": "광주송정",
      "standard": 41600,
      "first": 60300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "영등포",
      "b": "나주",
      "standard": 42900,
      "first": 62200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "영등포",
      "b": "목포",
      "standard": 47500,
      "first": 68900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "공주",
      "standard": 21000,
      "first": 30500,
      "source": "official",
      "hours": 1
    },
    {
      "a": "광명",
      "b": "익산",
      "standard": 27500,
      "first": 39900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광명",
      "b": "정읍",
      "standard": 33400,
      "first": 48400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광명",
      "b": "광주송정",
      "standard": 40200,
      "first": 58300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광명",
      "b": "나주",
      "standard": 41700,
      "first": 60500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광명",
      "b": "목포",
      "standard": 46200,
      "first": 67000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "천안아산",
      "b": "공주",
      "standard": 10400,
      "first": 15100,
      "source": "official",
      "hours": 1
    },
    {
      "a": "천안아산",
      "b": "익산",
      "standard": 16900,
      "first": 24500,
      "source": "official",
      "hours": 1
    },
    {
      "a": "천안아산",
      "b": "정읍",
      "standard": 22800,
      "first": 33100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "광주송정",
      "standard": 29900,
      "first": 43400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "나주",
      "standard": 31200,
      "first": 45200,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "목포",
      "standard": 35700,
      "first": 51800,
      "source": "official",
      "hours": 3
    },
    {
      "a": "오송",
      "b": "공주",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "오송",
      "b": "익산",
      "standard": 12800,
      "first": 18600,
      "source": "official",
      "hours": 1
    },
    {
      "a": "오송",
      "b": "정읍",
      "standard": 18700,
      "first": 27100,
      "source": "official",
      "hours": 1
    },
    {
      "a": "오송",
      "b": "광주송정",
      "standard": 25700,
      "first": 37300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "나주",
      "standard": 27200,
      "first": 39400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "목포",
      "standard": 31700,
      "first": 46000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "공주",
      "b": "익산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "공주",
      "b": "정읍",
      "standard": 12400,
      "first": 18000,
      "source": "official",
      "hours": 1
    },
    {
      "a": "공주",
      "b": "광주송정",
      "standard": 19400,
      "first": 28100,
      "source": "official",
      "hours": 1
    },
    {
      "a": "공주",
      "b": "나주",
      "standard": 20900,
      "first": 30300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "공주",
      "b": "목포",
      "standard": 25500,
      "first": 37000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "익산",
      "b": "정읍",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "익산",
      "b": "광주송정",
      "standard": 13000,
      "first": 18900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "익산",
      "b": "나주",
      "standard": 14400,
      "first": 20900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "익산",
      "b": "목포",
      "standard": 19100,
      "first": 27700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "정읍",
      "b": "광주송정",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "정읍",
      "b": "나주",
      "standard": 8400,
      "first": 12200,
      "source": "official",
      "hours": 1
    },
    {
      "a": "정읍",
      "b": "목포",
      "standard": 13000,
      "first": 18900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광주송정",
      "b": "나주",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "광주송정",
      "b": "목포",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "나주",
      "b": "목포",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "행신",
      "b": "서대전",
      "standard": 23000,
      "first": 33400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "행신",
      "b": "계룡",
      "standard": 24800,
      "first": 36000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "논산",
      "standard": 27100,
      "first": 39300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "서대전",
      "standard": 21600,
      "first": 31300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서울",
      "b": "계룡",
      "standard": 23500,
      "first": 34100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서울",
      "b": "논산",
      "standard": 25800,
      "first": 37400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "용산",
      "b": "서대전",
      "standard": 21400,
      "first": 31000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "용산",
      "b": "계룡",
      "standard": 23200,
      "first": 33600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "용산",
      "b": "논산",
      "standard": 25500,
      "first": 37000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광명",
      "b": "서대전",
      "standard": 19500,
      "first": 28300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광명",
      "b": "계룡",
      "standard": 21300,
      "first": 30900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광명",
      "b": "논산",
      "standard": 23600,
      "first": 34200,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "서대전",
      "standard": 8900,
      "first": 12900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "천안아산",
      "b": "계룡",
      "standard": 10700,
      "first": 15500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "논산",
      "standard": 13000,
      "first": 18900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "서대전",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "오송",
      "b": "계룡",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "오송",
      "b": "논산",
      "standard": 8900,
      "first": 12900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서대전",
      "b": "계룡",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서대전",
      "b": "논산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서대전",
      "b": "익산",
      "standard": 8100,
      "first": 11700,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서대전",
      "b": "정읍",
      "standard": 13400,
      "first": 19400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서대전",
      "b": "광주송정",
      "standard": 20400,
      "first": 29600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서대전",
      "b": "나주",
      "standard": 21900,
      "first": 31800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서대전",
      "b": "목포",
      "standard": 26500,
      "first": 38400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "계룡",
      "b": "논산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "계룡",
      "b": "익산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "계룡",
      "b": "정읍",
      "standard": 11700,
      "first": 17000,
      "source": "official",
      "hours": 1
    },
    {
      "a": "계룡",
      "b": "광주송정",
      "standard": 18700,
      "first": 27100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "계룡",
      "b": "나주",
      "standard": 20100,
      "first": 29100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "계룡",
      "b": "목포",
      "standard": 24700,
      "first": 35800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "논산",
      "b": "익산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "논산",
      "b": "정읍",
      "standard": 9300,
      "first": 13500,
      "source": "official",
      "hours": 1
    },
    {
      "a": "논산",
      "b": "광주송정",
      "standard": 16400,
      "first": 23800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "논산",
      "b": "나주",
      "standard": 17800,
      "first": 25800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "논산",
      "b": "목포",
      "standard": 22400,
      "first": 32500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "행신",
      "b": "김제",
      "standard": 32600,
      "first": 47300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "장성",
      "standard": 37700,
      "first": 54700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "김제",
      "standard": 31200,
      "first": 45200,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서울",
      "b": "장성",
      "standard": 36400,
      "first": 52800,
      "source": "official",
      "hours": 3
    },
    {
      "a": "용산",
      "b": "김제",
      "standard": 30900,
      "first": 44800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "용산",
      "b": "장성",
      "standard": 36100,
      "first": 52300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광명",
      "b": "김제",
      "standard": 29100,
      "first": 42200,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광명",
      "b": "장성",
      "standard": 34300,
      "first": 49700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "김제",
      "standard": 18500,
      "first": 26800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "장성",
      "standard": 23800,
      "first": 34500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "김제",
      "standard": 14300,
      "first": 20700,
      "source": "official",
      "hours": 1
    },
    {
      "a": "오송",
      "b": "장성",
      "standard": 19700,
      "first": 28600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "공주",
      "b": "김제",
      "standard": 8000,
      "first": 11600,
      "source": "official",
      "hours": 1
    },
    {
      "a": "공주",
      "b": "장성",
      "standard": 13400,
      "first": 19400,
      "source": "official",
      "hours": 1
    },
    {
      "a": "익산",
      "b": "김제",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "익산",
      "b": "장성",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "김제",
      "b": "정읍",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "김제",
      "b": "장성",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "김제",
      "b": "광주송정",
      "standard": 7900,
      "first": 11500,
      "source": "official",
      "hours": 1
    },
    {
      "a": "김제",
      "b": "나주",
      "standard": 9400,
      "first": 13600,
      "source": "official",
      "hours": 1
    },
    {
      "a": "김제",
      "b": "목포",
      "standard": 14500,
      "first": 21000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "정읍",
      "b": "장성",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "장성",
      "b": "광주송정",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "장성",
      "b": "나주",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "장성",
      "b": "목포",
      "standard": 8700,
      "first": 12600,
      "source": "official",
      "hours": 1
    },
    {
      "a": "행신",
      "b": "전주",
      "standard": 33200,
      "first": 48100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "남원",
      "standard": 38100,
      "first": 55200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "곡성",
      "standard": 39600,
      "first": 57400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "행신",
      "b": "구례구",
      "standard": 41400,
      "first": 60000,
      "source": "official",
      "hours": 4
    },
    {
      "a": "행신",
      "b": "순천",
      "standard": 44000,
      "first": 63800,
      "source": "official",
      "hours": 4
    },
    {
      "a": "행신",
      "b": "여천",
      "standard": 46200,
      "first": 65900,
      "source": "official",
      "hours": 4
    },
    {
      "a": "행신",
      "b": "여수엑스포",
      "standard": 47100,
      "first": 67100,
      "source": "official",
      "hours": 4
    },
    {
      "a": "서울",
      "b": "전주",
      "standard": 31900,
      "first": 46300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서울",
      "b": "남원",
      "standard": 36700,
      "first": 53200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "곡성",
      "standard": 38300,
      "first": 55500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "구례구",
      "standard": 40100,
      "first": 58100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서울",
      "b": "순천",
      "standard": 42600,
      "first": 61800,
      "source": "official",
      "hours": 4
    },
    {
      "a": "서울",
      "b": "여천",
      "standard": 44900,
      "first": 65100,
      "source": "official",
      "hours": 4
    },
    {
      "a": "서울",
      "b": "여수엑스포",
      "standard": 45700,
      "first": 66300,
      "source": "official",
      "hours": 4
    },
    {
      "a": "용산",
      "b": "전주",
      "standard": 31600,
      "first": 45800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "용산",
      "b": "남원",
      "standard": 36400,
      "first": 52800,
      "source": "official",
      "hours": 3
    },
    {
      "a": "용산",
      "b": "곡성",
      "standard": 38000,
      "first": 55100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "용산",
      "b": "구례구",
      "standard": 39800,
      "first": 57700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "용산",
      "b": "순천",
      "standard": 42300,
      "first": 61300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "용산",
      "b": "여천",
      "standard": 44600,
      "first": 64700,
      "source": "official",
      "hours": 4
    },
    {
      "a": "용산",
      "b": "여수엑스포",
      "standard": 45400,
      "first": 65800,
      "source": "official",
      "hours": 4
    },
    {
      "a": "영등포",
      "b": "전주",
      "standard": 31100,
      "first": 45100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "영등포",
      "b": "남원",
      "standard": 35900,
      "first": 52100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "영등포",
      "b": "곡성",
      "standard": 37400,
      "first": 54200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "영등포",
      "b": "구례구",
      "standard": 39300,
      "first": 57000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "영등포",
      "b": "순천",
      "standard": 41800,
      "first": 60600,
      "source": "official",
      "hours": 4
    },
    {
      "a": "영등포",
      "b": "여천",
      "standard": 44100,
      "first": 63900,
      "source": "official",
      "hours": 4
    },
    {
      "a": "영등포",
      "b": "여수엑스포",
      "standard": 44900,
      "first": 65100,
      "source": "official",
      "hours": 4
    },
    {
      "a": "광명",
      "b": "전주",
      "standard": 29700,
      "first": 43100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "광명",
      "b": "남원",
      "standard": 34600,
      "first": 50200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "곡성",
      "standard": 36200,
      "first": 52500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "구례구",
      "standard": 38000,
      "first": 55100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "순천",
      "standard": 40500,
      "first": 58700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "여천",
      "standard": 42800,
      "first": 62100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "광명",
      "b": "여수엑스포",
      "standard": 43600,
      "first": 63200,
      "source": "official",
      "hours": 4
    },
    {
      "a": "천안아산",
      "b": "전주",
      "standard": 19200,
      "first": 27800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "남원",
      "standard": 24100,
      "first": 34900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "곡성",
      "standard": 25700,
      "first": 37300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "천안아산",
      "b": "구례구",
      "standard": 27500,
      "first": 39900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "천안아산",
      "b": "순천",
      "standard": 30000,
      "first": 43500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "천안아산",
      "b": "여천",
      "standard": 32300,
      "first": 46800,
      "source": "official",
      "hours": 3
    },
    {
      "a": "천안아산",
      "b": "여수엑스포",
      "standard": 33100,
      "first": 48000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "오송",
      "b": "전주",
      "standard": 15100,
      "first": 21900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "오송",
      "b": "남원",
      "standard": 20000,
      "first": 29000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "곡성",
      "standard": 21600,
      "first": 31300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "구례구",
      "standard": 23500,
      "first": 34100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "오송",
      "b": "순천",
      "standard": 25900,
      "first": 37600,
      "source": "official",
      "hours": 3
    },
    {
      "a": "오송",
      "b": "여천",
      "standard": 28200,
      "first": 40900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "오송",
      "b": "여수엑스포",
      "standard": 29100,
      "first": 42200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "공주",
      "b": "전주",
      "standard": 8800,
      "first": 12800,
      "source": "official",
      "hours": 1
    },
    {
      "a": "공주",
      "b": "남원",
      "standard": 13700,
      "first": 19900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "공주",
      "b": "곡성",
      "standard": 15400,
      "first": 22300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "공주",
      "b": "구례구",
      "standard": 17200,
      "first": 24900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "공주",
      "b": "순천",
      "standard": 19700,
      "first": 28600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "공주",
      "b": "여천",
      "standard": 22000,
      "first": 31900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "공주",
      "b": "여수엑스포",
      "standard": 22900,
      "first": 33200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "익산",
      "b": "전주",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "익산",
      "b": "남원",
      "standard": 7800,
      "first": 11300,
      "source": "official",
      "hours": 1
    },
    {
      "a": "익산",
      "b": "곡성",
      "standard": 9600,
      "first": 13900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "익산",
      "b": "구례구",
      "standard": 11600,
      "first": 16800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "익산",
      "b": "순천",
      "standard": 14300,
      "first": 20700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "익산",
      "b": "여천",
      "standard": 16800,
      "first": 24400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "익산",
      "b": "여수엑스포",
      "standard": 17800,
      "first": 25800,
      "source": "official",
      "hours": 3
    },
    {
      "a": "전주",
      "b": "남원",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "전주",
      "b": "곡성",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "전주",
      "b": "구례구",
      "standard": 9000,
      "first": 13100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "전주",
      "b": "순천",
      "standard": 11800,
      "first": 17100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "전주",
      "b": "여천",
      "standard": 14300,
      "first": 20700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "전주",
      "b": "여수엑스포",
      "standard": 15300,
      "first": 22200,
      "source": "official",
      "hours": 2
    },
    {
      "a": "남원",
      "b": "곡성",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "남원",
      "b": "구례구",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "남원",
      "b": "순천",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "남원",
      "b": "여천",
      "standard": 9000,
      "first": 13100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "남원",
      "b": "여수엑스포",
      "standard": 9900,
      "first": 14400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "곡성",
      "b": "구례구",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "곡성",
      "b": "순천",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "곡성",
      "b": "여천",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "곡성",
      "b": "여수엑스포",
      "standard": 8200,
      "first": 11900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "구례구",
      "b": "순천",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "구례구",
      "b": "여천",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "구례구",
      "b": "여수엑스포",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "순천",
      "b": "여천",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "순천",
      "b": "여수엑스포",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "여천",
      "b": "여수엑스포",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "서대전",
      "b": "전주",
      "standard": 10600,
      "first": 15400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서대전",
      "b": "남원",
      "standard": 15900,
      "first": 23100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서대전",
      "b": "곡성",
      "standard": 17700,
      "first": 25700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "서대전",
      "b": "구례구",
      "standard": 19700,
      "first": 28600,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서대전",
      "b": "순천",
      "standard": 22400,
      "first": 32500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서대전",
      "b": "여천",
      "standard": 24900,
      "first": 35900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "서대전",
      "b": "여수엑스포",
      "standard": 25900,
      "first": 37300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "계룡",
      "b": "전주",
      "standard": 8700,
      "first": 12600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "계룡",
      "b": "남원",
      "standard": 14000,
      "first": 20300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "계룡",
      "b": "곡성",
      "standard": 15700,
      "first": 22800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "계룡",
      "b": "구례구",
      "standard": 17700,
      "first": 25700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "계룡",
      "b": "순천",
      "standard": 20500,
      "first": 29700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "계룡",
      "b": "여천",
      "standard": 23000,
      "first": 33400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "계룡",
      "b": "여수엑스포",
      "standard": 23900,
      "first": 34500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "논산",
      "b": "전주",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "논산",
      "b": "남원",
      "standard": 11500,
      "first": 16700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "논산",
      "b": "곡성",
      "standard": 13200,
      "first": 19100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "논산",
      "b": "구례구",
      "standard": 15200,
      "first": 22000,
      "source": "official",
      "hours": 2
    },
    {
      "a": "논산",
      "b": "순천",
      "standard": 18000,
      "first": 26100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "논산",
      "b": "여천",
      "standard": 20500,
      "first": 29700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "논산",
      "b": "여수엑스포",
      "standard": 21400,
      "first": 31000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "동탄",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "수서",
      "b": "평택지제",
      "standard": 7700,
      "first": 11200,
      "source": "official",
      "hours": 1
    },
    {
      "a": "수서",
      "b": "천안아산",
      "standard": 11300,
      "first": 16400,
      "source": "official",
      "hours": 1
    },
    {
      "a": "수서",
      "b": "오송",
      "standard": 15400,
      "first": 22300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "수서",
      "b": "대전",
      "standard": 20100,
      "first": 29100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "수서",
      "b": "김천구미",
      "standard": 30400,
      "first": 44100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "수서",
      "b": "동대구",
      "standard": 37500,
      "first": 54400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "경주",
      "standard": 42900,
      "first": 62200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "울산",
      "standard": 47000,
      "first": 68200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "부산",
      "standard": 52900,
      "first": 76700,
      "source": "official",
      "hours": 4
    },
    {
      "a": "동탄",
      "b": "평택지제",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "동탄",
      "b": "천안아산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "동탄",
      "b": "오송",
      "standard": 10700,
      "first": 15500,
      "source": "official",
      "hours": 1
    },
    {
      "a": "동탄",
      "b": "대전",
      "standard": 15400,
      "first": 22300,
      "source": "official",
      "hours": 1
    },
    {
      "a": "동탄",
      "b": "김천구미",
      "standard": 25800,
      "first": 37400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동탄",
      "b": "동대구",
      "standard": 32900,
      "first": 47700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동탄",
      "b": "경주",
      "standard": 38400,
      "first": 55700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "울산",
      "standard": 42300,
      "first": 61300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "부산",
      "standard": 48300,
      "first": 70000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "천안아산",
      "standard": 7500,
      "first": 10900,
      "source": "official",
      "hours": 1
    },
    {
      "a": "평택지제",
      "b": "오송",
      "standard": 7700,
      "first": 11200,
      "source": "official",
      "hours": 1
    },
    {
      "a": "평택지제",
      "b": "대전",
      "standard": 12400,
      "first": 18000,
      "source": "official",
      "hours": 1
    },
    {
      "a": "평택지제",
      "b": "김천구미",
      "standard": 22800,
      "first": 33100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "평택지제",
      "b": "동대구",
      "standard": 29900,
      "first": 43400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "평택지제",
      "b": "경주",
      "standard": 35400,
      "first": 51300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "평택지제",
      "b": "울산",
      "standard": 39400,
      "first": 57100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "부산",
      "standard": 45300,
      "first": 65700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "서대구",
      "standard": 36500,
      "first": 52900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "서대구",
      "standard": 31900,
      "first": 46300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "평택지제",
      "b": "서대구",
      "standard": 28900,
      "first": 41900,
      "source": "official",
      "hours": 2
    },
    {
      "a": "수서",
      "b": "경산",
      "standard": 38600,
      "first": 56000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "밀양",
      "standard": 42500,
      "first": 61600,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "물금",
      "standard": 45200,
      "first": 65500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "구포",
      "standard": 46400,
      "first": 67300,
      "source": "official",
      "hours": 4
    },
    {
      "a": "동탄",
      "b": "경산",
      "standard": 34000,
      "first": 49300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동탄",
      "b": "밀양",
      "standard": 37800,
      "first": 54800,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "물금",
      "standard": 40600,
      "first": 58900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "구포",
      "standard": 41700,
      "first": 60500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "경산",
      "standard": 31100,
      "first": 45100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "평택지제",
      "b": "밀양",
      "standard": 34900,
      "first": 50600,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "물금",
      "standard": 37600,
      "first": 54500,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "구포",
      "standard": 38800,
      "first": 56300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "공주",
      "standard": 21600,
      "first": 31300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "수서",
      "b": "익산",
      "standard": 28100,
      "first": 40700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "수서",
      "b": "정읍",
      "standard": 34000,
      "first": 49300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "수서",
      "b": "광주송정",
      "standard": 40900,
      "first": 59300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "나주",
      "standard": 42300,
      "first": 61300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "목포",
      "standard": 46800,
      "first": 67900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "공주",
      "standard": 17000,
      "first": 24700,
      "source": "official",
      "hours": 1
    },
    {
      "a": "동탄",
      "b": "익산",
      "standard": 23500,
      "first": 34100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동탄",
      "b": "정읍",
      "standard": 29400,
      "first": 42600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동탄",
      "b": "광주송정",
      "standard": 36300,
      "first": 52600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동탄",
      "b": "나주",
      "standard": 37800,
      "first": 54800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동탄",
      "b": "목포",
      "standard": 42300,
      "first": 61300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "공주",
      "standard": 14000,
      "first": 20300,
      "source": "official",
      "hours": 1
    },
    {
      "a": "평택지제",
      "b": "익산",
      "standard": 20400,
      "first": 29600,
      "source": "official",
      "hours": 2
    },
    {
      "a": "평택지제",
      "b": "정읍",
      "standard": 26500,
      "first": 38400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "평택지제",
      "b": "광주송정",
      "standard": 33400,
      "first": 48400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "평택지제",
      "b": "나주",
      "standard": 34800,
      "first": 50500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "평택지제",
      "b": "목포",
      "standard": 39300,
      "first": 57000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "서대전",
      "standard": 20200,
      "first": 29300,
      "source": "official",
      "hours": 2
    },
    {
      "a": "수서",
      "b": "계룡",
      "standard": 21900,
      "first": 31800,
      "source": "official",
      "hours": 2
    },
    {
      "a": "수서",
      "b": "논산",
      "standard": 24200,
      "first": 35100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동탄",
      "b": "서대전",
      "standard": 15500,
      "first": 22500,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동탄",
      "b": "계룡",
      "standard": 17300,
      "first": 25100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동탄",
      "b": "논산",
      "standard": 19600,
      "first": 28400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "평택지제",
      "b": "서대전",
      "standard": 12500,
      "first": 18100,
      "source": "official",
      "hours": 1
    },
    {
      "a": "평택지제",
      "b": "계룡",
      "standard": 14300,
      "first": 20700,
      "source": "official",
      "hours": 2
    },
    {
      "a": "평택지제",
      "b": "논산",
      "standard": 16700,
      "first": 24200,
      "source": "official",
      "hours": 2
    },
    {
      "a": "수서",
      "b": "전주",
      "standard": 30400,
      "first": 44100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "수서",
      "b": "남원",
      "standard": 35300,
      "first": 51200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "곡성",
      "standard": 36800,
      "first": 53400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "구례구",
      "standard": 38600,
      "first": 56000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "순천",
      "standard": 41200,
      "first": 59700,
      "source": "official",
      "hours": 4
    },
    {
      "a": "수서",
      "b": "여천",
      "standard": 43400,
      "first": 62900,
      "source": "official",
      "hours": 4
    },
    {
      "a": "수서",
      "b": "여수엑스포",
      "standard": 44200,
      "first": 64100,
      "source": "official",
      "hours": 4
    },
    {
      "a": "동탄",
      "b": "전주",
      "standard": 25800,
      "first": 37400,
      "source": "official",
      "hours": 2
    },
    {
      "a": "동탄",
      "b": "남원",
      "standard": 30600,
      "first": 44400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "곡성",
      "standard": 32300,
      "first": 46800,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "구례구",
      "standard": 34100,
      "first": 49400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "순천",
      "standard": 36500,
      "first": 52900,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "여천",
      "standard": 38800,
      "first": 56300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "여수엑스포",
      "standard": 39700,
      "first": 57600,
      "source": "official",
      "hours": 4
    },
    {
      "a": "평택지제",
      "b": "전주",
      "standard": 22800,
      "first": 33100,
      "source": "official",
      "hours": 2
    },
    {
      "a": "평택지제",
      "b": "남원",
      "standard": 27700,
      "first": 40200,
      "source": "official",
      "hours": 2
    },
    {
      "a": "평택지제",
      "b": "곡성",
      "standard": 29200,
      "first": 42300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "구례구",
      "standard": 31100,
      "first": 45100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "순천",
      "standard": 33600,
      "first": 48700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "여천",
      "standard": 35900,
      "first": 52100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "여수엑스포",
      "standard": 36700,
      "first": 53200,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "진영",
      "standard": 44600,
      "first": 64700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "수서",
      "b": "창원중앙",
      "standard": 45900,
      "first": 66600,
      "source": "official",
      "hours": 4
    },
    {
      "a": "수서",
      "b": "창원",
      "standard": 46800,
      "first": 67900,
      "source": "official",
      "hours": 4
    },
    {
      "a": "수서",
      "b": "마산",
      "standard": 47200,
      "first": 68400,
      "source": "official",
      "hours": 4
    },
    {
      "a": "수서",
      "b": "진주",
      "standard": 51500,
      "first": 74700,
      "source": "official",
      "hours": 4
    },
    {
      "a": "동탄",
      "b": "진영",
      "standard": 40100,
      "first": 58100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "창원중앙",
      "standard": 41400,
      "first": 60000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "창원",
      "standard": 42300,
      "first": 61300,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "마산",
      "standard": 42600,
      "first": 61800,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "진주",
      "standard": 47000,
      "first": 68200,
      "source": "official",
      "hours": 4
    },
    {
      "a": "평택지제",
      "b": "진영",
      "standard": 37100,
      "first": 53800,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "창원중앙",
      "standard": 38400,
      "first": 55700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "창원",
      "standard": 39300,
      "first": 57000,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "마산",
      "standard": 39600,
      "first": 57400,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "진주",
      "standard": 44100,
      "first": 63900,
      "source": "official",
      "hours": 4
    },
    {
      "a": "수서",
      "b": "포항",
      "standard": 47400,
      "first": 68700,
      "source": "official",
      "hours": 3
    },
    {
      "a": "동탄",
      "b": "포항",
      "standard": 42800,
      "first": 62100,
      "source": "official",
      "hours": 3
    },
    {
      "a": "평택지제",
      "b": "포항",
      "standard": 39800,
      "first": 57700,
      "source": "official",
      "hours": 3
    }
  ],
  "places": {
    "고양": "서울",
    "일산": "서울",
    "킨텍스": "서울",
    "세종": "오송",
    "청주": "오송",
    "대구": "동대구",
    "광주": "광주송정",
    "경기도 광주": "수서",
    "경기 광주": "수서",
    "천안": "천안아산",
    "아산": "천안아산",
    "창원": "창원중앙",
    "여수": "여수엑스포",
    "구미": "김천구미",
    "김천": "김천구미",
    "평택": "평택지제",
    "화성": "동탄",
    "김해": "진영",
    "인천": [
      "서울",
      "광명"
    ],
    "용인": [
      "동탄",
      "수원"
    ],
    "성남": "수서",
    "분당": "수서",
    "판교": "수서",
    "부천": [
      "서울",
      "광명"
    ],
    "남양주": [
      "서울",
      "수서"
    ],
    "안산": [
      "광명",
      "수원"
    ],
    "안양": "광명",
    "시흥": "광명",
    "파주": "서울",
    "김포": "서울"
  },
  "transfers": [
    "오송",
    "익산"
  ],
  "airports": {
    "김해": "부산",
    "PUS": "부산",
    "김포": "서울",
    "GMP": "서울",
    "인천": "서울",
    "ICN": "서울"
  },
  "basis": "2026-09-01"
};

export const AIR_MILEAGE = {
  "version": 1,
  "basis": "2026-10-04",
  "source": "https://www.koreanair.com/kr/ko/skypass/earn-miles/koreanair/overview",
  "checked": null,
  "first_seats": [
    "프레스티지",
    "비즈니스",
    "일등",
    "퍼스트",
    "특실",
    "prestige",
    "business",
    "first"
  ],
  "airlines": [
    {
      "name": "대한항공",
      "aliases": [
        "Korean Air",
        "KAL"
      ],
      "rates": {
        "standard": 100,
        "first": 125
      },
      "routes": [
        {
          "a": "김포",
          "b": "김해",
          "miles": 215
        },
        {
          "a": "인천",
          "b": "김해",
          "miles": 215
        },
        {
          "a": "김포",
          "b": "제주",
          "miles": 276
        },
        {
          "a": "인천",
          "b": "제주",
          "miles": 276
        },
        {
          "a": "김포",
          "b": "여수",
          "miles": 194
        },
        {
          "a": "김포",
          "b": "울산",
          "miles": 203
        },
        {
          "a": "김포",
          "b": "사천",
          "miles": 188
        },
        {
          "a": "김포",
          "b": "포항",
          "miles": 188
        },
        {
          "a": "인천",
          "b": "대구",
          "miles": 159
        },
        {
          "a": "제주",
          "b": "김해",
          "miles": 186
        },
        {
          "a": "제주",
          "b": "청주",
          "miles": 227
        },
        {
          "a": "제주",
          "b": "대구",
          "miles": 203
        },
        {
          "a": "제주",
          "b": "군산",
          "miles": 164
        },
        {
          "a": "제주",
          "b": "광주",
          "miles": 111
        },
        {
          "a": "제주",
          "b": "사천",
          "miles": 139
        },
        {
          "a": "제주",
          "b": "울산",
          "miles": 214
        },
        {
          "a": "제주",
          "b": "원주",
          "miles": 282
        },
        {
          "a": "제주",
          "b": "여수",
          "miles": 109
        },
        {
          "a": "제주",
          "b": "포항",
          "miles": 235
        }
      ]
    }
  ],
  "airports": {
    "김포": {
      "code": "GMP",
      "also": [
        "서울",
        "Gimpo",
        "Seoul"
      ]
    },
    "인천": {
      "code": "ICN",
      "also": [
        "Incheon"
      ]
    },
    "김해": {
      "code": "PUS",
      "also": [
        "부산",
        "Gimhae",
        "Busan"
      ]
    },
    "제주": {
      "code": "CJU",
      "also": [
        "Jeju"
      ]
    },
    "여수": {
      "code": "RSU",
      "also": [
        "순천",
        "Yeosu"
      ]
    },
    "울산": {
      "code": "USN",
      "also": [
        "Ulsan"
      ]
    },
    "사천": {
      "code": "HIN",
      "also": [
        "진주",
        "Sacheon",
        "Jinju"
      ]
    },
    "포항": {
      "code": "KPO",
      "also": [
        "경주",
        "Pohang"
      ]
    },
    "대구": {
      "code": "TAE",
      "also": [
        "Daegu"
      ]
    },
    "청주": {
      "code": "CJJ",
      "also": [
        "Cheongju"
      ]
    },
    "군산": {
      "code": "KUV",
      "also": [
        "Gunsan"
      ]
    },
    "광주": {
      "code": "KWJ",
      "also": [
        "Gwangju"
      ]
    },
    "원주": {
      "code": "WJU",
      "also": [
        "횡성",
        "Wonju"
      ]
    }
  }
};
