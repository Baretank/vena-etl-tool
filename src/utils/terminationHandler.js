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
 * Safe to call multiple times - will only register handlers once
 */
function initTerminationHandlers() {
  // Prevent duplicate initialization
  if (global._terminationHandlersRegistered) {
    console.log('Termination handlers already registered, skipping duplicate initialization');
    return;
  }
  
  // Mark as registered to prevent duplicate handlers
  global._terminationHandlersRegistered = true;
  
  // Handle termination signals
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
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logError({
      action: 'unhandled-rejection',
      message: reason?.message || 'Unknown reason',
      stack: reason?.stack || 'No stack trace available'
    });
    
    console.error('Unhandled promise rejection:', reason);
    // Not calling handleTermination here to allow process to continue
    // but logging for monitoring purposes
  });
  
  console.log('Termination handlers registered successfully');
}

/**
 * Handle process termination signal
 * @param {string} reason Reason for termination
 */
function handleTermination(reason = 'Process termination requested') {
  // Prevent multiple termination attempts
  if (isShuttingDown) {
    console.log('Shutdown already in progress, skipping duplicate termination handling');
    return;
  }
  
  isShuttingDown = true;
  
  // Set exit code based on reason
  const isError = reason.includes('exception') || reason.includes('error');
  process.exitCode = isError ? 1 : 0;
  
  console.log(`\n${reason}. Cleaning up resources...`);
  
  // Log the termination event
  logError({
    action: 'process-termination',
    reason,
    activeUploads: activeUploads.size,
    timestamp: new Date().toISOString()
  });
  
  // Abort all active uploads
  const uploadCount = activeUploads.size;
  if (uploadCount > 0) {
    console.log(`Aborting ${uploadCount} active upload(s)...`);
    
    try {
      // Create array from uploads to avoid iterator invalidation
      const uploads = Array.from(activeUploads.entries());
      
      for (const [uploadId, controller] of uploads) {
        console.log(`- Aborting upload: ${uploadId}`);
        try {
          controller.abort(new Error(reason));
        } catch (err) {
          console.error(`  Error aborting upload ${uploadId}:`, err.message);
        }
      }
      
      // Clear the active uploads map
      activeUploads.clear();
    } catch (err) {
      console.error('Error during upload cleanup:', err.message);
    }
  } else {
    console.log('No active uploads to clean up.');
  }
  
  // Perform additional cleanup tasks
  // For example, close any database connections, flush logs, etc.
  // ...
  
  // Allow time for async operations to complete before exit
  // but ensure we do exit even if something hangs
  const forceExitTimeout = setTimeout(() => {
    console.log('Forcing exit after timeout - some cleanup operations might not have completed');
    // This is one case where process.exit is appropriate as it's a last resort
    process.exit(process.exitCode);
  }, 5000); // 5 seconds max for cleanup
  
  // Normal exit path - cleaner than the force exit
  setTimeout(() => {
    clearTimeout(forceExitTimeout);
    console.log('Cleanup complete, exiting gracefully.');
    // No need to call process.exit() - Node will exit naturally
  }, 1000);
}

/**
 * Register an active upload
 * @param {string} uploadId Unique identifier for the upload
 * @param {Object} controller AbortController for the upload
 */
function registerUpload(uploadId, controller) {
  // Don't register if shutdown is in progress
  if (isShuttingDown) {
    console.log(`Not registering upload ${uploadId} as shutdown is in progress`);
    // Abort right away if shutdown is in progress
    if (controller && typeof controller.abort === 'function') {
      try {
        controller.abort(new Error('Upload rejected - shutdown in progress'));
      } catch (err) {
        console.error(`Error aborting controller during shutdown: ${err.message}`);
      }
    }
    return false;
  }
  
  // Ensure unique uploadId by adding timestamp if needed
  if (activeUploads.has(uploadId)) {
    // Add timestamp to make unique
    uploadId = `${uploadId}-${Date.now()}`;
  }
  
  // Store controller with registration timestamp and details
  activeUploads.set(uploadId, controller);
  
  console.log(`Upload registered: ${uploadId} (Total active: ${activeUploads.size})`);
  return true;
}

/**
 * Unregister an upload when completed or aborted
 * @param {string} uploadId Unique identifier for the upload
 * @returns {boolean} Whether the upload was found and removed
 */
function unregisterUpload(uploadId) {
  const wasPresent = activeUploads.has(uploadId);
  
  if (wasPresent) {
    activeUploads.delete(uploadId);
    console.log(`Upload unregistered: ${uploadId} (Total active: ${activeUploads.size})`);
  } else {
    console.log(`Upload not found for unregistration: ${uploadId}`);
  }
  
  return wasPresent;
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