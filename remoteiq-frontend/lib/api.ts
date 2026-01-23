// remoteiq-frontend/lib/api.ts
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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonInit = Omit<RequestInit, "body" | "method"> & {
  body?: any;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
};

async function readErrorMessage(res: Response): Promise<string> {
  let msg = "";
  try {
    const data = await res.clone().json();
    msg =
      typeof (data as any)?.message === "string"
        ? (data as any).message
        : JSON.stringify(data);
  } catch {
    try {
      msg = await res.text();
    } catch {
      // ignore
    }
  }
  return msg;
}

function asArray<T>(res: any): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && Array.isArray(res.items)) return res.items as T[];
  if (res && Array.isArray(res.data)) return res.data as T[];
  return [];
}

async function tryJfetch<T>(path: string, init?: JsonInit): Promise<T | undefined> {
  try {
    return await jfetch<T>(path, init ?? {});
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (status === 404 || status === 405) return undefined;
    throw e;
  }
}

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
    const msg = await readErrorMessage(res);
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
export type Device = {
  /**
   * Row id returned by backend:
   * - agent-sourced rows: agents.id
   * - device-only rows: public.devices.id
   */
  id: string;

  /** Always the underlying public.devices.id when known (agent rows include it). */
  deviceId?: string | null;

  hostname: string;
  os: string;
  arch?: string | null;
  lastSeen?: string | null;
  status: "online" | "offline";

  /** Human-readable names (existing UI uses these today). */
  client?: string | null;
  site?: string | null;

  /** Stable UUIDs for customer/site (needed for correct move + sidebar scoping). */
  clientId?: string | null;
  siteId?: string | null;

  user?: string | string[] | null;
  version?: string | null;
  primaryIp?: string | null;

  /** Optional UUID for the underlying agent (if backend provides it). */
  agentUuid?: string | null;
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
  type?: string;
  severity?: "WARN" | "CRIT";
  category?: string;
  tags?: string[];
  thresholds?: Record<string, any>;
  metrics?: Record<string, number | string | boolean>;
  maintenance?: boolean;
  dedupeKey?: string;
};

/** Fetch device-scoped checks; limit is optional and passed to the backend if provided. */
export async function fetchDeviceChecks(
  deviceId: string,
  limit?: number
): Promise<{ items: DeviceCheck[] }> {
  const base = `/api/devices/${encodeURIComponent(deviceId)}/checks`;
  const path =
    typeof limit === "number" ? `${base}?limit=${encodeURIComponent(String(limit))}` : base;
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

/**
 * Move a device to a new site via API.
 * Backend: PATCH /api/devices/:id/site  { siteId }
 */
export async function moveDeviceToSite(deviceId: string, siteId: string): Promise<Device> {
  const did = encodeURIComponent(String(deviceId ?? "").trim());
  const sid = String(siteId ?? "").trim();
  if (!did) throw new Error("deviceId is required");
  if (!sid) throw new Error("siteId is required");

  // Prefer PATCH /api/devices/:id/site, but try fallbacks if needed.
  const candidates: Array<{ path: string; method: "PATCH" | "POST"; body: any }> = [
    { path: `/api/devices/${did}/site`, method: "PATCH", body: { siteId: sid } },
    { path: `/api/devices/${did}/site`, method: "POST", body: { siteId: sid } },
    { path: `/api/devices/${did}/move-site`, method: "PATCH", body: { siteId: sid } },
    { path: `/api/devices/${did}/site/move`, method: "PATCH", body: { siteId: sid } },
  ];

  let lastErr: any = null;

  for (const c of candidates) {
    try {
      const res = await tryJfetch<Device>(c.path, { method: c.method, body: c.body });
      if (res === undefined) continue;
      return res;
    } catch (e: any) {
      const status = e?.status ?? e?.code;
      if (status === 404 || status === 405) continue;
      lastErr = e;
      break;
    }
  }

  if (lastErr) throw lastErr;
  throw new Error("No supported endpoint found to move device to site.");
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
  | "users"
  | "roles"
  | "sessions"
  | "audit_logs"
  | "devices"
  | "policies"
  | "email_queue";

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

export async function dryRunDatabaseMigration(): Promise<{
  ok: true;
  destructive: false;
  steps: string[];
}> {
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
  language: string;
  dateFormat: string;
  timeFormat: "12h" | "24h";
  numberFormat: string;
  timeZone: string;
  firstDayOfWeek: "sunday" | "monday";
  currency?: string;
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
  const tfRaw = (res as any).timeFormat as string | undefined;
  const timeFormat: "12h" | "24h" = tfRaw === "24h" || tfRaw === "HH:mm" ? "24h" : "12h";
  return { ...(res as LocalizationSettings), timeFormat };
}

export async function saveLocalizationSettings(p: LocalizationSettings): Promise<void> {
  await jfetch(`/api/admin/localization/save`, { method: "POST", body: p });
}

// --- Support & Legal (admin) ---
export type SupportLegalSettings = {
  id?: number;
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

export async function saveSupportLegalSettings(p: Omit<SupportLegalSettings, "id">): Promise<void> {
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

  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  postal?: string | null;
  country?: string | null;
};

export async function getAdminRoles(): Promise<{ items: RoleDTO[] }> {
  const arr = await jfetch<RoleDTO[]>(`/api/admin/users/roles`);
  return { items: arr };
}

export async function getAdminUsers(): Promise<{ items: UserDTO[]; total?: number }> {
  return await jfetch(`/api/admin/users`);
}

export type InvitePayload = { name?: string; email: string; role?: string; message?: string };

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

export async function updateUserRole(userId: string, role: string): Promise<void> {
  await jfetch<void>(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: "PATCH",
    body: { role },
  });
}

export async function resetUser2FA(userId: string): Promise<void> {
  await jfetch<void>(`/api/admin/users/${encodeURIComponent(userId)}/reset-2fa`, {
    method: "POST",
  });
}

export async function removeUser(userId: string): Promise<void> {
  await jfetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

export async function setUserSuspended(userId: string, suspended: boolean): Promise<void> {
  await jfetch<void>(`/api/admin/users/${encodeURIComponent(userId)}/suspend`, {
    method: "POST",
    body: { suspended },
  });
}

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
  avatarUrl?: string | null;
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

export async function getMyProfile(): Promise<MeProfile> {
  return await jfetch<MeProfile>(`/api/users/me`);
}

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

export async function testSlackWebhook(
  urlStr: string
): Promise<{ ok: boolean; status: number; ms?: number }> {
  return await jfetch(`/api/users/integrations/test/slack`, {
    method: "POST",
    body: { url: urlStr },
  });
}
export async function testGenericWebhook(
  urlStr: string
): Promise<{ ok: boolean; status: number; ms?: number }> {
  return await jfetch(`/api/users/integrations/test/webhook`, {
    method: "POST",
    body: { url: urlStr },
  });
}
export async function rotateSigningSecret(): Promise<{ secret: string }> {
  return await jfetch(`/api/users/integrations/rotate-signing-secret`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Account (current user) - API Keys
// ---------------------------------------------------------------------------
export type ApiKeyDTO = {
  id: string;
  label: string;
  lastUsed?: string;
  scopes?: string[];
  expiresAt?: string;
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

  const res = await fetch(url(`/api/users/me/avatar`), {
    method: "POST",
    credentials: "include",
    body: form,
  });

  if (!res.ok) {
    const msg = await readErrorMessage(res);
    throw new Error(msg || `Upload failed (${res.status})`);
  }

  try {
    return (await res.json()) as { url: string };
  } catch {
    return { url: "" };
  }
}

export async function removeMyAvatar(): Promise<void> {
  await jfetch<void>(`/api/users/me/avatar`, { method: "DELETE" });
}

/* ============================================================================
   Security Overview + TOTP + Sessions (ME scope) + PAT + WebAuthn stubs
   ==========================================================================*/

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

export type Session = {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
  trusted?: boolean;
  label?: string | null;
  revokedAt?: string | null;
};

export type SecurityOverview = {
  twoFactorEnabled: boolean;
  sessions: Session[];
  events: SecurityEvent[];
  webAuthn?: WebAuthnCredential[];
};

export type TOTPInit = { secret: string; otpauthUrl: string; qrPngDataUrl: string };

export async function getSecurityOverview(): Promise<SecurityOverview> {
  return await jfetch<SecurityOverview>(`/api/users/me/security`);
}

export async function changePasswordSelf(current: string, next: string): Promise<void> {
  await jfetch(`/api/users/me/password`, { method: "POST", body: { current, next } });
}

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
    body: {},
  });
  return res.recoveryCodes;
}

export async function listMySessions(): Promise<{ items: Session[]; currentJti?: string }> {
  const res = await jfetch<{ items: Session[]; currentJti?: string }>(`/api/users/me/sessions`);
  const items = (res.items ?? []).filter((s) => !s.revokedAt);
  return { items, currentJti: res.currentJti };
}

export async function revokeAllOtherSessions(): Promise<void> {
  await jfetch(`/api/users/me/sessions/revoke-all`, { method: "POST" });
}

export async function revokeMySession(sessionId: string): Promise<void> {
  const enc = encodeURIComponent(sessionId);
  const base = `/api/users/me/sessions/${enc}`;

  try {
    await jfetch(base, { method: "DELETE" });
    return;
  } catch (e: any) {
    const msg = String(e?.message || "").toLowerCase();
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405 || msg.includes("cannot delete"))) throw e;
  }

  try {
    await jfetch(`${base}/revoke`, { method: "POST" });
    return;
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  try {
    await jfetch(`/api/users/me/sessions/revoke`, { method: "POST", body: { sessionId } });
    return;
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  try {
    await jfetch(`/api/users/me/sessions/revoke/${enc}`, { method: "POST" });
    return;
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  await jfetch(base, { method: "PATCH", body: { action: "revoke" } });
}

export async function trustMySession(sessionId: string, trusted: boolean): Promise<{ trusted: boolean }> {
  const enc = encodeURIComponent(sessionId);
  const base = `/api/users/me/sessions/${enc}`;

  try {
    return await jfetch(`${base}/trust`, { method: "POST", body: { trusted } });
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  try {
    return await jfetch(`/api/users/me/sessions/trust`, {
      method: "POST",
      body: { sessionId, trusted },
    });
  } catch (e: any) {
    const status = e?.status ?? e?.code;
    if (!(status === 404 || status === 405)) throw e;
  }

  return await jfetch(base, { method: "PATCH", body: { trusted } });
}

export async function labelMySession(sessionId: string, label: string): Promise<void> {
  await jfetch(`/api/users/me/sessions/${encodeURIComponent(sessionId)}/label`, {
    method: "POST",
    body: { label },
  });
}

export function mapMeSessionToDTO(s: Session): SessionDTO {
  return {
    id: s.id,
    device: s.label || s.userAgent || "Unknown device",
    ip: s.ip ?? "",
    lastActive: s.lastSeenAt ?? "",
    current: !!s.current,
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
  const res = await fetch(url(`/api/devices/${encodeURIComponent(deviceId)}/actions/uninstall`), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const msg = await readErrorMessage(res);
    throw new Error(msg || `Request failed: ${res.status}`);
  }

  let jobId: string | undefined;
  try {
    const json = await res.clone().json();
    jobId = json?.jobId;
  } catch {
    /* no json body */
  }

  if (!jobId) {
    const loc = res.headers.get("Location") || res.headers.get("location");
    const m = loc?.match(
      /([0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[1-5][0-9a-fA-F-]{3}-[89abAB][0-9a-fA-F-]{3}-[0-9a-fA-F-]{12})$/
    );
    if (m) jobId = m[1];
  }

  return { accepted: true, jobId };
}

/* ============================================================================
   Customers (Clients + Sites) — matches backend /api/customers + /:client/sites
   ==========================================================================*/

export const CUSTOMERS_CHANGED_EVENT = "remoteiq:customers-changed";

function emitCustomersChanged() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(CUSTOMERS_CHANGED_EVENT));
  } catch {
    // ignore
  }
}

export type CustomerCounts = {
  sites?: number;
  devices?: number;
  tickets?: number;
};

export type CustomerClient = {
  id: string;
  name: string;

  // UI-friendly aliases (some components expect these)
  key: string;
  label: string;

  counts?: CustomerCounts;

  labels?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;

  // Optional flattened counts for older UIs
  sitesCount?: number;
  devicesCount?: number;
  ticketsCount?: number;
};

export type CustomerSite = {
  id: string;
  clientId: string;
  name: string;

  // UI-friendly alias
  key: string;
  label: string;

  counts?: { devices?: number; tickets?: number };

  labels?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateCustomerClientPayload = {
  name: string;
  labels?: Record<string, any>;
};

export type CreateCustomerSitePayload = {
  name: string;
  labels?: Record<string, any>;
};

function normalizeClient(raw: any): CustomerClient | null {
  if (!raw) return null;

  // backend list uses `key` (uuid string), not `id`
  const id = String(raw.id ?? raw.key ?? raw.clientId ?? raw.client_id ?? "");
  const name = String(raw.name ?? raw.title ?? raw.displayName ?? "");
  if (!id || !name) return null;

  const countsRaw = raw.counts ?? undefined;
  const counts: CustomerCounts | undefined =
    countsRaw && typeof countsRaw === "object"
      ? {
        sites: typeof countsRaw.sites === "number" ? countsRaw.sites : undefined,
        devices: typeof countsRaw.devices === "number" ? countsRaw.devices : undefined,
        tickets: typeof countsRaw.tickets === "number" ? countsRaw.tickets : undefined,
      }
      : undefined;

  const sitesCount =
    typeof raw.sitesCount === "number"
      ? raw.sitesCount
      : typeof raw.sites_count === "number"
        ? raw.sites_count
        : typeof counts?.sites === "number"
          ? counts.sites
          : undefined;

  const devicesCount =
    typeof raw.devicesCount === "number"
      ? raw.devicesCount
      : typeof raw.devices_count === "number"
        ? raw.devices_count
        : typeof counts?.devices === "number"
          ? counts.devices
          : undefined;

  const ticketsCount =
    typeof raw.ticketsCount === "number"
      ? raw.ticketsCount
      : typeof raw.tickets_count === "number"
        ? raw.tickets_count
        : typeof counts?.tickets === "number"
          ? counts.tickets
          : undefined;

  return {
    id,
    name,
    key: id,
    label: name,
    counts,
    labels: raw.labels ?? raw.meta ?? undefined,
    createdAt: raw.createdAt ?? raw.created_at ?? undefined,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? undefined,
    sitesCount,
    devicesCount,
    ticketsCount,
  };
}

function normalizeSite(raw: any, fallbackClientId: string): CustomerSite | null {
  if (!raw) return null;

  // backend listSites returns { key, name, counts }
  const id = String(raw.id ?? raw.key ?? raw.siteId ?? raw.site_id ?? "");
  const name = String(raw.name ?? raw.title ?? raw.displayName ?? "");
  const clientId = String(raw.clientId ?? raw.client_id ?? fallbackClientId ?? "");
  if (!id || !name || !clientId) return null;

  const countsRaw = raw.counts ?? undefined;
  const counts =
    countsRaw && typeof countsRaw === "object"
      ? {
        devices: typeof countsRaw.devices === "number" ? countsRaw.devices : undefined,
        tickets: typeof countsRaw.tickets === "number" ? countsRaw.tickets : undefined,
      }
      : undefined;

  return {
    id,
    clientId,
    name,
    key: id,
    label: name,
    counts,
    labels: raw.labels ?? raw.meta ?? undefined,
    createdAt: raw.createdAt ?? raw.created_at ?? undefined,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? undefined,
  };
}

/** fetchCustomers(): returns an ARRAY of CustomerClient */
export async function fetchCustomers(): Promise<CustomerClient[]> {
  const candidates = [
    `/api/customers`,
    `/api/clients`,
    `/api/organizations`,
    `/api/admin/customers`,
    `/api/admin/clients`,
    `/api/admin/organizations`,
  ];

  for (const p of candidates) {
    const res = await tryJfetch<any>(p);
    if (res === undefined) continue;

    const arr = asArray<any>(res);
    const normalized = arr.map(normalizeClient).filter(Boolean) as CustomerClient[];
    return normalized;
  }

  return [];
}

/** fetchCustomerSites(): returns an ARRAY of CustomerSite for a given client id/name */
export async function fetchCustomerSites(client: string): Promise<CustomerSite[]> {
  const c = encodeURIComponent(String(client ?? "").trim());

  const candidates = [
    `/api/customers/${c}/sites`,
    `/api/clients/${c}/sites`,
    `/api/organizations/${c}/sites`,
    `/api/admin/customers/${c}/sites`,
    `/api/admin/clients/${c}/sites`,
    `/api/admin/organizations/${c}/sites`,
  ];

  for (const p of candidates) {
    const res = await tryJfetch<any>(p);
    if (res === undefined) continue;

    const arr = asArray<any>(res);
    const normalized = arr
      .map((x: any) => normalizeSite(x, String(client)))
      .filter(Boolean) as CustomerSite[];
    return normalized;
  }

  return [];
}

export async function createCustomerClient(payload: CreateCustomerClientPayload): Promise<CustomerClient> {
  const candidates = [
    `/api/customers`,
    `/api/clients`,
    `/api/organizations`,
    `/api/admin/customers`,
    `/api/admin/clients`,
    `/api/admin/organizations`,
  ];

  for (const p of candidates) {
    const res = await tryJfetch<any>(p, { method: "POST", body: payload });
    if (res === undefined) continue;

    const item = (res as any)?.item ?? res;
    const normalized = normalizeClient(item);
    if (normalized) {
      emitCustomersChanged();
      return normalized;
    }

    // If backend only returns {id}
    const id = String((res as any)?.id ?? (item as any)?.id ?? "");
    if (id) {
      const out: CustomerClient = {
        id,
        name: payload.name,
        key: id,
        label: payload.name,
        labels: payload.labels,
      };
      emitCustomersChanged();
      return out;
    }
  }

  throw new Error(`No supported endpoint found to create customer/client.`);
}

export async function createCustomerSite(
  clientId: string,
  payload: CreateCustomerSitePayload
): Promise<CustomerSite> {
  const cid = encodeURIComponent(clientId);

  const candidates: Array<{ path: string; body: any }> = [
    { path: `/api/customers/${cid}/sites`, body: payload },
    { path: `/api/clients/${cid}/sites`, body: payload },
    { path: `/api/organizations/${cid}/sites`, body: payload },
    { path: `/api/sites`, body: { clientId, ...payload } },
    { path: `/api/admin/customers/${cid}/sites`, body: payload },
    { path: `/api/admin/clients/${cid}/sites`, body: payload },
    { path: `/api/admin/organizations/${cid}/sites`, body: payload },
    { path: `/api/admin/sites`, body: { clientId, ...payload } },
  ];

  for (const c of candidates) {
    const res = await tryJfetch<any>(c.path, { method: "POST", body: c.body });
    if (res === undefined) continue;

    const item = (res as any)?.item ?? res;
    const normalized = normalizeSite(item, clientId);
    if (normalized) {
      emitCustomersChanged();
      return normalized;
    }

    const id = String((res as any)?.id ?? (item as any)?.id ?? "");
    if (id) {
      const out: CustomerSite = {
        id,
        clientId,
        name: payload.name,
        key: id,
        label: payload.name,
        labels: payload.labels,
      };
      emitCustomersChanged();
      return out;
    }
  }

  throw new Error(`No supported endpoint found to create a site for client ${clientId}.`);
}

// ------------------------- Deletes (Clients + Sites) -------------------------

export async function deleteCustomerClient(clientIdOrName: string, opts?: { force?: boolean }): Promise<void> {
  const cid = encodeURIComponent(String(clientIdOrName ?? "").trim());
  const q = opts?.force ? `?force=true` : "";

  const candidates = [
    `/api/customers/${cid}${q}`,
    `/api/clients/${cid}${q}`,
    `/api/organizations/${cid}${q}`,
    `/api/admin/customers/${cid}${q}`,
    `/api/admin/clients/${cid}${q}`,
    `/api/admin/organizations/${cid}${q}`,
  ];

  let lastErr: any = null;

  for (const p of candidates) {
    try {
      // Use tryJfetch so 404/405 means “endpoint not supported”
      const res = await tryJfetch<any>(p, { method: "DELETE" });
      if (res === undefined) continue;

      emitCustomersChanged();
      return;
    } catch (e: any) {
      const status = e?.status ?? e?.code;
      if (status === 404 || status === 405) continue; // unsupported endpoint, try next
      lastErr = e;
      break;
    }
  }

  if (lastErr) throw lastErr;
  throw new Error("No supported endpoint found to delete client.");
}

export async function deleteCustomerSite(clientIdOrName: string, siteIdOrName: string): Promise<void> {
  const cid = encodeURIComponent(String(clientIdOrName ?? "").trim());
  const sid = encodeURIComponent(String(siteIdOrName ?? "").trim());

  const candidates = [
    `/api/customers/${cid}/sites/${sid}`,
    `/api/clients/${cid}/sites/${sid}`,
    `/api/organizations/${cid}/sites/${sid}`,
    `/api/admin/customers/${cid}/sites/${sid}`,
    `/api/admin/clients/${cid}/sites/${sid}`,
    `/api/admin/organizations/${cid}/sites/${sid}`,
  ];

  let lastErr: any = null;

  for (const p of candidates) {
    try {
      const res = await tryJfetch<any>(p, { method: "DELETE" });
      if (res === undefined) continue;

      emitCustomersChanged();
      return;
    } catch (e: any) {
      const status = e?.status ?? e?.code;
      if (status === 404 || status === 405) continue;
      lastErr = e;
      break;
    }
  }

  if (lastErr) throw lastErr;
  throw new Error("No supported endpoint found to delete site.");
}

// ---------------------------------------------------------------------------
// Provisioning / Enrollment token (Dashboard creates one-time enrollment secret)
// Backend routes:
//   POST /api/provisioning/endpoints
//   POST /endpoints
// ---------------------------------------------------------------------------

export type CreateEndpointRequest = {
  clientId: string;
  siteId: string;
  os: "windows" | "linux" | "macos";
  deviceId: string; // maps to public.devices.id (uuid)
  alias: string; // technician-managed label
  expiresMinutes: number; // 1..1440
};

export type CreateEndpointResponse = {
  deviceId: string;
  enrollmentSecret: string;
  expiresAt: string; // ISO string
  // optional extras if backend returns them later
  endpointId?: string;
  installUrl?: string;
};

function normalizeCreateEndpointResponse(raw: any): CreateEndpointResponse {
  // support multiple backend shapes without breaking the UI
  const deviceId = String(raw?.deviceId ?? raw?.device_id ?? raw?.id ?? "");
  const enrollmentSecret = String(
    raw?.enrollmentSecret ?? raw?.enrollment_secret ?? raw?.secret ?? raw?.token ?? ""
  );
  const expiresAt = String(raw?.expiresAt ?? raw?.expires_at ?? raw?.expires ?? "");

  if (!deviceId) throw new Error("Create endpoint: missing deviceId in response.");
  if (!enrollmentSecret) throw new Error("Create endpoint: missing enrollmentSecret in response.");
  if (!expiresAt) throw new Error("Create endpoint: missing expiresAt in response.");

  return {
    deviceId,
    enrollmentSecret,
    expiresAt,
    endpointId: raw?.endpointId ?? raw?.endpoint_id ?? raw?.endpoint?.id,
    installUrl: raw?.installUrl ?? raw?.install_url ?? raw?.url,
  };
}

export async function createEndpoint(req: CreateEndpointRequest): Promise<CreateEndpointResponse> {
  const body = {
    clientId: req.clientId,
    siteId: req.siteId,
    os: req.os,
    deviceId: req.deviceId,
    alias: req.alias,
    expiresMinutes: req.expiresMinutes,
  };

  // Based on your ROUTES output:
  const candidates: Array<{ path: string; method: "POST" }> = [
    { path: `/api/provisioning/endpoints`, method: "POST" }, // ✅ exists
    { path: `/endpoints`, method: "POST" }, // ✅ exists
    // (Optional legacy guesses if you add them later)
    { path: `/api/endpoints`, method: "POST" },
  ];

  let lastErr: any = null;

  for (const c of candidates) {
    try {
      const res = await tryJfetch<any>(c.path, { method: c.method, body });
      if (res === undefined) continue;
      return normalizeCreateEndpointResponse(res);
    } catch (e: any) {
      const status = e?.status ?? e?.code;
      if (status === 404 || status === 405) continue; // unsupported path, try next
      lastErr = e;
      break;
    }
  }

  if (lastErr) throw lastErr;
  throw new Error("No supported endpoint found to create an enrollment token.");
}

// ---------------------------------------------------------------------------
// Provisioning / Reusable Enrollment Keys (site-scoped, multi-use)
// Backend route:
//   POST /api/provisioning/enrollment-keys
// ---------------------------------------------------------------------------

export type CreateEnrollmentKeyRequest = {
  clientId: string;
  siteId: string;
  name?: string;
  expiresMinutes?: number; // 1..43200
};

export type CreateEnrollmentKeyResponse = {
  enrollmentKey: string; // raw token returned ONCE
  tokenId: string; // uuid
  expiresAt: string; // ISO
  clientId: string;
  siteId: string;
  name: string | null;
};

function normalizeCreateEnrollmentKeyResponse(raw: any): CreateEnrollmentKeyResponse {
  const enrollmentKey = String(raw?.enrollmentKey ?? raw?.enrollment_key ?? raw?.token ?? "");
  const tokenId = String(raw?.tokenId ?? raw?.token_id ?? raw?.id ?? "");
  const expiresAt = String(raw?.expiresAt ?? raw?.expires_at ?? raw?.expires ?? "");
  const clientId = String(raw?.clientId ?? raw?.client_id ?? "");
  const siteId = String(raw?.siteId ?? raw?.site_id ?? "");
  const name = raw?.name == null ? null : String(raw?.name);

  if (!enrollmentKey) throw new Error("Create enrollment key: missing enrollmentKey in response.");
  if (!tokenId) throw new Error("Create enrollment key: missing tokenId in response.");
  if (!expiresAt) throw new Error("Create enrollment key: missing expiresAt in response.");
  if (!clientId) throw new Error("Create enrollment key: missing clientId in response.");
  if (!siteId) throw new Error("Create enrollment key: missing siteId in response.");

  return { enrollmentKey, tokenId, expiresAt, clientId, siteId, name };
}

export async function createEnrollmentKey(
  req: CreateEnrollmentKeyRequest
): Promise<CreateEnrollmentKeyResponse> {
  const body = {
    clientId: String(req.clientId ?? "").trim(),
    siteId: String(req.siteId ?? "").trim(),
    name: req.name != null ? String(req.name).trim() : undefined,
    expiresMinutes: req.expiresMinutes,
  };

  if (!body.clientId) throw new Error("Create enrollment key: clientId is required.");
  if (!body.siteId) throw new Error("Create enrollment key: siteId is required.");

  const candidates: Array<{ path: string; method: "POST" }> = [
    { path: `/api/provisioning/enrollment-keys`, method: "POST" }, // ✅ your backend
    // optional alternates if you ever move it
    { path: `/api/provisioning/enrollmentKeys`, method: "POST" },
  ];

  let lastErr: any = null;

  for (const c of candidates) {
    try {
      const res = await tryJfetch<any>(c.path, { method: c.method, body });
      if (res === undefined) continue;
      return normalizeCreateEnrollmentKeyResponse(res);
    } catch (e: any) {
      const status = e?.status ?? e?.code;
      if (status === 404 || status === 405) continue;
      lastErr = e;
      break;
    }
  }

  if (lastErr) throw lastErr;
  throw new Error("No supported endpoint found to create a reusable enrollment key.");
}

// ---------------------------------------------------------------------------
// Provisioning / Reusable Installer Bundle Download (Option A)
// Backend route (per your new backend):
//   POST /api/provisioning/installer-bundles  -> { url, filename, expiresAt, ... }
//   GET  /api/provisioning/installer-bundles/:id/download?token=...
// ---------------------------------------------------------------------------

export type InstallerOs = "windows" | "linux" | "macos";

export type InstallerBundleRequest = {
  os: InstallerOs;
  enrollmentKey: string; // ✅ reusable site enrollment key
  label?: string; // optional filename hint
};

export type InstallerBundleResponse = {
  url: string; // signed/temporary URL or direct download route
  fileName?: string; // optional
  expiresAt?: string; // optional
  bundleId?: string; // optional
};

function normalizeInstallerBundleResponse(raw: any): InstallerBundleResponse {
  const urlStr = String(
    raw?.url ??
    raw?.downloadUrl ??
    raw?.download_url ??
    raw?.installUrl ??
    raw?.install_url ??
    ""
  );
  if (!urlStr) throw new Error("Installer bundle: missing url in response.");

  const fileName = raw?.fileName ?? raw?.file_name ?? raw?.filename ?? raw?.name;
  const bundleId = raw?.bundleId ?? raw?.bundle_id ?? raw?.id;

  return {
    url: urlStr,
    fileName: typeof fileName === "string" ? fileName : undefined,
    expiresAt: raw?.expiresAt ?? raw?.expires_at,
    bundleId: typeof bundleId === "string" ? bundleId : undefined,
  };
}

/**
 * Option A: Ask backend for a reusable installer bundle for an OS.
 * This uses the site-scoped enrollmentKey (multi-use), NOT the one-time enrollmentSecret.
 */
export async function getInstallerBundle(req: InstallerBundleRequest): Promise<InstallerBundleResponse> {
  const body = {
    os: req.os,
    enrollmentKey: String(req.enrollmentKey ?? "").trim(),
    label: req.label != null ? String(req.label).trim() : undefined,
  };

  if (!body.os) throw new Error("Installer bundle: os is required.");
  if (!body.enrollmentKey) throw new Error("Installer bundle: enrollmentKey is required.");

  const candidates: Array<{ path: string; method: "POST" }> = [
    { path: `/api/provisioning/installer-bundles`, method: "POST" }, // ✅ your backend (Option A)
    // optional alternates if you ever rename
    { path: `/api/provisioning/installerBundles`, method: "POST" },
  ];

  let lastErr: any = null;

  for (const c of candidates) {
    try {
      const res = await tryJfetch<any>(c.path, { method: c.method, body });
      if (res === undefined) continue;
      return normalizeInstallerBundleResponse(res);
    } catch (e: any) {
      const status = e?.status ?? e?.code;
      if (status === 404 || status === 405) continue;
      lastErr = e;
      break;
    }
  }

  if (lastErr) throw lastErr;
  throw new Error("No supported endpoint found to request an installer bundle.");
}

/**
 * Browser helper: trigger download.
 * Uses an <a download> click so it behaves like a file download without leaving SPA state.
 * If filename is omitted, browser/server headers decide.
 */
export function startBrowserDownload(urlStr: string, filename?: string) {
  if (typeof window === "undefined") return;
  const u = String(urlStr || "").trim();
  if (!u) return;

  // If API_BASE is set and backend returned a relative URL, keep it consistent.
  const full = u.startsWith("http://") || u.startsWith("https://") ? u : url(u);

  try {
    const a = document.createElement("a");
    a.href = full;
    if (filename) a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    // fallback
    window.location.assign(full);
  }
}
