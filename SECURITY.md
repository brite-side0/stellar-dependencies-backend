# Security

This is an MVP scaffold, not an audited funding application. It never executes scanned code or manages funds. Input validation, fixed upstream hosts, disabled redirects, body limits, content security headers and server-only token handling reduce common risks; they do not replace production review.

## Reporting a vulnerability

Private vulnerability reporting is enabled for this repository. To report a security issue, use the private advisory reporting form:

https://github.com/OWNER/stellar-dependencies-backend/security/advisories/new

Replace `OWNER` with the GitHub account or organization that hosts this repository so the link points at the actual private reporting channel. Reports submitted through this form are visible only to maintainers and the reporter.

Do not open public issues containing secrets. Rotate any leaked token immediately.