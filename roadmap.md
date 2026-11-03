# Roadmap
- [x] Offline thinking chain (fetch/archive/compress/plan/reason/combine/check) on Bonsai — /chain
- [x] On-device photo reader (SmolVLM 256M) wired into the chain
- [ ] Workstation end to end — blocked: Jacky server rejects the saved token (401)
- [ ] Offline profile: serve Jackie's last-good profile from this device when the network is out (personaCache + tests)
- [ ] Weights & engines activation audit: which model files and runtimes are real vs pointers, what blocks each engine
- [ ] Lego blocks: every engine and agent reads/tunes from one shared data pod, so pieces are reusable and re-tunable
- [ ] Specialized context pods ("poduals") that revolve around one job each, plus min-maxed variants (smallest usable version of each block)
