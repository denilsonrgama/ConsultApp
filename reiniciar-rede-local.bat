@echo off
setlocal
set PORT=5173
set HOST=0.0.0.0

echo.
echo Reiniciando ConsultApp na rede local...
echo.

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo Encerrando processo antigo na porta %PORT%: %%a
  taskkill /PID %%a /F >nul 2>nul
)

echo.
echo Enderecos IPv4 encontrados:
ipconfig | findstr /i "IPv4"
echo.
echo No celular, acesse o IPv4 principal com a porta %PORT%.
echo Exemplo: http://192.168.15.7:%PORT%
echo.
echo Mantenha esta janela aberta.
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
