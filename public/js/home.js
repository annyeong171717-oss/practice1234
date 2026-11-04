import { getArtwork, getChart, searchLyrics, searchMusic } from './api.js';
import { CATALOG, POPULAR_ARTISTS } from './catalog.js';
import { renderDailyCard } from './daily.js';
import { initPaste, openPaste, openSongUI, skeletonCards, skeletonRows, songCard, songRow } from './songs.js';
import * as store from './store.js';
import { openWork } from './studio.js';
import { $, $$, go, h, icon, toast, vocative, waterOrb } from './util.js';

let chartSongs = null;
let chartUpdated = null;
let lastQuery = '';

/* ── Greeting & continue ────────────────────────────────────── */

function renderGreeting() {
  const name = store.settings.profile?.name?.trim();
  const el = $('#home-greeting');
  el.replaceChildren(
    ...(name
      ? [`${vocative(name)}`, h('br'), '오늘도 좋은 음악과', h('br'), '함께할까? ✨']
      : ['오늘도 좋은 음악과', h('br'), '함께할까요? ✨']),
  );
}

function renderDaily() {
  renderDailyCard($('#daily-card'), { onChange: renderDaily });
}

/** Per-song progress: in-progress songs first, then finished ones. */
function renderProgress() {
  const works = store.list('works');
  const ordered = [...works.filter((w) => w.status !== 'completed'), ...works.filter((w) => w.status === 'completed')].slice(0, 12);
  $('#progress-wrap').hidden = !ordered.length;
  $('#progress-strip').replaceChildren(
    ...ordered.map((w) => {
      const done = w.lines.filter((l) => l.final).length;
      const pct = w.lines.length ? (done / w.lines.length) * 100 : 0;
      return h('button', {
        type: 'button',
        class: 'card flex w-[136px] shrink-0 flex-col items-center px-3 pb-3.5 pt-4 text-center transition hover:-translate-y-0.5 hover:border-lav-300',
        onclick: () => openWork(w.id),
        title: `${w.song.title} 이어서 학습하기`,
      },
        waterOrb(pct, 'h-[92px] w-[92px]', 'text-[22px]'),
        h('span', { class: 'mt-3 block w-full truncate text-sm font-bold text-ink', text: w.song.title }),
        h('span', { class: 'block w-full truncate text-[11px] text-ink-400', text: w.song.artist }),
        h('span', {
          class: `mt-2 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${w.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-lav-50 text-lav-600'}`,
          text: w.status === 'completed' ? '완곡 🎉' : `${done}/${w.lines.length}줄`,
        }),
      );
    }),
  );
}

/* ── Direction, today's pick & editor picks ─────────────────── */

function renderDirection() {
  const direction = store.settings.direction;
  $$('#direction-toggle [data-direction]').forEach((b) => b.classList.toggle('active', b.dataset.direction === direction));
  $('#direction-caption').textContent = direction === 'ko-en' ? '한국어 가사를\n영어로 바꿔 써요' : '영어 가사를\n한국어로 바꿔 써요';
  $('#direction-caption').style.whiteSpace = 'pre-line';
}

function renderTodayPick() {
  const list = CATALOG[store.settings.direction];
  const day = Math.floor(Date.now() / 86_400_000);
  const song = list[day % list.length];
  const btn = $('#today-pick');
  const bg = h('div', { class: 'absolute inset-0 bg-gradient-to-br from-lav-400 via-lav-500 to-[#b69cf7]' });
  const art = h('img', { alt: '', class: 'absolute inset-0 h-full w-full scale-110 object-cover opacity-0 blur-[2px] transition duration-700' });
  art.onload = () => art.classList.replace('opacity-0', 'opacity-40');
  const setArt = (url) => url && (art.src = url);
  if (song.art) setArt(song.art);
  else getArtwork(`${song.artist} ${song.title}`).then(setArt);

  btn.replaceChildren(
    bg,
    art,
    h('div', { class: 'absolute inset-0 bg-gradient-to-r from-lav-600/80 via-lav-500/50 to-transparent' }),
    h('div', { class: 'relative flex h-full items-end justify-between gap-4 p-5' },
      h('div', { class: 'min-w-0' },
        h('p', { class: 'text-xs font-semibold text-white/85', text: '오늘의 추천 곡' }),
        h('p', { class: 'mt-1 truncate text-xl font-bold', text: song.title }),
        h('p', { class: 'truncate text-sm text-white/85', text: song.artist }),
      ),
      h('span', { class: 'grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-lav-500 shadow-lift' }, icon('play', 'ml-0.5 h-5 w-5')),
    ),
  );
  btn.onclick = () => openSongUI(song, btn);
}

function renderPicks() {
  const direction = store.settings.direction;
  $('#song-grid').replaceChildren(...CATALOG[direction].map((song) => songCard(song, { sub: `${song.artist} · ${song.mood}` })));
}

/* ── Popular chart ──────────────────────────────────────────── */

function renderChartStrip() {
  const strip = $('#chart-strip');
  if (!chartSongs) return strip.replaceChildren(...skeletonCards(4));
  if (!chartSongs.length) {
    return strip.replaceChildren(h('p', { class: 'py-6 text-sm text-ink-400', text: '인기 차트를 불러오지 못했어요. 검색으로 원하는 곡을 찾아보세요.' }));
  }
  strip.replaceChildren(...chartSongs.slice(0, 12).map((s) => songCard(s)));
}

function renderChartList() {
  const list = $('#chart-list');
  if (!chartSongs) return list.replaceChildren(...skeletonRows(8));
  if (!chartSongs.length) return list.replaceChildren(h('li', { class: 'py-8 text-center text-sm text-ink-400', text: '인기 차트를 불러오지 못했어요.' }));
  if (chartUpdated) $('#chart-caption').textContent = `Apple Music 실시간 인기곡 TOP ${chartSongs.length} · ${new Date(chartUpdated).toLocaleDateString('ko-KR')} 기준`;
  list.replaceChildren(...chartSongs.map((s) => h('li', {}, songRow(s, { rank: s.rank }))));
}

let chartLoading = null;
function loadChart() {
  chartLoading ||= getChart()
    .then((data) => {
      chartSongs = data.songs || [];
      chartUpdated = data.updated || null;
    })
    .catch(() => {
      chartSongs = [];
      chartLoading = null;
    })
    .finally(() => {
      renderChartStrip();
      if (!$('[data-view="chart"]').hidden) renderChartList();
    });
  return chartLoading;
}

export function showChart() {
  renderChartList();
  loadChart();
}

/* ── Artists ────────────────────────────────────────────────── */

async function openArtistByName(name, chip) {
  chip?.classList.add('opacity-50');
  try {
    const { artists } = await searchMusic(name);
    const match = artists.find((a) => a.name.toLowerCase() === name.toLowerCase()) || artists[0];
    if (!match) return toast('아티스트를 찾지 못했어요.');
    go(`#/artist/${match.artistId}`);
  } catch (err) {
    toast(err.message);
  } finally {
    chip?.classList.remove('opacity-50');
  }
}

function renderArtistChips() {
  $('#artist-chips').replaceChildren(
    ...POPULAR_ARTISTS.map((name) => {
      const chip = h('button', { type: 'button', class: 'rounded-full border border-lav-100 bg-white px-3.5 py-1.5 text-sm font-semibold text-ink-700 transition hover:border-lav-300 hover:text-lav-600', text: name });
      chip.addEventListener('click', () => openArtistByName(name, chip));
      return chip;
    }),
  );
}

/* ── Search ─────────────────────────────────────────────────── */

function showSearch(on) {
  $('#search-wrap').hidden = !on;
  $('#home-sections').hidden = on;
}

async function runSearch(q) {
  lastQuery = q;
  showSearch(true);
  $('#search-caption').textContent = `"${q}" 검색 중…`;
  $('#search-artists').replaceChildren();
  $('#search-results').replaceChildren(...skeletonRows(4));
  try {
    const { songs, artists } = await searchMusic(q);
    if (lastQuery !== q) return;
    $('#search-caption').textContent = songs.length || artists.length
      ? `아티스트 ${artists.length}명 · 곡 ${songs.length}개`
      : `"${q}"에 대한 결과가 없어요.`;
    $('#search-artists').replaceChildren(
      ...artists.map((a) =>
        h('a', { href: `#/artist/${a.artistId}`, class: 'card-flat flex shrink-0 items-center gap-2.5 py-2 pl-2 pr-4 transition hover:border-lav-300' },
          h('span', { class: 'grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-lav-300 to-lav-500 text-sm font-black text-white', text: a.name.slice(0, 1) }),
          h('span', {},
            h('span', { class: 'block whitespace-nowrap text-sm font-bold text-ink', text: a.name }),
            h('span', { class: 'block whitespace-nowrap text-[11px] text-ink-400', text: '전체 곡 보기 ›' }),
          ),
        ),
      ),
    );
    $('#search-results').replaceChildren(...songs.map((s) => songRow(s)));
  } catch (err) {
    $('#search-caption').textContent = err.message;
    $('#search-results').replaceChildren();
  }
}

async function runLyricsDbSearch() {
  const q = lastQuery;
  if (!q) return;
  $('#search-caption').textContent = `가사 DB에서 "${q}" 검색 중…`;
  $('#search-artists').replaceChildren();
  $('#search-results').replaceChildren(...skeletonRows(3));
  try {
    const { results } = await searchLyrics({ q });
    $('#search-caption').textContent = results.length ? `가사 DB 검색 결과 ${results.length}곡` : '가사 DB에도 없어요. 가사를 직접 붙여넣어 학습해 보세요.';
    $('#search-results').replaceChildren(
      ...results.map((r) => songRow({ title: r.title, artist: r.artist, album: r.album, duration: r.duration })),
    );
  } catch (err) {
    $('#search-caption').textContent = err.message;
    $('#search-results').replaceChildren();
  }
}

/* ── Init / show ────────────────────────────────────────────── */

export function initHome() {
  initPaste();

  $$('#direction-toggle [data-direction]').forEach((b) =>
    b.addEventListener('click', () => {
      store.saveSettings({ direction: b.dataset.direction });
      renderDirection();
      renderPicks();
      renderTodayPick();
    }),
  );

  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#search-input').value.trim();
    if (q) runSearch(q);
    $('#search-input').blur();
  });
  $('#search-input').addEventListener('input', (e) => {
    if (!e.target.value.trim() && lastQuery) {
      lastQuery = '';
      showSearch(false);
    }
  });
  $('#search-clear').addEventListener('click', () => {
    $('#search-input').value = '';
    lastQuery = '';
    showSearch(false);
  });
  $('#search-lyrics-db').addEventListener('click', runLyricsDbSearch);
  $('#open-paste').addEventListener('click', () => openPaste());

  renderArtistChips();
  renderPicks();
  renderTodayPick();
  renderChartStrip();
  loadChart();

  store.subscribe((e) => {
    if (e.type !== 'change' || $('[data-view="home"]').hidden) return;
    if (e.col === 'works') renderProgress();
    if (e.col === 'works' || e.col === 'days') renderDaily();
  });
}

export function showHome() {
  renderGreeting();
  renderDaily();
  renderProgress();
  renderDirection();
}
