import { reactive, ref } from 'vue'
import { takenAt, type PhotoRef } from './media/content'
import { addPhotos, type PhotoSource } from './media/photos'
import { t } from './i18n'

// The entry being written: the composer on the main screen and the layout editor share it.
export const draft = reactive({
  text: '',
  photos: [] as PhotoRef[],
  time: null as number | null, // when it happened, if not now
})

export function clearDraft(): void {
  draft.text = ''
  draft.photos = []
  draft.time = null
}

// Photos taken longer ago than this suggest filling in the day: offer their capture times.
export const OLD_PHOTO_MS = 30 * 60_000

export function isOld(photo: PhotoRef, now = Date.now()): boolean {
  const taken = takenAt(photo)
  return taken !== null && taken < now - OLD_PHOTO_MS
}

// Open overlays (rendered by App.vue): the time step lists these photos' capture times.
export const timeStep = ref<PhotoRef[] | null>(null)
// Shared photos for the layout editor when it is open (it owns the draft then).
export const incoming = ref<PhotoRef[]>([])
export const timePicker = ref(false)
export const notice = ref('')

let noticeTimer: number | undefined
export function showNotice(message: string): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => { notice.value = '' }, 3000)
}

// Imports photos; failures become a notice. Resolves to the photos added (possibly none).
export async function importPhotos(source: PhotoSource): Promise<PhotoRef[]> {
  try {
    return await addPhotos(source)
  } catch (error) {
    showNotice(t('photo.failed', { error: error instanceof Error ? error.message : String(error) }))
    return []
  }
}

// After photos from the gallery arrive: if some are not from just now, ask when the entry happened.
export function offerPhotoTimes(photos: PhotoRef[]): void {
  if (draft.time === null && photos.some((p) => isOld(p))) timeStep.value = photos
}

// The time chip and the clock button: the photos' times when there are older photos, else the picker.
export function chooseTime(photos: PhotoRef[]): void {
  if (photos.some((p) => isOld(p))) timeStep.value = photos
  else timePicker.value = true
}
