import fs from 'fs/promises';
import path from 'path';
import httpClient from './http.js';
import registry from './registry.js';
import normalize from './normalize.js';
import { generateChecksums, verifyChecksums } from './checksum.js';
import { isValidChecksumAddress } from './utils/address.js';
import logger from './log.js';

/**
 * Validation utilities for contract data integrity and compliance
 */
export class Validator {
  constructor(options = {}) {
    this.http = options.httpClient || httpClient;
    this.registry = options.registryManager || registry;
    this.normalizer = options.normalizer || normalize;
  }

  /**
   * Validate contract address format
   * @param {string} address - Contract address to validate
   * @returns {Object} Validation result
   */
  validateAddress(address) {
    const result = {
      valid: false,
      errors: [],
      warnings: []
    };

    if (!address || typeof address !== 'string') {
      result.errors.push('Address must be a non-empty string');
      return result;
    }

    if (!address.startsWith('0x')) {
      result.errors.push('Address must start with 0x');
      return result;
    }

    const cleanAddress = address.slice(2);
    if (!/^[0-9a-fA-F]{40}$/.test(cleanAddress)) {
      result.errors.push('Address must be 40 hexadecimal characters after 0x');
      return result;
    }

    if (!isValidChecksumAddress(address)) {
      result.warnings.push('Address is not in EIP-55 checksum format');
    }

    result.valid = true;
    return result;
  }

  /**
   * Validate ABI structure and content
   * @param {Array} abi - ABI array to validate
   * @returns {Object} Validation result
   */
  validateAbi(abi) {
    const result = {
      valid: false,
      errors: [],
      warnings: [],
      stats: {
        functions: 0,
        events: 0,
        errors: 0,
        constructor: false,
        fallback: false,
        receive: false
      }
    };

    if (!Array.isArray(abi)) {
      result.errors.push('ABI must be an array');
      return result;
    }

    if (abi.length === 0) {
      result.errors.push('ABI cannot be empty');
      return result;
    }

    const functionNames = new Set();
    const eventNames = new Set();

    for (let i = 0; i < abi.length; i++) {
      const item = abi[i];
      
      if (!item || typeof item !== 'object') {       
        result.errors.push(`ABI item at index ${i} is not an object`);
        continue;
      }

      if (!item.type) {
        result.errors.push(`ABI item at index ${i} missing type field`);
        continue;
      }

      const validTypes = ['function', 'event', 'error', 'constructor', 'fallback', 'receive'];
      if (!validTypes.includes(item.type)) {
        result.errors.push(`ABI item at index ${i} has invalid type: ${item.type}`);
        continue;
      }

      // Validate specific item types
      switch (item.type) {
        case 'function':
          this.validateFunctionItem(item, i, result, functionNames);
          result.stats.functions++;
          break;
        case 'event':
          this.validateEventItem(item, i, result, eventNames);
          result.stats.events++;
          break;
        case 'error':
          this.validateErrorItem(item, i, result);
          result.stats.errors++;
          break;
        case 'constructor':
          if (result.stats.constructor) {
            result.warnings.push('Multiple constructor definitions found');
          }
          this.validateConstructorItem(item, i, result);
          result.stats.constructor = true;
          break;
        case 'fallback':
          if (result.stats.fallback) {
            result.warnings.push('Multiple fallback definitions found');
          }
          this.validateFallbackItem(item, i, result);
          result.stats.fallback = true;
          break;
        case 'receive':
          if (result.stats.receive) {
            result.warnings.push('Multiple receive definitions found');
          }
          this.validateReceiveItem(item, i, result);
          result.stats.receive = true;
          break;
      }
    }

    if (result.stats.functions === 0 && result.stats.events === 0) {
      result.warnings.push('ABI contains no functions or events');
    }

    result.valid = result.errors.length === 0;
    return result;
  }

  /**
   * Validate function ABI item
   * @param {Object} item - Function ABI item
   * @param {number} index - Item index
   * @param {Object} result - Validation result object
   * @param {Set} functionNames - Set of function names for duplicate checking
   */
  validateFunctionItem(item, index, result, functionNames) {
    if (!item.name) {
      result.errors.push(`Function at index ${index} missing name`);
      return;
    }

    if (functionNames.has(item.name)) {
      result.warnings.push(`Duplicate function name: ${item.name}`);
    } else {
      functionNames.add(item.name);
    }

    const validMutability = ['pure', 'view', 'nonpayable', 'payable'];
    if (item.stateMutability && !validMutability.includes(item.stateMutability)) {
      result.errors.push(`Function ${item.name} has invalid stateMutability: ${item.stateMutability}`);
    }

    if (item.inputs) {
      this.validateParameters(item.inputs, `Function ${item.name} inputs`, result);
    }

    if (item.outputs) {
      this.validateParameters(item.outputs, `Function ${item.name} outputs`, result);
    }
  }

  /**
   * Validate event ABI item
   * @param {Object} item - Event ABI item
   * @param {number} index - Item index
   * @param {Object} result - Validation result object
   * @param {Set} eventNames - Set of event names for duplicate checking
   */
  validateEventItem(item, index, result, eventNames) {
    if (!item.name) {
      result.errors.push(`Event at index ${index} missing name`);
      return;
    }

    if (eventNames.has(item.name)) {
      result.warnings.push(`Duplicate event name: ${item.name}`);
    } else {
      eventNames.add(item.name);
    }

    if (item.inputs) {
      this.validateParameters(item.inputs, `Event ${item.name} inputs`, result);
      
      // Check indexed parameter count
      const indexedCount = item.inputs.filter(input => input.indexed).length;
      if (indexedCount > 3) {
        result.errors.push(`Event ${item.name} has too many indexed parameters (${indexedCount}, max 3)`);
      }
    }
  }

  /**
   * Validate error ABI item
   * @param {Object} item - Error ABI item
   * @param {number} index - Item index
   * @param {Object} result - Validation result object
   */
  validateErrorItem(item, index, result) {
    if (!item.name) {
      result.errors.push(`Error at index ${index} missing name`);
      return;
    }

    if (item.inputs) {
      this.validateParameters(item.inputs, `Error ${item.name} inputs`, result);
    }
  }

  /**
   * Validate constructor ABI item
   * @param {Object} item - Constructor ABI item
   * @param {number} index - Item index
   * @param {Object} result - Validation result object
   */
  validateConstructorItem(item, index, result) {
    const validMutability = ['nonpayable', 'payable'];
    if (item.stateMutability && !validMutability.includes(item.stateMutability)) {
      result.errors.push(`Constructor has invalid stateMutability: ${item.stateMutability}`);
    }

    if (item.inputs) {
      this.validateParameters(item.inputs, 'Constructor inputs', result);
    }
  }

  /**
   * Validate fallback ABI item
   * @param {Object} item - Fallback ABI item
   * @param {number} index - Item index
   * @param {Object} result - Validation result object
   */
  validateFallbackItem(item, index, result) {
    const validMutability = ['nonpayable', 'payable'];
    if (item.stateMutability && !validMutability.includes(item.stateMutability)) {
      result.errors.push(`Fallback has invalid stateMutability: ${item.stateMutability}`);
    }
  }

  /**
   * Validate receive ABI item
   * @param {Object} item - Receive ABI item
   * @param {number} index - Item index
   * @param {Object} result - Validation result object
   */
  validateReceiveItem(item, index, result) {
    if (item.stateMutability && item.stateMutability !== 'payable') {
      result.errors.push(`Receive function must be payable, got: ${item.stateMutability}`);
    }
  }

  /**
   * Validate parameter array
   * @param {Array} parameters - Parameter array
   * @param {string} context - Context for error messages
   * @param {Object} result - Validation result object
   */
  validateParameters(parameters, context, result) {
    if (!Array.isArray(parameters)) {
      result.errors.push(`${context} must be an array`);
      return;
    }

    for (let i = 0; i < parameters.length; i++) {
      const param = parameters[i];
      
      if (!param || typeof param !== 'object') {
        result.errors.push(`${context} parameter at index ${i} is not an object`);
        continue;
      }

      if (!param.type) {
        result.errors.push(`${context} parameter at index ${i} missing type`);
        continue;
      }

      // Validate Solidity type
      if (!this.isValidSolidityType(param.type)) {
        result.errors.push(`${context} parameter at index ${i} has invalid type: ${param.type}`);
      }

      // Validate tuple components
      if (param.type === 'tuple' || param.type.startsWith('tuple[')) {
        if (!param.components || !Array.isArray(param.components)) {
          result.errors.push(`${context} tuple parameter at index ${i} missing components`);
        } else {
          this.validateParameters(param.components, `${context} tuple parameter ${i} components`, result);
        }
      }
    }
  }

  /**
   * Check if type is a valid Solidity type
   * @param {string} type - Type string to validate
   * @returns {boolean} True if valid Solidity type
   */
  isValidSolidityType(type) {
    // Basic types
    const basicTypes = [
      'address', 'bool', 'string', 'bytes',
      'uint', 'int', 'fixed', 'ufixed'
    ];

    if (basicTypes.includes(type)) return true;

    // Array types
    if (type.endsWith('[]') || type.match(/\[\d+\]$/)) {
      const baseType = type.replace(/(\[\d*\])+$/, '');
      return this.isValidSolidityType(baseType);
    }

    // Sized types
    if (type.match(/^(uint|int)\d+$/)) {
      const size = parseInt(type.match(/\d+$/)[0]);
      return size > 0 && size <= 256 && size % 8 === 0;
    }

    if (type.match(/^bytes\d+$/)) {
      const size = parseInt(type.match(/\d+$/)[0]);
      return size > 0 && size <= 32;
    }

    // Tuple types
    if (type === 'tuple' || type.startsWith('tuple[')) {
      return true;
    }

    return false;
  }

  /**
   * Validate contract metadata structure
   * @param {Object} metadata - Contract metadata
   * @returns {Object} Validation result
   */
  validateMetadata(metadata) {
    const result = {
      valid: false,
      errors: [],
      warnings: []
    };

    if (!metadata || typeof metadata !== 'object') {
      result.errors.push('Metadata must be an object');
      return result;
    }

    // Check required fields
    if (!metadata.compiler) {
      result.errors.push('Metadata missing compiler information');
    } else {
      if (!metadata.compiler.version) {
        result.errors.push('Metadata missing compiler version');
      }
    }

    if (!metadata.output) {
      result.errors.push('Metadata missing output section');
    } else {
      if (!metadata.output.abi) {
        result.errors.push('Metadata output missing ABI');
      } else {
        const abiValidation = this.validateAbi(metadata.output.abi);
        result.errors.push(...abiValidation.errors);
        result.warnings.push(...abiValidation.warnings);
      }
    }

    // Check sources if present
    if (metadata.sources) {
      if (typeof metadata.sources !== 'object') {
        result.errors.push('Metadata sources must be an object');
      } else {
        const sourceCount = Object.keys(metadata.sources).length;
        if (sourceCount === 0) {
          result.warnings.push('Metadata sources is empty');
        }
      }
    }

    result.valid = result.errors.length === 0;
    return result;
  }

  /**
   * Validate contract via RPC bytecode check
   * @param {string} rpcUrl - RPC endpoint URL
   * @param {string} address - Contract address
   * @returns {Promise<Object>} Validation result
   */
  async validateBytecode(rpcUrl, address) {
    const result = {
      valid: false,
      errors: [],
      warnings: [],
      bytecodeLength: 0,
      isEmpty: true
    };

    if (!rpcUrl) {
      result.warnings.push('No RPC URL provided, skipping bytecode validation');
      result.valid = true; // Don't fail validation if RPC is not configured
      return result;
    }

    try {
      const payload = {
        jsonrpc: '2.0',
        method: 'eth_getCode',
        params: [address, 'latest'],
        id: 1
      };

      logger.debug('Fetching contract bytecode', { rpcUrl, address });

      const response = await this.http.post(rpcUrl, payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.error) {
        result.errors.push(`RPC error: ${response.error.message}`);
        return result;
      }

      const bytecode = response.result;
      
      if (!bytecode || bytecode === '0x' || bytecode === '0x0') {
        result.isEmpty = true;
        result.warnings.push('Contract has no bytecode (possibly not deployed or EOA)');
      } else {
        result.isEmpty = false;
        result.bytecodeLength = (bytecode.length - 2) / 2; // Convert hex length to bytes
        
        if (result.bytecodeLength < 10) {
          result.warnings.push(`Contract bytecode is very small (${result.bytecodeLength} bytes)`);
        }
      }

      result.valid = true;
      
      logger.debug('Bytecode validation completed', {
        address,
        length: result.bytecodeLength,
        isEmpty: result.isEmpty
      });

    } catch (error) {
      result.errors.push(`Failed to fetch bytecode: ${error.message}`);
      logger.warn('Bytecode validation failed', { address, error: error.message });
    }

    return result;
  }

  /**
   * Validate file checksums
   * @param {string} contractDir - Contract directory path
   * @returns {Promise<Object>} Validation result
   */
  async validateChecksums(contractDir) {
    const result = {
      valid: false,
      errors: [],
      warnings: []
    };

    try {
      const checksumsPath = path.join(contractDir, 'checksums.json');
      
      try {
        await fs.access(checksumsPath);
      } catch {
        result.errors.push('Checksums file not found');
        return result;
      }

      const checksumsData = await fs.readFile(checksumsPath, 'utf8');
      const checksums = JSON.parse(checksumsData);

      if (!checksums.files || typeof checksums.files !== 'object') {
        result.errors.push('Invalid checksums format');
        return result;
      }

      const verification = await verifyChecksums(contractDir, checksums.files, contractDir);
      
      if (!verification.valid) {
        result.errors.push(...verification.missingFiles.map(f => `Missing file: ${f}`));
        result.errors.push(...verification.mismatchedFiles.map(f => 
          `Checksum mismatch: ${f.file} (expected: ${f.expected}, actual: ${f.actual})`
        ));
        result.warnings.push(...verification.extraFiles.map(f => `Extra file: ${f}`));
      }

      result.valid = verification.valid;

    } catch (error) {
      result.errors.push(`Checksum validation failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Comprehensive contract validation
   * @param {number} chainId - Chain ID
   * @param {string} chainName - Chain name
   * @param {string} identifier - Contract address or alias
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} Complete validation result
   */
  async validateContract(chainId, chainName, identifier, options = {}) {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      validations: {}
    };

    try {
      // Get contract info
      const contract = await this.registry.getContract(chainId, chainName, identifier);
      const contractDir = this.registry.getContractDir(chainId, chainName, contract.alias, contract.address);

      // Validate address format
      result.validations.address = this.validateAddress(contract.address);
      if (!result.validations.address.valid) {
        result.valid = false;
        result.errors.push(...result.validations.address.errors);
      }
      result.warnings.push(...result.validations.address.warnings);

      // Check if contract directory exists
      try {
        await fs.access(contractDir);
      } catch {
        result.errors.push('Contract data not found. Run fetch command first.');
        result.valid = false;
        return result;
      }

      // Validate metadata
      try {
        const metadataPath = path.join(contractDir, 'metadata.json');
        const metadataData = await fs.readFile(metadataPath, 'utf8');
        const metadata = JSON.parse(metadataData);
        
        result.validations.metadata = this.validateMetadata(metadata);
        if (!result.validations.metadata.valid) {
          result.valid = false;
        }
        result.errors.push(...result.validations.metadata.errors);
        result.warnings.push(...result.validations.metadata.warnings);
      } catch (error) {
        result.errors.push(`Failed to validate metadata: ${error.message}`);
        result.valid = false;
      }

      // Validate checksums
      if (options.validateChecksums !== false) {
        result.validations.checksums = await this.validateChecksums(contractDir);
        if (!result.validations.checksums.valid) {
          result.valid = false;
        }
        result.errors.push(...result.validations.checksums.errors);
        result.warnings.push(...result.validations.checksums.warnings);
      }

      // Validate bytecode if RPC URL is available and strict mode
      if (options.strict && options.rpcUrl) {
        result.validations.bytecode = await this.validateBytecode(options.rpcUrl, contract.address);
        if (!result.validations.bytecode.valid) {
          result.valid = false;
        }
        result.errors.push(...result.validations.bytecode.errors);
        result.warnings.push(...result.validations.bytecode.warnings);
      }

      logger.info('Contract validation completed', {
        chainId,
        chainName,
        address: contract.address,
        alias: contract.alias,
        valid: result.valid,
        errorCount: result.errors.length,
        warningCount: result.warnings.length
      });

    } catch (error) {
      result.valid = false;
      result.errors.push(error.message);
      logger.error('Contract validation failed', { 
        chainId, 
        chainName, 
        identifier, 
        error: error.message 
      });
    }

    return result;
  }
}

export default new Validator();