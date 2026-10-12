"use client";

// Listens for the browser's "this can be installed as an app" signal.
// Only fires on browsers/OSes that support installable PWAs (mainly
// Chrome/Edge on Android, and some desktop Chromium browsers) — Safari on
// iOS doesn't support this event at all (iOS users install via
// Share → Add to Home Screen instead, which can't be triggered by JS).

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __deferredInstallPrompt__?: BeforeInstallPromptEvent;
  }
}

/** Shared logic so any component (a button, a menu item, ...) can offer
 * the install prompt without duplicating the event-listener plumbing. */
function subscribeInstallPrompt(notify: () => void) {
  const onBeforeInstall = (event: Event) => {
    event.preventDefault();
    window.__deferredInstallPrompt__ = event as BeforeInstallPromptEvent;
    notify();
  };
  const onInstalled = () => {
    window.__deferredInstallPrompt__ = undefined;
    notify();
  };
  const displayMode = window.matchMedia("(display-mode: standalone)");
  window.addEventListener("fetchit:install-ready", notify);
  window.addEventListener("beforeinstallprompt", onBeforeInstall);
  window.addEventListener("appinstalled", onInstalled);
  displayMode.addEventListener("change", notify);
  return () => {
    window.removeEventListener("fetchit:install-ready", notify);
    window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    window.removeEventListener("appinstalled", onInstalled);
    displayMode.removeEventListener("change", notify);
  };
}

function readInstallPrompt() {
  return window.matchMedia("(display-mode: standalone)").matches ? null : window.__deferredInstallPrompt__ ?? null;
}

export function useInstallPrompt() {
  // All install controls share the browser's one-use prompt, including an
  // event captured before React mounted. Consuming it updates every control.
  const deferredPrompt = useSyncExternalStore(subscribeInstallPrompt, readInstallPrompt, () => null);
  const canInstall = !!deferredPrompt;

  async function install() {
    if (!deferredPrompt || readInstallPrompt() !== deferredPrompt) return;
    // Consume before awaiting to prevent another control prompting twice.
    window.__deferredInstallPrompt__ = undefined;
    window.dispatchEvent(new Event("fetchit:install-ready"));
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
  }

  return { canInstall, install };
}

export function InstallPwaButton({
  className,
  iconOnly = false,
}: {
  className?: string;
  iconOnly?: boolean;
}) {
  const { canInstall, install } = useInstallPrompt();
  if (!canInstall) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size={iconOnly ? "icon" : "sm"}
      onClick={install}
      className={className}
      aria-label="Install app"
      title="Install app"
    >
      <Download className="h-4 w-4" />
      {!iconOnly && "Install app"}
    </Button>
  );
}
