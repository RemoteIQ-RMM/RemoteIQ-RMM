// backend/src/remote-desktop/rdp-tunnel.framing.ts

import { TextDecoder, TextEncoder } from "node:util";

const FRAME_TYPE_DATA = 0x01;

// Node-safe text codecs (avoids DOM lib assumptions)
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8");

export function encodeDataFrame(sessionId: string, payload: Uint8Array): Uint8Array {
    const sidBytes = enc.encode(sessionId);
    if (sidBytes.length > 0xffff) throw new Error("sessionId too long for framing");

    // 1 byte type + 2 bytes sidLen + sidBytes + payload
    const out = new Uint8Array(1 + 2 + sidBytes.length + payload.length);

    out[0] = FRAME_TYPE_DATA;

    // write uint16be sidLen at offset 1
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    dv.setUint16(1, sidBytes.length, false);

    out.set(sidBytes, 3);
    out.set(payload, 3 + sidBytes.length);

    return out;
}

export function decodeFrame(buf: Uint8Array): { type: "data"; sessionId: string; payload: Uint8Array } {
    if (!buf || buf.length < 3) throw new Error("frame too short");

    const frameType = buf[0];
    if (frameType !== FRAME_TYPE_DATA) throw new Error(`unknown frameType ${frameType}`);

    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const sidLen = dv.getUint16(1, false);

    if (buf.length < 3 + sidLen) throw new Error("invalid sessionIdLen");

    const sidBytes = buf.slice(3, 3 + sidLen);
    const sessionId = dec.decode(sidBytes);

    const payload = buf.slice(3 + sidLen);

    return { type: "data", sessionId, payload };
}
