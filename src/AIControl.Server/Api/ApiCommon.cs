using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using AIControl.Domain;
using AIControl.Infrastructure;

namespace AIControl.Server.Api;

public static class ApiJson
{
    public static readonly JsonSerializerOptions Options = Create();

    private static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }
}

public static class ApiErrors
{
    public static string NewRequestId() => "req_" + Guid.NewGuid().ToString("N");

    public static Task WriteAsync(HttpContext context, int status, string code, string message, string? requestId = null, int retryAfterSeconds = 0)
    {
        var id = requestId ?? context.Items["aic_request_id"] as string ?? NewRequestId();
        context.Items["aic_request_id"] = id;
        context.Response.Headers["X-AIC-Request-Id"] = id;
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        if (retryAfterSeconds > 0)
        {
            context.Response.Headers.RetryAfter = retryAfterSeconds.ToString();
        }

        var payload = JsonSerializer.Serialize(new
        {
            error = new
            {
                code,
                message,
                request_id = id,
                retry_after = retryAfterSeconds
            }
        }, ApiJson.Options);
        return context.Response.WriteAsync(payload);
    }

    public static IResult Json(object value, int status = StatusCodes.Status200OK) => Results.Json(value, ApiJson.Options, statusCode: status);
}

public static class ClaimExtensions
{
    public static Guid UserId(this ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue("sub") ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(value, out var id) ? id : Guid.Empty;
    }

    public static string UserName(this ClaimsPrincipal principal) =>
        principal.FindFirstValue("name") ?? principal.FindFirstValue(ClaimTypes.Name) ?? "unknown";

    public static string Role(this ClaimsPrincipal principal) =>
        principal.FindFirstValue("role") ?? principal.FindFirstValue(ClaimTypes.Role) ?? "user";

    public static string? DeviceId(this ClaimsPrincipal principal) => principal.FindFirstValue("device_id");
}

public static class Audit
{
    public static void Add(
        AppDbContext db,
        HttpContext context,
        string action,
        string targetType,
        string? targetId = null,
        object? detail = null,
        Guid? actorUserId = null,
        string? actorName = null)
    {
        db.AuditLogs.Add(new AuditLog
        {
            ActorUserId = actorUserId ?? (context.User.Identity?.IsAuthenticated == true ? context.User.UserId() : null),
            ActorName = actorName ?? (context.User.Identity?.IsAuthenticated == true ? context.User.UserName() : "system"),
            Action = action,
            TargetType = targetType,
            TargetId = targetId,
            DetailJson = detail is null ? null : JsonSerializer.Serialize(detail, ApiJson.Options),
            Ip = context.Connection.RemoteIpAddress?.ToString(),
            UserAgent = context.Request.Headers.UserAgent.ToString()
        });
    }
}