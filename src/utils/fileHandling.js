/**
 * File handling utilities for Vena ETL Tool
 */
const fs = require('fs');
const path = require('path');
const { createReadStream } = require('fs');
const { createInterface } = require('readline');

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
 * Parse CSV header line into an array of header values
 * @param {string} headerLine The CSV header line to parse
 * @returns {string[]} Array of parsed header values
 */
function parseCSVHeaders(headerLine) {
  const headers = [];
  let currentHeader = '';
  let inQuotes = false;
  
  for (let i = 0; i < headerLine.length; i++) {
    const char = headerLine[i];
    
    if (char === '"') {
      // Toggle the inQuotes flag
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      // End of current header value
      headers.push(currentHeader.trim());
      currentHeader = '';
    } else {
      // Add character to current header
      currentHeader += char;
    }
  }
  
  // Add the last header
  if (currentHeader.trim()) {
    headers.push(currentHeader.trim());
  }
  
  return headers;
}

/**
 * Check if required headers are present in CSV file
 * @param {string[]} actualHeaders Array of headers in the CSV file
 * @param {string[]} requiredHeaders Array of required headers
 * @returns {Object} Validation result with any missing headers
 */
function validateRequiredHeaders(actualHeaders, requiredHeaders) {
  if (!requiredHeaders || requiredHeaders.length === 0) {
    return { valid: true };
  }
  
  const missingHeaders = [];
  const normalizedActualHeaders = actualHeaders.map(header => header.toLowerCase());
  
  for (const header of requiredHeaders) {
    const normalizedHeader = header.toLowerCase();
    if (!normalizedActualHeaders.includes(normalizedHeader)) {
      missingHeaders.push(header);
    }
  }
  
  return {
    valid: missingHeaders.length === 0,
    missingHeaders
  };
}

/**
 * Read and validate CSV header from file
 * @param {string} filePath Path to the CSV file
 * @param {string[]} requiredHeaders Optional array of headers that must be present
 * @returns {Promise<Object>} Validation result with headers information
 */
async function validateCSVHeaders(filePath, requiredHeaders = []) {
  // Security note: Using non-literal file path, but sanitized before use
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileStream = createReadStream(filePath);
  const rl = createInterface({ input: fileStream });
  
  // Read just the first line (headers)
  const headerPromise = new Promise((resolve, reject) => {
    let headerLine = null;
    
    rl.on('line', (line) => {
      // Get the first line and close the stream
      if (headerLine === null) {
        headerLine = line;
        rl.close();
      }
    });
    
    rl.on('close', () => {
      if (headerLine === null) {
        resolve({ valid: false, error: 'CSV file appears to be empty' });
      } else {
        const headers = parseCSVHeaders(headerLine);
        const headerValidation = validateRequiredHeaders(headers, requiredHeaders);
        
        resolve({
          valid: headerValidation.valid,
          headers,
          missingHeaders: headerValidation.missingHeaders || [],
          headerLine
        });
      }
    });
    
    rl.on('error', (err) => {
      reject(err);
    });
  });
  
  try {
    return await headerPromise;
  } catch (err) {
    return {
      valid: false,
      error: `Error reading CSV headers: ${err.message}`
    };
  }
}

/**
 * Check for common CSV format issues
 * @param {string} filePath Path to the CSV file
 * @param {number} sampleSize Number of data rows to check (default: 5)
 * @returns {Promise<Object>} Validation result with format issues
 */
async function checkCSVFormatIssues(filePath, sampleSize = 5) {
  // Security note: Using non-literal file path, but sanitized before use
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileStream = createReadStream(filePath);
  const rl = createInterface({ input: fileStream });
  
  const formatCheckPromise = new Promise((resolve, reject) => {
    let headerLine = null;
    const dataRows = [];
    let lineCount = 0;
    
    rl.on('line', (line) => {
      lineCount++;
      
      // Store header line
      if (lineCount === 1) {
        headerLine = line;
      } 
      // Store sample data rows
      else if (lineCount <= sampleSize + 1) {
        dataRows.push(line);
      } 
      // Close after reading enough rows
      else if (lineCount > sampleSize + 1) {
        rl.close();
      }
    });
    
    rl.on('close', () => {
      if (headerLine === null) {
        resolve({ valid: false, error: 'CSV file appears to be empty' });
        return;
      }
      
      const headers = parseCSVHeaders(headerLine);
      const headerCount = headers.length;
      const issues = [];
      
      // Check if any data rows have different field counts than the header
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const fields = parseCSVHeaders(row); // Reuse same parsing logic
        
        if (fields.length !== headerCount) {
          issues.push({
            row: i + 2, // +2 because 1-based index and header is row 1
            expectedFields: headerCount,
            actualFields: fields.length,
            message: `Row ${i + 2} has ${fields.length} fields but header has ${headerCount} fields`
          });
        }
      }
      
      resolve({
        valid: issues.length === 0,
        checked: dataRows.length,
        issues,
        headerCount
      });
    });
    
    rl.on('error', (err) => {
      reject(err);
    });
  });
  
  try {
    return await formatCheckPromise;
  } catch (err) {
    return {
      valid: false,
      error: `Error checking CSV format: ${err.message}`
    };
  }
}

/**
 * Validate CSV file with enhanced checks
 * @param {string} filePath Path to CSV file
 * @param {string[]} requiredHeaders Optional array of headers that must be present
 * @param {boolean} validateStructure Whether to validate data structure (default: true)
 * @returns {Promise<Object>} Validation result with success flag and optional error
 */
async function validateCsvFile(filePath, requiredHeaders = [], validateStructure = true) {
  // Sanitize the file path first
  const sanitizedPath = sanitizeFilePath(filePath);
  
  // Check if the sanitized path is different from the original
  // and warn about it if necessary
  const warnings = [];
  if (sanitizedPath !== filePath) {
    warnings.push('File path contained potentially unsafe characters and was sanitized.');
  }
  
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
    warnings.push('File does not have a .csv extension. Proceeding anyway, but this might cause issues.');
  }
  
  // Get file size
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileSize = (fs.statSync(sanitizedPath).size / 1024).toFixed(2) + ' KB';
  
  // Enhanced validation if requested
  const validationDetails = {
    headers: null,
    formatCheck: null
  };
  
  // Validate headers if required headers are provided
  if (requiredHeaders.length > 0) {
    const headerValidation = await validateCSVHeaders(sanitizedPath, requiredHeaders);
    validationDetails.headers = headerValidation;
    
    // Check if headers validation failed
    if (!headerValidation.valid) {
      if (headerValidation.error) {
        return {
          success: false,
          error: headerValidation.error,
          fileName,
          fileSize
        };
      }
      
      // If specific headers are missing, add warning or error
      if (headerValidation.missingHeaders && headerValidation.missingHeaders.length > 0) {
        const missingHeaders = headerValidation.missingHeaders.join(', ');
        return {
          success: false,
          error: `CSV file is missing required headers: ${missingHeaders}`,
          fileName,
          fileSize,
          warnings,
          validationDetails
        };
      }
    }
  }
  
  // Validate structure if requested
  if (validateStructure) {
    const formatCheck = await checkCSVFormatIssues(sanitizedPath);
    validationDetails.formatCheck = formatCheck;
    
    // Check if format validation failed
    if (!formatCheck.valid) {
      if (formatCheck.error) {
        return {
          success: false,
          error: formatCheck.error,
          fileName,
          fileSize,
          warnings,
          validationDetails
        };
      }
      
      // If specific format issues are found, add warning
      if (formatCheck.issues && formatCheck.issues.length > 0) {
        const issueMessages = formatCheck.issues.map(issue => issue.message);
        warnings.push(`CSV file has format issues: ${issueMessages.join('; ')}`);
      }
    }
  }
  
  // All validation passed
  return {
    success: true,
    fileName,
    fileSize,
    warnings: warnings.length > 0 ? warnings : null,
    warning: warnings.length > 0 ? warnings[0] : null, // For backward compatibility
    validationDetails: Object.keys(validationDetails).some(key => validationDetails[key] !== null) 
      ? validationDetails 
      : null
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
  sanitizeId,
  validateCSVHeaders,
  checkCSVFormatIssues,
  parseCSVHeaders,
  validateRequiredHeaders
};