// components/remote-console-panel.tsx
"use client";

import * as React from "react";
import {
    Send,
    PlugZap,
    Power,
    Copy as CopyIcon,
    Clipboard,
    MessageSquare,
    Monitor,
    Terminal,
    ExternalLink,
    X,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

type Props = {
    deviceId: string;
    agentUuid?: string;
    popout?: boolean;
};

type Status =
    | "idle"
    | "creating-session"
    | "connecting-ws"
    | "waiting-for-agent"
    | "negotiating"
    | "connected"
    | "disconnected"
    | "error";

type ChatMsg = { id: string; at: number; from: "me" | "remote"; text: string };

type ViewMode = "desktop" | "terminal";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
const WS_BASE_RAW = (process.env.NEXT_PUBLIC_WS_BASE || "").replace(/\/+$/, "");

function uid() {
    return Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

function apiUrl(path: string): string {
    if (!API_BASE) return path;
    return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

function buildWsUrl(path: string): string {
    if (WS_BASE_RAW) {
        const base = WS_BASE_RAW.endsWith("/ws") ? WS_BASE_RAW.slice(0, -3) : WS_BASE_RAW;
        return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
    }

    if (typeof window !== "undefined") {
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${proto}//${window.location.host}${path.startsWith("/") ? "" : "/"}${path}`;
    }

    return path;
}

function safeJsonParse(s: string): any | null {
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

function clamp01(n: number) {
    return Math.max(0, Math.min(1, n));
}

function toText(data: any): string {
    if (data == null) return "";
    if (typeof data === "string") return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) return new TextDecoder().decode(new Uint8Array(data.buffer));
    try {
        return String(data);
    } catch {
        return "";
    }
}

type ControlMsg =
    | {
        type: "mouse.move";
        // normalized within *visible video content* (after letterboxing/cropping adjustments)
        x: number; // 0..1
        y: number; // 0..1

        // video track dimensions as decoded on the viewer
        w: number; // videoWidth
        h: number; // videoHeight

        // drawn content box (within the container) in CSS pixels
        dw: number; // drawnWidth
        dh: number; // drawnHeight

        // optional: viewport geometry (CSS px)
        cx?: number; // container width
        cy?: number; // container height

        // optional: absolute pointer coords within the drawn content in CSS px
        ax?: number;
        ay?: number;

        mods: { alt: boolean; ctrl: boolean; shift: boolean; meta: boolean };
    }
    | {
        type: "mouse.down" | "mouse.up";
        button: number;

        x: number;
        y: number;

        w: number;
        h: number;

        dw: number;
        dh: number;

        cx?: number;
        cy?: number;

        ax?: number;
        ay?: number;

        mods: { alt: boolean; ctrl: boolean; shift: boolean; meta: boolean };
    }
    | {
        type: "mouse.wheel";
        dx: number;
        dy: number;

        // optional: wheel mode / scaling hint
        mode?: "pixel" | "line" | "page";

        mods: { alt: boolean; ctrl: boolean; shift: boolean; meta: boolean };
    }
    | {
        type: "key.down" | "key.up";
        key: string;
        code: string;
        repeat: boolean;
        mods: { alt: boolean; ctrl: boolean; shift: boolean; meta: boolean };
    }
    | { type: "focus" | "blur" };


function buildPopoutUrl(autoconnect = true) {
    const u = new URL(window.location.href);
    const sp = u.searchParams;
    if (!sp.get("tool")) sp.set("tool", "remote-console");
    sp.set("tool", "remote-console");
    sp.set("popout", "1");
    if (autoconnect) sp.set("autoconnect", "1");
    u.search = sp.toString();
    return u.toString();
}

/**
 * SDP munging for bandwidth hints:
 * - Adds b=TIAS / b=AS on the video m-line (helps some stacks pick sane target bandwidth).
 * - Adds x-google-(min/start/max)-bitrate to the VP9 fmtp line (Chrome-compatible hinting).
 *
 * NOTE: This is a pragmatic stopgap; agent-side encoder tuning still matters.
 */
function mungeSdpForVp9Quality(
    sdp: string,
    opts?: {
        minKbps?: number;
        startKbps?: number;
        maxKbps?: number;
        maxTiasBps?: number;
    }
): string {
    const minKbps = Math.max(50, Math.floor(opts?.minKbps ?? 250));
    const startKbps = Math.max(minKbps, Math.floor(opts?.startKbps ?? 1800));
    const maxKbps = Math.max(startKbps, Math.floor(opts?.maxKbps ?? 8000));

    const bps = Math.max(64_000, Math.floor(opts?.maxTiasBps ?? maxKbps * 1000));
    const asKbps = Math.max(64, Math.floor(bps / 1000));

    const lines = sdp.split(/\r\n/);

    // Find the video m-section
    let mVideo = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("m=video ")) {
            mVideo = i;
            break;
        }
    }
    if (mVideo === -1) return sdp;

    const sectionEnd = (() => {
        for (let i = mVideo + 1; i < lines.length; i++) {
            if (lines[i].startsWith("m=")) return i;
        }
        return lines.length;
    })();

    const before = lines.slice(0, mVideo);
    let mid = lines.slice(mVideo, sectionEnd);
    const after = lines.slice(sectionEnd);

    // ---- 1) Prefer VP9 first, VP8 second by reordering payloads in m=video ----
    // Find payload types for VP9 / VP8 from rtpmap
    const vp9Pts = new Set<string>();
    const vp8Pts = new Set<string>();

    for (const l of mid) {
        if (l.startsWith("a=rtpmap:") && /\/90000/i.test(l)) {
            // a=rtpmap:98 VP9/90000
            const m = l.match(/^a=rtpmap:(\d+)\s+([A-Za-z0-9\-]+)\/90000/i);
            if (!m) continue;
            const pt = m[1];
            const codec = (m[2] || "").toLowerCase();
            if (codec === "vp9") vp9Pts.add(pt);
            if (codec === "vp8") vp8Pts.add(pt);
        }
    }

    if (vp9Pts.size || vp8Pts.size) {
        const mParts = (mid[0] || "").split(" ").filter(Boolean);
        if (mParts.length >= 4) {
            const head = mParts.slice(0, 3);
            const pts = mParts.slice(3);

            const vp9Ordered = pts.filter((p) => vp9Pts.has(p));
            const vp8Ordered = pts.filter((p) => vp8Pts.has(p));
            const rest = pts.filter((p) => !vp9Pts.has(p) && !vp8Pts.has(p));

            // VP9 then VP8 then the rest
            const reordered = [...vp9Ordered, ...vp8Ordered, ...rest];
            mid[0] = [...head, ...reordered].join(" ");
        }
    }

    // ---- 2) Remove old b=AS/b=TIAS inside the video section ----
    mid = mid.filter((l) => !(l.startsWith("b=AS:") || l.startsWith("b=TIAS:")));

    // ---- 3) Insert b= lines near the top of the section (after m=/i=/c=) ----
    let insertAt = 1;
    for (let i = 1; i < mid.length; i++) {
        const l = mid[i];
        if (l.startsWith("i=") || l.startsWith("c=")) {
            insertAt = i + 1;
            continue;
        }
        if (l.startsWith("a=")) {
            insertAt = i;
            break;
        }
    }

    const bLines = [`b=TIAS:${bps}`, `b=AS:${asKbps}`, `a=content:screen`];
    mid.splice(insertAt, 0, ...bLines);

    // ---- 4) Add bitrate hints for BOTH VP9 + VP8 payloads (Chrome respects these) ----
    const want = `x-google-min-bitrate=${minKbps};x-google-start-bitrate=${startKbps};x-google-max-bitrate=${maxKbps};x-google-denoise=false;googNoiseReduction=false;googHighStartBitrate=true`;

    function upsertFmtp(pt: string) {
        let found = false;
        for (let i = 0; i < mid.length; i++) {
            const l = mid[i];
            if (l.startsWith(`a=fmtp:${pt}`)) {
                found = true;

                const parts = l.split(" ");
                const head = parts[0];
                const rest = parts.slice(1).join(" ").trim();

                const cleaned = rest
                    .split(";")
                    .map((p) => p.trim())
                    .filter(Boolean)
                    .filter(
                        (p) =>
                            !p.toLowerCase().startsWith("x-google-min-bitrate=") &&
                            !p.toLowerCase().startsWith("x-google-start-bitrate=") &&
                            !p.toLowerCase().startsWith("x-google-max-bitrate=") &&
                            !p.toLowerCase().startsWith("x-google-denoise=") &&
                            !p.toLowerCase().startsWith("goognoisereduction=") &&
                            !p.toLowerCase().startsWith("googhighstartbitrate=")
                    );

                mid[i] = `${head} ${[...cleaned, ...want.split(";")].join(";")}`.trim();
                return;
            }
        }

        if (!found) {
            // Insert right after the matching rtpmap line if possible
            let ins = mid.length;
            for (let i = 0; i < mid.length; i++) {
                if (mid[i].startsWith(`a=rtpmap:${pt}`)) {
                    ins = i + 1;
                    break;
                }
            }
            mid.splice(ins, 0, `a=fmtp:${pt} ${want}`);
        }
    }

    for (const pt of vp9Pts) upsertFmtp(pt);
    for (const pt of vp8Pts) upsertFmtp(pt);

    const out = [...before, ...mid, ...after].join("\r\n");
    return out.endsWith("\r\n") ? out : out + "\r\n";
}


export default function RemoteConsolePanel({ deviceId, agentUuid, popout }: Props) {
    const [status, setStatus] = React.useState<Status>("idle");
    const [err, setErr] = React.useState<string | null>(null);

    const [sessionId, setSessionId] = React.useState<string | null>(null);
    const [sessionToken, setSessionToken] = React.useState<string | null>(null);

    const [viewMode, setViewMode] = React.useState<ViewMode>("desktop");
    const [videoFit, setVideoFit] = React.useState<"contain" | "cover">("contain");

    const videoRef = React.useRef<HTMLVideoElement | null>(null);
    const containerRef = React.useRef<HTMLDivElement | null>(null);

    const wsRef = React.useRef<WebSocket | null>(null);
    const pcRef = React.useRef<RTCPeerConnection | null>(null);

    // Data channels
    const termDcRef = React.useRef<RTCDataChannel | null>(null); // rc.input (terminal)
    const controlDcRef = React.useRef<RTCDataChannel | null>(null); // rc.control (mouse/kb)
    const chatDcRef = React.useRef<RTCDataChannel | null>(null); // rc.chat
    const clipDcRef = React.useRef<RTCDataChannel | null>(null); // rc.clipboard

    const pendingIceRef = React.useRef<RTCIceCandidateInit[]>([]);
    const didStartWebRtcRef = React.useRef(false);

    const [chat, setChat] = React.useState<ChatMsg[]>([]);
    const [chatText, setChatText] = React.useState("");
    const [clipboardText, setClipboardText] = React.useState("");

    // Terminal UI state
    const [termOut, setTermOut] = React.useState<string>("");
    const [termLine, setTermLine] = React.useState<string>("");
    const termOutRef = React.useRef<HTMLDivElement | null>(null);

    // Video state
    const [hasVideoTrack, setHasVideoTrack] = React.useState(false);
    const [lastTrackInfo, setLastTrackInfo] = React.useState<string>("");

    const canStart = !!agentUuid;

    const addChat = React.useCallback((from: "me" | "remote", text: string) => {
        const t = String(text || "").trim();
        if (!t) return;
        setChat((c) => [...c, { id: uid(), at: Date.now(), from, text: t }]);
    }, []);

    const appendTermOut = React.useCallback((chunk: string) => {
        if (!chunk) return;
        setTermOut((prev) => {
            const next = prev + chunk;
            const cap = 200_000;
            return next.length > cap ? next.slice(next.length - cap) : next;
        });
    }, []);

    const scrollTermToBottom = React.useCallback(() => {
        const el = termOutRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, []);

    React.useEffect(() => {
        scrollTermToBottom();
    }, [termOut, scrollTermToBottom]);

    const sendWs = React.useCallback((msg: any) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(msg));
    }, []);

    const dcSendJson = React.useCallback((dc: RTCDataChannel | null, obj: any) => {
        if (!dc || dc.readyState !== "open") return;
        try {
            dc.send(JSON.stringify(obj));
        } catch {
            // ignore
        }
    }, []);

    const closeAll = React.useCallback(
        (reason?: string) => {
            didStartWebRtcRef.current = false;

            try {
                termDcRef.current?.close();
            } catch { }
            try {
                controlDcRef.current?.close();
            } catch { }
            try {
                chatDcRef.current?.close();
            } catch { }
            try {
                clipDcRef.current?.close();
            } catch { }

            termDcRef.current = null;
            controlDcRef.current = null;
            chatDcRef.current = null;
            clipDcRef.current = null;

            try {
                pcRef.current?.close();
            } catch { }
            pcRef.current = null;

            try {
                wsRef.current?.close();
            } catch { }
            wsRef.current = null;

            pendingIceRef.current = [];

            const v = videoRef.current;
            if (v) {
                try {
                    (v as any).srcObject = null;
                } catch { }
                v.src = "";
            }

            setHasVideoTrack(false);
            setLastTrackInfo("");

            setStatus("disconnected");
            if (reason) setErr(reason);
        },
        [setErr]
    );

    const sendTerminalText = React.useCallback((text: string) => {
        const dc = termDcRef.current;
        if (!dc || dc.readyState !== "open") return;
        try {
            dc.send(text ?? "");
        } catch { }
    }, []);

    const sendControl = React.useCallback(
        (msg: ControlMsg) => {
            const dc = controlDcRef.current;
            if (!dc || dc.readyState !== "open") return;
            dcSendJson(dc, msg);
        },
        [dcSendJson]
    );

    const computeVideoNormXY = React.useCallback(
        (clientX: number, clientY: number) => {
            const el = containerRef.current;
            const v = videoRef.current;
            if (!el) return null;

            const r = el.getBoundingClientRect();
            const rawX = clientX - r.left;
            const rawY = clientY - r.top;

            const cw = r.width;
            const ch = r.height;

            const vw = v?.videoWidth || 0;
            const vh = v?.videoHeight || 0;

            // Fallback when we don't know remote/video dimensions yet:
            // treat whole container as the "content box"
            if (!vw || !vh) {
                const nx = clamp01(rawX / Math.max(1, cw));
                const ny = clamp01(rawY / Math.max(1, ch));
                return {
                    x: nx,
                    y: ny,
                    w: 0,
                    h: 0,
                    dw: Math.round(cw),
                    dh: Math.round(ch),
                    cx: Math.round(cw),
                    cy: Math.round(ch),
                    ax: Math.round(rawX),
                    ay: Math.round(rawY),
                    offX: 0,
                    offY: 0,
                };
            }

            const containerAspect = cw / Math.max(1, ch);
            const videoAspect = vw / Math.max(1, vh);

            // Drawn box in container pixels (CSS px)
            let drawW = cw;
            let drawH = ch;
            let offX = 0;
            let offY = 0;

            if (videoFit === "contain") {
                // letterbox/pillarbox
                if (videoAspect > containerAspect) {
                    drawW = cw;
                    drawH = cw / videoAspect;
                    offY = (ch - drawH) / 2;
                } else {
                    drawH = ch;
                    drawW = ch * videoAspect;
                    offX = (cw - drawW) / 2;
                }
            } else {
                // cover (crop)
                if (videoAspect > containerAspect) {
                    drawH = ch;
                    drawW = ch * videoAspect;
                    offX = (cw - drawW) / 2;
                } else {
                    drawW = cw;
                    drawH = cw / videoAspect;
                    offY = (ch - drawH) / 2;
                }
            }

            // x/y within the drawn content box
            const xIn = rawX - offX;
            const yIn = rawY - offY;

            const nx = clamp01(xIn / Math.max(1, drawW));
            const ny = clamp01(yIn / Math.max(1, drawH));

            return {
                x: nx,
                y: ny,
                w: vw,
                h: vh,
                dw: Math.round(drawW),
                dh: Math.round(drawH),
                cx: Math.round(cw),
                cy: Math.round(ch),
                ax: Math.round(xIn),
                ay: Math.round(yIn),
                offX: Math.round(offX),
                offY: Math.round(offY),
            };
        },
        [videoFit]
    );


    const startWebRtc = React.useCallback(
        async (sid: string) => {
            if (didStartWebRtcRef.current) return;
            didStartWebRtcRef.current = true;

            setStatus("negotiating");

            const pc = new RTCPeerConnection({
                iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
            });
            pcRef.current = pc;

            pc.onicecandidate = (ev2) => {
                if (!ev2.candidate) return;

                const json = (ev2.candidate as any).toJSON ? (ev2.candidate as any).toJSON() : (ev2.candidate as any);
                let c = String(json?.candidate || "");

                const hasMid = json?.sdpMid != null;
                const hasMline = typeof json?.sdpMLineIndex === "number";
                if (!hasMid && !hasMline) return;

                if (c && !c.startsWith("candidate:")) c = `candidate:${c}`;

                sendWs({
                    type: "signal",
                    sessionId: sid,
                    data: {
                        candidate: c,
                        sdpMid: json?.sdpMid ?? null,
                        sdpMLineIndex: hasMline ? json.sdpMLineIndex : null,
                        usernameFragment: json?.usernameFragment ?? undefined,
                    },
                });
            };

            pc.oniceconnectionstatechange = () => {
                const ice = pc.iceConnectionState;
                if (ice === "failed" || ice === "disconnected") {
                    setErr((prev) => prev || `ICE ${ice}. Likely NAT/relay or incompatible candidate types.`);
                }
            };

            pc.onconnectionstatechange = () => {
                const st = pc.connectionState as "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";
                if (st === "connected") setStatus("connected");
                else if (st === "disconnected" || st === "failed" || st === "closed") setStatus("disconnected");
                else setStatus((prev) => (prev === "connected" ? prev : "negotiating"));
            };

            // recvonly video
            let transceiver: RTCRtpTransceiver | null = null;
            try {
                transceiver = pc.addTransceiver("video", { direction: "recvonly" });
            } catch {
                transceiver = null;
            }

            // Prefer VP9 codec in the offer (fallback to VP8)
            if (transceiver && typeof (RTCRtpSender as any)?.getCapabilities === "function") {
                try {
                    const caps = (RTCRtpSender as any).getCapabilities("video");
                    const codecs = (caps?.codecs || []) as any[];

                    const vp9 = codecs.filter((c) => String(c?.mimeType || "").toLowerCase() === "video/vp9");
                    const vp8 = codecs.filter((c) => String(c?.mimeType || "").toLowerCase() === "video/vp8");

                    const ordered = [...vp9, ...vp8];

                    if (ordered.length && typeof (transceiver as any).setCodecPreferences === "function") {
                        (transceiver as any).setCodecPreferences(ordered);
                    }
                } catch { }
            }

            pc.ontrack = (ev2) => {
                if (ev2.track?.kind === "video") {
                    setHasVideoTrack(true);
                    setLastTrackInfo(`video track id=${ev2.track.id} readyState=${ev2.track.readyState}`);
                } else if (ev2.track) {
                    setLastTrackInfo(`${ev2.track.kind} track id=${ev2.track.id} readyState=${ev2.track.readyState}`);
                }

                const v = videoRef.current;
                if (!v) return;

                const stream = ev2.streams?.[0] || new MediaStream([ev2.track]);
                const current = (v as any).srcObject as MediaStream | null;

                if (current !== stream) {
                    try {
                        (v as any).srcObject = stream;
                    } catch {
                        v.src = URL.createObjectURL(stream as any);
                    }
                }

                v.muted = true;
                v.playsInline = true;
                void v.play().catch(() => { });
            };

            // DataChannels:
            const termDc = pc.createDataChannel("rc.input", { ordered: true });
            const controlDc = pc.createDataChannel("rc.control", { ordered: true });
            const chatDc = pc.createDataChannel("rc.chat", { ordered: true });
            const clipDc = pc.createDataChannel("rc.clipboard", { ordered: true });

            termDcRef.current = termDc;
            controlDcRef.current = controlDc;
            chatDcRef.current = chatDc;
            clipDcRef.current = clipDc;

            termDc.onopen = () => {
                appendTermOut("\r\n[RemoteIQ] rc.input connected.\r\n");
                scrollTermToBottom();
            };
            termDc.onmessage = (ev2) => {
                const chunk = toText((ev2 as any).data);
                if (!chunk) return;
                appendTermOut(chunk);
            };

            controlDc.onopen = () => {
                dcSendJson(controlDc, { type: "focus" });
            };

            chatDc.onmessage = (ev2) => {
                const t = String((ev2 as any).data || "");
                const obj = safeJsonParse(t);
                if (obj?.type === "chat.msg") addChat("remote", String(obj.text || ""));
            };

            clipDc.onmessage = (ev2) => {
                const t = String((ev2 as any).data || "");
                const obj = safeJsonParse(t);
                if (obj?.type === "clipboard.set") setClipboardText(String(obj.text || ""));
            };

            try {
                const offer = await pc.createOffer();

                // SDP munging for VP9 bitrate hints / bandwidth lines
                const munged = mungeSdpForVp9Quality(offer.sdp || "", {
                    minKbps: 300,
                    startKbps: 2200,
                    maxKbps: 9000,
                });

                await pc.setLocalDescription({ type: "offer", sdp: munged });

                sendWs({ type: "signal", sessionId: sid, data: { type: "offer", sdp: munged } });
                setStatus("negotiating");
            } catch (e: any) {
                setErr(`Failed to create offer: ${e?.message || e}`);
                setStatus("error");
                closeAll("Offer failed");
            }
        },
        [addChat, appendTermOut, closeAll, dcSendJson, scrollTermToBottom, sendWs]
    );

    const start = React.useCallback(async () => {
        if (!agentUuid) {
            setErr("This device has no agentUuid; remote console cannot start.");
            setStatus("error");
            return;
        }

        try {
            closeAll();
        } catch { }

        setErr(null);
        setStatus("creating-session");

        didStartWebRtcRef.current = false;
        setTermOut("");
        setTermLine("");
        setHasVideoTrack(false);
        setLastTrackInfo("");

        let created: { sessionId: string; sessionToken: string; wsPath?: string } | null = null;
        try {
            const res = await fetch(apiUrl("/api/remote-console/sessions"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ agentId: agentUuid }),
            });

            const body = await res.json().catch(() => null);

            if (!res.ok) {
                throw new Error(body?.message ? String(body.message) : `Failed to create session (${res.status})`);
            }

            created = body;
        } catch (e: any) {
            setErr(e?.message || String(e));
            setStatus("error");
            return;
        }

        const sid = String(created?.sessionId || "");
        const stok = String(created?.sessionToken || "");
        if (!sid || !stok) {
            setErr("Invalid session response from backend.");
            setStatus("error");
            return;
        }

        setSessionId(sid);
        setSessionToken(stok);

        setStatus("connecting-ws");
        const wsUrl = buildWsUrl(created?.wsPath || "/ws/remote-console");
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            sendWs({ type: "hello", kind: "tech", sessionId: sid, sessionToken: stok });
            setStatus("waiting-for-agent");
        };

        ws.onmessage = async (ev) => {
            const msg = typeof ev.data === "string" ? safeJsonParse(ev.data) : null;
            if (!msg?.type) return;

            if (msg.type === "hello.error") {
                setErr(String(msg.message || "Unauthorized"));
                setStatus("error");
                closeAll("WS hello failed");
                return;
            }

            if (msg.type === "session.closed") {
                closeAll(`Session closed: ${String(msg.reason || "closed")}`);
                return;
            }

            if (msg.type === "session.ready") {
                await startWebRtc(sid);
                return;
            }

            if (msg.type === "signal") {
                const data = msg.data;
                const pc = pcRef.current;
                if (!pc) return;

                if (data?.type === "answer" && data?.sdp) {
                    try {
                        await pc.setRemoteDescription(data);

                        const pending = pendingIceRef.current.splice(0);
                        for (const c of pending) {
                            try {
                                await pc.addIceCandidate(c);
                            } catch { }
                        }
                    } catch (e: any) {
                        setErr(`Failed to apply answer: ${e?.message || e}`);
                        setStatus("error");
                    }
                    return;
                }

                if (typeof data?.candidate === "string") {
                    const cand: RTCIceCandidateInit = {
                        candidate: data.candidate,
                        sdpMid: data.sdpMid ?? null,
                        sdpMLineIndex: typeof data.sdpMLineIndex === "number" ? data.sdpMLineIndex : null,
                        usernameFragment: data.usernameFragment ?? undefined,
                    };

                    try {
                        if (!pc.remoteDescription) {
                            pendingIceRef.current.push(cand);
                            return;
                        }
                        await pc.addIceCandidate(cand);
                    } catch { }
                }
            }
        };

        ws.onerror = () => {
            setErr("WebSocket error");
            setStatus("error");
        };

        ws.onclose = () => {
            setStatus((prev) => (prev === "connected" || prev === "negotiating" ? "disconnected" : prev));
        };
    }, [agentUuid, closeAll, sendWs, startWebRtc]);

    const stop = React.useCallback(() => {
        const sid = sessionId;
        if (sid) {
            try {
                sendWs({ type: "signal", sessionId: sid, data: { type: "tech.hangup" } });
            } catch { }
        }
        closeAll("Stopped");
    }, [closeAll, sendWs, sessionId]);

    React.useEffect(() => {
        if (status !== "connected") return;

        let stopped = false;

        const tick = async () => {
            const pc = pcRef.current;
            const v = videoRef.current;
            if (!pc || !v || stopped) return;

            try {
                const stats = await pc.getStats();
                let inbound: any = null;
                let codec: any = null;

                stats.forEach((r: any) => {
                    if (r.type === "inbound-rtp" && r.kind === "video") inbound = r;
                    if (r.type === "codec") {
                        // we'll select the codec associated with inbound-rtp later
                    }
                });

                if (inbound?.codecId) {
                    codec = stats.get(inbound.codecId);
                }

                const mime = codec?.mimeType || "";
                const fps = inbound?.framesPerSecond ?? inbound?.framesPerSecond ?? null;
                const kbps =
                    typeof inbound?.bytesReceived === "number" && typeof inbound?.timestamp === "number"
                        ? null
                        : null;

                // Best-effort bitrate estimate (bytes delta over time)
                // We'll store last values in closure
            } catch {
                // ignore
            }
        };

        let lastBytes = 0;
        let lastTs = 0;

        const tick2 = async () => {
            const pc = pcRef.current;
            const v = videoRef.current;
            if (!pc || !v || stopped) return;

            try {
                const stats = await pc.getStats();
                let inbound: any = null;
                let codec: any = null;

                stats.forEach((r: any) => {
                    if (r.type === "inbound-rtp" && r.kind === "video") inbound = r;
                });

                if (inbound?.codecId) codec = stats.get(inbound.codecId);

                const nowBytes = typeof inbound?.bytesReceived === "number" ? inbound.bytesReceived : 0;
                const nowTs = typeof inbound?.timestamp === "number" ? inbound.timestamp : 0;

                let estKbps: number | null = null;
                if (lastTs && nowTs > lastTs && nowBytes >= lastBytes) {
                    const dtSec = (nowTs - lastTs) / 1000;
                    const dBytes = nowBytes - lastBytes;
                    estKbps = Math.round(((dBytes * 8) / dtSec) / 1000);
                }

                lastBytes = nowBytes;
                lastTs = nowTs;

                const mime = String(codec?.mimeType || "");
                const fps = typeof inbound?.framesPerSecond === "number" ? Math.round(inbound.framesPerSecond) : null;

                setLastTrackInfo(
                    [
                        mime ? `codec=${mime}` : null,
                        v.videoWidth && v.videoHeight ? `rx=${v.videoWidth}x${v.videoHeight}` : null,
                        fps != null ? `fps≈${fps}` : null,
                        estKbps != null ? `kbps≈${estKbps}` : null,
                        inbound?.jitter != null ? `jitter=${Number(inbound.jitter).toFixed(3)}` : null,
                    ]
                        .filter(Boolean)
                        .join(" • ")
                );
            } catch {
                // ignore
            }
        };

        const id = window.setInterval(tick2, 1000);
        tick2().catch(() => { });

        return () => {
            stopped = true;
            window.clearInterval(id);
        };
    }, [status]);


    // Auto-connect when opened as popout with ?autoconnect=1
    React.useEffect(() => {
        if (!popout) return;
        if (typeof window === "undefined") return;
        const sp = new URLSearchParams(window.location.search);
        const ac = sp.get("autoconnect");
        if (ac === "1" && status === "idle") {
            const t = window.setTimeout(() => {
                start().catch(() => { });
            }, 0);
            return () => window.clearTimeout(t);
        }
    }, [popout, start, status]);

    // --- Terminal input handling (line buffered) ---
    const submitLine = React.useCallback(() => {
        if (status !== "connected") return;

        const line = termLine;
        sendTerminalText(line + "\r\n");

        appendTermOut(line + "\r\n");
        setTermLine("");
    }, [appendTermOut, sendTerminalText, status, termLine]);

    const onTerminalKeyDown = React.useCallback(
        async (e: React.KeyboardEvent) => {
            if (status !== "connected") return;
            if (viewMode !== "terminal") return;

            if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) return;

            if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
                e.preventDefault();
                try {
                    const t = await navigator.clipboard.readText();
                    if (t) setTermLine((p) => p + t.replace(/\r\n/g, "\n"));
                } catch { }
                return;
            }

            if (e.key === "Enter" || e.key === "NumpadEnter") {
                e.preventDefault();
                submitLine();
                return;
            }

            if (e.key === "Backspace") {
                e.preventDefault();
                setTermLine((p) => (p.length ? p.slice(0, -1) : p));
                return;
            }

            if (e.key === "Tab") {
                e.preventDefault();
                setTermLine((p) => p + "\t");
                return;
            }

            if (!e.altKey && !e.ctrlKey && !e.metaKey && e.key && e.key.length === 1) {
                e.preventDefault();
                setTermLine((p) => p + e.key);
            }
        },
        [status, submitLine, viewMode]
    );

    // --- Desktop control input (mouse/kb) ---
    const modsFrom = React.useCallback((e: { altKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) => {
        return {
            alt: !!e.altKey,
            ctrl: !!e.ctrlKey,
            shift: !!e.shiftKey,
            meta: !!e.metaKey,
        };
    }, []);

    const lastMoveSentAtRef = React.useRef<number>(0);

    const onMouseMove = React.useCallback(
        (e: React.MouseEvent) => {
            if (status !== "connected") return;
            if (viewMode !== "desktop") return;

            const now = Date.now();
            if (now - lastMoveSentAtRef.current < 15) return;
            lastMoveSentAtRef.current = now;

            const p = computeVideoNormXY(e.clientX, e.clientY);
            if (!p) return;

            sendControl({
                type: "mouse.move",
                x: p.x,
                y: p.y,
                w: p.w,
                h: p.h,
                dw: p.dw,
                dh: p.dh,
                cx: p.cx,
                cy: p.cy,
                ax: p.ax,
                ay: p.ay,
                mods: modsFrom(e),
            });

        },
        [computeVideoNormXY, modsFrom, sendControl, status, viewMode]
    );

    const onMouseDown = React.useCallback(
        (e: React.MouseEvent) => {
            if (status !== "connected") return;
            if (viewMode !== "desktop") return;

            e.preventDefault();

            const p = computeVideoNormXY(e.clientX, e.clientY);
            if (!p) return;

            containerRef.current?.focus();

            sendControl({
                type: "mouse.down",
                button: e.button,
                x: p.x,
                y: p.y,
                w: p.w,
                h: p.h,
                dw: p.dw,
                dh: p.dh,
                cx: p.cx,
                cy: p.cy,
                ax: p.ax,
                ay: p.ay,
                mods: modsFrom(e),
            });

        },
        [computeVideoNormXY, modsFrom, sendControl, status, viewMode]
    );

    const onMouseUp = React.useCallback(
        (e: React.MouseEvent) => {
            if (status !== "connected") return;
            if (viewMode !== "desktop") return;

            e.preventDefault();

            const p = computeVideoNormXY(e.clientX, e.clientY);
            if (!p) return;

            sendControl({
                type: "mouse.up",
                button: e.button,
                x: p.x,
                y: p.y,
                w: p.w,
                h: p.h,
                dw: p.dw,
                dh: p.dh,
                cx: p.cx,
                cy: p.cy,
                ax: p.ax,
                ay: p.ay,
                mods: modsFrom(e),
            });

        },
        [computeVideoNormXY, modsFrom, sendControl, status, viewMode]
    );

    // IMPORTANT: do NOT use React's onWheel here.
    // React attaches wheel listeners as "passive" in many cases, so preventDefault causes console spam.
    // We attach a native wheel listener with { passive:false } in a useEffect below.

    const onKeyDownCapture = React.useCallback(
        (e: React.KeyboardEvent) => {
            if (status !== "connected") return;
            if (viewMode !== "desktop") return;

            e.preventDefault();
            sendControl({
                type: "key.down",
                key: e.key,
                code: e.code,
                repeat: e.repeat,
                mods: modsFrom(e),
            });
        },
        [modsFrom, sendControl, status, viewMode]
    );

    const onKeyUpCapture = React.useCallback(
        (e: React.KeyboardEvent) => {
            if (status !== "connected") return;
            if (viewMode !== "desktop") return;

            e.preventDefault();
            sendControl({
                type: "key.up",
                key: e.key,
                code: e.code,
                repeat: e.repeat,
                mods: modsFrom(e),
            });
        },
        [modsFrom, sendControl, status, viewMode]
    );

    const onFocus = React.useCallback(() => {
        if (status !== "connected") return;
        if (viewMode !== "desktop") return;
        sendControl({ type: "focus" });
    }, [sendControl, status, viewMode]);

    const onBlur = React.useCallback(() => {
        if (status !== "connected") return;
        if (viewMode !== "desktop") return;
        sendControl({ type: "blur" });
    }, [sendControl, status, viewMode]);

    // Native wheel listener (non-passive) to stop the console spam + prevent scroll while controlling desktop
    React.useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const onWheelNative = (e: WheelEvent) => {
            if (status !== "connected") return;
            if (viewMode !== "desktop") return;

            // stop browser scroll/zoom inside the remote viewport
            e.preventDefault();

            sendControl({
                type: "mouse.wheel",
                dx: e.deltaX,
                dy: e.deltaY,
                mode: e.deltaMode === 0 ? "pixel" : e.deltaMode === 1 ? "line" : "page",
                mods: {
                    alt: !!(e as any).altKey,
                    ctrl: !!(e as any).ctrlKey,
                    shift: !!(e as any).shiftKey,
                    meta: !!(e as any).metaKey,
                },
            });

        };

        el.addEventListener("wheel", onWheelNative, { passive: false });

        return () => {
            try {
                el.removeEventListener("wheel", onWheelNative as any);
            } catch { }
        };
    }, [sendControl, status, viewMode]);

    const sendChat = React.useCallback(() => {
        const t = chatText.trim();
        if (!t) return;

        addChat("me", t);
        setChatText("");

        const dc = chatDcRef.current;
        if (!dc || dc.readyState !== "open") return;
        try {
            dc.send(JSON.stringify({ type: "chat.msg", text: t }));
        } catch { }
    }, [addChat, chatText]);

    const pushClipboardToRemote = React.useCallback(async () => {
        let text = clipboardText;
        try {
            if (navigator.clipboard?.readText) {
                text = await navigator.clipboard.readText();
                setClipboardText(text);
            }
        } catch { }

        const dc = clipDcRef.current;
        if (!dc || dc.readyState !== "open") return;
        try {
            dc.send(JSON.stringify({ type: "clipboard.set", text: String(text || "") }));
        } catch { }
    }, [clipboardText]);

    const pullClipboardFromRemote = React.useCallback(() => {
        const dc = clipDcRef.current;
        if (!dc || dc.readyState !== "open") return;
        try {
            dc.send(JSON.stringify({ type: "clipboard.get" }));
        } catch { }
    }, []);

    const copyLocalClipboardBox = React.useCallback(async () => {
        try {
            await navigator.clipboard.writeText(clipboardText || "");
        } catch { }
    }, [clipboardText]);

    // In-page Connect should auto-popout.
    const connectOrPopout = React.useCallback(() => {
        if (popout) {
            void start();
            return;
        }

        try {
            const url = buildPopoutUrl(true);
            const w = window.open(url, "_blank", "noopener,noreferrer,width=1400,height=900");
            if (!w) {
                void start();
                return;
            }
            try {
                w.focus();
            } catch { }
        } catch {
            void start();
        }
    }, [popout, start]);

    React.useEffect(() => {
        if (process.env.NODE_ENV !== "development") return;

        (window as any).__rc = {
            get pc() {
                return pcRef.current;
            },
            get ws() {
                return wsRef.current;
            },
            get termDc() {
                return termDcRef.current;
            },
            get controlDc() {
                return controlDcRef.current;
            },
            get chatDc() {
                return chatDcRef.current;
            },
            get clipDc() {
                return clipDcRef.current;
            },
        };

        return () => {
            try {
                delete (window as any).__rc;
            } catch { }
        };
    }, []);

    React.useEffect(() => {
        return () => {
            try {
                closeAll("Unmount");
            } catch { }
        };
    }, [closeAll]);

    const isBusy =
        status === "creating-session" ||
        status === "connecting-ws" ||
        status === "waiting-for-agent" ||
        status === "negotiating";

    const showNotConnectedOverlay = status !== "connected";
    const showNoVideoWarning = status === "connected" && viewMode === "desktop" && !hasVideoTrack;

    // --- Popout layout ---
    if (popout) {
        return (
            <div className="h-screen w-full flex flex-col min-h-0">
                <div className="shrink-0 border-b bg-background/90 backdrop-blur">
                    <div className="h-12 px-3 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex items-center gap-2">
                            <div className="text-sm font-semibold truncate">Remote Desktop</div>
                            <span className="hidden sm:inline rounded-md border px-2 py-1 text-xs text-muted-foreground">
                                {status === "connected" ? "connected" : status}
                            </span>
                            {sessionId ? (
                                <span className="hidden md:inline rounded-md border px-2 py-1 text-xs text-muted-foreground">
                                    <span className="text-foreground font-medium">Session</span>{" "}
                                    <code className="text-[11px]">{sessionId}</code>
                                </span>
                            ) : null}
                            {status === "connected" ? (
                                <span className="hidden lg:inline rounded-md border px-2 py-1 text-xs text-muted-foreground">
                                    Video:{" "}
                                    <span className={hasVideoTrack ? "text-foreground font-medium" : "text-yellow-700 font-medium"}>
                                        {hasVideoTrack ? "track" : "no track"}
                                    </span>
                                </span>
                            ) : null}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <div className="hidden sm:flex rounded-md border overflow-hidden">
                                <Button
                                    type="button"
                                    variant={viewMode === "desktop" ? "default" : "ghost"}
                                    size="sm"
                                    className="rounded-none gap-2"
                                    onClick={() => setViewMode("desktop")}
                                    disabled={status !== "connected"}
                                    title="Desktop"
                                >
                                    <Monitor className="h-4 w-4" />
                                    Desktop
                                </Button>
                                <Button
                                    type="button"
                                    variant={viewMode === "terminal" ? "default" : "ghost"}
                                    size="sm"
                                    className="rounded-none gap-2"
                                    onClick={() => setViewMode("terminal")}
                                    disabled={status !== "connected"}
                                    title="Terminal"
                                >
                                    <Terminal className="h-4 w-4" />
                                    Terminal
                                </Button>
                            </div>

                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setVideoFit((p) => (p === "contain" ? "cover" : "contain"))}
                                disabled={viewMode !== "desktop"}
                                title="Toggle fit mode"
                            >
                                Fit: {videoFit}
                            </Button>

                            {status !== "connected" ? (
                                <Button
                                    variant="default"
                                    size="sm"
                                    onClick={start}
                                    disabled={!canStart || isBusy}
                                    className="gap-2"
                                    title={!canStart ? "Missing agentUuid on device" : "Start remote console"}
                                >
                                    <PlugZap className="h-4 w-4" />
                                    Connect
                                </Button>
                            ) : (
                                <Button variant="destructive" size="sm" onClick={stop} className="gap-2" title="Stop session">
                                    <Power className="h-4 w-4" />
                                    Disconnect
                                </Button>
                            )}

                            <Button variant="outline" size="icon" onClick={() => window.close()} title="Close window">
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {err ? (
                        <div className="px-3 pb-2">
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{err}</div>
                        </div>
                    ) : null}
                </div>

                <div className="flex-1 min-h-0 flex">
                    <div className="flex-1 min-h-0 p-2">
                        <div
                            ref={containerRef}
                            className="relative h-full w-full rounded-lg border bg-black overflow-hidden outline-none touch-none"
                            style={{ touchAction: "none" }}
                            tabIndex={0}
                            onMouseMove={onMouseMove}
                            onMouseDown={onMouseDown}
                            onMouseUp={onMouseUp}
                            onKeyDown={viewMode === "terminal" ? onTerminalKeyDown : onKeyDownCapture}
                            onKeyUp={viewMode === "desktop" ? onKeyUpCapture : undefined}
                            onFocus={onFocus}
                            onBlur={onBlur}
                            onClick={() => containerRef.current?.focus()}
                            onContextMenu={(e) => e.preventDefault()}
                        >
                            <video
                                ref={videoRef}
                                className={[
                                    "absolute inset-0 h-full w-full",
                                    videoFit === "contain" ? "object-contain" : "object-cover",
                                    viewMode === "desktop" && status === "connected" ? "opacity-100" : "opacity-0 pointer-events-none",
                                ].join(" ")}
                                autoPlay
                                playsInline
                                muted
                            />

                            {showNotConnectedOverlay ? (
                                <div className="absolute inset-0 flex items-center justify-center text-center p-6">
                                    <div className="max-w-md">
                                        <div className="text-white font-semibold">Not connected</div>
                                        <div className="mt-2 text-sm text-white/70">
                                            Click <b>Connect</b> to start the session.
                                            {status === "waiting-for-agent" ? (
                                                <>
                                                    <br />
                                                    Waiting for agent…
                                                </>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            ) : viewMode === "terminal" ? (
                                <div className="absolute inset-0 flex flex-col">
                                    <div
                                        ref={termOutRef}
                                        className="flex-1 min-h-0 overflow-auto px-3 py-2 text-[13px] leading-5 text-white font-mono whitespace-pre-wrap break-words"
                                    >
                                        {termOut}
                                    </div>

                                    <div className="border-t border-white/10 px-3 py-2 text-[13px] leading-5 text-white font-mono">
                                        <span className="opacity-70">› </span>
                                        <span>{termLine}</span>
                                        <span className="inline-block w-[8px] animate-pulse opacity-70">▌</span>
                                    </div>

                                    <div className="px-3 pb-2 text-[11px] text-white/60">
                                        Enter submits line • Backspace edits locally • Ctrl/Cmd+V pastes
                                    </div>
                                </div>
                            ) : (
                                <div className="absolute bottom-3 left-3 space-y-2">
                                    <div className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white/80">
                                        Desktop control live • <code className="text-white">rc.control</code>
                                    </div>

                                    {showNoVideoWarning ? (
                                        <div className="max-w-sm rounded-md border border-yellow-400/30 bg-yellow-500/10 px-2 py-1 text-[11px] text-yellow-100">
                                            Connected, but no video track received yet.
                                        </div>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="w-[360px] max-w-[38vw] min-w-[320px] border-l bg-background flex flex-col min-h-0">
                        <div className="px-3 py-2 flex items-center justify-between">
                            <div className="flex items-center gap-2 font-medium">
                                <MessageSquare className="h-4 w-4" />
                                Chat
                            </div>
                            <div className="text-xs text-muted-foreground">{status === "connected" ? "Live" : "Offline"}</div>
                        </div>
                        <Separator />

                        <div className="flex-1 min-h-0 overflow-auto p-3 space-y-2">
                            {chat.length === 0 ? (
                                <div className="text-sm text-muted-foreground">No messages yet.</div>
                            ) : (
                                chat.map((m) => (
                                    <div
                                        key={m.id}
                                        className={[
                                            "rounded-md border px-2 py-1.5 text-sm",
                                            m.from === "me" ? "bg-muted/40" : "bg-background",
                                        ].join(" ")}
                                    >
                                        <div className="text-xs text-muted-foreground">
                                            {m.from === "me" ? "You" : "Remote"} · {new Date(m.at).toLocaleTimeString()}
                                        </div>
                                        <div className="mt-0.5 whitespace-pre-wrap break-words">{m.text}</div>
                                    </div>
                                ))
                            )}
                        </div>

                        <Separator />
                        <div className="p-3 flex gap-2">
                            <Input
                                value={chatText}
                                onChange={(e) => setChatText(e.target.value)}
                                placeholder="Message…"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        sendChat();
                                    }
                                }}
                                disabled={status !== "connected"}
                            />
                            <Button onClick={sendChat} disabled={status !== "connected"} title="Send">
                                <Send className="h-4 w-4" />
                            </Button>
                        </div>

                        <div className="px-3 pb-3 space-y-2">
                            <div className="rounded-md border p-3 text-sm">
                                <div className="font-medium">Clipboard</div>
                                <div className="mt-2 flex gap-2">
                                    <Input value={clipboardText} onChange={(e) => setClipboardText(e.target.value)} placeholder="Clipboard text…" />
                                    <Button variant="outline" size="icon" onClick={copyLocalClipboardBox} title="Copy to system clipboard">
                                        <CopyIcon className="h-4 w-4" />
                                    </Button>
                                </div>

                                <div className="mt-2 flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2 flex-1"
                                        onClick={pullClipboardFromRemote}
                                        disabled={status !== "connected"}
                                        title="Request clipboard from remote"
                                    >
                                        <Clipboard className="h-4 w-4" />
                                        Pull
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2 flex-1"
                                        onClick={pushClipboardToRemote}
                                        disabled={status !== "connected"}
                                        title="Push your clipboard to remote"
                                    >
                                        <Send className="h-4 w-4" />
                                        Push
                                    </Button>
                                </div>
                            </div>

                            {lastTrackInfo ? (
                                <div className="text-[11px] text-muted-foreground">
                                    Track: <code>{lastTrackInfo}</code>
                                </div>
                            ) : null}

                            <div className="text-[11px] text-muted-foreground">
                                Control: <code>rc.control</code> • Terminal: <code>rc.input</code>
                                <br />
                                Chat: <code>rc.chat</code> • Clipboard: <code>rc.clipboard</code>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // --- In-page layout ---
    return (
        <div className="h-full min-h-0">
            <Card className="h-full min-h-0 flex flex-col">
                <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <CardTitle className="truncate">Remote Console</CardTitle>
                            <CardDescription className="truncate">
                                WebRTC (video recvonly + DataChannels). Device: <code className="text-xs">{deviceId}</code>
                            </CardDescription>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() => {
                                    try {
                                        const url = buildPopoutUrl(true);
                                        window.open(url, "_blank", "noopener,noreferrer,width=1400,height=900");
                                    } catch { }
                                }}
                                title="Open in new window"
                            >
                                <ExternalLink className="h-4 w-4" />
                                Pop out
                            </Button>

                            {status !== "connected" ? (
                                <Button
                                    variant="default"
                                    size="sm"
                                    onClick={connectOrPopout}
                                    disabled={!canStart || isBusy}
                                    className="gap-2"
                                    title={!canStart ? "Missing agentUuid on device" : "Start remote console"}
                                >
                                    <PlugZap className="h-4 w-4" />
                                    Connect
                                </Button>
                            ) : (
                                <Button variant="destructive" size="sm" onClick={stop} className="gap-2" title="Stop session">
                                    <Power className="h-4 w-4" />
                                    Disconnect
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-md border px-2 py-1">
                            Status: <span className="text-foreground font-medium">{status}</span>
                        </span>
                        {sessionId ? (
                            <span className="rounded-md border px-2 py-1">
                                Session: <code className="text-[11px]">{sessionId}</code>
                            </span>
                        ) : null}
                        {status === "connected" ? (
                            <span className="rounded-md border px-2 py-1">
                                Video:{" "}
                                <span className={hasVideoTrack ? "text-foreground font-medium" : "text-yellow-700 font-medium"}>
                                    {hasVideoTrack ? "track received" : "no track yet"}
                                </span>
                            </span>
                        ) : null}
                    </div>

                    {lastTrackInfo ? (
                        <div className="mt-2 text-[11px] text-muted-foreground">
                            Track: <code>{lastTrackInfo}</code>
                        </div>
                    ) : null}

                    {err ? (
                        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{err}</div>
                    ) : null}
                </CardHeader>

                <CardContent className="flex-1 min-h-0">
                    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-4 gap-3">
                        <div className="lg:col-span-3 flex min-h-0 flex-col gap-3">
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-sm text-muted-foreground">
                                    {viewMode === "desktop" ? (
                                        <>Desktop mode: click inside to control • scroll wheel works • keyboard forwards to remote</>
                                    ) : (
                                        <>
                                            Terminal mode: click inside to type • <b>Enter</b> submits the line
                                        </>
                                    )}
                                </div>

                                <div className="flex items-center gap-2">
                                    <div className="flex rounded-md border overflow-hidden">
                                        <Button
                                            type="button"
                                            variant={viewMode === "desktop" ? "default" : "ghost"}
                                            size="sm"
                                            className="rounded-none gap-2"
                                            onClick={() => setViewMode("desktop")}
                                            disabled={status !== "connected"}
                                            title="Desktop view"
                                        >
                                            <Monitor className="h-4 w-4" />
                                            Desktop
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={viewMode === "terminal" ? "default" : "ghost"}
                                            size="sm"
                                            className="rounded-none gap-2"
                                            onClick={() => setViewMode("terminal")}
                                            disabled={status !== "connected"}
                                            title="Terminal view"
                                        >
                                            <Terminal className="h-4 w-4" />
                                            Terminal
                                        </Button>
                                    </div>

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setVideoFit((p) => (p === "contain" ? "cover" : "contain"))}
                                        disabled={viewMode !== "desktop"}
                                        title="Toggle fit mode"
                                    >
                                        Fit: {videoFit}
                                    </Button>

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2"
                                        onClick={pullClipboardFromRemote}
                                        disabled={status !== "connected"}
                                        title="Request clipboard from remote"
                                    >
                                        <Clipboard className="h-4 w-4" />
                                        Pull Clipboard
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2"
                                        onClick={pushClipboardToRemote}
                                        disabled={status !== "connected"}
                                        title="Push your clipboard to remote"
                                    >
                                        <Send className="h-4 w-4" />
                                        Push Clipboard
                                    </Button>
                                </div>
                            </div>

                            <div
                                ref={containerRef}
                                className="relative flex-1 min-h-0 rounded-lg border bg-black overflow-hidden outline-none touch-none"
                                style={{ touchAction: "none" }}
                                tabIndex={0}
                                onMouseMove={onMouseMove}
                                onMouseDown={onMouseDown}
                                onMouseUp={onMouseUp}
                                onKeyDown={viewMode === "terminal" ? onTerminalKeyDown : onKeyDownCapture}
                                onKeyUp={viewMode === "desktop" ? onKeyUpCapture : undefined}
                                onFocus={onFocus}
                                onBlur={onBlur}
                                onClick={() => containerRef.current?.focus()}
                                onContextMenu={(e) => e.preventDefault()}
                            >
                                <video
                                    ref={videoRef}
                                    className={[
                                        "absolute inset-0 h-full w-full",
                                        videoFit === "contain" ? "object-contain" : "object-cover",
                                        viewMode === "desktop" && status === "connected" ? "opacity-100" : "opacity-0 pointer-events-none",
                                    ].join(" ")}
                                    autoPlay
                                    playsInline
                                    muted
                                />

                                {showNotConnectedOverlay ? (
                                    <div className="absolute inset-0 flex items-center justify-center text-center p-6">
                                        <div className="max-w-md">
                                            <div className="text-white font-semibold">Remote Console not connected</div>
                                            <div className="mt-2 text-sm text-white/70">
                                                Click <b>Connect</b> to open the popout window and start a WebRTC session.
                                                <br />
                                                {status === "waiting-for-agent" ? (
                                                    <>
                                                        Waiting for the agent to attach to this session…
                                                        <br />
                                                        (Once the server emits <b>session.ready</b>, we create the offer.)
                                                    </>
                                                ) : (
                                                    <>
                                                        This panel negotiates <b>video recvonly</b> + DataChannels (control, terminal, chat,
                                                        clipboard).
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ) : viewMode === "terminal" ? (
                                    <div className="absolute inset-0 flex flex-col">
                                        <div
                                            ref={termOutRef}
                                            className="flex-1 min-h-0 overflow-auto px-3 py-2 text-[13px] leading-5 text-white font-mono whitespace-pre-wrap break-words"
                                        >
                                            {termOut}
                                        </div>

                                        <div className="border-t border-white/10 px-3 py-2 text-[13px] leading-5 text-white font-mono">
                                            <span className="opacity-70">› </span>
                                            <span>{termLine}</span>
                                            <span className="inline-block w-[8px] animate-pulse opacity-70">▌</span>
                                        </div>

                                        <div className="px-3 pb-2 text-[11px] text-white/60">
                                            Enter submits line • Backspace edits locally • Ctrl/Cmd+V pastes
                                        </div>
                                    </div>
                                ) : (
                                    <div className="absolute bottom-3 left-3 space-y-2">
                                        <div className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white/80">
                                            Desktop control live • Channel: <code className="text-white">rc.control</code>
                                        </div>

                                        {showNoVideoWarning ? (
                                            <div className="max-w-sm rounded-md border border-yellow-400/30 bg-yellow-500/10 px-2 py-1 text-[11px] text-yellow-100">
                                                Connected, but no video track received yet.
                                                <br />
                                                Your agent must attach and send a video track (screen capture + encoder).
                                            </div>
                                        ) : null}
                                    </div>
                                )}
                            </div>

                            <div className="rounded-md border p-3 text-sm">
                                <div className="font-medium">Clipboard (local view)</div>
                                <div className="mt-2 flex gap-2">
                                    <Input value={clipboardText} onChange={(e) => setClipboardText(e.target.value)} placeholder="Clipboard text…" />
                                    <Button variant="outline" size="icon" onClick={copyLocalClipboardBox} title="Copy to system clipboard">
                                        <CopyIcon className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="lg:col-span-1 flex min-h-0 flex-col rounded-lg border">
                            <div className="px-3 py-2 flex items-center justify-between">
                                <div className="flex items-center gap-2 font-medium">
                                    <MessageSquare className="h-4 w-4" />
                                    Chat
                                </div>
                                <div className="text-xs text-muted-foreground">{status === "connected" ? "Live" : "Offline"}</div>
                            </div>
                            <Separator />

                            <div className="flex-1 min-h-0 overflow-auto p-3 space-y-2">
                                {chat.length === 0 ? (
                                    <div className="text-sm text-muted-foreground">No messages yet.</div>
                                ) : (
                                    chat.map((m) => (
                                        <div
                                            key={m.id}
                                            className={[
                                                "rounded-md border px-2 py-1.5 text-sm",
                                                m.from === "me" ? "bg-muted/40" : "bg-background",
                                            ].join(" ")}
                                        >
                                            <div className="text-xs text-muted-foreground">
                                                {m.from === "me" ? "You" : "Remote"} · {new Date(m.at).toLocaleTimeString()}
                                            </div>
                                            <div className="mt-0.5 whitespace-pre-wrap break-words">{m.text}</div>
                                        </div>
                                    ))
                                )}
                            </div>

                            <Separator />
                            <div className="p-3 flex gap-2">
                                <Input
                                    value={chatText}
                                    onChange={(e) => setChatText(e.target.value)}
                                    placeholder="Message…"
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            sendChat();
                                        }
                                    }}
                                    disabled={status !== "connected"}
                                />
                                <Button onClick={sendChat} disabled={status !== "connected"} title="Send">
                                    <Send className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="px-3 pb-3 text-[11px] text-muted-foreground">
                                Control uses <code>rc.control</code> • Terminal uses <code>rc.input</code>
                                <br />
                                Chat uses <code>rc.chat</code> • Clipboard uses <code>rc.clipboard</code>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
