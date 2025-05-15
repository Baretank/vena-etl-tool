/**
 * Configuration module for Vena ETL Tool
 * Centralizes all configuration values from environment variables
 */
require('dotenv').config();

const config = {
  api: {
    baseUrl: process.env.VENA_API_URL || 'https://us2.vena.io',
    retryAttempts: 3,
    retryBackoff: 300,
    defaultTemplateId: process.env.VENA_TEMPLATE_ID
  },
  auth: {
    username: process.env.VENA_USERNAME,
    password: process.env.VENA_PASSWORD
  },
  logging: {
    directory: './logs',
    uploadHistory: 'upload-history.jsonl',
    jobHistory: 'job-history.jsonl',
    apiHistory: 'api-history.jsonl',
    errorLogs: 'error.jsonl'
  }
};

// Validate required configuration
function validateConfig() {
  if (!config.auth.username || !config.auth.password) {
    console.error('Error: Vena credentials not found in environment variables');
    console.error('Please check your .env file includes VENA_USERNAME and VENA_PASSWORD');
    process.exit(1);
  }
}

module.exports = {
  config,
  validateConfig
};