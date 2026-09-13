import { expect } from 'chai'
import { stripLeadingSpeakerName, stripResponseHint } from '../common/util'

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

describe('Response hint display', () => {
  it('hides an echoed hint and preserves the reply after its speaker label', () => {
    expect(
      stripResponseHint('(Hint: Answer warmly.)\nAlice: Hello! How are you?', 'Alice')
    ).to.equal('Hello! How are you?')
  })

  it('handles multiline hints, nested parentheses, and an initial speaker label', () => {
    expect(
      stripResponseHint(
        'Alice: (Hint: Be warm (not loud).\nAsk a question.)\nAlice: Hello!',
        'Alice'
      )
    ).to.equal('Hello!')
  })

  it('keeps incomplete streamed hints hidden until the reply arrives', () => {
    expect(stripResponseHint('(Hint: Answer warmly', 'Alice')).to.equal('')
    expect(stripResponseHint('(Hint: Answer warmly.)\nAlice: Hello', 'Alice')).to.equal('Hello')
  })

  it('preserves hint-like text within ordinary response content', () => {
    const text = 'Try this puzzle. (Hint: Look up.)'
    expect(stripResponseHint(text, 'Alice')).to.equal(text)
  })
})
