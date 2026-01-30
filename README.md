# Bora Passageiro API

API de Analytics para o site Bora Passageiro.

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Health check |
| POST | `/api/track` | Registra evento (visit, click_playstore, etc) |
| GET | `/api/stats` | Retorna estatísticas agregadas |

## Deploy no Coolify

1. Adicionar como novo serviço no Coolify
2. Selecionar "Docker" como build method
3. Configurar variáveis de ambiente:
   - `DATABASE_URL` - String de conexão PostgreSQL
   - `PORT` - Porta da API (default: 3001)
4. Após deploy, executar no terminal do container:
   ```bash
   npx prisma db push
   ```

## Desenvolvimento Local

```bash
npm install
npm run dev
```
