// 근태 신청의 순수 로직: 무엇이 비었는지, HR 폼에 어떤 순서로 넣는지, 목록에서 무엇을 할 수 있는지,
// 말에서 무엇을 읽는지. HR 화면의 동작(종류를 바꾸면 날짜가 지워지고, 시작일을 넣으면 시각이 초기화된다)은
// 2026-10-02 에 실제 화면에서 확인했고, 여기서는 그 순서가 뒤집히지 않게 못 박는다.
import assert from 'node:assert/strict';
import {
  KINDS, KIND_ORDER, KIND_MAIN, KIND_MORE, FORMS, CANCEL_FORMS, STATUS, blankForm, fieldsFor, missingFields, problems, readyToSend,
  contentOf, splitContent, describe, spanHours, buildJob, buildDocJob, buildCancelJob, listItem, listItems, formFromDoc,
  normalizePatch, applyPatch, parseAttendLocal, tripDates, relativeDates, fixRelativeDates, plansIn,
  workStartOn, halfPlan, halfFlexForm, itemsIn, isPast, rangeCovering,
  SUBS, codeOf, withSub, halfOf, halfFromTimes, timeStep, timeOptions, spanDays, spanned, spanEnd, settle, nextSpan, SPAN_HOURS,
  FLEX_TIMES, FLEX_MODES, FLEX_DAYS, flexTimesFor, flexModeOf, fillFlexWeek,
  acceptsFile, kindOfItem, itemsOfKind, EVIDENCE_ACCEPT, statusLabel,
} from '../src/attend.js';

const TODAY = '2026-10-02';   // 금요일
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const idx = (job, pred) => job.ops.findIndex(pred);
const setOf = (job, sel) => job.ops.find((o) => o.op === 'set' && o.sel === sel);

console.log('종류와 기본값');
t('여섯 종류가 모두 늘 보이는 첫 줄이고, 접히는 줄은 비어 있다 — 소통은 종류가 아니라 외근의 갈래다', () => {
  assert.deepEqual(KIND_MAIN.map((k) => KINDS[k].label), ['출장', '외근', '유연근무', '외출', '휴가', '건강검진']);
  assert.deepEqual(KIND_MORE, []);
  assert.deepEqual(KIND_ORDER, [...KIND_MAIN, ...KIND_MORE]);
  assert.equal(KINDS.meet, undefined);
});
t('종류 줄의 이름은 모두 두 글자다 — 유연·건강으로 줄인다', () =>
  assert.deepEqual(KIND_MAIN.map((k) => KINDS[k].short || KINDS[k].label), ['출장', '외근', '유연', '외출', '휴가', '건강']));
t('갈래: 외근 안에 교육·소통, 휴가 안에 연차·체력단련. 첫 번째가 기본값이다', () => {
  assert.deepEqual(SUBS.out.map((s) => [s.value, s.label]), [['OD', '외근'], ['TR', '교육'], ['MEET', '소통']]);
  assert.deepEqual(SUBS.leave.map((s) => [s.value, s.label]), [['LY', '연차'], ['LH', '체력단련']]);
  assert.equal(codeOf(blankForm('out', TODAY)), 'OD');
  assert.equal(codeOf(blankForm('leave', TODAY)), 'LY');
  assert.equal(codeOf({ ...blankForm('leave', TODAY), sub: 'LH' }), 'LH');
  assert.equal(codeOf({ ...blankForm('out', TODAY), sub: 'MEET' }), 'OD', '소통은 HR 에 외근으로 올라간다');
  assert.equal(codeOf({ ...blankForm('trip', TODAY), sub: 'LY' }), 'DBT', '그 종류에 없는 갈래는 무시한다');
});
t('소통(부서소통회)은 외근 13~14시의 줄임이다 — 고르면 시각과 목적이 깔려 바로 올릴 수 있다', () => {
  const f = withSub(blankForm('out', TODAY), 'MEET');
  assert.deepEqual([f.kind, f.sub, f.start, f.end, f.span, f.purpose, f.dateFrom], ['out', 'MEET', '13:00', '14:00', 60, '부서소통회', TODAY]);
  assert.deepEqual(missingFields(f), []);
  assert.equal(timeStep(f), 30, '외근이라 30분 단위다');
  assert.equal(describe(f), '부서소통회 10/2 13:00~14:00 · 부서소통회');
  assert.deepEqual(fieldsFor(f).map((x) => x.key), ['sub', 'dateFrom', 'start', 'span', 'purpose', 'car']);
});
t('소통에서 다른 갈래로 옮기면 깔아 준 값은 걷어 내고, 직접 고친 값은 가져간다', () => {
  const meet = withSub({ ...blankForm('out', TODAY), start: '15:00', span: 120, purpose: '협의' }, 'MEET');
  assert.deepEqual([meet.start, meet.end, meet.purpose], ['13:00', '14:00', '부서소통회'], '소통을 고르면 13~14시가 이긴다');
  const back = withSub(meet, 'OD');
  assert.deepEqual([back.sub, back.start, back.end, back.span, back.purpose], ['OD', '09:00', '', '', '']);
  const kept = withSub(settle({ ...meet, start: '12:00', span: 120 }), 'OD');
  assert.deepEqual([kept.start, kept.end, kept.span, kept.purpose], ['12:00', '14:00', 120, '']);
  assert.deepEqual(withSub(blankForm('out', TODAY), 'TR').start, '09:00', '깔아 주는 값이 없는 갈래는 갈래만 바뀐다');
});
t('출장은 출발 7시·도착 20시·당일 하루·선급 예산이 기본이다', () => {
  const f = blankForm('trip', TODAY);
  assert.deepEqual([f.start, f.end, f.days, f.dateTo, f.expense], ['07:00', '20:00', 1, TODAY, 'Y']);
});
t('출장은 출발일·출발·도착일·도착 두 줄과 며칠간 칩 한 줄, 출장지·장소 한 줄, 목적, 그 아래 여비계산서 사전정산 체크박스(기본은 꺼짐)', () => {
  const fields = fieldsFor(blankForm('trip', TODAY));
  assert.deepEqual(fields.map((x) => x.key), ['dateFrom', 'start', 'dateTo', 'end', 'days', 'place', 'venue', 'purpose', 'settle', 'car']);
  assert.deepEqual(fields.slice(0, 5).map((x) => x.label), ['출발일', '출발', '도착일', '도착', '며칠간']);
  const settleBox = fields.find((x) => x.key === 'settle');
  assert.deepEqual([settleBox.type, settleBox.label, blankForm('trip', TODAY).settle], ['check', '여비계산서 사전정산', false]);
  assert.deepEqual(missingFields({ ...blankForm('trip', TODAY), purpose: '협의' }), ['place'], '꺼 두어도 출장지는 묻는다 — 근무지는 묻지 않는다');
  assert.deepEqual(missingFields({ ...blankForm('trip', TODAY), purpose: '협의', place: '대전' }), [], '장소는 비워도 된다');
});
t('출장지·장소는 사전정산과 상관없이 늘 한 줄(같은 묶음)로 나온다 — 출장지는 필수, 장소는 아니다. 출장이 아니면 없다', () => {
  for (const settle of [false, true]) {
    const spot = fieldsFor({ ...blankForm('trip', TODAY), settle }).filter((x) => x.group === 'spot');
    assert.deepEqual(spot.map((x) => [x.key, x.label, x.type, x.required]), [['place', '출장지', 'text', true], ['venue', '장소', 'text', false]], String(settle));
  }
  assert.equal(blankForm('trip', TODAY).venue, '');
  for (const kind of ['out', 'leaveout', 'leave', 'health', 'flex']) {
    assert.equal(fieldsFor(blankForm(kind, TODAY)).some((x) => x.key === 'place' || x.key === 'venue'), false, kind);
  }
});
t('출장·외근에는 차량 조회 체크박스가 있다(기본은 꺼짐) — 출장은 사전정산 옆(같은 묶음)에, 외근은 목적 아래에 선다. 다른 종류에는 없다', () => {
  const box = (form) => fieldsFor(form).find((x) => x.key === 'car');
  const trip = fieldsFor(blankForm('trip', TODAY));
  assert.deepEqual(trip.filter((x) => x.group === 'opts').map((x) => x.key), ['settle', 'car'], '사전정산과 차량 조회가 한 줄이다');
  assert.deepEqual([box(blankForm('trip', TODAY)).type, box(blankForm('trip', TODAY)).label, box(blankForm('trip', TODAY)).required], ['check', '차량 조회', false]);
  assert.deepEqual([box(blankForm('out', TODAY)).type, box(blankForm('out', TODAY)).group], ['check', undefined]);
  assert.ok(box({ ...blankForm('out', TODAY), sub: 'TR' }), '교육에도 있다');
  for (const kind of ['flex', 'leaveout', 'leave', 'health']) assert.equal(box(blankForm(kind, TODAY)), undefined, kind);
  assert.deepEqual([blankForm('trip', TODAY).car, blankForm('out', TODAY).car], [false, false]);
  // 화면만의 값이다 — 켜도 필수 칸이 늘지 않고 HR 에 넣는 값(일감)도 그대로다.
  const on = { ...blankForm('trip', TODAY), purpose: '협의', place: '대전', car: true };
  assert.deepEqual(missingFields(on), []);
  assert.deepEqual(buildJob(on), buildJob({ ...on, car: false }));
  const o = { ...blankForm('out', TODAY), purpose: '협의', span: 120, car: true, carPlace: '부산시청' };
  assert.deepEqual(missingFields({ ...o, carPlace: '' }), [], '외근의 행선지는 근태 신청의 필수 칸이 아니다(차량을 누를 때 묻는다)');
  assert.deepEqual(buildJob(o), buildJob({ ...o, car: false, carPlace: '' }));
});
t('차량 조회를 켜면 근무지·행선지가 한 줄로 나온다 — 출장은 출장지가 행선지라 근무지만, 사전정산을 켜면 그 줄의 근무지가 그 몫을 해서 따로 묻지 않는다', () => {
  const keys = (form) => fieldsFor(form).map((x) => x.key);
  const trip = { ...blankForm('trip', TODAY), car: true };
  assert.deepEqual(keys(trip), ['dateFrom', 'start', 'dateTo', 'end', 'days', 'place', 'venue', 'purpose', 'settle', 'car', 'workplace']);
  assert.deepEqual(keys({ ...trip, settle: true }), ['dateFrom', 'start', 'dateTo', 'end', 'days', 'place', 'venue', 'purpose', 'settle', 'car', 'workplace', 'transport']);
  assert.deepEqual(keys({ ...blankForm('out', TODAY), car: true }), ['sub', 'dateFrom', 'start', 'span', 'purpose', 'car', 'workplace', 'carPlace']);
  assert.deepEqual(fieldsFor(trip).filter((x) => x.group === 'carwhere').map((x) => [x.key, x.label, x.type, x.required]), [['workplace', '근무지', 'text', false]]);
  const where = fieldsFor({ ...blankForm('out', TODAY), car: true }).filter((x) => x.group === 'carwhere');
  assert.deepEqual(where.map((x) => [x.key, x.label, x.type, x.required]), [['workplace', '근무지', 'text', false], ['carPlace', '행선지', 'text', false]],
    '차량은 근무지(서울·부산)의 것을 잡고, 신청에는 행선지가 있어야 한다');
  assert.equal(blankForm('trip', TODAY).carPlace, '');
  assert.equal(buildJob({ ...trip, purpose: '협의', place: '대전', workplace: '부산' }).ops.some((o) => /부산/.test(JSON.stringify(o))), false,
    '사전정산을 끈 출장에서는 근무지가 HR 신청서에 들어가지 않는다');
});
t('출장 증빙은 신청할 때 묻지 않는다 — 신청 내역의 출장 카드에서 넣는다. 카드가 받는 것은 이미지와 PDF 다', () => {
  const form = { ...blankForm('trip', TODAY), purpose: '협의', settle: true, place: '대전', workplace: '부산' };
  assert.equal(fieldsFor(form).some((x) => x.type === 'file'), false);
  assert.deepEqual(fieldsFor(form).map((x) => x.key), ['dateFrom', 'start', 'dateTo', 'end', 'days', 'place', 'venue', 'purpose', 'settle', 'car', 'workplace', 'transport']);
  assert.deepEqual(missingFields(form), []);
  assert.deepEqual([
    acceptsFile(EVIDENCE_ACCEPT, { name: 'a.png', type: 'image/png' }), acceptsFile(EVIDENCE_ACCEPT, { name: 'b.PDF', type: '' }),
    acceptsFile(EVIDENCE_ACCEPT, { name: 'c.pdf', type: 'application/pdf' }), acceptsFile(EVIDENCE_ACCEPT, { name: 'd.hwp', type: 'application/x-hwp' }),
  ], [true, true, true, false]);
});
t('여비계산서 사전정산을 켜면 근무지·교통편이 한 줄(같은 묶음)로 나온다 — 교통편은 기차·비행기·버스, 기본은 기차 일반석', () => {
  const form = { ...blankForm('trip', TODAY), purpose: '협의', settle: true };
  const where = fieldsFor(form).filter((x) => x.group === 'where');
  assert.deepEqual(where.map((x) => [x.key, x.label, x.type, x.required]),
    [['workplace', '근무지', 'text', true], ['transport', '교통편', 'icons', true]]);
  assert.deepEqual(where[1].options, [{ value: 'train', label: '기차(KTX)' }, { value: 'plane', label: '비행기' }, { value: 'bus', label: '버스' }]);
  assert.deepEqual([form.transport, form.trainGrade], [['train'], 'standard'], '교통편은 여럿을 함께 고를 수 있어 목록이다');
  assert.deepEqual(missingFields(form), ['place', 'workplace'], '출장지는 늘 필수이고, 켜면 기차일 때 떠나는 곳(근무지)도 필수다');
  assert.deepEqual(missingFields({ ...form, place: '대전', transport: ['bus'] }), [], '기차가 끼어 있지 않으면 KTX 운임을 찾지 않으므로 근무지는 비워도 된다');
  assert.deepEqual(missingFields({ ...form, place: '대전', transport: ['train', 'plane'] }), ['workplace'], '기차와 비행기를 함께 골라도 KTX 편이 있으니 근무지는 필수다');
  assert.deepEqual(missingFields({ ...form, place: '대전', workplace: '부산', transport: [] }), ['transport'], '하나는 골라야 한다');
});
t('며칠간의 칩: 휴가는 1D~5D (하루부터 닷새), 출장은 1D~7D (한 줄을 고르게 나눠 선다)', () => {
  const chips = (kind) => fieldsFor(blankForm(kind, TODAY)).find((x) => x.key === 'days').chips.map((c) => [c.label, c.days]);
  const five = [['1D', 1], ['2D', 2], ['3D', 3], ['4D', 4], ['5D', 5]];
  assert.deepEqual(chips('trip'), [...five, ['6D', 6], ['7D', 7]]);
  assert.deepEqual(chips('leave'), five);
});
t('출장의 날짜·시각은 두 묶음이고 며칠간은 이름이 칩 왼쪽에 붙은 한 줄이다 — 출발일·출발(go), 도착일·도착(back), 며칠간(inline)', () => {
  const fields = fieldsFor(blankForm('trip', TODAY));
  assert.deepEqual(fields.slice(0, 5).map((x) => [x.key, x.group || '', !!x.inline]),
    [['dateFrom', 'go', false], ['start', 'go', false], ['dateTo', 'back', false], ['end', 'back', false], ['days', '', true]]);
  assert.deepEqual([fields[2].type, fields[2].required], ['date', true], '도착일은 날짜 칸이다');
  const leaveDays = fieldsFor(blankForm('leave', TODAY)).find((x) => x.key === 'days');
  assert.deepEqual([leaveDays.group, leaveDays.inline], [undefined, undefined], '휴가의 며칠간은 묶음도 inline 도 아니다 — 달력이 칩 옆에 붙는다');
});
t('출장경비는 묻지 않고 선급 예산으로 보낸다 — 말로도 바꿀 수 없다', () => {
  const form = { ...blankForm('trip', TODAY), purpose: '협의', place: '대전' };
  assert.deepEqual(missingFields(form), []);
  assert.deepEqual(buildJob(form).ops.find((o) => o.op === 'radio'), { op: 'radio', name: 'biztripExpKind', value: 'Y', label: '출장경비' });
  assert.equal('expense' in normalizePatch({ kind: 'trip', expense: 'N' }), false);
});
t('며칠간에서 종료일이 나온다 — 1 은 당일, 2 는 다음 날, 달을 넘어가도 맞다', () => {
  const f = { ...blankForm('trip', TODAY), dateFrom: '2026-10-30' };
  assert.equal(tripDates({ ...f, days: 1 }).dateTo, '2026-10-30');
  assert.equal(tripDates({ ...f, days: 2 }).dateTo, '2026-10-31');
  assert.equal(tripDates({ ...f, days: 4 }).dateTo, '2026-11-02');
  assert.equal(tripDates({ ...blankForm('out', TODAY), dateFrom: '2026-10-30', days: 3 }).dateTo, '2026-10-30', '출장·휴가가 아니면 하루짜리다');
  assert.equal(tripDates({ ...blankForm('leave', TODAY), dateFrom: '2026-10-30', days: 3 }).dateTo, '2026-11-01', '휴가도 며칠간을 받는다');
});
t('달력에서 고른 끝나는 날은 며칠간으로 바뀐다 (시작일 포함)', () => {
  assert.equal(spanDays('2026-10-20', '2026-10-20'), 1);
  assert.equal(spanDays('2026-10-30', '2026-11-02'), 4);
  assert.equal(spanDays('2026-10-20', '2026-10-19'), 0, '시작일보다 이르면 1 보다 작다 — 화면이 받지 않는다');
  assert.ok(Number.isNaN(spanDays('2026-10-20', '')));
});
t('휴가: 갈래·시작일·며칠간을 묻고, 구분은 하루짜리 연차에만 묻는다. 사유는 묻지 않는다', () => {
  const f = blankForm('leave', TODAY);
  assert.deepEqual(fieldsFor(f).map((x) => x.key), ['sub', 'dateFrom', 'days', 'half']);
  assert.deepEqual(fieldsFor(f).find((x) => x.key === 'half').options.map((o) => o.label), ['전일', '오전', '오후']);
  assert.deepEqual(fieldsFor({ ...f, days: 2 }).map((x) => x.key), ['sub', 'dateFrom', 'days']);
  assert.deepEqual(fieldsFor({ ...f, sub: 'LH' }).map((x) => x.key), ['sub', 'dateFrom', 'days'], '체력단련은 HR 이 전일로 잠근다');
  assert.deepEqual(missingFields(f), [], '기본값만으로 올릴 수 있다(오늘 하루 연차 전일)');
});
t('구분은 기본 전일이고, 오전·오후는 하루짜리 연차에서만 산다', () => {
  const f = { ...blankForm('leave', TODAY), half: 'pm' };
  assert.equal(halfOf(blankForm('leave', TODAY)), '');
  assert.equal(halfOf(f), 'pm');
  assert.equal(halfOf({ ...f, days: 2 }), '');
  assert.equal(halfOf({ ...f, sub: 'LH' }), '');
});
t('시각으로 말한 휴가: 끝이 13시 이전이면 오전, 시작이 13시 이후면 오후, 아니면 전일', () => {
  assert.equal(halfFromTimes('09:00', '13:00'), 'am');
  assert.equal(halfFromTimes('09:00', '12:00'), 'am');
  assert.equal(halfFromTimes('13:00', '18:00'), 'pm');
  assert.equal(halfFromTimes('14:00', undefined), 'pm');
  assert.equal(halfFromTimes('09:00', '18:00'), '');
  assert.equal(halfFromTimes(undefined, undefined), '');
});
t('외근: 갈래(외근·교육·소통)를 먼저 묻는다', () => {
  const fields = fieldsFor(blankForm('out', TODAY));
  assert.deepEqual(fields.map((x) => x.key), ['sub', 'dateFrom', 'start', 'span', 'purpose', 'car']);
  assert.deepEqual(fields[0].options.map((o) => o.label), ['외근', '교육', '소통']);
});
t('시각 단위: 출장·교육은 정시, 외근·외출·건강검진은 30분', () => {
  assert.equal(timeStep(blankForm('trip', TODAY)), 60);
  assert.equal(timeStep({ ...blankForm('out', TODAY), sub: 'TR' }), 60);
  assert.equal(timeStep(blankForm('out', TODAY)), 30);
  assert.equal(timeStep(blankForm('leaveout', TODAY)), 30);
  assert.equal(timeStep(blankForm('health', TODAY)), 30);
});

console.log('몇 시간 — 종료 시각 대신 묻는다');
t('하루 안에서 끝나는 종류는 시작과 몇 시간으로 받는다. 출장은 출발·도착 시각 그대로다', () => {
  assert.deepEqual(['out', 'leaveout', 'trip', 'leave', 'flex', 'health'].map((k) => spanned(blankForm(k, TODAY))),
    [true, true, false, false, false, false]);
  assert.equal(spanned({ ...blankForm('health', TODAY), allDay: false }), true, '건강검진은 시간으로 올릴 때만');
  assert.deepEqual(fieldsFor(blankForm('leaveout', TODAY)).map((x) => x.key), ['dateFrom', 'start', 'span', 'purpose']);
  assert.ok(fieldsFor(blankForm('trip', TODAY)).some((x) => x.key === 'end') && !fieldsFor(blankForm('trip', TODAY)).some((x) => x.key === 'span'));
});
t('칩은 1~8시간이고 30분을 더하는 칩이 하나 붙는다. 정시 단위인 교육에는 30분 칩이 없다', () => {
  const span = (form) => fieldsFor(form).find((x) => x.key === 'span');
  assert.deepEqual(SPAN_HOURS, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([span(blankForm('out', TODAY)).hours, span(blankForm('out', TODAY)).half], [SPAN_HOURS, true]);
  assert.equal(span({ ...blankForm('out', TODAY), sub: 'TR' }).half, false);
  assert.equal(span(blankForm('out', TODAY)).required, true);
});
t('날짜와 시작은 한 줄에 나란히 선다 (그 아래 한 줄이 몇 시간 칩이다)', () => {
  assert.equal(fieldsFor(blankForm('out', TODAY)).find((x) => x.key === 'dateFrom').beside, true);
  assert.equal(fieldsFor(blankForm('trip', TODAY)).find((x) => x.key === 'dateFrom').beside, undefined);
});
t('종료 시각은 시작 + 몇 시간이다. 시작을 옮기면 따라가고, 둘 중 하나가 비었거나 그 날을 넘기면 비운다', () => {
  const f = { ...blankForm('out', TODAY), start: '14:00', span: 150 };
  assert.equal(spanEnd(f).end, '16:30');
  assert.equal(settle({ ...f, start: '09:30' }).end, '12:00');
  assert.equal(spanEnd({ ...f, span: '' }).end, '');
  assert.equal(spanEnd({ ...f, start: '' }).end, '');
  assert.equal(spanEnd({ ...f, start: '20:00', span: 480 }).end, '');
  assert.equal(spanEnd({ ...blankForm('trip', TODAY), span: 60 }).end, '20:00', '출장의 도착 시각은 건드리지 않는다');
});
t('시간 칩은 더해 둔 30분을 지키고, 30분 칩은 켜고 끈다 — 그것만 켜면 30분이다', () => {
  const f = blankForm('out', TODAY);
  assert.equal(nextSpan(f, 2), 120);
  assert.equal(nextSpan({ ...f, span: 120 }, 'half'), 150);
  assert.equal(nextSpan({ ...f, span: 150 }, 5), 330, '시간을 바꿔도 30분은 남는다');
  assert.equal(nextSpan({ ...f, span: 150 }, 'half'), 120);
  assert.equal(nextSpan(f, 'half'), 30);
  assert.equal(nextSpan({ ...f, span: 30 }, 'half'), '', '다 끄면 고르지 않은 것이다');
  assert.equal(nextSpan({ ...f, sub: 'TR', span: 150 }, 3), 180, '교육은 정시 단위라 30분이 떨어진다');
});

console.log('빈 칸 — 다른 색으로 칠할 곳');
t('외근: 시작은 오전 9시가 깔려 있어, 몇 시간·목적만 짚는다. 시작을 비우면 그것도 짚는다', () => {
  assert.equal(blankForm('out', TODAY).start, '09:00');
  assert.deepEqual(missingFields(blankForm('out', TODAY)), ['span', 'purpose']);
  assert.deepEqual(missingFields({ ...blankForm('out', TODAY), start: '' }), ['start', 'span', 'purpose']);
});
t('시작의 기본값: 외근·외출·건강검진은 09:00, 출장 07:00 은 그대로, 시각이 없는 종류는 비어 있다', () =>
  assert.deepEqual(['out', 'leaveout', 'health', 'trip', 'leave', 'flex'].map((k) => blankForm(k, TODAY).start),
    ['09:00', '09:00', '09:00', '07:00', '', '']));
t('시각 목록: 외근·외출은 30분 간격 48칸, 교육·출장은 정시 24칸', () => {
  const half = timeOptions(blankForm('out', TODAY));
  assert.deepEqual([half.length, half[0], half[1], half[18], half.at(-1)], [48, '00:00', '00:30', '09:00', '23:30']);
  assert.deepEqual(timeOptions(blankForm('leaveout', TODAY)), half);
  const hour = timeOptions({ ...blankForm('out', TODAY), sub: 'TR' });
  assert.deepEqual([hour.length, hour[9], hour.includes('09:30')], [24, '09:00', false]);
  assert.equal(timeOptions(blankForm('trip', TODAY)).length, 24);
});
t('출장: 출장지와 목적이 비었다고 짚는다 (HR 이 받는 글은 "내용" 하나다 — 출장지는 그 뒤에 붙는다)', () => {
  assert.deepEqual(missingFields(blankForm('trip', TODAY)), ['place', 'purpose']);
  assert.equal(readyToSend({ ...blankForm('trip', TODAY), purpose: '착수회의 참석' }), false);
  assert.equal(readyToSend({ ...blankForm('trip', TODAY), place: '대전', purpose: '착수회의 참석' }), true);
});
t('유연근무: 출근시간과 사유', () =>
  assert.deepEqual(missingFields(blankForm('flex', TODAY)), ['flexStart', 'purpose']));
t('유연근무의 기간: 당일·주간·전체 — 당일이 기본이고, HR 의 기간구분은 Daily·Weekly 둘이다', () => {
  assert.deepEqual(FLEX_MODES.map((m) => [m.label, m.code]), [['당일', 'DA'], ['주간', 'WE'], ['전체', 'WE']]);
  assert.equal(flexModeOf(blankForm('flex', TODAY)), 'day');
  assert.equal(flexModeOf({ ...blankForm('out', TODAY), flexMode: 'week' }), 'day', '유연근무가 아니면 당일이다');
  const keys = (mode) => fieldsFor({ ...blankForm('flex', TODAY), flexMode: mode }).map((x) => x.key);
  assert.deepEqual(keys('day'), ['flexMode', 'dateFrom', 'flexStart', 'purpose']);
  assert.deepEqual(keys('week'), ['flexMode', 'flexMon', 'flexTue', 'flexWed', 'flexThu', 'flexFri'], '주간은 날짜도 사유도 받지 않는다');
  assert.deepEqual(keys('all'), ['flexMode', 'flexStart']);
});
t('출근시간은 퇴근과 한 묶음이다 — 일곱 가지, 07:00·11:00 은 월·금요일 칸에만 있다 (2026-10-02 실제 화면)', () => {
  assert.deepEqual(FLEX_TIMES.map((x) => x.label),
    ['07:00 ~ 16:00', '08:00 ~ 17:00', '08:30 ~ 17:30', '09:00 ~ 18:00', '09:30 ~ 18:30', '10:00 ~ 19:00', '11:00 ~ 20:00']);
  assert.deepEqual(FLEX_DAYS.map((d) => [d.label, d.field, flexTimesFor(d.wide).length]),
    [['월', 'monTime', 7], ['화', 'tueTime', 5], ['수', 'wedTime', 5], ['목', 'thuTime', 5], ['금', 'friTime', 7]]);
  assert.deepEqual(flexTimesFor(false).map((x) => x.start), ['08:00', '08:30', '09:00', '09:30', '10:00']);
});
t('출근시간 목록은 늘 일곱 가지를 다 보여주고, 그 요일에 못 고르는 07:00·11:00 만 잠근다', () => {
  const locked = (f) => [f.options.length, f.options.filter((o) => o.disabled).map((o) => o.value)];
  const week = fieldsFor({ ...blankForm('flex', TODAY), flexMode: 'week' });
  assert.deepEqual(week.slice(1).map(locked), [[7, []], [7, ['07:00', '11:00']], [7, ['07:00', '11:00']], [7, ['07:00', '11:00']], [7, []]]);
  const all = fieldsFor({ ...blankForm('flex', TODAY), flexMode: 'all' });
  assert.deepEqual(locked(all[1]), [7, ['07:00', '11:00']], '전체는 다섯 요일에 다 있는 시간만 고른다');
  const day = (dateFrom) => locked(fieldsFor({ ...blankForm('flex', TODAY), dateFrom }).find((x) => x.key === 'flexStart'));
  assert.deepEqual(day('2026-10-02'), [7, []], '금요일');
  assert.deepEqual(day('2026-10-05'), [7, []], '월요일');
  assert.deepEqual(day('2026-10-07'), [7, ['07:00', '11:00']], '수요일');
  assert.deepEqual(day(''), [7, []], '날짜를 모르면 잠그지 않는다');
});
t('주간은 다섯 요일이 다 차야 한다. 전체는 출근시간 하나면 된다', () => {
  const week = { ...blankForm('flex', TODAY), flexMode: 'week', flexMon: '07:00', flexFri: '11:00' };
  assert.deepEqual(missingFields(week), ['flexTue', 'flexWed', 'flexThu']);
  assert.equal(readyToSend({ ...week, flexTue: '09:00', flexWed: '09:00', flexThu: '09:00' }), true);
  assert.deepEqual(missingFields({ ...blankForm('flex', TODAY), flexMode: 'all' }), ['flexStart']);
  assert.equal(readyToSend({ ...blankForm('flex', TODAY), flexMode: 'all', flexStart: '10:00' }), true);
});
t('주간의 빈 요일 칸은 지금 근무시간표로 채운다 — 이미 고른 칸은 그대로다', () => {
  const now = { monTime: '3', tueTime: '3', wedTime: '3', thuTime: '3', friTime: '6' };
  const f = fillFlexWeek({ ...blankForm('flex', TODAY), flexMode: 'week', flexWed: '10:00' }, now);
  assert.deepEqual(FLEX_DAYS.map((d) => f[d.key]), ['08:30', '08:30', '10:00', '08:30', '11:00']);
  const none = fillFlexWeek({ ...blankForm('flex', TODAY), flexMode: 'week' }, {});
  assert.deepEqual(FLEX_DAYS.map((d) => none[d.key]), ['', '', '', '', ''], '시간표를 모르면 빈 칸으로 둔다');
});
t('건강검진: 사유와 첨부파일. 하루 전체면 시각은 묻지 않는다', () => {
  const f = blankForm('health', TODAY);
  assert.deepEqual(missingFields(f), ['purpose', 'file']);
  assert.ok(!fieldsFor(f).some((x) => x.key === 'start'));
  assert.deepEqual(missingFields({ ...f, allDay: false }), ['span', 'purpose', 'file'], '시작은 09:00 이 깔려 있다');
});
t('건강검진: 올려 둔 첨부가 있는 문서를 고칠 때는 첨부를 다시 요구하지 않는다', () =>
  assert.deepEqual(missingFields({ ...blankForm('health', TODAY), purpose: '건강검진', hasFile: true }), []));
t('종류를 안 골랐으면 물을 칸이 없다', () => {
  assert.deepEqual(fieldsFor(blankForm('', TODAY)), []);
  assert.equal(readyToSend(blankForm('', TODAY)), false);
});

console.log('맞지 않는 값');
// 14:00 부터 2시간 30분 — 종료 16:30 은 거기서 나온다.
const out = settle({ ...blankForm('out', TODAY), dateFrom: '2026-10-07', start: '14:00', span: 150, purpose: '과제 협의' });
t('외근 14:00 + 2시간 30분은 그대로 올릴 수 있다 (종료 16:30)', () => {
  assert.deepEqual([out.end, out.dateTo], ['16:30', '2026-10-07']);
  assert.deepEqual(problems(out), []);
  assert.equal(readyToSend(out), true);
});
t('당일 출장은 도착이 출발보다 빠르면 막는다', () =>
  assert.deepEqual(problems({ ...blankForm('trip', TODAY), start: '13:00', end: '11:00', purpose: '회의' }).map((p) => p.key), ['end']));
t('외근은 30분 단위 — 시작도, 몇 시간도', () => {
  assert.deepEqual(problems({ ...out, start: '14:10' }).map((p) => [p.key, p.message]), [['start', '30분 단위로 넣어 주세요.']]);
  assert.deepEqual(problems({ ...out, span: 70 }).map((p) => p.key), ['span'], '10분 단위로 올린 예전 문서를 불러왔을 때');
  assert.deepEqual(problems({ ...out, start: '14:30', span: 30 }), [], '30분짜리도 된다');
});
t('그 날 안에 끝나야 한다', () => {
  assert.deepEqual(problems({ ...out, start: '18:00', span: 480 }).map((p) => p.key), ['span']);
  assert.deepEqual(problems({ ...out, start: '15:00', span: 510 }), [], '15:00 + 8시간 30분 = 23:30');
});
t('출장은 정시 단위', () =>
  assert.match(problems({ ...blankForm('trip', TODAY), start: '09:30', purpose: '회의' })[0].message, /정시/));
t('교육도 정시 단위 — 사이트가 분을 잠근다', () => {
  const edu = { ...out, sub: 'TR' };
  assert.deepEqual(problems(edu).map((p) => [p.key, p.message]), [['span', '교육은 정시 단위로만 올릴 수 있습니다.']]);
  assert.deepEqual(problems({ ...edu, span: 180 }), []);
});
t('휴가는 시각을 보지 않는다. 며칠간은 1~31', () => {
  assert.deepEqual(problems({ ...blankForm('leave', TODAY), start: '25:99', end: '01:00' }), []);
  assert.equal(problems({ ...blankForm('leave', TODAY), days: 40 })[0].key, 'days');
});
t('여러 날 출장은 종료 시각이 시작보다 일러도 된다', () =>
  assert.deepEqual(problems({ ...blankForm('trip', TODAY), dateTo: '2026-10-03', start: '13:00', end: '11:00', purpose: '회의' }), []));
t('며칠간은 1~31 의 정수여야 한다. 비우면 빈 칸으로 짚는다', () => {
  assert.equal(problems({ ...blankForm('trip', TODAY), days: 0 })[0].key, 'days');
  assert.equal(problems({ ...blankForm('trip', TODAY), days: 1.5 })[0].key, 'days');
  assert.equal(problems({ ...blankForm('trip', TODAY), days: 40 })[0].key, 'days');
  assert.ok(missingFields({ ...blankForm('trip', TODAY), days: '' }).includes('days'));
});
t('유연근무: 화~목에는 07:00·11:00 을 못 고른다 (사이트 규칙)', () => {
  const wed = { ...blankForm('flex', TODAY), dateFrom: '2026-10-07', flexStart: '11:00', purpose: '병원' };
  assert.equal(problems(wed)[0].key, 'flexStart');
  assert.deepEqual(problems({ ...wed, dateFrom: '2026-10-05' }), []);   // 월요일은 된다
  assert.deepEqual(problems({ ...wed, flexStart: '09:30' }), []);
});
t('유연근무: 주말은 못 올린다', () =>
  assert.equal(problems({ ...blankForm('flex', TODAY), dateFrom: '2026-10-03', flexStart: '09:00' })[0].key, 'dateFrom'));
t('유연근무 주간·전체: 화~목의 07:00·11:00 은 맞지 않는 값이고, 날짜는 보지 않는다', () => {
  const week = { ...blankForm('flex', TODAY), dateFrom: '2026-10-03', flexMode: 'week', flexMon: '07:00', flexTue: '09:00', flexWed: '11:00', flexThu: '09:00', flexFri: '11:00' };
  assert.deepEqual(problems(week).map((p) => p.key), ['flexWed'], '오늘이 주말이어도 주간은 올릴 수 있다');
  assert.deepEqual(problems({ ...blankForm('flex', TODAY), flexMode: 'all', flexStart: '07:00' }).map((p) => p.key), ['flexStart']);
  assert.equal(settle({ ...blankForm('flex', TODAY), flexMode: 'all', flexStart: '07:00' }).flexStart, '', '전체로 옮기면 목록에 없는 값은 비운다');
  assert.equal(settle({ ...blankForm('flex', TODAY), flexMode: 'all', flexStart: '09:30' }).flexStart, '09:30');
  assert.equal(settle({ ...blankForm('flex', TODAY), flexStart: '07:00' }).flexStart, '07:00', '당일은 날짜에 달렸으므로 지우지 않는다');
});

console.log('신청서 내용');
t('내용은 목적 그대로다 — HR 신청서가 받는 글은 그 하나뿐이다', () => {
  assert.equal(contentOf(out), '과제 협의');
  assert.equal(contentOf({ purpose: '  부서소통회 ' }), '부서소통회');
});
t('한 줄 요약', () => assert.equal(describe(out), '외근 10/7 14:00~16:30 · 과제 협의'));
t('한 줄 요약: 갈래를 골랐으면 그 이름으로 — 교육·연차·체력단련', () => {
  assert.equal(describe(settle({ ...out, sub: 'TR', span: 180 })), '교육 10/7 14:00~17:00 · 과제 협의');
  const leave = { ...blankForm('leave', TODAY), dateFrom: '2026-10-07', dateTo: '2026-10-07' };
  assert.equal(describe(leave), '연차 10/7 전일');
  assert.equal(describe({ ...leave, half: 'am' }), '연차 10/7 오전');
  assert.equal(describe(tripDates({ ...leave, sub: 'LH', days: 3 })), '체력단련 10/7~10/9 3일간');
});
t('합계시간은 10분 단위로 내린 값이다 (사이트 계산과 같다)', () => {
  assert.equal(spanHours(out), 2.5);
  assert.equal(spanHours({ ...out, start: '14:10' }), 2.33);
  assert.equal(spanHours({ kind: 'trip', dateFrom: '2026-10-20', dateTo: '2026-10-21', start: '07:00', end: '20:00' }), 37);
});

console.log('HR 폼에 넣는 순서');
t('외근: 종류 → 기다림 → 시작일 → 종료일 → 시 → 분 → 글 → 경비', () => {
  const job = buildJob(out);
  assert.equal(job.route, FORMS.out.route);
  assert.equal(job.fn, null, '넣어 보기만 할 때는 사이트 함수를 부르지 않는다');
  const kind = idx(job, (o) => o.sel === '#biztripKind');
  const from = idx(job, (o) => o.sel === '#biztripDateFrom');
  const to = idx(job, (o) => o.sel === '#biztripDateTo');
  const sh = idx(job, (o) => o.sel === '#strHour');
  const eh = idx(job, (o) => o.sel === '#endHour');
  const sm = idx(job, (o) => o.sel === '#strMin');
  assert.equal(kind, 0);
  assert.equal(job.ops[1].op, 'wait', '종류를 바꾼 뒤 사이트가 폼을 비울 틈을 준다');
  assert.ok(kind < from && from < to && to < sh && sh < eh && eh < sm, '순서가 뒤집혔다');
  assert.equal(setOf(job, '#biztripKind').value, 'OD');
  assert.deepEqual([setOf(job, '#strHour').value, setOf(job, '#strMin').value, setOf(job, '#endHour').value, setOf(job, '#endMin').value],
    ['14', '00', '16', '30'], '종료 시·분은 시작 + 몇 시간에서 나온다');
  assert.equal(setOf(job, '#biztripContent').value, '과제 협의');
  assert.deepEqual([setOf(job, '#biztripPlace').value, setOf(job, '#biztripPurpose').value], ['', ''], '숨은 지역·목적 칸은 사이트에서 올린 문서처럼 비운다');
  assert.deepEqual(job.ops.at(-1), { op: 'radio', name: 'biztripExpKind', value: 'N', label: '출장경비' });
});
t('외근: 누르기 전에 다시 읽어 볼 것 — 종류·구분(시간)·날짜·내용·합계시간', () => {
  const ex = Object.fromEntries(buildJob(out).expect.map((e) => [e.sel, 'num' in e ? e.num : e.value]));
  assert.deepEqual(ex, {
    '#biztripKind': 'OD', '#wrkGubun': '04', '#biztripDateFrom': '2026-10-07', '#biztripDateTo': '2026-10-07',
    '#biztripContent': '과제 협의', '#totalHours': 2.5,
  });
});
t('출장: 분은 건드리지 않고(사이트가 잠근다) 종료일을 따로 넣는다', () => {
  const job = buildJob(tripDates({ ...blankForm('trip', TODAY), dateFrom: '2026-10-20', days: 2, place: '대전', purpose: '중간점검회의 참석' }), { action: 'request' });
  assert.equal(job.route, FORMS.trav.route);
  assert.equal(job.fn, 'apprRequest');
  assert.equal(setOf(job, '#biztripKind').value, 'DBT');
  assert.equal(setOf(job, '#biztripDateTo').value, '2026-10-21');
  assert.equal(setOf(job, '#strMin'), undefined);
  assert.ok(idx(job, (o) => o.sel === '#biztripDateFrom') < idx(job, (o) => o.sel === '#biztripDateTo'),
    '시작일을 나중에 넣으면 사이트가 종료일을 시작일로 되돌린다');
  assert.equal(job.expect.find((e) => e.sel === '#totalHours').num, 37);
  assert.equal(job.read.days, '#days2');
});
t('출장: 목적이 내용으로 들어가고 출장지가 그 뒤에 붙는다', () => {
  const job = buildJob({ ...blankForm('trip', TODAY), place: '대전', purpose: '착수회의 참석' });
  assert.equal(setOf(job, '#biztripContent').value, '착수회의 참석 (출장지: 대전)');
  assert.equal(job.expect.find((e) => e.sel === '#biztripContent').value, '착수회의 참석 (출장지: 대전)');
});
t('출장: 출장지·장소(와 사전정산을 켰으면 근무지)를 적으면 내용의 목적 뒤에 괄호로 붙고, 올릴 내용 요약에도 그대로 보인다 — 숨은 지역 칸은 비워 둔다', () => {
  const form = { ...blankForm('trip', TODAY), purpose: '착수회의 참석', settle: true, place: ' 대전 ', venue: ' 한국기계연구원 ', workplace: '부산 본사' };
  assert.equal(contentOf({ ...form, settle: false }), '착수회의 참석 (출장지: 대전, 장소: 한국기계연구원)', '꺼 두면 근무지 칸이 화면에 없으므로 붙이지 않는다(저장해 둔 근무지도)');
  assert.equal(contentOf(form), '착수회의 참석 (출장지: 대전, 장소: 한국기계연구원, 근무지: 부산 본사)');
  assert.equal(contentOf({ ...form, venue: '' }), '착수회의 참석 (출장지: 대전, 근무지: 부산 본사)');
  assert.equal(contentOf({ ...form, venue: '', workplace: '' }), '착수회의 참석 (출장지: 대전)');
  assert.equal(contentOf({ ...form, place: '', venue: '' }), '착수회의 참석 (근무지: 부산 본사)');
  assert.equal(contentOf({ ...form, place: '', venue: '', workplace: '  ' }), '착수회의 참석');
  assert.equal(contentOf({ ...form, kind: 'out' }), '착수회의 참석', '출장이 아니면 붙이지 않는다');
  assert.equal(describe(form), '출장 10/2 07:00~20:00 · 착수회의 참석 (출장지: 대전, 장소: 한국기계연구원, 근무지: 부산 본사)');
  const job = buildJob(form);
  assert.equal(setOf(job, '#biztripContent').value, '착수회의 참석 (출장지: 대전, 장소: 한국기계연구원, 근무지: 부산 본사)');
  assert.equal(job.expect.find((e) => e.sel === '#biztripContent').value, '착수회의 참석 (출장지: 대전, 장소: 한국기계연구원, 근무지: 부산 본사)');
  assert.equal(setOf(job, '#biztripPlace').value, '');
});
t('출장: 내용을 되읽으면 목적·출장지·장소·근무지로 다시 갈린다 — 붙여 둔 것이 없으면 전부 목적이다', () => {
  const none = { place: '', venue: '', workplace: '' };
  assert.deepEqual(splitContent('착수회의 참석 (출장지: 대전, 장소: 한국기계연구원, 근무지: 부산 본사)'),
    { purpose: '착수회의 참석', place: '대전', venue: '한국기계연구원', workplace: '부산 본사' });
  assert.deepEqual(splitContent('착수회의 참석 (출장지: 대전, 장소: 한국기계연구원)'), { ...none, purpose: '착수회의 참석', place: '대전', venue: '한국기계연구원' });
  assert.deepEqual(splitContent('착수회의 참석 (출장지: 대전, 근무지: 부산 본사)'), { ...none, purpose: '착수회의 참석', place: '대전', workplace: '부산 본사' });
  assert.deepEqual(splitContent('착수회의 참석 (출장지: 대전)'), { ...none, purpose: '착수회의 참석', place: '대전' });
  assert.deepEqual(splitContent('착수회의 참석 (근무지: 부산 본사)'), { ...none, purpose: '착수회의 참석', workplace: '부산 본사' });
  assert.deepEqual(splitContent('회의(1차) (출장지: 대전(KAIST), 근무지: 부산)'), { ...none, purpose: '회의(1차)', place: '대전(KAIST)', workplace: '부산' });
  assert.deepEqual(splitContent('회의 (출장지: 대전, 장소: 본관(3층), 근무지: 부산)'), { purpose: '회의', place: '대전', venue: '본관(3층)', workplace: '부산' });
  assert.deepEqual(splitContent('착수회의 참석 (대전)'), { ...none, purpose: '착수회의 참석 (대전)' });
  assert.deepEqual(splitContent(''), { ...none, purpose: '' });
});
t('교육: 외근/교육 신청서에 TR 로 올리고 분은 건드리지 않는다', () => {
  const job = buildJob(settle({ ...out, sub: 'TR', span: 180 }), { action: 'save' });
  assert.equal(job.route, FORMS.out.route);
  assert.equal(job.fn, 'saveTrav100');
  assert.equal(setOf(job, '#biztripKind').value, 'TR');
  assert.equal(job.expect.find((e) => e.sel === '#biztripKind').value, 'TR');
  assert.equal(setOf(job, '#strMin'), undefined, '교육은 사이트가 분을 잠근다');
  assert.equal(job.expect.find((e) => e.sel === '#totalHours').num, 3);
});
t('연차: 연차 전용 칸에 날짜 → 시작구분 → 종료구분 순서로, 날짜는 focusout 까지', () => {
  const job = buildJob(tripDates({ ...blankForm('leave', TODAY), dateFrom: '2026-10-07', half: 'pm' }), { action: 'request' });
  assert.equal(job.route, FORMS.holi.route);
  assert.equal(job.formId, 'LV');
  assert.equal(job.fn, 'apprRequest');
  assert.equal(setOf(job, '#workCodeKind').value, 'LY');
  const order = ['#workCodeKind', '#lyStartDate', '#lyEndDate', '#lyStartDateWrkGubun', '#lyEndDateWrkGubun'].map((sel) => idx(job, (o) => o.sel === sel));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), '순서가 뒤집혔다');
  assert.ok(order.every((i) => i >= 0));
  assert.deepEqual(setOf(job, '#lyStartDate').events, ['change', 'focusout']);
  assert.deepEqual([setOf(job, '#lyStartDateWrkGubun').value, setOf(job, '#lyEndDateWrkGubun').value], ['03', '03'], '하루짜리 오후');
  assert.equal(setOf(job, '#wrkGubun'), undefined, '연차는 휴가구분 칸을 쓰지 않는다');
  assert.equal(setOf(job, '#reqRsn'), undefined, '연차는 사유를 받지 않는다');
  assert.deepEqual(job.read, { days: '#lyDays', hours: '#lyHours' });
});
t('연차 여러 날: 종료일을 넣고 구분은 둘 다 전일 (오전·오후를 골라 두었어도)', () => {
  const job = buildJob(tripDates({ ...blankForm('leave', TODAY), dateFrom: '2026-10-07', days: 3, half: 'am' }));
  assert.equal(setOf(job, '#lyEndDate').value, '2026-10-09');
  assert.deepEqual([setOf(job, '#lyStartDateWrkGubun').value, setOf(job, '#lyEndDateWrkGubun').value], ['01', '01']);
  assert.equal(job.summary, '연차 10/7~10/9 3일간');
});
t('체력단련: 구분은 건드리지 않고(사이트가 전일로 잠근다) 날짜만 넣은 뒤 전일인지 확인한다', () => {
  const job = buildJob(tripDates({ ...blankForm('leave', TODAY), sub: 'LH', dateFrom: '2026-10-07', days: 2 }), { action: 'save' });
  assert.equal(job.fn, 'saveHoli100');
  assert.equal(setOf(job, '#workCodeKind').value, 'LH');
  assert.equal(setOf(job, '#wrkGubun'), undefined);
  assert.deepEqual([setOf(job, '#startDate').value, setOf(job, '#endDate').value], ['2026-10-07', '2026-10-08']);
  assert.equal(job.expect.find((e) => e.sel === '#wrkGubun').value, '01');
  assert.equal(setOf(job, '#lyStartDate'), undefined);
});
t('외출: 기타근태 폼, 사유로 들어간다', () => {
  const job = buildJob(settle({ ...blankForm('leaveout', TODAY), start: '15:30', span: 60, purpose: '병원 방문' }), { action: 'save' });
  assert.deepEqual([setOf(job, '#endHour').value, setOf(job, '#endMin').value], ['16', '30']);
  assert.equal(job.route, FORMS.etc.route);
  assert.equal(job.fn, 'saveEtc100');
  assert.equal(setOf(job, '#workCodeKind').value, 'ZLO');
  assert.equal(setOf(job, '#reqRsn').value, '병원 방문');
  assert.equal(job.expect.find((e) => e.sel === '#totalHours').num, 1);
});
t('건강검진: 구분을 먼저 넣고(넣으면 날짜가 지워진다) 날짜는 focusout 까지 쏜다', () => {
  const file = { name: 'a.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA' };
  const job = buildJob({ ...blankForm('health', TODAY), dateFrom: '2026-10-08', purpose: '건강검진', file }, { action: 'save' });
  assert.equal(job.fn, 'saveHoli100');
  assert.equal(setOf(job, '#workCodeKind').value, 'HCL');
  assert.equal(setOf(job, '#wrkGubun').value, '01');
  assert.ok(idx(job, (o) => o.sel === '#wrkGubun') < idx(job, (o) => o.sel === '#startDate'));
  assert.deepEqual(setOf(job, '#startDate').events, ['change', 'focusout']);
  assert.equal(setOf(job, '#strHour'), undefined, '하루 전체면 시각을 넣지 않는다');
  assert.deepEqual(job.ops.find((o) => o.op === 'file'), { op: 'file', label: '첨부파일', ...file });
});
t('출장: 신청서에는 첨부 작업이 없다 — 증빙은 신청할 때 붙이지 않는다', () => {
  const base = settle({ ...blankForm('trip', TODAY), dateFrom: '2026-10-20', place: '대전', purpose: '착수회의 참석' });
  assert.equal(buildJob(base).ops.find((o) => o.op === 'file'), undefined);
});
t('건강검진(시간): 구분 04 와 시각', () => {
  const job = buildJob(settle({ ...blankForm('health', TODAY), allDay: false, start: '09:00', span: 180, purpose: '건강검진', hasFile: true }));
  assert.equal(setOf(job, '#wrkGubun').value, '04');
  assert.equal(setOf(job, '#endHour').value, '12');
});
t('유연근무: 표에 한 줄 — 날짜는 숫자 여덟 자리, 시간은 사이트 코드', () => {
  const job = buildJob({ ...blankForm('flex', TODAY), dateFrom: '2026-10-07', flexStart: '09:30', purpose: '병원 방문' }, { action: 'save' });
  assert.equal(job.route, FORMS.flex.route);
  assert.equal(job.fn, 'saveGrid');
  assert.deepEqual(job.ops, [{ op: 'flexRow', edit: false, row: { wcDate: '20261007', wcTime: '7', reqRsn: '병원 방문' } }]);
});
t('유연근무 주간: 기간구분을 Weekly 로 바꾸고, 사이트의 근무시간표 조회가 끝난 뒤 월~금 다섯 칸에 코드를 넣는다', () => {
  const week = { ...blankForm('flex', TODAY), flexMode: 'week', flexMon: '07:00', flexTue: '09:00', flexWed: '09:30', flexThu: '10:00', flexFri: '11:00' };
  const job = buildJob(week, { action: 'request' });
  assert.equal(job.fn, 'apprRequest');
  assert.deepEqual(job.ops.slice(0, 2), [{ op: 'set', sel: '#dayGbn', value: 'WE', label: '기간구분', events: ['change'] }, { op: 'idle', ms: 700 }]);
  assert.deepEqual(job.ops.slice(2).map((o) => [o.sel, o.value]), [['#monTime', '1'], ['#tueTime', '4'], ['#wedTime', '7'], ['#thuTime', '5'], ['#friTime', '6']]);
  assert.deepEqual(job.expect.map((x) => [x.sel, x.value]),
    [['#dayGbn', 'WE'], ['#monTime', '1'], ['#tueTime', '4'], ['#wedTime', '7'], ['#thuTime', '5'], ['#friTime', '6']]);
  assert.equal(job.ops.some((o) => o.op === 'flexRow'), false, 'Daily 표에는 줄을 넣지 않는다');
  assert.equal(job.summary, '유연근무 주간 월 07:00 · 화 09:00 · 수 09:30 · 목 10:00 · 금 11:00');
});
t('유연근무 전체: 다섯 칸에 같은 코드. 저장된 문서를 고칠 때는 잠긴 기간구분을 건드리지 않는다', () => {
  const all = { ...blankForm('flex', TODAY), flexMode: 'all', flexStart: '09:00' };
  const job = buildJob(all, { action: 'save', doc: { docNo: '202610-11115-0002', statusCode: '1' } });
  assert.equal(setOf(job, '#dayGbn'), undefined);
  assert.deepEqual(job.ops.map((o) => [o.sel, o.value]), [['#monTime', '4'], ['#tueTime', '4'], ['#wedTime', '4'], ['#thuTime', '4'], ['#friTime', '4']]);
  assert.deepEqual(job.expect[0], { sel: '#dayGbn', value: 'WE', label: '기간구분(Weekly)' }, 'Daily 로 저장된 문서면 확인에서 멈춘다');
  assert.equal(job.summary, '유연근무 주간 월~금 09:00 ~ 18:00');
  assert.throws(() => buildJob({ ...all, flexStart: '11:00' }), /비어 있거나/);
});
t('임시저장 문서를 고칠 때는 종류를 다시 넣지 않고 그 문서를 연다', () => {
  const job = buildJob(out, { action: 'save', doc: { docNo: '202610-11115-0001', statusCode: '1' } });
  assert.deepEqual(job.open, { docNo: '202610-11115-0001', statusCode: '1' });
  assert.equal(setOf(job, '#biztripKind'), undefined);
  assert.equal(job.ops[0].sel, '#biztripDateFrom');
});
t('빈 칸이 있으면 일감을 만들지 않는다', () => {
  assert.throws(() => buildJob(blankForm('out', TODAY)), /비어 있거나/);
  assert.throws(() => buildJob(blankForm('', TODAY)), /종류/);
});

console.log('신청 내역');
const ROW = {
  docNo: '202609-11115-0009', statusCode: '5', statusName: '결재완료', formId: 'TRO', formName: '외근/교육 신청서',
  workCodeKindName: '외근', startDate: '20260923', startTime: '1200', endDate: '20260923', endTime: '1400',
  wrkGubunName: '시간', reqRsn: '부서소통회', pgmUrlAd: '/uhr/docappr/approut100/view',
};
t('목록의 한 건이 어느 종류인지 — 종류 줄에서 고른 종류의 신청 내역만 보일 때 쓴다. 모르는 신청서는 "내역"에서만', () => {
  const of = (formId, kindName) => kindOfItem({ ...ROW, formId, workCodeKindName: kindName, kindName });
  assert.deepEqual([of('TR', '국내출장'), of('TRO', '외근'), of('TRO', '교육'), of('FW', '유연근무'), of('ET', '외출')], ['trip', 'out', 'out', 'flex', 'leaveout']);
  assert.deepEqual([of('LV', '정기 건강검진'), of('LV', '연차'), of('LV', '체력관리'), of('LV', '경조휴가'), of('CTR', '국내출장')], ['health', 'leave', 'leave', 'leave', '']);
  const items = [{ formId: 'TR', kindName: '국내출장', docNo: 'a' }, { formId: 'LV', kindName: '연차', docNo: 'b' }, { formId: 'CTR', kindName: '취소', docNo: 'c' }];
  assert.deepEqual(itemsOfKind(items, 'trip').map((x) => x.docNo), ['a']);
  assert.deepEqual(itemsOfKind(items, 'leave').map((x) => x.docNo), ['b']);
  assert.deepEqual(itemsOfKind(items, 'all').map((x) => x.docNo), ['a', 'b', 'c']);
  assert.deepEqual(itemsOfKind(items, '').map((x) => x.docNo), ['a', 'b', 'c']);
});
t('한 줄 요약과 조회 주소', () => {
  const it = listItem(ROW);
  assert.equal(it.summary, '외근 9/23 12:00~14:00');
  assert.equal(it.api, '/uhr/docappr/approut100');
  assert.deepEqual([it.from, it.start, it.end], ['2026-09-23', '12:00', '14:00']);
});
t('결재 상태 딱지의 말: 올려 둔 것(결재대기·결재요청)은 "신청", 결재완료는 "승인" — 임시저장·반려·회수는 HR 의 이름 그대로다', () => {
  const label = (statusCode, statusName) => statusLabel(listItem({ ...ROW, statusCode, statusName }));
  assert.deepEqual([label('2', '결재대기'), label('3', '결재요청'), label('5', '결재완료')], ['신청', '신청', '승인']);
  assert.deepEqual([label('1', '임시저장'), label('4', '반려'), label('6', '회수')], ['임시저장', '반려', '회수']);
});
t('결재완료 → 변경·취소신청', () => assert.deepEqual(listItem(ROW).actions, ['change', 'cancel']));
t('임시저장 → 수정·상신·삭제', () =>
  assert.deepEqual(listItem({ ...ROW, statusCode: '1' }).actions, ['edit', 'request', 'delete']));
t('결재요청(승인 전) → 변경·회수', () =>
  assert.deepEqual(listItem({ ...ROW, statusCode: '3' }).actions, ['change', 'recall']));
t('반려된 건에는 할 일이 없고(복사는 뺐다), 회수한 건은 지울 수 있다', () => {
  assert.deepEqual(listItem({ ...ROW, statusCode: '4' }).actions, []);
  assert.deepEqual(listItem({ ...ROW, statusCode: '6' }).actions, ['delete']);
  assert.deepEqual(listItem({ ...ROW, statusCode: '6', formId: 'LV', workCodeKindName: '병가' }).actions, ['delete'], '패널이 다루지 않는 종류도 회수했으면 지운다');
});
t('HR 웹 화면에서 열 때 쓰는 값 — 문서함에서 줄을 두 번 누를 때 사이트가 묶는 것과 같다', () => {
  const it = listItem({ ...ROW, pgmId: '1101', createEmplNo: '11115', createEmplName: '김거화', orgCode: 'A100', orgNameHan: '수소전기추진연구팀' });
  assert.deepEqual(it.web, { pgmId: '1101', pgmUrlAd: '/uhr/docappr/approut100/view',
    param: { docNo: '202609-11115-0009', emplNo: '11115', emplNameHan: '김거화', orgCode: 'A100', orgNameHan: '수소전기추진연구팀', statusCode: '5' } });
  assert.equal(Object.keys(it.web.param)[0], 'docNo', '사이트는 첫 번째 열쇠(docNo)로 이미 열린 탭의 문서를 바꾼다');
  assert.equal(listItem({ ...ROW, pgmUrlAd: '' }).web, null, '화면 주소를 모르면 버튼을 달지 않는다');
});
t('유연근무는 취소신청서가 없다', () =>
  assert.deepEqual(listItem({ ...ROW, formId: 'FW', workCodeKindName: '유연근무' }).actions, []));
t('주간 유연근무는 날짜 자리에 "Weekly" 가 온다 — 요약은 "주간", 날짜는 비어 신청한 날로 놓인다 (2026-06-23 실제 목록)', () => {
  const it = listItem({ ...ROW, docNo: '202606-11115-0011', formId: 'FW', formName: '유연근무 신청', workCodeKindName: '유연근무',
    startDate: 'Weekly', endDate: 'Weekly', startTime: 'Weekly', endTime: 'Weekly', reqRsn: '', reqstDate: '2026-06-23 08:30:14' });
  assert.deepEqual([it.summary, it.from, it.start, it.requested], ['유연근무 주간', '', '', '2026-06-23']);
});
t('패널이 다루지 않는 종류(병가)는 수정·변경 없이 삭제·취소신청만', () => {
  const sick = { ...ROW, formId: 'LV', workCodeKindName: '병가', startTime: '', endTime: '', wrkGubunName: '전일' };
  assert.deepEqual(listItem({ ...sick, statusCode: '1' }).actions, ['request', 'delete']);
  assert.deepEqual(listItem({ ...sick, statusCode: '3' }).actions, ['recall']);
  assert.deepEqual(listItem(sick).actions, ['cancel']);
  assert.equal(listItem(sick).summary, '병가 9/23 전일');
});
t('연차·체력관리·교육은 패널이 다룬다 — 수정·변경이 붙는다', () => {
  const leave = { ...ROW, formId: 'LV', workCodeKindName: '연차', startTime: '', endTime: '', wrkGubunName: '전일' };
  assert.deepEqual(listItem({ ...leave, statusCode: '1' }).actions, ['edit', 'request', 'delete']);
  assert.deepEqual(listItem({ ...leave, workCodeKindName: '체력관리' }).actions, ['change', 'cancel']);
  assert.deepEqual(listItem({ ...ROW, workCodeKindName: '교육' }).actions, ['change', 'cancel']);
  assert.deepEqual(listItem({ ...ROW, formId: 'TR', workCodeKindName: '교육' }).actions, ['cancel'], '출장 신청서로 올린 교육은 다루지 않는다');
});
t('삭제된 건은 빼고, 최근 문서가 위로', () => {
  const items = listItems([{ ...ROW, docNo: '202609-11115-0001' }, { ...ROW, docNo: '202609-11115-0005', statusCode: 'D' }, ROW]);
  assert.deepEqual(items.map((i) => i.docNo), ['202609-11115-0009', '202609-11115-0001']);
});
t('상신·회수 일감: 문서를 열고 사이트 버튼 함수만 부른다', () => {
  const it = listItem({ ...ROW, statusCode: '1' });
  const req = buildDocJob(it, 'request');
  assert.deepEqual([req.route, req.fn, req.ops.length], [FORMS.out.route, 'apprRequest', 0]);
  assert.deepEqual(req.open, { docNo: ROW.docNo, statusCode: '1' });
  assert.equal(buildDocJob(listItem({ ...ROW, statusCode: '3' }), 'recall').fn, 'apprReqCancel');
});
t('취소신청 일감: 폼별 취소 화면, 사유 필수, 그해 전체를 뒤진다', () => {
  const job = buildCancelJob(listItem(ROW), ' 일정 변경 ');
  assert.equal(job.route, CANCEL_FORMS.TRO.route);
  assert.equal(job.fn, 'apprRequest');
  assert.deepEqual(job.ops[0], { op: 'cancelRow', grid: 'docapprcnclout100Grid', pop: '/uhr/docappr/apprtrav-pop', docNo: ROW.docNo,
    reason: '일정 변경', params: { fromDate: '2026-01-01', toDate: '2026-12-31', workGbn: 'O' } });
  assert.throws(() => buildCancelJob(listItem(ROW), '  '), /사유/);
  assert.equal(buildCancelJob(listItem({ ...ROW, formId: 'ET', workCodeKindName: '외출' }), 'x').route, CANCEL_FORMS.LV.route);
  assert.throws(() => buildCancelJob(listItem({ ...ROW, formId: 'FW' }), 'x'), /취소신청서가 없습니다/);
});

console.log('신청 내역에 보여줄 기간 — 근태 날짜 기준(기간을 정해 조회할 때. 기본 보기는 test/settling.test.mjs)');
{
  const row = (docNo, from, to, extra = {}) => ({
    ...ROW, docNo, startDate: from.replace(/-/g, ''), endDate: (to || from).replace(/-/g, ''), reqstDate: '2026-09-01 09:00:00', ...extra,
  });
  const items = listItems([
    row('D-1', '2026-09-23'), row('D-2', '2026-09-25'), row('D-3', '2026-10-02'), row('D-4', '2026-10-20', '2026-10-22'),
    row('D-5', '2026-11-02'), row('D-6', '2026-11-03'), row('D-7', '2026-09-20', '2026-09-26'),
    { ...ROW, docNo: 'C-1', formId: 'TROC', workCodeKindName: '', formName: '외근/교육 취소 신청', startDate: '', endDate: '', startTime: '', endTime: '', reqstDate: '2026-10-01 15:41:53' },
    { ...ROW, docNo: 'C-0', formId: 'TROC', workCodeKindName: '', formName: '외근/교육 취소 신청', startDate: '', endDate: '', startTime: '', endTime: '', reqstDate: '2026-08-04 15:41:53' },
  ]);
  t('근태 날짜가 기간에 걸친 것만, 날짜가 늦은 것이 위로 (기간에 하루만 걸쳐도 보인다)', () =>
    assert.deepEqual(itemsIn(items, '2026-09-25', '2026-11-02').map((it) => it.docNo), ['D-5', 'D-4', 'D-3', 'C-1', 'D-2', 'D-7']));
  t('근태 날짜가 없는 문서(취소신청서)는 신청한 날로 놓는다', () => {
    assert.equal(items.find((it) => it.docNo === 'C-1').requested, '2026-10-01');
    assert.ok(!itemsIn(items, '2026-09-25', '2026-11-02').some((it) => it.docNo === 'C-0'));
    assert.ok(itemsIn(items, '2026-08-01', '2026-11-02').some((it) => it.docNo === 'C-0'));
  });
  t('지난 건: 끝나는 날이 오늘보다 앞이다. 오늘 것과 오늘까지 이어지는 것은 지난 것이 아니다', () => {
    const past = (docNo) => isPast(items.find((it) => it.docNo === docNo), TODAY);
    assert.deepEqual(['D-1', 'D-7', 'D-3', 'D-4', 'C-1'].map(past), [true, true, false, false, true]);
    assert.equal(isPast(listItem(row('X', '2026-09-30', '2026-10-02')), TODAY), false);
  });
  t('여비계산서 목록을 읽을 기간은 보이는 출장 줄의 출장기간을 다 덮게 넓힌다 — 한쪽만 걸친 출장의 첫날·끝날까지(2026-10-08). 출장이 아닌 줄·근태 날짜가 없는 줄은 보지 않는다', () => {
    const trips = listItems([
      row('T-1', '2026-09-20', '2026-09-26', { formId: 'TR', formName: '출장신청서', workCodeKindName: '국내출장' }),
      row('T-2', '2026-10-20', '2026-10-22', { formId: 'TR', formName: '출장신청서', workCodeKindName: '국내출장' }),
      row('O-1', '2026-09-10'),   // 외근 — 넓히지 않는다
    ]);
    assert.deepEqual(rangeCovering({ from: '2026-09-25', to: '2026-10-21' }, trips), { from: '2026-09-20', to: '2026-10-22' });
    assert.deepEqual(rangeCovering({ from: '2026-09-01', to: '2026-11-01' }, trips), { from: '2026-09-01', to: '2026-11-01' }, '다 덮으면 그대로');
    assert.deepEqual(rangeCovering({ from: '2026-09-25', to: '2026-10-21' }, items), { from: '2026-09-25', to: '2026-10-21' }, '외근·취소신청서는 보지 않는다');
    assert.deepEqual(rangeCovering({ from: '2026-09-25', to: '2026-10-21' }, null), { from: '2026-09-25', to: '2026-10-21' });
  });
}

console.log('반차와 근무시간 — 출근이 정시가 아니면 09:00~18:00 으로 옮긴 뒤 쓴다');
{
  const WEEK = { monTime: '3', tueTime: '3', wedTime: '2', thuTime: '3', friTime: '3' };   // 3 = 08:30, 2 = 08:00
  const flexDoc = (docNo, date, start, statusCode = '5') => ({
    docNo, statusCode, formId: 'FW', workCodeKindName: '유연근무', startDate: date.replace(/-/g, ''), endDate: date.replace(/-/g, ''),
    startTime: start.replace(':', ''), endTime: '1800',
  });
  const halfDay = (date, half) => ({ ...blankForm('leave', TODAY), dateFrom: date, dateTo: date, half });
  t('그 날의 출근시간: 주간 근무시간표의 그 요일', () => {
    assert.equal(workStartOn('2026-10-06', { week: WEEK }), '08:30');   // 화
    assert.equal(workStartOn('2026-10-07', { week: WEEK }), '08:00');   // 수
    assert.equal(workStartOn('2026-10-10', { week: WEEK }), '', '주말은 시간표에 없다');
    assert.equal(workStartOn('2026-10-06', {}), '', '시간표를 못 읽었으면 모른다');
  });
  t('그 날짜로 올려 둔 유연근무가 있으면 그것이 이긴다 (마지막에 올린 것, 반려·임시저장은 빼고)', () => {
    const items = listItems([flexDoc('A-1', '2026-10-06', '09:00'), flexDoc('A-2', '2026-10-06', '10:00', '4'), flexDoc('A-0', '2026-10-06', '08:00')]);
    assert.equal(workStartOn('2026-10-06', { week: WEEK, items }), '09:00');
    assert.equal(workStartOn('2026-10-08', { week: WEEK, items }), '08:30', '다른 날의 유연근무는 보지 않는다');
  });
  t('08:00 출근: 오전 반차 08:00~12:00, 오후 반차 13:00~17:00 — 유연근무를 올리지 않는다', () => {
    assert.deepEqual(halfPlan(halfDay('2026-10-07', 'am'), '08:00'), { half: 'am', workStart: '08:00', flexStart: '', from: '08:00', to: '12:00' });
    assert.deepEqual(halfPlan(halfDay('2026-10-07', 'pm'), '08:00'), { half: 'pm', workStart: '08:00', flexStart: '', from: '13:00', to: '17:00' });
    assert.equal(halfFlexForm(halfDay('2026-10-07', 'pm'), halfPlan(halfDay('2026-10-07', 'pm'), '08:00'), TODAY), null);
  });
  t('08:30 출근: 09:00~18:00 으로 옮긴 뒤 반차 — 오전 09:00~13:00, 오후 14:00~18:00', () => {
    const am = halfPlan(halfDay('2026-10-06', 'am'), '08:30');
    assert.deepEqual(am, { half: 'am', workStart: '08:30', flexStart: '09:00', from: '09:00', to: '13:00' });
    assert.deepEqual(halfPlan(halfDay('2026-10-06', 'pm'), '08:30'), { half: 'pm', workStart: '08:30', flexStart: '09:00', from: '14:00', to: '18:00' });
    const flex = halfFlexForm(halfDay('2026-10-06', 'am'), am, TODAY);
    assert.deepEqual([flex.kind, flex.dateFrom, flex.flexStart, flex.purpose], ['flex', '2026-10-06', '09:00', '오전 반차 사용에 따른 출근시간 변경']);
    assert.equal(readyToSend(flex), true);
    assert.deepEqual(buildJob(flex, { action: 'request' }).ops, [{ op: 'flexRow', edit: false, row: { wcDate: '20261006', wcTime: '4', reqRsn: '오전 반차 사용에 따른 출근시간 변경' } }]);
  });
  t('반차가 아니면(전일·여러 날·체력단련) 근무시간을 보지 않는다', () => {
    assert.equal(halfPlan(halfDay('2026-10-06', ''), '08:30'), null);
    assert.equal(halfPlan({ ...halfDay('2026-10-06', 'am'), days: 2 }, '08:30'), null);
    assert.equal(halfPlan({ ...halfDay('2026-10-06', 'am'), sub: 'LH' }, '08:30'), null);
    assert.equal(halfPlan(halfDay('2026-10-10', 'am'), ''), null, '출근시간을 모르면 계획도 없다');
  });
}

console.log('WORKSPACE 현황에 보여줄 근태');
t('그 기간에 걸친, 올렸거나 결재가 끝난 것만 날짜순으로 — 종류 이름은 줄인다', () => {
  const trip = { ...ROW, docNo: 'T', formId: 'TR', workCodeKindName: '국내출장', startDate: '20261020', endDate: '20261022', startTime: '0700', endTime: '2000', reqRsn: '회의' };
  const leave = { ...ROW, docNo: 'L', formId: 'LV', workCodeKindName: '연차', statusCode: '3', statusName: '결재요청', startDate: '20261012', endDate: '20261012', startTime: '', endTime: '', wrkGubunName: '전일', reqRsn: '' };
  const items = listItems([trip, leave, ROW,
    { ...trip, docNo: 'TEMP', statusCode: '1' }, { ...trip, docNo: 'BACK', statusCode: '4' }, { ...trip, docNo: 'CNCL', formId: 'TRC' }]);
  const got = plansIn(items, '2026-10-02', '2026-10-31');
  assert.deepEqual(got.map((p) => [p.docNo, p.label, p.from, p.to, p.status]),
    [['L', '연차', '2026-10-12', '2026-10-12', '결재요청'], ['T', '출장', '2026-10-20', '2026-10-22', '결재완료']]);
  assert.deepEqual([got[1].start, got[1].end, got[0].gubun], ['07:00', '20:00', '전일']);
  assert.deepEqual(plansIn(items, '2026-10-22', '2026-10-25').map((p) => p.docNo), ['T'], '기간에 하루만 걸쳐도 보인다');
  assert.deepEqual(plansIn(items, '2026-10-23', '2026-10-31'), []);
});

console.log('HR 문서를 폼으로 되돌리기');
t('외근', () => {
  const f = formFromDoc('TRO', { biztripKind: 'OD', wrkGubun: '04', biztripDateFrom: '2026-08-03', biztripDateTo: '2026-08-03',
    strHour: '13', strMin: '00', endHour: '18', endMin: '00', biztripPlace: '부산', biztripPurpose: '조선전동화(RIMS)', biztripContent: '조선전동화(RIMS) — 부산', biztripExpKind: 'N' }, TODAY);
  assert.deepEqual([f.kind, f.dateFrom, f.start, f.end, f.place, f.purpose, f.expense], ['out', '2026-08-03', '13:00', '18:00', '', '조선전동화(RIMS) — 부산', 'N'],
    '문서의 글은 "내용"이다. 숨은 지역 칸은 가져오지 않는다');
});
t('내용이 빈 예전 문서는 숨은 목적 칸에서 읽는다', () =>
  assert.equal(formFromDoc('TRO', { biztripKind: 'OD', wrkGubun: '04', biztripDateFrom: '2026-08-03', strHour: '13', strMin: '00', endHour: '18', endMin: '00', biztripPurpose: '협의', biztripContent: '' }, TODAY).purpose, '협의'));
t('목적이 부서소통회인 외근은 소통 갈래로 돌아온다 — 시각은 문서에 적힌 그대로다', () => {
  const f = formFromDoc('TRO', { biztripKind: 'OD', wrkGubun: '04', biztripDateFrom: '2026-09-23', strHour: '12', strMin: '00', endHour: '14', endMin: '00', biztripContent: '부서소통회' }, TODAY);
  assert.deepEqual([f.kind, f.sub, f.start, f.end, f.span], ['out', 'MEET', '12:00', '14:00', 120]);
  assert.equal(readyToSend(f), true);
});
t('출장·외출·건강검진·유연근무', () => {
  const trip = formFromDoc('TR', { biztripKind: 'DBT', wrkGubun: '04', biztripDateFrom: '2026-10-27', biztripDateTo: '2026-10-28', strHour: '09', strMin: '00', endHour: '18', endMin: '00', biztripPlace: '대전', biztripPurpose: '회의' }, TODAY);
  assert.deepEqual([trip.dateTo, trip.days], ['2026-10-28', 2]);
  assert.equal(formFromDoc('ET', { workCodeKind: 'ZLO', startDate: '2026-09-01', strHour: '16', strMin: '00', endHour: '17', endMin: '00', reqRsn: '자녀병원' }, TODAY).purpose, '자녀병원');
  const h = formFromDoc('LV', { workCodeKind: 'HCL', wrkGubun: '01', startDate: '2026-09-08', reqRsn: '건강검진', atchFileId: 'abc' }, TODAY);
  assert.deepEqual([h.kind, h.allDay, h.hasFile], ['health', true, true]);
  const fx = formFromDoc('FW', { dayGbn: 'DA', wcDate: '20260923', wcTime: '4', reqRsn: '출근시간 변경' }, TODAY);
  assert.deepEqual([fx.kind, fx.dateFrom, fx.flexStart], ['flex', '2026-09-23', '09:00']);
});
t('되돌린 폼은 다시 올릴 수 있는 모양이다', () => {
  const f = formFromDoc('ET', { workCodeKind: 'ZLO', startDate: '2026-09-01', strHour: '16', strMin: '00', endHour: '17', endMin: '00', reqRsn: '자녀병원' }, TODAY);
  assert.equal(readyToSend(f), true);
});
t('교육·연차·체력단련', () => {
  const edu = formFromDoc('TRO', { biztripKind: 'TR', wrkGubun: '04', biztripDateFrom: '2026-10-07', biztripDateTo: '2026-10-07', strHour: '13', strMin: '00', endHour: '17', endMin: '00', biztripContent: '안전관리 교육' }, TODAY);
  assert.deepEqual([edu.kind, edu.sub, edu.start, edu.end, edu.purpose], ['out', 'TR', '13:00', '17:00', '안전관리 교육']);
  assert.equal(readyToSend(edu), true);
  const half = formFromDoc('LV', { workCodeKind: 'LY', wrkGubun: '03', nextWrkGubun: '03', startDate: '2026-10-07', endDate: '2026-10-07' }, TODAY);
  assert.deepEqual([half.kind, half.sub, half.days, half.half], ['leave', 'LY', 1, 'pm']);
  const many = formFromDoc('LV', { workCodeKind: 'LY', wrkGubun: '01', nextWrkGubun: '01', startDate: '2026-10-07', endDate: '2026-10-09' }, TODAY);
  assert.deepEqual([many.days, many.dateTo, many.half], [3, '2026-10-09', '']);
  // 2026-07-08 실제 문서 모양: 체력관리 전일, nextWrkGubun 은 비어 있다
  const fit = formFromDoc('LV', { workCodeKind: 'LH', wrkGubun: '01', nextWrkGubun: '', startDate: '2026-07-08', endDate: '2026-07-08' }, TODAY);
  assert.deepEqual([fit.kind, fit.sub, fit.days, fit.half], ['leave', 'LH', 1, '']);
  assert.equal(readyToSend(fit), true);
});
t('외근·출장으로 돌아온 폼에는 갈래가 맞게 들어 있다', () => {
  const o = formFromDoc('TRO', { biztripKind: 'OD', wrkGubun: '04', biztripDateFrom: '2026-08-03', strHour: '13', strMin: '00', endHour: '18', endMin: '00', biztripContent: '협의' }, TODAY);
  assert.equal(o.sub, 'OD');
  assert.equal(formFromDoc('TR', { biztripKind: 'DBT', wrkGubun: '04', biztripDateFrom: '2026-10-27', strHour: '09', strMin: '00', endHour: '18', endMin: '00', biztripContent: '회의' }, TODAY).sub, '');
});
t('출장 문서의 내용에 붙여 올린 출장지·장소·근무지는 칸으로 돌아오고, 다시 올리면 같은 내용이 된다', () => {
  const doc = { biztripKind: 'DBT', wrkGubun: '04', biztripDateFrom: '2026-10-27', strHour: '07', strMin: '00', endHour: '20', endMin: '00' };
  const f = formFromDoc('TR', { ...doc, biztripContent: '착수회의 참석 (출장지: 대전, 장소: 한국기계연구원, 근무지: 부산 본사)' }, TODAY);
  assert.deepEqual([f.purpose, f.place, f.venue, f.workplace, f.settle], ['착수회의 참석', '대전', '한국기계연구원', '부산 본사', true], '근무지 칸이 보이게 사전정산이 켜진 채로 돌아온다');
  assert.equal(contentOf(f), '착수회의 참석 (출장지: 대전, 장소: 한국기계연구원, 근무지: 부산 본사)');
  const plain = formFromDoc('TR', { ...doc, biztripContent: '착수회의 참석 (출장지: 대전, 장소: 한국기계연구원)' }, TODAY);
  assert.deepEqual([plain.place, plain.venue, plain.settle], ['대전', '한국기계연구원', false], '근무지가 없으면 사전정산은 꺼진 채다 — 출장지·장소는 늘 보인다');
  assert.equal(contentOf(plain), '착수회의 참석 (출장지: 대전, 장소: 한국기계연구원)');
  const old = formFromDoc('TR', { ...doc, biztripContent: '착수회의 참석 (대전)' }, TODAY);
  assert.deepEqual([old.purpose, old.place, old.workplace, old.settle], ['착수회의 참석 (대전)', '', '', false], '붙여 올리지 않은 문서는 목적 그대로다');
  const o = formFromDoc('TRO', { ...doc, biztripKind: 'OD', biztripContent: '협의 (출장지: 대전)' }, TODAY);
  assert.deepEqual([o.purpose, o.place], ['협의 (출장지: 대전)', ''], '외근 문서는 가르지 않는다');
});
t('주간 유연근무 문서: 다섯 요일이 같으면 전체로, 다르면 주간으로 돌아온다 (2026-06-23 실제 문서 모양)', () => {
  const same = formFromDoc('FW', { dayGbn: 'WE', monTime: '3', tueTime: '3', wedTime: '3', thuTime: '3', friTime: '3', startDate: '20260623' }, TODAY);
  assert.deepEqual([same.kind, same.flexMode, same.flexStart, same.flexWed], ['flex', 'all', '08:30', '08:30']);
  assert.equal(readyToSend(same), true);
  const mixed = formFromDoc('FW', { dayGbn: 'WE', monTime: '1', tueTime: '4', wedTime: '4', thuTime: '4', friTime: '6' }, TODAY);
  assert.deepEqual([mixed.flexMode, mixed.flexStart, ...FLEX_DAYS.map((d) => mixed[d.key])], ['week', '', '07:00', '09:00', '09:00', '09:00', '11:00']);
  assert.equal(readyToSend(mixed), true);
  assert.equal(flexModeOf(formFromDoc('FW', { dayGbn: 'DA', wcDate: '20260923', wcTime: '4', reqRsn: '출근시간 변경' }, TODAY)), 'day');
});
t('다루지 않는 종류·모양은 null', () => {
  assert.equal(formFromDoc('LV', { workCodeKind: 'LS', wrkGubun: '01', startDate: '2026-10-07' }, TODAY), null);
  assert.equal(formFromDoc('TR', { biztripKind: 'TR', wrkGubun: '04', biztripDateFrom: '2026-10-07' }, TODAY), null, '출장 신청서로 올린 교육');
  assert.equal(formFromDoc('FW', { dayGbn: 'XX' }, TODAY), null);
  // 첫날 오후에 시작하거나 마지막 날 오전에 끝나는 여러 날 연차 — 패널에서 열면 전일로 바뀌므로 열지 않는다
  assert.equal(formFromDoc('LV', { workCodeKind: 'LY', wrkGubun: '03', nextWrkGubun: '01', startDate: '2026-10-07', endDate: '2026-10-08' }, TODAY), null);
  assert.equal(formFromDoc('LV', { workCodeKind: 'LY', wrkGubun: '01', nextWrkGubun: '02', startDate: '2026-10-07', endDate: '2026-10-08' }, TODAY), null);
});

console.log('Claude 가 준 조각 — 믿을 수 있는 값만');
t('모양이 틀린 값은 버린다', () =>
  assert.deepEqual(normalizePatch({ kind: 'vacation', dateFrom: '10/7', start: '25:00', end: '9:5', place: '  ', purpose: null, flexStart: '09:15', allDay: 'yes', reply: '...' }), {}));
t('맞는 값은 다듬어 남긴다', () =>
  assert.deepEqual(normalizePatch({ kind: 'out', dateFrom: '2026-10-07', start: '9:00', end: '16:30', place: ' 부산시청 ', purpose: '과제 협의', allDay: false }),
    { kind: 'out', dateFrom: '2026-10-07', start: '09:00', end: '16:30', place: '부산시청', purpose: '과제 협의', allDay: false }));
t('null 은 "말하지 않음"이다 — 이미 적힌 값을 지우지 않는다', () => {
  const { form, changed } = applyPatch(out, { kind: null, dateFrom: null, start: null, end: '17:00', place: null, purpose: null }, TODAY);
  assert.deepEqual(changed, ['span'], '종료 시각으로 말한 것은 몇 시간 칸이 바뀐 것이다');
  assert.deepEqual([form.start, form.end, form.span, form.purpose], ['14:00', '17:00', 180, '과제 협의']);
});
t('종료 시각으로 말하면 몇 시간으로 바꾸고, 시작만 옮기면 고른 시간만큼 종료가 따라간다', () => {
  const a = applyPatch(blankForm('out', TODAY), { start: '14:00', end: '16:30' }, TODAY);
  assert.deepEqual([a.form.span, a.form.end, a.changed], [150, '16:30', ['start', 'span']]);
  const b = applyPatch(a.form, { start: '09:00' }, TODAY);
  assert.deepEqual([b.form.span, b.form.end, b.changed], [150, '11:30', ['start']]);
  const back = applyPatch(a.form, { end: '13:00' }, TODAY);
  assert.deepEqual([back.form.span, back.form.end], ['', ''], '시작보다 이른 종료는 받지 않고 몇 시간을 다시 묻는다');
  assert.deepEqual(missingFields(back.form), ['span', 'purpose']);
});
t('종류를 옮기면 가져간 시작·종료가 몇 시간이 된다 (출장 09~18시 → 외근 9시간)', () => {
  const trip = { ...blankForm('trip', TODAY), start: '09:00', end: '18:00' };
  const { form } = applyPatch(trip, { kind: 'out' }, TODAY);
  assert.deepEqual([form.start, form.end, form.span], ['09:00', '18:00', 540]);
  const lo = applyPatch(out, { kind: 'leaveout' }, TODAY).form;
  assert.deepEqual([lo.start, lo.end, lo.span], ['14:00', '16:30', 150]);
  assert.equal(applyPatch(out, { kind: 'trip' }, TODAY).form.span, '', '몇 시간을 묻지 않는 종류로는 가져가지 않는다');
});
t('HR 문서를 되돌릴 때도 시작~종료가 몇 시간이 된다', () => {
  const doc = { biztripKind: 'OD', wrkGubun: '04', biztripDateFrom: '2026-08-03', strHour: '13', strMin: '00', endHour: '18', endMin: '00', biztripContent: '협의' };
  assert.equal(formFromDoc('TRO', doc, TODAY).span, 300);
  assert.equal(formFromDoc('ET', { workCodeKind: 'ZLO', startDate: '2026-09-01', strHour: '16', strMin: '00', endHour: '17', endMin: '30', reqRsn: '병원' }, TODAY).span, 90);
  const h = formFromDoc('LV', { workCodeKind: 'HCL', wrkGubun: '04', startDate: '2026-09-08', strHour: '09', strMin: '00', endHour: '12', endMin: '00', reqRsn: '건강검진', atchFileId: 'a' }, TODAY);
  assert.deepEqual([h.allDay, h.span, readyToSend(h)], [false, 180, true]);
  assert.equal(formFromDoc('TR', { ...doc, biztripKind: 'DBT' }, TODAY).span, '', '출장은 출발·도착 시각 그대로다');
});
t('종류가 바뀌면 그 종류의 기본값을 깔고, 적어 둔 날짜·목적은 가져간다', () => {
  const { form, changed } = applyPatch({ ...blankForm('leaveout', TODAY), dateFrom: '2026-10-07', dateTo: '2026-10-07', purpose: '협의' }, { kind: 'trip', place: '대전' }, TODAY);
  assert.deepEqual(changed, ['kind', 'place']);
  assert.deepEqual([form.kind, form.dateFrom, form.dateTo, form.start, form.end, form.expense, form.purpose, form.place],
    ['trip', '2026-10-07', '2026-10-07', '07:00', '20:00', 'Y', '협의', '대전']);
});
t('출장은 사전정산과 상관없이 말로 한 출장지·장소가 그 칸에 들어간다. 근무지는 종류를 옮겨도 따라다닌다', () => {
  const a = applyPatch({ ...blankForm('trip', TODAY), settle: true, workplace: '부산 본사' }, { place: '대전', venue: '한국기계연구원', purpose: '착수회의 참석' }, TODAY);
  assert.deepEqual([a.form.place, a.form.venue, a.form.purpose, a.form.workplace, a.changed], ['대전', '한국기계연구원', '착수회의 참석', '부산 본사', ['place', 'venue', 'purpose']]);
  const off = applyPatch({ ...blankForm('trip', TODAY), purpose: '회의' }, { place: '대전', venue: 'KAIST' }, TODAY);
  assert.deepEqual([off.form.place, off.form.venue, off.form.purpose, off.changed], ['대전', 'KAIST', '회의', ['place', 'venue']], '사전정산을 꺼 두어도 그 칸에 들어간다');
  const out2 = applyPatch(a.form, { kind: 'out' }, TODAY).form;
  assert.deepEqual([out2.kind, out2.place, out2.venue, out2.workplace], ['out', '', '', '부산 본사'], '출장지·장소는 두고 가고 근무지는 가져간다');
  assert.equal(applyPatch(out2, { kind: 'trip' }, TODAY).form.workplace, '부산 본사');
});
t('장소 칸이 없으면(외근) 말로 한 장소는 목적 뒤에 붙여 보이게 하고, 장소를 안 쓰는 종류에서는 버린다', () => {
  const v = applyPatch(blankForm('out', TODAY), { place: '부산', venue: '부산시청', purpose: '과제 협의' }, TODAY);
  assert.deepEqual([v.form.purpose, v.form.place, v.form.venue, v.changed], ['과제 협의 - 부산 부산시청', '', '', ['purpose']]);
  const a = applyPatch(blankForm('out', TODAY), { place: '부산시청', purpose: '과제 협의' }, TODAY);
  assert.deepEqual([a.form.purpose, a.form.place, a.changed], ['과제 협의 - 부산시청', '', ['purpose']]);
  assert.equal(applyPatch(blankForm('out', TODAY), { place: '부산시청' }, TODAY).form.purpose, '부산시청', '목적을 말하지 않았으면 장소가 목적 자리에 들어간다');
  assert.equal(applyPatch(blankForm('out', TODAY), { place: '부산시청', purpose: '부산시청 방문' }, TODAY).form.purpose, '부산시청 방문', '이미 들어 있으면 붙이지 않는다');
  const b = applyPatch(blankForm('leave', TODAY), { place: '제주', venue: '호텔' }, TODAY);
  assert.deepEqual([b.form.purpose, b.form.place, b.form.venue, b.changed], ['', '', '', []]);
});
t('소통으로 바꾸면 13~14시가 이긴다. 같이 말한 시각은 그 위에 얹힌다', () => {
  const typed = { ...blankForm('out', TODAY), start: '15:00', end: '16:00', purpose: '협의' };
  const { form, changed } = applyPatch(typed, { sub: 'MEET' }, TODAY);
  assert.deepEqual([form.sub, form.start, form.end, form.span, form.purpose], ['MEET', '13:00', '14:00', 60, '부서소통회']);
  assert.deepEqual(changed, ['sub']);
  const said = applyPatch(blankForm('trip', TODAY), { kind: 'out', sub: 'MEET', start: '12:00', end: '14:00' }, TODAY).form;
  assert.deepEqual([said.kind, said.sub, said.start, said.end, said.span, said.purpose], ['out', 'MEET', '12:00', '14:00', 120, '부서소통회']);
});
t('소통에서 다른 종류로 옮기면 깔아 준 시각·목적은 두고 간다', () => {
  const meet = withSub(blankForm('out', TODAY), 'MEET');
  const lo = applyPatch(meet, { kind: 'leaveout' }, TODAY).form;
  assert.deepEqual([lo.start, lo.end, lo.span, lo.purpose], ['09:00', '', '', '']);
  assert.equal(applyPatch(meet, { kind: 'trip' }, TODAY).form.purpose, '');
});
t('출장에 날짜 하나만 말하면 당일 출장이다', () => {
  const { form } = applyPatch(blankForm('trip', TODAY), { dateFrom: '2026-10-20' }, TODAY);
  assert.deepEqual([form.days, form.dateTo], [1, '2026-10-20']);
});
t('종료일로 말하면 며칠간으로 바꾸고, 며칠간으로 말하면 종료일을 맞춘다', () => {
  const a = applyPatch(blankForm('trip', TODAY), { dateFrom: '2026-10-20', dateTo: '2026-10-21' }, TODAY);
  assert.deepEqual([a.form.days, a.form.dateTo], [2, '2026-10-21']);
  assert.deepEqual(a.changed, ['dateFrom', 'days']);
  const b = applyPatch(blankForm('trip', TODAY), { dateFrom: '2026-10-20', days: 3 }, TODAY);
  assert.deepEqual([b.form.days, b.form.dateTo], [3, '2026-10-22']);
  // 사흘짜리로 적어 둔 뒤 출발일만 옮기면 사흘이 그대로 따라간다
  assert.equal(applyPatch(b.form, { dateFrom: '2026-10-27' }, TODAY).form.dateTo, '2026-10-29');
});
t('건강검진에 시각을 말하면 하루 전체가 풀린다', () =>
  assert.equal(applyPatch(blankForm('health', TODAY), { start: '09:00', end: '12:00' }, TODAY).form.allDay, false));
t('갈래·구분도 조각으로 받는다. 그 종류에 없는 갈래는 버린다', () => {
  assert.deepEqual(normalizePatch({ kind: 'leave', sub: 'LH', half: 'am' }), { kind: 'leave', sub: 'LH', half: 'am' });
  assert.deepEqual(normalizePatch({ sub: 'XX', half: 'night' }), {});
  assert.deepEqual(normalizePatch({ half: 'full' }), { half: '' }, '전일은 빈 값이다');
  const edu = applyPatch(blankForm('trip', TODAY), { kind: 'out', sub: 'TR' }, TODAY);
  assert.deepEqual([edu.form.kind, edu.form.sub], ['out', 'TR']);
  assert.equal(applyPatch(blankForm('trip', TODAY), { sub: 'LY' }, TODAY).form.sub, '', '출장에는 갈래가 없다');
});
t('휴가로 옮기면 연차·하루·전일이 기본이다', () => {
  const { form } = applyPatch({ ...blankForm('out', TODAY), sub: 'TR', start: '14:00', end: '16:00' }, { kind: 'leave' }, TODAY);
  assert.deepEqual([form.kind, form.sub, form.days, form.half, form.start, form.end], ['leave', 'LY', 1, '', '', '']);
});
t('휴가에 시각으로 말하면 오전·오후로 읽고 시각은 남기지 않는다', () => {
  const pm = applyPatch(blankForm('leave', TODAY), { start: '14:00', end: '18:00' }, TODAY);
  assert.deepEqual([pm.form.half, pm.form.start, pm.form.end], ['pm', '', '']);
  assert.deepEqual(pm.changed, ['half']);
  assert.equal(applyPatch(blankForm('leave', TODAY), { start: '09:00', end: '13:00' }, TODAY).form.half, 'am');
  assert.equal(applyPatch({ ...blankForm('leave', TODAY), half: 'am' }, { start: '09:00', end: '18:00' }, TODAY).form.half, '', '하루 종일이면 전일로 돌아간다');
  assert.equal(applyPatch(blankForm('leave', TODAY), { start: '14:00', half: 'am' }, TODAY).form.half, 'am', '구분을 직접 말했으면 그것이 이긴다');
});
t('휴가도 종료일로 말하면 며칠간으로 바꾼다', () => {
  const { form } = applyPatch(blankForm('leave', TODAY), { dateFrom: '2026-10-20', dateTo: '2026-10-22' }, TODAY);
  assert.deepEqual([form.days, form.dateTo], [3, '2026-10-22']);
});

console.log('Claude 없이 읽기 — 종류·날짜·시각만');
const local = (s, form) => parseAttendLocal(s, TODAY, form).patch;
t('내일 2시부터 4시까지 외근', () =>
  assert.deepEqual(local('내일 2시부터 4시까지 부산시청 외근'), { kind: 'out', sub: 'OD', dateFrom: '2026-10-03', start: '14:00', end: '16:00' }));
t('장소·목적은 읽지 않는다 (짐작으로 채우지 않는다)', () => {
  const r = parseAttendLocal('내일 2시부터 4시까지 부산시청 외근, 과제 협의', TODAY);
  assert.equal(r.patch.place, undefined);
  assert.equal(r.patch.purpose, undefined);
  assert.match(r.reply, /목적은 직접/);
});
t('다음 주 수요일 / 이번 주 지난 요일은 다음 주로', () => {
  assert.equal(local('다음 주 수요일 부서소통회').dateFrom, '2026-10-07');
  assert.equal(local('수요일 외출').dateFrom, '2026-10-07');
  assert.equal(local('금요일 외출').dateFrom, '2026-10-02');
});
t('출장 기간: 1박 2일 · 3일간 · 당일', () => {
  assert.deepEqual(local('10월 20일 1박 2일 출장'), { kind: 'trip', dateFrom: '2026-10-20', days: 2 });
  assert.equal(local('내일부터 3일간 출장').days, 3);
  assert.equal(local('모레 당일 출장').days, 1);
  assert.equal(local('3일간 외근').days, undefined, '출장이 아니면 며칠간을 읽지 않는다');
});
t('10월 20일 출장 / 10/21', () => {
  assert.deepEqual(local('10월 20일 출장'), { kind: 'trip', dateFrom: '2026-10-20' });
  assert.equal(local('10/21 외근').dateFrom, '2026-10-21');
});
t('오후 3시 반부터 4시 30분까지 / 15:30~16:30', () => {
  assert.deepEqual(local('오후 3시 반부터 4시 30분까지 외출'), { kind: 'leaveout', start: '15:30', end: '16:30' });
  assert.deepEqual(local('15:30~16:30 외출'), { kind: 'leaveout', start: '15:30', end: '16:30' });
});
t('3시부터 2시간', () => assert.deepEqual(local('3시부터 2시간 외근'), { kind: 'out', sub: 'OD', start: '15:00', end: '17:00' }));
t('유연근무은 시각을 출근시간으로 읽는다', () =>
  assert.deepEqual(local('모레 10시 출근으로 유연근무'), { kind: 'flex', dateFrom: '2026-10-04', flexStart: '10:00' }));
t('유연근무의 기간은 말에서 읽는다 — 전체·매일은 전체, 주간·요일별은 주간. 요일마다의 시간은 짝짓지 않는다', () => {
  assert.deepEqual(local('유연근무 전체 9시 출근'), { kind: 'flex', flexStart: '09:00', flexMode: 'all' });
  assert.deepEqual(local('매일 10시 출근으로 유연근무'), { kind: 'flex', flexStart: '10:00', flexMode: 'all' });
  assert.deepEqual(local('주간 유연근무'), { kind: 'flex', flexMode: 'week' });
});
t('요일별 출근시간 조각: 그 요일에 없는 값은 버리고, 요일로 말했으면 주간이 된다', () => {
  assert.deepEqual(normalizePatch({ flexMode: 'weekly', flexMon: '07:00', flexTue: '07:00', flexWed: '09:15', flexFri: '11:00' }), { flexMon: '07:00', flexFri: '11:00' });
  const { form, changed } = applyPatch(blankForm('flex', TODAY), { flexMon: '07:00', flexFri: '11:00' }, TODAY);
  assert.deepEqual([form.flexMode, form.flexMon, form.flexFri], ['week', '07:00', '11:00']);
  assert.deepEqual(changed, ['flexMon', 'flexFri', 'flexMode']);
  assert.equal(applyPatch(blankForm('flex', TODAY), { flexMode: 'all', flexStart: '11:00' }, TODAY).form.flexStart, '', '전체에 없는 시간은 남기지 않는다');
});
t('휴가: 연차·반차·체력단련, 며칠간', () => {
  assert.deepEqual(local('내일 연차'), { kind: 'leave', sub: 'LY', dateFrom: '2026-10-03' });
  assert.deepEqual(local('다음 주 수요일 오후 반차'), { kind: 'leave', sub: 'LY', dateFrom: '2026-10-07', half: 'pm' });
  assert.deepEqual(local('10월 20일부터 3일간 휴가'), { kind: 'leave', dateFrom: '2026-10-20', days: 3 });
  assert.deepEqual(local('모레 체력단련'), { kind: 'leave', sub: 'LH', dateFrom: '2026-10-04' });
  assert.deepEqual(local('내일 2시부터 연차'), { kind: 'leave', sub: 'LY', dateFrom: '2026-10-03', start: '14:00' });
  assert.match(parseAttendLocal('내일 연차', TODAY).reply, /기간만 읽었습니다/);
});
t('교육은 외근 신청서의 갈래다', () =>
  assert.deepEqual(local('내일 1시부터 5시까지 교육'), { kind: 'out', sub: 'TR', dateFrom: '2026-10-03', start: '13:00', end: '17:00' }));
t('부서소통회도 외근의 갈래다 — 시각을 말하지 않으면 폼이 13~14시를 깐다', () => {
  assert.deepEqual(local('내일 부서소통회'), { kind: 'out', sub: 'MEET', dateFrom: '2026-10-03' });
  assert.deepEqual(local('소통회로 바꿔줘', blankForm('out', TODAY)), { kind: 'out', sub: 'MEET' });
});
t('읽은 것이 없으면 없다고 말한다', () => {
  const r = parseAttendLocal('잘 부탁합니다', TODAY);
  assert.deepEqual(r.patch, {});
  assert.match(r.reply, /읽어 낸 것이 없습니다/);
});
console.log('상대 날짜는 규칙으로 — Claude 의 요일 셈을 믿지 않는다');
t('나온 차례대로 실제 날짜로', () => {
  assert.deepEqual(relativeDates('다음 주 수요일 오후 2시 외근', TODAY), ['2026-10-07']);
  assert.deepEqual(relativeDates('내일부터 모레까지 출장', TODAY), ['2026-10-03', '2026-10-04']);
  assert.deepEqual(relativeDates('10월 20일 출장', TODAY), [], '달·일로 말한 날짜는 건드리지 않는다');
});
t('Claude 가 하루 틀리게 답한 날짜를 바로잡는다 (금요일의 "다음 주 수요일" → 10/7)', () => {
  const r = fixRelativeDates({ kind: 'out', dateFrom: '2026-10-08', start: '14:00' }, '다음 주 수요일 오후 2시 외근', TODAY);
  assert.equal(r.fixed, true);
  assert.deepEqual(r.patch, { kind: 'out', dateFrom: '2026-10-07', start: '14:00' });
});
t('맞게 답했으면 그대로 두고, 날짜를 안 채웠으면 채워 준다', () => {
  assert.equal(fixRelativeDates({ dateFrom: '2026-10-03' }, '내일 외출', TODAY).fixed, false);
  assert.equal(fixRelativeDates({ dateFrom: null }, '내일 외출', TODAY).patch.dateFrom, '2026-10-03');
  assert.deepEqual(fixRelativeDates({ dateFrom: '2026-10-20' }, '10월 20일 출장', TODAY), { patch: { dateFrom: '2026-10-20' }, fixed: false });
});
t('상태 코드', () => assert.deepEqual([STATUS.TEMP, STATUS.REQUESTED, STATUS.APPROVED], ['1', '3', '5']));

console.log(`\n통과 ${pass}건`);
