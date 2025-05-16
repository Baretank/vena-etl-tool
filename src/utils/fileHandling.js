/**
 * File handling utilities for Vena ETL Tool
 */
const fs = require('fs');
const path = require('path');

/**
 * Sanitize file path to prevent path traversal attacks
 * Removes any components that might navigate outside intended directory
 * @param {string} filePath Raw file path to sanitize
 * @returns {string} Sanitized file path
 */
function sanitizeFilePath(filePath) {
  if (!filePath) return '';
  
  // Normalize the path to resolve any '..' or '.' segments
  const normalized = path.normalize(filePath);
  
  // Remove any attempts to navigate up directories
  return normalized.replace(/\.\.\//g, '').replace(/\.\.\\/g, '');
}

/**
 * Sanitize a string for safe usage in file names
 * @param {string} str Input string to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeString(str) {
  if (!str) return '';
  
  // Replace characters that are problematic in file names
  return str.replace(/[<>:"/\\|?*]/g, '_');
}

/**
 * Sanitize a template/job ID or similar identifier
 * @param {string} id Input ID to sanitize
 * @returns {string} Sanitized ID
 */
function sanitizeId(id) {
  if (!id) return '';
  
  // Allow only alphanumeric characters, dash, and underscore
  return id.replace(/[^a-zA-Z0-9\-_]/g, '');
}

/**
 * Validate CSV file
 * @param {string} filePath Path to CSV file
 * @returns {Object} Validation result with success flag and optional error
 */
function validateCsvFile(filePath) {
  // Sanitize the file path first
  const sanitizedPath = sanitizeFilePath(filePath);
  
  // Check if the sanitized path is different from the original
  // and warn about it if necessary
  const warning = sanitizedPath !== filePath 
    ? 'File path contained potentially unsafe characters and was sanitized.' 
    : null;
  
  // Check if the file exists
  // Security note: This is intentionally working with non-literal file paths
  // as this is the core functionality of this ETL tool
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(sanitizedPath)) {
    return {
      success: false,
      error: `File not found: ${sanitizedPath}`
    };
  }

  // Get the file name from the path
  const fileName = path.basename(sanitizedPath);

  // Check file extension
  if (!fileName.toLowerCase().endsWith('.csv')) {
    return {
      success: true,
      warning: warning || 'File does not have a .csv extension. Proceeding anyway, but this might cause issues.',
      fileName,
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fileSize: (fs.statSync(sanitizedPath).size / 1024).toFixed(2) + ' KB'
    };
  }

  // Basic validation passed
  return {
    success: true,
    fileName,
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fileSize: (fs.statSync(sanitizedPath).size / 1024).toFixed(2) + ' KB',
    warning
  };
}

/**
 * Read CSV file content
 * @param {string} filePath Path to CSV file
 * @returns {Buffer} File content as buffer
 */
function readCsvFile(filePath) {
  // Sanitize the file path first
  const sanitizedPath = sanitizeFilePath(filePath);
  
  // Security note: This function intentionally works with non-literal file paths
  // as it's core functionality of the ETL tool
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(sanitizedPath);
}

module.exports = {
  validateCsvFile,
  readCsvFile,
  sanitizeFilePath,
  sanitizeString,
  sanitizeId
};