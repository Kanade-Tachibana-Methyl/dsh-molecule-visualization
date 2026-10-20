/**
 * Layout gating for the 3Dmol.js canvas.
 *
 * Creating a viewer on a zero-size element sizes its WebGL canvas to zero,
 * making the framebuffer incomplete (`GL_INVALID_FRAMEBUFFER_OPERATION:
 * glClear: Attachment has zero size` on every frame) — the canvas stays blank
 * forever. The chat list mounts nodes before layout, and replayed sessions may
 * sit inside collapsed or hidden ancestors, so viewer creation must wait for a
 * real layout box.
 *
 * The wait is bounded: a container that never gets a box (a folded section, a
 * hidden tab) used to leave the card stuck on "Loading 3D viewer…" with no way
 * out. It now rejects with a {@link LayoutTimeoutError} that names the cause
 * and offers a retry.
 * @module layout
 */

/** Injected timer interface, so the wait is testable without real delays. */
export interface LayoutClock {
  setTimeout(callback: () => void, milliseconds: number): number
  clearTimeout(handle: number): void
}

/** Default budget for the container to acquire a layout box. */
export const DEFAULT_LAYOUT_TIMEOUT_MS = 10_000

/** Rejection raised when the container never acquires a layout box. */
export class LayoutTimeoutError extends Error {
  /** Discrimination tag for the renderer's error card. */
  readonly code = 'layout-timeout'
  /** Actionable next step, shown under the message. */
  readonly hint: string
  /** How long the wait lasted, in milliseconds. */
  readonly timeoutMs: number

  constructor(message: string, hint: string, timeoutMs: number) {
    super(message)
    this.name = 'LayoutTimeoutError'
    this.hint = hint
    this.timeoutMs = timeoutMs
  }
}

/** Rejection raised when the component unmounts while waiting. */
export class LayoutCancelledError extends Error {
  /** Discrimination tag; the renderer ignores it (the card is gone). */
  readonly code = 'layout-cancelled'

  constructor() {
    super('molecule viewer unmounted before its container was laid out')
    this.name = 'LayoutCancelledError'
  }
}

const defaultClock: LayoutClock = {
  setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds) as unknown as number,
  clearTimeout: (handle) => { globalThis.clearTimeout(handle) },
}

/** Describe *why* the element has no box, for the timeout message. */
export function describeHiddenContainer(el: HTMLElement): string {
  const width = el.clientWidth
  const height = el.clientHeight
  if (typeof el.offsetParent !== 'undefined' && el.offsetParent === null) {
    return 'ancestor 节点 display:none（offsetParent 为 null）'
  }
  if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) {
    return `容器没有布局盒（${width}×${height}）——可能被折叠或位于隐藏的分页/分段中`
  }
  return `容器尺寸为 ${width}×${height}，无法分配 WebGL 画布`
}

/**
 * Resolve once `el` has a non-zero layout box; reject on timeout or cancel.
 *
 * A synchronous check runs first (layout is usually done by effect time), then
 * a ResizeObserver covers the 0 → non-zero transition, and a rAF poll acts as
 * belt and braces. Whichever fires first wins; the timer guarantees an exit.
 * @param el - the container the viewer will be created in.
 * @param isCancelled - reports whether the component unmounted meanwhile.
 * @param options - timeout budget and injectable clock.
 * @returns a promise settled exactly once.
 */
export function awaitLayoutBox(
  el: HTMLElement,
  isCancelled: () => boolean,
  options: { readonly timeoutMs?: number; readonly clock?: LayoutClock } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LAYOUT_TIMEOUT_MS
  const clock = options.clock ?? defaultClock

  return new Promise<void>((resolve, reject) => {
    let observer: ResizeObserver | undefined
    let raf = 0
    let timer: number | undefined
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (raf !== 0) globalThis.cancelAnimationFrame(raf)
      observer?.disconnect()
      if (timer !== undefined) clock.clearTimeout(timer)
      if (error === undefined) resolve()
      else reject(error)
    }

    const check = (): boolean => {
      if (isCancelled()) {
        finish(new LayoutCancelledError())
        return true
      }
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        finish()
        return true
      }
      return false
    }

    if (check()) return

    timer = clock.setTimeout(() => {
      finish(new LayoutTimeoutError(
        `viewer 容器在 ${Math.round(timeoutMs / 1000)} 秒内始终没有可用尺寸：${describeHiddenContainer(el)}`,
        '展开被折叠的分段（或让容器所在面板可见）后点“重试”。隐藏的容器无法创建 WebGL 画布，3Dmol.js 会渲染出空白。',
        timeoutMs,
      ))
    }, timeoutMs)

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => { check() })
      observer.observe(el)
    }
    const tick = (): void => {
      if (settled) return
      if (!check()) raf = globalThis.requestAnimationFrame(tick)
    }
    raf = globalThis.requestAnimationFrame(tick)
  })
}
