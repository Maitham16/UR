import * as vscode from 'vscode'
import { runUrCliCapture } from '../bridge/urCli.js'

type ProviderOption = {
  id: string
  name: string
  accessTypeLabel?: string
  providerKind?: string
  runtimeBackend?: string
}

type ProviderModel = {
  id: string
  displayName?: string
  description?: string
  isDefault?: boolean
}

type ProviderModelsResult = {
  provider: string
  source: 'live' | 'cache' | 'static'
  warning?: string
  models: ProviderModel[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseProviderList(raw: string): ProviderOption[] {
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.flatMap(entry => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') return []
      return [
        {
          id: entry.id,
          name: entry.name,
          accessTypeLabel: typeof entry.accessTypeLabel === 'string' ? entry.accessTypeLabel : undefined,
          providerKind: typeof entry.providerKind === 'string' ? entry.providerKind : undefined,
          runtimeBackend: typeof entry.runtimeBackend === 'string' ? entry.runtimeBackend : undefined,
        },
      ]
    })
  } catch {
    return []
  }
}

function parseProviderModels(raw: string): ProviderModelsResult | undefined {
  try {
    const data: unknown = JSON.parse(raw)
    if (!isRecord(data) || typeof data.provider !== 'string' || !Array.isArray(data.models)) return undefined
    const source =
      data.source === 'live' || data.source === 'cache' || data.source === 'static'
        ? data.source
        : 'static'
    return {
      provider: data.provider,
      source,
      warning: typeof data.warning === 'string' ? data.warning : undefined,
      models: data.models.flatMap(model => {
        if (!isRecord(model) || typeof model.id !== 'string') return []
        return [
          {
            id: model.id,
            displayName: typeof model.displayName === 'string' ? model.displayName : undefined,
            description: typeof model.description === 'string' ? model.description : undefined,
            isDefault: Boolean(model.isDefault),
          },
        ]
      }),
    }
  } catch {
    return undefined
  }
}

function parseProviderStatus(raw: string): { provider?: string; model?: string } {
  try {
    const data: unknown = JSON.parse(raw)
    if (!isRecord(data)) return {}
    return {
      provider: typeof data.provider === 'string' ? data.provider : undefined,
      model: typeof data.model === 'string' ? data.model : undefined,
    }
  } catch {
    return {}
  }
}

function parseIdeStatus(raw: string): { model?: string } {
  try {
    const data: unknown = JSON.parse(raw)
    if (!isRecord(data)) return {}
    const provider = isRecord(data.provider) ? data.provider : {}
    return {
      model: typeof provider.model === 'string' ? provider.model : undefined,
    }
  } catch {
    return {}
  }
}

function selectionError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export async function pickProviderModel(cwd: string | undefined): Promise<void> {
  if (!cwd) {
    vscode.window.showWarningMessage('Open a workspace folder to pick a UR model.')
    return
  }

  const [{ stdout: providerStdout }, statusResult, ideStatusResult] = await Promise.all([
    runUrCliCapture(['provider', 'list', '--json'], { cwd }),
    runUrCliCapture(['provider', 'status', '--json'], { cwd }).catch(() => ({ stdout: '' })),
    runUrCliCapture(['ide', 'status', '--json'], { cwd }).catch(() => ({ stdout: '' })),
  ])
  const providers = parseProviderList(providerStdout)
  if (providers.length === 0) {
    vscode.window.showWarningMessage('No UR providers were reported by `ur provider list`.')
    return
  }

  const providerStatus = parseProviderStatus(statusResult.stdout)
  const ideStatus = parseIdeStatus(ideStatusResult.stdout)
  const status = { provider: providerStatus.provider, model: providerStatus.model ?? ideStatus.model }
  const pickedProvider = await vscode.window.showQuickPick(
    providers.map(provider => ({
      label: provider.name,
      description: provider.id === status.provider ? 'current' : provider.id,
      detail: [provider.accessTypeLabel, provider.providerKind, provider.runtimeBackend].filter(Boolean).join(' · '),
      provider,
    })),
    {
      title: 'UR: Pick Model',
      placeHolder: 'Choose a provider first',
    },
  )
  if (!pickedProvider) return

  let modelsStdout = ''
  try {
    const result = await runUrCliCapture(['provider', 'models', pickedProvider.provider.id, '--json'], { cwd })
    modelsStdout = result.stdout
  } catch (error) {
    vscode.window.showWarningMessage(
      `UR could not list models for ${pickedProvider.provider.name}: ${selectionError(error)}`,
    )
    return
  }
  const modelResult = parseProviderModels(modelsStdout)
  if (!modelResult || modelResult.models.length === 0) {
    vscode.window.showWarningMessage(
      modelResult?.warning ??
        `No models are available for ${pickedProvider.provider.name}. Run "ur provider doctor ${pickedProvider.provider.id}" to troubleshoot.`,
    )
    return
  }
  if (modelResult.warning) {
    vscode.window.showWarningMessage(modelResult.warning)
  }

  const pickedModel = await vscode.window.showQuickPick(
    modelResult.models.map(model => ({
      label: model.displayName ?? model.id,
      description: [
        model.id === status.model ? 'current' : model.id,
        model.isDefault ? 'default' : '',
        modelResult.source,
      ].filter(Boolean).join(' · '),
      detail: model.description,
      model,
    })),
    {
      title: `UR: Pick Model for ${pickedProvider.provider.name}`,
      placeHolder: 'Choose a model for this provider',
    },
  )
  if (!pickedModel) return

  try {
    const { stdout } = await runUrCliCapture(
      ['provider', 'select-model', pickedProvider.provider.id, pickedModel.model.id, '--json'],
      { cwd },
    )
    const parsed = JSON.parse(stdout) as { ok?: boolean; message?: string; model?: string; provider?: string; modelSource?: string }
    if (parsed.ok) {
      vscode.window.showInformationMessage(
        `UR model set to ${parsed.model ?? pickedModel.model.id} for ${parsed.provider ?? pickedProvider.provider.id}.`,
      )
      return
    }
    vscode.window.showErrorMessage(parsed.message ?? 'UR could not save the selected model.')
  } catch (error) {
    vscode.window.showErrorMessage(`UR could not save the selected model: ${selectionError(error)}`)
  }
}
