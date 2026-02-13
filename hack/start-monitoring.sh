#!/bin/bash
# Script to start the monitoring stack and verify setup

set -e

cd "$(dirname "$0")"

echo "=================================="
echo "Media Viewer Monitoring Stack"
echo "=================================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running"
    echo "Please start Docker and try again"
    exit 1
fi

echo "✓ Docker is running"
echo ""

# Build and start containers
echo "Starting containers..."
docker-compose up -d

echo ""
echo "Waiting for services to be ready..."
sleep 5

# Check service health
echo ""
echo "Checking service health:"
echo ""

# Media Viewer
if curl -sf http://localhost:8081/readyz > /dev/null 2>&1; then
    echo "✓ Media Viewer is ready (http://localhost:8081)"
else
    echo "⚠  Media Viewer is starting... (check logs with: docker-compose logs media-viewer)"
fi

# Prometheus
if curl -sf http://localhost:9091/-/healthy > /dev/null 2>&1; then
    echo "✓ Prometheus is ready (http://localhost:9091)"
else
    echo "⚠  Prometheus is starting..."
fi

# Grafana
if curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "✓ Grafana is ready (http://localhost:3001)"
    echo "  Login: admin / admin"
else
    echo "⚠  Grafana is starting..."
fi

echo ""
echo "=================================="
echo "Setup Complete!"
echo "=================================="
echo ""
echo "Access your services:"
echo "  • Media Viewer:  http://localhost:8081"
echo "  • Prometheus:    http://localhost:9091"
echo "  • Grafana:       http://localhost:3001 (admin/admin)"
echo ""
echo "To see logs:"
echo "  docker-compose logs -f media-viewer"
echo ""
echo "To stop:"
echo "  docker-compose down"
echo ""
echo "To test GC performance:"
echo "  1. Add media files to generate load"
echo "  2. Monitor GC metrics in Grafana"
echo "  3. Edit GOGC in docker-compose.yml"
echo "  4. Run: docker-compose restart media-viewer"
echo ""
