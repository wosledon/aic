namespace AIControl.Domain;

public enum UserRole
{
    User,
    Admin
}

public enum UserStatus
{
    Active,
    Disabled
}

public enum DeviceStatus
{
    Active,
    Revoked
}

public enum DeviceCodeStatus
{
    Pending,
    Approved,
    Denied,
    Expired,
    Consumed
}

public enum ProjectStatus
{
    Active,
    Archived
}

public enum CatalogSnapshotStatus
{
    Active,
    Failed
}

public enum ChannelStatus
{
    Enabled,
    Disabled,
    Maintenance
}

public enum PublicModelStatus
{
    Enabled,
    Disabled,
    Gray
}

public enum ScopeType
{
    Global,
    User,
    Project
}

public enum PolicyType
{
    ModelWhitelist,
    Approval,
    RateLimit
}

public enum QuotaPeriod
{
    Day,
    Month
}

public enum QuotaAction
{
    Block,
    Warn,
    Observe
}

public enum ToolRisk
{
    Read,
    Write,
    Exec,
    Network,
    Destructive,
    Unknown
}

public enum ToolAction
{
    Approved,
    Rejected,
    PolicyDenied,
    AutoAllowed
}

public enum DecisionSource
{
    User,
    Policy,
    PolicyNoUi
}

public enum UsageSource
{
    Upstream,
    Estimated,
    Partial
}

/// <summary>
/// Wire-level protocol identifiers shared by gateway, catalog and plugins.
/// </summary>
public static class ApiProtocols
{
    public const string AnthropicMessages = "anthropic-messages";
    public const string OpenAiResponses = "openai-responses";
    public const string OpenAiCompletions = "openai-completions";
    public const string GoogleGenerativeAi = "google-generative-ai";
    public const string AzureOpenAiResponses = "azure-openai-responses";
    public const string AzureOpenAiCompletions = "azure-openai-completions";

    private static readonly Dictionary<string, ApiProtocol> Map = new(StringComparer.OrdinalIgnoreCase)
    {
        [AnthropicMessages] = ApiProtocol.AnthropicMessages,
        [OpenAiResponses] = ApiProtocol.OpenAiResponses,
        [OpenAiCompletions] = ApiProtocol.OpenAiCompletions,
        [GoogleGenerativeAi] = ApiProtocol.GoogleGenerativeAi,
        [AzureOpenAiResponses] = ApiProtocol.AzureOpenAiResponses,
        [AzureOpenAiCompletions] = ApiProtocol.AzureOpenAiCompletions
    };

    public static ApiProtocol Parse(string? value) =>
        value is not null && Map.TryGetValue(value, out var protocol) ? protocol : ApiProtocol.Unknown;

    public static string ToWire(this ApiProtocol protocol) => protocol switch
    {
        ApiProtocol.AnthropicMessages => AnthropicMessages,
        ApiProtocol.OpenAiResponses => OpenAiResponses,
        ApiProtocol.OpenAiCompletions => OpenAiCompletions,
        ApiProtocol.GoogleGenerativeAi => GoogleGenerativeAi,
        ApiProtocol.AzureOpenAiResponses => AzureOpenAiResponses,
        ApiProtocol.AzureOpenAiCompletions => AzureOpenAiCompletions,
        _ => "unknown"
    };

    public static bool IsOpenAi(this ApiProtocol protocol) =>
        protocol is ApiProtocol.OpenAiResponses or ApiProtocol.OpenAiCompletions
            or ApiProtocol.AzureOpenAiResponses or ApiProtocol.AzureOpenAiCompletions;

    public static bool IsAnthropic(this ApiProtocol protocol) => protocol == ApiProtocol.AnthropicMessages;

    /// <summary>Default upstream base address used when neither template nor channel provides one.</summary>
    public static string DefaultBaseUrl(this ApiProtocol protocol) => protocol switch
    {
        ApiProtocol.AnthropicMessages => "https://api.anthropic.com",
        ApiProtocol.OpenAiResponses or ApiProtocol.OpenAiCompletions => "https://api.openai.com",
        ApiProtocol.GoogleGenerativeAi => "https://generativelanguage.googleapis.com",
        _ => string.Empty
    };
}

public enum ApiProtocol
{
    Unknown = 0,
    AnthropicMessages,
    OpenAiResponses,
    OpenAiCompletions,
    GoogleGenerativeAi,
    AzureOpenAiResponses,
    AzureOpenAiCompletions
}