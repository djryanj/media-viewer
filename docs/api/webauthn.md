# WebAuthn API

Passkey (WebAuthn/FIDO2) authentication endpoints.

For detailed information about WebAuthn configuration and usage, see:

- User Guide: [WebAuthn/Passkeys](../user-guide/webauthn.md)
- Administration: [WebAuthn Setup](../admin/webauthn.md)
- Comprehensive Guide: [WebAuthn Documentation](../webauthn.md)

## API Reference

See the [OpenAPI Specification](openapi.md) for interactive documentation of all WebAuthn endpoints:

- `GET /api/auth/webauthn/available` - Check passkey availability
- `POST /api/auth/webauthn/register/begin` - Start registration
- `POST /api/auth/webauthn/register/finish` - Complete registration
- `POST /api/auth/webauthn/login/begin` - Start authentication
- `POST /api/auth/webauthn/login/finish` - Complete authentication
- `GET /api/auth/webauthn/passkeys` - List passkeys
- `DELETE /api/auth/webauthn/passkeys` - Delete passkey

Refer to the OpenAPI documentation for detailed request/response schemas and examples.
