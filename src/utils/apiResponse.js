/**
 * API Response Handler utility for Vena ETL Tool
 * Centralizes response handling logic for all API calls
 */
const { logApiOperation, logError, logUpload } = require('./logging');
const { classifyError, logClassifiedError } = require('./errorClassification');

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
    // Classify and log error with enhanced context
    const classifiedError = logClassifiedError(err, action, params);
    
    // Rethrow the enhanced error for the caller to handle
    throw classifiedError;
  }
}

/**
 * Retry mechanism for failed API calls
 * @param {Function} operation Async function to retry
 * @param {number} retries Maximum number of retries
 * @param {number} backoff Initial backoff time in ms
 * @param {Function} shouldRetry Function that determines if retry should be attempted based on error
 * @param {AbortSignal} signal Optional abort signal
 * @returns {Promise<any>} Operation result
 */
async function retryOperation(operation, retries = 3, backoff = 300, shouldRetry = null, signal) {
  // Import error classification
  const { isRecoverableError, classifyError } = require('./errorClassification');
  
  // If no shouldRetry function is provided, use the classifiedError.recoverable property
  const retryPredicate = shouldRetry || isRecoverableError;
  
  // Keep track of attempts
  let currentAttempt = 1;
  let currentBackoff = backoff;
  
  // Iterate instead of using recursion to avoid potential stack overflow
  while (true) {
    try {
      // Check if already aborted before attempting operation
      if (signal && signal.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      
      // Attempt the operation
      return await operation();
    } catch (error) {
      // Classify the error if not already classified
      const classifiedError = error.category ? error : classifyError(error);
      
      // Always fail fast on abort
      if (classifiedError.name === 'AbortError' || 
          classifiedError.category === 'abort') {
        throw classifiedError;
      }
      
      // Check if we should retry and have retries left
      const attemptsRemaining = retries - currentAttempt + 1;
      if (attemptsRemaining <= 0 || !retryPredicate(classifiedError)) {
        throw classifiedError;
      }
      
      // Log retry attempt with error classification
      console.log(`Operation failed (${classifiedError.errorType}). Retrying in ${currentBackoff}ms... (${attemptsRemaining} retries left)`);
      
      // Wait for backoff period or abort
      try {
        await new Promise((resolve, reject) => {
          // Set timeout for backoff
          const timeoutId = setTimeout(resolve, currentBackoff);
          
          // Add abort handler if signal provided
          if (signal) {
            const abortHandler = () => {
              clearTimeout(timeoutId);
              const abortError = new DOMException('Retry aborted', 'AbortError');
              reject(classifyError(abortError, { operation: 'retry' }));
            };
            
            // If already aborted, call handler immediately
            if (signal.aborted) {
              abortHandler();
            } else {
              // Otherwise listen for abort event
              signal.addEventListener('abort', abortHandler, { once: true });
              
              // Clean up event listener when timeout resolves
              setTimeout(() => {
                signal.removeEventListener('abort', abortHandler);
              }, currentBackoff);
            }
          }
        });
      } catch (abortError) {
        // If wait was aborted, propagate the error
        throw abortError;
      }
      
      // Update for next attempt
      currentAttempt++;
      currentBackoff *= 2; // Exponential backoff
    }
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
    // Classify and log the error
    const classifiedError = logClassifiedError(err, `execute-${commandName}`, {
      command: commandName
    });
    
    // Print user-friendly error message based on classification
    console.error(`❌ Error executing ${commandName}: ${classifiedError.message}`);
    
    // Provide additional guidance based on error type
    if (classifiedError.category === 'auth') {
      console.error('Authentication error. Please check your credentials or token.');
    } else if (classifiedError.category === 'network') {
      console.error('Network error. Please check your internet connection and try again.');
    } else if (classifiedError.category === 'file_system') {
      console.error('File system error. Please check file paths and permissions.');
    } else if (classifiedError.errorType === 'file_not_found') {
      console.error('File not found. Please verify the file path is correct.');
    }
    
    return false;
  }
}

module.exports = {
  handleApiResponse,
  retryOperation,
  executeWithErrorHandling
};