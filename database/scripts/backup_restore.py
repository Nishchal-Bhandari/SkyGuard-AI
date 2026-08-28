#!/usr/bin/env python3
"""
Database Backup & Restore Manager
Provides zero-downtime, crash-consistent online SQLite backups with integrity verification.
"""

import os
import sys
import glob
import sqlite3
import argparse
from datetime import datetime, timezone


def backup_database(db_path: str = "data/weather_app.db", backup_dir: str = "database/backups") -> str:
    if not os.path.exists(db_path):
        print(f"[-] Error: Source database not found at {db_path}", file=sys.stderr)
        sys.exit(1)
        
    os.makedirs(backup_dir, exist_ok=True)
    timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_filename = f"weather_app_backup_{timestamp_str}.db"
    backup_path = os.path.join(backup_dir, backup_filename)
    
    print(f"[+] Initiating online backup of {db_path} -> {backup_path}...")
    
    src_conn = sqlite3.connect(db_path, timeout=60.0)
    dst_conn = sqlite3.connect(backup_path)
    
    with dst_conn:
        src_conn.backup(dst_conn, pages=100, sleep=0.01)
        
    dst_conn.close()
    src_conn.close()
    
    # Run integrity check on the newly created backup
    chk_conn = sqlite3.connect(backup_path)
    cursor = chk_conn.cursor()
    cursor.execute("PRAGMA integrity_check;")
    result = cursor.fetchone()[0]
    chk_conn.close()
    
    if result != "ok":
        print(f"[-] Critical: Backup integrity check failed with status: {result}", file=sys.stderr)
        sys.exit(1)
        
    size_mb = round(os.path.getsize(backup_path) / (1024 * 1024), 2)
    print(f"[+] Backup successfully completed and verified! Size: {size_mb} MB")
    print(f"    File: {backup_path}")
    return backup_path


def restore_database(backup_path: str, target_db: str = "data/weather_app.db") -> bool:
    if not os.path.exists(backup_path):
        print(f"[-] Error: Backup file not found at {backup_path}", file=sys.stderr)
        sys.exit(1)
        
    print(f"[+] Restoring database from {backup_path} -> {target_db}...")
    os.makedirs(os.path.dirname(os.path.abspath(target_db)), exist_ok=True)
    
    # If target DB already exists, create safety snapshot first
    if os.path.exists(target_db):
        pre_restore_backup = f"{target_db}.pre_restore_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
        import shutil
        shutil.copy2(target_db, pre_restore_backup)
        print(f"[*] Created safety snapshot of current DB at: {pre_restore_backup}")
        
    src_conn = sqlite3.connect(backup_path)
    dst_conn = sqlite3.connect(target_db)
    
    with dst_conn:
        src_conn.backup(dst_conn, pages=100, sleep=0.01)
        
    dst_conn.close()
    src_conn.close()
    
    # Validate integrity
    chk_conn = sqlite3.connect(target_db)
    cursor = chk_conn.cursor()
    cursor.execute("PRAGMA integrity_check;")
    result = cursor.fetchone()[0]
    chk_conn.close()
    
    if result != "ok":
        print(f"[-] Error: Restored database failed integrity check: {result}", file=sys.stderr)
        return False
        
    print(f"[+] Database restoration successfully completed and verified!")
    return True


def list_backups(backup_dir: str = "database/backups"):
    backups = sorted(glob.glob(os.path.join(backup_dir, "*.db")), reverse=True)
    print(f"\n[+] Available Backups in {backup_dir} ({len(backups)} found):")
    for b in backups:
        size_mb = round(os.path.getsize(b) / (1024 * 1024), 2)
        mtime = datetime.fromtimestamp(os.path.getmtime(b), tz=timezone.utc).isoformat()
        print(f"    - {os.path.basename(b)} ({size_mb} MB, {mtime})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SQLite Database Backup & Restore Manager.")
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")
    
    # Backup cmd
    b_parser = subparsers.add_parser("backup", help="Create a verified online backup")
    b_parser.add_argument("--db", default="data/weather_app.db", help="Path to source SQLite database")
    b_parser.add_argument("--dir", default="database/backups", help="Directory to save backup files")
    
    # Restore cmd
    r_parser = subparsers.add_parser("restore", help="Restore database from backup")
    r_parser.add_argument("--file", required=True, help="Path to backup file to restore")
    r_parser.add_argument("--target", default="data/weather_app.db", help="Path to target database file")
    
    # List cmd
    l_parser = subparsers.add_parser("list", help="List all available backups")
    l_parser.add_argument("--dir", default="database/backups", help="Backup directory")
    
    args = parser.parse_args()
    
    if args.command == "backup":
        backup_database(args.db, args.dir)
    elif args.command == "restore":
        restore_database(args.file, args.target)
    elif args.command == "list":
        list_backups(args.dir)
    else:
        parser.print_help()
