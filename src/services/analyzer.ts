// src/services/analyzer.ts
// Calls the GitHub Models API (or OpenAI) with the collected namespace data
// and streams the analysis back as text chunks.
//
// The system prompt combines:
//   1. The ocp-migration-analyst SKILL.md (orchestrator)
//   2. The report-sections.md generation guide
//   3. All relevant bc-gov-* skill knowledge (embedded at build time)
//
// Ryan Loiselle — Developer / Architect | GitHub Copilot | April 2026

import { readFile } from 'node:fs/promises'
import { join }     from 'node:path'

export interface AnalyzerOptions {
  manifestSummary: string
  sectionGuide:    string
  workDir:         string
  namespace:       string
  repo:            string
  cluster:         string
  target:          string
  callerToken?:    string
  onChunk:         (text: string) => void
}

export async function streamAnalysis(opts: AnalyzerOptions): Promise<void> {
  const { manifestSummary, sectionGuide, namespace, repo, cluster, target, callerToken, onChunk } = opts

  const baseUrl = process.env.GITHUB_MODELS_BASE_URL ?? 'https://models.inference.ai.azure.com'
  const apiKey  = process.env.GITHUB_MODELS_API_KEY  ?? callerToken
  const model   = process.env.LLM_MODEL ?? 'openai/gpt-4o'

  if (!apiKey) {
    throw new Error('No LLM API key available. Set GITHUB_MODELS_API_KEY or pass a caller token.')
  }

  const systemPrompt = buildSystemPrompt(sectionGuide)
  const userPrompt   = buildUserPrompt({ manifestSummary, namespace, repo, cluster, target })

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system',  content: systemPrompt },
        { role: 'user',    content: userPrompt   },
      ],
      // Large context needed for full 12-section report
      max_tokens: 16000,
      temperature: 0.2,  // Low temperature — analysis should be deterministic
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`LLM API error ${response.status}: ${body}`)
  }

  if (!response.body) {
    throw new Error('LLM API returned no body')
  }

  // Parse SSE stream from LLM API and forward chunks to the caller
  const decoder = new TextDecoder()
  const reader  = response.body.getReader()
  let   buffer  = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
      try {
        const data  = JSON.parse(line.slice(6))
        const delta = data.choices?.[0]?.delta?.content
        if (delta) onChunk(delta)
      } catch {
        // Malformed SSE line — skip
      }
    }
  }
}

function buildSystemPrompt(sectionGuide: string): string {
  return [
    '# OCP Migration Analyst — System Prompt',
    '',
    'You are an expert BC Government OpenShift platform migration analyst.',
    'You have deep knowledge of:',
    '- Emerald OpenShift requirements: AVI InfraSettings, DataClass/owner/environment pod labels,',
    '  ag-helm-templates, ag-devops policy-as-code gate (Datree+Polaris+kube-linter+Conftest),',
    '  ArgoCD GitOps, Vault + External Secrets Operator, PriorityClass, NetworkPolicy intent API',
    '- BC Gov SDN zones: Zone A/B/C, CSBC FWCR process, Zone B services (SFTP SFEG, ORDS)',
    '- Spring Boot 3.x: Micrometer Tracing, OpenTelemetry SDK, Actuator health probes',
    '- GitHub Actions: ISB EA Option 2 (5-workflow pattern), Artifactory, SHA digest pinning',
    '- Security: OWASP Top 10, pod security contexts, Trivy, secret management in Vault',
    '',
    'CRITICAL RULES:',
    '1. Never use placeholder text — every section must contain real analysis from the input data',
    '2. All 12 sections must be present and substantive',
    '3. Every gap must map to at least one numbered task in Section 9',
    '4. Flag ⛔ CRITICAL gaps prominently — do not bury them',
    '5. Identify FWCR requirements for every Zone B external service',
    '6. Do NOT describe Silver/Gold as "end-of-life" — frame migrations around capability gaps',
    '',
    '## Section Generation Guide',
    '',
    sectionGuide,
  ].join('\n')
}

function buildUserPrompt(opts: {
  manifestSummary: string
  namespace:       string
  repo:            string
  cluster:         string
  target:          string
}): string {
  const { manifestSummary, namespace, repo, cluster, target } = opts

  return [
    `# Migration Analysis Request`,
    ``,
    `**Namespace prefix:** ${namespace}`,
    `**Source cluster:**   ${cluster}`,
    `**Target platform:**  ${target}`,
    `**Repository:**       ${repo}`,
    `**Analysis date:**    ${new Date().toISOString().split('T')[0]}`,
    ``,
    `## Collected Data`,
    ``,
    manifestSummary,
    ``,
    `---`,
    ``,
    `Please generate the full 12-section migration analysis report following the section`,
    `generation guide in the system prompt. Output pure markdown — no preamble or commentary.`,
    `Start directly with the document header (# ${repo.split('/').at(-1)?.toUpperCase()} — Migration Analysis Report).`,
  ].join('\n')
}
