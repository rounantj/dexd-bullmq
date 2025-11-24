# 🧪 Exemplos de Teste para Cada Plataforma

Este arquivo contém exemplos reais de links para testar cada plataforma suportada.

---

## ✅ YouTube

### Vídeo Normal

```bash
curl -X POST http://localhost:5050/api/video-processing \
  -H "Content-Type: application/json" \
  -d '{
    "videoLink": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "isVideo": true,
    "userId": 1,
    "type": "video"
  }'
```

### YouTube Shorts

```bash
curl -X POST http://localhost:5050/api/video-processing \
  -H "Content-Type: application/json" \
  -d '{
    "videoLink": "https://www.youtube.com/shorts/abc123",
    "isVideo": true,
    "userId": 1,
    "type": "video"
  }'
```

### YouTube Link Curto

```bash
curl -X POST http://localhost:5050/api/video-processing \
  -H "Content-Type: application/json" \
  -d '{
    "videoLink": "https://youtu.be/dQw4w9WgXcQ",
    "isVideo": true,
    "userId": 1,
    "type": "video"
  }'
```

**O que você vai receber:**
- ✅ Título completo
- ✅ Descrição completa (até 5000 chars)
- ✅ Thumbnail em alta qualidade
- ✅ Nome do canal
- ✅ Tags
- ✅ Estatísticas (views, likes)
- ✅ Duração
- ✅ Data de publicação

---

## 📸 Instagram

### Post/Reel Público

```bash
curl -X POST http://localhost:5050/api/video-processing \
  -H "Content-Type: application/json" \
  -d '{
    "videoLink": "https://www.instagram.com/p/ABC123/",
    "isVideo": true,
    "userId": 1,
    "type": "video"
  }'
```

### Reel

```bash
curl -X POST http://localhost:5050/api/video-processing \
  -H "Content-Type: application/json" \
  -d '{
    "videoLink": "https://www.instagram.com/reel/ABC123/",
    "isVideo": true,
    "userId": 1,
    "type": "video"
  }'
```

**O que você vai receber:**
- ✅ Nome do autor (@usuario)
- ✅ Thumbnail do post
- ✅ Dimensões (width x height)
- ⚠️ Título limitado (não tem caption completa)
- ❌ Não tem likes/comentários/views

**Limitações:**
- 🔒 Só funciona com posts **públicos**
- ❌ Posts privados retornarão erro
- ❌ Stories não funcionam (expiram em 24h)

---

## 📘 Facebook

### Vídeo Público (formato watch)

```bash
curl -X POST http://localhost:5050/api/video-processing \
  -H "Content-Type: application/json" \
  -d '{
    "videoLink": "https://www.facebook.com/watch/?v=1234567890",
    "isVideo": true,
    "userId": 1,
    "type": "video"
  }'
```

### Link Curto (fb.watch)

```bash
curl -X POST http://localhost:5050/api/video-processing \
  -H "Content-Type: application/json" \
  -d '{
    "videoLink": "https://fb.watch/abc123/",
    "isVideo": true,
    "userId": 1,
    "type": "video"
  }'
```

**O que você vai receber:**
- ✅ Título do vídeo
- ✅ Nome da página/autor
- ✅ Thumbnail do vídeo
- ✅ Dimensões do vídeo
- ⚠️ Descrição limitada
- ❌ Não tem likes/compartilhamentos/comentários

**Limitações:**
- 🔒 Só funciona com vídeos **públicos**
- ❌ Vídeos de grupos privados não funcionam
- ❌ Vídeos com restrição de idade podem falhar

---

## 🎥 Vimeo

### Vídeo Público

```bash
curl -X POST http://localhost:5050/api/video-processing \
  -H "Content-Type: application/json" \
  -d '{
    "videoLink": "https://vimeo.com/123456789",
    "isVideo": true,
    "userId": 1,
    "type": "video"
  }'
```

**O que você vai receber:**
- ✅ Título completo
- ✅ Descrição completa
- ✅ Nome do criador
- ✅ Thumbnail em alta qualidade
- ✅ Duração do vídeo
- ✅ Dimensões (width x height)

**Limitações:**
- 🔒 Só funciona com vídeos **públicos**
- ❌ Vídeos com senha não funcionam
- ❌ Vídeos privados não funcionam

---

## 🧪 Teste Completo (JavaScript/TypeScript)

```typescript
import axios from 'axios';

const API_URL = 'http://localhost:5050/api/video-processing';

interface TestVideo {
  name: string;
  platform: string;
  link: string;
  shouldWork: boolean;
  notes?: string;
}

const testVideos: TestVideo[] = [
  // YouTube
  {
    name: 'YouTube - Vídeo Normal',
    platform: 'youtube',
    link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    shouldWork: true,
    notes: 'Metadados completos'
  },
  {
    name: 'YouTube - Shorts',
    platform: 'youtube',
    link: 'https://www.youtube.com/shorts/abc123',
    shouldWork: true,
    notes: 'Metadados completos'
  },
  
  // Instagram
  {
    name: 'Instagram - Post Público',
    platform: 'instagram',
    link: 'https://www.instagram.com/p/ABC123/',
    shouldWork: true,
    notes: 'Metadados básicos (sem caption completa)'
  },
  {
    name: 'Instagram - Reel',
    platform: 'instagram',
    link: 'https://www.instagram.com/reel/ABC123/',
    shouldWork: true,
    notes: 'Metadados básicos'
  },
  
  // Facebook
  {
    name: 'Facebook - Vídeo Público',
    platform: 'facebook',
    link: 'https://www.facebook.com/watch/?v=1234567890',
    shouldWork: true,
    notes: 'Metadados básicos'
  },
  {
    name: 'Facebook - Link Curto',
    platform: 'facebook',
    link: 'https://fb.watch/abc123/',
    shouldWork: true,
    notes: 'Metadados básicos'
  },
  
  // Vimeo
  {
    name: 'Vimeo - Vídeo Público',
    platform: 'vimeo',
    link: 'https://vimeo.com/123456789',
    shouldWork: true,
    notes: 'Metadados completos'
  }
];

async function testVideoProcessing(video: TestVideo) {
  console.log(`\n🧪 Testando: ${video.name}`);
  console.log(`   Platform: ${video.platform}`);
  console.log(`   Link: ${video.link}`);
  
  try {
    // 1. Criar job
    const createResponse = await axios.post(API_URL, {
      videoLink: video.link,
      isVideo: true,
      userId: 999,
      type: 'video'
    });
    
    const jobId = createResponse.data.jobId;
    console.log(`   ✅ Job criado: ${jobId}`);
    
    // 2. Aguardar processamento (polling)
    let attempts = 0;
    const maxAttempts = 30; // 60 segundos (30 * 2s)
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2s
      
      const statusResponse = await axios.get(`${API_URL}/${jobId}`);
      const status = statusResponse.data.status;
      
      console.log(`   ⏳ Status: ${status} (attempt ${attempts + 1}/${maxAttempts})`);
      
      if (status === 'completed') {
        const result = statusResponse.data.data.result;
        console.log(`   ✨ SUCESSO!`);
        console.log(`      Título: ${result.result.videoInfo.title}`);
        console.log(`      Autor: ${result.result.videoInfo.author}`);
        console.log(`      Thumbnail: ${result.result.videoInfo.thumbnail ? '✅' : '❌'}`);
        console.log(`      Descrição: ${result.result.videoInfo.description?.substring(0, 100)}...`);
        return { success: true, result };
      }
      
      if (status === 'failed') {
        console.log(`   ❌ FALHOU!`);
        console.log(`      Erro: ${statusResponse.data.data?.failedReason}`);
        return { success: false, error: 'Job failed' };
      }
      
      attempts++;
    }
    
    console.log(`   ⏰ TIMEOUT após ${maxAttempts * 2} segundos`);
    return { success: false, error: 'Timeout' };
    
  } catch (error: any) {
    console.log(`   ❌ ERRO: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runAllTests() {
  console.log('🚀 Iniciando testes de todas as plataformas...\n');
  console.log('=' .repeat(80));
  
  const results = {
    total: testVideos.length,
    passed: 0,
    failed: 0,
    timeout: 0
  };
  
  for (const video of testVideos) {
    const result = await testVideoProcessing(video);
    
    if (result.success) {
      results.passed++;
    } else if (result.error === 'Timeout') {
      results.timeout++;
    } else {
      results.failed++;
    }
    
    console.log('=' .repeat(80));
  }
  
  console.log('\n📊 RESUMO DOS TESTES:');
  console.log(`   Total: ${results.total}`);
  console.log(`   ✅ Passou: ${results.passed}`);
  console.log(`   ❌ Falhou: ${results.failed}`);
  console.log(`   ⏰ Timeout: ${results.timeout}`);
}

// Executar
runAllTests().catch(console.error);
```

---

## 📋 Checklist de Testes Manuais

### Antes de começar:
- [ ] Redis está rodando (`docker-compose up -d`)
- [ ] Servidor está rodando (`npm run dev`)
- [ ] Worker está rodando (já inicia com o servidor)
- [ ] `GOOGLE_API_KEY` está configurada (para YouTube)
- [ ] `OPENAI_API_KEY` está configurada (para análise IA)

### Testar cada plataforma:

#### YouTube
- [ ] Vídeo normal (`youtube.com/watch?v=`)
- [ ] Link curto (`youtu.be/`)
- [ ] YouTube Shorts (`youtube.com/shorts/`)
- [ ] Verificar metadados completos no resultado

#### Instagram
- [ ] Post público
- [ ] Reel público
- [ ] Verificar que retorna autor e thumbnail
- [ ] Confirmar que post privado falha corretamente

#### Facebook
- [ ] Vídeo público (`facebook.com/watch/?v=`)
- [ ] Link curto (`fb.watch/`)
- [ ] Verificar que retorna título e thumbnail

#### Vimeo
- [ ] Vídeo público
- [ ] Verificar metadados completos
- [ ] Confirmar que vídeo com senha falha corretamente

### Verificar Dashboard:
- [ ] Acessar `http://localhost:5050/admin/queues`
- [ ] Ver jobs na fila `video-processing-queue`
- [ ] Verificar jobs completados com sucesso
- [ ] Verificar detalhes dos resultados

---

## 🐛 Troubleshooting

### Job fica em "active" mas não completa
- Verifique os logs do worker no console
- Pode ser timeout na API (Instagram/Facebook podem ser lentos)
- Verifique se o vídeo é realmente público

### Instagram/Facebook retornam erro 403
- O post/vídeo provavelmente é privado
- Teste o link em navegador anônimo (sem login)

### YouTube não funciona
- Verifique se `GOOGLE_API_KEY` está configurada
- Verifique quota no Google Cloud Console
- Vídeo pode estar privado ou removido

### OpenAI dá erro
- Verifique se `OPENAI_API_KEY` está configurada
- Verifique saldo da conta OpenAI
- Pode estar atingindo rate limit

---

## 📞 Consultar Status do Job

Após criar um job, você recebe um `jobId`. Use para consultar:

```bash
# Consultar status
curl http://localhost:5050/api/video-processing/{jobId}

# Exemplo
curl http://localhost:5050/api/video-processing/1
```

**Status possíveis:**
- `waiting` - Aguardando processamento
- `active` - Sendo processado agora
- `completed` - ✅ Completado com sucesso
- `failed` - ❌ Falhou após tentativas
- `delayed` - Aguardando retry

---

## 🎯 Exemplo de Resposta Completa

```json
{
  "success": true,
  "jobId": "1",
  "status": "completed",
  "progress": 100,
  "data": {
    "input": {
      "videoLink": "https://youtube.com/watch?v=ABC",
      "userId": 1,
      "type": "video"
    },
    "result": {
      "success": true,
      "timestamp": "2025-11-24T10:30:00.000Z",
      "result": {
        "videoInfo": {
          "title": "Título do Vídeo",
          "description": "Descrição resumida e atrativa",
          "fullDescription": "Descrição completa aqui...",
          "platform": "youtube",
          "thumbnail": "https://i.ytimg.com/vi/ABC/maxresdefault.jpg",
          "duration": "PT5M30S",
          "category": "Vídeo",
          "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10"],
          "language": "pt-BR",
          "author": "Nome do Canal",
          "contentType": "tutorial",
          "productAnalysis": {
            "hasProducts": true,
            "productLinks": ["https://amazon.com/..."],
            "productsInfo": [
              {
                "url": "https://amazon.com/...",
                "productName": "Nome do Produto",
                "type": "product",
                "description": "Descrição do produto"
              }
            ],
            "totalFound": 1
          }
        },
        "videoLink": "https://youtube.com/watch?v=ABC",
        "userId": 1
      }
    }
  },
  "timestamps": {
    "created": 1700000000000,
    "processed": 1700000005000,
    "finished": 1700000010000
  }
}
```

