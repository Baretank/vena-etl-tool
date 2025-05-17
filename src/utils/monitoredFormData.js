/**
 * MonitoredFormData class for tracking form-data stream uploads
 * Extends the standard FormData class to provide visibility into actual HTTP upload progress
 */
const FormData = require('form-data');
const stream = require('stream');

/**
 * MonitoredFormData extends FormData to track actual bytes being sent over the wire
 */
class MonitoredFormData extends FormData {
  /**
   * Create a new monitored form data instance
   * @param {Object} tracker The progress tracker to update with actual bytes sent
   */
  constructor(tracker) {
    super();
    this.tracker = tracker;
    this.bytesActuallySent = 0;
  }
  
  /**
   * Override getBuffer to monitor actual data being sent
   * @returns {Buffer} The form data buffer
   * @override
   */
  getBuffer() {
    const buffer = super.getBuffer();
    if (this.tracker && typeof this.tracker.updateActualBytes === 'function') {
      this.tracker.updateActualBytes(buffer.length);
    }
    return buffer;
  }
  
  /**
   * Override pipe method to monitor streaming data
   * @param {stream.Writable} destination The destination stream
   * @returns {stream.Writable} The destination stream
   * @override
   */
  pipe(destination) {
    // Create a pass-through stream to monitor chunks as they flow
    const passThrough = new stream.PassThrough();
    
    passThrough.on('data', (chunk) => {
      this.bytesActuallySent += chunk.length;
      
      if (this.tracker && typeof this.tracker.updateActualBytes === 'function') {
        this.tracker.updateActualBytes(this.bytesActuallySent);
      }
      
      // Forward the chunk to the destination
      destination.write(chunk);
    });
    
    // Pipe from the original form to our monitoring pass-through
    super.pipe(passThrough);
    
    // Return the destination to maintain the API
    return destination;
  }
  
  /**
   * Get the boundary string used in the multipart form
   * @returns {string} The boundary string
   */
  getBoundary() {
    return this.getBoundary ? super.getBoundary() : this._boundary;
  }
  
  /**
   * Get the length of the form data
   * @returns {number|null} The length or null if unknown
   */
  getLength() {
    return this.getLength ? super.getLength() : this._valueLength;
  }
  
  /**
   * Get the current number of bytes actually sent
   * @returns {number} The number of bytes sent
   */
  getBytesSent() {
    return this.bytesActuallySent;
  }
}

module.exports = MonitoredFormData;