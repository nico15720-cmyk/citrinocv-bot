@echo off
echo Copiando build del CRM a citrino-bot...

copy /Y "C:\Users\Lenovo\Desktop\citrino-agent\dist\assets\index-Drogb8XI.js" "C:\Users\Lenovo\Claude\citrino-bot\public\app\crm\assets\index-Drogb8XI.js"

if %errorlevel%==0 (
    echo OK: index-Drogb8XI.js copiado.
) else (
    echo ERROR copiando index-Drogb8XI.js
    pause
    exit /b 1
)

echo.
echo Listo. Ahora abriendo Git Bash para hacer push...
echo.
echo Ejecuta estos comandos en Git Bash:
echo   cd /c/Users/Lenovo/Claude/citrino-bot
echo   git add public/app/crm/
echo   git commit -m "feat: deploy CRM build con pantalla Horarios"
echo   git push origin main
echo.
pause
