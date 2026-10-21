import { z } from "zod";
import { apiRequest } from "@/lib/api/client";
import { userResponseSchema, type User } from "@/lib/auth/schemas";

const currencySchema = z.object({ code: z.string(), name: z.string(), symbol: z.string() });
export type Currency = z.infer<typeof currencySchema>;

export type ProfileOptions = { languages: string[]; currencies: Currency[] };
export type ProfilePatch = Partial<{ name: string; phone: string | null; locale: string; timezone: string; preferred_currency: string }>;

/** What the business has switched on: the languages and currencies a customer may choose between. */
export async function fetchProfileOptions(): Promise<ProfileOptions> {
  const [settings, currencies] = await Promise.all([apiRequest<unknown>("/public/settings"), apiRequest<unknown>("/public/currencies")]);

  return {
    languages: z.object({ data: z.object({ general: z.object({ enabled_languages: z.array(z.string()).min(1) }) }) }).parse(settings.body).data.general.enabled_languages,
    currencies: z.object({ data: z.array(currencySchema) }).parse(currencies.body).data,
  };
}

export async function updateProfile(patch: ProfilePatch): Promise<User> {
  const { body } = await apiRequest("/me", { method: "PATCH", body: patch });

  return userResponseSchema.parse(body).data;
}

export async function changePassword(input: { current_password: string; password: string; password_confirmation: string }): Promise<void> {
  await apiRequest("/me/password", { method: "PUT", body: input });
}

export async function exportMyData(): Promise<unknown> {
  return (await apiRequest<{ data: unknown }>("/me/export")).body.data;
}

export async function requestAccountDeletion(): Promise<void> {
  await apiRequest("/me/deletion-request", { method: "POST" });
}
