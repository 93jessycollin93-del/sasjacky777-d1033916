# The Artifact Library

`/artifacts` holds every single-file HTML app saved out of AI chats, and runs
each one sealed off from the rest of the app. The first import brought in 337
files from Google Drive and chat uploads: 304 artifacts, 12 pieces of source
code recovered from saved code views, and 17 saved pages left out because they
were never artifacts.

## Using it

- **Cards are groups.** The same app was saved many times as it was worked
  on; versions with the same heading share one card. A card opens the newest
  version, and the viewer's version menu switches between the others.
- **Filters**: *Saves data*, *Uses the network*, *Recovered source*, and
  *Failed at import* — the ones that threw an error, or showed nothing at all,
  when they were opened during the import.
- **Download** saves the artifact as a plain `.html` file you can open on its own.
- **Saved data.** An artifact that keeps its state in `localStorage` keeps it
  here too, per version, in this browser. The bar shows how much it has saved
  and when; *Erase data* deletes it (after asking).
- `/artifacts?open=<id>` opens one artifact directly; the browser's back
  button closes it.

## Why it is built this way

**Every artifact runs in a sandbox with no origin.** These are whole apps
written by an AI, some loading scripts from other hosts. On this app's own
origin one could read the signed-in session. The viewer runs each one in an
`<iframe sandbox>` *without* `allow-same-origin`, so it has an opaque origin
and can reach nothing of Jackie's. `ARTIFACT_SANDBOX` in
`src/lib/artifactLibrary.ts` is the one place the flags live; never add
`allow-same-origin` there.

**localStorage is given back; IndexedDB is not.** An opaque origin has no
storage: touching it throws. About a quarter of the artifacts save to
`localStorage`, so the viewer puts a stand-in in front of the artifact's own
scripts (`withStorageShim`). It behaves like the real one, and every change is
handed to the page, which keeps it in its own IndexedDB database
(`jackie-artifact-storage`), keyed by the artifact's id. IndexedDB cannot be
handed back the same way; the viewer says so on the artifacts that use it, and
downloading one runs it with full storage.

**Files are stored as gzip `.bin`, not `.html`.** Under
`public/artifact-library/files/<id>.bin`. That keeps them at about 40% of their
size, and — the reason that matters — a `.bin` URL opened directly downloads
instead of running. An `.html` file there would run on this origin, outside
the sandbox. The folder is deliberately not named `artifacts/`, which is the
page's route: a static host can answer a URL with a folder of the same name.

**Every file is checked before it runs.** The id is the start of the file's
SHA-256. The viewer unpacks the file, hashes it, and refuses to open one that
does not match — whatever it is, it is not the file that was imported and
secret-scanned.

**The service worker does not precache the library.** ~40 MB nobody needs on
first load. Files and thumbnails are cached the first time they are opened
(their names are content hashes, so a cached copy is never stale), and the
catalog is network-first, so the library still opens offline.

**Links inside artifacts.** The Meta AI exporter that made most of these wraps
each artifact so that, inside a frame, a click on an outside link is cancelled
and handed to the parent instead. The viewer answers: it shows the link and
opens it in a new tab when asked. Without that, links in these artifacts would
silently do nothing.

## Importing more

```bash
node scripts/import-artifacts.mjs <files-or-folders>...                       # dry run: what would happen
node scripts/import-artifacts.mjs <files-or-folders>... --render --write      # apply
```

`--render` opens each new artifact in headless Chromium (Playwright) to read
its heading — nearly every file is titled "React Artifact", so the heading is
the only real name it has — and to take its thumbnail. It runs offline:
requests to other hosts are refused, so nothing leaves the machine during an
import. Pass `--chromium <path>` if Playwright's own browser is not installed.

A `<name>.json` beside `<name>.html` is read as its provenance (`id`, `title`,
`modified` from Google Drive). Running the import again only adds what is new:
everything is keyed by content hash, and a second run over the same files
changes nothing.

### What stops an import

A real-looking credential. This repository is public. `scanSecrets` in
`scripts/artifact-catalog.mjs` looks for API keys, tokens and private keys;
example values (`sk-proj-xxxx…`, `gsk_xxxx…`, which these files are full of)
pass, because a placeholder has almost no variety in its characters and a real
key has plenty. A file with a real one is refused, by name, with the kind of
key — never the key itself. Remove it, revoke it, and run again.

### What is left out, and what is changed

`classifyPage` decides what a file is:

| It is | What happens |
| --- | --- |
| An artifact | Imported as-is, byte for byte. |
| A saved code view (a claude.ai page showing an artifact's source, with line numbers) | The source is recovered line for line and stored as a plain page that shows it as text, with no scripts. The original page carried the whole claude.ai front end, which cannot run here and is not ours to republish. |
| A saved share page (Claude, Meta AI), a saved ChatGPT conversation, a saved Twitch page | Left out. These hold the site's own front end and a frame whose content lives on the site's servers; saved, they show an empty frame. They are listed at the bottom of the library with the reason. |

## Files

```
scripts/artifact-catalog.mjs     titles, grouping, feature detection, secret scan, page classification
scripts/import-artifacts.mjs     the import itself
src/lib/artifactLibrary.ts       catalog, fingerprint check, storage stand-in, frame messages
src/pages/ArtifactLibrary.tsx    the gallery
src/components/artifacts/ArtifactViewer.tsx   the sandboxed viewer
public/artifact-library/         catalog.json, files/<id>.bin, thumbs/<id>.jpg
src/test/artifact-catalog.test.ts, src/test/artifact-library.test.ts
```

This replaces `src/features/artifact-launcher/`, an earlier sketch that read an
`/app/artifacts.json` nothing ever wrote and was never mounted.
