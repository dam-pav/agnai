import { Router } from 'express'
import { loggedIn } from './auth'
import { handle, StatusError, errors } from './wrap'
import { validateVariableDefinition } from '/common/chat-variables'
import * as variables from '../db/variables'

const router = Router()
router.get(
  '/',
  loggedIn,
  handle(async ({ userId }) => ({ classes: await variables.getClasses(userId) }))
)
const save = handle(async ({ userId, body, params }) => {
  try {
    validateVariableDefinition(body)
  } catch (ex: any) {
    throw new StatusError(ex.message, 400)
  }
  const result = await variables.saveClass(userId, body, params.id)
  if (!result) throw errors.NotFound
  return result
})
router.post('/', loggedIn, save)
router.put('/:id', loggedIn, save)
router.delete(
  '/:id',
  loggedIn,
  handle(async ({ userId, params }) => {
    await variables.removeClass(userId, params.id)
    return { success: true }
  })
)
export default router
