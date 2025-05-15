/**
 * Template-related API operations for Vena ETL Tool
 */
const fetch = require('node-fetch');
const FormData = require('form-data');
const { config } = require('../config');
const { getRequestHeaders } = require('../auth');
const { logApiOperation, logError, logUpload } = require('../utils/logging');
const { readCsvFile } = require('../utils/fileHandling');

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
  
  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details available');
      throw new Error(`HTTP error! Status: ${response.status}, Details: ${errorText}`);
    }
    
    return response.json();
  } catch (error) {
    if (retriesCount <= 0) {
      throw error;
    }
    
    console.log(`Request failed. Retrying in ${backoffTime}ms... (${retriesCount} retries left)`);
    await new Promise(resolve => setTimeout(resolve, backoffTime));
    return fetchWithRetry(url, options, retriesCount - 1, backoffTime * 2);
  }
}

/**
 * List all available templates
 * @returns {Promise<Array>} List of templates
 */
async function listTemplates() {
  try {
    console.log('Fetching list of available templates...');
    
    const options = {
      method: 'GET',
      headers: getRequestHeaders()
    };
    
    const templates = await fetchWithRetry(
      `${config.api.baseUrl}/api/public/v1/etl/templates`, 
      options
    );
    
    console.log('✅ Templates retrieved successfully');
    
    // Log the operation
    logApiOperation({
      action: 'list-templates',
      count: templates ? templates.length : 0
    });
    
    return templates;
  } catch (err) {
    console.error('❌ Error:', err.message);
    
    // Log error
    logError({
      action: 'list-templates',
      status: 'error',
      error: err.message
    });
    
    throw err;
  }
}

/**
 * Get template details
 * @param {string} templateId Template ID
 * @returns {Promise<Object>} Template details
 */
async function getTemplateDetails(templateId) {
  try {
    console.log(`Fetching details for template: ${templateId}`);
    
    const options = {
      method: 'GET',
      headers: getRequestHeaders()
    };
    
    const template = await fetchWithRetry(
      `${config.api.baseUrl}/api/public/v1/etl/templates/${templateId}`, 
      options
    );
    
    console.log('✅ Template details retrieved successfully');
    
    // Log the operation
    logApiOperation({
      action: 'get-template-details',
      templateId
    });
    
    return template;
  } catch (err) {
    console.error('❌ Error:', err.message);
    
    // Log error
    logError({
      action: 'get-template-details',
      templateId,
      status: 'error',
      error: err.message
    });
    
    throw err;
  }
}

/**
 * Upload file to Vena
 * @param {string} csvFilePath Path to CSV file
 * @param {string} templateId Template ID
 * @returns {Promise<Object>} Upload response
 */
async function uploadFile(csvFilePath, templateId, fileName, fileSize) {
  try {
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
    
    const data = await fetchWithRetry(
      `${config.api.baseUrl}/api/public/v1/etl/templates/${templateId}/startWithFile`, 
      options
    );
    
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('✅ Success! File uploaded successfully.');
    console.log(`Upload completed in ${duration} seconds.`);
    
    // Log successful upload
    logUpload({
      fileName,
      templateId,
      fileSize,
      duration: `${duration}s`,
      status: 'success',
      response: data
    });
    
    return data;
  } catch (err) {
    console.error('❌ Error:', err.message);
    
    // Log error
    logError({
      fileName,
      templateId,
      status: 'error',
      error: err.message
    });
    
    throw err;
  }
}

module.exports = {
  listTemplates,
  getTemplateDetails,
  uploadFile,
  fetchWithRetry
};