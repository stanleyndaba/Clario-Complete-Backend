// WebSocket Test Script for Phase 1 Events
// Run with: node test-websocket.js
// 
// Install dependencies first:
//   cd Integrations-backend
//   npm install socket.io-client

const io = require('socket.io-client');

const serverUrl = process.env.WS_URL || 'http://localhost:3001';
const userId = process.env.USER_ID || 'test-user-sandbox-001';

console.log('🔌 Connecting to WebSocket server:', serverUrl);
console.log('👤 User ID:', userId);
console.log('');

const socket = io(serverUrl, {
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5
});

socket.on('connect', () => {
  console.log('✅ Connected to WebSocket server');
  console.log('   Socket ID:', socket.id);
  console.log('');
  
  // Authenticate
  console.log('🔐 Authenticating...');
  socket.emit('authenticate', {
    userId: userId,
    token: 'test-token' // In production, use real JWT token
  });
});

socket.on('authenticated', (data) => {
  if (data.success) {
    console.log('✅ Authentication successful');
    console.log('');
    console.log('👂 Listening for workflow phase events...');
    console.log('   Waiting for: workflow.phase.1.completed');
    console.log('');
  } else {
    console.log('❌ Authentication failed:', data.error);
  }
});

// Listen for workflow phase events
socket.on('workflow.phase.1.started', (data) => {
  console.log('🎬 Phase 1 STARTED');
  console.log('   Data:', JSON.stringify(data, null, 2));
  console.log('');
});

socket.on('workflow.phase.1.completed', (data) => {
  console.log('✅ Phase 1 COMPLETED');
  console.log('   Data:', JSON.stringify(data, null, 2));
  console.log('');
});

socket.on('workflow.phase.1.failed', (data) => {
  console.log('❌ Phase 1 FAILED');
  console.log('   Data:', JSON.stringify(data, null, 2));
  console.log('');
});

// Listen for general workflow events
socket.on('workflow.phase.2.completed', (data) => {
  console.log('✅ Phase 2 COMPLETED');
  console.log('   Data:', JSON.stringify(data, null, 2));
  console.log('');
});

socket.on('workflow.phase.3.completed', (data) => {
  console.log('✅ Phase 3 COMPLETED');
  console.log('   Data:', JSON.stringify(data, null, 2));
  console.log('');
});

// Listen for sync progress updates
socket.on('sync_progress_update', (data) => {
  console.log('📊 Sync Progress Update');
  console.log('   Sync ID:', data.syncId);
  console.log('   Progress:', data.progress + '%');
  console.log('   Status:', data.status);
  console.log('');
});

// Listen for user notifications
socket.on('notification', (data) => {
  console.log('🔔 Notification');
  console.log('   Type:', data.type);
  console.log('   Title:', data.title);
  console.log('   Message:', data.message);
  console.log('');
});

socket.on('disconnect', () => {
  console.log('❌ Disconnected from WebSocket server');
});

socket.on('connect_error', (error) => {
  console.log('❌ Connection error:', error.message);
  console.log('   Make sure the server is running on', serverUrl);
});

socket.on('error', (error) => {
  console.log('❌ Socket error:', error);
});

// Keep script running
console.log('⏳ Waiting for events... (Press Ctrl+C to exit)');
console.log('');

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('');
  console.log('👋 Closing WebSocket connection...');
  socket.disconnect();
  process.exit(0);
});

