import forge from 'node-forge'

/** Exercise the RSA verifier that is bundled into the distributed CLI. No IO. */
export function assertForgeRsaSecurity(): string[] {
  const digestHex = '7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9'
  const digest = forge.util.hexToBytes(digestHex)
  const key = forge.pki.rsa.setPublicKey(
    new forge.jsbn.BigInteger('f'.repeat(256), 16),
    new forge.jsbn.BigInteger('1', 10),
  )
  const checks: string[] = []
  function verify(name: string, prefix: string, expected: boolean): void {
    const info = prefix + digestHex
    const block = forge.util.hexToBytes('0001' + 'ff'.repeat(128 - 3 - info.length / 2) + '00' + info)
    let accepted = false
    try { accepted = key.verify(digest, block) } catch { /* Malformed DER must reject. */ }
    if (accepted !== expected) throw new Error(`RSA security regression: ${name}`)
    checks.push(name)
  }
  verify('canonical-null-parameters', '3031300d060960864801650304020105000420', true)
  verify('canonical-absent-parameters', '302f300b06096086480165030402010420', true)
  verify('reject-nonempty-null', '3033300f06096086480165030402010502beef0420', false)
  verify('reject-nested-extra-element', '30353011060960864801650304020105000402beef0420', false)
  verify('reject-nonminimal-lengths', '30813230810d060960864801650304020105000420', false)
  verify('reject-non-null-parameters', '3033300f06096086480165030402010202beef0420', false)

  // Published PR #1160 e=3 forgery: the cube is smaller than this modulus.
  // This tests real RSA arithmetic as well as the hand-built DER cases above.
  const forgedHex = '0'.repeat(342) +
    '32cbfd4a7adc7905583d7920d7165d77cf8d6f4b19a4c14026dc9bf5576b2de2aab4a0dc9d8303ba8e365764f52a' +
    '49da7a2dfc5bed616f52d37d860cb283543d93fe1b73ca6379278422fd8821eeeddc3a1bee99f9'
  const lowExponentKey = forge.pki.rsa.setPublicKey(
    new forge.jsbn.BigInteger('f'.repeat(512), 16),
    new forge.jsbn.BigInteger('3', 10),
  )
  let forgedAccepted = false
  try { forgedAccepted = lowExponentKey.verify(digest, forge.util.hexToBytes(forgedHex)) } catch { /* Expected. */ }
  if (forgedAccepted) throw new Error('RSA security regression: published-low-exponent-forgery')
  checks.push('reject-published-low-exponent-forgery')
  return checks
}
