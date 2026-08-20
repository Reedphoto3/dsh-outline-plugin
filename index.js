import s from '@deepseek-ai/schemastery'
import { transportError } from '@deepseek-ai/dsh-host-apiproxy/api'
import { z } from 'zod'

export const name = 'dsh-outline-plugin'
export const inject = ['connection', 'fs']

export const Config = s.object({
  storePath: s.string().default('.dsh-outline.json'),
})

const DEFAULT_TITLE = '大纲'
const STORE_VERSION = 1
const CHANNEL = '/dsh-outline'
const MAX_SESSION_ID_LENGTH = 256
const MAX_TITLE_LENGTH = 500
const MAX_TEXT_LENGTH = 100_000
const MAX_IMAGE_LENGTH = 8_000_000

const imageDataSchema = z.string()
  .max(MAX_IMAGE_LENGTH)
  .regex(/^data:image\/[^;,]+;base64,/u)

const nodeSchema = z.lazy(() => z.object({
  id: z.string().min(1).max(256),
  kind: z.enum(['todo', 'note']),
  text: z.string().max(MAX_TEXT_LENGTH),
  checked: z.boolean(),
  collapsed: z.boolean(),
  children: z.array(nodeSchema),
  image: z.string().min(1).max(MAX_IMAGE_LENGTH).optional(),
}))

const recordSchema = z.object({
  name: z.string().min(1).max(MAX_TITLE_LENGTH),
  items: z.array(nodeSchema),
  images: z.record(z.string(), imageDataSchema),
  mdPath: z.string().min(1).nullable(),
})

const storedRecordSchema = z.union([
  z.array(nodeSchema).transform((items) => ({
    name: DEFAULT_TITLE,
    items,
    images: {},
    mdPath: null,
  })),
  recordSchema,
])

const storeSchema = z.object({
  version: z.literal(STORE_VERSION),
  sessions: z.record(z.string(), storedRecordSchema),
})

const sessionRequestSchema = z.object({
  sessionId: z.string().min(1).max(MAX_SESSION_ID_LENGTH),
})

const saveRequestSchema = sessionRequestSchema.extend({
  tree: recordSchema.omit({ mdPath: true }),
})

const setPathRequestSchema = sessionRequestSchema.extend({
  path: z.string(),
})

function collectImageRefs(items, refs) {
  for (const node of items) {
    if (node.image && !node.image.startsWith('data:')) refs.add(node.image)
    collectImageRefs(node.children, refs)
  }
}

export function compactRecord(record) {
  const refs = new Set()
  collectImageRefs(record.items, refs)
  const images = {}
  for (const ref of refs) {
    const image = record.images[ref]
    if (image !== undefined) images[ref] = image
  }
  return { ...record, images }
}

function imageSource(record, ref) {
  if (!ref) return null
  if (ref.startsWith('data:')) return ref
  return record.images[ref] ?? null
}

function renderItems(record, items, depth, lines) {
  for (const node of items) {
    const padding = '  '.repeat(depth)
    lines.push(node.kind === 'todo'
      ? `${padding}- [${node.checked ? 'x' : ' '}] ${node.text}`
      : `${padding}- ${node.text}`)
    const source = imageSource(record, node.image)
    if (source !== null) lines.push(`${padding}  ![图片](${source})`)
    renderItems(record, node.children, depth + 1, lines)
  }
}

export function renderMarkdown(record) {
  const lines = [`# ${record.name}`, '']
  renderItems(record, record.items, 0, lines)
  return `${lines.join('\n')}\n`
}

function cloneRecord(record) {
  return structuredClone(record)
}

export class OutlineStore {
  #admitting = true
  #state = null
  #target = null
  #tail = Promise.resolve()

  constructor(fs, storePath) {
    this.fs = fs
    this.storePath = storePath
  }

  stop() {
    this.#admitting = false
  }

  settle() {
    return this.#tail
  }

  dispatch(endpoint, payload) {
    if (!this.#admitting) return Promise.reject(new Error('outline store is disposing'))
    const result = this.#tail.then(() => this.#dispatch(endpoint, payload))
    this.#tail = result.then(() => undefined, () => undefined)
    return result
  }

  async #dispatch(endpoint, payload) {
    switch (endpoint) {
      case 'load': return await this.#load(sessionRequestSchema.parse(payload))
      case 'save': return await this.#save(saveRequestSchema.parse(payload))
      case 'set-path': return await this.#setPath(setPathRequestSchema.parse(payload))
      default: throw new Error(`unknown outline endpoint: ${endpoint}`)
    }
  }

  async #load({ sessionId }) {
    const store = await this.#readStore()
    const record = store.sessions[sessionId]
    return record === undefined ? null : cloneRecord(record)
  }

  async #save({ sessionId, tree }) {
    const store = await this.#readStore()
    const previous = store.sessions[sessionId]
    const record = compactRecord({
      name: tree.name,
      items: tree.items,
      images: tree.images,
      mdPath: previous?.mdPath ?? null,
    })
    const next = {
      version: STORE_VERSION,
      sessions: { ...store.sessions, [sessionId]: record },
    }
    await this.#writeStore(next)
    this.#state = next
    const exportError = await this.#export(record)
    return { exportError }
  }

  async #setPath({ sessionId, path }) {
    const store = await this.#readStore()
    const previous = store.sessions[sessionId] ?? {
      name: DEFAULT_TITLE,
      items: [],
      images: {},
      mdPath: null,
    }
    const mdPath = path.trim() || null
    const record = { ...previous, mdPath }
    if (mdPath !== null) {
      const target = await this.fs.resolve(mdPath)
      await this.fs.writeText(target, renderMarkdown(record))
    }
    const next = {
      version: STORE_VERSION,
      sessions: { ...store.sessions, [sessionId]: record },
    }
    await this.#writeStore(next)
    this.#state = next
    return null
  }

  async #readStore() {
    if (this.#state !== null) return this.#state
    const target = await this.#storeTarget()
    let text
    try {
      text = await this.fs.readText(target)
    } catch (error) {
      if (error && error.code === 'FS_NOT_FOUND') {
        this.#state = { version: STORE_VERSION, sessions: {} }
        return this.#state
      }
      throw error
    }
    this.#state = storeSchema.parse(JSON.parse(text))
    return this.#state
  }

  async #writeStore(store) {
    await this.fs.writeText(await this.#storeTarget(), `${JSON.stringify(store, null, 2)}\n`)
  }

  async #storeTarget() {
    if (this.#target === null) this.#target = await this.fs.resolve(this.storePath)
    return this.#target
  }

  async #export(record) {
    if (record.mdPath === null) return null
    try {
      const target = await this.fs.resolve(record.mdPath)
      await this.fs.writeText(target, renderMarkdown(record))
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
}

export function apply(ctx, config) {
  const store = new OutlineStore(ctx.fs, config.storePath)
  ctx.effect(() => {
    const disposeChannel = ctx.connection.rpc.handle(
      CHANNEL,
      async (endpoint, payload) => {
        try {
          return { ok: true, value: await store.dispatch(endpoint, payload) }
        } catch (error) {
          return transportError(error)
        }
      },
      { authority: 'loopback' },
    )
    return async () => {
      store.stop()
      try {
        await disposeChannel()
      } finally {
        await store.settle()
      }
    }
  }, 'dsh-outline-plugin: loopback RPC channel')
}
