/**
 * Generated from NVIDIA's public NIM OpenAPI reference.
 * Do not hand-edit; run `bun run provider:nvidia-catalog`.
 */

export type NvidiaHostedCatalogContract = {
  id: string
  displayName: string
  category: string
  endpoint: string
  documentation: string
  documentationUpdatedAt?: string
  purpose: string
  agent: boolean
  agentCapabilitySource: 'request-schema' | 'model-card' | 'none'
  taskKind?: string
  requestContentType: string
  requestSchema: Record<string, unknown>
  responseMediaTypes: string[]
  supportsStreaming: boolean
}

export const NVIDIA_HOSTED_CATALOG_REVIEWED_AT = "2026-08-27T23:18:12.000Z"

export const NVIDIA_HOSTED_MODEL_CONTRACTS: readonly NvidiaHostedCatalogContract[] = [
  {
    "id": "arc/evo2-40b",
    "displayName": "arc / evo2-40b",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/biology/arc/evo2-40b/generate",
    "documentation": "https://docs.api.nvidia.com/nim/reference/arc-evo2-40b-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:00.000Z",
    "purpose": "Generate DNA sequences",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "biology",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "GenerateInputs",
      "required": [
        "sequence"
      ],
      "properties": {
        "sequence": {
          "type": "string",
          "title": "Input DNA Sequence",
          "minLength": 1,
          "description": "Sequence data of the DNA."
        },
        "num_tokens": {
          "title": "Number of tokens to generate",
          "default": 100,
          "description": "Number of tokens to be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 0.7,
          "description": "Scale of randomness in the temperature sampling process. Values lower than 1.0 generates a sharper distribution, which is less random. Values higher than 1.0 generates a uniform distribution, which is more random.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1.3,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        },
        "top_k": {
          "title": "Top K",
          "default": 3,
          "description": "Specifies the number of highest probability tokens to consider. When set to 1, it selects only the token with the highest probability. The higher the values are set, the more diverse the sampling will be. If set to 0, all tokens are considered.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 6
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 1,
          "description": "This parameter specifies the top-p threshold number, between 0 and 1, that enables nucleus sampling. When cumulative probability of the smallest possible set of tokens exceeds the top_p threshold, it filters out the rest of the tokens. Setting this to 0.0 disables top-p sampling.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "random_seed": {
          "title": "Random Seed",
          "description": "Turns the Evo 2 model into a deterministic model, where an input DNA and a fixed seed always produces the same output. This argument should only be used for development purposes.",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "enable_logits": {
          "type": "boolean",
          "title": "Enable Logits Reporting",
          "default": false,
          "description": "Enables or disables Logits reporting in the output response."
        },
        "enable_sampled_probs": {
          "type": "boolean",
          "title": "Enable Sampled Token Probabilities Reporting",
          "default": false,
          "description": "Enables or disables the reporting of sampled token probabilities. When enabled, generates a list of probability values, between 0 and 1, corresponding to each token in the output sequence. These probabilities represent the model's confidence each token selection during the generation process. The resulting list has the same length as the output sequence, which provides insight into the model's decision-making at each step of text generation."
        },
        "enable_elapsed_ms_per_token": {
          "type": "boolean",
          "title": "Enable Per-Token Elapsed Time Reporting",
          "default": false,
          "description": "Enables or disables the reporting of per-token timing statistics, which is used for benchmarking."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "arc/evo2-7b-forward",
    "displayName": "arc / evo2-7b-forward",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/biology/arc/evo2-7b/forward",
    "documentation": "https://docs.api.nvidia.com/nim/reference/arc-evo2-7b-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:59.000Z",
    "purpose": "Run model forward pass and save layers outputs",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "biology",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ForwardInputs",
      "required": [
        "sequence",
        "output_layers"
      ],
      "properties": {
        "sequence": {
          "type": "string",
          "title": "Input DNA sequence",
          "minLength": 1,
          "description": "Sequence data of the DNA."
        },
        "output_layers": {
          "type": "array",
          "title": "Output capture layers",
          "minItems": 1,
          "maxItems": 100,
          "description": "List of layer names from which to capture and save output tensors. The Evo 2 model architecture consists of two types of layers: - **HyenaLayer**: Uses Hyena mixer for efficient long-range modeling - **TransformerLayer**: Uses multi-head self-attention mechanism **Layer distribution by model size:** - **7B models**: 32 layers total - HyenaLayers: all layers except 3, 10, 17, 24, 31 - TransformerLayers: layers 3, 10, 17, 24, 31 - **40B models**: 50 layers total - HyenaLayers: all layers except 3, 10, 17, 24, 31, 35, 42, 49 - TransformerLayers: layers 3, 10, 17, 24, 31, 35, 42, 49 **Model-level ",
          "items": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "baai/bge-m3",
    "displayName": "baai / bge-m3",
    "category": "retrieval-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/embeddings",
    "documentation": "https://docs.api.nvidia.com/nim/reference/baai-bge-m3-invoke",
    "documentationUpdatedAt": "2026-08-06T09:59:18.000Z",
    "purpose": "Creates an embedding vector from the input text",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-embedding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "EmbeddingsRequest",
      "required": [
        "input"
      ],
      "properties": {
        "model": {
          "type": "string",
          "description": "ID of the embedding model.",
          "enum": [
            "baai/bge-m3"
          ]
        },
        "input": {
          "title": "Input",
          "minLength": 1,
          "description": "Input text to embed, encoded as a string or array of tokens. To embed multiple inputs in a single request, pass an array of strings. The input must not exceed the max input tokens for the model (8192 tokens) and cannot be an empty string.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "encoding_format": {
          "type": "string",
          "title": "Encoding Format",
          "default": "float",
          "description": "The format to return the embeddings in",
          "enum": [
            "float",
            "base64"
          ]
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "NONE",
          "description": "Specifies how inputs longer than the maximum token length of the model are handled. Passing `START` discards the start of the input. `END` discards the end of the input. In both cases, input is discarded until the remaining input is exactly the maximum input token length for the model. If `NONE` is selected, when the input exceeds the maximum input token length an error will be returned.",
          "enum": [
            "NONE",
            "START",
            "END"
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "black-forest-labs/flux.1-dev",
    "displayName": "black forest labs / flux.1-dev",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev",
    "documentation": "https://docs.api.nvidia.com/nim/reference/black-forest-labs-flux_1-dev-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:46.000Z",
    "purpose": "Generate an image from a text prompt (black-forest-labs/flux.1-dev)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ImageRequest",
      "required": [
        "prompt"
      ],
      "properties": {
        "prompt": {
          "type": "string",
          "title": "Prompt",
          "maxLength": 10000,
          "description": "What you wish to see in the output image. A strong, descriptive prompt that clearly defines elements, colors, and subjects will lead to better results."
        },
        "height": {
          "type": "integer",
          "title": "Height",
          "default": 1024,
          "description": "Height of the image to generate, in pixels. Only height=1024 is supported",
          "enum": [
            768,
            832,
            896,
            960,
            1024,
            1088,
            1152,
            1216,
            1280,
            1344
          ]
        },
        "width": {
          "type": "integer",
          "title": "Width",
          "default": 1024,
          "description": "Width of the image to generate, in pixels. Only width=1024 is supported",
          "enum": [
            768,
            832,
            896,
            960,
            1024,
            1088,
            1152,
            1216,
            1280,
            1344
          ]
        },
        "cfg_scale": {
          "type": "number",
          "title": "Cfg Scale",
          "default": 5,
          "maximum": 9,
          "exclusiveMinimum": 1,
          "description": "How strictly the diffusion process adheres to the prompt text (higher values keep your image closer to your prompt)."
        },
        "mode": {
          "type": [
            "string"
          ],
          "title": "Mode",
          "default": "base",
          "description": "NIM inference mode. If canny or depth is selected an image input is required",
          "enum": [
            "depth",
            "base",
            "canny"
          ]
        },
        "image": {
          "type": [
            "string",
            "null"
          ],
          "title": "Image",
          "description": "An image input with a depth map or canny edges used if the mode is depth or canny respectively. Preview API NIM supports only a predefined set of images. The image should be in form of `data:image/png;example_id,{example_id}` with example_id in a range [0,3]."
        },
        "samples": {
          "type": "integer",
          "title": "Samples",
          "default": 1,
          "minimum": 1,
          "maximum": 1,
          "description": "Number of images to generate. Only samples=1 is supported"
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "minimum": 0,
          "exclusiveMaximum": 4294967296,
          "description": "The seed which governs generation. Changing the seed with other inputs fixed results in different outputs. (Use 0 for a random seed)"
        },
        "steps": {
          "type": "integer",
          "title": "Steps",
          "default": 50,
          "minimum": 5,
          "maximum": 100,
          "description": "The number of diffusion steps applied to generate an output image."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "black-forest-labs/flux.1-kontext-dev",
    "displayName": "black-forest-labs / flux.1-kontext-dev",
    "category": "multimodal-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-kontext-dev",
    "documentation": "https://docs.api.nvidia.com/nim/reference/black-forest-labs-flux_1-kontext-dev-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:42.000Z",
    "purpose": "Edit an input image from a text instruction (black-forest-labs/flux.1-kontext-dev)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-editing",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ImageRequest",
      "required": [
        "prompt",
        "image"
      ],
      "properties": {
        "prompt": {
          "type": "string",
          "title": "Prompt",
          "maxLength": 10000,
          "description": "What you wish to see in the output image. A strong, descriptive prompt that clearly defines elements, colors, and subjects will lead to better results."
        },
        "image": {
          "type": "null",
          "title": "Image",
          "description": "An image input to edit. Preview API NIM supports only a predefined set of images. The image should be in form of `data:image/png;example_id,{example_id}` with example_id in a range [0,2]."
        },
        "height": {
          "type": "integer",
          "title": "Height",
          "default": 1024,
          "description": "The image height in pixels. Supported heights=[1568, 1504, 1456, 1392, 1328, 1248, 1184, 1104, 1024, 944, 880, 832, 800, 752, 720, 688, 672].",
          "enum": [
            1568,
            1504,
            1456,
            1392,
            1328,
            1248,
            1184,
            1104,
            1024,
            944,
            880,
            832,
            800,
            752,
            720,
            688,
            672
          ]
        },
        "width": {
          "type": "integer",
          "title": "Width",
          "default": 1024,
          "description": "The image width in pixels. Supported widths=[672, 688, 720, 752, 800, 832, 880, 944, 1024, 1104, 1184, 1248, 1328, 1392, 1456, 1504, 1568].",
          "enum": [
            1568,
            1504,
            1456,
            1392,
            1328,
            1248,
            1184,
            1104,
            1024,
            944,
            880,
            832,
            800,
            752,
            720,
            688,
            672
          ]
        },
        "cfg_scale": {
          "type": "number",
          "title": "Cfg Scale",
          "default": 3.5,
          "maximum": 9,
          "exclusiveMinimum": 1,
          "description": "How strictly the diffusion process adheres to the prompt text (higher values keep your image closer to your prompt)."
        },
        "aspect_ratio": {
          "type": [
            "string"
          ],
          "title": "Aspect ratio",
          "default": "match_input_image",
          "description": "Aspect ratio of the image to generate.",
          "enum": [
            "match_input_image",
            "9:21",
            "5:11",
            "1:2",
            "7:13",
            "3:5",
            "2:3",
            "3:4",
            "6:7",
            "1:1",
            "7:6",
            "4:3",
            "3:2",
            "5:3",
            "13:7",
            "2:1",
            "11:5",
            "21:9"
          ]
        },
        "samples": {
          "type": "integer",
          "title": "Samples",
          "default": 1,
          "minimum": 1,
          "maximum": 1,
          "description": "Number of images to generate. Only samples=1 is supported"
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "minimum": 0,
          "exclusiveMaximum": 4294967296,
          "description": "The seed which governs generation. Changing the seed with other inputs fixed results in different outputs. (Use 0 for a random seed)"
        },
        "steps": {
          "type": "integer",
          "title": "Steps",
          "default": 30,
          "minimum": 20,
          "maximum": 50,
          "description": "The number of diffusion steps applied to generate an output image."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "black-forest-labs/flux.1-schnell",
    "displayName": "black forest labs / flux.1-schnell",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell",
    "documentation": "https://docs.api.nvidia.com/nim/reference/black-forest-labs-flux_1-schnell-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:47.000Z",
    "purpose": "Generate an image from a text prompt (black-forest-labs/flux.1-schnell)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ImageRequest",
      "required": [
        "prompt"
      ],
      "properties": {
        "prompt": {
          "type": "string",
          "title": "Prompt",
          "maxLength": 10000,
          "description": "What you wish to see in the output image. A strong, descriptive prompt that clearly defines elements, colors, and subjects will lead to better results."
        },
        "height": {
          "type": "integer",
          "title": "Height",
          "default": 1024,
          "description": "Height of the image to generate, in pixels. Only height=1024 is supported",
          "enum": [
            768,
            832,
            896,
            960,
            1024,
            1088,
            1152,
            1216,
            1280,
            1344
          ]
        },
        "width": {
          "type": "integer",
          "title": "Width",
          "default": 1024,
          "description": "Width of the image to generate, in pixels. Only width=1024 is supported",
          "enum": [
            768,
            832,
            896,
            960,
            1024,
            1088,
            1152,
            1216,
            1280,
            1344
          ]
        },
        "cfg_scale": {
          "type": "number",
          "title": "Cfg Scale",
          "default": 0,
          "minimum": 0,
          "maximum": 0,
          "description": "How strictly the diffusion process adheres to the prompt text (higher values keep your image closer to your prompt)."
        },
        "mode": {
          "type": "string",
          "title": "Mode",
          "default": "base",
          "description": "NIM inference mode. If canny or depth is selected an image input is required",
          "enum": [
            "base"
          ]
        },
        "image": {
          "type": "null",
          "title": "Image",
          "description": "[Unsupported by FLUX.1-schnell] An image input with a depth map or canny edges used if the mode is depth or canny respectively. Preview API NIM supports only a predefined set of images. The image should be in form of `data:image/png;example_id,{example_id}` with example_id in a range [0,3]."
        },
        "samples": {
          "type": "integer",
          "title": "Samples",
          "default": 1,
          "minimum": 1,
          "maximum": 1,
          "description": "Number of images to generate. Only samples=1 is supported"
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "minimum": 0,
          "exclusiveMaximum": 4294967296,
          "description": "The seed which governs generation. Changing the seed with other inputs fixed results in different outputs. (Use 0 for a random seed)"
        },
        "steps": {
          "type": "integer",
          "title": "Steps",
          "default": 4,
          "minimum": 1,
          "maximum": 4,
          "description": "The number of diffusion steps applied to generate an output image."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "black-forest-labs/flux.2-klein-4b",
    "displayName": "black forest labs / flux.2-klein-4b",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b",
    "documentation": "https://docs.api.nvidia.com/nim/reference/black-forest-labs-flux_2-klein-4b-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:48.000Z",
    "purpose": "Generate an image from a text prompt (black-forest-labs/flux.2-klein-4b)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ImageRequest",
      "required": [
        "prompt"
      ],
      "properties": {
        "mode": {
          "type": "string",
          "title": "Mode",
          "default": "Image Generation",
          "description": "NIM inference mode. If Image Editing is selected an image input is required",
          "enum": [
            "Image Generation",
            "Image Editing"
          ]
        },
        "prompt": {
          "type": "string",
          "title": "Prompt",
          "maxLength": 10000,
          "description": "What you wish to see in the output image. A strong, descriptive prompt that clearly defines elements, colors, and subjects will lead to better results."
        },
        "height": {
          "type": "integer",
          "title": "Height",
          "default": 1024,
          "description": "Height of the image to generate, in pixels. Only height=1024 is supported",
          "enum": [
            768,
            832,
            896,
            960,
            1024,
            1088,
            1152,
            1216,
            1280,
            1344
          ]
        },
        "width": {
          "type": "integer",
          "title": "Width",
          "default": 1024,
          "description": "Width of the image to generate, in pixels. Only width=1024 is supported",
          "enum": [
            768,
            832,
            896,
            960,
            1024,
            1088,
            1152,
            1216,
            1280,
            1344
          ]
        },
        "cfg_scale": {
          "type": "number",
          "title": "Cfg Scale",
          "default": 0,
          "minimum": 0,
          "maximum": 0,
          "description": "How strictly the diffusion process adheres to the prompt text (higher values keep your image closer to your prompt)."
        },
        "image": {
          "type": "null",
          "title": "Image",
          "description": "Preview API NIM supports only a predefined set of images. The image should be in form of `data:image/png;example_id,{example_id}` with example_id in a range [0,3]."
        },
        "samples": {
          "type": "integer",
          "title": "Samples",
          "default": 1,
          "minimum": 1,
          "maximum": 1,
          "description": "Number of images to generate. Only samples=1 is supported"
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "minimum": 0,
          "exclusiveMaximum": 4294967296,
          "description": "The seed which governs generation. Changing the seed with other inputs fixed results in different outputs. (Use 0 for a random seed)"
        },
        "steps": {
          "type": "integer",
          "title": "Steps",
          "default": 4,
          "minimum": 1,
          "maximum": 4,
          "description": "The number of diffusion steps applied to generate an output image."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "colabfold/msa-search",
    "displayName": "colabfold / msa-search",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/biology/colabfold/msa-search/predict",
    "documentation": "https://docs.api.nvidia.com/nim/reference/colabfold-msa-search-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:02.000Z",
    "purpose": "Multiple Sequence Alignment Search",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "biology",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "MSASearchInputs",
      "description": "Input parameters for monomer MSA search.",
      "required": [
        "sequence"
      ],
      "properties": {
        "databases": {
          "title": "Databases",
          "default": [
            "all"
          ],
          "description": "List of database names to search against (all databases are searched by default). Database names are case-insensitive; the response preserves the case you specify. For ColabFold search type, the first database in the list is used for profile generation. When using 'all', uniref30 is automatically placed first.",
          "anyOf": [
            {
              "type": "array",
              "minItems": 1,
              "maxItems": 5,
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "e_value": {
          "title": "E-value",
          "default": 0.0001,
          "description": "The e-value threshold for filtering hits when building the Multiple Sequence Alignment. Sequences with an e-value greater than this are not included in the MSA.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "iterations": {
          "title": "MSA Iterations",
          "default": 1,
          "description": "The number of MSA iterations to perform. More iterations find more distant homologs.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 6
            },
            {
              "type": "null"
            }
          ]
        },
        "max_msa_sequences": {
          "title": "Maximum MSA Sequences",
          "default": 500,
          "description": "The maximum sequences taken from the MSA for model prediction. Note: When GPU Server is enabled (default), this parameter must be set globally via the NIM_GLOBAL_MAX_MSA_DEPTH environment variable at container startup.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 10001
            },
            {
              "type": "null"
            }
          ]
        },
        "output_alignment_formats": {
          "title": "Output Alignment Format",
          "default": [
            "a3m"
          ],
          "description": "The output format of the MSA.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string",
                "title": "Alignment_Format_Constants",
                "enum": [
                  "a3m",
                  "fasta"
                ]
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "search_type": {
          "title": "Search Type",
          "default": "colabfold",
          "description": "Which type of MSA Search to run for Alignment production.",
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "colabfold",
                "alphafold2"
              ]
            },
            {
              "type": "null"
            }
          ]
        },
        "sequence": {
          "type": "string",
          "title": "Input Sequence",
          "minLength": 1,
          "maxLength": 4096,
          "description": "A sequence to search against the MSA databases."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "deepmind/alphafold2",
    "displayName": "deepmind / alphafold2",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/protein-structure/alphafold2/predict-structure-from-sequence",
    "documentation": "https://docs.api.nvidia.com/nim/reference/deepmind-alphafold2-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:03.000Z",
    "purpose": "Predict Structure From Sequence Post",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "biology",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "AlphaFold2SeqToStructInputs",
      "required": [
        "sequence"
      ],
      "properties": {
        "sequence": {
          "type": "string",
          "title": "Input Polypeptide Sequence",
          "minLength": 1,
          "maxLength": 4096,
          "description": "An input polypeptide (i.e., amino acid) sequence that must be composed of valid Amino Acid IUPAC symbols."
        },
        "algorithm": {
          "title": "MSA Algorithm",
          "default": "jackhmmer",
          "description": "The algorithm to use for MSA. AlphaFold2 was trained on JackHMMer; MMSeqs2 provides faster inference.",
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "jackhmmer",
                "mmseqs2"
              ]
            },
            {
              "type": "null"
            }
          ]
        },
        "bit_score": {
          "title": "MSA BitScore",
          "anyOf": [
            {
              "type": "number"
            },
            {
              "type": "null"
            }
          ]
        },
        "databases": {
          "title": "MSA Databases",
          "default": [
            "uniref90",
            "mgnify",
            "small_bfd"
          ],
          "description": "Databases used for Multiple Sequence Alignment. By default, uniref90, mgnify, and small_bfd are used.Choice of databases(s) can significantly impact downstream structure prediction, so we recommend modifying carefully.",
          "anyOf": [
            {
              "type": "array",
              "minItems": 1,
              "maxItems": 3,
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "e_value": {
          "title": "MSA e-value.",
          "default": 0.0001,
          "description": "The e-value used for filtering hits when building the Multiple Sequence Alignment.",
          "anyOf": [
            {
              "type": "number"
            },
            {
              "type": "null"
            }
          ]
        },
        "iterations": {
          "title": "MSA Iterations",
          "default": 1,
          "description": "The number of MSA iterations to perform.",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "relax_prediction": {
          "title": "Relax Prediction",
          "default": true,
          "description": "Run structural relaxation after prediction",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "structure_model_preset": {
          "title": "Structural Prediction Model Preset",
          "default": "monomer",
          "description": "The AlphaFold2 structural prediction model to use for inference.",
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "monomer",
                "casp14",
                "monomer_ptm"
              ]
            },
            {
              "type": "null"
            }
          ]
        },
        "structure_models_to_relax": {
          "title": "Models to relax",
          "default": "all",
          "description": "Which structural prediction to relax with AMBER. Default: relax all models",
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "all",
                "best",
                "none"
              ]
            },
            {
              "type": "null"
            }
          ]
        },
        "num_predictions_per_model": {
          "title": "Number of Predictions per Model",
          "default": 1,
          "description": "Determines the number of times the trunk of the network is run with different random MSA cluster centers.",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "selected_models": {
          "title": "Selected models for structure prediction.",
          "default": [
            1,
            2,
            3,
            4,
            5
          ],
          "description": "Allows selecting the parameters used for protein structure prediction.",
          "anyOf": [
            {
              "type": "array",
              "minItems": 1,
              "maxItems": 5,
              "items": {
                "type": "integer"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "max_msa_sequences": {
          "title": "Maximum MSA Sequences",
          "default": 4000,
          "description": "The maximum sequences taken from the MSA for model prediction.",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "skip_template_search": {
          "title": "Skip Template Search",
          "default": false,
          "description": "Do NOT template search using HHSearch or HMMSearch. [False]",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "override_msa_db_limits": {
          "title": "Override MSA Database Limits",
          "default": false,
          "description": "Removes the default limits for maximum MSA sequences cutoff for the Uniref90 (10,000 sequences) and Mgnify databases (501 sequences).",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "template_searcher": {
          "title": "Template Search Program",
          "default": "hhsearch",
          "description": "The template searcher to use for templating. hmmsearch should be used for multimer; most other queries should rely on hhsearch.",
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "hhsearch",
                "hmmsearch"
              ]
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "deepmind/alphafold2-multimer",
    "displayName": "deepmind / alphafold2-multimer",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/protein-structure/alphafold2/multimer/predict-structure-from-sequences",
    "documentation": "https://docs.api.nvidia.com/nim/reference/deepmind-alphafold2-multimer-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:04.000Z",
    "purpose": "Predict Structure From Sequence Post",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "biology",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "AlphaFold2MultimerSeqsToStructInputs",
      "required": [
        "sequences"
      ],
      "properties": {
        "sequences": {
          "type": "array",
          "title": "Input Polypeptide Sequence",
          "minItems": 1,
          "maxItems": 6,
          "description": "An input polypeptide (i.e., amino acid) sequence that must be composed of valid Amino Acid IUPAC symbols.",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 4096
          }
        },
        "algorithm": {
          "type": "string",
          "title": "MSA Algorithm",
          "default": "jackhmmer",
          "description": "The algorithm to use for MSA. AlphaFold2 was trained on JackHMMer; MMSeqs2 provides faster inference. (MMSeqs2 will be supported in a future version of AlphaFold2 NIM!)",
          "enum": [
            "jackhmmer",
            "mmseqs2"
          ]
        },
        "bit_score": {
          "title": "MSA BitScore",
          "default": null,
          "description": "Sequence Bit Score cutoff for filtering sequences used in seeding the Multiple Sequence Alignment. Bit score must be > 0 or NULL. Note: If this value is unset, e-value is ignored.",
          "anyOf": [
            {
              "type": "number",
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        },
        "databases": {
          "type": "array",
          "title": "MSA Databases",
          "default": [
            "uniref90",
            "mgnfiy",
            "small_bfd"
          ],
          "minItems": 1,
          "maxItems": 3,
          "description": "Databases used for Multiple Sequence Alignment. By default, uniref90, mgnify, and small_bfd are used. Choice of databases(s) can significantly impact downstream structure prediction, so we recommend modifying carefully.",
          "items": {
            "type": "string"
          }
        },
        "e_value": {
          "type": "number",
          "title": "MSA e-value.",
          "default": 0.0001,
          "maximum": 10,
          "exclusiveMinimum": 0,
          "description": "The e-value used for filtering hits when building the Multiple Sequence Alignment. Takes values between 0 < x <= 10."
        },
        "iterations": {
          "type": "integer",
          "title": "MSA Iterations",
          "default": 1,
          "minimum": 1,
          "description": "The number of MSA iterations to perform."
        },
        "relax_prediction": {
          "type": "boolean",
          "title": "Relax Prediction",
          "default": true,
          "description": "Run structural relaxation after prediction"
        },
        "structure_models_to_relax": {
          "type": "string",
          "title": "Models to relax",
          "default": "all",
          "description": "Which structural prediction to relax with AMBER. Default: Relax 'all' models.",
          "enum": [
            "all",
            "best",
            "none"
          ]
        },
        "num_predictions_per_model": {
          "type": "integer",
          "title": "Number of Predictions per Model",
          "default": 1,
          "minimum": 1,
          "maximum": 8,
          "description": "Determines the number of times the trunk of the network is run with different random MSA cluster centers."
        },
        "max_msa_sequences": {
          "title": "Maximum MSA Sequences",
          "default": null,
          "description": "The maximum sequences taken from the MSA for model prediction.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 100000
            },
            {
              "type": "null"
            }
          ]
        },
        "template_searcher": {
          "type": "string",
          "title": "Template Search Program",
          "default": "hhsearch",
          "description": "The template searcher to use for templating. hmmsearch should be used for multimer; most other queries should rely on hhsearch.",
          "enum": [
            "hhsearch",
            "hmmsearch"
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "deepseek-ai/deepseek-v4-flash",
    "displayName": "deepseek-ai / deepseek-v4-flash",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/deepseek-ai-deepseek-v4-flash-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:16.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "deepseek-ai/deepseek-v4-flash"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 16384,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "reasoning_effort": {
          "title": "Reasoning Effort",
          "default": "high",
          "description": "Controls DeepSeek V4 Flash's reasoning mode. `none` disables thinking, `high` enables high reasoning mode, and `max` enables maximum reasoning effort. Snippets translate this field into the model's `chat_template_kwargs`.",
          "enum": [
            "none",
            "high",
            "max"
          ]
        },
        "seed": {
          "title": "Seed",
          "default": null,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "deepseek-ai/deepseek-v4-flash-0731",
    "displayName": "deepseek-ai / deepseek-v4-flash-0731",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/deepseek-ai-deepseek-v4-flash-0731-infer",
    "documentationUpdatedAt": "2026-08-21T15:50:44.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "deepseek-ai/deepseek-v4-flash-0731"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 16384,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "reasoning_effort": {
          "title": "Reasoning Effort",
          "default": "high",
          "description": "Controls DeepSeek V4 Flash's reasoning mode. `none` disables thinking, `high` enables high reasoning mode, and `max` enables maximum reasoning effort. Snippets translate this field into the model's `chat_template_kwargs`.",
          "enum": [
            "none",
            "high",
            "max"
          ]
        },
        "seed": {
          "title": "Seed",
          "default": null,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "deepseek-ai/deepseek-v4-pro",
    "displayName": "deepseek-ai / deepseek-v4-pro",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/deepseek-ai-deepseek-v4-pro-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:17.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "deepseek-ai/deepseek-v4-pro"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 8192,
          "minimum": 1,
          "maximum": 16384,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "reasoning_effort": {
          "title": "Reasoning Effort",
          "default": "high",
          "description": "Controls DeepSeek V4 Pro's reasoning mode. `none` disables thinking, `high` enables high reasoning mode, and `max` enables maximum reasoning effort. Snippets translate this field into the model's `chat_template_kwargs`.",
          "enum": [
            "none",
            "high",
            "max"
          ]
        },
        "seed": {
          "title": "Seed",
          "default": null,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "deepseek-ai/deepseek-v4-pro-0813",
    "displayName": "deepseek-ai / deepseek-v4-pro-0813",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/deepseek-ai-deepseek-v4-pro-0813-infer",
    "documentationUpdatedAt": "2026-08-27T12:52:10.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "deepseek-ai/deepseek-v4-pro-0813"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 16384,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "reasoning_effort": {
          "title": "Reasoning Effort",
          "default": "none",
          "description": "Controls DeepSeek V4 Pro's reasoning mode. `none` disables thinking, `high` enables high reasoning mode, and `max` enables maximum reasoning effort. Snippets translate this field into the model's `chat_template_kwargs`.",
          "enum": [
            "none",
            "high",
            "max"
          ]
        },
        "seed": {
          "title": "Seed",
          "default": null,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "google/codegemma-7b",
    "displayName": "google / codegemma-7b",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/google-codegemma-7b-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:18.000Z",
    "purpose": "Create a chat completion",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatCompletionRequest",
      "description": "OpenAI ChatCompletionRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "google/codegemma-7b"
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.5,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 1,
          "minimum": 0,
          "maximum": 1,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "description": "The model generates random results. Changing the input seed alone will produce a different response with similar characteristics. It is possible to reproduce results by fixing the input seed (assuming all other hyperparameters are also fixed)."
        },
        "messages": {
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": true
  },
  {
    "id": "google/diffusiongemma-26b-a4b-it",
    "displayName": "google / diffusiongemma-26b-a4b-it",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/diffusiongemma-26b-a4b-it-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:50.000Z",
    "purpose": "Request response from the model",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "user",
                      "assistant"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br> - Videos are passed with `type`=`video_url`; set `video_url.url` to a video URL or a base64 data URI like `data:video/{format};base64,{base64encodedvideo}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartVideo",
                          "required": [
                            "type",
                            "video_url"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "google/diffusiongemma-26b-a4b-it",
          "description": "The model to use."
        },
        "chat_template_kwargs": {
          "type": "object",
          "title": "Chat Template Kwargs",
          "default": {
            "enable_thinking": true
          },
          "description": "Additional keyword arguments to pass to the chat template. Use {\"enable_thinking\": true} to enable reasoning or {\"enable_thinking\": false} to disable it.",
          "properties": {
            "enable_thinking": {
              "type": "boolean",
              "default": true,
              "description": "Enable or disable the model's thinking/reasoning mode."
            }
          }
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 4096,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 32768
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 1,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 0.95,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "google/gemma-3-27b-it",
    "displayName": "google / gemma-3-27b-it",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/google-gemma-3-27b-it-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:51.000Z",
    "purpose": "Answer a question about image content (google/gemma-3-27b-it)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-understanding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "google/gemma-3-27b-it",
          "description": "The model to use."
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 512,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 4096
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stop": {
          "title": "Stop",
          "description": "Sequences where the API will stop generating further tokens.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 0.2,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 0.7,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "google/gemma-3n-e4b-it",
    "displayName": "google / gemma-3n-e4b-it",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/google-gemma-3n-e4b-it-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:53.000Z",
    "purpose": "Answer a question about image content (google/gemma-3n-e4b-it)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-understanding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br> - Audio is passed with `type`=`audio_url` or `type`=`input_audio`; set `audio_url.url` to an audio URL or a base64 data URI, or set `input_audio.data` to base64 audio data. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMLLMChatCompletionContentPartAudio",
                          "required": [
                            "audio_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMLLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMLLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "google/gemma-3n-e4b-it",
          "description": "The model to use."
        },
        "frequency_penalty": {
          "title": "Frequency Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 512,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 8192
            },
            {
              "type": "null"
            }
          ]
        },
        "presence_penalty": {
          "title": "Presence Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stop": {
          "title": "Stop",
          "description": "Sequences where the API will stop generating further tokens.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 0.2,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 0.7,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "google/gemma-4-31b-it",
    "displayName": "google / gemma-4-31b-it",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/google-gemma-4-31b-it-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:55.000Z",
    "purpose": "Answer a question about image content (google/gemma-4-31b-it)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-understanding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "user",
                      "assistant"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br> - Videos are passed with `type`=`video_url`; set `video_url.url` to a video URL or a base64 data URI like `data:video/{format};base64,{base64encodedvideo}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartVideo",
                          "required": [
                            "type",
                            "video_url"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "google/gemma-4-31b-it",
          "description": "The model to use."
        },
        "chat_template_kwargs": {
          "type": "object",
          "title": "Chat Template Kwargs",
          "default": {
            "enable_thinking": true
          },
          "description": "Additional keyword arguments to pass to the chat template. Use {\"enable_thinking\": true} to enable reasoning or {\"enable_thinking\": false} to disable it.",
          "properties": {
            "enable_thinking": {
              "type": "boolean",
              "default": true,
              "description": "Enable or disable the model's thinking/reasoning mode."
            }
          }
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 16384,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 32768
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 1,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 0.95,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "google/gemma-7b",
    "displayName": "google / gemma-7b",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/google-gemma-7b-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:19.000Z",
    "purpose": "Create a chat completion",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatCompletionRequest",
      "description": "OpenAI ChatCompletionRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "google/gemma-7b"
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.3,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 1,
          "minimum": 0,
          "maximum": 1,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "seed": {
          "type": "null",
          "title": "Seed",
          "default": 0,
          "description": "The model generates random results. Changing the input seed alone will produce a different response with similar characteristics. It is possible to reproduce results by fixing the input seed (assuming all other hyperparameters are also fixed)."
        },
        "messages": {
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": true
  },
  {
    "id": "google/paligemma",
    "displayName": "google / paligemma",
    "category": "multimodal-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/vlm/google/paligemma",
    "documentation": "https://docs.api.nvidia.com/nim/reference/google-paligemma-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:43.000Z",
    "purpose": "Answer a question about image content (google/paligemma)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-understanding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "maxItems": 1,
          "description": "A list of messages comprising the conversation. For the PaLIGemma task only single message with `user` role and single image is supported.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "default": null,
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "UserTextContent",
                          "required": [
                            "type",
                            "text"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "UserImageContent",
                          "required": [
                            "type",
                            "image_url"
                          ]
                        }
                      ]
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.2,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "maximum": 1024,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "hive/ai-generated-image-detection",
    "displayName": "hive / ai-generated-image-detection",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/cv/hive/ai-generated-image-detection",
    "documentation": "https://docs.api.nvidia.com/nim/reference/hive-ai-generated-image-detection-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:56.000Z",
    "purpose": "Analyze or classify an image (hive/ai-generated-image-detection)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-analysis",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ImageRequest",
      "required": [
        "input"
      ],
      "properties": {
        "input": {
          "type": "array",
          "title": "Input",
          "minItems": 1,
          "maxItems": 1,
          "description": "The list of images to be checked by the AI generated image detector. Each image should be in form of `data:image/{format};base64,{base64encodedimage}` if it's smaller than 200KB. Otherwise, it needs to be uploaded to a presigned S3 bucket using NVCF Asset APIs.Once uploaded you can refer to it using the following format: `data:image/png;asset_id,{asset_id}`.Only a single image input is supported.Accepted formats are `jpg`, `png` and `jpeg`.",
          "items": {
            "type": "string"
          }
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "hive/deepfake-image-detection",
    "displayName": "hive / deepfake-image-detection",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/cv/hive/deepfake-image-detection",
    "documentation": "https://docs.api.nvidia.com/nim/reference/hive-deepfake-image-detection-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:58.000Z",
    "purpose": "Analyze or classify an image (hive/deepfake-image-detection)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-analysis",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ImageRequest",
      "required": [
        "input"
      ],
      "properties": {
        "input": {
          "type": "array",
          "title": "Input",
          "minItems": 1,
          "maxItems": 1,
          "description": "The list of images to be checked by the AI generated image detector. Each image should be in form of `data:image/{format};base64,{base64encodedimage}` if it's smaller than 200KB. Otherwise, it needs to be uploaded to a presigned S3 bucket using NVCF Asset APIs.Once uploaded you can refer to it using the following format: `data:image/png;asset_id,{asset_id}`.Only a single image input is supported.Accepted formats are `jpg`, `png` and `jpeg`.",
          "items": {
            "type": "string"
          }
        },
        "return_image": {
          "type": "boolean",
          "title": "Return Image",
          "default": false,
          "description": "If True uses returns an image with bounding boxes"
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "ipd/proteinmpnn",
    "displayName": "ipd / proteinmpnn",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/biology/ipd/proteinmpnn/predict",
    "documentation": "https://docs.api.nvidia.com/nim/reference/ipd-proteinmpnn-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:05.000Z",
    "purpose": "Predict amino acid sequences",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "biology",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ProteinMPNNInputs",
      "properties": {
        "input_pdb": {
          "title": "Input protein content (or file name if assets are used)",
          "description": "Input protein for which amino acid sequences need to be predicted",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "input_pdb_asset": {
          "title": "Input protein asset",
          "description": "Optional pre-uploaded NVCF Asset ID. If using this field, original file name should be provided via input_pdb argument.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "input_pdb_chains": {
          "title": "Chains from input_pdb that are selected for design task",
          "description": "The model will design amino acid sequences for the given chains in the input protein. If not specified, default is to design for all chains in the protein.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "ca_only": {
          "title": "CA-Only (alpha carbons) model enable flag",
          "default": false,
          "description": "CA-only model helps to address specific needs in protein design where focusing on the alpha carbon (CA) atoms can be advantageous",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "use_soluble_model": {
          "title": "Soluble model enable flag",
          "default": false,
          "description": "ProteinMPNN offers both soluble and non-soluble models to cater to the specific needs of different protein design tasks. Soluble models are better suited for applications requiring high solubility, such as biotechnological processes, pharmaceutical development, and biochemical assays. Non-soluble models are advantageous for membrane protein studies, structural biology, and certain industrial applications where solubility is less critical or where proteins need to function in hydrophobic environments. This flexibility allows researchers to choose the appropriate model based on the specific requ",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "random_seed": {
          "title": "Random Seed",
          "description": "The model allows users to set or not set the random seed based on the specific needs. For example, if reproducibility is crucial, it is recommended to set a fixed seed. However, for tasks requiring exploration and diversity, users might choose not to set the seed, allowing the model to leverage the benefits of randomness.",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "num_seq_per_target": {
          "title": "Number of amino acid sequences to generate [per target protein]",
          "default": 1,
          "description": "This parameter specifies the number of sequences to generate per target protein structure. By setting num_seq_per_target, users can determine how many different sequences the model should predict that will fold into the given protein backbone structure.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            },
            {
              "type": "null"
            }
          ]
        },
        "sampling_temp": {
          "title": "Sampling temperatures",
          "description": "The units for sampling temperatures in ProteinMPNN are dimensionless and range from 0 to 1. This parameter is used to adjust the probability values for the 20 amino acids at each position in the sequence, thereby controlling the diversity of the design outcomes. Higher values lead to increased diversity in the designed results, while lower values result in less diversity and more conservative designs. Recommended range is from 0.1 to 0.3.",
          "anyOf": [
            {
              "type": "array",
              "minItems": 1,
              "maxItems": 100,
              "items": {
                "type": "number",
                "maximum": 1,
                "exclusiveMinimum": 0
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "pssm_jsonl": {
          "title": "Position-Specific Scoring Matrix (PSSM)",
          "description": "PSSM in the context of ProteinMPNN is a tool that incorporates evolutionary information into the protein design process. It helps guide mutations and enhance prediction accuracy by leveraging the conservation patterns observed in homologous protein sequences. This makes the designed proteins more likely to be stable and functional, improving the overall success of the design process. Note: The top-level key will always be overridden to 'input'; users do not need to supply a file name as the key.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "pssm_multi": {
          "title": "Position-Specific Scoring Matrix (PSSM) multiplication factor",
          "default": 0,
          "description": "This parameter is used to adjust the influence of PSSMs on the protein sequence design process, allowing users to balance between evolutionary data and the model's predictions to achieve desired design outcomes. A value of 0.0 means that the PSSM is not used at all, and the design relies entirely on the ProteinMPNN model's predictions. A value of 1.0 means that the design process completely ignores the ProteinMPNN model's predictions and relies solely on the PSSM. Intermediate values allow for a blend of both the PSSM and the model's predictions.",
          "anyOf": [
            {
              "type": "number"
            },
            {
              "type": "null"
            }
          ]
        },
        "pssm_threshold": {
          "title": "Position-Specific Scoring Matrix (PSSM) threshold",
          "default": 0,
          "description": "Parameter can take any value between negative infinity and positive infinity. A higher threshold value will be more restrictive, allowing only amino acids with PSSM scores above the threshold to be included in the design. A lower threshold value will be less restrictive, allowing more amino acids to be considered. Setting the threshold to a very low value (for example, negative infinity) effectively means that all amino acids are allowed, while a very high value (for example, positive infinity) could exclude all amino acids.",
          "anyOf": [
            {
              "type": "number"
            },
            {
              "type": "null"
            }
          ]
        },
        "pssm_bias_flag": {
          "title": "Position-Specific Scoring Matrix (PSSM) bias enable flag",
          "default": false,
          "description": "This is parameter determines whether to apply a bias based on a Position-Specific Scoring Matrix (PSSM) during the protein sequence design process.",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "pssm_log_odds_flag": {
          "title": "Position-Specific Scoring Matrix (PSSM) log-odds enable flag",
          "default": false,
          "description": "This parameter controls whether the PSSM values are transformed into log-odds scores. Log-odds scores are a common way to represent the likelihood of observing a particular amino acid at a given position relative to a background distribution. This transformation can make the PSSM values more interpretable and useful for guiding the design process",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "fixed_positions_jsonl": {
          "title": "Fixed Position Residues",
          "description": "This parameter allows to control which residues in the protein sequence remain unchanged during the design process, providing users with the ability to enforce specific constraints based on experimental or functional requirements. Note: fixed positions are indexed starting from 1, and relative to new sequence. Note: The top-level key will always be overridden to 'input'; users do not need to supply a file name as the key.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "omit_AAs": {
          "title": "Amino acids to omit globally",
          "description": "This parameter allows to control which amino acids in the protein sequence should be excluded. Amino acids are specified as one-letter FASTA representations.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "omit_AA_jsonl": {
          "title": "Amino acids to omit at specific locations",
          "description": "This parameter allows to exclude specific amino acids from the designed protein sequences at designated chain indices, providing users with greater control over the properties and functionality of the generated proteins. Example: '{\"input\": {\"A\": [[[1], \"V\"]]}}', would omit valine in chain A at first AA position (indexing starts from 1.) Note: The top-level key will always be overridden to 'input'; users do not need to supply a file name as the key.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "bias_AA_jsonl": {
          "title": "Amino Acid biases",
          "description": "By providing a bias dictionary, users can fine-tune the amino acid composition of the designed sequences. This can help in achieving specific design goals, such as avoiding certain amino acids that might lead to undesirable properties or promoting amino acids that enhance the desired characteristics of the protein. Dictionary is specified as a JSON object, for example, {\"A\": -1.1, \"F\": 0.7} would result in alanine amino acid less likely to appear in the designed protein and phenylalanine more likely. Note: The top-level key will always be overridden to 'input'; users do not need to supply a fi",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "bias_by_res_jsonl": {
          "title": "Amino Acid position-specific biases",
          "description": "By providing a position-specific bias dictionary, users can fine-tune the amino acid composition of the designed sequences at specific residue positions. This can help in achieving specific design goals, such as promoting amino acids that enhance the desired characteristics of the protein at particular sites or avoiding amino acids that might lead to undesirable properties. Note: The top-level key will always be overridden to 'input'; users do not need to supply a file name as the key.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "tied_positions_jsonl": {
          "title": "Tied positions",
          "description": "By providing a dictionary of tied positions, users can ensure that specific residues are identical across different positions or chains. This is particularly important for designing proteins with internal repeats, cyclic symmetries, or multi-chain assemblies where certain residues must be the same to maintain the desired structure and function. Note: The top-level key will always be overridden to 'input'; users do not need to supply a file name as the key.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "ipd/rfdiffusion",
    "displayName": "ipd / rfdiffusion",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/biology/ipd/rfdiffusion/generate",
    "documentation": "https://docs.api.nvidia.com/nim/reference/ipd-rfdiffusion-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:06.000Z",
    "purpose": "Run RFdiffusion Protein Generation",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "biology",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "RFdiffusionInputs",
      "required": [
        "contigs"
      ],
      "properties": {
        "input_pdb": {
          "title": "Input protein content or file name",
          "description": "This is an input PDB (Protein Data Bank) file: protein chains and amino acids from this file are used to select binder target and motifs.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "input_pdb_asset": {
          "title": "Input protein asset",
          "description": "Optional pre-uploaded NVCF Asset ID. If using this field, original file name should be provided via input_pdb argument.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "contigs": {
          "type": "string",
          "title": "Contiguous Regions",
          "description": "Historically, contigs stands for 'contiguous [protein regions]'. This string defines a protein that is being generated. It is a specification written in a domain-specific language that tells RFdiffusion which part of the input protein are to be kept and what kind of a binder (or a scaffold) needs to be constructed. As an example, a string 'A10-100/0 50-150' instructs RFdiffusion to keep amino acids 10-100 in Chain A [from the input PDB file], then break the chain (special '/0' notation, which signifies the end of the chain and thus effectively makes 'A10-100' a new target protein), and constru"
        },
        "hotspot_res": {
          "title": "Hotspot Residues",
          "description": "The hotspot residues string provides a way to specify which region the new protein (binder) must contact with the original input protein (a target), therefore we can guide a binder to a specific region. In UI, the format of the string is a comma-separated list of amino acids present in the input PDB file, e.g. 'A50,A51,A52' specifies three hotspot residues in the Chain A, at positions 50, 51 and 52. Note that in API, however, the amino acids are specified as a list of strings, e.g. ['A50', 'A51', ...].",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "diffusion_steps": {
          "title": "Number of diffusion steps",
          "default": 50,
          "description": "RFdiffusion is a diffusion generative model, it was trained by diffusing (adding noise) to a training data set. The generative process works by reversing the time steps (i.e. denoising): starting from randomly placed atoms, and reverse-diffusing the positions to arrive at a probable atom positions. The diffusion steps parameter tells RFdiffusion how many steps it will run the denoising process for. 1 is the minimum, 50 is the default.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 50
            },
            {
              "type": "null"
            }
          ]
        },
        "random_seed": {
          "title": "Random Seed",
          "description": "RFdiffusion is a generative model, its function is to generate novel and diverse proteins. Setting random seed allows to turn RFdiffusion into a deterministic model, where an input protein, a task and a fixed seed would always produce the same output. This argument is useful for development purposes, but otherwise should be unset.",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "meta/llama-3.1-70b-instruct",
    "displayName": "meta / llama-3.1-70b-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/meta-llama-3_1-70b-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:22.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "meta/llama-3.1-70b-instruct"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant",
                  "tool"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_call_id": {
                "title": "Tool Call Id",
                "description": "The id of the tool call.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_calls": {
                "title": "Tool Calls",
                "description": "The tool(s) called by the model.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "title": "ToolCall",
                      "required": [
                        "function"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "title": "Id"
                        },
                        "type": {
                          "type": "string",
                          "title": "Type",
                          "default": "function",
                          "enum": [
                            "function"
                          ]
                        },
                        "function": {
                          "type": "object",
                          "title": "FunctionCall",
                          "required": [
                            "name",
                            "arguments"
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.2,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "tools": {
          "title": "Tools",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "ChatCompletionToolsParam",
                "required": [
                  "function"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "default": "function",
                    "enum": [
                      "function"
                    ]
                  },
                  "function": {
                    "type": "object",
                    "title": "FunctionDefinition",
                    "required": [
                      "name"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "title": "Name"
                      },
                      "description": {
                        "title": "Description",
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "parameters": {
                        "title": "Parameters",
                        "anyOf": [
                          {
                            "type": "object"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "tool_choice": {
          "title": "Tool Choice",
          "description": "Controls which (if any) tool is called by the model.",
          "anyOf": [
            {
              "type": "object",
              "title": "ChatCompletionNamedToolChoiceParam",
              "required": [
                "function"
              ],
              "properties": {
                "function": {
                  "type": "object",
                  "title": "ChatCompletionNamedFunction",
                  "required": [
                    "name"
                  ],
                  "properties": {
                    "name": {
                      "title": "Name",
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    }
                  },
                  "additionalProperties": false
                },
                "type": {
                  "type": "string",
                  "title": "Type",
                  "default": "function",
                  "enum": [
                    "function"
                  ]
                }
              },
              "additionalProperties": false
            },
            {
              "type": "string",
              "enum": [
                "none",
                "auto",
                "required"
              ]
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "meta/llama-3.1-8b-instruct",
    "displayName": "meta / llama-3.1-8b-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/meta-llama-3_1-8b-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:21.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "meta/llama-3.1-8b-instruct"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant",
                  "tool"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_call_id": {
                "title": "Tool Call Id",
                "description": "The id of the tool call.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_calls": {
                "title": "Tool Calls",
                "description": "The tool(s) called by the model.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "title": "ToolCall",
                      "required": [
                        "function"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "title": "Id"
                        },
                        "type": {
                          "type": "string",
                          "title": "Type",
                          "default": "function",
                          "enum": [
                            "function"
                          ]
                        },
                        "function": {
                          "type": "object",
                          "title": "FunctionCall",
                          "required": [
                            "name",
                            "arguments"
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.2,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "tools": {
          "title": "Tools",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "ChatCompletionToolsParam",
                "required": [
                  "function"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "default": "function",
                    "enum": [
                      "function"
                    ]
                  },
                  "function": {
                    "type": "object",
                    "title": "FunctionDefinition",
                    "required": [
                      "name"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "title": "Name"
                      },
                      "description": {
                        "title": "Description",
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "parameters": {
                        "title": "Parameters",
                        "anyOf": [
                          {
                            "type": "object"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "tool_choice": {
          "title": "Tool Choice",
          "description": "Controls which (if any) tool is called by the model.",
          "anyOf": [
            {
              "type": "object",
              "title": "ChatCompletionNamedToolChoiceParam",
              "required": [
                "function"
              ],
              "properties": {
                "function": {
                  "type": "object",
                  "title": "ChatCompletionNamedFunction",
                  "required": [
                    "name"
                  ],
                  "properties": {
                    "name": {
                      "title": "Name",
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    }
                  },
                  "additionalProperties": false
                },
                "type": {
                  "type": "string",
                  "title": "Type",
                  "default": "function",
                  "enum": [
                    "function"
                  ]
                }
              },
              "additionalProperties": false
            },
            {
              "type": "string",
              "enum": [
                "none",
                "auto",
                "required"
              ]
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "meta/llama-3.2-11b-vision-instruct",
    "displayName": "meta / llama-3.2-11b-vision-instruct",
    "category": "multimodal-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/meta/llama-3.2-11b-vision-instruct",
    "documentation": "https://docs.api.nvidia.com/nim/reference/meta-llama-3_2-11b-vision-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:45.000Z",
    "purpose": "Answer a question about image content (meta/llama-3.2-11b-vision-instruct)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-understanding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "meta/llama-3.2-11b-vision-instruct",
          "description": "The model to use."
        },
        "frequency_penalty": {
          "title": "Frequency Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 512,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 8192
            },
            {
              "type": "null"
            }
          ]
        },
        "presence_penalty": {
          "title": "Presence Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stop": {
          "title": "Stop",
          "description": "Sequences where the API will stop generating further tokens.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 1,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 1,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "meta/llama-3.2-1b-instruct",
    "displayName": "meta / llama-3.2-1b-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/meta-llama-3_2-1b-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:24.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "meta/llama-3.2-1b-instruct"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.2,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "meta/llama-3.2-3b-instruct",
    "displayName": "meta / llama-3.2-3b-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/meta-llama-3_2-3b-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:25.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "meta/llama-3.2-3b-instruct"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.2,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "meta/llama-3.2-90b-vision-instruct",
    "displayName": "meta / llama-3.2-90b-vision-instruct",
    "category": "multimodal-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/meta/llama-3.2-90b-vision-instruct",
    "documentation": "https://docs.api.nvidia.com/nim/reference/meta-llama-3_2-90b-vision-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:47.000Z",
    "purpose": "Answer a question about image content (meta/llama-3.2-90b-vision-instruct)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-understanding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "meta/llama-3.2-90b-vision-instruct",
          "description": "The model to use."
        },
        "frequency_penalty": {
          "title": "Frequency Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 512,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 8192
            },
            {
              "type": "null"
            }
          ]
        },
        "presence_penalty": {
          "title": "Presence Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stop": {
          "title": "Stop",
          "description": "Sequences where the API will stop generating further tokens.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 1,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 1,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "meta/llama-3.3-70b-instruct",
    "displayName": "meta / llama-3.3-70b-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/meta-llama-3_3-70b-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:26.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "meta/llama-3.3-70b-instruct"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant",
                  "tool"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_call_id": {
                "title": "Tool Call Id",
                "description": "The id of the tool call.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_calls": {
                "title": "Tool Calls",
                "description": "The tool(s) called by the model.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "title": "ToolCall",
                      "required": [
                        "function"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "title": "Id"
                        },
                        "type": {
                          "type": "string",
                          "title": "Type",
                          "default": "function",
                          "enum": [
                            "function"
                          ]
                        },
                        "function": {
                          "type": "object",
                          "title": "FunctionCall",
                          "required": [
                            "name",
                            "arguments"
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.2,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "tools": {
          "title": "Tools",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "ChatCompletionToolsParam",
                "required": [
                  "function"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "default": "function",
                    "enum": [
                      "function"
                    ]
                  },
                  "function": {
                    "type": "object",
                    "title": "FunctionDefinition",
                    "required": [
                      "name"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "title": "Name"
                      },
                      "description": {
                        "title": "Description",
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "parameters": {
                        "title": "Parameters",
                        "anyOf": [
                          {
                            "type": "object"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "meta/llama-guard-4-12b",
    "displayName": "meta / llama-guard-4-12b",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/meta-llama-guard-4-12b-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:59.000Z",
    "purpose": "Classify content against the model’s safety policy (meta/llama-guard-4-12b)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "content-safety",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "meta/llama-guard-4-12b",
          "description": "The model to use."
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 5,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 30
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 0.2,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 0.7,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "meta/llama2-70b",
    "displayName": "meta / llama2-70b",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/meta-llama2-70b-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:20.000Z",
    "purpose": "Create a chat completion",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatCompletionRequest",
      "description": "OpenAI ChatCompletionRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "meta/llama2-70b"
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 1,
          "minimum": 0,
          "maximum": 1,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "seed": {
          "type": "null",
          "title": "Seed",
          "default": 0,
          "description": "The model generates random results. Changing the input seed alone will produce a different response with similar characteristics. It is possible to reproduce results by fixing the input seed (assuming all other hyperparameters are also fixed)."
        },
        "messages": {
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": true
  },
  {
    "id": "meta/muse-glimmer-30b",
    "displayName": "meta / muse-glimmer-30b",
    "category": "multimodal-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/meta-muse-glimmer-30b-infer",
    "documentationUpdatedAt": "2026-08-10T16:54:28.000Z",
    "purpose": "Creates a model response for the given chat",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "meta/muse-glimmer-30b"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant",
                  "tool"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "ContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "ContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_call_id": {
                "title": "Tool Call Id",
                "description": "The id of the tool call.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_calls": {
                "title": "Tool Calls",
                "description": "The tool(s) called by the model.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "title": "ToolCall",
                      "required": [
                        "function"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "title": "Id"
                        },
                        "type": {
                          "type": "string",
                          "title": "Type",
                          "default": "function",
                          "enum": [
                            "function"
                          ]
                        },
                        "function": {
                          "type": "object",
                          "title": "FunctionCall",
                          "required": [
                            "name",
                            "arguments"
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "reasoning_content": {
                "title": "Reasoning Content",
                "description": "The model's chain-of-thought, returned on its own channel rather than mixed into `content` (non-OpenAI extension). Streamed as `delta.reasoning_content`.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.95,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. Muse Glimmer is a reasoning model and expects to be sampled rather than decoded greedily - the recommended pair is temperature 0.95 with top_p 1.0. Greedy decoding measurably degrades it."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "tools": {
          "title": "Tools",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "ChatCompletionToolsParam",
                "required": [
                  "function"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "default": "function",
                    "enum": [
                      "function"
                    ]
                  },
                  "function": {
                    "type": "object",
                    "title": "FunctionDefinition",
                    "required": [
                      "name"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "title": "Name"
                      },
                      "description": {
                        "title": "Description",
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "parameters": {
                        "title": "Parameters",
                        "anyOf": [
                          {
                            "type": "object"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 2048,
          "minimum": 1,
          "maximum": 131072,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified. Reasoning shares this budget, so leave headroom on reasoning-heavy prompts."
        },
        "seed": {
          "title": "Seed",
          "default": null,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "tool_choice": {
          "title": "Tool Choice",
          "default": "auto",
          "description": "Controls which (if any) tool the model calls. `none` disables tool calling; `auto` lets the model choose.",
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "none",
                "auto"
              ]
            },
            {
              "type": "object",
              "title": "ChatCompletionNamedToolChoiceParam",
              "required": [
                "function"
              ],
              "properties": {
                "function": {
                  "type": "object",
                  "title": "ChatCompletionNamedFunction",
                  "required": [
                    "name"
                  ],
                  "properties": {
                    "name": {
                      "title": "Name",
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    }
                  },
                  "additionalProperties": false
                },
                "type": {
                  "type": "string",
                  "title": "Type",
                  "default": "function",
                  "enum": [
                    "function"
                  ]
                }
              },
              "additionalProperties": false
            },
            {
              "type": "null"
            }
          ]
        },
        "stop": {
          "title": "Stop",
          "description": "A string or list of strings where the API stops generating further tokens. The returned text does not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Penalises new tokens by their existing frequency in the text so far, reducing verbatim repetition."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalise tokens that have already appeared, encouraging the model to move on to new topics."
        },
        "reasoning_effort": {
          "type": "string",
          "title": "Reasoning Effort",
          "default": "high",
          "description": "How much reasoning the model should do before answering. Higher values generally produce a longer trace in `reasoning_content`, which shares the `max_tokens` budget with the answer.",
          "enum": [
            "none",
            "minimal",
            "low",
            "medium",
            "high",
            "max"
          ]
        },
        "chat_template_kwargs": {
          "type": "object",
          "title": "Chat Template Kwargs",
          "description": "Extra keyword arguments forwarded to the model's chat template, e.g. `{\"reasoning_strength\": \"low\"}`."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "microsoft/phi-4-mini-flash-reasoning",
    "displayName": "microsoft / phi-4-mini-flash-reasoning",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/microsoft-phi-4-mini-flash-reasoning-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:28.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "microsoft/phi-4-mini-flash-reasoning"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.6,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 8192,
          "minimum": 1,
          "maximum": 16384,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "microsoft/phi-4-mini-instruct",
    "displayName": "microsoft / phi-4-mini-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/microsoft-phi-4-mini-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:27.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "microsoft/phi-4-mini-instruct"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant",
                  "tool"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_call_id": {
                "title": "Tool Call Id",
                "description": "The id of the tool call.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_calls": {
                "title": "Tool Calls",
                "description": "The tool(s) called by the model.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "title": "ToolCall",
                      "required": [
                        "function"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "title": "Id"
                        },
                        "type": {
                          "type": "string",
                          "title": "Type",
                          "default": "function",
                          "enum": [
                            "function"
                          ]
                        },
                        "function": {
                          "type": "object",
                          "title": "FunctionCall",
                          "required": [
                            "name",
                            "arguments"
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.1,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "tools": {
          "title": "Tools",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "ChatCompletionToolsParam",
                "required": [
                  "function"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "default": "function",
                    "enum": [
                      "function"
                    ]
                  },
                  "function": {
                    "type": "object",
                    "title": "FunctionDefinition",
                    "required": [
                      "name"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "title": "Name"
                      },
                      "description": {
                        "title": "Description",
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "parameters": {
                        "title": "Parameters",
                        "anyOf": [
                          {
                            "type": "object"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "microsoft/phi-4-multimodal-instruct",
    "displayName": "microsoft / phi-4-multimodal-instruct",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/microsoft/phi-4-multimodal-instruct",
    "documentation": "https://docs.api.nvidia.com/nim/reference/microsoft-phi-4-multimodal-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:01.000Z",
    "purpose": "Answer a question about image content (microsoft/phi-4-multimodal-instruct)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-understanding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass images or audios (only with role=`user`): <br>- When content is a string, image or audio can be passed together with the text with HTML-style tags that wraps an image or audio URL (`<img src=\"{url}\" />` or `<audio src=\"{url}\" />`), base64 encoded image or audio data (`<img src=\"data:image/{format};base64,{base64encodedimage}\" />` or `<audio src=\"data:audio/{format};base64,{base64encodedaudio}\" />`), or an NVCF asset ID (`<img src=\"data:image/{format};asset_id,{asset_id}\" />` or `<audio src=\"data:audio/{format};asset_id,{asset_id}\" />`) when the containe",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMLLMChatCompletionContentPartAudio",
                          "required": [
                            "audio_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMLLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMLLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "microsoft/phi-4-multimodal-instruct",
          "description": "The model to use."
        },
        "frequency_penalty": {
          "title": "Frequency Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 512,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 8192
            },
            {
              "type": "null"
            }
          ]
        },
        "presence_penalty": {
          "title": "Presence Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stop": {
          "title": "Stop",
          "description": "Sequences where the API will stop generating further tokens.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 0.1,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 0.7,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "microsoft/trellis",
    "displayName": "microsoft / trellis",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/genai/microsoft/trellis",
    "documentation": "https://docs.api.nvidia.com/nim/reference/microsoft-trellis-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:03.000Z",
    "purpose": "Generate a 3D asset from text or an image (microsoft/trellis)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "3d-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "Object3DRequest",
      "properties": {
        "mode": {
          "type": "string",
          "title": "Mode",
          "description": "NIM inference mode. If image is selected an input image is required. If text if selected an input prompt. If mode is not specified the mode would be determined based on the image and prompt inputs",
          "enum": [
            "text",
            "image"
          ]
        },
        "prompt": {
          "type": "string",
          "title": "Prompt",
          "maxLength": 77,
          "description": "What you wish to see in the output 3D model. A strong, descriptive prompt that clearly defines elements, colors, and subjects will lead to better results."
        },
        "image": {
          "type": [
            "string",
            "null"
          ],
          "title": "Image",
          "description": "An image input to generate the 3D model from. Preview API NIM supports only a predefined set of images. The image should be in form of `data:image/png;example_id,{example_id}` with example_id in a range [0,3]."
        },
        "no_texture": {
          "type": "boolean",
          "title": "No Texture",
          "default": false,
          "description": "If True skips the texture baking stage at the end of model generation pipeline"
        },
        "output_format": {
          "type": "string",
          "title": "Output Format",
          "default": "glb",
          "description": "The output format to use. If `stl` format is selected `no_texture` parameter would be ignored",
          "enum": [
            "glb",
            "stl"
          ]
        },
        "samples": {
          "type": "integer",
          "title": "Samples",
          "default": 1,
          "minimum": 1,
          "maximum": 1,
          "description": "Number of 3D Objects to generate. Only samples=1 is supported"
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "minimum": 0,
          "exclusiveMaximum": 4294967296,
          "description": "The seed which governs generation. Changing the seed with other inputs fixed results in different outputs. (Omit this option or use 0 for a random seed)"
        },
        "slat_cfg_scale": {
          "title": "Latent Cfg Scale",
          "default": 3,
          "description": "How strictly the diffusion process adheres to the input text or image in the structured latent diffusion",
          "anyOf": [
            {
              "type": "number",
              "maximum": 10,
              "exclusiveMinimum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "ss_cfg_scale": {
          "title": "Sparse Structure Cfg Scale",
          "default": 7.5,
          "description": "How strictly the diffusion process adheres to the input text or image in the sparse structure diffusion",
          "anyOf": [
            {
              "type": "number",
              "maximum": 10,
              "exclusiveMinimum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "slat_sampling_steps": {
          "title": "Latent Sampling Steps",
          "default": 25,
          "description": "Number of structured latent diffusion steps to run.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 10,
              "maximum": 50
            },
            {
              "type": "null"
            }
          ]
        },
        "ss_sampling_steps": {
          "title": "Sparse Structure Sampling Steps",
          "default": 25,
          "description": "Number of sparse structure diffusion steps to run.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 10,
              "maximum": 50
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "minimaxai/minimax-m3",
    "displayName": "minimaxai / minimax-m3",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/minimaxai-minimax-m3-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:04.000Z",
    "purpose": "Create a model response",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "minimaxai/minimax-m3"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "user",
                  "assistant",
                  "tool"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. A string, or (for multimodal user messages) a list of content parts: text plus image_url/video_url (each a public URL or a base64 data URI).",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "oneOf": [
                        {
                          "type": "object",
                          "title": "ContentPartText",
                          "required": [
                            "type",
                            "text"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "ContentPartImage",
                          "required": [
                            "type",
                            "image_url"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "ContentPartVideo",
                          "required": [
                            "type",
                            "video_url"
                          ]
                        }
                      ]
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "reasoning_content": {
                "title": "Reasoning Content",
                "description": "Reasoning/thinking trace emitted by the model in responses when thinking mode is active (non-OpenAI extension).",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_calls": {
                "title": "Tool Calls",
                "description": "Tool calls generated by the model (present on assistant responses with finish_reason=tool_calls).",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "title": "ToolCall",
                      "required": [
                        "id",
                        "type",
                        "function"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "title": "Id"
                        },
                        "type": {
                          "type": "string",
                          "title": "Type",
                          "enum": [
                            "function"
                          ]
                        },
                        "function": {
                          "type": "object",
                          "title": "ToolCallFunction",
                          "required": [
                            "name",
                            "arguments"
                          ]
                        }
                      }
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_call_id": {
                "title": "Tool Call Id",
                "description": "For messages with role=tool, the id of the tool call this message responds to.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 8192,
          "minimum": 1,
          "maximum": 16384,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "seed": {
          "title": "Seed",
          "description": "Optional seed for best-effort deterministic sampling.",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "chat_template_kwargs": {
          "title": "Chat Template Kwargs",
          "description": "Optional kwargs forwarded to the model chat template. For MiniMax-M3 this controls reasoning: {\"thinking_mode\": \"enabled\"} (think), {\"thinking_mode\": \"disabled\"} (no-think), or {\"thinking_mode\": \"adaptive\"}.",
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ]
        },
        "tools": {
          "title": "Tools",
          "description": "Optional OpenAI-compatible tool (function) definitions for tool calling.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "ChatCompletionTool",
                "required": [
                  "type",
                  "function"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "enum": [
                      "function"
                    ]
                  },
                  "function": {
                    "type": "object",
                    "title": "ChatCompletionFunction",
                    "required": [
                      "name"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "title": "Name",
                        "description": "Function name."
                      },
                      "description": {
                        "type": "string",
                        "title": "Description",
                        "description": "Function description."
                      },
                      "parameters": {
                        "type": "object",
                        "title": "ChatCompletionFunctionParameters",
                        "description": "JSON Schema object describing the function arguments.",
                        "additionalProperties": true
                      }
                    }
                  }
                }
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "tool_choice": {
          "title": "Tool Choice",
          "description": "Controls tool selection: none, auto, required, or a named function.",
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "none",
                "auto",
                "required"
              ]
            },
            {
              "type": "object",
              "title": "ChatCompletionNamedToolChoice",
              "required": [
                "type",
                "function"
              ],
              "properties": {
                "type": {
                  "type": "string",
                  "title": "Type",
                  "enum": [
                    "function"
                  ]
                },
                "function": {
                  "type": "object",
                  "required": [
                    "name"
                  ],
                  "properties": {
                    "name": {
                      "type": "string",
                      "title": "Name"
                    }
                  }
                }
              }
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "mistralai/ministral-14b-instruct-2512",
    "displayName": "mistralai / ministral-14b-instruct-2512",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/mistralai/ministral-14b-instruct-2512",
    "documentation": "https://docs.api.nvidia.com/nim/reference/mistralai-ministral-14b-instruct-2512-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:06.000Z",
    "purpose": "Answer a question about image content (mistralai/ministral-14b-instruct-2512)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-understanding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "mistralai/ministral-14b-instruct-2512",
          "description": "The model to use."
        },
        "frequency_penalty": {
          "title": "Frequency Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 2048,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 8192
            },
            {
              "type": "null"
            }
          ]
        },
        "presence_penalty": {
          "title": "Presence Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stop": {
          "title": "Stop",
          "description": "Sequences where the API will stop generating further tokens.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 0.15,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 1,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "mistralai/mistral-large-3-675b-instruct-2512",
    "displayName": "mistralai / mistral-large-3-675b-instruct-2512",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/mistralai/mistral-large-3-675b-instruct-2512",
    "documentation": "https://docs.api.nvidia.com/nim/reference/mistralai-mistral-large-3-675b-instruct-2512-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:08.000Z",
    "purpose": "Answer a question about image content (mistralai/mistral-large-3-675b-instruct-2512)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-understanding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "mistralai/mistral-large-3-675b-instruct-2512",
          "description": "The model to use."
        },
        "frequency_penalty": {
          "title": "Frequency Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 2048,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 8192
            },
            {
              "type": "null"
            }
          ]
        },
        "presence_penalty": {
          "title": "Presence Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stop": {
          "title": "Stop",
          "description": "Sequences where the API will stop generating further tokens.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 0.15,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 1,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "mistralai/mistral-medium-3.5-128b",
    "displayName": "mistralai / mistral-medium-3.5-128b",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/mistralai-mistral-medium-3-5-128b-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:10.000Z",
    "purpose": "Request response from the model",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "default": "user",
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "user",
                      "assistant"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "mistralai/mistral-medium-3.5-128b",
          "description": "The model to use."
        },
        "reasoning_effort": {
          "title": "Reasoning Effort",
          "default": "high",
          "description": "Controls reasoning effort. `high` enables full reasoning and `none` disables it.",
          "enum": [
            "none",
            "high"
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 16384,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 32768
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 0.7,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 1,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "mistralai/mistral-nemotron",
    "displayName": "mistralai / mistral-nemotron",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/mistralai-mistral-nemotron-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:32.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "mistralai/mistral-nemotron"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.6,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 4096,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "mistralai/mistral-small-4-119b-2603",
    "displayName": "mistralai / mistral-small-4-119b-2603",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/mistralai-mistral-small-4-119b-2603-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:11.000Z",
    "purpose": "Request response from the model",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "mistralai/mistral-small-4-119b-2603",
          "description": "The model to use."
        },
        "reasoning_effort": {
          "title": "Reasoning Effort",
          "default": "high",
          "description": "Controls reasoning effort. `high` enables full reasoning and `none` disables it.",
          "enum": [
            "none",
            "high"
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 16384,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 32768
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 0.1,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 1,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "mistralai/mixtral-8x22b-instruct-v0.1",
    "displayName": "mistralai / mixtral-8x22b-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/mistralai-mixtral-8x22b-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:34.000Z",
    "purpose": "Create a chat completion",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatCompletionRequest",
      "description": "OpenAI ChatCompletionRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "mistralai/mixtral-8x22b-instruct-v0.1"
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.5,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 1,
          "minimum": 0,
          "maximum": 1,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "description": "The model generates random results. Changing the input seed alone will produce a different response with similar characteristics. It is possible to reproduce results by fixing the input seed (assuming all other hyperparameters are also fixed)."
        },
        "messages": {
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": true
  },
  {
    "id": "mistralai/mixtral-8x7b-instruct-v0.1",
    "displayName": "mistralai / mixtral-8x7b-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/mistralai-mixtral-8x7b-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:33.000Z",
    "purpose": "Create a chat completion",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatCompletionRequest",
      "description": "OpenAI ChatCompletionRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "mistralai/mixtral-8x7b-instruct-v0.1"
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.3,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 1,
          "minimum": 0,
          "maximum": 1,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "seed": {
          "type": "null",
          "title": "Seed",
          "default": 0,
          "description": "The model generates random results. Changing the input seed alone will produce a different response with similar characteristics. It is possible to reproduce results by fixing the input seed (assuming all other hyperparameters are also fixed)."
        },
        "messages": {
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": true
  },
  {
    "id": "mit/boltz2",
    "displayName": "mit / boltz2",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/biology/mit/boltz2/predict",
    "documentation": "https://docs.api.nvidia.com/nim/reference/mit-boltz2-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:10.000Z",
    "purpose": "Post Mit Boltz Predict",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "biology",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "BoltzPredictionRequest",
      "required": [
        "polymers"
      ],
      "properties": {
        "polymers": {
          "type": "array",
          "title": "Polymers",
          "minItems": 1,
          "maxItems": 12,
          "description": "A list of polymers (DNA, RNA, or Protein). Maximum 12 polymers allowed.",
          "items": {
            "type": "object",
            "title": "Polymer",
            "required": [
              "molecule_type",
              "sequence"
            ],
            "properties": {
              "id": {
                "title": "Id",
                "description": "Unique identifier for the polymer chain. Can be either a single letter (A-Z) or a PDB-style ID (4 alphanumeric characters)",
                "anyOf": [
                  {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 4
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "molecule_type": {
                "type": "string",
                "title": "Molecule Type",
                "description": "DNA, RNA, or Protein",
                "enum": [
                  "dna",
                  "rna",
                  "protein"
                ]
              },
              "sequence": {
                "type": "string",
                "title": "Sequence",
                "minLength": 1,
                "maxLength": 4096,
                "description": "The amino acid, DNA, or RNA sequence. For proteins, use standard single-letter amino acid codes. For DNA, use A/T/C/G. For RNA, use A/U/C/G."
              },
              "cyclic": {
                "title": "Cyclic",
                "default": false,
                "description": "Whether the polymer forms a cyclic structure",
                "anyOf": [
                  {
                    "type": "boolean"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "msa": {
                "title": "Msa",
                "description": "A Dictionary [database_name -> [format -> AlignmentFileRecord]] containing alignments",
                "anyOf": [
                  {
                    "type": "object",
                    "additionalProperties": {
                      "type": "object",
                      "additionalProperties": {
                        "type": "object",
                        "title": "AlignmentFileRecord",
                        "description": "Represents a single alignment. This is just the raw file output read into a string and of a defined version.",
                        "required": [
                          "alignment",
                          "format"
                        ]
                      }
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "modifications": {
                "title": "Modifications",
                "default": [],
                "description": "Modifications to the sequence at a specific residue.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "title": "Modification",
                      "description": "Represents a chemical modification to a polymer chain.",
                      "required": [
                        "ccd",
                        "position"
                      ],
                      "properties": {
                        "ccd": {
                          "type": "string",
                          "title": "Ccd",
                          "minLength": 1,
                          "maxLength": 5,
                          "description": "The Chemical Component Dictionary (CCD) ID of the modification"
                        },
                        "position": {
                          "type": "integer",
                          "title": "Position",
                          "exclusiveMinimum": 0,
                          "description": "The 1-based index of the residue to modify"
                        }
                      }
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "ligands": {
          "title": "Ligands",
          "default": [],
          "description": "A list of Ligands. Maximum 20 ligands allowed.",
          "anyOf": [
            {
              "type": "array",
              "minItems": 0,
              "maxItems": 20,
              "items": {
                "type": "object",
                "title": "Ligand",
                "properties": {
                  "id": {
                    "title": "Id",
                    "description": "A chain ID for the ligand",
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "ccd": {
                    "title": "Ccd",
                    "description": "Chemical Component Dictionary (CCD) code for the ligand",
                    "anyOf": [
                      {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 5
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "smiles": {
                    "title": "Smiles",
                    "description": "SMILES string representation of the ligand",
                    "anyOf": [
                      {
                        "type": "string",
                        "minLength": 1
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "predict_affinity": {
                    "title": "Predict Affinity",
                    "default": false,
                    "description": "Run affinity prediction for this ligand. Note: currently, affinity prediction can only be run for one ligand per request.",
                    "anyOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                }
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "constraints": {
          "title": "Constraints",
          "default": [],
          "description": "Optional constraints for the prediction",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "anyOf": [
                  {
                    "type": "object",
                    "title": "Pocket",
                    "required": [
                      "binder",
                      "contacts"
                    ],
                    "properties": {
                      "constraint_type": {
                        "type": "string",
                        "title": "Constraint Type",
                        "default": "pocket",
                        "description": "Specifies this is a pocket constraint"
                      },
                      "binder": {
                        "type": "string",
                        "title": "Binder",
                        "description": "The ID of the binding ligand molecule"
                      },
                      "contacts": {
                        "type": "array",
                        "title": "Contacts",
                        "description": "List of contacts defining the pocket",
                        "items": {
                          "type": "object",
                          "title": "Contact",
                          "required": [
                            "residue_index"
                          ]
                        }
                      }
                    }
                  },
                  {
                    "type": "object",
                    "title": "Bond",
                    "required": [
                      "atoms"
                    ],
                    "properties": {
                      "constraint_type": {
                        "type": "string",
                        "title": "Constraint Type",
                        "default": "bond",
                        "description": "Specifies this is a bond constraint"
                      },
                      "atoms": {
                        "type": "array",
                        "title": "Atoms",
                        "description": "List of atoms involved in the bond",
                        "items": {
                          "type": "object",
                          "title": "Atom",
                          "required": [
                            "residue_index",
                            "atom_name"
                          ]
                        }
                      }
                    }
                  }
                ]
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "recycling_steps": {
          "title": "Recycling Steps",
          "default": 3,
          "description": "This parameter controls the number of times the models output is fed back into the network for further refinement. Increasing the number of recycling steps can lead to a more accurate and refined final structure prediction as the model has more opportunities to converge on an optimal solution. However, each recycling step increases the overall computation time. Recommended for: Difficult or large protein complexes where initial predictions may need iterative improvement. Tip: For faster, preliminary assessments, a lower number of recycling steps can be used. For final, high-quality predictions",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "sampling_steps": {
          "title": "Sampling Steps",
          "default": 50,
          "description": "This setting determines the number of discrete steps the diffusion model takes to generate the 3D structure from an initial noisy state. In each step, the model removes a certain amount of noise to progressively build a coherent and accurate molecular structure. Higher values: Generally result in a more detailed and higher-quality structure, but at the cost of longer processing times. Lower values: Lead to faster generation but may produce a less refined or lower-quality output. A sufficient number of sampling steps is crucial for the diffusion process to effectively denoise and generate a val",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "diffusion_samples": {
          "title": "Diffusion Samples",
          "default": 1,
          "description": "This parameter specifies the total number of independent structures the model will generate. Each sample is created from a different random initial noise distribution, leading to a potential diversity of final predictions. Generating multiple samples is useful for exploring different possible conformations of a structure and assessing the model's confidence and consistency.",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "step_scale": {
          "title": "Step Scale",
          "default": 1.638,
          "description": "This parameter adjusts the magnitude of change applied at each sampling step during the diffusion process. It influences the aggressiveness of the denoising at each iteration. Larger scale: The model takes larger steps in refining the structure. This can speed up convergence but risks overshooting optimal atomic placements, potentially leading to a less accurate or even distorted final structure. Smaller scale: The model takes more cautious, smaller steps. This can lead to a more precise and stable refinement process, but may require more sampling steps to reach a high-quality result.This para",
          "anyOf": [
            {
              "type": "number"
            },
            {
              "type": "null"
            }
          ]
        },
        "without_potentials": {
          "title": "Run Without Potentials",
          "default": false,
          "description": "Return the results without potentials.",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "output_format": {
          "title": "Output Format",
          "default": "mmcif",
          "description": "The output format of the returned structure.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "concatenate_msas": {
          "title": "Concatenate MSAs",
          "default": false,
          "description": "Concatenate Multiple Sequence Alignments for a polymer into one alignment.",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "sampling_steps_affinity": {
          "title": "Affinity Sampling Steps",
          "default": 200,
          "description": "The number of sampling steps to use for affinity prediction. Higher values may improve accuracy but increase runtime.",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "diffusion_samples_affinity": {
          "title": "Affinity Diffusion Samples",
          "default": 5,
          "description": "The number of diffusion samples to use for affinity prediction. Higher values may improve reliability but increase runtime.",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "affinity_mw_correction": {
          "title": "Affinity MW Correction",
          "default": false,
          "description": "Whether to add the Molecular Weight correction to the affinity value head.",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "mit/diffdock",
    "displayName": "mit / diffdock",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/molecular-docking/diffdock/generate",
    "documentation": "https://docs.api.nvidia.com/nim/reference/mit-diffdock-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:11.000Z",
    "purpose": "Predict molecular docking",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "molecular-modeling",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "MolecularDockingRequest",
      "properties": {
        "protein": {
          "title": "Protein",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "ligand": {
          "title": "Ligand",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "ligand_file_type": {
          "anyOf": [
            {
              "type": "string",
              "title": "LigandFormat",
              "enum": [
                "mol2",
                "sdf",
                "txt"
              ]
            },
            {
              "type": "null"
            }
          ]
        },
        "num_poses": {
          "title": "Number of Poses to Generate",
          "default": 10,
          "anyOf": [
            {
              "type": "integer",
              "maximum": 100,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        },
        "time_divisions": {
          "title": "Number of Time Divisions",
          "default": 20,
          "anyOf": [
            {
              "type": "integer",
              "maximum": 20,
              "exclusiveMinimum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "steps": {
          "title": "Number of Diffusion Steps",
          "default": 18,
          "anyOf": [
            {
              "type": "integer",
              "maximum": 18,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        },
        "save_trajectory": {
          "title": "Save trajectory?",
          "default": false,
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "skip_gen_conformer": {
          "title": "Skip generation of conformer?",
          "default": false,
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "is_staged": {
          "title": "Is staged?",
          "default": false,
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "moonshotai/kimi-k2-instruct",
    "displayName": "moonshotai / kimi-k2-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k2-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:35.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "moonshotai/kimi-k2-instruct"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant",
                  "tool"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_call_id": {
                "title": "Tool Call Id",
                "description": "The id of the tool call.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_calls": {
                "title": "Tool Calls",
                "description": "The tool(s) called by the model.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "title": "ToolCall",
                      "required": [
                        "function"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "title": "Id"
                        },
                        "type": {
                          "type": "string",
                          "title": "Type",
                          "default": "function",
                          "enum": [
                            "function"
                          ]
                        },
                        "function": {
                          "type": "object",
                          "title": "FunctionCall",
                          "required": [
                            "name",
                            "arguments"
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.6,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.9,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "tools": {
          "title": "Tools",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "ChatCompletionToolsParam",
                "required": [
                  "function"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "default": "function",
                    "enum": [
                      "function"
                    ]
                  },
                  "function": {
                    "type": "object",
                    "title": "FunctionDefinition",
                    "required": [
                      "name"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "title": "Name"
                      },
                      "description": {
                        "title": "Description",
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "parameters": {
                        "title": "Parameters",
                        "anyOf": [
                          {
                            "type": "object"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 4096,
          "minimum": 1,
          "maximum": 16384,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "moonshotai/kimi-k2-thinking",
    "displayName": "moonshotai / kimi-k2-thinking",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k2-thinking-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:37.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "moonshotai/kimi-k2-thinking"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant",
                  "tool"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_call_id": {
                "title": "Tool Call Id",
                "description": "The id of the tool call.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_calls": {
                "title": "Tool Calls",
                "description": "The tool(s) called by the model.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "title": "ToolCall",
                      "required": [
                        "function"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "title": "Id"
                        },
                        "type": {
                          "type": "string",
                          "title": "Type",
                          "default": "function",
                          "enum": [
                            "function"
                          ]
                        },
                        "function": {
                          "type": "object",
                          "title": "FunctionCall",
                          "required": [
                            "name",
                            "arguments"
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.9,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "tools": {
          "title": "Tools",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "ChatCompletionToolsParam",
                "required": [
                  "function"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "default": "function",
                    "enum": [
                      "function"
                    ]
                  },
                  "function": {
                    "type": "object",
                    "title": "FunctionDefinition",
                    "required": [
                      "name"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "title": "Name"
                      },
                      "description": {
                        "title": "Description",
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "parameters": {
                        "title": "Parameters",
                        "anyOf": [
                          {
                            "type": "object"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 32768,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "seed": {
          "title": "Seed",
          "default": null,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "moonshotai/kimi-k2.5",
    "displayName": "moonshotai / kimi-k2.5",
    "category": "multimodal-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k2-5-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:48.000Z",
    "purpose": "Request response from the model",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "system",
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass images/videos (only with role=`user`): <br> - When content is a string, images can be passed with `img` HTML tags that wrap an image URL (`<img src=\"{url}\" />`), base64 image data (`<img src=\"data:image/{format};base64,{base64encodedimage}\" />`), or an NVCF asset ID (`<img src=\"data:image/{format};asset_id,{asset_id}\" />`). <br> - When content is a list of objects, images can be passed as objects with type=`image_url`, and videos can be passed as objects with type=`video_url`. <br>For `system` and `assistant` roles, the object list format is not support",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartVideo",
                          "required": [
                            "type",
                            "video_url"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "moonshotai/kimi-k2.5",
          "description": "The model to use."
        },
        "chat_template_kwargs": {
          "title": "Chat Template Kwargs",
          "description": "Optional kwargs forwarded to the model chat template (e.g. {\"thinking\": true} / {\"thinking\": false}).",
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ]
        },
        "tools": {
          "title": "Tools",
          "description": "Optional OpenAI-compatible tool definitions for function calling.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "tool_choice": {
          "title": "Tool Choice",
          "description": "Optional tool selection directive (e.g. \"auto\").",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "title": "Frequency Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 16384,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 32768
            },
            {
              "type": "null"
            }
          ]
        },
        "presence_penalty": {
          "title": "Presence Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stop": {
          "title": "Stop",
          "description": "Sequences where the API will stop generating further tokens.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 1,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 1,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "moonshotai/kimi-k2.6",
    "displayName": "moonshot ai / kimi-k2.6",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k2-6-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:13.000Z",
    "purpose": "Request response from the model",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "system",
                      "assistant",
                      "user",
                      "tool"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br> - Videos are passed with `type`=`video_url`; set `video_url.url` to a video URL or a base64 data URI like `data:video/{format};base64,{base64encodedvideo}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartVideo",
                          "required": [
                            "type",
                            "video_url"
                          ]
                        }
                      ]
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "name": {
                "title": "Name",
                "description": "Optional participant or tool name.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_call_id": {
                "title": "Tool Call Id",
                "description": "Tool call ID that this tool message is responding to.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_calls": {
                "title": "Tool Calls",
                "description": "Tool calls generated by an assistant message.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "reasoning_content": {
                "title": "Reasoning Content",
                "description": "Optional preserved reasoning content from a previous assistant turn.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "moonshotai/kimi-k2.6",
          "description": "The model to use."
        },
        "chat_template_kwargs": {
          "title": "Chat Template Kwargs",
          "description": "Optional kwargs forwarded to the model chat template (e.g. {\"thinking\": true} / {\"thinking\": false}).",
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ]
        },
        "tools": {
          "title": "Tools",
          "description": "Optional OpenAI-compatible tool definitions for function calling.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "ChatCompletionTool",
                "required": [
                  "type",
                  "function"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "default": "function",
                    "enum": [
                      "function"
                    ]
                  },
                  "function": {
                    "type": "object",
                    "title": "ChatCompletionFunction",
                    "required": [
                      "name",
                      "description",
                      "parameters"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "title": "Name",
                        "default": "get_current_weather",
                        "description": "Function name."
                      },
                      "description": {
                        "type": "string",
                        "title": "Description",
                        "default": "Get the current weather in a given location.",
                        "description": "Function description."
                      },
                      "parameters": {
                        "type": "object",
                        "title": "ChatCompletionFunctionParameters",
                        "default": {
                          "type": "object",
                          "properties": {}
                        },
                        "description": "JSON Schema object describing the function arguments.",
                        "additionalProperties": true
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "tool_choice": {
          "title": "Tool Choice",
          "description": "Optional OpenAI-compatible tool choice. Use `auto`, `none`, `required`, or a named-tool choice object.",
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "none",
                "auto",
                "required"
              ]
            },
            {
              "type": "object",
              "title": "ChatCompletionNamedToolChoice",
              "required": [
                "type",
                "function"
              ],
              "properties": {
                "type": {
                  "type": "string",
                  "title": "Type",
                  "default": "function",
                  "enum": [
                    "function"
                  ]
                },
                "function": {
                  "type": "object",
                  "required": [
                    "name"
                  ],
                  "properties": {
                    "name": {
                      "type": "string",
                      "title": "Name",
                      "default": "get_current_weather"
                    }
                  },
                  "additionalProperties": false
                }
              },
              "additionalProperties": false
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 16384,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 65536
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "default": 0,
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "stream_options": {
          "title": "Stream Options",
          "description": "Optional OpenAI-compatible stream options, such as `include_usage`.",
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 1,
          "description": "What sampling temperature to use, between 0 and 1. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 1,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "moonshotai/kimi-k3",
    "displayName": "moonshotai / kimi-k3",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3-infer",
    "documentationUpdatedAt": "2026-08-27T23:18:12.000Z",
    "purpose": "Request response from the model",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "system",
                      "assistant",
                      "user",
                      "tool"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "name": {
                "title": "Name",
                "description": "Optional participant or tool name.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_call_id": {
                "title": "Tool Call Id",
                "description": "Tool call ID that this tool message is responding to.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_calls": {
                "title": "Tool Calls",
                "description": "Tool calls generated by an assistant message.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "reasoning_content": {
                "title": "Reasoning Content",
                "description": "Optional preserved reasoning content from a previous assistant turn.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "moonshotai/kimi-k3",
          "description": "The model to use."
        },
        "tools": {
          "title": "Tools",
          "description": "Optional OpenAI-compatible tool definitions for function calling.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "ChatCompletionTool",
                "required": [
                  "type",
                  "function"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "default": "function",
                    "enum": [
                      "function"
                    ]
                  },
                  "function": {
                    "type": "object",
                    "title": "ChatCompletionFunction",
                    "required": [
                      "name",
                      "description",
                      "parameters"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "title": "Name",
                        "default": "get_current_weather",
                        "description": "Function name."
                      },
                      "description": {
                        "type": "string",
                        "title": "Description",
                        "default": "Get the current weather in a given location.",
                        "description": "Function description."
                      },
                      "parameters": {
                        "type": "object",
                        "title": "ChatCompletionFunctionParameters",
                        "default": {
                          "type": "object",
                          "properties": {}
                        },
                        "description": "JSON Schema object describing the function arguments.",
                        "additionalProperties": true
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 16384,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 65536
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "default": 0,
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9007199254740991,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": true,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "stream_options": {
          "title": "Stream Options",
          "description": "Optional OpenAI-compatible stream options, such as `include_usage`.",
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 1,
          "description": "What sampling temperature to use, between 0 and 1. Higher values make the output more random; lower values make it more focused and deterministic. Recommended for Kimi-K3: 1.0. Note: the other sampling parameters (top_p, presence_penalty, frequency_penalty, n) are fixed by the model and are not exposed.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "reasoning_effort": {
          "title": "Reasoning Effort",
          "default": "max",
          "description": "Controls how long the model reasons before answering: `low`, `high`, or `max`. Per-request override of the serve-time default; unset falls back to the model default (`max`).",
          "enum": [
            "low",
            "high",
            "max"
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/corrdiff",
    "displayName": "nvidia / corrdiff",
    "category": "climate-simulation-apis",
    "endpoint": "https://climate.api.nvidia.com/v1/infer",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-corrdiff-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:21.000Z",
    "purpose": "Submit an inference configuration",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "weather-simulation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "Inference Request",
      "properties": {
        "input_id": {
          "type": "integer",
          "format": "int32",
          "title": "Input Id",
          "default": 1,
          "minimum": 0,
          "maximum": 16,
          "description": "Index indicating sample input data built into the NIM to use"
        },
        "samples": {
          "type": "integer",
          "format": "int32",
          "title": "Samples",
          "default": 1,
          "minimum": 1,
          "maximum": 4,
          "description": "Number of output samples to generate"
        },
        "steps": {
          "type": "integer",
          "format": "int32",
          "title": "Diffusion steps",
          "default": 16,
          "minimum": 1,
          "maximum": 24,
          "description": "Number of diffusion steps"
        },
        "seed": {
          "type": "integer",
          "format": "int32",
          "title": "Random seed",
          "default": 0,
          "minimum": 0,
          "maximum": 2147483647,
          "description": "Random seed that controls the job reproducibility"
        }
      }
    },
    "responseMediaTypes": [
      "application/octet-stream",
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/cuOpt",
    "displayName": "nvidia / cuOpt",
    "category": "route-optimization-apis",
    "endpoint": "https://optimize.api.nvidia.com/v1/nvidia/cuopt",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-cuopt-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:19.000Z",
    "purpose": "Submit to solver",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "route-optimization",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "cuoptData",
      "required": [
        "data"
      ],
      "properties": {
        "action": {
          "title": "Action",
          "default": "cuOpt_OptimizedRouting",
          "description": "Action to be performed by the service, validator action just validates input against format and base rules.",
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "cuOpt_OptimizedRouting",
                "cuOpt_RoutingValidator",
                0
              ]
            },
            {
              "type": "null"
            }
          ]
        },
        "data": {
          "title": "Data",
          "description": "The data that needs to be processed by the service. For detailed explanations of each field, please consult the following link: <a href=\"https://docs.nvidia.com/cuopt/service/latest/data-requirements.html\">data requirements</a> . To ensure best practices, please refer to: <a href=\"https://docs.nvidia.com/cuopt/service/latest/best-practices.html\">best practices</a>. For examples, you can find them at: <a href=\"https://github.com/NVIDIA/cuOpt-Resources/tree/branch-23.10/notebooks/routing/service\">notebooks</a>. If the size of the data exceeds 250KB, please utilize the large assets API to upload ",
          "anyOf": [
            {
              "type": "object",
              "title": "OptimizedRoutingData",
              "required": [
                "fleet_data",
                "task_data"
              ],
              "properties": {
                "cost_waypoint_graph_data": {
                  "default": {},
                  "description": "Waypoint graph with weights as cost to travel from A to B and B to A. If there are different types of vehicles they can be provided with key value pair where key is vehicle-type and value is the graph. Value of vehicle type should be within [0, 255]",
                  "anyOf": [
                    {
                      "type": "object",
                      "title": "UpdateWaypointGraphData",
                      "properties": {
                        "waypoint_graph": {
                          "title": "Waypoint Graph",
                          "anyOf": [
                            {
                              "type": "object"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        }
                      },
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "travel_time_waypoint_graph_data": {
                  "default": {},
                  "description": "Waypoint graph with weights as time to travel from A to B and B to A. If there are different types of vehicles they can be provided with key value pair where key is vehicle-type and value is the graph. Value of vehicle type should be within [0, 255]",
                  "anyOf": [
                    {
                      "type": "object",
                      "title": "UpdateWaypointGraphData",
                      "properties": {
                        "waypoint_graph": {
                          "title": "Waypoint Graph",
                          "anyOf": [
                            {
                              "type": "object"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        }
                      },
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "cost_matrix_data": {
                  "default": {},
                  "description": "Sqaure matrix with cost to travel from A to B and B to A. If there are different types of vehicles which have different cost matrices, they can be provided with key value pair where key is vehicle-type and value is cost matrix. Value of vehicle type should be within [0, 255]",
                  "anyOf": [
                    {
                      "type": "object",
                      "title": "UpdateCostMatrices",
                      "properties": {
                        "data": {
                          "title": "Data",
                          "description": "dtype : vehicle-type (uint8), cost (float32), cost >= 0. Sqaure matrix with cost to travel from A to B and B to A. If there different types of vehicles which have different cost matrices, they can be provided with key value pair where key is vehicle-type and value is cost matrix. Value of vehicle type should be within [0, 255]",
                          "anyOf": [
                            {
                              "type": "object"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "cost_matrix": {
                          "title": "Cost Matrix",
                          "description": "This field is deprecated, please use the 'data' field instead",
                          "anyOf": [
                            {
                              "type": "object"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        }
                      },
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "travel_time_matrix_data": {
                  "default": {},
                  "description": "Sqaure matrix with time to travel from A to B and B to A. If there are different types of vehicles which have different travel time matrices, they can be provided with key value pair where key is vehicle-type and value is time matrix. Value of vehicle type should be within [0, 255]",
                  "anyOf": [
                    {
                      "type": "object",
                      "title": "UpdateCostMatrices",
                      "properties": {
                        "data": {
                          "title": "Data",
                          "description": "dtype : vehicle-type (uint8), cost (float32), cost >= 0. Sqaure matrix with cost to travel from A to B and B to A. If there different types of vehicles which have different cost matrices, they can be provided with key value pair where key is vehicle-type and value is cost matrix. Value of vehicle type should be within [0, 255]",
                          "anyOf": [
                            {
                              "type": "object"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "cost_matrix": {
                          "title": "Cost Matrix",
                          "description": "This field is deprecated, please use the 'data' field instead",
                          "anyOf": [
                            {
                              "type": "object"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        }
                      },
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "fleet_data": {
                  "description": "All Fleet information",
                  "allOf": [
                    {
                      "type": "object",
                      "title": "FleetData",
                      "required": [
                        "vehicle_locations"
                      ],
                      "properties": {
                        "vehicle_locations": {
                          "type": "array",
                          "title": "Vehicle Locations",
                          "description": "dtype: int32, vehicle_location >= 0. Start and end location of the vehicles in the given set of locations in WayPointGraph or CostMatrices. Example: For 2 vehicles, [ [veh_1_start_loc, veh_1_end_loc], [veh_2_start_loc, veh_2_end_loc] ]",
                          "items": {
                            "type": "array"
                          }
                        },
                        "vehicle_ids": {
                          "title": "Vehicle Ids",
                          "description": "List of the vehicle ids or names provided as a string.",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "capacities": {
                          "title": "Capacities",
                          "description": "dtype: int32, capacity >= 0. Note: For this release number of capacity dimensions are limited to 3. Lists of capacities of each vehicle. Multiple capacities can be added and each list will represent one kind of capacity. Order of kind of the capacities should match order of the demands. Total capacity for each type should be sufficient to complete all demand of that type.Example: In case of two sets of capacities per vehicle with 3 vehicles, [ [cap_1_veh_1, cap_1_veh_2, cap_1_veh_3], [cap_2_veh_1, cap_2_veh_2, cap_2_veh_3] ]",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "vehicle_time_windows": {
                          "title": "Vehicle Time Windows",
                          "description": "dtype: int32, time >= 0. Earliest and Latest time window pairs for each vehicle, for example the data would look as follows for 2 vehicles, [ [veh_1_earliest, veh_1_latest], [veh_2_earliest, veh_2_latest] ]",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "vehicle_break_time_windows": {
                          "title": "Vehicle Break Time Windows",
                          "description": "dtype: int32, time >= 0. Multiple break time windows can be added for each vehicle.Earliest and Latest break time window pairs for each vehicle, For example, in case of 2 sets of breaks for each vehicle which translates to 2 dimensions of breaks, [ [[brk_1_veh_1_earliest, brk_1_veh_1_latest], [brk_1_veh_2_earliest, brk_1_veh_2_latest]] [[brk_2_veh_1_earliest, brk_2_veh_1_latest], [brk_2_veh_2_earliest, brk_2_veh_2_latest]] ] The break duration within this time window is provided through vehicle_break_durations.",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "vehicle_break_durations": {
                          "title": "Vehicle Break Durations",
                          "description": "dtype: int32, time >= 0. Break duration for each vehicle. vehicle_break_time_windows should be provided to use this option.For example, in case of having 2 breaks for each vehicle, [ [brk_1_veh_1_duration, brk_1_veh_2_duration], [brk_2_veh_1_duration, brk_2_veh_2_duration], ]",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "vehicle_break_locations": {
                          "title": "Vehicle Break Locations",
                          "description": "dtype: int32, location >= 0. Break location where vehicles can take breaks. If not set, any location can be used for the break.",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "vehicle_types": {
                          "title": "Vehicle Types",
                          "description": "dtype: uint8. Types of vehicles in the fleet given as positive integers.",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "vehicle_order_match": {
                          "title": "Vehicle Order Match",
                          "description": "A list of vehicle order match, where the match would contain a vehicle id and a list of orders that vehicle can serve.",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "skip_first_trips": {
                          "title": "Skip First Trips",
                          "description": "Drop the cost of trip to first location for that vehicle.",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "drop_return_trips": {
                          "title": "Drop Return Trips",
                          "description": "Drop cost of return trip for each vehicle.",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "min_vehicles": {
                          "title": "Min Vehicles",
                          "description": "dtype: int32, min_vehicles >= 1. Solution should consider minimum number of vehicles",
                          "anyOf": [
                            {
                              "type": "integer"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "vehicle_max_costs": {
                          "title": "Vehicle Max Costs",
                          "description": "dtype: float32, max_costs >= 0. Maximum cost a vehicle can incur and it is based on cost matrix/cost waypoint graph.",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "vehicle_max_times": {
                          "title": "Vehicle Max Times",
                          "description": "dtype: float32, max_time >= 0. Maximum time a vehicle can operate (includes drive, service and wait time), this is based on travel time matrix/travel time waypoint graph.",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "vehicle_fixed_costs": {
                          "title": "Vehicle Fixed Costs",
                          "description": "dtype: float32, fixed_cost >= 0. Cost of each vehicle.This helps in routing where may be 2 vehicles with less cost is effective compared to 1 vehicle with huge cost. As example shows veh-0 (15) > veh-1 (5) + veh-2 (5)",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  ]
                },
                "task_data": {
                  "description": "All Task information",
                  "allOf": [
                    {
                      "type": "object",
                      "title": "TaskData",
                      "required": [
                        "task_locations"
                      ],
                      "properties": {
                        "task_locations": {
                          "type": "array",
                          "title": "Task Locations",
                          "description": "dtype: int32, location >= 0. Location where the task has been requested.",
                          "items": {
                            "type": "integer"
                          }
                        },
                        "task_ids": {
                          "title": "Task Ids",
                          "description": "List of the task ids or names provided as a string.",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "demand": {
                          "title": "Demand",
                          "description": "dtype: int32 Note: For this release number of demand dimensions are limited to 3. Lists of demands of each tasks. Multiple demands can be added and each list represents one kind of demand. Order of these demands should match the type of vehicle capacities provided.Example: In case of two sets of demands per vehicle with 3 vehicles, [ [dem_1_tsk_1, dem_1_tsk_2, dem_1_tsk_3], [dem_2_tsk_1, dem_2_tsk_2, dem_2_tsk_3] ]",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "pickup_and_delivery_pairs": {
                          "title": "Pickup And Delivery Pairs",
                          "description": "dtype: int32, pairs >= 0. List of Pick-up and delivery index pairs from task locations. In case we have the following pick-up and delivery locations, 2->1, 4->5, 3->4, then task locations would look something like, task_locations = [0, 2, 1, 4, 5, 3, 4] and pick-up and delivery pairs would be index of those locations in task location and would look like [[1, 2], [3, 4], [5, 6]], 1 is pickup index for location 2 and it should be delivered to location 1 which is at index 2.Example schema: [ [pcikup_1_idx_to_task, drop_1_idx_to_task], [pcikup_2_idx_to_task, drop_2_idx_to_task], ]",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "task_time_windows": {
                          "title": "Task Time Windows",
                          "description": "dtype: int32, time >= 0. Earliest and Latest time windows for each tasks. For example the data would look as follows, [ [tsk_1_earliest, tsk_1_latest], [tsk_2_earliest, tsk_2_latest] ]",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "service_times": {
                          "title": "Service Times",
                          "description": "dtype: int32, time >= 0. Service time for each task. Accepts a list of service times for all vehicles. In case of vehicle specific service times, accepts a dict with key as vehicle id and value as list of service times.Example schema: In case all vehicles have same service times, [tsk_1_srv_time, tsk_2_srv_time, tsk_3_srv_time] In case, there are 2 types of vehicle types and each of them have different service times, { type-1: [tsk_1_srv_time, tsk_3_srv_time, tsk_3_srv_time], type-2: [tsk_1_srv_time, tsk_3_srv_time, tsk_3_srv_time] }",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "object"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "prizes": {
                          "title": "Prizes",
                          "description": "dtype: float32, prizes >= 0. List of values which signifies prizes that are collected for fulfilling each task. This can be used effectively in case solution is infeasible and need to drop few tasks to get feasible solution. Solver will prioritize for higher prize tasks",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "order_vehicle_match": {
                          "title": "Order Vehicle Match",
                          "description": "A list of order vehicle match, where the match would contain a order id and a list of vehicle ids that can serve this order.",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "mandatory_task_ids": {
                          "title": "Mandatory Task Ids",
                          "description": "dtype: int32, mandatory_task_id >= 0. Note: This is only effective when used along with drop infeasible option. A list of task ids which are mandatory and solver would fail if these cannot be fulfilled.",
                          "anyOf": [
                            {
                              "type": "array"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  ]
                },
                "solver_config": {
                  "anyOf": [
                    {
                      "type": "object",
                      "title": "UpdateSolverSettingsConfig",
                      "properties": {
                        "time_limit": {
                          "title": "Time Limit",
                          "description": "SolverSettings time limit",
                          "anyOf": [
                            {
                              "type": "number"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "objectives": {
                          "description": "Values provided dictate the linear combination of factors used to evaluate solution quality.Only prize will be negated, all others gets accumulated. That's why sometime you might come across negative value as solution cost.",
                          "anyOf": [
                            {
                              "type": "object",
                              "title": "Objective"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "config_file": {
                          "title": "Config File",
                          "description": "Dump configuration information in a given file as yaml",
                          "anyOf": [
                            {
                              "type": "string"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "verbose_mode": {
                          "title": "Verbose Mode",
                          "default": false,
                          "description": "Displaying internal information during the solver execution.",
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        },
                        "error_logging": {
                          "title": "Error Logging",
                          "default": true,
                          "description": "Displaying constraint error information during the solver execution.",
                          "anyOf": [
                            {
                              "type": "boolean"
                            },
                            {
                              "type": "null"
                            }
                          ]
                        }
                      },
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              },
              "additionalProperties": false
            },
            {
              "type": "null"
            }
          ]
        },
        "parameters": {
          "title": "Parameters",
          "description": "unused/ignored but retained for compatibility",
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ]
        },
        "client_version": {
          "title": "Client Version",
          "default": "",
          "description": "cuOpt client version. Set to 'custom' to skip version check.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/embed-qa-4",
    "displayName": "nvidia / embed-qa-4",
    "category": "retrieval-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/retrieval/nvidia/embeddings",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-embedding-2b-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:19.000Z",
    "purpose": "Create embedding vector",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-embedding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "required": [
        "input",
        "model"
      ],
      "properties": {
        "input": {
          "minLength": 1,
          "maxLength": 4096,
          "description": "Input text to embed. Max length depends on model.",
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "model": {
          "type": "string",
          "description": "ID of the embedding model."
        },
        "input_type": {
          "type": "string",
          "description": "NV-Embed-QA and E5 models operate in `passage` or `query` mode, and thus require the `input_type` parameter. `passage` is used when generating embeddings during indexing. `query` is used when generating embeddings during querying. It is very important to use the correct `input_type`. Failure to do so will result in large drops in retrieval accuracy. As an alternative, it is possible to add the `-query` or `-passage` suffix to the `model` parameter like `NV-Embed-QA-query` and not use the `input_type` field at all for OpenAI API compliance. Please note that the GTE model _does not_ accept the `",
          "enum": [
            "passage",
            "query"
          ]
        },
        "encoding_format": {
          "type": "string",
          "default": "float",
          "description": "The format to return the embeddings in.",
          "enum": [
            "float",
            "base64"
          ]
        },
        "truncate": {
          "type": "string",
          "default": "NONE",
          "description": "Specifies how inputs longer than the maximum token length of the model are handled. Passing `START` discards the start of the input. `END` discards the end of the input. In both cases, input is discarded until the remaining input is exactly the maximum input token length for the model. If `NONE` is selected, when the input exceeds the maximum input token length an error will be returned.",
          "enum": [
            "NONE",
            "START",
            "END"
          ]
        },
        "user": {
          "type": "string",
          "description": "Not implemented, but provided for API compliance. This field is ignored."
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/fourcastnet",
    "displayName": "nvidia / fourcastnet",
    "category": "climate-simulation-apis",
    "endpoint": "https://climate.api.nvidia.com/v1/nvidia/fourcastnet",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-fourcastnet-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:22.000Z",
    "purpose": "Submit an inference configuration",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "weather-simulation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "required": [
        "input_id",
        "variables"
      ],
      "properties": {
        "input_id": {
          "type": "integer",
          "format": "int32",
          "title": "Input ID",
          "minimum": 0,
          "maximum": 3,
          "description": "Index indicating which sample input data built into the NVCF API to use"
        },
        "variables": {
          "type": "string",
          "format": "regex",
          "title": "Output variables",
          "maxLength": 1024,
          "description": "Comma-separated list of variable IDs to plot and return from the model. Present supported options are [w10m,t2m,msl,tcwv,z500]"
        },
        "simulation_length": {
          "type": "integer",
          "format": "int32",
          "title": "Forecast length",
          "default": 4,
          "minimum": 1,
          "maximum": 40,
          "description": "Number of simulation steps to forecast from the initial state. The duration for each step is 6 hours. Defaults to 4 steps."
        },
        "ensemble_size": {
          "type": "integer",
          "format": "int32",
          "title": "Ensemble size",
          "default": 1,
          "minimum": 1,
          "maximum": 4,
          "description": "Number of ensemble members to predict. Defaults to 1 steps."
        },
        "noise_amplitude": {
          "type": "number",
          "format": "float32",
          "title": "Noise amplitude",
          "default": 0,
          "minimum": 0,
          "maximum": 0.1,
          "description": "The perturbation strength or amplitude applied to the initial state of each ensemble member. Defaults to 0."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/x-tar",
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/genmol",
    "displayName": "nvidia / genmol",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/biology/nvidia/genmol/generate",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-genmol-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:12.000Z",
    "purpose": "Molecular Generation",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "molecular-modeling",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "MolecularGenerationRequest",
      "required": [
        "smiles"
      ],
      "properties": {
        "smiles": {
          "type": "string",
          "title": "Molecule Sequence",
          "default": "C124CN3C1.S3(=O)(=O)CC.C4C#N.[*{20-20}]",
          "description": "Molecular SMILES or SAFE sequence with masking segments in the form of \"[*{min_tokens-max_tokens}]\""
        },
        "num_molecules": {
          "type": "integer",
          "title": "Number of Molecules",
          "default": 30,
          "minimum": 1,
          "maximum": 1000,
          "description": "Number of molecules to be generated, which may be larger than the number of returned molecules because invalid molecules are removed."
        },
        "temperature": {
          "type": "float",
          "title": "Temperature Factor",
          "default": 1,
          "minimum": 0.01,
          "maximum": 10,
          "description": "Temperature scaling factor for Softmax sampling"
        },
        "noise": {
          "type": "float",
          "title": "Noise Factor",
          "default": 1,
          "minimum": 0,
          "maximum": 2,
          "description": "Noise factor for top-k sampling"
        },
        "step_size": {
          "type": "integer",
          "title": "Diffusion Step",
          "default": 1,
          "minimum": 1,
          "maximum": 10,
          "description": "Diffusion step size - the number of masking tokens recovered by each inference."
        },
        "scoring": {
          "type": "string",
          "title": "Scoring Method",
          "default": "QED",
          "description": "Type of scores for ranking",
          "enum": [
            "QED",
            "LogP"
          ]
        },
        "unique": {
          "type": "boolean",
          "title": "Unique Molecules",
          "default": false,
          "description": "Return unique molecules only?"
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/gliner-pii",
    "displayName": "nvidia / gliner-pii",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-gliner-pii-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:38.000Z",
    "purpose": "Extract named entities from text using GLiNER PII model",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "information-extraction",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "GLiNERRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/gliner-pii",
          "description": "The GLiNER model to use for entity extraction"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages with the text to analyze. Only the last user message content will be used for entity extraction.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author",
                "enum": [
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "For user messages: the text to analyze for entity extraction. For assistant messages: JSON string containing entity extraction results with fields: total_entities, entities (array of {text, label, start, end, score}), and tagged_text."
              }
            },
            "additionalProperties": false
          }
        },
        "labels": {
          "type": "array",
          "title": "Labels",
          "description": "Entity types to detect. None uses the default PII labels (55 categories including email, phone_number, ssn, first_name, last_name, address, etc.).",
          "items": {
            "type": "string"
          }
        },
        "threshold": {
          "type": "number",
          "title": "Threshold",
          "default": 0.5,
          "minimum": 0,
          "maximum": 1,
          "description": "Confidence threshold for entity detection (0.0 to 1.0). Lower values detect more entities but may include false positives."
        },
        "chunk_length": {
          "type": "integer",
          "title": "Chunk Length",
          "default": 384,
          "minimum": 1,
          "maximum": 2048,
          "description": "Context window size for processing. Longer texts are automatically split into chunks with overlap for complete coverage. Must be greater than overlap."
        },
        "overlap": {
          "type": "integer",
          "title": "Overlap",
          "default": 128,
          "minimum": 0,
          "maximum": 512,
          "description": "Token overlap between chunks to prevent entity clipping. Must be less than chunk_length."
        },
        "flat_ner": {
          "type": "boolean",
          "title": "Flat NER",
          "default": false,
          "description": "When True, prevents overlapping entity spans. When False, may return nested entities (e.g., both \"John Doe\" as a name and \"John\" as first_name)."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/ising-calibration-1.5-31b",
    "displayName": "nvidia / ising-calibration-1.5-31b",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-ising-calibration-1-5-31b-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:17.000Z",
    "purpose": "Answer a question about image content (nvidia/ising-calibration-1.5-31b)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-understanding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass images (only with role=`user`): <br> - When content is a string, image can be passed together with the text with `img` HTML tags that wraps an image URL (`<img src=\"{url}\" />`), base64 encoded image data (`<img src=\"data:image/{format};base64,{base64encodedimage}\" />`), or an NVCF asset ID (`<img src=\"data:image/{format};asset_id,{asset_id}\" />`) when the container is hosted in NVCF and the payload exceeds 200KB. <br> - When content is a list of objects, images can be passed as objects with type=`image_url`. <br> - In both cases, images can be PNG, JPG ",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/ising-calibration-1.5-31b",
          "description": "The model to use."
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 32768,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 32768
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 1,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 0.95,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        },
        "top_k": {
          "title": "Top K",
          "default": 64,
          "description": "The number of highest probability vocabulary tokens to keep for top-k sampling.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/llama-3.1-nemoguard-8b-content-safety",
    "displayName": "nvidia / llama-3.1-nemoguard-8b-content-safety",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_1-nemoguard-8b-content-safety-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:40.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "content-safety",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-3.1-nemoguard-8b-content-safety"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/llama-3.1-nemoguard-8b-topic-control",
    "displayName": "nvidia / llama-3.1-nemoguard-8b-topic-control",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_1-nemoguard-8b-topic-control-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:41.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "content-safety",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatCompletionRequest",
      "description": "OpenAI ChatCompletionRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-3.1-nemoguard-8b-topic-control"
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.5,
          "minimum": 0,
          "maximum": 2,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "ChatMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author."
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            }
          }
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/llama-3.1-nemotron-nano-8b-v1",
    "displayName": "nvidia / llama-3.1-nemotron-nano-8b-v1",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_1-nemotron-nano-8b-v1-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:42.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatCompletionRequest",
      "description": "OpenAI ChatCompletionRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-3.1-nemotron-nano-8b-v1"
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 4096,
          "minimum": 1,
          "maximum": 16384,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.6,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "minimum": 0,
          "maximum": 18446744073709552000,
          "description": "The model generates random results. Changing the input seed alone will produce a different response with similar characteristics. It is possible to reproduce results by fixing the input seed (assuming all other hyperparameters are also fixed)."
        },
        "messages": {
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/llama-3.1-nemotron-safety-guard-8b-v3",
    "displayName": "nvidia / llama-3.1-nemotron-safety-guard-8b-v3",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_1-nemotron-safety-guard-8b-v3-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:43.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-3.1-nemotron-safety-guard-8b-v3"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    "displayName": "nvidia / llama-3.1-nemotron-ultra-253b-v1",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_1-nemotron-ultra-253b-v1-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:44.000Z",
    "purpose": "Create a model response for a given chat",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatCompletionRequest",
      "description": "OpenAI ChatCompletionRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-3.1-nemotron-ultra-253b-v1"
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 4096,
          "minimum": 1,
          "maximum": 16384,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.6,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "minimum": 0,
          "maximum": 18446744073709552000,
          "description": "The model generates random results. Changing the input seed alone will produce a different response with similar characteristics. It is possible to reproduce results by fixing the input seed (assuming all other hyperparameters are also fixed)."
        },
        "messages": {
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1",
    "displayName": "nvidia / llama-3.2-nemoretriever-1b-vlm-embed-v1",
    "category": "retrieval-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/embeddings",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_2-nemoretriever-1b-vlm-embed-v1-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:21.000Z",
    "purpose": "Creates an embedding vector from the input text",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-embedding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "required": [
        "input",
        "model"
      ],
      "properties": {
        "input": {
          "title": "Input",
          "minLength": 1,
          "maxLength": 4096,
          "description": "Input text to embed. Max length is 4096 tokens.",
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1",
          "description": "ID of the embedding model."
        },
        "input_type": {
          "type": "string",
          "title": "Input Type",
          "description": "nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1 operates in `passage` or `query` mode, and thus require the `input_type` parameter. `passage` is used when generating embeddings during indexing. `query` is used when generating embeddings during querying. It is very important to use the correct `input_type`. Failure to do so will result in large drops in retrieval accuracy.",
          "enum": [
            "passage",
            "query"
          ]
        },
        "encoding_format": {
          "type": "string",
          "title": "Encoding Format",
          "default": "float",
          "description": "The format to return the embeddings in.",
          "enum": [
            "float",
            "base64"
          ]
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "NONE",
          "description": "Specifies how inputs longer than the maximum token length of the model are handled. Passing `START` discards the start of the input. `END` discards the end of the input. In both cases, input is discarded until the remaining input is exactly the maximum input token length for the model. If `NONE` is selected, when the input exceeds the maximum input token length an error will be returned.",
          "enum": [
            "NONE",
            "START",
            "END"
          ]
        },
        "user": {
          "type": "string",
          "title": "User",
          "description": "Not implemented, but provided for API compliance. This field is ignored."
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/llama-3.2-nemoretriever-300m-embed-v2",
    "displayName": "nvidia / llama-3.2-nemoretriever-300m-embed-v2",
    "category": "retrieval-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/embeddings",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_2-nemoretriever-300m-embed-v2-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:23.000Z",
    "purpose": "Creates an embedding vector from the input text",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-embedding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "required": [
        "input",
        "model"
      ],
      "properties": {
        "input": {
          "title": "Input",
          "minLength": 1,
          "maxLength": 4096,
          "description": "Input text to embed. Max length is 32k tokens.",
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "model": {
          "type": "string",
          "title": "Model",
          "description": "ID of the embedding model."
        },
        "input_type": {
          "type": "string",
          "title": "Input Type",
          "description": "nvidia/llama-3.2-nemoretriever-300m-embed-v2 operates in `passage` or `query` mode, and thus require the `input_type` parameter. `passage` is used when generating embeddings during indexing. `query` is used when generating embeddings during querying. It is very important to use the correct `input_type`. Failure to do so will result in large drops in retrieval accuracy.",
          "enum": [
            "passage",
            "query"
          ]
        },
        "encoding_format": {
          "type": "string",
          "title": "Encoding Format",
          "default": "float",
          "description": "The format to return the embeddings in.",
          "enum": [
            "float",
            "base64"
          ]
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "NONE",
          "description": "Specifies how inputs longer than the maximum token length of the model are handled. Passing `START` discards the start of the input. `END` discards the end of the input. In both cases, input is discarded until the remaining input is exactly the maximum input token length for the model. If `NONE` is selected, when the input exceeds the maximum input token length an error will be returned.",
          "enum": [
            "NONE",
            "START",
            "END"
          ]
        },
        "user": {
          "type": "string",
          "title": "User",
          "description": "Not implemented, but provided for API compliance. This field is ignored."
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/llama-3.2-nemoretriever-500m-rerank-v2",
    "displayName": "nvidia / llama-3.2-nemoretriever-500m-rerank-v2",
    "category": "retrieval-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/retrieval/nvidia/llama-3_2-nemoretriever-500m-rerank-v2/reranking",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_2-nemoretriever-500m-rerank-v2-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:24.000Z",
    "purpose": "Rank passages by their relation to a query",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "reranking",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "RankRequest",
      "required": [
        "model",
        "query",
        "passages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-3.2-nemoretriever-500m-rerank-v2",
          "description": "The model to use for ranking."
        },
        "query": {
          "type": "object",
          "title": "MultiModalData",
          "required": [
            "text"
          ],
          "properties": {
            "text": {
              "type": "string",
              "title": "Text",
              "minLength": 1,
              "maxLength": 14598366
            }
          }
        },
        "passages": {
          "type": "array",
          "title": "Passages",
          "minItems": 1,
          "maxItems": 1000,
          "description": "The list of passages to rank.",
          "items": {
            "type": "object",
            "title": "MultiModalData",
            "required": [
              "text"
            ],
            "properties": {
              "text": {
                "type": "string",
                "title": "Text",
                "minLength": 1,
                "maxLength": 14598366
              }
            }
          }
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "END",
          "description": "How to truncate the input if it's too long for the model.",
          "enum": [
            "NONE",
            "END"
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/llama-3.2-nv-embedqa-1b-v2",
    "displayName": "nvidia / llama-3.2-nv-embedqa-1b-v2",
    "category": "retrieval-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/embeddings",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_2-nv-embedqa-1b-v2-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:26.000Z",
    "purpose": "Creates an embedding vector from the input text",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-embedding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "required": [
        "input",
        "model"
      ],
      "properties": {
        "input": {
          "title": "Input",
          "minLength": 1,
          "maxLength": 512,
          "description": "Input text to embed. Max length is 512 tokens.",
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-3.2-nv-embedqa-1b-v2",
          "description": "ID of the embedding model."
        },
        "input_type": {
          "type": "string",
          "title": "Input Type",
          "description": "nvidia/llama-3.2-nv-embedqa-1b-v2 operates in `passage` or `query` mode, and thus require the `input_type` parameter. `passage` is used when generating embeddings during indexing. `query` is used when generating embeddings during querying. It is very important to use the correct `input_type`. Failure to do so will result in large drops in retrieval accuracy.",
          "enum": [
            "passage",
            "query"
          ]
        },
        "encoding_format": {
          "type": "string",
          "title": "Encoding Format",
          "default": "float",
          "description": "The format to return the embeddings in.",
          "enum": [
            "float",
            "base64"
          ]
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "NONE",
          "description": "Specifies how inputs longer than the maximum token length of the model are handled. Passing `START` discards the start of the input. `END` discards the end of the input. In both cases, input is discarded until the remaining input is exactly the maximum input token length for the model. If `NONE` is selected, when the input exceeds the maximum input token length an error will be returned.",
          "enum": [
            "NONE",
            "START",
            "END"
          ]
        },
        "user": {
          "type": "string",
          "title": "User",
          "description": "Not implemented, but provided for API compliance. This field is ignored."
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/llama-3.2-nv-rerankqa-1b-v1",
    "displayName": "nvidia / llama-3.2-nv-rerankqa-1b-v1",
    "category": "retrieval-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/retrieval/nvidia/llama-3_2-nv-rerankqa-1b-v1/reranking",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_2-nv-rerankqa-1b-v1-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:27.000Z",
    "purpose": "Rank passages by their relation to a query",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "reranking",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "RankRequest",
      "description": "A request to the rank endpoint.",
      "required": [
        "model",
        "query",
        "passages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-3.2-nv-rerankqa-1b-v1",
          "minLength": 1,
          "maxLength": 128,
          "description": "Model identifier"
        },
        "query": {
          "description": "A text query for ranking the passages",
          "allOf": [
            {
              "type": "object",
              "title": "MultiModalData",
              "description": "A type signifier for multimodal data. Supported data types: text.",
              "required": [
                "text"
              ],
              "properties": {
                "text": {
                  "type": "string",
                  "title": "Text",
                  "minLength": 1,
                  "maxLength": 14598366
                }
              },
              "additionalProperties": false
            }
          ]
        },
        "passages": {
          "type": "array",
          "title": "Passages",
          "minItems": 1,
          "maxItems": 512,
          "description": "Text passages to rank based on the query",
          "items": {
            "type": "object",
            "title": "MultiModalData",
            "description": "A type signifier for multimodal data. Supported data types: text.",
            "required": [
              "text"
            ],
            "properties": {
              "text": {
                "type": "string",
                "title": "Text",
                "minLength": 1,
                "maxLength": 14598366
              }
            },
            "additionalProperties": false
          }
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "NONE",
          "enum": [
            "END",
            "NONE"
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/llama-3.2-nv-rerankqa-1b-v2",
    "displayName": "nvidia / llama-3.2-nv-rerankqa-1b-v2",
    "category": "retrieval-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/retrieval/nvidia/llama-3_2-nv-rerankqa-1b-v2/reranking",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_2-nv-rerankqa-1b-v2-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:29.000Z",
    "purpose": "Rank passages by their relation to a query",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "reranking",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "RankRequest",
      "description": "A request to the rank endpoint.",
      "required": [
        "model",
        "query",
        "passages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-3.2-nv-rerankqa-1b-v2",
          "minLength": 1,
          "maxLength": 128,
          "description": "Model identifier"
        },
        "query": {
          "description": "A text query for ranking the passages",
          "allOf": [
            {
              "type": "object",
              "title": "MultiModalData",
              "description": "A type signifier for multimodal data. Supported data types: text.",
              "required": [
                "text"
              ],
              "properties": {
                "text": {
                  "type": "string",
                  "title": "Text",
                  "minLength": 1,
                  "maxLength": 14598366
                }
              },
              "additionalProperties": false
            }
          ]
        },
        "passages": {
          "type": "array",
          "title": "Passages",
          "minItems": 1,
          "maxItems": 512,
          "description": "Text passages to rank based on the query",
          "items": {
            "type": "object",
            "title": "MultiModalData",
            "description": "A type signifier for multimodal data. Supported data types: text.",
            "required": [
              "text"
            ],
            "properties": {
              "text": {
                "type": "string",
                "title": "Text",
                "minLength": 1,
                "maxLength": 14598366
              }
            },
            "additionalProperties": false
          }
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "NONE",
          "enum": [
            "END",
            "NONE"
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/llama-3.3-nemotron-super-49b-v1",
    "displayName": "nvidia / llama-3.3-nemotron-super-49b-v1",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_3-nemotron-super-49b-v1-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:45.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatCompletionRequest",
      "description": "OpenAI ChatCompletionRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-3.3-nemotron-super-49b-v1"
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 4096,
          "minimum": 1,
          "maximum": 16384,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.6,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "minimum": 0,
          "maximum": 18446744073709552000,
          "description": "The model generates random results. Changing the input seed alone will produce a different response with similar characteristics. It is possible to reproduce results by fixing the input seed (assuming all other hyperparameters are also fixed)."
        },
        "messages": {
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    "displayName": "nvidia / llama-3.3-nemotron-super-49b-v1.5",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_3-nemotron-super-49b-v1_5-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:46.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatCompletionRequest",
      "description": "OpenAI ChatCompletionRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-3.3-nemotron-super-49b-v1.5"
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 65536,
          "minimum": 1,
          "maximum": 65536,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.6,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "minimum": 0,
          "maximum": 18446744073709552000,
          "description": "The model generates random results. Changing the input seed alone will produce a different response with similar characteristics. It is possible to reproduce results by fixing the input seed (assuming all other hyperparameters are also fixed)."
        },
        "messages": {
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/llama-nemotron-embed-1b-v2",
    "displayName": "nvidia / llama-nemotron-embed-1b-v2",
    "category": "retrieval-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/embeddings",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-nemotron-embed-1b-v2-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:30.000Z",
    "purpose": "Creates an embedding vector from the input text",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-embedding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "required": [
        "input",
        "model"
      ],
      "properties": {
        "input": {
          "title": "Input",
          "minLength": 1,
          "maxLength": 4096,
          "description": "Input text to embed. Max length is 32k tokens.",
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "model": {
          "type": "string",
          "title": "Model",
          "description": "ID of the embedding model."
        },
        "input_type": {
          "type": "string",
          "title": "Input Type",
          "description": "nvidia/llama-nemotron-embed-1b-v2 operates in `passage` or `query` mode, and thus require the `input_type` parameter. `passage` is used when generating embeddings during indexing. `query` is used when generating embeddings during querying. It is very important to use the correct `input_type`. Failure to do so will result in large drops in retrieval accuracy.",
          "enum": [
            "passage",
            "query"
          ]
        },
        "encoding_format": {
          "type": "string",
          "title": "Encoding Format",
          "default": "float",
          "description": "The format to return the embeddings in.",
          "enum": [
            "float",
            "base64"
          ]
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "NONE",
          "description": "Specifies how inputs longer than the maximum token length of the model are handled. Passing `START` discards the start of the input. `END` discards the end of the input. In both cases, input is discarded until the remaining input is exactly the maximum input token length for the model. If `NONE` is selected, when the input exceeds the maximum input token length an error will be returned.",
          "enum": [
            "NONE",
            "START",
            "END"
          ]
        },
        "user": {
          "type": "string",
          "title": "User",
          "description": "Not implemented, but provided for API compliance. This field is ignored."
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/llama-nemotron-embed-vl-1b-v2",
    "displayName": "nvidia / llama-nemotron-embed-vl-1b-v2",
    "category": "retrieval-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/embeddings",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-nemotron-embed-vl-1b-v2-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:31.000Z",
    "purpose": "Creates an embedding vector from the input text",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "multimodal-embedding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "required": [
        "input",
        "model"
      ],
      "properties": {
        "input": {
          "title": "Input",
          "minLength": 1,
          "maxLength": 4096,
          "description": "Input text to embed. Max length is 4096 tokens.",
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-nemotron-embed-vl-1b-v2",
          "description": "ID of the embedding model."
        },
        "input_type": {
          "type": "string",
          "title": "Input Type",
          "description": "nvidia/llama-nemotron-embed-vl-1b-v2 operates in `passage` or `query` mode, and thus require the `input_type` parameter. `passage` is used when generating embeddings during indexing. `query` is used when generating embeddings during querying. It is very important to use the correct `input_type`. Failure to do so will result in large drops in retrieval accuracy.",
          "enum": [
            "passage",
            "query"
          ]
        },
        "encoding_format": {
          "type": "string",
          "title": "Encoding Format",
          "default": "float",
          "description": "The format to return the embeddings in.",
          "enum": [
            "float",
            "base64"
          ]
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "NONE",
          "description": "Specifies how inputs longer than the maximum token length of the model are handled. Passing `START` discards the start of the input. `END` discards the end of the input. In both cases, input is discarded until the remaining input is exactly the maximum input token length for the model. If `NONE` is selected, when the input exceeds the maximum input token length an error will be returned.",
          "enum": [
            "NONE",
            "START",
            "END"
          ]
        },
        "user": {
          "type": "string",
          "title": "User",
          "description": "Not implemented, but provided for API compliance. This field is ignored."
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/llama-nemotron-rerank-1b-v2",
    "displayName": "nvidia / llama-nemotron-rerank-1b-v2",
    "category": "retrieval-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/retrieval/nvidia/llama-nemotron-rerank-1b-v2/reranking",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-nemotron-rerank-1b-v2-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:32.000Z",
    "purpose": "Rank passages by their relation to a query",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "reranking",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "RankRequest",
      "required": [
        "model",
        "query",
        "passages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-nemotron-rerank-1b-v2",
          "description": "The model to use for ranking."
        },
        "query": {
          "type": "object",
          "title": "MultiModalData",
          "required": [
            "text"
          ],
          "properties": {
            "text": {
              "type": "string",
              "title": "Text",
              "minLength": 1,
              "maxLength": 14598366
            }
          }
        },
        "passages": {
          "type": "array",
          "title": "Passages",
          "minItems": 1,
          "maxItems": 1000,
          "description": "The list of passages to rank.",
          "items": {
            "type": "object",
            "title": "MultiModalData",
            "required": [
              "text"
            ],
            "properties": {
              "text": {
                "type": "string",
                "title": "Text",
                "minLength": 1,
                "maxLength": 14598366
              }
            }
          }
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "END",
          "description": "How to truncate the input if it's too long for the model.",
          "enum": [
            "NONE",
            "END"
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/llama-nemotron-rerank-vl-1b-v2",
    "displayName": "nvidia / llama-nemotron-rerank-vl-1b-v2",
    "category": "retrieval-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/retrieval/nvidia/llama-nemotron-rerank-vl-1b-v2/reranking",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-nemotron-rerank-vl-1b-v2-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:33.000Z",
    "purpose": "Rank passages by their relation to a query",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "reranking",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "RankRequest",
      "required": [
        "model",
        "query",
        "passages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-nemotron-rerank-vl-1b-v2",
          "description": "The model to use for ranking."
        },
        "query": {
          "type": "object",
          "title": "Query",
          "description": "The query to rank the passages against.",
          "required": [
            "text"
          ],
          "properties": {
            "text": {
              "type": "string",
              "title": "Text",
              "description": "The text of the query."
            }
          }
        },
        "passages": {
          "type": "array",
          "title": "Passages",
          "minItems": 1,
          "maxItems": 1000,
          "description": "The list of passages to rank.",
          "items": {
            "type": "object",
            "title": "MultiModalData",
            "required": [
              "text"
            ],
            "properties": {
              "text": {
                "type": "string",
                "title": "Text",
                "minLength": 1,
                "maxLength": 14598366
              },
              "image": {
                "type": "string",
                "title": "Image",
                "description": "Optional image as a base64-encoded data URL (e.g. data:image/jpeg;base64,...)."
              }
            }
          }
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "END",
          "description": "How to truncate the input if it's too long for the model.",
          "enum": [
            "NONE",
            "END"
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/molmim",
    "displayName": "nvidia / molmim",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/biology/nvidia/molmim/generate",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-molmim-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:13.000Z",
    "purpose": "Perform molecule generation",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "molecular-modeling",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "MoleculeGenerationBody",
      "properties": {
        "algorithm": {
          "default": "CMA-ES",
          "allOf": [
            {
              "type": "string",
              "title": "ControlGenerationAlgo",
              "enum": [
                "CMA-ES",
                "none"
              ]
            }
          ]
        },
        "smi": {
          "type": "string",
          "title": "Smi"
        },
        "num_molecules": {
          "type": "integer",
          "title": "Num Molecules",
          "default": 10,
          "minimum": 1,
          "maximum": 100
        },
        "iterations": {
          "type": "integer",
          "title": "Iterations",
          "default": 10,
          "minimum": 1,
          "maximum": 1000
        },
        "property_name": {
          "default": "QED",
          "allOf": [
            {
              "type": "string",
              "title": "ControlGenerationProp",
              "enum": [
                "QED",
                "plogP"
              ]
            }
          ]
        },
        "particles": {
          "type": "integer",
          "title": "Particles",
          "default": 20,
          "minimum": 2,
          "maximum": 1000
        },
        "minimize": {
          "type": "boolean",
          "title": "Minimize",
          "default": false
        },
        "min_similarity": {
          "type": "number",
          "title": "Min Similarity",
          "default": 0.7,
          "minimum": 0,
          "maximum": 1
        },
        "scaled_radius": {
          "type": "number",
          "title": "Scaled Radius",
          "default": 1,
          "minimum": 0,
          "maximum": 2
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/nemoguard-jailbreak-detect",
    "displayName": "nvidia / nemoguard-jailbreak-detect",
    "category": "llm-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/security/nvidia/nemoguard-jailbreak-detect",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemoguard-jailbreak-detect-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:47.000Z",
    "purpose": "Classify text for jailbreak attempt",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "content-safety",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ClassifyRequest",
      "properties": {
        "input": {
          "title": "Input",
          "anyOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 16777216
            },
            {
              "type": "array",
              "items": {
                "type": "string",
                "title": "InputItem",
                "minLength": 1,
                "maxLength": 16777216
              }
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/nemoretriever-parse",
    "displayName": "nvidia / nemoretriever-parse",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemoretriever-parse-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:19.000Z",
    "purpose": "Parse document content into structured text (nvidia/nemoretriever-parse)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "document-parsing",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/nemoretriever-parse",
          "description": "The model to use."
        },
        "frequency_penalty": {
          "title": "Frequency Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 3500,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 8192
            },
            {
              "type": "null"
            }
          ]
        },
        "presence_penalty": {
          "title": "Presence Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stop": {
          "title": "Stop",
          "description": "Sequences where the API will stop generating further tokens.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 1,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 1,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/nemotron-3-content-safety",
    "displayName": "nvidia / nemotron-3-content-safety",
    "category": "multimodal-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-content-safety-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:52.000Z",
    "purpose": "Classify content against the model’s safety policy (nvidia/nemotron-3-content-safety)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "content-safety",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/nemotron-3-content-safety",
          "description": "The model to use."
        },
        "chat_template_kwargs": {
          "type": "object",
          "title": "Chat Template Kwargs",
          "description": "Additional keyword arguments to pass to the chat template. Use {\"request_categories\": \"/categories\"} to include safety category labels in the response.",
          "properties": {
            "request_categories": {
              "type": "string",
              "title": "Request Categories",
              "description": "Set to /categories to include safety category labels in the response."
            }
          }
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 512,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 4096
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 0.2,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 0.7,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/nemotron-3-embed-1b",
    "displayName": "nvidia / nemotron-3-embed-1b",
    "category": "retrieval-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/embeddings",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-embed-1b-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:34.000Z",
    "purpose": "Creates an embedding vector from the input text.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-embedding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "required": [
        "input",
        "model"
      ],
      "properties": {
        "input": {
          "title": "Input",
          "minLength": 1,
          "maxLength": 4096,
          "description": "Input text to embed. Max length is 4096 tokens.",
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/nemotron-3-embed-1b",
          "description": "ID of the embedding model."
        },
        "input_type": {
          "type": "string",
          "title": "Input Type",
          "description": "nvidia/nemotron-3-embed-1b operates in `passage` or `query` mode, and thus requires the `input_type` parameter. `passage` is used when generating embeddings during indexing. `query` is used when generating embeddings during querying. It is very important to use the correct `input_type`. Failure to do so will result in large drops in retrieval accuracy.",
          "enum": [
            "passage",
            "query"
          ]
        },
        "encoding_format": {
          "type": "string",
          "title": "Encoding Format",
          "default": "float",
          "description": "The format to return the embeddings in.",
          "enum": [
            "float",
            "base64"
          ]
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "NONE",
          "description": "Specifies how inputs longer than the maximum token length of the model are handled. Passing `START` discards the start of the input. `END` discards the end of the input. In both cases, input is discarded until the remaining input is exactly the maximum input token length for the model. If `NONE` is selected, when the input exceeds the maximum input token length an error will be returned.",
          "enum": [
            "NONE",
            "START",
            "END"
          ]
        },
        "user": {
          "type": "string",
          "title": "User",
          "description": "Not implemented, but provided for API compliance. This field is ignored."
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/nemotron-3-nano-30b-a3b",
    "displayName": "nvidia / nemotron-3-nano-30b-a3b",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-nano-30b-a3b-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:49.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/nemotron-3-nano-30b-a3b"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 32768,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "seed": {
          "title": "Seed",
          "default": 42,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": true,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/nemotron-3-super-120b-a12b",
    "displayName": "nvidia / nemotron-3-super-120b-a12b",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:50.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/nemotron-3-super-120b-a12b"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 32768,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "reasoning_effort": {
          "title": "Reasoning Effort",
          "default": "high",
          "description": "Controls Super's reasoning mode. `none` disables reasoning tokens, `low` enables low-effort reasoning, and `high` enables full reasoning. Snippets translate this field into the model's `chat_template_kwargs`.",
          "enum": [
            "none",
            "low",
            "high"
          ]
        },
        "reasoning_budget": {
          "type": "integer",
          "title": "Reasoning Budget",
          "default": 16384,
          "minimum": -1,
          "maximum": 32768,
          "description": "Maximum number of tokens the model is allowed to use for internal reasoning (\"thinking\") before it is forced to end the reasoning trace. Use `-1` to disable budget enforcement. This can also be provided via `chat_template_kwargs.reasoning_budget` for backwards compatibility; if both are provided, `chat_template_kwargs.reasoning_budget` takes precedence. This is typically most useful with `reasoning_effort: \"high\"`."
        },
        "seed": {
          "title": "Seed",
          "default": 42,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": true,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b",
    "displayName": "nvidia / nemotron-3-ultra-550b-a55b",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-ultra-550b-a55b-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:51.000Z",
    "purpose": "Creates a model response for the given chat conversation",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/nemotron-3-ultra-550b-a55b"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 32768,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "reasoning_effort": {
          "title": "Reasoning Effort",
          "default": "high",
          "description": "Controls Ultra's reasoning mode. `none` disables reasoning tokens, `medium` enables efficient reasoning, and `high` enables full reasoning. Snippets translate this field into the model's `chat_template_kwargs`.",
          "enum": [
            "none",
            "medium",
            "high"
          ]
        },
        "reasoning_budget": {
          "type": "integer",
          "title": "Reasoning Budget",
          "default": 16384,
          "minimum": -1,
          "maximum": 32768,
          "description": "Maximum number of tokens the model is allowed to use for internal reasoning (\"thinking\") before it is forced to end the reasoning trace. Use `-1` to disable budget enforcement. This can also be provided via `chat_template_kwargs.reasoning_budget` for backwards compatibility; if both are provided, `chat_template_kwargs.reasoning_budget` takes precedence. This is typically most useful with `reasoning_effort: \"high\"`."
        },
        "seed": {
          "title": "Seed",
          "default": 42,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": true,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/nemotron-3.5-content-safety",
    "displayName": "nvidia / nemotron-3.5-content-safety",
    "category": "multimodal-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-5-content-safety-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:54.000Z",
    "purpose": "Classify content against the model’s safety policy (nvidia/nemotron-3.5-content-safety)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "content-safety",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "system",
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br> - Videos use `type`=`video_url`; audios use `type`=`audio_url` or `type`=`input_audio` when supported by the model schema. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMLLMChatCompletionContentPartAudio",
                          "required": [
                            "audio_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMLLMChatCompletionContentPartInputAudio",
                          "required": [
                            "input_audio",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartVideo",
                          "required": [
                            "type",
                            "video_url"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
          "description": "The model to use."
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 65536,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 65536
            },
            {
              "type": "null"
            }
          ]
        },
        "reasoning_budget": {
          "type": "integer",
          "title": "Reasoning Budget",
          "default": 16384,
          "minimum": -1,
          "maximum": 32768,
          "description": "Maximum number of tokens the model is allowed to use for internal reasoning before the reasoning trace is forced to end. Use `-1` to disable budget enforcement. This can also be provided via `chat_template_kwargs.reasoning_budget` for backwards compatibility."
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 0.6,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 0.95,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/nemotron-3.5-lightning-30b-a3b",
    "displayName": "nvidia / nemotron-3.5-lightning-30b-a3b",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-5-lightning-30b-a3b-infer",
    "documentationUpdatedAt": "2026-08-11T19:47:14.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/nemotron-3.5-lightning-30b-a3b"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 32768,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "reasoning_budget": {
          "type": "integer",
          "title": "Reasoning Budget",
          "default": 16384,
          "minimum": -1,
          "maximum": 32768,
          "description": "Maximum number of tokens the model is allowed to use for internal reasoning (\"thinking\") before it is forced to end the reasoning trace. Use `-1` to disable budget enforcement. This can also be provided via `chat_template_kwargs.reasoning_budget` for backwards compatibility; if both are provided, `chat_template_kwargs.reasoning_budget` takes precedence. This applies when reasoning is enabled."
        },
        "seed": {
          "title": "Seed",
          "default": 42,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": true,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/nemotron-content-safety-reasoning-4b",
    "displayName": "nvidia / nemotron-content-safety-reasoning-4b",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-content-safety-reasoning-4b-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:52.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "content-safety",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/nemotron-content-safety-reasoning-4b"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 32768,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "seed": {
          "title": "Seed",
          "default": 42,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": true,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/nemotron-mini-4b-instruct",
    "displayName": "nvidia / nemotron-mini-4b-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-mini-4b-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:53.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/nemotron-mini-4b-instruct"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant",
                  "tool"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_call_id": {
                "title": "Tool Call Id",
                "description": "The id of the tool call.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_calls": {
                "title": "Tool Calls",
                "description": "The tool(s) called by the model.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "title": "ToolCall",
                      "required": [
                        "function"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "title": "Id"
                        },
                        "type": {
                          "type": "string",
                          "title": "Type",
                          "default": "function",
                          "enum": [
                            "function"
                          ]
                        },
                        "function": {
                          "type": "object",
                          "title": "FunctionCall",
                          "required": [
                            "name",
                            "arguments"
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.2,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "tools": {
          "title": "Tools",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "ChatCompletionToolsParam",
                "required": [
                  "function"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "default": "function",
                    "enum": [
                      "function"
                    ]
                  },
                  "function": {
                    "type": "object",
                    "title": "FunctionDefinition",
                    "required": [
                      "name"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "title": "Name"
                      },
                      "description": {
                        "title": "Description",
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "parameters": {
                        "title": "Parameters",
                        "anyOf": [
                          {
                            "type": "object"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/nemotron-nano-12b-v2-vl",
    "displayName": "nvidia / nemotron-nano-12b-v2-vl",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-nano-12b-v2-vl-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:22.000Z",
    "purpose": "Answer a question about image content (nvidia/nemotron-nano-12b-v2-vl)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-understanding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "system",
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/nemotron-nano-12b-v2-vl",
          "description": "The model to use."
        },
        "frequency_penalty": {
          "title": "Frequency Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 4096,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 8192
            },
            {
              "type": "null"
            }
          ]
        },
        "presence_penalty": {
          "title": "Presence Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stop": {
          "title": "Stop",
          "description": "Sequences where the API will stop generating further tokens.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 1,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 1,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/nemotron-parse",
    "displayName": "nvidia / nemotron-parse",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-parse-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:24.000Z",
    "purpose": "Parse document content into structured text (nvidia/nemotron-parse)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "document-parsing",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass images (only with role=`user`): <br> - When content is a string, image can be passed together with the text with `img` HTML tags that wraps an image URL (`<img src=\"{url}\" />`), base64 encoded image data (`<img src=\"data:image/{format};base64,{base64encodedimage}\" />`), or an NVCF asset ID (`<img src=\"data:image/{format};asset_id,{asset_id}\" />`) when the container is hosted in NVCF and the payload exceeds 200KB. <br> - When content is a list of objects, images can be passed as objects with type=`image_url`. <br> - In both cases, images can be PNG, JPG ",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/nemotron-parse",
          "description": "The model to use."
        },
        "frequency_penalty": {
          "title": "Frequency Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 3500,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 8192
            },
            {
              "type": "null"
            }
          ]
        },
        "presence_penalty": {
          "title": "Presence Penalty",
          "default": 0,
          "description": "Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.",
          "anyOf": [
            {
              "type": "number",
              "minimum": -2,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stop": {
          "title": "Stop",
          "description": "Sequences where the API will stop generating further tokens.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 0,
          "description": "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 2
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 1,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. We generally recommend altering this or `temperature` but not both.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/nv-dinov2",
    "displayName": "nvidia / nv-dinov2",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/cv/nvidia/nv-dinov2",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nv-dinov2-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:26.000Z",
    "purpose": "Run inference on the input image",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-analysis",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "InferRequest",
      "description": "List of messages as input for the inference request.",
      "required": [
        "messages"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "maxItems": 1,
          "description": "Currently only single image input is supported.",
          "items": {
            "type": "object",
            "title": "Message",
            "description": "The content of the messages for the inference request.",
            "required": [
              "content"
            ],
            "properties": {
              "content": {
                "type": "object",
                "title": "UrlContent",
                "description": "The URL content as input of the inference request.",
                "required": [
                  "type",
                  "image_url"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "description": "The type of content part.",
                    "enum": [
                      "image_url"
                    ]
                  },
                  "image_url": {
                    "type": "object",
                    "title": "ImageUrl",
                    "description": "The image type URL content as input of the inference request.",
                    "required": [
                      "url"
                    ],
                    "properties": {
                      "url": {
                        "type": "string",
                        "title": "Url",
                        "maxLength": 20480000,
                        "description": "Base64 encoded image data in the form of `data:image/{format};base64,{base64encodedimage}`. If the size of an image is more than 200KB, it needs to be uploaded using Files API. Once uploaded you can refer to it using the following format: `data:image/{format};asset_id,{asset_id}`. Supported formats are `jpg`, `jpeg` or `png`."
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          }
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/nv-embedqa-e5-v5",
    "displayName": "nvidia / nv-embedqa-e5-v5",
    "category": "retrieval-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/embeddings",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nv-embedqa-e5-v5-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:39.000Z",
    "purpose": "Creates an embedding vector from the input text",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-embedding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "required": [
        "input",
        "model"
      ],
      "properties": {
        "input": {
          "title": "Input",
          "minLength": 1,
          "maxLength": 4096,
          "description": "Input text to embed. Max length is 8192 tokens.",
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/nv-embedqa-e5-v5",
          "description": "ID of the embedding model."
        },
        "input_type": {
          "type": "string",
          "title": "Input Type",
          "description": "nvidia/nv-embedqa-e5-v5 operates in `passage` or `query` mode, and thus require the `input_type` parameter. `passage` is used when generating embeddings during indexing. `query` is used when generating embeddings during querying. It is very important to use the correct `input_type`. Failure to do so will result in large drops in retrieval accuracy.",
          "enum": [
            "passage",
            "query"
          ]
        },
        "encoding_format": {
          "type": "string",
          "title": "Encoding Format",
          "default": "float",
          "description": "The format to return the embeddings in.",
          "enum": [
            "float",
            "base64"
          ]
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "NONE",
          "description": "Specifies how inputs longer than the maximum token length of the model are handled. Passing `START` discards the start of the input. `END` discards the end of the input. In both cases, input is discarded until the remaining input is exactly the maximum input token length for the model. If `NONE` is selected, when the input exceeds the maximum input token length an error will be returned.",
          "enum": [
            "NONE",
            "START",
            "END"
          ]
        },
        "user": {
          "type": "string",
          "title": "User",
          "description": "Not implemented, but provided for API compliance. This field is ignored."
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/nv-grounding-dino",
    "displayName": "nvidia / nv-grounding-dino",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/cv/nvidia/nv-grounding-dino",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nv-grounding-dino-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:28.000Z",
    "purpose": "Run inference on the input image/video for a given text prompt",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "object-detection",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "RequestModel",
      "required": [
        "model",
        "messages",
        "threshold"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "maxLength": 256,
          "description": "Name of the model used."
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "maxItems": 1000000,
          "description": "Requests for inference.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "format": "str",
                "title": "Role",
                "maxLength": 512,
                "description": "Role user or assistant."
              },
              "content": {
                "type": "array",
                "title": "Content",
                "maxItems": 32,
                "description": "List of text content and url content.",
                "items": {
                  "anyOf": [
                    {
                      "type": "object",
                      "title": "TextContent",
                      "required": [
                        "type",
                        "text"
                      ],
                      "properties": {
                        "type": {
                          "type": "string",
                          "title": "Type",
                          "description": "The type of content part."
                        },
                        "text": {
                          "type": "string",
                          "format": "str",
                          "title": "Text",
                          "maxLength": 1024,
                          "description": "Prompt for Grounding Dino."
                        }
                      },
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "title": "UrlContent",
                      "required": [
                        "type",
                        "media_url"
                      ],
                      "properties": {
                        "type": {
                          "type": "string",
                          "title": "Type",
                          "description": "The type of content part."
                        },
                        "media_url": {
                          "type": "object",
                          "title": "MediaUrl",
                          "required": [
                            "url"
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  ]
                }
              }
            },
            "additionalProperties": false
          }
        },
        "threshold": {
          "type": "number",
          "title": "Threshold",
          "default": 0.3,
          "minimum": 0.1,
          "maximum": 1,
          "description": "Threshold used for detection."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/nv-rerankqa-mistral-4b-v3",
    "displayName": "nvidia / nv-rerankqa-mistral-4b-v3",
    "category": "retrieval-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nv-rerankqa-mistral-4b-v3-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:40.000Z",
    "purpose": "Rank passages by their relation to a query",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "reranking",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "RankRequest",
      "description": "A request to the rank endpoint.",
      "required": [
        "model",
        "query",
        "passages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "minLength": 1,
          "maxLength": 128,
          "description": "Model identifier"
        },
        "query": {
          "description": "A text query for ranking the passages",
          "allOf": [
            {
              "type": "object",
              "title": "MultiModalData",
              "description": "A type signifier for multimodal data. Supported data types: text.",
              "required": [
                "text"
              ],
              "properties": {
                "text": {
                  "type": "string",
                  "title": "Text",
                  "minLength": 1,
                  "maxLength": 14598366
                }
              },
              "additionalProperties": false
            }
          ]
        },
        "passages": {
          "type": "array",
          "title": "Passages",
          "minItems": 1,
          "maxItems": 512,
          "description": "Text passages to rank based on the query",
          "items": {
            "type": "object",
            "title": "MultiModalData",
            "description": "A type signifier for multimodal data. Supported data types: text.",
            "required": [
              "text"
            ],
            "properties": {
              "text": {
                "type": "string",
                "title": "Text",
                "minLength": 1,
                "maxLength": 14598366
              }
            },
            "additionalProperties": false
          }
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "NONE",
          "enum": [
            "END",
            "NONE"
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/nvclip",
    "displayName": "nvidia / nvclip",
    "category": "retrieval-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/embeddings",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nvclip-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:36.000Z",
    "purpose": "Creates an embedding vector representing the input text or image",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "multimodal-embedding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "EmbeddingsRequest",
      "required": [
        "input",
        "model"
      ],
      "properties": {
        "input": {
          "title": "Input",
          "description": "The list of images or texts that you want to generate embeddings for. Images should be in form of `data:image/{format};base64,{base64encodedimage}`. If the size of an image is more than 200KB, it needs to be uploaded to a presigned S3 bucket using NVCF Asset APIs. Once uploaded you can refer to it using the following format: `<img src=\"data:image/png;asset_id,{asset_id}\" />`. Accepted formats are `jpg`, `png` and `jpeg`.",
          "oneOf": [
            {
              "type": "string",
              "title": "string"
            },
            {
              "type": "array",
              "maxItems": 64,
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "encoding_format": {
          "type": "string",
          "title": "Encoding Format",
          "default": "float",
          "description": "The format to return the embeddings in. Can be either `float` or `base64`.",
          "enum": [
            "float",
            "base64"
          ]
        },
        "model": {
          "type": "string",
          "title": "Model",
          "description": "ID of the embedding model.",
          "enum": [
            "nvidia/nvclip"
          ]
        },
        "dimensions": {
          "type": "integer",
          "format": "int32",
          "minimum": 1,
          "maximum": 1,
          "description": "Not implemented, but provided for API compliance. This field is ignored."
        },
        "user": {
          "type": "string",
          "maxLength": 204800,
          "description": "Not implemented, but provided for API compliance. This field is ignored."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/nvidia-nemotron-nano-9b-v2",
    "displayName": "nvidia / nvidia-nemotron-nano-9b-v2",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nvidia-nemotron-nano-9b-v2-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:54.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/llama-3.1-nemoguard-8b-content-safety"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/retail-object-detection",
    "displayName": "nvidia / retail-object-detection",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/cv/nvidia/retail-object-detection",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-retail-object-detection-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:29.000Z",
    "purpose": "Detect and localize objects in visual input (nvidia/retail-object-detection)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "object-detection",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "VideoRequest",
      "required": [
        "input_video"
      ],
      "properties": {
        "input_video": {
          "type": "string",
          "format": "uuid",
          "title": "Input Video",
          "maxLength": 36,
          "description": "Asset ID of the input video"
        },
        "threshold": {
          "type": "number",
          "title": "Threshold",
          "default": 0.9,
          "minimum": 0.1,
          "maximum": 1,
          "description": "Confidence threshold for detections in range 0.1-1.0"
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/riva-translate-4b-instruct-v1.1",
    "displayName": "nvidia / riva-translate-4b-instruct-v1.1",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-riva-translate-4b-instruct-v1_1-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:55.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "translation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/riva-translate-4b-instruct-v1.1"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.9,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 512,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/riva-translate-4b-instruct-v2",
    "displayName": "nvidia / riva-translate-4b-instruct-v2",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-riva-translate-4b-instruct-v2-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:57.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "translation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/riva-translate-4b-instruct-v2"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.9,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 512,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/streampetr",
    "displayName": "nvidia / streampetr",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/av/nvidia/streampetr",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-streampetr-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:32.000Z",
    "purpose": "Post V1 Streampetr Process",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "object-detection",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "StreampetrRequest",
      "required": [
        "scene_id"
      ],
      "properties": {
        "scene_id": {
          "type": "string",
          "title": "Scene Id",
          "description": "Identifier for the scene/data to process"
        },
        "config": {
          "anyOf": [
            {
              "type": "object",
              "title": "Config",
              "properties": {
                "output_format": {
                  "default": "mp4",
                  "anyOf": [
                    {
                      "type": "string",
                      "title": "OutputFormat",
                      "enum": [
                        "mp4"
                      ]
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "fps": {
                  "title": "Fps",
                  "default": 10,
                  "anyOf": [
                    {
                      "type": "number",
                      "minimum": 1,
                      "maximum": 60
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              }
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "application/zip",
      "application/octet-stream"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/vila",
    "displayName": "nvidia / vila",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/vlm/nvidia/vila",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-vila-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:33.000Z",
    "purpose": "Answer a question about image content (nvidia/vila)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-understanding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "maxItems": 1024,
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user` or `assistant`. A message with the `system` role is optional, and must be the very first message if it is present.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "default": null,
                "description": "The contents of the message. <br>Can only be `null` as part of a last request message with role=`assistant` (for \"completion mode\", i.e. providing the beginning of the assistant response). <br>To pass images (only with role=`user`): <br> - When content is a string, images can be passed together with the text with `img` HTML tags with base64 data: `<img src=\"data:image/{format};base64,{base64encodedimage}\" />` . If the size of an image is more than 180KB, it needs to be uploaded to a presigned S3 bucket using NVCF Asset APIs. Once uploaded you can refer to it using the following format: `<img s",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "type",
                            "text"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "type",
                            "image_url"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartVideo",
                          "required": [
                            "type",
                            "video_url"
                          ]
                        }
                      ]
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "nvidia/vila",
          "description": "The model to use."
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.2,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with `top_p` probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. NVIDIA recommends that you alter this option or `temperature` but not both."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "maximum": 2048,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "seed": {
          "title": "Seed",
          "default": 50,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message.",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "num_frames_per_inference": {
          "title": "Num Frames Per Inference",
          "default": 8,
          "description": "Number of frames to sample from the video or stream. They will be the input to model.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 16
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "nvidia/vista3d",
    "displayName": "nvidia / vista3d",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/medicalimaging/nvidia/vista-3d",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-vista3d-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:15.000Z",
    "purpose": "Run Inference",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "3d-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "InferenceRequest",
      "required": [
        "image"
      ],
      "properties": {
        "image": {
          "type": "string",
          "title": "Image",
          "description": "A Valid URL representing a 3D medical Image (nifti/nrrd)"
        },
        "prompts": {
          "title": "Prompts",
          "description": "User prompts for running Interactive Annotation",
          "anyOf": [
            {
              "type": "object",
              "title": "Prompts",
              "properties": {
                "classes": {
                  "title": "Label Names/Indices",
                  "default": [],
                  "description": "Label Names/Indices as class prompts",
                  "anyOf": [
                    {
                      "type": "array",
                      "items": {
                        "anyOf": [
                          {
                            "type": "integer"
                          },
                          {
                            "type": "string"
                          }
                        ]
                      }
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "points": {
                  "title": "Click Points",
                  "default": [],
                  "description": "User Click Points as prompts",
                  "anyOf": [
                    {
                      "type": "object",
                      "additionalProperties": {
                        "type": "array",
                        "items": {
                          "type": "array",
                          "minItems": 3,
                          "maxItems": 3
                        }
                      }
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "output": {
          "title": "Output Type",
          "description": "Provide any ITK output type for segmentation masks",
          "anyOf": [
            {
              "type": "object",
              "title": "OutputType",
              "required": [
                "extension",
                "dtype"
              ],
              "properties": {
                "extension": {
                  "type": "string",
                  "title": "Extension",
                  "description": "Supported ITK Extension for segmentation mask"
                },
                "dtype": {
                  "type": "string",
                  "title": "Data Type",
                  "description": "Output Data Type for segmentation mask"
                }
              }
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/octet-stream",
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "nvidia/visual-changenet",
    "displayName": "nvidia / visual-changenet",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/cv/nvidia/visual-changenet",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-visual-changenet-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:35.000Z",
    "purpose": "Compare reference and test images for visual changes (nvidia/visual-changenet)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "change-detection",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ImageRequest",
      "required": [
        "reference_image",
        "test_image"
      ],
      "properties": {
        "reference_image": {
          "type": "string",
          "format": "uuid",
          "title": "Reference Image",
          "maxLength": 36,
          "description": "Asset ID of the reference image"
        },
        "test_image": {
          "type": "string",
          "format": "uuid",
          "title": "Test Image",
          "maxLength": 36,
          "description": "Asset ID of the test image"
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "openai/gpt-oss-120b",
    "displayName": "openai / gpt-oss-120b",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/openai-gpt-oss-120b-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:00.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "openai/gpt-oss-120b"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.6,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 4096,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "reasoning_effort": {
          "title": "Reasoning Effort",
          "default": "medium",
          "description": "Controls the effort level for reasoning in reasoning-capable models. 'low' provides basic reasoning, 'medium' provides balanced reasoning, and 'high' provides detailed step-by-step reasoning.",
          "enum": [
            "low",
            "medium",
            "high"
          ]
        },
        "tools": {
          "type": "array",
          "title": "Tools",
          "description": "A list of tools the model may call.",
          "items": {
            "type": "object",
            "title": "Tool",
            "required": [
              "type",
              "function"
            ],
            "properties": {
              "type": {
                "type": "string",
                "description": "The type of the tool.",
                "enum": [
                  "function"
                ]
              },
              "function": {
                "type": "object",
                "required": [
                  "name"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "The name of the function to be called."
                  },
                  "description": {
                    "type": "string",
                    "description": "A description of what the function does."
                  },
                  "parameters": {
                    "type": "object",
                    "description": "The parameters the function accepts, described as a JSON Schema object."
                  }
                }
              }
            }
          }
        },
        "tool_choice": {
          "title": "Tool Choice",
          "description": "Controls which (if any) tool is called by the model.",
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "none",
                "auto",
                "required"
              ]
            },
            {
              "type": "object",
              "required": [
                "type",
                "function"
              ],
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "function"
                  ]
                },
                "function": {
                  "type": "object",
                  "required": [
                    "name"
                  ],
                  "properties": {
                    "name": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "openai/gpt-oss-20b",
    "displayName": "openai / gpt-oss-20b",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/openai-gpt-oss-20b-infer",
    "documentationUpdatedAt": "2026-08-06T09:58:59.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "openai/gpt-oss-20b"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.6,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 4096,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "reasoning_effort": {
          "title": "Reasoning Effort",
          "default": "medium",
          "description": "Controls the effort level for reasoning in reasoning-capable models. 'low' provides basic reasoning, 'medium' provides balanced reasoning, and 'high' provides detailed step-by-step reasoning.",
          "enum": [
            "low",
            "medium",
            "high"
          ]
        },
        "tools": {
          "type": "array",
          "title": "Tools",
          "description": "A list of tools the model may call.",
          "items": {
            "type": "object",
            "title": "Tool",
            "required": [
              "type",
              "function"
            ],
            "properties": {
              "type": {
                "type": "string",
                "description": "The type of the tool.",
                "enum": [
                  "function"
                ]
              },
              "function": {
                "type": "object",
                "required": [
                  "name"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "The name of the function to be called."
                  },
                  "description": {
                    "type": "string",
                    "description": "A description of what the function does."
                  },
                  "parameters": {
                    "type": "object",
                    "description": "The parameters the function accepts, described as a JSON Schema object."
                  }
                }
              }
            }
          }
        },
        "tool_choice": {
          "title": "Tool Choice",
          "description": "Controls which (if any) tool is called by the model.",
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "none",
                "auto",
                "required"
              ]
            },
            {
              "type": "object",
              "required": [
                "type",
                "function"
              ],
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "function"
                  ]
                },
                "function": {
                  "type": "object",
                  "required": [
                    "name"
                  ],
                  "properties": {
                    "name": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "openfold/openfold2",
    "displayName": "openfold / openfold2",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/biology/openfold/openfold2/predict-structure-from-msa-and-template",
    "documentation": "https://docs.api.nvidia.com/nim/reference/openfold-openfold2-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:16.000Z",
    "purpose": "Call Monomer Structure From MSA",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "biology",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "OF2MonomerInput",
      "required": [
        "sequence"
      ],
      "properties": {
        "sequence": {
          "type": "string",
          "title": "Input Polypeptide Sequence",
          "minLength": 1,
          "maxLength": 1000,
          "description": "An input polypeptide (i.e., amino acid) sequence that must be composed of valid Amino Acid IUPAC symbols."
        },
        "input_id": {
          "title": "Identifier / tag for the input.",
          "description": "Identifier / tag for the input.",
          "anyOf": [
            {
              "type": "string",
              "maxLength": 128
            },
            {
              "type": "null"
            }
          ]
        },
        "alignments": {
          "title": "Alignments",
          "description": "The multiple-sequence-alignment, must be in a3m format.",
          "anyOf": [
            {
              "type": "object",
              "additionalProperties": {
                "type": "object",
                "additionalProperties": {
                  "type": "object",
                  "title": "AlignmentFileRecord",
                  "description": "Represents a single alignment. This is just the raw file output read into a string and of a defined version.",
                  "required": [
                    "alignment",
                    "format"
                  ],
                  "properties": {
                    "alignment": {
                      "type": "string",
                      "title": "Multiple Sequence Alignment.",
                      "description": "The contents of a single MSA."
                    },
                    "format": {
                      "type": "string",
                      "title": "Alignment_Format_Constants",
                      "enum": [
                        "sto",
                        "a3m",
                        "fasta"
                      ]
                    }
                  }
                }
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "templates": {
          "title": "Templates, must be in hhr format",
          "description": "See the API specification for how to format this field.",
          "anyOf": [
            {
              "type": "object",
              "additionalProperties": {
                "type": "object",
                "additionalProperties": {
                  "type": "object",
                  "title": "TemplateFileRecord",
                  "required": [
                    "templates",
                    "format"
                  ],
                  "properties": {
                    "templates": {
                      "title": "Templates",
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "parsed_templates": {
                      "title": "Parsed Templates",
                      "anyOf": [
                        {
                          "type": "array"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "format": {
                      "type": "string",
                      "title": "Template_Format_Constants",
                      "enum": [
                        "sto",
                        "hhr",
                        "parsed_templates"
                      ]
                    }
                  }
                }
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "selected_models": {
          "title": "Selected models for structure prediction.",
          "default": [
            1,
            2,
            3,
            4,
            5
          ],
          "description": "Allows selecting the parameters used for protein structure prediction.",
          "anyOf": [
            {
              "type": "array",
              "minItems": 1,
              "maxItems": 5,
              "items": {
                "type": "integer"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "relax_prediction": {
          "title": "Relax Prediction",
          "default": false,
          "description": "Run structural relaxation after prediction",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "use_templates": {
          "title": "Use the template as features",
          "default": false,
          "description": "Use the templates, if provided, as features for structure prediction.",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "explicit_templates": {
          "title": "Explicit templates",
          "description": "List of user-supplied structural templates in mmCIF format.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "StructuralTemplate",
                "description": "Represents a single structure prediction. This is just the raw file output read into a string and of a defined version.",
                "required": [
                  "structure",
                  "format"
                ],
                "properties": {
                  "structure": {
                    "title": "Structural Template",
                    "description": "The contents of a single structural template.",
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "string",
                        "format": "binary"
                      }
                    ]
                  },
                  "format": {
                    "type": "string",
                    "title": "Structure Format",
                    "description": "The format of the structure record. Can be uncompressed (mmcif) or gzipped (mmcif.gz).",
                    "enum": [
                      "mmcif",
                      "mmcif.gz"
                    ]
                  },
                  "name": {
                    "title": "Name",
                    "default": "",
                    "description": "An optional name for the structure.",
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "source": {
                    "title": "Source",
                    "default": "",
                    "description": "The source file for the structure.",
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "rank": {
                    "title": "Rank",
                    "default": -1,
                    "description": "An integer rank to define the ordering of alignments (for example, when concatenating alignments).",
                    "anyOf": [
                      {
                        "type": "integer"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "checksum": {
                    "title": "Checksum",
                    "description": "Optional checksum of the structure data.",
                    "anyOf": [
                      {
                        "type": "object",
                        "title": "Checksum",
                        "description": "Represents a checksum of data using a specific algorithm.",
                        "required": [
                          "checksum"
                        ],
                        "properties": {
                          "checksum": {
                            "type": "string",
                            "title": "Checksum",
                            "description": "The hexadecimal representation of the checksum."
                          },
                          "algorithm": {
                            "type": "string",
                            "title": "HashAlgorithm",
                            "description": "Supported hash algorithms for checksums.",
                            "enum": [
                              "sha256",
                              "None"
                            ]
                          }
                        }
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "compression_ratio": {
                    "title": "Compression Ratio",
                    "description": "The compression ratio achieved when the structure was compressed (original size / compressed size).",
                    "anyOf": [
                      {
                        "type": "number"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                }
              }
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "openfold/openfold3",
    "displayName": "openfold / openfold3",
    "category": "healthcare-apis",
    "endpoint": "https://health.api.nvidia.com/v1/biology/openfold/openfold3/predict",
    "documentation": "https://docs.api.nvidia.com/nim/reference/openfold-openfold3-infer",
    "documentationUpdatedAt": "2026-08-06T10:01:17.000Z",
    "purpose": "Post Of3 Predict",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "biology",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "OF3Request",
      "required": [
        "inputs"
      ],
      "properties": {
        "request_id": {
          "title": "Identifier / tag for the request.",
          "description": "Identifier / tag for the request.",
          "anyOf": [
            {
              "type": "string",
              "maxLength": 128
            },
            {
              "type": "null"
            }
          ]
        },
        "inputs": {
          "type": "array",
          "title": "List of inputs",
          "minItems": 1,
          "maxItems": 1,
          "description": "List of inputs",
          "items": {
            "type": "object",
            "title": "OF3Input",
            "required": [
              "molecules"
            ],
            "properties": {
              "input_id": {
                "title": "Identifier / tag for the input.",
                "default": "input_id_0",
                "description": "Identifier / tag for the input.",
                "anyOf": [
                  {
                    "type": "string",
                    "maxLength": 128
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "molecules": {
                "type": "array",
                "title": "Molecules",
                "minItems": 1,
                "maxItems": 32,
                "description": "A list of sequences, each can be of type protein, dna, rna, or ligand..MAX_POLYMER_COUNT protein, rna, and dna sequences are allowed..MAX_LIGAND_COUNT ligand sequences are allowed.",
                "items": {
                  "type": "object",
                  "title": "Molecule",
                  "required": [
                    "type"
                  ],
                  "properties": {
                    "type": {
                      "type": "string",
                      "title": "MoleculeType",
                      "enum": [
                        "protein",
                        "rna",
                        "dna",
                        "ligand"
                      ]
                    },
                    "id": {
                      "title": "Id",
                      "description": "Unique identifier for the polymer chain(s). Can be a single chain ID or a list of chain IDs. Each ID can be either a single letter (A-Z) or a PDB-style ID (4 alphanumeric characters)",
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "array"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "sequence": {
                      "title": "Sequence",
                      "description": "The amino acid, DNA, or RNA sequence. For proteins, use standard single-letter amino acid codes. For DNA, use A/T/C/G. For RNA, use A/U/C/G.",
                      "anyOf": [
                        {
                          "type": "string",
                          "minLength": 2,
                          "maxLength": 4096
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "ccd_codes": {
                      "title": "Ccd Codes",
                      "description": "Chemical Component Dictionary (CCD) code for the ligand",
                      "anyOf": [
                        {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 5
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "smiles": {
                      "title": "Smiles",
                      "description": "SMILES string representation of the ligand",
                      "anyOf": [
                        {
                          "type": "string",
                          "minLength": 1
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "msa": {
                      "title": "Msa",
                      "description": "A Dictionary [database_name -> [format -> AlignmentFileRecord]] containing alignments",
                      "anyOf": [
                        {
                          "type": "object"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "paired_msa": {
                      "title": "Paired Msa",
                      "description": "A Dictionary [database_name -> [format -> AlignmentFileRecord]] containing pairwise alignments between different molecules. Used to specify joint MSAs such as protein-protein or protein-nucleic acid pairwise alignments.",
                      "anyOf": [
                        {
                          "type": "object"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    }
                  }
                }
              },
              "diffusion_samples": {
                "title": "Diffusion Samples",
                "default": 1,
                "description": "This parameter specifies the total number of independent structures the model will generate. Each sample is created from a different random initial noise distribution, leading to a potential diversity of final predictions. Generating multiple samples is useful for exploring different possible conformations of a structure and assessing the model's confidence and consistency.",
                "anyOf": [
                  {
                    "type": "integer"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "output_format": {
                "title": "Output Format",
                "default": "cif",
                "description": "The output format of the returned structure.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "cif",
                      "pdb"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "poolside/laguna-xs-2.1",
    "displayName": "poolside / laguna-xs-2-1",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/poolside-laguna-xs-2-1-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:01.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "poolside/laguna-xs-2.1"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 8192,
          "minimum": 1,
          "maximum": 16384,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "qwen/qwen2.5-coder-32b-instruct",
    "displayName": "qwen / qwen2.5-coder-32b-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/qwen-qwen2_5-coder-32b-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:02.000Z",
    "purpose": "Generate one text response without owning the agent loop (qwen/qwen2.5-coder-32b-instruct)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "qwen/qwen2.5-coder-32b-instruct"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.2,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "maximum": 4000,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "seed": {
          "title": "Seed",
          "default": null,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "qwen/qwen3-next-80b-a3b-instruct",
    "displayName": "qwen / qwen3-next-80b-a3b-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/qwen-qwen3-next-80b-a3b-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:05.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "qwen/qwen3-next-80b-a3b-instruct"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.6,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 4096,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "qwen/qwen3-next-80b-a3b-thinking",
    "displayName": "qwen / qwen3-next-80b-a3b-thinking",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/qwen-qwen3-next-80b-a3b-thinking-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:06.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "qwen/qwen3-next-80b-a3b-thinking"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.6,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 4096,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "qwen/qwen3.5-122b-a10b",
    "displayName": "qwen / qwen3.5-122b-a10b",
    "category": "multimodal-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/qwen-qwen3-5-122b-a10b-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:57.000Z",
    "purpose": "Request response from the model",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "NIMLLMChatCompletionRequest",
      "required": [
        "messages",
        "model"
      ],
      "properties": {
        "messages": {
          "type": "array",
          "title": "Messages",
          "minItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "items": {
            "type": "object",
            "title": "NIMLLMChatCompletionMessage",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "description": "The role of the message's author.",
                "allOf": [
                  {
                    "type": "string",
                    "title": "Role",
                    "enum": [
                      "system",
                      "assistant",
                      "user"
                    ]
                  }
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br> - Videos are passed with `type`=`video_url`; set `video_url.url` to a video URL or a base64 data URI like `data:video/{format};base64,{base64encodedvideo}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartVideo",
                          "required": [
                            "type",
                            "video_url"
                          ]
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "qwen/qwen3.5-122b-a10b",
          "description": "The model to use."
        },
        "chat_template_kwargs": {
          "title": "Chat Template Kwargs",
          "description": "Optional kwargs forwarded to the model chat template. Use {\"enable_thinking\": true} to enable thinking mode or {\"enable_thinking\": false} to disable it.",
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "null"
            }
          ]
        },
        "tools": {
          "title": "Tools",
          "description": "Optional OpenAI-compatible tool definitions for function calling.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "title": "Max Tokens",
          "default": 16384,
          "description": "The maximum number of tokens that can be generated.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 32768
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Changing the seed will produce a different response with similar characteristics. Fixing the seed will reproduce the same results if all other parameters are also kept constant.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": -9223372036854776000,
              "maximum": 9223372036854776000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent, like in ChatGPT. Tokens will be sent as data-only [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format) as they become available, with the stream terminated by a `data: [DONE]`",
          "anyOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "temperature": {
          "title": "Temperature",
          "default": 0.6,
          "description": "What sampling temperature to use, between 0 and 1. Recommended values are 0.6 in thinking mode and 0.7 in non-thinking mode.",
          "anyOf": [
            {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "top_p": {
          "title": "Top P",
          "default": 0.95,
          "description": "Nucleus sampling threshold. Recommended values are 0.95 in thinking mode and 0.8 in non-thinking mode.",
          "anyOf": [
            {
              "type": "number",
              "maximum": 1,
              "exclusiveMinimum": 0
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "qwen/qwq-32b",
    "displayName": "qwen / qwq-32b",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/qwen-qwq-32b-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:07.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "qwen/qwq-32b"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.6,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.7,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 4096,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "sarvamai/sarvam-m",
    "displayName": "sarvamai / sarvam-m",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/sarvamai-sarvam-m-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:08.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "sarvamai/sarvam-m"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.5,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 16384,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "snowflake/arctic-embed-l",
    "displayName": "snowflake / arctic-embed-l",
    "category": "retrieval-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/retrieval/snowflake/arctic-embed-l/embeddings",
    "documentation": "https://docs.api.nvidia.com/nim/reference/snowflake-arctic-embed-l-invoke",
    "documentationUpdatedAt": "2026-08-06T09:59:42.000Z",
    "purpose": "Creates an embedding vector from the input text",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-embedding",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "EmbeddingsRequest",
      "required": [
        "input"
      ],
      "properties": {
        "model": {
          "type": "string",
          "description": "ID of the embedding model.",
          "enum": [
            "snowflake/arctic-embed-l"
          ]
        },
        "input": {
          "title": "Input",
          "minLength": 1,
          "description": "Input text to embed, encoded as a string or array of tokens. To embed multiple inputs in a single request, pass an array of strings. The input must not exceed the max input tokens for the model (512 tokens) and cannot be an empty string.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        },
        "input_type": {
          "type": "string",
          "title": "Input Type",
          "default": "passage",
          "description": "This model operate in passage or query mode, and thus require the input_type parameter. passage is used when generating embeddings during indexing. query is used when generating embeddings during querying. It is very important to use the correct input_type. Failure to do so will result in large drops in retrieval accuracy.",
          "enum": [
            "query",
            "passage"
          ]
        },
        "encoding_format": {
          "type": "string",
          "title": "Encoding Format",
          "default": "float",
          "description": "The format to return the embeddings in",
          "enum": [
            "float",
            "base64"
          ]
        },
        "truncate": {
          "type": "string",
          "title": "Truncate",
          "default": "NONE",
          "description": "Specifies how inputs longer than the maximum token length of the model are handled. Passing `START` discards the start of the input. `END` discards the end of the input. In both cases, input is discarded until the remaining input is exactly the maximum input token length for the model. If `NONE` is selected, when the input exceeds the maximum input token length an error will be returned.",
          "enum": [
            "NONE",
            "START",
            "END"
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "stabilityai/stable-diffusion-3-medium",
    "displayName": "stabilityai / stable-diffusion-3-medium",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-3-medium",
    "documentation": "https://docs.api.nvidia.com/nim/reference/stabilityai-stable-diffusion-3-medium-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:37.000Z",
    "purpose": "Generate an image from a text prompt (stabilityai/stable-diffusion-3-medium)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ImageRequest",
      "required": [
        "prompt"
      ],
      "properties": {
        "aspect_ratio": {
          "type": "string",
          "title": "Aspect Ratio",
          "default": "1:1",
          "description": "Controls the aspect ratio of the generated image.",
          "enum": [
            "1:1",
            "16:9",
            "9:16",
            "5:4",
            "4:5",
            "3:2",
            "2:3"
          ]
        },
        "cfg_scale": {
          "type": "number",
          "title": "Cfg Scale",
          "default": 5,
          "maximum": 9,
          "exclusiveMinimum": 1,
          "description": "The scale of classifier free guidance. Classifier free guidance is an approach that allows users to specify the alignment of the input prompts and negative prompts to the output image. Lower classifier free guidance will result in more diverse but less aligned outputs, while higher classifier free guidance will generate more less diverse but more aligned outputs."
        },
        "mode": {
          "type": "string",
          "title": "Mode",
          "default": "text-to-image",
          "description": "Controls the generation mode. Only mode=`text-to-image` is supported",
          "enum": [
            "text-to-image"
          ]
        },
        "model": {
          "type": "string",
          "title": "Model",
          "default": "sd3",
          "description": "The model to use for generation. Only model=`sd3` is supported",
          "enum": [
            "sd3"
          ]
        },
        "negative_prompt": {
          "title": "Negative Prompt",
          "default": "",
          "description": "A blurb of text describing what you do not wish to see in the output image. This is an advanced feature.",
          "anyOf": [
            {
              "type": "string",
              "maxLength": 10000
            },
            {
              "type": "null"
            }
          ]
        },
        "output_format": {
          "type": "string",
          "title": "Output Format",
          "default": "jpeg",
          "description": "Dictates the content-type of the generated image.",
          "enum": [
            "jpeg"
          ]
        },
        "prompt": {
          "type": "string",
          "title": "Prompt",
          "maxLength": 10000,
          "description": "What you wish to see in the output image. A strong, descriptive prompt that clearly defines elements, colors, and subjects will lead to better results."
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "minimum": 0,
          "exclusiveMaximum": 4294967296,
          "description": "The seed which governs generation. Changing the seed with other inputs fixed results in different outputs. (Use 0 for a random seed) 0 for a random seed"
        },
        "steps": {
          "type": "integer",
          "title": "Steps",
          "default": 50,
          "minimum": 5,
          "maximum": 100,
          "description": "The number of diffusion steps applied to generate an output image. The more steps, the longer the call will take, and up to a point, the higher quality the image will be."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "stabilityai/stable-diffusion-xl",
    "displayName": "stabilityai / stable-diffusion-xl",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-xl",
    "documentation": "https://docs.api.nvidia.com/nim/reference/stabilityai-stable-diffusion-xl-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:38.000Z",
    "purpose": "Generate an image from a text prompt (stabilityai/stable-diffusion-xl)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "image-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ImageRequest",
      "required": [
        "text_prompts"
      ],
      "properties": {
        "height": {
          "type": "integer",
          "title": "Height",
          "default": 1024,
          "minimum": 1024,
          "maximum": 1024,
          "description": "Height of the image to generate, in pixels. Only height=1024 is supported"
        },
        "width": {
          "type": "integer",
          "title": "Width",
          "default": 1024,
          "minimum": 1024,
          "maximum": 1024,
          "description": "Width of the image to generate, in pixels. Only width=1024 is supported"
        },
        "text_prompts": {
          "type": "array",
          "title": "Text Prompts",
          "minItems": 1,
          "maxItems": 2,
          "description": "An array of text prompts to use for generation",
          "items": {
            "type": "object",
            "title": "TextPrompt",
            "required": [
              "text"
            ],
            "properties": {
              "text": {
                "type": "string",
                "title": "Text",
                "description": "The prompt itself"
              },
              "weight": {
                "type": "number",
                "title": "Weight",
                "default": 1,
                "description": "Weight of the prompt, only weight=1.0 for prompt and weight=-1 for negative prompt is supported",
                "enum": [
                  1,
                  -1
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "cfg_scale": {
          "type": "number",
          "title": "Cfg Scale",
          "default": 5,
          "maximum": 9,
          "exclusiveMinimum": 1,
          "description": "How strictly the diffusion process adheres to the prompt text (higher values keep your image closer to your prompt)."
        },
        "clip_guidance_preset": {
          "type": "string",
          "title": "Clip Guidance Preset",
          "default": "NONE",
          "description": "clip guidance preset. Only clip_guidance_preset=`NONE` is supported",
          "enum": [
            "NONE"
          ]
        },
        "sampler": {
          "type": "string",
          "title": "Sampler",
          "default": "K_DPM_2_ANCESTRAL",
          "description": "The sampler to use for generation. Varying diffusion samplers will vary outputs significantly.",
          "enum": [
            "DDIM",
            "K_EULER_ANCESTRAL",
            "K_LMS",
            "K_DPM_2_ANCESTRAL"
          ]
        },
        "samples": {
          "type": "integer",
          "title": "Samples",
          "default": 1,
          "minimum": 1,
          "maximum": 1,
          "description": "Number of images to generate. Only samples=1 is supported"
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "minimum": 0,
          "exclusiveMaximum": 4294967296,
          "description": "The seed which governs generation. Omit this option or use 0 for a random seed"
        },
        "steps": {
          "type": "integer",
          "title": "Steps",
          "default": 25,
          "minimum": 5,
          "maximum": 100,
          "description": "Number of diffusion steps to run"
        },
        "style_preset": {
          "type": "string",
          "title": "Style Preset",
          "default": "none",
          "description": "Pass in a style preset to guide the image model towards a particular style. This list of style presets is subject to change. style_preset=`none` is supported",
          "enum": [
            "none"
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "stabilityai/stable-video-diffusion",
    "displayName": "stabilityai / stable-video-diffusion",
    "category": "visual-models-apis",
    "endpoint": "https://ai.api.nvidia.com/v1/genai/stabilityai/stable-video-diffusion",
    "documentation": "https://docs.api.nvidia.com/nim/reference/stabilityai-stable-video-diffusion-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:39.000Z",
    "purpose": "Generate a video from an input image (stabilityai/stable-video-diffusion)",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "video-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "VideoRequest",
      "required": [
        "image"
      ],
      "properties": {
        "image": {
          "type": "string",
          "title": "Image",
          "description": "A base64-encoded string of the initial image that will be scaled to 1024x576. Images should be in form of `data:image/{format};base64,{base64encodedimage}` if it's smaller than 200KB. Otherwise, it needs to be uploaded to a presigned S3 bucket using NVCF Asset APIs.Once uploaded you can refer to it using the following format: `data:image/png;asset_id,{asset_id}`.Accepted formats are `jpg`, `png` and `jpeg`."
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "minimum": 0,
          "exclusiveMaximum": 4294967296,
          "description": "The seed which governs generation. Omit this option or use 0 for a random seed"
        },
        "cfg_scale": {
          "type": "number",
          "title": "Cfg Scale",
          "default": 1.8,
          "maximum": 9,
          "exclusiveMinimum": 1,
          "description": "How strongly the video sticks to the original image. Use lower values to allow the model more freedom to make changes and higher values to correct motion distortions."
        },
        "motion_bucket_id": {
          "type": "integer",
          "title": "Motion Bucket Id",
          "default": 127,
          "minimum": 127,
          "maximum": 127,
          "description": "Controls how much motion to add/remove from the image. Only motion_bucket_id=127 is supported"
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false
  },
  {
    "id": "stepfun-ai/step-3.5-flash",
    "displayName": "stepfun-ai / step-3.5-flash",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/stepfun-ai-step-3-5-flash-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:09.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "stepfun-ai/step-3.5-flash"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant",
                  "tool"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_call_id": {
                "title": "Tool Call Id",
                "description": "The id of the tool call.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_calls": {
                "title": "Tool Calls",
                "description": "The tool(s) called by the model.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "title": "ToolCall",
                      "required": [
                        "function"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "title": "Id"
                        },
                        "type": {
                          "type": "string",
                          "title": "Type",
                          "default": "function",
                          "enum": [
                            "function"
                          ]
                        },
                        "function": {
                          "type": "object",
                          "title": "FunctionCall",
                          "required": [
                            "name",
                            "arguments"
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.9,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "tools": {
          "title": "Tools",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "ChatCompletionToolsParam",
                "required": [
                  "function"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "default": "function",
                    "enum": [
                      "function"
                    ]
                  },
                  "function": {
                    "type": "object",
                    "title": "FunctionDefinition",
                    "required": [
                      "name"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "title": "Name"
                      },
                      "description": {
                        "title": "Description",
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "parameters": {
                        "title": "Parameters",
                        "anyOf": [
                          {
                            "type": "object"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 262144,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "seed": {
          "title": "Seed",
          "default": null,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "stepfun-ai/step-3.7-flash",
    "displayName": "stepfun-ai / step-3.7-flash",
    "category": "visual-models-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/stepfun-ai-step-3-7-flash-infer",
    "documentationUpdatedAt": "2026-08-06T10:00:40.000Z",
    "purpose": "Creates a model response for a given chat",
    "agent": true,
    "agentCapabilitySource": "request-schema",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "stepfun-ai/step-3.7-flash"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant",
                  "tool"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message. <br>To pass media (only with role=`user`): <br> - Use content parts. Text is passed with `type`=`text`. <br> - Images are passed with `type`=`image_url`; set `image_url.url` to an image URL or a base64 data URI like `data:image/{format};base64,{base64encodedimage}`. <br>For `system` and `assistant` roles, the object list format is not supported.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "array",
                    "items": {
                      "anyOf": [
                        {
                          "type": "object",
                          "title": "ContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ]
                        },
                        {
                          "type": "object",
                          "title": "ContentPartText",
                          "required": [
                            "text",
                            "type"
                          ]
                        }
                      ]
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_call_id": {
                "title": "Tool Call Id",
                "description": "The id of the tool call.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "tool_calls": {
                "title": "Tool Calls",
                "description": "The tool(s) called by the model.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "title": "ToolCall",
                      "required": [
                        "function"
                      ],
                      "properties": {
                        "id": {
                          "type": "string",
                          "title": "Id"
                        },
                        "type": {
                          "type": "string",
                          "title": "Type",
                          "default": "function",
                          "enum": [
                            "function"
                          ]
                        },
                        "function": {
                          "type": "object",
                          "title": "FunctionCall",
                          "required": [
                            "name",
                            "arguments"
                          ]
                        }
                      },
                      "additionalProperties": false
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "tools": {
          "title": "Tools",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "object",
                "title": "ChatCompletionToolsParam",
                "required": [
                  "function"
                ],
                "properties": {
                  "type": {
                    "type": "string",
                    "title": "Type",
                    "default": "function",
                    "enum": [
                      "function"
                    ]
                  },
                  "function": {
                    "type": "object",
                    "title": "FunctionDefinition",
                    "required": [
                      "name"
                    ],
                    "properties": {
                      "name": {
                        "type": "string",
                        "title": "Name"
                      },
                      "description": {
                        "title": "Description",
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "parameters": {
                        "title": "Parameters",
                        "anyOf": [
                          {
                            "type": "object"
                          },
                          {
                            "type": "null"
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 262144,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "seed": {
          "title": "Seed",
          "default": null,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "stockmark/stockmark-2-100b-instruct",
    "displayName": "stockmark / stockmark-2-100b-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/stockmark-stockmark-2-100b-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:10.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "stockmark/stockmark-2-100b-instruct"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.7,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "minimum": 0,
          "maximum": 1,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "maximum": 4096,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "seed": {
          "title": "Seed",
          "default": null,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "thinkingmachines/inkling",
    "displayName": "thinking machines / inkling",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/thinkingmachines-inkling-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:12.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "thinkingmachines/inkling"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "title": "Content",
                "description": "The contents of the message.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 0.95,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 8192,
          "minimum": 1,
          "maximum": 16384,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "upstage/solar-10.7b-instruct",
    "displayName": "upstage / solar-10.7b-instruct",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/upstage-solar-10_7b-instruct-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:13.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "text-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatCompletionRequest",
      "description": "OpenAI ChatCompletionRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "upstage/solar-10.7b-instruct"
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 1024,
          "minimum": 1,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": false,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 0.5,
          "minimum": 0,
          "maximum": 1,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "frequency_penalty": {
          "type": "number",
          "title": "Frequency Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Indicates how much to penalize new tokens based on their existing frequency in the text so far, decreasing model likelihood to repeat the same line verbatim."
        },
        "presence_penalty": {
          "type": "number",
          "title": "Presence Penalty",
          "default": 0,
          "minimum": -2,
          "maximum": 2,
          "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing model likelihood to talk about new topics."
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "default": 0,
          "description": "The model generates random results. Changing the input seed alone will produce a different response with similar characteristics. It is possible to reproduce results by fixing the input seed (assuming all other hyperparameters are also fixed)."
        },
        "messages": {
          "title": "Messages",
          "maxItems": 1,
          "description": "A list of messages comprising the conversation so far.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": true
  },
  {
    "id": "z-ai/glm-5.2",
    "displayName": "z-ai / glm-5.2",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/z-ai-glm-5.2-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:16.000Z",
    "purpose": "Creates a model response for the given chat conversation (glm5.2",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "z-ai/glm-5.2"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 32768,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "seed": {
          "title": "Seed",
          "default": 42,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": true,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  },
  {
    "id": "z-ai/glm4.7",
    "displayName": "z-ai / glm4.7",
    "category": "llm-apis",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "documentation": "https://docs.api.nvidia.com/nim/reference/z-ai-glm4-7-infer",
    "documentationUpdatedAt": "2026-08-06T09:59:14.000Z",
    "purpose": "Creates a model response for the given chat conversation.",
    "agent": true,
    "agentCapabilitySource": "model-card",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "ChatRequest",
      "required": [
        "messages"
      ],
      "properties": {
        "model": {
          "type": "string",
          "title": "Model",
          "default": "z-ai/glm4.7"
        },
        "messages": {
          "type": "array",
          "title": "Messages",
          "description": "A list of messages comprising the conversation so far. The roles of the messages must be alternating between `user` and `assistant`. The last input message should have role `user`. A message with the the `system` role is optional, and must be the very first message if it is present; `context` is also optional, but must come before a user question.",
          "items": {
            "type": "object",
            "title": "Message",
            "required": [
              "role",
              "content"
            ],
            "properties": {
              "role": {
                "type": "string",
                "title": "Role",
                "description": "The role of the message author.",
                "enum": [
                  "system",
                  "context",
                  "user",
                  "assistant"
                ]
              },
              "content": {
                "type": "string",
                "title": "Content",
                "description": "The contents of the message."
              }
            },
            "additionalProperties": false
          }
        },
        "temperature": {
          "type": "number",
          "title": "Temperature",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The sampling temperature to use for text generation. The higher the temperature value is, the less deterministic the output text will be. It is not recommended to modify both temperature and top_p in the same call."
        },
        "top_p": {
          "type": "number",
          "title": "Top P",
          "default": 1,
          "maximum": 1,
          "exclusiveMinimum": 0,
          "description": "The top-p sampling mass used for text generation. The top-p value determines the probability mass that is sampled at sampling time. For example, if top_p = 0.2, only the most likely tokens (summing to 0.2 cumulative probability) will be sampled. It is not recommended to modify both temperature and top_p in the same call."
        },
        "max_tokens": {
          "type": "integer",
          "title": "Max Tokens",
          "default": 16384,
          "minimum": 1,
          "maximum": 32768,
          "description": "The maximum number of tokens to generate in any given call. Note that the model is not aware of this value, and generation will simply stop at the number of tokens specified."
        },
        "seed": {
          "title": "Seed",
          "default": 42,
          "description": "If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 18446744073709552000
            },
            {
              "type": "null"
            }
          ]
        },
        "stream": {
          "type": "boolean",
          "title": "Stream",
          "default": true,
          "description": "If set, partial message deltas will be sent. Tokens will be sent as data-only server-sent events (SSE) as they become available (JSON responses are prefixed by `data: `), with the stream terminated by a `data: [DONE]` message."
        },
        "stop": {
          "title": "Stop",
          "description": "A string or a list of strings where the API will stop generating further tokens. The returned text will not contain the stop sequence.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true
  }
]
