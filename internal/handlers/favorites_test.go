package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"media-viewer/internal/database"
)

// =============================================================================
// Mock Database for Favorites Tests
// =============================================================================

type mockFavoritesDB struct {
	favorites         map[string]database.MediaFile // path -> MediaFile
	addFavoriteErr    error
	removeFavoriteErr error
	getFavoritesErr   error
}

func newMockFavoritesDB() *mockFavoritesDB {
	return &mockFavoritesDB{
		favorites: make(map[string]database.MediaFile),
	}
}

func (m *mockFavoritesDB) AddFavorite(_ context.Context, path, name string, fileType database.FileType) error {
	if m.addFavoriteErr != nil {
		return m.addFavoriteErr
	}
	m.favorites[path] = database.MediaFile{
		Path:       path,
		Name:       name,
		Type:       fileType,
		IsFavorite: true,
	}
	return nil
}

func (m *mockFavoritesDB) RemoveFavorite(_ context.Context, path string) error {
	if m.removeFavoriteErr != nil {
		return m.removeFavoriteErr
	}
	delete(m.favorites, path)
	return nil
}

func (m *mockFavoritesDB) GetFavorites(_ context.Context) ([]database.MediaFile, error) {
	if m.getFavoritesErr != nil {
		return nil, m.getFavoritesErr
	}

	files := make([]database.MediaFile, 0, len(m.favorites))
	for _, fav := range m.favorites {
		files = append(files, fav)
	}
	return files, nil
}

func (m *mockFavoritesDB) IsFavorite(_ context.Context, path string) bool {
	_, exists := m.favorites[path]
	return exists
}

func (m *mockFavoritesDB) GetFavoriteCount(_ context.Context) int {
	return len(m.favorites)
}

// mockHandlersFavorites wraps Handlers to use mock database
type mockHandlersFavorites struct {
	db *mockFavoritesDB
}

func (h *mockHandlersFavorites) GetFavorites(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	favorites, err := h.db.GetFavorites(ctx)
	if err != nil {
		http.Error(w, "Failed to get favorites", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(favorites); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

func (h *mockHandlersFavorites) AddFavorite(w http.ResponseWriter, r *http.Request) {
	var req FavoriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	if err := h.db.AddFavorite(ctx, req.Path, req.Name, req.Type); err != nil {
		http.Error(w, "Failed to add favorite", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]bool{"success": true})
}

func (h *mockHandlersFavorites) RemoveFavorite(w http.ResponseWriter, r *http.Request) {
	var req FavoriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	if err := h.db.RemoveFavorite(ctx, req.Path); err != nil {
		http.Error(w, "Failed to remove favorite", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]bool{"success": true})
}

func (h *mockHandlersFavorites) IsFavorite(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	isFav := h.db.IsFavorite(ctx, path)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]bool{"isFavorite": isFav})
}

// =============================================================================
// GetFavorites Tests
// =============================================================================

func TestGetFavoritesMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		setupFavorites map[string]database.MediaFile
		expectedCount  int
	}{
		{
			name:           "No favorites",
			setupFavorites: map[string]database.MediaFile{},
			expectedCount:  0,
		},
		{
			name: "Single favorite",
			setupFavorites: map[string]database.MediaFile{
				"image.jpg": {Path: "image.jpg", Name: "image.jpg", Type: database.FileTypeImage, IsFavorite: true},
			},
			expectedCount: 1,
		},
		{
			name: "Multiple favorites",
			setupFavorites: map[string]database.MediaFile{
				"image1.jpg": {Path: "image1.jpg", Name: "image1.jpg", Type: database.FileTypeImage, IsFavorite: true},
				"video.mp4":  {Path: "video.mp4", Name: "video.mp4", Type: database.FileTypeVideo, IsFavorite: true},
			},
			expectedCount: 2,
		},
		{
			name: "Favorite folder",
			setupFavorites: map[string]database.MediaFile{
				"photos": {Path: "photos", Name: "photos", Type: database.FileTypeFolder, IsFavorite: true},
			},
			expectedCount: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			mockDB := newMockFavoritesDB()
			mockDB.favorites = tt.setupFavorites

			h := &mockHandlersFavorites{db: mockDB}

			req := httptest.NewRequest(http.MethodGet, "/api/favorites", http.NoBody)
			w := httptest.NewRecorder()

			h.GetFavorites(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
			}

			var favorites []database.MediaFile
			if err := json.NewDecoder(w.Body).Decode(&favorites); err != nil {
				t.Fatalf("Failed to decode response: %v", err)
			}

			if len(favorites) != tt.expectedCount {
				t.Errorf("Expected %d favorites, got %d", tt.expectedCount, len(favorites))
			}

			// Verify content type
			contentType := w.Header().Get("Content-Type")
			if contentType != "application/json" {
				t.Errorf("Expected Content-Type application/json, got %s", contentType)
			}
		})
	}
}

func TestGetFavoritesReturnsEmptyArrayNotNullMock(t *testing.T) {
	t.Parallel()

	mockDB := newMockFavoritesDB()
	h := &mockHandlersFavorites{db: mockDB}

	req := httptest.NewRequest(http.MethodGet, "/api/favorites", http.NoBody)
	w := httptest.NewRecorder()

	h.GetFavorites(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	// Verify response is an empty array, not null
	body := strings.TrimSpace(w.Body.String())
	if body != "[]" {
		t.Errorf("Expected empty array '[]', got %s", body)
	}
}

func TestGetFavoritesIncludesFileMetadataMock(t *testing.T) {
	t.Parallel()

	mockDB := newMockFavoritesDB()
	mockDB.favorites["photos/test-image.jpg"] = database.MediaFile{
		Path:       "photos/test-image.jpg",
		Name:       "test-image.jpg",
		Type:       database.FileTypeImage,
		IsFavorite: true,
	}

	h := &mockHandlersFavorites{db: mockDB}

	req := httptest.NewRequest(http.MethodGet, "/api/favorites", http.NoBody)
	w := httptest.NewRecorder()

	h.GetFavorites(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var favorites []database.MediaFile
	if err := json.NewDecoder(w.Body).Decode(&favorites); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if len(favorites) != 1 {
		t.Fatalf("Expected 1 favorite, got %d", len(favorites))
	}

	fav := favorites[0]
	if fav.Name != "test-image.jpg" {
		t.Errorf("Expected name test-image.jpg, got %s", fav.Name)
	}
	if fav.Path != "photos/test-image.jpg" {
		t.Errorf("Expected path photos/test-image.jpg, got %s", fav.Path)
	}
	if fav.Type != database.FileTypeImage {
		t.Errorf("Expected type image, got %s", fav.Type)
	}
	if !fav.IsFavorite {
		t.Error("Expected IsFavorite=true")
	}
}

// =============================================================================
// AddFavorite Tests
// =============================================================================

func TestAddFavoriteMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		request        FavoriteRequest
		expectedStatus int
		shouldBeFav    bool
	}{
		{
			name: "Valid image favorite",
			request: FavoriteRequest{
				Path: "photos/image.jpg",
				Name: "image.jpg",
				Type: database.FileTypeImage,
			},
			expectedStatus: http.StatusOK,
			shouldBeFav:    true,
		},
		{
			name: "Valid video favorite",
			request: FavoriteRequest{
				Path: "videos/movie.mp4",
				Name: "movie.mp4",
				Type: database.FileTypeVideo,
			},
			expectedStatus: http.StatusOK,
			shouldBeFav:    true,
		},
		{
			name: "Valid folder favorite",
			request: FavoriteRequest{
				Path: "photos/vacation",
				Name: "vacation",
				Type: database.FileTypeFolder,
			},
			expectedStatus: http.StatusOK,
			shouldBeFav:    true,
		},
		{
			name: "Empty path",
			request: FavoriteRequest{
				Path: "",
				Name: "image.jpg",
				Type: database.FileTypeImage,
			},
			expectedStatus: http.StatusBadRequest,
			shouldBeFav:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			mockDB := newMockFavoritesDB()
			h := &mockHandlersFavorites{db: mockDB}

			body, _ := json.Marshal(tt.request)
			req := httptest.NewRequest(http.MethodPost, "/api/favorites", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.AddFavorite(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			if tt.shouldBeFav {
				// Verify favorite was added
				ctx := context.Background()
				if !mockDB.IsFavorite(ctx, tt.request.Path) {
					t.Error("Expected path to be a favorite")
				}
			}
		})
	}
}

func TestAddFavoriteInvalidJSONMock(t *testing.T) {
	t.Parallel()

	mockDB := newMockFavoritesDB()
	h := &mockHandlersFavorites{db: mockDB}

	req := httptest.NewRequest(http.MethodPost, "/api/favorites", strings.NewReader("invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.AddFavorite(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}
}

func TestAddFavoriteIdempotentMock(t *testing.T) {
	t.Parallel()

	mockDB := newMockFavoritesDB()
	h := &mockHandlersFavorites{db: mockDB}

	request := FavoriteRequest{
		Path: "photos/image.jpg",
		Name: "image.jpg",
		Type: database.FileTypeImage,
	}

	// Add favorite twice
	for i := 0; i < 2; i++ {
		body, _ := json.Marshal(request)
		req := httptest.NewRequest(http.MethodPost, "/api/favorites", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		h.AddFavorite(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Attempt %d: Expected status %d, got %d", i+1, http.StatusOK, w.Code)
		}
	}

	// Verify only one favorite exists (map overwrites)
	ctx := context.Background()
	count := mockDB.GetFavoriteCount(ctx)
	if count != 1 {
		t.Errorf("Expected 1 favorite after duplicate adds, got %d", count)
	}
}

func TestAddFavoriteWithSpecialCharactersMock(t *testing.T) {
	t.Parallel()

	specialPaths := []string{
		"photos/image with spaces.jpg",
		"photos/image'quote.jpg",
		"photos/image\"doublequote.jpg",
		"photos/图片.jpg",
		"photos/изображение.jpg",
		"photos/image<>special.jpg",
	}

	for _, path := range specialPaths {
		t.Run("Path: "+path, func(t *testing.T) {
			t.Parallel()

			mockDB := newMockFavoritesDB()
			h := &mockHandlersFavorites{db: mockDB}

			request := FavoriteRequest{
				Path: path,
				Name: "test.jpg",
				Type: database.FileTypeImage,
			}

			body, _ := json.Marshal(request)
			req := httptest.NewRequest(http.MethodPost, "/api/favorites", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.AddFavorite(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("Expected status %d, got %d for path %s", http.StatusOK, w.Code, path)
			}

			// Verify favorite was added
			ctx := context.Background()
			if !mockDB.IsFavorite(ctx, path) {
				t.Errorf("Expected path %s to be a favorite", path)
			}
		})
	}
}

// =============================================================================
// RemoveFavorite Tests
// =============================================================================

func TestRemoveFavoriteMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		setupPath      string
		removePath     string
		expectedStatus int
		shouldExist    bool
	}{
		{
			name:           "Remove existing favorite",
			setupPath:      "photos/image.jpg",
			removePath:     "photos/image.jpg",
			expectedStatus: http.StatusOK,
			shouldExist:    false,
		},
		{
			name:           "Remove non-existent favorite (idempotent)",
			setupPath:      "",
			removePath:     "photos/image.jpg",
			expectedStatus: http.StatusOK,
			shouldExist:    false,
		},
		{
			name:           "Empty path",
			setupPath:      "photos/image.jpg",
			removePath:     "",
			expectedStatus: http.StatusBadRequest,
			shouldExist:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			mockDB := newMockFavoritesDB()
			if tt.setupPath != "" {
				ctx := context.Background()
				_ = mockDB.AddFavorite(ctx, tt.setupPath, "image.jpg", database.FileTypeImage)
			}

			h := &mockHandlersFavorites{db: mockDB}

			request := FavoriteRequest{Path: tt.removePath}
			body, _ := json.Marshal(request)
			req := httptest.NewRequest(http.MethodDelete, "/api/favorites", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.RemoveFavorite(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			if tt.expectedStatus == http.StatusOK && tt.setupPath != "" {
				ctx := context.Background()
				exists := mockDB.IsFavorite(ctx, tt.setupPath)
				if exists != tt.shouldExist {
					t.Errorf("Expected favorite existence=%v, got %v", tt.shouldExist, exists)
				}
			}
		})
	}
}

func TestRemoveFavoriteInvalidJSONMock(t *testing.T) {
	t.Parallel()

	mockDB := newMockFavoritesDB()
	h := &mockHandlersFavorites{db: mockDB}

	req := httptest.NewRequest(http.MethodDelete, "/api/favorites", strings.NewReader("invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.RemoveFavorite(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}
}

// =============================================================================
// IsFavorite Tests
// =============================================================================

func TestIsFavoriteMock(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		setupPath      string
		queryPath      string
		expectedStatus int
		expectedFav    bool
	}{
		{
			name:           "Existing favorite",
			setupPath:      "photos/image.jpg",
			queryPath:      "photos/image.jpg",
			expectedStatus: http.StatusOK,
			expectedFav:    true,
		},
		{
			name:           "Non-existent favorite",
			setupPath:      "",
			queryPath:      "photos/image.jpg",
			expectedStatus: http.StatusOK,
			expectedFav:    false,
		},
		{
			name:           "Empty path",
			setupPath:      "photos/image.jpg",
			queryPath:      "",
			expectedStatus: http.StatusBadRequest,
			expectedFav:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			mockDB := newMockFavoritesDB()
			if tt.setupPath != "" {
				ctx := context.Background()
				_ = mockDB.AddFavorite(ctx, tt.setupPath, "image.jpg", database.FileTypeImage)
			}

			h := &mockHandlersFavorites{db: mockDB}

			req := httptest.NewRequest(http.MethodGet, "/api/favorites/is-favorite?path="+tt.queryPath, http.NoBody)
			w := httptest.NewRecorder()

			h.IsFavorite(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, w.Code)
			}

			if tt.expectedStatus == http.StatusOK {
				var response map[string]bool
				if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
					t.Fatalf("Failed to decode response: %v", err)
				}

				if response["isFavorite"] != tt.expectedFav {
					t.Errorf("Expected isFavorite=%v, got %v", tt.expectedFav, response["isFavorite"])
				}
			}
		})
	}
}

// =============================================================================
// Error Handling Tests
// =============================================================================

func TestGetFavoritesErrorHandlingMock(t *testing.T) {
	t.Parallel()

	mockDB := newMockFavoritesDB()
	mockDB.getFavoritesErr = context.DeadlineExceeded

	h := &mockHandlersFavorites{db: mockDB}

	req := httptest.NewRequest(http.MethodGet, "/api/favorites", http.NoBody)
	w := httptest.NewRecorder()

	h.GetFavorites(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("Expected status %d, got %d", http.StatusInternalServerError, w.Code)
	}
}

func TestAddFavoriteErrorHandlingMock(t *testing.T) {
	t.Parallel()

	mockDB := newMockFavoritesDB()
	mockDB.addFavoriteErr = context.DeadlineExceeded

	h := &mockHandlersFavorites{db: mockDB}

	request := FavoriteRequest{
		Path: "photos/image.jpg",
		Name: "image.jpg",
		Type: database.FileTypeImage,
	}

	body, _ := json.Marshal(request)
	req := httptest.NewRequest(http.MethodPost, "/api/favorites", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.AddFavorite(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("Expected status %d, got %d", http.StatusInternalServerError, w.Code)
	}
}

func TestRemoveFavoriteErrorHandlingMock(t *testing.T) {
	t.Parallel()

	mockDB := newMockFavoritesDB()
	mockDB.removeFavoriteErr = context.DeadlineExceeded

	h := &mockHandlersFavorites{db: mockDB}

	request := FavoriteRequest{Path: "photos/image.jpg"}
	body, _ := json.Marshal(request)
	req := httptest.NewRequest(http.MethodDelete, "/api/favorites", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.RemoveFavorite(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("Expected status %d, got %d", http.StatusInternalServerError, w.Code)
	}
}
