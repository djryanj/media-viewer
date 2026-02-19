#!/bin/bash
# .devcontainer/post-create.sh

set -e

echo "Running post-create setup..."

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Install ffmpeg and sqlite
echo -e "${BLUE}[INFO] Installing ffmpeg and sqlite and other dependencies...${NC}"
sudo apt-get update && sudo apt-get install -y --no-install-recommends \
    ffmpeg \
    sqlite3 \
    libvips-dev \
    gcc \
    libxcomposite1 \
    libxdamage1 \
    libgtk-3-0t64 \
    libatk1.0-0t64
echo -e "${GREEN}[SUCCESS] ffmpeg and sqlite installed${NC}"

# Setup directories with correct permissions
echo -e "${BLUE}[INFO] Setting up directories...${NC}"

sudo mkdir -p /media /cache /database
sudo chown -R node:node /cache
sudo chmod -R 755 /cache
sudo chown -R node:node /database
sudo chmod -R 755 /database

if [ -d "/media" ]; then
    sudo chown -R node:node /media 2>/dev/null || true
    sudo chmod -R 755 /media 2>/dev/null || true
fi

echo -e "${GREEN}[SUCCESS] Directories configured${NC}"

# Verify write access to cache
echo -e "${BLUE}[INFO] Verifying cache directory write access...${NC}"
if touch /cache/.write-test 2>/dev/null; then
    rm /cache/.write-test
    echo -e "${GREEN}[SUCCESS] Cache directory is writable${NC}"
else
    echo -e "${YELLOW}[WARN] Cache directory is not writable - attempting fix...${NC}"
    sudo chown -R node:node /cache
    sudo chmod -R 777 /cache
    if touch /cache/.write-test 2>/dev/null; then
        rm /cache/.write-test
        echo -e "${GREEN}[SUCCESS] Cache directory fix applied${NC}"
    else
        echo -e "${YELLOW}[WARN] Could not make cache writable - app may have limited functionality${NC}"
    fi
fi

# Verify write access to database dir
echo -e "${BLUE}[INFO] Verifying database directory write access...${NC}"
if touch /database/.write-test 2>/dev/null; then
    rm /database/.write-test
    echo -e "${GREEN}[SUCCESS] database directory is writable${NC}"
else
    echo -e "${YELLOW}[WARN] database directory is not writable - attempting fix...${NC}"
    sudo chown -R node:node /database
    sudo chmod -R 777 /database
    if touch /database/.write-test 2>/dev/null; then
        rm /database/.write-test
        echo -e "${GREEN}[SUCCESS] database directory fix applied${NC}"
    else
        echo -e "${YELLOW}[WARN] Could not make database writable - app will not run${NC}"
    fi
fi

# Install Go dependencies
echo -e "${BLUE}[INFO] Installing Go dependencies...${NC}"
go mod download
go mod verify
echo -e "${GREEN}[SUCCESS] Go dependencies installed${NC}"

# Install additional Go tools
echo -e "${BLUE}[INFO] Installing additional Go tools...${NC}"
go install github.com/air-verse/air@latest
go install github.com/swaggo/swag/cmd/swag@latest
go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.10.1
echo -e "${GREEN}[SUCCESS] Go tools installed${NC}"

# Create sample-media directory if it doesn't exist
if [ ! -d "sample-media" ]; then
    echo -e "${BLUE}[INFO] Creating sample-media directory...${NC}"
    mkdir -p sample-media
    echo "# Sample Media" > sample-media/README.md
    echo "Place test images and videos here." >> sample-media/README.md
    echo -e "${GREEN}[SUCCESS] sample-media directory created${NC}"
fi

# Create air config if it doesn't exist
if [ ! -f ".air.toml" ]; then
    echo -e "${BLUE}[INFO] Creating air configuration...${NC}"
    cat > .air.toml << 'EOF'
root = "."
tmp_dir = "tmp"

[build]
  cmd = "go build -tags 'fts5' -o ./tmp/main ./cmd/media-viewer"
  bin = "./tmp/main"
  include_ext = ["go", "html", "css", "js"]
  exclude_dir = ["tmp", "sample-media", "vendor", "static/node_modules", "site", "docs"]
  delay = 1000

[misc]
  clean_on_exit = true
EOF
    echo -e "${GREEN}[SUCCESS] air configuration created${NC}"
fi

# Install npm stuff for frontend (if applicable)
if [ -f "static/package.json" ]; then
    echo -e "${BLUE}[INFO] Installing npm dependencies...${NC}"
    cd static
    npm install
    echo -e "${GREEN}[SUCCESS] npm dependencies installed${NC}"
    cd ..
fi

# Install Playwright system dependencies and browsers
if [ -f "static/playwright.config.js" ]; then
    echo -e "${BLUE}[INFO] Installing Playwright system dependencies...${NC}"
    cd static
    # Install system dependencies (requires sudo)
    sudo npx playwright install-deps
    echo -e "${GREEN}[SUCCESS] Playwright system dependencies installed${NC}"

    echo -e "${BLUE}[INFO] Installing Playwright browsers...${NC}"
    npx playwright install
    echo -e "${GREEN}[SUCCESS] Playwright browsers installed${NC}"
    cd ..
fi

# Install mkdocs requirements (if applicable)
if [ -f "requirements.txt" ]; then
    echo -e "${BLUE}[INFO] Installing mkdocs requirements...${NC}"
    pip install -r requirements.txt
    echo -e "${GREEN}[SUCCESS] mkdocs requirements installed${NC}"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Post-create setup complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  Run the app:     ${BLUE}go run -tags 'fts5' .${NC}"
echo -e "  With hot reload: ${BLUE}air${NC}"
echo -e "  Build:           ${BLUE}go build -tags 'fts5' -o media-viewer .${NC}"
echo ""
