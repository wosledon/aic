using System.Text.Json;

namespace AIControl.Infrastructure.Security;

/// <summary>飞书 user_info 返回的登录所需字段。email 为可选字段，缺失时用 open_id 作为身份。</summary>
public sealed record FeishuUserProfile(
    string OpenId,
    string? UnionId,
    string? UserId,
    string? Email,
    string Name,
    string? AvatarUrl);

/// <summary>飞书 OAuth 错误信息，Code 优先取数值型 code（如 20027），否则取 error（如 invalid_grant）。</summary>
public sealed record FeishuTokenError(string? Code, string? Description);

/// <summary>
/// 解析飞书 OAuth 响应。飞书部分接口把字段放在 data 下，部分接口直接放在根节点，
/// 这里统一兼容两种结构，便于单元测试与复用。
/// </summary>
public static class FeishuOAuthPayloads
{
    public static string? GetString(JsonElement element, string property) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    public static string? GetScalar(JsonElement element, string property) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value)
            ? value.ValueKind switch
            {
                JsonValueKind.String => value.GetString(),
                JsonValueKind.Number => value.ToString(),
                _ => null
            }
            : null;

    /// <summary>根节点带 data 对象时返回 data，否则返回根节点。</summary>
    public static JsonElement UnwrapData(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object
        && root.TryGetProperty("data", out var data)
        && data.ValueKind == JsonValueKind.Object
            ? data
            : root;

    /// <summary>authen/v2/oauth/token 的 access_token，兼容 data 包装与根节点平铺。</summary>
    public static string? GetAccessToken(JsonElement root) =>
        GetString(UnwrapData(root), "access_token") ?? GetString(root, "access_token");

    /// <summary>授权结果中实际授予的 scope（空格分隔）。为空表示未授予任何额外权限，属正常情况。</summary>
    public static string? GetGrantedScope(JsonElement root) =>
        GetString(UnwrapData(root), "scope") ?? GetString(root, "scope");

    public static FeishuTokenError ParseTokenError(JsonElement root)
    {
        var data = UnwrapData(root);
        var code = GetScalar(root, "code") ?? GetScalar(data, "code")
            ?? GetScalar(root, "error") ?? GetScalar(data, "error");
        var description = GetString(root, "error_description") ?? GetString(data, "error_description")
            ?? GetString(root, "msg") ?? GetString(data, "msg");
        return new FeishuTokenError(code, description);
    }

    /// <summary>解析 user_info；缺少 open_id 时返回 null（无法建立稳定身份）。</summary>
    public static FeishuUserProfile? ParseUserProfile(JsonElement root)
    {
        var data = UnwrapData(root);
        var openId = GetString(data, "open_id");
        if (string.IsNullOrWhiteSpace(openId))
        {
            return null;
        }

        var email = GetString(data, "email") ?? GetString(data, "enterprise_email");
        var name = GetString(data, "name");
        if (string.IsNullOrWhiteSpace(name))
        {
            name = !string.IsNullOrWhiteSpace(email)
                ? email
                : "飞书用户 " + (openId.Length > 6 ? openId[^6..] : openId);
        }

        return new FeishuUserProfile(
            openId,
            GetString(data, "union_id"),
            GetString(data, "user_id"),
            email,
            name,
            GetString(data, "avatar_url"));
    }
}