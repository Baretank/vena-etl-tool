/**
 * Template-related API operations for Vena ETL Tool
 */
const fetch = require('node-fetch');
// FormData is imported but overridden by MonitoredFormData - keep for future reference
// eslint-disable-next-line no-unused-vars
const FormData = require('form-data');
const { config } = require('../config');
const { getRequestHeaders } = require('../auth');
// readCsvFile is not used in this file but kept for potential future expansion
// eslint-disable-next-line no-unused-vars
const { readCsvFile } = require('../utils/fileHandling');
const { handleApiResponse, retryOperation } = require('../utils/apiResponse');
const { logError } = require('../utils/logging');
const fs = require('fs');
// eslint-disable-next-line no-unused-vars
const path = require('path');
const { createUploadController } = require('../utils/uploadController');
const MonitoredFormData = require('../utils/monitoredFormData');
const MemoryMonitor = require('../utils/memoryMonitor');
const { registerUpload, unregisterUpload } = require('../utils/terminationHandler');

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
 * Generic function for API calls with retry logic
 * @param {string} url API URL
 * @param {Object} options Fetch options
 * @param {number} retries Number of retries (default: config value)
 * @param {number} backoff Backoff time in ms (default: config value)
 * @returns {Promise<Object>} API response as JSON
 */
async function fetchWithRetry(url, options, retries, backoff, signal) {
  const retriesCount = retries ?? config.api.retryAttempts;
  const backoffTime = backoff ?? config.api.retryBackoff;
  
  // Use the centralized retry utility
  return await retryOperation(
    async () => {
      // Check if already aborted
      if (signal && signal.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      
      // Create a local options copy to modify
      const localOptions = { ...options };
      
      // Use the provided signal if any
      if (signal) {
        localOptions.signal = signal;
      }
      
      const response = await fetch(url, localOptions);
      
      if (!response.ok) {
        let errorDetails = '';
        try {
          // Try to get error details without assuming it's text
          errorDetails = await response.text().catch(() => 'No error details available');
        } catch (e) {
          errorDetails = 'No error details available';
        }
        throw new Error(`HTTP error! Status: ${response.status}, Details: ${errorDetails}`);
      }
      
      // Check if response is 204 No Content
      if (response.status === 204) {
        return { success: true };
      }
      
      return response.json();
    },
    retriesCount,
    backoffTime,
    (error) => {
      // Don't retry if aborted
      if (error.name === 'AbortError') {
        return false;
      }
      
      // Only retry on network errors or server errors (5xx)
      const isNetworkError = error.message.includes('ECONNRESET') || 
                          error.message.includes('ETIMEDOUT') ||
                          error.message.includes('ECONNREFUSED');
      const isServerError = error.message.includes('HTTP error! Status: 5');
      return isNetworkError || isServerError;
    }
  );
}

/**
 * List all available templates
 * @returns {Promise<Array>} List of templates
 */
async function listTemplates() {
  console.log('Fetching list of available templates...');
  
  const options = {
    method: 'GET',
    headers: getRequestHeaders()
  };
  
  // Use centralized response handler
  const templates = await handleApiResponse(
    'list-templates',
    async () => {
      return await fetchWithRetry(
        `${config.api.baseUrl}/api/public/v1/etl/templates`, 
        options
      );
    },
    { count: 'pending' } // Initial count will be updated in the success callback
  );
  
  console.log('✅ Templates retrieved successfully');
  console.log(`Found ${templates.length} templates`);
  
  return templates;
}

/**
 * Get template details
 * @param {string} templateId Template ID
 * @returns {Promise<Object>} Template details
 */
async function getTemplateDetails(templateId) {
  console.log(`Fetching details for template: ${templateId}`);
  
  const options = {
    method: 'GET',
    headers: getRequestHeaders()
  };
  
  // Use centralized response handler
  const template = await handleApiResponse(
    'get-template-details',
    async () => {
      return await fetchWithRetry(
        `${config.api.baseUrl}/api/public/v1/etl/templates/${templateId}`, 
        options
      );
    },
    { templateId }
  );
  
  console.log('✅ Template details retrieved successfully');
  
  return template;
}

/**
 * Upload file to Vena using streaming approach
 * @param {string} csvFilePath Path to CSV file
 * @param {string} templateId Template ID
 * @param {string} fileName Filename for display and upload
 * @param {string} fileSize File size for display
 * @returns {Promise<Object>} Upload response
 */
async function uploadFile(csvFilePath, templateId, fileName, fileSize) {
  console.log(`Preparing to upload ${fileName} (${fileSize}) to Vena template ID: ${templateId}`);
  
  // Create upload controller for abort handling and timeouts
  const controller = createUploadController(
    `${fileName}-to-${templateId}`, 
    config.api.uploadTimeout
  );
  
  // Set up progress tracking
  const ProgressTracker = require('../utils/progressTracker');
  const { logUploadProgress } = require('../utils/logging');
  
  // Create progress tracker
  const tracker = new ProgressTracker(csvFilePath, config.api.progressInterval);
  await tracker.init();
  
  // Create form data with monitoring
  const form = new MonitoredFormData(tracker);
  
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
        if (fileStream && !streamClosed) {
          console.log('Applying aggressive backpressure due to memory pressure');
          fileStream.pause();
          
          // Resume after a longer delay
          setTimeout(() => {
            if (fileStream && !streamClosed) {
              console.log('Resuming stream after memory pressure pause');
              fileStream.resume();
            }
          }, 10000); // 10 second aggressive pause
        }
      }
    );
  }
  
  // Create a readable stream instead of loading entire file
  // Security note: Using non-literal file path, validated earlier in the validateCsvFile function
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileStream = fs.createReadStream(csvFilePath, {
    highWaterMark: config.api.streamChunkSize || 256 * 1024 // 256KB chunks by default
  });
    
  // Track stream state
  let streamClosed = false;
  let isAborting = false;
  
  // Create a function to clean up resources
  const cleanupResources = () => {
    if (!streamClosed) {
      try {
        fileStream.destroy(); // Force close the stream
        streamClosed = true;
      } catch (err) {
        console.error('Error closing file stream:', err.message);
      }
      
      // Always stop the progress tracker
      tracker.stop();
      
      // Stop memory monitoring if it was started
      if (memoryMonitor) {
        memoryMonitor.stop();
      }
      
      // Clean up controller
      controller.cleanup();
    }
  };
  
  // Handle stream errors with enhanced classification
  fileStream.on('error', (err) => {
    if (isAborting) return; // Prevent duplicate cleanup
    isAborting = true;
    
    // Classify errors for better handling and reporting
    let errorType = 'unknown';
    let recoverable = false;
    
    if (err.code === 'ENOENT') {
      errorType = 'file_not_found';
    } else if (err.code === 'EACCES') {
      errorType = 'permission_denied';
    } else if (err.code === 'EMFILE') {
      errorType = 'too_many_open_files';
      recoverable = true; // Could retry after a delay
    } else if (err.code === 'EBUSY') {
      errorType = 'file_busy';
      recoverable = true;
    } else if (err.code === 'ENOMEM') {
      errorType = 'out_of_memory';
    } else if (err.code === 'EISDIR') {
      errorType = 'is_directory';
    } else if (err.code === 'EPIPE') {
      errorType = 'broken_pipe';
      recoverable = true;
    }
    
    console.error(`Stream error (${errorType}): ${err.message}`);
    
    // Log detailed error information
    logError({
      action: 'stream-error',
      errorType,
      recoverable,
      message: err.message,
      code: err.code,
      fileName,
      templateId
    });
    
    cleanupResources();
  });
  
  // Handle aborts
  controller.signal.addEventListener('abort', () => {
    if (isAborting) return; // Prevent duplicate cleanup
    isAborting = true;
    console.log(`Upload aborted: ${controller.signal.reason?.message || 'Manual abort'}`);
    cleanupResources();
  });
  
  // Track upload progress by monitoring the stream's bytes read
  let bytesUploaded = 0;
  
  // For adaptive backpressure
  let uploadRateHistory = [];
  const adaptiveBackpressureEnabled = config.api.adaptiveBackpressure !== false; // Default true
  
  fileStream.on('data', (chunk) => {
    bytesUploaded += chunk.length;
    tracker.update(bytesUploaded);
    
    // Check if aborted
    if (controller.signal.aborted) {
      fileStream.destroy();
      streamClosed = true;
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
        
        setTimeout(() => fileStream.resume(), adaptiveBackoff);
      }
    } else {
      // Standard backpressure handling (non-adaptive)
      // If we have a lot of data buffered and our upload rate is slow, pause the stream temporarily
      if (bytesUploaded > memoryThreshold && uploadRate < config.api.minUploadRate) {
        console.log(`Applying standard backpressure: Current rate ${formatBytes(uploadRate)}/s is below threshold`);
        fileStream.pause();
        
        // Resume after a standard delay
        const backoffTime = config.api.streamBackoff || 2000; // 2 seconds default
        setTimeout(() => fileStream.resume(), backoffTime);
      }
    }
  });
  
  fileStream.on('end', () => {
    if (isAborting) return; // Prevent race conditions with abort or error handlers
    streamClosed = true;
  });
  
  // Start progress tracking
  tracker.start((progress) => {
    logUploadProgress(progress);
  });
  
  form.append('file', fileStream, {
    filename: fileName,
    contentType: 'text/csv'
  });
  
  // Build fetch options
  const options = {
    method: 'POST',
    headers: getRequestHeaders(),
    body: form,
    signal: controller.signal
  };
  
  console.log('Uploading file to Vena...');
  console.log(`Upload timeout set to ${config.api.uploadTimeout / 1000} seconds`);
  
  // Register this upload with the termination handler
  const uploadId = `${fileName}-${Date.now()}`;
  registerUpload(uploadId, controller);
  
  // Add timestamp for tracking upload duration
  const startTime = new Date();
  
  try {
    // Use centralized response handler with isUpload flag for specialized logging
    const data = await handleApiResponse(
      'upload-file',
      async () => {
        return await fetchWithRetry(
          `${config.api.baseUrl}/api/public/v1/etl/templates/${templateId}/startWithFile`, 
          options,
          undefined, // Use default retries
          undefined, // Use default backoff
          controller.signal // Pass signal to fetchWithRetry
        );
      },
      {
        fileName,
        templateId,
        fileSize
      },
      true // This is an upload operation
    );
    
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('✅ Success! File uploaded successfully.');
    console.log(`Upload completed in ${duration} seconds.`);
    
    return data;
  } catch (err) {
    // Check if this was an abort
    if (err.name === 'AbortError') {
      console.error(`Upload aborted: ${err.message}`);
    } else {
      console.error(`❌ Upload failed after ${((new Date() - startTime) / 1000).toFixed(2)} seconds: ${err.message}`);
    }
    throw err;
  } finally {
    // Always clean up resources
    cleanupResources();
    
    // Unregister this upload from the termination handler
    unregisterUpload(uploadId);
  }
}

module.exports = {
  listTemplates,
  getTemplateDetails,
  uploadFile,
  fetchWithRetry
};