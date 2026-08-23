// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://francepassoire.com',
  // /ma-veille/ : page utilisateur à jeton, noindex — exclue du sitemap.
  integrations: [sitemap({ filter: (page) => !page.includes('/ma-veille') })],
  vite: {
    plugins: [tailwindcss()],
  },
});
