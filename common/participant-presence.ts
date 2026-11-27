import { AppSchema } from './types'

/** Preserve earlier visits when a participant leaves and later returns. */
export function updateCharacterPresence(
  chat: AppSchema.Chat,
  characterId: string,
  present: boolean,
  at: string
): NonNullable<AppSchema.Chat['characterPresence']> {
  const previous = chat.characterPresence?.[characterId]
  const temp = chat.tempCharacters?.[characterId]
  const wasPresent =
    characterId === chat.characterId ||
    (temp ? temp.favorite !== false && !temp.deletedAt : !!chat.characters?.[characterId])
  const visits = previous
    ? previous.map((visit) => ({ ...visit }))
    : wasPresent
    ? [{ joinedAt: temp?.createdAt || chat.createdAt } as { joinedAt: string; leftAt?: string }]
    : []
  const current = visits[visits.length - 1]
  if (present && (!current || current.leftAt !== undefined)) visits.push({ joinedAt: at })
  if (!present && current && current.leftAt === undefined) current.leftAt = at
  return { ...chat.characterPresence, [characterId]: visits }
}

export function wasCharacterPresent(chat: AppSchema.Chat, characterId: string, at: string) {
  const visits = chat.characterPresence?.[characterId]
  // Attendance before this feature cannot be reconstructed for legacy chats.
  if (!visits) return true
  return visits.some((visit) => at >= visit.joinedAt && (!visit.leftAt || at < visit.leftAt))
}
