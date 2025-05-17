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
  
  // Create upload controller if no signal was provided
  const { createUploadController } = require('../utils/uploadController');
  const controller = !signal ? createUploadController(
    `${fileName}-to-step-${sanitizedInputId}`, 
    config.api.uploadTimeout
  ) : null;
  
  // Use provided signal or controller's signal
  const abortSignal = signal || controller?.signal;
  
  // Create form data
  const form = new FormData();
  
  // Create a readable stream instead of loading the entire file
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileStream = fs.createReadStream(sanitizedFilePath, {
    highWaterMark: config.api.streamChunkSize || 256 * 1024 // 256KB chunks by default
  });  
  // Track stream state
  let streamClosed = false;
  
  // Create a function to clean up resources
  const cleanupResources = () => {
    if (!streamClosed) {
      try {
        fileStream.destroy(); // Force close the stream
        streamClosed = true;
        console.log(`Stream for ${fileName} closed.`);
      } catch (err) {
        console.error(`Error closing file stream for ${fileName}:`, err.message);
      }
      
      // Clean up controller if we created it
      if (controller) {
        controller.cleanup();
      }
    }
  };
  
  // Handle stream errors
  fileStream.on('error', (err) => {
    console.error(`Stream error for ${fileName}: ${err.message}`);
    cleanupResources();
  });
  
  // Handle aborts if we have a signal
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => {
      console.log(`Upload of ${fileName} to step ${sanitizedInputId} aborted: ${abortSignal.reason?.message || 'Manual abort'}`);
      cleanupResources();
    });
    
    // Check if already aborted
    if (abortSignal.aborted) {
      console.log(`Upload of ${fileName} already aborted before starting.`);
      throw new DOMException('The operation was aborted', 'AbortError');
    }
  }
  
  fileStream.on('end', () => {
    streamClosed = true;
    console.log(`Stream for ${fileName} ended normally.`);
  });
  
  // Add metadata
  const metadata = {
    input: {
      partName: 'file',
      fileFormat: 'CSV',
      fileEncoding: 'UTF-8',
      fileName: fileName
    }
  };
  
  form.append('metadata', JSON.stringify(metadata));
  form.append('file', fileStream, {
    filename: fileName,
    contentType: 'text/csv'
  });
  
  // Create headers object
  let headers = getRequestHeaders();
  
  // Build options for request
  const options = {
    method: 'PUT',
    headers: {
      ...headers,
      ...form.getHeaders() // Add form-specific headers
    },
    body: form,
    // Add abort signal if available
    ...(abortSignal && { signal: abortSignal })
  };
  
  try {
    // Use centralized retry operation for file upload
    // This endpoint returns 204 No Content, so we need special handling
    await retryOperation(
      async () => {
        // Check if already aborted
        if (abortSignal && abortSignal.aborted) {
          throw new DOMException('The operation was aborted', 'AbortError');
        }
        
        const response = await fetch(
          `${config.api.baseUrl}/api/public/v1/etl/jobs/${sanitizedJobId}/inputs/${sanitizedInputId}/file`, 
          options
        );
        
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        return response;
      },
      3, // Number of retries
      1000, // Initial backoff time
      (error) => {
        // Don't retry if aborted
        if (error.name === 'AbortError') {
          return false;
        }
        
        // Retry on network errors or server errors (5xx)
        const isNetworkError = error.message.includes('ECONNRESET') || 
                              error.message.includes('ETIMEDOUT') || 
                              error.message.includes('ECONNREFUSED');
        const isServerError = error.message.includes('HTTP error! Status: 5');
        return isNetworkError || isServerError;
      }
    );
    
    console.log(`✅ File ${fileName} loaded to ETL step ${sanitizedInputId} successfully`);
    
    // Log the operation
    logUpload({
      jobId: sanitizedJobId,
      inputId: sanitizedInputId,
      fileName,
      fileSize,
      status: 'success'
    });
    
    return;
  } catch (err) {
    // Check if this was an abort
    if (err.name === 'AbortError') {
      console.error(`Upload of ${fileName} to step ${sanitizedInputId} was aborted: ${err.message}`);
      
      // Log the abort
      logError({
        action: 'load-file-to-step-aborted',
        jobId: sanitizedJobId,
        inputId: sanitizedInputId,
        fileName,
        reason: err.message || 'Manual abort'
      });
    } else {
      console.error(`❌ Error loading file ${fileName} to step ${sanitizedInputId}: ${err.message}`);
      
      // Log the error
      logError({
        action: 'load-file-to-step-error',
        jobId: sanitizedJobId,
        inputId: sanitizedInputId,
        fileName,
        error: err.message
      });
    }
    
    throw err;
  } finally {
    // Always clean up resources
    cleanupResources();
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