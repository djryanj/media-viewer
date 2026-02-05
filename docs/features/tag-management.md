# Tag Management

This page covers advanced tag management features and workflows. For tag-based search features, see the [Search documentation](../user-guide/search.md).

## Tag Display

### Gallery Items (Desktop)

On desktop, tags appear below each gallery item in "X | tag" format:

- The **X** on the left removes the tag when clicked
- The **tag name** on the right searches for that tag when clicked
- Up to 3 tags are shown
- Additional tags show as "+N" indicator

### Gallery Items (Mobile)

On mobile, tags appear as simple chips overlaid on the thumbnail:

- Tap a tag to search for it
- Tap "+N" to see all tags

### Tag Overflow Tooltip

When an item has more than 3 tags:

1. Click the "+N" indicator
2. A tooltip shows all tags
3. Each tag has the same "X | tag" format
4. Click X to remove, click tag name to search
5. Click outside to close

## Tag Operations

### Adding Tags

Tags can be added from:

- Tag modal (via tag button on item)
- Lightbox (via tag button)
- Selection mode (bulk tagging)

### Removing Tags

Tags can be removed from:

- Tag modal (click X on tag chip)
- Gallery item (click X on tag, desktop only)
- Tag overflow tooltip (click X on tag)
- Lightbox tag display (click X on tag)

### Searching by Tag

Click any tag anywhere in the interface to search for all items with that tag.

### Tag Exclusion in Search

Search supports excluding tags from results to find items that _don't_ have specific tags:

**Exclusion Syntax:**

- `-tag:tagname` - Exclude items with this tag
- `NOT tag:tagname` - Alternative exclusion syntax

**Combining Filters:**

- `tag:vacation -tag:2023` - Items tagged "vacation" but not "2023"
- `beach -tag:private` - Text search for "beach" excluding items tagged "private"
- Mix multiple inclusions and exclusions as needed

**Quick Exclusion:**

- **Hover** over any tag in search results to see the exclude button (−)
- **Click** the exclude button to add that tag as an exclusion to your current search
- **Right-click** or **long-press** any tag to access "Search for" or "Exclude" options

**Autocomplete:**

When typing `-` or `-tag:`, autocomplete suggestions show available tags to exclude.

### Search View Tag Behavior

When viewing search results, tag interactions are search-focused:

- Clicking a tag searches for that tag
- The exclude button (−) adds exclusions to your search
- Tag modal shows search options rather than editing options
- This helps you refine your search without leaving the results view

## Bulk Tag Operations

### Adding Tags to Multiple Items

1. Enter selection mode
2. Select target items
3. Click **Tag** in the toolbar
4. Add tags in the modal
5. Tags are added to all selected items

### Removing Tags from Multiple Items

1. Enter selection mode
2. Select target items
3. Click **Tag** in the toolbar
4. In the modal, existing tags show which are common to all items
5. Click X on a tag to remove it from all selected items

### Copy and Paste

Copy tags from one item to others:

1. Select source item
2. Copy tags (++ctrl+c++)
3. Select destination items
4. Paste tags (++ctrl+v++)
5. Confirm in modal

### Merge

Combine tags from multiple items:

1. Select items to merge
2. Merge tags (++ctrl+m++)
3. All unique tags are collected
4. Confirm which to apply
5. All selected items receive all selected tags

## Tag Suggestions

When adding tags, the system suggests existing tags:

- Suggestions appear as you type
- Shows tag name and item count
- Click to add the suggested tag
- Helps maintain consistent tag naming

## Best Practices

### Naming Conventions

- Use lowercase for consistency
- Use hyphens for multi-word tags: `family-reunion`
- Consider prefixes for categories: `location-beach`, `event-birthday`

### Hierarchical Organization

Create logical groupings with prefixes:

```

location-beach
location-mountain
location-city

event-birthday
event-wedding
event-holiday

year-2024
year-2023

```

### Tag Cleanup

Periodically review your tags:

1. Search for each tag to see its contents
2. Remove tags from misclassified items
3. Merge similar tags by:
    - Searching for the old tag
    - Selecting all results
    - Adding the new tag
    - Removing the old tag

## Keyboard Shortcuts

| Shortcut         | Context                 | Action                            |
| ---------------- | ----------------------- | --------------------------------- |
| ++ctrl+c++       | Tag modal open          | Copy common tags to clipboard     |
| ++ctrl+shift+c++ | Tag modal open          | Copy all unique tags to clipboard |
| ++ctrl+v++       | Selection mode          | Paste tags to selected items      |
| ++slash++        | Anywhere                | Focus search bar                  |
| ++ctrl+k++       | Anywhere                | Focus search bar                  |
| ++tab++          | Search with suggestions | Autocomplete current suggestion   |
