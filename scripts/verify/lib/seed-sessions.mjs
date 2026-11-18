/**
 * Seed switchable Sessions into an isolated DSH_HOME (session-switch probe fixture).
 *
 * The web host hides blank Sessions from the sidebar (the session list filters on the
 * turn-boundary projection), and a blank Session is all a bare isolated host creates.
 * Switching conversations therefore needs Sessions that already recorded a turn.
 * No real credential may be used against the network, so this module answers the
 * Messages protocol with a local mock endpoint and lets `dsh headless` run one real
 * turn per Session — the resulting JSONL logs are the same ones the UI reads.
 *
 * A brand-new DSH_HOME has an empty Workspace store and the Host would ask the UI
 * visitor to pick a workspace; this module writes the same store shape the first-run
 * onboarding writes (one default Workspace), so the seeded Sessions are listed.
 *
 * @module scripts/verify/lib/seed-sessions
 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

/** SSE frame for one mock Messages event. */
function sse(event) {
  return 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n'
}

/** Mock Anthropic-Messages endpoint: answers one text turn per request. */
function startMockLlm() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', chunk => { body += chunk })
      request.on('error', () => {})
      request.on('end', () => {
        if (!/\/messages$/u.test(request.url || '')) {
          response.writeHead(404, { 'content-type': 'application/json' })
          response.end('{"error":{"message":"not found"}}')
          return
        }
        let model = 'deepseek-flash'
        try {
          const parsed = JSON.parse(body)
          if (typeof parsed.model === 'string') model = parsed.model
        } catch {
          /* the mock only needs a model label; malformed bodies still get an answer */
        }
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        response.end([
          { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: 12, output_tokens: 1 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok from mock' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 12, output_tokens: 5 } },
          { type: 'message_stop' },
        ].map(sse).join(''))
      })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePromise({ server, port: server.address().port }))
  })
}

/** Read the Workspace store of one isolated home, if it exists. */
function readWorkspace(hostHome) {
  const path = join(hostHome, 'storages', 'workspace.json')
  if (!existsSync(path)) return null
  try {
    return { path, data: JSON.parse(readFileSync(path, 'utf8')) }
  } catch {
    return null
  }
}

/**
 * Resolve the default Workspace of an isolated home, writing the first-run store
 * shape (one default Workspace) when the home has none yet.
 * @param {string} hostHome - isolated DSH_HOME.
 * @returns {{storePath: string, data: object, workspaceId: string, workspacePath: string}}
 */
function ensureWorkspace(hostHome) {
  const store = readWorkspace(hostHome)
  if (store !== null) {
    const global = store.data && store.data.global ? store.data.global : {}
    const workspaceId = typeof global.defaultWorkspaceId === 'string' ? global.defaultWorkspaceId : (Array.isArray(global.workspaceIds) ? global.workspaceIds[0] : undefined)
    const record = workspaceId !== undefined ? store.data.tables?.workspaces?.[workspaceId] : undefined
    if (record && typeof record.path === 'string') return { storePath: store.path, data: store.data, workspaceId, workspacePath: record.path }
  }
  const workspaceId = randomUUID()
  const workspacePath = join(hostHome, 'workspace')
  mkdirSync(workspacePath, { recursive: true })
  mkdirSync(join(hostHome, 'storages'), { recursive: true })
  const now = new Date().toISOString()
  const data = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [], pinnedSessionIds: [], defaultWorkspaceId: workspaceId },
    tables: {
      workspaces: {
        [workspaceId]: { path: workspacePath, title: 'default-workspace', sessionIds: [], createdAt: now, updatedAt: now },
      },
    },
  }
  const storePath = join(hostHome, 'storages', 'workspace.json')
  writeFileSync(storePath, JSON.stringify(data, null, 2))
  return { storePath, data, workspaceId, workspacePath }
}

/** Every Session directory under one DSH_HOME, flattened across project folders. */
function sessionDirs(hostHome) {
  const root = join(hostHome, 'sessions')
  if (!existsSync(root)) return []
  const found = []
  for (const project of readdirSync(root)) {
    const projectDir = join(root, project)
    let entries = []
    try {
      entries = readdirSync(projectDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('session-')) {
        found.push({ id: entry.name, dir: join(projectDir, entry.name) })
      }
    }
  }
  return found
}

/** A Session that recorded at least one turn (blank logs are a header line only). */
function isNonBlank(dir) {
  let files = []
  try {
    files = readdirSync(dir)
  } catch {
    return false
  }
  for (const name of files) {
    if (!/^session\.v\d+\.jsonl(\.zstd)?$/u.test(name)) continue
    try {
      if (statSync(join(dir, name)).size > 900) return true
    } catch {
      /* raced with the writer: treat as not ready */
    }
  }
  return false
}

/**
 * Ensure the isolated home has at least `count` non-blank Sessions listed in its
 * default Workspace, then return their ids (creates them with a mock model).
 *
 * @param {object} host - result of prepareHost (`hostHome`, `bin`).
 * @param {number} count - how many switchable Sessions the probe needs.
 * @returns {Promise<{ids: string[], created: string[], warnings: string[]}>}
 */
export async function seedSessions(host, count = 2) {
  const warnings = []
  const workspace = ensureWorkspace(host.hostHome)
  const record = workspace.data.tables.workspaces[workspace.workspaceId]
  const listedIds = Array.isArray(record.sessionIds) ? record.sessionIds : []

  const projectDirOf = sessionId => {
    const root = join(host.hostHome, 'sessions')
    if (!existsSync(root)) return null
    for (const project of readdirSync(root)) {
      if (existsSync(join(root, project, sessionId))) return project
    }
    return null
  }
  const usable = sessionId => {
    const project = projectDirOf(sessionId)
    return project !== null && isNonBlank(join(host.hostHome, 'sessions', project, sessionId))
  }

  const existing = listedIds.filter(usable)
  const before = new Set(sessionDirs(host.hostHome).map(item => item.id))
  if (existing.length < count) {
    const { server, port } = await startMockLlm()
    try {
      for (let index = existing.length; index < count; index += 1) {
        // Some builds keep a background worker alive after printing the answer, so the
        // child may need killing; what matters is the Session log it wrote. stdin is
        // ignored so a headless run never waits on a pipe nobody feeds.
        const result = spawnSync(process.execPath, [host.bin, 'headless', 'seed session ' + (index + 1) + ' for the session-switch probe'], {
          cwd: workspace.workspacePath,
          env: Object.assign({}, process.env, {
            DSH_HOME: host.hostHome,
            DEEPSEEK_API_KEY: 'mock-key',
            DEEPSEEK_BASE_URL: 'http://127.0.0.1:' + port,
          }),
          encoding: 'utf8',
          timeout: 90000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        const seededRun = sessionDirs(host.hostHome).some(item => !before.has(item.id) && isNonBlank(item.dir))
        if (!seededRun) {
          warnings.push('dsh headless run ' + (index + 1) + ' did not leave a non-blank Session: exit ' + String(result.status) + ' ' + String(result.stderr || result.stdout || result.error || '').slice(-500))
        }
      }
    } finally {
      await new Promise(resolvePromise => server.close(resolvePromise))
    }
  }

  const created = []
  for (const item of sessionDirs(host.hostHome)) {
    if (before.has(item.id)) continue
    if (!isNonBlank(item.dir)) continue
    created.push(item.id)
  }

  const nextIds = [...new Set([...listedIds, ...created])]
  record.sessionIds = nextIds
  writeFileSync(workspace.storePath, JSON.stringify(workspace.data, null, 2))

  const ids = nextIds.filter(usable)
  return { ids: ids.slice(0, Math.max(count, ids.length)), created, warnings }
}
