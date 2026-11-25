using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace AIControl.Infrastructure.Utils;

public static partial class RepoUrlNormalizer
{
    [GeneratedRegex(@"^git@(?<host>[^:]+):(?<path>.+)$", RegexOptions.IgnoreCase)]
    private static partial Regex ScpLike();

    [GeneratedRegex(@"^(?<scheme>https?|ssh)://(?:[^@/]+@)?(?<host>[^/:]+)(?::\d+)?/(?<path>.+)$", RegexOptions.IgnoreCase)]
    private static partial Regex UrlLike();

    /// <summary>
    /// Removes credentials, unifies protocol/host casing, strips .git and trailing slashes.
    /// </summary>
    public static (string NormalizedUrl, string Display, string Hash) Normalize(string remoteUrl)
    {
        var raw = remoteUrl.Trim();
        string host;
        string path;

        var scp = ScpLike().Match(raw);
        var url = UrlLike().Match(raw);
        if (scp.Success)
        {
            host = scp.Groups["host"].Value;
            path = scp.Groups["path"].Value;
        }
        else if (url.Success)
        {
            host = url.Groups["host"].Value;
            path = url.Groups["path"].Value;
        }
        else
        {
            host = "unknown";
            path = raw;
        }

        host = host.ToLowerInvariant();
        path = path.Trim().Trim('/').ToLowerInvariant();
        if (path.EndsWith(".git", StringComparison.Ordinal))
        {
            path = path[..^4];
        }

        var normalized = $"https://{host}/{path}";
        var display = $"{host}/{path}";
        var hash = "sha256:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized))).ToLowerInvariant();
        return (normalized, display, hash);
    }
}