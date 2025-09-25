import fs from 'fs/promises';
import path from 'path';
import Ajv from 'ajv';
import logger from './log.js';

const CONFIG_DIR = 'config';
const CHAINS_CONFIG_FILE = path.join(CONFIG_DIR, 'chains.json');
const SETS_DIR = path.join(CONFIG_DIR, 'sets');

// JSON Schema for chains configuration
const chainsSchema = {
  type: 'object',
  properties: {
    chains: {
      type: 'object',
      patternProperties: {
        '^[a-z0-9-]+$': {
          type: 'object',
          properties: {
            chainId: { type: 'number' },
            rpcUrl: { type: 'string' },
            sourcifyChainSupport: { type: 'boolean' },
            explorerApiBase: { type: 'string' },
            explorerApiKeyRef: { type: 'string' },
            sourcifyRepoUrls: {
              type: 'array',
              items: { type: 'string' }
            },
            ipfsGateways: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['chainId', 'sourcifyChainSupport', 'sourcifyRepoUrls']
        }
      }
    }
  },
  required: ['chains']
};

// JSON Schema for registry
const registrySchema = {
  type: 'object',
  properties: {
    chainId: { type: 'number' },
    chainName: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    toolVersion: { type: 'string' },
    contracts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          alias: { type: 'string' },
          address: { type: 'string' },
          tags: {
            type: 'array',
            items: { type: 'string' }
          },
          expectedImplementation: { type: 'string' },
          notes: { type: 'string' },
          archived: { type: 'boolean' }
        },
        required: ['alias', 'address']
      }
    }
  },
  required: ['chainId', 'chainName', 'createdAt', 'updatedAt', 'toolVersion', 'contracts']
};

// JSON Schema for checksums
const checksumsSchema = {
  type: 'object',
  properties: {
    files: {
      type: 'object',
      patternProperties: {
        '.*': { type: 'string' }
      }
    }
  },
  required: ['files']
};

// JSON Schema for provenance
const provenanceSchema = {
  type: 'object',
  properties: {
    records: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          method: { type: 'string' },
          status: { type: 'number' },
          fetchedAt: { type: 'string' },
          etag: { type: 'string' },
          contentLength: { type: 'number' },
          sha256: { type: 'string' }
        },
        required: ['url', 'method', 'status', 'fetchedAt']
      }
    }
  },
  required: ['records']
};

// JSON Schema for contract sets
const contractSetSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    contracts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          alias: { type: 'string' },
          address: { type: 'string' },
          tags: {
            type: 'array',
            items: { type: 'string' }
          },
          expectedImplementation: { type: 'string' },
          notes: { type: 'string' }
        },
        required: ['alias', 'address']
      }
    }
  },
  required: ['name', 'contracts']
};

class ConfigManager {
  constructor() {
    this.ajv = new Ajv();
    this.validateChains = this.ajv.compile(chainsSchema);
    this.validateRegistry = this.ajv.compile(registrySchema);
    this.validateChecksums = this.ajv.compile(checksumsSchema);
    this.validateProvenance = this.ajv.compile(provenanceSchema);
    this.validateContractSet = this.ajv.compile(contractSetSchema);
    this._cachedConfig = null;
  }

  /**
   * Load and validate chains configuration
   * @returns {Promise<Object>} Chains configuration
   */
  async loadChainsConfig() {
    if (this._cachedConfig) {
      return this._cachedConfig;
    }

    try {
      const configData = await fs.readFile(CHAINS_CONFIG_FILE, 'utf8');
      const config = JSON.parse(configData);
      
      if (!this.validateChains(config)) {
        const errors = this.validateChains.errors;
        throw new Error(`Invalid chains configuration: ${JSON.stringify(errors)}`);
      }
      
      this._cachedConfig = config;
      logger.debug('Loaded chains configuration', { 
        chainCount: Object.keys(config.chains).length,
        chains: Object.entries(config.chains).map(([name, cfg]) => `${name}(${cfg.chainId})`)
      });
      
      return config;
    } catch (error) {
      logger.error('Failed to load chains configuration', { error: error.message });
      throw error;
    }
  }

  /**
   * Save chains configuration
   * @param {Object} config - Configuration to save
   */
  async saveChainsConfig(config) {
    if (!this.validateChains(config)) {
      const errors = this.validateChains.errors;
      throw new Error(`Invalid chains configuration: ${JSON.stringify(errors)}`);
    }

    await fs.writeFile(CHAINS_CONFIG_FILE, JSON.stringify(config, null, 2));
    this._cachedConfig = config;
    logger.info('Saved chains configuration');
  }

  /**
   * Get chain configuration by ID or name
   * @param {string|number} identifier - Chain ID or name
   * @returns {Promise<Object>} Chain configuration
   */
  async getChainConfig(identifier) {
    const config = await this.loadChainsConfig();
    
    // Look for chain by name first
    if (config.chains[identifier]) {
      return {
        chainName: identifier,
        ...config.chains[identifier]
      };
    }
    
    // Look for chain by chainId
    const chainEntry = Object.entries(config.chains).find(([name, cfg]) => 
      cfg.chainId === identifier || cfg.chainId === parseInt(identifier)
    );
    
    if (chainEntry) {
      const [chainName, chainConfig] = chainEntry;
      return {
        chainName,
        ...chainConfig
      };
    }
    
    throw new Error(`Chain not found: ${identifier}`);
  }

  /**
   * Load contract set configuration
   * @param {string} setName - Name of the contract set
   * @returns {Promise<Object>} Contract set configuration
   */
  async loadContractSet(setName) {
    try {
      const setFile = path.join(SETS_DIR, `${setName}.json`);
      const setData = await fs.readFile(setFile, 'utf8');
      const contractSet = JSON.parse(setData);
      
      if (!this.validateContractSet(contractSet)) {
        const errors = this.validateContractSet.errors;
        throw new Error(`Invalid contract set ${setName}: ${JSON.stringify(errors)}`);
      }
      
      logger.debug('Loaded contract set', { 
        setName,
        contractCount: contractSet.contracts.length
      });
      
      return contractSet;
    } catch (error) {
      logger.error('Failed to load contract set', { setName, error: error.message });
      throw error;
    }
  }

  /**
   * List available contract sets
   * @returns {Promise<string[]>} List of available contract set names
   */
  async listContractSets() {
    try {
      const files = await fs.readdir(SETS_DIR);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => path.basename(file, '.json'));
    } catch {
      return [];
    }
  }

  /**
   * Validate registry data
   * @param {Object} registry - Registry data to validate
   * @returns {boolean} True if valid
   */
  validateRegistryData(registry) {
    const isValid = this.validateRegistry(registry);
    if (!isValid) {
      logger.error('Registry validation failed', { errors: this.validateRegistry.errors });
    }
    return isValid;
  }

  /**
   * Validate checksums data
   * @param {Object} checksums - Checksums data to validate
   * @returns {boolean} True if valid
   */
  validateChecksumsData(checksums) {
    const isValid = this.validateChecksums(checksums);
    if (!isValid) {
      logger.error('Checksums validation failed', { errors: this.validateChecksums.errors });
    }
    return isValid;
  }

  /**
   * Validate provenance data
   * @param {Object} provenance - Provenance data to validate
   * @returns {boolean} True if valid
   */
  validateProvenanceData(provenance) {
    const isValid = this.validateProvenance(provenance);
    if (!isValid) {
      logger.error('Provenance validation failed', { errors: this.validateProvenance.errors });
    }
    return isValid;
  }

  /**
   * Clear cached configuration
   */
  clearCache() {
    this._cachedConfig = null;
  }
}

export default new ConfigManager();