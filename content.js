const PROVIDERS = [
  { id: 'chatgpt', hostnames: ['chatgpt.com', 'chat.openai.com'] },
  { id: 'claude', hostnames: ['claude.ai'] },
  { id: 'gemini', hostnames: ['gemini.google.com'] },
  { id: 'grok', hostnames: ['grok.com', 'x.com'] },
];

const BASE_URLS = {
  local: 'http://memoriq.local',
  production: 'https://memoriq.me',
};

function providerId() {
  return PROVIDERS.find((provider) => provider.hostnames.includes(window.location.hostname))?.id || 'unknown';
}

function cleanText(value) {
  return (value || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isGenericTitle(value, provider) {
  const normalized = cleanText(value).replace(/\s+/g, ' ');
  if (!normalized) return true;

  if (/^conversation with (chatgpt|claude|gemini|grok)$/i.test(normalized)) return true;

  return [
    'Google Gemini',
    'Gemini',
    'Grok',
    'X',
    'ChatGPT',
    'Claude',
    provider,
  ].some((title) => normalized.toLowerCase() === title.toLowerCase());
}

function isLikelyConversationTitle(value, provider) {
  const title = cleanText(value).replace(/\s+/g, ' ');
  if (isGenericTitle(title, provider)) return false;
  if (title.length < 6 || title.length > 180) return false;
  if (/^(new chat|recent|settings|upgrade|explore|discover|apps|history|search)$/i.test(title)) return false;
  if (/^(you|gemini|grok|claude|chatgpt)\s+said$/i.test(title)) return false;

  return true;
}

function titleFromPage(provider) {
  const selectors = [
    'h1',
    'header h1',
    'header h2',
    '[data-testid*="conversation-title" i]',
    '[data-testid*="chat-title" i]',
    '[aria-current="page"]',
    'nav [aria-current="page"]',
    'a[aria-current="page"]',
    '[class*="conversation-title" i]',
    '[class*="chat-title" i]',
    '[class*="selected" i]',
    '[class*="active" i]',
  ];

  const candidates = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]
    .map((element) => cleanText(element.innerText || element.textContent).replace(/\s+/g, ' '))
    .filter((title) => isLikelyConversationTitle(title, provider)));

  if (candidates.length) {
    return truncate([...new Set(candidates)].sort((a, b) => {
      const aHasSeparator = /[-:|]/.test(a) ? 1 : 0;
      const bHasSeparator = /[-:|]/.test(b) ? 1 : 0;
      return bHasSeparator - aHasSeparator || Math.abs(a.length - 60) - Math.abs(b.length - 60);
    })[0], 160);
  }

  return '';
}

function titleFromMessages(messages, provider) {
  const pageTitle = cleanText(document.title.replace(/\s*[-|]\s*(ChatGPT|Claude|Gemini|Grok|X).*$/i, ''));

  if (!isGenericTitle(pageTitle, provider)) return pageTitle;

  const pageConversationTitle = titleFromPage(provider);
  if (pageConversationTitle) return pageConversationTitle;

  const firstUserText = cleanText(messageText(messages.find((message) => message.role === 'user'))).replace(/\s+/g, ' ');
  const firstAnyText = cleanText(messageText(messages[0])).replace(/\s+/g, ' ');
  return truncate(firstUserText || firstAnyText, 120) || `${provider} conversation`;
}

function visibleText(element) {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return '';
  return cleanText(element.innerText || element.textContent || '');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isExtensionContextValid() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function extensionContextError(error) {
  const message = error?.message || '';
  if (message.includes('Extension context invalidated') || !isExtensionContextValid()) {
    return new Error('Extension was reloaded. Refresh this ChatGPT tab and try again.');
  }

  return error;
}

async function extractMessages(options = {}) {
  const provider = providerId();
  let messages = (await extractMessagesRich(provider, options)) || [];

  if (!messages?.length) {
    messages = [];
    const candidates = [
      '[data-message-author-role]',
      '[data-testid*="conversation-turn"]',
      'article',
      'main [role="listitem"]',
    ];

    const seen = new Set();

    for (const selector of candidates) {
      document.querySelectorAll(selector).forEach((element) => {
        const text = visibleText(element);
        if (!text || text.length < 2 || seen.has(text)) return;
        seen.add(text);

        const roleAttr = element.getAttribute('data-message-author-role');
        const role = roleAttr === 'user' ? 'user' : roleAttr === 'assistant' ? 'assistant' : messages.length % 2 === 0 ? 'user' : 'assistant';
        messages.push({ role, content: text, format: 'text' });
      });

      if (messages.length >= 2) break;
    }
  }

  if (!messages.length) {
    const main = document.querySelector('main') || document.body;
    const text = visibleText(main);
    if (text) messages = [{ role: 'assistant', content: text, format: 'text' }];
  }

  return {
    provider,
    title: titleFromMessages(messages, provider),
    sourceUrl: window.location.href,
    capturedAt: new Date().toISOString(),
    messages,
  };
}

function scrollMetrics(scroller) {
  const documentScroller = document.scrollingElement || document.documentElement;
  const isDocumentScroller = scroller === documentScroller || scroller === document.documentElement || scroller === document.body;

  return {
    top: isDocumentScroller ? window.scrollY || documentScroller.scrollTop : scroller.scrollTop,
    height: isDocumentScroller ? window.innerHeight : scroller.clientHeight,
    scrollHeight: isDocumentScroller ? documentScroller.scrollHeight : scroller.scrollHeight,
  };
}

function setScrollTop(scroller, top) {
  const documentScroller = document.scrollingElement || document.documentElement;
  const isDocumentScroller = scroller === documentScroller || scroller === document.documentElement || scroller === document.body;

  if (isDocumentScroller) {
    window.scrollTo({ top, behavior: 'auto' });
  } else {
    scroller.scrollTop = top;
  }
}

function findScrollContainer() {
  const documentScroller = document.scrollingElement || document.documentElement;
  const candidates = [
    documentScroller,
    ...document.querySelectorAll('main, [role="main"], div, section'),
  ];

  return candidates
    .filter((element) => {
      if (!element) return false;
      const metrics = scrollMetrics(element);
      if (metrics.scrollHeight - metrics.height < 300) return false;
      if (element === documentScroller) return true;

      const rect = element.getBoundingClientRect();
      if (rect.width < 240 || rect.height < 240) return false;

      const style = window.getComputedStyle(element);
      return /(auto|scroll|overlay)/i.test(`${style.overflowY} ${style.overflow}`);
    })
    .sort((a, b) => {
      const aMetrics = scrollMetrics(a);
      const bMetrics = scrollMetrics(b);
      return (bMetrics.scrollHeight - bMetrics.height) - (aMetrics.scrollHeight - aMetrics.height);
    })[0] || documentScroller;
}

function messageKey(message) {
  const text = cleanText(messageText(message));
  const html = cleanText(message.html || '');
  return `${message.role || ''}\n${text.slice(0, 3000)}\n${html.slice(0, 3000)}`;
}

function preferRicherMessage(existing, candidate) {
  const existingText = cleanText(messageText(existing));
  const candidateText = cleanText(messageText(candidate));

  if (candidateText.length > existingText.length) return candidate;
  if (candidateText.length < existingText.length) return existing;

  const existingHtml = (existing.html || '').length;
  const candidateHtml = (candidate.html || '').length;
  return candidateHtml > existingHtml ? candidate : existing;
}

function relatedMessageIndex(messages, message) {
  const text = cleanText(messageText(message));
  if (!text) return -1;

  return messages.findIndex((existing) => {
    if (existing.role !== message.role) return false;

    const existingText = cleanText(messageText(existing));
    if (!existingText) return false;
    if (existingText === text) return true;

    const shorter = existingText.length <= text.length ? existingText : text;
    const longer = existingText.length > text.length ? existingText : text;
    return longer.startsWith(shorter) && shorter.length >= 24;
  });
}

function mergeMessageSnapshots(snapshots) {
  const messages = [];
  const seen = new Set();

  snapshots
    .sort((a, b) => (a.position - b.position) || (a.order - b.order))
    .forEach((snapshot) => {
      snapshot.messages.forEach((message) => {
        const text = cleanText(messageText(message));
        if (!text && !message.html) return;

        const key = messageKey(message);
        const relatedIndex = relatedMessageIndex(messages, message);

        if (relatedIndex !== -1) {
          messages[relatedIndex] = preferRicherMessage(messages[relatedIndex], message);
          return;
        }

        if (key && seen.has(key)) return;

        if (key) seen.add(key);
        messages.push(message);
      });
    });

  return messages;
}

async function waitForScrollSettle(scroller, targetTop, cycles = 4) {
  let stableCycles = 0;
  let lastScrollHeight = -1;
  let lastTop = -1;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    setScrollTop(scroller, targetTop);
    await wait(250);

    const metrics = scrollMetrics(scroller);
    const topStable = Math.abs(metrics.top - lastTop) < 4;
    const heightStable = Math.abs(metrics.scrollHeight - lastScrollHeight) < 4;

    if (topStable && heightStable) {
      stableCycles += 1;
      if (stableCycles >= cycles) break;
    } else {
      stableCycles = 0;
    }

    lastTop = metrics.top;
    lastScrollHeight = metrics.scrollHeight;
  }
}

function buildChatPayload(provider, messages, title = '') {
  return {
    provider,
    title: title || titleFromMessages(messages, provider),
    sourceUrl: window.location.href,
    capturedAt: new Date().toISOString(),
    messages,
  };
}

async function extractMessagesAcrossScroll(button) {
  const provider = providerId();

  if (provider === 'chatgpt') {
    updateButton(button, 'Loading chat...', true);
    const apiResult = await extractChatGptFromApi();

    if (apiResult?.messages?.length) {
      updateButton(button, `Loaded ${apiResult.messages.length} messages`, true);
      return buildChatPayload('chatgpt', apiResult.messages, apiResult.title);
    }
  }

  const scroller = findScrollContainer();
  const originalTop = scrollMetrics(scroller).top;
  const maxInitialTop = Math.max(0, scrollMetrics(scroller).scrollHeight - scrollMetrics(scroller).height);
  const chatGptTurnCount = provider === 'chatgpt'
    ? document.querySelectorAll('[data-testid*="conversation-turn"]').length
    : 0;
  const needsScrollSweep = provider === 'chatgpt'
    || maxInitialTop >= 1200
    || chatGptTurnCount >= 6;
  const extractOptions = { prepareChatGptTurns: false };

  if (provider === 'chatgpt') {
    await prepareChatGptTurnsForExtraction();
  }

  const basePayload = await extractMessages(extractOptions);

  if (!needsScrollSweep) return basePayload;

  const snapshots = [];
  let snapshotOrder = 0;
  let bestCount = basePayload.messages.length;

  async function captureSnapshot(phase = 'Scanning chat') {
    const payload = await extractMessages(extractOptions);
    const metrics = scrollMetrics(scroller);
    const maxTop = Math.max(1, metrics.scrollHeight - metrics.height);
    snapshots.push({
      order: snapshotOrder,
      top: metrics.top,
      position: metrics.top / maxTop,
      messages: payload.messages || [],
    });
    snapshotOrder += 1;

    const count = mergeMessageSnapshots(snapshots).length;
    bestCount = Math.max(bestCount, count);
    updateButton(button, `${phase}... ${count} messages`, true);
    return count;
  }

  async function sweepDown(phase) {
    let stagnantSteps = 0;
    let lastCount = mergeMessageSnapshots(snapshots).length;

    for (let step = 0; step < 160; step += 1) {
      const before = scrollMetrics(scroller);
      const maxTop = Math.max(0, before.scrollHeight - before.height);

      await captureSnapshot(phase);

      if (before.top >= maxTop - 8) {
        await waitForScrollSettle(scroller, maxTop, 2);
        if (provider === 'chatgpt') {
          await prepareChatGptTurnsForExtraction();
        }
        await captureSnapshot(phase);
        break;
      }

      const stepSize = Math.max(700, Math.min(1400, before.height * 0.9));
      const nextTop = Math.min(maxTop, before.top + stepSize);
      setScrollTop(scroller, nextTop);
      await wait(250);

      const count = mergeMessageSnapshots(snapshots).length;
      const afterTop = scrollMetrics(scroller).top;
      const moved = afterTop > before.top + 2;
      const foundNewMessages = count > lastCount;

      if (foundNewMessages) {
        stagnantSteps = 0;
        lastCount = count;
      } else if (moved) {
        stagnantSteps += 1;
      } else {
        stagnantSteps += 2;
      }

      if (stagnantSteps >= 32 && scrollMetrics(scroller).top >= maxTop - before.height * 2) break;
    }
  }

  try {
    updateButton(button, `Loading full chat... ${bestCount} messages`, true);
    await waitForScrollSettle(scroller, 0, 2);
    await captureSnapshot('Scanning chat');
    await sweepDown('Scanning chat');
  } finally {
    setScrollTop(scroller, originalTop);
  }

  const messages = mergeMessageSnapshots(snapshots);
  const mergedCount = messages.length;
  const bestMessages = mergedCount >= basePayload.messages.length ? messages : basePayload.messages;

  return {
    ...basePayload,
    messages: bestMessages,
  };
}

async function state() {
  if (!isExtensionContextValid()) {
    throw new Error('Extension was reloaded. Refresh this ChatGPT tab and try again.');
  }

  try {
    const [localState, sessionState] = await Promise.all([
      chrome.storage.local.get(['environment', 'appBaseUrl', 'token', 'saveMode']),
      chrome.storage.session.get(['mekJwk']),
    ]);

    return {
      ...localState,
      mekJwk: sessionState.mekJwk,
    };
  } catch (error) {
    throw extensionContextError(error);
  }
}

function messageText(message) {
  if (Array.isArray(message.content)) return message.content.join('\n');
  return message.content || '';
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) return value || '';
  return `${value.slice(0, maxLength).trim()}…`;
}

function buildEncryptedHeaderPayload(payload, project = null) {
  const messageTexts = payload.messages.map(messageText).filter(Boolean);
  const searchText = messageTexts.join('\n\n');

  return {
    version: 2,
    provider: payload.provider,
    title: payload.title,
    sourceUrl: payload.sourceUrl,
    capturedAt: payload.capturedAt,
    project: project || null,
    tags: [],
    messageCount: payload.messages.length,
    snippet: truncate(messageTexts[0] || '', 280),
    searchText: truncate(searchText, 20000),
  };
}

function buildEncryptedBodyPayload(payload) {
  return {
    version: 2,
    provider: payload.provider,
    title: payload.title,
    sourceUrl: payload.sourceUrl,
    capturedAt: payload.capturedAt,
    messages: payload.messages,
  };
}

function updateButton(button, text, disabled = false) {
  if (!button) return;
  button.textContent = text;
  button.disabled = disabled;
}

async function saveConversation(button = null, options = {}) {
  if (!isExtensionContextValid()) {
    const error = new Error('Extension was reloaded. Refresh this ChatGPT tab and try again.');
    updateButton(button, 'Refresh page', false);
    throw error;
  }

  const current = await state();

  if (!current.token) {
    updateButton(button, 'Connect Memoriq first');
    setTimeout(() => updateButton(button, 'Save to Memoriq'), 2200);
    if (!button) throw new Error('Connect Memoriq first.');
    return;
  }

  if (!current.mekJwk) {
    updateButton(button, 'Unlock in extension');
    setTimeout(() => updateButton(button, 'Save to Memoriq'), 2200);
    if (!button) throw new Error('Unlock your vault in the extension first.');
    return;
  }

  updateButton(button, 'Scanning chat...', true);

  try {
    const payload = await extractMessagesAcrossScroll(button);
    updateButton(button, 'Encrypting...', true);
    const mek = await MemoriqCrypto.importMEK(current.mekJwk);
    const encryptedHeader = await MemoriqCrypto.encryptJson(buildEncryptedHeaderPayload(payload, options.project), mek);
    const encryptedBody = await MemoriqCrypto.encryptJson(buildEncryptedBodyPayload(payload), mek);

    const response = await chrome.runtime.sendMessage({
      type: 'SAVE_MEMORIQ_CONVERSATION',
      payload: {
        encrypted_header: encryptedHeader,
        encrypted_body: encryptedBody,
      },
    });

    if (!response?.ok) {
      console.error('Memoriq save failed', response);
      updateButton(button, 'Save failed', false);
      setTimeout(() => updateButton(button, 'Save to Memoriq'), 2600);
      throw new Error(response?.error || `Save failed${response?.status ? ` (${response.status})` : ''}.`);
    }

    updateButton(button, 'Saved to Memoriq ✓', true);
    setTimeout(() => updateButton(button, 'Save to Memoriq'), 2600);
    return { ok: true, title: payload.title };
  } catch (error) {
    const normalized = extensionContextError(error);
    console.error(normalized);
    updateButton(
      button,
      normalized.message.includes('reloaded') ? 'Refresh page' : 'Save failed',
      false,
    );
    setTimeout(() => updateButton(button, 'Save to Memoriq'), 2600);
    throw normalized;
  }
}

async function syncButtonVisibility() {
  if (!isExtensionContextValid()) return;

  let current;
  try {
    current = await state();
  } catch {
    return;
  }

  const existing = document.querySelector('.memoriq-save-button');

  if ((current.saveMode || 'page_button') !== 'page_button') {
    existing?.remove();
    return;
  }

  if (existing) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'memoriq-save-button';
  button.textContent = 'Save to Memoriq';
  button.addEventListener('click', () => saveConversation(button));
  document.documentElement.appendChild(button);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'MEMORIQ_SAVE_FROM_POPUP') return false;

  saveConversation(null, { project: message.project || null })
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || 'Save failed.' }));

  return true;
});

syncButtonVisibility().catch(() => {});
new MutationObserver(() => {
  syncButtonVisibility().catch(() => {});
}).observe(document.documentElement, { childList: true, subtree: true });

if (isExtensionContextValid()) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.saveMode) syncButtonVisibility().catch(() => {});
  });
}
