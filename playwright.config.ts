import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
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
      command: 'pnpm exec vite --port 5199 --strictPort',
      url: 'http://localhost:5199',
      reuseExistingServer: false,
    },
    {
      command: 'node test-support/webdav-server.ts 5300',
      port: 5300,
      reuseExistingServer: false,
    },
  ],
})
