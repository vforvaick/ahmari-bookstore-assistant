import pytest
import os
from gemini_client import GeminiClient
from models import ParsedBroadcast

# Skip tests if no real API key is available
skip_if_no_api_key = pytest.mark.skipif(
    not os.getenv('GEMINI_API_KEY') or os.getenv('GEMINI_API_KEY').startswith('test_'),
    reason="Real GEMINI_API_KEY required for integration tests"
)

@pytest.fixture
def gemini_client():
    return GeminiClient()

@pytest.fixture
def sample_parsed_data():
    return ParsedBroadcast(
        type="Remainder",
        eta="Apr '26",
        close_date="20 Des",
        title="Brown Bear Goes to the Museum",
        format="HB",
        price_main=115000,
        min_order="3 pcs per title. off 10%",
        description_en="Follow Brown Bear and his friends as they explore all of the different rooms - from the transport section to the art gallery...",
        tags=["_New Oct_ 🔥"],
        separator_emoji="🌳",
        media_count=2
    )

@skip_if_no_api_key
@pytest.mark.asyncio
async def test_gemini_client_initializes():
    client = GeminiClient()
    assert client is not None
    assert client.model is not None

@skip_if_no_api_key
@pytest.mark.asyncio
async def test_generate_broadcast_returns_string(gemini_client, sample_parsed_data):
    result = await gemini_client.generate_broadcast(sample_parsed_data)
    assert isinstance(result, str)
    assert len(result) > 0

@skip_if_no_api_key
@pytest.mark.asyncio
async def test_generated_broadcast_contains_indonesian(gemini_client, sample_parsed_data):
    result = await gemini_client.generate_broadcast(sample_parsed_data)
    # Should contain Indonesian greeting or casual words
    indonesian_markers = ['nih', 'bagus', 'untuk', 'ada', 'buku']
    assert any(marker in result.lower() for marker in indonesian_markers)

@skip_if_no_api_key
@pytest.mark.asyncio
async def test_generate_with_user_edit(gemini_client, sample_parsed_data):
    user_edit = "Tolong tambahin info bahwa ini cocok untuk anak 3-5 tahun"
    result = await gemini_client.generate_broadcast(
        sample_parsed_data,
        user_edit=user_edit
    )
    assert isinstance(result, str)
    # Should incorporate the edit
    assert '3' in result or 'tiga' in result.lower()
