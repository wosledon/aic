using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace AIControl.Infrastructure.Security;

public sealed class EncryptionOptions
{
    public string Key { get; set; } = "aicontrol-demo-encryption-key-change-me";
}

/// <summary>
/// AES-GCM envelope used for channel secrets and Feishu app secret.
/// Format: v1.&lt;base64(nonce|tag|ciphertext)&gt;.
/// </summary>
public sealed class SecretProtector(IOptions<EncryptionOptions> options)
{
    private readonly byte[] _key = SHA256.HashData(Encoding.UTF8.GetBytes(options.Value.Key));

    public string Protect(string plaintext)
    {
        if (string.IsNullOrEmpty(plaintext))
        {
            return string.Empty;
        }

        var nonce = RandomNumberGenerator.GetBytes(12);
        var plain = Encoding.UTF8.GetBytes(plaintext);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(_key, 16);
        aes.Encrypt(nonce, plain, cipher, tag);
        var payload = new byte[nonce.Length + tag.Length + cipher.Length];
        Buffer.BlockCopy(nonce, 0, payload, 0, nonce.Length);
        Buffer.BlockCopy(tag, 0, payload, nonce.Length, tag.Length);
        Buffer.BlockCopy(cipher, 0, payload, nonce.Length + tag.Length, cipher.Length);
        return "v1." + Convert.ToBase64String(payload);
    }

    public string Unprotect(string? ciphertext)
    {
        if (string.IsNullOrEmpty(ciphertext))
        {
            return string.Empty;
        }

        if (!ciphertext.StartsWith("v1.", StringComparison.Ordinal))
        {
            // Plain values are accepted only for seeded/demo data.
            return ciphertext;
        }

        var payload = Convert.FromBase64String(ciphertext[3..]);
        if (payload.Length < 29)
        {
            return string.Empty;
        }

        var nonce = payload.AsSpan(0, 12);
        var tag = payload.AsSpan(12, 16);
        var cipher = payload.AsSpan(28);
        var plain = new byte[cipher.Length];
        using var aes = new AesGcm(_key, 16);
        aes.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }

    public static string Mask(string? secret)
    {
        if (string.IsNullOrEmpty(secret))
        {
            return string.Empty;
        }

        return secret.Length <= 4 ? "****" : "****" + secret[^4..];
    }
}