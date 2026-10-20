/**
 * Isolate where the GitHub connection dies: direct TLS vs through the local
 * proxy on port 7897 (Clash-style mixed port), and whether that proxy can carry
 * a CONNECT tunnel at all.
 *
 * Usage: node probe/tls-path-probe.mjs [proxyPort]
 */
import { connect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'

const proxyPort = Number(process.argv[2] ?? 7897)
const target = { host: 'github.com', port: 443 }

/** Report a TLS handshake outcome for one socket. */
function tlsOver(socket, label) {
  return new Promise((resolve) => {
    const tls = tlsConnect({ socket, servername: target.host, rejectUnauthorized: true }, () => {
      resolve(`${label}: TLS OK (${tls.getProtocol()} / ${String(tls.getCipher()?.name ?? '?')})`)
      tls.end()
    })
    tls.setTimeout(8000, () => { resolve(`${label}: TLS TIMEOUT`); tls.destroy() })
    tls.on('error', error => resolve(`${label}: TLS ERROR ${error.code ?? error.message}`))
  })
}

console.log('=== direct TLS to github.com:443 ===')
{
  const socket = connect(target)
  await new Promise((resolve) => {
    socket.once('connect', () => resolve())
    socket.once('error', (error) => { console.log(`direct: TCP ERROR ${error.code ?? error.message}`); resolve() })
    socket.setTimeout(8000, () => { console.log('direct: TCP TIMEOUT'); socket.destroy(); resolve() })
  })
  if (!socket.destroyed) console.log(await tlsOver(socket, 'direct'))
  socket.destroy()
}

console.log(`\n=== CONNECT through 127.0.0.1:${String(proxyPort)} ===`)
await new Promise((resolve) => {
  const socket = connect({ host: '127.0.0.1', port: proxyPort })
  let settled = false
  const finish = (message) => {
    if (settled) return
    settled = true
    console.log(message)
    resolve()
  }
  socket.once('error', error => finish(`proxy: TCP ERROR ${error.code ?? error.message}`))
  socket.setTimeout(8000, () => { finish('proxy: TIMEOUT'); socket.destroy() })
  socket.once('connect', () => {
    socket.write(`CONNECT ${target.host}:${String(target.port)} HTTP/1.1\r\nHost: ${target.host}:${String(target.port)}\r\n\r\n`)
  })
  let buffer = ''
  socket.on('data', function onData(chunk) {
    buffer += chunk.toString('latin1')
    if (!buffer.includes('\r\n\r\n')) return
    socket.off('data', onData)
    const statusLine = buffer.split('\r\n')[0] ?? ''
    console.log(`proxy: ${statusLine}`)
    if (!/^HTTP\/1\.[01] 200/.test(statusLine)) {
      finish('proxy: CONNECT refused — cannot tunnel')
      socket.destroy()
      return
    }
    // The socket now carries a raw tunnel; run TLS over it.
    tlsOver(socket, 'proxied').then((message) => { console.log(message); finish('done'); socket.destroy() })
  })
})
