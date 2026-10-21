"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DISMISSED_KEY = "pwa-install-dismissed";

function subscribeToConnection(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);

  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** True while the browser reports no connection. The server render assumes online. */
export function useIsOffline(): boolean {
  return useSyncExternalStore(subscribeToConnection, () => !navigator.onLine, () => false);
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    /* private mode: the prompt may reappear next visit, which is acceptable */
  }
}

/**
 * Registers the service worker (production only, so development never serves stale files), tells visitors when
 * they are offline or a new version is ready, and offers installation where the browser supports it.
 */
export function PwaClient() {
  const offline = useIsOffline();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    // A first install also fires controllerchange (the worker claims the page); only an update should reload.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    const onControllerChange = () => {
      if (reloading || !hadController) return;
      reloading = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker);
          });
        });
      })
      .catch(() => {
        /* the site works without a worker; there is nothing to tell the visitor */
      });

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  useEffect(() => {
    if (readDismissed()) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "dismissed") rememberDismissed();
    setInstallEvent(null);
  }, [installEvent]);

  const dismissInstall = useCallback(() => {
    rememberDismissed();
    setInstallEvent(null);
  }, []);

  if (!offline && !waiting && !installEvent) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 p-3">
      {offline && (
        <p role="status" className="pointer-events-auto rounded-md bg-foreground px-4 py-2 text-sm text-background shadow">
          You are offline. Saved pages still work, but live information such as shipment status may be out of date.
        </p>
      )}
      {waiting && (
        <div role="status" className="pointer-events-auto flex items-center gap-3 rounded-md border bg-background px-4 py-2 text-sm shadow">
          <span>A new version is available.</span>
          <Button size="sm" onClick={() => waiting.postMessage("SKIP_WAITING")}>Update</Button>
        </div>
      )}
      {installEvent && !offline && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-md border bg-background px-4 py-2 text-sm shadow">
          <span>Install this app for quicker access.</span>
          <Button size="sm" onClick={install}>Install</Button>
          <Button size="sm" variant="ghost" onClick={dismissInstall}>Not now</Button>
        </div>
      )}
    </div>
  );
}
