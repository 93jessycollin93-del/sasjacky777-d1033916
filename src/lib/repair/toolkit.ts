// Local AI runners, long-context models, and Windows repair/update managers.
// Reference data only — nothing here is auto-installed. Commands are real commands.
// Claims are checked against this rig (i9-12900K, 128GB DDR5, RTX 3090 = 24GB VRAM);
// where a popular claim does not survive that check, the note says so plainly.

export type ToolEntry = {
  id: string;
  name: string;
  what: string;
  /** Install / launch commands, as typed in Windows Terminal (Admin). */
  cmds?: string[];
  url?: string;
  /** Honest fit note for a 3090 + 128GB box. */
  fit?: string;
  /** Real caveat. Empty means there isn't one worth flagging. */
  caution?: string;
  cost: "free" | "paid" | "free-tier";
};

export type ToolGroup = {
  id: string;
  title: string;
  intro: string;
  tools: ToolEntry[];
};

export const TOOLKIT: ToolGroup[] = [
  {
    id: "runners",
    title: "Local AI runners (offline, Windows 11)",
    intro:
      "These run models on your own hardware. No account, no rate limit, no shared pool — the only ceiling is 24GB of VRAM plus system RAM spillover.",
    tools: [
      {
        id: "ollama",
        name: "Ollama",
        what:
          "The workhorse. One command pulls and serves a model, and it exposes an OpenAI-compatible API on 127.0.0.1:11434 that Jackie's Ollama provider can consume directly.",
        cmds: [
          "winget install Ollama.Ollama",
          "ollama pull qwen2.5:14b-instruct-q4_K_M",
          "ollama run qwen2.5:14b-instruct-q4_K_M",
          ":: raise context for one session (VRAM cost is real)\nsetx OLLAMA_CONTEXT_LENGTH 32768",
          ":: keep models on a big drive, not C:\nsetx OLLAMA_MODELS D:\\ollama-models",
        ],
        url: "https://ollama.com/library",
        fit:
          "Best default. 14B at q4 fits VRAM with room for long context; 32B at q4 fits but context shrinks; 70B will spill into system RAM and slow to a crawl.",
        caution:
          "There is no such command as `ollama launch hermes` or `ollama launch claude`. Ollama only runs local models — it never proxies Claude or any hosted API, and it has no usage quota to exhaust. If a session reported 'limit used up', that came from a hosted agent CLI running inside the terminal, not from Ollama.",
        cost: "free",
      },
      {
        id: "lmstudio",
        name: "LM Studio",
        what:
          "GUI runner with a model browser, side-by-side comparison, and a local server mode that speaks the OpenAI API. Easiest way to test a model before committing it to a workflow.",
        cmds: ["winget install ElementLabs.LMStudio"],
        url: "https://lmstudio.ai",
        fit: "Good for judging quality and tokens/sec per quant level before wiring a model into Jackie.",
        caution:
          "Its marketplace sells nothing that turns a hosted model into a local one — GPT-4o class models are not downloadable. Anything labelled that way is mislabelled.",
        cost: "free",
      },
      {
        id: "koboldcpp",
        name: "KoboldCpp",
        what:
          "Single-executable llama.cpp front end. Fine-grained control over context length, GPU layer offload, and KV cache quantisation — the right tool when you want to push context to the limit.",
        cmds: [
          ":: download koboldcpp.exe, then:",
          "koboldcpp.exe --model model.gguf --contextsize 65536 --gpulayers 999 --quantkv 1",
        ],
        url: "https://github.com/LostRuins/koboldcpp",
        fit:
          "Highest usable context on this box, because it can quantise the KV cache and offload precisely. Expect ~64k–128k tokens on a 7B–14B q4 model before RAM becomes the bottleneck.",
        caution:
          "'Up to 2M tokens' is not reachable here. KV cache scales linearly with context: a 1M-token window on even a small model needs hundreds of GB. Treat 128k as the honest local ceiling on 24GB VRAM + 128GB RAM.",
        cost: "free",
      },
      {
        id: "llamacpp",
        name: "llama.cpp (llama-server)",
        what:
          "The engine underneath most runners. Worth having directly for scripted benchmarks and for flags the wrappers do not expose.",
        cmds: ["winget install ggml.llamacpp", "llama-server -m model.gguf -c 32768 -ngl 999"],
        url: "https://github.com/ggml-org/llama.cpp",
        fit: "Use when you want a reproducible tokens/sec number rather than a vibe.",
        cost: "free",
      },
      {
        id: "gpt4all",
        name: "GPT4All",
        what: "Light desktop app plus CLI/Python bindings. Handy for small scripted jobs and local document Q&A.",
        cmds: ["winget install Nomic.GPT4All"],
        url: "https://www.nomic.ai/gpt4all",
        fit: "Underuses a 3090 — reach for it for automation convenience, not for speed.",
        cost: "free",
      },
      {
        id: "jan",
        name: "Jan",
        what: "Open-source local desktop assistant with a built-in OpenAI-compatible server. Offline by default.",
        cmds: ["winget install Jan.Jan"],
        url: "https://jan.ai",
        fit: "Clean UI if you want a chat app that is not a terminal.",
        caution: "It is a desktop app, not a browser-only tool; the model still runs on your machine.",
        cost: "free",
      },
      {
        id: "vllm-wsl",
        name: "vLLM (under WSL2)",
        what:
          "Serving engine with continuous batching — the fastest way to run one model against many parallel requests, which is what a router or agent fleet actually does.",
        cmds: ["wsl --install", ":: inside Ubuntu:\npip install vllm", "vllm serve Qwen/Qwen2.5-7B-Instruct --max-model-len 32768"],
        url: "https://docs.vllm.ai",
        fit: "Right choice once several agents hit one local model at the same time. Needs WSL2 + CUDA; not a five-minute setup.",
        cost: "free",
      },
    ],
  },
  {
    id: "longcontext",
    title: "Long-context models — what is actually reachable",
    intro:
      "A model's advertised window is what the weights support, not what your GPU can hold. These are ordered by what this rig can really serve.",
    tools: [
      {
        id: "qwen25",
        name: "Qwen2.5-Instruct (7B / 14B / 32B)",
        what:
          "Strong general and coding model, native 128k context on the instruct builds. The best long-context/quality trade-off you can run locally today.",
        cmds: ["ollama pull qwen2.5:14b-instruct-q4_K_M"],
        url: "https://ollama.com/library/qwen2.5",
        fit: "14B q4 with 32k–64k context is the sweet spot on a 3090.",
        cost: "free",
      },
      {
        id: "qwen1m",
        name: "Qwen2.5-1M (7B / 14B)",
        what: "The 1M-token research variant. The window is genuine at the weights level.",
        url: "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-1M",
        fit:
          "Runnable — but not at 1M. Qwen's own guidance for the full window is multiple 80GB GPUs. On one 3090 you get roughly the same practical window as standard Qwen2.5, so pick it only if you specifically want the long-context tuning.",
        caution: "Anyone promising a 1M-token local session on 24GB VRAM is describing hardware they do not have.",
        cost: "free",
      },
      {
        id: "deepseek-r1-distill",
        name: "DeepSeek-R1-Distill-Qwen (7B / 14B / 32B)",
        what: "Reasoning-distilled models that show their working. Good for router design and multi-step debugging.",
        cmds: ["ollama pull deepseek-r1:14b"],
        url: "https://ollama.com/library/deepseek-r1",
        fit: "Budget extra tokens — reasoning output is long, so the context fills faster than you expect.",
        caution: "These distills carry Qwen's 128k window, not a 1M window. There is no 1M distill.",
        cost: "free",
      },
      {
        id: "llama31",
        name: "Llama 3.1 8B Instruct",
        what: "128k context, very fast at q4, excellent tool-calling. A good default worker for fleet jobs.",
        cmds: ["ollama pull llama3.1:8b"],
        url: "https://ollama.com/library/llama3.1",
        fit: "Highest tokens/sec of the useful models here. Ideal for the many-small-jobs half of a router.",
        cost: "free",
      },
      {
        id: "gemma3",
        name: "Gemma 3 (4B / 12B / 27B)",
        what: "Google's open weights with vision on the 12B and up. 128k context.",
        cmds: ["ollama pull gemma3:12b"],
        url: "https://ollama.com/library/gemma3",
        fit: "12B is the pick when a job needs to read screenshots — error dialogs, BIOS screens, HWiNFO panes.",
        cost: "free",
      },
      {
        id: "phi4",
        name: "Phi-4 (14B)",
        what: "Small model with unusually strong reasoning for its size. 16k context.",
        cmds: ["ollama pull phi4"],
        url: "https://ollama.com/library/phi4",
        fit: "Fast and sharp, but the short window rules it out for whole-document work.",
        cost: "free",
      },
    ],
  },
  {
    id: "paid",
    title: "Paid local inference worth testing",
    intro:
      "Genuinely local, genuinely paid or licence-gated. Listed so you can compare against free weights — not because you need them.",
    tools: [
      {
        id: "nim",
        name: "NVIDIA NIM microservices",
        what:
          "Containerised TensorRT-LLM inference. The fastest way to serve a model on an RTX card, with the engine compiled for your exact GPU.",
        url: "https://build.nvidia.com",
        fit:
          "Runs on a 3090 via WSL2 + Docker + NVIDIA Container Toolkit. Free for personal developer use under the NVIDIA Developer Program; the licence fee applies to production deployment.",
        caution: "Setup is enterprise-shaped. Do this after the machine is stable, never during an experiment.",
        cost: "free-tier",
      },
      {
        id: "tensorrt-llm",
        name: "TensorRT-LLM (direct)",
        what: "Compile a model into a GPU-specific engine yourself. Typically 1.5–3× llama.cpp throughput.",
        url: "https://github.com/NVIDIA/TensorRT-LLM",
        fit: "Free and open source; the cost is your time and a long build. Worth it for one model you run constantly.",
        cost: "free",
      },
      {
        id: "sparse",
        name: "Neural Magic / compressed-tensors models",
        what: "Sparse and quantised weights tuned for fast CPU and low-VRAM serving; now maintained inside the vLLM project.",
        url: "https://huggingface.co/RedHatAI",
        fit: "Relevant if you ever want inference while the 3090 is busy rendering or gaming. The open models are free; the enterprise platform is the paid part.",
        cost: "free-tier",
      },
      {
        id: "hosted-note",
        name: "Hosted models (GPT-5.x, Claude, Grok, Gemini)",
        what:
          "Cloud APIs. Already wired into Jackie through the provider hub with Lovable-first fallback, so you do not need a second subscription to test them.",
        url: "/providers",
        fit: "Use these for the final judgement call; use local models for volume and privacy.",
        caution:
          "None of these can be downloaded or 'run locally'. Any product claiming to sell you a local GPT-4o/GPT-5 is selling something else.",
        cost: "paid",
      },
    ],
  },
  {
    id: "maintenance",
    title: "Windows repair, driver and update managers",
    intro:
      "Vendor-first, then the community tools that are actually safe. Anything not on this list that promises to 'fix' your PC is bait.",
    tools: [
      {
        id: "idsa",
        name: "Intel Driver & Support Assistant",
        what: "Detects the 12900K platform and offers chipset, Wi-Fi, Bluetooth and Thunderbolt drivers straight from Intel.",
        cmds: ["winget install Intel.IntelDriverAndSupportAssistant"],
        url: "https://www.intel.com/content/www/us/en/support/detect.html",
        fit: "Run this first after any Windows repair install — the chipset/Thread Director stack is what regressed.",
        caution: "CPU microcode arrives through MSI BIOS and Windows Update, not through this tool.",
        cost: "free",
      },
      {
        id: "nvapp",
        name: "NVIDIA App",
        what: "Current replacement for GeForce Experience. Driver updates, per-app profiles, and the driver rollback list.",
        cmds: ["winget install Nvidia.NvidiaApp"],
        url: "https://www.nvidia.com/en-us/software/nvidia-app/",
        fit:
          "For a 3090 doing AI work, prefer the Studio branch over Game Ready — fewer regressions in CUDA workloads.",
        caution:
          "GPU VBIOS is not updated here and almost never needs to be. Only flash a 3090 VBIOS if ASUS support tells you to for a named fault.",
        cost: "free",
      },
      {
        id: "msicenter",
        name: "MSI Center (BIOS + board utilities)",
        what: "Z690 Force WiFi BIOS releases and board firmware. The board also has a Flash BIOS Button for USB-only recovery.",
        url: "https://www.msi.com/Motherboard/MPG-Z690-FORCE-WIFI/support",
        fit: "Read the changelog before flashing; log the version you land on in the Firmware Log tab.",
        caution: "Install only the BIOS/LAN/audio pieces. The bundled monitoring and 'optimisation' extras are the flaky part.",
        cost: "free",
      },
      {
        id: "sdio",
        name: "Snappy Driver Installer Origin",
        what: "Offline driver packs on a USB stick. The tool that saves you when a fresh install has no network driver.",
        url: "https://www.glenn.delahoy.com/snappy-driver-installer-origin/",
        fit: "Put it on the same Ventoy stick as your ISOs. Open source, no bundled junk.",
        caution: "Take only the drivers you are missing. Bulk-updating working drivers is how a stable box breaks.",
        cost: "free",
      },
      {
        id: "winutil",
        name: "WinUtil (Chris Titus Tech)",
        what: "One PowerShell script for debloat, service tweaks, bulk installs, and the standard repair actions.",
        cmds: ["irm christitus.com/win | iex"],
        url: "https://github.com/ChrisTitusTech/winutil",
        fit: "Genuinely useful, and its tweaks are reversible from the same panel.",
        caution:
          "It runs remote code as admin. Create a restore point first, and read what each toggle does before applying it — some tweaks disable the update stack you will later want.",
        cost: "free",
      },
      {
        id: "wrt",
        name: "Windows Repair Toolbox",
        what: "Launcher that downloads known-good diagnostic tools on demand: disk, RAM, temps, malware scanners, SFC/DISM wrappers.",
        url: "https://windows-repair-toolbox.com/",
        fit: "Saves collecting a dozen utilities by hand. It fetches them from the vendors, so it stays current.",
        cost: "free",
      },
      {
        id: "hwinfo",
        name: "HWiNFO64",
        what: "Sensor truth: per-core temps, AIO pump RPM, VRM temps, NVMe drive temps, power draw.",
        cmds: ["winget install REALiX.HWiNFO"],
        url: "https://www.hwinfo.com/",
        fit:
          "The first thing to open for any thermal or stability complaint on this rig — pump RPM is the reading that explains most 12900K throttling.",
        cost: "free",
      },
      {
        id: "crystal",
        name: "CrystalDiskInfo",
        what: "SMART health for every drive, including NVMe wear and firmware revision.",
        cmds: ["winget install CrystalDewWorld.CrystalDiskInfo"],
        url: "https://crystalmark.info/en/software/crystaldiskinfo/",
        fit: "Check this before building any array. A drive with reallocated sectors must never join a RAID set.",
        caution:
          "Windows currently reports only one 980 PRO, no Crucial 4 TB, and an old WD 500 GB. Count what CrystalDiskInfo lists against the build sheet before touching anything else.",
        cost: "free",
      },
      {
        id: "magician",
        name: "Samsung Magician",
        what: "Firmware updates and health for the 980 PRO drives.",
        url: "https://semiconductor.samsung.com/consumer-storage/support/tools/",
        fit:
          "980 PRO firmware history includes a real health-degradation fix, so check the revision on all four. Log each in the Firmware Log tab.",
        caution: "Update firmware before drives are in an array, and never mid-rebuild.",
        cost: "free",
      },
      {
        id: "ventoy",
        name: "Ventoy",
        what: "Multi-boot USB: drop Windows 11, Windows 10 and Ubuntu ISOs onto one stick and pick at boot.",
        url: "https://www.ventoy.net/",
        fit:
          "This is your emergency boot kit. Build it while the machine is healthy — a rescue stick made after the failure is a rescue stick you cannot make.",
        cost: "free",
      },
      // Added after checking the kit against the rig: each closes a gap a piece of
      // this hardware had with no tool behind it.
      {
        id: "intel-rst",
        name: "Intel RST / VMD driver (for the Windows installer)",
        what: "The storage driver the Windows installer needs when the Z690's VMD/RAID mode is on. Without it, the NVMe drives simply do not show up.",
        url: "https://www.msi.com/Motherboard/MPG-Z690-FORCE-WIFI/support",
        fit: "Most likely explanation for the three 'missing' 980 PROs. Keep the unpacked driver folder on the Ventoy stick for 'Load driver' during install.",
        caution: "Turning VMD/RAID on or off in BIOS on an installed system can stop Windows booting. Decide before installing, not after.",
        cost: "free",
      },
      {
        id: "memtest",
        name: "MemTest86+",
        what: "Bootable RAM tester. Runs outside Windows, so it tests all 128 GB.",
        url: "https://www.memtest.org/",
        fit: "Four DIMMs at 2 per channel is the configuration most likely to be unstable at XMP speed. Run at least one full pass after any BIOS update or memory-speed change. Add the ISO to the Ventoy stick.",
        cost: "free",
      },
      {
        id: "crucial-se",
        name: "Crucial Storage Executive",
        what: "Firmware and health for the Crucial 4 TB SATA SSD.",
        url: "https://www.crucial.com/support/storage-executive",
        fit: "Only useful once the drive shows up in Windows again. Log its firmware in the Firmware Log tab.",
        cost: "free",
      },
      {
        id: "seatools",
        name: "Seagate SeaTools",
        what: "Seagate's own diagnostic for the 2 TB hard drive.",
        url: "https://www.seagate.com/support/downloads/seatools/",
        fit: "Run the short test first. A failed long test on a hard drive means copy the data off today.",
        cost: "free",
      },
      {
        id: "icue",
        name: "Corsair iCUE",
        what: "Pump speed, fan curves and firmware for the 360 mm AIO.",
        cmds: ["winget install Corsair.iCUE.5"],
        url: "https://www.corsair.com/us/en/s/downloads",
        fit: "If the 12900K throttles, check pump RPM here or in HWiNFO before anything else.",
        caution: "Run iCUE or the motherboard's fan control, not both — they fight over the same fans.",
        cost: "free",
      },
      {
        id: "ddu",
        name: "Display Driver Uninstaller (DDU)",
        what: "Clean removal of the NVIDIA driver, run in Safe Mode, when a normal reinstall does not fix black screens or crashes.",
        cmds: ["winget install Wagnardsoft.DisplayDriverUninstaller"],
        url: "https://www.wagnardsoft.com/",
        fit: "With the Intel UHD 770 also on, DDU-then-reinstall is the cleanest fix for the two drivers clashing.",
        caution: "Unplug the network first so Windows Update does not put a driver straight back.",
        cost: "free",
      },
      {
        id: "winget-upgrade",
        name: "Bring everything up to date",
        what: "One command updates every tool above that was installed through winget.",
        cmds: ["winget upgrade --all --include-unknown"],
        fit: "Run this at the start of a repair session. Tools from a website (Ventoy, MemTest86+, SDIO, SeaTools) need a manual check of their download page.",
        cost: "free",
      },
    ],
  },
];

/** Direct answers to the assumptions in the pasted toolkit list, kept where they can be re-read. */
export const CORRECTIONS: { claim: string; reality: string }[] = [
  {
    claim: "Ollama pools AI limits, and `ollama launch claude` / `ollama launch hermes` starts an agent.",
    reality:
      "Neither command exists. Ollama runs local weights only — it has no quota and no connection to Claude. The 'limit reached' message came from a hosted CLI agent that was running inside the same terminal; closing the window discarded that session's context, not Ollama's.",
  },
  {
    claim: "KoboldCpp reaches 2M tokens of context.",
    reality:
      "KV cache grows linearly with context. On 24GB VRAM plus 128GB RAM, ~64k–128k is the honest ceiling for a 7B–14B q4 model. Past that you are swapping, and generation drops to unusable speed.",
  },
  {
    claim: "Qwen2.5-1M gives you a 1M-token window locally.",
    reality:
      "The weights support it; a single 3090 does not. Qwen's own serving guide for the full window calls for multiple 80GB GPUs.",
  },
  {
    claim: "GPT-4o mini can be bought and run locally through LM Studio.",
    reality:
      "It cannot. OpenAI has never released those weights. LM Studio serves open weights only, and it does not sell models.",
  },
  {
    claim: "Copying a chat into the clipboard is a safe way to carry context between models.",
    reality:
      "The clipboard is one paste deep and dies with the window. Use the Session Capture tab: it writes context to disk, survives a crash, and every consultant answer can read it.",
  },
];
