import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

/**
 * Calculate SHA256 hash of a string
 * @param {string} content - Content to hash
 * @returns {string} SHA256 hash
 */
export function hashString(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Calculate SHA256 hash of a file
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} SHA256 hash
 */
export async function hashFile(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Generate checksums for all files in a directory
 * @param {string} directoryPath - Directory to scan
 * @param {string} relativeTo - Base path for relative file paths
 * @returns {Promise<Object>} Map of relative file paths to SHA256 hashes
 */
export async function generateChecksums(directoryPath, relativeTo = directoryPath) {
  const checksums = {};
  
  async function scanDirectory(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        await scanDirectory(fullPath);
      } else if (entry.isFile()) {
        const relativePath = path.relative(relativeTo, fullPath);
        checksums[relativePath] = await hashFile(fullPath);
      }
    }
  }
  
  await scanDirectory(directoryPath);
  return checksums;
}

/**
 * Verify checksums against stored values
 * @param {string} directoryPath - Directory to verify
 * @param {Object} expectedChecksums - Expected checksums map
 * @param {string} relativeTo - Base path for relative file paths
 * @returns {Promise<Object>} Verification results
 */
export async function verifyChecksums(directoryPath, expectedChecksums, relativeTo = directoryPath) {
  const currentChecksums = await generateChecksums(directoryPath, relativeTo);
  const results = {
    valid: true,
    missingFiles: [],
    extraFiles: [],
    mismatchedFiles: []
  };
  
  // Check for missing files
  for (const expectedFile of Object.keys(expectedChecksums)) {
    if (!currentChecksums[expectedFile]) {
      results.missingFiles.push(expectedFile);
      results.valid = false;
    }
  }
  
  // Check for extra files and mismatches
  for (const [currentFile, currentHash] of Object.entries(currentChecksums)) {
    if (!expectedChecksums[currentFile]) {
      results.extraFiles.push(currentFile);
    } else if (expectedChecksums[currentFile] !== currentHash) {
      results.mismatchedFiles.push({
        file: currentFile,
        expected: expectedChecksums[currentFile],
        actual: currentHash
      });
      results.valid = false;
    }
  }
  
  return results;
}