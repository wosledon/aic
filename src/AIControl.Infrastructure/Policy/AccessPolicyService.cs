using System.Text.Json;
using AIControl.Domain;
using AIControl.Infrastructure.Analytics;
using Microsoft.EntityFrameworkCore;

namespace AIControl.Infrastructure.Policy;

public sealed record PolicyCheckResult(bool Allowed, string? Code = null, string? Message = null);

public sealed record ApprovalPolicySnapshot(string Version, JsonElement Rules, string NoUi);

public sealed class AccessPolicyService(AppDbContext db)
{
    public async Task<PolicyCheckResult> CheckModelAccessAsync(Guid userId, Guid? projectId, string modelAlias, CancellationToken cancellationToken)
    {
        var policies = await db.Policies.AsNoTracking()
            .Where(x => x.Type == PolicyType.ModelWhitelist && x.Enabled &&
                        (x.ScopeType == ScopeType.Global ||
                         (x.ScopeType == ScopeType.User && x.ScopeId == userId.ToString()) ||
                         (x.ScopeType == ScopeType.Project && projectId != null && x.ScopeId == projectId.ToString())))
            .ToListAsync(cancellationToken);

        foreach (var policy in policies)
        {
            if (!AllowsModel(policy.ConfigJson, modelAlias))
            {
                return new PolicyCheckResult(false, "model_not_allowed", "模型不在允许范围内，请联系管理员。");
            }
        }
        return new PolicyCheckResult(true);
    }

    public async Task<PolicyCheckResult> CheckQuotaAsync(Guid userId, CancellationToken cancellationToken)
    {
        var quotas = await db.Quotas.AsNoTracking()
            .Where(x => x.ScopeType == ScopeType.User && x.ScopeId == userId.ToString() && x.Enabled && x.Action == QuotaAction.Block)
            .ToListAsync(cancellationToken);
        if (quotas.Count == 0)
        {
            return new PolicyCheckResult(true);
        }

        var now = DateTime.UtcNow;
        foreach (var quota in quotas)
        {
            var (from, to) = AnalyticsService.PeriodRange(quota.Period, now);
            var events = await db.UsageEvents.AsNoTracking()
                .Where(x => x.UserId == userId && x.OccurredAt >= from && x.OccurredAt < to)
                .Select(x => x.TotalTokens)
                .ToListAsync(cancellationToken);
            if (quota.TokenLimit > 0 && events.Sum() >= quota.TokenLimit)
            {
                return new PolicyCheckResult(false, "quota_exceeded", quota.Period == QuotaPeriod.Day
                    ? "今日 token 配额已用完，请联系管理员。"
                    : "本月 token 配额已用完，请联系管理员。");
            }
            if (quota.RequestLimit > 0 && events.Count >= quota.RequestLimit)
            {
                return new PolicyCheckResult(false, "quota_exceeded", "请求配额已用完，请联系管理员。");
            }
        }
        return new PolicyCheckResult(true);
    }

    public async Task<ApprovalPolicySnapshot> GetApprovalPolicyAsync(CancellationToken cancellationToken)
    {
        var policy = await db.Policies.AsNoTracking()
            .Where(x => x.Type == PolicyType.Approval && x.Enabled && x.ScopeType == ScopeType.Global)
            .OrderByDescending(x => x.Version)
            .FirstOrDefaultAsync(cancellationToken);
        if (policy is null)
        {
            using var doc = JsonDocument.Parse(Catalog.CatalogMapper.DefaultApprovalPolicyJson());
            return new ApprovalPolicySnapshot("1", doc.RootElement.Clone(), "deny");
        }

        try
        {
            using var doc = JsonDocument.Parse(policy.ConfigJson);
            var rules = doc.RootElement.TryGetProperty("rules", out var r) ? r.Clone() : JsonDocument.Parse("[]").RootElement.Clone();
            var noUi = doc.RootElement.TryGetProperty("no_ui", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() ?? "deny" : "deny";
            return new ApprovalPolicySnapshot(policy.Version.ToString(), rules, noUi);
        }
        catch (JsonException)
        {
            using var doc = JsonDocument.Parse(Catalog.CatalogMapper.DefaultApprovalPolicyJson());
            return new ApprovalPolicySnapshot(policy.Version.ToString(), doc.RootElement.GetProperty("rules").Clone(), "deny");
        }
    }

    public async Task<string> GetRateLimitPolicyAsync(Guid userId, Guid? projectId, CancellationToken cancellationToken)
    {
        var policy = await db.Policies.AsNoTracking()
            .Where(x => x.Type == PolicyType.RateLimit && x.Enabled &&
                        (x.ScopeType == ScopeType.Global ||
                         (x.ScopeType == ScopeType.User && x.ScopeId == userId.ToString()) ||
                         (x.ScopeType == ScopeType.Project && projectId != null && x.ScopeId == projectId.ToString())))
            .OrderByDescending(x => x.ScopeType)
            .FirstOrDefaultAsync(cancellationToken);
        return policy?.ConfigJson ?? Catalog.CatalogMapper.DefaultRateLimitJson();
    }

    private static bool AllowsModel(string configJson, string alias)
    {
        try
        {
            using var doc = JsonDocument.Parse(configJson);
            if (doc.RootElement.TryGetProperty("all", out var all) && all.ValueKind == JsonValueKind.True)
            {
                return true;
            }
            if (doc.RootElement.TryGetProperty("models", out var models) && models.ValueKind == JsonValueKind.Array)
            {
                return models.EnumerateArray().Any(x => x.ValueKind == JsonValueKind.String &&
                    string.Equals(x.GetString(), alias, StringComparison.OrdinalIgnoreCase));
            }
        }
        catch (JsonException)
        {
        }
        return false;
    }
}