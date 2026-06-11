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
    # QEMU monitor socket for sendkey (XF86 keys) and savevm/loadvm snapshots
    "-monitor" "unix:/tmp/shade-qemu-monitor,server,nowait"
    # SSH port forward for D-Bus testing from host
    # Use: ssh test@localhost -p 2222 (password: test)
    "-netdev" "user,id=net0,hostfwd=tcp::2222-:22"
  ];
}
