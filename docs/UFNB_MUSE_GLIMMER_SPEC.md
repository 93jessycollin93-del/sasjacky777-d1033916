# Universal Floating Navigation Bar – Muse Glimmer Spec

## Objective
Create a persistent, draggable, resizable, dockable floating navigation bar for the Jackie / Apex Intelligence Hub app that is context-aware and works across all pods.

## Design Requirements
- **Positioning**: Floating, draggable with long-press grip (reuse existing DraggableToolbar behavior). Snap to nearest horizontal edge on release.
- **Persistence**: Store position in localStorage under `jackie.ufnb.pos.v1`.
- **Theming**: Use Tailwind design tokens `bg-popover/95 backdrop-blur-md border border-border rounded-full shadow-lg`.
- **Layout**: Horizontal pill toolbar with icon buttons, 16px icons, 1.5rem padding.
- **Responsiveness**: Min width 280px, max width 720px, resizable via corner handle.

## Core Buttons
1. Back – `ArrowLeft`, `navigate(-1)`
2. Home/Commander – `Home`, navigate `/`
3. Pods Index – `LayoutGrid`, navigate `/pods`
4. Agents Panel – `Bot`, navigate `/agent-lab`
5. Files / Internal Filing System – `FileText`, navigate `/vault`
6. Time Manager – `Clock`, navigate `/control`
7. Notifications – `Bell`, placeholder action
8. Settings – `Settings`, navigate `/keys`
9. Quick Search – `Search`, trigger ⌘K modal

## Additional Widgets (expandable)
- Mini-map of active pods
- Live agent activity pulse
- Task Queue Viewer
- System Health Pulse
- Recorder/Archiver status indicator
- Dynamic shortcuts based on current route

## Context Awareness
- Hide Back button on root `/` route.
- Highlight active route button.
- Disable buttons for routes requiring auth if unauthenticated.

## Muse Glimmer Prompt
```
Create a React + Tailwind floating navigation bar component named UniversalFloatingNavBar for a Vite React app using react-router-dom.

Requirements:
- Use existing DraggableToolbar primitive with storageKey "jackie.ufnb.pos.v1".
- Render a pill-shaped toolbar with icon buttons: ArrowLeft Back, Home, LayoutGrid Pods, Bot Agents, FileText Files, Clock Time, Bell Notifications, Settings, Search Quick Search.
- Back button calls navigate(-1). Others navigate to /, /pods, /agent-lab, /vault, /control, /keys respectively.
- Styling: fixed z-40, rounded-full, bg-popover/95 backdrop-blur-md, border border-border, shadow-lg, padding 6px 8px.
- Draggable via long-press grip, snap to edge on release, position persisted to localStorage.
- Add hover states and aria-labels.
- Export default component.
```

## Integration Notes
- Import in `src/App.tsx` and render inside `<BrowserRouter>` after `<SandboxCatcher>`.
- Ensure component is rendered only after auth is resolved to avoid navigation errors.
- UFNB provides universal back fallback for pages missing top-left Back.

## Acceptance Criteria
- Bar is visible on all protected routes.
- Draggable and resizable.
- Back works on all pages except home.
- Buttons navigate to correct routes.
- Position persists across reloads.
