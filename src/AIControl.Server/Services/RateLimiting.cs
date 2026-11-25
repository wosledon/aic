using System.Collections.Concurrent;

namespace AIControl.Server.Services;

/// <summary>In-memory fixed-window rate limiter for demo single-instance deployment.</summary>
public sealed class RateLimiter
{
    private readonly ConcurrentDictionary<string, Window> _windows = new();

    public bool TryAcquire(string key, int limitPerMinute, out int retryAfterSeconds)
    {
        retryAfterSeconds = 0;
        if (limitPerMinute <= 0)
        {
            return true;
        }

        var now = DateTime.UtcNow;
        var window = _windows.GetOrAdd(key, _ => new Window());
        lock (window)
        {
            if ((now - window.Start).TotalMinutes >= 1)
            {
                window.Start = now;
                window.Count = 0;
            }

            if (window.Count >= limitPerMinute)
            {
                retryAfterSeconds = Math.Max(1, 60 - (int)(now - window.Start).TotalSeconds);
                return false;
            }

            window.Count++;
            return true;
        }
    }

    private sealed class Window
    {
        public DateTime Start { get; set; } = DateTime.UtcNow;
        public int Count { get; set; }
    }
}

/// <summary>Minimal circuit breaker keyed by channel id.</summary>
public sealed class ChannelCircuitBreaker
{
    private readonly ConcurrentDictionary<Guid, State> _states = new();

    public bool IsOpen(Guid channelId) =>
        _states.TryGetValue(channelId, out var state) && state.OpenUntil > DateTime.UtcNow;

    public void RecordSuccess(Guid channelId)
    {
        _states.TryRemove(channelId, out _);
    }

    public void RecordFailure(Guid channelId)
    {
        var state = _states.GetOrAdd(channelId, _ => new State());
        lock (state)
        {
            state.Failures++;
            if (state.Failures >= 5)
            {
                state.OpenUntil = DateTime.UtcNow.AddSeconds(30);
                state.Failures = 0;
            }
        }
    }

    private sealed class State
    {
        public int Failures { get; set; }
        public DateTime OpenUntil { get; set; }
    }
}

public sealed class GatewayOptions
{
    public string PublicBaseUrl { get; set; } = "http://localhost:5080";
    public long MaxBodyBytes { get; set; } = 32L * 1024 * 1024;
    public int UpstreamTimeoutSeconds { get; set; } = 300;
}

public sealed class AuthOptions
{
    public bool DevLoginEnabled { get; set; } = false;
    public string BootstrapAdminUnionId { get; set; } = "dev-admin";
}

public sealed class UploadOptions
{
    public bool SeedDemoData { get; set; } = true;
    public string? ModelsDevFixturePath { get; set; } = "modelsdev-fixture.json";
}