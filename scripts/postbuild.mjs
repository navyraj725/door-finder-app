import { copyFileSync, writeFileSync } from 'node:fs';

// GitHub Pages serves 404.html for unknown paths — shipping the SPA shell
// there lets client-side routes and OAuth returns resolve on hard refresh.
copyFileSync(new URL('../dist/index.html', import.meta.url), new URL('../dist/404.html', import.meta.url));
writeFileSync(new URL('../dist/.nojekyll', import.meta.url), '');