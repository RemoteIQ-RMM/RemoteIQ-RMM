// agents/windows/RemoteIQ.Agent/Services/IWebRtcConsolePeerFactory.cs

namespace RemoteIQ.Agent.Services;

public interface IWebRtcConsolePeerFactory
{
    IWebRtcConsolePeer Create(string sessionId);
}
