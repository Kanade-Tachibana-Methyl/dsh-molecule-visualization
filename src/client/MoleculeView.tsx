/** Interactive 3D molecule viewer React component (inline styles, no CSS Modules).
 *
 * User-adjustable style (ball & stick / stick / line / sphere / cartoon),
 * background color, and molecule color mode (element / spectrum / custom).
 * Cartoon mode renders the protein as cartoon AND hetero atoms (ligands) as
 * sticks, so co-crystallized small molecules stay visible.
 *
 * Layout: the card lives inside the tool-call row, so it is kept compact — the
 * stage height is responsive (`clamp`) rather than a fixed 400px, and an
 * expand button lifts the same viewer into a full-window portal dialog. The
 * viewer is re-created when the container changes, because 3Dmol.js sizes its
 * WebGL canvas from the DOM node it was given.
 *
 * Every failure is *shown*: the card reports the specific reason (parse
 * failure, empty model, WebGL unavailable, container never laid out) with an
 * actionable hint and a retry button, instead of an empty canvas stuck on
 * "Loading 3D viewer…". */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { load3Dmol } from './threeDmol.ts'
import { STYLE_OPTIONS, applyStyle, type ColorMode } from './style.ts'
import { LayoutCancelledError, LayoutTimeoutError, awaitLayoutBox } from './layout.ts'
import { MoleculeRenderError, mountMolecule, type ViewerLike } from './render.ts'
import type { MoleculeFormat, MoleculeStyle, RenderFormat } from './contract/types.ts'

export interface MoleculeViewProps {
  readonly data: string
  readonly format: MoleculeFormat
  /** Parser name projected by the host (`mol` → `sdf`); derived when absent. */
  readonly renderFormat?: RenderFormat
  readonly name?: string
  readonly atomCount?: number
  /** Atoms the host expects 3Dmol.js to load (defaults to `atomCount`). */
  readonly renderAtomCount?: number
  /** Host-side validation notices, shown above the canvas. */
  readonly warnings?: readonly string[]
  readonly initialStyle: MoleculeStyle
}

/** A rendering failure as rendered by the card. */
interface Failure {
  readonly code: string
  readonly message: string
  readonly hint: string
  readonly detail?: string
}

const FAILURE_TITLES: Readonly<Record<string, string>> = {
  'layout-timeout': '容器不可见，渲染超时',
  'viewer-init': 'WebGL 不可用',
  parse: '解析失败',
  'empty-model': '3Dmol.js 没有读出原子',
  unknown: '渲染失败',
}

const BG_PRESETS: readonly string[] = ['#ffffff', '#f0f0f5', '#808080', '#1a1a2e', '#000000']
const DEFAULT_BG = '#1a1a2e'

const S = {
  viewer: { display: 'flex', flexDirection: 'column' as const, width: '100%', border: '1px solid #383856', borderRadius: '8px', overflow: 'hidden', background: '#16213e' },
  viewerExpanded: { height: '100%', minHeight: 0, borderRadius: '12px', boxShadow: '0 18px 60px rgba(0, 0, 0, 0.55)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#16213e', borderBottom: '1px solid #383856', gap: '8px' },
  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: '4px 10px', padding: '5px 10px', background: '#131a30', borderBottom: '1px solid #383856' },
  titleRow: { display: 'flex', alignItems: 'center', minWidth: 0 },
  title: { fontSize: '13px', fontWeight: 600, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  meta: { fontSize: '11px', color: '#8888aa', marginLeft: '8px', flexShrink: 0 },
  controls: { display: 'flex', gap: '4px', flexShrink: 0, flexWrap: 'wrap' as const, alignItems: 'center' },
  btn: { padding: '3px 8px', fontSize: '11px', border: '1px solid #444466', borderRadius: '4px', background: 'transparent', color: '#8888aa', cursor: 'pointer' },
  btnActive: { background: '#4D6BFE', color: '#ffffff', borderColor: '#4D6BFE' },
  expandBtn: { padding: '3px 8px', fontSize: '11px', border: '1px solid #6f7fbf', borderRadius: '4px', background: 'transparent', color: '#c7d2ff', cursor: 'pointer', marginLeft: '4px' },
  group: { display: 'flex', alignItems: 'center', gap: '5px' },
  groupLabel: { fontSize: '11px', color: '#8888aa', userSelect: 'none' as const },
  swatch: { width: '18px', height: '18px', borderRadius: '4px', border: '2px solid transparent', cursor: 'pointer', padding: 0 },
  swatchActive: { borderColor: '#4D6BFE' },
  colorInput: { width: '22px', height: '20px', padding: 0, border: '1px solid #444466', borderRadius: '4px', background: 'transparent', cursor: 'pointer' },
  // Responsive instead of a fixed 400px: the card sits in the chat flow, and a
  // fixed box taller than the visible pane was the main reason the molecule
  // could not be seen without scrolling.
  stage: { position: 'relative' as const, width: '100%', height: 'clamp(240px, 34vh, 420px)' },
  stageExpanded: { position: 'relative' as const, width: '100%', flex: '1 1 auto', minHeight: '220px' },
  canvas: { width: '100%', height: '100%' },
  overlay: {
    position: 'absolute' as const, inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '20px', textAlign: 'center' as const, fontSize: '12px', lineHeight: 1.6,
  },
  overlayBusy: { color: '#8888aa' },
  overlayError: { background: 'rgba(19, 26, 48, 0.96)', color: '#e0e0e0', flexDirection: 'column' as const, gap: '8px', overflowY: 'auto' as const, textAlign: 'left' as const, alignItems: 'flex-start', justifyContent: 'flex-start' },
  errTitle: { color: '#e74c3c', fontWeight: 700, fontSize: '13px' },
  errMsg: { color: '#f0f0f0', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const },
  errHint: { color: '#9fb0ff' },
  errDetail: { color: '#8888aa', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: '11px', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const },
  retry: { padding: '4px 12px', fontSize: '12px', border: '1px solid #4D6BFE', borderRadius: '4px', background: '#4D6BFE', color: '#ffffff', cursor: 'pointer' },
  notices: { padding: '5px 10px', background: '#2a2620', borderTop: '1px solid #383856', color: '#e0c07a', fontSize: '11px', lineHeight: 1.45 },
  noticeItem: { display: 'block' as const },
  // Full-window layer, portalled to document.body so no chat container can
  // clip it or impose its own scroll.
  backdrop: {
    position: 'fixed' as const, inset: 0, zIndex: 2147483000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '3.5vh 3vw', background: 'rgba(4, 7, 16, 0.72)', overscrollBehavior: 'contain' as const,
  },
  dialog: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column' as const, minHeight: 0 },
  // Placeholder left in the conversation while the viewer is expanded, so the
  // chat does not look like the call disappeared and has a way back.
  inlineBar: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 10px', border: '1px dashed #383856', borderRadius: '8px', background: '#131a30', color: '#c7d2ff', fontSize: '12px', boxSizing: 'border-box' as const },
  inlineBarTitle: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  inlineBarMeta: { color: '#8888aa', fontSize: '11px', flexShrink: 0 },
  inlineBarSpacer: { flex: '1 1 auto' },
}

function btnStyle(active: boolean, disabled?: boolean): CSSProperties {
  return { ...S.btn, ...(active ? S.btnActive : {}), ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }
}

/** Map a thrown value onto the card's failure shape. */
function describeFailure(error: unknown): Failure {
  if (error instanceof LayoutTimeoutError) {
    return { code: error.code, message: error.message, hint: error.hint }
  }
  if (error instanceof MoleculeRenderError) {
    return {
      code: error.code,
      message: error.message,
      hint: error.hint,
      ...(error.detail !== undefined ? { detail: error.detail } : {}),
    }
  }
  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
    hint: '这条错误没有被专门处理。把上面的信息发给我，我会补上对应分支。',
  }
}

export function MoleculeView(props: MoleculeViewProps): ReactElement {
  const { data, format, renderFormat, name, atomCount, renderAtomCount, warnings, initialStyle } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<ViewerLike | null>(null)
  /** Whether the loaded model has bonds; a bond-drawn style needs them. */
  const hasBondsRef = useRef(true)
  const [style, setStyle] = useState<MoleculeStyle>(initialStyle)
  const [colorMode, setColorMode] = useState<ColorMode>({ kind: 'element' })
  const [bg, setBg] = useState<string>(DEFAULT_BG)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [failure, setFailure] = useState<Failure | undefined>(undefined)
  const [notices, setNotices] = useState<readonly string[]>([])
  const [attempt, setAttempt] = useState(0)
  /** Whether the viewer is lifted into the full-window dialog. */
  const [expanded, setExpanded] = useState(false)

  const destroyViewer = useCallback((): void => {
    const existing = viewerRef.current
    if (existing !== null) {
      try { existing.clear() } catch { /* the canvas is being replaced anyway */ }
    }
    viewerRef.current = null
  }, [])

  // Create the viewer and load the molecule on mount, data change, retry, or
  // when the container moves between the inline card and the dialog.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    setStatus('loading')
    setFailure(undefined)
    setNotices((warnings ?? []).slice())
    let cancelled = false
    let resizeObserver: ResizeObserver | undefined
    void (async (): Promise<void> => {
      try {
        const threeDmol = await load3Dmol()
        if (cancelled) return
        // A zero-size container yields an incomplete WebGL framebuffer and a
        // permanently blank canvas; the wait is bounded so a folded ancestor
        // cannot leave the card loading forever.
        await awaitLayoutBox(container, () => cancelled)
        if (cancelled) return
        destroyViewer()
        const mounted = mountMolecule({
          threeDmol,
          container,
          data,
          format,
          ...(renderFormat !== undefined ? { renderFormat } : {}),
          style,
          colorMode,
          backgroundColor: bg,
          expectedAtoms: renderAtomCount ?? atomCount,
        })
        viewerRef.current = mounted.viewer
        hasBondsRef.current = mounted.bondCount > 0
        setNotices([...(warnings ?? []), ...mounted.notices])
        if (cancelled) return
        setStatus('ready')
        // Keep the canvas matched to the container box (chat pane resizes do
        // not always fire window resize, which is all 3Dmol hooks itself).
        resizeObserver = new ResizeObserver(() => {
          if (container.clientWidth === 0 || container.clientHeight === 0) return
          try { mounted.viewer.resize(); mounted.viewer.render() } catch { /* transient */ }
        })
        resizeObserver.observe(container)
      } catch (error) {
        if (cancelled || error instanceof LayoutCancelledError) return
        setStatus('error')
        setFailure(describeFailure(error))
      }
    })()
    return (): void => {
      cancelled = true
      resizeObserver?.disconnect()
      // The container is about to be detached (retry, or the dialog opening or
      // closing): release the WebGL context instead of leaking one per mount.
      destroyViewer()
    }
    // `style`/`colorMode`/`bg` are applied by their own effects; including them
    // here would re-create the viewer on every toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, format, renderFormat, attempt, expanded])

  // Re-apply style + color mode without re-parsing. Guarded: a failing spec
  // must degrade to a no-op, never crash the component tree.
  useEffect(() => {
    const viewer = viewerRef.current
    if (viewer === null || status !== 'ready') return
    try {
      applyStyle(viewer, style, colorMode, { bondsAvailable: hasBondsRef.current })
      viewer.render()
    } catch { /* keep the last good style */ }
  }, [style, colorMode, status])

  // Re-apply background color.
  useEffect(() => {
    const viewer = viewerRef.current
    if (viewer === null || status !== 'ready') return
    try { viewer.setBackgroundColor(bg); viewer.render() } catch { /* keep the last good bg */ }
  }, [bg, status])

  // Escape closes the dialog.
  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExpanded(false)
    }
    globalThis.addEventListener('keydown', onKeyDown)
    return (): void => { globalThis.removeEventListener('keydown', onKeyDown) }
  }, [expanded])

  // Teardown on unmount.
  useEffect(() => () => { destroyViewer() }, [destroyViewer])

  const retry = (): void => { setAttempt(current => current + 1) }
  const toggleExpanded = (): void => { setExpanded(current => !current) }

  const title = name ?? `Molecule (${format.toUpperCase()})`
  const shownStyle = STYLE_OPTIONS.find(option => option.value === style)
  const meta = [
    format.toUpperCase(),
    atomCount !== undefined ? `${atomCount} atoms` : undefined,
    shownStyle !== undefined ? shownStyle.label.toLowerCase() : undefined,
  ].filter((part): part is string => part !== undefined).join(' · ')
  const busy = status !== 'ready'

  const card = (
    <div style={expanded ? { ...S.viewer, ...S.viewerExpanded } : S.viewer}>
      <div style={S.header}>
        <div style={S.titleRow}><span style={S.title}>{title}</span><span style={S.meta}>{meta}</span></div>
        <div style={S.controls}>
          {STYLE_OPTIONS.map((option) => (
            <button key={option.value} type="button" title={option.title} style={btnStyle(style === option.value, busy)}
              onClick={(): void => setStyle(option.value)} disabled={busy}>{option.label}</button>
          ))}
          <button type="button" style={S.expandBtn} onClick={toggleExpanded}
            aria-label={expanded ? '收起放大视图' : '放大查看'}
            title={expanded ? '收起（Esc）' : '把 3D 视图放大到整个窗口'}>
            {expanded ? '⤡ 收起' : '⤢ 放大'}
          </button>
        </div>
      </div>
      <div style={S.toolbar}>
        <div style={S.group}>
          <span style={S.groupLabel}>背景</span>
          {BG_PRESETS.map((color) => (
            <button key={color} type="button" aria-label={`背景 ${color}`}
              style={{ ...S.swatch, background: color, ...(bg.toLowerCase() === color ? S.swatchActive : {}) }}
              onClick={(): void => setBg(color)} disabled={busy} />
          ))}
          <input type="color" value={bg} aria-label="自定义背景色" style={S.colorInput}
            onChange={(event): void => setBg(event.target.value)} disabled={busy} />
        </div>
        <div style={S.group}>
          <span style={S.groupLabel}>分子颜色</span>
          <button type="button" style={btnStyle(colorMode.kind === 'element', busy)}
            onClick={(): void => setColorMode({ kind: 'element' })} disabled={busy}>元素</button>
          <button type="button" style={btnStyle(colorMode.kind === 'spectrum', busy)}
            onClick={(): void => setColorMode({ kind: 'spectrum' })} disabled={busy}>彩虹</button>
          <button type="button" style={btnStyle(colorMode.kind === 'custom', busy)}
            onClick={(): void => setColorMode({ kind: 'custom', color: '#4D6BFE' })} disabled={busy}>自选</button>
          {colorMode.kind === 'custom' && (
            <input type="color" value={colorMode.color} aria-label="自定义分子颜色" style={S.colorInput}
              onChange={(event): void => setColorMode({ kind: 'custom', color: event.target.value })} disabled={busy} />
          )}
        </div>
      </div>
      <div style={expanded ? S.stageExpanded : S.stage}>
        {/* The container stays mounted across failures so Retry has a target. */}
        <div style={{ ...S.canvas, background: bg }} ref={containerRef} />
        {status === 'loading' && (
          <div style={{ ...S.overlay, ...S.overlayBusy }}>正在加载 3D 视图…</div>
        )}
        {status === 'error' && failure !== undefined && (
          <div style={{ ...S.overlay, ...S.overlayError }}>
            <div style={S.errTitle}>{FAILURE_TITLES[failure.code] ?? FAILURE_TITLES['unknown']}</div>
            <div style={S.errMsg}>{failure.message}</div>
            {failure.hint !== '' && <div style={S.errHint}>{failure.hint}</div>}
            {failure.detail !== undefined && failure.detail !== '' && (
              <div style={S.errDetail}>detail: {failure.detail}</div>
            )}
            <button type="button" style={S.retry} onClick={retry}>重试</button>
          </div>
        )}
      </div>
      {notices.length > 0 && (
        <div style={S.notices}>
          {notices.map((notice, index) => (
            <span key={`${String(index)}-${notice.slice(0, 16)}`} style={S.noticeItem}>⚠ {notice}</span>
          ))}
        </div>
      )}
    </div>
  )

  if (!expanded) return card

  return (
    <>
      <div style={S.inlineBar}>
        <span style={S.inlineBarTitle}>{title}</span>
        <span style={S.inlineBarMeta}>{meta}</span>
        <span style={S.inlineBarSpacer} />
        <button type="button" style={S.expandBtn} onClick={toggleExpanded}>收起放大视图</button>
      </div>
      {createPortal(
        <div
          style={S.backdrop}
          role="presentation"
          onClick={(event): void => { if (event.target === event.currentTarget) setExpanded(false) }}
        >
          <div style={S.dialog} role="dialog" aria-modal="true" aria-label={`${title} — 放大查看`}>
            {card}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
