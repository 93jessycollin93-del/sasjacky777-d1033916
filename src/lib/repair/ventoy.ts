// Guided Ventoy boot-stick build. Every command here is a real command; every
// download link is the vendor's own page. Jackie cannot host Windows or Ubuntu
// media (multi-GB licensed images), so this is the honest version: official
// source + checksum verification you run yourself.

export type WizardStep = {
  id: string;
  title: string;
  body: string;
  /** Commands to run for this step, per shell. */
  cmds?: { shell: "PowerShell" | "CMD" | "Bash"; cmd: string; note?: string }[];
  links?: { label: string; url: string }[];
  /** Something that will destroy data or waste hours if skipped. */
  warn?: string;
};

export const VENTOY_STEPS: WizardStep[] = [
  {
    id: "stick",
    title: "1 · Pick the stick",
    body:
      "32 GB minimum, 64 GB comfortable (Win11 + Win10 + Ubuntu + Memtest + your Z690 BIOS all fit at 64 GB). USB 3.0 or better, or recovery installs will crawl. This stick gets fully erased.",
    warn: "Ventoy repartitions the whole device. Copy anything off it first — there is no undo.",
    cmds: [
      {
        shell: "PowerShell",
        cmd: "Get-Disk | Select-Object Number,FriendlyName,@{n='GB';e={[math]::Round($_.Size/1GB,1)}},BusType",
        note: "Confirm the disk NUMBER of the USB before you touch any tool. BusType should read USB.",
      },
    ],
  },
  {
    id: "install-ventoy",
    title: "2 · Install Ventoy once (GPT + Secure Boot)",
    body:
      "Download Ventoy, run Ventoy2Disk.exe as admin. In Option → Partition Style choose GPT (your Z690 boots UEFI). In Option → Secure Boot Support, tick it — otherwise Secure Boot must be turned off in BIOS to boot the stick. Then press Install. Ventoy is installed to the stick, not to Windows.",
    links: [
      { label: "Ventoy official download", url: "https://www.ventoy.net/en/download.html" },
      { label: "Ventoy Secure Boot notes", url: "https://www.ventoy.net/en/doc_secure.html" },
    ],
    cmds: [
      {
        shell: "PowerShell",
        cmd: "certutil -hashfile ventoy-*-windows.zip SHA256",
        note: "Ventoy publishes SHA-256 for its own release zip. Verify it before running the installer.",
      },
    ],
  },
  {
    id: "isos",
    title: "3 · Download the ISOs from the vendor only",
    body:
      "After Ventoy installs, the stick shows a large exFAT partition. Copy ISO files straight onto it — no imaging, no burning. Ventoy shows a boot menu of whatever ISOs it finds.",
    warn:
      "Never use 'preactivated', 'lite' or 'compressed' Windows ISOs. They are the single most common malware vector on enthusiast machines.",
    links: [
      { label: "Windows 11 ISO (Microsoft)", url: "https://www.microsoft.com/software-download/windows11" },
      { label: "Windows 10 ISO (Microsoft)", url: "https://www.microsoft.com/software-download/windows10ISO" },
      { label: "Ubuntu Desktop LTS", url: "https://ubuntu.com/download/desktop" },
      { label: "Memtest86 (free edition)", url: "https://www.memtest86.com/download.htm" },
      { label: "GParted Live", url: "https://gparted.org/download.php" },
      { label: "MSI MPG Z690 Force WiFi BIOS", url: "https://www.msi.com/Motherboard/MPG-Z690-FORCE-WIFI/support" },
    ],
  },
  {
    id: "verify",
    title: "4 · Verify every ISO with SHA-256 before you trust it",
    body:
      "A truncated or tampered ISO fails halfway through a recovery — at the exact moment you have no working machine. Hash each file and compare to the vendor's published value character by character (or with the compare command below).",
    cmds: [
      {
        shell: "CMD",
        cmd: "certutil -hashfile D:\\Win11_24H2_English_x64.iso SHA256",
        note: "Built into Windows. Replace D:\\ with the Ventoy partition letter.",
      },
      {
        shell: "PowerShell",
        cmd: "Get-FileHash -Algorithm SHA256 D:\\*.iso | Format-List Path,Hash",
        note: "Hashes every ISO on the stick in one pass.",
      },
      {
        shell: "PowerShell",
        cmd: "$expected='PASTE_VENDOR_SHA256_HERE'\n$actual=(Get-FileHash -Algorithm SHA256 D:\\Win11_24H2_English_x64.iso).Hash\nif ($actual -eq $expected) { 'MATCH - safe to use' } else { \"MISMATCH - re-download`nexpected: $expected`nactual:   $actual\" }",
        note: "Machine-compares instead of eyeballing 64 hex characters.",
      },
      {
        shell: "Bash",
        cmd: "sha256sum /media/$USER/Ventoy/*.iso\n# Ubuntu publishes a signed SHA256SUMS file:\nsha256sum -c SHA256SUMS 2>/dev/null | grep -v 'No such file'",
        note: "For Ubuntu, verify against the published SHA256SUMS rather than a single value.",
      },
    ],
    links: [
      { label: "Ubuntu SHA256SUMS + GPG verification", url: "https://ubuntu.com/tutorials/how-to-verify-ubuntu" },
    ],
  },
  {
    id: "extras",
    title: "5 · Add the rescue extras",
    body:
      "Ventoy lets you keep plain files alongside the ISOs. Put these in their own folders so you can find them at 3am: \\BIOS\\MSI.ROM (renamed Z690 BIOS for the Flash BIOS Button), \\DRIVERS\\ (Intel chipset + RST/VMD driver, MSI LAN/WiFi driver, NVIDIA driver), \\NOTES\\ (your BitLocker recovery key location, BIOS settings photos, current firmware versions).",
    warn:
      "Windows setup cannot see NVMe drives in Intel RST/VMD mode without the RST driver loaded from this stick. Put it there now, not later.",
  },
  {
    id: "boot-test",
    title: "6 · Boot it today, before you need it",
    body:
      "Restart, tap Del for BIOS or F11 for the MSI boot menu, pick the UEFI entry for the USB. You should land on the Ventoy menu listing your ISOs. Open Win11 setup to the language screen, then cancel. An untested rescue stick is not a rescue stick.",
    cmds: [
      {
        shell: "PowerShell",
        cmd: "manage-bde -status",
        note: "If any volume shows BitLocker on, save the recovery key somewhere off this machine before a repair install.",
      },
      {
        shell: "PowerShell",
        cmd: "Confirm-SecureBootUEFI",
        note: "True means Secure Boot is on — your Ventoy install needs Secure Boot Support ticked.",
      },
    ],
  },
  {
    id: "image",
    title: "7 · Pair it with a real system image",
    body:
      "The stick reinstalls; an image restores YOU. Write a full system image to the Crucial 4 TB SATA, and keep the Seagate 2 TB as a cold copy that stays unplugged.",
    cmds: [
      {
        shell: "CMD",
        cmd: "wbadmin start backup -backupTarget:E: -include:C: -allCritical -quiet",
        note: "Built-in imaging. E: = the Crucial SATA target. Run from an admin prompt.",
      },
      {
        shell: "PowerShell",
        cmd: "Get-Volume | Select-Object DriveLetter,FileSystemLabel,@{n='FreeGB';e={[math]::Round($_.SizeRemaining/1GB,1)}}",
        note: "Confirm the target has room before starting.",
      },
    ],
    warn: "An untested backup is a rumor. Restore one file from it before you call this done.",
  },
];

/** The checklist that lives next to the wizard — persisted per item. */
export const ISO_CHECKLIST: { id: string; label: string; detail: string }[] = [
  { id: "win11", label: "Windows 11 ISO (official)", detail: "Primary OS repair + clean install." },
  { id: "win10", label: "Windows 10 ISO (official)", detail: "Fallback if a Win11 driver situation blocks you." },
  { id: "ubuntu", label: "Ubuntu LTS Desktop ISO", detail: "Works when Windows won't: data rescue, disk imaging, network." },
  { id: "memtest", label: "Memtest86", detail: "The only honest test for 128 GB / 4-DIMM DDR5 instability." },
  { id: "gparted", label: "GParted Live", detail: "Partition rescue without touching the Windows installer." },
  { id: "bios", label: "MSI Z690 BIOS as \\BIOS\\MSI.ROM", detail: "Required by the Flash BIOS Button recovery path." },
  { id: "rst", label: "Intel RST / VMD driver", detail: "Without it, Windows setup shows zero NVMe drives." },
  { id: "chipset", label: "Intel chipset + MSI LAN/WiFi drivers", detail: "A fresh install with no network is a dead end." },
  { id: "nvidia", label: "NVIDIA driver installer", detail: "Offline display fix for the 3090." },
  { id: "keys", label: "BitLocker recovery key + BIOS setting photos", detail: "Stored OFF this machine." },
  { id: "hashes", label: "SHA-256 verified for every ISO", detail: "Hash matched to the vendor's published value." },
  { id: "booted", label: "Stick booted successfully at least once", detail: "Tested, not assumed." },
];

export const CHECKLIST_KEY = "jackie.repair.bootstick.v1";
