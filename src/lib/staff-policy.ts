// Shared permission vocabulary. Owner credentials never authenticate to the staff portal.
export const STAFF_ROLES = ["ADMIN", "SUPPORT", "FINANCE", "SAFETY", "SUPPORT_SUPERVISOR"] as const;
export type StaffRole = typeof STAFF_ROLES[number];
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin", SUPPORT: "Support Staff", FINANCE: "Finance Staff", SAFETY: "Safety Review Staff",
  SUPPORT_SUPERVISOR: "Support Supervisor", SUPERADMIN: "Superadmin",
};
export type Permission = "operations" | "support" | "support.manage" | "finance" | "safety" | "resources.edit";
const grants: Record<string, readonly Permission[]> = {
  ADMIN: ["operations", "support", "support.manage", "finance", "safety", "resources.edit"],
  SUPPORT: ["support"], SUPPORT_SUPERVISOR: ["support", "support.manage", "resources.edit"],
  FINANCE: ["finance"], SAFETY: ["safety"],
};
export function hasPermission(role: string, permission: Permission) {
  return role === "SUPERADMIN" || !!grants[role]?.includes(permission);
}
export function isStaffRole(role: unknown): role is StaffRole {
  return typeof role === "string" && (STAFF_ROLES as readonly string[]).includes(role);
}
export function supportScope(actor: { id: string; role: string }) {
  return hasPermission(actor.role, "support.manage") ? {} : { OR: [{ assignedAdminId: actor.id }, { assignedAdminId: null }] };
}
export function caseScope(actor: { id: string; role: string }) {
  if (hasPermission(actor.role, "operations")) return {};
  const kinds = actor.role === "FINANCE" ? ["FINANCE"] : actor.role === "SAFETY" ? ["SAFETY"] : ["ESCALATION"];
  return { kind: { in: kinds }, ...(actor.role === "SUPPORT_SUPERVISOR" ? {} : { OR: [{ assignedToId: actor.id }, { assignedToId: null }, { createdById: actor.id }] }) };
}
