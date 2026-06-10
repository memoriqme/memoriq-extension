# Memoriq Extension

Chrome extension for saving AI conversations into Memoriq.

Memoriq is a private AI memory vault for conversations from ChatGPT, Claude, Gemini, and Grok. This extension captures supported AI chat pages, encrypts the result locally in the browser, and uploads only ciphertext to the Memoriq web app.

Extension repository: [github.com/memoriqme/memoriq-extension](https://github.com/memoriqme/memoriq-extension)<br>
App repository: [github.com/memoriqme/memoriq](https://github.com/memoriqme/memoriq)

## Supported Providers

- ChatGPT (`chatgpt.com`, `chat.openai.com`)
- Claude (`claude.ai`)
- Gemini (`gemini.google.com`)
- Grok (`grok.com`, selected Grok routes on `x.com`)

**ChatGPT** uses OpenAI's same-origin conversation API (`/backend-api/conversation/…`) with your existing logged-in browser session, so saves are fast and include the full chat without manual scrolling.

**Claude, Gemini, and Grok** use page-structure extraction (DOM). Those UIs change often, so capture is best-effort. The goal is a useful encrypted capture path for common chat pages, not pixel-perfect archiving of every provider UI.

## Philosophy

The extension exists to be a small bridge between AI providers and a vault you control:

- Capture should happen locally in the browser.
- Plaintext chats should not be sent to the Memoriq server.
- Provider support should be honest about breakage and fallbacks.
- Users should be able to choose between a page button and a cleaner popup save flow.
- The source should be auditable because the extension touches sensitive pages.

## What It Does

- Adds a "Save to Memoriq" flow for supported AI chat pages.
- Extracts chat title, source URL, messages, and readable rich content where possible.
- Encrypts conversation headers and bodies locally before upload.
- Lets you save through either:
  - a floating button on the AI chat page
  - the extension popup
- Lets you choose a preferred Memoriq project from the popup.
- Supports the hosted Memoriq app, with configurable development and release builds.

## Privacy Model

The extension does not send plaintext chats to the Memoriq server.

Flow:

1. The extension connects to Memoriq through `/extension/connect`.
2. Memoriq gives the extension a scoped API token.
3. The extension fetches the encrypted vault key envelope.
4. You unlock the vault locally with your Memoriq encryption password.
5. The extension reads the current AI chat (ChatGPT via its conversation API; other providers from the page).
6. The extension encrypts the header and body locally.
7. The extension uploads only `encrypted_header` and `encrypted_body`.

The encryption password is not sent to the server.

Privacy policy (including a Chrome extension section): [memoriq.me/privacy](https://memoriq.me/privacy)

## Install for Development

Clone the repository:

```bash
git clone https://github.com/memoriqme/memoriq-extension.git
cd memoriq-extension
```

Create your local build config:

```bash
cp extension.config.example.json extension.config.json
```

Edit `extension.config.json` and add any extra app URLs you use for development. Keep this file local; it is gitignored.

Build the extension:

```bash
npm run build
```

Load it in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select the `dist` folder.

Then:

1. Open the extension popup.
2. Click "Connect / Log in".
3. Log into Memoriq.
4. Unlock your vault in the extension popup.
5. Open a supported AI chat page and save.

If you built a **development** version with multiple environments (`"release": false` in `extension.config.json`), open **Options** first and select the Memoriq instance you use (for example Local or Production). Release builds connect to production only and do not show that selector.

## Save Modes

The popup has a "Save button" setting:

- **Show button on chat pages**: injects a floating "Save to Memoriq" button into supported AI pages.
- **Save from extension popup**: keeps the page cleaner and saves when you click "Save current chat" in the popup.

The popup also has a preferred project selector. It decrypts your saved conversation headers locally to list existing project names, then saves the next chat into the selected project.

## File Overview

```text
extension.config.example.json  Example build config committed to the repo
extension.config.json          Local build config (gitignored)
manifest.json                  Chrome Manifest V3 configuration
popup.html                     Extension popup UI
popup.js                       Connection, unlock, save mode, and project selector logic
popup.css                      Popup styles
content.js                     Page integration, extraction orchestration, encryption, save button
content.css                    Floating button styles
extract.js                     Provider-specific DOM extraction helpers
crypto.js                      Browser crypto helpers used by popup and content scripts
connect.js                     Token handoff from the Memoriq web app
background.js                  Background message handler and API upload
icons/                         Extension icons matching the Memoriq app logo (source: icons/memoriq.svg)
scripts/                       Build and icon generation helpers
```

## Build Config

Copy `extension.config.example.json` to `extension.config.json` and edit it locally.

Example development config:

```json
{
  "release": false,
  "productionUrl": "https://memoriq.me",
  "devEnvironments": [
    {
      "id": "local",
      "label": "Local",
      "url": "http://memoriq.local"
    },
    {
      "id": "staging",
      "label": "Staging",
      "url": "https://memoriq.example.com"
    }
  ]
}
```

For a Chrome Web Store release build, set `"release": true`. Release builds use only `productionUrl` and hide the environment selector in the popup.

## Local Checks

The extension is plain JavaScript, but you should build into `dist/` before loading it in Chrome.

Run syntax checks:

```bash
npm run check
```

Build:

```bash
npm run build
```

- `dist/` is the folder to load unpacked in Chrome.
- Development builds keep the environments listed in `extension.config.json`.
- Release builds target production only.

## Capture Notes

Memoriq focuses on saving text-first AI conversations.

- **ChatGPT:** Uses the provider's conversation API while you are logged in. No manual scrolling is required.
- **Claude, Gemini, Grok:** Use DOM extraction. For long Gemini chats, scroll to the top of the conversation before saving so older messages are loaded into the page.
- **All providers:** Media such as images, audio, and video are not preserved in the current text-first release.

More resilient provider import options and richer media preservation may be explored as the project develops, but the current priority is reliable private saving for useful text conversations.

## Contributing

Useful contributions:

- provider extraction fixes
- cleaner selectors
- smaller reproduction cases for broken captures
- popup UX improvements
- security review
- documentation

For capture bugs, please include:

- provider
- URL shape, without private content
- extension version
- browser version
- what was missing, duplicated, or wrongly titled

## Security

Please do not open public issues for security vulnerabilities. Use [GitHub private vulnerability reporting](https://github.com/memoriqme/memoriq-extension/security/advisories/new), or the contact details on [memoriq.me](https://memoriq.me). See [`SECURITY.md`](SECURITY.md).

## Trademark

"Memoriq" and the Memoriq logo are used as project trademarks. The AGPL license applies to the source code, but it does not grant permission to use the Memoriq name or logo to publish unofficial apps, extensions, hosted services, or other products in a way that suggests they are official or endorsed.

## License

Memoriq Extension is licensed under the GNU Affero General Public License v3.0 only. See [`LICENSE`](LICENSE).

In short: personal use, self-hosting, studying, modifying, and sharing are allowed. If you distribute a modified extension or use modified Memoriq software to provide a network service to others, your modified source code must remain available under the same license.
