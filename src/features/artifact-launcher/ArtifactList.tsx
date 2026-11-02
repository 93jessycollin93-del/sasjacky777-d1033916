// Artifact List Component
import React from 'react';
import './styles/artifact-launcher.css';

interface Artifact {
  id: string;
  title: string;
  entry: string;
  thumbnail: string;
  size_bytes: number;
  has_indexeddb_export: boolean;
}

interface ArtifactListProps {
  artifacts: Artifact[];
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  onBack: () => void;
  clusterTitle?: string;
}

export const ArtifactList: React.FC<ArtifactListProps> = ({
  artifacts,
  favorites,
  onToggleFavorite,
  onBack,
  clusterTitle
}) => {
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="artifact-list-container">
      <div className="artifact-list-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h3>{clusterTitle || 'Artifacts'}</h3>
        <span className="artifact-count">{artifacts.length} items</span>
      </div>

      <div className="artifact-list">
        {artifacts.map(artifact => (
          <div key={artifact.id} className="artifact-item">
            <img 
              src={artifact.thumbnail} 
              alt={artifact.title}
              className="artifact-thumbnail"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <div className="artifact-info">
              <h4>{artifact.title}</h4>
              <p className="artifact-meta">
                {formatSize(artifact.size_bytes)} • {artifact.has_indexeddb_export ? 'Has DB' : 'No DB'}
              </p>
            </div>
            <div className="artifact-actions">
              <button 
                className={`favorite-btn ${favorites.has(artifact.id) ? 'active' : ''}`}
                onClick={() => onToggleFavorite(artifact.id)}
                title="Toggle favorite"
              >
                {favorites.has(artifact.id) ? '★' : '☆'}
              </button>
              <button 
                className="open-btn"
                onClick={() => window.open(artifact.entry, '_blank')}
                title="Open artifact"
              >
                Open
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ArtifactList;