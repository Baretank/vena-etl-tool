/**
 * Job-related API operations for Vena ETL Tool
 */
const { config } = require('../config');
const { getRequestHeaders } = require('../auth');
const { fetchWithRetry } = require('./templates');
const { logJobOperation, logError } = require('../utils/logging');

/**
 * Check job status
 * @param {string} jobId Job ID
 * @returns {Promise<Object>} Job status and details
 */
async function checkJobStatus(jobId) {
  try {
    console.log(`Checking status for job: ${jobId}`);
    
    const options = {
      method: 'GET',
      headers: getRequestHeaders()
    };
    
    // Get job details
    console.log('Fetching job details...');
    const jobDetails = await fetchWithRetry(
      `${config.api.baseUrl}/api/public/v1/etl/jobs/${jobId}`, 
      options
    );
    
    // Get job status
    console.log('Fetching job status...');
    const jobStatus = await fetchWithRetry(
      `${config.api.baseUrl}/api/public/v1/etl/jobs/${jobId}/status`, 
      options
    );
    
    // Log the operation
    logJobOperation({
      jobId,
      action: 'status-check',
      details: jobDetails,
      status: jobStatus
    });
    
    return { details: jobDetails, status: jobStatus };
  } catch (err) {
    console.error('❌ Error:', err.message);
    
    // Log error
    logError({
      jobId,
      action: 'status-check',
      status: 'error',
      error: err.message
    });
    
    throw err;
  }
}

/**
 * Cancel a job
 * @param {string} jobId Job ID
 * @returns {Promise<Object>} Cancellation response
 */
async function cancelJob(jobId) {
  try {
    console.log(`Attempting to cancel job: ${jobId}`);
    
    const options = {
      method: 'POST',
      headers: getRequestHeaders()
    };
    
    const result = await fetchWithRetry(
      `${config.api.baseUrl}/api/public/v1/etl/jobs/${jobId}/cancel`, 
      options
    );
    
    console.log('✅ Job cancellation request successful');
    
    // Log the operation
    logJobOperation({
      jobId,
      action: 'cancel',
      result
    });
    
    return result;
  } catch (err) {
    console.error('❌ Error:', err.message);
    
    // Log error
    logError({
      jobId,
      action: 'cancel',
      status: 'error',
      error: err.message
    });
    
    throw err;
  }
}

module.exports = {
  checkJobStatus,
  cancelJob
};