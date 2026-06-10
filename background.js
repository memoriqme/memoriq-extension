const BASE_URLS = {
  local: 'http://memoriq.local',
  production: 'https://memoriq.me',
};

const ALLOWED_APP_BASE_URLS = new Set(Object.values(BASE_URLS));

function urlFromSender(sender) {
  return sender?.tab?.url || sender?.url || '';
}

function isAllowedConnectUrl(url = '') {
  return /^https?:\/\/memoriq\.local\/extension\/connect(?:[?#].*)?$/i.test(url)
    || /^https:\/\/memoriq\.me\/extension\/connect(?:[?#].*)?$/i.test(url);
}

function isSupportedChatUrl(url = '') {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|grok\.com)\//i.test(url)
    || /^https:\/\/x\.com\/(i\/grok|grok)/i.test(url);
}

function environmentForBaseUrl(appBaseUrl) {
  return Object.entries(BASE_URLS).find(([, value]) => value === appBaseUrl)?.[0] || null;
}

if (chrome.storage.session?.setAccessLevel) {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'MEMORIQ_TOKEN') {
    if (!isAllowedConnectUrl(urlFromSender(sender)) || !ALLOWED_APP_BASE_URLS.has(message.appBaseUrl)) {
      sendResponse({ ok: false, error: 'Invalid Memoriq connection source.' });
      return false;
    }

    chrome.storage.local.set({
      token: message.token,
      user: message.user,
      appBaseUrl: message.appBaseUrl,
      environment: environmentForBaseUrl(message.appBaseUrl),
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === 'SAVE_MEMORIQ_CONVERSATION') {
    if (!isSupportedChatUrl(urlFromSender(sender))) {
      sendResponse({ ok: false, error: 'Invalid chat page.' });
      return false;
    }

    chrome.storage.local.get(['environment', 'appBaseUrl', 'token']).then(async (state) => {
      const appBaseUrl = BASE_URLS[state.environment] || (ALLOWED_APP_BASE_URLS.has(state.appBaseUrl) ? state.appBaseUrl : BASE_URLS.production);

      try {
        const response = await fetch(`${appBaseUrl}/api/extension/conversations`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.token}`,
          },
          body: JSON.stringify(message.payload),
        });

        if (!response.ok) {
          sendResponse({ ok: false, status: response.status });
          return;
        }

        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    });
    return true;
  }

  return false;
});
