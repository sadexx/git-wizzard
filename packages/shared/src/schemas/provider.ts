import { z } from 'zod';

/** `custom` is any OpenAI-compatible server (Ollama, LM Studio, a gateway) at `baseUrl`. */
export const providerNameSchema = z.enum(['openai', 'gemini', 'anthropic', 'custom']);
export type ProviderName = z.infer<typeof providerNameSchema>;

const providerFields = {
  provider: providerNameSchema,
  /** Empty only for `custom`: local servers such as Ollama need no key. */
  apiKey: z.string(),
  model: z.string().min(1),
  /** Only for `custom`, e.g. http://localhost:11434/v1. */
  baseUrl: z.url().optional(),
};

function checkProviderFields(config: { provider: ProviderName; apiKey: string; baseUrl?: string | undefined }, ctx: z.RefinementCtx): void {
  if (config.provider === 'custom' && config.baseUrl === undefined) {
    ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'A custom provider needs a server URL' });
  }
  if (config.provider !== 'custom' && config.apiKey === '') {
    ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'An API key is required' });
  }
}

export const providerConfigSchema = z.object(providerFields).strict().superRefine(checkProviderFields);
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** On-disk shape at ~/.git-wizzard/config.json. `version` gates future migrations. */
export const persistedConfigSchema = z
  .object({ version: z.literal(1), ...providerFields })
  .strict()
  .superRefine(checkProviderFields);
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

/**
 * Minimal subset of the OpenAI chat completion response this app consumes. Not strict: real responses
 * carry many more fields (id, object, created, usage, index, role, …), and servers add their own.
 */
export const openAiChatCompletionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

/** Minimal subset of the Gemini generateContent response this app consumes. */
export const geminiGenerateContentSchema = z.object({
  text: z.string().optional(),
  modelVersion: z.string().optional(),
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z
          .object({ parts: z.array(z.object({ text: z.string().optional() })).optional() })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    )
    .optional(),
});
