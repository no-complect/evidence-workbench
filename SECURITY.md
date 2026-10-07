# Security

This is a portfolio research application. Its local demo uses synthetic sources
and explicit local-only credentials, with Compose ports bound to loopback.
Publishing the source code does not make that configuration suitable for a
publicly reachable deployment.

Production uses Supabase authentication, project membership checks, RLS, and
private object storage. See [deployment requirements](docs/DEPLOYMENT.md) and
[engineering boundaries](docs/ARCHITECTURE.md). Hosted boundaries require separate
verification; source filtering and context redaction are not comprehensive DLP
or prompt-injection detection.

Do not post credentials, private source documents, or an exploitable security
issue in a public issue. If the GitHub repository has private vulnerability
reporting enabled, use **Security → Report a vulnerability**. Otherwise request a
private reporting channel without publishing exploit details. Repository
maintainers should enable that channel before the public release.
