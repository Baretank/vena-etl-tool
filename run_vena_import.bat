@echo off
echo Starting Vena ETL import at %date% %time% >> "%~dp0import_log.txt"
cd /d "%~dp0"
node multi_import.js run >> "%~dp0import_log.txt" 2>&1
echo Import completed at %date% %time% >> "%~dp0import_log.txt"