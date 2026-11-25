using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AIControl.Domain;
using AIControl.Infrastructure;
using AIControl.Infrastructure.Policy;
using AIControl.Infrastructure.Security;
using AIControl.Infrastructure.Telemetry;
using AIControl.Server.Api;
using AIControl.Server.Services;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace AIControl.Server.Endpoints;

public sealed record DeviceStartRequest(string? DeviceId, string? DeviceName, string? Os, string? PluginVersion, string? PiVersion);
public sealed record DeviceCodeRequest(string DeviceCode);
public sealed record RefreshRequest(string RefreshToken, string? DeviceId);
public sealed record LogoutRequest(string? RefreshToken);
public sealed record DeviceUserCodeRequest(string UserCode);

public static class PluginEndpoints
{
    public static IEndpointRouteBuilder MapPluginEndpoints(this IEndpointRouteBuilder app)
    {
        var plugin = app.MapGroup("/api/v1/plugin");

        plugin.MapGet("/catalog", async (HttpContext context, AppDbContext db, IOptions<GatewayOptions> gatewayOptions, CancellationToken ct) =>
        {
            var snapshot = await db.CatalogSnapshots.AsNoTracking()
                .Where(x => x.Source == "models.dev" && x.Status == CatalogSnapshotStatus.Active)
                .OrderByDescending(x => x.FetchedAt)
                .FirstOrDefaultAsync(ct);
            var models = await db.PublicModels.AsNoTracking()
                .Where(x => x.Status == PublicModelStatus.Enabled)
                .OrderBy(x => x.Alias)
                .ToListAsync(ct);
            var etag = "\"" + ComputeETag(string.Join("|", models.Select(x => x.Alias + x.UpdatedAt.Ticks))) + "\"";
            context.Response.Headers.ETag = etag;
            if (context.Request.Headers.IfNoneMatch.ToString() == etag)
            {
                return Results.StatusCode(StatusCodes.Status304NotModified);
            }

            return Results.Json(new
            {
                config_version = snapshot?.Id ?? "none",
                gateway_base_url = gatewayOptions.Value.PublicBaseUrl,
                catalog_snapshot_id = snapshot?.Id,
                models = models.Select(x => ModelDto(x, gatewayOptions.Value.PublicBaseUrl)).ToList()
            }, ApiJson.Options);
        });

        plugin.MapPost("/auth/device", async (
            DeviceStartRequest request,
            AppDbContext db,
            IOptions<GatewayOptions> gatewayOptions,
            CancellationToken ct) =>
        {
            var deviceId = !string.IsNullOrWhiteSpace(request.DeviceId) && request.DeviceId.StartsWith("dev_", StringComparison.Ordinal)
                ? request.DeviceId
                : TokenService.CreateDeviceId();
            var code = new DeviceCode
            {
                Code = "dc_" + Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(24)),
                UserCode = TokenService.CreateUserCode(),
                DeviceId = deviceId,
                DeviceName = string.IsNullOrWhiteSpace(request.DeviceName) ? "unknown" : request.DeviceName[..Math.Min(request.DeviceName.Length, 120)],
                Os = request.Os,
                PluginVersion = request.PluginVersion,
                PiVersion = request.PiVersion,
                ExpiresAt = DateTime.UtcNow.AddMinutes(10),
                IntervalSeconds = 2
            };
            db.DeviceCodes.Add(code);
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new
            {
                device_code = code.Code,
                user_code = code.UserCode,
                verification_uri = $"{gatewayOptions.Value.PublicBaseUrl}/device?user_code={Uri.EscapeDataString(code.UserCode)}",
                expires_in = 600,
                interval = 2
            });
        });

        plugin.MapPost("/auth/device/token", async (
            DeviceCodeRequest request,
            AppDbContext db,
            TokenService tokenService,
            IOptions<TokenOptions> tokenOptions,
            CancellationToken ct) =>
        {
            var code = await db.DeviceCodes.FirstOrDefaultAsync(x => x.Code == request.DeviceCode, ct);
            if (code is null)
            {
                return ApiErrors.Json(new { status = "expired", error = "invalid_device_code" }, StatusCodes.Status400BadRequest);
            }
            if (code.Status == DeviceCodeStatus.Pending && code.ExpiresAt < DateTime.UtcNow)
            {
                code.Status = DeviceCodeStatus.Expired;
                await db.SaveChangesAsync(ct);
            }

            switch (code.Status)
            {
                case DeviceCodeStatus.Pending:
                    return ApiErrors.Json(new { status = "pending", interval = code.IntervalSeconds });
                case DeviceCodeStatus.Denied:
                    return ApiErrors.Json(new { status = "denied" }, StatusCodes.Status403Forbidden);
                case DeviceCodeStatus.Expired:
                    return ApiErrors.Json(new { status = "expired" }, StatusCodes.Status400BadRequest);
                case DeviceCodeStatus.Consumed:
                    return ApiErrors.Json(new { status = "expired", error = "device_code_consumed" }, StatusCodes.Status400BadRequest);
            }

            var user = await db.Users.FirstOrDefaultAsync(x => x.Id == code.UserId, ct);
            if (user is null || user.Status != UserStatus.Active)
            {
                return ApiErrors.Json(new { status = "user_disabled" }, StatusCodes.Status403Forbidden);
            }

            var device = await db.Devices.FirstOrDefaultAsync(x => x.Id == code.DeviceId, ct);
            if (device is null)
            {
                device = new Device
                {
                    Id = code.DeviceId,
                    UserId = user.Id,
                    Name = code.DeviceName,
                    Os = code.Os,
                    PluginVersion = code.PluginVersion,
                    PiVersion = code.PiVersion,
                    LastSeenAt = DateTime.UtcNow
                };
                db.Devices.Add(device);
            }
            else
            {
                device.UserId = user.Id;
                device.Status = DeviceStatus.Active;
                device.Name = code.DeviceName;
                device.PluginVersion = code.PluginVersion ?? device.PluginVersion;
                device.LastSeenAt = DateTime.UtcNow;
            }

            var (rawRefresh, refreshHash) = tokenService.CreateRefreshToken();
            db.RefreshTokens.Add(new RefreshToken
            {
                UserId = user.Id,
                DeviceId = device.Id,
                TokenHash = refreshHash,
                ExpiresAt = DateTime.UtcNow.AddDays(tokenOptions.Value.RefreshTokenDays)
            });

            var (access, expires) = tokenService.CreateAccessToken(user, device.Id);
            code.Status = DeviceCodeStatus.Consumed;
            await db.SaveChangesAsync(ct);

            return ApiErrors.Json(new
            {
                status = "approved",
                access_token = access,
                refresh_token = rawRefresh,
                expires_in = (int)(expires - DateTime.UtcNow).TotalSeconds,
                refresh_expires_in = tokenOptions.Value.RefreshTokenDays * 86400,
                user = new { id = user.Id, name = user.Name, role = user.Role.ToString().ToLowerInvariant() },
                device_id = device.Id
            });
        });

        plugin.MapPost("/auth/refresh", async (
            RefreshRequest request,
            AppDbContext db,
            TokenService tokenService,
            IOptions<TokenOptions> tokenOptions,
            CancellationToken ct) =>
        {
            var hash = TokenService.HashRefreshToken(request.RefreshToken);
            var token = await db.RefreshTokens.FirstOrDefaultAsync(x => x.TokenHash == hash, ct);
            if (token is null)
            {
                return ApiErrors.Json(new { error = new { code = "invalid_refresh_token", message = "刷新令牌无效，请重新登录。" } }, StatusCodes.Status401Unauthorized);
            }

            if (token.RevokedAt is not null)
            {
                // Reuse of a rotated token: revoke the whole family.
                var family = await db.RefreshTokens.Where(x => x.FamilyId == token.FamilyId && x.RevokedAt == null).ToListAsync(ct);
                foreach (var item in family)
                {
                    item.RevokedAt = DateTime.UtcNow;
                    item.RevokedReason = "token_reuse_detected";
                }
                await db.SaveChangesAsync(ct);
                return ApiErrors.Json(new { error = new { code = "refresh_token_reused", message = "检测到刷新令牌重复使用，已注销该会话。" } }, StatusCodes.Status401Unauthorized);
            }

            if (token.ExpiresAt < DateTime.UtcNow)
            {
                return ApiErrors.Json(new { error = new { code = "refresh_token_expired", message = "刷新令牌已过期，请重新登录。" } }, StatusCodes.Status401Unauthorized);
            }

            if (!string.IsNullOrWhiteSpace(request.DeviceId) && request.DeviceId != token.DeviceId)
            {
                return ApiErrors.Json(new { error = new { code = "device_mismatch", message = "设备与令牌不匹配。" } }, StatusCodes.Status401Unauthorized);
            }

            var device = await db.Devices.FirstOrDefaultAsync(x => x.Id == token.DeviceId, ct);
            var user = await db.Users.FirstOrDefaultAsync(x => x.Id == token.UserId, ct);
            if (device is null || device.Status != DeviceStatus.Active || user is null || user.Status != UserStatus.Active)
            {
                return ApiErrors.Json(new { error = new { code = "device_revoked", message = "设备或用户已停用，请重新登录。" } }, StatusCodes.Status401Unauthorized);
            }

            var (rawRefresh, newHash) = tokenService.CreateRefreshToken();
            var replacement = new RefreshToken
            {
                UserId = token.UserId,
                DeviceId = token.DeviceId,
                TokenHash = newHash,
                FamilyId = token.FamilyId,
                RotatedFrom = token.Id,
                ExpiresAt = DateTime.UtcNow.AddDays(tokenOptions.Value.RefreshTokenDays)
            };
            db.RefreshTokens.Add(replacement);
            token.RevokedAt = DateTime.UtcNow;
            token.RevokedReason = "rotated";
            device.LastSeenAt = DateTime.UtcNow;

            var (access, expires) = tokenService.CreateAccessToken(user, device.Id);
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new
            {
                status = "approved",
                access_token = access,
                refresh_token = rawRefresh,
                expires_in = (int)(expires - DateTime.UtcNow).TotalSeconds,
                refresh_expires_in = tokenOptions.Value.RefreshTokenDays * 86400,
                user = new { id = user.Id, name = user.Name, role = user.Role.ToString().ToLowerInvariant() },
                device_id = device.Id
            });
        });

        plugin.MapPost("/auth/logout", async (HttpContext context, LogoutRequest request, AppDbContext db, CancellationToken ct) =>
        {
            var userId = context.User.UserId();
            var deviceId = context.User.DeviceId();
            var query = db.RefreshTokens.Where(x => x.UserId == userId && x.RevokedAt == null);
            if (!string.IsNullOrWhiteSpace(request.RefreshToken))
            {
                var hash = TokenService.HashRefreshToken(request.RefreshToken);
                query = query.Where(x => x.TokenHash == hash);
            }
            else if (!string.IsNullOrWhiteSpace(deviceId))
            {
                query = query.Where(x => x.DeviceId == deviceId);
            }
            var tokens = await query.ToListAsync(ct);
            foreach (var token in tokens)
            {
                token.RevokedAt = DateTime.UtcNow;
                token.RevokedReason = "logout";
            }
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        }).RequireAuthorization();

        plugin.MapGet("/bootstrap", async (
            HttpContext context,
            AppDbContext db,
            AccessPolicyService accessPolicy,
            IOptions<GatewayOptions> gatewayOptions,
            CancellationToken ct) =>
        {
            var userId = context.User.UserId();
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId, ct);
            if (user is null || user.Status != UserStatus.Active)
            {
                return ApiErrors.Json(new { error = new { code = "user_disabled", message = "用户已停用。" } }, StatusCodes.Status401Unauthorized);
            }

            var snapshot = await db.CatalogSnapshots.AsNoTracking()
                .Where(x => x.Source == "models.dev" && x.Status == CatalogSnapshotStatus.Active)
                .OrderByDescending(x => x.FetchedAt)
                .FirstOrDefaultAsync(ct);
            var publicModels = await db.PublicModels.AsNoTracking()
                .Where(x => x.Status == PublicModelStatus.Enabled)
                .OrderBy(x => x.Alias)
                .ToListAsync(ct);
            var allowedModels = new List<PublicModel>();
            foreach (var model in publicModels)
            {
                var check = await accessPolicy.CheckModelAccessAsync(userId, null, model.Alias, ct);
                if (check.Allowed)
                {
                    allowedModels.Add(model);
                }
            }

            var projects = await db.ProjectMembers.AsNoTracking()
                .Where(x => x.UserId == userId)
                .Join(db.Projects.Where(p => p.Status == ProjectStatus.Active), m => m.ProjectId, p => p.Id, (m, p) => new { p.Id, p.Key, p.Name })
                .ToListAsync(ct);
            var projectIds = projects.Select(x => x.Id).ToList();
            var repos = await db.ProjectRepos.AsNoTracking()
                .Where(x => projectIds.Contains(x.ProjectId))
                .Join(db.Projects, r => r.ProjectId, p => p.Id, (r, p) => new { r.RepoHash, r.RepoDisplay, p.Key })
                .ToListAsync(ct);
            var approval = await accessPolicy.GetApprovalPolicyAsync(ct);

            return ApiErrors.Json(new
            {
                config_version = snapshot?.Id ?? "none",
                gateway = new { base_url = gatewayOptions.Value.PublicBaseUrl },
                user = new { id = user.Id, name = user.Name, role = user.Role.ToString().ToLowerInvariant() },
                catalog_snapshot_id = snapshot?.Id,
                models = allowedModels.Select(x => ModelDto(x, gatewayOptions.Value.PublicBaseUrl)).ToList(),
                projects = projects.Select(x => new { key = x.Key, name = x.Name }),
                repo_mappings = repos.Select(x => new { repo_hash = x.RepoHash, repo_display = x.RepoDisplay, project_key = x.Key }),
                approval_policy = new
                {
                    version = approval.Version,
                    rules = approval.Rules,
                    no_ui = approval.NoUi
                },
                telemetry = new { enabled = true, batch_size = 100, interval_seconds = 60 },
                clients = new { supported = new[] { "pi", "codex", "claude-code", "copilot-cli" }, minimum_plugin_version = "1.0.0" }
            });
        }).RequireAuthorization();

        plugin.MapPost("/telemetry/batch", async (
            HttpContext context,
            TelemetryBatchInput batch,
            AppDbContext db,
            TelemetryService telemetry,
            RateLimiter rateLimiter,
            CancellationToken ct) =>
        {
            if (context.Request.ContentLength > 256 * 1024)
            {
                return ApiErrors.Json(new { error = new { code = "batch_too_large", message = "单批遥测超过 256 KB。" } }, StatusCodes.Status413PayloadTooLarge);
            }
            if (batch.Events.Count > 100)
            {
                return ApiErrors.Json(new { error = new { code = "batch_too_large", message = "单批事件不能超过 100 条。" } }, StatusCodes.Status400BadRequest);
            }
            if (!rateLimiter.TryAcquire("telemetry:" + batch.DeviceId, 60, out var retryAfter))
            {
                return ApiErrors.Json(new { error = new { code = "rate_limited", message = "遥测上报过于频繁。" } }, StatusCodes.Status429TooManyRequests);
            }

            var userId = context.User.UserId();
            var device = await db.Devices.AsNoTracking().FirstOrDefaultAsync(x => x.Id == batch.DeviceId && x.UserId == userId, ct);
            if (device is null || device.Status != DeviceStatus.Active)
            {
                return ApiErrors.Json(new { error = new { code = "device_revoked", message = "设备未授权或已撤销。" } }, StatusCodes.Status401Unauthorized);
            }

            var result = await telemetry.IngestAsync(userId, batch.DeviceId, batch, ct);
            return ApiErrors.Json(new { accepted = result.Accepted, duplicates = result.Duplicates }, StatusCodes.Status202Accepted);
        }).RequireAuthorization();

        // Browser endpoints used by the device verification page (cookie session + CSRF).
        app.MapPost("/api/v1/plugin/auth/device/approve", async (
            DeviceUserCodeRequest request,
            HttpContext context,
            AppDbContext db,
            CancellationToken ct) =>
        {
            if (context.User.Identity?.IsAuthenticated != true)
            {
                return ApiErrors.Json(new { error = new { code = "unauthenticated", message = "请先登录。" } }, StatusCodes.Status401Unauthorized);
            }
            var userId = context.User.UserId();
            var user = await db.Users.FirstOrDefaultAsync(x => x.Id == userId, ct);
            if (user is null || user.Status != UserStatus.Active)
            {
                return ApiErrors.Json(new { error = new { code = "user_disabled", message = "用户已停用。" } }, StatusCodes.Status403Forbidden);
            }

            var normalized = request.UserCode.Trim().ToUpperInvariant();
            var code = await db.DeviceCodes.FirstOrDefaultAsync(x => x.UserCode == normalized, ct);
            if (code is null)
            {
                return ApiErrors.Json(new { error = new { code = "invalid_user_code", message = "授权码不存在。" } }, StatusCodes.Status404NotFound);
            }
            if (code.ExpiresAt < DateTime.UtcNow && code.Status == DeviceCodeStatus.Pending)
            {
                return ApiErrors.Json(new { error = new { code = "expired", message = "授权码已过期。" } }, StatusCodes.Status400BadRequest);
            }
            if (code.Status is DeviceCodeStatus.Denied or DeviceCodeStatus.Consumed)
            {
                return ApiErrors.Json(new { error = new { code = "invalid_state", message = "授权码已处理。" } }, StatusCodes.Status400BadRequest);
            }

            if (code.Status == DeviceCodeStatus.Pending)
            {
                code.Status = DeviceCodeStatus.Approved;
                code.UserId = userId;
                code.ApprovedAt = DateTime.UtcNow;
                Audit.Add(db, context, "plugin.device.approve", "device_code", code.Id.ToString(), new { code.DeviceId, code.DeviceName, user = user.Name });
                await db.SaveChangesAsync(ct);
            }
            return ApiErrors.Json(new { status = "approved", device_name = code.DeviceName, user = user.Name });
        }).RequireAuthorization(new Microsoft.AspNetCore.Authorization.AuthorizeAttribute { AuthenticationSchemes = "AdminCookie" });

        app.MapPost("/api/v1/plugin/auth/device/deny", async (
            DeviceUserCodeRequest request,
            HttpContext context,
            AppDbContext db,
            CancellationToken ct) =>
        {
            if (context.User.Identity?.IsAuthenticated != true)
            {
                return ApiErrors.Json(new { error = new { code = "unauthenticated", message = "请先登录。" } }, StatusCodes.Status401Unauthorized);
            }
            var normalized = request.UserCode.Trim().ToUpperInvariant();
            var code = await db.DeviceCodes.FirstOrDefaultAsync(x => x.UserCode == normalized, ct);
            if (code is null || code.Status != DeviceCodeStatus.Pending)
            {
                return ApiErrors.Json(new { error = new { code = "invalid_state", message = "授权码不存在或已处理。" } }, StatusCodes.Status400BadRequest);
            }
            code.Status = DeviceCodeStatus.Denied;
            code.UserId = context.User.UserId();
            Audit.Add(db, context, "plugin.device.deny", "device_code", code.Id.ToString(), new { code.DeviceId });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new { status = "denied" });
        }).RequireAuthorization(new Microsoft.AspNetCore.Authorization.AuthorizeAttribute { AuthenticationSchemes = "AdminCookie" });

        plugin.MapGet("/device/pending", async (string user_code, AppDbContext db, CancellationToken ct) =>
        {
            var code = await db.DeviceCodes.AsNoTracking().FirstOrDefaultAsync(x => x.UserCode == user_code.ToUpperInvariant(), ct);
            if (code is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "授权码不存在。" } }, StatusCodes.Status404NotFound);
            }
            return ApiErrors.Json(new
            {
                user_code = code.UserCode,
                device_name = code.DeviceName,
                os = code.Os,
                plugin_version = code.PluginVersion,
                status = code.Status.ToString().ToLowerInvariant(),
                expires_at = code.ExpiresAt
            });
        });

        return app;
    }

    public static object ModelDto(PublicModel model, string gatewayBaseUrl)
    {
        var api = model.Protocol.ToWire();
        var baseUrl = model.Protocol switch
        {
            ApiProtocol.AnthropicMessages => gatewayBaseUrl.TrimEnd('/') + "/gw/anthropic",
            ApiProtocol.GoogleGenerativeAi => gatewayBaseUrl.TrimEnd('/') + "/gw/google/v1beta",
            _ => gatewayBaseUrl.TrimEnd('/') + "/gw/openai/v1"
        };
        JsonElement? thinkingMap = null;
        try
        {
            if (!string.IsNullOrWhiteSpace(model.ThinkingLevelMapJson))
            {
                using var doc = JsonDocument.Parse(model.ThinkingLevelMapJson);
                thinkingMap = doc.RootElement.Clone();
            }
        }
        catch (JsonException)
        {
        }
        JsonElement? reasoningOptions = null;
        try
        {
            if (!string.IsNullOrWhiteSpace(model.ReasoningOptionsJson))
            {
                using var doc = JsonDocument.Parse(model.ReasoningOptionsJson);
                reasoningOptions = doc.RootElement.Clone();
            }
        }
        catch (JsonException)
        {
        }

        var input = new List<string> { "text" };
        try
        {
            using var doc = JsonDocument.Parse(model.CapabilitiesJson ?? "{}");
            if (doc.RootElement.TryGetProperty("input", out var inputs) && inputs.ValueKind == JsonValueKind.Array)
            {
                input = inputs.EnumerateArray().Select(x => x.GetString()).Where(x => x is not null).Cast<string>().ToList();
            }
        }
        catch (JsonException)
        {
        }

        return new
        {
            id = model.Alias,
            display_name = model.DisplayName,
            api,
            base_url = baseUrl,
            reasoning = model.Reasoning,
            thinking_level_map = thinkingMap,
            reasoning_options = reasoningOptions,
            input,
            context_window = model.ContextWindow,
            max_tokens = model.MaxTokens,
            cost = new { input = 0, output = 0, cache_read = 0, cache_write = 0 },
            catalog_snapshot_id = model.CatalogSnapshotId
        };
    }

    private static string ComputeETag(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(hash)[..16];
    }
}