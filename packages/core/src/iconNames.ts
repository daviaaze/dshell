/**
 * ─────────────────────────────────────────────────────────────
 *  IconNames — type‑safe icon name constants for Shade Shell
 * ─────────────────────────────────────────────────────────────
 *
 * Every entry here is validated against Adwaita 50.0.
 * Run `scripts/audit-icons.sh` to verify against the installed theme.
 *
 * Usage:
 *   import { IconNames, type IconName } from "../iconNames"
 *
 *   // As a constant default:
 *   iconName={IconNames.folderMusic}
 *
 *   // In a prop interface:
 *   interface Props {
 *     icon?: IconName    // compile‑time checked
 *   }
 *
 * Adding a new icon:
 *   1. Add the entry here (camelCase → adwaita‑name)
 *   2. Run `scripts/audit-icons.sh` to verify it exists
 *   3. Use `IconNames.yourIcon` in your code — never raw strings
 */

export const IconNames = {
    // ── Actions / UI ─────────────────────────────────────────
    documentEdit: 'document-edit-symbolic',
    // @unverified
    emblemOk: 'emblem-ok-symbolic',
    documentOpenRecent: 'document-open-recent-symbolic',
    viewRefresh: 'view-refresh-symbolic',
    windowClose: 'window-close-symbolic',
    windowNew: 'window-new-symbolic',
    openMenu: 'open-menu-symbolic',
    goDown: 'go-down-symbolic',
    goNext: 'go-next-symbolic',
    goPrevious: 'go-previous-symbolic',
    goUp: 'go-up-symbolic',
    listAdd: 'list-add-symbolic',
    listRemove: 'list-remove-symbolic',
    editClearAll: 'edit-clear-all-symbolic',
    editDelete: 'edit-delete-symbolic',
    editPaste: 'edit-paste-symbolic',
    selectionMode: 'selection-mode-symbolic',
    objectRotateRight: 'object-rotate-right-symbolic',
    findLocation: 'find-location-symbolic',
    focusWindows: 'focus-windows-symbolic',
    systemSearch: 'system-search-symbolic',
    preferencesSystem: 'preferences-system-symbolic',
    preferencesSystemTime: 'preferences-system-time-symbolic',

    // ── Notifications / alerts ────────────────────────────────
    dialogError: 'dialog-error-symbolic',
    dialogInformation: 'dialog-information-symbolic',
    notificationDisabled: 'notifications-disabled-symbolic',
    contentLoading: 'content-loading-symbolic',

    // ── Face / emoji ──────────────────────────────────────────
    faceSmile: 'face-smile-symbolic',
    emojiRecent: 'emoji-recent-symbolic',
    avatarDefault: 'avatar-default-symbolic',

    // ── Media ─────────────────────────────────────────────────
    applicationsMultimedia: 'applications-multimedia-symbolic',
    multimediaPlayer: 'multimedia-player-symbolic',
    imageXGeneric: 'image-x-generic-symbolic',
    imageMissing: 'image-missing-symbolic',
    mediaPlaybackPause: 'media-playback-pause-symbolic',
    mediaPlaybackStart: 'media-playback-start-symbolic',
    mediaPlaybackStop: 'media-playback-stop-symbolic',
    mediaSkipBackward: 'media-skip-backward-symbolic',
    mediaSkipForward: 'media-skip-forward-symbolic',
    mediaRecord: 'media-record-symbolic',

    // ── Audio ─────────────────────────────────────────────────
    audioCard: 'audio-speakers-symbolic',
    audioHeadphones: 'audio-headphones-symbolic',
    audioHeadset: 'audio-headset-symbolic',
    audioInputMicrophone: 'audio-input-microphone-symbolic',
    audioVolumeHigh: 'audio-volume-high-symbolic',
    audioVolumeLow: 'audio-volume-low-symbolic',
    audioVolumeMedium: 'audio-volume-medium-symbolic',
    audioVolumeMuted: 'audio-volume-muted-symbolic',
    audioXGeneric: 'audio-x-generic-symbolic',
    microphoneSensitivityMuted: 'microphone-sensitivity-muted-symbolic',

    // ── Bluetooth ─────────────────────────────────────────────
    bluetooth: 'bluetooth-symbolic',
    bluetoothActive: 'bluetooth-active-symbolic',
    bluetoothDisabled: 'bluetooth-disabled-symbolic',
    bluetoothDisconnected: 'bluetooth-disconnected-symbolic',

    // ── Display / video ───────────────────────────────────────
    cameraPhoto: 'camera-photo-symbolic',
    cameraVideo: 'camera-video-symbolic',
    displayBrightness: 'display-brightness-symbolic',
    keyboardBrightness: 'keyboard-brightness-symbolic',
    videoDisplay: 'video-display-symbolic',
    nightLight: 'night-light-symbolic',
    nightLightDisabled: 'night-light-disabled-symbolic',
    computer: 'computer-symbolic',
    phone: 'phone-symbolic',
    tv: 'tv-symbolic',
    printer: 'printer-symbolic',
    scanner: 'scanner-symbolic',

    // ── Input ─────────────────────────────────────────────────
    inputGaming: 'input-gaming-symbolic',
    inputKeyboard: 'input-keyboard-symbolic',
    inputMouse: 'input-mouse-symbolic',
    inputTablet: 'input-tablet-symbolic',
    inputTouchpad: 'input-touchpad-symbolic',
    touchpadDisabled: 'touchpad-disabled-symbolic',

    // ── Network ───────────────────────────────────────────────
    networkNoRoute: 'network-no-route-symbolic',
    // @unverified
    networkWiredOffline: 'network-wired-offline-symbolic',
    networkWireless: 'network-wireless-symbolic',
    networkWirelessAcquiring: 'network-wireless-acquiring-symbolic',
    networkWirelessDisabled: 'network-wireless-disabled-symbolic',
    networkWirelessEncrypted: 'network-wireless-encrypted-symbolic',
    networkWirelessOffline: 'network-wireless-offline-symbolic',
    networkWirelessSignalExcellent:
        'network-wireless-signal-excellent-symbolic',
    networkWirelessSignalGood: 'network-wireless-signal-good-symbolic',
    networkWirelessSignalNone: 'network-wireless-signal-none-symbolic',
    networkWirelessSignalOk: 'network-wireless-signal-ok-symbolic',
    networkWirelessSignalWeak: 'network-wireless-signal-weak-symbolic',

    // ── Power / session ───────────────────────────────────────
    systemLockScreen: 'system-lock-screen-symbolic',
    systemLogOut: 'system-log-out-symbolic',
    systemReboot: 'system-reboot-symbolic',
    systemShutdown: 'system-shutdown-symbolic',
    // @unverified
    systemUnlockScreen: 'system-unlock-screen-symbolic',
    powerProfileBalanced: 'power-profile-balanced-symbolic',
    powerProfilePerformance: 'power-profile-performance-symbolic',
    powerProfilePowerSaver: 'power-profile-power-saver-symbolic',

    // ── Status / misc ─────────────────────────────────────────
    // @unverified — not found in Adwaita 48.0 or 50.0, may come from GNOME theme
    eyeNotLooking: 'eye-not-looking-symbolic',
    // @unverified
    eyeOpenNegativeFilled: 'eye-open-negative-filled-symbolic',
    userOffline: 'user-offline-symbolic',
    userTrash: 'user-trash-symbolic',
    xOfficeCalendar: 'x-office-calendar-symbolic',

    // ── Orientation (display) ─────────────────────────────────
    orientationLandscape: 'orientation-landscape-symbolic',
    orientationLandscapeInverse: 'orientation-landscape-inverse-symbolic',
    // @unverified
    orientationPortraitInverse: 'orientation-portrait-inverse-symbolic',
    orientationPortraitRight: 'orientation-portrait-right-symbolic',

    // ── Weather (Adwaita 50.0) ────────────────────────────────
    //  "weather-cloudy-symbolic" was removed — use overcast instead
    weatherClear: 'weather-clear-symbolic',
    // @unverified — comes from GWeather, not the icon theme
    weatherNoneAvailable: 'weather-none-available-symbolic',
    weatherClearNight: 'weather-clear-night-symbolic',
    weatherFewClouds: 'weather-few-clouds-symbolic',
    weatherFewCloudsNight: 'weather-few-clouds-night-symbolic',
    weatherFog: 'weather-fog-symbolic',
    weatherOvercast: 'weather-overcast-symbolic',
    weatherSevereAlert: 'weather-severe-alert-symbolic',
    weatherShowers: 'weather-showers-symbolic',
    weatherShowersScattered: 'weather-showers-scattered-symbolic',
    weatherSnow: 'weather-snow-symbolic',
    weatherStorm: 'weather-storm-symbolic',
    weatherTornado: 'weather-tornado-symbolic',
    weatherWindy: 'weather-windy-symbolic',

    // ── Moon phases (custom) ─────────────────────────────────
    moonNew: 'moon-new-symbolic',
    moonWaxingCrescent: 'moon-waxing-crescent-symbolic',
    moonFirstQuarter: 'moon-first-quarter-symbolic',
    moonWaxingGibbous: 'moon-waxing-gibbous-symbolic',
    moonFull: 'moon-full-symbolic',
    moonWaningGibbous: 'moon-waning-gibbous-symbolic',
    moonLastQuarter: 'moon-last-quarter-symbolic',
    moonWaningCrescent: 'moon-waning-crescent-symbolic',
} as const;

/** Union of every valid icon name string. */
export type IconName = (typeof IconNames)[keyof typeof IconNames];
