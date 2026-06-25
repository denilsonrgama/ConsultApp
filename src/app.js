const STORAGE_KEY = "consultapp.v1";
const SESSION_RELOAD_SKIP_KEY = "consultapp.skipReloadSessionClose";
const LOGIN_WELCOME_KEY = "consultapp.showWelcomeAfterLogin";
const APP_FALLBACK_VERSION = "v335";
const PASSWORD_MIN_LENGTH = 8;
const seed = window.CONSULT_SEED || {};

let state = loadState();
let appVersion = APP_FALLBACK_VERSION;
let csrfToken = "";
let deferredInstallPrompt = null;
let appInstalled = isAppRunningInstalled();
let editingClienteDocumento = null;
let selectedClienteDocumento = null;
let blankNewCliente = false;
let editingServicoCodigo = null;
let blankNewServico = false;
let editingOrcamentoNumero = null;
let blankNewOrcamento = true;
let addingBudgetItem = false;
let clienteFormPrefill = null;
let pendingBudgetDraft = null;
let pendingBudgetServiceReturn = null;
let pendingOrcamentoFormDraft = null;
let draftBudgetItems = [];
let pendingSave = null;
let currentUser = null;
let usuarios = [];
let auditoriaLogs = [];
let auditoriaLoaded = false;
let auditoriaFilters = { usuario: "", acao: "", modulo: "", dataInicio: "", dataFim: "", limit: "100", page: 1 };
let auditoriaMeta = { total: 0, page: 1, limit: 100, pages: 1 };
let documentationFilters = { query: "", title: "", subtitle: "", tag: "" };
let arquivos = [];
const cnpjLookupCache = new Map();
const tableSorts = {
  orcamentos: { key: "", direction: "asc" },
  clientes: { key: "", direction: "asc" },
  servicos: { key: "", direction: "asc" },
  arquivos: { key: "", direction: "asc" },
  usuarios: { key: "", direction: "asc" },
  financeiro: { key: "numero", direction: "desc" },
  auditoria: { key: "data", direction: "desc" },
};
let reportFilters = {
  dataInicio: "",
  dataFim: "",
  status: "",
  clienteStatus: "TODOS",
  servicoStatus: "TODOS",
};
let editingUsuarioId = null;
let blankNewUsuario = false;
let explicitLogout = false;
let openMenuGroup = "";
let lastNavScrollY = 0;
let navScrollTicking = false;

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const sortCollator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

const titles = {
  dashboard: "Dashboard",
  clientes: "Clientes",
  servicos: "Serviços",
  orcamentos: "Orçamentos",
  financeiro: "Financeiro",
  relatorios: "Relatórios",
  arquivos: "Arquivos",
  usuarios: "Usuários",
  auditoria: "Auditoria",
  documentacao: "Documentação",
  ajuda: "Ajuda",
};

const DOCUMENTATION_RECORDS = [
  {
    title: "Acesso e segurança",
    subtitle: "Login, sessão e recuperação de senha",
    tags: ["segurança", "login", "senha", "sessão"],
    summary: "Regras de autenticação, troca de senha temporária, convidado e encerramento de sessão.",
    items: [
      "O acesso é feito pelo e-mail cadastrado.",
      "O primeiro acesso permite solicitar um usuário preenchendo dados pessoais; o cadastro fica bloqueado até liberação administrativa.",
      "A recuperação de senha envia senha temporária por SMTP e exige troca antes de liberar o sistema.",
      "O link de convidado entra sem senha, mas opera com permissões somente de consulta.",
      "O sistema gera automaticamente um usuário técnico no formato nome.ultimonome para logs e auditoria.",
      "Em caso de duplicidade, o sistema tenta outra parte do nome e, se necessário, aplica numeração automática.",
      "Sessões são encerradas no logout e notificadas ao fechar/atualizar a página quando o navegador permite.",
      "Cookies seguros, proteção por origem/CSRF e limitação de tentativas protegem rotas sensíveis.",
    ],
  },
  {
    title: "Clientes",
    subtitle: "Cadastro, consulta fiscal, CEP e últimos orçamentos",
    tags: ["clientes", "cnpj", "cpf", "cep", "orçamento"],
    summary: "Fluxo de cadastro e manutenção de clientes com dados protegidos e integração com orçamento.",
    items: [
      "CPF e CNPJ são validados antes do cadastro.",
      "CNPJ consulta a base cadastral, preenche razão social, nome fantasia, situação e endereço quando retornado pela consulta.",
      "Pessoa jurídica exige situação ativa para cadastro; situação baixada, suspensa ou inativa bloqueia o fluxo.",
      "Cliente selecionado permanece bloqueado para edição até clicar em Alterar.",
      "Campos preenchidos por consulta cadastral ou CEP não devem ser editados manualmente.",
      "CEP consulta a base dos Correios; para CPF, cabe ao usuário informar número e complemento.",
      "Após salvar um cliente, o sistema confirma sucesso e pergunta se deseja criar orçamento.",
      "O detalhe do cliente mostra últimos orçamentos clicáveis e o botão + Orçamento.",
      "Cliente inativo permanece no histórico, mas não pode receber novo orçamento.",
    ],
  },
  {
    title: "Serviços",
    subtitle: "Cadastro, status e criação a partir do orçamento",
    tags: ["serviços", "status", "orçamento", "valor"],
    summary: "Regras para serviços ativos/inativos, numeração automática e uso em orçamentos.",
    items: [
      "O código do serviço é automático e não pode ser digitado.",
      "O campo Tipo é seleção controlada.",
      "Serviço inativo permanece em orçamentos antigos, mas não pode ser inserido em novos.",
      "Ao criar serviço pelo botão + do orçamento, o sistema gera o próximo código e posiciona o foco no nome.",
      "O valor cadastrado em Serviços é referência; alterações no orçamento valem apenas para aquele orçamento.",
    ],
  },
  {
    title: "Orçamentos",
    subtitle: "Novo orçamento, itens, aprovação, PDF e compartilhamento",
    tags: ["orçamentos", "pdf", "email", "whatsapp", "aprovação"],
    summary: "Fluxo principal de orçamento com cliente, serviços, status, PDF e arquivos salvos.",
    items: [
      "Novo orçamento inicia com número automático a partir de 15000, sem duplicidade.",
      "Não é permitido salvar orçamento sem cliente.",
      "Não é permitido repetir o mesmo código de serviço no mesmo orçamento.",
      "Inserir serviço em orçamento novo preserva o item anterior e limpa apenas os campos do próximo serviço.",
      "O botão + ao lado de Cliente permite cadastrar cliente e retornar ao orçamento em andamento.",
      "O botão + ao lado de Serviço permite cadastrar serviço e retornar ao orçamento em andamento.",
      "Status APROVADO bloqueia campos principais; alteração de status exige privilégio ou confirmação administrativa.",
      "Somente orçamentos aprovados são salvos como PDF definitivo no banco.",
      "PDFs compartilhados usam token público não adivinhável e evitam expor dados sensíveis no título/nome do arquivo.",
    ],
  },
  {
    title: "Financeiro e relatórios",
    subtitle: "Indicadores, filtros, PDF e Excel",
    tags: ["financeiro", "relatórios", "filtros", "excel", "pdf"],
    summary: "Critérios de cálculo, relatórios filtrados e navegação pelos maiores clientes/orçamentos.",
    items: [
      "Indicadores ignoram orçamentos reprovados quando a regra estatística exige base válida.",
      "Clientes inativos não entram em gráficos gerais, exceto quando filtro específico pedir exibição.",
      "Relatórios permitem filtro por período, status do orçamento, status do cliente e status do serviço.",
      "O PDF exibe os filtros aplicados; quando não houver filtros, mostra Nenhum filtro selecionado.",
      "Excel é baixado pelo navegador e não precisa ser salvo no servidor.",
      "A tela mostra 5 maiores clientes e 5 maiores orçamentos conforme filtros; as linhas são clicáveis.",
    ],
  },
  {
    title: "Arquivos",
    subtitle: "PDFs salvos, consulta e exclusão",
    tags: ["arquivos", "pdf", "auditoria"],
    summary: "Consulta dos documentos salvos no banco e controle de exclusão.",
    items: [
      "Arquivos salvos ficam disponíveis na tela Arquivos.",
      "Visualizar abre o documento em nova aba quando possível.",
      "Excluir arquivo exige permissão específica.",
      "Toda exclusão de arquivo é registrada na auditoria.",
    ],
  },
  {
    title: "Usuários e permissões",
    subtitle: "Perfis, superadmin e bloqueios técnicos",
    tags: ["usuários", "perfis", "superadmin", "permissões"],
    summary: "Modelo de acesso por perfil com ajustes finos por tela e ação.",
    items: [
      "Primeiro acesso cria uma solicitação pendente com dados pessoais e senha forte.",
      "Usuário pré-cadastrado pela Administração também deve criar a própria senha pelo Primeiro acesso.",
      "O usuário técnico é gerado automaticamente como nome.ultimonome e usado em logs/auditoria.",
      "Cadastros pendentes precisam ser ativados e ter perfil/permissões revisados antes do login.",
      "Senha não é digitada no cadastro administrativo; ADMIN ou SUPERADMIN apenas envia senha temporária para recriação.",
      "Exclusão de usuário com histórico de clientes, serviços, orçamentos ou PDFs salvos vira inativação para preservar rastreabilidade.",
      "ADMIN administra cadastros e rotinas, mas não acessa Auditoria técnica.",
      "OPERADOR usa clientes, serviços e orçamentos sem financeiro sensível.",
      "FINANCEIRO acessa financeiro, relatórios e consulta de orçamentos.",
      "VISUALIZADOR e CONVIDADO operam apenas em consulta.",
      "SUPERADMIN é o login técnico reservado para auditoria, documentação e manutenção.",
      "Perfis alterados pelo superadmin ficam protegidos contra reversão por administradores comuns.",
      "Permissões podem bloquear tela inteira ou ações específicas dentro da tela.",
    ],
  },
  {
    title: "Auditoria",
    subtitle: "Rastreabilidade e retenção de logs",
    tags: ["auditoria", "logs", "retenção", "segurança"],
    summary: "Registro de ações e manutenção dos logs operacionais.",
    items: [
      "A auditoria registra usuário, perfil, ação, módulo, item, detalhes, IP e data/hora.",
      "Filtros localizam registros por usuário, ação, módulo e período.",
      "A manutenção permite simular e excluir logs antigos conforme período de retenção.",
      "A tela é técnica e deve ficar visível apenas para o superadmin.",
    ],
  },
  {
    title: "Infraestrutura",
    subtitle: "Produção, PostgreSQL, backups e versão",
    tags: ["produção", "postgres", "backup", "versão", "vps"],
    summary: "Itens técnicos de operação em produção na VPS.",
    items: [
      "A aplicação em produção usa PostgreSQL como banco único.",
      "A versão exibida no cabeçalho acompanha o backend e ajuda a confirmar publicação/cache.",
      "Backups geram banco, arquivos e configurações sensíveis no SSD da VPS Contabo.",
      "O timer de backup está previsto para sexta-feira às 23:30.",
      "O envio para Cloudflare R2 fica desligado por padrão e só é reativado com R2_ENABLED=true.",
      "Restauração em produção deve ser feita com serviço parado, backup validado e conferência das tabelas.",
    ],
  },
  {
    title: "Mobile, Android e PWA",
    subtitle: "Experiência compacta e app instalado",
    tags: ["mobile", "android", "pwa", "layout"],
    summary: "Comportamentos específicos para telas pequenas e app Android WebView/PWA.",
    items: [
      "Menus compactos agrupam Financeiro e Administração com submenus sob demanda.",
      "Formulários de cliente, serviço, orçamento e usuário são exibidos apenas no fluxo de novo/alterar em telas compactas.",
      "Botões Novo/Atualizar ficam próximos ao título da lista para evitar espaço vazio no fim da tela.",
      "O app Android abre a aplicação publicada e depende do backend ativo.",
      "PDFs e relatórios no Android usam abertura em nova aba/janela quando disponível.",
    ],
  },
];

const PERMISSIONS = [
  { key: "dashboard.view", label: "Dashboard", group: "Telas" },
  { key: "clientes.view", label: "Ver clientes", group: "Clientes" },
  { key: "clientes.create", label: "Criar clientes", group: "Clientes" },
  { key: "clientes.edit", label: "Alterar clientes", group: "Clientes" },
  { key: "clientes.delete", label: "Excluir clientes", group: "Clientes" },
  { key: "clientes.status", label: "Inativar clientes", group: "Clientes" },
  { key: "servicos.view", label: "Ver serviços", group: "Serviços" },
  { key: "servicos.create", label: "Criar serviços", group: "Serviços" },
  { key: "servicos.edit", label: "Alterar serviços", group: "Serviços" },
  { key: "servicos.delete", label: "Excluir serviços", group: "Serviços" },
  { key: "orcamentos.view", label: "Ver orçamentos", group: "Orçamentos" },
  { key: "orcamentos.create", label: "Criar orçamentos", group: "Orçamentos" },
  { key: "orcamentos.edit", label: "Alterar orçamentos", group: "Orçamentos" },
  { key: "orcamentos.delete", label: "Excluir orçamentos", group: "Orçamentos" },
  { key: "orcamentos.print", label: "Imprimir orçamentos", group: "Orçamentos" },
  { key: "orcamentos.share", label: "Compartilhar orçamentos", group: "Orçamentos" },
  { key: "orcamentos.status", label: "Alterar status aprovado", group: "Orçamentos" },
  { key: "financeiro.view", label: "Ver financeiro", group: "Financeiro" },
  { key: "relatorios.view", label: "Ver relatórios", group: "Relatórios" },
  { key: "relatorios.export", label: "Exportar relatórios", group: "Relatórios" },
  { key: "arquivos.view", label: "Ver arquivos", group: "Arquivos" },
  { key: "arquivos.delete", label: "Excluir arquivos", group: "Arquivos" },
  { key: "usuarios.view", label: "Ver usuários", group: "Usuários" },
  { key: "usuarios.create", label: "Criar usuários", group: "Usuários" },
  { key: "usuarios.edit", label: "Alterar usuários", group: "Usuários" },
  { key: "usuarios.delete", label: "Excluir ou inativar usuários", group: "Usuários" },
  { key: "auditoria.view", label: "Ver auditoria", group: "Auditoria" },
  { key: "auditoria.manage", label: "Limpar logs antigos", group: "Auditoria" },
  { key: "data.write", label: "Gravar alterações no banco", group: "Sistema" },
];

const SUPER_ADMIN_LOGIN = "admin";
const TECHNICAL_PERMISSION_KEYS = new Set(["auditoria.view", "auditoria.manage"]);

function isSuperAdminUser(user = currentUser) {
  return Boolean(user?.superAdmin) || String(user?.usuario || "").trim().toLowerCase() === SUPER_ADMIN_LOGIN;
}

function canManagePermissionKey(key) {
  return isSuperAdminUser() || !TECHNICAL_PERMISSION_KEYS.has(key);
}

const PROFILE_PERMISSION_PRESETS = {
  ADMIN: Object.fromEntries(PERMISSIONS.map((permission) => [permission.key, !permission.key.startsWith("auditoria.")])),
  OPERADOR: {
    "dashboard.view": true,
    "clientes.view": true,
    "clientes.create": true,
    "clientes.edit": true,
    "clientes.delete": true,
    "servicos.view": true,
    "servicos.create": true,
    "servicos.edit": true,
    "servicos.delete": true,
    "orcamentos.view": true,
    "orcamentos.create": true,
    "orcamentos.edit": true,
    "orcamentos.delete": true,
    "orcamentos.print": true,
    "orcamentos.share": true,
    "data.write": true,
  },
  FINANCEIRO: {
    "dashboard.view": true,
    "orcamentos.view": true,
    "orcamentos.print": true,
    "orcamentos.share": true,
    "financeiro.view": true,
    "relatorios.view": true,
    "relatorios.export": true,
  },
  VISUALIZADOR: {
    "dashboard.view": true,
    "clientes.view": true,
    "servicos.view": true,
    "orcamentos.view": true,
    "financeiro.view": true,
    "relatorios.view": true,
  },
  CONVIDADO: {
    "dashboard.view": true,
    "clientes.view": true,
    "servicos.view": true,
    "orcamentos.view": true,
  },
};

function userProfile() {
  return currentUser?.perfil || "";
}

function userProfileLabel(user = currentUser) {
  return isSuperAdminUser(user) ? "SUPERADMIN" : (user?.perfil || "");
}

function defaultPermissionsForProfile(perfil) {
  const preset = PROFILE_PERMISSION_PRESETS[String(perfil || "").toUpperCase()] || {};
  return Object.fromEntries(PERMISSIONS.map((permission) => [permission.key, Boolean(preset[permission.key])]));
}

function permissionsForUser(user = currentUser) {
  const permissoes = { ...(user?.permissoes || defaultPermissionsForProfile(user?.perfil)) };
  if (isSuperAdminUser(user)) {
    PERMISSIONS.forEach((permission) => {
      permissoes[permission.key] = true;
    });
    return permissoes;
  }
  TECHNICAL_PERMISSION_KEYS.forEach((key) => {
    permissoes[key] = false;
  });
  return permissoes;
}

function hasPermission(key, user = currentUser) {
  return Boolean(permissionsForUser(user)[key]);
}

function canManageData() {
  return hasPermission("data.write");
}

function canEditModule(module) {
  return hasPermission(`${module}.create`) || hasPermission(`${module}.edit`);
}

function canDeleteFromModule(module) {
  return hasPermission(`${module}.delete`);
}

function canShareBudgets() {
  return hasPermission("orcamentos.share");
}

function canExportReports() {
  return hasPermission("relatorios.export");
}

function canManageUsers() {
  return hasPermission("usuarios.view");
}

function canEditUsuarioRecord(usuario) {
  return hasPermission("usuarios.edit") && (isSuperAdminUser() || (!usuario?.superAdmin && !usuario?.superadminLocked));
}

function canDeleteUsuarioRecord(usuario) {
  return hasPermission("usuarios.delete")
    && Number(usuario?.id) !== Number(currentUser?.id)
    && !usuario?.superAdmin
    && !usuario?.superadminLocked
    && (isSuperAdminUser() || hasPermission("usuarios.delete"));
}

function canResetUsuarioPassword(usuario) {
  const adminPasswordManager = isSuperAdminUser() || userProfile().toUpperCase() === "ADMIN";
  return adminPasswordManager
    && hasPermission("usuarios.edit")
    && Boolean(usuario?.id)
    && usuario.ativo === true
    && usuario.cadastroPendente !== true
    && (isSuperAdminUser() || (!usuario?.superAdmin && !usuario?.superadminLocked));
}

function showNoPermissionMessage() {
  showFloatingMessage("Usuário sem permissão para esta ação.");
}

function setFormReadOnly(form) {
  if (!form) return;
  form.querySelectorAll("input, select, textarea").forEach((field) => {
    field.disabled = true;
  });
}

function isAppRunningInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: window-controls-overlay)").matches
    || window.navigator.standalone === true;
}

function syncInstallButton() {
  const installButton = document.getElementById("install-app");
  if (!installButton) return;
  installButton.hidden = appInstalled || !deferredInstallPrompt;
}

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    return normalizeState(JSON.parse(stored));
  }

  return seedState();
}

function seedState() {
  const clientes = (seed.clientes || []).map((cliente) => ({
    documento: cliente["CPF/CNPJ"] || "",
    nome: cliente.NOME || "",
    status: cliente.STATUS || "ATIVO",
    telefone: cliente.CELULAR || cliente.TELEFONE || "",
    email: cliente["E-MAIL"] || "",
    uf: cliente.UF || "",
    cidade: cliente.CIDADE || "",
    endereco: cliente["ENDEREÇO"] || "",
    numero: cliente["Nº"] || "",
    bairro: cliente.BAIRRO || "",
    cep: cliente.CEP || "",
    obs: cliente.OBS || "",
  }));

  const servicos = (seed.servicos || []).map((servico) => ({
    codigo: String(servico.CODIGO || ""),
    nome: servico.NOMESERVICO || "",
    status: servico.STATUS || "ATIVO",
    frequencia: servico.FREQUENCIA || "UNITARIO",
    tipo: servico.TIPOSERVICO || "",
    valor: parseMoney(servico.VALOR),
    observacoes: servico.OBSERVACOES || "",
  }));

  const orcamentos = (seed.orcamentos || []).map((orcamento) => {
    const numero = Number(orcamento.ORCAMENTO);
    const itens = (seed.orcamentoItens || [])
      .filter((item) => Number(item.ORCAMENTO) === numero)
      .map((item) => ({
        servicoCodigo: String(item["SERVIÇO"] || ""),
        quantidade: Number(item.QUANTIDADE || 1),
        valorUnitario: Number(item.VALOR_UNIT || 0),
        desconto: Number(item.DESCONTO || 0),
      }));

    return {
      numero,
      clienteDocumento: orcamento.CLIENTE || "",
      data: normalizeDate(orcamento.DATA),
      status: orcamento.STATUS || "EM ANÁLISE",
      observacoes: orcamento.OBSERVACOES || "",
      itens,
    };
  });

  return { clientes, servicos, orcamentos, responsaveis: [] };
}

function csrfHeaders(headers = {}) {
  return csrfToken ? { ...headers, "X-CSRF-Token": csrfToken } : { ...headers };
}

function csrfFetch(resource, options = {}) {
  return fetch(resource, {
    ...options,
    headers: csrfHeaders(options.headers || {}),
  });
}

function saveState(audit = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (location.protocol === "file:") return Promise.resolve({ ok: true });
  if (currentUser && !canManageData()) return Promise.resolve({ ok: true });

  pendingSave = csrfFetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, audit }),
  }).catch(() => {
    showFloatingMessage("Não foi possível salvar no banco de dados. Verifique se o servidor local está rodando.");
  });
  return pendingSave;
}

function normalizeState(value) {
  return {
    clientes: Array.isArray(value?.clientes) ? value.clientes.map((cliente) => {
      const { responsavelCpf, ...cleanCliente } = cliente;
      return {
        ...cleanCliente,
        status: normalizeClienteStatus(cliente.status),
        cidade: normalizeCidade(cliente.cidade),
      };
    }) : [],
    servicos: Array.isArray(value?.servicos) ? value.servicos : [],
    orcamentos: Array.isArray(value?.orcamentos) ? value.orcamentos.map((orcamento) => ({
      ...orcamento,
      status: normalizeOrcamentoStatus(orcamento.status),
    })) : [],
    responsaveis: [],
  };
}

async function loadServerState() {
  if (location.protocol === "file:") return null;

  const response = await fetch("/api/data");
  if (response.status === 401) {
    currentUser = null;
    renderLogin();
    throw new Error("Faça login para acessar o sistema.");
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("Servidor local desatualizado. Reinicie a homologação e recarregue a página.");
  }

  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result.error || "Não foi possível carregar os dados do banco.");
  }
  return result.state ? normalizeState(result.state) : null;
}

function setAppVersion(version) {
  appVersion = String(version || APP_FALLBACK_VERSION).trim() || APP_FALLBACK_VERSION;
  document.title = `ConsultApp ${appVersion}`;
  document.querySelectorAll("[data-app-version]").forEach((element) => {
    element.textContent = appVersion;
  });
}

function renderAppVersionBadge() {
  return `<span class="app-version" data-app-version>${escapeHtml(appVersion)}</span>`;
}

async function loadAppStatus() {
  if (location.protocol === "file:") {
    setAppVersion(APP_FALLBACK_VERSION);
    return;
  }

  try {
    const response = await fetch("/api/status");
    const result = await response.json();
    if (response.ok && result.version) {
      setAppVersion(result.version);
      return;
    }
  } catch {
    // Mantem a versao embarcada quando o status nao puder ser consultado.
  }
  setAppVersion(APP_FALLBACK_VERSION);
}

async function initializeApp() {
  let welcomeStartedAt = 0;
  try {
    await loadAppStatus();
    await destroySessionOnManualReload();
    currentUser = await fetchCurrentUser();
    if (!currentUser) {
      renderLogin();
      return;
    }
    if (consumeLoginWelcomeMark()) {
      welcomeStartedAt = renderWelcomeScreen(currentUser);
    }
    if (canManageUsers()) await loadUsuarios();

    const localState = state;
    const serverState = await loadServerState();
    if (serverState) {
      if (stateRecordCount(localState) > stateRecordCount(serverState) && confirm("Encontramos mais cadastros neste navegador do que no banco central. Deseja importar estes dados locais?")) {
        state = localState;
        saveState();
      } else {
        state = serverState;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } else {
      saveState();
    }
  } catch (error) {
    showFloatingMessage(error.message || "Usando dados locais porque o banco não respondeu.");
  }

  if (welcomeStartedAt) await holdWelcomeScreen(welcomeStartedAt);
  render();
  setAppVersion(appVersion);
  if (welcomeStartedAt) closeWelcomeScreen();
}

async function fetchCurrentUser() {
  if (location.protocol === "file:") return { usuario: "local", nome: "Usuário local", perfil: "ADMIN" };
  const response = await fetch("/api/auth/me");
  const result = await response.json().catch(() => ({ ok: false }));
  csrfToken = result.csrfToken || "";
  return result.ok ? result.user : null;
}

function renderLogin(message = "") {
  document.body.innerHTML = `
    <main class="auth-screen">
      <section class="auth-card">
        <div>
          <p class="eyebrow">Acesso seguro</p>
          <h1>ConsultApp ${renderAppVersionBadge()}</h1>
        </div>
        <form id="login-form" novalidate>
          <label>E-mail<input name="email" type="email" autocomplete="username" required></label>
          <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
          <button class="primary-button" type="submit">Entrar</button>
          <button class="link-button" type="button" id="first-access">Primeiro acesso</button>
          <button class="link-button" type="button" id="guest-login">Acessar como convidado</button>
          <button class="link-button" type="button" id="forgot-password">Esqueci minha senha</button>
          <p class="auth-error" id="login-error">${escapeHtml(message)}</p>
        </form>
      </section>
    </main>
  `;
  document.getElementById("login-form").addEventListener("submit", handleLogin);
  document.getElementById("first-access").addEventListener("click", () => renderFirstAccess());
  document.getElementById("guest-login").addEventListener("click", handleGuestLogin);
  document.getElementById("forgot-password").addEventListener("click", () => renderForgotPassword());
  document.querySelector('#login-form [name="email"]')?.focus();
}

function renderForgotPassword(message = "") {
  document.body.innerHTML = `
    <main class="auth-screen">
      <section class="auth-card">
        <div>
          <p class="eyebrow">Recuperação de acesso</p>
          <h1>ConsultApp ${renderAppVersionBadge()}</h1>
        </div>
        <form id="forgot-form" novalidate>
          <label>E-mail cadastrado<input name="email" type="email" autocomplete="email" required></label>
          <button class="primary-button" type="submit">Enviar senha temporária</button>
          <button class="link-button" type="button" id="back-login">Voltar ao login</button>
          <p class="auth-error" id="forgot-message">${escapeHtml(message)}</p>
        </form>
      </section>
    </main>
  `;
  document.getElementById("forgot-form").addEventListener("submit", handleForgotPassword);
  document.getElementById("back-login").addEventListener("click", () => renderLogin());
  document.querySelector('#forgot-form [name="email"]')?.focus();
}

function renderFirstAccess(message = "", tone = "error") {
  document.body.innerHTML = `
    <main class="auth-screen">
      <section class="auth-card auth-card-wide">
        <div>
          <p class="eyebrow">Primeiro acesso</p>
          <h1>Solicitar acesso ${renderAppVersionBadge()}</h1>
          <p class="muted">Preencha seus dados. O acesso ficará bloqueado até liberação e definição de perfil pelo administrador.</p>
        </div>
        <form id="first-access-form" novalidate>
          <div class="auth-form-grid">
            <label>Nome<input name="nome" autocomplete="given-name" required></label>
            <label>Sobrenome<input name="sobrenome" autocomplete="family-name" required></label>
            <label>Data de nascimento<input name="dataNascimento" type="date" required></label>
            <label>Telefone<input name="telefone" autocomplete="tel" required></label>
          </div>
          <label>E-mail<input name="email" type="email" autocomplete="username email" required></label>
          <label>Senha<input name="senha" type="password" minlength="${PASSWORD_MIN_LENGTH}" autocomplete="new-password" required></label>
          <p class="muted password-policy-hint">Use no mínimo ${PASSWORD_MIN_LENGTH} caracteres, com letra maiúscula, letra minúscula, número e caractere especial.</p>
          <label>Confirmar senha<input name="confirmarSenha" type="password" minlength="${PASSWORD_MIN_LENGTH}" autocomplete="new-password" required></label>
          <button class="primary-button" type="submit">Enviar solicitação</button>
          <button class="link-button" type="button" id="back-login">Voltar ao login</button>
          <p class="auth-error ${tone === "success" ? "is-success" : ""}" id="first-access-message">${escapeHtml(message)}</p>
        </form>
      </section>
    </main>
  `;
  document.getElementById("first-access-form").addEventListener("submit", handleFirstAccess);
  document.getElementById("back-login").addEventListener("click", () => renderLogin());
  document.querySelector('#first-access-form [name="nome"]')?.focus();
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = document.getElementById("login-error");
  const payload = {
    usuario: form.elements.email.value.trim(),
    senha: form.elements.senha.value,
  };
  const validationError = validateLoginPayload(payload);
  if (validationError) {
    errorBox.textContent = validationError;
    return;
  }

  try {
    const response = await csrfFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível fazer login.");
    if (result.passwordChangeRequired) {
      renderTemporaryPasswordChange(payload.usuario, payload.senha, result.user?.nome || payload.usuario);
      return;
    }
    markNextReloadAsInternal();
    markLoginWelcome();
    location.reload();
  } catch (error) {
    errorBox.textContent = error.message || "Não foi possível fazer login.";
  }
}

async function handleGuestLogin() {
  const errorBox = document.getElementById("login-error");
  try {
    const response = await csrfFetch("/api/auth/guest", { method: "POST" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível acessar como convidado.");
    markNextReloadAsInternal();
    markLoginWelcome();
    location.reload();
  } catch (error) {
    errorBox.textContent = error.message || "Não foi possível acessar como convidado.";
  }
}

function isValidEmailClient(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function validateLoginPayload(payload) {
  if (!payload.usuario) return "Informe o e-mail.";
  if (!isValidEmailClient(payload.usuario)) return "Informe um e-mail válido.";
  if (!payload.senha) return "Informe a senha.";
  return "";
}

function validateStrongPasswordClient(password, usuario = "") {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN_LENGTH) return `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (!/[A-Z]/.test(value)) return "A senha deve conter pelo menos uma letra maiúscula.";
  if (!/[a-z]/.test(value)) return "A senha deve conter pelo menos uma letra minúscula.";
  if (!/[0-9]/.test(value)) return "A senha deve conter pelo menos um número.";
  if (!/[^A-Za-z0-9]/.test(value)) return "A senha deve conter pelo menos um caractere especial.";
  const identity = String(usuario || "").trim().toLowerCase();
  if (identity.length >= 4 && value.toLowerCase().includes(identity)) return "A senha não pode conter o e-mail.";
  return "";
}

function renderTemporaryPasswordChange(usuario, senhaTemporaria, nome = "") {
  document.body.innerHTML = `
    <main class="auth-screen">
      <section class="auth-card">
        <div>
          <p class="eyebrow">Troca obrigatória</p>
          <h1>Alterar senha</h1>
          <p class="muted">Olá, ${escapeHtml(nome)}. Antes de acessar o sistema, cadastre uma nova senha forte.</p>
        </div>
        <form id="temporary-password-form" novalidate>
          <label>Nova senha<input name="novaSenha" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}" required></label>
          <p class="muted password-policy-hint">Use no mínimo ${PASSWORD_MIN_LENGTH} caracteres, com letra maiúscula, letra minúscula, número e caractere especial.</p>
          <label>Confirmar nova senha<input name="confirmarSenha" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}" required></label>
          <button class="primary-button" type="submit">Alterar senha</button>
          <button class="link-button" type="button" id="back-login">Voltar ao login</button>
          <p class="auth-error" id="temporary-password-message"></p>
        </form>
      </section>
    </main>
  `;
  const form = document.getElementById("temporary-password-form");
  form.addEventListener("submit", (event) => handleTemporaryPasswordChange(event, usuario, senhaTemporaria));
  document.getElementById("back-login").addEventListener("click", () => renderLogin());
  form.elements.novaSenha.focus();
}

async function handleTemporaryPasswordChange(event, usuario, senhaTemporaria) {
  event.preventDefault();
  const form = event.currentTarget;
  const messageBox = document.getElementById("temporary-password-message");
  const novaSenha = form.elements.novaSenha.value;
  const confirmarSenha = form.elements.confirmarSenha.value;
  const policyError = validateStrongPasswordClient(novaSenha, usuario);

  if (!novaSenha) {
    messageBox.textContent = "Informe a nova senha.";
    return;
  }
  if (!confirmarSenha) {
    messageBox.textContent = "Confirme a nova senha.";
    return;
  }
  if (novaSenha !== confirmarSenha) {
    messageBox.textContent = "A confirmação da senha não confere.";
    return;
  }
  if (policyError) {
    messageBox.textContent = policyError;
    return;
  }

  try {
    const response = await csrfFetch("/api/auth/change-temporary-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, senhaTemporaria, novaSenha }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível alterar a senha.");
    renderLogin(result.message || "Senha alterada com sucesso. Faça login novamente.");
  } catch (error) {
    messageBox.textContent = error.message || "Não foi possível alterar a senha.";
  }
}

async function handleForgotPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const messageBox = document.getElementById("forgot-message");
  const payload = {
    email: form.elements.email.value.trim(),
  };
  if (!payload.email) {
    messageBox.textContent = "Informe o e-mail cadastrado.";
    return;
  }
  if (!isValidEmailClient(payload.email)) {
    messageBox.textContent = "Informe um e-mail válido.";
    return;
  }

  try {
    const response = await csrfFetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível enviar a recuperação.");
    messageBox.textContent = result.message || "Se os dados estiverem corretos, enviaremos uma senha temporária.";
    form.reset();
  } catch (error) {
    messageBox.textContent = error.message || "Não foi possível enviar a recuperação.";
  }
}

async function handleFirstAccess(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const messageBox = document.getElementById("first-access-message");
  const payload = {
    nome: form.elements.nome.value.trim(),
    sobrenome: form.elements.sobrenome.value.trim(),
    dataNascimento: form.elements.dataNascimento.value,
    telefone: form.elements.telefone.value.trim(),
    email: form.elements.email.value.trim(),
    senha: form.elements.senha.value,
  };
  const confirmarSenha = form.elements.confirmarSenha.value;
  const requiredFields = [
    [payload.nome, "Informe o nome."],
    [payload.sobrenome, "Informe o sobrenome."],
    [payload.dataNascimento, "Informe a data de nascimento."],
    [payload.telefone, "Informe o telefone."],
    [payload.email, "Informe o e-mail."],
    [payload.senha, "Informe a senha."],
    [confirmarSenha, "Confirme a senha."],
  ];
  const missingField = requiredFields.find(([value]) => !value);
  const policyError = validateStrongPasswordClient(payload.senha, payload.email);

  messageBox.classList.remove("is-success");
  if (missingField) {
    messageBox.textContent = missingField[1];
    return;
  }
  if (!isValidEmailClient(payload.email)) {
    messageBox.textContent = "Informe um e-mail válido.";
    return;
  }
  if (payload.senha !== confirmarSenha) {
    messageBox.textContent = "A confirmação da senha não confere.";
    return;
  }
  if (policyError) {
    messageBox.textContent = policyError;
    return;
  }

  try {
    const response = await csrfFetch("/api/auth/first-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível enviar a solicitação.");
    form.reset();
    messageBox.classList.add("is-success");
    messageBox.textContent = result.message || "Solicitação enviada com sucesso. Aguarde a liberação do administrador.";
  } catch (error) {
    messageBox.textContent = error.message || "Não foi possível enviar a solicitação.";
  }
}

function isManualReloadNavigation() {
  const navigationEntry = performance.getEntriesByType?.("navigation")?.[0];
  if (navigationEntry?.type) return navigationEntry.type === "reload";
  return performance.navigation?.type === 1;
}

function markNextReloadAsInternal() {
  try {
    sessionStorage.setItem(SESSION_RELOAD_SKIP_KEY, "1");
  } catch {
    // sessionStorage pode estar indisponível em navegação privada/restrita.
  }
}

function consumeInternalReloadMark() {
  try {
    if (sessionStorage.getItem(SESSION_RELOAD_SKIP_KEY) !== "1") return false;
    sessionStorage.removeItem(SESSION_RELOAD_SKIP_KEY);
    return true;
  } catch {
    return false;
  }
}

function markLoginWelcome() {
  try {
    sessionStorage.setItem(LOGIN_WELCOME_KEY, "1");
  } catch {
    // sessionStorage pode estar indisponível em navegação privada/restrita.
  }
}

function consumeLoginWelcomeMark() {
  try {
    if (sessionStorage.getItem(LOGIN_WELCOME_KEY) !== "1") return false;
    sessionStorage.removeItem(LOGIN_WELCOME_KEY);
    return true;
  } catch {
    return false;
  }
}

function renderWelcomeScreen(user = currentUser) {
  document.querySelector(".welcome-screen")?.remove();
  document.body.classList.add("is-showing-welcome");
  const firstName = String(user?.nome || user?.usuario || "Bem-vindo").trim().split(/\s+/)[0] || "Bem-vindo";
  const profile = userProfileLabel(user);
  const screen = document.createElement("main");
  screen.className = "welcome-screen";
  screen.setAttribute("role", "status");
  screen.setAttribute("aria-live", "polite");
  screen.innerHTML = `
    <section class="welcome-card">
      <div class="welcome-brand">
        <img src="assets/consult-icon.png" alt="Consult">
        <div>
          <strong>ConsultApp ${renderAppVersionBadge()}</strong>
          <span>Segurança e Medicina do Trabalho</span>
        </div>
      </div>
      <div class="welcome-copy">
        <p class="eyebrow">Acesso autorizado</p>
        <h1>Bem-vindo, ${escapeHtml(firstName)}</h1>
        <p>Preparando seu ambiente de trabalho, indicadores e permissões de acesso.</p>
      </div>
      <div class="welcome-status">
        <span>${escapeHtml(profile)}</span>
        <strong>Carregando dashboard</strong>
      </div>
      <div class="welcome-progress" aria-hidden="true"><span></span></div>
    </section>
  `;
  document.body.appendChild(screen);
  return performance.now();
}

async function holdWelcomeScreen(startedAt, minimumMs = 10000) {
  const elapsed = performance.now() - startedAt;
  const remaining = Math.max(0, minimumMs - elapsed);
  if (!remaining) return;
  await new Promise((resolve) => window.setTimeout(resolve, remaining));
}

function closeWelcomeScreen() {
  const screen = document.querySelector(".welcome-screen");
  if (!screen) {
    document.documentElement.classList.remove("has-pending-welcome");
    document.body.classList.remove("is-showing-welcome");
    return;
  }
  screen.classList.add("is-leaving");
  window.setTimeout(() => {
    screen.remove();
    document.documentElement.classList.remove("has-pending-welcome");
    document.body.classList.remove("is-showing-welcome");
  }, 260);
}

async function destroySessionOnManualReload() {
  if (location.protocol === "file:" || !isManualReloadNavigation()) return;
  if (consumeInternalReloadMark()) return;

  await csrfFetch("/api/auth/close", {
    method: "POST",
    body: "{}",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  }).catch(() => {});
}

async function logoutApp() {
  explicitLogout = true;
  await csrfFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

function notifySessionClosed() {
  if (!currentUser || explicitLogout || location.protocol === "file:") return;
  csrfFetch("/api/auth/close", {
    method: "POST",
    body: "{}",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
  }).catch(() => {});
}

function stateRecordCount(value) {
  return (value?.clientes?.length || 0)
    + (value?.servicos?.length || 0)
    + (value?.orcamentos?.length || 0);
}

function parseMoney(value) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  return Number(String(value).replace(/[^\d,-]/g, "").replace(".", "").replace(",", ".")) || 0;
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : text;
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR");
}

function formatDateFile(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  if (day && month && year) return `${day}${month}${year}`;
  return String(value).replace(/\D/g, "");
}

function formatAddress(cliente) {
  const parts = [
    cliente.endereco,
    cliente.numero,
    cliente.bairro,
    cliente.cidade,
    cliente.uf ? `(${cliente.uf})` : "",
  ].filter(Boolean);
  return parts.join(" - ");
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function budgetFileName(orcamento) {
  return `${orcamento.numero}-${onlyDigits(orcamento.clienteDocumento)}-${formatDateFile(orcamento.data)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fieldValue(value) {
  return escapeHtml(value ?? "");
}

function selectedAttr(current, expected) {
  return String(current ?? "") === String(expected ?? "") ? " selected" : "";
}

function normalizeOrcamentoStatus(status) {
  const raw = String(status || "").trim();
  const clean = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uFFFD/g, "")
    .toUpperCase();

  if (clean.includes("REPROV")) return "REPROVADO";
  if (clean.includes("APROV")) return "APROVADO";
  if (clean.includes("ANLISE") || clean.includes("ANALISE") || clean.includes("AN")) return "EM ANÁLISE";
  return raw;
}

function normalizeClienteStatus(status) {
  return String(status || "ATIVO").trim().toUpperCase() === "INATIVO" ? "INATIVO" : "ATIVO";
}

function isClienteAtivo(cliente) {
  return normalizeClienteStatus(cliente?.status) === "ATIVO";
}

function normalizeCidade(cidade) {
  const raw = String(cidade || "").trim();
  const clean = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uFFFD/g, "")
    .toUpperCase();

  if (clean === "SO PAULO" || clean === "SAO PAULO") return "São Paulo";
  return raw;
}

function statusClass(status) {
  const clean = normalizeOrcamentoStatus(status);
  if (clean.includes("REPROV")) return "danger";
  if (clean.includes("ANÁLISE") || clean.includes("ANALISE")) return "warning";
  return "";
}

function totalOrcamento(orcamento) {
  return (orcamento.itens || []).reduce((sum, item) => {
    return sum + Number(item.quantidade || 0) * Number(item.valorUnitario || 0) - Number(item.desconto || 0);
  }, 0);
}

function totalCadastradoOrcamento(orcamento) {
  return (orcamento.itens || []).reduce((sum, item) => {
    const servico = servicoByCodigo(item.servicoCodigo);
    return sum + Number(item.quantidade || 0) * Number(servico?.valor || 0);
  }, 0);
}

function totalDescontosOrcamento(orcamento) {
  return (orcamento.itens || []).reduce((sum, item) => sum + Number(item.desconto || 0), 0);
}

function isOrcamentoReprovado(orcamento) {
  return String(orcamento?.status || "").toUpperCase().includes("REPROV");
}

function isOrcamentoAprovado(orcamento) {
  return String(orcamento?.status || "").toUpperCase().includes("APROV");
}

function clienteByDocumento(documento) {
  const digits = onlyDigits(documento);
  return state.clientes.find((cliente) => (
    cliente.documento === documento
      || (digits && onlyDigits(cliente.documento) === digits)
  ));
}

function isOrcamentoClienteAtivo(orcamento) {
  return isClienteAtivo(clienteByDocumento(orcamento?.clienteDocumento));
}

function orcamentosEstatisticos() {
  return state.orcamentos.filter((orcamento) => !isOrcamentoReprovado(orcamento) && isOrcamentoClienteAtivo(orcamento));
}

function orcamentosAprovados() {
  return state.orcamentos.filter((orcamento) => isOrcamentoAprovado(orcamento) && isOrcamentoClienteAtivo(orcamento));
}

function clienteNome(documento) {
  return clienteByDocumento(documento)?.nome || documento || "Cliente não informado";
}

function servicoNome(codigo) {
  return state.servicos.find((servico) => servico.codigo === String(codigo))?.nome || codigo || "Serviço";
}

function normalizeServicoStatus(status) {
  const clean = String(status || "ATIVO")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  return clean.includes("INAT") ? "INATIVO" : "ATIVO";
}

function isServicoAtivo(servico) {
  return normalizeServicoStatus(servico?.status) === "ATIVO";
}

function servicoByCodigo(codigo) {
  return state.servicos.find((servico) => servico.codigo === String(codigo));
}

function nextBudgetNumber() {
  let number = 15000;
  const used = new Set(state.orcamentos.map((item) => Number(item.numero || 0)));
  while (used.has(number)) number += 1;
  return number;
}

function viewPermission(view) {
  return {
    dashboard: "dashboard.view",
    clientes: "clientes.view",
    servicos: "servicos.view",
    orcamentos: "orcamentos.view",
    financeiro: "financeiro.view",
    relatorios: "relatorios.view",
    arquivos: "arquivos.view",
    usuarios: "usuarios.view",
    auditoria: "auditoria.view",
    documentacao: "",
    ajuda: "",
  }[view] || "";
}

function canView(view) {
  if (view === "documentacao") return isSuperAdminUser();
  const permission = viewPermission(view);
  return !permission || hasPermission(permission);
}

function menuViewsForGroup(group) {
  return {
    financeiro: ["orcamentos", "relatorios"],
    administracao: ["usuarios", "arquivos", "auditoria", "documentacao"],
  }[group] || [];
}

function menuGroupForView(view) {
  if (view === "financeiro" || menuViewsForGroup("financeiro").includes(view)) return "financeiro";
  if (menuViewsForGroup("administracao").includes(view)) return "administracao";
  return "";
}

function canShowMenuGroup(group) {
  const views = menuViewsForGroup(group);
  if (group === "financeiro") return canView("financeiro") || views.some((view) => canView(view));
  return views.some((view) => canView(view));
}

function syncNavigationMenus() {
  const activeView = document.querySelector(".view.is-active")?.id?.replace("-view", "") || "dashboard";
  document.querySelectorAll("[data-menu-group]").forEach((button) => {
    const group = button.dataset.menuGroup;
    const visible = canShowMenuGroup(group);
    const active = menuGroupForView(activeView) === group;
    const open = visible && openMenuGroup === group;
    button.hidden = !visible;
    button.classList.toggle("is-active", active);
    button.classList.toggle("is-open", open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
  });

  document.querySelectorAll("[data-submenu]").forEach((submenu) => {
    const group = submenu.dataset.submenu;
    submenu.hidden = !(canShowMenuGroup(group) && openMenuGroup === group);
  });
}

function setView(view) {
  if (!canView(view)) {
    showNoPermissionMessage();
    return;
  }
  openMenuGroup = menuGroupForView(view);
  if (view === "orcamentos" && !editingOrcamentoNumero && !pendingOrcamentoFormDraft) blankNewOrcamento = !isCompactLayout();
  document.querySelectorAll(".nav-button").forEach((button) => {
    const group = button.dataset.menuGroup;
    const active = group ? menuGroupForView(view) === group : button.dataset.view === view;
    button.classList.toggle("is-active", active);
  });
  syncNavigationMenus();

  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("is-active", section.id === `${view}-view`);
  });

  const viewTitle = document.getElementById("view-title");
  if (viewTitle) viewTitle.textContent = titles[view];
  if (view === "dashboard") {
    refreshDashboardFromServer();
  } else {
    renderCurrentView(view);
  }
  if (["clientes", "servicos", "arquivos", "usuarios"].includes(view)) {
    resetCompactViewScroll(`#${view}-view`);
  }
}

function render() {
  renderSidebarPanel();
  renderDashboard();
  renderClientes();
  renderServicos();
  renderOrcamentos();
  renderFinanceiro();
  renderRelatorios();
  if (hasPermission("arquivos.view")) renderArquivos();
  if (canManageUsers()) renderUsuarios();
  if (hasPermission("auditoria.view")) renderAuditoria();
  if (isSuperAdminUser()) renderDocumentacao();
  renderAjuda();
}

function renderCurrentView(view) {
  renderSidebarPanel();
  if (view === "clientes") {
    renderClientes();
    return;
  }
  if (view === "servicos") {
    renderServicos();
    return;
  }
  if (view === "orcamentos") {
    renderOrcamentos();
    return;
  }
  if (view === "financeiro") {
    renderFinanceiro();
    return;
  }
  if (view === "relatorios") {
    renderRelatorios();
    return;
  }
  if (view === "arquivos") {
    renderArquivos();
    return;
  }
  if (view === "usuarios") {
    renderUsuarios();
    return;
  }
  if (view === "auditoria") {
    renderAuditoria();
    return;
  }
  if (view === "documentacao") {
    renderDocumentacao();
    return;
  }
  if (view === "ajuda") renderAjuda();
}

function renderSidebarPanel() {
  const userBox = document.getElementById("sidebar-user");
  const userName = document.getElementById("current-user-name");
  if (userBox && userName) {
    userBox.hidden = !currentUser;
    userName.textContent = currentUser ? `${currentUser.nome} (${userProfileLabel(currentUser)})` : "";
  }
  document.querySelectorAll("[data-view]").forEach((element) => {
    element.hidden = !canView(element.dataset.view);
  });
  const financeViews = menuViewsForGroup("financeiro");
  const hasFinanceItem = canView("financeiro") || financeViews.some((view) => canView(view));
  document.querySelector('[data-menu-group="financeiro"]')?.toggleAttribute("hidden", !hasFinanceItem);
  const adminViews = menuViewsForGroup("administracao");
  const hasAdminItem = adminViews.some((view) => canView(view));
  document.querySelector('[data-menu-group="administracao"]')?.toggleAttribute("hidden", !hasAdminItem);
  syncNavigationMenus();
  document.querySelectorAll("[data-sidebar-new]").forEach((element) => {
    element.hidden = !hasPermission(`${element.dataset.sidebarNew}.create`) || !canManageData();
  });

  const activeView = document.querySelector(".view.is-active")?.id?.replace("-view", "") || "dashboard";
  const summary = sidebarSummaryForView(activeView);
  const labelOne = document.getElementById("side-label-one");
  const labelTwo = document.getElementById("side-label-two");
  const labelThree = document.getElementById("side-label-three");
  const valueOne = document.getElementById("side-value-one");
  const valueTwo = document.getElementById("side-value-two");
  const valueThree = document.getElementById("side-value-three");

  if (labelOne) labelOne.textContent = summary[0].label;
  if (valueOne) valueOne.textContent = summary[0].value;
  if (labelTwo) labelTwo.textContent = summary[1].label;
  if (valueTwo) valueTwo.textContent = summary[1].value;
  if (labelThree) labelThree.textContent = summary[2].label;
  if (valueThree) valueThree.textContent = summary[2].value;
}

function sidebarSummaryForView(view) {
  if (view === "clientes") {
    const biggestBudget = orcamentosEstatisticos()
      .slice()
      .sort((a, b) => totalOrcamento(b) - totalOrcamento(a))[0];
    return [
      { label: "Total clientes", value: String(state.clientes.length) },
      { label: "Maior orçamento", value: biggestBudget ? currency.format(totalOrcamento(biggestBudget)) : "R$ 0,00" },
      { label: "Nº orçamento", value: biggestBudget ? `Nº ${biggestBudget.numero}` : "-" },
    ];
  }

  if (view === "servicos") {
    const serviceTotals = new Map();
    orcamentosEstatisticos().forEach((orcamento) => {
      (orcamento.itens || []).forEach((item) => {
        const total = Number(item.quantidade || 0) * Number(item.valorUnitario || 0) - Number(item.desconto || 0);
        const current = serviceTotals.get(String(item.servicoCodigo)) || 0;
        serviceTotals.set(String(item.servicoCodigo), current + total);
      });
    });
    const biggestService = [...serviceTotals.entries()]
      .map(([codigo, value]) => ({ codigo, value }))
      .sort((a, b) => b.value - a.value)[0];

    return [
      { label: "Total serviços", value: String(state.servicos.length) },
      { label: "Maior valor total", value: biggestService ? currency.format(biggestService.value) : "R$ 0,00" },
      { label: "Nº serviço", value: biggestService ? biggestService.codigo : "-" },
    ];
  }

  if (view === "orcamentos") {
    const analysisBudgets = orcamentosEstatisticos().filter((orcamento) => {
      const status = String(orcamento.status || "").toUpperCase();
      return status.includes("ANÁLISE") || status.includes("ANALISE");
    });
    const approvedBudgets = orcamentosAprovados();
    const analysisTotal = analysisBudgets.reduce((sum, orcamento) => sum + totalOrcamento(orcamento), 0);
    const approvedTotal = approvedBudgets.reduce((sum, orcamento) => sum + totalOrcamento(orcamento), 0);

    return [
      { label: "Em análise", value: String(analysisBudgets.length) },
      { label: "Valor em análise", value: currency.format(analysisTotal) },
      { label: "Valor aprovado", value: currency.format(approvedTotal) },
    ];
  }

  if (view === "financeiro") {
    const approvedBudgets = orcamentosAprovados();
    const approvedTotal = approvedBudgets.reduce((sum, orcamento) => sum + totalOrcamento(orcamento), 0);
    const averageTicket = approvedBudgets.length ? approvedTotal / approvedBudgets.length : 0;
    return [
      { label: "Aprovados", value: String(approvedBudgets.length) },
      { label: "Receita prevista", value: currency.format(approvedTotal) },
      { label: "Ticket médio", value: currency.format(averageTicket) },
    ];
  }

  if (view === "relatorios") {
    const statisticalBudgets = orcamentosEstatisticos();
    const approved = orcamentosAprovados().length;
    return [
      { label: "Relatórios", value: "3" },
      { label: "Base estatística", value: String(statisticalBudgets.length) },
      { label: "Aprovados", value: String(approved) },
    ];
  }

  if (view === "arquivos") {
    return [
      { label: "Arquivos", value: String(arquivos.length) },
      { label: "Orçamentos", value: String(arquivos.filter((file) => file.categoria === "orcamentos").length) },
      { label: "Relatórios", value: String(arquivos.filter((file) => file.categoria === "relatorios").length) },
    ];
  }

  if (view === "auditoria") {
    return [
      { label: "Logs filtrados", value: String(auditoriaMeta.total || auditoriaLogs.length) },
      { label: "Página", value: `${auditoriaMeta.page || 1}/${auditoriaMeta.pages || 1}` },
      { label: "Usuários", value: String(new Set(auditoriaLogs.map((log) => log.usuario).filter(Boolean)).size) },
    ];
  }

  if (view === "documentacao") {
    return [
      { label: "Registros", value: String(DOCUMENTATION_RECORDS.length) },
      { label: "Títulos", value: String(documentationUniqueValues("title").length) },
      { label: "Tags", value: String(documentationUniqueValues("tag").length) },
    ];
  }

  const statisticalBudgets = orcamentosEstatisticos();
  const openBudgets = statisticalBudgets.filter((orcamento) => String(orcamento.status || "").toUpperCase().includes("AN"));
  const totalOpen = openBudgets.reduce((sum, orcamento) => sum + totalOrcamento(orcamento), 0);
  const lastBudget = statisticalBudgets.slice().sort((a, b) => Number(b.numero || 0) - Number(a.numero || 0))[0];

  return [
    { label: "Em análise", value: String(openBudgets.length) },
    { label: "Total", value: currency.format(totalOpen) },
    { label: "Último", value: lastBudget ? `Nº ${lastBudget.numero}` : "-" },
  ];
}

function isDashboardActive() {
  return document.getElementById("dashboard-view")?.classList.contains("is-active");
}

async function refreshDashboardFromServer() {
  renderSidebarPanel();
  renderDashboard();
  if (pendingSave) {
    await pendingSave;
  }

  try {
    const serverState = await loadServerState();
    if (serverState) {
      state = serverState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderSidebarPanel();
      renderDashboard();
    }
  } catch (error) {
    showFloatingMessage(error.message || "Não foi possível atualizar o dashboard.");
  }
}

function renderDashboard() {
  const statisticalBudgets = orcamentosEstatisticos();
  const totalAberto = statisticalBudgets
    .filter((orcamento) => String(orcamento.status).toUpperCase().includes("AN"))
    .reduce((sum, orcamento) => sum + totalOrcamento(orcamento), 0);

  document.getElementById("dashboard-view").innerHTML = `
    <div class="dashboard-banner">
      <img src="assets/banner-dashboard.png" alt="Consult - Serviços e soluções">
    </div>
    <div class="stats-grid">
      ${stat("Clientes", state.clientes.length)}
      ${stat("Serviços", state.servicos.length)}
      ${stat("Orçamentos", statisticalBudgets.length)}
      ${stat("Em análise", currency.format(totalAberto))}
    </div>
    <section class="dashboard-charts">
      ${pieChart("Maiores clientes", topClientesPorValor())}
      ${barChart("Valor de orçamentos", orcamentosPorValor())}
      ${barChart("Serviços mais solicitados", servicosPorValor())}
    </section>
    <section class="panel dashboard-list-panel">
      <div class="toolbar">
        <h2>5 últimos orçamentos</h2>
      </div>
      ${budgetTable(state.orcamentos.slice().reverse().slice(0, 5), { showDetail: false })}
    </section>
  `;
}

function renderFinanceiro() {
  const approvedBudgets = orcamentosAprovados();
  const recentApprovedBudgets = approvedBudgets
    .slice()
    .sort((a, b) => Number(b.numero || 0) - Number(a.numero || 0))
    .slice(0, 10)
    .reverse();
  const analysisBudgets = orcamentosEstatisticos().filter((orcamento) => {
    const status = String(orcamento.status || "").toUpperCase();
    return status.includes("ANÁLISE") || status.includes("ANALISE");
  });
  const approvedTotal = approvedBudgets.reduce((sum, orcamento) => sum + totalOrcamento(orcamento), 0);
  const analysisTotal = analysisBudgets.reduce((sum, orcamento) => sum + totalOrcamento(orcamento), 0);
  const averageTicket = approvedBudgets.length ? approvedTotal / approvedBudgets.length : 0;
  const biggestApproved = approvedBudgets.slice().sort((a, b) => totalOrcamento(b) - totalOrcamento(a))[0];

  document.getElementById("financeiro-view").innerHTML = `
    ${pageBanner()}
    <div class="stats-grid">
      ${stat("Receita aprovada", currency.format(approvedTotal))}
      ${stat("Em análise", currency.format(analysisTotal))}
      ${stat("Ticket médio", currency.format(averageTicket))}
      ${stat("Maior aprovado", biggestApproved ? `Nº ${biggestApproved.numero}` : "-")}
    </div>
    <section class="dashboard-charts">
      ${barChart("10 últimos aprovados", recentApprovedBudgets.map((orcamento) => ({
        label: `Nº ${orcamento.numero}`,
        value: totalOrcamento(orcamento),
      })))}
      ${pieChart("Clientes aprovados", clientesAprovadosPorValor(recentApprovedBudgets))}
      ${barChart("Serviços aprovados", servicosAprovadosPorValor(recentApprovedBudgets))}
    </section>
    <section class="panel dashboard-list-panel">
      <div class="toolbar">
        <h2>Orçamentos aprovados</h2>
      </div>
      ${financeiroTable(approvedBudgets)}
    </section>
  `;
}

function renderRelatorios() {
  const filteredBudgets = filteredReportBudgets();
  const topFilteredClientes = topClientesPorValor(filteredBudgets);
  const topFilteredBudgets = topOrcamentosPorValor(filteredBudgets);
  const approvedBudgets = filteredBudgets.filter(isOrcamentoAprovado);
  const totalFiltered = filteredBudgets.reduce((sum, orcamento) => sum + totalOrcamento(orcamento), 0);
  const totalApproved = approvedBudgets.reduce((sum, orcamento) => sum + totalOrcamento(orcamento), 0);
  const averageTicket = filteredBudgets.length ? totalFiltered / filteredBudgets.length : 0;

  document.getElementById("relatorios-view").innerHTML = `
    ${pageBanner()}
    <section class="panel report-export-panel">
      <div class="toolbar">
        <div>
          <h2>Relatório de Orçamento e Serviços Solicitados</h2>
          <p>Gere relatórios consolidados para acompanhar vendas, clientes e serviços.</p>
        </div>
      </div>
      <form class="report-filter-grid" id="report-filter-form">
        <label>Data inicial<input type="date" name="dataInicio" value="${fieldValue(reportFilters.dataInicio)}"></label>
        <label>Data final<input type="date" name="dataFim" value="${fieldValue(reportFilters.dataFim)}"></label>
        <label>Status do orçamento
          <select name="status">
            <option value=""${selectedAttr(reportFilters.status, "")}>Todos</option>
            ${options(["EM ANÁLISE", "APROVADO", "REPROVADO"], reportFilters.status)}
          </select>
        </label>
        <label>Status do cliente
          <select name="clienteStatus">
            <option value="TODOS"${selectedAttr(reportFilters.clienteStatus, "TODOS")}>Todos</option>
            <option value="ATIVO"${selectedAttr(reportFilters.clienteStatus, "ATIVO")}>Ativos</option>
            <option value="INATIVO"${selectedAttr(reportFilters.clienteStatus, "INATIVO")}>Inativos</option>
          </select>
        </label>
        <label>Status do serviço
          <select name="servicoStatus">
            <option value="TODOS"${selectedAttr(reportFilters.servicoStatus, "TODOS")}>Todos</option>
            <option value="ATIVO"${selectedAttr(reportFilters.servicoStatus, "ATIVO")}>Ativo</option>
            <option value="INATIVO"${selectedAttr(reportFilters.servicoStatus, "INATIVO")}>Inativo</option>
          </select>
        </label>
        <div class="form-actions">
          <button type="submit" class="primary-button">Filtrar</button>
          <button type="button" class="ghost-button" id="clear-report-filters">Limpar</button>
        </div>
      </form>
      ${canExportReports() ? `
        <div class="report-export-actions">
          <button type="button" class="primary-button" data-export-report="vendas">Vendas</button>
          <button type="button" class="primary-button" data-export-report="clientes">Clientes</button>
          <button type="button" class="primary-button" data-export-report="servicos">Serviços</button>
        </div>
      ` : '<p class="muted">Acesso somente leitura. Exportação disponível apenas para perfis autorizados.</p>'}
    </section>
    <div class="stats-grid report-stats-grid">
      ${stat("Orçamentos filtrados", filteredBudgets.length)}
      ${stat("Valor filtrado", currency.format(totalFiltered))}
      ${stat("Valor aprovado", currency.format(totalApproved))}
      ${stat("Ticket médio", currency.format(averageTicket))}
    </div>
    <section class="dashboard-charts">
      ${pieChart("Orçamentos por status", orcamentosPorStatus({ budgets: filteredBudgets }))}
      ${barChart("5 maiores clientes", topFilteredClientes)}
      ${barChart("5 maiores orçamentos", topFilteredBudgets)}
    </section>
    <section class="reports-grid">
      <article class="panel report-panel">
        <div class="toolbar"><h2>Resumo por status</h2></div>
        ${statusReportTable(filteredBudgets)}
      </article>
      <article class="panel report-panel">
        <div class="toolbar"><h2>5 maiores clientes</h2></div>
        ${chartDataTable(topFilteredClientes, "Cliente")}
      </article>
      <article class="panel report-panel">
        <div class="toolbar"><h2>5 maiores orçamentos</h2></div>
        ${chartDataTable(topFilteredBudgets, "Orçamento")}
      </article>
    </section>
  `;

  document.getElementById("report-filter-form")?.addEventListener("submit", handleReportFilterSubmit);
  document.getElementById("clear-report-filters")?.addEventListener("click", clearReportFilters);
}

function handleReportFilterSubmit(event) {
  event.preventDefault();
  reportFilters = Object.fromEntries(new FormData(event.currentTarget));
  renderRelatorios();
  renderSidebarPanel();
}

function clearReportFilters() {
  reportFilters = {
    dataInicio: "",
    dataFim: "",
    status: "",
    clienteStatus: "TODOS",
    servicoStatus: "TODOS",
  };
  renderRelatorios();
  renderSidebarPanel();
}

function filteredReportBudgets() {
  const applyServiceFilter = reportFilters.servicoStatus && reportFilters.servicoStatus !== "TODOS";
  const allowedServiceCodes = applyServiceFilter ? filteredReportServiceCodes() : null;
  const selectedBudgetStatus = normalizeOrcamentoStatus(reportFilters.status || "");
  return state.orcamentos.reduce((budgets, orcamento) => {
    const clienteAtivo = isOrcamentoClienteAtivo(orcamento);
    if (reportFilters.clienteStatus === "ATIVO" && !clienteAtivo) return budgets;
    if (reportFilters.clienteStatus === "INATIVO" && clienteAtivo) return budgets;

    if (selectedBudgetStatus && normalizeOrcamentoStatus(orcamento.status) !== selectedBudgetStatus) return budgets;
    if (reportFilters.dataInicio && String(orcamento.data || "") < reportFilters.dataInicio) return budgets;
    if (reportFilters.dataFim && String(orcamento.data || "") > reportFilters.dataFim) return budgets;

    if (applyServiceFilter) {
      const filteredItems = (orcamento.itens || []).filter((item) => allowedServiceCodes.has(String(item.servicoCodigo || "")));
      if (!filteredItems.length) return budgets;
      budgets.push({ ...orcamento, itens: filteredItems });
      return budgets;
    }

    budgets.push(orcamento);
    return budgets;
  }, []);
}

function filteredReportServices() {
  return state.servicos.filter((servico) => {
    if (reportFilters.servicoStatus === "ATIVO" && !isServicoAtivo(servico)) return false;
    if (reportFilters.servicoStatus === "INATIVO" && isServicoAtivo(servico)) return false;
    return true;
  });
}

function filteredReportServiceCodes() {
  return new Set(filteredReportServices().map((servico) => String(servico.codigo)));
}

function hasBudgetReportFilters() {
  return Boolean(
    reportFilters.dataInicio ||
    reportFilters.dataFim ||
    reportFilters.status ||
    (reportFilters.servicoStatus && reportFilters.servicoStatus !== "TODOS")
  );
}

function reportFilterDescription() {
  const filters = [];
  if (reportFilters.dataInicio) filters.push(`Data inicial: ${formatDate(reportFilters.dataInicio)}`);
  if (reportFilters.dataFim) filters.push(`Data final: ${formatDate(reportFilters.dataFim)}`);
  if (reportFilters.status) filters.push(`Status do orçamento: ${normalizeOrcamentoStatus(reportFilters.status)}`);
  if (reportFilters.clienteStatus && reportFilters.clienteStatus !== "TODOS") {
    filters.push(`Status do cliente: ${normalizeClienteStatus(reportFilters.clienteStatus)}`);
  }
  if (reportFilters.servicoStatus && reportFilters.servicoStatus !== "TODOS") {
    filters.push(`Status do serviço: ${normalizeServicoStatus(reportFilters.servicoStatus)}`);
  }

  if (!filters.length) return "Nenhum filtro selecionado.";
  return `Filtros selecionados aplicados: ${filters.join("; ")}.`;
}

async function loadArquivos() {
  if (!hasPermission("arquivos.view")) return [];
  const response = await fetch("/api/arquivos");
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível carregar arquivos.");
  arquivos = result.arquivos || [];
  return arquivos;
}

function renderArquivos() {
  const view = document.getElementById("arquivos-view");
  if (!view || !hasPermission("arquivos.view")) return;

  view.innerHTML = `
    ${pageBanner()}
    <section class="panel files-panel">
      <div class="toolbar">
        <div>
          <h2>Arquivos salvos</h2>
          <p>PDFs armazenados no banco de dados.</p>
        </div>
        <button type="button" class="primary-button files-toolbar-refresh-button" id="refresh-files">Atualizar</button>
      </div>
      <div id="files-list">${emptyState()}</div>
    </section>
  `;

  document.getElementById("refresh-files")?.addEventListener("click", refreshArquivos);
  document.getElementById("refresh-files-list")?.addEventListener("click", refreshArquivos);
  refreshArquivos();
}

async function refreshArquivos() {
  const target = document.getElementById("files-list");
  if (!target) return;
  target.innerHTML = '<p class="muted">Carregando arquivos...</p>';
  try {
    await loadArquivos();
    renderSidebarPanel();
    target.innerHTML = arquivos.length ? arquivosTable(arquivos) : emptyState();
  } catch (error) {
    target.innerHTML = `<p class="muted">${escapeHtml(error.message || "Não foi possível carregar arquivos.")}</p>`;
  }
}

function arquivosTable(files) {
  const canDeleteFiles = hasPermission("arquivos.delete") && canManageData();
  const sortedFiles = applyTableSort("arquivos", files.slice(), {
    nome: (file) => file.nome || "",
    categoria: (file) => file.categoria === "orcamentos" ? "Orçamento" : "Relatório",
    tamanho: (file) => Number(file.tamanho || 0),
    atualizado: (file) => file.updatedAt || file.createdAt || "",
  });
  return `
    <div class="table-wrap files-table-wrap">
      <table>
        <thead><tr>
          ${sortableTableHeader("arquivos", "nome", "Arquivo")}
          ${sortableTableHeader("arquivos", "categoria", "Origem")}
          ${sortableTableHeader("arquivos", "tamanho", "Tamanho")}
          ${sortableTableHeader("arquivos", "atualizado", "Atualizado em")}
          <th>Ações</th>
        </tr></thead>
        <tbody>
          ${sortedFiles.map((file) => `
            <tr>
              <td><strong>${escapeHtml(file.nome)}</strong></td>
              <td>${escapeHtml(file.categoria === "orcamentos" ? "Orçamento" : "Relatório")}</td>
              <td>${escapeHtml(formatFileSize(file.tamanho))}</td>
              <td>${escapeHtml(formatDateTime(file.updatedAt || file.createdAt))}</td>
              <td>
                <div class="row-actions files-row-actions">
                  <a class="small-button" href="${escapeHtml(file.url)}" target="_blank" rel="noopener" data-open-pdf-file>Visualizar</a>
                  ${canDeleteFiles ? `<button type="button" class="small-button danger-text" data-delete-arquivo="${escapeHtml(file.categoria)}" data-delete-arquivo-nome="${escapeHtml(file.nome)}">Excluir</button>` : ""}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function isAndroidWebView() {
  return document.documentElement.classList.contains("consult-android");
}

function openDocumentUrl(url) {
  const absoluteUrl = new URL(url, location.href).href;
  if (isAndroidWebView()) {
    location.href = `consult-open://external?url=${encodeURIComponent(absoluteUrl)}`;
    return;
  }
  window.open(absoluteUrl, "_blank", "noopener");
}

function formatFileSize(value) {
  const size = Number(value || 0);
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${size} B`;
}

async function deleteArquivo(categoria, nome) {
  if (!hasPermission("arquivos.delete") || !canManageData()) {
    showNoPermissionMessage();
    return;
  }
  if (!confirm(`Excluir o arquivo "${nome}"?`)) return;

  try {
    const response = await csrfFetch(`/api/arquivos/${encodeURIComponent(categoria)}/${encodeURIComponent(nome)}`, {
      method: "DELETE",
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Não foi possível excluir o arquivo.");
    }
    showFloatingMessage("Arquivo excluído.", "success");
    await refreshArquivos();
  } catch (error) {
    showFloatingMessage(error.message || "Não foi possível excluir o arquivo.", "error");
  }
}

async function loadUsuarios() {
  if (!canManageUsers()) return [];
  const response = await fetch("/api/usuarios");
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível carregar usuários.");
  usuarios = result.usuarios || [];
  return usuarios;
}

async function loadAuditoria(filters = {}) {
  if (!hasPermission("auditoria.view")) return [];
  const requestedPage = Number(filters.page || auditoriaFilters.page || 1);
  auditoriaFilters = {
    ...auditoriaFilters,
    ...filters,
    page: Number.isFinite(requestedPage) ? Math.max(requestedPage, 1) : 1,
    limit: String(filters.limit || auditoriaFilters.limit || "100"),
  };
  const params = new URLSearchParams();
  Object.entries(auditoriaFilters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const response = await fetch(`/api/auditoria?${params.toString()}`);
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível carregar auditoria.");
  auditoriaLogs = result.logs || [];
  auditoriaMeta = {
    total: Number(result.total || auditoriaLogs.length),
    page: Number(result.page || auditoriaFilters.page || 1),
    limit: Number(result.limit || auditoriaFilters.limit || 100),
    pages: Number(result.pages || 1),
  };
  auditoriaFilters.page = auditoriaMeta.page;
  auditoriaFilters.limit = String(auditoriaMeta.limit);
  auditoriaLoaded = true;
  return { logs: auditoriaLogs, meta: auditoriaMeta };
}

function renderAuditoria() {
  const view = document.getElementById("auditoria-view");
  if (!view || !hasPermission("auditoria.view")) return;
  const filters = auditoriaFilters;
  const compactAuditView = window.innerWidth <= 640 || window.innerHeight <= 500;
  const filtersOpen = !compactAuditView || hasActiveAuditFilters(filters) ? " open" : "";
  view.innerHTML = `
    ${pageBanner()}
    <section class="panel auditoria-panel">
      <div class="toolbar">
        <div>
          <h2>Auditoria</h2>
          <p>Rastreie ações executadas pelos usuários no sistema.</p>
        </div>
      </div>
      <details class="audit-filters"${filtersOpen}>
        <summary>Filtros de consulta</summary>
        <form class="audit-filter-grid" id="auditoria-filter-form">
          <label>Usuário<input name="usuario" placeholder="Usuário" value="${escapeHtml(filters.usuario || "")}"></label>
          <label>Ação<input name="acao" placeholder="Ex.: orçamento, login" value="${escapeHtml(filters.acao || "")}"></label>
          <label>Módulo<select name="modulo"><option value="">Todos</option>${options(["seguranca", "usuarios", "clientes", "servicos", "orcamentos", "relatorios", "auditoria", "sistema"], filters.modulo || "")}</select></label>
          <label>Data inicial<input name="dataInicio" type="date" value="${escapeHtml(filters.dataInicio || "")}"></label>
          <label>Data final<input name="dataFim" type="date" value="${escapeHtml(filters.dataFim || "")}"></label>
          <label>Por página<select name="limit">${options(["50", "100", "200", "500"], String(filters.limit || "100"))}</select></label>
          <div class="form-actions budget-form-actions">
            <button class="primary-button" type="submit">Consultar</button>
            <button class="ghost-button" type="button" id="clear-audit-filters">Limpar</button>
          </div>
        </form>
      </details>
      ${auditMaintenancePanel()}
      <div id="auditoria-list">${auditTable(auditoriaLogs)}</div>
      ${auditPagination()}
    </section>
  `;
  document.getElementById("auditoria-filter-form").addEventListener("submit", handleAuditFilter);
  document.getElementById("clear-audit-filters").addEventListener("click", async () => {
    auditoriaFilters = defaultAuditFilters();
    await refreshAuditoriaView();
  });
  document.querySelectorAll("[data-audit-page]").forEach((button) => {
    button.addEventListener("click", () => changeAuditPage(Number(button.dataset.auditPage || 1)));
  });
  document.getElementById("preview-audit-cleanup")?.addEventListener("click", () => handleAuditMaintenance("preview"));
  document.getElementById("delete-audit-old")?.addEventListener("click", () => handleAuditMaintenance("delete"));
  if (!auditoriaLoaded) refreshAuditoriaView();
}

async function handleAuditFilter(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const filters = { ...Object.fromEntries(new FormData(form)), page: 1 };
  try {
    await loadAuditoria(filters);
    renderAuditoria();
    renderSidebarPanel();
  } catch (error) {
    showFloatingMessage(error.message || "Não foi possível consultar auditoria.");
  }
}

async function refreshAuditoriaView() {
  try {
    await loadAuditoria(auditoriaFilters);
    renderAuditoria();
    renderSidebarPanel();
  } catch (error) {
    showFloatingMessage(error.message || "Não foi possível carregar auditoria.");
  }
}

function defaultAuditFilters() {
  return { usuario: "", acao: "", modulo: "", dataInicio: "", dataFim: "", limit: "100", page: 1 };
}

function hasActiveAuditFilters(filters = auditoriaFilters) {
  return ["usuario", "acao", "modulo", "dataInicio", "dataFim"].some((key) => String(filters[key] || "").trim());
}

async function changeAuditPage(page) {
  try {
    await loadAuditoria({ page });
    renderAuditoria();
    renderSidebarPanel();
  } catch (error) {
    showFloatingMessage(error.message || "Não foi possível mudar a página da auditoria.");
  }
}

function auditPagination() {
  if (!auditoriaLoaded) return "";
  const total = auditoriaMeta.total || 0;
  const page = auditoriaMeta.page || 1;
  const limit = auditoriaMeta.limit || 100;
  const pages = auditoriaMeta.pages || 1;
  const first = total ? ((page - 1) * limit) + 1 : 0;
  const last = Math.min(page * limit, total);

  return `
    <div class="audit-pagination">
      <span>${escapeHtml(`Mostrando ${first}-${last} de ${total} logs`)}</span>
      <div class="row-actions">
        <button type="button" class="small-button" data-audit-page="${page - 1}"${page <= 1 ? " disabled" : ""}>Anterior</button>
        <button type="button" class="small-button" data-audit-page="${page + 1}"${page >= pages ? " disabled" : ""}>Próxima</button>
      </div>
    </div>
  `;
}

function auditMaintenancePanel() {
  if (!hasPermission("auditoria.manage")) return "";
  const retentionOptions = [
    ["90", "90 dias"],
    ["180", "180 dias"],
    ["365", "1 ano"],
    ["730", "2 anos"],
    ["1095", "3 anos"],
  ].map(([value, label]) => `<option value="${value}"${selectedAttr("365", value)}>${label}</option>`).join("");

  return `
    <details class="audit-maintenance">
      <summary>
        <span>
          <strong>Manutenção dos logs</strong>
          <small>Simule antes de excluir registros antigos.</small>
        </span>
      </summary>
      <div class="audit-maintenance-body">
        <label>Retenção
          <select id="audit-retention-days">
            ${retentionOptions}
          </select>
        </label>
        <button type="button" class="ghost-button" id="preview-audit-cleanup">Simular</button>
        <button type="button" class="danger-button" id="delete-audit-old">Excluir antigos</button>
      </div>
    </details>
  `;
}

async function requestAuditMaintenance(mode, olderThanDays) {
  const response = await csrfFetch("/api/auditoria/manutencao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, olderThanDays }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível executar a manutenção da auditoria.");
  return result;
}

async function handleAuditMaintenance(mode) {
  const olderThanDays = Number(document.getElementById("audit-retention-days")?.value || 365);
  try {
    const preview = await requestAuditMaintenance("preview", olderThanDays);
    const cutoffDate = formatDate(String(preview.cutoff || "").slice(0, 10));
    if (mode === "preview") {
      showFloatingMessage(`${preview.total} logs anteriores a ${cutoffDate} seriam excluídos.`, "success");
      return;
    }
    if (!preview.total) {
      showFloatingMessage(`Nenhum log anterior a ${cutoffDate} para excluir.`, "success");
      return;
    }
    const confirmed = await askConfirmChoice(
      "Excluir logs antigos?",
      `${preview.total} registros anteriores a ${cutoffDate} serão excluídos da auditoria principal.`,
      "Excluir logs"
    );
    if (!confirmed) return;
    const result = await requestAuditMaintenance("delete", olderThanDays);
    showFloatingMessage(`${result.deleted} logs antigos excluídos.`, "success");
    await loadAuditoria({ page: 1 });
    renderAuditoria();
    renderSidebarPanel();
  } catch (error) {
    showFloatingMessage(error.message || "Não foi possível limpar os logs antigos.", "error");
  }
}

function auditTable(logs) {
  if (!logs.length) return emptyState();
  const sortedLogs = applyTableSort("auditoria", logs.slice(), {
    data: (log) => log.created_at || "",
    usuario: (log) => log.usuario || "",
    perfil: (log) => log.perfil || "",
    acao: (log) => log.acao || "",
    modulo: (log) => log.modulo || "",
    item: (log) => [log.entidade_tipo, log.entidade_id].filter(Boolean).join(": "),
    detalhes: (log) => JSON.stringify(log.detalhes || {}),
    ip: (log) => log.ip || "",
  });

  return `
    <div class="table-wrap audit-table-wrap">
      <table>
        <thead><tr>
          ${sortableTableHeader("auditoria", "data", "Data")}
          ${sortableTableHeader("auditoria", "usuario", "Usuário")}
          ${sortableTableHeader("auditoria", "perfil", "Perfil")}
          ${sortableTableHeader("auditoria", "acao", "Ação")}
          ${sortableTableHeader("auditoria", "modulo", "Módulo")}
          ${sortableTableHeader("auditoria", "item", "Item")}
          ${sortableTableHeader("auditoria", "detalhes", "Detalhes")}
          ${sortableTableHeader("auditoria", "ip", "IP")}
        </tr></thead>
        <tbody>
          ${sortedLogs.map((log) => `
            <tr>
              <td>${escapeHtml(formatDateTime(log.created_at))}</td>
              <td><strong>${escapeHtml(log.usuario || "-")}</strong></td>
              <td>${escapeHtml(log.perfil || "-")}</td>
              <td>${escapeHtml(log.acao || "-")}</td>
              <td>${escapeHtml(log.modulo || "-")}</td>
              <td>${escapeHtml([log.entidade_tipo, log.entidade_id].filter(Boolean).join(": ") || "-")}</td>
              <td><code>${escapeHtml(JSON.stringify(log.detalhes || {}))}</code></td>
              <td>${escapeHtml(log.ip || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderUsuarios() {
  const editingUsuario = usuarios.find((usuario) => Number(usuario.id) === Number(editingUsuarioId)) || {};
  const usuarioPermissoes = permissionsForUser(editingUsuario);
  const editable = hasPermission("usuarios.create") || hasPermission("usuarios.edit") || hasPermission("usuarios.delete");
  const canCreateUsuario = hasPermission("usuarios.create");
  const canEditUsuarios = hasPermission("usuarios.edit");
  const showUsuarioFormOnMobile = Boolean(editingUsuarioId || blankNewUsuario);
  const renderUsuarioForm = !isCompactLayout() || showUsuarioFormOnMobile;
  const view = document.getElementById("usuarios-view");
  if (!view || !canManageUsers()) return;
  const visibleUsuarios = usuarios.filter((usuario) => isSuperAdminUser() || (!usuario.superAdmin && !usuario.superadminLocked));
  const sortedUsuarios = applyTableSort("usuarios", visibleUsuarios.slice(), {
    usuario: (usuario) => usuario.usuario || "",
    nome: (usuario) => [usuario.nome, usuario.sobrenome].filter(Boolean).join(" "),
    email: (usuario) => usuario.email || "",
    perfil: (usuario) => userProfileLabel(usuario),
    status: (usuario) => usuarioStatusLabel(usuario),
  });

  view.innerHTML = `
    ${pageBanner()}
    <div class="usuarios-layout">
      <section class="panel usuarios-list-panel">
        <div class="toolbar">
          <h2>Usuários cadastrados</h2>
          ${canCreateUsuario && !showUsuarioFormOnMobile ? '<button class="success-button usuario-list-new-button" type="button" id="show-usuario-form">Novo</button>' : ""}
        </div>
        <div class="table-wrap users-table-wrap">
          <table>
            <thead><tr>
              ${sortableTableHeader("usuarios", "usuario", "Usuário")}
              ${sortableTableHeader("usuarios", "nome", "Nome")}
              ${sortableTableHeader("usuarios", "email", "E-mail")}
              ${sortableTableHeader("usuarios", "perfil", "Perfil")}
              ${sortableTableHeader("usuarios", "status", "Status")}
              <th>Ações</th>
            </tr></thead>
            <tbody>
              ${sortedUsuarios.map((usuario) => `
                <tr class="clickable-row ${Number(editingUsuarioId) === Number(usuario.id) ? "is-selected" : ""}" data-open-usuario="${escapeHtml(usuario.id)}">
                  <td><strong>${escapeHtml(usuario.usuario)}</strong></td>
                  <td>${escapeHtml([usuario.nome, usuario.sobrenome].filter(Boolean).join(" "))}</td>
                  <td>${escapeHtml(usuario.email)}</td>
                  <td>${escapeHtml(userProfileLabel(usuario))}</td>
                  <td><span class="badge ${usuarioStatusClass(usuario)}">${escapeHtml(usuarioStatusLabel(usuario))}</span></td>
                  <td>${(canEditUsuarioRecord(usuario) || canDeleteUsuarioRecord(usuario)) ? `<div class="row-actions">
                    ${canEditUsuarioRecord(usuario) ? `<button class="small-button" data-edit-usuario="${escapeHtml(usuario.id)}">Alterar</button>` : ""}
                    ${canDeleteUsuarioRecord(usuario) ? `<button class="small-button danger-text" data-delete-usuario="${escapeHtml(usuario.id)}">Excluir</button>` : ""}
                  </div>` : ""}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
      ${renderUsuarioForm ? `<section class="panel usuario-form-panel${showUsuarioFormOnMobile ? "" : " is-mobile-hidden"}">
        <h2>${editingUsuarioId ? "Alterar usuário" : "Novo usuário"}</h2>
        <form class="usuario-form-grid" id="usuario-form">
          <label>Usuário automático<input name="usuario" readonly value="${fieldValue(editingUsuario.usuario || "Gerado ao salvar")}"></label>
          <label>Nome<input name="nome" required value="${fieldValue(editingUsuario.nome)}"></label>
          <label>Sobrenome<input name="sobrenome" value="${fieldValue(editingUsuario.sobrenome)}"></label>
          <label>E-mail<input name="email" type="email" required value="${fieldValue(editingUsuario.email)}"></label>
          <label>Data nascimento<input name="dataNascimento" type="date" value="${fieldValue(editingUsuario.dataNascimento)}"></label>
          <label>Telefone<input name="telefone" value="${fieldValue(editingUsuario.telefone)}"></label>
          <label>Perfil<select name="perfil" required><option value="">Selecione</option>${options(["ADMIN", "OPERADOR", "FINANCEIRO", "VISUALIZADOR", "CONVIDADO"], editingUsuario.perfil)}</select></label>
          ${editingUsuarioId ? `
            <label class="checkbox-line"><input name="ativo" type="checkbox" ${editingUsuario.ativo === false ? "" : "checked"}> ${editingUsuario.cadastroPendente ? "Liberar acesso" : "Usuário ativo"}</label>
            <p class="muted password-policy-hint usuario-first-access-note">Senha não é alterada manualmente. ADMIN ou superusuário pode enviar senha temporária para o usuário recriar o acesso.</p>
          ` : `
            <p class="muted password-policy-hint usuario-first-access-note">A senha será criada pelo próprio usuário no link Primeiro acesso. O cadastro ficará pendente até a liberação administrativa.</p>
          `}
          <div class="permissions-panel">
            <div class="toolbar">
              <div>
                <h3>Permissões</h3>
                <p class="muted">Use o perfil como modelo e ajuste telas ou ações específicas deste usuário.</p>
              </div>
              ${editable ? `
                <div class="permission-toolbar-actions">
                  <button class="ghost-button" type="button" id="apply-profile-permissions">Aplicar modelo do perfil</button>
                  <button class="ghost-button" type="button" id="check-all-permissions">Marcar tudo</button>
                  <button class="ghost-button" type="button" id="clear-all-permissions">Limpar tudo</button>
                </div>
              ` : ""}
            </div>
            ${permissionCheckboxes(usuarioPermissoes)}
          </div>
          ${(editingUsuarioId ? canEditUsuarios : canCreateUsuario) ? `
            <div class="form-actions budget-form-actions">
              <button class="primary-button" type="submit">${editingUsuarioId ? "Salvar alteração" : "Salvar usuário"}</button>
              ${editingUsuarioId && canResetUsuarioPassword(editingUsuario) ? '<button class="ghost-button" type="button" id="reset-usuario-password">Redefinir senha</button>' : ""}
              ${editingUsuarioId ? '<button class="success-button" type="button" id="new-usuario">Novo usuário</button>' : ""}
              <button class="danger-button" type="button" id="cancel-usuario-edit">Cancelar</button>
            </div>
          ` : '<p class="muted">Acesso somente leitura.</p>'}
        </form>
      </section>` : ""}
    </div>
  `;

  const usuarioForm = document.getElementById("usuario-form");
  usuarioForm?.addEventListener("submit", saveUsuario);
  if (editable) {
    document.getElementById("new-usuario")?.addEventListener("click", newUsuario);
    document.getElementById("show-usuario-form")?.addEventListener("click", newUsuario);
    document.getElementById("cancel-usuario-edit")?.addEventListener("click", cancelUsuario);
    document.getElementById("reset-usuario-password")?.addEventListener("click", () => resetUsuarioPassword(editingUsuarioId));
    document.getElementById("apply-profile-permissions")?.addEventListener("click", applyProfilePermissionsToForm);
    document.getElementById("check-all-permissions")?.addEventListener("click", () => setAllPermissions(true));
    document.getElementById("clear-all-permissions")?.addEventListener("click", () => setAllPermissions(false));
    usuarioForm?.addEventListener("click", handlePermissionGroupAction);
    usuarioForm?.querySelector('[name="perfil"]')?.addEventListener("change", applyProfilePermissionsToForm);
  } else if (usuarioForm) {
    setFormReadOnly(usuarioForm);
  }
}

function permissionCheckboxes(permissoes = {}) {
  const visiblePermissions = PERMISSIONS.filter((permission) => canManagePermissionKey(permission.key));
  const groups = [...new Set(visiblePermissions.map((permission) => permission.group))];
  return groups.map((group) => `
    <fieldset class="permission-group">
      <legend>${escapeHtml(group)}</legend>
      <div class="permission-group-actions">
        <button type="button" class="small-button" data-permission-group-action="check" data-permission-group="${escapeHtml(group)}">Marcar módulo</button>
        <button type="button" class="small-button danger-text" data-permission-group-action="clear" data-permission-group="${escapeHtml(group)}">Limpar módulo</button>
      </div>
      ${visiblePermissions.filter((permission) => permission.group === group).map((permission) => `
        <label class="checkbox-line">
          <input type="checkbox" name="permissao" value="${escapeHtml(permission.key)}" ${permissoes[permission.key] ? "checked" : ""}>
          ${escapeHtml(permission.label)}
        </label>
      `).join("")}
    </fieldset>
  `).join("");
}

function setAllPermissions(checked) {
  document.querySelectorAll('#usuario-form input[name="permissao"]').forEach((input) => {
    input.checked = checked;
  });
}

function handlePermissionGroupAction(event) {
  const button = event.target.closest("[data-permission-group-action]");
  if (!button) return;
  const group = button.dataset.permissionGroup;
  const checked = button.dataset.permissionGroupAction === "check";
  const keys = PERMISSIONS.filter((permission) => permission.group === group && canManagePermissionKey(permission.key)).map((permission) => permission.key);
  document.querySelectorAll('#usuario-form input[name="permissao"]').forEach((input) => {
    if (keys.includes(input.value)) input.checked = checked;
  });
}

function collectPermissionFormValues(form) {
  const permissoes = Object.fromEntries(PERMISSIONS.map((permission) => [permission.key, false]));
  form.querySelectorAll('input[name="permissao"]').forEach((input) => {
    permissoes[input.value] = input.checked;
  });
  return permissoes;
}

function applyProfilePermissionsToForm(event) {
  event?.preventDefault();
  const form = document.getElementById("usuario-form");
  if (!form) return;
  const perfil = form.elements.perfil.value;
  if (!perfil) {
    showFloatingMessage("Selecione um perfil antes de aplicar o modelo.");
    return;
  }
  const permissoes = defaultPermissionsForProfile(perfil);
  form.querySelectorAll('input[name="permissao"]').forEach((input) => {
    input.checked = Boolean(permissoes[input.value]);
  });
  showFloatingMessage(`Modelo ${perfil} aplicado. Clique em Salvar para gravar.`, "success");
}

async function refreshUsuariosView() {
  try {
    await loadUsuarios();
    renderUsuarios();
  } catch (error) {
    showFloatingMessage(error.message || "Não foi possível carregar usuários.");
  }
}

function newUsuario() {
  editingUsuarioId = null;
  blankNewUsuario = true;
  renderUsuarios();
  scrollUsuarioFormIntoView();
}

function cancelUsuario() {
  document.activeElement?.blur();
  editingUsuarioId = null;
  blankNewUsuario = false;
  renderUsuarios();
  resetCompactViewScroll("#usuarios-view");
}

function editUsuario(id) {
  if (!hasPermission("usuarios.edit") && !hasPermission("usuarios.view")) {
    showNoPermissionMessage();
    return;
  }
  const target = usuarios.find((usuario) => Number(usuario.id) === Number(id));
  if (!target || !canEditUsuarioRecord(target)) {
    showNoPermissionMessage();
    return;
  }
  editingUsuarioId = Number(id);
  blankNewUsuario = false;
  renderUsuarios();
  scrollUsuarioFormIntoView();
}

function scrollUsuarioFormIntoView() {
  scrollCompactElementIntoView(".usuario-form-panel");
}

function scrollUsuarioListIntoView() {
  resetCompactViewScroll("#usuarios-view");
}

async function saveUsuario(event) {
  event.preventDefault();
  const canSave = editingUsuarioId ? hasPermission("usuarios.edit") : hasPermission("usuarios.create");
  if (!canSave) {
    showNoPermissionMessage();
    return;
  }
  const form = event.currentTarget;
  const payload = {
    usuario: editingUsuarioId ? form.elements.usuario.value.trim() : "",
    nome: form.elements.nome.value.trim(),
    sobrenome: form.elements.sobrenome.value.trim(),
    email: form.elements.email.value.trim(),
    dataNascimento: form.elements.dataNascimento.value,
    telefone: form.elements.telefone.value.trim(),
    perfil: form.elements.perfil.value,
    ativo: editingUsuarioId ? form.elements.ativo.checked : false,
    permissoes: collectPermissionFormValues(form),
  };

  try {
    const response = await csrfFetch(editingUsuarioId ? `/api/usuarios/${editingUsuarioId}` : "/api/usuarios", {
      method: editingUsuarioId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível salvar usuário.");
    editingUsuarioId = null;
    blankNewUsuario = false;
    await refreshUsuariosView();
    showFloatingMessage("Usuário salvo com sucesso.");
  } catch (error) {
    showFloatingMessage(error.message || "Não foi possível salvar usuário.");
  }
}

async function deleteUsuario(id) {
  const target = usuarios.find((usuario) => Number(usuario.id) === Number(id));
  if (!target || !canDeleteUsuarioRecord(target)) {
    showNoPermissionMessage();
    return;
  }

  const confirmed = await askConfirmChoice(
    "Excluir usuário",
    "Se este usuário tiver criado clientes, serviços, orçamentos ou PDFs salvos, ele será apenas inativado para preservar o histórico.",
    "Excluir/Inativar",
  );
  if (!confirmed) return;

  try {
    const response = await csrfFetch(`/api/usuarios/${encodeURIComponent(id)}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível excluir usuário.");
    editingUsuarioId = null;
    blankNewUsuario = false;
    await refreshUsuariosView();
    showFloatingMessage(
      result.action === "deleted"
        ? "Usuário excluído com sucesso."
        : "Usuário possui registros vinculados e foi inativado.",
      "success",
    );
  } catch (error) {
    showFloatingMessage(error.message || "Não foi possível excluir usuário.", "error");
  }
}

async function resetUsuarioPassword(id) {
  const target = usuarios.find((usuario) => Number(usuario.id) === Number(id));
  if (!target || !canResetUsuarioPassword(target)) {
    showNoPermissionMessage();
    return;
  }

  const confirmed = await askConfirmChoice(
    "Redefinir senha",
    `Enviar uma senha temporária para ${target.email}? O usuário deverá criar uma nova senha no próximo acesso.`,
    "Enviar senha",
  );
  if (!confirmed) return;

  try {
    const response = await csrfFetch(`/api/usuarios/${encodeURIComponent(id)}/reset-password`, { method: "POST" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível redefinir a senha.");
    showFloatingMessage(result.message || "Senha temporária enviada para o e-mail do usuário.", "success");
  } catch (error) {
    showFloatingMessage(error.message || "Não foi possível redefinir a senha.", "error");
  }
}

function stat(label, value) {
  return `<article class="stat-card"><small>${label}</small><strong>${value}</strong></article>`;
}

function pageBanner() {
  return `
    <div class="dashboard-banner">
      <img src="assets/banner-dashboard.png" alt="Consult - Serviços e soluções">
    </div>
  `;
}

function renderAjuda() {
  const view = document.getElementById("ajuda-view");
  if (!view) return;
  view.innerHTML = `
    ${pageBanner()}
    <section class="panel help-panel">
      <div class="toolbar">
        <div>
          <h2>Manual do ConsultApp</h2>
          <p>Manual de utilização para cadastro, orçamento, acompanhamento financeiro, relatórios e administração.</p>
        </div>
      </div>
      <div class="help-manual">
        <article class="help-section help-section-wide">
          <h3>1. Visão geral</h3>
          <p>O ConsultApp centraliza clientes, serviços, orçamentos, arquivos gerados, relatórios e controle de usuários. O fluxo principal do sistema é: cadastrar cliente, manter serviços, criar orçamento, imprimir ou compartilhar, acompanhar os resultados e consultar arquivos salvos.</p>
          <div class="help-flow">
            <span>Cliente</span>
            <span>Serviços</span>
            <span>Orçamento</span>
            <span>PDF</span>
            <span>Relatórios</span>
          </div>
        </article>

        <article class="help-section">
          <h3>2. Acesso e senha</h3>
          <ol>
            <li>Na tela de login, informe o e-mail cadastrado.</li>
            <li>No primeiro acesso, clique em Primeiro acesso e informe nome, sobrenome, data de nascimento, telefone, e-mail e senha.</li>
            <li>Após o envio, o cadastro fica pendente até liberação por administrador ou usuário com privilégio para usuários.</li>
            <li>O sistema cria automaticamente um usuário técnico para auditoria, no formato nome.ultimonome. Se houver duplicidade, outra parte do nome ou uma numeração será usada.</li>
            <li>Use a opção de recuperação quando esquecer a senha.</li>
            <li>Ao receber senha temporária, acesse o sistema e altere a senha antes de continuar.</li>
            <li>As senhas precisam ter no mínimo 8 caracteres, com letra maiúscula, letra minúscula, número e caractere especial.</li>
            <li>A troca de senha é obrigatória a cada 30 dias. Após esta atualização, os usuários atuais serão convidados a trocar a senha no próximo acesso.</li>
            <li>Finalize o uso pelo botão Sair para encerrar a sessão com segurança.</li>
          </ol>
          <p class="help-note">As telas disponíveis dependem do perfil e das permissões do usuário.</p>
        </article>

        <article class="help-section">
          <h3>3. Dashboard</h3>
          <ol>
            <li>Use o Dashboard para acompanhar os principais indicadores do sistema.</li>
            <li>Clique em um orçamento listado para abrir a tela de Orçamentos já no item escolhido.</li>
            <li>Use os atalhos rápidos para iniciar clientes, serviços e orçamentos.</li>
          </ol>
        </article>

        <article class="help-section">
          <h3>4. Clientes</h3>
          <ol>
            <li>Clique em Novo para abrir o formulário de cadastro.</li>
            <li>Informe CPF ou CNPJ. O sistema valida o documento e, para CNPJ, consulta os dados cadastrais e endereço quando a base retornar essas informações.</li>
            <li>Para CNPJ, a situação precisa estar ativa para permitir cadastro.</li>
            <li>Para pessoa física (CPF), informe e-mail e CEP. O sistema consulta a base dos Correios e preenche bairro, endereço, UF e cidade.</li>
            <li>Para pessoa física (CPF), após a consulta do CEP, cabe ao usuário informar apenas número, complemento quando houver e observações.</li>
            <li>Ao salvar, o sistema confirma o cadastro e pergunta se deseja criar um orçamento para o cliente.</li>
            <li>A listagem exibe o responsável na última coluna. Os botões de ação aparecem no detalhe do cliente selecionado.</li>
            <li>Ao selecionar um cliente na lista, os dados ficam protegidos para consulta. Use Alterar para liberar campos editáveis conforme seu perfil.</li>
            <li>Ao alterar um cliente, o sistema pode executar nova consulta cadastral para atualizar dados oficiais antes da gravação.</li>
            <li>Campos preenchidos por consulta cadastral ou CEP permanecem protegidos contra alteração manual.</li>
            <li>No detalhe do cliente, use + Orçamento para iniciar um orçamento já preenchido com o cliente selecionado.</li>
            <li>No mesmo detalhe, os botões Alterar, Inativar ou Excluir aparecem conforme as permissões do perfil e a situação do cliente.</li>
            <li>A lista inferior mostra os últimos orçamentos do cliente; clique em uma linha para abrir o orçamento correspondente.</li>
          </ol>
          <p class="help-note">Clientes inativos permanecem no histórico, mas não podem receber novos orçamentos.</p>
        </article>

        <article class="help-section">
          <h3>5. Serviços</h3>
          <ol>
            <li>Cadastre o serviço com descrição, tipo, frequência, valor e status.</li>
            <li>O código do serviço é controlado pelo sistema e não deve ser digitado manualmente.</li>
            <li>Serviços inativos continuam visíveis em orçamentos antigos.</li>
            <li>Serviços inativos não podem ser inseridos em novos orçamentos.</li>
            <li>O cadastro de novos serviços depende da permissão de criação de serviços do perfil.</li>
            <li>Quando um serviço é criado a partir do orçamento, o código é preenchido automaticamente e o foco vai para o campo Serviço.</li>
          </ol>
        </article>

        <article class="help-section help-section-wide">
          <h3>6. Orçamentos</h3>
          <ol>
            <li>Clique em Novo para iniciar um orçamento. O status inicial será EM ANÁLISE.</li>
            <li>Use Buscar orçamento para consultar registros já cadastrados.</li>
            <li>Use Buscar cliente para preencher os dados do cliente no orçamento.</li>
            <li>Use o botão + ao lado do campo Cliente para cadastrar um novo cliente sem perder o orçamento em andamento.</li>
            <li>Use o botão + ao lado do campo Serviço para cadastrar um novo serviço sem perder o orçamento em andamento.</li>
            <li>Ao salvar esse novo serviço, o sistema retorna ao orçamento e já preenche o item com o serviço cadastrado.</li>
            <li>Informe serviço, quantidade, valor, desconto quando houver e observações do pedido.</li>
            <li>O valor do serviço pode ser alterado no orçamento, mas essa alteração vale apenas para o orçamento atual e não muda o valor cadastrado na tela de Serviços.</li>
            <li>Para incluir mais de um serviço no mesmo orçamento, clique em Inserir serviço. O item anterior é preservado e os campos do serviço ficam prontos para o próximo item.</li>
            <li>Clique em Salvar orçamento para gravar o orçamento completo.</li>
          </ol>
          <p class="help-note">Os botões de cliente, serviço e orçamento respeitam as permissões do perfil. Não é permitido repetir o mesmo código de serviço dentro do mesmo orçamento.</p>
        </article>

        <article class="help-section">
          <h3>7. Status do orçamento</h3>
          <ol>
            <li>Use EM ANÁLISE enquanto o orçamento ainda estiver em negociação.</li>
            <li>Use APROVADO somente quando o cliente confirmar a contratação.</li>
            <li>Use REPROVADO para propostas não aceitas.</li>
            <li>Alterações de status podem exigir privilégio específico ou confirmação de administrador.</li>
          </ol>
          <p class="help-note">Orçamentos aprovados ficam bloqueados para edição dos campos principais, preservando o histórico.</p>
        </article>

        <article class="help-section">
          <h3>8. Imprimir e compartilhar</h3>
          <ol>
            <li>No orçamento, clique em Imprimir.</li>
            <li>Escolha Sim para salvar e imprimir, Não para apenas imprimir, ou Cancelar para voltar à tela.</li>
            <li>Use Compartilhar para enviar por e-mail ou WhatsApp quando disponível.</li>
            <li>PDFs aprovados podem ser salvos no banco e consultados depois em Arquivos.</li>
          </ol>
        </article>

        <article class="help-section">
          <h3>9. Financeiro</h3>
          <ol>
            <li>Acompanhe totais, status e valores dos orçamentos.</li>
            <li>Use a listagem para abrir o detalhe de um orçamento.</li>
            <li>Indicadores financeiros respeitam as regras de status e clientes ativos.</li>
          </ol>
        </article>

        <article class="help-section">
          <h3>10. Relatórios</h3>
          <ol>
            <li>Aplique filtros por período, status do orçamento, status do cliente e status do serviço.</li>
            <li>Escolha Vendas, Clientes ou Serviços.</li>
            <li>Ao solicitar o relatório, escolha imprimir em PDF ou exportar para Excel.</li>
            <li>Clique nos 5 maiores clientes para abrir o cadastro correspondente.</li>
            <li>Clique nos 5 maiores orçamentos para abrir o orçamento correspondente.</li>
          </ol>
        </article>

        <article class="help-section">
          <h3>11. Arquivos</h3>
          <ol>
            <li>Consulte PDFs de orçamentos e relatórios salvos.</li>
            <li>Use Visualizar para abrir o documento.</li>
            <li>Use Excluir apenas quando tiver certeza de que o arquivo não será mais necessário.</li>
          </ol>
          <p class="help-note">Exclusões de arquivos são registradas na auditoria.</p>
        </article>

        <article class="help-section">
          <h3>12. Usuários e perfis</h3>
          <ol>
            <li>Solicitações de primeiro acesso entram como PENDENTE e não permitem login até serem liberadas.</li>
            <li>Ao cadastrar um usuário pela Administração, informe dados e perfil; a senha será criada pelo próprio usuário no Primeiro acesso.</li>
            <li>Ao liberar um usuário, revise dados pessoais, marque o acesso como ativo, escolha o perfil e personalize permissões quando necessário.</li>
            <li>O campo Usuário é gerado automaticamente pelo sistema e usado para rastreabilidade em logs e auditoria.</li>
            <li>Senha não é alterada manualmente no cadastro. ADMIN ou SUPERADMIN pode enviar senha temporária para o usuário recriar o acesso.</li>
            <li>Ao excluir um usuário, se houver clientes, serviços, orçamentos ou PDFs salvos vinculados ao histórico dele, o sistema inativa o cadastro em vez de apagar.</li>
            <li>ADMIN: administra cadastros e rotinas do sistema, sem acesso à Auditoria técnica.</li>
            <li>OPERADOR: usa clientes, serviços e orçamentos.</li>
            <li>FINANCEIRO: acessa financeiro, relatórios e consulta de orçamentos.</li>
            <li>VISUALIZADOR: apenas consulta.</li>
            <li>SUPERADMIN: login técnico reservado para manutenção e auditoria.</li>
          </ol>
        </article>

        <article class="help-section">
          <h3>13. Auditoria</h3>
          <ol>
            <li>A Auditoria registra ações executadas pelos usuários.</li>
            <li>Use filtros para localizar usuário, ação, módulo ou período.</li>
            <li>A manutenção dos logs permite simular ou excluir registros antigos conforme a retenção definida.</li>
          </ol>
          <p class="help-note">Esta tela é técnica e fica disponível apenas para o superusuário.</p>
        </article>

        <article class="help-section help-section-wide">
          <h3>14. Boas práticas</h3>
          <ul>
            <li>Mantenha clientes e serviços atualizados antes de criar orçamentos.</li>
            <li>Evite alterar status sem conferência, principalmente ao aprovar ou reprovar propostas.</li>
            <li>Consulte Arquivos antes de gerar novamente um PDF já aprovado.</li>
            <li>Revise filtros antes de emitir relatórios gerenciais.</li>
            <li>Use perfis mínimos necessários para cada usuário.</li>
          </ul>
        </article>
      </div>
    </section>
  `;
}

function usuarioStatusLabel(usuario = {}) {
  if (usuario.cadastroPendente) return "PENDENTE";
  return usuario.ativo ? "ATIVO" : "INATIVO";
}

function usuarioStatusClass(usuario = {}) {
  if (usuario.cadastroPendente) return "warning";
  return usuario.ativo ? "" : "danger";
}

function renderDocumentacao() {
  const view = document.getElementById("documentacao-view");
  if (!view || !isSuperAdminUser()) return;
  const records = filteredDocumentationRecords();
  view.innerHTML = `
    ${pageBanner()}
    <section class="panel documentation-panel">
      <div class="toolbar documentation-toolbar">
        <div>
          <h2>Documentação técnica do ConsultApp</h2>
          <p>Base de consulta do superadmin para regras, fluxos, permissões e operação do sistema.</p>
        </div>
        <button type="button" class="ghost-button" id="clear-documentation-filters">Limpar filtros</button>
      </div>

      <div class="documentation-layout">
        <aside class="documentation-index" aria-label="Filtros da documentação">
          <label>Buscar na documentação
            <input id="documentation-search" type="search" value="${escapeHtml(documentationFilters.query)}" placeholder="Ex.: orçamento, CNPJ, backup">
          </label>
          ${documentationFilterGroup("Título", "title", documentationUniqueValues("title"))}
          ${documentationFilterGroup("Subtítulo", "subtitle", documentationUniqueValues("subtitle"))}
          ${documentationFilterGroup("Tag", "tag", documentationUniqueValues("tag"))}
        </aside>

        <div class="documentation-results">
          <div class="documentation-result-summary">
            <strong>${records.length}</strong>
            <span>${records.length === 1 ? "registro encontrado" : "registros encontrados"}</span>
          </div>
          ${documentationActiveFilters()}
          <div class="documentation-card-grid">
            ${records.length ? records.map(documentationCard).join("") : `<div class="empty-state"><h2>Nenhum registro encontrado</h2><p>Limpe os filtros ou pesquise por outro termo.</p></div>`}
          </div>
        </div>
      </div>
    </section>
  `;

  document.getElementById("documentation-search")?.addEventListener("input", (event) => {
    documentationFilters = { ...documentationFilters, query: event.target.value };
    renderDocumentacao();
    document.getElementById("documentation-search")?.focus();
  });
  document.getElementById("clear-documentation-filters")?.addEventListener("click", () => {
    documentationFilters = { query: "", title: "", subtitle: "", tag: "" };
    renderDocumentacao();
  });
}

function filteredDocumentationRecords() {
  const query = normalizeSearch(documentationFilters.query);
  return DOCUMENTATION_RECORDS.filter((record) => {
    if (documentationFilters.title && record.title !== documentationFilters.title) return false;
    if (documentationFilters.subtitle && record.subtitle !== documentationFilters.subtitle) return false;
    if (documentationFilters.tag && !record.tags.includes(documentationFilters.tag)) return false;
    if (!query) return true;
    return normalizeSearch(`${record.title} ${record.subtitle} ${record.summary} ${record.tags.join(" ")} ${record.items.join(" ")}`).includes(query);
  });
}

function documentationUniqueValues(type) {
  if (type === "tag") {
    return [...new Set(DOCUMENTATION_RECORDS.flatMap((record) => record.tags))].sort((a, b) => sortCollator.compare(a, b));
  }
  return [...new Set(DOCUMENTATION_RECORDS.map((record) => record[type]).filter(Boolean))].sort((a, b) => sortCollator.compare(a, b));
}

function documentationFilterGroup(label, type, values) {
  const currentValue = documentationFilters[type] || "";
  return `
    <div class="documentation-filter-group">
      <h3>${escapeHtml(label)}</h3>
      <div class="documentation-filter-links">
        ${values.map((value) => {
          const active = currentValue === value;
          return `<button type="button" class="${active ? "is-active" : ""}" data-documentation-filter="${escapeHtml(type)}" data-documentation-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`;
        }).join("")}
      </div>
    </div>
  `;
}

function documentationActiveFilters() {
  const filters = [
    ["title", "Título"],
    ["subtitle", "Subtítulo"],
    ["tag", "Tag"],
  ]
    .filter(([key]) => documentationFilters[key])
    .map(([key, label]) => `
      <button type="button" class="documentation-filter-chip" data-documentation-filter="${escapeHtml(key)}" data-documentation-value="">
        ${escapeHtml(label)}: ${escapeHtml(documentationFilters[key])} ×
      </button>
    `)
    .join("");

  if (!filters && !documentationFilters.query) return "";
  return `
    <div class="documentation-active-filters">
      ${documentationFilters.query ? `<button type="button" class="documentation-filter-chip" data-documentation-filter="query" data-documentation-value="">Busca: ${escapeHtml(documentationFilters.query)} ×</button>` : ""}
      ${filters}
    </div>
  `;
}

function documentationCard(record) {
  return `
    <article class="documentation-card">
      <div>
        <p class="eyebrow">${escapeHtml(record.title)}</p>
        <h3>${escapeHtml(record.subtitle)}</h3>
        <p>${escapeHtml(record.summary)}</p>
      </div>
      <div class="documentation-tags">
        ${record.tags.map((tag) => `<button type="button" data-documentation-filter="tag" data-documentation-value="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}
      </div>
      <ul>
        ${record.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </article>
  `;
}

function topClientesPorValor(budgets = orcamentosEstatisticos()) {
  const totals = new Map();
  budgets.forEach((orcamento) => {
    const documento = String(orcamento.clienteDocumento || "");
    const key = onlyDigits(documento) || documento || clienteNome(documento);
    const current = totals.get(key) || {
      label: clienteNome(documento),
      value: 0,
      action: "cliente",
      target: documento,
    };
    current.value += totalOrcamento(orcamento);
    totals.set(key, current);
  });
  return sortedChartItems([...totals.values()], 5);
}

function orcamentosPorValor(budgets = orcamentosEstatisticos()) {
  return budgets
    .slice()
    .reverse()
    .slice(0, 8)
    .map((orcamento) => ({
      label: `Nº ${orcamento.numero}`,
      value: totalOrcamento(orcamento),
    }))
    .filter((item) => item.value > 0);
}

function topOrcamentosPorValor(budgets = orcamentosEstatisticos(), limit = 5) {
  return budgets
    .map((orcamento) => ({
      label: `Nº ${orcamento.numero} - ${clienteNome(orcamento.clienteDocumento)}`,
      value: totalOrcamento(orcamento),
      action: "orcamento",
      target: String(orcamento.numero || ""),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label), "pt-BR"))
    .slice(0, limit);
}

function servicosPorValor(budgets = orcamentosEstatisticos(), allowedCodes = null) {
  const totals = new Map();
  budgets.forEach((orcamento) => {
    (orcamento.itens || []).forEach((item) => {
      if (allowedCodes && !allowedCodes.has(String(item.servicoCodigo || ""))) return;
      const value = Number(item.quantidade || 0) * Number(item.valorUnitario || 0) - Number(item.desconto || 0);
      const label = servicoNome(item.servicoCodigo);
      totals.set(label, (totals.get(label) || 0) + value);
    });
  });
  return sortedChartData(totals, 6);
}

function reportServiceChartData(budgets) {
  const selectedServices = filteredReportServices();
  const allowedCodes = new Set(selectedServices.map((servico) => String(servico.codigo)));
  const totals = reportServiceTotals(budgets, allowedCodes);
  const rows = selectedServices.map((servico) => ({
    label: servico.nome || servico.codigo || "Serviço",
    value: totals.get(String(servico.codigo))?.valor || 0,
  }));

  const filteredByServiceStatus = reportFilters.servicoStatus && reportFilters.servicoStatus !== "TODOS";
  return rows
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label), "pt-BR"))
    .slice(0, 6);
}

function orcamentosPorStatus(options = {}) {
  const budgets = options.budgets || (options.includeRejected
    ? state.orcamentos.filter(isOrcamentoClienteAtivo)
    : orcamentosEstatisticos());
  const totals = new Map();
  budgets.forEach((orcamento) => {
    const label = normalizeOrcamentoStatus(orcamento.status || "Sem status");
    totals.set(label, (totals.get(label) || 0) + totalOrcamento(orcamento));
  });
  return sortedChartData(totals, 6);
}

function clientesAprovadosPorValor(budgets = orcamentosAprovados()) {
  const totals = new Map();
  budgets.forEach((orcamento) => {
    const label = clienteNome(orcamento.clienteDocumento);
    totals.set(label, (totals.get(label) || 0) + totalOrcamento(orcamento));
  });
  return sortedChartData(totals, 6);
}

function servicosAprovadosPorValor(budgets = orcamentosAprovados()) {
  const totals = new Map();
  budgets.forEach((orcamento) => {
    (orcamento.itens || []).forEach((item) => {
      const value = Number(item.quantidade || 0) * Number(item.valorUnitario || 0) - Number(item.desconto || 0);
      const label = servicoNome(item.servicoCodigo);
      totals.set(label, (totals.get(label) || 0) + value);
    });
  });
  return sortedChartData(totals, 6);
}

function sortedChartData(totals, limit) {
  return sortedChartItems([...totals.entries()].map(([label, value]) => ({ label, value })), limit);
}

function sortedChartItems(items, limit) {
  return items
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function emptyChart() {
  return '<div class="chart-empty">Sem dados para exibir</div>';
}

function pieChart(title, data) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const colors = ["#0aa8b5", "#165a72", "#198754", "#f4c95d", "#b84242"];
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const slices = data.map((item, index) => {
    const length = (item.value / total) * circumference;
    const slice = `
      <circle r="${radius}" cx="70" cy="70" fill="transparent" stroke="${colors[index % colors.length]}" stroke-width="28"
        stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"></circle>
    `;
    offset += length;
    return slice;
  }).join("");

  return `
    <article class="panel chart-card">
      <h2>${escapeHtml(title)}</h2>
      ${data.length ? `
        <div class="pie-chart">
          <svg viewBox="0 0 140 140" role="img" aria-label="${escapeHtml(title)}">
            <circle r="${radius}" cx="70" cy="70" fill="transparent" stroke="#edf3f4" stroke-width="28"></circle>
            ${slices}
          </svg>
          <div class="chart-legend">
            ${data.map((item, index) => `
              <div><span style="background:${colors[index % colors.length]}"></span><strong>${escapeHtml(item.label)}</strong><small>${currency.format(item.value)}</small></div>
            `).join("")}
          </div>
        </div>
      ` : emptyChart()}
    </article>
  `;
}

function chartActionAttributes(item) {
  if (item?.action === "cliente" && item.target) {
    return `data-report-open-cliente="${escapeHtml(item.target)}" title="Abrir cliente"`;
  }
  if (item?.action === "orcamento" && item.target) {
    return `data-report-open-orcamento="${escapeHtml(item.target)}" title="Abrir orçamento"`;
  }
  return "";
}

function barChart(title, data) {
  const max = Math.max(...data.map((item) => item.value), 0);
  return `
    <article class="panel chart-card">
      <h2>${escapeHtml(title)}</h2>
      ${data.length ? `
        <div class="bar-chart">
          ${data.map((item) => {
            const height = max ? Math.max(8, Math.round((item.value / max) * 100)) : 0;
            const actionAttributes = chartActionAttributes(item);
            return `
              <div class="bar-column ${actionAttributes ? "clickable-chart-item" : ""}" ${actionAttributes}>
                <div class="bar-value">${currency.format(item.value)}</div>
                <div class="bar-track"><span style="height:${height}%"></span></div>
                <div class="bar-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</div>
              </div>
            `;
          }).join("")}
        </div>
      ` : emptyChart()}
    </article>
  `;
}

function renderClientes() {
  const activeClienteDocumento = editingClienteDocumento || selectedClienteDocumento;
  const activeCliente = state.clientes.find((cliente) => cliente.documento === activeClienteDocumento) || {};
  const isEditingCliente = Boolean(editingClienteDocumento);
  const isViewingCliente = Boolean(selectedClienteDocumento && !editingClienteDocumento && !blankNewCliente);
  const useBlankForm = blankNewCliente && !activeClienteDocumento;
  const formCliente = useBlankForm ? (clienteFormPrefill || { status: "ATIVO" }) : activeCliente;
  const showClienteFormOnMobile = Boolean(activeClienteDocumento || blankNewCliente);
  const renderClienteForm = !isCompactLayout() || showClienteFormOnMobile;
  const showCnpjFields = onlyDigits(formCliente.documento).length === 14;
  const editable = canEditModule("clientes");
  const canCreateCliente = hasPermission("clientes.create") && canManageData();
  const canEditCliente = hasPermission("clientes.edit") && canManageData();
  const canCreateBudgetForCliente = hasPermission("orcamentos.create") && canManageData() && canView("orcamentos") && isClienteAtivo(formCliente);
  const canSaveClienteForm = isEditingCliente ? canEditCliente : canCreateCliente;
  const formLocked = isViewingCliente || !editable;
  const existingClienteMode = isEditingCliente || isViewingCliente;
  const formDisabledAttr = formLocked ? " disabled" : "";
  const documentReadonlyAttr = existingClienteMode ? " readonly" : "";
  const clienteFormTitle = isEditingCliente ? "Alterar cliente" : isViewingCliente ? "Cliente selecionado" : "Novo cliente";
  document.getElementById("clientes-view").innerHTML = `
    ${pageBanner()}
    <div class="clientes-layout">
      <section class="client-logo-panel" aria-label="Cadastro de clientes">
        <img src="assets/logo-cadastro-clientes.bmp" alt="Cadastro de clientes">
      </section>
      <section class="panel clientes-list-panel">
        <div class="toolbar">
          <h2>Clientes cadastrados</h2>
          ${canCreateCliente && !showClienteFormOnMobile ? '<button class="success-button cliente-list-new-button" type="button" id="show-cliente-form">Novo</button>' : ""}
        </div>
        <input id="cliente-search" class="list-search-input" placeholder="Buscar cliente">
        <div id="cliente-list"></div>
      </section>
      ${renderClienteForm ? `<section class="panel cliente-form-panel${showClienteFormOnMobile ? "" : " is-mobile-hidden"}">
        <h2>${clienteFormTitle}</h2>
        <form class="cliente-form-grid" id="cliente-form">
          <label>CPF/CNPJ<input name="documento" required${documentReadonlyAttr}${formDisabledAttr} value="${fieldValue(formCliente.documento)}"></label>
          <label class="cpf-only-fields${showCnpjFields ? " hidden" : ""}">Nome<input name="nome"${formDisabledAttr} value="${fieldValue(formCliente.nome)}"${showCnpjFields ? "" : " required"}></label>
          <label class="cnpj-only-fields${showCnpjFields ? "" : " hidden"}">Razão social<input name="razaoSocial" readonly${formDisabledAttr} value="${fieldValue(formCliente.razaoSocial)}"></label>
          <label class="cnpj-only-fields${showCnpjFields ? "" : " hidden"}">Nome fantasia<input name="nomeFantasia" readonly${formDisabledAttr} value="${fieldValue(formCliente.nomeFantasia)}"></label>
          <label class="cnpj-only-fields${showCnpjFields ? "" : " hidden"}">Responsável<input name="responsavelNome"${formDisabledAttr} value="${fieldValue(formCliente.responsavelNome)}"${showCnpjFields ? " required" : ""}></label>
          <label class="cnpj-only-fields${showCnpjFields ? "" : " hidden"}">Situação CNPJ<input class="${cnpjStatusClass(formCliente.situacaoCnpj)}" name="situacaoCnpj" readonly${formDisabledAttr} value="${fieldValue(formCliente.situacaoCnpj)}"></label>
          <label>Status<select name="status"${formDisabledAttr}>${options(["ATIVO", "INATIVO"], normalizeClienteStatus(formCliente.status))}</select></label>
          <label>Celular<input name="telefone"${formDisabledAttr} value="${fieldValue(formCliente.telefone)}"></label>
          <label>E-mail<input name="email" type="email"${formDisabledAttr} value="${fieldValue(formCliente.email)}"></label>
          <label>CEP<input name="cep"${formDisabledAttr} value="${fieldValue(formCliente.cep)}"></label>
          <label>Bairro<input name="bairro" readonly${formDisabledAttr} value="${fieldValue(formCliente.bairro)}"></label>
          <label>Endereço<input name="endereco" readonly${formDisabledAttr} value="${fieldValue(formCliente.endereco)}"></label>
          <label>Número<input name="numero"${formDisabledAttr} value="${fieldValue(formCliente.numero)}"></label>
          <label>Complemento<input name="complemento"${formDisabledAttr} value="${fieldValue(formCliente.complemento)}"></label>
          <label>UF<input name="uf" maxlength="2" readonly${formDisabledAttr} value="${fieldValue(formCliente.uf)}"></label>
          <label>Cidade<input name="cidade" readonly${formDisabledAttr} value="${fieldValue(formCliente.cidade)}"></label>
          <label>Observações<textarea name="obs"${formDisabledAttr}>${fieldValue(formCliente.obs)}</textarea></label>
          ${isViewingCliente ? `
            <div class="form-actions cliente-form-actions">
              ${canCreateBudgetForCliente ? '<button class="success-button" type="button" id="new-orcamento-for-selected-cliente">+ Orçamento</button>' : ""}
              ${canEditCliente ? '<button class="primary-button" type="button" id="edit-selected-cliente">Alterar</button>' : ""}
              ${clienteDeleteActionButton(formCliente, { buttonClass: "danger-button" })}
              <button class="danger-button" type="button" id="cancel-cliente-edit">Cancelar</button>
            </div>
          ` : canSaveClienteForm ? `
            <div class="form-actions cliente-form-actions">
              <button class="primary-button" type="submit">${isEditingCliente ? "Salvar alteração" : "Salvar cliente"}</button>
              ${isEditingCliente && canCreateCliente ? '<button class="success-button" type="button" id="new-cliente">Novo cliente</button>' : ""}
              <button class="danger-button" type="button" id="cancel-cliente-edit">Cancelar</button>
            </div>
          ` : '<p class="muted">Acesso somente leitura.</p>'}
        </form>
        ${activeClienteDocumento ? clienteOrcamentosResumo(activeClienteDocumento) : ""}
      </section>` : ""}
    </div>
  `;

  const clienteForm = document.getElementById("cliente-form");
  clienteForm?.addEventListener("submit", addCliente);
  if (canSaveClienteForm && !formLocked) {
    clienteForm?.querySelector('[name="documento"]')?.addEventListener("input", handleClienteDocumentoInput);
    clienteForm?.querySelector('[name="documento"]')?.addEventListener("keydown", handleClienteDocumentoKeydown);
    clienteForm?.querySelector('[name="documento"]')?.addEventListener("blur", handleClienteDocumentoBlur);
    clienteForm?.querySelector('[name="email"]')?.addEventListener("blur", focusClienteCep);
    clienteForm?.querySelector('[name="cep"]')?.addEventListener("keydown", handleClienteCepKeydown);
    clienteForm?.querySelector('[name="cep"]')?.addEventListener("blur", handleClienteCepBlur);
    clienteForm?.querySelector('[name="complemento"]')?.addEventListener("keydown", handleClienteComplementoKeydown);
    document.getElementById("new-cliente")?.addEventListener("click", newCliente);
    document.getElementById("show-cliente-form")?.addEventListener("click", newCliente);
    document.getElementById("cancel-cliente-edit")?.addEventListener("click", cancelCliente);
  } else if (isViewingCliente) {
    document.getElementById("edit-selected-cliente")?.addEventListener("click", () => editCliente(selectedClienteDocumento));
    document.getElementById("new-orcamento-for-selected-cliente")?.addEventListener("click", () => startNewOrcamentoForCliente(selectedClienteDocumento));
    document.getElementById("cancel-cliente-edit")?.addEventListener("click", cancelCliente);
  } else if (clienteForm) {
    setFormReadOnly(clienteForm);
  }
  document.getElementById("cliente-search").addEventListener("input", renderClienteList);
  blankNewCliente = false;
  renderClienteList();
}

function renderClienteList() {
  const search = document.getElementById("cliente-search")?.value.toLowerCase() || "";
  const filteredClientes = state.clientes.filter((cliente) => {
    return `${cliente.documento} ${cliente.nome} ${cliente.responsavelNome} ${cliente.cidade} ${normalizeClienteStatus(cliente.status)}`.toLowerCase().includes(search);
  });
  const clientes = applyTableSort("clientes", filteredClientes, {
    documento: (cliente) => onlyDigits(cliente.documento) || cliente.documento,
    nome: (cliente) => cliente.nome || "",
    contato: (cliente) => `${cliente.telefone || ""} ${cliente.email || ""}`,
    cidade: (cliente) => `${cliente.cidade || ""} ${cliente.uf || ""}`,
    status: (cliente) => normalizeClienteStatus(cliente.status),
    responsavel: (cliente) => cliente.responsavelNome || "",
  });

  document.getElementById("cliente-list").innerHTML = clientes.length
    ? `
      <div class="table-wrap">
        <table>
          <thead><tr>
            ${sortableTableHeader("clientes", "documento", "Documento")}
            ${sortableTableHeader("clientes", "nome", "Nome")}
            ${sortableTableHeader("clientes", "contato", "Contato")}
            ${sortableTableHeader("clientes", "cidade", "Cidade")}
            ${sortableTableHeader("clientes", "status", "Status")}
            ${sortableTableHeader("clientes", "responsavel", "Responsável")}
          </tr></thead>
          <tbody>
            ${clientes.map((cliente) => `
              <tr class="clickable-row ${cliente.documento === (editingClienteDocumento || selectedClienteDocumento) ? "is-selected" : ""}" data-open-cliente="${escapeHtml(cliente.documento)}">
                <td>${escapeHtml(cliente.documento)}</td>
                <td><strong>${escapeHtml(cliente.nome)}</strong><br><span class="muted">${escapeHtml(cliente.email)}</span></td>
                <td>${escapeHtml(cliente.telefone)}</td>
                <td>${escapeHtml(cliente.cidade)} ${escapeHtml(cliente.uf)}</td>
                <td><span class="badge ${normalizeClienteStatus(cliente.status) === "INATIVO" ? "danger" : ""}">${escapeHtml(normalizeClienteStatus(cliente.status))}</span></td>
                <td>${escapeHtml(cliente.responsavelNome || "-")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`
    : emptyState();
}

function clienteDeleteActionButton(cliente, options = {}) {
  if (!canDeleteFromModule("clientes")) return "";
  const hasBudgets = clienteHasBudgets(cliente.documento);
  const inactive = normalizeClienteStatus(cliente.status) === "INATIVO";
  if (hasBudgets && inactive) return "";
  const buttonClass = options.buttonClass || "small-button danger-text";
  return `<button class="${escapeHtml(buttonClass)}" type="button" data-delete-cliente="${escapeHtml(cliente.documento)}">${hasBudgets ? "Inativar" : "Excluir"}</button>`;
}

function clienteOrcamentosResumo(documento) {
  if (!canView("orcamentos")) return "";
  const digits = onlyDigits(documento);
  const budgets = state.orcamentos
    .filter((orcamento) => (
      orcamento.clienteDocumento === documento
        || (digits && onlyDigits(orcamento.clienteDocumento) === digits)
    ))
    .sort((a, b) => {
      const dateCompare = String(b.data || "").localeCompare(String(a.data || ""));
      if (dateCompare) return dateCompare;
      return Number(b.numero || 0) - Number(a.numero || 0);
    })
    .slice(0, 5);

  return `
    <div class="cliente-orcamentos-resumo">
      <h3>Últimos orçamentos deste cliente</h3>
      ${budgets.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Número</th><th>Data</th><th>Status</th><th>Total</th></tr></thead>
            <tbody>
              ${budgets.map((orcamento) => `
                <tr class="clickable-row" data-open-orcamento="${escapeHtml(orcamento.numero)}" title="Abrir orçamento">
                  <td><strong>${escapeHtml(orcamento.numero)}</strong></td>
                  <td>${escapeHtml(formatDate(orcamento.data))}</td>
                  <td><span class="badge ${statusClass(orcamento.status)}">${escapeHtml(normalizeOrcamentoStatus(orcamento.status))}</span></td>
                  <td>${currency.format(totalOrcamento(orcamento))}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : '<p class="muted">Nenhum orçamento cadastrado para este cliente.</p>'}
    </div>
  `;
}

async function addCliente(event) {
  event.preventDefault();
  const canSave = editingClienteDocumento ? hasPermission("clientes.edit") : hasPermission("clientes.create");
  if (!canSave || !canManageData()) {
    showNoPermissionMessage();
    return;
  }
  const form = event.currentTarget;
  const documentoDigits = onlyDigits(form.elements.documento.value);

  if (!form.reportValidity()) return;

  const data = Object.fromEntries(new FormData(form));
  data.status = normalizeClienteStatus(data.status);
  data.cidade = normalizeCidade(data.cidade);
  const isCreatingCliente = !editingClienteDocumento;
  if (!isValidCpfCnpj(data.documento)) {
    alert("Informe um CPF ou CNPJ válido.");
    return;
  }

  if (documentoDigits.length === 14) {
    if (!isCnpjAtivo(data.situacaoCnpj)) {
      showFloatingMessage(`CNPJ com situação ${data.situacaoCnpj || "não ativa"}. Cadastro não permitido.`);
      clearClienteForm(form);
      return;
    }
    data.nome = data.nomeFantasia || data.razaoSocial || data.nome;
    if (!String(data.responsavelNome || "").trim()) {
      alert("Informe o nome do responsável pelo CNPJ.");
      return;
    }
  } else {
    data.razaoSocial = "";
    data.nomeFantasia = "";
    data.situacaoCnpj = "";
    data.responsavelNome = "";
  }
  delete data.responsavelCpf;

  const duplicate = state.clientes.some((cliente) => cliente.documento === data.documento && cliente.documento !== editingClienteDocumento);
  if (duplicate) {
    alert("Já existe um cliente com este CPF/CNPJ.");
    return;
  }

  const clienteAudit = editingClienteDocumento
    ? { acao: "cliente.alterar", modulo: "clientes", entidadeTipo: "cliente", entidadeId: data.documento, detalhes: { documentoAnterior: editingClienteDocumento, nome: data.nome } }
    : { acao: "cliente.criar", modulo: "clientes", entidadeTipo: "cliente", entidadeId: data.documento, detalhes: { nome: data.nome } };

  if (editingClienteDocumento) {
    const currentCliente = state.clientes.find((cliente) => cliente.documento === editingClienteDocumento);
    if (currentCliente && normalizeClienteStatus(currentCliente.status) !== "INATIVO" && data.status === "INATIVO") {
      const authorization = await confirmClienteInactivation(currentCliente);
      if (!authorization) return;
      clienteAudit.acao = "cliente.inativar";
      clienteAudit.detalhes = {
        ...clienteAudit.detalhes,
        statusAnterior: normalizeClienteStatus(currentCliente.status),
        statusNovo: data.status,
        administradorAutorizador: authorization.approverUsuario || "",
        administradorNome: authorization.approverNome || "",
      };
    }
    state.clientes = state.clientes.map((cliente) => cliente.documento === editingClienteDocumento ? data : cliente);
    state.orcamentos = state.orcamentos.map((orcamento) => (
      orcamento.clienteDocumento === editingClienteDocumento
        ? { ...orcamento, clienteDocumento: data.documento }
        : orcamento
    ));
    editingClienteDocumento = null;
    selectedClienteDocumento = null;
  } else {
    state.clientes.push(data);
  }
  saveState(clienteAudit);
  const budgetDraft = pendingBudgetDraft;
  const shouldReturnToBudget = Boolean(budgetDraft);
  pendingBudgetDraft = null;
  clienteFormPrefill = null;
  event.currentTarget.reset();
  const successMessage = isCreatingCliente ? "Cliente cadastrado com sucesso." : "Cliente alterado com sucesso.";
  if (shouldReturnToBudget) {
    showFloatingMessage(successMessage, "success");
    startNewOrcamentoForCliente(data.documento, budgetDraft);
    return;
  }
  if (isCreatingCliente && hasPermission("orcamentos.create") && canManageData() && isClienteAtivo(data)) {
    const shouldCreateBudget = await askYesNoChoice(
      "Cliente cadastrado com sucesso",
      "Deseja cadastrar um orçamento para este cliente?",
    );
    if (shouldCreateBudget) {
      startNewOrcamentoForCliente(data.documento);
      return;
    }
  }
  showFloatingMessage(successMessage, "success");
  render();
}

function newCliente() {
  editingClienteDocumento = null;
  selectedClienteDocumento = null;
  blankNewCliente = true;
  clienteFormPrefill = null;
  pendingBudgetDraft = null;
  renderClientes();
  scrollClienteFormIntoView();
}

function cancelCliente() {
  document.activeElement?.blur();
  editingClienteDocumento = null;
  selectedClienteDocumento = null;
  blankNewCliente = false;
  clienteFormPrefill = null;
  pendingBudgetDraft = null;
  renderClientes();
  resetCompactViewScroll("#clientes-view");
}

function isCompactLayout() {
  return window.location.search.includes("android_app=1")
    || window.matchMedia("(max-width: 920px), (max-height: 500px), ((hover: none) and (pointer: coarse))").matches;
}

function resetCompactViewScroll() {
  if (!isCompactLayout()) return;
  document.body.classList.add("is-resetting-compact-scroll");
  const scrollTop = () => {
    document.querySelector(".sidebar")?.classList.remove("is-hidden-on-scroll");
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };
  window.requestAnimationFrame(() => {
    scrollTop();
    window.requestAnimationFrame(scrollTop);
    window.setTimeout(scrollTop, 60);
    window.setTimeout(scrollTop, 160);
    window.setTimeout(() => {
      scrollTop();
      document.body.classList.remove("is-resetting-compact-scroll");
    }, 320);
  });
}

function scrollCompactElementIntoView(selector) {
  if (!isCompactLayout()) return;
  const scrollToTarget = (behavior = "smooth") => {
    document.querySelector(selector)?.scrollIntoView({ behavior, block: "start" });
  };
  window.requestAnimationFrame(() => {
    scrollToTarget();
    window.setTimeout(() => scrollToTarget("auto"), 140);
    window.setTimeout(() => scrollToTarget("auto"), 380);
  });
}

function scrollClienteFormIntoView() {
  scrollCompactElementIntoView(".cliente-form-panel");
}

function focusSelectedClienteRow() {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const selectedRow = document.querySelector('.clientes-list-panel [data-open-cliente].is-selected');
    const listWrap = selectedRow?.closest(".table-wrap");
    if (!selectedRow || !listWrap) return;

    const tableHeader = listWrap.querySelector("thead");
    const headerOffset = tableHeader ? tableHeader.getBoundingClientRect().height + 2 : 0;
    const rowTopInsideWrap = selectedRow.getBoundingClientRect().top - listWrap.getBoundingClientRect().top;
    listWrap.scrollTop = Math.max(0, listWrap.scrollTop + rowTopInsideWrap - headerOffset);
    listWrap.scrollLeft = 0;

    if (isCompactLayout()) return;

    const stickyHeader = document.querySelector(".sidebar");
    const stickyOffset = stickyHeader && getComputedStyle(stickyHeader).position === "sticky"
      ? stickyHeader.getBoundingClientRect().height + 8
      : 8;
    const top = listWrap.getBoundingClientRect().top + window.scrollY - stickyOffset;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }));
}

async function handleClienteDocumentoBlur(event) {
  const input = event.currentTarget;
  const documento = input.value;
  const digits = onlyDigits(documento);
  if (!digits) return;

  if (!isValidCpfCnpj(documento)) {
    input.setCustomValidity("CPF/CNPJ inválido.");
    input.reportValidity();
    return;
  }

  input.setCustomValidity("");
  if (digits.length !== 14) {
    setCnpjFieldsVisibility(input.form, false);
    if (digits.length === 11) {
      fillClienteByCpf(input.form, digits);
    }
    return;
  }

  setCnpjFieldsVisibility(input.form, true);

  const clienteCadastrado = findClienteByDocumentDigits(digits);
  if (clienteCadastrado) {
    fillClienteForm(input.form, clienteCadastrado);
    setCnpjFieldsVisibility(input.form, true);
    showFloatingMessage("CNPJ já cadastrado. Dados carregados da base local.");
    return;
  }

  if (cnpjLookupCache.has(digits)) {
    applyCnpjLookupResult(input.form, cnpjLookupCache.get(digits));
    return;
  }

  try {
    const response = await fetch(`/api/cnpj/${digits}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Servidor de homologação desatualizado. Rode novamente o arquivo reiniciar-rede-local.bat e recarregue esta página.");
    }

    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Não foi possível consultar o CNPJ.");
    }

    cnpjLookupCache.set(digits, result);
    applyCnpjLookupResult(input.form, result);
  } catch (error) {
    alert(error.message || "Não foi possível consultar o CNPJ.");
  }
}

function applyCnpjLookupResult(form, result, options = {}) {
  const clearOnInactive = options.clearOnInactive !== false;
  form.elements.razaoSocial.value = result.razaoSocial || "";
  form.elements.nomeFantasia.value = result.nomeFantasia || "";
  form.elements.situacaoCnpj.value = result.situacaoCnpj || "";
  form.elements.situacaoCnpj.className = cnpjStatusClass(result.situacaoCnpj);
  if (!isCnpjAtivo(result.situacaoCnpj)) {
    showFloatingMessage(`CNPJ com situação ${result.situacaoCnpj || "não ativa"}. Cadastro não permitido.`);
    if (clearOnInactive) {
      clearClienteForm(form);
      return;
    }
  }
  if (isCnpjAtivo(result.situacaoCnpj) && !form.elements.nome.value) {
    form.elements.nome.value = result.nomeFantasia || result.razaoSocial || "";
  }
  form.elements.cep.value = result.cep || "";
  form.elements.bairro.value = result.bairro || "";
  form.elements.endereco.value = result.endereco || "";
  form.elements.numero.value = result.numero || "";
  form.elements.complemento.value = result.complemento || "";
  form.elements.uf.value = result.uf || "";
  form.elements.cidade.value = result.cidade || "";
}

async function handleClienteDocumentoKeydown(event) {
  if (event.key !== "Enter" && event.key !== "Tab") return;

  event.preventDefault();
  await handleClienteDocumentoBlur({ currentTarget: event.currentTarget });
  const digits = onlyDigits(event.currentTarget.value);
  if (isValidCpfCnpj(digits)) {
    const form = event.currentTarget.form;
    if (digits.length === 14) {
      form.elements.responsavelNome?.focus();
    } else {
      form.elements.nome?.focus();
    }
  }
}

function handleClienteDocumentoInput(event) {
  const form = event.currentTarget.form;
  const digits = onlyDigits(event.currentTarget.value);
  if (digits.length !== 14) {
    setCnpjFieldsVisibility(form, false);
    if (digits.length === 11 && isValidCpf(digits)) {
      fillClienteByCpf(form, digits);
    }
  } else {
    setCnpjFieldsVisibility(form, true);
  }
}

function setCnpjFieldsVisibility(form, visible) {
  form.querySelectorAll(".cnpj-only-fields").forEach((field) => {
    field.classList.toggle("hidden", !visible);
  });
  form.querySelectorAll(".cpf-only-fields").forEach((field) => {
    field.classList.toggle("hidden", visible);
  });
  form.elements.responsavelNome.required = visible;
  form.elements.nome.required = !visible;

  if (!visible) {
    form.elements.razaoSocial.value = "";
    form.elements.nomeFantasia.value = "";
    form.elements.situacaoCnpj.value = "";
    form.elements.situacaoCnpj.className = "";
    form.elements.responsavelNome.value = "";
  } else {
    form.elements.nome.value = "";
  }
}

function fillClienteByCpf(form, cpf) {
  const cliente = state.clientes.find((item) => onlyDigits(item.documento) === cpf && onlyDigits(item.documento).length === 11);
  if (!cliente) return;

  fillClienteForm(form, cliente);
}

function findClienteByDocumentDigits(digits) {
  return state.clientes.find((item) => onlyDigits(item.documento) === digits);
}

function fillClienteForm(form, cliente) {
  form.elements.documento.value = cliente.documento || "";
  form.elements.nome.value = cliente.nome || "";
  form.elements.razaoSocial.value = cliente.razaoSocial || "";
  form.elements.nomeFantasia.value = cliente.nomeFantasia || "";
  form.elements.situacaoCnpj.value = cliente.situacaoCnpj || "";
  form.elements.situacaoCnpj.className = cnpjStatusClass(cliente.situacaoCnpj);
  form.elements.status.value = normalizeClienteStatus(cliente.status);
  form.elements.responsavelNome.value = cliente.responsavelNome || "";
  form.elements.telefone.value = cliente.telefone || "";
  form.elements.email.value = cliente.email || "";
  form.elements.uf.value = cliente.uf || "";
  form.elements.cidade.value = cliente.cidade || "";
  form.elements.endereco.value = cliente.endereco || "";
  form.elements.bairro.value = cliente.bairro || "";
  form.elements.numero.value = cliente.numero || "";
  form.elements.complemento.value = cliente.complemento || "";
  form.elements.cep.value = cliente.cep || "";
  form.elements.obs.value = cliente.obs || "";
}

async function handleClienteCepBlur(event) {
  const input = event.currentTarget;
  await consultClienteCep(input, true);
}

async function handleClienteCepKeydown(event) {
  if (event.key !== "Enter" && event.key !== "Tab") return;

  event.preventDefault();
  await consultClienteCep(event.currentTarget, true);
}

async function consultClienteCep(input, focusNumero = false) {
  const cep = onlyDigits(input.value);
  if (!cep) return false;

  if (cep.length !== 8) {
    showCepError(input, "CEP inválido. Verifique se foram digitados 8 números.");
    return false;
  }

  input.setCustomValidity("");
  try {
    const response = await fetch(`/api/cep/${cep}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Servidor de homologação desatualizado. Rode novamente o arquivo reiniciar-rede-local.bat e recarregue esta página.");
    }

    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Não foi possível consultar o CEP.");
    }

    const form = input.form;
    form.elements.endereco.value = result.endereco || "";
    form.elements.bairro.value = result.bairro || "";
    form.elements.cidade.value = result.cidade || "";
    form.elements.uf.value = result.uf || "";
    if (focusNumero) {
      window.setTimeout(() => form.elements.numero?.focus(), 0);
    }
    return true;
  } catch (error) {
    showCepError(input, error.message || "CEP errado ou não encontrado. Verifique e digite novamente.");
    return false;
  }
}

function showCepError(input, message) {
  input.setCustomValidity(message);
  showFloatingMessage(message);
  input.focus();
  input.select();
}

function showFloatingMessage(message, tone = "warning") {
  let box = document.getElementById("floating-message");
  if (!box) {
    box = document.createElement("div");
    box.id = "floating-message";
    box.className = "floating-message";
    document.body.append(box);
  }

  box.textContent = message;
  box.classList.toggle("is-success", tone === "success");
  box.classList.remove("is-visible");
  void box.offsetWidth;
  box.classList.add("is-visible");
  window.clearTimeout(showFloatingMessage.timer);
  showFloatingMessage.timer = window.setTimeout(() => {
    box.classList.remove("is-visible");
  }, 4500);
}

function showStatusPrivilegeNotice() {
  if (!editingOrcamentoNumero) return;
  if (userProfile().toUpperCase() === "ADMIN" || hasPermission("orcamentos.status")) {
    showFloatingMessage("Alteração de status permitida para este usuário.", "success");
    return;
  }
  showFloatingMessage("Para alterar o status, será necessário informar as credenciais de um administrador ao salvar.");
}

function showProcessingMessage(message = "Solicitação sendo processada. Aguarde...") {
  let overlay = document.getElementById("processing-message");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "processing-message";
    overlay.className = "processing-message";
    overlay.innerHTML = `
      <div class="processing-dialog" role="status" aria-live="polite">
        <span class="processing-spinner" aria-hidden="true"></span>
        <div>
          <strong></strong>
          <small>Esta operação pode levar alguns instantes.</small>
        </div>
      </div>
    `;
    document.body.append(overlay);
  }

  overlay.querySelector("strong").textContent = message;
  overlay.classList.add("is-visible");
  return () => hideProcessingMessage();
}

function hideProcessingMessage() {
  document.getElementById("processing-message")?.classList.remove("is-visible");
}

function cnpjStatusClass(value) {
  const status = String(value || "").toUpperCase();
  return ["BAIXADA", "INATIVA", "INAPTA", "SUSPENSA"].some((item) => status.includes(item)) ? "status-alert-field" : "";
}

function isCnpjAtivo(value) {
  return String(value || "").toUpperCase().includes("ATIVA");
}

function clearClienteForm(form) {
  editingClienteDocumento = null;
  selectedClienteDocumento = null;
  blankNewCliente = true;
  form.reset();
  setCnpjFieldsVisibility(form, false);
}

function focusClienteCep(event) {
  event.currentTarget.form.elements.cep?.focus();
}

function handleClienteComplementoKeydown(event) {
  if (event.key !== "Enter" && event.key !== "Tab") return;
  event.preventDefault();
  event.currentTarget.form.elements.obs?.focus();
}

function isValidCpfCnpj(value) {
  const digits = onlyDigits(value);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

function isValidCpf(cpf) {
  if (!cpf || /^(\d)\1+$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(cpf[i]) * (10 - i);
  let check = (sum * 10) % 11;
  if (check === 10) check = 0;
  if (check !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(cpf[i]) * (11 - i);
  check = (sum * 10) % 11;
  if (check === 10) check = 0;
  return check === Number(cpf[10]);
}

function isValidCnpj(cnpj) {
  if (!cnpj || /^(\d)\1+$/.test(cnpj)) return false;

  const calc = (length) => {
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(cnpj[index]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

function editCliente(documento) {
  editingClienteDocumento = documento;
  selectedClienteDocumento = null;
  blankNewCliente = false;
  clienteFormPrefill = null;
  pendingBudgetDraft = null;
  if (document.getElementById("clientes-view")?.classList.contains("is-active")) {
    renderClientes();
  } else {
    setView("clientes");
  }
  focusSelectedClienteRow();
  scrollClienteFormIntoView();
  if (hasPermission("clientes.edit")) refreshClienteCnpjDataForEdit(documento);
}

function viewCliente(documento) {
  selectedClienteDocumento = documento;
  editingClienteDocumento = null;
  blankNewCliente = false;
  clienteFormPrefill = null;
  pendingBudgetDraft = null;
  if (document.getElementById("clientes-view")?.classList.contains("is-active")) {
    renderClientes();
  } else {
    setView("clientes");
  }
  focusSelectedClienteRow();
  scrollClienteFormIntoView();
}

async function refreshClienteCnpjDataForEdit(documento) {
  const digits = onlyDigits(documento);
  if (digits.length !== 14 || !isValidCnpj(digits)) return;

  const form = document.getElementById("cliente-form");
  if (!form) return;

  try {
    const response = await fetch(`/api/cnpj/${digits}?refresh=${Date.now()}`, { cache: "no-store" });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Servidor desatualizado para consultar CNPJ.");
    }

    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Não foi possível atualizar os dados do CNPJ.");
    }

    if (editingClienteDocumento !== documento || onlyDigits(form.elements.documento.value) !== digits) return;
    cnpjLookupCache.set(digits, result);
    applyCnpjLookupResult(form, result, { clearOnInactive: false });
    showFloatingMessage("Dados do CNPJ atualizados para alteração.", "success");
  } catch (error) {
    showFloatingMessage(error.message || "Não foi possível atualizar os dados do CNPJ.");
  }
}

function openReportCliente(documento) {
  if (!canView("clientes")) {
    showNoPermissionMessage();
    return;
  }
  viewCliente(documento);
}

function clienteHasBudgets(documento) {
  const digits = onlyDigits(documento);
  return state.orcamentos.some((orcamento) => (
    orcamento.clienteDocumento === documento
      || (digits && onlyDigits(orcamento.clienteDocumento) === digits)
  ));
}

async function deleteCliente(documento) {
  if (!canDeleteFromModule("clientes") || !canManageData()) {
    showNoPermissionMessage();
    return;
  }
  if (isCompactLayout()) {
    selectedClienteDocumento = documento;
    editingClienteDocumento = null;
    blankNewCliente = false;
    renderClientes();
    scrollClienteFormIntoView();
  }
  const hasBudgets = clienteHasBudgets(documento);
  if (hasBudgets) {
    const cliente = state.clientes.find((item) => item.documento === documento);
    if (!cliente) return;
    if (normalizeClienteStatus(cliente.status) === "INATIVO") {
      alert("Este cliente já está inativo.");
      return;
    }
    const confirmed = await askConfirmChoice(
      "Inativar cliente",
      "Este cliente possui orçamentos cadastrados e será marcado como INATIVO. Confirmar?",
      "Inativar",
    );
    if (!confirmed) return;
    const authorization = await confirmClienteInactivation(cliente);
    if (!authorization) return;
    state.clientes = state.clientes.map((item) => (
      item.documento === documento ? { ...item, status: "INATIVO" } : item
    ));
    if (editingClienteDocumento === documento) editingClienteDocumento = null;
    if (selectedClienteDocumento === documento) selectedClienteDocumento = null;
    await saveState({
      acao: "cliente.inativar",
      modulo: "clientes",
      entidadeTipo: "cliente",
      entidadeId: documento,
      detalhes: {
        statusAnterior: normalizeClienteStatus(cliente.status),
        statusNovo: "INATIVO",
        administradorAutorizador: authorization.approverUsuario || "",
        administradorNome: authorization.approverNome || "",
      },
    });
    render();
    window.setTimeout(() => showFloatingMessage("Cliente inativado.", "success"), 0);
    return;
  }
  const confirmed = await askConfirmChoice("Excluir cliente", "Excluir este cliente definitivamente?", "Excluir");
  if (!confirmed) return;
  const cliente = state.clientes.find((item) => item.documento === documento);
  const authorization = await confirmClienteDeletion(cliente || { documento });
  if (!authorization) return;
  state.clientes = state.clientes.filter((cliente) => cliente.documento !== documento);
  if (editingClienteDocumento === documento) editingClienteDocumento = null;
  if (selectedClienteDocumento === documento) selectedClienteDocumento = null;
  await saveState({
    acao: "cliente.excluir",
    modulo: "clientes",
    entidadeTipo: "cliente",
    entidadeId: documento,
    detalhes: {
      administradorAutorizador: authorization.approverUsuario || "",
      administradorNome: authorization.approverNome || "",
    },
  });
  render();
  window.setTimeout(() => showFloatingMessage("Cliente excluído.", "success"), 0);
}

function renderServicos() {
  const editingServico = state.servicos.find((servico) => servico.codigo === editingServicoCodigo) || {};
  const useBlankForm = blankNewServico && !editingServicoCodigo;
  const showServicoFormOnMobile = Boolean(editingServicoCodigo || blankNewServico);
  const renderServicoForm = !isCompactLayout() || showServicoFormOnMobile;
  const codigoValue = editingServicoCodigo ? editingServico.codigo : nextServiceCode();
  const frequenciaValue = editingServicoCodigo ? editingServico.frequencia : (useBlankForm ? "" : "UNITARIO");
  const statusValue = editingServicoCodigo ? editingServico.status : (useBlankForm ? "" : "ATIVO");
  const editable = canEditModule("servicos");
  const canCreateServico = hasPermission("servicos.create") && canManageData();
  const canEditServico = hasPermission("servicos.edit") && canManageData();
  const canSaveServicoForm = editingServicoCodigo ? canEditServico : canCreateServico;
  document.getElementById("servicos-view").innerHTML = `
    ${pageBanner()}
    <div class="servicos-layout">
      <section class="client-logo-panel servico-logo-panel" aria-label="Cadastro de serviços">
        <img src="assets/logo-servicos.bmp" alt="Cadastro de serviços">
      </section>
      <section class="panel servicos-list-panel">
        <div class="toolbar">
          <h2>Serviços cadastrados</h2>
          ${canCreateServico && !showServicoFormOnMobile ? '<button class="success-button servico-list-new-button" type="button" id="show-servico-form">Novo</button>' : ""}
        </div>
        <input id="servico-search" class="list-search-input" placeholder="Buscar serviço">
        <div id="servico-list"></div>
      </section>
      ${renderServicoForm ? `<section class="panel servico-form-panel${showServicoFormOnMobile ? "" : " is-mobile-hidden"}">
        <h2>${editingServicoCodigo ? "Alterar serviço" : "Novo serviço"}</h2>
        <form class="servico-form-grid" id="servico-form">
          <label>Código<input name="codigo" readonly required value="${fieldValue(codigoValue)}"></label>
          <label>Serviço<input name="nome" required value="${fieldValue(editingServico.nome)}"></label>
          <label>Tipo<select name="tipo"><option value=""${selectedAttr(editingServico.tipo, "")}>Selecione</option>${serviceTypeOptions(editingServico.tipo)}</select></label>
          <label>Frequência<select name="frequencia"><option value=""${selectedAttr(frequenciaValue, "")}>Selecione</option>${options(["ANUAL", "MENSAL", "UNITARIO", "PERIODICO"], frequenciaValue)}</select></label>
          <label>Status<select name="status"><option value=""${selectedAttr(statusValue, "")}>Selecione</option>${options(["ATIVO", "INATIVO"], statusValue)}</select></label>
          <label>Valor<input name="valor" type="number" step="0.01" required value="${fieldValue(editingServico.valor)}"></label>
          <label>Observações<textarea name="observacoes">${fieldValue(editingServico.observacoes)}</textarea></label>
          ${canSaveServicoForm ? `
            <div class="form-actions budget-form-actions">
              <button class="primary-button" type="submit">${editingServicoCodigo ? "Salvar alteração" : "Salvar serviço"}</button>
              ${editingServicoCodigo && canCreateServico ? '<button class="success-button" type="button" id="new-servico">Novo serviço</button>' : ""}
              <button class="danger-button" type="button" id="cancel-servico-edit">Cancelar</button>
            </div>
          ` : '<p class="muted">Acesso somente leitura.</p>'}
        </form>
      </section>` : ""}
    </div>
  `;

  const servicoForm = document.getElementById("servico-form");
  servicoForm?.addEventListener("submit", addServico);
  if (canSaveServicoForm) {
    document.getElementById("new-servico")?.addEventListener("click", newServico);
    document.getElementById("show-servico-form")?.addEventListener("click", newServico);
    document.getElementById("cancel-servico-edit")?.addEventListener("click", cancelServico);
  } else if (servicoForm) {
    setFormReadOnly(servicoForm);
  }
  document.getElementById("servico-search").addEventListener("input", renderServicoList);
  blankNewServico = false;
  renderServicoList();
}

function nextServiceCode() {
  const max = state.servicos.reduce((value, item) => Math.max(value, Number(item.codigo || 0)), 10000);
  return max + 1;
}

function serviceTypeOptions(selected = "") {
  const values = [...new Set([
    ...state.servicos.map((servico) => servico.tipo),
    ...(seed.ajustes || []).map((item) => item.TIPO),
  ].filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));

  if (selected && !values.includes(selected)) values.unshift(selected);
  return options(values, selected);
}

function renderServicoList() {
  const search = document.getElementById("servico-search")?.value.toLowerCase() || "";
  const filteredServicos = state.servicos.filter((servico) => {
    return `${servico.codigo} ${servico.nome} ${servico.tipo}`.toLowerCase().includes(search);
  });
  const servicos = applyTableSort("servicos", filteredServicos, {
    codigo: (servico) => Number(servico.codigo || 0),
    nome: (servico) => servico.nome || "",
    tipo: (servico) => servico.tipo || "",
    status: (servico) => normalizeServicoStatus(servico.status),
    valor: (servico) => Number(servico.valor || 0),
  });

  document.getElementById("servico-list").innerHTML = servicos.length
    ? `
      <div class="table-wrap">
        <table>
          <thead><tr>
            ${sortableTableHeader("servicos", "codigo", "Código")}
            ${sortableTableHeader("servicos", "nome", "Serviço")}
            ${sortableTableHeader("servicos", "tipo", "Tipo")}
            ${sortableTableHeader("servicos", "status", "Status")}
            ${sortableTableHeader("servicos", "valor", "Valor")}
            <th>Ações</th>
          </tr></thead>
          <tbody>
            ${servicos.map((servico) => `
              <tr class="clickable-row" data-open-servico="${escapeHtml(servico.codigo)}">
                <td>${escapeHtml(servico.codigo)}</td>
                <td><strong>${escapeHtml(servico.nome)}</strong><br><span class="muted">${escapeHtml(servico.frequencia)}</span></td>
                <td>${escapeHtml(servico.tipo)}</td>
                <td><span class="badge ${normalizeServicoStatus(servico.status) === "INATIVO" ? "danger" : ""}">${escapeHtml(normalizeServicoStatus(servico.status))}</span></td>
                <td>${currency.format(Number(servico.valor || 0))}</td>
                <td>${hasPermission("servicos.edit") || canDeleteFromModule("servicos") ? `
                  <div class="row-actions">
                    ${hasPermission("servicos.edit") ? `<button class="small-button" data-edit-servico="${escapeHtml(servico.codigo)}">Alterar</button>` : ""}
                    ${canDeleteFromModule("servicos") ? `<button class="small-button danger-text" data-delete-servico="${escapeHtml(servico.codigo)}">Excluir</button>` : ""}
                  </div>
                ` : ""}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`
    : emptyState();
}

function addServico(event) {
  event.preventDefault();
  const canSave = editingServicoCodigo ? hasPermission("servicos.edit") : hasPermission("servicos.create");
  if (!canSave || !canManageData()) {
    showNoPermissionMessage();
    return;
  }
  const data = Object.fromEntries(new FormData(event.currentTarget));
  data.valor = Number(data.valor || 0);
  data.frequencia = data.frequencia || "UNITARIO";
  data.status = data.status || "ATIVO";
  const isCreatingServico = !editingServicoCodigo;
  const duplicate = state.servicos.some((servico) => servico.codigo === data.codigo && servico.codigo !== editingServicoCodigo);
  if (duplicate) {
    alert("Já existe um serviço com este código.");
    return;
  }

  const servicoAudit = editingServicoCodigo
    ? { acao: "servico.alterar", modulo: "servicos", entidadeTipo: "servico", entidadeId: data.codigo, detalhes: { codigoAnterior: editingServicoCodigo, nome: data.nome } }
    : { acao: "servico.criar", modulo: "servicos", entidadeTipo: "servico", entidadeId: data.codigo, detalhes: { nome: data.nome } };

  if (editingServicoCodigo) {
    state.servicos = state.servicos.map((servico) => servico.codigo === editingServicoCodigo ? data : servico);
    state.orcamentos = state.orcamentos.map((orcamento) => ({
      ...orcamento,
      itens: orcamento.itens.map((item) => item.servicoCodigo === editingServicoCodigo ? { ...item, servicoCodigo: data.codigo } : item),
    }));
    editingServicoCodigo = null;
  } else {
    state.servicos.push(data);
  }
  saveState(servicoAudit);
  event.currentTarget.reset();
  if (isCreatingServico && returnToBudgetAfterServicoCreated(data)) return;
  render();
}

function newServico() {
  editingServicoCodigo = null;
  blankNewServico = true;
  renderServicos();
  scrollServicoFormIntoView();
  focusServicoNome();
}

function cancelServico() {
  document.activeElement?.blur();
  editingServicoCodigo = null;
  blankNewServico = !isCompactLayout();
  pendingBudgetServiceReturn = null;
  renderServicos();
  resetCompactViewScroll("#servicos-view");
}

function editServico(codigo) {
  editingServicoCodigo = codigo;
  blankNewServico = false;
  if (document.getElementById("servicos-view")?.classList.contains("is-active")) {
    renderServicos();
  } else {
    setView("servicos");
  }
  scrollServicoFormIntoView();
}

function scrollServicoFormIntoView() {
  scrollCompactElementIntoView(".servico-form-panel");
}

function focusServicoNome() {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    document.querySelector('#servico-form [name="nome"]')?.focus();
  }));
}

function deleteServico(codigo) {
  if (!canDeleteFromModule("servicos") || !canManageData()) {
    showNoPermissionMessage();
    return;
  }
  if (isCompactLayout()) {
    editingServicoCodigo = codigo;
    blankNewServico = false;
    renderServicos();
    scrollServicoFormIntoView();
  }
  const hasBudgets = state.orcamentos.some((orcamento) => orcamento.itens.some((item) => item.servicoCodigo === codigo));
  if (hasBudgets) {
    alert("Não é possível excluir este serviço porque ele está em um orçamento.");
    return;
  }
  if (!confirm("Excluir este serviço?")) return;
  state.servicos = state.servicos.filter((servico) => servico.codigo !== codigo);
  if (editingServicoCodigo === codigo) editingServicoCodigo = null;
  saveState({ acao: "servico.excluir", modulo: "servicos", entidadeTipo: "servico", entidadeId: codigo });
  render();
}

function renderOrcamentos() {
  const editingOrcamento = state.orcamentos.find((orcamento) => Number(orcamento.numero) === Number(editingOrcamentoNumero)) || {};
  const draftOrcamento = !editingOrcamentoNumero ? pendingOrcamentoFormDraft : null;
  const draftItemsForForm = draftOrcamento?.itens?.length
    ? draftOrcamento.itens.map(normalizeBudgetItemForDraft)
    : [];
  const visibleDraftItem = draftItemsForForm[draftItemsForForm.length - 1] || null;
  if (editingOrcamentoNumero) {
    draftBudgetItems = [];
  } else if (draftItemsForForm.length) {
    draftBudgetItems = draftItemsForForm.slice(0, -1);
  }
  const approvedLocked = editingOrcamentoNumero && isOrcamentoAprovado(editingOrcamento);
  const useBlankForm = blankNewOrcamento && !editingOrcamentoNumero;
  const showOrcamentoFormOnMobile = Boolean(editingOrcamentoNumero || blankNewOrcamento);
  const clienteDocumentoValue = editingOrcamentoNumero ? editingOrcamento.clienteDocumento : (draftOrcamento?.clienteDocumento || "");
  const numeroValue = editingOrcamentoNumero ? editingOrcamento.numero : (draftOrcamento?.numero || nextBudgetNumber());
  const dataValue = editingOrcamentoNumero ? editingOrcamento.data : (draftOrcamento?.data || (useBlankForm ? "" : new Date().toISOString().slice(0, 10)));
  const statusValue = editingOrcamentoNumero ? normalizeOrcamentoStatus(editingOrcamento.status) : normalizeOrcamentoStatus(draftOrcamento?.status || "EM ANÁLISE");
  const observacoesValue = editingOrcamentoNumero ? editingOrcamento.observacoes : (draftOrcamento?.observacoes || "");
  const editable = canEditModule("orcamentos");
  document.getElementById("orcamentos-view").innerHTML = `
    ${pageBanner()}
    <div class="orcamentos-layout">
      <section class="client-logo-panel orcamento-logo-panel" aria-label="Cadastro de orçamentos">
        <img src="assets/logo-cadastro-orcamentos.bmp" alt="Cadastro de orçamentos">
      </section>
      <section class="panel orcamentos-list-panel">
        <div class="toolbar">
          <h2>Orçamentos</h2>
          ${editable && !showOrcamentoFormOnMobile ? '<button class="success-button orcamento-list-new-button" type="button" id="show-orcamento-form">Novo</button>' : ""}
        </div>
        <input id="orcamento-search" class="list-search-input" placeholder="Buscar orçamento"${editingOrcamentoNumero ? " hidden" : ""}>
        <div id="orcamento-list"></div>
      </section>
      <section class="panel orcamento-form-panel${showOrcamentoFormOnMobile ? "" : " is-mobile-hidden"}">
        <h2>${editingOrcamentoNumero ? "Alterar orçamento" : "Novo orçamento"}</h2>
        <form class="orcamento-form-grid${approvedLocked ? " approved-budget-locked" : ""}" id="orcamento-form">
          <label>Número<input name="numero" type="number" min="15000" step="1" readonly required value="${fieldValue(numeroValue)}"></label>
          <button class="ghost-button" type="button" id="show-budget-client-search"${clienteDocumentoValue || !editable ? " hidden" : ""}>Buscar cliente</button>
          <div class="budget-client-search hidden" id="budget-client-search">
            <label>Digite CPF/CNPJ ou nome<input id="orcamento-cliente-search" placeholder="Digite nome, CPF ou CNPJ"></label>
            <div id="budget-client-results"></div>
          </div>
          <div class="budget-client-line">
            <label>Cliente<input id="orcamento-cliente-display" readonly${approvedLocked ? " disabled" : ""} value="${fieldValue(clienteDocumentoValue ? clienteNome(clienteDocumentoValue) : "")}"></label>
            ${editable && !editingOrcamentoNumero ? '<button class="success-button budget-client-add-button" type="button" id="create-client-from-budget" title="Cadastrar cliente">+</button>' : ""}
          </div>
          <input type="hidden" name="clienteDocumento" value="${fieldValue(clienteDocumentoValue)}" required>
          <label>Data<input name="data" type="date" required${approvedLocked ? " disabled" : ""} value="${fieldValue(dataValue)}"></label>
          <label>Status<select name="status"><option value=""${selectedAttr(statusValue, "")}>Selecione</option>${options(["EM ANÁLISE", "APROVADO", "REPROVADO"], statusValue)}</select></label>
          <div class="budget-items" id="budget-items"></div>
          <label>Observações<textarea name="observacoes"${approvedLocked ? " disabled" : ""}>${fieldValue(observacoesValue)}</textarea></label>
          <div class="total-box"><span>Total</span><strong id="budget-total">R$ 0,00</strong></div>
          ${editable ? `
            <div class="form-actions budget-form-actions">
              <button class="primary-button" type="submit" id="save-orcamento">${editingOrcamentoNumero && !addingBudgetItem ? "Salvar alteração" : "Salvar orçamento"}</button>
              ${editingOrcamentoNumero ? '<button class="success-button" type="button" id="new-orcamento">Novo orçamento</button>' : ""}
              <button class="success-button" type="button" id="add-budget-item"${approvedLocked ? " disabled" : ""}>Inserir serviço</button>
              ${editingOrcamentoNumero ? '<button class="danger-button" type="button" id="delete-budget-item" disabled>Deletar serviço</button>' : ""}
              ${editingOrcamentoNumero ? `<button class="danger-button" type="button" id="delete-current-orcamento"${approvedLocked ? " disabled" : ""}>Deletar</button>` : ""}
              <button class="danger-button" type="button" id="cancel-orcamento-edit">Cancelar</button>
            </div>
          ` : '<p class="muted">Acesso somente leitura.</p>'}
        </form>
      </section>
    </div>
  `;

  document.getElementById("orcamento-form").addEventListener("submit", addOrcamento);
  document.querySelector('#orcamento-form [name="status"]')?.addEventListener("focus", showStatusPrivilegeNotice);
  document.querySelector('#orcamento-form [name="status"]')?.addEventListener("click", showStatusPrivilegeNotice);
  if (editable) {
    document.getElementById("new-orcamento")?.addEventListener("click", newOrcamento);
    document.getElementById("show-orcamento-form")?.addEventListener("click", newOrcamento);
    document.getElementById("cancel-orcamento-edit").addEventListener("click", cancelOrcamento);
    document.getElementById("add-budget-item").addEventListener("click", addBlankBudgetItem);
    document.getElementById("delete-budget-item")?.addEventListener("click", deleteSelectedBudgetItem);
    document.getElementById("delete-current-orcamento")?.addEventListener("click", () => deleteOrcamento(editingOrcamentoNumero));
    document.getElementById("create-client-from-budget")?.addEventListener("click", createClienteFromBudget);
    document.getElementById("show-budget-client-search").addEventListener("click", showBudgetClientSearch);
    document.getElementById("orcamento-cliente-search").addEventListener("input", filterBudgetClientOptions);
  }
  document.getElementById("orcamento-search").addEventListener("input", renderOrcamentoList);
  if (visibleDraftItem) {
    addBudgetItemRow(visibleDraftItem, !visibleDraftItem.servicoCodigo);
  } else if (useBlankForm) {
    addBudgetItemRow({}, true);
  } else if (!editingOrcamentoNumero) {
    addBudgetItemRow();
  } else {
    updateBudgetTotal();
  }
  updateBudgetItemDeleteButton();
  if (approvedLocked) lockApprovedBudgetForm();
  if (!editable) setFormReadOnly(document.getElementById("orcamento-form"));
  pendingOrcamentoFormDraft = null;
  blankNewOrcamento = false;
  renderOrcamentoList();
}

function isEditingApprovedBudget() {
  const orcamento = state.orcamentos.find((item) => Number(item.numero) === Number(editingOrcamentoNumero));
  return Boolean(orcamento && isOrcamentoAprovado(orcamento));
}

function lockApprovedBudgetForm() {
  const form = document.getElementById("orcamento-form");
  if (!form) return;
  form.querySelectorAll("input, select, textarea").forEach((field) => {
    if (field.name === "status" || field.type === "hidden") return;
    if (field.tagName === "SELECT") {
      field.disabled = true;
    } else {
      field.readOnly = true;
    }
  });
  document.getElementById("show-budget-client-search")?.setAttribute("hidden", "");
  document.getElementById("add-budget-item")?.setAttribute("disabled", "");
  document.getElementById("delete-budget-item")?.setAttribute("disabled", "");
  document.getElementById("delete-current-orcamento")?.setAttribute("disabled", "");
}

function clientOptions(selected = "", includePlaceholder = false) {
  const placeholder = includePlaceholder ? '<option value="">Selecione um cliente</option>' : "";
  return placeholder + state.clientes
    .map((cliente) => `<option value="${escapeHtml(cliente.documento)}"${selectedAttr(selected, cliente.documento)}>${escapeHtml(cliente.nome)} - ${escapeHtml(cliente.documento)}</option>`)
    .join("");
}

function filterBudgetClientOptions(event) {
  const rawSearch = event.currentTarget.value;
  const search = normalizeSearch(rawSearch);
  const digits = onlyDigits(rawSearch);
  const target = document.getElementById("budget-client-results");
  if (!search) {
    target.innerHTML = "";
    return;
  }

  let clientes = [];
  if (digits.length === 11) {
    clientes = state.clientes.filter((cliente) => isClienteAtivo(cliente) && onlyDigits(cliente.documento) === digits);
  } else {
    clientes = state.clientes.filter((cliente) => {
      if (!isClienteAtivo(cliente)) return false;
      const text = normalizeSearch(`${cliente.nome} ${cliente.razaoSocial} ${cliente.nomeFantasia} ${cliente.documento} ${onlyDigits(cliente.documento)} ${cliente.responsavelNome}`);
      return text.includes(search);
    });
  }

  clientes = clientes.slice(0, 8);

  target.innerHTML = clientes.length
    ? clientes.map((cliente) => `
      <button class="client-result-button" type="button" data-budget-client="${escapeHtml(cliente.documento)}">
        <strong>${escapeHtml(cliente.nome)}</strong>
        <span>${escapeHtml(cliente.documento)}</span>
      </button>
    `).join("")
    : '<p class="muted">Nenhum cliente encontrado.</p>';
}

function showBudgetClientSearch() {
  const box = document.getElementById("budget-client-search");
  box.classList.remove("hidden");
  const input = document.getElementById("orcamento-cliente-search");
  input.value = "";
  document.getElementById("budget-client-results").innerHTML = "";
  input.focus();
}

function selectBudgetClient(documento) {
  if (isEditingApprovedBudget()) {
    return;
  }
  if (!canEditModule("orcamentos") || !canManageData()) {
    showNoPermissionMessage();
    return;
  }
  const cliente = state.clientes.find((item) => item.documento === documento);
  if (!cliente) return;
  if (!isClienteAtivo(cliente)) {
    alert("Cliente inativo não pode ser usado em novo orçamento.");
    return;
  }

  const form = document.getElementById("orcamento-form");
  form.elements.clienteDocumento.value = cliente.documento;
  document.getElementById("orcamento-cliente-display").value = cliente.nome || cliente.razaoSocial || cliente.documento;
  document.getElementById("budget-client-search").classList.add("hidden");
  document.getElementById("show-budget-client-search").hidden = true;
}

function currentBudgetDraftFromForm() {
  const form = document.getElementById("orcamento-form");
  if (!form) return null;
  const items = collectBudgetItems()
    .map(({ originalServicoCodigo, itemIndex, ...item }) => item)
    .filter((item) => item.servicoCodigo || item.quantidade || item.valorUnitario || item.desconto);
  return {
    numero: form.elements.numero?.value || nextBudgetNumber(),
    data: form.elements.data?.value || "",
    status: form.elements.status?.value || "EM ANÁLISE",
    clienteDocumento: form.elements.clienteDocumento?.value || "",
    observacoes: form.elements.observacoes?.value || "",
    itens: items,
  };
}

function createClienteFromBudget() {
  if (isEditingApprovedBudget()) return;
  if (!hasPermission("clientes.create") || !canManageData()) {
    showNoPermissionMessage();
    return;
  }
  pendingBudgetDraft = currentBudgetDraftFromForm();
  clienteFormPrefill = { status: "ATIVO" };
  editingClienteDocumento = null;
  selectedClienteDocumento = null;
  blankNewCliente = true;
  setView("clientes");
  scrollClienteFormIntoView();
}

function createServicoFromBudget() {
  if (isEditingApprovedBudget()) return;
  const canSaveBudget = editingOrcamentoNumero ? hasPermission("orcamentos.edit") : hasPermission("orcamentos.create");
  if (!canSaveBudget || !hasPermission("servicos.create") || !canManageData() || !canView("servicos")) {
    showNoPermissionMessage();
    return;
  }

  pendingBudgetServiceReturn = {
    editingNumero: editingOrcamentoNumero ? Number(editingOrcamentoNumero) : null,
    draft: currentBudgetDraftFromForm(),
    currentItem: visibleBudgetItems()[0] || null,
    addingBudgetItem,
  };
  editingServicoCodigo = null;
  blankNewServico = true;
  setView("servicos");
  scrollServicoFormIntoView();
  focusServicoNome();
}

function returnToBudgetAfterServicoCreated(servico) {
  const context = pendingBudgetServiceReturn;
  pendingBudgetServiceReturn = null;
  if (!context) return false;

  const currentItem = normalizeBudgetItemForDraft(context.currentItem || {});
  const serviceItem = {
    ...currentItem,
    servicoCodigo: servico.codigo,
    quantidade: Number(currentItem.quantidade || 0) > 0 ? Number(currentItem.quantidade) : 1,
    valorUnitario: Number(servico.valor || currentItem.valorUnitario || 0),
    desconto: Number(currentItem.desconto || 0),
  };

  if (context.editingNumero) {
    editingOrcamentoNumero = Number(context.editingNumero);
    blankNewOrcamento = false;
    addingBudgetItem = true;
    draftBudgetItems = [];
    setView("orcamentos");
    addBudgetItemRow({
      ...serviceItem,
      originalServicoCodigo: context.currentItem?.originalServicoCodigo || "",
      itemIndex: context.currentItem?.itemIndex || "",
    });
    updateBudgetSaveButton();
    updateBudgetItemDeleteButton();
    scrollOrcamentoFormIntoView();
  } else {
    const draft = context.draft || {};
    const items = Array.isArray(draft.itens) ? draft.itens.map(normalizeBudgetItemForDraft) : [];
    if (items.length) {
      items[items.length - 1] = { ...items[items.length - 1], ...serviceItem };
    } else {
      items.push(serviceItem);
    }
    pendingOrcamentoFormDraft = { ...draft, itens: items };
    editingOrcamentoNumero = null;
    blankNewOrcamento = true;
    addingBudgetItem = false;
    draftBudgetItems = [];
    setView("orcamentos");
    scrollOrcamentoFormIntoView();
  }

  showFloatingMessage("Serviço cadastrado e inserido no orçamento.", "success");
  return true;
}

function startNewOrcamentoForCliente(documento, draft = null) {
  const cliente = state.clientes.find((item) => item.documento === documento);
  if (!cliente || !isClienteAtivo(cliente)) {
    alert("Cliente inativo não pode ser usado em novo orçamento.");
    render();
    return;
  }
  editingOrcamentoNumero = null;
  blankNewOrcamento = true;
  addingBudgetItem = false;
  draftBudgetItems = [];
  pendingOrcamentoFormDraft = {
    ...(draft || {}),
    clienteDocumento: cliente.documento,
  };
  setView("orcamentos");
  scrollOrcamentoFormIntoView();
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function serviceOptions(selected = "", includePlaceholder = false) {
  const services = state.servicos.filter((servico) => isServicoAtivo(servico) || servico.codigo === String(selected));

  if (!services.length) {
    return '<option value="">Nenhum serviço ativo disponível</option>';
  }

  const placeholder = includePlaceholder ? '<option value="">Selecione um serviço</option>' : "";
  return placeholder + services
    .map((servico) => {
      return `<option value="${escapeHtml(servico.codigo)}"${selectedAttr(selected, servico.codigo)}>${escapeHtml(servico.codigo)} - ${escapeHtml(servico.nome)}</option>`;
    })
    .join("");
}

function addBudgetItemRow(item = {}, keepBlank = false) {
  const container = document.getElementById("budget-items");
  container.innerHTML = "";
  const row = document.createElement("div");
  row.className = "budget-item";
  row.dataset.originalServicoCodigo = item.servicoCodigo || "";
  row.dataset.itemIndex = item.itemIndex ?? "";
  const canCreateServiceFromBudget = hasPermission("servicos.create")
    && canManageData()
    && canView("servicos")
    && (editingOrcamentoNumero ? hasPermission("orcamentos.edit") : hasPermission("orcamentos.create"))
    && !isEditingApprovedBudget();
  row.innerHTML = `
    <div class="budget-service-line">
      <label>Serviço<select name="servicoCodigo" required>${serviceOptions(item.servicoCodigo, keepBlank)}</select></label>
      ${canCreateServiceFromBudget ? '<button class="success-button budget-service-add-button" type="button" data-create-service-from-budget title="Cadastrar serviço">+</button>' : ""}
    </div>
    <label>Qtd<input name="quantidade" type="number" min="1" step="1" value="${keepBlank ? "" : (item.quantidade || 1)}"></label>
    <label>Valor<input name="valorUnitario" type="number" min="0" step="0.01" value="${keepBlank ? "" : (item.valorUnitario || firstServiceValue())}"></label>
    <label>Desconto<input name="desconto" type="number" min="0" step="0.01" value="${keepBlank ? "" : (item.desconto || 0)}"></label>
  `;
  const activeDefault = state.servicos.find(isServicoAtivo)?.codigo || "";
  row.querySelector("select").value = keepBlank ? "" : (item.servicoCodigo || activeDefault);
  row.querySelector("select").addEventListener("change", (event) => {
    const service = servicoByCodigo(event.target.value);
    row.querySelector('[name="valorUnitario"]').value = service?.valor || 0;
    updateBudgetTotal();
  });
  row.querySelectorAll("input").forEach((input) => input.addEventListener("input", updateBudgetTotal));
  row.querySelector("[data-create-service-from-budget]")?.addEventListener("click", createServicoFromBudget);
  container.append(row);
  updateBudgetTotal();
}

function addBlankBudgetItem() {
  if (isEditingApprovedBudget()) {
    return;
  }
  if (!canEditModule("orcamentos") || !canManageData()) {
    showNoPermissionMessage();
    return;
  }
  if (!editingOrcamentoNumero && !saveCurrentNewBudgetItemForNext()) {
    return;
  }
  addingBudgetItem = true;
  addBudgetItemRow({}, true);
  updateBudgetSaveButton();
  updateBudgetItemDeleteButton();
}

function updateBudgetSaveButton() {
  const button = document.getElementById("save-orcamento");
  if (!button) return;
  button.textContent = editingOrcamentoNumero && !addingBudgetItem ? "Salvar alteração" : "Salvar orçamento";
}

function updateBudgetItemDeleteButton() {
  const button = document.getElementById("delete-budget-item");
  if (!button) return;
  const selectedItem = document.querySelector(".budget-item");
  const hasSelectedExistingItem = selectedItem && String(selectedItem.dataset.itemIndex || "") !== "";
  button.disabled = !hasSelectedExistingItem;
}

function normalizeBudgetItemForDraft(item = {}) {
  return {
    servicoCodigo: String(item.servicoCodigo || "").trim(),
    quantidade: Number(item.quantidade || 0),
    valorUnitario: Number(item.valorUnitario || 0),
    desconto: Number(item.desconto || 0),
  };
}

function budgetItemFromRow(row) {
  return {
    servicoCodigo: row.querySelector('[name="servicoCodigo"]').value,
    originalServicoCodigo: row.dataset.originalServicoCodigo || "",
    itemIndex: row.dataset.itemIndex || "",
    quantidade: Number(row.querySelector('[name="quantidade"]').value || 0),
    valorUnitario: Number(row.querySelector('[name="valorUnitario"]').value || 0),
    desconto: Number(row.querySelector('[name="desconto"]').value || 0),
  };
}

function isBlankBudgetItem(item) {
  return !String(item.servicoCodigo || "").trim()
    && !Number(item.quantidade || 0)
    && !Number(item.valorUnitario || 0)
    && !Number(item.desconto || 0);
}

function visibleBudgetItems() {
  return [...document.querySelectorAll(".budget-item")].map(budgetItemFromRow);
}

function saveCurrentNewBudgetItemForNext() {
  const currentItem = visibleBudgetItems()[0];
  if (!currentItem || isBlankBudgetItem(currentItem)) {
    if (draftBudgetItems.length) return true;
    alert("Informe o serviço antes de inserir outro.");
    return false;
  }

  if (!currentItem.servicoCodigo) {
    alert("Informe o serviço antes de inserir outro.");
    return false;
  }

  if (Number(currentItem.quantidade || 0) <= 0) {
    alert("Informe uma quantidade válida para o serviço.");
    return false;
  }

  const service = servicoByCodigo(currentItem.servicoCodigo);
  if (!isServicoAtivo(service)) {
    alert("Serviços inativos não podem ser inseridos em novos itens de orçamento.");
    return false;
  }

  const nextItems = [...draftBudgetItems, normalizeBudgetItemForDraft(currentItem)];
  const duplicatedServiceCode = duplicatedBudgetServiceCode(nextItems);
  if (duplicatedServiceCode) {
    alert(`O serviço ${duplicatedServiceCode} já foi informado neste orçamento. Não é permitido duplicar serviço no mesmo orçamento.`);
    return false;
  }

  draftBudgetItems = nextItems;
  showFloatingMessage("Serviço incluído no orçamento. Informe o próximo serviço.", "success");
  return true;
}

function mergeBudgetItems(currentItems, formItems) {
  if (!editingOrcamentoNumero || !formItems.length) return formItems;

  const merged = currentItems.map((item) => ({ ...item }));
  formItems.forEach(({ originalServicoCodigo, itemIndex, ...item }) => {
    const hasItemIndex = String(itemIndex) !== "";
    const index = Number(itemIndex);
    if (hasItemIndex && Number.isInteger(index) && index >= 0 && index < merged.length) {
      merged[index] = item;
    } else {
      merged.push(item);
    }
  });
  return merged;
}

function firstServiceValue() {
  return state.servicos.find(isServicoAtivo)?.valor || 0;
}

function collectBudgetItems() {
  const formItems = visibleBudgetItems().filter((item) => !isBlankBudgetItem(item));
  if (!editingOrcamentoNumero) {
    return [
      ...draftBudgetItems.map(normalizeBudgetItemForDraft),
      ...formItems,
    ];
  }
  if (formItems.length || !editingOrcamentoNumero) return formItems;

  const editingOrcamento = state.orcamentos.find((orcamento) => Number(orcamento.numero) === Number(editingOrcamentoNumero));
  return (editingOrcamento?.itens || []).map((item, index) => ({
    ...item,
    originalServicoCodigo: item.servicoCodigo,
    itemIndex: String(index),
  }));
}

function duplicatedBudgetServiceCode(items) {
  const seen = new Set();
  for (const item of items) {
    const code = String(item.servicoCodigo || "").trim();
    if (!code) continue;
    if (seen.has(code)) return code;
    seen.add(code);
  }
  return "";
}

function updateBudgetTotal() {
  const fake = { itens: collectBudgetItems() };
  const target = document.getElementById("budget-total");
  if (target) target.textContent = currency.format(totalOrcamento(fake));
}

async function addOrcamento(event) {
  event.preventDefault();
  const canSave = editingOrcamentoNumero ? hasPermission("orcamentos.edit") : hasPermission("orcamentos.create");
  if (!canSave || !canManageData()) {
    showNoPermissionMessage();
    return;
  }
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const currentOrcamento = state.orcamentos.find((orcamento) => Number(orcamento.numero) === Number(editingOrcamentoNumero));
  const numero = Number(data.numero || currentOrcamento?.numero);
  if (!Number.isInteger(numero) || numero <= 0) {
    alert("Informe um número de orçamento válido.");
    return;
  }

  const clienteDocumento = data.clienteDocumento || currentOrcamento?.clienteDocumento || "";
  const clienteSelecionado = state.clientes.find((cliente) => cliente.documento === clienteDocumento);
  const nomeClienteSelecionado = String(
    clienteSelecionado?.nome
      || clienteSelecionado?.razaoSocial
      || clienteSelecionado?.nomeFantasia
      || "",
  ).trim();
  if (!clienteDocumento || !clienteSelecionado || !nomeClienteSelecionado) {
    alert("Selecione um cliente com nome cadastrado antes de salvar o orçamento.");
    showBudgetClientSearch();
    return;
  }
  if (!currentOrcamento && !isClienteAtivo(clienteSelecionado)) {
    alert("Cliente inativo não pode ser usado em novo orçamento.");
    showBudgetClientSearch();
    return;
  }

  const duplicate = state.orcamentos.some((orcamento) => Number(orcamento.numero) === numero && Number(orcamento.numero) !== Number(editingOrcamentoNumero));
  if (duplicate) {
    alert("Já existe um orçamento com este número.");
    return;
  }

  if (currentOrcamento && isOrcamentoAprovado(currentOrcamento)) {
    const newStatus = normalizeOrcamentoStatus(data.status || currentOrcamento.status);
    if (newStatus === normalizeOrcamentoStatus(currentOrcamento.status)) {
      showFloatingMessage("Nenhuma alteração de status foi feita.");
      return;
    }
    const authorization = await confirmBudgetStatusChange(currentOrcamento, newStatus);
    if (!authorization) return;
    const payload = { ...currentOrcamento, status: newStatus };
    state.orcamentos = state.orcamentos.map((orcamento) => Number(orcamento.numero) === Number(editingOrcamentoNumero) ? payload : orcamento);
    editingOrcamentoNumero = null;
    addingBudgetItem = false;
    saveState({
      acao: "orcamento.alterar_status_aprovado",
      modulo: "orcamentos",
      entidadeTipo: "orcamento",
      entidadeId: String(numero),
      detalhes: {
        statusAnterior: currentOrcamento.status,
        statusNovo: newStatus,
        administradorAutorizador: authorization.approverUsuario || currentUser?.usuario || "",
        administradorNome: authorization.approverNome || currentUser?.nome || "",
      },
    });
    render();
    return;
  }

  const collectedItems = collectBudgetItems();
  if (!collectedItems.length || collectedItems.some((item) => !item.servicoCodigo)) {
    alert("Informe pelo menos um serviço ativo no orçamento.");
    return;
  }

  const inactiveNewItem = collectedItems.find((item) => {
    const service = servicoByCodigo(item.servicoCodigo);
    const isOldItem = editingOrcamentoNumero && item.originalServicoCodigo === item.servicoCodigo;
    return !isServicoAtivo(service) && !isOldItem;
  });
  if (inactiveNewItem) {
    alert("Serviços inativos não podem ser inseridos em novos itens de orçamento.");
    return;
  }

  const finalItems = mergeBudgetItems(currentOrcamento?.itens || [], collectedItems);
  const duplicatedServiceCode = duplicatedBudgetServiceCode(finalItems);
  if (duplicatedServiceCode) {
    alert(`O serviço ${duplicatedServiceCode} já foi informado neste orçamento. Não é permitido duplicar serviço no mesmo orçamento.`);
    return;
  }

  const newStatus = normalizeOrcamentoStatus(data.status || "EM ANÁLISE");
  let statusAuthorization = null;
  if (currentOrcamento && newStatus !== normalizeOrcamentoStatus(currentOrcamento.status)) {
    statusAuthorization = await confirmBudgetStatusChange(currentOrcamento, newStatus);
    if (!statusAuthorization) return;
  }

  const payload = {
    numero,
    clienteDocumento: clienteSelecionado.documento,
    data: data.data,
    status: newStatus,
    observacoes: data.observacoes,
    itens: finalItems,
  };

  const orcamentoAudit = editingOrcamentoNumero
    ? {
      acao: "orcamento.alterar",
      modulo: "orcamentos",
      entidadeTipo: "orcamento",
      entidadeId: String(numero),
      detalhes: {
        cliente: clienteSelecionado.nome,
        status: payload.status,
        statusAnterior: currentOrcamento?.status || "",
        administradorAutorizador: statusAuthorization?.approverUsuario || "",
        administradorNome: statusAuthorization?.approverNome || "",
      },
    }
    : { acao: "orcamento.criar", modulo: "orcamentos", entidadeTipo: "orcamento", entidadeId: String(numero), detalhes: { cliente: clienteSelecionado.nome, status: payload.status } };

  if (editingOrcamentoNumero) {
    state.orcamentos = state.orcamentos.map((orcamento) => Number(orcamento.numero) === Number(editingOrcamentoNumero) ? payload : orcamento);
    editingOrcamentoNumero = null;
    addingBudgetItem = false;
  } else {
    state.orcamentos.push(payload);
  }
  draftBudgetItems = [];
  saveState(orcamentoAudit);
  render();
}

function newOrcamento() {
  editingOrcamentoNumero = null;
  blankNewOrcamento = true;
  addingBudgetItem = false;
  draftBudgetItems = [];
  renderOrcamentos();
  scrollOrcamentoFormIntoView();
}

function cancelOrcamento() {
  editingOrcamentoNumero = null;
  blankNewOrcamento = !isCompactLayout();
  addingBudgetItem = false;
  draftBudgetItems = [];
  renderOrcamentos();
}

function editOrcamento(numero) {
  editingOrcamentoNumero = Number(numero);
  blankNewOrcamento = false;
  addingBudgetItem = false;
  draftBudgetItems = [];
  setView("orcamentos");
  if (isCompactLayout()) {
    scrollOrcamentoFormIntoView();
  } else {
    focusSelectedOrcamentoRow();
  }
}

function openOrcamentoDetail(numero) {
  editOrcamento(numero);
}

function openReportOrcamento(numero) {
  if (!canView("orcamentos")) {
    showNoPermissionMessage();
    return;
  }
  openOrcamentoDetail(numero);
}

function scrollOrcamentoFormIntoView() {
  scrollCompactElementIntoView(".orcamento-form-panel");
}

function focusSelectedOrcamentoRow() {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const selectedRow = document.querySelector('.orcamentos-list-panel [data-open-orcamento].is-selected');
    const listWrap = selectedRow?.closest(".table-wrap");
    if (!selectedRow || !listWrap) return;

    const tableHeader = listWrap.querySelector("thead");
    const headerOffset = tableHeader ? tableHeader.getBoundingClientRect().height + 2 : 0;
    const rowTopInsideWrap = selectedRow.getBoundingClientRect().top - listWrap.getBoundingClientRect().top;
    listWrap.scrollTop = Math.max(0, listWrap.scrollTop + rowTopInsideWrap - headerOffset);
    listWrap.scrollLeft = 0;

    const stickyHeader = document.querySelector(".sidebar");
    const stickyOffset = stickyHeader && getComputedStyle(stickyHeader).position === "sticky"
      ? stickyHeader.getBoundingClientRect().height + 8
      : 8;
    const top = listWrap.getBoundingClientRect().top + window.scrollY - stickyOffset;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }));
}

function loadBudgetItemIntoForm(index) {
  const orcamento = state.orcamentos.find((item) => Number(item.numero) === Number(editingOrcamentoNumero));
  const budgetItem = orcamento?.itens?.[Number(index)];
  const container = document.getElementById("budget-items");
  if (!budgetItem || !container) return;

  container.innerHTML = "";
  addingBudgetItem = false;
  addBudgetItemRow({ ...budgetItem, itemIndex: index });
  if (isEditingApprovedBudget()) lockApprovedBudgetForm();
  updateBudgetTotal();
  updateBudgetSaveButton();
  updateBudgetItemDeleteButton();
  if (!canEditModule("orcamentos")) setFormReadOnly(document.getElementById("orcamento-form"));
}

function deleteSelectedBudgetItem() {
  if (isEditingApprovedBudget()) {
    return;
  }
  if (!hasPermission("orcamentos.edit") || !canManageData()) {
    showNoPermissionMessage();
    return;
  }
  const selectedItem = document.querySelector(".budget-item");
  const index = Number(selectedItem?.dataset.itemIndex);
  const orcamento = state.orcamentos.find((item) => Number(item.numero) === Number(editingOrcamentoNumero));
  if (!orcamento || !Number.isInteger(index) || index < 0 || index >= (orcamento.itens || []).length) {
    alert("Selecione um serviço do orçamento para deletar.");
    return;
  }

  if (!confirm("Deletar este serviço do orçamento?")) return;
  orcamento.itens = (orcamento.itens || []).filter((_, itemIndex) => itemIndex !== index);
  addingBudgetItem = false;
  saveState({
    acao: "orcamento.item_excluir",
    modulo: "orcamentos",
    entidadeTipo: "orcamento_item",
    entidadeId: `${editingOrcamentoNumero}:${index}`,
    detalhes: { orcamento: editingOrcamentoNumero, servico: selectedItem?.querySelector('[name="servicoCodigo"]')?.value || "" },
  });
  renderOrcamentos();
}

function deleteOrcamento(numero) {
  const orcamento = state.orcamentos.find((item) => Number(item.numero) === Number(numero));
  if (isCompactLayout()) {
    editingOrcamentoNumero = Number(numero);
    blankNewOrcamento = false;
    addingBudgetItem = false;
    renderOrcamentos();
    scrollOrcamentoFormIntoView();
  }
  if (isOrcamentoAprovado(orcamento)) {
    return;
  }
  if (!canDeleteFromModule("orcamentos") || !canManageData()) {
    showNoPermissionMessage();
    return;
  }
  if (!confirm("Excluir este orçamento?")) return;
  state.orcamentos = state.orcamentos.filter((orcamento) => Number(orcamento.numero) !== Number(numero));
  if (Number(editingOrcamentoNumero) === Number(numero)) editingOrcamentoNumero = null;
  saveState({ acao: "orcamento.excluir", modulo: "orcamentos", entidadeTipo: "orcamento", entidadeId: String(numero) });
  render();
}

function renderOrcamentoList() {
  const search = document.getElementById("orcamento-search")?.value.toLowerCase() || "";
  const filteredBudgets = state.orcamentos.filter((orcamento) => {
    return `${orcamento.numero} ${clienteNome(orcamento.clienteDocumento)} ${orcamento.status}`.toLowerCase().includes(search);
  });
  const budgets = applyTableSort("orcamentos", filteredBudgets, {
    numero: (orcamento) => Number(orcamento.numero || 0),
    cliente: (orcamento) => clienteNome(orcamento.clienteDocumento),
    data: (orcamento) => orcamento.data || "",
    status: (orcamento) => normalizeOrcamentoStatus(orcamento.status),
    total: (orcamento) => totalOrcamento(orcamento),
  });

  document.getElementById("orcamento-list").innerHTML = budgetTable(budgets, { sortList: "orcamentos" });
}

function financeiroTable(budgets) {
  if (!budgets.length) return emptyState();
  const orderedBudgets = applyTableSort("financeiro", budgets.slice(), {
    numero: (orcamento) => Number(orcamento.numero || 0),
    cliente: (orcamento) => clienteNome(orcamento.clienteDocumento),
    data: (orcamento) => orcamento.data || "",
    status: (orcamento) => normalizeOrcamentoStatus(orcamento.status),
    total: (orcamento) => totalOrcamento(orcamento),
  });
  return `
    <div class="table-wrap">
      <table class="budget-table">
        <thead><tr>
          ${sortableTableHeader("financeiro", "numero", "Número")}
          ${sortableTableHeader("financeiro", "cliente", "Cliente")}
          ${sortableTableHeader("financeiro", "data", "Data")}
          ${sortableTableHeader("financeiro", "status", "Status")}
          ${sortableTableHeader("financeiro", "total", "Total")}
        </tr></thead>
        <tbody>
          ${orderedBudgets.map((orcamento) => `
            <tr class="clickable-row" data-open-orcamento="${escapeHtml(orcamento.numero)}">
              <td><strong>${escapeHtml(orcamento.numero)}</strong></td>
              <td>${escapeHtml(clienteNome(orcamento.clienteDocumento))}</td>
              <td>${escapeHtml(formatDate(orcamento.data))}</td>
              <td><span class="badge ${statusClass(orcamento.status)}">${escapeHtml(normalizeOrcamentoStatus(orcamento.status))}</span></td>
              <td>${currency.format(totalOrcamento(orcamento))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>`;
}

function statusReportTable(budgets = state.orcamentos.filter(isOrcamentoClienteAtivo)) {
  const rows = orcamentosPorStatus({ budgets });
  if (!rows.length) return emptyState();
  return chartDataTable(rows, "Status");
}

function chartDataTable(rows, firstColumnLabel) {
  if (!rows.length) return emptyState();
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>${escapeHtml(firstColumnLabel)}</th><th>Valor</th></tr></thead>
        <tbody>
          ${rows.map((row) => {
            const actionAttributes = chartActionAttributes(row);
            return `
            <tr class="${actionAttributes ? "clickable-row" : ""}" ${actionAttributes}>
              <td>${escapeHtml(row.label)}</td>
              <td>${currency.format(row.value)}</td>
            </tr>
          `;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function budgetTable(budgets, options = {}) {
  if (!budgets.length) return emptyState();
  const showDetail = options.showDetail !== false;
  const showBudgetActions = hasPermission("orcamentos.print") || canShareBudgets() || canDeleteFromModule("orcamentos");
  const budgetHeaders = options.sortList
    ? [
        sortableTableHeader(options.sortList, "numero", "Número"),
        sortableTableHeader(options.sortList, "cliente", "Cliente"),
        sortableTableHeader(options.sortList, "data", "Data"),
        sortableTableHeader(options.sortList, "status", "Status"),
        sortableTableHeader(options.sortList, "total", "Total"),
      ].join("")
    : "<th>Número</th><th>Cliente</th><th>Data</th><th>Status</th><th>Total</th>";
  return `
    <div class="table-wrap">
      <table class="budget-table">
        <thead><tr>${budgetHeaders}${showBudgetActions ? "<th>Ações</th>" : ""}</tr></thead>
        <tbody>
          ${budgets.map((orcamento) => `
            <tr class="clickable-row ${showDetail && Number(editingOrcamentoNumero) === Number(orcamento.numero) ? "is-selected" : ""}" data-open-orcamento="${escapeHtml(orcamento.numero)}">
              <td><strong>${escapeHtml(orcamento.numero)}</strong></td>
              <td>${escapeHtml(clienteNome(orcamento.clienteDocumento))}</td>
              <td>${escapeHtml(formatDate(orcamento.data))}</td>
              <td><span class="badge ${statusClass(orcamento.status)}">${escapeHtml(normalizeOrcamentoStatus(orcamento.status))}</span></td>
              <td>${currency.format(totalOrcamento(orcamento))}</td>
              ${showBudgetActions ? `<td>
                <div class="row-actions">
                  ${hasPermission("orcamentos.print") ? `
                    <button class="small-button" data-print-budget="${escapeHtml(orcamento.numero)}">Imprimir</button>
                  ` : ""}
                  ${canShareBudgets() ? `
                    <button class="small-button" data-share-budget="${escapeHtml(orcamento.numero)}">Compartilhar</button>
                  ` : ""}
                  ${canDeleteFromModule("orcamentos") ? `<button class="small-button danger-text" data-delete-orcamento="${escapeHtml(orcamento.numero)}">Excluir</button>` : ""}
                </div>
              </td>` : ""}
            </tr>
            ${showDetail && Number(editingOrcamentoNumero) === Number(orcamento.numero) ? budgetPreviewRow(orcamento) : ""}
          `).join("")}
        </tbody>
      </table>
    </div>`;
}

function budgetPreviewRow(orcamento) {
  const colspan = hasPermission("orcamentos.print") || canShareBudgets() || canDeleteFromModule("orcamentos") ? 6 : 5;
  return `
    <tr class="budget-preview-row">
      <td colspan="${colspan}">
        <div class="budget-preview">
          <h3>Discriminação do pedido</h3>
          <table>
            <thead><tr><th>Código</th><th>Serviço</th><th>Qtd.</th><th>Valor</th><th>Desconto</th><th>Total</th></tr></thead>
            <tbody>
              ${(orcamento.itens || []).map((item, index) => {
                const lineTotal = Number(item.quantidade || 0) * Number(item.valorUnitario || 0) - Number(item.desconto || 0);
                return `
                  <tr class="clickable-row" data-load-budget-item="${escapeHtml(index)}">
                    <td>${escapeHtml(item.servicoCodigo)}</td>
                    <td>${escapeHtml(servicoNome(item.servicoCodigo))}</td>
                    <td>${escapeHtml(item.quantidade)}</td>
                    <td>${currency.format(Number(item.valorUnitario || 0))}</td>
                    <td>${currency.format(Number(item.desconto || 0))}</td>
                    <td>${currency.format(lineTotal)}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  `;
}

async function printBudget(numero) {
  if (!hasPermission("orcamentos.print")) {
    showNoPermissionMessage();
    return;
  }
  if (renderPrintBudget(numero)) {
    const choice = await askPrintSaveChoice();
    if (choice === "cancel") {
      return;
    }

    if (choice === "yes") {
      const orcamento = state.orcamentos.find((item) => Number(item.numero) === Number(numero));
      if (!isOrcamentoAprovado(orcamento)) {
        alert("Este orçamento não está aprovado. Não será possível salvar no banco; a impressão será realizada sem salvar.");
      } else {
        const saved = await saveBudgetAsPrinted(numero);
        if (!saved) {
          return;
        }
        if (saved.reused) {
          const savedUrl = saved.publicUrl || new URL(saved.url, location.href).href;
          window.open(savedUrl, "_blank", "noopener");
          return;
        }
      }
    }

    await waitForPrintAreaAssets();
    requestAnimationFrame(() => {
      setTimeout(() => window.print(), 150);
    });
  }
}

async function shareBudget(numero) {
  if (!canShareBudgets()) {
    showNoPermissionMessage();
    return;
  }
  if (!renderPrintBudget(numero)) return;

  const orcamento = state.orcamentos.find((item) => Number(item.numero) === Number(numero));
  if (!isOrcamentoAprovado(orcamento)) {
    alert("Este orçamento não está aprovado. O PDF será gerado apenas para compartilhamento e não será salvo no banco.");
  }

  const saved = await saveBudgetAsPrinted(numero, { silent: true, allowUnapprovedPdf: true });
  if (!saved) return;

  const clienteRecord = state.clientes.find((item) => item.documento === orcamento?.clienteDocumento) || {};
  const cliente = clienteNome(orcamento?.clienteDocumento);
  const url = saved.publicUrl || new URL(saved.url, location.href).href;
  const subject = `Consult - Segurança e Medicina do Trabalho - Orçamento Nr. ${orcamento.numero}`;
  const message = `Prezado cliente: ${cliente}\r\n\r\nConforme solicitado, enviamos o orçamento referente aos serviços de Medicina e Segurança do Trabalho.\r\n\r\nLink do orçamento:\r\n${url}`;
  const channel = await askBudgetShareChannel();

  if (channel === "email") {
    const to = String(clienteRecord.email || "").trim() || await askEmailRecipient("");
    if (!to) return;
    await sendBudgetEmail({ to, subject, cliente, url, fileName: saved.fileName });
    return;
  }

  if (channel === "whatsapp") {
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
  }
}

async function sendBudgetEmail(payload) {
  const closeProcessing = showProcessingMessage("Enviando e-mail com o orçamento...");
  try {
    const response = await csrfFetch("/api/orcamentos/enviar-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Não foi possível enviar o e-mail.");
    }
    showFloatingMessage("E-mail enviado com o PDF anexado.", "success");
  } catch (error) {
    showFloatingMessage(error.message || "Não foi possível enviar o e-mail. Verifique a configuração SMTP.");
  } finally {
    closeProcessing();
  }
}

function askAdminAuthorization(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "choice-modal";
    overlay.innerHTML = `
      <div class="choice-dialog" role="dialog" aria-modal="true" aria-labelledby="password-confirm-title">
        <h2 id="password-confirm-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <label>Usuário técnico ou e-mail do administrador
          <input id="admin-confirm-user" autocomplete="username" required>
        </label>
        <label>Senha do administrador
          <input id="admin-confirm-password" type="password" autocomplete="current-password" required>
        </label>
        <div class="choice-actions">
          <button type="button" class="primary-button" data-choice="confirm">Confirmar</button>
          <button type="button" class="danger-button" data-choice="cancel">Cancelar</button>
        </div>
      </div>
    `;

    const userInput = overlay.querySelector("#admin-confirm-user");
    const passwordInput = overlay.querySelector("#admin-confirm-password");
    const handleKeydown = (event) => {
      if (event.key === "Escape") close(null);
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    };
    const close = (value) => {
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
      resolve(value);
    };
    const submit = () => {
      if (!userInput.reportValidity() || !passwordInput.reportValidity()) return;
      close({ usuario: userInput.value.trim(), senha: passwordInput.value });
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });
    overlay.querySelector('[data-choice="confirm"]').addEventListener("click", submit);
    overlay.querySelector('[data-choice="cancel"]').addEventListener("click", () => close(null));
    document.addEventListener("keydown", handleKeydown);
    document.body.append(overlay);
    userInput.focus();
  });
}

async function confirmBudgetStatusChange(orcamento, newStatus) {
  if (userProfile().toUpperCase() === "ADMIN" || hasPermission("orcamentos.status")) {
    return {
      approverUsuario: currentUser?.usuario || "",
      approverNome: currentUser?.nome || "",
    };
  }

  const credentials = await askAdminAuthorization(
    "Confirmar alteração de status",
    `Informe as credenciais de um administrador para alterar o status do orçamento Nº ${orcamento.numero} para ${newStatus}.`,
  );
  if (!credentials) return null;

  try {
    const response = await csrfFetch("/api/auth/confirm-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: credentials.usuario,
        senha: credentials.senha,
        permission: "orcamentos.status",
        requireAdmin: true,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Senha não confirmada.");
    }
    return {
      approverUsuario: result.approver?.usuario || credentials.usuario,
      approverNome: result.approver?.nome || "",
    };
  } catch (error) {
    alert(error.message || "Não foi possível confirmar a senha.");
    return null;
  }
}

async function confirmClienteInactivation(cliente) {
  if (userProfile().toUpperCase() === "ADMIN" || hasPermission("clientes.status")) {
    return {
      approverUsuario: currentUser?.usuario || "",
      approverNome: currentUser?.nome || "",
    };
  }

  const credentials = await askAdminAuthorization(
    "Confirmar inativação de cliente",
    `Informe as credenciais de um administrador para inativar o cliente ${cliente.nome || cliente.documento}.`,
  );
  if (!credentials) return null;

  try {
    const response = await csrfFetch("/api/auth/confirm-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: credentials.usuario,
        senha: credentials.senha,
        permission: "clientes.status",
        requireAdmin: true,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Senha não confirmada.");
    }
    return {
      approverUsuario: result.approver?.usuario || credentials.usuario,
      approverNome: result.approver?.nome || "",
    };
  } catch (error) {
    alert(error.message || "Não foi possível confirmar a senha.");
    return null;
  }
}

async function confirmClienteDeletion(cliente) {
  if (userProfile().toUpperCase() === "ADMIN" || hasPermission("clientes.delete")) {
    return {
      approverUsuario: currentUser?.usuario || "",
      approverNome: currentUser?.nome || "",
    };
  }

  const credentials = await askAdminAuthorization(
    "Confirmar exclusão de cliente",
    `Informe as credenciais de um administrador para excluir o cliente ${cliente.nome || cliente.documento}.`,
  );
  if (!credentials) return null;

  try {
    const response = await csrfFetch("/api/auth/confirm-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: credentials.usuario,
        senha: credentials.senha,
        permission: "clientes.delete",
        requireAdmin: true,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Senha não confirmada.");
    }
    return {
      approverUsuario: result.approver?.usuario || credentials.usuario,
      approverNome: result.approver?.nome || "",
    };
  } catch (error) {
    alert(error.message || "Não foi possível confirmar a senha.");
    return null;
  }
}

function askPrintSaveChoice() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "choice-modal";
    overlay.innerHTML = `
      <div class="choice-dialog" role="dialog" aria-modal="true" aria-labelledby="print-choice-title">
        <h2 id="print-choice-title">Salvar orçamento?</h2>
        <p>Deseja salvar o PDF antes de imprimir?</p>
        <div class="choice-actions">
          <button type="button" class="success-button" data-choice="yes">Sim</button>
          <button type="button" class="ghost-button" data-choice="no">Não</button>
          <button type="button" class="danger-button" data-choice="cancel">Cancelar</button>
        </div>
      </div>
    `;

    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        close("cancel");
      }
    };
    const close = (value) => {
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
      resolve(value);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close("cancel");
      }
    });
    overlay.querySelector('[data-choice="yes"]').addEventListener("click", () => close("yes"));
    overlay.querySelector('[data-choice="no"]').addEventListener("click", () => close("no"));
    overlay.querySelector('[data-choice="cancel"]').addEventListener("click", () => close("cancel"));
    document.addEventListener("keydown", handleKeydown);
    document.body.append(overlay);
    overlay.querySelector('[data-choice="yes"]').focus();
  });
}

function askConfirmChoice(title, message, confirmLabel = "Confirmar") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "choice-modal";
    overlay.innerHTML = `
      <div class="choice-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-choice-title">
        <h2 id="confirm-choice-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <div class="choice-actions">
          <button type="button" class="danger-button" data-choice="confirm">${escapeHtml(confirmLabel)}</button>
          <button type="button" class="ghost-button" data-choice="cancel">Cancelar</button>
        </div>
      </div>
    `;

    const handleKeydown = (event) => {
      if (event.key === "Escape") close(false);
    };
    const close = (value) => {
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
      resolve(value);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });
    overlay.querySelector('[data-choice="confirm"]').addEventListener("click", () => close(true));
    overlay.querySelector('[data-choice="cancel"]').addEventListener("click", () => close(false));
    document.addEventListener("keydown", handleKeydown);
    document.body.append(overlay);
    overlay.querySelector('[data-choice="cancel"]').focus();
  });
}

function askYesNoChoice(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "choice-modal";
    overlay.innerHTML = `
      <div class="choice-dialog" role="dialog" aria-modal="true" aria-labelledby="yes-no-choice-title">
        <h2 id="yes-no-choice-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <div class="choice-actions">
          <button type="button" class="success-button" data-choice="yes">Sim</button>
          <button type="button" class="ghost-button" data-choice="no">Não</button>
        </div>
      </div>
    `;

    const handleKeydown = (event) => {
      if (event.key === "Escape") close(false);
    };
    const close = (value) => {
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
      resolve(value);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });
    overlay.querySelector('[data-choice="yes"]').addEventListener("click", () => close(true));
    overlay.querySelector('[data-choice="no"]').addEventListener("click", () => close(false));
    document.addEventListener("keydown", handleKeydown);
    document.body.append(overlay);
    overlay.querySelector('[data-choice="yes"]').focus();
  });
}

function askBudgetShareChannel() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "choice-modal";
    overlay.innerHTML = `
      <div class="choice-dialog" role="dialog" aria-modal="true" aria-labelledby="share-choice-title">
        <h2 id="share-choice-title">Compartilhar orçamento</h2>
        <p>Escolha como deseja enviar o orçamento.</p>
        <div class="choice-actions">
          <button type="button" class="primary-button" data-choice="email">E-mail</button>
          <button type="button" class="success-button" data-choice="whatsapp">WhatsApp</button>
          <button type="button" class="danger-button" data-choice="cancel">Cancelar</button>
        </div>
      </div>
    `;

    const handleKeydown = (event) => {
      if (event.key === "Escape") close("cancel");
    };
    const close = (value) => {
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
      resolve(value);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close("cancel");
    });
    overlay.querySelector('[data-choice="email"]').addEventListener("click", () => close("email"));
    overlay.querySelector('[data-choice="whatsapp"]').addEventListener("click", () => close("whatsapp"));
    overlay.querySelector('[data-choice="cancel"]').addEventListener("click", () => close("cancel"));
    document.addEventListener("keydown", handleKeydown);
    document.body.append(overlay);
    overlay.querySelector('[data-choice="email"]').focus();
  });
}

function askEmailRecipient(defaultEmail = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "choice-modal";
    overlay.innerHTML = `
      <div class="choice-dialog" role="dialog" aria-modal="true" aria-labelledby="email-recipient-title">
        <h2 id="email-recipient-title">Enviar orçamento por e-mail</h2>
        <label>Destinatário
          <input id="email-recipient-input" type="email" value="${fieldValue(defaultEmail)}" placeholder="cliente@email.com">
        </label>
        <div class="choice-actions">
          <button type="button" class="primary-button" data-choice="send">Enviar</button>
          <button type="button" class="danger-button" data-choice="cancel">Cancelar</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector("#email-recipient-input");
    const handleKeydown = (event) => {
      if (event.key === "Escape") close("");
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    };
    const close = (value) => {
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
      resolve(value);
    };
    const submit = () => {
      if (!input.reportValidity()) return;
      close(input.value.trim());
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close("");
    });
    overlay.querySelector('[data-choice="send"]').addEventListener("click", submit);
    overlay.querySelector('[data-choice="cancel"]').addEventListener("click", () => close(""));
    document.addEventListener("keydown", handleKeydown);
    document.body.append(overlay);
    input.focus();
  });
}

async function saveBudgetAsPrinted(numero, options = {}) {
  const orcamento = state.orcamentos.find((item) => Number(item.numero) === Number(numero));
  if (!orcamento) {
    alert("Orçamento não encontrado.");
    return false;
  }

  if (!isOrcamentoAprovado(orcamento) && !options.allowUnapprovedPdf) {
    alert("Este orçamento não está aprovado. Não será possível salvar no banco; use apenas imprimir ou compartilhar.");
    return false;
  }

  const fileName = budgetFileName(orcamento);
  const html = await buildSavedBudgetHtml(fileName, false);
  const cliente = state.clientes.find((item) => item.documento === orcamento.clienteDocumento) || {};
  const payload = {
    fileName,
    html,
    forceRegenerate: true,
    orcamento,
    cliente,
    itens: orcamento.itens.map((item) => ({
      ...item,
      servicoNome: servicoNome(item.servicoCodigo),
    })),
  };

  const closeProcessing = showProcessingMessage("Gerando PDF do orçamento...");
  try {
    const response = await csrfFetch("/api/orcamentos/salvar-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Servidor de homologação desatualizado. Feche a janela do servidor, rode novamente o arquivo reiniciar-rede-local.bat e recarregue esta página.");
    }

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Não foi possível salvar.");
    }
    if (!result.ok) throw new Error(result.error || "Não foi possível salvar.");
    if (!options.silent) {
      alert(result.reused ? "PDF já salvo no banco. Abrindo arquivo existente." : result.savedToDatabase ? "PDF salvo no banco de dados." : "PDF gerado sem salvar no banco, pois o orçamento não está aprovado.");
    }
    return result;
  } catch (error) {
    alert(error.message || "Não foi possível salvar o orçamento. Verifique se o servidor de homologação está rodando atualizado.");
    return false;
  } finally {
    closeProcessing();
  }
}

async function exportReportPdf(type) {
  if (!canExportReports()) {
    showNoPermissionMessage();
    return;
  }
  const report = buildReportDefinition(type, { budgets: filteredReportBudgets() });
  if (!report) return;

  const androidWebView = isAndroidWebView();
  const reportWindow = androidWebView ? null : window.open("about:blank", "_blank");
  if (!androidWebView && !reportWindow) {
    showFloatingMessage("O navegador bloqueou a nova aba. Permita pop-ups para este site e tente novamente.", "error");
    return;
  }
  if (reportWindow) writeReportWindowMessage(reportWindow, "Gerando relatório. Aguarde...");

  const closeProcessing = showProcessingMessage("Gerando relatório em PDF...");
  try {
    const response = await csrfFetch("/api/relatorios/salvar-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: report.fileName,
        report,
        html: buildReportPdfHtml(report),
      }),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Servidor de homologação desatualizado. Reinicie o servidor e recarregue a página.");
    }

    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Não foi possível gerar o relatório.");
    }

    const reportUrl = new URL(result.publicUrl || result.url, location.href);
    reportUrl.searchParams.set("v", String(Date.now()));

    if (androidWebView) {
      hideProcessingMessage();
      showFloatingMessage("Relatório gerado. Abrindo PDF...", "success");
      openDocumentUrl(reportUrl.href);
      return;
    }

    const pdfUrl = result.contentBase64
      ? URL.createObjectURL(base64ToBlob(result.contentBase64, result.mimeType || "application/pdf"))
      : null;
    hideProcessingMessage();
    showFloatingMessage("Relatório gerado. Abrindo PDF...", "success");
    reportWindow.location.href = pdfUrl || reportUrl.href;
  } catch (error) {
    const message = error.message || "Não foi possível gerar o relatório em PDF.";
    if (reportWindow) writeReportWindowMessage(reportWindow, message, true);
    showFloatingMessage(message, "error");
  } finally {
    closeProcessing();
  }
}

function writeReportWindowMessage(targetWindow, message, isError = false) {
  targetWindow.document.open();
  targetWindow.document.write(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <title>Relatório</title>
      </head>
      <body style="font-family:Arial,sans-serif;margin:0;padding:24px;color:#152f38">
        <h1 style="font-size:18px;margin:0 0 12px">${isError ? "Não foi possível gerar o relatório" : "Relatório"}</h1>
        <p style="font-size:14px;line-height:1.5;margin:0;color:${isError ? "#9f1239" : "#52656c"}">${escapeHtml(message)}</p>
      </body>
    </html>
  `);
  targetWindow.document.close();
}

async function handleReportExport(type) {
  if (!canExportReports()) {
    showNoPermissionMessage();
    return;
  }

  const choice = await askReportOutputChoice();
  if (choice === "pdf") {
    await exportReportPdf(type);
    return;
  }
  if (choice === "excel") {
    exportReportExcel(type);
  }
}

function askReportOutputChoice() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "choice-modal";
    overlay.innerHTML = `
      <div class="choice-dialog" role="dialog" aria-modal="true" aria-labelledby="report-choice-title">
        <h2 id="report-choice-title">Gerar relatório</h2>
        <p>Escolha o formato de saída do relatório.</p>
        <div class="choice-actions">
          <button type="button" class="primary-button" data-choice="pdf">Imprimir PDF</button>
          <button type="button" class="success-button" data-choice="excel">Exportar Excel</button>
          <button type="button" class="danger-button" data-choice="cancel">Cancelar</button>
        </div>
      </div>
    `;

    const handleKeydown = (event) => {
      if (event.key === "Escape") close("cancel");
    };
    const close = (value) => {
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
      resolve(value);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close("cancel");
    });
    overlay.querySelector('[data-choice="pdf"]').addEventListener("click", () => close("pdf"));
    overlay.querySelector('[data-choice="excel"]').addEventListener("click", () => close("excel"));
    overlay.querySelector('[data-choice="cancel"]').addEventListener("click", () => close("cancel"));
    document.addEventListener("keydown", handleKeydown);
    document.body.append(overlay);
    overlay.querySelector('[data-choice="pdf"]').focus();
  });
}

async function exportReportExcel(type) {
  if (!canExportReports()) {
    showNoPermissionMessage();
    return;
  }
  const report = buildReportDefinition(type, { budgets: filteredReportBudgets() });
  if (!report) return;

  const closeProcessing = showProcessingMessage("Exportando relatório para Excel...");
  try {
    const response = await csrfFetch("/api/relatorios/salvar-xlsx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: report.fileName,
        report,
      }),
    });
    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      const result = contentType.includes("application/json") ? await response.json() : {};
      throw new Error(result.error || "Não foi possível gerar o relatório.");
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const disposition = response.headers.get("content-disposition") || "";
    const fileNameMatch = disposition.match(/filename="?([^";]+)"?/i);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileNameMatch?.[1] || `${report.fileName}.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    showFloatingMessage("Relatório exportado para Excel.", "success");
  } catch (error) {
    alert(error.message || "Não foi possível gerar o relatório em Excel.");
  } finally {
    closeProcessing();
  }
}

function buildReportDefinition(type, options = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const reportDate = formatDate(today);
  const reportSubtitle = `Emitido em ${reportDate}. ${reportFilterDescription()}`;
  const statisticalBudgets = options.budgets || orcamentosEstatisticos();
  const totalValue = statisticalBudgets.reduce((sum, orcamento) => sum + totalOrcamento(orcamento), 0);
  const reportServices = filteredReportServices();
  const reportServiceCodes = new Set(reportServices.map((servico) => String(servico.codigo)));
  const filteredClientDocuments = new Set();
  statisticalBudgets.forEach((orcamento) => {
    filteredClientDocuments.add(orcamento.clienteDocumento);
    filteredClientDocuments.add(onlyDigits(orcamento.clienteDocumento));
  });
  const reportClients = state.clientes.filter((cliente) => {
    if (reportFilters.clienteStatus === "ATIVO" && !isClienteAtivo(cliente)) return false;
    if (reportFilters.clienteStatus === "INATIVO" && isClienteAtivo(cliente)) return false;
    if (!hasBudgetReportFilters()) return true;
    return filteredClientDocuments.has(cliente.documento) || filteredClientDocuments.has(onlyDigits(cliente.documento));
  });

  if (type === "vendas") {
    const approvedBudgets = statisticalBudgets.filter(isOrcamentoAprovado);
    const registeredTotal = statisticalBudgets.reduce((sum, orcamento) => sum + totalCadastradoOrcamento(orcamento), 0);
    const discountTotal = statisticalBudgets.reduce((sum, orcamento) => sum + totalDescontosOrcamento(orcamento), 0);
    return {
      title: "Relatório de Vendas",
      fileName: `relatorio-vendas-${formatDateFile(today)}`,
      pageSize: "A4 landscape",
      subtitle: reportSubtitle,
      summary: [
        { label: "Orçamentos", value: String(statisticalBudgets.length) },
        { label: "Total cadastrado", value: currency.format(registeredTotal) },
        { label: "Total descontos", value: currency.format(discountTotal) },
        { label: "Total orçamento", value: currency.format(totalValue) },
        { label: "Aprovados", value: String(approvedBudgets.length) },
        { label: "Valor aprovado", value: currency.format(approvedBudgets.reduce((sum, orcamento) => sum + totalOrcamento(orcamento), 0)) },
      ],
      columns: ["Número", "Cliente", "Data", "Status", "Total cadastrado", "Descontos", "Total orçamento"],
      rows: statisticalBudgets
        .slice()
        .sort((a, b) => Number(b.numero || 0) - Number(a.numero || 0))
        .map((orcamento) => [
          `Nº ${orcamento.numero}`,
          clienteNome(orcamento.clienteDocumento),
          formatDate(orcamento.data),
          orcamento.status || "",
          currency.format(totalCadastradoOrcamento(orcamento)),
          currency.format(totalDescontosOrcamento(orcamento)),
          currency.format(totalOrcamento(orcamento)),
        ]),
    };
  }

  if (type === "clientes") {
    const valuesByClient = new Map();
    const lastBudgetByClient = new Map();
    statisticalBudgets.forEach((orcamento) => {
      valuesByClient.set(orcamento.clienteDocumento, (valuesByClient.get(orcamento.clienteDocumento) || 0) + totalOrcamento(orcamento));
      const currentLastBudget = lastBudgetByClient.get(orcamento.clienteDocumento);
      if (!currentLastBudget || String(orcamento.data || "") > String(currentLastBudget.data || "")) {
        lastBudgetByClient.set(orcamento.clienteDocumento, orcamento);
      }
    });
    return {
      title: "Relatório de Clientes",
      fileName: `relatorio-clientes-${formatDateFile(today)}`,
      pageSize: "A4 landscape",
      subtitle: reportSubtitle,
      summary: [
        { label: "Clientes", value: String(reportClients.length) },
        { label: "Com orçamento", value: String(valuesByClient.size) },
        { label: "Valor acumulado", value: currency.format(totalValue) },
        { label: "Ticket por cliente", value: currency.format(valuesByClient.size ? totalValue / valuesByClient.size : 0) },
      ],
      columns: ["CPF/CNPJ", "Cliente", "Contato", "Cidade", "Valor em orçamentos", "Último orçamento", "Data último orçamento"],
      rows: reportClients
        .slice()
        .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"))
        .map((cliente) => {
          const lastBudget = lastBudgetByClient.get(cliente.documento);
          return [
            cliente.documento || "",
            cliente.nome || "",
            cliente.telefone || cliente.email || "",
            [cliente.cidade, cliente.uf].filter(Boolean).join(" - "),
            currency.format(valuesByClient.get(cliente.documento) || 0),
            lastBudget ? currency.format(totalOrcamento(lastBudget)) : "-",
            lastBudget ? formatDate(lastBudget.data) : "-",
          ];
        }),
    };
  }

  if (type === "servicos") {
    const serviceTotals = reportServiceTotals(statisticalBudgets, reportServiceCodes);
    const requestedServices = [...serviceTotals.values()].filter((item) => item.quantidade > 0).length;
    return {
      title: "Relatório de Serviços Solicitados",
      fileName: `relatorio-servicos-${formatDateFile(today)}`,
      pageSize: "A4 landscape",
      subtitle: reportSubtitle,
      summary: [
        { label: "Serviços", value: String(reportServices.length) },
        { label: "Solicitados", value: String(requestedServices) },
        { label: "Valor total", value: currency.format(totalValue) },
        { label: "Ativos", value: String(reportServices.filter((servico) => isServicoAtivo(servico)).length) },
      ],
      columns: ["Código", "Serviço", "Status", "Valor cadastrado", "Menor unit. orçado", "Maior unit. orçado", "Qtd. solicitada", "Valor total"],
      rows: reportServices
        .slice()
        .sort((a, b) => String(a.codigo || "").localeCompare(String(b.codigo || ""), "pt-BR", { numeric: true }))
        .filter((servico) => {
          const total = serviceTotals.get(String(servico.codigo));
          return total && total.quantidade > 0;
        })
        .map((servico) => {
          const total = serviceTotals.get(String(servico.codigo)) || { quantidade: 0, valor: 0, menorUnitario: null, maiorUnitario: null };
          return [
            servico.codigo || "",
            servico.nome || "",
            normalizeServicoStatus(servico.status),
            currency.format(Number(servico.valor || 0)),
            total.menorUnitario === null ? "-" : currency.format(total.menorUnitario),
            total.maiorUnitario === null ? "-" : currency.format(total.maiorUnitario),
            String(total.quantidade),
            currency.format(total.valor),
          ];
        }),
    };
  }

  return null;
}

function reportServiceTotals(budgets, allowedCodes = null) {
  const totals = new Map();
  budgets.forEach((orcamento) => {
    (orcamento.itens || []).forEach((item) => {
      const key = String(item.servicoCodigo || "");
      if (allowedCodes && !allowedCodes.has(key)) return;
      const valorUnitario = Number(item.valorUnitario || 0);
      const current = totals.get(key) || { quantidade: 0, valor: 0, menorUnitario: null, maiorUnitario: null };
      current.quantidade += Number(item.quantidade || 0);
      current.valor += Number(item.quantidade || 0) * valorUnitario - Number(item.desconto || 0);
      current.menorUnitario = current.menorUnitario === null ? valorUnitario : Math.min(current.menorUnitario, valorUnitario);
      current.maiorUnitario = current.maiorUnitario === null ? valorUnitario : Math.max(current.maiorUnitario, valorUnitario);
      totals.set(key, current);
    });
  });
  return totals;
}

function buildReportPdfHtml(report) {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(report.title)}</title>
    <style>
      @page { size: ${escapeHtml(report.pageSize || "A4 portrait")}; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #152f38; font-family: Arial, Helvetica, sans-serif; font-size: 10px; }
      header { border-bottom: 2px solid #08a6b5; display: flex; justify-content: space-between; gap: 18px; padding-bottom: 10px; }
      h1 { font-size: 22px; letter-spacing: 0; margin: 4px 0; }
      h2 { color: #087f8b; font-size: 12px; margin: 0; text-transform: uppercase; }
      p { color: #52656c; margin: 4px 0 0; }
      .brand { color: #087f8b; font-size: 24px; font-weight: 800; text-align: right; }
      .brand small { color: #152f38; display: block; font-size: 10px; font-weight: 700; }
      .summary { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(108px, 1fr)); margin: 14px 0; }
      .summary article { border: 1px solid #d4e1e5; border-radius: 4px; min-height: 52px; padding: 8px; }
      .summary span { color: #52656c; display: block; font-size: 9px; margin-bottom: 6px; text-transform: uppercase; }
      .summary strong { display: block; font-size: 14px; }
      table { border-collapse: collapse; table-layout: auto; width: 100%; }
      th { background: #165a72; color: #fff; font-size: 9px; padding: 7px 6px; text-align: left; }
      td { border-bottom: 1px solid #dbe6e9; padding: 6px; vertical-align: top; }
      tr:nth-child(even) td { background: #f5fafb; }
      th:last-child, td:last-child { text-align: right; white-space: nowrap; }
      footer { color: #52656c; font-size: 9px; margin-top: 10px; text-align: right; }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h2>Consult</h2>
        <h1>${escapeHtml(report.title)}</h1>
        <p>${escapeHtml(report.subtitle)}</p>
      </div>
      <div class="brand">CONSULT<small>Segurança e Medicina do Trabalho</small></div>
    </header>
    <section class="summary">
      ${report.summary.map((item) => `<article><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></article>`).join("")}
    </section>
    <table>
      <thead><tr>${report.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
      <tbody>
        ${report.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
    <footer>${escapeHtml(report.rows.length)} registro(s)</footer>
  </body>
</html>`;
}

async function buildSavedBudgetHtml(fileName, autoPrint = true) {
  const cssText = await collectStylesText();
  const printRules = extractPrintRules(cssText);
  const printArea = document.getElementById("print-area").cloneNode(true);
  await embedImages(printArea);
  const printScript = autoPrint ? '<script>window.addEventListener("load", () => setTimeout(() => window.print(), 150));</script>' : "";

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Consult Orcamento</title>
    <style>
      ${cssText}
      @media screen {
        ${printRules}
        body { margin: 0; background: #f4f4f4; }
        .print-area { display: block !important; }
        .proposal-page { margin: 0 auto 16px; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18); }
      }
    </style>
  </head>
  <body>
    <main class="print-area" aria-hidden="false">${printArea.innerHTML}</main>
    ${printScript}
  </body>
</html>`;
}

async function collectStylesText() {
  const chunks = [];
  for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
    if (node.tagName === "STYLE") {
      chunks.push(node.textContent || "");
      continue;
    }

    const href = node.getAttribute("href");
    if (!href) continue;
    const response = await fetch(new URL(href, location.href));
    chunks.push(await response.text());
  }
  return chunks.join("\n");
}

function extractPrintRules(cssText) {
  const start = cssText.indexOf("@media print");
  if (start === -1) return "";

  const firstBrace = cssText.indexOf("{", start);
  const lastBrace = cssText.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return "";

  return cssText
    .slice(firstBrace + 1, lastBrace)
    .replace(/@page\s*{[^}]*}/g, "");
}

async function embedImages(root) {
  const images = [...root.querySelectorAll("img")];
  await Promise.all(images.map(async (image) => {
    const src = image.getAttribute("src");
    if (!src || src.startsWith("data:")) return;

    const response = await fetch(new URL(src, location.href));
    const blob = await response.blob();
    image.setAttribute("src", await blobToDataUrl(blob));
  }));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, mimeType = "application/octet-stream") {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

async function waitForPrintAreaAssets() {
  const printArea = document.getElementById("print-area");
  if (!printArea) return;
  const images = [...printArea.querySelectorAll("img")];
  await Promise.all(images.map((image) => {
    if (image.complete && image.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
  }));
}

function renderPrintBudget(numero) {
  const orcamento = state.orcamentos.find((item) => Number(item.numero) === Number(numero));
  if (!orcamento) {
    alert("Orçamento não encontrado.");
    return false;
  }

  const cliente = state.clientes.find((item) => item.documento === orcamento.clienteDocumento) || {};
  const printArea = document.getElementById("print-area");
  printArea.innerHTML = `
    <article class="proposal-page proposal-page-cover">
      <img class="proposal-bg page-1-bg" src="assets/pdf-ref-images/page1-img1.jpg" alt="">
    </article>
    <article class="proposal-page proposal-page-services">
      <img class="proposal-bg page-2-bg" src="assets/pdf-ref-images/page2-img1.jpg" alt="">
    </article>
    <article class="proposal-page budget-print-page">
      <img class="proposal-bg page-3-bg" src="assets/fundo-formulario.png" alt="">
      <img class="budget-title-img" src="assets/pdf-ref-images/page3-img2.png" alt="">
      <div class="budget-number">Nr. ${escapeHtml(orcamento.numero)}</div>
      <div class="budget-field budget-client"><strong>Cliente:</strong><span>${escapeHtml(cliente.nome)}</span></div>
      <div class="budget-field budget-address"><strong>Endereço:</strong><span>${escapeHtml(formatAddress(cliente))}</span></div>
      <div class="budget-field budget-phone"><strong>Telefone:</strong><span>${escapeHtml(cliente.telefone)}</span></div>
      <div class="budget-field budget-date"><strong>Data:</strong><span>${escapeHtml(formatDate(orcamento.data))}</span></div>
      <table class="budget-print-table">
        <thead>
          <tr>
            <th>Código</th>
            <th>Produto</th>
            <th>Qtd.</th>
            <th>Vlr.Unit</th>
            <th>Descontos</th>
            <th>Vlr Total</th>
          </tr>
        </thead>
        <tbody>
          ${orcamento.itens.map((item) => {
            const lineTotal = Number(item.quantidade || 0) * Number(item.valorUnitario || 0) - Number(item.desconto || 0);
            return `
              <tr>
                <td>${escapeHtml(item.servicoCodigo)}</td>
                <td>${escapeHtml(servicoNome(item.servicoCodigo))}</td>
                <td>${String(item.quantidade || 0).padStart(2, "0")}</td>
                <td>${currency.format(Number(item.valorUnitario || 0))}</td>
                <td>${currency.format(Number(item.desconto || 0))}</td>
                <td>${currency.format(lineTotal)}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
      <div class="budget-total-label">Valor Total:</div>
      <div class="budget-total-value">${currency.format(totalOrcamento(orcamento))}</div>
      <ol class="budget-terms">
        <li>Total do orçamento: ${currency.format(totalOrcamento(orcamento))}</li>
        <li>Forma de pagamento: À combinar</li>
        <li>Validade do Orçamento: 10 dias a contar do recebimento</li>
        <li>Garantia: 1 ano</li>
      </ol>
      <div class="budget-approval">
        <p>Concordo e aprovo,</p>
        <div class="signature-line"></div>
        <strong>Assinatura do Responsável</strong>
        <span>${escapeHtml(cliente.nome)}</span>
        <span>${escapeHtml(formatDate(orcamento.data))}</span>
      </div>
      <p class="budget-notes">${escapeHtml(orcamento.observacoes)}</p>
    </article>
    <article class="proposal-page proposal-page-contact">
      <img class="proposal-bg page-4-bg" src="assets/pdf-ref-images/page4-img1.jpg" alt="">
    </article>
  `;
  printArea.setAttribute("aria-hidden", "false");
  return true;
}

function options(values, selected = "") {
  return values.map((value) => `<option value="${escapeHtml(value)}"${selectedAttr(selected, value)}>${escapeHtml(value)}</option>`).join("");
}

function sortableTableHeader(list, key, label) {
  const sort = tableSorts[list] || {};
  const active = sort.key === key;
  const directionLabel = sort.direction === "desc" ? "descending" : "ascending";
  const marker = active ? (sort.direction === "desc" ? "▼" : "▲") : "";
  return `
    <th${active ? ` aria-sort="${directionLabel}"` : ""}>
      <button type="button" class="sort-header${active ? " is-active" : ""}" data-sort-list="${escapeHtml(list)}" data-sort-key="${escapeHtml(key)}">
        <span>${escapeHtml(label)}</span>
        <span class="sort-marker" aria-hidden="true">${marker}</span>
      </button>
    </th>
  `;
}

function applyTableSort(list, items, accessors) {
  const sort = tableSorts[list] || {};
  const accessor = accessors[sort.key];
  if (!sort.key || !accessor) return items;

  const direction = sort.direction === "desc" ? -1 : 1;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const result = compareSortValues(accessor(a.item), accessor(b.item));
      return result === 0 ? a.index - b.index : result * direction;
    })
    .map((entry) => entry.item);
}

function compareSortValues(a, b) {
  const aNumber = typeof a === "number" ? a : Number.NaN;
  const bNumber = typeof b === "number" ? b : Number.NaN;
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
  return sortCollator.compare(String(a ?? ""), String(b ?? ""));
}

function updateTableSort(list, key) {
  const current = tableSorts[list] || { key: "", direction: "asc" };
  tableSorts[list] = {
    key,
    direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
  };

  if (list === "orcamentos") renderOrcamentoList();
  if (list === "clientes") renderClienteList();
  if (list === "servicos") renderServicoList();
  if (list === "arquivos") {
    const target = document.getElementById("files-list");
    if (target) target.innerHTML = arquivos.length ? arquivosTable(arquivos) : emptyState();
  }
  if (list === "usuarios") renderUsuarios();
  if (list === "financeiro") renderFinanceiro();
  if (list === "auditoria") {
    const target = document.getElementById("auditoria-list");
    if (target) target.innerHTML = auditTable(auditoriaLogs);
  }
}

function emptyState() {
  return document.getElementById("empty-state-template").innerHTML;
}

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.dataset.menuGroup;
    if (group === "administracao") {
      openMenuGroup = openMenuGroup === "administracao" ? "" : "administracao";
      syncNavigationMenus();
      return;
    }

    if (group === "financeiro") {
      if (openMenuGroup === "financeiro") {
        openMenuGroup = "";
        syncNavigationMenus();
        return;
      }

      const target = canView("financeiro")
        ? "financeiro"
        : menuViewsForGroup("financeiro").find((view) => canView(view));
      if (target) setView(target);
      else syncNavigationMenus();
      return;
    }

    setView(button.dataset.view);
  });
});

document.querySelectorAll("[data-sidebar-new]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.sidebarNew;
    if (!hasPermission(`${view}.create`) || !canManageData()) {
      showNoPermissionMessage();
      return;
    }
    setView(view);
    if (view === "clientes") newCliente();
    if (view === "servicos") newServico();
    if (view === "orcamentos") newOrcamento();
  });
});

function syncAutoHideNavigation() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;

  const compactMenu = window.matchMedia("(max-width: 920px)").matches;
  const currentScrollY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);

  if (!compactMenu) {
    sidebar.classList.remove("is-hidden-on-scroll");
    lastNavScrollY = currentScrollY;
    return;
  }

  const delta = currentScrollY - lastNavScrollY;
  if (currentScrollY < 36 || delta < -7) {
    sidebar.classList.remove("is-hidden-on-scroll");
  } else if (delta > 9 && currentScrollY > 90) {
    sidebar.classList.add("is-hidden-on-scroll");
  }
  lastNavScrollY = currentScrollY;
}

function requestAutoHideNavigationSync() {
  if (navScrollTicking) return;
  navScrollTicking = true;
  window.requestAnimationFrame(() => {
    syncAutoHideNavigation();
    navScrollTicking = false;
  });
}

lastNavScrollY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
window.addEventListener("scroll", requestAutoHideNavigationSync, { passive: true });
window.addEventListener("resize", requestAutoHideNavigationSync);

window.addEventListener("pageshow", () => {
  if (isDashboardActive()) {
    refreshDashboardFromServer();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && isDashboardActive()) {
    refreshDashboardFromServer();
  }
});

document.body.addEventListener("click", (event) => {
  const documentationFilterButton = event.target.closest("[data-documentation-filter]");
  if (documentationFilterButton) {
    const key = documentationFilterButton.dataset.documentationFilter;
    if (Object.prototype.hasOwnProperty.call(documentationFilters, key)) {
      documentationFilters = { ...documentationFilters, [key]: documentationFilterButton.dataset.documentationValue || "" };
      renderDocumentacao();
    }
    return;
  }

  const applyProfileButton = event.target.closest("#apply-profile-permissions");
  if (applyProfileButton) {
    applyProfilePermissionsToForm(event);
    return;
  }

  const reportButton = event.target.closest("[data-export-report]");
  if (reportButton) {
    handleReportExport(reportButton.dataset.exportReport);
    return;
  }

  const reportClienteLink = event.target.closest("[data-report-open-cliente]");
  if (reportClienteLink) {
    event.preventDefault();
    openReportCliente(reportClienteLink.dataset.reportOpenCliente);
    return;
  }

  const reportOrcamentoLink = event.target.closest("[data-report-open-orcamento]");
  if (reportOrcamentoLink) {
    event.preventDefault();
    openReportOrcamento(reportOrcamentoLink.dataset.reportOpenOrcamento);
    return;
  }

  const pdfFileLink = event.target.closest("[data-open-pdf-file]");
  if (pdfFileLink) {
    event.preventDefault();
    openDocumentUrl(pdfFileLink.getAttribute("href"));
    return;
  }

  const printButton = event.target.closest("[data-print-budget]");
  if (printButton) {
    printBudget(Number(printButton.dataset.printBudget));
    return;
  }

  const shareButton = event.target.closest("[data-share-budget]");
  if (shareButton) {
    shareBudget(Number(shareButton.dataset.shareBudget));
    return;
  }

  const budgetClientButton = event.target.closest("[data-budget-client]");
  if (budgetClientButton) {
    selectBudgetClient(budgetClientButton.dataset.budgetClient);
    return;
  }

  const editClienteButton = event.target.closest("[data-edit-cliente]");
  if (editClienteButton) {
    event.preventDefault();
    event.stopPropagation();
    editCliente(editClienteButton.dataset.editCliente);
    return;
  }

  const deleteClienteButton = event.target.closest("[data-delete-cliente]");
  if (deleteClienteButton) {
    event.preventDefault();
    event.stopPropagation();
    deleteCliente(deleteClienteButton.dataset.deleteCliente);
    return;
  }

  const editServicoButton = event.target.closest("[data-edit-servico]");
  if (editServicoButton) {
    event.preventDefault();
    event.stopPropagation();
    editServico(editServicoButton.dataset.editServico);
    return;
  }

  const deleteServicoButton = event.target.closest("[data-delete-servico]");
  if (deleteServicoButton) {
    deleteServico(deleteServicoButton.dataset.deleteServico);
    return;
  }

  const deleteOrcamentoButton = event.target.closest("[data-delete-orcamento]");
  if (deleteOrcamentoButton) {
    deleteOrcamento(deleteOrcamentoButton.dataset.deleteOrcamento);
    return;
  }

  const deleteArquivoButton = event.target.closest("[data-delete-arquivo]");
  if (deleteArquivoButton) {
    event.preventDefault();
    deleteArquivo(deleteArquivoButton.dataset.deleteArquivo, deleteArquivoButton.dataset.deleteArquivoNome);
    return;
  }

  const sortButton = event.target.closest("[data-sort-list]");
  if (sortButton) {
    event.preventDefault();
    event.stopPropagation();
    updateTableSort(sortButton.dataset.sortList, sortButton.dataset.sortKey);
    return;
  }

  const budgetItemRow = event.target.closest("[data-load-budget-item]");
  if (budgetItemRow) {
    loadBudgetItemIntoForm(budgetItemRow.dataset.loadBudgetItem);
    return;
  }

  const openOrcamentoRow = event.target.closest("[data-open-orcamento]");
  if (openOrcamentoRow) {
    openOrcamentoDetail(openOrcamentoRow.dataset.openOrcamento);
    return;
  }

  const openClienteRow = event.target.closest("[data-open-cliente]");
  if (openClienteRow) {
    viewCliente(openClienteRow.dataset.openCliente);
    return;
  }

  const openServicoRow = event.target.closest("[data-open-servico]");
  if (openServicoRow) {
    if (isCompactLayout()) return;
    editServico(openServicoRow.dataset.openServico);
  }

  const editUsuarioButton = event.target.closest("[data-edit-usuario]");
  if (editUsuarioButton) {
    editUsuario(editUsuarioButton.dataset.editUsuario);
    return;
  }

  const deleteUsuarioButton = event.target.closest("[data-delete-usuario]");
  if (deleteUsuarioButton) {
    event.preventDefault();
    event.stopPropagation();
    deleteUsuario(deleteUsuarioButton.dataset.deleteUsuario);
    return;
  }

  const openUsuarioRow = event.target.closest("[data-open-usuario]");
  if (openUsuarioRow) {
    if (isCompactLayout()) return;
    editUsuario(openUsuarioRow.dataset.openUsuario);
  }
});

document.getElementById("reset-data")?.addEventListener("click", () => {
  if (confirm("Recarregar os dados originais do Excel? Cadastros locais serão substituídos.")) {
    localStorage.removeItem(STORAGE_KEY);
    state = seedState();
    saveState({ acao: "dados.recarregar_seed", modulo: "sistema", entidadeTipo: "seed", entidadeId: "excel" });
    render();
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  if (appInstalled) return;
  deferredInstallPrompt = event;
  syncInstallButton();
});

document.getElementById("install-app")?.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  syncInstallButton();
});

document.getElementById("logout-app")?.addEventListener("click", logoutApp);

window.addEventListener("appinstalled", () => {
  appInstalled = true;
  deferredInstallPrompt = null;
  syncInstallButton();
});

window.addEventListener("pagehide", notifySessionClosed);

window.matchMedia("(display-mode: standalone)").addEventListener("change", (event) => {
  appInstalled = event.matches || isAppRunningInstalled();
  syncInstallButton();
});

syncInstallButton();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("service-worker.js");
}

initializeApp();

