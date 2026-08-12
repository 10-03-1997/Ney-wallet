# NeyWallet Backend

Backend da carteira digital NeyWallet.

## Tecnologias

- Node.js
- Express
- PostgreSQL
- JWT
- bcrypt
- CORS

## Funcionalidades

- Criação de conta
- Login
- Autenticação JWT
- Consulta de saldo
- Transferências entre utilizadores
- Histórico de transações
- Moeda padrão: MZN

## Endpoints

GET /

GET /health

POST /api/auth/register

POST /api/auth/login

GET /api/wallet

POST /api/transactions/transfer

GET /api/transactions

## Instalação

```bash
npm install
