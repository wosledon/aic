using System.Text.Json;
using AIControl.Domain;
using AIControl.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace AIControl.Infrastructure.Catalog;

public sealed record ImportChannelInput(Guid? Id, string? Name, string? BaseUrl, string? ApiKey, string? Protocol, string? HeadersJson);

public sealed record ImportPublicModelsRequest(
    string ProviderKey,
    List<string> ModelKeys,
    ImportChannelInput Channel,
    bool Publish = true,
    string? AliasPrefix = null);

public sealed record ImportPublicModelsResult(Guid ChannelId, List<Guid> PublicModelIds, List<string> Skipped, string? Warning = null);

public sealed class CatalogImportService(AppDbContext db, SecretProtector protector)
{
    public async Task<ImportPublicModelsResult> ImportAsync(ImportPublicModelsRequest request, CancellationToken cancellationToken)
    {
        var snapshot = await db.CatalogSnapshots
            .Where(x => x.Source == "models.dev" && x.Status == CatalogSnapshotStatus.Active)
            .OrderByDescending(x => x.FetchedAt)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new InvalidOperationException("尚未同步 models.dev 目录");

        var provider = await db.ProviderTemplates
            .FirstOrDefaultAsync(x => x.SnapshotId == snapshot.Id && x.ProviderKey == request.ProviderKey, cancellationToken)
            ?? throw new InvalidOperationException($"供应商模板不存在: {request.ProviderKey}");

        ApiProtocol protocol;
        Channel channel;
        if (request.Channel.Id is { } channelId)
        {
            channel = await db.Channels.FirstOrDefaultAsync(x => x.Id == channelId, cancellationToken)
                ?? throw new InvalidOperationException("渠道不存在");
            protocol = channel.Protocol;
            if (!string.IsNullOrWhiteSpace(request.Channel.BaseUrl))
            {
                channel.BaseUrlCipher = protector.Protect(request.Channel.BaseUrl.Trim());
            }
            if (!string.IsNullOrWhiteSpace(request.Channel.ApiKey))
            {
                channel.ApiKeyCipher = protector.Protect(request.Channel.ApiKey.Trim());
            }
            if (!string.IsNullOrWhiteSpace(request.Channel.HeadersJson))
            {
                channel.HeadersCipher = protector.Protect(request.Channel.HeadersJson);
            }
        }
        else
        {
            protocol = ApiProtocols.Parse(request.Channel.Protocol ?? provider.ProtocolSuggestion);
            if (protocol == ApiProtocol.Unknown)
            {
                throw new InvalidOperationException("无法确定协议：请为供应商选择协议后再发布");
            }

            var baseUrl = request.Channel.BaseUrl?.Trim();
            if (string.IsNullOrWhiteSpace(baseUrl))
            {
                baseUrl = protector.Unprotect(provider.BaseUrlCipher);
            }
            if (string.IsNullOrWhiteSpace(baseUrl))
            {
                baseUrl = protocol.DefaultBaseUrl();
            }

            channel = new Channel
            {
                Name = string.IsNullOrWhiteSpace(request.Channel.Name) ? $"{provider.Name} 主渠道" : request.Channel.Name.Trim(),
                ProviderTemplateId = provider.Id,
                ProviderKey = provider.ProviderKey,
                Protocol = protocol,
                BaseUrlCipher = protector.Protect(baseUrl),
                ApiKeyCipher = protector.Protect(request.Channel.ApiKey?.Trim() ?? string.Empty),
                HeadersCipher = string.IsNullOrWhiteSpace(request.Channel.HeadersJson)
                    ? null
                    : protector.Protect(request.Channel.HeadersJson),
                Status = ChannelStatus.Enabled
            };
            db.Channels.Add(channel);
        }

        var templates = await db.ModelTemplates
            .Where(x => x.SnapshotId == snapshot.Id && x.ProviderTemplateId == provider.Id && request.ModelKeys.Contains(x.ModelKey))
            .ToListAsync(cancellationToken);
        var byKey = templates.ToDictionary(x => x.ModelKey, StringComparer.Ordinal);
        var skipped = request.ModelKeys.Where(x => !byKey.ContainsKey(x)).ToList();
        var publicModelIds = new List<Guid>();
        var usedAliases = await db.PublicModels.Select(x => x.Alias).ToListAsync(cancellationToken);
        var aliasSet = new HashSet<string>(usedAliases, StringComparer.OrdinalIgnoreCase);

        foreach (var modelKey in request.ModelKeys)
        {
            if (!byKey.TryGetValue(modelKey, out var template))
            {
                continue;
            }

            var channelModel = await db.ChannelModels
                .FirstOrDefaultAsync(x => x.ChannelId == channel.Id && x.UpstreamModel == template.ModelKey, cancellationToken);
            if (channelModel is null)
            {
                channelModel = new ChannelModel
                {
                    ChannelId = channel.Id,
                    UpstreamModel = template.ModelKey,
                    CapabilitiesJson = CatalogMapper.BuildCapabilitiesJson(template.ModalitiesJson, true, template.Reasoning),
                    Enabled = true
                };
                db.ChannelModels.Add(channelModel);
            }

            var alias = BuildAlias(template, request.AliasPrefix, aliasSet);
            var capabilities = CatalogMapper.BuildCapabilitiesJson(
                template.ModalitiesJson,
                ReadBool(template.RawJson, "tool_call"),
                template.Reasoning);

            var publicModel = new PublicModel
            {
                Alias = alias,
                DisplayName = template.Name,
                Protocol = protocol,
                ModelTemplateId = template.Id,
                CatalogSnapshotId = snapshot.Id,
                ChannelModelId = channelModel.Id,
                CapabilitiesJson = capabilities,
                ContextWindow = template.ContextLimit,
                MaxTokens = template.OutputLimit,
                Reasoning = template.Reasoning,
                ReasoningOptionsJson = template.ReasoningOptionsJson,
                ThinkingLevelMapJson = CatalogMapper.BuildThinkingLevelMap(template.ReasoningOptionsJson),
                Status = request.Publish ? PublicModelStatus.Enabled : PublicModelStatus.Disabled
            };
            db.PublicModels.Add(publicModel);
            publicModelIds.Add(publicModel.Id);
            usedAliases.Add(alias);
        }

        await db.SaveChangesAsync(cancellationToken);
        return new ImportPublicModelsResult(
            channel.Id,
            publicModelIds,
            skipped,
            protocol == ApiProtocol.Unknown ? "协议未确定，模型已保存为停用" : null);
    }

    private static string BuildAlias(ModelTemplate template, string? prefix, HashSet<string> used)
    {
        var source = template.CanonicalModelId ?? template.ModelKey;
        if (!string.IsNullOrWhiteSpace(prefix))
        {
            source = prefix.Trim() + "-" + source;
        }

        var alias = Sanitize(source);
        if (string.IsNullOrWhiteSpace(alias))
        {
            alias = "model";
        }

        var candidate = alias;
        var index = 2;
        while (used.Contains(candidate))
        {
            candidate = $"{alias}-{index++}";
        }
        return candidate;
    }

    private static string Sanitize(string value)
    {
        Span<char> buffer = stackalloc char[value.Length];
        var length = 0;
        foreach (var ch in value.ToLowerInvariant())
        {
            if (char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_' or '.')
            {
                buffer[length++] = ch;
            }
            else if (ch is '/' or ':' or ' ' or '@')
            {
                if (length > 0 && buffer[length - 1] != '-')
                {
                    buffer[length++] = '-';
                }
            }
        }
        return new string(buffer[..length]).Trim('-', '.', '_');
    }

    private static bool ReadBool(string json, string property)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.True;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}