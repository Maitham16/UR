/**
 * Generated from each Free Endpoint model card's embedded NVIDIA inference contract.
 * Every route is model-specific; do not hand-edit or replace one with a generic endpoint.
 * Run `bun run provider:nvidia-catalog` to refresh from build.nvidia.com.
 */

export type NvidiaHostedCatalogContract = {
  id: string
  displayName: string
  category: 'agentic' | 'special'
  transport: 'http' | 'grpc' | 'unpublished'
  endpoint: string
  method: string
  rpcService?: string
  rpcMethod?: string
  functionId?: string
  documentation: string
  buildCard: string
  documentationUpdatedAt?: string
  available: boolean
  executable: boolean
  purpose: string
  agent: boolean
  agentCapabilitySource: 'request-schema' | 'model-card' | 'none'
  taskKind?: string
  requestContentType: string
  requestSchema: Record<string, unknown>
  responseSchema: Record<string, unknown>
  responseMediaTypes: string[]
  supportsStreaming: boolean
  inputHint: string
  outputHint: string
}

export const NVIDIA_HOSTED_CATALOG_REVIEWED_AT = "2026-09-01T11:00:01.319Z"
export const NVIDIA_BUILD_INDEX_MODEL_COUNT = 100
export const NVIDIA_BUILD_FREE_ENDPOINT_COUNT = 36
export const NVIDIA_BUILD_EXECUTABLE_ENDPOINT_COUNT = 35

export const NVIDIA_HOSTED_MODEL_CONTRACTS: readonly NvidiaHostedCatalogContract[] = [
  {
    "id": "deepseek-ai/deepseek-v4-flash-0731",
    "displayName": "deepseek-ai / deepseek-v4-flash-0731",
    "category": "agentic",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "281478d0-f307-49f4-9e0f-080b63b16c47",
    "documentation": "https://docs.api.nvidia.com/nim/reference/deepseek-ai-deepseek-v4-flash-0731",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/deepseek-v4-flash-0731",
    "documentationUpdatedAt": "2026-08-25T00:04:19.267Z",
    "available": false,
    "executable": true,
    "purpose": "284B MoE (13B active) model ideal for long-context workloads optimized for coding, chat, and agentic workflows",
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "deepseek-ai/deepseek-v4-pro-0813",
    "displayName": "deepseek-ai / deepseek-v4-pro-0813",
    "category": "agentic",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "6e70713f-4eeb-4ef7-b4f8-2d984f4141f6",
    "documentation": "https://docs.api.nvidia.com/nim/reference/deepseek-ai-deepseek-v4-pro-0813",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/deepseek-v4-pro-0813",
    "documentationUpdatedAt": "2026-08-26T22:53:11.353Z",
    "available": false,
    "executable": true,
    "purpose": "DeepSeek V4 scales to 1M-token context windows with efficient MoE architecture for coding tasks.",
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "google/diffusiongemma-26b-a4b-it",
    "displayName": "google / diffusiongemma-26b-a4b-it",
    "category": "special",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "ffd13b18-1c55-4a7a-b71a-acbfde9ce8a0",
    "documentation": "https://docs.api.nvidia.com/nim/reference/diffusiongemma-26b-a4b-it",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/diffusiongemma-26b-a4b-it",
    "documentationUpdatedAt": "2026-08-10T20:29:39.712Z",
    "available": true,
    "executable": true,
    "purpose": "Diffusion-based 26B parameter LLM enabling parallel token generation for real-time text apps",
    "agent": false,
    "agentCapabilitySource": "model-card",
    "taskKind": "text-generation",
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
                          ],
                          "properties": {
                            "image_url": {
                              "type": "object",
                              "title": "ImageURL",
                              "required": [
                                "url"
                              ],
                              "properties": {
                                "url": {
                                  "type": "string",
                                  "title": "Url"
                                }
                              }
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "image_url",
                              "enum": [
                                "image_url"
                              ]
                            }
                          }
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartVideo",
                          "required": [
                            "type",
                            "video_url"
                          ],
                          "properties": {
                            "video_url": {
                              "description": "Video url",
                              "allOf": [
                                {
                                  "type": "object",
                                  "title": "VideoURL",
                                  "required": [
                                    "url"
                                  ]
                                }
                              ]
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "video_url",
                              "description": "The type of the content part.",
                              "enum": [
                                "video_url"
                              ]
                            }
                          },
                          "additionalProperties": false
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ],
                          "properties": {
                            "text": {
                              "type": "string",
                              "title": "Text"
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "text",
                              "enum": [
                                "text"
                              ]
                            }
                          }
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletionResponse",
      "required": [
        "model",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "title": "Id"
        },
        "object": {
          "type": "string",
          "title": "Object",
          "default": "chat.completion",
          "const": "chat.completion",
          "enum": [
            "chat.completion"
          ]
        },
        "created": {
          "type": "integer",
          "title": "Created"
        },
        "model": {
          "type": "string",
          "title": "Model"
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "items": {
            "type": "object",
            "title": "ChatCompletionResponseChoice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index"
              },
              "message": {
                "type": "object",
                "title": "ChatMessage",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "title": "Role"
                  },
                  "content": {
                    "title": "Content",
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
              "finish_reason": {
                "title": "Finish Reason",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "stop_reason": {
                "title": "Stop Reason",
                "anyOf": [
                  {
                    "type": "integer"
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
          }
        },
        "usage": {
          "type": "object",
          "title": "UsageInfo",
          "properties": {
            "prompt_tokens": {
              "type": "integer",
              "title": "Prompt Tokens",
              "default": 0
            },
            "total_tokens": {
              "type": "integer",
              "title": "Total Tokens",
              "default": 0
            },
            "completion_tokens": {
              "title": "Completion Tokens",
              "default": 0,
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
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Request response from the model",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "google/gemma-4-31b-it",
    "displayName": "google / gemma-4-31b-it",
    "category": "agentic",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "48c619ec-c254-48da-8fcc-6ef8a04fed6e",
    "documentation": "https://docs.api.nvidia.com/nim/reference/google-gemma-4-31b-it",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/gemma-4-31b-it",
    "documentationUpdatedAt": "2026-08-10T20:29:42.114Z",
    "available": true,
    "executable": true,
    "purpose": "Dense 31B model delivering frontier reasoning for coding, agentic workflows, and fine-tuning.",
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
                          ],
                          "properties": {
                            "image_url": {
                              "type": "object",
                              "title": "ImageURL",
                              "required": [
                                "url"
                              ],
                              "properties": {
                                "url": {
                                  "type": "string",
                                  "title": "Url"
                                }
                              }
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "image_url",
                              "enum": [
                                "image_url"
                              ]
                            }
                          }
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartVideo",
                          "required": [
                            "type",
                            "video_url"
                          ],
                          "properties": {
                            "video_url": {
                              "description": "Video url",
                              "allOf": [
                                {
                                  "type": "object",
                                  "title": "VideoURL",
                                  "required": [
                                    "url"
                                  ]
                                }
                              ]
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "video_url",
                              "description": "The type of the content part.",
                              "enum": [
                                "video_url"
                              ]
                            }
                          },
                          "additionalProperties": false
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ],
                          "properties": {
                            "text": {
                              "type": "string",
                              "title": "Text"
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "text",
                              "enum": [
                                "text"
                              ]
                            }
                          }
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletionResponse",
      "required": [
        "model",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "title": "Id"
        },
        "object": {
          "type": "string",
          "title": "Object",
          "default": "chat.completion",
          "const": "chat.completion",
          "enum": [
            "chat.completion"
          ]
        },
        "created": {
          "type": "integer",
          "title": "Created"
        },
        "model": {
          "type": "string",
          "title": "Model"
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "items": {
            "type": "object",
            "title": "ChatCompletionResponseChoice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index"
              },
              "message": {
                "type": "object",
                "title": "ChatMessage",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "title": "Role"
                  },
                  "content": {
                    "title": "Content",
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
              "finish_reason": {
                "title": "Finish Reason",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "stop_reason": {
                "title": "Stop Reason",
                "anyOf": [
                  {
                    "type": "integer"
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
          }
        },
        "usage": {
          "type": "object",
          "title": "UsageInfo",
          "properties": {
            "prompt_tokens": {
              "type": "integer",
              "title": "Prompt Tokens",
              "default": 0
            },
            "total_tokens": {
              "type": "integer",
              "title": "Total Tokens",
              "default": 0
            },
            "completion_tokens": {
              "title": "Completion Tokens",
              "default": 0,
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
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Request response from the model",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "google/paligemma",
    "displayName": "google / paligemma",
    "category": "special",
    "transport": "http",
    "endpoint": "https://ai.api.nvidia.com/v1/vlm/google/paligemma",
    "method": "POST",
    "functionId": "a70e7356-c643-41b3-9a7e-b89ea1e7dea1",
    "documentation": "https://docs.api.nvidia.com/nim/reference/google-paligemma",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/google-paligemma",
    "documentationUpdatedAt": "2026-08-10T20:29:42.638Z",
    "available": true,
    "executable": true,
    "purpose": "Vision language model adept at comprehending text and visual inputs to produce informative responses",
    "agent": false,
    "agentCapabilitySource": "model-card",
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
                          ],
                          "properties": {
                            "type": {
                              "title": "Type",
                              "const": "text",
                              "description": "The type of the content part."
                            },
                            "text": {
                              "type": "string",
                              "title": "Text",
                              "maxLength": 204800,
                              "description": "The text content that will be rendered as a header on the input image."
                            }
                          },
                          "additionalProperties": false
                        },
                        {
                          "type": "object",
                          "title": "UserImageContent",
                          "required": [
                            "type",
                            "image_url"
                          ],
                          "properties": {
                            "type": {
                              "title": "Type",
                              "const": "image_url",
                              "description": "The type of the content part."
                            },
                            "image_url": {
                              "type": "object",
                              "title": "Image Url",
                              "required": [
                                "url"
                              ],
                              "properties": {
                                "url": {
                                  "type": "string",
                                  "title": "Url",
                                  "maxLength": 204800,
                                  "description": "The image URL or base64 data URI."
                                }
                              },
                              "additionalProperties": false
                            }
                          },
                          "additionalProperties": false
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "maxLength": 36,
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "maxItems": 1,
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "default": 0,
                "minimum": 0,
                "exclusiveMaximum": 1,
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "minimum": 0,
                  "maximum": 1024,
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "minimum": 0,
                  "maximum": 3072,
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "minimum": 0,
                  "maximum": 4096,
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Request response from the model",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "meta/llama-guard-4-12b",
    "displayName": "meta / llama-guard-4-12b",
    "category": "special",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "c8bf7301-6433-4043-a427-57633c6ac335",
    "documentation": "https://docs.api.nvidia.com/nim/reference/meta-llama-guard-4-12b",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/llama-guard-4-12b",
    "documentationUpdatedAt": "2026-08-10T20:29:46.904Z",
    "available": false,
    "executable": true,
    "purpose": "Multi-modal model to classify safety for input prompts as well output responses.",
    "agent": false,
    "agentCapabilitySource": "model-card",
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
                          ],
                          "properties": {
                            "image_url": {
                              "type": "object",
                              "title": "ImageURL",
                              "required": [
                                "url"
                              ],
                              "properties": {
                                "url": {
                                  "type": "string",
                                  "title": "Url"
                                }
                              }
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "image_url",
                              "enum": [
                                "image_url"
                              ]
                            }
                          }
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ],
                          "properties": {
                            "text": {
                              "type": "string",
                              "title": "Text"
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "text",
                              "enum": [
                                "text"
                              ]
                            }
                          }
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletionResponse",
      "required": [
        "model",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "title": "Id"
        },
        "object": {
          "type": "string",
          "title": "Object",
          "default": "chat.completion",
          "const": "chat.completion",
          "enum": [
            "chat.completion"
          ]
        },
        "created": {
          "type": "integer",
          "title": "Created"
        },
        "model": {
          "type": "string",
          "title": "Model"
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "items": {
            "type": "object",
            "title": "ChatCompletionResponseChoice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index"
              },
              "message": {
                "type": "object",
                "title": "ChatMessage",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "title": "Role"
                  },
                  "content": {
                    "title": "Content",
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
              "finish_reason": {
                "title": "Finish Reason",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "stop_reason": {
                "title": "Stop Reason",
                "anyOf": [
                  {
                    "type": "integer"
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
          }
        },
        "usage": {
          "type": "object",
          "title": "UsageInfo",
          "properties": {
            "prompt_tokens": {
              "type": "integer",
              "title": "Prompt Tokens",
              "default": 0
            },
            "total_tokens": {
              "type": "integer",
              "title": "Total Tokens",
              "default": 0
            },
            "completion_tokens": {
              "title": "Completion Tokens",
              "default": 0,
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
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Request response from the model",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "meta/muse-glimmer-30b",
    "displayName": "meta / muse-glimmer-30b",
    "category": "agentic",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "fd21cc19-b4ff-4949-ba07-90dd663c416a",
    "documentation": "https://docs.api.nvidia.com/nim/reference/meta-muse-glimmer-30b",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/muse-glimmer-30b",
    "documentationUpdatedAt": "2026-08-18T12:38:16.340Z",
    "available": true,
    "executable": true,
    "purpose": "Muse Glimmer 30B is a multimodal reasoning model accepting text and images, with native tool-calling and separate reasoning output.",
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
        "reasoning_effort": {
          "type": "string",
          "title": "Reasoning Effort",
          "default": "high",
          "description": "Controls Inkling's reasoning effort. The levels map to `0.0`, `0.1`, `0.2`, `0.7`, `0.9`, and `0.99`, respectively.",
          "enum": [
            "none",
            "minimal",
            "low",
            "medium",
            "high",
            "max"
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "minimaxai/minimax-m3",
    "displayName": "minimaxai / minimax-m3",
    "category": "agentic",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "87ea0ddc-cff1-4bca-bf8b-3bd98a35ddd0",
    "documentation": "https://docs.api.nvidia.com/nim/reference/minimaxai-minimax-m3",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/minimax-m3",
    "documentationUpdatedAt": "2026-08-28T21:49:02.422Z",
    "available": false,
    "executable": true,
    "purpose": "MiniMax M3 Preview is a multimodal MoE vision-language model with strong reasoning, coding, and tool-calling capabilities.",
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
                          ],
                          "properties": {
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "text",
                              "enum": [
                                "text"
                              ]
                            },
                            "text": {
                              "type": "string",
                              "title": "Text"
                            }
                          }
                        },
                        {
                          "type": "object",
                          "title": "ContentPartImage",
                          "required": [
                            "type",
                            "image_url"
                          ],
                          "properties": {
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "image_url",
                              "enum": [
                                "image_url"
                              ]
                            },
                            "image_url": {
                              "type": "object",
                              "title": "ImageURL",
                              "required": [
                                "url"
                              ],
                              "properties": {
                                "url": {
                                  "type": "string",
                                  "title": "Url",
                                  "description": "A public image URL or a base64 data URI (data:image/<format>;base64,<data>)."
                                }
                              }
                            }
                          }
                        },
                        {
                          "type": "object",
                          "title": "ContentPartVideo",
                          "required": [
                            "type",
                            "video_url"
                          ],
                          "properties": {
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "video_url",
                              "enum": [
                                "video_url"
                              ]
                            },
                            "video_url": {
                              "type": "object",
                              "title": "VideoURL",
                              "required": [
                                "url"
                              ],
                              "properties": {
                                "url": {
                                  "type": "string",
                                  "title": "Url",
                                  "description": "A public video URL or a base64 data URI (data:video/mp4;base64,<data>)."
                                }
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
                          "const": "function",
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
                          ],
                          "properties": {
                            "name": {
                              "type": "string",
                              "title": "Name"
                            },
                            "arguments": {
                              "type": "string",
                              "title": "Arguments",
                              "description": "Function arguments as a JSON-encoded string."
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
                    "const": "function",
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
                  "const": "function",
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                                  "const": "function",
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length",
                      "tool_calls"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "mistralai/mistral-nemotron",
    "displayName": "mistralai / mistral-nemotron",
    "category": "agentic",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "f81394d8-63c0-4023-afa2-7ad11aa54ca3",
    "documentation": "https://docs.api.nvidia.com/nim/reference/mistralai-mistral-nemotron",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/mistral-nemotron",
    "documentationUpdatedAt": "2026-08-20T21:30:05.735Z",
    "available": false,
    "executable": true,
    "purpose": "Built for agentic workflows, this model excels in coding, instruction following, and function calling",
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "moonshotai/kimi-k3",
    "displayName": "moonshotai / kimi-k3",
    "category": "agentic",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "1586112a-925c-48af-8631-7c815dbd749c",
    "documentation": "https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/kimi-k3",
    "documentationUpdatedAt": "2026-08-31T04:55:35.006Z",
    "available": true,
    "executable": true,
    "purpose": "~2.8T hybrid KDA+MLA multimodal MoE for long-horizon coding, agentic tool use, and image understanding.",
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
                          ],
                          "properties": {
                            "image_url": {
                              "type": "object",
                              "title": "ImageURL",
                              "required": [
                                "url"
                              ],
                              "properties": {
                                "url": {
                                  "type": "string",
                                  "title": "Url"
                                }
                              }
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "image_url",
                              "enum": [
                                "image_url"
                              ]
                            }
                          }
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ],
                          "properties": {
                            "text": {
                              "type": "string",
                              "title": "Text"
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "text",
                              "enum": [
                                "text"
                              ]
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
                    "const": "function",
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletionResponse",
      "required": [
        "model",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "title": "Id"
        },
        "object": {
          "type": "string",
          "title": "Object",
          "default": "chat.completion",
          "const": "chat.completion",
          "enum": [
            "chat.completion"
          ]
        },
        "created": {
          "type": "integer",
          "title": "Created"
        },
        "model": {
          "type": "string",
          "title": "Model"
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "items": {
            "type": "object",
            "title": "ChatCompletionResponseChoice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index"
              },
              "message": {
                "type": "object",
                "title": "ChatMessage",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "title": "Role"
                  },
                  "content": {
                    "title": "Content",
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
              "finish_reason": {
                "title": "Finish Reason",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "stop_reason": {
                "title": "Stop Reason",
                "anyOf": [
                  {
                    "type": "integer"
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
          }
        },
        "usage": {
          "type": "object",
          "title": "UsageInfo",
          "properties": {
            "prompt_tokens": {
              "type": "integer",
              "title": "Prompt Tokens",
              "default": 0
            },
            "total_tokens": {
              "type": "integer",
              "title": "Total Tokens",
              "default": 0
            },
            "completion_tokens": {
              "title": "Completion Tokens",
              "default": 0,
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
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Request response from the model",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "nvidia/active-speaker-detection",
    "displayName": "nvidia / Active Speaker Detection",
    "category": "special",
    "transport": "grpc",
    "endpoint": "grpc.nvcf.nvidia.com:443",
    "method": "BIDIRECTIONAL_STREAM",
    "rpcService": "nvidia.ai4m.activespeakerdetection.v1.ActiveSpeakerDetectionService",
    "rpcMethod": "DetectActiveSpeaker",
    "functionId": "f286f937-05c4-454b-8312-fba67a2a6fa7",
    "documentation": "https://docs.nvidia.com/nim/maxine/active-speaker-detection/latest/overview.html",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/active-speaker-detection",
    "documentationUpdatedAt": "2026-08-05T19:00:21.180Z",
    "available": true,
    "executable": true,
    "purpose": "Detect and track speaker identities across video frames.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "active-speaker-detection",
    "requestContentType": "application/grpc+proto",
    "requestSchema": {
      "type": "object",
      "required": [
        "video_path",
        "diarization_path"
      ],
      "properties": {
        "video_path": {
          "type": "string",
          "description": "H.264 MP4 input path."
        },
        "audio_path": {
          "type": "string",
          "description": "Optional separate WAV, MP3, or Opus audio path."
        },
        "diarization_path": {
          "type": "string",
          "description": "Optional word-level speaker diarization JSON path."
        },
        "speaker_detection_threshold": {
          "type": "number",
          "exclusiveMinimum": 0,
          "exclusiveMaximum": 1
        }
      }
    },
    "responseSchema": {
      "type": "object",
      "properties": {
        "frames": {
          "type": "array",
          "description": "Per-frame bounding boxes, face IDs, speaker IDs, speaking flags, and confidence scores."
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": true,
    "inputHint": "Streams H.264 MP4 video with optional separate audio and diarization data.",
    "outputHint": "Returns per-frame active-speaker detections as structured JSON."
  },
  {
    "id": "nvidia/bevformer",
    "displayName": "nvidia / bevformer",
    "category": "special",
    "transport": "http",
    "endpoint": "https://9b12b22f-f97f-4141-86af-a7deb04a21a5.invocation.api.nvcf.nvidia.com/v1/bevformer/process",
    "method": "POST",
    "functionId": "9b12b22f-f97f-4141-86af-a7deb04a21a5",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-bevformer",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/bevformer",
    "documentationUpdatedAt": "2026-08-10T20:29:37.702Z",
    "available": false,
    "executable": true,
    "purpose": "Advanced transformer for multi-frame bird's-eye-view 3D perception in autonomous driving.",
    "agent": false,
    "agentCapabilitySource": "model-card",
    "taskKind": "autonomous-driving",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "BevFormerRequest",
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
    "responseSchema": {
      "type": "object",
      "title": "BevFormerResponse",
      "required": [
        "inference_metadata",
        "camera_video",
        "bev_video"
      ],
      "properties": {
        "inference_metadata": {
          "type": "object",
          "title": "InferenceMetadata",
          "properties": {
            "data": {
              "title": "Data",
              "description": "Inference results and metadata",
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
        },
        "camera_video": {
          "type": "object",
          "title": "CameraVideo",
          "properties": {
            "data": {
              "title": "Data",
              "description": "Base64 encoded video data",
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "mime_type": {
              "title": "Mime Type",
              "description": "MIME type of the video",
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "metadata": {
              "anyOf": [
                {
                  "type": "object",
                  "title": "Metadata",
                  "properties": {
                    "size_bytes": {
                      "title": "Size Bytes",
                      "description": "Original video size in bytes",
                      "anyOf": [
                        {
                          "type": "integer"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "duration": {
                      "title": "Duration",
                      "description": "Video duration in seconds",
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
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        },
        "bev_video": {
          "type": "object",
          "title": "BevVideo",
          "properties": {
            "data": {
              "title": "Data",
              "description": "Base64 encoded video data",
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "mime_type": {
              "title": "Mime Type",
              "description": "MIME type of the video",
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "metadata": {
              "anyOf": [
                {
                  "type": "object",
                  "title": "Metadata",
                  "properties": {
                    "size_bytes": {
                      "title": "Size Bytes",
                      "description": "Original video size in bytes",
                      "anyOf": [
                        {
                          "type": "integer"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "duration": {
                      "title": "Duration",
                      "description": "Video duration in seconds",
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
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false,
    "inputHint": "Post V1 Bevformer Process",
    "outputHint": "Generate annotated videos using BEVFormer model for a selected scene.\n\nArgs:\n    body (BevFormerRequest): Input request containing scene_id and optional config\nExample scene_id values include:\n 'scene-0103': Yield to left-turning vehicle at Boston intersection\n 'scene-0916': Navigate a bus stop parking lot in Singapore\n 'scene-1073': Left turn at a busy nighttime intersection in Singapore\n 'scene-0061': Follow vehicle into construction zone in Singapore\n \n Returns:\n    BevFormerResponse: Response containing both camera and BEV videos\n    Error: When processing fails, returns appropriate error response"
  },
  {
    "id": "nvidia/bnr",
    "displayName": "nvidia / Background Noise Removal",
    "category": "special",
    "transport": "grpc",
    "endpoint": "grpc.nvcf.nvidia.com:443",
    "method": "BIDIRECTIONAL_STREAM",
    "rpcService": "nvidia.ai4m.bnr.v1.BNR",
    "rpcMethod": "EnhanceAudio",
    "functionId": "c95bfe76-c553-4975-bc18-8ef9d6e2666b",
    "documentation": "https://docs.nvidia.com/nim/maxine/bnr/latest/overview.html",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/bnr",
    "documentationUpdatedAt": "2026-08-05T18:59:17.326Z",
    "available": true,
    "executable": true,
    "purpose": "Removes unwanted noises from audio improving speech intelligibility.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "audio-enhancement",
    "requestContentType": "application/grpc+proto",
    "requestSchema": {
      "type": "object",
      "required": [
        "audio_path"
      ],
      "properties": {
        "audio_path": {
          "type": "string",
          "description": "Input WAV audio path."
        },
        "intensity_ratio": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        }
      }
    },
    "responseSchema": {
      "type": "string",
      "format": "binary",
      "description": "Enhanced WAV audio."
    },
    "responseMediaTypes": [
      "audio/wav"
    ],
    "supportsStreaming": true,
    "inputHint": "Streams one WAV audio file, optionally with an intensity ratio from 0 to 1.",
    "outputHint": "Returns the enhanced WAV audio stream."
  },
  {
    "id": "nvidia/cosmos-transfer1-7b",
    "displayName": "nvidia / cosmos-transfer1-7b",
    "category": "special",
    "transport": "http",
    "endpoint": "https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos-transfer1-7b",
    "method": "POST",
    "functionId": "abb63707-47ee-497c-81a3-37e685bacdc6",
    "documentation": "https://build.nvidia.com/qc69jvmznzxy/cosmos-transfer1-7b/api",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/cosmos-transfer1-7b",
    "documentationUpdatedAt": "2026-08-28T22:50:03.608Z",
    "available": false,
    "executable": true,
    "purpose": "Generates physics-aware video world states for physical AI development using text prompts and multiple spatial control inputs derived from real-world data or simulation.",
    "agent": false,
    "agentCapabilitySource": "model-card",
    "taskKind": "video-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "Transfer1Request",
      "required": [
        "prompt",
        "video"
      ],
      "properties": {
        "prompt": {
          "type": "string",
          "title": "Prompt",
          "description": "Prompt which the sampled video conditions on"
        },
        "negative_prompt": {
          "title": "Negative Prompt",
          "default": "The video captures a series of frames showing ugly scenes, static with no motion, motion blur, over-saturation, shaky footage, low resolution, grainy texture, pixelated images, poorly lit areas, underexposed and overexposed scenes, poor color balance, washed out colors, choppy sequences, jerky movements, low frame rate, artifacting, color banding, unnatural transitions, outdated special effects, fake elements, unconvincing visuals, poorly edited content, jump cuts, visual noise, and flickering. Overall, the video is of poor quality.",
          "description": "Negative prompt which the sampled video conditions on",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "prompt_upsampling": {
          "type": "boolean",
          "title": "Prompt Upsampling",
          "default": false,
          "description": "Whether to use prompt upsampling before generation"
        },
        "video": {
          "type": "string",
          "title": "Video",
          "description": "Video to condition on, public URL or base64 encoded video. Codecs: h264 or vp9. Number of frames >= 9."
        },
        "seed": {
          "title": "Seed",
          "description": "Random seed",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "guidance_scale": {
          "type": "number",
          "title": "Guidance Scale",
          "default": 7,
          "minimum": 1,
          "maximum": 20,
          "description": "Classifier-free guidance scale"
        },
        "steps": {
          "type": "integer",
          "title": "Steps",
          "default": 35,
          "minimum": 1,
          "maximum": 50,
          "description": "Number of diffusion sampling steps"
        },
        "video_params": {
          "type": "object",
          "title": "VideoParams",
          "properties": {
            "frames_count": {
              "type": "integer",
              "title": "Frames Count",
              "default": 121,
              "const": 121,
              "description": "Number of frames of the output video"
            },
            "frames_per_sec": {
              "type": "integer",
              "title": "Frames Per Sec",
              "default": 24,
              "minimum": 12,
              "maximum": 40,
              "description": "Number of FPS (frames per seconds) of the output video"
            }
          },
          "additionalProperties": false
        },
        "vis": {
          "description": "Visual control input parameters",
          "anyOf": [
            {
              "type": "object",
              "title": "ControlInput",
              "properties": {
                "control_weight": {
                  "type": "number",
                  "title": "Control Weight",
                  "default": 0.5,
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Weight for the control input"
                },
                "control_weight_prompt": {
                  "title": "Control Weight Prompt",
                  "description": "Optional prompt to guide the control input",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control": {
                  "title": "Input Control",
                  "description": "Optional video input for control, public URL or base64 encoded video",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control_prompt": {
                  "title": "Input Control Prompt",
                  "description": "Optional prompt to guide the input control generation, only used for 'seg' control input",
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
            {
              "type": "null"
            }
          ]
        },
        "edge": {
          "description": "Edge control input parameters",
          "anyOf": [
            {
              "type": "object",
              "title": "ControlInput",
              "properties": {
                "control_weight": {
                  "type": "number",
                  "title": "Control Weight",
                  "default": 0.5,
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Weight for the control input"
                },
                "control_weight_prompt": {
                  "title": "Control Weight Prompt",
                  "description": "Optional prompt to guide the control input",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control": {
                  "title": "Input Control",
                  "description": "Optional video input for control, public URL or base64 encoded video",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control_prompt": {
                  "title": "Input Control Prompt",
                  "description": "Optional prompt to guide the input control generation, only used for 'seg' control input",
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
            {
              "type": "null"
            }
          ]
        },
        "depth": {
          "description": "Depth control input parameters",
          "anyOf": [
            {
              "type": "object",
              "title": "ControlInput",
              "properties": {
                "control_weight": {
                  "type": "number",
                  "title": "Control Weight",
                  "default": 0.5,
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Weight for the control input"
                },
                "control_weight_prompt": {
                  "title": "Control Weight Prompt",
                  "description": "Optional prompt to guide the control input",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control": {
                  "title": "Input Control",
                  "description": "Optional video input for control, public URL or base64 encoded video",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control_prompt": {
                  "title": "Input Control Prompt",
                  "description": "Optional prompt to guide the input control generation, only used for 'seg' control input",
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
            {
              "type": "null"
            }
          ]
        },
        "seg": {
          "description": "Segmentation control input parameters",
          "anyOf": [
            {
              "type": "object",
              "title": "ControlInput",
              "properties": {
                "control_weight": {
                  "type": "number",
                  "title": "Control Weight",
                  "default": 0.5,
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Weight for the control input"
                },
                "control_weight_prompt": {
                  "title": "Control Weight Prompt",
                  "description": "Optional prompt to guide the control input",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control": {
                  "title": "Input Control",
                  "description": "Optional video input for control, public URL or base64 encoded video",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control_prompt": {
                  "title": "Input Control Prompt",
                  "description": "Optional prompt to guide the input control generation, only used for 'seg' control input",
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
            {
              "type": "null"
            }
          ]
        },
        "keypoint": {
          "description": "Keypoint control input parameters",
          "anyOf": [
            {
              "type": "object",
              "title": "ControlInput",
              "properties": {
                "control_weight": {
                  "type": "number",
                  "title": "Control Weight",
                  "default": 0.5,
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Weight for the control input"
                },
                "control_weight_prompt": {
                  "title": "Control Weight Prompt",
                  "description": "Optional prompt to guide the control input",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control": {
                  "title": "Input Control",
                  "description": "Optional video input for control, public URL or base64 encoded video",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control_prompt": {
                  "title": "Input Control Prompt",
                  "description": "Optional prompt to guide the input control generation, only used for 'seg' control input",
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
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseSchema": {
      "type": "object",
      "title": "Transfer1Response",
      "required": [
        "b64_video",
        "seed"
      ],
      "properties": {
        "b64_video": {
          "type": "string",
          "title": "B64 Video",
          "description": "The generated video as mp4, encoded in base64"
        },
        "upsampled_prompt": {
          "title": "Upsampled Prompt",
          "description": "If prompt upsampling was enabled, the upsampled prompt",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "description": "Seed used for generation"
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false,
    "inputHint": "Infer",
    "outputHint": "Returns the response documented by NVIDIA for this model."
  },
  {
    "id": "nvidia/cosmos-transfer2_5-2b",
    "displayName": "nvidia / cosmos-transfer2.5-2b",
    "category": "special",
    "transport": "http",
    "endpoint": "https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos-transfer1-7b",
    "method": "POST",
    "functionId": "a87ff22e-a2d0-496f-acb0-91df59a88f64",
    "documentation": "https://build.nvidia.com/qc69jvmznzxy/cosmos-transfer2_5-2b/api",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/cosmos-transfer2_5-2b",
    "documentationUpdatedAt": "2026-08-20T22:23:28.919Z",
    "available": false,
    "executable": true,
    "purpose": "Generates physics-aware video world states for physical AI development using text prompts and multiple spatial control inputs derived from real-world data or simulation.",
    "agent": false,
    "agentCapabilitySource": "model-card",
    "taskKind": "video-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "Transfer1Request",
      "required": [
        "prompt",
        "video"
      ],
      "properties": {
        "prompt": {
          "type": "string",
          "title": "Prompt",
          "description": "Prompt which the sampled video conditions on"
        },
        "negative_prompt": {
          "title": "Negative Prompt",
          "default": "The video captures a series of frames showing ugly scenes, static with no motion, motion blur, over-saturation, shaky footage, low resolution, grainy texture, pixelated images, poorly lit areas, underexposed and overexposed scenes, poor color balance, washed out colors, choppy sequences, jerky movements, low frame rate, artifacting, color banding, unnatural transitions, outdated special effects, fake elements, unconvincing visuals, poorly edited content, jump cuts, visual noise, and flickering. Overall, the video is of poor quality.",
          "description": "Negative prompt which the sampled video conditions on",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "prompt_upsampling": {
          "type": "boolean",
          "title": "Prompt Upsampling",
          "default": false,
          "description": "Whether to use prompt upsampling before generation"
        },
        "video": {
          "type": "string",
          "title": "Video",
          "description": "Video to condition on, public URL or base64 encoded video. Codecs: h264 or vp9. Number of frames >= 9."
        },
        "seed": {
          "title": "Seed",
          "description": "Random seed",
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ]
        },
        "guidance_scale": {
          "type": "number",
          "title": "Guidance Scale",
          "default": 7,
          "minimum": 1,
          "maximum": 20,
          "description": "Classifier-free guidance scale"
        },
        "steps": {
          "type": "integer",
          "title": "Steps",
          "default": 35,
          "minimum": 1,
          "maximum": 50,
          "description": "Number of diffusion sampling steps"
        },
        "video_params": {
          "type": "object",
          "title": "VideoParams",
          "properties": {
            "frames_count": {
              "type": "integer",
              "title": "Frames Count",
              "default": 121,
              "const": 121,
              "description": "Number of frames of the output video"
            },
            "frames_per_sec": {
              "type": "integer",
              "title": "Frames Per Sec",
              "default": 24,
              "minimum": 12,
              "maximum": 40,
              "description": "Number of FPS (frames per seconds) of the output video"
            }
          },
          "additionalProperties": false
        },
        "vis": {
          "description": "Visual control input parameters",
          "anyOf": [
            {
              "type": "object",
              "title": "ControlInput",
              "properties": {
                "control_weight": {
                  "type": "number",
                  "title": "Control Weight",
                  "default": 0.5,
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Weight for the control input"
                },
                "control_weight_prompt": {
                  "title": "Control Weight Prompt",
                  "description": "Optional prompt to guide the control input",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control": {
                  "title": "Input Control",
                  "description": "Optional video input for control, public URL or base64 encoded video",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control_prompt": {
                  "title": "Input Control Prompt",
                  "description": "Optional prompt to guide the input control generation, only used for 'seg' control input",
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
            {
              "type": "null"
            }
          ]
        },
        "edge": {
          "description": "Edge control input parameters",
          "anyOf": [
            {
              "type": "object",
              "title": "ControlInput",
              "properties": {
                "control_weight": {
                  "type": "number",
                  "title": "Control Weight",
                  "default": 0.5,
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Weight for the control input"
                },
                "control_weight_prompt": {
                  "title": "Control Weight Prompt",
                  "description": "Optional prompt to guide the control input",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control": {
                  "title": "Input Control",
                  "description": "Optional video input for control, public URL or base64 encoded video",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control_prompt": {
                  "title": "Input Control Prompt",
                  "description": "Optional prompt to guide the input control generation, only used for 'seg' control input",
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
            {
              "type": "null"
            }
          ]
        },
        "depth": {
          "description": "Depth control input parameters",
          "anyOf": [
            {
              "type": "object",
              "title": "ControlInput",
              "properties": {
                "control_weight": {
                  "type": "number",
                  "title": "Control Weight",
                  "default": 0.5,
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Weight for the control input"
                },
                "control_weight_prompt": {
                  "title": "Control Weight Prompt",
                  "description": "Optional prompt to guide the control input",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control": {
                  "title": "Input Control",
                  "description": "Optional video input for control, public URL or base64 encoded video",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control_prompt": {
                  "title": "Input Control Prompt",
                  "description": "Optional prompt to guide the input control generation, only used for 'seg' control input",
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
            {
              "type": "null"
            }
          ]
        },
        "seg": {
          "description": "Segmentation control input parameters",
          "anyOf": [
            {
              "type": "object",
              "title": "ControlInput",
              "properties": {
                "control_weight": {
                  "type": "number",
                  "title": "Control Weight",
                  "default": 0.5,
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Weight for the control input"
                },
                "control_weight_prompt": {
                  "title": "Control Weight Prompt",
                  "description": "Optional prompt to guide the control input",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control": {
                  "title": "Input Control",
                  "description": "Optional video input for control, public URL or base64 encoded video",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control_prompt": {
                  "title": "Input Control Prompt",
                  "description": "Optional prompt to guide the input control generation, only used for 'seg' control input",
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
            {
              "type": "null"
            }
          ]
        },
        "keypoint": {
          "description": "Keypoint control input parameters",
          "anyOf": [
            {
              "type": "object",
              "title": "ControlInput",
              "properties": {
                "control_weight": {
                  "type": "number",
                  "title": "Control Weight",
                  "default": 0.5,
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Weight for the control input"
                },
                "control_weight_prompt": {
                  "title": "Control Weight Prompt",
                  "description": "Optional prompt to guide the control input",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control": {
                  "title": "Input Control",
                  "description": "Optional video input for control, public URL or base64 encoded video",
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "input_control_prompt": {
                  "title": "Input Control Prompt",
                  "description": "Optional prompt to guide the input control generation, only used for 'seg' control input",
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
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "responseSchema": {
      "type": "object",
      "title": "Transfer1Response",
      "required": [
        "b64_video",
        "seed"
      ],
      "properties": {
        "b64_video": {
          "type": "string",
          "title": "B64 Video",
          "description": "The generated video as mp4, encoded in base64"
        },
        "upsampled_prompt": {
          "title": "Upsampled Prompt",
          "description": "If prompt upsampling was enabled, the upsampled prompt",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "type": "integer",
          "title": "Seed",
          "description": "Seed used for generation"
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false,
    "inputHint": "Infer",
    "outputHint": "Returns the response documented by NVIDIA for this model."
  },
  {
    "id": "nvidia/cosmos3-nano",
    "displayName": "nvidia / cosmos3-nano",
    "category": "special",
    "transport": "http",
    "endpoint": "https://ai.api.nvidia.com/v1/infer",
    "method": "POST",
    "functionId": "d09cd49d-d7f2-4361-928f-ea22af707249",
    "documentation": "https://build.nvidia.com/qc69jvmznzxy/cosmos3-nano/api",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/cosmos3-nano",
    "documentationUpdatedAt": "2026-08-21T07:06:19.832Z",
    "available": true,
    "executable": true,
    "purpose": "Generates physics-aware videos from text prompts or an image prompt for physical AI development.",
    "agent": false,
    "agentCapabilitySource": "model-card",
    "taskKind": "video-generation",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "Cosmos3Request",
      "properties": {
        "prompt": {
          "title": "Prompt",
          "description": "Text prompt describing the desired output video. Required unless image is provided.",
          "anyOf": [
            {
              "type": "string",
              "maxLength": 2000
            },
            {
              "type": "null"
            }
          ]
        },
        "image": {
          "title": "Image",
          "description": "Base64 encoded image, data URI, or public image URL to use as the first frame.",
          "anyOf": [
            {
              "type": "string",
              "maxLength": 20000000
            },
            {
              "type": "null"
            }
          ]
        },
        "negative_prompt": {
          "title": "Negative Prompt",
          "description": "Negative prompt. If omitted, the service uses the Cosmos3 default for the request mode.",
          "anyOf": [
            {
              "type": "string",
              "maxLength": 2000
            },
            {
              "type": "null"
            }
          ]
        },
        "seed": {
          "title": "Seed",
          "description": "Random seed for reproducible generation. Auto-generated if omitted.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0
            },
            {
              "type": "null"
            }
          ]
        },
        "guidance_scale": {
          "type": "number",
          "title": "Guidance Scale",
          "default": 6,
          "minimum": 1,
          "maximum": 7,
          "description": "Classifier-free guidance scale."
        },
        "steps": {
          "type": "integer",
          "title": "Steps",
          "default": 35,
          "minimum": 1,
          "maximum": 100,
          "description": "Number of denoising steps."
        },
        "resolution": {
          "type": "string",
          "title": "Resolution",
          "default": "720",
          "description": "Output resolution key. Bare tier keys are aliases for 16:9 landscape.",
          "enum": [
            "256",
            "256_16_9",
            "256_1_1",
            "256_9_16",
            "256_4_3",
            "256_3_4",
            "480",
            "480_16_9",
            "480_1_1",
            "480_9_16",
            "480_4_3",
            "480_3_4",
            "720",
            "720_16_9",
            "720_1_1",
            "720_9_16",
            "720_4_3",
            "720_3_4"
          ]
        },
        "num_output_frames": {
          "type": "integer",
          "title": "Num Output Frames",
          "default": 189,
          "minimum": 25,
          "maximum": 397,
          "description": "Number of frames to generate. Must follow the 4k+1 cadence: 25, 29, 33, ..."
        },
        "fps": {
          "type": "number",
          "title": "FPS",
          "default": 24,
          "minimum": 1,
          "maximum": 60,
          "description": "Output video frame rate."
        }
      },
      "additionalProperties": false
    },
    "responseSchema": {
      "type": "object",
      "title": "Cosmos3Response",
      "required": [
        "b64_video"
      ],
      "properties": {
        "b64_video": {
          "type": "string",
          "title": "B64 Video",
          "description": "The generated MP4 video, encoded in base64."
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false,
    "inputHint": "Generate video",
    "outputHint": "Returns a base64-encoded MP4 video."
  },
  {
    "id": "nvidia/ising-calibration-1-35b-a3b",
    "displayName": "nvidia / ising-calibration-1-35b-a3b",
    "category": "special",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "5e00a713-f390-41c6-8561-7a0345c93355",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-ising-calibration-1-35b-a3b",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/ising-calibration-1-35b-a3b",
    "documentationUpdatedAt": "2026-08-10T20:29:43.238Z",
    "available": true,
    "executable": true,
    "purpose": "Open VLM for quantum computer calibration chart understanding across a range of qubit modalities.",
    "agent": false,
    "agentCapabilitySource": "model-card",
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
                          ],
                          "properties": {
                            "image_url": {
                              "type": "object",
                              "title": "ImageURL",
                              "required": [
                                "url"
                              ],
                              "properties": {
                                "url": {
                                  "type": "string",
                                  "title": "Url"
                                }
                              }
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "image_url",
                              "enum": [
                                "image_url"
                              ]
                            }
                          }
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ],
                          "properties": {
                            "text": {
                              "type": "string",
                              "title": "Text"
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "text",
                              "enum": [
                                "text"
                              ]
                            }
                          }
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
          "default": "nvidia/ising-calibration-1-35b-a3b",
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
          "default": 0.2,
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletionResponse",
      "required": [
        "model",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "title": "Id"
        },
        "object": {
          "type": "string",
          "title": "Object",
          "default": "chat.completion",
          "const": "chat.completion",
          "enum": [
            "chat.completion"
          ]
        },
        "created": {
          "type": "integer",
          "title": "Created"
        },
        "model": {
          "type": "string",
          "title": "Model"
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "items": {
            "type": "object",
            "title": "ChatCompletionResponseChoice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index"
              },
              "message": {
                "type": "object",
                "title": "ChatMessage",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "title": "Role"
                  },
                  "content": {
                    "title": "Content",
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
              "finish_reason": {
                "title": "Finish Reason",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "stop_reason": {
                "title": "Stop Reason",
                "anyOf": [
                  {
                    "type": "integer"
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
          }
        },
        "usage": {
          "type": "object",
          "title": "UsageInfo",
          "properties": {
            "prompt_tokens": {
              "type": "integer",
              "title": "Prompt Tokens",
              "default": 0
            },
            "total_tokens": {
              "type": "integer",
              "title": "Total Tokens",
              "default": 0
            },
            "completion_tokens": {
              "title": "Completion Tokens",
              "default": 0,
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
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Request response from the model",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "nvidia/ising-calibration-1.5-31b",
    "displayName": "nvidia / ising-calibration-1.5-31b",
    "category": "special",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "499210d3-3bf7-44bf-88b5-9460edfa8a38",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-ising-calibration-1-5-31b",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/ising-calibration-1.5-31b",
    "documentationUpdatedAt": "2026-08-10T20:29:43.423Z",
    "available": false,
    "executable": true,
    "purpose": "NVIDIA-Ising-Calibration-1.5 is a dense multimodal vision-language model built on Gemma 4 31B. It analyzes quantum computing calibration experiment plots and generates structured technical text.",
    "agent": false,
    "agentCapabilitySource": "model-card",
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
                "description": "The contents of the message. <br>To pass images (only with role=`user`): <br> - When content is a string, image can be passed together with the text with `img` HTML tags that wraps an image URL (`<img src=\"{url}\" />`), base64 encoded image data (`<img src=\"data:image/{format};base64,{base64encodedimage}\" />`), or an NVCF asset ID (`<img src=\"data:image/{format};asset_id,{asset_id}\" />`) when the container is hosted in NVCF and the payload exceeds 200KB. <br> - When content is a list of objects, images can be passed as objects with type=`image_url`. <br> - In both cases, images can be PNG, JPG or JPEG. <br>For `system` and `assistant` roles, the object list format is not supported.",
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
                          ],
                          "properties": {
                            "image_url": {
                              "type": "object",
                              "title": "ImageURL",
                              "required": [
                                "url"
                              ],
                              "properties": {
                                "url": {
                                  "type": "string",
                                  "title": "Url"
                                }
                              }
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "image_url",
                              "enum": [
                                "image_url"
                              ]
                            }
                          }
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ],
                          "properties": {
                            "text": {
                              "type": "string",
                              "title": "Text"
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "text",
                              "enum": [
                                "text"
                              ]
                            }
                          }
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletionResponse",
      "required": [
        "model",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "title": "Id"
        },
        "object": {
          "type": "string",
          "title": "Object",
          "default": "chat.completion",
          "const": "chat.completion",
          "enum": [
            "chat.completion"
          ]
        },
        "created": {
          "type": "integer",
          "title": "Created"
        },
        "model": {
          "type": "string",
          "title": "Model"
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "items": {
            "type": "object",
            "title": "ChatCompletionResponseChoice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index"
              },
              "message": {
                "type": "object",
                "title": "ChatMessage",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "title": "Role"
                  },
                  "content": {
                    "title": "Content",
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
              "finish_reason": {
                "title": "Finish Reason",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "stop_reason": {
                "title": "Stop Reason",
                "anyOf": [
                  {
                    "type": "integer"
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
          }
        },
        "usage": {
          "type": "object",
          "title": "UsageInfo",
          "properties": {
            "prompt_tokens": {
              "type": "integer",
              "title": "Prompt Tokens",
              "default": 0
            },
            "total_tokens": {
              "type": "integer",
              "title": "Total Tokens",
              "default": 0
            },
            "completion_tokens": {
              "title": "Completion Tokens",
              "default": 0,
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
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Request response from the model",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "nvidia/llama-3.1-nemotron-safety-guard-8b-v3",
    "displayName": "nvidia / llama-3.1-nemotron-safety-guard-8b-v3",
    "category": "special",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "ec6a02a5-d259-44c8-8425-e72bfefcf2f9",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_1-nemotron-safety-guard-8b-v3",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/llama-3_1-nemotron-safety-guard-8b-v3",
    "documentationUpdatedAt": "2026-08-10T20:29:45.916Z",
    "available": false,
    "executable": true,
    "purpose": "Leading multilingual content safety model for enhancing the safety and moderation capabilities of LLMs",
    "agent": false,
    "agentCapabilitySource": "model-card",
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "nvidia/magpie-tts-zeroshot",
    "displayName": "nvidia / magpie-tts-zeroshot",
    "category": "special",
    "transport": "grpc",
    "endpoint": "grpc.nvcf.nvidia.com:443",
    "method": "UNARY",
    "rpcService": "nvidia.riva.tts.RivaSpeechSynthesis",
    "rpcMethod": "Synthesize",
    "functionId": "55cf67bf-600f-4b04-8eac-12ed39537a08",
    "documentation": "https://docs.nvidia.com/nim/riva/tts/latest/protos.html",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/magpie-tts-zeroshot",
    "documentationUpdatedAt": "2026-08-13T09:23:32.330Z",
    "available": false,
    "executable": true,
    "purpose": "Expressive and engaging text-to-speech, generated from a short audio sample.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "speech-generation",
    "requestContentType": "application/grpc+proto",
    "requestSchema": {
      "type": "object",
      "required": [
        "prompt"
      ],
      "properties": {
        "prompt": {
          "type": "string",
          "description": "Text to synthesize."
        },
        "reference_audio_path": {
          "type": "string",
          "description": "Optional 3-to-10-second reference audio for zero-shot voice cloning."
        },
        "language_code": {
          "type": "string",
          "default": "en-US"
        },
        "voice_name": {
          "type": "string"
        },
        "sample_rate_hz": {
          "type": "integer",
          "default": 22050
        },
        "quality": {
          "type": "integer",
          "minimum": 1,
          "maximum": 40,
          "default": 20
        },
        "transcript": {
          "type": "string"
        }
      }
    },
    "responseSchema": {
      "type": "string",
      "format": "binary",
      "description": "Synthesized audio."
    },
    "responseMediaTypes": [
      "audio/wav"
    ],
    "supportsStreaming": false,
    "inputHint": "Synthesizes text with a built-in voice or a 3-to-10-second reference voice sample.",
    "outputHint": "Returns synthesized audio as a WAV artifact."
  },
  {
    "id": "nvidia/nemotron-3-embed-1b",
    "displayName": "nvidia / nemotron-3-embed-1b",
    "category": "special",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/embeddings",
    "method": "POST",
    "functionId": "df727967-5a01-445f-ba36-fdfb1974c359",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-embed-1b",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/nemotron-3-embed-1b",
    "documentationUpdatedAt": "2026-08-10T20:29:51.710Z",
    "available": false,
    "executable": true,
    "purpose": "1B embedding model for semantic search, retrieval, and RAG applications.",
    "agent": false,
    "agentCapabilitySource": "model-card",
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
    "responseSchema": {
      "type": "object",
      "properties": {
        "object": {
          "type": "string"
        },
        "data": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "index": {
                "type": "integer"
              },
              "object": {
                "type": "string"
              },
              "embedding": {
                "type": "array",
                "items": {
                  "type": "number"
                }
              }
            }
          }
        },
        "model": {
          "type": "string"
        },
        "usage": {
          "type": "object",
          "properties": {
            "prompt_tokens": {
              "type": "integer"
            },
            "total_tokens": {
              "type": "integer"
            }
          }
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false,
    "inputHint": "Creates an embedding vector from the input text.",
    "outputHint": "Returns the response documented by NVIDIA for this model."
  },
  {
    "id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    "displayName": "nvidia / nemotron-3-nano-omni-30b-a3b-reasoning",
    "category": "special",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "c4ed50ff-b5c3-409d-ab57-b79c33f5bb39",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-nano-omni-30b-a3b-reasoning",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/nemotron-3-nano-omni-30b-a3b-reasoning",
    "documentationUpdatedAt": "2026-08-20T22:48:23.854Z",
    "available": true,
    "executable": true,
    "purpose": "Nemotron 3 Nano Omni is an omni-modal reasoning model that understands images, video, speech, text.",
    "agent": false,
    "agentCapabilitySource": "model-card",
    "taskKind": "video-analysis",
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
                          ],
                          "properties": {
                            "audio_url": {
                              "type": "object",
                              "title": "AudioURL",
                              "required": [
                                "url"
                              ],
                              "properties": {
                                "url": {
                                  "type": "string",
                                  "title": "Url"
                                }
                              }
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "audio_url",
                              "enum": [
                                "audio_url"
                              ]
                            }
                          }
                        },
                        {
                          "type": "object",
                          "title": "NIMLLMChatCompletionContentPartInputAudio",
                          "required": [
                            "input_audio",
                            "type"
                          ],
                          "properties": {
                            "input_audio": {
                              "type": "object",
                              "title": "InputAudio",
                              "required": [
                                "data",
                                "format"
                              ],
                              "properties": {
                                "data": {
                                  "type": "string",
                                  "title": "Data"
                                },
                                "format": {
                                  "type": "string",
                                  "title": "Format",
                                  "enum": [
                                    "wav",
                                    "mp3"
                                  ]
                                }
                              }
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "input_audio"
                            }
                          }
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartImage",
                          "required": [
                            "image_url",
                            "type"
                          ],
                          "properties": {
                            "image_url": {
                              "type": "object",
                              "title": "ImageURL",
                              "required": [
                                "url"
                              ],
                              "properties": {
                                "url": {
                                  "type": "string",
                                  "title": "Url"
                                }
                              }
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "image_url",
                              "enum": [
                                "image_url"
                              ]
                            }
                          }
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartVideo",
                          "required": [
                            "type",
                            "video_url"
                          ],
                          "properties": {
                            "video_url": {
                              "description": "Video url",
                              "allOf": [
                                {
                                  "type": "object",
                                  "title": "VideoURL",
                                  "required": [
                                    "url"
                                  ]
                                }
                              ]
                            },
                            "start_offset": {
                              "title": "Start Offset",
                              "description": "video offset position",
                              "anyOf": [
                                {
                                  "type": "number",
                                  "minimum": 0,
                                  "maximum": 9223372036854776000
                                },
                                {
                                  "type": "null"
                                }
                              ]
                            },
                            "duration": {
                              "title": "Duration",
                              "description": "video inference duration",
                              "anyOf": [
                                {
                                  "type": "number",
                                  "minimum": 0,
                                  "maximum": 9223372036854776000
                                },
                                {
                                  "type": "null"
                                }
                              ]
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "video_url",
                              "description": "The type of the content part.",
                              "enum": [
                                "video_url"
                              ]
                            }
                          },
                          "additionalProperties": false
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ],
                          "properties": {
                            "text": {
                              "type": "string",
                              "title": "Text"
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "text",
                              "enum": [
                                "text"
                              ]
                            }
                          }
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletionResponse",
      "required": [
        "model",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "title": "Id"
        },
        "object": {
          "type": "string",
          "title": "Object",
          "default": "chat.completion",
          "const": "chat.completion",
          "enum": [
            "chat.completion"
          ]
        },
        "created": {
          "type": "integer",
          "title": "Created"
        },
        "model": {
          "type": "string",
          "title": "Model"
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "items": {
            "type": "object",
            "title": "ChatCompletionResponseChoice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index"
              },
              "message": {
                "type": "object",
                "title": "ChatMessage",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "title": "Role"
                  },
                  "content": {
                    "title": "Content",
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
              "finish_reason": {
                "title": "Finish Reason",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "stop_reason": {
                "title": "Stop Reason",
                "anyOf": [
                  {
                    "type": "integer"
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
          }
        },
        "usage": {
          "type": "object",
          "title": "UsageInfo",
          "properties": {
            "prompt_tokens": {
              "type": "integer",
              "title": "Prompt Tokens",
              "default": 0
            },
            "total_tokens": {
              "type": "integer",
              "title": "Total Tokens",
              "default": 0
            },
            "completion_tokens": {
              "title": "Completion Tokens",
              "default": 0,
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
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Request response from the model",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "nvidia/nemotron-3-super-120b-a12b",
    "displayName": "nvidia / nemotron-3-super-120b-a12b",
    "category": "agentic",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "ac74040f-9fc9-4c5e-ac74-279ba5161d69",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/nemotron-3-super-120b-a12b",
    "documentationUpdatedAt": "2026-08-21T05:59:59.931Z",
    "available": true,
    "executable": true,
    "purpose": "Open, efficient hybrid Mamba-Transformer MoE with 1M context, excelling in agentic reasoning, coding, planning, tool calling, and more",
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "nvidia/nemotron-3-ultra-550b-a55b",
    "displayName": "nvidia / nemotron-3-ultra-550b-a55b",
    "category": "agentic",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "948fe171-ce7a-4332-8bc0-5e14e90259f9",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-ultra-550b-a55b",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/nemotron-3-ultra-550b-a55b",
    "documentationUpdatedAt": "2026-08-21T06:00:06.755Z",
    "available": true,
    "executable": true,
    "purpose": "Open, efficient hybrid Mamba-Transformer MoE with 1M context, excelling in agentic reasoning, coding, planning, tool calling, and more",
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "nvidia/nemotron-3.5-content-safety",
    "displayName": "nvidia / nemotron-3.5-content-safety",
    "category": "special",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "3e84ff75-527b-4491-8647-530406876074",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-5-content-safety",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/nemotron-3.5-content-safety",
    "documentationUpdatedAt": "2026-08-10T20:29:52.574Z",
    "available": true,
    "executable": true,
    "purpose": "Multilingual, multimodal model for detecting unsafe and toxic content.",
    "agent": false,
    "agentCapabilitySource": "model-card",
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
                          ],
                          "properties": {
                            "image_url": {
                              "type": "object",
                              "title": "ImageURL",
                              "required": [
                                "url"
                              ],
                              "properties": {
                                "url": {
                                  "type": "string",
                                  "title": "Url"
                                }
                              }
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "image_url",
                              "enum": [
                                "image_url"
                              ]
                            }
                          }
                        },
                        {
                          "type": "object",
                          "title": "NIMVLMChatCompletionContentPartText",
                          "required": [
                            "text",
                            "type"
                          ],
                          "properties": {
                            "text": {
                              "type": "string",
                              "title": "Text"
                            },
                            "type": {
                              "type": "string",
                              "title": "Type",
                              "const": "text",
                              "enum": [
                                "text"
                              ]
                            }
                          }
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
          "default": "nvidia/nemotron-3.5-content-safety",
          "description": "The model to use."
        },
        "chat_template_kwargs": {
          "type": "object",
          "title": "Chat Template Kwargs",
          "description": "Additional keyword arguments to pass to the chat template. Use {\"request_categories\": \"/categories\"} to include safety category labels in the response, and {\"enable_thinking\": true} to return reasoning content.",
          "properties": {
            "request_categories": {
              "type": "string",
              "title": "Request Categories",
              "default": "/categories",
              "description": "Set to /categories to include safety category labels in the response.",
              "enum": [
                "/categories",
                "/no_categories"
              ]
            },
            "enable_thinking": {
              "type": "boolean",
              "title": "Enable Thinking",
              "default": false,
              "description": "Set to true to return reasoning content in the response."
            },
            "custom_policy": {
              "type": "string",
              "title": "Custom Policy",
              "default": "",
              "description": "Custom safety policy sent to the model."
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletionResponse",
      "required": [
        "model",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "title": "Id"
        },
        "object": {
          "type": "string",
          "title": "Object",
          "default": "chat.completion",
          "const": "chat.completion",
          "enum": [
            "chat.completion"
          ]
        },
        "created": {
          "type": "integer",
          "title": "Created"
        },
        "model": {
          "type": "string",
          "title": "Model"
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "items": {
            "type": "object",
            "title": "ChatCompletionResponseChoice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index"
              },
              "message": {
                "type": "object",
                "title": "ChatMessage",
                "required": [
                  "role"
                ],
                "properties": {
                  "role": {
                    "type": "string",
                    "title": "Role"
                  },
                  "content": {
                    "title": "Content",
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
              "finish_reason": {
                "title": "Finish Reason",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "stop_reason": {
                "title": "Stop Reason",
                "anyOf": [
                  {
                    "type": "integer"
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
          }
        },
        "usage": {
          "type": "object",
          "title": "UsageInfo",
          "properties": {
            "prompt_tokens": {
              "type": "integer",
              "title": "Prompt Tokens",
              "default": 0
            },
            "total_tokens": {
              "type": "integer",
              "title": "Total Tokens",
              "default": 0
            },
            "completion_tokens": {
              "title": "Completion Tokens",
              "default": 0,
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
        }
      },
      "additionalProperties": false
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Request response from the model",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "nvidia/nemotron-3.5-lightning-30b-a3b",
    "displayName": "nvidia / nemotron-3.5-lightning-30b-a3b",
    "category": "agentic",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "0a213807-640b-43fb-bfbf-2919f9b666ad",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-5-lightning-30b-a3b",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/nemotron-3.5-lightning-30b-a3b",
    "documentationUpdatedAt": "2026-08-18T12:09:11.114Z",
    "available": true,
    "executable": true,
    "purpose": "Fastest 30B A3B MoE model with leading domain accuracy for specialized agentic tasks",
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "nvidia/nemotron-voicechat",
    "displayName": "nvidia / nemotron-voicechat",
    "category": "special",
    "transport": "unpublished",
    "endpoint": "https://build.nvidia.com/qc69jvmznzxy/nemotron-voicechat",
    "method": "UNPUBLISHED",
    "functionId": "42c86b5f-545a-4b2f-a83b-90fd71da9912",
    "documentation": "https://build.nvidia.com/qc69jvmznzxy/nemotron-voicechat/api",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/nemotron-voicechat",
    "documentationUpdatedAt": "2026-08-10T20:29:55.056Z",
    "available": false,
    "executable": false,
    "purpose": "Nemotron 3 Voicechat",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "speech-to-speech",
    "requestContentType": "application/grpc+proto",
    "requestSchema": {},
    "responseSchema": {},
    "responseMediaTypes": [],
    "supportsStreaming": false,
    "inputHint": "NVIDIA labels this as a Free Endpoint but has not published an inference protocol for it.",
    "outputHint": "No public response contract is currently published by NVIDIA."
  },
  {
    "id": "nvidia/riva-translate-4b-instruct-v1.1",
    "displayName": "nvidia / riva-translate-4b-instruct-v1_1",
    "category": "special",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "b5cca41a-de17-4c7a-a6c8-03937cfb07b9",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-riva-translate-4b-instruct-v1_1",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/riva-translate-4b-instruct-v1_1",
    "documentationUpdatedAt": "2026-08-20T20:19:27.516Z",
    "available": false,
    "executable": true,
    "purpose": "Translation model in 12 languages with few-shots example prompts capability.",
    "agent": false,
    "agentCapabilitySource": "model-card",
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "nvidia/riva-translate-4b-instruct-v2",
    "displayName": "nvidia / riva-translate-4b-instruct-v2",
    "category": "special",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "2b004404-8b0b-4ee5-a06c-3002383f3cff",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-riva-translate-4b-instruct-v2",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/riva-translate-4b-instruct-v2",
    "documentationUpdatedAt": "2026-08-10T20:30:00.710Z",
    "available": false,
    "executable": true,
    "purpose": "Translation model in 37 languages with few-shots example prompts capability.",
    "agent": false,
    "agentCapabilitySource": "model-card",
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "nvidia/sparsedrive",
    "displayName": "nvidia / sparsedrive",
    "category": "special",
    "transport": "http",
    "endpoint": "https://aa55eb71-2007-46a7-8bd9-430b568c8bb4.invocation.api.nvcf.nvidia.com/v1/sparsedrive/inference",
    "method": "POST",
    "functionId": "aa55eb71-2007-46a7-8bd9-430b568c8bb4",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-sparsedrive",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/sparsedrive",
    "documentationUpdatedAt": "2026-08-10T20:30:03.056Z",
    "available": false,
    "executable": true,
    "purpose": "End-to-end autonomous driving stack integrating perception, prediction, and planning with sparse scene representations for efficiency and safety.",
    "agent": false,
    "agentCapabilitySource": "model-card",
    "taskKind": "autonomous-driving",
    "requestContentType": "application/json",
    "requestSchema": {
      "type": "object",
      "title": "InferenceRequest",
      "required": [
        "scene_id"
      ],
      "properties": {
        "scene_id": {
          "type": "string",
          "title": "Scene Id",
          "description": "The video ID to process"
        }
      }
    },
    "responseSchema": {
      "type": "object",
      "title": "InferenceResponse",
      "required": [
        "bbox_video",
        "map_video"
      ],
      "properties": {
        "bbox_video": {
          "type": "object",
          "title": "BboxVideo",
          "required": [
            "file",
            "metadata"
          ],
          "properties": {
            "file": {
              "type": "string",
              "format": "binary",
              "title": "File",
              "description": "The processed bounding box video file in MP4 format"
            },
            "metadata": {
              "type": "object",
              "title": "Metadata",
              "required": [
                "size_bytes",
                "duration_seconds"
              ],
              "properties": {
                "size_bytes": {
                  "type": "integer",
                  "title": "Size Bytes",
                  "description": "Size of the video file in bytes"
                },
                "duration_seconds": {
                  "type": "number",
                  "title": "Duration Seconds",
                  "description": "Duration of the video in seconds"
                }
              }
            }
          }
        },
        "map_video": {
          "type": "object",
          "title": "MapVideo",
          "required": [
            "file",
            "metadata"
          ],
          "properties": {
            "file": {
              "type": "string",
              "format": "binary",
              "title": "File",
              "description": "The processed map view video file in MP4 format"
            },
            "metadata": {
              "type": "object",
              "title": "Metadata",
              "required": [
                "size_bytes",
                "duration_seconds"
              ],
              "properties": {
                "size_bytes": {
                  "type": "integer",
                  "title": "Size Bytes",
                  "description": "Size of the video file in bytes"
                },
                "duration_seconds": {
                  "type": "number",
                  "title": "Duration Seconds",
                  "description": "Duration of the video in seconds"
                }
              }
            }
          }
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": false,
    "inputHint": "Post V1 Sparsedrive Inference",
    "outputHint": "Generate annotated videos using SparseDrive model for a selected scene.\n\nArgs:\n    body (InferenceRequest): Input request containing scene_id and optional config\nExample scene_id values include:\n 'scene-0103': Yield to left-turning vehicle at Boston intersection\n 'scene-0916': Navigate a bus stop parking lot in Singapore\n 'scene-1073': Left turn at a busy nighttime intersection in Singapore\n 'scene-0061': Follow vehicle into construction zone in Singapore\n \n Returns:\n    InferenceResponse: Response containing both bounding box and map view videos\n    Error: When processing fails, returns appropriate error response"
  },
  {
    "id": "nvidia/streampetr",
    "displayName": "nvidia / streampetr",
    "category": "special",
    "transport": "http",
    "endpoint": "https://ai.api.nvidia.com/v1/av/nvidia/streampetr",
    "method": "POST",
    "functionId": "106c1207-eda3-49e5-af6a-83707c17efe7",
    "documentation": "https://docs.api.nvidia.com/nim/reference/nvidia-streampetr",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/streampetr",
    "documentationUpdatedAt": "2026-08-10T20:30:03.830Z",
    "available": false,
    "executable": true,
    "purpose": "StreamPETR offers efficient 3D object detection for autonomous driving by propagating sparse object queries temporally.",
    "agent": false,
    "agentCapabilitySource": "model-card",
    "taskKind": "autonomous-driving",
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
    "responseSchema": {
      "type": "object",
      "title": "StreampetrResponse",
      "required": [
        "inference_metadata",
        "camera_video",
        "bev_video"
      ],
      "properties": {
        "inference_metadata": {
          "type": "object",
          "title": "InferenceMetadata",
          "properties": {
            "data": {
              "title": "Data",
              "description": "Inference results and metadata",
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
        },
        "camera_video": {
          "type": "object",
          "title": "CameraVideo",
          "properties": {
            "data": {
              "title": "Data",
              "description": "Base64 encoded video data",
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "mime_type": {
              "title": "Mime Type",
              "description": "MIME type of the video",
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "metadata": {
              "anyOf": [
                {
                  "type": "object",
                  "title": "Metadata",
                  "properties": {
                    "size_bytes": {
                      "title": "Size Bytes",
                      "description": "Original video size in bytes",
                      "anyOf": [
                        {
                          "type": "integer"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "duration": {
                      "title": "Duration",
                      "description": "Video duration in seconds",
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
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        },
        "bev_video": {
          "type": "object",
          "title": "BevVideo",
          "properties": {
            "data": {
              "title": "Data",
              "description": "Base64 encoded video data",
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "mime_type": {
              "title": "Mime Type",
              "description": "MIME type of the video",
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "metadata": {
              "anyOf": [
                {
                  "type": "object",
                  "title": "Metadata",
                  "properties": {
                    "size_bytes": {
                      "title": "Size Bytes",
                      "description": "Original video size in bytes",
                      "anyOf": [
                        {
                          "type": "integer"
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "duration": {
                      "title": "Duration",
                      "description": "Video duration in seconds",
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
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "application/zip",
      "application/octet-stream"
    ],
    "supportsStreaming": false,
    "inputHint": "Post V1 Streampetr Process",
    "outputHint": "Returns the response documented by NVIDIA for this model."
  },
  {
    "id": "nvidia/studiovoice",
    "displayName": "nvidia / Studio Voice",
    "category": "special",
    "transport": "grpc",
    "endpoint": "grpc.nvcf.nvidia.com:443",
    "method": "BIDIRECTIONAL_STREAM",
    "rpcService": "nvidia.ai4m.studiovoice.v1.StudioVoice",
    "rpcMethod": "EnhanceAudio",
    "functionId": "3f0aeba3-6d91-4465-b8cc-cc2aef355186",
    "documentation": "https://docs.nvidia.com/nim/maxine/studio-voice/latest/index.html",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/studiovoice",
    "documentationUpdatedAt": "2026-08-10T20:30:04.158Z",
    "available": true,
    "executable": true,
    "purpose": "Enhance input speech recorded with low-quality microphones in noisy or reverberant environments, producing studio-quality speech.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "audio-enhancement",
    "requestContentType": "application/grpc+proto",
    "requestSchema": {
      "type": "object",
      "required": [
        "audio_path"
      ],
      "properties": {
        "audio_path": {
          "type": "string",
          "description": "Input WAV audio path."
        }
      }
    },
    "responseSchema": {
      "type": "string",
      "format": "binary",
      "description": "Studio-quality enhanced WAV audio."
    },
    "responseMediaTypes": [
      "audio/wav"
    ],
    "supportsStreaming": true,
    "inputHint": "Streams one WAV audio file for studio-quality speech enhancement.",
    "outputHint": "Returns the enhanced WAV audio stream."
  },
  {
    "id": "nvidia/synthetic-video-detector",
    "displayName": "nvidia / synthetic-video-detector",
    "category": "special",
    "transport": "grpc",
    "endpoint": "grpc.nvcf.nvidia.com:443",
    "method": "BIDIRECTIONAL_STREAM",
    "rpcService": "nvidia.maxine.syntheticvideodetector.v1.SyntheticVideoDetectorService",
    "rpcMethod": "DetectSyntheticVideo",
    "functionId": "847b6e53-0133-452d-ab85-d7acf3ace723",
    "documentation": "https://docs.nvidia.com/nim/maxine/synthetic-video-detector/latest/index.html",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/synthetic-video-detector",
    "documentationUpdatedAt": "2026-08-19T21:49:52.756Z",
    "available": true,
    "executable": true,
    "purpose": "NVIDIA Synthetic Video Detector is an AI-powered micro-service for detecting AI‑generated (synthetic) videos.",
    "agent": false,
    "agentCapabilitySource": "none",
    "taskKind": "video-analysis",
    "requestContentType": "application/grpc+proto",
    "requestSchema": {
      "type": "object",
      "required": [
        "video_path"
      ],
      "properties": {
        "video_path": {
          "type": "string",
          "description": "H.264 constant-frame-rate MP4 input path."
        }
      }
    },
    "responseSchema": {
      "type": "object",
      "properties": {
        "verdict": {
          "type": "string",
          "enum": [
            "synthetic",
            "real",
            "unknown"
          ]
        },
        "final": {
          "type": "object"
        },
        "clips": {
          "type": "array"
        }
      }
    },
    "responseMediaTypes": [
      "application/json"
    ],
    "supportsStreaming": true,
    "inputHint": "Streams one H.264 constant-frame-rate MP4 file for synthetic-video analysis.",
    "outputHint": "Returns clip scores and the final synthetic probability as JSON."
  },
  {
    "id": "openai/gpt-oss-120b",
    "displayName": "openai / gpt-oss-120b",
    "category": "agentic",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "9fcd3abb-183b-4ef0-b884-663507e5e66e",
    "documentation": "https://docs.api.nvidia.com/nim/reference/openai-gpt-oss-120b",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/gpt-oss-120b",
    "documentationUpdatedAt": "2026-08-10T20:29:42.826Z",
    "available": true,
    "executable": true,
    "purpose": "Mixture of Experts (MoE) reasoning LLM (text-only) designed to fit within 80GB GPU.",
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
          "default": 1,
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
        }
      },
      "additionalProperties": false
    },
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "openai/gpt-oss-20b",
    "displayName": "openai / gpt-oss-20b",
    "category": "agentic",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "24d90582-d41c-4fc6-adc0-53c97f5a710f",
    "documentation": "https://docs.api.nvidia.com/nim/reference/openai-gpt-oss-20b",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/gpt-oss-20b",
    "documentationUpdatedAt": "2026-08-17T05:36:27.270Z",
    "available": true,
    "executable": true,
    "purpose": "Smaller Mixture of Experts (MoE) text-only LLM for efficient AI reasoning and math",
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
          "default": 1,
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
        }
      },
      "additionalProperties": false
    },
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  },
  {
    "id": "poolside/laguna-xs-2.1",
    "displayName": "poolside / laguna-xs-2.1",
    "category": "agentic",
    "transport": "http",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "functionId": "4a8f921c-c99d-4cde-92c1-c92ba9e4c50f",
    "documentation": "https://docs.api.nvidia.com/nim/reference/poolside-laguna-xs-2-1",
    "buildCard": "https://build.nvidia.com/qc69jvmznzxy/laguna-xs-2.1",
    "documentationUpdatedAt": "2026-08-20T20:14:25.793Z",
    "available": false,
    "executable": true,
    "purpose": "Efficient 33B MoE for local, long-horizon agentic coding and terminal tasks",
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
    "responseSchema": {
      "type": "object",
      "title": "ChatCompletion",
      "required": [
        "id",
        "choices",
        "usage"
      ],
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "title": "Id",
          "description": "A unique identifier for the completion."
        },
        "choices": {
          "type": "array",
          "title": "Choices",
          "description": "The list of completion choices the model generated for the input prompt.",
          "items": {
            "type": "object",
            "title": "Choice",
            "required": [
              "index",
              "message"
            ],
            "properties": {
              "index": {
                "type": "integer",
                "title": "Index",
                "description": "The index of the choice in the list of choices (always 0)."
              },
              "message": {
                "description": "A chat completion message generated by the model.",
                "allOf": [
                  {
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
                ]
              },
              "finish_reason": {
                "title": "Finish Reason",
                "default": null,
                "description": "The reason the model stopped generating tokens. This will be `stop` if the model hit a natural stop point or a provided stop sequence, or `length` if the maximum number of tokens specified in the request was reached.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "stop",
                      "length"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "usage": {
          "description": "Usage statistics for the completion request.",
          "allOf": [
            {
              "type": "object",
              "title": "Usage",
              "required": [
                "completion_tokens",
                "prompt_tokens",
                "total_tokens"
              ],
              "properties": {
                "completion_tokens": {
                  "type": "integer",
                  "title": "Completion Tokens",
                  "description": "Number of tokens in the generated completion."
                },
                "prompt_tokens": {
                  "type": "integer",
                  "title": "Prompt Tokens",
                  "description": "Number of tokens in the prompt."
                },
                "total_tokens": {
                  "type": "integer",
                  "title": "Total Tokens",
                  "description": "Total number of tokens used in the request (prompt + completion)."
                }
              }
            }
          ]
        }
      }
    },
    "responseMediaTypes": [
      "application/json",
      "text/event-stream"
    ],
    "supportsStreaming": true,
    "inputHint": "Creates a model response for the given chat conversation.",
    "outputHint": "Returns a [chat completion](/docs/api-reference/chat/object) object, or a streamed sequence of [chat completion chunk](/docs/api-reference/chat/streaming) objects if the request is streamed."
  }
]
