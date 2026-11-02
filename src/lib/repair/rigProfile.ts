// Factual hardware profile for the operator's workstation.
// This is reference data, not simulation: every entry is a real part in the rig,
// and it is what grounds Jackie's repair consultant so advice is rig-specific.

export type Component = {
  id: string;
  category: string;
  name: string;
  detail: string;
  /** Where firmware / drivers for this part legitimately come from. */
  firmwareSource?: { label: string; url: string };
  /** Known failure modes and the first thing to check. */
  watchFor?: string[];
};

export const RIG_NAME = "Primary Workstation (Z690 / i9-12900K / RTX 3090)";

export const RIG: Component[] = [
  {
    id: "cpu",
    category: "CPU",
    name: "Intel Core i9-12900K (12th gen, Alder Lake)",
    detail:
      "8 P-cores + 8 E-cores, 24 threads. LGA1700. Hybrid architecture — the Windows/Linux scheduler must know about Thread Director or heavy work lands on E-cores.",
    firmwareSource: {
      label: "Intel microcode ships via MSI BIOS + OS updates",
      url: "https://www.intel.com/content/www/us/en/support/products/134597.html",
    },
    watchFor: [
      "Thermal throttle above ~100 °C — check AIO pump RPM first, not the fans.",
      "Poor performance after a Windows repair install: Intel chipset + Thread Director scheduling regressed.",
      "On Linux, older kernels (<5.16) schedule E-cores badly; prefer a current Ubuntu LTS kernel.",
    ],
  },
  {
    id: "mobo",
    category: "Motherboard",
    name: "MSI MPG Z690 Force WiFi",
    detail:
      "LGA1700, DDR5, 4× M.2 slots, EZ Debug LEDs, Flash BIOS Button (BIOS update with no CPU/RAM needed).",
    firmwareSource: {
      label: "MSI support — BIOS + chipset/LAN/WiFi/audio drivers",
      url: "https://www.msi.com/Motherboard/MPG-Z690-FORCE-WIFI/support",
    },
    watchFor: [
      "EZ Debug LED decode: CPU / DRAM / VGA / BOOT — the lit one names the failed stage.",
      "Never flash BIOS from inside Windows if the Flash BIOS Button is available; USB flash is safer.",
      "CMOS clear resets XMP, RAID mode and boot order — write those down before clearing.",
    ],
  },
  {
    id: "gpu",
    category: "GPU",
    name: "ASUS ROG STRIX RTX 3090",
    detail: "24 GB GDDR6X, Ampere. Needs 2×/3× 8-pin. Heavy transient spikes.",
    firmwareSource: {
      label: "NVIDIA driver downloads (VBIOS only via ASUS support, and only if ASUS says so)",
      url: "https://www.nvidia.com/download/index.aspx",
    },
    watchFor: [
      "Black screen / driver timeout under load is usually PSU transients or riser/cable, not a dead GPU.",
      "GDDR6X memory junction temps run hot (100–110 °C) — that is normal, core temp is the tell.",
      "Do NOT flash VBIOS to chase performance; a bad VBIOS bricks the card with no recovery path.",
    ],
  },
  {
    id: "ram",
    category: "Memory",
    name: "Crucial DDR5 — 4 × 32 GB = 128 GB",
    detail:
      "Four DIMMs on Z690 = 2 DIMMs per channel, which lowers the stable speed ceiling. Expect JEDEC speed or a mild XMP, not full-rated 4-stick speed.",
    firmwareSource: {
      label: "Crucial support — DDR5 has on-die PMIC, no user firmware",
      url: "https://www.crucial.com/support",
    },
    watchFor: [
      "Random reboots / WHEA errors after enabling XMP with 4 sticks — drop to JEDEC and re-test.",
      "DRAM EZ Debug LED after adding sticks: reseat, then test one stick in slot A2.",
      "Memtest86 for at least 4 passes before blaming Windows or drivers.",
    ],
  },
  {
    id: "nvme",
    category: "Storage · NVMe",
    name: "4 × Samsung 980 PRO 2 TB = 8 TB",
    detail:
      "PCIe 4.0 NVMe. All four M.2 slots populated — check the manual for which slots share lanes with PCIe x16 or SATA ports.",
    firmwareSource: {
      label: "Samsung Magician (firmware — 5B2QGXA7 fixed the early health-degradation bug)",
      url: "https://semiconductor.samsung.com/consumer-storage/support/tools/",
    },
    watchFor: [
      "Early 980 PRO firmware had a known health-degradation defect — verify firmware is current on all four.",
      "Populating M.2_3/M.2_4 can disable SATA ports; a 'missing' HDD is often this, not a dead drive.",
      "Thermal throttling without the motherboard M.2 heatsinks installed.",
    ],
  },
  {
    id: "ssd",
    category: "Storage · SATA SSD",
    name: "Crucial SSD 4 TB",
    detail: "SATA. Good staging / scratch target; far slower than the NVMe pool.",
    firmwareSource: { label: "Crucial Storage Executive", url: "https://www.crucial.com/support/storage-executive" },
  },
  {
    id: "hdd",
    category: "Storage · HDD",
    name: "Seagate 2 TB HDD",
    detail: "Spinning disk. Best used as a cold copy / image target, never in a striped set with SSDs.",
    firmwareSource: { label: "Seagate SeaTools + firmware", url: "https://www.seagate.com/support/downloads/" },
    watchFor: ["Run a SMART long test before trusting it with backups."],
  },
  {
    id: "cooling",
    category: "Cooling",
    name: "Corsair 360 mm AIO liquid cooler",
    detail: "Triple-120 radiator. Pump must be on a header set to full speed (PUMP_FAN / AIO_PUMP), not PWM-curved.",
    watchFor: [
      "Instant thermal throttle at idle-to-load = pump not spinning or header set to a fan curve.",
      "Air pocket noise after moving the case — radiator should sit at or above the pump.",
      "AIOs are the #1 silent failure in this class of build; log pump RPM every check-up.",
    ],
  },
  {
    id: "psu",
    category: "Power",
    name: "Seasonic 1300 W Platinum",
    detail:
      "Plenty of headroom for 12900K + 3090 transients. Use separate PCIe cables per GPU connector, never a single daisy-chain.",
    watchFor: [
      "Shutdown under combined CPU+GPU load with a good PSU usually means cable sharing or OCP on one rail.",
      "Never mix modular cables from a different PSU model — pinouts differ and it kills hardware.",
    ],
  },
];

export const RAID_PLAN_NOTES = [
  "RAID is uptime, not backup. Anything that deletes a file deletes it on every member instantly. Keep a real cold copy.",
  "Do not mix media in one array. NVMe + SATA SSD + HDD in a single set runs at the slowest member and multiplies failure risk.",
  "Sensible split for this rig: NVMe ×4 in a striped/parity-free fast pool for work, Crucial 4 TB SATA as local image target, Seagate 2 TB as cold copy.",
  "Intel RST (VMD) RAID on Z690 needs the RST driver loaded during Windows setup, and switching the SATA/RST mode after install will not boot until you enable it the safe way (Windows: safe-mode toggle) — see the playbook.",
  "Ubuntu: prefer mdadm or ZFS/btrfs over motherboard RST. Firmware RAID ties your data to this exact board model.",
  "Before ANY array change: full image out. Array creation is destructive by definition.",
];
