# Test Coverage Matrix

**Goal: 100% coverage** (gradual implementation)

Legend:
- ✅ = tested + passing
- ⏳ = in progress
- ❌ = tested + failing (needs fix)
- ⬜ = not yet tested

---

## detector.ts

| Test Case | Status | Notes |
|-----------|--------|-------|
| FGB: Remainder\|ETA pattern | ⬜ | |
| FGB: Request\|ETA pattern | ⬜ | |
| FGB: Min. N pcs pattern | ⬜ | |
| FGB: NETT PRICE pattern | ⬜ | |
| FGB: 🌳🌳 or 🦊🦊 pattern | ⬜ | |
| FGB: 🏷️ Rp pattern | ⬜ | |
| Littlerazy: HC/HB/PB/BB + price + ETA | ⬜ | |
| Edge: no pattern match | ⬜ | |
| Edge: media-only message | ⬜ | |
| Edge: forwarded message | ⬜ | |

---

## messageHandler.ts - FGB Flow

| Test Case | Status | Notes |
|-----------|--------|-------|
| Forward → detect FGB | ⬜ | |
| Level selection: 1 (hemat) | ⬜ | |
| Level selection: 2 (standar) | ⬜ | |
| Level selection: 3 (premium) | ⬜ | |
| Draft → SEND (dev) | ⬜ | |
| Draft → SEND PROD | ⬜ | |
| Draft → SCHEDULE | ⬜ | |
| Draft → EDIT (manual) | ⬜ | |
| Draft → REGEN (with feedback) | ⬜ | |
| Draft → REGEN (no feedback) | ⬜ | |
| Draft → LINK (change preview) | ⬜ | |
| Draft → COVER (change image) | ⬜ | |
| Draft → CANCEL | ⬜ | |
| BACK: draft → level | ⬜ | |
| BACK: level → supplier | ⬜ | |
| Incomplete: missing close_date | ⬜ | |
| Incomplete: missing min_order | ⬜ | |

---

## messageHandler.ts - Littlerazy Flow

| Test Case | Status | Notes |
|-----------|--------|-------|
| Forward → detect Littlerazy | ⬜ | |
| Level selection: 1/2/3 | ⬜ | |
| Draft commands (all) | ⬜ | |
| BACK navigation | ⬜ | |

---

## messageHandler.ts - Bulk Mode

| Test Case | Status | Notes |
|-----------|--------|-------|
| /bulk 1 start | ⬜ | |
| /bulk 2 start | ⬜ | |
| /bulk 3 start | ⬜ | |
| Collect single item | ⬜ | |
| Collect multiple items | ⬜ | |
| Mixed FGB + Littlerazy | ⬜ | |
| /done with items → preview | ⬜ | |
| /done empty | ⬜ | |
| Preview → YES (send all) | ⬜ | |
| Preview → CANCEL | ⬜ | |
| Preview → SCHEDULE | ⬜ | |
| /supplier switch during bulk | ⬜ | |

---

## messageHandler.ts - Caption Flow

| Test Case | Status | Notes |
|-----------|--------|-------|
| Image-only → start caption | ⬜ | |
| Multiple images | ⬜ | |
| Analysis: single book | ⬜ | |
| Analysis: series detected | ⬜ | |
| Details input: price + format | ⬜ | |
| Details: with ETA | ⬜ | |
| Level selection | ⬜ | |
| Draft commands | ⬜ | |
| BACK navigation | ⬜ | |

---

## messageHandler.ts - Slash Commands

| Test Case | Status | Notes |
|-----------|--------|-------|
| /help | ⬜ | |
| /status | ⬜ | |
| /cancel | ⬜ | |
| /queue | ⬜ | |
| /flush | ⬜ | |
| /history | ⬜ | |
| /history N | ⬜ | |
| /search keyword | ⬜ | |
| /setmarkup | ⬜ | |
| /getmarkup | ⬜ | |
| /supplier fgb | ⬜ | |
| /supplier littlerazy | ⬜ | |
| Greeting (halo, hi) | ⬜ | |

---

## Other Files

| File | Coverage | Notes |
|------|----------|-------|
| stateStore.ts | ⬜ | |
| broadcastStore.ts | ⬜ | |
| aiClient.ts | ⬜ | |
| draftCommands.ts | ⬜ | |

---

**Last Updated:** 2025-12-27
