/**
 * Authentication module for Vena ETL Tool
 * Handles credential management and authentication
 */
const { config } = require('../config');

/**
 * Generate Basic Authentication header
 * @returns {string} Basic authentication header value
 */
function getAuthHeader() {
  const { username, password } = config.auth;
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${credentials}`;
}

/**
 * Get common request headers for Vena API calls
 * @returns {Object} Headers object with authorization
 */
function getRequestHeaders() {
  return {
    accept: 'application/json',
    authorization: getAuthHeader()
  };
}

module.exports = {
  getAuthHeader,
  getRequestHeaders
};