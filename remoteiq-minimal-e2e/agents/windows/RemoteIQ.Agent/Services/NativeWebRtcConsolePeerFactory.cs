using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

public sealed class NativeWebRtcConsolePeerFactory : IWebRtcConsolePeerFactory
{
    private readonly ILoggerFactory _loggerFactory;

    public NativeWebRtcConsolePeerFactory(ILoggerFactory loggerFactory)
    {
        _loggerFactory = loggerFactory;
    }

    public IWebRtcConsolePeer Create(string sessionId)
    {
        var peerLogger = _loggerFactory.CreateLogger<NativeWebRtcConsolePeer>();
        var peer = new NativeWebRtcConsolePeer(sessionId, peerLogger);

        // Keep ONE injection path: InjectedWebRtcConsolePeer -> WindowsInputInjector
        var wrapperLogger = _loggerFactory.CreateLogger<InjectedWebRtcConsolePeer>();
        return new InjectedWebRtcConsolePeer(peer, _loggerFactory, wrapperLogger);
    }
}
