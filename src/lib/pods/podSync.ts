// Sync local pod metadata into eye_pod_registry so QR codes and pod-bound
// routers can resolve them from any device.
import { supabase } from "@/integrations/supabase/client";
import type { PodRecord } from "./podEngine";
import { seedIdentity, capabilityFor } from "./seedIdentity";

export async function syncPodRegistry(pods: PodRecord[]): Promise<Record<string, string>> {
  const { data: userData } = await supabase.auth.getUser();
  const user_id = userData.user?.id;
  if (!user_id) return {};

  const map: Record<string, string> = {};
  const rows = pods.map((p) => {
    const id = seedIdentity(p.slot);
    return {
      user_id,
      pod_key: p.id,
      name: p.name,
      color: id.color,
      glyph: id.glyph,
      capability: capabilityFor(p.domain),
      version: p.version || 1,
      content_hash: p.fingerprint || null,
      bytes_raw: p.bytesRaw || 0,
      bytes_compressed: p.bytesCompressed || 0,
    };
  });

  const { data, error } = await supabase
    .from("eye_pod_registry")
    .upsert(rows, { onConflict: "user_id,pod_key" })
    .select("id,pod_key");
  if (error) {
    console.warn("pod registry sync failed", error.message);
    return {};
  }
  for (const r of data ?? []) map[(r as any).pod_key] = (r as any).id;
  return map;
}

export function podQrPayload(row: {
  id: string; pod_key: string; capability: string; version: number; content_hash: string | null;
}) {
  const supUrl = (import.meta as any).env?.VITE_SUPABASE_URL ?? "";
  return JSON.stringify({
    kind: "eye-seed",
    pod_id: row.id,
    pod_key: row.pod_key,
    capability: row.capability,
    version: row.version,
    hash: row.content_hash,
    fetch: `${supUrl}/functions/v1/pod-fetch`,
  });
}
