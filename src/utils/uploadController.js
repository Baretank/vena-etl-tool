/**
 * Upload Controller Utility
 * Manages upload abort handling and timeouts
 */
const { logError } = require('./logging');

/**
 * Create an upload controller with abort capability
 * @param {string} uploadName Name/identifier for the upload
 * @param {number} timeoutMs Timeout in milliseconds
 * @returns {Object} Controller with signal and abort functions
 */
function createUploadController(uploadName, timeoutMs) {
  // Create AbortController
  const controller = new AbortController();
  const { signal } = controller;
  
  // Create timeout ID
  let timeoutId = null;
  
  // Set timeout if specified
  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      logError({
        action: 'upload-timeout',
        uploadName,
        timeoutMs,
        message: `Upload timed out after ${timeoutMs/1000} seconds`
      });
      controller.abort(new Error(`Upload timed out after ${timeoutMs/1000} seconds`));
    }, timeoutMs);
  }
  
  // Return controller with cleanup function
  return {
    signal,
    abort: (reason) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      if (!signal.aborted) {
        controller.abort(reason);
        logError({
          action: 'upload-aborted',
          uploadName,
          reason: reason?.message || 'Manual abort'
        });
      }
    },
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }
  };
}

module.exports = {
  createUploadController
};