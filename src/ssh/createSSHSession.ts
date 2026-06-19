export interface SSHSession {
  [key: string]: any
}

export class SSHSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SSHSessionError'
  }
}

export function createSSHSession(_args: any, _options?: any): Promise<SSHSession> {
  throw new SSHSessionError('SSH session support is not available in this build')
}

export function createLocalSSHSession(_args: any): SSHSession {
  throw new SSHSessionError('Local SSH session support is not available in this build')
}
