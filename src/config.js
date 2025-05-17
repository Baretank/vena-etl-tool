/**
 * Configuration module for Vena ETL Tool
 * Centralizes all configuration values from environment variables
 */
require('dotenv').config();

const config = {
  api: {
    baseUrl: process.env.VENA_API_URL || 'https://us2.vena.io',
    retryAttempts: parseInt(process.env.VENA_RETRY_ATTEMPTS) || 3,
    retryBackoff: parseInt(process.env.VENA_RETRY_BACKOFF) || 300,
    defaultTemplateId: process.env.VENA_TEMPLATE_ID,
    // New settings for streaming uploads
    uploadTimeout: parseInt(process.env.VENA_UPLOAD_TIMEOUT) || 3600000, // 1 hour default
    progressInterval: parseInt(process.env.VENA_PROGRESS_INTERVAL) || 30000, // 30 seconds
    abortOnTimeout: process.env.VENA_ABORT_ON_TIMEOUT !== 'false', // Default true
    streamChunkSize: parseInt(process.env.VENA_STREAM_CHUNK_SIZE) || 262144, // 256KB default chunk size
    
    // Backpressure settings
    memoryThreshold: parseInt(process.env.VENA_MEMORY_THRESHOLD) || 104857600, // 100MB default
    minUploadRate: parseInt(process.env.VENA_MIN_UPLOAD_RATE) || 5242880, // 5MB/s default
    streamBackoff: parseInt(process.env.VENA_STREAM_BACKOFF) || 2000, // 2 seconds default
    
    // Adaptive backpressure settings
    adaptiveBackpressure: process.env.VENA_ADAPTIVE_BACKPRESSURE !== 'false', // Default true
    adaptiveThresholdFactor: parseFloat(process.env.VENA_ADAPTIVE_THRESHOLD_FACTOR) || 0.7, // 70% of average rate
    adaptiveBackoffFactorMin: parseFloat(process.env.VENA_ADAPTIVE_BACKOFF_MIN) || 0.5, // Min multiplier for backoff time
    adaptiveBackoffFactorMax: parseFloat(process.env.VENA_ADAPTIVE_BACKOFF_MAX) || 2.0, // Max multiplier for backoff time
    
    // Stall detection settings
    stallDetectionEnabled: process.env.VENA_STALL_DETECTION !== 'false', // Default true
    stallThreshold: parseInt(process.env.VENA_STALL_THRESHOLD) || 3, // 3 intervals without progress
    
    // Memory monitoring settings
    memoryMonitoringEnabled: process.env.VENA_MEMORY_MONITORING !== 'false', // Default true
    memoryWarningThreshold: parseInt(process.env.VENA_MEMORY_WARNING_THRESHOLD) || 1073741824, // 1GB default
    memoryCriticalThreshold: parseInt(process.env.VENA_MEMORY_CRITICAL_THRESHOLD) || 1610612736, // 1.5GB default
    memoryCheckInterval: parseInt(process.env.VENA_MEMORY_CHECK_INTERVAL) || 5000, // 5 seconds default
  },
  auth: {
    username: process.env.VENA_USERNAME,
    password: process.env.VENA_PASSWORD
  },
  logging: {
    directory: process.env.VENA_LOG_DIRECTORY || './logs',
    uploadHistory: process.env.VENA_UPLOAD_HISTORY || 'upload-history.jsonl',
    jobHistory: process.env.VENA_JOB_HISTORY || 'job-history.jsonl',
    apiHistory: process.env.VENA_API_HISTORY || 'api-history.jsonl',
    errorLogs: process.env.VENA_ERROR_LOGS || 'error.jsonl'
  },
  // New configuration for source directory and files
  etl: {
    sourceDirectory: process.env.VENA_SOURCE_DIRECTORY
  },
  // Task scheduler configuration
  scheduler: {
    taskName: process.env.VENA_TASK_NAME || 'VenaETLImport',
    schedule: {
      minute: process.env.VENA_SCHEDULE_MINUTE || '0',
      hour: process.env.VENA_SCHEDULE_HOUR || '5',
      day: process.env.VENA_SCHEDULE_DAY || '*',
      month: process.env.VENA_SCHEDULE_MONTH || '*',
      dayOfWeek: process.env.VENA_SCHEDULE_DAYOFWEEK || '*'
    },
    runLevel: process.env.VENA_RUN_LEVEL || 'HighestAvailable',
    timeLimit: process.env.VENA_TIME_LIMIT || 'PT1H'
  }
};

/**
 * Validate a specific configuration element
 * @param {string} name Name of the configuration element
 * @param {any} value Value of the configuration element
 * @param {boolean} required Whether the configuration is required
 * @param {Function} validator Optional validation function
 * @returns {Object} Validation result with success flag and error message
 */
function validateConfigElement(name, value, required = false, validator = null) {
  const result = {
    success: true,
    error: null
  };

  // Check if required but missing
  if (required && (value === undefined || value === null || value === '')) {
    result.success = false;
    result.error = `Missing required environment variable: ${name}`;
    return result;
  }

  // Skip further validation if not required and not provided
  if (!required && (value === undefined || value === null || value === '')) {
    return result;
  }

  // Apply custom validator if provided
  if (validator && !validator(value)) {
    result.success = false;
    result.error = `Invalid value for ${name}: ${value}`;
  }

  return result;
}

/**
 * Validate required configuration
 * @returns {boolean} True if configuration is valid
 * @throws {Error} If configuration is invalid
 */
function validateConfig() {
  const errors = [];
  const warnings = [];

  // Essential authentication configuration
  const usernameValidation = validateConfigElement('VENA_USERNAME', config.auth.username, true);
  if (!usernameValidation.success) errors.push(usernameValidation.error);

  const passwordValidation = validateConfigElement('VENA_PASSWORD', config.auth.password, true);
  if (!passwordValidation.success) errors.push(passwordValidation.error);

  // Source directory for multi-import
  const sourceDirectoryValidation = validateConfigElement('VENA_SOURCE_DIRECTORY', config.etl.sourceDirectory, false);
  if (!sourceDirectoryValidation.success) warnings.push(sourceDirectoryValidation.error);

  // API configuration
  const apiUrlValidation = validateConfigElement(
    'VENA_API_URL', 
    config.api.baseUrl, 
    false,
    url => url && url.startsWith('https://')
  );
  if (!apiUrlValidation.success) {
    warnings.push(apiUrlValidation.error);
    warnings.push('Using default API URL: https://us2.vena.io');
  }

  // Retry configuration
  const retryAttemptsValidation = validateConfigElement(
    'VENA_RETRY_ATTEMPTS',
    config.api.retryAttempts,
    false,
    value => !isNaN(value) && value > 0
  );
  if (!retryAttemptsValidation.success) {
    warnings.push(retryAttemptsValidation.error);
    warnings.push('Using default retry attempts: 3');
  }

  // Scheduler configuration
  if (process.env.VENA_SCHEDULE_MINUTE || process.env.VENA_SCHEDULE_HOUR) {
    // If any schedule parameters are provided, validate them all
    
    // Minute should be 0-59 or *
    const minuteValidation = validateConfigElement(
      'VENA_SCHEDULE_MINUTE',
      config.scheduler.schedule.minute,
      false,
      value => value === '*' || (!isNaN(parseInt(value)) && parseInt(value) >= 0 && parseInt(value) <= 59)
    );
    if (!minuteValidation.success) warnings.push(minuteValidation.error);

    // Hour should be 0-23 or *
    const hourValidation = validateConfigElement(
      'VENA_SCHEDULE_HOUR',
      config.scheduler.schedule.hour,
      false,
      value => value === '*' || (!isNaN(parseInt(value)) && parseInt(value) >= 0 && parseInt(value) <= 23)
    );
    if (!hourValidation.success) warnings.push(hourValidation.error);

    // Day should be 1-31, comma-separated list, or *
    const dayValidation = validateConfigElement(
      'VENA_SCHEDULE_DAY',
      config.scheduler.schedule.day,
      false,
      value => {
        if (value === '*') return true;
        const days = value.split(',');
        return days.every(day => !isNaN(parseInt(day)) && parseInt(day) >= 1 && parseInt(day) <= 31);
      }
    );
    if (!dayValidation.success) warnings.push(dayValidation.error);

    // Month should be 1-12, comma-separated list, or *
    const monthValidation = validateConfigElement(
      'VENA_SCHEDULE_MONTH',
      config.scheduler.schedule.month,
      false,
      value => {
        if (value === '*') return true;
        const months = value.split(',');
        return months.every(month => !isNaN(parseInt(month)) && parseInt(month) >= 1 && parseInt(month) <= 12);
      }
    );
    if (!monthValidation.success) warnings.push(monthValidation.error);

    // Day of week should be 0-6, comma-separated list, or *
    const dayOfWeekValidation = validateConfigElement(
      'VENA_SCHEDULE_DAYOFWEEK',
      config.scheduler.schedule.dayOfWeek,
      false,
      value => {
        if (value === '*') return true;
        const days = value.split(',');
        return days.every(day => !isNaN(parseInt(day)) && parseInt(day) >= 0 && parseInt(day) <= 6);
      }
    );
    if (!dayOfWeekValidation.success) warnings.push(dayOfWeekValidation.error);
  }

  // Display all warnings
  warnings.forEach(warning => console.warn('Warning:', warning));

  // If any errors, throw with all error messages
  if (errors.length > 0) {
    const errorMessage = 'Configuration validation failed:\n- ' + errors.join('\n- ');
    console.error('Error:', errorMessage);
    
    console.error('\nPlease check your .env file and ensure all required variables are set.\n');
    
    throw new Error(errorMessage);
  }

  // If we got here, essential config is valid
  return true;
}

module.exports = {
  config,
  validateConfig,
  validateConfigElement // Export for testing
};