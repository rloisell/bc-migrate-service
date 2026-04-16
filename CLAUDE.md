# CLAUDE.md — bc-migrate-service

This file provides project-level instructions for Claude Code.
Base instructions (shared personas, skills, subagents) are in `.github/agents/CLAUDE.md`
via the rl-agents-n-skills submodule.

## Project purpose

`bc-migrate-service` is a **GitHub Copilot Extension** deployed on Emerald OpenShift
that provides on-demand OCP namespace migration analysis via `@bc-migrate` in Copilot Chat.

It is the **Tier 3** (service) layer of the three-tier OCP migration toolkit:

| Tier | Name | What it is |
|------|------|-----------|
| 1 | ocp-migration-analyst skill | VS Code / Copilot chat prompt template |
| 2 | ocp-migration-toolkit | CLI bash scripts + GitHub Composite Action |
| 3 | bc-migrate-service | This repo — Fastify/Node.js Copilot Extension on Emerald |

## Stack

- **Runtime:** Node.js 22 LTS, TypeScript 5.x, Fastify 5.x
- **GitHub Copilot Extensions protocol:** `@copilot-extensions/preview-sdk`
- **LLM:** GitHub Models API (`models.inference.ai.azure.com`) — `openai/gpt-4o`
- **PDF rendering:** pandoc + headless Chromium (via submodule `ocp-migration-toolkit`)
- **Deployment:** Emerald OpenShift, namespace `be808f`, ArgoCD + ag-helm-templates
- **Secrets:** Vault + External Secrets Operator (never plain OCP Secrets)

## Source layout

```
src/
  index.ts                         Fastify entry point
  routes/
    copilot.ts                     GitHub Copilot Extensions SSE handler
    health.ts                      /health/live + /health/ready
  services/
    analysis-pipeline.ts           Orchestrates collect → analyze → render
    analyzer.ts                    Calls GitHub Models API (streaming)
    renderer.ts                    pandoc + chromium PDF rendering
    uploader.ts                    Creates GitHub Release + uploads PDF
  lib/
    command-parser.ts              Parses @bc-migrate analyze namespace:X repo:Y
    github.ts                      Octokit helpers (verifyRepoAccess)
gitops/
  charts/bc-migrate/               Helm chart
  applications/argocd/             ArgoCD Application CRDs
containerization/
  Containerfile                    Node.js 22 + pandoc + chromium
submodules/
  ocp-migration-toolkit/           collect.sh, render.sh, report-sections.md
```

## Submodules

- `.github/agents/` → `rl-agents-n-skills` (shared agents and skills)
- `submodules/ocp-migration-toolkit/` → `ocp-migration-toolkit` (collection + rendering scripts)

To update submodules:
```bash
git submodule update --remote --merge
git add .github/agents submodules/ocp-migration-toolkit
git commit -m "chore: update submodules"
```

Do NOT edit files inside these submodule directories — make changes in those repos.

## ag-devops policy gate

All Helm changes must pass the 4-tool policy gate:
```bash
helm template bc-migrate-service gitops/charts/bc-migrate > /tmp/rendered.yaml
datree test /tmp/rendered.yaml
polaris audit --audit-path /tmp/rendered.yaml
kube-linter lint /tmp/rendered.yaml
conftest test /tmp/rendered.yaml
```

Key requirements enforced:
- Pod labels: `DataClass`, `owner`, `environment` (all three required)
- `priorityClassName` must be set on all Deployments
- NetworkPolicies via ag-helm intent API (`AllowIngressFrom`/`AllowEgressTo`)
- Internet egress requires `justification` + `approvedBy` annotations
- Edge-terminated Routes require `isb.gov.bc.ca/edge-termination-approval` annotation

## Key ports

- `8080` — HTTP (container, Service, Route)
- `/health/live` — liveness probe
- `/health/ready` — readiness probe
- `/api/v1/extension` — Copilot Extensions webhook

## Secrets (via Vault)

Path: `secret/data/be808f-<env>/bc-migrate-service`

Keys: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`,
`GITHUB_MODELS_API_KEY`, `OC_SILVER_TOKEN`, `OC_GOLD_TOKEN`

Never commit real secret values. All secrets consumed as environment variables
injected by the ExternalSecret → k8s Secret → pod env var chain.
