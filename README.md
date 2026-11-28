<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:071A2C,35:075985,70:6D28D9,100:DB2777&height=230&section=header&text=OmegA-FCA&fontSize=68&fontColor=FFFFFF&fontAlignY=38&desc=Messenger%20FCA%20Compatibility%20Layer&descAlignY=60&descSize=19&animation=fadeIn" width="100%" alt="OmegA-FCA — Messenger FCA Compatibility Layer" />

<p>
  <img src="https://readme-typing-svg.herokuapp.com?font=JetBrains+Mono&weight=700&size=19&duration=2600&pause=900&color=00D9FF&center=true&vCenter=true&width=760&lines=Built+for+the+OmegA+Bot+Ecosystem;Classic+FCA+API+%7C+Modern+Node.js;Adaptive+Safety+%7C+Backward+Compatibility" alt="Project tagline" />
</p>

<p>
  <img src="https://img.shields.io/badge/VERSION-0.2.3--beta.6-7C3AED?style=for-the-badge&logo=semver&logoColor=white" alt="Version 0.2.3-beta.7" />
  <img src="https://img.shields.io/badge/NODE.JS-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 20+" />
  <img src="https://img.shields.io/badge/LICENSE-AGPL--3.0--or--later-EA580C?style=for-the-badge" alt="AGPL-3.0-or-later" />
  <img src="https://img.shields.io/badge/STATUS-Beta%20Pre-release-F59E0B?style=for-the-badge&logo=githubactions&logoColor=white" alt="Beta pre-release" />
</p>

<p>
  <b>An unofficial Facebook Messenger client with an FCA-style API.</b><br/>
  Designed to keep existing bot integrations familiar while adding safer session and outgoing-action handling.
</p>

<p>
  <a href="#-installation"><img src="https://img.shields.io/badge/INSTALL-0891B2?style=for-the-badge" alt="Installation" /></a>
  <a href="#-quick-start"><img src="https://img.shields.io/badge/QUICK_START-6D28D9?style=for-the-badge" alt="Quick start" /></a>
  <a href="#-included-api-areas"><img src="https://img.shields.io/badge/API_FEATURES-BE185D?style=for-the-badge" alt="API features" /></a>
  <a href="#-project-status"><img src="https://img.shields.io/badge/PROJECT_STATUS-166534?style=for-the-badge" alt="Project status" /></a>
</p>

<br/>

<table>
<tr>
<td align="center" width="33%">
  <h3>⚡ FCA-style API</h3>
  Familiar callback and Promise workflows
</td>
<td align="center" width="33%">
  <h3>🛡️ Adaptive Safety</h3>
  Retry-aware handling and checkpoint protection
</td>
<td align="center" width="33%">
  <h3>🔌 Bot Ready</h3>
  Built for the OmegA Bot ecosystem
</td>
</tr>
</table>

<sub><a href="https://github.com/octopusworldpro-web/OmegA-FCA-test">GitHub Repository</a> · <a href="https://www.npmjs.com/package/@nirzon-islam/omega-fca">npm Package</a></sub>

</div>

---

## <img src="https://img.shields.io/badge/01-ABOUT-00B8D9?style=flat-square" /> About OmegA-FCA

**OmegA-FCA** is an unofficial Node.js Facebook Messenger client and FCA-style compatibility layer for the OmegA Bot ecosystem.

| | Details |
|:--|:--|
| **Package** | `@nirzon-islam/omega-fca` |
| **Current version** | `0.2.3-beta.7` |
| **Runtime** | Node.js 20+ |
| **License** | AGPL-3.0-or-later |
| **Target bot** | the integrating bot |

<div align="center">

> ⚠️ **Unofficial client notice**
>
> This project uses private Facebook web and Messenger interfaces. These interfaces may change without notice. Synthetic tests do not prove that Facebook will accept a login, MQTT connection, or message operation. Use only accounts and sessions you own or are authorized to operate.

</div>

## <img src="https://img.shields.io/badge/02-INSTALLATION-7B2FF7?style=flat-square" /> Installation

Install the published package:

```bash
npm install @nirzon-islam/omega-fca
```

<details>
<summary><b>Install from the GitHub test repository</b></summary>

```bash
git clone https://github.com/octopusworldpro-web/OmegA-FCA-test.git
cd OmegA-FCA-test
npm install
npm run build
```

</details>

## <img src="https://img.shields.io/badge/03-QUICK%20START-00C6FF?style=flat-square" /> Quick start

### Classic FCA callback style

```js
const login = require("@nirzon-islam/omega-fca");

login(
  { appState: require("./appstate.json") },
  { listenEvents: true, autoReconnect: true },
  (error, api) => {
    if (error) {
      console.error("Login failed:", error.message);
      return;
    }

    console.log("Authenticated UID:", api.getCurrentUserID());

    api.listenMqtt((listenError, event) => {
      if (listenError) {
        console.error("Listener error:", listenError.message);
        return;
      }

      if (event?.type === "message" && event.body) {
        console.log("Incoming message event received");
      }
    });
  }
);
```

### Promise style

```js
const { loginAsync } = require("@nirzon-islam/omega-fca");

const ctx = await loginAsync({
  appState: require("./appstate.json")
});

const api = ctx.api;
```

## <img src="https://img.shields.io/badge/04-CAPABILITIES-FF8A65?style=flat-square" /> Included API areas

<table>
<tr>
<td width="50%">

**🔐 Authentication & session**
- Login helpers and cookie normalization
- Session validation and account utilities
- AppState and Cookie input formats

**📡 Realtime connection**
- MQTT / WebSocket listener
- Subscription and reconnect handling
- Event delivery

**💬 Messenger operations**
- Send, edit and delete/unsend
- Reactions and typing indicators
- Mark-read / seen / delivered
- Attachment helpers

</td>
<td width="50%">

**👥 Threads & groups**
- Thread information, history and list
- Group management and settings
- Polls and themes

**👤 User & account**
- User lookup and profile information
- Friends-list helpers
- Account utilities

**🧩 Developer API**
- Classic callback-style FCA API
- Promise login API
- Namespaced client facade
- Higher-level `MessengerBot` wrapper

</td>
</tr>
</table>

<sub>API presence in source does not guarantee that a private Facebook endpoint is currently accepted. Operations require compatible tests and authorized live validation.</sub>

## <img src="https://img.shields.io/badge/05-AUTH%20%26%20SECURITY-E53935?style=flat-square" /> Authentication & security

Supported session input formats include:

- `appState`: array of Facebook cookie objects.
- `Cookie`: cookie header string, array, or key/value object.

The source also contains an optional email/password token-provider integration. **This path is disabled by default.** It will not send credentials to a remote service unless an operator explicitly configures an HTTPS `apiServer` or passes an HTTPS API URL to the relevant method. The remote provider is not part of Facebook and must be independently trusted.

- Automatic package installation/update checks are disabled by default.
- Facebook checkpoints and security challenges must be resolved by the account owner.
- No checkpoint bypass is promised or provided.
- Never commit `appstate.json`, `account.txt`, cookie exports, passwords, 2FA seeds, API keys, or populated `fca-config.json` files.

### Adaptive safety & backward compatibility

The adaptive safety handler is additive: existing login signatures, callback/event flow, and message payloads remain supported. Normal successful requests keep their existing behavior; retry handling only activates for retryable failures, and message deduplication is opt-in through an `idempotencyKey` on the message object.

When an explicit Facebook checkpoint/challenge response is detected, outgoing actions are paused and a `checkpoint` event is emitted. The account owner must resolve the challenge. The library does not bypass checkpoints or automatically unlock the account.

After the owner resolves it, the caller may explicitly verify the session and resume:

```js
api.resumeAfterCheckpoint(async () => {
  // Return true only after your own authenticated session check succeeds.
  return await verifyMyFacebookSession();
});
```

The verifier must return `true`; a failed/throwing check leaves outgoing actions paused. The namespaced client exposes the same method at `client.account.resumeAfterCheckpoint`. New events are `checkpoint` and `safety_resumed`; existing event names are unchanged.


<details>
<summary><b>Security review documents</b></summary>

- [Authentication & Session Security Audit](docs/AUTH-SESSION-SECURITY-AUDIT.md)
- [Source & Dependency Audit](docs/SOURCE-DEPENDENCY-AUDIT.md)

</details>

## <img src="https://img.shields.io/badge/06-OMEGA%20GOATBOT-7B2FF7?style=flat-square" /> integrating bot compatibility

The intended integration target is **the integrating bot**.

The goal is a drop-in FCA experience: preserve the bot's existing login pattern, callback/event lifecycle and expected `api` methods, so the bot can use the npm package without an extra bridge or a separate login system.

The compatibility audit is still in progress. integrating bot's `sessionGuard()` / `stopSessionGuard()` API is implemented with account-bound atomic AppState snapshots; its live session-refresh behavior still needs runtime validation. The native `api.e2ee` surface is implemented in OmegA-FCA; integration-target acceptance and live Messenger compatibility remain separate validation items. Do not replace the bot's current FCA dependency until the compatibility matrix and bot-side regression tests confirm the required methods and lifecycle behavior.

- [integrating bot Compatibility Notes](docs/GOATBOT-COMPATIBILITY.md)

## <img src="https://img.shields.io/badge/07-E2EE%20STATUS-607D8B?style=flat-square" /> End-to-end encryption status

The source includes an opt-in native Messenger E2EE path: account-scoped Signal state, authenticated CAT/ICDC and Noise key-sync integration, peer-device discovery, direct/group encrypted text, durable encrypted outbox recovery, Sender Key rotation, and native encrypted image/video/audio/document media transport. **Steps 1–4 are verified complete for offline source, integration, fixture, and CI scope.** Live Facebook device, message, and media-CDN interoperability remains deferred and unverified; this beta does not claim live E2EE acceptance or production readiness. See [the canonical E2EE roadmap](docs/E2EE-ROADMAP.md) and [current implementation status](docs/E2EE-STATUS.md).

## <img src="https://img.shields.io/badge/08-DEVELOPMENT-00B8D9?style=flat-square" /> Development & checks

```bash
npm install
npm run build
npm run typecheck
npm test
npm run lint
npm pack --dry-run
```

The test suite contains synthetic checks and an optional live-login test that is skipped unless the operator provides a private, authorized session. Never put real credentials in the repository or CI logs.

## <img src="https://img.shields.io/badge/09-PROJECT%20STATUS-FFB300?style=flat-square" /> Project status

<div align="center">

| Area | Status |
|:--|:--:|
| Core source integration | Implemented; live acceptance pending |
| Build & automated validation | Beta.7 candidate CI pending; beta.6 source/test CI passed on Node 20 and 22 |
| FCA API compatibility | In progress |
| OmegA-integrating bot integration | Pending acceptance tests |
| Authorized Facebook live login | Not yet verified |
| Native E2EE | Offline source/fixture scope complete; live interoperability unverified |

</div>

**OmegA-FCA 0.2.3-beta.7 is an unpublished beta candidate, not a stable production release.** Compatibility with every FCA fork is not guaranteed. The carried-forward source fixes passed dependency/security audit, build and full tests, TypeScript, lint, and package dry-run on Node.js 20 and 22 ([run 46115370942](https://github.com/octopusworldpro-web/OmegA-FCA-test/actions/runs/46115370942)); beta.7's versioned candidate CI is pending. The E2EE storage-directory compatibility fix is included. Authorized live Facebook login, GoatBot runtime acceptance, and native Messenger Inbox DM/reply interoperability remain unverified and require separate live testing.

## <img src="https://img.shields.io/badge/10-SOURCE%20%26%20CREDITS-7B2FF7?style=flat-square" /> Source & attribution

The initial implementation is based on the uploaded `@dongdev/fca-unofficial` v4.0.2 source archive. The original Apache-2.0 license and upstream copyright notices are retained. OmegA-FCA package metadata, configuration, documentation, security defaults, compatibility work, and future changes are maintained separately by OmegA-FCA maintainers.

See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:00C6FF,50:7B2FF7,100:F857A6&height=100&section=footer" width="100%" alt="" />

**OmegA-FCA** · Built for the OmegA Bot ecosystem

<sub>Respect open source · Preserve attribution · Test responsibly</sub>

</div>
