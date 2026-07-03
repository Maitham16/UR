import 'diff'
import 'react'

declare module 'diff' {
  export type StructuredPatchHunk = Hunk

  interface PatchOptions {
    // Supported by the runtime jsdiff version, but absent from the bundled
    // DefinitelyTyped declaration used by this repository.
    timeout?: number | undefined
  }
}

declare module 'react' {
  export function use<T>(usable: PromiseLike<T>): T
  export function use<T>(usable: T): T
}
