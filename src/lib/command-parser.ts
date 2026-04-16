// src/lib/command-parser.ts
// Parses the @bc-migrate command from a Copilot Chat user message.
//
// Supported syntax:
//   @bc-migrate analyze namespace:f1b263 repo:bcgov-c/myapp [target:emerald] [cluster:silver] [envs:dev,prod]
//   @bc-migrate help

export type AnalyzeCommand = {
  type:       'analyze'
  namespace:  string
  repo:       string
  target?:    string
  cluster?:   string
  envs?:      string
}

export type HelpCommand    = { type: 'help' }
export type UnknownCommand = { type: 'unknown'; raw: string }

export type ParsedCommand = AnalyzeCommand | HelpCommand | UnknownCommand

const VALID_TARGETS  = new Set(['emerald', 'aws-ecs', 'aws-eks'])
const VALID_CLUSTERS = new Set(['silver', 'gold', 'emerald'])

export function parseCommand(message: string): ParsedCommand {
  // Strip leading @bc-migrate mention and normalise whitespace
  const cleaned = message
    .replace(/@bc-migrate\s*/gi, '')
    .trim()

  if (!cleaned || /^help$/i.test(cleaned)) {
    return { type: 'help' }
  }

  // Require the 'analyze' verb
  if (!/^analyze\b/i.test(cleaned)) {
    return { type: 'unknown', raw: cleaned }
  }

  const args = cleaned.replace(/^analyze\s*/i, '')

  // Extract key:value pairs — allows spaces inside values if quoted
  const params: Record<string, string> = {}
  const kvRegex = /(\w+):("([^"]+)"|([^\s]+))/g
  let match: RegExpExecArray | null
  while ((match = kvRegex.exec(args)) !== null) {
    params[match[1].toLowerCase()] = match[3] ?? match[4]
  }

  const namespace = params['namespace']
  const repo      = params['repo']

  // Validate required fields
  if (!namespace || !/^[a-z0-9]{6}$/.test(namespace)) {
    return {
      type:  'unknown',
      raw:   `Invalid or missing namespace: "${namespace ?? ''}". ` +
             'Namespace prefix must be a 6-character alphanumeric license plate (e.g. f1b263).',
    }
  }

  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return {
      type: 'unknown',
      raw:  `Invalid or missing repo: "${repo ?? ''}". Must be in owner/name format.`,
    }
  }

  const target  = params['target']
  const cluster = params['cluster']

  if (target && !VALID_TARGETS.has(target)) {
    return { type: 'unknown', raw: `Invalid target: "${target}". Must be: ${[...VALID_TARGETS].join(' | ')}` }
  }

  if (cluster && !VALID_CLUSTERS.has(cluster)) {
    return { type: 'unknown', raw: `Invalid cluster: "${cluster}". Must be: ${[...VALID_CLUSTERS].join(' | ')}` }
  }

  return {
    type:      'analyze',
    namespace,
    repo,
    target:    target  as AnalyzeCommand['target'],
    cluster:   cluster as AnalyzeCommand['cluster'],
    envs:      params['envs'],
  }
}
