# Windows installation location — Predator VPN 2.x

- The **production NSIS installer is configured with `perMachine: true`** so it installs into a system-managed Program Files directory and records the installation for all users (HKLM), not the current user's LocalAppData/Programs.
- The installation directory remains user-selectable. On the owner's BlackPredator computer, the required directory is **`D:\Program Files\Predator VPN`**. This drive-specific path must not become the global default on other people's computers (many machines lack a D: drive).
- For this computer, run the locally built, verified EXE as administrator with an explicit final NSIS installation argument: `/S /D=D:\Program Files\Predator VPN`. The `/D=` argument must be last and must not be quoted inside the NSIS command line. Installer elevation must be approved locally by the owner via Windows UAC.
- Windows writes the chosen all-users InstallLocation to HKLM; subsequent all-users upgrades should reuse the recorded path. Validate this on the next upgrade.
- To migrate from the legacy per-user location `%LOCALAPPDATA%\Programs\Predator VPN`, verify the all-users installation and executable hashes FIRST; only then uninstall the old per-user app with its registered uninstaller, without deleting any `%APPDATA%` or service/account preferences.
- Check desktop shortcuts and Start Menu registration after migration; make sure only the D-drive executable is launched. Never delete files under the profile's account/settings/vault data during installer cleanup.
- The Windows x64 local preview is **not** the public v2.0.0 release. No release, tag, or main-branch merge is authorized without owner approval.
