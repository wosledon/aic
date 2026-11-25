using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using AIControl.Domain;
using AIControl.Infrastructure;
using AIControl.Infrastructure.Gateway;
using AIControl.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace AIControl.Server.Services;

public sealed record ChannelTestResult(bool Ok, int StatusCode, int LatencyMs, UsageSnapshot? Usage, string? Error);

public sealed class ChannelTestService(
    AppDbContext db,
    SecretProtector protector,
    IHttpClientFactory httpClientFactory)
{
    public async Task<ChannelTestResult> TestAsync(Channel channel, CancellationToken cancellationToken)
    {
        var model = await db.ChannelModels.AsNoTracking()
            .Where(x => x.ChannelId == channel.Id && x.Enabled)
            .OrderBy(x => x.UpstreamModel)
            .FirstOrDefaultAsync(cancellationToken);
        if (model is null)
        {
            return new ChannelTestResult(false, 0, 0, null, "渠道尚未绑定模型");
        }

        var baseUrl = protector.Unprotect(channel.BaseUrlCipher).TrimEnd('/');
        var apiKey = protector.Unprotect(channel.ApiKeyCipher);
        var url = channel.Protocol switch
        {
            ApiProtocol.AnthropicMessages => baseUrl.EndsWith("/v1/messages", StringComparison.OrdinalIgnoreCase)
                ? baseUrl
                : baseUrl.EndsWith("/v1", StringComparison.OrdinalIgnoreCase) ? baseUrl + "/messages" : baseUrl + "/v1/messages",
            ApiProtocol.OpenAiCompletions or ApiProtocol.AzureOpenAiCompletions => baseUrl.EndsWith("/v1/chat/completions", StringComparison.OrdinalIgnoreCase)
                ? baseUrl
                : baseUrl.EndsWith("/v1", StringComparison.OrdinalIgnoreCase) ? baseUrl + "/chat/completions" : baseUrl + "/v1/chat/completions",
            ApiProtocol.OpenAiResponses or ApiProtocol.AzureOpenAiResponses => baseUrl.EndsWith("/v1/responses", StringComparison.OrdinalIgnoreCase)
                ? baseUrl
                : baseUrl.EndsWith("/v1", StringComparison.OrdinalIgnoreCase) ? baseUrl + "/responses" : baseUrl + "/v1/responses",
            ApiProtocol.GoogleGenerativeAi => baseUrl + (baseUrl.EndsWith("/v1beta", StringComparison.OrdinalIgnoreCase) ? string.Empty : "/v1beta")
                + "/models/" + Uri.EscapeDataString(model.UpstreamModel) + ":generateContent",
            _ => baseUrl
        };

        object payload = channel.Protocol switch
        {
            ApiProtocol.AnthropicMessages => new { model = model.UpstreamModel, max_tokens = 16, messages = new[] { new { role = "user", content = "ping" } } },
            ApiProtocol.OpenAiCompletions or ApiProtocol.AzureOpenAiCompletions =>
                new { model = model.UpstreamModel, max_tokens = 16, messages = new[] { new { role = "user", content = "ping" } } },
            ApiProtocol.OpenAiResponses or ApiProtocol.AzureOpenAiResponses => new { model = model.UpstreamModel, input = "ping", max_output_tokens = 16 },
            ApiProtocol.GoogleGenerativeAi => new { contents = new[] { new { parts = new[] { new { text = "ping" } } } } },
            _ => new { }
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonContent.Create(payload)
        };
        switch (channel.Protocol)
        {
            case ApiProtocol.AnthropicMessages:
                request.Headers.TryAddWithoutValidation("x-api-key", apiKey);
                request.Headers.TryAddWithoutValidation("anthropic-version", "2023-06-01");
                break;
            case ApiProtocol.GoogleGenerativeAi:
                request.Headers.TryAddWithoutValidation("x-goog-api-key", apiKey);
                break;
            case ApiProtocol.AzureOpenAiResponses:
            case ApiProtocol.AzureOpenAiCompletions:
                request.Headers.TryAddWithoutValidation("api-key", apiKey);
                break;
            default:
                request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + apiKey);
                break;
        }

        var client = httpClientFactory.CreateClient("upstream");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        var stopwatch = Stopwatch.StartNew();
        try
        {
            using var response = await client.SendAsync(request, timeout.Token);
            var body = await response.Content.ReadAsByteArrayAsync(timeout.Token);
            stopwatch.Stop();
            if (!response.IsSuccessStatusCode)
            {
                return new ChannelTestResult(false, (int)response.StatusCode, (int)stopwatch.ElapsedMilliseconds, null,
                    "上游返回 HTTP " + (int)response.StatusCode);
            }

            var usage = UsageParser.ParseNonStream(channel.Protocol.ToWire(), body);
            return new ChannelTestResult(true, (int)response.StatusCode, (int)stopwatch.ElapsedMilliseconds, usage, null);
        }
        catch (OperationCanceledException)
        {
            return new ChannelTestResult(false, 0, (int)stopwatch.ElapsedMilliseconds, null, "连接超时");
        }
        catch (HttpRequestException)
        {
            return new ChannelTestResult(false, 0, (int)stopwatch.ElapsedMilliseconds, null, "无法连接上游");
        }
    }
}