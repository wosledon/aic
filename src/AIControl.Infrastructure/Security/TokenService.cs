using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using AIControl.Domain;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace AIControl.Infrastructure.Security;

public sealed class TokenOptions
{
    public string Issuer { get; set; } = "aicontrol";
    public string Audience { get; set; } = "aicontrol";
    public string SigningKey { get; set; } = "dev-signing-key-please-change-0123456789abcdef";
    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenDays { get; set; } = 30;
}

public sealed class TokenService(IOptions<TokenOptions> options)
{
    private readonly TokenOptions _options = options.Value;
    private readonly JsonWebTokenHandler _handler = new();

    public SymmetricSecurityKey SecurityKey => new(Encoding.UTF8.GetBytes(_options.SigningKey));

    public TokenValidationParameters ValidationParameters => new()
    {
        ValidateIssuer = true,
        ValidIssuer = _options.Issuer,
        ValidateAudience = true,
        ValidAudience = _options.Audience,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = SecurityKey,
        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromSeconds(30),
        NameClaimType = "name",
        RoleClaimType = "role"
    };

    public (string Token, DateTime ExpiresAt) CreateAccessToken(User user, string deviceId, string scope = "gateway")
    {
        var now = DateTime.UtcNow;
        var expires = now.AddMinutes(_options.AccessTokenMinutes);
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = _options.Issuer,
            Audience = _options.Audience,
            IssuedAt = now,
            NotBefore = now,
            Expires = expires,
            Claims = new Dictionary<string, object>
            {
                ["sub"] = user.Id.ToString(),
                ["name"] = user.Name,
                ["role"] = user.Role == UserRole.Admin ? "admin" : "user",
                ["device_id"] = deviceId,
                ["scope"] = scope,
                ["jti"] = Guid.NewGuid().ToString("N")
            },
            SigningCredentials = new SigningCredentials(SecurityKey, SecurityAlgorithms.HmacSha256)
        };
        return (_handler.CreateToken(descriptor), expires);
    }

    public (string RawToken, string Hash) CreateRefreshToken()
    {
        var raw = Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(48));
        return (raw, HashRefreshToken(raw));
    }

    public static string HashRefreshToken(string raw) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw))).ToLowerInvariant();

    public static string CreateDeviceId() => "dev_" + Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(12)).Trim('=');

    public static string CreateUserCode()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var chars = new char[6];
        for (var i = 0; i < chars.Length; i++)
        {
            chars[i] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
        }
        return $"{new string(chars, 0, 3)}-{new string(chars, 3, 3)}";
    }

    public static ClaimsPrincipal ToPrincipal(ClaimsIdentity identity) => new(identity);
}