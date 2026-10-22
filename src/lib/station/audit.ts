import type { SupabaseClient } from '@supabase/supabase-js';

export async function writeStationAudit(
  db: SupabaseClient,
  actorUid: string,
  action: string,
  entity: string,
  entityId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db.from('st_audit').insert({
    actor_uid: actorUid,
    action,
    entity,
    entity_id: entityId,
    details,
  });
  if (error) throw new Error('Station audit write failed');
}