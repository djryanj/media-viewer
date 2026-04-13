# Selection Mode

Selection mode is the bulk-action workspace for gallery items. Use it for tagging, favorites, collections, and tag copy/paste workflows across one or more items.

On touch devices, selection mode is also the main way to act on items from the gallery without keeping extra controls pinned on every thumbnail.

<div align="center">
	<img src="../../images/selection-mobile-toolbar.png" alt="Mobile selection toolbar showing copy tags, tag, favorite, collect, and select-all actions" width="420">
	<p><em>On touch devices, long-press opens selection mode and moves bulk actions into the bottom toolbar.</em></p>
</div>

## Entering Selection Mode

### Desktop

Hover a gallery item and click the checkbox in the top-left corner.

### Mobile

Long-press (touch and hold) any item for about half a second. A brief vibration confirms entry into selection mode.

This keeps normal browsing gestures intact until you deliberately switch into a bulk-action workflow:

- **Tap** still opens the item
- **Double-tap** still toggles favorite
- **Long-press** switches the gallery into selection mode

## Selection Interface

When selection mode is active:

- A toolbar appears at the bottom of the screen
- Selected items show a checkmark overlay
- Unselected items appear slightly dimmed
- The selection count is displayed in the toolbar
- On touch devices, bulk **Tag**, **Favorite**, and **Collect** actions live in this toolbar instead of staying visible on every gallery card

## Selecting Items

### Individual Selection

- Once selection mode is active, **click/tap** any item to toggle its selection
- On desktop, clicking the top-left checkbox both enters selection mode and toggles that item

### Select All

Click the **All** button in the toolbar or press ++ctrl+a++ to select all items in the current view.

If all items are already selected, this action deselects all items.

### Drag Selection (Mobile)

After entering selection mode via long-press, you can drag to select multiple items at once:

1. Keep your finger on the screen after the long-press
2. Drag across other items
3. All items between your starting point and current position are selected (in reading order)

**How it works:**

- Gallery scrolling is frozen during drag to prevent accidental movement
- Items are selected in the natural flow/reading order (left-to-right, top-to-bottom)
- Dragging from the last item in a row down several rows selects all items in between
- Works naturally whether dragging forward or backward
- Release your finger to finish the drag selection

For example, starting on the last item of Row 1 and dragging to the last item of Row 3 will select that first item plus all items in Rows 2 and 3 up to your ending point.

## Available Actions

The selection toolbar provides these actions:

### Copy Tags

_Available when exactly 1 item is selected_

Copies all tags from the selected item to a clipboard for pasting to other items.

- Click **Copy Tags** or press ++ctrl+c++
- A confirmation message shows how many tags were copied

### Paste Tags

_Available when items are selected and tags have been copied_

Pastes previously copied tags to selected items.

- Click **Paste Tags** or press ++ctrl+v++
- A modal appears showing tags to paste
- Select/deselect individual tags as needed
- Click **Paste Tags** to apply

The source item (where tags were copied from) is automatically excluded from paste destinations.

### Merge Tags

_Available when 2 or more items are selected_

Collects all unique tags from selected items and applies them to all selected items.

- Click **Merge Tags** or press ++ctrl+m++
- A modal shows all tags found across selected items
- Tags not present on all items show a count (e.g., "2/3")
- Select tags to apply and click **Merge Tags**

### Tag

Opens the bulk tag modal to add or remove tags from all selected items.

- Click **Tag** or press ++t++
- Add new tags or remove existing ones
- Changes apply to all selected items

### Favorite

Adds all selected items to favorites.

- Click **Favorite** or press ++f++
- Items already in favorites are skipped
- A confirmation shows how many items were added

### Collect

_Available when one or more images or videos are selected_

Opens the collections workflow for the selected media.

- Click **Collect** or press ++c++
- Current memberships are shown first when they already exist
- Recent collections and create-new actions stay in the same modal
- On touch devices, this is the primary gallery entry point for collections

### Remove From Current Collection

_Available when you are browsing inside a collection and selected items belong to it_

Removes selected items from the current collection without leaving collection view.

- Click **Remove** in the toolbar
- The current collection stays open so you can continue curating

## Exiting Selection Mode

- Click the **X** button in the selection toolbar
- Press ++escape++
- Deselect the last remaining selected item

## Selection Mode Tips

### Efficient Bulk Tagging

1. Enter selection mode
2. Select items that should share a tag
3. Click **Tag** and add the common tag
4. Continue selecting, tagging, or collecting until you are finished

### Copying Tags Between Items

1. Select the source item (with tags you want to copy)
2. Press ++ctrl+c++ to copy its tags
3. Select destination items
4. Press ++ctrl+v++ to paste
5. Confirm which tags to apply

### Merging Tags Across Items

Use merge when you have related items with different tags and want them all to share the same tags:

1. Select all related items
2. Press ++ctrl+m++
3. Review and confirm the merged tag set
4. All items now have all the tags

### Mobile Workflow

On mobile, selection mode is optimized for touch:

1. Long-press to enter selection mode
2. Tap items to select/deselect
3. Drag to select multiple items in a range (gallery freezes during drag to prevent scrolling)
4. Use toolbar buttons for **Tag**, **Favorite**, **Collect**, and other bulk actions
