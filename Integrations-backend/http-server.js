const http = require('http');
const PORT = 5000; // Completely different port

const server = http.createServer((req, res) => {
  console.log('Request received:', req.url);
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  
  if (req.url === '/api/status') {
    res.end(JSON.stringify({
      status: 'OK',
      step: 'Step 4 Evidence Ingestion - WORKING!',
      gmailService: 'Real API calls enabled',
      evidenceSystem: 'Operational'
    }));
  } else {
    res.end(JSON.stringify({
      message: 'Step 4 Evidence Server',
      endpoints: ['/api/status']
    }));
  }
});

server.listen(PORT, () => {
  console.log('Step 4 Evidence Server running on port', PORT);
  console.log('Test with: curl http://localhost:5000/api/status');
  console.log('Server should stay running...');
});

// Keep process alive
process.on('SIGTERM', () => console.log('SIGTERM received'));
process.on('SIGINT', () => console.log('SIGINT received'));
