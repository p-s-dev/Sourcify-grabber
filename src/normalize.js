import fs from 'fs/promises';
import path from 'path';
import logger from './log.js';
import { hashString } from './checksum.js';

/**
 * Data normalization utilities for contract metadata and sources
 */
export class DataNormalizer {
  /**
   * Extract and normalize ABI from metadata
   * @param {Object} metadata - Contract metadata from Sourcify
   * @returns {Object} Normalized ABI
   */
  extractAbi(metadata) {
    if (!metadata || !metadata.output) {
      throw new Error('Invalid metadata: missing output section');
    }

    const abi = metadata.output.abi;
    if (!Array.isArray(abi)) {
      throw new Error('Invalid metadata: ABI is not an array');
    }

    if (abi.length === 0) {
      throw new Error('Invalid metadata: ABI is empty');
    }

    // Validate ABI structure
    const validatedAbi = abi.map((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`Invalid ABI item at index ${index}: not an object`);
      }

      if (!item.type) {
        throw new Error(`Invalid ABI item at index ${index}: missing type`);
      }

      const validTypes = ['function', 'event', 'error', 'constructor', 'fallback', 'receive'];
      if (!validTypes.includes(item.type)) {
        throw new Error(`Invalid ABI item at index ${index}: invalid type '${item.type}'`);
      }

      // Ensure required fields are present
      const normalized = { type: item.type };

      if (item.name) {
        normalized.name = item.name;
      }

      if (item.inputs) {
        normalized.inputs = this.normalizeAbiInputs(item.inputs, index);
      }

      if (item.outputs) {
        normalized.outputs = this.normalizeAbiInputs(item.outputs, index);
      }

      if (item.stateMutability) {
        normalized.stateMutability = item.stateMutability;
      }

      if (item.anonymous !== undefined) {
        normalized.anonymous = item.anonymous;
      }

      return normalized;
    });

    logger.debug('Extracted and normalized ABI', {
      itemCount: validatedAbi.length,
      functions: validatedAbi.filter(i => i.type === 'function').length,
      events: validatedAbi.filter(i => i.type === 'event').length,
      errors: validatedAbi.filter(i => i.type === 'error').length
    });

    return validatedAbi;
  }

  /**
   * Normalize ABI inputs/outputs
   * @param {Array} inputs - Input or output parameters
   * @param {number} parentIndex - Parent ABI item index for error reporting
   * @returns {Array} Normalized inputs/outputs
   */
  normalizeAbiInputs(inputs, parentIndex) {
    if (!Array.isArray(inputs)) {
      throw new Error(`Invalid ABI item at index ${parentIndex}: inputs/outputs is not an array`);
    }

    return inputs.map((input, inputIndex) => {
      if (!input || typeof input !== 'object') {
        throw new Error(`Invalid input at ABI item ${parentIndex}, input ${inputIndex}: not an object`);
      }

      if (!input.type) {
        throw new Error(`Invalid input at ABI item ${parentIndex}, input ${inputIndex}: missing type`);
      }

      const normalized = { type: input.type };

      if (input.name) {
        normalized.name = input.name;
      }

      if (input.indexed !== undefined) {
        normalized.indexed = input.indexed;
      }

      if (input.components) {
        normalized.components = this.normalizeAbiInputs(input.components, parentIndex);
      }

      return normalized;
    });
  }

  /**
   * Generate language-agnostic schema from ABI
   * @param {Array} abi - Normalized ABI
   * @returns {Object} Language-agnostic schema
   */
  generateSchema(abi) {
    const schema = {
      functions: [],
      events: [],
      errors: [],
      constructor: null,
      fallback: null,
      receive: null,
      selectors: {},
      topics: {}
    };

    for (const item of abi) {
      switch (item.type) {
        case 'function':
          const func = this.normalizeFunctionItem(item);
          schema.functions.push(func);
          if (func.selector) {
            schema.selectors[func.selector] = func;
          }
          break;

        case 'event':
          const event = this.normalizeEventItem(item);
          schema.events.push(event);
          if (event.topic0) {
            schema.topics[event.topic0] = event;
          }
          break;

        case 'error':
          const error = this.normalizeErrorItem(item);
          schema.errors.push(error);
          if (error.selector) {
            schema.selectors[error.selector] = error;
          }
          break;

        case 'constructor':
          schema.constructor = this.normalizeConstructorItem(item);
          break;

        case 'fallback':
          schema.fallback = this.normalizeFallbackItem(item);
          break;

        case 'receive':
          schema.receive = this.normalizeReceiveItem(item);
          break;
      }
    }

    logger.debug('Generated schema', {
      functions: schema.functions.length,
      events: schema.events.length,
      errors: schema.errors.length,
      hasConstructor: !!schema.constructor,
      hasFallback: !!schema.fallback,
      hasReceive: !!schema.receive
    });

    return schema;
  }

  /**
   * Normalize function ABI item
   * @param {Object} item - Function ABI item
   * @returns {Object} Normalized function
   */
  normalizeFunctionItem(item) {
    const func = {
      name: item.name || '',
      type: 'function',
      stateMutability: item.stateMutability || 'nonpayable',
      inputs: item.inputs || [],
      outputs: item.outputs || []
    };

    // Generate function selector (first 4 bytes of keccak256)
    if (func.name) {
      const signature = this.generateFunctionSignature(func);
      func.signature = signature;
      func.selector = this.generateSelector(signature);
    }

    return func;
  }

  /**
   * Normalize event ABI item
   * @param {Object} item - Event ABI item
   * @returns {Object} Normalized event
   */
  normalizeEventItem(item) {
    const event = {
      name: item.name || '',
      type: 'event',
      anonymous: item.anonymous || false,
      inputs: item.inputs || []
    };

    // Generate event topic0 (keccak256 of signature)
    if (event.name && !event.anonymous) {
      const signature = this.generateEventSignature(event);
      event.signature = signature;
      event.topic0 = this.generateTopic(signature);
    }

    return event;
  }

  /**
   * Normalize error ABI item
   * @param {Object} item - Error ABI item
   * @returns {Object} Normalized error
   */
  normalizeErrorItem(item) {
    const error = {
      name: item.name || '',
      type: 'error',
      inputs: item.inputs || []
    };

    // Generate error selector
    if (error.name) {
      const signature = this.generateErrorSignature(error);
      error.signature = signature;
      error.selector = this.generateSelector(signature);
    }

    return error;
  }

  /**
   * Normalize constructor ABI item
   * @param {Object} item - Constructor ABI item
   * @returns {Object} Normalized constructor
   */
  normalizeConstructorItem(item) {
    return {
      type: 'constructor',
      stateMutability: item.stateMutability || 'nonpayable',
      inputs: item.inputs || []
    };
  }

  /**
   * Normalize fallback ABI item
   * @param {Object} item - Fallback ABI item
   * @returns {Object} Normalized fallback
   */
  normalizeFallbackItem(item) {
    return {
      type: 'fallback',
      stateMutability: item.stateMutability || 'nonpayable'
    };
  }

  /**
   * Normalize receive ABI item
   * @param {Object} item - Receive ABI item
   * @returns {Object} Normalized receive
   */
  normalizeReceiveItem(item) {
    return {
      type: 'receive',
      stateMutability: 'payable'
    };
  }

  /**
   * Generate function signature
   * @param {Object} func - Function object
   * @returns {string} Function signature
   */
  generateFunctionSignature(func) {
    const types = func.inputs.map(input => this.getCanonicalType(input));
    return `${func.name}(${types.join(',')})`;
  }

  /**
   * Generate event signature
   * @param {Object} event - Event object
   * @returns {string} Event signature
   */
  generateEventSignature(event) {
    const types = event.inputs.map(input => this.getCanonicalType(input));
    return `${event.name}(${types.join(',')})`;
  }

  /**
   * Generate error signature
   * @param {Object} error - Error object
   * @returns {string} Error signature
   */
  generateErrorSignature(error) {
    const types = error.inputs.map(input => this.getCanonicalType(input));
    return `${error.name}(${types.join(',')})`;
  }

  /**
   * Get canonical type string for ABI parameter
   * @param {Object} param - ABI parameter
   * @returns {string} Canonical type
   */
  getCanonicalType(param) {
    if (param.type === 'tuple') {
      const componentTypes = param.components.map(comp => this.getCanonicalType(comp));
      return `(${componentTypes.join(',')})`;
    }
    return param.type;
  }

  /**
   * Generate 4-byte selector from signature
   * @param {string} signature - Function or error signature
   * @returns {string} 4-byte selector
   */
  generateSelector(signature) {
    const hash = hashString(signature);
    return '0x' + hash.substring(0, 8);
  }

  /**
   * Generate 32-byte topic from signature
   * @param {string} signature - Event signature
   * @returns {string} 32-byte topic
   */
  generateTopic(signature) {
    return '0x' + hashString(signature);
  }

  /**
   * Generate hints for common patterns
   * @param {Array} abi - Normalized ABI
   * @returns {Object} Hint data
   */
  generateHints(abi) {
    const hints = {
      readOnlyFunctions: [],
      stateMutatingFunctions: [],
      payableFunctions: [],
      commonPatterns: {},
      eventCategories: {}
    };

    for (const item of abi) {
      if (item.type === 'function') {
        const mutability = item.stateMutability;
        
        if (mutability === 'view' || mutability === 'pure') {
          hints.readOnlyFunctions.push(item.name);
        } else if (mutability === 'payable') {
          hints.payableFunctions.push(item.name);
        } else {
          hints.stateMutatingFunctions.push(item.name);
        }

        // Common patterns
        if (item.name) {
          if (item.name.startsWith('get') || item.name.startsWith('is') || item.name.includes('Of')) {
            hints.commonPatterns[item.name] = 'getter';
          } else if (item.name.startsWith('set') || item.name.includes('Update')) {
            hints.commonPatterns[item.name] = 'setter';
          } else if (item.name.includes('transfer') || item.name.includes('Transfer')) {
            hints.commonPatterns[item.name] = 'transfer';
          }
        }
      } else if (item.type === 'event') {
        // Categorize events
        if (item.name) {
          if (item.name.includes('Transfer')) {
            hints.eventCategories[item.name] = 'transfer';
          } else if (item.name.includes('Approval')) {
            hints.eventCategories[item.name] = 'approval';
          } else if (item.name.includes('Update') || item.name.includes('Change')) {
            hints.eventCategories[item.name] = 'state_change';
          }
        }
      }
    }

    return hints;
  }

  /**
   * Normalize source file paths
   * @param {Object} sources - Sources object from metadata
   * @returns {Object} Normalized file paths
   */
  normalizeSources(sources) {
    const normalized = {};
    
    for (const [filePath, sourceData] of Object.entries(sources)) {
      // Normalize path separators and remove leading ./
      const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\.\//,);
      normalized[normalizedPath] = sourceData;
    }

    return normalized;
  }

  /**
   * Validate contract metadata structure
   * @param {Object} metadata - Contract metadata
   * @returns {boolean} True if valid
   */
  validateMetadata(metadata) {
    try {
      if (!metadata || typeof metadata !== 'object') {
        return false;
      }

      // Check required fields
      if (!metadata.compiler || !metadata.output) {
        return false;
      }

      // Check compiler info
      if (!metadata.compiler.version) {
        return false;
      }

      // Check output section
      if (!metadata.output.abi || !Array.isArray(metadata.output.abi)) {
        return false;
      }

      // Validate ABI (this will throw if invalid)
      this.extractAbi(metadata);

      return true;
    } catch (error) {
      logger.warn('Metadata validation failed', { error: error.message });
      return false;
    }
  }
}

export default new DataNormalizer();