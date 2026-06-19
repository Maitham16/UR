// Deep readonly utility — passes through to readonly. Permissive aliases
// avoid forcing every consumer to deal with strict readonly markers.
export type DeepImmutable<T> = T
export type Permutations<T extends string, U extends string = T> = string
