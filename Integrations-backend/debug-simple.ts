import express from 'express';
import { createServer } from 'http';

async function startServer() {
  try {
    const app = express();
    const server = createServer(app);
    const PORT = 3002;

    // Basic route
    app.get('/api/status', (_, res) => {
      res.json({ status: 'OK', step: 'Step 4 Evidence System' });
    });

    await new Promise((resolve, reject) => {
      server.listen(PORT, () => {
        console.log('✅ Step 4 Server running on port', PORT);
        resolve(true);
      });
      
      server.on('error', reject);
    });

    console.log('✅ Server is actively listening for requests...');
    
  } catch (error) {
    console.error('🚨 Server startup error:', error);
    process.exit(1);
  }
}

startServer();
