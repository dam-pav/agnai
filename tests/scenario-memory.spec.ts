import './init'
import { expect } from 'chai'
import { buildPromptPlaceholders, resolveMemoryScenario } from '../common/prompt'
import { entities, toBook, toEntry, toPersona } from './util'

const { chat, main, user, profile, scenarioBook } = entities
const activeChat = { ...chat, overrides: undefined }
const scenario = { ...scenarioBook, text: 'Castle {{char}}', scanForMemory: true }

async function memory(scanForMemory?: boolean, lines = ['river']) {
  const parts = await buildPromptPlaceholders(
    {
      kind: 'send',
      characters: {},
      chatEmbeds: [],
      userEmbeds: [],
      chat: activeChat,
      char: main,
      replyAs: main,
      user,
      sender: profile,
      members: [profile],
      resolvedScenario: scenario.text,
      memoryScenario: resolveMemoryScenario(activeChat, [{ ...scenario, scanForMemory }]),
      books: [
        toBook('test', [
          toEntry(['Castle'], 'Castle lore'),
          toEntry([main.name], 'Character lore'),
          toEntry(['river'], 'River lore'),
          toEntry(['expired'], 'Old lore'),
        ]),
      ],
      settings: { memoryDepth: 1, memoryContextLimit: 500 },
    },
    lines,
    async (text) => text.length
  )
  return parts.memory
}

describe('Scenario memory triggers', () => {
  it('defaults to off and preserves chat matching', async () => {
    expect(await memory()).to.equal('River lore')
    expect(await memory(false)).to.equal('River lore')
  })
  it('scans enabled scenario text with placeholders without consuming history depth', async () => {
    const result = await memory(true, ['expired', 'river'])
    expect(result).to.include('Castle lore').and.include('Character lore').and.include('River lore')
    expect(result).not.to.include('Old lore')
  })
  it('scans the scenario even without chat history', async () => {
    expect(await memory(true, [])).to.include('Castle lore')
  })
  it('excludes scenarios replaced by chat overrides', () => {
    expect(
      resolveMemoryScenario({ ...activeChat, overrides: toPersona('override') }, [scenario])
    ).to.equal('')
  })
  it('only scans enabled scenarios that contribute to the resolved scenario', () => {
    const books = [
      { ...scenario, text: 'disabled', scanForMemory: false, overwriteCharacterScenario: true },
      { ...scenario, text: 'ignored', overwriteCharacterScenario: true },
      { ...scenario, text: 'included', overwriteCharacterScenario: false },
    ]
    expect(resolveMemoryScenario(activeChat, books)).to.equal('included')
    expect(
      resolveMemoryScenario(activeChat, [{ ...books[0], scanForMemory: true }, books[2]])
    ).to.equal('disabled\nincluded')
  })
})
