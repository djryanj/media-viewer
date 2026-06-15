// API types — mirrors internal/database/models.go JSON tags exactly

export type FileType = 'image' | 'video' | 'folder' | 'playlist' | 'other';

export interface MediaFile {
    id: number;
    name: string;
    path: string;
    parentPath: string;
    type: FileType;
    size: number;
    modTime: string; // ISO 8601
    mimeType?: string;
    thumbnailUrl?: string;
    itemCount?: number;
    isFavorite?: boolean;
    tags?: string[];
}

export interface Tag {
    id: number;
    name: string;
    color?: string;
    itemCount: number;
    createdAt: string;
}

export interface RelatedTagSuggestion {
    name: string;
    itemCount: number;
    relatedCount: number;
}

export interface Favorite {
    id: number;
    path: string;
    name: string;
    type: FileType;
    createdAt: string;
}

export interface PathPart {
    name: string;
    path: string;
}

export interface DirectoryListing {
    path: string;
    name: string;
    parent?: string;
    breadcrumb: PathPart[];
    items: MediaFile[];
    favorites?: MediaFile[];
    totalItems: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

export interface MediaFilesPage {
    items: MediaFile[];
    total: number;
    offset: number;
    limit: number;
}

export interface Collection {
    id: number;
    name: string;
    folderPath?: string;
    coverPath?: string;
    itemCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface CollectionDetail extends Collection {
    items: MediaFile[];
}

export interface SearchResult {
    items: MediaFile[];
    query: string;
    totalItems: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

export interface SearchSuggestion {
    path: string;
    name: string;
    type: string;
    highlight: string;
    itemCount?: number;
}

export interface IndexStats {
    totalFiles: number;
    totalFolders: number;
    totalImages: number;
    totalVideos: number;
    totalPlaylists: number;
    totalFavorites: number;
    totalTags: number;
    thumbnailCacheBytes: number;
    thumbnailCacheFiles: number;
    transcodeCacheBytes: number;
    transcodeCacheFiles: number;
    lastIndexed: string;
}

// Request shapes

export interface FavoriteRequest {
    path: string;
    name: string;
    type: FileType;
}

export interface BulkFavoriteItem {
    path: string;
    name: string;
    type: FileType;
}

export interface TagRequest {
    path: string;
    tag?: string;
    tags?: string[];
    newName?: string;
    color?: string;
}

export interface BulkTagRequest {
    paths: string[];
    tag?: string;
    tags?: string[];
}

// ─── Directory summary (scrubber labels) ───────────────────────────────────

export interface SummaryGroup {
    label: string;
    offset: number;
    count: number;
}

export interface DirectorySummary {
    sort: string;
    order: string;
    total: number;
    groups: SummaryGroup[];
}

// ─── Version / build info ───────────────────────────────────────────────────

export interface BuildInfo {
    version: string;
    commit: string;
    buildTime: string;
    goVersion: string;
    os: string;
    arch: string;
}

// ─── Playlists ────────────────────────────────────────────────────────────────

export interface PlaylistItem {
    name: string;
    path: string;
    origPath?: string;
    exists: boolean;
    mediaType?: 'video' | 'audio' | 'unknown';
}

export interface Playlist {
    name: string;
    path: string;
    items: PlaylistItem[];
}

// ─── System status ───────────────────────────────────────────────────────────

export interface WorkerSummary {
    enabled: boolean;
    running: boolean;
    state: string;
}

export interface SystemWorkerStatus {
    summary: WorkerSummary;
    metrics: {
        processedItems: number;
        totalItems?: number;
        progressPercent?: number;
        itemsPerSecond?: number;
        estimatedSecondsRemaining?: number;
    };
}

export interface SystemStatus {
    updatedAt: string;
    library: IndexStats;
    indexer: SystemWorkerStatus;
    thumbnails: SystemWorkerStatus;
    autotagger: SystemWorkerStatus;
}
