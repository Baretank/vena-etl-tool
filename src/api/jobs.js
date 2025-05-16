/**
 * Job-related API operations for Vena ETL Tool
 */
const { config } = require('../config');
const { getRequestHeaders } = require('../auth');
const { fetchWithRetry } = require('./templates');
const { logJobOperation } = require('../utils/logging');
const { handleApiResponse } = require('../utils/apiResponse');

/**
 * Check job status
 * @param {string} jobId Job ID
 * @returns {Promise<Object>} Job status and details
 */
async function checkJobStatus(jobId) {
  console.log(`Checking status for job: ${jobId}`);
  
  const options = {
    method: 'GET',
    headers: getRequestHeaders()
  };
  
  // Get job details using centralized response handling
  console.log('Fetching job details...');
  const jobDetails = await handleApiResponse(
    'get-job-details',
    async () => {
      return await fetchWithRetry(
        `${config.api.baseUrl}/api/public/v1/etl/jobs/${jobId}`, 
        options
      );
    },
    { jobId }
  );
  
  // Get job status using centralized response handling
  console.log('Fetching job status...');
  const jobStatus = await handleApiResponse(
    'get-job-status',
    async () => {
      return await fetchWithRetry(
        `${config.api.baseUrl}/api/public/v1/etl/jobs/${jobId}/status`, 
        options
      );
    },
    { jobId }
  );
  
  // Log the operation
  logJobOperation({
    jobId,
    action: 'status-check',
    details: jobDetails,
    status: jobStatus
  });
  
  return { details: jobDetails, status: jobStatus };
}

/**
 * Cancel a job
 * @param {string} jobId Job ID
 * @returns {Promise<Object>} Cancellation response
 */
async function cancelJob(jobId) {
  console.log(`Attempting to cancel job: ${jobId}`);
  
  const options = {
    method: 'POST',
    headers: getRequestHeaders()
  };
  
  // Use centralized response handling
  const result = await handleApiResponse(
    'cancel-job',
    async () => {
      return await fetchWithRetry(
        `${config.api.baseUrl}/api/public/v1/etl/jobs/${jobId}/cancel`, 
        options
      );
    },
    { jobId }
  );
  
  console.log('✅ Job cancellation request successful');
  
  // Log the operation
  logJobOperation({
    jobId,
    action: 'cancel',
    result
  });
  
  return result;
}

module.exports = {
  checkJobStatus,
  cancelJob
};