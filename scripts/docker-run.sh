#!/bin/bash

# Docker run script for Sourcify Grabber
# Usage: ./scripts/docker-run.sh [CLI_ARGS]

set -e

# Build the Docker image if it doesn't exist
if ! docker image inspect sourcify-grabber:latest >/dev/null 2>&1; then
    echo "🐳 Building Docker image..."
    docker build -t sourcify-grabber .
fi

# Create data directory on host if it doesn't exist
mkdir -p "$(pwd)/docker-data"

# Run the container with volume mapping
echo "🚀 Running Sourcify Grabber in Docker..."
docker run --rm \
    -v "$(pwd)/docker-data:/app/data" \
    -v "$(pwd)/docker-data:/app/exports" \
    -v "$(pwd)/docker-data:/app/logs" \
    -v "$(pwd)/docker-data:/app/cache" \
    sourcify-grabber "$@"