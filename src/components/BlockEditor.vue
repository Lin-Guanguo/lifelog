<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { t } from '../i18n'
import { parseContent, serializeContent, type PhotoRef } from '../media/content'
import AppIcon from './AppIcon.vue'
import MediaImage from './MediaImage.vue'

// An entry as plain text fields and photo thumbnails, in order. No formatting. Photos are inserted at the
// cursor and moved by long-press dragging: while one is held the entry shrinks to an overview so every
// gap is in reach, and the bottom bar becomes a remove zone.
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [content: string] }>()

type TextBlock = { id: number; type: 'text'; text: string; joint?: string }
type PhotoBlock = { id: number; type: 'photo'; photo: PhotoRef }
type EditBlock = TextBlock | PhotoBlock
// While dragging, text is a list of non-empty lines; `para` marks a line that starts a paragraph and `gap` is
// exactly what separated it from the line before, so rebuilding the text changes nothing else.
type Line = { id: number; type: 'line'; text: string; para: boolean; gap: string }
type Item = Line | PhotoBlock

let nextId = 0
const textBlock = (text: string, joint?: string): TextBlock => ({ id: nextId++, type: 'text', text, joint })
const photoBlock = (photo: PhotoRef): PhotoBlock => ({ id: nextId++, type: 'photo', photo })

// Adjacent text joins (with the break it had when a paragraph was split by dragging); the last block is
// always text, so there is somewhere to type after the photos.
function normalize(list: EditBlock[]): EditBlock[] {
  const out: EditBlock[] = []
  for (const b of list) {
    const prev = out[out.length - 1]
    if (b.type === 'text' && prev?.type === 'text') prev.text = [prev.text, b.text].filter((s) => s.trim()).join(b.joint ?? '\n\n')
    else out.push(b.type === 'text' ? { ...b, joint: undefined } : b)
  }
  if (out[out.length - 1]?.type !== 'text') out.push(textBlock(''))
  return out
}

const blocks = ref<EditBlock[]>(normalize(parseContent(props.modelValue)
  .map((b) => (b.type === 'text' ? textBlock(b.text) : photoBlock(b.photo)))))
const scroller = ref<HTMLElement>()
const landed = ref(new Set<number>())
let focus = { id: -1, pos: 0 }

function changed() {
  emit('update:modelValue', serializeContent(blocks.value.map((b) => (b.type === 'text'
    ? { type: 'text' as const, text: b.text }
    : { type: 'photo' as const, photo: b.photo }))))
}

type Segment = { type: 'text'; block: TextBlock } | { type: 'group'; key: number; photos: PhotoBlock[] }
const segments = computed(() => {
  const out: Segment[] = []
  for (const b of blocks.value) {
    const last = out[out.length - 1]
    if (b.type === 'text') out.push({ type: 'text', block: b })
    else if (last?.type === 'group') last.photos.push(b)
    else out.push({ type: 'group', key: b.id, photos: [b] })
  }
  return out
})
const lastText = computed(() => blocks.value[blocks.value.length - 1] as TextBlock)

// Text fields grow with their text. Not measurable before they are laid out (scrollHeight 0), so
// they are measured again once the editor is on screen.
function grow(el: unknown) {
  if (!(el instanceof HTMLTextAreaElement)) return
  el.style.height = 'auto'
  if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`
}
onMounted(() => requestAnimationFrame(() => scroller.value?.querySelectorAll('textarea').forEach(grow)))

function remember(block: TextBlock, event: Event) {
  focus = { id: block.id, pos: (event.target as HTMLTextAreaElement).selectionStart }
}

function onInput(block: TextBlock, event: Event) {
  const el = event.target as HTMLTextAreaElement
  block.text = el.value
  grow(el)
  remember(block, event)
  changed()
}

function flash(ids: number[]) {
  landed.value = new Set(ids)
  window.setTimeout(() => { landed.value = new Set() }, 900)
}

async function focusText(id: number, pos: number) {
  await nextTick()
  const el = scroller.value?.querySelector<HTMLTextAreaElement>(`textarea[data-id="${id}"]`)
  el?.focus()
  el?.setSelectionRange(pos, pos)
}

// Photos go in at the cursor (splitting the paragraph there), or at the end.
function insert(photos: PhotoRef[]) {
  if (photos.length === 0) return
  const list = blocks.value.slice()
  let i = list.findIndex((b) => b.id === focus.id && b.type === 'text')
  if (i < 0) i = list.length - 1
  const block = list[i] as TextBlock
  const at = block.id === focus.id ? Math.min(focus.pos, block.text.length) : block.text.length
  const before = block.text.slice(0, at).replace(/\n+$/, '')
  const after = textBlock(block.text.slice(at).replace(/^\n+/, ''))
  const added = photos.map(photoBlock)
  // No empty field between the new photos and photos right after them: they are one group.
  const keepAfter = after.text !== '' || list[i + 1]?.type !== 'photo'
  list.splice(i, 1, ...(before ? [textBlock(before)] : []), ...added, ...(keepAfter ? [after] : []))
  blocks.value = normalize(list)
  changed()
  flash(added.map((b) => b.id))
  if (keepAfter) {
    focus = { id: after.id, pos: 0 }
    void focusText(after.id, 0)
  }
}

function remove(block: PhotoBlock) {
  blocks.value = normalize(blocks.value.filter((b) => b !== block))
  changed()
}

function focusEnd() {
  void focusText(lastText.value.id, lastText.value.text.length)
}

defineExpose({ insert, focusEnd })

// Dragging

const drag = ref<{ block: PhotoBlock; items: Item[]; from: number; slot: number; x: number; y: number; touch: boolean; overDelete: boolean }>()
const zone = ref<HTMLElement>()

function toItems(list: EditBlock[], held?: PhotoBlock): Item[] {
  const items: Item[] = []
  for (const b of list) {
    if (b.type === 'photo') {
      if (b !== held) items.push(b)
      continue
    }
    let blanks: string[] = []
    let first = true
    for (const line of b.text.split('\n')) {
      if (!line.trim()) {
        blanks.push(line)
        continue
      }
      const gap = first ? '\n\n' : `\n${blanks.map((l) => `${l}\n`).join('')}`
      items.push({ id: nextId++, type: 'line', text: line, para: first || blanks.length > 0, gap })
      blanks = []
      first = false
    }
  }
  return items
}

function fromItems(items: Item[]): EditBlock[] {
  const list: EditBlock[] = []
  let text: TextBlock | undefined
  for (const it of items) {
    if (it.type === 'photo') {
      text = undefined
      list.push(it)
    } else if (!text) {
      text = textBlock(it.text)
      list.push(text)
    } else {
      text.text += it.gap + it.text
    }
  }
  return normalize(list)
}

type ArrangeSegment = { type: 'line'; line: Line; k: number } | { type: 'group'; key: string; entries: ({ photo: PhotoBlock; k: number } | { slot: true })[] }
const arranging = computed(() => {
  if (!drag.value) return []
  const { items, slot, overDelete } = drag.value
  const out: ArrangeSegment[] = []
  const group = () => {
    const last = out[out.length - 1]
    if (last?.type === 'group') return last
    const created: ArrangeSegment = { type: 'group', key: `g${out.length}`, entries: [] }
    out.push(created)
    return created
  }
  items.forEach((it, k) => {
    if (k === slot && !overDelete) group().entries.push({ slot: true })
    if (it.type === 'line') out.push({ type: 'line', line: it, k })
    else group().entries.push({ photo: it, k })
  })
  if (slot === items.length && !overDelete) group().entries.push({ slot: true })
  return out
})

function startDrag(block: PhotoBlock, x: number, y: number, touch: boolean) {
  ;(document.activeElement as HTMLElement | null)?.blur()
  const index = blocks.value.indexOf(block)
  const from = toItems(blocks.value.slice(0, index)).length
  drag.value = { block, items: toItems(blocks.value, block), from, slot: from, x, y, touch, overDelete: false }
  navigator.vibrate?.(15)
  void nextTick(() => {
    // Keep the landing spot under the finger after the entry shrinks.
    const slot = scroller.value?.querySelector('.slot')?.getBoundingClientRect()
    if (slot && scroller.value) scroller.value.scrollTop += slot.top + slot.height / 2 - y
    requestAnimationFrame(autoScroll)
  })
}

// The gap nearest the pointer: beside a photo by x, above or below a line by y.
function hitTest() {
  const d = drag.value
  if (!d) return
  const overDelete = !!zone.value && d.y >= zone.value.getBoundingClientRect().top - 8
  if (overDelete !== d.overDelete) {
    d.overDelete = overDelete
    navigator.vibrate?.(8)
  }
  if (overDelete || document.elementFromPoint(d.x, d.y)?.closest('.slot')) return
  let best: { el: HTMLElement; r: DOMRect } | undefined
  let distance = Infinity
  for (const el of scroller.value?.querySelectorAll<HTMLElement>('[data-k]') ?? []) {
    const r = el.getBoundingClientRect()
    const dist = Math.hypot(Math.max(r.left - d.x, 0, d.x - r.right), Math.max(r.top - d.y, 0, d.y - r.bottom))
    if (dist < distance) {
      distance = dist
      best = { el, r }
    }
  }
  if (!best) return
  const k = Number(best.el.dataset.k)
  const after = best.el.classList.contains('thumb') ? d.x > best.r.left + best.r.width / 2 : d.y > best.r.top + best.r.height / 2
  const slot = after ? k + 1 : k
  if (slot !== d.slot) {
    d.slot = slot
    navigator.vibrate?.(8)
  }
}

function autoScroll() {
  const d = drag.value
  const el = scroller.value
  if (!d || !el) return
  const r = el.getBoundingClientRect()
  const edge = 64
  const speed = d.y < r.top + edge ? -(r.top + edge - d.y) / 3 : d.y > r.bottom - edge && !d.overDelete ? (d.y - r.bottom + edge) / 3 : 0
  if (speed) {
    el.scrollTop += speed
    hitTest()
  }
  requestAnimationFrame(autoScroll)
}

function endDrag() {
  const d = drag.value!
  drag.value = undefined
  if (!d.overDelete && d.slot === d.from) return // put back where it was: nothing changes
  const items = d.items.slice()
  if (!d.overDelete) items.splice(d.slot, 0, d.block)
  blocks.value = fromItems(items)
  changed()
  if (!d.overDelete) flash([d.block.id])
}

// Long-press a photo (or press its grip, or drag with a mouse) to pick it up; a quick swipe still scrolls.
let cleanup = () => {}
function onPress(event: PointerEvent, block: PhotoBlock) {
  if ((event.target as HTMLElement).closest('.x') || drag.value) return
  cleanup()
  event.preventDefault()
  const pointer = event.pointerId
  const start = { x: event.clientX, y: event.clientY }
  const touch = event.pointerType !== 'mouse'
  let last = start
  const begin = () => { if (!drag.value) startDrag(block, last.x, last.y, touch) }
  const hold = (event.target as HTMLElement).closest('.grip') ? (begin(), 0) : window.setTimeout(begin, 250)
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return
    last = { x: e.clientX, y: e.clientY }
    const moved = Math.hypot(last.x - start.x, last.y - start.y)
    if (!drag.value && !touch && moved > 4) begin()
    if (!drag.value && touch && moved > 10) window.clearTimeout(hold)
    if (drag.value) {
      drag.value.x = last.x
      drag.value.y = last.y
      hitTest()
    }
  }
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return
    cleanup()
    if (drag.value) endDrag()
  }
  cleanup = () => {
    window.clearTimeout(hold)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    cleanup = () => {}
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
onUnmounted(() => cleanup())
</script>

<template>
  <div ref="scroller" class="editor" :class="{ arranging: drag }" @click.self="focusEnd">
    <template v-if="!drag">
      <template v-for="seg in segments" :key="seg.type === 'text' ? seg.block.id : `g${seg.key}`">
        <textarea v-if="seg.type === 'text'" :ref="grow" :data-id="seg.block.id" :value="seg.block.text" rows="1" :aria-label="t('edit.label')"
          :placeholder="seg.block === lastText && !seg.block.text ? t('editor.placeholder') : ''"
          @input="onInput(seg.block, $event)" @focus="remember(seg.block, $event)" @click="remember(seg.block, $event)" @keyup="remember(seg.block, $event)"></textarea>
        <div v-else class="group">
          <div v-for="p in seg.photos" :key="p.id" class="thumb" :class="{ landed: landed.has(p.id) }" @pointerdown="onPress($event, p)" @contextmenu.prevent>
            <MediaImage :photo="p.photo" />
            <span class="grip" :aria-label="t('editor.grip')"><AppIcon name="grip" :size="14" /></span>
            <button class="x" type="button" :aria-label="t('photo.remove')" @click="remove(p)"><AppIcon name="close" :size="12" /></button>
          </div>
        </div>
      </template>
    </template>
    <template v-else>
      <template v-for="seg in arranging" :key="seg.type === 'line' ? seg.line.id : seg.key">
        <div v-if="seg.type === 'line'" class="line" :class="{ para: seg.line.para }" :data-k="seg.k">{{ seg.line.text }}</div>
        <div v-else class="group">
          <template v-for="(entry, i) in seg.entries" :key="'slot' in entry ? 'slot' : entry.photo.id">
            <div v-if="'slot' in entry" class="slot"></div>
            <div v-else class="thumb" :data-k="entry.k"><MediaImage :photo="entry.photo.photo" /></div>
            <span v-if="i === seg.entries.length - 1 && seg.entries.length > 1" class="group-label">{{ t('editor.group', { n: seg.entries.length }) }}</span>
          </template>
        </div>
      </template>
    </template>
  </div>
  <div v-if="!drag" class="toolbar"><slot name="tools" /><span class="hint">{{ t('editor.hint') }}</span></div>
  <div v-else ref="zone" class="dropzone" :class="{ over: drag.overDelete }">
    <AppIcon name="trash" :size="20" /><span>{{ drag.overDelete ? t('editor.releaseRemove') : t('editor.dropRemove') }}</span>
  </div>
  <Teleport to="body">
    <div v-if="drag" class="ghost" :style="{ left: `${drag.x - 44}px`, top: `${drag.y - 44 - (drag.touch ? 56 : 0)}px` }">
      <MediaImage :photo="drag.block.photo" />
    </div>
  </Teleport>
</template>

<style scoped>
.editor { flex-grow: 1; overflow-y: auto; padding: 14px 16px 24px; display: flex; flex-direction: column; gap: 10px; }
.editor textarea { border: 0; outline: none; resize: none; background: transparent; font-size: 17px; line-height: 1.6; padding: 2px 0;
  min-height: 28px; overflow: hidden; field-sizing: content; }
.group { display: flex; flex-wrap: wrap; gap: 8px; }
.thumb { position: relative; width: 96px; height: 96px; border-radius: 10px; flex-shrink: 0; touch-action: none; user-select: none;
  -webkit-user-select: none; -webkit-touch-callout: none; cursor: grab; }
.thumb .media { width: 100%; height: 100%; border-radius: 10px; }
.thumb.landed { animation: landed .9s var(--ease); }
@keyframes landed { 0% { transform: scale(1.08); box-shadow: 0 0 0 3px var(--accent); } 100% { transform: none; box-shadow: 0 0 0 0 transparent; } }
.grip { position: absolute; left: 6px; bottom: 6px; width: 24px; height: 24px; border-radius: 7px; background: rgba(0, 0, 0, .42); color: #fff;
  display: flex; align-items: center; justify-content: center; }
.x { position: absolute; top: -7px; right: -7px; width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--ground);
  background: var(--ink); color: var(--ground); display: flex; align-items: center; justify-content: center; padding: 0; }
/* Arranging: an overview while a photo is held. */
.editor.arranging { gap: 6px; }
.line { font-size: 14px; line-height: 1.45; color: var(--muted); padding: 2px 4px; display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }
.line.para { margin-top: 6px; }
.arranging .group { padding: 6px; gap: 6px; border-radius: 12px; background: var(--chip); }
.arranging .thumb { width: 64px; height: 64px; cursor: grabbing; }
.group-label { flex-basis: 100%; font-size: 11px; color: var(--muted); }
.slot { width: 64px; height: 64px; border-radius: 10px; border: 2px dashed var(--accent); background: var(--accent-soft);
  animation: pulse 1s ease-in-out infinite alternate; }
@keyframes pulse { to { opacity: .55; } }
.ghost { position: fixed; z-index: 50; width: 88px; height: 88px; border-radius: 12px; overflow: hidden; pointer-events: none;
  transform: scale(1.04) rotate(-3deg); box-shadow: 0 14px 30px rgba(0, 0, 0, .35); }
.ghost .media { width: 100%; height: 100%; }
.toolbar { display: flex; align-items: center; gap: 2px; padding: 4px 8px; border-top: 1px solid var(--line); background: var(--surface); flex-shrink: 0; }
.toolbar .hint { margin: 0 4px 0 auto; font-size: 12px; color: var(--muted); }
.dropzone { display: flex; align-items: center; justify-content: center; gap: 8px; height: 53px; border-top: 1px solid var(--line);
  background: var(--surface); color: var(--danger); font-size: 14px; flex-shrink: 0; transition: background .15s, color .15s; }
.dropzone.over { background: var(--danger); color: var(--surface); }
</style>
