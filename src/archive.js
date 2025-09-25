import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { toChecksumAddress } from './utils/address.js';
import { validateData, validateMetadata, validateLabels, validateProvenance, validateHashes } from './schemas.js';
import logger from './log.js';

const ARCHIVE_DIR = 'archive';
const CHAINS_DIR = 'chains';
const REPORTS_DIR = 'reports';

/**
 * Archive manager for contract metadata persistence
 */
export class ArchiveManager {
  
  /**
   * Get archive directory path for a contract
   * @param {string} chainName - Chain name
   * @param {string} address - Contract address
   * @returns {string} Archive directory path
   */
  getArchiveDir(chainName, address) {
    const checksumAddress = toChecksumAddress(address);
    return path.join(ARCHIVE_DIR, chainName, checksumAddress);
  }

  /**
   * Get addresses file path for a chain
   * @param {string} chainName - Chain name
   * @returns {string} Addresses file path
   */
  getAddressesFilePath(chainName) {
    return path.join(CHAINS_DIR, chainName, 'addresses.txt');
  }

  /**
   * Read addresses from chain addresses file
   * @param {string} chainName - Chain name
   * @returns {Promise<string[]>} Array of addresses
   */
  async readAddresses(chainName) {
    try {
      const addressesFile = this.getAddressesFilePath(chainName);
      const content = await fs.readFile(addressesFile, 'utf8');
      return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(addr => toChecksumAddress(addr));
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.warn('Addresses file not found', { chainName, file: this.getAddressesFilePath(chainName) });
        return [];
      }
      throw error;
    }
  }

  /**
   * Check if provenance exists and is not stale
   * @param {string} chainName - Chain name
   * @param {string} address - Contract address
   * @param {Object} options - Options for staleness check
   * @returns {Promise<Object>} Provenance check result
   */
  async checkProvenance(chainName, address, options = {}) {
    const archiveDir = this.getArchiveDir(chainName, address);
    const provenancePath = path.join(archiveDir, 'provenance.json');

    try {
      const provenanceData = await fs.readFile(provenancePath, 'utf8');
      const provenance = JSON.parse(provenanceData);
      
      validateData(provenance, validateProvenance, 'provenance');

      const lastUpdated = new Date(provenance.lastUpdatedAt);
      const staleThreshold = options.staleThreshold || 24 * 60 * 60 * 1000; // 24 hours default
      const isStale = Date.now() - lastUpdated.getTime() > staleThreshold;

      return {
        exists: true,
        provenance,
        isStale,
        shouldSkip: !isStale && !options.force
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          exists: false,
          provenance: null,
          isStale: true,
          shouldSkip: false
        };
      }
      throw error;
    }
  }

  /**
   * Persist contract artifacts to archive
   * @param {string} chainName - Chain name
   * @param {string} address - Contract address
   * @param {Object} contractData - Contract data to persist
   * @returns {Promise<void>}
   */
  async persistContract(chainName, address, contractData) {
    const archiveDir = this.getArchiveDir(chainName, address);
    await fs.mkdir(archiveDir, { recursive: true });

    const {
      metadata,
      abi,
      sources,
      bytecode,
      labels,
      provenance,
      hashes
    } = contractData;

    // Save metadata.json
    if (metadata) {
      validateData(metadata, validateMetadata, 'metadata');
      await this.writeJsonFile(path.join(archiveDir, 'metadata.json'), metadata);
    }

    // Save abi.json
    if (abi) {
      await this.writeJsonFile(path.join(archiveDir, 'abi.json'), abi);
    }

    // Save source files
    if (sources && Object.keys(sources).length > 0) {
      const sourceDir = path.join(archiveDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });

      for (const [filePath, content] of Object.entries(sources)) {
        const fullPath = path.join(sourceDir, filePath);
        const fileDir = path.dirname(fullPath);
        await fs.mkdir(fileDir, { recursive: true });
        
        if (typeof content === 'string') {
          await fs.writeFile(fullPath, content, 'utf8');
        } else if (content.content) {
          await fs.writeFile(fullPath, content.content, 'utf8');
        }
      }
    }

    // Save bytecode files
    if (bytecode) {
      const bytecodeDir = path.join(archiveDir, 'bytecode');
      await fs.mkdir(bytecodeDir, { recursive: true });

      if (bytecode.deployed) {
        await fs.writeFile(path.join(bytecodeDir, 'deployed.hex'), bytecode.deployed);
      }
      if (bytecode.creation) {
        await fs.writeFile(path.join(bytecodeDir, 'creation.hex'), bytecode.creation);
      }
    }

    // Save hashes.json
    if (hashes) {
      validateData(hashes, validateHashes, 'hashes');
      const bytecodeDir = path.join(archiveDir, 'bytecode');
      await fs.mkdir(bytecodeDir, { recursive: true });
      await this.writeJsonFile(path.join(bytecodeDir, 'hashes.json'), hashes);
    }

    // Save labels.json
    if (labels) {
      validateData(labels, validateLabels, 'labels');
      await this.writeJsonFile(path.join(archiveDir, 'labels.json'), labels);
    }

    // Save provenance.json
    if (provenance) {
      validateData(provenance, validateProvenance, 'provenance');
      await this.writeJsonFile(path.join(archiveDir, 'provenance.json'), provenance);
    }

    logger.info('Contract artifacts persisted', { 
      chainName, 
      address: toChecksumAddress(address),
      archiveDir 
    });
  }

  /**
   * Write JSON file with deterministic formatting
   * @param {string} filePath - File path
   * @param {Object} data - Data to write
   * @returns {Promise<void>}
   */
  async writeJsonFile(filePath, data) {
    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, content, 'utf8');
  }

  /**
   * Create provenance record
   * @param {Object} options - Provenance options
   * @returns {Object} Provenance record
   */
  createProvenance(options = {}) {
    const now = new Date().toISOString();
    
    return {
      firstSeenAt: options.firstSeenAt || now,
      lastUpdatedAt: now,
      tools: {
        name: 'sourcify-grabber',
        version: options.toolVersion || '2.0.0'
      },
      sourcesUsed: options.sourcesUsed || [],
      fetchRunId: options.fetchRunId || this.generateRunId(),
      commitHash: options.commitHash,
      operator: options.operator || 'automated'
    };
  }

  /**
   * Generate unique run ID
   * @returns {string} Run ID
   */
  generateRunId() {
    return `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate keccak256 hash
   * @param {string} data - Data to hash
   * @returns {string} Hash in lowercase hex
   */
  keccak256(data) {
    return crypto.createHash('sha3-256').update(data).digest('hex').toLowerCase();
  }

  /**
   * Update labels for a contract
   * @param {string} chainName - Chain name
   * @param {string} address - Contract address
   * @param {Object} labelUpdates - Label updates
   * @returns {Promise<void>}
   */
  async updateLabels(chainName, address, labelUpdates) {
    const archiveDir = this.getArchiveDir(chainName, address);
    const labelsPath = path.join(archiveDir, 'labels.json');

    let labels = {};
    try {
      const existingData = await fs.readFile(labelsPath, 'utf8');
      labels = JSON.parse(existingData);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // Merge updates
    labels = { ...labels, ...labelUpdates };

    validateData(labels, validateLabels, 'labels');
    await this.writeJsonFile(labelsPath, labels);

    logger.info('Labels updated', { chainName, address: toChecksumAddress(address) });
  }

  /**
   * Mark contract as orphaned
   * @param {string} chainName - Chain name  
   * @param {string} address - Contract address
   * @returns {Promise<void>}
   */
  async markOrphaned(chainName, address) {
    const archiveDir = this.getArchiveDir(chainName, address);
    const provenancePath = path.join(archiveDir, 'provenance.json');

    try {
      const provenanceData = await fs.readFile(provenancePath, 'utf8');
      const provenance = JSON.parse(provenanceData);
      
      provenance.orphaned = true;
      provenance.lastUpdatedAt = new Date().toISOString();

      await this.writeJsonFile(provenancePath, provenance);
      logger.info('Contract marked as orphaned', { chainName, address: toChecksumAddress(address) });
    } catch (error) {
      logger.warn('Failed to mark contract as orphaned', { 
        chainName, 
        address: toChecksumAddress(address), 
        error: error.message 
      });
    }
  }

  /**
   * Get all contracts in archive for a chain
   * @param {string} chainName - Chain name
   * @returns {Promise<string[]>} Array of contract addresses
   */
  async getArchivedContracts(chainName) {
    const chainArchiveDir = path.join(ARCHIVE_DIR, chainName);
    
    try {
      const entries = await fs.readdir(chainArchiveDir);
      return entries.filter(entry => entry.match(/^0x[a-fA-F0-9]{40}$/));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}

export default new ArchiveManager();