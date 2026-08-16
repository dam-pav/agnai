import { expect } from 'chai'
import { stripLeadingSpeakerName } from '../common/util'

describe('Speaker prefix normalization', () => {
  it('removes repeated speaker labels from the beginning of a reply', () => {
    const result = stripLeadingSpeakerName(
      'Little Red Hood: Little Red Hood: Little Red Hood: Hello there.',
      'Little Red Hood'
    )

    expect(result).to.equal('Hello there.')
  })

  it('handles names containing regular expression characters', () => {
    const result = stripLeadingSpeakerName('Dr. Red (Hood): Ready.', 'Dr. Red (Hood)')

    expect(result).to.equal('Ready.')
  })

  it('does not remove a speaker name used as ordinary prose', () => {
    const result = stripLeadingSpeakerName('Little Red Hood enters the room.', 'Little Red Hood')

    expect(result).to.equal('Little Red Hood enters the room.')
  })
})
