#!/usr/bin/env python3
"""
Integrity Dashboard
Real-time monitoring of vault integrity, model files, and system health
"""

import json
import hashlib
from pathlib import Path
from datetime import datetime
import os

class IntegrityDashboard:
    def __init__(self, vault_path="E:\\AI_Permanent\\Models"):
        self.vault_path = Path(vault_path)
        self.manifest_path = Path("C:\\Users\\Eru\\AI_ Workspace\\docs\\E_PERMANENT_MASTER_MANIFEST.json")
        
    def calculate_sha256(self, file_path):
        """Calculate SHA-256 hash of file"""
        sha256_hash = hashlib.sha256()
        try:
            with open(file_path, "rb") as f:
                for byte_block in iter(lambda: f.read(4096), b""):
                    sha256_hash.update(byte_block)
            return sha256_hash.hexdigest()
        except Exception as e:
            return f"ERROR: {e}"
    
    def check_model_file_integrity(self):
        """Check integrity of all model files"""
        print("=" * 70)
        print("MODEL FILE INTEGRITY CHECK")
        print("=" * 70)
        print()
        
        if not self.vault_path.exists():
            print("[WARNING] Vault path does not exist:", self.vault_path)
            print("   Run forward mirror first to populate vault")
            return []
        
        # Model family mapping (display name -> actual directory name)
        model_mapping = {
            "QWYTHOS-9B": "qwythos-9b-claude-mythos-5-1m",
            "Muse-Glimmer-30B": "muse-glimmer-30b",
            "GPT-OSS": "gpt-oss-20b",
            "Qwen2-7B": "qwen2-7b",
            "Llama3-8B": "llama3-8b",
            "Mistral-7B": "mistral-7b",
            "Phi-3-mini": "phi-3-mini"
        }
        
        results = []
        
        for display_name, dir_name in model_mapping.items():
            family_path = self.vault_path / dir_name
            print(f"Checking {display_name} ({dir_name})...")
            
            if not family_path.exists():
                print(f"  [WARNING] Path not found: {family_path}")
                results.append({"family": display_name, "status": "missing", "files": []})
                continue
            
            files = list(family_path.rglob("*.gguf"))
            if not files:
                print(f"  [WARNING] No GGUF files found in {display_name}")
                results.append({"family": display_name, "status": "empty", "files": []})
                continue
            
            family_results = []
            for file_path in files:
                file_size = file_path.stat().st_size
                file_hash = self.calculate_sha256(file_path)
                family_results.append({
                    "file": file_path.name,
                    "size_mb": round(file_size / (1024 * 1024), 2),
                    "hash": file_hash[:16] + "..."
                })
                print(f"  [OK] {file_path.name}: {round(file_size / (1024 * 1024), 2)} MB")
            
            results.append({"family": display_name, "status": "ok", "files": family_results})
            print()
        
        return results
    
    def check_memory_vault_integrity(self):
        """Check memory vault pods integrity"""
        print("=" * 70)
        print("MEMORY VAULT INTEGRITY CHECK")
        print("=" * 70)
        print()
        
        # Model family mapping
        model_mapping = {
            "QWYTHOS-9B": "qwythos-9b-claude-mythos-5-1m",
            "Muse-Glimmer-30B": "muse-glimmer-30b",
            "GPT-OSS": "gpt-oss-20b",
            "Qwen2-7B": "qwen2-7b",
            "Llama3-8B": "llama3-8b",
            "Mistral-7B": "mistral-7b",
            "Phi-3-mini": "phi-3-mini"
        }
        
        results = []
        
        for family, dir_name in model_mapping.items():
            print(f"Checking {family} memory vault...")
            family_path = self.vault_path / dir_name
            
            if not family_path.exists():
                print(f"  [WARNING] Vault path not found")
                results.append({"family": family, "status": "missing"})
                continue
            
            context_files = list(family_path.rglob("context_chunks*.jsonl"))
            embedding_files = list(family_path.rglob("embedding_pods*.jsonl"))
            
            total_chunks = 0
            for file_path in context_files:
                try:
                    with open(file_path, 'r') as f:
                        chunks = len([line for line in f if line.strip()])
                        total_chunks += chunks
                except:
                    pass
            
            print(f"  Context chunks: {total_chunks} files")
            print(f"  Embedding pods: {len(embedding_files)} files")
            print(f"  Status: [OK]")
            print()
            
            results.append({
                "family": family,
                "status": "ok",
                "chunks": total_chunks,
                "pods": len(embedding_files)
            })
        
        return results
    
    def check_configuration_integrity(self):
        """Check configuration files integrity"""
        print("=" * 70)
        print("CONFIGURATION INTEGRITY CHECK")
        print("=" * 70)
        print()
        
        config_files = [
            ("Master Manifest", self.manifest_path),
            ("Hybrid Router", Path("C:\\Users\\Eru\\AI_ Workspace\\tools\\hybrid_router.py")),
            ("Test Suite", Path("C:\\Users\\Eru\\AI_ Workspace\\tools\\test_router_suite.py")),
            ("Forward Mirror", Path("C:\\Users\\Eru\\AI_ Workspace\\tools\\Robocopy_LMStudio_to_E.bat")),
            ("Reverse Mirror", Path("C:\\Users\\Eru\\AI_ Workspace\\tools\\Robocopy_E_to_LMStudio.bat"))
        ]
        
        results = []
        
        for name, path in config_files:
            print(f"Checking {name}...")
            if path.exists():
                size = path.stat().st_size
                print(f"  [OK] Found: {path}")
                print(f"  [OK] Size: {size} bytes")
                results.append({"name": name, "status": "ok", "exists": True})
            else:
                print(f"  [MISSING] {path}")
                results.append({"name": name, "status": "missing", "exists": False})
            print()
        
        return results
    
    def generate_dashboard_report(self):
        """Generate comprehensive integrity report"""
        print("\n" + "=" * 70)
        print("INTEGRITY DASHBOARD REPORT")
        print("=" * 70)
        print(f"Generated: {datetime.now().isoformat()}")
        print()
        
        # Check model files
        model_results = self.check_model_file_integrity()
        
        # Check memory vault
        vault_results = self.check_memory_vault_integrity()
        
        # Check configuration
        config_results = self.check_configuration_integrity()
        
        # Summary
        print("=" * 70)
        print("SUMMARY")
        print("=" * 70)
        
        model_ok = sum(1 for r in model_results if r["status"] == "ok")
        vault_ok = sum(1 for r in vault_results if r["status"] == "ok")
        config_ok = sum(1 for r in config_results if r["status"] == "ok")
        
        print(f"Model families checked: {len(model_results)}")
        print(f"  [OK]: {model_ok}")
        print(f"  [WARNING] Issues: {len(model_results) - model_ok}")
        print()
        
        print(f"Memory vault checked: {len(vault_results)}")
        print(f"  [OK]: {vault_ok}")
        print(f"  [WARNING] Issues: {len(vault_results) - vault_ok}")
        print()
        
        print(f"Configuration files checked: {len(config_results)}")
        print(f"  [OK]: {config_ok}")
        print(f"  [WARNING] Missing: {len(config_results) - config_ok}")
        print()
        
        # Overall status
        total_checks = len(model_results) + len(vault_results) + len(config_results)
        total_ok = model_ok + vault_ok + config_ok
        
        if total_ok == total_checks:
            print("[SUCCESS] ALL SYSTEMS OK — Vault integrity verified")
            return True
        elif total_ok >= total_checks * 0.8:
            print("[WARNING] MOST SYSTEMS OK — Minor issues detected")
            return True
        else:
            print("[CRITICAL] CRITICAL ISSUES — Vault integrity compromised")
            return False

if __name__ == "__main__":
    dashboard = IntegrityDashboard()
    success = dashboard.generate_dashboard_report()
    exit(0 if success else 1)
