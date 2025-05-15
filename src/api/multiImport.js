/**
 * Multi-Import API operations for Vena ETL Tool
 * Handles ETL job creation, file loading to specific steps, and job submission
 */
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { config } = require('../config');
const { getRequestHeaders } = require('../auth');
const { fetchWithRetry } = require('./templates');
const { logApiOperation, logError, logUpload } = require('../utils/logging');

/**
 * Create a new ETL job from a template without starting it
 * @param {string} templateId Template ID
 * @returns {Promise<Object>} Created job
 */
async function createEtlJob(templateId) {
  try {
    console.log(`Creating ETL job from template ID: ${templateId}`);
    
    const options = {
      method: 'POST',
      headers: getRequestHeaders()
    };
    
    const job = await fetchWithRetry(
      `${config.api.baseUrl}/api/public/v1/etl/templates/${templateId}/jobs`, 
      options
    );
    
    console.log('✅ ETL job created successfully');
    
    // Log the operation
    logApiOperation({
      action: 'create-etl-job',
      templateId,
      jobId: job.id
    });
    
    return job;
  } catch (err) {
    console.error('❌ Error:', err.message);
    
    // Log error
    logError({
      action: 'create-etl-job',
      templateId,
      status: 'error',
      error: err.message
    });
    
    throw err;
  }
}

/**
 * Load file to a specific ETL step
 * @param {string} jobId Job ID
 * @param {string} inputId Input ID (step ID)
 * @param {string} filePath File path
 * @returns {Promise<void>} 
 */
async function loadFileToStep(jobId, inputId, filePath) {
  try {
    console.log(`Loading file to ETL step: Job ID ${jobId}, Input ID ${inputId}`);
    
    const fileName = path.basename(filePath);
    const fileSize = (fs.statSync(filePath).size / 1024).toFixed(2) + ' KB';
    const fileContent = fs.readFileSync(filePath);
    
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
    form.append('file', fileContent, {
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
    
    // Submit the request (this endpoint returns 204 No Content)
    await fetch(
      `${config.api.baseUrl}/api/public/v1/etl/jobs/${jobId}/inputs/${inputId}/file`, 
      options
    ).then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response;
    });
    
    console.log('✅ File loaded to ETL step successfully');
    
    // Log the operation
    logUpload({
      jobId,
      inputId,
      fileName,
      fileSize,
      status: 'success'
    });
    
    return;
  } catch (err) {
    console.error('❌ Error:', err.message);
    
    // Log error
    logError({
      jobId,
      inputId,
      status: 'error',
      error: err.message
    });
    
    throw err;
  }
}

/**
 * Submit an ETL job for processing
 * @param {string} jobId Job ID
 * @returns {Promise<Object>} Job status
 */
async function submitJob(jobId) {
  try {
    console.log(`Submitting ETL job: ${jobId}`);
    
    const options = {
      method: 'POST',
      headers: getRequestHeaders()
    };
    
    const result = await fetchWithRetry(
      `${config.api.baseUrl}/api/public/v1/etl/jobs/${jobId}/submit`, 
      options
    );
    
    console.log('✅ Job submitted successfully');
    
    // Log the operation
    logApiOperation({
      jobId,
      action: 'submit-job',
      result
    });
    
    return result;
  } catch (err) {
    console.error('❌ Error:', err.message);
    
    // Log error
    logError({
      jobId,
      action: 'submit-job',
      status: 'error',
      error: err.message
    });
    
    throw err;
  }
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