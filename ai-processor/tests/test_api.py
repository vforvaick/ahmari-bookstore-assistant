import pytest
from httpx import AsyncClient, ASGITransport
from main import app

@pytest.mark.asyncio
async def test_parse_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/parse", json={
            "text": "Remainder | ETA : Apr '26\n*Test Book* (HB)\n🏷️ Rp 100.000\n🌳🌳🌳",
            "media_count": 1
        })

    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "Remainder"
    assert data["title"] == "Test Book"
    assert data["price_main"] == 100000

@pytest.mark.asyncio
async def test_generate_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/generate", json={
            "parsed_data": {
                "type": "Remainder",
                "title": "Test Book",
                "format": "HB",
                "price_main": 100000,
                "description_en": "A great book for kids",
                "raw_text": "test",
                "media_count": 1
            }
        })

    assert response.status_code == 200
    data = response.json()
    assert "draft" in data
    assert len(data["draft"]) > 0

@pytest.mark.asyncio
async def test_parse_endpoint_validation():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/parse", json={
            "text": ""  # Missing media_count
        })

    assert response.status_code == 422  # Validation error
