"use client";

// Listens for the browser's "this can be installed as an app" signal.
// Only fires on browsers/OSes that support installable PWAs (mainly
// Chrome/Edge on Android, and some desktop Chromium browsers) — Safari on
// iOS doesn't support this event at all (iOS users install via
// Share → Add to Home Screen instead, which can't be triggered by JS).

import { useEffect, useState } from "react";
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
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
    }

    // The event may have already fired (and been captured by an inline
    // script in <head>) before this component even mounted — pick it up
    // immediately if so.
    if (window.__deferredInstallPrompt__) {
      setDeferredPrompt(window.__deferredInstallPrompt__);
    }

    const pickUpCaptured = () => {
      if (window.__deferredInstallPrompt__) {
        setDeferredPrompt(window.__deferredInstallPrompt__);
      }
    };
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
      window.__deferredInstallPrompt__ = undefined;
    };

    // Fired by the early inline script the instant it captures the event.
    window.addEventListener("fetchit:install-ready", pickUpCaptured);
    // Also listen directly, in case this component happens to mount
    // before the browser fires the event at all.
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("fetchit:install-ready", pickUpCaptured);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const canInstall = !installed && !!deferredPrompt;

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    window.__deferredInstallPrompt__ = undefined;
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
