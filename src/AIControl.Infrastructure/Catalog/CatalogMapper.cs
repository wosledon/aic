using System.Text.Json;
using AIControl.Domain;

namespace AIControl.Infrastructure.Catalog;

public static class CatalogMapper
{
    private static readonly string[] ThinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

    public static string? SuggestProtocol(string? npm) => npm switch
    {
        "@ai-sdk/anthropic" => ApiProtocols.AnthropicMessages,
        "@ai-sdk/openai" => ApiProtocols.OpenAiResponses,
        "@ai-sdk/azure" => ApiProtocols.AzureOpenAiResponses,
        "@ai-sdk/google" => ApiProtocols.GoogleGenerativeAi,
        "@ai-sdk/openai-compatible" => ApiProtocols.OpenAiCompletions,
        "@openrouter/ai-sdk-provider" => ApiProtocols.OpenAiCompletions,
        _ => null
    };

    /// <summary>
    /// Maps models.dev reasoning_options to Pi thinkingLevelMap.
    /// Unsupported levels are emitted as null so Pi hides them.
    /// </summary>
    public static string BuildThinkingLevelMap(string? reasoningOptionsJson)
    {
        var map = ThinkingLevels.ToDictionary(x => x, _ => (string?)null, StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(reasoningOptionsJson))
        {
            return JsonSerializer.Serialize(map);
        }

        try
        {
            using var doc = JsonDocument.Parse(reasoningOptionsJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
            {
                return JsonSerializer.Serialize(map);
            }

            var options = doc.RootElement.EnumerateArray().ToList();
            var effort = options.FirstOrDefault(x => x.TryGetProperty("type", out var t) && t.GetString() == "effort");
            if (effort.ValueKind == JsonValueKind.Object)
            {
                var values = effort.TryGetProperty("values", out var v) && v.ValueKind == JsonValueKind.Array
                    ? v.EnumerateArray().Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x)).Cast<string>().ToList()
                    : [];
                foreach (var value in values)
                {
                    var normalized = value.ToLowerInvariant() switch
                    {
                        "none" => "off",
                        "minimal" => "minimal",
                        "low" => "low",
                        "medium" => "medium",
                        "high" => "high",
                        "xhigh" => "xhigh",
                        "max" => "max",
                        _ => null
                    };
                    if (normalized is not null && map.ContainsKey(normalized))
                    {
                        map[normalized] = value;
                    }
                }
                return JsonSerializer.Serialize(map);
            }

            var budget = options.FirstOrDefault(x => x.TryGetProperty("type", out var t) && t.GetString() == "budget_tokens");
            if (budget.ValueKind == JsonValueKind.Object)
            {
                long min = budget.TryGetProperty("min", out var minEl) && minEl.TryGetInt64(out var m) ? m : 1024;
                long max = budget.TryGetProperty("max", out var maxEl) && maxEl.TryGetInt64(out var m2) ? m2 : Math.Max(min, 32768);
                map["low"] = min.ToString();
                map["medium"] = ((min + max) / 2).ToString();
                map["high"] = max.ToString();
                return JsonSerializer.Serialize(map);
            }

            if (options.Any(x => x.TryGetProperty("type", out var t) && t.GetString() == "toggle"))
            {
                map["off"] = "off";
                map["high"] = "high";
            }
        }
        catch (JsonException)
        {
            // Malformed metadata must never break the catalog; expose no levels.
        }

        return JsonSerializer.Serialize(map);
    }

    public static string BuildCapabilitiesJson(string? modalitiesJson, bool toolCall, bool reasoning)
    {
        var inputs = new List<string> { "text" };
        try
        {
            if (!string.IsNullOrWhiteSpace(modalitiesJson))
            {
                using var doc = JsonDocument.Parse(modalitiesJson);
                if (doc.RootElement.TryGetProperty("input", out var input) && input.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in input.EnumerateArray())
                    {
                        var value = item.GetString();
                        if (value is "text" or "image" && !inputs.Contains(value))
                        {
                            inputs.Add(value);
                        }
                    }
                }
            }
        }
        catch (JsonException)
        {
        }

        return JsonSerializer.Serialize(new
        {
            input = inputs,
            output = new[] { "text" },
            tool_call = toolCall,
            reasoning
        });
    }

    public static string DefaultApprovalPolicyJson() => JsonSerializer.Serialize(new
    {
        rules = new object[]
        {
            new { risk = "read", action = "allow" },
            new { risk = "write", action = "ask" },
            new { risk = "exec", action = "ask" },
            new { risk = "network", action = "ask" },
            new { risk = "destructive", action = "ask" },
            new { risk = "unknown", action = "deny" }
        },
        no_ui = "deny"
    });

    public static string DefaultModelWhitelistJson() => JsonSerializer.Serialize(new { models = Array.Empty<string>(), all = true });

    public static string DefaultRateLimitJson() => JsonSerializer.Serialize(new { rpm = 120, concurrency = 8 });
}