/**
 * ProgressTracker class for monitoring streaming file uploads
 * Usage: const tracker = new ProgressTracker(filePath, progressInterval);
 */

const fs = require('fs');
const path = require('path');
const { config } = require('../config');

class ProgressTracker {
  /**
   * Create a new progress tracker
   * @param {string} filePath Path to the file being uploaded
   * @param {number} progressInterval Interval in ms for progress updates
   */
  constructor(filePath, progressInterval) {
    this.filePath = filePath;
    this.progressInterval = progressInterval || 30000; // Default 30 seconds
    this.bytesUploaded = 0; // Bytes read from file
    this.bytesActuallySent = 0; // Actual bytes sent over the wire (if using MonitoredFormData)
    this.totalBytes = 0;
    this.startTime = Date.now();
    this.lastUpdateTime = Date.now();
    this.intervalId = null;
    
    // Stall detection properties
    this.lastBytesUploaded = 0;
    this.lastBytesActuallySent = 0;
    this.stallThreshold = config.api.stallThreshold || 3; // Default: 3 intervals with no progress
    this.stallCounter = 0;
    this.stallDetectionEnabled = config.api.stallDetectionEnabled !== false; // Default: true
    
    // Rate history for improved time estimation
    this.bytesHistory = []; // Store bytes uploaded at sample points
    this.timeHistory = []; // Store timestamps of samples
    this.historySize = 10; // Number of historical points to track
    
    // Actual bytes sent history
    this.actualBytesHistory = []; // Store actual bytes sent at sample points
  }

  /**
   * Initialize the tracker
   */
  async init() {
    try {
      // Security note: This uses a non-literal file path, but it's expected behavior for this tool
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const stats = fs.statSync(this.filePath);
      this.totalBytes = stats.size;
    } catch (err) {
      console.warn('Warning: Unable to get file size for progress tracking');
      this.totalBytes = 0;
    }
    
    // Initialize history with zeros
    const now = Date.now();
    this.bytesHistory.push(0);
    this.timeHistory.push(now);
  }

  /**
   * Start tracking progress
   * @param {Function} progressCallback Function to call with progress updates
   * @param {Function} stallCallback Function to call when upload stalls (optional)
   */
  start(progressCallback, stallCallback) {
    // Start the progress monitoring interval
    this.intervalId = setInterval(() => {
      try {
        const now = Date.now();
        const elapsedSeconds = (now - this.startTime) / 1000;
        const bytesPerSecond = this.calculateCurrentSpeed();
        
        // Calculate percentage if total bytes is known
        const percentage = this.totalBytes ? 
          Math.min(100, Math.round((this.bytesUploaded / this.totalBytes) * 100)) : 
          'unknown';
        
        // Calculate estimated time remaining using improved algorithm
        const estimatedTimeRemaining = this.calculateTimeRemaining();
        
        // Check for stalled upload if enabled
        if (this.stallDetectionEnabled) {
          if (this.bytesUploaded === this.lastBytesUploaded) {
            this.stallCounter++;
            
            // If stalled for too long, notify via callback
            if (this.stallCounter >= this.stallThreshold && stallCallback) {
              stallCallback({
                fileName: path.basename(this.filePath),
                stallTime: this.stallCounter * this.progressInterval / 1000,
                bytesUploaded: this.bytesUploaded,
                totalBytes: this.totalBytes,
                percentage
              });
            }
          } else {
            // Reset counter if we've made progress
            this.stallCounter = 0;
            this.lastBytesUploaded = this.bytesUploaded;
          }
        }
        
        const progress = {
          bytesUploaded: this.bytesUploaded,
          bytesActuallySent: this.bytesActuallySent,
          totalBytes: this.totalBytes,
          percentage,
          uploadSpeed: formatBytes(bytesPerSecond) + '/s',
          elapsedTime: formatTimeRemaining(elapsedSeconds),
          estimatedTimeRemaining,
          fileName: path.basename(this.filePath),
          stalled: this.stallCounter >= this.stallThreshold,
          networkLatency: this.bytesActuallySent > 0 ? `${((this.bytesUploaded - this.bytesActuallySent) / 1024 / 1024).toFixed(2)} MB` : 'unknown'
        };
        
        if (progressCallback) {
          progressCallback(progress);
        }
      } catch (err) {
        console.error('Error in progress tracking:', err.message);
        // Ensure we don't crash the application due to progress tracking issues
      }
    }, this.progressInterval);
  }

  /**
   * Update the number of bytes uploaded
   * @param {number} bytesUploaded Number of bytes uploaded
   */
  update(bytesUploaded) {
    this.bytesUploaded = bytesUploaded;
    this.lastUpdateTime = Date.now();
    
    // Update the history for rate calculation
    const now = Date.now();
    this.bytesHistory.push(bytesUploaded);
    this.timeHistory.push(now);
    
    // Keep history at target size
    if (this.bytesHistory.length > this.historySize) {
      this.bytesHistory.shift();
      this.timeHistory.shift();
    }
  }
  
  /**
   * Update the number of actual bytes sent over the wire (from MonitoredFormData)
   * @param {number} bytesActuallySent Number of bytes actually sent
   */
  updateActualBytes(bytesActuallySent) {
    this.bytesActuallySent = bytesActuallySent;
    this.lastUpdateTime = Date.now();
    
    // Update the history for rate calculation
    this.actualBytesHistory.push(bytesActuallySent);
    
    // Keep history at same size as main history
    if (this.actualBytesHistory.length > this.historySize) {
      this.actualBytesHistory.shift();
    }
  }

  /**
   * Calculate current upload speed based on recent history
   * @returns {number} Upload speed in bytes per second
   */
  calculateCurrentSpeed() {
    const now = Date.now();
    
    // If we have fewer than 2 data points, use simple calculation
    if (this.bytesHistory.length < 2) {
      const elapsedSeconds = (now - this.startTime) / 1000;
      return elapsedSeconds > 0 ? this.bytesUploaded / elapsedSeconds : 0;
    }
    
    // Use the entire history for a more stable speed calculation
    const oldestTime = this.timeHistory[0];
    const oldestBytes = this.bytesHistory[0];
    const elapsedMs = now - oldestTime;
    
    // Avoid division by zero
    if (elapsedMs <= 0) {
      return 0;
    }
    
    const bytesDelta = this.bytesUploaded - oldestBytes;
    return (bytesDelta / elapsedMs) * 1000; // Convert to bytes per second
  }

  /**
   * Calculate estimated time remaining with improved accuracy
   * @returns {string} Formatted time remaining string
   */
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
    
    // Use recent upload rate rather than overall average
    const recentRate = this.calculateCurrentSpeed();
    
    // If no progress is being made, can't estimate
    if (recentRate === 0) {
      return 'unknown';
    }
    
    const remainingBytes = this.totalBytes - this.bytesUploaded;
    const estimatedRemainingSeconds = remainingBytes / recentRate;
    
    return formatTimeRemaining(estimatedRemainingSeconds);
  }

  /**
   * Stop tracking progress
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

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
 * Format seconds to a human-readable string
 * @param {number} seconds Number of seconds
 * @returns {string} Formatted string
 */
function formatTimeRemaining(seconds) {
  if (seconds === Infinity || isNaN(seconds)) return 'unknown';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  let result = '';
  if (hours > 0) {
    result += hours + 'h ';
  }
  if (minutes > 0 || hours > 0) {
    result += minutes + 'm ';
  }
  result += secs + 's';
  
  return result;
}

module.exports = ProgressTracker;