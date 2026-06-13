<script module lang="ts">
    // Module-level clipboard shared across all TagEditor instances
    // (enables copy in lightbox → paste in bulk modal, etc.)
    let _clipboard: string[] = $state([]);
</script>

<!--
  TagEditor — chip-based tag editor with full autocomplete.

  Features:
  - Existing-tag chips with × to remove, Backspace on empty input removes last
  - Three suggestion groups: Related (co-occurring tags), Recent, All (filtered)
  - Usage counts displayed on each suggestion
  - Query match highlighting
  - Keyboard nav: ArrowDown/Up to move, Tab/Enter to confirm, Escape to dismiss
  - Clipboard: Ctrl/Cmd+C to copy all tags, Ctrl/Cmd+V to paste from clipboard

  Props:
    tags       — current tag list (read)
    onchange   — called with the new complete list on every mutation
    compact    — denser dark layout for the lightbox info bar
    allTags    — optional pre-loaded Tag[] list; omit to fetch on mount
-->
<script lang="ts">
    import { onMount } from 'svelte';
    import { tags as tagsApi } from '$lib/api/client';
    import type { Tag, RelatedTagSuggestion } from '$lib/api/types';

    let {
        tags = [],
        onchange,
        compact = false,
        allTags: allTagsProp = undefined
    }: {
        tags?: string[];
        onchange: (tags: string[]) => void;
        compact?: boolean;
        allTags?: Tag[];
    } = $props();

    // ── Known tags & recents ──────────────────────────────────────────────────
    let knownTags: Tag[] = $state([]);
    let recentTagNames: string[] = $state([]);
    let relatedSuggestions: RelatedTagSuggestion[] = $state([]);
    let relatedRequestId = 0;

    // Sync prop changes into writable state; initial [] avoids the
    // "captures initial value only" compiler warning on $state(prop).
    $effect(() => {
        if (allTagsProp !== undefined) knownTags = allTagsProp;
    });

    onMount(async () => {
        if (!allTagsProp) {
            try {
                knownTags = await tagsApi.list();
            } catch {
                /* ignore */
            }
        }
    });

    // Refresh related suggestions whenever the current tag set changes
    $effect(() => {
        const current = [...tags]; // reactive read
        if (current.length === 0) {
            relatedSuggestions = [];
            return;
        }
        const id = ++relatedRequestId;
        tagsApi
            .related(current, current, 8)
            .then((res) => {
                if (id === relatedRequestId) relatedSuggestions = res;
            })
            .catch(() => {});
    });

    // ── Input / suggestions state ─────────────────────────────────────────────
    let inputValue = $state('');
    let inputEl: HTMLInputElement | undefined = $state();
    let editorEl: HTMLElement | undefined = $state();
    let focused = $state(false);
    let highlightedIdx = $state(-1);

    type SuggestionItem = { name: string; count: number; group: 'related' | 'recent' | 'all' };

    const suggestions = $derived.by<SuggestionItem[]>(() => {
        const q = inputValue.trim().toLowerCase();
        const existing = new Set(tags.map((t) => t.toLowerCase()));
        const results: SuggestionItem[] = [];

        if (!q) {
            // No query: show related first, then recents, up to 8
            for (const r of relatedSuggestions) {
                if (!existing.has(r.name.toLowerCase())) {
                    results.push({ name: r.name, count: r.relatedCount, group: 'related' });
                }
                if (results.length >= 8) break;
            }
            for (const name of recentTagNames) {
                if (!existing.has(name.toLowerCase()) && !results.find((r) => r.name === name)) {
                    const kt = knownTags.find((t) => t.name === name);
                    results.push({ name, count: kt?.itemCount ?? 0, group: 'recent' });
                }
                if (results.length >= 8) break;
            }
            return results;
        }

        // With query: score by match position, prefer related, then recent, then all
        const scored: Array<SuggestionItem & { score: number }> = [];
        for (const t of knownTags) {
            if (existing.has(t.name.toLowerCase())) continue;
            const lc = t.name.toLowerCase();
            const idx = lc.indexOf(q);
            if (idx === -1) continue;
            const isRelated = relatedSuggestions.some((r) => r.name === t.name);
            const isRecent = recentTagNames.includes(t.name);
            const score =
                (isRelated ? 1000 : 0) + (isRecent ? 500 : 0) + (idx === 0 ? 100 : 0) - idx;
            scored.push({
                name: t.name,
                count: t.itemCount,
                group: isRelated ? 'related' : isRecent ? 'recent' : 'all',
                score
            });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, 8);
    });

    const showSuggestions = $derived(
        focused && suggestions.length > 0 && !inputValue.includes('|')
    );

    // Expansion preview — shown instead of suggestions when input contains `|`
    const expansionPreview = $derived.by<string[]>(() => {
        if (!inputValue.includes('|')) return [];
        return expandTagExpression(inputValue.trim());
    });
    const showExpansionPreview = $derived(focused && expansionPreview.length > 0);

    // Keep highlight in bounds when list changes
    $effect(() => {
        const len = suggestions.length;
        if (highlightedIdx >= len) highlightedIdx = len - 1;
    });

    // ── Tag expansion ─────────────────────────────────────────────────────────
    // Each space-separated token can have pipe-separated alternatives.
    // The cartesian product of all tokens' alternatives produces the tag list.
    //
    // Examples:
    //   "big|huge tree"              → ["big tree", "huge tree"]
    //   "large trees|"               → ["large trees", "large"]
    //   "huge|large| trees|bushes"   → ["huge trees","huge bushes","large trees","large bushes","trees","bushes"]
    function expandTagExpression(input: string): string[] {
        if (!input.includes('|')) return input ? [input] : [];
        const groups = input.split(' ').map((g) => g.split('|'));
        let results: string[] = [''];
        for (const group of groups) {
            const next: string[] = [];
            for (const partial of results) {
                for (const alt of group) {
                    next.push((partial + ' ' + alt).trim());
                }
            }
            results = next;
        }
        return [...new Set(results.filter(Boolean))];
    }

    // ── Tag clipboard (module-level $state, shared across all instances) ──────
    // _clipboard is declared in <script module> above.

    // ── Helpers ───────────────────────────────────────────────────────────────
    function markRecent(name: string) {
        recentTagNames = [name, ...recentTagNames.filter((n) => n !== name)].slice(0, 10);
    }

    function addTag(name: string) {
        const trimmed = name.trim();
        if (!trimmed) {
            inputValue = '';
            return;
        }
        const expanded = expandTagExpression(trimmed);
        const existing = new Set(tags.map((t) => t.toLowerCase()));
        const toAdd = expanded.filter((t) => !existing.has(t.toLowerCase()));
        if (toAdd.length === 0) {
            inputValue = '';
            return;
        }
        for (const t of toAdd) {
            if (!knownTags.find((k) => k.name === t)) {
                knownTags = [...knownTags, { id: 0, name: t, itemCount: 0, createdAt: '' }];
            }
            markRecent(t);
        }
        inputValue = '';
        highlightedIdx = -1;
        onchange([...tags, ...toAdd]);
    }

    function removeTag(name: string) {
        onchange(tags.filter((t) => t !== name));
    }

    function confirmHighlighted() {
        if (highlightedIdx >= 0 && highlightedIdx < suggestions.length) {
            addTag(suggestions[highlightedIdx].name);
        } else {
            addTag(inputValue);
        }
    }

    function copyTags() {
        if (tags.length === 0) return;
        _clipboard = [...tags];
        // Also try system clipboard (best-effort)
        navigator.clipboard?.writeText(tags.join(', ')).catch(() => {});
    }

    function pasteTags() {
        if (_clipboard.length === 0) return;
        const merged = [...new Set([...tags, ..._clipboard])];
        onchange(merged);
    }

    // ── Highlight match in text ───────────────────────────────────────────────
    function highlight(text: string, query: string): string {
        if (!query) return escHtml(text);
        const lc = text.toLowerCase();
        const idx = lc.indexOf(query.toLowerCase());
        if (idx === -1) return escHtml(text);
        return (
            escHtml(text.slice(0, idx)) +
            '<mark>' +
            escHtml(text.slice(idx, idx + query.length)) +
            '</mark>' +
            escHtml(text.slice(idx + query.length))
        );
    }

    function escHtml(s: string) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Keyboard handler ──────────────────────────────────────────────────────
    function handleKeydown(e: KeyboardEvent) {
        switch (e.key) {
            case 'Enter':
            case ',':
                e.preventDefault();
                confirmHighlighted();
                break;
            case 'Tab':
                if (showSuggestions) {
                    e.preventDefault();
                    // Complete the first suggestion when nothing is explicitly
                    // highlighted; arrow-keyed selection still wins.
                    if (highlightedIdx < 0) {
                        addTag(suggestions[0].name);
                    } else {
                        confirmHighlighted();
                    }
                }
                break;
            case 'ArrowDown':
                e.preventDefault();
                highlightedIdx = Math.min(highlightedIdx + 1, suggestions.length - 1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                highlightedIdx = Math.max(highlightedIdx - 1, -1);
                break;
            case 'Backspace':
                if (inputValue === '' && tags.length > 0) {
                    removeTag(tags[tags.length - 1]);
                }
                break;
            case 'Escape':
                inputValue = '';
                highlightedIdx = -1;
                inputEl?.blur();
                break;
        }
    }

    function handleEditorKeydown(e: KeyboardEvent) {
        if (e.target instanceof HTMLInputElement) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            copyTags();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            e.preventDefault();
            pasteTags();
        }
    }

    function handleInputKeydown(e: KeyboardEvent) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            copyTags();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            e.preventDefault();
            pasteTags();
            return;
        }
        handleKeydown(e);
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
    class="tag-editor"
    class:compact
    class:focused
    bind:this={editorEl}
    onclick={() => inputEl?.focus()}
    onkeydown={handleEditorKeydown}
    role="group"
    aria-label="Tag editor"
>
    {#each tags as tag (tag)}
        <span class="chip">
            {tag}
            <button
                class="chip-remove"
                onclick={(e) => {
                    e.stopPropagation();
                    removeTag(tag);
                }}
                aria-label="Remove tag {tag}"
                type="button"
                tabindex="-1">×</button
            >
        </span>
    {/each}

    <div class="input-wrap">
        <input
            bind:this={inputEl}
            bind:value={inputValue}
            class="tag-input"
            placeholder={tags.length === 0 ? 'Add tags…' : ''}
            onkeydown={handleInputKeydown}
            onfocus={() => {
                focused = true;
                highlightedIdx = -1;
            }}
            onblur={() => {
                setTimeout(() => {
                    focused = false;
                    highlightedIdx = -1;
                }, 160);
                if (inputValue.trim()) addTag(inputValue);
            }}
            type="text"
            autocomplete="off"
            spellcheck={false}
            role="combobox"
            aria-label="Tag input"
            aria-autocomplete="list"
            aria-expanded={showSuggestions || showExpansionPreview}
            aria-controls="tag-suggestions-listbox"
        />

        {#if showExpansionPreview}
            <ul
                id="tag-suggestions-listbox"
                class="suggestions"
                role="listbox"
                aria-label="Tag expansion preview"
            >
                <li class="suggestion-header" role="presentation">Will create</li>
                {#each expansionPreview as t (t)}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <li
                        role="option"
                        aria-selected={false}
                        class="suggestion expansion-preview"
                        onmousedown={(e) => {
                            e.preventDefault();
                            addTag(inputValue);
                        }}
                    >
                        <span class="suggestion-name">{t}</span>
                    </li>
                {/each}
            </ul>
        {:else if showSuggestions}
            <ul
                id="tag-suggestions-listbox"
                class="suggestions"
                role="listbox"
                aria-label="Tag suggestions"
            >
                {#each suggestions as s, i (s.name)}
                    {@const groupChanged = i === 0 || suggestions[i - 1].group !== s.group}
                    {#if groupChanged && s.group !== 'all'}
                        <li class="suggestion-header" role="presentation">
                            {s.group === 'related' ? 'Related' : 'Recent'}
                        </li>
                    {/if}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <li
                        role="option"
                        aria-selected={i === highlightedIdx}
                        class="suggestion"
                        class:active={i === highlightedIdx}
                        onmousedown={(e) => {
                            e.preventDefault();
                            addTag(s.name);
                        }}
                        onmouseover={() => {
                            highlightedIdx = i;
                        }}
                        onfocus={() => {
                            highlightedIdx = i;
                        }}
                    >
                        <span class="suggestion-name">
                            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                            {@html highlight(s.name, inputValue.trim())}
                        </span>
                        {#if s.count > 0}
                            <span class="suggestion-count">{s.count}</span>
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}
    </div>

    <!-- Clipboard actions -->
    <div class="tag-actions" onclick={(e) => e.stopPropagation()}>
        <button
            class="action-btn"
            title="Copy tags (Ctrl+C)"
            disabled={tags.length === 0}
            onclick={copyTags}
            type="button"
            tabindex="-1"
            aria-label="Copy tags"
        >
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
            >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
        </button>
        <button
            class="action-btn"
            title="Paste tags (Ctrl+V)"
            disabled={_clipboard.length === 0}
            onclick={pasteTags}
            type="button"
            tabindex="-1"
            aria-label="Paste tags"
        >
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
            >
                <path
                    d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                />
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
        </button>
    </div>
</div>

<style>
    .tag-editor {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        padding: 4px 6px;
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        cursor: text;
        min-height: 34px;
        transition: border-color var(--transition-fast);
        position: relative;
    }

    .tag-editor.focused {
        border-color: var(--color-primary);
        outline: 2px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
    }

    .tag-editor.compact {
        padding: 2px 6px;
        min-height: 28px;
        background: rgba(255, 255, 255, 0.08);
        border-color: rgba(255, 255, 255, 0.2);
    }

    .tag-editor.compact.focused {
        border-color: rgba(255, 255, 255, 0.5);
        outline: none;
    }

    /* ── Chips ── */
    .chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: var(--color-primary);
        color: #fff;
        padding: 1px 6px 1px 8px;
        border-radius: var(--radius-full);
        font-size: var(--text-xs);
        font-weight: 500;
        white-space: nowrap;
        line-height: 1.6;
    }

    .compact .chip {
        font-size: 11px;
        padding: 0 5px 0 7px;
    }

    .chip-remove {
        background: none;
        border: none;
        cursor: pointer;
        color: rgba(255, 255, 255, 0.7);
        font-size: 14px;
        line-height: 1;
        padding: 0;
        width: 14px;
        height: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition:
            color var(--transition-fast),
            background var(--transition-fast);
    }

    .chip-remove:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.2);
    }

    /* ── Input ── */
    .input-wrap {
        position: relative;
        flex: 1;
        min-width: 80px;
    }

    .tag-input {
        width: 100%;
        background: none;
        border: none;
        outline: none;
        color: var(--color-text);
        font-size: var(--text-sm);
        padding: 0;
        line-height: 1.6;
    }

    .compact .tag-input {
        font-size: var(--text-xs);
        color: rgba(255, 255, 255, 0.85);
    }

    .tag-input::placeholder {
        color: var(--color-text-muted);
    }

    .compact .tag-input::placeholder {
        color: rgba(255, 255, 255, 0.4);
    }

    /* ── Suggestions ── */
    .suggestions {
        position: absolute;
        top: calc(100% + 4px);
        left: -6px;
        min-width: 220px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        list-style: none;
        margin: 0;
        padding: 4px;
        z-index: 600;
    }

    .suggestion-header {
        padding: 2px 10px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--color-text-muted);
        margin-top: 2px;
    }

    .suggestion {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 5px 10px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: var(--text-sm);
        color: var(--color-text);
        transition: background var(--transition-fast);
    }

    .suggestion:hover,
    .suggestion.active {
        background: var(--color-surface-2);
    }

    .expansion-preview {
        color: var(--color-text-muted);
        font-style: italic;
        cursor: default;
    }

    .expansion-preview:hover {
        background: var(--color-surface-2);
        color: var(--color-text);
        font-style: normal;
        cursor: pointer;
    }

    .suggestion-name :global(mark) {
        background: none;
        color: var(--color-primary);
        font-weight: 700;
    }

    .suggestion-count {
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        flex-shrink: 0;
        margin-left: var(--spacing-2);
    }

    /* ── Clipboard actions ── */
    .tag-actions {
        display: flex;
        gap: 2px;
        margin-left: 2px;
    }

    .action-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
        border-radius: var(--radius-sm);
        padding: 0;
        transition:
            color var(--transition-fast),
            background var(--transition-fast);
        flex-shrink: 0;
    }

    .compact .action-btn {
        color: rgba(255, 255, 255, 0.4);
    }

    .action-btn:not(:disabled):hover {
        color: var(--color-text);
        background: var(--color-surface-2);
    }

    .compact .action-btn:not(:disabled):hover {
        color: rgba(255, 255, 255, 0.9);
        background: rgba(255, 255, 255, 0.1);
    }

    .action-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .action-btn svg {
        width: 14px;
        height: 14px;
    }
</style>
