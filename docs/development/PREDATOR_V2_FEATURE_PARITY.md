# Predator VPN 2.0 — Feature and UI parity (pre-release)
 
> Branch: `feature/predator-v2`. Public latest remains `v1.0.3`. This is a local Windows preview, **not** evidence of long-duration VPN stability or a released Android package.
 
## Interaction map
 
| Capability | Real controls / rendering | Backend |
|---|---|---|
| Connect, disconnect, cancel, system/proxy-only state | Overview power `#connect`, `#mode-label`, `#status-label`, `#connection-title` | Electron `connect/disconnect/cancel`; Android native VPN service |
| Selected and recommended locations | `#choose-location`, `#choose-location-arrow`, `#choose-recommended-home`, `#recommended` | `select`, actual `servers` and `serverId` |
| Location search, latency and sorting | `#server-search`, `#server-sort`, `#ping-servers`, `#server-list` | `servers`, `ping`, `locationSort` |
| Connection details and address verification | `#connection-health`, IPv4/IPv6, `#protocol-name`, `#verify-exit` | Actual connection state, `exit`, HTTP/2 and HTTP/3 |
| Quota and usage | `#allowance-ring`, `#allowance-progress`, `#refresh-allowance`, `#traffic-metrics` | Real quota and traffic ledgers; no fabricated allowance |
| Login and verification | `#login-form`, `#code-form`, `#logout` | `login`, `verify`, `logout` |
| Multi-account management | `#accounts-list`, `#add-account`, `#account-auto-switch` | `selectAccount`, `removeAccount`, `accountPreferences` |
| Appearance | `#theme`, `#theme-toggle`, 10 `[data-accent]` cards | `theme`, `accentColor`; persists without disconnect |
| Connection preferences | `#settings-connection`, `#proxyOnly`, `#transport`, SOCKS, edge | `settings` (network changes require disconnect) |
| Private DNS and split tunneling | `#settings-dns`, `#split-tunneling`, `#choose-apps` | `settings`, `apps`, `appIcon` (desktop); Android app picker |
| Upstream proxy | `#settings-upstream` | `settings` |
| Diagnostics | `#recent-activity`, `#log-list`, `#log-filter`, export/clear | `clearLogs`, `exportLogs` where available |
| Updates and release notes | Update dialog / tray | `checkUpdates`, `releaseNotes`, `downloadUpdate` |
 
## Design implementation
 
- Desktop DOM intentionally separates connection status, location destination panels, and allowance/metrics into independent structural regions; Settings uses its own side navigation.
- Android packs the same functional controls in a phone-first vertical hierarchy, bottom navigation, and touch targets; Quick Settings tile remains an Android OS-only control.
- `theme-v2.css` owns theme-dependent semantic accent variables and preserves semantic success/error colors. A separate geometrical smoke test checks every palette and switch geometry.
- Mobile `About` insertion uses the Settings footer's actual parent to avoid invalid DOM insertion after structural changes.
 
## Credential lifecycle
 
- Short-lived upstream proxy credentials are required. Initial connection gets a pass, scheduled renewal happens before expiration, and reactive authentication rejection can prompt a fresh pass.
- Concurrent scheduled renewals now share the same in-flight promise and only one successor timer exists; stale results from an old session must not apply to a newer connection.
- Temporary account-service failures back off with jitter without tearing down an otherwise healthy tunnel. Explicitly confirmed quota exhaustion may end the session or invoke account switching.
- No guarantee of uninterrupted connectivity can be made without a hardware/network soak test of the installed preview; network failures and upstream outages remain possible.
 
## Automated checks and boundaries
 
- `node scripts/test.cjs`: unit/integration tests including authentication renewal, stale generations and tunnel supervisors.
- `node scripts/smoke-runner.cjs`: real Electron IPC/security/tray/accounts/update renderers plus desktop and native-scale mobile WebView geometry and screenshots.
- `node scripts/verify-distribution.cjs`: Windows x64 packaged installer and portable ZIP payload validation.
- Android native emulator/device tests and signing are **not** part of Windows-only preview delivery; they remain required before any cross-platform public release.
 
## Review screenshots
 
Actual renderer captures created by the new desktop/mobile structural test (fixtures are test-state data; not screenshots of an established VPN connection):
 
- `docs/screenshots/predator-v2-overview-dark.png`
- `docs/screenshots/predator-v2-settings-dark.png`
- `docs/screenshots/predator-v2-mobile-overview.png`
- `docs/screenshots/predator-v2-mobile-settings.png`
 
**Do not merge, tag, publish or upload v2 binaries until the owner approves the local preview.**
