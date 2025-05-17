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
const { logUpload } = require('../utils/logging');
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
 * @returns {Promise<void>} 
 */
async function loadFileToStep(jobId, inputId, filePath) {
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
  
  // Create form data
  const form = new FormData();
  
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
  
  // Create a readable stream instead of loading the entire file
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileStream = fs.createReadStream(sanitizedFilePath);
  
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
    body: form
  };
  
  // Use centralized retry operation for file upload
  // This endpoint returns 204 No Content, so we need special handling
  await retryOperation(
    async () => {
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
      // Retry on network errors or server errors (5xx)
      const isNetworkError = error.message.includes('ECONNRESET') || 
                            error.message.includes('ETIMEDOUT') || 
                            error.message.includes('ECONNREFUSED');
      const isServerError = error.message.includes('HTTP error! Status: 5');
      return isNetworkError || isServerError;
    }
  );
  
  console.log('✅ File loaded to ETL step successfully');
  
  // Log the operation
  logUpload({
    jobId: sanitizedJobId,
    inputId: sanitizedInputId,
    fileName,
    fileSize,
    status: 'success'
  });
  
  return;
}

/**
 * Submit an ETL job for processing
 * @param {string} jobId Job ID
 * @returns {Promise<Object>} Job status
 */
async function submitJob(jobId) {
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
  
  // Use centralized response handler
  const result = await handleApiResponse(
    'submit-job',
    async () => {
      return await fetchWithRetry(
        `${config.api.baseUrl}/api/public/v1/etl/jobs/${sanitizedJobId}/submit`, 
        options
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