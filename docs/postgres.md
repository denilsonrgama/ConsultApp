# PostgreSQL

O ConsultApp suporta PostgreSQL mantendo o mesmo contrato da API usado pelas telas.

## 1. Instalar a dependencia Node

Dentro da pasta `consult-web-app`, rode:

```powershell
npm install
```

O pacote usado pelo servidor para PostgreSQL e `pg`.

## 2. Criar banco e usuario

Exemplo no `psql` com um usuario administrador:

```sql
CREATE ROLE consultapp LOGIN PASSWORD 'troque-esta-senha';
CREATE DATABASE consultapp OWNER consultapp;
```

O servidor cria o schema automaticamente. O mesmo schema esta em `db/postgres-schema.sql`.

## 3. Configurar variaveis

Crie um arquivo `.env` dentro de `consult-web-app` seguindo o mesmo padrao usado por outros projetos PostgreSQL:

```env
DB_BACKEND=postgres
DB_NAME=consultappdb
DB_USER=postgres
DB_PASSWORD=troque-esta-senha
DB_HOST=127.0.0.1
DB_PORT=5432
PGSSL=false
```

O servidor carrega esse `.env` automaticamente. `DATABASE_URL` continua aceita como alternativa, principalmente em hospedagem remota.

Para hospedagem com TLS, ajuste `PGSSL` e `PGSSL_REJECT_UNAUTHORIZED` conforme o provedor. Use `.env.postgres.example` como referencia.

## 4. Migrar o SQLite atual

Com o `.env` configurado:

```powershell
npm run migrate:postgres
```

O migrador le `consultapp.sqlite` e grava a linha principal `app_state` no PostgreSQL. Ele mostra a quantidade de clientes, servicos, orcamentos e responsaveis copiados.

Depois copie o `app_state` para o modelo relacional:

```powershell
npm run migrate:relational
```

O modelo relacional passa a ser usado pelo servidor para leitura e gravacao.

## 5. Rodar o servidor com PostgreSQL

Na mesma janela com as variaveis definidas:

```powershell
npm start
```

O endpoint `/api/status` informa qual backend esta ativo no campo `database`.

## Observacoes

- O modo SQLite continua disponivel para recuperacao local enquanto a migracao e validada.
- `app_state` fica como legado/backup da primeira migracao; a operacao do sistema usa tabelas relacionais.
- As tabelas principais sao `clientes`, `responsaveis`, `servicos`, `orcamentos` e `orcamento_itens`.
- Antes de publicar a versao Android para uso real, configure HTTPS, backup do PostgreSQL e autenticacao do sistema.
