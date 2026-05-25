# Plano De Migração

## Modelo de dados

| Excel | Entidade no sistema | Observação |
| --- | --- | --- |
| `bdClientes` | `clientes` | CPF/CNPJ vira identificador inicial. |
| `bdServicos` | `servicos` | Código do serviço preservado. |
| `bdCabOrcamento` | `orcamentos` | Cabeçalho, cliente, status, data e observações. |
| `bdOrcamentos` | `orcamento_itens` | Itens, quantidade, valor unitário e desconto. |
| `Ajustes` | `configuracoes` | Listas de tipo, frequência e status. |
| `ESTADO` / `CIDADES` | `localidades` | Fonte para filtros e autocomplete. |

## Fases sugeridas

### Fase 1: MVP local

Aplicação PWA com persistência local no navegador, já criada nesta pasta.

### Fase 2: Sistema online

Adicionar backend, banco de dados, login, permissões e backup.

### Fase 3: App Android nativo

Empacotar a aplicação com Capacitor, gerar APK/AAB e configurar ícones, splash screen e permissões.

### Fase 4: Paridade com Excel

Recriar as macros VBA como regras de negócio testáveis: numeração, filtros, impressão, aprovação/reprovação e geração de arquivos.
