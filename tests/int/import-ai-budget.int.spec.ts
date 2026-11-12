// @vitest-environment node
import { Messages } from '@anthropic-ai/sdk/resources/messages/messages'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractEventsWithAi, ImportAiError } from '@/lib/import/ai'

/**
 * The run's cap holds for one big file too: a PDF that wouldn't fit what's left of the run's input
 * tokens is counted first (count_tokens, free) and never sent — nothing is spent on it.
 */
describe('Import AI — a file past the run budget is refused before it is paid for', () => {
  const pdf = { kind: 'file' as const, data: Buffer.from('%PDF-1.4\n'), mimeType: 'application/pdf' as const, fileName: 'zpravodaj.pdf' }
  const context = { municipalityName: 'Testov', categoryNames: [] as string[] }
  let count: ReturnType<typeof vi.spyOn>
  let parse: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    count = vi.spyOn(Messages.prototype, 'countTokens')
    parse = vi.spyOn(Messages.prototype, 'parse').mockResolvedValue({
      model: 'claude-haiku-5-5',
      stop_reason: 'end_turn',
      parsed_output: { events: [] },
      usage: { input_tokens: 900, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('refuses a file that would not fit — no model call', async () => {
    count.mockResolvedValue({ input_tokens: 120_000 } as never)
    const error = await extractEventsWithAi(pdf, { ...context, inputTokenBudget: 60_000 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ImportAiError)
    expect((error as ImportAiError).code).toBe('token_cap')
    expect(parse).not.toHaveBeenCalled()
  })

  it('sends a file that fits, and anything without a budget uncounted', async () => {
    count.mockResolvedValue({ input_tokens: 900 } as never)
    await extractEventsWithAi(pdf, { ...context, inputTokenBudget: 60_000 })
    expect(parse).toHaveBeenCalledTimes(1)

    count.mockClear()
    await extractEventsWithAi(pdf, context)
    expect(count).not.toHaveBeenCalled()
  })

  it('sends it all the same when counting fails — the cap after the call still holds the run', async () => {
    count.mockRejectedValue(new Error('count_tokens down'))
    await extractEventsWithAi(pdf, { ...context, inputTokenBudget: 60_000 })
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('does not count a short page text', async () => {
    await extractEventsWithAi({ kind: 'text', text: 'Program: 12. 12. jarmark', sourceUrl: 'https://obec.cz' }, { ...context, inputTokenBudget: 60_000 })
    expect(count).not.toHaveBeenCalled()
    expect(parse).toHaveBeenCalledTimes(1)
  })
})
