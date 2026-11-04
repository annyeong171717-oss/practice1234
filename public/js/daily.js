import * as store from './store.js';
import { $, go, h, icon, toast } from './util.js';

/** One day challenge: adapt at least this many lines per day. */
export const DAILY_GOAL = 3;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const pad = (n) => String(n).padStart(2, '0');
export const dayId = (d = new Date()) => `d${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* ── Records ────────────────────────────────────────────────── */

/** Lines finalized per day according to the works themselves (covers history from before attendance existed). */
function finalizedByDay() {
  const map = new Map();
  for (const w of store.list('works')) {
    for (const u of w.lines) {
      if (!u.final || !u.finalAt) continue;
      const id = dayId(new Date(u.finalAt));
      if (!map.has(id)) map.set(id, new Set());
      map.get(id).add(`${w.id}:${u.key}`);
    }
  }
  return map;
}

/** dayId → { checked, lines } merging attendance docs with study activity. */
export function dayRecords() {
  const out = new Map();
  const activity = finalizedByDay();
  for (const doc of store.list('days')) {
    const keys = new Set([...(doc.lines || []), ...(activity.get(doc.id) || [])]);
    out.set(doc.id, { checked: Boolean(doc.checkedAt) || keys.size > 0, lines: keys.size });
  }
  for (const [id, keys] of activity) if (!out.has(id)) out.set(id, { checked: true, lines: keys.size });
  return out;
}

export function todayStatus(records = dayRecords()) {
  const rec = records.get(dayId()) || { checked: false, lines: 0 };
  return { ...rec, goal: DAILY_GOAL, done: rec.lines >= DAILY_GOAL };
}

function todayDoc() {
  const id = dayId();
  return store.get('days', id) || { id, checkedAt: null, lines: [] };
}

/** Stamp today's attendance. Returns false if already checked in. */
export function checkIn() {
  const doc = todayDoc();
  if (doc.checkedAt) return false;
  doc.checkedAt = Date.now();
  store.put('days', doc);
  return true;
}

/** Count a finalized line toward today's challenge (also checks in). `before` is todayStatus() taken before finalizing. */
export function recordLine(workId, unitKey, before) {
  const doc = todayDoc();
  const key = `${workId}:${unitKey}`;
  doc.checkedAt ||= Date.now();
  if (!doc.lines.includes(key)) doc.lines.push(key);
  store.put('days', doc);
  const after = todayStatus();
  return { ...after, justCompleted: !before.done && after.done };
}

function streakOf(pred, records = dayRecords()) {
  const d = new Date();
  if (!pred(records.get(dayId(d)))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (pred(records.get(dayId(d)))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
export const attendanceStreak = (records) => streakOf((r) => r?.checked, records);
export const challengeStreak = (records) => streakOf((r) => r && r.lines >= DAILY_GOAL, records);

/* ── Home card ──────────────────────────────────────────────── */

function weekStrip(records) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return h('div', { class: 'grid grid-cols-7 gap-1 text-center' },
    ...Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const rec = records.get(dayId(d));
      const isToday = dayId(d) === dayId(today);
      const future = d > today && !isToday;
      const star = rec && rec.lines >= DAILY_GOAL;
      return h('div', { class: 'flex flex-col items-center gap-1.5' },
        h('span', { class: `text-[11px] font-semibold ${isToday ? 'text-lav-600' : 'text-ink-400'}`, text: WEEKDAYS[d.getDay()] }),
        h('span', {
          class: `relative grid h-9 w-9 place-items-center rounded-full text-xs font-bold transition ${
            rec?.checked ? 'bg-gradient-to-br from-lav-400 to-lav-600 text-white shadow-lift' : future ? 'bg-lav-50 text-ink-300' : 'bg-lav-50 text-ink-400'
          } ${isToday && !rec?.checked ? 'ring-2 ring-lav-400 ring-offset-2' : ''}`,
          'data-today': isToday ? 'true' : null,
        },
          rec?.checked ? icon('check', 'h-4 w-4', { stroke: 3 }) : String(d.getDate()),
          star ? h('span', { class: 'absolute -right-1 -top-1 text-[13px] leading-none', text: '⭐' }) : null,
        ),
      );
    }),
  );
}

export function renderDailyCard(target, { onChange } = {}) {
  const records = dayRecords();
  const t = todayStatus(records);
  const streak = attendanceStreak(records);
  const cStreak = challengeStreak(records);
  const n = Math.min(t.lines, DAILY_GOAL);

  const slots = Array.from({ length: DAILY_GOAL }, (_, i) =>
    i < n
      ? h('span', { class: 'grid h-11 flex-1 animate-pop place-items-center rounded-2xl bg-gradient-to-br from-lav-400 to-lav-600 text-white shadow-lift', style: { animationDelay: `${i * 80}ms` } }, icon('check', 'h-5 w-5', { stroke: 3 }))
      : h('span', { class: 'grid h-11 flex-1 place-items-center rounded-2xl border-2 border-dashed border-lav-200 text-sm font-bold text-lav-300', text: `${i + 1}줄` }),
  );

  const message = t.done
    ? `🎉 오늘의 챌린지 달성!${t.lines > DAILY_GOAL ? ` (${t.lines}줄)` : ''}${cStreak > 1 ? ` ${cStreak}일 연속이에요` : ''}`
    : t.lines
      ? `${DAILY_GOAL - t.lines}줄만 더 번안하면 오늘 챌린지 달성!`
      : `오늘 ${DAILY_GOAL}줄 번안에 도전해 볼까요?`;

  const action = !t.checked
    ? h('button', {
        type: 'button',
        class: 'btn-primary mt-4 w-full py-3.5',
        onclick: () => {
          checkIn();
          const s = attendanceStreak();
          toast(s > 1 ? `출석 완료! ${s}일 연속 출석 중이에요 🔥` : '출석 완료! 오늘도 반가워요 💜');
          onChange?.();
        },
      }, icon('check', 'h-5 w-5', { stroke: 2.6 }), '출석체크 하기')
    : !t.done
      ? h('button', { type: 'button', class: 'btn-soft mt-4 w-full py-3.5', onclick: () => go('#/study') }, '챌린지 이어서 하기 ›')
      : null;

  target.replaceChildren(
    h('div', { class: 'flex items-start justify-between gap-3' },
      h('div', {},
        h('p', { class: 'text-[11px] font-extrabold uppercase tracking-[.18em] text-lav-500', text: 'One day challenge' }),
        h('p', { class: 'mt-1 text-lg font-extrabold text-ink' }, `하루 ${DAILY_GOAL}줄 번안하기 `, h('span', { class: 'text-lav-500', text: `${Math.min(t.lines, 99)}/${DAILY_GOAL}` })),
      ),
      h('button', { type: 'button', class: 'flex shrink-0 items-center gap-1 rounded-full bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-500 transition hover:bg-orange-100', onclick: openCalendar, 'aria-label': '출석 달력 보기' },
        '🔥', `연속 ${streak}일`, icon('chevron', 'h-3.5 w-3.5')),
    ),
    h('div', { class: 'mt-4 flex gap-2' }, ...slots),
    h('p', { class: `mt-2.5 text-xs font-semibold ${t.done ? 'text-emerald-600' : 'text-ink-500'}`, text: message }),
    h('div', { class: 'my-4 h-px bg-lav-100' }),
    weekStrip(records),
    action,
  );
}

/* ── Calendar modal ─────────────────────────────────────────── */

let calMonth = null;

function renderCalendar() {
  const records = dayRecords();
  const { year, month } = calMonth;
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const todayKey = dayId();
  const now = new Date();

  let attended = 0;
  let challenged = 0;
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(h('span'));
  for (let d = 1; d <= days; d++) {
    const date = new Date(year, month, d);
    const id = dayId(date);
    const rec = records.get(id);
    const star = rec && rec.lines >= DAILY_GOAL;
    if (rec?.checked) attended++;
    if (star) challenged++;
    const future = date > now && id !== todayKey;
    cells.push(
      h('span', {
        class: `relative mx-auto grid h-10 w-10 place-items-center rounded-full text-sm font-semibold ${
          rec?.checked ? 'bg-gradient-to-br from-lav-400 to-lav-600 text-white shadow-lift' : future ? 'text-ink-300' : 'text-ink-500'
        } ${id === todayKey && !rec?.checked ? 'ring-2 ring-lav-400' : ''}`,
        title: rec ? `${rec.lines}줄 번안` : '',
      },
        String(d),
        star ? h('span', { class: 'absolute -right-0.5 -top-1 text-[12px] leading-none', text: '⭐' }) : null,
      ),
    );
  }

  $('#cal-title').textContent = `${year}년 ${month + 1}월`;
  $('#cal-next').disabled = year === now.getFullYear() && month === now.getMonth();
  $('#cal-grid').replaceChildren(
    ...WEEKDAYS.map((w, i) => h('span', { class: `pb-1 text-center text-[11px] font-bold ${i === 0 ? 'text-rose-400' : 'text-ink-400'}`, text: w })),
    ...cells,
  );
  $('#cal-stats').replaceChildren(
    ...[['연속 출석', `${attendanceStreak(records)}일`], ['이번 달 출석', `${attended}일`], ['챌린지 달성', `${challenged}일`]].map(([k, v]) =>
      h('div', {}, h('p', { class: 'text-[11px] font-semibold text-ink-500', text: k }), h('p', { class: 'mt-0.5 text-lg font-extrabold text-ink', text: v })),
    ),
  );
}

export function openCalendar() {
  const now = new Date();
  calMonth = { year: now.getFullYear(), month: now.getMonth() };
  renderCalendar();
  $('#attend-modal').hidden = false;
}

export function initDaily() {
  const shift = (delta) => {
    const d = new Date(calMonth.year, calMonth.month + delta, 1);
    calMonth = { year: d.getFullYear(), month: d.getMonth() };
    renderCalendar();
  };
  $('#cal-prev').addEventListener('click', () => shift(-1));
  $('#cal-next').addEventListener('click', () => shift(1));
  store.subscribe((e) => {
    if (e.type === 'change' && (e.col === 'days' || e.col === 'works') && !$('#attend-modal').hidden) renderCalendar();
  });
}
