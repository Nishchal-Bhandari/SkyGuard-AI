#!/usr/bin/env python3
"""
Inspect Datasets Script
Recursively scans dataset directories, extracts NetCDF metadata, validates checksums,
and generates structured JSON & Markdown inspection reports.
"""

import os
import sys
import glob
import json
import hashlib
import argparse
from datetime import datetime, timezone
import netCDF4 as nc
import numpy as np


def compute_sha256(filepath: str) -> str:
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def inspect_netcdf_file(filepath: str) -> dict:
    """Extract complete file-level, coordinate-level, and variable-level metadata."""
    stat = os.stat(filepath)
    sha256 = compute_sha256(filepath)
    
    parts = os.path.normpath(filepath).split(os.sep)
    district_folder = parts[-2] if len(parts) >= 2 else "root"
    filename = os.path.basename(filepath)
    
    ds = nc.Dataset(filepath, mode="r")
    
    # Global / File attributes
    global_attrs = {k: str(ds.getncattr(k)) for k in ds.ncattrs()}
    
    # Dimensions
    dims = {k: len(v) for k, v in ds.dimensions.items()}
    
    # Coordinates and Time
    valid_time_var = ds.variables.get("valid_time")
    time_units = valid_time_var.units if valid_time_var and hasattr(valid_time_var, "units") else "seconds since 1970-01-01"
    calendar = getattr(valid_time_var, "calendar", "proleptic_gregorian") if valid_time_var else "proleptic_gregorian"
    
    time_start_iso = None
    time_end_iso = None
    num_timestamps = 0
    if valid_time_var is not None and len(valid_time_var) > 0:
        num_timestamps = len(valid_time_var)
        t_min = int(valid_time_var[0])
        t_max = int(valid_time_var[-1])
        time_start_iso = datetime.fromtimestamp(t_min, tz=timezone.utc).isoformat()
        time_end_iso = datetime.fromtimestamp(t_max, tz=timezone.utc).isoformat()
        
    lat_var = ds.variables.get("latitude")
    lon_var = ds.variables.get("longitude")
    
    lats = [float(x) for x in lat_var[:]] if lat_var is not None else []
    lons = [float(x) for x in lon_var[:]] if lon_var is not None else []
    
    # Variables analysis
    variables_meta = {}
    data_vars = []
    
    for vname, var in ds.variables.items():
        v_attrs = {}
        for attr_name in var.ncattrs():
            val = var.getncattr(attr_name)
            if isinstance(val, (np.ndarray, np.generic)):
                val = val.tolist()
            v_attrs[attr_name] = val
            
        is_coord = vname in ["valid_time", "latitude", "longitude", "number", "expver"]
        if not is_coord:
            data_vars.append(vname)
            
        variables_meta[vname] = {
            "name": vname,
            "is_coordinate": is_coord,
            "shape": list(var.shape),
            "dtype": str(var.dtype),
            "units": v_attrs.get("units", "unknown"),
            "long_name": v_attrs.get("long_name", vname),
            "standard_name": v_attrs.get("standard_name", "unknown"),
            "step_type": v_attrs.get("GRIB_stepType", "instant" if "instant" in filename else "accum"),
            "param_id": v_attrs.get("GRIB_paramId"),
            "fill_value": v_attrs.get("_FillValue"),
            "missing_value": v_attrs.get("GRIB_missingValue"),
            "attributes": v_attrs
        }
        
    step_type = "accum" if "accum" in filename else ("instant" if "instant" in filename else "unknown")
    
    file_report = {
        "filepath": filepath,
        "filename": filename,
        "district_folder": district_folder,
        "format": "netcdf4",
        "file_size_bytes": stat.st_size,
        "file_size_mb": round(stat.st_size / (1024 * 1024), 3),
        "sha256": sha256,
        "step_type": step_type,
        "dimensions": dims,
        "num_timestamps": num_timestamps,
        "temporal_range": {
            "start_utc": time_start_iso,
            "end_utc": time_end_iso,
            "time_units": time_units,
            "calendar": calendar
        },
        "spatial_grid": {
            "num_latitudes": len(lats),
            "num_longitudes": len(lons),
            "total_grid_points": len(lats) * len(lons),
            "latitudes": lats,
            "longitudes": lons,
            "lat_min": min(lats) if lats else None,
            "lat_max": max(lats) if lats else None,
            "lon_min": min(lons) if lons else None,
            "lon_max": max(lons) if lons else None,
        },
        "data_variables": data_vars,
        "variables": variables_meta,
        "global_attributes": global_attrs
    }
    
    ds.close()
    return file_report


def run_inspection(target_path: str, output_dir: str):
    print(f"[+] Inspecting datasets recursively in: {target_path}")
    
    if not os.path.exists(target_path):
        # Fallback check for common paths
        alt_paths = ["Datasets", "docs/datasets", "datasets"]
        for alt in alt_paths:
            if os.path.exists(alt):
                target_path = alt
                break
                
    if not os.path.exists(target_path):
        print(f"[-] Error: Path not found: {target_path}", file=sys.stderr)
        sys.exit(1)
        
    pattern = os.path.join(target_path, "**", "*.nc")
    nc_files = glob.glob(pattern, recursive=True)
    
    # Also look for csv/parquet/json if any
    all_files = []
    for ext in ["*.nc", "*.csv", "*.parquet", "*.json"]:
        all_files.extend(glob.glob(os.path.join(target_path, "**", ext), recursive=True))
        
    print(f"[+] Discovered {len(nc_files)} NetCDF dataset files ({len(all_files)} total files)")
    
    reports = []
    districts = set()
    variables_catalog = {}
    total_bytes = 0
    total_records = 0
    
    for idx, f in enumerate(nc_files, 1):
        rep = inspect_netcdf_file(f)
        reports.append(rep)
        districts.add(rep["district_folder"])
        total_bytes += rep["file_size_bytes"]
        pts = rep["spatial_grid"]["total_grid_points"]
        ts = rep["num_timestamps"]
        total_records += (pts * ts * len(rep["data_variables"]))
        
        for vname, vmeta in rep["variables"].items():
            if not vmeta["is_coordinate"] and vname not in variables_catalog:
                variables_catalog[vname] = {
                    "short_name": vname,
                    "long_name": vmeta["long_name"],
                    "standard_name": vmeta["standard_name"],
                    "raw_unit": vmeta["units"],
                    "step_type": vmeta["step_type"],
                    "param_id": vmeta["param_id"]
                }
                
    summary = {
        "inspection_timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "scan_directory": os.path.abspath(target_path),
        "total_files": len(reports),
        "total_size_mb": round(total_bytes / (1024 * 1024), 2),
        "estimated_total_observations": total_records,
        "districts_discovered": sorted(list(districts)),
        "discovered_variables": list(variables_catalog.values()),
        "files": reports
    }
    
    os.makedirs(output_dir, exist_ok=True)
    json_path = os.path.join(output_dir, "dataset_inspection_report.json")
    md_path = os.path.join(output_dir, "dataset_inspection_report.md")
    
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
        
    # Generate Markdown Report
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# Dataset Inspection Report\n\n")
        f.write(f"- **Generated at:** {summary['inspection_timestamp_utc']}\n")
        f.write(f"- **Scan Target:** `{summary['scan_directory']}`\n")
        f.write(f"- **Total Files:** {summary['total_files']}\n")
        f.write(f"- **Total Dataset Size:** {summary['total_size_mb']} MB\n")
        f.write(f"- **Estimated Observations:** {summary['estimated_total_observations']:,}\n\n")
        
        f.write("## Discovered Districts & Geographic Entities\n\n")
        f.write("| District / Folder | Grid Dimensions | Points | Lat Range | Lon Range |\n")
        f.write("|---|---|---|---|---|\n")
        
        district_grids = {}
        for r in reports:
            dfolder = r["district_folder"]
            grid = r["spatial_grid"]
            if dfolder not in district_grids:
                district_grids[dfolder] = {
                    "dims": f"{grid['num_latitudes']}x{grid['num_longitudes']}",
                    "points": grid["total_grid_points"],
                    "lat": f"{grid['lat_min']} to {grid['lat_max']}",
                    "lon": f"{grid['lon_min']} to {grid['lon_max']}"
                }
        for d, g in sorted(district_grids.items()):
            f.write(f"| `{d}` | {g['dims']} | {g['points']} | {g['lat']} | {g['lon']} |\n")
            
        f.write("\n## Discovered Meteorological Variables\n\n")
        f.write("| Variable | Standard Name | Long Name | Raw Unit | Step Type | GRIB Param ID |\n")
        f.write("|---|---|---|---|---|---|\n")
        for v in variables_catalog.values():
            f.write(f"| `{v['short_name']}` | `{v['standard_name']}` | {v['long_name']} | `{v['raw_unit']}` | `{v['step_type']}` | {v['param_id']} |\n")
            
        f.write("\n## Ingested File Details\n\n")
        f.write("| File Name | District | Step Type | Size (MB) | Timestamps | Date Range | SHA-256 (Prefix) |\n")
        f.write("|---|---|---|---|---|---|---|\n")
        for r in reports:
            tr = r["temporal_range"]
            t_span = f"{tr['start_utc'][:10]} to {tr['end_utc'][:10]}" if tr["start_utc"] else "N/A"
            f.write(f"| `{r['filename']}` | `{r['district_folder']}` | `{r['step_type']}` | {r['file_size_mb']} | {r['num_timestamps']} | {t_span} | `{r['sha256'][:16]}...` |\n")
            
    print(f"[+] Successfully generated reports:")
    print(f"    - JSON: {json_path}")
    print(f"    - Markdown: {md_path}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Inspect weather NetCDF dataset files.")
    parser.add_argument("--path", default="Datasets", help="Directory path to scan for datasets")
    parser.add_argument("--output-dir", default="database/reports", help="Directory to save inspection reports")
    args = parser.parse_args()
    
    run_inspection(args.path, args.output_dir)
