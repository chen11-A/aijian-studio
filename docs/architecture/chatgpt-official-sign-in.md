# Official ChatGPT sign-in for AIVORA

Status: implementation in progress, 2026-10-08. No live registration, credentials, model discovery, or inference has been executed by the implementation task.

## Boundary and eligibility

This is a separate Electron-main-process provider, not a Sub2API mode. ChatGPT plan usage is an optional OAuth permission, distinct from identity sign-in. Local personal and open-source use are documented; paid/hosted distribution requires OpenAI approval. The desktop user must confirm the applicable scope and approve registration, disclosure of identity, plan permission and protected local storage before the system browser is opened. Choosing a scope records the user's declaration; it is not an independent eligibility certification.

Official source contracts checked 2026-10-08:

- https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt (2026-09-28)
- https://developers.openai.com/siwc/quickstart
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/website (OIDC discovery and signature-validation requirements)

## Security design

The renderer receives display state only. OAuth codes, access/refresh/ID tokens, PKCE, authorization URLs and callback ports remain in the main process. Each attempt uses fresh cryptographic state, nonce and S256 PKCE; the listener binds only 127.0.0.1, checks its exact host/path, is single-use and expires. Authorization is only at auth.openai.com. New installations use dynamic registration, not an invented or borrowed client ID. An issued registration is saved before exchanging the code. Returning sign-in preserves its client ID and validates the same issuer/subject.

OIDC identity is accepted only after cryptographic signature, issuer, audience, timestamps and nonce validation. No decoded-but-unverified identity can enable inference. HTTP redirects are refused, responses bounded, and errors use stable local codes rather than remote bodies. Tokens are encrypted using Electron safeStorage; a missing secure backend or Linux basic_text fails closed. The encrypted file is written atomically with owner-only permissions and never stored in project data, frontend storage, logs, or Sub2API records. Local host/registration metadata remains associated with the encrypted profile collection. Each registration is distinct, even if emails match.

Sign-in remains one operation at a time; Cancel/unmount must stop the callback and discard pending results. No implicit retry of token exchange, refresh or inference. A failed/uncertain rotating refresh requires sign-in again. Sign-out clears local credentials even if remote revocation cannot be confirmed, and reports that distinction. The runtime does not silently switch providers.

Only the selected account's live model catalog supplies model choices. Text calls use the public Responses endpoint, input arrays, store:false and stream:true. Completion requires response.completed; EOF, failed and incomplete streams cannot become successful drafts. No unsupported image/video/audio generation claims. Code supports a bounded, explicitly approved text request, but integrating its output into project artifact/provenance and budget workflows is a separate step.

## Verification and release gates

Tests use generated local cryptographic fixtures and injected fetch, browser, storage and clock interfaces. They do not prove a live ChatGPT account can sign in or infer. Real desktop verification must separately obtain user approval for persistent access, run browser consent, discover models and complete one agreed text request. The user's distribution eligibility must also be settled before release. Native OS keychain availability and a real sign-in have not been verified in this implementation environment.

## Implementation checkpoint

The desktop provider includes real OAuth callback/token/refresh/revocation and public-model/SSE transports as code. Its runtime obtains native confirmation before registration or an inference request. No official code or dependency was copied into this repository; the implementation uses existing Node/Electron/React capabilities and protocol documentation.

`generateText` is main-process-only. A trusted project adapter must supply `beforeSend`, which durably reserves the operation after native approval but before inference HTTP. Successful output includes the operation ID, profile ID, model, completion timestamp and `sha256` of `JSON.stringify({model,text,instructions:instructions ?? ""})`. The adapter persists that output and returns a sidecar-verified proposal rather than letting the renderer counterfeit provider success. Cross-restart deduplication and the project/episode/base-script binding belong to this durable proposal ledger. Runtime memory also prevents repeated submission of an operation ID within the current process. Once inference has been attempted, any failure remains `REMOTE_UNKNOWN`; it is not silently retried.

Initial native UI checks found unavailable secure storage in the cloud Linux session. With explicit user approval, a proper D-Bus session and the installed KWallet6 backend were started; the user created and unlocked the wallet privately. A first initialization timed out while awaiting that input. A normal AIVORA restart inside the same live secure session then enabled the official connection action (2026-10-08). No plaintext fallback, wallet reset, password inspection or OAuth action was used. Preserve this session during development restarts; ending it may require another user unlock. The earlier `/proc` environment-presence probe was inconsistent with the subsequently proven live session and must not be used as authoritative evidence of a missing bus.

Source/type/fixture checks and keyring readiness do not prove live authentication, distribution eligibility, OAuth-token persistence, or real model inference. The actual account and model catalog remain unknown until separately authorized live verification.

## Authorized live login attempt (2026-10-08)

After the user separately approved personal-local registration, account identity/email access, plan-use/refresh permission and encrypted persistence on this cloud computer, the native app opened the documented OpenAI authorization endpoint in this computer's system browser. That browser could not load the sign-in form: `auth.openai.com` returned Chromium `ERR_CONNECTION_REFUSED`, unchanged after one normal reload of the same pending attempt. No password or official consent was entered, no completed account grant/token response was received, and no inference was requested. The pending local attempt was cancelled and the UI verified disconnected, with secure storage still available.

This establishes a native-browser connection blocker, not a credential problem, CAPTCHA classification, or proof of a service-wide outage. No proxy/security configuration was changed and no alternative authentication endpoint was used. The authorized login remains unverified until the official endpoint is reachable in a supported execution/browser arrangement on the callback host. Do not reuse or publish the abandoned authorization URL; a later permitted retry must create fresh state/nonce/PKCE.

## Read-only connection diagnosis and UI clarification

On 2026-10-08, a bounded diagnostic executed from the actual graphical desktop found public DNS resolution for `auth.openai.com`, `api.openai.com`, and `chatgpt.com`. Ordinary TCP connections to HTTPS port 443 failed for both the authorization host and the ChatGPT control host; Python reported the final connection error as `ENETUNREACH` (101). The inspected Chromium main command line contained no explicit proxy flag, and the graphical shell had no HTTP/HTTPS/ALL_PROXY variables. This does not establish the exact firewall/system-proxy policy or its owner. No HTTP request, authorization retry, proxy change, DNS override or network-security change was made during that diagnostic.

The actionable prerequisite is a supported, working HTTPS network path for the native desktop/browser, to be restored through the environment's supported administration route or verified on an already-reachable AIVORA desktop host. Changing the eligibility declaration, wallet password or ChatGPT plan cannot establish network connectivity. An OAuth callback still needs the browser and AIVORA to run on the same host; do not copy abandoned authorization URLs to another computer.

The preparation UI now labels the declaration “软件使用方式（接入资格）”, explains that account plans and permissions are confirmed separately by OpenAI, and does not auto-select a scope or consent. Browser-launch failure, missing local callback listener, expired authorization, explicit cancellation and unconfirmed connection have distinct guidance. Expiration is no longer mislabeled as user cancellation. The app does not claim to observe a system browser's network error; general unreachable-page help instructs a deliberate retry after connectivity is restored.
