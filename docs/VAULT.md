# The Vault

`docs/FEATURE_AUDIT.md` recorded this as furniture: four screens rendering
`MOCK_MEDIA_ITEMS`, `MOCK_JOBS` and `MOCK_OUTPUTS` from a 176-line fixture file,
with no supabase call, no edge function, and not even a `localStorage` write
anywhere under `src/vault/`. The screens were populated and convincing and none
of it existed.

Both missing ends are now built, and `mockData.ts` is deleted.

## Where the bytes live: this device

The obvious move is Supabase Storage, and it is the wrong one. This project's
posture is that the network is where updates come from and never where answers
come from; the Vault holds someone's own recordings, camera roll and voice
notes; and the validator already admits files up to 500 MB. Uploading all of
that by default would cost bandwidth, cost money, and move private media off the
machine — to enable a feature that does not need it to leave at all.

So `storage.ts` keeps blobs and metadata in IndexedDB. Local, private, offline,
and large enough. Storage usage is shown rather than hidden, because the person
is spending their own disk and a nearly-full quota explains a failed import far
better than the failure will.

Deleting an item removes its bytes, its jobs and their outputs together.
Deleting the row and orphaning half a gigabyte of blob is how a local store
silently fills a disk.

## Where conversion happens: this device too

`conversionService.createJob` built a job with `status: 'waiting'`. Nothing ever
picked one up — no worker, no ffmpeg, no queue. A job was created, marked
waiting, and waited for ever.

Supabase edge functions are Deno isolates with no ffmpeg binary and no way to
ship one, so a server-side conversion would mean a container, a queue, and an
upload of the source media. ffmpeg compiled to WebAssembly does the same work on
the machine that already holds the file.

The core is 32 MB and loads on the first conversion, never before — the same
arrangement as the on-device model in `docs/ON_DEVICE.md`, and excluded from the
PWA precache by the same `**/*.wasm` rule, for the same reason. Verified after
every build: `wasm precached: 0`.

It is the single-threaded core deliberately. The multi-threaded one needs
`SharedArrayBuffer`, which needs COOP/COEP headers, which this app is not served
with — a faster build that does not run is not faster.

### Arguments are derived, never guessed

`buildArgs` is pure and every preset's command line is asserted in
`src/test/vault-conversion.test.ts`. A preset producing the wrong flags gives you
a file that opens and is wrong, which is worse than one that fails. Some of what
those tests pin down:

- **Trims seek before `-i`**, so ffmpeg does not decode and discard everything
  up to the start point, and they stream-copy rather than re-encode — a trim
  removes bytes and should not cost quality or minutes.
- **`outputFormat: 'same'` keeps the container.** A trim must not silently
  transcode a WAV to MP3 just because the preset had to name something.
- **Normalisation is EBU R128 loudnorm**, not peak. Peak normalisation makes a
  quiet recording no louder if it contains one loud click.
- **Lowering bitrate branches on the media**: `libmp3lame` for audio,
  `libx264` for video.

An output of zero bytes is an error naming the preset and the source, not a
finished conversion. A zero-byte file landing in the library as complete is the
exact failure this codebase keeps having to fix.

## One queue, one job

`queueRunning` lives at module scope, not in a ref. `useVault` is called by
several screens and each call is a separate instance with separate state — a
per-hook guard would let the dashboard and the queue screen, both mounted, each
start the same waiting job. Two ffmpeg instances, two 32 MB cores, two copies of
the media in memory, two outputs for one job.

Progress is written to the store rather than held in component state, so the
queue shows the same number after a navigation.

## What was fake and is now real

| Was | Is |
| --- | --- |
| Import toasted "received. Ready to convert." and did nothing | Validated, probed for duration and resolution, bytes and metadata written |
| Queue toasted "Processing will begin shortly." and discarded the job | Job written to the Vault; the runner converts it |
| Favouriting lived in component state | Persisted |
| Retry and cancel mutated a fixture array | Persisted; retry clears the previous error so a waiting job does not show last attempt's failure |
| Library listed fixtures | Lists what is actually stored, filtered by the `libraryService` that already worked |

`services.ts` is unchanged. It was always sound — validation, link
classification, filename derivation, filtering — and was simply never called by
anything that stored a result.
