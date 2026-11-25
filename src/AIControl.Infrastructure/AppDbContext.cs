using AIControl.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace AIControl.Infrastructure;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<FeishuAppConfig> FeishuAppConfigs => Set<FeishuAppConfig>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<DeviceCode> DeviceCodes => Set<DeviceCode>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ProjectMember> ProjectMembers => Set<ProjectMember>();
    public DbSet<ProjectRepo> ProjectRepos => Set<ProjectRepo>();
    public DbSet<CatalogSnapshot> CatalogSnapshots => Set<CatalogSnapshot>();
    public DbSet<ProviderTemplate> ProviderTemplates => Set<ProviderTemplate>();
    public DbSet<ModelTemplate> ModelTemplates => Set<ModelTemplate>();
    public DbSet<Channel> Channels => Set<Channel>();
    public DbSet<ChannelModel> ChannelModels => Set<ChannelModel>();
    public DbSet<PublicModel> PublicModels => Set<PublicModel>();
    public DbSet<AIControl.Domain.Policy> Policies => Set<AIControl.Domain.Policy>();
    public DbSet<Quota> Quotas => Set<Quota>();
    public DbSet<AgentSession> AgentSessions => Set<AgentSession>();
    public DbSet<AgentTurn> AgentTurns => Set<AgentTurn>();
    public DbSet<ToolDecision> ToolDecisions => Set<ToolDecision>();
    public DbSet<UsageEvent> UsageEvents => Set<UsageEvent>();
    public DbSet<TelemetryBatch> TelemetryBatches => Set<TelemetryBatch>();
    public DbSet<TelemetryEvent> TelemetryEvents => Set<TelemetryEvent>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(e =>
        {
            e.HasIndex(x => x.FeishuOpenId).IsUnique();
            e.HasIndex(x => x.UnionId);
            e.Property(x => x.Role).HasConversion<string>();
            e.Property(x => x.Status).HasConversion<string>();
        });

        modelBuilder.Entity<FeishuAppConfig>(e =>
        {
            e.Property(x => x.DefaultRole).HasConversion<string>();
        });

        modelBuilder.Entity<Device>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.UserId);
            e.Property(x => x.Status).HasConversion<string>();
        });

        modelBuilder.Entity<RefreshToken>(e =>
        {
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.UserId);
        });

        modelBuilder.Entity<DeviceCode>(e =>
        {
            e.HasIndex(x => x.Code).IsUnique();
            e.HasIndex(x => x.UserCode);
            e.Property(x => x.Status).HasConversion<string>();
        });

        modelBuilder.Entity<Project>(e =>
        {
            e.HasIndex(x => x.Key).IsUnique();
            e.Property(x => x.Status).HasConversion<string>();
        });

        modelBuilder.Entity<ProjectMember>(e =>
        {
            e.HasIndex(x => new { x.ProjectId, x.UserId }).IsUnique();
            e.HasOne(x => x.Project).WithMany(x => x.Members).HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ProjectRepo>(e =>
        {
            e.HasIndex(x => x.RepoHash).IsUnique();
            e.HasOne(x => x.Project).WithMany(x => x.Repos).HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<CatalogSnapshot>(e =>
        {
            e.Property(x => x.Status).HasConversion<string>();
            e.HasIndex(x => new { x.Source, x.FetchedAt });
        });

        modelBuilder.Entity<ProviderTemplate>(e =>
        {
            e.HasIndex(x => new { x.SnapshotId, x.ProviderKey }).IsUnique();
        });

        modelBuilder.Entity<ModelTemplate>(e =>
        {
            e.HasIndex(x => new { x.SnapshotId, x.ProviderTemplateId, x.ModelKey }).IsUnique();
            e.HasOne<ProviderTemplate>().WithMany().HasForeignKey(x => x.ProviderTemplateId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Channel>(e =>
        {
            e.Property(x => x.Protocol).HasConversion(x => x.ToWire(), x => ApiProtocols.Parse(x));
            e.Property(x => x.Status).HasConversion<string>();
        });

        modelBuilder.Entity<ChannelModel>(e =>
        {
            e.HasIndex(x => new { x.ChannelId, x.UpstreamModel }).IsUnique();
            e.HasOne(x => x.Channel).WithMany(x => x.Models).HasForeignKey(x => x.ChannelId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PublicModel>(e =>
        {
            e.HasIndex(x => x.Alias).IsUnique();
            e.Property(x => x.Protocol).HasConversion(x => x.ToWire(), x => ApiProtocols.Parse(x));
            e.Property(x => x.Status).HasConversion<string>();
            e.HasOne(x => x.ChannelModel).WithMany().HasForeignKey(x => x.ChannelModelId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<AIControl.Domain.Policy>(e =>
        {
            e.Property(x => x.ScopeType).HasConversion<string>();
            e.Property(x => x.Type).HasConversion<string>();
            e.HasIndex(x => new { x.ScopeType, x.ScopeId, x.Type });
        });

        modelBuilder.Entity<Quota>(e =>
        {
            e.Property(x => x.ScopeType).HasConversion<string>();
            e.Property(x => x.Period).HasConversion<string>();
            e.Property(x => x.Action).HasConversion<string>();
            e.HasIndex(x => new { x.ScopeType, x.ScopeId, x.Period }).IsUnique();
        });

        modelBuilder.Entity<AgentSession>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.StartedAt });
            e.HasIndex(x => x.PiSessionId);
        });

        modelBuilder.Entity<AgentTurn>(e =>
        {
            e.HasIndex(x => new { x.AgentSessionId, x.TurnIndex });
        });

        modelBuilder.Entity<ToolDecision>(e =>
        {
            e.HasIndex(x => x.EventId).IsUnique();
            e.HasIndex(x => new { x.ProjectId, x.OccurredAt });
            e.Property(x => x.Risk).HasConversion<string>();
            e.Property(x => x.Action).HasConversion<string>();
            e.Property(x => x.Source).HasConversion<string>();
        });

        modelBuilder.Entity<UsageEvent>(e =>
        {
            e.HasIndex(x => x.RequestId).IsUnique();
            e.HasIndex(x => new { x.ProjectId, x.OccurredAt });
            e.HasIndex(x => new { x.UserId, x.OccurredAt });
            e.HasIndex(x => new { x.PublicModelId, x.OccurredAt });
            e.Property(x => x.UsageSource).HasConversion<string>();
        });

        modelBuilder.Entity<TelemetryBatch>(e =>
        {
            e.HasIndex(x => new { x.DeviceId, x.BatchId }).IsUnique();
        });

        modelBuilder.Entity<TelemetryEvent>(e =>
        {
            e.HasIndex(x => x.EventId).IsUnique();
            e.HasIndex(x => new { x.Type, x.ReceivedAt });
        });

        modelBuilder.Entity<AuditLog>(e =>
        {
            e.HasIndex(x => x.CreatedAt);
            e.HasIndex(x => x.ActorUserId);
        });

        modelBuilder.Entity<AppSetting>(e =>
        {
            e.HasKey(x => x.Key);
        });
    }

    public override int SaveChanges()
    {
        TouchTimestamps();
        return base.SaveChanges();
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        TouchTimestamps();
        return base.SaveChangesAsync(cancellationToken);
    }

    private void TouchTimestamps()
    {
        foreach (EntityEntry entry in ChangeTracker.Entries())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified))
            {
                continue;
            }

            if (entry.Entity is EntityBase entity)
            {
                entity.UpdatedAt = DateTime.UtcNow;
            }
            else if (entry.Entity is Device device)
            {
                device.UpdatedAt = DateTime.UtcNow;
            }
            else if (entry.Entity is AppSetting setting)
            {
                setting.UpdatedAt = DateTime.UtcNow;
            }
        }
    }
}