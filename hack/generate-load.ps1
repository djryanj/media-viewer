# PowerShell script to generate load for testing GC performance
# Targets the main API server's public health check endpoints

param(
    [string]$BaseUrl = "http://localhost:8081",
    [int]$Duration = 300  # 5 minutes default
)

$ErrorActionPreference = "Continue"

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Media Viewer Load Generator" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Target:   $BaseUrl" -ForegroundColor White
Write-Host "Duration: $Duration seconds" -ForegroundColor White
Write-Host ""

# Check if server is reachable
Write-Host "Checking server..." -NoNewline
try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/readyz" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    Write-Host " ✓ Server is reachable" -ForegroundColor Green
}
catch {
    Write-Host " ✗" -ForegroundColor Red
    Write-Host "Error: Media Viewer is not reachable at $BaseUrl" -ForegroundColor Red
    Write-Host "Make sure docker-compose is running and the server is on port 8081" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

Write-Host "Starting load generation..." -ForegroundColor Yellow
Write-Host "Endpoints: /readyz, /healthz (public health checks)" -ForegroundColor Gray
Write-Host "Watch metrics at: http://localhost:3001" -ForegroundColor Cyan
Write-Host ""

$endTime = (Get-Date).AddSeconds($Duration)
$requestCount = 0
$successCount = 0
$errorCount = 0

# Define endpoints to hit
$endpoints = @("/readyz", "/healthz")

while ((Get-Date) -lt $endTime) {
    # Hit each endpoint
    foreach ($endpoint in $endpoints) {
        try {
            $response = Invoke-WebRequest -Uri "$BaseUrl$endpoint" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            $successCount++
        }
        catch {
            $errorCount++
        }
        $requestCount++
    }

    # Show progress every 20 requests
    if ($requestCount % 20 -eq 0) {
        $elapsed = ((Get-Date) - $endTime.AddSeconds(-$Duration)).TotalSeconds
        $remaining = [math]::Max(0, $Duration - $elapsed)
        $successRate = [math]::Round(($successCount * 100) / $requestCount, 1)

        Write-Host "Progress: $requestCount requests ($successRate% success) - $([math]::Round($remaining))s remaining" -ForegroundColor Gray
    }

    # Small delay to not overwhelm the server
    Start-Sleep -Milliseconds 100
}

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Load Test Complete" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Total Requests: $requestCount" -ForegroundColor White
Write-Host "Successful:     $successCount" -ForegroundColor Green
Write-Host "Errors:         $errorCount" -ForegroundColor $(if ($errorCount -gt 0) { "Yellow" } else { "Green" })
Write-Host ""
Write-Host "Check Grafana dashboard for GC metrics:" -ForegroundColor Cyan
Write-Host "http://localhost:3001" -ForegroundColor White
Write-Host ""
