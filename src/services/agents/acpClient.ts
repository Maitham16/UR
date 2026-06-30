import type { AcpMethod, AcpRequest, AcpResponse } from './acpTypes.js'

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
      throw new Error(`ACP server returned non-JSON: ${text.slice(0, 200)}`)
    }

    if (parsed.error) {
      throw new Error(`ACP error ${parsed.error.code}: ${parsed.error.message}`)
    }

    return parsed.result
  }
}
