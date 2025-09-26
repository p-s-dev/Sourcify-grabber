# Sourcify Grabber

A production-grade Node.js application for building and maintaining offline archives of Ethereum smart contracts and their interfaces (ABIs) organized by chain. This tool fetches verified contract artifacts from Sourcify repositories, validates them, and exports language-agnostic interface bundles suitable for downstream code generation.

## Features

- 🔗 **Multi-chain support**: Ethereum, Arbitrum, Polygon, Optimism, Base, and extensible
- 🚀 **Robust data fetching**: Retry logic, exponential backoff, caching, ETag support
- 📁 **Deterministic organization**: Clean folder structure per chain with checksums
- ✅ **Comprehensive validation**: Address format, ABI structure, bytecode verification
- 📤 **Language-agnostic exports**: JSON schemas suitable for TypeScript, Java, Python codegen
- 🐳 **Docker support**: Containerized execution with volume mapping
- 📊 **Rich CLI interface**: 12 commands for complete contract lifecycle management
- 📝 **Audit trail**: Detailed logging and provenance tracking

## Quick Start

### Prerequisites

- Node.js 18+ 
- npm

### Installation

```bash
git clone <repository>
cd sourcify-grabber
npm install
```

### Basic Usage

```bash
# Show all available commands
npm start

# Initialize a chain
npm run init-chain -- --chain ethereum

# Add a contract
npm run add-contract -- --chain ethereum --alias weth9 \
  --address 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 \
  --tags token,wrapped-eth

# Fetch contract data
npm run fetch -- --chain ethereum --all

# Validate contracts
npm run validate -- --chain ethereum --strict

# Export interfaces
npm run export -- --chain ethereum --all --format interfaces

# Check status
npm run status
```

## CLI Commands

### Chain Management

```bash
# Initialize chain directory and registry
node src/cli.js init-chain --chain <chainId|name>

# List available chains
node src/cli.js list --chains
```

### Contract Management

```bash
# Add contract to registry
node src/cli.js add-contract \
  --chain <chainId|name> \
  --alias <alias> \
  --address <0x...> \
  [--tags tag1,tag2] \
  [--note "description"] \
  [--expected-implementation <0x...>]

# Remove contract (archive)
node src/cli.js remove-contract --chain <chainId|name> --address <0x...>

# List contracts
node src/cli.js list --contracts --chain <chainId|name>

# Switch to contract set
node src/cli.js switch-set --chain <chainId|name> --set <setName>
```

### Data Operations

```bash
# Fetch contract data from Sourcify
node src/cli.js fetch --chain <chainId|name> [--all|--address <0x...>|--alias <alias>]

# Refresh and re-validate existing data
node src/cli.js refresh --chain <chainId|name> [--all]

# Validate contract data integrity
node src/cli.js validate --chain <chainId|name> [--strict] [--address <0x...>|--alias <alias>]

# Export language-agnostic interfaces
node src/cli.js export --chain <chainId|name> --format interfaces \
  [--all|--address <0x...>|--alias <alias>|--set <setName>]

# Show status across all chains
node src/cli.js status
```

## Directory Structure

The application creates a deterministic directory structure:

```
├── config/
│   ├── chains.json              # Chain configurations
│   └── sets/                    # Contract sets
│       ├── uniswap-v3.json
│       └── core-tokens.json
├── data/
│   └── {chainId}-{chainName}/
│       ├── registry.json        # Contract registry
│       ├── contracts/
│       │   └── {alias}-{address}/
│       │       ├── metadata.json    # Raw Sourcify metadata
│       │       ├── abi.json         # Extracted ABI
│       │       ├── sources/         # Source files
│       │       ├── checksums.json   # SHA256 checksums
│       │       └── provenance.json  # Fetch metadata
│       └── incoming/            # User-provided files
├── exports/
│   └── {chainId}-{chainName}/
│       ├── manifest.json        # Export manifest
│       └── interfaces/
│           └── {alias}-{address}/
│               ├── abi.json
│               ├── schema.json      # Language-agnostic schema
│               ├── hints.json       # Helper metadata
│               └── summary.json
├── logs/                        # Rotating logs
└── cache/                       # HTTP cache
```

## Configuration

### Chains Configuration (`config/chains.json`)

```json
{
  "chains": [
    {
      "chainId": 1,
      "chainName": "ethereum",
      "rpcUrl": "https://ethereum.publicnode.com",
      "sourcifyRepoUrls": ["https://repo.sourcify.dev"],
      "ipfsGateways": ["https://ipfs.io/ipfs"],
      "trackedContracts": []
    }
  ]
}
```

### Contract Sets (`config/sets/*.json`)

```json
{
  "name": "uniswap-v3",
  "description": "Uniswap V3 core contracts",
  "contracts": [
    {
      "alias": "uniswap-v3-factory",
      "address": "0x1F98431c8aD98523631AE4a59f267346ea31F984",
      "tags": ["dex", "factory"],
      "notes": "Uniswap V3 Factory contract"
    }
  ]
}
```

## Docker Usage

This project uses a simplified Docker approach with two main use cases:

### Development Container (Recommended)

For local development, use the VS Code Dev Container:

```bash
# If using VS Code
# Ctrl+Shift+P → "Dev Containers: Reopen in Container"

# Or manually with Docker Compose
# Note: The dev container automatically installs dependencies and sets up the environment
```

The dev container provides:
- Node.js 18+ with development tools
- Automatic dependency installation
- Volume mapping for persistent data
- Development-friendly environment variables

### Production Build and Run

```bash
# Build Docker image
docker build -t sourcify-grabber .

# Run with volume mapping
docker run --rm \
  -v $(pwd)/docker-data:/app/data \
  -v $(pwd)/docker-data:/app/exports \
  sourcify-grabber --help
```

### Using the Docker Script

```bash
# Use the provided script
./scripts/docker-run.sh --help
./scripts/docker-run.sh init-chain --chain ethereum
./scripts/docker-run.sh status
```

The Docker container maps volumes to preserve data on the host:
- `docker-data/` contains all persistent data (contracts, exports, logs)

## Docker Simplification

This project now uses a single dev container for local development. All orchestration for sub-services (e.g., Airflow, Redis, Postgres) has been removed to reduce complexity. The application is designed to be self-contained and does not require additional services for basic operation.

## Examples

### Example 1: Ethereum Mainnet Workflow

```bash
# 1. Initialize Ethereum mainnet
node src/cli.js init-chain --chain ethereum

# 2. Add WETH9 contract
node src/cli.js add-contract \
  --chain ethereum \
  --alias weth9 \
  --address 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 \
  --tags token,wrapped-eth

# 3. Fetch contract data
node src/cli.js fetch --chain ethereum --alias weth9

# 4. Validate with bytecode check
node src/cli.js validate --chain ethereum --alias weth9 --strict

# 5. Export interface bundle
node src/cli.js export --chain ethereum --alias weth9 --format interfaces
```

### Example 2: Multi-Chain Setup

```bash
# Initialize multiple chains
node src/cli.js init-chain --chain ethereum
node src/cli.js init-chain --chain polygon
node src/cli.js init-chain --chain arbitrum

# Use contract sets
node src/cli.js switch-set --chain ethereum --set uniswap-v3
node src/cli.js switch-set --chain polygon --set core-tokens

# Fetch all contracts on all chains
node src/cli.js fetch --chain ethereum --all
node src/cli.js fetch --chain polygon --all

# Check global status
node src/cli.js status
```

### Example 3: Export for Code Generation

```bash
# Export interfaces for a specific chain
node src/cli.js export --chain ethereum --all --format interfaces

# Check the exports directory
ls -la exports/1-ethereum/interfaces/
cat exports/1-ethereum/manifest.json

# The schema.json files can be used for:
# - TypeScript interface generation
# - Java class generation
# - Python dataclass generation
# - GraphQL schema generation
```

## Output Formats

### Schema JSON Format

The exported `schema.json` provides a language-agnostic representation:

```json
{
  "functions": [
    {
      "name": "transfer",
      "type": "function",
      "stateMutability": "nonpayable",
      "inputs": [
        {"name": "to", "type": "address"},
        {"name": "amount", "type": "uint256"}
      ],
      "outputs": [{"type": "bool"}],
      "selector": "0xa9059cbb",
      "signature": "transfer(address,uint256)"
    }
  ],
  "events": [...],
  "selectors": {"0xa9059cbb": {...}},
  "topics": {"0x...": {...}}
}
```

### Hints JSON Format

The `hints.json` provides convenience metadata:

```json
{
  "readOnlyFunctions": ["balanceOf", "totalSupply"],
  "stateMutatingFunctions": ["transfer", "approve"],
  "payableFunctions": [],
  "commonPatterns": {
    "transfer": "transfer",
    "balanceOf": "getter"
  },
  "eventCategories": {
    "Transfer": "transfer",
    "Approval": "approval"
  }
}
```

## Environment Variables

```bash
# Logging level
LOG_LEVEL=info|debug|warn|error

# HTTP client settings
HTTP_TIMEOUT=30000
HTTP_MAX_RETRIES=3
HTTP_RETRY_DELAY=1000

# Concurrency settings
FETCH_CONCURRENCY=5
```

## Development

### Running Tests

```bash
npm test
```

### Demo Script

```bash
npm run demo
```

### Linting and Building

```bash
npm run lint    # (placeholder)
npm run build   # (no build step needed)
npm run clean   # Clean all data directories
```

## API Design

The application is designed with pluggable components:

- **ConfigManager**: JSON Schema validation, chain configuration
- **HttpClient**: Robust HTTP with retry/backoff, caching
- **SourcefyClient**: Sourcify API integration with fallbacks
- **RegistryManager**: Contract tracking and lifecycle
- **DataNormalizer**: ABI extraction and schema generation
- **Validator**: Comprehensive validation pipeline
- **ExportManager**: Language-agnostic export generation

## Error Handling

- Comprehensive error logging with structured JSON
- Graceful degradation (skip unavailable contracts)
- Detailed validation reports with warnings and errors
- Retry logic with exponential backoff for network issues
- File-level checksums for data integrity

## Security Considerations

- All remote content treated as untrusted
- No code evaluation or execution
- EIP-55 address validation
- SHA256 checksums for file integrity
- Docker runs as non-root user
- No credentials stored in source code

## Performance

- HTTP caching with ETag support
- Concurrent fetching with configurable limits
- Deterministic outputs for reproducible builds
- Incremental updates with diff detection
- File-based persistence (no database required)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass: `npm test`
5. Submit a pull request

## License

MIT

## Support

For issues and questions:
1. Check the logs in `logs/` directory
2. Run with `LOG_LEVEL=debug` for detailed output
3. Use `--dry-run` mode to preview operations
4. Check GitHub issues and documentation