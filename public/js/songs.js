import { getArtwork } from './api.js';
import * as store from './store.js';
import { openFromPaste, openSong } from './studio.js';
import { $, $$, h, toast } from './util.js';

let opening = false;

export const fmtDuration = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : '');

/** Album art box with a gradient/initial fallback; looks the art up lazily when the song has none. */
export function artBox(song, cls, { lookup = true } = {}) {
  const box = h('div', { class: `relative overflow-hidden bg-gradient-to-br from-lav-200 via-lav-300 to-lav-500 ${cls}` },
    h('span', { class: 'absolute inset-0 grid place-items-center text-xl font-black text-white/80', text: String(song.title || '?').slice(0, 1) }),
  );
  const set = (url) => {
    if (!url) return;
    const img = h('img', { src: url, alt: '', loading: 'lazy', class: 'absolute inset-0 h-full w-full object-cover opacity-0 transition duration-500' });
    img.onload = () => {
      img.classList.remove('opacity-0');
      box.querySelector('span')?.remove();
    };
    box.prepend(img);
  };
  if (song.art) set(song.art);
  else if (lookup) getArtwork(`${song.artist} ${song.title}`).then(set);
  return box;
}

function spinnerOverlay() {
  return h('div', { class: 'absolute inset-0 z-10 grid place-items-center rounded-[inherit] bg-white/70 backdrop-blur-sm' },
    h('span', { class: 'h-7 w-7 animate-spin rounded-full border-[3px] border-lav-100 border-t-lav-500' }),
  );
}

/** Fetch the original lyrics for a released song and open the study screen; falls back to the paste dialog. */
export async function openSongUI(song, anchor) {
  if (opening) return;
  opening = true;
  const overlay = spinnerOverlay();
  anchor?.append(overlay);
  const direction = store.settings.direction;
  const busy = (err) => [502, 503, 504].includes(err.status);
  try {
    try {
      await openSong(song, direction);
    } catch (err) {
      if (!busy(err)) throw err;
      await new Promise((r) => setTimeout(r, 2500));
      await openSong(song, direction);
    }
  } catch (err) {
    if (err.status === 404) {
      openPaste({ title: song.title, artist: song.artist, direction, reason: err.message });
    } else if (busy(err)) {
      openPaste({
        title: song.title,
        artist: song.artist,
        direction,
        reason: '가사 서버가 잠시 응답하지 않아요. 잠시 후 다시 시도하거나, 가사를 직접 붙여넣어 시작할 수 있어요.',
      });
    } else {
      toast(err.message || '곡을 불러오지 못했어요. 다시 시도해 주세요.', 4000);
    }
  } finally {
    overlay.remove();
    opening = false;
  }
}

/** One row in a song list (search results, artist discography, chart). */
export function songRow(song, { rank } = {}) {
  const row = h('div', { class: 'card-flat relative flex items-center gap-3 p-2.5 pr-3 transition hover:border-lav-300' },
    rank ? h('span', { class: `w-6 shrink-0 text-center text-sm font-extrabold ${rank <= 3 ? 'text-lav-500' : 'text-ink-400'}`, text: String(rank) }) : null,
    artBox(song, 'h-12 w-12 shrink-0 rounded-xl', { lookup: false }),
    h('div', { class: 'min-w-0 flex-1' },
      h('p', { class: 'truncate text-[15px] font-bold text-ink', text: song.title }),
      h('p', { class: 'truncate text-xs text-ink-400', text: [song.artist, song.album, song.year, fmtDuration(song.duration)].filter(Boolean).join(' · ') }),
    ),
  );
  const btn = h('button', { type: 'button', class: 'btn-soft shrink-0 px-3.5 py-2 text-xs' }, '학습하기');
  btn.addEventListener('click', () => openSongUI(song, row));
  row.append(btn);
  return row;
}

/** Square album card used in horizontal strips (popular songs, editor picks). */
export function songCard(song, { sub, badge } = {}) {
  const art = artBox(song, 'aspect-square w-full rounded-2xl shadow-soft');
  if (badge) art.append(h('span', { class: 'absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-lav-700', text: badge }));
  const card = h('button', { type: 'button', class: 'group w-[108px] shrink-0 text-left' },
    art,
    h('p', { class: 'mt-2 truncate text-sm font-bold text-ink', text: song.title }),
    h('p', { class: 'truncate text-xs text-ink-400', text: sub || song.artist }),
  );
  card.addEventListener('click', () => openSongUI(song, art));
  return card;
}

export function skeletonRows(n = 4) {
  return Array.from({ length: n }, () => h('div', { class: 'h-[70px] animate-pulse rounded-2xl bg-lav-100/70' }));
}

export function skeletonCards(n = 4) {
  return Array.from({ length: n }, () =>
    h('div', { class: 'w-[108px] shrink-0' },
      h('div', { class: 'aspect-square animate-pulse rounded-2xl bg-lav-100/80' }),
      h('div', { class: 'mt-2 h-3 w-4/5 animate-pulse rounded bg-lav-100/80' }),
      h('div', { class: 'mt-1.5 h-2.5 w-1/2 animate-pulse rounded bg-lav-100/80' }),
    ),
  );
}

/* ── Paste lyrics modal ─────────────────────────────────────── */

let pasteDirection = 'ko-en';
function setPasteDirection(d) {
  pasteDirection = d;
  $$('#paste-direction [data-direction]').forEach((b) => b.classList.toggle('active', b.dataset.direction === d));
}

export function openPaste(prefill = {}) {
  $('#paste-song').value = prefill.title || '';
  $('#paste-artist').value = prefill.artist || '';
  $('#paste-lyrics').value = '';
  setPasteDirection(prefill.direction || store.settings.direction);
  $('#paste-modal').hidden = false;
  if (prefill.reason) toast(prefill.reason, 4500);
  ($('#paste-song').value ? $('#paste-lyrics') : $('#paste-song')).focus();
}

export function initPaste() {
  $$('#paste-direction [data-direction]').forEach((b) => b.addEventListener('click', () => setPasteDirection(b.dataset.direction)));
  $('#paste-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const lyrics = $('#paste-lyrics').value;
    if (lyrics.split('\n').filter((l) => l.trim()).length < 2) return toast('가사를 두 줄 이상 붙여넣어 주세요.');
    $('#paste-modal').hidden = true;
    await openFromPaste({
      title: $('#paste-song').value.trim(),
      artist: $('#paste-artist').value.trim(),
      lyrics,
      direction: pasteDirection,
    });
  });
}
