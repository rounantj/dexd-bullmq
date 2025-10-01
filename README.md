# Projeto BullMQ com Redis e TypeScript

Este projeto demonstra o uso de **BullMQ** para gerenciamento de filas com Redis, implementado em TypeScript.

## 🚀 Tecnologias

- **Node.js** com TypeScript
- **BullMQ** - Sistema de filas robusto baseado em Redis
- **Redis** - Armazenamento em memória para filas
- **Docker & Docker Compose** - Containerização

## 📁 Estrutura do Projeto

```
infra/
├── docker-compose.yml          # Configuração do Redis
├── Dockerfile                  # Container da aplicação (opcional)
├── package.json
├── tsconfig.json
└── src/
    ├── config/
    │   └── redis.ts           # Configuração da conexão Redis
    ├── queues/
    │   ├── emailQueue.ts      # Fila de emails
    │   └── dataProcessingQueue.ts  # Fila de processamento
    ├── workers/
    │   ├── emailWorker.ts     # Worker para processar emails
    │   └── dataProcessingWorker.ts # Worker para processar dados
    ├── index.ts               # Aplicação completa (producer + worker)
    ├── producer.ts            # Apenas adiciona jobs
    └── worker.ts              # Apenas processa jobs
```

## 🔧 Configuração

### 1. Subir o Redis com Docker Compose

```bash
docker-compose up -d
```

Isso iniciará um container Redis na porta `6379`.

### 2. Instalar Dependências

```bash
npm install
```

### 3. Configurar Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```bash
cp env.example .env
```

E edite o `.env` com suas configurações:

```env
REDIS_URL=redis://localhost:6379
```

## 🎯 Como Usar

> **Importante:** Certifique-se de que o arquivo `.env` está configurado antes de rodar a aplicação.

### Opção 1: Servidor com Dashboard (Recomendado)

```bash
npm run dev
```

Isso iniciará:

- ✅ Servidor Express na porta 5050
- ✅ Dashboard Bull Board em `http://localhost:5050/admin/queues`
- ✅ Workers processando em background
- ✅ Health check em `http://localhost:5050/health`

### Opção 2: Producer e Workers Separados

**Terminal 1 - Iniciar Servidor:**

```bash
npm run dev
```

**Terminal 2 - Adicionar Jobs:**

```bash
npm run producer
```

## 📊 Dashboard Bull Board

Acesse `http://localhost:5050/admin/queues` para:

- 📈 Visualizar todas as filas e estatísticas
- 🔍 Ver detalhes de cada job (dados, progresso, erros)
- ⚡ Fazer retry manual de jobs falhados
- 🗑️ Limpar filas (completed, failed)
- 📝 Monitorar jobs em tempo real

## 📝 Exemplos de Uso

### Adicionar um Job de Email

```typescript
import { emailQueue } from "./queues/emailQueue";

await emailQueue.add("send-email", {
  to: "usuario@example.com",
  subject: "Olá!",
  body: "Mensagem de teste",
  priority: 1,
});
```

### Adicionar um Job de Processamento de Dados

```typescript
import { dataProcessingQueue } from "./queues/dataProcessingQueue";

await dataProcessingQueue.add("process-data", {
  userId: "user-123",
  operation: "create",
  data: {
    name: "João",
    email: "joao@example.com",
  },
});
```

## ⚙️ Configuração do Redis

Por padrão, a aplicação conecta em `redis://localhost:6379`.

### Opção 1: Usar REDIS_URL (Recomendado)

```bash
export REDIS_URL=redis://localhost:6379
```

Exemplos de URLs:

- Local: `redis://localhost:6379`
- Com senha: `redis://:senha@localhost:6379`
- Redis Cloud: `redis://user:senha@host:porta`
- TLS: `rediss://host:porta`

### Opção 2: Usar REDIS_HOST e REDIS_PORT

```bash
export REDIS_HOST=seu-host
export REDIS_PORT=6379
```

## 🔍 Recursos do BullMQ Implementados

- ✅ **Múltiplas Filas** (emails e processamento de dados)
- ✅ **Workers com Concorrência** (5 emails e 3 processamentos simultâneos)
- ✅ **Retry Automático** com backoff exponencial
- ✅ **Priorização de Jobs**
- ✅ **Eventos e Monitoramento**
- ✅ **Limpeza Automática** de jobs completados/falhados

## 📊 Monitoramento

Os workers emitem logs detalhados:

- 🔄 Job sendo processado
- ✅ Job completado com sucesso
- ❌ Job falhou
- 📧 Detalhes do email enviado
- ⚙️ Detalhes do processamento de dados

## 🛠️ Scripts Disponíveis

- `npm run build` - Compila TypeScript para JavaScript
- `npm start` - Executa a aplicação compilada
- `npm run dev` - Executa em modo desenvolvimento
- `npm run dev:watch` - Executa com hot reload
- `npm run producer` - Apenas adiciona jobs
- `npm run worker` - Apenas processa jobs

## 🚀 Deploy no Heroku

O projeto está pronto para deploy no Heroku:

```bash
# Login no Heroku
heroku login

# Criar app
heroku create seu-app-name

# Adicionar variáveis de ambiente
heroku config:set REDIS_URL=sua-redis-url
heroku config:set REDIS_HOST=seu-host
heroku config:set REDIS_PORT=25061
heroku config:set REDIS_USERNAME=default
heroku config:set REDIS_PASSWORD=sua-senha

# Deploy
git push heroku main

# Ver logs
heroku logs --tail
```

O Heroku vai automaticamente:

- Usar a porta definida em `process.env.PORT`
- Rodar o servidor web (Procfile)
- Escalar workers separadamente se necessário

## 📚 Recursos Adicionais

- [Documentação BullMQ](https://docs.bullmq.io/)
- [Redis Documentation](https://redis.io/documentation)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

## 🤝 Contribuindo

Sinta-se à vontade para adicionar novos tipos de filas e workers conforme suas necessidades!

## 📄 Licença

ISC
