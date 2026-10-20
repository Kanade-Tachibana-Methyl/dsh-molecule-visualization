/**
 * Check what the running DSH web server serves for this plugin.
 *
 * Prints the plugin's bundle URL(s) from the boot HTML and whether the served
 * bytes are the fork's build (marker strings) — evidence that a rebuilt client
 * bundle reaches the browser graph without restarting the host.
 *
 * Usage: node probe/live-server-probe.mjs [origin]
 */
const origin = process.argv[2] ?? 'http://127.0.0.1:3080'
const packageId = 'dsh-molecule-visualization'

const html = await (await fetch(`${origin}/`)).text()
console.log(`boot html: ${String(html.length)} bytes`)

// The harness injects a `window.__DSH_BOOT__` payload listing every client
// module with its revisioned bundle URL.
const scriptMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1] ?? '')
const boot = scriptMatches.find(source => source.includes('__DSH_BOOT__')) ?? ''
console.log(`boot payload found: ${boot !== '' ? `yes (${String(boot.length)} chars)` : 'NO'}`)

const pluginUrls = [...new Set([...html.matchAll(/\/plugins\/[^\s"'<>\\)]+/g)].map(match => match[0]))]
const mine = pluginUrls.filter(url => url.includes('molecule'))
console.log(`plugin bundle urls for ${packageId}:`)
for (const url of mine.length > 0 ? mine : ['(none in html — searching boot payload)']) console.log(`  ${url}`)

if (mine.length === 0) {
  const index = boot.indexOf('molecule')
  console.log(index >= 0 ? boot.slice(Math.max(0, index - 200), index + 300) : 'no mention of the plugin in the boot payload')
  process.exitCode = 1
} else {
  const target = mine[0].startsWith('http') ? mine[0] : `${origin}${mine[0]}`
  const response = await fetch(target)
  const bundle = await response.text()
  console.log(`\nfetched ${target}`)
  console.log(`  status=${String(response.status)} bytes=${String(bundle.length)}`)
  const markers = {
    'ball-and-stick style (this build)': "ballstick",
    'layout timeout code (this build)': "layout-timeout",
    'empty-model diagnostic (this build)': "empty-model",
    '3Dmol parse diagnostics (this build)': "assignBonds",
    'upstream module-loader banner': "__ModuleLoader__",
  }
  let ok = true
  for (const [label, marker] of Object.entries(markers)) {
    const present = bundle.includes(marker)
    if (!present) ok = false
    console.log(`  ${present ? '✓' : '✗'} ${label}: ${present ? 'present' : 'MISSING'}`)
  }
  process.exitCode = ok ? 0 : 1
}
