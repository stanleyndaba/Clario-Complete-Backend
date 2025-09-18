# API Documentation

## Endpoints

### POST /predict-success

Predict refund success probability.

**Request Body:**
```json
{
  "feature1": 1.0,
  "feature2": 2.0
}
```

**Response:**
```json
{
  "success_probability": 0.75
}
```

## Usage Examples

### Python
```python
import requests

response = requests.post(
    "http://localhost:8000/predict-success",
    json={"feature1": 1.0, "feature2": 2.0}
)
print(response.json())
```

### cURL
```bash
curl -X POST "http://localhost:8000/predict-success" \
     -H "Content-Type: application/json" \
     -d '{"feature1": 1.0, "feature2": 2.0}'
``` 