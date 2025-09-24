#!/bin/bash

# Simple run script for Sourcify Grabber CLI
# Usage: ./scripts/run.sh [CLI_ARGS]

set -e

cd "$(dirname "$0")/.."

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Run the CLI with provided arguments
echo "🚀 Running Sourcify Grabber CLI..."
node src/cli.js "$@"