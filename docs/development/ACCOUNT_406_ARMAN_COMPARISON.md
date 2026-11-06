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
