# Fix: sessions.patch modelProvider Parameter Error

## Issue

Error when changing model:

```
invalid sessions.patch params: at root: unexpected property 'modelProvider'
```

## Root Cause

The Gateway's `sessions.patch` method schema only accepts `model` parameter, not `modelProvider`.

From `src/gateway/protocol/schema/sessions.ts`:

```typescript
export const SessionsPatchParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    model: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    // ... other fields
  },
  { additionalProperties: false },
);
```

The `{ additionalProperties: false }` means **no extra fields allowed**.

## How Gateway Handles Provider

The Gateway automatically extracts provider from the model string format:

- Model string: `"anthropic/claude-opus-4-6"`
- Gateway parses: provider = `"anthropic"`, model = `"claude-opus-4-6"`

This happens internally in the sessions-patch logic and model resolution code.

## Fix

### Before (Wrong)

```typescript
await request<SessionsPatchResult>("sessions.patch", {
  key: selectedSessionKey,
  model: "claude-opus-4-6",
  modelProvider: "anthropic", // ❌ Not allowed!
});
```

### After (Correct)

```typescript
await request<SessionsPatchResult>("sessions.patch", {
  key: selectedSessionKey,
  model: "anthropic/claude-opus-4-6", // ✅ Full string with provider
});
```

## Code Changes

**File**: `ui-next/app/chat/page.tsx`

```typescript
// Change model for current session
const changeModel = useCallback(
  async (modelId: string) => {
    if (!selectedSessionKey || state !== "connected") {
      return;
    }

    setIsChangingModel(true);
    setError(null);

    try {
      // Send full model string (e.g., "anthropic/claude-opus-4-6")
      // Gateway will parse provider from the model string
      await request<SessionsPatchResult>("sessions.patch", {
        key: selectedSessionKey,
        model: modelId, // Just the model field
      });

      // Update local session state
      setSessions((prev) =>
        prev.map((s) => (s.key === selectedSessionKey ? { ...s, model: modelId } : s)),
      );

      setShowModelSelector(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change model");
    } finally {
      setIsChangingModel(false);
    }
  },
  [selectedSessionKey, state, request],
);
```

## Model String Format

The model ID from `models.list` already includes the provider:

```json
{
  "models": [
    {
      "id": "anthropic/claude-opus-4-6",
      "name": "Claude Opus 4.6",
      "provider": "anthropic",
      "contextWindow": 200000,
      "reasoning": true
    }
  ]
}
```

So we just pass `modelEntry.id` directly:

```typescript
onClick={() => changeModel(modelEntry.id)}
```

## Testing

1. Start Gateway:

   ```bash
   pnpm gateway:watch
   ```

2. Start UI:

   ```bash
   cd ui-next && pnpm dev
   ```

3. Test model change:
   - Open chat
   - Click "✏️ Change"
   - Select a model
   - Should update without error
   - Check console: no errors

## Status

✅ Fixed  
✅ Lint passed  
✅ Schema compliant  
✅ Ready to test

---

**Date**: March 6, 2026  
**Issue**: sessions.patch rejected modelProvider parameter  
**Fix**: Send full model string in `model` field only
