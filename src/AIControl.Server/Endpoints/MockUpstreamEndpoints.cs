using System.Text.Json;
using AIControl.Server.Api;

namespace AIControl.Server.Endpoints;

/// <summary>
/// Built-in mock upstream used by the seeded demo channels. It speaks the same wire
/// protocols as real providers so the gateway, streaming and usage parsing can be
/// exercised end-to-end without any upstream API key.
/// </summary>
public static class MockUpstreamEndpoints
{
    public static IEndpointRouteBuilder MapMockUpstream(this IEndpointRouteBuilder app)
    {
        app.MapPost("/mock/anthropic/v1/messages", HandleAnthropicAsync);
        app.MapPost("/mock/openai/v1/chat/completions", HandleOpenAiChatAsync);
        app.MapPost("/mock/openai/v1/responses", HandleOpenAiResponsesAsync);
        return app;
    }

    private static async Task HandleAnthropicAsync(HttpContext context)
    {
        var (model, stream) = await ReadRequestAsync(context);
        const string text = "这是 AIControl 内置模拟上游的回复。网关已完成认证、项目校验、流式转发与 token 计量。";
        var input = 1180;
        var cacheRead = 420;
        var output = 64;

        if (!stream)
        {
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(JsonSerializer.Serialize(new
            {
                id = "msg_mock_" + Guid.NewGuid().ToString("N")[..12],
                type = "message",
                role = "assistant",
                model,
                content = new object[] { new { type = "text", text } },
                stop_reason = "end_turn",
                usage = new
                {
                    input_tokens = input,
                    output_tokens = output,
                    cache_read_input_tokens = cacheRead,
                    cache_creation_input_tokens = 0
                }
            }, ApiJson.Options));
            return;
        }

        context.Response.ContentType = "text/event-stream";
        context.Response.Headers.CacheControl = "no-cache";
        await WriteSseAsync(context, "message_start", new
        {
            type = "message_start",
            message = new
            {
                id = "msg_mock_" + Guid.NewGuid().ToString("N")[..12],
                type = "message",
                role = "assistant",
                model,
                content = Array.Empty<object>(),
                usage = new
                {
                    input_tokens = input,
                    output_tokens = 1,
                    cache_read_input_tokens = cacheRead,
                    cache_creation_input_tokens = 0
                }
            }
        });
        await WriteSseAsync(context, "content_block_start", new
        {
            type = "content_block_start",
            index = 0,
            content_block = new { type = "text", text = "" }
        });
        foreach (var piece in Split(text, 12))
        {
            await WriteSseAsync(context, "content_block_delta", new
            {
                type = "content_block_delta",
                index = 0,
                delta = new { type = "text_delta", text = piece }
            });
            await Task.Delay(8, context.RequestAborted);
        }
        await WriteSseAsync(context, "content_block_stop", new { type = "content_block_stop", index = 0 });
        await WriteSseAsync(context, "message_delta", new
        {
            type = "message_delta",
            delta = new { stop_reason = "end_turn" },
            usage = new { output_tokens = output }
        });
        await WriteSseAsync(context, "message_stop", new { type = "message_stop" });
    }

    private static async Task HandleOpenAiChatAsync(HttpContext context)
    {
        var (model, stream) = await ReadRequestAsync(context);
        const string text = "这是 AIControl 内置模拟上游（OpenAI Chat Completions）的回复。";
        var id = "chatcmpl-mock-" + Guid.NewGuid().ToString("N")[..12];
        var usage = new
        {
            prompt_tokens = 1260,
            completion_tokens = 52,
            total_tokens = 1312,
            prompt_tokens_details = new { cached_tokens = 360 }
        };

        if (!stream)
        {
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(JsonSerializer.Serialize(new
            {
                id,
                @object = "chat.completion",
                created = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                model,
                choices = new object[]
                {
                    new
                    {
                        index = 0,
                        message = new { role = "assistant", content = text },
                        finish_reason = "stop"
                    }
                },
                usage
            }, ApiJson.Options));
            return;
        }

        context.Response.ContentType = "text/event-stream";
        context.Response.Headers.CacheControl = "no-cache";
        foreach (var piece in Split(text, 10))
        {
            await WriteDataAsync(context, new
            {
                id,
                @object = "chat.completion.chunk",
                created = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                model,
                choices = new object[] { new { index = 0, delta = new { content = piece }, finish_reason = (string?)null } }
            });
            await Task.Delay(8, context.RequestAborted);
        }
        await WriteDataAsync(context, new
        {
            id,
            @object = "chat.completion.chunk",
            created = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            model,
            choices = new object[] { new { index = 0, delta = new { }, finish_reason = "stop" } }
        });
        await WriteDataAsync(context, new
        {
            id,
            @object = "chat.completion.chunk",
            created = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            model,
            choices = Array.Empty<object>(),
            usage
        });
        await context.Response.WriteAsync("data: [DONE]\n\n", context.RequestAborted);
        await context.Response.Body.FlushAsync(context.RequestAborted);
    }

    private static async Task HandleOpenAiResponsesAsync(HttpContext context)
    {
        var (model, stream) = await ReadRequestAsync(context);
        const string text = "这是 AIControl 内置模拟上游（OpenAI Responses）的回复。";
        var id = "resp_mock_" + Guid.NewGuid().ToString("N")[..12];
        var usage = new
        {
            input_tokens = 1340,
            output_tokens = 58,
            input_tokens_details = new { cached_tokens = 410 }
        };

        if (!stream)
        {
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(JsonSerializer.Serialize(new
            {
                id,
                @object = "response",
                status = "completed",
                model,
                output = new object[]
                {
                    new
                    {
                        type = "message",
                        role = "assistant",
                        content = new object[] { new { type = "output_text", text } }
                    }
                },
                usage
            }, ApiJson.Options));
            return;
        }

        context.Response.ContentType = "text/event-stream";
        context.Response.Headers.CacheControl = "no-cache";
        await WriteSseAsync(context, "response.created", new
        {
            type = "response.created",
            response = new { id, @object = "response", status = "in_progress", model }
        });
        foreach (var piece in Split(text, 10))
        {
            await WriteSseAsync(context, "response.output_text.delta", new
            {
                type = "response.output_text.delta",
                response_id = id,
                delta = piece
            });
            await Task.Delay(8, context.RequestAborted);
        }
        await WriteSseAsync(context, "response.completed", new
        {
            type = "response.completed",
            response = new
            {
                id,
                @object = "response",
                status = "completed",
                model,
                output = new object[]
                {
                    new
                    {
                        type = "message",
                        role = "assistant",
                        content = new object[] { new { type = "output_text", text } }
                    }
                },
                usage
            }
        });
    }

    private static async Task<(string Model, bool Stream)> ReadRequestAsync(HttpContext context)
    {
        using var doc = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
        var model = doc.RootElement.TryGetProperty("model", out var modelEl) && modelEl.ValueKind == JsonValueKind.String
            ? modelEl.GetString() ?? "mock-model"
            : "mock-model";
        var stream = doc.RootElement.TryGetProperty("stream", out var streamEl) && streamEl.ValueKind == JsonValueKind.True;
        return (model, stream);
    }

    private static Task WriteDataAsync(HttpContext context, object payload) =>
        context.Response.WriteAsync("data: " + JsonSerializer.Serialize(payload, ApiJson.Options) + "\n\n", context.RequestAborted);

    private static Task WriteSseAsync(HttpContext context, string eventName, object payload) =>
        context.Response.WriteAsync("event: " + eventName + "\ndata: " + JsonSerializer.Serialize(payload, ApiJson.Options) + "\n\n", context.RequestAborted);

    private static IEnumerable<string> Split(string text, int size)
    {
        for (var i = 0; i < text.Length; i += size)
        {
            yield return text.Substring(i, Math.Min(size, text.Length - i));
        }
    }
}