"""Focused worker checks: python3 -m unittest discover -s this directory."""

import importlib.util
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import hashes, hmac
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SPEC = importlib.util.spec_from_file_location(
    "clipboard_crypto_worker", Path(__file__).parents[1] / "cryptoWorker.py"
)
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)
KEY = bytes([0x42]) * 32


def entry(content="remember me", **changes):
    return {
        "id": "test-entry", "type": "text", "content": content,
        "mimeType": "text/plain", "timestamp": 1000, "pinned": False,
        **changes,
    }


def legacy_v3(plaintext):
    nonce = bytes(range(16))
    encryptor = Cipher(algorithms.AES(KEY), modes.CTR(nonce)).encryptor()
    ciphertext = encryptor.update(plaintext) + encryptor.finalize()
    mac = hmac.HMAC(KEY, hashes.SHA256())
    mac.update(ciphertext)
    return b"SHED" + struct.pack(">I", 3) + b"\x10" + nonce + b"\x20" + mac.finalize() + ciphertext


class CryptoWorkerTests(unittest.TestCase):
    def test_v4_roundtrip_authenticates_header_nonce_and_ciphertext(self):
        plaintext = b"private history"
        sealed = worker.encrypt(KEY, plaintext)
        self.assertEqual(sealed[:8], b"SHED\x00\x00\x00\x04")
        self.assertEqual(worker.decrypt(KEY, sealed), plaintext)
        for offset in (7, 8, 20, len(sealed) - 1):
            tampered = bytearray(sealed)
            tampered[offset] ^= 1
            with self.assertRaises(Exception):
                worker.decrypt(KEY, bytes(tampered))

    def test_v2_gcm_remains_readable(self):
        plaintext = b'{"entries":[]}'
        nonce = bytes(range(12))
        old = b"SHED" + struct.pack(">I", 2) + nonce + AESGCM(KEY).encrypt(nonce, plaintext, None)
        self.assertEqual(worker.decrypt(KEY, old), plaintext)
    def test_v1_fixture_from_the_unmodified_historical_writer_remains_readable(self):
        # e233e507^ cryptoEngine.ts, deterministic entropy 12*0x17, key 32*0x42.
        # That writer's nonstandard GHASH is deliberately not regenerated here.
        payload = bytes.fromhex("1717171717171717171717178780f8dc089d107caea05ce8f1a4954529cf665d4ae8afafb053a8bdd907")
        self.assertEqual(worker.decrypt(KEY, b"SHED" + struct.pack(">I", 1) + payload), b'{"entries":[]}')
        with self.assertRaises(Exception):
            worker.decrypt(KEY, b"SHED" + struct.pack(">I", 1) + payload[:-1] + bytes([payload[-1] ^ 1]))


    def test_v3_ctr_hmac_remains_readable(self):
        plaintext = b'{"entries":[]}'
        old = legacy_v3(plaintext)
        self.assertEqual(worker.decrypt(KEY, old), plaintext)
        with self.assertRaises(Exception):
            worker.decrypt(KEY, old[:-1] + bytes([old[-1] ^ 1]))

    def test_rejects_malformed_lengths_and_unknown_versions(self):
        for value in (b"", b"SHED", b"SHED\x00\x00\x00\x09", b"SHED\x00\x00\x00\x03\x01"):
            with self.assertRaises(Exception):
                worker.decrypt(KEY, value)
        with self.assertRaises(Exception):
            worker.encrypt(KEY[:-1], b"text")

    def test_private_durable_write_and_legacy_cipher_upgrade(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / "history"
            directory.mkdir(mode=0o755)
            path = directory / "clipboard-history.enc"
            path.write_bytes(legacy_v3(json.dumps({"entries": [entry()]}).encode()))
            loaded = worker.load_history(KEY, path)
            self.assertEqual(loaded["entries"], [entry()])
            self.assertEqual(path.read_bytes()[:8], b"SHED\x00\x00\x00\x04")
            self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(directory.glob("*.tmp")), [])

    def test_failed_authentication_preserves_history_and_plaintext(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            path = directory / "clipboard-history.enc"
            original = worker.encrypt(bytes([0x43]) * 32, b'{"entries":[]}')
            path.write_bytes(original)
            legacy = directory / "clipboard-history.json"
            legacy.write_text(json.dumps([entry()]))
            with self.assertRaises(Exception):
                worker.load_history(KEY, path)
            self.assertEqual(path.read_bytes(), original)
            self.assertTrue(legacy.exists())
            self.assertFalse((directory / "clipboard-history.enc.bak").exists())

    def test_migrates_plaintext_backups_and_all_legacy_images_after_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            path = directory / "clipboard-history.enc"
            legacy = directory / "clipboard-history.json"
            backup = directory / "clipboard-history.json.migrated"
            legacy.write_text(json.dumps({"entries": [entry("old text")]}))
            backup.write_text(json.dumps([entry("clipboard-123.png", id="image", type="image", mimeType="image/png")]))
            images = directory / "clipboard"
            images.mkdir()
            (images / "clipboard-123.png").write_bytes(b"\x89PNG\r\n\x1a\nold-image")
            (images / "clipboard-456.png").write_bytes(b"\x89PNG\r\n\x1a\norphan-image")
            loaded = worker.load_history(KEY, path)
            self.assertEqual(len(loaded["entries"]), 3)
            self.assertFalse(legacy.exists())
            self.assertFalse(backup.exists())
            self.assertFalse(images.exists())
            persisted = json.loads(worker.decrypt(KEY, path.read_bytes()))
            self.assertEqual(persisted, loaded)
            self.assertNotIn(b"old text", path.read_bytes())

    def test_migration_write_failure_keeps_plaintext_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            path = directory / "clipboard-history.enc"
            legacy = directory / "clipboard-history.json"
            legacy.write_text(json.dumps([entry()]))
            with patch.object(worker, "write_history", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    worker.load_history(KEY, path)
            self.assertTrue(legacy.exists())
            self.assertFalse(path.exists())

    def test_atomic_write_failure_keeps_previous_file_and_cleans_temp(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "clipboard-history.enc"
            worker.write_history(KEY, path, {"entries": [entry("before")]})
            original = path.read_bytes()
            with patch.object(os, "replace", side_effect=OSError("rename failed")):
                with self.assertRaises(OSError):
                    worker.write_history(KEY, path, {"entries": [entry("after")]})
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(Path(temp).glob("*.tmp")), [])

    def test_symlink_history_is_not_read_or_replaced(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            target = directory / "target"
            target.write_bytes(b"do not touch")
            path = directory / "clipboard-history.enc"
            path.symlink_to(target)
            with self.assertRaises(Exception):
                worker.load_history(KEY, path)
            self.assertEqual(target.read_bytes(), b"do not touch")
            self.assertTrue(path.is_symlink())


if __name__ == "__main__":
    unittest.main()
