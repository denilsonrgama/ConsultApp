# PostgreSQL

O ConsultApp usa PostgreSQL como banco de dados da aplicacao.

## 1. Instalar dependencias Node

Dentro da pasta `consult-web-app`, rode:

```powershell
npm install
```

O pacote usado pelo servidor para PostgreSQL e `pg`.

## 2. Criar banco e usuario

Exemplo no `psql` com um usuario administrador:

```sql
CREATE ROLE consultapp LOGIN PASSWORD 'troque-esta-senha';
CREATE DATABASE consultappdb OWNER consultapp;
```

O servidor cria e atualiza o schema automaticamente. O schema base tambem esta em `db/postgres-schema.sql`.

## 3. Configurar variaveis

Crie um arquivo `.env` dentro de `consult-web-app` seguindo este padrao:

```env
DB_NAME=consultappdb
DB_USER=consultapp
DB_PASSWORD=troque-esta-senha
DB_HOST=127.0.0.1
DB_PORT=5432
PGSSL=false
```

O servidor carrega esse `.env` automaticamente. `DATABASE_URL` tambem e aceita como alternativa, principalmente em hospedagem remota:

```env
DATABASE_URL=postgresql://consultapp:troque-esta-senha@127.0.0.1:5432/consultappdb
```

Para hospedagem com TLS, ajuste `PGSSL` e `PGSSL_REJECT_UNAUTHORIZED` conforme o provedor. Use `.env.postgres.example` como referencia.

## 4. Rodar o servidor

Na mesma janela com as variaveis definidas:

```powershell
npm start
```

O endpoint `/api/status` deve responder com `database: "postgres"`.

## Observacoes

- As tabelas principais sao `clientes`, `responsaveis`, `servicos`, `orcamentos` e `orcamento_itens`.
- A tabela `app_state` fica apenas como legado historico; a operacao do sistema usa tabelas relacionais.
- Em producao, mantenha HTTPS, backup do PostgreSQL, firewall e variaveis sensiveis fora do repositorio.
