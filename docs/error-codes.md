# Vena ETL Tool: Error Catalog

This document provides a comprehensive list of error codes, their meaning, and recommended resolution steps.

## Error Classification

Errors in the Vena ETL Tool are classified into the following categories:

| Category   | Description                                      |
|------------|--------------------------------------------------|
| NETWORK    | Network connectivity and transmission issues     |
| SERVER     | Server-side problems at Vena                     |
| AUTH       | Authentication and authorization failures        |
| VALIDATION | Input validation failures                        |
| FILE_SYSTEM| File access and permission errors                |
| STREAM     | Stream handling errors during upload             |
| TIMEOUT    | Operation timeout issues                         |
| ABORT      | User or system abort actions                     |
| UNKNOWN    | Unclassified errors                             |

## Error Types and Resolution Steps

### Network Errors

| Error Code             | Description                                       | Resolution Steps                                                                                 |
|------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------------|
| connection_reset       | The connection was reset by the server            | 1. Check network connectivity<br>2. Verify VPN status<br>3. Retry the operation after a delay   |
| connection_refused     | The server refused the connection                 | 1. Verify Vena API URL is correct<br>2. Check if there's a network block<br>3. Contact Vena support|
| timeout                | Operation timed out                               | 1. Check for network congestion<br>2. Increase timeout setting for large files<br>3. Try smaller chunks|
| dns_lookup_failed      | Failed to resolve hostname                        | 1. Check DNS settings<br>2. Verify the API URL is correct<br>3. Check network connectivity      |

### Server Errors

| Error Code             | Description                                       | Resolution Steps                                                                                 |
|------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------------|
| server_error           | Server encountered an error (5xx response)        | 1. Check status at status.vena.io<br>2. Retry after a delay<br>3. Contact Vena support          |
| service_unavailable    | Service temporarily unavailable                   | 1. Check for scheduled maintenance<br>2. Retry after a delay<br>3. Contact Vena support         |
| rate_limited           | Too many requests (429)                           | 1. Reduce concurrency<br>2. Implement progressive backoff<br>3. Spread operations over time     |

### Authentication Errors

| Error Code             | Description                                       | Resolution Steps                                                                                 |
|------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------------|
| unauthorized           | Invalid credentials (401/403)                     | 1. Verify username and password<br>2. Check token expiration<br>3. Verify permission for templates|
| token_expired          | Authentication token has expired                  | 1. Re-authenticate to obtain a new token<br>2. Consider implementing auto-refresh of tokens      |

### Validation Errors

| Error Code             | Description                                       | Resolution Steps                                                                                 |
|------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------------|
| invalid_input          | Input data doesn't meet requirements              | 1. Check the error message for specifics<br>2. Validate against template specification<br>3. Fix data|
| missing_parameter      | Required parameter is missing                     | 1. Check configuration for missing parameters<br>2. Ensure all required fields are provided      |
| invalid_format         | File format is invalid or corrupt                 | 1. Verify CSV format with headers and proper data<br>2. Use validators to check CSV structure    |

### File System Errors

| Error Code             | Description                                       | Resolution Steps                                                                                 |
|------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------------|
| file_not_found         | File does not exist at specified path             | 1. Verify file path<br>2. Check if file was deleted/moved<br>3. Ensure correct path separators   |
| permission_denied      | Insufficient permissions to access file           | 1. Check file permissions<br>2. Ensure application has read access<br>3. Try running as admin (Windows)|
| file_too_large         | File exceeds size limits                          | 1. Check if file exceeds Vena limits<br>2. Split into smaller files<br>3. Ensure memory settings|
| file_in_use            | File is locked by another process                 | 1. Close other applications using the file<br>2. Wait for file to be released<br>3. Make a copy  |
| directory_not_found    | Directory does not exist                          | 1. Verify directory path<br>2. Create directory if needed<br>3. Check path separators           |
| is_directory           | Path points to a directory instead of a file      | 1. Provide path to a file, not a directory<br>2. Check path construction                         |

### Stream Errors

| Error Code             | Description                                       | Resolution Steps                                                                                 |
|------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------------|
| stream_closed          | Stream was closed unexpectedly                    | 1. Check for network interruptions<br>2. Look for canceled operations<br>3. Retry the operation  |
| broken_pipe            | Connection was broken during transmission         | 1. Check network stability<br>2. Retry with smaller chunk size<br>3. Enable resilient uploads   |
| stream_aborted         | Stream was aborted by user or system              | 1. If manual abort, this is expected<br>2. If system abort, check for errors<br>3. Retry upload |

### Abort Errors

| Error Code             | Description                                       | Resolution Steps                                                                                 |
|------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------------|
| user_abort             | Operation was manually aborted by user            | 1. This is normal if you canceled<br>2. If unintended, check for abort signals in code          |
| system_abort           | Operation was aborted by the system               | 1. Check for timeout settings<br>2. Look for system signals (SIGINT, SIGTERM)<br>3. Check logs  |

## Common Error Scenarios and Solutions

### Upload Failures

If file upload fails consistently:

1. **Check File Size**: Large files may need streaming uploads with proper memory settings
2. **Verify Network**: Ensure stable connection, especially for large files
3. **Check Headers**: CSV headers must match template requirements
4. **Adaptive Backpressure**: Enable adaptive backpressure for better reliability
5. **Memory Settings**: Adjust memory settings for large files

### Authentication Issues

If authentication fails:

1. **Credential Check**: Verify username and password in .env file
2. **API URL**: Ensure correct Vena instance URL (e.g., us1.vena.io vs us2.vena.io)
3. **Token Expiration**: Look for token expiration in logs
4. **Permissions**: Verify user has permission to access templates

### Template Issues

If template operations fail:

1. **Template ID**: Verify template ID is correct
2. **Permissions**: Ensure user has access to the template
3. **Headers**: CSV headers must match template requirements
4. **Required Fields**: Check if all required fields are present

## Enabling Detailed Error Reporting

For more detailed error information during troubleshooting:

1. Set `DEBUG=true` in .env file or environment variables
2. Check logs in the application's log directory
3. For streaming issues, enable memory monitoring and adaptive backpressure

## Getting Support

If you're unable to resolve an error:

1. Collect relevant logs including error details
2. Note exact steps to reproduce the issue
3. Note the error type and category (from this document)
4. Contact Vena support with this information

## Error Monitoring and Reporting

The application logs all errors with detailed context. Key information logged includes:

- Error type and category
- Operation being performed
- File details (for upload operations)
- HTTP status codes (for API operations)
- Stack traces (in debug mode)

These logs can be found in the application's log directory and are crucial for troubleshooting persistent issues.