Predator VPN 2.0.4 improves service reachability using the Arman-compatible double-leading-slash Guardian API request retry. Subscriptions are opt-in and disabled by default.

## Version 2.0.4 — Regional access and subscription controls

- Guardian HTTP 451: retry the affected Guardian endpoint once using the Arman-compatible double leading slash (//api/v1/fpn/...) with the same HTTPS method and credentials. This workaround depends on service behavior and is not guaranteed.
- Subscriptions: new opt-in Enable subscriptions switch, disabled by default, with two preconfigured links and unlimited additional sources. When enabled, a failed double-slash request can use the temporary subscription proxy.
- Android: retains previous data allowance, first-Ping improvements, and compact selected-location controls; VLESS Reality/gRPC temporary transport supports uTLS.
- Windows, macOS, Linux and Android: unified region-retry behavior and versioned release packages.

Full installers and architecture-specific packages are included in the v2.0.4 release. On an HTTP 451 response, the client first retries the same API call via the double-leading-slash path. If Subscriptions is enabled and still blocked, a temporary secure connection may be used. No permanent proxy is retained.
