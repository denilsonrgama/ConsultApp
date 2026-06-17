# Deploy do ConsultApp na VPS Contabo

Este roteiro sobe uma instalacao vazia do ConsultApp em uma VPS Ubuntu, usando:

- IP: `161.97.146.92`
- Dominio inicial: `gamadeveloper.com.br`
- Node.js 24
- PostgreSQL local
- Nginx com HTTPS
- Servico `systemd`

Enquanto a VPS e validada, mantenha o Render ativo. Depois que tudo estiver testado, basta apontar o dominio definitivo para a VPS e atualizar `PUBLIC_APP_URL`.

## 1. DNS

No painel DNS do dominio, crie ou ajuste:

```text
Tipo: A
Nome: @
Valor: 161.97.146.92
TTL: automatico
```

Se for usar `www`:

```text
Tipo: CNAME
Nome: www
Valor: gamadeveloper.com.br
```

Aguarde a propagacao antes do SSL.

## 2. Acessar a VPS

No computador local:

```bash
ssh root@161.97.146.92
```

## 3. Preparar Ubuntu

```bash
apt update
apt upgrade -y
apt install -y curl git nginx ufw postgresql postgresql-contrib certbot python3-certbot-nginx
```

Node.js 24:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
node -v
npm -v
```

Dependencias do Chrome/Puppeteer para gerar PDFs:

```bash
apt install -y ca-certificates fonts-liberation libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 libxshmfence1 libgtk-3-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libcups2
apt install -y libasound2t64 || apt install -y libasound2
```

Firewall:

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status
```

## 4. Criar usuario e banco

```bash
sudo -u postgres psql
```

Dentro do `psql`:

```sql
CREATE ROLE consultapp LOGIN PASSWORD 'TROQUE_POR_SENHA_FORTE';
CREATE DATABASE consultappdb OWNER consultapp;
\q
```

## 5. Baixar o projeto

```bash
mkdir -p /opt/consultapp
cd /opt/consultapp
git clone https://github.com/denilsonrgama/ConsultApp.git consult-web-app
cd consult-web-app
npm install
```

O `postinstall` instala o Chrome do Puppeteer em `.cache/puppeteer`.

## 6. Configurar `.env`

```bash
cp .env.contabo.example .env
nano .env
```

Edite principalmente:

```env
DB_PASSWORD=senha_do_banco
PUBLIC_APP_URL=https://gamadeveloper.com.br
COOKIE_SECURE=true
ADMIN_PASSWORD=senha_admin_forte
ADMIN_EMAIL=email_do_admin
```

Para subir vazio, nao rode migracao agora. Ao iniciar, o servidor cria o schema e o usuario inicial.

Teste manual:

```bash
npm start
```

Em outro terminal:

```bash
curl http://127.0.0.1:5173/api/status
```

Se responder JSON, pare com `Ctrl+C`.

## 7. Criar servico systemd

Crie o arquivo:

```bash
nano /etc/systemd/system/consultapp.service
```

Conteudo:

```ini
[Unit]
Description=ConsultApp
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/consultapp/consult-web-app
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Ative:

```bash
systemctl daemon-reload
systemctl enable consultapp
systemctl start consultapp
systemctl status consultapp
```

Logs:

```bash
journalctl -u consultapp -f
```

## 8. Configurar Nginx

Crie:

```bash
nano /etc/nginx/sites-available/consultapp
```

Conteudo:

```nginx
server {
    listen 80;
    server_name gamadeveloper.com.br www.gamadeveloper.com.br;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ative:

```bash
ln -s /etc/nginx/sites-available/consultapp /etc/nginx/sites-enabled/consultapp
nginx -t
systemctl reload nginx
```

## 9. HTTPS

Depois que o DNS estiver apontando para `161.97.146.92`:

```bash
certbot --nginx -d gamadeveloper.com.br -d www.gamadeveloper.com.br
```

Teste renovacao:

```bash
certbot renew --dry-run
```

## 10. Atualizar deploy no futuro

```bash
cd /opt/consultapp/consult-web-app
git pull
npm install
systemctl restart consultapp
journalctl -u consultapp -n 80 --no-pager
```

## 11. Migrarem os dados depois

Quando chegar a hora de sair do Render com os dados:

1. Gerar backup do PostgreSQL do Render.
2. Restaurar no PostgreSQL da VPS.
3. Reiniciar `consultapp`.
4. Validar clientes, servicos, orcamentos, PDFs, relatorios e auditoria.

Comandos modelo:

```bash
pg_restore --clean --if-exists --no-owner --role=consultapp -d consultappdb consultapp-render.backup
systemctl restart consultapp
```

Se o backup for SQL texto:

```bash
psql -d consultappdb -f consultapp-render.sql
systemctl restart consultapp
```

## 12. Checklist de validacao

- Login `admin`.
- Dashboard carrega.
- Cadastro de cliente.
- Cadastro de servico.
- Cadastro de orcamento.
- Geracao de PDF de orcamento.
- Relatorios em PDF.
- Relatorios em Excel.
- Arquivos salvos aparecem na tela Arquivos.
- E-mail SMTP.
- Link de WhatsApp.
- App Android abrindo pelo novo dominio.

## 13. Backup automatico

Depois da validacao, instale a rotina de backup diario:

```bash
cd /opt/consultapp/consult-web-app
git pull
sudo install -m 755 scripts/backup_contabo.sh /usr/local/bin/consultapp-backup
sudo /usr/local/bin/consultapp-backup
```

O roteiro completo esta em `docs/backup-contabo.md`.
