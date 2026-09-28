# SkyGuard-AI project status audit

Audit date: 2026-09-28. Sources: `specsheet(2).md` and `system_design (1).md`. This supersedes the pre-fix diagnostic snapshot. The detailed implementation and requirement matrix are in [FINAL_IMPLEMENTATION_REPORT.md](FINAL_IMPLEMENTATION_REPORT.md); executable checks are in [status_audit_evidence.json](status_audit_evidence.json).

**Current verdict: substantial implementation, not 100% accepted.** Eight of the 15 broad definition-of-done items have collected test evidence sufficient for this local audit. The strict, unweighted evidence score is **53.3% (8/15)**. This is deliberately conservative: partial features receive no credit, and tests using disposable SQLite do not establish PostgreSQL, hardware, browser, or field readiness.

| Verification | Result | Limit |
|---|---|---|
| Backend and ML collected tests | 71 passed | Disposable SQLite and local model artifacts; no field dataset. |
| Frontend production build | Passed | Bundle size warning; no browser journey test. |
| Diff whitespace | Passed | Formatting check only. |
| PostgreSQL deployment/migration | Unverified | No Docker daemon or reachable local PostgreSQL test service. |
| ESP32 build and disconnect/reboot replay | Unverified | Arduino CLI and PlatformIO unavailable. |
| Browser workflows, load, field metrics | Unverified | Require runtime environment and representative data. |

The original P0 defects addressed in source and targeted tests include station-scoped reads and training jobs, plaintext station passwords, duplicate source observations, source-time persistence, invalid-data ML gating, ingress parity, regional health protection, training readiness/gates, artifact integrity, and the 12-feature training/inference contract. Batch acknowledgements and conflict quarantine now exist. Firmware has a persistent 64-frame LittleFS queue and waits for an explicit backend acknowledgement; this code still needs a hardware trial. The browser accepts timestamped JSON files into a separate local queue and retains unacknowledged rows.

Remaining acceptance work is significant. Test every station route across roles and disabled accounts; verify schema migrations and transaction behavior on PostgreSQL; compile and exercise the ESP32 across network loss and power cycles; broaden the five-station regional test into a labelled fault and hard-negative corpus with imputation/incident metrics; complete deterministic demo replay and two rehearsals; benchmark alert quality, latency and load; run browser role journeys; and finish backup/restore and submission artifacts. Model-card synthetic metrics are labelled synthetic and must not be presented as field precision or recall.

Reproduce the local evidence with `.venv\Scripts\python.exe scripts/audit_status.py` on Windows after installing `requirements.txt` and frontend dependencies. CI runs the same script. A passing script reports only the checks above; it does not certify the project as complete.
