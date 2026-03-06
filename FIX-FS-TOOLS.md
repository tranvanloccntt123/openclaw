# Fix: Missing Filesystem Tools + Default Profile Issue

## Problems Fixed

### Problem 1: AI Cannot Explore Directories

The AI model in chat sessions was unable to read folder contents and was asking users to paste file information instead of being able to explore directories directly.

#### Root Cause

The system prompt (`src/agents/system-prompt.ts`) mentioned three filesystem tools that didn't actually exist:

- `ls: "List directory contents"`
- `grep: "Search file contents with regex"`
- `find: "Find files by glob pattern"`

These tools were referenced but **never implemented**.

### Problem 2: `read` Tool Not Available in New Sessions

Users reported: "I don't have the read tool in this session to read files directly."

#### Root Cause

- **Default profile was "messaging"** - New installations used `"messaging"` profile for security
- **`read` tool only in "coding" profile** - All FS tools belong to "coding" profile
- **"messaging" profile has no file access** - Only session and message tools

## Solutions Implemented

### Solution 1: Created Three New Filesystem Tools

**File:** `src/agents/tools/fs-tools.ts`

1. **`ls` Tool** - List Directory Contents
   - Lists files and directories
   - Supports `detailed` mode (permissions, size, timestamps)
   - Enforces workspace root boundary
2. **`find` Tool** - Find Files by Pattern
   - Glob pattern matching (`*.ts`, `**/*.md`)
   - Recursive search with `**`
   - Skips hidden files and node_modules by default

3. **`grep` Tool** - Search File Contents
   - Regular expression search
   - Context lines support
   - File type filtering

### Solution 2: Changed Default Profile to "coding"

**File:** `src/commands/onboard-config.ts`

Changed `ONBOARDING_DEFAULT_TOOLS_PROFILE` from `"messaging"` to `"coding"`.

**Why this is safe:**

- ✅ Workspace boundary protection still applies
- ✅ Users can manually restrict to "minimal" if needed
- ✅ Most users expect AI to read files for coding tasks
- ✅ Security maintained through path restrictions

## Files Changed

### Created

- `src/agents/tools/fs-tools.ts` - Tool implementations
- `src/agents/tools/fs-tools.test.ts` - Tests (10 tests, all passing)
- `FIX-FS-TOOLS.md` - This documentation

### Modified

1. **`src/agents/tool-catalog.ts`**
   - Added `ls`, `find`, `grep` to `CORE_TOOL_DEFINITIONS`
   - Assigned to "fs" section, "coding" profile

2. **`src/agents/pi-tools.ts`**
   - Imported and instantiated new tools
   - Added to tools array

3. **`src/commands/onboard-config.ts`**
   - Changed default profile: `"messaging"` → `"coding"`

4. **`ui-next/lib/tools-catalog-data.ts`**
   - Updated UI catalog

## Security Features

All filesystem tools include:

- ✅ Workspace boundary enforcement
- ✅ Path traversal prevention
- ✅ Hidden file filtering (grep/find)
- ✅ node_modules exclusion (find)
- ✅ Result limits

## Test Results

```
✓ src/agents/tools/fs-tools.test.ts (10 tests) 13ms
✓ src/commands/onboard-config.test.ts (4 tests) 1ms
```

## Usage Examples

```bash
# List directory
ls path:./src

# Find TypeScript test files
find pattern:"**/*.test.ts"

# Search for function definitions
grep pattern:"^export function" include:"*.ts"

# Search with context
grep pattern:"TODO" context:3 maxResults:10
```

## For Existing Users

If you already have a config file, update `~/.openclaw/openclaw.json`:

```json
{
  "tools": {
    "profile": "coding"
  }
}
```

Or run:

```bash
openclaw config set tools.profile '"coding"'
```

## Impact

- ✅ AI can now explore directory structures independently
- ✅ No more asking users to paste file listings
- ✅ `read` tool available by default for new installations
- ✅ Better codebase understanding
- ✅ More efficient file operations
- ✅ Consistent with system prompt documentation

---

**Date**: March 6, 2026  
**Issues**:

- Session chat - model cannot read folders
- Missing read tool in new sessions  
  **Fixes**:
- Implemented missing filesystem tools (ls, find, grep)
- Changed default profile from "messaging" to "coding"
