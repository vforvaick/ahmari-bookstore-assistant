import pytest
from parser import FGBParser

@pytest.fixture
def sample_fgb_text():
    return """Remainder | ETA : Apr '26
Close : 20 Des

*Brown Bear Goes to the Museum* (HB)
🏷️ Rp 115.000
*Min. 3 pcs per title. off 10%
**OR Min. 16 pcs mix title. off 10%

Follow Brown Bear and his friends as they explore
all of the different rooms - from the transport
section to the art gallery...

_New Oct_ 🔥

🌳🌳🌳"""

def test_parser_extracts_type():
    parser = FGBParser()
    text = "Remainder | ETA : Apr '26\nSome content\n🌳🌳🌳"
    result = parser.parse(text, media_count=1)
    assert result.type == "Remainder"

def test_parser_extracts_eta():
    parser = FGBParser()
    text = "Remainder | ETA : Apr '26\nSome content\n🌳🌳🌳"
    result = parser.parse(text, media_count=1)
    assert result.eta == "Apr '26"

def test_parser_extracts_title_and_format():
    parser = FGBParser()
    text = "*Brown Bear Goes to the Museum* (HB)\n🏷️ Rp 115.000\n🌳🌳🌳"
    result = parser.parse(text, media_count=1)
    assert result.title == "Brown Bear Goes to the Museum"
    assert result.format == "HB"

def test_parser_extracts_price():
    parser = FGBParser()
    text = "*Some Book* (HB)\n🏷️ Rp 115.000\n🌳🌳🌳"
    result = parser.parse(text, media_count=1)
    assert result.price_main == 115000

def test_parser_extracts_separator_emoji():
    parser = FGBParser()
    text1 = "Some text\n🌳🌳🌳"
    result1 = parser.parse(text1, media_count=1)
    assert result1.separator_emoji == "🌳"

    text2 = "Some text\n🦊🦊🦊"
    result2 = parser.parse(text2, media_count=1)
    assert result2.separator_emoji == "🦊"

def test_parser_full_broadcast(sample_fgb_text):
    parser = FGBParser()
    result = parser.parse(sample_fgb_text, media_count=2)

    assert result.type == "Remainder"
    assert result.eta == "Apr '26"
    assert result.close_date == "20 Des"
    assert result.title == "Brown Bear Goes to the Museum"
    assert result.format == "HB"
    assert result.price_main == 115000
    assert "_New Oct_" in result.tags
    assert result.separator_emoji == "🌳"
    assert "Follow Brown Bear" in result.description_en
