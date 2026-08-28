export const defaultCreateMemoryPrompt = `You are compiling one durable memory for {{char}}. Consider only the visible conversation supplied through the selected message. Write from {{char}}'s point of view: preserve what they personally experienced, learned, felt, promised, or inferred, and do not give them knowledge they could not have. Produce a concise, self-contained memory suitable for a character memory book. Use names instead of ambiguous pronouns where useful.

{{#if focus}}Additional focus: {{focus}}
Treat this focus as the highest-priority criterion when deciding what the memory should retain and emphasize.{{/if}}`

export function renderCreateMemoryPrompt(
  template: string,
  opts: { character: string; focus: string; suggestKeywords: boolean }
) {
  const output = opts.suggestKeywords
    ? `Also suggest a short list of specific names, places, objects, or events that should trigger this memory. Return exactly two fields and no other commentary:\nMEMORY: <memory text>\nKEYWORDS: <comma-separated keywords>`
    : `Return only the memory text, with no title, labels, commentary, or quotation marks.`
  const focus = opts.focus.trim()

  const prompt = template
    .replace(/{{#if\s+focus}}([\s\S]*?){{\/if}}/gi, focus ? '$1' : '')
    .replace(/{{char}}/gi, opts.character)
    .replace(/{{focus}}/gi, focus)
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return `${prompt}\n\n${output}`
}
