# Tagging

Tags are labels you assign to media items for organization and quick retrieval. Media Viewer provides a flexible tagging system that supports individual and bulk operations.

<div align="center">
  <img src="../images/bulk-tagging-mobile.gif" alt="Bulk tagging in action" width="400">
  <p><em>Selection mode enables efficient bulk tagging on mobile</em></p>
</div>

## Understanding Tags

- Tags are simple text labels (e.g., "vacation", "family", "2024")
- An item can have multiple tags
- Tags are shared across your entire library
- Tags are case-sensitive ("Vacation" and "vacation" are different tags)

## Adding Tags

### From the Gallery

1. Hover over an item to reveal the tag button (tag icon in the top-left corner)
2. Click the tag button to open the tag manager
3. Type a tag name in the input field
4. Press ++enter++ or click **Add**
5. Repeat for additional tags
6. Click outside the modal or press ++escape++ to close

### From the Lightbox

1. Open an item in the lightbox
2. Click the tag icon in the top-left area
3. Add tags using the same process as above

### Tag Suggestions

As you type, existing tags that match your input appear as suggestions. Click a suggestion to add that tag, or continue typing to create a new tag.

## Removing Tags

### From the Tag Manager

1. Open the tag manager for an item
2. Click the X on any tag chip to remove it

### From the Gallery (Desktop)

On desktop, tags are displayed on gallery items with a "X | tag" format:

1. Hover over a tag on any gallery item
2. Click the X on the left side of the tag to remove it

### From the Tag Tooltip

When an item has more than 3 tags, a "+N" indicator appears:

1. Click the "+N" indicator to see all tags
2. Click the X on any tag to remove it

## Bulk Tagging

Selection mode allows you to tag multiple items at once.

### Entering Selection Mode

- **Desktop**: Click the checkbox area on any gallery item
- **Mobile**: Long-press any item

### Tagging Selected Items

1. Select the items you want to tag
2. Click the **Tag** button in the selection toolbar
3. Add tags in the bulk tag modal
4. Tags are applied to all selected items

### Tag Indicators in Bulk Mode

When tagging multiple items, the modal shows:

- Tags common to all selected items
- Tags present on some items (marked with a "~" indicator)

## Copying and Pasting Tags

Media Viewer supports copying tags from one item and pasting them to others.

### Copying Tags

1. Enter selection mode
2. Select a single item
3. Click **Copy Tags** or press ++ctrl+c++

### Pasting Tags

1. With tags copied, select destination item(s)
2. Click **Paste Tags** or press ++ctrl+v++
3. In the confirmation modal, select which tags to paste
4. Click **Paste Tags** to apply

### Merging Tags

When multiple items are selected, you can merge all their tags:

1. Select 2 or more items
2. Click **Merge Tags** or press ++ctrl+m++
3. The modal shows all unique tags from selected items
4. Tags not on all items show a count (e.g., "nature (2/3)")
5. Select tags to apply and click **Merge Tags**

All selected tags are applied to all selected items.

## Searching by Tag

Click any tag to search for all items with that tag. Alternatively, use the search box with the `tag:` prefix:

```

tag:vacation

```

### Tag Exclusion

Exclude items with specific tags from search results:

```
-tag:private
```

or

```
NOT tag:private
```

**Combining Filters:**

```
tag:vacation -tag:2023
```

Finds items tagged "vacation" but not "2023".

### Search View Tag Behavior

When viewing search results, tag interactions are search-focused:

- **Hover** over any tag to see the exclude button (−)
- **Click** the exclude button to add that tag as an exclusion to your search
- **Right-click** or **long-press** any tag for "Search for" or "Exclude" options
- Clicking tags searches for them rather than opening the tag editor

This behavior helps you refine searches without leaving the results view.

See [Search](search.md) for more search options.

## Tag Management Tips

- Use consistent naming conventions (e.g., always lowercase)
- Create a hierarchy with prefixes (e.g., "location-beach", "location-mountain")
- Use year tags for chronological organization (e.g., "2024", "2023")
- Combine tags for precise filtering (search for multiple tags)
