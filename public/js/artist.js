import { getArtist } from './api.js';
import { skeletonRows, songRow } from './songs.js';
import * as store from './store.js';
import { $, DIRECTION_LABEL, h, normalizeLine } from './util.js';

let current = null;

function renderSongs() {
  const list = $('#artist-songs');
  if (!current) return;
  const q = normalizeLine($('#artist-filter').value);
  const songs = q ? current.songs.filter((s) => normalizeLine(`${s.title} ${s.album || ''}`).includes(q)) : current.songs;
  list.replaceChildren(
    ...(songs.length
      ? songs.map((s) => songRow(s))
      : [h('p', { class: 'py-8 text-center text-sm text-ink-400', text: '조건에 맞는 곡이 없어요.' })]),
  );
}

export function initArtist() {
  $('#artist-filter').addEventListener('input', renderSongs);
}

export async function showArtist(id) {
  $('#artist-direction').textContent = DIRECTION_LABEL[store.settings.direction];
  if (current?.artist.artistId === Number(id)) return renderSongs();

  current = null;
  $('#artist-filter').value = '';
  $('#artist-name').textContent = '불러오는 중…';
  $('#artist-meta').textContent = '';
  $('#artist-art').replaceChildren();
  $('#artist-bg').style.backgroundImage = '';
  $('#artist-songs').replaceChildren(...skeletonRows(8));

  try {
    const data = await getArtist(id);
    current = data;
    const { artist, songs } = data;
    const years = songs.map((s) => s.year).filter(Boolean);
    $('#artist-name').textContent = artist.name;
    $('#artist-meta').textContent = [
      artist.genre,
      `${songs.length}곡`,
      years.length ? `${Math.min(...years)}–${Math.max(...years)}` : null,
    ].filter(Boolean).join(' · ');
    if (artist.art) {
      $('#artist-art').replaceChildren(h('img', { src: artist.art, alt: '', class: 'h-full w-full object-cover' }));
      $('#artist-bg').style.backgroundImage = `url("${artist.art}")`;
    } else {
      $('#artist-art').replaceChildren(h('span', { class: 'grid h-full w-full place-items-center text-4xl font-black text-white', text: artist.name.slice(0, 1) }));
    }
    renderSongs();
  } catch (err) {
    $('#artist-name').textContent = '아티스트를 불러오지 못했어요';
    $('#artist-meta').textContent = err.message;
    $('#artist-songs').replaceChildren();
  }
}
