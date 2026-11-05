# Roadmap

## Security pass (Nov 2026) — done
- [x] Dependencies: patched versions resolved (scanner: 0 known issues); typecheck, 1,986 tests and build pass
- [x] Agent cycle touches only the caller's own agent
- [x] Game ledger: amounts and balances come from server rules, not the request
- [x] Model instructions: only the owner may replace Jackie's system prompt; others' text rides in the user turn
- [x] LAN relay: game-only origins, guests join only open worlds, code-guessing lockout, player cap
- [x] Bazar Stand: no client-side "verified" payment credits
- [x] Guests: cannot hold API keys or outside-service connections; other guest access stays own-rows-only

## Open
- [ ] Bazar Stand real payment verification + fulfilment (blocked: needs a payment provider decision; purchases currently wait and never complete)
- [ ] Game economy server-authoritative (diamonds/claims still live in the browser; ledger only audits)
- [ ] Offline photo question on Thinking Chain (blocked: needs a real GPU browser — the operator's RTX 3090)
- [ ] Workstation end to end (blocked: Jacky server rejects the saved token)
- [ ] Text/code converter in Jackie (Discord-style language picker, AI conversion)
