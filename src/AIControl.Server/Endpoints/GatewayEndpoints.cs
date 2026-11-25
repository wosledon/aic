using AIControl.Domain;
using AIControl.Infrastructure;
using AIControl.Infrastructure.Policy;
using AIControl.Server.Api;
using AIControl.Server.Services;
using Microsoft.EntityFrameworkCore;

namespace AIControl.Server.Endpoints;

public static class GatewayEndpoints
{
    public static IEndpointRouteBuilder MapGatewayEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/gw/anthropic/v1/messages",
            (HttpContext context, GatewayProxyService proxy) => proxy.HandleProxyAsync(context, ApiProtocol.AnthropicMessages, null))
            .RequireAuthorization();

        app.MapPost("/gw/openai/v1/chat/completions",
            (HttpContext context, GatewayProxyService proxy) => proxy.HandleProxyAsync(context, ApiProtocol.OpenAiCompletions, null))
            .RequireAuthorization();

        app.MapPost("/gw/openai/v1/responses",
            (HttpContext context, GatewayProxyService proxy) => proxy.HandleProxyAsync(context, ApiProtocol.OpenAiResponses, null))
            .RequireAuthorization();

        app.MapPost("/gw/google/v1beta/models/{model}:streamGenerateContent",
            (HttpContext context, GatewayProxyService proxy) =>
                proxy.HandleProxyAsync(context, ApiProtocol.GoogleGenerativeAi, context.Request.RouteValues["model"]?.ToString()))
            .RequireAuthorization();

        app.MapPost("/gw/google/v1beta/models/{model}:generateContent",
            (HttpContext context, GatewayProxyService proxy) =>
                proxy.HandleProxyAsync(context, ApiProtocol.GoogleGenerativeAi, context.Request.RouteValues["model"]?.ToString()))
            .RequireAuthorization();

        var modelsHandler = async (HttpContext context, AppDbContext db, AccessPolicyService policy, CancellationToken ct) =>
        {
            var userId = context.User.UserId();
            var models = await db.PublicModels.AsNoTracking()
                .Where(x => x.Status == PublicModelStatus.Enabled)
                .OrderBy(x => x.Alias)
                .ToListAsync(ct);
            var data = new List<object>();
            foreach (var model in models)
            {
                if (!(await policy.CheckModelAccessAsync(userId, null, model.Alias, ct)).Allowed)
                {
                    continue;
                }
                data.Add(new
                {
                    id = model.Alias,
                    @object = "model",
                    created = new DateTimeOffset(model.CreatedAt).ToUnixTimeSeconds(),
                    owned_by = "aicontrol",
                    display_name = model.DisplayName,
                    context_window = model.ContextWindow,
                    max_tokens = model.MaxTokens
                });
            }
            return ApiErrors.Json(new { @object = "list", data });
        };

        app.MapGet("/gw/v1/models", modelsHandler).RequireAuthorization();
        app.MapGet("/gw/openai/v1/models", modelsHandler).RequireAuthorization();
        app.MapGet("/gw/anthropic/v1/models", modelsHandler).RequireAuthorization();
        app.MapGet("/gw/google/v1beta/models", modelsHandler).RequireAuthorization();

        return app;
    }
}