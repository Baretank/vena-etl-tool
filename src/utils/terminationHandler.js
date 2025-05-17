/**
 * Termination Handler for graceful shutdown
 * Handles process termination signals to ensure clean shutdown
 */
const { logError } = require('./logging');

// Track all active uploads
const activeUploads = new Map();

// Track if shutdown is in progress
let isShuttingDown = false;

/**
 * Initialize termination handlers
 */
function initTerminationHandlers() {
  process.on('SIGINT', handleTermination);
  process.on('SIGTERM', handleTermination);
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    logError({
      action: 'uncaught-exception',
      message: err.message,
      stack: err.stack
    });
    
    console.error('Uncaught exception:', err.message);
    handleTermination('Uncaught exception');
  });
}

/**
 * Handle process termination signal
 * @param {string} reason Reason for termination
 */
function handleTermination(reason = 'Process termination requested') {
  // Prevent multiple termination attempts
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\n${reason}. Cleaning up uploads...`);
  
  // Abort all active uploads
  const uploadCount = activeUploads.size;
  if (uploadCount > 0) {
    console.log(`Aborting ${uploadCount} active upload(s)...`);
    
    for (const [uploadId, controller] of activeUploads.entries()) {
      console.log(`- Aborting upload: ${uploadId}`);
      controller.abort(new Error(reason));
    }
    
    // Clear the active uploads map
    activeUploads.clear();
  } else {
    console.log('No active uploads to clean up.');
  }
  
  // Allow time for cleanup before exit
  setTimeout(() => {
    console.log('Cleanup complete, exiting now.');
    // Set exitCode instead of calling process.exit directly
    process.exitCode = 0;
  }, 1000);
}

/**
 * Register an active upload
 * @param {string} uploadId Unique identifier for the upload
 * @param {Object} controller AbortController for the upload
 */
function registerUpload(uploadId, controller) {
  activeUploads.set(uploadId, controller);
}

/**
 * Unregister an upload when completed or aborted
 * @param {string} uploadId Unique identifier for the upload
 */
function unregisterUpload(uploadId) {
  activeUploads.delete(uploadId);
}

/**
 * Get the count of active uploads
 * @returns {number} Number of active uploads
 */
function getActiveUploadCount() {
  return activeUploads.size;
}

module.exports = {
  initTerminationHandlers,
  registerUpload,
  unregisterUpload,
  getActiveUploadCount
};