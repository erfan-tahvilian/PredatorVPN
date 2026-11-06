# Account sign-in HTTP 406 — Arman VPN comparison and verification

**Branch:** `feature/predator-v2`. This is a local owner-review fix; no public release or main merge without approval.

## Source comparison

Reference: https://github.com/armanlife/arman-vpn-client

Arman's source files `core/internal/fxa/fxa.go`, `core/internal/fxa/signin.go`,
`core/internal/fxa/challenge.go`, `core/internal/fxa/normalize.go`,
and `core/doc/AUTHENTICATION.md` implement the FxA API login, provider
verification, email-code/TOTP and token issuance. The API may return an
**empty HTTP 406** for a rejected POST while hosting an interactive
Client Challenge separately on the account website. An empty API
response alone is not evidence that no challenge page exists.

Predator previously terminated immediately on an empty 406 and displayed
"Sign-in was rejected ... before your password could be verified."
It already had code for the separately hosted challenge but did not
invoke it for that case. In the revised control plane, the same
request's session resolves the provider challenge, retains the resulting
cookies, and retries only a verified 406 edge rejection with a strict
limit. Structured JSON errors do not trigger this retry. A network
reset never automatically replays a POST, and a failed verification
does not automatically resubmit a password.

## Evidence from BlackPredator (2026-11-06)

Tests used only a fresh isolated session and a synthetic address ending
in `@example.invalid`; no actual user password was requested, used,
logged or retained.

- Account website GET: **HTTP 200 with Client Challenge**.
- Challenge completion: **successful**.
- Repeat website GET: **HTTP 200 without challenge**.
- Synthetic account POST, using the revised sign-in code: **HTTP 400,
  provider errno 102**, not HTTP 406.
- Two provider session-verification cookies were observed (names only,
  never values).

This validates that the previous HTTP 406 edge barrier can be resolved
on the owner's network. It does **not** validate successful sign-in
with an actual authorized account, email-code verification, OAuth
issuance, entitlement or long-running connectivity. Those require
owner acceptance testing.

## Further compatibility fixes

- Preserve and retry the provider's canonical letter case when the API
  returns errno 120; do not change the password derivation formula.
- Retry without the requested email-code verification method only
  when the API explicitly returns errno 107.
- Normalize Persian/Arabic digits and invisible separators in manually
  entered verification codes.
- Completely remove the incompatible hosted browser-login flow, its local
  callback server, public renderer and IPC channels, and outdated screenshot.
  Preserve the in-app account sign-in and existing encrypted account records.
- Preserve all user credentials and active VPN tunnel state.

## Regression and boundaries

- Bounded 406 handling, structured-406 error preservation, no replay
  after challenge failure, canonical email case, and digit normalization.
- Main process, renderer and tray smoke tests.
- No user credentials, bearer tokens, challenge cookies or saved
  account records in the test output.
- For human verification, enter credentials only inside the trusted
  local app. Do not share passwords or OTPs in GitHub issues/chat.

Historical reference to a provider's account API in code and developer
documentation is a technical integration detail, not Predator branding.

## In-app sign-in parity work

The account UI supports email and password, provider-confirmed email code,
TOTP, legacy email confirmation link, provider 'unusual sign-in' unblock
code (errno 125), canonical account email casing (errno 120), and a bounded
human-solved image CAPTCHA when the provider actually supplies one.
All verification prompts are presented in Predator VPN, not in an external
browser. Access and refresh tokens remain OS-encrypted; the password is never
written to disk and an unblock-code pending password is kept only in memory
for up to 15 minutes. Completed sign-in attempts destroy the short-lived
provider session on a best-effort basis. Already-consumed OTPs are not
replayed after network or token issuance errors.

This is independent implementation of the supported interaction stages
described in the Arman documentation, not an unrestricted clone. Arman's
browser/TLS impersonation, automatic storage of account passwords, and
device identity impersonation are not adopted.

**Verification status:** tests use fixtures and synthetic accounts. A
successful authorized real-world sign-in, account entitlement, and stable
VPN traffic still require user acceptance testing. A provider-side
anti-abuse decision, unsupported OAuth client, denied access scope or
unavailable challenge cannot be remedied by rewriting the renderer.
Do not claim such conditions are solved unless the provider accepts them.

## November 6 follow-up: exact provider verification failure classification

The owner still receives the generic account-provider verification message,
despite in-app CAPTCHA, unblock code and email/TOTP support.

Credential-free, **GET-only** diagnostics on BlackPredator showed:
- \`api.accounts.firefox.com/\`: HTTP 200, JSON response.
- \`accounts.firefox.com/\`: HTTP 200, a challenge page is offered.
- Fetching its verification \`script.js?reload=true\` from the same
  Node Control cookie jar (one cookie, never logged): HTTP **400**,
  empty response. This does **not** prove the installed Chromium
  transport fails identically and cannot identify the policy reason.
- No user credentials, session tokens, challenge tokens, cookies,
  CAPTCHA answers or private account data were used or stored.

The prior code threw one generic message for all \`challenge()\` errors,
concealing both the failing stage and HTTP status. The updated code
classifies known locally generated errors, including rejected verification
script, rejected challenge response, unavailable provider challenge,
and interrupted network requests, without propagating remote bodies
or sensitive values to the UI. No new anti-bot circumvention or
credential replay logic was introduced.

**Acceptance criterion still outstanding:** a real account must pass
provider verification, receive authorized OAuth tokens, and access
the FPN service without HTTP 406. An external provider refusal or
unsupported third-party client may require provider authorization.
Do not report authentication as fixed on the basis of read-only
network probes or successful fixture tests alone.

## Session verification compatibility improvement (Windows preview, November 6)

After comparing with Arman's session verification sequence, the client now
checks `/v1/recovery_email/status` before exchanging a legacy email-link
session for an OAuth token. The request uses Mozilla Accounts' documented
prefixed Bearer session authentication (`fxs_`) and carries no request body.
A response must explicitly contain `verified: true`; any other response
leaves the account sign-in pending without discarding existing credentials.

Automated coverage includes: still-unverified sessions, verified sessions,
invalid tokens, malformed server responses and omitted Content-Type on GET.
There are **no** credentials or tokens in diagnostics.

**Not resolved:** the initial HTTP 406 account-login rejection. This patch
cannot make an unregistered independent client a Firefox-native client; it
does not replay WebChannel session tokens or automate the provider's anti-bot
challenge. The user must validate any actual sign-in before a broader release.

Official references:
- https://mozilla.github.io/ecosystem-platform/reference/authentication-schemes
- https://mozilla.github.io/ecosystem-platform/reference/tokens

## Cancel/timeout session isolation (Windows owner-preview follow-up)

A separate review of the existing Electron authentication lifecycle revealed
that a delayed login, verification, or OAuth response could outlive a
`cancelAccountLogin` event. A late OAuth response could otherwise attempt
to save credentials after the owner cancelled the account flow.

The Windows implementation now uses a generation check for password login,
locks each pending verification while its network and token exchange is in
flight, and checks pending-session identity before persisting any account.
An expired verification session is rejected, and discarded sessions receive
best-effort session-destroy calls. The existing encrypted account vault,
in-app email/TOTP flow, and installed-app migration remain unchanged.

Added deterministic regression tests for late login response after Cancel,
late OAuth response during account replacement, overlapping verification,
and expired sessions. These tests are local fixtures, **not** proof that
Mozilla will authenticate Predator or grant an FPN entitlement.

The Arman browser sign-in uses Firefox-specific WebChannel behavior,
a Firefox user-agent identity and client identifiers. Those are not
transplanted into Predator without an approved Mozilla OAuth registration.
Mozilla's independent RP documentation requires registered credentials and
redirect URIs. The initial HTTP 406 or provider challenge refusal therefore
remains an external integration constraint pending a real authorized test.
No public release or stable tag is changed by this work.

## Provider-hosted Browser Sign-in: registered-client implementation

**Status:** Implementation preview, not a verified production login. This
workflow deliberately does not claim that the original HTTP 406 is resolved.

Arman's browser mode injects a Firefox WebChannel bridge into a WebView,
selects the `fx_desktop_v3` Firefox Sync context, advertises a Firefox
User-Agent, accepts an `fxaccounts:login` session token from the page,
waits for verification, and exchanges the session using Firefox's
native client identity. That approach depends on Firefox-specific
integration; mimicking its browser identity or reusing its OAuth
client registration is not an authorized alternative for Predator.

The Windows owner-preview implements the supported equivalent:
- Provider-hosted login in a sandboxed and isolated Electron window.
- Authorization Code + PKCE S256, independent state and nonce.
- Exact registered HTTPS redirect validation and OAuth state verification.
- Token exchange performed only in the Electron main process.
- Provider profile lookup and FPN pass validation **before** an account is
  marked as signed in or written to the encrypted vault.
- Independent registered OAuth client identity retained for token refresh.
- Fifteen-minute timeout, explicit cancellation, bounded navigation, denied
  new windows and no renderer access to tokens or credentials.

### Required provider integration

Mozilla's 2026 integration guide says that clients must be provisioned by
the Mozilla Accounts/FxA team. Provider authorization of the VPN scope is
also needed; a generic profile-only login is insufficient. Without those
credentials, the Browser Sign-in button explicitly reports that the
integration is not configured rather than imitating Firefox or reporting a
successful login.

After Mozilla authorizes a separate OAuth public client for Predator VPN,
the Windows-only local configuration may be placed at:

`%APPDATA%\Predator VPN\mozilla-client-registration.json`

Example keys (not working credentials):

```json
{"clientId":"<registered independent public OAuth client ID>",
 "redirectUri":"https://<registered-host>/<registered-callback>"}
```

**Do not paste sample values, Firefox-native identifiers, passwords,
refresh tokens or OAuth client secrets into this file.** The redirect URI
must exactly match the provider's registration. This is not a mechanism
for self-registration or bypassing provider policy.

Reference: https://mozilla.github.io/ecosystem-platform/relying-parties/tutorials/integration-with-fxa

Test coverage uses mock OAuth responses. A real account with a valid
third-party registration, scope grant and FPN entitlement is still required
for integration acceptance. The current release/tag remain unchanged.

## WebChannel protocol review (2026-11-06)

Current Mozilla documentation distinguishes two independent messages:
- Legacy `fx_desktop_v3` uses `fxaccounts:login` and returns a session token.
- Current `oauth_webchannel_v1` uses `fxaccounts:oauth_login` and returns
  an authorization **code** and `state`. The native Firefox Desktop OAuth
  client ID in that documentation is `5882386c6d801776`.

Added `src/lib/fxa-webchannel-protocol.cjs` as a standalone,
side-effect-free decoder. It rejects invalid origins, malformed payloads,
wrong OAuth state and unexpected redirect values. It distinguishes
provider session tokens from actual OAuth authorization codes; no account
is stored on receipt of a message. Its three unit tests are included in
the standard suite.

**Integration status:** Protocol decoder only; not wired to BrowserWindow
or the live login pipeline. It does not change the Browser Sign-in
registration requirement, make a client appear to be Firefox, bypass
anti-bot HTTP 406, or establish provider authorization. The installed
Windows binary is unchanged until owner acceptance.
The complete test suite passed (134/134), and a repeated smoke run
passed after one timing-sensitive Tray Popup failure.

Official sources:
- https://mozilla.github.io/ecosystem-platform/fxa-sitemap/entry-modes
- https://mozilla.github.io/ecosystem-platform/reference/webchannels
