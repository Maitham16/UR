import type {
  AcpMethod,
  AcpRequest,
  AcpResponse,
  AcpTaskRecord,
  AcpToolInfo,
} from './acpTypes.js'

export type AcpClientOptions = {
  baseUrl: string
  token?: string
  fetch?: typeof fetch
}

export class AcpClient {
  private baseUrl: string
  private token?: string
  private fetchImpl: typeof fetch

  constructor(options: AcpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.token = options.token
    this.fetchImpl = options.fetch ?? fetch
  }

  async call(method: AcpMethod, params?: Record<string, unknown>): Promise<unknown> {
    const id = Math.random().toString(36).slice(2)
    const body: AcpRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`
    }

    const response = await this.fetchImpl(`${this.baseUrl}/acp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    const text = await response.text()
    let parsed: AcpResponse
    try {
      parsed = JSON.parse(text) as AcpResponse
    } catch {
      throw new Error(`UR HTTP agent server returned non-JSON: ${text.slice(0, 200)}`)
    }

    if (parsed.error) {
      throw new Error(`ACP error ${parsed.error.code}: ${parsed.error.message}`)
    }

    return parsed.result
  }

  async initialize(): Promise<{
    name: string
    version?: string
    protocolVersion: string
  }> {
    return (await this.call('initialize')) as {
      name: string
      version?: string
      protocolVersion: string
    }
  }

  async listTools(): Promise<AcpToolInfo[]> {
    const result = (await this.call('tools/list')) as { tools: AcpToolInfo[] }
    return result.tools
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.call('tools/call', { name, arguments: args })
  }

  async cancelSession(sessionId: string): Promise<{ canceled: boolean }> {
    return (await this.call('session/cancel', { sessionId })) as {
      canceled: boolean
    }
  }

  async closeSession(sessionId: string): Promise<{ closed: boolean; canceled: boolean }> {
    return (await this.call('session/close', { sessionId })) as {
      closed: boolean
      canceled: boolean
    }
  }

  async sendTask(
    prompt: string,
    mode: 'sync' | 'async' = 'async',
  ): Promise<{ task: AcpTaskRecord; statusUrl?: string }> {
    return (await this.call('tasks/send', { prompt, mode })) as {
      task: AcpTaskRecord
      statusUrl?: string
    }
  }

  async getTask(id: string): Promise<{ task: AcpTaskRecord; log?: string | null }> {
    return (await this.call('tasks/get', { id })) as {
      task: AcpTaskRecord
      log?: string | null
    }
  }

  async listTasks(): Promise<AcpTaskRecord[]> {
    const result = (await this.call('tasks/get')) as { tasks: AcpTaskRecord[] }
    return result.tasks
  }

  async cancelTask(id: string): Promise<{ task: AcpTaskRecord }> {
    return (await this.call('tasks/cancel', { id })) as { task: AcpTaskRecord }
  }

  async captureIdeDiff(params: {
    title?: string
    baseRef?: string
    staged?: boolean
    diff?: string
  } = {}): Promise<unknown> {
    return this.call('ide/diffCapture', params)
  }

  async selectIdeDiff(id: string): Promise<unknown> {
    return this.call('ide/select', { id })
  }
}
