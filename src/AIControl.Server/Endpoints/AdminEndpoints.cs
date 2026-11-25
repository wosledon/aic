using System.Text.Json;
using System.Text.RegularExpressions;
using AIControl.Domain;
using AIControl.Infrastructure;
using AIControl.Infrastructure.Catalog;
using AIControl.Infrastructure.Security;
using AIControl.Infrastructure.Utils;
using AIControl.Server.Api;
using AIControl.Server.Services;
using Microsoft.EntityFrameworkCore;

namespace AIControl.Server.Endpoints;

public sealed record FeishuSettingsRequest(
    bool Enabled,
    string AppId,
    string? AppSecret,
    string RedirectUri,
    string Scopes,
    string DefaultRole,
    bool AutoProvision,
    bool ConsoleSsoEnabled,
    bool DeviceFlowEnabled,
    int SessionHours);

public sealed record ChannelUpsertRequest(
    string Name,
    string? ProviderKey,
    Guid? ProviderTemplateId,
    string Protocol,
    string BaseUrl,
    string? ApiKey,
    string? HeadersJson,
    string? Status,
    int? MaxConcurrency);

public sealed record RotateSecretRequest(string ApiKey);
public sealed record PublicModelUpdateRequest(string? DisplayName, string? Status, long? ContextWindow, long? MaxTokens);
public sealed record ChannelModelRequest(string UpstreamModel);
public sealed record UserPatchRequest(string? Role, string? Status);
public sealed record ProjectUpsertRequest(string? Key, string Name, string? Description, string? Status);
public sealed record ProjectMemberRequest(Guid UserId);
public sealed record ProjectRepoRequest(string RepoUrl);
public sealed record QuotaUpsertRequest(string ScopeType, string? ScopeId, string Period, long TokenLimit, long RequestLimit, string Action, bool Enabled);
public sealed record PolicyUpdateRequest(string ConfigJson, bool Enabled);
public sealed record ImportRequestDto(
    string ProviderKey,
    List<string> ModelKeys,
    Guid? ChannelId,
    string? ChannelName,
    string? BaseUrl,
    string? ApiKey,
    string? Protocol,
    string? HeadersJson,
    string? AliasPrefix,
    bool Publish);

public static class AdminEndpoints
{
    public static IEndpointRouteBuilder MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/v1/admin").RequireAuthorization("Admin");

        // ---------- Feishu settings ----------
        admin.MapGet("/settings/feishu", async (AppDbContext db, SecretProtector protector, CancellationToken ct) =>
        {
            var config = await db.FeishuAppConfigs.AsNoTracking().FirstOrDefaultAsync(ct);
            return ApiErrors.Json(new
            {
                enabled = config?.Enabled ?? false,
                app_id = config?.AppId ?? string.Empty,
                app_secret_masked = config is null ? string.Empty : MaskRawSecret(protector.Unprotect(config.AppSecretCipher)),
                redirect_uri = config?.RedirectUri ?? string.Empty,
                scopes = config?.Scopes ?? "",
                default_role = config?.DefaultRole.ToString().ToLowerInvariant() ?? "user",
                auto_provision = config?.AutoProvision ?? true,
                console_sso_enabled = config?.ConsoleSsoEnabled ?? true,
                device_flow_enabled = config?.DeviceFlowEnabled ?? true,
                session_hours = config?.SessionHours ?? 8,
                configured = config is not null && !string.IsNullOrWhiteSpace(config.AppId) && !string.IsNullOrWhiteSpace(config.AppSecretCipher)
            });
        });

        admin.MapPut("/settings/feishu", async (
            FeishuSettingsRequest request,
            HttpContext context,
            AppDbContext db,
            SecretProtector protector,
            CancellationToken ct) =>
        {
            if (request.Enabled && (string.IsNullOrWhiteSpace(request.AppId) || string.IsNullOrWhiteSpace(request.RedirectUri)))
            {
                return ApiErrors.Json(new { error = new { code = "validation_error", message = "启用飞书登录时必须填写 App ID 和回调地址。" } }, StatusCodes.Status400BadRequest);
            }
            if (!string.IsNullOrWhiteSpace(request.RedirectUri) && !Uri.TryCreate(request.RedirectUri, UriKind.Absolute, out _))
            {
                return ApiErrors.Json(new { error = new { code = "validation_error", message = "回调地址必须是绝对 URL。" } }, StatusCodes.Status400BadRequest);
            }

            var config = await db.FeishuAppConfigs.FirstOrDefaultAsync(ct);
            if (config is null)
            {
                config = new FeishuAppConfig();
                db.FeishuAppConfigs.Add(config);
            }
            config.Enabled = request.Enabled;
            config.AppId = request.AppId.Trim();
            if (!string.IsNullOrWhiteSpace(request.AppSecret) && !request.AppSecret.Contains("****"))
            {
                config.AppSecretCipher = protector.Protect(request.AppSecret.Trim());
            }
            config.RedirectUri = request.RedirectUri.Trim();
            config.Scopes = request.Scopes;
            config.DefaultRole = ParseEnum(request.DefaultRole, UserRole.User);
            config.AutoProvision = request.AutoProvision;
            config.ConsoleSsoEnabled = request.ConsoleSsoEnabled;
            config.DeviceFlowEnabled = request.DeviceFlowEnabled;
            config.SessionHours = Math.Clamp(request.SessionHours, 1, 168);
            Audit.Add(db, context, "settings.feishu.update", "feishu_config", config.Id.ToString(),
                new { config.Enabled, config.AppId, config.RedirectUri, secret_rotated = !string.IsNullOrWhiteSpace(request.AppSecret) });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new { ok = true, secret_masked = MaskRawSecret(protector.Unprotect(config.AppSecretCipher)) });
        });

        admin.MapPost("/settings/feishu/test", async (
            HttpContext context,
            AppDbContext db,
            SecretProtector protector,
            IHttpClientFactory httpClientFactory,
            CancellationToken ct) =>
        {
            var config = await db.FeishuAppConfigs.AsNoTracking().FirstOrDefaultAsync(ct);
            if (config is null || string.IsNullOrWhiteSpace(config.AppId) || string.IsNullOrWhiteSpace(config.AppSecretCipher))
            {
                return ApiErrors.Json(new { ok = false, message = "尚未保存 App ID / App Secret。" });
            }

            try
            {
                var client = httpClientFactory.CreateClient("feishu");
                using var response = await client.PostAsJsonAsync("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", new
                {
                    app_id = config.AppId,
                    app_secret = protector.Unprotect(config.AppSecretCipher)
                }, ct);
                var json = await response.Content.ReadAsStringAsync(ct);
                using var doc = JsonDocument.Parse(json);
                var code = doc.RootElement.TryGetProperty("code", out var codeEl) && codeEl.TryGetInt32(out var c) ? c : -1;
                var ok = response.IsSuccessStatusCode && code == 0;
                var message = ok
                    ? "飞书应用凭据有效。"
                    : code == 21001
                        ? "飞书返回 21001：应用所属租户是个人版（豆包）或受平台策略限制，无法用于企业登录。请用企业飞书租户重新创建自建应用。"
                        : code == 10014
                            ? "应用状态不可用（可能未启用或已停用），请先在开放平台发布并启用应用。"
                            : code == 10015
                                ? "App Secret 错误，请在开发者后台「凭证与基础信息」重新复制。"
                                : "飞书应用凭据无效或网络不可达。";
                return ApiErrors.Json(new { ok, message, feishu_code = code });
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                return ApiErrors.Json(new { ok = false, message = "无法连接飞书开放平台。" });
            }
        });

        admin.MapGet("/settings/feishu/diagnostics", async (
            AppDbContext db,
            SecretProtector protector,
            IHttpClientFactory httpClientFactory,
            CancellationToken ct) =>
        {
            var config = await db.FeishuAppConfigs.AsNoTracking().FirstOrDefaultAsync(ct);
            if (config is null || string.IsNullOrWhiteSpace(config.AppId) || string.IsNullOrWhiteSpace(config.AppSecretCipher))
            {
                return ApiErrors.Json(new { ok = false, message = "尚未保存 App ID / App Secret。" });
            }

            try
            {
                var client = httpClientFactory.CreateClient("feishu");
                using var tokenResponse = await client.PostAsJsonAsync("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", new
                {
                    app_id = config.AppId,
                    app_secret = protector.Unprotect(config.AppSecretCipher)
                }, ct);
                var tokenJson = await tokenResponse.Content.ReadAsStringAsync(ct);
                using var tokenDoc = JsonDocument.Parse(tokenJson);
                var tenantToken = JsonString(tokenDoc.RootElement, "tenant_access_token");
                if (string.IsNullOrWhiteSpace(tenantToken))
                {
                    var tokenCode = JsonScalar(tokenDoc.RootElement, "code");
                    var tokenMessage = tokenCode switch
                    {
                        "21001" => "飞书返回 21001：应用所属租户是个人版（豆包）或受平台策略限制，无法获取 tenant_access_token。个人版账号不能创建可用于登录的企业自建应用，请用企业飞书租户重新创建应用后再试。",
                        "10014" => "应用状态不可用（未启用或已停用），请先在开放平台发布并启用应用。",
                        "10015" => "App Secret 错误，请在开发者后台「凭证与基础信息」重新复制。",
                        _ => "获取 tenant_access_token 失败，请检查 App ID / App Secret。"
                    };
                    return ApiErrors.Json(new
                    {
                        ok = false,
                        message = tokenMessage,
                        feishu_code = tokenCode,
                        feishu_msg = JsonString(tokenDoc.RootElement, "msg"),
                        hint = tokenCode == "21001"
                            ? "个人版/豆包账号不支持企业自建应用。请用一个真实企业飞书租户的管理员账号，在 open.feishu.cn/app 新建「企业自建应用」，再回来填写新的 App ID / App Secret。"
                            : null
                    });
                }

                // app_id 传 me 表示查询应用自身，无需额外申请「获取应用信息」权限。
                using var request = new HttpRequestMessage(HttpMethod.Get,
                    "https://open.feishu.cn/open-apis/application/v6/applications/me?lang=zh_cn");
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", tenantToken);
                using var appResponse = await client.SendAsync(request, ct);
                var appJson = await appResponse.Content.ReadAsStringAsync(ct);
                using var appDoc = JsonDocument.Parse(appJson);
                var code = JsonScalar(appDoc.RootElement, "code");
                if (code != "0" || !appDoc.RootElement.TryGetProperty("data", out var dataElement)
                    || !dataElement.TryGetProperty("app", out var app))
                {
                    if (code == "99991672")
                    {
                        return ApiErrors.Json(new
                        {
                            ok = true,
                            partial = true,
                            message = "应用凭据有效（tenant_access_token 获取成功），但应用未开通应用信息读取权限，无法自动列出已开通的 Scope。这不影响登录，以授权页结果为准。",
                            feishu_code = code,
                            feishu_msg = JsonString(appDoc.RootElement, "msg"),
                            hint = "如需自动核对权限，请在权限管理开通 admin:app.info:readonly 或 application:application:self_manage；也可以忽略本提示。"
                        });
                    }
                    return ApiErrors.Json(new
                    {
                        ok = false,
                        message = "查询应用信息失败：" + (JsonString(appDoc.RootElement, "msg") ?? "未知错误"),
                        feishu_code = code,
                        hint = "请在开发者后台 → 权限管理 中直接核对「获取用户身份标识」是否存在、是否已发布。"
                    });
                }

                var scopes = new List<object>();
                var scopeKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (app.TryGetProperty("scopes", out var scopeArray) && scopeArray.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in scopeArray.EnumerateArray())
                    {
                        var key = JsonString(item, "scope");
                        if (key is not null) scopeKeys.Add(key);
                        var tokenTypes = new List<string>();
                        if (item.TryGetProperty("token_types", out var typesElement) && typesElement.ValueKind == JsonValueKind.Array)
                        {
                            tokenTypes.AddRange(typesElement.EnumerateArray()
                                .Where(x => x.ValueKind == JsonValueKind.String)
                                .Select(x => x.GetString())
                                .Where(x => !string.IsNullOrWhiteSpace(x))
                                .Select(x => x!));
                        }
                        scopes.Add(new
                        {
                            scope = key,
                            description = JsonString(item, "description"),
                            level = JsonScalar(item, "level"),
                            token_types = tokenTypes
                        });
                    }
                }

                var redirectUrls = new List<string>();
                if (app.TryGetProperty("redirect_urls", out var redirectElement) && redirectElement.ValueKind == JsonValueKind.Array)
                {
                    redirectUrls.AddRange(redirectElement.EnumerateArray()
                        .Where(x => x.ValueKind == JsonValueKind.String)
                        .Select(x => x.GetString())
                        .Where(x => !string.IsNullOrWhiteSpace(x))
                        .Select(x => x!));
                }

                var hasIdentityScope = scopeKeys.Contains("auth:user.id:read")
                    || scopeKeys.Contains("contact:user.base:readonly")
                    || scopeKeys.Contains("contact:user.base");
                var sceneType = JsonScalar(app, "scene_type");

                return ApiErrors.Json(new
                {
                    ok = true,
                    app_name = JsonString(app, "app_name"),
                    scene_type = sceneType,
                    scene_type_text = sceneType switch
                    {
                        "0" => "企业自建应用",
                        "1" => "商店应用",
                        "2" => "个人应用商店应用",
                        _ => "未知"
                    },
                    status = JsonScalar(app, "status"),
                    online_version_id = JsonString(app, "online_version_id"),
                    unaudit_version_id = JsonString(app, "unaudit_version_id"),
                    redirect_urls = redirectUrls,
                    redirect_match = redirectUrls.Any(x =>
                        string.Equals(x.TrimEnd('/'), config.RedirectUri.TrimEnd('/'), StringComparison.OrdinalIgnoreCase)),
                    scopes,
                    has_identity_scope = hasIdentityScope,
                    has_email_scope = scopeKeys.Contains("contact:user.email:readonly"),
                    message = hasIdentityScope
                        ? "应用已开通用户身份权限。若授权页仍提示「无法授予」，请确认登录账号是企业成员且在可用范围内，并已发布包含该权限的版本。"
                        : "应用缺少「获取用户身份标识」权限：请在开发者后台 → 权限管理 → API 权限 搜索「获取用户身份标识」(auth:user.id:read) 并开通，然后创建版本发布。"
                });
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                return ApiErrors.Json(new { ok = false, message = "无法连接飞书开放平台，请检查网络或代理。" });
            }
        });

        // ---------- models.dev catalog ----------
        admin.MapPost("/catalog/sync", async (
            HttpContext context,
            AppDbContext db,
            ModelsDevService service,
            CancellationToken ct) =>
        {
            var result = await service.SyncAsync(ct);
            Audit.Add(db, context, "catalog.sync", "catalog", result.SnapshotId, new { result.Changed, result.Providers, result.Models, result.Error });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new
            {
                changed = result.Changed,
                snapshot_id = result.SnapshotId,
                providers = result.Providers,
                models = result.Models,
                error = result.Error
            });
        });

        admin.MapGet("/catalog/snapshots", async (AppDbContext db, CancellationToken ct) =>
        {
            var snapshots = await db.CatalogSnapshots.AsNoTracking()
                .OrderByDescending(x => x.FetchedAt)
                .Take(30)
                .ToListAsync(ct);
            var ids = snapshots.Select(x => x.Id).ToList();
            var providerCounts = await db.ProviderTemplates.AsNoTracking()
                .Where(x => ids.Contains(x.SnapshotId))
                .GroupBy(x => x.SnapshotId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
            var modelCounts = await db.ModelTemplates.AsNoTracking()
                .Where(x => ids.Contains(x.SnapshotId))
                .GroupBy(x => x.SnapshotId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
            var latestActive = snapshots.FirstOrDefault(x => x.Status == CatalogSnapshotStatus.Active)?.Id;
            return ApiErrors.Json(snapshots.Select(x => new
            {
                id = x.Id,
                fetched_at = x.FetchedAt,
                status = x.Status.ToString().ToLowerInvariant(),
                content_hash = x.ContentHash[..Math.Min(16, x.ContentHash.Length)],
                schema_version = x.SchemaVersion,
                error = x.Error,
                providers = providerCounts.GetValueOrDefault(x.Id),
                models = modelCounts.GetValueOrDefault(x.Id),
                is_current = x.Id == latestActive
            }));
        });

        admin.MapGet("/catalog/providers", async (string? search, int? limit, AppDbContext db, SecretProtector protector, CancellationToken ct) =>
        {
            var snapshot = await CurrentSnapshotAsync(db, ct);
            if (snapshot is null) return ApiErrors.Json(Array.Empty<object>());
            var query = db.ProviderTemplates.AsNoTracking().Where(x => x.SnapshotId == snapshot.Id);
            if (!string.IsNullOrWhiteSpace(search))
            {
                query = query.Where(x => x.ProviderKey.Contains(search) || x.Name.Contains(search));
            }
            var providers = await query.OrderBy(x => x.ProviderKey).Take(Math.Clamp(limit ?? 100, 1, 400)).ToListAsync(ct);
            var counts = await db.ModelTemplates.AsNoTracking()
                .Where(x => x.SnapshotId == snapshot.Id)
                .GroupBy(x => x.ProviderTemplateId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
            var providerKeys = providers.Select(x => x.ProviderKey).ToList();
            var providerChannels = await db.Channels.AsNoTracking()
                .Where(x => x.ProviderKey != null && providerKeys.Contains(x.ProviderKey))
                .Select(x => new { x.Id, x.Name, x.ProviderKey, x.Status, x.ApiKeyCipher })
                .ToListAsync(ct);
            var importedCounts = await db.PublicModels.AsNoTracking()
                .Where(x => x.ModelTemplateId != null)
                .Join(db.ModelTemplates.Where(t => t.SnapshotId == snapshot.Id), p => p.ModelTemplateId, t => t.Id, (p, t) => new { p.Id, t.ProviderTemplateId })
                .GroupBy(x => x.ProviderTemplateId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
            return ApiErrors.Json(providers.Select(x => new
            {
                id = x.Id,
                provider_key = x.ProviderKey,
                name = x.Name,
                npm = x.Npm,
                protocol_suggestion = x.ProtocolSuggestion,
                base_url = protector.Unprotect(x.BaseUrlCipher),
                doc_url = x.DocUrl,
                env_names = ParseJsonArray(x.EnvNamesJson),
                model_count = counts.GetValueOrDefault(x.Id),
                imported_model_count = importedCounts.GetValueOrDefault(x.Id),
                channel_count = providerChannels.Count(c => c.ProviderKey == x.ProviderKey),
                channels = providerChannels
                    .Where(c => c.ProviderKey == x.ProviderKey)
                    .Select(c => new
                    {
                        id = c.Id,
                        name = c.Name,
                        status = c.Status.ToString().ToLowerInvariant(),
                        has_api_key = !string.IsNullOrWhiteSpace(c.ApiKeyCipher)
                    }),
                snapshot_id = x.SnapshotId
            }));
        });

        admin.MapGet("/catalog/providers/{key}/models", async (
            string key,
            string? search,
            bool? include_deprecated,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var snapshot = await CurrentSnapshotAsync(db, ct);
            if (snapshot is null) return ApiErrors.Json(Array.Empty<object>());
            var provider = await db.ProviderTemplates.AsNoTracking()
                .FirstOrDefaultAsync(x => x.SnapshotId == snapshot.Id && x.ProviderKey == key, ct);
            if (provider is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "供应商模板不存在。" } }, StatusCodes.Status404NotFound);
            }
            var query = db.ModelTemplates.AsNoTracking()
                .Where(x => x.SnapshotId == snapshot.Id && x.ProviderTemplateId == provider.Id);
            if (include_deprecated != true)
            {
                query = query.Where(x => x.Status == null || (x.Status != "deprecated" && x.Status != "beta"));
            }
            if (!string.IsNullOrWhiteSpace(search))
            {
                query = query.Where(x => x.ModelKey.Contains(search) || x.Name.Contains(search));
            }
            var models = await query.OrderByDescending(x => x.ReleaseDate).ThenBy(x => x.ModelKey).Take(300).ToListAsync(ct);
            return ApiErrors.Json(new
            {
                provider = new { key = provider.ProviderKey, name = provider.Name, protocol_suggestion = provider.ProtocolSuggestion },
                models = models.Select(x => new
                {
                    id = x.Id,
                    model_key = x.ModelKey,
                    canonical_model_id = x.CanonicalModelId,
                    name = x.Name,
                    family = x.Family,
                    description = x.Description,
                    context_limit = x.ContextLimit,
                    output_limit = x.OutputLimit,
                    reasoning = x.Reasoning,
                    reasoning_options = ParseJsonElement(x.ReasoningOptionsJson),
                    modalities = ParseJsonElement(x.ModalitiesJson),
                    status = x.Status,
                    release_date = x.ReleaseDate
                })
            });
        });

        admin.MapPost("/catalog/import", async (
            ImportRequestDto request,
            HttpContext context,
            AppDbContext db,
            CatalogImportService importService,
            CancellationToken ct) =>
        {
            if (request.ModelKeys is null || request.ModelKeys.Count == 0)
            {
                return ApiErrors.Json(new { error = new { code = "validation_error", message = "至少选择一个模型。" } }, StatusCodes.Status400BadRequest);
            }
            try
            {
                var result = await importService.ImportAsync(new ImportPublicModelsRequest(
                    request.ProviderKey,
                    request.ModelKeys.Distinct().ToList(),
                    new ImportChannelInput(request.ChannelId, request.ChannelName, request.BaseUrl, request.ApiKey, request.Protocol, request.HeadersJson),
                    request.Publish,
                    request.AliasPrefix), ct);
                Audit.Add(db, context, "catalog.import", "provider", request.ProviderKey, new
                {
                    channel_id = result.ChannelId,
                    models = result.PublicModelIds.Count,
                    skipped = result.Skipped
                });
                await db.SaveChangesAsync(ct);
                return ApiErrors.Json(new
                {
                    channel_id = result.ChannelId,
                    public_model_ids = result.PublicModelIds,
                    skipped = result.Skipped,
                    warning = result.Warning
                });
            }
            catch (InvalidOperationException ex)
            {
                return ApiErrors.Json(new { error = new { code = "import_failed", message = ex.Message } }, StatusCodes.Status400BadRequest);
            }
        });

        // ---------- channels ----------
        admin.MapGet("/channels", async (AppDbContext db, SecretProtector protector, CancellationToken ct) =>
        {
            var channels = await db.Channels.AsNoTracking().Include(x => x.Models).OrderBy(x => x.Name).ToListAsync(ct);
            return ApiErrors.Json(channels.Select(x => ChannelDto(x, protector)));
        });

        admin.MapPost("/channels", async (
            ChannelUpsertRequest request,
            HttpContext context,
            AppDbContext db,
            SecretProtector protector,
            CancellationToken ct) =>
        {
            var protocol = ApiProtocols.Parse(request.Protocol);
            if (protocol == ApiProtocol.Unknown)
            {
                return ApiErrors.Json(new { error = new { code = "validation_error", message = "协议类型无效。" } }, StatusCodes.Status400BadRequest);
            }
            if (!IsHttpUrl(request.BaseUrl))
            {
                return ApiErrors.Json(new { error = new { code = "validation_error", message = "Base URL 必须是 http(s) 地址。" } }, StatusCodes.Status400BadRequest);
            }

            var channel = new Channel
            {
                Name = request.Name.Trim(),
                ProviderKey = request.ProviderKey,
                ProviderTemplateId = request.ProviderTemplateId,
                Protocol = protocol,
                BaseUrlCipher = protector.Protect(request.BaseUrl.Trim()),
                ApiKeyCipher = protector.Protect(request.ApiKey?.Trim() ?? string.Empty),
                HeadersCipher = string.IsNullOrWhiteSpace(request.HeadersJson) ? null : protector.Protect(request.HeadersJson),
                Status = ParseEnum(request.Status, ChannelStatus.Enabled),
                MaxConcurrency = request.MaxConcurrency ?? 32
            };
            db.Channels.Add(channel);
            Audit.Add(db, context, "channel.create", "channel", channel.Id.ToString(), new { channel.Name, protocol = protocol.ToWire() });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(ChannelDto(channel, protector), StatusCodes.Status201Created);
        });

        admin.MapPut("/channels/{id:guid}", async (
            Guid id,
            ChannelUpsertRequest request,
            HttpContext context,
            AppDbContext db,
            SecretProtector protector,
            CancellationToken ct) =>
        {
            var channel = await db.Channels.Include(x => x.Models).FirstOrDefaultAsync(x => x.Id == id, ct);
            if (channel is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "渠道不存在。" } }, StatusCodes.Status404NotFound);
            }
            var protocol = ApiProtocols.Parse(request.Protocol);
            if (protocol == ApiProtocol.Unknown)
            {
                return ApiErrors.Json(new { error = new { code = "validation_error", message = "协议类型无效。" } }, StatusCodes.Status400BadRequest);
            }
            if (!IsHttpUrl(request.BaseUrl))
            {
                return ApiErrors.Json(new { error = new { code = "validation_error", message = "Base URL 必须是 http(s) 地址。" } }, StatusCodes.Status400BadRequest);
            }

            channel.Name = request.Name.Trim();
            channel.ProviderKey = request.ProviderKey;
            channel.ProviderTemplateId = request.ProviderTemplateId;
            channel.Protocol = protocol;
            channel.BaseUrlCipher = protector.Protect(request.BaseUrl.Trim());
            if (!string.IsNullOrWhiteSpace(request.ApiKey) && !request.ApiKey.Contains("****"))
            {
                channel.ApiKeyCipher = protector.Protect(request.ApiKey.Trim());
            }
            if (request.HeadersJson is not null)
            {
                channel.HeadersCipher = string.IsNullOrWhiteSpace(request.HeadersJson) ? null : protector.Protect(request.HeadersJson);
            }
            channel.Status = ParseEnum(request.Status, channel.Status);
            channel.MaxConcurrency = request.MaxConcurrency ?? channel.MaxConcurrency;
            Audit.Add(db, context, "channel.update", "channel", channel.Id.ToString(), new { channel.Name, protocol = protocol.ToWire() });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(ChannelDto(channel, protector));
        });

        admin.MapPost("/channels/{id:guid}/rotate-secret", async (
            Guid id,
            RotateSecretRequest request,
            HttpContext context,
            AppDbContext db,
            SecretProtector protector,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.ApiKey))
            {
                return ApiErrors.Json(new { error = new { code = "validation_error", message = "API Key 不能为空。" } }, StatusCodes.Status400BadRequest);
            }
            var channel = await db.Channels.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (channel is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "渠道不存在。" } }, StatusCodes.Status404NotFound);
            }
            channel.ApiKeyCipher = protector.Protect(request.ApiKey.Trim());
            Audit.Add(db, context, "channel.rotate_secret", "channel", channel.Id.ToString(), new { channel.Name });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new { ok = true });
        });

        admin.MapPost("/channels/{id:guid}/test", async (
            Guid id,
            HttpContext context,
            AppDbContext db,
            ChannelTestService testService,
            CancellationToken ct) =>
        {
            var channel = await db.Channels.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (channel is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "渠道不存在。" } }, StatusCodes.Status404NotFound);
            }
            var result = await testService.TestAsync(channel, ct);
            channel.LastTestAt = DateTime.UtcNow;
            channel.LastTestOk = result.Ok;
            channel.LastError = result.Ok ? null : result.Error;
            Audit.Add(db, context, "channel.test", "channel", channel.Id.ToString(), new { result.Ok, result.StatusCode, result.LatencyMs });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new
            {
                ok = result.Ok,
                status_code = result.StatusCode,
                latency_ms = result.LatencyMs,
                error = result.Error,
                usage = result.Usage is null ? null : new
                {
                    input_tokens = result.Usage.InputTokens,
                    output_tokens = result.Usage.OutputTokens,
                    cache_read_tokens = result.Usage.CacheReadTokens,
                    cache_write_tokens = result.Usage.CacheWriteTokens,
                    total_tokens = result.Usage.TotalTokens,
                    has_usage = result.Usage.HasUsage
                }
            });
        });

        admin.MapDelete("/channels/{id:guid}", async (Guid id, HttpContext context, AppDbContext db, CancellationToken ct) =>
        {
            var channel = await db.Channels.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (channel is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "渠道不存在。" } }, StatusCodes.Status404NotFound);
            }
            channel.Status = ChannelStatus.Disabled;
            Audit.Add(db, context, "channel.disable", "channel", channel.Id.ToString(), new { channel.Name });
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        admin.MapPost("/channels/{id:guid}/models", async (
            Guid id,
            ChannelModelRequest request,
            HttpContext context,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var channel = await db.Channels.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (channel is null || string.IsNullOrWhiteSpace(request.UpstreamModel))
            {
                return ApiErrors.Json(new { error = new { code = "validation_error", message = "渠道或上游模型无效。" } }, StatusCodes.Status400BadRequest);
            }
            var channelModel = new ChannelModel
            {
                ChannelId = id,
                UpstreamModel = request.UpstreamModel.Trim(),
                Enabled = true
            };
            db.ChannelModels.Add(channelModel);
            Audit.Add(db, context, "channel.model.add", "channel", id.ToString(), new { request.UpstreamModel });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new { id = channelModel.Id }, StatusCodes.Status201Created);
        });

        // ---------- public models ----------
        admin.MapGet("/models", async (AppDbContext db, CancellationToken ct) =>
        {
            var models = await db.PublicModels.AsNoTracking()
                .Include(x => x.ChannelModel).ThenInclude(cm => cm!.Channel)
                .OrderBy(x => x.Alias)
                .ToListAsync(ct);
            var templateIds = models.Where(x => x.ModelTemplateId != null).Select(x => x.ModelTemplateId!.Value).Distinct().ToList();
            var templateProviders = await db.ModelTemplates.AsNoTracking()
                .Where(x => templateIds.Contains(x.Id))
                .Select(x => new { x.Id, x.ProviderTemplateId })
                .ToDictionaryAsync(x => x.Id, x => x.ProviderTemplateId, ct);
            var providerTemplateIds = templateProviders.Values.Distinct().ToList();
            var providerKeys = await db.ProviderTemplates.AsNoTracking()
                .Where(x => providerTemplateIds.Contains(x.Id))
                .ToDictionaryAsync(x => x.Id, x => x.ProviderKey, ct);
            string? ProviderKeyOf(PublicModel model) =>
                model.ModelTemplateId is { } templateId
                && templateProviders.TryGetValue(templateId, out var providerTemplateId)
                && providerKeys.TryGetValue(providerTemplateId, out var key)
                    ? key
                    : null;
            return ApiErrors.Json(models.Select(x => new
            {
                id = x.Id,
                alias = x.Alias,
                display_name = x.DisplayName,
                api = x.Protocol.ToWire(),
                provider_key = ProviderKeyOf(x),
                context_window = x.ContextWindow,
                max_tokens = x.MaxTokens,
                reasoning = x.Reasoning,
                thinking_level_map = ParseJsonElement(x.ThinkingLevelMapJson),
                capabilities = ParseJsonElement(x.CapabilitiesJson),
                status = x.Status.ToString().ToLowerInvariant(),
                catalog_snapshot_id = x.CatalogSnapshotId,
                channel_id = x.ChannelModel?.ChannelId,
                channel_name = x.ChannelModel?.Channel?.Name,
                channel_provider_key = x.ChannelModel?.Channel?.ProviderKey,
                upstream_model = x.ChannelModel?.UpstreamModel,
                bound = x.ChannelModel is not null
            }));
        });

        admin.MapPut("/models/{id:guid}", async (
            Guid id,
            PublicModelUpdateRequest request,
            HttpContext context,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var model = await db.PublicModels.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (model is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "模型不存在。" } }, StatusCodes.Status404NotFound);
            }
            if (!string.IsNullOrWhiteSpace(request.DisplayName)) model.DisplayName = request.DisplayName.Trim();
            if (request.ContextWindow is > 0) model.ContextWindow = request.ContextWindow.Value;
            if (request.MaxTokens is > 0) model.MaxTokens = request.MaxTokens.Value;
            if (!string.IsNullOrWhiteSpace(request.Status)) model.Status = ParseEnum(request.Status, model.Status);
            Audit.Add(db, context, "public_model.update", "public_model", model.Id.ToString(), new { model.Alias, model.DisplayName, status = model.Status.ToString() });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new { ok = true });
        });

        admin.MapDelete("/models/{id:guid}", async (Guid id, HttpContext context, AppDbContext db, CancellationToken ct) =>
        {
            var model = await db.PublicModels.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (model is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "模型不存在。" } }, StatusCodes.Status404NotFound);
            }
            model.Status = PublicModelStatus.Disabled;
            Audit.Add(db, context, "public_model.disable", "public_model", model.Id.ToString(), new { model.Alias });
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // ---------- users ----------
        admin.MapGet("/users", async (AppDbContext db, CancellationToken ct) =>
        {
            var users = await db.Users.AsNoTracking().OrderBy(x => x.Name).ToListAsync(ct);
            var deviceCounts = await db.Devices.AsNoTracking()
                .GroupBy(x => x.UserId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
            var memberships = await db.ProjectMembers.AsNoTracking()
                .Join(db.Projects, m => m.ProjectId, p => p.Id, (m, p) => new { m.UserId, p.Key })
                .ToListAsync(ct);
            var byUser = memberships.GroupBy(x => x.UserId).ToDictionary(g => g.Key, g => g.Select(x => x.Key).ToList());
            return ApiErrors.Json(users.Select(x => new
            {
                id = x.Id,
                feishu_open_id = x.FeishuOpenId,
                union_id = x.UnionId,
                name = x.Name,
                email = x.Email,
                role = x.Role.ToString().ToLowerInvariant(),
                status = x.Status.ToString().ToLowerInvariant(),
                last_login_at = x.LastLoginAt,
                created_at = x.CreatedAt,
                device_count = deviceCounts.GetValueOrDefault(x.Id),
                projects = byUser.GetValueOrDefault(x.Id, [])
            }));
        });

        admin.MapPatch("/users/{id:guid}", async (
            Guid id,
            UserPatchRequest request,
            HttpContext context,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var user = await db.Users.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (user is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "用户不存在。" } }, StatusCodes.Status404NotFound);
            }
            var newRole = string.IsNullOrWhiteSpace(request.Role) ? user.Role : ParseEnum(request.Role, user.Role);
            var newStatus = string.IsNullOrWhiteSpace(request.Status) ? user.Status : ParseEnum(request.Status, user.Status);
            if (user.Role == UserRole.Admin && (newRole != UserRole.Admin || newStatus != UserStatus.Active))
            {
                var activeAdmins = await db.Users.CountAsync(x => x.Role == UserRole.Admin && x.Status == UserStatus.Active, ct);
                if (activeAdmins <= 1)
                {
                    return ApiErrors.Json(new { error = new { code = "last_admin", message = "不允许降级或停用最后一个管理员。" } }, StatusCodes.Status400BadRequest);
                }
            }
            var wasActive = user.Status;
            user.Role = newRole;
            user.Status = newStatus;
            if (newStatus == UserStatus.Disabled)
            {
                var tokens = await db.RefreshTokens.Where(x => x.UserId == user.Id && x.RevokedAt == null).ToListAsync(ct);
                foreach (var token in tokens)
                {
                    token.RevokedAt = DateTime.UtcNow;
                    token.RevokedReason = "user_disabled";
                }
            }
            Audit.Add(db, context, "user.update", "user", user.Id.ToString(), new { role = newRole.ToString(), status = newStatus.ToString() });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new
            {
                ok = true,
                role = newRole.ToString().ToLowerInvariant(),
                status = newStatus.ToString().ToLowerInvariant(),
                previous_status = wasActive.ToString().ToLowerInvariant()
            });
        });

        // ---------- projects ----------
        admin.MapGet("/projects", async (AppDbContext db, CancellationToken ct) =>
        {
            var projects = await db.Projects.AsNoTracking()
                .Include(x => x.Members)
                .Include(x => x.Repos)
                .OrderBy(x => x.Key)
                .ToListAsync(ct);
            return ApiErrors.Json(projects.Select(x => new
            {
                id = x.Id,
                key = x.Key,
                name = x.Name,
                description = x.Description,
                status = x.Status.ToString().ToLowerInvariant(),
                member_count = x.Members.Count,
                repo_count = x.Repos.Count,
                created_at = x.CreatedAt,
                updated_at = x.UpdatedAt
            }));
        });

        admin.MapPost("/projects", async (
            ProjectUpsertRequest request,
            HttpContext context,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var key = request.Key?.Trim().ToLowerInvariant() ?? string.Empty;
            if (!Regex.IsMatch(key, "^[a-z0-9][a-z0-9-]{1,63}$"))
            {
                return ApiErrors.Json(new { error = new { code = "validation_error", message = "项目 Key 必须为 2-64 位小写字母、数字或连字符。" } }, StatusCodes.Status400BadRequest);
            }
            if (await db.Projects.AnyAsync(x => x.Key == key, ct))
            {
                return ApiErrors.Json(new { error = new { code = "duplicate_key", message = "项目 Key 已存在。" } }, StatusCodes.Status409Conflict);
            }
            var project = new Project { Key = key, Name = request.Name.Trim(), Description = request.Description, Status = ProjectStatus.Active };
            db.Projects.Add(project);
            var userId = context.User.UserId();
            if (userId != Guid.Empty)
            {
                db.ProjectMembers.Add(new ProjectMember { ProjectId = project.Id, UserId = userId, Source = "creator" });
            }
            Audit.Add(db, context, "project.create", "project", project.Id.ToString(), new { project.Key, project.Name });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new { id = project.Id, key = project.Key }, StatusCodes.Status201Created);
        });

        admin.MapPut("/projects/{id:guid}", async (
            Guid id,
            ProjectUpsertRequest request,
            HttpContext context,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var project = await db.Projects.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (project is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "项目不存在。" } }, StatusCodes.Status404NotFound);
            }
            project.Name = request.Name.Trim();
            project.Description = request.Description;
            if (!string.IsNullOrWhiteSpace(request.Status)) project.Status = ParseEnum(request.Status, project.Status);
            Audit.Add(db, context, "project.update", "project", project.Id.ToString(), new { project.Name, status = project.Status.ToString() });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new { ok = true });
        });

        admin.MapGet("/projects/{id:guid}", async (Guid id, AppDbContext db, CancellationToken ct) =>
        {
            var project = await db.Projects.AsNoTracking()
                .Include(x => x.Members).ThenInclude(m => m.User)
                .Include(x => x.Repos)
                .FirstOrDefaultAsync(x => x.Id == id, ct);
            if (project is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "项目不存在。" } }, StatusCodes.Status404NotFound);
            }
            var quotas = await db.Quotas.AsNoTracking()
                .Where(x => x.ScopeType == ScopeType.Project && x.ScopeId == project.Id.ToString())
                .ToListAsync(ct);
            return ApiErrors.Json(new
            {
                id = project.Id,
                key = project.Key,
                name = project.Name,
                description = project.Description,
                status = project.Status.ToString().ToLowerInvariant(),
                members = project.Members.Select(m => new
                {
                    user_id = m.UserId,
                    name = m.User?.Name,
                    email = m.User?.Email,
                    source = m.Source
                }),
                repos = project.Repos.Select(r => new
                {
                    id = r.Id,
                    repo_hash = r.RepoHash,
                    repo_display = r.RepoDisplay
                }),
                quotas = quotas.Select(q => new
                {
                    id = q.Id,
                    period = q.Period.ToString().ToLowerInvariant(),
                    token_limit = q.TokenLimit,
                    request_limit = q.RequestLimit,
                    action = q.Action.ToString().ToLowerInvariant()
                })
            });
        });

        admin.MapPost("/projects/{id:guid}/members", async (
            Guid id,
            ProjectMemberRequest request,
            HttpContext context,
            AppDbContext db,
            CancellationToken ct) =>
        {
            if (!await db.Projects.AnyAsync(x => x.Id == id, ct))
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "项目不存在。" } }, StatusCodes.Status404NotFound);
            }
            if (!await db.Users.AnyAsync(x => x.Id == request.UserId, ct))
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "用户不存在。" } }, StatusCodes.Status404NotFound);
            }
            if (await db.ProjectMembers.AnyAsync(x => x.ProjectId == id && x.UserId == request.UserId, ct))
            {
                return ApiErrors.Json(new { error = new { code = "duplicate_member", message = "用户已是项目成员。" } }, StatusCodes.Status409Conflict);
            }
            db.ProjectMembers.Add(new ProjectMember { ProjectId = id, UserId = request.UserId, Source = "manual" });
            Audit.Add(db, context, "project.member.add", "project", id.ToString(), new { request.UserId });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new { ok = true }, StatusCodes.Status201Created);
        });

        admin.MapDelete("/projects/{id:guid}/members/{userId:guid}", async (
            Guid id,
            Guid userId,
            HttpContext context,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var member = await db.ProjectMembers.FirstOrDefaultAsync(x => x.ProjectId == id && x.UserId == userId, ct);
            if (member is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "成员不存在。" } }, StatusCodes.Status404NotFound);
            }
            db.ProjectMembers.Remove(member);
            Audit.Add(db, context, "project.member.remove", "project", id.ToString(), new { userId });
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        admin.MapPost("/projects/{id:guid}/repos", async (
            Guid id,
            ProjectRepoRequest request,
            HttpContext context,
            AppDbContext db,
            SecretProtector protector,
            CancellationToken ct) =>
        {
            if (!await db.Projects.AnyAsync(x => x.Id == id, ct))
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "项目不存在。" } }, StatusCodes.Status404NotFound);
            }
            var normalized = RepoUrlNormalizer.Normalize(request.RepoUrl);
            if (await db.ProjectRepos.AnyAsync(x => x.RepoHash == normalized.Hash, ct))
            {
                return ApiErrors.Json(new { error = new { code = "duplicate_repo", message = "该仓库已绑定到其他项目。" } }, StatusCodes.Status409Conflict);
            }
            var repo = new ProjectRepo
            {
                ProjectId = id,
                RepoHash = normalized.Hash,
                RepoDisplay = normalized.Display,
                NormalizedUrlCipher = protector.Protect(normalized.NormalizedUrl)
            };
            db.ProjectRepos.Add(repo);
            Audit.Add(db, context, "project.repo.add", "project", id.ToString(), new { normalized.Display });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new { id = repo.Id, repo_hash = repo.RepoHash, repo_display = repo.RepoDisplay }, StatusCodes.Status201Created);
        });

        admin.MapDelete("/projects/{id:guid}/repos/{repoId:guid}", async (
            Guid id,
            Guid repoId,
            HttpContext context,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var repo = await db.ProjectRepos.FirstOrDefaultAsync(x => x.Id == repoId && x.ProjectId == id, ct);
            if (repo is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "仓库映射不存在。" } }, StatusCodes.Status404NotFound);
            }
            db.ProjectRepos.Remove(repo);
            Audit.Add(db, context, "project.repo.remove", "project", id.ToString(), new { repo.RepoDisplay });
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // ---------- quotas & policies ----------
        admin.MapGet("/quotas", async (AppDbContext db, CancellationToken ct) =>
        {
            var quotas = await db.Quotas.AsNoTracking().OrderBy(x => x.ScopeType).ThenBy(x => x.ScopeId).ToListAsync(ct);
            var users = await db.Users.AsNoTracking().ToDictionaryAsync(x => x.Id.ToString(), x => x.Name, ct);
            var projects = await db.Projects.AsNoTracking().ToDictionaryAsync(x => x.Id.ToString(), x => x.Name, ct);
            var now = DateTime.UtcNow;
            var rows = new List<object>();
            foreach (var quota in quotas)
            {
                var (from, to) = AIControl.Infrastructure.Analytics.AnalyticsService.PeriodRange(quota.Period, now);
                var query = db.UsageEvents.AsNoTracking().Where(x => x.OccurredAt >= from && x.OccurredAt < to);
                if (quota.ScopeType == ScopeType.User && Guid.TryParse(quota.ScopeId, out var userId))
                {
                    query = query.Where(x => x.UserId == userId);
                }
                else if (quota.ScopeType == ScopeType.Project && Guid.TryParse(quota.ScopeId, out var projectId))
                {
                    query = query.Where(x => x.ProjectId == projectId);
                }
                var usedTokens = await query.SumAsync(x => x.TotalTokens, ct);
                var usedRequests = await query.CountAsync(ct);
                rows.Add(new
                {
                    id = quota.Id,
                    scope_type = quota.ScopeType.ToString().ToLowerInvariant(),
                    scope_id = quota.ScopeId,
                    scope_name = quota.ScopeType == ScopeType.User
                        ? users.GetValueOrDefault(quota.ScopeId, quota.ScopeId)
                        : projects.GetValueOrDefault(quota.ScopeId, quota.ScopeId),
                    period = quota.Period.ToString().ToLowerInvariant(),
                    token_limit = quota.TokenLimit,
                    request_limit = quota.RequestLimit,
                    action = quota.Action.ToString().ToLowerInvariant(),
                    enabled = quota.Enabled,
                    used_tokens = usedTokens,
                    used_requests = usedRequests,
                    token_percent = quota.TokenLimit == 0 ? 0 : Math.Round(usedTokens * 100.0 / quota.TokenLimit, 2)
                });
            }
            return ApiErrors.Json(rows);
        });

        admin.MapPut("/quotas", async (
            QuotaUpsertRequest request,
            HttpContext context,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var scopeType = ParseEnum(request.ScopeType, ScopeType.User);
            if (scopeType == ScopeType.Global || string.IsNullOrWhiteSpace(request.ScopeId))
            {
                return ApiErrors.Json(new { error = new { code = "validation_error", message = "配额仅支持用户或项目范围。" } }, StatusCodes.Status400BadRequest);
            }
            if (!Guid.TryParse(request.ScopeId, out var scopeGuid) ||
                (scopeType == ScopeType.User && !await db.Users.AnyAsync(x => x.Id == scopeGuid, ct)) ||
                (scopeType == ScopeType.Project && !await db.Projects.AnyAsync(x => x.Id == scopeGuid, ct)))
            {
                return ApiErrors.Json(new { error = new { code = "validation_error", message = "配额对象不存在。" } }, StatusCodes.Status400BadRequest);
            }
            var period = ParseEnum(request.Period, QuotaPeriod.Month);
            var quota = await db.Quotas.FirstOrDefaultAsync(
                x => x.ScopeType == scopeType && x.ScopeId == request.ScopeId && x.Period == period, ct);
            if (quota is null)
            {
                quota = new Quota { ScopeType = scopeType, ScopeId = request.ScopeId, Period = period };
                db.Quotas.Add(quota);
            }
            quota.TokenLimit = Math.Max(0, request.TokenLimit);
            quota.RequestLimit = Math.Max(0, request.RequestLimit);
            quota.Action = ParseEnum(request.Action, QuotaAction.Block);
            quota.Enabled = request.Enabled;
            Audit.Add(db, context, "quota.upsert", "quota", quota.Id.ToString(), new
            {
                scope_type = scopeType.ToString(),
                quota.ScopeId,
                period = period.ToString(),
                quota.TokenLimit,
                quota.RequestLimit
            });
            await db.SaveChangesAsync(ct);
            return ApiErrors.Json(new { id = quota.Id });
        });

        admin.MapDelete("/quotas/{id:guid}", async (Guid id, HttpContext context, AppDbContext db, CancellationToken ct) =>
        {
            var quota = await db.Quotas.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (quota is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "配额不存在。" } }, StatusCodes.Status404NotFound);
            }
            db.Quotas.Remove(quota);
            Audit.Add(db, context, "quota.delete", "quota", id.ToString());
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        admin.MapGet("/policies", async (AppDbContext db, CancellationToken ct) =>
        {
            var policies = await db.Policies.AsNoTracking().OrderBy(x => x.Type).ToListAsync(ct);
            return ApiErrors.Json(policies.Select(p => new
            {
                id = p.Id,
                scope_type = p.ScopeType.ToString().ToLowerInvariant(),
                scope_id = p.ScopeId,
                type = p.Type.ToString().ToLowerInvariant(),
                config = ParseJsonElement(p.ConfigJson),
                config_json = p.ConfigJson,
                version = p.Version,
                enabled = p.Enabled,
                updated_at = p.UpdatedAt
            }));
        });

        admin.MapPut("/policies/{id:guid}", async (
            Guid id,
            PolicyUpdateRequest request,
            HttpContext context,
            AppDbContext db,
            CancellationToken ct) =>
        {
            JsonDocument doc;
            try
            {
                doc = JsonDocument.Parse(request.ConfigJson);
            }
            catch (JsonException)
            {
                return ApiErrors.Json(new { error = new { code = "validation_error", message = "策略配置必须是合法 JSON。" } }, StatusCodes.Status400BadRequest);
            }
            using (doc)
            {
                var policy = await db.Policies.FirstOrDefaultAsync(x => x.Id == id, ct);
                if (policy is null)
                {
                    return ApiErrors.Json(new { error = new { code = "not_found", message = "策略不存在。" } }, StatusCodes.Status404NotFound);
                }
                policy.ConfigJson = request.ConfigJson;
                policy.Enabled = request.Enabled;
                policy.Version++;
                Audit.Add(db, context, "policy.update", "policy", policy.Id.ToString(), new { policy.Type, policy.Version, policy.Enabled });
                await db.SaveChangesAsync(ct);
                return ApiErrors.Json(new { ok = true, version = policy.Version });
            }
        });

        // ---------- devices ----------
        admin.MapGet("/devices", async (AppDbContext db, CancellationToken ct) =>
        {
            var devices = await db.Devices.AsNoTracking().OrderByDescending(x => x.LastSeenAt).Take(500).ToListAsync(ct);
            var users = await db.Users.AsNoTracking().ToDictionaryAsync(x => x.Id, x => x.Name, ct);
            return ApiErrors.Json(devices.Select(d => new
            {
                id = d.Id,
                user_id = d.UserId,
                user_name = users.GetValueOrDefault(d.UserId),
                name = d.Name,
                os = d.Os,
                plugin_version = d.PluginVersion,
                pi_version = d.PiVersion,
                status = d.Status.ToString().ToLowerInvariant(),
                last_seen_at = d.LastSeenAt,
                created_at = d.CreatedAt
            }));
        });

        admin.MapDelete("/devices/{id}", async (string id, HttpContext context, AppDbContext db, CancellationToken ct) =>
        {
            var device = await db.Devices.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (device is null)
            {
                return ApiErrors.Json(new { error = new { code = "not_found", message = "设备不存在。" } }, StatusCodes.Status404NotFound);
            }
            device.Status = DeviceStatus.Revoked;
            var tokens = await db.RefreshTokens.Where(x => x.DeviceId == id && x.RevokedAt == null).ToListAsync(ct);
            foreach (var token in tokens)
            {
                token.RevokedAt = DateTime.UtcNow;
                token.RevokedReason = "device_revoked";
            }
            Audit.Add(db, context, "device.revoke", "device", id, new { device.Name, device.UserId });
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // ---------- audit ----------
        admin.MapGet("/audit-logs", async (
            string? action,
            string? actor,
            DateTime? from,
            DateTime? to,
            int? limit,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var query = db.AuditLogs.AsNoTracking().AsQueryable();
            if (!string.IsNullOrWhiteSpace(action)) query = query.Where(x => x.Action.Contains(action));
            if (!string.IsNullOrWhiteSpace(actor)) query = query.Where(x => x.ActorName.Contains(actor));
            if (from is not null) query = query.Where(x => x.CreatedAt >= from);
            if (to is not null) query = query.Where(x => x.CreatedAt < to);
            var logs = await query.OrderByDescending(x => x.CreatedAt).Take(Math.Clamp(limit ?? 100, 1, 1000)).ToListAsync(ct);
            return ApiErrors.Json(logs.Select(x => new
            {
                id = x.Id,
                actor_user_id = x.ActorUserId,
                actor_name = x.ActorName,
                action = x.Action,
                target_type = x.TargetType,
                target_id = x.TargetId,
                detail = ParseJsonElement(x.DetailJson),
                ip = x.Ip,
                user_agent = x.UserAgent,
                created_at = x.CreatedAt
            }));
        });

        // ---------- system health ----------
        admin.MapGet("/system/health", async (
            AppDbContext db,
            SecretProtector protector,
            Microsoft.Extensions.Options.IOptions<GatewayOptions> gatewayOptions,
            CancellationToken ct) =>
        {
            var snapshot = await db.CatalogSnapshots.AsNoTracking()
                .Where(x => x.Status == CatalogSnapshotStatus.Active)
                .OrderByDescending(x => x.FetchedAt)
                .FirstOrDefaultAsync(ct);
            var channels = await db.Channels.AsNoTracking().ToListAsync(ct);
            return ApiErrors.Json(new
            {
                gateway_base_url = gatewayOptions.Value.PublicBaseUrl,
                database = "sqlite",
                catalog = snapshot is null ? null : new
                {
                    snapshot_id = snapshot.Id,
                    fetched_at = snapshot.FetchedAt,
                    status = snapshot.Status.ToString().ToLowerInvariant()
                },
                counts = new
                {
                    users = await db.Users.CountAsync(ct),
                    active_users = await db.Users.CountAsync(x => x.Status == UserStatus.Active, ct),
                    projects = await db.Projects.CountAsync(ct),
                    channels = channels.Count,
                    public_models = await db.PublicModels.CountAsync(ct),
                    sessions = await db.AgentSessions.CountAsync(ct)
                },
                channels = channels.Select(c => new
                {
                    id = c.Id,
                    name = c.Name,
                    protocol = c.Protocol.ToWire(),
                    status = c.Status.ToString().ToLowerInvariant(),
                    last_test_at = c.LastTestAt,
                    last_test_ok = c.LastTestOk,
                    last_error = c.LastError
                }),
                secrets = new { encrypted_at_rest = true, storage = "AES-GCM" }
            });
        });

        return app;
    }

    private static async Task<CatalogSnapshot?> CurrentSnapshotAsync(AppDbContext db, CancellationToken ct) =>
        await db.CatalogSnapshots.AsNoTracking()
            .Where(x => x.Source == "models.dev" && x.Status == CatalogSnapshotStatus.Active)
            .OrderByDescending(x => x.FetchedAt)
            .FirstOrDefaultAsync(ct);

    private static object ChannelDto(Channel channel, SecretProtector protector) => new
    {
        id = channel.Id,
        name = channel.Name,
        provider_key = channel.ProviderKey,
        provider_template_id = channel.ProviderTemplateId,
        protocol = channel.Protocol.ToWire(),
        base_url = protector.Unprotect(channel.BaseUrlCipher),
        api_key_masked = MaskRawSecret(protector.Unprotect(channel.ApiKeyCipher)),
        has_headers = !string.IsNullOrWhiteSpace(channel.HeadersCipher),
        status = channel.Status.ToString().ToLowerInvariant(),
        max_concurrency = channel.MaxConcurrency,
        model_count = channel.Models.Count,
        last_test_at = channel.LastTestAt,
        last_test_ok = channel.LastTestOk,
        last_error = channel.LastError,
        created_at = channel.CreatedAt,
        updated_at = channel.UpdatedAt
    };

    private static string MaskRawSecret(string value) =>
        string.IsNullOrEmpty(value) ? string.Empty : value.Length <= 4 ? "****" : "****" + value[^4..];

    private static string MaskSecret(string? cipher)
    {
        if (string.IsNullOrEmpty(cipher)) return string.Empty;
        return "****" + (cipher.Length >= 4 ? cipher[^4..] : cipher);
    }

    private static bool IsHttpUrl(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);

    private static T ParseEnum<T>(string? value, T fallback) where T : struct, Enum =>
        Enum.TryParse<T>(value, true, out var parsed) ? parsed : fallback;

    private static string? JsonString(JsonElement element, string property) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string? JsonScalar(JsonElement element, string property) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value)
            ? value.ValueKind switch
            {
                JsonValueKind.String => value.GetString(),
                JsonValueKind.Number => value.ToString(),
                _ => null
            }
            : null;

    private static string[] ParseJsonArray(string? json)
    {
        try
        {
            return string.IsNullOrWhiteSpace(json) ? [] : JsonSerializer.Deserialize<string[]>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static JsonElement? ParseJsonElement(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}