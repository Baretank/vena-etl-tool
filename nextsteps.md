# Vena ETL Tool: Next Steps

This document outlines future improvements for the Vena ETL Tool, organized by priority.

## High Priority (Critical Functionality & Security)

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

## Medium Priority (Functionality Enhancements)

4. ✅ **Add Retry Logic for Failed Files** (COMPLETED)
   - Problem: If a file fails to upload in multi-import, the process continues without retrying.
   - Solution: Added retry mechanism for failed files with customizable retry count and backoff timing.
   - Impact: Improves reliability without requiring manual intervention.

5. **Add CSV Headers Validation** (ON HOLD pending final CSV file format)
   - Problem: Currently, CSV files are validated for existence and extension, but not for content structure.
   - Solution: Add optional validation for CSV headers against template requirements.
   - Impact: Prevents data import failures due to malformed files.

6. ✅ **Centralize Response Handling** (COMPLETED)
   - Problem: The code has similar response handling patterns repeated in multiple places.
   - Solution: Created a centralized response handler that's reused across API calls.
   - Impact: Reduces code duplication and improves consistency.

## Lower Priority (User Experience & Code Quality)

7. **Add Progress Tracking**
   - Problem: When uploading multiple files, there's no progress indicator.
   - Solution: Add a progress bar or counter showing completed/total uploads.
   - Impact: Improves user experience for large batch operations.

8. **Improve Error Objects**
   - Problem: Current error handling mainly logs messages but doesn't create structured error objects.
   - Solution: Use a more structured approach to error handling with error types and codes.
   - Impact: Makes debugging easier and error handling more consistent.

9. **Add JSDoc Comments**
   - Problem: While there are some function comments, they aren't in JSDoc format which could help with IDE integration.
   - Solution: Convert comments to JSDoc format for better tooling support.
   - Impact: Improves developer experience and documentation.

10. **Consider Using ES Modules**
    - Problem: The codebase uses CommonJS modules, but ES modules would provide better encapsulation.
    - Solution: Consider migrating to ES modules for better code organization.
    - Impact: Long-term code organization improvement, but requires significant refactoring.