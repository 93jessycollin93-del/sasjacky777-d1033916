# End-to-end tests

Specs here get a built app served at `http://localhost:4173` automatically;
point `E2E_BASE_URL` at a deployment (or at `npm run preview -- --host
127.0.0.1`) to run against that instead. CI's E2E step runs them on every push
once a spec exists.

```bash
npx playwright test                       # build, serve, run
E2E_BASE_URL=http://127.0.0.1:4173 npx playwright test e2e/strongbox.spec.ts
```

## What is covered

- **`strongbox.spec.ts`** — `public/strongbox.html`, the offline vault. A vault's
  claims are its product, so each one is checked in a real browser with real
  WebCrypto and IndexedDB: a note opens only with its password, nothing
  readable reaches the disk, a tampered item is refused, and a backup restores
  into a browser that has never seen it. The rest pin the problems it arrived
  with, none of which said so when it happened: a damaged backup, or one made
  with another password, wiping the vault it was meant to restore; a backup
  whose item id carried markup running it on unlock; "2 files saved" when one
  had failed; a self-test that passed a corrupted byte; a "zero network calls"
  row that was a string rather than a count; decrypted text left on screen
  after locking; an idle lock that never fired on a phone that had slept; and
  saves failing silently once Safari closed the storage connection.

## Worth writing next

The boundaries this repo still has no automated coverage for:

  - a signed-out visitor is redirected away from a protected route
  - notes written by one account are not visible after signing in as another
    on the same browser (regression test for the fixed sticky-note leak)
  - a rotated API key stops authenticating once its grace period ends
