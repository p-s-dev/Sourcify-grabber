import { test, describe } from 'node:test';
import assert from 'node:assert';
import { validateMetadata, validateLabels, validateProvenance, validateHashes, validateData } from '../src/schemas.js';

describe('Schema Validation', () => {
  
  test('should validate correct metadata', () => {
    const validMetadata = {
      chainId: 1,
      address: '0x1234567890123456789012345678901234567890',
      compiler: {
        version: '0.8.0',
        settings: {
          optimizer: { enabled: true, runs: 200 }
        }
      },
      sources: {
        'Contract.sol': {
          path: 'Contract.sol',
          contentHash: 'abc123',
          license: 'MIT'
        }
      },
      timestamps: {
        fetchedAt: '2023-01-01T00:00:00.000Z'
      }
    };

    assert.doesNotThrow(() => {
      validateData(validMetadata, validateMetadata, 'metadata');
    });
  });

  test('should reject metadata with invalid address', () => {
    const invalidMetadata = {
      chainId: 1,
      address: 'invalid-address',
      compiler: { version: '0.8.0' }
    };

    assert.throws(() => {
      validateData(invalidMetadata, validateMetadata, 'metadata');
    });
  });

  test('should validate correct labels', () => {
    const validLabels = {
      protocol: 'Uniswap',
      project: 'Uniswap V3',
      tags: ['dex', 'amm', 'v3'],
      knownAliases: ['UNI', 'UniswapV3'],
      explorerLabels: ['verified'],
      userNotes: 'Core router contract'
    };

    assert.doesNotThrow(() => {
      validateData(validLabels, validateLabels, 'labels');
    });
  });

  test('should validate correct provenance', () => {
    const validProvenance = {
      firstSeenAt: '2023-01-01T00:00:00.000Z',
      lastUpdatedAt: '2023-01-02T00:00:00.000Z',
      tools: {
        name: 'sourcify-grabber',
        version: '2.0.0'
      },
      sourcesUsed: ['sourcify', 'explorer'],
      fetchRunId: 'run-123',
      commitHash: 'abc123def456',
      operator: 'automated'
    };

    assert.doesNotThrow(() => {
      validateData(validProvenance, validateProvenance, 'provenance');
    });
  });

  test('should reject provenance missing required fields', () => {
    const invalidProvenance = {
      firstSeenAt: '2023-01-01T00:00:00.000Z',
      // Missing lastUpdatedAt, tools, sourcesUsed
    };

    assert.throws(() => {
      validateData(invalidProvenance, validateProvenance, 'provenance');
    });
  });

  test('should validate correct hashes', () => {
    const validHashes = {
      onChainDeployedHash: 'abc123def456',
      metadataDeployedHash: 'def456abc123',
      creationHash: '789abc123def',
      match: true,
      ipfsCids: ['QmHash1', 'QmHash2'],
      sourcifyMatchType: 'full'
    };

    assert.doesNotThrow(() => {
      validateData(validHashes, validateHashes, 'hashes');
    });
  });

  test('should reject hashes with invalid match type', () => {
    const invalidHashes = {
      onChainDeployedHash: 'abc123',
      metadataDeployedHash: 'def456', 
      match: true,
      sourcifyMatchType: 'invalid-type'
    };

    assert.throws(() => {
      validateData(invalidHashes, validateHashes, 'hashes');
    });
  });
});