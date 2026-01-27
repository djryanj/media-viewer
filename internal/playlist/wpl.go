package playlist

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"strings"
)

// WPL structure based on Windows Media Player playlist format
type WPL struct {
	XMLName xml.Name `xml:"smil"`
	Head    WPLHead  `xml:"head"`
	Body    WPLBody  `xml:"body"`
}

type WPLHead struct {
	Title string    `xml:"title"`
	Meta  []WPLMeta `xml:"meta"`
}

type WPLMeta struct {
	Name    string `xml:"name,attr"`
	Content string `xml:"content,attr"`
}

type WPLBody struct {
	Seq WPLSeq `xml:"seq"`
}

type WPLSeq struct {
	Media []WPLMedia `xml:"media"`
}

type WPLMedia struct {
	Src string `xml:"src,attr"`
}

type Playlist struct {
	Name  string         `json:"name"`
	Path  string         `json:"path"`
	Items []PlaylistItem `json:"items"`
	Count int            `json:"count"`
}

type PlaylistItem struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	OrigPath string `json:"origPath"`
	Exists   bool   `json:"exists"`
}

func ParseWPL(wplPath, mediaDir string) (*Playlist, error) {
	data, err := os.ReadFile(wplPath)
	if err != nil {
		return nil, err
	}

	var wpl WPL
	if err := xml.Unmarshal(data, &wpl); err != nil {
		return nil, err
	}

	playlist := &Playlist{
		Name: wpl.Head.Title,
		Path: wplPath,
	}

	if playlist.Name == "" {
		playlist.Name = strings.TrimSuffix(filepath.Base(wplPath), filepath.Ext(wplPath))
	}

	wplDir := filepath.Dir(wplPath)

	for _, media := range wpl.Body.Seq.Media {
		// Handle Windows paths
		srcPath := strings.ReplaceAll(media.Src, "\\", "/")

		// Try to resolve the path
		var resolvedPath string
		var exists bool

		// Check if it's a relative path
		if !filepath.IsAbs(srcPath) {
			// Try relative to WPL file
			candidate := filepath.Join(wplDir, srcPath)
			if _, err := os.Stat(candidate); err == nil {
				resolvedPath, _ = filepath.Rel(mediaDir, candidate)
				exists = true
			}
		}

		// Try relative to media directory
		if !exists {
			candidate := filepath.Join(mediaDir, filepath.Base(srcPath))
			if _, err := os.Stat(candidate); err == nil {
				resolvedPath, _ = filepath.Rel(mediaDir, candidate)
				exists = true
			}
		}

		// If still not found, just use the filename
		if resolvedPath == "" {
			resolvedPath = filepath.Base(srcPath)
		}

		item := PlaylistItem{
			Name:     filepath.Base(srcPath),
			Path:     resolvedPath,
			OrigPath: media.Src,
			Exists:   exists,
		}

		playlist.Items = append(playlist.Items, item)
	}

	playlist.Count = len(playlist.Items)
	return playlist, nil
}
