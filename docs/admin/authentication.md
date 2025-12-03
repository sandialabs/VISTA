# Authentication & Security

This guide covers authentication, authorization, and security configuration for VISTA.

## Authentication Overview

The application uses **header-based authentication** via reverse proxy. The reverse proxy authenticates users and forwards their identity to the backend via HTTP headers.

### Authentication Flow

```
1. User accesses application → Reverse Proxy
2. Proxy authenticates user (OAuth2, SAML, LDAP, etc.)
3. Proxy sets authentication headers
4. Proxy forwards request to Backend
5. Backend validates headers
6. Backend processes request
```

## Reverse Proxy Configuration

### Required Headers

The reverse proxy must set these headers on all requests:

- **X-User-Email:** Authenticated user's email address
- **X-Proxy-Secret:** Shared secret matching `PROXY_SHARED_SECRET`

### Nginx Configuration Example

```nginx
upstream backend {
    server localhost:8000;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    # Authentication using OAuth2 Proxy example
    auth_request /oauth2/auth;
    error_page 401 = /oauth2/sign_in;

    location /oauth2/ {
        proxy_pass http://localhost:4180;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        # Set authentication headers from OAuth2 Proxy
        auth_request_set $user $upstream_http_x_auth_request_email;
        proxy_set_header X-User-Email $user;
        proxy_set_header X-Proxy-Secret "your-shared-secret-here";

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Proxy to backend
        proxy_pass http://backend;
        proxy_redirect off;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

### Apache Configuration Example

```apache
<VirtualHost *:443>
    ServerName app.example.com

    # SSL Configuration
    SSLEngine on
    SSLCertificateFile /etc/ssl/certs/cert.pem
    SSLCertificateKeyFile /etc/ssl/private/key.pem

    # Authentication with mod_auth_openidc
    OIDCProviderMetadataURL https://auth.example.com/.well-known/openid-configuration
    OIDCClientID your-client-id
    OIDCClientSecret your-client-secret
    OIDCRedirectURI https://app.example.com/oauth2callback
    OIDCCryptoPassphrase <random-passphrase>

    <Location />
        AuthType openid-connect
        Require valid-user

        # Set authentication headers
        RequestHeader set X-User-Email "%{OIDC_CLAIM_email}e"
        RequestHeader set X-Proxy-Secret "your-shared-secret-here"

        # Proxy to backend
        ProxyPass http://localhost:8000/
        ProxyPassReverse http://localhost:8000/
        
        # Preserve host header
        ProxyPreserveHost On
    </Location>
</VirtualHost>
```

### OAuth2 Proxy Setup

OAuth2 Proxy is a popular choice for adding OAuth2/OIDC authentication:

```bash
# Install OAuth2 Proxy
wget https://github.com/oauth2-proxy/oauth2-proxy/releases/download/v7.4.0/oauth2-proxy-v7.4.0.linux-amd64.tar.gz
tar -xzf oauth2-proxy-v7.4.0.linux-amd64.tar.gz
sudo mv oauth2-proxy-v7.4.0.linux-amd64/oauth2-proxy /usr/local/bin/

# Configure
cat > oauth2-proxy.cfg <<EOF
http_address = "0.0.0.0:4180"
upstreams = ["http://localhost:8000/"]
email_domains = ["example.com"]
cookie_secret = "$(openssl rand -base64 32)"
client_id = "your-oauth-client-id"
client_secret = "your-oauth-client-secret"
provider = "google"  # or azure, github, oidc, etc.
pass_authorization_header = true
set_xauthrequest = true
EOF

# Run
oauth2-proxy --config oauth2-proxy.cfg
```

## Group-Based Authorization

Projects belong to groups (`meta_group_id`). Users must be members of a project's group to access it.

### Implementing Group Membership

Edit `backend/core/group_auth.py` and implement `_check_group_membership`:

```python
import requests
from core.config import settings

def _check_group_membership(user_email: str, group_id: str) -> bool:
    """
    Check if user is member of group.
    Implement based on your auth system.
    """
    # Example 1: LDAP/Active Directory
    import ldap
    conn = ldap.initialize(settings.LDAP_URL)
    conn.simple_bind_s(settings.LDAP_BIND_DN, settings.LDAP_BIND_PASSWORD)
    result = conn.search_s(
        settings.LDAP_BASE_DN,
        ldap.SCOPE_SUBTREE,
        f"(&(mail={user_email})(memberOf=cn={group_id},{settings.LDAP_GROUPS_DN}))"
    )
    return len(result) > 0
    
    # Example 2: External API
    response = requests.get(
        f"{settings.AUTH_SERVER_URL}/api/users/{user_email}/groups",
        headers={"Authorization": f"Bearer {settings.AUTH_API_TOKEN}"}
    )
    user_groups = response.json().get("groups", [])
    return group_id in user_groups
    
    # Example 3: Database
    from core.database import get_db
    # Query user_groups table
    # return group_id in user.groups
```

### Group Membership Caching

Group checks are cached for 5 minutes by default (configurable in `backend/core/group_auth_helper.py`):

```python
# Adjust cache TTL
GROUP_MEMBERSHIP_CACHE_TTL = 300  # seconds
```

## Security Configuration

### Security Checklist

- [ ] Set `DEBUG=false` in production
- [ ] Set `SKIP_HEADER_CHECK=false` in production
- [ ] Generate strong `PROXY_SHARED_SECRET` (32+ bytes)
- [ ] Use HTTPS for all external communication
- [ ] Restrict backend access to reverse proxy only
- [ ] Enable firewall rules
- [ ] Use strong database passwords
- [ ] Rotate secrets regularly (quarterly recommended)
- [ ] Keep dependencies updated
- [ ] Enable audit logging
- [ ] Set up monitoring and alerts
- [ ] Configure proper CORS origins
- [ ] Set secure Content Security Policy
- [ ] Enable HSTS headers
- [ ] Disable unnecessary services

### Generate Secure Secrets

```bash
# Generate PROXY_SHARED_SECRET (32 bytes = 64 hex chars)
openssl rand -hex 32

# Generate ML_CALLBACK_HMAC_SECRET
openssl rand -hex 32

# Generate random password
openssl rand -base64 24
```

### Network Security

#### Firewall Configuration

Restrict backend to accept connections only from reverse proxy:

**UFW (Ubuntu):**
```bash
# Allow SSH
ufw allow 22

# Allow reverse proxy to access backend
ufw allow from <proxy-ip> to any port 8000

# Allow localhost
ufw allow from 127.0.0.1 to any port 8000

# Deny all other access to backend
ufw deny 8000

# Enable firewall
ufw enable
```

**iptables:**
```bash
# Accept from proxy
iptables -A INPUT -p tcp --dport 8000 -s <proxy-ip> -j ACCEPT

# Accept from localhost
iptables -A INPUT -p tcp --dport 8000 -s 127.0.0.1 -j ACCEPT

# Drop all other connections
iptables -A INPUT -p tcp --dport 8000 -j DROP

# Save rules
iptables-save > /etc/iptables/rules.v4
```

**Security Groups (AWS):**
```
Inbound Rule:
- Type: Custom TCP
- Port: 8000
- Source: <proxy-security-group-id>
```

#### TLS/SSL Configuration

Always use TLS 1.2+ in production:

**Nginx:**
```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
ssl_prefer_server_ciphers off;
ssl_session_timeout 1d;
ssl_session_cache shared:SSL:50m;
ssl_stapling on;
ssl_stapling_verify on;

# HSTS
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

**Apache:**
```apache
SSLProtocol all -SSLv3 -TLSv1 -TLSv1.1
SSLCipherSuite HIGH:!aNULL:!MD5:!3DES
SSLHonorCipherOrder on
SSLSessionTickets off

# HSTS
Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
```

### Security Headers

The application automatically sets these security headers:

```
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: no-referrer
Content-Security-Policy: <configurable via CSP_POLICY>
```

Configure CSP in `.env`:
```bash
CSP_POLICY="default-src 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self' 'unsafe-inline'"
```

### API Rate Limiting

Implement rate limiting at the reverse proxy level:

**Nginx:**
```nginx
http {
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    
    server {
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://backend;
        }
    }
}
```

### Secrets Management

For production, use a secrets manager:

**AWS Secrets Manager:**
```python
import boto3

def get_secret(secret_name):
    client = boto3.client('secretsmanager', region_name='us-east-1')
    response = client.get_secret_value(SecretId=secret_name)
    return response['SecretString']

# In config.py
PROXY_SHARED_SECRET = get_secret('image-manager/proxy-secret')
```

**HashiCorp Vault:**
```python
import hvac

client = hvac.Client(url='https://vault.example.com')
client.auth.approle.login(role_id='...', secret_id='...')

secret = client.secrets.kv.v2.read_secret_version(path='image-manager/config')
PROXY_SHARED_SECRET = secret['data']['data']['proxy_secret']
```

## Testing Authentication

### Test Without Headers (Should Fail)

```bash
curl -i http://localhost:8000/api/projects
# Expected: 401 Unauthorized
```

### Test With Valid Headers (Should Succeed)

```bash
curl -i \
  -H "X-User-Email: user@example.com" \
  -H "X-Proxy-Secret: your-shared-secret" \
  http://localhost:8000/api/projects
# Expected: 200 OK with project list
```

### Test Invalid Secret (Should Fail)

```bash
curl -i \
  -H "X-User-Email: user@example.com" \
  -H "X-Proxy-Secret: wrong-secret" \
  http://localhost:8000/api/projects
# Expected: 401 Unauthorized
```

### Test Group Access

```bash
# User in group (should succeed)
curl -i \
  -H "X-User-Email: member@example.com" \
  -H "X-Proxy-Secret: your-secret" \
  http://localhost:8000/api/projects/<project-id>
# Expected: 200 OK

# User not in group (should fail)
curl -i \
  -H "X-User-Email: nonmember@example.com" \
  -H "X-Proxy-Secret: your-secret" \
  http://localhost:8000/api/projects/<project-id>
# Expected: 403 Forbidden
```

## API Key Authentication

Users can generate API keys for programmatic access through the web interface.

### API Key Usage

```bash
curl -H "X-API-Key: user-api-key-here" \
  https://app.example.com/api/projects
```

### API Key Management

- Users manage their own keys through the web UI
- Keys can have expiration dates
- Keys can be revoked immediately
- Each key is tied to a specific user
- Keys inherit user's group memberships

### API Key Security

- Store keys securely (never in code repositories)
- Use environment variables or secrets managers
- Rotate keys regularly
- Revoke unused keys
- Monitor key usage for anomalies

## Audit Logging

Enable comprehensive audit logging:

```bash
# In .env
ENABLE_AUDIT_LOG=true
AUDIT_LOG_PATH=/var/log/image-manager/audit.log
```

Audit events logged:
- Authentication attempts (success/failure)
- Project access
- Image uploads/deletions
- Classification changes
- User management actions
- Configuration changes

## Security Best Practices

1. **Principle of Least Privilege** - Grant minimum necessary permissions
2. **Defense in Depth** - Multiple security layers (proxy auth + backend validation + firewall)
3. **Regular Updates** - Keep all software updated
4. **Secret Rotation** - Rotate secrets quarterly
5. **Monitor Logs** - Review authentication and authorization logs regularly
6. **Incident Response** - Have a plan for security incidents
7. **Security Testing** - Regular penetration testing and vulnerability scans
8. **User Training** - Train users on security best practices
9. **Backup Security** - Secure and encrypt backups
10. **Access Review** - Regularly review user access and permissions

## Compliance Considerations

### GDPR

- Implement user data deletion requests
- Log data access
- Provide data export functionality
- Document data retention policies

### HIPAA (If Handling Medical Images)

- Enable encryption at rest and in transit
- Implement comprehensive audit logging
- Restrict access based on role
- Regular security assessments
- Business associate agreements with cloud providers

## Next Steps

- [Configure database](database.md)
- [Set up storage](storage.md)
- [Enable monitoring](monitoring.md)
- [Review troubleshooting guide](troubleshooting.md)
