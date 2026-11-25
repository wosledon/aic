using System.Security.Cryptography;
using System.Text.Json;
using AIControl.Domain;
using AIControl.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AIControl.Infrastructure.Catalog;

public sealed class CatalogOptions
{
    public string ModelsDevApiUrl { get; set; } = "https://models.dev/api.json";
    public string? FixturePath { get; set; }
    public int TimeoutSeconds { get; set; } = 30;
    public long MaxBytes { get; set; } = 20 * 1024 * 1024;
}

public sealed record CatalogSyncResult(bool Changed, string SnapshotId, int Providers, int Models, string? Error = null);

public sealed class ModelsDevService(
    AppDbContext db,
    HttpClient http,
    SecretProtector protector,
    IOptions<CatalogOptions> options)
{
    private readonly CatalogOptions _options = options.Value;

    public async Task<CatalogSyncResult> SyncAsync(CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(_options.TimeoutSeconds));

        byte[] bytes;
        try
        {
            using var response = await http.GetAsync(_options.ModelsDevApiUrl, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is > 0 and var length && length > _options.MaxBytes)
            {
                return await RecordFailureAsync("models.dev 响应超过大小限制", cancellationToken);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await stream.ReadAsync(chunk, timeout.Token)) > 0)
            {
                if (buffer.Length + read > _options.MaxBytes)
                {
                    return await RecordFailureAsync("models.dev 响应超过大小限制", cancellationToken);
                }
                await buffer.WriteAsync(chunk.AsMemory(0, read), timeout.Token);
            }
            bytes = buffer.ToArray();
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return await RecordFailureAsync("models.dev 拉取失败: " + ex.GetType().Name, cancellationToken);
        }

        return await ApplySnapshotAsync(bytes, cancellationToken);
    }

    public async Task<CatalogSyncResult> ImportLocalFixtureAsync(string path, CancellationToken cancellationToken)
    {
        if (!File.Exists(path))
        {
            return new CatalogSyncResult(false, string.Empty, 0, 0, "fixture 不存在");
        }

        var bytes = await File.ReadAllBytesAsync(path, cancellationToken);
        return await ApplySnapshotAsync(bytes, cancellationToken);
    }

    public async Task<CatalogSyncResult> ApplySnapshotAsync(byte[] bytes, CancellationToken cancellationToken)
    {
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var latest = await db.CatalogSnapshots
            .Where(x => x.Source == "models.dev" && x.Status == CatalogSnapshotStatus.Active)
            .OrderByDescending(x => x.FetchedAt)
            .FirstOrDefaultAsync(cancellationToken);
        if (latest is not null && latest.ContentHash == hash)
        {
            return new CatalogSyncResult(false, latest.Id, 0, 0);
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(bytes);
        }
        catch (JsonException ex)
        {
            return await RecordFailureAsync("JSON Schema 校验失败: " + ex.Message, cancellationToken);
        }

        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return await RecordFailureAsync("models.dev 根节点不是对象", cancellationToken);
            }

            var snapshotId = $"mds_{DateTime.UtcNow:yyyyMMddHHmmss}_{hash[..8]}";
            var snapshot = new CatalogSnapshot
            {
                Id = snapshotId,
                Source = "models.dev",
                FetchedAt = DateTime.UtcNow,
                ContentHash = hash,
                SchemaVersion = "1",
                RawJson = System.Text.Encoding.UTF8.GetString(bytes),
                Status = CatalogSnapshotStatus.Active
            };

            var templates = new List<ProviderTemplate>();
            var modelTemplates = new List<ModelTemplate>();
            foreach (var providerProperty in document.RootElement.EnumerateObject())
            {
                var provider = providerProperty.Value;
                if (provider.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                var providerId = GetString(provider, "id") ?? providerProperty.Name;
                var npm = GetString(provider, "npm");
                var api = GetString(provider, "api");
                var docUrl = GetString(provider, "doc");
                var envNames = provider.TryGetProperty("env", out var env) && env.ValueKind == JsonValueKind.Array
                    ? env.EnumerateArray().Select(x => x.GetString()).Where(x => x is not null).ToArray()
                    : [];

                var providerTemplate = new ProviderTemplate
                {
                    SnapshotId = snapshotId,
                    ProviderKey = providerId,
                    Name = GetString(provider, "name") ?? providerId,
                    Npm = npm,
                    ProtocolSuggestion = CatalogMapper.SuggestProtocol(npm),
                    BaseUrlCipher = string.IsNullOrWhiteSpace(api) ? null : protector.Protect(api),
                    DocUrl = docUrl,
                    EnvNamesJson = JsonSerializer.Serialize(envNames),
                    RawJson = JsonSerializer.Serialize(new { id = providerId, name = GetString(provider, "name") ?? providerId, npm, api, doc = docUrl, env = envNames })
                };
                templates.Add(providerTemplate);

                if (!provider.TryGetProperty("models", out var models) || models.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                foreach (var modelProperty in models.EnumerateObject())
                {
                    var model = modelProperty.Value;
                    if (model.ValueKind != JsonValueKind.Object)
                    {
                        continue;
                    }

                    var type = GetString(model, "type");
                    if (!string.IsNullOrEmpty(type) && !string.Equals(type, "chat", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    long context = 0, output = 0;
                    if (model.TryGetProperty("limit", out var limit) && limit.ValueKind == JsonValueKind.Object)
                    {
                        TryLong(limit, "context", out context);
                        TryLong(limit, "output", out output);
                    }

                    var reasoning = model.TryGetProperty("reasoning", out var reasoningEl) && reasoningEl.ValueKind == JsonValueKind.True;
                    var reasoningOptions = model.TryGetProperty("reasoning_options", out var ro) && ro.ValueKind == JsonValueKind.Array
                        ? ro.GetRawText()
                        : null;
                    var modalities = model.TryGetProperty("modalities", out var mod) && mod.ValueKind == JsonValueKind.Object
                        ? mod.GetRawText()
                        : null;

                    modelTemplates.Add(new ModelTemplate
                    {
                        SnapshotId = snapshotId,
                        ProviderTemplateId = providerTemplate.Id,
                        ModelKey = GetString(model, "id") ?? modelProperty.Name,
                        CanonicalModelId = GetString(model, "canonical_model_id"),
                        Name = GetString(model, "name") ?? modelProperty.Name,
                        Family = GetString(model, "family"),
                        Description = GetString(model, "description"),
                        ModalitiesJson = modalities,
                        ContextLimit = context,
                        OutputLimit = output,
                        Reasoning = reasoning,
                        ReasoningOptionsJson = reasoningOptions,
                        Status = GetString(model, "status"),
                        ReleaseDate = GetString(model, "release_date"),
                        RawJson = model.GetRawText()
                    });
                }
            }

            if (templates.Count == 0)
            {
                return await RecordFailureAsync("models.dev 未解析到供应商", cancellationToken);
            }

            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            db.CatalogSnapshots.Add(snapshot);
            db.ProviderTemplates.AddRange(templates);
            db.ModelTemplates.AddRange(modelTemplates);
            await db.SaveChangesAsync(cancellationToken);
            await PropagateToImportedModelsAsync(templates, modelTemplates, snapshotId, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return new CatalogSyncResult(true, snapshotId, templates.Count, modelTemplates.Count);
        }
    }

    /// <summary>Imported public models follow the latest successful snapshot automatically.</summary>
    private async Task PropagateToImportedModelsAsync(
        List<ProviderTemplate> newProviders,
        List<ModelTemplate> newModels,
        string snapshotId,
        CancellationToken cancellationToken)
    {
        var imported = await db.PublicModels.Where(x => x.ModelTemplateId != null).ToListAsync(cancellationToken);
        if (imported.Count == 0)
        {
            return;
        }

        var oldTemplateIds = imported.Select(x => x.ModelTemplateId!.Value).Distinct().ToList();
        var oldTemplates = await db.ModelTemplates.Where(x => oldTemplateIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, cancellationToken);
        var oldProviderIds = oldTemplates.Values.Select(x => x.ProviderTemplateId).Distinct().ToList();
        var oldProviders = await db.ProviderTemplates.Where(x => oldProviderIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, cancellationToken);
        var newProvidersByKey = newProviders.ToDictionary(x => x.ProviderKey, x => x, StringComparer.OrdinalIgnoreCase);
        var newModelsByKey = newModels
            .GroupBy(x => x.ProviderTemplateId + "|" + x.ModelKey)
            .ToDictionary(g => g.Key, g => g.First());

        foreach (var model in imported)
        {
            if (model.ModelTemplateId is not { } templateId
                || !oldTemplates.TryGetValue(templateId, out var oldTemplate)
                || !oldProviders.TryGetValue(oldTemplate.ProviderTemplateId, out var oldProvider)
                || !newProvidersByKey.TryGetValue(oldProvider.ProviderKey, out var newProvider))
            {
                continue;
            }

            if (!newModelsByKey.TryGetValue(newProvider.Id + "|" + oldTemplate.ModelKey, out var fresh))
            {
                continue;
            }

            model.ModelTemplateId = fresh.Id;
            model.CatalogSnapshotId = snapshotId;
            model.ContextWindow = fresh.ContextLimit;
            model.MaxTokens = fresh.OutputLimit;
            model.Reasoning = fresh.Reasoning;
            model.ReasoningOptionsJson = fresh.ReasoningOptionsJson;
            model.ThinkingLevelMapJson = CatalogMapper.BuildThinkingLevelMap(fresh.ReasoningOptionsJson);
            model.CapabilitiesJson = CatalogMapper.BuildCapabilitiesJson(fresh.ModalitiesJson, HasToolCall(fresh.RawJson), fresh.Reasoning);
        }
    }

    private static bool HasToolCall(string rawJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(rawJson);
            return doc.RootElement.TryGetProperty("tool_call", out var value) && value.ValueKind == JsonValueKind.True;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private async Task<CatalogSyncResult> RecordFailureAsync(string error, CancellationToken cancellationToken)
    {
        db.CatalogSnapshots.Add(new CatalogSnapshot
        {
            Id = $"mds_failed_{DateTime.UtcNow:yyyyMMddHHmmssfff}",
            Source = "models.dev",
            FetchedAt = DateTime.UtcNow,
            ContentHash = string.Empty,
            Status = CatalogSnapshotStatus.Failed,
            Error = error,
            RawJson = "{}"
        });
        await db.SaveChangesAsync(cancellationToken);
        return new CatalogSyncResult(false, string.Empty, 0, 0, error);
    }

    private static string? GetString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static bool TryLong(JsonElement element, string property, out long value)
    {
        value = 0;
        return element.TryGetProperty(property, out var el)
            && el.ValueKind == JsonValueKind.Number
            && el.TryGetInt64(out value);
    }
}