declare module 'qrcode' {
  export function toString(
    text: string,
    options?: {
      type?: 'utf8' | 'terminal' | 'svg'
      errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' | 'low' | 'medium' | 'quartile' | 'high'
      small?: boolean
    },
  ): Promise<string>
}
