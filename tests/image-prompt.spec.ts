import { expect } from 'chai'
import { getImagePrompt } from '../common/image'

describe('Image prompt', () => {
  it('concatenates affixes without adding separators', () => {
    const result = getImagePrompt(
      { prompt: 'main prompt' },
      { type: 'horde', prefix: 'prefix', suffix: 'suffix' }
    )

    expect(result.prompt).to.equal('prefixmain promptsuffix')
    expect(result.rawPrompt).to.equal('main prompt')
  })
})
