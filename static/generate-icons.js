import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const sizes = [16, 32, 72, 96, 128, 144, 152, 167, 180, 192, 384, 512];
const iconDir = './icons';

// Main lock icon SVG - Colorblind accessible version
// Uses high luminance contrast + outline for play button visibility
const mainIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Background -->
  <rect width="512" height="512" rx="64" fill="#1a1a2e"/>

  <!-- Lock shackle -->
  <path d="M160 200 L160 160 Q160 80 256 80 Q352 80 352 160 L352 200"
        fill="none" stroke="#0f3460" stroke-width="40" stroke-linecap="round"/>

  <!-- Lock body outer -->
  <rect x="120" y="200" width="272" height="220" rx="24" fill="#0f3460"/>

  <!-- Lock body inner -->
  <rect x="150" y="230" width="212" height="160" rx="12" fill="#16213e"/>

  <!-- Play button background circle - light ring for contrast -->
  <circle cx="256" cy="300" r="50" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="3"/>
  <circle cx="256" cy="300" r="42" fill="#0f3460"/>

  <!-- Play button - high contrast with outline -->
  <path d="M242 275 L242 325 L282 300 Z" fill="#f5f5f5" stroke="#1a1a2e" stroke-width="2"/>

  <!-- Accent glow/ring around play button for additional visibility -->
  <circle cx="256" cy="300" r="38" fill="none" stroke="#e94560" stroke-width="2" opacity="0.8"/>
</svg>
`;

// Maskable icon SVG (more padding for Android adaptive icons)
const maskableIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1a1a2e"/>
  <g transform="translate(51.2, 51.2) scale(0.8)">
    <!-- Lock shackle -->
    <path d="M160 200 L160 160 Q160 80 256 80 Q352 80 352 160 L352 200"
          fill="none" stroke="#0f3460" stroke-width="40" stroke-linecap="round"/>

    <!-- Lock body outer -->
    <rect x="120" y="200" width="272" height="220" rx="24" fill="#0f3460"/>

    <!-- Lock body inner -->
    <rect x="150" y="230" width="212" height="160" rx="12" fill="#16213e"/>

    <!-- Play button background circle - light ring for contrast -->
    <circle cx="256" cy="300" r="50" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="3"/>
    <circle cx="256" cy="300" r="42" fill="#0f3460"/>

    <!-- Play button - high contrast with outline -->
    <path d="M242 275 L242 325 L282 300 Z" fill="#f5f5f5" stroke="#1a1a2e" stroke-width="2"/>

    <!-- Accent glow/ring around play button -->
    <circle cx="256" cy="300" r="38" fill="none" stroke="#e94560" stroke-width="2" opacity="0.8"/>
  </g>
</svg>
`;

// Simplified favicon SVG for small sizes - optimized for visibility at tiny sizes
const faviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <!-- Background -->
  <rect width="32" height="32" rx="4" fill="#1a1a2e"/>

  <!-- Lock shackle -->
  <path d="M10 14 L10 10 Q10 4 16 4 Q22 4 22 10 L22 14"
        fill="none" stroke="#0f3460" stroke-width="3" stroke-linecap="round"/>

  <!-- Lock body -->
  <rect x="7" y="13" width="18" height="14" rx="3" fill="#0f3460"/>
  <rect x="9" y="15" width="14" height="10" rx="2" fill="#16213e"/>

  <!-- Play button - white/light for maximum contrast at small sizes -->
  <path d="M13 17 L13 23 L19 20 Z" fill="#f5f5f5"/>
</svg>
`;

// Alternative high-contrast version for users who need maximum visibility
const highContrastIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Background -->
  <rect width="512" height="512" rx="64" fill="#1a1a2e"/>

  <!-- Lock shackle with subtle highlight -->
  <path d="M160 200 L160 160 Q160 80 256 80 Q352 80 352 160 L352 200"
        fill="none" stroke="#1a3a5c" stroke-width="44" stroke-linecap="round"/>
  <path d="M160 200 L160 160 Q160 80 256 80 Q352 80 352 160 L352 200"
        fill="none" stroke="#0f3460" stroke-width="40" stroke-linecap="round"/>

  <!-- Lock body with border -->
  <rect x="118" y="198" width="276" height="224" rx="26" fill="#0a2540" opacity="0.5"/>
  <rect x="120" y="200" width="272" height="220" rx="24" fill="#0f3460"/>

  <!-- Lock body inner with border -->
  <rect x="148" y="228" width="216" height="164" rx="14" fill="#0a1628"/>
  <rect x="150" y="230" width="212" height="160" rx="12" fill="#16213e"/>

  <!-- Play button area - high contrast circle -->
  <circle cx="256" cy="300" r="55" fill="#0a1628"/>
  <circle cx="256" cy="300" r="50" fill="#f5f5f5"/>

  <!-- Play triangle - dark on light for maximum contrast -->
  <path d="M240 270 L240 330 L290 300 Z" fill="#1a1a2e"/>

  <!-- Accent ring - visible but not relied upon -->
  <circle cx="256" cy="300" r="58" fill="none" stroke="#e94560" stroke-width="3"/>
</svg>
`;

// Ensure icons directory exists
if (!existsSync(iconDir)) {
    mkdirSync(iconDir, { recursive: true });
}

async function generateIcons() {
    console.log('Generating colorblind-accessible lock icons...\n');

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

    // Generate high-contrast version
    const highContrastPath = join(iconDir, `icon-high-contrast-512x512.png`);
    await sharp(Buffer.from(highContrastIconSvg)).resize(512, 512).png().toFile(highContrastPath);
    console.log(`✓ icon-high-contrast-512x512.png`);

    // Save SVG source files
    writeFileSync(join(iconDir, 'icon.svg'), mainIconSvg.trim());
    writeFileSync(join(iconDir, 'icon-maskable.svg'), maskableIconSvg.trim());
    writeFileSync(join(iconDir, 'favicon.svg'), faviconSvg.trim());
    writeFileSync(join(iconDir, 'icon-high-contrast.svg'), highContrastIconSvg.trim());
    console.log(`\n✓ SVG source files saved`);

    console.log('\n✅ All icons generated in ./' + iconDir);
}

generateIcons().catch(console.error);
