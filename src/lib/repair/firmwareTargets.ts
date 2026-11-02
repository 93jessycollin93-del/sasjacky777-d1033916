// The seven firmware/driver targets on this rig, analyzed.
//
// One entry per thing that can actually be updated on this machine. Each entry
// answers the same four questions in the same order, because that is the order
// that keeps you out of trouble:
//   1. How do I read the version I'm on right now? (no guessing)
//   2. What does an update here actually buy me?
//   3. What happens if the flash fails, and can I get back?
//   4. When should I take it — now, later, or never?
//
// Nothing here is invented. Where a specific build number is named, it is a
// publicly documented release. Where no build is named, that is deliberate:
// the changelog for that part has to be read at flash time, because it changes.

export type Cadence = "safe-anytime" | "read-notes-first" | "only-for-a-named-fix" | "never-unsolicited";

export type FirmwareTarget = {
  id: string;
  /** What it is, in the operator's words. */
  name: string;
  /** Which rig component it belongs to, if any (links to RIG ids). */
  componentId?: string;
  /** Is this firmware, a driver, or a utility? They carry very different risk. */
  kind: "firmware" | "driver" | "utility";
  cadence: Cadence;
  /** Exact command or click-path to read the installed version. */
  readVersion: string[];
  /** What an update genuinely gives you. */
  gain: string;
  /** What a bad update costs, and the recovery path — or the absence of one. */
  ifItFails: string;
  /** The rule Jackie holds to for this part. */
  rule: string;
  /** Order in the safe flash sequence. Lower goes first. 0 = not part of the sequence. */
  sequence: number;
  source?: { label: string; url: string };
  /** Named, documented builds worth knowing. Empty when there is nothing verified. */
  knownBuilds?: { version: string; note: string }[];
};

export const FIRMWARE_TARGETS: FirmwareTarget[] = [
  {
    id: "cpu-microcode",
    name: "Intel i9-12900K microcode",
    componentId: "cpu",
    kind: "firmware",
    cadence: "safe-anytime",
    sequence: 3,
    readVersion: [
      'Windows PowerShell: Get-CimInstance Win32_Processor | Select-Object Name, Description',
      'Windows, exact revision: reg query "HKLM\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0" /v "Update Revision"',
      "Linux: grep microcode /proc/cpuinfo   (one line per thread; all should match)",
      "Linux, load history: dmesg | grep -i microcode",
    ],
    gain:
      "Alder Lake microcode revisions have addressed hybrid-scheduling errata, DDR5 stability edges and side-channel security advisories. On a 12900K this is the single highest-value, lowest-risk update class you have.",
    ifItFails:
      "Effectively nothing to fail. Microcode is loaded fresh at every boot by the BIOS or the OS — it is not written into the CPU. A bad revision is undone by booting the previous BIOS or removing the OS microcode package.",
    rule:
      "You never flash the CPU directly. Take microcode through Windows Update / the Ubuntu intel-microcode package first. Only chase it through a BIOS flash when MSI's notes name the errata you are actually hitting.",
    source: {
      label: "Intel processor support — advisories and microcode guidance",
      url: "https://www.intel.com/content/www/us/en/support/products/134597.html",
    },
  },
  {
    id: "intel-me",
    name: "Intel Management Engine (ME / CSME) firmware",
    componentId: "mobo",
    kind: "firmware",
    cadence: "only-for-a-named-fix",
    sequence: 2,
    readVersion: [
      "Windows: Device Manager → System devices → Intel(R) Management Engine Interface → Driver tab (that is the DRIVER version, not the firmware).",
      "Firmware version, the honest way: reboot into the MSI BIOS — the ME/CSME firmware version is listed on the BIOS information page.",
      "Or run Intel's MEInfo tool from a USB stick and read the 'FW Version' line.",
      "Linux: sudo dmesg | grep -i mei   confirms the interface loads; it does not report the firmware build.",
    ],
    gain:
      "ME firmware updates exist almost exclusively for security advisories (INTEL-SA-xxxxx) — privilege escalation and remote-management exposure. There is no performance in it. There is real exposure in ignoring a published advisory on a machine that is on the internet.",
    ifItFails:
      "This is the sharpest edge on the board. A failed or mismatched ME flash can leave the platform unable to POST, and ME is not covered by the normal BIOS recovery path in every failure mode. Recovery usually means the MSI Flash BIOS Button with a full BIOS image that carries a matching ME region.",
    rule:
      "Do not flash ME standalone from a tool you found on a forum. Take ME updates the way MSI ships them: inside the official Z690 Force BIOS package for your board. If MSI has not published one, you do not have one to take.",
    source: {
      label: "MSI MPG Z690 Force WiFi support — BIOS packages carry the ME region",
      url: "https://www.msi.com/Motherboard/MPG-Z690-FORCE-WIFI/support",
    },
  },
  {
    id: "intel-chipset",
    name: "Intel chipset device software + RST driver",
    componentId: "mobo",
    kind: "driver",
    cadence: "safe-anytime",
    sequence: 4,
    readVersion: [
      "Windows: Settings → Apps → look for 'Intel Chipset Device Software' and read its version.",
      'PowerShell: Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.Manufacturer -like "*Intel*" } | Select-Object DeviceName, DriverVersion | Sort-Object DeviceName',
      "RST specifically: open Intel Optane Memory and Storage Management, or read the iaStorVD/iaStorAC driver version in Device Manager → Storage controllers.",
    ],
    gain:
      "Chipset software is mostly INF files that give Windows the right names and power states for Z690 devices — low drama, real benefit after any repair install. The RST driver is the one that matters: on this board it is what lets Windows see an Intel VMD/RAID volume at all.",
    ifItFails:
      "Chipset INFs are reversible via Device Manager rollback. The RST driver is not casual: replacing it while you are booting from an RST volume can cost you the boot. Have the current RST driver package on a USB stick before you touch it.",
    rule:
      "Chipset INF: take it freely, especially after a repair install where 12th-gen scheduling went sideways. RST driver: only change it with a bootable recovery stick already made, and never on the same day you change BIOS SATA/VMD mode.",
    source: {
      label: "MSI Z690 Force support — chipset, LAN, WiFi, audio, RST",
      url: "https://www.msi.com/Motherboard/MPG-Z690-FORCE-WIFI/support",
    },
  },
  {
    id: "msi-bios",
    name: "MSI MPG Z690 Force WiFi BIOS",
    componentId: "mobo",
    kind: "firmware",
    cadence: "read-notes-first",
    sequence: 1,
    readVersion: [
      'Windows: wmic bios get smbiosbiosversion, releasedate   (or PowerShell: Get-CimInstance Win32_BIOS | Select-Object SMBIOSBIOSVersion, ReleaseDate)',
      "Linux: sudo dmidecode -s bios-version && sudo dmidecode -s bios-release-date",
      "Or read it on the BIOS main page at POST — that is the version that counts.",
    ],
    gain:
      "Three legitimate reasons only: a microcode revision you need, a DDR5 memory-training fix that matches a symptom you actually have (this is the real one for 4×32 GB), or a published security advisory. 'Improved performance' with no named fix is marketing, not a reason.",
    ifItFails:
      "This is the part with a real safety net, and it is why this board was a good choice: the Flash BIOS Button recovers a bad flash with no CPU and no RAM installed. That net only exists if you keep a known-good BIOS file on a FAT32 stick, in the root, renamed to MSI.ROM.",
    rule:
      "BIOS goes first in the sequence because it carries microcode and the ME region. Flash from the USB Flash BIOS Button, never from inside Windows. Write down XMP, RAID/VMD mode and boot order before you start — a flash resets all three.",
    source: {
      label: "MSI MPG Z690 Force WiFi — BIOS downloads and per-version notes",
      url: "https://www.msi.com/Motherboard/MPG-Z690-FORCE-WIFI/support",
    },
  },
  {
    id: "gpu-vbios",
    name: "ASUS ROG STRIX RTX 3090 VBIOS",
    componentId: "gpu",
    kind: "firmware",
    cadence: "never-unsolicited",
    sequence: 0,
    readVersion: [
      "GPU-Z → main page → 'BIOS Version' (use the little chip icon to save a backup copy of it, do that today).",
      "NVIDIA App / Control Panel → System Information → 'VBIOS Version'.",
      "Linux: nvidia-smi -q | grep -i vbios",
    ],
    gain:
      "Almost nothing you want. Black screens under load, driver timeouts and TDR crashes on this card are PSU transients, a cable-sharing problem or a driver bug — not VBIOS. The driver update is what actually fixes what you are chasing.",
    ifItFails:
      "There is no user recovery path. A bad 3090 VBIOS is a dead card, and the only fix is an ASUS RMA. This is the one part in the rig with a genuinely irreversible failure mode.",
    rule:
      "Never, unless ASUS support instructs you to for a named defect on your serial. Update the NVIDIA driver instead — that is reversible, and it is the real fix 95% of the time. Save a VBIOS backup with GPU-Z regardless, so you have the option you hope never to need.",
    source: {
      label: "NVIDIA driver downloads (VBIOS only ever via ASUS support)",
      url: "https://www.nvidia.com/download/index.aspx",
    },
  },
  {
    id: "nvme-fw",
    name: "Samsung 980 PRO 2 TB firmware (×4)",
    componentId: "nvme",
    kind: "firmware",
    cadence: "read-notes-first",
    sequence: 5,
    readVersion: [
      "Samsung Magician → Drive Details → Firmware. Do this for EACH of the four drives; they can ship on different builds.",
      'Windows: wmic diskdrive get model, firmwarerevision',
      "Linux: sudo nvme list   (the FW Rev column), or sudo smartctl -a /dev/nvme0 | grep -i firmware",
    ],
    gain:
      "This is the one target on the rig with a documented, must-take fix. Early 980 PRO firmware had a health-degradation defect where 'percentage used' climbed abnormally fast; Samsung published 5B2QGXA7 as the fix. On four drives holding 8 TB, that is not optional.",
    ifItFails:
      "Magician flashes in place and the drive keeps its data; a failed attempt is normally recoverable by re-running it. Still: image before you flash, one drive at a time, and never during a storm or on battery.",
    rule:
      "Read all four. Anything older than 5B2QGXA7 is the known-defect firmware — flash it. Flash one drive, reboot, verify the version reads back, then move to the next. Never flash all four in one pass.",
    knownBuilds: [
      {
        version: "5B2QGXA7",
        note: "Samsung's published fix for the 980 PRO health-degradation / rapid wear-indicator defect. This is a flash-now.",
      },
    ],
    source: {
      label: "Samsung Magician + consumer storage tools",
      url: "https://semiconductor.samsung.com/consumer-storage/support/tools/",
    },
  },
  {
    id: "psu-utility",
    name: "Seasonic 1300 W Platinum — utilities",
    componentId: "psu",
    kind: "utility",
    cadence: "never-unsolicited",
    sequence: 0,
    readVersion: [
      "There is nothing to read. This unit exposes no firmware version and no monitoring interface to the OS.",
      "What you can measure: HWiNFO64 → the 12V rail figures reported by the motherboard's own sensors (board-side, not PSU-side, so treat them as indicative).",
      "The real measurement is a clamp meter or a wall-socket power meter under a stress load.",
    ],
    gain:
      "None. Seasonic ships fan-control/monitoring software only for specific digital/connect-capable models, and Platinum-class units in this class are analog from the OS's point of view. There is no update path to want.",
    ifItFails:
      "The failure mode here is not a bad flash — it is installing something that claims to update or monitor a PSU that cannot be updated or monitored. That class of download is where malware lives.",
    rule:
      "Treat any tool offering 'Seasonic firmware' for this unit as bait. Shutdowns under combined 12900K + 3090 load on a 1300 W Platinum are a cabling problem, not a firmware problem: separate PCIe cables per GPU connector, never a daisy-chain, never cables from another PSU model.",
    source: { label: "Seasonic official support and downloads", url: "https://seasonic.com/support/" },
  },
];

/** The order to take updates in when you are doing a full pass. */
export const FLASH_SEQUENCE = FIRMWARE_TARGETS
  .filter((t) => t.sequence > 0)
  .sort((a, b) => a.sequence - b.sequence);

export const CADENCE_LABEL: Record<Cadence, string> = {
  "safe-anytime": "Safe anytime",
  "read-notes-first": "Read notes first",
  "only-for-a-named-fix": "Only for a named fix",
  "never-unsolicited": "Never unsolicited",
};

/** Rules that hold regardless of which target you are looking at. */
export const SEQUENCE_RULES = [
  "One change at a time, then boot and verify. Two changes at once means you cannot tell which one broke it.",
  "Full image out before the first flash. Not a file copy — an image you have actually restored from at least once.",
  "Known-good BIOS on a FAT32 stick as MSI.ROM before you touch the BIOS. The recovery button is useless without the file.",
  "Never flash on battery, during a storm, or when you are tired and it is late. Interrupted flashes are how parts die.",
  "Write down XMP, RAID/VMD mode and boot order before a BIOS flash — the flash resets them and the machine will not boot until you put them back.",
  "Verify after every step: read the version back. 'It said it succeeded' is not verification.",
];

/** A single-file brief the consultant can be grounded in. */
export function targetsBrief(): string {
  return FIRMWARE_TARGETS.map((t) =>
    [
      `## ${t.name} (${t.kind}, ${CADENCE_LABEL[t.cadence]})`,
      `Read version: ${t.readVersion[0]}`,
      `Gain: ${t.gain}`,
      `If it fails: ${t.ifItFails}`,
      `Rule: ${t.rule}`,
      t.knownBuilds?.length
        ? `Documented builds: ${t.knownBuilds.map((b) => `${b.version} — ${b.note}`).join(" | ")}`
        : "",
      t.source ? `Source: ${t.source.url}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  ).join("\n\n");
}
