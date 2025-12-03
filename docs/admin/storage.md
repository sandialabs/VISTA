# Storage Configuration

This guide covers S3-compatible object storage setup and management for VISTA.

## Storage Options

The application supports any S3-compatible object storage:
- **MinIO** - Self-hosted, open-source (recommended for self-hosted deployments)
- **AWS S3** - Managed cloud storage (recommended for cloud deployments)
- **Google Cloud Storage** - With S3 compatibility layer
- **Azure Blob Storage** - With S3 compatibility layer
- **Ceph** - Self-hosted distributed storage
- **DigitalOcean Spaces** - Managed S3-compatible storage

## MinIO Setup (Self-Hosted)

### Docker Deployment

```bash
podman run -d \
  --name minio \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadminpassword \
  -v /data/minio:/data \
  minio/minio server /data --console-address ":9001"
```

### Binary Installation

```bash
# Download MinIO
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
sudo mv minio /usr/local/bin/

# Create data directory
sudo mkdir -p /data/minio
sudo chown -R minio:minio /data/minio

# Create systemd service
sudo cat > /etc/systemd/system/minio.service <<EOF
[Unit]
Description=MinIO
After=network.target

[Service]
User=minio
Group=minio
Environment="MINIO_ROOT_USER=minioadmin"
Environment="MINIO_ROOT_PASSWORD=minioadminpassword"
ExecStart=/usr/local/bin/minio server /data/minio --console-address ":9001"
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Start service
sudo systemctl daemon-reload
sudo systemctl enable minio
sudo systemctl start minio
```

### MinIO Client Setup

```bash
# Download MinIO client
wget https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x mc
sudo mv mc /usr/local/bin/

# Configure client
mc alias set myminio http://localhost:9000 minioadmin minioadminpassword

# Test connection
mc admin info myminio
```

### Create Bucket

```bash
# Create bucket
mc mb myminio/vista

# Set public download policy (for presigned URLs)
mc policy set download myminio/vista

# Or more restrictive policy
mc policy set-json myminio/vista <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"AWS": ["*"]},
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::vista/*"],
      "Condition": {
        "StringLike": {
          "s3:signatureversion": "AWS4-HMAC-SHA256"
        }
      }
    }
  ]
}
EOF
```

### Application Configuration

```bash
# In .env
S3_ENDPOINT=localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadminpassword
S3_BUCKET=vista
S3_USE_SSL=false
S3_REGION=us-east-1
```

### MinIO Console

Access web console at http://localhost:9001:
- View buckets and objects
- Manage access policies
- Monitor storage usage
- Configure bucket versioning
- Set lifecycle policies

## AWS S3 Setup

### Create S3 Bucket

```bash
# Using AWS CLI
aws s3 mb s3://vista --region us-east-1

# Enable versioning (optional)
aws s3api put-bucket-versioning \
  --bucket vista \
  --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-encryption \
  --bucket vista \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'
```

### Create IAM User

```bash
# Create user
aws iam create-user --user-name image-manager-app

# Create access key
aws iam create-access-key --user-name image-manager-app
```

### IAM Policy

Create policy `image-manager-s3-policy`:

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
        "arn:aws:s3:::vista",
        "arn:aws:s3:::vista/*"
      ]
    }
  ]
}
```

Attach to user:
```bash
aws iam put-user-policy \
  --user-name image-manager-app \
  --policy-name image-manager-s3-policy \
  --policy-document file://policy.json
```

### CORS Configuration (Optional)

If accessing from browser:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": ["https://app.example.com"],
    "ExposeHeaders": ["ETag"]
  }
]
```

Apply:
```bash
aws s3api put-bucket-cors \
  --bucket vista \
  --cors-configuration file://cors.json
```

### Application Configuration

```bash
# In .env
S3_ENDPOINT=s3.amazonaws.com
S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
S3_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_BUCKET=vista
S3_USE_SSL=true
S3_REGION=us-east-1
```

## Object Storage Best Practices

### Object Naming Convention

The application uses this key structure:

```
projects/{project_id}/{filename}
ml_outputs/{analysis_id}/{artifact_name}
thumbnails/{image_id}_{size}.jpg
```

### Storage Classes

**AWS S3:**
- `STANDARD` - Frequently accessed data (default)
- `INTELLIGENT_TIERING` - Automatic cost optimization
- `STANDARD_IA` - Infrequently accessed
- `GLACIER` - Archive storage

**MinIO:**
- Configure lifecycle policies for automatic tiering

### Lifecycle Policies

Move old deleted images to cheaper storage:

**AWS S3:**
```json
{
  "Rules": [
    {
      "Id": "Archive old files",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "projects/"
      },
      "Transitions": [
        {
          "Days": 90,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 365,
          "StorageClass": "GLACIER"
        }
      ]
    },
    {
      "Id": "Delete temp files",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "temp/"
      },
      "Expiration": {
        "Days": 7
      }
    }
  ]
}
```

Apply:
```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket vista \
  --lifecycle-configuration file://lifecycle.json
```

## Backup & Replication

### Versioning

Enable versioning to protect against accidental deletion:

**AWS S3:**
```bash
aws s3api put-bucket-versioning \
  --bucket vista \
  --versioning-configuration Status=Enabled
```

**MinIO:**
```bash
mc version enable myminio/vista
```

### Cross-Region Replication

**AWS S3:**
```bash
# Create destination bucket
aws s3 mb s3://vista-replica --region us-west-2

# Configure replication
aws s3api put-bucket-replication \
  --bucket vista \
  --replication-configuration file://replication.json
```

### Backup to Another Provider

```bash
# Sync to backup location
aws s3 sync s3://vista s3://backup-bucket --storage-class GLACIER

# Or use rclone for multi-cloud backup
rclone sync minio:vista b2:backup-bucket
```

## Monitoring Storage

### MinIO Metrics

```bash
# Storage info
mc admin info myminio

# Storage usage
mc du myminio/vista

# Monitor with Prometheus
mc admin prometheus generate myminio
```

### AWS S3 Metrics

```bash
# Storage metrics via CloudWatch
aws cloudwatch get-metric-statistics \
  --namespace AWS/S3 \
  --metric-name BucketSizeBytes \
  --dimensions Name=BucketName,Value=vista \
  --statistics Average \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-31T23:59:59Z \
  --period 86400

# Request metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/S3 \
  --metric-name AllRequests \
  --dimensions Name=BucketName,Value=vista \
  --statistics Sum \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-31T23:59:59Z \
  --period 3600
```

### Storage Alerts

Set up alerts for:
- Storage quota exceeded
- High request rate
- Failed requests
- Replication lag
- Cost thresholds

## Performance Optimization

### CDN Integration

Use CloudFront (AWS) or CDN for faster image delivery:

**CloudFront Setup:**
```bash
# Create CloudFront distribution
aws cloudfront create-distribution \
  --origin-domain-name vista.s3.amazonaws.com \
  --default-root-object index.html
```

Update application to use CDN URL for reads.

### Transfer Acceleration

**AWS S3:**
```bash
# Enable transfer acceleration
aws s3api put-bucket-accelerate-configuration \
  --bucket vista \
  --accelerate-configuration Status=Enabled

# Use accelerated endpoint
S3_ENDPOINT=vista.s3-accelerate.amazonaws.com
```

### Multipart Upload

For large files, use multipart upload (handled automatically by boto3):

```python
# In application code (automatic for files > 5GB)
s3_client.upload_file(
    '/path/to/large/file',
    'bucket',
    'key',
    Config=boto3.s3.transfer.TransferConfig(
        multipart_threshold=1024 * 25,  # 25 MB
        max_concurrency=10,
        multipart_chunksize=1024 * 25,
        use_threads=True
    )
)
```

## Storage Security

### Encryption

**At Rest:**

AWS S3:
```bash
aws s3api put-bucket-encryption \
  --bucket vista \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'
```

MinIO:
```bash
mc encrypt set sse-s3 myminio/vista
```

**In Transit:**
- Always use SSL/TLS (`S3_USE_SSL=true`)
- Use HTTPS endpoints
- Validate SSL certificates

### Access Control

**Bucket Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::vista",
        "arn:aws:s3:::vista/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

### Presigned URLs

Application uses presigned URLs for secure temporary access:

```python
# URL expires after 1 hour
url = s3_client.generate_presigned_url(
    'get_object',
    Params={'Bucket': bucket, 'Key': key},
    ExpiresIn=3600
)
```

## Cleanup & Maintenance

### Delete Orphaned Objects

```bash
# List objects not in database
python scripts/cleanup_orphaned_s3_objects.py --dry-run

# Delete orphaned objects
python scripts/cleanup_orphaned_s3_objects.py --execute
```

### Storage Quota Management

```bash
# Check total storage usage
mc du myminio/vista

# List largest objects
aws s3api list-objects-v2 \
  --bucket vista \
  --query 'sort_by(Contents, &Size)[-10:]'
```

## Disaster Recovery

### Backup Strategy

1. **Versioning enabled** - Protect against accidental deletion
2. **Cross-region replication** - Geo-redundancy
3. **Regular snapshots** - Point-in-time recovery
4. **Off-site backup** - Secondary provider backup

### Recovery Procedures

**Recover deleted object (versioned bucket):**
```bash
# List versions
aws s3api list-object-versions \
  --bucket vista \
  --prefix projects/abc-123/image.jpg

# Restore specific version
aws s3api copy-object \
  --bucket vista \
  --copy-source vista/projects/abc-123/image.jpg?versionId=VERSION_ID \
  --key projects/abc-123/image.jpg
```

**Bulk restore from backup:**
```bash
# Restore from backup bucket
aws s3 sync s3://backup-bucket s3://vista
```

## Troubleshooting

### Connection Issues

```bash
# Test S3 connection
aws s3 ls s3://vista --endpoint-url http://localhost:9000

# Test with curl
curl -v http://localhost:9000/vista/
```

### Permission Errors

```bash
# Check IAM permissions
aws iam get-user-policy \
  --user-name image-manager-app \
  --policy-name image-manager-s3-policy

# Test specific operation
aws s3 cp test.txt s3://vista/test.txt
```

### Performance Issues

- Check network bandwidth
- Monitor S3 request metrics
- Consider using CDN
- Enable transfer acceleration
- Optimize image sizes

## Next Steps

- [Configure monitoring](monitoring.md)
- [Review troubleshooting guide](troubleshooting.md)
- [Set up backups](database.md#backup--recovery)
