# Troubleshooting

This guide covers common issues and their solutions for VISTA.

## Diagnostic Tools

### Quick Health Check

```bash
# Application health
curl http://localhost:8000/health

# Docker container status
podman ps | grep vista

# Check logs
podman logs --tail 50 vista

# Database connection
psql -h localhost -U postgres -d imagemanager -c "SELECT 1;"

# S3 connection
aws s3 ls s3://vista/ --endpoint-url http://localhost:9000
```

### Diagnostic Script

```bash
#!/bin/bash
# /usr/local/bin/diagnose.sh

echo "=== System Diagnostics ==="
echo

echo "1. Application Status:"
podman ps | grep vista || echo "Container not running!"
echo

echo "2. Health Check:"
curl -s http://localhost:8000/health || echo "Health check FAILED"
echo

echo "3. Database:"
psql -h localhost -U postgres -d imagemanager -c "SELECT count(*) FROM projects;" 2>&1
echo

echo "4. Storage:"
mc du myminio/vista 2>&1 || echo "MinIO check failed"
echo

echo "5. Disk Space:"
df -h /
echo

echo "6. Memory:"
free -h
echo

echo "7. Recent Errors:"
podman logs --since 1h vista 2>&1 | grep -i error | tail -10
```

## Common Issues

### Application Won't Start

**Symptom:** Container exits immediately or fails to start

**Diagnosis:**
```bash
# Check logs
podman logs vista

# Check for common errors:
# - "connection refused" (database)
# - "connection timeout" (S3)
# - "missing environment variable"
# - "port already in use"
```

**Solutions:**

1. **Database connection failed:**
   ```bash
   # Verify DATABASE_URL is correct
   echo $DATABASE_URL
   
   # Test database connection
   psql -h localhost -U postgres -d imagemanager
   
   # Check if PostgreSQL is running
   podman ps | grep postgres
   sudo systemctl status postgresql
   ```

2. **Port already in use:**
   ```bash
   # Check what's using port 8000
   sudo lsof -i :8000
   
   # Kill process or use different port
   podman run -p 8001:8000 vista
   ```

3. **Missing environment variables:**
   ```bash
   # Check .env file exists
   ls -la .env
   
   # Verify required variables are set
   grep DATABASE_URL .env
   grep S3_ENDPOINT .env
   ```

4. **Permission errors:**
   ```bash
   # Check file permissions
   ls -l .env
   
   # Ensure app can read .env
   chmod 644 .env
   ```

### 401 Unauthorized Errors

**Symptom:** All API requests return 401 Unauthorized

**Diagnosis:**
```bash
# Test without authentication
curl -v http://localhost:8000/api/projects

# Test with headers
curl -v \
  -H "X-User-Email: user@example.com" \
  -H "X-Proxy-Secret: your-secret" \
  http://localhost:8000/api/projects

# Check auth configuration
grep SKIP_HEADER_CHECK .env
grep PROXY_SHARED_SECRET .env
```

**Solutions:**

1. **Development mode not enabled:**
   ```bash
   # Enable mock user for development
   echo "SKIP_HEADER_CHECK=true" >> .env
   echo 'MOCK_USER_EMAIL=dev@example.com' >> .env
   echo 'MOCK_USER_GROUPS_JSON=["admin-group"]' >> .env
   
   # Restart application
   podman restart vista
   ```

2. **Wrong shared secret:**
   ```bash
   # Verify secret matches between proxy and backend
   # Check reverse proxy configuration
   # Generate new secret if needed
   openssl rand -hex 32
   ```

3. **Headers not being set:**
   ```bash
   # Check reverse proxy configuration
   # Verify headers are being passed through
   # Test with curl including headers
   ```

### 403 Forbidden Errors

**Symptom:** User can't access specific projects

**Diagnosis:**
```bash
# Check user's groups
curl -H "X-User-Email: user@example.com" \
     -H "X-Proxy-Secret: secret" \
     http://localhost:8000/api/user/me

# Check project's group
curl http://localhost:8000/api/projects/{project_id} | jq '.meta_group_id'

# Check logs for authorization errors
podman logs vista | grep -i "403\|forbidden\|authorization"
```

**Solutions:**

1. **User not in project's group:**
   ```bash
   # Verify user is member of project's group in your auth system
   # Or update _check_group_membership in backend/core/group_auth.py
   ```

2. **Group membership check failing:**
   ```bash
   # Check if CHECK_MOCK_MEMBERSHIP=true for development
   # Verify auth server is accessible
   # Check network connectivity to auth system
   ```

### Images Not Loading

**Symptom:** Images fail to display or return 404

**Diagnosis:**
```bash
# Check if image exists in database
psql -h localhost -U postgres -d imagemanager \
  -c "SELECT id, filename, object_storage_key FROM data_instances LIMIT 5;"

# Check if image exists in S3
mc ls myminio/vista/projects/
aws s3 ls s3://vista/projects/

# Test presigned URL generation
curl http://localhost:8000/api/images/{image_id}/download
```

**Solutions:**

1. **S3 connection issues:**
   ```bash
   # Verify S3 configuration
   grep S3_ .env
   
   # Test S3 connection
   aws s3 ls --endpoint-url http://localhost:9000
   mc admin info myminio
   ```

2. **Wrong S3 credentials:**
   ```bash
   # Update credentials
   S3_ACCESS_KEY=correct-key
   S3_SECRET_KEY=correct-secret
   
   # Restart application
   podman restart vista
   ```

3. **Deleted images:**
   ```bash
   # Check if image is soft-deleted
   psql -h localhost -U postgres -d imagemanager \
     -c "SELECT deleted_at FROM data_instances WHERE id = 'uuid';"
   
   # Enable show deleted in UI
   ```

### Database Migration Failures

**Symptom:** Migration command fails with errors

**Diagnosis:**
```bash
# Check current migration version
cd backend
alembic current

# View migration history
alembic history --verbose

# Check for pending migrations
alembic heads

# Review logs
alembic upgrade head 2>&1 | tee migration.log
```

**Solutions:**

1. **Schema already exists:**
   ```bash
   # Mark current schema version
   alembic stamp head
   
   # Then apply new migrations
   alembic upgrade head
   ```

2. **Migration conflicts:**
   ```bash
   # Resolve by creating merge migration
   alembic merge heads
   
   # Review and edit merge migration
   # Then apply
   alembic upgrade head
   ```

3. **Data conflicts:**
   ```bash
   # Manually fix data issues
   psql -h localhost -U postgres -d imagemanager
   
   # Then retry migration
   alembic upgrade head
   ```

4. **Rollback failed migration:**
   ```bash
   # Downgrade to previous version
   alembic downgrade -1
   
   # Fix issue and retry
   alembic upgrade head
   ```

### Upload Failures

**Symptom:** Image uploads fail or timeout

**Diagnosis:**
```bash
# Check upload logs
podman logs vista | grep -i "upload\|POST /api/images"

# Test file upload
curl -X POST \
  -F "file=@test-image.jpg" \
  -F "project_id=project-uuid" \
  http://localhost:8000/api/images/upload

# Check disk space
df -h

# Check S3 storage
mc du myminio/vista
```

**Solutions:**

1. **File too large:**
   ```bash
   # Check file size limits
   grep MAX_UPLOAD_SIZE .env
   
   # Increase if needed
   MAX_UPLOAD_SIZE=52428800  # 50 MB
   ```

2. **Disk space full:**
   ```bash
   # Clean up old files
   podman system prune
   
   # Clear logs
   truncate -s 0 /var/log/image-manager/*.log
   
   # Remove old backups
   find /backups -mtime +30 -delete
   ```

3. **S3 storage quota:**
   ```bash
   # Check S3 usage
   mc du myminio/vista
   
   # Clean up old files
   # Or increase storage capacity
   ```

### High Memory Usage

**Symptom:** Application using excessive memory

**Diagnosis:**
```bash
# Check memory usage
podman stats vista --no-stream

# Check for memory leaks in logs
podman logs vista | grep -i "memory\|oom"

# Monitor Python process
top -p $(podman inspect -f '{{.State.Pid}}' vista)
```

**Solutions:**

1. **Increase memory limit:**
   ```bash
   # Docker
   podman run -d --memory="4g" vista
   
   # podman-compose.yml
   services:
     app:
       deploy:
         resources:
           limits:
             memory: 4G
   ```

2. **Optimize cache settings:**
   ```bash
   # Reduce cache size
   CACHE_SIZE_MB=500
   CACHE_TTL=300
   
   # Clear cache
   podman exec vista rm -rf /tmp/cache/*
   ```

3. **Restart application periodically:**
   ```bash
   # Add to crontab (daily restart at 3 AM)
   0 3 * * * podman restart vista
   ```

### Slow Performance

**Symptom:** Application responds slowly

**Diagnosis:**
```bash
# Check response times
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:8000/api/projects

# curl-format.txt:
# time_total: %{time_total}s
# time_connect: %{time_connect}s
# time_starttransfer: %{time_starttransfer}s

# Check database slow queries
psql -h localhost -U postgres -d imagemanager -c "
SELECT pid, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND now() - query_start > interval '1 second'
ORDER BY duration DESC;"

# Check system resources
top
iostat -x 1
```

**Solutions:**

1. **Database needs optimization:**
   ```bash
   # Vacuum and analyze
   psql -h localhost -U postgres -d imagemanager -c "VACUUM ANALYZE;"
   
   # Add missing indexes
   psql -h localhost -U postgres -d imagemanager -c "
   CREATE INDEX IF NOT EXISTS idx_images_project ON data_instances(project_id);
   CREATE INDEX IF NOT EXISTS idx_images_deleted ON data_instances(deleted_at) WHERE deleted_at IS NULL;"
   ```

2. **Too many connections:**
   ```bash
   # Increase connection pool
   DB_POOL_SIZE=20
   DB_MAX_OVERFLOW=10
   
   # Or use PgBouncer for connection pooling
   ```

3. **Cache not working:**
   ```bash
   # Enable caching
   CACHE_TTL=300
   
   # Clear and rebuild cache
   podman exec vista rm -rf /tmp/cache/*
   podman restart vista
   ```

4. **S3 latency:**
   ```bash
   # Use CDN for static content
   # Enable transfer acceleration (AWS S3)
   # Consider local caching
   ```

### Container Crashes

**Symptom:** Container keeps restarting

**Diagnosis:**
```bash
# Check exit code
podman inspect vista | jq '.[0].State'

# View crash logs
podman logs vista

# Check events
podman events --filter container=vista

# Check for OOM kills
dmesg | grep -i "out of memory"
```

**Solutions:**

1. **Out of memory:**
   ```bash
   # Increase memory limit
   podman run -d --memory="4g" --memory-swap="4g" vista
   ```

2. **Uncaught exceptions:**
   ```bash
   # Check logs for stack traces
   podman logs vista | grep -A 20 "Traceback"
   
   # Fix code issue and redeploy
   ```

3. **Database connection issues:**
   ```bash
   # Add connection retry logic
   # Increase connection timeout
   # Check database is healthy
   ```

### CORS Errors

**Symptom:** Browser console shows CORS errors

**Diagnosis:**
```bash
# Check CORS configuration
grep ALLOWED_ORIGINS .env

# Test CORS headers
curl -H "Origin: https://example.com" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: X-Requested-With" \
     -X OPTIONS \
     http://localhost:8000/api/projects
```

**Solutions:**

1. **Update CORS origins:**
   ```bash
   # In .env
   ALLOWED_ORIGINS=https://app.example.com,https://www.example.com
   
   # Or allow all for development (NOT for production!)
   ALLOWED_ORIGINS=*
   
   # Restart
   podman restart vista
   ```

2. **Check reverse proxy:**
   ```nginx
   # nginx.conf
   add_header 'Access-Control-Allow-Origin' 'https://app.example.com' always;
   add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS, PUT, DELETE' always;
   add_header 'Access-Control-Allow-Headers' 'X-User-Email,X-Proxy-Secret,Content-Type' always;
   ```

## Error Code Reference

### HTTP Status Codes

- **400 Bad Request** - Invalid input data
- **401 Unauthorized** - Missing or invalid authentication
- **403 Forbidden** - Insufficient permissions
- **404 Not Found** - Resource doesn't exist
- **409 Conflict** - Resource already exists or conflict
- **413 Payload Too Large** - File too large
- **422 Unprocessable Entity** - Validation error
- **500 Internal Server Error** - Server-side error
- **503 Service Unavailable** - Service temporarily unavailable

### Application Error Codes

Check logs for specific error messages:

- `DATABASE_CONNECTION_ERROR` - Can't connect to PostgreSQL
- `S3_CONNECTION_ERROR` - Can't connect to S3/MinIO
- `AUTHENTICATION_FAILED` - Auth header validation failed
- `AUTHORIZATION_FAILED` - User lacks permission
- `VALIDATION_ERROR` - Input validation failed
- `MIGRATION_ERROR` - Database migration failed

## Getting More Help

### Enable Debug Logging

```bash
# In .env (development only!)
DEBUG=true
LOG_LEVEL=DEBUG

# Restart
podman restart vista

# View detailed logs
podman logs -f vista
```

**Warning:** Never enable DEBUG=true in production!

### Collect Diagnostic Information

```bash
#!/bin/bash
# collect-diagnostics.sh

REPORT_FILE="diagnostics-$(date +%Y%m%d-%H%M%S).txt"

echo "=== Diagnostics Report ===" > $REPORT_FILE
echo "Date: $(date)" >> $REPORT_FILE
echo >> $REPORT_FILE

echo "=== System Info ===" >> $REPORT_FILE
uname -a >> $REPORT_FILE
echo >> $REPORT_FILE

echo "=== Docker Version ===" >> $REPORT_FILE
podman --version >> $REPORT_FILE
echo >> $REPORT_FILE

echo "=== Container Status ===" >> $REPORT_FILE
podman ps >> $REPORT_FILE
echo >> $REPORT_FILE

echo "=== Application Logs (last 100 lines) ===" >> $REPORT_FILE
podman logs --tail 100 vista >> $REPORT_FILE 2>&1
echo >> $REPORT_FILE

echo "=== Database Status ===" >> $REPORT_FILE
psql -h localhost -U postgres -d imagemanager -c "SELECT version();" >> $REPORT_FILE 2>&1
echo >> $REPORT_FILE

echo "=== Disk Usage ===" >> $REPORT_FILE
df -h >> $REPORT_FILE
echo >> $REPORT_FILE

echo "=== Memory Usage ===" >> $REPORT_FILE
free -h >> $REPORT_FILE
echo >> $REPORT_FILE

echo "Report saved to: $REPORT_FILE"
```

### Support Resources

1. **Documentation:**
   - [Admin Guide](../admin-guide.md)
   - [User Guide](../user-guide.md)
   - [Developer Guide](../developer-guide.md)

2. **API Documentation:**
   - http://localhost:8000/docs

3. **GitHub Issues:**
   - https://github.com/garland3/yet-another-image-project-app/issues

4. **Contact:**
   - Create a GitHub issue with:
     - Clear description of the problem
     - Steps to reproduce
     - Error messages and logs
     - System information (OS, Docker version, etc.)
     - Diagnostic report output

## Preventive Measures

To avoid common issues:

1. **Regular backups** - Database and configuration
2. **Monitor disk space** - Set up alerts
3. **Keep updated** - Regular updates and security patches
4. **Test in staging** - Before production deployment
5. **Document changes** - Track configuration changes
6. **Monitor logs** - Regular log review
7. **Health checks** - Automated monitoring
8. **Capacity planning** - Monitor growth trends
9. **Security audits** - Regular security reviews
10. **Disaster recovery testing** - Test backups work

## Next Steps

- [Review monitoring guide](monitoring.md)
- [Set up proper authentication](authentication.md)
- [Configure regular backups](database.md#backup--recovery)
