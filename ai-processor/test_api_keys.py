#!/usr/bin/env python3
"""
Simple API Key Tester for Gemini API

Tests all provided API keys to verify they have quota and work properly.
Also tests different models to find the best one for the use case.
"""

import asyncio
import google.generativeai as genai

import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# API Keys to test
env_keys = os.getenv("GEMINI_API_KEYS", "")
if env_keys:
    API_KEYS = [k.strip() for k in env_keys.split(",") if k.strip()]
else:
    # Fallback to single key
    single_key = os.getenv("GEMINI_API_KEY")
    API_KEYS = [single_key] if single_key else []

if not API_KEYS:
    print("❌ No API keys found in environment variables!")
    print("   Please set GEMINI_API_KEYS in .env file.")
    exit(1)

# Models to test (ordered by preference for this use case)
MODELS = [
    "gemini-2.0-flash",          # Latest flash
    "gemini-2.0-flash-exp",      # Experimental
    "gemini-1.5-flash-latest",   # Latest stable flash
    "gemini-1.5-flash-8b",       # Smaller, faster
    "gemini-pro",                # Fallback
]

TEST_PROMPT = """
Translate this to Indonesian in a casual, friendly tone:
"A cute book about a bear going to the museum with friends."
Keep it short, 1-2 sentences only.
"""


def test_key_sync(api_key: str, model_name: str) -> tuple[bool, str]:
    """Test a single API key with a specific model (synchronous)."""
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(model_name)
        
        response = model.generate_content(
            TEST_PROMPT,
            generation_config={
                "temperature": 0.7,
                "max_output_tokens": 100,
            }
        )
        
        return True, response.text.strip()[:100]
        
    except Exception as e:
        error_msg = str(e)
        if "429" in error_msg or "quota" in error_msg.lower():
            return False, "QUOTA_EXCEEDED"
        elif "404" in error_msg or "not found" in error_msg.lower():
            return False, "MODEL_NOT_FOUND"
        elif "API_KEY_INVALID" in error_msg or "invalid" in error_msg.lower():
            return False, "INVALID_KEY"
        else:
            return False, f"ERROR: {error_msg[:50]}"


def main():
    print("=" * 60)
    print("🔑 GEMINI API KEY & MODEL TESTER")
    print("=" * 60)
    print()
    
    results = {}
    working_combos = []
    
    for i, api_key in enumerate(API_KEYS, 1):
        key_suffix = api_key[-8:]
        print(f"\n📌 Testing API Key #{i} (...{key_suffix})")
        print("-" * 40)
        
        key_results = {}
        
        for model_name in MODELS:
            success, result = test_key_sync(api_key, model_name)
            
            status = "✅" if success else "❌"
            print(f"  {status} {model_name}: ", end="")
            
            if success:
                print(f"OK - '{result[:40]}...'")
                working_combos.append((api_key, model_name))
            else:
                print(result)
            
            key_results[model_name] = (success, result)
        
        results[api_key] = key_results
    
    print("\n" + "=" * 60)
    print("📊 SUMMARY")
    print("=" * 60)
    
    if working_combos:
        print(f"\n✅ Found {len(working_combos)} working combination(s):")
        
        # Group by model for recommendation
        model_counts = {}
        for _, model in working_combos:
            model_counts[model] = model_counts.get(model, 0) + 1
        
        # Recommend best model (available with most keys)
        best_model = max(model_counts.items(), key=lambda x: x[1])[0]
        available_keys = [k for k, m in working_combos if m == best_model]
        
        print(f"\n🎯 RECOMMENDED SETUP:")
        print(f"   Model: {best_model}")
        print(f"   Available keys: {len(available_keys)}")
        
        print(f"\n📝 .env configuration:")
        print(f"   GEMINI_API_KEYS={','.join(available_keys)}")
        print(f"   GEMINI_MODEL={best_model}")
        
    else:
        print("\n❌ No working API key + model combinations found!")
        print("   Please check your API keys and quota.")
    
    print("\n" + "=" * 60)
    
    return len(working_combos) > 0


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
