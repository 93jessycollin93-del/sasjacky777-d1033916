// Custody — what Jackie is allowed to duplicate, and how files survive a
// power cut, a bad flash, or an OS that stops booting mid-job.
//
// Two hard truths drive this file:
//   1. Not every file may be copied. Some are machine-bound (BitLocker keys,
//      TPM-sealed blobs, hardlinked blob stores), some are identity-bound
//      (licences, SSH/GPG keys), some are worthless copies (pagefile, hiberfil).
//      Copying them either fails, leaks, or corrupts the source.
//   2. A copy is not a backup until it has been read back and hashed. Every
//      plan here writes to a temporary name, flushes, renames atomically, then
//      verifies by hash. That order is what makes a power outage survivable:
//      the operator is left with either the old file or the new file, never a
//      half-written one.
//
// Pure string + classification logic. No network. Works with the WAN unplugged.

export type Platform = "windows" | "linux";

/** How a class of data may be duplicated. */
export type DupPolicy =
  | "hardlink" // same bytes, one copy on disk — safe, zero space
  | "copy" // real copy, verified by hash
  | "export" // must be exported through a tool, not file-copied
  | "never"; // copying is useless, unsafe, or corrupting

export type Volatility = "cold" | "warm" | "hot";

export type AssetClass = {
  id: string;
  label: string;
  /** Real path fragments that identify this class. */
  match: RegExp[];
  policy: DupPolicy;
  /** How badly a power loss mid-write hurts this data. */
  volatility: Volatility;
  why: string;
  /** The safe handling instruction, stated plainly. */
  handling: string;
  /** Commands that capture it correctly, when capture is possible. */
  capture?: { windows?: string; linux?: string };
};

export const ASSET_CLASSES: AssetClass[] = [
  {
    id: "gguf-weights",
    label: "GGUF model weights",
    match: [/\.gguf($|\.)/i, /[\\/]blobs[\\/]sha256-/i],
    policy: "hardlink",
    volatility: "cold",
    why:
      "Immutable after download and content-addressed in Ollama's store. Two runners can share one file; a second copy of a 20 GB weight buys nothing.",
    handling:
      "Hardlink between runner folders on the SAME volume. Across volumes you must copy — then verify by hash, because a truncated GGUF still opens and produces garbage.",
    capture: {
      windows: 'Get-FileHash -Algorithm SHA256 "<file>" | Format-List',
      linux: 'sha256sum "<file>"',
    },
  },
  {
    id: "ollama-manifests",
    label: "Ollama manifests / Modelfiles",
    match: [/[\\/]manifests[\\/]/i, /modelfile$/i],
    policy: "copy",
    volatility: "warm",
    why: "Tiny JSON that maps a model name to blob digests. Losing it orphans gigabytes of otherwise-good blobs.",
    handling: "Copy the whole manifests tree before any Ollama upgrade or blob prune. It is kilobytes — back it up every time.",
    capture: {
      windows:
        'Copy-Item "$env:USERPROFILE\\.ollama\\models\\manifests" -Destination "<backupRoot>\\ollama-manifests" -Recurse -Force',
      linux: 'cp -a ~/.ollama/models/manifests "<backupRoot>/ollama-manifests"',
    },
  },
  {
    id: "bitlocker-tpm",
    label: "BitLocker keys / TPM-sealed blobs",
    match: [/bitlocker/i, /[\\/]system32[\\/]config[\\/]systemprofile/i, /\.bek$/i, /tpm/i],
    policy: "export",
    volatility: "hot",
    why: "Sealed to this TPM and this board. A file copy is unusable on any other machine, and a BIOS flash can invalidate the seal.",
    handling:
      "Export the recovery password to paper or an offline file BEFORE touching firmware, boot order, Secure Boot, or the TPM. Never rely on a copied blob.",
    capture: {
      windows: "manage-bde -protectors -get C: ; (elevated) manage-bde -protectors -get C: > <backupRoot>\\bitlocker-recovery.txt",
    },
  },
  {
    id: "keys-identity",
    label: "SSH / GPG / API credentials",
    match: [/[\\/]\.ssh[\\/]/i, /[\\/]\.gnupg[\\/]/i, /id_(rsa|ed25519)/i, /\.pem$/i, /\.env($|\.)/i],
    policy: "export",
    volatility: "warm",
    why: "Copying these into a shared or synced backup folder is how private keys leak. They are identity, not data.",
    handling:
      "Back up only to an encrypted container or offline volume, permissions preserved. Never into a model folder, a cloud-synced path, or an evidence export.",
    capture: {
      windows: 'Compress-Archive "$env:USERPROFILE\\.ssh" "<backupRoot>\\ssh-keys.zip"  # then move to encrypted media',
      linux: 'tar -cpzf "<backupRoot>/ssh-keys.tgz" -C ~ .ssh  # then move to encrypted media',
    },
  },
  {
    id: "registry-hives",
    label: "Live registry hives",
    match: [/[\\/]system32[\\/]config[\\/](system|software|sam|security|default)$/i, /\.hiv$/i],
    policy: "export",
    volatility: "hot",
    why: "Held open by the kernel. A raw copy is a torn snapshot that can import a broken machine state.",
    handling: "Use reg export / reg save, or a System Restore point. Never file-copy an in-use hive.",
    capture: {
      windows: 'reg export HKLM\\SYSTEM "<backupRoot>\\SYSTEM.reg" /y ; reg save HKLM\\SYSTEM "<backupRoot>\\SYSTEM.hiv" /y',
    },
  },
  {
    id: "vbios-firmware",
    label: "VBIOS / BIOS images",
    match: [/\.rom$/i, /\.cap$/i, /\.bin$/i, /vbios/i, /bios/i],
    policy: "copy",
    volatility: "cold",
    why: "The single artefact that turns a failed flash from a dead card into a 20-minute recovery.",
    handling:
      "Dump before flashing, store on the emergency USB and one other volume, and record the SHA-256 in the Evidence Log. Verify size is non-zero before you trust it.",
    capture: {
      windows: 'nvidia-smi --query-gpu=name,vbios_version --format=csv ; .\\nvflash64.exe --save <backupRoot>\\3090-vbios.rom',
      linux: "nvidia-smi --query-gpu=name,vbios_version --format=csv",
    },
  },
  {
    id: "vm-db-open",
    label: "Open databases / VM disks / Docker volumes",
    match: [/\.(vhdx|vmdk|qcow2|sqlite|db|mdf|ldb)$/i, /[\\/]docker[\\/]volumes[\\/]/i],
    policy: "export",
    volatility: "hot",
    why: "Copying a file that a running process is writing produces a file that mounts and then fails later, which is worse than no backup.",
    handling: "Stop the VM / service / container first, or use its own export or snapshot command. Then copy the quiesced file and hash it.",
    capture: {
      windows: "Stop-Service <name> ; Checkpoint-VM -Name <vm> -SnapshotName pre-work",
      linux: "docker stop <c> && docker run --rm -v <vol>:/v -v <backupRoot>:/b alpine tar -cf /b/<vol>.tar -C /v .",
    },
  },
  {
    id: "transient",
    label: "Pagefile / hiberfil / temp / caches",
    match: [/pagefile\.sys$/i, /hiberfil\.sys$/i, /swapfile\.sys$/i, /[\\/]temp[\\/]/i, /[\\/]windows[\\/]winsxs[\\/]/i, /node_modules[\\/]/i],
    policy: "never",
    volatility: "hot",
    why: "Regenerated on boot or on demand. Copying wastes hours and can hard-fail on locked files.",
    handling: "Exclude explicitly from every backup job. If a tool insists on copying them, the exclusion list is wrong.",
  },
  {
    id: "user-work",
    label: "Documents / projects / configs",
    match: [/[\\/](documents|desktop|downloads|projects|repos|src)[\\/]/i, /\.(md|json|ya?ml|ps1|sh|txt|conf)$/i],
    policy: "copy",
    volatility: "warm",
    why: "Irreplaceable and small. This is the data an OS reinstall actually destroys.",
    handling: "Copy first, before any repair step. Verify by hash. Keep the previous generation until the new one is verified.",
    capture: {
      windows: 'robocopy "<src>" "<backupRoot>\\work" /E /R:1 /W:1 /FFT /DCOPY:DAT /XJ /LOG+:<backupRoot>\\robocopy.log',
      linux: 'rsync -aH --partial --info=progress2 "<src>/" "<backupRoot>/work/"',
    },
  },
];

export function classifyPath(path: string): AssetClass {
  const p = path.trim();
  const hit = ASSET_CLASSES.find((c) => c.match.some((re) => re.test(p)));
  return (
    hit ?? {
      id: "unclassified",
      label: "Unclassified file",
      match: [],
      policy: "copy",
      volatility: "warm",
      why: "Jackie has no rule for this path yet, so it is treated as irreplaceable until proven otherwise.",
      handling:
        "Treat as copy-and-verify: write to a .part name, rename, hash both sides. Do not hardlink, do not assume it can be regenerated.",
    }
  );
}

export const POLICY_LABEL: Record<DupPolicy, string> = {
  hardlink: "Share by hardlink — never duplicate",
  copy: "Copy and verify by hash",
  export: "Export with its own tool — do not file-copy",
  never: "Do not back up",
};

export const VOLATILITY_LABEL: Record<Volatility, string> = {
  cold: "Immutable — safe to copy any time",
  warm: "Changes between sessions — copy before work starts",
  hot: "Written live — must be quiesced first",
};

/**
 * Power-loss-safe copy. Temp name → flush → atomic rename → hash both sides.
 * The rename is the commit point; a cut before it leaves the original intact.
 */
export function safeCopySteps(src: string, dest: string, platform: Platform) {
  if (platform === "windows") {
    const part = `${dest}.part`;
    return [
      { title: "1 · Copy to a temporary name", command: `Copy-Item -LiteralPath "${src}" -Destination "${part}" -Force` },
      { title: "2 · Flush the volume write cache", command: `Write-VolumeCache -DriveLetter ${(dest.match(/^([A-Za-z]):/)?.[1] ?? "C").toUpperCase()}` },
      { title: "3 · Commit with an atomic rename", command: `Move-Item -LiteralPath "${part}" -Destination "${dest}" -Force` },
      {
        title: "4 · Verify — the two hashes must match",
        command: `(Get-FileHash -Algorithm SHA256 "${src}").Hash; (Get-FileHash -Algorithm SHA256 "${dest}").Hash`,
      },
    ];
  }
  const part = `${dest}.part`;
  return [
    { title: "1 · Copy to a temporary name", command: `cp --preserve=all "${src}" "${part}"` },
    { title: "2 · Flush to platters", command: `sync` },
    { title: "3 · Commit with an atomic rename", command: `mv -f "${part}" "${dest}"` },
    { title: "4 · Verify — the two hashes must match", command: `sha256sum "${src}" "${dest}"` },
  ];
}

/** Share one weight file between runners without a second copy. */
export function hardlinkSteps(src: string, dest: string, platform: Platform) {
  if (platform === "windows") {
    return [
      { title: "1 · Confirm both paths are on the same volume", command: `[System.IO.Path]::GetPathRoot("${src}"); [System.IO.Path]::GetPathRoot("${dest}")` },
      { title: "2 · Create the hardlink (no bytes copied)", command: `New-Item -ItemType HardLink -Path "${dest}" -Target "${src}"` },
      { title: "3 · Confirm one file, two names", command: `fsutil hardlink list "${src}"` },
    ];
  }
  return [
    { title: "1 · Confirm same filesystem", command: `df --output=source "${src}" "$(dirname "${dest}")"` },
    { title: "2 · Create the hardlink", command: `ln "${src}" "${dest}"` },
    { title: "3 · Link count should be 2 or more", command: `stat -c '%h %n' "${src}"` },
  ];
}

export type BackupStage = {
  id: string;
  title: string;
  purpose: string;
  /** Ordered so that the cheapest, most irreplaceable things land first. */
  commands: { windows?: string; linux?: string; note?: string }[];
};

/**
 * Pre-work custody run. Ordered by "what hurts most if the machine dies in the
 * next five minutes", not by convenience.
 */
export function preWorkStages(backupRoot: string): BackupStage[] {
  const B = backupRoot.replace(/[\\/]+$/, "");
  return [
    {
      id: "root",
      title: "Stage 0 · Create the custody root on a volume you are NOT repairing",
      purpose: "Never stage a backup on the disk you are about to touch. If it is the same disk, the backup dies with it.",
      commands: [
        { windows: `New-Item -ItemType Directory -Force -Path "${B}", "${B}\\logs"`, linux: `mkdir -p "${B}/logs"` },
        { windows: `Get-Volume | Select-Object DriveLetter,FileSystemLabel,SizeRemaining`, linux: `df -h`, note: "Confirm free space exceeds what you are about to copy." },
      ],
    },
    {
      id: "identity",
      title: "Stage 1 · Recovery keys and machine identity (seconds, saves days)",
      purpose: "BitLocker recovery, board/BIOS identity and boot config. Without these a firmware step can lock you out of your own disk.",
      commands: [
        { windows: `manage-bde -protectors -get C: > "${B}\\bitlocker-recovery.txt"`, note: "Elevated. Read it back and store off-machine." },
        { windows: `Get-CimInstance Win32_BIOS | Format-List * > "${B}\\bios.txt"`, linux: `sudo dmidecode -t bios -t baseboard > "${B}/bios.txt"` },
        { windows: `bcdedit /export "${B}\\bcd-backup"`, note: "Boot configuration. Restores a machine that boots to a blue screen." },
      ],
    },
    {
      id: "state",
      title: "Stage 2 · OS state snapshot (before drivers, firmware, or cleanup tools)",
      purpose: "A rollback point that does not depend on any copy succeeding.",
      commands: [
        { windows: `Checkpoint-Computer -Description "Jackie pre-work" -RestorePointType MODIFY_SETTINGS`, note: "Requires System Protection enabled on C:." },
        { windows: `reg export HKLM\\SYSTEM "${B}\\SYSTEM.reg" /y ; reg export HKLM\\SOFTWARE "${B}\\SOFTWARE.reg" /y` },
        { windows: `Export-WindowsDriver -Online -Destination "${B}\\drivers"`, note: "Every third-party driver, so a clean install is not a hunt for downloads." },
        { windows: `Get-AppxPackage > "${B}\\apps.txt" ; winget export -o "${B}\\winget.json"`, linux: `dpkg --get-selections > "${B}/packages.txt"` },
      ],
    },
    {
      id: "work",
      title: "Stage 3 · Irreplaceable user work",
      purpose: "Small, unique, and the only thing a reinstall truly destroys. Restartable so a power cut costs minutes, not the whole run.",
      commands: [
        {
          windows: `robocopy "$env:USERPROFILE\\Documents" "${B}\\work\\Documents" /E /R:1 /W:1 /FFT /DCOPY:DAT /XJ /XF pagefile.sys hiberfil.sys /LOG+:"${B}\\logs\\robocopy.log"`,
          linux: `rsync -aH --partial --exclude 'node_modules' ~/Documents/ "${B}/work/Documents/"`,
          note: "/R:1 stops it hanging forever on one locked file. Re-run after a power cut — it resumes.",
        },
        { windows: `robocopy "$env:USERPROFILE\\Desktop" "${B}\\work\\Desktop" /E /R:1 /W:1 /XJ /LOG+:"${B}\\logs\\robocopy.log"` },
      ],
    },
    {
      id: "models",
      title: "Stage 4 · AI estate — manifests always, weights only if unique",
      purpose: "Manifests are kilobytes and irreplaceable. Weights are gigabytes and re-downloadable — back up only what you cannot fetch again.",
      commands: [
        { windows: `Copy-Item "$env:USERPROFILE\\.ollama\\models\\manifests" "${B}\\ollama-manifests" -Recurse -Force`, linux: `cp -a ~/.ollama/models/manifests "${B}/ollama-manifests"` },
        {
          windows: `Get-ChildItem "$env:USERPROFILE\\.lmstudio\\models" -Recurse -Filter *.gguf | Select-Object FullName,Length | Export-Csv "${B}\\gguf-inventory.csv" -NoTypeInformation`,
          linux: `find ~/.lmstudio/models -name '*.gguf' -printf '%p,%s\\n' > "${B}/gguf-inventory.csv"`,
          note: "Inventory first. Paste it into Model Vault so Jackie can tell duplicates from unique files.",
        },
      ],
    },
    {
      id: "seal",
      title: "Stage 5 · Seal the set — a copy is not a backup until it is verified",
      purpose: "Hash manifest of everything captured. This is what proves the backup is intact after a power event.",
      commands: [
        {
          windows: `Get-ChildItem "${B}" -Recurse -File | Get-FileHash -Algorithm SHA256 | Export-Csv "${B}\\MANIFEST.csv" -NoTypeInformation`,
          linux: `find "${B}" -type f ! -name MANIFEST.txt -exec sha256sum {} + > "${B}/MANIFEST.txt"`,
        },
        {
          windows: `Import-Csv "${B}\\MANIFEST.csv" | ForEach-Object { if ((Get-FileHash $_.Path -Algorithm SHA256).Hash -ne $_.Hash) { "MISMATCH: " + $_.Path } }`,
          linux: `sha256sum -c "${B}/MANIFEST.txt" | grep -v ': OK$' || echo 'all files verified'`,
          note: "Run this again after every power loss and before you trust a restore.",
        },
      ],
    },
  ];
}

/** Rules that hold whatever the task is. Short enough to obey under pressure. */
export const CUSTODY_RULES = [
  "Backup target is never the disk being repaired.",
  "Order of capture: recovery keys → OS state → user work → model manifests → weights. Cheapest and most irreplaceable first.",
  "Write to a .part name, flush, then rename. The rename is the only commit point a power cut respects.",
  "A copy is not a backup until its hash matches the source and the manifest is written.",
  "Keep the previous generation until the new one verifies. Never overwrite the last known-good.",
  "Hot files get quiesced or exported, never file-copied: registry hives, VM disks, open databases, Docker volumes.",
  "Machine-bound and identity-bound data is exported, never copied around: BitLocker, TPM, SSH and GPG keys, licences.",
  "Same volume and immutable? Hardlink. Never store a 20 GB weight twice.",
  "Excluded always: pagefile.sys, hiberfil.sys, swapfile.sys, temp, WinSxS, node_modules.",
  "Long copies use restartable tools with low retry counts so an outage costs minutes, not the run.",
  "Nothing gets flashed, cleaned, or reinstalled until Stage 5 verification has passed.",
];

/** Power-event recovery: what to check before resuming work. */
export const POWER_LOSS_RECOVERY = [
  { step: "Do not resume the interrupted job yet.", detail: "Resuming a half-written copy over a good file is how one outage becomes real data loss." },
  { step: "Look for orphaned .part files in the backup root.", detail: "Their presence means the copy never committed — the source is still the truth. Delete them and re-run." },
  { step: "Check the filesystem before writing again.", detail: "Windows: chkdsk C: (read-only, no /F yet). Linux: sudo fsck -n. Read-only first — never repair a disk you have not inspected." },
  { step: "Verify the manifest.", detail: "Re-run Stage 5 verification. Any MISMATCH line means that file must be recaptured, not trusted." },
  { step: "Check SMART on every drive that was writing.", detail: "smartctl -a on each disk. Rising reallocated or pending sectors after an outage changes the whole plan." },
  { step: "Only then resume, and log the interruption.", detail: "Record the outage and the verification result in the Evidence Log so later conclusions know which run was clean." },
];

/** Symptoms that mean the OS itself is damaged, and the containment order. */
export const OS_CORRUPTION_LADDER = [
  { level: "1 · Suspect", signs: "Apps crash, updates fail, services will not start.", action: "Capture custody Stages 0–3 FIRST. Then: sfc /verifyonly (read-only, reports without changing anything)." },
  { level: "2 · Confirmed component damage", signs: "sfc reports unrepairable files, or DISM finds the store corrupt.", action: "DISM /Online /Cleanup-Image /ScanHealth, then /RestoreHealth. Needs the component store or install media — never start this with an unverified backup." },
  { level: "3 · Boot damage", signs: "Boots to recovery, INACCESSIBLE_BOOT_DEVICE, missing BCD.", action: "Emergency USB. bootrec /scanos and /rebuildbcd. bcdedit /export backup taken at Stage 1 restores the previous config." },
  { level: "4 · Filesystem damage", signs: "Files vanish, chkdsk reports errors, drive letters swap.", action: "Image the volume before any repair write. Repair on the image, not the only copy. Then chkdsk /F." },
  { level: "5 · Media failure", signs: "SMART pending sectors, NVMe critical warning, drive drops out.", action: "Stop writing. Clone the drive sector-by-sector, then work only from the clone. Repair tools on failing media finish the job the media started." },
];
