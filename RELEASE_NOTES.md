# Predator VPN v2.0.2 — Windows, macOS, Linux & Android

An independent VPN client for Windows, macOS, Linux and Android, built on third-party VPN infrastructure and remote VPN edge servers.

## Changes in 2.0.2

- **Windows profile migration:** Moving the previous profile folder no longer fails with `EPERM` when files are briefly locked. The app copies the profile when rename is blocked so startup continues.
- **Service availability (HTTP 451):** When the VPN service API is blocked for the current network location, the app reports a clear error and routes those API calls through the system proxy when one is configured.
- **macOS profile migration:** Leftover legacy profile folders are still retired safely after Command-Q.
- **Account sign-in:** Desktop login keeps the browser-matching TLS helper, in-app image CAPTCHA fallback, and OAuth token exchange from 2.0.1.

## Included features

- **Account sign-in:** Email/password with email or authenticator verification codes when required.
- **Multiple service accounts:** Choose the active account or switch automatically after confirmed data-allowance exhaustion.
- **Persistent traffic statistics:** Monthly allowance, last-session transfers and cumulative traffic on this device.
- **Flexible app routing:** Selected-app and exclusion modes with a searchable app picker.
- **Connection controls:** Real HTTPS delay checks, saved locations, and IPv4/IPv6 when available.
- **Adaptive transport:** HTTP/2 over TLS or HTTP/3 over QUIC with automatic healthy-path selection.
- **Android Quick Settings:** Connect from the tile with live transfer information in the notification.

Licensed under the GNU General Public License, version 3 or later. Independent dependencies retain their original licenses and notices.

## Downloads

Download the versioned assets for your platform below.
