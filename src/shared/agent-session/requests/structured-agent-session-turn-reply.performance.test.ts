import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../journal/agent-session-journal-types'
import { structuredAgentSessionTurnReply } from './structured-agent-session-turn-reply'

// STA-18083 (#47901): an answered read-only turn kept scanning every earlier reply-window row
// looking for a side effect nobody reads once the turn has an answer.
function row(itemId: string, turnItemId: string, body: unknown): AgentJournalRenderItem {
  return {
    itemId,
    revision: 1,
    sequence: 0,
    observedAt: 0,
    turnScope: { kind: 'turn', turnItemId },
    body
  } as AgentJournalRenderItem
}

const say = (text: string) => ({
  kind: 'message',
  role: 'assistant',
  blocks: [{ type: 'text', text }]
})
const read = { kind: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } }
const edit = { kind: 'tool-call', name: 'Edit', input: { file_path: 'a.ts' } }

function window(historyRows: number, turn: AgentJournalRenderItem[]) {
  const history = Array.from({ length: historyRows }, (_, n) => row(`h${n}`, `old${n}`, read))
  const items = [...history, ...turn]
  let rowsRead = 0
  const counted = new Proxy(items, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) {
        rowsRead += 1
      }
      return Reflect.get(target, key, receiver)
    }
  })
  return { items: counted, rowsRead: () => rowsRead }
}

describe('structuredAgentSessionTurnReply scan', () => {
  it.each([1_000, 10_000])('reads only the answer rows of an answered turn after %i rows', (h) => {
    const { items, rowsRead } = window(h, [row('t', 't', read), row('a', 't', say('done'))])
    expect(structuredAgentSessionTurnReply(items, 't')).toEqual({
      prose: 'done',
      botProse: 'done',
      toolsRan: false
    })
    expect(rowsRead()).toBe(1)
  })

  it('still finds a side effect in a turn with no bot answer', () => {
    const { items } = window(1_000, [
      row('e', 't', edit),
      row('a', 't', say('looking')),
      row('r', 't', read)
    ])
    expect(structuredAgentSessionTurnReply(items, 't')).toEqual({
      prose: 'looking',
      botProse: '',
      toolsRan: true
    })
  })
})
