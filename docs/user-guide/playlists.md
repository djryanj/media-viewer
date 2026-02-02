# Playlists

Playlists allow you to create ordered collections of videos that play in sequence. Media Viewer reads playlist files from your media library and provides a dedicated player interface.

## Playlist Format

Playlists are plain text files with a `.playlist` extension. Each line contains the path to a video file, relative to the playlist file location.

### Example Playlist

Create a file named `my-playlist.playlist`:

```

video1.mp4
video2.mp4
subfolder/video3.mp4
../other-folder/video4.mp4

```

### Path Rules

- Paths are relative to the playlist file location
- Use forward slashes (`/`) for directory separators
- Lines starting with `#` are treated as comments
- Empty lines are ignored
- Videos that cannot be found are marked as unavailable

## Playing Playlists

### Opening a Playlist

Click any playlist item in the gallery to open the playlist player.

### Player Interface

The playlist player displays:

- **Video area**: The currently playing video
- **Playlist sidebar**: List of all videos in the playlist
- **Playback controls**: Previous, play/pause, next buttons

### Navigation

- Click any video in the sidebar to jump to it
- Use the previous/next buttons to navigate sequentially
- Videos auto-advance when playback completes

### Unavailable Videos

If a video in the playlist cannot be found:

- It appears grayed out with strikethrough text
- Clicking it has no effect
- Auto-advance skips unavailable videos

## Playlist Sidebar

### Desktop View

On desktop, the playlist sidebar is always visible alongside the video.

### Mobile/Landscape View

In landscape orientation on mobile:

- The sidebar is hidden by default
- Tap the playlist icon to show/hide the sidebar
- Swipe from the right edge to reveal the sidebar

### Video Information

Each playlist entry shows:

- Video filename
- Tags (if the video has tags)

## Creating Playlists

### Manual Creation

1. Create a new text file with the `.playlist` extension
2. Add video paths, one per line
3. Save the file in your media library
4. Refresh Media Viewer to see the playlist

### Tips for Playlists

- Keep playlist files in the same folder as the videos for simpler paths
- Use descriptive playlist names
- Add comments to document the playlist purpose:

```

# Summer vacation highlights

# Created: 2024-07-15

beach-day.mp4
hiking-trip.mp4
sunset-timelapse.mp4

```

## Playback Features

### Auto-Advance

Videos automatically advance to the next item when playback completes. The playlist loops back to the beginning after the last video.

### Video Controls

Standard video controls are available:

- Play/pause
- Seek bar
- Volume control
- Fullscreen toggle

### Keyboard Shortcuts

While the playlist player is open:

| Key        | Action         |
| ---------- | -------------- |
| ++space++  | Play/pause     |
| ++left++   | Previous video |
| ++right++  | Next video     |
| ++escape++ | Close player   |
