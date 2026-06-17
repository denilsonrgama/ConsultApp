# Backup automatico do ConsultApp na Contabo com Cloudflare R2

Este roteiro cria uma rotina diaria de backup na VPS.

Ela salva:

- banco PostgreSQL `consultappdb` em formato custom do `pg_dump`;
- `.env` e `smtp-config.json`;
- servico `systemd` do ConsultApp;
- configuracao Nginx;
- pastas locais `Orcamentos` e `Relatorios`, caso tenham arquivos.

Os backups sao gerados localmente e enviados para Cloudflare R2. A pasta local fica como area de preparo e retencao curta:

```text
/var/backups/consultapp
```

Por padrao, a retencao e de 30 dias.

Para o R2, configure tambem uma regra de lifecycle no bucket se quiser apagar backups antigos automaticamente na nuvem, por exemplo depois de 90 ou 180 dias.

## 1. Criar bucket e chave no Cloudflare R2

No painel Cloudflare:

1. Acesse **R2 Object Storage**.
2. Crie um bucket privado, por exemplo:

```text
consultapp-backups
```

3. Crie uma chave de API R2 com permissao de leitura/escrita no bucket.
4. Anote:

```text
Account ID
Access Key ID
Secret Access Key
Bucket
```

Esses dados entram somente no `.env` da VPS. Nao coloque essas chaves no GitHub.

## 2. Atualizar projeto na VPS

```bash
cd /opt/consultapp/consult-web-app
git pull
```

## 3. Instalar dependencias e script

```bash
sudo apt update
sudo apt install -y awscli
sudo install -m 755 scripts/backup_contabo.sh /usr/local/bin/consultapp-backup
sudo mkdir -p /var/backups/consultapp
sudo chmod 750 /var/backups/consultapp
```

## 4. Configurar R2 no `.env`

Edite:

```bash
cd /opt/consultapp/consult-web-app
nano .env
```

Adicione ou ajuste:

```env
R2_ENABLED=true
R2_ACCOUNT_ID=seu_account_id_cloudflare
R2_BUCKET=consultapp-backups
R2_ACCESS_KEY_ID=sua_access_key_id
R2_SECRET_ACCESS_KEY=sua_secret_access_key
R2_PREFIX=consultapp/producao
```

Se quiser usar outro endpoint S3 compativel:

```env
R2_ENDPOINT=https://seu_endpoint
```

Se `R2_ENDPOINT` ficar vazio, o script usa:

```text
https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
```

## 5. Testar manualmente

```bash
sudo /usr/local/bin/consultapp-backup
sudo ls -lh /var/backups/consultapp/db
sudo tail -n 80 /var/log/consultapp-backup.log
```

Se aparecer `Envio para R2 concluido`, o backup foi enviado ao bucket.

Tambem confira no painel do R2 se existem objetos como:

```text
consultapp/producao/db/consultapp-consultappdb-YYYYMMDD-HHMMSS.backup
consultapp/producao/latest/latest-db.backup
```

## 6. Criar servico systemd

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

## 7. Criar timer diario

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

## 8. Rodar um backup sob demanda

```bash
sudo systemctl start consultapp-backup.service
sudo journalctl -u consultapp-backup.service -n 80 --no-pager
```

## 9. Conferir ultimos backups locais

```bash
sudo find /var/backups/consultapp -maxdepth 2 -type f -printf '%TY-%Tm-%Td %TH:%TM %p %k KB\n' | sort
```

Links uteis:

```text
/var/backups/consultapp/latest-db.backup
/var/backups/consultapp/latest-config.tar.gz
/var/backups/consultapp/latest-files.tar.gz
```

## 10. Baixar backup do R2 para restaurar

Se precisar restaurar a partir do R2, primeiro configure temporariamente as variaveis no terminal ou use o `.env`:

```bash
cd /opt/consultapp/consult-web-app
set -a
. ./.env
set +a
```

Baixe o ultimo backup para `/tmp`:

```bash
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_DEFAULT_REGION=auto \
  aws s3 cp "s3://$R2_BUCKET/$R2_PREFIX/latest/latest-db.backup" \
  /tmp/consultapp-r2-latest-db.backup \
  --endpoint-url "${R2_ENDPOINT:-https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com}"
```

## 11. Restaurar um backup do banco

Atencao: este procedimento substitui o banco atual.

```bash
sudo systemctl stop consultapp

sudo -u postgres dropdb --if-exists consultappdb
sudo -u postgres createdb -O consultapp consultappdb

sudo install -m 600 -o postgres -g postgres /tmp/consultapp-r2-latest-db.backup /tmp/consultapp-restore.backup
sudo -u postgres pg_restore --no-owner --no-privileges --role=consultapp -d consultappdb /tmp/consultapp-restore.backup
sudo rm -f /tmp/consultapp-restore.backup /tmp/consultapp-r2-latest-db.backup

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

## 12. Copiar backup para o computador local

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
