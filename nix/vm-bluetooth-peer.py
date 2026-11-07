"""Guest-only btvirt Just Works simulation, not physical authentication."""
import signal
import time
from pathlib import Path

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

DBusGMainLoop(set_as_default=True)
bus = dbus.SystemBus()
loop = GLib.MainLoop()
BLUEZ = "org.bluez"
ADAPTER = "org.bluez.Adapter1"
DEVICE = "org.bluez.Device1"
PROPERTIES = "org.freedesktop.DBus.Properties"
AGENT = "org.bluez.Agent1"
ADV = "org.bluez.LEAdvertisement1"
manager = dbus.Interface(bus.get_object(BLUEZ, "/"), "org.freedesktop.DBus.ObjectManager")
for attempt in range(30):
    adapters = [(str(path), props[ADAPTER]) for path, props in manager.GetManagedObjects().items() if ADAPTER in props]
    if len(adapters) == 2:
        break
    time.sleep(1)
else:
    raise RuntimeError("Expected exactly two guest btvirt adapters")
# Preserve BlueZ enumeration order, but require emulator addresses AND virtual sysfs devices.
for path, props in adapters:
    sysfs = Path("/sys/class/bluetooth") / path.rsplit("/", 1)[1]
    if not str(props["Address"]).startswith("00:AA:01:") or "/virtual/" not in str(sysfs.resolve()):
        raise RuntimeError(f"Refusing non-btvirt adapter {path}: {props['Address']}")
main, peer = adapters
allowed = {
    main[0] + "/dev_" + str(peer[1]["Address"]).replace(":", "_"),
    peer[0] + "/dev_" + str(main[1]["Address"]).replace(":", "_"),
}

class Rejected(dbus.DBusException):
    _dbus_error_name = "org.bluez.Error.Rejected"

class Agent(dbus.service.Object):
    @dbus.service.method(AGENT, in_signature="o", out_signature="")
    def RequestAuthorization(self, device):
        if str(device) not in allowed:
            raise Rejected("Not an owned btvirt counterpart")
        print(f"JustWorks consent: {device}", flush=True)

    @dbus.service.method(AGENT, in_signature="os", out_signature="")
    def AuthorizeService(self, device, uuid):
        self.RequestAuthorization(device)
        print(f"Owned counterpart service: {uuid}", flush=True)

    @dbus.service.method(AGENT, in_signature="o", out_signature="s")
    def RequestPinCode(self, device):
        raise Rejected("PIN authentication is not simulated")

    @dbus.service.method(AGENT, in_signature="o", out_signature="u")
    def RequestPasskey(self, device):
        raise Rejected("Passkey authentication is not simulated")

    @dbus.service.method(AGENT, in_signature="ou", out_signature="")
    def RequestConfirmation(self, device, passkey):
        raise Rejected("Numeric comparison is not simulated")

    @dbus.service.method(AGENT, in_signature="os", out_signature="")
    def DisplayPinCode(self, device, pin):
        raise Rejected("PIN display is not simulated")

    @dbus.service.method(AGENT, in_signature="ouq", out_signature="")
    def DisplayPasskey(self, device, passkey, entered):
        raise Rejected("Passkey display is not simulated")

    @dbus.service.method(AGENT, in_signature="", out_signature="")
    def Cancel(self):
        print("BlueZ canceled authentication", flush=True)

    @dbus.service.method(AGENT, in_signature="", out_signature="")
    def Release(self):
        loop.quit()

class Advertisement(dbus.service.Object):
    @dbus.service.method(PROPERTIES, in_signature="s", out_signature="a{sv}")
    def GetAll(self, interface):
        if interface != ADV:
            raise Rejected("Unsupported advertisement interface")
        return {"Type": "peripheral", "LocalName": "ShadeVM-Peer"}

    @dbus.service.method(ADV, in_signature="", out_signature="")
    def Release(self):
        print("BlueZ released advertisement", flush=True)

agent_path = "/org/shade/fixture/agent"
adv_path = "/org/shade/fixture/advertisement"
agent = Agent(bus, agent_path)
advertisement = Advertisement(bus, adv_path)
agent_manager = dbus.Interface(bus.get_object(BLUEZ, "/org/bluez"), "org.bluez.AgentManager1")
peer_properties = dbus.Interface(bus.get_object(BLUEZ, peer[0]), PROPERTIES)
adv_manager = dbus.Interface(bus.get_object(BLUEZ, peer[0]), "org.bluez.LEAdvertisingManager1")
original = {name: peer_properties.Get(ADAPTER, name) for name in ("Alias", "Powered", "Pairable", "Discoverable", "PairableTimeout", "DiscoverableTimeout")}
registered_agent = registered_adv = False
signal.signal(signal.SIGTERM, lambda *_: loop.quit())
signal.signal(signal.SIGINT, lambda *_: loop.quit())
try:
    agent_manager.RegisterAgent(agent_path, "NoInputNoOutput")
    registered_agent = True
    agent_manager.RequestDefaultAgent(agent_path)
    for name, value in (("Powered", dbus.Boolean(True)), ("Alias", "ShadeVM-Peer"), ("PairableTimeout", dbus.UInt32(0)), ("DiscoverableTimeout", dbus.UInt32(0)), ("Pairable", dbus.Boolean(True)), ("Discoverable", dbus.Boolean(True))):
        peer_properties.Set(ADAPTER, name, value)
    # Registration calls back into this process for advertisement properties.
    adv_manager.RegisterAdvertisement(adv_path, {}, reply_handler=lambda: print(f"READY main={main[1]['Address']} peer={peer[1]['Address']}", flush=True), error_handler=lambda error: (print(str(error), flush=True), loop.quit()))
    loop.run()
finally:
    # Unregister may report DoesNotExist if BlueZ already released the object.
    for operation in (lambda: adv_manager.UnregisterAdvertisement(adv_path), lambda: agent_manager.UnregisterAgent(agent_path)):
        try:
            operation()
        except dbus.DBusException as error:
            print(f"Fixture unregister: {error}", flush=True)
    for name in ("Discoverable", "Pairable", "DiscoverableTimeout", "PairableTimeout", "Alias", "Powered"):
        peer_properties.Set(ADAPTER, name, original[name])
    for adapter, counterpart in ((main, peer), (peer, main)):
        device = adapter[0] + "/dev_" + str(counterpart[1]["Address"]).replace(":", "_")
        try:
            dbus.Interface(bus.get_object(BLUEZ, adapter[0]), ADAPTER).RemoveDevice(device)
        except dbus.DBusException as error:
            if error.get_dbus_name() != "org.bluez.Error.DoesNotExist":
                print(f"Fixture counterpart cleanup: {error}", flush=True)
