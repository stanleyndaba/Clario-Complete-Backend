# 🚀 Frontend Phase 1 Quick Start Guide

## ⚡ Quick Summary

### **Must-Have Changes:**
1. ✅ Update API base URL to correct backend
2. ✅ Add "Skip OAuth" button (recommended for testing)
3. ✅ Handle bypass flow response
4. ✅ Fetch and display Phase 1 data

---

## 🔗 API Endpoints (All Ready)

### **Base URL:**
```typescript
const API_URL = process.env.NEXT_PUBLIC_INTEGRATIONS_URL || 'https://opside-node-api.onrender.com';
// or for local: 'http://localhost:3001'
```

### **Available Endpoints:**

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/v1/integrations/amazon/auth/start` | GET | Start OAuth or Bypass | ✅ Ready |
| `/api/v1/integrations/amazon/auth/callback` | GET | OAuth callback | ✅ Ready |
| `/api/v1/integrations/amazon/status` | GET | Check connection | ✅ Ready |
| `/api/v1/integrations/amazon/sync` | POST | Trigger sync | ✅ Ready |
| `/api/v1/integrations/amazon/claims` | GET | Get financial events | ✅ Ready |
| `/api/v1/integrations/amazon/inventory` | GET | Get inventory | ✅ Ready |
| `/api/v1/integrations/amazon/orders` | GET | Get orders | ✅ Ready |
| `/api/v1/integrations/amazon/disconnect` | POST | Disconnect | ✅ Ready |

---

## 📝 Critical Frontend Changes

### **1. Environment Variables (Vercel/Config)**

```env
NEXT_PUBLIC_INTEGRATIONS_URL=https://opside-node-api.onrender.com
# or for local: http://localhost:3001
```

**Action:** Update in Vercel Settings → Environment Variables

---

### **2. "Skip OAuth" Button Implementation** ⭐ **PRIORITY**

```tsx
// Recommended button for Phase 1 testing
const SkipOAuthButton = () => {
  const [loading, setLoading] = useState(false);
  
  const handleSkipOAuth = async () => {
    setLoading(true);
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
        // Redirect to dashboard
        if (data.redirectUrl) {
          window.location.href = data.redirectUrl;
        } else {
          window.location.href = '/dashboard?amazon_connected=true';
        }
        
        // Show appropriate message
        if (data.sandboxMode && !data.connectionVerified) {
          showNotification('Connected! Using test data.', 'info');
        } else {
          showNotification('Amazon connected successfully!', 'success');
        }
      } else {
        // Fallback to OAuth
        if (data.authUrl) {
          window.location.href = data.authUrl;
        } else {
          showNotification('Failed to connect', 'error');
        }
      }
    } catch (error) {
      console.error('Error:', error);
      showNotification('Failed to connect', 'error');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Button onClick={handleSkipOAuth} disabled={loading}>
      {loading ? 'Connecting...' : 'Skip OAuth use Existing connection'}
    </Button>
  );
};
```

---

### **3. Connection Status Check**

```tsx
// Check if Amazon is connected
const checkConnection = async () => {
  try {
    const response = await fetch(
      `${API_URL}/api/v1/integrations/amazon/status`,
      { credentials: 'include' }
    );
    
    const data = await response.json();
    return {
      connected: data.connected || false,
      sandboxMode: data.sandboxMode || false,
      useMockData: data.useMockGenerator || false,
    };
  } catch (error) {
    return { connected: false };
  }
};
```

---

### **4. Fetch Phase 1 Data**

```tsx
// Fetch Claims (Financial Events)
const fetchClaims = async () => {
  const response = await fetch(
    `${API_URL}/api/v1/integrations/amazon/claims`,
    { credentials: 'include' }
  );
  
  const data = await response.json();
  
  if (data.success) {
    return {
      claims: data.data || [],
      isMock: data.isMock || false,
      mockScenario: data.mockScenario || null,
    };
  }
  throw new Error(data.message || 'Failed to fetch claims');
};

// Fetch Inventory
const fetchInventory = async () => {
  const response = await fetch(
    `${API_URL}/api/v1/integrations/amazon/inventory`,
    { credentials: 'include' }
  );
  
  const data = await response.json();
  
  if (data.success) {
    return {
      inventory: data.data || [],
      isMock: data.isMock || false,
      mockScenario: data.mockScenario || null,
    };
  }
  throw new Error(data.message || 'Failed to fetch inventory');
};

// Fetch Orders
const fetchOrders = async () => {
  const response = await fetch(
    `${API_URL}/api/v1/integrations/amazon/orders`,
    { credentials: 'include' }
  );
  
  const data = await response.json();
  
  if (data.success) {
    return {
      orders: data.data || [],
      isMock: data.isMock || false,
      mockScenario: data.mockScenario || null,
    };
  }
  throw new Error(data.message || 'Failed to fetch orders');
};
```

---

### **5. Mock Data Indicator**

```tsx
// Show indicator when data is mock/test data
const MockDataBadge = ({ isMock, scenario }: { isMock: boolean; scenario?: string }) => {
  if (!isMock) return null;
  
  return (
    <Badge color="blue" variant="outline">
      <Icon name="test-tube" size={14} />
      <span>Test Data {scenario ? `(${scenario})` : ''}</span>
    </Badge>
  );
};
```

---

## 🎨 UI Components Needed

### **Minimal Implementation:**

1. **Connection Button**
   - "Skip OAuth use Existing connection" button
   - Shows loading state

2. **Status Badge**
   - Shows "Connected" or "Not Connected"
   - Shows "Test Data" badge if mock data

3. **Data Lists**
   - Claims list (with mock indicator)
   - Inventory list (with mock indicator)
   - Orders list (with mock indicator)

4. **Sync Button** (Optional)
   - "Sync Now" button
   - Shows sync status

---

## 📋 Response Format Examples

### **Bypass Response (Success):**
```json
{
  "success": true,
  "ok": true,
  "bypassed": true,
  "connectionVerified": false,
  "message": "Amazon connection ready for testing (mock data will be used)",
  "redirectUrl": "http://localhost:3000/dashboard?amazon_connected=true",
  "sandboxMode": true,
  "useMockGenerator": true,
  "note": "Sandbox mode: Proceeding without validation - mock generator will activate"
}
```

### **Claims Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "RMB-12345",
      "orderId": "123-4567890-1234567",
      "amount": 25.50,
      "status": "approved",
      "type": "liquidation_reimbursement",
      "currency": "USD",
      "createdAt": "2024-01-15T10:30:00Z",
      "description": "FBA Liquidation reimbursement",
      "fromApi": true,
      "isMock": true,
      "mockScenario": "normal_week"
    }
  ],
  "message": "Generated 37 mock claims using scenario: normal_week",
  "isMock": true,
  "mockScenario": "normal_week"
}
```

---

## ✅ Implementation Checklist

- [ ] Update `NEXT_PUBLIC_INTEGRATIONS_URL` environment variable
- [ ] Add "Skip OAuth" button component
- [ ] Handle bypass flow response
- [ ] Add connection status check
- [ ] Add mock data indicator component
- [ ] Fetch and display claims
- [ ] Fetch and display inventory
- [ ] Fetch and display orders
- [ ] Add error handling
- [ ] Add loading states

---

## 🚀 Testing

### **Test Flow:**
1. Click "Skip OAuth" button
2. Should redirect to dashboard
3. Should show "Connected (Test Data)" badge
4. Should display mock data in lists
5. Should show mock data indicators

### **Expected Behavior:**
- ✅ Button redirects successfully
- ✅ Connection status shows "Connected"
- ✅ Mock data appears in lists
- ✅ Mock data badges are visible
- ✅ No errors in console

---

## 📚 Full Documentation

See `FRONTEND_PHASE1_REQUIREMENTS.md` for:
- Complete API reference
- Full component examples
- Error handling patterns
- State management examples

---

## 🎉 Summary

**Critical Changes:**
1. ✅ Update API URL
2. ✅ Add "Skip OAuth" button
3. ✅ Fetch Phase 1 data (claims, inventory, orders)
4. ✅ Show mock data indicators

**Time Estimate:** 2-4 hours for basic implementation

**Phase 1 Frontend is ready to build!** 🚀

