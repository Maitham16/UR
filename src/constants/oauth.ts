import { isEnvTruthy } from 'src/utils/envUtils.js'

// Default to prod config, override with test/staging if enabled
type OauthConfigType = 'prod' | 'staging' | 'local'

function getOauthConfigType(): OauthConfigType {
  if (process.env.USER_TYPE === 'ant') {
    if (isEnvTruthy(process.env.USE_LOCAL_OAUTH)) {
      return 'local'
    }
    if (isEnvTruthy(process.env.USE_STAGING_OAUTH)) {
      return 'staging'
    }
  }
  return 'prod'
}

export function fileSuffixForOauthConfig(): string {
  return ''
}

export const UR_AI_INFERENCE_SCOPE = 'user:inference' as const
export const UR_AI_PROFILE_SCOPE = 'user:profile' as const
const CONSOLE_SCOPE = 'org:create_api_key' as const
export const OAUTH_BETA_HEADER = 'oauth-2025-04-20' as const

// Console OAuth scopes - for API key creation via Console
export const CONSOLE_OAUTH_SCOPES = [
  CONSOLE_SCOPE,
  UR_AI_PROFILE_SCOPE,
] as const

// UR.ai OAuth scopes - for UR.ai subscribers (Pro/Max/Team/Enterprise)
export const UR_AI_OAUTH_SCOPES = [
  UR_AI_PROFILE_SCOPE,
  UR_AI_INFERENCE_SCOPE,
  'user:sessions:ur',
  'user:mcp_servers',
  'user:file_upload',
] as const

// All OAuth scopes - union of all scopes used in UR CLI
// When logging in, request all scopes in order to handle both Console -> UR.ai redirect
// Ensure that `OAuthConsentPage` in apps repo is kept in sync with this list.
export const ALL_OAUTH_SCOPES = Array.from(
  new Set([...CONSOLE_OAUTH_SCOPES, ...UR_AI_OAUTH_SCOPES]),
)

type OauthConfig = {
  BASE_API_URL: string
  CONSOLE_AUTHORIZE_URL: string
  UR_AI_AUTHORIZE_URL: string
  /**
   * The ur.ai web origin. Separate from UR_AI_AUTHORIZE_URL because
   * that now routes through ur.com/cai/* for attribution — deriving
   * .origin from it would give ur.com, breaking links to /code,
   * /settings/connectors, and other ur.ai web pages.
   */
  UR_AI_ORIGIN: string
  TOKEN_URL: string
  API_KEY_URL: string
  ROLES_URL: string
  CONSOLE_SUCCESS_URL: string
  CLAUDEAI_SUCCESS_URL: string
  MANUAL_REDIRECT_URL: string
  CLIENT_ID: string
  OAUTH_FILE_SUFFIX: string
  MCP_PROXY_URL: string
  MCP_PROXY_PATH: string
}

const PROD_OAUTH_CONFIG = {
  BASE_API_URL: '',
  CONSOLE_AUTHORIZE_URL: '',
  UR_AI_AUTHORIZE_URL: '',
  UR_AI_ORIGIN: '',
  TOKEN_URL: '',
  API_KEY_URL: '',
  ROLES_URL: '',
  CONSOLE_SUCCESS_URL: '',
  CLAUDEAI_SUCCESS_URL: '',
  MANUAL_REDIRECT_URL: '',
  CLIENT_ID: '',
  OAUTH_FILE_SUFFIX: '',
  MCP_PROXY_URL: '',
  MCP_PROXY_PATH: '/v1/mcp/{server_id}',
} as const

export const MCP_CLIENT_METADATA_URL = ''

const STAGING_OAUTH_CONFIG = undefined

// Three local dev servers: :8000 api-proxy (`api dev start -g ccr`),
// :4000 ur-ai frontend, :3000 Console frontend. Env vars let
// scripts/ur-localhost override if your layout differs.
function getLocalOauthConfig(): OauthConfig {
  const api =
    process.env.UR_LOCAL_OAUTH_API_BASE?.replace(/\/$/, '') ??
    'http://localhost:8000'
  const apps =
    process.env.UR_LOCAL_OAUTH_APPS_BASE?.replace(/\/$/, '') ??
    'http://localhost:4000'
  const consoleBase =
    process.env.UR_LOCAL_OAUTH_CONSOLE_BASE?.replace(/\/$/, '') ??
    'http://localhost:3000'
  return {
    BASE_API_URL: api,
    CONSOLE_AUTHORIZE_URL: `${consoleBase}/oauth/authorize`,
    UR_AI_AUTHORIZE_URL: `${apps}/oauth/authorize`,
    UR_AI_ORIGIN: apps,
    TOKEN_URL: `${api}/v1/oauth/token`,
    API_KEY_URL: `${api}/api/oauth/ur_cli/create_api_key`,
    ROLES_URL: `${api}/api/oauth/ur_cli/roles`,
    CONSOLE_SUCCESS_URL: `${consoleBase}/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dur`,
    CLAUDEAI_SUCCESS_URL: `${consoleBase}/oauth/code/success?app=ur`,
    MANUAL_REDIRECT_URL: `${consoleBase}/oauth/code/callback`,
    CLIENT_ID: '22422756-60c9-4084-8eb7-27705fd5cf9a',
    OAUTH_FILE_SUFFIX: '-local-oauth',
    MCP_PROXY_URL: 'http://localhost:8205',
    MCP_PROXY_PATH: '/v1/toolbox/shttp/mcp/{server_id}',
  }
}

const ALLOWED_OAUTH_BASE_URLS: string[] = []

export function getOauthConfig(): {
  BASE_API_URL: string
  UR_AI_ORIGIN: string
  UR_AI_AUTHORIZE_URL: string
  CONSOLE_AUTHORIZE_URL: string
  CLIENT_ID: string
  MANUAL_REDIRECT_URL: string
  TOKEN_URL: string
  CLAUDEAI_SUCCESS_URL: string
  CONSOLE_SUCCESS_URL: string
  ROLES_URL: string
  API_KEY_URL: string
  OAUTH_FILE_SUFFIX: string
} {
  // OAuth is not used for local Ollama-only execution. All URLs are left
  // empty so the type surface is complete but no network calls are made.
  return {
    BASE_API_URL: 'http://localhost:11434',
    UR_AI_ORIGIN: '',
    UR_AI_AUTHORIZE_URL: '',
    CONSOLE_AUTHORIZE_URL: '',
    CLIENT_ID: '',
    MANUAL_REDIRECT_URL: '',
    TOKEN_URL: '',
    CLAUDEAI_SUCCESS_URL: '',
    CONSOLE_SUCCESS_URL: '',
    ROLES_URL: '',
    API_KEY_URL: '',
    OAUTH_FILE_SUFFIX: '',
  }
}