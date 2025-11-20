// backend/src/storage/connection-import.util.ts

export type IncomingImport =
    | { connections: Array<any> }          // existing RMM import shape
    | Record<string, any>;                 // raw Google service_account JSON, etc.

/**
 * Accepts either:
 *  - { connections: [...] } (your existing bulk format)
 *  - raw Google service account JSON (type === "service_account")
 * Returns a normalized { connections: [...] } object.
 */
export function normalizeConnectionImport(input: IncomingImport) {
    // Already the expected wrapper
    if (input && typeof input === "object" && Array.isArray((input as any).connections)) {
        return input as { connections: Array<any> };
    }

    // Raw Google service account JSON
    if (input && typeof input === "object" && (input as any).type === "service_account") {
        const serviceAccountJson = input;

        // We default to Drive "root" so validation passes; user can set a specific Folder ID later in the UI.
        const conn = {
            kind: "gdrive",
            name: "Google Drive (service account)",
            config: {
                folderId: "root",
            },
            meta: {
                environment: "dev",
                tags: ["backup", "offsite"],
            },
            secrets: {
                serviceAccountJson,
            },
        };

        return { connections: [conn] };
    }

    throw new Error("Unsupported import format. Paste the Google service_account JSON or { connections: [...] }.");
}
