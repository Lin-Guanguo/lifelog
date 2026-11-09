import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testIgnore: 'gallery.spec.ts', // pnpm gallery
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://localhost:5199',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    // Lets a locally cached Chromium be used instead of downloading the pinned one.
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined },
  },
  webServer: [
    {
      // The production bundle, as shipped in the APK.
      command: 'pnpm build && pnpm exec vite preview --port 5199 --strictPort',
      url: 'http://localhost:5199',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'node test-support/webdav-server.ts 5300',
      port: 5300,
      reuseExistingServer: false,
    },
  ],
})
