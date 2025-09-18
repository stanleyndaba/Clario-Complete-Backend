# 🔐 Authentication & Stripe Integration Workflow

## Complete User Journey: Auth → Amazon OAuth → Stripe Integration

---

## 🎯 **Phase 1: User Authentication**

### **1.1 Initial User Login**
```
User visits frontend → Clicks "Login with Amazon" → Redirected to main-api
```

**Endpoint:** `GET /api/auth/amazon/start`

**Flow:**
1. **Frontend** calls main-api to initiate Amazon OAuth
2. **main-api** generates OAuth state and redirects to Amazon
3. **Amazon** shows login/consent screen
4. **User** logs in and grants permissions
5. **Amazon** redirects back with authorization code

**Code Location:** `src/api/auth.py:amazon_callback()`

---

### **1.2 Amazon OAuth Callback**
```
Amazon redirects → main-api processes → Creates user session → Triggers sync
```

**Endpoint:** `GET /api/auth/amazon/callback`

**Flow:**
1. **Amazon** redirects with `code` and `state`
2. **main-api** validates OAuth state
3. **main-api** exchanges code for access/refresh tokens
4. **main-api** creates/updates user in database
5. **main-api** creates JWT session token
6. **main-api** sets secure HTTP-only cookie
7. **main-api** triggers first-time inventory sync
8. **User** redirected to dashboard

**Key Data Stored:**
- User profile (email, name, Amazon seller ID)
- Encrypted OAuth tokens
- Session JWT token
- Integration status

---

## 🎯 **Phase 2: Amazon Integration Setup**

### **2.1 Amazon OAuth Processing**
```
main-api → integrations-backend → Amazon SP-API → Token storage
```

**Flow:**
1. **main-api** calls `integrations-backend` to process OAuth
2. **integrations-backend** exchanges code for tokens
3. **integrations-backend** stores encrypted tokens in database
4. **integrations-backend** validates Amazon SP-API access
5. **integrations-backend** triggers silent Stripe onboarding

**Code Location:** `Integrations-backend/src/controllers/amazonController.ts`

**Key Features:**
- **State validation** with Redis
- **Token encryption** before storage
- **Automatic refresh** token management
- **Silent Stripe onboarding** triggered

---

### **2.2 Data Synchronization**
```
integrations-backend → Amazon SP-API → Inventory/Claims data → Database
```

**Flow:**
1. **integrations-backend** starts background sync job
2. **integrations-backend** fetches inventory data from Amazon SP-API
3. **integrations-backend** processes and stores data
4. **integrations-backend** triggers claim detection
5. **User** sees data in dashboard

---

## 🎯 **Phase 3: Stripe Integration**

### **3.1 Silent Stripe Onboarding**
```
Amazon OAuth success → Silent Stripe onboarding → Connect account creation
```

**Flow:**
1. **Amazon OAuth** completes successfully
2. **integrations-backend** enqueues silent Stripe onboarding job
3. **stripe-payments** creates Stripe Connect account
4. **stripe-payments** stores account details
5. **User** ready for payment processing

**Code Location:** `stripe-payments/src/controllers/checkoutController.ts:connectAccount()`

---

### **3.2 Stripe Customer Setup**
```
User action → Create Stripe customer → Setup payment method → Ready for payments
```

**Endpoint:** `POST /api/v1/stripe/create-customer-setup`

**Flow:**
1. **Frontend** calls stripe-payments to create customer
2. **stripe-payments** creates Stripe customer
3. **stripe-payments** creates SetupIntent for payment method
4. **Frontend** collects payment method (card)
5. **Frontend** confirms SetupIntent
6. **stripe-payments** stores payment method
7. **User** ready for commission charging

---

## 🎯 **Phase 4: Payment Processing**

### **4.1 Commission Charging**
```
Refund confirmed → Calculate 20% fee → Charge customer → Process payout
```

**Endpoint:** `POST /api/v1/stripe/charge-commission`

**Flow:**
1. **Refund Engine** confirms Amazon refund
2. **Refund Engine** calls stripe-payments with refund details
3. **stripe-payments** calculates 20% platform fee
4. **stripe-payments** creates PaymentIntent
5. **stripe-payments** charges customer's payment method
6. **stripe-payments** processes payout to seller
7. **stripe-payments** logs transaction

**Code Location:** `stripe-payments/src/services/stripeService.ts:createPaymentIntent()`

---

### **4.2 Webhook Processing**
```
Stripe events → Webhook endpoint → Background processing → Status updates
```

**Webhook Endpoint:** `POST /webhooks/stripe`

**Supported Events:**
- `payment_intent.succeeded` - Commission charged successfully
- `payment_intent.payment_failed` - Commission charge failed
- `charge.succeeded` - Payment processed
- `transfer.paid` - Seller payout completed
- `invoice.paid` - Subscription payment received

**Flow:**
1. **Stripe** sends webhook event
2. **stripe-payments** verifies webhook signature
3. **stripe-payments** processes event in background
4. **stripe-payments** updates transaction status
5. **stripe-payments** triggers seller payout if applicable

---

## 🔄 **Complete Data Flow**

### **Authentication Flow**
```
Frontend → main-api → Amazon OAuth → integrations-backend → Stripe onboarding
```

### **Payment Flow**
```
Refund Engine → stripe-payments → Stripe API → Webhooks → Status updates
```

### **Data Sync Flow**
```
integrations-backend → Amazon SP-API → Database → Claim detection → Refund processing
```

---

## 🛡️ **Security Features**

### **JWT Authentication**
- **Session tokens** for user authentication
- **Service-to-service** JWT for internal calls
- **Token expiration** and refresh handling
- **Role-based access** control

### **Token Encryption**
- **OAuth tokens** encrypted before database storage
- **Refresh tokens** encrypted with Fernet
- **JWT secrets** rotated regularly
- **Secure cookie** handling

### **Stripe Security**
- **PCI compliance** - no raw card data storage
- **Webhook signature** verification
- **Idempotency keys** for safe retries
- **Audit trail** for all transactions

---

## 📊 **Database Schema**

### **User Data**
- `users` - User profiles and authentication
- `oauth_tokens` - Encrypted OAuth tokens
- `integration_status` - Integration states

### **Stripe Data**
- `stripe_accounts` - Seller Connect accounts
- `stripe_customers` - Customer mappings
- `stripe_transactions` - Payment records
- `transaction_audit` - Audit trail

### **Amazon Data**
- `amazon_claims` - FBA claims data
- `inventory_data` - Product inventory
- `sync_jobs` - Background job tracking

---

## 🚀 **Deployment Considerations**

### **Environment Variables**
- **JWT secrets** must be consistent across services
- **Stripe keys** must be properly configured
- **Database URLs** must be accessible
- **Redis URLs** must be configured

### **Service Dependencies**
- **main-api** depends on integrations-backend and stripe-payments
- **integrations-backend** depends on Amazon SP-API
- **stripe-payments** depends on Stripe API
- **All services** depend on database and Redis

### **Health Checks**
- **Authentication** endpoints must be healthy
- **OAuth flows** must be working
- **Stripe webhooks** must be accessible
- **Database connections** must be stable

---

## 🎯 **Key Integration Points**

### **1. main-api ↔ integrations-backend**
- **OAuth processing** and token management
- **User data** synchronization
- **Integration status** updates

### **2. main-api ↔ stripe-payments**
- **User authentication** for Stripe operations
- **Commission charging** requests
- **Transaction status** updates

### **3. integrations-backend ↔ stripe-payments**
- **Silent onboarding** after Amazon OAuth
- **User data** sharing
- **Payment method** setup

### **4. All services ↔ Database**
- **User data** persistence
- **Transaction records**
- **Audit trails**

---

## ✅ **Testing Checklist**

### **Authentication Flow**
- [ ] Amazon OAuth initiation works
- [ ] OAuth callback processes correctly
- [ ] JWT tokens are created and validated
- [ ] User sessions are maintained

### **Stripe Integration**
- [ ] Stripe Connect accounts are created
- [ ] Payment methods can be saved
- [ ] Commission charging works
- [ ] Webhooks are processed correctly

### **End-to-End Flow**
- [ ] User can log in with Amazon
- [ ] Data syncs from Amazon
- [ ] Claims are detected and processed
- [ ] Refunds trigger commission charging
- [ ] Sellers receive payouts

---

This workflow ensures a seamless user experience from authentication through payment processing, with proper security and error handling at every step.

