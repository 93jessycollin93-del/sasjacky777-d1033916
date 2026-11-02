CREATE TABLE public.jackie_lock_slots (
  user_id uuid NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 7),
  salt text NOT NULL,
  fingerprint text NOT NULL,
  iterations integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot)
);
GRANT ALL ON public.jackie_lock_slots TO service_role;
ALTER TABLE public.jackie_lock_slots ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.jackie_lock_state (
  user_id uuid PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_slot smallint,
  pending_slot smallint,
  unlocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.jackie_lock_state TO service_role;
ALTER TABLE public.jackie_lock_state ENABLE ROW LEVEL SECURITY;