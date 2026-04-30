{ config, lib, pkgs, ... }:
{
  imports = [ ./vm.nix ];

  # Expose the VM display via VNC on localhost:5901 for agent automation.
  # The interactive display window is still shown for local debugging.
  virtualisation.vmVariant.virtualisation.qemu.options = [
    "-vnc" "localhost:1"
  ];
}
