# Security

This guide covers security considerations for deploying Media Viewer.

## Authentication

### Password Protection

Media Viewer uses a single shared password for all access.

**Best practices:**

- Use a strong, unique password (12+ characters)
- Include mixed case, numbers, and symbols
- Do not reuse passwords from other services
- Change the password periodically

### Session Management

Sessions expire after the configured duration (default: 1 hour).

- Active usage keeps sessions alive via keepalive requests
- Closing the browser does not immediately end the session
- Sessions are stored server-side

### Changing Password

Users can change the password from within the application:

1. Click the key icon in the header
2. Enter current password
3. Enter and confirm new password
4. Click **Update Password**

This changes the password for all users.

## Network Security

### HTTPS

Always use HTTPS in production to protect:

- Password transmission during login
- Session cookies
- Media content in transit

**Using a reverse proxy:**

```nginx
server {
    listen 443 ssl;
    server_name media.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Firewall

Restrict access to trusted networks:

- Do not expose directly to the internet without HTTPS
- Consider VPN access for remote viewing
- Use firewall rules to limit source IPs if possible

## File System Security

### Read-Only Media Mount

Mount your media directory as read-only:

```bash
-v /path/to/media:/media:ro
```

This prevents the application from modifying your original files.

### Data Directory Permissions

The data directory requires write access but should be restricted:

```bash
# Create dedicated directory
mkdir -p /var/lib/media-viewer
chown 1000:1000 /var/lib/media-viewer
chmod 700 /var/lib/media-viewer
```

## Container Security

### Non-Root User

The container runs as a non-root user by default.

### Resource Limits

Consider setting resource limits:

```yaml
services:
    media-viewer:
        # ...
        deploy:
            resources:
                limits:
                    memory: 512M
                    cpus: '1.0'
```

### Network Isolation

Use Docker networks to isolate the container:

```yaml
services:
    media-viewer:
        # ...
        networks:
            - internal

networks:
    internal:
        internal: true
```

## Data Protection

### Backup

Regularly backup the data directory:

- Database contains tags, favorites, and index
- Thumbnails can be regenerated if lost

### Encryption at Rest

For sensitive media, consider:

- Encrypted file systems for media storage
- Encrypted volumes for the data directory

## Security Checklist

- [ ] Strong, unique password configured
- [ ] HTTPS enabled via reverse proxy
- [ ] Media mounted read-only
- [ ] Data directory has restricted permissions
- [ ] Firewall limits access to trusted networks
- [ ] Regular backups configured
- [ ] Resource limits set (optional)
- [ ] Network isolation configured (optional)
