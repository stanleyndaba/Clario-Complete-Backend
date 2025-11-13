# 🎨 Frontend Phase 1 Requirements

## 📋 Overview

This document outlines all frontend changes needed for Phase 1: Data Intake & Synchronization.

---

## 🔧 Required Changes

### 1. **Amazon Connection Button Implementation**

#### Option A: "Connect Amazon Account" (Full OAuth)
```typescript
// Endpoint: GET /api/v1/integrations/amazon/auth/start?frontend_url=<FRONTEND_URL>
const connectAmazon = async () => {
  try {
    const response = await fetch(
      `${API_URL}/api/v1/integrations/amazon/auth/start?frontend_url=${window.location.origin}`,
      {
        method: 'GET',
        credentials: 'include',
      }
    );
    
    const data = await response.json();
    
    if (data.success && data.authUrl) {
      // Redirect to Amazon OAuth page
      window.location.href = data.authUrl;
    } else {
      console.error('Failed to start OAuth:', data.message);
    }
  } catch (error) {
    console.error('Error connecting Amazon:', error);
  }
};
```

#### Option B: "Skip OAuth use Existing connection" ⭐ **RECOMMENDED FOR TESTING**
```typescript
// Endpoint: GET /api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=<FRONTEND_URL>
const skipOAuthConnect = async () => {
  try {
    const response = await fetch(
      `${API_URL}/api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=${window.location.origin}`,
      {
        method: 'GET',
        credentials: 'include',
      }
    );
    
    const data = await response.json();
    
    if (data.success && data.bypassed) {
      // Bypass succeeded - redirect to dashboard
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        // Fallback redirect
        window.location.href = '/dashboard?amazon_connected=true';
      }
      
      // Show success message
      if (data.sandboxMode && !data.connectionVerified) {
        // In sandbox mode with mock data
        showNotification('Amazon connected (using test data)', 'info');
      } else {
        showNotification('Amazon connected successfully', 'success');
      }
    } else {
      // Bypass failed - fall back to OAuth
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        console.error('Bypass failed and no OAuth URL:', data.message);
      }
    }
  } catch (error) {
    console.error('Error skipping OAuth:', error);
  }
};
```

---

### 2. **OAuth Callback Handler**

```typescript
// Handle callback from Amazon OAuth redirect
// URL: /auth/callback?code=...&state=...
useEffect(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');
  const error = urlParams.get('error');
  
  if (error) {
    // Handle OAuth error
    showNotification(`OAuth error: ${error}`, 'error');
    window.location.href = '/integrations?error=oauth_failed';
    return;
  }
  
  if (code && state) {
    // Backend handles callback automatically
    // Just redirect to dashboard after a moment
    setTimeout(() => {
      window.location.href = '/dashboard?amazon_connected=true';
    }, 1000);
  }
}, []);
```

---

### 3. **Check Connection Status**

```typescript
// Endpoint: GET /api/v1/integrations/amazon/status
const checkAmazonConnection = async () => {
  try {
    const response = await fetch(
      `${API_URL}/api/v1/integrations/amazon/status`,
      {
        method: 'GET',
        credentials: 'include',
      }
    );
    
    const data = await response.json();
    
    return {
      connected: data.connected || false,
      sandboxMode: data.sandboxMode || false,
      useMockData: data.useMockGenerator || false,
      lastSync: data.lastSync || null,
    };
  } catch (error) {
    console.error('Error checking connection:', error);
    return { connected: false };
  }
};
```

---

### 4. **Trigger Manual Sync**

```typescript
// Endpoint: POST /api/v1/integrations/amazon/sync
const triggerSync = async () => {
  try {
    setSyncing(true);
    
    const response = await fetch(
      `${API_URL}/api/v1/integrations/amazon/sync`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('Sync started successfully', 'success');
      
      // Poll for sync status
      pollSyncStatus(data.syncId);
    } else {
      showNotification(`Sync failed: ${data.message}`, 'error');
    }
  } catch (error) {
    console.error('Error triggering sync:', error);
    showNotification('Failed to trigger sync', 'error');
  } finally {
    setSyncing(false);
  }
};
```

---

### 5. **Fetch Claims (Financial Events)**

```typescript
// Endpoint: GET /api/v1/integrations/amazon/claims
const fetchClaims = async (startDate?: Date, endDate?: Date) => {
  try {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate.toISOString());
    if (endDate) params.append('endDate', endDate.toISOString());
    
    const response = await fetch(
      `${API_URL}/api/v1/integrations/amazon/claims?${params.toString()}`,
      {
        method: 'GET',
        credentials: 'include',
      }
    );
    
    const data = await response.json();
    
    if (data.success) {
      return {
        claims: data.data || [],
        isMock: data.isMock || false,
        mockScenario: data.mockScenario || null,
        totalAmount: calculateTotalAmount(data.data || []),
      };
    } else {
      throw new Error(data.message || 'Failed to fetch claims');
    }
  } catch (error) {
    console.error('Error fetching claims:', error);
    throw error;
  }
};
```

---

### 6. **Fetch Inventory**

```typescript
// Endpoint: GET /api/v1/integrations/amazon/inventory
const fetchInventory = async () => {
  try {
    const response = await fetch(
      `${API_URL}/api/v1/integrations/amazon/inventory`,
      {
        method: 'GET',
        credentials: 'include',
      }
    );
    
    const data = await response.json();
    
    if (data.success) {
      return {
        inventory: data.data || [],
        isMock: data.isMock || false,
        mockScenario: data.mockScenario || null,
        totalItems: data.data?.length || 0,
      };
    } else {
      throw new Error(data.message || 'Failed to fetch inventory');
    }
  } catch (error) {
    console.error('Error fetching inventory:', error);
    throw error;
  }
};
```

---

### 7. **Fetch Orders**

```typescript
// Endpoint: GET /api/v1/integrations/amazon/orders
const fetchOrders = async (startDate?: Date, endDate?: Date) => {
  try {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate.toISOString());
    if (endDate) params.append('endDate', endDate.toISOString());
    
    const response = await fetch(
      `${API_URL}/api/v1/integrations/amazon/orders?${params.toString()}`,
      {
        method: 'GET',
        credentials: 'include',
      }
    );
    
    const data = await response.json();
    
    if (data.success) {
      return {
        orders: data.data || [],
        isMock: data.isMock || false,
        mockScenario: data.mockScenario || null,
        totalOrders: data.data?.length || 0,
      };
    } else {
      throw new Error(data.message || 'Failed to fetch orders');
    }
  } catch (error) {
    console.error('Error fetching orders:', error);
    throw error;
  }
};
```

---

## 🎨 UI/UX Components Needed

### 1. **Connection Status Badge**

```tsx
interface ConnectionStatusProps {
  connected: boolean;
  sandboxMode?: boolean;
  useMockData?: boolean;
}

const ConnectionStatusBadge: React.FC<ConnectionStatusProps> = ({
  connected,
  sandboxMode,
  useMockData,
}) => {
  if (!connected) {
    return <Badge color="gray">Not Connected</Badge>;
  }
  
  if (sandboxMode && useMockData) {
    return <Badge color="blue">Connected (Test Data)</Badge>;
  }
  
  if (sandboxMode) {
    return <Badge color="yellow">Connected (Sandbox)</Badge>;
  }
  
  return <Badge color="green">Connected</Badge>;
};
```

---

### 2. **Mock Data Indicator**

```tsx
interface MockDataIndicatorProps {
  isMock: boolean;
  scenario?: string;
}

const MockDataIndicator: React.FC<MockDataIndicatorProps> = ({
  isMock,
  scenario,
}) => {
  if (!isMock) return null;
  
  return (
    <div className="mock-data-indicator">
      <Icon name="test-tube" />
      <span>Test Data ({scenario || 'normal_week'})</span>
    </div>
  );
};
```

---

### 3. **Sync Status Component**

```tsx
interface SyncStatusProps {
  syncing: boolean;
  lastSync?: Date;
  syncId?: string;
}

const SyncStatus: React.FC<SyncStatusProps> = ({
  syncing,
  lastSync,
  syncId,
}) => {
  return (
    <div className="sync-status">
      {syncing ? (
        <>
          <Spinner />
          <span>Syncing...</span>
          {syncId && <span className="sync-id">ID: {syncId}</span>}
        </>
      ) : (
        <>
          <Icon name="check" />
          <span>
            {lastSync
              ? `Last sync: ${formatDate(lastSync)}`
              : 'Not synced yet'}
          </span>
        </>
      )}
    </div>
  );
};
```

---

## 📊 Data Display Components

### 1. **Claims List**

```tsx
interface ClaimsListProps {
  claims: Claim[];
  isMock?: boolean;
  mockScenario?: string;
}

const ClaimsList: React.FC<ClaimsListProps> = ({
  claims,
  isMock,
  mockScenario,
}) => {
  return (
    <div className="claims-list">
      <div className="list-header">
        <h2>Claims & Reimbursements</h2>
        {isMock && <MockDataIndicator scenario={mockScenario} />}
      </div>
      
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Date</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => (
            <tr key={claim.id}>
              <td>{claim.id}</td>
              <td>${claim.amount.toFixed(2)}</td>
              <td>{claim.status}</td>
              <td>{formatDate(claim.createdAt)}</td>
              <td>{claim.type}</td>
            </tr>
          ))}
        </tbody>
      </table>
      
      {claims.length === 0 && (
        <div className="empty-state">
          <p>No claims found</p>
        </div>
      )}
    </div>
  );
};
```

---

## 🔄 State Management

### Redux/Context Example

```typescript
interface AmazonIntegrationState {
  connected: boolean;
  sandboxMode: boolean;
  useMockData: boolean;
  claims: Claim[];
  inventory: InventoryItem[];
  orders: Order[];
  syncing: boolean;
  lastSync: Date | null;
  syncId: string | null;
}

const initialState: AmazonIntegrationState = {
  connected: false,
  sandboxMode: false,
  useMockData: false,
  claims: [],
  inventory: [],
  orders: [],
  syncing: false,
  lastSync: null,
  syncId: null,
};
```

---

## ⚠️ Error Handling

```typescript
const handleApiError = (error: any) => {
  if (error.response?.status === 401) {
    // Not authenticated
    showNotification('Please connect your Amazon account', 'warning');
    return;
  }
  
  if (error.response?.status === 403) {
    // Not authorized
    showNotification('Access denied', 'error');
    return;
  }
  
  if (error.response?.status === 404) {
    // Not found (might be normal in sandbox)
    showNotification('No data found', 'info');
    return;
  }
  
  // Generic error
  showNotification(`Error: ${error.message}`, 'error');
};
```

---

## 🧪 Testing Checklist

- [ ] "Skip OAuth" button works in sandbox mode
- [ ] OAuth callback handler redirects correctly
- [ ] Connection status displays correctly
- [ ] Mock data indicator shows when data is mock
- [ ] Claims list displays correctly
- [ ] Inventory list displays correctly
- [ ] Orders list displays correctly
- [ ] Sync status updates correctly
- [ ] Error handling works for all scenarios

---

## 📝 Summary

### Required Endpoints:
1. `GET /api/v1/integrations/amazon/auth/start` (with `?bypass=true` for skip OAuth)
2. `GET /api/v1/integrations/amazon/status`
3. `POST /api/v1/integrations/amazon/sync`
4. `GET /api/v1/integrations/amazon/claims`
5. `GET /api/v1/integrations/amazon/inventory`
6. `GET /api/v1/integrations/amazon/orders`

### Key Changes:
1. ✅ Implement "Skip OAuth" button (recommended for testing)
2. ✅ Handle bypass flow response
3. ✅ Show mock data indicators
4. ✅ Display connection status
5. ✅ Fetch and display Phase 1 data (claims, inventory, orders)

### UI Components Needed:
1. Connection status badge
2. Mock data indicator
3. Sync status component
4. Claims list
5. Inventory list
6. Orders list

---

## 🚀 Quick Start

1. **Update API base URL**:
   ```typescript
   const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
   ```

2. **Add "Skip OAuth" button**:
   ```tsx
   <Button onClick={skipOAuthConnect}>
     Skip OAuth use Existing connection
   </Button>
   ```

3. **Display mock data indicator** when `isMock: true` in API responses

4. **Show connection status** using the status endpoint

5. **Fetch and display Phase 1 data** after connection

**Phase 1 Frontend is ready to implement!** 🎉

