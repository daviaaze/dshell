#!/usr/bin/env python3
"""Private clipboard crypto/I/O worker; never accepts a key in argv or env.

CLI: encrypt|decrypt|write|load [history-path]. Stdin starts with the 32-byte
key, then the payload (plaintext for encrypt/write, a full file for decrypt).
V4 is SHED || version(BE) || nonce(12) || AESGCM ciphertext/tag(16); its
8-byte header is authenticated. V1's historical malformed GHASH, standard
v2 GCM and v3 CTR/HMAC remain read-only compatibility paths. PyCryptodome
is used only for v1's native GHASH, never for new encryption.

Writes use a private same-directory temporary, fsync, rename and directory
fsync. Plaintext migration sources are unlinked only after that commit;
unlink is not a promise of secure erasure on SSD/COW filesystems.
"""

import base64
import json
import os
from pathlib import Path
import re
import resource
import secrets
import stat
import struct
import sys

from cryptography.hazmat.primitives import constant_time, hashes, hmac
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

HEADER = b"SHED\x00\x00\x00\x04"
KEY_SIZE = 32
MAX_HISTORY = 500
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_INPUT_BYTES = 128 * 1024 * 1024
LEGACY_IMAGE = re.compile(r"clipboard-(\d+)\.png\Z")


def check_key(key):
    if len(key) != KEY_SIZE:
        raise ValueError("clipboard key must be 32 bytes")


def encrypt(key, plaintext):
    check_key(key)
    nonce = os.urandom(12)
    return HEADER + nonce + AESGCM(key).encrypt(nonce, plaintext, HEADER)


def decrypt_v1(key, payload):
    # V1 incorrectly encoded byte lengths twice instead of uint64 bit lengths.
    # Keep the old framing, but delegate GHASH/AES to maintained native code.
    from Crypto.Cipher._mode_gcm import _GHASH, _ghash_clmul, _ghash_portable

    nonce, ciphertext, tag = payload[:12], payload[12:-16], payload[-16:]
    aes = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    blocks = aes.update(bytes(16) + nonce + b"\x00\x00\x00\x01") + aes.finalize()
    auth = _GHASH(blocks[:16], _ghash_clmul or _ghash_portable)
    length = len(ciphertext)
    auth.update(ciphertext + bytes(-length % 16) + bytes(8) + struct.pack(">II", length, length))
    expected = bytes(a ^ b for a, b in zip(auth.digest(), blocks[16:]))
    if not constant_time.bytes_eq(expected, tag):
        raise ValueError("legacy clipboard authentication failed")
    decryptor = Cipher(algorithms.AES(key), modes.CTR(nonce + b"\x00\x00\x00\x02")).decryptor()
    return decryptor.update(ciphertext) + decryptor.finalize()


def decrypt(key, data):
    check_key(key)
    if len(data) < 8 or data[:4] != b"SHED":
        raise ValueError("invalid clipboard header")
    version = struct.unpack(">I", data[4:8])[0]
    payload = data[8:]
    if version in (1, 2, 4):
        if len(payload) < 28:
            raise ValueError("truncated clipboard GCM payload")
        if version == 1:
            return decrypt_v1(key, payload)
        return AESGCM(key).decrypt(payload[:12], payload[12:], data[:8] if version == 4 else None)
    if version == 3:
        if len(payload) < 50 or payload[0] != 16 or payload[17] != 32:
            raise ValueError("invalid clipboard CTR/HMAC framing")
        nonce, tag, ciphertext = payload[1:17], payload[18:50], payload[50:]
        verifier = hmac.HMAC(key, hashes.SHA256())
        verifier.update(ciphertext)
        verifier.verify(tag)
        decryptor = Cipher(algorithms.AES(key), modes.CTR(nonce)).decryptor()
        return decryptor.update(ciphertext) + decryptor.finalize()
    raise ValueError("unsupported clipboard file version")


def checked_directory(path, create=False):
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        if os.fstat(fd).st_uid != os.getuid():
            raise ValueError("clipboard directory is not owned by this user")
        os.fchmod(fd, 0o700)
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_owned_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if info.st_uid != os.getuid() or not stat.S_ISREG(info.st_mode):
            raise ValueError("clipboard source is not a user-owned regular file")
        if info.st_size > MAX_INPUT_BYTES:
            raise ValueError("clipboard source exceeds input limit")
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "rb", closefd=False) as source:
            data = source.read(MAX_INPUT_BYTES + 1)
        if len(data) > MAX_INPUT_BYTES:
            raise ValueError("clipboard source exceeds input limit")
        return data
    finally:
        os.close(fd)


def normalize_entries(data, legacy=False):
    entries = data if legacy and isinstance(data, list) else data.get("entries") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        raise ValueError("invalid clipboard entries")
    normalized = []
    for index, original in enumerate(entries):
        if not isinstance(original, dict):
            raise ValueError("invalid clipboard entry")
        value = dict(original)
        if legacy and "content" not in value and isinstance(value.get("text"), str):
            content = value.pop("text")
            image = LEGACY_IMAGE.fullmatch(content) is not None
            value.update(content=content, type="image" if image else "text", mimeType="image/png" if image else "text/plain")
        if legacy:
            value.setdefault("id", f"legacy-{index}-{secrets.token_hex(8)}")
            value.setdefault("pinned", False)
        if (not isinstance(value.get("id"), str) or value.get("type") not in ("text", "image")
                or not isinstance(value.get("content"), str) or not isinstance(value.get("mimeType"), str)
                or not isinstance(value.get("timestamp"), (int, float)) or isinstance(value.get("timestamp"), bool)
                or not isinstance(value.get("pinned"), bool)):
            raise ValueError("invalid clipboard entry fields")
        normalized.append(value)
    return normalized


def encode_history(data):
    entries = normalize_entries(data)
    encoded = [json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode() for value in entries]
    size = len(b'{"entries":[]}') + sum(map(len, encoded)) + max(0, len(encoded) - 1)
    count = len(entries)
    for index in range(len(entries) - 1, -1, -1):
        if count <= MAX_HISTORY and size <= MAX_TOTAL_BYTES:
            break
        if not entries[index]["pinned"]:
            size -= len(encoded[index]) + (1 if count > 1 else 0)
            count -= 1
            entries.pop(index)
            encoded.pop(index)
    if count > MAX_HISTORY or size > MAX_TOTAL_BYTES:
        raise ValueError("pinned clipboard entries exceed storage limit")
    return {"entries": entries}, b'{"entries":[' + b",".join(encoded) + b"]}"


def write_history(key, path, data):
    normalized, plaintext = encode_history(data)
    encrypted = encrypt(key, plaintext)
    directory = checked_directory(path.parent, create=True)
    temporary = f".clipboard-history-{secrets.token_hex(16)}.tmp"
    try:
        try:
            info = os.stat(path.name, dir_fd=directory, follow_symlinks=False)
            if info.st_uid != os.getuid() or not stat.S_ISREG(info.st_mode):
                raise ValueError("clipboard destination is not a user-owned regular file")
        except FileNotFoundError:
            pass
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        with os.fdopen(fd, "wb") as destination:
            destination.write(encrypted)
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(temporary, path.name, src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
        return normalized
    finally:
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass
        os.close(directory)


def load_history(key, path):
    check_key(key)
    try:
        directory = checked_directory(path.parent)
    except FileNotFoundError:
        return {"entries": []}
    os.close(directory)
    try:
        ciphertext = read_owned_file(path)
    except FileNotFoundError:
        ciphertext = None
    # Authenticate the existing encrypted file before reading or changing any
    # migration source. A wrong/unavailable key must never rotate backups.
    entries = normalize_entries(json.loads(decrypt(key, ciphertext))) if ciphertext is not None else []
    rewrite = ciphertext is not None and ciphertext[:8] != HEADER
    cleanup = []
    for name in ("clipboard-history.json", "clipboard-history.json.migrated"):
        legacy = path.parent / name
        try:
            contents = read_owned_file(legacy)
        except FileNotFoundError:
            continue
        entries.extend(normalize_entries(json.loads(contents), legacy=True))
        cleanup.append(legacy)
        rewrite = True

    image_directory = path.parent / "clipboard"
    try:
        image_fd = checked_directory(image_directory)
    except FileNotFoundError:
        image_names = []
    else:
        try:
            image_names = sorted(name for name in os.listdir(image_fd) if LEGACY_IMAGE.fullmatch(name))
        finally:
            os.close(image_fd)
    referenced = set()
    for value in entries:
        if value["type"] == "image" and LEGACY_IMAGE.fullmatch(value["content"]):
            name = value["content"]
            value["content"] = base64.b64encode(read_owned_file(image_directory / name)).decode("ascii")
            value["mimeType"] = "image/png"
            referenced.add(name)
            rewrite = True
    for name in image_names:
        image_path = image_directory / name
        if name not in referenced:
            contents = read_owned_file(image_path)
            entries.append({"id": f"legacy-image-{name}", "type": "image", "content": base64.b64encode(contents).decode("ascii"),
                            "mimeType": "image/png", "timestamp": int(LEGACY_IMAGE.fullmatch(name)[1]), "pinned": False})
        cleanup.append(image_path)
        rewrite = True

    # Retain a pinned duplicate when merging old plaintext with encrypted data.
    unique = {}
    for value in entries:
        identity = (value["type"], value["content"])
        if identity in unique:
            unique[identity]["pinned"] |= value["pinned"]
        else:
            unique[identity] = value
    data = {"entries": sorted(unique.values(), key=lambda value: value["timestamp"], reverse=True)}
    if rewrite:
        data = write_history(key, path, data)
        for source in cleanup:
            try:
                source.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                print(f"clipboard: could not unlink migrated source {source.name}", file=sys.stderr)
        if image_names:
            image_fd = checked_directory(image_directory)
            try:
                os.fsync(image_fd)
            finally:
                os.close(image_fd)
            try:
                image_directory.rmdir()
            except OSError:
                pass  # Unknown, non-clipboard files are not ours to delete.
        directory = checked_directory(path.parent)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    return data


def main():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    os.umask(0o077)
    if len(sys.argv) not in (2, 3):
        raise ValueError("expected operation and optional history path")
    operation = sys.argv[1]
    key = bytearray(sys.stdin.buffer.read(KEY_SIZE))
    try:
        check_key(key)
        payload = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(payload) > MAX_INPUT_BYTES:
            raise ValueError("clipboard payload exceeds input limit")
        if operation == "encrypt" and len(sys.argv) == 2:
            result = encrypt(key, payload)
        elif operation == "decrypt" and len(sys.argv) == 2:
            result = decrypt(key, payload)
        elif operation == "write" and len(sys.argv) == 3:
            write_history(key, Path(sys.argv[2]), json.loads(payload))
            result = b""
        elif operation == "load" and len(sys.argv) == 3 and not payload:
            result = json.dumps(load_history(key, Path(sys.argv[2])), ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
        else:
            raise ValueError("invalid clipboard worker operation")
        sys.stdout.buffer.write(result)
    finally:
        key[:] = bytes(KEY_SIZE)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Do not print payloads, key values, or exception messages from parsers.
        print(f"clipboard worker failed ({type(error).__name__})", file=sys.stderr)
        sys.exit(1)
