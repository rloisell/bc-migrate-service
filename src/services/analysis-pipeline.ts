// src/services/analysis-pipeline.ts
// Orchestrates the three-stage analysis pipeline:
//   1. Collector — run collect.sh to gather OCP + repo data
//   2. Analyzer  — call LLM with collected data + section guide (streaming)
//   3. Renderer  — pandoc + chromium → PDF; upload as GitHub Release artifact
//
// Ryan Loiselle — Developer / Architect | GitHub Copilot | April 2026

import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join }   from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { verifyRepoAccess } from '../lib/github.js'
import { streamAnalysis }   from './analyzer.js'
import { renderPdf }        from './renderer.js'
import { uploadArtifact }   from './uploader.js'

const execFileAsync = promisify(execFile)

export interface AnalysisPipelineOptions {
  namespace:    string
  repo:         string
  cluster:      string
  target:       string
  envs:         string
  callerToken?: string
  onChunk:      (text: string) => void
}

export async function runAnalysis(opts: AnalysisPipelineOptions): Promise<void> {
  const { namespace, repo, cluster, target, envs, callerToken, onChunk } = opts

  // ── Access check ──────────────────────────────────────────────────────────
  if (callerToken) {
    onChunk(`Verifying access to \`${repo}\`...`)
    const hasAccess = await verifyRepoAccess(repo, callerToken)
    if (!hasAccess) {
      throw new Error(
        `You do not have read access to \`${repo}\`. ` +
        'Ensure the bc-migrate GitHub App is installed on that repository.'
      )
    }
    onChunk(' ✓\n\n')
  }

  // ── Scratch directory ──────────────────────────────────────────────────────
  const workDir  = process.env.WORK_DIR ?? join(tmpdir(), 'bc-migrate-work')
  const jobDir   = join(workDir, `${namespace}-${Date.now()}`)
  const reportDir = join(jobDir, 'report')
  await mkdir(jobDir,   { recursive: true })
  await mkdir(reportDir, { recursive: true })

  const toolkitPath = process.env.TOOLKIT_PATH ?? './submodules/ocp-migration-toolkit'

  // ── Stage 1: Collect ───────────────────────────────────────────────────────
  onChunk(`\n## Stage 1 — Collecting namespace data\n\n`)
  onChunk(`Scanning \`${namespace}\` on **${cluster}** (envs: ${envs})...\n`)

  const collectScript = join(toolkitPath, 'collect', 'collect.sh')
  const collectArgs = [
    '--namespace', namespace,
    '--cluster',   cluster,
    '--repo',      repo,
    '--target',    target,
    '--envs',      envs,
    '--output',    join(jobDir, 'working'),
  ]

  // If no OC_TOKEN configured, skip OCP collection and note it in the report
  const ocToken = cluster === 'silver'
    ? process.env.OC_SILVER_TOKEN
    : process.env.OC_GOLD_TOKEN

  if (!ocToken) {
    onChunk(
      '> ⚠️ No OCP token configured for this cluster. ' +
      'Proceeding with GitHub repo analysis only — namespace data will be empty.\n\n'
    )
  } else {
    try {
      await execFileAsync('bash', [collectScript, ...collectArgs], {
        env: {
          ...process.env,
          KUBECONFIG: '',  // prevent interference from ambient kubeconfig
        },
        timeout: (parseInt(process.env.JOB_TIMEOUT_MINUTES ?? '10') * 60 * 1000) / 2,
      })
      onChunk('Collection complete. ✓\n\n')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onChunk(`> ⚠️ Collection encountered errors: ${msg}\n> Proceeding with partial data.\n\n`)
    }
  }

  // ── Stage 2: Analyze ───────────────────────────────────────────────────────
  onChunk(`## Stage 2 — AI Gap Analysis\n\n`)
  onChunk(`Analysing \`${namespace}\` → **${target}** migration...\n\n`)

  const manifestSummaryPath = join(jobDir, 'working', namespace, 'manifest-summary.md')
  let manifestSummary = ''
  try {
    manifestSummary = await readFile(manifestSummaryPath, 'utf-8')
  } catch {
    manifestSummary = `# OCP Collection Summary\n\nNamespace: ${namespace}\nRepo: ${repo}\n` +
      `No OCP data collected — GitHub repo analysis only.\n`
  }

  const sectionGuidePath = join(toolkitPath, 'templates', 'report-sections.md')
  const sectionGuide = await readFile(sectionGuidePath, 'utf-8').catch(() => '')

  const appName    = repo.split('/').at(-1)?.toUpperCase() ?? namespace.toUpperCase()
  const reportFile = join(reportDir, `${appName}-Migration-Analysis.md`)

  // Stream the analysis back to Copilot Chat AND collect it for PDF rendering
  const reportChunks: string[] = []

  await streamAnalysis({
    manifestSummary,
    sectionGuide,
    workDir:    join(jobDir, 'working', namespace),
    namespace,
    repo,
    cluster,
    target,
    callerToken,
    onChunk: (text) => {
      onChunk(text)
      reportChunks.push(text)
    },
  })

  // Write the full report markdown
  const reportMarkdown = reportChunks.join('')
  await writeFile(reportFile, reportMarkdown, 'utf-8')

  // ── Stage 3: Render + Upload ───────────────────────────────────────────────
  onChunk(`\n\n## Stage 3 — Rendering PDF\n\n`)

  const pdfFile = join(reportDir, `${appName}-Migration-Analysis.pdf`)

  try {
    await renderPdf({
      inputMd:    reportFile,
      outputDir:  reportDir,
      cssPath:    join(toolkitPath, 'templates', 'style', 'report-style.css'),
      renderScript: join(toolkitPath, 'render', 'render.sh'),
    })
    onChunk('PDF rendered. ✓\n\n')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    onChunk(`> ⚠️ PDF rendering failed: ${msg}\n> Markdown report is still available.\n\n`)
  }

  // Upload PDF as a GitHub Release artifact if we have a caller token
  if (callerToken) {
    try {
      const artifactUrl = await uploadArtifact({
        repo,
        pdfPath:     pdfFile,
        markdownPath: reportFile,
        appName,
        callerToken,
      })
      onChunk(
        `---\n\n` +
        `✅ **Analysis complete.**\n\n` +
        `📄 [Download PDF Report](${artifactUrl})\n\n` +
        `Generated: ${new Date().toISOString()}\n`
      )
    } catch {
      onChunk(
        `---\n\n` +
        `✅ **Analysis complete.** (PDF upload skipped — check service logs.)\n\n` +
        `Generated: ${new Date().toISOString()}\n`
      )
    }
  }
}
