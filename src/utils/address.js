import crypto from 'crypto';

/**
 * Convert address to EIP-55 checksum format
 * @param {string} address - The address to convert
 * @returns {string} Checksummed address
 */
export function toChecksumAddress(address) {
  if (typeof address !== 'string') {
    throw new Error('Address must be a string');
  }
  
  const cleanAddress = address.toLowerCase().replace('0x', '');
  if (!/^[0-9a-f]{40}$/i.test(cleanAddress)) {
    throw new Error('Invalid address format');
  }
  
  const hash = crypto.createHash('keccak256').update(cleanAddress).digest('hex');
  let checksummedAddress = '0x';
  
  for (let i = 0; i < cleanAddress.length; i++) {
    if (parseInt(hash[i], 16) >= 8) {
      checksummedAddress += cleanAddress[i].toUpperCase();
    } else {
      checksummedAddress += cleanAddress[i];
    }
  }
  
  return checksummedAddress;
}

/**
 * Validate if address is in correct EIP-55 checksum format
 * @param {string} address - The address to validate
 * @returns {boolean} True if valid checksum address
 */
export function isValidChecksumAddress(address) {
  try {
    return address === toChecksumAddress(address);
  } catch {
    return false;
  }
}

/**
 * Check if string is a valid Ethereum address (with or without checksum)
 * @param {string} address - The address to validate
 * @returns {boolean} True if valid address format
 */
export function isValidAddress(address) {
  if (typeof address !== 'string') return false;
  const cleanAddress = address.replace('0x', '');
  return /^[0-9a-f]{40}$/i.test(cleanAddress);
}