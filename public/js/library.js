import { analyze, computeStats, finalAttempt } from './stats.js';
import * as store from './store.js';
import { openWork } from './studio.js';
import {
  $,
  $$,
  copyText,
  DIRECTION_LABEL,
  downloadText,
  fmtDate,
  go,
  h,
  highlightDiff,
  icon,
  isTranslationLine,
  mascot,
  needsAdaptation,
  normalizeLine,
  scoreColor,
  toast,
} from './util.js';

let tab = 'all';
let detailTab = 'mine';
let detailId = null;

function art(song, cls) {
  return h('div', { class: `overflow-hidden bg-gradient-to-br from-lav-300 to-lav-500 ${cls}` },
    song.art
      ? h('img', { src: song.art, alt: '', loading: 'lazy', class: 'h-full w-full object-cover' })
      : h('span', { class: 'grid h-full w-full place-items-center text-2xl font-black text-white/90', text: song.title.slice(0, 1) }),
  );
}

/** Full adapted lyrics: practiced lines replaced by the learner's final version, the rest kept as-is. */
export function adaptedLines(work) {
  const byKey = new Map(work.lines.map((u) => [u.key, u]));
  return work.lyrics.split('\n').filter((line) => !isTranslationLine(line)).map((line) => {
    if (!line.trim()) return { type: 'blank' };
    const u = needsAdaptation(line, work.direction) ? byKey.get(normalizeLine(line)) : null;
    if (!u) return { type: 'kept', text: line };
    return u.final ? { type: 'mine', text: u.final, original: line } : { type: 'todo', text: line };
  });
}

function exportText(work) {
  const body = adaptedLines(work)
    .map((l) => (l.type === 'blank' ? '' : l.text))
    .join('\n');
  return `${work.song.title} — ${work.song.artist}\n나만의 번안 가사 (${DIRECTION_LABEL[work.direction]}) · Re-ric\n\n${body}\n`;
}

const isDone = (w) => w.status === 'completed';

function toggleFav(work) {
  work.favorite = !work.favorite;
  store.put('works', work);
  toast(work.favorite ? '즐겨찾기에 추가했어요 💜' : '즐겨찾기에서 뺐어요.');
}

function favButton(work, cls = 'h-9 w-9') {
  return h('button', {
    type: 'button',
    class: `grid ${cls} shrink-0 place-items-center rounded-full transition hover:bg-lav-50 ${work.favorite ? 'text-lav-500' : 'text-ink-300'}`,
    'aria-label': work.favorite ? '즐겨찾기 해제' : '즐겨찾기',
    'aria-pressed': work.favorite ? 'true' : 'false',
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFav(work);
    },
  }, icon('bookmark', 'h-5 w-5', { filled: work.favorite }));
}

function emptyState(title, body, action) {
  return h('div', { class: 'flex flex-col items-center px-6 py-14 text-center' },
    mascot('h-20 w-20 animate-float'),
    h('p', { class: 'mt-4 text-lg font-extrabold text-ink', text: title }),
    h('p', { class: 'mt-1.5 text-sm leading-6 text-ink-500', text: body }),
    action || null,
  );
}

/* ── Index tabs ─────────────────────────────────────────────── */

function workCard(w, i) {
  const finals = w.lines.filter((l) => l.final);
  const snippet = finals.length ? finals.slice(0, 2).map((l) => l.final).join('\n') : w.lines[0]?.original || '';
  return h('a', {
    href: `#/library/${w.id}`,
    class: 'card flex animate-fade-up items-start gap-3.5 p-3.5 transition hover:border-lav-300',
    style: { animationDelay: `${i * 30}ms` },
  },
    art(w.song, 'h-[72px] w-[72px] shrink-0 rounded-2xl'),
    h('div', { class: 'min-w-0 flex-1' },
      h('div', { class: 'flex items-start gap-1' },
        h('div', { class: 'min-w-0 flex-1' },
          h('p', { class: 'truncate text-[15px] font-bold text-ink', text: w.song.title }),
          h('p', { class: 'truncate text-xs text-ink-500', text: w.song.artist }),
        ),
        favButton(w, 'h-8 w-8 -mr-1 -mt-1'),
      ),
      h('p', { class: `mt-1.5 line-clamp-2 whitespace-pre-line text-[13px] leading-5 ${finals.length ? 'text-ink-700' : 'text-ink-400'}`, text: snippet }),
      h('div', { class: 'mt-2 flex items-center justify-between gap-2' },
        h('span', { class: 'text-[11px] text-ink-400', text: `${fmtDate(w.updatedAt)} · ${finals.length}/${w.lines.length}줄` }),
        h('span', {
          class: `rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${isDone(w) ? 'bg-lav-100 text-lav-600' : 'bg-rose-50 text-rose-500'}`,
          text: isDone(w) ? '수정 완료' : '수정 필요',
        }),
      ),
    ),
  );
}

function renderWorks(works, { fav = false } = {}) {
  if (!works.length) {
    return [fav
      ? emptyState('즐겨찾기한 가사가 없어요', '보관함 카드의 책갈피를 누르면 여기에 모여요.')
      : emptyState('아직 보관함이 비어 있어요', '좋아하는 곡을 골라 첫 줄을 바꿔 써 보세요!', h('a', { href: '#/home', class: 'btn-primary mt-6 px-8' }, '곡 고르러 가기'))];
  }
  return works.map(workCard);
}

function renderLinesTab(works) {
  const items = works.flatMap((w) => w.lines.filter((u) => u.final).map((u) => ({ u, w }))).sort((a, b) => (b.u.finalAt || 0) - (a.u.finalAt || 0));
  if (!items.length) return [emptyState('아직 확정한 가사가 없어요', '학습하기에서 한 줄을 완성하면 여기에 차곡차곡 쌓여요.')];
  return items.map(({ u, w }, i) =>
    h('a', { href: `#/library/${w.id}`, class: 'card block animate-fade-up p-4 transition hover:border-lav-300', style: { animationDelay: `${Math.min(i, 12) * 25}ms` } },
      h('div', { class: 'flex items-center gap-2' },
        art(w.song, 'h-7 w-7 shrink-0 rounded-lg'),
        h('p', { class: 'min-w-0 flex-1 truncate text-xs font-semibold text-ink-500', text: `${w.song.title} · ${w.song.artist}` }),
        u.finalScore != null ? h('span', { class: 'text-sm font-extrabold', style: { color: scoreColor(u.finalScore) }, text: `${u.finalScore}점` }) : null,
      ),
      h('p', { class: 'mt-2.5 text-[15px] font-semibold leading-6 text-ink', text: u.final }),
      h('p', { class: 'mt-1 text-xs leading-5 text-ink-400', text: u.original }),
      h('p', { class: 'mt-2 text-[11px] text-ink-300', text: fmtDate(u.finalAt) }),
    ),
  );
}

function metricRow({ label, avg, comment }) {
  const good = avg != null && avg >= 70;
  return h('li', { class: 'flex gap-3 py-3' },
    h('span', { class: `mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-white ${avg == null ? 'bg-lav-200' : good ? 'bg-emerald-400' : 'bg-amber-400'}` },
      icon(good || avg == null ? 'check' : 'x', 'h-3 w-3', { stroke: 3 })),
    h('div', { class: 'min-w-0 flex-1' },
      h('div', { class: 'flex items-center justify-between' },
        h('p', { class: 'text-sm font-bold text-ink', text: label }),
        h('span', { class: 'text-sm font-extrabold', style: { color: avg == null ? '#c3c1d6' : scoreColor(avg) }, text: avg == null ? '–' : `${avg}점` }),
      ),
      h('div', { class: 'mt-1.5 h-1.5 overflow-hidden rounded-full bg-lav-100' },
        h('div', { class: 'h-full rounded-full', style: { width: `${avg || 0}%`, background: avg == null ? 'transparent' : scoreColor(avg) } })),
      comment ? h('p', { class: 'mt-1.5 text-xs leading-5 text-ink-500', text: comment }) : null,
    ),
  );
}

function reportView(works, { scope = 'all' } = {}) {
  const r = analyze(works);
  if (!r.count) {
    return [emptyState('분석할 기록이 아직 없어요', 'AI 피드백을 한 번이라도 받으면 나만의 분석 리포트가 만들어져요.')];
  }
  const nodes = [];
  if (scope === 'all') {
    const s = computeStats(works);
    nodes.push(
      h('div', { class: 'card grid grid-cols-3 divide-x divide-lav-100 py-4 text-center' },
        ...[['평균 점수', r.overall != null ? `${r.overall}` : '–'], ['확정한 줄', s.lines], ['평균 향상', r.avgGain != null ? `${r.avgGain >= 0 ? '+' : ''}${r.avgGain}` : '–']].map(([k, v]) =>
          h('div', {}, h('p', { class: 'text-xs font-semibold text-ink-500', text: k }), h('p', { class: 'mt-1 text-xl font-extrabold text-ink', text: String(v) }))),
      ),
    );
  }
  nodes.push(
    h('div', { class: `card p-5 ${scope === 'all' ? 'mt-3' : ''}` },
      h('p', { class: 'flex items-center gap-1.5 text-[15px] font-extrabold text-lav-700' }, icon('sparkle', 'h-4 w-4 text-lav-500'), 'AI 분석 리포트'),
      h('p', { class: 'mt-1 text-xs text-ink-400', text: `피드백 받은 ${r.count}줄을 기준으로 분석했어요` }),
      h('ul', { class: 'mt-2 divide-y divide-lav-50' }, ...r.metrics.map(metricRow)),
    ),
  );
  if (r.best && r.best.delta > 0) {
    nodes.push(
      h('div', { class: 'card mt-3 p-5' },
        h('p', { class: 'text-[15px] font-extrabold text-ink' }, '가장 많이 성장한 문장 ', h('span', { class: 'text-emerald-500', text: `+${r.best.delta}점` })),
        h('p', { class: 'mt-1 text-xs text-ink-400', text: `${r.best.w.song.title} · ${r.best.u.original}` }),
        h('div', { class: 'mt-3 space-y-2 text-sm' },
          h('p', { class: 'bullet-x', text: r.best.first.text }),
          h('p', { class: 'bullet-ok' }, h('span', {}, ...highlightDiff(r.best.first.text, r.best.last.text))),
        ),
      ),
    );
  }
  if (r.corrections.length) {
    nodes.push(
      h('div', { class: 'card mt-3 p-5' },
        h('p', { class: 'text-[15px] font-extrabold text-ink', text: '자주 받은 교정' }),
        h('ul', { class: 'mt-3 space-y-2.5' },
          ...r.corrections.map((c) =>
            h('li', { class: 'text-[13px] leading-6 text-ink-700' },
              h('del', { class: 'text-rose-400', text: c.from }), ' → ', h('b', { class: 'text-lav-600', text: c.to }),
              h('span', { class: 'block text-xs text-ink-400', text: c.reason }),
            )),
        ),
      ),
    );
  }
  return nodes;
}

function renderIndex() {
  $$('#lib-tabs [data-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  });
  const works = store.list('works');
  let nodes;
  if (tab === 'lines') nodes = renderLinesTab(works);
  else if (tab === 'fav') nodes = renderWorks(works.filter((w) => w.favorite), { fav: true });
  else if (tab === 'report') nodes = reportView(works);
  else nodes = renderWorks(works);
  $('#lib-content').replaceChildren(...nodes);
}

/* ── Detail ─────────────────────────────────────────────────── */

function mineTab(work) {
  const lines = adaptedLines(work);
  const done = work.lines.filter((l) => l.final).length;
  return [
    h('p', { class: 'mb-3 text-xs text-ink-400', text: `${done}/${work.lines.length}줄 번안 · 연한 줄은 아직 원문이에요` }),
    h('div', { class: 'card space-y-1 p-5 text-[15px] leading-7' },
      ...lines.map((l) => {
        if (l.type === 'blank') return h('div', { class: 'h-3' });
        if (l.type === 'mine') return h('p', { class: 'font-semibold text-ink', title: l.original, text: l.text });
        if (l.type === 'todo') return h('p', { class: 'text-ink-300', title: '아직 번안하지 않은 줄', text: l.text });
        return h('p', { class: 'text-ink-400', text: l.text });
      }),
    ),
  ];
}

function aiTab(work) {
  const practiced = work.lines.filter((u) => u.attempts.length);
  if (!practiced.length) return [emptyState('AI 피드백 기록이 없어요', '학습하기에서 문장을 쓰고 "다음"을 누르면 리키가 고쳐 줘요.')];
  return practiced.map((u) => {
    const first = u.attempts[0];
    const last = finalAttempt(u);
    const suggestion = last.feedback.suggestions?.[0];
    return h('div', { class: 'card mb-3 p-4' },
      h('p', { class: 'text-xs font-semibold text-ink-400', text: u.original }),
      h('div', { class: 'mt-3 space-y-2' },
        h('div', { class: 'rounded-2xl bg-slate-50 p-3' },
          h('div', { class: 'flex items-center justify-between' },
            h('span', { class: 'text-[11px] font-bold text-ink-400', text: '수정 전' }),
            h('span', { class: 'text-xs font-bold', style: { color: scoreColor(first.feedback.overall) }, text: `${first.feedback.overall}점` })),
          h('p', { class: 'mt-1 text-sm leading-6 text-ink-700', text: first.text }),
        ),
        u.attempts.length > 1 || u.final
          ? h('div', { class: 'rounded-2xl border border-lav-200 bg-lav-50 p-3' },
              h('div', { class: 'flex items-center justify-between' },
                h('span', { class: 'text-[11px] font-bold text-lav-600', text: u.final ? '수정 후 · 확정' : '수정 후' }),
                h('span', { class: 'text-xs font-bold', style: { color: scoreColor(last.feedback.overall) }, text: `${last.feedback.overall}점` })),
              h('p', { class: 'mt-1 text-sm font-semibold leading-6 text-ink' }, ...highlightDiff(first.text, u.final || last.text)),
            )
          : null,
        suggestion
          ? h('div', { class: 'rounded-2xl bg-white p-3 ring-1 ring-lav-100' },
              h('span', { class: 'flex items-center gap-1 text-[11px] font-bold text-lav-500' }, icon('sparkle', 'h-3 w-3'), `AI 추천 · ${suggestion.label}`),
              h('p', { class: 'mt-1 text-sm leading-6 text-ink-700', text: suggestion.text }),
            )
          : null,
      ),
    );
  });
}

function renderDetail(work) {
  const done = work.lines.filter((l) => l.final).length;
  $('#detail-hero').replaceChildren(
    work.song.art ? h('div', { class: 'absolute inset-0 scale-110 bg-cover bg-center opacity-60 blur-2xl', style: { backgroundImage: `url("${work.song.art}")` } }) : '',
    h('div', { class: 'absolute inset-0 bg-gradient-to-t from-ink/50 via-transparent to-transparent' }),
    h('div', { class: 'absolute inset-0 grid place-items-center' }, art(work.song, 'h-32 w-32 rounded-2xl shadow-shell ring-4 ring-white/40')),
    h('span', { class: 'absolute bottom-3 left-3 rounded-full bg-white/85 px-3 py-1 text-[11px] font-bold text-lav-700 backdrop-blur', text: DIRECTION_LABEL[work.direction] }),
  );
  $('#detail-title').textContent = work.song.title;
  $('#detail-meta').textContent = `${work.song.artist} · ${done}/${work.lines.length}줄 · ${fmtDate(work.updatedAt)}`;
  $('#detail-fav').replaceChildren(icon('bookmark', `h-6 w-6 ${work.favorite ? 'text-lav-500' : ''}`, { filled: work.favorite }));
  $('#detail-fav').setAttribute('aria-pressed', work.favorite ? 'true' : 'false');
  $('#detail-continue-2').textContent = isDone(work) ? '다시 학습하기' : '이어서 학습하기';

  $$('#detail-tabs [data-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === detailTab);
    b.setAttribute('aria-selected', String(b.dataset.tab === detailTab));
  });
  const nodes = detailTab === 'ai' ? aiTab(work) : detailTab === 'report' ? reportView([work], { scope: 'one' }) : mineTab(work);
  $('#detail-content').replaceChildren(...nodes);
}

/* ── Init / show ────────────────────────────────────────────── */

export function setLibraryTab(next) {
  tab = next;
}

export function initLibrary() {
  $$('#lib-tabs [data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      renderIndex();
    }),
  );
  $$('#detail-tabs [data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      detailTab = b.dataset.tab;
      const w = current();
      if (w) renderDetail(w);
    }),
  );

  const current = () => store.get('works', detailId);
  const menu = $('#detail-menu');
  const closeMenu = () => (menu.hidden = true);
  const resume = () => current() && openWork(detailId);
  $('#detail-continue').addEventListener('click', resume);
  $('#detail-continue-2').addEventListener('click', resume);
  $('#detail-fav').addEventListener('click', () => {
    const w = current();
    if (w) toggleFav(w);
  });
  $('#detail-more').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) closeMenu();
  });
  $('#detail-copy').addEventListener('click', async () => {
    closeMenu();
    const w = current();
    if (w) toast((await copyText(exportText(w))) ? '나만의 가사를 복사했어요 📋' : '복사에 실패했어요.');
  });
  $('#detail-download').addEventListener('click', () => {
    closeMenu();
    const w = current();
    if (w) downloadText(`Re-ric_${w.song.artist}_${w.song.title}.txt`.replace(/[\\/:*?"<>|]/g, '_'), exportText(w));
  });
  $('#detail-delete').addEventListener('click', () => {
    closeMenu();
    const w = current();
    if (!w || !confirm(`「${w.song.title}」 학습 기록을 삭제할까요? 연동된 모든 기기에서 사라져요.`)) return;
    store.remove('works', w.id);
    if (store.settings.lastWorkId === w.id) store.saveSettings({ lastWorkId: null });
    toast('삭제했어요.');
    go('#/library');
  });

  store.subscribe((e) => {
    if (e.type !== 'change' || e.col !== 'works' || $('[data-view="library"]').hidden) return;
    showLibrary(detailId, { keepTab: true });
  });
}

export function showLibrary(id, { keepTab = false } = {}) {
  if (id !== detailId && !keepTab) detailTab = 'mine';
  detailId = id || null;
  const work = detailId ? store.get('works', detailId) : null;
  if (detailId && !work) {
    detailId = null;
    history.replaceState(null, '', '#/library');
  }
  $('#detail-menu').hidden = true;
  $('#lib-index').hidden = Boolean(work);
  $('#lib-detail').hidden = !work;
  if (work) renderDetail(work);
  else renderIndex();
}
