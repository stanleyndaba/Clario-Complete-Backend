# Automated Initial Data Crawl System

This document describes the implementation of the automated initial data crawl system that triggers immediately after Amazon OAuth completion.

## Overview

The system automatically fetches 18 months of historical Amazon data after a user completes OAuth authentication. It uses a distributed job queue for scalability and provides real-time progress feedback via WebSockets.

## Architecture

```
User OAuth → Auth Controller → Queue Manager → Full Historical Sync Job → Report Downloader → Data Parser → Unified Ledger
     ↓              ↓              ↓                    ↓                    ↓              ↓            ↓
WebSocket Progress Updates ← Job Progress Callbacks ← Report Processing ← SP-API Calls ← Data Cleaning ← Database Storage
```

## Components

### 1. Queue Manager (`src/jobs/queueManager.ts`)
- **Purpose**: Orchestrates job execution using BullMQ
- **Features**:
  - Distributed job queuing with Redis
  - Priority-based job scheduling
  - Automatic retry with exponential backoff
  - Job status tracking and monitoring

### 2. Full Historical Sync Job (`src/jobs/fullHistoricalSyncJob.ts`)
- **Purpose**: Handles the complete 18-month data crawl
- **Features**:
  - Processes 7 different report types
  - Batches data into 3-month windows to avoid API throttling
  - Real-time progress callbacks
  - Error handling and recovery

### 3. Report Downloader (`src/jobs/reportDownloader.ts`)
- **Purpose**: Fetches reports from Amazon SP-API
- **Features**:
  - Handles pagination with nextToken
  - Automatic retry for throttling/timeout errors
  - Supports GZIP compression
  - Rate limiting between requests

### 4. Retry Handler (`src/utils/retryHandler.ts`)
- **Purpose**: Provides robust retry logic for API calls
- **Features**:
  - Exponential backoff
  - Amazon SP-API specific error handling
  - Batch operation support
  - Pagination retry logic

### 5. Amazon Data Service (`src/services/amazonDataService.ts`)
- **Purpose**: Centralized Amazon SP-API interactions
- **Features**:
  - Report creation and status checking
  - Token management and refresh
  - Multiple report type support

### 6. Report Parser (`src/services/reportParser.ts`)
- **Purpose**: Normalizes and cleans report data
- **Features**:
  - Data validation and cleaning
  - Deduplication based on external IDs
  - Type-specific parsing logic
  - Metadata extraction

### 7. Unified Ledger (`shared/db/ledgers.ts`)
- **Purpose**: Stores data in unified Case File Ledger
- **Features**:
  - Transaction-based data storage
  - Sync status tracking
  - Data deduplication
  - Performance indexing

### 8. WebSocket Service (`src/services/websocketService.ts`)
- **Purpose**: Real-time progress feedback
- **Features**:
  - User-specific progress updates
  - Job-specific subscriptions
  - Authentication and room management
  - Error notifications

## Report Types Supported

1. **Inventory Ledger**: Current inventory levels and movements
2. **Fee Preview**: Amazon fees and charges
3. **FBA Reimbursements**: Reimbursements for lost/damaged items
4. **Order Returns**: Customer return data
5. **Order Reports**: Order details and metrics
6. **Settlement Reports**: Financial settlement data
7. **Financial Events**: All financial transactions

## Data Flow

### 1. OAuth Trigger
```typescript
// User completes Amazon OAuth
POST /api/amazon/oauth-callback
↓
// Auth controller triggers historical sync
const job = await queueManager.addFullHistoricalSync(userId, 1);
```

### 2. Job Processing
```typescript
// Queue manager processes the job
await fullHistoricalSyncJob.process(userId, (progress) => {
  job.updateProgress(progress);
  websocketService.emitSyncProgress(progress);
});
```

### 3. Report Download
```typescript
// For each report type and time window
const reportData = await reportDownloader.downloadReport(
  userId, reportType, startDate, endDate
);
```

### 4. Data Processing
```typescript
// Parse and normalize data
const normalizedData = await reportParser.parseReport(reportType, reportData);

// Store in unified ledger
await ledgers.storeReportData(userId, reportType, normalizedData, options);
```

### 5. Progress Updates
```typescript
// Real-time progress via WebSocket
websocketService.emitSyncProgress({
  userId,
  jobId,
  current: processedReports,
  total: totalReports,
  reportType,
  status: 'processing',
  percentage: (processedReports / totalReports) * 100
});
```

## Configuration

### Environment Variables
```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Amazon SP-API Configuration
AMAZON_CLIENT_ID=your_client_id
AMAZON_CLIENT_SECRET=your_client_secret
AMAZON_REDIRECT_URI=your_redirect_uri
AMAZON_REGION=us-east-1
AMAZON_MARKETPLACE_ID=your_marketplace_id

# Frontend URL for WebSocket CORS
FRONTEND_URL=http://localhost:3000
```

### Database Tables
The system creates two main tables:

1. **case_file_ledger**: Stores all report data
2. **sync_status**: Tracks sync progress and status

## API Endpoints

### OAuth Callback
```
GET /api/amazon/oauth-callback
Headers: Authorization: Bearer <token>
Query: code=<auth_code>&state=<state>
Response: { jobId, status, message }
```

### Job Status
```
GET /api/jobs/:jobId/status
Headers: Authorization: Bearer <token>
Response: { id, status, progress, data, timestamp }
```

### User Jobs
```
GET /api/jobs/user/:userId
Headers: Authorization: Bearer <token>
Response: [{ id, name, status, progress, data, timestamp }]
```

## WebSocket Events

### Client → Server
- `authenticate`: Authenticate user connection
- `subscribe_sync_progress`: Subscribe to job progress updates

### Server → Client
- `sync_progress`: Real-time progress updates
- `sync_completed`: Job completion notification
- `sync_error`: Error notification
- `notification`: General notifications

## Error Handling

### Retry Logic
- **API Throttling**: Automatic retry with exponential backoff
- **Network Errors**: Retry up to 3 times with increasing delays
- **Rate Limiting**: Respect Amazon SP-API rate limits

### Error Recovery
- **Failed Reports**: Continue processing other reports
- **Partial Failures**: Log errors and continue
- **Job Failures**: Automatic job retry with backoff

## Monitoring and Logging

### Log Levels
- **INFO**: Normal operation tracking
- **WARN**: Recoverable issues
- **ERROR**: Critical failures

### Metrics
- Job completion rates
- Processing times
- Error rates by report type
- API call success rates

## Performance Considerations

### Scalability
- **Distributed Queue**: Multiple workers can process jobs
- **Batch Processing**: Process data in chunks to avoid memory issues
- **Database Indexing**: Optimized queries for large datasets

### Rate Limiting
- **API Throttling**: Respect Amazon SP-API limits
- **Request Spacing**: Delays between API calls
- **Batch Windows**: Process 3-month windows to avoid overwhelming APIs

## Security

### Authentication
- JWT token validation for all endpoints
- WebSocket authentication
- User-specific data isolation

### Data Protection
- Encrypted token storage
- Secure database connections
- Input validation and sanitization

## Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
npm run test:integration
```

### Load Testing
```bash
npm run test:load
```

## Deployment

### Docker
```bash
docker-compose up -d
```

### Environment Setup
1. Install Redis
2. Configure environment variables
3. Initialize database tables
4. Start the application

### Health Checks
- Redis connectivity
- Database connectivity
- Amazon SP-API connectivity
- WebSocket service status

## Troubleshooting

### Common Issues

1. **Job Stuck in Queue**
   - Check Redis connectivity
   - Verify worker processes are running
   - Check job logs for errors

2. **API Rate Limiting**
   - Review request spacing
   - Check Amazon SP-API quotas
   - Implement additional delays if needed

3. **WebSocket Connection Issues**
   - Verify CORS configuration
   - Check authentication tokens
   - Review network connectivity

### Debug Mode
```bash
DEBUG=* npm run dev
```

## Future Enhancements

1. **Additional Report Types**: Support for more Amazon reports
2. **Incremental Sync**: Only fetch new data since last sync
3. **Data Analytics**: Built-in analytics and insights
4. **Multi-Platform Support**: Extend to other e-commerce platforms
5. **Advanced Scheduling**: Custom sync schedules per user
6. **Data Export**: Export capabilities for external systems

## Support

For issues and questions:
- Check the logs for detailed error information
- Review the troubleshooting section
- Contact the development team with specific error details 