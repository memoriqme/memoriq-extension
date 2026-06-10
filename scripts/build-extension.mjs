import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'dist');
const configPath = path.join(root, 'extension.config.json');
const exampleConfigPath = path.join(root, 'extension.config.example.json');

const runtimeFiles = [
  'background.js',
  'connect.js',
  'content.css',
  'content.js',
  'crypto.js',
  'extract.js',
  'LICENSE',
  'manifest.json',
  'popup.css',
  'popup.html',
  'popup.js',
];

const CHAT_HOST_PERMISSIONS = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
  'https://claude.ai/*',
  'https://gemini.google.com/*',
  'https://grok.com/*',
  'https://x.com/i/grok*',
  'https://x.com/grok*',
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeOrigin(url) {
  const trimmed = (url || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('URL is required.');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid URL: ${trimmed}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol in URL: ${trimmed}`);
  }

  return parsed.origin;
}

function validateEnvironment(environment, label) {
  if (!environment || typeof environment !== 'object') {
    throw new Error(`${label} must be an object.`);
  }

  const id = String(environment.id || '').trim();
  const envLabel = String(environment.label || '').trim();
  const url = normalizeOrigin(environment.url);

  if (!id) {
    throw new Error(`${label}.id is required.`);
  }

  if (!/^[a-z][a-z0-9_]*$/i.test(id)) {
    throw new Error(`${label}.id must use letters, numbers, and underscores only.`);
  }

  if (!envLabel) {
    throw new Error(`${label}.label is required.`);
  }

  return { id, label: envLabel, url };
}

async function loadConfig() {
  let rawConfig;

  try {
    rawConfig = await readFile(configPath, 'utf8');
  } catch {
    console.error('Missing extension.config.json.');
    console.error('Copy extension.config.example.json to extension.config.json and edit your app URLs.');
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(rawConfig);
  } catch {
    console.error('extension.config.json is not valid JSON.');
    process.exit(1);
  }

  try {
    const productionUrl = normalizeOrigin(config.productionUrl);
    const release = Boolean(config.release);
    const devEnvironments = release
      ? []
      : (Array.isArray(config.devEnvironments) ? config.devEnvironments : []).map((environment, index) => (
        validateEnvironment(environment, `devEnvironments[${index}]`)
      ));

    const environments = release
      ? [{ id: 'production', label: 'Production', url: productionUrl }]
      : [
        ...devEnvironments,
        ...(devEnvironments.some((environment) => environment.url === productionUrl)
          ? []
          : [{ id: 'production', label: 'Production', url: productionUrl }]),
      ];

    const ids = new Set();
    const urls = new Set();

    for (const environment of environments) {
      if (ids.has(environment.id)) {
        throw new Error(`Duplicate environment id: ${environment.id}`);
      }
      if (urls.has(environment.url)) {
        throw new Error(`Duplicate environment URL: ${environment.url}`);
      }
      ids.add(environment.id);
      urls.add(environment.url);
    }

    return { release, productionUrl, environments };
  } catch (error) {
    console.error(error.message);
    console.error('See extension.config.example.json for the expected format.');
    process.exit(1);
  }
}

function generateBaseUrls(environments) {
  const entries = environments.map((environment) => (
    `  ${environment.id}: '${environment.url}',`
  )).join('\n');

  return `const BASE_URLS = {\n${entries}\n};`;
}

function generateIsAllowedConnectUrl(environments) {
  const tests = environments.map((environment) => {
    const parsed = new URL(environment.url);
    const protocol = parsed.protocol === 'http:' ? 'https?' : 'https';
    const host = escapeRegex(parsed.host);

    return `/^${protocol}:\\/\\/${host}\\/extension\\/connect(?:[?#].*)?$/i.test(url)`;
  });

  return `function isAllowedConnectUrl(url = '') {
  return ${tests.join('\n    || ')};
}`;
}

function replaceBaseUrls(source, environments) {
  return source.replace(/const BASE_URLS = \{[\s\S]*?\};/, generateBaseUrls(environments));
}

function replaceConnectGuard(source, environments) {
  return source.replace(
    /function isAllowedConnectUrl\(url = ''\) \{[\s\S]*?\n\}/,
    generateIsAllowedConnectUrl(environments),
  );
}

function buildManifest(sourceManifest, config) {
  const manifest = {
    ...sourceManifest,
    host_permissions: [
      ...config.environments.map((environment) => `${environment.url}/*`),
      ...CHAT_HOST_PERMISSIONS,
    ],
    content_scripts: sourceManifest.content_scripts.map((script) => {
      if (!script.matches?.some((match) => match.includes('/extension/connect'))) {
        return script;
      }

      return {
        ...script,
        matches: config.environments.map((environment) => `${environment.url}/extension/connect*`),
      };
    }),
  };

  return manifest;
}

function buildPopupHtml(source, config) {
  if (config.release) {
    return source.replace(
      /\n\s*<section class="options-section">\s*\n\s*<h2>Environment<\/h2>[\s\S]*?<\/section>/,
      '',
    );
  }

  const options = config.environments.map((environment) => (
    `            <option value="${environment.id}">${environment.label} - ${new URL(environment.url).host}</option>`
  )).join('\n');

  return source.replace(
    /<select id="environment">[\s\S]*?<\/select>/,
    `<select id="environment">\n${options}\n          </select>`,
  );
}

async function writeRuntimeFile(file, config) {
  const sourcePath = path.join(root, file);
  const outputPath = path.join(outputDir, file);

  if (file === 'manifest.json') {
    const manifest = JSON.parse(await readFile(sourcePath, 'utf8'));
    await writeFile(outputPath, `${JSON.stringify(buildManifest(manifest, config), null, 2)}\n`);
    return;
  }

  let source = await readFile(sourcePath, 'utf8');

  if (file.endsWith('.js')) {
    source = replaceBaseUrls(source, config.environments);
  }

  if (file === 'background.js') {
    source = replaceConnectGuard(source, config.environments);
  }

  if (file === 'popup.html') {
    source = buildPopupHtml(source, config);
  }

  await writeFile(outputPath, source);
}

const config = await loadConfig();

await rm(outputDir, { force: true, recursive: true });
await mkdir(outputDir, { recursive: true });

for (const file of runtimeFiles) {
  await writeRuntimeFile(file, config);
}

await cp(path.join(root, 'icons'), path.join(outputDir, 'icons'), {
  recursive: true,
  filter: (source) => !source.endsWith('.psd') && !source.endsWith('.ai'),
});

const mode = config.release ? 'release' : 'development';
console.log(`Built ${mode} extension in ${path.relative(root, outputDir)}`);
