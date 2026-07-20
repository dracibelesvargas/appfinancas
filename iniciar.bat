@echo off
REM Sobe o app e abre o navegador. Feche esta janela para parar.
REM
REM O servidor serve SÓ o código: seus dados ficam no navegador (OPFS), nunca aqui.
cd /d "%~dp0"
start "" http://127.0.0.1:8900/
python -m http.server 8900 --bind 127.0.0.1
pause
