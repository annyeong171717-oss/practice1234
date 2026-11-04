import { getStatus } from './api.js';
import { initArtist, showArtist } from './artist.js';
import { initChat, showChat } from './chat.js';
import { initDaily } from './daily.js';
import { initHome, showChart, showHome } from './home.js';
import { initLibrary, showLibrary } from './library.js';
import { initMypage, openProfile, showMypage } from './mypage.js';
import * as store from './store.js';
import { initStudio, showStudy } from './studio.js';
import { $, $$, copyText, go, timeAgo, toast } from './util.js';

const VIEWS = {
  intro: () => {},
  home: showHome,
  chart: showChart,
  study: showStudy,
  chat: showChat,
  library: showLibrary,
  mypage: showMypage,
  artist: showArtist,
};
const ALIASES = { studio: 'study' };
const NAV_OF = { artist: 'home', chart: 'home' };
const NO_TABBAR = new Set(['intro', 'study', 'chat']);
/** Hash changes since page load; `history.back()` would leave the app when this is 0. */
let inAppNavs = 0;

function route() {
  let [, name = '', param] = location.hash.replace(/^#/, '').split('/');
  if (!name && !store.settings.onboarded) name = 'intro';
  name = ALIASES[name] || name;
  const view = VIEWS[name] ? name : 'home';
  $$('[data-view]').forEach((s) => (s.hidden = s.dataset.view !== view));
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (NAV_OF[view] || view)));
  $('#tabbar').hidden = NO_TABBAR.has(view);
  const section = $(`[data-view="${view}"]`);
  if (section.classList.contains('view')) section.scrollTop = 0;
  VIEWS[view](param ? decodeURIComponent(param) : undefined);
}

/* ── Intro ─────────────────────────────────────────────────── */

function initIntro() {
  $('#intro-start').addEventListener('click', () => {
    store.saveSettings({ onboarded: true });
    go('#/home');
    if (!store.settings.profile?.name) openProfile({ welcome: true });
  });
  $('#intro-login').addEventListener('click', () => {
    store.saveSettings({ onboarded: true });
    go('#/home');
    $('[data-open-settings]').click();
    requestAnimationFrame(() => $('#link-code').focus());
  });
}

/* ── Sync status pill & settings ───────────────────────────── */

let serverStatus = null;

const PILL = {
  idle: ['…', 'bg-slate-100 text-ink-400'],
  syncing: ['동기화 중', 'bg-lav-100 text-lav-600'],
  synced: ['☁️ 동기화됨', 'bg-emerald-50 text-emerald-600'],
  offline: ['오프라인', 'bg-amber-50 text-amber-600'],
  error: ['동기화 오류', 'bg-rose-50 text-rose-500'],
};

function renderSyncPill() {
  let [text, tone] = PILL[store.getSyncState()] || PILL.idle;
  if (serverStatus?.storage === 'memory' && store.getSyncState() === 'synced') [text, tone] = ['임시 저장', 'bg-amber-50 text-amber-600'];
  $$('[data-sync-pill]').forEach((p) => {
    p.textContent = text;
    p.className = `inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold ${tone}`;
  });
  const last = store.lastSyncedAt();
  $('#status-synced').textContent = last ? timeAgo(last) : '–';
}

function renderStatus() {
  const ai = $('#status-ai');
  const storage = $('#status-storage');
  if (!serverStatus) {
    ai.textContent = '서버 연결 실패';
    ai.className = 'font-semibold text-rose-500';
    storage.textContent = '이 기기에만 저장';
    storage.className = 'font-semibold text-amber-600';
    return;
  }
  ai.textContent = serverStatus.ai ? `연결됨 · ${serverStatus.model}` : 'API 키 미설정';
  ai.className = `font-semibold ${serverStatus.ai ? 'text-emerald-600' : 'text-rose-500'}`;
  const label = { redis: '클라우드 (Redis)', file: '서버 파일 (개발용)', memory: '임시 메모리 ⚠️' }[serverStatus.storage] || serverStatus.storage;
  storage.textContent = label;
  storage.className = `font-semibold ${serverStatus.storage === 'memory' ? 'text-amber-600' : 'text-emerald-600'}`;
}

function initModals() {
  $$('[data-close-modal]').forEach((b) => b.addEventListener('click', () => (b.closest('[data-modal]').hidden = true)));
  $$('[data-modal]').forEach((m) =>
    m.addEventListener('click', (e) => {
      if (e.target === m) m.hidden = true;
    }),
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('[data-modal]').forEach((m) => (m.hidden = true));
  });

  $$('[data-back]').forEach((b) =>
    b.addEventListener('click', () => {
      if (inAppNavs > 0) history.back();
      else go(b.dataset.back);
    }),
  );
}

function initSettings() {
  $$('[data-open-settings]').forEach((b) =>
    b.addEventListener('click', () => {
      $('#sync-code').textContent = store.getUserId();
      $('#level-select').value = store.settings.level;
      renderSyncPill();
      renderStatus();
      $('#settings-modal').hidden = false;
    }),
  );

  $('#copy-code').addEventListener('click', async () => {
    toast((await copyText(store.getUserId())) ? '동기화 코드를 복사했어요. 다른 기기에서 붙여넣어 주세요!' : '복사에 실패했어요.');
  });

  $('#link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#link-code').value.trim();
    if (code === store.getUserId()) return toast('이미 이 코드로 연결되어 있어요.');
    try {
      await store.linkAccount(code);
      $('#sync-code').textContent = store.getUserId();
      $('#link-code').value = '';
      toast('연결 완료! 기록을 불러왔어요 ☁️');
      route();
    } catch (err) {
      toast(err.message);
    }
  });

  $('#level-select').addEventListener('change', (e) => {
    store.saveSettings({ level: e.target.value });
    toast('학습 수준을 바꿨어요. 다음 피드백부터 적용돼요.');
  });

  $('#sync-now').addEventListener('click', async () => {
    await store.syncAll();
    toast(store.getSyncState() === 'synced' ? '동기화 완료!' : '동기화하지 못했어요. 네트워크를 확인해 주세요.');
  });

  $('#reset-device').addEventListener('click', () => {
    if (confirm('이 기기에서 로그아웃할까요?\n동기화 코드를 따로 저장해 두지 않았다면 기록을 다시 불러올 수 없어요.')) store.resetDevice();
  });
}

/* ── Boot ──────────────────────────────────────────────────── */

function boot() {
  initIntro();
  initHome();
  initStudio();
  initChat();
  initLibrary();
  initArtist();
  initMypage();
  initDaily();
  initModals();
  initSettings();

  store.subscribe((e) => {
    if (e.type === 'sync') renderSyncPill();
    if (e.type === 'quota') toast('이 기기의 저장 공간이 부족해요. 오래된 대화를 정리해 주세요.', 4000);
  });
  window.addEventListener('reric:profile', () => {
    if (!$('[data-view="home"]').hidden) showHome();
  });

  window.addEventListener('hashchange', () => {
    inAppNavs++;
    route();
  });
  route();
  renderSyncPill();

  getStatus()
    .then((s) => {
      serverStatus = s;
      if (!s.ai && store.settings.onboarded) toast('AI 튜터 연결 전이에요. 서버의 .env에 API 키를 설정해 주세요.', 5000);
    })
    .catch(() => (serverStatus = null))
    .finally(renderSyncPill);

  store.syncAll();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
