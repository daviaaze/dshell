import AstalIO from "gi://AstalIO?version=0.1";
import GLib from "gi://GLib?version=2.0";
import GObject, { getter, register, setter } from "gnim/gobject";

function readOverride(): string {
  const picklePaths = [
    "/opt/auto-cpufreq/override.pickle",
    "/var/snap/auto-cpufreq/current/override.pickle",
  ];

  for (const path of picklePaths) {
    try {
      const out = AstalIO.Process.exec(
        `python3 -c "import pickle; print(pickle.load(open('${path}', 'rb')))" 2>/dev/null`
      ).trim();
      if (out === "powersave" || out === "performance" || out === "default") {
        return out;
      }
    } catch (e: any) {
      // Path likely doesn't exist or Python failed — try next
      continue;
    }
  }

  return "";
}

function profileToForce(profile: string): string {
  switch (profile) {
    case "power-saver": return "powersave";
    case "balanced": return "reset";
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

  #activeProfile = "balanced";
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
    this.notify("activeProfile");
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
    } else {
      // auto-cpufreq is auto-managing (no override or "default")
      this.activeProfile = "balanced";
    }
  }

  #poll() {
    this.#updateState();
    this.#pollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
      this.#updateState();
      return GLib.SOURCE_CONTINUE;
    });
  }

  set_active_profile(profile: string) {
    if (!this.#available) return;
    const force = profileToForce(profile);
    if (!force) return;

    AstalIO.Process.exec_async(
      `pkexec auto-cpufreq --force=${force}`,
      (res) => {
        try {
          AstalIO.Process.exec_async_finish(res);
        } catch (e: any) {
          print("auto-cpufreq force failed:", e.message);
        }
        this.#updateState();
      }
    );
  }

  #detect(): boolean {
    // Check binary exists
    try {
      AstalIO.Process.exec("auto-cpufreq --version 2>/dev/null");
    } catch {
      return false;
    }

    // Check daemon is running (systemd service or snap)
    const services = [
      "systemctl is-active auto-cpufreq 2>/dev/null || echo inactive",
      "systemctl is-active snap.auto-cpufreq.service 2>/dev/null || echo inactive",
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

    return false;
  }

  constructor() {
    super();
    this.#available = this.#detect();
    if (this.#available) {
      this.#updateState();
      this.#poll();
    }
  }

  dispose() {
    if (this.#pollTimer !== null) {
      GLib.source_remove(this.#pollTimer);
      this.#pollTimer = null;
    }
  }
}
