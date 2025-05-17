/**
 * ProgressTracker class for monitoring streaming file uploads
 * Usage: const tracker = new ProgressTracker(filePath, progressInterval);
 */
class ProgressTracker {
  /**
   * Create a new progress tracker
   * @param {string} filePath Path to the file being uploaded
   * @param {number} progressInterval Interval in ms for progress updates
   */
  constructor(filePath, progressInterval) {
    this.filePath = filePath;
    this.progressInterval = progressInterval || 30000; // Default 30 seconds
    this.bytesUploaded = 0;
    this.totalBytes = 0;
    this.startTime = Date.now();
    this.lastUpdateTime = Date.now();
    this.intervalId = null;
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
  }

  /**
   * Start tracking progress
   * @param {Function} progressCallback Function to call with progress updates
   */
  start(progressCallback) {
    // Start the progress monitoring interval
    this.intervalId = setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = (now - this.startTime) / 1000;
      const bytesPerSecond = this.bytesUploaded / elapsedSeconds;
      
      // Calculate percentage if total bytes is known
      const percentage = this.totalBytes ? 
        Math.min(100, Math.round((this.bytesUploaded / this.totalBytes) * 100)) : 
        'unknown';
      
      // Calculate estimated time remaining
      let estimatedTimeRemaining = 'unknown';
      if (this.totalBytes && bytesPerSecond > 0) {
        const remainingBytes = this.totalBytes - this.bytesUploaded;
        const remainingSeconds = remainingBytes / bytesPerSecond;
        estimatedTimeRemaining = formatTimeRemaining(remainingSeconds);
      }
      
      const progress = {
        bytesUploaded: this.bytesUploaded,
        totalBytes: this.totalBytes,
        percentage,
        uploadSpeed: formatBytes(bytesPerSecond) + '/s',
        elapsedTime: formatTimeRemaining(elapsedSeconds),
        estimatedTimeRemaining,
        fileName: path.basename(this.filePath)
      };
      
      if (progressCallback) {
        progressCallback(progress);
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