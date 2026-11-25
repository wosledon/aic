using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AIControl.Domain;
using AIControl.Infrastructure;
using AIControl.Infrastructure.Security;
using AIControl.Server.Api;
using AIControl.Server.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace AIControl.Server.Endpoints;

public sealed record DevLoginRequest(string? Email);

public static class AuthEndpoints
{
    public const string CsrfCookieName = "aic_csrf";
    public static readonly string[] PluginAuthHeaders = ["Authorization", "x-api-key", "x-goog-api-key"];

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/auth");

        group.MapGet("/config", async (AppDbContext db, IOptions<AuthOptions> authOptions, CancellationToken ct) =>
        {
            var feishu = await db.FeishuAppConfigs.AsNoTracking().FirstOrDefaultAsync(ct);
            return ApiErrors.Json(new
            {
                feishu_enabled = feishu?.Enabled == true,
                feishu_configured = feishu is not null && !string.IsNullOrWhiteSpace(feishu.AppId) && !string.IsNullOrWhiteSpace(feishu.AppSecretCipher),
                console_sso_enabled = feishu?.ConsoleSsoEnabled != false,
                device_flow_enabled = feishu?.DeviceFlowEnabled != false,
                dev_login_enabled = authOptions.Value.DevLoginEnabled,
                default_role = feishu?.DefaultRole.ToString().ToLowerInvariant() ?? "user"
            });
        });

        group.MapGet("/csrf", (HttpContext context) =>
        {
            var token = IssueCsrfCookie(context);
            return ApiErrors.Json(new { csrf_token = token });
        });

        group.MapPost("/dev-login", async (
            DevLoginRequest request,
            HttpContext context,
            AppDbContext db,
            IOptions<AuthOptions> authOptions,
            IOptions<GatewayOptions> gatewayOptions,
            CancellationToken ct) =>
        {
            if (!authOptions.Value.DevLoginEnabled)
            {
                return ApiErrors.Json(new { error = new { code = "dev_login_disabled", message = "开发登录已关闭。" } }, StatusCodes.Status403Forbidden);
            }

            var email = string.IsNullOrWhiteSpace(request.Email) ? "admin@aic.local" : request.Email.Trim();
            var user = await db.Users.FirstOrDefaultAsync(x => x.Email == email || x.UnionId == email, ct);
            if (user is null || user.Status != UserStatus.Active)
            {
                return ApiErrors.Json(new { error = new { code = "user_not_found", message = "用户不存在或已停用。" } }, StatusCodes.Status404NotFound);
            }

            user.LastLoginAt = DateTime.UtcNow;
            Audit.Add(db, context, "auth.login", "user", user.Id.ToString(), new { method = "dev" });
            await db.SaveChangesAsync(ct);
            await SignInAsync(context, user, 8);
            var csrf = IssueCsrfCookie(context);
            return ApiErrors.Json(new { user = ToUserDto(user), csrf_token = csrf, redirect = gatewayOptions.Value.PublicBaseUrl });
        });

        group.MapGet("/feishu/start", async (
            string? return_url,
            HttpContext context,
            AppDbContext db,
            IMemoryCache cache,
            IOptions<GatewayOptions> gatewayOptions,
            IOptions<AuthOptions> authOptions,
            CancellationToken ct) =>
        {
            var config = await db.FeishuAppConfigs.AsNoTracking().FirstOrDefaultAsync(ct);
            if (config is null || !config.Enabled || string.IsNullOrWhiteSpace(config.AppId) || string.IsNullOrWhiteSpace(config.AppSecretCipher))
            {
                if (authOptions.Value.DevLoginEnabled)
                {
                    return Results.Redirect(gatewayOptions.Value.PublicBaseUrl + "/login?error=feishu_not_configured");
                }
                return ApiErrors.Json(new { error = new { code = "feishu_not_configured", message = "飞书登录尚未配置。" } }, StatusCodes.Status400BadRequest);
            }

            var state = Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(24));
            cache.Set("feishu_state:" + state, string.IsNullOrWhiteSpace(return_url) || !return_url.StartsWith('/') ? "/" : return_url,
                TimeSpan.FromMinutes(10));
            var scopeQuery = string.IsNullOrWhiteSpace(config.Scopes) ? string.Empty : "&scope=" + Uri.EscapeDataString(config.Scopes);
            var redirect = "https://accounts.feishu.cn/open-apis/authen/v1/authorize?app_id=" + Uri.EscapeDataString(config.AppId)
                + "&redirect_uri=" + Uri.EscapeDataString(config.RedirectUri)
                + "&state=" + Uri.EscapeDataString(state)
                + "&response_type=code" + scopeQuery;
            return Results.Redirect(redirect);
        });

        group.MapGet("/feishu/callback", async (
            string? code,
            string? state,
            string? error,
            HttpContext context,
            AppDbContext db,
            IMemoryCache cache,
            IHttpClientFactory httpClientFactory,
            IOptions<GatewayOptions> gatewayOptions,
            IOptions<AuthOptions> authOptions,
            SecretProtector protector,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var logger = loggerFactory.CreateLogger("FeishuAuth");
            var baseUrl = gatewayOptions.Value.PublicBaseUrl;
            if (!string.IsNullOrEmpty(error))
            {
                return Results.Redirect(baseUrl + "/login?error=feishu_denied");
            }

            var stateKey = "feishu_state:" + state;
            if (string.IsNullOrWhiteSpace(state) || !cache.TryGetValue<string>(stateKey, out var returnUrl))
            {
                return Results.Redirect(baseUrl + "/login?error=state_expired");
            }
            cache.Remove(stateKey);

            if (string.IsNullOrWhiteSpace(code))
            {
                return Results.Redirect(baseUrl + "/login?error=feishu_error");
            }

            var config = await db.FeishuAppConfigs.AsNoTracking().FirstOrDefaultAsync(ct);
            if (config is null)
            {
                return Results.Redirect(baseUrl + "/login?error=feishu_not_configured");
            }

            try
            {
                var client = httpClientFactory.CreateClient("feishu");
                using var tokenResponse = await client.PostAsJsonAsync("https://open.feishu.cn/open-apis/authen/v2/oauth/token", new
                {
                    grant_type = "authorization_code",
                    client_id = config.AppId,
                    client_secret = protector.Unprotect(config.AppSecretCipher),
                    code,
                    redirect_uri = config.RedirectUri
                }, ct);
                var tokenJson = await tokenResponse.Content.ReadAsStringAsync(ct);
                using var tokenDoc = JsonDocument.Parse(tokenJson);
                var accessToken = FeishuOAuthPayloads.GetAccessToken(tokenDoc.RootElement);
                if (string.IsNullOrEmpty(accessToken))
                {
                    var parseError = FeishuOAuthPayloads.ParseTokenError(tokenDoc.RootElement);
                    logger.LogWarning("Feishu token exchange failed: error={Error} description={Description} body={Body}",
                        parseError.Code ?? "(none)", parseError.Description ?? "(none)", Redact(tokenJson));
                    var errorKey = string.IsNullOrWhiteSpace(parseError.Code) || parseError.Code == "0"
                        ? "feishu_error"
                        : "feishu_error_" + parseError.Code;
                    return Results.Redirect(baseUrl + "/login?error=" + Uri.EscapeDataString(errorKey));
                }

                var grantedScope = FeishuOAuthPayloads.GetGrantedScope(tokenDoc.RootElement);
                logger.LogInformation("Feishu token exchange succeeded. granted_scope={Scope}", grantedScope ?? "(none)");

                using var request = new HttpRequestMessage(HttpMethod.Get, "https://open.feishu.cn/open-apis/authen/v1/user_info");
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
                using var userResponse = await client.SendAsync(request, ct);
                var userJson = await userResponse.Content.ReadAsStringAsync(ct);
                using var userDoc = JsonDocument.Parse(userJson);
                var profile = FeishuOAuthPayloads.ParseUserProfile(userDoc.RootElement);
                if (profile is null)
                {
                    logger.LogWarning("Feishu user_info missing open_id");
                    return Results.Redirect(baseUrl + "/login?error=feishu_error");
                }
                if (profile.Email is null)
                {
                    logger.LogInformation("Feishu user_info returned no email; identity={OpenId}. Granted scope={Scope}",
                        profile.OpenId, grantedScope ?? "(none)");
                }

                var user = await db.Users.FirstOrDefaultAsync(
                    x => x.FeishuOpenId == profile.OpenId || (profile.UnionId != null && x.UnionId == profile.UnionId), ct);
                if (user is null)
                {
                    if (!config.AutoProvision)
                    {
                        return Results.Redirect(baseUrl + "/login?error=user_not_provisioned");
                    }
                    var isBootstrapAdmin = profile.UnionId is not null && profile.UnionId == authOptions.Value.BootstrapAdminUnionId;
                    user = new User
                    {
                        FeishuOpenId = profile.OpenId,
                        UnionId = profile.UnionId,
                        FeishuUserId = profile.UserId,
                        Name = profile.Name,
                        Email = profile.Email,
                        AvatarUrl = profile.AvatarUrl,
                        Role = isBootstrapAdmin ? UserRole.Admin : config.DefaultRole,
                        Status = UserStatus.Active
                    };
                    db.Users.Add(user);
                }
                else
                {
                    if (user.Status != UserStatus.Active)
                    {
                        return Results.Redirect(baseUrl + "/login?error=user_disabled");
                    }
                    user.Name = profile.Name;
                    user.Email = profile.Email ?? user.Email;
                    user.AvatarUrl = profile.AvatarUrl ?? user.AvatarUrl;
                    user.UnionId = profile.UnionId ?? user.UnionId;
                    user.FeishuUserId = profile.UserId ?? user.FeishuUserId;
                }

                user.LastLoginAt = DateTime.UtcNow;
                Audit.Add(db, context, "auth.login", "user", user.Id.ToString(), new { method = "feishu" }, user.Id, user.Name);
                await db.SaveChangesAsync(ct);
                await SignInAsync(context, user, config.SessionHours);
                IssueCsrfCookie(context);
                return Results.Redirect(baseUrl + (string.IsNullOrWhiteSpace(returnUrl) ? "/" : returnUrl));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Feishu login failed");
                return Results.Redirect(baseUrl + "/login?error=feishu_error");
            }
        });

        group.MapGet("/me", async (HttpContext context, AppDbContext db, CancellationToken ct) =>
        {
            if (context.User.Identity?.IsAuthenticated != true)
            {
                return ApiErrors.Json(new { error = new { code = "unauthenticated", message = "未登录。" } }, StatusCodes.Status401Unauthorized);
            }

            var userId = context.User.UserId();
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId, ct);
            if (user is null || user.Status != UserStatus.Active)
            {
                return ApiErrors.Json(new { error = new { code = "user_disabled", message = "用户已停用。" } }, StatusCodes.Status401Unauthorized);
            }
            return ApiErrors.Json(new { user = ToUserDto(user), is_admin = user.Role == UserRole.Admin });
        }).RequireAuthorization();

        group.MapPost("/logout", async (HttpContext context, AppDbContext db, CancellationToken ct) =>
        {
            if (context.User.Identity?.IsAuthenticated == true)
            {
                Audit.Add(db, context, "auth.logout", "user", context.User.UserId().ToString());
                await db.SaveChangesAsync(ct);
            }
            await context.SignOutAsync("AdminCookie");
            context.Response.Cookies.Delete(CsrfCookieName);
            return Results.NoContent();
        });

        return app;
    }

    public static async Task SignInAsync(HttpContext context, User user, int sessionHours)
    {
        var claims = new List<Claim>
        {
            new("sub", user.Id.ToString()),
            new("name", user.Name),
            new("role", user.Role == UserRole.Admin ? "admin" : "user"),
            new(ClaimTypes.Role, user.Role == UserRole.Admin ? "admin" : "user"),
            new("email", user.Email ?? string.Empty),
            new("auth_method", "cookie")
        };
        var identity = new ClaimsIdentity(claims, "AdminCookie");
        await context.SignInAsync("AdminCookie", new ClaimsPrincipal(identity), new AuthenticationProperties
        {
            IsPersistent = true,
            ExpiresUtc = DateTimeOffset.UtcNow.AddHours(Math.Clamp(sessionHours, 1, 24 * 7))
        });
    }

    public static string IssueCsrfCookie(HttpContext context)
    {
        var token = Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(24));
        context.Response.Cookies.Append(CsrfCookieName, token, new CookieOptions
        {
            HttpOnly = false,
            Secure = context.Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddDays(7)
        });
        return token;
    }

    private static object ToUserDto(User user) => new
    {
        id = user.Id,
        name = user.Name,
        email = user.Email,
        avatar_url = user.AvatarUrl,
        role = user.Role.ToString().ToLowerInvariant(),
        status = user.Status.ToString().ToLowerInvariant(),
        last_login_at = user.LastLoginAt
    };

    private static string Redact(string value)
    {
        if (value.Length <= 200) return value;
        return value[..200] + "...";
    }
}