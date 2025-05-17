/**
 * Error Classification Module
 * Centralizes error handling and classification across the application
 */
const { logError } = require('./logging');

// Define error categories
const ERROR_CATEGORIES = {
  NETWORK: 'network',       // Network connectivity issues
  SERVER: 'server',         // Server-side problems
  AUTH: 'auth',             // Authentication errors
  VALIDATION: 'validation', // Input validation errors
  FILE_SYSTEM: 'filesystem',// File access/permission errors
  STREAM: 'stream',         // Stream handling errors
  TIMEOUT: 'timeout',       // Operation timeout
  ABORT: 'abort',           // User or system abort
  UNKNOWN: 'unknown'        // Unclassified errors
};

// Define error types
const ERROR_TYPES = {
  // Network errors
  CONNECTION_RESET: 'connection_reset',
  CONNECTION_REFUSED: 'connection_refused',
  TIMEOUT: 'timeout',
  DNS_LOOKUP_FAILED: 'dns_lookup_failed',
  
  // Server errors
  SERVER_ERROR: 'server_error',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  RATE_LIMITED: 'rate_limited',
  
  // Auth errors
  UNAUTHORIZED: 'unauthorized',
  TOKEN_EXPIRED: 'token_expired',
  
  // Validation errors
  INVALID_INPUT: 'invalid_input',
  MISSING_PARAMETER: 'missing_parameter',
  INVALID_FORMAT: 'invalid_format',
  
  // File system errors
  FILE_NOT_FOUND: 'file_not_found',
  PERMISSION_DENIED: 'permission_denied',
  FILE_TOO_LARGE: 'file_too_large',
  FILE_IN_USE: 'file_in_use',
  DIRECTORY_NOT_FOUND: 'directory_not_found',
  IS_DIRECTORY: 'is_directory',
  
  // Stream errors
  STREAM_CLOSED: 'stream_closed',
  BROKEN_PIPE: 'broken_pipe',
  STREAM_ABORTED: 'stream_aborted',
  
  // Abort errors
  USER_ABORT: 'user_abort',
  SYSTEM_ABORT: 'system_abort',
  
  // Fallback
  UNKNOWN: 'unknown'
};

/**
 * Create a standardized error object with classification
 * @param {Error|string} originalError Original error object or message
 * @param {string} errorType Type of error from ERROR_TYPES
 * @param {string} category Error category from ERROR_CATEGORIES
 * @param {boolean} recoverable Whether the error is potentially recoverable
 * @param {Object} context Additional context information
 * @returns {Error} Enhanced error object
 */
function createClassifiedError(originalError, errorType, category, recoverable = false, context = {}) {
  // Convert string to Error if needed
  const error = typeof originalError === 'string' 
    ? new Error(originalError) 
    : originalError || new Error('Unknown error');
  
  // Add classification properties
  error.errorType = errorType || ERROR_TYPES.UNKNOWN;
  error.category = category || ERROR_CATEGORIES.UNKNOWN;
  error.recoverable = recoverable;
  error.context = context;
  error.timestamp = new Date().toISOString();
  
  return error;
}

/**
 * Classify an error based on its properties and message
 * @param {Error|string} error Error to classify
 * @param {Object} additionalContext Additional context to add
 * @returns {Error} Classified error
 */
function classifyError(error, additionalContext = {}) {
  // Convert string to Error if needed
  if (typeof error === 'string') {
    error = new Error(error);
  }
  
  // Default values
  let errorType = ERROR_TYPES.UNKNOWN;
  let category = ERROR_CATEGORIES.UNKNOWN;
  let recoverable = false;
  const context = {
    originalCode: error.code,
    ...additionalContext
  };
  
  const message = error.message || '';
  const code = error.code || '';
  
  // First check for abort errors
  if (error.name === 'AbortError' || message.includes('aborted')) {
    errorType = ERROR_TYPES.USER_ABORT;
    category = ERROR_CATEGORIES.ABORT;
    recoverable = false;
  }
  // File system errors
  else if (code === 'ENOENT') {
    errorType = ERROR_TYPES.FILE_NOT_FOUND;
    category = ERROR_CATEGORIES.FILE_SYSTEM;
    recoverable = false;
  }
  else if (code === 'EACCES') {
    errorType = ERROR_TYPES.PERMISSION_DENIED;
    category = ERROR_CATEGORIES.FILE_SYSTEM;
    recoverable = false;
  }
  else if (code === 'EPERM') {
    errorType = ERROR_TYPES.PERMISSION_DENIED;
    category = ERROR_CATEGORIES.FILE_SYSTEM;
    recoverable = false;
  }
  else if (code === 'EBUSY') {
    errorType = ERROR_TYPES.FILE_IN_USE;
    category = ERROR_CATEGORIES.FILE_SYSTEM;
    recoverable = true;
  }
  else if (code === 'EISDIR') {
    errorType = ERROR_TYPES.IS_DIRECTORY;
    category = ERROR_CATEGORIES.FILE_SYSTEM;
    recoverable = false;
  }
  else if (code === 'ENOTDIR') {
    errorType = ERROR_TYPES.DIRECTORY_NOT_FOUND;
    category = ERROR_CATEGORIES.FILE_SYSTEM;
    recoverable = false;
  }
  // Network errors
  else if (code === 'ECONNRESET' || message.includes('connection reset')) {
    errorType = ERROR_TYPES.CONNECTION_RESET;
    category = ERROR_CATEGORIES.NETWORK;
    recoverable = true;
  }
  else if (code === 'ECONNREFUSED' || message.includes('connection refused')) {
    errorType = ERROR_TYPES.CONNECTION_REFUSED;
    category = ERROR_CATEGORIES.NETWORK;
    recoverable = true;
  }
  else if (code === 'ETIMEDOUT' || message.includes('timeout')) {
    errorType = ERROR_TYPES.TIMEOUT;
    category = ERROR_CATEGORIES.TIMEOUT;
    recoverable = true;
  }
  else if (code === 'ENOTFOUND') {
    errorType = ERROR_TYPES.DNS_LOOKUP_FAILED;
    category = ERROR_CATEGORIES.NETWORK;
    recoverable = true;
  }
  // Stream errors
  else if (code === 'EPIPE') {
    errorType = ERROR_TYPES.BROKEN_PIPE;
    category = ERROR_CATEGORIES.STREAM;
    recoverable = true;
  }
  // HTTP status errors
  else if (message.includes('HTTP error! Status:')) {
    const statusMatch = message.match(/Status: (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 0;
    
    if (status >= 500) {
      errorType = ERROR_TYPES.SERVER_ERROR;
      category = ERROR_CATEGORIES.SERVER;
      recoverable = true;
    }
    else if (status === 429) {
      errorType = ERROR_TYPES.RATE_LIMITED;
      category = ERROR_CATEGORIES.SERVER;
      recoverable = true;
    }
    else if (status === 401) {
      errorType = ERROR_TYPES.UNAUTHORIZED;
      category = ERROR_CATEGORIES.AUTH;
      recoverable = false;
    }
    else if (status === 403) {
      errorType = ERROR_TYPES.UNAUTHORIZED;
      category = ERROR_CATEGORIES.AUTH;
      recoverable = false;
    }
    else if (status === 404) {
      errorType = ERROR_TYPES.SERVER_ERROR;
      category = ERROR_CATEGORIES.SERVER;
      recoverable = false;
    }
    else if (status === 413) {
      errorType = ERROR_TYPES.FILE_TOO_LARGE;
      category = ERROR_CATEGORIES.VALIDATION;
      recoverable = false;
    }
    else if (status >= 400) {
      errorType = ERROR_TYPES.INVALID_INPUT;
      category = ERROR_CATEGORIES.VALIDATION;
      recoverable = false;
    }
  }
  // Handle validation errors
  else if (message.includes('validation failed') || message.includes('invalid')) {
    errorType = ERROR_TYPES.INVALID_INPUT;
    category = ERROR_CATEGORIES.VALIDATION;
    recoverable = false;
  }
  
  // Create and return the classified error
  return createClassifiedError(error, errorType, category, recoverable, context);
}

/**
 * Log an error with standardized classification
 * @param {Error|string} error Error to log
 * @param {string} action Action that was being performed
 * @param {Object} context Additional context information
 */
function logClassifiedError(error, action, context = {}) {
  const classifiedError = classifyError(error, context);
  
  // Log with standardized format
  logError({
    action,
    errorType: classifiedError.errorType,
    category: classifiedError.category,
    recoverable: classifiedError.recoverable,
    message: classifiedError.message,
    code: classifiedError.code,
    context: classifiedError.context
  });
  
  return classifiedError;
}

/**
 * Determine if an error is potentially recoverable
 * @param {Error} error Error to check
 * @returns {boolean} Whether the error is potentially recoverable
 */
function isRecoverableError(error) {
  // Classify if not already classified
  if (error.recoverable === undefined) {
    error = classifyError(error);
  }
  
  return error.recoverable === true;
}

module.exports = {
  ERROR_CATEGORIES,
  ERROR_TYPES,
  createClassifiedError,
  classifyError,
  logClassifiedError,
  isRecoverableError
};