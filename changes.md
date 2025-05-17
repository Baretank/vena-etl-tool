# Additional Streaming Improvements

After a thorough code review, here are additional recommendations for improving the streaming import functionality.

1. **Network Detection for Adaptive Backpressure**

When upload speeds vary due to network conditions, a static threshold for backpressure may be too rigid. Consider implementing adaptive thresholds:

```javascript
// Enhanced backpressure handling with adaptive thresholds
fileStream.on('data', (chunk) => {
  // ... existing code
  
  // Track upload rate over time
  const now = Date.now();
  const uploadTime = now - startTime;
  const uploadRate = bytesUploaded / (uploadTime / 1000); // bytes per second
  
  // Calculate dynamic threshold based on historical performance
  // Use a moving average of recent upload rates
  if (!uploadRateHistory) {
    uploadRateHistory = [];
  }
  
  // Add current rate to history (keep last 5 samples)
  uploadRateHistory.push(uploadRate);
  if (uploadRateHistory.length > 5) {
    uploadRateHistory.shift();
  }
  
  // Calculate average upload rate
  const avgUploadRate = uploadRateHistory.reduce((sum, rate) => sum + rate, 0) / uploadRateHistory.length;
  
  // Determine if we're significantly below our average rate
  const rateThreshold = avgUploadRate * 0.7; // 70% of average rate
  
  // Apply backpressure if rate drops significantly and buffer is large
  if (bytesUploaded > memoryThreshold && uploadRate < rateThreshold) {
    console.log(`Applying backpressure: Current rate ${formatBytes(uploadRate)}/s is below threshold`);
    fileStream.pause();
    
    // Adaptive backoff time based on how far below threshold we are
    const severityFactor = Math.max(0.5, Math.min(2, rateThreshold / (uploadRate || 1)));
    const adaptiveBackoff = Math.round(config.api.streamBackoff * severityFactor);
    
    setTimeout(() => fileStream.resume(), adaptiveBackoff);
  }
});
```

2. **Upload Progress Stall Detection**

Add monitoring for stalled uploads where bytes are no longer being sent:

```javascript
// Enhance ProgressTracker with stall detection
class ProgressTracker {
  // ... existing code
  
  constructor(filePath, progressInterval) {
    // ... existing initialization
    this.lastBytesUploaded = 0;
    this.stallThreshold = 3; // How many consecutive intervals with no progress before considering stalled
    this.stallCounter = 0;
  }
  
  start(progressCallback, stallCallback) {
    this.intervalId = setInterval(() => {
      try {
        // ... existing progress calculation
        
        // Check for stalled upload
        if (this.bytesUploaded === this.lastBytesUploaded) {
          this.stallCounter++;
          
          // If stalled for too long, notify via callback
          if (this.stallCounter >= this.stallThreshold && stallCallback) {
            stallCallback({
              fileName: path.basename(this.filePath),
              stallTime: this.stallCounter * this.progressInterval / 1000,
              bytesUploaded: this.bytesUploaded,
              totalBytes: this.totalBytes
            });
          }
        } else {
          // Reset counter if we've made progress
          this.stallCounter = 0;
          this.lastBytesUploaded = this.bytesUploaded;
        }
        
        // ... existing callback code
      } catch (err) {
        console.error('Error in progress tracking:', err.message);
      }
    }, this.progressInterval);
  }
}
```

3. **Form-Data Stream Monitoring**

Node-fetch and form-data don't provide visibility into the actual HTTP upload progress. Consider implementing a custom FormData class to monitor the actual bytes sent over the wire:

```javascript
class MonitoredFormData extends FormData {
  constructor(uploadTracker) {
    super();
    this.uploadTracker = uploadTracker;
    this.bytesActuallySent = 0;
  }
  
  // Override getBuffer to monitor actual data being sent
  getBuffer() {
    const buffer = super.getBuffer();
    this.uploadTracker.updateActualBytes(buffer.length);
    return buffer;
  }
  
  // For streaming interfaces
  pipe(destination) {
    const passThrough = new stream.PassThrough();
    
    passThrough.on('data', (chunk) => {
      this.bytesActuallySent += chunk.length;
      this.uploadTracker.updateActualBytes(this.bytesActuallySent);
      destination.write(chunk);
    });
    
    super.pipe(passThrough);
    return destination;
  }
}
```

4. **Graceful Termination Handling**

Add handling for process termination signals to ensure clean shutdown:

```javascript
// Add to main script
process.on('SIGINT', handleTermination);
process.on('SIGTERM', handleTermination);

let activeUploads = new Map(); // Track all active uploads

function handleTermination() {
  console.log('Process termination requested. Cleaning up uploads...');
  
  // Abort all active uploads
  for (const [uploadId, controller] of activeUploads.entries()) {
    console.log(`Aborting upload: ${uploadId}`);
    controller.abort(new Error('Process termination requested'));
  }
  
  // Allow time for cleanup before exit
  setTimeout(() => {
    console.log('Cleanup complete, exiting now');
    process.exit(0);
  }, 1000);
}

// Modify uploadFile function to register uploads
function uploadFile(...) {
  // ... existing code
  
  // Register this upload
  const uploadId = `${fileName}-${Date.now()}`;
  activeUploads.set(uploadId, controller);
  
  try {
    // ... existing code
  } finally {
    // Always remove from active uploads
    activeUploads.delete(uploadId);
  }
}
```

5. **Enhanced Stream Error Classification**

Improve error handling by classifying stream errors:

```javascript
fileStream.on('error', (err) => {
  if (isAborting) return;
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
  }
  
  console.error(`Stream error (${errorType}): ${err.message}`);
  logError({
    action: 'stream-error',
    errorType,
    recoverable,
    message: err.message,
    fileName,
    templateId
  });
  
  cleanupResources();
});
```

6. **Memory Usage Monitoring**

Add memory usage monitoring during large uploads:

```javascript
class MemoryMonitor {
  constructor(warningThresholdMB = 1024, criticalThresholdMB = 1536) {
    this.warningThresholdBytes = warningThresholdMB * 1024 * 1024;
    this.criticalThresholdBytes = criticalThresholdMB * 1024 * 1024;
    this.intervalId = null;
  }
  
  start(onWarning, onCritical) {
    this.intervalId = setInterval(() => {
      const memUsage = process.memoryUsage();
      const heapUsed = memUsage.heapUsed;
      const rss = memUsage.rss;
      
      if (rss > this.criticalThresholdBytes) {
        onCritical({
          rss,
          heapUsed,
          heapTotal: memUsage.heapTotal,
          formatted: {
            rss: formatBytes(rss),
            heapUsed: formatBytes(heapUsed)
          }
        });
      } else if (rss > this.warningThresholdBytes) {
        onWarning({
          rss,
          heapUsed,
          heapTotal: memUsage.heapTotal,
          formatted: {
            rss: formatBytes(rss),
            heapUsed: formatBytes(heapUsed)
          }
        });
      }
    }, 5000); // Check every 5 seconds
  }
  
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
```

7. **Improved Time Remaining Calculation**

Enhance the time remaining calculation to be more accurate:

```javascript
// In ProgressTracker
calculateTimeRemaining() {
  if (!this.totalBytes || this.bytesUploaded === 0) {
    return 'unknown';
  }
  
  const now = Date.now();
  const elapsedMs = now - this.startTime;
  
  // Don't calculate if we've just started (avoid division by zero or inaccurate initial speeds)
  if (elapsedMs < 2000) {
    return 'calculating...';
  }
  
  // Calculate based on recent upload rate rather than overall average
  const recentWindowMs = Math.min(30000, elapsedMs); // Use last 30 seconds or all elapsed time if less
  const bytesUploadedRecently = this.bytesUploaded - (this.bytesHistory[0] || 0);
  const recentRatePerMs = bytesUploadedRecently / recentWindowMs;
  
  const remainingBytes = this.totalBytes - this.bytesUploaded;
  const estimatedRemainingMs = remainingBytes / recentRatePerMs;
  
  return formatTimeRemaining(estimatedRemainingMs / 1000);
}
```