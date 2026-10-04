# Gamebud

Describe a game in plain words and Gamebud builds it. You can play it right in the app, tweak it by chatting, give it generated textures, and export it as a single HTML file.

Built with Electron and the Gemini API.

## Run it

```bash
npm install
npm start
```

If `npm start` says Electron is not fully installed, it downloads it automatically and carries on. If that download is blocked, the message explains what to try (the usual causes are a VPN, proxy or antivirus, or a folder inside OneDrive).

Then press **Ctrl+Shift+K** (**Cmd+Shift+K** on macOS) to open the hidden developer panel and paste your Gemini API key. A key can also come from the `GEMINI_API_KEY` environment variable. A saved key wins over the environment variable.

```bash
npm test     # unit tests (credits, storage, Gemini client, error handling)
```

## The hidden API key panel

There is no menu item, button, or setting for the API key. The only way in is the keyboard shortcut above, and the panel can only be used for 10 minutes after the shortcut was pressed. In the panel you can:

- save or remove the key (stored with the OS keychain via Electron `safeStorage` when available)
- run a connection test, which shows the *real* error
- see the last upstream error (users never see these)
- refill credits or reset the account to Hobby for testing

DevTools are disabled in packaged builds, and the app menu is removed on Windows and Linux. Set `GAMEBUD_DEBUG=1` to get DevTools back.

## Models

| Use | Model | Settings |
| --- | --- | --- |
| Chat / game building | `gemini-3.5-flash-lite` | `thinkingConfig.thinkingLevel = "high"` |
| Textures | `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite) | 1K output, `responseModalities: ["TEXT", "IMAGE"]` |

Flash-Lite defaults to *minimal* thinking, so high thinking is set explicitly on every chat request.

### The new `AQ.` API keys

Google is moving Gemini API keys from the old `AIza…` format to a new Auth key that starts with `AQ.` Keys created in AI Studio now come out in the new format, and legacy keys are being phased out. Things Gamebud does because of that:

- The key is sent in the **`x-goog-api-key` header**, never as a `?key=` query parameter. Reports say `AQ.` keys fail on the query form.
- Key validation accepts a **dot** and longer keys: `/^[A-Za-z0-9._-]{20,512}$/`. Old `AIza…` keys still pass.
- Calls use the native `generateContent` endpoint. Reports say `AQ.` keys can fail on OpenAI-compatible endpoints.

Sources: [Gemini API keys are transitioning from AIza to AQ.](https://note.com/raplsworks/n/n740ebccb8289?hl=en), [I Created a Gemini API Key and Got AQ. Instead of AIza](https://dev.to/rapls/i-created-a-gemini-api-key-and-got-aq-instead-of-aiza), [lingarr issue #532](https://github.com/lingarr-translate/lingarr/issues/532), [Gemini 3.5 Flash-Lite](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite), [Gemini 3.1 Flash Lite Image](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image). Google's rollout details may have changed since this was written, so check the official docs if a key is rejected.

## Plans and credits

| Plan | Price | Credits |
| --- | --- | --- |
| **Hobby** (free) | $0 | 50 / month |
| **Plus** | $10 / month | 150 / month |

- Every chat message costs **5 credits**. A texture generation also counts as a message.
- Credits are taken when a request starts and **returned if it fails**, so users are only charged for results.
- Credits refill (they do not stack) every 30 days. Change `PERIOD_MS` in `src/main/billing.js` if you want a one-time free allowance instead.

### "Demand is high."

If the Gemini API is unavailable for any reason (quota used up, bad or missing key, network error, empty answer), the user sees a calm **"Demand is high."** notice, no credits are used, and their message is put back in the box so they can retry. The real reason is only visible in the hidden developer panel. Requests the model *refuses*, or answers that are cut off, get their own honest message.

### Billing is a demo

The Plus checkout is a **mock**. It accepts any card details, charges nothing, and never stores or sends them: the fields live only in the checkout form and are wiped when it closes. Upgrading just flips the local plan and credits. Before showing this to real users, either clearly label it as a demo or wire up a real payment provider (such as Stripe Checkout), because people may type real card numbers into a form that looks real.

## How it is put together

```
src/main/        Electron main process
  main.js          window, hidden shortcut, IPC, gamebud:// protocol
  service.js       chat + texture flows, credit charging/refunds (no Electron imports)
  gemini.js        Gemini client, error classification, response parsing
  billing.js       plans and credit ledger
  secrets.js       API key storage
  store.js         atomic JSON files, one per project
  prompts.js       game-builder system prompt, texture styles
  preload.js       the small API exposed to the UI
scripts/start.js Launcher that repairs a broken Electron install
src/renderer/    The UI (plain HTML/CSS/JS, no build step)
src/shared/      Texture-reference helper used by both sides
test/            Node test runner tests with a mock Gemini server
```

Security notes:

- API calls happen in the main process. The key never reaches the UI.
- The UI runs with `contextIsolation`, `sandbox`, and a strict CSP.
- Generated games run in a sandboxed iframe served from a `gamebud://` protocol with its own CSP: scripts can run, but they have no storage, no access to the app, and no network except one: they may load Three.js from the pinned jsDelivr folder in `src/main/cdn.js`. 3D games use an import map for it, so they need an internet connection to start. To change the version, edit `THREE_VERSION` there.
- Textures are referenced in games as `texture://<name>` and turned into inline images when a game is previewed or exported, so exported files are fully standalone.

Data lives in Electron's user-data folder (`account.json`, `secrets.json`, `projects/`).

## Not included yet

Installers. To package the app, add [electron-builder](https://www.electron.build/) or Electron Forge.
