import { version } from '../../../../package.json'

/** The subset of opencode configuration used by Lumina's search defaults. */
export interface SearchConfig {
  mcp?: Record<string, unknown>
  tools?: Record<string, boolean>
  permission?: string | Record<string, unknown>
  agent?: Record<string, {
    tools?: Record<string, boolean>
    permission?: string | Record<string, unknown>
  }>
}

// Opencode permission names support '*' and '?' wildcards.
function matches(pattern: string, name: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(name)
}

/**
 * Called with opencode's merged configuration, before MCP initialization.
 * An existing MCP map or network-tool policy is an explicit user choice.
 */
export function configureSearchMcp(config: SearchConfig): void {
  const permission = config.permission
  if (
    config.mcp !== undefined ||
    ['OPENCODE_ENABLE_EXA', 'OPENCODE_EXPERIMENTAL', 'OPENCODE_EXPERIMENTAL_EXA']
      .some((name) => ['1', 'true'].includes(process.env[name] ?? '')) ||
    process.env.EXA_API_KEY ||
    process.env.PARALLEL_API_KEY ||
    config.tools?.websearch !== undefined ||
    config.tools?.webfetch !== undefined ||
    permission === 'deny' ||
    (typeof permission === 'object' && (
      permission['*'] === 'deny' ||
      Object.keys(permission).some((key) => key !== '*' &&
        (matches(key, 'websearch') || matches(key, 'webfetch')))
    ))
  ) return

  // Use the normal approval flow for the new tools. Explicit global allow
  // (including Lumina's auto-approve setting) remains authoritative.
  if (permission === undefined) config.permission = { 'lumina_parallel_*': 'ask' }
  else if (typeof permission === 'object') {
    config.permission = { 'lumina_parallel_*': 'ask', ...permission }
  }

  config.mcp = {
    lumina_parallel: {
      type: 'remote',
      url: 'https://search.parallel.ai/mcp',
      oauth: false,
      timeout: 30_000,
      headers: { 'User-Agent': `Lumina-Note/${version}` },
    },
  }

  // MCP tools have their own permission names. Carry over agent-specific
  // network restrictions so background agents cannot bypass them.
  for (const agent of Object.values(config.agent ?? {})) {
    if (typeof agent.permission === 'string') continue
    const original = agent.permission ?? {}
    const policy = { ...original }
    for (const [builtin, mcp] of [
      ['websearch', 'lumina_parallel_web_search'],
      ['webfetch', 'lumina_parallel_web_fetch'],
    ]) {
      if (Object.keys(original).some((key) => key !== '*' && matches(key, mcp))) continue
      if (agent.tools?.[builtin] !== undefined) {
        policy[mcp] = agent.tools[builtin] ? 'allow' : 'deny'
      }
      else {
        for (const [pattern, action] of Object.entries(original)) {
          if (pattern === '*' || !matches(pattern, builtin)) continue
          // URL/query-scoped rules cannot be applied to MCP's '*' resource.
          // Keep those restrictions by denying the corresponding default tool.
          policy[mcp] = typeof action === 'string' ? action : 'deny'
        }
      }
    }
    agent.permission = policy
  }
}
