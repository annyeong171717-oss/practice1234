export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

/** Tiny element builder: h('div', { class: 'x', onclick }, child, 'text') */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    }
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function uid(prefix = '') {
  const raw = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + raw;
}

let toastTimer;
export function toast(message, ms = 2800) {
  const wrap = $('#toast');
  const body = $('#toast-body');
  body.textContent = message;
  wrap.hidden = false;
  body.classList.remove('animate-fade-up');
  void body.offsetWidth;
  body.classList.add('animate-fade-up');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (wrap.hidden = true), ms);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function timeAgo(ts) {
  if (!ts) return '';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function autoGrow(textarea, max = 192) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, max)}px`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── Markdown (marked + DOMPurify) ─────────────────────────────── */
let mdReady = false;
function setupMarkdown() {
  if (mdReady || !window.marked || !window.DOMPurify) return;
  window.marked.setOptions({ gfm: true, breaks: true });
  window.DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  mdReady = true;
}

export function renderMarkdown(text) {
  setupMarkdown();
  if (!mdReady) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
  }
  return window.DOMPurify.sanitize(window.marked.parse(text || ''));
}

/* ── Language helpers ──────────────────────────────────────────── */
const HANGUL_RE = /[\uac00-\ud7a3]/g;

export function countHangul(s) {
  return (String(s).match(HANGUL_RE) || []).length;
}

function englishWordSyllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Approximate sung syllables: each Hangul block counts 1, English words use a vowel-group heuristic. */
export function countSyllables(s) {
  const text = String(s || '');
  const words = text.replace(HANGUL_RE, ' ').match(/[A-Za-z']+/g) || [];
  return countHangul(text) + words.reduce((n, w) => n + englishWordSyllables(w), 0);
}

export function isSectionMarker(line) {
  return /^\s*[\[(（【].{0,30}[\])）】]\s*$/.test(line) && !/[\uac00-\ud7a3]{4,}/.test(line);
}

/** Should this lyric line be practiced in the given direction? */
export function needsAdaptation(line, direction) {
  const t = line.trim();
  if (!t || isSectionMarker(t)) return false;
  const hangul = countHangul(t);
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  if (direction === 'ko-en') return hangul >= 2;
  return hangul === 0 && latin >= 4;
}

/** Chinese translation lines that some lyric sources interleave into Korean songs. */
export const isTranslationLine = (line) => /\p{Script=Han}/u.test(line) && !/[\uac00-\ud7a3\u3040-\u30ff]/.test(line);

export const normalizeLine = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function speak(text, lang, onend) {
  if (!('speechSynthesis' in window) || !text.trim()) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.95;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.startsWith(lang.slice(0, 2)));
  if (voice) u.voice = voice;
  if (onend) {
    u.onend = onend;
    u.onerror = onend;
  }
  window.speechSynthesis.speak(u);
  return true;
}

export function scoreColor(score) {
  if (score >= 85) return '#10b981';
  if (score >= 70) return '#7465e6';
  if (score >= 50) return '#f59e0b';
  return '#f43f5e';
}

export const fmtDate = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

/** "정원" → "정원아", "지수" → "지수야", "Mina" → "Mina," */
export function vocative(name) {
  const last = name.charCodeAt(name.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) return `${name}${(last - 0xac00) % 28 ? '아' : '야'}`;
  return `${name},`;
}

const wordKey = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/** Render `after` with the words that are new compared to `before` highlighted. */
export function highlightDiff(before, after) {
  const old = new Set(String(before || '').split(/\s+/).map(wordKey).filter(Boolean));
  return String(after || '')
    .split(/(\s+)/)
    .map((part) => (part.trim() && !old.has(wordKey(part)) ? h('mark', { class: 'hl', text: part }) : part));
}

const ICON_PATHS = {
  check: '<path stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path stroke-linecap="round" d="M7 7l10 10M17 7 7 17"/>',
  sparkle: '<path stroke-linejoin="round" d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  bookmark: '<path stroke-linejoin="round" d="M6 3.5h12v17l-6-4-6 4z"/>',
  speaker: '<path stroke-linejoin="round" d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path stroke-linecap="round" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  chevron: '<path stroke-linecap="round" stroke-linejoin="round" d="m9 18 6-6-6-6"/>',
  play: '<path fill="currentColor" stroke="none" d="M7 4.5v15l12.5-7.5z"/>',
};

export function icon(name, cls = 'h-5 w-5', { filled = false, stroke = 2 } = {}) {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${stroke}" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
  return span.firstElementChild;
}

let mascotSeq = 0;
/** Ricky, the AI tutor robot. */
export function mascot(cls = 'h-16 w-16') {
  const id = `rk${++mascotSeq}`;
  const span = document.createElement('span');
  span.innerHTML = `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ece9ff"/><stop offset="1" stop-color="#a99cf8"/></linearGradient>
      <radialGradient id="${id}b" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#3a3180"/><stop offset="1" stop-color="#211a55"/></radialGradient>
    </defs>
    <circle cx="32" cy="7" r="3.2" fill="#a99cf8"/><rect x="30.8" y="8.5" width="2.4" height="6" rx="1.2" fill="#a99cf8"/>
    <rect x="4" y="25" width="7" height="14" rx="3.5" fill="#c5bdfd"/><rect x="53" y="25" width="7" height="14" rx="3.5" fill="#c5bdfd"/>
    <rect x="9" y="13" width="46" height="40" rx="18" fill="url(#${id}a)"/>
    <rect x="15" y="21" width="34" height="23" rx="11.5" fill="url(#${id}b)"/>
    <ellipse cx="24.5" cy="31.5" rx="3.4" ry="4" fill="#9ff3ff"/><ellipse cx="39.5" cy="31.5" rx="3.4" ry="4" fill="#9ff3ff"/>
    <path d="M28 38.2q4 3 8 0" stroke="#9ff3ff" stroke-width="2" fill="none" stroke-linecap="round"/>
    <circle cx="18" cy="47" r="2.4" fill="#f9b8d8" opacity=".8"/><circle cx="46" cy="47" r="2.4" fill="#f9b8d8" opacity=".8"/>
    <path d="M51 8l1.2 3.3L55.5 12.5l-3.3 1.2L51 17l-1.2-3.3L46.5 12.5l3.3-1.2z" fill="#c5bdfd"/>
  </svg>`;
  return span.firstElementChild;
}

const WAVE_PATH = 'M0 10 Q25 1 50 10 T100 10 T150 10 T200 10 V20 H0 Z';

/** Glass orb that fills with water up to `percent`, with the percentage in the middle. */
export function waterOrb(percent, cls = 'h-24 w-24', labelCls = 'text-xl') {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const wave = (kind) =>
    `<svg class="wave ${kind}" viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true"><path d="${WAVE_PATH}"/></svg>`;
  const orb = h('div', { class: `water-orb ${cls}`, role: 'img', 'aria-label': `진행률 ${p}%`, style: { '--p': 0 }, 'data-empty': p === 0 ? 'true' : null });
  orb.innerHTML = `<div class="water">${wave('back')}${wave('front')}</div>
    <span class="orb-label ${labelCls}">${p}%</span><span class="orb-label light ${labelCls}" aria-hidden="true">${p}%</span>`;
  requestAnimationFrame(() => requestAnimationFrame(() => orb.style.setProperty('--p', p)));
  return orb;
}

export const DIRECTION_LABEL = { 'ko-en': '한국어 → 영어', 'en-ko': '영어 → 한국어' };
