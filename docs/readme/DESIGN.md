# README artwork

The README uses a connection-path motif drawn from Predator VPN's orange fox-and-shield identity. Artwork lives here so documentation assets are not included in application packages.

## Files

| Asset | Purpose |
| --- | --- |
| `badge-{version,windows,macos,android}.svg` | Local version and platform badges, without third-party image requests. |
| `hero-{dark,light}.webp` | Legacy wide brand introduction retained for the upcoming redesign. Currently not linked from the README. |
| `social-preview.{svg,png}` | Repository social preview artwork, 1280 × 640 pixels. |
| `download-badges/*.svg` | Platform and architecture download badges shared by the README and release notes. |
| `hero-{dark,light}-mobile.webp` | Narrow-screen composition with larger relative type. |
| `download-{windows,macos,android}-{dark,light}.svg` | Direct downloads for Windows x64, macOS Apple Silicon and Android ARM64. |
| `workspace-v205-{dark,light}.webp` | Wide showcases using real desktop and signed Android 2.0.5 app screenshots inside laptop and phone frames; only the account name is anonymized. |
| `workspace-v205-{dark,light}-mobile.webp` | Portrait showcases that preserve both devices, with responsive art direction for README on mobile. |
| `workspace-{dark,light}{,-mobile}.webp` | Legacy graphics, retained as references but no longer linked from the README workspace section. |
| `routing-{dark,light}.svg` | Conceptual explanation of the two split-tunneling modes. |
| `routing-{dark,light}-mobile.svg` | The same routing explanation, stacked vertically. |
| `support-{dark,light}.svg` | Linked Buy Me a Coffee call to action. |
| `signature-{dark,light}.svg` | Closing brand signature. |
| `signature-{dark,light}-mobile.svg` | Compact signature with larger relative type. |

## Visual system

- Brand accent: orange; dark emphasis `#ff8a42`, light emphasis `#b94b0a`.
- Dark background `#0d1117`, surface `#151a22`, primary text `#f5f7fa`.
- Light background `#f6f8fa`, surface `#ffffff`, primary text `#171e29`.
- Typography: Segoe UI with Arial and generic sans-serif fallbacks. SVGs use system fonts; no remote font requests are required.
- Original logo sources: `assets/logo-light.png` for dark artwork and `assets/logo.png` for light artwork. The transparent logo is composited without changing its design.
- Current screenshot sources: `docs/screenshots/desktop-v205-overview-{dark,light}.png` captured with the real v2.0.5 desktop renderer and a separately isolated sample account, plus `docs/screenshots/android-v205-overview-{dark,light}.png` captured from the signed Android 2.0.5 APK on an API 34 emulator. The only alteration to original Android app screenshot pixels is anonymizing its account name to `Predator`. Screenshots are not proof of an active VPN connection and show a clean disconnected state.
- Reproducible artwork scripts: `scripts/capture-readme-v205.cjs`, `scripts/readme-preview-preload.cjs`, and `scripts/build-readme-workspace.py`. No real account tokens, emails, personal data or VPN credentials are captured. The older `overview-dark.png`, `overview-light.png` and `locations.png` remain available as legacy references.

## GitHub compatibility

Images use repository-relative paths, with `<picture>` sources for color scheme and a 600 px breakpoint for compact compositions. The fallback is the light, wide variant. Meaningful information, download links and instructions remain available as Markdown text; image descriptions provide equivalent context.

README SVGs contain vector paths, shapes and system-font text. The editable social preview additionally embeds the original transparent PNG logo. They have a viewBox, title and description, and contain no scripts, embedded HTML, external resources or animations. Platform silhouettes adapted from Simple Icons are CC0. WebP artwork contains the logo or screenshots, so its display does not depend on nested SVG image loading. No third-party badge or image service is used.

Changing the README does not require rebuilding the application. Keep release filenames, platform requirements, supported capabilities and license statements synchronized with the project. Do not present the workspace crop as a mobile application screenshot.
