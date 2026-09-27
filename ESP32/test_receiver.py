#!/usr/bin/env python3
"""
============================================================================
SkyGuard-AI // ESP32 Edge Telemetry Test Receiver (Zero-Dependency)
============================================================================
Runs locally on your PC to receive telemetry dispatched by the ESP32 over Wi-Fi.

Usage:
    python test_receiver.py
    
Listens on:
    http://0.0.0.0:5000/api/telemetry
============================================================================
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import datetime
import os
import sys

PORT = 5000
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "received_telemetry.jsonl")

# ANSI Color codes for clean terminal output
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
RESET = "\033[0m"

packet_count = 0

class TelemetryReceiverHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default noisy access logs
        return

    def _set_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(204)

    def do_GET(self):
        self._set_headers(200)
        resp = {
            "service": "SkyGuard-AI ESP32 Test Receiver",
            "status": "ONLINE",
            "packets_received": packet_count,
            "port": PORT
        }
        self.wfile.write(json.dumps(resp).encode("utf-8"))

    def do_POST(self):
        global packet_count
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        try:
            payload = json.loads(post_data.decode("utf-8"))
            packet_count += 1
            now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            # Extract fields
            seq = payload.get("seq", packet_count)
            device_id = payload.get("device_id", "esp32-node")
            station_id = payload.get("station_id", "AWS-01")
            
            sensors = payload.get("sensors", {})
            t_val = sensors.get("temperature", {}).get("value", "N/A")
            h_val = sensors.get("humidity", {}).get("value", "N/A")
            p_val = sensors.get("pressure", {}).get("value", "N/A")
            b_val = sensors.get("battery_v", {}).get("value", "N/A")

            t_flag = sensors.get("temperature", {}).get("wmo_flag", 0)
            h_flag = sensors.get("humidity", {}).get("wmo_flag", 0)
            p_flag = sensors.get("pressure", {}).get("wmo_flag", 0)

            derived = payload.get("derived", {})
            dew_point = derived.get("dew_point", "N/A")
            vpd = derived.get("vapor_pressure_deficit", "N/A")
            clausius = "PASS" if derived.get("clausius_clapeyron_pass", True) else "VIOLATION"

            edge_ai = payload.get("edge_ai", {})
            classification = edge_ai.get("classification", "NOMINAL")
            score = edge_ai.get("anomaly_score", 0.0)
            reason = edge_ai.get("reason", "")

            # Color styling based on classification
            if classification == "NOMINAL":
                status_color = GREEN
            elif "SPIKE" in classification or "SUPER_SAT" in classification or "BOUNDS" in classification:
                status_color = RED
            else:
                status_color = YELLOW

            # Display formatted tactical receipt card
            print(f"\n{CYAN}┌────────────────────────────────────────────────────────────────────────┐{RESET}")
            print(f"{CYAN}│{RESET} {BOLD}PACKET #{seq:<4} RECEIVED FROM ESP32{RESET} [{now_str}] Device: {device_id:<14} {CYAN}│{RESET}")
            print(f"{CYAN}├────────────────────────────────────────────────────────────────────────┤{RESET}")
            print(f"{CYAN}│{RESET}  {BOLD}Station:{RESET} {station_id:<8} | {BOLD}Temp:{RESET} {t_val}°C (WMO:{t_flag}) | {BOLD}RH:{RESET} {h_val}% (WMO:{h_flag}) | {BOLD}P:{RESET} {p_val} hPa     {CYAN}│{RESET}")
            print(f"{CYAN}│{RESET}  {BOLD}Thermodynamics:{RESET} DewPoint={dew_point}°C | VPD={vpd} hPa | Clausius: {GREEN if clausius=='PASS' else RED}{clausius}{RESET}     {CYAN}│{RESET}")
            print(f"{CYAN}│{RESET}  {BOLD}Edge AI Decision:{RESET} {status_color}{BOLD}[{classification}]{RESET} (Anomaly Score: {score:.2f})           {CYAN}│{RESET}")
            print(f"{CYAN}│{RESET}  {BOLD}Reason:{RESET} {reason:<58} {CYAN}│{RESET}")
            print(f"{CYAN}└────────────────────────────────────────────────────────────────────────┘{RESET}")

            # Append to log file for permanent inspection
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps({"received_at": now_str, "payload": payload}) + "\n")

            # Acknowledge back to ESP32
            self._set_headers(200)
            response = {
                "status": "ACCEPTED",
                "ack_seq": seq,
                "message": f"Edge telemetry #{seq} successfully archived on PC",
                "timestamp": now_str
            }
            self.wfile.write(json.dumps(response).encode("utf-8"))

        except Exception as e:
            print(f"{RED}[ERROR] Failed to parse payload: {e}{RESET}")
            self._set_headers(400)
            self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))

def run():
    server_address = ("0.0.0.0", PORT)
    httpd = HTTPServer(server_address, TelemetryReceiverHandler)
    print(f"\n{GREEN}{BOLD}========================================================================{RESET}")
    print(f"{GREEN}{BOLD}  SKYGUARD-AI // ESP32 LOCAL TELEMETRY TEST RECEIVER ONLINE{RESET}")
    print(f"{GREEN}{BOLD}========================================================================{RESET}")
    print(f"{CYAN}Listening for ESP32 packets on:{RESET} http://0.0.0.0:{PORT}/api/telemetry")
    print(f"{CYAN}Target URL for ESP32 sketch:{RESET}    http://<YOUR_PC_IP>:{PORT}/api/telemetry")
    print(f"{CYAN}Archiving incoming packets to:{RESET}  {LOG_FILE}")
    print(f"{YELLOW}Press Ctrl+C to stop the receiver at any time.{RESET}\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print(f"\n{YELLOW}[RECEIVER] Shutting down cleanly. Total packets received: {packet_count}{RESET}")
        httpd.server_close()

if __name__ == "__main__":
    run()
