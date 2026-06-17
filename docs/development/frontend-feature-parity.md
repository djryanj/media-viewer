# Frontend Feature Parity

Historical comparison of the legacy vanilla-JS frontend (`static/`) test suite against the SvelteKit frontend (`frontend/`) test suite. The `static/` directory has since been removed; this document is preserved for reference.

**Legend**

| Symbol | Meaning |
|--------|---------|
| ✅ | Covered — unit, integration, or E2E test exists in the new suite |
| ⚠️ | Partial — feature is implemented but test coverage is limited or absent |
| ❌ | No coverage — feature is known to be absent or untested in new frontend |
| 🆕 | New — introduced in the SvelteKit rewrite; no equivalent in the legacy suite |

---

## Authentication

| Feature | Status | Notes |
|---------|--------|-------|
| Password login form | ✅ | `auth.spec.ts` E2E |
| Wrong password error display | ✅ | `auth.spec.ts` E2E |
| Successful login redirects to `/` | ✅ | `auth.spec.ts` E2E |
| Redirect unauthenticated users to `/login` | ✅ | `auth.spec.ts` E2E |
| Logout / sign-out | ✅ | `auth.spec.ts` E2E |
| Password visibility toggle | ✅ | `SettingsPasswordToggle.test.ts` unit |
| WebAuthn: passkey list | ✅ | `SettingsModal.test.ts`, `listPasskeys.test.ts` unit |
| WebAuthn: passkey registration | ✅ | `SettingsModal.test.ts` unit |
| WebAuthn: passkey deletion | ⚠️ | API client tested; UI delete flow not unit-tested |
| WebAuthn: conditional UI (browser autofill) | ⚠️ | Logic exists; no unit test |
| WebAuthn: name validation before registering | ✅ | `SettingsModal.test.ts` unit |
| WebAuthn: loading state during registration | ✅ | `SettingsModal.test.ts` unit |
| Session keepalive (periodic ping) | ❌ | Not implemented / tested in new frontend |
| Session expiration warning | ❌ | Not implemented / tested in new frontend |
| Activity tracking (resets expiry timer) | ❌ | Not implemented / tested in new frontend |
| 401 fetch interceptor (auto-redirect) | ⚠️ | Likely in API client; no unit test |

---

## Gallery

| Feature | Status | Notes |
|---------|--------|-------|
| Directory listing (browse folders) | ✅ | `gallery.test.ts` store, `gallery.spec.ts` E2E |
| Navigate into subfolder | ✅ | `gallery.test.ts` store |
| Navigate to parent folder | ✅ | `Breadcrumb.test.ts` unit |
| Library root button | ✅ | `navigation.spec.ts` E2E |
| Breadcrumb trail | ✅ | `Breadcrumb.test.ts` unit |
| No breadcrumb at library root | ✅ | `gallery.spec.ts` E2E |
| Infinite scroll (load more on scroll down) | ✅ | `gallery.test.ts` store |
| Load more (pagination) | ✅ | `gallery.test.ts` store |
| Bidirectional infinite scroll (prev page) | ✅ | `gallery.test.ts` store |
| Type filter chips (All / Images / Videos / Folders / Playlists) | ✅ | `gallery-filter.spec.ts` E2E |
| "All" chip active by default | ✅ | `gallery-filter.spec.ts` E2E |
| Filter chip activates on click | ✅ | `gallery-filter.spec.ts` E2E |
| Filter chip group has accessible ARIA label | ✅ | `gallery-filter.spec.ts` E2E |
| Sort field | ✅ | `GalleryToolbar.test.ts` unit |
| Sort order (ascending / descending) | ✅ | `GalleryToolbar.test.ts` unit |
| Per-folder sort persistence (across sessions) | ⚠️ | Store resets sort on navigation; localStorage not used |
| Empty folder message | ✅ | `gallery.spec.ts` E2E |
| "Indexing your library…" message | ✅ | `gallery.spec.ts` E2E |
| Indexer:complete auto-refresh | ✅ | `gallery.spec.ts` E2E |
| Indexer:running does not trigger extra API calls | ✅ | `gallery.spec.ts` E2E |
| Pull-to-refresh gesture | ✅ | `gallery.spec.ts` E2E, `pullToRefresh.test.ts` unit |
| Gallery item: thumbnail image | ✅ | `GalleryItem.test.ts` unit |
| Gallery item: folder placeholder | ✅ | `GalleryItem.test.ts` unit |
| Gallery item: thumbnail failure fallback | ⚠️ | No unit test |
| Gallery item: `data-type` attribute | ✅ | `gallery.spec.ts` E2E |
| Toast notifications | ✅ | `ToastContainer.test.ts` unit |
| Skeleton / loading placeholders | ⚠️ | No unit test |
| Custom scroll scrubber (sidebar fast-scroll) | ⚠️ | No unit test |
| Loaded-item windowing (virtual DOM) | ❌ | Not present in new frontend |
| Scroll position save/restore per path | ✅ | `gallery.test.ts` store |
| Navigation path cache (back-nav restores items) | ✅ | `gallery.test.ts` store |
| No JS errors on load | ✅ | `gallery.spec.ts` E2E |
| No crash banner on load | ✅ | `gallery.spec.ts` E2E |

---

## Favorites

| Feature | Status | Notes |
|---------|--------|-------|
| Add to favorites | ✅ | `gallery.test.ts` store, `gallery.spec.ts` E2E (context menu) |
| Remove from favorites | ✅ | `gallery.test.ts` store |
| Toggle favorite (add/remove) | ✅ | `gallery.test.ts` store |
| Favorites strip rendered above gallery | ✅ | `FavoritesStrip.test.ts` unit |
| Strip hidden when no favorites | ✅ | `FavoritesStrip.test.ts` unit |
| Strip shows image thumbnails | ✅ | `FavoritesStrip.test.ts` unit |
| Strip shows folder placeholder | ✅ | `FavoritesStrip.test.ts` unit |
| Strip shows playlist placeholder | ✅ | `FavoritesStrip.test.ts` unit |
| Click image in strip → opens lightbox | ✅ | `FavoritesStrip.test.ts` unit |
| Click folder in strip → navigates to folder | ✅ | `FavoritesStrip.test.ts` unit |
| Click playlist in strip → navigates to playlist | ✅ | `FavoritesStrip.test.ts` unit |
| All strip items are draggable | ✅ | `FavoritesStrip.test.ts` unit |
| Drag-to-reorder favorites strip | ✅ | `FavoritesStrip.test.ts` unit |
| No reorder API call when dropping on same position | ✅ | `FavoritesStrip.test.ts` unit |
| Saved order (PUT `/api/favorites/order`) | ✅ | `FavoritesStrip.test.ts` unit |
| Parent path hint for nested items | ✅ | `FavoritesStrip.test.ts` unit |
| No path hint for root-level items | ✅ | `FavoritesStrip.test.ts` unit |
| No path hint for folder items | ✅ | `FavoritesStrip.test.ts` unit |
| Shows immediate folder name only (not full path) | ✅ | `FavoritesStrip.test.ts` unit |
| "Favorites" label visible in strip | ✅ | `FavoritesStrip.test.ts` unit |
| Scroll fades (left/right fade indicators) | ⚠️ | Implemented; no unit test |
| Touch long-press to remove from strip | ⚠️ | Implemented; no unit test |
| Favorites state is global (persists across paths) | ✅ | `gallery.svelte.ts` fix applied; `gallery.test.ts` store |
| Favorites page (`/favorites`) | ✅ | `navigation.spec.ts` E2E |

---

## Collections

| Feature | Status | Notes |
|---------|--------|-------|
| Collections page (`/collections`) | ✅ | `navigation.spec.ts` E2E, `CollectionsNav.test.ts` unit |
| Collections nav button (desktop header) | ✅ | `CollectionsNav.test.ts` unit |
| Collections nav button (mobile bottom nav) | ✅ | `navigation.spec.ts` E2E, `CollectionsNav.test.ts` unit |
| Collections panel (sheet) from context menu | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: single-item title | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: bulk title (N items) | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: list all collections | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: empty state ("No collections yet.") | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: membership: non-member | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: membership: full member | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: membership: partial (bulk) | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: click to add item to collection | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: click to remove item from collection | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: create new collection from name input | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: Create button disabled when name empty | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: close button | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: backdrop click closes | ✅ | `CollectionsPanel.test.ts` unit |
| Panel: all selected items go to panel (multi-select) | ✅ | `GalleryMultiSelectCollections.test.ts` unit |
| Collection detail page (`/collections/[id]`) | ✅ | `CollectionReorderThumbs.test.ts` unit |
| Collection: rename | ✅ | `CollectionRename.test.ts` unit |
| Collection: duplicate name validation | ✅ | `CollectionRename.test.ts` unit |
| Collection: reorder dialog | ✅ | `CollectionReorderThumbs.test.ts` unit |
| Collection: reorder shows thumbnail images | ✅ | `CollectionReorderThumbs.test.ts` unit |
| Collection: reorder shows placeholder for items without thumbnail | ✅ | `CollectionReorderThumbs.test.ts` unit |
| Gallery: collection ordering applied on navigate | ✅ | `galleryCollectionOrdering.test.ts` store, `collectionSort.test.ts` unit |
| Gallery: stableGroupedSort algorithm | ✅ | `collectionSort.test.ts` (9 cases) |
| Gallery: collection items placed at first-match position | ✅ | `collectionSort.test.ts` unit |
| Gallery: non-collection items maintain relative order | ✅ | `collectionSort.test.ts` unit |
| Gallery: sort re-applied on loadMore | ✅ | `collectionSort.test.ts` unit |
| Gallery: multiple collections applied in ID order | ✅ | `collectionSort.test.ts` unit |
| One-collection-per-item enforcement | ✅ | `collections_integration_test.go` |
| Move items between collections removes from old | ✅ | `collections_integration_test.go` |
| Re-adding to same collection is idempotent | ✅ | `collections_integration_test.go` |
| Folder-scoped collections | ✅ | `collections_integration_test.go` |
| Cross-folder add rejected (`ErrCollectionFolderConflict`) | ✅ | `collections_integration_test.go` |
| Empty collection retains creation folder scope | ✅ | `collections_integration_test.go` |
| Duplicate paths normalized on create | ✅ | `collections_integration_test.go` |
| Remove items updates cover image | ✅ | `collections_integration_test.go` |
| Cross-folder name conflict detection (UI) | ⚠️ | DB enforced; UI conflict display not unit-tested |
| Collections panel search/filter by name | ⚠️ | No unit test |
| Recent collections ranking | ⚠️ | No unit test |
| Collection empty-state guidance (in-gallery) | ⚠️ | No unit test |
| Lightbox: Collections toggle button | ✅ | `Lightbox.test.ts` unit |
| Lightbox: Collections panel open/close | ✅ | `Lightbox.test.ts` unit |
| Lightbox: panel resets on re-open | ✅ | `Lightbox.test.ts` unit |
| Lightbox: panel closes on prev/next navigation | ✅ | `Lightbox.test.ts` unit |

---

## Lightbox

| Feature | Status | Notes |
|---------|--------|-------|
| Opens image in full-screen dialog | ✅ | `Lightbox.test.ts` unit |
| Dialog is labelled with item name | ✅ | `Lightbox.test.ts` unit |
| Closes via Close (×) button | ✅ | `Lightbox.test.ts` unit |
| Closes via Escape key | ✅ | `Lightbox.test.ts` unit, `lightbox.spec.ts` E2E |
| Hidden when not open | ✅ | `Lightbox.test.ts` unit |
| Prev/Next keyboard navigation (ArrowLeft / ArrowRight) | ✅ | `lightbox.spec.ts` E2E (no-crash guard) |
| F key does not crash | ✅ | `lightbox.spec.ts` E2E |
| A key does not crash | ✅ | `lightbox.spec.ts` E2E |
| L key does not crash | ✅ | `lightbox.spec.ts` E2E |
| No JS errors on gallery load without lightbox open | ✅ | `lightbox.spec.ts` E2E |
| Open video in lightbox | ⚠️ | No unit test |
| Zoom (pinch / scroll wheel) | ⚠️ | No unit test |
| Swipe-to-close (mobile drag-down) | ⚠️ | No unit test |
| Swipe left/right to navigate (mobile) | ⚠️ | No unit test |
| Tags panel in lightbox | ⚠️ | No unit test |
| Favorite toggle button | ⚠️ | No unit test |
| Download button | ⚠️ | No unit test |
| Wake lock (screen stays on while viewing) | ⚠️ | No unit test |
| History management (back button closes) | ⚠️ | No unit test |
| Scroll restoration after close | ⚠️ | No unit test |
| Video autoplay preference in lightbox | ⚠️ | No unit test |
| Video loop preference in lightbox | ⚠️ | No unit test |
| Circular navigation (wrap at list ends) | ⚠️ | No unit test (only ArrowRight no-crash) |

---

## Tags

| Feature | Status | Notes |
|---------|--------|-------|
| Render existing tags as chips | ✅ | `TagEditor.test.ts` unit |
| Remove tag via × button | ✅ | `TagEditor.test.ts` unit |
| onchange callback fires correctly | ✅ | `TagEditor.test.ts` unit |
| Placeholder shown when no tags | ✅ | `TagEditor.test.ts` unit |
| Add tag via Enter key | ✅ | `TagEditor.test.ts` unit |
| Add tag via comma key | ✅ | `TagEditor.test.ts` unit |
| Empty tag not added | ✅ | `TagEditor.test.ts` unit |
| Tag suggestions (autocomplete) | ✅ | `TagEditor.test.ts` unit |
| Suggestions filtered by input | ✅ | `TagEditor.test.ts` unit |
| Keyboard navigation in suggestions (ArrowUp/Down) | ✅ | `TagEditor.test.ts` unit |
| Enter selects highlighted suggestion | ✅ | `TagEditor.test.ts` unit |
| Tab accepts highlighted suggestion | ✅ | `TagEditor.test.ts` unit |
| Tab accepts first suggestion when none highlighted | ✅ | `TagEditor.test.ts` unit |
| Escape clears input and closes suggestions | ✅ | `TagEditor.test.ts` unit |
| Recent tags display (chips above input) | ✅ | `TagEditorRecents.test.ts` unit |
| Recent tags persistence (saved to localStorage) | ✅ | `TagEditorRecents.test.ts` unit |
| Clicking recent tag adds it | ✅ | `TagEditorRecents.test.ts` unit |
| Tag search filter on search page | ✅ | `SearchTagFilter.test.ts` unit |
| Tags option in context menu | ✅ | `gallery.spec.ts` E2E |
| Tag clipboard: copy from lightbox | ⚠️ | No unit test |
| Tag clipboard: paste to item (with confirmation) | ⚠️ | No unit test |
| Bulk tag (apply to all selected items) | ⚠️ | No unit test |
| Tag manager: list all tags | ✅ | `SettingsModal.tags.test.ts` |
| Tag manager: rename tag | ✅ | `SettingsModal.tags-actions.test.ts` |
| Tag manager: delete tag | ✅ | `SettingsModal.tags-actions.test.ts` |
| Tag manager: search / filter tags | ✅ | `SettingsModal.tags.test.ts` |

---

## Search

| Feature | Status | Notes |
|---------|--------|-------|
| Search page (`/search`) | ✅ | `search.spec.ts` E2E |
| Page title includes "Search" | ✅ | `search.spec.ts` E2E |
| "Enter a search term above." prompt | ✅ | `search.spec.ts` E2E |
| Visible search heading | ✅ | `search.spec.ts` E2E |
| Query updates URL (`?q=…`) | ✅ | `search.spec.ts` E2E |
| No-results message | ✅ | `search.spec.ts` E2E |
| Dynamic page title reflects query | ✅ | `search.spec.ts` E2E |
| Keyboard shortcut: `/` opens search | ✅ | `search-shortcut.spec.ts` E2E |
| Keyboard shortcut: Ctrl+K opens search | ✅ | `search-shortcut.spec.ts` E2E |
| `/` does not open search when input is focused | ✅ | `search-shortcut.spec.ts` E2E |
| Escape closes search | ✅ | `search-shortcut.spec.ts` E2E |
| Tag filter in search results | ✅ | `SearchTagFilter.test.ts` unit |
| Search bar suggestions | ✅ | `SearchBar.test.ts` unit |
| Search reachable from bottom nav (mobile) | ✅ | `navigation.spec.ts` E2E |
| Infinite scroll in search results | ⚠️ | No unit test |
| Search from within lightbox | ⚠️ | No unit test |
| Search by tag only (no text query) | ⚠️ | No dedicated unit test |

---

## Video Player

| Feature | Status | Notes |
|---------|--------|-------|
| Video player renders | ✅ | `VideoPlayer.test.ts` unit |
| Play/pause | ⚠️ | No unit test |
| Volume control | ⚠️ | No unit test |
| Mute/unmute | ⚠️ | No unit test |
| Seek (progress bar click) | ⚠️ | No unit test |
| Time display (current / duration) | ⚠️ | No unit test |
| Format time (mm:ss / h:mm:ss) | ✅ | `format.test.ts` unit |
| Autoplay preference | ⚠️ | No unit test |
| Loop preference | ⚠️ | No unit test |
| Fullscreen | ⚠️ | No unit test |
| HLS streaming | ⚠️ | No unit test |
| Audio track detection | ⚠️ | No unit test |
| Error display on load failure | ⚠️ | No unit test |

---

## Playlists

| Feature | Status | Notes |
|---------|--------|-------|
| Playlist page (`/playlists/[name]`) | ⚠️ | Route exists; no unit or E2E test |
| Playlist video playback | ⚠️ | No unit test |
| Playlist item list (sidebar) | ⚠️ | No unit test |
| Navigate between playlist items | ⚠️ | No unit test |
| Background tag loading for playlist items | ⚠️ | No unit test |
| Landscape mode handling | ⚠️ | No unit test |

---

## Settings Modal

| Feature | Status | Notes |
|---------|--------|-------|
| Settings button visible in header | ✅ | `settings.spec.ts` E2E, `gallery.spec.ts` E2E |
| Settings dialog opens | ✅ | `settings.spec.ts` E2E |
| Settings dialog closes via close button | ✅ | `settings.spec.ts` E2E |
| Settings dialog closes via Escape | ✅ | `settings.spec.ts` E2E |
| Tabs: Security / Passkeys / Library / Tags / System / About | ⚠️ | Tabs render; only Passkeys tab fully unit-tested |
| Security tab: password change | ✅ | `SettingsModal.test.ts` |
| Security tab: sign out | ✅ | `auth.spec.ts` E2E |
| Passkeys tab: list passkeys | ✅ | `SettingsModal.test.ts` unit |
| Passkeys tab: empty state | ✅ | `SettingsModal.test.ts` unit |
| Passkeys tab: no re-fetch on tab switch | ✅ | `SettingsModal.test.ts` unit |
| Passkeys tab: add passkey (name validation) | ✅ | `SettingsModal.test.ts` unit |
| Passkeys tab: loading state | ✅ | `SettingsModal.test.ts` unit |
| Passkeys tab: delete passkey | ⚠️ | No unit test |
| Library tab: clock on/off | ✅ | `SettingsModal.library.test.ts` |
| Library tab: 12/24h clock format | ✅ | `SettingsModal.library.test.ts` |
| Library tab: default sort field | ✅ | `SettingsModal.library.test.ts` |
| Library tab: default sort order | ✅ | `SettingsModal.library.test.ts` |
| Library tab: media autoplay | ✅ | `SettingsModal.library.test.ts` |
| Library tab: media loop | ✅ | `SettingsModal.library.test.ts` |
| Tags tab: list all tags | ✅ | `SettingsModal.tags.test.ts` |
| Tags tab: rename tag | ✅ | `SettingsModal.tags-actions.test.ts` |
| Tags tab: delete tag | ✅ | `SettingsModal.tags-actions.test.ts` |
| Tags tab: filter tags by name | ✅ | `SettingsModal.tags.test.ts` |
| System tab: worker status (indexer / thumbnails / autotagger) | ✅ | `SettingsModal.system.test.ts` |
| System tab: library stats (file counts, cache sizes) | ✅ | `SettingsModal.system.test.ts` |
| System tab: rebuild thumbnail cache | ✅ | `SettingsModal.system.test.ts` |
| System tab: clear transcode cache | ✅ | `SettingsModal.system.test.ts` |
| About tab: version and build info | ✅ | `SettingsModal.about.test.ts` |
| About tab: library statistics | ✅ | `SettingsModal.about.test.ts` |
| Password visibility toggle (show/hide password) | ✅ | `SettingsPasswordToggle.test.ts` unit |

---

## Selection Mode

| Feature | Status | Notes |
|---------|--------|-------|
| Enter selection mode via context menu | ✅ | `gallery.spec.ts` E2E |
| Gallery item shows selected state (`.selected`) | ✅ | `gallery.spec.ts` E2E |
| Multi-select via checkboxes (mobile) | ✅ | `GalleryMultiSelectCollections.test.ts` unit |
| All selected items passed to CollectionsPanel | ✅ | `GalleryMultiSelectCollections.test.ts` unit |
| Select all (select all non-folder items) | ✅ | `gallery.test.ts` store |
| getSelectedItems returns correct set | ✅ | `gallery.test.ts` store |
| Deselect all / clear selection | ✅ | `gallery.test.ts` store |
| Exit selection mode | ✅ | `gallery.test.ts` store |
| Bulk add to collection (panel opens for all selected) | ✅ | `GalleryMultiSelectCollections.test.ts` unit |
| Bulk add to favorites | ⚠️ | No unit test |
| Bulk download | ⚠️ | No unit test |
| Bulk tag | ⚠️ | No unit test |
| Drag-select (click-drag to select region) | ❌ | Not present in new frontend |
| Favorites strip excluded from selection | ⚠️ | No unit test |

---

## Navigation & Routing

| Feature | Status | Notes |
|---------|--------|-------|
| Library route (`/`) | ✅ | `gallery.spec.ts` E2E |
| Search route (`/search`) | ✅ | `search.spec.ts` E2E |
| Collections route (`/collections`) | ✅ | `navigation.spec.ts` E2E |
| Favorites route (`/favorites`) | ✅ | `navigation.spec.ts` E2E |
| Collection detail route (`/collections/[id]`) | ✅ | `CollectionReorderThumbs.test.ts` unit |
| Playlist route (`/playlists/[name]`) | ⚠️ | Route exists; no test |
| Login route (`/login`) | ✅ | `auth.spec.ts` E2E |
| Desktop header nav: Library button | ✅ | `CollectionsNav.test.ts` unit |
| Desktop header nav: Collections button | ✅ | `CollectionsNav.test.ts` unit |
| Mobile bottom nav: Library tab | ✅ | `navigation.spec.ts` E2E |
| Mobile bottom nav: Collections tab | ✅ | `navigation.spec.ts` E2E |
| Mobile bottom nav: Search tab | ✅ | `navigation.spec.ts` E2E |
| No Favorites tab in bottom nav | ✅ | `navigation.spec.ts` E2E |
| No Albums tab in bottom nav | ✅ | `navigation.spec.ts` E2E |
| Logo button navigates to library root | ✅ | `navigation.spec.ts` E2E |
| Mobile back button (history.back) | ✅ | `backButton.test.ts` unit |
| Popstate / browser back closes overlays | ⚠️ | Partial: some overlays tested, not all |
| Scroll restoration after back-navigation | ✅ | `gallery.test.ts` store |
| PWA standalone mode: close app on exit | ⚠️ | No unit test |
| SPA fallback (unknown paths serve index.html) | ✅ | adapter-static build contract |

---

## Clock

| Feature | Status | Notes |
|---------|--------|-------|
| Display clock overlay in gallery | ⚠️ | Exists in Settings → Library; no unit test |
| Toggle clock on/off | ⚠️ | No unit test |
| 12-hour format | ⚠️ | No unit test |
| 24-hour format | ⚠️ | No unit test |
| Clock preference persisted | ⚠️ | No unit test |

---

## Session & Connectivity

| Feature | Status | Notes |
|---------|--------|-------|
| Offline detection polling | ✅ | `connectivity.test.ts` unit |
| Offline toast on connectivity loss | ✅ | `connectivity.test.ts` unit |
| No repeated offline toast on consecutive failures | ✅ | `connectivity.test.ts` unit |
| Recovery toast when back online | ✅ | `connectivity.test.ts` unit |
| `connectivity:restored` window event on recovery | ✅ | `connectivity.test.ts` unit |
| `start()` idempotent (no double-polling) | ✅ | `connectivity.test.ts` unit |
| `stop()` prevents further polls | ✅ | `connectivity.test.ts` unit |
| isOffline starts false | ✅ | `connectivity.test.ts` unit |
| No success toast on first successful poll | ✅ | `connectivity.test.ts` unit |
| Session keepalive (periodic ping) | ❌ | Not present in new frontend |
| Session expiration warning | ❌ | Not present in new frontend |
| Activity tracking (user events reset timer) | ❌ | Not present in new frontend |

---

## Toast Notifications

| Feature | Status | Notes |
|---------|--------|-------|
| Error toast renders | ✅ | `ToastContainer.test.ts` unit |
| Success toast renders | ✅ | `ToastContainer.test.ts` unit |
| Multiple toasts queued and rendered | ✅ | `ToastContainer.test.ts` unit |
| Toast store: error() | ✅ | `toast.test.ts` unit |
| Toast store: success() | ✅ | `toast.test.ts` unit |

---

## Format Utilities

| Feature | Status | Notes |
|---------|--------|-------|
| `formatBytes`: 0 bytes | ✅ | `format.test.ts` unit |
| `formatBytes`: kilobytes | ✅ | `format.test.ts` unit |
| `formatBytes`: megabytes | ✅ | `format.test.ts` unit |
| `formatBytes`: fractional values | ✅ | `format.test.ts` unit |
| `formatDuration`: seconds only | ✅ | `format.test.ts` unit |
| `formatDuration`: minutes and seconds | ✅ | `format.test.ts` unit |
| `formatDuration`: hours | ✅ | `format.test.ts` unit |

---

## PWA & Platform Features

| Feature | Status | Notes |
|---------|--------|-------|
| Installable PWA (manifest, service worker) | ⚠️ | No unit test |
| Standalone mode detection | ⚠️ | No unit test |
| Wake lock (screen stays on while viewing) | ⚠️ | No unit test |
| `pwa.md` feature documentation | ✅ | Docs exist |

---

## Path & URL Encoding

| Feature | Status | Notes |
|---------|--------|-------|
| Spaces in filenames and directory names | ⚠️ | No dedicated unit test; handled by API client |
| Ampersand, equals, hash encoding | ⚠️ | No dedicated unit test |
| Literal percent (`%XX`) in filenames | ⚠️ | No dedicated unit test |
| CJK and Unicode characters | ⚠️ | No dedicated unit test |
| Round-trip encode/decode | ⚠️ | No dedicated unit test |
| URL path used in gallery navigation | ✅ | `gallery.test.ts` store (path param) |

---

## Accessibility

| Feature | Status | Notes |
|---------|--------|-------|
| Type filter: `role="group"` with accessible label | ✅ | `gallery-filter.spec.ts` E2E |
| Filter chips: `aria-pressed` | ✅ | `gallery-filter.spec.ts` E2E |
| Settings dialog: `role="dialog"` | ✅ | `settings.spec.ts` E2E |
| Lightbox: `role="dialog"` with item-name label | ✅ | `Lightbox.test.ts` unit |
| Tag chips: remove button accessible name | ✅ | `TagEditor.test.ts` unit |
| Collections panel: close button accessible | ✅ | `CollectionsPanel.test.ts` unit |
| Collections toggle: `aria-pressed` | ✅ | `Lightbox.test.ts` unit |
| Focus trap in modals | ⚠️ | No unit test |
| Escape key closes all dialogs | ✅ | Covered across multiple tests |

---

## Visual Regression

| Feature | Status | Notes |
|---------|--------|-------|
| Gallery page desktop screenshot | ✅ | `visual-regression.spec.ts` |
| Gallery toolbar screenshot | ✅ | `visual-regression.spec.ts` |
| Gallery page mobile screenshot | ✅ | `visual-regression.spec.ts` |
| Mobile bottom nav screenshot | ✅ | `visual-regression.spec.ts` |
| Desktop header screenshot | ✅ | `visual-regression.spec.ts` |
| Search empty state screenshot | ✅ | `visual-regression.spec.ts` |
| Search suggestions screenshot | ✅ | `visual-regression.spec.ts` |
| Favorites page screenshot | ✅ | `visual-regression.spec.ts` |
| Collections page screenshot | ✅ | `visual-regression.spec.ts` |
| Settings modal — account tab screenshot | ✅ | `visual-regression.spec.ts` |
| Settings modal — tags tab screenshot | ✅ | `visual-regression.spec.ts` |
| Login page screenshot | ✅ | `visual-regression.spec.ts` |
| Baseline refresh needed after nav changes | ⚠️ | `bottom-nav-mobile.png`, `header-desktop.png` stale |

---

## New in SvelteKit Frontend

Features introduced during the rewrite with no equivalent in the legacy vanilla-JS suite.

| Feature | Test Coverage |
|---------|--------------|
| SvelteKit file-based routing (SPA, adapter-static) | E2E navigation tests |
| Svelte 5 runes (`$state`, `$derived`, `$effect`) | All unit tests |
| Gallery path cache with scroll-position restore | `gallery.test.ts` store |
| `stableGroupedSort` collection ordering algorithm | `collectionSort.test.ts` (9 cases) |
| `applyCollectionOrdering()` async post-navigate sort | `galleryCollectionOrdering.test.ts` |
| Connectivity store (offline / recovery polling) | `connectivity.test.ts` |
| Lightbox collections panel (inline, not a drawer) | `Lightbox.test.ts` |
| CollectionsPanel sheet component | `CollectionsPanel.test.ts` |
| TagEditorRecents (recent tags chips above input) | `TagEditorRecents.test.ts` |
| Tag filter chip on search page | `SearchTagFilter.test.ts` |
| SettingsPasswordToggle component | `SettingsPasswordToggle.test.ts` |
| `backButton` utility (mobile history.back) | `backButton.test.ts` |
| Pull-to-refresh gesture utility | `pullToRefresh.test.ts` |
| Visual regression test suite (Playwright screenshots) | `visual-regression.spec.ts` (12 cases) |

---

## Summary Counts

| Category | Legacy suite | New suite |
|----------|-------------|-----------|
| Unit test files | 23 (unit) + 21 (integration) | 29 |
| E2E test files | 0 | 10 |
| Total test files | 44 | 39 |
| Estimated test cases | ~600+ | 288 unit + ~80 E2E |

### Features by parity status

| Status | Count (approx.) |
|--------|----------------|
| ✅ Full coverage | ~110 |
| ⚠️ Partial / no unit test | ~80 |
| ❌ Not present in new frontend | ~5 |
| 🆕 New in SvelteKit | ~14 |

### Largest coverage gaps

1. **Video player** — play/pause, volume, seek, HLS, fullscreen: no unit tests
2. **Playlists** — entire route has zero test coverage
3. **Settings tabs** — Library, Tags, System, About: no unit tests beyond Passkeys
4. **Lightbox actions** — zoom, swipe, tags panel, download, wake lock: no unit tests
5. **Session management** — keepalive, expiry warning, activity tracking: not ported
6. **Tag clipboard** — copy/paste confirm flow: no unit test
7. **Per-folder sort persistence** — legacy used localStorage per path; new uses session-level state only
