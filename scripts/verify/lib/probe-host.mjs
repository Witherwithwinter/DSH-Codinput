/**
 * Isolated DSH host lifecycle for the runtime probe.
 *
 * The probe owns a temp DSH_HOME whose web profile link-installs this repo as
 * the dsh-codinput plugin, boots `dsh web` on a private port and returns the
 * tokenised URL. Nothing outside the temp dirs / repo is touched.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function repoRootWin(repo) {
  return repo.split('/').join('\\')
}

export function prepareHost(repo) {
  const hostDir = process.env.DCI_HOST_DIR || join(tmpdir(), 'dsh-verify', 'rc')
  const hostHome = process.env.DCI_HOST_HOME || join(tmpdir(), 'dsh-verify', 'home')
  const port = Number(process.env.DCI_HOST_PORT || 3099)
  const bin = join(hostDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const info = { hostDir, hostHome, port, bin, url: '', child: null }
  if (!existsSync(bin)) {
    return Object.assign({}, info, {
      error: 'dsh host not installed at ' + bin,
      setupHint: 'npm i --prefix "' + hostDir + '" @deepseek-ai/dsh@0.2.2-rc.3',
    })
  }
  if (!existsSync(join(hostHome, 'profiles', 'web', 'package.json'))) {
    const add = spawnSync(process.execPath, [bin, 'plugin', '--profile', 'web', 'add', 'link:' + repoRootWin(repo)], {
      env: Object.assign({}, process.env, { DSH_HOME: hostHome.split('/').join('\\') }),
      encoding: 'utf8',
      timeout: 180000,
    })
    if (add.status !== 0) {
      return Object.assign({}, info, { error: 'profile setup failed: ' + String(add.stderr || add.stdout || '').slice(-800) })
    }
  }
  return Object.assign({}, info, { ready: true })
}

export function startHost(host) {
  return new Promise(resolvePromise => {
    const child = spawn(process.execPath, [host.bin, 'web', '--port', String(host.port), '--no-open'], {
      env: Object.assign({}, process.env, { DSH_HOME: host.hostHome.split('/').join('\\') }),
      cwd: host.hostHome,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let buffer = ''
    let settled = false
    const finish = value => { if (!settled) { settled = true; resolvePromise(value) } }
    const onData = chunk => {
      buffer += chunk.toString()
      const match = buffer.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)
      if (match) finish(Object.assign({}, host, { child, url: match[0] }))
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', error => finish(Object.assign({}, host, { error: String(error) })))
    child.on('exit', code => { if (!settled) finish(Object.assign({}, host, { error: 'host exited early (code ' + code + '): ' + buffer.slice(-800) })) })
    setTimeout(() => finish(Object.assign({}, host, { error: 'host did not print a URL in 90s: ' + buffer.slice(-800) })), 90000)
  })
}
