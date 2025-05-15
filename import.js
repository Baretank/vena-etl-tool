#!/usr/bin/env node

/**
 * Vena ETL Tool - Main entry point
 * Command-line utility for interacting with Vena's ETL API
 */

// Core modules
const path = require('path');

// Configuration
const { config, validateConfig } = require('./src/config');

// API modules
const { listTemplates, getTemplateDetails, uploadFile } = require('./src/api/templates');
const { checkJobStatus, cancelJob } = require('./src/api/jobs');

// Utilities
const { validateCsvFile } = require('./src/utils/fileHandling');

// Validate configuration
validateConfig();

// Parse command-line arguments
const args = process.argv.slice(2);
let command = 'upload'; // Default command

// Handle commands
if (args.length > 0 && ['upload', 'status', 'cancel', 'templates', 'template', 'help'].includes(args[0])) {
  command = args[0];
  args.shift(); // Remove the command from args
}

// Display help
if (command === 'help' || args.includes('--help') || args.includes('-h')) {
  console.log(`
Vena ETL Tool
============

Usage: 
  node import.js [command] [options]

Commands:
  upload <file-path> [template-id]  Upload a CSV file to Vena (default)
  status <job-id>                   Check the status of a specific job
  cancel <job-id>                   Cancel a running job
  templates                         List all available templates
  template <template-id>            View details of a specific template
  help                              Show this help message

Upload Options:
  <file-path>                       Path to the CSV file to upload
  [template-id]                     (Optional) Template ID to use for this upload
                                    If not provided, VENA_TEMPLATE_ID from .env will be used

Environment variables (from .env file):
  VENA_USERNAME                     Your Vena username
  VENA_PASSWORD                     Your Vena password
  VENA_TEMPLATE_ID                  Default template ID to use if not specified
  VENA_API_URL                      Vena API URL (default: https://us2.vena.io)

Examples:
  node import.js upload ./data/FY24_UTILIZATION.csv
  node import.js status 1234567890123456789
  node import.js cancel 1234567890123456789
  node import.js templates
  node import.js template abc123def456
  `);
  process.exit(0);
}

// Main execution
async function main() {
  try {
    switch (command) {
      case 'upload': {
        const csvFilePath = args[0];
        
        if (!csvFilePath) {
          console.error('Error: No CSV file path provided');
          console.error('Usage: node import.js upload <path-to-csv-file> [template-id]');
          process.exit(1);
        }
        
        // Validate file
        const validation = validateCsvFile(csvFilePath);
        
        if (!validation.success) {
          console.error(`Error: ${validation.error}`);
          process.exit(1);
        }
        
        if (validation.warning) {
          console.warn(`Warning: ${validation.warning}`);
        }
        
        // Get template ID
        const templateIdArg = args[1];
        const templateId = templateIdArg || config.api.defaultTemplateId;
        
        if (!templateId) {
          console.error('Error: No template ID provided and VENA_TEMPLATE_ID not found in environment variables');
          console.error('Usage: node import.js upload <path-to-csv-file> [template-id]');
          console.error('Tip: Run "node import.js templates" to see available templates');
          process.exit(1);
        }
        
        // Upload file
        const data = await uploadFile(csvFilePath, templateId, validation.fileName, validation.fileSize);
        
        if (data.jobId) {
          console.log(`Job ID: ${data.jobId}`);
          console.log(`To check status: node import.js status ${data.jobId}`);
          console.log(`To cancel job: node import.js cancel ${data.jobId}`);
        }
        
        console.log('Server response:');
        console.log(JSON.stringify(data, null, 2));
        break;
      }
      
      case 'status': {
        const jobId = args[0];
        
        if (!jobId) {
          console.error('Error: No job ID provided');
          console.error('Usage: node import.js status <job-id>');
          process.exit(1);
        }
        
        const jobInfo = await checkJobStatus(jobId);
        
        console.log('Job details:');
        console.log(JSON.stringify(jobInfo.details, null, 2));
        
        console.log('Job status:');
        console.log(JSON.stringify(jobInfo.status, null, 2));
        break;
      }
      
      case 'cancel': {
        const jobId = args[0];
        
        if (!jobId) {
          console.error('Error: No job ID provided');
          console.error('Usage: node import.js cancel <job-id>');
          process.exit(1);
        }
        
        const result = await cancelJob(jobId);
        
        console.log('Response:');
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      
      case 'templates': {
        const templates = await listTemplates();
        
        console.log('\nAvailable Templates:');
        
        if (templates && templates.length > 0) {
          console.log('\n' + '-'.repeat(100));
          console.log('| ID'.padEnd(38) + '| Name'.padEnd(42) + '| Description'.padEnd(20) + '|');
          console.log('-'.repeat(100));
          
          templates.forEach(template => {
            const id = template.id || 'N/A';
            const name = template.name || 'N/A';
            const description = template.description || '';
            
            console.log('| ' + id.padEnd(36) + '| ' + name.padEnd(40) + '| ' + description.padEnd(18) + '|');
          });
          
          console.log('-'.repeat(100));
          console.log(`\nTotal Templates: ${templates.length}`);
          console.log('\nTo get details on a specific template:');
          console.log('  node import.js template <template-id>');
          
          if (templates.length > 0 && templates[0].id) {
            console.log('\nExample:');
            console.log(`  node import.js template ${templates[0].id}`);
          }
        } else {
          console.log('No templates found.');
        }
        break;
      }
      
      case 'template': {
        const templateId = args[0];
        
        if (!templateId) {
          console.error('Error: No template ID provided');
          console.error('Usage: node import.js template <template-id>');
          console.error('Tip: Run "node import.js templates" to see available templates');
          process.exit(1);
        }
        
        const template = await getTemplateDetails(templateId);
        
        console.log('\nTemplate Details:');
        console.log(JSON.stringify(template, null, 2));
        
        console.log('\nTo upload a file using this template:');
        console.log(`  node import.js upload path/to/your/file.csv ${templateId}`);
        break;
      }
      
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "node import.js help" for usage information');
        process.exit(1);
    }
    
    return true;
  } catch (err) {
    console.error('Execution failed:', err.message);
    return false;
  }
}

// Execute the main function
main()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
  });