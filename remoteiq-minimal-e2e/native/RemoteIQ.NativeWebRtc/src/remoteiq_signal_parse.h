// native/RemoteIQ.NativeWebRtc/src/remoteiq_signal_parse.h
#pragma once

#include <string>

namespace riq
{
    // NOTE:
    // Chromium-style checker treats structs holding std::string as "complex"
    // and requires an explicit out-of-line constructor and destructor.
    struct Signal
    {
        Signal();
        ~Signal();

        Signal(const Signal &) = default;
        Signal &operator=(const Signal &) = default;
        Signal(Signal &&) noexcept = default;
        Signal &operator=(Signal &&) noexcept = default;

        // Candidate fields
        bool isCandidate = false;
        std::string candidate;
        std::string sdpMid;
        int sdpMLineIndex = -1;

        // Offer/Answer fields
        std::string type; // "offer" | "answer"
        std::string sdp;  // SDP blob
    };

    // Parses:
    //  - ICE candidate: {"candidate":"...","sdpMid":"0","sdpMLineIndex":0}
    //  - SDP offer/answer: {"type":"offer","sdp":"..."} or {"type":"answer","sdp":"..."}
    //
    // Returns true if it finds either a candidate OR a type/sdp pair.
    bool TryParseSignal(const std::string &json, Signal &out);
}
