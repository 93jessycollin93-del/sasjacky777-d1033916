// Repair playbooks. Factual, step-by-step procedures — written beginner-first,
// with a technician note where the shortcut differs from the safe path.
// Nothing here is simulated; every command is a real command for the named OS.

export type Step = { do: string; why?: string; cmd?: string };

export type Playbook = {
  id: string;
  title: string;
  os: "Windows" | "Ubuntu" | "Hardware" | "Any";
  severity: "emergency" | "repair" | "maintenance";
  symptom: string;
  /** What to rule out before touching anything. */
  firstCheck: string;
  steps: Step[];
  danger?: string[];
};

export const PLAYBOOKS: Playbook[] = [
  {
    id: "terminal-not-accepting-commands",
    title: "Admin terminal stopped accepting commands (after a user switch / agent run)",
    os: "Windows",
    severity: "repair",
    symptom:
      "Win+X admin terminal opens but ignores commands, or commands run as the wrong user, after switching accounts or after an AI agent ran in it.",
    firstCheck:
      "Is the window actually accepting input, or is a previous process still attached and eating stdin? Press Ctrl+C, then Enter twice. If a prompt returns, the shell was busy, not broken.",
    steps: [
      {
        do: "Confirm who the shell thinks you are and whether it is elevated.",
        why: "A user switch leaves a shell running under the old profile, so PATH and per-user installs (like Ollama) resolve to another account's files.",
        cmd: "whoami\nwhoami /groups | findstr /i \"S-1-16-12288\"",
      },
      {
        do: "Close every terminal window, then reopen with Win+X → Terminal (Admin) and re-check whoami.",
        why: "Fresh process = fresh environment. Half of 'the terminal is broken' is a stale environment block.",
      },
      {
        do: "Check whether the command exists for THIS user.",
        why: "Ollama and most agent CLIs install per-user into %LOCALAPPDATA%\\Programs. After a user switch that path no longer exists, so the command silently isn't found.",
        cmd: "where ollama\necho %LOCALAPPDATA%\ndir \"%LOCALAPPDATA%\\Programs\"",
      },
      {
        do: "Prove elevation properly instead of trusting the title bar.",
        why: "A window titled 'Administrator' can still be running a non-elevated child process, and UAC filtering silently strips the admin token from a shell launched by another user's session.",
        cmd: "whoami /priv | findstr /i SeDebugPrivilege\nnet session >nul 2>&1 && echo ELEVATED || echo NOT ELEVATED\npowershell -c \"([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')\"",
      },
      {
        do: "Confirm the account you switched to is actually in the Administrators group.",
        why: "Switching to a second account that is a Standard user makes every admin command fail — often with no message at all inside a script.",
        cmd: "net localgroup Administrators\nwhoami /user",
      },
      {
        do: "Check that UAC and the secondary-logon service are not the thing blocking you.",
        why: "If Secondary Logon (seclogon) is stopped, 'Run as different user' and several agent launchers fail silently after a user switch.",
        cmd: "sc query seclogon\nreg query \"HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\" /v EnableLUA\nreg query \"HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\" /v ConsentPromptBehaviorAdmin",
      },
      {
        do: "Repair the execution policy / profile if PowerShell errors on startup.",
        cmd: "Get-ExecutionPolicy -List\nSet-ExecutionPolicy -Scope CurrentUser RemoteSigned",
      },
      {
        do: "Test with the per-user profiles bypassed. If it works clean, the profile is the fault, not the shell.",
        why: "A profile script left behind by an agent (or a half-written $PROFILE) can swallow input or throw on every command.",
        cmd: "powershell -NoProfile -NoLogo\n:: then, inside it:\n:: Test-Path $PROFILE ; $PROFILE.CurrentUserAllHosts",
      },
      {
        do: "Reset the per-user PowerShell profile — rename, never delete.",
        cmd: "if (Test-Path $PROFILE) { Rename-Item $PROFILE \"$PROFILE.bak\" }\nif (Test-Path $PROFILE.CurrentUserAllHosts) { Rename-Item $PROFILE.CurrentUserAllHosts \"$($PROFILE.CurrentUserAllHosts).bak\" }\n# CMD equivalent: check for an AutoRun hijack\nreg query \"HKCU\\Software\\Microsoft\\Command Processor\" /v AutoRun",
      },
      {
        do: "Reset the Windows Terminal profile if the window itself misbehaves (no echo, no prompt).",
        why: "A corrupted settings.json breaks input handling without any error message.",
        cmd: "wt --version\n:: then rename, do not delete:\nren \"%LOCALAPPDATA%\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json\" settings.bak",
      },
      {
        do: "Repair the per-user environment that the switch broke: PATH entries pointing at the other profile.",
        why: "Per-user PATH entries containing C:\\Users\\<other-user> resolve to nothing under this account, so tools 'disappear'.",
        cmd: "reg query \"HKCU\\Environment\" /v Path\n:: fix one entry without wiping the rest:\nsetx PATH \"%LOCALAPPDATA%\\Programs\\Ollama;%PATH%\"",
      },
      {
        do: "Verify system integrity only if the above all check out.",
        why: "SFC/DISM are for real component-store damage. Running them first wastes 20 minutes on a PATH problem.",
        cmd: "sfc /scannow\nDISM /Online /Cleanup-Image /RestoreHealth",
      },
      {
        do: "Last resort before any reinstall: create a fresh local admin account and run the agent work there.",
        why: "A damaged user profile (NTUSER.DAT) cannot be repaired in place. A new profile proves the OS is fine in two minutes.",
        cmd: "net user jackie-ops * /add\nnet localgroup Administrators jackie-ops /add",
      },
      {
        do: "If commands run but affect the wrong account, stop switching users mid-task. Pick one admin account for all agent work.",
        why: "Agents write config, models and tokens into the profile they started under. Switching users mid-session orphans all of it.",
      },
    ],
    danger: [
      "Do not run random 'fix-my-terminal' registry scripts. They usually break Explorer's context menu next.",
      "Never grant an AI agent an elevated shell it can keep. Give it a normal shell, and elevate one specific command yourself.",
      "Never set EnableLUA to 0 to 'fix' elevation. It disables UAC for the whole machine and breaks Store/packaged apps.",
      "Delete nothing during profile repair — rename. A renamed profile can be put back; a deleted one cannot.",
    ],
  },
  {
    id: "ollama-ratelimit-failover",
    title: "Ollama rate-limited / stalled — keep the assistant alive without losing context",
    os: "Any",
    severity: "repair",
    symptom:
      "The local runner starts returning 429s, 'model is loading', or connection refused, and the assistant stops mid-task.",
    firstCheck:
      "Is it a limit or a resource wall? A 3090 with a model already resident returns instantly; a second concurrent request queues. Check whether one model is loaded and one request is in flight before blaming a limit.",
    steps: [
      {
        do: "Confirm what the runner is actually doing.",
        cmd: "ollama ps\nollama list\ncurl http://127.0.0.1:11434/api/tags",
      },
      {
        do: "Let Jackie fail over automatically instead of restarting anything.",
        why:
          "Jackie's provider cascade now treats Ollama 429 / overload / connection-refused as a failover trigger: context is auto-captured, then the next provider in the chain answers with the same messages. Nothing is lost and you don't retype.",
        cmd: ":: Configure the order once at /providers — Lovable first, then free, then paid.",
      },
      {
        do: "Cap concurrency so it stops happening.",
        why: "Ollama queues per model; parallel agent calls to one 24 GB-resident model is what produces the stall.",
        cmd: "setx OLLAMA_NUM_PARALLEL 1\nsetx OLLAMA_MAX_LOADED_MODELS 1\nsetx OLLAMA_KEEP_ALIVE 30m",
      },
      {
        do: "Match the model to the 3090's 24 GB instead of fighting it.",
        why: "A model that spills into system RAM does not error — it just gets 10× slower, which looks exactly like a rate limit.",
        cmd: "nvidia-smi --query-gpu=memory.used,memory.total --format=csv",
      },
      {
        do: "Keep one cloud provider configured at all times as the failover target.",
        why: "A local-only setup has no fallback by definition. One free cloud key turns an outage into a hiccup.",
      },
    ],
    danger: [
      "Don't restart the runner mid-answer to 'unstick' it — that is what destroys context. Let the failover carry the session, then restart when idle.",
    ],
  },

  {
    id: "agent-context-loss",
    title: "Never lose agent context again (limits, crashes, closed windows)",
    os: "Any",
    severity: "repair",
    symptom:
      "An agent hits a usage limit mid-task, you copy the chat, close the window, open another tool — and the clipboard is gone with it.",
    firstCheck:
      "The clipboard is volatile, single-slot memory. Anything important must land in a file within seconds, or it does not exist.",
    steps: [
      {
        do: "Run every agent session inside a transcript, not a bare window.",
        why: "The transcript survives the crash, the limit and the closed window.",
        cmd: "powershell -NoExit \"Start-Transcript -Path $env:USERPROFILE\\jackie-logs\\session-$(Get-Date -f yyyyMMdd-HHmm).txt\"",
      },
      {
        do: "On Ubuntu, use script or tmux instead.",
        cmd: "mkdir -p ~/jackie-logs && script -f ~/jackie-logs/session-$(date +%F-%H%M).log",
      },
      {
        do: "Enable Windows clipboard history so a copy is not a one-shot.",
        why: "Win+V then keeps the last 25 copies. Pin the important one.",
        cmd: ":: Settings → System → Clipboard → Clipboard history: On",
      },
      {
        do: "Before switching models, paste the context into Jackie's Session Capture (below on this page) instead of the clipboard.",
        why: "It persists on this device, so the handoff to another model survives any window closing.",
      },
      {
        do: "Treat 'limit reached' as expected, not as an emergency: keep one paid, one free and one local model configured so the fallback is one click.",
        why: "Jackie's provider cascade already does this — /providers is where the order lives.",
      },
    ],
    danger: [
      "A shared pool is a shared limit: if one launcher fronts several models, exhausting it kills all of them at once. Call each provider directly so their quotas stay independent.",
    ],
  },
  {
    id: "win-recovery-usb",
    title: "Build the emergency boot USB (Windows 11 + 10 on one stick)",
    os: "Windows",
    severity: "emergency",
    symptom: "Machine will not boot, or you need to repair/reinstall Windows and have no media.",
    firstCheck:
      "Do this BEFORE you need it. Building recovery media requires a working computer — which is exactly what you will not have.",
    steps: [
      {
        do: "Get a 32 GB+ USB 3 stick. It will be erased.",
      },
      {
        do: "Install Ventoy on the stick once.",
        why: "Ventoy lets you drop multiple ISOs onto one stick and pick at boot — Win11, Win10 and Ubuntu together.",
        cmd: ":: https://www.ventoy.net/en/download.html — run Ventoy2Disk.exe, select the USB, Install",
      },
      {
        do: "Download the official ISOs and copy them onto the Ventoy partition.",
        cmd: ":: Windows 11: https://www.microsoft.com/software-download/windows11\n:: Windows 10: https://www.microsoft.com/software-download/windows10ISO\n:: Ubuntu LTS: https://ubuntu.com/download/desktop",
      },
      {
        do: "Verify each ISO's checksum before you trust it.",
        why: "A truncated ISO fails halfway through a recovery, at the worst possible moment.",
        cmd: "certutil -hashfile Win11_24H2.iso SHA256",
      },
      {
        do: "Add the rescue extras to the same stick: Memtest86, a GParted live ISO, and the MSI Z690 BIOS file in its own folder.",
      },
      {
        do: "Boot it once, today, to prove it works: restart, tap Del or F11 for the MSI boot menu, pick the USB.",
        why: "An untested rescue stick is not a rescue stick.",
      },
      {
        do: "Also create a Windows system image to the Crucial 4 TB, and keep the recovery key for BitLocker somewhere off this machine.",
        cmd: ":: Control Panel → Backup and Restore (Windows 7) → Create a system image\nmanage-bde -status",
      },
    ],
    danger: [
      "Jackie cannot host Windows or Ubuntu images — they are multi-GB licensed media, and redistributing Windows media is not legal. Official links + checksums + this recipe is the honest version of that.",
      "Never download 'preactivated' or 'compressed' Windows ISOs. They are the single most common source of rootkits on enthusiast machines.",
    ],
  },
  {
    id: "no-post",
    title: "No POST / no display — MSI Z690 EZ Debug LED decode",
    os: "Hardware",
    severity: "emergency",
    symptom: "Power comes on, fans spin, nothing on screen.",
    firstCheck: "Look at the four EZ Debug LEDs on the board edge. The lit one names the stage that failed. That is your entire diagnosis.",
    steps: [
      { do: "CPU LED lit → power cables. Reseat both EPS 8-pin CPU cables, and check the AIO pump is powered.", why: "A stuck CPU LED is nearly always power delivery or an unseated cooler, not a dead CPU." },
      { do: "DRAM LED lit → memory. Power off, pull all four sticks, boot with ONE stick in slot A2.", why: "128 GB across 4 DIMMs is the hardest config for DDR5 to train. One stick proves the board and CPU are alive." },
      { do: "VGA LED lit → GPU. Reseat the 3090, use separate PCIe cables, try the second x16 slot.", why: "Ampere cards sag; reseating fixes more of these than anything else." },
      { do: "BOOT LED lit → the board is fine and it cannot find an OS. Go to the boot USB playbook.", why: "This is a storage/boot-order problem, not a hardware failure." },
      { do: "Nothing lit and no POST at all → clear CMOS (button on the rear I/O), then retry with one stick and no extra drives.", why: "A failed XMP or RAID-mode change leaves the board unable to train. CMOS clear undoes it." },
      { do: "Still dead → use the MSI Flash BIOS Button to write a fresh BIOS with no CPU or RAM installed.", cmd: ":: rename the BIOS file to MSI.ROM, put it in the USB root, plug into the FLASH BIOS port, hold the button" },
    ],
    danger: ["Do not remove or reseat anything with the PSU switch on. Switch off, hold the case power button 10 s, then work."],
  },
  {
    id: "raid-symbiosis",
    title: "RAID plan review — mixed NVMe / SSD / HDD",
    os: "Any",
    severity: "maintenance",
    symptom: "You want the 8 TB NVMe pool + 4 TB SSD + 2 TB HDD working as one system.",
    firstCheck: "Decide what you are buying: speed, capacity, or survival. One array cannot buy all three, and none of them is a backup.",
    steps: [
      { do: "Keep the four 980 PRO in their own tier. Stripe them only if you can rebuild the contents from elsewhere.", why: "RAID0 across 4 drives makes you 4× more likely to lose everything." },
      { do: "Use the Crucial 4 TB SATA as the local image target — system images, VM snapshots, agent transcripts." },
      { do: "Use the Seagate 2 TB as the cold copy. Spin it up weekly, then leave it alone.", why: "A disk that is not always mounted survives ransomware and accidental deletes." },
      { do: "On Windows, prefer Storage Spaces or plain drives over Intel RST unless you specifically need boot-level RAID.", why: "RST arrays are bound to this board model — a dead Z690 can mean unreadable data." },
      { do: "On Ubuntu, use mdadm (simple) or ZFS (checksums + snapshots, needs RAM — you have 128 GB, so ZFS is genuinely viable here)." },
      { do: "Whatever you build, run one restore test. An untested backup is a rumor." },
    ],
    danger: ["Creating an array erases its members. Full image out first, verified, before you touch array config."],
  },
  {
    id: "ubuntu-rescue",
    title: "Ubuntu will not boot — rescue sequence",
    os: "Ubuntu",
    severity: "emergency",
    symptom: "GRUB missing, kernel panic, or drops to initramfs.",
    firstCheck: "Does it reach GRUB? If yes, the bootloader is fine and the problem is the kernel or the root filesystem.",
    steps: [
      { do: "At GRUB, pick Advanced options → an older kernel.", why: "A failed kernel/NVIDIA update is the most common cause; the previous kernel boots and gives you a working system to fix from." },
      { do: "If it drops to initramfs, check the root filesystem.", cmd: "fsck -f /dev/nvme0n1p2" },
      { do: "If GRUB is gone entirely, boot the Ubuntu live USB and reinstall it.", cmd: "sudo mount /dev/nvme0n1p2 /mnt\nsudo mount /dev/nvme0n1p1 /mnt/boot/efi\nfor d in dev proc sys run; do sudo mount --bind /$d /mnt/$d; done\nsudo chroot /mnt\ngrub-install /dev/nvme0n1 && update-grub" },
      { do: "Black screen after login on the 3090 → boot with nomodeset, then reinstall the driver.", cmd: "sudo ubuntu-drivers install\n# or a specific branch:\nsudo apt install nvidia-driver-550" },
      { do: "If an mdadm array is degraded, check before rebuilding.", cmd: "cat /proc/mdstat\nsudo mdadm --detail /dev/md0" },
    ],
  },
  {
    id: "monthly-maintenance",
    title: "Monthly maintenance pass (30 minutes)",
    os: "Any",
    severity: "maintenance",
    symptom: "Preventing the emergencies above.",
    firstCheck: "Log the numbers each time. A trend tells you things a single reading never will.",
    steps: [
      { do: "Log AIO pump RPM, CPU package temp under load, GPU core + memory-junction temp.", why: "Pump RPM drifting down is a cooler dying months before it fails." },
      { do: "Check SMART / health on all seven drives and record the NVMe firmware versions in the Firmware Log on this page.", cmd: "wmic diskdrive get model,status\n# Ubuntu:\nsudo smartctl -a /dev/nvme0n1" },
      { do: "Verify the rescue USB still boots, and that the system image is newer than a month." },
      { do: "Review pending BIOS / driver updates in the Firmware Log — read the changelog, do not flash reflexively.", why: "A BIOS update with nothing you need is pure risk." },
      { do: "Blow out the radiator and intake filters. Dust is the silent thermal tax." },
    ],
  },
];

export const FLASH_RULES = [
  "Read the changelog first. If it does not fix a problem you actually have, do not flash.",
  "Never flash BIOS, SSD or VBIOS firmware on battery, on a bad UPS, or during a storm. Power loss mid-flash bricks the part.",
  "Download only from the manufacturer's own support page for your exact model. No mirrors, no forum reuploads.",
  "One flash at a time, reboot, verify, use the machine for a day. Never stack BIOS + GPU + SSD firmware in one session.",
  "Write down the current version before flashing, so you know what you are rolling back to.",
  "BIOS updates reset XMP, RAID mode and boot order. Photograph those screens first.",
  "AI-suggested version numbers are a starting point for a search, never the authority. Confirm on the vendor page before you flash anything.",
];
