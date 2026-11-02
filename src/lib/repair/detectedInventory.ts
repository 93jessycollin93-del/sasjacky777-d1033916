// What the machine ACTUALLY reported (operator's own system inventory paste).
//
// This is observed data, not the intended build sheet in rigProfile.ts. Where the
// two disagree, the reported inventory wins for diagnosis and the difference is
// listed as a discrepancy to resolve — never silently "corrected".
//
// Fields the report showed as "Unknown" stay Unknown here. Nothing is guessed:
// each Unknown carries the exact command that fills it in.

export type ReportedItem = { label: string; value: string };

export const REPORT_SOURCE =
  "System inventory reported by the machine (Micro-Star International Co., Ltd. MS-7D30, Windows 11 Home 64-bit).";

/** Verbatim identification block from the report. */
export const REPORTED_SYSTEM: ReportedItem[] = [
  { label: "System", value: "Micro-Star International Co., Ltd. MS-7D30" },
  { label: "BIOS version", value: "Unknown" },
  { label: "BIOS date", value: "Unknown" },
  { label: "Motherboard manufacturer", value: "Unknown" },
  { label: "Motherboard model", value: "Unknown" },
  { label: "Motherboard version", value: "Unknown" },
  { label: "OS edition", value: "Microsoft Windows 11 Home (64-bit)" },
  { label: "OS version (build)", value: "Unknown" },
  { label: "Processor", value: "12th Gen Intel Core i9-12900K" },
  { label: "Memory", value: "128 GB" },
];

export const REPORTED_GRAPHICS = [
  "Intel UHD Graphics 770 (integrated, listed twice — one entry per active adapter instance)",
  "NVIDIA GeForce RTX 3090",
];

export const REPORTED_AUDIO = [
  "NVIDIA High Definition Audio (HDMI/DP audio off the 3090)",
  "USB Audio 2.0 (external interface / headset)",
  "NVIDIA Virtual Audio Device (Wave Extensible) (WDM)",
  "Voicemod (virtual audio driver, software — not hardware)",
];

export const REPORTED_NETWORK = [
  "Intel Ethernet Controller (3) I225-V",
  "Intel Wi-Fi 6E AX210 160MHz (listed twice)",
  "Intel Wireless Bluetooth (AX210 companion radio)",
];

export const REPORTED_STORAGE = [
  { model: "Samsung SSD 980 PRO 2TB", note: "NVMe. Only ONE 980 PRO appears in this report." },
  { model: "ST2000DM008-2FR102", note: "Seagate BarraCuda 2 TB 7200rpm SATA HDD (SMR-class desktop drive)." },
  { model: "WDC WD5000AAKX-001CA0", note: "Western Digital Caviar Blue 500 GB SATA HDD — old spinning disk, not in the build sheet." },
  { model: "TEAC USB HS-SD Card USB Device", note: "USB card reader, removable. Not a fixed disk." },
  { model: "ST316002 1A USB Device", note: "Seagate external USB drive, removable." },
];

/** Where the report disagrees with the intended build in rigProfile.ts. */
export type Discrepancy = {
  id: string;
  what: string;
  reported: string;
  expected: string;
  why: string;
  resolve: string;
};

export const DISCREPANCIES: Discrepancy[] = [
  {
    id: "nvme-count",
    what: "NVMe count",
    reported: "1 × Samsung 980 PRO 2 TB",
    expected: "4 × Samsung 980 PRO 2 TB (8 TB pool)",
    why:
      "Three drives are either not installed, sitting in M.2 slots whose lanes are shared/disabled, or already bound into an Intel RST/VMD array — in RST mode Windows reports the array, not the member drives, so members vanish from a plain device list.",
    resolve:
      "Run the disk list command below. If only one NVMe appears there too, check BIOS → Settings → Advanced → whether SATA/RST (VMD) is enabled and which M.2 slots are populated. Populating M.2_3/M.2_4 on Z690 boards disables SATA ports — that is a documented trade-off, not a fault.",
  },
  {
    id: "crucial-missing",
    what: "Crucial 4 TB SATA SSD",
    reported: "Not present in the report",
    expected: "Crucial SSD 4 TB (staging/image target)",
    why:
      "Either not connected, or its SATA port was disabled by an M.2 slot sharing lanes with it. A disabled SATA port looks exactly like a dead drive.",
    resolve:
      "Before suspecting the drive: move it to SATA_1/SATA_2 (the ports least often shared) and re-check. Only then test the drive itself.",
  },
  {
    id: "wd500-unexpected",
    what: "WDC WD5000AAKX 500 GB",
    reported: "Present",
    expected: "Not in the build sheet",
    why:
      "A Caviar Blue of that generation is roughly a decade old. Old spinning disks are the most likely single point of data loss in this machine.",
    resolve:
      "Run a SMART long test on it before it holds anything you care about. Do not put it in any array with SSDs.",
  },
  {
    id: "igpu-active",
    what: "Intel UHD 770 active alongside the 3090",
    reported: "Both adapters enumerated",
    expected: "3090 as the render/display device",
    why:
      "Normal on a 12900K, and useful (QuickSync encode, a fallback display path). It becomes a problem only if a monitor is plugged into the motherboard output while you expect 3090 performance.",
    resolve:
      "Confirm every monitor cable goes to the 3090's outputs, not the board's HDMI/DP. Then check Windows → Graphics settings that heavy apps are pinned to the 3090.",
  },
  {
    id: "unknown-bios",
    what: "BIOS / board model / OS build all Unknown",
    reported: "Unknown",
    expected: "Readable values",
    why:
      "The reporting tool could not read SMBIOS strings — common when it runs without elevation. MS-7D30 is the MSI board code carried in SMBIOS for this system; treat the exact retail model as unconfirmed until the command below prints it.",
    resolve:
      "Run the three read commands in an elevated terminal and log the results in the Firmware Log. Update Risk scoring stays blank until a real version string exists — it will not guess one.",
  },
];

/** Commands that fill in every Unknown above. Windows-first, since the report is Windows 11. */
export const FILL_UNKNOWNS: { label: string; cmd: string; note: string }[] = [
  {
    label: "BIOS version + date, board manufacturer/model/version",
    cmd: `powershell -NoProfile -Command "Get-CimInstance Win32_BIOS | Select-Object SMBIOSBIOSVersion,ReleaseDate; Get-CimInstance Win32_BaseBoard | Select-Object Manufacturer,Product,Version,SerialNumber"`,
    note: "Run in an elevated PowerShell (Win+X → Terminal (Admin)). SMBIOSBIOSVersion is the string MSI's support page compares against.",
  },
  {
    label: "Windows edition + exact build",
    cmd: `powershell -NoProfile -Command "Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsBuildNumber,OsHardwareAbstractionLayer"`,
    note: "The build number decides which known Windows issues apply to you. 'Unknown' makes OS-level advice guesswork.",
  },
  {
    label: "Every physical disk, including NVMe hidden behind RST",
    cmd: `powershell -NoProfile -Command "Get-PhysicalDisk | Select-Object DeviceId,FriendlyName,MediaType,BusType,Size,HealthStatus | Format-Table -AutoSize"`,
    note: "BusType 'RAID' instead of 'NVMe' means Intel RST/VMD is on and the member drives are behind the controller.",
  },
  {
    label: "NVMe firmware revision per drive",
    cmd: `powershell -NoProfile -Command "Get-CimInstance -ClassName MSFT_PhysicalDisk -Namespace root\\Microsoft\\Windows\\Storage | Select-Object FriendlyName,FirmwareVersion"`,
    note: "Compare each 980 PRO against 5B2QGXA7 — the build Samsung published for the health-degradation defect. Samsung Magician is the authority if this comes back empty.",
  },
  {
    label: "Intel ME firmware version",
    cmd: `powershell -NoProfile -Command "Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -like '*Management Engine*' } | Select-Object DeviceName,DriverVersion"`,
    note: "This reports the ME driver, not the ME firmware. The firmware version only shows in BIOS setup or Intel MEInfo — log whichever you can actually read.",
  },
  {
    label: "GPU driver + VBIOS (back the VBIOS up before anything)",
    cmd: `nvidia-smi --query-gpu=name,driver_version,vbios_version --format=csv`,
    note: "Save this output. Driver updates are safe and reversible; a bad 3090 VBIOS flash has no user recovery path.",
  },
];

/** Honest read of what this specific report means for maintenance priority. */
export const PRIORITY_READ = [
  "Highest priority is not firmware. It is the storage picture: three expected NVMe drives and a 4 TB SATA SSD do not appear, while a ~decade-old 500 GB WD spinning disk does. Find out what is actually holding your data before you flash anything.",
  "Second: get BIOS version, board model and OS build off 'Unknown'. Every firmware verdict on this page refuses to run on guessed versions, by design.",
  "Third: read firmware on each 980 PRO individually. Drives bought together still ship on different builds.",
  "Nothing here justifies touching the 3090 VBIOS. Update the NVIDIA driver instead.",
  "Voicemod is a virtual audio driver, not hardware. If you are chasing audio glitches or crashes, it is a real suspect — disable it first before blaming the NVIDIA or USB audio devices.",
];

/** Compact factual brief for grounding the consultant. */
export function detectedBrief() {
  const sys = REPORTED_SYSTEM.map((r) => `- ${r.label}: ${r.value}`).join("\n");
  const storage = REPORTED_STORAGE.map((s) => `- ${s.model} — ${s.note}`).join("\n");
  const disc = DISCREPANCIES.map(
    (d) => `- ${d.what}: reported "${d.reported}" vs expected "${d.expected}". ${d.why}`,
  ).join("\n");
  return [
    `DETECTED INVENTORY (observed, ${REPORT_SOURCE})`,
    sys,
    `Graphics:\n${REPORTED_GRAPHICS.map((g) => `- ${g}`).join("\n")}`,
    `Audio:\n${REPORTED_AUDIO.map((a) => `- ${a}`).join("\n")}`,
    `Network:\n${REPORTED_NETWORK.map((n) => `- ${n}`).join("\n")}`,
    `Storage as reported:\n${storage}`,
    `DISCREPANCIES vs the intended build sheet:\n${disc}`,
    "Rule: when the report and the build sheet disagree, trust the report for diagnosis and say the difference out loud. Never state a BIOS/firmware version the operator has not logged.",
  ].join("\n\n");
}
