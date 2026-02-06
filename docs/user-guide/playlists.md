# Playlists

Media Viewer can read and play Windows Media Player (.wpl) playlist files from your media library. These playlists provide an ordered collection of videos that play in sequence.

## Playlist Format

Media Viewer supports **Windows Media Player (.wpl) format** only. These are XML-based playlist files typically created by Windows Media Player or other compatible software.

### WPL File Structure

WPL files are XML documents with this basic structure:

```xml
<?xml version="1.0"?>
<smil>
  <head>
    <title>My Playlist</title>
  </head>
  <body>
    <seq>
      <media src="video1.mp4" />
      <media src="video2.mp4" />
      <media src="subfolder\video3.mp4" />
    </seq>
  </body>
</smil>
```

### Path Resolution

Media Viewer uses intelligent path resolution to locate videos:

- Handles Windows-style paths (backslashes and drive letters)
- Handles UNC network paths
- Resolves relative paths from the playlist location
- Falls back to filename matching if direct paths fail

This allows playlists created on different systems or with different directory structures to work as long as the video files exist in your media directory.

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

Media Viewer does not have a built-in playlist creation feature. To create playlists:

### Using Windows Media Player

1. Open Windows Media Player
2. Add videos to your library
3. Create a new playlist
4. Add videos to the playlist
5. Save the playlist as a .wpl file in your media directory

### Using Third-Party Tools

Any software that creates Windows Media Player (.wpl) format playlists will work with Media Viewer.

### Manual WPL Creation

For advanced users, you can create .wpl files manually:

1. Create a new file with the `.wpl` extension
2. Use the XML structure shown above
3. Add `<media src="path/to/video.mp4" />` entries for each video
4. Save the file in your media library
5. Refresh or re-index Media Viewer to see the playlist

!!! tip "Path Format"
Use forward slashes (`/`) or backslashes (`\`) for paths. Relative paths are resolved from the playlist file location.

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
