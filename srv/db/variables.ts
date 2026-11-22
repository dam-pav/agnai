import { v4 } from 'uuid'
import { db } from './client'
import {
  VariableDefinition,
  VariableClass,
  validateVariableDefinition,
  resolveVariables,
} from '/common/chat-variables'
import type { AppSchema } from '/common/types'

export async function resolveChatVariables(chat: AppSchema.Chat) {
  const ids = [
    chat.characterId,
    ...Object.keys(chat.characters || {}).filter((id) => chat.characters?.[id]),
  ]
  const [characters, scenarios, classes] = await Promise.all([
    db('character')
      .find({ _id: { $in: ids }, userId: chat.userId })
      .toArray(),
    db('scenario')
      .find({ _id: { $in: chat.scenarioIds || [] }, userId: chat.userId })
      .toArray(),
    getClasses(chat.userId),
  ])
  const temporary = Object.values(chat.tempCharacters || {}).filter(
    (char) => !char.deletedAt && char.favorite !== false
  )
  return resolveVariables(
    [...characters, ...temporary, ...scenarios],
    classes,
    characters.find((char) => char._id === chat.characterId)?.name || 'Character',
    chat.variables
  )
}

export async function getClasses(userId: string): Promise<VariableClass[]> {
  return db('variable-class').find({ userId }).toArray()
}
export async function saveClass(userId: string, definition: VariableDefinition, id?: string) {
  validateVariableDefinition(definition)
  const existing = id ? await db('variable-class').findOne({ _id: id, userId }) : undefined
  if (id && !existing) return
  const value: VariableClass = {
    _id: id || v4(),
    kind: 'variable-class',
    userId,
    revision: (existing?.revision || 0) + 1,
    name: definition.name,
    min: definition.min,
    max: definition.max,
    precision: definition.precision,
    bands: definition.bands,
    modifiers: definition.modifiers,
  }
  if (existing) {
    const { _id, revision, ...definition } = value
    const result = await db('variable-class').findOneAndUpdate(
      { _id, userId },
      { $set: definition, $inc: { revision: 1 } },
      { returnDocument: 'after' }
    )
    return result.value || undefined
  }
  await db('variable-class').insertOne(value)
  return value
}
export async function removeClass(userId: string, id: string) {
  return db('variable-class').deleteOne({ _id: id, userId })
}
