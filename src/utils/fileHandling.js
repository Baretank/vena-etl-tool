/**
 * File handling utilities for Vena ETL Tool
 */
const fs = require('fs');
const path = require('path');

/**
 * Validate CSV file
 * @param {string} filePath Path to CSV file
 * @returns {Object} Validation result with success flag and optional error
 */
function validateCsvFile(filePath) {
  // Check if the file exists
  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      error: `File not found: ${filePath}`
    };
  }

  // Get the file name from the path
  const fileName = path.basename(filePath);

  // Check file extension
  if (!fileName.toLowerCase().endsWith('.csv')) {
    return {
      success: true,
      warning: 'File does not have a .csv extension. Proceeding anyway, but this might cause issues.'
    };
  }

  // Basic validation passed
  return {
    success: true,
    fileName,
    fileSize: (fs.statSync(filePath).size / 1024).toFixed(2) + ' KB'
  };
}

/**
 * Read CSV file content
 * @param {string} filePath Path to CSV file
 * @returns {Buffer} File content as buffer
 */
function readCsvFile(filePath) {
  return fs.readFileSync(filePath);
}

module.exports = {
  validateCsvFile,
  readCsvFile
};