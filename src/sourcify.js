import httpClient from './http.js';
import logger from './log.js';
import { isValidChecksumAddress, toChecksumAddress } from './utils/address.js';

/**
 * Sourcify API client for fetching contract metadata and sources
 */
export class SourcefyClient {
  constructor(options = {}) {
    this.baseUrls = options.baseUrls || ['https://repo.sourcify.dev'];
    this.ipfsGateways = options.ipfsGateways || ['https://ipfs.io/ipfs'];
    this.http = options.httpClient || httpClient;
  }

  /**
   * Get metadata URL for a contract
   * @param {string} baseUrl - Sourcify base URL
   * @param {number} chainId - Chain ID
   * @param {string} address - Contract address
   * @param {string} matchType - Match type ('full' or 'partial')
   * @returns {string} Metadata URL
   */
  getMetadataUrl(baseUrl, chainId, address, matchType = 'full') {
    const checksumAddress = toChecksumAddress(address);
    return `${baseUrl}/contracts/${matchType}_match/${chainId}/${checksumAddress}/metadata.json`;
  }

  /**
   * Get sources URL for a contract
   * @param {string} baseUrl - Sourcify base URL
   * @param {number} chainId - Chain ID
   * @param {string} address - Contract address
   * @param {string} matchType - Match type ('full' or 'partial')
   * @returns {string} Sources URL
   */
  getSourcesUrl(baseUrl, chainId, address, matchType = 'full') {
    const checksumAddress = toChecksumAddress(address);
    return `${baseUrl}/contracts/${matchType}_match/${chainId}/${checksumAddress}/sources`;
  }

  /**
   * Get file URL for a specific source file
   * @param {string} baseUrl - Sourcify base URL
   * @param {number} chainId - Chain ID
   * @param {string} address - Contract address
   * @param {string} filePath - File path within the contract
   * @param {string} matchType - Match type ('full' or 'partial')
   * @returns {string} File URL
   */
  getFileUrl(baseUrl, chainId, address, filePath, matchType = 'full') {
    const checksumAddress = toChecksumAddress(address);
    const encodedPath = encodeURIComponent(filePath);
    return `${baseUrl}/contracts/${matchType}_match/${chainId}/${checksumAddress}/sources/${encodedPath}`;
  }

  /**
   * Fetch contract metadata from Sourcify
   * @param {number} chainId - Chain ID
   * @param {string} address - Contract address
   * @returns {Promise<Object>} Contract metadata with source info
   */
  async fetchMetadata(chainId, address) {
    if (!isValidChecksumAddress(address)) {
      throw new Error(`Invalid address format: ${address}`);
    }

    let lastError;
    
    // Try full match first, then partial match
    for (const matchType of ['full', 'partial']) {
      for (const baseUrl of this.baseUrls) {
        try {
          const url = this.getMetadataUrl(baseUrl, chainId, address, matchType);
          
          logger.debug('Fetching metadata', { 
            chainId, 
            address, 
            matchType, 
            url 
          });

          const metadata = await this.http.get(url);
          
          logger.info('Successfully fetched metadata', {
            chainId,
            address,
            matchType,
            compiler: metadata.compiler?.version,
            sources: Object.keys(metadata.sources || {}).length
          });

          return {
            metadata,
            matchType,
            sourceUrl: baseUrl,
            fetchedAt: new Date().toISOString()
          };

        } catch (error) {
          lastError = error;
          const status = error.response?.status;
          
          if (status === 404) {
            logger.debug('Metadata not found', { 
              chainId, 
              address, 
              matchType, 
              baseUrl 
            });
            continue;
          }
          
          logger.warn('Failed to fetch metadata', {
            chainId,
            address,
            matchType,
            baseUrl,
            error: error.message,
            status
          });
        }
      }
    }

    throw new Error(`Failed to fetch metadata for ${address} on chain ${chainId}: ${lastError?.message}`);
  }

  /**
   * Fetch individual source file
   * @param {number} chainId - Chain ID
   * @param {string} address - Contract address
   * @param {string} filePath - Path to the source file
   * @param {string} matchType - Match type
   * @returns {Promise<string>} Source file content
   */
  async fetchSourceFile(chainId, address, filePath, matchType = 'full') {
    let lastError;
    
    for (const baseUrl of this.baseUrls) {
      try {
        const url = this.getFileUrl(baseUrl, chainId, address, filePath, matchType);
        
        logger.debug('Fetching source file', { 
          chainId, 
          address, 
          filePath, 
          matchType, 
          url 
        });

        const content = await this.http.get(url);
        
        logger.debug('Successfully fetched source file', {
          chainId,
          address,
          filePath,
          matchType,
          size: content.length
        });

        return content;

      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        
        if (status === 404) {
          logger.debug('Source file not found', { 
            chainId, 
            address, 
            filePath, 
            matchType, 
            baseUrl 
          });
          continue;
        }
        
        logger.warn('Failed to fetch source file', {
          chainId,
          address,
          filePath,
          matchType,
          baseUrl,
          error: error.message,
          status
        });
      }
    }

    throw new Error(`Failed to fetch source file ${filePath} for ${address} on chain ${chainId}: ${lastError?.message}`);
  }

  /**
   * Fetch all source files for a contract
   * @param {number} chainId - Chain ID
   * @param {string} address - Contract address
   * @param {Object} metadata - Contract metadata containing sources info
   * @param {string} matchType - Match type
   * @returns {Promise<Object>} Map of file paths to content
   */
  async fetchAllSources(chainId, address, metadata, matchType = 'full') {
    const sources = {};
    
    if (!metadata.sources) {
      logger.debug('No sources available in metadata', { chainId, address });
      return sources;
    }

    const sourceFiles = Object.keys(metadata.sources);
    logger.info('Fetching source files', { 
      chainId, 
      address, 
      fileCount: sourceFiles.length 
    });

    const fetchPromises = sourceFiles.map(async (filePath) => {
      try {
        const content = await this.fetchSourceFile(chainId, address, filePath, matchType);
        sources[filePath] = content;
      } catch (error) {
        logger.warn('Failed to fetch source file', {
          chainId,
          address,
          filePath,
          error: error.message
        });
        // Continue with other files even if one fails
      }
    });

    await Promise.all(fetchPromises);
    
    logger.info('Fetched source files', { 
      chainId, 
      address, 
      requested: sourceFiles.length,
      fetched: Object.keys(sources).length
    });

    return sources;
  }

  /**
   * Check if contract exists in Sourcify
   * @param {number} chainId - Chain ID
   * @param {string} address - Contract address
   * @returns {Promise<Object|null>} Basic info if exists, null otherwise
   */
  async checkContractExists(chainId, address) {
    if (!isValidChecksumAddress(address)) {
      throw new Error(`Invalid address format: ${address}`);
    }

    // Try both match types
    for (const matchType of ['full', 'partial']) {
      for (const baseUrl of this.baseUrls) {
        try {
          const url = this.getMetadataUrl(baseUrl, chainId, address, matchType);
          
          // Use HEAD request to check existence without downloading
          await this.http.request('HEAD', url);
          
          return {
            exists: true,
            matchType,
            sourceUrl: baseUrl
          };

        } catch (error) {
          if (error.response?.status !== 404) {
            logger.warn('Error checking contract existence', {
              chainId,
              address,
              matchType,
              baseUrl,
              error: error.message
            });
          }
        }
      }
    }

    return null;
  }

  /**
   * Fetch contract from IPFS using CID from metadata
   * @param {string} cid - IPFS CID
   * @returns {Promise<Object>} Contract data from IPFS
   */
  async fetchFromIpfs(cid) {
    let lastError;
    
    for (const gateway of this.ipfsGateways) {
      try {
        const url = `${gateway}/${cid}`;
        
        logger.debug('Fetching from IPFS', { cid, gateway });

        const data = await this.http.get(url);
        
        logger.info('Successfully fetched from IPFS', { cid, gateway });
        
        return data;

      } catch (error) {
        lastError = error;
        logger.warn('Failed to fetch from IPFS gateway', {
          cid,
          gateway,
          error: error.message
        });
      }
    }

    throw new Error(`Failed to fetch CID ${cid} from IPFS: ${lastError?.message}`);
  }
}

export default new SourcefyClient();