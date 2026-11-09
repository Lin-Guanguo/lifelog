import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Screenshots every screen into docs/design/ui.html (see e2e/gallery.spec.ts).
export default defineConfig({ ...base, testIgnore: undefined, testMatch: 'gallery.spec.ts' })
