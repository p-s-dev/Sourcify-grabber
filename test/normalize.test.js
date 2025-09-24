import { describe, it } from 'node:test';
import assert from 'node:assert';
import normalize from '../src/normalize.js';

describe('Data normalization', () => {
  const sampleMetadata = {
    compiler: {
      version: '0.8.19+commit.7dd6d404'
    },
    output: {
      abi: [
        {
          type: 'function',
          name: 'transfer',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' }
          ],
          outputs: [
            { name: '', type: 'bool' }
          ]
        },
        {
          type: 'event',
          name: 'Transfer',
          inputs: [
            { name: 'from', type: 'address', indexed: true },
            { name: 'to', type: 'address', indexed: true },
            { name: 'value', type: 'uint256', indexed: false }
          ]
        }
      ]
    }
  };

  it('should extract ABI from metadata', () => {
    const abi = normalize.extractAbi(sampleMetadata);
    
    assert.strictEqual(Array.isArray(abi), true);
    assert.strictEqual(abi.length, 2);
    assert.strictEqual(abi[0].type, 'function');
    assert.strictEqual(abi[0].name, 'transfer');
    assert.strictEqual(abi[1].type, 'event');
    assert.strictEqual(abi[1].name, 'Transfer');
  });

  it('should generate schema from ABI', () => {
    const abi = normalize.extractAbi(sampleMetadata);
    const schema = normalize.generateSchema(abi);
    
    assert.strictEqual(schema.functions.length, 1);
    assert.strictEqual(schema.events.length, 1);
    assert.strictEqual(schema.functions[0].name, 'transfer');
    assert.strictEqual(schema.events[0].name, 'Transfer');
    assert.strictEqual(typeof schema.selectors, 'object');
    assert.strictEqual(typeof schema.topics, 'object');
  });

  it('should validate metadata structure', () => {
    assert.strictEqual(normalize.validateMetadata(sampleMetadata), true);
    
    // Invalid metadata
    assert.strictEqual(normalize.validateMetadata({}), false);
    assert.strictEqual(normalize.validateMetadata(null), false);
    assert.strictEqual(normalize.validateMetadata({ compiler: {} }), false);
  });

  it('should generate hints from ABI', () => {
    const abi = normalize.extractAbi(sampleMetadata);
    const hints = normalize.generateHints(abi);
    
    assert.strictEqual(typeof hints.readOnlyFunctions, 'object');
    assert.strictEqual(typeof hints.stateMutatingFunctions, 'object');
    assert.strictEqual(typeof hints.payableFunctions, 'object');
    assert.strictEqual(typeof hints.commonPatterns, 'object');
    assert.strictEqual(typeof hints.eventCategories, 'object');
  });

  it('should handle invalid ABI', () => {
    const invalidMetadata = {
      compiler: { version: '0.8.19' },
      output: { abi: [] }
    };
    
    assert.throws(() => normalize.extractAbi(invalidMetadata), /ABI is empty/);
  });
});