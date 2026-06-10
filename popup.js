const BASE_URLS = {
  local: 'http://memoriq.local',
  production: 'https://memoriq.me',
};

const environment = document.getElementById('environment');
const statusEl = document.getElementById('status');
const connectBtn = document.getElementById('connect');
const openAppBtn = document.getElementById('openApp');
const forgetBtn = document.getElementById('forget');
const unlockForm = document.getElementById('unlockForm');
const passwordInput = document.getElementById('password');
const saveMode = document.getElementById('saveMode');
const projectSelect = document.getElementById('project');
const newProjectField = document.getElementById('newProjectField');
const newProjectInput = document.getElementById('newProject');
const saveChatBtn = document.getElementById('saveChat');
const quickSave = document.getElementById('quickSave');
const geminiNote = document.getElementById('geminiNote');

function selectedEnvironment(state = {}) {
  return state.environment || environment?.value || 'production';
}

function setStatus(text, mode = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${mode}`.trim();
}

async function getState() {
  const [localState, sessionState] = await Promise.all([
    chrome.storage.local.get(['environment', 'appBaseUrl', 'token', 'user', 'mekJwk', 'saveMode', 'preferredProject']),
    chrome.storage.session.get(['mekJwk']),
  ]);

  if (localState.mekJwk) {
    await chrome.storage.local.remove('mekJwk');
  }

  return {
    ...localState,
    mekJwk: sessionState.mekJwk,
  };
}

async function api(path, options = {}) {
  const state = await getState();
  const appBaseUrl = BASE_URLS[selectedEnvironment(state)];
  const response = await fetch(`${appBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${state.token}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

function appBaseUrlForState(state) {
  return BASE_URLS[selectedEnvironment(state)];
}

function cleanProjectName(value) {
  return (value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function selectedProject() {
  if (projectSelect.value === '__new__') return cleanProjectName(newProjectInput.value);
  return projectSelect.value || '';
}

async function loadProjects(state) {
  projectSelect.innerHTML = '<option value="">No project</option>';

  if (!state.token || !state.mekJwk) {
    projectSelect.insertAdjacentHTML('beforeend', '<option value="__new__">New project...</option>');
    return;
  }

  try {
    const mek = await MemoriqCrypto.importMEK(state.mekJwk);
    const { data } = await api('/api/conversations?per_page=50');
    const projects = new Set();

    for (const item of data || []) {
      try {
        const header = await MemoriqCrypto.decryptJson(item.encrypted_header, mek);
        if (header.project) projects.add(cleanProjectName(header.project));
      } catch {
        // Ignore headers that cannot be decrypted with the current key.
      }
    }

    [...projects].sort((a, b) => a.localeCompare(b)).forEach((project) => {
      const option = document.createElement('option');
      option.value = project;
      option.textContent = project;
      projectSelect.appendChild(option);
    });

    projectSelect.insertAdjacentHTML('beforeend', '<option value="__new__">New project...</option>');

    if (state.preferredProject && [...projectSelect.options].some((option) => option.value === state.preferredProject)) {
      projectSelect.value = state.preferredProject;
    } else if (state.preferredProject) {
      projectSelect.value = '__new__';
      newProjectInput.value = state.preferredProject;
    }

    toggleNewProjectField();
  } catch (error) {
    projectSelect.insertAdjacentHTML('beforeend', '<option value="__new__">New project...</option>');
  }
}

function toggleNewProjectField() {
  newProjectField.classList.toggle('hidden', projectSelect.value !== '__new__');
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isSupportedChatUrl(url = '') {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|grok\.com)\//i.test(url)
    || /^https:\/\/x\.com\/(i\/grok|grok)/i.test(url);
}

function isGeminiUrl(url = '') {
  return /^https:\/\/gemini\.google\.com\//i.test(url);
}

async function refresh() {
  const state = await getState();
  const tab = await activeTab();
  if (environment) {
    environment.value = selectedEnvironment(state);
  }
  saveMode.value = state.saveMode || 'page_button';
  projectSelect.value = state.preferredProject || '';
  newProjectInput.value = '';
  toggleNewProjectField();
  saveChatBtn.disabled = saveMode.value !== 'popup_button';
  quickSave.classList.toggle('hidden', saveMode.value !== 'popup_button');
  geminiNote.classList.toggle('hidden', !isGeminiUrl(tab?.url));
  await loadProjects(state);

  if (!state.token) {
    setStatus('Not connected. Log in through Memoriq first.', 'warn');
    connectBtn.classList.remove('hidden');
    quickSave.classList.add('hidden');
    unlockForm.classList.add('hidden');
    return;
  }

  connectBtn.classList.add('hidden');

  try {
    const data = await api('/api/extension/me');
    if (!data.encryptionConfigured) {
      setStatus('Connected, but set up encryption in the Memoriq dashboard before saving.', 'warn');
      quickSave.classList.add('hidden');
      unlockForm.classList.add('hidden');
      return;
    }

    if (state.mekJwk) {
      setStatus(`Ready to save as ${data.user.email}`, 'ok');
      unlockForm.classList.add('hidden');
    } else {
      setStatus('Connected. Unlock your vault to save chats.', 'warn');
      quickSave.classList.add('hidden');
      unlockForm.classList.remove('hidden');
    }
  } catch (error) {
    setStatus('Connection expired. Log in again.', 'warn');
    unlockForm.classList.add('hidden');
  }
}

if (environment) {
  environment.addEventListener('change', async () => {
    await chrome.storage.local.set({
      environment: environment.value,
      appBaseUrl: BASE_URLS[environment.value],
    });
    await refresh();
  });
}

saveMode.addEventListener('change', async () => {
  await chrome.storage.local.set({ saveMode: saveMode.value });
  saveChatBtn.disabled = saveMode.value !== 'popup_button';
  quickSave.classList.toggle('hidden', saveMode.value !== 'popup_button');
  setStatus(saveMode.value === 'popup_button' ? 'Click Save current chat from this popup.' : 'Use the floating button on supported chat pages.', 'ok');
});

projectSelect.addEventListener('change', async () => {
  toggleNewProjectField();
  await chrome.storage.local.set({ preferredProject: selectedProject() });
});

newProjectInput.addEventListener('input', async () => {
  await chrome.storage.local.set({ preferredProject: selectedProject() });
});

connectBtn.addEventListener('click', async () => {
  const env = selectedEnvironment(await getState());
  const appBaseUrl = BASE_URLS[env];
  await chrome.storage.local.set({ environment: env, appBaseUrl });
  chrome.tabs.create({ url: `${appBaseUrl}/extension/connect` });
});

openAppBtn.addEventListener('click', async () => {
  const state = await getState();
  chrome.tabs.create({ url: `${BASE_URLS[selectedEnvironment(state)]}/dashboard` });
});

forgetBtn.addEventListener('click', async () => {
  await Promise.all([
    chrome.storage.local.remove(['token', 'user', 'mekJwk']),
    chrome.storage.session.remove(['mekJwk']),
  ]);
  await refresh();
});

saveChatBtn.addEventListener('click', async () => {
  const state = await getState();

  if (!state.token) {
    setStatus('Connect Memoriq first.', 'warn');
    return;
  }

  if (!state.mekJwk) {
    setStatus('Unlock your vault first.', 'warn');
    unlockForm.classList.remove('hidden');
    return;
  }

  const tab = await activeTab();
  if (!tab?.id || !isSupportedChatUrl(tab.url)) {
    setStatus('Open a supported AI chat tab first.', 'warn');
    return;
  }

  const project = selectedProject();
  await chrome.storage.local.set({ preferredProject: project });

  saveChatBtn.disabled = true;
  saveChatBtn.textContent = 'Saving...';
  setStatus('Scanning and encrypting the current chat...', '');

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'MEMORIQ_SAVE_FROM_POPUP',
      project,
    });

    if (!response?.ok) throw new Error(response?.error || 'Save failed.');

    setStatus(response.title ? `Saved "${response.title}"` : 'Saved current chat.', 'ok');
  } catch (error) {
    setStatus(error.message || 'Could not save this tab. Reload the chat page and try again.', 'warn');
  } finally {
    saveChatBtn.disabled = saveMode.value !== 'popup_button';
    saveChatBtn.textContent = 'Save current chat';
  }
});

unlockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('Unlocking...', '');

  try {
    const data = await api('/api/user/encryption-key');
    const mek = await MemoriqCrypto.unwrapMEK(passwordInput.value, data.salt, data.keyData);
    const mekJwk = await MemoriqCrypto.exportMEK(mek);
    await chrome.storage.local.remove('mekJwk');
    await chrome.storage.session.set({ mekJwk });
    passwordInput.value = '';
    await refresh();
  } catch (error) {
    setStatus('Could not unlock vault. Check your encryption password.', 'warn');
  }
});

refresh();
