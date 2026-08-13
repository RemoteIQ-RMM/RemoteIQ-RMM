// native/RemoteIQ.NativeWebRtc/src/remoteiq_signal_parse.cpp

#include "../include/remoteiq_signal_parse.h"

#include <cctype>
#include <cstring>
#include <string>
#include <utility>
#include <memory>

#include <json/json.h>

// ----------------------------- helpers --------------------------------------

static inline void trim_ws(std::string &s)
{
    size_t a = 0;
    while (a < s.size() && std::isspace(static_cast<unsigned char>(s[a])))
        a++;
    size_t b = s.size();
    while (b > a && std::isspace(static_cast<unsigned char>(s[b - 1])))
        b--;
    s = s.substr(a, b - a);
}

static bool parse_json(const char *utf8, Json::Value *out, std::string *err)
{
    if (!out)
        return false;
    *out = Json::Value();

    if (!utf8 || !*utf8)
    {
        if (err)
            *err = "empty json";
        return false;
    }

    Json::CharReaderBuilder b;
    b["collectComments"] = false;
    std::unique_ptr<Json::CharReader> r(b.newCharReader());

    std::string errs;
    const char *begin = utf8;
    const char *end = utf8 + std::strlen(utf8);

    const bool ok = r->parse(begin, end, out, &errs);
    if (!ok && err)
        *err = errs;
    return ok;
}

static std::string write_json_compact(const Json::Value &v)
{
    Json::StreamWriterBuilder b;
    b["indentation"] = "";
    b["commentStyle"] = "None";
    return Json::writeString(b, v);
}

// ----------------------------- API ------------------------------------------

static void rc_signal_clear(rc_signal_t *out)
{
    if (!out)
        return;
    out->kind = RC_SIGNAL_UNKNOWN;
    out->sdp.clear();
    out->candidate.candidate.clear();
    out->candidate.sdp_mid.clear();
    out->candidate.sdp_mline_index = 0;
}

bool rc_parse_signal_json(const char *json_utf8, rc_signal_t *out, std::string *err)
{
    if (!out)
        return false;
    rc_signal_clear(out);

    Json::Value root;
    std::string parse_err;
    if (!parse_json(json_utf8, &root, &parse_err) || !root.isObject())
    {
        if (err)
            *err = parse_err.empty() ? "invalid json" : parse_err;
        return false;
    }

    if (!root.isMember("type") || !root["type"].isString())
    {
        if (err)
            *err = "missing or invalid 'type'";
        return false;
    }

    std::string type = root["type"].asString();
    trim_ws(type);

    if (type == "offer")
    {
        if (!root.isMember("sdp") || !root["sdp"].isString())
        {
            if (err)
                *err = "offer missing 'sdp'";
            return false;
        }
        out->kind = RC_SIGNAL_OFFER;
        out->sdp = root["sdp"].asString();
        return true;
    }

    if (type == "answer")
    {
        if (!root.isMember("sdp") || !root["sdp"].isString())
        {
            if (err)
                *err = "answer missing 'sdp'";
            return false;
        }
        out->kind = RC_SIGNAL_ANSWER;
        out->sdp = root["sdp"].asString();
        return true;
    }

    if (type == "candidate")
    {
        out->kind = RC_SIGNAL_CANDIDATE;

        // Variant A: nested candidate object
        if (root.isMember("candidate") && root["candidate"].isObject())
        {
            const Json::Value c = root["candidate"];
            if (c.isMember("candidate") && c["candidate"].isString())
                out->candidate.candidate = c["candidate"].asString();
            if (c.isMember("sdpMid") && c["sdpMid"].isString())
                out->candidate.sdp_mid = c["sdpMid"].asString();
            if (c.isMember("sdpMLineIndex") && c["sdpMLineIndex"].isInt())
                out->candidate.sdp_mline_index = c["sdpMLineIndex"].asInt();
        }
        else
        {
            // Variant B: flat candidate fields
            if (root.isMember("candidate") && root["candidate"].isString())
                out->candidate.candidate = root["candidate"].asString();
            if (root.isMember("sdpMid") && root["sdpMid"].isString())
                out->candidate.sdp_mid = root["sdpMid"].asString();
            if (root.isMember("sdpMLineIndex") && root["sdpMLineIndex"].isInt())
                out->candidate.sdp_mline_index = root["sdpMLineIndex"].asInt();
        }

        trim_ws(out->candidate.candidate);
        trim_ws(out->candidate.sdp_mid);

        if (out->candidate.candidate.empty())
        {
            if (err)
                *err = "candidate missing 'candidate' string";
            return false;
        }
        return true;
    }

    out->kind = RC_SIGNAL_UNKNOWN;
    if (err)
        *err = "unknown signal type: " + type;
    return false;
}

std::string rc_build_offer_json(const std::string &sdp)
{
    Json::Value v(Json::objectValue);
    v["type"] = "offer";
    v["sdp"] = sdp;
    return write_json_compact(v);
}

std::string rc_build_answer_json(const std::string &sdp)
{
    Json::Value v(Json::objectValue);
    v["type"] = "answer";
    v["sdp"] = sdp;
    return write_json_compact(v);
}

std::string rc_build_candidate_json(const std::string &candidate,
                                    const std::string &sdp_mid,
                                    int sdp_mline_index)
{
    Json::Value v(Json::objectValue);
    v["type"] = "candidate";

    Json::Value c(Json::objectValue);
    c["candidate"] = candidate;
    c["sdpMid"] = sdp_mid;
    c["sdpMLineIndex"] = sdp_mline_index;

    v["candidate"] = c;
    return write_json_compact(v);
}
