"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { forgetGuestTokens } from "@/lib/shipping/guest";
import { forgetSupportTokens } from "@/lib/support/tokens";
import { clearSaved } from "@/lib/tracking/saved";
import { fetchCurrentUser, logout } from "./api";
import type { User } from "./schemas";

const HINT_KEY = "signed-in-hint";
export const CURRENT_USER_KEY = ["me"] as const;

/**
 * A harmless flag (no identity) saying "this browser signed in recently", so anonymous visitors on public pages
 * don't call /me on every page view. The session itself lives in an HttpOnly cookie the page cannot read.
 */
export function hasSignedInHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSignedInHint(on: boolean): void {
  try {
    if (on) localStorage.setItem(HINT_KEY, "1");
    else localStorage.removeItem(HINT_KEY);
  } catch {
    /* storage blocked: the account page still checks the session directly */
  }
}

/** Removes what this device saved for the signed-in person: saved tracking and the service worker's page copies. */
export async function clearOfflineData(): Promise<void> {
  clearSaved();
  forgetGuestTokens();
  forgetSupportTokens();

  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    registration?.active?.postMessage("CLEAR_CACHES");
  } catch {
    /* no service worker: nothing else to clear */
  }
}

/** `force` checks the session even without the hint (account and sign-in pages). */
export function useCurrentUser({ force = false }: { force?: boolean } = {}) {
  return useQuery<User | null>({
    queryKey: CURRENT_USER_KEY,
    queryFn: async ({ signal }) => {
      const user = await fetchCurrentUser(signal);
      setSignedInHint(user !== null);

      return user;
    },
    enabled: force || hasSignedInHint(),
    staleTime: 60_000,
    retry: false,
  });
}

export function useSessionActions() {
  const client = useQueryClient();

  const signedIn = useCallback((user: User) => {
    setSignedInHint(true);
    client.setQueryData(CURRENT_USER_KEY, user);
  }, [client]);

  const signOut = useCallback(async () => {
    // If the server can't be told, the session may still be alive, so nothing is cleared and the error reaches the caller.
    await logout();
    setSignedInHint(false);
    client.clear();
    await clearOfflineData();
  }, [client]);

  return { signedIn, signOut };
}

/** Only same-site paths: never send someone to an address a link supplied. */
export function safeNextPath(value: string | null | undefined, fallback = "/account"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return fallback;

  return value;
}
