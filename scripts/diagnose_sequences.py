"""Read-only sequence diagnostics. Prints numeric values only."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.storage.database import get_db


def main():
    for table in ("assessments", "imputations", "sensor_health"):
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(f"SELECT MAX(id) AS max_id, COUNT(*) AS row_count FROM {table}")
            rows = cursor.fetchone()
            cursor.execute(f"SELECT last_value, is_called FROM {table}_id_seq")
            sequence = cursor.fetchone()
            cursor.execute(f"SELECT id, source_timestamp FROM {table} ORDER BY id DESC LIMIT 1" if table == "assessments" else f"SELECT id FROM {table} ORDER BY id DESC LIMIT 1")
            newest = cursor.fetchone()
            cursor.execute(
                "SELECT column_default FROM information_schema.columns "
                "WHERE table_name = ? AND column_name = 'id'", (table,)
            )
            default = cursor.fetchone()
        print(table, rows["max_id"], rows["row_count"],
              sequence["last_value"], sequence["is_called"],
              bool(default and default["column_default"]),
              newest.get("source_timestamp") if newest else None)


if __name__ == "__main__":
    main()
