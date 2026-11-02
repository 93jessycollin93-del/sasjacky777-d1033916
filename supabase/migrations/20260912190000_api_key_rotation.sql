-- Key rotation.
--
-- Rotating a key means the new one inherits the old one's identity while the
-- old one keeps working for a stated, bounded window. That needs four facts the
-- table could not previously hold: when a retiring key stops authenticating,
-- and which key replaced which, readable from either end.

ALTER TABLE public.api_keys
  -- When a retiring key stops authenticating. NULL means no expiry, which is
  -- every key issued before rotation existed.
  ADD COLUMN IF NOT EXISTS expires_at   timestamp with time zone,
  -- Lineage, both directions: the replacement points back, the retiree points
  -- forward. Either alone leaves half the audit trail unreadable.
  ADD COLUMN IF NOT EXISTS rotated_from uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rotated_at   timestamp with time zone,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.api_keys(id) ON DELETE SET NULL;

-- Authentication filters on these two together on every request.
CREATE INDEX IF NOT EXISTS api_keys_active_expiry_idx
  ON public.api_keys (is_active, expires_at);

COMMENT ON COLUMN public.api_keys.expires_at IS
  'Grace deadline for a rotated key. After this it cannot authenticate, even while is_active is true.';
COMMENT ON COLUMN public.api_keys.superseded_by IS
  'The key that replaced this one. Set at rotation time.';
COMMENT ON COLUMN public.api_keys.rotated_from IS
  'The key this one replaced. Set at rotation time.';
