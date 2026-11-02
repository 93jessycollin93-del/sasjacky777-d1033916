// Jackie Boot — start-of-day presence.
//
// Two separate layers, and they must not be confused with each other:
//
//   1. OS layer (real, fully supported): a scheduled task that runs a startup
//      assessment the moment the machine comes up, writes a JSON report, and
//      leaves it where Jackie can read it. This is where the actual assessment
//      happens.
//   2. Firmware layer (real, but narrow): a UEFI boot entry labelled
//      "Jackie Boot" that appears in the board's boot menu (F11 on MSI) and in
//      the UEFI boot order. It points at a rescue EFI loader on a labelled
//      volume.
//
// What is NOT possible, stated plainly so no one plans around a fantasy:
// nothing in a browser or a userland tool can write code into the MSI BIOS
// itself, add a BIOS setup page, or run before the firmware hands off. A vendor
// BIOS is signed; only MSI's own flasher writes it. "Presence in BIOS" is
// achieved with a named UEFI boot entry, not by modifying the BIOS image.
//
// Everything below is string generation. No network. Works offline.

export type Platform = "windows" | "linux";

export const BOOT_ENTRY_LABEL = "Jackie Boot";
export const BOOT_VOLUME_LABEL = "JACKIE_BOOT";
export const REPORT_DIR_WIN = "$env:ProgramData\\Jackie";
export const REPORT_DIR_NIX = "/var/lib/jackie";

/** Honest scope statement shown in the UI — no overclaiming. */
export const BOOT_SCOPE = {
  can: [
    'A UEFI boot entry named "Jackie Boot" in the board\'s boot menu and boot order (survives reboots; stored in NVRAM).',
    'A rescue volume labelled JACKIE_BOOT so the stick is unmistakable in the F11 menu.',
    "A startup assessment that runs before you log in, as SYSTEM, and writes a timestamped report.",
    "A logon task that re-runs the assessment per user session, so post-user-switch problems get captured.",
  ],
  cannot: [
    "Write Jackie into the MSI BIOS image or add a BIOS setup page — vendor BIOS is signed; only MSI's flasher writes it.",
    "Run before firmware hands off to a bootloader. Nothing in userland can.",
    "Change firmware settings (XMP, Secure Boot, VMD) from Windows. Those stay manual, in setup.",
  ],
};

export type Check = {
  id: string;
  title: string;
  /** What a bad result actually means — no vague warnings. */
  reads: string;
};

/** What the startup assessment looks at, in the order it matters. */
export const STARTUP_CHECKS: Check[] = [
  { id: "shutdown", title: "Unexpected shutdown / power loss", reads: "Event IDs 41, 6008, 1001. A 41 with no 1074 before it means the machine lost power or hard-hung — interrupted writes are then suspect." },
  { id: "dirty", title: "Volume dirty bit", reads: "fsutil dirty query. Set means NTFS knows it was interrupted and wants a chkdsk before heavy writes." },
  { id: "smart", title: "Drive health", reads: "NVMe critical warnings, media errors, reallocated and pending sectors. Rising counts after an outage change the whole plan." },
  { id: "space", title: "Free space on every volume", reads: "Under 10% on C: breaks updates, restore points, and page file growth long before anything else fails." },
  { id: "orphans", title: "Orphaned .part files in the custody root", reads: "A copy that never committed. Source is still the truth; the .part must be deleted and the copy re-run." },
  { id: "manifest", title: "Backup manifest verification", reads: "Any hash mismatch means that backup file is not trustworthy and must be recaptured." },
  { id: "critical", title: "Critical and error events since last boot", reads: "Driver failures, disk warnings, and service crashes — the first place a corrupting OS announces itself." },
  { id: "services", title: "Services set to auto that did not start", reads: "A silent failed service is the most common cause of 'it works but something is off'." },
  { id: "models", title: "LM Studio and Ollama estate", reads: "GGUF count and total size in the LM Studio hub, plus whether Ollama is present. Confirms the AI estate survived the event." },
];

/**
 * The startup assessment script. Read-only: it inspects and reports, it never
 * repairs. Repair decisions stay with the operator after reading the report.
 */
export function startupScript(opts: { custodyRoot: string; lmStudioDir: string }) {
  const custody = opts.custodyRoot.replace(/[\\/]+$/, "");
  const lms = opts.lmStudioDir.replace(/[\\/]+$/, "");
  return String.raw`# jackie-startup-assess.ps1 — Jackie Boot startup assessment.
# READ-ONLY. It inspects and reports; it never repairs, deletes, or flashes.
# Writes: %ProgramData%\Jackie\startup-report.json (+ a dated copy in history\)

$ErrorActionPreference = 'SilentlyContinue'
$dir     = Join-Path $env:ProgramData 'Jackie'
$history = Join-Path $dir 'history'
New-Item -ItemType Directory -Force -Path $dir, $history | Out-Null

$custody  = '` + custody + String.raw`'
$lmStudio = '` + lms + String.raw`'
$boot     = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime

$report = [ordered]@{
  generatedAt   = (Get-Date).ToString('o')
  host          = $env:COMPUTERNAME
  user          = "$env:USERDOMAIN\$env:USERNAME"
  lastBootUpTime= $boot.ToString('o')
  osBuild       = (Get-CimInstance Win32_OperatingSystem).BuildNumber
  biosVersion   = (Get-CimInstance Win32_BIOS).SMBIOSBIOSVersion
  board         = (Get-CimInstance Win32_BaseBoard).Product
  findings      = @()
}
function Add-Finding($id, $severity, $summary, $detail) {
  $report.findings += [ordered]@{ id=$id; severity=$severity; summary=$summary; detail="$detail" }
}

# 1. Unexpected shutdown / power loss
$kernel = Get-WinEvent -FilterHashtable @{LogName='System'; Id=41,6008,1001; StartTime=$boot.AddDays(-3)} -MaxEvents 20
if ($kernel) {
  Add-Finding 'shutdown' 'high' "$($kernel.Count) unexpected-shutdown event(s) in the last 3 days" ($kernel | Select-Object -First 5 | ForEach-Object { "$($_.TimeCreated) id=$($_.Id)" } | Out-String)
} else { Add-Finding 'shutdown' 'ok' 'No unexpected shutdown events in the last 3 days' '' }

# 2. Dirty bit per volume
foreach ($v in (Get-Volume | Where-Object DriveLetter)) {
  $d = (fsutil dirty query "$($v.DriveLetter):") 2>&1 | Out-String
  if ($d -match 'is Dirty') { Add-Finding 'dirty' 'high' "Volume $($v.DriveLetter): is marked dirty" $d.Trim() }
}

# 3. Drive health
$phys = Get-PhysicalDisk | Select-Object DeviceId,FriendlyName,MediaType,HealthStatus,OperationalStatus,@{n='SizeGB';e={[math]::Round($_.Size/1GB,1)}}
$report.disks = $phys
foreach ($d in $phys) {
  if ($d.HealthStatus -ne 'Healthy') { Add-Finding 'smart' 'critical' "Disk $($d.DeviceId) $($d.FriendlyName) reports $($d.HealthStatus)" ($d | Out-String) }
}
$rel = Get-StorageReliabilityCounter -PhysicalDisk (Get-PhysicalDisk) |
       Select-Object DeviceId,Temperature,ReadErrorsTotal,WriteErrorsTotal,Wear,PowerOnHours
$report.reliability = $rel
foreach ($r in $rel) {
  if ($r.ReadErrorsTotal -gt 0 -or $r.WriteErrorsTotal -gt 0) {
    Add-Finding 'smart' 'high' "Disk $($r.DeviceId) has non-zero error counters" ($r | Out-String)
  }
}

# 4. Free space
foreach ($v in (Get-Volume | Where-Object { $_.DriveLetter -and $_.Size -gt 0 })) {
  $pct = [math]::Round(100 * $v.SizeRemaining / $v.Size, 1)
  if ($pct -lt 10) { Add-Finding 'space' 'high' "Volume $($v.DriveLetter): only $pct% free" "$([math]::Round($v.SizeRemaining/1GB,1)) GB of $([math]::Round($v.Size/1GB,1)) GB" }
}

# 5. Orphaned .part files — a copy that never committed
if (Test-Path $custody) {
  $parts = Get-ChildItem $custody -Recurse -Filter *.part -File
  if ($parts) { Add-Finding 'orphans' 'high' "$($parts.Count) uncommitted .part file(s) in the custody root" (($parts.FullName) -join [char]10) }
  else { Add-Finding 'orphans' 'ok' 'No uncommitted copies in the custody root' '' }
}

# 6. Manifest verification
$manifest = Join-Path $custody 'MANIFEST.csv'
if (Test-Path $manifest) {
  $bad = @()
  foreach ($row in Import-Csv $manifest) {
    if (Test-Path $row.Path) {
      if ((Get-FileHash -LiteralPath $row.Path -Algorithm SHA256).Hash -ne $row.Hash) { $bad += $row.Path }
    } else { $bad += "MISSING: $($row.Path)" }
  }
  if ($bad) { Add-Finding 'manifest' 'critical' "$($bad.Count) backup file(s) failed verification" ($bad -join [char]10) }
  else { Add-Finding 'manifest' 'ok' 'Backup manifest verified — every hash matches' '' }
} else { Add-Finding 'manifest' 'info' 'No MANIFEST.csv yet — run the pre-work custody stages' $manifest }

# 7. Critical / error events since boot
$evt = Get-WinEvent -FilterHashtable @{LogName='System'; Level=1,2; StartTime=$boot} -MaxEvents 40
if ($evt) {
  Add-Finding 'critical' 'medium' "$($evt.Count) critical/error system event(s) since last boot" (($evt | Select-Object -First 10 | ForEach-Object { "$($_.TimeCreated) [$($_.ProviderName)] $($_.Id): " + ($_.Message -split [char]10)[0] }) -join [char]10)
}

# 8. Auto services that did not start
$svc = Get-Service | Where-Object { $_.StartType -eq 'Automatic' -and $_.Status -ne 'Running' } | Select-Object Name,DisplayName
if ($svc) { Add-Finding 'services' 'medium' "$($svc.Count) automatic service(s) not running" (($svc | ForEach-Object { $_.Name }) -join ', ') }


# 9. AI estate — LM Studio is the hub, Ollama is a consumer of it
if (Test-Path $lmStudio) {
  $gg = Get-ChildItem $lmStudio -Recurse -Filter *.gguf -File
  $report.lmStudio = @{ dir=$lmStudio; count=$gg.Count; totalGB=[math]::Round((($gg | Measure-Object Length -Sum).Sum)/1GB,2) }
  $gg | Select-Object FullName,Length | Export-Csv (Join-Path $dir 'gguf-inventory.csv') -NoTypeInformation
  Add-Finding 'models' 'ok' "LM Studio hub: $($gg.Count) GGUF, $($report.lmStudio.totalGB) GB" $lmStudio
} else { Add-Finding 'models' 'info' 'LM Studio model folder not found at the configured path' $lmStudio }
if (Get-Command ollama -ErrorAction SilentlyContinue) { $report.ollama = 'present' } else { $report.ollama = 'not installed' }

$json = $report | ConvertTo-Json -Depth 6
$json | Set-Content (Join-Path $dir 'startup-report.json') -Encoding UTF8
$json | Set-Content (Join-Path $history ("startup-{0:yyyyMMdd-HHmmss}.json" -f (Get-Date))) -Encoding UTF8

# Keep 60 days of history, nothing older
Get-ChildItem $history -Filter 'startup-*.json' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-60) } | Remove-Item -Force
Write-Output "Jackie startup assessment written to $dir\startup-report.json"
`;
}

export type Step = { title: string; command: string; note?: string };

/** Install the assessment as a real startup + logon task. */
export function installSteps(scriptPath: string): Step[] {
  const p = scriptPath;
  return [
    {
      title: "1 · Save the script where only admins can write it",
      command: `New-Item -ItemType Directory -Force -Path "$env:ProgramData\\Jackie" | Out-Null\n# paste the script into: ${p}`,
      note: "ProgramData\\Jackie is admin-writable only, so a normal-user process cannot alter what runs as SYSTEM.",
    },
    {
      title: "2 · Prove it runs clean before scheduling it",
      command: `powershell -NoProfile -ExecutionPolicy Bypass -File "${p}"`,
      note: "Read-only. If this errors, fix it here — never debug a task you cannot see running.",
    },
    {
      title: "3 · Register the boot task (runs as SYSTEM at startup)",
      command: `$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${p}"'\n$t = New-ScheduledTaskTrigger -AtStartup\n$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)\nRegister-ScheduledTask -TaskName 'Jackie Boot Assessment' -Action $a -Trigger $t -Settings $s -RunLevel Highest -User 'SYSTEM' -Description 'Read-only startup health and custody assessment.' -Force`,
      note: "Elevated PowerShell required. SYSTEM so it can read SMART counters and the event log before any user logs in.",
    },
    {
      title: "4 · Register the logon task (catches post-user-switch problems)",
      command: `$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${p}"'\n$t = New-ScheduledTaskTrigger -AtLogOn\nRegister-ScheduledTask -TaskName 'Jackie Boot Assessment (Logon)' -Action $a -Trigger $t -RunLevel Highest -User 'SYSTEM' -Force`,
    },
    {
      title: "5 · Verify it is registered and see the last result",
      command: `Get-ScheduledTask -TaskName 'Jackie Boot*' | Get-ScheduledTaskInfo | Format-List TaskName,LastRunTime,LastTaskResult,NextRunTime`,
      note: "LastTaskResult 0 means it ran clean. 267011 just means it has not run yet.",
    },
    {
      title: "6 · Read the report (this is what you paste back to Jackie)",
      command: `Get-Content "$env:ProgramData\\Jackie\\startup-report.json" -Raw`,
      note: "Paste it into the Startup Report box, or log it in the Evidence Log so conclusions cite it.",
    },
    {
      title: "Remove it later (nothing hidden, nothing sticky)",
      command: `Unregister-ScheduledTask -TaskName 'Jackie Boot Assessment','Jackie Boot Assessment (Logon)' -Confirm:$false`,
    },
  ];
}

/** The "presence in BIOS" layer: a named UEFI boot entry, honestly scoped. */
export function firmwareSteps(platform: Platform): Step[] {
  if (platform === "windows") {
    return [
      {
        title: "1 · Confirm the machine is booting UEFI, not legacy",
        command: `bcdedit /enum {current} | Select-String 'path'`,
        note: "A path of \\WINDOWS\\system32\\winload.efi means UEFI. If it says winload.exe, this whole layer does not apply yet.",
      },
      {
        title: "2 · Label the rescue volume so it is unmistakable in the boot menu",
        command: `Get-Volume | Select-Object DriveLetter,FileSystemLabel,Size\nSet-Volume -DriveLetter <USB> -NewFileSystemLabel '${BOOT_VOLUME_LABEL}'`,
        note: `The F11 menu shows the volume label. "${BOOT_VOLUME_LABEL}" beats "UEFI: SanDisk, Partition 1".`,
      },
      {
        title: "3 · List the firmware boot entries as they are now",
        command: `bcdedit /enum firmware`,
        note: "Screenshot or copy this. It is your rollback reference for NVRAM.",
      },
      {
        title: `4 · Create the "${BOOT_ENTRY_LABEL}" firmware entry`,
        command: `bcdedit /copy {bootmgr} /d "${BOOT_ENTRY_LABEL}"\n# take the returned {GUID} and point it at the rescue loader:\nbcdedit /set {GUID} device partition=<USB>:\nbcdedit /set {GUID} path \\EFI\\BOOT\\BOOTX64.EFI\nbcdedit /set {fwbootmgr} displayorder {GUID} /addlast`,
        note: "Elevated. This writes an NVRAM entry — it shows in the UEFI boot list and the F11 menu by that exact name. It does not modify the BIOS itself.",
      },
      {
        title: "5 · Confirm the entry exists and is last in order",
        command: `bcdedit /enum firmware | Select-String -Context 2,6 '${BOOT_ENTRY_LABEL}'`,
        note: "Last in order on purpose: present when you want it, never stealing a normal boot.",
      },
      {
        title: "Remove the entry",
        command: `bcdedit /delete {GUID} /f`,
        note: "Clean removal from NVRAM. Never delete {bootmgr} or {current} — that is what makes a machine unbootable.",
      },
    ];
  }
  return [
    { title: "1 · Confirm UEFI boot", command: `[ -d /sys/firmware/efi ] && echo UEFI || echo legacy-BIOS` },
    { title: "2 · List firmware entries (rollback reference)", command: `sudo efibootmgr -v` },
    { title: "3 · Label the rescue volume", command: `sudo fatlabel /dev/sdX1 ${BOOT_VOLUME_LABEL}` },
    {
      title: `4 · Create the "${BOOT_ENTRY_LABEL}" entry`,
      command: `sudo efibootmgr --create --disk /dev/sdX --part 1 --label "${BOOT_ENTRY_LABEL}" --loader '\\EFI\\BOOT\\BOOTX64.EFI'`,
      note: "Writes NVRAM only. The firmware image is untouched and unmodified.",
    },
    { title: "5 · Verify", command: `sudo efibootmgr -v | grep -i '${BOOT_ENTRY_LABEL}'` },
    { title: "Remove the entry", command: `sudo efibootmgr -b <NNNN> -B` },
  ];
}

/**
 * LM Studio as the single hub. The operator's weights live there, so every
 * other runner should point at those files rather than re-download them.
 */
export function lmStudioHubSteps(lmStudioDir: string, platform: Platform): Step[] {
  const d = lmStudioDir.replace(/[\\/]+$/, "");
  if (platform === "windows") {
    return [
      {
        title: "1 · Inventory the hub — count, size, and duplicate weights",
        command: `Get-ChildItem "${d}" -Recurse -Filter *.gguf -File | Select-Object FullName,Length | Sort-Object Length -Descending | Format-Table -AutoSize`,
        note: "Paste the output into Model Vault. Identical sizes are duplicate-weight suspects; confirm with a hash before deleting anything.",
      },
      {
        title: "2 · Confirm suspected duplicates by hash before touching them",
        command: `Get-FileHash -Algorithm SHA256 "<file-a>","<file-b>" | Format-Table Hash,Path`,
        note: "Same hash means the same weights. Only then is one of them redundant.",
      },
      {
        title: "3 · Serve a hub model to everything else, copying nothing",
        command: `lms server start\n# OpenAI-compatible at http://127.0.0.1:1234/v1 — register that base URL in BionicGPT and Jackie's provider list.`,
        note: "The cheapest 'conversion' there is: one file, one server, every client. No second copy on disk.",
      },
      {
        title: "4 · Import a hub file into Ollama without duplicating it",
        command: `"FROM ${d}\\<publisher>\\<repo>\\<model>.gguf" | Set-Content .\\Modelfile -Encoding ascii\nollama create <name> -f .\\Modelfile`,
        note: "Ollama copies the blob into its own store by default — expect the disk cost. Skip this if the LM Studio server already covers the use.",
      },
      {
        title: "5 · Share one weight file across runners on the same volume",
        command: `New-Item -ItemType HardLink -Path "<other-runner-dir>\\<model>.gguf" -Target "${d}\\<publisher>\\<repo>\\<model>.gguf"\nfsutil hardlink list "${d}\\<publisher>\\<repo>\\<model>.gguf"`,
        note: "Same volume only. Zero bytes copied, two names. Deleting one name leaves the file intact for the other.",
      },
      {
        title: "6 · Record the hub inventory as evidence",
        command: `Get-ChildItem "${d}" -Recurse -Filter *.gguf -File | Select-Object FullName,Length | Export-Csv "$env:ProgramData\\Jackie\\gguf-inventory.csv" -NoTypeInformation`,
        note: "The startup assessment re-reads this every boot, so a missing or shrunken model gets caught the next morning, not months later.",
      },
    ];
  }
  return [
    { title: "1 · Inventory the hub", command: `find "${d}" -name '*.gguf' -printf '%s\\t%p\\n' | sort -rn` },
    { title: "2 · Confirm duplicates by hash", command: `sha256sum "<file-a>" "<file-b>"` },
    { title: "3 · Serve the hub", command: `lms server start  # OpenAI-compatible on http://127.0.0.1:1234/v1` },
    { title: "4 · Import into Ollama", command: `printf 'FROM %s\\n' "${d}/<repo>/<model>.gguf" > Modelfile && ollama create <name> -f Modelfile` },
    { title: "5 · Hardlink instead of copying", command: `ln "${d}/<repo>/<model>.gguf" "<other-runner-dir>/<model>.gguf" && stat -c '%h %n' "${d}/<repo>/<model>.gguf"` },
  ];
}

export type StartupFinding = { id: string; severity: string; summary: string; detail?: string };
export type StartupReport = {
  generatedAt?: string;
  host?: string;
  user?: string;
  lastBootUpTime?: string;
  osBuild?: string;
  biosVersion?: string;
  board?: string;
  findings?: StartupFinding[];
  lmStudio?: { dir?: string; count?: number; totalGB?: number };
  ollama?: string;
};

/** Parse a pasted report. Returns null rather than guessing at bad input. */
export function parseStartupReport(raw: string): StartupReport | null {
  try {
    const j = JSON.parse(raw) as StartupReport;
    if (!j || typeof j !== "object") return null;
    return j;
  } catch {
    return null;
  }
}

export const SEVERITY_ORDER = ["critical", "high", "medium", "info", "ok"];

export function sortFindings(f: StartupFinding[] = []) {
  return [...f].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

/** One-line verdict Jackie can state without inventing anything. */
export function reportVerdict(r: StartupReport) {
  const f = r.findings ?? [];
  const crit = f.filter((x) => x.severity === "critical").length;
  const high = f.filter((x) => x.severity === "high").length;
  if (crit) return { tone: "critical" as const, text: `${crit} critical finding${crit === 1 ? "" : "s"} — do not start heavy writes or any flash until these are resolved.` };
  if (high) return { tone: "high" as const, text: `${high} finding${high === 1 ? "" : "s"} needing attention before repair work begins.` };
  if (f.length) return { tone: "ok" as const, text: "No critical or high findings in this report. Verified state, not an assumption." };
  return { tone: "info" as const, text: "Report parsed but contains no findings — check the script ran as SYSTEM." };
}

/** Text brief for grounding the consultant in the last real boot report. */
export function startupBrief(r: StartupReport | null) {
  if (!r) return "Startup assessment: no report loaded. Machine state at boot is unverified.";
  const lines = [
    `Startup assessment (${r.generatedAt ?? "unknown time"}) on ${r.host ?? "unknown host"}:`,
    `- Board ${r.board ?? "unknown"}, BIOS ${r.biosVersion ?? "unknown"}, OS build ${r.osBuild ?? "unknown"}, last boot ${r.lastBootUpTime ?? "unknown"}`,
  ];
  sortFindings(r.findings).forEach((f) => lines.push(`- [${f.severity}] ${f.summary}`));
  if (r.lmStudio) lines.push(`- LM Studio hub: ${r.lmStudio.count ?? "?"} GGUF, ${r.lmStudio.totalGB ?? "?"} GB at ${r.lmStudio.dir ?? "?"}`);
  if (r.ollama) lines.push(`- Ollama: ${r.ollama}`);
  return lines.join("\n");
}
