using System.Text.Json;
using AIControl.Infrastructure.Catalog;
using AIControl.Infrastructure.Gateway;
using AIControl.Infrastructure.Utils;

namespace AIControl.UnitTests;

public sealed class RepoUrlNormalizerTests
{
    [Theory]
    [InlineData("git@git.example.com:Payments/Payments-API.git")]
    [InlineData("https://git.example.com/Payments/Payments-API")]
    [InlineData("https://user:token@git.example.com/Payments/Payments-API.git")]
    [InlineData("ssh://git@git.example.com:2222/payments/payments-api.git")]
    public void EquivalentRemotesProduceSameHash(string remote)
    {
        var result = RepoUrlNormalizer.Normalize(remote);

        Assert.Equal("https://git.example.com/payments/payments-api", result.NormalizedUrl);
        Assert.Equal("git.example.com/payments/payments-api", result.Display);
        Assert.StartsWith("sha256:", result.Hash);
        Assert.Equal(71, result.Hash.Length);
    }

    [Fact]
    public void CredentialsAndGitSuffixAreRemoved()
    {
        var result = RepoUrlNormalizer.Normalize("https://alice:secret@GIT.EXAMPLE.COM/Org/Repo.git/");

        Assert.DoesNotContain("alice", result.NormalizedUrl);
        Assert.DoesNotContain("secret", result.NormalizedUrl);
        Assert.EndsWith("/org/repo", result.NormalizedUrl);
    }
}

public sealed class UsageAccumulatorTests
{
    private static JsonElement Json(string value) => JsonDocument.Parse(value).RootElement.Clone();

    [Fact]
    public void AnthropicStreamSplitsInputOutputAndCache()
    {
        var accumulator = new UsageAccumulator(AIControl.Domain.ApiProtocols.AnthropicMessages);

        accumulator.ObserveJson(Json("""
            {
              "type": "message_start",
              "message": {
                "model": "claude-sonnet-5",
                "usage": {
                  "input_tokens": 120,
                  "output_tokens": 1,
                  "cache_read_input_tokens": 30,
                  "cache_creation_input_tokens": 10
                }
              }
            }
            """));

        accumulator.ObserveJson(Json("""
            { "type": "message_delta", "delta": { "stop_reason": "end_turn" }, "usage": { "output_tokens": 45 } }
            """));

        var usage = accumulator.ToSnapshot();
        Assert.True(usage.HasUsage);
        Assert.Equal(120, usage.InputTokens);
        Assert.Equal(45, usage.OutputTokens);
        Assert.Equal(30, usage.CacheReadTokens);
        Assert.Equal(10, usage.CacheWriteTokens);
        Assert.Equal(205, usage.TotalTokens);
        Assert.Equal("claude-sonnet-5", usage.UpstreamModel);
        Assert.Equal("end_turn", usage.StopReason);
    }

    [Fact]
    public void OpenAiChatSplitsCachedPromptTokens()
    {
        var accumulator = new UsageAccumulator(AIControl.Domain.ApiProtocols.OpenAiCompletions);

        accumulator.ObserveJson(Json("""
            {
              "model": "gpt-5-codex",
              "choices": [{ "finish_reason": "stop" }],
              "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 20,
                "prompt_tokens_details": { "cached_tokens": 40 }
              }
            }
            """));

        var usage = accumulator.ToSnapshot();
        Assert.Equal(60, usage.InputTokens);
        Assert.Equal(40, usage.CacheReadTokens);
        Assert.Equal(20, usage.OutputTokens);
        Assert.Equal(120, usage.TotalTokens);
    }

    [Fact]
    public void GoogleUsageSubtractsCachedContent()
    {
        var accumulator = new UsageAccumulator(AIControl.Domain.ApiProtocols.GoogleGenerativeAi);

        accumulator.ObserveJson(Json("""
            {
              "modelVersion": "gemini-3-pro",
              "candidates": [{ "finishReason": "STOP" }],
              "usageMetadata": {
                "promptTokenCount": 80,
                "candidatesTokenCount": 12,
                "cachedContentTokenCount": 30
              }
            }
            """));

        var usage = accumulator.ToSnapshot();
        Assert.Equal(50, usage.InputTokens);
        Assert.Equal(30, usage.CacheReadTokens);
        Assert.Equal(12, usage.OutputTokens);
        Assert.Equal(92, usage.TotalTokens);
    }
}

public sealed class ApprovalPolicyTests
{
    [Fact]
    public void DefaultPolicyCoversRisksAndFailsClosedWithoutUi()
    {
        using var document = JsonDocument.Parse(CatalogMapper.DefaultApprovalPolicyJson());
        var root = document.RootElement;

        Assert.Equal("deny", root.GetProperty("no_ui").GetString());
        var rules = root.GetProperty("rules").EnumerateArray()
            .ToDictionary(x => x.GetProperty("risk").GetString()!, x => x.GetProperty("action").GetString());
        Assert.Equal("allow", rules["read"]);
        Assert.Equal("ask", rules["exec"]);
        Assert.Equal("ask", rules["destructive"]);
        Assert.Equal("deny", rules["unknown"]);
    }

    [Fact]
    public void ModelWhitelistDefaultsToAllModels()
    {
        using var document = JsonDocument.Parse(CatalogMapper.DefaultModelWhitelistJson());
        Assert.True(document.RootElement.GetProperty("all").GetBoolean());
        Assert.Empty(document.RootElement.GetProperty("models").EnumerateArray());
    }
}