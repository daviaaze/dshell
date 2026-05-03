import AstalIO from "gi://AstalIO?version=0.1";
import GLib from "gi://GLib?version=2.0";
import Gio from "gi://Gio?version=2.0";
import GObject, { getter, register, setter } from "gnim/gobject";
import logger from "#/lib/logger";

const GOVERNOR_PATH = "/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor";

const PICKLE_PATHS = [
  "/opt/auto-cpufreq/override.pickle",
  "/var/snap/auto-cpufreq/current/override.pickle",
  "/var/lib/auto-cpufreq/override.pickle",
];

/**
 * Read auto-cpufreq override state.
 * Tries pickle files first (legacy auto-cpufreq), then falls back to
 * reading sysfs governor (NixOS auto-cpufreq 3.0.0+).
 */
function readOverride(): string {
  // Try legacy pickle files first
  for (const path of PICKLE_PATHS) {
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null)) continue;

    try {
      const out = AstalIO.Process.exec(
        `python3 -c "import pickle; print(pickle.load(open('${path}', 'rb')))"`
      ).trim();
      if (out === "powersave" || out === "performance" || out === "default") {
        return out;
      }
    } catch (e: any) {
      logger.warn("auto-cpufreq: failed to read override at", path, e.message);
      continue;
    }
  }

  // Fallback: read sysfs governor (NixOS 3.0.0+, no pickle file)
  try {
    const governor = AstalIO.Process.exec(`cat ${GOVERNOR_PATH}`).trim();
    if (governor === "powersave") return "powersave";
    if (governor === "performance") return "performance";
  } catch (e: any) {
    logger.warn("auto-cpufreq: failed to read sysfs governor:", e.message);
  }

  return "";
}

/**
 * Check if auto-cpufreq is actively overriding (not just auto-managing).
 * On NixOS 3.0.0, we detect this by checking if all CPUs have the same
 * governor locked to powersave or performance (auto-cpufreq normally
 * varies governors per-core based on load).
 */
function isOverriding(): boolean {
  try {
    const out = AstalIO.Process.exec(
      "sh -c 'cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor | sort -u'"
    ).trim();
    // If all cores have the same governor and it's not the hardware default,
    // auto-cpufreq is likely overriding. A single unique value suggests override.
    const lines = out.split("\n").filter(l => l.length > 0);
    if (lines.length === 1 && (lines[0] === "powersave" || lines[0] === "performance")) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function profileToForce(profile: string): string {
  switch (profile) {
    case "power-saver": return "powersave";
    case "auto": return "reset";
    case "performance": return "performance";
    default: return "";
  }
}

export function iconForProfile(profile: string): string {
  switch (profile) {
    case "power-saver": return "power-profile-power-saver-symbolic";
    case "performance": return "power-profile-performance-symbolic";
    default: return "power-profile-balanced-symbolic";
  }
}

@register({ GTypeName: "AutoCpufreq" })
export default class AutoCpufreq extends GObject.Object {
  static instance: AutoCpufreq;
  static get_default() {
    if (!this.instance) this.instance = new AutoCpufreq();
    return this.instance;
  }

  #activeProfile = "auto";
  #available = false;
  #pollTimer: number | null = null;

  @getter(Boolean)
  get available() {
    return this.#available;
  }

  @getter(String)
  get activeProfile() {
    return this.#activeProfile;
  }

  @setter(String)
  set activeProfile(value: string) {
    if (this.#activeProfile === value) return;
    this.#activeProfile = value;
    this.notify("active-profile");
  }

  get active_profile() {
    return this.#activeProfile;
  }

  #updateState() {
    const override = readOverride();
    if (override === "powersave") {
      this.activeProfile = "power-saver";
    } else if (override === "performance") {
      this.activeProfile = "performance";
    } else if (isOverriding()) {
      // sysfs shows override but no pickle — still overridden
      const governor = readOverride();
      if (governor === "powersave") this.activeProfile = "power-saver";
      else if (governor === "performance") this.activeProfile = "performance";
      else this.activeProfile = "auto";
    } else {
      // auto-cpufreq is auto-managing (no override or "default")
      this.activeProfile = "auto";
    }
  }

  #poll() {
    this.#updateState();
    this.#pollTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
      this.#updateState();
      return GLib.SOURCE_CONTINUE;
    });
  }

  set_active_profile(profile: string) {
    if (!this.#available) {
      logger.warn("auto-cpufreq: not available, cannot set profile");
      return;
    }
    const force = profileToForce(profile);
    if (!force) {
      logger.warn("auto-cpufreq: unknown profile", profile);
      return;
    }

    logger.log(`auto-cpufreq: setting profile to ${profile} (force=${force})`);

    // Optimistic UI update
    this.activeProfile = profile;

    AstalIO.Process.exec_asyncv(
      ["pkexec", "auto-cpufreq", `--force=${force}`],
      (_, res) => {
        try {
          AstalIO.Process.exec_asyncv_finish(res);
          logger.log("auto-cpufreq: force succeeded");
        } catch (e: any) {
          logger.error("auto-cpufreq: force failed:", e.message);
          logger.error("auto-cpufreq: ensure a polkit agent is running (e.g. polkit-gnome-authentication-agent-1)");
          // Revert optimistic update on failure
          this.#updateState();
        }
      }
    );
  }

  #detect(): boolean {
    // Check binary exists via `which` (works on NixOS, most distros)
    // NOTE: AstalIO.Process.exec does NOT use /bin/sh -c — it splits by spaces.
    // Shell metacharacters (|, >, &&, ||) are passed as literal arguments.
    // Always wrap shell commands in "sh -c '...'".
    try {
      AstalIO.Process.exec("sh -c 'command -v auto-cpufreq'");
    } catch (e: any) {
      logger.warn("auto-cpufreq: binary not found in PATH:", e.message);
      return false;
    }

    // Check daemon is running (systemd service or snap)
    const services = [
      "sh -c 'systemctl is-active auto-cpufreq 2>/dev/null || echo inactive'",
      "sh -c 'systemctl is-active snap.auto-cpufreq.service 2>/dev/null || echo inactive'",
    ];

    for (const cmd of services) {
      try {
        if (AstalIO.Process.exec(cmd).trim() === "active") {
          return true;
        }
      } catch {
        // continue
      }
    }

    logger.warn("auto-cpufreq: binary found but no active service detected");
    return false;
  }

  constructor() {
    super();
    this.#available = this.#detect();
    if (this.#available) {
      logger.log("auto-cpufreq: detected and enabled");
      this.#updateState();
      this.#poll();
    } else {
      logger.log("auto-cpufreq: not available, will use power-profiles-daemon fallback");
    }
  }

  dispose() {
    if (this.#pollTimer !== null) {
      GLib.source_remove(this.#pollTimer);
      this.#pollTimer = null;
    }
  }
}
