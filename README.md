# TRADER OS v2.0 — Guia de Setup

## O que mudou nesta versão

| Antes (v1) | Agora (v2) |
|---|---|
| 1 arquivo de 4.360 linhas | Módulos separados por responsabilidade |
| API key hardcoded no HTML | Chaves salvas de forma segura pelo usuário |
| Screenshots em base64 no localStorage | Upload para Supabase Storage (URL) |
| Sem validação de formulários | Validação completa em `validation.js` |
| JSON blob gigante no banco | Schema estruturado com versioning |
| Textos misturados pt/en | 100% português correto |
| Sem modo Prop Firm real | Motor de regras FTMO, Topstep, The5%ers |
| Import CSV não implementado | Parser real para MT4/MT5/cTrader |

---

## Estrutura de arquivos

```
trader-os/
├── index.html              ← HTML semântico, sem JS inline
├── manifest.json           ← PWA
├── setup.sql               ← SQL para executar no Supabase
├── css/
│   ├── design-system.css   ← Variáveis, tokens
│   ├── layout.css          ← Header, sidebar, grid
│   ├── components.css      ← Botões, cards, modais
│   └── pages.css           ← Estilos por página
└── js/
    ├── app.js              ← Orquestrador principal (boot, nav, eventos)
    ├── config.js           ← Constantes, pares, prop firms
    ├── db.js               ← Dados locais, schema, cálculos
    ├── cloud.js            ← Supabase: auth, sync, storage
    ├── validation.js       ← Validação de todos os formulários
    ├── propfirm.js         ← Motor de regras prop firm
    └── ui/
        ├── dashboard.js    ← Renderização do dashboard
        ├── calendar.js     ← Calendário mensal
        ├── journal.js      ← Tabela de trades
        ├── analytics.js    ← Gráficos e análises
        ├── metas.js        ← Página de metas
        ├── propfirm-ui.js  ← UI do monitor prop firm
        └── components.js   ← Toast, modal, loading
```

---

## Setup do Supabase (recomendado)

### 1. Criar projeto
1. Acesse [supabase.com](https://supabase.com) e crie uma conta gratuita
2. Clique em **New Project** e configure um nome e senha
3. Aguarde o projeto inicializar (~2 minutos)

### 2. Executar o SQL
1. No painel do Supabase, vá em **SQL Editor**
2. Cole o conteúdo do arquivo `setup.sql`
3. Clique em **Run** — você verá `Setup concluído com sucesso!`

### 3. Copiar credenciais
1. Vá em **Settings → API**
2. Copie a **Project URL** (ex: `https://xxxx.supabase.co`)
3. Copie a **anon public** key (começa com `eyJ...`)

### 4. Configurar no app
1. Abra o Trader OS
2. Clique em **"Configurar sincronização em nuvem"**
3. Cole a URL e a Key
4. Clique em **Salvar e Ativar Nuvem**
5. Crie sua conta e faça login

---

## Uso sem Supabase (modo local)

O app funciona sem Supabase usando localStorage.  
**Limitações do modo local:**
- Dados ficam apenas no navegador atual
- Sem sincronização entre dispositivos
- Limite de ~5MB (sem suporte a screenshots)
- Sem login/senha

---

## Segurança

- ✅ Nenhuma chave de API no código-fonte
- ✅ RLS (Row Level Security) no Supabase: cada usuário acessa apenas seus dados
- ✅ Screenshots armazenados no Supabase Storage (não em base64)
- ✅ Validação de todos os inputs antes de salvar
- ✅ Senha exige mínimo 8 caracteres
- ✅ Tokens de sessão gerenciados pelo Supabase Auth

---

## Deploy

### Opção 1: Netlify (recomendado, gratuito)
```bash
# Arraste a pasta trader-os para app.netlify.com
# Ou conecte seu repositório GitHub
```

### Opção 2: Vercel
```bash
npm i -g vercel
cd trader-os
vercel deploy
```

### Opção 3: Servidor próprio
Qualquer servidor HTTP serve arquivos estáticos.  
O app não precisa de backend próprio (usa Supabase).

---

## Próximos passos (Fase 2)

- [ ] Migrar para Next.js + React para componentização completa
- [ ] Tabelas separadas no Supabase (trades, operations, accounts)
- [ ] Integração MT4/MT5 via Expert Advisor
- [ ] Sistema de planos com Stripe
- [ ] Relatório PDF mensal automático
- [ ] Notificações push (drawdown, metas)
# trader-os
# trader-os
