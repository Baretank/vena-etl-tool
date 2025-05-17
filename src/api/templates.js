/**
 * Template-related API operations for Vena ETL Tool
 */
const fetch = require('node-fetch');
const FormData = require('form-data');
const { config } = require('../config');
const { getRequestHeaders } = require('../auth');
const { readCsvFile } = require('../utils/fileHandling');
const { handleApiResponse, retryOperation } = require('../utils/apiResponse');
const fs = require('fs');
const path = require('path')
const { createUploadController } = require('../utils/uploadController');

/**
 * Generic function for API calls with retry logic
 * @param {string} url API URL
 * @param {Object} options Fetch options
 * @param {number} retries Number of retries (default: config value)
 * @param {number} backoff Backoff time in ms (default: config value)
 * @returns {Promise<Object>} API response as JSON
 */
async function fetchWithRetry(url, options, retries, backoff, signal) {
  const retriesCount = retries ?? config.api.retryAttempts;
  const backoffTime = backoff ?? config.api.retryBackoff;
  
  // Use the centralized retry utility
  return await retryOperation(
    async () => {
      // Check if already aborted
      if (signal && signal.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      
      // Create a local options copy to modify
      const localOptions = { ...options };
      
      // Use the provided signal if any
      if (signal) {
        localOptions.signal = signal;
      }
      
      const response = await fetch(url, localOptions);
      
      if (!response.ok) {
        let errorDetails = '';
        try {
          // Try to get error details without assuming it's text
          errorDetails = await response.text().catch(() => 'No error details available');
        } catch (e) {
          errorDetails = 'No error details available';
        }
        throw new Error(`HTTP error! Status: ${response.status}, Details: ${errorDetails}`);
      }
      
      // Check if response is 204 No Content
      if (response.status === 204) {
        return { success: true };
      }
      
      return response.json();
    },
    retriesCount,
    backoffTime,
    (error) => {
      // Don't retry if aborted
      if (error.name === 'AbortError') {
        return false;
      }
      
      // Only retry on network errors or server errors (5xx)
      const isNetworkError = error.message.includes('ECONNRESET') || 
                          error.message.includes('ETIMEDOUT') ||
                          error.message.includes('ECONNREFUSED');
      const isServerError = error.message.includes('HTTP error! Status: 5');
      return isNetworkError || isServerError;
    }
  );
}

/**
 * List all available templates
 * @returns {Promise<Array>} List of templates
 */
async function listTemplates() {
  console.log('Fetching list of available templates...');
  
  const options = {
    method: 'GET',
    headers: getRequestHeaders()
  };
  
  // Use centralized response handler
  const templates = await handleApiResponse(
    'list-templates',
    async () => {
      return await fetchWithRetry(
        `${config.api.baseUrl}/api/public/v1/etl/templates`, 
        options
      );
    },
    { count: 'pending' } // Initial count will be updated in the success callback
  );
  
  console.log('✅ Templates retrieved successfully');
  console.log(`Found ${templates.length} templates`);
  
  return templates;
}

/**
 * Get template details
 * @param {string} templateId Template ID
 * @returns {Promise<Object>} Template details
 */
async function getTemplateDetails(templateId) {
  console.log(`Fetching details for template: ${templateId}`);
  
  const options = {
    method: 'GET',
    headers: getRequestHeaders()
  };
  
  // Use centralized response handler
  const template = await handleApiResponse(
    'get-template-details',
    async () => {
      return await fetchWithRetry(
        `${config.api.baseUrl}/api/public/v1/etl/templates/${templateId}`, 
        options
      );
    },
    { templateId }
  );
  
  console.log('✅ Template details retrieved successfully');
  
  return template;
}

/**
 * Upload file to Vena using streaming approach
 * @param {string} csvFilePath Path to CSV file
 * @param {string} templateId Template ID
 * @param {string} fileName Filename for display and upload
 * @param {string} fileSize File size for display
 * @returns {Promise<Object>} Upload response
 */
async function uploadFile(csvFilePath, templateId, fileName, fileSize) {
  console.log(`Preparing to upload ${fileName} (${fileSize}) to Vena template ID: ${templateId}`);
  
  // Create upload controller for abort handling and timeouts
  const controller = createUploadController(
    `${fileName}-to-${templateId}`, 
    config.api.uploadTimeout
  );
  
  // Create form data
  const form = new FormData();
  
  // Set up progress tracking
  const ProgressTracker = require('../utils/progressTracker');
  const { logUploadProgress } = require('../utils/logging');
  
  const tracker = new ProgressTracker(csvFilePath, config.api.progressInterval);
  await tracker.init();
  
  // Create a readable stream instead of loading entire file
  const fileStream = fs.createReadStream(csvFilePath);
  
  // Track stream state
  let streamClosed = false;
  
  // Create a function to clean up resources
  const cleanupResources = () => {
    if (!streamClosed) {
      try {
        fileStream.destroy(); // Force close the stream
        streamClosed = true;
      } catch (err) {
        console.error('Error closing file stream:', err.message);
      }
      
      // Always stop the progress tracker
      tracker.stop();
      
      // Clean up controller
      controller.cleanup();
    }
  };
  
  // Handle stream errors
  fileStream.on('error', (err) => {
    console.error(`Stream error: ${err.message}`);
    cleanupResources();
  });
  
  // Handle aborts
  controller.signal.addEventListener('abort', () => {
    console.log(`Upload aborted: ${controller.signal.reason?.message || 'Manual abort'}`);
    cleanupResources();
  });
  
  // Track upload progress by monitoring the stream's bytes read
  let bytesUploaded = 0;
  
  fileStream.on('data', (chunk) => {
    bytesUploaded += chunk.length;
    tracker.update(bytesUploaded);
    
    // Check if aborted
    if (controller.signal.aborted) {
      fileStream.destroy();
      streamClosed = true;
    }
  });
  
  fileStream.on('end', () => {
    streamClosed = true;
  });
  
  // Start progress tracking
  tracker.start((progress) => {
    logUploadProgress(progress);
  });
  
  form.append('file', fileStream, {
    filename: fileName,
    contentType: 'text/csv'
  });
  
  // Build fetch options
  const options = {
    method: 'POST',
    headers: getRequestHeaders(),
    body: form,
    signal: controller.signal
  };
  
  console.log('Uploading file to Vena...');
  console.log(`Upload timeout set to ${config.api.uploadTimeout / 1000} seconds`);
  
  // Add timestamp for tracking upload duration
  const startTime = new Date();
  
  try {
    // Use centralized response handler with isUpload flag for specialized logging
    const data = await handleApiResponse(
      'upload-file',
      async () => {
        return await fetchWithRetry(
          `${config.api.baseUrl}/api/public/v1/etl/templates/${templateId}/startWithFile`, 
          options,
          undefined, // Use default retries
          undefined, // Use default backoff
          controller.signal // Pass signal to fetchWithRetry
        );
      },
      {
        fileName,
        templateId,
        fileSize
      },
      true // This is an upload operation
    );
    
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('✅ Success! File uploaded successfully.');
    console.log(`Upload completed in ${duration} seconds.`);
    
    return data;
  } catch (err) {
    // Check if this was an abort
    if (err.name === 'AbortError') {
      console.error(`Upload aborted: ${err.message}`);
    } else {
      console.error(`❌ Upload failed after ${((new Date() - startTime) / 1000).toFixed(2)} seconds: ${err.message}`);
    }
    throw err;
  } finally {
    // Always clean up resources
    cleanupResources();
  }
}

module.exports = {
  listTemplates,
  getTemplateDetails,
  uploadFile,
  fetchWithRetry
};