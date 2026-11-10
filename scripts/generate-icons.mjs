import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const iconsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

await sharp(path.join(iconsDir, 'icon.svg')).resize(512, 512).png().toFile(path.join(iconsDir, 'icon-512.png'));
await sharp(path.join(iconsDir, 'icon.svg')).resize(192, 192).png().toFile(path.join(iconsDir, 'icon-192.png'));
await sharp(path.join(iconsDir, 'maskable.svg')).resize(512, 512).png().toFile(path.join(iconsDir, 'maskable-512.png'));
await sharp(path.join(iconsDir, 'maskable.svg')).resize(180, 180).png().toFile(path.join(iconsDir, 'apple-touch-icon.png'));

console.log('PWA icons generated in public/icons/');