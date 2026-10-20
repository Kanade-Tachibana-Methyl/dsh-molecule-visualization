/**
 * Build both halves of the plugin.
 *
 * Exists because the packed esbuild CLI and `tsc` must be launched with
 * *inherited* stdio: this project is also built inside Windows sandboxes where
 * creating the pipes a naive `spawn(…, { stdio: 'pipe' })` needs is denied
 * (`EPERM`). Using the native esbuild binary directly also skips the wrapper
 * process esbuild's JS API would start.
 *
 * Usage: node scripts/build.mjs [--host] [--client]
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const buildHost = args.size === 0 || args.has('--host')
const buildClient = args.size === 0 || args.has('--client')

/** Map Node's platform/arch onto esbuild's optional-package naming. */
const esbuildBinary = (() => {
  const platform = process.platform === 'win32' ? 'win32' : process.platform
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch
  const executable = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild'
  const candidates = [
    join(root, 'node_modules', '@esbuild', `${platform}-${arch}`, executable),
    join(root, 'node_modules', 'esbuild', 'bin', executable),
  ]
  const found = candidates.find(candidate => existsSync(candidate))
  if (found === undefined) {
    console.error(`esbuild binary not found; run "npm install" first. Looked in:\n  ${candidates.join('\n  ')}`)
    process.exit(1)
  }
  return found
})()

/** Run one build step with inherited stdio; abort the build on failure. */
function run(label, command, commandArgs) {
  process.stdout.write(`\n▶ ${label}\n`)
  const outcome = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' })
  if (outcome.error !== undefined) {
    console.error(`✖ ${label}: ${outcome.error.message}`)
    process.exit(1)
  }
  if (outcome.status !== 0) {
    console.error(`✖ ${label} failed with exit code ${String(outcome.status)}`)
    process.exit(outcome.status ?? 1)
  }
}

const clientArgs = [
  'src/client/index.ts',
  '--bundle',
  '--format=cjs',
  '--target=es2022',
  '--jsx=automatic',
  '--outfile=lib/client.js',
  '--sourcemap',
  '--log-level=warning',
  // Provided by the host's client module table at runtime, never bundled.
  '--external:react',
  '--external:react/jsx-runtime',
  '--external:react-dom',
  '--external:react-dom/client',
  '--external:@deepseek-ai/cordis',
  '--external:@deepseek-ai/dsh-client-ui-slots',
  '--external:@deepseek-ai/dsh-client-web-react',
  '--external:@deepseek-ai/dsh-client-ui-primitives',
  '--external:@deepseek-ai/dsh-client-ui-attachment',
  '--external:@deepseek-ai/dsh-client-schema-form',
  '--external:@deepseek-ai/dsh-client-runtime/client',
  '--loader:.css=text',
  // The harness's lazy-CJS module table calls this factory with its own
  // `require`; the banner/footer shape is part of the loader contract.
  '--banner:js=window.__ModuleLoader__.load({ id: \'dsh-molecule-visualization\', factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  '--footer:js=return module.exports; } });',
]

if (buildHost) {
  run('host (tsc)', process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'])
}
if (buildClient) {
  run('client (esbuild)', esbuildBinary, clientArgs)
}

process.stdout.write('\n✓ build complete\n')
