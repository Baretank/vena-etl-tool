/**
 * Multi-Import API operations for Vena ETL Tool
 * Handles ETL job creation, file loading to specific steps, and job submission
 */
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch'); // Added missing import
const { config } = require('../config');
const { getRequestHeaders } = require('../auth');
const { fetchWithRetry } = require('./templates');
const { logUpload, logError} = require('../utils/logging');
const { sanitizeFilePath, sanitizeId } = require('../utils/fileHandling');
const { handleApiResponse, retryOperation } = require('../utils/apiResponse');

/**
 * Create a new ETL job from a template without starting it
 * @param {string} templateId Template ID
 * @returns {Promise<Object>} Created job
 */
async function createEtlJob(templateId) {
  // Sanitize the template ID to prevent injection attacks
  const sanitizedTemplateId = sanitizeId(templateId);
  
  if (sanitizedTemplateId !== templateId) {
    console.warn('Warning: Template ID contained potentially unsafe characters and was sanitized.');
  }
  
  console.log(`Creating ETL job from template ID: ${sanitizedTemplateId}`);
  
  const options = {
    method: 'POST',
    headers: getRequestHeaders()
  };
  
  // Use centralized response handler
  const job = await handleApiResponse(
    'create-etl-job',
    async () => {
      return await fetchWithRetry(
        `${config.api.baseUrl}/api/public/v1/etl/templates/${sanitizedTemplateId}/jobs`, 
        options
      );
    },
    { templateId: sanitizedTemplateId }
  );
  
  console.log('✅ ETL job created successfully');
  console.log(`Job ID: ${job.id}`);
  
  return job;
}

/**
 * Load file to a specific ETL step using streaming
 * @param {string} jobId Job ID
 * @param {string} inputId Input ID (step ID)
 * @param {string} filePath File path
 * @param {AbortSignal} signal Optional abort signal
 * @returns {Promise<void>} 
 */
async function loadFileToStep(jobId, inputId, filePath, signal) {
  // Sanitize inputs to prevent injection and path traversal attacks
  const sanitizedJobId = sanitizeId(jobId);
  const sanitizedInputId = sanitizeId(inputId);
  const sanitizedFilePath = sanitizeFilePath(filePath);
  
  // Log warnings if sanitization changed any values
  if (sanitizedJobId !== jobId) {
    console.warn('Warning: Job ID contained potentially unsafe characters and was sanitized.');
  }
  
  if (sanitizedInputId !== inputId) {
    console.warn('Warning: Input ID contained potentially unsafe characters and was sanitized.');
  }
  
  if (sanitizedFilePath !== filePath) {
    console.warn('Warning: File path contained potentially unsafe characters and was sanitized.');
  }
  
  console.log(`Loading file to ETL step: Job ID ${sanitizedJobId}, Input ID ${sanitizedInputId}`);
  
  const fileName = path.basename(sanitizedFilePath);
  
  // Get file size without loading the file
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileSize = (fs.statSync(sanitizedFilePath).size / 1024).toFixed(2) + ' KB';
  
  console.log(`File: ${fileName} (${fileSize})`);
  
  // Check if already aborted
  if (signal && signal.aborted) {
    console.log(`Upload of ${fileName} already aborted before starting.`);
    throw new DOMException('The operation was aborted', 'AbortError');
  }
  
  // Import the centralized streaming upload utility
  const { streamingUpload } = require('../utils/streamingUpload');
  
  // Generate unique upload ID
  const uploadId = `step-upload-${fileName}-${sanitizedInputId}-${Date.now()}`;
  
  // Define API endpoint
  const endpoint = `${config.api.baseUrl}/api/public/v1/etl/jobs/${sanitizedJobId}/inputs/${sanitizedInputId}/file`;
  
  // Create metadata
  const metadata = {
    input: {
      partName: 'file',
      fileFormat: 'CSV',
      fileEncoding: 'UTF-8',
      fileName: fileName
    }
  };
  
  try {
    // Use the centralized streaming upload function
    await streamingUpload({
      filePath: sanitizedFilePath,
      uploadId,
      endpoint,
      method: 'PUT', // Override default POST method
      headers: getRequestHeaders(),
      metadata,
      signal,
      onSuccess: () => {
        console.log(`✅ File ${fileName} loaded to ETL step ${sanitizedInputId} successfully`);
        
        // Log the operation
        logUpload({
          jobId: sanitizedJobId,
          inputId: sanitizedInputId,
          fileName,
          fileSize,
          status: 'success'
        });
      },
      onError: (err) => {
        console.error(`❌ Error loading file ${fileName} to step ${sanitizedInputId}: ${err.message}`);
        
        // Log the error
        logError({
          action: 'load-file-to-step-error',
          jobId: sanitizedJobId,
          inputId: sanitizedInputId,
          fileName,
          error: err.message
        });
      },
      onAbort: (reason) => {
        console.log(`Upload of ${fileName} to step ${sanitizedInputId} aborted: ${reason.message || 'Manual abort'}`);
        
        // Log the abort
        logError({
          action: 'load-file-to-step-aborted',
          jobId: sanitizedJobId,
          inputId: sanitizedInputId,
          fileName,
          reason: reason.message || 'Manual abort'
        });
      },
      onStalled: (stallInfo) => {
        console.warn(`Upload stalled: ${stallInfo.fileName} to step ${sanitizedInputId} has not progressed for ${stallInfo.stallTime} seconds`);
      }
    });
    
    return;
  } catch (err) {
    // Errors already logged in callback handlers
    throw err;
  }
}

/**
 * Submit an ETL job for processing
 * @param {string} jobId Job ID
 * @param {AbortSignal} signal Optional abort signal
 * @returns {Promise<Object>} Job status
 */
async function submitJob(jobId, signal) {
  // Sanitize the job ID to prevent injection attacks
  const sanitizedJobId = sanitizeId(jobId);
  
  if (sanitizedJobId !== jobId) {
    console.warn('Warning: Job ID contained potentially unsafe characters and was sanitized.');
  }
  
  console.log(`Submitting ETL job: ${sanitizedJobId}`);
  
  const options = {
    method: 'POST',
    headers: getRequestHeaders()
  };
  
  // Add abort signal if provided
  if (signal) {
    options.signal = signal;
  }
  
  // Use centralized response handler
  const result = await handleApiResponse(
    'submit-job',
    async () => {
      // Check if already aborted
      if (signal && signal.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      
      return await fetchWithRetry(
        `${config.api.baseUrl}/api/public/v1/etl/jobs/${sanitizedJobId}/submit`, 
        options,
        undefined, // Use default retries
        undefined, // Use default backoff
        signal // Pass signal to fetchWithRetry
      );
    },
    { jobId: sanitizedJobId }
  );
  
  console.log('✅ Job submitted successfully');
  
  return result;
}

/**
 * Extract steps with input IDs from template details
 * Used for interactive configuration creation
 * @param {Object} templateDetails Template details
 * @returns {Array} List of steps with input IDs
 */
function getTemplateSteps(templateDetails) {
  const steps = [];
  
  // Extract steps from template
  if (templateDetails && templateDetails.steps) {
    templateDetails.steps.forEach(step => {
      if (step.inputId) {
        steps.push({
          name: step.name || `Step ${step.order || 'unknown'}`,
          inputId: step.inputId,
          order: step.order
        });
      }
    });
  }
  
  return steps.sort((a, b) => a.order - b.order);
}

module.exports = {
  createEtlJob,
  loadFileToStep,
  submitJob,
  getTemplateSteps
};