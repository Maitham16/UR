// Reconstructed permissive Jupyter notebook types.

export type NotebookCellType = 'code' | 'markdown' | 'raw' | string

export interface NotebookOutputImage {
  image_data: string
  media_type: string
}

export interface NotebookCellOutput {
  output_type?: 'stream' | 'execute_result' | 'display_data' | 'error' | string
  text?: string | string[]
  data?: Record<string, unknown>
  ename?: string
  evalue?: string
  traceback?: string[]
  execution_count?: number | null
  metadata?: Record<string, unknown>
  [key: string]: any
}

export interface NotebookCellSourceOutput {
  text?: string
  image?: NotebookOutputImage
  [key: string]: any
}

export interface NotebookCellSource {
  cell_type?: NotebookCellType
  source?: string
  language?: string
  execution_count?: number | null
  outputs?: NotebookCellSourceOutput[]
  [key: string]: any
}

export interface NotebookCell {
  id?: string
  cell_type?: NotebookCellType
  source?: string | string[]
  execution_count?: number | null
  outputs?: NotebookCellOutput[]
  metadata?: Record<string, unknown>
  [key: string]: any
}

export interface NotebookContent {
  cells?: NotebookCell[]
  metadata?: {
    kernelspec?: {
      name?: string
      display_name?: string
      language?: string
    }
    language_info?: {
      name?: string
      version?: string
      [key: string]: any
    }
    [key: string]: any
  }
  nbformat?: number
  nbformat_minor?: number
  [key: string]: any
}
