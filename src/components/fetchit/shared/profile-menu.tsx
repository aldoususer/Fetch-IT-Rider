"use client";

// The avatar in the header opens this menu. It bundles the account
// actions that don't need their own dedicated page: account details,
// installing the app, and logging out.

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Settings, Download, LogOut, UserRound } from "lucide-react";
import { useInstallPrompt } from "./install-pwa-button";

export function ProfileMenu({
  name,
  email,
  roleLabel,
  onLogout,
  onViewProfile,
}: {
  name?: string | null;
  email?: string | null;
  roleLabel?: string;
  onLogout: () => void;
  onViewProfile?: () => void;
}) {
  const { canInstall, install, standalone } = useInstallPrompt();
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const initial = name?.[0]?.toUpperCase() ?? "?";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="size-12 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open profile menu"
          >
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/15 text-primary font-semibold">
                {initial}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col">
              <span className="text-sm font-medium truncate">{name ?? "Account"}</span>
              <span className="text-xs text-muted-foreground truncate">{email}</span>
              {roleLabel && <span className="text-xs text-muted-foreground">{roleLabel}</span>}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {onViewProfile && <DropdownMenuItem className="min-h-12" onSelect={onViewProfile}><UserRound className="h-4 w-4"/> Rider profile</DropdownMenuItem>}
          <DropdownMenuItem className="min-h-12" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4" /> Account details
          </DropdownMenuItem>
          {!standalone && (
            <DropdownMenuItem className="min-h-12" onSelect={() => {
              if (canInstall) void install().catch(() => setInstallHelpOpen(true));
              else setInstallHelpOpen(true);
            }}>
              <Download className="h-4 w-4" /> Install app
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onLogout} className="min-h-12 text-destructive focus:text-destructive">
            <LogOut className="h-4 w-4" /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={installHelpOpen} onOpenChange={setInstallHelpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="pr-10 text-left">
            <DialogTitle>Install Fetch-It Rider</DialogTitle>
            <DialogDescription>Add Rider to your Home Screen for quick access to jobs.</DialogDescription>
          </DialogHeader>
          <dl className="space-y-4 text-sm leading-relaxed">
            <div><dt className="font-semibold">iPhone or iPad</dt><dd>Open Rider in Safari. Tap Share, then Add to Home Screen.</dd></div>
            <div><dt className="font-semibold">Android</dt><dd>Open the browser menu and choose Install app or Add to Home screen.</dd></div>
            <div><dt className="font-semibold">Desktop</dt><dd>Look for Install in the address bar or browser menu.</dd></div>
          </dl>
        </DialogContent>
      </Dialog>

      {/* Settings */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" /> Account details
            </DialogTitle>
            <DialogDescription>Your registered account information.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="min-w-0 rounded-md border p-3 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Name</span>
                <span className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{name ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Email</span>
                <span className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{email ?? "—"}</span>
              </div>
              {roleLabel && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Account type</span>
                  <span className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{roleLabel}</span>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}
