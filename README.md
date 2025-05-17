# Vena ETL Tool

A command-line utility for interacting with Vena's ETL API. This tool allows you to upload CSV files, manage ETL jobs, and work with templates.

## Features

- **Single File Upload**: Upload individual CSV files to Vena
- **Template Management**: List and view details of ETL templates
- **Job Management**: Check status and cancel ETL jobs
- **Multi-File Upload**: Upload multiple files in a single run using pattern matching
- **Multi-Step ETL Process Support**: Handle complex ETL processes
- **Environment-Based Configuration**: Configure file mappings in your `.env` file
- **Windows Task Scheduler Integration**: Automate imports on a schedule
- **Input Validation**: Validate required inputs before starting ETL jobs to prevent failures
- **Automatic Retry Logic**: Handle network issues with automatic retries and exponential backoff
- **Enhanced Security**: Input sanitization to prevent injection vulnerabilities
- **Streaming Upload Support**: Memory-efficient handling of large files (5-50GB) with progress tracking
- **Adaptive Backpressure**: Smart adjustment of upload speeds based on network conditions
- **Memory Monitoring**: Active monitoring and management of memory usage during large uploads
- **Graceful Termination**: Clean handling of process interruptions and shutdowns
- **Stall Detection**: Identification and reporting of stalled uploads
- **Enhanced Error Classification**: Detailed error types for better troubleshooting

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/vena-etl-tool.git
   cd vena-etl-tool
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with your credentials:
   ```bash
   cp .env.example .env
   ```
   
4. Edit the `.env` file with your Vena credentials and configuration:
   ```
   # Basic Authentication
   VENA_USERNAME=your_username
   VENA_PASSWORD=your_password
   VENA_API_URL=https://us2.vena.io
   
   # Default template (used by the original import.js)
   VENA_TEMPLATE_ID=your_default_template_id
   
   # Multi-import configuration (optional)
   # See "Multi-Import Configuration" section below
   
   # Streaming Upload Configuration
   VENA_UPLOAD_TIMEOUT=3600000  # Upload timeout in milliseconds (1 hour default)
   VENA_PROGRESS_INTERVAL=30000 # Progress reporting interval in milliseconds (30 seconds default)
   ```

## Basic Usage (Single File Import)

### List Available Templates

View all templates that you can use for uploading data:

```bash
node import.js templates
```

### View Template Details

Get detailed information about a specific template:

```bash
node import.js template <template-id>
```

### Upload a CSV File

Upload a CSV file to Vena using a specific template:

```bash
node import.js upload path/to/your/file.csv <template-id>
```

If you've set a default template ID in your `.env` file, you can omit the template ID:

```bash
node import.js upload path/to/your/file.csv
```

### Check Job Status

After uploading a file, you can check the status of the job:

```bash
node import.js status <job-id>
```

### Cancel a Job

If needed, you can cancel a running job:

```bash
node import.js cancel <job-id>
```

### Get Help

For detailed usage instructions:

```bash
node import.js help
```

## Multi-Import Usage

The multi-import functionality allows you to upload multiple files in a single run based on pattern matching and configuration defined in your `.env` file.

### Multi-Import Configuration

Update your `.env` file to include the following variables:

```
# Source directory for CSV files
VENA_SOURCE_DIRECTORY=C:/path/to/csv/files

# File Mapping 1
VENA_FILE_PATTERN_1=revenue_*.csv
VENA_TEMPLATE_ID_1=template_id_for_revenue
VENA_PROCESS_TYPE_1=single

# File Mapping 2
VENA_FILE_PATTERN_2=FY*_UTILIZATION.csv
VENA_TEMPLATE_ID_2=template_id_for_utilization
VENA_PROCESS_TYPE_2=single

# File Mapping 3 (multi-step process)
VENA_FILE_PATTERN_3=expenses_*.csv
VENA_TEMPLATE_ID_3=template_id_for_expenses
VENA_PROCESS_TYPE_3=multi

# Steps for mapping 3
VENA_STEP_INPUT_ID_3_1=step1_input_id
VENA_STEP_FILE_PATTERN_3_1=expenses_step1_*.csv
VENA_STEP_INPUT_ID_3_2=step2_input_id
VENA_STEP_FILE_PATTERN_3_2=expenses_step2_*.csv

# Scheduling Configuration
VENA_SCHEDULE_MINUTE=0
VENA_SCHEDULE_HOUR=5
VENA_SCHEDULE_DAY=1
VENA_SCHEDULE_MONTH=*
VENA_SCHEDULE_DAYOFWEEK=*
```

### Running Multi-Import

To run the import process using your .env configuration:

```bash
node multi_import.js run
```

This will:
1. Read the configuration from your .env file
2. Look for files matching your patterns in the source directory
3. Upload each file to its corresponding template
4. For multi-step processes, create ETL jobs and upload files to each step
5. Submit all jobs for processing

### Setting Up Scheduled Tasks

To create a Windows scheduled task:

```bash
node multi_import.js schedule
```

This will create the necessary batch file and task definition to run the import automatically according to the schedule defined in your .env file.

### Get Multi-Import Help

For detailed multi-import usage instructions:

```bash
node multi_import.js help
```

## Streaming Upload Support

The tool uses a streaming approach to efficiently handle very large files (5-50GB) with minimal memory usage.

### Key Benefits

- **Memory Efficiency**: Files are processed as streams rather than loaded entirely into memory
- **Adaptive Backpressure**: Intelligently adjusts file reading speed based on historical upload rates
- **Progress Tracking**: Real-time display of upload progress, speed, and estimated completion time
- **Large File Support**: Reliably handle files of any size without running out of memory
- **Stall Detection**: Identifies and reports stalled uploads with detailed diagnostics
- **Memory Monitoring**: Actively monitors memory usage and applies emergency backpressure when needed
- **Graceful Termination**: Ensures proper cleanup of resources during process termination
- **Enhanced Error Classification**: Detailed categorization of errors for better troubleshooting
- **Detailed Network Metrics**: Tracking of both read and actual sent bytes for network latency measurement
- **Improved Time Estimates**: More accurate time remaining calculations based on historical upload rates
- **Configurable**: Extensive configuration options with sensible defaults

### Progress Tracking

During file uploads, you'll see enhanced progress information displaying:

- Bytes uploaded and total file size
- Upload percentage complete 
- Current upload speed (calculated from recent history for accuracy)
- Elapsed time
- Estimated time remaining (with improved calculation algorithm)
- Stall detection indicators
- Network latency measurements

Example output:
```
Upload progress: 104857600 bytes (10%) uploaded
Upload speed: 2.34 MB/s
Elapsed time: 42s
Estimated time remaining: 6m 18s
Bytes actually sent: 98304000 bytes (Network latency: 6.25 MB)
```

In addition, you'll see network and memory diagnostics when relevant:
```
Applying adaptive backpressure: Current rate 1.21 MB/s is below threshold
Adaptive backoff: 3200ms (severity factor: 1.60)

Memory warning: 1.03 GB total, 756.45 MB heap used
Peak memory usage: RSS 1.42 GB, Heap 843.72 MB
```

### Memory Usage Comparison

Streaming significantly reduces memory requirements for large files:

| File Size | Non-Streaming | Streaming   |
|-----------|---------------|-------------|
| 100MB     | ~110MB        | ~25MB       |
| 1GB       | ~1.1GB        | ~30MB       |
| 5GB       | OOM Error     | ~35MB       |

### Testing Streaming Performance

A test script is included to validate streaming performance:

```bash
# Test with a 10MB file (default)
node test-streaming-upload.js

# Test with a specific file size (e.g., 100MB)
node test-streaming-upload.js 100
```

## Finding Template IDs and Input IDs

For each mapping in multi-import, you need to specify the correct Vena template ID:

1. To find your template IDs, run:
   ```bash
   node import.js templates
   ```

2. For multi-step processes, you also need the Step Input IDs:
   ```bash
   node import.js template <template-id>
   ```
   Look for the `inputId` fields in the response.

## Scheduling Configuration

The schedule is configured in your .env file using these variables:

```
VENA_SCHEDULE_MINUTE=0      # Minute (0-59)
VENA_SCHEDULE_HOUR=5        # Hour (0-23)
VENA_SCHEDULE_DAY=1         # Day of month (1-31)
VENA_SCHEDULE_MONTH=*       # Month (1-12 or *)
VENA_SCHEDULE_DAYOFWEEK=*   # Day of week (0-6, 0=Sunday or *)
```

Examples:
- Monthly (1st day at 5:00 AM): MINUTE=0, HOUR=5, DAY=1, MONTH=*, DAYOFWEEK=*
- Weekly (Every Monday at noon): MINUTE=0, HOUR=12, DAY=*, MONTH=*, DAYOFWEEK=1
- Daily (8:30 AM every day): MINUTE=30, HOUR=8, DAY=*, MONTH=*, DAYOFWEEK=*

## File Pattern Matching

File patterns in multi-import use a simple wildcard syntax:

- `*` matches any sequence of characters
- Examples:
  - `revenue_*.csv` matches files like `revenue_q1.csv`, `revenue_q2.csv`, etc.
  - `FY24_*.csv` matches files like `FY24_UTILIZATION.csv`, `FY24_REVENUE.csv`, etc.

## Environment Variable Reference

Here's a comprehensive list of all environment variables used by the tool:

1. **Basic Configuration**:
   - `VENA_USERNAME`: Your Vena username
   - `VENA_PASSWORD`: Your Vena password
   - `VENA_API_URL`: Vena API URL (default: https://us2.vena.io)
   - `VENA_TEMPLATE_ID`: Default template ID for single file uploads
   - `VENA_RETRY_ATTEMPTS`: Number of retry attempts for API calls (default: 3)
   - `VENA_RETRY_BACKOFF`: Initial backoff time in milliseconds (default: 300)

2. **Streaming Upload Configuration**:
   - `VENA_UPLOAD_TIMEOUT`: Timeout for uploads in milliseconds (default: 3600000)
   - `VENA_PROGRESS_INTERVAL`: Progress reporting interval in milliseconds (default: 30000)
   - `VENA_STREAM_CHUNK_SIZE`: Stream chunk size in bytes (default: 262144)
   - `VENA_ABORT_ON_TIMEOUT`: Whether to abort uploads on timeout (default: true)
   
   **Backpressure Settings**:
   - `VENA_MEMORY_THRESHOLD`: Threshold for buffer size before activating backpressure (default: 100MB)
   - `VENA_MIN_UPLOAD_RATE`: Minimum upload rate before pausing stream (default: 5MB/s)
   - `VENA_STREAM_BACKOFF`: Delay time in ms before resuming paused streams (default: 2000)
   
   **Adaptive Backpressure Settings**:
   - `VENA_ADAPTIVE_BACKPRESSURE`: Enable adaptive backpressure (default: true)
   - `VENA_ADAPTIVE_THRESHOLD_FACTOR`: Apply backpressure when rate drops below this percentage of average (default: 0.7)
   - `VENA_ADAPTIVE_BACKOFF_MIN`: Minimum backoff time multiplier (default: 0.5)
   - `VENA_ADAPTIVE_BACKOFF_MAX`: Maximum backoff time multiplier (default: 2.0)
   
   **Stall Detection Settings**:
   - `VENA_STALL_DETECTION`: Enable upload stall detection (default: true)
   - `VENA_STALL_THRESHOLD`: Number of intervals with no progress before considering stalled (default: 3)
   
   **Memory Monitoring Settings**:
   - `VENA_MEMORY_MONITORING`: Enable memory usage monitoring (default: true)
   - `VENA_MEMORY_WARNING_THRESHOLD`: Memory warning threshold in bytes (default: 1GB)
   - `VENA_MEMORY_CRITICAL_THRESHOLD`: Memory critical threshold in bytes (default: 1.5GB)
   - `VENA_MEMORY_CHECK_INTERVAL`: Memory check interval in milliseconds (default: 5000)

3. **Multi-Import Configuration**:
   - `VENA_SOURCE_DIRECTORY`: Path to the CSV files
   - `VENA_FILE_PATTERN_N`: File pattern for mapping N
   - `VENA_TEMPLATE_ID_N`: Template ID for mapping N
   - `VENA_PROCESS_TYPE_N`: "single" or "multi" for mapping N

4. **Multi-Step Process**:
   - `VENA_STEP_INPUT_ID_N_M`: Input ID for step M of mapping N
   - `VENA_STEP_FILE_PATTERN_N_M`: File pattern for step M of mapping N

5. **Scheduling**:
   - `VENA_SCHEDULE_MINUTE`: Minute (0-59)
   - `VENA_SCHEDULE_HOUR`: Hour (0-23)
   - `VENA_SCHEDULE_DAY`: Day of month (1-31)
   - `VENA_SCHEDULE_MONTH`: Month (1-12 or *)
   - `VENA_SCHEDULE_DAYOFWEEK`: Day of week (0-6, 0=Sunday or *)

## Logs

All activities are logged in the `logs` directory:

- `upload-history.jsonl`: Records of successful uploads
- `job-history.jsonl`: Job status checks and cancellations
- `api-history.jsonl`: Template listing and viewing operations
- `error.jsonl`: Error logs for all operations
- `upload-progress.jsonl`: Detailed upload progress for streaming uploads

When using the scheduler, a separate `import_log.txt` file is created in the root directory.

## Project Structure

The tool is organized into the following modules:

```
vena-etl-tool/
├── src/
│   ├── auth/                   # Authentication utilities
│   │   └── index.js            # Handles credential management and authentication
│   ├── api/                    # API interaction modules
│   │   ├── templates.js        # Template and upload operations
│   │   ├── jobs.js             # Job status and management
│   │   └── multiImport.js      # Multi-step ETL operations
│   ├── scheduler/              # Scheduling utilities
│   │   └── windowsTaskScheduler.js  # Windows task scheduling
│   ├── utils/                  # Utility functions
│   │   ├── fileHandling.js     # File operations and validation
│   │   ├── logging.js          # Logging functions
│   │   ├── progressTracker.js  # Upload progress tracking with stall detection
│   │   ├── uploadController.js # Manages upload abort handling and timeouts
│   │   ├── monitoredFormData.js # Enhanced form-data with monitoring capabilities
│   │   ├── memoryMonitor.js    # Memory usage monitoring during uploads
│   │   ├── terminationHandler.js # Graceful process termination management
│   │   └── apiResponse.js      # Centralized API response and error handling
│   └── config.js               # Centralized configuration
├── import.js                  # Single file import entry point
├── multi_import.js            # Multi-file import entry point
├── test-streaming-upload.js   # Streaming upload test script
├── run_vena_import.bat        # Batch file for scheduled runs
├── package.json
├── README.md
└── .env                       # Environment variables (not in repo)
```

## Security Notes

- Never commit your `.env` file containing credentials to version control
- Consider using a secure credential manager for production environments
- Regularly rotate your Vena API credentials
- All inputs are sanitized to prevent injection attacks
- Input validation happens before any ETL job is created
- File paths are validated and sanitized to prevent path traversal attacks

## Error Handling and Retry Mechanism

The tool includes robust error handling and automatic retry capabilities:

- **Automatic Retries**: All API calls automatically retry on transient failures (network issues, server errors)
- **Exponential Backoff**: Retries use increasing wait times to avoid overwhelming the server
- **Failed Files Tracking**: When running multi-import, the tool tracks and reports any files that failed after all retry attempts
- **Detailed Error Logging**: All errors are logged with comprehensive details to aid troubleshooting
- **Input Validation**: Pre-validation of multi-step processes ensures all required files exist before creating a job

You can configure the retry behavior using these environment variables:
- `VENA_RETRY_ATTEMPTS`: Number of retry attempts (default: 3)
- `VENA_RETRY_BACKOFF`: Initial backoff time in milliseconds (default: 300)

## Troubleshooting

If you encounter issues:

1. Check that your credentials in `.env` are correct
2. Verify that your CSV file is properly formatted
3. Ensure you have the correct template ID
4. For multi-import, make sure your file patterns match the actual files
5. Review the logs for detailed error messages
6. Adjust retry settings if you're experiencing network reliability issues
7. For large file uploads, check the upload progress logs and consider increasing the timeout settings

### Memory Issues

If you're experiencing memory problems with large files:
- Ensure you're using the latest version with enhanced streaming support and memory monitoring
- Check that your Node.js version is 14 or higher
- The enhanced adaptive backpressure implementation should handle files of any size without memory issues
- Monitor the memory usage reports during uploads to identify potential problems
- Adjust the following settings to optimize for your specific environment:
  - `VENA_MEMORY_THRESHOLD`: Lower for slower networks or less RAM
  - `VENA_MIN_UPLOAD_RATE`: Adjust based on your network speed
  - `VENA_ADAPTIVE_THRESHOLD_FACTOR`: Lower (e.g., 0.5) for more aggressive backpressure
  - `VENA_MEMORY_WARNING_THRESHOLD`: Set based on your system's available RAM
  - `VENA_MEMORY_CRITICAL_THRESHOLD`: Set to prevent out-of-memory conditions
- For truly massive files (>50GB), consider adjusting Node.js memory limits: `node --max-old-space-size=4096 import.js ...`

### Network Issues

If you're experiencing network-related problems:
- Enable the adaptive backpressure feature (enabled by default)
- Check for stalled uploads in the progress output
- Monitor the network latency metric to identify potential bandwidth limitations
- For highly variable networks (like cellular or shared Wi-Fi), adjust:
  - `VENA_ADAPTIVE_BACKOFF_MAX`: Increase for more aggressive backoff on unstable networks
  - `VENA_STALL_THRESHOLD`: Lower for faster detection of stalled uploads
  - `VENA_PROGRESS_INTERVAL`: Lower for more frequent progress updates and stall detection
  
### Process Termination

If the process is interrupted or prematurely terminated:
- The graceful termination handler ensures resources are properly cleaned up
- Check the logs for any aborted uploads
- For scheduled tasks, ensure proper handling of termination signals
- The upload history logs should provide information about any incomplete uploads

## Making the Script Executable (Unix/Linux/Mac)

To run the script directly without typing `node`:

```bash
chmod +x import.js
chmod +x multi_import.js
./import.js templates
```

## Requirements

- Node.js version 14 or higher
- Active Vena account with API access

## License

MIT

---

For more information on Vena's ETL API, please refer to the [Vena API documentation](https://developers.venasolutions.com).