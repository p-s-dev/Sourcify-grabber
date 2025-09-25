#!/usr/bin/env node

import { program } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import registry from './registry.js';
import sourcify from './sourcify.js';
import normalize from './normalize.js';
import validate from './validate.js';
import exportManager from './export.js';
import { generateChecksums } from './checksum.js';
import { toChecksumAddress } from './utils/address.js';
import logger from './log.js';

const TOOL_VERSION = '1.0.0';

// Set up CLI program
program
  .name('sourcify-grabber')
  .description('Production-grade Node.js app for building and maintaining offline archives of Ethereum smart contracts')
  .version(TOOL_VERSION);

/**
 * Initialize chain directory and registry
 */
program
  .command('init-chain')
  .description('Initialize chain directory and empty registry')
  .option('-c, --chain <chainId|name>', 'Chain ID or name')
  .action(async (options) => {
    try {
      if (!options.chain) {
        throw new Error('Chain parameter is required');
      }

      const chainConfig = await config.getChainConfig(options.chain);
      await registry.initChain(chainConfig.chainId, chainConfig.chainName);
      
      console.log(`✅ Initialized chain: ${chainConfig.chainName} (${chainConfig.chainId})`);
    } catch (error) {
      logger.error('Failed to initialize chain', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Add contract to registry
 */
program
  .command('add-contract')
  .description('Add contract to chain registry')
  .option('-c, --chain <chainId|name>', 'Chain ID or name')
  .option('-a, --alias <alias>', 'Contract alias')
  .option('--address <address>', 'Contract address')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('-n, --note <note>', 'Optional note')
  .option('--expected-implementation <address>', 'Expected implementation address for proxies')
  .action(async (options) => {
    try {
      if (!options.chain || !options.alias || !options.address) {
        throw new Error('Chain, alias, and address parameters are required');
      }

      const chainConfig = await config.getChainConfig(options.chain);
      const contractInfo = {
        alias: options.alias,
        address: toChecksumAddress(options.address),
        tags: options.tags ? options.tags.split(',').map(t => t.trim()) : [],
        notes: options.note,
        expectedImplementation: options.expectedImplementation
      };

      await registry.addContract(chainConfig.chainId, chainConfig.chainName, contractInfo);
      
      console.log(`✅ Added contract: ${contractInfo.alias} (${contractInfo.address})`);
    } catch (error) {
      logger.error('Failed to add contract', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Remove contract from registry
 */
program
  .command('remove-contract')
  .description('Remove contract from chain registry (mark as archived)')
  .option('-c, --chain <chainId|name>', 'Chain ID or name')
  .option('--address <address>', 'Contract address')
  .action(async (options) => {
    try {
      if (!options.chain || !options.address) {
        throw new Error('Chain and address parameters are required');
      }

      const chainConfig = await config.getChainConfig(options.chain);
      await registry.removeContract(chainConfig.chainId, chainConfig.chainName, options.address);
      
      console.log(`✅ Archived contract: ${options.address}`);
    } catch (error) {
      logger.error('Failed to remove contract', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Fetch contract data from Sourcify
 */
program
  .command('fetch')
  .description('Fetch contract metadata and sources')
  .option('-c, --chain <chainId|name>', 'Chain ID or name')
  .option('--address <address>', 'Specific contract address')
  .option('-a, --alias <alias>', 'Specific contract alias')
  .option('--all', 'Fetch all contracts in registry')
  .option('--source <source>', 'Data source: sourcify, ipfs, incoming', 'sourcify')
  .option('--dry-run', 'Show what would be done without making changes')
  .action(async (options) => {
    try {
      if (!options.chain) {
        throw new Error('Chain parameter is required');
      }

      const chainConfig = await config.getChainConfig(options.chain);
      
      // Determine which contracts to fetch
      let contracts = [];
      if (options.all) {
        contracts = await registry.listContracts(chainConfig.chainId, chainConfig.chainName);
      } else if (options.address || options.alias) {
        const identifier = options.address || options.alias;
        const contract = await registry.getContract(chainConfig.chainId, chainConfig.chainName, identifier);
        contracts = [contract];
      } else {
        throw new Error('Specify --all, --address, or --alias');
      }

      if (contracts.length === 0) {
        console.log('ℹ️  No contracts to fetch');
        return;
      }

      console.log(`🔄 Fetching ${contracts.length} contract(s)...`);

      let successCount = 0;
      let errorCount = 0;

      for (const contract of contracts) {
        try {
          if (options.dryRun) {
            console.log(`[DRY RUN] Would fetch: ${contract.alias} (${contract.address})`);
            continue;
          }

          console.log(`📥 Fetching: ${contract.alias} (${contract.address})`);

          // Fetch metadata from Sourcify
          const result = await sourcify.fetchMetadata(chainConfig.chainId, contract.address);
          const { metadata, matchType, sourceUrl, fetchedAt } = result;

          // Validate metadata
          if (!normalize.validateMetadata(metadata)) {
            throw new Error('Invalid metadata received');
          }

          // Extract ABI
          const abi = normalize.extractAbi(metadata);

          // Create contract directory
          const contractDir = registry.getContractDir(
            chainConfig.chainId, 
            chainConfig.chainName, 
            contract.alias, 
            contract.address
          );
          await fs.mkdir(contractDir, { recursive: true });

          // Save metadata
          const metadataPath = path.join(contractDir, 'metadata.json');
          await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

          // Save ABI
          const abiPath = path.join(contractDir, 'abi.json');
          await fs.writeFile(abiPath, JSON.stringify(abi, null, 2));

          // Fetch and save sources
          if (metadata.sources) {
            const sourcesDir = path.join(contractDir, 'sources');
            await fs.mkdir(sourcesDir, { recursive: true });

            const sources = await sourcify.fetchAllSources(
              chainConfig.chainId, 
              contract.address, 
              metadata, 
              matchType
            );

            for (const [filePath, content] of Object.entries(sources)) {
              const fullPath = path.join(sourcesDir, filePath);
              const fileDir = path.dirname(fullPath);
              await fs.mkdir(fileDir, { recursive: true });
              await fs.writeFile(fullPath, content);
            }
          }

          // Generate checksums
          const checksums = await generateChecksums(contractDir);
          const checksumsPath = path.join(contractDir, 'checksums.json');
          await fs.writeFile(checksumsPath, JSON.stringify({ files: checksums }, null, 2));

          // Save provenance
          const provenance = {
            records: [{
              url: sourceUrl + (matchType === 'full' ? '/contracts/full_match/' : '/contracts/partial_match/') 
                + chainConfig.chainId + '/' + contract.address + '/metadata.json',
              method: 'GET',
              status: 200,
              fetchedAt,
              sha256: Object.values(checksums).find(hash => hash) // Use first checksum as representative
            }]
          };
          const provenancePath = path.join(contractDir, 'provenance.json');
          await fs.writeFile(provenancePath, JSON.stringify(provenance, null, 2));

          console.log(`✅ Fetched: ${contract.alias} (${matchType} match)`);
          successCount++;

        } catch (error) {
          console.error(`❌ Failed: ${contract.alias} - ${error.message}`);
          logger.error('Failed to fetch contract', {
            chainId: chainConfig.chainId,
            alias: contract.alias,
            address: contract.address,
            error: error.message
          });
          errorCount++;
        }
      }

      console.log(`\n📊 Summary: ${successCount} successful, ${errorCount} failed`);

    } catch (error) {
      logger.error('Fetch command failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Refresh contract data
 */
program
  .command('refresh')
  .description('Re-validate and refresh contract data')
  .option('-c, --chain <chainId|name>', 'Chain ID or name')
  .option('--all', 'Refresh all contracts')
  .action(async (options) => {
    try {
      if (!options.chain) {
        throw new Error('Chain parameter is required');
      }

      const chainConfig = await config.getChainConfig(options.chain);
      const contracts = await registry.listContracts(chainConfig.chainId, chainConfig.chainName);

      if (contracts.length === 0) {
        console.log('ℹ️  No contracts to refresh');
        return;
      }

      console.log(`🔄 Refreshing ${contracts.length} contract(s)...`);

      let validatedCount = 0;
      let errorCount = 0;

      for (const contract of contracts) {
        try {
          const result = await validate.validateContract(
            chainConfig.chainId, 
            chainConfig.chainName, 
            contract.alias,
            { rpcUrl: chainConfig.rpcUrl }
          );

          if (result.valid) {
            console.log(`✅ Valid: ${contract.alias}`);
            validatedCount++;
          } else {
            console.log(`⚠️  Issues: ${contract.alias}`);
            result.errors.forEach(error => console.log(`   ❌ ${error}`));
            result.warnings.forEach(warning => console.log(`   ⚠️  ${warning}`));
          }

        } catch (error) {
          console.error(`❌ Error: ${contract.alias} - ${error.message}`);
          errorCount++;
        }
      }

      console.log(`\n📊 Summary: ${validatedCount} valid, ${errorCount} errors`);

    } catch (error) {
      logger.error('Refresh command failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Validate contract data
 */
program
  .command('validate')
  .description('Validate contract data integrity')
  .option('-c, --chain <chainId|name>', 'Chain ID or name')
  .option('--address <address>', 'Specific contract address')
  .option('-a, --alias <alias>', 'Specific contract alias')
  .option('--strict', 'Enable strict validation including bytecode checks')
  .action(async (options) => {
    try {
      if (!options.chain) {
        throw new Error('Chain parameter is required');
      }

      const chainConfig = await config.getChainConfig(options.chain);
      
      let contracts = [];
      if (options.address || options.alias) {
        const identifier = options.address || options.alias;
        const contract = await registry.getContract(chainConfig.chainId, chainConfig.chainName, identifier);
        contracts = [contract];
      } else {
        contracts = await registry.listContracts(chainConfig.chainId, chainConfig.chainName);
      }

      if (contracts.length === 0) {
        console.log('ℹ️  No contracts to validate');
        return;
      }

      console.log(`🔍 Validating ${contracts.length} contract(s)...`);

      let validCount = 0;
      let invalidCount = 0;

      for (const contract of contracts) {
        try {
          const result = await validate.validateContract(
            chainConfig.chainId,
            chainConfig.chainName,
            contract.alias,
            {
              strict: options.strict,
              rpcUrl: chainConfig.rpcUrl
            }
          );

          if (result.valid) {
            console.log(`✅ ${contract.alias}: Valid`);
            if (result.warnings.length > 0) {
              result.warnings.forEach(warning => console.log(`   ⚠️  ${warning}`));
            }
            validCount++;
          } else {
            console.log(`❌ ${contract.alias}: Invalid`);
            result.errors.forEach(error => console.log(`   ❌ ${error}`));
            result.warnings.forEach(warning => console.log(`   ⚠️  ${warning}`));
            invalidCount++;
          }

        } catch (error) {
          console.error(`❌ ${contract.alias}: Error - ${error.message}`);
          invalidCount++;
        }
      }

      console.log(`\n📊 Summary: ${validCount} valid, ${invalidCount} invalid`);

      if (invalidCount > 0) {
        process.exit(1);
      }

    } catch (error) {
      logger.error('Validate command failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Export interfaces
 */
program
  .command('export')
  .description('Export language-agnostic interface bundles')
  .option('-c, --chain <chainId|name>', 'Chain ID or name')
  .option('--address <address>', 'Specific contract address')
  .option('-a, --alias <alias>', 'Specific contract alias')
  .option('--set <setName>', 'Export specific contract set')
  .option('--all', 'Export all contracts')
  .option('--format <format>', 'Export format (interfaces)', 'interfaces')
  .action(async (options) => {
    try {
      if (!options.chain) {
        throw new Error('Chain parameter is required');
      }

      if (options.format !== 'interfaces') {
        throw new Error('Only "interfaces" format is currently supported');
      }

      const chainConfig = await config.getChainConfig(options.chain);

      let result;
      if (options.set) {
        console.log(`📤 Exporting contract set: ${options.set}`);
        result = await exportManager.exportContractSet(chainConfig.chainId, chainConfig.chainName, options.set);
      } else if (options.all) {
        console.log('📤 Exporting all contracts');
        result = await exportManager.exportInterfaces(chainConfig.chainId, chainConfig.chainName);
      } else if (options.address || options.alias) {
        const identifier = options.address || options.alias;
        console.log(`📤 Exporting contract: ${identifier}`);
        result = await exportManager.exportInterfaces(chainConfig.chainId, chainConfig.chainName, [identifier]);
      } else {
        throw new Error('Specify --all, --set, --address, or --alias');
      }

      console.log(`✅ Export completed:`);
      console.log(`   📁 Location: exports/${chainConfig.chainId}-${chainConfig.chainName}/`);
      console.log(`   📊 Contracts: ${result.export.successfulExports}/${result.export.totalContracts}`);
      
      if (result.errors && result.errors.length > 0) {
        console.log(`   ⚠️  Errors: ${result.errors.length}`);
        result.errors.forEach(error => 
          console.log(`      ❌ ${error.alias}: ${error.error}`)
        );
      }

    } catch (error) {
      logger.error('Export command failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Switch contract set
 */
program
  .command('switch-set')
  .description('Switch to a different contract set')
  .option('-c, --chain <chainId|name>', 'Chain ID or name')
  .option('--set <setName>', 'Contract set name')
  .action(async (options) => {
    try {
      if (!options.chain || !options.set) {
        throw new Error('Chain and set parameters are required');
      }

      const chainConfig = await config.getChainConfig(options.chain);
      await registry.switchContractSet(chainConfig.chainId, chainConfig.chainName, options.set);
      
      console.log(`✅ Switched to contract set: ${options.set}`);
    } catch (error) {
      logger.error('Switch set command failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * List chains or contracts
 */
program
  .command('list')
  .description('List chains or contracts')
  .option('--chains', 'List available chains')
  .option('--contracts', 'List contracts')
  .option('-c, --chain <chainId|name>', 'Chain ID or name (required with --contracts)')
  .action(async (options) => {
    try {
      if (options.chains) {
        const chainsConfig = await config.loadChainsConfig();
        
        console.log('\n📋 Available Chains:');
        console.log('┌─────────┬─────────────┬─────────────────────────────────────────┐');
        console.log('│ Chain ID│ Name        │ RPC URL                                 │');
        console.log('├─────────┼─────────────┼─────────────────────────────────────────┤');
        
        for (const chain of chainsConfig.chains) {
          const id = chain.chainId.toString().padEnd(8);
          const name = chain.chainName.padEnd(12);
          const rpc = (chain.rpcUrl || 'Not configured').substring(0, 38).padEnd(38);
          console.log(`│ ${id}│ ${name}│ ${rpc} │`);
        }
        
        console.log('└─────────┴─────────────┴─────────────────────────────────────────┘');

      } else if (options.contracts) {
        if (!options.chain) {
          throw new Error('Chain parameter is required with --contracts');
        }

        const chainConfig = await config.getChainConfig(options.chain);
        const contracts = await registry.listContracts(chainConfig.chainId, chainConfig.chainName);

        console.log(`\n📋 Contracts for ${chainConfig.chainName} (${chainConfig.chainId}):`);
        
        if (contracts.length === 0) {
          console.log('No contracts found. Add contracts with "add-contract" command.');
          return;
        }

        console.log('┌─────────────────────┬──────────────────────────────────────────────┬─────────────────┐');
        console.log('│ Alias               │ Address                                      │ Tags            │');
        console.log('├─────────────────────┼──────────────────────────────────────────────┼─────────────────┤');
        
        for (const contract of contracts) {
          const alias = contract.alias.substring(0, 19).padEnd(19);
          const address = contract.address.padEnd(44);
          const tags = (contract.tags || []).join(', ').substring(0, 15).padEnd(15);
          console.log(`│ ${alias} │ ${address} │ ${tags} │`);
        }
        
        console.log('└─────────────────────┴──────────────────────────────────────────────┴─────────────────┘');

      } else {
        throw new Error('Specify --chains or --contracts');
      }

    } catch (error) {
      logger.error('List command failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Show status across all chains
 */
program
  .command('status')
  .description('Show status of all chains and contracts')
  .action(async () => {
    try {
      const status = await registry.getGlobalStatus();

      console.log('\n📊 Sourcify Grabber Status:');
      console.log('┌─────────────┬───────┬─────────┬──────────┬─────────────────────┐');
      console.log('│ Chain       │ ID    │ Tracked │ Fetched  │ Last Refresh        │');
      console.log('├─────────────┼───────┼─────────┼──────────┼─────────────────────┤');
      
      for (const chainStatus of status) {
        const name = chainStatus.chainName.substring(0, 11).padEnd(11);
        const id = chainStatus.chainId.toString().padEnd(5);
        const tracked = chainStatus.totalTracked.toString().padEnd(7);
        const fetched = chainStatus.fetchedOk.toString().padEnd(8);
        const lastRefresh = chainStatus.lastRefresh 
          ? new Date(chainStatus.lastRefresh).toISOString().substring(0, 19).replace('T', ' ')
          : 'Never';
        
        if (chainStatus.error) {
          console.log(`│ ${name} │ ${id} │ ${tracked} │ ERROR    │ ${lastRefresh} │`);
        } else {
          console.log(`│ ${name} │ ${id} │ ${tracked} │ ${fetched} │ ${lastRefresh} │`);
        }
      }
      
      console.log('└─────────────┴───────┴─────────┴──────────┴─────────────────────┘');

      // Summary
      const totalTracked = status.reduce((sum, s) => sum + s.totalTracked, 0);
      const totalFetched = status.reduce((sum, s) => sum + s.fetchedOk, 0);
      
      console.log(`\n📈 Overall: ${totalFetched}/${totalTracked} contracts fetched`);

    } catch (error) {
      logger.error('Status command failed', { error: error.message });
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Handle unknown commands
program.on('command:*', function (operands) {
  console.error(`❌ Unknown command: ${operands[0]}`);
  console.log('Run "sourcify-grabber --help" for available commands');
  process.exit(1);
});

// Parse command line arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}