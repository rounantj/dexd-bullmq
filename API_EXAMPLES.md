# 🎬 API de Processamento de Vídeos

## 📱 Plataformas Suportadas

- ✅ **YouTube** (vídeos e shorts) - API oficial com metadados completos
- ✅ **Instagram** - oEmbed API pública (posts/reels públicos)
- ✅ **Facebook** - oEmbed API pública (vídeos públicos)
- ✅ **Vimeo** - oEmbed API pública
- ⚠️ **TikTok** - Detecção disponível, metadados limitados

## Endpoints Disponíveis

### 1. **POST** `/api/video-processing`

Adiciona um novo job de processamento de vídeo à fila.

#### Request Body:

```json
{
  "videoLink": "https://youtu.be/icb25G4YY7g?si=zAwKXHdM_xLCtyOI",
  "isVideo": true,
  "userId": 9,
  "type": "video"
}
```

**Exemplos de links suportados:**

```json
// YouTube
{"videoLink": "https://youtube.com/watch?v=ABC123", ...}
{"videoLink": "https://youtu.be/ABC123", ...}
{"videoLink": "https://youtube.com/shorts/ABC123", ...}

// Instagram
{"videoLink": "https://instagram.com/p/ABC123/", ...}
{"videoLink": "https://instagram.com/reel/ABC123/", ...}

// Facebook
{"videoLink": "https://facebook.com/watch/?v=123456", ...}
{"videoLink": "https://fb.watch/ABC123/", ...}

// Vimeo
{"videoLink": "https://vimeo.com/123456789", ...}
```

#### Response Success (201):

```json
{
  "success": true,
  "jobId": "1",
  "message": "Job adicionado à fila de processamento",
  "data": {
    "videoLink": "https://youtu.be/icb25G4YY7g?si=zAwKXHdM_xLCtyOI",
    "userId": 9,
    "type": "video"
  }
}
```

#### Response Error (400):

```json
{
  "error": "Campos obrigatórios faltando",
  "required": ["videoLink", "userId"]
}
```

---

### 2. **GET** `/api/video-processing/:jobId`

Consulta o status e resultado de um job pelo ID.

#### Response Success (200):

```json
{
  "success": true,
  "jobId": "1",
  "status": "completed",
  "progress": 100,
  "data": {
    "input": {
      "videoLink": "https://youtu.be/icb25G4YY7g?si=zAwKXHdM_xLCtyOI",
      "isVideo": true,
      "userId": 9,
      "type": "video"
    },
    "result": {
      "success": true,
      "timestamp": "2025-10-01T00:50:00.000Z",
      "result": {
        // Resposta da API DEXD aqui
      }
    }
  },
  "timestamps": {
    "created": 1696118400000,
    "processed": 1696118405000,
    "finished": 1696118410000
  },
  "attempts": {
    "made": 1,
    "total": 3
  }
}
```

#### Status Possíveis:

- `waiting` - Job aguardando processamento
- `active` - Job sendo processado
- `completed` - Job completado com sucesso
- `failed` - Job falhou após todas as tentativas
- `delayed` - Job atrasado (retry)

#### Response Error (404):

```json
{
  "success": false,
  "error": "Job não encontrado",
  "jobId": "999"
}
```

---

## 📝 Exemplos de Uso

### cURL

**Criar Job:**

```bash
curl -X POST http://localhost:5050/api/video-processing \
  -H "Content-Type: application/json" \
  -d '{
    "videoLink": "https://youtu.be/icb25G4YY7g?si=zAwKXHdM_xLCtyOI",
    "isVideo": true,
    "userId": 9,
    "type": "video"
  }'
```

**Consultar Job:**

```bash
curl http://localhost:5050/api/video-processing/1
```

---

### JavaScript/TypeScript (Axios)

```typescript
import axios from "axios";

const API_URL = "http://localhost:5050/api/video-processing";

// Criar job
async function createVideoJob() {
  try {
    const response = await axios.post(API_URL, {
      videoLink: "https://youtu.be/icb25G4YY7g?si=zAwKXHdM_xLCtyOI",
      isVideo: true,
      userId: 9,
      type: "video",
    });

    console.log("Job criado:", response.data.jobId);
    return response.data.jobId;
  } catch (error) {
    console.error("Erro:", error.response?.data);
  }
}

// Consultar status
async function checkJobStatus(jobId: string) {
  try {
    const response = await axios.get(`${API_URL}/${jobId}`);

    console.log("Status:", response.data.status);
    console.log("Resultado:", response.data.data.result);

    return response.data;
  } catch (error) {
    console.error("Erro:", error.response?.data);
  }
}

// Polling para aguardar conclusão
async function waitForCompletion(jobId: string, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    const job = await checkJobStatus(jobId);

    if (job.status === "completed") {
      console.log("Job completado!", job.data.result);
      return job;
    }

    if (job.status === "failed") {
      console.error("Job falhou!");
      return job;
    }

    // Aguarda 2 segundos antes de consultar novamente
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("Timeout aguardando conclusão do job");
}

// Uso completo
async function processVideo() {
  const jobId = await createVideoJob();
  const result = await waitForCompletion(jobId);
  return result;
}
```

---

### Python (requests)

```python
import requests
import time

API_URL = 'http://localhost:5050/api/video-processing'

# Criar job
def create_video_job():
    payload = {
        'videoLink': 'https://youtu.be/icb25G4YY7g?si=zAwKXHdM_xLCtyOI',
        'isVideo': True,
        'userId': 9,
        'type': 'video'
    }

    response = requests.post(API_URL, json=payload)
    data = response.json()

    print(f"Job criado: {data['jobId']}")
    return data['jobId']

# Consultar status
def check_job_status(job_id):
    response = requests.get(f"{API_URL}/{job_id}")
    return response.json()

# Aguardar conclusão
def wait_for_completion(job_id, max_attempts=60):
    for _ in range(max_attempts):
        job = check_job_status(job_id)

        if job['status'] == 'completed':
            print('Job completado!', job['data']['result'])
            return job

        if job['status'] == 'failed':
            print('Job falhou!')
            return job

        time.sleep(2)

    raise Exception('Timeout aguardando conclusão do job')

# Uso
job_id = create_video_job()
result = wait_for_completion(job_id)
```

---

## ⚙️ Configuração

Certifique-se de ter a variável `DEXD_API_URL` configurada no seu `.env`:

```env
DEXD_API_URL=https://sua-api-dexd.com
```

O worker fará a requisição para: `{DEXD_API_URL}/system/link-to-product`

## 📡 Payload Enviado à API DEXD

O worker envia automaticamente o seguinte payload para sua API:

```json
{
  "videoLink": "https://youtu.be/icb25G4YY7g?si=zAwKXHdM_xLCtyOI",
  "isVideo": true,
  "userId": 9,
  "type": "video",
  "fromBullMq": true
}
```

⚠️ **Importante:** O campo `fromBullMq: true` é adicionado automaticamente para identificar que a requisição vem do sistema de filas.
