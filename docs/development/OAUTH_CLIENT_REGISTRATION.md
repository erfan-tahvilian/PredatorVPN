# Predator VPN — provider-authorized browser sign-in

## Status and critical prerequisite

The old Mozilla VPN browser-login-to-FPN adapter has been replaced with a
**standards-based OAuth 2.0 Authorization Code + PKCE S256** native-app client.
The former browser flow used a different product's login service and did
not have a registered Predator VPN redirect. It could open a login page
without ever returning usable FPN credentials.

**There is no verified provider-issued OAuth client ID registered for
Predator VPN in this project.** A Firefox Desktop client ID
(`5882386c6d801776`) is not valid registration for this application.
Do not use IDs belonging to Mozilla Firefox, Thunderbird, Arman or
other clients.

The browser sign-in option is shown disabled, with the reason visible,
until a valid local client configuration is provided. This deliberately
prevents false success indicators, arbitrary browser-callback timeouts,
or tokens with no FPN access.

Mozilla's current relying-party integration rules require requesting
OAuth registration and approved redirect URIs from the Mozilla Accounts
team; the developer must also obtain authorization to access any
third-party FPN service entitlements:

- https://mozilla.github.io/ecosystem-platform/relying-parties/tutorials/integration-with-fxa
- https://mozilla.github.io/ecosystem-platform/reference/oauth-details
- https://www.rfc-editor.org/rfc/rfc8252

## Register an authorized native client

With the identity/service provider, request:

- Application name: **Predator VPN**
- Integration type: public/native desktop client
- Authorization Code grant + PKCE S256 (no embedded client secret)
- Registered loopback redirect, e.g.
  `http://127.0.0.1:43171/callback`
- Profile/email permission and **explicit authorization for FPN**, not
  merely the different Mozilla VPN subscription/service
- Offline token rotation for maintaining a signed-in native session
- Approval of any required FPN service resource scope

The provider may refuse new registrations or may not make its FPN service
available to independent relying parties. A successful browser login
alone cannot override that decision.

## Configure locally after provider approval

The native app keeps its existing encrypted account-vault location for
migration compatibility. Create the following **local** configuration
file only after the provider has issued a separate public client ID:

`%APPDATA%\Fox VPN\oauth-client.json`

Example (replace with real, approved values; these are NOT credentials):

```json
{
  "clientId": "0123456789abcdef",
  "redirectUri": "http://127.0.0.1:43171/callback",
  "scope": "profile https://identity.mozilla.com/apps/vpn"
}
```

Do **not** use the sample client ID. The scope above must be approved
for the registered client **and accepted by FPN**; it is only an example.
Restart Predator VPN after saving the file.

Never put a client secret, password, refresh token, access token, or
authorization code into this JSON file or the source repository.

## Callback and authorization guarantees

The app binds a local HTTP listener on the exact registered IPv4
loopback port **before** opening the system browser. A cryptographically
random `state` is checked on every callback, and PKCE `S256` ensures the
code can only be exchanged by the initiating app instance.

Only a `GET /callback` from `127.0.0.1` with a matching Host and state
can be accepted. Missing callback, denied consent, occupied port,
failed code exchange and cancellation have explicit failure messages.
No token is taken from the URL fragment or from browser cookies.

Before an OAuth account is persisted in the OS-encrypted vault, the app:

1. Exchanges a one-time code for an access token using the registered
   client ID, redirect URI and locally generated PKCE verifier.
2. Calls `https://vpn.mozilla.org/api/v1/fpn/status` with the bearer
   token and requires a successful response.
3. Calls the provider profile endpoint to obtain the account email.
4. Only then adds or updates the account in the encrypted local store.

If authorization or FPN entitlement fails, the previous account and
an existing VPN connection are preserved. Provider authorization is
an external prerequisite and cannot be guaranteed by app code alone.

## Validation still required

Automated tests cover approved-client configuration, rejecting browser
IDs, callback-state mismatch, PKCE exchange, invalid token, timeout,
cancellation and OAuth refresh. They use only synthetic fixtures.

**Real-world browser sign-in has not been proven** without a
provider-approved Predator VPN client, registered redirect URI, scope
and a user account with actual FPN entitlements. Do not release 2.0.0
based only on fixture tests.
