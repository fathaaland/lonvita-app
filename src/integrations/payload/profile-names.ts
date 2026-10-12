import { buildWhereParams, get } from "./client";

import type { PayloadListResponse } from "./client";
import { relationId } from "@/lib/relations";

/** Display names behind user ids, from their profiles — anyone without one is left out. Shared by
 * the participant, admin and superadmin query modules. */
export async function fullNamesByUserIds(userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const where = buildWhereParams({ user: { in: [...new Set(userIds)] } });
  const profiles = await get<PayloadListResponse<{ user: number | { id: number }; fullName: string }>>(
    `/profiles?${where}&depth=0&limit=500`,
  );
  for (const p of profiles.docs) {
    const uid = relationId(p.user);
    if (uid) names.set(uid, p.fullName);
  }
  return names;
}
