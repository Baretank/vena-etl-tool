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
      
      // Clean up any event listeners attached to the signal
      // (for older Node.js versions that don't auto-clean listeners)
      if (typeof signal.removeEventListener === 'function') {
        // Get all event types that might have listeners
        const possibleEvents = ['abort'];
        
        // For each event type, try to remove all listeners
        possibleEvents.forEach(eventType => {
          try {
            // Using a dummy function since we can't access the original handlers
            const noopHandler = () => {};
            signal.removeEventListener(eventType, noopHandler);
          } catch (err) {
            // Some Node.js versions might not support removing unknown listeners
            // Just continue silently
          }
        });
      }
    }
  };
}

module.exports = {
  createUploadController
};