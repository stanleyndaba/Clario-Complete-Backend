# Notifications System Module

A complete, production-ready notifications system for the Margin Integrations Backend, built with TypeScript, Supabase (PostgreSQL), and BullMQ for background job processing.

## 🚀 Features

- **Multi-channel Delivery**: In-app (WebSocket), email, or both
- **Priority-based Processing**: Urgent, high, normal, and low priority levels
- **Background Job Processing**: BullMQ-powered async notification delivery
- **Real-time Updates**: WebSocket-based instant notifications
- **Email Integration**: Resend delivery with seller-facing HTML templates
- **Database Storage**: Supabase/PostgreSQL with Row Level Security (RLS)
- **TypeScript**: Full type safety and modern development experience
- **Production Ready**: Error handling, logging, and monitoring

## 📁 Module Structure

```
src/notifications/
├── models/
│   └── notification.ts          # Database models and CRUD operations
├── services/
│   ├── notification_service.ts  # Main notification service
│   └── delivery/
│       ├── email_service.ts     # Email delivery service
│       └── websocket_service.ts # WebSocket delivery service
├── workers/
│   └── notification_worker.ts   # BullMQ worker for background processing
├── controllers/
│   └── notification_controller.ts # HTTP API controllers
├── routes/
│   └── notification_routes.ts   # Express.js routes with Swagger docs
├── migrations/
│   └── 001_create_notifications_table.sql # Database schema
├── examples/
│   └── integration_examples.ts  # Integration examples for other services
├── index.ts                     # Main export file
├── package.json                 # Dependencies and scripts
└── README.md                    # This file
```

## 🛠️ Installation

### 1. Install Dependencies

```bash
cd src/notifications
npm install
```

### 2. Environment Variables

Add these to your `.env` file:

```bash
# Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key

# Redis Configuration (for BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Email Configuration
RESEND_API_KEY=your_resend_api_key
EMAIL_FROM_EMAIL=notifications@margin-finance.com
EMAIL_FROM_NAME=Margin
EMAIL_REPLY_TO=support@yourdomain.com

# Frontend URL (for WebSocket CORS and email links)
FRONTEND_URL=https://app.yourdomain.com

# Worker Configuration
NOTIFICATION_WORKER_CONCURRENCY=5
```

### 3. Database Setup

Run the migration in your Supabase SQL editor:

```sql
-- Copy and paste the contents of migrations/001_create_notifications_table.sql
-- This will create the notifications table with proper indexes and RLS policies
```

## 🔧 Integration

### 1. Basic Integration

```typescript
// Import the notification service
import { notificationService, NotificationType, NotificationPriority, NotificationChannel } from './notifications';

// Create a notification
await notificationService.createNotification({
  type: NotificationType.CLAIM_DETECTED,
  user_id: 'user-123',
  title: 'New Claim Detected!',
  message: 'We found a potential reimbursement claim for you.',
  priority: NotificationPriority.HIGH,
  channel: NotificationChannel.BOTH, // Send both in-app and email
  payload: {
    claim_id: 'CLM-001',
    amount: 25.50,
    source: 'amazon'
  }
});
```

### 2. Integration with Express App

```typescript
import express from 'express';
import { notificationRoutes } from './notifications';

const app = express();

// Add notification routes
app.use('/api/notifications', notificationRoutes);

// Initialize notification service
import { notificationService } from './notifications';
await notificationService.initialize();
```

### 3. WebSocket Integration

```typescript
import { createServer } from 'http';
import { WebSocketService } from './notifications';

const httpServer = createServer(app);
const websocketService = new WebSocketService();

// Initialize WebSocket service
websocketService.initialize(httpServer);
```

## 📡 API Endpoints

### Authentication Required Endpoints

All endpoints require authentication. Include the `Authorization: Bearer <token>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/notifications` | Get all notifications for user |
| `GET` | `/notifications/:id` | Get specific notification |
| `POST` | `/notifications` | Create new notification |
| `PUT` | `/notifications/:id` | Update notification |
| `DELETE` | `/notifications/:id` | Delete notification |
| `POST` | `/notifications/mark-read` | Mark notifications as read |
| `GET` | `/notifications/stats` | Get notification statistics |
| `GET` | `/notifications/types` | Get available types/priorities/channels |

### Query Parameters

- `type`: Filter by notification type
- `status`: Filter by status
- `priority`: Filter by priority
- `channel`: Filter by delivery channel
- `unread_only`: Show only unread notifications
- `limit`: Maximum results (default: 50)
- `offset`: Skip results (default: 0)

### Example Usage

```bash
# Get high priority notifications
GET /api/notifications?priority=high&limit=10

# Get unread notifications only
GET /api/notifications?unread_only=true

# Mark notifications as read
POST /api/notifications/mark-read
{
  "notificationIds": ["uuid-1", "uuid-2"]
}
```

## 🔌 Service Integration Examples

### Claim Detector Integration

```typescript
// In your claim_detector.ts service
import { notificationService, NotificationType, NotificationPriority } from '../notifications';

export async function detectClaim(userId: string, claimData: any) {
  // ... claim detection logic ...
  
  // Notify user about detected claim
  await notificationService.createNotification({
    type: NotificationType.CLAIM_DETECTED,
    user_id: userId,
    title: 'New Reimbursement Claim Detected!',
    message: `We've identified a potential claim for $${claimData.amount}.`,
    priority: NotificationPriority.HIGH,
    channel: NotificationChannel.BOTH,
    payload: {
      claim_id: claimData.id,
      amount: claimData.amount,
      source: claimData.source
    },
    immediate: true // Send immediately for high-priority claims
  });
}
```

### Integration Service

```typescript
// In your integrations.ts service
import { notificationService, NotificationType } from '../notifications';

export async function completeAmazonIntegration(userId: string) {
  // ... integration logic ...
  
  await notificationService.createNotification({
    type: NotificationType.INTEGRATION_COMPLETED,
    user_id: userId,
    title: 'Amazon Integration Complete!',
    message: 'Your Amazon SP-API integration has been completed successfully.',
    priority: NotificationPriority.NORMAL,
    channel: NotificationChannel.IN_APP,
    payload: {
      provider: 'amazon',
      status: 'completed'
    }
  });
}
```

### Stripe Payments

```typescript
// In your stripe_payments.ts service
import { notificationService, NotificationType } from '../notifications';

export async function processPayment(userId: string, paymentData: any) {
  // ... payment processing logic ...
  
  await notificationService.createNotification({
    type: NotificationType.PAYMENT_PROCESSED,
    user_id: userId,
    title: 'Payment Processed Successfully',
    message: `Payment of $${paymentData.amount} has been processed.`,
    priority: NotificationPriority.NORMAL,
    channel: NotificationChannel.BOTH,
    payload: {
      payment_id: paymentData.id,
      amount: paymentData.amount,
      status: 'succeeded'
    }
  });
}
```

## 🎯 Notification Types

| Type | Description | Use Case |
|------|-------------|----------|
| `claim_detected` | New reimbursement claim found | Claim detection service |
| `integration_completed` | API integration finished | Integration service |
| `payment_processed` | Payment transaction completed | Payment service |
| `sync_completed` | Data synchronization finished | Sync service |
| `discrepancy_found` | Data discrepancies detected | Inventory/audit service |
| `system_alert` | System-level notifications | System monitoring |
| `user_action_required` | User needs to take action | Workflow management |

## 🚦 Priority Levels

| Priority | Description | Processing Delay |
|----------|-------------|------------------|
| `urgent` | Critical notifications | Immediate (0s) |
| `high` | Important notifications | 1 second |
| `normal` | Standard notifications | 5 seconds |
| `low` | Low-priority notifications | 30 seconds |

## 📨 Delivery Channels

| Channel | Description |
|---------|-------------|
| `in_app` | WebSocket only |
| `email` | Email only |
| `both` | WebSocket + Email |

## 🔄 Background Processing

The system uses BullMQ for background job processing:

- **Queue**: `notifications`
- **Worker Concurrency**: Configurable (default: 5)
- **Retry Logic**: 3 attempts with exponential backoff
- **Job Cleanup**: Automatic cleanup of completed/failed jobs

### Queue Monitoring

```typescript
import { NotificationWorker } from './notifications';

const worker = new NotificationWorker();
const stats = await worker.getQueueStats();

console.log('Queue Status:', stats);
// Output: { waiting: 5, active: 2, completed: 150, failed: 3, delayed: 0 }
```

## 🧪 Testing

### Run Tests

```bash
npm test
npm run test:watch
```

### Test Coverage

The module includes comprehensive tests for:
- Model operations
- Service methods
- Controller endpoints
- Worker processing
- Error handling

## 📊 Monitoring & Health

### Health Check

```bash
GET /api/notifications/health
```

Response:
```json
{
  "success": true,
  "status": "healthy",
  "service": "notifications",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600
}
```

### Statistics

```bash
GET /api/notifications/stats
```

Response:
```json
{
  "success": true,
  "data": {
    "total": 150,
    "unread": 25,
    "read": 100,
    "pending": 20,
    "failed": 5,
    "by_type": {
      "claim_detected": 50,
      "integration_completed": 30,
      "sync_completed": 70
    },
    "by_priority": {
      "urgent": 10,
      "high": 25,
      "normal": 100,
      "low": 15
    }
  }
}
```

## 🚨 Error Handling

The system includes comprehensive error handling:

- **Database Errors**: Graceful fallback and retry
- **Email Failures**: Automatic retry with exponential backoff
- **WebSocket Errors**: Connection recovery and user re-authentication
- **Queue Failures**: Job retry and dead letter queue handling

## 🔒 Security Features

- **Row Level Security (RLS)**: Users can only access their own notifications
- **Authentication Required**: All endpoints require valid authentication
- **Input Validation**: Comprehensive request validation
- **SQL Injection Protection**: Parameterized queries via Supabase

## 📈 Performance Features

- **Database Indexes**: Optimized for common query patterns
- **Connection Pooling**: Efficient database connection management
- **Background Processing**: Non-blocking notification delivery
- **Batch Operations**: Support for bulk notification creation
- **Caching**: Redis-based caching for frequently accessed data

## 🚀 Scaling Considerations

### Horizontal Scaling

- **Multiple Workers**: Run multiple notification workers across instances
- **Redis Cluster**: Use Redis cluster for high availability
- **Load Balancing**: Distribute WebSocket connections across instances

### Performance Tuning

- **Worker Concurrency**: Adjust based on server capacity
- **Batch Size**: Optimize batch notification processing
- **Database Connection Pool**: Tune based on database capacity

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NOTIFICATION_WORKER_CONCURRENCY` | `5` | Number of concurrent workers |
| `REDIS_TTL` | `3600` | Redis cache TTL in seconds |
| `EMAIL_RETRY_ATTEMPTS` | `3` | Email delivery retry attempts |
| `WEBSOCKET_PING_INTERVAL` | `25000` | WebSocket ping interval (ms) |

### Service Configuration

```typescript
import { notificationService } from './notifications';

// Update email configuration
notificationService.emailService.updateConfig({
  provider: 'postmark',
  apiKey: 'new-api-key'
});

// Update WebSocket configuration
notificationService.websocketService.updateConfig({
  cors: { origin: 'https://newdomain.com' }
});
```

## 📚 Additional Resources

- **Swagger Documentation**: Available at `/api/notifications` endpoints
- **Integration Examples**: See `examples/integration_examples.ts`
- **Database Schema**: See `migrations/001_create_notifications_table.sql`
- **Type Definitions**: All interfaces and types are exported from `index.ts`

## 🤝 Contributing

1. Follow the existing code style and patterns
2. Add comprehensive tests for new features
3. Update documentation for API changes
4. Ensure all tests pass before submitting

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

For issues and questions:
- Check the integration examples
- Review the API documentation
- Open an issue in the repository
- Contact the development team

---

**Built with ❤️ by the Margin Team**

