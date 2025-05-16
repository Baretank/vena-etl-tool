/**
 * API Response Handler utility for Vena ETL Tool
 * Centralizes response handling logic for all API calls
 */
const { logApiOperation, logError, logUpload } = require('./logging');

/**
 * Standard response handler for API calls
 * @param {string} action Action name for logging
 * @param {Function} apiCall Async function that makes the API call
 * @param {Object} params Parameters to include in logging
 * @param {boolean} isUpload Whether this is a file upload (for specialized logging)
 * @returns {Promise<any>} API response
 */
async function handleApiResponse(action, apiCall, params = {}, isUpload = false) {
  const startTime = new Date();
  
  try {
    // Execute the API call
    const result = await apiCall();
    
    // Calculate duration for tracking and logging
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    // Prepare logging data
    const logData = {
      action,
      duration: `${duration}s`,
      status: 'success',
      ...params
    };
    
    // Log based on action type
    if (isUpload) {
      logUpload({
        ...logData,
        response: result
      });
    } else {
      logApiOperation(logData);
    }
    
    // Return the result
    return result;
  } catch (err) {
    // Log error
    logError({
      action,
      status: 'error',
      error: err.message,
      ...params
    });
    
    // Rethrow the error for the caller to handle
    throw err;
  }
}

/**
 * Retry mechanism for failed API calls
 * @param {Function} operation Async function to retry
 * @param {number} retries Maximum number of retries
 * @param {number} backoff Initial backoff time in ms
 * @param {Function} shouldRetry Function that determines if retry should be attempted based on error
 * @returns {Promise<any>} Operation result
 */
async function retryOperation(operation, retries = 3, backoff = 300, shouldRetry = () => true) {
  try {
    return await operation();
  } catch (error) {
    // Check if we should retry and have retries left
    if (retries <= 0 || !shouldRetry(error)) {
      throw error;
    }
    
    // Calculate backoff with exponential increase
    console.log(`Operation failed. Retrying in ${backoff}ms... (${retries} retries left)`);
    await new Promise(resolve => setTimeout(resolve, backoff));
    
    // Retry with decremented count and increased backoff
    return retryOperation(operation, retries - 1, backoff * 2, shouldRetry);
  }
}

/**
 * Wrapper for main command execution with centralized error handling
 * @param {string} commandName Name of the command being executed
 * @param {Function} commandFunction Async function to execute
 * @returns {Promise<boolean>} Success status
 */
async function executeWithErrorHandling(commandName, commandFunction) {
  try {
    // Execute the command function
    const result = await commandFunction();
    return result === false ? false : true;
  } catch (err) {
    console.error(`❌ Error executing ${commandName}:`, err.message);
    
    // Log the error
    logError({
      action: commandName,
      error: err.message
    });
    
    return false;
  }
}

module.exports = {
  handleApiResponse,
  retryOperation,
  executeWithErrorHandling
};