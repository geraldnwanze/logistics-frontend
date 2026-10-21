import { z } from "zod";

export const profileSchema = z.object({
  phone: z.string().nullable(),
  locale: z.string(),
  timezone: z.string(),
  preferred_currency: z.string(),
  deletion_requested: z.boolean().optional(),
});

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  email_verified: z.boolean(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()).default([]),
  two_factor_enabled: z.boolean(),
  profile: profileSchema.nullish(),
});

export const userResponseSchema = z.object({ data: userSchema });

export const twoFactorStatusSchema = z.object({
  enabled: z.boolean(),
  pending_setup: z.boolean(),
  required: z.boolean(),
  recovery_codes_remaining: z.number().nullable(),
});

export const twoFactorSetupSchema = z.object({ secret: z.string(), uri: z.string() });
export const recoveryCodesSchema = z.object({ recovery_codes: z.array(z.string()) });

export type User = z.infer<typeof userSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type TwoFactorStatus = z.infer<typeof twoFactorStatusSchema>;
