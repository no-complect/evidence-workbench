# Security

The local demo uses synthetic sources, local-only credentials and loopback ports.
Use the [deployment requirements](DEPLOYMENT.md) before exposing an instance publicly.

Supabase mode uses authentication, project membership checks, RLS and private
Storage. Context redaction and source filtering are limited; they are not
comprehensive DLP or prompt-injection protection. See
[Architecture](ARCHITECTURE.md) for the implemented boundaries and
[verification scope](DEVELOPMENT.md#verification-scope) for their tested limits.

Do not post credentials, private documents or exploitable security issues in public
issues. If the repository has private vulnerability reporting enabled, use
**Security → Report a vulnerability**. Otherwise request a private reporting channel
without publishing exploit details.
