using System.Text.Json;
using AIControl.Infrastructure.Security;

namespace AIControl.UnitTests;

public sealed class FeishuOAuthPayloadTests
{
    private static JsonElement Json(string value) => JsonDocument.Parse(value).RootElement.Clone();

    [Fact]
    public void UserInfoWithoutEmail_StillProducesIdentity()
    {
        var profile = FeishuOAuthPayloads.ParseUserProfile(Json("""
        {
          "code": 0,
          "data": {
            "open_id": "ou-caecc734c2e3328a62489fe0648c4b98779515d3",
            "union_id": "on-d89jhsdhjsajkda7828enjdj328ydhhw3u43yjhdj",
            "name": "张三",
            "avatar_url": "https://example.com/avatar.png"
          }
        }
        """));

        Assert.NotNull(profile);
        Assert.Equal("ou-caecc734c2e3328a62489fe0648c4b98779515d3", profile!.OpenId);
        Assert.Equal("张三", profile.Name);
        Assert.Null(profile.Email);
        Assert.Equal("https://example.com/avatar.png", profile.AvatarUrl);
    }

    [Fact]
    public void UserInfoWithoutEmailOrName_FallsBackToOpenIdSuffix()
    {
        var profile = FeishuOAuthPayloads.ParseUserProfile(Json("""
        { "data": { "open_id": "ou-caecc734c2e3328a62489fe0648c4b98779515d3" } }
        """));

        Assert.NotNull(profile);
        Assert.Null(profile!.Email);
        Assert.StartsWith("飞书用户 ", profile.Name);
        Assert.EndsWith("9515d3", profile.Name);
    }

    [Fact]
    public void UserInfoWithEmailOnly_UsesEmailAsName()
    {
        var profile = FeishuOAuthPayloads.ParseUserProfile(Json("""
        { "data": { "open_id": "ou-1", "email": "zhangsan@feishu.cn" } }
        """));

        Assert.NotNull(profile);
        Assert.Equal("zhangsan@feishu.cn", profile!.Email);
        Assert.Equal("zhangsan@feishu.cn", profile.Name);
    }

    [Fact]
    public void UserInfoFlatPayload_IsSupported()
    {
        var profile = FeishuOAuthPayloads.ParseUserProfile(Json("""
        { "open_id": "ou-flat", "name": "李四", "user_id": "5d9bdxxx" }
        """));

        Assert.NotNull(profile);
        Assert.Equal("ou-flat", profile!.OpenId);
        Assert.Equal("5d9bdxxx", profile.UserId);
    }

    [Fact]
    public void UserInfoMissingOpenId_ReturnsNull()
    {
        var profile = FeishuOAuthPayloads.ParseUserProfile(Json("""
        { "code": 0, "data": { "name": "无身份" } }
        """));

        Assert.Null(profile);
    }

    [Fact]
    public void TokenError_PrefersNumericCode()
    {
        var error = FeishuOAuthPayloads.ParseTokenError(Json("""
        {
          "error": "invalid_grant",
          "error_description": "The authorization code is not found.",
          "code": 20003
        }
        """));

        Assert.Equal("20003", error.Code);
        Assert.Equal("The authorization code is not found.", error.Description);
    }

    [Fact]
    public void TokenErrorWithoutNumericCode_UsesErrorString()
    {
        var error = FeishuOAuthPayloads.ParseTokenError(Json("""
        { "error": "invalid_client", "error_description": "bad secret" }
        """));

        Assert.Equal("invalid_client", error.Code);
        Assert.Equal("bad secret", error.Description);
    }

    [Fact]
    public void AccessTokenAndScope_AreReadFromDataOrRoot()
    {
        var wrapped = Json("""
        { "code": 0, "data": { "access_token": "u-wrapped", "scope": "contact:user.email:readonly" } }
        """);
        var flat = Json("""
        { "access_token": "u-flat" }
        """);

        Assert.Equal("u-wrapped", FeishuOAuthPayloads.GetAccessToken(wrapped));
        Assert.Equal("contact:user.email:readonly", FeishuOAuthPayloads.GetGrantedScope(wrapped));
        Assert.Equal("u-flat", FeishuOAuthPayloads.GetAccessToken(flat));
        Assert.Null(FeishuOAuthPayloads.GetGrantedScope(flat));
    }
}