/**
 * Ambient declaration for the one DSH client module this plugin imports but
 * whose typings the installed harness distribution does not ship.
 *
 * `@deepseek-ai/dsh-client-runtime` is not resolvable from the profile tree
 * (the package is only present as a dangling link), and the client half is
 * bundled by esbuild without type checking — which is exactly how upstream
 * built this plugin. Everything the plugin actually touches is declared here,
 * so a wrong import or a wrong call still fails the build; only the harness's
 * own internal type surface is approximated.
 *
 * `@deepseek-ai/dsh-client-ui-tool/client` is NOT declared here: that package
 * ships real `.d.ts` files and is used as-is.
 * @module dsh-client-shims
 */

declare module '@deepseek-ai/dsh-client-runtime/client' {
  /** The slot registry service surface this plugin uses. */
  export interface ClientSlotsService {
    /** Register a keyed renderer into a slot, once its owner is loaded. */
    inject(owner: string, contribute: () => unknown): void
    /** Contribute one keyed entry; returns the disposer. */
    register(spec: { readonly name: string; readonly key: string }, component: (props: never) => unknown): () => void
  }

  /** The client-half plugin context. */
  export interface ClientContext {
    readonly slots: ClientSlotsService
  }
}
