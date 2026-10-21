import { z } from "zod";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { Paged } from "@/lib/shipping/schemas";

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(502, "unexpected_response", "The server sent something we didn't expect. Please try again.");

  return result.data;
}

export const SUPER_ADMIN = "super-admin";

export const staffRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  roles: z.array(z.string()),
  status: z.enum(["active", "suspended"]),
  two_factor_enabled: z.boolean(),
  suspended_at: z.string().nullable(),
  created_at: z.string(),
});
export type StaffRow = z.infer<typeof staffRowSchema>;

export const staffDetailSchema = staffRowSchema.extend({ permissions: z.array(z.string()).default([]) });
export type StaffDetail = z.infer<typeof staffDetailSchema>;

export const roleSchema = z.object({ name: z.string(), grants_everything: z.boolean(), permissions: z.array(z.string()) });
export type Role = z.infer<typeof roleSchema>;

export type StaffFilters = { role?: string; status?: string; q?: string; page?: number };

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();

  return text ? `?${text}` : "";
}

export async function fetchStaff(filters: StaffFilters, signal?: AbortSignal): Promise<Paged<StaffRow>> {
  const { body } = await apiRequest(`/admin/staff${query({ ...filters, page: filters.page && filters.page > 1 ? filters.page : undefined })}`, { signal });
  const result = parse(z.object({ data: z.array(staffRowSchema), meta: z.object({ total: z.number(), last_page: z.number() }) }), body);

  return { items: result.data, page: filters.page ?? 1, lastPage: result.meta.last_page, total: result.meta.total };
}

export async function fetchStaffMember(id: string, signal?: AbortSignal): Promise<StaffDetail> {
  return parse(z.object({ data: staffDetailSchema }), (await apiRequest(`/admin/staff/${encodeURIComponent(id)}`, { signal })).body).data;
}

export async function fetchRoles(signal?: AbortSignal): Promise<Role[]> {
  return parse(z.object({ data: z.array(roleSchema) }), (await apiRequest("/admin/roles", { signal })).body).data;
}

/** Creates the account with an unusable password and emails a link to choose one. */
export async function inviteStaff(input: { name: string; email: string; roles: string[] }): Promise<StaffDetail> {
  return parse(z.object({ data: staffDetailSchema }), (await apiRequest("/admin/staff", { method: "POST", body: input })).body).data;
}

export async function changeRoles(id: string, roles: string[]): Promise<StaffDetail> {
  return parse(z.object({ data: staffDetailSchema }), (await apiRequest(`/admin/staff/${encodeURIComponent(id)}/roles`, { method: "PUT", body: { roles } })).body).data;
}

export async function suspendStaff(id: string): Promise<StaffRow> {
  return parse(z.object({ data: staffRowSchema }), (await apiRequest(`/admin/staff/${encodeURIComponent(id)}/suspend`, { method: "POST" })).body).data;
}

export async function reactivateStaff(id: string): Promise<StaffRow> {
  return parse(z.object({ data: staffRowSchema }), (await apiRequest(`/admin/staff/${encodeURIComponent(id)}/reactivate`, { method: "POST" })).body).data;
}

export async function sendStaffPasswordReset(id: string): Promise<void> {
  await apiRequest(`/admin/staff/${encodeURIComponent(id)}/password-reset`, { method: "POST" });
}

export async function resetStaffTwoFactor(id: string): Promise<StaffRow> {
  return parse(z.object({ data: staffRowSchema }), (await apiRequest(`/admin/staff/${encodeURIComponent(id)}/two-factor/reset`, { method: "POST" })).body).data;
}

/** "customer-support-agent" becomes "Customer support agent". */
export function roleLabel(name: string): string {
  const text = name.replace(/-/g, " ");

  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What changes if these roles are saved, in the order a person reads it. */
export function roleChanges(before: string[], after: string[]): { added: string[]; removed: string[] } {
  return { added: after.filter((r) => !before.includes(r)).sort(), removed: before.filter((r) => !after.includes(r)).sort() };
}

export const ERROR_TEXT: Record<string, string> = {
  cannot_change_self: "You can't change your own access. Ask another administrator.",
  super_admin_only: "Only a super administrator can do this for a super administrator.",
  last_super_admin: "There must always be at least one active super administrator, so this can't be done to the last one.",
  email_taken: "An account with this email already exists.",
};
