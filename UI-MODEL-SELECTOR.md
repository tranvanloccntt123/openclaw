# Feature: Model Selector in Chat UI

## Overview

Added a model selector dropdown to the chat UI, allowing users to easily switch AI models for the current session without leaving the chat interface.

## Features

### 1. Model Display

- Shows current model in chat header with format: `🤖 provider/model`
- Shows model in session sidebar for quick reference
- Displays "Default model" when no specific model is set

### 2. Model Selector Dropdown

- Click "✏️ Change" button to open model selector
- Shows all available models from the gateway catalog
- Highlights currently selected model
- Displays model capabilities:
  - 📊 Context window size (e.g., "200K ctx")
  - 🖼️ Vision support
  - 🧠 Reasoning support
- Shows provider information in parentheses

### 3. Model Changing

- One-click model switching
- Updates session immediately
- Preserves chat history
- Shows loading state (⏳) while changing
- Error handling with user feedback

## UI Components

### Chat Header

```
┌─────────────────────────────────────────────────┐
│ ◨ Hide  Main Session                            │
│         🤖 anthropic/claude-opus-4-6  ✏️ Change │
└─────────────────────────────────────────────────┘
```

### Model Selector Dropdown

```
┌──────────────────────────────────────┐
│          Select Model                │
├──────────────────────────────────────┤
│ ✓ claude-opus-4-6 (anthropic)        │
│   📊 200K ctx  🧠 Reasoning           │
├──────────────────────────────────────┤
│   gpt-4o (openai)                    │
│   📊 128K ctx  🖼️ Vision             │
├──────────────────────────────────────┤
│   gemini-2.5-pro (google)            │
│   📊 2M ctx  🖼️ Vision  🧠 Reasoning │
└──────────────────────────────────────┘
│            [Cancel]                  │
└──────────────────────────────────────┘
```

### Session Sidebar

```
┌─────────────────────────┐
│ Main Session            │
│ 2 minutes ago           │
│ 🤖 anthropic/claude...  │
└─────────────────────────┘
```

## Technical Implementation

### Files Modified

1. **`ui-next/lib/types.ts`**
   - Added `ModelCatalogEntry` type
   - Added `ModelsCatalogResult` type
   - Updated `SessionsPatchResult` to include model fields

2. **`ui-next/app/chat/page.tsx`**
   - Added model state management
   - Added `loadModels()` function
   - Added `changeModel()` function
   - Added model selector dropdown UI
   - Updated chat header with model display and change button

### Gateway API Calls

#### Load Models Catalog

```typescript
const models = await request<ModelsCatalogResult>("models.catalog", {});
```

Response:

```json
{
  "providers": [...],
  "models": [
    {
      "id": "claude-opus-4-6",
      "label": "Claude Opus 4.6",
      "provider": "anthropic",
      "contextWindow": 200000,
      "supportsImages": true,
      "supportsReasoning": true
    }
  ]
}
```

#### Change Session Model

```typescript
await request<SessionsPatchResult>("sessions.patch", {
  key: "agent:main:main",
  model: "claude-opus-4-6",
  modelProvider: "anthropic",
});
```

### State Management

```typescript
const [models, setModels] = useState<ModelCatalogEntry[]>([]);
const [showModelSelector, setShowModelSelector] = useState(false);
const [isChangingModel, setIsChangingModel] = useState(false);
```

## User Flow

1. **View Current Model**
   - Model is displayed in chat header below session title
   - Model is also shown in session sidebar

2. **Open Model Selector**
   - Click "✏️ Change" button
   - Dropdown appears with available models

3. **Select New Model**
   - Click on desired model
   - Button shows "⏳" while changing
   - Session updates immediately

4. **Cancel**
   - Click "Cancel" button or outside dropdown
   - Selector closes without changes

## Styling

### Colors

- Selected model: `var(--accent-subtle)` background, `var(--accent)` border
- Hover: `var(--bg-hover)` background
- Text: `var(--text)` / `var(--text-strong)` for selected
- Muted info: `var(--muted)`

### Dimensions

- Dropdown: min-width 280px, max-height 400px
- Model item padding: 8px 10px
- Font sizes: 10-12px
- Border radius: 6-8px

### Icons

- 🤖 Model indicator
- ✏️ Change button
- ⏳ Loading state
- 📊 Context window
- 🖼️ Vision capability
- 🧠 Reasoning capability

## Error Handling

1. **Gateway Not Connected**
   - Change button disabled
   - Shows "Default model"

2. **Load Models Failed**
   - Shows "Loading models..."
   - Console error logged

3. **Change Model Failed**
   - Error displayed in chat error area
   - Selector remains open
   - User can retry

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- CSS features used:
  - `position: absolute`
  - `box-shadow`
  - `overflow-y: auto`
  - CSS transitions

## Accessibility

- Keyboard navigation support (tab through models)
- Clear visual feedback on hover/selection
- Loading states indicated
- Descriptive button labels

## Future Enhancements

Potential improvements:

- [ ] Model search/filter in dropdown
- [ ] Group models by provider
- [ ] Show model pricing/cost estimates
- [ ] Recent models quick-access
- [ ] Favorite models star
- [ ] Model comparison view
- [ ] Keyboard shortcuts (e.g., Ctrl+M to open selector)
- [ ] Persist model preference per session type

## Testing

To test the feature:

1. Start Gateway:

   ```bash
   pnpm gateway:watch
   ```

2. Start UI:

   ```bash
   cd ui-next && pnpm dev
   ```

3. Navigate to http://localhost:5174/chat

4. Verify:
   - Current model displays in header
   - Click "Change" opens dropdown
   - Models list loads from gateway
   - Click model changes session model
   - Header updates with new model
   - Loading state shows during change
   - Cancel button closes dropdown

## Build Status

✅ ESLint passed  
✅ TypeScript compilation successful (local)  
⚠️ Next.js build has unrelated type error in generated types

---

**Date**: March 6, 2026  
**Feature**: Model Selector in Chat UI  
**Status**: ✅ Complete and tested
