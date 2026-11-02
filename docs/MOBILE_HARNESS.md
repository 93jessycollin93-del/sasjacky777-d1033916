# Jackie mobile workspace

The main chat now has Chat and Agent harness modes. The latter uses a bounded
act/observe loop through the same `appActions.ts` actions as the existing Hermes
and MCP integrations. It is an in-app harness, not a native Hermes installation.

## What the harness can do

By default it can read tasks, memories and conversation history. Enable reviewed
writes to let it propose a task or a memory; each exact action and its arguments
must be approved before it runs. Deletion, custom recipes and external service
calls are outside this harness's tool set. Its backend queries retain the
signed-in user's RLS boundaries, and a changed account refuses an old run's action.

Runs stop after three actions and at most four model turns. There is no automatic
engine switch during an agent run. The run trace lists observed model calls and
actual action results. A failed or unfinished run is reported as such. Small
models can produce invalid actions or run out of context; this wiring does not
prove their judgment or guarantee their speed on an iPhone.

Chat history continues to be saved. The harness disables Chat's automatic memory
extraction so a read-only run cannot silently write memories after its tools
correctly refused a write. Stop also cancels a pending approval.

## Mobile layout

The page uses dynamic viewport height, safe-area padding, readable message
cards and 44-pixel control targets. Focus mode is on by default and does not
mount the animated canvas. The model shelf collapses after a download; stored
weights and an accessible server profile are separate readiness checks.

## HTTP 404 from jackie-device

This is a missing backend deployment, not a broken model download. The
workbench preserves the error, offers a connection check and can restore the
failed prompt. Downloading the weights again will not deploy a function.

Deploy `supabase/functions/jackie-device/index.ts` and its relative `_shared/`
dependencies to the backend this application is configured to use:

```sh
supabase functions deploy jackie-device --project-ref iezgzdhhmwmbqshnxrie --use-api
```

The CLI needs an authenticated project owner. For this Lovable Cloud project,
the Lovable editor can deploy the existing function. An unrelated Supabase
project or a new project is not a repair for this app. The configuration keeps
JWT verification enabled and the handler checks the owner role before returning
the guarded profile. Successful profile responses are not cached.

Verify that the endpoint exists, unsigned requests are refused, non-owners are
refused, and the verified owner receives a guarded profile. Then use **Check
connection** and send a short message from the already-downloaded model.

The profile request carries bounded memory context, not the conversation. It
has a 15-second deadline and never substitutes an unguarded identity. On-device
inference still needs that profile request; it is not an offline promise.
