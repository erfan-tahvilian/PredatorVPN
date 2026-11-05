# Predator VPN workspace instructions

- Canonical repository: `erfan-tahvilian/PredatorVPN`; default branch `main`. The former GitHub address must continue redirecting to the renamed repository.
- Product-facing name and brand: **Predator VPN**. All new public UI, About, docs, issue templates, new binaries and release titles use this name.
- Keep the application's user interface in English. Dark themes display the user-supplied light-color logo; light themes display the dark-color logo. Desktop sidebar branding stays compact.
- Android requires a phone-first layout and a monochrome Quick Settings icon distinct from the application icon; do not add Quick Tile previews to Settings.
- Default accent color is Orange, with Gold, Blue, Teal, Emerald, Red, Purple, Pink, Indigo and Cyan. All ten choices persist and apply without disconnecting the VPN.
- Preserve legacy internal Android package name, signing certificate, Java/native namespace, Android keystore aliases, Windows appId, encrypted storage path and installed-app migration markers. These are compatibility identifiers, not public branding. Renaming them would break existing installations or user data.
- Keep existing account data encrypted, private, and unreadable in diagnostics. Never add tokens, credentials, browsing destinations or personal traffic to logs.
- Preserve required third-party credits and complete original license files, including upstream MIT and GPL notices. Do not delete provenance to conceal a dependency.
- Do not claim that older automatic-update clients can migrate across the repository rename without independent verification: their shipped binaries use strict GitHub API paths, redirect rejection and legacy asset filenames. Maintain support for older clients where technically possible and document unavoidable manual upgrades accurately.
- For Windows connectivity: transient proxy pass and account-service errors must trigger bounded retry and useful diagnostics, not teardown absent verified quota exhaustion. Confirm permanent failures and prevent silent unlimited retries; real long-duration hardware tests remain necessary.
- Preserve source history, published tags, and existing release notes. Never remove previous downloads until a complete, audited replacement release is publicly available.
- Current next planned version: 1.0.4, across supported Windows/macOS/Linux/Android architectures. Publish only after source, checksum, signing, updater, platform builds, and Android installation identity validations pass.
- Build Windows x64 locally and install from the local output without downloading a second copy. Require genuine administrator approval where needed; do not claim installation or approval before confirmation.
- Android package signing must reuse the prior local identity stored in ignored `.tools` files. Never upload unencrypted signing credentials. Use CI for platform builds and local signing tools as previously established.
- Keep technical reports and sensitive build artifacts under ignored `.tools`; public docs should contain user-relevant information, real screenshots from the application and accurate links.
- Use the repository owner's configured Git identity, with no assistant coauthor trailers.
