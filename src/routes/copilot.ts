// src/routes/copilot.ts
// GitHub Copilot Extensions protocol handler.
// Ryan Loiselle — Developer / Architect | GitHub Copilot | April 2026
//
// Protocol reference:
//   https://docs.github.com/en/copilot/building-copilot-extensions/building-a-copilot-agent-for-your-copilot-extension
//
// Endpoint: POST /api/v1/extension
//   - Receives: JSON body { messages, copilot_references, ... }
//   - Returns:  SSE stream (text/event-stream) of OpenAI-compatible delta chunks
//
// Flow:
//   1. Verify GitHub request signature (HMAC-SHA256)
//   2. Parse command from user message (@bc-migrate analyze namespace:X repo:Y)
//   3. Run analysis (Collector → Analyzer → Renderer) with streaming progress updates
//   4. Return link to generated PDF artifact in final message

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { runAnalysis } from '../services/analysis-pipeline.js'
import { parseCommand } from '../lib/command-parser.js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CopilotMessage {
  role:    'user' | 'assistant' | 'system'
  content: string
}

interface CopilotExtensionBody {
  messages:           CopilotMessage[]
  copilot_references?: unknown[]
  stream?:            boolean
}

// ── Route registration ────────────────────────────────────────────────────────

export async function extensionRoute(app: FastifyInstance) {
  app.post<{ Body: CopilotExtensionBody }>(
    '/extension',
    {
      config: { rawBody: true },  // needed for signature verification
    },
    async (request: FastifyRequest<{ Body: CopilotExtensionBody }>, reply: FastifyReply) => {

      // ── 1. Verify GitHub signature ────────────────────────────────────────
      const secret = process.env.GITHUB_APP_WEBHOOK_SECRET
      if (secret) {
        const signature = request.headers['x-hub-signature-256'] as string | undefined
        if (!signature) {
          return reply.code(401).send({ error: 'Missing signature header' })
        }
        const body = (request as unknown as { rawBody: Buffer }).rawBody
        const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
        const sigBuf  = Buffer.from(signature)
        const expBuf  = Buffer.from(expected)
        if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
          return reply.code(401).send({ error: 'Invalid signature' })
        }
      }

      // ── 2. Parse user message ─────────────────────────────────────────────
      const userMessage = request.body.messages
        .filter(m => m.role === 'user')
        .at(-1)?.content ?? ''

      const command = parseCommand(userMessage)

      if (command.type === 'help' || command.type === 'unknown') {
        return sendSingleResponse(reply, helpText())
      }

      if (command.type !== 'analyze') {
        return sendSingleResponse(reply, `Unknown command. ${helpText()}`)
      }

      // ── 3. Validate inputs ────────────────────────────────────────────────
      if (!command.namespace || !command.repo) {
        return sendSingleResponse(reply,
          '**Missing required parameters.**\n\n' +
          'Usage: `@bc-migrate analyze namespace:<prefix> repo:<owner/name>`\n\n' +
          'Example: `@bc-migrate analyze namespace:f1b263 repo:bcgov-c/justinrcc`'
        )
      }

      // ── 4. Stream the analysis ────────────────────────────────────────────
      reply.raw.writeHead(200, {
        'Content-Type':      'text/event-stream',
        'Cache-Control':     'no-cache',
        'X-Accel-Buffering': 'no',   // disable Nginx buffering for SSE
        'Connection':        'keep-alive',
      })

      // Caller's GitHub token is forwarded so we can use it for Models API
      // and to verify the caller has read access to the requested repo.
      const callerToken = request.headers['x-github-token'] as string | undefined

      try {
        await runAnalysis({
          namespace:    command.namespace,
          repo:         command.repo,
          cluster:      command.cluster ?? 'silver',
          target:       command.target  ?? 'emerald',
          envs:         command.envs    ?? 'dev,test,prod,tools',
          callerToken,
          // Write SSE chunks back to the HTTP response
          onChunk: (text: string) => {
            writeSseChunk(reply, text)
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        writeSseChunk(reply, `\n\n**Analysis failed:** ${message}`)
        app.log.error({ err, command }, 'Analysis pipeline error')
      }

      writeSseDone(reply)
      reply.raw.end()
    }
  )
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function writeSseChunk(reply: FastifyReply, content: string) {
  const chunk = {
    choices: [{
      delta: { role: 'assistant', content },
      finish_reason: null,
      index: 0,
    }],
  }
  reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)
}

function writeSseDone(reply: FastifyReply) {
  const done = {
    choices: [{
      delta: {},
      finish_reason: 'stop',
      index: 0,
    }],
  }
  reply.raw.write(`data: ${JSON.stringify(done)}\n\n`)
  reply.raw.write('data: [DONE]\n\n')
}

function sendSingleResponse(reply: FastifyReply, content: string) {
  reply.header('Content-Type', 'text/event-stream')
  writeSseChunk(reply, content)
  writeSseDone(reply)
  reply.raw.end()
  return reply
}

function helpText(): string {
  return [
    '## @bc-migrate — OCP Migration Analysis',
    '',
    '**Commands:**',
    '',
    '```',
    '# Generate a full migration analysis report',
    '@bc-migrate analyze namespace:<prefix> repo:<owner/name>',
    '',
    '# With optional parameters',
    '@bc-migrate analyze namespace:f1b263 repo:bcgov-c/justinrcc target:emerald envs:dev,prod',
    '```',
    '',
    '**Parameters:**',
    '| Parameter | Required | Default | Description |',
    '|-----------|----------|---------|-------------|',
    '| `namespace` | ✅ | — | OCP namespace prefix (e.g. `f1b263`) |',
    '| `repo` | ✅ | — | GitHub repo `owner/name` |',
    '| `target` | ❌ | `emerald` | Target platform: `emerald` \\| `aws-ecs` \\| `aws-eks` |',
    '| `cluster` | ❌ | `silver` | Source cluster: `silver` \\| `gold` |',
    '| `envs` | ❌ | `dev,test,prod,tools` | Comma-separated environment suffixes |',
    '',
    'The analysis takes 3–8 minutes depending on namespace size.',
    'You will receive streaming progress updates, then a link to the PDF report.',
  ].join('\n')
}
