# Administrator Guide

This guide provides comprehensive information for system administrators deploying and maintaining the VISTA application.

## Guide Structure

This administrator guide is organized into the following sections:

### Core Documentation

1. **[Installation & Deployment](admin/installation.md)** - Installation options, Docker, Kubernetes
2. **[Configuration](admin/configuration.md)** - Environment variables, application settings
3. **[Authentication & Security](admin/authentication.md)** - Reverse proxy setup, authentication, security hardening
4. **[Database Management](admin/database.md)** - Migrations, backups, maintenance
5. **[Storage Configuration](admin/storage.md)** - S3/MinIO setup and management
6. **[Monitoring & Maintenance](admin/monitoring.md)** - Logging, health checks, updates
7. **[Troubleshooting](admin/troubleshooting.md)** - Common issues and solutions

### Quick Links

- [System Requirements](admin/installation.md#system-requirements)
- [Quick Start Installation](admin/installation.md#podman-deployment-recommended)
- [Environment Configuration](admin/configuration.md)
- [Reverse Proxy Setup](admin/authentication.md#reverse-proxy-configuration)
- [Database Migrations](admin/database.md#database-migrations)
- [Security Checklist](admin/authentication.md#security-checklist)

## Overview

VISTA is a full-stack web application for managing, classifying, and collaborating on visual content.

### Architecture

**Components:**
- **Backend:** FastAPI (Python 3.11+) REST API
- **Frontend:** React 18 single-page application
- **Database:** PostgreSQL 15+ for metadata
- **Storage:** S3-compatible object storage (MinIO or AWS S3) for images

**Deployment Patterns:**

**Development/Testing:**
```
Docker (PostgreSQL + MinIO) <-> FastAPI Backend <-> React Frontend (dev server)
```

**Production:**
```
Users -> Reverse Proxy (nginx/Apache) -> Application Container -> PostgreSQL
                                                                -> S3/MinIO
```

## Getting Started

For administrators new to this application:

1. Review [System Requirements](admin/installation.md#system-requirements)
2. Choose your [Deployment Method](admin/installation.md)
3. Configure [Environment Variables](admin/configuration.md)
4. Set up [Authentication](admin/authentication.md)
5. Configure [Database](admin/database.md) and run migrations
6. Set up [Storage](admin/storage.md) (S3 or MinIO)
7. Enable [Monitoring](admin/monitoring.md)
8. Review [Security Checklist](admin/authentication.md#security-checklist)

## Production Deployment Checklist

Essential steps for production deployment:

- [ ] Review system requirements and provision hardware
- [ ] Install and configure PostgreSQL 15+
- [ ] Set up S3-compatible storage (MinIO or AWS S3)
- [ ] Generate secure secrets (PROXY_SHARED_SECRET, ML_CALLBACK_HMAC_SECRET)
- [ ] Configure environment variables
- [ ] Set up reverse proxy with authentication
- [ ] Configure firewall rules
- [ ] Run database migrations
- [ ] Enable HTTPS/TLS
- [ ] Set up automated backups
- [ ] Configure monitoring and logging
- [ ] Test authentication and authorization
- [ ] Perform security audit

## Support Resources

- **User Guide:** `/docs/user-guide.md` - For end users
- **Developer Guide:** `/docs/developer-guide.md` - For developers
- **API Documentation:** `http://your-server:8000/docs` - Interactive API docs
- **Production Proxy Setup:** `/docs/production/proxy-setup.md` - Detailed reverse proxy configuration
- **GitHub Repository:** https://github.com/garland3/yet-another-image-project-app

## Additional Information

### Port Reference

| Service | Default Port | Purpose |
|---------|-------------|---------|
| Backend API | 8000 | FastAPI application |
| Frontend Dev | 3000 | React development server |
| PostgreSQL | 5432 | Database |
| MinIO API | 9000 | S3-compatible storage |
| MinIO Console | 9001 | MinIO web interface |
| pgAdmin | 8080 | Database management UI |

### Key Concepts

- **Project** - Top-level organizational unit with group-based access
- **Group** - Set of users with access to specific projects
- **Soft Delete** - Recoverable deletion with retention period
- **Hard Delete** - Permanent deletion after retention period
- **API Key** - Authentication token for programmatic access
- **ML Analysis** - Machine learning results integrated via API

## Quick Reference

### Common Commands

```bash
# Start infrastructure
podman compose up -d postgres minio

# Run database migrations
cd backend && alembic upgrade head

# Start application
cd backend && uvicorn main:app --host 0.0.0.0 --port 8000

# View logs
podman logs -f vista

# Backup database
pg_dump -h localhost -U postgres imagemanager > backup.sql

# Check application health
curl http://localhost:8000/health
```

### Environment Files

- `.env` - Main configuration file
- `.env.example` - Template with all options

### Important Directories

- `/app/backend` - Backend Python code
- `/app/frontend/build` - Frontend static files
- `/var/log/image-manager` - Application logs
- `/backups` - Database backups

## Need Help?

1. Check the relevant section in this guide
2. Review troubleshooting documentation
3. Check application logs
4. Consult the API documentation
5. Contact support team or file an issue on GitHub
