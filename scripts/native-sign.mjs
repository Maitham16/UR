#!/usr/bin/env node
// Signing is never inferred from the presence of a release or a checksum.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const target = process.argv[process.argv.indexOf('--target') + 1]
if (!['darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-x64'].includes(target)) throw new Error('Unsupported signing target')
const directory = resolve('dist-native', target)
const status = { platform: target, codeSigned: false, notarized: false, reason: 'No platform signing identity configured' }
const work = mkdtempSync(join(tmpdir(), 'ur-native-sign-'))
let temporaryKeychain
const run = (command, args) => {
  try { return execFileSync(command, args, { stdio: ['ignore','pipe','pipe'], encoding: 'utf8' }) }
  catch { throw new Error(`Native signing command failed: ${command}`) }
}
try {
  const appleConfiguration = ['APPLE_CERTIFICATE_P12_BASE64','APPLE_CERTIFICATE_PASSWORD','APPLE_SIGNING_IDENTITY','APPLE_API_KEY_P8_BASE64','APPLE_API_KEY_ID','APPLE_API_ISSUER_ID']
  const windowsConfiguration = ['WINDOWS_CERTIFICATE_PFX_BASE64','WINDOWS_CERTIFICATE_PASSWORD']
  if (target.startsWith('darwin') && appleConfiguration.some(name => Boolean(process.env[name]))) {
    for (const name of appleConfiguration) if (!process.env[name]) throw new Error(`Incomplete Apple signing configuration: ${name} is missing`)
    const certificate = join(work, 'identity.p12')
    const keychain = join(work, 'signing.keychain-db')
    temporaryKeychain = keychain
    const password = randomUUID()
    writeFileSync(certificate, Buffer.from(process.env.APPLE_CERTIFICATE_P12_BASE64, 'base64'), { mode: 0o600 })
    run('security', ['create-keychain','-p',password,keychain])
    run('security', ['unlock-keychain','-p',password,keychain])
    run('security', ['import',certificate,'-k',keychain,'-P',process.env.APPLE_CERTIFICATE_PASSWORD,'-T','/usr/bin/codesign'])
    run('security', ['set-key-partition-list','-S','apple-tool:,apple:','-s','-k',password,keychain])
    const entitlement = join(work, 'entitlements.plist')
    writeFileSync(entitlement, '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/><key>com.apple.security.cs.disable-library-validation</key><true/></dict></plist>')
    function signLibraries(path) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const file = join(path, entry.name)
        if (entry.isDirectory()) signLibraries(file)
        else {
          const descriptor = openSync(file, 'r')
          const header = Buffer.alloc(4)
          let length
          try { length = readSync(descriptor, header, 0, 4, 0) } finally { closeSync(descriptor) }
          // Include extensionless executables such as packaged ripgrep, along
          // with thin/universal native addons and shared libraries.
          if (length === 4 && ['feedface','feedfacf','cefaedfe','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(header.toString('hex'))) {
            run('codesign',['--force','--options','runtime','--timestamp','--keychain',keychain,'--sign',process.env.APPLE_SIGNING_IDENTITY,file])
            run('codesign',['--verify','--strict','--verbose=2',file])
          }
        }
      }
    }
    signLibraries(join(directory, 'resources'))
    run('codesign',['--force','--options','runtime','--timestamp','--keychain',keychain,'--entitlements',entitlement,'--sign',process.env.APPLE_SIGNING_IDENTITY,join(directory,'ur')])
    run('codesign',['--verify','--strict','--verbose=2',join(directory,'ur')])
    status.codeSigned = true
    const key = join(work, 'notary.p8')
    writeFileSync(key, Buffer.from(process.env.APPLE_API_KEY_P8_BASE64,'base64'), { mode: 0o600 })
    const archive = join(work, 'ur-notarize.zip')
    run('ditto',['-c','-k','--keepParent',directory,archive])
    const result = JSON.parse(run('xcrun',['notarytool','submit',archive,'--key',key,'--key-id',process.env.APPLE_API_KEY_ID,'--issuer',process.env.APPLE_API_ISSUER_ID,'--wait','--output-format','json']))
    if (result.status !== 'Accepted') throw new Error('Apple notarization did not accept the native release')
    status.notarized = true
    status.reason = 'Developer ID signature verified; Apple notarization accepted'
  } else if (target.startsWith('win32') && windowsConfiguration.some(name => Boolean(process.env[name]))) {
    for (const name of windowsConfiguration) if (!process.env[name]) throw new Error(`Incomplete Windows signing configuration: ${name} is missing`)
    const certificate = join(work,'identity.pfx')
    writeFileSync(certificate,Buffer.from(process.env.WINDOWS_CERTIFICATE_PFX_BASE64,'base64'),{mode:0o600})
    const tool = run('powershell.exe',['-NoProfile','-Command',"(Get-ChildItem 'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\*\\x64\\signtool.exe' | Sort-Object FullName -Descending | Select-Object -First 1).FullName"]).trim()
    if (!tool) throw new Error('Windows SDK signtool was not found')
    run(tool,['sign','/fd','SHA256','/td','SHA256','/tr','http://timestamp.digicert.com','/f',certificate,'/p',process.env.WINDOWS_CERTIFICATE_PASSWORD,join(directory,'ur.exe')])
    run(tool,['verify','/pa',join(directory,'ur.exe')])
    status.codeSigned = true
    status.reason = 'Authenticode signature verified'
  } else if (target.startsWith('linux')) status.reason = 'OS code signing is not applicable to Linux binaries'
  else console.warn(`::warning::${target} is unsigned because publisher credentials are not configured`)
  writeFileSync(join(directory,'resources','signing.json'),JSON.stringify(status,null,2)+'\n',{mode:0o644})
  // Signing native addons changes their bytes. Refresh the integrity manifest
  // before the mandatory installed-resource self-test and release archive.
  const resources = join(directory, 'resources')
  const resourceManifest = JSON.parse(readFileSync(join(resources, 'manifest.json'), 'utf8'))
  for (const name of [...Object.keys(resourceManifest.files), 'signing.json']) {
    const bytes = readFileSync(join(resources, name))
    resourceManifest.files[name] = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  writeFileSync(join(resources,'manifest.json'), JSON.stringify(resourceManifest,null,2)+'\n',{mode:0o644})
  console.log(JSON.stringify(status))
} finally {
  if (temporaryKeychain) { try { run('security',['delete-keychain',temporaryKeychain]) } catch { /* preserve the original signing failure */ } }
  rmSync(work,{recursive:true,force:true})
}
