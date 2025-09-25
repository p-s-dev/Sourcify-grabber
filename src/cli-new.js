#!/usr/bin/env node

import { program } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import archive from './archive.js';
import sourcify from './sourcify.js';
import explorer from './explorer.js';
import { validateData, validateMetadata } from './schemas.js';
import { toChecksumAddress, isValidChecksumAddress } from './utils/address.js';
import logger from './log.js';

const TOOL_VERSION = '2.0.0';

// Set up CLI program
program
  .name('sourcify-grabber')
  .description('Multi-step contract archive builder for Ethereum smart contracts')
  .version(TOOL_VERSION);

/**
 * Validate input addresses
 */
program
  .command('validate-input')
  .description('Validate addresses.txt files for checksums, duplicates, and consistency')
  .option('-c, --chain <chainName>', 'Specific chain to validate')
  .action(async (options) => {
    try {
      const chainsConfig = await config.loadChainsConfig();
      const chains = options.chain ? [options.chain] : Object.keys(chainsConfig.chains);

      let totalErrors = 0;
      let totalAddresses = 0;

      for (const chainName of chains) {
        console.log(`🔍 Validating ${chainName}...`);
        
        const addresses = await archive.readAddresses(chainName);
        totalAddresses += addresses.length;

        const seen = new Set();
        let chainErrors = 0;

        for (const address of addresses) {
          // Check checksum format
          if (!isValidChecksumAddress(address)) {
            console.log(`❌ Invalid address format: ${address}`);
            chainErrors++;
            continue;
          }

          // Check for duplicates
          if (seen.has(address)) {
            console.log(`❌ Duplicate address: ${address}`);
            chainErrors++;
            continue;
          }
          seen.add(address);
        }

        console.log(`✅ ${chainName}: ${addresses.length} addresses, ${chainErrors} errors`);
        totalErrors += chainErrors;
      }

      console.log(`\n📊 Total: ${totalAddresses} addresses, ${totalErrors} errors`);
      
      if (totalErrors > 0) {
        process.exit(1);
      }

    } catch (error) {
      logger.error('Input validation failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Fetch contract data
 */
program
  .command('fetch')
  .description('Fetch contract metadata and sources from Sourcify and explorers')
  .option('-c, --chain <chainName>', 'Specific chain to process')
  .option('--address <address>', 'Specific contract address')
  .option('--from <index>', 'Start from address index', parseInt)
  .option('--to <index>', 'End at address index', parseInt)
  .option('--limit <count>', 'Limit number of addresses to process', parseInt)
  .option('--force', 'Force re-fetch even if not stale')
  .option('--strict', 'Exit on any failure')
  .option('--dry-run', 'Show what would be done without making changes')
  .action(async (options) => {
    try {
      const chainsConfig = await config.loadChainsConfig();
      const chains = options.chain ? [options.chain] : Object.keys(chainsConfig.chains);

      let totalProcessed = 0;
      let totalSuccessful = 0;
      let totalFailed = 0;

      for (const chainName of chains) {
        const chainConfig = await config.getChainConfig(chainName);
        console.log(`🔄 Processing chain: ${chainName} (${chainConfig.chainId})`);

        let addresses = await archive.readAddresses(chainName);
        
        // Filter addresses if specific address requested
        if (options.address) {
          const targetAddress = toChecksumAddress(options.address);
          addresses = addresses.filter(addr => addr === targetAddress);
        }

        // Apply range filtering
        if (options.from !== undefined) {
          addresses = addresses.slice(options.from);
        }
        if (options.to !== undefined) {
          addresses = addresses.slice(0, options.to - (options.from || 0));
        }
        if (options.limit) {
          addresses = addresses.slice(0, options.limit);
        }

        console.log(`📥 Processing ${addresses.length} addresses...`);

        for (const address of addresses) {
          try {
            totalProcessed++;

            if (options.dryRun) {
              console.log(`[DRY RUN] Would process: ${address}`);
              continue;
            }

            // Check if we should skip this address
            const provenanceCheck = await archive.checkProvenance(chainName, address, {
              force: options.force
            });

            if (provenanceCheck.shouldSkip) {
              console.log(`⏭️  Skipping ${address} (not stale)`);
              continue;
            }

            console.log(`📥 Fetching: ${address}`);

            // Try Sourcify first
            let contractData = null;
            let sourcifySuccess = false;

            try {
              const sourcifyResult = await sourcify.fetchMetadata(chainConfig.chainId, address);
              
              // Fetch sources if available
              let sources = {};
              if (sourcifyResult.metadata.sources) {
                sources = await sourcify.fetchAllSources(
                  chainConfig.chainId,
                  address,
                  sourcifyResult.metadata,
                  sourcifyResult.matchType
                );
              }

              contractData = {
                metadata: {
                  ...sourcifyResult.metadata,
                  name: sourcifyResult.metadata.settings?.contractName,
                  chainId: chainConfig.chainId,
                  address: toChecksumAddress(address),
                  sourcify: {
                    matchType: sourcifyResult.matchType,
                    url: sourcifyResult.sourceUrl,
                    commit: null // TODO: Get from response if available
                  },
                  timestamps: {
                    fetchedAt: sourcifyResult.fetchedAt
                  }
                },
                abi: sourcifyResult.metadata.output?.abi || [],
                sources,
                provenance: archive.createProvenance({
                  sourcesUsed: ['sourcify'],
                  firstSeenAt: provenanceCheck.provenance?.firstSeenAt
                })
              };

              sourcifySuccess = true;
              console.log(`✅ Sourcify ${sourcifyResult.matchType} match: ${address}`);

            } catch (sourcifyError) {
              console.log(`⚠️  Sourcify failed for ${address}: ${sourcifyError.message}`);
              
              // Try explorer fallback
              if (chainConfig.explorerApiBase) {
                try {
                  const explorerResult = await explorer.fetchContractSource(chainConfig, address);
                  
                  contractData = {
                    metadata: {
                      ...explorerResult.metadata,
                      name: explorerResult.explorer.contractName,
                      chainId: chainConfig.chainId,
                      address: toChecksumAddress(address),
                      explorer: explorerResult.explorer,
                      timestamps: {
                        fetchedAt: explorerResult.fetchedAt
                      }
                    },
                    abi: explorerResult.abi,
                    sources: explorerResult.metadata.sources || {},
                    provenance: archive.createProvenance({
                      sourcesUsed: ['explorer'],
                      firstSeenAt: provenanceCheck.provenance?.firstSeenAt
                    })
                  };

                  console.log(`✅ Explorer match: ${address}`);
                } catch (explorerError) {
                  console.log(`❌ Explorer failed for ${address}: ${explorerError.message}`);
                  throw new Error(`Both Sourcify and explorer failed: ${explorerError.message}`);
                }
              } else {
                throw sourcifyError;
              }
            }

            // Validate metadata before persisting
            validateData(contractData.metadata, validateMetadata, 'metadata');

            // Persist to archive
            await archive.persistContract(chainName, address, contractData);
            
            totalSuccessful++;
            console.log(`✅ Processed: ${address}`);

          } catch (error) {
            totalFailed++;
            console.log(`❌ Failed: ${address} - ${error.message}`);
            
            logger.error('Failed to process contract', {
              chainName,
              address,
              error: error.message
            });

            if (options.strict) {
              throw error;
            }
          }
        }
      }

      console.log(`\n📊 Summary: ${totalProcessed} processed, ${totalSuccessful} successful, ${totalFailed} failed`);

      // Exit with error if too many failures
      const failureRate = totalProcessed > 0 ? totalFailed / totalProcessed : 0;
      if (failureRate > 0.5) {
        console.log(`❌ High failure rate (${Math.round(failureRate * 100)}%), exiting with error`);
        process.exit(1);
      }

    } catch (error) {
      logger.error('Fetch command failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Verify contract data
 */
program
  .command('verify')
  .description('Re-verify contract data against on-chain bytecode and metadata')
  .option('-c, --chain <chainName>', 'Specific chain to verify')
  .option('--address <address>', 'Specific contract address')
  .action(async (options) => {
    try {
      console.log('🔍 Starting verification...');
      
      const chainsConfig = await config.loadChainsConfig();
      const chains = options.chain ? [options.chain] : Object.keys(chainsConfig.chains);

      for (const chainName of chains) {
        const chainConfig = await config.getChainConfig(chainName);
        console.log(`🔍 Verifying chain: ${chainName}`);

        let addresses = options.address ? [toChecksumAddress(options.address)] : await archive.getArchivedContracts(chainName);

        for (const address of addresses) {
          console.log(`🔍 Verifying: ${address}`);
          // TODO: Implement verification logic
          // - Compare on-chain bytecode with metadata
          // - Validate hashes
          // - Update verification status
        }
      }

    } catch (error) {
      logger.error('Verify command failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Update contract labels
 */
program
  .command('label')
  .description('Attach or update labels for contracts')
  .option('-c, --chain <chainName>', 'Chain name', true)
  .option('--address <address>', 'Contract address', true)
  .option('--protocol <protocol>', 'Protocol name')
  .option('--project <project>', 'Project name')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (options) => {
    try {
      if (!options.chain || !options.address) {
        throw new Error('Chain and address are required');
      }

      const labelUpdates = {};
      if (options.protocol) labelUpdates.protocol = options.protocol;
      if (options.project) labelUpdates.project = options.project;
      if (options.tags) labelUpdates.tags = options.tags.split(',').map(t => t.trim());

      await archive.updateLabels(options.chain, options.address, labelUpdates);
      console.log(`✅ Labels updated for ${toChecksumAddress(options.address)}`);

    } catch (error) {
      logger.error('Label command failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Generate reports
 */
program
  .command('report')
  .description('Generate summary reports without fetching')
  .option('-c, --chain <chainName>', 'Specific chain to report on')
  .action(async (options) => {
    try {
      console.log('📊 Generating reports...');
      // TODO: Implement report generation
      // - Summary markdown reports
      // - Machine-readable diffs
      // - Statistics and counts

    } catch (error) {
      logger.error('Report command failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * List contracts and status
 */
program
  .command('list')
  .description('List contracts and their status')
  .option('-c, --chain <chainName>', 'Specific chain to list')
  .action(async (options) => {
    try {
      const chainsConfig = await config.loadChainsConfig();
      const chains = options.chain ? [options.chain] : Object.keys(chainsConfig.chains);

      for (const chainName of chains) {
        console.log(`\n📋 Chain: ${chainName}`);
        
        const addresses = await archive.readAddresses(chainName);
        const archived = await archive.getArchivedContracts(chainName);
        
        console.log(`   Input addresses: ${addresses.length}`);
        console.log(`   Archived contracts: ${archived.length}`);
        
        // Show first few addresses
        if (addresses.length > 0) {
          console.log(`   Recent addresses:`);
          addresses.slice(0, 5).forEach(addr => {
            const isArchived = archived.includes(addr);
            console.log(`     ${isArchived ? '✅' : '⏳'} ${addr}`);
          });
          
          if (addresses.length > 5) {
            console.log(`     ... and ${addresses.length - 5} more`);
          }
        }
      }

    } catch (error) {
      logger.error('List command failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Show status
 */
program
  .command('status')
  .description('Show overall status of all chains and contracts')
  .action(async (options) => {
    try {
      console.log('📊 Contract Archive Status\n');
      
      const chainsConfig = await config.loadChainsConfig();
      
      for (const [chainName, chainConfig] of Object.entries(chainsConfig.chains)) {
        console.log(`🔗 ${chainName} (Chain ID: ${chainConfig.chainId})`);
        
        const addresses = await archive.readAddresses(chainName);
        const archived = await archive.getArchivedContracts(chainName);
        
        const pending = addresses.filter(addr => !archived.includes(addr));
        
        console.log(`   📥 Input addresses: ${addresses.length}`);
        console.log(`   ✅ Archived: ${archived.length}`);  
        console.log(`   ⏳ Pending: ${pending.length}`);
        console.log(`   🌐 Sourcify support: ${chainConfig.sourcifyChainSupport ? 'Yes' : 'No'}`);
        console.log(`   🔍 Explorer API: ${chainConfig.explorerApiBase ? 'Configured' : 'Not configured'}`);
        console.log('');
      }

    } catch (error) {
      logger.error('Status command failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();