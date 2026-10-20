/**
 * Molecule viewer client plugin, browser half.
 *
 * Registers the keyed `tool.call.toolview` renderer for the `view_molecule`
 * tool: the host persists the UI payload (render-ready molecular data, initial
 * style, validation warnings) inside the `tool/result` event's
 * `presentationMeta` projection, so this renderer reads `block.meta` and builds
 * a MoleculeView (3Dmol.js interactive viewer). Because the payload rides a
 * first-class event type, the viewer re-renders after restarts on stock
 * harness installs — no custom session event, no harness patch.
 *
 * Failures are rendered as text on the card — the reason first, then the
 * actionable hint — because a silent blank canvas is the worst possible
 * outcome for a visualization tool.
 *
 * Export discipline: packages/client/AGENTS.md — only `apply`/`inject` plus
 * store-factory type-only exports.
 * @module dsh-molecule-visualization/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the `tool.call.toolview` SlotMap merge plus the props type.
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { createElement } from 'react'
import { MoleculeView } from './MoleculeView.tsx'
import { isMoleculeViewMeta } from './contract/types.ts'

export type { MoleculeViewMeta } from './contract/types.ts'

/** Required service: the slot registry owning the keyed toolview seat. */
export const inject = ['slots']

const S = {
  note: { padding: '10px 12px', color: '#8888aa', fontSize: '12px', width: '100%', boxSizing: 'border-box' as const },
  err: { padding: '10px 12px', color: '#e74c3c', fontSize: '12px', width: '100%', boxSizing: 'border-box' as const, lineHeight: 1.6 },
  errTitle: { fontWeight: 700 },
  errHint: { color: '#9fb0ff', marginTop: '4px' },
  errDetail: { color: '#8888aa', fontSize: '11px', marginTop: '4px' },
}

/** First text block of the settled result, for the degraded summary rows. */
function firstText(content: readonly unknown[]): string {
  for (const block of content) {
    if (block !== null && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
      return (block as { text: string }).text
    }
  }
  return ''
}

/**
 * Render one `view_molecule` call as an interactive 3Dmol.js viewer.
 *
 * This is the keyed renderer registered against `tool.call.toolview`. It
 * receives the call's frozen running-or-settled block; the settled block's
 * `meta` carries the host-projected molecule payload.
 */
function MoleculeToolRow({ block }: ToolCallViewProps) {
  // Running call: no result yet — a lightweight pending row until it lands.
  if (!('kind' in block)) {
    return createElement('div', { style: S.note }, '正在加载分子视图…')
  }

  const meta: unknown = block.meta

  if (isMoleculeViewMeta(meta)) {
    if (!meta.ok) {
      // The host rejected what it read. Say *why* here: a bare "failed" tells
      // the user nothing about, say, a fixed-column PDB.
      return createElement('div', { style: S.err },
        createElement('div', { style: S.errTitle },
          `无法显示这份 ${meta.format.toUpperCase()} 结构${meta.name !== undefined ? `（${meta.name}）` : ''}：${meta.error ?? '未知错误'}`),
        meta.errorHint !== undefined && meta.errorHint !== ''
          ? createElement('div', { style: S.errHint }, meta.errorHint)
          : null,
        ...(meta.warnings ?? []).map((warning, index) =>
          createElement('div', { key: `warning-${String(index)}`, style: S.errDetail }, `· ${warning}`)),
      )
    }
    if (meta.data !== undefined) {
      return createElement(MoleculeView, {
        data: meta.data,
        format: meta.format,
        ...(meta.renderFormat !== undefined ? { renderFormat: meta.renderFormat } : {}),
        ...(meta.name !== undefined ? { name: meta.name } : {}),
        atomCount: meta.atomCount,
        ...(meta.renderAtomCount !== undefined ? { renderAtomCount: meta.renderAtomCount } : {}),
        ...(meta.warnings !== undefined ? { warnings: meta.warnings } : {}),
        initialStyle: meta.style,
      })
    }
    const reason = meta.truncated === true
      ? `分子过大，无法内联进会话记录（${meta.format.toUpperCase()}，${meta.atomCount} atoms）——只显示摘要卡`
      : `分子内容不可用（${meta.format.toUpperCase()}，${meta.atomCount} atoms）——只显示摘要卡`
    return createElement('div', { style: S.note }, reason)
  }

  // Degraded arm: the payload is absent or from an incompatible plugin
  // version (e.g. a call made before this renderer existed). Never return
  // null — an empty row would silently swallow the call.
  const legacy = meta !== null && typeof meta === 'object' ? meta as Record<string, unknown> : undefined
  if (legacy !== undefined && typeof legacy['format'] === 'string' && typeof legacy['atomCount'] === 'number') {
    return createElement('div', { style: S.note },
      `${String(legacy['format']).toUpperCase()} · ${legacy['atomCount']} atoms — 旧调用缺少渲染载荷，无法显示 3D 视图`)
  }
  const text = firstText(block.content)
  return createElement('div', { style: S.note }, text !== '' ? text : '分子视图调用已完成。')
}

/**
 * Client plugin body: register the molecule renderer under the
 * `view_molecule` key of the keyed toolview slot.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'view_molecule',
  }, MoleculeToolRow))
}
