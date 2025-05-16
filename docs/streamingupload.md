# Streaming Upload Implementation Plan for Vena ETL Tool

## Overview

This plan outlines how to modify your existing Vena ETL Tool to support streaming uploads for large files (5-50GB). I'll focus on minimizing memory usage while maintaining compatibility with Vena's API requirements.

## Phase 1: Core Streaming Implementation

### Step 1: Modify the `uploadFile` function in `src/api/templates.js`

```javascript
/**
 * Upload file to Vena using streaming approach
 * @param {string} csvFilePath Path to CSV file
 * @param {string} templateId Template ID
 * @param {string} fileName Filename for display and upload
 * @param {string} fileSize File size for display
 * @returns {Promise<Object>} Upload response
 */
async function uploadFile(csvFilePath, templateId, fileName, fileSize) {
  console.log(`Preparing to upload ${fileName} (${fileSize}) to Vena template ID: ${templateId}`);
  
  // Create form data
  const form = new FormData();
  
  // Create a readable stream instead of loading entire file
  const fileStream = fs.createReadStream(csvFilePath);
  
  form.append('file', fileStream, {
    filename: fileName,
    contentType: 'text/csv'
  });
  
  // Add metadata
  form.append('metadata', JSON.stringify({
    input: {
      partName: 'file',
      fileFormat: 'CSV',
      fileEncoding: 'UTF-8',
      fileName: fileName
    }
  }));
  
  const options = {
    method: 'POST',
    headers: getRequestHeaders(),
    body: form
  };
  
  console.log('Uploading file to Vena...');
  
  // Add timestamp for tracking upload duration
  const startTime = new Date();
  
  // Use centralized response handler with isUpload flag for specialized logging
  const data = await handleApiResponse(
    'upload-file',
    async () => {
      return await fetchWithRetry(
        `${config.api.baseUrl}/api/public/v1/etl/templates/${templateId}/startWithFile`, 
        options
      );
    },
    {
      fileName,
      templateId,
      fileSize
    },
    true // This is an upload operation
  );
  
  const endTime = new Date();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  console.log('✅ Success! File uploaded successfully.');
  console.log(`Upload completed in ${duration} seconds.`);
  
  return data;
}
```

### Step 2: Modify the `loadFileToStep` function in `src/api/multiImport.js`

```javascript
/**
 * Load file to a specific ETL step using streaming
 * @param {string} jobId Job ID
 * @param {string} inputId Input ID (step ID)
 * @param {string} filePath File path
 * @returns {Promise<void>} 
 */
async function loadFileToStep(jobId, inputId, filePath) {
  // Sanitize inputs to prevent injection and path traversal attacks
  const sanitizedJobId = sanitizeId(jobId);
  const sanitizedInputId = sanitizeId(inputId);
  const sanitizedFilePath = sanitizeFilePath(filePath);
  
  // Log warnings if sanitization changed any values
  if (sanitizedJobId !== jobId) {
    console.warn('Warning: Job ID contained potentially unsafe characters and was sanitized.');
  }
  
  if (sanitizedInputId !== inputId) {
    console.warn('Warning: Input ID contained potentially unsafe characters and was sanitized.');
  }
  
  if (sanitizedFilePath !== filePath) {
    console.warn('Warning: File path contained potentially unsafe characters and was sanitized.');
  }
  
  console.log(`Loading file to ETL step: Job ID ${sanitizedJobId}, Input ID ${sanitizedInputId}`);
  
  const fileName = path.basename(sanitizedFilePath);
  
  // Get file size without loading the file
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileSize = (fs.statSync(sanitizedFilePath).size / 1024).toFixed(2) + ' KB';
  
  console.log(`File: ${fileName} (${fileSize})`);
  
  // Create form data
  const form = new FormData();
  
  // Create a readable stream instead of loading the entire file
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileStream = fs.createReadStream(sanitizedFilePath);
  
  // Add metadata
  const metadata = {
    input: {
      partName: 'file',
      fileFormat: 'CSV',
      fileEncoding: 'UTF-8',
      fileName: fileName
    }
  };
  
  form.append('metadata', JSON.stringify(metadata));
  form.append('file', fileStream, {
    filename: fileName,
    contentType: 'text/csv'
  });
  
  // Create headers object
  let headers = getRequestHeaders();
  
  // Build options for request
  const options = {
    method: 'PUT',
    headers: {
      ...headers,
      ...form.getHeaders() // Add form-specific headers
    },
    body: form
  };
  
  // Use centralized retry operation for file upload
  // This endpoint returns 204 No Content, so we need special handling
  await retryOperation(
    async () => {
      const response = await fetch(
        `${config.api.baseUrl}/api/public/v1/etl/jobs/${sanitizedJobId}/inputs/${sanitizedInputId}/file`, 
        options
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      return response;
    },
    3, // Number of retries
    1000, // Initial backoff time
    (error) => {
      // Retry on network errors or server errors (5xx)
      const isNetworkError = error.message.includes('ECONNRESET') || 
                            error.message.includes('ETIMEDOUT') || 
                            error.message.includes('ECONNREFUSED');
      const isServerError = error.message.includes('HTTP error! Status: 5');
      return isNetworkError || isServerError;
    }
  );
  
  console.log('✅ File loaded to ETL step successfully');
  
  // Log the operation
  logUpload({
    jobId: sanitizedJobId,
    inputId: sanitizedInputId,
    fileName,
    fileSize,
    status: 'success'
  });
  
  return;
}
```

### Step 3: Update `fetchWithRetry` to handle streaming properly

```javascript
/**
 * Modified fetchWithRetry to handle streaming uploads
 * @param {string} url API URL
 * @param {Object} options Fetch options
 * @param {number} retries Number of retries
 * @param {number} backoff Backoff time in ms
 * @returns {Promise<Object>} API response as JSON
 */
async function fetchWithRetry(url, options, retries, backoff) {
  const retriesCount = retries ?? config.api.retryAttempts;
  const backoffTime = backoff ?? config.api.retryBackoff;
  
  // Use the centralized retry utility
  return await retryOperation(
    async () => {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        let errorDetails = '';
        try {
          // Try to get error details without assuming it's text
          errorDetails = await response.text();
        } catch (e) {
          errorDetails = 'No error details available';
        }
        throw new Error(`HTTP error! Status: ${response.status}, Details: ${errorDetails}`);
      }
      
      // Check if response is 204 No Content
      if (response.status === 204) {
        return { success: true };
      }
      
      return response.json();
    },
    retriesCount,
    backoffTime,
    (error) => {
      // Only retry on network errors or server errors (5xx)
      const isNetworkError = error.message.includes('ECONNRESET') || 
                          error.message.includes('ETIMEDOUT') ||
                          error.message.includes('ECONNREFUSED');
      const isServerError = error.message.includes('HTTP error! Status: 5');
      return isNetworkError || isServerError;
    }
  );
}
```

## Phase 2: Implement Timeout Configuration and Monitoring

### Step 1: Update `config.js` to include timeout settings

Add these items to your configuration:

```javascript
// Add to config object
api: {
  // ... existing settings
  uploadTimeout: parseInt(process.env.VENA_UPLOAD_TIMEOUT) || 3600000, // 1 hour default
  progressInterval: parseInt(process.env.VENA_PROGRESS_INTERVAL) || 30000, // 30 seconds
},
```

### Step 2: Add progress reporting to uploads

Enhance the `uploadFile` function with progress reporting for large files:

```javascript
// Add this function to src/utils/logging.js
/**
 * Log upload progress
 * @param {Object} data Upload progress details
 */
function logUploadProgress(data) {
  console.log(`Upload progress: ${data.bytesUploaded} bytes (${data.percentage}%) uploaded`);
  
  // Log to file
  ensureLogDirectory();
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...data
  };
  const logPath = path.join(config.logging.directory, 'upload-progress.jsonl');
  
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
}

// Add to module.exports
module.exports = {
  // ... existing exports
  logUploadProgress
};
```

## Phase 3: Testing and Validation

### Step 1: Create a test script for validating streaming uploads

```javascript
// test-streaming-upload.js
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { uploadFile } = require('./src/api/templates');
const { config, validateConfig } = require('./src/config');

// Validate configuration
validateConfig();

async function testStreamingUpload() {
  try {
    // Default to template ID from config if not provided
    const templateId = config.api.defaultTemplateId;
    
    if (!templateId) {
      console.error('Error: No template ID provided in .env (VENA_TEMPLATE_ID)');
      process.exit(1);
    }
    
    // Create a large test file if it doesn't exist
    const testFilePath = path.join(__dirname, 'test-large-file.csv');
    const testFileSize = 100 * 1024 * 1024; // 100MB for testing
    
    if (!fs.existsSync(testFilePath)) {
      console.log(`Creating test file of ${testFileSize / (1024 * 1024)}MB...`);
      
      // Create a writable stream
      const stream = fs.createWriteStream(testFilePath);
      
      // Generate CSV header
      stream.write('column1,column2,column3,column4,column5\n');
      
      // Generate random data rows
      const rowSize = 1000; // Approximate bytes per row
      const rowCount = Math.floor(testFileSize / rowSize);
      
      for (let i = 0; i < rowCount; i++) {
        // Generate random data for each row
        const row = `data${i},value${Math.random()},${Date.now()},test,sample\n`;
        stream.write(row);
        
        // Progress reporting
        if (i % 10000 === 0) {
          console.log(`Generated ${i} rows...`);
        }
      }
      
      // Close the stream
      stream.end();
      console.log('Test file created successfully');
    }
    
    console.log('Starting streaming upload test...');
    const result = await uploadFile(
      testFilePath, 
      templateId,
      path.basename(testFilePath),
      `${testFileSize / (1024 * 1024)} MB`
    );
    
    console.log('Upload result:', result);
    console.log('Test completed successfully');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testStreamingUpload();
```

### Step 2: Implement a small file test validation

```javascript
// Create a helper to validate streaming vs. buffer approaches
async function compareUploadMethods() {
  const smallFile = path.join(__dirname, 'test-small-file.csv');
  const fileSize = '10 KB';
  
  // Create a 10KB test file
  if (!fs.existsSync(smallFile)) {
    const stream = fs.createWriteStream(smallFile);
    stream.write('header1,header2,header3\n');
    
    for (let i = 0; i < 300; i++) {
      stream.write(`value${i},data${i},test${i}\n`);
    }
    
    stream.end();
  }
  
  const templateId = config.api.defaultTemplateId;
  
  console.log('Testing buffered upload...');
  // Call the original (buffered) upload function
  const oldBufferedUpload = /* save original function */;
  
  const startBuffer = process.memoryUsage().heapUsed;
  await oldBufferedUpload(smallFile, templateId, path.basename(smallFile), fileSize);
  const endBuffer = process.memoryUsage().heapUsed;
  
  console.log('Testing streaming upload...');
  const startStream = process.memoryUsage().heapUsed;
  await uploadFile(smallFile, templateId, path.basename(smallFile), fileSize);
  const endStream = process.memoryUsage().heapUsed;
  
  console.log(`Buffered upload memory usage: ${(endBuffer - startBuffer) / 1024 / 1024} MB`);
  console.log(`Streaming upload memory usage: ${(endStream - startStream) / 1024 / 1024} MB`);
}
```

## Implementation Timeline and Strategy

1. **Initial Testing Phase** 
   - Create a branch for development
   - Implement streaming for the `uploadFile` function
   - Test with progressively larger files
   - Validate memory usage patterns

2. **Core Implementation** 
   - Update all file upload functions to use streaming
   - Implement robust error handling for streaming-specific issues
   - Add progress reporting and monitoring

3. **Integration and Testing** 
   - Test with Vena API to verify compatibility
   - Run memory profiling during large uploads
   - Add timeouts and cleanup for aborted uploads
   - Document memory usage patterns

4. **Production Deployment** 
   - Finalize configuration settings for production
   - Create deployment documentation
   - Add monitoring for production uploads

## Potential Challenges and Mitigations

1. **Vena API Compatibility**
   - If Vena doesn't support streaming uploads, implement chunking
   - Fall back to temporary file storage for very large files

2. **Network Interruptions**
   - Enhance retry mechanism to handle interruptions during streaming
   - Implement partial upload resumption if supported by Vena

3. **Memory Leaks**
   - Set up memory monitoring during uploads
   - Implement cleanup on upload failures

4. **Timeouts**
   - Configure appropriate timeouts for very large files
   - Add heartbeat/progress tracking for long uploads

This implementation plan preserves all the security features of your original code while significantly reducing memory usage for large file uploads.