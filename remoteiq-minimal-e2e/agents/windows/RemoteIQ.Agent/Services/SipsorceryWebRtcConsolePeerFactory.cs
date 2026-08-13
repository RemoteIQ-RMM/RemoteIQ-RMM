// agents/windows/RemoteIQ.Agent/Services/SipsorceryWebRtcConsolePeerFactory.cs

using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

public sealed class SipsorceryWebRtcConsolePeerFactory : IWebRtcConsolePeerFactory
{
    private readonly ILoggerFactory _loggerFactory;

    public SipsorceryWebRtcConsolePeerFactory(ILoggerFactory loggerFactory)
    {
        _loggerFactory = loggerFactory;
    }

    public IWebRtcConsolePeer Create(string sessionId)
    {
        var peerLogger = _loggerFactory.CreateLogger<SipsorceryWebRtcConsolePeer>();

        // SipsorceryWebRtcConsolePeer owns its existing rc.control input path.
        // Wrapping it again would inject each control event twice.
        return new SipsorceryWebRtcConsolePeer(sessionId, peerLogger);
    }
}
