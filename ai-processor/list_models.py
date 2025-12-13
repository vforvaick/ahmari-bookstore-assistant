#!/usr/bin/env python3
"""
List available Gemini models and test API keys
"""

import google.generativeai as genai

API_KEYS = [
    "AIzaSyDPOpVXR_JflPd371w0jO01V6ujd5QhhVs",
    "AIzaSyBMITju8UXJTtO_3vAWS2Uh-NPoPige-zw", 
    "AIzaSyA62jYse_Y9081vdbqUesxYoMD9WW7weQU",
]

# Use first key to list models
genai.configure(api_key=API_KEYS[0])

print("Available models that support generateContent:")
print("=" * 50)

available_models = []
for model in genai.list_models():
    if "generateContent" in model.supported_generation_methods:
        print(f"  {model.name}")
        available_models.append(model.name)

print(f"\nTotal: {len(available_models)} models")
print("\n" + "=" * 50)
print("Testing first 3 flash/pro models...")

# Filter flash and pro models
test_models = [m for m in available_models if "flash" in m.lower() or "pro" in m.lower()][:3]

for i, api_key in enumerate(API_KEYS):
    key_suffix = api_key[-8:]
    print(f"\n📌 Testing Key #{i+1} (...{key_suffix})")
    
    genai.configure(api_key=api_key)
    
    for model_name in test_models:
        short_name = model_name.replace("models/", "")
        try:
            model = genai.GenerativeModel(short_name)
            response = model.generate_content("Say 'hello' in Indonesian, one word only")
            print(f"  ✅ {short_name}: {response.text.strip()[:30]}")
        except Exception as e:
            error = str(e)
            if "429" in error or "quota" in error.lower():
                print(f"  ❌ {short_name}: QUOTA EXCEEDED")
            else:
                print(f"  ❌ {short_name}: {error[:50]}")
