import { expect } from 'chai'
import './init'
import { isMessageInvisible } from '/common/prompt'
import { updateCharacterPresence, wasCharacterPresent } from '/common/participant-presence'
import { build, toBotMsg, toChar, toChat } from './util'

const main = toChar('Host')
const guest = toChar('Visitor')
const at = (second: number) => `2026-01-01T00:00:${String(second).padStart(2, '0')}.000Z`

function attendance() {
  const chat = toChat(main, { createdAt: at(0), greeting: 'Original private greeting' })
  const change = (present: boolean, second: number) => {
    chat.characterPresence = updateCharacterPresence(chat, guest._id, present, at(second))
    chat.characters = { ...chat.characters, [guest._id]: present }
  }
  return { chat, change }
}

describe('Participant presence', () => {
  it('keeps separate visits and excludes messages before arrival and during absence', () => {
    const { chat, change } = attendance()
    change(true, 10)
    change(false, 20)
    change(true, 30)
    expect(chat.characterPresence?.[guest._id]).to.deep.equal([
      { joinedAt: at(10), leftAt: at(20) },
      { joinedAt: at(30) },
    ])
    for (const [second, visible] of [
      [0, false],
      [9, false],
      [10, true],
      [19, true],
      [20, false],
      [29, false],
      [30, true],
      [40, true],
    ] as const) {
      expect(wasCharacterPresent(chat, guest._id, at(second)), `at ${second}`).to.equal(visible)
      expect(wasCharacterPresent(chat, main._id, at(second))).to.equal(true)
    }
  })

  it('does not open another visit for duplicate additions or extend a closed visit', () => {
    const { chat, change } = attendance()
    change(true, 10)
    change(true, 11)
    change(false, 20)
    change(false, 21)
    expect(chat.characterPresence?.[guest._id]).to.deep.equal([
      { joinedAt: at(10), leftAt: at(20) },
    ])
  })

  it('preserves earlier knowledge when removing an existing participant from a legacy chat', () => {
    const { chat, change } = attendance()
    chat.characters = { [guest._id]: true }
    change(false, 20)
    change(true, 30)
    expect(wasCharacterPresent(chat, guest._id, at(5))).to.equal(true)
    expect(wasCharacterPresent(chat, guest._id, at(25))).to.equal(false)
  })

  it('does not let an explicit visibility override reveal an absent conversation', () => {
    const { chat, change } = attendance()
    change(true, 10)
    const msg = toBotMsg(main, 'Secret', { createdAt: at(5), invisible: { [guest._id]: false } })
    expect(isMessageInvisible(chat, msg, guest._id)).to.equal(true)
    msg.createdAt = at(15)
    expect(isMessageInvisible(chat, msg, guest._id)).to.equal(false)
    msg.invisible = { [guest._id]: true }
    expect(isMessageInvisible(chat, msg, guest._id)).to.equal(true)
  })

  it('builds prompts from both visits without revealing the gap or original greeting', async () => {
    const { chat, change } = attendance()
    change(true, 10)
    change(false, 20)
    change(true, 30)
    const messages = [5, 15, 25, 35].map((second) =>
      toBotMsg(main, `Event at ${second}`, { _id: String(second), createdAt: at(second) })
    )
    const prompt = await build(messages, { chat, char: main, replyAs: guest })
    expect(prompt.lines.map((line) => line._id)).to.deep.equal(['15', '35'])
    expect(prompt.parts.greeting).to.equal('')
    const host = await build(messages, { chat, char: main, replyAs: main })
    expect(host.lines).to.have.length(4)
    expect(host.parts.greeting).to.equal('Original private greeting')
  })

  it('records temporary participant activation, removal and return', () => {
    const { chat } = attendance()
    const temp = toChar('temp-visitor', { createdAt: at(10), favorite: true })
    chat.characterPresence = updateCharacterPresence(chat, temp._id, true, at(10))
    chat.tempCharacters = { [temp._id]: temp }
    chat.characterPresence = updateCharacterPresence(chat, temp._id, false, at(20))
    chat.tempCharacters[temp._id] = { ...temp, favorite: false }
    chat.characterPresence = updateCharacterPresence(chat, temp._id, true, at(30))
    expect(wasCharacterPresent(chat, temp._id, at(5))).to.equal(false)
    expect(wasCharacterPresent(chat, temp._id, at(15))).to.equal(true)
    expect(wasCharacterPresent(chat, temp._id, at(25))).to.equal(false)
    expect(wasCharacterPresent(chat, temp._id, at(35))).to.equal(true)
  })
})
