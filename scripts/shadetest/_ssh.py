"""SSH client for running D-Bus commands inside the Shade test VM.

Provides password-authenticated SSH to the VM with host key checking
disabled (safe for local testing only). Routes gdbus calls through
SSH so the harness can toggle Shade widgets via D-Bus even though
the D-Bus session bus lives inside the VM.

Credentials match nix/vm.nix and nix/vm-vnc.nix:
    Host: localhost:2222 → VM port 22 (QEMU hostfwd)
    User: test
    Password: test
"""

import os
import subprocess
import time

# ── VM credentials (matching nix/vm.nix) ─────────────────────────────────

VM_HOST = "localhost"
VM_PORT = 2222
VM_USER = "test"
VM_PASSWORD = "test"

# SSH options for local VM: disable host key checking, quiet logging
VM_SSH_OPTIONS = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "LogLevel=ERROR",
    "-o", "ConnectTimeout=5",
]


class SSHError(Exception):
    """Raised when an SSH command fails."""

    def __init__(self, message: str, command: list[str] | None = None):
        super().__init__(message)
        self.command = command or []


# ── Detection ────────────────────────────────────────────────────────────

def _is_port_open(host: str, port: int, timeout: float = 2.0) -> bool:
    """Check if a TCP port is reachable using bash /dev/tcp."""
    try:
        result = subprocess.run(
            ["bash", "-c", f"exec 3<>/dev/tcp/{host}/{port}"],
            capture_output=True,
            timeout=timeout,
        )
        return result.returncode == 0
    except Exception:
        return False


def detect_vm_mode() -> bool:
    """Auto-detect if we are testing against the Shade VM.

    Checks (in order):
        1. SHADE_VM_MODE environment variable
        2. Whether SSH port 2222 is open on localhost

    Returns True if VM mode appears active.
    """
    if os.environ.get("SHADE_VM_MODE", "").lower() in ("1", "true", "yes"):
        return True
    return _is_port_open(VM_HOST, VM_PORT)


def is_ssh_reachable(timeout: float = 5.0) -> bool:
    """Return True if the VM SSH port is open right now."""
    return _is_port_open(VM_HOST, VM_PORT, timeout)


def wait_for_ssh(timeout: int = 60) -> bool:
    """Poll until SSH on the VM accepts connections.

    Returns True once reachable, False on timeout.
    """
    start = time.monotonic()
    while (time.monotonic() - start) < timeout:
        if _is_port_open(VM_HOST, VM_PORT, timeout=2.0):
            return True
        time.sleep(1)
    return False


# ── SSH command execution ────────────────────────────────────────────────

def _check_sshpass() -> None:
    """Raise SSHError if sshpass is not available."""
    try:
        subprocess.run(
            ["sshpass", "-V"],
            capture_output=True,
            timeout=5,
        )
    except FileNotFoundError:
        raise SSHError(
            "sshpass not found in PATH — run: nix develop"
        )
    except subprocess.TimeoutExpired:
        pass  # sshpass -V hung — proceed anyway


def run_remote(
    command: list[str],
    timeout: int = 30,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess:
    """Execute a command inside the VM via SSH.

    Uses sshpass for password authentication. Host key checking is
    disabled (safe for local VM only).

    Args:
        command: Command + arguments to run remotely.
        timeout: Seconds before giving up.
        env: Extra environment variables to set on the remote side.

    Returns:
        subprocess.CompletedProcess with captured stdout/stderr.

    Raises:
        SSHError: On any failure.
    """
    _check_sshpass()

    # Build the remote command string with optional env prefix
    if env:
        env_prefix = " ".join(f"{k}={v}" for k, v in env.items())
        remote_cmd = f"{env_prefix} {' '.join(command)}"
    else:
        remote_cmd = " ".join(command)

    ssh_cmd = [
        "sshpass", "-p", VM_PASSWORD,
        "ssh",
        *VM_SSH_OPTIONS,
        "-p", str(VM_PORT),
        f"{VM_USER}@{VM_HOST}",
        "--",
        remote_cmd,
    ]

    try:
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            stderr = result.stderr.strip() or "unknown error"
            raise SSHError(
                f"SSH command failed (exit {result.returncode}): {stderr}",
                ssh_cmd,
            )
        return result
    except subprocess.TimeoutExpired:
        raise SSHError(f"SSH command timed out after {timeout}s", ssh_cmd)
    except FileNotFoundError:
        raise SSHError("sshpass or ssh not found in PATH", ssh_cmd)


# ── D-Bus helpers ────────────────────────────────────────────────────────

def _discover_session_bus_address() -> str:
    """Return the D-Bus session bus address for the VM's test user.

    Uses systemd-logind to find the user session, then reads the
    D-Bus address from /run/user/<uid>/bus.
    """
    try:
        # Query the user's UID via SSH
        result = run_remote(
            ["id", "-u", VM_USER],
            timeout=5,
        )
        uid = result.stdout.strip()
        return f"unix:path=/run/user/{uid}/bus"
    except Exception:
        # Fallback: assume first normal user = UID 1000
        return "unix:path=/run/user/1000/bus"


def dbus_activate_remote(action_name: str, timeout: int = 10) -> bool:
    """Activate a Shade GIO action via gdbus inside the VM.

    Routes the gdbus call through SSH and sets the session bus
    address so it reaches the user's D-Bus session.

    Args:
        action_name: e.g. "toggle-applauncher", "toggle-quicksettings"
        timeout: Seconds before giving up

    Returns:
        True on success

    Raises:
        SSHError: If SSH fails or gdbus call fails
    """
    bus_address = _discover_session_bus_address()

    result = run_remote(
        command=[
            "gdbus", "call",
            "--session",
            "--dest", "com.caioasmuniz.shade_shell",
            "--object-path", "/com/caioasmuniz/shade_shell",
            "--method", "org.gtk.Actions.Activate",
            "(sva{sv})",
            action_name,
            "[]",
            "[]",
        ],
        env={"DBUS_SESSION_BUS_ADDRESS": bus_address},
        timeout=timeout,
    )

    # gdbus call returns something like "(()'',)" on success
    output = result.stdout.strip()
    if "Error" in output:
        raise SSHError(
            f"gdbus returned error for action '{action_name}': {output}"
        )
    return True


# ── Credential helpers ───────────────────────────────────────────────────

def get_vm_credentials() -> dict[str, str | int]:
    """Return the default VM SSH credentials.

    Useful for tools that need explicit credentials.
    """
    return {
        "host": VM_HOST,
        "port": VM_PORT,
        "user": VM_USER,
        "password": VM_PASSWORD,
    }


def get_ssh_command_prefix() -> list[str]:
    """Return the sshpass + ssh prefix for ad-hoc VM commands.

    Callers can append their command:

        cmd = get_ssh_command_prefix() + ["journalctl", "--user", "-n", "20"]
        subprocess.run(cmd)
    """
    _check_sshpass()
    return [
        "sshpass", "-p", VM_PASSWORD,
        "ssh",
        *VM_SSH_OPTIONS,
        "-p", str(VM_PORT),
        f"{VM_USER}@{VM_HOST}",
        "--",
    ]
