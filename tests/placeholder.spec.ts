import { expect } from 'chai'
import './init'
import { reset, template, toChar, toChat, toMap, toPersona } from './util'

describe('Placeholder tests', () => {
  before(reset)

  it('will not include duplicates in {{all_personalities}}', async () => {
    const actual = await template(`{{personality}}\n\n{{all_personalities}}`, {})

    expect(actual).toMatchSnapshot()
  })

  it('includes every participant except the current speaker', async () => {
    const persona1 = toChar('Persona1', { persona: toPersona('one') })
    const persona2 = toChar('Persona2', { persona: toPersona('two') })
    const persona3 = toChar('Persona3', { persona: toPersona('three') })
    const chat = toChat(persona2, {}, [persona3])
    const characters = toMap([persona2, persona3])

    const botReply = await template('{{all_personalities}}', {
      char: persona2,
      chat,
      characters,
      replyAs: persona2,
      impersonate: persona1,
    })
    expect(botReply.parsed).to.equal(
      "Persona1's personality: one\nPersona3's personality: three"
    )

    const selfReply = await template('{{all_personalities}}', {
      char: persona2,
      chat,
      characters,
      replyAs: persona1,
      impersonate: persona1,
    })
    expect(selfReply.parsed).to.equal(
      "Persona2's personality: two\nPersona3's personality: three"
    )
  })
})
