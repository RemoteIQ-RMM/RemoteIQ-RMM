// remoteiq-frontend/app/account/tabs/SecurityTab.tsx
"use client";

import * as React from "react";
import Image from "next/image";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  changePasswordSelf,
  confirm2FA,
  disable2FA,
  getSecurityOverview,
  regenerateRecoveryCodes,
  start2FA,
} from "@/lib/api";
import { useToast } from "@/lib/toast";
import {
  Ban,
  KeyRound,
  LockKeyhole,
  Loader2,
  QrCode,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

type Props = {
  onDirtyChange: (dirty: boolean) => void;
  saveHandleRef: (h: { submit: () => void }) => void;
};

// ---- Small date helper (kept for future use) ----
const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return dateFmt.format(new Date(iso));
  } catch {
    return iso as string;
  }
}

// ---- Helpers ----
function normalizeTotp(v: string) {
  return v.replace(/\s+/g, "").replace(/[^\d]/g, "").slice(0, 6);
}
function errMsg(err: any, fallback = "Request failed") {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  if (typeof err?.message === "string") return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return fallback;
  }
}

export default function SecurityTab({ onDirtyChange, saveHandleRef }: Props) {
  const { push } = useToast();

  // aria live region for small state changes
  const [liveMessage, setLiveMessage] = React.useState("");

  // Track "dirty" for the page chrome; only the password form can be dirty
  const [isDirty, setIsDirty] = React.useState(false);
  React.useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);
  React.useEffect(() => {
    saveHandleRef({ submit: () => void 0 });
  }, [saveHandleRef]);

  const [loading, setLoading] = React.useState(true);
  const [twoFAEnabled, setTwoFAEnabled] = React.useState(false);

  // Password form
  const [currentPwd, setCurrentPwd] = React.useState("");
  const [newPwd, setNewPwd] = React.useState("");
  const [confirmPwd, setConfirmPwd] = React.useState("");
  const [pwdBusy, setPwdBusy] = React.useState(false);

  // Two-factor
  const [twoFaBusy, setTwoFaBusy] = React.useState<"start" | "confirm" | "disable" | "regen" | null>(null);
  const [startData, setStartData] = React.useState<{
    secret: string;
    otpauthUrl: string;
    qrPngDataUrl: string;
  } | null>(null);
  const [totpOpen, setTotpOpen] = React.useState(false);
  const [totpCode, setTotpCode] = React.useState("");
  const [recoveryOpen, setRecoveryOpen] = React.useState(false);
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([]);
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [disableWith, setDisableWith] = React.useState<"totp" | "recovery">("totp");
  const [disableTotp, setDisableTotp] = React.useState("");
  const [disableRecovery, setDisableRecovery] = React.useState("");

  // Load 2FA status on mount
  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const ov = await getSecurityOverview();
        setTwoFAEnabled(!!ov.twoFactorEnabled);
      } catch (err) {
        console.error(err);
        push({ title: "Failed to load security", kind: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [push]);

  // Track password dirtiness
  React.useEffect(() => {
    const dirty = Boolean(currentPwd || newPwd || confirmPwd);
    setIsDirty(dirty);
  }, [currentPwd, newPwd, confirmPwd]);

  // -------------------- Password change --------------------
  const PASSWORD_MIN_LEN = Math.max(
    8,
    Number(process.env.NEXT_PUBLIC_PASSWORD_MIN_LEN || 8)
  );
  const canChangePwd =
    currentPwd.length >= 1 &&
    newPwd.length >= PASSWORD_MIN_LEN &&
    newPwd === confirmPwd &&
    newPwd !== currentPwd;

  async function onChangePassword() {
    if (!canChangePwd) return;
    setPwdBusy(true);
    try {
      await changePasswordSelf(currentPwd, newPwd);
      push({ title: "Password changed", kind: "success" });
      setLiveMessage("Password changed");
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (err: any) {
      push({ title: errMsg(err, "Failed to change password"), kind: "destructive" });
    } finally {
      setPwdBusy(false);
    }
  }

  // -------------------- 2FA: start/confirm/disable --------------------
  async function onStart2FA() {
    setTwoFaBusy("start");
    try {
      const data = await start2FA();
      setStartData(data);
      setTotpOpen(true);
    } catch (err: any) {
      push({ title: errMsg(err, "Failed to start 2FA"), kind: "destructive" });
    } finally {
      setTwoFaBusy(null);
    }
  }

  async function onConfirm2FA() {
    const code = normalizeTotp(totpCode);
    if (!code || code.length !== 6) {
      push({ title: "Please enter a 6-digit code", kind: "destructive" });
      return;
    }
    setTwoFaBusy("confirm");
    try {
      await confirm2FA({ code });
      const codes = await regenerateRecoveryCodes();
      setRecoveryCodes(codes);
      setTwoFAEnabled(true);
      setTotpOpen(false);
      setRecoveryOpen(true);
      setTotpCode("");
      setStartData(null);
      setLiveMessage("Two-factor enabled");
      push({ title: "Two-factor enabled", kind: "success" });
    } catch (err: any) {
      push({ title: errMsg(err, "Invalid code"), kind: "destructive" });
    } finally {
      setTwoFaBusy(null);
    }
  }

  async function onDisable2FA() {
    setTwoFaBusy("disable");
    try {
      const payload =
        disableWith === "totp"
          ? { code: normalizeTotp(disableTotp) }
          : { recoveryCode: disableRecovery.trim() };
      await disable2FA(payload);
      setTwoFAEnabled(false);
      setDisableTotp("");
      setDisableRecovery("");
      setDisableOpen(false);
      setLiveMessage("Two-factor disabled");
      push({ title: "Two-factor disabled", kind: "success" });
    } catch (err: any) {
      push({ title: errMsg(err, "Failed to disable 2FA"), kind: "destructive" });
    } finally {
      setTwoFaBusy(null);
    }
  }

  async function onRegenRecovery() {
    setTwoFaBusy("regen");
    try {
      const codes = await regenerateRecoveryCodes();
      setRecoveryCodes(codes);
      setRecoveryOpen(true);
      push({ title: "New recovery codes generated", kind: "success" });
    } catch (err: any) {
      push({ title: errMsg(err, "Failed to regenerate codes"), kind: "destructive" });
    } finally {
      setTwoFaBusy(null);
    }
  }

  // ---- Recovery codes actions: Copy & Download ----
  const copyRecoveryCodes = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      push({ title: "Recovery codes copied", kind: "success" });
    } catch {
      push({ title: "Failed to copy codes", kind: "destructive" });
    }
  }, [recoveryCodes, push]);

  const downloadRecoveryCodes = React.useCallback(() => {
    if (!recoveryCodes.length) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const filename = `recovery-codes-${y}${m}${d}.txt`;

    const header = `RemoteIQ Recovery Codes
Generated: ${now.toISOString()}
Each code can be used once. Store these somewhere safe.

`;
    const body = recoveryCodes
      .map((c, i) => `${String(i + 1).padStart(2, "0")}. ${c}`)
      .join("\n");
    const blob = new Blob([header, body, "\n"], {
      type: "text/plain;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [recoveryCodes]);

  if (loading) {
    return (
      <Card>
        <CardContent className="h-32 animate-pulse" />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* aria-live region for subtle updates */}
      <div className="sr-only" aria-live="polite">
        {liveMessage}
      </div>

      {/* Password */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Password
          </CardTitle>
          <CardDescription>
            Change your password and keep your account secure.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2 space-y-4">
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="current">Current password</Label>
              <Input
                id="current"
                type="password"
                autoComplete="current-password"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new">New password</Label>
              <Input
                id="new"
                type="password"
                autoComplete="new-password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder={`At least ${PASSWORD_MIN_LEN} characters`}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-2 text-sm">
                <LockKeyhole className="h-4 w-4" />
                <span>
                  Tip: sign out of other sessions after changing your password.
                </span>
              </div>
              <Button
                disabled={!canChangePwd || pwdBusy}
                onClick={onChangePassword}
                aria-label="Change Password"
              >
                {pwdBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Change Password
              </Button>
            </div>
          </div>

          <div className="rounded-md border p-3 text-xs text-muted-foreground flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 mt-0.5" />
            Recommendations: Enable 2FA, rotate passwords periodically, and keep
            your recovery codes safe.
          </div>
        </CardContent>
      </Card>

      {/* Two-Factor Authentication */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Two-factor authentication
          </CardTitle>
          <CardDescription>
            Use an authenticator app for a second layer of protection.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <div className="font-medium">Status</div>
              <div className="text-xs text-muted-foreground">
                {twoFAEnabled ? "Enabled" : "Disabled"}
              </div>
            </div>
            <Switch
              checked={twoFAEnabled}
              disabled={twoFaBusy !== null}
              onCheckedChange={(checked) => {
                if (checked) onStart2FA();
                else setDisableOpen(true);
              }}
              aria-label="Toggle two factor"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {!twoFAEnabled ? (
              <Button onClick={onStart2FA} disabled={twoFaBusy !== null}>
                {twoFaBusy === "start" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <QrCode className="mr-2 h-4 w-4" />
                )}
                Enable 2FA
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={onRegenRecovery}
                  disabled={twoFaBusy !== null}
                >
                  {twoFaBusy === "regen" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="mr-2 h-4 w-4" />
                  )}
                  Regenerate recovery codes
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setDisableOpen(true)}
                  disabled={twoFaBusy !== null}
                >
                  {twoFaBusy === "disable" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Ban className="mr-2 h-4 w-4" />
                  )}
                  Disable 2FA
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialog: TOTP confirm (after start) */}
      <Dialog
        open={totpOpen}
        onOpenChange={(o) => {
          setTotpOpen(o);
          if (!o) {
            setTotpCode("");
            setStartData(null);
          }
        }}
      >
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onConfirm2FA();
            }}
          >
            <DialogHeader>
              <DialogTitle>Scan the QR code</DialogTitle>
              <DialogDescription>
                Scan in your authenticator app, then enter a 6-digit code to
                confirm.
              </DialogDescription>
            </DialogHeader>
            {startData ? (
              <div className="space-y-3">
                <div className="flex items-center justify-center">
                  <Image
                    src={startData.qrPngDataUrl}
                    alt="Scan this QR code in your authenticator app"
                    width={220}
                    height={220}
                    className="rounded-md border"
                  />
                </div>
                <div className="text-xs text-muted-foreground break-all">
                  Secret:{" "}
                  <span className="font-mono">{startData.secret}</span>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="totp">6-digit code</Label>
                  <Input
                    id="totp"
                    inputMode="numeric"
                    pattern="\d{6}"
                    placeholder="123456"
                    value={totpCode}
                    onChange={(e) => setTotpCode(normalizeTotp(e.target.value))}
                  />
                </div>
              </div>
            ) : null}
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTotpOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={twoFaBusy === "confirm"}>
                {twoFaBusy === "confirm" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                Confirm
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Recovery codes */}
      <Dialog open={recoveryOpen} onOpenChange={setRecoveryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recovery codes</DialogTitle>
            <DialogDescription>
              Store these safely. Each code can be used once.
            </DialogDescription>
          </DialogHeader>

          <div
            className="max-h-64 overflow-auto rounded-md border p-2"
            tabIndex={0}
            onFocus={(e) => {
              // Select-all for quick Ctrl/Cmd+C
              const sel = window.getSelection();
              if (!sel) return;
              const r = document.createRange();
              r.selectNodeContents(e.currentTarget);
              sel.removeAllRanges();
              sel.addRange(r);
            }}
          >
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {recoveryCodes.map((c) => (
                <div key={c} className="rounded-md bg-muted px-2 py-1">
                  {c}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="flex w-full items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={copyRecoveryCodes}
                aria-label="Copy recovery codes"
              >
                Copy
              </Button>
              <Button
                variant="outline"
                onClick={downloadRecoveryCodes}
                disabled={!recoveryCodes.length}
                aria-label="Download recovery codes"
              >
                Download .txt
              </Button>
            </div>
            <Button
              variant="default"
              onClick={() => setRecoveryOpen(false)}
              aria-label="Close"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Disable 2FA */}
      <Dialog
        open={disableOpen}
        onOpenChange={(o) => {
          setDisableOpen(o);
          if (!o) {
            setDisableTotp("");
            setDisableRecovery("");
            setDisableWith("totp");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable two-factor</DialogTitle>
            <DialogDescription>
              Confirm with a TOTP code or a recovery code to disable 2FA.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Button
                variant={disableWith === "totp" ? "default" : "outline"}
                size="sm"
                onClick={() => setDisableWith("totp")}
              >
                Use TOTP
              </Button>
              <Button
                variant={disableWith === "recovery" ? "default" : "outline"}
                size="sm"
                onClick={() => setDisableWith("recovery")}
              >
                Use recovery
              </Button>
            </div>
            {disableWith === "totp" ? (
              <div className="grid gap-2">
                <Label htmlFor="disable-totp">6-digit code</Label>
                <Input
                  id="disable-totp"
                  inputMode="numeric"
                  pattern="\d{6}"
                  placeholder="123456"
                  value={disableTotp}
                  onChange={(e) => setDisableTotp(normalizeTotp(e.target.value))}
                />
              </div>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="disable-rec">Recovery code</Label>
                <Input
                  id="disable-rec"
                  placeholder="ABCD-EFGH-IJKL"
                  value={disableRecovery}
                  onChange={(e) => setDisableRecovery(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onDisable2FA}
              disabled={twoFaBusy === "disable"}
            >
              {twoFaBusy === "disable" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Ban className="mr-2 h-4 w-4" />
              )}
              Disable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
