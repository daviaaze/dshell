# Encrypted Clipboard History — Design Spec

**Date:** 2026-07-13
**Status:** Draft

## Overview

Replace the current plaintext JSON clipboard history with an encrypted SQLite
database stored in `~/.local/share/shade-shell/clipboard-history.enc`. The
encryption key is stored in the system keyring (libsecret / Secret Service).

## Motivation

The current clipboard history stores everything the user copies as plaintext
JSON at `~/.local/share/shade-shell/clipboard-history.json`. This means any
process with filesystem access can read passwords, credit card numbers, API
keys, and other sensitive data the user has copied. The goal is to encrypt
at rest so the data is only readable from within the shade-shell process.

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│                    history.ts (modified)                 │
│  Same public API (getHistory, searchHistory, addEntry…) │
│  Internally delegates to EncryptedStore                  │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│                   EncryptedStore                         │
│  - in-memory SQLite via Gda-6.0                          │
│  - serialize/deserialize SQLite DB to byte array         │
│  - encrypt/decrypt byte array via CryptoEngine           │
│  - read/write encrypted file to disk                     │
│  - key management via KeyManager                         │
└──────────────┬──────────────────────────┬────────────────┘
               │                          │
               ▼                          ▼
┌─────────────────────────┐  ┌─────────────────────────────┐
│      CryptoEngine        │  │        KeyManager            │
│  Pure JS AES-256-GCM     │  │  libsecret (Secret Service)  │
│  encrypt/decrypt bytes   │  │  generate/store/retrieve key │
│  nonce + auth tag mgmt   │  │  ~/.local/share/keyrings/   │
└─────────────────────────┘  └─────────────────────────────┘
```

#### KeyManager (`src/lib/services/clipboard/keyManager.ts`)

- **Purpose:** Manage the AES-256 encryption key via libsecret.
- **On first run:** Generate a random 256-bit key using `crypto.getRandomValues`
  (polyfilled in pure JS) or a CSPRNG implementation. Store it in the default
  libsecret collection with schema `com.caioasmuniz.shade.ClipboardKey`.
- **On subsequent runs:** Look up the key by schema/attributes in libsecret.
  If missing (keyring cleared, new machine), generate a new key. Old history
  becomes unrecoverable — this is by design.
- **Key attributes:**
  - `schema`: `com.caioasmuniz.shade.ClipboardKey`
  - `label`: `Shade Shell Clipboard Encryption Key`
  - Value: raw 32 bytes (AES-256 key)

#### CryptoEngine (`src/lib/services/clipboard/cryptoEngine.ts`)

- **Purpose:** Pure JavaScript AES-256-GCM encryption/decryption.
- **Why pure JS:** GJS 1.88.0 does not expose the Web Crypto API (`crypto` is
  undefined). GI bindings for GnuTLS/Gcrypt are not reliably available. A
  minimal AES-256-GCM implementation is ~300 lines and can be bundled via
  esbuild.
- **Algorithm:** AES-256 in GCM mode (NIST SP 800-38D).
  - Key size: 256 bits (32 bytes)
  - Nonce/IV: 12 bytes (random, generated per encryption)
  - Authentication tag: 16 bytes
- **Functions:**
  - `encrypt(key: Uint8Array, plaintext: Uint8Array): Uint8Array`
    - Returns `[nonce (12B)][ciphertext (variable)][authTag (16B)]`
  - `decrypt(key: Uint8Array, data: Uint8Array): Uint8Array`
    - Parses nonce, ciphertext, authTag from input; verifies and decrypts
    - Throws on authentication failure (tampered data)

#### EncryptedStore (`src/lib/services/clipboard/encryptedStore.ts`)

- **Purpose:** Manages the encrypted SQLite database lifecycle.
- **Database:** SQLite via Gda-6.0 GI bindings (`imports.gi.Gda`).
- **Schema:**
  ```sql
  CREATE TABLE IF NOT EXISTS entries (
      id        TEXT PRIMARY KEY,
      type      TEXT NOT NULL CHECK(type IN ('text','image')),
      content   TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      pinned    INTEGER NOT NULL DEFAULT 0
  );
  ```
- **File format** (`clipboard-history.enc`):
  ```
  Offset  Size  Field
  ------  ----  -----
  0       4     Magic bytes: "SHED" (0x53484544)
  4       4     Version: uint32 LE (currently 1)
  8       12    Nonce: AES-GCM IV
  20      N     Encrypted payload: AES-256-GCM(SQLite blob)
  20+N    16    GCM authentication tag
  ```
- **On init:**
  1. `KeyManager.getKey()` — retrieve or generate key
  2. Read `.enc` file from disk — if missing, create empty in-memory DB
  3. `CryptoEngine.decrypt(key, fileContents)` — decrypt
  4. Load decrypted blob into a temporary file → `Gda.Connection.open()` with
     `SQLite` provider
  5. If decryption fails (wrong key, corrupted file), fall back to empty DB
     and log a warning
- **On save:**
  1. Serialize in-memory SQLite DB to byte array (via `.backup()` or
     `VACUUM INTO`)
  2. `CryptoEngine.encrypt(key, blob)` — encrypt
  3. Write encrypted blob to `.enc` file (atomic write via
     `GLib.file_set_contents`)
- **Queries (search, get, delete):** Run against in-memory SQLite directly.
  No encryption/decryption needed for reads.

### Modified history.ts

The existing `history.ts` will be refactored to delegate all storage
operations to `EncryptedStore`. The public API remains unchanged:

| Function | Before | After |
|---|---|---|
| `initClipboardHistory()` | Load plain JSON | Init EncryptedStore (decrypt + load SQLite) |
| `getHistory()` | Return `[...history]` | `SELECT * FROM entries ORDER BY timestamp DESC` |
| `searchHistory(q)` | Filter `history` array | `SELECT * FROM entries WHERE content LIKE ?` |
| `addEntry(data)` | `history.unshift()` + save JSON | `INSERT INTO entries` + encrypt + save file |
| `deleteEntry(id)` | `history.splice()` + save JSON | `DELETE FROM entries` + encrypt + save file |
| `togglePin(id)` | Mutate entry + save JSON | `UPDATE entries SET pinned = ?` + encrypt + save file |
| `clearHistory()` | Filter unpinned + save JSON | `DELETE FROM entries WHERE pinned = 0` + encrypt + save file |
| `copyEntryToClipboard()` | Same (no change) | Same |

### Nix dependency changes

Add to `buildInputs` in `flake.nix`:

```nix
libsecret      # Secret-1.typelib — key storage in system keyring
libgda         # Gda-6.0.typelib — SQLite database access
libgda.sqlite  # SQLite provider for Gda
```

## Security model

- **At rest:** Clipboard data is AES-256-GCM encrypted. The key is stored in
  the system keyring (GNOME Keyring / KDE Wallet), which is itself encrypted
  with the user's login password.
- **In memory:** Data is decrypted in the shade-shell process's memory. Other
  processes with ptrace access (e.g., debuggers) could read it, but this is
  the same level of protection as any other application.
- **Key loss:** If the keyring entry is deleted (e.g., keyring reset, new
  machine), the clipboard history is unrecoverable. This is an acceptable
  trade-off for the privacy benefit.
- **No automatic clear:** The encryption protects against offline access.
  Users who want auto-clear on lock/timeout can be added as a future feature.

## Performance

- SQLite DB with 100 entries: ~50-100KB
- AES-256-GCM encrypt/decrypt of 100KB: <1ms
- Serialization (VACUUM INTO / .backup): ~5-10ms
- Total save latency: ~10-15ms per clipboard change
- Existing 300ms debounce already batches rapid clipboard changes

## Migration

- On first run with the new code, the old `clipboard-history.json` file is
  ignored (left in place, not deleted). The new encrypted file is created
  from scratch.
- No backward compatibility with the old JSON format. Users who downgrade
  will lose new clipboard history.
- A future migration utility could import the old JSON file on first run.

## Future considerations

- **Auto-clear on screen lock:** Hook into Hyprland's lock event to clear
  unpinned entries.
- **Time-based expiry:** Delete entries older than N hours/days.
- **Exclude patterns:** Don't store clipboard content matching certain
  patterns (e.g., credit card numbers, passwords).
- **Key rotation:** Periodically re-encrypt with a new key.