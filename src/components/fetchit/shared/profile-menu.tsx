"use client";

// The avatar in the header opens this menu. It bundles the account
// actions that don't need their own dedicated page: settings,
// notifications, installing the app, and logging out. Settings and
// Notifications open their own small dialogs so nothing here needs a
// separate route.

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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings, Bell, Download, LogOut, BellOff } from "lucide-react";
import { useInstallPrompt } from "./install-pwa-button";

export function ProfileMenu({
  name,
  email,
  roleLabel,
  onLogout,
}: {
  name?: string | null;
  email?: string | null;
  roleLabel?: string;
  onLogout: () => void;
}) {
  const { canInstall, install } = useInstallPrompt();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [smsNotifs, setSmsNotifs] = useState(false);

  const initial = name?.[0]?.toUpperCase() ?? "?";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4" /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNotificationsOpen(true)}>
            <Bell className="h-4 w-4" /> Notifications
          </DropdownMenuItem>
          {canInstall && (
            <DropdownMenuItem onClick={install}>
              <Download className="h-4 w-4" /> Install app
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onLogout} className="text-destructive focus:text-destructive">
            <LogOut className="h-4 w-4" /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Settings */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" /> Settings
            </DialogTitle>
            <DialogDescription>Your account and notification preferences.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">{name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium">{email ?? "—"}</span>
              </div>
              {roleLabel && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Account type</span>
                  <span className="font-medium">{roleLabel}</span>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="email-notifs" className="font-normal">Email notifications</Label>
                <Switch id="email-notifs" checked={emailNotifs} onCheckedChange={setEmailNotifs} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="sms-notifs" className="font-normal">SMS notifications</Label>
                <Switch id="sms-notifs" checked={smsNotifs} onCheckedChange={setSmsNotifs} />
              </div>
              <p className="text-xs text-muted-foreground">
                These preferences apply to this session only for now.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Notifications */}
      <Dialog open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" /> Notifications
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <BellOff className="h-8 w-8" />
            <p className="text-sm">No notifications yet.</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
