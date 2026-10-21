import { z } from "zod";
import { ApiError, apiRequest } from "@/lib/api/client";
import {
  recoveryCodesSchema, twoFactorSetupSchema, twoFactorStatusSchema, userResponseSchema,
  type TwoFactorStatus, type User,
} from "./schemas";

const wrapped = <S extends z.ZodType>(schema: S) => z.object({ data: schema });

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(502, "unexpected_response", "The server sent something we didn't expect. Please try again.");

  return result.data;
}

export type LoginOutcome = { kind: "signed-in"; user: User } | { kind: "two-factor" };

export async function login(email: string, password: string): Promise<LoginOutcome> {
  const { status, body } = await apiRequest("/auth/login", { method: "POST", body: { email, password } });

  if (status === 202) return { kind: "two-factor" };

  return { kind: "signed-in", user: parse(userResponseSchema, body).data };
}

export async function completeTwoFactor(input: { code: string } | { recovery_code: string }): Promise<User> {
  const { body } = await apiRequest("/auth/two-factor/challenge", { method: "POST", body: input });

  return parse(userResponseSchema, body).data;
}

export type RegisterInput = { name: string; email: string; phone?: string; password: string; password_confirmation: string };

export async function register(input: RegisterInput): Promise<User> {
  const { body } = await apiRequest("/auth/register", { method: "POST", body: { ...input, phone: input.phone || undefined } });

  return parse(userResponseSchema, body).data;
}

/** Null when nobody is signed in. Any other failure still throws. */
export async function fetchCurrentUser(signal?: AbortSignal): Promise<User | null> {
  try {
    const { body } = await apiRequest("/me", { signal });

    return parse(userResponseSchema, body).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;

    throw error;
  }
}

export async function logout(): Promise<void> {
  await apiRequest("/auth/logout", { method: "POST" });
}

export async function requestPasswordReset(email: string): Promise<void> {
  await apiRequest("/auth/forgot-password", { method: "POST", body: { email } });
}

export async function resetPassword(input: { email: string; token: string; password: string; password_confirmation: string }): Promise<void> {
  await apiRequest("/auth/reset-password", { method: "POST", body: input });
}

export async function resendVerification(): Promise<void> {
  await apiRequest("/auth/email/resend", { method: "POST" });
}

export async function fetchTwoFactorStatus(): Promise<TwoFactorStatus> {
  return parse(wrapped(twoFactorStatusSchema), (await apiRequest("/auth/two-factor")).body).data;
}

export async function beginTwoFactorSetup(): Promise<{ secret: string; uri: string }> {
  return parse(wrapped(twoFactorSetupSchema), (await apiRequest("/auth/two-factor/setup", { method: "POST" })).body).data;
}

export async function confirmTwoFactor(code: string): Promise<string[]> {
  return parse(wrapped(recoveryCodesSchema), (await apiRequest("/auth/two-factor/confirm", { method: "POST", body: { code } })).body).data.recovery_codes;
}

export async function regenerateRecoveryCodes(password: string): Promise<string[]> {
  return parse(wrapped(recoveryCodesSchema), (await apiRequest("/auth/two-factor/recovery-codes", { method: "POST", body: { password } })).body).data.recovery_codes;
}

export async function disableTwoFactor(input: { password: string; code?: string; recovery_code?: string }): Promise<void> {
  await apiRequest("/auth/two-factor", { method: "DELETE", body: input });
}
