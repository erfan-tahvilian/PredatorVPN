Predator VPN v2.0.5 is a focused compatibility release that fixes the Linux AppImage catalog validation issues while preserving the existing VPN functionality.

## Changes

- **Linux AppImage compatibility:** switched the SquashFS filesystem from xz to gzip. The AppImage catalog compatibility runtime supports gzip but cannot mount the previous xz payload.
- **Standard filenames:** PredatorVPN-2.0.5-x86_64.AppImage and PredatorVPN-2.0.5-aarch64.AppImage, without a redundant Linux suffix.
- **Project identification:** aligned the README headline with PredatorVPN for AppImage catalog discovery.
- **Download integrity:** the Linux distribution verification explicitly checks the SquashFS header and gzip compression ID, then extracts the AppImage and verifies the packaged application against the source.
- **Other platforms:** Windows, macOS and Android retain existing functionality, including regional HTTP 451 fallback and opt-in Subscriptions, in matching version 2.0.5 packages.

The AppImage catalog listing is maintained by the AppImage project and may require a fresh retest on their existing pull request.
