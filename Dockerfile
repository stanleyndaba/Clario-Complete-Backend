FROM python:3.11-slim

WORKDIR /app

# Ensure Python sees our src package and logs immediately
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src

# Install system dependencies for PDF parsing and OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 10000

# Start the application (bind to Render's PORT if provided)
CMD ["sh", "-c", "uvicorn src.app:app --host 0.0.0.0 --port ${PORT:-10000}"]
