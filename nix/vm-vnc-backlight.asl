/*
 * Guest-local ACPI video/backlight ABI state for the virtio-vga function.
 * This endpoint reports brightness state to the guest kernel; it does not
 * dim or otherwise alter QEMU's display pixels.
 */
DefinitionBlock ("", "SSDT", 2, "OMP", "VMVNCBKL", 0x00000001)
{
    External (\_SB.PCI0.SF0, DeviceObj)

    Scope (\_SB.PCI0.SF0)
    {
        Method (_DOD, 0, NotSerialized)
        {
            Return (Package (0x01)
            {
                0x00000110
            })
        }

        Device (LCD0)
        {
            Name (_ADR, 0x00000110)

            // Raw ACPI video level retained for _BQC; initial level is 100%.
            Name (BRTL, 0x64)

            Method (_BCL, 0, NotSerialized)
            {
                // AC and battery preferences stay at 100% and 50%, followed by supported 100%, 50%, and 0% levels.
                Return (Package (0x05)
                {
                    0x64,
                    0x32,
                    0x64,
                    0x32,
                    0x00
                })
            }

            Method (_BCM, 1, NotSerialized)
            {
                Store (Arg0, BRTL)
            }

            Method (_BQC, 0, NotSerialized)
            {
                Return (BRTL)
            }
        }
    }
}
