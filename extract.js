const CONTENT_SELECTORS = [
  '[data-message-content]',
  '.standard-markdown',
  '.progressive-markdown',
  '.markdown',
  '.prose',
  '[class*="markdown"]',
  '.font-claude-response',
  '.model-response-text',
  '.message-content',
  '.whitespace-pre-wrap',
];

const CONTENT_SELECTOR = CONTENT_SELECTORS.join(', ');
const RICH_CONTENT_SELECTOR = 'img, picture, [style*="background-image" i], [data-testid*="artifact" i], [class*="artifact" i], [id*="artifact" i], iframe, canvas, object, embed, audio, video, [class*="chart" i], [class*="diagram" i], [class*="mermaid" i], [class*="recharts" i]';

function findContentNode(turnEl) {
  const contentNodes = [...turnEl.querySelectorAll(CONTENT_SELECTOR)]
    .filter((node) => cleanText(node.innerText || node.textContent).length > 0);

  for (const selector of CONTENT_SELECTORS) {
    const node = turnEl.querySelector(selector);
    if (node && cleanText(node.innerText || node.textContent).length > 0) {
      return node;
    }
  }

  if (contentNodes.length === 1) return contentNodes[0];

  return turnEl;
}

function findGeminiContentNode(turnEl, role = null) {
  const selectors = role === 'user'
    ? [
      '.query-text-line',
      '.query-text',
      'user-query-content .query-text',
      '.user-query-bubble-with-background .query-text',
    ]
    : [
      'message-content.model-response-text',
      '.model-response-text',
      'message-content',
      '.markdown',
      '[class*="markdown"]',
      '.message-content',
    ];

  const contentNodes = [];

  for (const selector of selectors) {
    turnEl.querySelectorAll(selector).forEach((node) => {
      const text = cleanText(node.innerText || node.textContent);
      if (text.length > 0) contentNodes.push(node);
    });
  }

  if (contentNodes.length) {
    return contentNodes.sort((a, b) => {
      const aLen = cleanText(a.innerText || a.textContent).length;
      const bLen = cleanText(b.innerText || b.textContent).length;
      return bLen - aLen;
    })[0];
  }

  for (const selector of selectors) {
    const node = turnEl.matches(selector) ? turnEl : turnEl.querySelector(selector);
    if (node && cleanText(node.innerText || node.textContent).length > 0) {
      return node;
    }
  }

  return findContentNode(turnEl);
}

function findClaudeContentNode(turnEl, role) {
  const selectors = role === 'user'
    ? [
      '[data-testid="user-message"] p.whitespace-pre-wrap',
      '[data-testid="human-message"] p.whitespace-pre-wrap',
      '[data-testid="user-message"]',
      '[data-testid="human-message"]',
    ]
    : [
      '.standard-markdown',
      '.progressive-markdown',
      '.font-claude-response-body',
      '.font-claude-response .markdown',
      '[class*="markdown"]',
    ];

  const contentNodes = [];

  for (const selector of selectors) {
    turnEl.querySelectorAll(selector).forEach((node) => {
      const text = cleanText(node.innerText || node.textContent);
      if (text.length > 0 && !isClaudeArtifactLabelBlock(text)) contentNodes.push(node);
    });
  }

  if (contentNodes.length) {
    return contentNodes.sort((a, b) => {
      const aLen = cleanText(a.innerText || a.textContent).length;
      const bLen = cleanText(b.innerText || b.textContent).length;
      return bLen - aLen;
    })[0];
  }

  return findContentNode(turnEl);
}

function findGrokContentNode(turnEl, role) {
  const selectors = role === 'user'
    ? [
      '[data-testid="user-message"] .response-content-markdown',
      '[data-testid="user-message"] .markdown',
      '[data-testid="user-message"]',
    ]
    : [
      '[data-testid="assistant-message"] .response-content-markdown',
      '[data-testid="assistant-message"] .markdown',
      '[data-testid="assistant-message"]',
    ];

  for (const selector of selectors) {
    const node = turnEl.matches(selector) ? turnEl : turnEl.querySelector(selector);
    if (!node) continue;

    const clone = node.cloneNode(true);
    stripGrokThinkingBlocks(clone);
    const text = cleanText(clone.innerText || clone.textContent);
    if (text.length > 0) return node;
  }

  return findContentNode(turnEl);
}

function getClaudeMessageNodes() {
  const nodes = [];

  document.querySelectorAll('[data-testid="user-message"], [data-testid="human-message"]').forEach((el) => {
    nodes.push({ el, role: 'user' });
  });

  document.querySelectorAll('.font-claude-response, [data-testid="ai-message"]').forEach((el) => {
    if (el.closest('[data-testid="user-message"], [data-testid="human-message"]')) return;
    nodes.push({ el, role: 'assistant' });
  });

  const deduped = nodes.filter((entry, index, list) => !list.some((other, otherIndex) => {
    if (otherIndex === index) return false;
    return other.el !== entry.el && other.el.contains(entry.el);
  }));

  deduped.sort((a, b) => compareDomOrder(a.el, b.el));
  return deduped;
}

function getGrokMessageNodes() {
  const testIdNodes = [
    ...document.querySelectorAll('[data-testid="user-message"]'),
    ...document.querySelectorAll('[data-testid="assistant-message"]'),
  ].map((el) => ({
    el,
    role: el.getAttribute('data-testid') === 'user-message' ? 'user' : 'assistant',
  }));

  if (testIdNodes.length) {
    testIdNodes.sort((a, b) => compareDomOrder(a.el, b.el));
    return testIdNodes;
  }

  return [];
}

function stripUiFromClone(root) {
  root.querySelectorAll('button').forEach((button) => {
    const hasImage = button.matches('picture, [style*="background-image" i]')
      || button.querySelector('img, picture, [style*="background-image" i]');

    if (hasImage) {
      replaceElementWithPlaceholder(button, 'image');
    } else {
      button.remove();
    }
  });
  root.querySelectorAll('input, textarea, select, script, style, noscript').forEach((el) => el.remove());
  root.querySelectorAll('[aria-label*="Copy" i], [data-testid*="copy" i], [class*="copy" i]').forEach((el) => {
    if (el.tagName === 'BUTTON' || el.closest('button')) el.remove();
  });
}

function isInsideMessageBody(element) {
  return !!element.closest(
    '[data-message-author-role], [data-message-content], [data-conversation-screenshot-content], [data-testid*="conversation-turn"], [data-turn]',
  );
}

function stripHiddenAndChrome(root) {
  root.querySelectorAll('[aria-hidden="true"], [hidden]').forEach((el) => {
    if (isInsideMessageBody(el)) return;
    el.remove();
  });

  root.querySelectorAll('[role="toolbar"], [role="menu"], [role="tooltip"], mat-menu, mat-tooltip-component').forEach((el) => {
    el.remove();
  });

  root.querySelectorAll('[data-testid*="toolbar" i], [data-testid*="actions" i], [data-testid*="feedback" i], [aria-label*="copy" i], [aria-label*="share" i], [aria-label*="more" i]').forEach((el) => {
    el.remove();
  });

  root.querySelectorAll('*').forEach((el) => {
    const style = el.getAttribute('style') || '';
    if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0/i.test(style)) {
      el.remove();
    }
  });
}

function isClaudeArtifactLabel(text) {
  const normalized = cleanText(text || '');
  if (!normalized) return false;

  return normalized === 'V'
    || /^visualize\s+show_widget$/i.test(normalized)
    || /^show_widget$/i.test(normalized)
    || /^connecting to visualize/i.test(normalized);
}

function isClaudeArtifactLabelBlock(text) {
  const lines = (text || '').split('\n').map((line) => cleanText(line)).filter(Boolean);
  if (!lines.length) return false;

  return lines.every((line) => isClaudeArtifactLabel(line));
}

function isProviderSpeakerLabel(text) {
  return /^(you|gemini|grok|chatgpt)\s+said:?$/i.test(cleanText(text || ''));
}

function stripProviderSpeakerLabels(root) {
  root.querySelectorAll('.cdk-visually-hidden, .screen-reader-user-query-label, [class*="screen-reader-user-query"]').forEach((element) => {
    element.remove();
  });

  root.querySelectorAll('p, div, span, h1, h2, h3, h4, h5, h6').forEach((element) => {
    if (element.closest('.memoriq-rich-placeholder')) return;
    if (element.children.length) return;
    if (isProviderSpeakerLabel(element.textContent)) {
      element.remove();
    }
  });

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];

  let node = walker.nextNode();
  while (node) {
    textNodes.push(node);
    node = walker.nextNode();
  }

  textNodes.forEach((textNode) => {
    const value = textNode.nodeValue || '';
    const cleaned = value
      .replace(/^\s*(?:You|Gemini|Grok|ChatGPT)\s+said:?\s*$/gim, '')
      .replace(/\n{3,}/g, '\n\n');

    if (cleaned.trim()) {
      textNode.nodeValue = cleaned;
    } else if (isProviderSpeakerLabel(value)) {
      textNode.remove();
    }
  });
}

function stripGrokThinkingBlocks(root) {
  root.querySelectorAll('.thinking-container, [class*="thinking-container"]').forEach((element) => {
    element.remove();
  });
}

function stripClaudeArtifactLabels(root) {
  root.querySelectorAll('[class*="visualize" i], [class*="show_widget" i], [data-testid*="visualize" i], [data-testid*="show_widget" i]').forEach((element) => {
    if (element.closest('.memoriq-rich-placeholder')) return;
    if (isClaudeArtifactLabel(element.textContent) || element.querySelector('iframe, canvas, object, embed')) {
      element.remove();
    }
  });

  root.querySelectorAll('p, div, span, pre, code, li, h1, h2, h3, h4, h5, h6').forEach((element) => {
    if (element.closest('.memoriq-rich-placeholder')) return;
    if (element.querySelector('.memoriq-rich-placeholder, table, pre code, img')) return;

    const ownText = cleanText(
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && !node.querySelector('.memoriq-rich-placeholder, iframe, img, table')))
        .map((node) => node.textContent || '')
        .join(''),
    );

    if (isClaudeArtifactLabel(ownText) || isClaudeArtifactLabelBlock(ownText)) {
      element.remove();
    }
  });

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];

  let node = walker.nextNode();
  while (node) {
    textNodes.push(node);
    node = walker.nextNode();
  }

  textNodes.forEach((textNode) => {
    const value = textNode.nodeValue || '';
    const cleaned = value
      .replace(/^\s*V\s*$/gm, '')
      .replace(/\bconnecting to visualize\.{0,3}\b/gi, '')
      .replace(/\bvisualize\s+show_widget\b/gi, '')
      .replace(/\bshow_widget\b/gi, '')
      .replace(/\n{3,}/g, '\n\n');

    if (cleaned.trim()) {
      textNode.nodeValue = cleaned;
    } else {
      textNode.remove();
    }
  });

  root.querySelectorAll('p, div, span').forEach((element) => {
    if (element.closest('.memoriq-rich-placeholder')) return;
    if (element.children.length) return;
    if (!cleanText(element.textContent)) {
      element.remove();
    }
  });
}

function richTypeForElement(element) {
  const tag = element.tagName.toLowerCase();
  const descriptor = [
    element.getAttribute('data-testid'),
    element.getAttribute('aria-label'),
    element.getAttribute('class'),
    element.getAttribute('id'),
  ].filter(Boolean).join(' ').toLowerCase();

  if (tag === 'img' || tag === 'picture') return 'image';
  if ((element.getAttribute('style') || '').toLowerCase().includes('background-image')) return 'image';
  if (tag === 'audio') return 'audio file';
  if (tag === 'video') return 'video';
  if (tag === 'iframe') return descriptor.includes('artifact') ? 'interactive artifact' : 'embedded frame';
  if (tag === 'canvas') return 'canvas graphic';
  if (tag === 'object' || tag === 'embed') return 'embedded content';
  if (tag === 'svg') return 'svg graphic';
  if (descriptor.includes('artifact')) return 'interactive artifact';
  if (descriptor.includes('chart') || descriptor.includes('graph') || descriptor.includes('recharts')) return 'chart';
  if (descriptor.includes('diagram') || descriptor.includes('mermaid')) return 'diagram';

  return '';
}

function createRichPlaceholder(documentRef, type, label = '') {
  const placeholder = documentRef.createElement('div');
  placeholder.className = 'memoriq-rich-placeholder';
  placeholder.setAttribute('data-memoriq-rich-type', type);
  placeholder.textContent = label || `Rich content placeholder: ${type}`;
  return placeholder;
}

function replaceElementWithPlaceholder(element, type) {
  const text = cleanText(element.innerText || element.textContent || '');
  const label = text
    ? `Rich content placeholder: ${type} (${text.slice(0, 140)})`
    : `Rich content placeholder: ${type}`;
  element.replaceWith(createRichPlaceholder(element.ownerDocument, type, label));
}

function insertPlaceholderBefore(element, type) {
  const placeholder = createRichPlaceholder(element.ownerDocument, type);
  element.parentNode?.insertBefore(placeholder, element);
}

function replaceUnsupportedRichContent(root) {
  root.querySelectorAll('img, picture, [style*="background-image" i]').forEach((element) => {
    if (element.closest('.memoriq-rich-placeholder')) return;

    const alt = element.getAttribute('alt') || element.getAttribute('aria-label') || '';
    const label = alt ? `Rich content placeholder: image (${alt.slice(0, 140)})` : 'Rich content placeholder: image';
    element.replaceWith(createRichPlaceholder(element.ownerDocument, 'image', label));
  });

  root.querySelectorAll('[data-testid*="artifact" i], [class*="artifact" i], [id*="artifact" i], iframe, canvas, object, embed, audio, video').forEach((element) => {
    const type = richTypeForElement(element) || 'rich content';
    replaceElementWithPlaceholder(element, type);
  });

  root.querySelectorAll('svg').forEach((element) => {
    if (element.closest('button, a')) return;
    const text = cleanText(element.textContent || '');
    if (text.length < 3) {
      replaceElementWithPlaceholder(element, richTypeForElement(element) || 'svg graphic');
    }
  });

  root.querySelectorAll('[class*="chart" i], [class*="diagram" i], [class*="mermaid" i], [class*="recharts" i]').forEach((element) => {
    if (element.closest('.memoriq-rich-placeholder, table, pre, code')) return;
    const type = richTypeForElement(element) || 'rich content';
    const text = cleanText(element.innerText || element.textContent || '');

    if (!text || element.querySelector('canvas, svg, iframe')) {
      replaceElementWithPlaceholder(element, type);
    } else if (!element.querySelector('.memoriq-rich-placeholder')) {
      insertPlaceholderBefore(element, type);
    }
  });
}

function absolutizeUrls(root) {
  root.querySelectorAll('a[href]').forEach((anchor) => {
    try {
      anchor.href = new URL(anchor.getAttribute('href'), window.location.href).href;
    } catch {
      anchor.removeAttribute('href');
    }
  });

  root.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;

    try {
      img.src = new URL(src, window.location.href).href;
    } catch {
      replaceElementWithPlaceholder(img, 'image');
    }
  });

  root.querySelectorAll('source[src]').forEach((source) => {
    const src = source.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;

    try {
      source.src = new URL(src, window.location.href).href;
    } catch {
      source.removeAttribute('src');
    }
  });
}

async function inlineImage(img) {
  const src = img.getAttribute('src') || '';
  if (!src.startsWith('blob:')) return;

  try {
    const response = await fetch(src);
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    img.setAttribute('src', dataUrl);
  } catch {
    replaceElementWithPlaceholder(img, 'image');
  }
}

async function inlineBlobImages(root) {
  await Promise.all([...root.querySelectorAll('img[src^="blob:"]')].map((img) => inlineImage(img)));
}

function preserveLineBreaks(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.includes('\n')) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest('pre, code, script, style, .memoriq-rich-placeholder')) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes = [];

  let node = walker.nextNode();
  while (node) {
    textNodes.push(node);
    node = walker.nextNode();
  }

  textNodes.forEach((textNode) => {
    const parts = textNode.nodeValue.split('\n');
    const fragment = document.createDocumentFragment();

    parts.forEach((part, index) => {
      if (index > 0) fragment.appendChild(document.createElement('br'));
      if (part) fragment.appendChild(document.createTextNode(part));
    });

    textNode.replaceWith(fragment);
  });
}

async function serializeContentHtml(contentEl, { preserveNewlines = false } = {}) {
  const clone = contentEl.cloneNode(true);
  stripHiddenAndChrome(clone);
  stripUiFromClone(clone);
  stripProviderSpeakerLabels(clone);
  stripClaudeArtifactLabels(clone);
  stripGrokThinkingBlocks(clone);
  replaceUnsupportedRichContent(clone);
  stripProviderSpeakerLabels(clone);
  stripClaudeArtifactLabels(clone);
  stripGrokThinkingBlocks(clone);
  absolutizeUrls(clone);
  await inlineBlobImages(clone);
  if (preserveNewlines) preserveLineBreaks(clone);
  const html = clone.innerHTML.trim();
  return html || null;
}

async function buildMessage(role, contentEl) {
  const html = await serializeContentHtml(contentEl, { preserveNewlines: role === 'user' });
  const documentRef = document.implementation.createHTMLDocument('');
  const container = documentRef.createElement('div');
  container.innerHTML = html || '';
  const content = cleanText(container.innerText || container.textContent || contentEl.innerText || contentEl.textContent);

  if (!content && !html) return null;

  return {
    role,
    content,
    html: html || undefined,
    format: html ? 'html' : 'text',
  };
}

async function buildLeanMessage(role, contentEl) {
  const message = await buildMessage(role, contentEl);
  if (!message?.html || !message.content) return message;

  const visibleLength = message.content.length;
  const htmlLength = message.html.length;
  const bloatedHtml = visibleLength > 0 && htmlLength > Math.max(12000, visibleLength * 4);

  if (!bloatedHtml) return message;

  return {
    role,
    content: message.content,
    format: 'text',
  };
}

function compareDomOrder(a, b) {
  const position = a.compareDocumentPosition(b);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function hasRichContent(element) {
  return !!element.querySelector(RICH_CONTENT_SELECTOR);
}

function richPlaceholderLabel(element, type) {
  const alt = element.getAttribute('alt') || element.getAttribute('aria-label') || '';
  const text = cleanText(element.innerText || element.textContent || '');
  const detail = alt || text;

  return detail
    ? `Rich content placeholder: ${type} (${detail.slice(0, 140)})`
    : `Rich content placeholder: ${type}`;
}

function richPlaceholderMessage(type, label) {
  const documentRef = document.implementation.createHTMLDocument('');
  const placeholder = createRichPlaceholder(documentRef, type, label);

  return {
    role: 'assistant',
    content: placeholder.textContent,
    html: placeholder.outerHTML,
    format: 'html',
  };
}

function isVisibleRichElement(element) {
  const rect = element.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return false;

  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getChatGptTurnElements() {
  const turnSelectors = [
    '[data-testid^="conversation-turn-"]',
    '[data-testid*="conversation-turn"]',
  ];

  for (const selector of turnSelectors) {
    const turns = [...document.querySelectorAll(selector)]
      .filter((turn, index, list) => !list.some((other, otherIndex) => otherIndex !== index && other.contains(turn)));

    if (turns.length) return turns;
  }

  return [...document.querySelectorAll('[data-message-author-role]')]
    .filter((turn, index, list) => !list.some((other, otherIndex) => otherIndex !== index && other.contains(turn)));
}

const CHATGPT_USER_CONTENT_SELECTORS = [
  '[data-message-author-role="user"] .whitespace-pre-wrap',
  '.user-message-bubble-color .whitespace-pre-wrap',
  '[data-message-author-role="user"] [class*="overflow-wrap"]',
  '[data-message-author-role="user"]',
];

const CHATGPT_ASSISTANT_CONTENT_SELECTORS = [
  '[data-message-author-role="assistant"] .markdown',
  '[data-message-author-role="assistant"] [class*="markdown"]',
  '.agent-turn .markdown',
  '[data-message-author-role="assistant"]',
];

function chatGptRoleForTurn(turnEl, index) {
  const dataTurn = turnEl.getAttribute('data-turn');
  if (dataTurn === 'user' || dataTurn === 'assistant') return dataTurn;

  const roleEl = turnEl.matches('[data-message-author-role]')
    ? turnEl
    : turnEl.querySelector('[data-message-author-role]');
  const roleAttr = roleEl?.getAttribute('data-message-author-role');
  if (roleAttr === 'user' || roleAttr === 'assistant') return roleAttr;

  return index % 2 === 0 ? 'user' : 'assistant';
}

function chatGptContentSelectors(role) {
  if (role === 'user') return CHATGPT_USER_CONTENT_SELECTORS;
  if (role === 'assistant') return CHATGPT_ASSISTANT_CONTENT_SELECTORS;
  return CONTENT_SELECTORS;
}

function chatGptTurnTextLength(turnEl, role) {
  const node = findChatGptContentNode(turnEl, role);
  return cleanText(node.innerText || node.textContent).length;
}

function findChatGptContentNode(turnEl, role) {
  const selectors = chatGptContentSelectors(role);
  const contentNodes = [];
  const seen = new Set();

  for (const selector of selectors) {
    turnEl.querySelectorAll(selector).forEach((node) => {
      if (seen.has(node)) return;
      seen.add(node);

      const text = cleanText(node.innerText || node.textContent);
      if (text.length > 0) contentNodes.push(node);
    });
  }

  if (!contentNodes.length) {
    turnEl.querySelectorAll(CONTENT_SELECTOR).forEach((node) => {
      if (seen.has(node)) return;
      seen.add(node);

      const text = cleanText(node.innerText || node.textContent);
      if (text.length > 0) contentNodes.push(node);
    });
  }

  if (!contentNodes.length) {
    const roleEl = turnEl.querySelector('[data-message-author-role]');
    return roleEl || turnEl;
  }

  return contentNodes.sort((a, b) => {
    const aLen = cleanText(a.innerText || a.textContent).length;
    const bLen = cleanText(b.innerText || b.textContent).length;
    return bLen - aLen;
  })[0];
}

async function prepareChatGptTurnsForExtraction() {
  setScrollTopForChatGpt(0);
  await waitMs(300);

  for (let pass = 0; pass < 4; pass += 1) {
    const turns = getChatGptTurnElements();
    let emptyTurns = 0;

    for (const [index, turn] of turns.entries()) {
      turn.scrollIntoView({ block: 'start', behavior: 'auto' });
      await waitMs(80);

      const role = chatGptRoleForTurn(turn, index);
      if (chatGptTurnTextLength(turn, role) === 0) {
        emptyTurns += 1;
        await waitMs(220);
      }
    }

    setScrollTopForChatGpt(Number.MAX_SAFE_INTEGER);
    await waitMs(200);
    setScrollTopForChatGpt(0);
    await waitMs(200);

    if (emptyTurns === 0) break;
  }
}

function setScrollTopForChatGpt(top) {
  const candidates = [
    document.querySelector('main [class*="thread"]'),
    document.querySelector('main'),
    document.scrollingElement,
    document.documentElement,
  ].filter(Boolean);

  for (const scroller of candidates) {
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextTop = top === Number.MAX_SAFE_INTEGER ? maxTop : Math.min(top, maxTop);

    if (scroller === document.scrollingElement || scroller === document.documentElement) {
      window.scrollTo({ top: nextTop, behavior: 'auto' });
    } else {
      scroller.scrollTop = nextTop;
    }
  }
}

function collectChatGptExternalRichMessages(roleTurns) {
  const scope = document.querySelector('main') || document.body;
  const seenAnchors = new Set();

  return [...scope.querySelectorAll('img, picture, [style*="background-image" i]')]
    .filter((element) => !element.closest('[data-message-author-role]'))
    .filter(isVisibleRichElement)
    .map((element) => {
      const anchor = element.closest('[data-testid^="conversation-turn-"], [data-testid*="conversation-turn"]') || element;
      if (seenAnchors.has(anchor)) return null;
      seenAnchors.add(anchor);

      let insertAfter = -1;
      roleTurns.forEach((turn, index) => {
        const position = turn.compareDocumentPosition(anchor);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
          insertAfter = index;
        }
      });

      return {
        insertAfter,
        message: richPlaceholderMessage('image', richPlaceholderLabel(element, 'image')),
      };
    })
    .filter(Boolean);
}

function chatGptConversationIdFromUrl(url = window.location.href) {
  const match = url.match(/\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match?.[1] || null;
}

function extractChatGptApiMessageText(content) {
  if (!content) return '';

  if (typeof content === 'string') return cleanText(content);

  if (typeof content.text === 'string') return cleanText(content.text);

  const parts = content.parts;
  if (!Array.isArray(parts)) return '';

  return cleanText(parts.map((part) => {
    if (typeof part === 'string') return part;
    if (typeof part?.text === 'string') return part.text;
    if (typeof part?.content === 'string') return part.content;
    return '';
  }).filter(Boolean).join('\n'));
}

function parseChatGptApiConversation(data) {
  const mapping = data?.mapping;
  const currentNode = data?.current_node;
  if (!mapping || !currentNode || !mapping[currentNode]) return null;

  const messages = [];
  let nodeId = currentNode;

  while (nodeId && mapping[nodeId]) {
    const node = mapping[nodeId];
    const msg = node.message;

    const role = msg?.author?.role || msg?.role;
    if (msg?.content && role && !msg.metadata?.is_visually_hidden_from_conversation) {
      if (role === 'user' || role === 'assistant') {
        const content = extractChatGptApiMessageText(msg.content);
        if (content) messages.push({ role, content, format: 'text' });
      }
    }

    nodeId = node.parent;
  }

  if (!messages.length) return null;

  return {
    title: cleanText(data.title || ''),
    messages: messages.reverse(),
  };
}

async function chatGptAccessToken() {
  try {
    const response = await fetch('/api/auth/session', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;

    const data = await response.json();
    return data?.accessToken || data?.user?.accessToken || null;
  } catch {
    return null;
  }
}

async function extractChatGptFromApi() {
  const conversationId = chatGptConversationIdFromUrl();
  if (!conversationId) return null;

  try {
    const token = await chatGptAccessToken();
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Referer: window.location.href,
    };

    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`/backend-api/conversation/${conversationId}`, {
      method: 'GET',
      credentials: 'include',
      headers,
    });

    if (!response.ok) return null;

    const data = await response.json();
    return parseChatGptApiConversation(data);
  } catch {
    return null;
  }
}

async function extractChatGpt(options = {}) {
  if (options.prepareChatGptTurns) {
    await prepareChatGptTurnsForExtraction();
  }

  const turns = getChatGptTurnElements();
  if (!turns.length) return null;

  const messages = [];

  for (const [index, turn] of turns.entries()) {
    const role = chatGptRoleForTurn(turn, index);
    if (role !== 'user' && role !== 'assistant') continue;

    const contentEl = findChatGptContentNode(turn, role);
    const message = await buildMessage(role, contentEl);
    if (message) messages.push(message);
  }

  collectChatGptExternalRichMessages(turns)
    .sort((a, b) => a.insertAfter - b.insertAfter)
    .forEach((entry, offset) => {
      messages.splice(entry.insertAfter + 1 + offset, 0, entry.message);
    });

  return messages.length ? messages : null;
}

async function extractClaude() {
  const nodes = getClaudeMessageNodes();
  if (!nodes.length) return null;

  const messages = [];
  const seen = new Set();

  for (const { el, role } of nodes) {
    if (seen.has(el)) continue;
    seen.add(el);

    const contentEl = findClaudeContentNode(el, role);
    const message = await buildMessage(role, contentEl);
    if (message) messages.push(message);
  }

  return messages.length ? messages : null;
}

async function extractGemini() {
  const nodes = [];
  const seenContentNodes = new Set();
  const seenMessageKeys = new Set();

  function addNode(el, role) {
    const contentEl = findGeminiContentNode(el, role);
    const text = cleanText(contentEl.innerText || contentEl.textContent);
    if (!text) return;

    const key = `${role}\n${text.slice(0, 2000)}`;
    if (seenContentNodes.has(contentEl) || seenMessageKeys.has(key)) return;

    seenContentNodes.add(contentEl);
    seenMessageKeys.add(key);
    nodes.push({ el, contentEl, role });
  }

  [...document.querySelectorAll('user-query, .user-query, [data-testid="user-query"]')]
    .forEach((el) => addNode(el, 'user'));

  [...document.querySelectorAll('model-response, .model-response')]
    .filter((el, index, list) => !list.some((other, otherIndex) => otherIndex !== index && other.contains(el)))
    .forEach((el) => addNode(el, 'assistant'));

  if (!nodes.some((entry) => entry.role === 'assistant')) {
    [...document.querySelectorAll('message-content.model-response-text, .model-response-text')]
      .forEach((el) => addNode(el, 'assistant'));
  }

  if (!nodes.length) {
    const fallback = [...document.querySelectorAll('[data-message-author-role], article')];
    if (!fallback.length) return null;

    const messages = [];
    for (const el of fallback) {
      const roleAttr = el.getAttribute('data-message-author-role');
      const role = roleAttr === 'user' ? 'user' : roleAttr === 'assistant' ? 'assistant' : messages.length % 2 === 0 ? 'user' : 'assistant';
      const contentEl = findGeminiContentNode(el, role);
      const message = await buildLeanMessage(role, contentEl);
      if (message) messages.push(message);
    }

    return messages.length ? messages : null;
  }

  nodes.sort((a, b) => compareDomOrder(a.el, b.el));

  const messages = [];
  const seen = new Set();

  for (const { el, contentEl, role } of nodes) {
    if (seen.has(el)) continue;
    seen.add(el);

    const message = await buildLeanMessage(role, contentEl);
    if (message) messages.push(message);
  }

  return messages.length ? messages : null;
}

function grokRoleForElement(element, fallbackIndex) {
  const descriptor = [
    element.getAttribute('data-message-author-role'),
    element.getAttribute('data-testid'),
    element.getAttribute('aria-label'),
    element.getAttribute('class'),
  ].filter(Boolean).join(' ').toLowerCase();

  if (/(user|human|you)/i.test(descriptor)) return 'user';
  if (/(assistant|model|response|grok|ai)/i.test(descriptor)) return 'assistant';

  return fallbackIndex % 2 === 0 ? 'user' : 'assistant';
}

async function extractGrok() {
  let nodes = getGrokMessageNodes();

  if (!nodes.length) {
    const candidates = [
      '[data-message-author-role]',
      '[data-testid*="message" i]',
      '[data-testid*="conversation" i]',
      '[class*="message" i]',
      'article',
      'main [role="listitem"]',
    ];
    const seen = new Set();

    for (const selector of candidates) {
      document.querySelectorAll(selector).forEach((el) => {
        if (seen.has(el)) return;
        if (nodes.some((entry) => entry.el.contains(el))) return;
        if (cleanText(el.innerText || el.textContent).length < 2) return;

        seen.add(el);
        nodes.push({ el, role: grokRoleForElement(el, nodes.length) });
      });

      if (nodes.length >= 2) break;
    }

    nodes.sort((a, b) => compareDomOrder(a.el, b.el));
  }

  if (!nodes.length) return null;

  const messages = [];
  for (const { el, role } of nodes) {
    const contentEl = findGrokContentNode(el, role);
    const message = await buildMessage(role, contentEl);
    if (message) messages.push(message);
  }

  return messages.length ? messages : null;
}

async function extractMessagesRich(provider, options = {}) {
  if (provider === 'chatgpt') return (await extractChatGpt(options)) || (await extractClaude());
  if (provider === 'claude') return (await extractClaude()) || (await extractChatGpt());
  if (provider === 'gemini') return (await extractGemini()) || (await extractChatGpt());
  if (provider === 'grok') return (await extractGrok()) || (await extractChatGpt());
  return (await extractChatGpt()) || (await extractClaude()) || (await extractGemini());
}
