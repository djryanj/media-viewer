# Progressive Web App

Media Viewer can be installed as a Progressive Web App (PWA) on supported devices, providing a native app-like experience.

## Benefits

Installing Media Viewer as a PWA provides:

- **Full-screen experience**: No browser chrome or address bar
- **Home screen icon**: Launch directly from your device
- **Faster loading**: Cached resources load quickly
- **Offline thumbnails**: Previously viewed thumbnails remain available

## Installation

### iOS (Safari)

1. Open Media Viewer in Safari
2. Tap the **Share** button (square with arrow)
3. Scroll down and tap **Add to Home Screen**
4. Optionally edit the name
5. Tap **Add**

### Android (Chrome)

1. Open Media Viewer in Chrome
2. Tap the **menu** button (three dots)
3. Tap **Add to Home Screen** or **Install App**
4. Confirm the installation

### Desktop (Chrome/Edge)

1. Open Media Viewer in Chrome or Edge
2. Click the **install** icon in the address bar (or menu)
3. Click **Install**

## Using the PWA

### Launching

Tap the Media Viewer icon on your home screen or app drawer. The app opens in full-screen mode without browser controls.

### Navigation

- Use in-app navigation (breadcrumbs, back gestures)
- The browser back button is not available in PWA mode
- Press ++escape++ to navigate up or close overlays

### Session Management

The PWA maintains your session like the browser version:

- Sessions expire based on server configuration
- You'll need to log in again after session expiration
- Active use keeps the session alive

## Limitations

### No Browser Controls

In PWA mode, you don't have access to:

- Browser back/forward buttons (use in-app navigation)
- Address bar (use search instead)
- Browser bookmarks (use favorites instead)

### Offline Access

The PWA caches:

- Application code and styles
- Previously viewed thumbnails

The PWA does not cache:

- Full-resolution images and videos
- New content not yet viewed

An internet connection is required to:

- Log in
- Browse new content
- View full-resolution media
- Make changes (tags, favorites)

## Troubleshooting

### PWA Not Installing

- Ensure you're using HTTPS (required for PWA)
- Try clearing browser cache
- Check that the browser supports PWA installation

### Session Issues

If you're frequently logged out:

- Check your network connection
- The server may have a short session duration
- Contact your administrator to adjust `SESSION_DURATION`

### Clearing PWA Data

To reset the PWA:

1. Uninstall the PWA from your device
2. Clear browser data for the Media Viewer site
3. Reinstall the PWA
