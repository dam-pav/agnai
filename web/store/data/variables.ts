import { v4 } from 'uuid'
import {
  VariableClass,
  VariableDefinition,
  validateVariableDefinition,
} from '/common/chat-variables'
import { api, isLoggedIn } from '../api'
import { localApi, saveVariableClasses } from './storage'

export const variablesApi = {
  async list() {
    if (isLoggedIn()) return api.get<{ classes: VariableClass[] }>('/variables')
    return localApi.result({ classes: await localApi.loadItem('variableClasses') })
  },
  async save(definition: VariableDefinition, id?: string) {
    validateVariableDefinition(definition)
    if (isLoggedIn())
      return id
        ? api.method<VariableClass>('put', `/variables/${id}`, definition)
        : api.post<VariableClass>('/variables', definition)
    const classes = await localApi.loadItem('variableClasses')
    const existing = classes.find((cls) => cls._id === id)
    if (id && !existing) return localApi.error('Variable class not found')
    const value: VariableClass = {
      ...definition,
      _id: id || v4(),
      kind: 'variable-class',
      userId: localApi.ID,
      revision: (existing?.revision || 0) + 1,
    }
    await saveVariableClasses(classes.filter((cls) => cls._id !== value._id).concat(value))
    return localApi.result(value)
  },
  async remove(id: string) {
    if (isLoggedIn()) return api.method('delete', `/variables/${id}`)
    const classes = await localApi.loadItem('variableClasses')
    await saveVariableClasses(classes.filter((cls) => cls._id !== id))
    return localApi.result({ success: true })
  },
}
