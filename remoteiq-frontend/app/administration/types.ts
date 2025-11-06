// ===== Shared Types for Administration Page =====

export type ToastKind = "success" | "destructive" | "warning" | "default";
export type Toast = { id: string; title: string; desc?: string; kind: ToastKind };
export type ToastFn = (t: Omit<Toast, "id">) => void;

// In your shared types file
export type User = {
    id: string;
    name: string;
    email: string;
    role: string;
    roleId?: string | null;
    roles?: Array<{ id: string; name: string }>;
    status: string;
    lastSeen: string;
    twoFactorEnabled?: boolean;
    suspended?: boolean;

    // Optional profile fields used by the Edit User modal
    phone?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    state?: string | null;
    postal?: string | null;
    country?: string | null;

    // Optional timestamps (if present)
    createdAt?: string;
    updatedAt?: string;
};



export type PermissionKey =
    | "view_devices"
    | "manage_devices"
    | "manage_users"
    | "billing_access"
    | "view_audit"
    | "manage_api"
    | "manage_flags";

export type Role = {
    id: string;
    name: string;
    description?: string;  
    permissions: Record<PermissionKey, boolean>;
    builtIn?: boolean;
    rawPermissions?: string[]; 
};

export type CompanyInfo = {
    name: string;
    legalName: string;
    email: string;
    phone: string;
    fax: string;
    website: string;
    vatTin: string;
    address1: string;
    address2: string;
    city: string;
    state: string;
    postal: string;
    country: string;
};

// ===== Billing (Gateways & Bank) =====
export type Currency = "USD" | "EUR" | "GBP" | "CAD" | "AUD";
export type TaxMode = "exclusive" | "inclusive" | "none";

export type StripeCfg = { enabled: boolean; publishableKey: string; secretKey: string; webhookSecret: string };
export type PaypalCfg = { enabled: boolean; clientId: string; clientSecret: string; mode: "live" | "sandbox" };
export type SquareCfg = { enabled: boolean; accessToken: string; locationId: string };
export type AuthorizeCfg = { enabled: boolean; apiLoginId: string; transactionKey: string };

export type BankCfg = {
    enableACH: boolean;
    accountHolder: string;
    routingNumber: string;
    accountNumber: string;
    accountType: "checking" | "savings" | "";
    bankName: string;
};

export type BillingConfig = {
    currency: Currency;
    taxMode: TaxMode;
    defaultTaxRate: number | "";
    statementDescriptor: string;
    stripe: StripeCfg;
    paypal: PaypalCfg;
    square: SquareCfg;
    authorize: AuthorizeCfg;
    bank: BankCfg;
};

// ===== Invoices =====
export type InvoiceConfig = {
    numberingPrefix: string;
    nextNumber: number | "";
    defaultNetTerms: 7 | 14 | 30 | 45 | 60;
    defaultDiscountPct: number | "";
    defaultLateFeePct: number | "";
    defaultNotes: string;
    footer: string;
    showCompanyAddress: boolean;
    attachPdfToEmail: boolean;
    emailFrom: string;
};

// ===== SMTP =====
export type EmailPurpose = "alerts" | "invites" | "password_resets" | "reports";

export type SmtpSettings = {
    host: string;
    port: number | "";
    username: string;
    password: string;
    useTLS: boolean;
    useSSL: boolean;
    fromAddress: string;
};

export type ImapSettings = {
    host: string;
    port: number | "";
    username: string;
    password: string;
    useSSL: boolean;
};

export type PopSettings = {
    host: string;
    port: number | "";
    username: string;
    password: string;
    useSSL: boolean;
};

export type EmailProfile = {
    smtp: SmtpSettings;
    imap: ImapSettings;
    pop: PopSettings;
    enabled: boolean;
};

// ===== 2FA + SSO =====
export type SsoProvider = "saml" | "oidc";

export type SamlConfig = {
    metadataUrl: string;
    idpEntityId: string;
    idpSsoUrl: string;
    idpCertificate: string;
    nameIdFormat: string;
    attrEmail: string;
    attrFirstName: string;
    attrLastName: string;
    attrGroups: string;
    jitProvisioning: boolean;
    groupRoleSync: boolean;
};

export type OidcConfig = {
    issuer: string;
    clientId: string;
    clientSecret: string;
    scopes: string;
    discoveryUrl: string;
};

// ===== Database =====
export type DbEngine = "postgresql" | "mysql" | "mssql" | "sqlite" | "mongodb";
export type DbAuthMode = "url" | "fields";
export type StorageDomain =
    | "users"
    | "roles"
    | "sessions"
    | "audit_logs"
    | "devices"
    | "policies"
    | "email_queue";

export type DatabaseConfig = {
    enabled: boolean;
    engine: DbEngine;
    authMode: DbAuthMode;
    url: string;
    host: string;
    port: number | "";
    dbName: string;
    username: string;
    password: string;
    ssl: boolean;
    poolMin: number | "";
    poolMax: number | "";
    readReplicas: string;
    mappings: Record<StorageDomain, string>;
};

// ===== S3 Storage =====
export type S3Provider = "aws" | "minio" | "wasabi" | "other";
export type StorageBackend = "local" | "s3";
export type S3Config = {
    enabled: boolean;
    backend: StorageBackend;
    provider: S3Provider;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    region: string;
    endpoint: string;
    prefix: string;
    pathStyle: boolean;
    sse: "none" | "AES256" | "aws:kms";
    kmsKeyId: string;
};

// ===== Backups =====
export type BackupTarget =
    | "users"
    | "roles"
    | "devices"
    | "policies"
    | "audit_logs"
    | "settings"
    | "templates";

export type BackupDestination = { kind: "local" } | { kind: "s3"; bucket: string; prefix: string };

export type BackupConfig = {
    enabled: boolean;
    targets: BackupTarget[];
    schedule: "hourly" | "daily" | "weekly" | "cron";
    cronExpr: string;
    retentionDays: number | "";
    encrypt: boolean;
    destination: BackupDestination;
};

export type BackupHistoryRow = {
    id: string;
    at: string;
    status: "success" | "running" | "failed";
    note?: string;
};

// ===== Email Templates =====
export type TemplateKey = "invite" | "password_reset" | "alert";
export type Template = { subject: string; body: string };

// ===== Audit types =====
export type AuditCategory = "security" | "role" | "user" | "auth" | "email" | "device" | "system";
export type AuditSeverity = "info" | "warning" | "error";
export type AuditLog = {
    id: string;
    at: string;
    category: AuditCategory;
    severity: AuditSeverity;
    actor: string;
    action: string;
    details?: string;
};

// ===== API tab types =====
export type ApiKeyScope =
    | "read:devices"
    | "write:devices"
    | "read:users"
    | "write:users"
    | "read:audit"
    | "admin:roles"
    | "admin:flags";

export type ApiKeyRow = {
    id: string;
    label: string;
    prefix: string;
    scopes: ApiKeyScope[];
    rateLimitRpm?: number;
    lastUsedAt?: string;
    createdAt: string;
    type: "personal" | "service";
    ipAllowlist?: string[];
};

// ===== Branding / Appearance =====
export type BrandingSettings = {
    primaryColor: string;
    secondaryColor: string;
    emailHeader: string;
    emailFooter: string;
    customCss: string;
    allowClientThemeToggle: boolean;
};

// ===== Localization =====
export type LocalizationSettings = {
    language: "en-US" | "en-GB" | "es-ES" | "fr-FR";
    dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
    timeFormat: "12h" | "24h";
    numberFormat: "1,234.56" | "1.234,56";
    timeZone: string;
    firstDayOfWeek: "sunday" | "monday";
};

// ===== Notifications =====
export type NotificationChannel = "email" | "sms" | "slack" | "teams" | "push";
export type NotificationRule = {
    id: string;
    event: string;
    severity: "info" | "warning" | "error" | "critical";
    channels: NotificationChannel[];
    recipients: string;
    enabled: boolean;
};

// ===== Security Policies =====
export type SecurityPolicySettings = {
    passwordMinLength: number | "";
    passwordRequireNumbers: boolean;
    passwordRequireSpecial: boolean;
    passwordRequireUppercase: boolean;
    passwordHistory: number | "";
    sessionTimeoutMins: number | "";
    idleLockMins: number | "";
    ipAllowlist: string;
    enableCaptcha: boolean;
};

// ===== Integrations =====
export type Integration = {
    id: "slack" | "teams" | "jira" | "servicenow" | "zendesk";
    name: string;
    connected: boolean;
};

// ===== Subscription & Licensing =====
export type SubscriptionInfo = {
    plan: string;
    seatsUsed: number;
    seatsTotal: number;
    renewalDate: string;
    licenseKey: string;
};

// ===== Client Portal =====
export type ClientPortalSettings = {
    enabledModules: ("dashboard" | "tickets" | "devices" | "invoices" | "reports")[];
    showSla: boolean;
    contactMethods: ("email" | "phone" | "portal")[];
};

