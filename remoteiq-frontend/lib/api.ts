// Centralized typed API client used by the frontend (Next.js / React).
// It reads NEXT_PUBLIC_API_BASE for the backend base URL.

// ---------------------------- ENV / BASE ------------------------------------
const API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) || "";

// Utility to join base + path safely
function url(path: string) {
  if (!API_BASE) return path;
  return `${API_BASE.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonInit = Omit<RequestInit, "body" | "method"> & {
  body?: any;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
};

// unified fetch wrapper w/ JSON
export async function jfetch<T>(path: string, init: JsonInit = {}): Promise<T> {
  const { body, ...rest } = init;
  const res = await fetch(url(path), {
    method: init.method ?? (body != null ? "POST" : "GET"),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
    ...rest,
  });

  if (!res.ok) {
    // try to surface JSON message; fall back to text
    let msg = "";
    try {
      const data = await res.json();
      msg = typeof (data as any)?.message === "string" ? (data as any).message : JSON.stringify(data);
    } catch {
      try {
        msg = await res.text();
      } catch {
        // ignore
      }
    }
    const err = new Error(msg || `Request failed: ${res.status}`);
    (err as any).status = res.status; // preserve status for caller fallbacks
    throw err;
  }

  if (res.status === 204) return undefined as unknown as T;
  try {
    return (await res.json()) as T;
  } catch {
    // when backend returns 200 with empty body
    return undefined as unknown as T;
  }
}

// ---------------------------------------------------------------------------
// Devices (grid + details)
// ---------------------------------------------------------------------------
// lib/api.ts  (only showing the Device type block; keep the rest as-is)
export type Device = {
  id: string;
  hostname: string;
  os: string;
  arch?: string | null;
  lastSeen?: string | null;
  status: "online" | "offline";
  client?: string | null;
  site?: string | null;
  user?: string | string[] | null;
  version?: string | null;      // <-- add
  primaryIp?: string | null;    // <-- add
  /** Optional UUID for the underlying agent (if backend provides it). */
  agentUuid?: string | null;    // <-- NEW (harmless if absent)
};

export type DevicesResponse = {
  items: Device[];
  nextCursor: string | null;
};

export type DeviceFilters = {
  q?: string;
  status?: "online" | "offline";
  os?: string[];
};

export async function fetchDevices(
  pageSize = 25,
  cursor: string | null = null,
  filters?: DeviceFilters
): Promise<DevicesResponse> {
  const sp = new URLSearchParams();
  sp.set("pageSize", String(pageSize));
  if (cursor) sp.set("cursor", cursor);
  if (filters?.q) sp.set("q", filters.q);
  if (filters?.status) sp.set("status", filters.status);
  (filters?.os ?? []).forEach((o) => sp.append("os", o));
  return await jfetch<DevicesResponse>(`/api/devices?${sp.toString()}`);
}

export async function fetchDevice(id: string): Promise<Device> {
  return await jfetch<Device>(`/api/devices/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// Device insights (checks / software)
// ---------------------------------------------------------------------------
export type DeviceCheck = {
  id: string;
  name: string;
  status: "Passing" | "Warning" | "Failing";
  lastRun: string;
  output: string;

  // ----- Optional advanced fields (rendered when present) -----
  /** e.g., "PING","CPU","MEMORY","DISK","SERVICE","PROCESS","PORT","WINEVENT","SOFTWARE","SECURITY","SCRIPT","PATCH","CERT","SMART","RDP","SMB","FIREWALL" */
  type?: string;
  /** severity classification applied to alerting paths */
  severity?: "WARN" | "CRIT";
  /** optional grouping like "Performance", "Security", "Compliance" */
  category?: string;
  /** arbitrary labels */
  tags?: string[];
  /** thresholds used to evaluate this check (key/value) */
  thresholds?: Record<string, any>;
  /** metrics captured by the last run (key/value) */
  metrics?: Record<string, number | string | boolean>;
  /** true if within an active maintenance window */
  maintenance?: boolean;
  /** deduplication key for alert correlation */
  dedupeKey?: string;
};

/** Fetch device-scoped checks; limit is optional and passed to the backend if provided. */
export async function fetchDeviceChecks(
  deviceId: string,
  limit?: number
): Promise<{ items: DeviceCheck[] }> {
  const base = `/api/devices/${encodeURIComponent(deviceId)}/checks`;
  const path = typeof limit === "number" ? `${base}?limit=${encodeURIComponent(String(limit))}` : base;
  return await jfetch(path);
}

export type DeviceSoftware = {
  id: string;
  name: string;
  version: string;
  publisher?: string | null;
  installDate?: string | null;
};

export async function fetchDeviceSoftware(deviceId: string): Promise<{ items: DeviceSoftware[] }> {
  return await jfetch(`/api/devices/${encodeURIComponent(deviceId)}/software`);
}

// ---------------------------------------------------------------------------
// Device actions
// ---------------------------------------------------------------------------
export async function rebootDevice(id: string): Promise<{ accepted: true; jobId: string }> {
  return await jfetch(`/api/devices/${encodeURIComponent(id)}/actions/reboot`, { method: "POST" });
}
export async function patchDevice(id: string): Promise<{ accepted: true; jobId: string }> {
  return await jfetch(`/api/devices/${encodeURIComponent(id)}/actions/patch`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Automation / Runs
// ---------------------------------------------------------------------------
export type RunScriptRequest = {
  deviceId: string;
  script: string;
  shell?: "powershell" | "bash" | "cmd";
  timeoutSec?: number;
};

export async function postRunScript(req: RunScriptRequest): Promise<{ jobId: string }> {
  return await jfetch(`/api/automation/runs`, { method: "POST", body: req });
}

export type JobSnapshot = {
  jobId: string;
  deviceId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  log: string;
  exitCode?: number | null;
  startedAt: number;
  finishedAt?: number | null;
};

export async function fetchJob(jobId: string): Promise<JobSnapshot> {
  return await jfetch(`/api/automation/runs/${encodeURIComponent(jobId)}`);
}
export async function fetchJobLog(jobId: string): Promise<{ jobId: string; log: string }> {
  return await jfetch(`/api/automation/runs/${encodeURIComponent(jobId)}/log`);
}

// ---------------------------------------------------------------------------
// Admin → Database configuration
// ---------------------------------------------------------------------------
export type DbEngine = "postgresql" | "mysql" | "mssql" | "sqlite" | "mongodb";
export type DbAuthMode = "fields" | "url";
export type StorageDomain =
  | "users" | "roles" | "sessions" | "audit_logs" | "devices" | "policies" | "email_queue";

export type DatabaseMappings = Record<StorageDomain, string>;

export type DatabaseConfig = {
  enabled: boolean;
  engine: DbEngine;
  authMode: DbAuthMode;
  url?: string;
  host?: string;
  port?: number;
  dbName?: string;
  username?: string;
  password?: string;
  ssl: boolean;
  poolMin: number;
  poolMax: number;
  readReplicas?: string;
  mappings: DatabaseMappings;
};

export type DbTestResult = {
  ok: boolean;
  engine: DbEngine;
  primary: { ok: boolean; message?: string };
  replicas?: Array<{ url: string; ok: boolean; message?: string }>;
  note?: string;
};

export async function getDatabaseConfig(): Promise<DatabaseConfig | { enabled: false }> {
  return await jfetch(`/api/admin/database`);
}

export async function testDatabaseConfig(cfg: DatabaseConfig): Promise<DbTestResult> {
  return await jfetch(`/api/admin/database/test`, { method: "POST", body: cfg });
}

export async function saveDatabaseConfig(cfg: DatabaseConfig): Promise<void> {
  await jfetch<void>(`/api/admin/database/save`, { method: "POST", body: cfg });
}

export async function dryRunDatabaseMigration(): Promise<{ ok: true; destructive: false; steps: string[] }> {
  return await jfetch(`/api/admin/database/migrate/dry-run`, { method: "POST" });
}

// --- Company profile (admin) ---
export type CompanyProfile = {
  name: string;
  legalName?: string;
  email?: string;
  phone?: string;
  fax?: string;
  website?: string;
  vatTin?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postal?: string;
  country?: string;
};

export async function getCompanyProfile(): Promise<CompanyProfile> {
  return await jfetch(`/api/admin/company`);
}

export async function saveCompanyProfile(p: CompanyProfile): Promise<void> {
  await jfetch(`/api/admin/company/save`, { method: "POST", body: p });
}

// --- Localization (admin) ---
export type LocalizationSettings = {
  language: string;                // "en-US"
  dateFormat: string;              // "MM/DD/YYYY"
  timeFormat: "12h" | "24h";       // strictly 12h/24h for UI consistency
  numberFormat: string;            // "1,234.56"
  timeZone: string;                // "America/New_York"
  firstDayOfWeek: "sunday" | "monday";
  currency?: string;               // "USD"
};

export async function getLocalizationSettings(): Promise<LocalizationSettings> {
  const res = await jfetch<LocalizationSettings | { exists: false }>(`/api/admin/localization`);
  if ((res as any)?.exists === false) {
    return {
      language: "en-US",
      dateFormat: "MM/DD/YYYY",
      timeFormat: "12h",
      numberFormat: "1,234.56",
      timeZone: "America/New_York",
      firstDayOfWeek: "sunday",
      currency: "USD",
    };
  }
  // Back-compat: normalize any legacy strings to the union
  const tfRaw = (res as any).timeFormat as string | undefined;
  const timeFormat: "12h" | "24h" = tfRaw === "24h" || tfRaw === "HH:mm" ? "24h" : "12h";
  return { ...(res as LocalizationSettings), timeFormat };
}

export async function saveLocalizationSettings(p: LocalizationSettings): Promise<void> {
  await jfetch(`/api/admin/localization/save`, { method: "POST", body: p });
}

// --- Support & Legal (admin) ---
export type SupportLegalSettings = {
  id?: number;                 // present on GET only
  supportEmail?: string;
  supportPhone?: string;
  knowledgeBaseUrl?: string;
  statusPageUrl?: string;
  privacyPolicyUrl?: string;
  termsUrl?: string;
  gdprContactEmail?: string;
  legalAddress?: string;
  ticketPortalUrl?: string;
  phoneHours?: string;
  notesHtml?: string;
};

export async function getSupportLegalSettings(): Promise<SupportLegalSettings> {
  return await jfetch(`/api/admin/support-legal`);
}

export async function saveSupportLegalSettings(
  p: Omit<SupportLegalSettings, "id">
): Promise<void> {
  await jfetch(`/api/admin/support-legal/save`, { method: "POST", body: p });
}

// ======================= Users & Roles (Admin) =======================
export type RoleDTO = { id: string; name: string };
export type UserDTO = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleId?: string | null;
  roles?: Array<{ id: string; name: string }>;
  twoFactorEnabled: boolean;
  suspended: boolean;
  lastSeen: string | null;
  status: "active" | "invited" | "suspended";
  createdAt?: string;
  updatedAt?: string;

  // Optional profile fields (present if your DB exposes them)
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  postal?: string | null;
  country?: string | null;
};

export async function getAdminRoles(): Promise<{ items: RoleDTO[] }> {
  // Wrap server response (array) into {items} for consistency
  const arr = await jfetch<RoleDTO[]>(`/api/admin/users/roles`);
  return { items: arr };
}

export async function getAdminUsers(): Promise<{ items: UserDTO[]; total?: number }> {
  // backend returns {items, total}
  return await jfetch(`/api/admin/users`);
}

export type InvitePayload = { name?: string; email: string; role?: string; message?: string };

/** Invite one-by-one under the hood to keep types simple */
export async function inviteUsers(invites: InvitePayload[]): Promise<{ created: UserDTO[] }> {
  const created: UserDTO[] = [];
  for (const i of invites) {
    const resp = await jfetch<{ id: string }>(`/api/admin/users/invite`, {
      method: "POST",
      body: i,
    });
    const roleValue = typeof i.role === "string" ? i.role.trim() : "";
    const roleIsUuid = roleValue && UUID_REGEX.test(roleValue);
    created.push({
      id: resp.id,
      name: i.name ?? i.email.split("@")[0],
      email: i.email,
      role: roleIsUuid ? "" : roleValue || "",
      roleId: roleIsUuid ? roleValue : undefined,
      status: "invited",
      twoFactorEnabled: false,
      suspended: false,
      lastSeen: null,
    });
  }
  return { created };
}

/** Change a user's role */
export async function updateUserRole(userId: string, role: string): Promise<void> {
  await jfetch<void>(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: "PATCH",
    body: { role },
  });
}

/** Trigger a 2FA reset */
export async function resetUser2FA(userId: string): Promise<void> {
  await jfetch<void>(`/api/admin/users/${encodeURIComponent(userId)}/reset-2fa`, {
    method: "POST",
  });
}

/** Remove (delete) a user */
export async function removeUser(userId: string): Promise<void> {
  await jfetch<void>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

/** Suspend / Unsuspend user */
export async function setUserSuspended(userId: string, suspended: boolean): Promise<void> {
  await jfetch<void>(`/api/admin/users/${encodeURIComponent(userId)}/suspend`, {
    method: "POST",
    body: { suspended },
  });
}

/* -------- Admin create + reset password -------- */
export type CreateUserPayload = {
  name: string;
  email: string;
  role?: string;
  password: string;
  status?: "active" | "invited" | "suspended";
};

export async function createAdminUser(p: CreateUserPayload): Promise<{ id: string }> {
  return await jfetch(`/api/admin/users/create`, { method: "POST", body: p });
}

export async function setUserPassword(userId: string, password: string): Promise<void> {
  await jfetch(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
    method: "POST",
    body: { password },
  });
}

/* -------- NEW: Update user details (partial) -------- */
export type UpdateUserPayload = Partial<{
  name: string;
  email: string;
  role: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postal: string;
  country: string;
}>;

export async function updateUser(userId: string, p: UpdateUserPayload): Promise<void> {
  await jfetch<void>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: p,
  });
}

// ---------------------------------------------------------------------------
// Account (current user) - Profile
// ---------------------------------------------------------------------------
export type MeProfile = {
  id: string;
  name: string;
  email: string;
  username?: string;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  postal?: string | null;
  country?: string | null;
  timezone?: string | null;
  locale?: string | null;
  avatarUrl?: string | null; // backend may store as avatar_url; mapped server-side
  createdAt?: string;
  updatedAt?: string;
};

export type UpdateMePayload = Partial<{
  name: string;
  email: string;
  username: string;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  postal: string | null;
  country: string | null;
  timezone: string | null;
  locale: string | null;
  avatarUrl: string | null;
}>;

/** Load the signed-in user's profile */
export async function getMyProfile(): Promise<MeProfile> {
  return await jfetch<MeProfile>(`/api/users/me`);
}

/** Patch the signed-in user's profile (only sends provided keys) */
export async function updateMyProfile(patch: UpdateMePayload): Promise<MeProfile> {
  const body = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  return await jfetch<MeProfile>(`/api/users/me`, { method: "PATCH", body });
}

// ---------------------------------------------------------------------------
// Account (current user) - Security & Sessions (legacy helpers kept)
// ---------------------------------------------------------------------------
export type SecuritySettings = {
  twoFaEnabled: boolean;
  autoRevokeSessions?: boolean;
};

export async function getSecuritySettings(): Promise<SecuritySettings> {
  return await jfetch(`/api/users/security`);
}
export async function saveSecuritySettings(p: Partial<SecuritySettings>): Promise<void> {
  await jfetch(`/api/users/security`, { method: "PATCH", body: p });
}

export type SessionDTO = {
  id: string;
  device: string;
  ip: string;
  lastActive: string;
  current: boolean;
  city?: string;
  isp?: string;
  trusted?: boolean;
};

export async function listSessions(): Promise<{ items: SessionDTO[] }> {
  return await jfetch(`/api/users/sessions`);
}
export async function toggleTrustSession(sessionId: string, trusted: boolean): Promise<void> {
  await jfetch(`/api/users/sessions/${encodeURIComponent(sessionId)}/trust`, {
    method: "POST",
    body: { trusted },
  });
}
export async function revokeSession(sessionId: string): Promise<void> {
  await jfetch(`/api/users/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}
export async function revokeAllSessions(): Promise<void> {
  await jfetch(`/api/users/sessions`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Account (current user) - Notifications
// ---------------------------------------------------------------------------
export type NotificationSettings = {
  email: boolean;
  push: boolean;
  product: boolean;
  digest: "off" | "daily" | "weekly";
  quiet?: { enabled: boolean; start?: string; end?: string };
  products?: string[];
};

export async function getNotificationSettings(): Promise<NotificationSettings> {
  return await jfetch(`/api/users/notifications`);
}
export async function saveNotificationSettings(p: Partial<NotificationSettings>): Promise<void> {
  await jfetch(`/api/users/notifications`, { method: "PATCH", body: p });
}

// ---------------------------------------------------------------------------
// Account (current user) - Integrations (Slack + generic webhook)
// ---------------------------------------------------------------------------
export type IntegrationsSettings = {
  slackWebhook?: string;
  webhookUrl?: string;
  webhookSigningSecret?: string;
  events?: string[];
};

export async function getIntegrationsSettings(): Promise<IntegrationsSettings> {
  return await jfetch(`/api/users/integrations`);
}
export async function saveIntegrationsSettings(p: Partial<IntegrationsSettings>): Promise<void> {
  await jfetch(`/api/users/integrations`, { method: "PATCH", body: p });
}

export async function testSlackWebhook(urlStr: string): Promise<{ ok: boolean; status: number; ms?: number }> {
  return await jfetch(`/api/users/integrations/test/slack`, { method: "POST", body: { url: urlStr } });
}
export async function testGenericWebhook(urlStr: string): Promise<{ ok: boolean; status: number; ms?: number }> {
  return await jfetch(`/api/users/integrations/test/webhook`, { method: "POST", body: { url: urlStr } });
}
export async function rotateSigningSecret(): Promise<{ secret: string }> {
  return await jfetch(`/api/users/integrations/rotate-signing-secret`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Account (current user) - API Keys
// ---------------------------------------------------------------------------
export type ApiKeyDTO = {
  id: string;          // token id (e.g., "rk_live_xxx")
  label: string;
  lastUsed?: string;
  scopes?: string[];
  expiresAt?: string;  // iso or empty string if never
};

export async function listApiKeys(): Promise<{ items: ApiKeyDTO[] }> {
  const arr = await jfetch<ApiKeyDTO[]>(`/api/users/api-keys`);
  return { items: arr };
}

export async function createApiKey(
  label: string,
  scopes: string[],
  expiresIn: "never" | "30d" | "90d",
  ipAllowlist?: string
): Promise<ApiKeyDTO> {
  return await jfetch(`/api/users/api-keys`, {
    method: "POST",
    body: { label, scopes, expiresIn, ipAllowlist },
  });
}

export async function revokeApiKey(id: string): Promise<void> {
  await jfetch(`/api/users/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function regenerateApiKey(id: string): Promise<{ oldId: string; newKey: string }> {
  return await jfetch(`/api/users/api-keys/${encodeURIComponent(id)}/regenerate`, { method: "POST" });
}

// Upload avatar to the dedicated endpoint
export async function uploadMyAvatar(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file, file.name || "avatar.png");

  const base = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) || "";
  const res = await fetch(`${base.replace(/\/+$/, "")}/api/users/me/avatar`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    let msg = "";
    try { msg = (await res.json())?.message || ""; } catch { }
    if (!msg) try { msg = await res.text(); } catch { }
    throw new Error(msg || `Upload failed (${res.status})`);
  }
  return (await res.json()) as { url: string };
}

export async function removeMyAvatar(): Promise<void> {
  await jfetch<void>(`/api/users/me/avatar`, { method: "DELETE" });
}

/* ============================================================================
   NEW: Security Overview + TOTP + Sessions (ME scope) + PAT + WebAuthn stubs
   ==========================================================================*/

// ---- Types used by the Security tab ----
export type SecurityEvent = {
  id: string;
  type:
  | "signed_in"
  | "password_changed"
  | "2fa_enabled"
  | "2fa_disabled"
  | "recovery_codes_regenerated"
  | "session_revoked";
  at: string;
  ip?: string;
  userAgent?: string;
};

export type WebAuthnCredential = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type RecoveryCodes = string[];

// ---- Sessions (ME) ----
export type Session = {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
  trusted?: boolean;
  label?: string | null;
  revokedAt?: string | null; // <-- include so we can filter locally
};

export type SecurityOverview = {
  twoFactorEnabled: boolean;
  sessions: Session[];
  events: SecurityEvent[];
  webAuthn?: WebAuthnCredential[];
};

export type TOTPInit = { secret: string; otpauthUrl: string; qrPngDataUrl: string };

// ---- Overview ----
export async function getSecurityOverview(): Promise<SecurityOverview> {
  return await jfetch<SecurityOverview>(`/api/users/me/security`);
}

// ---- Change Password ----
export async function changePasswordSelf(current: string, next: string): Promise<void> {
  await jfetch(`/api/users/me/password`, { method: "POST", body: { current, next } });
}

// ---- TOTP 2FA ----
export async function start2FA(): Promise<TOTPInit> {
  return await jfetch<TOTPInit>(`/api/users/me/2fa/start`, { method: "POST" });
}

export async function confirm2FA(p: { code: string }): Promise<void> {
  await jfetch(`/api/users/me/2fa/confirm`, { method: "POST", body: p });
}

export async function disable2FA(p?: { code?: string; recoveryCode?: string }): Promise<void> {
  await jfetch(`/api/users/me/2fa/disable`, { method: "POST", body: p ?? {} });
}

export async function regenerateRecoveryCodes(): Promise<RecoveryCodes> {
  const res = await jfetch<{ recoveryCodes: string[] }>(`/api/users/me/2fa/recovery/regen`, {
    method: "POST",
  });
  return res.recoveryCodes;
}

// ---- Sessions (ME) ----
// NOTE: some servers include revoked sessions in the list; we filter them out.
export async function listMySessions(): Promise<{ items: Session[]; currentJti?: string }> {
  const res = await jfetch<{ items: Session[]; currentJti?: string }>(`/api/users/me/sessions/`);
  const items = (res.items ?? []).filter((s) => !s.revokedAt); // <-- hide revoked
  return { items, currentJti: res.currentJti };
}

export async function revokeAllOtherSessions(): Promise<void> {
  await jfetch(`/api/users/me/sessions/revoke-all`, { method: "POST" });
}

/**
 * Revoke a single session (ME).
 * Tries a sequence of plausible endpoints so we work with whatever the backend exposes.
 */
export async function revokeMySession(sessionId: string): Promise<void> {
  const enc = encodeURIComponent(sessionId);
  const base = `/api/users/me/sessions/${enc}`;

  // 1) Preferred: DELETE /me/sessions/:id
  try {
    await jfetch(base, { method: "DELETE" });
    return;
  } catch (e: any) {
    const msg = String(e?.message || "").toLowerCase();
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405 || msg.includes("cannot delete"))) throw e;
  }

  // 2) Alt: POST /me/sessions/:id/revoke
  try {
    await jfetch(`${base}/revoke`, { method: "POST" });
    return;
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  // 3) Alt: POST /me/sessions/revoke  { sessionId }
  try {
    await jfetch(`/api/users/me/sessions/revoke`, { method: "POST", body: { sessionId } });
    return;
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  // 4) Alt: POST /me/sessions/revoke/:id
  try {
    await jfetch(`/api/users/me/sessions/revoke/${enc}`, { method: "POST" });
    return;
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  // 5) Last-resort: PATCH /me/sessions/:id { action: "revoke" }
  await jfetch(base, { method: "PATCH", body: { action: "revoke" } });
}

/** Trust / untrust a session (ME) with fallbacks similar to revoke */
export async function trustMySession(
  sessionId: string,
  trusted: boolean
): Promise<{ trusted: boolean }> {
  const enc = encodeURIComponent(sessionId);
  const base = `/api/users/me/sessions/${enc}`;

  // 1) Preferred: POST /me/sessions/:id/trust { trusted }
  try {
    return await jfetch(`${base}/trust`, { method: "POST", body: { trusted } });
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  // 2) Alt: POST /me/sessions/trust { sessionId, trusted }
  try {
    return await jfetch(`/api/users/me/sessions/trust`, {
      method: "POST",
      body: { sessionId, trusted },
    });
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  // 3) Last-resort: PATCH /me/sessions/:id { trusted }
  return await jfetch(base, { method: "PATCH", body: { trusted } });
}

/** Optional: label a session (ME) */
export async function labelMySession(sessionId: string, label: string): Promise<void> {
  await jfetch(`/api/users/me/sessions/${encodeURIComponent(sessionId)}/label`, {
    method: "POST",
    body: { label },
  });
}

// lib/api.ts → mapMeSessionToDTO
export function mapMeSessionToDTO(s: Session): SessionDTO {
  return {
    id: s.id,
    device: s.label || s.userAgent || "Unknown device",
    ip: s.ip ?? "",                 // string (never undefined)
    lastActive: s.lastSeenAt ?? "", // string (never undefined)
    current: !!s.current,           // boolean
    city: undefined,
    isp: undefined,
    trusted: s.trusted ?? false,
  };
}


// ---- Personal Tokens (ME) ----
export type PersonalToken = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export async function listMyTokens(): Promise<{ items: PersonalToken[] }> {
  return await jfetch(`/api/users/me/tokens`);
}

export async function createMyToken(name: string): Promise<{ token: string; id: string }> {
  return await jfetch(`/api/users/me/tokens`, { method: "POST", body: { name } });
}

export async function revokeMyToken(id: string): Promise<void> {
  await jfetch(`/api/users/me/tokens/revoke`, { method: "POST", body: { id } });
}

// ---- WebAuthn (optional / stubbed) ----
export async function webauthnCreateOptions(): Promise<PublicKeyCredentialCreationOptions> {
  return await jfetch(`/api/users/me/webauthn/create-options`);
}

export async function webauthnFinishRegistration(attestationResponse: any): Promise<WebAuthnCredential> {
  return await jfetch(`/api/users/me/webauthn/finish`, { method: "POST", body: attestationResponse });
}

export async function deleteWebAuthnCredential(id: string): Promise<void> {
  return await jfetch(`/api/users/me/webauthn/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Device software: request uninstall --------------------------------
export async function requestUninstallSoftware(
  deviceId: string,
  body: { name: string; version?: string }
): Promise<{ accepted: true; jobId?: string }> {
  const res = await fetch(
    `${((typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) || "").replace(/\/+$/, "")}/api/devices/${encodeURIComponent(deviceId)}/actions/uninstall`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    // surface error text
    let msg = "";
    try { msg = (await res.clone().json())?.message || ""; } catch { }
    if (!msg) try { msg = await res.text(); } catch { }
    throw new Error(msg || `Request failed: ${res.status}`);
  }

  // Try JSON first
  let jobId: string | undefined;
  try {
    const json = await res.clone().json();
    jobId = json?.jobId;
  } catch {
    /* no json body */
  }

  // Fallback: parse Location header (e.g. /api/automation/runs/<uuid>)
  if (!jobId) {
    const loc = res.headers.get("Location") || res.headers.get("location");
    const m = loc?.match(/([0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[1-5][0-9a-fA-F-]{3}-[89abAB][0-9a-fA-F-]{3}-[0-9a-fA-F-]{12})$/);
    if (m) jobId = m[1];
  }

  return { accepted: true, jobId };
}
