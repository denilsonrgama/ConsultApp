@echo off
setlocal
set PORT=5173
set HOST=0.0.0.0

echo.
echo ConsultApp em modo rede local
echo -----------------------------
echo No celular, use o IPv4 do computador com a porta %PORT%.
echo Exemplo: http://192.168.15.7:%PORT%
echo.
echo Enderecos IPv4 encontrados:
ipconfig | findstr /i "IPv4"
echo.
echo Mantenha esta janela aberta enquanto estiver testando.
echo.

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
