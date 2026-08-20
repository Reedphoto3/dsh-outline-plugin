import { describe, expect, it } from 'vitest'
import { OutlineStore, compactRecord, renderMarkdown } from '../index.js'

function node(overrides = {}) {
  return {
    id: 'node-1',
    kind: 'note',
    text: 'Note',
    checked: false,
    collapsed: false,
    children: [],
    ...overrides,
  }
}

class MemoryFs {
  files = new Map()
  writes = []

  async resolve(path) {
    return path
  }

  async readText(path) {
    if (!this.files.has(path)) {
      const error = new Error(`missing: ${path}`)
      error.code = 'FS_NOT_FOUND'
      throw error
    }
    return this.files.get(path)
  }

  async writeText(path, content) {
    this.files.set(path, content)
    this.writes.push({ path, content })
  }
}

describe('outline model', () => {
  it('keeps only referenced image payloads', () => {
    const record = compactRecord({
      name: 'Outline',
      items: [node({ image: 'used' })],
      images: { used: 'data:image/png;base64,dXNlZA==', orphan: 'data:image/png;base64,b3JwaGFu' },
      mdPath: null,
    })
    expect(record.images).toEqual({ used: 'data:image/png;base64,dXNlZA==' })
  })

  it('renders nested todos, notes, and images as markdown', () => {
    const record = {
      name: 'Outline',
      items: [node({
        id: 'todo-1',
        kind: 'todo',
        text: 'Ship',
        checked: true,
        image: 'image-1',
        children: [node({ id: 'note-2', text: 'Review' })],
      })],
      images: { 'image-1': 'data:image/png;base64,aW1hZ2U=' },
      mdPath: null,
    }
    expect(renderMarkdown(record)).toBe(
      '# Outline\n\n- [x] Ship\n  ![图片](data:image/png;base64,aW1hZ2U=)\n  - Review\n',
    )
  })
})

describe('OutlineStore', () => {
  it('persists, reloads, exports, and prunes orphaned images', async () => {
    const fs = new MemoryFs()
    const store = new OutlineStore(fs, '.dsh-outline.json')
    const tree = {
      name: 'Outline',
      items: [node({ image: 'used' })],
      images: { used: 'data:image/png;base64,dXNlZA==', orphan: 'data:image/png;base64,b3JwaGFu' },
    }

    await expect(store.dispatch('save', { sessionId: 'session-1', tree })).resolves.toEqual({ exportError: null })
    await expect(store.dispatch('set-path', { sessionId: 'session-1', path: 'notes.md' })).resolves.toBeNull()
    await expect(store.dispatch('load', { sessionId: 'session-1' })).resolves.toMatchObject({
      name: 'Outline',
      images: { used: 'data:image/png;base64,dXNlZA==' },
      mdPath: 'notes.md',
    })

    expect(fs.files.get('notes.md')).toContain('# Outline')
    expect(JSON.parse(fs.files.get('.dsh-outline.json')).sessions['session-1'].images).toEqual({
      used: 'data:image/png;base64,dXNlZA==',
    })
  })

  it('fails on malformed durable data instead of replacing it with an empty store', async () => {
    const fs = new MemoryFs()
    fs.files.set('.dsh-outline.json', '{not json')
    const store = new OutlineStore(fs, '.dsh-outline.json')

    await expect(store.dispatch('load', { sessionId: 'session-1' })).rejects.toThrow()
    expect(fs.writes).toEqual([])
  })

  it('stops admitting work before disposal settles', async () => {
    const store = new OutlineStore(new MemoryFs(), '.dsh-outline.json')
    store.stop()
    await expect(store.dispatch('load', { sessionId: 'session-1' })).rejects.toThrow('disposing')
    await expect(store.settle()).resolves.toBeUndefined()
  })
})
