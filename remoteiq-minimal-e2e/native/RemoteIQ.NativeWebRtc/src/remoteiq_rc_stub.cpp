// native/RemoteIQ.NativeWebRtc/src/remoteiq_rc_stub.cpp

#include "remoteiq_rc.h"
#include <string>
#include <mutex>
#include <cstdint>

struct PeerStub
{
    rc_callbacks_t cbs{};
    std::mutex m;
    bool closed = false;
    bool answered = false;

    void log(int lvl, const std::string &msg)
    {
        if (cbs.on_log)
            cbs.on_log(lvl, msg.c_str(), cbs.user);
    }

    void emit_signal(const std::string &json)
    {
        if (cbs.on_signal)
            cbs.on_signal(json.c_str(), cbs.user);
    }

    void emit_state(int st)
    {
        if (cbs.on_connection_state)
            cbs.on_connection_state(st, cbs.user);
    }

    void emit_data(const char *label, const uint8_t *data, int len)
    {
        if (cbs.on_data_message && label && data && len > 0)
            cbs.on_data_message(label, data, len, cbs.user);
    }
};

static PeerStub *as_peer(rc_peer_handle_t h) { return reinterpret_cast<PeerStub *>(h); }

int rc_abi_version(void)
{
    return 1;
}

// Very small helper: just detect a JSON key presence by substring.
// This is a stub; real impl will use a JSON parser.
static bool json_contains(const std::string &s, const char *needle)
{
    return needle && (s.find(needle) != std::string::npos);
}

// A synthetic SDP. It is NOT meant to be accepted by a real browser for a real connection.
// It exists so your backend/client pipeline sees a valid-looking {type:"answer", sdp:"..."} object.
static const char *kStubAnswerSdpJsonEscaped =
    "v=0\\r\\n"
    "o=- 0 0 IN IP4 127.0.0.1\\r\\n"
    "s=-\\r\\n"
    "t=0 0\\r\\n"
    "a=group:BUNDLE 0 1\\r\\n"
    "a=extmap-allow-mixed\\r\\n"
    "a=msid-semantic: WMS\\r\\n"
    // video m-line (placeholder)
    "m=video 9 UDP/TLS/RTP/SAVPF 102\\r\\n"
    "c=IN IP4 0.0.0.0\\r\\n"
    "a=mid:0\\r\\n"
    "a=setup:active\\r\\n"
    "a=rtcp-mux\\r\\n"
    "a=rtcp-rsize\\r\\n"
    "a=sendonly\\r\\n"
    "a=rtpmap:102 H264/90000\\r\\n"
    "a=fmtp:102 packetization-mode=1;profile-level-id=42e01f;level-asymmetry-allowed=1\\r\\n"
    // datachannel m-line
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\\r\\n"
    "c=IN IP4 0.0.0.0\\r\\n"
    "a=mid:1\\r\\n"
    "a=setup:active\\r\\n"
    "a=sctp-port:5000\\r\\n"
    "a=max-message-size:262144\\r\\n";

int rc_peer_create(const char * /*config_json_utf8*/, const rc_callbacks_t *cbs, rc_peer_handle_t *out_handle)
{
    if (!out_handle || !cbs)
        return -1;

    auto *p = new PeerStub();
    p->cbs = *cbs;

    p->log(2, "Stub native peer created.");

    // Emit "not-yet-connected" state first. Your C# treats state==2 as connected.
    p->emit_state(1); // 1 = "connecting" (stub)

    // Heartbeat so you know the DLL loaded & created a peer
    p->emit_signal("{\"type\":\"noop-native\",\"msg\":\"stub-ready\"}");

    *out_handle = reinterpret_cast<rc_peer_handle_t>(p);
    return 0;
}

void rc_peer_destroy(rc_peer_handle_t handle)
{
    auto *p = as_peer(handle);
    if (!p)
        return;

    p->log(2, "Stub native peer destroyed.");
    delete p;
}

void rc_peer_close(rc_peer_handle_t handle, const char *reason_utf8)
{
    auto *p = as_peer(handle);
    if (!p)
        return;

    std::lock_guard<std::mutex> lk(p->m);
    p->closed = true;

    std::string r = reason_utf8 ? reason_utf8 : "closed";
    p->log(2, std::string("Stub peer close: ") + r);

    p->emit_state(4); // 4 = closed
}

void rc_peer_handle_signal(rc_peer_handle_t handle, const char *signal_json_utf8)
{
    auto *p = as_peer(handle);
    if (!p)
        return;

    std::string s = signal_json_utf8 ? signal_json_utf8 : "";

    {
        std::lock_guard<std::mutex> lk(p->m);
        if (p->closed)
            return;
    }

    p->log(2, std::string("Stub got signal: ") + s);

    // If this looks like an offer: emit an answer object.
    if (json_contains(s, "\"type\"") && json_contains(s, "offer"))
    {
        std::lock_guard<std::mutex> lk(p->m);
        if (!p->answered)
        {
            p->answered = true;

            // Send a fake answer so your backend pipeline moves forward.
            std::string answer = std::string("{\"type\":\"answer\",\"sdp\":\"") +
                                 kStubAnswerSdpJsonEscaped +
                                 "\"}";
            p->emit_signal(answer);

            // Now claim "connected" for wiring tests.
            p->emit_state(2);

            p->log(2, "Stub emitted synthetic answer + transitioned to connected.");
        }
        return;
    }

    // ICE candidate trickle from the browser/backend.
    if (json_contains(s, "\"candidate\""))
    {
        p->emit_signal("{\"type\":\"stub.ice.ack\"}");
        return;
    }

    // Everything else: ack
    p->emit_signal("{\"type\":\"stub.ack\"}");
}

int rc_peer_send(rc_peer_handle_t handle, const char *label_utf8, const uint8_t *data, int len)
{
    auto *p = as_peer(handle);
    if (!p)
        return -1;
    if (!label_utf8)
        return -2;

    {
        std::lock_guard<std::mutex> lk(p->m);
        if (p->closed)
            return -3;
    }

    if (!data || len <= 0)
        return 0;

    std::string label(label_utf8);

    // Echo paths (for end-to-end testing without real WebRTC):
    if (label == "rc.input")
    {
        p->emit_data("rc.input", data, len);
        return len;
    }

    if (label == "rc.control")
    {
        p->emit_data("rc.control", data, len);
        return len;
    }

    // Unknown label: echo anyway so you can observe behavior upstream.
    p->emit_data(label.c_str(), data, len);
    return len;
}

void rc_peer_set_video_enabled(rc_peer_handle_t, int) {}
void rc_peer_set_capture_params(rc_peer_handle_t, int, int, int) {}
void rc_peer_set_bitrate(rc_peer_handle_t, int, int) {}
void rc_peer_request_keyframe(rc_peer_handle_t) {}
