# Backup automatico do ConsultApp na VPS Contabo

Este roteiro cria e mantem backups locais no SSD da VPS Contabo.

Por enquanto, enquanto o contrato da Consult ainda nao estiver fechado, o backup externo em Cloudflare R2 pode ficar desligado para reduzir custo. O script continua preparado para enviar ao R2 futuramente, mas somente quando `R2_ENABLED=true` estiver configurado de forma explicita no `.env`.

O backup salva:

- banco PostgreSQL `consultappdb` em formato custom do `pg_dump`;
- `.env` e `smtp-config.json`;
- servico `systemd` do ConsultApp;
- configuracao Nginx;
- pastas locais `Orcamentos` e `Relatorios`, caso tenham arquivos.

Destino local:

```text
/var/backups/consultapp
```

Links sempre atualizados:

```text
/var/backups/consultapp/latest-db.backup
/var/backups/consultapp/latest-config.tar.gz
/var/backups/consultapp/latest-files.tar.gz
```

## 1. Atualizar projeto na VPS

```bash
cd /opt/consultapp/consult-web-app
git pull
```

## 2. Instalar script local

```bash
sudo install -m 755 scripts/backup_contabo.sh /usr/local/bin/consultapp-backup
sudo mkdir -p /var/backups/consultapp
sudo chmod 750 /var/backups/consultapp
```

Nao e necessario instalar `awscli` enquanto o R2 estiver desligado.

## 3. Configurar `.env`

Edite:

```bash
cd /opt/consultapp/consult-web-app
sudo nano .env
```

Garanta estas linhas:

```env
BACKUP_DIR=/var/backups/consultapp
RETENTION_DAYS=90
R2_ENABLED=false
```

Se existirem credenciais R2 no `.env`, elas podem ficar guardadas, mas o envio nao sera feito enquanto `R2_ENABLED=false`.

## 4. Testar manualmente

```bash
sudo /usr/local/bin/consultapp-backup
sudo ls -lh /var/backups/consultapp/db
sudo tail -n 80 /var/log/consultapp-backup.log
```

O log esperado deve conter:

```text
Backup externo R2 desativado. O backup ficara apenas na VPS.
Backup finalizado com sucesso
```

## 5. Criar servico systemd

```bash
sudo nano /etc/systemd/system/consultapp-backup.service
```

Conteudo:

```ini
[Unit]
Description=Backup do ConsultApp
After=postgresql.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/consultapp-backup
```

## 6. Criar timer semanal

```bash
sudo nano /etc/systemd/system/consultapp-backup.timer
```

Conteudo:

```ini
[Unit]
Description=Executa backup semanal do ConsultApp

[Timer]
OnCalendar=Fri 23:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

Ativar ou recarregar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now consultapp-backup.timer
sudo systemctl restart consultapp-backup.timer
systemctl list-timers --all | grep consultapp
```

## 7. Rodar backup sob demanda

```bash
sudo systemctl start consultapp-backup.service
sudo journalctl -u consultapp-backup.service -n 80 --no-pager
sudo tail -n 80 /var/log/consultapp-backup.log
```

## 8. Conferir backups locais

```bash
sudo find /var/backups/consultapp -maxdepth 2 -type f -printf '%TY-%Tm-%Td %TH:%TM %p %k KB\n' | sort
sudo du -sh /var/backups/consultapp
```

Conferir integridade:

```bash
cd /var/backups/consultapp
sudo sha256sum -c db/*.sha256
sudo sha256sum -c config/*.sha256
sudo sha256sum -c files/*.sha256
```

Se quiser validar se o backup do banco abre:

```bash
sudo -u postgres pg_restore -l /var/backups/consultapp/latest-db.backup >/dev/null
```

## 9. Restaurar backup local do banco

Atencao: este procedimento substitui o banco atual.

```bash
sudo systemctl stop consultapp

sudo -u postgres pg_dump -Fc --no-owner --no-privileges \
  -d consultappdb \
  -f /tmp/consultappdb-before-restore.backup

sudo -u postgres dropdb --if-exists consultappdb
sudo -u postgres createdb -O consultapp consultappdb

sudo install -m 600 -o postgres -g postgres \
  /var/backups/consultapp/latest-db.backup \
  /tmp/consultapp-restore.backup

sudo -u postgres pg_restore \
  --no-owner \
  --no-privileges \
  --role=consultapp \
  -d consultappdb \
  /tmp/consultapp-restore.backup

sudo rm -f /tmp/consultapp-restore.backup
sudo systemctl start consultapp
```

Conferir:

```bash
curl https://gamadeveloper.com.br/api/status

sudo -u postgres psql -d consultappdb -c "
select 'clientes' as tabela, count(*) from clientes
union all select 'servicos', count(*) from servicos
union all select 'orcamentos', count(*) from orcamentos
union all select 'orcamento_itens', count(*) from orcamento_itens
union all select 'usuarios', count(*) from usuarios
union all select 'arquivos', count(*) from arquivos
union all select 'auditoria_logs', count(*) from auditoria_logs;
"
```

O arquivo `/tmp/consultappdb-before-restore.backup` fica como plano de volta caso o backup restaurado nao seja o desejado.

## 10. Copiar backup para o computador local

No PowerShell do Windows:

```powershell
scp deploy@161.97.146.92:/var/backups/consultapp/latest-db.backup C:\Backups\ConsultApp\
```

Se der permissao negada, copie antes para `/tmp` na VPS:

```bash
sudo cp /var/backups/consultapp/latest-db.backup /tmp/consultapp-latest-db.backup
sudo chown deploy:deploy /tmp/consultapp-latest-db.backup
```

E no Windows:

```powershell
scp deploy@161.97.146.92:/tmp/consultapp-latest-db.backup C:\Backups\ConsultApp\
```

## 11. Reativar envio para Cloudflare R2 futuramente

Quando o contrato estiver fechado e voce quiser voltar a ter backup externo, instale o `awscli` e configure o R2:

```bash
sudo apt update
sudo apt install -y awscli
```

No `.env`:

```env
R2_ENABLED=true
R2_ACCOUNT_ID=seu_account_id_cloudflare
R2_BUCKET=consultapp-backups
R2_ACCESS_KEY_ID=sua_access_key_id
R2_SECRET_ACCESS_KEY=sua_secret_access_key
R2_PREFIX=consultapp/producao
```

Teste:

```bash
sudo /usr/local/bin/consultapp-backup
sudo tail -n 100 /var/log/consultapp-backup.log
```

Se aparecer `Envio para R2 concluido`, o backup local tambem foi enviado ao bucket.
