import { z } from 'zod';

export const providerNameSchema = z.enum(['openai', 'gemini']);
export type ProviderName = z.infer<typeof providerNameSchema>;

export const providerConfigSchema = z
  .object({
    provider: providerNameSchema,
    apiKey: z.string().min(1),
    model: z.string().min(1),
  })
  .strict();
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** On-disk shape at ~/.git-assistant/config.json. `version` gates future migrations. */
export const persistedConfigSchema = z
  .object({
    version: z.literal(1),
    provider: providerNameSchema,
    apiKey: z.string().min(1),
    model: z.string().min(1),
  })
  .strict();
export type PersistedConfig = z.infer<typeof persistedConfigSchema>;

export const chatRoleSchema = z.enum(['system', 'user', 'assistant']);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const chatMessageSchema = z
  .object({
    role: chatRoleSchema,
    content: z.string(),
  })
  .strict();
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Provider-agnostic completion contract - the shape the sampling bridge */
export const completionRequestSchema = z
  .object({
    messages: z.array(chatMessageSchema).min(1),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();
export type CompletionRequest = z.infer<typeof completionRequestSchema>;

export const completionResponseSchema = z
  .object({
    text: z.string(),
    model: z.string(),
    finishReason: z.enum(['stop', 'length', 'content_filter', 'other']),
  })
  .strict();
export type CompletionResponse = z.infer<typeof completionResponseSchema>;

/** Minimal subset of the OpenAI chat completion response this app consumes. */
export const openAiChatCompletionSchema = z
  .object({
    model: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: z.string().nullable() }).strict(),
            finish_reason: z.string().nullable().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/** Minimal subset of the Gemini generateContent response this app consumes. */
export const geminiGenerateContentSchema = z
  .object({
    text: z.string().optional(),
    modelVersion: z.string().optional(),
    candidates: z
      .array(
        z
          .object({
            finishReason: z.string().optional(),
            content: z
              .object({ parts: z.array(z.object({ text: z.string().optional() })).optional() })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
