import WindowManager from "#/lib/windowManager";
import { useSettings } from "#/lib/settings";
import Theming from "#/lib/theming";
import Adw from "gi://Adw?version=1";
import Gtk from "gi://Gtk?version=4.0";

export default () => {
  const settings = useSettings().general
  const fileDialog = Gtk.FileDialog.new()
  fileDialog.set_default_filter(new Gtk.FileFilter({ mimeTypes: ["image/*"] }))

  return <>
    <Adw.PreferencesGroup
      title={"Appearance"}
      description={"Set cosmetic options"}>
      <Adw.ActionRow title={"System Theme"}>
        <Adw.ToggleGroup $type="suffix"
          cssClasses={["round"]}
          valign={Gtk.Align.CENTER}
          onNotifyActive={self => settings
            .setColorScheme(self.active)}
          active={settings.colorScheme}
        >
          <Adw.Toggle
            label={"Auto"}
            iconName={"night-light-symbolic"}
          />
          <Adw.Toggle
            label={"Light"}
            iconName={"weather-clear-symbolic"}
          />
          <Adw.Toggle
            label={"Dark"}
            iconName={"weather-clear-night-symbolic"}
          />
        </Adw.ToggleGroup>
      </Adw.ActionRow>
      <Adw.ActionRow
        activatable
        title={"Wallpaper Day"}
        subtitle={settings.wallpaperDay}
        iconName={"image-x-generic-symbolic"}
        onActivated={() => {
          fileDialog.open(WindowManager.get_default().settings!, null, (_, res) => {
            try {
              const path = fileDialog.open_finish(res)?.get_path()
              if (path) settings.setWallpaperDay(path)
            } catch { /* user cancelled */ }
          })
        }}>
        {/* <Gtk.Image file={settings.wallpaperDay} /> */}
      </Adw.ActionRow>
      <Adw.ActionRow
        activatable
        title={"Wallpaper Night"}
        subtitle={settings.wallpaperNight}
        iconName={"image-x-generic-symbolic"}
        onActivated={() => {
          fileDialog.open(WindowManager.get_default().settings!, null, (_, res) => {
            try {
              const path = fileDialog.open_finish(res)?.get_path()
              if (path) settings.setWallpaperNight(path)
            } catch { /* user cancelled */ }
          })
        }}>
        {/* <Gtk.Image file={settings.wallpaperNight} /> */}
      </Adw.ActionRow>
    </Adw.PreferencesGroup>

    <Adw.PreferencesGroup
      title={"Dynamic Theming"}
      description={"Extract accent colors from wallpaper"}>
      <Adw.SwitchRow
        title={"Enable Dynamic Theming"}
        subtitle={Theming.get_default().available ? "" : "Install matugen to enable"}
        active={settings.dynamicThemingEnabled}
        onNotifyActive={self => settings.setDynamicThemingEnabled(self.active)}
      />
      <Gtk.Button
        cssClasses={["suggested-action"]}
        marginTop={8}
        marginBottom={8}
        halign={Gtk.Align.CENTER}
        label="Regenerate from Wallpaper"
        onClicked={() => Theming.get_default().regenerate()} />
    </Adw.PreferencesGroup>

    <Adw.PreferencesGroup
      title={"Night Light"}
      description={"Reduce eye strain with warm colors"}>
      <Adw.SwitchRow
        title={"Enable Night Light"}
        active={settings.nightLightEnabled}
        onNotifyActive={self => settings.setNightLightEnabled(self.active)}
      />
      <Adw.SpinRow
        title={"Color Temperature"}
        subtitle={"Lower values are warmer (redder)"}
        adjustment={
          <Gtk.Adjustment
            lower={2000}
            upper={6500}
            stepIncrement={100}
            value={settings.nightLightTemperature}
          /> as Gtk.Adjustment}
        onNotifyValue={self => settings.setNightLightTemperature(self.value)}
      />
      <Adw.SwitchRow
        title={"Auto Schedule"}
        subtitle={"Enable at sunset, disable at sunrise"}
        active={settings.nightLightAutoSchedule}
        onNotifyActive={self => settings.setNightLightAutoSchedule(self.active)}
      />
    </Adw.PreferencesGroup>

    <Adw.PreferencesGroup
      title={"Idle Management"}
      description={"Screen lock and dimming behavior"}>
      <Adw.SwitchRow
        title={"Auto Lock"}
        subtitle={"Lock screen after idle timeout"}
        active={settings.autoLockEnabled}
        onNotifyActive={self => settings.setAutoLockEnabled(self.active)}
      />
      <Adw.SpinRow
        title={"Idle Timeout"}
        subtitle={"Seconds of inactivity before locking"}
        adjustment={
          <Gtk.Adjustment
            lower={60}
            upper={1800}
            stepIncrement={30}
            value={settings.idleTimeout}
          /> as Gtk.Adjustment}
        onNotifyValue={self => settings.setIdleTimeout(self.value)}
      />
      <Adw.SwitchRow
        title={"Dim Before Lock"}
        subtitle={"Lower brightness before auto-lock"}
        active={settings.screenDimEnabled}
        onNotifyActive={self => settings.setScreenDimEnabled(self.active)}
      />
      <Adw.SpinRow
        title={"Dim Timeout"}
        subtitle={"Seconds before lock to start dimming"}
        adjustment={
          <Gtk.Adjustment
            lower={30}
            upper={1740}
            stepIncrement={30}
            value={settings.screenDimTimeout}
          /> as Gtk.Adjustment}
        onNotifyValue={self => settings.setScreenDimTimeout(self.value)}
      />
    </Adw.PreferencesGroup>

    <Adw.PreferencesGroup
      title={"Notifications"}
      description={"Notification behavior and history"}>
      <Adw.SwitchRow
        title={"Show Progress Bar"}
        subtitle={"Countdown timer on notification popups"}
        active={settings.notificationShowProgress}
        onNotifyActive={self => settings.setNotificationShowProgress(self.active)}
      />
      <Adw.SpinRow
        title={"History Limit"}
        subtitle={"Maximum notifications to keep in history"}
        adjustment={
          <Gtk.Adjustment
            lower={20}
            upper={500}
            stepIncrement={10}
            value={settings.notificationHistoryLimit}
          /> as Gtk.Adjustment}
        onNotifyValue={self => settings.setNotificationHistoryLimit(self.value)}
      />
    </Adw.PreferencesGroup>
  </>
}
