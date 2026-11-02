// Artifact Launcher Integration
// Add this to your side panel component

import React, { useState, lazy, Suspense } from 'react';

// Lazy load the launcher for better performance
const ArtifactLauncher = lazy(() => 
  import('./features/artifact-launcher/ArtifactLauncher')
);

export const SidePanel: React.FC = () => {
  const [showArtifactLauncher, setShowArtifactLauncher] = useState(false);
  
  // Existing side panel code...
  
  return (
    <div className="side-panel">
      {/* Existing side panel content */}
      
      {/* Add launcher button */}
      <button 
        className="side-panel-button"
        onClick={() => setShowArtifactLauncher(true)}
        title="Open Artifact Launcher"
      >
        📦 Artifacts
      </button>
      
      {/* Lazy-loaded launcher */}
      <Suspense fallback={null}>
        {showArtifactLauncher && (
          <ArtifactLauncher
            isOpen={showArtifactLauncher}
            onClose={() => setShowArtifactLauncher(false)}
          />
        )}
      </Suspense>
      
      {/* Rest of side panel */}
    </div>
  );
};

// Alternative: Feature flag integration
// Add to your feature flags or settings
export const FEATURE_FLAGS = {
  artifactLauncher: true, // Set to false to disable
};

// Conditional rendering with feature flag
export const SidePanelWithFeatureFlag: React.FC = () => {
  const [showLauncher, setShowLauncher] = useState(false);
  
  if (!FEATURE_FLAGS.artifactLauncher) {
    return <div className="side-panel">{/* existing content */}</div>;
  }
  
  return (
    <SidePanel>
      <button onClick={() => setShowLauncher(true)}>
        📦 Artifacts
      </button>
      {showLauncher && (
        <ArtifactLauncher
          isOpen={showLauncher}
          onClose={() => setShowLauncher(false)}
        />
      )}
    </SidePanel>
  );
};