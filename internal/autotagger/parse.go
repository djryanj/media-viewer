package autotagger

import (
	"strings"
	"unicode/utf8"
)

// parseTagsFromDescription extracts auto-tag names from an EXIF/XMP description
// string.  It uses two detection paths:
//
// Primary path — explicit tags: marker (case-insensitive):
//
//	"tags:<name1>, <name2>, <name3>;"
//
// The function finds the first "tags:" prefix, reads a comma-separated list,
// and stops at the first semicolon.  If no semicolon is present the rest of
// the string is consumed.  Each token is whitespace-trimmed; empty tokens are
// skipped, so tag names may contain spaces.
//
// Extended path — plain comma-separated keyword list (IPTC/XMP):
//
// When no "tags:" marker is found the value is tested against
// looksLikeKeywordList.  If it passes, the comma-separated tokens are returned
// directly as tags.  This allows photos tagged in Lightroom, digiKam, Apple
// Photos, or any tool that writes IPTC Keywords / XMP Subject to be auto-tagged
// without requiring the "tags:" encoding.
//
// Examples:
//
//	"tags:landscape, nature, 2024 Photos;"       → ["landscape", "nature", "2024 Photos"]
//	"tags:first tag,second,this is still a tag"  → ["first tag", "second", "this is still a tag"]
//	"Summer trip. tags: foo, bar; extra"         → ["foo", "bar"]
//	"nature, landscape"                          → ["nature", "landscape"]  (extended)
//	"Portrait, Indoor, Street Photography"       → ["Portrait", "Indoor", "Street Photography"]  (extended)
//	"no tags here"                               → nil  (no comma, no tags: prefix)
//	"A beautiful photo. Taken in 2024."          → nil  (sentence punctuation → prose)
func parseTagsFromDescription(desc string) []string {
	// --- primary path: explicit tags: marker ---
	lower := strings.ToLower(desc)
	idx := strings.Index(lower, "tags:")
	if idx >= 0 {
		rest := desc[idx+len("tags:"):]
		if semi := strings.Index(rest, ";"); semi >= 0 {
			rest = rest[:semi]
		}
		return splitKeywords(rest)
	}

	// --- extended path: plain comma-separated keyword list ---
	if looksLikeKeywordList(desc) {
		return splitKeywords(desc)
	}

	return nil
}

// splitKeywords splits a comma-separated string into trimmed, non-empty tokens.
func splitKeywords(s string) []string {
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		name := strings.TrimSpace(p)
		if name != "" {
			result = append(result, name)
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

// looksLikeKeywordList reports whether s resembles a plain comma-separated
// keyword list (e.g. IPTC Keywords or XMP Subject written by a photo editor)
// as opposed to a prose description.
//
// The check requires ALL of the following to be true:
//
//  1. Contains at least one comma — a single value with no comma is
//     indistinguishable from a short one-word description; requiring commas
//     limits false positives while still covering the common multi-keyword case.
//
//  2. No sentence-ending punctuation (. ! ?) — these characters rarely appear
//     in keyword lists but almost always appear in prose.
//
//  3. Every comma-separated token is ≤ 50 Unicode characters — longer tokens
//     are likely phrases or sentences, not keywords.
func looksLikeKeywordList(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	// Strings with an explicit tags: marker are handled by the primary path in
	// parseTagsFromDescription; the extended path must not claim them.
	if strings.Contains(strings.ToLower(s), "tags:") {
		return false
	}
	// At least one comma required (2+ keywords).
	if !strings.Contains(s, ",") {
		return false
	}
	// Sentence-ending punctuation → prose.
	if strings.ContainsAny(s, ".!?") {
		return false
	}
	// Each token must be short enough to be a keyword.
	for _, p := range strings.Split(s, ",") {
		token := strings.TrimSpace(p)
		if token == "" {
			continue
		}
		if utf8.RuneCountInString(token) > 50 {
			return false
		}
	}
	return true
}
