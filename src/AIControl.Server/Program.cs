using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using AIControl.Infrastructure;
using AIControl.Infrastructure.Analytics;
using AIControl.Infrastructure.Catalog;
using AIControl.Infrastructure.Policy;
using AIControl.Infrastructure.Security;
using AIControl.Infrastructure.Seed;
using AIControl.Infrastructure.Telemetry;
using AIControl.Server.Api;
using AIControl.Server.Endpoints;
using AIControl.Server.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Map PRD-style environment variables into configuration keys.
static string? Env(string name) => Environment.GetEnvironmentVariable(name);
var envOverrides = new Dictionary<string, string?>();
if (Env("AIC_PUBLIC_BASE_URL") is { Length: > 0 } publicBaseUrl) envOverrides["AIC:PublicBaseUrl"] = publicBaseUrl;
if (Env("AIC_GATEWAY_BASE_URL") is { Length: > 0 } gatewayBaseUrl && Env("AIC_PUBLIC_BASE_URL") is null) envOverrides["AIC:PublicBaseUrl"] = gatewayBaseUrl;
if (Env("AIC_DB_CONNECTION") is { Length: > 0 } dbConnection)
{
    envOverrides["ConnectionStrings:Default"] = dbConnection.StartsWith("Data Source", StringComparison.OrdinalIgnoreCase)
        ? dbConnection
        : "Data Source=" + dbConnection;
}
if (Env("AIC_BOOTSTRAP_ADMIN_UNION_IDS") is { Length: > 0 } adminIds) envOverrides["AIC:Seeder:BootstrapAdminUnionId"] = adminIds.Split(',')[0].Trim();
if (Env("AIC_DEV_LOGIN_ENABLED") is { Length: > 0 } devLogin) envOverrides["AIC:DevLoginEnabled"] = devLogin;
if (Env("AIC_ENCRYPTION_KEY") is { Length: > 0 } encryptionKey) envOverrides["AIC:Encryption:Key"] = encryptionKey;
if (Env("AIC_TOKEN_SIGNING_KEY") is { Length: > 0 } signingKey) envOverrides["AIC:Token:SigningKey"] = signingKey;
if (Env("AIC_SEED_DEMO") is { Length: > 0 } seedDemo) envOverrides["AIC:Seeder:SeedDemoData"] = seedDemo;
if (Env("MODELS_DEV_API_URL") is { Length: > 0 } modelsDevUrl) envOverrides["AIC:ModelsDev:ModelsDevApiUrl"] = modelsDevUrl;
if (Env("AIC_LOG_LEVEL") is { Length: > 0 } logLevel) envOverrides["Logging:LogLevel:Default"] = logLevel;
builder.Configuration.AddInMemoryCollection(envOverrides);

// 生产环境必须显式提供独立密钥，避免把演示默认值带上线。
if (!builder.Environment.IsDevelopment())
{
    var configuredEncryptionKey = builder.Configuration.GetValue<string>("AIC:Encryption:Key");
    if (string.IsNullOrWhiteSpace(configuredEncryptionKey)
        || configuredEncryptionKey.Contains("change-me", StringComparison.OrdinalIgnoreCase))
    {
        throw new InvalidOperationException(
            "生产环境必须通过环境变量 AIC_ENCRYPTION_KEY 配置独立的加密密钥，不能使用演示默认值。");
    }

    var configuredSigningKey = builder.Configuration.GetValue<string>("AIC:Token:SigningKey");
    if (string.IsNullOrWhiteSpace(configuredSigningKey)
        || configuredSigningKey.Contains("please-change", StringComparison.OrdinalIgnoreCase))
    {
        throw new InvalidOperationException(
            "生产环境必须通过环境变量 AIC_TOKEN_SIGNING_KEY 配置独立的 JWT 签名密钥，不能使用演示默认值。");
    }
}

builder.Services.Configure<GatewayOptions>(builder.Configuration.GetSection("AIC"));
builder.Services.Configure<EncryptionOptions>(builder.Configuration.GetSection("AIC:Encryption"));
builder.Services.Configure<TokenOptions>(builder.Configuration.GetSection("AIC:Token"));
builder.Services.Configure<CatalogOptions>(builder.Configuration.GetSection("AIC:ModelsDev"));
builder.Services.Configure<AuthOptions>(options =>
{
    options.DevLoginEnabled = builder.Configuration.GetValue("AIC:DevLoginEnabled", false);
    options.BootstrapAdminUnionId = builder.Configuration.GetValue("AIC:Seeder:BootstrapAdminUnionId", "dev-admin") ?? "dev-admin";
});

var gatewayOptions = builder.Configuration.GetSection("AIC").Get<GatewayOptions>() ?? new GatewayOptions();
var seederOptions = builder.Configuration.GetSection("AIC:Seeder").Get<SeederOptions>() ?? new SeederOptions();
seederOptions.PublicBaseUrl = gatewayOptions.PublicBaseUrl;
seederOptions.BootstrapAdminUnionId = builder.Configuration.GetValue("AIC:Seeder:BootstrapAdminUnionId", seederOptions.BootstrapAdminUnionId) ?? seederOptions.BootstrapAdminUnionId;
var fixturePath = seederOptions.ModelsDevFixturePath;
if (!string.IsNullOrWhiteSpace(fixturePath) && !Path.IsPathRooted(fixturePath))
{
    fixturePath = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, fixturePath));
}
seederOptions.ModelsDevFixturePath = fixturePath;
builder.Services.AddSingleton(seederOptions);

var connectionString = builder.Configuration.GetConnectionString("Default") ?? "Data Source=aicontrol.db";
builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlite(connectionString));

builder.Services.AddHttpClient("upstream", client => client.Timeout = Timeout.InfiniteTimeSpan)
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate | System.Net.DecompressionMethods.Brotli,
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        ConnectTimeout = TimeSpan.FromSeconds(15)
    });
builder.Services.AddHttpClient("feishu", client => client.Timeout = TimeSpan.FromSeconds(20));
builder.Services.AddHttpClient<ModelsDevService>(client => client.Timeout = TimeSpan.FromSeconds(35));

builder.Services.AddSingleton<SecretProtector>();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddScoped<CatalogImportService>();
builder.Services.AddScoped<AnalyticsService>();
builder.Services.AddScoped<AccessPolicyService>();
builder.Services.AddScoped<TelemetryService>();
builder.Services.AddScoped<GatewayProxyService>();
builder.Services.AddScoped<ChannelTestService>();
builder.Services.AddScoped<DbSeeder>();
builder.Services.AddSingleton<UsageEventQueue>();
builder.Services.AddSingleton<RateLimiter>();
builder.Services.AddSingleton<ChannelCircuitBreaker>();
builder.Services.AddSingleton<UsageWriterService>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<UsageWriterService>());
builder.Services.AddHostedService<CatalogSyncWorker>();
builder.Services.AddMemoryCache();

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    options.SerializerOptions.DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower;
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
});

builder.Services.AddCors(options => options.AddPolicy("spa", policy => policy
    .WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var tokenSection = builder.Configuration.GetSection("AIC:Token");
var jwtIssuer = tokenSection.GetValue("Issuer", "aicontrol") ?? "aicontrol";
var jwtAudience = tokenSection.GetValue("Audience", "aicontrol") ?? "aicontrol";
var jwtSigningKey = tokenSection.GetValue("SigningKey", "aicontrol-demo-signing-key-please-change-0123456789") ?? "aicontrol-demo-signing-key-please-change-0123456789";

builder.Services.AddAuthentication(options =>
    {
        options.DefaultScheme = "Smart";
        options.DefaultChallengeScheme = "Smart";
        options.DefaultAuthenticateScheme = "Smart";
    })
    .AddPolicyScheme("Smart", "Smart", options =>
    {
        options.ForwardDefaultSelector = context =>
            HasPluginToken(context.Request) ? JwtBearerDefaults.AuthenticationScheme : "AdminCookie";
    })
    .AddCookie("AdminCookie", options =>
    {
        options.Cookie.Name = "aic_admin";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
        options.Events.OnRedirectToLogin = async context =>
        {
            if (context.Request.Path.StartsWithSegments("/api") || context.Request.Path.StartsWithSegments("/gw"))
            {
                await ApiErrors.WriteAsync(context.HttpContext, StatusCodes.Status401Unauthorized, "unauthenticated", "请先登录。");
            }
            else
            {
                context.Response.Redirect("/login");
            }
        };
        options.Events.OnRedirectToAccessDenied = async context =>
        {
            await ApiErrors.WriteAsync(context.HttpContext, StatusCodes.Status403Forbidden, "forbidden", "没有访问权限。");
        };
    })
    .AddJwtBearer(JwtBearerDefaults.AuthenticationScheme, options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSigningKey)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            NameClaimType = "name",
            RoleClaimType = "role"
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                if (string.IsNullOrEmpty(context.Token))
                {
                    var authorization = context.Request.Headers.Authorization.ToString();
                    if (authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                    {
                        context.Token = authorization[7..].Trim();
                    }
                }
                if (string.IsNullOrEmpty(context.Token))
                {
                    context.Token = context.Request.Headers["x-api-key"].FirstOrDefault()
                        ?? context.Request.Headers["x-goog-api-key"].FirstOrDefault();
                }
                return Task.CompletedTask;
            },
            OnTokenValidated = async context =>
            {
                var principal = context.Principal;
                var userId = principal?.UserId() ?? Guid.Empty;
                var deviceId = principal?.DeviceId();
                if (userId == Guid.Empty || string.IsNullOrWhiteSpace(deviceId))
                {
                    context.Fail("invalid_token");
                    context.HttpContext.Items["aic_auth_error"] = "invalid_token";
                    return;
                }

                var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                var cancellationToken = context.HttpContext.RequestAborted;
                var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId, cancellationToken);
                if (user is null || user.Status != AIControl.Domain.UserStatus.Active)
                {
                    context.Fail("user_disabled");
                    context.HttpContext.Items["aic_auth_error"] = "user_disabled";
                    return;
                }
                var device = await db.Devices.FirstOrDefaultAsync(x => x.Id == deviceId, cancellationToken);
                if (device is null || device.Status != AIControl.Domain.DeviceStatus.Active || device.UserId != userId)
                {
                    context.Fail("device_revoked");
                    context.HttpContext.Items["aic_auth_error"] = "device_revoked";
                    return;
                }
                if (DateTime.UtcNow - device.LastSeenAt > TimeSpan.FromMinutes(5))
                {
                    device.LastSeenAt = DateTime.UtcNow;
                    await db.SaveChangesAsync(cancellationToken);
                }
            },
            OnChallenge = async context =>
            {
                context.HandleResponse();
                var code = context.HttpContext.Items["aic_auth_error"] as string
                    ?? (context.AuthenticateFailure is SecurityTokenExpiredException ? "token_expired" : "invalid_token");
                var authorization = context.HttpContext.Request.Headers.Authorization.ToString();
                context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("GatewayAuth")
                    .LogWarning(
                        "Gateway auth challenge: code={Code} path={Path} has_bearer={HasBearer} auth_length={Length} has_api_key={HasApiKey} has_goog_key={HasGoogleKey}",
                        code,
                        context.HttpContext.Request.Path.Value,
                        authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase),
                        authorization.Length,
                        context.HttpContext.Request.Headers.ContainsKey("x-api-key"),
                        context.HttpContext.Request.Headers.ContainsKey("x-goog-api-key"));
                var message = code switch
                {
                    "user_disabled" => "用户已停用，请联系管理员。",
                    "device_revoked" => "设备已被撤销，请重新登录。",
                    "token_expired" => "网关令牌已过期。",
                    _ => "网关令牌无效。"
                };
                await ApiErrors.WriteAsync(context.HttpContext, StatusCodes.Status401Unauthorized, code, message);
            },
            OnForbidden = async context =>
            {
                await ApiErrors.WriteAsync(context.HttpContext, StatusCodes.Status403Forbidden, "forbidden", "没有访问权限。");
            }
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("Admin", policy => policy.RequireRole("admin"));
    options.AddPolicy("Gateway", policy => policy.RequireAuthenticatedUser());
});

var app = builder.Build();

app.Use(async (context, next) =>
{
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers.XFrameOptions = "DENY";
    context.Response.Headers["Referrer-Policy"] = "same-origin";
    await next();
});

app.UseCors("spa");
app.UseAuthentication();
app.UseAuthorization();

// CSRF double-submit guard for cookie-authenticated browser mutations.
app.Use(async (context, next) =>
{
    if (RequiresCsrf(context))
    {
        var cookie = context.Request.Cookies[AuthEndpoints.CsrfCookieName];
        var header = context.Request.Headers["X-CSRF-Token"].FirstOrDefault();
        if (string.IsNullOrEmpty(cookie) || header != cookie)
        {
            await ApiErrors.WriteAsync(context, StatusCodes.Status403Forbidden, "csrf_failed", "CSRF 校验失败，请刷新页面重试。");
            return;
        }
    }
    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/healthz", () => Results.Json(new { status = "ok", time = DateTime.UtcNow }, ApiJson.Options));
app.MapAuthEndpoints();
app.MapPluginEndpoints();
app.MapMeEndpoints();
app.MapGatewayEndpoints();
app.MapAdminEndpoints();
app.MapAnalyticsEndpoints();
app.MapMockUpstream();

app.MapFallback(async context =>
{
    if (context.Request.Path.StartsWithSegments("/api")
        || context.Request.Path.StartsWithSegments("/gw")
        || context.Request.Path.StartsWithSegments("/mock"))
    {
        await ApiErrors.WriteAsync(context, StatusCodes.Status404NotFound, "not_found", "接口不存在。");
        return;
    }

    var indexPath = Path.Combine(app.Environment.ContentRootPath, "wwwroot", "index.html");
    if (!File.Exists(indexPath))
    {
        context.Response.ContentType = "text/plain; charset=utf-8";
        await context.Response.WriteAsync("AIControl API is running. Build the admin SPA into src/AIControl.Server/wwwroot (npm run build) or use the Vite dev server.");
        return;
    }
    context.Response.ContentType = "text/html; charset=utf-8";
    await context.Response.SendFileAsync(indexPath);
});

using (var scope = app.Services.CreateScope())
{
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
    try
    {
        var seeder = scope.ServiceProvider.GetRequiredService<DbSeeder>();
        await seeder.SeedAsync(CancellationToken.None);
        logger.LogInformation("Database ready at {ConnectionString}", connectionString);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Database initialization failed");
        throw;
    }
}

app.Run();

static bool HasPluginToken(HttpRequest request)
{
    if (request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
    {
        return true;
    }
    return request.Headers.ContainsKey("x-api-key") || request.Headers.ContainsKey("x-goog-api-key");
}

static bool RequiresCsrf(HttpContext context)
{
    if (!HttpMethods.IsPost(context.Request.Method)
        && !HttpMethods.IsPut(context.Request.Method)
        && !HttpMethods.IsPatch(context.Request.Method)
        && !HttpMethods.IsDelete(context.Request.Method))
    {
        return false;
    }
    if (HasPluginToken(context.Request))
    {
        return false;
    }

    var path = context.Request.Path.Value ?? string.Empty;
    if (path.Equals("/api/v1/auth/dev-login", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/v1/auth/feishu/callback", StringComparison.OrdinalIgnoreCase))
    {
        return false;
    }

    return path.StartsWith("/api/v1/admin", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/api/v1/me", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/v1/auth/logout", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/api/v1/plugin/auth/device/approve", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/api/v1/plugin/auth/device/deny", StringComparison.OrdinalIgnoreCase);
}

public partial class Program;