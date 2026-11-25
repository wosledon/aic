using System.Text;
using AIControl.Domain;
using Microsoft.EntityFrameworkCore;

namespace AIControl.Infrastructure.Analytics;

public sealed record AnalyticsRange(DateTime From, DateTime To);

public sealed record OverviewSummary(
    int ActiveUsers,
    int Requests,
    int SuccessRequests,
    long TotalTokens,
    long InputTokens,
    long OutputTokens,
    long CacheReadTokens,
    long CacheWriteTokens,
    double ErrorRate,
    int Approved,
    int Rejected,
    int PolicyDenied,
    int AutoAllowed,
    double ApprovalRate,
    int Sessions,
    int Turns,
    int ToolCalls);

public sealed record TrendPoint(DateTime Day, long Tokens, int Requests, int ActiveUsers);
public sealed record ModelShare(string ModelAlias, long Tokens, int Requests, double Share);
public sealed record ProjectShare(Guid? ProjectId, string ProjectKey, string ProjectName, long Tokens, int Requests);
public sealed record UserShare(Guid UserId, string UserName, long Tokens, int Requests);
public sealed record AnomalyItem(string Kind, string Message, int Count, DateTime LastOccurredAt);

public sealed record OverviewResponse(
    DateTime From,
    DateTime To,
    OverviewSummary Summary,
    List<TrendPoint> Trend,
    List<ModelShare> Models,
    List<ProjectShare> Projects,
    List<UserShare> Users,
    List<AnomalyItem> Anomalies,
    DateTime GeneratedAt);

public sealed record UsageQuery(
    DateTime From,
    DateTime To,
    List<string> GroupBy,
    Guid? ProjectId = null,
    Guid? UserId = null,
    Guid? ModelId = null,
    int Limit = 5000);

public sealed record UsageRow(
    string GroupKey,
    DateTime? Day,
    Guid? ProjectId,
    string? ProjectKey,
    string? ProjectName,
    Guid? UserId,
    string? UserName,
    Guid? ModelId,
    string? ModelAlias,
    string? Protocol,
    string? DeviceId,
    int Requests,
    int Errors,
    long TotalTokens,
    long InputTokens,
    long OutputTokens,
    long CacheReadTokens,
    long CacheWriteTokens,
    double AvgLatencyMs,
    int P95LatencyMs);

public sealed record ApprovalSummary(
    int Total,
    int Approved,
    int Rejected,
    int PolicyDenied,
    int AutoAllowed,
    double ApprovalRate,
    double LatencyP50,
    double LatencyP95);

public sealed record ApprovalToolRow(string ToolName, string Risk, int Approved, int Rejected, int PolicyDenied, int AutoAllowed);
public sealed record ApprovalTrendPoint(DateTime Day, int Approved, int Rejected, int PolicyDenied, int AutoAllowed);
public sealed record ApprovalUserRow(
    Guid UserId,
    string UserName,
    int Approved,
    int Rejected,
    int PolicyDenied,
    int AutoAllowed,
    double ApprovalRate,
    double LatencyP95);

public sealed record ApprovalsResponse(
    DateTime From,
    DateTime To,
    ApprovalSummary Summary,
    List<ApprovalToolRow> Tools,
    List<ApprovalTrendPoint> Trend,
    List<RiskRow> Risks,
    List<ApprovalUserRow> Users);

public sealed record RiskRow(string Risk, int Approved, int Rejected, int PolicyDenied);

public sealed record SessionRow(
    Guid Id,
    string SessionId,
    Guid UserId,
    string UserName,
    string? ProjectKey,
    string? ProjectName,
    string Client,
    string? RepoDisplay,
    string? CwdBasename,
    DateTime StartedAt,
    DateTime? EndedAt,
    long TurnCount,
    long ToolCallCount,
    long Tokens,
    string Status);

public sealed record MeUsageWindow(string Label, DateTime From, DateTime To, int Requests, long TotalTokens, long InputTokens, long OutputTokens, long CacheReadTokens, long CacheWriteTokens);

public sealed record QuotaStatusRow(string Scope, string Period, long TokenLimit, long RequestLimit, long UsedTokens, long UsedRequests, double TokenPercent, string Action);

public sealed record MeModelUsage(string ModelAlias, long Tokens, int Requests);

public sealed record MeUsageResponse(
    Guid UserId,
    string UserName,
    List<MeUsageWindow> Windows,
    List<QuotaStatusRow> Quotas,
    List<MeModelUsage> Models,
    DateTime GeneratedAt);

/// <summary>Read-only analytics over gateway usage events and plugin telemetry.</summary>
public sealed class AnalyticsService(AppDbContext db)
{
    public async Task<OverviewResponse> GetOverviewAsync(DateTime from, DateTime to, Guid? projectId, CancellationToken cancellationToken)
    {
        var events = db.UsageEvents.AsNoTracking().Where(x => x.OccurredAt >= from && x.OccurredAt < to);
        if (projectId is not null)
        {
            events = events.Where(x => x.ProjectId == projectId);
        }

        var eventList = await events.ToListAsync(cancellationToken);
        var decisions = db.ToolDecisions.AsNoTracking().Where(x => x.OccurredAt >= from && x.OccurredAt < to);
        if (projectId is not null)
        {
            decisions = decisions.Where(x => x.ProjectId == projectId);
        }
        var decisionList = await decisions.ToListAsync(cancellationToken);

        var sessionsQuery = db.AgentSessions.AsNoTracking().Where(x => x.StartedAt >= from && x.StartedAt < to);
        if (projectId is not null)
        {
            sessionsQuery = sessionsQuery.Where(x => x.ProjectId == projectId);
        }
        var sessionCount = await sessionsQuery.CountAsync(cancellationToken);
        var turnCount = eventList.Count;
        var toolCalls = decisionList.Count;

        var approved = decisionList.Count(x => x.Action == ToolAction.Approved && x.Source == DecisionSource.User);
        var rejected = decisionList.Count(x => x.Action == ToolAction.Rejected && x.Source == DecisionSource.User);
        var policyDenied = decisionList.Count(x => x.Action == ToolAction.PolicyDenied);
        var autoAllowed = decisionList.Count(x => x.Action == ToolAction.AutoAllowed);
        var userDecisions = approved + rejected;

        var totalTokens = eventList.Sum(x => x.TotalTokens);
        var summary = new OverviewSummary(
            eventList.Select(x => x.UserId).Distinct().Count(),
            eventList.Count,
            eventList.Count(x => x.StatusCode is >= 200 and < 300 && x.ErrorCode is null),
            totalTokens,
            eventList.Sum(x => x.InputTokens),
            eventList.Sum(x => x.OutputTokens),
            eventList.Sum(x => x.CacheReadTokens),
            eventList.Sum(x => x.CacheWriteTokens),
            eventList.Count == 0 ? 0 : Math.Round(eventList.Count(x => x.StatusCode >= 400 || x.ErrorCode != null) * 100.0 / eventList.Count, 2),
            approved,
            rejected,
            policyDenied,
            autoAllowed,
            userDecisions == 0 ? 0 : Math.Round(approved * 100.0 / userDecisions, 2),
            sessionCount,
            turnCount,
            toolCalls);

        var trend = BuildTrend(from, to, eventList);
        var modelGroups = eventList.GroupBy(x => x.PublicModelAlias)
            .Select(g => new ModelShare(
                g.Key,
                g.Sum(x => x.TotalTokens),
                g.Count(),
                totalTokens == 0 ? 0 : Math.Round(g.Sum(x => x.TotalTokens) * 100.0 / totalTokens, 2)))
            .OrderByDescending(x => x.Tokens)
            .Take(10)
            .ToList();

        var projectIds = eventList.Where(x => x.ProjectId != null).Select(x => x.ProjectId!.Value).Distinct().ToList();
        var projects = await db.Projects.AsNoTracking().Where(x => projectIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, cancellationToken);
        var projectGroups = eventList.GroupBy(x => x.ProjectId)
            .Select(g =>
            {
                var id = g.Key;
                var name = id is not null && projects.TryGetValue(id.Value, out var p) ? p.Name : "未归因";
                var key = id is not null && projects.TryGetValue(id.Value, out var p2) ? p2.Key : "unattributed";
                return new ProjectShare(id, key, name, g.Sum(x => x.TotalTokens), g.Count());
            })
            .OrderByDescending(x => x.Tokens)
            .Take(10)
            .ToList();

        var userIds = eventList.Select(x => x.UserId).Distinct().ToList();
        var users = await db.Users.AsNoTracking().Where(x => userIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, cancellationToken);
        var userGroups = eventList.GroupBy(x => x.UserId)
            .Select(g => new UserShare(g.Key, users.TryGetValue(g.Key, out var u) ? u.Name : g.Key.ToString(), g.Sum(x => x.TotalTokens), g.Count()))
            .OrderByDescending(x => x.Tokens)
            .Take(10)
            .ToList();

        var anomalies = eventList.Where(x => x.ErrorCode != null)
            .GroupBy(x => x.ErrorCode!)
            .Select(g => new AnomalyItem("gateway_error", g.Key, g.Count(), g.Max(x => x.OccurredAt)))
            .OrderByDescending(x => x.Count)
            .Take(5)
            .ToList();
        if (policyDenied > 0)
        {
            anomalies.Add(new AnomalyItem("approval", "策略拒绝/无 UI 拒绝", policyDenied, decisionList.Where(x => x.Action == ToolAction.PolicyDenied).Max(x => x.OccurredAt)));
        }

        return new OverviewResponse(from, to, summary, trend, modelGroups, projectGroups, userGroups, anomalies, DateTime.UtcNow);
    }

    private static List<TrendPoint> BuildTrend(DateTime from, DateTime to, List<UsageEvent> events)
    {
        var start = from.Date;
        var end = to.Date;
        if ((end - start).TotalDays > 370)
        {
            end = start.AddDays(370);
        }

        var byDay = events.GroupBy(x => x.OccurredAt.Date)
            .ToDictionary(g => g.Key, g => new
            {
                Tokens = g.Sum(x => x.TotalTokens),
                Requests = g.Count(),
                Users = g.Select(x => x.UserId).Distinct().Count()
            });

        var points = new List<TrendPoint>();
        for (var day = start; day <= end; day = day.AddDays(1))
        {
            byDay.TryGetValue(day, out var value);
            points.Add(new TrendPoint(day, value?.Tokens ?? 0, value?.Requests ?? 0, value?.Users ?? 0));
        }
        return points;
    }

    public async Task<List<UsageRow>> QueryUsageAsync(UsageQuery query, CancellationToken cancellationToken)
    {
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "project", "user", "model", "protocol", "device", "day", "status" };
        var groupBy = query.GroupBy.Where(allowed.Contains).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (groupBy.Count == 0)
        {
            groupBy.Add("project");
            groupBy.Add("model");
        }

        var eventsQuery = db.UsageEvents.AsNoTracking().Where(x => x.OccurredAt >= query.From && x.OccurredAt < query.To);
        if (query.ProjectId is not null) eventsQuery = eventsQuery.Where(x => x.ProjectId == query.ProjectId);
        if (query.UserId is not null) eventsQuery = eventsQuery.Where(x => x.UserId == query.UserId);
        if (query.ModelId is not null) eventsQuery = eventsQuery.Where(x => x.PublicModelId == query.ModelId);
        var events = await eventsQuery.OrderBy(x => x.OccurredAt).Take(Math.Min(query.Limit * 10, 100_000)).ToListAsync(cancellationToken);

        var projects = await db.Projects.AsNoTracking().ToDictionaryAsync(x => x.Id, cancellationToken);
        var users = await db.Users.AsNoTracking().ToDictionaryAsync(x => x.Id, cancellationToken);

        var groups = events.GroupBy(e =>
        {
            var parts = new List<string>();
            foreach (var dim in groupBy)
            {
                parts.Add(dim.ToLowerInvariant() switch
                {
                    "project" => e.ProjectId?.ToString() ?? "unattributed",
                    "user" => e.UserId.ToString(),
                    "model" => e.PublicModelAlias,
                    "protocol" => e.Protocol,
                    "device" => e.DeviceId ?? "-",
                    "day" => e.OccurredAt.ToString("yyyy-MM-dd"),
                    "status" => e.StatusCode.ToString(),
                    _ => "-"
                });
            }
            return string.Join("|", parts);
        });

        var rows = new List<UsageRow>();
        foreach (var group in groups)
        {
            if (rows.Count >= query.Limit)
            {
                break;
            }

            var first = group.First();
            var latencies = group.Select(x => x.LatencyMs).OrderBy(x => x).ToList();
            rows.Add(new UsageRow(
                group.Key,
                groupBy.Any(x => x.Equals("day", StringComparison.OrdinalIgnoreCase)) ? first.OccurredAt.Date : null,
                groupBy.Any(x => x.Equals("project", StringComparison.OrdinalIgnoreCase)) ? first.ProjectId : null,
                first.ProjectId is not null && projects.TryGetValue(first.ProjectId.Value, out var p) ? p.Key : (first.ProjectId is null ? "unattributed" : null),
                first.ProjectId is not null && projects.TryGetValue(first.ProjectId.Value, out var p2) ? p2.Name : (first.ProjectId is null ? "未归因" : null),
                groupBy.Any(x => x.Equals("user", StringComparison.OrdinalIgnoreCase)) ? first.UserId : null,
                users.TryGetValue(first.UserId, out var u) ? u.Name : null,
                groupBy.Any(x => x.Equals("model", StringComparison.OrdinalIgnoreCase)) ? first.PublicModelId : null,
                groupBy.Any(x => x.Equals("model", StringComparison.OrdinalIgnoreCase)) ? first.PublicModelAlias : null,
                groupBy.Any(x => x.Equals("protocol", StringComparison.OrdinalIgnoreCase)) ? first.Protocol : null,
                groupBy.Any(x => x.Equals("device", StringComparison.OrdinalIgnoreCase)) ? first.DeviceId : null,
                group.Count(),
                group.Count(x => x.StatusCode >= 400 || x.ErrorCode != null),
                group.Sum(x => x.TotalTokens),
                group.Sum(x => x.InputTokens),
                group.Sum(x => x.OutputTokens),
                group.Sum(x => x.CacheReadTokens),
                group.Sum(x => x.CacheWriteTokens),
                Math.Round(group.Average(x => x.LatencyMs), 1),
                Percentile(latencies, 0.95)));
        }

        return rows.OrderByDescending(x => x.TotalTokens).ToList();
    }

    public async Task<ApprovalsResponse> GetApprovalsAsync(DateTime from, DateTime to, Guid? projectId, Guid? userId, CancellationToken cancellationToken)
    {
        var query = db.ToolDecisions.AsNoTracking().Where(x => x.OccurredAt >= from && x.OccurredAt < to);
        if (projectId is not null) query = query.Where(x => x.ProjectId == projectId);
        if (userId is not null) query = query.Where(x => x.UserId == userId);
        var decisions = await query.ToListAsync(cancellationToken);

        var approved = decisions.Count(x => x.Action == ToolAction.Approved && x.Source == DecisionSource.User);
        var rejected = decisions.Count(x => x.Action == ToolAction.Rejected && x.Source == DecisionSource.User);
        var policyDenied = decisions.Count(x => x.Action == ToolAction.PolicyDenied);
        var autoAllowed = decisions.Count(x => x.Action == ToolAction.AutoAllowed);
        var userDecisions = approved + rejected;
        var latencies = decisions.Where(x => x.Source == DecisionSource.User).Select(x => (double)x.LatencyMs).OrderBy(x => x).ToList();

        var summary = new ApprovalSummary(
            decisions.Count,
            approved,
            rejected,
            policyDenied,
            autoAllowed,
            userDecisions == 0 ? 0 : Math.Round(approved * 100.0 / userDecisions, 2),
            PercentileDouble(latencies, 0.5),
            PercentileDouble(latencies, 0.95));

        var tools = decisions.GroupBy(x => x.ToolName)
            .Select(g => new ApprovalToolRow(
                g.Key,
                g.First().Risk.ToString(),
                g.Count(x => x.Action == ToolAction.Approved),
                g.Count(x => x.Action == ToolAction.Rejected),
                g.Count(x => x.Action == ToolAction.PolicyDenied),
                g.Count(x => x.Action == ToolAction.AutoAllowed)))
            .OrderByDescending(x => x.Approved + x.Rejected)
            .Take(20)
            .ToList();

        var trend = new List<ApprovalTrendPoint>();
        for (var day = from.Date; day <= to.Date; day = day.AddDays(1))
        {
            var daily = decisions.Where(x => x.OccurredAt.Date == day).ToList();
            trend.Add(new ApprovalTrendPoint(
                day,
                daily.Count(x => x.Action == ToolAction.Approved),
                daily.Count(x => x.Action == ToolAction.Rejected),
                daily.Count(x => x.Action == ToolAction.PolicyDenied),
                daily.Count(x => x.Action == ToolAction.AutoAllowed)));
        }

        var risks = decisions.GroupBy(x => x.Risk.ToString())
            .Select(g => new RiskRow(
                g.Key,
                g.Count(x => x.Action == ToolAction.Approved),
                g.Count(x => x.Action == ToolAction.Rejected),
                g.Count(x => x.Action == ToolAction.PolicyDenied)))
            .OrderByDescending(x => x.Approved + x.Rejected)
            .ToList();
        var userIds = decisions.Select(x => x.UserId).Distinct().ToList();
        var users = await db.Users.AsNoTracking()
            .Where(x => userIds.Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, x => x.Name, cancellationToken);
        var userRows = decisions.GroupBy(x => x.UserId)
            .Select(g =>
            {
                var userApproved = g.Count(x => x.Action == ToolAction.Approved && x.Source == DecisionSource.User);
                var userRejected = g.Count(x => x.Action == ToolAction.Rejected && x.Source == DecisionSource.User);
                var userTotal = userApproved + userRejected;
                var userLatencies = g.Where(x => x.Source == DecisionSource.User)
                    .Select(x => (double)x.LatencyMs)
                    .OrderBy(x => x)
                    .ToList();
                return new ApprovalUserRow(
                    g.Key,
                    users.GetValueOrDefault(g.Key, g.Key.ToString()),
                    userApproved,
                    userRejected,
                    g.Count(x => x.Action == ToolAction.PolicyDenied),
                    g.Count(x => x.Action == ToolAction.AutoAllowed),
                    userTotal == 0 ? 0 : Math.Round(userApproved * 100.0 / userTotal, 2),
                    PercentileDouble(userLatencies, 0.95));
            })
            .OrderByDescending(x => x.Approved + x.Rejected)
            .ThenByDescending(x => x.PolicyDenied)
            .ToList();

        return new ApprovalsResponse(from, to, summary, tools, trend, risks, userRows);
    }

    public async Task<List<SessionRow>> GetSessionsAsync(DateTime from, DateTime to, Guid? projectId, Guid? userId, int limit, CancellationToken cancellationToken)
    {
        var query = db.AgentSessions.AsNoTracking().Where(x => x.StartedAt >= from && x.StartedAt < to);
        if (projectId is not null) query = query.Where(x => x.ProjectId == projectId);
        if (userId is not null) query = query.Where(x => x.UserId == userId);
        var sessions = await query.OrderByDescending(x => x.StartedAt).Take(Math.Clamp(limit, 1, 500)).ToListAsync(cancellationToken);
        var userIds = sessions.Select(x => x.UserId).Distinct().ToList();
        var projectIds = sessions.Where(x => x.ProjectId != null).Select(x => x.ProjectId!.Value).Distinct().ToList();
        var users = await db.Users.AsNoTracking().Where(x => userIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, cancellationToken);
        var projects = await db.Projects.AsNoTracking().Where(x => projectIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, cancellationToken);
        var sessionIds = sessions.Select(x => x.Id).ToList();
        var usage = await db.UsageEvents.AsNoTracking().Where(x => x.AgentSessionId != null && sessionIds.Contains(x.AgentSessionId.Value))
            .GroupBy(x => x.AgentSessionId!.Value)
            .Select(g => new { SessionId = g.Key, Tokens = g.Sum(x => x.TotalTokens) })
            .ToDictionaryAsync(x => x.SessionId, x => x.Tokens, cancellationToken);

        return sessions.Select(s => new SessionRow(
            s.Id,
            s.PiSessionId,
            s.UserId,
            users.TryGetValue(s.UserId, out var u) ? u.Name : "-",
            s.ProjectId is not null && projects.TryGetValue(s.ProjectId.Value, out var p) ? p.Key : null,
            s.ProjectId is not null && projects.TryGetValue(s.ProjectId.Value, out var p2) ? p2.Name : null,
            s.Client,
            s.RepoDisplay,
            s.CwdBasename,
            s.StartedAt,
            s.EndedAt,
            s.TurnCount,
            s.ToolCallCount,
            usage.GetValueOrDefault(s.Id),
            s.Status)).ToList();
    }

    public async Task<MeUsageResponse> GetMeUsageAsync(Guid userId, string userName, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var windows = new[]
        {
            ("今日", now.Date, now.Date.AddDays(1)),
            ("近 7 天", now.Date.AddDays(-6), now.Date.AddDays(1)),
            ("近 30 天", now.Date.AddDays(-29), now.Date.AddDays(1))
        };

        var meEvents = await db.UsageEvents.AsNoTracking()
            .Where(x => x.UserId == userId && x.OccurredAt >= now.Date.AddDays(-29))
            .ToListAsync(cancellationToken);

        var result = windows.Select(w =>
        {
            var slice = meEvents.Where(x => x.OccurredAt >= w.Item2 && x.OccurredAt < w.Item3).ToList();
            return new MeUsageWindow(w.Item1, w.Item2, w.Item3, slice.Count, slice.Sum(x => x.TotalTokens),
                slice.Sum(x => x.InputTokens), slice.Sum(x => x.OutputTokens), slice.Sum(x => x.CacheReadTokens), slice.Sum(x => x.CacheWriteTokens));
        }).ToList();

        var quotas = await db.Quotas.AsNoTracking()
            .Where(x => x.ScopeType == ScopeType.User && x.ScopeId == userId.ToString() && x.Enabled)
            .ToListAsync(cancellationToken);
        var quotaRows = new List<QuotaStatusRow>();
        foreach (var quota in quotas)
        {
            var (from, _) = PeriodRange(quota.Period, now);
            var used = meEvents.Where(x => x.OccurredAt >= from).ToList();
            var usedTokens = used.Sum(x => x.TotalTokens);
            quotaRows.Add(new QuotaStatusRow(
                "user",
                quota.Period.ToString(),
                quota.TokenLimit,
                quota.RequestLimit,
                usedTokens,
                used.Count,
                quota.TokenLimit == 0 ? 0 : Math.Round(usedTokens * 100.0 / quota.TokenLimit, 2),
                quota.Action.ToString()));
        }

        var models = meEvents.Where(x => x.OccurredAt >= now.Date.AddDays(-6))
            .GroupBy(x => x.PublicModelAlias)
            .Select(g => new MeModelUsage(g.Key, g.Sum(x => x.TotalTokens), g.Count()))
            .OrderByDescending(x => x.Tokens)
            .ToList();

        return new MeUsageResponse(userId, userName, result, quotaRows, models, DateTime.UtcNow);
    }

    public static (DateTime From, DateTime To) PeriodRange(QuotaPeriod period, DateTime now) => period switch
    {
        QuotaPeriod.Day => (now.Date, now.Date.AddDays(1)),
        _ => (new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc), new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1))
    };

    public static int Percentile(List<int> sorted, double percentile)
    {
        if (sorted.Count == 0) return 0;
        var index = (int)Math.Ceiling(sorted.Count * percentile) - 1;
        return sorted[Math.Clamp(index, 0, sorted.Count - 1)];
    }

    private static double PercentileDouble(List<double> sorted, double percentile)
    {
        if (sorted.Count == 0) return 0;
        var index = (int)Math.Ceiling(sorted.Count * percentile) - 1;
        return Math.Round(sorted[Math.Clamp(index, 0, sorted.Count - 1)], 1);
    }

    public static string BuildUsageCsv(List<UsageRow> rows)
    {
        var sb = new StringBuilder();
        sb.AppendLine("day,project_key,project_name,user_name,model,protocol,device,requests,errors,total_tokens,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,avg_latency_ms,p95_latency_ms");
        foreach (var row in rows)
        {
            sb.AppendLine(string.Join(',',
                row.Day?.ToString("yyyy-MM-dd") ?? string.Empty,
                Escape(row.ProjectKey),
                Escape(row.ProjectName),
                Escape(row.UserName),
                Escape(row.ModelAlias),
                Escape(row.Protocol),
                Escape(row.DeviceId),
                row.Requests,
                row.Errors,
                row.TotalTokens,
                row.InputTokens,
                row.OutputTokens,
                row.CacheReadTokens,
                row.CacheWriteTokens,
                row.AvgLatencyMs,
                row.P95LatencyMs));
        }
        return sb.ToString();
    }

    private static string Escape(string? value)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;
        return value.Contains(',') || value.Contains('"') ? '"' + value.Replace("\"", "\"\"") + '"' : value;
    }
}