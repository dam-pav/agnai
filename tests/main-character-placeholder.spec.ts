import './init'
import { expect } from 'chai'
import { template, toChar, toPersona } from './util'

describe('Main character placeholders', () => {
  for (const alias of ['mainchar', 'mainbot', 'MAINCHAR', ' mainbot ']) {
    it(`expands {{${alias}}} in impersonated persona system messages`, async () => {
      const impersonate = toChar('Morgan', {
        persona: toPersona(`{{char}} / {{user}} / {{${alias}}}`),
      })
      const result = await template(
        '<system>{{impersonating}}\n{{all_personalities}}</system>',
        { impersonate },
        { name: 'Alice' }
      )

      // The responding bot, impersonated user, and main character are distinct.
      const impersonality = 'OtherBot / Morgan / Alice'
      const participantPersona = "Morgan's personality: Morgan / Morgan / Alice"
      expect(result.blocks[0].role).to.equal('system')
      for (const output of [
        result.blocks[0].content,
        result.blockPrompt,
        result.sections.sections.system.join(''),
        result.sections.strictSystem.join(''),
        result.parsed,
      ]) {
        expect(output).to.include(impersonality)
        expect(output).to.include(participantPersona)
        expect(output).not.to.include(`{{${alias}}}`)
      }
    })

    it(`expands {{${alias}}} in a system prompt override`, async () => {
      const result = await template(
        '<system>{{system_prompt}}</system>',
        { settings: { systemPrompt: `Main character: {{${alias}}}` } },
        { name: 'Alice' }
      )

      expect(result.blocks).to.deep.equal([{ role: 'system', content: 'Main character: Alice' }])
    })
  }
})
