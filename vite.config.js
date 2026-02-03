import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  server: {
    host: '0.0.0.0',
    port: 5177,
    strictPort: true,
    hmr: {
      host: '192.168.1.51',
      port: 5177
    }
  },
})
