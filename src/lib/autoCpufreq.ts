import AstalIO from "gi://AstalIO?version=0.1";
import GObject, { getter, register, setter } from "gnim/gobject";

const GOVERNOR_PATH = "/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor";
const OVERRIDE_PATH = "/opt/auto-cpufreq/override.pickle";

function readFile(path: string): string {
  try {
    return AstalIO.Process.exec(`cat ${path} 2>/dev/null`).trim();
  } catch {
    return "";
  }
}

function readOverride(): string {
  try {
    return AstalIO.Process.exec(
      `python3 -c "import pickle; print(pickle.load(open('${OVERRIDE_PATH}','rb')))" 2>/dev/null`
    ).trim();
  } catch {
    return "";
  }
}

function governorToProfile(governor: string): string {
  switch (governor) {
    case "powersave": return "power-saver";
    case "performance": return "performance";
    default: return "balanced";
  }
}

function profileToForce(profile: string): string {
  switch (profile) {
    case "power-saver": return "powersave";
    case "balanced": return "reset";
    case "performance": return "performance";
    default: return "";
  }
}

function iconForProfile(profile: string): string {
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
  #iconName = "power-profile-balanced-symbolic";
  #available = false;

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
    this.#iconName = iconForProfile(value);
    this.notify("activeProfile");
    this.notify("iconName");
  }

  @getter(String)
  get iconName() {
    return this.#iconName;
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
      const governor = readFile(GOVERNOR_PATH);
      this.activeProfile = governorToProfile(governor);
    }
  }

  set_active_profile(profile: string) {
    const force = profileToForce(profile);
    if (!force) return;

    AstalIO.Process.exec_async(
      `pkexec auto-cpufreq --force=${force}`,
      () => this.#updateState()
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
      "systemctl is-active snap.auto-cpufreq.service.service 2>/dev/null || echo inactive",
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
      AstalIO.monitor_file(GOVERNOR_PATH, () => {
        this.#updateState();
      });
    }
  }
}
