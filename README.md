<div align="center">

<img src="https://readme-typing-svg.herokuapp.com?font=JetBrains+Mono&weight=800&size=28&duration=2800&pause=900&color=00E5FF&center=true&vCenter=true&width=760&lines=OmegA-FCA;A+Messenger+FCA+Compatibility+Layer;Built+for+the+OmegA+Bot+Ecosystem" alt="OmegA-FCA animated title" />

<br/>

<p>
  <img src="https://img.shields.io/badge/OmegA-FCA-00B8D9?style=for-the-badge&logo=github&logoColor=white" alt="OmegA-FCA" />
  <img src="https://img.shields.io/badge/Version-0.2.0-7C4DFF?style=for-the-badge" alt="Version 0.2.0" />
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 20+" />
  <img src="https://img.shields.io/badge/License-Apache--2.0-FF8A65?style=for-the-badge" alt="Apache 2.0" />
</p>

<p><b>Unofficial Facebook Messenger client · FCA-style API · OmegA Bot ecosystem</b></p>

<a href="#-installation">INSTALL</a> •
<a href="#-quick-start">QUICK START</a> •
<a href="#-goatbot-compatibility">GOATBOT</a> •
<a href="#-project-status">STATUS</a>

<br/><br/>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:00C6FF,50:7B2FF7,100:F857A6&height=3&section=header" width="92%" alt="" />

</div>

## <img src="https://img.shields.io/badge/01-ABOUT-00B8D9?style=flat-square" /> About OmegA-FCA

**OmegA-FCA** is an unofficial Node.js Facebook Messenger client and FCA-style compatibility layer maintained by **NirZon** for the OmegA Bot ecosystem.

| | Details |
|:--|:--|
| **Package** | `@nirzon-islam/omega-fca` |
| **Current version** | `0.2.0` |
| **Runtime** | Node.js 20+ |
| **License** | Apache-2.0 |
| **Target bot** | [OmegA-Goatbot](https://github.com/nirzon-islam/OmegA-Goatbot) |

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

<details>
<summary><b>Security review documents</b></summary>

- [Authentication & Session Security Audit](docs/AUTH-SESSION-SECURITY-AUDIT.md)
- [Source & Dependency Audit](docs/SOURCE-DEPENDENCY-AUDIT.md)

</details>

## <img src="https://img.shields.io/badge/06-OMEGA%20GOATBOT-7B2FF7?style=flat-square" /> GoatBot compatibility

The intended integration target is **[OmegA-Goatbot](https://github.com/nirzon-islam/OmegA-Goatbot)**.

The goal is a drop-in FCA experience: preserve the bot's existing login pattern, callback/event lifecycle and expected `api` methods, so the bot can use the npm package without an extra bridge or a separate login system.

The compatibility audit is still in progress. GoatBot's `sessionGuard()` / `stopSessionGuard()` API is implemented with account-bound atomic AppState snapshots; its live session-refresh behavior still needs runtime validation. The `e2ee` API remains unimplemented. Do not replace the bot's current FCA dependency until the compatibility matrix and bot-side regression tests confirm the required methods and lifecycle behavior.

- [EryXen API Compatibility Audit](docs/ERYXEN-API-COMPATIBILITY.md)
- [GoatBot Compatibility Notes](docs/GOATBOT-COMPATIBILITY.md)

## <img src="https://img.shields.io/badge/07-E2EE%20STATUS-607D8B?style=flat-square" /> End-to-end encryption status

The uploaded source archive does **not** contain a Messenger E2EE implementation, Signal Protocol session store, Group Sender Keys, or SKDM implementation. OmegA-FCA does not claim encrypted one-to-one or group messaging support in this release. These capabilities require separate implementation and testing.

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
| Source integration | In progress |
| Build & automated validation | In progress |
| FCA API compatibility | In progress |
| OmegA-GoatBot integration | Pending acceptance tests |
| Authorized Facebook live login | Not yet verified |
| Native E2EE | Not implemented |

</div>

**OmegA-FCA 0.2.0 is an integration and validation release**, not a claim of complete production parity with every FCA fork. Release readiness requires clean installation, successful build/typecheck/tests, GoatBot regression checks, and owner-authorized Facebook live testing.

## <img src="https://img.shields.io/badge/10-SOURCE%20%26%20CREDITS-7B2FF7?style=flat-square" /> Source & attribution

The initial implementation is based on the uploaded `@dongdev/fca-unofficial` v4.0.2 source archive. The original Apache-2.0 license and upstream copyright notices are retained. OmegA-FCA package metadata, configuration, documentation, security defaults, compatibility work, and future changes are maintained separately by NirZon.

See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:00C6FF,50:7B2FF7,100:F857A6&height=100&section=footer" width="100%" alt="" />

**OmegA-FCA** · Built for the OmegA Bot ecosystem

<sub>Respect open source · Preserve attribution · Test responsibly</sub>

</div>
