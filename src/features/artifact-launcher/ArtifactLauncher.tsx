// Artifact Launcher Main Component
import React, { useState, useMemo, useCallback } from 'react';
import { useArtifacts } from './hooks/useArtifacts';
import ClusterTile from './ClusterTile';
import ArtifactList from './ArtifactList';
import './styles/artifact-launcher.css';

interface ArtifactLauncherProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ArtifactLauncher: React.FC<ArtifactLauncherProps> = ({ isOpen, onClose }) => {
  const { artifacts, clusters, loading, error } = useArtifacts();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('artifact-favorites');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  // Persist favorites
  React.useEffect(() => {
    localStorage.setItem('artifact-favorites', JSON.stringify([...favorites]));
  }, [favorites]);

  const filteredArtifacts = useMemo(() => {
    if (!artifacts) return [];
    
    let filtered = artifacts;
    
    // Filter by cluster
    if (selectedCluster) {
      const cluster = clusters.find(c => c.id === selectedCluster);
      if (cluster) {
        filtered = filtered.filter(a => cluster.items.includes(a.id));
      }
    }
    
    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(a => 
        a.title.toLowerCase().includes(query) ||
        a.id.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [artifacts, clusters, selectedCluster, searchQuery]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (!isOpen) return null;

  return (
    <div className="artifact-launcher-overlay" onClick={onClose}>
      <div className="artifact-launcher-modal" onClick={e => e.stopPropagation()}>
        <div className="artifact-launcher-header">
          <h2>React Artifacts</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="artifact-launcher-search">
          <input
            type="text"
            placeholder="Search artifacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {loading && <div className="loading">Loading artifacts...</div>}
        {error && <div className="error">{error}</div>}
        
        {!selectedCluster && clusters && (
          <div className="cluster-grid">
            {clusters.slice(0, 6).map(cluster => (
              <ClusterTile
                key={cluster.id}
                cluster={cluster}
                onClick={() => setSelectedCluster(cluster.id)}
              />
            ))}
          </div>
        )}

        {selectedCluster && (
          <ArtifactList
            artifacts={filteredArtifacts}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onBack={() => setSelectedCluster(null)}
            clusterTitle={clusters.find(c => c.id === selectedCluster)?.title}
          />
        )}
      </div>
    </div>
  );
};

export default ArtifactLauncher;