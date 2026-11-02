# Artifact Launcher Feature

## Overview
Isolated, lazy-loaded feature for browsing and launching React Artifact HTML apps from the Jackie Studio side panel.

## Features
- **Clustered view**: Artifacts grouped by size/type
- **Search**: Fuzzy search across artifact titles and IDs
- **Favorites**: Pin artifacts to local storage
- **Preview**: Sandboxed iframe preview
- **Actions**: Open in pane, external browser, export IndexedDB, open folder

## Files Structure
```
src/features/artifact-launcher/
├── ArtifactLauncher.tsx      # Main launcher component
├── ClusterTile.tsx           # Cluster display component
├── ArtifactList.tsx          # Virtualized artifact list
├── hooks/
│   └── useArtifacts.ts       # Data fetching hook
├── styles/
│   └── artifact-launcher.css # Component styles
├── INTEGRATION.md            # Integration instructions
├── TAURI_COMMANDS.md         # Tauri backend commands
└── README.md                 # This file
```

## Integration

### Step 1: Add to Side Panel
```tsx
import React, { lazy, Suspense } from 'react';

const ArtifactLauncher = lazy(() => 
  import('./features/artifact-launcher/ArtifactLauncher')
);

export const SidePanel = () => {
  const [showLauncher, setShowLauncher] = useState(false);
  
  return (
    <>
      <button onClick={() => setShowLauncher(true)}>
        📦 Artifacts
      </button>
      <Suspense fallback={null}>
        {showLauncher && (
          <ArtifactLauncher
            isOpen={showLauncher}
            onClose={() => setShowLauncher(false)}
          />
        )}
      </Suspense>
    </>
  );
};
```

### Step 2: Configure Tauri
Add commands to `src-tauri/src/main.rs` (see TAURI_COMMANDS.md)

### Step 3: Copy Artifacts
Ensure `app/artifacts.json` and `app/artifact-clusters.json` are in the build output.

## Testing
```bash
# Run tests
npm test src/features/artifact-launcher

# Test clustering
npm test src/features/artifact-launcher/__tests__/clustering.test.ts

# Test search
npm test src/features/artifact-launcher/__tests__/search.test.ts
```

## Safety
- No remote downloads without consent
- Sandboxed iframe preview with resource limits
- Context isolation enabled
- No nodeIntegration in webviews

## Performance
- Lazy loaded on demand
- Virtualized list for large artifact collections
- Artifacts loaded on demand
- Favorites persisted in localStorage

## Build
The feature is self-contained and doesn't modify existing UI code. It's feature-flagged and can be disabled via `FEATURE_FLAGS.artifactLauncher`.