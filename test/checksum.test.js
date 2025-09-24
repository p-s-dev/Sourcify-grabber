import { describe, it } from 'node:test';
import assert from 'node:assert';
import { hashString } from '../src/checksum.js';

describe('Checksum utilities', () => {
  it('should generate consistent SHA256 hash for string', () => {
    const content = 'test content';
    const hash1 = hashString(content);
    const hash2 = hashString(content);
    
    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64); // SHA256 is 64 hex characters
    assert.match(hash1, /^[0-9a-f]{64}$/);
  });

  it('should generate different hashes for different content', () => {
    const hash1 = hashString('content1');
    const hash2 = hashString('content2');
    
    assert.notStrictEqual(hash1, hash2);
  });

  it('should handle empty string', () => {
    const hash = hashString('');
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});