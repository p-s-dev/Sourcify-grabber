import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ContractVerifier } from '../src/verification.js';

describe('Contract Verification', () => {
  const verifier = new ContractVerifier();

  test('should calculate bytecode hash correctly', () => {
    const bytecode = '0x608060405234801561001057600080fd5b50';
    const hash = verifier.calculateBytecodeHash(bytecode);
    
    assert.ok(hash);
    assert.strictEqual(typeof hash, 'string');
    assert.strictEqual(hash.length, 64); // SHA256 hash length
    assert.ok(hash.match(/^[a-f0-9]+$/)); // Lowercase hex
  });

  test('should handle empty bytecode', () => {
    assert.strictEqual(verifier.calculateBytecodeHash('0x'), null);
    assert.strictEqual(verifier.calculateBytecodeHash(''), null);
    assert.strictEqual(verifier.calculateBytecodeHash(null), null);
  });

  test('should create hashes record', () => {
    const verificationResult = {
      onChainHash: 'abc123',
      metadataHash: 'def456',
      hashMatch: false
    };

    const metadata = {
      output: {
        bytecode: {
          object: '0x608060405234801561001057600080fd5b50'
        }
      },
      sources: {
        'Contract.sol': {
          urls: ['ipfs://QmHash123']
        }
      }
    };

    const hashes = verifier.createHashesRecord(verificationResult, metadata);

    assert.strictEqual(hashes.onChainDeployedHash, 'abc123');
    assert.strictEqual(hashes.metadataDeployedHash, 'def456');
    assert.strictEqual(hashes.match, false);
    assert.ok(hashes.verifiedAt);
    assert.ok(hashes.creationHash);
    assert.ok(Array.isArray(hashes.ipfsCids));
    assert.strictEqual(hashes.ipfsCids[0], 'QmHash123');
  });

  test('should validate contract integrity', () => {
    const archiveData = {
      metadata: {
        address: '0x1234567890123456789012345678901234567890',
        chainId: 1
      },
      abi: [{ type: 'function', name: 'test' }],
      sources: { 'Contract.sol': 'contract Test {}' },
      provenance: {
        lastUpdatedAt: new Date().toISOString(),
        tools: { name: 'test', version: '1.0' },
        sourcesUsed: ['test']
      }
    };

    const result = verifier.validateContractIntegrity(
      'ethereum', 
      '0x1234567890123456789012345678901234567890', 
      archiveData
    );

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.checks.hasMetadata, true);
    assert.strictEqual(result.checks.hasAbi, true);
    assert.strictEqual(result.checks.hasSources, true);
    assert.strictEqual(result.checks.hasProvenance, true);
  });

  test('should detect missing required files', () => {
    const archiveData = {
      // Missing metadata
      abi: [{ type: 'function', name: 'test' }]
    };

    const result = verifier.validateContractIntegrity(
      'ethereum', 
      '0x1234567890123456789012345678901234567890', 
      archiveData
    );

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Missing metadata.json')));
    assert.ok(result.errors.some(e => e.includes('Missing provenance.json')));
  });
});