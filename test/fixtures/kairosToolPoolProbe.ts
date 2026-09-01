import { getAllBaseTools } from '../../src/tools.js'

const tools = getAllBaseTools()
const names = tools.map(tool => tool.name)
for (const expected of ['Sleep', 'SendUserFile', 'PushNotification']) {
  if (!names.includes(expected)) throw new Error(`${expected} missing from KAIROS pool`)
}
if (new Set(names).size !== names.length) {
  throw new Error(`duplicate tools: ${names.join(', ')}`)
}
for (const tool of tools) {
  if (!tool) throw new Error('null tool in KAIROS pool')
  for (const method of [
    'call',
    'description',
    'prompt',
    'isEnabled',
    'isConcurrencySafe',
    'isReadOnly',
    'checkPermissions',
    'renderPermissionRequest',
    'mapToolResultToToolResultBlockParam',
  ] as const) {
    if (typeof tool[method] !== 'function') {
      throw new Error(`${tool.name}.${method} is not a function`)
    }
  }
  if (!tool.inputSchema || !tool.outputSchema) {
    throw new Error(`${tool.name} has an incomplete schema contract`)
  }
}
process.stdout.write(JSON.stringify({ count: tools.length, names }))
