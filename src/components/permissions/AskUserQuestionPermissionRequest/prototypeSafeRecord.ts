const hasOwn = Object.prototype.hasOwnProperty

/**
 * Question text is model-controlled and is used as a lookup key throughout
 * the dialog. Null-prototype records prevent names such as `toString`,
 * `constructor`, and `__proto__` from reading or mutating Object.prototype.
 */
export function createPrototypeSafeRecord<Value>(): Record<string, Value> {
  return Object.create(null) as Record<string, Value>
}

export function clonePrototypeSafeRecord<RecordType extends object>(
  source: RecordType,
): RecordType {
  return Object.assign(Object.create(null), source) as RecordType
}

export function hasOwnRecordKey(
  record: object | null | undefined,
  key: PropertyKey,
): boolean {
  return record !== null && record !== undefined && hasOwn.call(record, key)
}

export function getOwnRecordValue<Value>(
  record: Readonly<Record<string, Value>> | null | undefined,
  key: string,
): Value | undefined {
  return hasOwnRecordKey(record, key) ? record![key] : undefined
}

export function setPrototypeSafeRecordValue<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
  value: Value,
): Record<string, Value> {
  const next = Object.assign(createPrototypeSafeRecord<Value>(), record)
  next[key] = value
  return next
}
