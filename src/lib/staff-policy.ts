// Shared permission vocabulary. Owner credentials never authenticate to the staff portal.
export const STAFF_ROLES = ["ADMIN", "SUPPORT", "SAFETY", "SUPPORT_SUPERVISOR"] as const;
export type StaffRole = typeof STAFF_ROLES[number];
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin", SUPPORT: "Support Staff", FINANCE: "Retired Finance role — reassign access", SAFETY: "Safety Review Staff",
  SUPPORT_SUPERVISOR: "Support Supervisor", SUPERADMIN: "Superadmin",
};
export type Permission = "operations" | "support" | "support.manage" | "finance" | "safety" | "resources.edit";
const grants: Record<string, readonly Permission[]> = {
  SUPERADMIN: ["operations", "support", "support.manage", "finance", "safety", "resources.edit"],
  ADMIN: ["operations", "support", "support.manage", "finance", "safety", "resources.edit"],
  SUPPORT: ["support"], SUPPORT_SUPERVISOR: ["support", "support.manage", "resources.edit"],
  SAFETY: ["safety"],
};
export function hasPermission(role: string, permission: Permission) {
  return !!grants[role]?.includes(permission);
}
export function isStaffRole(role: unknown): role is StaffRole {
  return typeof role === "string" && (STAFF_ROLES as readonly string[]).includes(role);
}
// Keep retired accounts manageable without allowing them to authenticate or be assigned again.
export function isManagedStaffRole(role: unknown) { return isStaffRole(role) || role === "FINANCE"; }
export function supportScope(actor: { id: string; role: string }) {
  return hasPermission(actor.role, "support.manage") ? {} : { OR: [{ assignedAdminId: actor.id }, { assignedAdminId: null }] };
}
export function caseScope(actor: { id: string; role: string }) {
  if (hasPermission(actor.role, "operations")) return {};
  if (actor.role === "SUPPORT") return { createdById: actor.id };
  if (actor.role === "SUPPORT_SUPERVISOR") return { OR: [{ kind: "ESCALATION" }, { createdById: actor.id }] };
  if (actor.role === "SAFETY") return { kind: "SAFETY" };
  return { id: { in: [] as string[] } };
}
export function canReviewCase(role: string, kind: string) {
  return hasPermission(role, "operations") || kind === "ESCALATION" && hasPermission(role, "support.manage") || kind === "SAFETY" && hasPermission(role, "safety");
}
export function caseReviewerRoles(kind: string): ("ADMIN" | "SAFETY" | "SUPPORT_SUPERVISOR")[] {
  return kind === "SAFETY" ? ["SAFETY", "ADMIN"] : kind === "ESCALATION" ? ["SUPPORT_SUPERVISOR", "ADMIN"] : ["ADMIN"];
}
