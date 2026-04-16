# Coding Standards — bc-migrate-service

**Author**: Ryan Loiselle — Developer / Architect  
**AI tool**: GitHub Copilot — AI pair programmer / code generation  
**Established**: April 2026

---

## 1. Language & Runtime

- **TypeScript 5.x strict mode** — no `any` without a comment justifying it
- **Node.js 22 LTS** — use native `fetch`, `crypto`, `fs/promises` (no polyfills)
- **ESM modules** — `"type": "module"` in package.json; all imports use `.js` extensions
- **Fastify 5.x** — not Express. Do not introduce Express or Koa.

## 2. Attribution Header

Every source file must open with a JSDoc header:

```typescript
// src/routes/example.ts
// Ryan Loiselle — Developer / Architect | GitHub Copilot | April 2026
//
// <One-line description of what this file does.>
```

## 3. Error Handling

- Throw `Error` objects with descriptive messages — no string throws
- Catch at the boundary (route handler, pipeline stage) — log and convert to user-facing SSE error
- Never swallow errors silently — at minimum log them with `app.log.error`
- External API calls (`fetch`, Octokit) must have error handling with the HTTP status in the message

## 4. Security (OWASP Top 10)

- **A02 Cryptographic Failures** — always use `timingSafeEqual` for HMAC comparisons (never `===`)
- **A03 Injection** — all subprocess calls use `execFile` (not `exec`) with explicit argument arrays
- **A05 Security Misconfiguration** — secrets only via environment variables; never hardcoded
- **A07 Authentication Failures** — verify GitHub signature on every `/api/v1/extension` request
- Validate caller has repo read access before collecting data (`verifyRepoAccess`)

## 5. Secrets

- All secrets via Vault + External Secrets Operator — never plain OCP Secrets
- Never log secret values, API keys, or tokens — even at debug level
- `.env` is gitignored; `.env.example` contains only keys with empty values

## 6. Subprocess Safety

- Always use `execFile` not `exec` — prevents shell injection
- Always pass arguments as an array — never interpolate user input into argument strings
- Set `timeout` on all subprocess calls
- Validate namespace (6-char alphanumeric) and repo (`owner/name`) before passing to collect.sh

## 7. Helm / Kubernetes

- All Helm changes must pass the ag-devops 4-tool policy gate before merging
- Required pod labels: `DataClass`, `owner`, `environment` — all three, always
- `priorityClassName` must be set on all Deployments
- NetworkPolicies via ag-helm intent API — no raw `NetworkPolicy` objects
- Internet egress requires `justification` + `approvedBy` annotations
- Port 8080 throughout — no other ports

## 8. Testing

- Unit tests with **Vitest** — co-located in `src/**/*.test.ts`
- Test the command parser thoroughly — it is a security boundary (validates all user input)
- Mock `fetch` and `execFile` in tests — do not hit real APIs in CI

## 9. CI

- All GitHub Actions steps use SHA-pinned action versions (not `@v4` floating tags)
- `build-and-push.yml` follows ISB EA Option 2: develop→dev, test→test, main/v*→prod PR
- The ag-devops policy gate job runs on every push and PR
