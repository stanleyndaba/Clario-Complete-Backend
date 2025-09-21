FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user first
RUN useradd --create-home --shell /bin/bash app

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies globally (before switching to non-root user)
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/
COPY minimal_app.py ./

# Create models directory (models will be downloaded/trained at runtime)
RUN mkdir -p ./models

# Change ownership to app user
RUN chown -R app:app /app
USER app

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

# Default command - run minimal CORS app (root-level) using Render's $PORT
ENV PYTHONUNBUFFERED=1
CMD ["bash", "-lc", "python -m uvicorn minimal_app:app --host 0.0.0.0 --port ${PORT:-8000}"]

