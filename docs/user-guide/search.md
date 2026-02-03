# Search

Media Viewer provides powerful search capabilities to quickly find media in your library.

## Basic Search

Type in the search box at the top of the page to search by filename.

- Search is case-insensitive
- Partial matches are supported
- Results update as you type

### Search Dropdown

As you type, a dropdown shows matching results:

- Up to 10 items are shown
- Results include thumbnail, name, and path
- Favorited items show a star indicator
- Click any result to open it directly
- Press ++enter++ to see all results

### Full Results View

Press ++enter++ or click "View all results" to open the full search results view:

- Results display in a gallery grid
- Use the same interactions as the main gallery
- Click "Close" or press ++escape++ to return to browsing

## Tag Search

Search for items with specific tags using the `tag:` prefix:

```

tag:vacation

```

### Tag Suggestions

When you type `tag:`, suggestions appear showing:

- Matching tag names
- Number of items with each tag

Click a suggestion to search for that tag.

### Clicking Tags

You can also search by clicking:

- Any tag displayed on a gallery item
- Any tag in the tag manager modal
- Any tag in the lightbox

## Search Syntax

### By Filename

```

sunset

```

Finds items with "sunset" anywhere in the filename.

### By Tag

```

tag:nature

```

Finds items tagged with "nature".

### By Type

Use the filter dropdown to restrict results to specific types:

- Images only
- Videos only
- Playlists only

## Search Tips

### Finding Recent Additions

1. Sort by Date (descending)
2. The newest items appear first

### Finding Large Files

1. Sort by Size (descending)
2. Filter by type if needed

### Organizing with Search

Use search to find items that need organization:

1. Search for items without tags (browse and look for items missing tags)
2. Use selection mode to tag multiple items at once

## Search Behavior

### Scope

Search covers your entire media library, not just the current folder.

### Results

Search results include:

- Files (images, videos)
- Folders
- Playlists

### Performance

- Search uses an index for fast results
- The index updates automatically when files change
- Large libraries may have a brief delay on first search
