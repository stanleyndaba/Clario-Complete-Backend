# Tech Stack - Investor Response

## Recommended Answer

**What tech stack are you using, or planning to use, to build this product?**

### Backend Architecture
We use a **hybrid microservices architecture** with two specialized backends:

1. **Python (FastAPI)** - Core AI & Data Processing
   - Document parsing and extraction (PDF, images, emails)
   - ML-based claim detection and matching
   - Evidence processing and validation
   - API gateway for frontend integration

2. **Node.js/Express (TypeScript)** - Integrations & Orchestration
   - OAuth integrations (Amazon SP-API, Gmail, Google Drive, Outlook, Dropbox)
   - Real-time sync and monitoring
   - WebSocket/SSE for live updates
   - Workflow orchestration and job queuing

### Frontend
- **React** - Modern, component-based UI
- Real-time updates via Server-Sent Events (SSE)
- Responsive design for desktop and mobile

### Database
- **PostgreSQL** (via Supabase)
   - User authentication and sessions
   - Evidence documents and metadata
   - Claim tracking and status
   - Integration tokens (encrypted)

### AI & Machine Learning
We use a **layered extraction strategy** for document processing:

1. **Regex + Heuristics** (fast, cost-effective)
   - Pattern matching for common invoice formats
   - Structured data extraction

2. **OCR** (Tesseract)
   - Handles scanned documents and images
   - Fallback for PDFs without text layer

3. **ML Services** (ready for integration)
   - **AWS Textract** - Advanced document analysis
   - **Google Vision API** - Image and text recognition
   - **OpenAI GPT-4/Vision** - Planned for complex document understanding and claim generation
   - Our proprietary FBA policy logic and data models

**Current Status:**
- Regex + OCR parsing: **✅ Implemented and working**
- ML services (Textract, Vision): **🔧 Integration points ready**
- OpenAI GPT-4/Vision: **📋 Planned for Evidence Agent and Filing Agent**

### Infrastructure & Hosting
**Current Deployment:**
- **Render** - Python API and Node.js backend
- **Vercel** - Frontend hosting
- **Supabase** - PostgreSQL database and authentication

**Production Plan:**
- **AWS** - Planned migration for production scale
   - Better reliability and performance
   - Enhanced security and compliance
   - Scalable infrastructure for ML workloads

### Key Technologies
- **Authentication**: JWT tokens, OAuth 2.0
- **Real-time**: WebSocket, Server-Sent Events (SSE)
- **Queue System**: Bull/BullMQ (Redis-based)
- **File Processing**: Multer (Node.js), FastAPI UploadFile
- **Document Parsing**: PyPDF2, pdfplumber, Tesseract OCR
- **API Gateway**: FastAPI with consolidated routers

### Security
- Encrypted token storage
- JWT-based authentication
- CORS protection
- Rate limiting
- Secure OAuth flows

## Why This Architecture?

1. **Separation of Concerns**: Python for AI/ML, Node.js for integrations
2. **Scalability**: Microservices can scale independently
3. **Cost Efficiency**: Regex/OCR first, ML only when needed
4. **Reliability**: Layered fallbacks ensure processing continues
5. **Future-Proof**: Ready for advanced AI integration (GPT-4, Vision)

## Production Roadmap

- **Phase 1** (Current): Regex + OCR parsing ✅
- **Phase 2** (Next): AWS Textract integration 🔧
- **Phase 3** (Planned): OpenAI GPT-4/Vision for complex documents 📋
- **Phase 4** (Planned): Full AWS migration for production scale 🚀





