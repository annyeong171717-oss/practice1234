import { getArtwork, getFeedback, resolveLyrics } from './api.js';
import { TIPS } from './catalog.js';
import { startTutorChat } from './chat.js';
import { DAILY_GOAL, recordLine, todayStatus } from './daily.js';
import { METRICS } from './stats.js';
import * as store from './store.js';
import {
  $,
  countSyllables,
  debounce,
  DIRECTION_LABEL,
  go,
  h,
  highlightDiff,
  icon,
  isTranslationLine,
  mascot,
  needsAdaptation,
  normalizeLine,
  scoreColor,
  speak,
  toast,
  uid,
} from './util.js';

let work = null;
let idx = 0;
let busy = false;
/** write → feedback → revise → compare */
let stage = 'write';

const el = {};
const saveWork = debounce(() => work && store.put('works', work), 600);

const targetLang = () => (work?.direction === 'en-ko' ? 'ko-KR' : 'en-US');
const sourceLang = () => (work?.direction === 'en-ko' ? 'en-US' : 'ko-KR');
const unit = () => work?.lines[idx];
const lastAttempt = (u) => u?.attempts?.[u.attempts.length - 1] || null;
const defaultStage = (u) => (u.attempts.length >= 2 ? 'compare' : u.attempts.length === 1 ? 'feedback' : 'write');

/* ── Opening songs ───────────────────────────────────────────── */

function cleanLyrics(text) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildUnits(lyrics, direction) {
  const units = [];
  const seen = new Set();
  lyrics.split('\n').forEach((line, pos) => {
    if (!needsAdaptation(line, direction)) return;
    const key = normalizeLine(line);
    if (seen.has(key)) return;
    seen.add(key);
    units.push({ key, pos, original: line, draft: '', revision: '', attempts: [], final: '', finalScore: null, finalAt: null });
  });
  return units;
}

async function startWork({ song, lyrics, direction }) {
  const clean = cleanLyrics(lyrics);
  let lines = buildUnits(clean, direction);
  if (!lines.length) {
    const other = direction === 'ko-en' ? 'en-ko' : 'ko-en';
    const alt = buildUnits(clean, other);
    if (alt.length && confirm(`이 곡에는 ${direction === 'ko-en' ? '한국어' : '영어'} 가사가 거의 없어요.\n'${DIRECTION_LABEL[other]}' 방향으로 학습해 볼까요?`)) {
      direction = other;
      lines = alt;
    } else {
      toast('학습할 수 있는 가사 줄을 찾지 못했어요.');
      return;
    }
  }

  const existing = store
    .list('works')
    .find((w) => w.direction === direction && w.song.title === song.title && w.song.artist === song.artist);
  if (existing) {
    toast('이전에 하던 학습을 이어서 열었어요 ✨');
    return openWork(existing.id);
  }

  work = { id: uid('w'), song, direction, lyrics: clean, lines, current: 0, status: 'in-progress' };
  store.put('works', work);
  store.saveSettings({ lastWorkId: work.id });
  idx = 0;
  stage = 'write';
  go('#/study');
  if (!song.art) {
    getArtwork(`${song.artist} ${song.title}`).then((url) => {
      if (url && work?.song === song) {
        song.art = url;
        saveWork();
        renderHeader();
      }
    });
  }
}

/**
 * Open any released track: `meta` comes from the music catalog (title, artist, album, duration, art…).
 * `meta.search` can override the title/artist used to look up lyrics.
 */
export async function openSong(meta, direction) {
  const { song } = await resolveLyrics({
    track: meta.search?.track || meta.title,
    artist: meta.search?.artist || meta.artist,
    album: meta.album,
    duration: meta.duration,
    direction,
  });
  await startWork({
    direction,
    lyrics: song.lyrics,
    song: {
      lyricsId: song.id,
      title: meta.title,
      artist: meta.artist,
      album: meta.album || song.album || null,
      year: meta.year || null,
      art: meta.art || null,
      source: song.source,
    },
  });
}

export function openFromPaste({ title, artist, lyrics, direction }) {
  return startWork({ direction, lyrics, song: { title, artist, source: null } });
}

export function openWork(id) {
  const w = store.get('works', id);
  if (!w) return toast('작업을 찾을 수 없어요.');
  work = w;
  idx = Math.min(w.current || 0, w.lines.length - 1);
  stage = defaultStage(w.lines[idx]);
  store.saveSettings({ lastWorkId: w.id });
  go('#/study');
}

/* ── Shared pieces ──────────────────────────────────────────── */

function contextLines(u) {
  const all = work.lyrics.split('\n');
  let prev = '';
  let next = '';
  const usable = (l) => l.trim() && !isTranslationLine(l);
  for (let i = u.pos - 1; i >= 0; i--) if (usable(all[i])) { prev = all[i]; break; }
  for (let i = u.pos + 1; i < all.length; i++) if (usable(all[i])) { next = all[i]; break; }
  return { prev, next };
}

function meter(target, original, text) {
  const o = countSyllables(original);
  const d = countSyllables(text);
  const abs = Math.abs(d - o);
  const tone = !d ? 'text-ink-400' : abs <= 2 ? 'text-emerald-500' : abs <= 5 ? 'text-amber-500' : 'text-rose-500';
  const verdict = !d ? '' : abs <= 2 ? '부르기 좋아요 👍' : d > o ? '원곡보다 길어요' : '원곡보다 짧아요';
  target.replaceChildren(
    h('span', { text: `원문 ${o}음절` }),
    d ? h('span', { class: `ml-1.5 font-semibold ${tone}`, text: `· 내 문장 ${d}음절 ${verdict}` }) : h('span', { class: 'ml-1.5', text: '· 음절 수를 맞춰 보세요' }),
  );
}

function scoreRing(score, size = 'h-16 w-16', text = 'text-xl') {
  return h('div', { class: `score-ring grid ${size} shrink-0 place-items-center rounded-full`, style: { '--value': score, '--ring-color': scoreColor(score) } },
    h('div', { class: 'grid h-[80%] w-[80%] place-items-center rounded-full bg-white' },
      h('span', { class: `${text} font-extrabold`, style: { color: scoreColor(score) }, text: String(score) }),
    ),
  );
}

const sectionTitle = (text, withIcon = false) =>
  h('p', { class: 'mb-2 mt-6 flex items-center gap-1.5 text-[15px] font-extrabold text-lav-700' }, withIcon ? icon('sparkle', 'h-4 w-4 text-lav-500') : null, text);

function cheer(score) {
  if (score >= 90) return '완벽해요! 🎉';
  if (score >= 80) return '아주 좋아요!';
  if (score >= 65) return '좋아요!';
  if (score >= 45) return '조금만 더 다듬어 봐요!';
  return '같이 차근차근 고쳐 봐요!';
}

function loadingBlock(message) {
  return h('div', { class: 'flex flex-col items-center py-16 text-center' },
    mascot('h-20 w-20 animate-float'),
    h('p', { class: 'mt-4 font-bold text-ink', text: message }),
    h('p', { class: 'mt-2 flex gap-1.5' }, h('span', { class: 'typing-dot' }), h('span', { class: 'typing-dot', style: { animationDelay: '.2s' } }), h('span', { class: 'typing-dot', style: { animationDelay: '.4s' } })),
  );
}

/* ── Header, stepper, lyric card ────────────────────────────── */

const HEADINGS = { write: '학습하기', feedback: 'AI 피드백', revise: '수정하기', compare: '비교 학습하기' };
const STEP_OF = { write: 1, feedback: 2, revise: 3, compare: 4 };
const STEP_LABELS = ['작성', '피드백', '수정', '비교'];

function renderStepper() {
  const current = STEP_OF[stage];
  const nodes = [];
  STEP_LABELS.forEach((label, i) => {
    const n = i + 1;
    if (i) nodes.push(h('li', { class: `step-line ${n <= current ? 'done' : ''}`, 'aria-hidden': 'true' }));
    nodes.push(h('li', { class: `step ${n === current ? 'current' : n < current ? 'done' : ''}`, title: label, 'aria-current': n === current ? 'step' : null }, String(n)));
  });
  el.stepper.replaceChildren(...nodes);
}

function renderHeader() {
  const { song, lines } = work;
  el.title.textContent = song.title;
  el.artist.textContent = [song.artist, DIRECTION_LABEL[work.direction]].filter(Boolean).join(' · ');
  el.art.replaceChildren(
    song.art
      ? h('img', { src: song.art, alt: '', class: 'h-full w-full object-cover' })
      : h('span', { class: 'grid h-full w-full place-items-center text-xl font-black text-white/90', text: song.title.slice(0, 1) }),
  );
  const done = lines.filter((l) => l.final).length;
  el.count.textContent = `${done}/${lines.length}`;
  el.source.textContent = song.source ? `가사 제공 ${song.source.name} · © 원저작자` : '직접 입력한 가사';
  el.draftLabel.textContent = work.direction === 'ko-en' ? '영어로 가사를 작성해보세요.' : '한국어로 가사를 작성해보세요.';
  el.draft.placeholder = work.direction === 'ko-en' ? '여기에 영어 가사를 입력하세요.' : '여기에 한국어 가사를 입력하세요.';
}

function renderWave(text) {
  let seed = [...text].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 9973, 7);
  const bars = Array.from({ length: 34 }, (_, i) => {
    seed = (seed * 73 + 41) % 997;
    const height = 20 + (seed % 80);
    return h('span', { class: 'wave-bar', style: { height: `${height}%`, animationDelay: `${(i % 7) * 0.09}s` } });
  });
  el.wave.replaceChildren(...bars);
}

function renderLyricCard() {
  const u = unit();
  const { prev, next } = contextLines(u);
  el.lineLabel.textContent = `Line ${idx + 1} / ${work.lines.length}`;
  el.linePrev.textContent = prev || ' ';
  el.lineCurrent.textContent = u.original;
  el.lineNext.textContent = next || ' ';
  el.prevBtn.disabled = idx === 0;
  el.nextBtn.disabled = idx >= work.lines.length - 1;
  renderWave(u.original);
}

/* ── Stage: write ───────────────────────────────────────────── */

function renderWrite() {
  const u = unit();
  el.draft.value = u.final && !u.draft ? u.final : u.draft;
  el.draftCount.textContent = `${el.draft.value.length}/200`;
  meter(el.syllables, u.original, el.draft.value);
  el.tip.textContent = `💡 ${TIPS[(idx + work.lines.length) % TIPS.length]}`;
  el.skipBtn.textContent = u.final ? '이 줄은 확정됐어요 · 다음 줄로' : 'AI 피드백 없이 확정하고 다음 줄로';
}

/* ── Stage: feedback ────────────────────────────────────────── */

function analysisBullets(fb) {
  if (fb.corrections.length) {
    return fb.corrections.map((c) =>
      h('li', { class: 'flex gap-2 text-[13px] leading-6 text-ink-700' },
        h('span', { class: 'mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lav-400' }),
        h('span', {},
          h('b', { class: 'font-semibold text-ink', text: `'${c.from}'` }), ' 대신 ',
          h('b', { class: 'font-semibold text-lav-600', text: `'${c.to}'` }), ` — ${c.reason}`,
        ),
      ),
    );
  }
  return METRICS.map(([k]) => [k, fb.scores[k]])
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([k]) =>
      h('li', { class: 'flex gap-2 text-[13px] leading-6 text-ink-700' },
        h('span', { class: 'mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lav-400' }),
        h('span', { text: fb.categories?.[k] || '' }),
      ),
    );
}

function renderFeedbackStage() {
  const u = unit();
  const attempt = lastAttempt(u);
  const fb = attempt.feedback;
  const best = fb.suggestions[0];
  const good = fb.overall >= 85;

  const nodes = [
    h('div', { class: 'mt-5 flex items-start gap-3' },
      h('div', { class: 'shrink-0 animate-float' }, mascot('h-[72px] w-[72px]')),
      h('div', { class: 'speech mt-1 flex-1' },
        h('p', { class: 'font-extrabold text-lav-700', text: cheer(fb.overall) }),
        h('p', { class: 'mt-0.5', text: fb.summary }),
      ),
    ),

    h('div', { class: 'card-flat mt-5 flex items-center gap-4 p-4' },
      scoreRing(fb.overall),
      h('div', { class: 'grid flex-1 grid-cols-2 gap-x-4 gap-y-2.5' },
        ...METRICS.map(([key, label]) => {
          const s = fb.scores[key];
          return h('div', {},
            h('div', { class: 'flex items-center justify-between text-[11px] font-semibold text-ink-500' }, h('span', { text: label }), h('span', { style: { color: scoreColor(s) }, text: String(s) })),
            h('div', { class: 'mt-1 h-1.5 overflow-hidden rounded-full bg-lav-100' },
              h('div', { class: 'h-full rounded-full transition-all duration-700', style: { width: `${s}%`, background: scoreColor(s) } }),
            ),
          );
        }),
      ),
    ),

    sectionTitle('사용자 작성 문장'),
    h('div', { class: 'card-flat flex items-start gap-3 p-4' },
      h('p', { class: 'flex-1 text-[15px] leading-7 text-ink', text: attempt.text }),
      h('span', { class: `mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full text-white ${good ? 'bg-emerald-400' : 'bg-rose-400'}` }, icon(good ? 'check' : 'x', 'h-3 w-3', { stroke: 3 })),
    ),
  ];

  if (best) {
    nodes.push(
      sectionTitle('AI 추천 문장', true),
      h('div', { class: 'rounded-2xl border border-lav-300 bg-lav-50 p-4' },
        h('div', { class: 'flex items-start gap-3' },
          h('p', { class: 'flex-1 text-[15px] leading-7 text-ink' }, ...highlightDiff(attempt.text, best.text)),
          h('span', { class: 'mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-lav-500 text-white' }, icon('check', 'h-3 w-3', { stroke: 3 })),
        ),
        h('div', { class: 'mt-3 flex items-center gap-2' },
          h('span', { class: 'chip bg-white', text: best.label }),
          h('button', { type: 'button', class: 'ml-auto grid h-8 w-8 place-items-center rounded-full bg-white text-lav-600 shadow-soft', 'aria-label': '추천 문장 듣기', onclick: () => speak(best.text, targetLang()) }, icon('speaker', 'h-4 w-4')),
        ),
      ),
    );
    if (fb.suggestions.length > 1) {
      nodes.push(
        h('div', { class: 'mt-2 space-y-1.5' },
          ...fb.suggestions.slice(1).map((s) =>
            h('p', { class: 'rounded-xl bg-white px-4 py-2.5 text-sm text-ink-700' }, h('span', { class: 'mr-2 text-[11px] font-bold text-lav-500', text: s.label }), s.text),
          ),
        ),
      );
    }
  }

  nodes.push(
    sectionTitle('분석 및 피드백'),
    h('ul', { class: 'space-y-1.5' }, ...analysisBullets(fb)),
    h('details', { class: 'mt-4 rounded-2xl bg-white p-4 text-sm' },
      h('summary', { class: 'cursor-pointer font-bold text-ink-700', text: '더 자세한 분석 보기' }),
      h('div', { class: 'mt-3 space-y-3' },
        ...METRICS.map(([k, label]) => h('p', { class: 'leading-6 text-ink-500' }, h('b', { class: 'text-ink-700', text: `${label} ` }), fb.categories?.[k] || '')),
        h('div', {},
          h('p', { class: 'text-xs font-bold text-ink-500', text: '🎤 라임 맞추기 좋은 단어' }),
          h('div', { class: 'mt-1.5 flex flex-wrap gap-1.5' }, ...(fb.rhymes.length ? fb.rhymes : ['—']).map((r) => h('span', { class: 'chip', text: r }))),
        ),
        h('p', { class: 'leading-6 text-ink-500' }, h('b', { class: 'text-ink-700', text: `🎼 음절 (원문 ${fb.syllables.original} · 내 문장 ${fb.syllables.draft}) ` }), fb.syllables.comment),
        h('p', { class: 'rounded-xl bg-lav-50 p-3 leading-6 text-lav-800' }, h('b', { text: '🎯 다음 수정 미션 ' }), fb.nextStep),
      ),
    ),
    h('button', { type: 'button', class: 'btn-primary mt-6 w-full py-4', onclick: () => setStage('revise') }, '수정하기'),
    u.attempts.length > 1 ? h('button', { type: 'button', class: 'btn-link mt-4 w-full', onclick: () => setStage('compare') }, '수정 전후 비교 보기') : null,
    h('button', { type: 'button', class: 'btn-link mt-4 w-full text-ink-500', onclick: () => commit(attempt.text) }, '이 문장으로 확정하고 다음으로 넘기기'),
  );

  el.feedback.replaceChildren(...nodes.filter(Boolean));
}

/* ── Stage: revise ──────────────────────────────────────────── */

function renderRevise() {
  const u = unit();
  const last = lastAttempt(u);
  const best = last?.feedback.suggestions[0];
  el.reviseRef.replaceChildren(
    best
      ? h('div', { class: 'rounded-2xl border border-lav-200 bg-lav-50 p-4' },
          h('p', { class: 'flex items-center gap-1.5 text-xs font-bold text-lav-600' }, icon('sparkle', 'h-3.5 w-3.5'), '참고 · AI 추천 문장'),
          h('p', { class: 'mt-1.5 text-[15px] leading-7 text-ink', text: best.text }),
          h('p', { class: 'mt-2 text-xs leading-5 text-ink-500', text: `🎯 ${last.feedback.nextStep}` }),
        )
      : '',
  );
  el.revise.value = u.revision || last?.text || u.draft;
  el.reviseCount.textContent = `${el.revise.value.length}/200`;
  meter(el.reviseMeter, u.original, el.revise.value);
}

/* ── Stage: compare ─────────────────────────────────────────── */

function renderCompareStage() {
  const u = unit();
  const first = u.attempts[0];
  const last = lastAttempt(u);
  const delta = last.feedback.overall - first.feedback.overall;

  const side = (title, attempt, after) =>
    h('div', { class: `flex flex-col rounded-2xl border p-4 ${after ? 'border-lav-300 bg-white shadow-soft' : 'border-lav-100 bg-white'}` },
      h('div', { class: 'flex items-center justify-between' },
        h('span', { class: after ? 'chip' : 'chip-muted', text: title }),
        h('span', { class: 'text-sm font-extrabold', style: { color: scoreColor(attempt.feedback.overall) }, text: `${attempt.feedback.overall}점` }),
      ),
      h('p', { class: 'mt-3 flex-1 text-[13px] leading-6 text-ink' }, ...(after ? highlightDiff(first.text, attempt.text) : [attempt.text])),
      h('span', { class: `mt-3 self-center rounded-full px-3 py-1 text-[11px] font-semibold ${after ? 'bg-lav-100 text-lav-600' : 'bg-slate-100 text-ink-500'}`, text: after ? 'AI 피드백 반영' : '내가 작성한 가사' }),
    );

  const beforeIssues = (first.feedback.corrections.length
    ? first.feedback.corrections.slice(0, 3).map((c) => `'${c.from}' — ${c.reason}`)
    : METRICS.map(([k]) => [k, first.feedback.scores[k]]).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([k]) => first.feedback.categories?.[k] || ''))
    .filter(Boolean);
  const afterGains = METRICS.filter(([k]) => last.feedback.scores[k] > first.feedback.scores[k]).map(
    ([k, label]) => `${label} ${first.feedback.scores[k]} → ${last.feedback.scores[k]}점`,
  );
  if (last.feedback.improvement) afterGains.push(last.feedback.improvement);
  if (!afterGains.length) afterGains.push(last.feedback.summary);

  el.compare.replaceChildren(
    h('div', { class: 'mt-5 grid grid-cols-2 gap-3' }, side('수정 전', first, false), side('수정 후', last, true)),
    h('p', { class: 'mt-3 text-center text-xs font-semibold text-ink-500' },
      `점수 변화 ${u.attempts.map((a) => a.feedback.overall).join(' → ')} `,
      h('b', { class: delta >= 0 ? 'text-emerald-500' : 'text-rose-500', text: `(${delta >= 0 ? '+' : ''}${delta}점)` }),
    ),
    sectionTitle('AI 분석 비교', true),
    h('div', { class: 'grid grid-cols-2 gap-3' },
      h('div', { class: 'rounded-2xl border border-lav-100 bg-white p-4' },
        h('span', { class: 'chip-muted', text: '수정 전' }),
        h('ul', { class: 'mt-3 space-y-2' }, ...beforeIssues.map((t) => h('li', { class: 'bullet-x', text: t }))),
      ),
      h('div', { class: 'rounded-2xl border border-emerald-100 bg-white p-4' },
        h('span', { class: 'inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600', text: '수정 후' }),
        h('ul', { class: 'mt-3 space-y-2' }, ...afterGains.map((t) => h('li', { class: 'bullet-ok', text: t }))),
      ),
    ),
    h('button', { type: 'button', class: 'btn-primary mt-6 w-full py-4', onclick: () => commit(last.text) }, icon('bookmark', 'h-5 w-5', { filled: true }), '나의 보관함에 저장하기'),
    h('div', { class: 'mt-4 flex justify-center gap-6' },
      h('button', { type: 'button', class: 'btn-link', onclick: () => setStage('revise') }, '한 번 더 고치기'),
      h('button', { type: 'button', class: 'btn-link text-ink-500', onclick: () => setStage('feedback') }, '피드백 자세히 보기'),
    ),
  );
}

/* ── Stage switching ────────────────────────────────────────── */

function setStage(next, { scroll = true } = {}) {
  stage = next;
  renderStage();
  if (scroll) $('[data-view="study"]').scrollTo({ top: 0, behavior: 'smooth' });
}

function renderStage() {
  const u = unit();
  if ((stage === 'feedback' || stage === 'revise') && !u.attempts.length) stage = 'write';
  if (stage === 'compare' && u.attempts.length < 2) stage = u.attempts.length ? 'feedback' : 'write';

  el.heading.textContent = HEADINGS[stage];
  renderStepper();
  const writing = stage === 'write' || stage === 'revise';
  el.writeStage.hidden = !writing;
  el.writeBox.hidden = stage !== 'write';
  el.reviseBox.hidden = stage !== 'revise';
  el.feedback.hidden = stage !== 'feedback';
  el.compare.hidden = stage !== 'compare';

  if (writing) renderLyricCard();
  if (stage === 'write') renderWrite();
  if (stage === 'revise') renderRevise();
  if (stage === 'feedback') renderFeedbackStage();
  if (stage === 'compare') renderCompareStage();
  updateButtons();
}

function updateButtons() {
  el.feedbackBtn.disabled = busy || !el.draft.value.trim();
  el.reviseBtn.disabled = busy || !el.revise.value.trim();
}

function render() {
  if (!work) return;
  renderHeader();
  renderStage();
  if (!el.sheet.hidden) renderLyrics();
}

/* ── Lyrics sheet ───────────────────────────────────────────── */

function renderLyrics() {
  const showMine = el.showMine.checked;
  const byKey = new Map(work.lines.map((u, i) => [u.key, i]));
  const current = unit();
  const items = work.lyrics.split('\n').filter((line) => !isTranslationLine(line)).map((line) => {
    if (!line.trim()) return h('li', { class: 'h-3', 'aria-hidden': 'true' });
    const i = byKey.get(normalizeLine(line));
    if (i == null || !needsAdaptation(line, work.direction)) {
      return h('li', { class: 'px-3 py-1 text-sm text-ink-300', text: line });
    }
    const u = work.lines[i];
    const active = u === current;
    const dot = u.final ? 'bg-emerald-400' : u.attempts.length ? 'bg-amber-400' : 'bg-lav-200';
    return h('li', {},
      h('button', {
        type: 'button',
        class: `flex w-full items-start gap-2.5 rounded-xl px-3 py-1.5 text-left transition ${active ? 'bg-lav-100' : 'hover:bg-lav-50'}`,
        'data-active': active ? 'true' : null,
        onclick: () => {
          goTo(i);
          el.sheet.hidden = true;
        },
      },
        h('span', { class: `mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}` }),
        h('span', { class: 'min-w-0' },
          h('span', { class: `block text-sm ${active ? 'font-bold text-lav-700' : 'text-ink-700'}`, text: line }),
          showMine && u.final ? h('span', { class: 'block text-sm font-semibold text-lav-500', text: u.final }) : null,
        ),
      ),
    );
  });
  el.lyrics.replaceChildren(...items);
  requestAnimationFrame(() => el.lyrics.querySelector('[data-active]')?.scrollIntoView({ block: 'center' }));
}

/* ── Actions ───────────────────────────────────────────────── */

function goTo(i) {
  if (i < 0 || i >= work.lines.length) return;
  idx = i;
  work.current = i;
  saveWork();
  stage = defaultStage(unit());
  renderHeader();
  setStage(stage);
}

async function evaluate(text, isRevision) {
  if (busy) return;
  const u = unit();
  const w = work;
  const { prev, next } = contextLines(u);
  const previous = isRevision ? lastAttempt(u) : null;
  if (previous && previous.text.trim() === text.trim()) return toast('아직 수정한 부분이 없어요. 한 단어라도 바꿔 볼까요?');

  busy = true;
  updateButtons();
  const backStage = stage;
  const target = isRevision ? 'compare' : 'feedback';
  el.writeStage.hidden = true;
  el.feedback.hidden = target !== 'feedback';
  el.compare.hidden = target !== 'compare';
  el.heading.textContent = HEADINGS[target];
  stage = target;
  renderStepper();
  (isRevision ? el.compare : el.feedback).replaceChildren(loadingBlock(isRevision ? '고친 문장을 이전과 비교하는 중이에요…' : '리키가 문장을 읽고 있어요…'));
  $('[data-view="study"]').scrollTo({ top: 0, behavior: 'smooth' });

  try {
    const { feedback } = await getFeedback({
      original: u.original,
      prev,
      next,
      draft: text,
      previousDraft: previous?.text || '',
      previousOverall: previous?.feedback.overall ?? null,
      song: { title: w.song.title, artist: w.song.artist },
      direction: w.direction,
      level: store.settings.level,
    });
    const attempt = { text, feedback, at: Date.now() };
    if (isRevision) u.attempts.push(attempt);
    else u.attempts = [attempt];
    u.revision = text;
    store.put('works', w);
    if (work === w && unit() === u) {
      stage = isRevision && u.attempts.length >= 2 ? 'compare' : 'feedback';
      renderStage();
    }
  } catch (err) {
    if (work === w && unit() === u) {
      stage = backStage;
      renderStage();
    }
    toast(err.message || '피드백을 받지 못했어요.', 4000);
  } finally {
    busy = false;
    updateButtons();
  }
}

function commit(text) {
  const u = unit();
  text = (text || '').trim();
  if (!text) return toast('먼저 문장을 써 주세요 ✍️');
  const before = todayStatus();
  const match = [...u.attempts].reverse().find((a) => a.text.trim() === text);
  u.final = text;
  u.finalScore = match ? match.feedback.overall : null;
  u.finalAt = Date.now();
  const daily = recordLine(work.id, u.key, before);

  const remaining = work.lines.findIndex((l, i) => i > idx && !l.final);
  const wrap = work.lines.findIndex((l) => !l.final);
  if (wrap === -1 && work.status !== 'completed') {
    work.status = 'completed';
    store.put('works', work);
    render();
    showDone();
    if (daily.justCompleted) toast(`🎉 One day 챌린지도 달성! 오늘 ${daily.lines}줄을 번안했어요`, 3600);
    return;
  }
  store.put('works', work);
  if (daily.justCompleted) toast(`🎉 One day 챌린지 달성! 오늘 ${daily.lines}줄을 번안했어요`, 3600);
  else if (!daily.done) toast(`보관함에 저장했어요! 오늘의 챌린지 ${daily.lines}/${DAILY_GOAL}줄 🎶`);
  else toast(u.finalScore != null ? `보관함에 저장했어요! ${u.finalScore}점짜리 한 줄 완성 🎶` : '보관함에 저장했어요! 다음 줄로 가 볼까요?');
  const nextIdx = remaining !== -1 ? remaining : wrap !== -1 ? wrap : Math.min(idx + 1, work.lines.length - 1);
  goTo(nextIdx);
}

function showDone() {
  const scored = work.lines.filter((l) => l.finalScore != null);
  const avg = scored.length ? Math.round(scored.reduce((s, l) => s + l.finalScore, 0) / scored.length) : null;
  $('#done-summary').textContent = `「${work.song.title}」 ${work.lines.length}줄을 모두 바꿔 썼어요${avg != null ? ` · 평균 ${avg}점` : ''}. 나만의 가사가 보관함에 저장됐어요!`;
  $('#done-modal').hidden = false;
}

function listen() {
  const u = unit();
  if (!u) return;
  if (el.wave.classList.contains('playing')) {
    window.speechSynthesis?.cancel();
    el.wave.classList.remove('playing');
    el.listenLabel.textContent = '원문 듣기';
    return;
  }
  const ok = speak(u.original, sourceLang(), () => {
    el.wave.classList.remove('playing');
    el.listenLabel.textContent = '원문 듣기';
  });
  if (!ok) return toast('이 브라우저는 음성 듣기를 지원하지 않아요.');
  el.wave.classList.add('playing');
  el.listenLabel.textContent = '재생 중…';
}

function askTutor() {
  const u = unit();
  if (!u) return startTutorChat({ prompt: '', context: null });
  const draft = (stage === 'revise' ? el.revise.value : el.draft.value).trim();
  const last = lastAttempt(u);
  const prompt = last
    ? `"${u.original}" 줄을 "${last.text}"(으)로 바꿔 썼는데 ${last.feedback.overall}점을 받았어요. 어떤 부분을 더 고치면 좋을지 구체적으로 알려 주세요!`
    : draft
      ? `"${u.original}" 줄을 "${draft}"(으)로 바꿔 써 봤어요. 자연스러운지 봐 주세요!`
      : `"${u.original}" 줄을 어떻게 바꿔 쓰면 좋을지 힌트를 주세요. 바로 정답 말고 단계별로요!`;
  startTutorChat({
    prompt,
    context: { song: { title: work.song.title, artist: work.song.artist }, direction: work.direction, line: u.original, draft },
  });
}

function back() {
  if (!work || stage === 'write') return go('#/home');
  setStage(stage === 'revise' || stage === 'compare' ? 'feedback' : 'write');
}

/* ── Init / show ────────────────────────────────────────────── */

export function initStudio() {
  Object.assign(el, {
    empty: $('#study-empty'),
    main: $('#study-main'),
    heading: $('#study-heading'),
    stepper: $('#stepper'),
    art: $('#study-art'),
    title: $('#study-title'),
    artist: $('#study-artist'),
    count: $('#study-count'),
    writeStage: $('#stage-write'),
    writeBox: $('#write-box'),
    reviseBox: $('#revise-box'),
    lineLabel: $('#line-label'),
    linePrev: $('#line-prev'),
    lineCurrent: $('#line-current'),
    lineNext: $('#line-next'),
    prevBtn: $('#line-prev-btn'),
    nextBtn: $('#line-next-btn'),
    wave: $('#wave'),
    listenLabel: $('#listen-label'),
    draftLabel: $('#draft-label'),
    draft: $('#draft-input'),
    draftCount: $('#draft-count'),
    syllables: $('#syllable-meter'),
    tip: $('#study-tip'),
    feedbackBtn: $('#feedback-btn'),
    skipBtn: $('#skip-btn'),
    reviseRef: $('#revise-ref'),
    revise: $('#revise-input'),
    reviseCount: $('#revise-count'),
    reviseMeter: $('#revise-meter'),
    reviseBtn: $('#revise-btn'),
    feedback: $('#stage-feedback'),
    compare: $('#stage-compare'),
    sheet: $('#lyrics-sheet'),
    lyrics: $('#lyrics-list'),
    source: $('#lyrics-source'),
    showMine: $('#show-mine'),
  });
  $('#study-empty-mascot').replaceChildren(mascot('h-24 w-24'));

  el.draft.addEventListener('input', () => {
    unit().draft = el.draft.value;
    el.draftCount.textContent = `${el.draft.value.length}/200`;
    meter(el.syllables, unit().original, el.draft.value);
    updateButtons();
    saveWork();
  });
  el.revise.addEventListener('input', () => {
    unit().revision = el.revise.value;
    el.reviseCount.textContent = `${el.revise.value.length}/200`;
    meter(el.reviseMeter, unit().original, el.revise.value);
    updateButtons();
    saveWork();
  });
  el.draft.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) el.feedbackBtn.click();
  });
  el.revise.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) el.reviseBtn.click();
  });

  el.feedbackBtn.addEventListener('click', () => {
    const text = el.draft.value.trim();
    if (!text) return toast('먼저 문장을 써 주세요 ✍️');
    evaluate(text, false);
  });
  el.skipBtn.addEventListener('click', () => {
    const u = unit();
    if (u.final && !el.draft.value.trim()) return goTo(Math.min(idx + 1, work.lines.length - 1));
    commit(el.draft.value);
  });
  el.reviseBtn.addEventListener('click', () => {
    const text = el.revise.value.trim();
    if (!text) return toast('고쳐 쓴 문장을 입력해 주세요.');
    evaluate(text, true);
  });
  $('#revise-back').addEventListener('click', () => setStage('feedback'));
  el.prevBtn.addEventListener('click', () => goTo(idx - 1));
  el.nextBtn.addEventListener('click', () => goTo(idx + 1));
  $('#listen-btn').addEventListener('click', listen);
  $('#study-back').addEventListener('click', back);
  $('#study-chat').addEventListener('click', askTutor);
  $('#lyrics-open').addEventListener('click', () => {
    if (!work) return toast('먼저 학습할 곡을 골라 주세요.');
    el.sheet.hidden = false;
    renderLyrics();
  });
  el.showMine.addEventListener('change', renderLyrics);

  $('#done-library').addEventListener('click', () => {
    $('#done-modal').hidden = true;
    go(`#/library/${work.id}`);
  });
  $('#done-next').addEventListener('click', () => {
    $('#done-modal').hidden = true;
    go('#/home');
  });

  store.subscribe((e) => {
    if (e.type === 'change' && e.col === 'works' && work && !busy) {
      const fresh = store.get('works', work.id);
      if (!fresh) {
        work = null;
      } else if (fresh !== work && document.activeElement !== el.draft && document.activeElement !== el.revise) {
        work = fresh;
        idx = Math.min(idx, work.lines.length - 1);
        if (!$('[data-view="study"]').hidden) render();
      }
    }
  });
}

export function showStudy() {
  if (!work && store.settings.lastWorkId) {
    const w = store.get('works', store.settings.lastWorkId);
    if (w) {
      work = w;
      idx = Math.min(w.current || 0, w.lines.length - 1);
      stage = defaultStage(w.lines[idx]);
    }
  }
  el.empty.hidden = Boolean(work);
  el.main.hidden = !work;
  $('#study-chat').hidden = !work;
  $('#lyrics-open').hidden = !work;
  el.heading.textContent = work ? HEADINGS[stage] : '학습하기';
  if (work) render();
}
