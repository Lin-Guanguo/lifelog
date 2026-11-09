import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // The one version number: package.json (also read by android/app/build.gradle and the release workflow).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})
