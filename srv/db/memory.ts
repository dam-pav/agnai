import { v4 } from 'uuid'
import { db } from './client'
import { AppSchema, NewBook } from '../../common/types/schema'

export async function getBooks(userId: string) {
  const books = await db('memory').find({ userId }).toArray()
  return books
}

export async function createBook(userId: string, book: NewBook) {
  const newBook: AppSchema.MemoryBook = {
    _id: v4(),
    kind: 'memory',
    userId,
    name: book.name,
    description: book.description || '',
    entries: book.entries.map((entry) => ({
      enabled: entry.enabled,
      entry: entry.entry,
      keywords: entry.keywords,
      name: entry.name,
      priority: entry.priority,
      weight: entry.weight,
    })),
  }

  await db('memory').insertOne(newBook)
  return newBook
}

export async function updateBook(userId: string, bookId: string, book: NewBook) {
  await db('memory').updateOne(
    { _id: bookId, userId },
    {
      $set: {
        name: book.name,
        description: book.description,
        entries: book.entries,
      },
    }
  )
}

export async function deleteBook(userId: string, bookId: string) {
  await db('memory').deleteOne({ _id: bookId, userId })
}

export async function getBook(bookId: string) {
  const ids = bookId
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  if (!ids.length) return

  if (ids.length === 1) {
    const book = await db('memory').findOne({ _id: ids[0] })
    return book || undefined
  }

  const books = await db('memory')
    .find({ _id: { $in: ids } })
    .toArray()

  if (!books.length) return

  const ordered = ids
    .map((id) => books.find((book) => book._id === id))
    .filter((book): book is AppSchema.MemoryBook => !!book)

  return {
    ...ordered[0],
    _id: ids.join(','),
    name: ordered.map((book) => book.name).join(', '),
    description: ordered.map((book) => book.description).filter(Boolean).join('\n'),
    entries: ordered.flatMap((book) => book.entries),
  }
}
