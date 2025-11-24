# 🐛 Guia de Debug - Logs Detalhados Implementados

## ✅ O que foi adicionado:

Logs completos e detalhados em **todas as etapas** do processamento de vídeos, especialmente para Instagram, Facebook e Vimeo.

---

## 📋 Estrutura dos Logs

### 1. **Detecção de Plataforma**
```
📱 [Worker]: Platform detected: instagram
```

### 2. **Busca de Metadados (Instagram)**
```
📸 [Worker]: Fetching Instagram metadata via oEmbed...
   📍 URL: https://instagram.com/p/ABC123/
   🔗 oEmbed URL: https://api.instagram.com/oembed/?url=...
   📦 RAW Response Data:
   {
     "title": "...",
     "author_name": "...",
     "thumbnail_url": "...",
     ...
   }
   ✅ Processed Metadata:
      - Title: Post do Instagram
      - Description: ...
      - Author: @usuario
      - Thumbnail: https://...
      - Dimensions: 640x640
```

### 3. **Análise com IA**
```
🤖 [AI Analysis]: Starting analysis...
   📦 Video Metadata Received:
      - Platform: instagram
      - Title: Post do Instagram
      - Description: NULL (Instagram não tem caption via oEmbed)
      - Author: @usuario
      - Thumbnail: https://...
   
   🔍 Analysis Mode Decision:
      - hasYouTubeData: false
      - hasFullDescription: false
      - Mode: Full AI Analysis
   
   ⚠️ Using full AI analysis (Instagram/Facebook/Vimeo mode)
      - Available Title: Post do Instagram
      - Available Author: @usuario
      - Available Thumbnail: https://...
   
   🚀 Calling OpenAI for analysis...
   ✅ AI Analysis Complete:
      - Generated Description: Descrição concisa...
      - Generated Tags: 10
      - Tags: ["tag1", "tag2", ...]
   
   📦 Final Video Info:
      - Title: Post do Instagram
      - Description: Descrição gerada pela IA
      - Thumbnail: https://...
      - Tags: 10
      - Author: @usuario
```

### 4. **Resultado Final**
```
================================================================================
✨ [Worker]: ANALYSIS COMPLETED SUCCESSFULLY!
================================================================================
   📊 FINAL RESULTS:
      - Platform: instagram
      - Title: Post do Instagram
      - Description: Descrição concisa e atrativa...
      - Author: @usuario
      - Thumbnail: ✅ Present
      - Tags: 10 tags
      - Tags List: ["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10"]
      - Products Found: 0
================================================================================
```

---

## 🧪 Como Testar e Ver os Logs

### 1. **Reiniciar o servidor com os novos logs**

```bash
# Terminal 1 - Parar servidor se estiver rodando (Ctrl+C)
# Depois rodar novamente:
npm run dev
```

Você verá:
```
🎬 Video Processing Worker started with support for: YouTube, Instagram, Facebook, Vimeo!
```

### 2. **Enviar um vídeo do Instagram para teste**

```bash
# Terminal 2
curl -X POST http://localhost:5050/api/video-processing \
  -H "Content-Type: application/json" \
  -d '{
    "videoLink": "https://www.instagram.com/p/ABC123/",
    "isVideo": true,
    "userId": 1,
    "type": "video"
  }'
```

**Substitua `ABC123` por um post real público do Instagram!**

### 3. **Acompanhar os logs no Terminal 1**

Você verá TODOS os logs detalhados:
- ✅ Detecção da plataforma
- ✅ Response RAW do oEmbed
- ✅ Metadados processados
- ✅ Decisão de qual modo de análise usar
- ✅ Chamada à OpenAI
- ✅ Tags geradas
- ✅ Resultado final completo

### 4. **Verificar resultado via API**

```bash
# Use o jobId retornado no passo 2
curl http://localhost:5050/api/video-processing/{jobId}
```

---

## 🔍 O que Procurar nos Logs

### ✅ Instagram Funcionando:
```
✅ Processed Metadata:
   - Thumbnail: https://scontent.cdninstagram.com/...  ← DEVE ter URL
   - Title: Post do Instagram ou nome do autor         ← DEVE ter título
   
✅ AI Analysis Complete:
   - Generated Tags: 10                                ← DEVE ter 10 tags
   - Generated Description: ...                        ← DEVE ter descrição
```

### ❌ Instagram com Problema:
```
❌ Instagram oEmbed failed:
   - Status: 404
   - Message: Request failed with status code 404
   - Response: {"error": "..."}
```

**Causas possíveis:**
- Post é privado
- Post foi deletado
- URL está incorreta

---

## 📝 Checklist de Debug

### Se THUMBNAIL está NULL:
- [ ] Verifique o log `📦 RAW Response Data` - tem `thumbnail_url`?
- [ ] Se SIM, o problema é no mapeamento → verifique a linha do código
- [ ] Se NÃO, o Instagram não retornou → post pode ser privado

### Se TAGS estão vazias ou genéricas:
- [ ] Verifique `✅ AI Analysis Complete` - tags foram geradas?
- [ ] Se NÃO foram geradas, verifique se OpenAI respondeu
- [ ] Verifique se `OPENAI_API_KEY` está configurada
- [ ] Verifique saldo da conta OpenAI

### Se DESCRIÇÃO está genérica:
- [ ] Instagram/Facebook NÃO retornam caption via oEmbed (é limitação da API)
- [ ] A IA deveria gerar uma descrição baseada no título
- [ ] Verifique se a IA foi chamada: `🚀 Calling OpenAI for analysis...`

---

## 🎯 Exemplo de Post Instagram para Testar

Use um post público qualquer do Instagram. Exemplos:

```bash
# Post de @instagram (oficial)
https://www.instagram.com/p/C7VXKPvPrLi/

# Post de @natgeo
https://www.instagram.com/p/C7VWrHmvqPj/

# Reel público
https://www.instagram.com/reel/C7VXKPvPrLi/
```

**IMPORTANTE:** O post DEVE ser público! Posts privados retornarão erro 404.

---

## 🚨 Erros Comuns e Soluções

### Erro: "Instagram oEmbed failed: 404"
**Causa:** Post é privado ou não existe  
**Solução:** Use um post público

### Erro: "OpenAI API error"
**Causa:** OPENAI_API_KEY inválida ou sem saldo  
**Solução:** Verifique a chave no `.env`

### Thumbnail aparece NULL nos logs mas existe no RAW
**Causa:** Mapeamento incorreto no código  
**Solução:** O código já foi corrigido, reinicie o servidor

### Tags sempre genéricas ["video", "conteudo", ...]
**Causa:** OpenAI não está sendo chamada ou falhou  
**Solução:** Verifique os logs da OpenAI

---

## 📞 Como Compartilhar Logs para Debug

Se precisar de ajuda, copie e envie:

1. **Todo o bloco de logs desde:**
```
================================================================================
🎬 [Worker]: Processing video with LLM...
```

2. **Até:**
```
================================================================================
```

3. **Incluindo especialmente:**
- `📦 RAW Response Data` (resposta do Instagram)
- `🤖 [AI Analysis]` (decisão de modo)
- `✨ FINAL RESULTS` (resultado final)

---

## ✨ Próximos Passos

Agora que você tem logs completos:

1. **Teste** um post público do Instagram
2. **Observe** os logs no console
3. **Verifique** se thumbnail, tags e descrição estão sendo gerados
4. **Reporte** qualquer problema com os logs completos

---

## 🎯 Diferenças: YouTube vs Instagram/Facebook/Vimeo

| Aspecto | YouTube | Instagram/Facebook/Vimeo |
|---------|---------|--------------------------|
| **API** | YouTube Data API v3 | oEmbed (público) |
| **Descrição** | ✅ Completa (5000 chars) | ❌ Não disponível |
| **Thumbnail** | ✅ Múltiplas resoluções | ✅ Uma resolução |
| **Tags** | ✅ Do vídeo | ❌ Geradas por IA |
| **Estatísticas** | ✅ Views, likes | ❌ Não disponível |
| **Modo IA** | Otimizado (só resumo) | Completo (tags + descrição) |

Por isso os logs mostrarão modos diferentes:
- YouTube: `Using YouTube API metadata + AI for tags and summary`
- Instagram: `Using full AI analysis (Instagram/Facebook/Vimeo mode)`

