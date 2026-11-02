// Artifacts hook
import { useState, useEffect } from 'react';

export interface Artifact {
  id: string;
  title: string;
  entry: string;
  tags: string[];
  thumbnail: string;
  size_bytes: number;
  has_indexeddb_export: boolean;
}

export interface Cluster {
  id: string;
  title: string;
  items: string[];
  representative_thumbnail?: string;
}

export interface ArtifactsData {
  artifacts: Artifact[];
  clusters: Cluster[];
}

export const useArtifacts = () => {
  const [data, setData] = useState<ArtifactsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadArtifacts = async () => {
      try {
        setLoading(true);
        
        // Load artifacts.json
        const artifactsResponse = await fetch('/app/artifacts.json');
        if (!artifactsResponse.ok) {
          throw new Error('Failed to load artifacts');
        }
        const artifactsData = await artifactsResponse.json();
        
        // Load clusters
        const clustersResponse = await fetch('/app/artifact-clusters.json');
        let clusters: Cluster[] = [];
        if (clustersResponse.ok) {
          const clustersData = await clustersResponse.json();
          clusters = clustersData.clusters || [];
        }
        
        setData({
          artifacts: artifactsData.artifacts || [],
          clusters
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load artifacts');
      } finally {
        setLoading(false);
      }
    };

    loadArtifacts();
  }, []);

  return {
    artifacts: data?.artifacts || [],
    clusters: data?.clusters || [],
    loading,
    error
  };
};