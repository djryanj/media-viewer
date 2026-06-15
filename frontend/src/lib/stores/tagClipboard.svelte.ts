/**
 * Session-scoped tag clipboard — copy tags from one item, paste (merge) to others.
 * Uses sessionStorage so clipboard survives page navigation but not new tabs/sessions.
 */

const SESSION_KEY = 'tagClipboard';

function loadFromSession(): string[] {
    if (typeof sessionStorage === 'undefined') return [];
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (raw) return JSON.parse(raw) as string[];
    } catch {
        /* ignore */
    }
    return [];
}

let _tags = $state<string[]>(loadFromSession());

function save(tags: string[]) {
    try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(tags));
    } catch {
        /* ignore */
    }
}

export const tagClipboard = {
    get tags() {
        return _tags;
    },
    get hasContent() {
        return _tags.length > 0;
    },
    copy(tags: string[]) {
        _tags = [...tags];
        save(_tags);
    },
    clear() {
        _tags = [];
        save([]);
    },
    /** Returns the union of existingTags and clipboard tags (deduped). */
    merge(existingTags: string[]): string[] {
        const set = new Set([...existingTags, ..._tags]);
        return Array.from(set);
    }
};
