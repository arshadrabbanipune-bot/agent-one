# Security policy

## Reporting a vulnerability

Please do not disclose vulnerabilities, credentials, tokens, workspace data, or reproduction logs in a public GitHub issue.

Use GitHub's private vulnerability reporting feature for this repository. Include the affected route, impact, reproduction steps, and a redacted proof of concept. Never include real OAuth secrets, API keys, session cookies, Notion tokens, or user content.

## Deployment requirements

- Keep every credential in server-side environment variables.
- Never expose `OPENAI_API_KEY`, `NOTION_CLIENT_SECRET`, `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` to browser code.
- Use exact OAuth callback URLs and validate OAuth state.
- Keep session cookies `HttpOnly`, `Secure`, and appropriately scoped.
- Apply the included Supabase row-level security migrations.
- Rate-limit costly and mutating endpoints before broad public access.
- Rotate a credential immediately if it may have been exposed.

## Supported version

Security fixes target the current production version on the `main` branch.
