# bc-migrate-service

**Tier 3 of the OCP Migration Toolkit — GitHub Copilot Extension.**

Expose migration analysis as a service: any BC Gov team types
`@bc-migrate analyze namespace:f1b263 repo:bcgov-c/myapp` in any GitHub Copilot Chat
interface (VS Code, GitHub.com, GitHub Mobile) and receives a streaming analysis
with a link to the generated PDF artifact.

Deployed as a single `Deployment` on Emerald OpenShift (`be808f` or project namespace).
Scaled to zero when idle via KEDA HTTP-based autoscaling.

---

## Architecture

```
GitHub Copilot Chat
  │
  │  @bc-migrate analyze namespace:f1b263 repo:bcgov-c/myapp
  │
  ▼
GitHub Copilot Extensions API (SSE)
  │  POST /api/v1/extension
  │
  ▼
bc-migrate-service  (Node.js / Fastify — Emerald OpenShift)
  │
  ├── Auth gate: verify GitHub App JWT + confirm caller has repo access
  │
  ├── Collector: oc CLI (ephemeral Job pod) + gh API → manifest-summary.md
  │
  ├── Analyzer: GitHub Models API (gpt-4o / claude-sonnet)
  │             System prompt: report-sections.md + all skill knowledge
  │             User message: manifest-summary.md + collected YAML
  │             Streams analysis back to Copilot Chat as SSE chunks
  │
  ├── Renderer: pandoc + headless Chromium → PDF
  │
  └── Uploader: creates GitHub Release artifact, returns link in response
```

---

## Tech Stack

| Component | Technology | Reason |
|-----------|-----------|--------|
| Web framework | Fastify (Node.js 22 LTS) | Excellent SSE support, low latency, TypeScript-first |
| Language | TypeScript 5.x | Type safety on protocol objects |
| Copilot Extension SDK | `@copilot-extensions/preview-sdk` | Official GitHub SDK for the extension protocol |
| LLM | GitHub Models API (proxy over Azure OpenAI) | No external key needed — uses `GITHUB_TOKEN` |
| OCP CLI | `oc` CLI in sidecar / Job | Namespace data collection |
| PDF | pandoc + chromium-headless | Matches Tier 1/2 rendering exactly |
| GitOps | ArgoCD + ag-helm-templates | Standard Emerald ISB EA Option 2 |
| Secrets | Vault + External Secrets Operator | BC Gov standard |
| Scaling | KEDA HTTP trigger | Scale to zero between analysis requests |

---

## Quick Start — Local Development

```bash
# Prerequisites: Node.js 22+, Docker/Podman, oc (optional for collection)
git clone https://github.com/rloisell/bc-migrate-service.git
cd bc-migrate-service
git submodule update --init --recursive   # pulls rl-agents-n-skills

cp .env.example .env
# Edit .env: set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_MODELS_API_KEY

npm install
npm run dev         # Fastify on http://localhost:8080

# Test the extension locally using GitHub's smee.io proxy:
# https://docs.github.com/en/copilot/building-copilot-extensions/testing-your-copilot-extension
```

---

## Deployment — Emerald OpenShift

This repo uses the standard two-repo GitOps pattern (ISB EA Option 2).
See [docs/deployment/README.md](docs/deployment/README.md).

```
Application repo:    github.com/rloisell/bc-migrate-service
GitOps repo:         github.com/rloisell/bc-migrate-service-gitops  (Helm values)
Emerald namespace:   be808f-dev / be808f-test / be808f-prod
Artifactory:         artifacts.developer.gov.bc.ca/be808f/bc-migrate-service
```

---

## GitHub App Registration

1. Create a new GitHub App at https://github.com/settings/apps/new
2. Set **Callback URL**: `https://bc-migrate.apps.emerald.devops.gov.bc.ca/auth/callback`
3. Set **Copilot** → **Extension type**: `agent`
4. Set **Webhook URL**: `https://bc-migrate.apps.emerald.devops.gov.bc.ca/api/v1/extension`
5. Required permissions:
   - **Copilot Chat**: Read (to receive extension messages)
   - **Contents**: Read (to read repo files for collection)
   - **Metadata**: Read
   - **Members**: Read (to verify org membership for access control)
6. Install the app on the `bcgov-c` and `bcgov` organizations
7. Store the App ID and private key in Vault at `secret/be808f/bc-migrate-service`

---

## Extension Usage

```
# In any GitHub Copilot Chat:
@bc-migrate analyze namespace:f1b263 repo:bcgov-c/justinrcc

# With explicit options:
@bc-migrate analyze namespace:f1b263 repo:bcgov-c/justinrcc target:emerald envs:dev,prod

# Help:
@bc-migrate help
```

---

## Related Repositories

| Repo | Role |
|------|------|
| [ocp-migration-toolkit](https://github.com/rloisell/ocp-migration-toolkit) | Tier 2 — CLI + GitHub Action (collection scripts, templates, render script, Composite Action) |
| [rl-agents-n-skills](https://github.com/rloisell/rl-agents-n-skills) | Skill library — `ocp-migration-analyst` orchestrator, `bc-gov-*` platform skills |
| [rl-project-template](https://github.com/rloisell/rl-project-template) | Project template — Containerfile, Helm chart, ArgoCD, CI/CD workflow patterns used here |

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
