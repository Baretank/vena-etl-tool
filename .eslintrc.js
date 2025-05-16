module.exports = {
  'env': {
    'node': true,
    'es2022': true
  },
  'extends': [
    'eslint:recommended',
    'plugin:node/recommended'
  ],
  'parserOptions': {
    'ecmaVersion': 2022,
    'sourceType': 'commonjs'
  },
  'plugins': [
    'node',
    'security'
  ],
  'rules': {
    // Basic rules
    'no-unused-vars': 'warn',
    'handle-callback-err': 'error',
    'no-path-concat': 'error',
    'semi': ['error', 'always'],
    'quotes': ['error', 'single'],
    'indent': ['error', 2],
    'eqeqeq': ['error', 'always'],
    
    // Node.js specific rules
    'node/no-unsupported-features/es-syntax': ['error', {
      'version': '>=14.0.0',
      'ignores': []
    }],
    'node/no-missing-require': 'error',
    
    // Security specific rules - define them individually instead of using extends
    'security/detect-buffer-noassert': 'warn',
    'security/detect-child-process': 'warn',
    'security/detect-disable-mustache-escape': 'warn',
    'security/detect-eval-with-expression': 'warn',
    'security/detect-new-buffer': 'warn',
    'security/detect-no-csrf-before-method-override': 'warn',
    'security/detect-non-literal-fs-filename': 'warn',
    'security/detect-non-literal-regexp': 'warn',
    'security/detect-non-literal-require': 'warn',
    'security/detect-object-injection': 'warn',
    'security/detect-possible-timing-attacks': 'warn',
    'security/detect-pseudoRandomBytes': 'warn',
    'security/detect-unsafe-regex': 'warn',
    'security/detect-bidi-characters': 'warn'
  }
};