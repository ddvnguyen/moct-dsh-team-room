import { describe, expect, it } from 'vitest'

import {
  buildMemoryView,
  buildThreadTreeSeed,
  compactMemoryTree,
  MEMORY_LINE_BYTE_LIMIT,
  memoryLeaf,
  memoryLineRange,
  mergeMemoryLines,
  TREE_SEED_LEAF_RESERVE,
  zoomMemoryLine,
  type MemoryTreeLine,
} from '../src/thread-memory-tree'
import { estimateTokens } from '../src/thread-summary'

const encoder = new TextEncoder()
const bytes = (text: string): number => encoder.encode(text).length

function message(index: number, body: string): { messageRef: string; sender: string; body: string } {
  return { messageRef: `message:m${String(index).padStart(3, '0')}`, sender: index % 2 === 0 ? 'seat-a' : 'human', body }
}

function messagesOf(count: number, body: string): { messageRef: string; sender: string; body: string }[] {
  return Array.from({ length: count }, (_, index) => message(index, body))
}

describe('memory leaves', () => {
  it('keeps a short Message verbatim', () => {
    const leaf = memoryLeaf(message(1, 'short body'))
    expect(leaf.kind).toBe('leaf')
    expect(leaf.text).toBe('short body')
    expect(leaf.messageRef).toBe('message:m001')
  })

  it('compacts a long Message to the line limit and marks the cut', () => {
    const leaf = memoryLeaf(message(2, 'x'.repeat(2000)))
    expect(leaf.text).toContain('[truncated]')
    expect(bytes(leaf.text)).toBeLessThanOrEqual(MEMORY_LINE_BYTE_LIMIT)
    expect(leaf.text.startsWith('x')).toBe(true)
  })

  it('uses the provided compactor for a long Message and caps its output', () => {
    const leaf = memoryLeaf(message(3, 'y'.repeat(2000)), (body) => `compressed of ${body.length}`)
    expect(leaf.text.startsWith('compressed of')).toBe(true)
    expect(bytes(leaf.text)).toBeLessThanOrEqual(MEMORY_LINE_BYTE_LIMIT)
  })
})

describe('pairwise merges and compaction', () => {
  it('merges two adjacent lines and keeps the branch within the line limit', () => {
    const branch = mergeMemoryLines(memoryLeaf(message(1, 'first')), memoryLeaf(message(2, 'second')))
    expect(branch.kind).toBe('branch')
    expect(bytes(branch.text)).toBeLessThanOrEqual(MEMORY_LINE_BYTE_LIMIT)
    expect(branch.left.text).toBe('first')
  })

  it('compacts oldest-first while the newest leaves stay whole and one line covers the rest', () => {
    const leaves = messagesOf(30, 'same text').map(entry => memoryLeaf(entry))
    const tree = compactMemoryTree(leaves, 10)
    expect(tree).toHaveLength(10)
    // Merging stops when 10 lines remain: one branch covering 21 Messages, nine whole leaves.
    expect(tree[0]!.kind).toBe('branch')
    expect(tree.slice(1).every(line => line.kind === 'leaf')).toBe(true)
    const range = memoryLineRange(tree[0]!)
    expect(range).toHaveLength(21)
    expect(range[0]).toBe('message:m000')
    expect(range.at(-1)).toBe('message:m020')
  })

  it('returns the input unchanged when it already fits the reserve, and rebuilds deterministically', () => {
    const leaves = messagesOf(8, 'same text').map(entry => memoryLeaf(entry))
    const tree = compactMemoryTree(leaves, TREE_SEED_LEAF_RESERVE)
    expect(tree.every(line => line.kind === 'leaf')).toBe(true)
    expect(compactMemoryTree(leaves, TREE_SEED_LEAF_RESERVE).join()).toBe(tree.join())
  })

  it('refuses a reserve smaller than two', () => {
    const leaves = messagesOf(4, 'same').map(entry => memoryLeaf(entry))
    expect(() => compactMemoryTree(leaves, 1)).toThrow(/at least 2/)
  })
})

describe('zoom', () => {
  it('opens a branch into its two halves', () => {
    const leaves = messagesOf(4, 'same').map(entry => memoryLeaf(entry))
    const branch = compactMemoryTree(leaves, 2)[0] as MemoryTreeLine & { kind: 'branch' }
    const opened = zoomMemoryLine(branch)
    expect(opened).toHaveLength(2)
    expect(opened[0]!.kind).toBe('branch')
    expect(opened[1]!.kind).toBe('leaf')
  })

  it('keeps a leaf as itself', () => {
    const leaf = memoryLeaf(message(5, 'body'))
    expect(zoomMemoryLine(leaf)).toEqual([leaf])
  })
})

describe('bounded view', () => {
  const leaves = messagesOf(6, 'same text').map(entry => memoryLeaf(entry))

  it('shows the newest contiguous lines that fit and names the omitted count', () => {
    const view = buildMemoryView(leaves, 120)
    expect(view.shown).toBeGreaterThan(0)
    expect(view.shown).toBeLessThan(leaves.length)
    expect(view.omitted).toBe(leaves.length - view.shown)
    // The view is a suffix of the full render, newest line included.
    const lastLine = `[message:m005] human: same text`
    expect(view.view.endsWith(lastLine)).toBe(true)
  })

  it('shows nothing when the budget is zero', () => {
    const view = buildMemoryView(leaves, 0)
    expect(view.shown).toBe(0)
    expect(view.omitted).toBe(leaves.length)
    expect(view.view).toBe('')
  })
})

describe('the fork seed', () => {
  it('carries the summary and the newest Message bodies verbatim in tree order', () => {
    const messages = messagesOf(12, 'body text')
    const seed = buildThreadTreeSeed({
      threadRef: 'thread:t1',
      summary: { generation: 4, text: 'Thread summary text' },
      messages,
    }, { tokens: 4000 })
    expect(seed).toContain('Thread memory tree for thread:t1')
    expect(seed).toContain('Summary (generation 4):')
    expect(seed).toContain('Thread summary text')
    // Newest bodies render as whole leaves, oldest live in a merged branch line.
    expect(seed).toContain('[message:m011] human: body text')
    expect(seed).not.toContain('earlier line(s) left out')
    expect(estimateTokens(seed)).toBeLessThanOrEqual(4000)
  })

  it('stays inside a small budget by omitting oldest lines with a count', () => {
    const messages = messagesOf(80, 'b'.repeat(80))
    const seed = buildThreadTreeSeed({ threadRef: 'thread:t2', messages }, { tokens: 350 })
    expect(seed).toContain('earlier line(s) left out')
    expect(estimateTokens(seed)).toBeLessThanOrEqual(350)
    expect(seed).toContain('[message:m079] human: ')
  })

  it('truncates an oversized summary instead of dropping it', () => {
    const seed = buildThreadTreeSeed({
      threadRef: 'thread:t3',
      summary: { generation: 9, text: 'z'.repeat(90_000) },
      messages: messagesOf(20, 'body'),
    }, { tokens: 2_000 })
    expect(seed).toContain('[truncated]')
    expect(estimateTokens(seed)).toBeLessThanOrEqual(2_000)
    expect(seed).toContain('Summary (generation 9):')
  })

  it('states the absence of a summary', () => {
    const seed = buildThreadTreeSeed({ threadRef: 'thread:t4', messages: messagesOf(3, 'body') }, { tokens: 2000 })
    expect(seed).toContain('(none yet)')
    expect(seed).toContain('[message:m002] seat-a: body')
  })

  it('handles an empty tree', () => {
    const seed = buildThreadTreeSeed({ threadRef: 'thread:t5', messages: [] }, { tokens: 2000 })
    expect(seed).toContain('(no committed Messages yet)')
    expect(seed).toContain('Thread memory tree for thread:t5')
  })

  it('is limited by tokens, not Messages: 500 long Messages still fit a 32k seed', () => {
    const messages = messagesOf(500, 'w'.repeat(700))
    const seed = buildThreadTreeSeed({ threadRef: 'thread:t6', messages }, { tokens: 32_000 })
    expect(estimateTokens(seed)).toBeLessThanOrEqual(32_000)
    expect(seed).toContain('[message:m499] human: ')
  })
})
