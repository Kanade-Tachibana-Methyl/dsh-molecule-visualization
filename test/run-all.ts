/**
 * Single-process test entry point.
 *
 * `node --test test` spawns one child process per test file, which is denied
 * inside strict sandboxes (`EPERM` on pipe creation). Importing the suites into
 * one process keeps `npm test` working everywhere; individual files still run
 * stand-alone via `node test/parser.test.ts`.
 */
import './parser.test.ts'
import './format.test.ts'
import './style.test.ts'
import './render.test.ts'
import './layout.test.ts'
import './meta.test.ts'
// Renders the built bundle in jsdom; skipped when lib/client.js is absent.
import './dom.test.ts'
