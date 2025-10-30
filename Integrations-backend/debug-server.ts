import express from 'express';
// ... existing imports ...

const app = express();
const PORT = 3002;

// Add global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  process.exit(1);
});

// ... existing middleware and routes ...

app.listen(PORT, () => {
  console.log('Server running on port', PORT);
  console.log('Environment: production');
});
