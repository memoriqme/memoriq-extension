function setStatus(text) {
  const status = document.getElementById('connectStatus');
  if (status) status.textContent = text;
}

function sendTokenToExtension(payload) {
  chrome.runtime.sendMessage({
    type: 'MEMORIQ_TOKEN',
    token: payload.token,
    user: payload.user,
    appBaseUrl: payload.appBaseUrl,
  }, (response) => {
    if (response?.ok) {
      setStatus('Connection saved. You can return to ChatGPT, Claude, Gemini, or Grok and save conversations.');
    } else {
      setStatus('Could not save the extension connection. Reload this page after reloading the extension.');
    }
  });
}

function readPayloadFromPage() {
  const payloadEl = document.getElementById('memoriq-extension-payload');
  if (!payloadEl) return null;

  try {
    const payload = JSON.parse(payloadEl.textContent);
    return payload?.type === 'MEMORIQ_EXTENSION_TOKEN' ? payload : null;
  } catch (error) {
    return null;
  }
}

const payload = readPayloadFromPage();
if (payload) {
  sendTokenToExtension(payload);
} else {
  setStatus('Could not find the extension connection token. Reload this page after reloading the extension.');
}
