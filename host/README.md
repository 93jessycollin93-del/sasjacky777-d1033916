# The host attachment

Drop this folder next to a build and run it. The product hosts itself.

```sh
node host/serve.mjs ./dist
# http://127.0.0.1:8787
```

No dependencies, no install, no network. One file. That is the point: a system
whose claim is that it works with the radio off cannot depend on a hosting
service being reachable.

## Options

```sh
node host/serve.mjs ./dist --port 4321 --host 0.0.0.0
```

- `--port` — default 8787
- `--host` — default `127.0.0.1`. Use `0.0.0.0` to reach it from a phone on the
  same network; that exposes it to everything else on that network too.

`GET /__host/health` returns what it is serving, for the constellation's own
station probe.

## What it gets right, and why each one matters

**Path traversal is refused, not rewritten.** The `..` check runs on the decoded
path and before normalization. Both halves matter: checking before decoding
misses `%2e%2e`, and checking after normalizing misses everything, because
`normalize` quietly turns `/../../etc/passwd` into `/etc/passwd` — the segments
are gone by the time you look, and the request is served as a different path
than the one asked for. A test caught exactly that, and it is why the guard sits
where it does.

**A traversal never falls back to the shell.** Answering 200 with the app shell
would read as success to anything probing.

**Service workers are never cached.** `sw.js` is `no-store`. A worker cached for
a year cannot be replaced, and the app is then frozen at that build on every
device that ever loaded it. Hashed assets are pinned for a year precisely
because their names change with their content.

**The PC falls back to its own shell.** `/pc-os/` is a complete build with its
own service worker and routes. Handing it Jackie's shell would stop it starting
in its own tab offline — the one situation the fallback exists for.

**Range requests are served.** Model weights come from here and are gigabytes.
Without ranges, a resumed download starts over.

## Testing it

The decisions live in `host/serve.mjs` as exported pure functions, and
`src/test/host-attachment.test.ts` imports that same file — there is no second
copy to drift. Run `npm test`.

Importing the module starts nothing; the server only listens when the file is
executed directly.
