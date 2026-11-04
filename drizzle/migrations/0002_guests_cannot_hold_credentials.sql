-- Guest (anonymous) sessions are created automatically for every visitor, so
-- they carry the authenticated role. Everywhere else that is intended: a guest
-- reaches only its own rows. Credentials are the exception — an API key or an
-- outside-service connection outlives the throwaway session that made it, so
-- only a real account may hold one.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['api_keys', 'bot_api_keys', 'jackie_connections', 'jackie_connection_secrets'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_no_guests', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
           USING ((auth.jwt() ->> ''is_anonymous'')::boolean IS NOT TRUE)
           WITH CHECK ((auth.jwt() ->> ''is_anonymous'')::boolean IS NOT TRUE)',
        t || '_no_guests', t);
    END IF;
  END LOOP;
END $$;