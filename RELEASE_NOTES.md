# Predator VPN v2.0.1 — Windows, macOS, Linux & Android

An independent VPN client for Windows, macOS, Linux and Android, built on third-party VPN infrastructure and remote VPN edge servers.

## Changes in 2.0.1

- **Account sign-in fix:** Desktop login and OAuth token exchange use a Firefox-TLS helper so the account provider accepts verification instead of returning HTTP 406 after a successful challenge.
- **Challenge recovery:** Improved Fastly challenge handling, cookie coverage, and token refresh on desktop packages.

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
