# PowerShell script to start the monitoring stack and verify setup

$ErrorActionPreference = "Stop"

# Change to script directory
Set-Location $PSScriptRoot

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Media Viewer Monitoring Stack" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
Write-Host "Checking Docker..." -NoNewline
try {
    docker info | Out-Null
    Write-Host " ✓ Docker is running" -ForegroundColor Green
}
catch {
    Write-Host " ✗" -ForegroundColor Red
    Write-Host "Error: Docker is not running" -ForegroundColor Red
    Write-Host "Please start Docker Desktop and try again"
    exit 1
}
Write-Host ""

# Build and start containers
Write-Host "Starting containers..." -ForegroundColor Yellow
docker-compose up -d

Write-Host ""
Write-Host "Waiting for services to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Check service health
Write-Host ""
Write-Host "Checking service health:" -ForegroundColor Cyan
Write-Host ""

# Media Viewer
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8081/readyz" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    Write-Host "  ✓ Media Viewer is ready (http://localhost:8081)" -ForegroundColor Green
}
catch {
    Write-Host "  ⚠ Media Viewer is starting..." -ForegroundColor Yellow
    Write-Host "    Check logs with: docker-compose logs media-viewer" -ForegroundColor DarkGray
}

# Prometheus
try {
    $response = Invoke-WebRequest -Uri "http://localhost:9091/-/healthy" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    Write-Host "  ✓ Prometheus is ready (http://localhost:9091)" -ForegroundColor Green
}
catch {
    Write-Host "  ⚠ Prometheus is starting..." -ForegroundColor Yellow
}

# Grafana
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    Write-Host "  ✓ Grafana is ready (http://localhost:3001)" -ForegroundColor Green
    Write-Host "    Login: admin / admin" -ForegroundColor DarkGray
}
catch {
    Write-Host "  ⚠ Grafana is starting..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Access your services:" -ForegroundColor White
Write-Host "  • Media Viewer:  http://localhost:8081" -ForegroundColor White
Write-Host "  • Prometheus:    http://localhost:9091" -ForegroundColor White
Write-Host "  • Grafana:       http://localhost:3001 (admin/admin)" -ForegroundColor White
Write-Host ""
Write-Host "To see logs:" -ForegroundColor Yellow
Write-Host "  docker-compose logs -f media-viewer" -ForegroundColor Gray
Write-Host ""
Write-Host "To stop:" -ForegroundColor Yellow
Write-Host "  docker-compose down" -ForegroundColor Gray
Write-Host ""
Write-Host "To test GC performance:" -ForegroundColor Yellow
Write-Host "  1. Add media files to generate load" -ForegroundColor Gray
Write-Host "  2. Monitor GC metrics in Grafana" -ForegroundColor Gray
Write-Host "  3. Edit GOGC in docker-compose.yml" -ForegroundColor Gray
Write-Host "  4. Run: docker-compose restart media-viewer" -ForegroundColor Gray
Write-Host ""
