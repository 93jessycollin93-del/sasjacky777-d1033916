#!/usr/bin/env python3
"""
Vault Diff Tool
Compare vault states, detect changes, and generate diff reports
"""

import json
import hashlib
from pathlib import Path
from datetime import datetime
import os

class VaultDiffTool:
    def __init__(self, vault_path="E:\\AI_Permanent\\Models"):
        self.vault_path = Path(vault_path)
        self.state_file = Path("C:\\Users\\Eru\\AI_ Workspace\\docs\\vault_state.json")
        
    def calculate_file_hash(self, file_path):
        """Calculate SHA-256 hash of file"""
        sha256_hash = hashlib.sha256()
        try:
            with open(file_path, "rb") as f:
                for byte_block in iter(lambda: f.read(4096), b""):
                    sha256_hash.update(byte_block)
            return sha256_hash.hexdigest()
        except:
            return None
    
    def scan_vault_state(self):
        """Scan current vault state"""
        state = {
            "timestamp": datetime.now().isoformat(),
            "model_families": {}
        }
        
        if not self.vault_path.exists():
            print("Vault path does not exist:", self.vault_path)
            return state
        
        model_families = [
            "QWYTHOS-9B", "Muse-Glimmer-30B", "GPT-OSS",
            "Qwen2-7B", "Llama3-8B", "Mistral-7B", "Phi-3-mini"
        ]
        
        for family in model_families:
            family_path = self.vault_path / family
            if not family_path.exists():
                continue
            
            family_data = {
                "files": {},
                "context_chunks": 0,
                "embedding_pods": 0
            }
            
            # Scan GGUF files
            for file_path in family_path.rglob("*.gguf"):
                file_hash = self.calculate_file_hash(file_path)
                family_data["files"][str(file_path.relative_to(self.vault_path))] = {
                    "size": file_path.stat().st_size,
                    "hash": file_hash,
                    "modified": file_path.stat().st_mtime
                }
            
            # Count context chunks
            for file_path in family_path.rglob("context_chunks*.jsonl"):
                try:
                    with open(file_path, 'r') as f:
                        chunks = len([line for line in f if line.strip()])
                        family_data["context_chunks"] += chunks
                except:
                    pass
            
            # Count embedding pods
            for file_path in family_path.rglob("embedding_pods*.jsonl"):
                try:
                    with open(file_path, 'r') as f:
                        pods = len([line for line in f if line.strip()])
                        family_data["embedding_pods"] += pods
                except:
                    pass
            
            state["model_families"][family] = family_data
        
        return state
    
    def load_previous_state(self):
        """Load previous vault state"""
        if self.state_file.exists():
            try:
                with open(self.state_file, 'r') as f:
                    return json.load(f)
            except:
                return None
        return None
    
    def save_current_state(self, state):
        """Save current vault state"""
        try:
            with open(self.state_file, 'w') as f:
                json.dump(state, f, indent=2)
            return True
        except Exception as e:
            print(f"[ERROR] Failed to save state: {e}")
            return False
    
    def compare_states(self, old_state, new_state):
        """Compare old and new vault states"""
        print("=" * 70)
        print("VAULT DIFF REPORT")
        print("=" * 70)
        print(f"Generated: {datetime.now().isoformat()}")
        print()
        
        if not old_state:
            print("[INFO] No previous state found — this is the baseline scan")
            print("   Saving current state as baseline...")
            return True
        
        print(f"Previous state: {old_state['timestamp']}")
        print(f"Current state: {new_state['timestamp']}")
        print()
        
        changes_detected = False
        
        for family in new_state["model_families"]:
            print(f"Checking {family}...")
            
            old_family = old_state["model_families"].get(family, {})
            new_family = new_state["model_families"][family]
            
            # Compare files
            old_files = old_family.get("files", {})
            new_files = new_family.get("files", {})
            
            # New files
            for file_path in new_files:
                if file_path not in old_files:
                    print(f"  [+NEW] {file_path}")
                    changes_detected = True
            
            # Deleted files
            for file_path in old_files:
                if file_path not in new_files:
                    print(f"  [-DELETED] {file_path}")
                    changes_detected = True
            
            # Modified files
            for file_path in new_files:
                if file_path in old_files:
                    old_hash = old_files[file_path].get("hash")
                    new_hash = new_files[file_path].get("hash")
                    if old_hash and new_hash and old_hash != new_hash:
                        print(f"  [*MODIFIED] {file_path}")
                        print(f"     Old hash: {old_hash[:16]}...")
                        print(f"     New hash: {new_hash[:16]}...")
                        changes_detected = True
            
            # Compare chunk counts
            old_chunks = old_family.get("context_chunks", 0)
            new_chunks = new_family.get("context_chunks", 0)
            
            if old_chunks != new_chunks:
                print(f"  [CHUNK CHANGE] Context chunks changed: {old_chunks} -> {new_chunks}")
                changes_detected = True
            
            # Compare embedding pods
            old_pods = old_family.get("embedding_pods", 0)
            new_pods = new_family.get("embedding_pods", 0)
            
            if old_pods != new_pods:
                print(f"  [POD CHANGE] Embedding pods changed: {old_pods} -> {new_pods}")
                changes_detected = True
            
            if not changes_detected:
                print(f"  [OK] No changes detected")
            
            print()
        
        if changes_detected:
            print("[WARNING] CHANGES DETECTED — Vault state has been modified")
            print()
            print("Recommendations:")
            print("  1. Run integrity dashboard to verify changes")
            print("  2. Check router test suite for compatibility")
            print("  3. Update master manifest if needed")
            return True
        else:
            print("[SUCCESS] NO CHANGES — Vault state is stable")
            return True

    def generate_diff_report(self):
        """Generate comprehensive diff report"""
        print("\n" + "=" * 70)
        print("VAULT DIFF TOOL")
        print("=" * 70)
        print()
        
        # Load previous state
        old_state = self.load_previous_state()
        
        # Scan current state
        print("Scanning current vault state...")
        new_state = self.scan_vault_state()
        
        # Compare
        self.compare_states(old_state, new_state)
        
        # Save current state
        print("Saving current state as new baseline...")
        if self.save_current_state(new_state):
            print("[SUCCESS] State saved successfully")
        else:
            print("[ERROR] Failed to save state")
        
        print()
        print("=" * 70)
        print("DIFF COMPLETE")
        print("=" * 70)
        
        return True

if __name__ == "__main__":
    diff_tool = VaultDiffTool()
    diff_tool.generate_diff_report()
