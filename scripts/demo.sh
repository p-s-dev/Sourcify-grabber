#!/bin/bash

# Demo script for Sourcify Grabber
# Shows complete workflow: init chain, add contracts, fetch, validate, export

set -e

echo "🚀 Sourcify Grabber Demo"
echo "========================="

# Clean previous data
echo "🧹 Cleaning previous data..."
npm run clean

# Initialize Ethereum mainnet chain
echo "🔧 Initializing Ethereum mainnet chain..."
node src/cli.js init-chain --chain ethereum

# Add a few well-known contracts
echo "📝 Adding contracts to registry..."

# Add WETH9
node src/cli.js add-contract \
  --chain ethereum \
  --alias weth9 \
  --address 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 \
  --tags token,wrapped-eth \
  --note "Wrapped Ethereum (WETH9)"

# Add USDC (using a different address for demo - the original might not be on Sourcify)
node src/cli.js add-contract \
  --chain ethereum \
  --alias demo-token \
  --address 0x6B175474E89094C44Da98b954EedeAC495271d0F \
  --tags token,stablecoin \
  --note "Demo ERC20 token for testing"

# List contracts
echo "📋 Listing contracts..."
node src/cli.js list --contracts --chain ethereum

# Show status
echo "📊 Showing status..."
node src/cli.js status

# Fetch contract data
echo "📥 Fetching contract data from Sourcify..."
echo "(This may take a moment and some contracts might not be available...)"
node src/cli.js fetch --chain ethereum --all || echo "⚠️  Some contracts may not be available on Sourcify"

# Validate contracts
echo "🔍 Validating contracts..."
node src/cli.js validate --chain ethereum || echo "⚠️  Some validation issues expected for demo"

# Export interfaces
echo "📤 Exporting interfaces..."
node src/cli.js export --chain ethereum --all --format interfaces || echo "⚠️  Export may fail if no contracts were fetched"

# Show final status
echo "📊 Final status..."
node src/cli.js status

echo ""
echo "✅ Demo completed!"
echo ""
echo "📁 Check the following directories:"
echo "   - data/1-ethereum/         (contract data)"
echo "   - exports/1-ethereum/      (exported interfaces)"
echo "   - logs/                    (application logs)"
echo ""
echo "🔧 Try these commands:"
echo "   node src/cli.js --help     (show all commands)"
echo "   node src/cli.js list --chains"
echo "   node src/cli.js status"
echo ""