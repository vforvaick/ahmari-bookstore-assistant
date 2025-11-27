from fastapi import FastAPI
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    gemini_api_key: str

    class Config:
        env_file = ".env"

settings = Settings()
app = FastAPI(title="AI Processor", version="1.0.0")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "ai-processor"}

@app.get("/")
async def root():
    return {
        "service": "AI Processor",
        "version": "1.0.0",
        "endpoints": ["/parse", "/generate", "/extract-style"]
    }
