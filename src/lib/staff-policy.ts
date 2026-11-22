// Shared permission vocabulary. Owner credentials never authenticate to the staff portal.
export const STAFF_ROLES = ["ADMIN", "SUPPORT", "SAFETY"] as const;
export type StaffRole = typeof STAFF_ROLES[number];
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin", SUPPORT: "Support Staff", SAFETY: "Safety Review Staff",
  SUPERADMIN: "Superadmin",
};
export type Permission = "operations" | "support" | "support.manage" | "finance" | "safety" | "resources.edit";
const grants: Record<string, readonly Permission[]> = {
  SUPERADMIN: ["operations", "support", "support.manage", "finance", "safety", "resources.edit"],
  ADMIN: ["operations", "support", "support.manage", "finance", "safety", "resources.edit"],
  SUPPORT: ["support"],
  SAFETY: ["safety"],
};
export function hasPermission(role: string, permission: Permission) {
  return !!grants[role]?.includes(permission);
}
export function isStaffRole(role: unknown): role is StaffRole {
  return typeof role === "string" && (STAFF_ROLES as readonly string[]).includes(role);
}
export function supportScope(actor: { id: string; role: string }) {
  return hasPermission(actor.role, "operations") ? {} : hasPermission(actor.role, "support.manage") ? { isEmergency: false } : { isEmergency: false, OR: [{ assignedAdminId: actor.id }, { assignedAdminId: null }] };
}
export const REVIEW_CASE_KINDS = ["SAFETY", "FINANCE"] as const;
export const isReviewCaseKind = (kind: unknown): kind is typeof REVIEW_CASE_KINDS[number] =>
  typeof kind === "string" && (REVIEW_CASE_KINDS as readonly string[]).includes(kind);

export function caseScope(actor: { id: string; role: string }) {
  if (hasPermission(actor.role, "operations")) return { kind: { in: [...REVIEW_CASE_KINDS] } };
  if (actor.role === "SUPPORT") return { kind: "SAFETY", createdById: actor.id };
  if (actor.role === "SAFETY") return { kind: "SAFETY" };
  return { id: { in: [] as string[] } };
}
export function canReviewCase(role: string, kind: string) {
  return isReviewCaseKind(kind) && (hasPermission(role, "operations") || kind === "SAFETY" && hasPermission(role, "safety"));
}
export function caseReviewerRoles(kind: string): ("ADMIN" | "SAFETY")[] {
  return kind === "SAFETY" ? ["SAFETY", "ADMIN"] : ["ADMIN"];
}
