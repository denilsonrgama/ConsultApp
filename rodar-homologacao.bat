@echo off
setlocal
set PORT=5173
set HOST=127.0.0.1

if exist ".tools\node-v24.14.0-win-x64\node.exe" (
  ".tools\node-v24.14.0-win-x64\node.exe" server.mjs
  goto :eof
)

where node >nul 2>nul
if %errorlevel%==0 (
  node server.mjs
  goto :eof
)

if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.mjs
  goto :eof
)

echo Node.js nao foi encontrado.
echo Instale o Node.js LTS em https://nodejs.org/ ou configure o caminho do node.exe.
pause
