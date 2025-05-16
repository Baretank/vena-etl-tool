/**
 * Template-related API operations for Vena ETL Tool
 */
const fetch = require('node-fetch');
const FormData = require('form-data');
const { config } = require('../config');
const { getRequestHeaders } = require('../auth');
const { readCsvFile } = require('../utils/fileHandling');
const { handleApiResponse, retryOperation } = require('../utils/apiResponse');

/**
 * Generic function for API calls with retry logic
 * @param {string} url API URL
 * @param {Object} options Fetch options
 * @param {number} retries Number of retries (default: config value)
 * @param {number} backoff Backoff time in ms (default: config value)
 * @returns {Promise<Object>} API response as JSON
 */
async function fetchWithRetry(url, options, retries, backoff) {
  const retriesCount = retries ?? config.api.retryAttempts;
  const backoffTime = backoff ?? config.api.retryBackoff;
  
  // Use the centralized retry utility
  return await retryOperation(
    async () => {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No error details available');
        throw new Error(`HTTP error! Status: ${response.status}, Details: ${errorText}`);
      }
      
      return response.json();
    },
    retriesCount,
    backoffTime,
    (error) => {
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
 * Upload file to Vena
 * @param {string} csvFilePath Path to CSV file
 * @param {string} templateId Template ID
 * @param {string} fileName Filename for display and upload
 * @param {string} fileSize File size for display
 * @returns {Promise<Object>} Upload response
 */
async function uploadFile(csvFilePath, templateId, fileName, fileSize) {
  console.log(`Preparing to upload ${fileName} (${fileSize}) to Vena template ID: ${templateId}`);
  
  const csvContent = readCsvFile(csvFilePath);
  
  // Create form data
  const form = new FormData();
  form.append('file', csvContent, {
    filename: fileName,
    contentType: 'text/csv'
  });
  
  const options = {
    method: 'POST',
    headers: getRequestHeaders(),
    body: form
  };
  
  console.log('Uploading file to Vena...');
  
  // Add timestamp for tracking upload duration
  const startTime = new Date();
  
  // Use centralized response handler with isUpload flag for specialized logging
  const data = await handleApiResponse(
    'upload-file',
    async () => {
      return await fetchWithRetry(
        `${config.api.baseUrl}/api/public/v1/etl/templates/${templateId}/startWithFile`, 
        options
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
}

module.exports = {
  listTemplates,
  getTemplateDetails,
  uploadFile,
  fetchWithRetry
};