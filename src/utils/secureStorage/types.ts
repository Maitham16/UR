// Reconstructed permissive secure-storage types matching observed usage.

export interface SecureStorage {
  name: string
  read(): SecureStorageData | null | undefined
  readAsync(): Promise<SecureStorageData | null | undefined>
  update(value: SecureStorageData | null | undefined): {
    success: boolean
    warning?: string
  }
  remove?(): void
  [key: string]: any
}

export interface SecureStorageData {
  urAiOauth?: {
    accessToken?: string
    refreshToken?: string
    expiresAt?: number
    scopes?: string[]
    subscriptionType?: any
    rateLimitTier?: any
    [key: string]: any
  }
  [key: string]: any
}
