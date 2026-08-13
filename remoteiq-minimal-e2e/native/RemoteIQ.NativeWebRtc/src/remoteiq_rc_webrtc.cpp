// remoteiq_nativewebrtc/src/remoteiq_rc_webrtc.cpp

#include "remoteiq_rc_webrtc.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "api/create_peerconnection_factory.h"
#include "api/jsep.h"
#include "api/peer_connection_interface.h"
#include "api/scoped_refptr.h"

#include "api/audio_codecs/builtin_audio_decoder_factory.h"
#include "api/audio_codecs/builtin_audio_encoder_factory.h"
#include "api/video_codecs/builtin_video_decoder_factory.h"
#include "api/video_codecs/builtin_video_encoder_factory.h"

// Some WebRTC revs still ship these; newer ones may not.
#if __has_include("api/jsep_ice_candidate.h")
#include "api/jsep_ice_candidate.h"
#endif

#if __has_include("api/jsep_session_description.h")
#include "api/jsep_session_description.h"
#endif

// Some revs expose implementations here instead.
#if __has_include("pc/ice_candidate.h")
#include "pc/ice_candidate.h"
#endif

#if __has_include("pc/session_description.h")
#include "pc/session_description.h"
#endif

#include "rtc_base/copy_on_write_buffer.h"
#include "rtc_base/ref_counted_object.h"
#include "rtc_base/ssl_adapter.h"
#include "rtc_base/thread.h"

// Winsock initializer header has moved around over time.
#if __has_include("rtc_base/win/winsock_init.h")
#include "rtc_base/win/winsock_init.h"
#elif __has_include("rtc_base/win32_socket_init.h")
#include "rtc_base/win32_socket_init.h"
#endif

// cricket::Candidate header has moved around over time.
#if __has_include("api/candidate.h")
#include "api/candidate.h"
#elif __has_include("p2p/base/candidate.h")
#include "p2p/base/candidate.h"
#endif

namespace {

static std::string ToLower(std::string s) {
  for (auto& ch : s) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
  return s;
}

static bool StrEqI(const char* a, const char* b) {
  if (!a || !b) return false;
  return ToLower(a) == ToLower(b);
}

static bool StartsWith(const std::string& s, const char* pfx) {
  return s.rfind(pfx, 0) == 0;
}

static std::vector<std::string> SplitWS(const std::string& s) {
  std::istringstream iss(s);
  std::vector<std::string> parts;
  std::string tok;
  while (iss >> tok) parts.push_back(tok);
  return parts;
}

static void SplitLinesPreserve(const std::string& s, std::vector<std::string>& out, bool& had_crlf) {
  had_crlf = (s.find("\r\n") != std::string::npos);
  std::string norm;
  norm.reserve(s.size());
  for (char c : s) {
    if (c == '\r') continue;
    norm.push_back(c);
  }
  std::istringstream iss(norm);
  std::string line;
  while (std::getline(iss, line, '\n')) out.push_back(line);
}

static std::string JoinLines(const std::vector<std::string>& lines, bool crlf) {
  const char* sep = crlf ? "\r\n" : "\n";
  std::ostringstream oss;
  for (size_t i = 0; i < lines.size(); i++) {
    oss << lines[i] << sep;
  }
  return oss.str();
}

static std::optional<webrtc::SdpType> ParseSdpType(const char* type) {
  if (!type) return std::nullopt;
  if (StrEqI(type, "offer")) return webrtc::SdpType::kOffer;
  if (StrEqI(type, "answer")) return webrtc::SdpType::kAnswer;
  if (StrEqI(type, "pranswer")) return webrtc::SdpType::kPrAnswer;
  if (StrEqI(type, "rollback")) return webrtc::SdpType::kRollback;
  return std::nullopt;
}

static const char* SdpTypeToString(webrtc::SdpType t) {
  switch (t) {
    case webrtc::SdpType::kOffer: return "offer";
    case webrtc::SdpType::kAnswer: return "answer";
    case webrtc::SdpType::kPrAnswer: return "pranswer";
    case webrtc::SdpType::kRollback: return "rollback";
  }
  return "offer";
}

// --------------------------- SDP VP9 preference -----------------------------

static std::string PreferVp9InSdp(const std::string& sdp, bool strip_non_vp9) {
  std::vector<std::string> lines;
  bool crlf = false;
  SplitLinesPreserve(sdp, lines, crlf);

  std::map<int, std::string> pt_codec;
  std::map<int, int> rtx_apt;

  for (const auto& line : lines) {
    if (StartsWith(line, "a=rtpmap:")) {
      auto rest = line.substr(std::strlen("a=rtpmap:"));
      auto sp = rest.find(' ');
      if (sp == std::string::npos) continue;
      int pt = std::atoi(rest.substr(0, sp).c_str());
      auto enc = rest.substr(sp + 1);
      auto slash = enc.find('/');
      auto codec = (slash == std::string::npos) ? enc : enc.substr(0, slash);
      pt_codec[pt] = codec;
    }
    if (StartsWith(line, "a=fmtp:")) {
      auto rest = line.substr(std::strlen("a=fmtp:"));
      auto sp = rest.find(' ');
      if (sp == std::string::npos) continue;
      int pt = std::atoi(rest.substr(0, sp).c_str());
      auto params = rest.substr(sp + 1);
      auto pos = params.find("apt=");
      if (pos != std::string::npos) {
        int apt = std::atoi(params.substr(pos + 4).c_str());
        rtx_apt[pt] = apt;
      }
    }
  }

  bool has_vp9 = false;
  for (const auto& kv : pt_codec) {
    if (ToLower(kv.second) == "vp9") { has_vp9 = true; break; }
  }
  if (!has_vp9) return sdp;

  int m_video_idx = -1;
  for (int i = 0; i < (int)lines.size(); i++) {
    if (StartsWith(lines[i], "m=video ")) { m_video_idx = i; break; }
  }
  if (m_video_idx < 0) return sdp;

  auto parts = SplitWS(lines[m_video_idx]);
  if (parts.size() < 4) return sdp;

  std::vector<int> pts;
  for (size_t i = 3; i < parts.size(); i++) pts.push_back(std::atoi(parts[i].c_str()));

  auto is_vp9 = [&](int pt) {
    auto it = pt_codec.find(pt);
    return it != pt_codec.end() && ToLower(it->second) == "vp9";
  };
  auto is_rtx_for_vp9 = [&](int pt) {
    auto itc = pt_codec.find(pt);
    if (itc == pt_codec.end() || ToLower(itc->second) != "rtx") return false;
    auto ita = rtx_apt.find(pt);
    return ita != rtx_apt.end() && is_vp9(ita->second);
  };

  std::vector<int> vp9_first, rest;
  for (int pt : pts) {
    if (is_vp9(pt) || is_rtx_for_vp9(pt)) vp9_first.push_back(pt);
    else rest.push_back(pt);
  }

  std::vector<int> new_pts = vp9_first;
  if (!strip_non_vp9) new_pts.insert(new_pts.end(), rest.begin(), rest.end());

  std::ostringstream m;
  m << parts[0] << " " << parts[1] << " " << parts[2];
  for (int pt : new_pts) m << " " << pt;
  lines[m_video_idx] = m.str();

  return JoinLines(lines, crlf);
}

// --------------------------- API compat (SFINAE) ----------------------------

template <typename PC>
static auto CreateDataChannelTry(PC* pc, const std::string& label, const webrtc::DataChannelInit& init, int)
    -> decltype(pc->CreateDataChannel(label, &init)) {
  return pc->CreateDataChannel(label, &init);
}

template <typename PC>
static auto CreateDataChannelTry(PC* pc, const std::string& label, const webrtc::DataChannelInit& init, long)
    -> decltype(pc->CreateDataChannelOrError(label, &init).value()) {
  auto r = pc->CreateDataChannelOrError(label, &init);
  if (!r.ok()) return rtc::scoped_refptr<webrtc::DataChannelInterface>(nullptr);
  return r.value();
}

template <typename PC>
static rtc::scoped_refptr<webrtc::DataChannelInterface> CreateDataChannelCompat(
    PC* pc, const std::string& label, const webrtc::DataChannelInit& init) {
  return CreateDataChannelTry(pc, label, init, 0);
}

// CreateSessionDescription compat:
// - Newer: CreateSessionDescription(SdpType, absl::string_view, SdpParseError*) -> unique_ptr
// - Older: CreateSessionDescription(std::string, std::string, SdpParseError*) -> raw pointer
static std::unique_ptr<webrtc::SessionDescriptionInterface> CreateSessionDescriptionCompat(
    const std::string& type_str,
    const std::string& sdp,
    std::string* out_error) {
  webrtc::SdpParseError err;

  // Try enum overload first (newer).
  if (auto t = ParseSdpType(type_str.c_str())) {
    struct EnumTry {
      static auto Call(webrtc::SdpType t, const std::string& s, webrtc::SdpParseError* e, int)
          -> decltype(webrtc::CreateSessionDescription(t, s, e)) {
        return webrtc::CreateSessionDescription(t, s, e);
      }
      static std::unique_ptr<webrtc::SessionDescriptionInterface> Call(webrtc::SdpType, const std::string&, webrtc::SdpParseError*, long) {
        return nullptr;
      }
    };

    auto up = EnumTry::Call(*t, sdp, &err, 0);
    if (up) return up;
  }

  // Fall back to string overload (older).
  struct StrTry {
    static auto Call(const std::string& t, const std::string& s, webrtc::SdpParseError* e, int)
        -> decltype(webrtc::CreateSessionDescription(t, s, e)) {
      return webrtc::CreateSessionDescription(t, s, e);
    }
    static webrtc::SessionDescriptionInterface* Call(const std::string&, const std::string&, webrtc::SdpParseError*, long) {
      return nullptr;
    }
  };

  if (auto* d = StrTry::Call(type_str, sdp, &err, 0)) {
    return std::unique_ptr<webrtc::SessionDescriptionInterface>(d);
  }

  if (out_error) *out_error = "SDP parse error: " + err.description + " line=" + err.line;
  return nullptr;
}

// SetLocal/RemoteDescription signature changes across revs.
// Old: SetLocalDescription(observer, desc*)
// New: SetLocalDescription(std::unique_ptr<...>, observer)  OR  SetLocalDescription(observer, std::unique_ptr<...>)
template <typename PC, typename OBS>
static auto SetLocalDescriptionTry(PC* pc, OBS* obs, std::unique_ptr<webrtc::SessionDescriptionInterface> desc, int)
    -> decltype(pc->SetLocalDescription(obs, desc.release()), void()) {
  pc->SetLocalDescription(obs, desc.release());
}

template <typename PC, typename OBS>
static auto SetLocalDescriptionTry(PC* pc, OBS* obs, std::unique_ptr<webrtc::SessionDescriptionInterface> desc, long)
    -> decltype(pc->SetLocalDescription(std::move(desc), obs), void()) {
  pc->SetLocalDescription(std::move(desc), obs);
}

template <typename PC, typename OBS>
static void SetLocalDescriptionCompat(PC* pc, OBS* obs, std::unique_ptr<webrtc::SessionDescriptionInterface> desc) {
  SetLocalDescriptionTry(pc, obs, std::move(desc), 0);
}

template <typename PC, typename OBS>
static auto SetRemoteDescriptionTry(PC* pc, OBS* obs, std::unique_ptr<webrtc::SessionDescriptionInterface> desc, int)
    -> decltype(pc->SetRemoteDescription(obs, desc.release()), void()) {
  pc->SetRemoteDescription(obs, desc.release());
}

template <typename PC, typename OBS>
static auto SetRemoteDescriptionTry(PC* pc, OBS* obs, std::unique_ptr<webrtc::SessionDescriptionInterface> desc, long)
    -> decltype(pc->SetRemoteDescription(std::move(desc), obs), void()) {
  pc->SetRemoteDescription(std::move(desc), obs);
}

template <typename PC, typename OBS>
static void SetRemoteDescriptionCompat(PC* pc, OBS* obs, std::unique_ptr<webrtc::SessionDescriptionInterface> desc) {
  SetRemoteDescriptionTry(pc, obs, std::move(desc), 0);
}

// Desc type string compat.
template <typename D>
static auto GetTypeStrTry(const D* d, int) -> decltype(d->type(), std::string()) {
  return d->type();
}
template <typename D>
static auto GetTypeStrTry(const D* d, long) -> decltype(d->GetType(), std::string()) {
  return std::string(SdpTypeToString(d->GetType()));
}
template <typename D>
static std::string GetTypeStrCompat(const D* d) {
  // Prefer d->type() if present; else d->GetType()
  return GetTypeStrTry(d, 0);
}

// --------------------------- observers (compat) -----------------------------

class RcSetDescObserver final : public webrtc::SetSessionDescriptionObserver {
 public:
  explicit RcSetDescObserver(std::function<void(bool, const std::string&)> cb) : cb_(std::move(cb)) {}

  void OnSuccess() /*override*/ { if (cb_) cb_(true, ""); }

  // Newer WebRTC
  void OnFailure(webrtc::RTCError error) /*override*/ {
    if (cb_) cb_(false, std::string(error.message()));
  }
  // Older WebRTC
  void OnFailure(const std::string& error) /*override*/ {
    if (cb_) cb_(false, error);
  }

 private:
  std::function<void(bool, const std::string&)> cb_;
};

class RcCreateDescObserver final : public webrtc::CreateSessionDescriptionObserver {
 public:
  RcCreateDescObserver(std::function<void(webrtc::SessionDescriptionInterface*)> ok,
                       std::function<void(const std::string&)> fail)
      : ok_(std::move(ok)), fail_(std::move(fail)) {}

  void OnSuccess(webrtc::SessionDescriptionInterface* desc) /*override*/ {
    if (ok_) ok_(desc);
  }

  // Newer
  void OnFailure(webrtc::RTCError error) /*override*/ {
    if (fail_) fail_(std::string(error.message()));
  }
  // Older
  void OnFailure(const std::string& error) /*override*/ {
    if (fail_) fail_(error);
  }

 private:
  std::function<void(webrtc::SessionDescriptionInterface*)> ok_;
  std::function<void(const std::string&)> fail_;
};

// --------------------------- core wrapper -----------------------------------

class RemoteIqRc final : public webrtc::PeerConnectionObserver,
                         public webrtc::DataChannelObserver {
 public:
  RemoteIqRc(const remoteiq_rc_config& cfg, const remoteiq_rc_callbacks& cbs, void* user)
      : cfg_(cfg), cbs_(cbs), user_(user) {
    (void)winsock_init_;
    rtc::InitializeSSL();
    InitFactoryAndPc();
  }

  ~RemoteIqRc() {
    Close();
    rtc::CleanupSSL();
  }

  int CreateOffer() {
    std::lock_guard<std::mutex> lg(mu_);
    if (!pc_) return 0;

    webrtc::PeerConnectionInterface::RTCOfferAnswerOptions opts;
    pc_->CreateOffer(
        new rtc::RefCountedObject<RcCreateDescObserver>(
            [this](webrtc::SessionDescriptionInterface* desc) { OnLocalDescriptionCreated(desc); },
            [this](const std::string& err) { Log(REMOTEIQ_LOG_ERROR, ("CreateOffer failed: " + err).c_str()); }),
        opts);

    return 1;
  }

  int CreateAnswer() {
    std::lock_guard<std::mutex> lg(mu_);
    if (!pc_) return 0;

    webrtc::PeerConnectionInterface::RTCOfferAnswerOptions opts;
    pc_->CreateAnswer(
        new rtc::RefCountedObject<RcCreateDescObserver>(
            [this](webrtc::SessionDescriptionInterface* desc) { OnLocalDescriptionCreated(desc); },
            [this](const std::string& err) { Log(REMOTEIQ_LOG_ERROR, ("CreateAnswer failed: " + err).c_str()); }),
        opts);

    return 1;
  }

  int SetRemoteSdp(const char* type, const char* sdp) {
    if (!type || !sdp) return 0;

    std::string type_str(type);
    std::string sdp_str(sdp);

    if (cfg_.force_vp9) sdp_str = PreferVp9InSdp(sdp_str, cfg_.strip_non_vp9 != 0);

    std::string err;
    auto desc = CreateSessionDescriptionCompat(type_str, sdp_str, &err);
    if (!desc) { Log(REMOTEIQ_LOG_ERROR, err.c_str()); return 0; }

    std::lock_guard<std::mutex> lg(mu_);
    if (!pc_) return 0;

    auto* obs = new rtc::RefCountedObject<RcSetDescObserver>(
        [this](bool ok, const std::string& e) {
          if (!ok) Log(REMOTEIQ_LOG_ERROR, ("SetRemoteDescription failed: " + e).c_str());
        });

    SetRemoteDescriptionCompat(pc_.get(), obs, std::move(desc));
    return 1;
  }

  int AddIceCandidate(const char* mid, int mline, const char* cand) {
    if (!mid || !cand) return 0;

    webrtc::SdpParseError err;
    std::unique_ptr<webrtc::IceCandidateInterface> ice(
        webrtc::CreateIceCandidate(mid, mline, cand, &err));

    if (!ice) {
      Log(REMOTEIQ_LOG_ERROR, ("CreateIceCandidate failed: " + err.description + " line=" + err.line).c_str());
      return 0;
    }

    std::lock_guard<std::mutex> lg(mu_);
    if (!pc_) return 0;

    // Old signature: bool AddIceCandidate(const IceCandidateInterface*)
    // Some newer signatures differ; this is still present in many trees.
    bool ok = pc_->AddIceCandidate(ice.get());
    if (!ok) Log(REMOTEIQ_LOG_WARN, "AddIceCandidate returned false");
    return ok ? 1 : 0;
  }

  int SendData(const uint8_t* data, int len, bool is_binary) {
    if (!data || len <= 0) return 0;
    std::lock_guard<std::mutex> lg(mu_);
    if (!data_channel_) return 0;

    webrtc::DataBuffer buf(rtc::CopyOnWriteBuffer(data, (size_t)len), is_binary);
    return data_channel_->Send(buf) ? 1 : 0;
  }

  void Close() {
    std::lock_guard<std::mutex> lg(mu_);
    if (data_channel_) {
      data_channel_->UnregisterObserver();
      data_channel_ = nullptr;
    }
    if (pc_) {
      pc_->Close();
      pc_ = nullptr;
    }
    factory_ = nullptr;

    if (signaling_thread_) { signaling_thread_->Stop(); signaling_thread_.reset(); }
    if (worker_thread_) { worker_thread_->Stop(); worker_thread_.reset(); }
    if (network_thread_) { network_thread_->Stop(); network_thread_.reset(); }
  }

  // -------- PeerConnectionObserver (common methods across revs) --------------

  void OnSignalingChange(webrtc::PeerConnectionInterface::SignalingState) /*override*/ {}

  void OnAddStream(rtc::scoped_refptr<webrtc::MediaStreamInterface>) /*override*/ {}
  void OnRemoveStream(rtc::scoped_refptr<webrtc::MediaStreamInterface>) /*override*/ {}

  void OnConnectionChange(webrtc::PeerConnectionInterface::PeerConnectionState new_state) /*override*/ {
    int st = REMOTEIQ_STATE_NEW;
    switch (new_state) {
      case webrtc::PeerConnectionInterface::PeerConnectionState::kNew: st = REMOTEIQ_STATE_NEW; break;
      case webrtc::PeerConnectionInterface::PeerConnectionState::kConnecting: st = REMOTEIQ_STATE_CONNECTING; break;
      case webrtc::PeerConnectionInterface::PeerConnectionState::kConnected: st = REMOTEIQ_STATE_CONNECTED; break;
      case webrtc::PeerConnectionInterface::PeerConnectionState::kDisconnected: st = REMOTEIQ_STATE_DISCONNECTED; break;
      case webrtc::PeerConnectionInterface::PeerConnectionState::kFailed: st = REMOTEIQ_STATE_FAILED; break;
      case webrtc::PeerConnectionInterface::PeerConnectionState::kClosed: st = REMOTEIQ_STATE_CLOSED; break;
    }
    if (cbs_.on_state) cbs_.on_state(user_, st);
  }

  void OnIceConnectionChange(webrtc::PeerConnectionInterface::IceConnectionState s) /*override*/ {
    int st = REMOTEIQ_STATE_NEW;
    switch (s) {
      case webrtc::PeerConnectionInterface::IceConnectionState::kIceConnectionChecking: st = REMOTEIQ_STATE_CONNECTING; break;
      case webrtc::PeerConnectionInterface::IceConnectionState::kIceConnectionConnected: st = REMOTEIQ_STATE_CONNECTED; break;
      case webrtc::PeerConnectionInterface::IceConnectionState::kIceConnectionCompleted: st = REMOTEIQ_STATE_CONNECTED; break;
      case webrtc::PeerConnectionInterface::IceConnectionState::kIceConnectionDisconnected: st = REMOTEIQ_STATE_DISCONNECTED; break;
      case webrtc::PeerConnectionInterface::IceConnectionState::kIceConnectionFailed: st = REMOTEIQ_STATE_FAILED; break;
      case webrtc::PeerConnectionInterface::IceConnectionState::kIceConnectionClosed: st = REMOTEIQ_STATE_CLOSED; break;
      default: break;
    }
    if (cbs_.on_state) cbs_.on_state(user_, st);
  }

  void OnIceGatheringChange(webrtc::PeerConnectionInterface::IceGatheringState) /*override*/ {}

  void OnIceCandidate(const webrtc::IceCandidateInterface* candidate) /*override*/ {
    if (!candidate || !cbs_.on_ice_candidate) return;
    std::string cand;
    if (!candidate->ToString(&cand)) return;
    cbs_.on_ice_candidate(user_, candidate->sdp_mid().c_str(), candidate->sdp_mline_index(), cand.c_str());
  }

  void OnIceCandidatesRemoved(const std::vector<cricket::Candidate>&) /*override*/ {}

  void OnDataChannel(rtc::scoped_refptr<webrtc::DataChannelInterface> channel) /*override*/ {
    if (!channel) return;

    {
      std::lock_guard<std::mutex> lg(mu_);
      if (!data_channel_) {
        data_channel_ = channel;
        data_channel_->RegisterObserver(this);
      }
    }

    if (cbs_.on_dc_open) cbs_.on_dc_open(user_, channel->label().c_str());
  }

  void OnRenegotiationNeeded() /*override*/ {}

  // -------- DataChannelObserver ---------------------------------------------

  void OnStateChange() /*override*/ {
    rtc::scoped_refptr<webrtc::DataChannelInterface> dc;
    {
      std::lock_guard<std::mutex> lg(mu_);
      dc = data_channel_;
    }
    if (!dc) return;

    if (dc->state() == webrtc::DataChannelInterface::DataState::kClosed) {
      if (cbs_.on_dc_close) cbs_.on_dc_close(user_, dc->label().c_str());
    }
  }

  void OnMessage(const webrtc::DataBuffer& buffer) /*override*/ {
    if (!cbs_.on_dc_message) return;

    std::string label;
    {
      std::lock_guard<std::mutex> lg(mu_);
      label = data_channel_ ? data_channel_->label() : "";
    }

    cbs_.on_dc_message(user_,
                       label.c_str(),
                       buffer.data.data<uint8_t>(),
                       (int)buffer.data.size(),
                       buffer.binary ? 1 : 0);
  }

 private:
  void Log(int level, const char* msg) {
    if (cbs_.on_log && msg) cbs_.on_log(user_, level, msg);
  }

  void InitFactoryAndPc() {
    network_thread_ = rtc::Thread::CreateWithSocketServer();
    worker_thread_ = rtc::Thread::Create();
    signaling_thread_ = rtc::Thread::Create();

    network_thread_->Start();
    worker_thread_->Start();
    signaling_thread_->Start();

    factory_ = webrtc::CreatePeerConnectionFactory(
        network_thread_.get(),
        worker_thread_.get(),
        signaling_thread_.get(),
        nullptr,
        webrtc::CreateBuiltinAudioEncoderFactory(),
        webrtc::CreateBuiltinAudioDecoderFactory(),
        webrtc::CreateBuiltinVideoEncoderFactory(),
        webrtc::CreateBuiltinVideoDecoderFactory(),
        nullptr,
        nullptr);

    if (!factory_) {
      Log(REMOTEIQ_LOG_ERROR, "CreatePeerConnectionFactory returned null");
      return;
    }

    webrtc::PeerConnectionInterface::RTCConfiguration config;

    if (cfg_.ice_servers && cfg_.ice_servers_count > 0) {
      for (int i = 0; i < cfg_.ice_servers_count; i++) {
        const auto& s = cfg_.ice_servers[i];
        if (!s.url) continue;
        webrtc::PeerConnectionInterface::IceServer ice;
        ice.urls.push_back(std::string(s.url));
        if (s.username) ice.username = s.username;
        if (s.password) ice.password = s.password;
        config.servers.push_back(std::move(ice));
      }
    }

    // Prefer CreatePeerConnectionOrError if present, else CreatePeerConnection.
    struct PcTry {
      static auto Call(webrtc::PeerConnectionFactoryInterface* f,
                       const webrtc::PeerConnectionInterface::RTCConfiguration& c,
                       webrtc::PeerConnectionObserver* o, int)
          -> decltype(f->CreatePeerConnectionOrError(c, nullptr, nullptr, o).value()) {
        auto r = f->CreatePeerConnectionOrError(c, nullptr, nullptr, o);
        if (!r.ok()) return rtc::scoped_refptr<webrtc::PeerConnectionInterface>(nullptr);
        return r.value();
      }
      static rtc::scoped_refptr<webrtc::PeerConnectionInterface> Call(
          webrtc::PeerConnectionFactoryInterface* f,
          const webrtc::PeerConnectionInterface::RTCConfiguration& c,
          webrtc::PeerConnectionObserver* o, long) {
        return f->CreatePeerConnection(c, nullptr, nullptr, o);
      }
    };

    pc_ = PcTry::Call(factory_.get(), config, this, 0);
    if (!pc_) {
      Log(REMOTEIQ_LOG_ERROR, "CreatePeerConnection failed");
      return;
    }

    const char* label = cfg_.data_channel_label ? cfg_.data_channel_label : "rc.control";
    webrtc::DataChannelInit init;
    init.ordered = true;

    auto dc = CreateDataChannelCompat(pc_.get(), label, init);
    if (dc) {
      data_channel_ = dc;
      data_channel_->RegisterObserver(this);
      if (cbs_.on_dc_open) cbs_.on_dc_open(user_, label);
    }
  }

  void OnLocalDescriptionCreated(webrtc::SessionDescriptionInterface* desc_raw) {
    if (!desc_raw) return;

    std::unique_ptr<webrtc::SessionDescriptionInterface> desc(desc_raw);

    std::string sdp;
    desc->ToString(&sdp);

    std::string type_str = GetTypeStrCompat(desc.get());
    if (type_str.empty()) type_str = "offer";

    if (cfg_.force_vp9) {
      std::string rewritten_sdp = PreferVp9InSdp(sdp, cfg_.strip_non_vp9 != 0);

      if (rewritten_sdp != sdp) {
        std::string err;
        auto rewritten_desc = CreateSessionDescriptionCompat(type_str, rewritten_sdp, &err);
        if (rewritten_desc) {
          desc = std::move(rewritten_desc);
          sdp = rewritten_sdp;
        } else {
          Log(REMOTEIQ_LOG_WARN, ("VP9 SDP rewrite failed; using original SDP: " + err).c_str());
        }
      }
    }

    // Set local description
    {
      std::lock_guard<std::mutex> lg(mu_);
      if (!pc_) return;

      auto* obs = new rtc::RefCountedObject<RcSetDescObserver>(
          [this](bool ok, const std::string& e) {
            if (!ok) Log(REMOTEIQ_LOG_ERROR, ("SetLocalDescription failed: " + e).c_str());
          });

      SetLocalDescriptionCompat(pc_.get(), obs, std::move(desc));
    }

    // Deliver final SDP to app
    if (cbs_.on_local_sdp) {
      cbs_.on_local_sdp(user_, type_str.c_str(), sdp.c_str());
    }
  }

 private:
  remoteiq_rc_config cfg_{};
  remoteiq_rc_callbacks cbs_{};
  void* user_ = nullptr;

  std::mutex mu_;
  rtc::WinsockInitializer winsock_init_;

  std::unique_ptr<rtc::Thread> network_thread_;
  std::unique_ptr<rtc::Thread> worker_thread_;
  std::unique_ptr<rtc::Thread> signaling_thread_;

  rtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory_;
  rtc::scoped_refptr<webrtc::PeerConnectionInterface> pc_;
  rtc::scoped_refptr<webrtc::DataChannelInterface> data_channel_;
};

}  // namespace

// --------------------------- C ABI -------------------------------------------

remoteiq_rc_handle remoteiq_rc_create(const remoteiq_rc_config* cfg,
                                     const remoteiq_rc_callbacks* cbs,
                                     void* user) {
  remoteiq_rc_config c{};
  if (cfg) c = *cfg;

  remoteiq_rc_callbacks cb{};
  if (cbs) cb = *cbs;

  auto* inst = new RemoteIqRc(c, cb, user);
  return reinterpret_cast<remoteiq_rc_handle>(inst);
}

void remoteiq_rc_destroy(remoteiq_rc_handle handle) {
  if (!handle) return;
  delete reinterpret_cast<RemoteIqRc*>(handle);
}

int remoteiq_rc_create_offer(remoteiq_rc_handle handle) {
  if (!handle) return 0;
  return reinterpret_cast<RemoteIqRc*>(handle)->CreateOffer();
}

int remoteiq_rc_create_answer(remoteiq_rc_handle handle) {
  if (!handle) return 0;
  return reinterpret_cast<RemoteIqRc*>(handle)->CreateAnswer();
}

int remoteiq_rc_set_remote_sdp(remoteiq_rc_handle handle, const char* type, const char* sdp) {
  if (!handle) return 0;
  return reinterpret_cast<RemoteIqRc*>(handle)->SetRemoteSdp(type, sdp);
}

int remoteiq_rc_add_ice_candidate(remoteiq_rc_handle handle,
                                  const char* sdp_mid,
                                  int sdp_mline_index,
                                  const char* candidate) {
  if (!handle) return 0;
  return reinterpret_cast<RemoteIqRc*>(handle)->AddIceCandidate(sdp_mid, sdp_mline_index, candidate);
}

int remoteiq_rc_send_data(remoteiq_rc_handle handle, const uint8_t* data, int len, int is_binary) {
  if (!handle) return 0;
  return reinterpret_cast<RemoteIqRc*>(handle)->SendData(data, len, is_binary != 0);
}

void remoteiq_rc_close(remoteiq_rc_handle handle) {
  if (!handle) return;
  reinterpret_cast<RemoteIqRc*>(handle)->Close();
}
