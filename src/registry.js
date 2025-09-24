import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import logger from './log.js';
import { isValidChecksumAddress, toChecksumAddress } from './utils/address.js';

const TOOL_VERSION = '1.0.0';
const DATA_DIR = 'data';

/**
 * Registry manager for contract tracking per chain
 */
export class RegistryManager {
  constructor() {
    this.config = config;
  }

  /**
   * Get registry file path for a chain
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @returns {string} Registry file path
   */
  getRegistryPath(chainId, chainName) {
    const chainDir = `${chainId}-${chainName}`;
    return path.join(DATA_DIR, chainDir, 'registry.json');
  }

  /**
   * Get chain directory path
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @returns {string} Chain directory path
   */
  getChainDir(chainId, chainName) {
    return path.join(DATA_DIR, `${chainId}-${chainName}`);
  }

  /**
   * Get contract directory path
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @param {string} alias - Contract alias
   * @param {string} address - Contract address
   * @returns {string} Contract directory path
   */
  getContractDir(chainId, chainName, alias, address) {
    const chainDir = this.getChainDir(chainId, chainName);
    const checksumAddress = toChecksumAddress(address);
    return path.join(chainDir, 'contracts', `${alias}-${checksumAddress}`);
  }

  /**
   * Initialize chain directory and registry
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @returns {Promise<void>}
   */
  async initChain(chainId, chainName) {
    const chainDir = this.getChainDir(chainId, chainName);
    const registryPath = this.getRegistryPath(chainId, chainName);

    // Create directory structure
    await fs.mkdir(path.join(chainDir, 'contracts'), { recursive: true });
    await fs.mkdir(path.join(chainDir, 'incoming'), { recursive: true });

    // Check if registry already exists
    try {
      await fs.access(registryPath);
      logger.info('Chain already initialized', { chainId, chainName });
      return;
    } catch {
      // Registry doesn't exist, create it
    }

    const registry = {
      chainId,
      chainName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      toolVersion: TOOL_VERSION,
      contracts: []
    };

    if (!this.config.validateRegistryData(registry)) {
      throw new Error('Failed to create valid registry');
    }

    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
    
    logger.info('Initialized chain', { 
      chainId, 
      chainName, 
      directory: chainDir 
    });
  }

  /**
   * Load registry for a chain
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @returns {Promise<Object>} Registry data
   */
  async loadRegistry(chainId, chainName) {
    const registryPath = this.getRegistryPath(chainId, chainName);
    
    try {
      const registryData = await fs.readFile(registryPath, 'utf8');
      const registry = JSON.parse(registryData);
      
      if (!this.config.validateRegistryData(registry)) {
        throw new Error('Invalid registry format');
      }
      
      logger.debug('Loaded registry', { 
        chainId, 
        chainName, 
        contractCount: registry.contracts.length 
      });
      
      return registry;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Chain not initialized: ${chainName}(${chainId}). Run init-chain first.`);
      }
      throw error;
    }
  }

  /**
   * Save registry for a chain
   * @param {Object} registry - Registry data to save
   * @returns {Promise<void>}
   */
  async saveRegistry(registry) {
    if (!this.config.validateRegistryData(registry)) {
      throw new Error('Invalid registry format');
    }

    registry.updatedAt = new Date().toISOString();
    registry.toolVersion = TOOL_VERSION;

    const registryPath = this.getRegistryPath(registry.chainId, registry.chainName);
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
    
    logger.debug('Saved registry', { 
      chainId: registry.chainId, 
      chainName: registry.chainName,
      contractCount: registry.contracts.length
    });
  }

  /**
   * Add contract to registry
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @param {Object} contractInfo - Contract information
   * @returns {Promise<void>}
   */
  async addContract(chainId, chainName, contractInfo) {
    const { alias, address, tags = [], expectedImplementation, notes } = contractInfo;

    if (!alias || !address) {
      throw new Error('Contract alias and address are required');
    }

    if (!isValidChecksumAddress(address)) {
      throw new Error(`Invalid address format: ${address}`);
    }

    const checksumAddress = toChecksumAddress(address);
    const registry = await this.loadRegistry(chainId, chainName);

    // Check if contract already exists
    const existingContract = registry.contracts.find(c => 
      c.address.toLowerCase() === checksumAddress.toLowerCase() ||
      c.alias === alias
    );

    if (existingContract) {
      if (existingContract.address.toLowerCase() === checksumAddress.toLowerCase()) {
        throw new Error(`Contract with address ${checksumAddress} already exists`);
      }
      if (existingContract.alias === alias) {
        throw new Error(`Contract with alias '${alias}' already exists`);
      }
    }

    const contract = {
      alias,
      address: checksumAddress,
      tags,
      archived: false
    };

    if (expectedImplementation) {
      contract.expectedImplementation = toChecksumAddress(expectedImplementation);
    }

    if (notes) {
      contract.notes = notes;
    }

    registry.contracts.push(contract);
    await this.saveRegistry(registry);

    logger.info('Added contract to registry', {
      chainId,
      chainName,
      alias,
      address: checksumAddress,
      tags
    });
  }

  /**
   * Remove contract from registry (mark as archived)
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @param {string} address - Contract address
   * @returns {Promise<void>}
   */
  async removeContract(chainId, chainName, address) {
    if (!isValidChecksumAddress(address)) {
      throw new Error(`Invalid address format: ${address}`);
    }

    const checksumAddress = toChecksumAddress(address);
    const registry = await this.loadRegistry(chainId, chainName);

    const contractIndex = registry.contracts.findIndex(c => 
      c.address.toLowerCase() === checksumAddress.toLowerCase()
    );

    if (contractIndex === -1) {
      throw new Error(`Contract with address ${checksumAddress} not found`);
    }

    // Mark as archived instead of removing
    registry.contracts[contractIndex].archived = true;
    registry.contracts[contractIndex].archivedAt = new Date().toISOString();

    await this.saveRegistry(registry);

    logger.info('Archived contract in registry', {
      chainId,
      chainName,
      address: checksumAddress,
      alias: registry.contracts[contractIndex].alias
    });
  }

  /**
   * Get contract from registry
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @param {string} identifier - Contract address or alias
   * @returns {Promise<Object>} Contract information
   */
  async getContract(chainId, chainName, identifier) {
    const registry = await this.loadRegistry(chainId, chainName);

    const contract = registry.contracts.find(c => {
      if (isValidChecksumAddress(identifier)) {
        return c.address.toLowerCase() === identifier.toLowerCase();
      }
      return c.alias === identifier;
    });

    if (!contract) {
      throw new Error(`Contract not found: ${identifier}`);
    }

    if (contract.archived) {
      throw new Error(`Contract is archived: ${identifier}`);
    }

    return contract;
  }

  /**
   * List all contracts in registry
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @param {boolean} includeArchived - Include archived contracts
   * @returns {Promise<Object[]>} List of contracts
   */
  async listContracts(chainId, chainName, includeArchived = false) {
    const registry = await this.loadRegistry(chainId, chainName);

    let contracts = registry.contracts;
    if (!includeArchived) {
      contracts = contracts.filter(c => !c.archived);
    }

    return contracts;
  }

  /**
   * Switch contract set for a chain
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @param {string} setName - Contract set name
   * @returns {Promise<void>}
   */
  async switchContractSet(chainId, chainName, setName) {
    const contractSet = await this.config.loadContractSet(setName);
    const registry = await this.loadRegistry(chainId, chainName);

    // Backup current contracts
    const backupPath = path.join(
      this.getChainDir(chainId, chainName),
      `contracts-backup-${Date.now()}.json`
    );
    
    await fs.writeFile(backupPath, JSON.stringify({
      backedUpAt: new Date().toISOString(),
      setName: `previous-${setName}`,
      contracts: registry.contracts
    }, null, 2));

    // Replace contracts with set
    registry.contracts = contractSet.contracts.map(contract => ({
      ...contract,
      address: toChecksumAddress(contract.address),
      archived: false
    }));

    await this.saveRegistry(registry);

    logger.info('Switched contract set', {
      chainId,
      chainName,
      setName,
      contractCount: registry.contracts.length,
      backupPath
    });
  }

  /**
   * Get registry status for all chains
   * @returns {Promise<Object[]>} Status information for all chains
   */
  async getGlobalStatus() {
    const chainsConfig = await this.config.loadChainsConfig();
    const status = [];

    for (const chain of chainsConfig.chains) {
      try {
        const registry = await this.loadRegistry(chain.chainId, chain.chainName);
        const contracts = registry.contracts.filter(c => !c.archived);
        
        // Check how many contracts have been fetched
        let fetchedCount = 0;
        for (const contract of contracts) {
          try {
            const contractDir = this.getContractDir(
              chain.chainId, 
              chain.chainName, 
              contract.alias, 
              contract.address
            );
            await fs.access(path.join(contractDir, 'metadata.json'));
            fetchedCount++;
          } catch {
            // Contract not fetched yet
          }
        }

        status.push({
          chainId: chain.chainId,
          chainName: chain.chainName,
          totalTracked: contracts.length,
          fetchedOk: fetchedCount,
          missingAbi: contracts.length - fetchedCount,
          lastRefresh: registry.updatedAt
        });
      } catch (error) {
        status.push({
          chainId: chain.chainId,
          chainName: chain.chainName,
          error: error.message,
          totalTracked: 0,
          fetchedOk: 0,
          missingAbi: 0,
          lastRefresh: null
        });
      }
    }

    return status;
  }
}

export default new RegistryManager();