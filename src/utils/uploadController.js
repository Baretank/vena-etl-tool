/**
 * Upload Controller Utility
 * Manages upload abort handling and timeouts with proper event listener tracking
 */
const { logError } = require('./logging');

/**
 * Create an upload controller with abort capability and proper listener management
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
  
  // Track listeners to properly remove them later
  const listeners = new Map();
  
  // Create a wrapper to track event listeners added to the signal
  const trackedSignal = new Proxy(signal, {
    get(target, prop, receiver) {
      // Override addEventListener to track listeners
      if (prop === 'addEventListener') {
        return function(type, listener, options) {
          // Store the listener for later removal
          if (!listeners.has(type)) {
            listeners.set(type, new Set());
          }
          // eslint-disable-next-line security/detect-object-injection
          listeners.get(type).add(listener);
          
          // Call the original method
          return target.addEventListener(type, listener, options);
        };
      }
      
      // Override removeEventListener to update tracking
      if (prop === 'removeEventListener') {
        return function(type, listener, options) {
          // Remove from tracking
          if (listeners.has(type)) {
            // eslint-disable-next-line security/detect-object-injection
            listeners.get(type).delete(listener);
          }
          
          // Call the original method
          return target.removeEventListener(type, listener, options);
        };
      }
      
      // For all other properties, return original behavior
      return Reflect.get(target, prop, receiver);
    }
  });
  
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
  
  // Return controller with enhanced cleanup function
  return {
    signal: trackedSignal,
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
      // Clear timeout if set
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      // Properly remove all tracked event listeners
      listeners.forEach((listenerSet, type) => {
        listenerSet.forEach(listener => {
          try {
            signal.removeEventListener(type, listener);
          } catch (err) {
            // Silently continue if removal fails
          }
        });
        
        // Clear the set
        listenerSet.clear();
      });
      
      // Clear the listeners map
      listeners.clear();
      
      // Log cleanup completion
      logError({
        action: 'upload-controller-cleanup',
        uploadName
      });
    },
    // Add a property to get the count of active listeners (for debugging)
    getListenerCount: () => {
      let count = 0;
      listeners.forEach(listenerSet => {
        count += listenerSet.size;
      });
      return count;
    }
  };
}

module.exports = {
  createUploadController
};