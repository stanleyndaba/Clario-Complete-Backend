/* eslint-disable */
const { writeFileSync } = require('fs');
const { z } = require('zod');

// Minimal hand-authored OpenAPI using contracts; for brevity we only outline key endpoints
const openapi = {
  openapi: '3.0.3',
  info: { title: 'Cost Documentation Module API', version: '1.1.0' },
  paths: {
    '/api/v1/journal/journal': {
      post: {
        summary: 'Record a transaction',
        responses: { '200': { description: 'OK' }, '400': { description: 'Validation error' }, '401': { description: 'Unauthorized' } },
      },
      get: {
        summary: 'List transactions',
        responses: { '200': { description: 'OK' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/api/v1/journal/journal/{id}': {
      get: { summary: 'Get transaction by id', responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } } },
    },
    '/api/v1.1/cost-docs/docs/export': {
      post: { summary: 'Export cost docs', responses: { '200': { description: 'OK' }, '400': { description: 'Validation error' } } },
    },
    '/api/v1.1/cost-docs/docs/{id}/lock': {
      post: { summary: 'Lock a document', responses: { '200': { description: 'OK' }, '401': { description: 'Unauthorized' } } },
    },
  },
};

writeFileSync('openapi.json', JSON.stringify(openapi, null, 2));
console.log('Generated openapi.json');


