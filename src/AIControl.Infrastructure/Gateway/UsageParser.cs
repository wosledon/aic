using System.Text;
using System.Text.Json;
using AIControl.Domain;

namespace AIControl.Infrastructure.Gateway;

public sealed record UsageSnapshot(
    long InputTokens,
    long OutputTokens,
    long CacheReadTokens,
    long CacheWriteTokens,
    bool HasUsage,
    string? UpstreamModel,
    string? StopReason)
{
    public long TotalTokens => InputTokens + OutputTokens + CacheReadTokens + CacheWriteTokens;
}

/// <summary>
/// Normalizes usage from Anthropic Messages, OpenAI Chat/Responses and Google Gemini payloads.
/// Values are assigned (not accumulated) so repeated SSE snapshots stay idempotent.
/// </summary>
public sealed class UsageAccumulator(string protocol)
{
    private long _input;
    private long _output;
    private long _cacheRead;
    private long _cacheWrite;
    private bool _hasUsage;
    private string? _model;
    private string? _stopReason;

    public UsageSnapshot ToSnapshot() => new(_input, _output, _cacheRead, _cacheWrite, _hasUsage, _model, _stopReason);

    public void ObserveJson(JsonElement root)
    {
        var effectiveProtocol = protocol;
        try
        {
            switch (effectiveProtocol)
            {
                case ApiProtocols.AnthropicMessages:
                    ObserveAnthropic(root);
                    break;
                case ApiProtocols.OpenAiCompletions:
                case ApiProtocols.AzureOpenAiCompletions:
                    ObserveOpenAiChat(root);
                    break;
                case ApiProtocols.OpenAiResponses:
                case ApiProtocols.AzureOpenAiResponses:
                    ObserveOpenAiResponses(root);
                    break;
                case ApiProtocols.GoogleGenerativeAi:
                    ObserveGoogle(root);
                    break;
                default:
                    ObserveOpenAiChat(root);
                    break;
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or JsonException)
        {
            // Malformed provider payloads must never break streaming.
        }
    }

    private void ObserveAnthropic(JsonElement root)
    {
        var payload = root;
        if (root.TryGetProperty("type", out var type) && type.GetString() == "message_start"
            && root.TryGetProperty("message", out var message) && message.ValueKind == JsonValueKind.Object)
        {
            payload = message;
        }

        if (payload.TryGetProperty("model", out var model) && model.ValueKind == JsonValueKind.String)
        {
            _model = model.GetString();
        }

        if (payload.TryGetProperty("stop_reason", out var stop) && stop.ValueKind == JsonValueKind.String)
        {
            _stopReason = stop.GetString();
        }

        if (root.TryGetProperty("delta", out var delta) && delta.ValueKind == JsonValueKind.Object
            && delta.TryGetProperty("stop_reason", out var deltaStop) && deltaStop.ValueKind == JsonValueKind.String)
        {
            _stopReason = deltaStop.GetString();
        }

        if (!payload.TryGetProperty("usage", out var usage) || usage.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        _hasUsage = true;
        if (TryLong(usage, "input_tokens", out var input))
        {
            _input = input;
        }
        if (TryLong(usage, "output_tokens", out var output))
        {
            _output = output;
        }
        if (TryLong(usage, "cache_read_input_tokens", out var cacheRead))
        {
            _cacheRead = cacheRead;
        }
        if (TryLong(usage, "cache_creation_input_tokens", out var cacheWrite))
        {
            _cacheWrite = cacheWrite;
        }
        else if (usage.TryGetProperty("cache_creation", out var cacheCreation) && cacheCreation.ValueKind == JsonValueKind.Object)
        {
            long total = 0;
            if (TryLong(cacheCreation, "ephemeral_5m_input_tokens", out var five)) total += five;
            if (TryLong(cacheCreation, "ephemeral_1h_input_tokens", out var one)) total += one;
            if (total > 0) _cacheWrite = total;
        }
    }

    private void ObserveOpenAiChat(JsonElement root)
    {
        if (root.TryGetProperty("model", out var model) && model.ValueKind == JsonValueKind.String)
        {
            _model = model.GetString();
        }

        if (root.TryGetProperty("choices", out var choices) && choices.ValueKind == JsonValueKind.Array)
        {
            foreach (var choice in choices.EnumerateArray())
            {
                if (choice.TryGetProperty("finish_reason", out var finish) && finish.ValueKind == JsonValueKind.String)
                {
                    _stopReason = finish.GetString();
                    break;
                }
            }
        }

        if (!root.TryGetProperty("usage", out var usage) || usage.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        _hasUsage = true;
        var prompt = TryLong(usage, "prompt_tokens", out var p) ? p : 0;
        long cached = 0;
        if (usage.TryGetProperty("prompt_tokens_details", out var details) && details.ValueKind == JsonValueKind.Object)
        {
            TryLong(details, "cached_tokens", out cached);
        }
        if (cached == 0)
        {
            TryLong(usage, "prompt_cache_hit_tokens", out cached);
        }

        _input = Math.Max(0, prompt - cached);
        _cacheRead = cached;
        if (TryLong(usage, "completion_tokens", out var completion))
        {
            _output = completion;
        }
    }

    private void ObserveOpenAiResponses(JsonElement root)
    {
        var payload = root;
        if (root.TryGetProperty("type", out var type)
            && (type.GetString() is "response.completed" or "response.done" or "response.incomplete")
            && root.TryGetProperty("response", out var response) && response.ValueKind == JsonValueKind.Object)
        {
            payload = response;
        }

        if (payload.TryGetProperty("model", out var model) && model.ValueKind == JsonValueKind.String)
        {
            _model = model.GetString();
        }
        if (payload.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.String)
        {
            _stopReason = status.GetString();
        }

        if (!payload.TryGetProperty("usage", out var usage) || usage.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        _hasUsage = true;
        if (TryLong(usage, "input_tokens", out var input)) _input = input;
        if (TryLong(usage, "output_tokens", out var output)) _output = output;
        if (usage.TryGetProperty("input_tokens_details", out var details) && details.ValueKind == JsonValueKind.Object
            && TryLong(details, "cached_tokens", out var cached))
        {
            _input = Math.Max(0, _input - cached);
            _cacheRead = cached;
        }
    }

    private void ObserveGoogle(JsonElement root)
    {
        if (root.TryGetProperty("modelVersion", out var model) && model.ValueKind == JsonValueKind.String)
        {
            _model = model.GetString();
        }
        if (root.TryGetProperty("candidates", out var candidates) && candidates.ValueKind == JsonValueKind.Array)
        {
            foreach (var candidate in candidates.EnumerateArray())
            {
                if (candidate.TryGetProperty("finishReason", out var finish) && finish.ValueKind == JsonValueKind.String)
                {
                    _stopReason = finish.GetString();
                    break;
                }
            }
        }

        if (!root.TryGetProperty("usageMetadata", out var usage) || usage.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        _hasUsage = true;
        var prompt = TryLong(usage, "promptTokenCount", out var p) ? p : 0;
        var cached = TryLong(usage, "cachedContentTokenCount", out var c) ? c : 0;
        _input = Math.Max(0, prompt - cached);
        _cacheRead = cached;
        if (TryLong(usage, "candidatesTokenCount", out var outTokens)) _output = outTokens;
    }

    private static bool TryLong(JsonElement obj, string property, out long value)
    {
        value = 0;
        if (!obj.TryGetProperty(property, out var element))
        {
            return false;
        }

        return element.ValueKind switch
        {
            JsonValueKind.Number => element.TryGetInt64(out value),
            JsonValueKind.String => long.TryParse(element.GetString(), out value),
            _ => false
        };
    }
}

/// <summary>Incrementally taps an SSE byte stream without buffering the whole response.</summary>
public sealed class SseUsageTap
{
    private readonly UsageAccumulator _accumulator;
    private readonly Decoder _decoder = Encoding.UTF8.GetDecoder();
    private readonly StringBuilder _line = new();
    private readonly StringBuilder _data = new();

    public SseUsageTap(string protocol)
    {
        _accumulator = new UsageAccumulator(protocol);
    }

    public UsageSnapshot Snapshot => _accumulator.ToSnapshot();

    public void Feed(ReadOnlySpan<byte> bytes)
    {
        Span<char> chars = stackalloc char[4096];
        while (bytes.Length > 0)
        {
            _decoder.Convert(bytes, chars, false, out var bytesUsed, out var charsUsed, out _);
            if (charsUsed > 0)
            {
                Append(chars[..charsUsed]);
            }
            bytes = bytes[bytesUsed..];
            if (bytesUsed == 0 && charsUsed == 0)
            {
                break;
            }
        }
    }

    public void Complete()
    {
        Span<char> chars = stackalloc char[256];
        _decoder.Convert(ReadOnlySpan<byte>.Empty, chars, true, out _, out var charsUsed, out _);
        if (charsUsed > 0)
        {
            Append(chars[..charsUsed]);
        }
        FlushLine();
        FlushData();
    }

    private void Append(ReadOnlySpan<char> chars)
    {
        foreach (var ch in chars)
        {
            if (ch == '\n')
            {
                FlushLine();
            }
            else if (ch != '\r')
            {
                _line.Append(ch);
            }
        }
    }

    private void FlushLine()
    {
        if (_line.Length == 0)
        {
            FlushData();
            return;
        }

        var line = _line.ToString();
        _line.Clear();
        if (line.StartsWith("data:", StringComparison.Ordinal))
        {
            var data = line[5..].TrimStart();
            if (_data.Length > 0)
            {
                _data.Append('\n');
            }
            _data.Append(data);
            if (data is "[DONE]")
            {
                FlushData();
            }
        }
        else if (line.Length == 0)
        {
            FlushData();
        }
    }

    private void FlushData()
    {
        if (_data.Length == 0)
        {
            return;
        }

        var json = _data.ToString();
        _data.Clear();
        if (json is "[DONE]" || string.IsNullOrWhiteSpace(json))
        {
            return;
        }

        try
        {
            using var doc = JsonDocument.Parse(json);
            _accumulator.ObserveJson(doc.RootElement);
        }
        catch (JsonException)
        {
        }
    }
}

public static class UsageParser
{
    public static UsageSnapshot ParseNonStream(string protocol, ReadOnlyMemory<byte> body)
    {
        var accumulator = new UsageAccumulator(protocol);
        try
        {
            using var doc = JsonDocument.Parse(body);
            accumulator.ObserveJson(doc.RootElement);
        }
        catch (JsonException)
        {
        }
        return accumulator.ToSnapshot();
    }
}