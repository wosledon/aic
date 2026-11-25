using System.Text;
using AIControl.Infrastructure;
using AIControl.Infrastructure.Analytics;
using AIControl.Server.Api;
using Microsoft.EntityFrameworkCore;

namespace AIControl.Server.Endpoints;

public static class AnalyticsEndpoints
{
    public static IEndpointRouteBuilder MapAnalyticsEndpoints(this IEndpointRouteBuilder app)
    {
        var analytics = app.MapGroup("/api/v1/admin/analytics").RequireAuthorization("Admin");

        analytics.MapGet("/overview", async (
            DateTime? from,
            DateTime? to,
            Guid? project_id,
            AnalyticsService service,
            CancellationToken ct) =>
        {
            var (rangeFrom, rangeTo) = NormalizeRange(from, to);
            var result = await service.GetOverviewAsync(rangeFrom, rangeTo, project_id, ct);
            return ApiErrors.Json(result);
        });

        analytics.MapGet("/usage", async (
            DateTime? from,
            DateTime? to,
            string? group_by,
            Guid? project_id,
            Guid? user_id,
            Guid? model_id,
            int? limit,
            AnalyticsService service,
            CancellationToken ct) =>
        {
            var (rangeFrom, rangeTo) = NormalizeRange(from, to);
            var groups = string.IsNullOrWhiteSpace(group_by)
                ? ["project", "model"]
                : group_by.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
            var rows = await service.QueryUsageAsync(new UsageQuery(
                rangeFrom, rangeTo, groups, project_id, user_id, model_id, Math.Clamp(limit ?? 500, 1, 5000)), ct);
            return ApiErrors.Json(new
            {
                from = rangeFrom,
                to = rangeTo,
                group_by = groups,
                rows,
                row_count = rows.Count,
                note = rows.Count >= (limit ?? 500) ? "结果已达到返回上限，请缩小时间范围或导出。" : null
            });
        });

        analytics.MapGet("/usage/export", async (
            DateTime? from,
            DateTime? to,
            string? group_by,
            Guid? project_id,
            Guid? user_id,
            Guid? model_id,
            HttpContext context,
            AppDbContext db,
            AnalyticsService service,
            CancellationToken ct) =>
        {
            var (rangeFrom, rangeTo) = NormalizeRange(from, to);
            var groups = string.IsNullOrWhiteSpace(group_by)
                ? ["day", "project", "user", "model"]
                : group_by.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
            var rows = await service.QueryUsageAsync(new UsageQuery(
                rangeFrom, rangeTo, groups, project_id, user_id, model_id, 5000), ct);
            var csv = AnalyticsService.BuildUsageCsv(rows);
            Audit.Add(db, context, "analytics.export", "usage", null, new { from = rangeFrom, to = rangeTo, groups });
            await db.SaveChangesAsync(ct);
            var fileName = $"aicontrol-usage-{rangeFrom:yyyyMMdd}-{rangeTo:yyyyMMdd}.csv";
            return Results.File(new UTF8Encoding(true).GetBytes(csv), "text/csv; charset=utf-8", fileName);
        });

        analytics.MapGet("/approvals", async (
            DateTime? from,
            DateTime? to,
            Guid? project_id,
            Guid? user_id,
            AnalyticsService service,
            CancellationToken ct) =>
        {
            var (rangeFrom, rangeTo) = NormalizeRange(from, to);
            return ApiErrors.Json(await service.GetApprovalsAsync(rangeFrom, rangeTo, project_id, user_id, ct));
        });

        analytics.MapGet("/sessions", async (
            DateTime? from,
            DateTime? to,
            Guid? project_id,
            Guid? user_id,
            int? limit,
            AnalyticsService service,
            CancellationToken ct) =>
        {
            var (rangeFrom, rangeTo) = NormalizeRange(from, to);
            return ApiErrors.Json(await service.GetSessionsAsync(rangeFrom, rangeTo, project_id, user_id, limit ?? 100, ct));
        });

        return app;
    }

    public static (DateTime From, DateTime To) NormalizeRange(DateTime? from, DateTime? to)
    {
        var now = DateTime.UtcNow;
        var end = to?.ToUniversalTime() ?? now;
        var start = from?.ToUniversalTime() ?? end.AddDays(-7);
        if (start >= end)
        {
            start = end.AddDays(-7);
        }
        if ((end - start).TotalDays > 366)
        {
            start = end.AddDays(-366);
        }
        return (DateTime.SpecifyKind(start, DateTimeKind.Utc), DateTime.SpecifyKind(end, DateTimeKind.Utc));
    }
}

public static class MeEndpoints
{
    public static IEndpointRouteBuilder MapMeEndpoints(this IEndpointRouteBuilder app)
    {
        var me = app.MapGroup("/api/v1/me").RequireAuthorization();

        me.MapGet("/usage", async (HttpContext context, AppDbContext db, AnalyticsService service, CancellationToken ct) =>
        {
            var userId = context.User.UserId();
            var name = context.User.UserName();
            return ApiErrors.Json(await service.GetMeUsageAsync(userId, name, ct));
        });

        me.MapGet("/sessions", async (
            DateTime? from,
            DateTime? to,
            int? limit,
            HttpContext context,
            AnalyticsService service,
            CancellationToken ct) =>
        {
            var (rangeFrom, rangeTo) = AnalyticsEndpoints.NormalizeRange(from, to);
            return ApiErrors.Json(await service.GetSessionsAsync(rangeFrom, rangeTo, null, context.User.UserId(), limit ?? 50, ct));
        });

        me.MapGet("/devices", async (HttpContext context, AppDbContext db, CancellationToken ct) =>
        {
            var userId = context.User.UserId();
            var devices = await db.Devices.AsNoTracking()
                .Where(x => x.UserId == userId)
                .OrderByDescending(x => x.LastSeenAt)
                .ToListAsync(ct);
            var currentDevice = context.User.DeviceId();
            return ApiErrors.Json(devices.Select(x => new
            {
                id = x.Id,
                name = x.Name,
                os = x.Os,
                plugin_version = x.PluginVersion,
                pi_version = x.PiVersion,
                status = x.Status.ToString().ToLowerInvariant(),
                last_seen_at = x.LastSeenAt,
                created_at = x.CreatedAt,
                is_current = x.Id == currentDevice
            }));
        });

        me.MapDelete("/devices/{id}", async (string id, HttpContext context, AppDbContext db, CancellationToken ct) =>
        {
            var userId = context.User.UserId();
            var device = await db.Devices.FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId, ct);
            if (device is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "设备不存在。" } }, StatusCodes.Status404NotFound);
            }
            device.Status = AIControl.Domain.DeviceStatus.Revoked;
            var tokens = await db.RefreshTokens.Where(x => x.DeviceId == id && x.RevokedAt == null).ToListAsync(ct);
            foreach (var token in tokens)
            {
                token.RevokedAt = DateTime.UtcNow;
                token.RevokedReason = "device_revoked_by_user";
            }
            Audit.Add(db, context, "me.device.revoke", "device", id, new { device.Name });
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        me.MapGet("/profile", async (HttpContext context, AppDbContext db, CancellationToken ct) =>
        {
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == context.User.UserId(), ct);
            if (user is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "用户不存在。" } }, StatusCodes.Status404NotFound);
            }
            return ApiErrors.Json(new
            {
                id = user.Id,
                name = user.Name,
                email = user.Email,
                avatar_url = user.AvatarUrl,
                role = user.Role.ToString().ToLowerInvariant(),
                status = user.Status.ToString().ToLowerInvariant(),
                last_login_at = user.LastLoginAt,
                created_at = user.CreatedAt
            });
        });

        return app;
    }
}