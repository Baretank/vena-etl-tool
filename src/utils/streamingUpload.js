/**
 * Streaming Upload Utility
 * Centralized logic for handling file uploads with streaming
 */
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');
const { config } = require('../config');
const { getRequestHeaders } = require('../auth');
const { logError, logUploadProgress } = require('./logging');
const { createUploadController } = require('./uploadController');
const { StreamState, STATES } = require('./streamState');
const { registerUpload, unregisterUpload } = require('./terminationHandler');
const MonitoredFormData = require('./monitoredFormData');
const MemoryMonitor = require('./memoryMonitor');
const ProgressTracker = require('./progressTracker');
const { classifyError } = require('./errorClassification');

/**
 * Format bytes to a human-readable string
 * @param {number} bytes Number of bytes
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  // eslint-disable-next-line security/detect-object-injection
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Create streaming upload with consistent state management and error handling
 * @param {Object} options Upload configuration options
 * @param {string} options.filePath Path to the file to upload
 * @param {string} options.uploadId Unique ID for this upload
 * @param {string} options.endpoint API endpoint to upload to
 * @param {string} options.method HTTP method to use (default: 'POST')
 * @param {Object} options.headers Additional headers for the request
 * @param {Object} options.metadata Optional metadata to include with the upload
 * @param {AbortSignal} options.signal Optional AbortSignal for aborting the upload
 * @param {Function} options.onProgress Optional progress callback
 * @param {Function} options.onSuccess Optional success callback
 * @param {Function} options.onError Optional error callback
 * @param {Function} options.onAbort Optional abort callback
 * @param {Function} options.onStalled Optional stalled upload callback
 * @returns {Promise<Object>} Upload result
 */
async function streamingUpload({
  filePath,
  uploadId,
  endpoint,
  method = 'POST',
  headers = {},
  metadata = null,
  signal = null,
  onProgress = null,
  onSuccess = null,
  onError = null,
  onAbort = null,
  onStalled = null
}) {
  // Create our own controller if signal not provided
  const controller = !signal ? createUploadController(uploadId, config.api.uploadTimeout) : null;
  
  // Use provided signal or controller's signal
  const abortSignal = signal || controller?.signal;
  
  // Extract file details
  const fileName = path.basename(filePath);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileSize = (fs.statSync(filePath).size / 1024).toFixed(2) + ' KB';
  
  // Create stream state manager for tracking upload state
  const streamStateManager = new StreamState(uploadId, (oldState, newState, error) => {
    // Log state transitions if needed
    if (newState === STATES.ERROR || newState === STATES.ABORTED) {
      logError({
        action: 'stream-state-transition',
        oldState,
        newState,
        uploadId,
        error: error?.message,
        fileName
      });
    }
  });
  
  // Register with termination handler for coordinated abort
  registerUpload(uploadId, controller || { abort: () => abortSignal.abort() });
  
  // Create progress tracker
  const tracker = new ProgressTracker(filePath, config.api.progressInterval);
  await tracker.init();
  
  // Start progress tracking
  if (onProgress) {
    tracker.start((progress) => {
      logUploadProgress(progress);
      onProgress(progress);
    }, onStalled);
  } else {
    tracker.start((progress) => {
      logUploadProgress(progress);
    }, onStalled);
  }
  
  // Initialize memory monitoring if enabled
  let memoryMonitor = null;
  if (config.api.memoryMonitoringEnabled !== false) {
    memoryMonitor = new MemoryMonitor(
      config.api.memoryWarningThreshold || 1073741824, // 1GB default
      config.api.memoryCriticalThreshold || 1610612736, // 1.5GB default
      config.api.memoryCheckInterval || 5000 // 5 seconds default
    );
    
    // Start monitoring with handlers
    memoryMonitor.start(
      // Warning handler
      (stats) => {
        console.warn(`Memory warning: ${stats.formatted.rss} total, ${stats.formatted.heapUsed} heap used`);
      },
      // Critical handler - we'll apply aggressive backpressure
      (stats) => {
        console.error(`Memory critical: ${stats.formatted.rss} total, ${stats.formatted.heapUsed} heap used`);
        
        // Try to aggressively manage memory by pausing the stream if it's active
        if (fileStream && streamStateManager.is(STATES.ACTIVE)) {
          console.log('Applying aggressive backpressure due to memory pressure');
          streamStateManager.pause();
          fileStream.pause();
          
          // Resume after a longer delay
          setTimeout(() => {
            if (fileStream && streamStateManager.is(STATES.PAUSED)) {
              console.log('Resuming stream after memory pressure pause');
              streamStateManager.activate();
              fileStream.resume();
            }
          }, 10000); // 10 second aggressive pause
        }
      }
    );
  }
  
  // Create form data with monitoring
  const form = new MonitoredFormData(tracker);
  
  // Add metadata if provided
  if (metadata) {
    form.append('metadata', JSON.stringify(metadata));
  }
  
  // Create a readable stream instead of loading entire file
  // Security note: Using non-literal file path, validated earlier in the validateCsvFile function
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileStream = fs.createReadStream(filePath, {
    highWaterMark: config.api.streamChunkSize || 256 * 1024 // 256KB chunks by default
  });
  
  // Create a function to clean up resources - state-machine aware
  const cleanupResources = () => {
    // Only clean up if not already in a terminal state
    if (!streamStateManager.isInTerminalState()) {
      try {
        fileStream.destroy(); // Force close the stream
        // Final state transition - complete only if not already in error/aborted
        if (streamStateManager.is(STATES.ACTIVE) || streamStateManager.is(STATES.PAUSED)) {
          streamStateManager.complete();
        }
      } catch (err) {
        console.error('Error closing file stream:', err.message);
        // Transition to error state if not already in terminal state
        if (!streamStateManager.isInTerminalState()) {
          streamStateManager.fail(err);
        }
      }
      
      // Always stop the progress tracker
      tracker.stop();
      
      // Stop memory monitoring if it was started
      if (memoryMonitor) {
        memoryMonitor.stop();
      }
      
      // Clean up controller
      if (controller) {
        controller.cleanup();
      }
    } else {
      console.log(`Stream already in terminal state ${streamStateManager.getState()}, skipping duplicate cleanup`);
    }
  };
  
  // Handle stream errors with enhanced classification
  fileStream.on('error', (err) => {
    // Use atomic state transition to prevent race conditions
    if (!streamStateManager.is(STATES.ERROR) && !streamStateManager.is(STATES.ABORTED)) {
      // Classify errors using central error classification
      const classifiedError = classifyError(err, { 
        fileName,
        uploadId,
        streamState: streamStateManager.getState()
      });
      
      console.error(`Stream error (${classifiedError.errorType}): ${classifiedError.message}`);
      
      // Transition to error state
      streamStateManager.fail(classifiedError);
      
      // Call error callback if provided
      if (onError) {
        onError(classifiedError);
      }
      
      cleanupResources();
    }
  });
  
  // Handle aborts
  abortSignal.addEventListener('abort', () => {
    // Transition to aborted state only if not already in terminal state
    if (!streamStateManager.isInTerminalState()) {
      const reason = abortSignal.reason || new Error('Manual abort');
      streamStateManager.abort(reason);
      console.log(`Upload aborted: ${reason.message || 'Manual abort'}`);
      
      // Call abort callback if provided
      if (onAbort) {
        onAbort(reason);
      }
      
      cleanupResources();
    }
  });
  
  // Update state to active when starting
  streamStateManager.activate();
  
  // Track upload progress by monitoring the stream's bytes read
  let bytesUploaded = 0;
  
  // For adaptive backpressure
  let uploadRateHistory = [];
  const adaptiveBackpressureEnabled = config.api.adaptiveBackpressure !== false; // Default true
  
  fileStream.on('data', (chunk) => {
    // Skip if in terminal state
    if (streamStateManager.isInTerminalState()) {
      return;
    }
    
    bytesUploaded += chunk.length;
    tracker.update(bytesUploaded);
    
    // Check if aborted
    if (abortSignal.aborted) {
      streamStateManager.abort(abortSignal.reason);
      fileStream.destroy();
      return;
    }
    
    // Handle backpressure if needed
    // This monitors if the upload process is significantly slower than reading
    const now = Date.now();
    const uploadTime = now - startTime;
    const uploadRate = bytesUploaded / (uploadTime / 1000); // bytes per second
    const memoryThreshold = config.api.memoryThreshold || 100 * 1024 * 1024; // 100MB default
    
    // Use adaptive backpressure if enabled
    if (adaptiveBackpressureEnabled) {
      // Track upload rate over time
      if (!uploadRateHistory) {
        uploadRateHistory = [];
      }
      
      // Add current rate to history (keep last 5 samples)
      uploadRateHistory.push(uploadRate);
      if (uploadRateHistory.length > 5) {
        uploadRateHistory.shift();
      }
      
      // Calculate average upload rate from history
      const avgUploadRate = uploadRateHistory.reduce((sum, rate) => sum + rate, 0) / uploadRateHistory.length;
      
      // Determine if we're significantly below our average rate
      const adaptiveThresholdFactor = config.api.adaptiveThresholdFactor || 0.7; // 70% default
      const rateThreshold = avgUploadRate * adaptiveThresholdFactor;
      
      // Apply adaptive backpressure if rate drops significantly and buffer is large
      if (bytesUploaded > memoryThreshold && uploadRate < rateThreshold) {
        console.log(`Applying adaptive backpressure: Current rate ${formatBytes(uploadRate)}/s is below threshold`);
        
        // Update state to paused
        streamStateManager.pause();
        fileStream.pause();
        
        // Adaptive backoff time based on how far below threshold we are
        const adaptiveBackoffFactorMin = config.api.adaptiveBackoffFactorMin || 0.5;
        const adaptiveBackoffFactorMax = config.api.adaptiveBackoffFactorMax || 2.0;
        const severityFactor = Math.max(
          adaptiveBackoffFactorMin, 
          Math.min(adaptiveBackoffFactorMax, rateThreshold / (uploadRate || 1))
        );
        const adaptiveBackoff = Math.round(config.api.streamBackoff * severityFactor);
        
        // Log the adaptive backpressure details
        console.log(`Adaptive backoff: ${adaptiveBackoff}ms (severity factor: ${severityFactor.toFixed(2)})`);
        
        setTimeout(() => {
          // Only resume if still in paused state
          if (streamStateManager.is(STATES.PAUSED)) {
            streamStateManager.activate();
            fileStream.resume();
          }
        }, adaptiveBackoff);
      }
    } else {
      // Standard backpressure handling (non-adaptive)
      // If we have a lot of data buffered and our upload rate is slow, pause the stream temporarily
      if (bytesUploaded > memoryThreshold && uploadRate < config.api.minUploadRate) {
        console.log(`Applying standard backpressure: Current rate ${formatBytes(uploadRate)}/s is below threshold`);
        
        // Update state to paused
        streamStateManager.pause();
        fileStream.pause();
        
        // Resume after a standard delay
        const backoffTime = config.api.streamBackoff || 2000; // 2 seconds default
        setTimeout(() => {
          // Only resume if still in paused state
          if (streamStateManager.is(STATES.PAUSED)) {
            streamStateManager.activate();
            fileStream.resume();
          }
        }, backoffTime);
      }
    }
  });
  
  fileStream.on('end', () => {
    // Only transition to completed if not already in error/aborted
    if (!streamStateManager.isInTerminalState()) {
      streamStateManager.complete();
    }
  });
  
  // Append file to form
  form.append('file', fileStream, {
    filename: fileName,
    contentType: 'text/csv'
  });
  
  // Build fetch options
  const options = {
    method: method || 'POST', // Allow override of method
    headers: {
      ...getRequestHeaders(),
      ...headers
    },
    body: form,
    signal: abortSignal
  };
  
  // Timestamp for tracking upload duration
  const startTime = Date.now();
  
  try {
    console.log(`Uploading ${fileName} (${fileSize}) to ${endpoint}`);
    console.log(`Upload timeout set to ${config.api.uploadTimeout / 1000} seconds`);
    
    // Execute the upload
    const response = await fetch(endpoint, options);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to get error details');
      const error = new Error(`HTTP error! Status: ${response.status}, Details: ${errorText}`);
      
      // Classify the error
      const classifiedError = classifyError(error, {
        status: response.status,
        endpoint,
        fileName
      });
      
      // Log the error
      logError({
        action: 'http-upload-error',
        status: response.status,
        endpoint,
        fileName,
        error: classifiedError
      });
      
      // Call error callback if provided
      if (onError) {
        onError(classifiedError);
      }
      
      throw classifiedError;
    }
    
    // Process successful response
    let result;
    if (response.status === 204) {
      // No content response
      result = { success: true };
    } else {
      // JSON response
      result = await response.json();
    }
    
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log(`✅ Success! File ${fileName} uploaded successfully.`);
    console.log(`Upload completed in ${duration} seconds.`);
    
    // Call success callback if provided
    if (onSuccess) {
      onSuccess(result);
    }
    
    return result;
  } catch (err) {
    // Check if this was an abort
    if (err.name === 'AbortError' || streamStateManager.is(STATES.ABORTED)) {
      console.log(`Upload ${uploadId} was aborted: ${err.message || 'Manual abort'}`);
      
      // Call abort callback if provided and not already called
      if (onAbort && !streamStateManager.is(STATES.ABORTED)) {
        onAbort(err);
      }
      
      // Rethrow as classified error
      throw classifyError(err, { 
        uploadId,
        fileName,
        endpoint
      });
    } else {
      console.error(`❌ Upload failed after ${((new Date() - startTime) / 1000).toFixed(2)} seconds: ${err.message}`);
      
      // Call error callback if provided and not already called
      if (onError && !streamStateManager.is(STATES.ERROR)) {
        onError(err);
      }
      
      throw err; // Already classified earlier
    }
  } finally {
    // Always clean up resources
    cleanupResources();
    
    // Unregister from termination handler
    unregisterUpload(uploadId);
  }
}

module.exports = {
  streamingUpload,
  formatBytes
};