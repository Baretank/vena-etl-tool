/**
 * Logging utility for Vena ETL Tool
 * Handles all logging operations
 */
const fs = require('fs');
const path = require('path');
const { config } = require('../config');

/**
 * Ensure logs directory exists
 */
function ensureLogDirectory() {
  const logDir = config.logging.directory;
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Log upload operation
 * @param {Object} data Upload operation details
 */
function logUpload(data) {
  ensureLogDirectory();
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...data
  };
  const logPath = path.join(config.logging.directory, config.logging.uploadHistory);
  fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
}

/**
 * Log job operation (status check, cancel)
 * @param {Object} data Job operation details
 */
function logJobOperation(data) {
  ensureLogDirectory();
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...data
  };
  const logPath = path.join(config.logging.directory, config.logging.jobHistory);
  fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
}

/**
 * Log API operation (templates listing, etc)
 * @param {Object} data API operation details
 */
function logApiOperation(data) {
  ensureLogDirectory();
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...data
  };
  const logPath = path.join(config.logging.directory, config.logging.apiHistory);
  fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
}

/**
 * Log error
 * @param {Object} data Error details
 */
function logError(data) {
  ensureLogDirectory();
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...data
  };
  const logPath = path.join(config.logging.directory, config.logging.errorLogs);
  fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
}

module.exports = {
  logUpload,
  logJobOperation,
  logApiOperation,
  logError
};