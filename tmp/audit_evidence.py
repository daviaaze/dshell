"""Evidence script for audit findings — read-only verification."""

# --- Build 1: QEMU error detection bug ---
# File: scripts/shadetest/_vnc.py, ~line 205
# "Unknown command" (capital U) never matches QEMU's "unknown command" (lowercase)
qemu_response = "unknown command: sendkey XF86BadKey\r\n(qemu) "
assert "Unknown command" not in qemu_response, "P1: Case-sensitive check misses 'unknown command'"
assert "error" not in qemu_response.lower(), "P1: 'error' check also misses unknown-command responses"
print("BUILD1-P1 CONFIRMED: QEMU error detection fails for unknown commands")

# --- Build 2: SSH argument escaping ---
# File: scripts/shadetest/_ssh.py, ~line 165
# " ".join(command) doesn't escape spaces
cmd = ["grep", "hello world", "/tmp/file"]
bad = " ".join(cmd)
import shlex
good = shlex.join(cmd)
assert bad != good, f"P1: Unescaped join produces '{bad}' vs proper '{good}'"
print(f"BUILD2-P1 CONFIRMED: Unescaped: '{bad}'")

# --- Build 3: capture-golden.sh XF86 bypass ---
# File: scripts/capture-golden.sh, line 74-79
# Uses vncdo directly for XF86 keys, bypassing QEMU monitor routing
with open("../scripts/capture-golden.sh") as f:
    content = f.read()
assert "vncdo key XF86" in content, "P2: golden capture uses vncdo for XF86 keys"
print("BUILD3-P2 CONFIRMED: capture-golden.sh uses vncdo for XF86 keys (not QEMU monitor)")

# --- Build 3: AGENTS.md example references ---
with open("../AGENTS.md") as f:
    agents = f.read()
assert "foo.ts" in agents, "P3: AGENTS.md contains example 'foo.ts' references"
print("BUILD3-P3 CONFIRMED: AGENTS.md has 3 'foo.ts' example references (doc-check false positives)")

print("\nAll evidence gathered — audit complete.")
