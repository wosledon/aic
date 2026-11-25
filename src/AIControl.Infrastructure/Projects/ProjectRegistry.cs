using System.Text;
using AIControl.Domain;
using Microsoft.EntityFrameworkCore;

namespace AIControl.Infrastructure.Projects;

/// <summary>
/// Projects are reported by plugins and gateways rather than manually maintained.
/// This helper normalizes a reported key, auto-creates the project and records
/// the reporting user as a member.
/// </summary>
public static class ProjectRegistry
{
    public static string? NormalizeKey(string? key)
    {
        if (string.IsNullOrWhiteSpace(key)) return null;
        var builder = new StringBuilder(Math.Min(key.Length, 128));
        foreach (var ch in key.Trim().ToLowerInvariant())
        {
            if (char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_' or '.')
            {
                builder.Append(ch);
            }
            else if (ch is '/' or ':' or '\\' or ' ' or '@')
            {
                if (builder.Length > 0 && builder[^1] != '-') builder.Append('-');
            }
            if (builder.Length >= 128) break;
        }
        var normalized = builder.ToString().Trim('-', '.', '_');
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    public static async Task<Project> EnsureAsync(
        AppDbContext db,
        string projectKey,
        string? projectName,
        Guid userId,
        string source,
        CancellationToken cancellationToken)
    {
        var key = NormalizeKey(projectKey) ?? throw new InvalidOperationException("项目标识无效。");
        var project = await db.Projects.FirstOrDefaultAsync(x => x.Key == key, cancellationToken);
        if (project is null)
        {
            project = new Project
            {
                Key = key,
                Name = string.IsNullOrWhiteSpace(projectName) ? key : projectName.Trim()[..Math.Min(projectName.Trim().Length, 200)],
                Status = ProjectStatus.Active
            };
            db.Projects.Add(project);
        }
        else if (project.Name == project.Key && !string.IsNullOrWhiteSpace(projectName))
        {
            project.Name = projectName.Trim()[..Math.Min(projectName.Trim().Length, 200)];
        }

        if (userId != Guid.Empty && !await db.ProjectMembers.AnyAsync(x => x.ProjectId == project.Id && x.UserId == userId, cancellationToken))
        {
            db.ProjectMembers.Add(new ProjectMember
            {
                ProjectId = project.Id,
                UserId = userId,
                Source = source
            });
        }
        return project;
    }
}