import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const sizes = [16, 32, 72, 96, 128, 144, 152, 167, 180, 192, 384, 512];
const iconDir = './icons';

// Main icon SVG - Diagonal split with film perforation edge
// Colorblind-friendly, vibrant palette
// Lock shifted to bottom-left, Film strip shifted to top-right
// Red accent on film/play side, amber keyhole on lock side
const mainIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <!-- Clip path for left/bottom half (below the diagonal) -->
    <clipPath id="leftHalf">
      <polygon points="0,0 0,512 512,512 0,0"/>
    </clipPath>

    <!-- Clip path for right/top half (above the diagonal) -->
    <clipPath id="rightHalf">
      <polygon points="0,0 512,0 512,512 0,0"/>
    </clipPath>

    <!-- Gradient for lock body - vibrant blue with depth -->
    <linearGradient id="lockBodyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="50%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>

    <!-- Gradient for lock shackle -->
    <linearGradient id="shackleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="40%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1e40af"/>
    </linearGradient>

    <!-- Gradient for film strip background -->
    <linearGradient id="filmGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#334155"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>

    <!-- Gradient for film frames area -->
    <linearGradient id="frameGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>

    <!-- Radial gradient for play button -->
    <radialGradient id="playGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="70%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </radialGradient>

    <!-- Radial gradient for keyhole glow (amber/gold) -->
    <radialGradient id="keyholeGlow" cx="50%" cy="30%" r="60%">
      <stop offset="0%" stop-color="#fbbf24"/>
      <stop offset="60%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#d97706"/>
    </radialGradient>

    <!-- Radial gradient for play button red glow -->
    <radialGradient id="playRedGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#e94560" stop-opacity="0.6"/>
      <stop offset="70%" stop-color="#e94560" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#e94560" stop-opacity="0"/>
    </radialGradient>

    <!-- Film strip diagonal gradient -->
    <linearGradient id="filmStripGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#374151"/>
      <stop offset="50%" stop-color="#1f2937"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>

    <!-- Shadow filter -->
    <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="4" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.5"/>
    </filter>

    <!-- Glow filter for play button -->
    <filter id="playButtonGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Background - richer dark blue -->
  <rect width="512" height="512" rx="64" fill="#0f172a"/>

  <!-- ==================== LEFT/BOTTOM HALF: LOCK ==================== -->
  <g clip-path="url(#leftHalf)">
    <!-- Background for lock side - distinct blue tone -->
    <rect width="512" height="512" fill="#1e3a5f"/>

    <!-- Subtle gradient overlay -->
    <rect width="512" height="512" fill="url(#lockBodyGradient)" opacity="0.1"/>

    <!-- Lock group - shifted toward bottom-left -->
    <g transform="translate(-50, 60)" filter="url(#dropShadow)">
      <!-- Lock shackle outer -->
      <path d="M176 220 L176 155 Q176 75 256 75 Q336 75 336 155 L336 220"
            fill="none" stroke="#1e40af" stroke-width="48" stroke-linecap="round"/>

      <!-- Lock shackle main with gradient -->
      <path d="M176 220 L176 155 Q176 75 256 75 Q336 75 336 155 L336 220"
            fill="none" stroke="url(#shackleGradient)" stroke-width="42" stroke-linecap="round"/>

      <!-- Shackle highlight/shine -->
      <path d="M188 212 L188 160 Q188 92 256 92 Q324 92 324 160 L324 212"
            fill="none" stroke="#93c5fd" stroke-width="6" stroke-linecap="round" opacity="0.7"/>

      <!-- Shackle inner dark -->
      <path d="M200 220 L200 163 Q200 105 256 105 Q312 105 312 163 L312 220"
            fill="none" stroke="#0f172a" stroke-width="18" stroke-linecap="round"/>

      <!-- Lock body outer border -->
      <rect x="132" y="218" width="248" height="206" rx="26" fill="#1e40af"/>

      <!-- Lock body with gradient -->
      <rect x="136" y="222" width="240" height="198" rx="24" fill="url(#lockBodyGradient)"/>

      <!-- Lock body top highlight -->
      <rect x="140" y="222" width="232" height="12" rx="6" fill="#60a5fa" opacity="0.5"/>

      <!-- Lock body inner area -->
      <rect x="158" y="250" width="196" height="146" rx="16" fill="#0f172a"/>

      <!-- Inner area subtle top shadow -->
      <rect x="158" y="250" width="196" height="24" rx="8" fill="#000000" opacity="0.3"/>

      <!-- Keyhole outer glow ring -->
      <circle cx="256" cy="320" r="52" fill="#d97706" opacity="0.3"/>

      <!-- Keyhole background -->
      <circle cx="256" cy="320" r="46" fill="#1e40af"/>
      <circle cx="256" cy="320" r="42" fill="url(#keyholeGlow)"/>

      <!-- Keyhole shape - original design: circle at top, rounded rectangle below -->
      <!-- Keyhole circle -->
      <circle cx="256" cy="305" r="16" fill="#0f172a"/>

      <!-- Keyhole rectangle/slot below circle -->
      <rect x="248" y="312" width="16" height="40" rx="4" fill="#0f172a"/>

      <!-- Keyhole inner highlight -->
      <circle cx="254" cy="303" r="6" fill="#1e293b" opacity="0.5"/>
    </g>
  </g>

  <!-- ==================== RIGHT/TOP HALF: FILM STRIP ==================== -->
  <g clip-path="url(#rightHalf)">
    <!-- Background for film side - slate tone -->
    <rect width="512" height="512" fill="#1e293b"/>

    <!-- Film strip group - shifted toward top-right -->
    <g transform="translate(40, -60)" filter="url(#dropShadow)">
      <!-- Film strip outer border -->
      <rect x="75" y="95" width="370" height="270" rx="10" fill="#0f172a"/>

      <!-- Film strip main background -->
      <rect x="80" y="100" width="360" height="260" rx="8" fill="url(#filmGradient)"/>

      <!-- Sprocket holes - top row -->
      <g>
        <!-- Hole shadows -->
        <g fill="#0f172a">
          <circle cx="115" cy="122" r="11"/>
          <circle cx="165" cy="122" r="11"/>
          <circle cx="215" cy="122" r="11"/>
          <circle cx="265" cy="122" r="11"/>
          <circle cx="315" cy="122" r="11"/>
          <circle cx="365" cy="122" r="11"/>
          <circle cx="415" cy="122" r="11"/>
        </g>
        <!-- Holes -->
        <g fill="#1e293b">
          <circle cx="115" cy="120" r="10"/>
          <circle cx="165" cy="120" r="10"/>
          <circle cx="215" cy="120" r="10"/>
          <circle cx="265" cy="120" r="10"/>
          <circle cx="315" cy="120" r="10"/>
          <circle cx="365" cy="120" r="10"/>
          <circle cx="415" cy="120" r="10"/>
        </g>
        <!-- Hole highlights -->
        <g fill="#334155" opacity="0.5">
          <circle cx="113" cy="118" r="4"/>
          <circle cx="163" cy="118" r="4"/>
          <circle cx="213" cy="118" r="4"/>
          <circle cx="263" cy="118" r="4"/>
          <circle cx="313" cy="118" r="4"/>
          <circle cx="363" cy="118" r="4"/>
          <circle cx="413" cy="118" r="4"/>
        </g>
      </g>

      <!-- Sprocket holes - bottom row -->
      <g>
        <!-- Hole shadows -->
        <g fill="#0f172a">
          <circle cx="115" cy="342" r="11"/>
          <circle cx="165" cy="342" r="11"/>
          <circle cx="215" cy="342" r="11"/>
          <circle cx="265" cy="342" r="11"/>
          <circle cx="315" cy="342" r="11"/>
          <circle cx="365" cy="342" r="11"/>
          <circle cx="415" cy="342" r="11"/>
        </g>
        <!-- Holes -->
        <g fill="#1e293b">
          <circle cx="115" cy="340" r="10"/>
          <circle cx="165" cy="340" r="10"/>
          <circle cx="215" cy="340" r="10"/>
          <circle cx="265" cy="340" r="10"/>
          <circle cx="315" cy="340" r="10"/>
          <circle cx="365" cy="340" r="10"/>
          <circle cx="415" cy="340" r="10"/>
        </g>
        <!-- Hole highlights -->
        <g fill="#334155" opacity="0.5">
          <circle cx="113" cy="338" r="4"/>
          <circle cx="163" cy="338" r="4"/>
          <circle cx="213" cy="338" r="4"/>
          <circle cx="263" cy="338" r="4"/>
          <circle cx="313" cy="338" r="4"/>
          <circle cx="363" cy="338" r="4"/>
          <circle cx="413" cy="338" r="4"/>
        </g>
      </g>

      <!-- Film frame area -->
      <rect x="80" y="138" width="360" height="184" fill="url(#frameGradient)"/>

      <!-- Film frames - vertical dividers -->
      <g>
        <rect x="173" y="138" width="4" height="184" fill="#0f172a"/>
        <rect x="175" y="138" width="1" height="184" fill="#475569" opacity="0.4"/>

        <rect x="278" y="138" width="4" height="184" fill="#0f172a"/>
        <rect x="280" y="138" width="1" height="184" fill="#475569" opacity="0.4"/>

        <rect x="383" y="138" width="4" height="184" fill="#0f172a"/>
        <rect x="385" y="138" width="1" height="184" fill="#475569" opacity="0.4"/>
      </g>

      <!-- Play button area - center frame with RED ACCENT -->
      <!-- Outer red glow -->
      <circle cx="280" cy="230" r="65" fill="url(#playRedGlow)"/>

      <!-- Red accent ring -->
      <circle cx="280" cy="230" r="52" fill="none" stroke="#e94560" stroke-width="3" opacity="0.8"/>

      <!-- Inner subtle red glow -->
      <circle cx="280" cy="230" r="48" fill="#e94560" opacity="0.1"/>

      <!-- Play button background -->
      <circle cx="280" cy="230" r="44" fill="#0f172a"/>
      <circle cx="280" cy="230" r="40" fill="#1e293b"/>

      <!-- Play button inner highlight -->
      <ellipse cx="280" cy="218" rx="28" ry="16" fill="#334155" opacity="0.5"/>

      <!-- Play triangle with gradient -->
      <path d="M266 202 L266 258 L308 230 Z" fill="url(#playGlow)" filter="url(#playButtonGlow)"/>

      <!-- Play triangle inner highlight -->
      <path d="M270 210 L270 250 L302 230 Z" fill="#f8fafc" opacity="0.8"/>
    </g>
  </g>

  <!-- ==================== DIAGONAL FILM PERFORATION STRIP ==================== -->
  <!-- Extended beyond corners to prevent triangle cutouts -->
  <g>
    <!-- Film strip shadow -->
    <path d="M-30,-10 L-10,-30 L542,502 L522,522 Z" fill="#000000" opacity="0.4"/>

    <!-- Main film strip - dark gray like real film -->
    <path d="M-20,0 L0,-20 L532,512 L512,532 Z" fill="url(#filmStripGradient)"/>

    <!-- Film strip top edge highlight -->
    <path d="M-20,0 L0,-20 L528,508 L524,512 L-4,4 Z" fill="#4b5563" opacity="0.6"/>

    <!-- Film strip bottom edge shadow -->
    <path d="M-16,4 L512,532 L532,512 L4,-16 Z" fill="#000000" opacity="0.3"/>

    <!-- Perforation holes along the diagonal -->
    <g>
      <!-- Hole shadows (offset) -->
      <g fill="#000000" opacity="0.5">
        <circle cx="18" cy="18" r="9"/>
        <circle cx="54" cy="54" r="9"/>
        <circle cx="90" cy="90" r="9"/>
        <circle cx="126" cy="126" r="9"/>
        <circle cx="162" cy="162" r="9"/>
        <circle cx="198" cy="198" r="9"/>
        <circle cx="234" cy="234" r="9"/>
        <circle cx="270" cy="270" r="9"/>
        <circle cx="306" cy="306" r="9"/>
        <circle cx="342" cy="342" r="9"/>
        <circle cx="378" cy="378" r="9"/>
        <circle cx="414" cy="414" r="9"/>
        <circle cx="450" cy="450" r="9"/>
        <circle cx="486" cy="486" r="9"/>
      </g>

      <!-- Main holes - show background through -->
      <g fill="#0f172a">
        <circle cx="16" cy="16" r="8"/>
        <circle cx="52" cy="52" r="8"/>
        <circle cx="88" cy="88" r="8"/>
        <circle cx="124" cy="124" r="8"/>
        <circle cx="160" cy="160" r="8"/>
        <circle cx="196" cy="196" r="8"/>
        <circle cx="232" cy="232" r="8"/>
        <circle cx="268" cy="268" r="8"/>
        <circle cx="304" cy="304" r="8"/>
        <circle cx="340" cy="340" r="8"/>
        <circle cx="376" cy="376" r="8"/>
        <circle cx="412" cy="412" r="8"/>
        <circle cx="448" cy="448" r="8"/>
        <circle cx="484" cy="484" r="8"/>
      </g>

      <!-- Hole inner highlights -->
      <g fill="#1e293b" opacity="0.6">
        <circle cx="14" cy="14" r="4"/>
        <circle cx="50" cy="50" r="4"/>
        <circle cx="86" cy="86" r="4"/>
        <circle cx="122" cy="122" r="4"/>
        <circle cx="158" cy="158" r="4"/>
        <circle cx="194" cy="194" r="4"/>
        <circle cx="230" cy="230" r="4"/>
        <circle cx="266" cy="266" r="4"/>
        <circle cx="302" cy="302" r="4"/>
        <circle cx="338" cy="338" r="4"/>
        <circle cx="374" cy="374" r="4"/>
        <circle cx="410" cy="410" r="4"/>
        <circle cx="446" cy="446" r="4"/>
        <circle cx="482" cy="482" r="4"/>
      </g>
    </g>
  </g>
</svg>
`;

// Maskable icon SVG (more padding for Android adaptive icons)
const maskableIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <clipPath id="leftHalfMask">
      <polygon points="0,0 0,512 512,512"/>
    </clipPath>
    <clipPath id="rightHalfMask">
      <polygon points="0,0 512,0 512,512"/>
    </clipPath>

    <linearGradient id="lockBodyGradientMask" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>

    <linearGradient id="shackleGradientMask" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#1e40af"/>
    </linearGradient>

    <linearGradient id="filmGradientMask" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#334155"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>

    <radialGradient id="playGlowMask" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </radialGradient>

    <radialGradient id="keyholeGlowMask" cx="50%" cy="30%" r="60%">
      <stop offset="0%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="#d97706"/>
    </radialGradient>

    <linearGradient id="filmStripGradientMask" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#374151"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="512" height="512" fill="#0f172a"/>

  <g transform="translate(51.2, 51.2) scale(0.8)">
    <!-- ==================== LEFT/BOTTOM HALF: LOCK ==================== -->
    <g clip-path="url(#leftHalfMask)">
      <rect x="-100" y="-100" width="712" height="712" fill="#1e3a5f"/>

      <g transform="translate(-50, 60)">
        <path d="M176 220 L176 155 Q176 75 256 75 Q336 75 336 155 L336 220"
              fill="none" stroke="url(#shackleGradientMask)" stroke-width="42" stroke-linecap="round"/>
        <path d="M188 212 L188 160 Q188 92 256 92 Q324 92 324 160 L324 212"
              fill="none" stroke="#93c5fd" stroke-width="6" stroke-linecap="round" opacity="0.7"/>
        <path d="M200 220 L200 163 Q200 105 256 105 Q312 105 312 163 L312 220"
              fill="none" stroke="#0f172a" stroke-width="18" stroke-linecap="round"/>

        <rect x="136" y="222" width="240" height="198" rx="24" fill="url(#lockBodyGradientMask)"/>
        <rect x="140" y="222" width="232" height="12" rx="6" fill="#60a5fa" opacity="0.5"/>
        <rect x="158" y="250" width="196" height="146" rx="16" fill="#0f172a"/>

        <circle cx="256" cy="320" r="42" fill="url(#keyholeGlowMask)"/>
        <circle cx="256" cy="305" r="16" fill="#0f172a"/>
        <rect x="248" y="312" width="16" height="40" rx="4" fill="#0f172a"/>
      </g>
    </g>

    <!-- ==================== RIGHT/TOP HALF: FILM STRIP ==================== -->
    <g clip-path="url(#rightHalfMask)">
      <rect x="-100" y="-100" width="712" height="712" fill="#1e293b"/>

      <g transform="translate(40, -60)">
        <rect x="80" y="100" width="360" height="260" rx="8" fill="url(#filmGradientMask)"/>

        <g fill="#1e293b">
          <circle cx="115" cy="120" r="10"/><circle cx="165" cy="120" r="10"/>
          <circle cx="215" cy="120" r="10"/><circle cx="265" cy="120" r="10"/>
          <circle cx="315" cy="120" r="10"/><circle cx="365" cy="120" r="10"/>
          <circle cx="415" cy="120" r="10"/>
          <circle cx="115" cy="340" r="10"/><circle cx="165" cy="340" r="10"/>
          <circle cx="215" cy="340" r="10"/><circle cx="265" cy="340" r="10"/>
          <circle cx="315" cy="340" r="10"/><circle cx="365" cy="340" r="10"/>
          <circle cx="415" cy="340" r="10"/>
        </g>

        <rect x="80" y="138" width="360" height="184" fill="#0f172a"/>
        <rect x="173" y="138" width="4" height="184" fill="#1e293b"/>
        <rect x="278" y="138" width="4" height="184" fill="#1e293b"/>
        <rect x="383" y="138" width="4" height="184" fill="#1e293b"/>

        <!-- Red accent ring around play button -->
        <circle cx="280" cy="230" r="52" fill="none" stroke="#e94560" stroke-width="3" opacity="0.8"/>
        <circle cx="280" cy="230" r="48" fill="#e94560" opacity="0.1"/>
        <circle cx="280" cy="230" r="40" fill="#1e293b"/>
        <path d="M266 202 L266 258 L308 230 Z" fill="url(#playGlowMask)"/>
      </g>
    </g>

    <!-- ==================== DIAGONAL FILM PERFORATION STRIP ==================== -->
    <path d="M-20,0 L0,-20 L532,512 L512,532 Z" fill="url(#filmStripGradientMask)"/>
    <path d="M-20,0 L0,-20 L528,508 L524,512 L-4,4 Z" fill="#4b5563" opacity="0.5"/>

    <g fill="#0f172a">
      <circle cx="16" cy="16" r="8"/><circle cx="52" cy="52" r="8"/>
      <circle cx="88" cy="88" r="8"/><circle cx="124" cy="124" r="8"/>
      <circle cx="160" cy="160" r="8"/><circle cx="196" cy="196" r="8"/>
      <circle cx="232" cy="232" r="8"/><circle cx="268" cy="268" r="8"/>
      <circle cx="304" cy="304" r="8"/><circle cx="340" cy="340" r="8"/>
      <circle cx="376" cy="376" r="8"/><circle cx="412" cy="412" r="8"/>
      <circle cx="448" cy="448" r="8"/><circle cx="484" cy="484" r="8"/>
    </g>
  </g>
</svg>
`;

// Simplified favicon SVG for small sizes
const faviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <clipPath id="leftHalfSmall">
      <polygon points="0,0 0,32 32,32"/>
    </clipPath>
    <clipPath id="rightHalfSmall">
      <polygon points="0,0 32,0 32,32"/>
    </clipPath>

    <linearGradient id="lockGradientSmall" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>

    <radialGradient id="keyholeGlowSmall" cx="50%" cy="30%" r="60%">
      <stop offset="0%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="#d97706"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="32" height="32" rx="4" fill="#0f172a"/>

  <!-- ==================== LEFT/BOTTOM HALF: SIMPLIFIED LOCK ==================== -->
  <g clip-path="url(#leftHalfSmall)">
    <rect width="32" height="32" fill="#1e3a5f"/>

    <g transform="translate(-3, 4)">
      <!-- Lock shackle -->
      <path d="M11 13 L11 9.5 Q11 5 16 5 Q21 5 21 9.5 L21 13"
            fill="none" stroke="#3b82f6" stroke-width="3" stroke-linecap="round"/>
      <path d="M12.5 12 L12.5 10 Q12.5 7 16 7 Q19.5 7 19.5 10 L19.5 12"
            fill="none" stroke="#60a5fa" stroke-width="1" stroke-linecap="round" opacity="0.7"/>

      <!-- Lock body -->
      <rect x="8" y="12" width="16" height="13" rx="2" fill="url(#lockGradientSmall)"/>
      <rect x="8" y="12" width="16" height="2" rx="1" fill="#60a5fa" opacity="0.5"/>
      <rect x="10" y="14.5" width="12" height="9" rx="1" fill="#0f172a"/>

      <!-- Keyhole with amber glow - original design -->
      <circle cx="16" cy="17.5" r="3" fill="url(#keyholeGlowSmall)"/>
      <circle cx="16" cy="16.5" r="1.2" fill="#0f172a"/>
      <rect x="15" y="17" width="2" height="4" rx="0.5" fill="#0f172a"/>
    </g>
  </g>

  <!-- ==================== RIGHT/TOP HALF: SIMPLIFIED FILM + PLAY ==================== -->
  <g clip-path="url(#rightHalfSmall)">
    <rect width="32" height="32" fill="#1e293b"/>

    <g transform="translate(2, -3)">
      <!-- Film strip background -->
      <rect x="4" y="8" width="24" height="16" rx="1" fill="#334155"/>

      <!-- Sprocket holes -->
      <g fill="#1e293b">
        <circle cx="8" cy="10" r="1.5"/>
        <circle cx="14" cy="10" r="1.5"/>
        <circle cx="20" cy="10" r="1.5"/>
        <circle cx="26" cy="10" r="1.5"/>
        <circle cx="8" cy="22" r="1.5"/>
        <circle cx="14" cy="22" r="1.5"/>
        <circle cx="20" cy="22" r="1.5"/>
        <circle cx="26" cy="22" r="1.5"/>
      </g>

      <!-- Film frame area -->
      <rect x="4" y="12" width="24" height="8" fill="#0f172a"/>

      <!-- Red accent ring around play -->
      <circle cx="16" cy="16" r="5" fill="none" stroke="#e94560" stroke-width="1" opacity="0.8"/>

      <!-- Play triangle -->
      <path d="M13 13 L13 19 L20 16 Z" fill="#f8fafc"/>
    </g>
  </g>

  <!-- ==================== DIAGONAL FILM STRIP ==================== -->
  <path d="M-2,0 L0,-2 L34,32 L32,34 Z" fill="#374151"/>
  <path d="M-2,0 L0,-2 L33,31 L32,32 Z" fill="#4b5563" opacity="0.5"/>

  <!-- Perforation holes -->
  <g fill="#0f172a">
    <circle cx="3" cy="3" r="1.5"/>
    <circle cx="9" cy="9" r="1.5"/>
    <circle cx="16" cy="16" r="1.5"/>
    <circle cx="23" cy="23" r="1.5"/>
    <circle cx="29" cy="29" r="1.5"/>
  </g>
</svg>
`;

// High-contrast version for accessibility
const highContrastIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <clipPath id="leftHalfHC">
      <polygon points="0,0 0,512 512,512"/>
    </clipPath>
    <clipPath id="rightHalfHC">
      <polygon points="0,0 512,0 512,512"/>
    </clipPath>

    <linearGradient id="lockGradientHC" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="512" height="512" rx="64" fill="#0a0f1a"/>

  <!-- ==================== LEFT/BOTTOM HALF: LOCK (HIGH CONTRAST) ==================== -->
  <g clip-path="url(#leftHalfHC)">
    <rect width="512" height="512" fill="#1e3a5f"/>

    <g transform="translate(-50, 60)">
      <!-- Lock shackle -->
      <path d="M176 220 L176 155 Q176 75 256 75 Q336 75 336 155 L336 220"
            fill="none" stroke="#0a0f1a" stroke-width="52" stroke-linecap="round"/>
      <path d="M176 220 L176 155 Q176 75 256 75 Q336 75 336 155 L336 220"
            fill="none" stroke="url(#lockGradientHC)" stroke-width="44" stroke-linecap="round"/>
      <path d="M186 214 L186 160 Q186 90 256 90 Q326 90 326 160 L326 214"
            fill="none" stroke="#93c5fd" stroke-width="8" stroke-linecap="round" opacity="0.8"/>
      <path d="M200 220 L200 163 Q200 105 256 105 Q312 105 312 163 L312 220"
            fill="none" stroke="#0a0f1a" stroke-width="20" stroke-linecap="round"/>

      <!-- Lock body -->
      <rect x="130" y="216" width="252" height="210" rx="28" fill="#0a0f1a"/>
      <rect x="136" y="222" width="240" height="198" rx="24" fill="url(#lockGradientHC)"/>
      <rect x="140" y="222" width="232" height="14" rx="7" fill="#93c5fd" opacity="0.6"/>
      <rect x="154" y="248" width="204" height="152" rx="18" fill="#0a0f1a"/>
      <rect x="158" y="252" width="196" height="144" rx="16" fill="#1e293b"/>

      <!-- Keyhole - high contrast with bright amber -->
      <circle cx="256" cy="320" r="54" fill="#0a0f1a"/>
      <circle cx="256" cy="320" r="48" fill="#fbbf24"/>
      <circle cx="256" cy="320" r="44" fill="#fcd34d"/>

      <!-- Keyhole shape - original design -->
      <circle cx="256" cy="305" r="18" fill="#0a0f1a"/>
      <rect x="246" y="312" width="20" height="45" rx="5" fill="#0a0f1a"/>
    </g>
  </g>

  <!-- ==================== RIGHT/TOP HALF: FILM STRIP (HIGH CONTRAST) ==================== -->
  <g clip-path="url(#rightHalfHC)">
    <rect width="512" height="512" fill="#1e293b"/>

    <g transform="translate(40, -60)">
      <!-- Film strip -->
      <rect x="74" y="94" width="372" height="272" rx="12" fill="#0a0f1a"/>
      <rect x="80" y="100" width="360" height="260" rx="8" fill="#475569"/>

      <!-- Sprocket holes with high contrast borders -->
      <g>
        <g fill="#0a0f1a">
          <circle cx="115" cy="120" r="13"/>
          <circle cx="165" cy="120" r="13"/>
          <circle cx="215" cy="120" r="13"/>
          <circle cx="265" cy="120" r="13"/>
          <circle cx="315" cy="120" r="13"/>
          <circle cx="365" cy="120" r="13"/>
          <circle cx="415" cy="120" r="13"/>
        </g>
        <g fill="#1e293b">
          <circle cx="115" cy="120" r="10"/>
          <circle cx="165" cy="120" r="10"/>
          <circle cx="215" cy="120" r="10"/>
          <circle cx="265" cy="120" r="10"/>
          <circle cx="315" cy="120" r="10"/>
          <circle cx="365" cy="120" r="10"/>
          <circle cx="415" cy="120" r="10"/>
        </g>

        <g fill="#0a0f1a">
          <circle cx="115" cy="340" r="13"/>
          <circle cx="165" cy="340" r="13"/>
          <circle cx="215" cy="340" r="13"/>
          <circle cx="265" cy="340" r="13"/>
          <circle cx="315" cy="340" r="13"/>
          <circle cx="365" cy="340" r="13"/>
          <circle cx="415" cy="340" r="13"/>
        </g>
        <g fill="#1e293b">
          <circle cx="115" cy="340" r="10"/>
          <circle cx="165" cy="340" r="10"/>
          <circle cx="215" cy="340" r="10"/>
          <circle cx="265" cy="340" r="10"/>
          <circle cx="315" cy="340" r="10"/>
          <circle cx="365" cy="340" r="10"/>
          <circle cx="415" cy="340" r="10"/>
        </g>
      </g>

      <!-- Film frame area -->
      <rect x="80" y="138" width="360" height="184" fill="#0f172a"/>

      <!-- Film frame dividers -->
      <rect x="173" y="138" width="6" height="184" fill="#475569"/>
      <rect x="278" y="138" width="6" height="184" fill="#475569"/>
      <rect x="383" y="138" width="6" height="184" fill="#475569"/>

      <!-- Play button - high contrast with red accent -->
      <circle cx="280" cy="230" r="58" fill="#e94560" opacity="0.3"/>
      <circle cx="280" cy="230" r="54" fill="none" stroke="#e94560" stroke-width="4"/>
      <circle cx="280" cy="230" r="48" fill="#0a0f1a"/>
      <circle cx="280" cy="230" r="44" fill="#f8fafc"/>
      <circle cx="280" cy="230" r="40" fill="#ffffff"/>

      <!-- Play triangle - dark on light for contrast -->
      <path d="M262 198 L262 262 L312 230 Z" fill="#0a0f1a"/>
    </g>
  </g>

  <!-- ==================== DIAGONAL FILM PERFORATION STRIP (HIGH CONTRAST) ==================== -->
  <!-- Extended film strip -->
  <path d="M-24,-4 L-4,-24 L536,516 L516,536 Z" fill="#0a0f1a"/>
  <path d="M-20,0 L0,-20 L532,512 L512,532 Z" fill="#4b5563"/>
  <path d="M-20,0 L0,-20 L528,508 L524,512 L-4,4 Z" fill="#6b7280" opacity="0.7"/>

  <!-- Perforation holes with borders -->
  <g>
    <g fill="#0a0f1a">
      <circle cx="16" cy="16" r="11"/>
      <circle cx="52" cy="52" r="11"/>
      <circle cx="88" cy="88" r="11"/>
      <circle cx="124" cy="124" r="11"/>
      <circle cx="160" cy="160" r="11"/>
      <circle cx="196" cy="196" r="11"/>
      <circle cx="232" cy="232" r="11"/>
      <circle cx="268" cy="268" r="11"/>
      <circle cx="304" cy="304" r="11"/>
      <circle cx="340" cy="340" r="11"/>
      <circle cx="376" cy="376" r="11"/>
      <circle cx="412" cy="412" r="11"/>
      <circle cx="448" cy="448" r="11"/>
      <circle cx="484" cy="484" r="11"/>
    </g>
    <g fill="#1e293b">
      <circle cx="16" cy="16" r="8"/>
      <circle cx="52" cy="52" r="8"/>
      <circle cx="88" cy="88" r="8"/>
      <circle cx="124" cy="124" r="8"/>
      <circle cx="160" cy="160" r="8"/>
      <circle cx="196" cy="196" r="8"/>
      <circle cx="232" cy="232" r="8"/>
      <circle cx="268" cy="268" r="8"/>
      <circle cx="304" cy="304" r="8"/>
      <circle cx="340" cy="340" r="8"/>
      <circle cx="376" cy="376" r="8"/>
      <circle cx="412" cy="412" r="8"/>
      <circle cx="448" cy="448" r="8"/>
      <circle cx="484" cy="484" r="8"/>
    </g>
  </g>
</svg>
`;

// Ensure icons directory exists
if (!existsSync(iconDir)) {
    mkdirSync(iconDir, { recursive: true });
}

async function generateIcons() {
    console.log('Generating Private Media Viewer icons...\n');
    console.log('Features:');
    console.log('  • Colorblind-friendly vibrant palette');
    console.log('  • Film-accurate dark gray diagonal strip');
    console.log('  • Original keyhole design (circle + rounded rectangle)');
    console.log('  • Red accent ring on play button');
    console.log('  • Amber/gold keyhole accent');
    console.log('  • Lock shifted to bottom-left');
    console.log('  • Film strip shifted to top-right');
    console.log('  • Enhanced depth and dimension\n');

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

    // Generate favicon.ico in root directory with multiple sizes
    const faviconSizes = [16, 32, 48];
    const faviconBuffers = await Promise.all(
        faviconSizes.map((size) =>
            sharp(Buffer.from(faviconSvg)).resize(size, size).png().toBuffer()
        )
    );

    // Create ICO file
    const icoBuffer = createIcoBuffer(faviconBuffers, faviconSizes);
    writeFileSync('./favicon.ico', icoBuffer);
    console.log(`✓ favicon.ico (root directory)`);

    // Save SVG source files
    writeFileSync(join(iconDir, 'icon.svg'), mainIconSvg.trim());
    writeFileSync(join(iconDir, 'icon-maskable.svg'), maskableIconSvg.trim());
    writeFileSync(join(iconDir, 'favicon.svg'), faviconSvg.trim());
    writeFileSync(join(iconDir, 'icon-high-contrast.svg'), highContrastIconSvg.trim());
    console.log(`\n✓ SVG source files saved`);

    console.log('\n✅ All icons generated!');
    console.log(`   📁 ${iconDir}/`);
    console.log(`   📄 ./favicon.ico`);
}

/**
 * Creates an ICO file buffer from multiple PNG buffers
 * ICO format: https://en.wikipedia.org/wiki/ICO_(file_format)
 */
function createIcoBuffer(pngBuffers, sizes) {
    const numImages = pngBuffers.length;

    // ICO Header: 6 bytes
    const headerSize = 6;

    // Directory entries: 16 bytes each
    const directoryEntrySize = 16;
    const directorySize = directoryEntrySize * numImages;

    // Calculate total size and offsets
    let currentOffset = headerSize + directorySize;
    const offsets = [];

    for (const buffer of pngBuffers) {
        offsets.push(currentOffset);
        currentOffset += buffer.length;
    }

    const totalSize = currentOffset;
    const icoBuffer = Buffer.alloc(totalSize);

    // Write ICO header
    icoBuffer.writeUInt16LE(0, 0); // Reserved
    icoBuffer.writeUInt16LE(1, 2); // Type: 1 = ICO
    icoBuffer.writeUInt16LE(numImages, 4); // Number of images

    // Write directory entries
    for (let i = 0; i < numImages; i++) {
        const entryOffset = headerSize + i * directoryEntrySize;
        const size = sizes[i];
        const pngBuffer = pngBuffers[i];

        icoBuffer.writeUInt8(size < 256 ? size : 0, entryOffset); // Width
        icoBuffer.writeUInt8(size < 256 ? size : 0, entryOffset + 1); // Height
        icoBuffer.writeUInt8(0, entryOffset + 2); // Color palette
        icoBuffer.writeUInt8(0, entryOffset + 3); // Reserved
        icoBuffer.writeUInt16LE(1, entryOffset + 4); // Color planes
        icoBuffer.writeUInt16LE(32, entryOffset + 6); // Bits per pixel
        icoBuffer.writeUInt32LE(pngBuffer.length, entryOffset + 8); // Image size
        icoBuffer.writeUInt32LE(offsets[i], entryOffset + 12); // Image offset
    }

    // Write image data
    for (let i = 0; i < numImages; i++) {
        pngBuffers[i].copy(icoBuffer, offsets[i]);
    }

    return icoBuffer;
}

generateIcons().catch(console.error);
