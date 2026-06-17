# Backup automatico do ConsultApp na Contabo

Este roteiro cria uma rotina diaria de backup na VPS.

Ela salva:

- banco PostgreSQL `consultappdb` em formato custom do `pg_dump`;
- `.env` e `smtp-config.json`;
- servico `systemd` do ConsultApp;
- configuracao Nginx;
- pastas locais `Orcamentos` e `Relatorios`, caso tenham arquivos.

Os backups ficam em:

```text
/var/backups/consultapp
```

Por padrao, a retencao e de 30 dias.

## 1. Atualizar projeto na VPS

```bash
cd /opt/consultapp/consult-web-app
git pull
```

## 2. Instalar script de backup

```bash
sudo install -m 755 scripts/backup_contabo.sh /usr/local/bin/consultapp-backup
sudo mkdir -p /var/backups/consultapp
sudo chmod 750 /var/backups/consultapp
```

## 3. Testar manualmente

```bash
sudo /usr/local/bin/consultapp-backup
sudo ls -lh /var/backups/consultapp/db
sudo tail -n 80 /var/log/consultapp-backup.log
```

Se aparecer um arquivo `.backup`, o backup do banco foi criado.

## 4. Criar servico systemd

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

## 5. Criar timer diario

```bash
sudo nano /etc/systemd/system/consultapp-backup.timer
```

Conteudo:

```ini
[Unit]
Description=Executa backup diario do ConsultApp

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

Ativar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now consultapp-backup.timer
sudo systemctl list-timers --all | grep consultapp
```

## 6. Rodar um backup sob demanda

```bash
sudo systemctl start consultapp-backup.service
sudo journalctl -u consultapp-backup.service -n 80 --no-pager
```

## 7. Conferir ultimos backups

```bash
sudo find /var/backups/consultapp -maxdepth 2 -type f -printf '%TY-%Tm-%Td %TH:%TM %p %k KB\n' | sort
```

Links uteis:

```text
/var/backups/consultapp/latest-db.backup
/var/backups/consultapp/latest-config.tar.gz
/var/backups/consultapp/latest-files.tar.gz
```

## 8. Restaurar um backup do banco

Atencao: este procedimento substitui o banco atual.

```bash
sudo systemctl stop consultapp

sudo -u postgres dropdb --if-exists consultappdb
sudo -u postgres createdb -O consultapp consultappdb

sudo install -m 600 -o postgres -g postgres /var/backups/consultapp/latest-db.backup /tmp/consultapp-restore.backup
sudo -u postgres pg_restore --no-owner --no-privileges --role=consultapp -d consultappdb /tmp/consultapp-restore.backup
sudo rm -f /tmp/consultapp-restore.backup

sudo systemctl start consultapp
```

Conferir:

```bash
sudo -u postgres psql -d consultappdb -c "
select 'clientes' as tabela, count(*) from clientes
union all select 'servicos', count(*) from servicos
union all select 'orcamentos', count(*) from orcamentos
union all select 'orcamento_itens', count(*) from orcamento_itens
union all select 'usuarios', count(*) from usuarios
union all select 'arquivos', count(*) from arquivos
union all select 'app_state', count(*) from app_state;
"
```

## 9. Copiar backup para o computador local

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
