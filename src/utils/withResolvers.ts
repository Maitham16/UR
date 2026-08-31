/** Native ES2024 deferred-promise helper (Node 22+ and Bun 1.3+). */
export function withResolvers<T>(): PromiseWithResolvers<T> {
  return Promise.withResolvers<T>()
}
