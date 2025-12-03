# Database Management

This guide covers PostgreSQL database setup, migrations, backups, and maintenance.

## Database Setup

### PostgreSQL Installation

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql-15 postgresql-contrib-15
```

**CentOS/RHEL:**
```bash
sudo dnf install postgresql15-server postgresql15-contrib
sudo postgresql-15-setup initdb
sudo systemctl enable postgresql-15
sudo systemctl start postgresql-15
```

**Docker:**
```bash
podman run -d \
  --name postgres \
  -e POSTGRES_PASSWORD=your-password \
  -e POSTGRES_DB=imagemanager \
  -v postgres-data:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgres:15
```

### Initial Configuration

Create database and user:

```bash
# Connect as postgres user
sudo -u postgres psql

# Create database
CREATE DATABASE imagemanager;

# Create user
CREATE USER imagemanager_user WITH PASSWORD 'secure-password';

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE imagemanager TO imagemanager_user;

# Exit
\q
```

### Connection Configuration

Configure `postgresql.conf` for network access:

```bash
# Edit postgresql.conf
sudo nano /etc/postgresql/15/main/postgresql.conf

# Listen on all interfaces (or specific IP)
listen_addresses = '*'

# Adjust connection limits
max_connections = 100
```

Configure `pg_hba.conf` for authentication:

```bash
# Edit pg_hba.conf
sudo nano /etc/postgresql/15/main/pg_hba.conf

# Add entries
# TYPE  DATABASE        USER            ADDRESS                 METHOD
host    imagemanager    imagemanager_user    10.0.0.0/8         md5
host    imagemanager    imagemanager_user    172.16.0.0/12      md5
host    imagemanager    imagemanager_user    192.168.0.0/16     md5
```

Restart PostgreSQL:
```bash
sudo systemctl restart postgresql
```

## Database Migrations

**CRITICAL:** Migrations are NEVER run automatically. This prevents accidental schema changes in production.

### Why Manual Migrations?

Manual migrations prevent:
- Accidental schema changes in production
- Race conditions with multiple application instances
- Unexpected downtime during deployments
- Loss of control over when schema changes occur

### Running Migrations

Always run migrations manually before starting/updating the application:

```bash
cd backend
source .venv/bin/activate
alembic upgrade head
```

**Docker:**
```bash
podman run --rm \
  -e DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/db" \
  vista:latest \
  alembic upgrade head
```

**Kubernetes:**
```bash
kubectl run alembic-migrate \
  --image=vista:latest \
  --restart=Never \
  --env="DATABASE_URL=postgresql+asyncpg://user:pass@postgres:5432/db" \
  -- alembic upgrade head

# Check logs
kubectl logs alembic-migrate

# Clean up
kubectl delete pod alembic-migrate
```

### Creating New Migrations

After modifying models in `backend/core/models.py`:

```bash
cd backend
alembic revision --autogenerate -m "describe your changes"
```

**ALWAYS review the generated migration file** before applying:

```bash
# View generated migration
cat alembic/versions/<revision>_*.py

# Review changes carefully:
# - Ensure no data loss
# - Check column types
# - Verify constraints
# - Confirm indexes
```

Apply after review:
```bash
alembic upgrade head
```

### Migration Commands

```bash
# Show current database version
alembic current

# View migration history
alembic history --verbose

# Upgrade to latest
alembic upgrade head

# Upgrade to specific revision
alembic upgrade <revision>

# Downgrade one migration
alembic downgrade -1

# Downgrade to specific revision
alembic downgrade <revision>

# Mark database as current (use cautiously!)
alembic stamp head

# Generate SQL for migration (don't apply)
alembic upgrade head --sql
```

### Migration Best Practices

1. **Always backup before migrations**
2. **Test in staging first**
3. **Review auto-generated migrations**
4. **Never modify applied migrations**
5. **Coordinate with deployments**
6. **Document complex migrations**
7. **Plan for rollback scenarios**

### Common Migration Patterns

**Adding a column:**
```python
def upgrade():
    op.add_column('projects',
        sa.Column('new_field', sa.String(255), nullable=True)
    )

def downgrade():
    op.drop_column('projects', 'new_field')
```

**Adding an index:**
```python
def upgrade():
    op.create_index('ix_projects_name', 'projects', ['name'])

def downgrade():
    op.drop_index('ix_projects_name', table_name='projects')
```

**Adding NOT NULL constraint:**
```python
def upgrade():
    # First add column as nullable
    op.add_column('projects', sa.Column('status', sa.String(50), nullable=True))
    # Set default value for existing rows
    op.execute("UPDATE projects SET status = 'active' WHERE status IS NULL")
    # Then make it NOT NULL
    op.alter_column('projects', 'status', nullable=False)

def downgrade():
    op.drop_column('projects', 'status')
```

### Troubleshooting Migrations

**Issue: Autogenerate detects no changes**
```bash
# Ensure models are imported in backend/core/models.py
# Check that Base is imported in alembic/env.py
```

**Issue: Migration fails with data loss warning**
```bash
# Review the migration carefully
# Add data migration logic if needed
# Test on staging database first
```

**Issue: Database out of sync with migrations**
```bash
# Check current version
alembic current

# If needed, stamp to correct version
alembic stamp <revision>

# Then continue with normal migrations
alembic upgrade head
```

## Backup & Recovery

### Backup Strategy

Implement 3-2-1 backup rule:
- **3** copies of data
- **2** different media types
- **1** off-site copy

### Manual Backup

**Full database backup:**
```bash
pg_dump -h localhost -p 5432 -U postgres -d imagemanager \
  -F custom -f backup-$(date +%Y%m%d-%H%M%S).dump
```

**SQL format backup:**
```bash
pg_dump -h localhost -p 5432 -U postgres -d imagemanager \
  | gzip > backup-$(date +%Y%m%d-%H%M%S).sql.gz
```

**Schema only:**
```bash
pg_dump -h localhost -p 5432 -U postgres -d imagemanager \
  --schema-only -f schema-$(date +%Y%m%d).sql
```

**Data only:**
```bash
pg_dump -h localhost -p 5432 -U postgres -d imagemanager \
  --data-only -f data-$(date +%Y%m%d).sql
```

### Automated Backups

Create backup script:

```bash
#!/bin/bash
# /usr/local/bin/backup-imagemanager.sh

BACKUP_DIR=/backups/imagemanager
DATE=$(date +%Y%m%d-%H%M%S)
RETENTION_DAYS=30

# Create backup directory
mkdir -p $BACKUP_DIR

# Database backup
pg_dump -h localhost -U postgres imagemanager \
  -F custom -f $BACKUP_DIR/db-$DATE.dump

# Compress and upload to S3
tar -czf $BACKUP_DIR/backup-$DATE.tar.gz $BACKUP_DIR/db-$DATE.dump
aws s3 cp $BACKUP_DIR/backup-$DATE.tar.gz s3://backups/imagemanager/

# Cleanup old local backups
find $BACKUP_DIR -name "*.dump" -mtime +$RETENTION_DAYS -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +$RETENTION_DAYS -delete

# Log backup
echo "$(date): Backup completed: backup-$DATE.tar.gz" >> /var/log/backup.log
```

Make executable and schedule:
```bash
chmod +x /usr/local/bin/backup-imagemanager.sh

# Add to crontab (daily at 2 AM)
crontab -e
0 2 * * * /usr/local/bin/backup-imagemanager.sh
```

### Continuous Archiving (WAL)

For point-in-time recovery, enable WAL archiving:

```bash
# Edit postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/wal_archive/%f'
```

### Database Restore

**From custom format:**
```bash
pg_restore -h localhost -p 5432 -U postgres -d imagemanager \
  --clean --if-exists backup.dump
```

**From SQL:**
```bash
# Drop and recreate database
dropdb -h localhost -U postgres imagemanager
createdb -h localhost -U postgres imagemanager

# Restore
gunzip -c backup.sql.gz | psql -h localhost -U postgres -d imagemanager
```

**Point-in-time recovery:**
```bash
# Stop PostgreSQL
sudo systemctl stop postgresql

# Restore base backup
pg_restore -d imagemanager base-backup.dump

# Create recovery.conf
cat > /var/lib/postgresql/15/main/recovery.conf <<EOF
restore_command = 'cp /var/lib/postgresql/wal_archive/%f %p'
recovery_target_time = '2024-01-15 10:30:00'
EOF

# Start PostgreSQL (will enter recovery mode)
sudo systemctl start postgresql
```

## Database Maintenance

### Vacuum and Analyze

Regular maintenance prevents bloat and updates statistics:

```bash
# Manual vacuum
psql -h localhost -U postgres -d imagemanager -c "VACUUM ANALYZE;"

# Verbose output
psql -h localhost -U postgres -d imagemanager -c "VACUUM VERBOSE ANALYZE;"

# Full vacuum (requires exclusive lock)
psql -h localhost -U postgres -d imagemanager -c "VACUUM FULL;"
```

**Autovacuum configuration** (`postgresql.conf`):
```bash
autovacuum = on
autovacuum_max_workers = 3
autovacuum_naptime = 1min
```

### Reindex

Rebuild indexes to remove bloat:

```bash
# Reindex single table
psql -h localhost -U postgres -d imagemanager -c "REINDEX TABLE projects;"

# Reindex entire database
psql -h localhost -U postgres -d imagemanager -c "REINDEX DATABASE imagemanager;"
```

### Monitor Database Size

```sql
-- Database size
SELECT pg_size_pretty(pg_database_size('imagemanager'));

-- Table sizes
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Index sizes
SELECT
    indexname,
    tablename,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Analyze Queries

```sql
-- Show slow queries
SELECT
    pid,
    now() - query_start AS duration,
    query
FROM pg_stat_activity
WHERE state = 'active'
    AND now() - query_start > interval '5 seconds'
ORDER BY duration DESC;

-- Explain query plan
EXPLAIN ANALYZE SELECT * FROM projects WHERE name = 'test';
```

## Connection Pooling

For production, use PgBouncer to manage connections:

### Install PgBouncer

```bash
sudo apt install pgbouncer
```

### Configure PgBouncer

```ini
# /etc/pgbouncer/pgbouncer.ini
[databases]
imagemanager = host=localhost port=5432 dbname=imagemanager

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 20
reserve_pool_size = 5
reserve_pool_timeout = 3
```

### Create userlist

```bash
# /etc/pgbouncer/userlist.txt
"imagemanager_user" "md5hash_of_password"

# Generate password hash
echo -n "passwordimagemanager_user" | md5sum
```

### Use PgBouncer

Update `DATABASE_URL`:
```bash
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:6432/imagemanager
```

## Monitoring

### Key Metrics

Monitor these database metrics:
- Connection count
- Query performance (slow queries)
- Database size growth
- Cache hit ratio
- Transaction rate
- Replication lag (if using replicas)

### Check Database Health

```sql
-- Active connections
SELECT count(*) FROM pg_stat_activity;

-- Cache hit ratio (should be > 90%)
SELECT
    sum(heap_blks_read) as heap_read,
    sum(heap_blks_hit) as heap_hit,
    sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) as ratio
FROM pg_statio_user_tables;

-- Database age (vacuum needed if > 200M)
SELECT datname, age(datfrozenxid) FROM pg_database;

-- Lock conflicts
SELECT * FROM pg_locks WHERE NOT granted;
```

## High Availability

### Replication Setup

**Primary server** (`postgresql.conf`):
```bash
wal_level = replica
max_wal_senders = 3
wal_keep_size = 1GB
```

**Create replication user:**
```sql
CREATE USER replicator WITH REPLICATION ENCRYPTED PASSWORD 'password';
```

**Allow replication** (`pg_hba.conf`):
```
host    replication    replicator    <replica-ip>/32    md5
```

**Standby server:**
```bash
# Create standby from primary
pg_basebackup -h primary-host -U replicator -D /var/lib/postgresql/15/main -P -R
```

### Failover

Promote standby to primary:
```bash
pg_ctl promote -D /var/lib/postgresql/15/main
```

## Performance Tuning

### Key Settings

```bash
# Memory settings (adjust for your server)
shared_buffers = 2GB                    # 25% of RAM
effective_cache_size = 6GB              # 50-75% of RAM
maintenance_work_mem = 512MB
work_mem = 64MB

# Checkpoint settings
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100

# Planner settings
random_page_cost = 1.1                  # For SSD
effective_io_concurrency = 200          # For SSD

# Logging
log_min_duration_statement = 1000       # Log queries > 1 second
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
```

### Query Optimization

Create indexes for frequently queried columns:

```sql
-- Commonly queried fields
CREATE INDEX idx_projects_meta_group ON projects(meta_group_id);
CREATE INDEX idx_images_project ON data_instances(project_id);
CREATE INDEX idx_images_deleted ON data_instances(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_classifications_image ON image_classifications(image_id);
```

## Next Steps

- [Configure storage](storage.md)
- [Set up monitoring](monitoring.md)
- [Review troubleshooting guide](troubleshooting.md)
