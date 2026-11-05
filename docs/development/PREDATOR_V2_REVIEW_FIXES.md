# Predator VPN 2.0.0 — owner review fixes (local preview only)

**Branch:** `feature/predator-v2` (never merge or publicly release without owner approval)
**Scope:** The nine reports in the November 6, 2026 review.

## Changes and verification

1. Connected status emblem uses semantic green background and border, independent of accent color; checked in Electron DOM geometry test.
2. Accent selector and ten preset cards have a visible 12 px gap, checked by the actual renderer.
3. Total Transferred uses a bidirectional upload/download symbol.
4. Account verification resumes token acquisition without re-submitting an already accepted one-time code.
5. Owner's updated `PredatorVPN-Light.png` is copied byte-for-byte to `assets/logo-light.png`, used by desktop, mobile and README dark-theme references; new real screenshots regenerated.
6. Account service requests use separate nonpersistent Chromium sessions with direct browser-proxy mode. Temporary GET/HEAD transport errors may use a bounded fallback, but one-time-code and other POST requests are **never** automatically replayed. This cannot bypass an operating-system-level VPN tunnel or replace any provider-required interactive verification.
7. Light-theme swatch labels, filled primary buttons and checked switch thumbs use readable colors. Offscreen knob background transitions are disabled to prevent a stale dark thumb.
8. Connecting/Cancel power animation, rings, glow and orbital points use live accent tokens. Status green remains semantically separate.
9. Tray popup avoids repeated hide/reopen when right-clicked while visible; concurrent clicks coalesce, CSS animates the menu appearance, and all ten themes apply to tray controls while connected status remains green.

## QA

- `node scripts/test.cjs`: 96 tests passed.
- `node scripts/smoke-runner.cjs`: renderer, main IPC, accounts, updates, tray and desktop/mobile layout checks passed.
- `node scripts/validate-package.cjs`: packaged source, assets, engine, driver, licenses, version and Admin manifest validated.
- `node .tools/validate-preview.cjs`: all 82 installer payload files verified against local unpacked build.
- Local Windows installer: `D:\GitHub\FoxVPN\dist\PredatorVPN-2.0.0-Windows-x64.exe`.
- Installer SHA256: `F5A1B009969A3374C5CAFCAC4CD47036E02D65B25294D6892EFE16922344A3C5`.
- Installed app version 2.0.0, `app.asar` SHA256 equals local Build, main window launches and responds.

## Important limitations

- The account provider's live email verification service and its browser challenge have **not** been tested with a real account, code, or while the Windows tunnel is actively connected. Do not claim these intermittent failures are fully eliminated until the owner retries.
- Long-duration tunnel stability and Android on-device validation remain outstanding; unit and renderer tests do not prove uninterrupted connectivity.
- Public Latest remains `v1.0.3`; `v2.0.0` must not be published without explicit owner confirmation.
