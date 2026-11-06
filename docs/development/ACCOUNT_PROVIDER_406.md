# Predator VPN — Account service refusal (HTTP 406)

## Verified observation — 2026-11-06
On the owner's Windows desktop, using a fresh nonpersistent Electron session with Chromium proxy mode `direct` and an address under reserved `example.invalid` (no personal credentials):

- `GET https://api.accounts.firefox.com/` returned **HTTP 200** and normal JSON.
- `POST https://api.accounts.firefox.com/v1/account/login` returned **HTTP 406**, no content type, and no client-challenge HTML.
- The original `Control.json()` treated every 406 as a solvable Fastly client challenge and tried `Control.solveChallenge()`, which could only end with `Could not complete service verification. Try again later.`
- The earlier isolated Chromium session change corrected application-level proxy isolation but did not change the provider's HTTP 406 policy.

This confirms a rejected POST in the observed environment. It does *not* prove the exact provider-side reason for the block. Fastly documents HTTP 406 as a possible default request-blocking response:
https://www.fastly.com/documentation/guides/next-gen-waf/agent-response-codes/about-agent-response-codes/

## What the implemented fix does
- Distinguishes an empty 406 block from an actual HTML challenge before attempting any challenge handling.
- Returns an explicit `ACCOUNT_PROVIDER_BLOCKED` status, not a misleading generic verification error.
- Does not automatically retry the POST or re-submit a password/OTP when blocked.
- Retains existing encrypted accounts and ongoing VPN sessions; the user can retry when the provider supports authorization.
- Does not spoof or try to circumvent the provider's rejection. This is **not** a successful login fix until legitimate authentication works end to end.

## Added provider-hosted browser sign-in (desktop preview)
The official Mozilla VPN open-source client implements a hosted login with a
short-lived PKCE verifier, a browser opened at
`https://vpn.mozilla.org/api/v2/vpn/login/{windows|macos|linux}`,
a callback on `127.0.0.1`, and a code exchange at
`https://vpn.mozilla.org/api/v2/vpn/login/verify` to receive a bearer token.
Sources:
https://github.com/mozilla-mobile/mozilla-vpn-client/blob/main/src/authenticationlistener.cpp
https://github.com/mozilla-mobile/mozilla-vpn-client/blob/main/src/tasks/authenticate/desktopauthenticationlistener.cpp
https://github.com/mozilla-mobile/mozilla-vpn-client/blob/main/src/tasks/authenticate/taskauthenticate.cpp

A random-code, no-account public GET on the owner's Windows machine returned
HTTP **302** from that official browser login endpoint to the hosted
`accounts.firefox.com/authorization` page; no user credential was sent.

A desktop option `Continue securely in your browser` now uses the provider's
hosted flow, not the failing direct password POST. It includes PKCE S256,
an ephemeral loopback receiver, restricted URL paths, callback timeout and
cancellation, strict validation of the code exchange and no secret logging.

**Critical cross-product limitation:** Existing Predator VPN proxy service
requests `/api/v1/fpn/*`, whereas the hosted login portal is intended for
`/api/v2/vpn/*` (Mozilla VPN service). The analogous FPN hosted login
endpoint returned **HTTP 401** in a public check. Token interoperability
between these separate products is therefore **unverified**.
The new browser login checks the bearer against `/api/v1/fpn/status` before
saving an account. If unauthorized, the user receives a clear error and the
current account remains untouched. Provider cooperation or a supported FPN
authorization flow is required if the Guardian VPN token is refused.

## Required production authentication route
Mozilla's current integration instructions (last updated August 2026) say Mozilla Accounts integration is available to Mozilla groups on request. A relying party must be issued its **own registered OAuth client** and matching redirects:
https://mozilla.github.io/ecosystem-platform/relying-parties/tutorials/integration-with-fxa

For a legitimately registered Predator VPN OAuth client, implement hosted browser authorization with Authorization Code + **PKCE S256**, strict `state` checking, an allowlisted registered redirect URI, an isolated loopback receiver or protocol callback, secure authorization-code exchange, and OS-protected refresh token storage:
https://mozilla.github.io/ecosystem-platform/reference/oauth-details

The existing hard-coded OAuth client ID `5882386c6d801776` is registered to **Firefox** with a Firefox WebChannel redirect; it is not a Predator VPN client registration. Its public metadata was checked via:
`https://oauth.accounts.firefox.com/v1/client/5882386c6d801776`

In addition to a provider-issued client ID, the provider must authorize the VPN-specific entitlement scopes consumed by Guardian. An arbitrary OAuth token for the `profile` scope is not sufficient to access the VPN service.

## Owner acceptance criteria
1. Provider-approved browser login completes without entering a password into the Predator VPN renderer.
2. Email code, TOTP and provider-hosted interactive challenges work via the service's supported pages.
3. Successful redirect returns a valid token and the service confirms the correct VPN entitlement; no account data is logged.
4. Adding an account does not disturb an existing VPN tunnel.
5. Returning from failed/cancelled provider login does not change the active account.
6. Connection-reset errors never replay OTP POSTs, and raw provider blocks are explained accurately.
7. Windows and Android authenticate independently with correctly registered redirects for their platforms.

Never put user passwords, session keys, bearer tokens, or OAuth authorization codes into issue reports or public logs.

## Follow-up: browser did not return after hosted sign-in (November 6, 2026)

The owner's browser appeared to complete a sign-in but Predator VPN received no callback. This does not establish that the Mozilla VPN hosted flow can authenticate an FPN proxy account. The callback handoff is now instrumented separately from the final entitlement check.

The local callback receiver previously bound to IPv4 `127.0.0.1` only and rejected `localhost` or IPv6 `[::1]` Host values. The revised listener binds **both IPv4 127.0.0.1 and IPv6 ::1** on a single ephemeral port when supported, accepts either loopback Host value, and rejects non-loopback origins, unrecognized paths and invalid codes. The callback page does not expose the code. Upon receipt the desktop window is brought forward and displays the actual stage of sign-in. The UI reports waiting, code received, provider verification and entitlement checking; when no callback arrives within eight minutes, it shows an explicit timeout instead of silently hanging.

The tests use only synthetic authorization codes and tokens. They pass for localhost/loopback callbacks, PKCE verification, cancellation and timeout; **real provider completion and FPN entitlement remain unverified**. Do not claim login is fixed by the new callback path alone. If provider-side policy, account type or authorization redirect prevents a code from being returned, the supported remedy requires provider cooperation or a correctly registered client.
