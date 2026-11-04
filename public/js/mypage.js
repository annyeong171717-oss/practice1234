import { attendanceStreak, openCalendar } from './daily.js';
import { setLibraryTab } from './library.js';
import { computeStats } from './stats.js';
import * as store from './store.js';
import { $, $$, go, h, toast } from './util.js';

const AVATARS = ['🎧', '🎤', '🌙', '🦋', '🐰', '🐻', '🌸', '⭐'];
const DEFAULT_BIO = '좋아하는 걸 하면서\n더 나은 내가 되고 싶어!';

let pickedAvatar = AVATARS[0];

const profile = () => store.settings.profile || {};

function renderAvatars() {
  $('#profile-avatars').replaceChildren(
    ...AVATARS.map((a) =>
      h('button', {
        type: 'button',
        class: `grid h-12 w-12 place-items-center rounded-full text-2xl transition ${a === pickedAvatar ? 'bg-lav-200 ring-2 ring-lav-500' : 'bg-lav-50 hover:bg-lav-100'}`,
        'aria-label': `아바타 ${a}`,
        'aria-pressed': a === pickedAvatar ? 'true' : 'false',
        onclick: () => {
          pickedAvatar = a;
          renderAvatars();
        },
      }, a),
    ),
  );
}

/** Open the profile editor; `welcome` changes the copy for first-run onboarding. */
export function openProfile({ welcome = false } = {}) {
  const p = profile();
  pickedAvatar = p.avatar || AVATARS[0];
  $('#profile-title').textContent = welcome ? '반가워요! 뭐라고 불러 드릴까요?' : '프로필 편집';
  $('#profile-name').value = p.name || '';
  $('#profile-bio').value = p.bio || '';
  renderAvatars();
  $('#profile-modal').hidden = false;
  requestAnimationFrame(() => $('#profile-name').focus());
}

export function initMypage() {
  $('#profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#profile-name').value.trim();
    const bio = $('#profile-bio').value.trim();
    store.saveSettings({ profile: { name, bio, avatar: pickedAvatar } });
    $('#profile-modal').hidden = true;
    toast(name ? `반가워요, ${name}님! 💜` : '프로필을 저장했어요.');
    window.dispatchEvent(new CustomEvent('reric:profile'));
  });
  $('#my-avatar-btn').addEventListener('click', () => openProfile());
  $('#my-edit').addEventListener('click', () => openProfile());

  $$('#my-menu [data-menu]').forEach((b) =>
    b.addEventListener('click', () => {
      const action = b.dataset.menu;
      if (action === 'report') {
        setLibraryTab('report');
        go('#/library');
      } else if (action === 'attendance') {
        openCalendar();
      } else if (action === 'library') {
        setLibraryTab('all');
        go('#/library');
      } else if (action === 'chat') {
        go('#/chat');
      } else if (action === 'settings') {
        $('[data-open-settings]').click();
      } else if (action === 'help') {
        $('#help-modal').hidden = false;
      }
    }),
  );

  store.subscribe((e) => {
    if (e.type === 'change' && (e.col === 'works' || e.col === 'days') && !$('[data-view="mypage"]').hidden) showMypage();
  });
  window.addEventListener('reric:profile', () => {
    if (!$('[data-view="mypage"]').hidden) showMypage();
  });
}

export function showMypage() {
  const p = profile();
  $('#my-avatar').textContent = p.avatar || AVATARS[0];
  $('#my-name').textContent = p.name || '이름을 알려 주세요';
  $('#my-bio').textContent = p.bio || DEFAULT_BIO;
  const s = computeStats();
  $('#my-songs').textContent = String(s.works);
  $('#my-lines').textContent = String(s.lines);
  $('#my-streak').textContent = `${attendanceStreak()}일`;
}
