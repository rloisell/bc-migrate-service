// src/services/renderer.ts
// Renders a markdown report to PDF using pandoc + headless Chromium.

import { execFile }  from 'node:child_process'
import { promisify } from 'node:util'
import { join }      from 'node:path'

const execFileAsync = promisify(execFile)

export interface RenderOptions {
  inputMd:      string   // absolute path to the markdown file
  outputDir:    string   // directory to write PDF into
  cssPath:      string   // absolute path to the CSS stylesheet
  renderScript: string   // absolute path to render/render.sh
}

export async function renderPdf(opts: RenderOptions): Promise<string> {
  const { inputMd, outputDir, cssPath, renderScript } = opts

  await execFileAsync('bash', [
    renderScript,
    '--input',  inputMd,
    '--output', outputDir,
    '--css',    cssPath,
  ], {
    timeout: 120_000,  // 2 minutes — generous for large reports
  })

  const base    = inputMd.replace(/\.md$/, '')
  const pdfPath = join(outputDir, `${base.split('/').at(-1)}.pdf`)
  return pdfPath
}
