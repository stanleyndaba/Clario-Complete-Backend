import express from 'express';
const app = express();
const PORT = 3003; // Different port

app.get('/test', (_, res) => {
  res.json({ message: 'Server is working!', port: PORT });
});

app.listen(PORT, () => {
  console.log('✅ Test server running on port', PORT);
  console.log('✅ Keep this window open and test in another PowerShell:');
  console.log('✅ Invoke-RestMethod -Uri "http://localhost:3003/test" -Method Get');
});
