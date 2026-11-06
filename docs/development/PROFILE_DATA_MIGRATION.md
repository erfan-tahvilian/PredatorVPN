# Electron profile migration to Predator VPN

The public application name and the Electron `userData` directory now use **Predator VPN**.

## Data paths

On Windows, the standard current-user profile is:

`%APPDATA%\Predator VPN`

Existing installations used `%APPDATA%\Fox VPN`. The desktop application
recognizes this legacy directory only to perform a one-time migration. New
installations no longer create or select it.

The initial profile migration is performed *before* Chromium opens the
profile. An atomic same-volume directory rename moves the complete profile,
including the OS-encrypted `vault.bin`, `tunnel.json`, persistent settings,
account history and Chromium Local State. No passwords or tokens are written
into logs, copied into Git, or re-encrypted into plaintext.

If an empty new directory already exists, it is removed first. If both old
and new profiles contain different state, migration fails safely without
overwriting either vault. An OS decryption check runs when Electron is ready,
before Store is allowed to load. Failure prevents the new empty profile from
silently replacing stored accounts and, where possible, restores the original
directory.

The removed browser OAuth feature is not initialized. The obsolete
`oauth-client.json` configuration is deleted from the migrated new profile
as part of this explicitly requested feature removal.

The original Windows appId and Android package namespace remain unchanged:
they are installation identity compatibility markers, not product branding.
The Android app's own private storage path is determined by the legacy package
identifier for update compatibility and is not the Windows roaming directory.

## Verification

Before declaring migration successful:

1. Confirm Windows has shut down the previous Predator VPN process and no
   active VPN tunnel would be disrupted by the update.
2. Launch the updated desktop app under the **same Windows user**.
3. Confirm `%APPDATA%\Predator VPN\vault.bin` exists.
4. Confirm `%APPDATA%\Fox VPN` no longer exists.
5. Check that app settings and account entries remain visible and no
   decryption failure appears. Never print vault plaintext.
6. Confirm the desktop window and tray launch from the intended Windows
   executable under `D:\Program Files\Predator VPN` on the owner's machine.
7. Keep the public 2.0.0 release unpublished pending approval.

Tests are in `tests/profile-migration.test.cjs`. Fixtures use synthetic,
unencrypted JSON *only in throwaway test directories*, never real accounts.
