# Security

This guide covers security considerations for deploying Media Viewer.

## Authentication

### Password Protection

Media Viewer uses a single user account with password authentication.

**Best practices:**

- Use a strong, unique password (12+ characters)
- Include mixed case, numbers, and symbols
- Do not reuse passwords from other services
- Change the password periodically

### WebAuthn/Passkey Authentication

When WebAuthn is enabled, users can authenticate with:

- Biometric authentication (Face ID, Touch ID, Windows Hello)
- Security keys (YubiKey, Titan, etc.)

**Security benefits:**

- Phishing-resistant (keys are cryptographically bound to your domain)
- No password to steal or guess
- User verification required (biometric or PIN)
- Private keys never leave the user's device

**Requirements:**

- HTTPS (except `http://localhost` for development)
- Properly configured RP ID matching your domain
- Modern browser with WebAuthn support

### Session Management

Sessions expire after the configured duration (default: 24 hours) with sliding expiration.

- Active usage extends session lifetime via keepalive
- Closing the browser does not immediately end the session
- Sessions are stored server-side with SHA-256 hashed tokens
- Sessions are invalidated on password change

### Changing Password

Users can change the password from the Settings modal:

1. Open **Settings** (⚙️ icon)
2. Navigate to **Security** tab
3. Enter current password
4. Enter and confirm new password
5. Click **Update Password**

**Note**: Changing the password invalidates all existing sessions on all devices.

## Network Security

### HTTPS

Always use HTTPS in production to protect:

- Password transmission during login
- Session cookies
- Media content in transit
- WebAuthn ceremonies

**Using a reverse proxy:**

```nginx
server {
    listen 443 ssl http2;
    server_name media.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Increase timeouts for video streaming
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

### Firewall

Restrict access to trusted networks:

- Do not expose directly to the internet without HTTPS
- Consider VPN access for remote viewing
- Use firewall rules to limit source IPs if possible

### Rate Limiting

Consider adding rate limiting at the reverse proxy level:

```nginx
# Limit login attempts
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

location /api/auth/login {
    limit_req zone=login burst=3 nodelay;
    proxy_pass http://localhost:8080;
}
```

## File System Security

### Read-Only Media Mount

Mount your media directory as read-only:

```bash
-v /path/to/media:/media:ro
```

This prevents the application from modifying your original files.

### Cache Directory Permissions

The cache directory requires write access but should be restricted:

```bash
# Create dedicated directory
mkdir -p /var/lib/media-viewer/cache
chown 1000:1000 /var/lib/media-viewer/cache
chmod 700 /var/lib/media-viewer/cache
```

### Database Directory Permissions

The database directory requires write access and contains sensitive data:

```bash
# Create dedicated directory
mkdir -p /var/lib/media-viewer/database
chown 1000:1000 /var/lib/media-viewer/database
chmod 700 /var/lib/media-viewer/database
```

## Container Security

### Non-Root User

The container runs as a non-root user by default (UID 1000).

### Resource Limits

Set resource limits to prevent resource exhaustion:

```yaml
services:
    media-viewer:
        # ...
        deploy:
            resources:
                limits:
                    memory: 512M
                    cpus: '1.0'
                reservations:
                    memory: 256M
                    cpus: '0.5'
```

### Network Isolation

Use Docker networks to isolate the container:

```yaml
services:
    media-viewer:
        # ...
        networks:
            - media-internal

networks:
    media-internal:
        internal: true # No external access
```

Or allow external access only through a reverse proxy:

```yaml
networks:
    media-internal:
        internal: false
    reverse-proxy:
        external: true

services:
    media-viewer:
        networks:
            - media-internal

    nginx:
        networks:
            - media-internal
            - reverse-proxy
```

### Security Scanning

Scan the container image for vulnerabilities:

```bash
# Using Trivy
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image ghcr.io/djryanj/media-viewer:latest

# Using Docker Scout
docker scout cves ghcr.io/djryanj/media-viewer:latest
```

## Data Protection

### Backup

Regularly backup the database directory:

- Database contains tags, favorites, user data, and sessions
- Thumbnails can be regenerated if lost
- Transcoded videos can be regenerated if lost

```bash
# Automated backup script
#!/bin/bash
BACKUP_DIR=/backups/media-viewer
DATE=$(date +%Y%m%d-%H%M%S)

docker run --rm \
  -v media-database:/source:ro \
  -v $BACKUP_DIR:/backup \
  alpine tar czf /backup/database-$DATE.tar.gz -C /source .

# Keep only last 30 days
find $BACKUP_DIR -name "database-*.tar.gz" -mtime +30 -delete
```

### Encryption at Rest

For sensitive media, consider:

- Encrypted file systems for media storage (LUKS, VeraCrypt)
- Encrypted volumes for the database directory
- Hardware-level encryption (self-encrypting drives)

## Security Checklist

- [ ] Strong, unique password configured
- [ ] HTTPS enabled via reverse proxy
- [ ] Media mounted read-only
- [ ] Cache and database directories have restricted permissions
- [ ] Firewall limits access to trusted networks
- [ ] Regular backups configured
- [ ] Resource limits set
- [ ] Network isolation configured (optional)
- [ ] WebAuthn/passkeys enabled (optional but recommended)
- [ ] Security scanning performed on container images
- [ ] Logs monitored for suspicious activity

## Incident Response

If you suspect unauthorized access:

1. **Immediately change the password** via Settings or `resetpw` tool
2. **Check sessions** in the database: `SELECT * FROM sessions;`
3. **Invalidate all sessions**: `DELETE FROM sessions;`
4. **Review logs** for suspicious activity
5. **Check for unexpected changes** to favorites or tags
6. **Review WebAuthn credentials** if enabled (Settings → Passkeys)
7. **Consider rotating encryption keys** if using encrypted storage

## Reporting Security Issues

If you discover a security vulnerability, please report it privately to the maintainers via GitHub Security Advisories rather than creating a public issue.
