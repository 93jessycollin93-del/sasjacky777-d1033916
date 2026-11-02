# Database authorization tests

These run the real migration chain against a throwaway PostgreSQL instance and
then attempt, as a second signed-in user, every cross-tenant move the security
review asked us to prove impossible. They exist because the interesting
failures here are not syntax errors — they are policies and grants that look
right and are not, which nothing in the TypeScript build can catch.

    scripts/db-authz-test.sh

`00_supabase_shim.sql` stands in for the parts of a Supabase project that live
outside `supabase/migrations/`: the `auth` and `storage` schemas, `auth.uid()`,
the `anon` / `authenticated` / `service_role` roles, and — importantly — the
bootstrap grant of `ALL` on public tables to `anon` and `authenticated`.
That last one is not a detail. Supabase hands those roles full table
privileges and relies on RLS for protection, which is the only reason the
`REVOKE` statements in the migrations mean anything. A shim without it makes
every table look secure for the wrong reason and hides real regressions.
