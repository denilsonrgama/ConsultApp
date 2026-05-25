@echo off
net session >nul 2>nul
if not %errorlevel%==0 (
  echo Este arquivo precisa ser executado como Administrador.
  echo Clique com o botao direito e escolha "Executar como administrador".
  pause
  exit /b 1
)

netsh advfirewall firewall add rule name="ConsultApp Homologacao 5173" dir=in action=allow protocol=TCP localport=5173
echo.
echo Regra criada. Agora rode rodar-rede-local.bat e acesse pelo celular.
pause
