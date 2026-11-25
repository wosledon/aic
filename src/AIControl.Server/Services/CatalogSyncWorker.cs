using AIControl.Infrastructure;
using AIControl.Infrastructure.Catalog;

namespace AIControl.Server.Services;

public sealed class CatalogSyncWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<CatalogSyncWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                using var scope = scopeFactory.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<ModelsDevService>();
                try
                {
                    var result = await service.SyncAsync(stoppingToken);
                    if (result.Changed)
                    {
                        logger.LogInformation("models.dev synced: {Providers} providers, {Models} models, snapshot {Snapshot}",
                            result.Providers, result.Models, result.SnapshotId);
                    }
                    else if (result.Error is not null)
                    {
                        logger.LogWarning("models.dev sync failed: {Error}", result.Error);
                    }
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "models.dev sync crashed");
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
    }
}