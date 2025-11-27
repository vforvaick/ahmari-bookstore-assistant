# AI Processor Service

FastAPI service for parsing FGB broadcast messages and generating Indonesian broadcasts using Gemini AI.

## Setup

1. Create a virtual environment:
```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create a `.env` file with your Gemini API key:
```bash
GEMINI_API_KEY=your_actual_gemini_api_key_here
```

## Running Tests

```bash
# Run all tests
pytest -v

# Run parser tests only (no API key required)
pytest tests/test_parser.py -v

# Run Gemini tests (requires valid GEMINI_API_KEY)
pytest tests/test_gemini.py -v
```

Note: Gemini integration tests will be skipped if no valid API key is found.

## Running the Server

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## API Endpoints

- `GET /health` - Health check
- `GET /` - Service info
- `POST /parse` - Parse FGB broadcast text
- `POST /generate` - Generate Indonesian broadcast
- `POST /extract-style` - Extract style from chat (future)

## Docker

```bash
docker build -t ai-processor .
docker run -p 8000:8000 -e GEMINI_API_KEY=your_key ai-processor
```
