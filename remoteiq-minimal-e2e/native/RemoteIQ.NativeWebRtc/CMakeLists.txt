# native/RemoteIQ.NativeWebRtc/CMakeLists.txt

cmake_minimum_required(VERSION 3.20)

project(RemoteIQ_NativeWebRtc LANGUAGES C CXX)

# --- Options / paths (configure-time) ---
set(WEBRTC_SRC "C:/dev/src" CACHE PATH "Path to libwebrtc src root (e.g. C:/dev/src)")
set(WEBRTC_OUT "C:/dev/src/out/Release" CACHE PATH "Path to libwebrtc GN output dir (e.g. C:/dev/src/out/Release)")

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Sanity checks
if (NOT EXISTS "${WEBRTC_SRC}/api")
  message(FATAL_ERROR "WEBRTC_SRC does not look like a libwebrtc src root. Expected ${WEBRTC_SRC}/api to exist.")
endif()

if (NOT EXISTS "${WEBRTC_OUT}/obj/webrtc.lib")
  message(FATAL_ERROR "Could not find ${WEBRTC_OUT}/obj/webrtc.lib. Verify WEBRTC_OUT points at your GN output folder.")
endif()

# --- Build settings ---
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if (MSVC)
  add_compile_options(/EHsc /W3)
  add_compile_definitions(
    _CRT_SECURE_NO_WARNINGS
    NOMINMAX
    WIN32_LEAN_AND_MEAN
    _WIN32_WINNT=0x0A00
  )
endif()

# --- Library ---
add_library(RemoteIQ.NativeWebRtc SHARED
  src/remoteiq_rc_webrtc.cpp
  src/remoteiq_signal_parse.cpp
)

target_include_directories(RemoteIQ.NativeWebRtc PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src

  # WebRTC headers (include "api/..." etc.)
  ${WEBRTC_SRC}

  # Common WebRTC third_party includes used by headers (absl, etc.)
  ${WEBRTC_SRC}/third_party/abseil-cpp
  ${WEBRTC_SRC}/third_party/boringssl/src/include
  ${WEBRTC_SRC}/third_party/libyuv/include
)

# Link webrtc monolithic static library
target_link_libraries(RemoteIQ.NativeWebRtc PRIVATE
  "${WEBRTC_OUT}/obj/webrtc.lib"

  # Win32 / networking / crypto / system libs frequently needed by libwebrtc
  ws2_32
  iphlpapi
  secur32
  crypt32
  advapi32
  winmm
  user32
  gdi32
  ole32
  shell32
  shlwapi
  dbghelp
)

# Export name / output
set_target_properties(RemoteIQ.NativeWebRtc PROPERTIES
  OUTPUT_NAME "RemoteIQ.NativeWebRtc"
)

# Helpful: put the dll next to the build config folder (default CMake already does this),
# but ensure PDBs for RelWithDebInfo if you use it later.
