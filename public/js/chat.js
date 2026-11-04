import { streamChat } from './api.js';
import * as store from './store.js';
import { $, autoGrow, copyText, go, h, mascot, renderMarkdown, timeAgo, toast, uid } from './util.js';

const SUGGESTIONS = [
  ['🎶', "'보고 싶다'를 가사처럼 영어로 표현하는 방법 5가지 알려줘"],
  ['🤔', '번역과 번안은 뭐가 달라요? 예시로 설명해 주세요'],
  ['🎤', "'night'과 라임이 맞는 단어로 후렴 한 줄 만들어 줘"],
  ['✍️', '가사에서는 관사(a/the)를 생략해도 괜찮나요?'],
];

let currentId = null;
let draftContext = null;
let live = null; // { convId, text, bubble, controller }

const el = {};
const conv = () => (currentId ? store.get('conversations', currentId) : null);
const nearBottom = () => el.scroll.scrollHeight - el.scroll.scrollTop - el.scroll.clientHeight < 140;
const scrollToBottom = (smooth) => el.scroll.scrollTo({ top: el.scroll.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });

/* ── Bubbles ───────────────────────────────────────────────── */

function userBubble(text) {
  return h('div', { class: 'flex animate-fade-up justify-end' },
    h('div', {
      class: 'max-w-[82%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-gradient-to-br from-lav-400 to-lav-600 px-4 py-2.5 text-[15px] leading-7 text-white shadow-lift',
      text,
    }),
  );
}

function assistantBubble({ content = '', at, streaming = false, error = null, onRetry } = {}) {
  const body = h('div', { class: 'md-body' });
  const actions = h('div', { class: 'mt-1 flex items-center gap-1 pl-1 text-xs text-ink-400' });
  const wrap = h('div', { class: 'flex animate-fade-up gap-2.5', 'data-error': error ? 'true' : null },
    h('span', { class: 'mt-5 shrink-0' }, mascot('h-9 w-9')),
    h('div', { class: 'min-w-0 flex-1' },
      h('p', { class: 'mb-1 pl-1 text-xs font-bold text-lav-600', text: '리키' }),
      h('div', { class: `inline-block max-w-full rounded-3xl rounded-tl-lg border px-4 py-3 shadow-soft ${error ? 'border-rose-200 bg-rose-50' : 'border-lav-100 bg-white'}` }, body),
      actions,
    ),
  );

  const setContent = (text, isStreaming) => {
    if (!text && isStreaming) {
      body.replaceChildren(h('span', { class: 'flex gap-1.5 py-1.5' }, h('span', { class: 'typing-dot' }), h('span', { class: 'typing-dot', style: { animationDelay: '.2s' } }), h('span', { class: 'typing-dot', style: { animationDelay: '.4s' } })));
      return;
    }
    body.innerHTML = renderMarkdown(text) + (isStreaming ? '<span class="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-lav-400"></span>' : '');
  };

  const setActions = (text, ts) => {
    actions.replaceChildren();
    actions.append(
      ...[
        ts ? h('span', { class: 'mr-1', text: timeAgo(ts) }) : null,
      text
        ? h('button', {
            type: 'button',
            class: 'rounded-lg px-2 py-1 transition hover:bg-lav-100 hover:text-lav-600',
            onclick: async () => toast((await copyText(text)) ? '복사했어요!' : '복사에 실패했어요.'),
          }, '복사')
        : null,
        onRetry ? h('button', { type: 'button', class: 'rounded-lg px-2 py-1 font-semibold text-lav-600 transition hover:bg-lav-100', onclick: onRetry }, '다시 시도') : null,
      ].filter(Boolean),
    );
  };

  if (error) {
    body.replaceChildren(h('p', { text: `⚠️ ${error}` }));
    setActions('', null);
  } else {
    setContent(content, streaming);
    if (!streaming) setActions(content, at);
  }

  let frame = 0;
  return {
    node: wrap,
    update(text) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const stick = nearBottom();
        setContent(text, true);
        if (stick) scrollToBottom(false);
      });
    },
    finish(text, ts) {
      cancelAnimationFrame(frame);
      setContent(text, false);
      setActions(text, ts);
    },
  };
}

/* ── Rendering ─────────────────────────────────────────────── */

function renderList() {
  const items = store.list('conversations');
  if (!items.length) {
    el.list.replaceChildren(h('li', { class: 'px-3 py-6 text-center text-sm text-ink-400', text: '아직 대화가 없어요' }));
    return;
  }
  el.list.replaceChildren(
    ...items.map((c) => {
      const last = c.messages[c.messages.length - 1];
      const active = c.id === currentId;
      return h('li', {},
        h('a', {
          href: `#/chat/${c.id}`,
          class: `block rounded-2xl px-3 py-2.5 transition ${active ? 'bg-lav-100' : 'hover:bg-lav-50'}`,
          onclick: closeDrawer,
        },
          h('span', { class: 'flex items-center justify-between gap-2' },
            h('span', { class: `truncate text-sm font-semibold ${active ? 'text-lav-700' : 'text-ink-700'}`, text: (c.context?.song ? '🎵 ' : '') + c.title }),
            h('span', { class: 'shrink-0 text-[10px] text-ink-400', text: timeAgo(c.updatedAt) }),
          ),
          h('span', { class: 'mt-0.5 block truncate text-xs text-ink-400', text: last ? last.content.replace(/[#*_>`]/g, '') : '' }),
        ),
      );
    }),
  );
}

function renderHeader() {
  const c = conv();
  const ctx = c?.context || draftContext;
  el.title.textContent = '리키 · AI 튜터';
  el.context.textContent = ctx?.song ? `🎵 「${ctx.song.title}」 ${ctx.song.artist} 번안 중 질문` : c ? c.title : '친절하고 유쾌한 K-pop 영어 작문 선생님';
  el.del.hidden = !c;
}

function renderMessages() {
  const c = conv();
  const messages = c?.messages || [];
  el.empty.hidden = messages.length > 0 || (live && live.convId === currentId);
  const nodes = [];
  messages.forEach((m) => {
    nodes.push(m.role === 'user' ? userBubble(m.content) : assistantBubble({ content: m.content, at: m.at }).node);
  });

  if (live && c && live.convId === c.id) {
    const b = assistantBubble({ streaming: true });
    b.update(live.text);
    live.bubble = b;
    nodes.push(b.node);
  } else if (messages.length && messages[messages.length - 1].role === 'user') {
    nodes.push(assistantBubble({ error: '답변을 받지 못한 메시지가 있어요.', onRetry: () => generate(c) }).node);
  }
  el.messages.replaceChildren(...nodes);
  requestAnimationFrame(() => scrollToBottom(false));
}

function setStreamingUI(on) {
  el.send.hidden = on;
  el.stop.hidden = !on;
  updateSendState();
}

function updateSendState() {
  el.send.disabled = !el.input.value.trim() || Boolean(live);
}

/* ── Sending ───────────────────────────────────────────────── */

async function generate(c) {
  if (live) return;
  const controller = new AbortController();
  live = { convId: c.id, text: '', bubble: null, controller };
  if (c.id === currentId) {
    el.messages.querySelectorAll('[data-error]').forEach((n) => n.remove());
    const b = assistantBubble({ streaming: true });
    live.bubble = b;
    el.messages.append(b.node);
    el.empty.hidden = true;
    scrollToBottom(true);
  }
  setStreamingUI(true);

  const history = c.messages.map(({ role, content }) => ({ role, content }));
  let errorMessage = null;
  try {
    await streamChat({
      messages: history,
      context: c.context,
      level: store.settings.level,
      signal: controller.signal,
      onDelta: (text) => {
        live.text = text;
        if (live.bubble?.node.isConnected) live.bubble.update(text);
      },
    });
  } catch (err) {
    if (err.name !== 'AbortError') errorMessage = err.message || '답변을 받지 못했어요.';
  }

  const text = live.text.trim();
  const fresh = store.get('conversations', c.id) || c;
  if (text) {
    const content = controller.signal.aborted ? `${text}\n\n_(답변을 중간에 멈췄어요)_` : text;
    const at = Date.now();
    fresh.messages.push({ id: uid('m'), role: 'assistant', content, at });
    store.put('conversations', fresh);
    if (live.bubble?.node.isConnected) live.bubble.finish(content, at);
  }
  const bubble = live.bubble;
  live = null;
  setStreamingUI(false);

  if (errorMessage && !text) {
    if (bubble?.node.isConnected) bubble.node.replaceWith(assistantBubble({ error: errorMessage, onRetry: () => generate(store.get('conversations', c.id)) }).node);
    toast(errorMessage, 4000);
  }
  renderList();
}

function send(text) {
  const content = text.trim();
  if (!content || live) return;
  let c = conv();
  if (!c) {
    c = { id: uid('c'), title: content.replace(/\s+/g, ' ').slice(0, 40), messages: [], context: draftContext };
    draftContext = null;
    currentId = c.id;
    history.replaceState(null, '', `#/chat/${c.id}`);
  }
  c.messages.push({ id: uid('m'), role: 'user', content, at: Date.now() });
  store.put('conversations', c);

  el.input.value = '';
  autoGrow(el.input);
  el.empty.hidden = true;
  el.messages.append(userBubble(content));
  renderHeader();
  renderList();
  generate(c);
}

/* ── Conversation drawer ───────────────────────────────────── */

function openDrawer() {
  el.panel.classList.add('translate-x-0');
  el.panel.classList.remove('translate-x-full');
  el.backdrop.hidden = false;
}

function closeDrawer() {
  el.panel.classList.remove('translate-x-0');
  el.panel.classList.add('translate-x-full');
  el.backdrop.hidden = true;
}

/* ── Public ────────────────────────────────────────────────── */

export function initChat() {
  Object.assign(el, {
    panel: $('#conv-panel'),
    backdrop: $('#conv-backdrop'),
    list: $('#conv-list'),
    title: $('#chat-title'),
    context: $('#chat-context'),
    del: $('#chat-delete'),
    scroll: $('#chat-scroll'),
    empty: $('#chat-empty'),
    messages: $('#chat-messages'),
    form: $('#chat-form'),
    input: $('#chat-input'),
    send: $('#chat-send'),
    stop: $('#chat-stop'),
  });

  $('#chat-avatar').replaceChildren(mascot('h-10 w-10'));
  $('#chat-empty-mascot').replaceChildren(mascot('h-24 w-24'));
  $('#chat-suggestions').replaceChildren(
    ...SUGGESTIONS.map(([icon, text]) =>
      h('button', {
        type: 'button',
        class: 'card-flat px-4 py-3 text-left text-sm leading-6 text-ink-700 transition hover:border-lav-300 hover:text-lav-700',
        onclick: () => send(text),
      }, h('span', { class: 'mr-1.5', text: icon }), text),
    ),
  );

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    send(el.input.value);
  });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      send(el.input.value);
    }
  });
  el.input.addEventListener('input', () => {
    autoGrow(el.input);
    updateSendState();
  });
  el.stop.addEventListener('click', () => live?.controller.abort());

  $('#new-chat-btn').addEventListener('click', () => {
    draftContext = null;
    closeDrawer();
    go('#/chat');
  });
  $('#conv-open').addEventListener('click', openDrawer);
  $('#conv-close').addEventListener('click', closeDrawer);
  el.backdrop.addEventListener('click', closeDrawer);

  el.del.addEventListener('click', () => {
    const c = conv();
    if (!c || !confirm('이 대화를 삭제할까요? 연동된 모든 기기에서 사라져요.')) return;
    if (live?.convId === c.id) live.controller.abort();
    store.remove('conversations', c.id);
    toast('대화를 삭제했어요.');
    go('#/chat');
  });

  store.subscribe((e) => {
    if (e.type !== 'change' || e.col !== 'conversations' || $('[data-view="chat"]').hidden) return;
    renderList();
    if (!live && currentId && !store.get('conversations', currentId)) go('#/chat');
  });
}

export function showChat(id) {
  if (id && !store.get('conversations', id)) {
    toast('대화를 찾을 수 없어요.');
    history.replaceState(null, '', '#/chat');
    id = null;
  }
  if (id !== currentId || !id) {
    currentId = id || null;
    if (id) draftContext = null;
  }
  closeDrawer();
  renderHeader();
  renderList();
  renderMessages();
  updateSendState();
  setStreamingUI(Boolean(live));
  if (matchMedia('(min-width: 1024px)').matches) el.input.focus({ preventScroll: true });
}

/** Open a fresh conversation tied to the current lyric line, with a suggested first question. */
export function startTutorChat({ context, prompt }) {
  draftContext = context;
  currentId = null;
  go('#/chat');
  requestAnimationFrame(() => {
    el.input.value = prompt;
    autoGrow(el.input);
    updateSendState();
    el.input.focus();
    el.input.setSelectionRange(el.input.value.length, el.input.value.length);
  });
}
