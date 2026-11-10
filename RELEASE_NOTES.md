Predator VPN 2.0.3 improves account usage reporting, phone navigation, and connection recovery.

## Changes in 2.0.3

- **Android Overview:** The selected location now appears inside the main connection card immediately beneath the power button. The flag, destination name, measured latency, Ping and location selector remain aligned in a single compact row.
- **Data Allowance:** Refresh now handles status and quota retrieval as a complete operation. Android no longer silently accepts an incomplete quota response as a successful refresh; desktop account requests automatically use a temporary bootstrap on HTTP 451.
- **Bootstrap subscriptions:** Add, remove and reorder as many subscription URLs as needed. Two sources are preconfigured: the automatically refreshed PredatorVPN GitHub Raw list and the public 0xRadikal top100 list.
- **Ping and account services:** Desktop Ping, account usage, pass renewal and other Guardian API requests share the HTTP 451 recovery path; temporary bootstrap proxies are cleaned up after use.
- **Stability:** Network checks prevent overlapping connection and Ping operations, and automated coverage includes subscription fallback, quota handling and concurrent requests.

## Included features

- Multiple accounts with usage summaries and session statistics.
- Automatic or manually selected locations with measured HTTPS latency.
- HTTP/2 and HTTP/3 transport options with private DNS and split tunneling.
- Android Quick Settings tile and notification-based connection controls.

Licensed under the GNU General Public License, version 3 or later. Independent dependencies retain their licenses.

## Downloads

Use the versioned installation packages attached to this release. Older release assets are retired only after the complete new release has been validated.
