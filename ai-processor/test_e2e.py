#!/usr/bin/env python3
"""
End-to-end test with the user's sample broadcast text.
Tests both /parse and /generate endpoints.

Requires GEMINI_API_KEYS environment variable.
"""

import os
import sys

# Ensure API keys are set from environment (NOT hardcoded)
if not os.environ.get('GEMINI_API_KEYS'):
    print("❌ Error: GEMINI_API_KEYS environment variable not set")
    print("   Set it with: export GEMINI_API_KEYS='key1,key2,key3'")
    sys.exit(1)
os.environ.setdefault('GEMINI_MODEL', 'gemini-2.5-flash')

import asyncio
from parser import FGBParser
from gemini_client import GeminiClient

# Sample text from user
SAMPLE_TEXT = """Remainder | ETA : Apr '26
_(close : 20 Des)_

*A Mystery at the Incredible Hotel* (HB)
🏷️ Rp 135.000
_*Min. 3 pcs per title. off 10%_
_**OR Min. 16 pcs mix title. off 10%_

🌳🌳🌳
The Delaunay baking competition is coming up. It is taking place at the Incredible Hotel and will judged by guest of honour, the Duchess of Delaunay.

Stefan has perfected his Gingerbread castle recipe but on the morning of the event... the recipe is nowhere to be found.

Luckily, the best detective in Delaunay is on hand - Stefan's best friend, Matilda. Who can the thief be?! Everyone has their theory and the Duchess is ready to point the finger at a baking saboteur.

Just in time, Matilda discovers the recipe has been snatched by the Duchesses dog, who has used it to make a cosy nest for a suprise litter of puppies. All is forgiven and the competition resumes. Stefan wins the prize and Matilda gets the respect she deserves from the very patronising local police department

_Preview :_
* https://www.instagram.com/p/Cxf29QZKpd_/?igsh=MXZqcnZuYmhzcGQ2aA=="""


async def main():
    print("=" * 60)
    print("🧪 END-TO-END TEST: AI Processor")
    print("=" * 60)
    
    # Step 1: Parse
    print("\n📌 STEP 1: Parsing broadcast text...")
    print("-" * 40)
    
    parser = FGBParser()
    try:
        parsed = parser.parse(SAMPLE_TEXT, media_count=1)
        print(f"✅ Parse successful!")
        print(f"   Title: {parsed.title}")
        print(f"   Format: {parsed.format}")
        print(f"   Price: Rp {parsed.price_main:,}" if parsed.price_main else "   Price: N/A")
        print(f"   ETA: {parsed.eta}")
        print(f"   Close: {parsed.close_date}")
        print(f"   Description: {parsed.description_en[:80]}..." if parsed.description_en else "   Description: N/A")
    except Exception as e:
        print(f"❌ Parse failed: {e}")
        return 1
    
    # Step 2: Generate
    print("\n📌 STEP 2: Generating Indonesian broadcast...")
    print("-" * 40)
    
    client = GeminiClient()
    try:
        draft = await client.generate_broadcast(parsed)
        print(f"✅ Generation successful!")
        print(f"\n📝 GENERATED DRAFT:\n")
        print(draft)
    except Exception as e:
        print(f"❌ Generation failed: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    print("\n" + "=" * 60)
    print("🎉 ALL TESTS PASSED!")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
