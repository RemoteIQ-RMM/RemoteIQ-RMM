// backend/src/storage/storage-import.controller.ts

import {
    BadRequestException,
    Body,
    Controller,
    HttpCode,
    Post,
} from "@nestjs/common";
import { StorageConnectionsService } from "./storage-connections.service";
import { normalizeConnectionImport } from "./connection-import.util";

/**
 * Narrow, literal union matching StorageConnectionsService's internal StorageKind.
 * (We redeclare it here to avoid importing private types.)
 */
type StorageKind = "s3" | "nextcloud" | "gdrive" | "sftp";

/** Map any free-form input to our supported StorageKind (typed). */
function normalizeKind(input: any): StorageKind {
    const k = String(input || "")
        .toLowerCase()
        .replace(/\s+/g, "");

    if (k === "gdrive" || k === "googledrive") return "gdrive";
    if (k === "s3" || k === "aws" || k === "minio") return "s3";
    if (k === "nextcloud" || k === "webdav") return "nextcloud";
    if (k === "sftp" || k === "remote") return "sftp";

    // Default sensibly for raw service_account imports
    if (!k) return "gdrive";

    throw new BadRequestException(`Unsupported kind: ${input}`);
}

@Controller("api/storage/connections")
export class StorageImportController {
    constructor(private readonly svc: StorageConnectionsService) { }

    /**
     * Accepts:
     *  - Raw Google service_account JSON (pasted from Google)
     *  - { connections: [...] } in your native format
     *
     * Creates storage_connections using the existing service.
     */
    @Post("import")
    @HttpCode(200)
    async import(@Body() body: any) {
        let normalized: { connections: Array<any> };
        try {
            normalized = normalizeConnectionImport(body);
        } catch (e: any) {
            throw new BadRequestException(e?.message || "Invalid import payload");
        }

        const results: Array<{ id: string; name: string; kind: StorageKind }> = [];

        for (const raw of normalized.connections) {
            const kind: StorageKind = normalizeKind(raw.kind ?? "gdrive");
            const name = String(raw.name || `Imported ${kind} ${Date.now()}`);

            // Build config; ensure required fields exist for each kind
            const config: Record<string, any> = { ...(raw.config || {}) };

            if (kind === "gdrive") {
                // folderId needed by service validation; default to root
                if (!config.folderId || !String(config.folderId).trim()) {
                    config.folderId = "root";
                }
            }

            const meta = raw.meta || {};

            // Move "secrets" (e.g., serviceAccountJson) into config; the service
            // will strip and store them in secrets via partitionSecrets().
            if (raw.secrets && typeof raw.secrets === "object") {
                Object.assign(config, raw.secrets);
            }

            const { id } = await this.svc.create({
                name,
                kind,       // <- now typed as StorageKind, no TS2322
                config,
                meta,
            });

            results.push({ id, name, kind });
        }

        return { ok: true, imported: results.length, connections: results };
    }
}
