#!/usr/bin/env node

/**
 * Vena Multi-File ETL Import Tool (.env configuration version)
 * Command-line utility for importing multiple files to Vena using ETL API
 */

// Core modules
const path = require('path');
const fs = require('fs');

// Configuration
const { config, validateConfig } = require('./src/config');

// API modules
const { uploadFile } = require('./src/api/templates');
const { checkJobStatus } = require('./src/api/jobs');
const { 
  createEtlJob, 
  loadFileToStep, 
  submitJob
} = require('./src/api/multiImport');

// Utilities
const { validateCsvFile } = require('./src/utils/fileHandling');
const { logError } = require('./src/utils/logging');

// Scheduler
const { createScheduledTask } = require('./src/scheduler/windowsTaskScheduler');

// Validate configuration
validateConfig();

// Parse command-line arguments
const args = process.argv.slice(2);
let command = 'run'; // Default command

// Handle commands
if (args.length > 0 && ['run', 'schedule', 'help'].includes(args[0])) {
  command = args[0];
}

// Display help
if (command === 'help') {
  console.log(`
Vena Multi-Import Tool (.env Configuration)
===========================================

Usage: 
  node multi_import.js [command]

Commands:
  run                Run the import with mapping from .env (default)
  schedule           Create a scheduled task based on .env settings
  help               Show this help message

Examples:
  node multi_import.js run
  node multi_import.js schedule
  
Configuration:
  This tool reads all configuration from the .env file:
  
  # Source Directory
  VENA_SOURCE_DIRECTORY             Directory containing CSV files
  
  # File Mappings
  VENA_FILE_PATTERN_1               File pattern for mapping 1
  VENA_TEMPLATE_ID_1                Template ID for mapping 1
  VENA_PROCESS_TYPE_1               Process type ("single" or "multi")
  
  # For multi-step processes
  VENA_STEP_INPUT_ID_1_1            Input ID for step 1 of mapping 1
  VENA_STEP_FILE_PATTERN_1_1        File pattern for step 1 of mapping 1
  
  # Scheduling Configuration
  VENA_SCHEDULE_MINUTE              Minute (0-59)
  VENA_SCHEDULE_HOUR                Hour (0-23)
  VENA_SCHEDULE_DAY                 Day of month (1-31 or *)
  VENA_SCHEDULE_MONTH               Month (1-12 or *)
  VENA_SCHEDULE_DAYOFWEEK           Day of week (0-6, 0=Sunday or *)
  
  Add more mappings with increasing numbers (VENA_FILE_PATTERN_2, etc.)
  `);
  process.exit(0);
}

/**
 * Load configuration from .env file
 * @returns {Object} Import configuration
 */
function loadEnvConfiguration() {
  // Get source directory
  const sourceDirectory = process.env.VENA_SOURCE_DIRECTORY;
  
  if (!sourceDirectory) {
    throw new Error('VENA_SOURCE_DIRECTORY not defined in .env file');
  }
  
  const fileMappings = [];
  let mappingIndex = 1;
  
  // Load each mapping from environment variables
  while (process.env[`VENA_FILE_PATTERN_${mappingIndex}`]) {
    const filePattern = process.env[`VENA_FILE_PATTERN_${mappingIndex}`];
    const templateId = process.env[`VENA_TEMPLATE_ID_${mappingIndex}`];
    const processType = process.env[`VENA_PROCESS_TYPE_${mappingIndex}`] || 'single';
    
    if (!templateId) {
      console.warn(`Warning: VENA_TEMPLATE_ID_${mappingIndex} not defined for pattern ${filePattern}. Skipping.`);
      mappingIndex++;
      continue;
    }
    
    const mapping = {
      filePattern,
      templateId,
      processType
    };
    
    // If multi-step process, load step configurations
    if (processType === 'multi') {
      const steps = [];
      let stepIndex = 1;
      
      while (process.env[`VENA_STEP_INPUT_ID_${mappingIndex}_${stepIndex}`]) {
        const inputId = process.env[`VENA_STEP_INPUT_ID_${mappingIndex}_${stepIndex}`];
        const stepFilePattern = process.env[`VENA_STEP_FILE_PATTERN_${mappingIndex}_${stepIndex}`];
        
        if (inputId && stepFilePattern) {
          steps.push({
            inputId,
            filePattern: stepFilePattern
          });
        }
        
        stepIndex++;
      }
      
      mapping.steps = steps;
    }
    
    fileMappings.push(mapping);
    mappingIndex++;
  }
  
  if (fileMappings.length === 0) {
    throw new Error('No file mappings found in .env file');
  }
  
  return {
    sourceDirectory,
    fileMappings
  };
}

/**
 * Get files matching a pattern from a directory
 * @param {string} directory Directory to search
 * @param {string} pattern File pattern (glob)
 * @returns {Array} List of matching files
 */
function getMatchingFiles(directory, pattern) {
  // Simple glob pattern matching (supports * wildcard only)
  const files = fs.readdirSync(directory);
  const patternRegex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  
  return files.filter(file => patternRegex.test(file));
}

/**
 * Execute multi-file upload based on .env configuration
 * @returns {Promise<boolean>} Success status
 */
async function executeMultiUpload() {
  try {
    // Load configuration from .env file
    const config = loadEnvConfiguration();
    
    console.log(`\n=== Starting multi-file upload from ${config.sourceDirectory} ===\n`);
    
    // Check if directory exists
    if (!fs.existsSync(config.sourceDirectory)) {
      console.error(`Error: Source directory not found: ${config.sourceDirectory}`);
      return false;
    }
    
    // Process each mapping
    for (const mapping of config.fileMappings) {
      console.log(`\n--- Processing mapping for pattern: ${mapping.filePattern} ---`);
      
      // Get matching files
      const files = getMatchingFiles(config.sourceDirectory, mapping.filePattern);
      
      if (files.length === 0) {
        console.log(`No files found matching pattern: ${mapping.filePattern}`);
        continue;
      }
      
      console.log(`Found ${files.length} matching files`);
      
      if (mapping.processType === 'single') {
        // Process each file individually with standard upload
        for (const file of files) {
          const filePath = path.join(config.sourceDirectory, file);
          
          console.log(`\nProcessing file: ${file}`);
          
          try {
            // Validate file
            const validation = validateCsvFile(filePath);
            
            if (!validation.success) {
              console.error(`Error: ${validation.error}`);
              continue;
            }
            
            if (validation.warning) {
              console.warn(`Warning: ${validation.warning}`);
            }
            
            // Upload file
            const data = await uploadFile(filePath, mapping.templateId, validation.fileName, validation.fileSize);
            
            if (data.jobId) {
              console.log(`✅ Upload successful. Job ID: ${data.jobId}`);
              console.log(`To check status: node import.js status ${data.jobId}`);
            }
          } catch (err) {
            console.error(`❌ Error processing file ${file}:`, err.message);
          }
        }
      } else if (mapping.processType === 'multi') {
        // Multi-step process for each set of files
        console.log(`\nStarting multi-step process for template ID: ${mapping.templateId}`);
        
        try {
          // Create job
          console.log('Creating ETL job...');
          const job = await createEtlJob(mapping.templateId);
          
          console.log(`Job created with ID: ${job.id}`);
          
          // Process each step
          for (const step of mapping.steps) {
            console.log(`\nProcessing step with input ID: ${step.inputId}`);
            
            // Get matching files for this step
            const stepFiles = getMatchingFiles(config.sourceDirectory, step.filePattern);
            
            if (stepFiles.length === 0) {
              console.log(`Warning: No files found matching pattern: ${step.filePattern}`);
              continue;
            }
            
            console.log(`Found ${stepFiles.length} matching files for this step`);
            
            // For multi-step, we'll use the first matching file only (or handle specially)
            const stepFile = stepFiles[0];
            const stepFilePath = path.join(config.sourceDirectory, stepFile);
            
            console.log(`Loading file: ${stepFile} to step input ${step.inputId}`);
            
            // Upload file to step
            await loadFileToStep(job.id, step.inputId, stepFilePath);
            
            console.log(`✅ File loaded to step successfully`);
          }
          
          // Submit job
          console.log('\nSubmitting job for processing...');
          const result = await submitJob(job.id);
          
          console.log(`✅ Job submitted successfully. Status: ${result.status}`);
          console.log(`To check status: node import.js status ${job.id}`);
        } catch (err) {
          console.error('❌ Error in multi-step process:', err.message);
        }
      }
    }
    
    console.log('\n=== Multi-file upload completed ===');
    return true;
  } catch (err) {
    console.error('Execution failed:', err.message);
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    switch (command) {
      case 'run': {
        return await executeMultiUpload();
      }
      
      case 'schedule': {
        return await createScheduledTask();
      }
      
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "node multi_import.js help" for usage information');
        process.exit(1);
    }
  } catch (err) {
    console.error('Unhandled error:', err);
    return false;
  }
}

// Execute the main function
main()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
  });