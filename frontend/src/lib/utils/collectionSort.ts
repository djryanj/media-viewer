import type { MediaFile } from '$lib/api/types';

/**
 * Stable grouped sort: re-inserts collection items (in their collection-defined
 * order) at the position of the *first* collection item in the sorted list,
 * leaving all non-collection items in their original relative order.
 *
 * Example with items [1,2,3,4,5] and collection order [4,3]:
 *   - First collection item in list: 3 at index 2
 *   - Output: [1, 2, 4, 3, 5]
 *
 * Only collection items that are actually present in `items` are moved.
 * Collection items not yet loaded (pagination) are simply omitted until they
 * appear in the list and the sort is re-applied.
 */
export function stableGroupedSort(items: MediaFile[], collectionItems: MediaFile[]): MediaFile[] {
    if (collectionItems.length === 0) return items;

    const itemsByPath = new Map(items.map((i) => [i.path, i]));

    // Only include collection items that are present in the current item list.
    const presentCollectionItems = collectionItems.filter((ci) => itemsByPath.has(ci.path));
    if (presentCollectionItems.length === 0) return items;

    const collectionPaths = new Set(presentCollectionItems.map((ci) => ci.path));

    // Find the insertion point: index of the first collection item in the list.
    let insertionPoint = items.length;
    for (let i = 0; i < items.length; i++) {
        if (collectionPaths.has(items[i].path)) {
            insertionPoint = i;
            break;
        }
    }

    const out: MediaFile[] = [];

    // 1. Items before the insertion point (unchanged).
    for (let i = 0; i < insertionPoint; i++) out.push(items[i]);

    // 2. Collection items in collection-defined order, using the live item data.
    for (const ci of presentCollectionItems) out.push(itemsByPath.get(ci.path)!);

    // 3. Non-collection items after the insertion point.
    for (let i = insertionPoint; i < items.length; i++) {
        if (!collectionPaths.has(items[i].path)) out.push(items[i]);
    }

    return out;
}
