using AIControl.Domain;
using AIControl.Infrastructure.Catalog;
using AIControl.Infrastructure.Security;
using AIControl.Infrastructure.Utils;
using Microsoft.EntityFrameworkCore;

namespace AIControl.Infrastructure.Seed;

public sealed class SeederOptions
{
    public string BootstrapAdminUnionId { get; set; } = "dev-admin";
    public string BootstrapAdminEmail { get; set; } = "admin@aic.local";
    public bool SeedDemoData { get; set; } = true;
    public string? ModelsDevFixturePath { get; set; }
    public string PublicBaseUrl { get; set; } = "http://localhost:5080";
}

public sealed class DbSeeder(
    AppDbContext db,
    ModelsDevService modelsDev,
    CatalogImportService importService,
    SeederOptions options)
{
    public async Task SeedAsync(CancellationToken cancellationToken)
    {
        await db.Database.EnsureCreatedAsync(cancellationToken);

        var admin = await EnsureUserAsync(
            options.BootstrapAdminUnionId,
            "AIC 管理员",
            options.BootstrapAdminEmail,
            UserRole.Admin,
            cancellationToken);
        var demoUser = await EnsureUserAsync("dev-user", "示例开发者", "dev@aic.local", UserRole.User, cancellationToken);
        var users = new[]
        {
            admin,
            demoUser,
            await EnsureUserAsync("dev-lisi", "李思", "lisi@aic.local", UserRole.User, cancellationToken),
            await EnsureUserAsync("dev-wangwu", "王武", "wangwu@aic.local", UserRole.User, cancellationToken)
        };

        if (!await db.FeishuAppConfigs.AnyAsync(cancellationToken))
        {
            db.FeishuAppConfigs.Add(new FeishuAppConfig
            {
                Enabled = false,
                AppId = string.Empty,
                AppSecretCipher = string.Empty,
                RedirectUri = options.PublicBaseUrl + "/api/v1/auth/feishu/callback",
                Scopes = "",
                DefaultRole = UserRole.User,
                AutoProvision = true,
                ConsoleSsoEnabled = true,
                DeviceFlowEnabled = true,
                SessionHours = 8
            });
        }

        var project = await db.Projects.FirstOrDefaultAsync(x => x.Key == "payments-api", cancellationToken);
        if (project is null)
        {
            project = new Project
            {
                Key = "payments-api",
                Name = "支付 API",
                Description = "演示项目：支付核心服务",
                Status = ProjectStatus.Active
            };
            db.Projects.Add(project);
        }

        foreach (var user in users)
        {
            if (!await db.ProjectMembers.AnyAsync(x => x.ProjectId == project.Id && x.UserId == user.Id, cancellationToken))
            {
                db.ProjectMembers.Add(new ProjectMember { ProjectId = project.Id, UserId = user.Id, Source = "seed" });
            }
        }

        if (!await db.ProjectRepos.AnyAsync(x => x.ProjectId == project.Id, cancellationToken))
        {
            var normalized = RepoUrlNormalizer.Normalize("git@git.example.com:payments/payments-api.git");
            db.ProjectRepos.Add(new ProjectRepo
            {
                ProjectId = project.Id,
                RepoHash = normalized.Hash,
                RepoDisplay = normalized.Display,
                NormalizedUrlCipher = normalized.NormalizedUrl
            });
        }

        if (!await db.Policies.AnyAsync(x => x.Type == PolicyType.Approval, cancellationToken))
        {
            db.Policies.Add(new AIControl.Domain.Policy
            {
                ScopeType = ScopeType.Global,
                Type = PolicyType.Approval,
                ConfigJson = CatalogMapper.DefaultApprovalPolicyJson(),
                Version = 3,
                Enabled = true
            });
        }
        if (!await db.Policies.AnyAsync(x => x.Type == PolicyType.ModelWhitelist, cancellationToken))
        {
            db.Policies.Add(new AIControl.Domain.Policy
            {
                ScopeType = ScopeType.Global,
                Type = PolicyType.ModelWhitelist,
                ConfigJson = CatalogMapper.DefaultModelWhitelistJson(),
                Version = 1,
                Enabled = true
            });
        }
        if (!await db.Policies.AnyAsync(x => x.Type == PolicyType.RateLimit, cancellationToken))
        {
            db.Policies.Add(new AIControl.Domain.Policy
            {
                ScopeType = ScopeType.Global,
                Type = PolicyType.RateLimit,
                ConfigJson = CatalogMapper.DefaultRateLimitJson(),
                Version = 1,
                Enabled = true
            });
        }
        if (!await db.Quotas.AnyAsync(x => x.ScopeType == ScopeType.User && x.ScopeId == demoUser.Id.ToString(), cancellationToken))
        {
            db.Quotas.Add(new Quota
            {
                ScopeType = ScopeType.User,
                ScopeId = demoUser.Id.ToString(),
                Period = QuotaPeriod.Month,
                TokenLimit = 2_000_000,
                RequestLimit = 5_000,
                Action = QuotaAction.Block,
                Enabled = true
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        if (!await db.CatalogSnapshots.AnyAsync(x => x.Status == CatalogSnapshotStatus.Active, cancellationToken)
            && !string.IsNullOrWhiteSpace(options.ModelsDevFixturePath))
        {
            await modelsDev.ImportLocalFixtureAsync(options.ModelsDevFixturePath, cancellationToken);
        }

        await EnsureFallbackCatalogAsync(cancellationToken);
        await EnsureDemoChannelsAsync(cancellationToken);
        await SeedDemoAnalyticsAsync(users, project, cancellationToken);
    }

    private async Task<User> EnsureUserAsync(string unionId, string name, string email, UserRole role, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(x => x.UnionId == unionId || x.FeishuOpenId == unionId, cancellationToken);
        if (user is not null)
        {
            return user;
        }

        user = new User
        {
            FeishuOpenId = unionId,
            UnionId = unionId,
            Name = name,
            Email = email,
            Role = role,
            Status = UserStatus.Active,
            LastLoginAt = DateTime.UtcNow
        };
        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);
        return user;
    }

    /// <summary>Guarantees a usable catalog even when models.dev is unreachable on first boot.</summary>
    private async Task EnsureFallbackCatalogAsync(CancellationToken cancellationToken)
    {
        if (await db.ProviderTemplates.AnyAsync(cancellationToken))
        {
            return;
        }

        var snapshot = new CatalogSnapshot
        {
            Id = "mds_builtin",
            Source = "models.dev",
            FetchedAt = DateTime.UtcNow,
            ContentHash = "builtin",
            RawJson = "{}",
            Status = CatalogSnapshotStatus.Active
        };
        db.CatalogSnapshots.Add(snapshot);

        var anthropic = new ProviderTemplate
        {
            SnapshotId = snapshot.Id,
            ProviderKey = "anthropic",
            Name = "Anthropic",
            Npm = "@ai-sdk/anthropic",
            ProtocolSuggestion = ApiProtocols.AnthropicMessages,
            EnvNamesJson = "[\"ANTHROPIC_API_KEY\"]",
            RawJson = "{}"
        };
        var openai = new ProviderTemplate
        {
            SnapshotId = snapshot.Id,
            ProviderKey = "openai",
            Name = "OpenAI",
            Npm = "@ai-sdk/openai",
            ProtocolSuggestion = ApiProtocols.OpenAiResponses,
            EnvNamesJson = "[\"OPENAI_API_KEY\"]",
            RawJson = "{}"
        };
        db.ProviderTemplates.AddRange(anthropic, openai);

        db.ModelTemplates.AddRange(
            new ModelTemplate
            {
                SnapshotId = snapshot.Id,
                ProviderTemplateId = anthropic.Id,
                ModelKey = "claude-sonnet-4-6",
                CanonicalModelId = "anthropic/claude-sonnet-4-6",
                Name = "Claude Sonnet 4.6",
                Family = "claude-sonnet",
                ModalitiesJson = "{\"input\":[\"text\",\"image\"],\"output\":[\"text\"]}",
                ContextLimit = 200000,
                OutputLimit = 64000,
                Reasoning = true,
                ReasoningOptionsJson = "[{\"type\":\"toggle\"},{\"type\":\"budget_tokens\",\"min\":1024}]",
                Status = "active",
                RawJson = "{\"tool_call\":true}"
            },
            new ModelTemplate
            {
                SnapshotId = snapshot.Id,
                ProviderTemplateId = openai.Id,
                ModelKey = "gpt-5.1-codex",
                CanonicalModelId = "openai/gpt-5.1-codex",
                Name = "GPT-5.1 Codex",
                Family = "gpt-codex",
                ModalitiesJson = "{\"input\":[\"text\",\"image\"],\"output\":[\"text\"]}",
                ContextLimit = 400000,
                OutputLimit = 128000,
                Reasoning = true,
                ReasoningOptionsJson = "[{\"type\":\"effort\",\"values\":[\"low\",\"medium\",\"high\",\"xhigh\"]}]",
                Status = "active",
                RawJson = "{\"tool_call\":true}"
            });
        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task EnsureDemoChannelsAsync(CancellationToken cancellationToken)
    {
        if (await db.PublicModels.AnyAsync(cancellationToken))
        {
            return;
        }

        var latestSnapshot = await db.CatalogSnapshots
            .Where(x => x.Status == CatalogSnapshotStatus.Active)
            .OrderByDescending(x => x.FetchedAt)
            .FirstAsync(cancellationToken);
        var demoProviderKeys = new[] { "anthropic", "openai", "deepseek" };
        var providers = await db.ProviderTemplates
            .Where(x => x.SnapshotId == latestSnapshot.Id && demoProviderKeys.Contains(x.ProviderKey))
            .ToListAsync(cancellationToken);

        foreach (var provider in providers)
        {
            var protocol = ApiProtocols.Parse(provider.ProtocolSuggestion);
            if (protocol == ApiProtocol.Unknown)
            {
                continue;
            }

            var models = await db.ModelTemplates
                .Where(x => x.SnapshotId == latestSnapshot.Id && x.ProviderTemplateId == provider.Id)
                .Where(x => x.Status == null || x.Status != "deprecated")
                .OrderByDescending(x => x.ReleaseDate)
                .Take(2)
                .ToListAsync(cancellationToken);
            if (models.Count == 0)
            {
                continue;
            }

            var mockPath = protocol.IsAnthropic() ? "anthropic" : "openai";
            var result = await importService.ImportAsync(new ImportPublicModelsRequest(
                provider.ProviderKey,
                models.Select(x => x.ModelKey).ToList(),
                new ImportChannelInput(
                    null,
                    $"内置模拟渠道 · {provider.Name}",
                    $"{options.PublicBaseUrl.TrimEnd('/')}/mock/{mockPath}",
                    "aic-demo-key",
                    protocol.ToWire(),
                    null),
                Publish: true), cancellationToken);
            _ = result;
        }
    }

    private async Task SeedDemoAnalyticsAsync(User[] users, Project project, CancellationToken cancellationToken)
    {
        if (!options.SeedDemoData || await db.UsageEvents.AnyAsync(cancellationToken))
        {
            return;
        }

        var models = await db.PublicModels.Where(x => x.Status == PublicModelStatus.Enabled).Take(6).ToListAsync(cancellationToken);
        if (models.Count == 0)
        {
            return;
        }

        var rng = new Random(20261125);
        var now = DateTime.UtcNow;
        var sessions = new List<AgentSession>();
        string[] clients = ["pi", "codex", "claude-code", "copilot-cli"];

        for (var i = 0; i < 28; i++)
        {
            var user = users[rng.Next(users.Length)];
            var started = now.AddDays(-rng.Next(0, 14)).AddHours(-rng.Next(0, 10));
            var session = new AgentSession
            {
                UserId = user.Id,
                ProjectId = rng.NextDouble() < 0.85 ? project.Id : null,
                Client = clients[i % clients.Length],
                PiSessionId = "pi_" + Guid.NewGuid().ToString("N"),
                CwdBasename = "payments-api",
                RepoHash = RepoUrlNormalizer.Normalize("https://git.example.com/payments/payments-api").Hash,
                RepoDisplay = "git.example.com/payments/payments-api",
                PluginVersion = "1.2.3",
                StartedAt = started,
                EndedAt = started.AddMinutes(rng.Next(10, 120)),
                Status = "ended",
                TurnCount = rng.Next(2, 12),
                ToolCallCount = rng.Next(0, 8)
            };
            sessions.Add(session);
            db.AgentSessions.Add(session);
        }
        await db.SaveChangesAsync(cancellationToken);

        var usageEvents = new List<UsageEvent>();
        for (var day = 13; day >= 0; day--)
        {
            foreach (var user in users)
            {
                var count = rng.Next(2, 9);
                for (var i = 0; i < count; i++)
                {
                    var model = models[rng.Next(models.Count)];
                    var input = rng.Next(600, 9000);
                    var output = rng.Next(150, 3200);
                    var cacheRead = rng.NextDouble() < 0.55 ? rng.Next(0, 5000) : 0;
                    var cacheWrite = rng.NextDouble() < 0.3 ? rng.Next(0, 1200) : 0;
                    var failed = rng.NextDouble() < 0.06;
                    var session = rng.NextDouble() < 0.55 ? sessions[rng.Next(sessions.Count)] : null;
                    usageEvents.Add(new UsageEvent
                    {
                        RequestId = "req_" + Guid.NewGuid().ToString("N"),
                        UserId = user.Id,
                        ProjectId = rng.NextDouble() < (session?.ProjectId is null ? 0.35 : 0.9) ? project.Id : null,
                        AgentSessionId = session?.Id,
                        DeviceId = "dev_demo_" + (user.Id == users[1].Id ? "workstation" : "laptop"),
                        PublicModelId = model.Id,
                        PublicModelAlias = model.Alias,
                        ChannelId = null,
                        UpstreamModel = model.Alias,
                        InputTokens = input,
                        OutputTokens = output,
                        CacheReadTokens = cacheRead,
                        CacheWriteTokens = cacheWrite,
                        TotalTokens = input + output + cacheRead + cacheWrite,
                        UsageSource = UsageSource.Upstream,
                        LatencyMs = rng.Next(700, 6500),
                        TtftMs = rng.Next(180, 1800),
                        StatusCode = failed ? (rng.NextDouble() < 0.5 ? 429 : 502) : 200,
                        ErrorCode = failed ? (rng.NextDouble() < 0.5 ? "quota_exceeded" : "upstream_error") : null,
                        Streaming = rng.NextDouble() < 0.8,
                        Protocol = model.Protocol.ToWire(),
                        OccurredAt = now.AddDays(-day).Date.AddHours(rng.Next(8, 21)).AddMinutes(rng.Next(0, 60))
                    });
                }
            }
        }
        db.UsageEvents.AddRange(usageEvents);

        string[] tools = ["bash", "edit", "read", "write", "web_fetch"];
        var risks = new Dictionary<string, ToolRisk>
        {
            ["bash"] = ToolRisk.Exec,
            ["edit"] = ToolRisk.Write,
            ["read"] = ToolRisk.Read,
            ["write"] = ToolRisk.Write,
            ["web_fetch"] = ToolRisk.Network
        };
        for (var i = 0; i < 160; i++)
        {
            var session = sessions[rng.Next(sessions.Count)];
            var tool = tools[rng.Next(tools.Length)];
            var roll = rng.NextDouble();
            var (action, source) = roll switch
            {
                < 0.55 => (ToolAction.Approved, DecisionSource.User),
                < 0.7 => (ToolAction.Rejected, DecisionSource.User),
                < 0.9 => (ToolAction.AutoAllowed, DecisionSource.Policy),
                _ => (ToolAction.PolicyDenied, DecisionSource.PolicyNoUi)
            };
            db.ToolDecisions.Add(new ToolDecision
            {
                AgentSessionId = session.Id,
                ProjectId = session.ProjectId,
                UserId = session.UserId,
                EventId = "evt_" + Guid.NewGuid().ToString("N"),
                ToolCallId = "call_" + Guid.NewGuid().ToString("N")[..12],
                ToolName = tool,
                Risk = risks[tool],
                Action = action,
                Source = source,
                LatencyMs = action == ToolAction.AutoAllowed ? 0 : rng.Next(400, 9000),
                PolicyVersion = "3",
                OccurredAt = now.AddDays(-rng.Next(0, 14)).Date.AddHours(rng.Next(9, 20))
            });
        }

        db.AuditLogs.Add(new AuditLog
        {
            ActorUserId = users[0].Id,
            ActorName = users[0].Name,
            Action = "system.seed",
            TargetType = "system",
            TargetId = "demo",
            DetailJson = "{\"message\":\"初始化演示数据\"}",
            CreatedAt = now.AddMinutes(-30)
        });

        await db.SaveChangesAsync(cancellationToken);
    }
}
