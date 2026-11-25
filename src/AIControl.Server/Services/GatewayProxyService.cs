using System.Buffers;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using AIControl.Domain;
using AIControl.Infrastructure;
using AIControl.Infrastructure.Gateway;
using AIControl.Infrastructure.Policy;
using AIControl.Infrastructure.Projects;
using AIControl.Infrastructure.Security;
using AIControl.Infrastructure.Telemetry;
using AIControl.Server.Api;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AIControl.Server.Services;

/// <summary>
/// Transparent protocol-preserving proxy: authenticate, authorize, route, stream and meter.
/// Upstream credentials never leave the server.
/// </summary>
public sealed class GatewayProxyService(
    AppDbContext db,
    AccessPolicyService policy,
    SecretProtector protector,
    UsageEventQueue usageQueue,
    IHttpClientFactory httpClientFactory,
    RateLimiter rateLimiter,
    ChannelCircuitBreaker circuitBreaker,
    IOptions<GatewayOptions> gatewayOptions,
    ILogger<GatewayProxyService> logger)
{
    private readonly GatewayOptions _options = gatewayOptions.Value;

    private static readonly HashSet<string> BlockedHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Host", "Content-Length", "Authorization", "x-api-key", "x-goog-api-key", "Cookie", "Connection",
        "Keep-Alive", "Transfer-Encoding", "Upgrade", "Proxy-Authorization", "Proxy-Connection", "Forwarded",
        "Accept-Encoding", "TE", "Trailer"
    };

    public async Task HandleProxyAsync(HttpContext context, ApiProtocol endpointProtocol, string? modelFromPath)
    {
        var requestId = ApiErrors.NewRequestId();
        context.Items["aic_request_id"] = requestId;
        context.Response.Headers["X-AIC-Request-Id"] = requestId;
        var requestStarted = Stopwatch.StartNew();
        var userId = context.User.UserId();
        var deviceId = context.User.DeviceId() ?? context.Request.Headers["X-AIC-Device"].FirstOrDefault();

        if (userId == Guid.Empty)
        {
            await ApiErrors.WriteAsync(context, StatusCodes.Status401Unauthorized, "invalid_token", "网关令牌无效。", requestId);
            return;
        }

        var body = await ReadBodyAsync(context);
        if (body is null)
        {
            await ApiErrors.WriteAsync(context, StatusCodes.Status413PayloadTooLarge, "payload_too_large", "请求体超过大小限制。", requestId);
            return;
        }

        string? modelAlias = modelFromPath;
        var streamRequested = false;
        if (string.IsNullOrEmpty(modelAlias))
        {
            try
            {
                using var doc = JsonDocument.Parse(body);
                modelAlias = doc.RootElement.TryGetProperty("model", out var modelElement) && modelElement.ValueKind == JsonValueKind.String
                    ? modelElement.GetString()
                    : null;
                streamRequested = doc.RootElement.TryGetProperty("stream", out var streamElement) && streamElement.ValueKind == JsonValueKind.True;
            }
            catch (JsonException)
            {
                await ApiErrors.WriteAsync(context, StatusCodes.Status400BadRequest, "invalid_request", "请求体不是合法 JSON。", requestId);
                return;
            }
        }
        else
        {
            streamRequested = context.Request.Path.Value?.Contains(":streamGenerateContent", StringComparison.OrdinalIgnoreCase) == true;
        }

        if (string.IsNullOrWhiteSpace(modelAlias))
        {
            await ApiErrors.WriteAsync(context, StatusCodes.Status400BadRequest, "model_required", "请求体缺少 model 字段。", requestId);
            return;
        }

        var publicModel = await db.PublicModels.AsNoTracking()
            .Include(x => x.ChannelModel).ThenInclude(cm => cm!.Channel)
            .FirstOrDefaultAsync(x => x.Alias == modelAlias, context.RequestAborted);
        if (publicModel is null || publicModel.Status == PublicModelStatus.Disabled)
        {
            await ApiErrors.WriteAsync(context, StatusCodes.Status403Forbidden, "model_not_allowed", "模型不可用或不在允许范围内。", requestId);
            return;
        }

        if (!ProtocolMatches(publicModel.Protocol, endpointProtocol))
        {
            await ApiErrors.WriteAsync(context, StatusCodes.Status400BadRequest, "protocol_not_supported", "请求路径与模型协议不一致。", requestId);
            return;
        }

        var projectKey = context.Request.Headers["X-AIC-Project"].FirstOrDefault()?.Trim();
        Project? project = null;
        if (!string.IsNullOrEmpty(projectKey) && !string.Equals(projectKey, "unattributed", StringComparison.OrdinalIgnoreCase))
        {
            if (projectKey.Length > 128)
            {
                await ApiErrors.WriteAsync(context, StatusCodes.Status400BadRequest, "invalid_request", "项目标识无效。", requestId);
                return;
            }

            project = await db.Projects.FirstOrDefaultAsync(x => x.Key == projectKey, context.RequestAborted);
            if (project is null)
            {
                // Projects are reported by clients; auto-create on first attributed request.
                project = await ProjectRegistry.EnsureAsync(db, projectKey, projectKey, userId, "gateway", context.RequestAborted);
                await db.SaveChangesAsync(context.RequestAborted);
            }
            else if (project.Status != ProjectStatus.Active)
            {
                await ApiErrors.WriteAsync(context, StatusCodes.Status403Forbidden, "project_archived", "项目已归档，无法继续归因。", requestId);
                return;
            }
            else if (!await db.ProjectMembers.AnyAsync(
                         x => x.ProjectId == project.Id && x.UserId == userId, context.RequestAborted))
            {
                db.ProjectMembers.Add(new ProjectMember
                {
                    ProjectId = project.Id,
                    UserId = userId,
                    Source = "gateway"
                });
                await db.SaveChangesAsync(context.RequestAborted);
            }
        }

        var access = await policy.CheckModelAccessAsync(userId, project?.Id, publicModel.Alias, context.RequestAborted);
        if (!access.Allowed)
        {
            await ApiErrors.WriteAsync(context, StatusCodes.Status403Forbidden, access.Code ?? "model_not_allowed", access.Message ?? "模型不允许。", requestId);
            return;
        }

        var quota = await policy.CheckQuotaAsync(userId, context.RequestAborted);
        if (!quota.Allowed)
        {
            await ApiErrors.WriteAsync(context, StatusCodes.Status429TooManyRequests, quota.Code ?? "quota_exceeded", quota.Message ?? "配额已用完。", requestId);
            return;
        }

        var rateConfig = await policy.GetRateLimitPolicyAsync(userId, project?.Id, context.RequestAborted);
        if (!rateLimiter.TryAcquire($"user:{userId}", ReadRateLimit(rateConfig), out var retryAfter))
        {
            await ApiErrors.WriteAsync(context, StatusCodes.Status429TooManyRequests, "rate_limited", "请求过于频繁，请稍后重试。", requestId, retryAfter);
            return;
        }

        var sessionIdHeader = context.Request.Headers["X-AIC-Session"].FirstOrDefault();
        var session = string.IsNullOrWhiteSpace(sessionIdHeader)
            ? null
            : await db.AgentSessions.AsNoTracking().FirstOrDefaultAsync(
                x => x.PiSessionId == sessionIdHeader && x.UserId == userId, context.RequestAborted);
        var usage = new UsageContext
        {
            RequestId = requestId,
            UserId = userId,
            ProjectId = project?.Id ?? session?.ProjectId,
            AgentSessionId = session?.Id,
            DeviceId = deviceId,
            PublicModelId = publicModel.Id,
            PublicModelAlias = publicModel.Alias,
            Protocol = endpointProtocol.ToWire(),
            Streaming = streamRequested,
            OccurredAt = DateTime.UtcNow
        };

        var channelModel = publicModel.ChannelModel;
        if (channelModel is null || !channelModel.Enabled || channelModel.Channel is null || channelModel.Channel.Status != ChannelStatus.Enabled)
        {
            usage.StatusCode = StatusCodes.Status503ServiceUnavailable;
            usage.ErrorCode = "channel_unavailable";
            usage.LatencyMs = (int)requestStarted.ElapsedMilliseconds;
            QueueUsage(usage, 0, 0, 0, 0, UsageSource.Upstream);
            await ApiErrors.WriteAsync(context, StatusCodes.Status503ServiceUnavailable, "channel_unavailable", "该模型尚未绑定可用的供应商，请联系管理员。", requestId);
            return;
        }

        var channel = channelModel.Channel;
        var result = await TryForwardAsync(context, channel, channelModel, endpointProtocol, body, modelFromPath, requestStarted, usage, requestId);
        if (result is null)
        {
            // Response has been written (success or terminal error).
            return;
        }

        circuitBreaker.RecordFailure(channel.Id);
        logger.LogWarning("Upstream channel {Channel} failed status={Status} code={Code}", channel.Name, result.Value.Status, result.Value.ErrorCode);
        usage.StatusCode = result.Value.Status == 0 ? StatusCodes.Status502BadGateway : result.Value.Status;
        usage.ErrorCode = result.Value.ErrorCode;
        usage.LatencyMs = (int)requestStarted.ElapsedMilliseconds;
        QueueUsage(usage, 0, 0, 0, 0, UsageSource.Upstream);
        await ApiErrors.WriteAsync(context,
            result.Value.Status == StatusCodes.Status429TooManyRequests ? StatusCodes.Status429TooManyRequests : StatusCodes.Status502BadGateway,
            result.Value.ErrorCode,
            "上游供应商暂时不可用，请稍后重试。",
            requestId);
    }

    /// <summary>Returns null when a response was completed, otherwise a retryable failure.</summary>
    private async Task<(int Status, string ErrorCode)?> TryForwardAsync(
        HttpContext context,
        Channel channel,
        ChannelModel channelModel,
        ApiProtocol endpointProtocol,
        byte[] body,
        string? modelFromPath,
        Stopwatch requestStarted,
        UsageContext usage,
        string requestId)
    {
        var apiKey = protector.Unprotect(channel.ApiKeyCipher);
        var baseUrl = protector.Unprotect(channel.BaseUrlCipher);
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            return (StatusCodes.Status503ServiceUnavailable, "channel_misconfigured");
        }

        usage.ChannelId = channel.Id;
        usage.UpstreamModel = channelModel.UpstreamModel;

        var upstreamBody = PrepareUpstreamBody(channel.Protocol, body);
        var url = BuildUpstreamUrl(baseUrl, channel.Protocol, modelFromPath, context.Request.QueryString.Value, usage.Streaming);
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new ByteArrayContent(upstreamBody)
        };

        foreach (var header in context.Request.Headers)
        {
            if (BlockedHeaders.Contains(header.Key)
                || header.Key.StartsWith("X-AIC-", StringComparison.OrdinalIgnoreCase)
                || header.Key.StartsWith("X-Forwarded-", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            request.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
        }
        request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");

        ApplyChannelHeaders(request, protector.Unprotect(channel.HeadersCipher));
        if (string.IsNullOrWhiteSpace(apiKey) && !baseUrl.Contains("/mock/", StringComparison.OrdinalIgnoreCase))
        {
            return (StatusCodes.Status503ServiceUnavailable, "channel_misconfigured");
        }

        switch (channel.Protocol)
        {
            case ApiProtocol.AnthropicMessages:
                request.Headers.TryAddWithoutValidation("x-api-key", apiKey);
                if (!request.Headers.Contains("anthropic-version"))
                {
                    request.Headers.TryAddWithoutValidation("anthropic-version", "2023-06-01");
                }
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
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        timeout.CancelAfter(TimeSpan.FromSeconds(_options.UpstreamTimeoutSeconds));

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        }
        catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested)
        {
            logger.LogWarning("Upstream timeout channel={Channel}", channel.Name);
            return (StatusCodes.Status504GatewayTimeout, "upstream_timeout");
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "Upstream connection failure channel={Channel}", channel.Name);
            return (StatusCodes.Status502BadGateway, "upstream_error");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var status = (int)response.StatusCode;
                var errorCode = status switch
                {
                    429 => "upstream_rate_limited",
                    408 => "upstream_timeout",
                    401 or 403 => "upstream_auth_error",
                    _ => "upstream_error"
                };
                // Never forward upstream response bodies (may contain host names or credentials).
                _ = response.Content.Headers.ContentLength;
                return (status, errorCode);
            }

            var contentType = response.Content.Headers.ContentType?.MediaType ?? "application/json";
            var isSse = contentType.Contains("event-stream", StringComparison.OrdinalIgnoreCase)
                        || (usage.Streaming && !contentType.Contains("json", StringComparison.OrdinalIgnoreCase));

            context.Response.StatusCode = (int)response.StatusCode;
            context.Response.ContentType = contentType;
            if (isSse)
            {
                context.Response.Headers.CacheControl = "no-cache";
                context.Response.Headers["X-Accel-Buffering"] = "no";
            }

            var usageSnapshot = default(UsageSnapshot);
            var firstByteMs = 0;
            long streamedBytes = 0;
            var clientDisconnected = false;

            // Once upstream headers are received, do not tie the upstream read to the
            // client connection. Some clients close as soon as they see finish_reason,
            // while providers send the final usage chunk afterwards; draining keeps
            // token accounting complete.
            using var readTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(_options.UpstreamTimeoutSeconds));

            try
            {
                if (isSse)
                {
                    var tap = new SseUsageTap(channel.Protocol.ToWire());
                    await using var upstreamStream = await response.Content.ReadAsStreamAsync(readTimeout.Token);
                    var buffer = ArrayPool<byte>.Shared.Rent(16 * 1024);
                    try
                    {
                        int read;
                        while ((read = await upstreamStream.ReadAsync(buffer.AsMemory(0, buffer.Length), readTimeout.Token)) > 0)
                        {
                            if (firstByteMs == 0)
                            {
                                firstByteMs = (int)requestStarted.ElapsedMilliseconds;
                            }
                            streamedBytes += read;
                            tap.Feed(buffer.AsSpan(0, read));
                            if (!clientDisconnected)
                            {
                                try
                                {
                                    await context.Response.Body.WriteAsync(buffer.AsMemory(0, read), context.RequestAborted);
                                    await context.Response.Body.FlushAsync(context.RequestAborted);
                                }
                                catch (OperationCanceledException)
                                {
                                    clientDisconnected = true;
                                }
                                catch (IOException)
                                {
                                    clientDisconnected = true;
                                }
                            }
                        }
                    }
                    finally
                    {
                        ArrayPool<byte>.Shared.Return(buffer);
                    }
                    tap.Complete();
                    usageSnapshot = tap.Snapshot;
                }
                else
                {
                    var payload = await response.Content.ReadAsByteArrayAsync(readTimeout.Token);
                    firstByteMs = (int)requestStarted.ElapsedMilliseconds;
                    usageSnapshot = UsageParser.ParseNonStream(channel.Protocol.ToWire(), payload);
                    try
                    {
                        await context.Response.Body.WriteAsync(payload, context.RequestAborted);
                    }
                    catch (OperationCanceledException)
                    {
                        clientDisconnected = true;
                    }
                    catch (IOException)
                    {
                        clientDisconnected = true;
                    }
                }
            }
            catch (OperationCanceledException)
            {
                usage.StatusCode = StatusCodes.Status504GatewayTimeout;
                usage.ErrorCode = "upstream_timeout";
                usage.LatencyMs = (int)requestStarted.ElapsedMilliseconds;
                usage.TtftMs = firstByteMs;
                var partial = usageSnapshot is { HasUsage: true } ? usageSnapshot : null;
                QueueUsage(usage, partial?.InputTokens ?? 0, partial?.OutputTokens ?? 0,
                    partial?.CacheReadTokens ?? 0, partial?.CacheWriteTokens ?? 0,
                    partial is null ? UsageSource.Partial : UsageSource.Upstream);
                return null;
            }
            catch (IOException)
            {
                usage.StatusCode = StatusCodes.Status502BadGateway;
                usage.ErrorCode = "upstream_error";
                usage.LatencyMs = (int)requestStarted.ElapsedMilliseconds;
                usage.TtftMs = firstByteMs;
                QueueUsage(usage, 0, 0, 0, 0, UsageSource.Partial);
                return null;
            }

            var snapshot = usageSnapshot;
            usage.StatusCode = context.Response.StatusCode;
            usage.ErrorCode = null;
            usage.LatencyMs = (int)requestStarted.ElapsedMilliseconds;
            usage.TtftMs = firstByteMs;
            if (snapshot is { HasUsage: true })
            {
                QueueUsage(usage, snapshot.InputTokens, snapshot.OutputTokens, snapshot.CacheReadTokens, snapshot.CacheWriteTokens, UsageSource.Upstream);
            }
            else
            {
                var estimatedInput = Math.Max(1, body.Length / 4);
                var estimatedOutput = Math.Max(0, (int)(streamedBytes / 4));
                QueueUsage(usage, estimatedInput, estimatedOutput, 0, 0, UsageSource.Estimated);
            }

            _ = clientDisconnected;
            circuitBreaker.RecordSuccess(channel.Id);
            return null;
        }
    }

    private void QueueUsage(UsageContext usage, long input, long output, long cacheRead, long cacheWrite, UsageSource source)
    {
        var total = input + output + cacheRead + cacheWrite;
        var entity = new UsageEvent
        {
            RequestId = usage.RequestId,
            UserId = usage.UserId,
            ProjectId = usage.ProjectId,
            AgentSessionId = usage.AgentSessionId,
            DeviceId = usage.DeviceId,
            PublicModelId = usage.PublicModelId,
            PublicModelAlias = usage.PublicModelAlias,
            ChannelId = usage.ChannelId,
            UpstreamModel = usage.UpstreamModel ?? usage.PublicModelAlias,
            InputTokens = input,
            OutputTokens = output,
            CacheReadTokens = cacheRead,
            CacheWriteTokens = cacheWrite,
            TotalTokens = total,
            UsageSource = source,
            LatencyMs = usage.LatencyMs,
            TtftMs = usage.TtftMs,
            StatusCode = usage.StatusCode == 0 ? 200 : usage.StatusCode,
            ErrorCode = usage.ErrorCode,
            Streaming = usage.Streaming,
            Protocol = usage.Protocol,
            OccurredAt = usage.OccurredAt
        };
        if (!usageQueue.TryEnqueue(entity))
        {
            logger.LogWarning("Usage queue full, dropping request {RequestId}", usage.RequestId);
        }
    }

    private static int ReadRateLimit(string configJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(configJson);
            return doc.RootElement.TryGetProperty("rpm", out var rpm) && rpm.TryGetInt32(out var value) ? value : 120;
        }
        catch (JsonException)
        {
            return 120;
        }
    }

    private static bool ProtocolMatches(ApiProtocol modelProtocol, ApiProtocol endpointProtocol) =>
        modelProtocol == endpointProtocol
        || (endpointProtocol == ApiProtocol.OpenAiCompletions && modelProtocol == ApiProtocol.AzureOpenAiCompletions)
        || (endpointProtocol == ApiProtocol.OpenAiResponses && modelProtocol == ApiProtocol.AzureOpenAiResponses);

    private static byte[] PrepareUpstreamBody(ApiProtocol channelProtocol, byte[] body)
    {
        if (channelProtocol is not (ApiProtocol.OpenAiCompletions or ApiProtocol.AzureOpenAiCompletions))
        {
            return body;
        }

        try
        {
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("stream", out var stream) || stream.ValueKind != JsonValueKind.True
                || doc.RootElement.TryGetProperty("stream_options", out _))
            {
                return body;
            }

            using var streamBuffer = new MemoryStream();
            using (var writer = new Utf8JsonWriter(streamBuffer))
            {
                writer.WriteStartObject();
                foreach (var property in doc.RootElement.EnumerateObject())
                {
                    property.WriteTo(writer);
                }
                writer.WritePropertyName("stream_options");
                writer.WriteStartObject();
                writer.WriteBoolean("include_usage", true);
                writer.WriteEndObject();
                writer.WriteEndObject();
            }
            return streamBuffer.ToArray();
        }
        catch (JsonException)
        {
            return body;
        }
    }

    private static string BuildUpstreamUrl(string baseUrl, ApiProtocol protocol, string? modelFromPath, string? queryString, bool streaming)
    {
        var root = baseUrl.TrimEnd('/');
        string path = protocol switch
        {
            ApiProtocol.AnthropicMessages => root.EndsWith("/v1/messages", StringComparison.OrdinalIgnoreCase)
                ? root
                : root.EndsWith("/v1", StringComparison.OrdinalIgnoreCase) ? root + "/messages" : root + "/v1/messages",
            ApiProtocol.OpenAiResponses or ApiProtocol.AzureOpenAiResponses => root.EndsWith("/v1/responses", StringComparison.OrdinalIgnoreCase)
                ? root
                : root.EndsWith("/v1", StringComparison.OrdinalIgnoreCase) ? root + "/responses" : root + "/v1/responses",
            ApiProtocol.OpenAiCompletions or ApiProtocol.AzureOpenAiCompletions => root.EndsWith("/v1/chat/completions", StringComparison.OrdinalIgnoreCase)
                ? root
                : root.EndsWith("/v1", StringComparison.OrdinalIgnoreCase) ? root + "/chat/completions" : root + "/v1/chat/completions",
            ApiProtocol.GoogleGenerativeAi => root + "/v1beta/models/" + Uri.EscapeDataString(modelFromPath ?? "gemini")
                + (streaming ? ":streamGenerateContent" : ":generateContent"),
            _ => root
        };

        if (!string.IsNullOrEmpty(queryString))
        {
            path += path.Contains('?') ? "&" + queryString.TrimStart('?') : queryString;
        }
        if (protocol == ApiProtocol.GoogleGenerativeAi && streaming && !path.Contains("alt=sse", StringComparison.OrdinalIgnoreCase))
        {
            path += path.Contains('?') ? "&alt=sse" : "?alt=sse";
        }
        return path;
    }

    private static void ApplyChannelHeaders(HttpRequestMessage request, string? headersJson)
    {
        if (string.IsNullOrWhiteSpace(headersJson))
        {
            return;
        }

        try
        {
            using var doc = JsonDocument.Parse(headersJson);
            foreach (var header in doc.RootElement.EnumerateObject())
            {
                if (header.Value.ValueKind == JsonValueKind.String)
                {
                    request.Headers.Remove(header.Name);
                    request.Headers.TryAddWithoutValidation(header.Name, header.Value.GetString());
                }
            }
        }
        catch (JsonException)
        {
        }
    }

    private async Task<byte[]?> ReadBodyAsync(HttpContext context)
    {
        if (context.Request.ContentLength > _options.MaxBodyBytes)
        {
            return null;
        }

        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await context.Request.Body.ReadAsync(chunk, context.RequestAborted)) > 0)
        {
            if (buffer.Length + read > _options.MaxBodyBytes)
            {
                return null;
            }
            await buffer.WriteAsync(chunk.AsMemory(0, read), context.RequestAborted);
        }
        return buffer.ToArray();
    }

    private sealed class UsageContext
    {
        public string RequestId { get; set; } = string.Empty;
        public Guid UserId { get; set; }
        public Guid? ProjectId { get; set; }
        public Guid? AgentSessionId { get; set; }
        public string? DeviceId { get; set; }
        public Guid? PublicModelId { get; set; }
        public string PublicModelAlias { get; set; } = string.Empty;
        public Guid? ChannelId { get; set; }
        public string? UpstreamModel { get; set; }
        public string Protocol { get; set; } = string.Empty;
        public bool Streaming { get; set; }
        public int StatusCode { get; set; } = 200;
        public string? ErrorCode { get; set; }
        public int LatencyMs { get; set; }
        public int TtftMs { get; set; }
        public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
    }
}