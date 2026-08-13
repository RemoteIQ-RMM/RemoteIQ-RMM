// C:\Users\Last Stop\Documents\Programming Projects\RemoteIQ V7 - Ticketing\remoteiq-minimal-e2e\native\RemoteIQ.NativeWebRtc\include\remoteiq_rc.h

#pragma once
#include <stdint.h>

#ifdef _WIN32
#define RIQ_EXPORT __declspec(dllexport)
#else
#define RIQ_EXPORT
#endif

#ifdef __cplusplus
extern "C"
{
#endif

  typedef void *rc_peer_handle_t;

  typedef void (*rc_on_signal_json_cb)(const char *utf8_json, void *user);
  typedef void (*rc_on_connection_state_cb)(int state, void *user);
  typedef void (*rc_on_data_message_cb)(const char *label, const uint8_t *data, int len, void *user);
  typedef void (*rc_on_log_cb)(int level, const char *msg, void *user);

  typedef struct rc_callbacks_t
  {
    rc_on_signal_json_cb on_signal;
    rc_on_connection_state_cb on_connection_state;
    rc_on_data_message_cb on_data_message;
    rc_on_log_cb on_log;
    void *user;
  } rc_callbacks_t;

  // ABI version (helps detect mismatches)
  RIQ_EXPORT int rc_abi_version(void);

  // Lifecycle
  RIQ_EXPORT int rc_peer_create(const char *config_json_utf8, const rc_callbacks_t *cbs, rc_peer_handle_t *out_handle);
  RIQ_EXPORT void rc_peer_destroy(rc_peer_handle_t handle);
  RIQ_EXPORT void rc_peer_close(rc_peer_handle_t handle, const char *reason_utf8);

  // Signaling
  RIQ_EXPORT void rc_peer_handle_signal(rc_peer_handle_t handle, const char *signal_json_utf8);

  // DataChannels
  RIQ_EXPORT int rc_peer_send(rc_peer_handle_t handle, const char *label_utf8, const uint8_t *data, int len);

  // Controls (no-op in stub/skeleton for now)
  RIQ_EXPORT void rc_peer_set_video_enabled(rc_peer_handle_t handle, int enabled);
  RIQ_EXPORT void rc_peer_set_capture_params(rc_peer_handle_t handle, int width, int height, int fps);
  RIQ_EXPORT void rc_peer_set_bitrate(rc_peer_handle_t handle, int start_kbps, int max_kbps);
  RIQ_EXPORT void rc_peer_request_keyframe(rc_peer_handle_t handle);

#ifdef __cplusplus
}
#endif
