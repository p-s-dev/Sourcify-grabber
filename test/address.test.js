import { describe, it } from 'node:test';
import assert from 'node:assert';
import { toChecksumAddress, isValidChecksumAddress, isValidAddress } from '../src/utils/address.js';

describe('Address utilities', () => {
  it('should convert address to EIP-55 checksum format', () => {
    const address = '0xa0b86a33e6411bf3d4c0e60b48fe3bc6b84ed4d2';
    const result = toChecksumAddress(address);
    // The result should be a valid checksum address
    assert.strictEqual(result.length, 42);
    assert.strictEqual(result.startsWith('0x'), true);
    assert.strictEqual(isValidChecksumAddress(result), true);
  });

  it('should validate correct checksum addresses', () => {
    // Use a known valid checksum address
    const address = '0xA0B86a33e6411bf3d4c0E60b48Fe3bC6B84ED4D2'; // This is the actual checksum for the test address
    assert.strictEqual(isValidChecksumAddress(address), true);
  });

  it('should reject incorrect checksum addresses', () => {
    const address = '0xa0b86a33e6411bf3d4c0e60b48fe3bc6b84ed4d2';
    assert.strictEqual(isValidChecksumAddress(address), false);
  });

  it('should validate correct address format', () => {
    const address = '0xa0b86a33e6411bf3d4c0e60b48fe3bc6b84ed4d2';
    assert.strictEqual(isValidAddress(address), true);
  });

  it('should reject invalid address format', () => {
    assert.strictEqual(isValidAddress('invalid'), false);
    assert.strictEqual(isValidAddress('0x123'), false);
    assert.strictEqual(isValidAddress(''), false);
  });

  it('should throw on invalid input types', () => {
    assert.throws(() => toChecksumAddress(null), /Address must be a string/);
    assert.throws(() => toChecksumAddress(123), /Address must be a string/);
  });
});