# Monitoring & Maintenance

This guide covers monitoring, logging, health checks, and regular maintenance for VISTA.

## Health Checks

### Application Health Endpoint

```bash
# Basic health check
curl http://localhost:8000/health

# Expected response:
# {"status": "healthy"}

# Detailed health check (includes database and S3)
curl http://localhost:8000/health/detailed

# Expected response:
# {
#   "status": "healthy",
#   "database": "connected",
#   "storage": "accessible",
#   "timestamp": "2024-01-15T10:30:00Z"
# }
```

### Container Health Checks

**Docker:**
```bash
podman ps --format "table {{.Names}}\t{{.Status}}"

# View logs
podman logs -f vista

# Check resource usage
podman stats vista
```

**Kubernetes:**
```yaml
# In deployment.yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 5
  periodSeconds: 5
```

## Application Logging

### Log Configuration

```bash
# In .env
LOG_LEVEL=INFO              # DEBUG, INFO, WARNING, ERROR, CRITICAL
LOG_FILE_PATH=/var/log/image-manager/app.log
LOG_JSON=true               # JSON format for log aggregation
```

### Viewing Logs

**Docker:**
```bash
# Follow logs
podman logs -f vista

# Last 100 lines
podman logs --tail 100 vista

# Logs from last hour
podman logs --since 1h vista

# Save logs to file
podman logs vista > /var/log/podman-app.log 2>&1
```

**Kubernetes:**
```bash
# Pod logs
kubectl logs -f deployment/vista

# Previous pod logs (after crash)
kubectl logs --previous deployment/vista

# Logs from specific container
kubectl logs deployment/vista -c app

# Save logs
kubectl logs deployment/vista > app.log
```

**Direct file:**
```bash
tail -f /var/log/image-manager/app.log

# Filter errors
grep ERROR /var/log/image-manager/app.log

# JSON logs with jq
tail -f /var/log/image-manager/app.log | jq '.'
```

### Log Rotation

```bash
# /etc/logrotate.d/image-manager
/var/log/image-manager/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        podman kill -s HUP vista 2>/dev/null || true
    endscript
}
```

## Metrics & Monitoring

### Prometheus Integration

Enable Prometheus metrics:

```bash
# In .env
ENABLE_METRICS=true
```

Metrics available at `http://localhost:8000/metrics`:

- `http_requests_total` - Total HTTP requests
- `http_request_duration_seconds` - Request latency
- `http_requests_in_progress` - Current requests
- `database_connections` - Active database connections
- `s3_operations_total` - S3 operation count
- `s3_operation_duration_seconds` - S3 operation latency

### Prometheus Configuration

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'image-manager'
    static_configs:
      - targets: ['localhost:8000']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

### Grafana Dashboards

Create dashboard to visualize:
- Request rate and latency (p50, p95, p99)
- Error rate
- Database connection pool usage
- S3 operation metrics
- Memory and CPU usage
- Active users

Example queries:

```promql
# Request rate
rate(http_requests_total[5m])

# Error rate
rate(http_requests_total{status=~"5.."}[5m])

# 95th percentile latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Database connections
database_connections{state="active"}
```

### Alert Rules

```yaml
# alerts.yml
groups:
  - name: image_manager
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        annotations:
          summary: "High error rate detected"
          
      - alert: HighResponseTime
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 5
        for: 5m
        annotations:
          summary: "High response time (p95 > 5s)"
          
      - alert: DatabaseConnectionPoolExhausted
        expr: database_connections{state="waiting"} > 10
        for: 2m
        annotations:
          summary: "Database connection pool exhausted"
```

## System Monitoring

### Resource Usage

**Docker:**
```bash
# Container stats
podman stats vista --no-stream

# Detailed inspect
podman inspect vista | jq '.[0].State'
```

**System resources:**
```bash
# CPU and memory
top -p $(pgrep -f uvicorn)

# Disk usage
df -h

# Disk I/O
iostat -x 1

# Network I/O
iftop
```

### Database Monitoring

```sql
-- Active connections
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';

-- Slow queries
SELECT
    pid,
    now() - query_start AS duration,
    query
FROM pg_stat_activity
WHERE state = 'active'
    AND now() - query_start > interval '5 seconds'
ORDER BY duration DESC;

-- Database size
SELECT pg_size_pretty(pg_database_size('imagemanager'));

-- Cache hit ratio
SELECT
    sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) as cache_hit_ratio
FROM pg_statio_user_tables;
```

### Storage Monitoring

**MinIO:**
```bash
# Storage usage
mc du myminio/vista

# Monitoring metrics
curl http://localhost:9000/minio/v2/metrics/cluster
```

**AWS S3:**
```bash
# Bucket size
aws cloudwatch get-metric-statistics \
  --namespace AWS/S3 \
  --metric-name BucketSizeBytes \
  --dimensions Name=BucketName,Value=vista \
  --statistics Average \
  --start-time $(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400
```

## Log Aggregation

### ELK Stack (Elasticsearch, Logstash, Kibana)

**Docker Compose:**
```yaml
version: '3.8'
services:
  elasticsearch:
    image: elasticsearch:8.5.0
    environment:
      - discovery.type=single-node
    ports:
      - "9200:9200"
      
  logstash:
    image: logstash:8.5.0
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
    depends_on:
      - elasticsearch
      
  kibana:
    image: kibana:8.5.0
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch
```

**Logstash config:**
```ruby
# logstash.conf
input {
  file {
    path => "/var/log/image-manager/app.log"
    codec => json
    start_position => "beginning"
  }
}

filter {
  if [level] == "ERROR" {
    mutate {
      add_tag => ["error"]
    }
  }
}

output {
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "image-manager-%{+YYYY.MM.dd}"
  }
}
```

### Loki + Grafana

Lightweight alternative to ELK:

```yaml
# podman-compose.yml
services:
  loki:
    image: grafana/loki:latest
    ports:
      - "3100:3100"
    volumes:
      - loki-data:/loki
      
  promtail:
    image: grafana/promtail:latest
    volumes:
      - /var/log:/var/log
      - ./promtail-config.yml:/etc/promtail/config.yml
    depends_on:
      - loki
      
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    depends_on:
      - loki
```

## Application Updates

### Update Procedure

1. **Backup everything:**
   ```bash
   # Database backup
   pg_dump imagemanager > backup-$(date +%Y%m%d).sql
   
   # Configuration backup
   cp .env .env.backup-$(date +%Y%m%d)
   ```

2. **Pull latest code:**
   ```bash
   git pull origin main
   ```

3. **Rebuild image:**
   ```bash
   podman build -t vista:latest .
   ```

4. **Run migrations:**
   ```bash
   podman run --rm \
     --env-file .env \
     vista:latest \
     alembic upgrade head
   ```

5. **Stop old container:**
   ```bash
   podman stop vista
   podman rm vista
   ```

6. **Start new container:**
   ```bash
   podman run -d \
     --name vista \
     --env-file .env \
     --restart unless-stopped \
     vista:latest
   ```

7. **Verify deployment:**
   ```bash
   curl http://localhost:8000/health
   podman logs -f vista
   ```

### Zero-Downtime Updates

**Using Blue-Green Deployment:**

```bash
# Start new version on different port
podman run -d --name app-green -p 8001:8000 vista:latest

# Test new version
curl http://localhost:8001/health

# Update load balancer to point to new version
# (nginx, haproxy, etc.)

# Stop old version once confirmed
podman stop app-blue
podman rm app-blue

# Rename for next update
podman rename app-green app-blue
```

**Kubernetes Rolling Update:**
```bash
# Update image
kubectl set image deployment/vista \
  app=vista:v1.1.0

# Watch rollout
kubectl rollout status deployment/vista

# Rollback if needed
kubectl rollout undo deployment/vista
```

## Regular Maintenance Tasks

### Daily

- Monitor application health
- Review error logs
- Check disk space
- Verify backup completion

```bash
#!/bin/bash
# /usr/local/bin/daily-check.sh

echo "=== Daily Health Check $(date) ===" >> /var/log/maintenance.log

# Check application
curl -s http://localhost:8000/health || echo "App health check FAILED"

# Check disk space
df -h / | grep -v Filesystem >> /var/log/maintenance.log

# Check error logs
ERROR_COUNT=$(grep ERROR /var/log/image-manager/app.log | wc -l)
echo "Errors in last 24h: $ERROR_COUNT" >> /var/log/maintenance.log

# Check backup
LATEST_BACKUP=$(ls -t /backups/*.dump | head -1)
echo "Latest backup: $LATEST_BACKUP" >> /var/log/maintenance.log
```

Schedule with cron:
```bash
0 9 * * * /usr/local/bin/daily-check.sh
```

### Weekly

- Review performance metrics
- Analyze slow queries
- Check backup integrity
- Review access logs
- Update dependencies (security patches)

```bash
#!/bin/bash
# /usr/local/bin/weekly-maintenance.sh

# Vacuum database
psql -U postgres -d imagemanager -c "VACUUM ANALYZE;"

# Test backup restore (on staging)
# ...

# Check for updates
podman pull postgres:15
podman pull minio/minio:latest

# Generate report
echo "Weekly Maintenance Report $(date)" > /tmp/weekly-report.txt
echo "Database size: $(psql -U postgres -d imagemanager -c 'SELECT pg_size_pretty(pg_database_size(current_database()));')" >> /tmp/weekly-report.txt
# Email report
# ...
```

### Monthly

- Vacuum database
- Review and rotate logs
- Security audit
- Update all dependencies
- Review and update documentation
- Performance optimization review

### Quarterly

- Full security audit
- Disaster recovery test
- Rotate secrets (PROXY_SHARED_SECRET, etc.)
- Review and update monitoring alerts
- Capacity planning review

## Alerting

### Email Alerts

```bash
# Install mailutils
apt-get install mailutils

# Simple alert script
#!/bin/bash
# /usr/local/bin/send-alert.sh
SUBJECT="$1"
MESSAGE="$2"
RECIPIENT="admin@example.com"

echo "$MESSAGE" | mail -s "$SUBJECT" "$RECIPIENT"
```

### Slack Alerts

```bash
#!/bin/bash
# /usr/local/bin/slack-alert.sh
WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
MESSAGE="$1"

curl -X POST -H 'Content-type: application/json' \
  --data "{\"text\":\"$MESSAGE\"}" \
  "$WEBHOOK_URL"
```

### PagerDuty Integration

```python
# alert.py
import requests

def send_pagerduty_alert(message, severity='error'):
    url = 'https://events.pagerduty.com/v2/enqueue'
    headers = {'Content-Type': 'application/json'}
    payload = {
        'routing_key': 'YOUR_INTEGRATION_KEY',
        'event_action': 'trigger',
        'payload': {
            'summary': message,
            'severity': severity,
            'source': 'vista'
        }
    }
    requests.post(url, json=payload, headers=headers)
```

## Performance Monitoring

### Application Performance

Monitor:
- Response time (average, p95, p99)
- Throughput (requests per second)
- Error rate
- Active users
- Database query time
- S3 operation time

### Database Performance

```sql
-- Top slow queries
SELECT
    mean_exec_time,
    calls,
    query
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Table bloat
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Storage Performance

- Upload/download speed
- Request latency
- Error rate
- Storage quota usage

## Disaster Recovery Testing

### Test Procedure

1. **Document current state**
2. **Simulate failure** (stop database, corrupt data, etc.)
3. **Execute recovery procedure**
4. **Verify data integrity**
5. **Document recovery time**
6. **Update procedures based on lessons learned**

### Recovery Time Objectives

- **RTO** (Recovery Time Objective): 4 hours
- **RPO** (Recovery Point Objective): 24 hours

Test quarterly to ensure procedures are current.

## Next Steps

- [Review troubleshooting guide](troubleshooting.md)
- [Configure authentication](authentication.md)
- [Set up database backups](database.md#backup--recovery)
