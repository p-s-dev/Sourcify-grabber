import fs from 'fs/promises';
import path from 'path';
import registry from './registry.js';
import normalize from './normalize.js';
import logger from './log.js';

const EXPORTS_DIR = 'exports';

/**
 * Export manager for generating language-agnostic interface bundles
 */
export class ExportManager {
  constructor(options = {}) {
    this.registry = options.registryManager || registry;
    this.normalizer = options.normalizer || normalize;
  }

  /**
   * Get export directory path for a chain
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @returns {string} Export directory path
   */
  getExportDir(chainId, chainName) {
    return path.join(EXPORTS_DIR, `${chainId}-${chainName}`);
  }

  /**
   * Get interface directory path for a chain
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @returns {string} Interface directory path
   */
  getInterfaceDir(chainId, chainName) {
    return path.join(this.getExportDir(chainId, chainName), 'interfaces');
  }

  /**
   * Get contract interface directory path
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @param {string} alias - Contract alias
   * @param {string} address - Contract address
   * @returns {string} Contract interface directory path
   */
  getContractInterfaceDir(chainId, chainName, alias, address) {
    const interfaceDir = this.getInterfaceDir(chainId, chainName);
    return path.join(interfaceDir, `${alias}-${address}`);
  }

  /**
   * Load contract data for export
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @param {Object} contract - Contract info from registry
   * @returns {Promise<Object>} Contract data
   */
  async loadContractData(chainId, chainName, contract) {
    const contractDir = this.registry.getContractDir(chainId, chainName, contract.alias, contract.address);
    
    try {
      // Load metadata
      const metadataPath = path.join(contractDir, 'metadata.json');
      const metadataData = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(metadataData);

      // Load ABI
      const abiPath = path.join(contractDir, 'abi.json');
      let abi;
      try {
        const abiData = await fs.readFile(abiPath, 'utf8');
        abi = JSON.parse(abiData);
      } catch {
        // Extract ABI from metadata if separate ABI file doesn't exist
        abi = this.normalizer.extractAbi(metadata);
      }

      // Load provenance
      const provenancePath = path.join(contractDir, 'provenance.json');
      let provenance = null;
      try {
        const provenanceData = await fs.readFile(provenancePath, 'utf8');
        provenance = JSON.parse(provenanceData);
      } catch {
        // Provenance is optional
      }

      return {
        contract,
        metadata,
        abi,
        provenance
      };
    } catch (error) {
      throw new Error(`Failed to load contract data for ${contract.alias}: ${error.message}`);
    }
  }

  /**
   * Export contract interface bundle
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @param {Object} contractData - Contract data to export
   * @returns {Promise<Object>} Export result
   */
  async exportContractInterface(chainId, chainName, contractData) {
    const { contract, metadata, abi, provenance } = contractData;
    
    const interfaceDir = this.getContractInterfaceDir(chainId, chainName, contract.alias, contract.address);
    await fs.mkdir(interfaceDir, { recursive: true });

    // Generate schema from ABI
    const schema = this.normalizer.generateSchema(abi);
    const hints = this.normalizer.generateHints(abi);

    // Export ABI
    const abiPath = path.join(interfaceDir, 'abi.json');
    await fs.writeFile(abiPath, JSON.stringify(abi, null, 2));

    // Export schema
    const schemaPath = path.join(interfaceDir, 'schema.json');
    await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2));

    // Export hints
    const hintsPath = path.join(interfaceDir, 'hints.json');
    await fs.writeFile(hintsPath, JSON.stringify(hints, null, 2));

    // Create metadata summary
    const summary = {
      contract: {
        alias: contract.alias,
        address: contract.address,
        tags: contract.tags || [],
        notes: contract.notes
      },
      compiler: {
        version: metadata.compiler?.version,
        settings: metadata.settings
      },
      export: {
        exportedAt: new Date().toISOString(),
        functions: schema.functions.length,
        events: schema.events.length,
        errors: schema.errors.length,
        hasConstructor: !!schema.constructor,
        hasFallback: !!schema.fallback,
        hasReceive: !!schema.receive
      }
    };

    if (provenance) {
      summary.provenance = {
        fetchedAt: provenance.records?.[0]?.fetchedAt,
        sourceUrl: provenance.records?.[0]?.url
      };
    }

    const summaryPath = path.join(interfaceDir, 'summary.json');
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

    logger.debug('Exported contract interface', {
      chainId,
      chainName,
      alias: contract.alias,
      address: contract.address,
      interfaceDir
    });

    return {
      alias: contract.alias,
      address: contract.address,
      interfaceDir: path.relative(this.getExportDir(chainId, chainName), interfaceDir),
      files: {
        abi: 'abi.json',
        schema: 'schema.json',
        hints: 'hints.json',
        summary: 'summary.json'
      }
    };
  }

  /**
   * Export interfaces for multiple contracts
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @param {string[]|null} contractIdentifiers - Contract addresses/aliases, or null for all
   * @returns {Promise<Object>} Export results
   */
  async exportInterfaces(chainId, chainName, contractIdentifiers = null) {
    const exportDir = this.getExportDir(chainId, chainName);
    await fs.mkdir(exportDir, { recursive: true });

    // Get contracts to export
    let contracts;
    if (contractIdentifiers && contractIdentifiers.length > 0) {
      contracts = [];
      for (const identifier of contractIdentifiers) {
        try {
          const contract = await this.registry.getContract(chainId, chainName, identifier);
          contracts.push(contract);
        } catch (error) {
          logger.warn('Skipping contract for export', { 
            chainId, 
            chainName, 
            identifier, 
            error: error.message 
          });
        }
      }
    } else {
      contracts = await this.registry.listContracts(chainId, chainName, false);
    }

    if (contracts.length === 0) {
      throw new Error('No contracts found to export');
    }

    logger.info('Starting interface export', {
      chainId,
      chainName,
      contractCount: contracts.length
    });

    // Export each contract
    const results = [];
    const errors = [];

    for (const contract of contracts) {
      try {
        const contractData = await this.loadContractData(chainId, chainName, contract);
        const exportResult = await this.exportContractInterface(chainId, chainName, contractData);
        results.push(exportResult);
      } catch (error) {
        const errorInfo = {
          alias: contract.alias,
          address: contract.address,
          error: error.message
        };
        errors.push(errorInfo);
        logger.error('Failed to export contract interface', {
          chainId,
          chainName,
          alias: contract.alias,
          address: contract.address,
          error: error.message
        });
      }
    }

    // Create manifest
    const manifest = {
      chain: {
        chainId,
        chainName
      },
      export: {
        exportedAt: new Date().toISOString(),
        totalContracts: contracts.length,
        successfulExports: results.length,
        failedExports: errors.length,
        format: 'interfaces'
      },
      contracts: results,
      errors: errors.length > 0 ? errors : undefined
    };

    const manifestPath = path.join(exportDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    logger.info('Interface export completed', {
      chainId,
      chainName,
      total: contracts.length,
      successful: results.length,
      failed: errors.length,
      manifestPath
    });

    return manifest;
  }

  /**
   * Export interfaces for contracts from a specific set
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @param {string} setName - Contract set name
   * @returns {Promise<Object>} Export results
   */
  async exportContractSet(chainId, chainName, setName) {
    logger.info('Exporting contract set interfaces', { chainId, chainName, setName });
    
    // Get all contracts in the registry
    const registryContracts = await this.registry.listContracts(chainId, chainName, false);
    
    // Load the contract set to get the list
    const config = await import('./config.js');
    const contractSet = await config.default.loadContractSet(setName);
    
    // Find matching contracts by address
    const matchingContracts = registryContracts.filter(regContract => 
      contractSet.contracts.some(setContract => 
        setContract.address.toLowerCase() === regContract.address.toLowerCase()
      )
    );

    if (matchingContracts.length === 0) {
      throw new Error(`No contracts from set '${setName}' found in registry`);
    }

    const contractIdentifiers = matchingContracts.map(c => c.alias);
    return await this.exportInterfaces(chainId, chainName, contractIdentifiers);
  }

  /**
   * Generate TypeScript definitions from schema (optional helper)
   * @param {Object} schema - Contract schema
   * @param {string} contractName - Contract name
   * @returns {string} TypeScript definition
   */
  generateTypeScriptDefinitions(schema, contractName) {
    let typescript = `// Generated TypeScript definitions for ${contractName}\n\n`;
    
    // Generate function types
    if (schema.functions.length > 0) {
      typescript += `export interface ${contractName}Functions {\n`;
      for (const func of schema.functions) {
        const inputTypes = func.inputs.map(input => 
          `${input.name || 'param'}: ${this.solidityTypeToTypeScript(input.type)}`
        ).join(', ');
        
        const outputTypes = func.outputs.length === 0 ? 'void' :
          func.outputs.length === 1 ? this.solidityTypeToTypeScript(func.outputs[0].type) :
          `[${func.outputs.map(output => this.solidityTypeToTypeScript(output.type)).join(', ')}]`;
        
        typescript += `  ${func.name}(${inputTypes}): Promise<${outputTypes}>;\n`;
      }
      typescript += `}\n\n`;
    }

    // Generate event types
    if (schema.events.length > 0) {
      typescript += `export interface ${contractName}Events {\n`;
      for (const event of schema.events) {
        const eventArgs = event.inputs.map(input =>
          `${input.name || 'param'}: ${this.solidityTypeToTypeScript(input.type)}`
        ).join(', ');
        
        typescript += `  ${event.name}: { ${eventArgs} };\n`;
      }
      typescript += `}\n\n`;
    }

    return typescript;
  }

  /**
   * Convert Solidity type to TypeScript type (helper)
   * @param {string} solidityType - Solidity type
   * @returns {string} TypeScript type
   */
  solidityTypeToTypeScript(solidityType) {
    // Basic type mappings
    const typeMap = {
      'address': 'string',
      'bool': 'boolean',
      'string': 'string',
      'bytes': 'string'
    };

    if (typeMap[solidityType]) {
      return typeMap[solidityType];
    }

    // Handle arrays
    if (solidityType.endsWith('[]')) {
      const baseType = solidityType.slice(0, -2);
      return `${this.solidityTypeToTypeScript(baseType)}[]`;
    }

    // Handle fixed arrays
    const fixedArrayMatch = solidityType.match(/^(.+)\[(\d+)\]$/);
    if (fixedArrayMatch) {
      const baseType = fixedArrayMatch[1];
      return `${this.solidityTypeToTypeScript(baseType)}[]`;
    }

    // Handle integer types
    if (solidityType.match(/^u?int\d*$/)) {
      return 'bigint';
    }

    // Handle bytes types
    if (solidityType.match(/^bytes\d+$/)) {
      return 'string';
    }

    // Default to string for unknown types
    return 'string';
  }

  /**
   * List available exports for a chain
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @returns {Promise<Object>} Export listing
   */
  async listExports(chainId, chainName) {
    const exportDir = this.getExportDir(chainId, chainName);
    
    try {
      await fs.access(exportDir);
    } catch {
      return {
        chainId,
        chainName,
        exports: [],
        lastExported: null
      };
    }

    const listing = {
      chainId,
      chainName,
      exports: [],
      lastExported: null
    };

    try {
      // Check for manifest
      const manifestPath = path.join(exportDir, 'manifest.json');
      const manifestData = await fs.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(manifestData);
      
      listing.lastExported = manifest.export.exportedAt;
      listing.totalContracts = manifest.export.totalContracts;
      listing.successfulExports = manifest.export.successfulExports;
      
      // List interface directories
      const interfaceDir = this.getInterfaceDir(chainId, chainName);
      const entries = await fs.readdir(interfaceDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const contractDir = path.join(interfaceDir, entry.name);
          const summaryPath = path.join(contractDir, 'summary.json');
          
          try {
            const summaryData = await fs.readFile(summaryPath, 'utf8');
            const summary = JSON.parse(summaryData);
            
            listing.exports.push({
              alias: summary.contract.alias,
              address: summary.contract.address,
              directory: entry.name,
              exportedAt: summary.export.exportedAt,
              functions: summary.export.functions,
              events: summary.export.events
            });
          } catch {
            // Skip if summary is not readable
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to load export listing', {
        chainId,
        chainName,
        error: error.message
      });
    }

    return listing;
  }

  /**
   * Clean up old exports
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @returns {Promise<void>}
   */
  async cleanExports(chainId, chainName) {
    const exportDir = this.getExportDir(chainId, chainName);
    
    try {
      await fs.rm(exportDir, { recursive: true, force: true });
      logger.info('Cleaned exports', { chainId, chainName });
    } catch (error) {
      logger.warn('Failed to clean exports', {
        chainId,
        chainName,
        error: error.message
      });
    }
  }
}

export default new ExportManager();