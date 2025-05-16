# Vena ETL Tool: Next Steps

This document outlines future improvements for the Vena ETL Tool, organized by priority.

## Completed Changes

1. ✅ **Input Validation for Step Configuration** (COMPLETED)
   - Problem: The multi-import functionality doesn't validate if all required step inputs have matching files.
   - Solution: Added validation to check if all required inputs have files before starting the ETL job.
   - Impact: Prevents job failures mid-process and improves reliability.

2. ✅ **Add Input Sanitization** (COMPLETED)
   - Problem: User inputs like file paths and IDs aren't sanitized before use.
   - Solution: Added proper input sanitization to prevent injection vulnerabilities.
   - Impact: Critical security improvement to mitigate potential security risks.

3. ✅ **Enhance Environment Variable Validation** (COMPLETED)
   - Problem: The environment variable validation is minimal.
   - Solution: Added more robust validation with clear error messages for missing/invalid variables.
   - Impact: Improves system reliability and user experience during setup.

4. ✅ **Add Retry Logic for Failed Files** (COMPLETED)
   - Problem: If a file fails to upload in multi-import, the process continues without retrying.
   - Solution: Added retry mechanism for failed files with customizable retry count and backoff timing.
   - Impact: Improves reliability without requiring manual intervention.

6. ✅ **Centralize Response Handling** (COMPLETED)
   - Problem: The code has similar response handling patterns repeated in multiple places.
   - Solution: Created a centralized response handler that's reused across API calls.
   - Impact: Reduces code duplication and improves consistency.

## High Priority (Critical Functionality & Security)

11. **Implement Streaming Upload for Large Files**
    - Problem: The current implementation loads entire files into memory, which fails with large files (5-50GB).
    - Solution: Modify the upload functions to use streams instead of loading entire files at once.
    - Impact: Enables handling of much larger files with minimal memory usage.

12. **Add Upload Timeout Configuration**
    - Problem: Long-running uploads may time out without proper configuration.
    - Solution: Add configurable timeouts with reasonable defaults for large file uploads.
    - Impact: Prevents upload failures for large files and improves reliability.

## Medium Priority (Functionality Enhancements)

5. **Add CSV Headers Validation** (ON HOLD pending final CSV file format)
   - Problem: Currently, CSV files are validated for existence and extension, but not for content structure.
   - Solution: Add optional validation for CSV headers against template requirements.
   - Impact: Prevents data import failures due to malformed files.

7. **Add Progress Tracking**
   - Problem: When uploading multiple files, there's no progress indicator.
   - Solution: Add a progress bar or counter showing completed/total uploads.
   - Impact: Improves user experience for large batch operations.

8. **Improve Error Objects**
   - Problem: Current error handling mainly logs messages but doesn't create structured error objects.
   - Solution: Use a more structured approach to error handling with error types and codes.
   - Impact: Makes debugging easier and error handling more consistent.

13. **Add Upload Progress Reporting**
    - Problem: For large file uploads, there's no visibility into progress until completion.
    - Solution: Implement progress reporting during uploads with customizable intervals.
    - Impact: Improves user experience and monitoring capability for large file operations.

14. **Enhance Retry Mechanism for Streaming Uploads**
    - Problem: Network interruptions during large streaming uploads need specialized handling.
    - Solution: Enhance retry logic to handle interruptions during streaming operations.
    - Impact: Makes large file uploads more resilient to network issues.

## Lower Priority (User Experience & Code Quality)

9. **Add JSDoc Comments**
   - Problem: While there are some function comments, they aren't in JSDoc format which could help with IDE integration.
   - Solution: Convert comments to JSDoc format for better tooling support.
   - Impact: Improves developer experience and documentation.

10. **Consider Using ES Modules**
    - Problem: The codebase uses CommonJS modules, but ES modules would provide better encapsulation.
    - Solution: Consider migrating to ES modules for better code organization.
    - Impact: Long-term code organization improvement, but requires significant refactoring.

15. **Create Test Scripts for Streaming Uploads**
    - Problem: Need validation that streaming uploads work correctly with various file sizes.
    - Solution: Create test scripts that generate test files and validate the streaming approach.
    - Impact: Ensures reliability and identifies memory usage patterns.

16. **Add Memory Usage Monitoring**
    - Problem: No visibility into memory consumption during large file operations.
    - Solution: Implement memory usage tracking and logging during uploads.
    - Impact: Helps identify potential memory leaks and optimize performance.