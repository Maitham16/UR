// Permissive tip type — content is a function that takes a theme/context.
export interface TipContext {
  theme?: any
  [key: string]: any
}

export interface Tip {
  id?: string
  title?: string
  description?: string
  content: (context: TipContext) => Promise<any> | any
  [key: string]: any
}
