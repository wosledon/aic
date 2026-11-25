namespace AIControl.Domain;

public abstract class EntityBase
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class User : EntityBase
{
    public string FeishuOpenId { get; set; } = string.Empty;
    public string? UnionId { get; set; }
    public string? FeishuUserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? AvatarUrl { get; set; }
    public UserRole Role { get; set; } = UserRole.User;
    public UserStatus Status { get; set; } = UserStatus.Active;
    public DateTime? LastLoginAt { get; set; }
}

public class FeishuAppConfig : EntityBase
{
    public bool Enabled { get; set; }
    public string AppId { get; set; } = string.Empty;
    public string AppSecretCipher { get; set; } = string.Empty;
    public string RedirectUri { get; set; } = string.Empty;
    public string Scopes { get; set; } = "contact:user.base:readonly";
    public UserRole DefaultRole { get; set; } = UserRole.User;
    public bool AutoProvision { get; set; } = true;
    public bool ConsoleSsoEnabled { get; set; } = true;
    public bool DeviceFlowEnabled { get; set; } = true;
    public int SessionHours { get; set; } = 8;
}

public class Device
{
    public string Id { get; set; } = string.Empty;
    public Guid UserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Os { get; set; }
    public string? Fingerprint { get; set; }
    public string? PluginVersion { get; set; }
    public string? PiVersion { get; set; }
    public DeviceStatus Status { get; set; } = DeviceStatus.Active;
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class RefreshToken : EntityBase
{
    public Guid UserId { get; set; }
    public string DeviceId { get; set; } = string.Empty;
    public string TokenHash { get; set; } = string.Empty;
    public string FamilyId { get; set; } = Guid.NewGuid().ToString("N");
    public Guid? RotatedFrom { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string? RevokedReason { get; set; }
}

public class DeviceCode : EntityBase
{
    public string Code { get; set; } = string.Empty;
    public string UserCode { get; set; } = string.Empty;
    public string DeviceId { get; set; } = string.Empty;
    public string DeviceName { get; set; } = string.Empty;
    public string? Os { get; set; }
    public string? PluginVersion { get; set; }
    public string? PiVersion { get; set; }
    public DeviceCodeStatus Status { get; set; } = DeviceCodeStatus.Pending;
    public Guid? UserId { get; set; }
    public DateTime ExpiresAt { get; set; }
    public int IntervalSeconds { get; set; } = 2;
    public DateTime? ApprovedAt { get; set; }
}

public class Project : EntityBase
{
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public ProjectStatus Status { get; set; } = ProjectStatus.Active;
    public string? TokenQuotaJson { get; set; }
    public ICollection<ProjectMember> Members { get; set; } = new List<ProjectMember>();
    public ICollection<ProjectRepo> Repos { get; set; } = new List<ProjectRepo>();
}

public class ProjectMember : EntityBase
{
    public Guid ProjectId { get; set; }
    public Guid UserId { get; set; }
    public string Source { get; set; } = "manual";
    public Project? Project { get; set; }
    public User? User { get; set; }
}

public class ProjectRepo : EntityBase
{
    public Guid ProjectId { get; set; }
    public string RepoHash { get; set; } = string.Empty;
    public string RepoDisplay { get; set; } = string.Empty;
    public string NormalizedUrlCipher { get; set; } = string.Empty;
    public Project? Project { get; set; }
}

public class CatalogSnapshot
{
    public string Id { get; set; } = string.Empty;
    public string Source { get; set; } = "models.dev";
    public DateTime FetchedAt { get; set; } = DateTime.UtcNow;
    public string ContentHash { get; set; } = string.Empty;
    public string SchemaVersion { get; set; } = "1";
    public string RawJson { get; set; } = string.Empty;
    public CatalogSnapshotStatus Status { get; set; } = CatalogSnapshotStatus.Active;
    public string? Error { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class ProviderTemplate : EntityBase
{
    public string SnapshotId { get; set; } = string.Empty;
    public string ProviderKey { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Npm { get; set; }
    public string? ProtocolSuggestion { get; set; }
    public string? BaseUrlCipher { get; set; }
    public string? DocUrl { get; set; }
    public string? EnvNamesJson { get; set; }
    public string RawJson { get; set; } = "{}";
}

public class ModelTemplate : EntityBase
{
    public string SnapshotId { get; set; } = string.Empty;
    public Guid ProviderTemplateId { get; set; }
    public string ModelKey { get; set; } = string.Empty;
    public string? CanonicalModelId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Family { get; set; }
    public string? Description { get; set; }
    public string? ModalitiesJson { get; set; }
    public long ContextLimit { get; set; }
    public long OutputLimit { get; set; }
    public bool Reasoning { get; set; }
    public string? ReasoningOptionsJson { get; set; }
    public string? Status { get; set; }
    public string? ReleaseDate { get; set; }
    public string RawJson { get; set; } = "{}";
}

public class Channel : EntityBase
{
    public string Name { get; set; } = string.Empty;
    public Guid? ProviderTemplateId { get; set; }
    public string? ProviderKey { get; set; }
    public ApiProtocol Protocol { get; set; } = ApiProtocol.OpenAiCompletions;
    public string BaseUrlCipher { get; set; } = string.Empty;
    public string ApiKeyCipher { get; set; } = string.Empty;
    public string? HeadersCipher { get; set; }
    public ChannelStatus Status { get; set; } = ChannelStatus.Enabled;
    public string? TimeoutJson { get; set; }
    public int MaxConcurrency { get; set; } = 32;
    public DateTime? LastTestAt { get; set; }
    public bool? LastTestOk { get; set; }
    public string? LastError { get; set; }
    public ICollection<ChannelModel> Models { get; set; } = new List<ChannelModel>();
}

public class ChannelModel : EntityBase
{
    public Guid ChannelId { get; set; }
    public string UpstreamModel { get; set; } = string.Empty;
    public string? CapabilitiesJson { get; set; }
    public bool Enabled { get; set; } = true;
    public Channel? Channel { get; set; }
}

public class PublicModel : EntityBase
{
    public string Alias { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public ApiProtocol Protocol { get; set; } = ApiProtocol.OpenAiCompletions;
    public Guid? ModelTemplateId { get; set; }
    public string? CatalogSnapshotId { get; set; }
    public Guid? ChannelModelId { get; set; }
    public string? CapabilitiesJson { get; set; }
    public long ContextWindow { get; set; }
    public long MaxTokens { get; set; }
    public bool Reasoning { get; set; }
    public string? ReasoningOptionsJson { get; set; }
    public string? ThinkingLevelMapJson { get; set; }
    public PublicModelStatus Status { get; set; } = PublicModelStatus.Enabled;
    public ChannelModel? ChannelModel { get; set; }
}

public class Policy : EntityBase
{
    public ScopeType ScopeType { get; set; } = ScopeType.Global;
    public string? ScopeId { get; set; }
    public PolicyType Type { get; set; }
    public string ConfigJson { get; set; } = "{}";
    public int Version { get; set; } = 1;
    public bool Enabled { get; set; } = true;
}

public class Quota : EntityBase
{
    public ScopeType ScopeType { get; set; } = ScopeType.User;
    public string ScopeId { get; set; } = string.Empty;
    public QuotaPeriod Period { get; set; } = QuotaPeriod.Month;
    public long TokenLimit { get; set; }
    public long RequestLimit { get; set; }
    public QuotaAction Action { get; set; } = QuotaAction.Block;
    public bool Enabled { get; set; } = true;
}

public class AgentSession : EntityBase
{
    public Guid UserId { get; set; }
    public Guid? ProjectId { get; set; }
    public string Client { get; set; } = "pi";
    public string PiSessionId { get; set; } = string.Empty;
    public string? CwdBasename { get; set; }
    public string? RepoHash { get; set; }
    public string? RepoDisplay { get; set; }
    public string? PluginVersion { get; set; }
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? EndedAt { get; set; }
    public string Status { get; set; } = "active";
    public long TurnCount { get; set; }
    public long ToolCallCount { get; set; }
}

public class AgentTurn : EntityBase
{
    public Guid AgentSessionId { get; set; }
    public int TurnIndex { get; set; }
    public Guid? PublicModelId { get; set; }
    public string? RequestId { get; set; }
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
    public long CacheReadTokens { get; set; }
    public long CacheWriteTokens { get; set; }
    public int LatencyMs { get; set; }
    public string? Outcome { get; set; }
}

public class ToolDecision : EntityBase
{
    public Guid? AgentSessionId { get; set; }
    public Guid? AgentTurnId { get; set; }
    public Guid? ProjectId { get; set; }
    public Guid UserId { get; set; }
    public string EventId { get; set; } = string.Empty;
    public string ToolCallId { get; set; } = string.Empty;
    public string ToolName { get; set; } = string.Empty;
    public ToolRisk Risk { get; set; } = ToolRisk.Unknown;
    public ToolAction Action { get; set; }
    public DecisionSource Source { get; set; }
    public int LatencyMs { get; set; }
    public string? PolicyVersion { get; set; }
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
}

public class UsageEvent : EntityBase
{
    public string RequestId { get; set; } = string.Empty;
    public Guid UserId { get; set; }
    public Guid? ProjectId { get; set; }
    public Guid? AgentSessionId { get; set; }
    public string? DeviceId { get; set; }
    public Guid? PublicModelId { get; set; }
    public string PublicModelAlias { get; set; } = string.Empty;
    public Guid? ChannelId { get; set; }
    public string UpstreamModel { get; set; } = string.Empty;
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
    public long CacheReadTokens { get; set; }
    public long CacheWriteTokens { get; set; }
    public long TotalTokens { get; set; }
    public UsageSource UsageSource { get; set; } = UsageSource.Upstream;
    public int LatencyMs { get; set; }
    public int TtftMs { get; set; }
    public int StatusCode { get; set; } = 200;
    public string? ErrorCode { get; set; }
    public bool Streaming { get; set; }
    public string Protocol { get; set; } = string.Empty;
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
}

public class TelemetryBatch : EntityBase
{
    public string DeviceId { get; set; } = string.Empty;
    public string BatchId { get; set; } = string.Empty;
    public int EventCount { get; set; }
    public DateTime ReceivedAt { get; set; } = DateTime.UtcNow;
    public string Status { get; set; } = "accepted";
}

public class TelemetryEvent : EntityBase
{
    public string EventId { get; set; } = string.Empty;
    public string BatchId { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string? SessionId { get; set; }
    public string? ProjectKey { get; set; }
    public string PayloadJson { get; set; } = "{}";
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
    public DateTime ReceivedAt { get; set; } = DateTime.UtcNow;
}

public class AuditLog : EntityBase
{
    public Guid? ActorUserId { get; set; }
    public string ActorName { get; set; } = "system";
    public string Action { get; set; } = string.Empty;
    public string TargetType { get; set; } = string.Empty;
    public string? TargetId { get; set; }
    public string? DetailJson { get; set; }
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
}

public class AppSetting
{
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}