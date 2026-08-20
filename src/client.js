import * as React from 'react'

const store = {
  open: false,
  dragId: null,
  dragOverId: null,
  editRequestId: null,
  editRequestCaret: 0,
  activeId: null,
  tree: null,
  sessionId: null,
  listeners: new Set(),
  saveError: null,
}
let pendingCaret = 0
function emit() {
  store.listeners.forEach((fn) => fn())
}
function subscribe(fn) {
  store.listeners.add(fn)
  return () => store.listeners.delete(fn)
}
function useStore() {
  const snapshot = () => ({ open: store.open, dragOverId: store.dragOverId, saveError: store.saveError })
  const [snap, setSnap] = React.useState(snapshot)
  React.useEffect(() => subscribe(() => setSnap(snapshot())), [])
  return snap
}
function makeId() {
  return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
function makeNode(kind, text) {
  return { id: makeId(), kind, text, checked: false, collapsed: false, children: [] }
}
function locate(items, id, parentNode) {
  for (let i = 0; i < items.length; i += 1) {
    const node = items[i]
    if (node.id === id) return { node, siblings: items, index: i, parentNode }
    const found = locate(node.children || [], id, node)
    if (found) return found
  }
  return null
}
function setText(tree, id, text) {
  const hit = locate(tree.items, id)
  if (hit) hit.node.text = text
}
function toggleChecked(tree, id) {
  const hit = locate(tree.items, id)
  if (hit) hit.node.checked = !hit.node.checked
}
function toggleCollapsed(tree, id) {
  const hit = locate(tree.items, id)
  if (hit) hit.node.collapsed = !hit.node.collapsed
}
function removeItem(tree, id) {
  const hit = locate(tree.items, id)
  if (hit) hit.siblings.splice(hit.index, 1)
}
function move(tree, id, dir) {
  const hit = locate(tree.items, id)
  if (!hit) return false
  const target = hit.index + dir
  if (target < 0 || target >= hit.siblings.length) return false
  const node = hit.siblings.splice(hit.index, 1)[0]
  hit.siblings.splice(target, 0, node)
  return true
}
function indent(tree, id) {
  const hit = locate(tree.items, id)
  if (!hit || hit.index <= 0) return false
  const prev = hit.siblings[hit.index - 1]
  prev.children = prev.children || []
  const node = hit.siblings.splice(hit.index, 1)[0]
  prev.children.push(node)
  return true
}
function outdent(tree, id) {
  const hit = locate(tree.items, id)
  if (!hit || !hit.parentNode) return false
  const grand = locate(tree.items, hit.parentNode.id)
  const node = hit.siblings.splice(hit.index, 1)[0]
  if (grand) grand.siblings.splice(grand.index + 1, 0, node)
  return true
}
function isDescendant(tree, ancestorId, node) {
  let p = node.parentNode
  while (p) {
    if (p.id === ancestorId) return true
    const par = locate(tree.items, p.id)
    p = par ? par.parentNode : null
  }
  return false
}
function dropMove(tree, srcId, targetId, position) {
  if (srcId === targetId) return
  const src = locate(tree.items, srcId)
  const tgt = locate(tree.items, targetId)
  if (!src || !tgt) return
  if (isDescendant(tree, srcId, tgt)) return
  if (src.siblings === tgt.siblings) {
    const node = src.siblings.splice(src.index, 1)[0]
    let ti = tgt.index
    if (src.index < ti) ti -= 1
    const at = position > 0 ? ti + 1 : ti
    src.siblings.splice(Math.max(0, Math.min(at, src.siblings.length)), 0, node)
  } else {
    const node = src.siblings.splice(src.index, 1)[0]
    const at = position > 0 ? tgt.index + 1 : tgt.index
    tgt.siblings.splice(Math.max(0, Math.min(at, tgt.siblings.length)), 0, node)
  }
}
function countTodos(items) {
  let done = 0
  let total = 0
  for (const n of items) {
    if (n.kind === 'todo') {
      total += 1
      if (n.checked) done += 1
    }
    const sub = countTodos(n.children || [])
    done += sub.done
    total += sub.total
  }
  return { done, total }
}
function countNotes(items) {
  let n = 0
  for (const x of items) {
    if (x.kind === 'note') n += 1
    n += countNotes(x.children || [])
  }
  return n
}
function filterItems(items, view) {
  if (view === 'all') return items
  return items.filter((n) => n.kind === view)
}
function collectImages(items, out) {
  for (const n of items) {
    if (n.image) out.push(n)
    collectImages(n.children || [], out)
  }
  return out
}
function caretIndexAt(e, text) {
  try {
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const font = typeof window !== 'undefined' ? window.getComputedStyle(el).font : '13px sans-serif'
    const canvas = document.createElement('canvas')
    const g = canvas.getContext('2d')
    g.font = font
    let w = 0
    for (let i = 0; i < text.length; i += 1) {
      const cw = g.measureText(text[i]).width
      if (w + cw / 2 >= x) return i
      w += cw
    }
    return text.length
  } catch (err) {
    return text.length
  }
}
function hashImage(str) {
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0
    h2 = Math.imul(h2 ^ (c + i), 2246822519) >>> 0
  }
  return 'i' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + '-' + str.length.toString(16)
}
function storeImage(images, dataUrl) {
  const base = hashImage(dataUrl)
  let key = base
  let suffix = 1
  while (images[key] !== undefined && images[key] !== dataUrl) {
    key = base + '-' + suffix
    suffix += 1
  }
  images[key] = dataUrl
  return key
}
function downscaleImage(dataUrl, maxDim, quality) {
  return new Promise((resolve) => {
    try {
      const img = new Image()
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
          if (scale >= 1 && dataUrl.length < 500000) {
            resolve(dataUrl)
            return
          }
          const w = Math.max(1, Math.round(img.width * scale))
          const h = Math.max(1, Math.round(img.height * scale))
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const g = canvas.getContext('2d')
          g.fillStyle = '#fff'
          g.fillRect(0, 0, w, h)
          g.drawImage(img, 0, 0, w, h)
          let out = canvas.toDataURL('image/webp', quality)
          if (!out || out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/jpeg', quality)
          resolve(out)
        } catch (err) {
          resolve(dataUrl)
        }
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    } catch (err) {
      resolve(dataUrl)
    }
  })
}
function compactImages(tree) {
  const refs = new Set()
  function visit(items) {
    for (const node of items) {
      if (node.image && node.image.indexOf('data:') !== 0) refs.add(node.image)
      visit(node.children || [])
    }
  }
  visit(tree.items || [])
  const images = {}
  for (const ref of refs) {
    if (tree.images && typeof tree.images[ref] === 'string') images[ref] = tree.images[ref]
  }
  tree.images = images
}
function imageUrl(tree, node) {
  const ref = node.image
  if (!ref) return null
  if (ref.indexOf('data:') === 0) return ref
  const imgs = tree && tree.images
  return imgs && typeof imgs[ref] === 'string' ? imgs[ref] : null
}
const CSS = `.dsh-outline-toggle {
  appearance: none;
  border: 1px solid transparent;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  cursor: pointer;
  line-height: 20px;
}
.dsh-outline-toggle:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-outline-toggle.on {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-brand-primary);
}
.dsh-outline-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  overflow: hidden;
}
.dsh-outline-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex-shrink: 0;
}
.dsh-outline-name {
  font-weight: 600;
  cursor: text;
  border-radius: 3px;
  padding: 1px 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
}
.dsh-outline-name:hover {
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-outline-name-edit {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: inherit;
  outline: none;
}
.dsh-outline-progress {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.dsh-outline-add {
  background: none;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 4px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 8px;
}
.dsh-outline-add:hover {
  color: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-outline-gear {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 4px;
}
.dsh-outline-gear:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-outline-close {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 4px;
}
.dsh-outline-close:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-outline-tabs {
  display: flex;
  gap: 4px;
  padding: 6px 12px 2px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.dsh-outline-tab {
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 10px;
}
.dsh-outline-tab:hover {
  color: var(--dsw-alias-label-primary);
}
.dsh-outline-tab.on {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-border-l1);
}
.dsh-outline-settings {
  display: flex;
  gap: 6px;
  padding: 8px 12px 0;
  align-items: center;
  flex-shrink: 0;
}
.dsh-outline-path-input {
  flex: 1;
  min-width: 0;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 12px;
  outline: none;
}
.dsh-outline-path-input:focus {
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-outline-settings-hint {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  padding: 2px 12px 6px;
  flex-shrink: 0;
}
.dsh-outline-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}
.dsh-outline-item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 4px;
  min-height: 24px;
}
.dsh-outline-item:hover {
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-outline-item.drag-over {
  background: var(--dsw-alias-bg-layer-2);
  outline: 1px dashed var(--dsw-alias-brand-primary);
}
.dsh-outline-fold {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  font-size: 18px;
  font-weight: 700;
  width: 24px;
  padding: 0;
  flex-shrink: 0;
  margin-top: 1px;
  line-height: 1;
  border-radius: 4px;
  text-align: center;
}
.dsh-outline-fold:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
}
.dsh-outline-check {
  flex-shrink: 0;
  margin-top: 6px;
  cursor: pointer;
}
.dsh-outline-bullet {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
  margin-top: 8px;
  margin-left: 5px;
  margin-right: 5px;
  flex-shrink: 0;
}
.dsh-outline-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.dsh-outline-text {
  width: 100%;
  padding: 1px 4px;
  border-radius: 3px;
  cursor: text;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.5;
  min-height: 20px;
}
.dsh-outline-text:hover {
  background: var(--dsw-alias-bg-base);
}
.dsh-outline-text.done {
  text-decoration: line-through;
  color: var(--dsw-alias-label-secondary);
}
.dsh-outline-edit {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  line-height: 1.5;
  padding: 1px 4px;
  min-height: 20px;
}
.dsh-outline-imgwrap {
  position: relative;
  margin-top: 4px;
  align-self: flex-start;
  max-width: 100%;
}
.dsh-outline-img {
  display: block;
  max-width: 100%;
  max-height: 260px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
}
.dsh-outline-img-rm {
  position: absolute;
  top: 4px;
  right: 4px;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  padding: 0 5px;
  opacity: 0;
}
.dsh-outline-imgwrap:hover .dsh-outline-img-rm {
  opacity: 1;
}
.dsh-outline-attach-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 2px;
}
.dsh-outline-attach {
  position: relative;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  overflow: hidden;
}
.dsh-outline-attach-img {
  display: block;
  width: 100%;
  height: 120px;
  object-fit: cover;
  background: var(--dsw-alias-bg-base);
}
.dsh-outline-attach-cap {
  padding: 3px 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-outline-attach-rm {
  position: absolute;
  top: 4px;
  right: 4px;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  padding: 0 6px;
  opacity: 0;
}
.dsh-outline-attach:hover .dsh-outline-attach-rm {
  opacity: 1;
}
.dsh-outline-hint {
  color: var(--dsw-alias-label-secondary);
  padding: 14px 12px 6px;
  text-align: center;
}
.dsh-outline-empty-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  padding: 6px 0 14px;
}
.dsh-outline-error {
  color: var(--dsw-alias-state-error-primary);
  padding: 12px;
  text-align: center;
}
`
export const inject = ['slots', 'layout', 'connection']

function insertStyles() {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-outline-plugin'
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => tag.remove()
}

export function apply(ctx) {
    const slots = ctx.get('slots')
    const layout = ctx.get('layout')
    const connection = ctx.get('connection')
    if (slots === undefined || layout === undefined || connection === undefined) {
      throw new Error('dsh-outline-plugin: slots, layout, and connection are required')
    }
    ctx.effect(insertStyles, 'dsh-outline-plugin: styles')
    const host = {
      async call(method, payload) {
        const result = await connection.rpc.call('/dsh-outline', method, payload)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
    }

    function openPanel() {
      store.open = true
      emit()
      if (layout) layout.openDetails()
    }
    function closePanel() {
      store.open = false
      emit()
      if (layout) layout.closeDetails()
    }


    function saveNow(sessionId, tree) {
      if (!sessionId) return
      compactImages(tree)
      host.call('save', { sessionId, tree }).then((result) => {
        store.saveError = result && result.exportError ? 'Markdown 导出失败：' + result.exportError : null
        emit()
      }).catch((error) => {
        store.saveError = error && error.message ? error.message : String(error)
        emit()
      })
    }

    function Toggle() {
      const snap = useStore()
      return React.createElement('button', {
        className: 'dsh-outline-toggle' + (snap.open ? ' on' : ''),
        title: snap.open ? '收起 Todo & 笔记面板' : '打开 Todo & 笔记面板',
        onClick: () => {
          if (store.open) closePanel()
          else openPanel()
        },
      }, snap.open ? '✕ 笔记' : '📝 笔记')
    }

    function ItemRow(props) {
      const { node, depth, tree, onMutate, siblingKind } = props
      const [editing, setEditing] = React.useState(false)
      const [editText, setEditText] = React.useState(node.text)
      let escapePressed = false
      const children = node.children || []
      const hasChildren = children.length > 0

      function commit() {
        setText(tree, node.id, editText)
        onMutate()
        setEditing(false)
      }
      function beginEdit(caret) {
        escapePressed = false
        pendingCaret = caret == null ? node.text.length : caret
        store.activeId = node.id
        setEditText(node.text)
        setEditing(true)
      }

      React.useEffect(() => {
        if (!editing && store.editRequestId === node.id) {
          store.editRequestId = null
          beginEdit(store.editRequestCaret == null ? node.text.length : store.editRequestCaret)
        }
      })

      React.useEffect(() => {
        if (!editing) return
        const el = typeof document !== 'undefined' ? document.activeElement : null
        if (el && el.tagName === 'TEXTAREA' && typeof el.setSelectionRange === 'function') {
          try {
            el.setSelectionRange(pendingCaret, pendingCaret)
            el.style.height = 'auto'
            el.style.height = el.scrollHeight + 'px'
          } catch (err) {}
        }
      }, [editing])

      function onEditKeyDown(e) {
        const composing = !!(e.nativeEvent && e.nativeEvent.isComposing)
        if (composing) return
        const meta = e.metaKey || e.ctrlKey
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          setText(tree, node.id, editText)
          const hit = locate(tree.items, node.id)
          if (hit) {
            const sibling = makeNode(siblingKind, '')
            hit.siblings.splice(hit.index + 1, 0, sibling)
            store.editRequestId = sibling.id
            store.editRequestCaret = 0
          }
          setEditing(false)
          onMutate()
        } else if (e.key === 'Enter' && e.shiftKey) {
          try {
            const t = e.target
            t.style.height = 'auto'
            t.style.height = t.scrollHeight + 'px'
          } catch (err) {}
        } else if (e.key === 'Tab') {
          e.preventDefault()
          setText(tree, node.id, editText)
          const ok = e.shiftKey ? outdent(tree, node.id) : indent(tree, node.id)
          if (ok) onMutate()
        } else if (meta && e.key === 'ArrowUp') {
          e.preventDefault()
          setText(tree, node.id, editText)
          if (move(tree, node.id, -1)) onMutate()
        } else if (meta && e.key === 'ArrowDown') {
          e.preventDefault()
          setText(tree, node.id, editText)
          if (move(tree, node.id, 1)) onMutate()
        } else if (e.key === 'Escape') {
          escapePressed = true
          setEditing(false)
        } else if ((e.key === 'Backspace' || e.key === 'Delete') && editText === '') {
          e.preventDefault()
          const hit = locate(tree.items, node.id)
          let focusNode = null
          if (hit) {
            const sibs = hit.siblings
            sibs.splice(hit.index, 1)
            focusNode = sibs.length ? sibs[Math.min(hit.index, sibs.length - 1)] : null
          }
          if (focusNode) {
            store.editRequestId = focusNode.id
            store.editRequestCaret = focusNode.text.length
          }
          setEditing(false)
          onMutate()
        }
      }

      function onPaste(e) {
        const items = e.clipboardData && e.clipboardData.items
        if (!items) return
        for (let i = 0; i < items.length; i += 1) {
          const it = items[i]
          if (it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) {
            e.preventDefault()
            const file = it.getAsFile()
            if (!file) continue
            const reader = new FileReader()
            reader.onload = () => {
              const url = typeof reader.result === 'string' ? reader.result : null
              if (!url || url.length > 8000000) return
              downscaleImage(url, 1600, 0.85).then((small) => {
                tree.images = tree.images || {}
                node.image = storeImage(tree.images, small)
                onMutate()
              })
            }
            reader.readAsDataURL(file)
            return
          }
        }
      }

      const src = imageUrl(tree, node)
      const row = React.createElement('div', {
        className: 'dsh-outline-item' + (store.dragOverId === node.id ? ' drag-over' : ''),
        style: { paddingLeft: 2 + depth * 16 },
        draggable: true,
        onDragStart: (e) => {
          store.dragOverId = null
          store.dragId = node.id
          try { e.dataTransfer.setData('text/plain', node.id) } catch (err) {}
          try { e.dataTransfer.effectAllowed = 'move' } catch (err) {}
        },
        onDragEnter: (e) => {
          if (store.dragId && store.dragId !== node.id && store.dragOverId !== node.id) {
            store.dragOverId = node.id
            emit()
          }
        },
        onDragLeave: () => {
          if (store.dragOverId === node.id) {
            store.dragOverId = null
            emit()
          }
        },
        onDragOver: (e) => {
          if (store.dragId && store.dragId !== node.id) {
            try { e.preventDefault() } catch (err) {}
            try { e.dataTransfer.dropEffect = 'move' } catch (err) {}
          }
        },
        onDrop: (e) => {
          if (!store.dragId) return
          if (store.dragId !== node.id) {
            try { e.preventDefault() } catch (err) {}
            const rect = e.currentTarget.getBoundingClientRect()
            const position = e.clientY > rect.top + rect.height / 2 ? 1 : -1
            dropMove(tree, store.dragId, node.id, position)
            onMutate()
          }
          store.dragId = null
          store.dragOverId = null
          emit()
        },
        onDragEnd: () => {
          store.dragId = null
          store.dragOverId = null
          emit()
        },
      }, [
        React.createElement('button', {
          key: 'fold',
          className: 'dsh-outline-fold',
          draggable: false,
          style: { visibility: hasChildren ? 'visible' : 'hidden' },
          title: node.collapsed ? '展开' : '折叠',
          onClick: () => {
            toggleCollapsed(tree, node.id)
            onMutate()
          },
        }, node.collapsed ? '▸' : '▾'),
        node.kind === 'todo'
          ? React.createElement('input', {
              key: 'check',
              type: 'checkbox',
              className: 'dsh-outline-check',
              draggable: false,
              checked: !!node.checked,
              onChange: () => {
                toggleChecked(tree, node.id)
                onMutate()
              },
            })
          : React.createElement('span', { key: 'bullet', className: 'dsh-outline-bullet', draggable: false }),
        React.createElement('div', { key: 'content', className: 'dsh-outline-content' }, [
          editing
            ? React.createElement('textarea', {
                key: 'edit',
                className: 'dsh-outline-edit',
                value: editText,
                draggable: false,
                rows: 1,
                autoFocus: true,
                onChange: (e) => {
                  setEditText(e.target.value)
                  try {
                    e.target.style.height = 'auto'
                    e.target.style.height = e.target.scrollHeight + 'px'
                  } catch (err) {}
                },
                onKeyDown: onEditKeyDown,
                onPaste: onPaste,
                onBlur: () => {
                  if (!escapePressed) commit()
                },
              })
            : React.createElement('span', {
                key: 'text',
                className: 'dsh-outline-text' + (node.kind === 'todo' && node.checked ? ' done' : ''),
                title: '单击编辑 · Enter 新建 · Tab 缩进 · Cmd+↑/↓ 移动 · Alt+Cmd+8/9 切换类型',
                onClick: (e) => beginEdit(caretIndexAt(e, node.text)),
              }, node.text),
          src
            ? React.createElement('div', { key: 'imgwrap', className: 'dsh-outline-imgwrap' }, [
                React.createElement('img', { key: 'img', className: 'dsh-outline-img', src: src, alt: '' }),
                React.createElement('button', {
                  key: 'rm',
                  className: 'dsh-outline-img-rm',
                  title: '移除图片',
                  onClick: () => {
                    node.image = undefined
                    onMutate()
                  },
                }, '✕'),
              ])
            : null,
        ]),
      ])

      const childRows = node.collapsed || !hasChildren
        ? []
        : children.map((child) => React.createElement(ItemRow, {
            key: child.id,
            node: child,
            depth: depth + 1,
            tree,
            onMutate,
            siblingKind,
          }))

      return React.createElement('div', { className: 'dsh-outline-node' }, [row, ...childRows])
    }

    function Panel(props) {
      const snap = useStore()
      const [tree, setTree] = React.useState({ version: 1, name: '大纲', items: [], images: {} })
      const [status, setStatus] = React.useState('idle')
      const [view, setView] = React.useState('all')
      const [fontSize, setFontSize] = React.useState(14)
      const [editingName, setEditingName] = React.useState(false)
      const [nameDraft, setNameDraft] = React.useState('')
      const [showSettings, setShowSettings] = React.useState(false)
      const [mdPath, setMdPath] = React.useState('')
      const [pathDraft, setPathDraft] = React.useState('')
      const [pathMsg, setPathMsg] = React.useState('')
      const sessionId = props.sessionId

      store.tree = tree
      store.sessionId = sessionId

      React.useEffect(() => {
        if (typeof window === 'undefined') return
        function onKey(e) {
          if (!e.altKey || !(e.metaKey || e.ctrlKey)) return
          if (e.key !== '8' && e.key !== '9') return
          const id = store.activeId
          const t = store.tree
          const sid = store.sessionId
          if (!id || !t || !sid) return
          const hit = locate(t.items, id)
          if (!hit) return
          hit.node.kind = e.key === '8' ? 'todo' : 'note'
          setTree({ ...t })
          saveNow(sid, t)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      React.useEffect(() => {
        if (!sessionId) {
          setTree({ version: 1, name: '大纲', items: [], images: {} })
          setStatus('idle')
          return
        }
        let cancelled = false
        store.activeId = null
        setStatus('loading')
        host.call('load', { sessionId }).then((data) => {
          if (cancelled) return
          const items = data && Array.isArray(data.items) ? data.items : []
          const name = data && typeof data.name === 'string' && data.name ? data.name : '大纲'
          const images = data && data.images && typeof data.images === 'object' ? data.images : {}
          let migrated = false
          function migrate(list) {
            for (const n of list) {
              if (n.image && typeof n.image === 'string' && n.image.indexOf('data:') === 0) {
                n.image = storeImage(images, n.image)
                migrated = true
              }
              migrate(n.children || [])
            }
          }
          migrate(items)
          const next = { version: 1, name, items, images }
          setTree(next)
          setMdPath(data && typeof data.mdPath === 'string' ? data.mdPath : '')
          setPathDraft(data && typeof data.mdPath === 'string' ? data.mdPath : '')
          setPathMsg('')
          setStatus('idle')
          if (migrated) saveNow(sessionId, next)
        }).catch(() => {
          if (!cancelled) setStatus('error')
        })
        return () => {
          cancelled = true
        }
      }, [sessionId])

      function mutate() {
        setTree({ ...tree })
        saveNow(sessionId, tree)
      }
      function addTop(kind) {
        const n = makeNode(kind, '')
        tree.items.push(n)
        store.editRequestId = n.id
        store.editRequestCaret = 0
        setTree({ ...tree })
        saveNow(sessionId, tree)
      }
      function commitName() {
        const next = nameDraft.trim()
        tree.name = next ? next : '大纲'
        setTree({ ...tree })
        saveNow(sessionId, tree)
        setEditingName(false)
      }
      function bumpFont(d) {
        setFontSize(Math.max(11, Math.min(22, fontSize + d)))
      }
      function savePath() {
        const path = pathDraft.trim()
        setPathMsg('保存中…')
        host.call('set-path', { sessionId, path }).then(() => {
          setMdPath(path)
          setPathMsg(path ? '已设置，每次修改将同步导出 Markdown' : '已清除，仅使用内置存储')
        }).catch(() => {
          setPathMsg('保存失败')
        })
      }

      const prog = countTodos(tree.items)
      const notes = countNotes(tree.items)
      const shown = filterItems(tree.items, view)
      const rows = shown.map((n) => React.createElement(ItemRow, {
        key: n.id,
        node: n,
        depth: 0,
        tree,
        onMutate: mutate,
        siblingKind: n.kind,
      }))

      let body
      if (status === 'loading') {
        body = React.createElement('div', { className: 'dsh-outline-hint' }, '加载中…')
      } else if (status === 'error') {
        body = React.createElement('div', { className: 'dsh-outline-error' }, '加载失败，请收起后重新打开面板')
      } else if (view === 'attach') {
        const imageNodes = collectImages(tree.items, [])
        const gallery = imageNodes.map((n) => {
          const s = imageUrl(tree, n)
          if (!s) return null
          return React.createElement('div', { key: n.id, className: 'dsh-outline-attach' }, [
            React.createElement('img', { key: 'img', className: 'dsh-outline-attach-img', src: s, alt: '' }),
            React.createElement('div', { key: 'cap', className: 'dsh-outline-attach-cap' }, n.text || '（无标题）'),
            React.createElement('button', {
              key: 'rm',
              className: 'dsh-outline-attach-rm',
              title: '移除图片',
              onClick: () => {
                n.image = undefined
                mutate()
              },
            }, '✕'),
          ])
        }).filter(Boolean)
        body = gallery.length > 0
          ? React.createElement('div', { className: 'dsh-outline-attach-grid' }, gallery)
          : React.createElement('div', { className: 'dsh-outline-hint' }, '暂无图片：在笔记中粘贴图片后会显示在这里')
      } else if (rows.length === 0) {
        const addButtons = []
        if (view === 'all' || view === 'todo') {
          addButtons.push(React.createElement('button', { key: 'todo', className: 'dsh-outline-add', onClick: () => addTop('todo') }, '＋待办'))
        }
        if (view === 'all' || view === 'note') {
          addButtons.push(React.createElement('button', { key: 'note', className: 'dsh-outline-add', onClick: () => addTop('note') }, '＋笔记'))
        }
        body = React.createElement('div', null, [
          React.createElement('div', { key: 'hint', className: 'dsh-outline-hint' }, '暂无内容，添加一条开始（单击条目即可编辑，Enter 新建同级，编辑时可直接粘贴图片）'),
          React.createElement('div', { key: 'acts', className: 'dsh-outline-empty-actions' }, addButtons),
        ])
      } else {
        body = rows
      }

      let countText = ''
      if (prog.total > 0) countText += prog.done + '/' + prog.total
      if (prog.total > 0 && notes > 0) countText += ' · '
      if (notes > 0) countText += '笔记' + notes

      return React.createElement('div', { className: 'dsh-outline-panel', style: { fontSize: fontSize + 'px' } }, [
        React.createElement('div', { key: 'head', className: 'dsh-outline-head' }, [
          editingName
            ? React.createElement('input', {
                key: 'name',
                className: 'dsh-outline-name-edit',
                value: nameDraft,
                autoFocus: true,
                onChange: (e) => setNameDraft(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') commitName()
                  else if (e.key === 'Escape') setEditingName(false)
                },
                onBlur: commitName,
              })
            : React.createElement('span', {
                key: 'name',
                className: 'dsh-outline-name',
                title: '点击重命名',
                onClick: () => {
                  setNameDraft(tree.name || '大纲')
                  setEditingName(true)
                },
              }, tree.name || '大纲'),
          React.createElement('span', { key: 'counts', className: 'dsh-outline-progress' }, countText),
          React.createElement('button', { key: 'f-', className: 'dsh-outline-add', title: '减小字体', onClick: () => bumpFont(-1) }, 'A−'),
          React.createElement('button', { key: 'f+', className: 'dsh-outline-add', title: '增大字体', onClick: () => bumpFont(1) }, 'A＋'),
          React.createElement('button', { key: 'gear', className: 'dsh-outline-gear', title: '存储设置', onClick: () => setShowSettings(!showSettings) }, '⚙'),
          React.createElement('button', { key: 'close', className: 'dsh-outline-close', title: '收起面板', onClick: closePanel }, '✕'),
        ]),
        React.createElement('div', { key: 'tabs', className: 'dsh-outline-tabs' }, [
          ['all', '全部'], ['todo', '待办'], ['note', '笔记'], ['attach', '附件'],
        ].map((pair) => React.createElement('button', {
          key: pair[0],
          className: 'dsh-outline-tab' + (view === pair[0] ? ' on' : ''),
          onClick: () => setView(pair[0]),
        }, pair[1]))),
        showSettings
          ? React.createElement('div', { key: 'settings' }, [
              React.createElement('div', { key: 'row', className: 'dsh-outline-settings' }, [
                React.createElement('span', { key: 'label', style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } }, 'Markdown 路径'),
                React.createElement('input', {
                  key: 'input',
                  className: 'dsh-outline-path-input',
                  placeholder: '如 notes.md 或 /绝对/路径/notes.md（相对路径基于工作区）',
                  value: pathDraft,
                  onChange: (e) => setPathDraft(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') savePath()
                  },
                }),
                React.createElement('button', { key: 'save', className: 'dsh-outline-add', onClick: savePath }, '保存'),
              ]),
              React.createElement('div', { key: 'hint', className: 'dsh-outline-settings-hint' }, pathMsg || (mdPath ? '当前导出：' + mdPath : '数据存储于宿主工作区 .dsh-outline.json（非浏览器 localStorage）')),
            ])
          : null,
        snap.saveError
          ? React.createElement('div', { key: 'save-error', className: 'dsh-outline-error', role: 'status' }, '保存失败：' + snap.saveError)
          : null,
        React.createElement('div', { key: 'body', className: 'dsh-outline-body' }, body),
      ])
    }

    slots.inject('conversation.session.header.utilities', () => slots.register(
      { name: 'conversation.session.header.utilities', id: 'outline-toggle', order: 100, label: '笔记' },
      () => React.createElement(Toggle, null),
    ))

    slots.inject('details', () => slots.register(
      { name: 'details', priority: -100 },
      (props) => React.createElement(Panel, { sessionId: props.sessionId }),
    ))
}
