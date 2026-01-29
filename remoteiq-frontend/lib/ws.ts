// remoteiq-frontend/lib/ws.ts
type Listener = (msg: any) => void;

let socket: WebSocket | null = null;
const listeners = new Set<Listener>();

let openPromise: Promise<WebSocket> | null = null;
let openResolve: ((s: WebSocket) => void) | null = null;
let openReject: ((e: any) => void) | null = null;

const sendQueue: string[] = [];

function getBase(): string {
  // Prefer explicit env; fall back to dev backend
  return process.env.NEXT_PUBLIC_WS_BASE || "ws://localhost:3001/ws";
}

export function ensureSocket(): WebSocket {
  const base = getBase();

  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return socket;
  }

  socket = new WebSocket(base);

  // reset open promise
  openPromise = new Promise<WebSocket>((resolve, reject) => {
    openResolve = resolve;
    openReject = reject;
  });

  socket.onopen = () => {
    // flush queued sends
    while (sendQueue.length) {
      const frame = sendQueue.shift()!;
      try {
        socket?.send(frame);
      } catch {
        // if send fails, put it back and break
        sendQueue.unshift(frame);
        break;
      }
    }
    openResolve?.(socket!);
  };

  socket.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      for (const cb of Array.from(listeners)) cb(data);
    } catch {
      // ignore malformed frames
    }
  };

  socket.onerror = (err) => {
    openReject?.(err);
  };

  socket.onclose = () => {
    // allow reconnect on next ensureSocket call
    socket = null;
    openPromise = null;
    openResolve = null;
    openReject = null;
  };

  return socket;
}

export function whenSocketOpen(): Promise<WebSocket> {
  ensureSocket();
  if (!openPromise) {
    // should not happen, but keep it safe
    return Promise.resolve(socket as WebSocket);
  }
  return openPromise;
}

export function sendWs(msg: any) {
  const frame = JSON.stringify(msg);
  const s = ensureSocket();

  if (s.readyState === WebSocket.OPEN) {
    try {
      s.send(frame);
    } catch {
      sendQueue.push(frame);
    }
    return;
  }

  // queue until open
  sendQueue.push(frame);
}

export function onWsMessage(cb: Listener) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
