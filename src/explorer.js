import { HttpClient } from './http.js';
import logger from './log.js';
import { isValidChecksumAddress } from './utils/address.js';

/**
 * Explorer API client for fetching contract metadata when Sourcify fails
 */
export class ExplorerClient {
  constructor(options = {}) {
    this.http = new HttpClient({
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      timeout: options.timeout || 30000,
      cacheEnabled: options.cacheEnabled !== false
    });
  }

  /**
   * Fetch contract source code from explorer API
   * @param {Object} chainConfig - Chain configuration
   * @param {string} address - Contract address
   * @returns {Promise<Object>} Contract source data
   */
  async fetchContractSource(chainConfig, address) {
    if (!isValidChecksumAddress(address)) {
      throw new Error(`Invalid address format: ${address}`);
    }

    if (!chainConfig.explorerApiBase) {
      throw new Error(`No explorer API configured for chain ${chainConfig.chainName}`);
    }

    const apiKey = chainConfig.explorerApiKeyRef ? process.env[chainConfig.explorerApiKeyRef] : '';
    
    const params = new URLSearchParams({
      module: 'contract',
      action: 'getsourcecode',
      address: address
    });

    if (apiKey) {
      params.append('apikey', apiKey);
    }

    const url = `${chainConfig.explorerApiBase}?${params.toString()}`;

    logger.debug('Fetching contract source from explorer', { 
      chainId: chainConfig.chainId,
      chainName: chainConfig.chainName,
      address,
      url: `${chainConfig.explorerApiBase}?module=contract&action=getsourcecode&address=${address}`
    });

    try {
      const response = await this.http.get(url);

      if (response.status !== '1') {
        throw new Error(`Explorer API error: ${response.message || 'Unknown error'}`);
      }

      const result = response.result[0];
      
      if (!result || result.SourceCode === '') {
        throw new Error('Contract source code not found or not verified');
      }

      logger.info('Successfully fetched contract source from explorer', {
        chainId: chainConfig.chainId,
        address,
        contractName: result.ContractName,
        compiler: result.CompilerVersion,
        verified: result.SourceCode !== ''
      });

      return this.normalizeExplorerResponse(result, chainConfig, address);

    } catch (error) {
      logger.error('Failed to fetch contract source from explorer', { 
        chainId: chainConfig.chainId,
        address,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Normalize explorer response to our standard format
   * @param {Object} explorerResult - Raw explorer API result
   * @param {Object} chainConfig - Chain configuration
   * @param {string} address - Contract address
   * @returns {Object} Normalized contract data
   */
  normalizeExplorerResponse(explorerResult, chainConfig, address) {
    const {
      SourceCode,
      ABI,
      ContractName,
      CompilerVersion,
      OptimizationUsed,
      Runs,
      ConstructorArguments,
      EVMVersion,
      Library,
      LicenseType,
      Proxy,
      Implementation,
      SwarmSource
    } = explorerResult;

    // Parse source code - handle both single file and multi-file formats
    let sources = {};
    let sourceCode = SourceCode;
    
    try {
      // Try to parse as JSON (multi-file format)
      if (sourceCode.startsWith('{') && sourceCode.includes('sources')) {
        const parsed = JSON.parse(sourceCode);
        if (parsed.sources) {
          sources = parsed.sources;
        } else {
          // Might be wrapped in extra braces
          const innerParsed = JSON.parse(sourceCode.slice(1, -1));
          if (innerParsed.sources) {
            sources = innerParsed.sources;
          }
        }
      } else {
        // Single file format
        sources[`${ContractName}.sol`] = {
          content: sourceCode
        };
      }
    } catch (e) {
      // If parsing fails, treat as single file
      sources[`${ContractName}.sol`] = {
        content: sourceCode
      };
    }

    // Parse ABI
    let abi = [];
    try {
      abi = JSON.parse(ABI);
    } catch (e) {
      logger.warn('Failed to parse ABI from explorer', { address, error: e.message });
    }

    // Build metadata in Sourcify-compatible format
    const metadata = {
      compiler: {
        version: CompilerVersion
      },
      language: 'Solidity',
      output: {
        abi: abi
      },
      settings: {
        optimizer: {
          enabled: OptimizationUsed === '1',
          runs: parseInt(Runs) || 200
        },
        evmVersion: EVMVersion || 'default',
        libraries: Library ? JSON.parse(Library) : {}
      },
      sources: sources,
      version: 1
    };

    return {
      metadata,
      abi,
      matchType: 'explorer',
      sourceUrl: chainConfig.explorerApiBase,
      fetchedAt: new Date().toISOString(),
      explorerRaw: explorerResult,
      explorer: {
        name: this.getExplorerName(chainConfig.explorerApiBase),
        apiBase: chainConfig.explorerApiBase,
        contractName: ContractName,
        verified: true,
        sourceLicense: LicenseType,
        proxy: Proxy === '1',
        implementation: Implementation
      }
    };
  }

  /**
   * Get explorer name from API base URL
   * @param {string} apiBase - Explorer API base URL
   * @returns {string} Explorer name
   */
  getExplorerName(apiBase) {
    if (apiBase.includes('etherscan.io')) return 'Etherscan';
    if (apiBase.includes('polygonscan.com')) return 'Polygonscan';
    if (apiBase.includes('arbiscan.io')) return 'Arbiscan';
    if (apiBase.includes('optimistic.etherscan.io')) return 'Optimism Etherscan';
    if (apiBase.includes('basescan.org')) return 'Basescan';
    return 'Unknown Explorer';
  }
}

export default new ExplorerClient();