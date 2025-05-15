# Vena ETL Tool

A command-line utility for interacting with Vena's ETL API. This tool allows you to upload CSV files, manage ETL jobs, and work with templates.

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
   
4. Edit the `.env` file with your Vena credentials:
   ```
   VENA_USERNAME=your_username
   VENA_PASSWORD=your_password
   VENA_TEMPLATE_ID=your_default_template_id
   VENA_API_URL=https://us2.vena.io
   ```

## Usage

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

## Logs

All activities are logged in the `logs` directory:

- `upload-history.jsonl`: Records of successful uploads
- `job-history.jsonl`: Job status checks and cancellations
- `api-history.jsonl`: Template listing and viewing operations
- `error.jsonl`: Error logs for all operations

## Project Structure

The tool is organized into the following modules:

```
vena-etl-tool/
├── src/
│   ├── auth/            # Authentication utilities
│   ├── api/             # API interaction modules
│   │   ├── templates.js # Template and upload operations
│   │   └── jobs.js      # Job status and management
│   ├── utils/           # Utility functions
│   │   ├── fileHandling.js # File operations
│   │   └── logging.js   # Logging functions
│   └── config.js        # Centralized configuration
├── import.js            # Main entry point
├── package.json
├── README.md
└── .env                 # Environment variables (not in repo)
```

## Security Notes

- Never commit your `.env` file containing credentials to version control
- Consider using a secure credential manager for production environments
- Regularly rotate your Vena API credentials

## Requirements

- Node.js version 14 or higher
- Active Vena account with API access

## Troubleshooting

If you encounter issues:

1. Check that your credentials in `.env` are correct
2. Verify that your CSV file is properly formatted
3. Ensure you have the correct template ID
4. Review the error logs in `logs/error.jsonl`

## Making the Script Executable (Unix/Linux/Mac)

To run the script directly without typing `node`:

```bash
chmod +x import.js
./import.js templates
```

## Development

### Adding New Features

To add new functionality:

1. Determine which module should contain the new feature
2. Add the necessary functions to the appropriate module
3. Update the main entry point (`import.js`) to expose the new command
4. Update the help text to document the new command

### Running Tests

```bash
npm test
```

## License

MIT

---

For more information on Vena's ETL API, please refer to the [Vena API documentation](https://developers.venasolutions.com).