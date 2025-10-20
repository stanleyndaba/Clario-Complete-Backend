import express from 'express';
import cors from 'cors';
import { initializeDatabase, db } from './utils/db';
import { router as claimsRoutes } from './api/routes/claimsRoutes';
import { router as ledgerRoutes } from './api/routes/ledgerRoutes';
import { router as discrepancyRoutes } from './api/routes/discrepancyRoutes';
import { router as amazonSubmissionRoutes } from './api/routes/amazonSubmissionRoutes';

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Routes
app.use('/api/v1/claims', claimsRoutes);
app.use('/api/v1/ledger', ledgerRoutes);
app.use('/api/v1/discrepancies', discrepancyRoutes);
app.use('/api/v1/amazon-submission', amazonSubmissionRoutes);

// Health endpoint
app.get('/health', async (req, res) => {
  try {
    const dbConnected = await db.testConnection();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbConnected ? 'connected' : 'disconnected',
      version: '1.0.0'
    });
  } catch (error) {
    res.json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      version: '1.0.0'
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Refund Engine API',
    version: '1.0.0',
    endpoints: {
      claims: '/api/v1/claims',
      ledger: '/api/v1/ledger',
      discrepancies: '/api/v1/discrepancies',
      'amazon-submission': '/api/v1/amazon-submission',
      health: '/health'
    }
  });
});

async function startServer() {
  console.log('Initializing database...');
  try {
    await initializeDatabase();
    console.log('Database initialized successfully');

    console.log('Testing database connection...');
    const dbConnected = await db.testConnection();
    console.log(dbConnected ? 'Database connection successful' : 'Database test failed');
  } catch (e) {
    console.error('Database init failed, continuing to start server:', e);
  }

  
// Test token endpoint (add this before app.listen)
app.get('/api/test-token', (req, res) => {
  const jwt = require('jsonwebtoken');
  const payload = {
    userId: 'test-user-123',
    email: 'test@example.com',
    role: 'user'
  };
  
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
});

app.listen(PORT, () => {
    console.log(`🚀 Refund Engine API server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📚 API documentation: http://localhost:${PORT}/`);
  });
}

startServer();




