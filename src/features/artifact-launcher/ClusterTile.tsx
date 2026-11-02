// Cluster Tile Component
import React from 'react';
import './styles/artifact-launcher.css';

interface Cluster {
  id: string;
  title: string;
  items: string[];
  representative_thumbnail?: string;
}

interface ClusterTileProps {
  cluster: Cluster;
  onClick: () => void;
}

export const ClusterTile: React.FC<ClusterTileProps> = ({ cluster, onClick }) => {
  return (
    <div className="cluster-tile" onClick={onClick}>
      <div className="cluster-tile-content">
        <h3>{cluster.title}</h3>
        <p>{cluster.items.length} artifacts</p>
      </div>
      {cluster.representative_thumbnail && (
        <img 
          src={cluster.representative_thumbnail} 
          alt={cluster.title}
          className="cluster-thumbnail"
        />
      )}
    </div>
  );
};

export default ClusterTile;