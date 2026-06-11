{ config, lib, pkgs, ... }:
{
  imports = [ ./vm.nix ];

  # Expose the VM display via VNC on localhost:5901 for agent automation.
  # The interactive display window is still shown for local debugging.
  virtualisation.vmVariant.virtualisation.qemu.options = [
    "-vnc" "localhost:1"
    # Shared directory for test artifacts (wf-recorder, journal logs, screenshots)
    # Mount inside VM: /mnt/test-output
    # Access from host: /tmp/shade-test-output
    "-virtfs" "local,path=/tmp/shade-test-output,security_model=passthrough,mount_tag=test-output"
  ];
}
