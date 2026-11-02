// Eru ↔ Jackie bridge: safely expose `base44` even when Base44 env is absent.
// When VITE_BASE44_APP_ID is missing, returns a Proxy that no-ops gracefully
// (list/find resolve to []; get resolves to null; create/update echo the record
// they were handed; auth.me() resolves to the Jackie user).
import { createClient } from '@base44/sdk';
import { supabase } from '@/integrations/supabase/client';

const appId = import.meta.env.VITE_BASE44_APP_ID;
const appBaseUrl = import.meta.env.VITE_BASE44_APP_BASE_URL;

let realClient = null;
if (appId) {
  try {
    realClient = createClient({
      appId,
      appBaseUrl,
      serverUrl: '',
      requiresAuth: false,
    });
  } catch (err) {
    console.warn('[eru/base44] init failed, using shim:', err);
  }
}

// Map a Base44 user-shape to Jackie's Supabase session.
//
// `getUser()` revalidates against the auth server on every call, so a flaky
// connection — or none at all — makes it resolve to `{ user: null }` even for a
// perfectly good local session. Ported Eru code reads `me.email` straight off
// the result in dozens of places, so that null took whole pages down with an
// uncaught TypeError (Preferences, Arena and Referrals each did). Fall back to
// the stored session, which is the same user without the round trip, and return
// null only when there is genuinely nobody signed in.
async function jackieUser() {
  let u = null;
  try {
    const { data } = await supabase.auth.getUser();
    u = data?.user ?? null;
  } catch { /* offline or auth server unreachable — fall through */ }
  if (!u) {
    try {
      const { data } = await supabase.auth.getSession();
      u = data?.session?.user ?? null;
    } catch { /* no usable session */ }
  }
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    full_name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'Operator',
    role: u.user_metadata?.role || 'user',
    isAdmin: u.user_metadata?.role === 'admin',
    avatar_url: u.user_metadata?.avatar_url,
  };
}

const noopList = async () => [];
const noopOne = async () => null;
const noopVoid = async () => undefined;

// `create`/`update` answer with the saved record in the real SDK, and ported
// pages read straight off that answer (`created.id`, `created.ai_campaign_...`).
// Resolving them to null turned every such call into an uncaught TypeError —
// the Card Arena page died on exactly that. Echo the record the caller
// described, with the id and timestamps the shape is expected to carry, so the
// UI degrades to "not persisted" instead of crashing. Read paths still invent
// nothing: list/filter stay empty and get stays null.
let shimSeq = 0;
const shimId = () => `offline-${Date.now().toString(36)}-${(shimSeq += 1)}`;
const noopEcho = async (a, b) => {
  const payload = (b && typeof b === 'object' ? b : a && typeof a === 'object' ? a : {});
  const now = new Date().toISOString();
  return {
    id: typeof a === 'string' ? a : shimId(),
    created_date: now,
    updated_date: now,
    ...payload,
  };
};

const entityShim = new Proxy({}, {
  get(_t, _name) {
    return new Proxy({}, {
      get(_e, op) {
        if (op === 'list' || op === 'filter' || op === 'find') return noopList;
        if (op === 'create' || op === 'update') return noopEcho;
        if (op === 'get' || op === 'me') return noopOne;
        // bulkCreate answers with the created rows, so callers chain .find() and
        // .filter() straight onto it. Resolving it to undefined here is what
        // threw "Cannot read properties of undefined (reading 'find')" and left
        // the Bot Farm page blank whenever Base44 was not configured.
        if (op === 'bulkCreate') return noopList;
        if (op === 'delete') return noopVoid;
        return noopOne;
      },
    });
  },
});

const integrationsShim = new Proxy({}, {
  get() { return async () => ({ ok: false, offline: true }); },
});

const authShim = {
  me: jackieUser,
  login: async () => { window.location.href = '/auth'; },
  logout: async () => { await supabase.auth.signOut(); window.location.href = '/auth'; },
  isAuthenticated: async () => !!(await jackieUser()),
};

const functionsShim = new Proxy({}, {
  get() { return async () => ({ data: null, offline: true }); },
});

const shim = {
  entities: entityShim,
  integrations: integrationsShim,
  auth: authShim,
  functions: functionsShim,
  offline: true,
};

export const base44 = realClient ?? shim;
export const isBase44Live = !!realClient;
