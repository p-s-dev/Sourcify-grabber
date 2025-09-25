import Ajv from 'ajv';

// Initialize JSON Schema validator
const ajv = new Ajv();

// Schema for metadata.json
export const metadataSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    chainId: { type: 'number' },
    address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
    compiler: {
      type: 'object',
      properties: {
        version: { type: 'string' },
        settings: { type: 'object' }
      },
      required: ['version']
    },
    sources: {
      type: 'object',
      patternProperties: {
        '.*': {
          type: 'object',
          properties: {
            path: { type: 'string' },
            contentHash: { type: 'string' },
            license: { type: 'string' },
            content: { type: 'string' }
          }
        }
      }
    },
    sourcify: {
      type: 'object',
      properties: {
        matchType: { type: 'string', enum: ['full', 'partial', 'none'] },
        url: { type: 'string' },
        commit: { type: 'string' }
      }
    },
    explorer: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        apiBase: { type: 'string' },
        contractName: { type: 'string' },
        verified: { type: 'boolean' },
        sourceLicense: { type: 'string' }
      }
    },
    timestamps: {
      type: 'object',
      properties: {
        fetchedAt: { type: 'string' },
        verifiedAt: { type: 'string' }
      }
    },
    integrity: {
      type: 'object',
      properties: {
        creationBytecodeHash: { type: 'string' },
        deployedBytecodeHash: { type: 'string' }
      }
    },
    notes: { type: 'string' }
  },
  required: ['chainId', 'address']
};

// Schema for labels.json
export const labelsSchema = {
  type: 'object',
  properties: {
    protocol: { type: 'string' },
    project: { type: 'string' },
    tags: {
      type: 'array',
      items: { type: 'string' }
    },
    knownAliases: {
      type: 'array',
      items: { type: 'string' }
    },
    explorerLabels: {
      type: 'array',
      items: { type: 'string' }
    },
    userNotes: { type: 'string' }
  }
};

// Schema for provenance.json
export const provenanceSchema = {
  type: 'object',
  properties: {
    firstSeenAt: { type: 'string' },
    lastUpdatedAt: { type: 'string' },
    tools: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        version: { type: 'string' }
      },
      required: ['name', 'version']
    },
    sourcesUsed: {
      type: 'array',
      items: { type: 'string' }
    },
    fetchRunId: { type: 'string' },
    commitHash: { type: 'string' },
    operator: { type: 'string' },
    orphaned: { type: 'boolean' }
  },
  required: ['firstSeenAt', 'lastUpdatedAt', 'tools', 'sourcesUsed']
};

// Schema for hashes.json (in bytecode directory)
export const hashesSchema = {
  type: 'object',
  properties: {
    onChainDeployedHash: { type: 'string' },
    metadataDeployedHash: { type: 'string' },
    creationHash: { type: 'string' },
    ipfsCids: {
      type: 'array',
      items: { type: 'string' }
    },
    sourcifyMatchType: { type: 'string', enum: ['full', 'partial', 'none'] },
    match: { type: 'boolean' }
  }
};

// Create validators
export const validateMetadata = ajv.compile(metadataSchema);
export const validateLabels = ajv.compile(labelsSchema);
export const validateProvenance = ajv.compile(provenanceSchema);
export const validateHashes = ajv.compile(hashesSchema);

// Validation helper functions
export function validateData(data, validator, schemaName) {
  const isValid = validator(data);
  if (!isValid) {
    const errors = validator.errors.map(err => `${err.instancePath} ${err.message}`).join(', ');
    throw new Error(`Invalid ${schemaName}: ${errors}`);
  }
  return true;
}

export default {
  validateMetadata,
  validateLabels,
  validateProvenance,
  validateHashes,
  validateData
};