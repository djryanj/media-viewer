# Administration Overview

This section covers server administration, configuration, and monitoring for Media Viewer.

## Configuration

- **[Server Configuration](server-config.md)** - Directory structure, Docker deployment, and performance tuning
- **[Environment Variables](environment-variables.md)** - Complete environment variable reference
- **[Security](security.md)** - Authentication, session management, and security best practices

## Monitoring & Operations

- **[Metrics & Monitoring](metrics.md)** - Prometheus metrics for performance monitoring and alerting
- **[Thumbnail Management](thumbnails.md)** - Thumbnail generation, caching, and maintenance

## Advanced Features

- **[WebAuthn Setup](webauthn.md)** - Passwordless authentication with passkeys

## Common Tasks

### Deployment

1. Configure [environment variables](environment-variables.md) for your paths and settings
2. Set up volume mounts for media, cache, and database directories
3. Configure [security settings](security.md) including strong passwords
4. Review [server configuration](server-config.md) for performance tuning

### Monitoring

1. Enable [Prometheus metrics](metrics.md) endpoint at `/metrics`
2. Configure Prometheus to scrape your Media Viewer instance
3. Import the provided Grafana dashboard from `hack/grafana/dashboard.json`
4. Set up alerts for indexer failures, high latency, and memory pressure

### Maintenance

- **Clear Thumbnail Cache**: Use the clear cache button to regenerate all thumbnails
- **Database Vacuum**: Runs automatically during indexing to reclaim space
- **Session Cleanup**: Expired sessions are automatically removed
- **Cache Management**: Monitor cache size via [metrics](metrics.md)

## Performance Tuning

Use [Prometheus metrics](metrics.md) to identify bottlenecks:

- **Filesystem Latency**: Critical for NFS deployments - monitor `filesystem_operation_duration`
- **Indexing Performance**: Track `indexer_files_per_second` and batch processing times
- **Thumbnail Generation**: Analyze phase timing (decode/resize/encode) to optimize
- **Memory Usage**: Monitor memory metrics to tune `GOMEMLIMIT`
- **Database Performance**: Watch transaction durations and query latencies

See [Metrics & Monitoring](metrics.md) for detailed guidance.

## Troubleshooting

For common issues and solutions, see the [Troubleshooting Guide](../troubleshooting.md).

Key troubleshooting resources:

- Check application logs for errors
- Review metrics for performance anomalies
- Validate file permissions on mounted volumes
- Verify FFmpeg is available for video/image processing
