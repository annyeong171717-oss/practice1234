import * as store from './store.js';
import { dayKey } from './util.js';

export const METRICS = [
  ['grammar', '문법'],
  ['vocabulary', '어휘'],
  ['meaning', '의미 전달'],
  ['naturalness', '문장 흐름'],
];

/** The attempt whose text became the line's final version (or the latest one). */
export function finalAttempt(u) {
  if (!u.attempts?.length) return null;
  const final = (u.final || '').trim();
  return [...u.attempts].reverse().find((a) => a.text.trim() === final) || u.attempts[u.attempts.length - 1];
}

export function computeStats(works = store.list('works')) {
  const lines = works.flatMap((w) => w.lines.filter((l) => l.final));
  const scored = lines.filter((l) => l.finalScore != null);
  const days = new Set(lines.map((l) => dayKey(l.finalAt)));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return {
    works: works.length,
    lines: lines.length,
    songs: works.filter((w) => w.status === 'completed').length,
    avg: scored.length ? Math.round(scored.reduce((s, l) => s + l.finalScore, 0) / scored.length) : null,
    streak,
  };
}

/** Per-metric averages, score growth and notable corrections across practiced lines. */
export function analyze(works) {
  const units = works.flatMap((w) => w.lines.map((u) => ({ u, w }))).filter(({ u }) => u.attempts?.length);
  const sums = Object.fromEntries(METRICS.map(([k]) => [k, 0]));
  const comments = {};
  let gains = 0;
  let gainCount = 0;
  let best = null;
  const corrections = [];

  for (const { u, w } of units) {
    const a = finalAttempt(u);
    for (const [k] of METRICS) {
      sums[k] += a.feedback.scores[k] || 0;
      if (a.feedback.categories?.[k]) comments[k] = a.feedback.categories[k];
    }
    if (u.attempts.length > 1) {
      const delta = a.feedback.overall - u.attempts[0].feedback.overall;
      gains += delta;
      gainCount++;
      if (!best || delta > best.delta) best = { delta, u, w, first: u.attempts[0], last: a };
    }
    for (const c of u.attempts[0].feedback.corrections || []) corrections.push({ ...c, song: w.song.title });
  }

  const n = units.length;
  return {
    count: n,
    metrics: METRICS.map(([k, label]) => ({ key: k, label, avg: n ? Math.round(sums[k] / n) : null, comment: comments[k] || '' })),
    overall: n ? Math.round(units.reduce((s, { u }) => s + finalAttempt(u).feedback.overall, 0) / n) : null,
    avgGain: gainCount ? Math.round(gains / gainCount) : null,
    best,
    corrections: corrections.slice(-6).reverse(),
  };
}
