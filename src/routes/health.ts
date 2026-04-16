// src/routes/health.ts
// Liveness and readiness probes — required on Emerald OpenShift.
// Polaris requires both endpoints to be wired in the Helm chart.

import type { FastifyInstance } from 'fastify'

export async function healthRoute(app: FastifyInstance) {
  // Liveness: is the process alive?
  app.get('/health/live', async (_req, reply) => {
    return reply.send({ status: 'ok' })
  })

  // Readiness: is the service ready to accept requests?
  // Add dependency checks here (e.g., confirm LLM API reachable) if needed.
  app.get('/health/ready', async (_req, reply) => {
    return reply.send({ status: 'ok', version: process.env.npm_package_version ?? 'unknown' })
  })
}
