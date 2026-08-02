import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://wateaminbox.com',
  vite: {
    plugins: [tailwindcss()],
  },
  server: {
    port: 4446,
  },
});
