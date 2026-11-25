using AIControl.Infrastructure;
using AIControl.Infrastructure.Telemetry;

namespace AIControl.Server.Services;

public sealed class UsageWriterService(
    UsageEventQueue queue,
    IServiceScopeFactory scopeFactory,
    ILogger<UsageWriterService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var batch = new List<AIControl.Domain.UsageEvent>(128);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var first = await queue.ReadAsync(stoppingToken);
                batch.Add(first);
                while (batch.Count < 128 && queue.TryRead(out var next) && next is not null)
                {
                    batch.Add(next);
                }

                using var scope = scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.UsageEvents.AddRange(batch);
                await db.SaveChangesAsync(stoppingToken);
                batch.Clear();
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to persist usage batch of {Count}", batch.Count);
                batch.Clear();
                await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            }
        }
    }
}