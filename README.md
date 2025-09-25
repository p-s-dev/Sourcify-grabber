# Sourcify Grabber - Contract Archive Builder

A multi-step contract archive builder for Ethereum smart contracts that creates a long-lived, versioned archive of contract metadata. This tool progressively builds and maintains offline archives of Solidity source code, ABI, compiler settings, metadata JSON, bytecode hashes, verification status, and labels.

## Features

- 🔗 **Multi-chain support**: Ethereum, Arbitrum, Polygon, Optimism, Base, and extensible
- 🚀 **Sourcify-first approach**: Uses Sourcify as the primary source with explorer API fallback
- 📁 **Canonical archive structure**: Deterministic organization with versioned artifacts
- ✅ **Comprehensive verification**: Bytecode validation, hash comparisons, schema validation
- 📊 **Detailed reporting**: Run summaries, statistics, and progress tracking
- 🔄 **Idempotent & resumable**: Re-runs pick up where they left off
- 📤 **Explorer integration**: Etherscan-family API support for fallback data
- 🛡️ **Robust reliability**: Rate limiting, caching, exponential backoff
- 📝 **Rich CLI interface**: Commands for complete contract lifecycle management

## Architecture

The system transforms input address lists into a comprehensive, git-committed archive:

```
Input:  chains/<chainName>/addresses.txt (one address per line)
        ↓
Output: archive/<chainName>/<address>/  (canonical metadata)
        ├── metadata.json       (Sourcify or explorer metadata)
        ├── abi.json           (extracted ABI)
        ├── source/            (original Solidity files)
        ├── bytecode/
        │   ├── deployed.hex
        │   ├── creation.hex
        │   └── hashes.json    (verification hashes)
        ├── labels.json        (protocol tags, names)
        └── provenance.json    (fetch metadata, sources)
```

## Installation

```bash
npm install
```

## Configuration

The tool uses `config/chains.json` to map chain names to configuration:

```json
{
  "chains": {
    "ethereum": {
      "chainId": 1,
      "rpcUrl": "https://ethereum.publicnode.com",
      "sourcifyChainSupport": true,
      "explorerApiBase": "https://api.etherscan.io/api",
      "explorerApiKeyRef": "ETHERSCAN_API_KEY",
      "sourcifyRepoUrls": ["https://repo.sourcify.dev"],
      "ipfsGateways": ["https://ipfs.io/ipfs"]
    }
  }
}
```

Set API keys as environment variables:
```bash
export ETHERSCAN_API_KEY=your_key_here
export POLYGONSCAN_API_KEY=your_key_here
# etc.
```

## Usage

### 1. Add addresses to track

Create or edit `chains/<chainName>/addresses.txt`:

```bash
# Add addresses to ethereum chain
echo "0xA0b86a33E6411eff3c1A0F87A4f46B6d3EB2E95c" >> chains/ethereum/addresses.txt
echo "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" >> chains/ethereum/addresses.txt
```

### 2. Validate input addresses

```bash
# Validate all chains
node src/cli.js validate-input

# Validate specific chain  
node src/cli.js validate-input -c ethereum
```

### 3. Fetch contract data

```bash
# Fetch all pending contracts
node src/cli.js fetch

# Fetch specific chain
node src/cli.js fetch -c ethereum

# Fetch specific address
node src/cli.js fetch -c ethereum --address 0xA0b86a33E6411eff3c1A0F87A4f46B6d3EB2E95c

# Fetch with bytecode verification
node src/cli.js fetch -c ethereum --verify-bytecode

# Dry run to see what would be done
node src/cli.js fetch -c ethereum --dry-run
```

### 4. Verify existing contracts

```bash
# Verify all archived contracts
node src/cli.js verify

# Verify specific contract
node src/cli.js verify -c ethereum --address 0xA0b86a33E6411eff3c1A0F87A4f46B6d3EB2E95c
```

### 5. Add labels and metadata

```bash
# Add protocol labels
node src/cli.js label -c ethereum --address 0xA0b86a33E6411eff3c1A0F87A4f46B6d3EB2E95c \
  --protocol "Uniswap" --project "Uniswap V3" --tags "dex,amm,v3"
```

### 6. Generate reports

```bash
# Generate status report
node src/cli.js report

# View current status
node src/cli.js status

# List contracts
node src/cli.js list
node src/cli.js list -c ethereum
```

## Data Flow

1. **Input Validation**: Verify address format, detect duplicates
2. **Provenance Check**: Skip if data is fresh (unless `--force`)
3. **Sourcify First**: Attempt full/partial match from Sourcify
4. **Explorer Fallback**: Use Etherscan-family APIs if Sourcify fails
5. **Bytecode Verification**: Compare on-chain vs metadata bytecode (optional)
6. **Schema Validation**: Ensure data meets canonical format
7. **Deterministic Persistence**: Write to archive with consistent structure
8. **Report Generation**: Create run summaries and statistics

## Archive Schema

### metadata.json
```json
{
  "name": "Contract Name",
  "chainId": 1,
  "address": "0x...",
  "compiler": {
    "version": "0.8.0",
    "settings": { "optimizer": { "enabled": true, "runs": 200 } }
  },
  "sources": {
    "Contract.sol": {
      "path": "Contract.sol",
      "contentHash": "0x...",
      "license": "MIT"
    }
  },
  "sourcify": {
    "matchType": "full",
    "url": "https://repo.sourcify.dev",
    "commit": "abc123"
  },
  "explorer": {
    "name": "Etherscan", 
    "contractName": "MyContract",
    "verified": true
  },
  "timestamps": {
    "fetchedAt": "2023-01-01T00:00:00.000Z"
  },
  "integrity": {
    "deployedBytecodeHash": "0x...",
    "creationBytecodeHash": "0x..."
  }
}
```

### labels.json
```json
{
  "protocol": "Uniswap",
  "project": "Uniswap V3 Router",
  "tags": ["dex", "amm", "v3", "router"],
  "knownAliases": ["UniV3Router", "SwapRouter"],
  "explorerLabels": ["verified", "proxy"],
  "userNotes": "Core routing contract for Uniswap V3"
}
```

### provenance.json
```json
{
  "firstSeenAt": "2023-01-01T00:00:00.000Z",
  "lastUpdatedAt": "2023-01-02T00:00:00.000Z",
  "tools": {
    "name": "sourcify-grabber",
    "version": "2.0.0"
  },
  "sourcesUsed": ["sourcify"],
  "fetchRunId": "fetch-1672531200000",
  "commitHash": "abc123def456",
  "operator": "automated",
  "orphaned": false
}
```

### bytecode/hashes.json
```json
{
  "onChainDeployedHash": "0x...",
  "metadataDeployedHash": "0x...",
  "creationHash": "0x...",
  "match": true,
  "ipfsCids": ["QmHash1", "QmHash2"],
  "sourcifyMatchType": "full",
  "verifiedAt": "2023-01-01T00:00:00.000Z"
}
```

## CLI Commands

| Command | Description | Example |
|---------|-------------|---------|
| `validate-input` | Validate addresses.txt files | `node src/cli.js validate-input -c ethereum` |
| `fetch` | Fetch contract data from sources | `node src/cli.js fetch -c ethereum --limit 10` |
| `verify` | Verify contracts against on-chain data | `node src/cli.js verify -c ethereum` |
| `label` | Add/update contract labels | `node src/cli.js label -c ethereum --address 0x... --protocol Uniswap` |
| `report` | Generate summary reports | `node src/cli.js report` |
| `list` | List contracts and status | `node src/cli.js list -c ethereum` |
| `status` | Show overall archive status | `node src/cli.js status` |

## Options

### Fetch Options
- `-c, --chain <name>`: Specific chain to process
- `--address <addr>`: Process specific address only
- `--from <index>`: Start from address index
- `--to <index>`: End at address index  
- `--limit <count>`: Limit number of addresses
- `--force`: Force re-fetch even if not stale
- `--strict`: Exit on any failure
- `--dry-run`: Show what would be done
- `--verify-bytecode`: Verify bytecode against on-chain

## Development

### Running Tests
```bash
npm test
```

### Adding New Chains
1. Add chain configuration to `config/chains.json`
2. Create `chains/<chainName>/addresses.txt`
3. Set explorer API key environment variable
4. Run `validate-input` and `fetch` commands

### Integration with CI
```bash
# Validate input files
node src/cli.js validate-input

# Fetch new contracts (dry run in CI)
node src/cli.js fetch --dry-run

# Generate reports
node src/cli.js report
```

## Git Integration

The archive is designed to be committed to git:

- ✅ **Commit**: `archive/`, `reports/`, `chains/`
- ❌ **Ignore**: `.cache/`, `logs/`, `tmp/`

Conventional commit messages:
```
feat(archive): add 37 verified contracts on ethereum mainnet (Sourcify full matches)
fix(verification): update bytecode hashes for polygon contracts  
docs(labels): add Aave protocol labels for lending contracts
```

## API Rate Limits

The tool implements:
- Exponential backoff with jitter
- Per-endpoint rate limiting
- Disk caching with ETag support
- Graceful partial failure handling

## Security

- No secrets in committed files (environment variables only)
- Address validation and sanitization
- Schema validation for all persisted data
- Bytecode verification for integrity

## Examples

### Add 50 new Uniswap contracts
```bash
# Add addresses to file
echo "0x..." >> chains/ethereum/addresses.txt
# ... add 49 more

# Validate input
node src/cli.js validate-input -c ethereum

# Fetch with verification
node src/cli.js fetch -c ethereum --verify-bytecode

# Add labels
for addr in $(tail -50 chains/ethereum/addresses.txt); do
  node src/cli.js label -c ethereum --address $addr --protocol Uniswap --tags dex,v3
done

# Generate report
node src/cli.js report

# Commit changes
git add archive/ chains/ reports/
git commit -m "feat(archive): add 50 Uniswap V3 contracts with verification"
```

### Daily maintenance routine
```bash
#!/bin/bash
# Validate all inputs
node src/cli.js validate-input

# Fetch any new contracts  
node src/cli.js fetch --verify-bytecode

# Re-verify existing contracts periodically
node src/cli.js verify

# Generate reports
node src/cli.js report

# Show status
node src/cli.js status
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass: `npm test`
5. Submit a pull request

## License

MIT