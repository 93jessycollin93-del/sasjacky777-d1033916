# The model download queue

180 compact AI models in priority order, from the owner's download plan. One
file holds them: `command_station/models/manifests/DOWNLOAD_QUEUE.json`. Three
things read it, so none of them can describe a different model:

| Reader | What it does with the queue |
| --- | --- |
| `/models` in the app (`src/pages/ModelQueue.tsx`) | Lists every entry with filters (phase, section, "runs in this app"), search, corrections and licence warnings; saves the JSON; opens the chat on a model that runs here |
| The On-device engine (`src/lib/microai/deviceModels.ts`) | Runs the six chat-capable language models in the browser; a test checks their repositories and quantizations match the queue's |
| The rig's downloader (`command_station/tools/model_queue.py`) | Fetches entries into the `models/` layout with a manifest beside each |

## What runs where

- **In this app, in the browser:** the GGUF chat models — SmolLM2 360M and
  1.7B, Qwen2.5 0.5B, Qwen2.5 Coder 1.5B, SmolLM3 3B, Phi-3.5 mini — on the
  chat's On-device engine (`docs/ON_DEVICE_CHAT.md`), next to Bonsai.
- **Not yet in the app:** speech, vision, embedding, OCR and image-generation
  models need runtimes (ONNX Runtime, LiteRT, Core ML, Diffusers) the app does
  not carry. They are catalogued, and the rig downloader fetches them.
- **Left out of On-device on purpose:** Gemma (gated — an anonymous download is
  refused), and DeepSeek-R1-Distill (it writes a long thinking section before
  every answer; minutes on a phone's CPU before the first word).

## Downloading on the rig

```bash
python command_station/tools/model_queue.py --phase 1             # print the plan, fetch nothing
python command_station/tools/model_queue.py --phase 1 --download  # fetch it
python command_station/tools/model_queue.py --queue 1,2,8 --root E:/AI_Permanent/models --download
python command_station/tools/model_queue.py --tier0 --download
```

Needs `pip install huggingface_hub` for `--download`; gated repositories read
a token from `HF_TOKEN`. Per entry it takes:

- **one GGUF file** where the queue lists a GGUF build (Q4_K_M, else Q4_0,
  Q5_K_M, Q8_0 — the same rule as the app);
- otherwise **one weight format**: the ONNX export when the queue wants ONNX
  and one exists, else safetensors, else `.bin` — never all three copies a
  repository often carries — plus config and tokenizer files.

It skips duplicates and entries published outside Hugging Face (printing where
they are), reports a gated or missing repository by name and carries on, and
writes `manifest.json` beside each model in the shape the plan proposed:
`name`, `source`, `queue`, `task`, `formats`, `runtime_targets`, `fallbacks`,
and `quantizations` / `memory_tier` / `license` / `caution` where they apply.

## The layout

The plan's `models/` tree, with three folders added for entries it had no
place for: `text/classification` (routers, rerankers, NLI),
`audio/classification` (CLAP, AST, language ID, emotion) and
`multimodal/generation` (Stable Diffusion family). `converted/` stays for the
owner's own conversions; nothing writes there.

## Corrections to the plan

Ids that are not Hugging Face repositories as written. The queue keeps the
original id and adds what to fetch (`repo`), or `repo: null` and a `source`
when it is published elsewhere. Checked against knowledge and web search;
this environment cannot reach Hugging Face, so a downloader run is the final
check.

| # | As written | Fetch instead |
| ---: | --- | --- |
| 14, 114 | `ultralytics/yolov8n` | `Ultralytics/YOLOv8` (yolov8n.pt) |
| 15, 115 | `ultralytics/yolov11n` | `Ultralytics/YOLO11` — named YOLO11, no v |
| 113 | `ultralytics/yolov5n` | GitHub releases of ultralytics/yolov5 |
| 16, 117 | `google/mobilenet_v3_small` | `timm/mobilenetv3_small_100.lamb_in1k` |
| 19, 159 | `microsoft/Florence-2-small` | `microsoft/Florence-2-base` (no "small" exists) |
| 34, 35 | `Cerebras/…` | `cerebras/…` |
| 42 | `stabilityai/stablelm-2-1.6b` | `stabilityai/stablelm-2-1_6b` |
| 47 | `allenai/OLMo-300M` | `allenai/OLMo-1B-hf` (no 300M OLMo) |
| 52 | `IBM/granite-3.0-2b-instruct` | `ibm-granite/granite-3.0-2b-instruct` |
| 60 | `microsoft/MobileBERT-uncased` | `google/mobilebert-uncased` |
| 64 | `MoritzLaurer/Multi-BERT-L-2-mnli-xnli` | unconfirmed; `MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli` |
| 109 | `snakers4/silero-vad` | GitHub (ONNX included) |
| 110 | `s3prl/uper-emo` | unconfirmed; `superb/wav2vec2-base-superb-er` |
| 112 | `faster-whisper` | `Systran/faster-whisper-*` |
| 120 | `google/vit-tiny-patch16-224` | `WinKawaks/vit-tiny-patch16-224` |
| 124 | `google/efficientnet-lite0` | TensorFlow's TFLite release, not Hugging Face |
| 127 | `ChaoningZhang/MobileSAM` | GitHub |
| 128 | `depth-anything/Depth-Anything-Small` | `LiheYoung/depth-anything-small-hf` |
| 130 | `Intel/dpt-beit-base` | `Intel/dpt-beit-base-384` |
| 132 | `isl-org/MiDaS` | `Intel/dpt-hybrid-midas` |
| 141 | `open-mmlab/mmdetection` RTMDet-tiny | OpenMMLab model zoo (GitHub) |
| 145–147 | `timm/efficientnet_b0` etc. | with their training tag, e.g. `timm/efficientnet_b0.ra_in1k` |
| 158 | `Salesforce/blip-base` | `Salesforce/blip-image-captioning-base` |
| 169 | `PaddlePaddle/PaddleOCR` | GitHub |
| 177 | `BAAI/Emu3-Vision` | `BAAI/Emu3-Chat` (8B, not compact) |

Other things worth knowing before downloading, also on each entry:

- **Gated:** Gemma (#6, #50, #51, #164) needs Google's terms accepted;
  MobileLLM (#29–31) Meta's non-commercial licence.
- **Non-commercial or restricted:** YOLO (AGPL-3.0), MusicGen weights
  (CC-BY-NC), XTTS-v2 (Coqui, non-commercial), LayoutLMv3 (CC-BY-NC-SA),
  SD-Turbo / SDXL-Turbo / StableLM 2 (Stability AI terms), BLOOMZ (RAIL).
- **Not what the task suggests:** the tiny BERTs, ALBERT, TinyBERT, DistilBERT,
  MobileBERT and DeBERTa-v3 are base encoders — fine-tune before they classify;
  Whisper transcribes, it is not a wake-word detector; Gemma 3 1B is text-only.
- **Duplicates:** 15 entries repeat an earlier one (marked `duplicateOf`).

Sizes vary by format and quantization — the plan's own caveat stands, so the
queue records none; the On-device panel and the downloader read real sizes
from the listing.
