// remoteiq-minimal-e2e/backend/src/remote-desktop/rdp-tunnel.framing.ts

import { TextDecoder, TextEncoder } from "node:util";

export type RdpDataFrame = {
    sessionId: string;
    payload: Uint8Array;
};

const FRAME_TYPE_DATA = 0x01;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8");

/**
 * Convert ws "message" raw payload into a Uint8Array safely.
 * ws can deliver: Buffer | ArrayBuffer | Uint8Array | string
 */
export function toUint8(raw: any): Uint8Array | null {
    if (!raw) return null;

    // string messages are not binary frames
    if (typeof raw === "string") return null;

    // Node Buffer is a Uint8Array subclass, but TS may not know Buffer typings.
    if (raw instanceof Uint8Array) return raw;

    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);

    // Some ws implementations pass ArrayBufferView
    if (raw.buffer instanceof ArrayBuffer && typeof raw.byteOffset === "number" && typeof raw.byteLength === "number") {
        return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    }

    return null;
}

/**
 * Encode a binary data frame to send over WS (backend<->agent).
 *
 * Format:
 *  - byte    frameType = 0x01
 *  - uint16  sessionIdLength (big-endian)
 *  - bytes   sessionId (utf8)
 *  - bytes   payload (raw)
 */
export function encodeRdpDataFrame(sessionId: string, payload: Uint8Array): Uint8Array {
    const sidBytes = enc.encode(sessionId);
    if (sidBytes.length > 0xffff) throw new Error("sessionId too long");

    const out = new Uint8Array(1 + 2 + sidBytes.length + payload.length);
    out[0] = FRAME_TYPE_DATA;

    // uint16be
    out[1] = (sidBytes.length >> 8) & 0xff;
    out[2] = sidBytes.length & 0xff;

    out.set(sidBytes, 3);
    out.set(payload, 3 + sidBytes.length);

    return out;
}

/**
 * Decode a binary WS frame into {sessionId, payload}.
 */
export function decodeRdpDataFrame(buf: Uint8Array): RdpDataFrame {
    if (buf.length < 3) throw new Error("frame too short");

    const frameType = buf[0];
    if (frameType !== FRAME_TYPE_DATA) throw new Error("unknown frameType");

    const sidLen = (buf[1] << 8) | buf[2];
    const sidStart = 3;
    const sidEnd = sidStart + sidLen;

    if (buf.length < sidEnd) throw new Error("invalid sessionId length");

    const sessionId = dec.decode(buf.subarray(sidStart, sidEnd));
    const payload = buf.subarray(sidEnd);

    return { sessionId, payload };
}

/**
 * Back-compat exports: some files import encodeDataFrame/decodeDataFrame.
 */
export const encodeDataFrame = encodeRdpDataFrame;
export const decodeDataFrame = decodeRdpDataFrame;
