import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const sizes = [16, 32, 72, 96, 128, 144, 152, 167, 180, 192, 384, 512];
const iconDir = './icons';

// Main lock icon SVG
const mainIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="64" fill="#1a1a2e"/>
  <path d="M160 200 L160 160 Q160 80 256 80 Q352 80 352 160 L352 200"
        fill="none" stroke="#0f3460" stroke-width="40" stroke-linecap="round"/>
  <rect x="120" y="200" width="272" height="220" rx="24" fill="#0f3460"/>
  <rect x="150" y="230" width="212" height="160" rx="12" fill="#16213e"/>
  <circle cx="256" cy="290" r="35" fill="#0f3460"/>
  <path d="M244 270 L244 310 L278 290 Z" fill="#e94560"/>
  <rect x="248" y="310" width="16" height="50" rx="4" fill="#0f3460"/>
</svg>
`;

// Maskable icon SVG (more padding for Android adaptive icons)
const maskableIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1a1a2e"/>
  <g transform="translate(51.2, 51.2) scale(0.8)">
    <path d="M160 200 L160 160 Q160 80 256 80 Q352 80 352 160 L352 200"
          fill="none" stroke="#0f3460" stroke-width="40" stroke-linecap="round"/>
    <rect x="120" y="200" width="272" height="220" rx="24" fill="#0f3460"/>
    <rect x="150" y="230" width="212" height="160" rx="12" fill="#16213e"/>
    <circle cx="256" cy="290" r="35" fill="#0f3460"/>
    <path d="M244 270 L244 310 L278 290 Z" fill="#e94560"/>
    <rect x="248" y="310" width="16" height="50" rx="4" fill="#0f3460"/>
  </g>
</svg>
`;

// Simplified favicon SVG for small sizes
const faviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="4" fill="#1a1a2e"/>
  <path d="M10 14 L10 10 Q10 4 16 4 Q22 4 22 10 L22 14"
        fill="none" stroke="#0f3460" stroke-width="3" stroke-linecap="round"/>
  <rect x="7" y="13" width="18" height="14" rx="3" fill="#0f3460"/>
  <rect x="9" y="15" width="14" height="10" rx="2" fill="#16213e"/>
  <path d="M14 18 L14 24 L20 21 Z" fill="#e94560"/>
</svg>
`;

// Ensure icons directory exists
if (!existsSync(iconDir)) {
    mkdirSync(iconDir, { recursive: true });
}

async function generateIcons() {
    console.log('Generating lock icons...\n');

    // Generate regular icons
    for (const size of sizes) {
        const outputPath = join(iconDir, `icon-${size}x${size}.png`);

        // Use simplified favicon for very small sizes
        const svg = size <= 48 ? faviconSvg : mainIconSvg;

        await sharp(Buffer.from(svg)).resize(size, size).png().toFile(outputPath);
        console.log(`✓ icon-${size}x${size}.png`);
    }

    // Generate maskable icons for Android
    for (const size of [192, 512]) {
        const outputPath = join(iconDir, `icon-maskable-${size}x${size}.png`);
        await sharp(Buffer.from(maskableIconSvg)).resize(size, size).png().toFile(outputPath);
        console.log(`✓ icon-maskable-${size}x${size}.png`);
    }

    // Save SVG source files
    writeFileSync(join(iconDir, 'icon.svg'), mainIconSvg.trim());
    writeFileSync(join(iconDir, 'icon-maskable.svg'), maskableIconSvg.trim());
    writeFileSync(join(iconDir, 'favicon.svg'), faviconSvg.trim());
    console.log(`\n✓ SVG source files saved`);

    console.log('\n✅ All icons generated in ./' + iconDir);
}

generateIcons().catch(console.error);
