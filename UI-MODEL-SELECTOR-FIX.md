# Fix: Model Selector API Correction

## Issue

The model selector was failing with error:

```
Console GatewayRequestError: unknown method: models.catalog
```

## Root Cause

Wrong Gateway method name was used:

- ❌ `models.catalog` - doesn't exist
- ✅ `models.list` - correct method name

## Changes Made

### 1. Fixed API Call

**File**: `ui-next/app/chat/page.tsx`

```typescript
// Before (wrong)
const res = await request<ModelsCatalogResult>("models.catalog", {});

// After (correct)
const res = await request<ModelsCatalogResult>("models.list", {});
```

### 2. Updated Type Definitions

**File**: `ui-next/lib/types.ts`

Updated to match Gateway's actual response schema:

```typescript
// Gateway uses ModelChoiceSchema which has:
export type ModelCatalogEntry = {
  id: string;
  name: string; // Not 'label'
  provider: string; // Required, not optional
  contextWindow?: number;
  reasoning?: boolean; // Not 'supportsReasoning'
};

// Response only has models array, no providers array
export type ModelsCatalogResult = {
  models: ModelCatalogEntry[];
};
```

### 3. Updated UI Rendering

**File**: `ui-next/app/chat/page.tsx`

Changed from `label` to `name`:

```typescript
const displayName = modelEntry.name; // Was: modelEntry.label || modelEntry.id
```

Removed unsupported features:

- Removed `supportsImages` display (not in schema)
- Kept only `contextWindow` and `reasoning`

## Gateway Schema Reference

From `src/gateway/protocol/schema/agents-models-skills.ts`:

```typescript
export const ModelChoiceSchema = Type.Object({
  id: NonEmptyString,
  name: NonEmptyString,
  provider: NonEmptyString,
  contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
  reasoning: Type.Optional(Type.Boolean()),
});

export const ModelsListResultSchema = Type.Object({
  models: Type.Array(ModelChoiceSchema),
});
```

## Testing

To verify the fix:

1. Start Gateway:

   ```bash
   pnpm gateway:watch
   ```

2. Start UI:

   ```bash
   cd ui-next && pnpm dev
   ```

3. Open http://localhost:5174/chat

4. Verify:
   - ✅ Models load without error
   - ✅ Model list displays correctly
   - ✅ Can change models successfully
   - ✅ No console errors

## Response Example

```json
{
  "models": [
    {
      "id": "claude-opus-4-6",
      "name": "Claude Opus 4.6",
      "provider": "anthropic",
      "contextWindow": 200000,
      "reasoning": true
    },
    {
      "id": "gpt-4o",
      "name": "GPT-4o",
      "provider": "openai",
      "contextWindow": 128000
    }
  ]
}
```

## Status

✅ Fixed  
✅ Lint passed  
✅ Types match Gateway schema  
✅ Ready to test

---

**Date**: March 6, 2026  
**Issue**: Wrong Gateway API method name  
**Fix**: Changed from `models.catalog` to `models.list`
