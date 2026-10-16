/**
 * Pure helpers for tagging one or many items with the shared TagPanel.
 */

export interface TagTally {
    name: string;
    /** Number of items that have the tag. */
    count: number;
    /** Number of items in the selection. */
    total: number;
}

/**
 * Split the tags of a selection into those on every item (`common`) and those
 * on only some (`partial`, most widespread first). With a single item every
 * tag is common.
 */
export function tallyTags(tagLists: string[][]): { common: string[]; partial: TagTally[] } {
    const total = tagLists.length;
    const counts = new Map<string, number>();
    for (const list of tagLists) {
        for (const name of new Set(list)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const common: string[] = [];
    const partial: TagTally[] = [];
    for (const [name, count] of counts) {
        if (count === total) common.push(name);
        else partial.push({ name, count, total });
    }
    partial.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return { common, partial };
}

/** Tags present in `next` but not `prev` (added) and vice versa (removed). */
export function diffTags(prev: string[], next: string[]): { added: string[]; removed: string[] } {
    return {
        added: next.filter((t) => !prev.includes(t)),
        removed: prev.filter((t) => !next.includes(t))
    };
}
