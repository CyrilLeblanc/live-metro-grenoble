# Fix: GRUB Rescue — "error: attempt to read or write outside of disk 'hd0'"

This error appears in the `grub rescue>` prompt when GRUB cannot find its configuration or modules at the expected location on the disk. It usually means the partition layout changed (resize, repartition, new drive) and GRUB's stored offsets no longer match.

---

## Quick diagnosis from the GRUB rescue prompt

List detected disks and partitions:

```
grub rescue> ls
```

Typical output: `(hd0) (hd0,gpt1) (hd0,gpt2) (hd0,gpt3)` or `(hd0,msdos1)` etc.

Try each partition until you find the one with `/boot/grub`:

```
grub rescue> ls (hd0,gpt2)/
grub rescue> ls (hd0,gpt2)/boot/grub/
```

You are looking for a directory that contains `grub.cfg` and module files (`.mod`).

---

## Recovery steps (no live USB needed)

Once you have identified the correct partition (e.g. `(hd0,gpt2)`):

```
grub rescue> set root=(hd0,gpt2)
grub rescue> set prefix=(hd0,gpt2)/boot/grub
grub rescue> insmod normal
grub rescue> normal
```

GRUB should load its full menu. Select your Linux entry and boot normally.

---

## Make the fix permanent after booting

After booting into Linux, reinstall GRUB and regenerate its configuration so the error does not return on the next reboot.

**Identify your disk** (the whole disk, not a partition):

```bash
lsblk
# e.g. sda, nvme0n1, vda
```

**Reinstall GRUB and update config:**

```bash
sudo grub-install /dev/sda        # replace sda with your actual disk
sudo update-grub
```

For EFI systems (check if `/sys/firmware/efi` exists):

```bash
sudo grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=GRUB
sudo update-grub
```

---

## Common root causes

| Cause | Symptom |
|---|---|
| Disk resized / repartitioned | Partition numbers shifted |
| Drive replaced or cloned | New disk has different geometry |
| Dual-boot with Windows resizing partition | EFI or `/boot` moved |
| GRUB installed on wrong disk | Second drive listed as `hd0` in BIOS |

---

## If `insmod normal` fails

The GRUB modules are missing or corrupted. You need a live USB:

1. Boot from a live Ubuntu/Debian USB
2. Mount your Linux partition: `sudo mount /dev/sdaX /mnt`
3. Mount the EFI partition if applicable: `sudo mount /dev/sdaY /mnt/boot/efi`
4. Bind system directories:
   ```bash
   sudo mount --bind /dev  /mnt/dev
   sudo mount --bind /proc /mnt/proc
   sudo mount --bind /sys  /mnt/sys
   ```
5. Chroot: `sudo chroot /mnt`
6. Reinstall GRUB from inside the chroot:
   ```bash
   grub-install /dev/sda
   update-grub
   exit
   ```
7. Unmount and reboot.

---

> **Note:** This repository is the Live Metro Grenoble web application. This document was added in response to a support issue and is provided as a general Linux troubleshooting reference.
