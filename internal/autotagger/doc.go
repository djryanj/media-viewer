// Package autotagger implements server-side automatic tag application for media
// files based on embedded EXIF/XMP metadata.
//
// When a media file's description or comment field contains a `tags:<csv>;`
// substring the comma-separated tag names are extracted and merged into the
// file's tag set in the database.  Merging is purely additive: existing tags
// are never removed, and when an EXIF-provided tag matches an existing tag
// case-insensitively the existing tag's canonical spelling is preserved.
//
// # Tag Format
//
// The tag string is read from the first `tags:` occurrence in the EXIF/XMP
// description (or comment) field.  The tag list must be terminated by a
// semicolon:
//
//	tags:<name1>, <name2>, …;
//
// The prefix is case-insensitive.  Leading/trailing whitespace around each
// name is trimmed.  Empty tokens are silently skipped.  Any text before the
// `tags:` prefix or after the closing `;` is ignored.
//
// # Metadata Extraction
//
// Metadata is extracted via ffprobe, which is already required by the
// transcoder sub-system.  This avoids adding a new Go dependency and provides
// broad format support including JPEG/PNG/TIFF/HEIC EXIF and GIF XMP
// Application Extensions.
//
// # Scheduling
//
// AutoTagger mirrors the ThumbnailGenerator scheduling model:
//   - On creation a buffered channel is wired to the indexer's
//     onIndexComplete callback via [AutoTagger.NotifyIndexComplete].
//   - After each index run an incremental pass processes only files whose
//     content_updated_at timestamp is newer than the previous run, recorded
//     under the "last_exif_tag_run" metadata key.
//   - A periodic full pass runs on a configurable interval (default 24 h).
//
// # Configuration
//
// Two environment variables control the behavior:
//
//	EXIF_TAG_INTERVAL    interval between periodic passes (default "24h")
//	EXIF_TAGGING_ENABLED enable or disable the auto-tagger (default "true")
package autotagger
