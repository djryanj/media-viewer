# Browsing Media

Media Viewer provides an intuitive interface for navigating and viewing your media library.

## Gallery View

The gallery displays your media in a responsive grid layout. The number of columns adjusts based on your screen size.

### Item Types

Items in the gallery are indicated by visual cues:

| Type     | Indicator                              |
| -------- | -------------------------------------- |
| Folder   | Folder icon or folder thumbnail        |
| Image    | Image thumbnail                        |
| Video    | Image thumbnail with play icon overlay |
| Playlist | List icon                              |

### Item Information

On desktop, each item displays:

- Thumbnail or icon
- File name
- Type badge (folder, image, video, playlist)
- File size (for files) or item count (for folders)
- Tags (up to 3 visible, with +N indicator for more)

On mobile, items show a compact view with the name overlaid on the thumbnail.

## Navigation

### Opening Items

- **Folders**: Click to enter the folder
- **Images**: Click to open in lightbox
- **Videos**: Click to open in lightbox
- **Playlists**: Click to open in playlist player

### Folder Navigation

Use these methods to navigate between folders:

- **Click folders** in the gallery to enter them
- **Click breadcrumb segments** to jump to parent folders
- **Press** ++escape++ to go to the parent folder (when no overlay is open)
- **Use browser back/forward** buttons

### Sorting

Control the display order using the sort controls:

**Sort Fields:**

- **Name**: Alphabetical order
- **Date**: By modification date
- **Size**: By file size
- **Type**: Grouped by file type

**Sort Order:**

Click the arrow icon to toggle between ascending and descending order.

### Filtering

Use the filter dropdown to show specific media types:

- **All**: Show all items
- **Images**: Show only images
- **Videos**: Show only videos
- **Playlists**: Show only playlists

## Lightbox

The lightbox provides a full-screen viewing experience for images and videos.

### Opening the Lightbox

Click any image or video thumbnail to open it in the lightbox.

### Lightbox Controls

| Control           | Action                         |
| ----------------- | ------------------------------ |
| Left/Right arrows | Navigate to previous/next item |
| Close button (X)  | Close lightbox                 |
| Star icon         | Toggle favorite                |
| Tag icon          | Open tag manager               |
| Play icon         | Toggle autoplay (images)       |
| Loop icon         | Toggle video loop              |

### Navigation in Lightbox

- **Keyboard**: Use ++left++ and ++right++ arrow keys
- **Mouse**: Click the left/right edges of the screen
- **Touch**: Swipe left or right

### Closing the Lightbox

- Press ++escape++
- Click the X button
- Click outside the media

## Infinite Scroll

The gallery uses infinite scroll to load content as you browse. As you scroll down, additional items load automatically. A loading indicator appears while new items are being fetched.

If infinite scroll is unavailable, pagination controls appear at the bottom of the gallery.

## Mobile Considerations

### Touch Gestures

- **Tap**: Open item
- **Double-tap**: Toggle favorite
- **Long-press**: Enter selection mode
- **Swipe** (in lightbox): Navigate between items

### Landscape Mode

When viewing videos in landscape orientation, the interface adapts to maximize the viewing area. Controls appear on tap and auto-hide after a few seconds.

### Installing as PWA

For the best mobile experience, install Media Viewer as a Progressive Web App:

1. Open Media Viewer in Safari (iOS) or Chrome (Android)
2. Tap the share button (iOS) or menu button (Android)
3. Select "Add to Home Screen"
4. Launch from your home screen

The PWA provides:

- Full-screen experience without browser chrome
- Faster loading
- Offline access to cached thumbnails
