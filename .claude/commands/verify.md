---
description: Run every check this repository has, in the order that fails fastest
---

Run all four suites plus typecheck, lint and build, and report what passed.

```bash
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npx vitest run
python3 -m pytest
cd context-condenser && npm test && cd ..
npm run build
```

Rules for reporting:

- Typecheck and lint first — they are seconds, and a failure there makes the
  rest noise.
- `npm run lint` currently emits ~199 warnings and **zero errors**. Warnings are
  the baseline, not a regression. Only a non-zero exit matters.
- If `npm run build` dirties `supabase/functions/mcp/index.ts`, that is the Vite
  plugin regenerating it — `git restore` the file, do not commit it, and do not
  treat it as a failure.
- Report the actual numbers (`506 passed`), not "tests pass". If something
  failed, paste the failing output rather than summarising it.
