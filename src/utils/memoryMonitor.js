/**
 * Memory monitoring utility
 * Tracks memory usage during uploads and notifies when thresholds are exceeded
 */
const { logError } = require('./logging');

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
 * MemoryMonitor class for tracking memory usage during operations
 */
class MemoryMonitor {
  /**
   * Create a new memory monitor
   * @param {number} warningThresholdBytes Memory warning threshold in bytes
   * @param {number} criticalThresholdBytes Memory critical threshold in bytes
   * @param {number} checkIntervalMs Interval between memory checks in ms
   */
  constructor(warningThresholdBytes, criticalThresholdBytes, checkIntervalMs) {
    this.warningThresholdBytes = warningThresholdBytes;
    this.criticalThresholdBytes = criticalThresholdBytes;
    this.checkIntervalMs = checkIntervalMs;
    this.intervalId = null;
    
    // Track peak memory usage
    this.peakRss = 0;
    this.peakHeapUsed = 0;
    
    // Stats for reporting
    this.warningCount = 0;
    this.criticalCount = 0;
    this.lastMemoryStats = null;
  }
  
  /**
   * Start monitoring memory usage
   * @param {Function} onWarning Callback when warning threshold is reached
   * @param {Function} onCritical Callback when critical threshold is reached
   */
  start(onWarning, onCritical) {
    this.intervalId = setInterval(() => {
      try {
        const memUsage = process.memoryUsage();
        const heapUsed = memUsage.heapUsed;
        const rss = memUsage.rss; // Resident Set Size - total memory allocated
        
        // Update peak tracking
        this.peakRss = Math.max(this.peakRss, rss);
        this.peakHeapUsed = Math.max(this.peakHeapUsed, heapUsed);
        
        // Store the latest stats
        this.lastMemoryStats = {
          rss,
          heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external,
          arrayBuffers: memUsage.arrayBuffers || 0,
          timestamp: Date.now(),
          formatted: {
            rss: formatBytes(rss),
            heapUsed: formatBytes(heapUsed),
            heapTotal: formatBytes(memUsage.heapTotal)
          }
        };
        
        // Check against thresholds
        if (rss > this.criticalThresholdBytes) {
          this.criticalCount++;
          
          // Log the critical memory usage
          logError({
            action: 'memory-critical',
            rss: formatBytes(rss),
            heapUsed: formatBytes(heapUsed),
            percentOfThreshold: ((rss / this.criticalThresholdBytes) * 100).toFixed(2) + '%',
            occurrenceCount: this.criticalCount
          });
          
          if (onCritical) {
            onCritical(this.lastMemoryStats);
          }
        } else if (rss > this.warningThresholdBytes) {
          this.warningCount++;
          
          // Log the warning memory usage (but not too frequently)
          if (this.warningCount === 1 || this.warningCount % 5 === 0) {
            logError({
              action: 'memory-warning',
              rss: formatBytes(rss),
              heapUsed: formatBytes(heapUsed),
              percentOfThreshold: ((rss / this.warningThresholdBytes) * 100).toFixed(2) + '%',
              occurrenceCount: this.warningCount
            });
          }
          
          if (onWarning) {
            onWarning(this.lastMemoryStats);
          }
        }
      } catch (err) {
        console.error('Error in memory monitoring:', err.message);
      }
    }, this.checkIntervalMs);
  }
  
  /**
   * Stop monitoring memory usage
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      
      // Log peak memory usage on stop for diagnostics
      if (this.peakRss > 0) {
        console.log(`Peak memory usage: RSS ${formatBytes(this.peakRss)}, Heap ${formatBytes(this.peakHeapUsed)}`);
        
        // Log to file if thresholds were exceeded
        if (this.warningCount > 0 || this.criticalCount > 0) {
          logError({
            action: 'memory-peak-summary',
            peakRss: formatBytes(this.peakRss),
            peakHeapUsed: formatBytes(this.peakHeapUsed),
            warningCount: this.warningCount,
            criticalCount: this.criticalCount
          });
        }
      }
    }
  }
  
  /**
   * Get current memory usage statistics
   * @returns {Object} Memory usage statistics
   */
  getStats() {
    return this.lastMemoryStats || {};
  }
  
  /**
   * Get peak memory usage
   * @returns {Object} Peak memory usage statistics
   */
  getPeakStats() {
    return {
      peakRss: this.peakRss,
      peakHeapUsed: this.peakHeapUsed,
      formatted: {
        peakRss: formatBytes(this.peakRss),
        peakHeapUsed: formatBytes(this.peakHeapUsed)
      }
    };
  }
}

module.exports = MemoryMonitor;