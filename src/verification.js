import { HttpClient } from './http.js';
import crypto from 'crypto';
import logger from './log.js';

/**
 * Contract verification utilities
 */
export class ContractVerifier {
  constructor(options = {}) {
    this.http = new HttpClient({
      maxRetries: options.maxRetries || 2,
      retryDelay: options.retryDelay || 1000,
      timeout: options.timeout || 15000
    });
  }

  /**
   * Fetch deployed bytecode from RPC
   * @param {string} rpcUrl - RPC endpoint URL
   * @param {string} address - Contract address
   * @returns {Promise<string>} Bytecode hex string
   */
  async fetchDeployedBytecode(rpcUrl, address) {
    if (!rpcUrl) {
      throw new Error('RPC URL is required for bytecode verification');
    }

    const payload = {
      jsonrpc: '2.0',
      method: 'eth_getCode',
      params: [address, 'latest'],
      id: 1
    };

    logger.debug('Fetching deployed bytecode', { rpcUrl, address });

    try {
      const response = await this.http.post(rpcUrl, payload);
      
      if (response.error) {
        throw new Error(`RPC error: ${response.error.message}`);
      }

      const bytecode = response.result;
      
      if (!bytecode || bytecode === '0x') {
        logger.warn('No bytecode found - address may not be a contract', { address });
        return null;
      }

      logger.debug('Fetched deployed bytecode', { 
        address, 
        length: (bytecode.length - 2) / 2 
      });

      return bytecode;

    } catch (error) {
      logger.error('Failed to fetch deployed bytecode', { 
        rpcUrl, 
        address, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Calculate keccak256 hash of bytecode
   * @param {string} bytecode - Bytecode hex string
   * @returns {string} Hash in lowercase hex
   */
  calculateBytecodeHash(bytecode) {
    if (!bytecode || bytecode === '0x') {
      return null;
    }

    // Remove 0x prefix for hashing
    const cleanBytecode = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
    const buffer = Buffer.from(cleanBytecode, 'hex');
    
    return crypto.createHash('sha256').update(buffer).digest('hex').toLowerCase();
  }

  /**
   * Verify contract bytecode against metadata
   * @param {Object} chainConfig - Chain configuration
   * @param {string} address - Contract address
   * @param {Object} metadata - Contract metadata
   * @returns {Promise<Object>} Verification result
   */
  async verifyContract(chainConfig, address, metadata) {
    const result = {
      address,
      chainId: chainConfig.chainId,
      verified: false,
      onChainBytecode: null,
      onChainHash: null,
      metadataHash: null,
      hashMatch: false,
      errors: [],
      warnings: []
    };

    try {
      // Fetch on-chain bytecode
      if (chainConfig.rpcUrl) {
        result.onChainBytecode = await this.fetchDeployedBytecode(chainConfig.rpcUrl, address);
        
        if (result.onChainBytecode) {
          result.onChainHash = this.calculateBytecodeHash(result.onChainBytecode);
        } else {
          result.warnings.push('No bytecode found on-chain - may not be a contract');
        }
      } else {
        result.warnings.push('No RPC URL configured - skipping on-chain verification');
      }

      // Extract expected bytecode hash from metadata
      if (metadata.output?.deployedBytecode?.object) {
        const metadataBytecode = metadata.output.deployedBytecode.object;
        result.metadataHash = this.calculateBytecodeHash(metadataBytecode);
      } else if (metadata.compilationTarget && metadata.sources) {
        result.warnings.push('Metadata contains sources but no deployed bytecode for verification');
      }

      // Compare hashes
      if (result.onChainHash && result.metadataHash) {
        result.hashMatch = result.onChainHash === result.metadataHash;
        
        if (result.hashMatch) {
          result.verified = true;
          logger.info('Bytecode verification successful', { 
            address, 
            chainId: chainConfig.chainId 
          });
        } else {
          result.errors.push('Bytecode hash mismatch - on-chain bytecode does not match metadata');
          logger.warn('Bytecode verification failed', { 
            address, 
            chainId: chainConfig.chainId,
            onChainHash: result.onChainHash,
            metadataHash: result.metadataHash
          });
        }
      } else {
        result.warnings.push('Cannot verify bytecode - missing on-chain data or metadata bytecode');
      }

      return result;

    } catch (error) {
      result.errors.push(`Verification failed: ${error.message}`);
      logger.error('Contract verification failed', { 
        address, 
        chainId: chainConfig.chainId, 
        error: error.message 
      });
      return result;
    }
  }

  /**
   * Create verification hashes record
   * @param {Object} verificationResult - Result from verifyContract
   * @param {Object} metadata - Contract metadata
   * @returns {Object} Hashes record for persistence
   */
  createHashesRecord(verificationResult, metadata) {
    const hashes = {
      onChainDeployedHash: verificationResult.onChainHash,
      metadataDeployedHash: verificationResult.metadataHash,
      match: verificationResult.hashMatch,
      verifiedAt: new Date().toISOString()
    };

    // Extract creation bytecode hash if available
    if (metadata.output?.bytecode?.object) {
      hashes.creationHash = this.calculateBytecodeHash(metadata.output.bytecode.object);
    }

    // Extract IPFS CIDs if available
    if (metadata.sources) {
      hashes.ipfsCids = [];
      for (const [fileName, sourceInfo] of Object.entries(metadata.sources)) {
        if (sourceInfo.urls) {
          const ipfsUrls = sourceInfo.urls.filter(url => url.startsWith('ipfs://'));
          hashes.ipfsCids.push(...ipfsUrls.map(url => url.replace('ipfs://', '')));
        }
      }
    }

    // Set Sourcify match type if available
    if (metadata.sourcify?.matchType) {
      hashes.sourcifyMatchType = metadata.sourcify.matchType;
    }

    return hashes;
  }

  /**
   * Validate contract integrity
   * @param {string} chainName - Chain name
   * @param {string} address - Contract address
   * @param {Object} archiveData - Data from archive
   * @returns {Object} Integrity check result
   */
  validateContractIntegrity(chainName, address, archiveData) {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      checks: {
        hasMetadata: false,
        hasAbi: false,
        hasSources: false,
        hasProvenance: false,
        validSchemas: false
      }
    };

    try {
      // Check required files exist
      result.checks.hasMetadata = !!archiveData.metadata;
      result.checks.hasAbi = !!archiveData.abi;
      result.checks.hasProvenance = !!archiveData.provenance;
      result.checks.hasSources = archiveData.sources && Object.keys(archiveData.sources).length > 0;

      if (!result.checks.hasMetadata) {
        result.errors.push('Missing metadata.json');
        result.valid = false;
      }

      if (!result.checks.hasProvenance) {
        result.errors.push('Missing provenance.json');
        result.valid = false;
      }

      // Validate address consistency
      if (archiveData.metadata?.address && 
          archiveData.metadata.address.toLowerCase() !== address.toLowerCase()) {
        result.errors.push('Address mismatch between metadata and archive location');
        result.valid = false;
      }

      // Check data freshness
      if (archiveData.provenance?.lastUpdatedAt) {
        const lastUpdated = new Date(archiveData.provenance.lastUpdatedAt);
        const staleThreshold = 30 * 24 * 60 * 60 * 1000; // 30 days
        
        if (Date.now() - lastUpdated.getTime() > staleThreshold) {
          result.warnings.push('Data is stale (>30 days old)');
        }
      }

      logger.debug('Contract integrity check completed', { 
        chainName, 
        address, 
        valid: result.valid,
        errors: result.errors.length,
        warnings: result.warnings.length
      });

    } catch (error) {
      result.errors.push(`Integrity check failed: ${error.message}`);
      result.valid = false;
    }

    return result;
  }
}

export default new ContractVerifier();