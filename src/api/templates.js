/**
 * Template-related API operations for Vena ETL Tool
 */
const fetch = require('node-fetch');
// FormData is imported but overridden by MonitoredFormData - keep for future reference
// eslint-disable-next-line no-unused-vars
const FormData = require('form-data');
const { config } = require('../config');
const { getRequestHeaders } = require('../auth');
// readCsvFile is not used in this file but kept for potential future expansion
// eslint-disable-next-line no-unused-vars
const { readCsvFile } = require('../utils/fileHandling');
const { handleApiResponse, retryOperation } = require('../utils/apiResponse');
const { logError } = require('../utils/logging');
const fs = require('fs');
// eslint-disable-next-line no-unused-vars
const path = require('path');
const { createUploadController } = require('../utils/uploadController');
const MonitoredFormData = require('../utils/monitoredFormData');
const MemoryMonitor = require('../utils/memoryMonitor');
const { registerUpload, unregisterUpload } = require('../utils/terminationHandler');

/**
 * Format bytes to a human-readable string
 * @param {number} bytes Number of bytes
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  // eslint-disable-next-line security/detect-object-injection
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

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
 * @param {AbortSignal} signal Optional abort signal
 * @returns {Promise<Object>} Upload response
 */
async function uploadFile(csvFilePath, templateId, fileName, fileSize, signal = null) {
  console.log(`Preparing to upload ${fileName} (${fileSize}) to Vena template ID: ${templateId}`);
  
  // Import the centralized streaming upload utility
  const { streamingUpload } = require('../utils/streamingUpload');
  
  // Generate unique upload ID
  const uploadId = `${fileName}-to-${templateId}-${Date.now()}`;
  
  // Define API endpoint
  const endpoint = `${config.api.baseUrl}/api/public/v1/etl/templates/${templateId}/startWithFile`;
  
  try {
    // Use the centralized streaming upload utility
    return await streamingUpload({
      filePath: csvFilePath,
      uploadId,
      endpoint,
      headers: getRequestHeaders(),
      signal,
      onProgress: (progress) => {
        // Additional progress handling could be added here if needed
      },
      onStalled: (stallInfo) => {
        console.warn(`Upload stalled: ${stallInfo.fileName} has not progressed for ${stallInfo.stallTime} seconds`);
      }
    });
  } catch (err) {
    // Error already logged in streamingUpload
    throw err;
  }
}

module.exports = {
  listTemplates,
  getTemplateDetails,
  uploadFile,
  fetchWithRetry
};