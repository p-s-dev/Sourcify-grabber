# Copilot Instructions for Sourcify Grabber

## Project Overview

Sourcify Grabber is a production-grade Node.js CLI application for building and maintaining offline archives of Ethereum smart contracts from Sourcify repositories. The tool fetches verified contract artifacts, validates them, and exports language-agnostic interface bundles suitable for downstream code generation.

## Architecture

### Core Modules
- **`src/cli.js`** - Main CLI interface with Commander.js, entry point for all operations
- **`src/config.js`** - Configuration management with JSON schema validation using AJV
- **`src/registry.js`** - Contract registry management for tracking contracts per chain
- **`src/sourcify.js`** - Sourcify API client for fetching contract metadata and sources
- **`src/normalize.js`** - Data normalization utilities for ABIs, metadata, and sources
- **`src/export.js`** - Export manager for generating interface bundles
- **`src/validate.js`** - Data validation utilities using JSON schemas
- **`src/log.js`** - Structured logging with Winston and daily rotation
- **`src/http.js`** - HTTP client with retry logic and caching
- **`src/checksum.js`** - SHA256 checksum generation for file integrity
- **`src/utils/address.js`** - Ethereum address utilities with EIP-55 checksum validation

### Data Flow
1. Chain configuration loaded from `config/chains.json`
2. Contract sets loaded from `config/sets/*.json`
3. Registry manages tracked contracts per chain in `data/{chainId}-{chainName}/registry.json`
4. Sourcify fetches metadata and sources to `data/{chainId}-{chainName}/contracts/{alias}-{address}/`
5. Export generates interfaces to `exports/{chainId}-{chainName}/interfaces/`

## Code Conventions

### ES Modules
- All files use ES modules (`import`/`export`)
- Main entry point: `src/cli.js` with shebang `#!/usr/bin/env node`
- Module exports use default exports for main classes and named exports for utilities

### Error Handling
- Use structured error objects with context
- Log errors with appropriate level (error, warn, info, debug)
- CLI commands should catch errors and provide user-friendly messages
- Always include chain context in error messages for multi-chain operations

### Async/Await
- Prefer async/await over promises
- Handle errors with try/catch blocks
- Use `Promise.all()` for concurrent operations where appropriate

### Logging Pattern
```javascript
import logger from './log.js';

// Structured logging with context
logger.info('Operation started', { chain: chainName, address });
logger.error('Operation failed', { error: error.message, context });
```

### Configuration Pattern
- JSON configuration files with schema validation
- Environment variable support with sensible defaults
- Validate configuration on load with AJV schemas

## Development Workflow

### Testing
- Tests located in `test/` directory
- Run tests with `npm test` or `node --test test/*.test.js` (uses Node.js built-in test runner)
- Test files follow pattern `*.test.js`
- Use Node.js built-in test modules: `import { describe, it } from 'node:test'` and `import assert from 'node:assert'`
- Mock external dependencies (HTTP calls, file system operations)

### Commands to Know
```bash
npm test              # Run all tests
npm run lint          # Lint code (placeholder)
npm run clean         # Clean generated data
node src/cli.js --help # Show CLI help
```

### Dependencies
- **Production**: `commander`, `axios`, `winston`, `winston-daily-rotate-file`, `ajv`, `keccak`
- **No build step required** - Pure Node.js ES modules
- Minimum Node.js version: 18.0.0

## CLI Command Structure

### Command Pattern
```javascript
program
  .command('command-name')
  .description('Command description')
  .option('-c, --chain <chainId|name>', 'Chain parameter')
  .option('--dry-run', 'Preview operations without changes')
  .action(async (options) => {
    try {
      // Validate required options
      // Get chain configuration
      // Perform operation
      // Log results
    } catch (error) {
      logger.error('Command failed', { error: error.message });
      process.exit(1);
    }
  });
```

### Common Options
- `--chain <chainId|name>` - Target blockchain
- `--dry-run` - Preview mode without making changes
- `--all` - Apply to all tracked contracts
- `--address <address>` - Target specific contract address
- `--alias <alias>` - Target specific contract alias

## Data Formats

### Chain Configuration (`config/chains.json`)
```json
{
  "chains": [{
    "chainId": 1,
    "chainName": "ethereum",
    "rpcUrl": "https://ethereum.publicnode.com",
    "sourcifyRepoUrls": ["https://repo.sourcify.dev"],
    "ipfsGateways": ["https://ipfs.io/ipfs"],
    "trackedContracts": []
  }]
}
```

### Contract Registry (`data/{chainId}-{chainName}/registry.json`)
```json
{
  "chainId": 1,
  "chainName": "ethereum",
  "lastUpdated": "2024-01-01T00:00:00.000Z",
  "contracts": [{
    "alias": "contract-name",
    "address": "0x...",
    "tags": ["tag1", "tag2"],
    "notes": "Description"
  }]
}
```

### Directory Structure
```
├── config/                    # Configuration files
├── data/{chainId}-{chainName}/ # Chain-specific data
│   ├── registry.json         # Contract registry
│   ├── contracts/            # Contract artifacts
│   └── incoming/             # User uploads
├── exports/{chainId}-{chainName}/ # Export outputs
├── logs/                      # Rotating log files
└── cache/                     # HTTP cache
```

## Key Patterns

### Chain Resolution
```javascript
const chainConfig = await config.getChainConfig(options.chain);
// Accepts either chainId (number) or chainName (string)
```

### Address Handling
```javascript
import { toChecksumAddress, isValidAddress } from './utils/address.js';

const checksumAddr = toChecksumAddress(address);
if (!isValidAddress(address)) throw new Error('Invalid address');
```

### File Operations
- Always create directories recursively: `fs.mkdir(dir, { recursive: true })`
- Use proper path handling: `path.join()` for cross-platform compatibility
- Generate checksums for data integrity

### HTTP Operations
```javascript
import http from './http.js';

const response = await http.get(url, { 
  timeout: 30000,
  retries: 3 
});
```

## Security Considerations

- Validate all user inputs (addresses, chain IDs, file paths)
- Use checksums to verify data integrity
- Sanitize file paths to prevent directory traversal
- Rate limit HTTP requests to external APIs
- Never expose API keys in logs or error messages

## Performance Guidelines

- Use concurrent operations for bulk fetching
- Implement HTTP caching for repeated requests
- Stream large files instead of loading into memory
- Use daily rotating logs to manage disk space
- Cache chain configurations and contract registries

## Extension Points

### Adding New Chains
1. Add configuration to `config/chains.json`
2. Ensure Sourcify repository URL is correct
3. Test with a few contracts before bulk operations

### Adding New Export Formats
1. Extend `src/export.js` with new format handler
2. Add format-specific schema generation
3. Update CLI options and help text

### Custom Data Sources
1. Implement interface similar to `src/sourcify.js`
2. Add source option to relevant CLI commands
3. Ensure consistent metadata format

## Common Issues & Solutions

### Missing Dependencies
- Run `npm install` to ensure all dependencies are installed
- Check Node.js version compatibility (>=18.0.0)

### Network Issues
- Check Sourcify repository availability
- Verify IPFS gateway accessibility
- Review HTTP timeout settings

### Data Corruption
- Use `npm run clean` to reset data directories
- Verify checksums in contract directories
- Re-fetch contracts with validation enabled

## Best Practices for Contributors

1. **Always validate inputs** - Check addresses, chain IDs, and file paths
2. **Use structured logging** - Include relevant context in log messages
3. **Handle errors gracefully** - Provide actionable error messages
4. **Test with multiple chains** - Ensure cross-chain compatibility
5. **Document configuration changes** - Update schemas and examples
6. **Preserve data integrity** - Generate and verify checksums
7. **Follow async patterns** - Use proper error handling with async/await