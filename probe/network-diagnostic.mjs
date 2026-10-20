/**
 * Connectivity diagnostics for pushing to GitHub from this machine.
 *
 * Measures DNS, raw TCP connectivity and proxy configuration for the hosts a
 * push needs, so the auth/transport choice is based on data instead of guesses.
 *
 * Usage: node probe/network-diagnostic.mjs
 */
import { connect } from 'node:net'
import { lookup } from 'node:dns/promises'
import { execSync } from 'node:child_process'

const hosts = [
  'github.com',
  'api.github.com',
  'ssh.github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
]
const ports = [443, 22]

/** Resolve a host, reporting all addresses. */
async function resolveAll(host) {
  try {
    const results = await lookup(host, { all: true })
    return results.map(entry => entry.address).join(', ')
  } catch (error) {
    return `RESOLVE FAILED: ${error.code ?? error.message}`
  }
}

/** Attempt one TCP connection; resolve with outcome + latency. */
function tcpProbe(host, port, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = connect({ host, port })
    const done = (outcome) => {
      socket.destroy()
      resolve(`${outcome} (${String(Date.now() - started)} ms)`)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done('OPEN'))
    socket.once('timeout', () => done(`TIMEOUT >${String(timeoutMs)}ms`))
    socket.once('error', error => done(`ERROR ${error.code ?? error.message}`))
  })
}

console.log('host'.padEnd(34), 'DNS'.padEnd(40), 'verdict')
console.log('-'.repeat(110))
for (const host of hosts) {
  const dns = await resolveAll(host)
  const outcomes = []
  for (const port of ports) outcomes.push(`${String(port)}:${await tcpProbe(host, port)}`)
  console.log(host.padEnd(34), dns.padEnd(40), outcomes.join('  '))
}

console.log('\n=== proxy configuration ===')
const envProxy = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy']
for (const name of envProxy) {
  if (process.env[name] !== undefined) console.log(`${name}=${process.env[name]}`)
}
try {
  const winhttp = execSync('netsh winhttp show proxy', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  console.log(winhttp.replace(/\r/g, '').split('\n').filter(line => line.trim() !== '').slice(1, 4).join('\n'))
} catch { console.log('netsh winhttp: unavailable') }

console.log('\n=== local proxy ports often used by VPN clients ===')
const candidates = [1080, 1081, 7890, 7891, 7897, 8080, 8118, 8888, 10808, 10809, 20171, 20172]
for (const port of candidates) {
  const outcome = await tcpProbe('127.0.0.1', port, 500)
  if (outcome.startsWith('OPEN')) console.log(`  127.0.0.1:${String(port)} OPEN`)
}

console.log('\n=== git http settings ===')
for (const key of ['http.proxy', 'https.proxy', 'http.sslBackend', 'url.https://.insteadof']) {
  try {
    const value = execSync(`git config --get ${key}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    console.log(`${key}=${value}`)
  } catch { /* unset */ }
}
