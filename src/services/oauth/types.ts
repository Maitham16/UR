// Reconstructed permissive OAuth types matching observed usage.

export interface OAuthTokens {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  scopes?: string[]
  subscriptionType?: SubscriptionType | string
  rateLimitTier?: RateLimitTier | string
  [key: string]: any
}

export interface OAuthTokenExchangeResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  scopes?: string[]
  token_type?: string
  [key: string]: any
}

export interface OAuthProfileResponse {
  account?: {
    uuid?: string
    email_address?: string
    email?: string
    full_name?: string
    display_name?: string
    created_at?: string
    [key: string]: any
  }
  organization?: {
    uuid?: string
    name?: string
    organization_type?: string
    billing_type?: BillingType | string
    rate_limit_tier?: RateLimitTier | string
    has_extra_usage_enabled?: boolean
    subscription_created_at?: string
    [key: string]: any
  }
  [key: string]: any
}

export type BillingType = string
export type RateLimitTier = string
export type SubscriptionType = string

export interface UserRolesResponse {
  roles?: string[]
  [key: string]: any
}

export interface ReferralCampaign {
  id?: string
  name?: string
  [key: string]: any
}

export interface ReferralEligibilityResponse {
  eligible?: boolean
  [key: string]: any
}

export interface ReferralRedemptionsResponse {
  redemptions?: unknown[]
  [key: string]: any
}

export interface ReferrerRewardInfo {
  amount?: number
  [key: string]: any
}
