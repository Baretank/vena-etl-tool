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
// eslint-disable-next-line no-unused-vars
const { checkJobStatus } = require('./src/api/jobs');
const { 
  createEtlJob, 
  loadFileToStep, 
  submitJob
} = require('./src/api/multiImport');

// Utilities
const { 
  validateCsvFile, 
  sanitizeFilePath, 
  sanitizeId
} = require('./src/utils/fileHandling');
const { logError } = require('./src/utils/logging');
const { retryOperation, executeWithErrorHandling } = require('./src/utils/apiResponse');
const { createUploadController } = require('./src/utils/uploadController');

// Store active uploads for potential abort
const activeUploads = new Map();

// Scheduler
const { 
  createScheduledTask,
  checkTaskExists,
  deleteTask
} = require('./src/scheduler/windowsTaskScheduler');

// Validate configuration
validateConfig();

// Parse command-line arguments
const args = process.argv.slice(2);
let command = 'run'; // Default command

// Handle commands
if (args.length > 0 && ['run', 'schedule', 'check-schedule', 'delete-schedule', 'help'].includes(args[0])) {
  command = args[0];
}

// Handle termination signals
process.on('SIGINT', async () => {
  console.log('\n\nReceived interrupt signal. Cleaning up active uploads...');
  
  // Abort all active uploads
  const abortPromises = [];
  activeUploads.forEach((controller, id) => {
    console.log(`Aborting upload: ${id}`);
    controller.abort(new Error('User interrupted process'));
    abortPromises.push(new Promise(resolve => setTimeout(resolve, 100))); // Small delay for cleanup
  });
  
  // Wait a moment for cleanup to complete
  if (abortPromises.length > 0) {
    console.log(`Waiting for ${abortPromises.length} uploads to abort...`);
    await Promise.all(abortPromises);
  }
  
  console.log('Clean-up complete. Exiting...');
  process.exit(1);
});

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
  check-schedule     Check if a scheduled task exists
  delete-schedule    Delete an existing scheduled task
  help               Show this help message

Examples:
  node multi_import.js run
  node multi_import.js schedule
  node multi_import.js check-schedule
  node multi_import.js delete-schedule
  
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
  // This is the end of the application, so we'll still use process.exit
  // but add a comment to explain why it's acceptable in this case
  return; // Instead of process.exit(0), just return early
}

/**
 * Load configuration from .env file
 * @returns {Object} Import configuration
 */
function loadEnvConfiguration() {
  // Get source directory from config module
  const sourceDirectory = config.etl.sourceDirectory;
  
  if (!sourceDirectory) {
    throw new Error('VENA_SOURCE_DIRECTORY not defined in .env file or configuration');
  }
  
  // Sanitize the source directory
  const sanitizedSourceDirectory = sanitizeFilePath(sourceDirectory);
  
  if (sanitizedSourceDirectory !== sourceDirectory) {
    console.warn('Warning: Source directory contained potentially unsafe characters and was sanitized.');
  }
  
  const fileMappings = [];
  let mappingIndex = 1;
  
  // Load each mapping from environment variables
  while (process.env[`VENA_FILE_PATTERN_${mappingIndex}`]) {
    const filePattern = process.env[`VENA_FILE_PATTERN_${mappingIndex}`];
    const templateId = process.env[`VENA_TEMPLATE_ID_${mappingIndex}`] || 
                       (mappingIndex === 1 ? config.api.defaultTemplateId : null);
    const processType = process.env[`VENA_PROCESS_TYPE_${mappingIndex}`] || 'single';
    
    // Sanitize the template ID
    const sanitizedTemplateId = sanitizeId(templateId);
    
    if (sanitizedTemplateId !== templateId) {
      console.warn(`Warning: Template ID for mapping ${mappingIndex} contained potentially unsafe characters and was sanitized.`);
    }
    
    if (!sanitizedTemplateId) {
      console.warn(`Warning: VENA_TEMPLATE_ID_${mappingIndex} not defined for pattern ${filePattern}. Skipping.`);
      mappingIndex++;
      continue;
    }
    
    // Sanitize the file pattern to prevent malicious regex patterns
    const sanitizedFilePattern = filePattern.replace(/[^a-zA-Z0-9.\-_*]/g, '');
    
    if (sanitizedFilePattern !== filePattern) {
      console.warn(`Warning: File pattern for mapping ${mappingIndex} contained potentially unsafe characters and was sanitized.`);
    }
    
    const mapping = {
      filePattern: sanitizedFilePattern,
      templateId: sanitizedTemplateId,
      processType
    };
    
    // If multi-step process, load step configurations
    if (processType === 'multi') {
      const steps = [];
      let stepIndex = 1;
      
      while (process.env[`VENA_STEP_INPUT_ID_${mappingIndex}_${stepIndex}`]) {
        const inputId = process.env[`VENA_STEP_INPUT_ID_${mappingIndex}_${stepIndex}`];
        const stepFilePattern = process.env[`VENA_STEP_FILE_PATTERN_${mappingIndex}_${stepIndex}`];
        
        // Sanitize step input values
        const sanitizedInputId = sanitizeId(inputId);
        
        if (sanitizedInputId !== inputId) {
          console.warn(`Warning: Input ID for step ${stepIndex} of mapping ${mappingIndex} contained potentially unsafe characters and was sanitized.`);
        }
        
        const sanitizedStepFilePattern = stepFilePattern ? 
          stepFilePattern.replace(/[^a-zA-Z0-9.\-_*]/g, '') : 
          '';
        
        if (sanitizedStepFilePattern !== stepFilePattern) {
          console.warn(`Warning: File pattern for step ${stepIndex} of mapping ${mappingIndex} contained potentially unsafe characters and was sanitized.`);
        }
        
        if (sanitizedInputId && sanitizedStepFilePattern) {
          steps.push({
            inputId: sanitizedInputId,
            filePattern: sanitizedStepFilePattern
          });
        }
        
        stepIndex++;
      }
      
      mapping.steps = steps;
      
      // Validate multi-step configuration
      if (steps.length === 0) {
        console.warn(`Warning: Multi-step process defined for mapping ${mappingIndex}, but no valid steps found. Skipping.`);
        mappingIndex++;
        continue;
      }
    }
    
    fileMappings.push(mapping);
    mappingIndex++;
  }
  
  if (fileMappings.length === 0) {
    throw new Error('No valid file mappings found in .env file or configuration');
  }
  
  return {
    sourceDirectory: sanitizedSourceDirectory,
    fileMappings
  };
}

/**
 * Attempt to upload a file with retry logic
 * @param {string} filePath Path to the file
 * @param {string} templateId Template ID
 * @param {number} maxRetries Maximum number of retry attempts
 * @returns {Promise<Object>} Upload result
 */
async function uploadFileWithRetry(filePath, templateId, maxRetries = 3) {
  const fileName = path.basename(filePath);
  const uploadId = `${fileName}-${Date.now()}`;
  
  // Create upload controller for abort handling and timeouts
  const controller = createUploadController(uploadId, config.api.uploadTimeout);
  // Register with active uploads for potential abort
  activeUploads.set(uploadId, controller);
  
  try {
    // Validate file first
    const validation = validateCsvFile(filePath);
    
    if (!validation.success) {
      console.error(`Error: ${validation.error}`);
      return { success: false, error: validation.error };
    }
    
    if (validation.warning) {
      console.warn(`Warning: ${validation.warning}`);
    }
    
    // Use retry operation utility
    console.log(`Uploading file: ${fileName} (with up to ${maxRetries} retries if needed)`);
    
    const result = await retryOperation(
      async () => {
        // Check if already aborted
        if (controller.signal.aborted) {
          throw new DOMException('The operation was aborted', 'AbortError');
        }
        
        return await uploadFile(filePath, templateId, validation.fileName, validation.fileSize, controller.signal);
      },
      maxRetries,
      1000, // Initial 1 second backoff
      (error) => {
        // Don't retry if aborted
        if (error.name === 'AbortError') {
          return false;
        }
        
        // Retry on network errors or 5xx server errors
        const isNetworkError = error.message.includes('ECONNRESET') || 
                              error.message.includes('ETIMEDOUT') ||
                              error.message.includes('ECONNREFUSED');
        const isServerError = error.message.includes('HTTP error! Status: 5');
        return isNetworkError || isServerError;
      },
      controller.signal
    );
    
    console.log(`✅ Upload successful. Job ID: ${result.jobId}`);
    return { success: true, result };
  } catch (err) {
    // Check if this was an abort
    if (err.name === 'AbortError') {
      console.log(`Upload of ${fileName} was aborted: ${err.message || 'Manual abort'}`);
      return { success: false, aborted: true, error: err.message };
    }
    
    console.error(`❌ Error processing file ${fileName} after ${maxRetries} attempts:`, err.message);
    logError({
      action: 'upload-file-with-retry',
      file: fileName,
      templateId,
      maxRetries,
      error: err.message
    });
    return { success: false, error: err.message };
  } finally {
    // Always clean up and remove from active uploads
    controller.cleanup();
    activeUploads.delete(uploadId);
  }
}

/**
 * Get files matching a pattern from a directory
 * @param {string} directory Directory to search
 * @param {string} pattern File pattern (glob)
 * @returns {Array} List of matching files
 */
function getMatchingFiles(directory, pattern) {
  // Security note: This function intentionally works with non-literal paths from configuration
  // as it's core functionality of the tool. The directory is validated from environment variables
  // and the pattern is controlled by the application configuration.
  
  // Sanitize inputs to prevent security issues
  const sanitizedDirectory = sanitizeFilePath(directory);
  
  // Sanitize pattern to prevent malicious regex patterns
  // Only allow alphanumeric, dot, dash, underscore, and asterisk in patterns
  const sanitizedPattern = pattern.replace(/[^a-zA-Z0-9.\-_*]/g, '');
  
  // Log warnings if sanitization changed any values
  if (sanitizedDirectory !== directory) {
    console.warn('Warning: Directory path contained potentially unsafe characters and was sanitized.');
  }
  
  if (sanitizedPattern !== pattern) {
    console.warn('Warning: File pattern contained potentially unsafe characters and was sanitized.');
  }
  
  // Simple glob pattern matching (supports * wildcard only)
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const files = fs.readdirSync(sanitizedDirectory);
  
  // Security note: We are constructing a RegExp from user input, but it's controlled
  // through the configuration, sanitized, and limited to glob pattern characters
  // eslint-disable-next-line security/detect-non-literal-regexp
  const patternRegex = new RegExp('^' + sanitizedPattern.replace(/\*/g, '.*') + '$');
  
  return files.filter(file => patternRegex.test(file));
}

/**
 * Load file to a step with retry logic
 * @param {string} jobId Job ID
 * @param {string} inputId Input ID
 * @param {string} filePath File path
 * @param {number} maxRetries Maximum number of retry attempts
 * @returns {Promise<Object>} Result of the file loading
 */
async function loadFileToStepWithRetry(jobId, inputId, filePath, maxRetries = 3) {
  const fileName = path.basename(filePath);
  const uploadId = `${fileName}-to-step-${inputId}-${Date.now()}`;
  
  // Create upload controller for abort handling and timeouts
  const controller = createUploadController(uploadId, config.api.uploadTimeout);
  // Register with active uploads for potential abort
  activeUploads.set(uploadId, controller);
  
  try {
    // Validate file first
    const validation = validateCsvFile(filePath);
    
    if (!validation.success) {
      console.error(`Error: ${validation.error}`);
      return { success: false, error: validation.error };
    }
    
    // Use retry operation utility
    console.log(`Loading file: ${fileName} to step input ${inputId} (with up to ${maxRetries} retries if needed)`);
    
    await retryOperation(
      async () => {
        // Check if already aborted
        if (controller.signal.aborted) {
          throw new DOMException('The operation was aborted', 'AbortError');
        }
        
        return await loadFileToStep(jobId, inputId, filePath, controller.signal);
      },
      maxRetries,
      1000, // Initial 1 second backoff
      (error) => {
        // Don't retry if aborted
        if (error.name === 'AbortError') {
          return false;
        }
        
        // Retry on network errors or 5xx server errors
        const isNetworkError = error.message.includes('ECONNRESET') || 
                              error.message.includes('ETIMEDOUT') ||
                              error.message.includes('ECONNREFUSED');
        const isServerError = error.message.includes('HTTP error! Status: 5');
        return isNetworkError || isServerError;
      },
      controller.signal
    );
    
    console.log('✅ File loaded to step successfully');
    return { success: true };
  } catch (err) {
    // Check if this was an abort
    if (err.name === 'AbortError') {
      console.log(`Loading of ${fileName} to step ${inputId} was aborted: ${err.message || 'Manual abort'}`);
      return { success: false, aborted: true, error: err.message };
    }
    
    console.error(`❌ Error loading file ${fileName} to step ${inputId} after ${maxRetries} attempts:`, err.message);
    logError({
      action: 'load-file-to-step-with-retry',
      jobId,
      inputId,
      file: fileName,
      maxRetries,
      error: err.message
    });
    return { success: false, error: err.message };
  } finally {
    // Always clean up and remove from active uploads
    controller.cleanup();
    activeUploads.delete(uploadId);
  }
}

/**
 * Validate that all required step inputs have matching files
 * @param {string} sourceDirectory Source directory path
 * @param {Object} mapping Mapping configuration
 * @returns {Object} Validation result with success flag and errors/warnings
 */
function validateStepInputs(sourceDirectory, mapping) {
  const result = {
    success: true,
    warnings: [],
    errors: []
  };

  // Only multi-step processes need validation
  if (mapping.processType !== 'multi' || !mapping.steps || mapping.steps.length === 0) {
    return result;
  }

  console.log(`Validating inputs for ${mapping.steps.length} steps...`);

  // Check each step for matching files
  for (const step of mapping.steps) {
    const stepFiles = getMatchingFiles(sourceDirectory, step.filePattern);
    
    if (stepFiles.length === 0) {
      result.errors.push(`No files found matching pattern '${step.filePattern}' for input ID '${step.inputId}'`);
      result.success = false;
    } else if (stepFiles.length > 1) {
      result.warnings.push(`Multiple files (${stepFiles.length}) found matching pattern '${step.filePattern}' for input ID '${step.inputId}'. Will use the first file.`);
    }
  }

  return result;
}

/**
 * Execute multi-file upload based on .env configuration
 * @returns {Promise<boolean>} Success status
 */
async function executeMultiUpload() {
  // Using centralized error handling in main(), but keeping try/catch at this level
  // for specific error handling and recovery
  try {
    // Load configuration from .env file
    const config = loadEnvConfiguration();
    
    console.log(`\n=== Starting multi-file upload from ${config.sourceDirectory} ===\n`);
    
    // Check if directory exists
    // eslint-disable-next-line security/detect-non-literal-fs-filename
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
        // Track files with failed uploads for retry
        const failedFiles = [];
        const abortedFiles = [];
        const maxRetries = config.api.retryAttempts || 3; // Use config or default
        
        // Process each file individually with standard upload
        for (const file of files) {
          const filePath = path.join(config.sourceDirectory, file);
          
          console.log(`\nProcessing file: ${file}`);
          
          // Use new upload with retry function
          const result = await uploadFileWithRetry(filePath, mapping.templateId, maxRetries);
          
          if (result.success) {
            const data = result.result;
            console.log(`To check status: node import.js status ${data.jobId}`);
          } else if (result.aborted) {
            // Add to aborted files list
            abortedFiles.push({
              file,
              filePath,
              templateId: mapping.templateId,
              reason: result.error || 'Manual abort'
            });
          } else {
            // Add to failed files list for potential manual retry
            failedFiles.push({
              file,
              filePath,
              templateId: mapping.templateId,
              error: result.error
            });
          }
          
          // Check if the process has been interrupted (check if there are active aborts)
          if (activeUploads.size === 0 && Array.from(activeUploads.values()).some(c => c.signal.aborted)) {
            console.log('\nProcess interrupted. Stopping further uploads.');
            break;
          }
        }
        
        // Display summary of aborted files
        if (abortedFiles.length > 0) {
          console.log(`\n⚠️ ${abortedFiles.length} file(s) were aborted during upload:`);
          abortedFiles.forEach((abortedFile, index) => {
            console.log(`  ${index + 1}. ${abortedFile.file} - Reason: ${abortedFile.reason}`);
          });
          
          // Store aborted files for reference
          logError({
            action: 'aborted-files-summary',
            count: abortedFiles.length,
            files: abortedFiles.map(f => f.file),
            templateId: mapping.templateId
          });
        }
        
        // Display summary of failed files
        if (failedFiles.length > 0) {
          console.log(`\n⚠️ ${failedFiles.length} file(s) failed to upload after ${maxRetries} retry attempts:`);
          failedFiles.forEach((failedFile, index) => {
            console.log(`  ${index + 1}. ${failedFile.file} - Error: ${failedFile.error}`);
          });
          
          // Store failed files for reference
          logError({
            action: 'failed-files-summary',
            count: failedFiles.length,
            files: failedFiles.map(f => f.file),
            templateId: mapping.templateId
          });
        }
      } else if (mapping.processType === 'multi') {
        // Multi-step process for each set of files
        console.log(`\nStarting multi-step process for template ID: ${mapping.templateId}`);
        
        try {
          // Validate that all required step inputs have matching files BEFORE creating the job
          const validation = validateStepInputs(config.sourceDirectory, mapping);
          
          // Display any validation warnings
          if (validation.warnings.length > 0) {
            console.log('\nWarnings:');
            validation.warnings.forEach(warning => console.log(`- ${warning}`));
          }
          
          // If validation failed, log errors and skip this mapping
          if (!validation.success) {
            console.error('\nValidation failed:');
            validation.errors.forEach(error => console.error(`- ${error}`));
            console.error('Skipping this mapping due to missing required files.');
            
            // Log the error
            logError({
              action: 'validate-step-inputs',
              templateId: mapping.templateId,
              errors: validation.errors
            });
            
            continue; // Skip to the next mapping
          }
          
          // Create job
          console.log('\nAll required files found. Creating ETL job...');
          const job = await createEtlJob(mapping.templateId);
          
          console.log(`Job created with ID: ${job.id}`);
          
          // Keep track of failed and aborted step files
          const failedSteps = [];
          const abortedSteps = [];
          const maxRetries = config.api.retryAttempts || 3; // Use config or default

          // Create job-level controller for coordinated abort
          const jobController = createUploadController(`job-${job.id}`, config.api.uploadTimeout * 2);

          // Process each step
          for (const step of mapping.steps) {
            console.log(`\nProcessing step with input ID: ${step.inputId}`);
            
            // Get matching files for this step (already validated, but we need the files)
            const stepFiles = getMatchingFiles(config.sourceDirectory, step.filePattern);
            console.log(`Found ${stepFiles.length} matching files for this step`);
            
            // For multi-step, we'll use the first matching file only
            const stepFile = stepFiles[0];
            const stepFilePath = path.join(config.sourceDirectory, stepFile);
            
            // Upload file to step with retry
            const result = await loadFileToStepWithRetry(job.id, step.inputId, stepFilePath, maxRetries);
            
            if (!result.success) {
              if (result.aborted) {
                // Add to aborted steps list
                abortedSteps.push({
                  inputId: step.inputId,
                  file: stepFile,
                  reason: result.error || 'Manual abort'
                });
                
                // Abort the entire job if a step was aborted
                jobController.abort(new Error('Step upload was aborted'));
                break;
              } else {
                // Add to failed steps list
                failedSteps.push({
                  inputId: step.inputId,
                  file: stepFile,
                  error: result.error
                });
              }
            }
            
            // Check if the job process has been aborted
            if (jobController.signal.aborted) {
              console.log(`\nJob processing for ${job.id} has been aborted. Skipping remaining steps.`);
              break;
            }
          }
          
          // Display summary of aborted step files
          if (abortedSteps.length > 0) {
            console.log(`\n⚠️ ${abortedSteps.length} step file(s) were aborted during upload.`);
            console.log('The job will not be submitted.');
            
            abortedSteps.forEach((abortedStep, index) => {
              console.log(`  ${index + 1}. Step ${abortedStep.inputId}: ${abortedStep.file} - Reason: ${abortedStep.reason}`);
            });
            
            // Log the abort
            logError({
              action: 'multi-step-aborted-files',
              jobId: job.id,
              count: abortedSteps.length,
              steps: abortedSteps.map(s => ({ inputId: s.inputId, file: s.file, reason: s.reason })),
              templateId: mapping.templateId
            });
            
            // Skip to next mapping since we aborted
            continue;
          }
          
          // Display summary of failed step files
          if (failedSteps.length > 0) {
            console.error(`\n⚠️ ${failedSteps.length} step file(s) failed to load after ${maxRetries} retry attempts.`);
            console.error('This may cause the job to fail when submitted.');
            
            failedSteps.forEach((failedStep, index) => {
              console.error(`  ${index + 1}. Step ${failedStep.inputId}: ${failedStep.file} - Error: ${failedStep.error}`);
            });
            
            // Log the failure
            logError({
              action: 'multi-step-failed-files',
              jobId: job.id,
              count: failedSteps.length,
              steps: failedSteps.map(f => ({ inputId: f.inputId, file: f.file })),
              templateId: mapping.templateId
            });
            
            // Ask for confirmation before proceeding
            console.log('\nDo you want to submit the job anyway? (Y/n)');
            const shouldProceed = await new Promise(resolve => {
              process.stdin.once('data', data => {
                const input = data.toString().trim().toLowerCase();
                resolve(input !== 'n' && input !== 'no');
              });
            });
            
            if (!shouldProceed) {
              console.log('Job submission cancelled.');
              continue; // Skip to next mapping
            }
          }
          
          // Submit job with abort signal from job controller
          console.log('\nSubmitting job for processing...');
          try {
            const result = await submitJob(job.id, jobController.signal);
            
            console.log(`✅ Job submitted successfully. Status: ${result.status}`);
            console.log(`To check status: node import.js status ${job.id}`);
          } catch (err) {
            if (err.name === 'AbortError') {
              console.log(`Job submission for ${job.id} was aborted.`);
            } else {
              console.error(`❌ Error submitting job: ${err.message}`);
              
              // Log the error
              logError({
                action: 'submit-job-error',
                jobId: job.id,
                templateId: mapping.templateId,
                error: err.message
              });
            }
          } finally {
            // Clean up job controller
            jobController.cleanup();
          }
        } catch (err) {
          console.error('❌ Error in multi-step process:', err.message);
          logError({
            action: 'multi-step-process',
            templateId: mapping.templateId,
            error: err.message
          });
        }
      }
    }
    
    console.log('\n=== Multi-file upload completed ===');
    return true;
  } catch (err) {
    console.error('Execution failed:', err.message);
    logError({
      action: 'execute-multi-upload',
      error: err.message
    });
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  // Get the task name from config for scheduler operations
  const taskName = process.env.VENA_TASK_NAME || 'VenaETLImport';
  
  // Use centralized error handling
  return await executeWithErrorHandling(command, async () => {  
    switch (command) {
    case 'run': {
      return await executeMultiUpload();
    }
      
    case 'schedule': {
      return await createScheduledTask();
    }
    
    case 'check-schedule': {
      console.log(`\n=== Checking for scheduled task: ${taskName} ===\n`);
      const exists = await checkTaskExists(taskName);
      
      if (exists) {
        console.log(`✅ Scheduled task "${taskName}" exists.`);
        console.log('\nTo view details, run this command as Administrator:');
        console.log(`schtasks /query /tn "${taskName}" /fo list /v`);
      } else {
        console.log(`❌ Scheduled task "${taskName}" does not exist.`);
        return true;
      }
      
      try {
        // Attempt to delete the task
        await deleteTask(taskName);
        console.log(`✅ Scheduled task "${taskName}" deleted successfully.`);
        return true;
      } catch (err) {
        console.error(`❌ Failed to delete task: ${err.message}`);
        console.log('\nTo delete the task manually, run this command as Administrator:');
        console.log(`schtasks /delete /tn "${taskName}" /f`);
        return false;
      }
    }
      
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "node multi_import.js help" for usage information');
      throw new Error(`Unknown command: ${command}`);
    }
  });
}

// Execute the main function
main()
  // Using regular promises instead of explicit process.exit
  // Node will automatically exit when the promise chain completes
  .then(success => {
    if (!success) {
      // For unsuccessful execution, use a non-zero exit code by throwing
      throw new Error('Execution failed with errors');
    }
    // Otherwise the process will naturally exit with code 0
  })
  .catch(err => {
    console.error('Unhandled error:', err);
    logError({
      action: 'main-execution-promise',
      error: err.toString()
    });
    throw err; // This will cause the process to exit with a non-zero code
  });