# Feature: Display Model in Chat UI

## Overview

Added model information display to the ui-next chat interface, showing which AI model is being used for each session.

## Changes Made

### File: `ui-next/app/chat/page.tsx`

#### 1. Added Model Display Helper Function

```typescript
const formatModelDisplay = useCallback((session: GatewaySessionRow | undefined) => {
  if (!session) return "";
  if (session.model) {
    if (session.modelProvider) {
      return `${session.modelProvider}/${session.model}`;
    }
    return session.model;
  }
  return "Default model";
}, []);
```

#### 2. Updated Chat Header

Added model display below the session title in the chat header:

```tsx
<div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
  <h2>Session Title</h2>
  <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>
    🤖 anthropic/claude-opus-4-6
  </div>
</div>
```

#### 3. Updated Session List

Added model display in the sidebar session cards:

```tsx
{
  session.model && (
    <div
      style={{
        fontSize: 10,
        color: "var(--muted)",
        fontFamily: "var(--mono)",
        marginTop: 2,
        opacity: 0.8,
      }}
    >
      🤖 {session.modelProvider ? `${session.modelProvider}/` : ""}
      {session.model}
    </div>
  );
}
```

## Data Source

The model information comes from the `GatewaySessionRow` type which already includes:

- `model?: string` - The model ID (e.g., "claude-opus-4-6")
- `modelProvider?: string` - The provider name (e.g., "anthropic", "openai")

These fields are populated by the Gateway when sessions are created or updated.

## Display Format

### With Provider

```
🤖 anthropic/claude-opus-4-6
🤖 openai/gpt-4o
🤖 google/gemini-2.5-pro
```

### Without Provider

```
🤖 claude-opus-4-6
🤖 gpt-4o
```

### No Model Set

```
(Default model)
```

## UI Locations

1. **Chat Header** - Shows below the session title
   - Font: Monospace (`var(--mono)`)
   - Size: 11px
   - Color: Muted (`var(--muted)`)
   - Icon: 🤖 (robot emoji)

2. **Session Sidebar** - Shows below the timestamp
   - Font: Monospace (`var(--mono)`)
   - Size: 10px
   - Color: Muted with 80% opacity
   - Icon: 🤖 (robot emoji)

## Build Status

✅ Build successful
✅ No TypeScript errors
✅ Static generation completed

## Testing

To verify the feature:

1. Start the Gateway:

   ```bash
   pnpm gateway:watch
   ```

2. Open the Chat UI:

   ```bash
   cd ui-next && pnpm dev
   ```

3. Navigate to http://localhost:5174/chat

4. Check that:
   - Session list shows model for each session
   - Chat header shows current session's model
   - Model format is `provider/model` when provider is available
   - Falls back to just model name if provider is missing

## Example Screenshots

### Session List

```
┌─────────────────────────────┐
│ Main Session                │
│ 2 minutes ago               │
│ 🤖 anthropic/claude-opus-4-6│
└─────────────────────────────┘
```

### Chat Header

```
┌────────────────────────────────────────┐
│ ◨ Show Sidebar  Main Session           │
│                 🤖 anthropic/claude...  │
└────────────────────────────────────────┘
```

## Future Enhancements

Potential improvements:

- [ ] Add model icon/logo based on provider
- [ ] Show model capabilities (vision, reasoning, etc.)
- [ ] Add model switcher in chat header
- [ ] Display token usage alongside model
- [ ] Color-code by provider (Anthropic=orange, OpenAI=green, etc.)

---

**Date**: March 6, 2026  
**Feature**: Model display in chat UI  
**Status**: ✅ Complete
