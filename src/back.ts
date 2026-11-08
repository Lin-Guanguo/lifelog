import { onMounted, onUnmounted } from 'vue'

// Android back closes the most recently opened layer (dialog, sheet, screen, selection).
const handlers: (() => void)[] = []

export function pushBackHandler(handler: () => void): () => void {
  handlers.push(handler)
  return () => {
    const i = handlers.lastIndexOf(handler)
    if (i >= 0) handlers.splice(i, 1)
  }
}

export function useBackHandler(handler: () => void): void {
  let remove = () => {}
  onMounted(() => { remove = pushBackHandler(handler) })
  onUnmounted(() => remove())
}

export function handleBack(): boolean {
  const handler = handlers[handlers.length - 1]
  handler?.()
  return handler !== undefined
}
