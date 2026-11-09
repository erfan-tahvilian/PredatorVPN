# Changelog

## v2.0.2 - 2026-11-09

- Windows profile migration falls back to copy when rename is blocked (fixes EPERM startup crash when the previous profile folder is locked).
- Keeps the 2.0.1 desktop sign-in helper, image CAPTCHA fallback, and macOS legacy-profile retirement.

## v2.0.1 - 2026-11-09

- Desktop account sign-in uses a browser-matching TLS helper so login and OAuth token exchange are accepted by the account provider (fixes HTTP 406 after verification).
- When the account provider requires an image CAPTCHA, sign-in falls back to the in-app CAPTCHA form and still completes token exchange with the TLS helper.
- Profile migration retires leftover legacy directories so macOS restarts after Command-Q no longer fail when both profile folders exist.
- Challenge recovery, cookie handling, and OAuth fallbacks for edge checks on desktop.

## v2.0.0 - 2026-11-06

- Redesigned desktop and Android interfaces.
- Ten accent palettes and refreshed connection controls.

## v1.0.3 - 2026-11-05

- Improved connection reliability when proxy-pass renewal is temporarily unavailable.
- Automatic, bounded recovery after unexpected Windows tunnel engine termination.
- Clearer Windows connection warnings that do not disclose destination traffic.

## v1.0.2 - 2026-10-31

- Theme-matched dialogs, app pickers and desktop tray surfaces.
- Stronger compatible ZIP and APK compression with full payload verification.
- Native GitHub source archives replace the redundant custom source archive; sing-box source and both checksum manifests remain available.

## v1.0.1 - 2026-10-31

### Package maintenance update

- Smaller Windows installers, macOS disk images and Linux AppImages with the complete application payload retained.

### Navigation maintenance update

- Open Overview at the top after selecting a location on desktop and Android.

### Release features

- Device-matched update notifications with direct downloads.
- One-time release highlights after installing a new version.
- Responsive Android location selection and connection during latency checks.
- Android back navigation through dialogs and Overview.
- Complete, versioned releases with only the latest binary downloads retained.

## v1.0.0 - 2026-10-11

### Maintenance update - 2026-10-29

- Improved service account service verification and sign-in reliability.
- Preserved email and authenticator verification during sign-in.

Initial release for Windows, macOS and Android.

