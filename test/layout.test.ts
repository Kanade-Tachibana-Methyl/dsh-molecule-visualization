/**
 * Layout-gating tests — issue 5.
 *
 * A container that never acquires a layout box (a collapsed chat section, a
 * hidden tab) used to leave the card on "Loading 3D viewer…" forever, because
 * nothing raced the `clientWidth > 0 && clientHeight > 0` wait. The wait is now
 * bounded and reports why.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_LAYOUT_TIMEOUT_MS,
  LayoutCancelledError,
  LayoutTimeoutError,
  awaitLayoutBox,
  describeHiddenContainer,
} from '../src/client/layout.ts'

/** A fake clock that records timers and lets the test fire them. */
function fakeClock() {
  let nextHandle = 1
  const pending = new Map<number, () => void>()
  const cleared: number[] = []
  return {
    clock: {
      setTimeout: (callback: () => void): number => {
        const handle = nextHandle++
        pending.set(handle, callback)
        return handle
      },
      clearTimeout: (handle: number): void => {
        cleared.push(handle)
        pending.delete(handle)
      },
    },
    /** Fire every outstanding timer. */
    tick(): void {
      for (const [handle, callback] of [...pending]) {
        pending.delete(handle)
        callback()
      }
    },
    get pendingCount(): number { return pending.size },
    get cleared(): number[] { return cleared },
  }
}

/** A fake element whose box can be resized by the test. */
function fakeElement(width: number, height: number) {
  return {
    clientWidth: width,
    clientHeight: height,
    offsetParent: {} as unknown,
    getClientRects: (): unknown[] => [{}],
  } as unknown as HTMLElement & { clientWidth: number, clientHeight: number }
}

// The poll loop uses rAF; keep it inert so tests drive the clock explicitly.
globalThis.requestAnimationFrame = (() => 0) as unknown as typeof globalThis.requestAnimationFrame
globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame

/** Installed ResizeObserver stubs, so a test can fire the layout transition. */
const resizeObservers: { fire: () => void, disconnected: boolean }[] = []
globalThis.ResizeObserver = class {
  private readonly callback: () => void
  private connected = false

  constructor(callback: () => void) {
    this.callback = callback
    resizeObservers.push({ fire: () => { if (this.connected) this.callback() }, get disconnected(): boolean { return !this.connected } })
  }

  observe(): void { this.connected = true }
  unobserve(): void { this.connected = false }
  disconnect(): void { this.connected = false }
} as unknown as typeof ResizeObserver

describe('awaitLayoutBox', () => {
  it('resolves immediately when the container already has a box', async () => {
    const element = fakeElement(400, 400)
    await awaitLayoutBox(element, () => false, { clock: fakeClock().clock })
  })

  it('rejects with a timeout that names the cause after the budget', async () => {
    const element = fakeElement(0, 0)
    const fake = fakeClock()
    const promise = awaitLayoutBox(element, () => false, { timeoutMs: 2500, clock: fake.clock })
    fake.tick()
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof LayoutTimeoutError)
      assert.equal(error.code, 'layout-timeout')
      assert.equal(error.timeoutMs, 2500)
      assert.match(error.message, /2\.5|3 秒|2 秒/)
      assert.match(error.message, /容器/)
      assert.ok(error.hint.includes('重试'))
      return true
    })
  })

  it('uses a ten second default budget', () => {
    assert.equal(DEFAULT_LAYOUT_TIMEOUT_MS, 10_000)
  })

  it('rejects with a cancelled error when the component unmounts', async () => {
    const element = fakeElement(0, 0)
    const fake = fakeClock()
    const promise = awaitLayoutBox(element, () => true, { clock: fake.clock })
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof LayoutCancelledError)
      assert.equal(error.code, 'layout-cancelled')
      return true
    })
  })

  it('resolves when the box appears before the timeout, and clears the timer', async () => {
    const element = fakeElement(0, 0)
    const fake = fakeClock()
    const promise = awaitLayoutBox(element, () => false, { timeoutMs: 10_000, clock: fake.clock })
    element.clientWidth = 320
    element.clientHeight = 400
    // A resize observer reports the 0 → non-zero transition.
    for (const observer of resizeObservers) observer.fire()
    await promise
    // The timeout timer must be released on success so a long-lived card does
    // not keep an armed timer that would fire into a settled promise.
    assert.equal(fake.pendingCount, 0)
    assert.ok(fake.cleared.length >= 1)
  })
})

describe('describeHiddenContainer', () => {
  it('names a display:none ancestor', () => {
    const element = { clientWidth: 0, clientHeight: 0, offsetParent: null, getClientRects: () => [] } as unknown as HTMLElement
    assert.match(describeHiddenContainer(element), /display:none/)
  })

  it('names a zero-size box', () => {
    const element = { clientWidth: 0, clientHeight: 0, offsetParent: {}, getClientRects: () => [{}] } as unknown as HTMLElement
    assert.match(describeHiddenContainer(element), /0×0/)
  })
})
