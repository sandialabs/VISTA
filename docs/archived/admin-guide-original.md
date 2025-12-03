# Administrator Guide

This guide provides comprehensive information for system administrators deploying and maintaining the VISTA application.

## Table of Contents

1. [Overview](#overview)
2. [System Requirements](#system-requirements)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Authentication & Authorization](#authentication--authorization)
6. [Database Management](#database-management)
7. [Storage Configuration](#storage-configuration)
8. [Security](#security)
9. [Monitoring & Logging](#monitoring--logging)
10. [Backup & Recovery](#backup--recovery)
11. [Troubleshooting](#troubleshooting)
12. [Maintenance](#maintenance)

## Overview

VISTA is a full-stack web application for managing, classifying, and collaborating on visual content. It consists of:

- **Backend:** FastAPI (Python 3.11+) REST API
- **Frontend:** React 18 single-page application
- **Database:** PostgreSQL 15+ for metadata
- **Storage:** S3-compatible object storage (MinIO or AWS S3) for images

### Deployment Architectures

**Development/Testing:**
```
Docker (PostgreSQL + MinIO) <-> FastAPI Backend <-> React Frontend (dev server)
```

**Production:**
```
Users -> Reverse Proxy (nginx/Apache with auth) -> Application Container -> PostgreSQL
                                                                         -> S3/MinIO
```

## System Requirements

### Hardware Requirements

**Minimum (Development):**
- CPU: 2 cores
- RAM: 4 GB
- Disk: 20 GB (plus storage for images)

**Recommended (Production):**
- CPU: 4+ cores
- RAM: 8+ GB
- Disk: 50 GB (plus storage for images)
- Network: 1 Gbps

### Software Requirements

**Required:**
- Docker 20.10+ and Docker Compose 2.0+
- PostgreSQL 15+ (or Docker container)
- S3-compatible object storage (MinIO or AWS S3)
- Reverse proxy with authentication (nginx, Apache, etc.)

**For Development:**
- Python 3.11+
- Node.js 22+
- uv (Python package manager)

### Network Requirements

- HTTP/HTTPS access for web interface
- PostgreSQL port (default 5432)
- S3/MinIO endpoint (default 9000)
- All components should be on a trusted network or properly firewalled

## Installation

### Option 1: Docker Deployment (Recommended)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/garland3/yet-another-image-project-app.git
   cd yet-another-image-project-app
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your production settings
   ```

3. **Build the Docker image:**
   ```bash
   podman build -t vista:latest .
   ```

4. **Start infrastructure services:**
   ```bash
   # Start PostgreSQL and MinIO
   podman compose up -d postgres minio
   ```

5. **Run database migrations:**
   ```bash
   podman run --rm \
     --network host \
     -e DATABASE_URL="postgresql+asyncpg://postgres:password@localhost:5432/postgres" \
     vista:latest \
     alembic upgrade head
   ```

6. **Start the application:**
   ```bash
   podman run -d \
     --name vista \
     --network host \
     --env-file .env \
     vista:latest
   ```

### Option 2: Kubernetes Deployment

See `deployment-test/` directory for example Kubernetes manifests:

```bash
# Apply Kubernetes manifests
kubectl apply -f deployment-test/

# Check deployment status
kubectl get pods -l app=vista

# Access logs
kubectl logs -f deployment/vista
```

### Option 3: Manual Installation

1. **Install dependencies:**
   ```bash
   # Python backend
   pip install uv
   uv venv .venv
   source .venv/bin/activate
   uv pip install -r requirements.txt

   # Node.js frontend
   cd frontend
   npm install
   npm run build
   cd ..
   ```

2. **Set up infrastructure:**
   ```bash
   podman compose up -d postgres minio
   ```

3. **Run migrations:**
   ```bash
   cd backend
   alembic upgrade head
   ```

4. **Start the backend:**
   ```bash
   cd backend
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```

## Configuration

### Environment Variables

All configuration is done via environment variables or `.env` file. Key settings:

#### Application Settings

```bash
APP_NAME="VISTA"
DEBUG=false                    # MUST be false in production
FAST_TEST_MODE=false
SKIP_HEADER_CHECK=false       # MUST be false in production
```

#### Authentication

```bash
# Production: Reverse proxy authentication
PROXY_SHARED_SECRET=<generate-with-openssl-rand-hex-32>
X_USER_ID_HEADER=X-User-Email
X_PROXY_SECRET_HEADER=X-Proxy-Secret
AUTH_SERVER_URL=https://auth.example.com

# Development only: Mock user
MOCK_USER_EMAIL=admin@example.com
MOCK_USER_GROUPS_JSON='["admin-group"]'
```

#### Database

```bash
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<secure-password>
POSTGRES_DB=imagemanager
POSTGRES_SERVER=localhost
POSTGRES_PORT=5432
```

#### Storage (S3/MinIO)

```bash
S3_ENDPOINT=s3.amazonaws.com     # or localhost:9000 for MinIO
S3_ACCESS_KEY=<access-key>
S3_SECRET_KEY=<secret-key>
S3_BUCKET=vista
S3_USE_SSL=true                  # false for local MinIO
S3_REGION=us-east-1
```

#### ML Analysis (Optional)

```bash
ML_ANALYSIS_ENABLED=true
ML_CALLBACK_HMAC_SECRET=<secure-secret>
ML_ALLOWED_MODELS=yolo_v8,resnet50,custom_model
```

#### Security Headers

```bash
ALLOWED_ORIGINS=https://yourapp.example.com
CSP_POLICY="default-src 'self'; img-src 'self' data: https:;"
```

### Generating Secure Secrets

```bash
# Generate PROXY_SHARED_SECRET
openssl rand -hex 32

# Generate ML_CALLBACK_HMAC_SECRET
openssl rand -hex 32
```

## Authentication & Authorization

The application uses **header-based authentication** via reverse proxy.

### Authentication Flow

1. User accesses application through reverse proxy
2. Reverse proxy authenticates user (OAuth2, SAML, LDAP, etc.)
3. Proxy sets authentication headers on requests to backend
4. Backend validates headers and processes request

### Required Headers

The reverse proxy must set these headers:

- `X-User-Email`: Authenticated user's email address
- `X-Proxy-Secret`: Shared secret matching `PROXY_SHARED_SECRET`

### Reverse Proxy Configuration

#### Nginx Example

```nginx
upstream backend {
    server localhost:8000;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    # Authentication (example with OAuth2 Proxy)
    auth_request /oauth2/auth;
    error_page 401 = /oauth2/sign_in;

    location /oauth2/ {
        proxy_pass http://localhost:4180;
    }

    location / {
        # Set authentication headers
        auth_request_set $user $upstream_http_x_auth_request_email;
        proxy_set_header X-User-Email $user;
        proxy_set_header X-Proxy-Secret "your-shared-secret-here";

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_pass http://backend;
    }
}
```

See `docs/production/proxy-setup.md` for complete details.

### Group-Based Access Control

Projects belong to groups (`meta_group_id`). Users must be members of a project's group to access it.

#### Implementing Group Membership

Edit `backend/core/group_auth.py` and implement `_check_group_membership`:

```python
def _check_group_membership(user_email: str, group_id: str) -> bool:
    """
    Integrate with your auth system to check group membership.
    
    Examples:
    - Query LDAP/Active Directory
    - Call external auth API
    - Query local database
    """
    # Example: Call auth service
    response = requests.get(
        f"{settings.AUTH_SERVER_URL}/api/users/{user_email}/groups",
        headers={"Authorization": f"Bearer {settings.AUTH_API_TOKEN}"}
    )
    return group_id in response.json().get("groups", [])
```

### API Key Authentication

For programmatic access, users can generate API keys via the web interface.

**Usage:**
```bash
curl -H "X-API-Key: your-api-key" https://app.example.com/api/projects
```

## Database Management

### Database Migrations

**IMPORTANT:** Migrations are NEVER run automatically. This is intentional to prevent unexpected schema changes in production.

#### Applying Migrations

Always run migrations manually before starting the application:

```bash
cd backend
source .venv/bin/activate
alembic upgrade head
```

#### Creating New Migrations

After modifying `core/models.py`:

```bash
cd backend
alembic revision --autogenerate -m "description of changes"
# Review generated migration in alembic/versions/
alembic upgrade head
```

#### Migration Commands

```bash
alembic upgrade head           # Apply all pending migrations
alembic downgrade -1           # Rollback one migration
alembic history --verbose      # View migration history
alembic current                # Show current version
alembic stamp head             # Mark database as current (use cautiously)
```

#### Migration Best Practices

- Always review auto-generated migrations before applying
- Test migrations on a staging environment first
- Back up database before applying migrations in production
- Never modify existing migration files after they're applied
- Coordinate migrations with application deployments

### Database Backup

#### PostgreSQL Backup

```bash
# Full database backup
pg_dump -h localhost -p 5432 -U postgres -d imagemanager \
  -F custom -f backup-$(date +%Y%m%d-%H%M%S).dump

# Compressed backup
pg_dump -h localhost -p 5432 -U postgres -d imagemanager \
  | gzip > backup-$(date +%Y%m%d-%H%M%S).sql.gz
```

#### Automated Backups

Set up a cron job:

```bash
# /etc/cron.d/image-manager-backup
0 2 * * * postgres pg_dump -h localhost -U postgres imagemanager \
  -F custom -f /backups/imagemanager-$(date +\%Y\%m\%d).dump
```

#### Database Restore

```bash
# From custom format backup
pg_restore -h localhost -p 5432 -U postgres -d imagemanager backup.dump

# From SQL backup
gunzip -c backup.sql.gz | psql -h localhost -U postgres -d imagemanager
```

### Database Maintenance

#### Vacuum and Analyze

```bash
# Connect to database
psql -h localhost -U postgres -d imagemanager

# Run vacuum and analyze
VACUUM ANALYZE;

# Check database size
SELECT pg_size_pretty(pg_database_size('imagemanager'));
```

#### Connection Pooling

For high-traffic deployments, use PgBouncer:

```bash
# Install PgBouncer
apt-get install pgbouncer

# Configure /etc/pgbouncer/pgbouncer.ini
[databases]
imagemanager = host=localhost port=5432 dbname=imagemanager

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
auth_type = md5
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 20
```

Update `DATABASE_URL` to use PgBouncer port:
```bash
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:6432/imagemanager
```

## Storage Configuration

### MinIO (Self-Hosted)

#### Setup

```bash
# Start MinIO container
podman run -d \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadminpassword \
  -v /data/minio:/data \
  minio/minio server /data --console-address ":9001"
```

#### Create Bucket

```bash
# Install MinIO client
wget https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x mc
sudo mv mc /usr/local/bin/

# Configure client
mc alias set myminio http://localhost:9000 minioadmin minioadminpassword

# Create bucket
mc mb myminio/vista
mc policy set download myminio/vista
```

#### Configuration

```bash
S3_ENDPOINT=localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadminpassword
S3_BUCKET=vista
S3_USE_SSL=false
```

### AWS S3

#### Setup

1. Create S3 bucket in AWS Console
2. Create IAM user with S3 access
3. Grant bucket permissions

#### IAM Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket-name",
        "arn:aws:s3:::your-bucket-name/*"
      ]
    }
  ]
}
```

#### Configuration

```bash
S3_ENDPOINT=s3.amazonaws.com
S3_ACCESS_KEY=<aws-access-key-id>
S3_SECRET_KEY=<aws-secret-access-key>
S3_BUCKET=your-bucket-name
S3_USE_SSL=true
S3_REGION=us-east-1
```

### Storage Cleanup

Images marked for deletion are retained for 60 days by default before hard deletion.

#### Manual Cleanup

```bash
# Run cleanup script (if available)
python scripts/cleanup_deleted_images.py --dry-run
python scripts/cleanup_deleted_images.py --execute
```

#### Configure Retention Period

Set retention period in days (default: 60):

```bash
DELETION_RETENTION_DAYS=30
```

## Security

### Security Checklist

- [ ] Set `DEBUG=false` in production
- [ ] Set `SKIP_HEADER_CHECK=false` in production
- [ ] Generate strong `PROXY_SHARED_SECRET`
- [ ] Use HTTPS for all external communication
- [ ] Restrict backend access to reverse proxy only
- [ ] Enable firewall rules
- [ ] Use strong database passwords
- [ ] Rotate secrets regularly
- [ ] Keep dependencies updated
- [ ] Enable audit logging
- [ ] Set up monitoring and alerts

### Network Security

#### Firewall Rules

Restrict backend access to reverse proxy only:

```bash
# UFW (Ubuntu)
ufw allow from <proxy-ip> to any port 8000
ufw deny 8000

# iptables
iptables -A INPUT -p tcp --dport 8000 -s <proxy-ip> -j ACCEPT
iptables -A INPUT -p tcp --dport 8000 -j DROP
```

#### TLS/SSL Configuration

Always use TLS 1.2+ in production:

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
ssl_prefer_server_ciphers off;
```

### Security Headers

The application automatically sets these security headers:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: no-referrer`
- `Content-Security-Policy` (configurable via `CSP_POLICY`)

### Audit Logging

Enable comprehensive audit logging:

```bash
# Configure logging level
LOG_LEVEL=INFO  # DEBUG, INFO, WARNING, ERROR

# Enable audit trail
ENABLE_AUDIT_LOG=true
AUDIT_LOG_PATH=/var/log/image-manager/audit.log
```

### Regular Updates

Keep the application and dependencies updated:

```bash
# Update Python dependencies
uv pip install -r requirements.txt --upgrade

# Update Node.js dependencies
cd frontend
npm update

# Rebuild Docker image
podman build -t vista:latest .
```

## Monitoring & Logging

### Application Logs

Logs are written to stdout/stderr by default. In Docker:

```bash
# View logs
podman logs -f vista

# Save logs to file
podman logs vista > app.log 2>&1
```

### Health Checks

The application provides health check endpoints:

```bash
# Basic health check
curl http://localhost:8000/health

# Detailed health check (includes database and S3)
curl http://localhost:8000/health/detailed
```

### Monitoring with Prometheus

The application can expose metrics for Prometheus:

```bash
# Enable metrics endpoint
ENABLE_METRICS=true

# Metrics available at
curl http://localhost:8000/metrics
```

### Log Aggregation

Use a log aggregation service like ELK stack or Loki:

```yaml
# podman-compose.yml
services:
  app:
    logging:
      driver: "fluentd"
      options:
        fluentd-address: localhost:24224
        tag: image-manager
```

### Performance Monitoring

Monitor key metrics:

- Request latency (p50, p95, p99)
- Error rate
- Database query performance
- S3 operation latency
- Memory and CPU usage

## Backup & Recovery

### Complete Backup Strategy

1. **Database Backups:** Daily full backups, transaction logs
2. **S3 Storage:** Enable versioning and lifecycle policies
3. **Configuration:** Back up `.env` and configuration files
4. **Application Code:** Use version control (Git)

### Backup Script Example

```bash
#!/bin/bash
# /usr/local/bin/backup-image-manager.sh

BACKUP_DIR=/backups/image-manager
DATE=$(date +%Y%m%d-%H%M%S)

# Database backup
pg_dump -h localhost -U postgres imagemanager \
  -F custom -f $BACKUP_DIR/db-$DATE.dump

# Configuration backup
cp /app/.env $BACKUP_DIR/config-$DATE.env

# Compress and upload to remote storage
tar -czf $BACKUP_DIR/backup-$DATE.tar.gz $BACKUP_DIR/*-$DATE.*
aws s3 cp $BACKUP_DIR/backup-$DATE.tar.gz s3://backups/

# Cleanup old backups (keep 30 days)
find $BACKUP_DIR -name "*.dump" -mtime +30 -delete
```

### Disaster Recovery

#### Recovery Time Objective (RTO)

Target: 4 hours

1. Provision new infrastructure (1 hour)
2. Restore database (1 hour)
3. Deploy application (30 minutes)
4. Verify and test (1.5 hours)

#### Recovery Point Objective (RPO)

Target: 24 hours (daily backups)

For critical deployments, consider:
- Continuous database replication
- S3 cross-region replication
- Hot standby environment

## Troubleshooting

### Common Issues

#### Issue: Application won't start

**Symptoms:** Container exits immediately or application crashes

**Diagnosis:**
```bash
# Check logs
podman logs vista

# Common causes:
# - Database connection failed
# - Missing environment variables
# - Port already in use
```

**Solutions:**
- Verify `DATABASE_URL` is correct
- Ensure PostgreSQL is running
- Check all required environment variables are set
- Verify port 8000 is available

#### Issue: 401 Unauthorized

**Symptoms:** All API requests return 401

**Diagnosis:**
```bash
# Check authentication headers
curl -v -H "X-User-Email: user@example.com" \
     -H "X-Proxy-Secret: wrong-secret" \
     http://localhost:8000/api/projects

# Check logs for auth errors
podman logs vista | grep -i auth
```

**Solutions:**
- Verify `PROXY_SHARED_SECRET` matches between proxy and backend
- Ensure `SKIP_HEADER_CHECK=false` in production
- Check reverse proxy is setting headers correctly

#### Issue: 403 Forbidden

**Symptoms:** User can't access specific projects

**Diagnosis:**
- User not member of project's group
- `_check_group_membership` returning false

**Solutions:**
- Verify user's group membership in auth system
- Check group_id matches project's `meta_group_id`
- Review logs for authorization failures

#### Issue: Images not loading

**Symptoms:** Thumbnails or images fail to display

**Diagnosis:**
```bash
# Check S3 connection
aws s3 ls s3://your-bucket-name --endpoint-url http://localhost:9000

# Check backend logs
podman logs vista | grep -i s3
```

**Solutions:**
- Verify S3 credentials are correct
- Check S3 bucket exists and is accessible
- Ensure presigned URL generation is working
- Check S3 endpoint URL is correct

#### Issue: Database migration failed

**Symptoms:** Migration errors or schema inconsistencies

**Diagnosis:**
```bash
# Check current migration version
cd backend
alembic current

# View migration history
alembic history --verbose
```

**Solutions:**
- Never modify applied migrations
- Restore from backup if migration corrupted database
- Use `alembic downgrade` to rollback
- Create new migration to fix issues

### Debug Mode

For troubleshooting, enable debug mode (development only):

```bash
DEBUG=true
LOG_LEVEL=DEBUG
```

**Warning:** Never enable debug mode in production as it may expose sensitive information.

### Getting Help

- Check application logs first
- Review this guide and other documentation
- Check GitHub issues: https://github.com/garland3/yet-another-image-project-app/issues
- Contact support team

## Maintenance

### Regular Maintenance Tasks

#### Daily
- Monitor application health
- Review error logs
- Check disk space

#### Weekly
- Review performance metrics
- Analyze slow queries
- Check backup integrity

#### Monthly
- Update dependencies
- Review and rotate logs
- Vacuum database
- Review access logs and audit trail

#### Quarterly
- Security audit
- Review and update documentation
- Test disaster recovery procedures
- Performance optimization review

### Scaling

#### Horizontal Scaling

Run multiple application instances behind a load balancer:

```yaml
# podman-compose.yml
services:
  app:
    image: vista:latest
    deploy:
      replicas: 3
```

#### Vertical Scaling

Increase resources for single instance:

```yaml
services:
  app:
    image: vista:latest
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 8G
```

#### Database Scaling

- Use read replicas for read-heavy workloads
- Implement connection pooling (PgBouncer)
- Partition large tables by date or project

### Updates and Upgrades

#### Application Updates

```bash
# 1. Backup current state
./backup-image-manager.sh

# 2. Pull latest code
git pull origin main

# 3. Rebuild image
podman build -t vista:latest .

# 4. Run migrations
podman run --rm \
  --env-file .env \
  vista:latest \
  alembic upgrade head

# 5. Stop old container
podman stop vista

# 6. Start new container
podman run -d \
  --name vista \
  --env-file .env \
  vista:latest

# 7. Verify deployment
curl http://localhost:8000/health
```

#### Zero-Downtime Updates

Use blue-green deployment or rolling updates:

```bash
# Start new version
podman run -d --name image-manager-new -p 8001:8000 ...

# Test new version
curl http://localhost:8001/health

# Update load balancer to point to new version
# Once confirmed, stop old version
podman stop image-manager-old
```

## Appendix

### Port Reference

| Service | Default Port | Purpose |
|---------|-------------|---------|
| Backend API | 8000 | FastAPI application |
| Frontend Dev | 3000 | React development server |
| PostgreSQL | 5432 | Database |
| MinIO API | 9000 | S3-compatible storage |
| MinIO Console | 9001 | MinIO web interface |
| pgAdmin | 8080 | Database management UI |

### File Locations

| Path | Purpose |
|------|---------|
| `/app` | Application root (in container) |
| `/app/.env` | Environment configuration |
| `/app/backend` | Backend Python code |
| `/app/frontend/build` | Frontend static files |
| `/var/log/image-manager` | Application logs |
| `/backups` | Database backups |

### Environment Variable Reference

See `.env.example` for complete list of configuration options.

### Additional Resources

- Main README: `README.md`
- Developer Guide: `docs/developer-guide.md`
- User Guide: `docs/user-guide.md`
- Production Proxy Setup: `docs/production/proxy-setup.md`
- Database Schema: `docs/database-schema.txt`
