using System.Text.Json;
using System.Threading.Channels;
using AIControl.Domain;
using Microsoft.EntityFrameworkCore;

namespace AIControl.Infrastructure.Telemetry;

public sealed record TelemetryEventInput(
    string EventId,
    string Type,
    DateTime OccurredAt,
    string? SessionId,
    string? ProjectKey,
    JsonElement Payload);

public sealed record TelemetryBatchInput(
    string BatchId,
    string DeviceId,
    string? PluginVersion,
    List<TelemetryEventInput> Events);

public sealed record TelemetryIngestResult(int Accepted, int Duplicates);

public sealed class TelemetryService(AppDbContext db)
{
    public async Task<TelemetryIngestResult> IngestAsync(Guid userId, string deviceId, TelemetryBatchInput batch, CancellationToken cancellationToken)
    {
        if (await db.TelemetryBatches.AnyAsync(x => x.DeviceId == deviceId && x.BatchId == batch.BatchId, cancellationToken))
        {
            return new TelemetryIngestResult(0, batch.Events.Count);
        }

        var duplicateIds = await db.TelemetryEvents
            .Where(x => batch.Events.Select(e => e.EventId).Contains(x.EventId))
            .Select(x => x.EventId)
            .ToListAsync(cancellationToken);
        var duplicateSet = duplicateIds.ToHashSet(StringComparer.Ordinal);

        var resolvedProjects = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        async Task<Guid?> ResolveProjectAsync(string? projectKey, string? projectName)
        {
            var key = AIControl.Infrastructure.Projects.ProjectRegistry.NormalizeKey(projectKey);
            if (key is null)
            {
                return null;
            }
            if (resolvedProjects.TryGetValue(key, out var cached))
            {
                return cached;
            }

            var project = await AIControl.Infrastructure.Projects.ProjectRegistry.EnsureAsync(
                db, key, projectName, userId, "telemetry", cancellationToken);
            resolvedProjects[key] = project.Id;
            return project.Id;
        }

        AgentSession? FindSession(string? sessionId) => string.IsNullOrWhiteSpace(sessionId)
            ? null
            : db.AgentSessions.Local.FirstOrDefault(x => x.PiSessionId == sessionId && x.UserId == userId)
              ?? db.AgentSessions.FirstOrDefault(x => x.PiSessionId == sessionId && x.UserId == userId);

        var accepted = 0;
        var duplicates = 0;
        foreach (var evt in batch.Events)
        {
            if (duplicateSet.Contains(evt.EventId))
            {
                duplicates++;
                continue;
            }

            var projectId = await ResolveProjectAsync(evt.ProjectKey, GetString(evt.Payload, "project_name"));
            db.TelemetryEvents.Add(new TelemetryEvent
            {
                EventId = evt.EventId,
                BatchId = batch.BatchId,
                Type = evt.Type,
                SessionId = evt.SessionId,
                ProjectKey = evt.ProjectKey,
                PayloadJson = evt.Payload.ValueKind == JsonValueKind.Undefined ? "{}" : evt.Payload.GetRawText(),
                OccurredAt = evt.OccurredAt,
                ReceivedAt = DateTime.UtcNow
            });

            switch (evt.Type)
            {
                case "session_started":
                    {
                        var session = FindSession(evt.SessionId);
                        if (session is null)
                        {
                            session = new AgentSession
                            {
                                UserId = userId,
                                ProjectId = projectId,
                                PiSessionId = evt.SessionId ?? $"unknown-{evt.EventId}",
                                Client = GetString(evt.Payload, "client") ?? "pi",
                                CwdBasename = GetString(evt.Payload, "cwd_basename"),
                                RepoHash = GetString(evt.Payload, "repo_hash"),
                                RepoDisplay = GetString(evt.Payload, "repo_display"),
                                PluginVersion = batch.PluginVersion,
                                StartedAt = evt.OccurredAt,
                                Status = "active"
                            };
                            db.AgentSessions.Add(session);
                        }
                        else
                        {
                            session.ProjectId = projectId ?? session.ProjectId;
                            session.Status = "active";
                        }

                        var repoHash = GetString(evt.Payload, "repo_hash");
                        var repoDisplay = GetString(evt.Payload, "repo_display");
                        if (projectId is not null
                            && !string.IsNullOrWhiteSpace(repoHash)
                            && !string.IsNullOrWhiteSpace(repoDisplay)
                            && !await db.ProjectRepos.AnyAsync(x => x.RepoHash == repoHash, cancellationToken))
                        {
                            db.ProjectRepos.Add(new ProjectRepo
                            {
                                ProjectId = projectId.Value,
                                RepoHash = repoHash,
                                RepoDisplay = repoDisplay,
                                NormalizedUrlCipher = string.Empty
                            });
                        }
                        break;
                    }
                case "session_ended":
                    {
                        var session = FindSession(evt.SessionId);
                        if (session is not null)
                        {
                            session.EndedAt = evt.OccurredAt;
                            session.Status = "ended";
                        }
                        break;
                    }
                case "turn_completed":
                    {
                        var session = FindSession(evt.SessionId);
                        if (session is null)
                        {
                            session = new AgentSession
                            {
                                UserId = userId,
                                ProjectId = projectId,
                                PiSessionId = evt.SessionId ?? $"unknown-{evt.EventId}",
                                Client = GetString(evt.Payload, "client") ?? "pi",
                                PluginVersion = batch.PluginVersion,
                                StartedAt = evt.OccurredAt,
                                Status = "active"
                            };
                            db.AgentSessions.Add(session);
                        }

                        var turnIndex = GetInt(evt.Payload, "turn_index") ?? 0;
                        var turn = db.AgentTurns.Local.FirstOrDefault(x => x.AgentSessionId == session.Id && x.TurnIndex == turnIndex)
                                   ?? db.AgentTurns.FirstOrDefault(x => x.AgentSessionId == session.Id && x.TurnIndex == turnIndex);
                        var modelAlias = GetString(evt.Payload, "model");
                        var publicModelId = modelAlias is null
                            ? (Guid?)null
                            : db.PublicModels.Where(x => x.Alias == modelAlias).Select(x => (Guid?)x.Id).FirstOrDefault();
                        if (turn is null)
                        {
                            turn = new AgentTurn
                            {
                                AgentSessionId = session.Id,
                                TurnIndex = turnIndex,
                                PublicModelId = publicModelId,
                                RequestId = GetString(evt.Payload, "request_id"),
                                InputTokens = GetLong(evt.Payload, "usage", "input_tokens"),
                                OutputTokens = GetLong(evt.Payload, "usage", "output_tokens"),
                                CacheReadTokens = GetLong(evt.Payload, "usage", "cache_read_tokens"),
                                CacheWriteTokens = GetLong(evt.Payload, "usage", "cache_write_tokens"),
                                LatencyMs = GetInt(evt.Payload, "latency_ms") ?? 0,
                                Outcome = GetString(evt.Payload, "outcome")
                            };
                            db.AgentTurns.Add(turn);
                            session.TurnCount++;
                        }
                        session.ProjectId = projectId ?? session.ProjectId;
                        break;
                    }
                case "tool_decision":
                    {
                        var session = FindSession(evt.SessionId);
                        var action = GetString(evt.Payload, "action") switch
                        {
                            "approved" => ToolAction.Approved,
                            "rejected" => ToolAction.Rejected,
                            "policy_denied" => ToolAction.PolicyDenied,
                            "auto_allowed" => ToolAction.AutoAllowed,
                            _ => ToolAction.PolicyDenied
                        };
                        var source = GetString(evt.Payload, "source") switch
                        {
                            "user" => DecisionSource.User,
                            "policy_no_ui" => DecisionSource.PolicyNoUi,
                            _ => DecisionSource.Policy
                        };
                        var risk = GetString(evt.Payload, "risk") switch
                        {
                            "read" => ToolRisk.Read,
                            "write" => ToolRisk.Write,
                            "exec" => ToolRisk.Exec,
                            "network" => ToolRisk.Network,
                            "destructive" => ToolRisk.Destructive,
                            _ => ToolRisk.Unknown
                        };
                        db.ToolDecisions.Add(new ToolDecision
                        {
                            AgentSessionId = session?.Id,
                            ProjectId = projectId ?? session?.ProjectId,
                            UserId = userId,
                            EventId = evt.EventId,
                            ToolCallId = GetString(evt.Payload, "tool_call_id") ?? evt.EventId,
                            ToolName = GetString(evt.Payload, "tool_name") ?? "unknown",
                            Risk = risk,
                            Action = action,
                            Source = source,
                            LatencyMs = GetInt(evt.Payload, "latency_ms") ?? 0,
                            PolicyVersion = GetString(evt.Payload, "policy_version"),
                            OccurredAt = evt.OccurredAt
                        });
                        break;
                    }
                case "tool_executed":
                    {
                        var session = FindSession(evt.SessionId);
                        if (session is not null)
                        {
                            session.ToolCallCount++;
                        }
                        break;
                    }
            }

            accepted++;
        }

        db.TelemetryBatches.Add(new TelemetryBatch
        {
            DeviceId = deviceId,
            BatchId = batch.BatchId,
            EventCount = batch.Events.Count,
            ReceivedAt = DateTime.UtcNow,
            Status = "accepted"
        });
        await db.SaveChangesAsync(cancellationToken);
        return new TelemetryIngestResult(accepted, duplicates);
    }

    private static string? GetString(JsonElement payload, string property) =>
        payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int? GetInt(JsonElement payload, string property) =>
        payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty(property, out var value) && value.TryGetInt32(out var result)
            ? result
            : null;

    private static long GetLong(JsonElement payload, string parent, string property)
    {
        if (payload.ValueKind == JsonValueKind.Object
            && payload.TryGetProperty(parent, out var obj)
            && obj.ValueKind == JsonValueKind.Object
            && obj.TryGetProperty(property, out var value)
            && value.TryGetInt64(out var result))
        {
            return result;
        }
        return 0;
    }
}

/// <summary>Queue of gateway usage events drained by a background writer.</summary>
public sealed class UsageEventQueue
{
    private readonly System.Threading.Channels.Channel<UsageEvent> _channel = System.Threading.Channels.Channel.CreateUnbounded<UsageEvent>(new UnboundedChannelOptions
    {
        SingleReader = true,
        SingleWriter = false
    });

    public bool TryEnqueue(UsageEvent usage) => _channel.Writer.TryWrite(usage);

    public ValueTask<UsageEvent> ReadAsync(CancellationToken cancellationToken) => _channel.Reader.ReadAsync(cancellationToken);

    public bool TryRead(out UsageEvent? usage) => _channel.Reader.TryRead(out usage);
}