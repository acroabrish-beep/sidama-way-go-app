/**
 * Role normalization and self-service role policy.
 *
 * Deliberately side-effect free so it can be unit-tested without touching
 * Firebase or Supabase.
 */

/**
 * Normalizes role strings to canonical versions for the 'role' column.
 */
export function normalizeRole(role?: string): string {
  if (!role) return "citizen";
  const r = role.toLowerCase().trim();

  if (r.includes("admin") && r.includes("super")) return "admin";
  if (r === "admin") return "admin";
  if (r.includes("business")) return "business";
  // Check driver before taxi: "taxi_driver" contains both words.
  if (r.includes("driver")) return "taxi_driver";
  if (r.includes("taxi")) return "taxi";
  if (r.includes("new") && r.includes("terminal")) return "new_terminal";
  if (r.includes("old") && r.includes("terminal")) return "old_terminal";
  if (r.includes("tourism")) return "tourism";
  if (r.includes("hotel")) return "hotel";
  if (r.includes("health") || r.includes("hospital")) return "health";
  if (r.includes("pharmacy")) return "pharmacy";
  if (r.includes("emergency")) return "emergency";
  if (r.includes("government")) return "government_fleet";
  if (r.includes("church")) return "church";

  return "citizen";
}

/**
 * Roles a user may request for themselves. Privileged/staff roles must be
 * provisioned in Supabase by an administrator and are never accepted from a
 * client payload.
 */
export const SELF_SERVICE_ROLES = new Set(["citizen", "taxi_driver", "business"]);

export const PRIVILEGED_ROLES = new Set([
  "admin",
  "old_terminal",
  "new_terminal",
  "taxi",
  "tourism",
  "hotel",
  "health",
  "pharmacy",
  "emergency",
  "church",
  "government_fleet",
]);

/**
 * Resolve a role the client is allowed to set for itself.
 * Privileged roles are never granted from client input, and an existing
 * privileged account is never downgraded by a client request.
 */
export function resolveSelfServiceRole(requested: string, fallback: string): string {
  const normalized = normalizeRole(requested);
  if (SELF_SERVICE_ROLES.has(normalized)) {
    return PRIVILEGED_ROLES.has(fallback) ? fallback : normalized;
  }
  return fallback;
}
