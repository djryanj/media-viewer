#!/bin/bash
# Generate load for testing GC performance
# Targets the main API server's public health check endpoints

set -e

BASE_URL="${BASE_URL:-http://localhost:8081}"
DURATION="${DURATION:-300}"  # 5 minutes default

echo "=================================="
echo "Media Viewer Load Generator"
echo "=================================="
echo ""
echo "Target: $BASE_URL"
echo "Duration: $DURATION seconds"
echo ""

# Check if server is reachable
if ! curl -sf "$BASE_URL/readyz" > /dev/null 2>&1; then
    echo "❌ Error: Media Viewer is not reachable at $BASE_URL"
    echo "Make sure docker-compose is running and the server is on port 8081"
    exit 1
fi

echo "✓ Server is reachable"
echo ""

echo "Starting load generation..."
echo "Endpoints: /readyz, /healthz (public health checks)"
echo "Watch metrics at: http://localhost:3000"
echo ""

END_TIME=$(($(date +%s) + DURATION))

request_count=0
success_count=0
error_count=0

# Define endpoints to hit
ENDPOINTS="/readyz /healthz"

while [ $(date +%s) -lt $END_TIME ]; do
    # Hit each endpoint
    for endpoint in $ENDPOINTS; do
        if curl -sf "$BASE_URL$endpoint" > /dev/null 2>&1; then
            ((success_count++))
        else
            ((error_count++))
        fi
        ((request_count++))
    done

    # Show progress every 20 requests
    if [ $((request_count % 20)) -eq 0 ]; then
        elapsed=$(($(date +%s) - END_TIME + DURATION))
        remaining=$((DURATION - elapsed))
        success_rate=$((success_count * 100 / request_count))

        echo "Progress: ${request_count} requests (${success_rate}% success) - ${remaining}s remaining"
    fi

    # Small delay to not overwhelm the server
    sleep 0.1
done

echo ""
echo "=================================="
echo "Load Test Complete"
echo "=================================="
echo ""
echo "Total Requests: $request_count"
echo "Successful:     $success_count"
echo "Errors:         $error_count"
echo ""
echo "Check Grafana dashboard for GC metrics:"
echo "http://localhost:3000"
echo ""
