# The Index Forge

`contextRouter.ts` shipped four specialised indexes hard-coded: **Recall**,
**Keeper**, **Operator**, **Maker**. Each pairs a specialisation with the
partitions it reads, the small model that suits it, and the ladder of engines
allowed to answer it.

That pairing is the useful unit. A micro model is small enough to run on the
device and far too small to know everything — what makes one useful is the slice
of local storage it is expert in. The idea was right. The authoring was not:
a fifth index meant editing TypeScript.

`/forge` is the same shape, authored at runtime.

## What an index is

| Field | What it decides |
| --- | --- |
| `specialty` | The one kind of question it is for. |
| `systemPrompt` | Prepended to everything it answers. |
| `keywords` | What routes an intent to it. |
| `reads` | Partitions it draws context from, in order. |
| `modelId` | A model from the micro registry — nothing invented. |
| `ladder` | Engine localities it accepts, nearest first. |
| `commands` | Phrases like "Open Tasks", and the in-app route each opens. |

A new index starts on `bonsai-1.7b` with a `device → lan` ladder: the model the
app ships, and offline-first, matching what the built-in routers do.

## What it will not save

Every draft goes through `validateIndex`, and it refuses:

- a model that is not in the registry
- a partition that does not exist
- an empty ladder — nothing could answer it
- no keywords — nothing would ever route to it
- a command route that is not an in-app path

Each of those would produce an index that looks saved, appears in the launcher,
and fails the first time it is asked anything. Every problem is reported at
once, not one per submission: a forge that rejects one field at a time makes the
author submit five times to learn five things, and the fifth rejection is the
one that makes them give up.

## The test bench

The bench runs the draft on its **own** ladder and names the engine that
actually answered — whichever rung was ready, not the first one the draft asked
for. An index tested against a cloud model and shipped as offline-first is
exactly the lie the ladder exists to prevent.

## Where indexes live

Local first, synced second, and that order is the design. An index is what lets
a micro model answer on a device with no network, so if reading your own indexes
needed a round trip the feature would be unusable in the situation it exists
for.

- **localStorage is the read path.** Works signed out, works offline.
- **`crafted_indexes` is a second copy** that follows you between devices and
  survives a cleared cache. Owner-only RLS, `FORCE ROW LEVEL SECURITY`, revoked
  from `anon`.

`saveLocal` returns `false` when the write did not happen — a full or
unavailable store — rather than resolving as though it had, and the page reports
that. Losing something a person wrote while telling them it was safe is the
failure this codebase is organised against.

### When two devices disagree

Last write wins, per index, by `updatedAt`. That is a real choice with a real
cost — two devices editing the same index between syncs means one edit is lost —
and it is right here because an index is small, single-author and rarely edited
from two places at once. A merge, a CRDT or a conflict UI would all cost more
than the problem.

What it never does is lose an index that exists in only one place. The merge is
a union: missing locally is pulled down, missing remotely is pushed up, and only
a genuine id collision consults timestamps.

`updated_at` is stamped by a database trigger and overrides whatever the spec
carries, because a spec's own timestamp is written by a client — and a client
with a wrong system clock would otherwise win every conflict for ever.

### Deletes

A delete is a row removal plus a local tombstone. Without the tombstone the next
sync would see the index present remotely and absent locally, treat it as
something to pull down, and resurrect what you just deleted.

A tombstone older than a remote edit loses: the edit is the later intention.
Losing a deliberate change is worse than an unexpected restore, which is one
click to undo.

## Files

An export is an envelope, not a bare array — a file that is just `[{…}]` cannot
say what it is or which version wrote it, so the first change to the shape makes
every file already on disk ambiguous.

Everything is re-validated on the way in. An exported file is editable text and
people do edit it. Import keeps the good entries, names each refusal with its
reason, and refuses a pack from a newer build outright rather than silently
dropping fields it does not understand.

## Deploying

The migration must land before the sync works:

```bash
supabase db push
supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

Until those run, `src/lib/forge/store.ts` carries a scoped cast with a comment
explaining why — the generated `Database` union does not yet contain
`crafted_indexes`. The cast is deliberately narrow: loosening the client
project-wide would hide the same mistake everywhere else, where it would be a
real error rather than a pending codegen step.

`src/test/forge.test.ts` covers validation, the file format and the merge.
