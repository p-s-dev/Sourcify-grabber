import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { ArchiveManager } from '../src/archive.js';

describe('Archive Manager', () => {
  const archive = new ArchiveManager();
  const testChain = 'test-chain';
  const testAddress = '0x1234567890123456789012345678901234567890';

  test('should create archive directory structure', async () => {
    const archiveDir = archive.getArchiveDir(testChain, testAddress);
    assert.ok(archiveDir.includes(testChain));
    assert.ok(archiveDir.includes(testAddress));
  });

  test('should create provenance record', () => {
    const provenance = archive.createProvenance({
      sourcesUsed: ['sourcify'],
      toolVersion: '2.0.0'
    });

    assert.ok(provenance.firstSeenAt);
    assert.ok(provenance.lastUpdatedAt);
    assert.strictEqual(provenance.tools.name, 'sourcify-grabber');
    assert.strictEqual(provenance.tools.version, '2.0.0');
    assert.deepStrictEqual(provenance.sourcesUsed, ['sourcify']);
  });

  test('should validate metadata schema', async () => {
    const { validateData, validateMetadata } = await import('../src/schemas.js');
    
    const validMetadata = {
      chainId: 1,
      address: '0x1234567890123456789012345678901234567890',
      compiler: {
        version: '0.8.0'
      }
    };

    // Should not throw
    assert.doesNotThrow(() => {
      validateData(validMetadata, validateMetadata, 'metadata');
    });
  });

  test('should validate labels schema', async () => {
    const { validateData, validateLabels } = await import('../src/schemas.js');
    
    const validLabels = {
      protocol: 'Uniswap',
      tags: ['dex', 'v3'],
      knownAliases: ['UNI']
    };

    // Should not throw
    assert.doesNotThrow(() => {
      validateData(validLabels, validateLabels, 'labels');
    });
  });

  test('should generate unique run IDs', () => {
    const runId1 = archive.generateRunId();
    const runId2 = archive.generateRunId();
    
    assert.notStrictEqual(runId1, runId2);
    assert.ok(runId1.startsWith('run-'));
    assert.ok(runId2.startsWith('run-'));
  });
});