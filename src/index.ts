// src/index.ts
// bc-migrate-service — Fastify entry point
// Ryan Loiselle — Developer / Architect | GitHub Copilot | April 2026
//
// Starts the Fastify server on PORT (default 8080).
// Registers routes: /api/v1/extension (Copilot Extension), /health/*

import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { extensionRoute } from './routes/copilot.js'
import { healthRoute } from './routes/health.js'

const app = Fastify({
  logger: {
    level:     process.env.LOG_LEVEL ?? 'info',
    // Structured JSON logging — required for Splunk/OpenTelemetry on Emerald
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty' }
      : undefined,
  },
})

await app.register(sensible)
await app.register(healthRoute)
await app.register(extensionRoute, { prefix: '/api/v1' })

const port = parseInt(process.env.PORT ?? '8080', 10)
const host = '0.0.0.0'  // bind all interfaces — required in container

try {
  await app.listen({ port, host })
  app.log.info(`bc-migrate-service listening on ${host}:${port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
